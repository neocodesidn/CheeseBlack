'use strict';

/**
 * Global owner authorization is based only on Discord user IDs from the
 * process environment. Server roles and guild ownership never grant access.
 */
function parseOwnerIds(env = process.env) {
  const raw = [env.BOT_OWNER_IDS, env.BOT_OWNER_ID].filter(Boolean).join(',');
  return [...new Set(raw.split(',').map((value) => value.trim()).filter((value) => /^\d{15,22}$/.test(value)))];
}

function isOwner(userId, env = process.env) {
  if (!userId) return false;
  return parseOwnerIds(env).includes(String(userId));
}

module.exports = { parseOwnerIds, isOwner };
