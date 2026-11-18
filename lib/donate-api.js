'use strict';
const BASE_URL = 'https://gopaymerchantrestapi.vercel.app';

/**
 * Return a short provider validation error without leaking QRIS payloads,
 * history tokens or any URLs/query strings into PM2 logs.
 */
function safeProviderReason(body, params = {}) {
  if (!body || typeof body !== 'object') return '';
  const err = body.error && typeof body.error === 'object' ? body.error : {};
  const code = [body.error_code, body.code, err.code]
    .find((v) => typeof v === 'string' && /^[A-Za-z0-9_.-]{1,50}$/.test(v));
  let detail = [body.message, err.message, body.detail,
    typeof body.error === 'string' ? body.error : null]
    .find((v) => typeof v === 'string' && v.trim());
  if (detail) {
    detail = detail.replace(/\s+/g, ' ').trim();
    const secrets = Object.values(params).filter((v) => String(v).length >= 8);
    for (const secret of secrets) {
      detail = detail.split(String(secret)).join('[redacted]');
      detail = detail.split(encodeURIComponent(String(secret))).join('[redacted]');
    }
    detail = detail.replace(/https?:\/\/\S+/gi, '[redacted URL]')
      .replace(/\b(?:static_qr|qr_string|token)\s*[:=]\s*[^\s,;&]+/gi, '[redacted credential]')
      .replace(/[A-Za-z0-9+/%_.=-]{60,}/g, '[redacted value]')
      .replace(/\b\d{20,}\b/g, '[redacted value]');
    // HTML and very long arbitrary responses are not suitable for logs.
    if (/<[^>]+>/.test(detail)) detail = '';
    else detail = detail.slice(0, 180);
  }
  return [code, detail].filter(Boolean).join(' — ');
}

function validateStaticQr(qr) {
  if (!qr || typeof qr !== 'string') throw new Error('GOPAY_STATIC_QR kosong.');
  if (!qr.startsWith('000201')) {
    throw new Error('GOPAY_STATIC_QR harus diisi payload teks QRIS dari hasil scan, bukan URL gambar atau tautan pembayaran.');
  }
  try {
    if (!qrCrcValid(qr)) throw new Error('CRC');
    if (qrisField(qr, '01') !== '11') throw new Error('Mode QR');
    if (!Array.from({ length: 26 }, (_, n) => String(n + 26)).some((tag) => qrisField(qr, tag))) throw new Error('Merchant');
  } catch (_) {
    throw new Error('GOPAY_STATIC_QR bukan QRIS statis valid (format/CRC/mode salah). Scan ulang QRIS merchant dan salin QR string-nya secara utuh.');
  }
  return qr;
}

function config() {
  const qr = (process.env.GOPAY_STATIC_QR || '').trim();
  const token = (process.env.GOPAY_HISTORY_TOKEN || '').trim();
  if (!qr || !token) throw new Error('GOPAY_STATIC_QR dan GOPAY_HISTORY_TOKEN harus diisi di .env.');
  validateStaticQr(qr);
  return { qr, token };
}
async function getJson(endpoint, params, fetcher = fetch) {
  const url = new URL(endpoint, BASE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  let response;
  try {
    response = await fetcher(url.toString(), { signal: AbortSignal.timeout(8_000), headers: { Accept: 'application/json' } });
  } catch (_) {
    throw new Error('Server API tidak dapat dihubungi.'); // never log query string containing secrets
  }
  if (!response.ok) {
    let providerBody;
    try { providerBody = await response.json(); } catch (_) { /* May return HTML or empty body. */ }
    const reason = safeProviderReason(providerBody, params);
    throw new Error(`API ${endpoint} merespons HTTP ${response.status}${reason ? `: ${reason}` : ' (tanpa detail error JSON)'}.`);
  }
  try {
    const body = await response.json();
    if (!body || body.success !== true) throw Error('API returned unsuccessful status');
    return body;
  } catch (_) { throw new Error('Respons API tidak valid atau gagal.'); }
}
function qrisField(payload, wanted) {
  if (typeof payload !== 'string' || !payload) throw Error('QRIS payload kosong.');
  let pos = 0;
  while (pos < payload.length) {
    const tag = payload.slice(pos, pos + 2);
    const lenStr = payload.slice(pos + 2, pos + 4);
    if (tag.length !== 2 || !/^\d{2}$/.test(lenStr)) throw Error('Format QRIS tidak valid.');
    const length = Number(lenStr);
    const value = payload.slice(pos + 4, pos + 4 + length);
    if (value.length !== length) throw Error('Format panjang QRIS tidak valid.');
    if (tag === wanted) return value;
    pos += 4 + length;
  }
  return null;
}
// QRIS contains checksum 6304 + four HEX digits; validate before rendering.
function qrCrcValid(payload) {
  const match = /6304([0-9A-Fa-f]{4})$/.exec(payload);
  if (!match) return false;
  let crc = 0xffff;
  const input = payload.slice(0, -4);
  for (const char of input) {
    crc ^= char.charCodeAt(0) << 8;
    for (let k = 0; k < 8; k++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0') === match[1].toUpperCase();
}
function verifyQris(payload, total) {
  if (typeof payload !== 'string' || !qrCrcValid(payload)) throw new Error('QRIS dari API gagal validasi checksum.');
  const amount = qrisField(payload, '54');
  if (!amount || !/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) !== total) throw new Error('Nominal QRIS dari API tidak cocok.');
  if (qrisField(payload, '01') !== '12') throw new Error('QRIS dari API bukan QRIS dinamis.');
  return true;
}
async function createQris(total, fetcher = fetch) {
  const { qr } = config();
  const data = await getJson('/api/qris/create', { amount: total, static_qr: qr }, fetcher);
  if (Number(data.amount) !== total) throw new Error('Nominal respons API tidak cocok dengan nominal donasi.');
  verifyQris(data.qr_string, total);
  // The dynamic QRIS must preserve the merchant account information supplied
  // by the developer; reject a substituted receiver even when CRC is valid.
  const merchantTags = Array.from({ length: 26 }, (_, n) => String(n + 26));
  const present = merchantTags.filter((tag) => qrisField(qr, tag) !== null);
  if (!present.length) throw new Error('QRIS statis tidak memuat informasi merchant.');
  for (const tag of [...present, '59', '60']) {
    const original = qrisField(qr, tag);
    if (original !== null && qrisField(data.qr_string, tag) !== original) {
      throw new Error('Merchant QRIS hasil API tidak cocok dengan QRIS statis konfigurasi.');
    }
  }
  return { qrString: data.qr_string, total };
}
async function history(fetcher = fetch) {
  const { token } = config();
  const data = await getJson('/api/history', { token }, fetcher);
  if (!Array.isArray(data.data)) throw new Error('Riwayat transaksi API tidak valid.');
  return data.data;
}
module.exports = { config, createQris, history, getJson, qrisField, qrCrcValid, verifyQris, validateStaticQr, safeProviderReason };
