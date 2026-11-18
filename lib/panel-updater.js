'use strict';
// Re-render ONLY previously tracked public panels. Never send duplicates, delete
// messages, replace custom IDs, or edit order/payment messages in open tickets.
const PROVIDERS = Object.freeze([
  ['ticket', '../plugins/ticket'],
  ['verification', '../plugins/verification'],
  ['roles', '../plugins/roles'],
  ['rules', '../plugins/announcements'],
  ['trap', '../plugins/trap'],
  ['donation', '../plugins/donate'],
]);
const locks = new Map();
async function editTrackedPanel(guild, target, payload) {
  if (!target?.channelId || !target?.messageId) return 'missing';
  try {
    const channel = guild.channels.cache.get(target.channelId) || await guild.channels.fetch(target.channelId);
    if (!channel?.messages) return 'missing';
    const message = await channel.messages.fetch(target.messageId).catch(() => null);
    if (!message) return 'missing';
    if (message.author?.id !== guild.client.user.id) return 'failed';
    await message.edit({ ...payload, allowedMentions: { parse: [] } });
    return 'updated';
  } catch (err) {
    console.warn(`[panel] Tidak dapat edit ${target.messageId}: ${err.message}`);
    return 'failed';
  }
}
async function refreshGuild(guild, allowed = null) {
  const tally = { updated: 0, missing: 0, failed: 0, skipped: 0, byType: {} };
  for (const [name, modulePath] of PROVIDERS) {
    if (allowed && !allowed.has(name)) continue;
    try {
      const plugin = require(modulePath);
      if (typeof plugin.refreshPublicPanels !== 'function') { tally.skipped++; continue; }
      const values = await plugin.refreshPublicPanels(guild);
      const statuses = Array.isArray(values) ? values : [values];
      tally.byType[name] = statuses;
      for (const status of statuses) {
        if (Object.hasOwn(tally, status) && status !== 'byType') tally[status]++;
      }
    } catch (err) {
      tally.byType[name] = ['failed'];
      tally.failed++;
      console.warn(`[panel] Gagal refresh ${name}: ${err.stack || err}`);
    }
  }
  return tally;
}
async function run(guild) {
  // Serialise timer/manual requests for the same guild to avoid conflicting edits.
  const current = locks.get(guild.id) || Promise.resolve();
  const next = current.catch(() => {}).then(() => refreshGuild(guild));
  locks.set(guild.id, next);
  try { return await next; } finally { if (locks.get(guild.id) === next) locks.delete(guild.id); }
}
function isBusy(id) { return locks.has(id); }
module.exports = { editTrackedPanel, refreshGuild, run, isBusy, PROVIDERS };
