'use strict';

const CHANGELOG_DEFAULTS = Object.freeze({
  title: 'New Update Released!',
  titleEmoji: '⬆️',
  categoryEmoji: '📋',
  recipientEmoji: '👤',
});

function inline(value, fallback) {
  const result = String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
  return result || fallback;
}

function buildChangelogHeader(record, timestampMs = Date.now()) {
  const timestamp = Math.floor(Number(timestampMs) / 1000);
  const title = inline(record.title, CHANGELOG_DEFAULTS.title);
  const titleEmoji = inline(record.titleEmoji, CHANGELOG_DEFAULTS.titleEmoji);
  const categoryEmoji = inline(record.categoryEmoji, CHANGELOG_DEFAULTS.categoryEmoji);
  const recipientEmoji = inline(record.recipientEmoji, CHANGELOG_DEFAULTS.recipientEmoji);
  const gameName = inline(record.gameName, 'Unknown Game');
  const roleId = String(record.recipientRoleId ?? '');
  const recipient = /^\d{17,20}$/.test(roleId)
    ? `<@&${roleId}>`
    : inline(record.recipientRoleName, 'Recipient not set');

  return [
    `# ${titleEmoji} ${title}`,
    `**${categoryEmoji} Category:** ${gameName}`,
    `**${recipientEmoji} Recipient:** ${recipient}`,
    `**🕒 Date:** <t:${Number.isFinite(timestamp) ? timestamp : Math.floor(Date.now() / 1000)}:F>`,
  ].join('\n');
}

function buildChangelogChanges(description) {
  const body = String(description ?? '').trim();
  return `## ⚙️ Changes\n${body}`;
}

module.exports = {
  CHANGELOG_DEFAULTS,
  buildChangelogHeader,
  buildChangelogChanges,
};
