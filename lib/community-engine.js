'use strict';

function findUsedInvite(previous, current) {
  const before = new Map((previous || []).map((invite) => [invite.code, Number(invite.uses) || 0]));
  const increased = (current || []).filter((invite) => (Number(invite.uses) || 0) > (before.get(invite.code) ?? 0));
  increased.sort((a, b) => (Number(b.uses) || 0) - (Number(a.uses) || 0));
  return increased[0] || null;
}
function safeText(value, max = 500) {
  return String(value ?? '').replace(/@/g, '@\u200b').replace(/[\r\n]+/g, ' ').slice(0, max);
}
module.exports = { findUsedInvite, safeText };
