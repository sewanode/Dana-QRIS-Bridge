const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { URL } = require('url');

/**
 * Send HTTP POST JSON payload to a callback/webhook URL
 */
function postJson(targetUrl, payloadObj, secret = '') {
  return new Promise((resolve) => {
    try {
      const parsedUrl = new URL(targetUrl);
      const bodyStr = JSON.stringify(payloadObj);
      const signature = secret
        ? crypto.createHmac('sha256', secret).update(bodyStr).digest('hex')
        : '';

      const isHttps = parsedUrl.protocol === 'https:';
      const transport = isHttps ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        timeout: 8000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
          'User-Agent': 'Dana-QRIS-Bridge-Webhook/1.0',
          'X-DanaBridge-Event': payloadObj.event || 'payment.paid',
          'X-DanaBridge-Signature': signature
        }
      };

      const req = transport.request(options, (res) => {
        let respData = '';
        res.on('data', (chunk) => {
          if (respData.length < 2048) respData += chunk;
        });
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            statusCode: res.statusCode,
            response: respData
          });
        });
      });

      req.on('error', (err) => {
        resolve({
          ok: false,
          statusCode: 0,
          error: err.message
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          ok: false,
          statusCode: 0,
          error: 'Request timeout (8000ms)'
        });
      });

      req.write(bodyStr);
      req.end();
    } catch (err) {
      resolve({
        ok: false,
        statusCode: 0,
        error: err.message
      });
    }
  });
}

/**
 * Dispatch webhook for a paid transaction to callback_url and/or global webhookUrl
 */
async function dispatchTransactionWebhook(tx, config) {
  const targets = new Set();
  if (tx.callback_url && /^https?:\/\//i.test(tx.callback_url)) {
    targets.add(tx.callback_url.trim());
  }
  if (config.webhookUrl && /^https?:\/\//i.test(config.webhookUrl)) {
    targets.add(config.webhookUrl.trim());
  }

  if (targets.size === 0) {
    return [];
  }

  const webhookPayload = {
    event: 'payment.paid',
    success: true,
    status: 'paid',
    message: 'Status transaksi saat ini PAID',
    timestamp: new Date().toISOString(),
    data: {
      customer_name: tx.customer_name,
      customer_email: tx.customer_email,
      customer_phone: tx.customer_phone,
      callback_url: tx.callback_url,
      return_url: tx.return_url,
      amount: tx.amount,
      amount_received: tx.amount_received,
      pay_code: tx.pay_code,
      status: 'PAID',
      expired_time: tx.expired_time,
      paid_at: tx.paid_at ? new Date(tx.paid_at).toISOString() : new Date().toISOString(),
      order_items: tx.order_items,
      qr_url: tx.qr_url
    }
  };

  const results = [];
  for (const url of targets) {
    const res = await postJson(url, webhookPayload, config.webhookSecret);
    results.push({ url, ...res });
  }
  return results;
}

module.exports = {
  postJson,
  dispatchTransactionWebhook
};
