(() => {
  let sessionToken = localStorage.getItem('dqb_session_token') || '';
  let currentOverview = null;
  let ws = null;
  let currentTab = 'setup';
  let hasAutoSwitchedInitialTab = false;

  let activeCreateLang = 'spec';
  let activeStatusLang = 'spec';

  const DEFAULT_CREATE_BODY = {
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
    expired_time: 600
  };

  const TAB_META = {
    setup: {
      title: 'Konfigurasi QRIS & Terminal Android',
      subtitle: 'Lengkapi upload QRIS Statis dan tautkan perangkat Android menggunakan Code Pair.'
    },
    apidocs: {
      title: 'Dokumentasi Resmi REST API & Interactive Playground',
      subtitle: 'Salin kode integrasi multi-bahasa atau uji coba endpoint API langsung dari browser.'
    },
    settings: {
      title: 'Pengaturan Kredensial API, Kode Unik & Webhook',
      subtitle: 'Kelola Bearer API Key, rentang nominal unik, dan URL callback Webhook.'
    },
    transactions: {
      title: 'Riwayat Transaksi & Monitor Notifikasi DANA',
      subtitle: 'Pantau transaksi QRIS Dinamis dan stream notifikasi masuk dari perangkat Android secara real-time.'
    }
  };

  const loginScreen = document.getElementById('loginScreen');
  const changePwScreen = document.getElementById('changePwScreen');
  const dashboardScreen = document.getElementById('dashboardScreen');

  function showToast(msg, type = 'info') {
    const container = document.getElementById('toastContainer');
    const el = document.createElement('div');
    el.className = 'toast';
    if (type === 'success') el.style.borderLeftColor = '#10b981';
    if (type === 'error') el.style.borderLeftColor = '#ef4444';
    if (type === 'warn') el.style.borderLeftColor = '#f59e0b';
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
      el.remove();
    }, 4000);
  }

  function copyText(text, label = 'Teks') {
    navigator.clipboard.writeText(text);
    showToast(`${label} berhasil disalin ke clipboard!`, 'success');
  }

  window.switchPortalTab = (tabName) => {
    currentTab = tabName;
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-nav') === tabName);
    });

    document.getElementById('viewSetup').classList.toggle('hidden', tabName !== 'setup');
    document.getElementById('viewApidocs').classList.toggle('hidden', tabName !== 'apidocs');
    document.getElementById('viewSettings').classList.toggle('hidden', tabName !== 'settings');
    document.getElementById('viewTransactions').classList.toggle('hidden', tabName !== 'transactions');

    const meta = TAB_META[tabName] || TAB_META.setup;
    document.getElementById('pageHeaderTitle').textContent = meta.title;
    document.getElementById('pageHeaderSubtitle').textContent = meta.subtitle;
  };

  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.switchPortalTab(btn.getAttribute('data-nav'));
    });
  });

  async function apiCall(path, options = {}) {
    const headers = options.headers || {};
    if (sessionToken) {
      headers['Authorization'] = 'Bearer ' + sessionToken;
    }
    if (!(options.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(path, { ...options, headers });
    const data = await res.json();
    if (res.status === 401 && path !== '/api/admin/login') {
      sessionToken = '';
      localStorage.removeItem('dqb_session_token');
      showScreen('login');
      throw new Error(data.message || 'Sesi berakhir');
    }
    return { status: res.status, data };
  }

  function showScreen(screenName) {
    loginScreen.classList.add('hidden');
    changePwScreen.classList.add('hidden');
    dashboardScreen.classList.add('hidden');

    if (screenName === 'login') loginScreen.classList.remove('hidden');
    if (screenName === 'changePw') changePwScreen.classList.remove('hidden');
    if (screenName === 'dashboard') dashboardScreen.classList.remove('hidden');
  }

  function connectDashboardWebSocket() {
    if (ws) {
      try { ws.close(); } catch (_) {}
    }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws/dashboard`);
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.event === 'transaction_paid') {
          showToast(
            `PEMBAYARAN DITERIMA! Transaksi #${msg.payload.transaction.pay_code} (Rp${Number(
              msg.payload.transaction.amount
            ).toLocaleString('id-ID')}) kini berstatus PAID!`,
            'success'
          );
          const currentTestedPayCode = document.getElementById('testStatusPayCodeInput').value.trim();
          if (currentTestedPayCode === msg.payload.transaction.pay_code) {
            runCheckStatusTest(currentTestedPayCode, true);
          }
        } else if (msg.event === 'pending_device') {
          showToast(
            `HP Android terdeteksi di Port Pairing! Code Pair: ${msg.payload.device.pairCode}`,
            'info'
          );
        } else if (msg.event === 'device_paired') {
          showToast(`Perangkat ${msg.payload.device.deviceName} berhasil terhubung!`, 'success');
        }
        loadOverview();
      } catch (_) {}
    };
    ws.onclose = () => {
      setTimeout(() => {
        if (sessionToken) connectDashboardWebSocket();
      }, 4000);
    };
  }

  function getBaseUrl(config) {
    return config && config.publicHost && config.publicHost.trim()
      ? config.publicHost.trim().replace(/\/+$/, '')
      : location.origin;
  }

  function buildCreateSnippet(lang, baseUrl, apiKey) {
    const endpoint = `${baseUrl}/api/transaction/create`;
    if (lang === 'spec') {
      return `POST ${endpoint}
Header: { 'Authorization': 'Bearer ' + '${apiKey}' }

Body Payload:
{
  "amount": 1000000,
  "customer_name": "Nama Pelanggan",
  "customer_email": "emailpelanggan@domain.com",
  "customer_phone": "081234567890",
  "order_items": [
    {
      "sku": "PRODUK1",
      "name": "Nama Produk 1",
      "price": 500000,
      "quantity": 1
    },
    {
      "sku": "PRODUK2",
      "name": "Nama Produk 2",
      "price": 500000,
      "quantity": 1
    }
  ],
  "return_url": "https://domainanda.com/redirect",
  "expired_time": 600
}`;
    }
    if (lang === 'curl') {
      return `curl -X POST "${endpoint}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -d '${JSON.stringify(DEFAULT_CREATE_BODY, null, 2)}'`;
    }
    if (lang === 'node') {
      return `const response = await fetch('${endpoint}', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + '${apiKey}'
  },
  body: JSON.stringify(${JSON.stringify(DEFAULT_CREATE_BODY, null, 2)})
});

const result = await response.json();
console.log(result);`;
    }
    if (lang === 'php') {
      return `<?php
$apiKey = '${apiKey}';
$payload = ${JSON.stringify(DEFAULT_CREATE_BODY, null, 2)};

$ch = curl_init('${endpoint}');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
curl_setopt($ch, CURLOPT_HTTPHEADER, [
  'Content-Type: application/json',
  'Authorization: Bearer ' . $apiKey
]);

$response = curl_exec($ch);
curl_close($ch);
echo $response;`;
    }
    return '';
  }

  function buildStatusSnippet(lang, baseUrl, apiKey, payCode = '57585748548596587') {
    const endpoint = `${baseUrl}/api/transaction/check-status?pay_code=${payCode}`;
    if (lang === 'spec') {
      return `GET ${endpoint}
Header: { 'Authorization': 'Bearer ' + '${apiKey}' }`;
    }
    if (lang === 'curl') {
      return `curl -X GET "${endpoint}" \\
  -H "Authorization: Bearer ${apiKey}"`;
    }
    if (lang === 'node') {
      return `const response = await fetch('${endpoint}', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer ' + '${apiKey}'
  }
});

const result = await response.json();
console.log(result);`;
    }
    if (lang === 'php') {
      return `<?php
$apiKey = '${apiKey}';
$ch = curl_init('${endpoint}');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
  'Authorization: Bearer ' . $apiKey
]);

$response = curl_exec($ch);
curl_close($ch);
echo $response;`;
    }
    return '';
  }

  function renderApiDocumentation(config) {
    const baseUrl = getBaseUrl(config);
    const apiKey = config.apiKey || '';
    const samplePayCode =
      (document.getElementById('testStatusPayCodeInput').value || '').trim() || '57585748548596587';

    document.getElementById('docCreateUrlText').textContent = `${baseUrl}/api/transaction/create`;
    document.getElementById('docStatusUrlText').textContent = `${baseUrl}/api/transaction/check-status?pay_code=${samplePayCode}`;

    document.getElementById('docCreateCodePre').textContent = buildCreateSnippet(
      activeCreateLang,
      baseUrl,
      apiKey
    );

    const createSampleResponse = {
      success: true,
      message: '',
      data: {
        customer_name: 'Nama Pelanggan',
        customer_email: 'emailpelanggan@domain.com',
        customer_phone: '081234567890',
        callback_url: 'https://domainanda.com/callback',
        return_url: 'https://domainanda.com/redirect',
        amount: 1000042,
        amount_received: 1000000,
        pay_code: '57585748548596587',
        status: 'UNPAID',
        expired_time: 600,
        order_items: [
          {
            sku: 'PRODUK1',
            name: 'Nama Produk 1',
            price: 500000,
            quantity: 1,
            subtotal: 500000
          },
          {
            sku: 'PRODUK2',
            name: 'Nama Produk 2',
            price: 500000,
            quantity: 1,
            subtotal: 500000
          }
        ],
        qr_url: `${baseUrl}/qris/57585748548596587.png`
      }
    };
    document.getElementById('docCreateSampleRespPre').textContent = JSON.stringify(
      createSampleResponse,
      null,
      2
    );

    document.getElementById('docStatusCodePre').textContent = buildStatusSnippet(
      activeStatusLang,
      baseUrl,
      apiKey,
      samplePayCode
    );

    const statusSampleResponse = {
      success: true,
      status: 'paid',
      message: 'Status transaksi saat ini PAID'
    };
    document.getElementById('docStatusSampleRespPre').textContent =
      JSON.stringify(statusSampleResponse, null, 2) +
      '\n// Nilai field "status": "paid", "unpaid", atau "expired"';

    const createTextarea = document.getElementById('testCreateBodyInput');
    if (!createTextarea.value.trim()) {
      createTextarea.value = JSON.stringify(DEFAULT_CREATE_BODY, null, 2);
    }
  }

  function renderOverview(data) {
    currentOverview = data;
    const { setup, config, lanIps, pairedDevices, pendingDevices, transactions, notificationLogs } = data;

    const primaryIp = (lanIps && lanIps[0]) || location.hostname;
    document.getElementById('navLanIp').textContent = lanIps.join(', ');
    document.getElementById('navPairPort').textContent = config.pairPort;
    document.getElementById('navHttpPort').textContent = config.httpPort;
    document.getElementById('pairGuideIp').textContent = primaryIp;
    document.getElementById('pairGuidePort').textContent = config.pairPort;
    document.getElementById('logPortLabel').textContent = config.pairPort;
    document.getElementById('kpiPairPort').textContent = config.pairPort;

    // KPI Cards
    const paidTxs = (transactions || []).filter((t) => t.status === 'PAID');
    const unpaidTxs = (transactions || []).filter((t) => t.status === 'UNPAID');
    const totalVolume = paidTxs.reduce((acc, t) => acc + Number(t.amount || 0), 0);

    document.getElementById('kpiDeviceCount').textContent = `${pairedDevices.length} Perangkat`;
    document.getElementById('kpiPaidCount').textContent = `${paidTxs.length} Transaksi`;
    document.getElementById('kpiPendingCount').textContent = `${unpaidTxs.length} menunggu pembayaran`;
    document.getElementById('kpiTotalVolume').textContent = `Rp${totalVolume.toLocaleString('id-ID')}`;
    document.getElementById('navBadgeTxCount').textContent = String((transactions || []).length);

    if (setup.ready) {
      document.getElementById('kpiGatewayStatus').textContent = 'Aktif & Siap';
      document.getElementById('kpiGatewayStatus').style.color = 'var(--status-success-text)';
      document.getElementById('kpiMerchantSub').textContent = config.qris.merchantName || 'DANA Bisnis';
      document.getElementById('navBadgeSetup').textContent = '✓ Siap';
      document.getElementById('navBadgeDocs').textContent = 'Ready';
      document.getElementById('navBadgeSettings').textContent = 'Ready';
    } else {
      document.getElementById('kpiGatewayStatus').textContent = 'Menunggu Setup';
      document.getElementById('kpiGatewayStatus').style.color = 'var(--status-warn-text)';
      document.getElementById('kpiMerchantSub').textContent = 'Selesaikan Step 1 & 2';
      document.getElementById('navBadgeSetup').textContent = 'Wajib';
      document.getElementById('navBadgeDocs').textContent = '🔒';
      document.getElementById('navBadgeSettings').textContent = '🔒';
    }

    // Step 1 Badge (QRIS)
    const stepQrisBadge = document.getElementById('stepQrisBadge');
    const qrisStatusBadge = document.getElementById('qrisStatusBadge');
    if (setup.hasQris) {
      stepQrisBadge.className = 'step-pill done';
      document.getElementById('stepQrisIcon').textContent = '✓';
      qrisStatusBadge.className = 'status-badge complete';
      qrisStatusBadge.textContent = 'Terverifikasi';

      document.getElementById('qrisPreviewBox').classList.remove('hidden');
      document.getElementById('qrisPreviewImg').src = config.qrisPreviewDataUrl || '';
      document.getElementById('qrisMerchantName').textContent = config.qris.merchantName || 'DANA Bisnis';
      document.getElementById('qrisMerchantCity').textContent = config.qris.merchantCity || 'INDONESIA';
      document.getElementById('qrisNmid').textContent = config.qris.nmid || '-';
      document.getElementById('qrisRawInput').value = config.qris.raw || '';
    } else {
      stepQrisBadge.className = 'step-pill pending';
      document.getElementById('stepQrisIcon').textContent = '⏳';
      qrisStatusBadge.className = 'status-badge required';
      qrisStatusBadge.textContent = 'Wajib (Required)';
      document.getElementById('qrisPreviewBox').classList.add('hidden');
    }

    // Step 2 Badge (Paired Devices)
    const stepPairBadge = document.getElementById('stepPairBadge');
    const pairStatusBadge = document.getElementById('pairStatusBadge');
    if (setup.hasPairedDevice) {
      stepPairBadge.className = 'step-pill done';
      document.getElementById('stepPairIcon').textContent = '✓';
      pairStatusBadge.className = 'status-badge complete';
      pairStatusBadge.textContent = `${pairedDevices.length} HP Terhubung`;
    } else {
      stepPairBadge.className = 'step-pill pending';
      document.getElementById('stepPairIcon').textContent = '⏳';
      pairStatusBadge.className = 'status-badge required';
      pairStatusBadge.textContent = 'Wajib (Required)';
    }

    // Pending Devices waiting on Port 2020
    const pendingWrap = document.getElementById('pendingDevicesWrap');
    const pendingList = document.getElementById('pendingDevicesList');
    if (pendingDevices && pendingDevices.length > 0) {
      pendingWrap.classList.remove('hidden');
      pendingList.innerHTML = pendingDevices
        .map(
          (dev) => `
        <div class="device-item">
          <div>
            <div style="font-weight: 700; font-size: 13.5px; display: flex; align-items: center; gap: 8px;">
              <span>${dev.deviceName || dev.model}</span>
              <span class="pair-code-chip">${dev.pairCode}</span>
            </div>
            <div style="font-size: 12px; color: var(--text-muted);">Android ${dev.androidVersion || '-'} • IP: ${dev.ip || '-'}</div>
          </div>
          <button type="button" class="btn btn-success btn-sm" onclick="window.quickPairDevice('${dev.pairCode}', '${(dev.deviceName || dev.model || '').replace(/'/g, '')}')">
            Setujui &amp; Pair (${dev.pairCode})
          </button>
        </div>`
        )
        .join('');
    } else {
      pendingWrap.classList.add('hidden');
      pendingList.innerHTML = '';
    }

    // Paired Devices List
    const pairedList = document.getElementById('pairedDevicesList');
    if (pairedDevices && pairedDevices.length > 0) {
      pairedList.innerHTML = pairedDevices
        .map(
          (dev) => `
        <div class="device-item">
          <div>
            <div style="font-weight: 700; font-size: 13.5px; display: flex; align-items: center; gap: 8px;">
              <span class="status-badge ${dev.status === 'ONLINE' ? 'complete' : 'required'}">${dev.status || 'PAIRED'}</span>
              <span>${dev.deviceName || dev.model}</span>
              <span class="pair-code-chip">${dev.pairCode}</span>
            </div>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
              Model: ${dev.model || 'Android'} • Notifikasi Diterima: <strong>${dev.notificationCount || 0}</strong>
            </div>
          </div>
          <button type="button" class="btn btn-danger btn-sm" onclick="window.removePairedDevice('${dev.deviceId}')">Putuskan</button>
        </div>`
        )
        .join('');
    } else {
      pairedList.innerHTML = `<div style="font-size: 13px; color: var(--text-muted); padding: 8px 0;">Belum ada terminal Android yang ditautkan.</div>`;
    }

    // Unlock API Docs & Settings when setup.ready
    if (setup.ready) {
      document.getElementById('docsLockedBox').classList.add('hidden');
      document.getElementById('docsUnlockedContent').classList.remove('hidden');
      document.getElementById('settingsLockedBox').classList.add('hidden');
      document.getElementById('settingsUnlockedContent').classList.remove('hidden');

      document.getElementById('cfgApiKey').value = config.apiKey || '';
      document.getElementById('cfgPairPort').value = config.pairPort || 2020;
      document.getElementById('cfgHttpPort').value = config.httpPort || 8080;
      document.getElementById('cfgUniqueMin').value = config.uniqueCodeMin || 1;
      document.getElementById('cfgUniqueMax').value = config.uniqueCodeMax || 99;
      document.getElementById('cfgPublicHost').value = config.publicHost || '';
      document.getElementById('cfgWebhookUrl').value = config.webhookUrl || '';
      document.getElementById('cfgWebhookSecret').value = config.webhookSecret || '';

      renderApiDocumentation(config);

      if (!hasAutoSwitchedInitialTab) {
        hasAutoSwitchedInitialTab = true;
      }
    } else {
      document.getElementById('docsLockedBox').classList.remove('hidden');
      document.getElementById('docsUnlockedContent').classList.add('hidden');
      document.getElementById('settingsLockedBox').classList.remove('hidden');
      document.getElementById('settingsUnlockedContent').classList.add('hidden');
    }

    // Recent Transactions Dropdown in Check-Status Tester
    const recentSelect = document.getElementById('testStatusRecentSelect');
    const currentPayCodeVal = document.getElementById('testStatusPayCodeInput').value.trim();
    if (transactions && transactions.length > 0) {
      recentSelect.innerHTML =
        `<option value="">-- Pilih Transaksi (${transactions.length}) --</option>` +
        transactions
          .slice(0, 20)
          .map(
            (tx) =>
              `<option value="${tx.pay_code}" ${tx.pay_code === currentPayCodeVal ? 'selected' : ''}>#${tx.pay_code.slice(-6)} — Rp${Number(tx.amount).toLocaleString('id-ID')} (${tx.status})</option>`
          )
          .join('');

      if (!currentPayCodeVal) {
        document.getElementById('testStatusPayCodeInput').value = transactions[0].pay_code;
        updateStatusQuickSimBar(transactions[0].pay_code);
      } else {
        updateStatusQuickSimBar(currentPayCodeVal);
      }
    } else {
      recentSelect.innerHTML = `<option value="">-- Belum Ada Transaksi --</option>`;
    }

    // Render Transactions Table
    const txBody = document.getElementById('transactionsTableBody');
    if (transactions && transactions.length > 0) {
      txBody.innerHTML = transactions
        .slice(0, 30)
        .map((tx) => {
          const badgeClass =
            tx.status === 'PAID' ? 'complete' : tx.status === 'UNPAID' ? 'required' : 'expired';
          return `
          <tr>
            <td style="font-family: var(--font-mono); font-weight: 700;">${tx.pay_code}</td>
            <td>
              <strong>${tx.customer_name}</strong><br/>
              <span style="font-size: 11.5px; color: var(--text-muted);">${tx.customer_phone || tx.customer_email || '-'}</span>
            </td>
            <td>
              <strong style="color: var(--bank-blue-dark); font-family: var(--font-mono);">Rp${Number(tx.amount).toLocaleString('id-ID')}</strong><br/>
              <span style="font-size: 11px; color: var(--text-muted);">Pokok: Rp${Number(tx.amount_received).toLocaleString('id-ID')} (+${tx.unique_code || tx.amount - tx.amount_received})</span>
            </td>
            <td><span class="status-badge ${badgeClass}">${tx.status}</span></td>
            <td>
              <div class="input-row">
                <a href="${tx.qr_url}" target="_blank" class="btn btn-outline btn-sm">QRIS</a>
                <button type="button" class="btn btn-outline btn-sm" onclick="window.selectPayCodeForStatusTest('${tx.pay_code}')">Test Status</button>
                ${
                  tx.status === 'UNPAID'
                    ? `<button type="button" class="btn btn-success btn-sm" onclick="window.simulateDanaPay(${tx.amount}, '${tx.pay_code}')">Simulasi Bayar</button>`
                    : ''
                }
              </div>
            </td>
          </tr>`;
        })
        .join('');
    } else {
      txBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Belum ada transaksi</td></tr>`;
    }

    // Render Notification Logs Table
    const notifBody = document.getElementById('notificationsTableBody');
    if (notificationLogs && notificationLogs.length > 0) {
      notifBody.innerHTML = notificationLogs
        .slice(0, 30)
        .map((n) => {
          const timeStr = new Date(n.timestamp).toLocaleTimeString('id-ID');
          return `
          <tr>
            <td style="font-size: 12px; color: var(--text-muted); font-family: var(--font-mono);">${timeStr}</td>
            <td><strong>${n.deviceName}</strong></td>
            <td>
              <strong>${n.title}</strong><br/>
              <span style="font-size: 12px; color: var(--text-secondary);">${n.text}</span>
            </td>
            <td style="font-weight: 700; color: var(--status-success-text); font-family: var(--font-mono);">Rp${Number(n.amount || 0).toLocaleString('id-ID')}</td>
            <td>
              ${
                n.matchedPayCode
                  ? `<span class="status-badge complete">MATCH #${n.matchedPayCode.slice(-5)}</span>`
                  : `<span class="status-badge required">NO MATCH</span>`
              }
            </td>
          </tr>`;
        })
        .join('');
    } else {
      notifBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Belum ada notifikasi DANA masuk</td></tr>`;
    }
  }

  function updateStatusQuickSimBar(payCode) {
    const bar = document.getElementById('testStatusQuickSimBar');
    if (!currentOverview || !currentOverview.transactions || !payCode) {
      bar.classList.add('hidden');
      return;
    }
    const tx = currentOverview.transactions.find((t) => t.pay_code === payCode.trim());
    if (tx && tx.status === 'UNPAID') {
      bar.classList.remove('hidden');
      const btn = document.getElementById('btnSimulateFromStatusTester');
      btn.textContent = `🔔 Simulasikan Notifikasi DANA "Rp${Number(tx.amount).toLocaleString('id-ID')} diterima DANA Bisnis"`;
      btn.onclick = () => window.simulateDanaPay(tx.amount, tx.pay_code);
    } else {
      bar.classList.add('hidden');
    }
  }

  async function loadOverview() {
    try {
      const { data } = await apiCall('/api/admin/overview');
      if (data.mustChangePassword) {
        showScreen('changePw');
        return;
      }
      showScreen('dashboard');
      renderOverview(data);
    } catch (_) {
      showScreen('login');
    }
  }

  // ==========================================================================
  // INTERACTIVE API TESTER FUNCTIONS
  // ==========================================================================

  async function runCreateTransactionTest() {
    if (!currentOverview || !currentOverview.config) return;
    const apiKey = currentOverview.config.apiKey;
    const rawBody = document.getElementById('testCreateBodyInput').value.trim();

    let parsedBody;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch (err) {
      showToast('Format JSON Request Body tidak valid: ' + err.message, 'error');
      return;
    }

    const btn = document.getElementById('btnRunTestCreate');
    const origText = btn.textContent;
    btn.textContent = '⏳ Mengeksekusi...';
    btn.disabled = true;

    const startTime = performance.now();
    try {
      const res = await fetch('/api/transaction/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify(parsedBody)
      });
      const elapsedMs = Math.round(performance.now() - startTime);
      const result = await res.json();

      const metaBadge = document.getElementById('testCreateMetaBadge');
      metaBadge.classList.remove('hidden');
      metaBadge.className = `http-status-pill ${res.ok && result.success ? 'ok' : 'err'}`;
      metaBadge.textContent = `HTTP ${res.status} ${res.ok ? 'OK' : 'ERROR'} • ${elapsedMs} ms`;

      document.getElementById('testCreateLiveRespPre').textContent = JSON.stringify(result, null, 2);

      if (result.success && result.data) {
        const tx = result.data;
        document.getElementById('testStatusPayCodeInput').value = tx.pay_code;

        const card = document.getElementById('testCreateInteractiveCard');
        card.classList.remove('hidden');
        card.innerHTML = `
          <div style="display: flex; gap: 16px; align-items: center; flex-wrap: wrap;">
            <img src="${tx.qr_url}" alt="QRIS Dinamis" style="width: 104px; height: 104px; border-radius: 8px; background: #fff; padding: 4px; border: 1px solid var(--border-subtle);" />
            <div style="flex: 1; min-width: 200px;">
              <div style="font-size: 12px; color: var(--bank-blue-dark); font-family: var(--font-mono); font-weight: 700;">
                pay_code: ${tx.pay_code}
              </div>
              <div style="font-size: 16px; font-weight: 800; color: var(--status-success-text); margin: 2px 0;">
                Total QRIS Dinamis: Rp${Number(tx.amount).toLocaleString('id-ID')}
              </div>
              <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 10px;">
                Nominal Pokok: Rp${Number(tx.amount_received).toLocaleString('id-ID')} • Status: <strong>${tx.status}</strong>
              </div>
              <div class="input-row" style="flex-wrap: wrap;">
                <button type="button" class="btn btn-success btn-sm" onclick="window.simulateDanaPay(${tx.amount}, '${tx.pay_code}')">
                  🔔 Simulasi Notifikasi DANA Masuk (Rp${Number(tx.amount).toLocaleString('id-ID')})
                </button>
                <button type="button" class="btn btn-outline btn-sm" onclick="window.selectPayCodeForStatusTest('${tx.pay_code}')">
                  🔍 Uji Cek Status di Bawah
                </button>
              </div>
            </div>
          </div>
        `;
        showToast(`Transaksi #${tx.pay_code} berhasil dibuat!`, 'success');
        await loadOverview();
      } else {
        showToast(result.message || 'Request gagal', 'error');
      }
    } catch (err) {
      showToast('Gagal mengeksekusi test API: ' + err.message, 'error');
    } finally {
      btn.textContent = origText;
      btn.disabled = false;
    }
  }

  async function runCheckStatusTest(overridePayCode = null, silent = false) {
    if (!currentOverview || !currentOverview.config) return;
    const apiKey = currentOverview.config.apiKey;
    const payCode = (overridePayCode || document.getElementById('testStatusPayCodeInput').value || '').trim();

    if (!payCode) {
      if (!silent) showToast('Masukkan pay_code terlebih dahulu atau buat transaksi test di atas!', 'warn');
      return;
    }

    document.getElementById('testStatusPayCodeInput').value = payCode;
    renderApiDocumentation(currentOverview.config);

    const btn = document.getElementById('btnRunTestStatus');
    const origText = btn.textContent;
    btn.textContent = '⏳ Mengecek...';
    btn.disabled = true;

    const startTime = performance.now();
    try {
      const res = await fetch(`/api/transaction/check-status?pay_code=${encodeURIComponent(payCode)}`, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + apiKey
        }
      });
      const elapsedMs = Math.round(performance.now() - startTime);
      const result = await res.json();

      const metaBadge = document.getElementById('testStatusMetaBadge');
      metaBadge.classList.remove('hidden');
      metaBadge.className = `http-status-pill ${res.ok && result.success ? 'ok' : 'err'}`;
      metaBadge.textContent = `HTTP ${res.status} • status: "${result.status || '-'}" • ${elapsedMs} ms`;

      document.getElementById('testStatusLiveRespPre').textContent = JSON.stringify(result, null, 2);
      updateStatusQuickSimBar(payCode);

      if (!silent) {
        showToast(
          `Hasil Cek Status: ${result.message || result.status}`,
          result.status === 'paid' ? 'success' : 'info'
        );
      }
    } catch (err) {
      if (!silent) showToast('Gagal mengecek status: ' + err.message, 'error');
    } finally {
      btn.textContent = origText;
      btn.disabled = false;
    }
  }

  // Global Actions
  window.quickPairDevice = async (pairCode, deviceName) => {
    try {
      const { data } = await apiCall('/api/admin/pair/confirm', {
        method: 'POST',
        body: JSON.stringify({ pairCode, deviceName })
      });
      if (data.success) {
        showToast(data.message, 'success');
        loadOverview();
      } else {
        showToast(data.message || 'Gagal melakukan pair', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.removePairedDevice = async (deviceId) => {
    try {
      const { data } = await apiCall(`/api/admin/devices/${encodeURIComponent(deviceId)}`, {
        method: 'DELETE'
      });
      if (data.success) {
        showToast(data.message, 'info');
        loadOverview();
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.simulateDanaPay = async (amount, payCode = '') => {
    try {
      const { data } = await apiCall('/api/admin/simulate/notification', {
        method: 'POST',
        body: JSON.stringify({
          amount,
          title: 'Pembayaran Masuk',
          text: `Rp${Number(amount).toLocaleString('id-ID')} diterima DANA Bisnis`
        })
      });
      if (data.success) {
        showToast(data.message, data.matched ? 'success' : 'warn');
        await loadOverview();
        const targetPayCode = payCode || data.pay_code || document.getElementById('testStatusPayCodeInput').value.trim();
        if (targetPayCode) {
          await runCheckStatusTest(targetPayCode, true);
        }
      } else {
        showToast(data.message, 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.selectPayCodeForStatusTest = (payCode) => {
    window.switchPortalTab('apidocs');
    const input = document.getElementById('testStatusPayCodeInput');
    input.value = payCode;
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    runCheckStatusTest(payCode, false);
  };

  // Code Snippet Tab Switching
  document.querySelectorAll('.code-tab').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      const target = tabBtn.getAttribute('data-target');
      const lang = tabBtn.getAttribute('data-lang');

      document
        .querySelectorAll(`.code-tab[data-target="${target}"]`)
        .forEach((b) => b.classList.remove('active'));
      tabBtn.classList.add('active');

      if (target === 'create') activeCreateLang = lang;
      if (target === 'status') activeStatusLang = lang;

      if (currentOverview && currentOverview.config) {
        renderApiDocumentation(currentOverview.config);
      }
    });
  });

  // Copy Buttons
  document.getElementById('btnCopyCreateUrl').addEventListener('click', () => {
    copyText(document.getElementById('docCreateUrlText').textContent, 'URL Endpoint Create');
  });
  document.getElementById('btnCopyStatusUrl').addEventListener('click', () => {
    copyText(document.getElementById('docStatusUrlText').textContent, 'URL Endpoint Check-Status');
  });
  document.getElementById('btnCopyCreateCode').addEventListener('click', () => {
    copyText(document.getElementById('docCreateCodePre').textContent, 'Kode Request Create');
  });
  document.getElementById('btnCopyCreateSampleResp').addEventListener('click', () => {
    copyText(document.getElementById('docCreateSampleRespPre').textContent, 'Contoh Response Create');
  });
  document.getElementById('btnCopyCreateLiveResp').addEventListener('click', () => {
    copyText(document.getElementById('testCreateLiveRespPre').textContent, 'Hasil Response Create');
  });
  document.getElementById('btnCopyStatusCode').addEventListener('click', () => {
    copyText(document.getElementById('docStatusCodePre').textContent, 'Kode Request Check-Status');
  });
  document.getElementById('btnCopyStatusSampleResp').addEventListener('click', () => {
    copyText(document.getElementById('docStatusSampleRespPre').textContent, 'Contoh Response Check-Status');
  });
  document.getElementById('btnCopyStatusLiveResp').addEventListener('click', () => {
    copyText(document.getElementById('testStatusLiveRespPre').textContent, 'Hasil Response Check-Status');
  });

  // Interactive Tester Buttons
  document.getElementById('btnRunTestCreate').addEventListener('click', runCreateTransactionTest);
  document.getElementById('btnResetCreateBody').addEventListener('click', () => {
    document.getElementById('testCreateBodyInput').value = JSON.stringify(DEFAULT_CREATE_BODY, null, 2);
    showToast('Payload di-reset ke format default.', 'info');
  });

  document.getElementById('btnRunTestStatus').addEventListener('click', () => runCheckStatusTest());
  document.getElementById('testStatusRecentSelect').addEventListener('change', (e) => {
    if (e.target.value) {
      document.getElementById('testStatusPayCodeInput').value = e.target.value;
      updateStatusQuickSimBar(e.target.value);
      runCheckStatusTest(e.target.value, false);
    }
  });
  document.getElementById('testStatusPayCodeInput').addEventListener('input', (e) => {
    updateStatusQuickSimBar(e.target.value);
    if (currentOverview && currentOverview.config) {
      renderApiDocumentation(currentOverview.config);
    }
  });

  // Auth & Setup Event Listeners
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('loginPassword').value;
    try {
      const { status, data } = await apiCall('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password })
      });
      if (status !== 200 || !data.success) {
        showToast(data.message || 'Login gagal', 'error');
        return;
      }
      sessionToken = data.token;
      localStorage.setItem('dqb_session_token', sessionToken);
      document.getElementById('loginPassword').value = '';
      if (data.mustChangePassword) {
        showToast('Login pertama berhasil! Silakan ganti password default Anda.', 'warn');
        showScreen('changePw');
      } else {
        connectDashboardWebSocket();
        loadOverview();
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('changePwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmNewPassword').value;
    if (newPassword !== confirmPassword) {
      showToast('Konfirmasi password tidak cocok!', 'error');
      return;
    }
    try {
      const { status, data } = await apiCall('/api/admin/change-password', {
        method: 'POST',
        body: JSON.stringify({ newPassword })
      });
      if (status !== 200 || !data.success) {
        showToast(data.message || 'Gagal mengganti password', 'error');
        return;
      }
      showToast('Password berhasil diperbarui!', 'success');
      connectDashboardWebSocket();
      loadOverview();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btnLogout').addEventListener('click', () => {
    sessionToken = '';
    localStorage.removeItem('dqb_session_token');
    if (ws) ws.close();
    showScreen('login');
  });

  // Upload QRIS Form
  document.getElementById('qrisUploadForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fileInput = document.getElementById('qrisFileInput');
    const rawInput = document.getElementById('qrisRawInput');

    const formData = new FormData();
    if (fileInput.files && fileInput.files[0]) {
      formData.append('qrisImage', fileInput.files[0]);
    } else if (rawInput.value.trim()) {
      formData.append('qrisString', rawInput.value.trim());
    } else {
      showToast('Pilih gambar QRIS atau isi string QRIS terlebih dahulu!', 'warn');
      return;
    }

    try {
      const { status, data } = await apiCall('/api/admin/qris/upload', {
        method: 'POST',
        body: formData
      });
      if (status !== 200 || !data.success) {
        showToast(data.message || 'Gagal memproses QRIS', 'error');
        return;
      }
      showToast(data.message, 'success');
      fileInput.value = '';
      loadOverview();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btnSampleQris').addEventListener('click', async () => {
    try {
      const { data } = await apiCall('/api/admin/qris/sample', {
        method: 'POST',
        body: JSON.stringify({ merchantName: 'TOKO DANA BISNIS', merchantCity: 'JAKARTA' })
      });
      if (data.success) {
        showToast(data.message, 'success');
        loadOverview();
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Confirm Pairing Code Form
  document.getElementById('pairConfirmForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pairCode = document.getElementById('pairCodeInput').value.trim();
    const deviceName = document.getElementById('pairDeviceNameInput').value.trim();
    try {
      const { status, data } = await apiCall('/api/admin/pair/confirm', {
        method: 'POST',
        body: JSON.stringify({ pairCode, deviceName })
      });
      if (status !== 200 || !data.success) {
        showToast(data.message || 'Gagal melakukan pairing', 'error');
        return;
      }
      showToast(data.message, 'success');
      document.getElementById('pairCodeInput').value = '';
      document.getElementById('pairDeviceNameInput').value = '';
      loadOverview();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Copy & Regenerate API Key / Webhook Secret
  document.getElementById('btnCopyApiKey').addEventListener('click', () => {
    copyText(document.getElementById('cfgApiKey').value, 'API Key');
  });
  document.getElementById('btnCopyWebhookSecret').addEventListener('click', () => {
    copyText(document.getElementById('cfgWebhookSecret').value, 'Webhook Secret');
  });

  document.getElementById('btnRegenApiKey').addEventListener('click', async () => {
    const { data } = await apiCall('/api/admin/config', {
      method: 'POST',
      body: JSON.stringify({ regenerateApiKey: true })
    });
    if (data.success) {
      showToast('API Key baru berhasil dibuat!', 'success');
      loadOverview();
    }
  });

  // Server Config Form
  document.getElementById('serverConfigForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      pairPort: Number(document.getElementById('cfgPairPort').value),
      httpPort: Number(document.getElementById('cfgHttpPort').value),
      uniqueCodeMin: Number(document.getElementById('cfgUniqueMin').value),
      uniqueCodeMax: Number(document.getElementById('cfgUniqueMax').value),
      publicHost: document.getElementById('cfgPublicHost').value.trim()
    };
    const { data } = await apiCall('/api/admin/config', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (data.success) {
      showToast(data.message, 'success');
      loadOverview();
    } else {
      showToast(data.message, 'error');
    }
  });

  // Webhook Config Form & Test
  document.getElementById('webhookConfigForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const webhookUrl = document.getElementById('cfgWebhookUrl').value.trim();
    const { data } = await apiCall('/api/admin/config', {
      method: 'POST',
      body: JSON.stringify({ webhookUrl })
    });
    if (data.success) {
      showToast('Konfigurasi Webhook berhasil disimpan!', 'success');
      loadOverview();
    }
  });

  document.getElementById('btnTestWebhook').addEventListener('click', async () => {
    const webhookUrl = document.getElementById('cfgWebhookUrl').value.trim();
    const box = document.getElementById('webhookTestResultBox');
    box.classList.remove('hidden');
    box.style.color = 'var(--text-secondary)';
    box.textContent = '⏳ Mengirim test payload ke ' + (webhookUrl || '(kosong)') + '...';

    const { data } = await apiCall('/api/admin/webhook/test', {
      method: 'POST',
      body: JSON.stringify({ webhookUrl })
    });
    box.style.color = data.success ? 'var(--status-success-text)' : 'var(--status-danger-text)';
    box.textContent = data.message;
    showToast(data.message, data.success ? 'success' : 'error');
  });

  document.getElementById('btnRefreshOverview').addEventListener('click', () => loadOverview());

  // Initial check
  if (sessionToken) {
    connectDashboardWebSocket();
    loadOverview();
  } else {
    showScreen('login');
  }
})();
