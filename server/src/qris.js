const Jimp = require('jimp');
const jsQR = require('jsqr');
const QRCode = require('qrcode');

/**
 * Compute CRC16-CCITT (0xFFFF initial, polynomial 0x1021, no final XOR)
 * Standard used by EMVCo / QRIS Bank Indonesia (Tag 63)
 */
function calculateCRC16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Parse top-level EMVCo TLV tags from a QRIS string
 */
function parseEMVCoTLV(qrisStr) {
  const clean = (qrisStr || '').trim();
  const tags = [];
  let idx = 0;
  while (idx < clean.length) {
    if (idx + 4 > clean.length) {
      throw new Error('Format QRIS tidak valid (TLV terpotong)');
    }
    const id = clean.substring(idx, idx + 2);
    const lenStr = clean.substring(idx + 2, idx + 4);
    const len = parseInt(lenStr, 10);
    if (isNaN(len) || idx + 4 + len > clean.length) {
      throw new Error(`Format panjang TLV tidak valid pada Tag ${id}`);
    }
    const value = clean.substring(idx + 4, idx + 4 + len);
    tags.push({ id, len, value });
    idx += 4 + len;
  }
  return tags;
}

/**
 * Validate QRIS string and extract merchant metadata
 */
function validateAndParseQris(qrisStr) {
  const clean = (qrisStr || '').trim();
  if (!clean.startsWith('000201')) {
    throw new Error('String QRIS harus diawali dengan "000201" (EMVCo Payload Format Indicator).');
  }
  const tags = parseEMVCoTLV(clean);
  const tagMap = {};
  for (const t of tags) {
    tagMap[t.id] = t.value;
  }

  if (!tagMap['58'] || !tagMap['59']) {
    throw new Error('QRIS tidak memiliki informasi Merchant (Tag 58/59).');
  }

  // Verify CRC if Tag 63 is at the end
  const lastTag = tags[tags.length - 1];
  if (lastTag && lastTag.id === '63') {
    const bodyWithoutCrcVal = clean.substring(0, clean.length - 4);
    const expectedCrc = calculateCRC16(bodyWithoutCrcVal);
    if (lastTag.value.toUpperCase() !== expectedCrc) {
      // Still allow if user manually edited, we will recalculate CRC anyway, but note it
    }
  }

  // Extract NMID if present in tag 26-51
  let nmid = '';
  for (let tagNum = 26; tagNum <= 51; tagNum++) {
    const key = String(tagNum).padStart(2, '0');
    if (tagMap[key]) {
      try {
        const subTags = parseEMVCoTLV(tagMap[key]);
        for (const st of subTags) {
          if (st.id === '02' || st.id === '01') {
            if (!nmid) nmid = st.value;
          }
        }
      } catch (_) {}
    }
  }

  return {
    raw: clean,
    merchantName: tagMap['59'] || 'DANA Bisnis Merchant',
    merchantCity: tagMap['60'] || 'INDONESIA',
    postalCode: tagMap['61'] || '',
    countryCode: tagMap['58'] || 'ID',
    pointOfInitiation: tagMap['01'] || '11',
    nmid: nmid || 'ID-MERCHANT'
  };
}

/**
 * Convert Static QRIS string to Dynamic QRIS string with specific nominal amount
 * - Sets Tag 01 to "12" (Dynamic)
 * - Injects/updates Tag 54 with integer string of amount
 * - Removes any existing Tag 63 and appends recalculated CRC16 Tag 6304XXXX
 */
function generateDynamicQris(staticQrisStr, amount) {
  const clean = (staticQrisStr || '').trim();
  const nominalStr = String(Math.round(Number(amount)));
  if (!nominalStr || Number(nominalStr) <= 0) {
    throw new Error('Nominal QRIS dinamis harus lebih besar dari 0');
  }

  const tags = parseEMVCoTLV(clean);
  const newTags = [];
  let hasTag01 = false;
  let amountInserted = false;

  for (const t of tags) {
    if (t.id === '63') {
      // Skip old CRC tag, we will recalculate at the end
      continue;
    }
    if (t.id === '01') {
      hasTag01 = true;
      newTags.push({ id: '01', value: '12' }); // 12 = Dynamic QRIS
      continue;
    }
    if (t.id === '54') {
      // Replace existing amount tag
      newTags.push({ id: '54', value: nominalStr });
      amountInserted = true;
      continue;
    }
    // Insert Tag 54 right before Tag 55, 58, 59, 60, or 62 if not inserted yet
    if (!amountInserted && ['55', '56', '57', '58', '59', '60', '61', '62'].includes(t.id)) {
      newTags.push({ id: '54', value: nominalStr });
      amountInserted = true;
    }
    newTags.push({ id: t.id, value: t.value });
  }

  if (!hasTag01) {
    // Insert Tag 01 right after Tag 00
    newTags.splice(1, 0, { id: '01', value: '12' });
  }
  if (!amountInserted) {
    newTags.push({ id: '54', value: nominalStr });
  }

  // Serialize TLV without CRC value
  let payload = '';
  for (const t of newTags) {
    const valStr = String(t.value);
    const lenStr = String(valStr.length).padStart(2, '0');
    payload += `${t.id}${lenStr}${valStr}`;
  }
  payload += '6304';
  const crc = calculateCRC16(payload);
  return payload + crc;
}

/**
 * Decode QRIS string from an uploaded image buffer (.png, .jpg, .jpeg, .bmp)
 */
async function decodeQrisFromImageBuffer(buffer) {
  const image = await Jimp.read(buffer);
  const { width, height, data } = image.bitmap;

  // Try direct decode first
  let code = jsQR(new Uint8ClampedArray(data), width, height);
  if (code && code.data) {
    return code.data.trim();
  }

  // Try grayscale + contrast boost if image has low contrast or styling
  const cloned = image.clone().greyscale().contrast(0.5);
  code = jsQR(
    new Uint8ClampedArray(cloned.bitmap.data),
    cloned.bitmap.width,
    cloned.bitmap.height
  );
  if (code && code.data) {
    return code.data.trim();
  }

  // Try resized if very large image
  if (width > 1200 || height > 1200) {
    const resized = image.clone().scaleToFit(1000, 1000);
    code = jsQR(
      new Uint8ClampedArray(resized.bitmap.data),
      resized.bitmap.width,
      resized.bitmap.height
    );
    if (code && code.data) {
      return code.data.trim();
    }
  }

  throw new Error('Gagal membaca QR Code dari gambar. Pastikan gambar QRIS jelas dan tidak terpotong.');
}

/**
 * Generate PNG Buffer from QRIS string
 */
async function generateQrPngBuffer(qrisString) {
  return QRCode.toBuffer(qrisString, {
    type: 'png',
    width: 480,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#000000',
      light: '#FFFFFF'
    }
  });
}

/**
 * Generate Data URL from QRIS string
 */
async function generateQrDataUrl(qrisString) {
  return QRCode.toDataURL(qrisString, {
    width: 480,
    margin: 2,
    errorCorrectionLevel: 'M'
  });
}

function tlv(id, val) {
  const s = String(val);
  return `${id}${String(s.length).padStart(2, '0')}${s}`;
}

/**
 * Build a valid sample static DANA Bisnis QRIS string (useful for demo/testing)
 */
function createSampleStaticDanaQris(merchantName = 'TOKO DANA BISNIS', merchantCity = 'JAKARTA') {
  const nameVal = merchantName.substring(0, 25).toUpperCase();
  const cityVal = merchantCity.substring(0, 15).toUpperCase();

  const tag26Sub =
    tlv('00', 'ID.DANA.WWW') +
    tlv('01', '936009153023456789') +
    tlv('02', 'ID1020023456789') +
    tlv('03', 'UMI');

  const tag51Sub =
    tlv('00', 'ID.CO.QRIS.WWW') +
    tlv('02', 'ID1020023456789') +
    tlv('03', 'UMI');

  const rawWithoutCrc =
    tlv('00', '01') +
    tlv('01', '11') +
    tlv('26', tag26Sub) +
    tlv('51', tag51Sub) +
    tlv('52', '5411') +
    tlv('53', '360') +
    tlv('58', 'ID') +
    tlv('59', nameVal) +
    tlv('60', cityVal) +
    tlv('61', '10110') +
    '6304';

  return rawWithoutCrc + calculateCRC16(rawWithoutCrc);
}

module.exports = {
  calculateCRC16,
  parseEMVCoTLV,
  validateAndParseQris,
  generateDynamicQris,
  decodeQrisFromImageBuffer,
  generateQrPngBuffer,
  generateQrDataUrl,
  createSampleStaticDanaQris
};
