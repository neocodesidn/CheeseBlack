'use strict';
// Atomic local JSON writes: prevents truncating the live file if the process
// stops while writing. This is NOT a multi-process transaction / database lock.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

function atomicWriteJson(filename, value) {
  const serialized = JSON.stringify(value, null, 2);
  if (typeof serialized !== 'string') throw new TypeError('JSON value tidak valid');
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  try {
    fs.writeFileSync(temporary, serialized, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, filename);
  } finally {
    try { fs.unlinkSync(temporary); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
}

// Strict read for dashboard and tools: corrupted existing files must not
// silently appear as new server settings.
function readJson(filename, missingValue = {}) {
  let raw;
  try { raw = fs.readFileSync(filename, 'utf8'); }
  catch (err) {
    if (err.code === 'ENOENT') return missingValue;
    throw err;
  }
  try { return JSON.parse(raw); }
  catch (err) { throw new Error(`JSON rusak: ${path.basename(filename)} (${err.message})`); }
}

module.exports = { atomicWriteJson, readJson };
