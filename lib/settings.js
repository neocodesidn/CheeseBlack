const { atomicWriteJson } = require('./json-storage');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'settings.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error('Gagal membaca data yang sudah ada: ' + err.message);
    return {};
  }
}

const data = load();

/** Pengaturan satu server (log channel, welcome, dll). */
const get = (guildId) => data[guildId] ?? {};

/** Gabungkan (shallow merge) pengaturan baru ke server. */
function set(guildId, patch) {
  data[guildId] = { ...(data[guildId] ?? {}), ...patch };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  atomicWriteJson(FILE, data);
  return data[guildId];
}

module.exports = { get, set };
