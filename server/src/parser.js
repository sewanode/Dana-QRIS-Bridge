/**
 * Parse DANA / QRIS incoming payment notification payload
 * Matches real DANA Bisnis notification format:
 *   pkg: "id.dana"
 *   title: "Pembayaran Masuk"
 *   text: "Rp1.000.232 diterima DANA Bisnis" or "Rp2 diterima DANA Bisnis"
 */
function parseDanaNotification(payload = {}) {
  const pkg = String(payload.pkg || payload.packageName || 'id.dana').trim();
  const title = String(payload.title || '').trim();
  const text = String(payload.text || payload.bigText || '').trim();

  // If explicit numeric amount is provided alongside notification
  let parsedAmount = 0;

  // Priority 1: Extract from "Rp..." pattern in text or title
  // Example: "Rp1.000.232 diterima DANA Bisnis" -> "1.000.232" -> 1000232
  // Also handles "Rp 1.000.232,00" -> "1.000.232" -> 1000232
  const combined = `${text} ${title}`;
  const rpMatch = combined.match(/Rp\s*([0-9][0-9.]*)(?:,[0-9]{1,2})?/i);
  if (rpMatch && rpMatch[1]) {
    const digitsOnly = rpMatch[1].replace(/\./g, '');
    const val = parseInt(digitsOnly, 10);
    if (!isNaN(val) && val > 0) {
      parsedAmount = val;
    }
  }

  // Priority 2: Fallback to payload.amount if provided directly
  if (!parsedAmount && payload.amount !== undefined && payload.amount !== null) {
    const cleaned = String(payload.amount).replace(/\./g, '').replace(/[^0-9]/g, '');
    const val = parseInt(cleaned, 10);
    if (!isNaN(val) && val > 0) {
      parsedAmount = val;
    }
  }

  // Check if it looks like an incoming payment notification
  const isDanaPkg = pkg.toLowerCase().includes('dana') || pkg === 'test.simulator';
  const isPaymentKeyword =
    /pembayaran\s*masuk|diterima\s*dana|dana\s*bisnis|berhasil\s*menerima|qris|uang\s*masuk/i.test(
      `${title} ${text}`
    ) || Boolean(payload.isSimulated);

  return {
    pkg,
    title: title || 'Pembayaran Masuk',
    text: text || (parsedAmount ? `Rp${parsedAmount.toLocaleString('id-ID')} diterima DANA Bisnis` : ''),
    amount: parsedAmount,
    isValidPayment: parsedAmount > 0 && (isDanaPkg || isPaymentKeyword)
  };
}

module.exports = {
  parseDanaNotification
};
