'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CHANGELOG_DEFAULTS,
  buildChangelogHeader,
  buildChangelogChanges,
} = require('../lib/script-changelog-template');

const roleId = '123456789012345678';

test('changelog header follows the shared reference order and uses a system timestamp', () => {
  const header = buildChangelogHeader({
    title: 'New Update Released!',
    titleEmoji: '⬆️',
    categoryEmoji: '📋',
    recipientEmoji: '👤',
    gameName: 'Fish It',
    recipientRoleId: roleId,
  }, 1795021200000);

  assert.match(header, /^# ⬆️ New Update Released!/);
  assert.match(header, /\*\*📋 Category:\*\* Fish It/);
  assert.match(header, new RegExp(`\\*\\*👤 Recipient:\\*\\* <@&${roleId}>`));
  assert.match(header, /\*\*🕒 Date:\*\* <t:1795021200:F>/);
  assert.ok(header.indexOf('Category') < header.indexOf('Recipient'));
  assert.ok(header.indexOf('Recipient') < header.indexOf('Date'));
  assert.doesNotMatch(header, /\*\*.*Script:/);
});

test('changelog title and metadata emojis can be customized independently', () => {
  const header = buildChangelogHeader({
    title: 'Version Update',
    titleEmoji: '🚀',
    categoryEmoji: '🎮',
    recipientEmoji: '📣',
    gameName: 'Blox Fruits',
    recipientRoleId: roleId,
  }, 1795021200000);

  assert.match(header, /^# 🚀 Version Update/);
  assert.match(header, /\*\*🎮 Category:\*\* Blox Fruits/);
  assert.match(header, new RegExp(`\\*\\*📣 Recipient:\\*\\* <@&${roleId}>`));
});

test('changelog display fields fall back to the agreed defaults', () => {
  const header = buildChangelogHeader({
    gameName: 'Fish It',
    recipientRoleId: roleId,
  }, 1795021200000);

  assert.match(header, new RegExp(`^# ${CHANGELOG_DEFAULTS.titleEmoji} ${CHANGELOG_DEFAULTS.title}`));
  assert.match(header, new RegExp(`\\*\\*${CHANGELOG_DEFAULTS.categoryEmoji} Category:`));
  assert.match(header, new RegExp(`\\*\\*${CHANGELOG_DEFAULTS.recipientEmoji} Recipient:`));
});

test('description is a separate Changes block immediately before action buttons in the renderer contract', () => {
  assert.equal(buildChangelogChanges('- Fixed bugs\n- Improved performance'), '## ⚙️ Changes\n- Fixed bugs\n- Improved performance');
});
