const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { WebSocketServer } = require('ws');

const { DataStore, generateApiKey, generateWebhookSecret, generatePayCode } = require('./store');
const {
  validateAndParseQris,
  generateDynamicQris,
  decodeQrisFromImageBuffer,
  generateQrPngBuffer,
  generateQrDataUrl,
  createSampleStaticDanaQris
} = require('./qris');
const { PairBridgeServer } = require('./pairServer');
const { postJson } = require('./webhook');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

function getLocalLanIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips.length > 0 ? ips : ['127.0.0.1'];
}

async function startServers() {
  const store = new DataStore();

  // CLI or ENV overrides for ports
  if (process.env.PAIR_PORT) store.state.config.pairPort = Number(process.env.PAIR_PORT);
  if (process.env.HTTP_PORT) store.state.config.httpPort = Number(process.env.HTTP_PORT);

  const dashboardClients = new Set();
  function broadcastDashboardEvent(event, payload) {
    const msg = JSON.stringify({ event, payload, timestamp: Date.now() });
    for (const client of dashboardClients) {
      if (client.readyState === 1) {
        client.send(msg);
      }
    }
  }

  // 1. Start Pairing & Device Notification Bridge Server (Default Port 2020)
  const pairServer = new PairBridgeServer(store, (event, payload) => {
    broadcastDashboardEvent(event, payload);
  });

  await pairServer.start(store.state.config.pairPort);

  // 2. Start HTTP Web Dashboard & Payment Gateway Server (Default Port 8080)
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Serve static frontend files
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Helper middleware: Admin session auth
  function requireAdminAuth(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim() || req.query.token;
    if (!store.isValidSession(token)) {
      return res.status(401).json({
        success: false,
        message: 'Sesi login tidak valid atau telah berakhir. Silakan login kembali.'
      });
    }
    next();
  }

  // Helper middleware: API Key auth (Authorization: Bearer <apiKey>)
  function requireApiKey(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token || token !== store.state.config.apiKey) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Invalid or missing Bearer API Key'
      });
    }
    next();
  }

  // ============================================================================
  // PUBLIC QRIS IMAGE & CHECKOUT ENDPOINTS
  // ============================================================================

  // Dynamic QRIS PNG Image: GET /qris/:payCode.png
  app.get('/qris/:payCodeFile', async (req, res) => {
    try {
      const rawParam = String(req.params.payCodeFile || '').replace(/\.png$/i, '').trim();
      const tx = store.state.transactions.find((t) => t.pay_code === rawParam);
      if (!tx || !tx.qr_string) {
        return res.status(404).json({ success: false, message: 'QRIS transaksi tidak ditemukan' });
      }
      const pngBuffer = await generateQrPngBuffer(tx.qr_string);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.send(pngBuffer);
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // ============================================================================
  // PUBLIC API GATEWAY ENDPOINTS (DOCUMENTED SPECIFICATION)
  // ============================================================================

  /**
   * POST /api/transaction/create
   * Header: { 'Authorization': 'Bearer ' + apiKey }
   */
  app.post('/api/transaction/create', requireApiKey, (req, res) => {
    try {
      const setup = store.isSetupComplete();
      if (!setup.hasQris) {
        return res.status(400).json({
          success: false,
          message: 'QRIS Statis belum di-upload pada Dashboard Server.'
        });
      }

      const body = req.body || {};
      const rawItems = Array.isArray(body.order_items) ? body.order_items : [];
      const formattedItems = rawItems.map((item) => {
        const price = Math.round(Number(item.price) || 0);
        const quantity = Math.max(1, Math.round(Number(item.quantity) || 1));
        return {
          sku: String(item.sku || 'ITEM'),
          name: String(item.name || 'Produk'),
          price,
          quantity,
          subtotal: price * quantity
        };
      });

      const itemsSum = formattedItems.reduce((acc, it) => acc + it.subtotal, 0);
      const amountReceived = Math.round(Number(body.amount) || itemsSum || 0);
      if (amountReceived <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Parameter amount harus lebih besar dari 0'
        });
      }

      // Allocate unique nominal (amount = amount_received + kode_unik)
      const { amount, uniqueCode } = store.allocateUniqueAmount(amountReceived);
      const payCode = generatePayCode();
      const expiredTime = Math.max(60, Math.round(Number(body.expired_time) || 600));
      const now = Date.now();

      // Convert static QRIS into dynamic QRIS with exact `amount`
      const dynamicQrisString = generateDynamicQris(store.state.config.qris.raw, amount);

      const hostBase =
        store.state.config.publicHost && store.state.config.publicHost.trim()
          ? store.state.config.publicHost.trim().replace(/\/+$/, '')
          : `${req.protocol}://${req.get('host')}`;

      const qrUrl = `${hostBase}/qris/${payCode}.png`;
      const callbackUrl = String(
        body.callback_url || store.state.config.webhookUrl || 'https://domainanda.com/callback'
      );
      const returnUrl = String(body.return_url || 'https://domainanda.com/redirect');

      const newTx = {
        customer_name: String(body.customer_name || 'Pelanggan'),
        customer_email: String(body.customer_email || ''),
        customer_phone: String(body.customer_phone || ''),
        callback_url: callbackUrl,
        return_url: returnUrl,
        amount,
        amount_received: amountReceived,
        unique_code: uniqueCode,
        pay_code: payCode,
        status: 'UNPAID',
        expired_time: expiredTime,
        order_items: formattedItems,
        qr_url: qrUrl,
        qr_string: dynamicQrisString,
        created_at: now,
        expires_at: now + expiredTime * 1000,
        paid_at: null
      };

      store.state.transactions.unshift(newTx);
      store.save();

      broadcastDashboardEvent('transaction_created', { transaction: newTx });

      return res.json({
        success: true,
        message: '',
        data: {
          customer_name: newTx.customer_name,
          customer_email: newTx.customer_email,
          customer_phone: newTx.customer_phone,
          callback_url: newTx.callback_url,
          return_url: newTx.return_url,
          amount: newTx.amount,
          amount_received: newTx.amount_received,
          pay_code: newTx.pay_code,
          status: newTx.status,
          expired_time: newTx.expired_time,
          order_items: newTx.order_items,
          qr_url: newTx.qr_url
        }
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: err.message
      });
    }
  });

  /**
   * GET /api/transaction/check-status?pay_code=57585748548596587
   * Header: { 'Authorization': 'Bearer ' + apiKey }
   */
  app.get('/api/transaction/check-status', requireApiKey, (req, res) => {
    try {
      store.refreshExpiredTransactions();
      // Strip accidental quotes like ?pay_code=57585748548596587'
      const rawPayCode = String(req.query.pay_code || '').replace(/['"]/g, '').trim();
      if (!rawPayCode) {
        return res.status(400).json({
          success: false,
          status: 'unpaid',
          message: 'Parameter pay_code wajib diisi'
        });
      }

      const tx = store.state.transactions.find((t) => t.pay_code === rawPayCode);
      if (!tx) {
        return res.status(404).json({
          success: false,
          status: 'unpaid',
          message: 'Transaksi tidak ditemukan'
        });
      }

      const upperStatus = tx.status.toUpperCase(); // PAID, UNPAID, EXPIRED
      const lowerStatus = tx.status.toLowerCase(); // paid, unpaid, expired

      return res.json({
        success: true,
        status: lowerStatus,
        message: `Status transaksi saat ini ${upperStatus}`,
        data: {
          customer_name: tx.customer_name,
          customer_email: tx.customer_email,
          customer_phone: tx.customer_phone,
          callback_url: tx.callback_url,
          return_url: tx.return_url,
          amount: tx.amount,
          amount_received: tx.amount_received,
          pay_code: tx.pay_code,
          status: upperStatus,
          expired_time: tx.expired_time,
          order_items: tx.order_items,
          qr_url: tx.qr_url
        }
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: err.message
      });
    }
  });

  // ============================================================================
  // DASHBOARD AUTH & ADMIN CONFIGURATION ENDPOINTS
  // ============================================================================

  app.post('/api/admin/login', (req, res) => {
    const { password } = req.body || {};
    if (!store.verifyPassword(password || '')) {
      return res.status(401).json({
        success: false,
        message: 'Password salah! (Default awal: 123456)'
      });
    }
    const token = store.createSession();
    res.json({
      success: true,
      token,
      mustChangePassword: store.state.auth.mustChangePassword
    });
  });

  app.post('/api/admin/change-password', requireAdminAuth, (req, res) => {
    const { newPassword } = req.body || {};
    if (!newPassword || String(newPassword).trim().length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password baru minimal 6 karakter.'
      });
    }
    if (String(newPassword).trim() === '123456') {
      return res.status(400).json({
        success: false,
        message: 'Password baru tidak boleh sama dengan password default (123456).'
      });
    }
    store.changePassword(String(newPassword).trim());
    res.json({
      success: true,
      mustChangePassword: false,
      message: 'Password berhasil diperbarui!'
    });
  });

  app.get('/api/admin/overview', requireAdminAuth, async (req, res) => {
    store.refreshExpiredTransactions();
    const setup = store.isSetupComplete();

    let qrisPreviewDataUrl = null;
    if (store.state.config.qris && store.state.config.qris.raw) {
      try {
        qrisPreviewDataUrl = await generateQrDataUrl(store.state.config.qris.raw);
      } catch (_) {}
    }

    res.json({
      success: true,
      mustChangePassword: store.state.auth.mustChangePassword,
      setup,
      lanIps: getLocalLanIps(),
      config: {
        ...store.state.config,
        qrisPreviewDataUrl
      },
      pairedDevices: store.state.pairedDevices,
      pendingDevices: Array.from(store.pendingDevices.values()),
      transactions: store.state.transactions.slice(0, 100),
      notificationLogs: store.state.notificationLogs.slice(0, 100)
    });
  });

  // Upload QRIS image OR paste raw QRIS string
  app.post('/api/admin/qris/upload', requireAdminAuth, upload.single('qrisImage'), async (req, res) => {
    try {
      let rawQrisStr = '';
      if (req.file && req.file.buffer) {
        rawQrisStr = await decodeQrisFromImageBuffer(req.file.buffer);
      } else if (req.body && req.body.qrisString) {
        rawQrisStr = String(req.body.qrisString).trim();
      } else {
        return res.status(400).json({
          success: false,
          message: 'Silakan pilih file gambar QRIS (.png/.jpg) atau masukkan kode string QRIS.'
        });
      }

      const info = validateAndParseQris(rawQrisStr);
      store.state.config.qris = {
        raw: info.raw,
        merchantName: info.merchantName,
        merchantCity: info.merchantCity,
        nmid: info.nmid,
        uploadedAt: Date.now()
      };
      store.save();

      const previewUrl = await generateQrDataUrl(info.raw);
      broadcastDashboardEvent('qris_updated', { qris: store.state.config.qris });

      res.json({
        success: true,
        message: `QRIS Statis berhasil disimpan (${info.merchantName} - ${info.merchantCity})`,
        qris: store.state.config.qris,
        qrisPreviewDataUrl: previewUrl,
        setup: store.isSetupComplete()
      });
    } catch (err) {
      res.status(400).json({
        success: false,
        message: err.message
      });
    }
  });

  // Generate sample DANA Bisnis QRIS for quick testing
  app.post('/api/admin/qris/sample', requireAdminAuth, async (req, res) => {
    try {
      const merchantName = (req.body && req.body.merchantName) || 'DANA BISNIS STORE';
      const merchantCity = (req.body && req.body.merchantCity) || 'JAKARTA';
      const sampleRaw = createSampleStaticDanaQris(merchantName, merchantCity);
      const info = validateAndParseQris(sampleRaw);

      store.state.config.qris = {
        raw: info.raw,
        merchantName: info.merchantName,
        merchantCity: info.merchantCity,
        nmid: info.nmid,
        uploadedAt: Date.now()
      };
      store.save();

      const previewUrl = await generateQrDataUrl(info.raw);
      res.json({
        success: true,
        message: `Sample QRIS DANA Bisnis (${info.merchantName}) berhasil dimuat!`,
        qris: store.state.config.qris,
        qrisPreviewDataUrl: previewUrl,
        setup: store.isSetupComplete()
      });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  });

  // Pair Android Device by Pairing Code
  app.post('/api/admin/pair/confirm', requireAdminAuth, (req, res) => {
    try {
      const { pairCode, deviceName } = req.body || {};
      const device = pairServer.confirmPairingCode(pairCode, deviceName);
      res.json({
        success: true,
        message: `Perangkat "${device.deviceName}" dengan kode ${device.pairCode} berhasil di-pair!`,
        device,
        setup: store.isSetupComplete()
      });
    } catch (err) {
      res.status(400).json({
        success: false,
        message: err.message
      });
    }
  });

  // Remove / Unpair Android Device
  app.delete('/api/admin/devices/:deviceId', requireAdminAuth, (req, res) => {
    const devId = req.params.deviceId;
    store.state.pairedDevices = store.state.pairedDevices.filter((d) => d.deviceId !== devId);
    store.save();
    res.json({
      success: true,
      message: 'Perangkat berhasil dihapus dari daftar pair.',
      setup: store.isSetupComplete()
    });
  });

  // Update Server / Gateway / Webhook Config
  app.post('/api/admin/config', requireAdminAuth, async (req, res) => {
    try {
      const body = req.body || {};
      const oldPairPort = store.state.config.pairPort;

      if (body.pairPort !== undefined) {
        const p = Number(body.pairPort);
        if (p >= 1024 && p <= 65535) store.state.config.pairPort = p;
      }
      if (body.httpPort !== undefined) {
        const p = Number(body.httpPort);
        if (p >= 1024 && p <= 65535) store.state.config.httpPort = p;
      }
      if (body.publicHost !== undefined) {
        store.state.config.publicHost = String(body.publicHost).trim();
      }
      if (body.uniqueCodeEnabled !== undefined) {
        store.state.config.uniqueCodeEnabled = Boolean(body.uniqueCodeEnabled);
      }
      if (body.uniqueCodeMin !== undefined) {
        store.state.config.uniqueCodeMin = Math.min(99, Math.max(1, Number(body.uniqueCodeMin) || 1));
      }
      if (body.uniqueCodeMax !== undefined) {
        store.state.config.uniqueCodeMax = Math.min(
          99,
          Math.max(store.state.config.uniqueCodeMin, Number(body.uniqueCodeMax) || 99)
        );
      }
      if (body.webhookUrl !== undefined) {
        store.state.config.webhookUrl = String(body.webhookUrl).trim();
      }
      if (body.regenerateApiKey) {
        store.state.config.apiKey = generateApiKey();
      }
      if (body.regenerateWebhookSecret) {
        store.state.config.webhookSecret = generateWebhookSecret();
      }

      store.save();

      // If pairPort changed dynamically, restart pairServer on the new port
      if (store.state.config.pairPort !== oldPairPort) {
        await pairServer.restart(store.state.config.pairPort);
      }

      res.json({
        success: true,
        message: 'Konfigurasi berhasil disimpan!',
        config: store.state.config
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        message: 'Gagal mengubah konfigurasi: ' + err.message
      });
    }
  });

  // Test Webhook Endpoint
  app.post('/api/admin/webhook/test', requireAdminAuth, async (req, res) => {
    const targetUrl = (req.body && req.body.webhookUrl) || store.state.config.webhookUrl;
    if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
      return res.status(400).json({
        success: false,
        message: 'Masukkan URL Webhook yang valid (diawali http:// atau https://)'
      });
    }

    const samplePayload = {
      event: 'payment.test',
      success: true,
      status: 'paid',
      message: 'Status transaksi saat ini PAID (TEST WEBHOOK)',
      timestamp: new Date().toISOString(),
      data: {
        customer_name: 'Test Pelanggan',
        customer_email: 'test@domain.com',
        customer_phone: '081234567890',
        callback_url: targetUrl,
        return_url: 'https://domainanda.com/redirect',
        amount: 1000232,
        amount_received: 1000000,
        pay_code: '57585748548596587',
        status: 'PAID',
        expired_time: 600,
        order_items: [
          {
            sku: 'PRODUK1',
            name: 'Nama Produk 1',
            price: 500000,
            quantity: 1,
            subtotal: 500000
          }
        ]
      }
    };

    const result = await postJson(targetUrl, samplePayload, store.state.config.webhookSecret);
    res.json({
      success: result.ok,
      message: result.ok
        ? `Webhook berhasil dikirim ke ${targetUrl} (HTTP ${result.statusCode})`
        : `Gagal mengirim webhook: ${result.error || 'HTTP ' + result.statusCode}`,
      result
    });
  });

  // Simulate DANA Notification from Dashboard (or test matching)
  app.post('/api/admin/simulate/notification', requireAdminAuth, async (req, res) => {
    try {
      const { amount, title, text, deviceId } = req.body || {};
      const targetDevice =
        store.state.pairedDevices.find((d) => d.deviceId === deviceId) ||
        store.state.pairedDevices[0];

      if (!targetDevice) {
        return res.status(400).json({
          success: false,
          message: 'Belum ada perangkat Android yang di-pair.'
        });
      }

      const formattedNominal = Number(amount || 0).toLocaleString('id-ID');
      const result = await pairServer.handleIncomingNotification(targetDevice.deviceId, {
        pkg: 'id.dana',
        title: title || 'Pembayaran Masuk',
        text: text || `Rp${formattedNominal} diterima DANA Bisnis`,
        amount: String(amount || 0)
      });

      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  const httpServer = http.createServer(app);
  const dashboardWss = new WebSocketServer({ server: httpServer, path: '/ws/dashboard' });

  dashboardWss.on('connection', (ws) => {
    dashboardClients.add(ws);
    ws.on('close', () => dashboardClients.delete(ws));
  });

  const httpPort = store.state.config.httpPort;
  await new Promise((resolve, reject) => {
    httpServer.on('error', reject);
    httpServer.listen(httpPort, '0.0.0.0', () => resolve());
  });

  const lanIps = getLocalLanIps();
  console.log('==================================================================');
  console.log(' 🚀 DANA-QRIS-BRIDGE SERVER RUNNING');
  console.log('==================================================================');
  console.log(` 🌐 Web Dashboard & API Gateway : http://localhost:${httpPort}`);
  lanIps.forEach((ip) => {
    console.log(` 📱 Network Dashboard URL       : http://${ip}:${httpPort}`);
    console.log(` 🔗 Android App Pair Server     : IP ${ip} | PORT ${store.state.config.pairPort}`);
  });
  console.log(' 🔑 Default Dashboard Password  : 123456 (Wajib ganti saat first login)');
  console.log('==================================================================');

  return { app, httpServer, pairServer, store };
}

if (require.main === module) {
  startServers().catch((err) => {
    console.error('[Fatal Startup Error]', err);
    process.exit(1);
  });
}

module.exports = { startServers };
