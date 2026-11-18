const { atomicWriteJson } = require('./json-storage');
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'panels.json');

function load() {
  try {
    const value = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error('Gagal membaca data yang sudah ada: ' + err.message);
    return {};
  }
}

const state = load();

function persist() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  atomicWriteJson(FILE, state);
}

function get(guildId, kind) {
  return state[guildId]?.[kind] ?? null;
}

function set(guildId, kind, value) {
  if (!state[guildId] || typeof state[guildId] !== 'object') state[guildId] = {};
  state[guildId][kind] = {
    channelId: String(value.channelId),
    messageId: String(value.messageId),
    updatedAt: Date.now(),
  };
  persist();
}

function remove(guildId, kind) {
  if (!state[guildId]) return;
  delete state[guildId][kind];
  if (!Object.keys(state[guildId]).length) delete state[guildId];
  persist();
}

module.exports = { get, set, remove };
