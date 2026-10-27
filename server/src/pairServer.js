const http = require('http');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { generatePairCode } = require('./store');
const { parseDanaNotification } = require('./parser');
const { dispatchTransactionWebhook } = require('./webhook');

class PairBridgeServer {
  constructor(store, onEventCallback) {
    this.store = store;
    this.onEvent = onEventCallback || (() => {});
    this.httpServer = null;
    this.wss = null;
    this.activeSockets = new Map(); // deviceId -> ws
    this.recentDedup = new Map(); // `${amount}_${Math.floor(ts/5000)}` -> timestamp
  }

  /**
   * Handle incoming notification from a paired Android device (via WS or HTTP)
   */
  async handleIncomingNotification(deviceId, rawPayload) {
    const pairedDevice = this.store.state.pairedDevices.find((d) => d.deviceId === deviceId);
    if (!pairedDevice) {
      return {
        success: false,
        matched: false,
        message: 'Device belum di-pair dengan server.'
      };
    }

    pairedDevice.lastSeenAt = Date.now();
    pairedDevice.status = 'ONLINE';
    pairedDevice.notificationCount = (pairedDevice.notificationCount || 0) + 1;

    const parsed = parseDanaNotification(rawPayload);

    // Deduplicate identical notifications from multiple phones within 4 seconds
    const dedupKey = `${parsed.amount}:${parsed.title}:${parsed.text}`;
    const lastSeenDedup = this.recentDedup.get(dedupKey);
    const now = Date.now();
    if (lastSeenDedup && now - lastSeenDedup < 4000) {
      return {
        success: true,
        matched: false,
        deduplicated: true,
        amount: parsed.amount,
        message: 'Notifikasi duplikat diabaikan (Multi-HP sync)'
      };
    }
    this.recentDedup.set(dedupKey, now);

    // Refresh expired transactions before matching
    this.store.refreshExpiredTransactions();

    let matchedTx = null;
    if (parsed.isValidPayment && parsed.amount > 0) {
      // Find oldest or matching UNPAID transaction with exact amount (amount_received + unique_code)
      matchedTx = this.store.state.transactions.find(
        (tx) => tx.status === 'UNPAID' && Number(tx.amount) === Number(parsed.amount)
      );

      if (matchedTx) {
        matchedTx.status = 'PAID';
        matchedTx.paid_at = now;
        matchedTx.matched_device_id = pairedDevice.deviceId;
        matchedTx.matched_device_name = pairedDevice.deviceName || pairedDevice.model || 'Android';
      }
    }

    const logEntry = {
      id: 'notif_' + now + '_' + Math.floor(Math.random() * 1000),
      timestamp: now,
      deviceId: pairedDevice.deviceId,
      deviceName: pairedDevice.deviceName || pairedDevice.model || 'Android Device',
      pkg: parsed.pkg,
      title: parsed.title,
      text: parsed.text,
      amount: parsed.amount,
      isValidPayment: parsed.isValidPayment,
      matchedPayCode: matchedTx ? matchedTx.pay_code : null
    };

    this.store.state.notificationLogs.unshift(logEntry);
    this.store.save();

    if (matchedTx) {
      // Dispatch webhook asynchronously
      dispatchTransactionWebhook(matchedTx, this.store.state.config)
        .then((whResults) => {
          matchedTx.webhook_results = whResults;
          this.store.save();
          this.onEvent('transaction_paid', { transaction: matchedTx, notification: logEntry, webhook: whResults });
        })
        .catch((err) => {
          console.error('[Webhook Error]', err.message);
        });
    }

    this.onEvent('notification_received', { notification: logEntry, matchedTransaction: matchedTx });

    return {
      success: true,
      matched: Boolean(matchedTx),
      pay_code: matchedTx ? matchedTx.pay_code : null,
      amount: parsed.amount,
      message: matchedTx
        ? `Pembayaran cocok dengan transaksi #${matchedTx.pay_code} (Rp${parsed.amount.toLocaleString('id-ID')})`
        : `Notifikasi dicatat (Rp${parsed.amount.toLocaleString('id-ID')}) - Tidak ada transaksi UNPAID dengan nominal tersebut`
    };
  }

  /**
   * Register or refresh a device hello request (returns pairCode or paired status)
   */
  registerDeviceHello(info, ipAddress = '') {
    const deviceId = String(info.deviceId || '').trim();
    if (!deviceId) {
      throw new Error('deviceId wajib diisi');
    }
    const deviceName = String(info.deviceName || info.model || 'HP Android').trim();
    const model = String(info.model || 'Android').trim();
    const androidVersion = String(info.androidVersion || '13').trim();

    // Check if already paired
    const existingPaired = this.store.state.pairedDevices.find((d) => d.deviceId === deviceId);
    if (existingPaired) {
      existingPaired.deviceName = deviceName || existingPaired.deviceName;
      existingPaired.model = model || existingPaired.model;
      existingPaired.androidVersion = androidVersion || existingPaired.androidVersion;
      existingPaired.ip = ipAddress || existingPaired.ip;
      existingPaired.lastSeenAt = Date.now();
      existingPaired.status = 'ONLINE';
      this.store.save();
      this.onEvent('device_status', { device: existingPaired });
      return {
        paired: true,
        pairCode: existingPaired.pairCode,
        deviceId: existingPaired.deviceId,
        deviceName: existingPaired.deviceName,
        merchantName: this.store.state.config.qris.merchantName || 'DANA QRIS Bridge'
      };
    }

    // Check if already in pendingDevices
    let existingPending = null;
    for (const [, pending] of this.store.pendingDevices.entries()) {
      if (pending.deviceId === deviceId) {
        existingPending = pending;
        break;
      }
    }

    if (existingPending) {
      existingPending.deviceName = deviceName;
      existingPending.model = model;
      existingPending.androidVersion = androidVersion;
      existingPending.ip = ipAddress;
      existingPending.lastSeenAt = Date.now();
      this.onEvent('pending_device', { device: existingPending });
      return {
        paired: false,
        pairCode: existingPending.pairCode,
        deviceId
      };
    }

    // Use the device's own 6-digit pairCode if provided, otherwise generate one
    const clientCode = String(info.pairCode || '').replace(/[^0-9]/g, '').trim();
    let pairCode = clientCode.length >= 4 ? clientCode : generatePairCode();
    while (
      this.store.pendingDevices.has(pairCode) &&
      this.store.pendingDevices.get(pairCode).deviceId !== deviceId
    ) {
      pairCode = generatePairCode();
    }

    const pendingObj = {
      pairCode,
      deviceId,
      deviceName,
      model,
      androidVersion,
      ip: ipAddress,
      connectedAt: Date.now(),
      lastSeenAt: Date.now()
    };

    this.store.pendingDevices.set(pairCode, pendingObj);
    this.onEvent('pending_device', { device: pendingObj });

    return {
      paired: false,
      pairCode,
      deviceId
    };
  }

  /**
   * Confirm pairing from Dashboard using the 6-digit pairCode
   */
  confirmPairingCode(pairCodeInput, customName = '') {
    const cleanCode = String(pairCodeInput || '').replace(/[^0-9]/g, '').trim();
    if (!cleanCode || cleanCode.length < 4) {
      throw new Error('Kode Pairing tidak valid.');
    }

    const pending = this.store.pendingDevices.get(cleanCode);
    let deviceObj = null;

    if (pending) {
      this.store.pendingDevices.delete(cleanCode);
      // Remove if already existed with same deviceId
      this.store.state.pairedDevices = this.store.state.pairedDevices.filter(
        (d) => d.deviceId !== pending.deviceId
      );
      deviceObj = {
        deviceId: pending.deviceId,
        deviceName: customName || pending.deviceName || pending.model || 'Android Bridge',
        model: pending.model || 'Android Device',
        androidVersion: pending.androidVersion || '',
        ip: pending.ip || '',
        pairCode: cleanCode,
        pairedAt: Date.now(),
        lastSeenAt: Date.now(),
        status: this.activeSockets.has(pending.deviceId) ? 'ONLINE' : 'PAIRED',
        notificationCount: 0
      };
    } else {
      // Allow pre-authorizing a pairing code generated on the phone even if the phone connected via stateless mode
      const existingByCode = this.store.state.pairedDevices.find((d) => d.pairCode === cleanCode);
      if (existingByCode) {
        return existingByCode;
      }
      deviceObj = {
        deviceId: 'dev_' + cleanCode,
        deviceName: customName || `Android HP (${cleanCode})`,
        model: 'Android Device',
        androidVersion: '-',
        ip: '-',
        pairCode: cleanCode,
        pairedAt: Date.now(),
        lastSeenAt: Date.now(),
        status: 'WAITING_CONNECTION',
        notificationCount: 0
      };
    }

    this.store.state.pairedDevices.push(deviceObj);
    this.store.save();

    // Notify device over WebSocket if connected
    const ws = this.activeSockets.get(deviceObj.deviceId);
    if (ws && ws.readyState === 1) {
      ws.send(
        JSON.stringify({
          type: 'PAIRED',
          paired: true,
          pairCode: cleanCode,
          deviceId: deviceObj.deviceId,
          deviceName: deviceObj.deviceName,
          merchantName: this.store.state.config.qris.merchantName || 'DANA QRIS Bridge'
        })
      );
    }

    this.onEvent('device_paired', { device: deviceObj });
    return deviceObj;
  }

  start(port) {
    return new Promise((resolve, reject) => {
      const app = express();
      app.use(cors());
      app.use(express.json());

      // Health / Info endpoint on Port 2020
      app.get('/', (req, res) => {
        res.json({
          service: 'Dana-QRIS-Bridge Pairing & Notification Server',
          port,
          status: 'RUNNING',
          pairedDevicesCount: this.store.state.pairedDevices.length
        });
      });

      // HTTP fallback for Device Hello / Requesting Pair Code
      app.post('/hello', (req, res) => {
        try {
          const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
          const result = this.registerDeviceHello(req.body || {}, ip);
          res.json({ success: true, ...result });
        } catch (err) {
          res.status(400).json({ success: false, message: err.message });
        }
      });

      // HTTP fallback for checking Pairing Status
      app.get('/status', (req, res) => {
        const deviceId = String(req.query.deviceId || '').trim();
        const pairCode = String(req.query.pairCode || '').replace(/[^0-9]/g, '').trim();

        let paired = this.store.state.pairedDevices.find(
          (d) => (deviceId && d.deviceId === deviceId) || (pairCode && d.pairCode === pairCode)
        );

        if (paired) {
          if (deviceId && paired.deviceId !== deviceId) {
            // Link pre-authorized pairCode to actual deviceId
            paired.deviceId = deviceId;
          }
          paired.lastSeenAt = Date.now();
          paired.status = 'ONLINE';
          this.store.save();
          return res.json({
            success: true,
            paired: true,
            pairCode: paired.pairCode,
            deviceId: paired.deviceId,
            deviceName: paired.deviceName
          });
        }

        res.json({
          success: true,
          paired: false
        });
      });

      // HTTP fallback for pushing DANA notifications
      app.post('/notify', async (req, res) => {
        try {
          const { deviceId, pairCode } = req.body || {};
          let targetDeviceId = deviceId;
          if (!targetDeviceId && pairCode) {
            const found = this.store.state.pairedDevices.find((d) => d.pairCode === String(pairCode));
            if (found) targetDeviceId = found.deviceId;
          }
          const result = await this.handleIncomingNotification(targetDeviceId, req.body || {});
          res.json(result);
        } catch (err) {
          res.status(500).json({ success: false, message: err.message });
        }
      });

      this.httpServer = http.createServer(app);
      this.wss = new WebSocketServer({ server: this.httpServer });

      this.wss.on('connection', (ws, req) => {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        let boundDeviceId = null;

        ws.on('message', async (rawMsg) => {
          try {
            const msg = JSON.parse(rawMsg.toString());
            const type = String(msg.type || '').toUpperCase();

            if (type === 'HELLO') {
              const info = this.registerDeviceHello(msg, ip);
              boundDeviceId = info.deviceId;
              this.activeSockets.set(boundDeviceId, ws);

              // Also check if pre-authorized by pairCode
              if (!info.paired && msg.pairCode) {
                const preAuth = this.store.state.pairedDevices.find(
                  (d) => d.pairCode === String(msg.pairCode).replace(/[^0-9]/g, '')
                );
                if (preAuth) {
                  preAuth.deviceId = boundDeviceId;
                  preAuth.deviceName = msg.deviceName || preAuth.deviceName;
                  preAuth.model = msg.model || preAuth.model;
                  preAuth.androidVersion = msg.androidVersion || preAuth.androidVersion;
                  preAuth.ip = ip;
                  preAuth.status = 'ONLINE';
                  preAuth.lastSeenAt = Date.now();
                  this.store.pendingDevices.delete(preAuth.pairCode);
                  this.store.save();
                  info.paired = true;
                  info.pairCode = preAuth.pairCode;
                }
              }

              ws.send(
                JSON.stringify({
                  type: info.paired ? 'PAIRED' : 'PAIR_CODE',
                  paired: info.paired,
                  pairCode: info.pairCode,
                  deviceId: info.deviceId,
                  merchantName: this.store.state.config.qris.merchantName || 'DANA QRIS Bridge'
                })
              );
            } else if (type === 'PING' || type === 'HEARTBEAT') {
              const devId = msg.deviceId || boundDeviceId;
              if (devId) {
                const paired = this.store.state.pairedDevices.find((d) => d.deviceId === devId);
                if (paired) {
                  paired.lastSeenAt = Date.now();
                  paired.status = 'ONLINE';
                }
              }
              ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
            } else if (type === 'NOTIFICATION') {
              const devId = msg.deviceId || boundDeviceId;
              const result = await this.handleIncomingNotification(devId, msg);
              ws.send(
                JSON.stringify({
                  type: 'NOTIFICATION_ACK',
                  ...result
                })
              );
            }
          } catch (err) {
            ws.send(JSON.stringify({ type: 'ERROR', message: err.message }));
          }
        });

        ws.on('close', () => {
          if (boundDeviceId) {
            this.activeSockets.delete(boundDeviceId);
            const paired = this.store.state.pairedDevices.find((d) => d.deviceId === boundDeviceId);
            if (paired) {
              paired.status = 'OFFLINE';
              paired.lastSeenAt = Date.now();
              this.store.save();
              this.onEvent('device_status', { device: paired });
            }
          }
        });
      });

      this.httpServer.on('error', (err) => {
        reject(err);
      });

      this.httpServer.listen(port, '0.0.0.0', () => {
        resolve(port);
      });
    });
  }

  async restart(newPort) {
    if (this.httpServer) {
      await new Promise((r) => this.httpServer.close(() => r()));
    }
    return this.start(newPort);
  }
}

module.exports = {
  PairBridgeServer
};
