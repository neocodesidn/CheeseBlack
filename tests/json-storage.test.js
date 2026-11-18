'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { atomicWriteJson, readJson } = require('../lib/json-storage');

test('atomic JSON storage writes and reads objects', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'community-bot-'));
  const file = path.join(dir, 'nested', 'state.json');
  atomicWriteJson(file, { enabled: true, count: 3 });
  assert.deepEqual(readJson(file), { enabled: true, count: 3 });
  fs.rmSync(dir, { recursive: true, force: true });
});
