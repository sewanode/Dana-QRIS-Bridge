const assert = require('assert');
const WebSocket = require('ws');
const { startServers } = require('../src/index');
const {
  createSampleStaticDanaQris,
  generateQrPngBuffer,
  decodeQrisFromImageBuffer
} = require('../src/qris');

async function runTests() {
  console.log('🧪 Starting End-to-End Fullstack Server Verification...');

  // Use test ports so we don't conflict if another instance is running
  process.env.PAIR_PORT = '12020';
  process.env.HTTP_PORT = '18080';

  const { httpServer, pairServer, store } = await startServers();
  const baseUrl = 'http://127.0.0.1:18080';
  const pairUrl = 'ws://127.0.0.1:12020';

  try {
    // Reset state for clean test
    store.state.auth.mustChangePassword = true;
    store.changePassword('123456');
    store.state.auth.mustChangePassword = true;
    store.state.pairedDevices = [];
    store.state.transactions = [];
    store.state.config.qris = { raw: '', merchantName: '', merchantCity: '', nmid: '', uploadedAt: null };
    store.save();

    // 1. Test Default Login (123456) & mustChangePassword
    console.log('1️⃣ Testing First Login with default password (123456)...');
    let res = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: '123456' })
    });
    let data = await res.json();
    assert.strictEqual(data.success, true, 'Default login should succeed');
    assert.strictEqual(data.mustChangePassword, true, 'First login must require password change');
    const adminToken = data.token;

    // 2. Test Password Change on First Login
    console.log('2️⃣ Testing Forced Password Change on First Login...');
    res = await fetch(`${baseUrl}/api/admin/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ newPassword: 'admin123secure' })
    });
    data = await res.json();
    assert.strictEqual(data.success, true, 'Password change should succeed');
    assert.strictEqual(data.mustChangePassword, false);

    // Restore password back to 123456 with mustChangePassword=true after test so user gets fresh experience
    // (we'll do that in finally block)

    // 3. Test Upload QRIS Image (.png) and Decode
    console.log('3️⃣ Testing QRIS Image Upload & EMVCo Decoder...');
    const sampleStaticQris = createSampleStaticDanaQris('TOKO DANA BERKAH', 'BANDUNG');
    const samplePngBuffer = await generateQrPngBuffer(sampleStaticQris);

    const formData = new FormData();
    const blob = new Blob([samplePngBuffer], { type: 'image/png' });
    formData.append('qrisImage', blob, 'dana-qris.png');

    res = await fetch(`${baseUrl}/api/admin/qris/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: formData
    });
    data = await res.json();
    assert.strictEqual(data.success, true, 'QRIS image upload should succeed');
    assert.strictEqual(data.qris.merchantName, 'TOKO DANA BERKAH');
    assert.strictEqual(data.setup.hasQris, true);

    // 4. Test Android Device Connection to Port 2020 -> Pairing Code -> Dashboard Confirm Pair
    console.log('4️⃣ Testing Android App Connection on Port 2020 & Pairing Code Flow...');
    const wsClient = new WebSocket(pairUrl);
    const pairCodeMsg = await new Promise((resolve, reject) => {
      wsClient.on('open', () => {
        wsClient.send(
          JSON.stringify({
            type: 'HELLO',
            deviceId: 'android_hp_1',
            deviceName: 'Xiaomi Redmi Note 12',
            model: '23021RAA2Y',
            androidVersion: '13'
          })
        );
      });
      wsClient.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'PAIR_CODE') resolve(msg);
      });
      wsClient.on('error', reject);
    });

    assert.ok(pairCodeMsg.pairCode && pairCodeMsg.pairCode.length === 6, 'Should receive 6-digit pairCode');
    console.log(`   📱 Received Pairing Code on Android: ${pairCodeMsg.pairCode}`);

    // Confirm Pairing Code from Dashboard
    const pairedPromise = new Promise((resolve) => {
      wsClient.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'PAIRED') resolve(msg);
      });
    });

    res = await fetch(`${baseUrl}/api/admin/pair/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        pairCode: pairCodeMsg.pairCode,
        deviceName: 'HP Kasir Utama'
      })
    });
    data = await res.json();
    assert.strictEqual(data.success, true, 'Pairing confirmation should succeed');
    assert.strictEqual(data.setup.ready, true, 'Setup should now be completely READY');

    const pairedWsPush = await pairedPromise;
    assert.strictEqual(pairedWsPush.paired, true, 'Android device should receive instant PAIRED push');

    // 5. Test POST /api/transaction/create
    console.log('5️⃣ Testing POST /api/transaction/create (Dynamic QRIS & Unique Nominal)...');
    const apiKey = store.state.config.apiKey;
    res = await fetch(`${baseUrl}/api/transaction/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        amount: 1000000,
        customer_name: 'Nama Pelanggan',
        customer_email: 'emailpelanggan@domain.com',
        customer_phone: '081234567890',
        order_items: [
          {
            sku: 'PRODUK1',
            name: 'Nama Produk 1',
            price: 500000,
            quantity: 1
          },
          {
            sku: 'PRODUK2',
            name: 'Nama Produk 2',
            price: 500000,
            quantity: 1
          }
        ],
        return_url: 'https://domainanda.com/redirect',
        expired_time: 10 * 60
      })
    });
    const createResp = await res.json();
    assert.strictEqual(createResp.success, true);
    assert.strictEqual(createResp.data.amount_received, 1000000);
    assert.ok(createResp.data.amount > 1000000, 'Amount must include unique code');
    assert.strictEqual(createResp.data.status, 'UNPAID');
    assert.strictEqual(createResp.data.expired_time, 600);
    assert.strictEqual(createResp.data.order_items[0].subtotal, 500000);
    assert.strictEqual(createResp.data.order_items[1].subtotal, 500000);
    assert.ok(createResp.data.qr_url.endsWith(`/qris/${createResp.data.pay_code}.png`));

    const payCode = createResp.data.pay_code;
    const expectedUniqueAmount = createResp.data.amount;
    console.log(`   💳 Created Transaction pay_code=${payCode}, amount=${expectedUniqueAmount}`);

    // Verify Dynamic QRIS Image URL serves a scannable QR code containing the exact dynamic amount
    const qrImgRes = await fetch(createResp.data.qr_url);
    assert.strictEqual(qrImgRes.status, 200);
    const qrArrBuf = await qrImgRes.arrayBuffer();
    const decodedDynamicQris = await decodeQrisFromImageBuffer(Buffer.from(qrArrBuf));
    const expectedTag54 = `5407${expectedUniqueAmount}`;
    assert.ok(
      decodedDynamicQris.includes(expectedTag54),
      `Decoded Dynamic QRIS should contain ${expectedTag54}`
    );
    console.log('   ✅ Verified Dynamic QRIS PNG image contains recoded nominal tag:', expectedTag54);

    // 6. Test GET /api/transaction/check-status while UNPAID
    console.log('6️⃣ Testing GET /api/transaction/check-status (UNPAID)...');
    res = await fetch(`${baseUrl}/api/transaction/check-status?pay_code=${payCode}'`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    let statusResp = await res.json();
    assert.strictEqual(statusResp.success, true);
    assert.strictEqual(statusResp.status, 'unpaid');

    // 7. Send Real DANA Bisnis Notification from Android Device over Port 2020
    const formattedDots = expectedUniqueAmount.toLocaleString('id-ID'); // e.g. "1.000.232"
    const danaText = `Rp${formattedDots} diterima DANA Bisnis`;
    console.log(`7️⃣ Sending DANA Bisnis Notification from Android: "${danaText}"...`);

    const ackPromise = new Promise((resolve) => {
      wsClient.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'NOTIFICATION_ACK') resolve(msg);
      });
    });

    wsClient.send(
      JSON.stringify({
        type: 'NOTIFICATION',
        deviceId: 'android_hp_1',
        pkg: 'id.dana',
        title: 'Pembayaran Masuk',
        text: danaText
      })
    );

    const notifAck = await ackPromise;
    assert.strictEqual(notifAck.matched, true, 'Notification should match the UNPAID transaction');
    assert.strictEqual(notifAck.pay_code, payCode);

    // 8. Test GET /api/transaction/check-status after payment -> PAID
    console.log('8️⃣ Verifying GET /api/transaction/check-status is now PAID...');
    res = await fetch(`${baseUrl}/api/transaction/check-status?pay_code=${payCode}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    statusResp = await res.json();
    assert.strictEqual(statusResp.success, true);
    assert.strictEqual(statusResp.status, 'paid');
    assert.strictEqual(statusResp.message, 'Status transaksi saat ini PAID');

    wsClient.close();
    console.log('🎉 ALL E2E SERVER TESTS PASSED 100%!');
  } finally {
    // Reset db.json to clean initial state (Default PW 123456 & mustChangePassword: true)
    store.changePassword('123456');
    store.state.auth.mustChangePassword = true;
    store.state.config.pairPort = 2020;
    store.state.config.httpPort = 8080;
    store.state.pairedDevices = [];
    store.state.transactions = [];
    store.state.notificationLogs = [];
    store.state.config.qris = { raw: '', merchantName: '', merchantCity: '', nmid: '', uploadedAt: null };
    store.save();

    httpServer.close();
    if (pairServer.httpServer) pairServer.httpServer.close();
  }
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ E2E Test Failed:', err);
  process.exit(1);
});
