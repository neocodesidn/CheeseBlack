'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { findUsedInvite, safeText } = require('../lib/community-engine');

test('finds the invite whose use count increased', () => {
  const used = findUsedInvite([{ code: 'a', uses: 1 }, { code: 'b', uses: 4 }], [{ code: 'a', uses: 2 }, { code: 'b', uses: 4 }]);
  assert.equal(used.code, 'a');
});

test('safeText neutralizes mentions and newlines', () => {
  assert.equal(safeText('@everyone\nhello'), '@\u200beveryone hello');
});
