'use strict';
const path = require('node:path');
const { atomicWriteJson, readJson } = require('./json-storage');

const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'security-audit.json');
const MAX_ENTRIES = 1000;

function createSecurityAudit(filename = DEFAULT_FILE, clock = () => new Date()) {
  function readEntries() {
    const entries = readJson(filename, []);
    if (!Array.isArray(entries)) throw new Error('Struktur security-audit.json tidak valid');
    return entries;
  }

  function record(event) {
    const entries = readEntries();
    const entry = {
      timestamp: clock().toISOString(),
      action: String(event.action || 'unknown').slice(0, 80),
      actorId: event.actorId ? String(event.actorId).slice(0, 22) : null,
      guildId: event.guildId ? String(event.guildId).slice(0, 22) : null,
      targetGuildId: event.targetGuildId ? String(event.targetGuildId).slice(0, 22) : null,
      details: event.details && typeof event.details === 'object' && !Array.isArray(event.details)
        ? event.details
        : {},
    };
    entries.push(entry);
    atomicWriteJson(filename, entries.slice(-MAX_ENTRIES));
    return entry;
  }

  function list(limit = 10) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 50));
    return readEntries().slice(-safeLimit).reverse();
  }

  return { record, list };
}

const audit = createSecurityAudit();
module.exports = { ...audit, createSecurityAudit, DEFAULT_FILE, MAX_ENTRIES };
