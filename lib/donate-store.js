'use strict';
// Single-process durable ledger. Run ONE bot instance per shared data/ directory.
const fs = require('fs');
const path = require('path');
const { randomInt, randomUUID } = require('crypto');
const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'donate.json');
const TTL_MS = 5 * 60_000;
const MIN_AMOUNT = 1_000;
const MAX_AMOUNT = 5_000_000;
const ACTIVE = new Set(['creating', 'pending']);

function empty() { return { version: 1, settings: {}, transactions: [] }; }
function createStore(filename = DEFAULT_FILE, rng = (max) => randomInt(1, max + 1)) {
  let state;
  try {
    const raw = fs.readFileSync(filename, 'utf8');
    state = JSON.parse(raw);
    if (!state || !Array.isArray(state.transactions) || !state.settings || typeof state.settings !== 'object') throw Error('Invalid schema');
  } catch (err) {
    if (err.code === 'ENOENT') state = empty();
    else throw new Error('Data donate tidak dapat dibaca, jangan timpa sebelum diperbaiki: ' + err.message);
  }
  let revision = 0;
  function persist() {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    const temp = `${filename}.tmp-${process.pid}-${++revision}`;
    try {
      fs.writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
      fs.renameSync(temp, filename);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  function guildConfig(guildId) { return { ...state.settings[guildId] }; }
  function configure(guildId, patch) {
    state.settings[guildId] = { ...guildConfig(guildId), ...patch };
    persist();
    return guildConfig(guildId);
  }
  function get(id) { const record = state.transactions.find((r) => r.id === id); return record ? { ...record } : null; }
  function list() { return state.transactions.map((r) => ({ ...r })); }
  function openFor(guildId, userId, now = Date.now()) {
    // One global merchant: block parallel unpaid tickets for one donor across guilds.
    const record = state.transactions.find((r) => r.userId === userId && ACTIVE.has(r.status) && r.expiresAt > now);
    return record ? { ...record } : null;
  }
  function validateAmount(value) {
    if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) throw new Error('Nominal wajib berupa angka saja, contoh: 1000.');
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < MIN_AMOUNT || n > MAX_AMOUNT) throw new Error(`Nominal minimal ${MIN_AMOUNT} dan maksimal ${MAX_AMOUNT.toLocaleString('id-ID')} rupiah.`);
    return n;
  }
  function reserve({ guildId, userId, amountInput, message = '', now = Date.now() }) {
    const amount = validateAmount(amountInput);
    if (openFor(guildId, userId, now)) throw new Error('Kamu masih memiliki tiket donasi aktif, termasuk di server lain. Selesaikan atau tunggu 5 menit.');
    // Never recycle an amount, even after expiration. Prevents late-paid invoice being
    // incorrectly attributed to a newer donor with the same total.
    const used = new Set(state.transactions.map((r) => r.totalAmount));
    const offsets = Array.from({ length: 999 }, (_, index) => index + 1);
    const start = Math.max(0, Math.min(998, Number(rng(999)) - 1));
    const unique = offsets.slice(start).concat(offsets.slice(0, start))
      .find((offset) => !used.has(amount + offset));
    if (!unique) throw new Error('Kode unik untuk nominal ini habis. Coba nominal dasar lain.');
    const record = {
      id: randomUUID(), guildId, userId, baseAmount: amount, uniqueCode: unique,
      totalAmount: amount + unique, message: String(message).slice(0, 400),
      status: 'creating', createdAt: now, expiresAt: now + TTL_MS,
      channelId: null, messageId: null, referenceId: null,
      paidAt: null, notifiedAt: null, closedAt: null,
      roleIdAtPayment: null, roleStatus: null, roleGrantedAt: null,
      roleAttempts: 0, roleLastAttemptAt: null, roleLastError: null,
    };
    state.transactions.push(record);
    persist();
    return { ...record };
  }
  function mutate(id, fn) {
    const record = state.transactions.find((r) => r.id === id);
    if (!record) return null;
    const changed = fn(record);
    if (changed === false) return { ...record };
    persist();
    return { ...record };
  }
  function channel(id, channelId) { return mutate(id, (r) => { r.channelId = channelId; }); }
  function ready(id, messageId) {
    return mutate(id, (r) => {
      if (r.status !== 'creating') return false;
      r.status = 'pending'; r.messageId = messageId;
    });
  }
  function fail(id) {
    return mutate(id, (r) => {
      if (!ACTIVE.has(r.status)) return false;
      r.status = 'failed';
    });
  }
  function expired(now = Date.now()) {
    const result = [];
    for (const r of state.transactions) {
      if (ACTIVE.has(r.status) && r.expiresAt <= now) {
        r.status = 'expired';
        result.push({ ...r });
      }
    }
    if (result.length) persist();
    return result;
  }
  function markPaid(id, tx, now = Date.now()) {
    const record = state.transactions.find((r) => r.id === id);
    if (!record || record.status !== 'pending' || record.expiresAt <= now) return null;
    const ref = String(tx.reference_id || tx.id || '');
    if (!ref || state.transactions.some((r) => r.referenceId === ref)) return null;
    const paidAt = Date.parse(tx.time);
    // Provider example records seconds precision. Allow only that same starting second,
    // rather than mistakenly rejecting a real payment in the first 999 ms.
    const lowerBound = Math.floor(record.createdAt / 1000) * 1000;
    if (!Number.isFinite(paidAt) || paidAt < lowerBound || paidAt > record.expiresAt || paidAt > now + 15_000) return null;
    if (tx.status !== 'success' || !Number.isSafeInteger(Number(tx.amount)) || Number(tx.amount) !== record.totalAmount) return null;
    record.status = 'paid'; record.referenceId = ref; record.paidAt = paidAt;
    // Freeze the appreciation role in effect at PAYMENT time. Later setting
    // changes must not retroactively assign past donations to another role.
    record.roleIdAtPayment = state.settings[record.guildId]?.donatorRoleId || null;
    record.roleStatus = record.roleIdAtPayment ? 'pending' : 'not_configured';
    record.roleGrantedAt = null; record.roleAttempts = 0;
    record.roleLastAttemptAt = null; record.roleLastError = null;
    record.issuer = typeof tx.issuer === 'string' ? tx.issuer.slice(0, 80) : '';
    persist();
    return { ...record };
  }
  function roleDue(record, now = Date.now()) {
    if (record.status !== 'paid' || !record.roleIdAtPayment || record.roleGrantedAt) return false;
    if (!record.roleLastAttemptAt) return true;
    const attempts = Math.max(1, Number(record.roleAttempts) || 1);
    const delay = Math.min(15 * 60_000, 60_000 * 2 ** Math.min(attempts - 1, 4));
    return record.roleLastAttemptAt + delay <= now;
  }
  function roleGranted(id, alreadyHadRole = false, now = Date.now()) {
    return mutate(id, (r) => {
      if (r.status !== 'paid' || !r.roleIdAtPayment || r.roleGrantedAt) return false;
      r.roleGrantedAt = now;
      r.roleStatus = alreadyHadRole ? 'already_present' : 'granted';
      r.roleLastAttemptAt = now; r.roleAttempts = (r.roleAttempts || 0) + 1;
      r.roleLastError = null;
    });
  }
  function roleFailed(id, errorMessage, now = Date.now()) {
    return mutate(id, (r) => {
      if (r.status !== 'paid' || !r.roleIdAtPayment || r.roleGrantedAt) return false;
      r.roleStatus = 'retrying';
      r.roleLastAttemptAt = now; r.roleAttempts = (r.roleAttempts || 0) + 1;
      r.roleLastError = String(errorMessage || 'Unknown error').slice(0, 180);
    });
  }
  function notified(id, now = Date.now()) {
    return mutate(id, (r) => { if (r.notifiedAt) return false; r.notifiedAt = now; });
  }
  function closed(id, now = Date.now()) {
    return mutate(id, (r) => { if (r.closedAt) return false; r.closedAt = now; });
  }
  return { guildConfig, configure, get, list, openFor, reserve, channel, ready, fail, expired, markPaid, roleDue, roleGranted, roleFailed, notified, closed, validateAmount };
}
module.exports = { createStore, TTL_MS, MIN_AMOUNT, MAX_AMOUNT };
