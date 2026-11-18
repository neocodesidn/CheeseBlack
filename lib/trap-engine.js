'use strict';

const ID_PATTERN = /^\d{15,22}$/;
const MAX_EXEMPTIONS = 100;
const MAX_INCIDENTS = 25;
const STAFF_PERMISSION_NAMES = Object.freeze([
  'Administrator',
  'ManageGuild',
  'ManageMessages',
  'ModerateMembers',
  'KickMembers',
  'BanMembers',
  'ManageChannels',
  'ManageRoles',
]);

const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  channelId: null,
  logChannelId: null,
  action: 'kick',
  deleteMessage: true,
  exemptUserIds: Object.freeze([]),
  exemptRoleIds: Object.freeze([]),
  triggerCount: 0,
  kickCount: 0,
  lastTriggeredAt: null,
  recentIncidents: Object.freeze([]),
});

function normalizeIdList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id) => typeof id === 'string' && ID_PATTERN.test(id)))].slice(0, MAX_EXEMPTIONS);
}

function normalizeIncident(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const incident = {
    id: typeof value.id === 'string' ? value.id.slice(0, 80) : '',
    userId: typeof value.userId === 'string' && ID_PATTERN.test(value.userId) ? value.userId : null,
    username: String(value.username || 'unknown').replace(/@/g, '@\u200b').slice(0, 80),
    channelId: typeof value.channelId === 'string' && ID_PATTERN.test(value.channelId) ? value.channelId : null,
    isBot: value.isBot === true,
    isWebhook: value.isWebhook === true,
    messageDeleted: value.messageDeleted === true,
    actionResult: String(value.actionResult || 'unknown').slice(0, 120),
    detectedAt: Number.isFinite(Number(value.detectedAt)) ? Number(value.detectedAt) : 0,
  };
  return incident;
}

function normalizeConfig(value = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const channelId = typeof input.channelId === 'string' && ID_PATTERN.test(input.channelId) ? input.channelId : null;
  const logChannelId = typeof input.logChannelId === 'string' && ID_PATTERN.test(input.logChannelId) ? input.logChannelId : null;
  const recentIncidents = Array.isArray(input.recentIncidents)
    ? input.recentIncidents.map(normalizeIncident).filter(Boolean).slice(-MAX_INCIDENTS)
    : [];

  return {
    enabled: input.enabled === true && Boolean(channelId) && Boolean(logChannelId),
    channelId,
    logChannelId,
    // Kick is the only automated action in this initial release.
    action: 'kick',
    deleteMessage: input.deleteMessage !== false,
    exemptUserIds: normalizeIdList(input.exemptUserIds),
    exemptRoleIds: normalizeIdList(input.exemptRoleIds),
    triggerCount: Number.isSafeInteger(Number(input.triggerCount)) && Number(input.triggerCount) >= 0
      ? Number(input.triggerCount)
      : 0,
    kickCount: Number.isSafeInteger(Number(input.kickCount)) && Number(input.kickCount) >= 0
      ? Number(input.kickCount)
      : 0,
    lastTriggeredAt: Number.isFinite(Number(input.lastTriggeredAt)) && Number(input.lastTriggeredAt) > 0
      ? Number(input.lastTriggeredAt)
      : null,
    recentIncidents,
  };
}

function incrementIncidentCounters(config = DEFAULT_CONFIG, incident = {}) {
  const current = normalizeConfig(config);
  const successfulKick = incident?.isWebhook !== true && incident?.actionResult === 'berhasil di-kick';
  return {
    triggerCount: current.triggerCount + 1,
    kickCount: current.kickCount + (successfulKick ? 1 : 0),
  };
}

function isExempt({ userId, guildOwnerId, botOwnerIds = [], config = DEFAULT_CONFIG, roleIds = [], permissionNames = [] } = {}) {
  if (!userId) return false;
  const cfg = normalizeConfig(config);
  if (String(userId) === String(guildOwnerId || '')) return true;
  if (botOwnerIds.includes(String(userId))) return true;
  if (cfg.exemptUserIds.includes(String(userId))) return true;
  if (roleIds.some((id) => cfg.exemptRoleIds.includes(String(id)))) return true;
  return permissionNames.some((name) => STAFF_PERMISSION_NAMES.includes(name));
}

function createTrapEngine({ cooldownMs = 15_000 } = {}) {
  const lastClaims = new Map();
  const safeCooldown = Number.isFinite(cooldownMs) ? Math.max(1_000, Math.min(120_000, cooldownMs)) : 15_000;

  function claim({ guildId, userId, now = Date.now() } = {}) {
    if (!guildId || !userId) return false;
    const key = `${guildId}:${userId}`;
    const previous = lastClaims.get(key);
    if (previous !== undefined && now - previous < safeCooldown) return false;
    lastClaims.set(key, now);
    return true;
  }

  function cleanup(now = Date.now()) {
    const cutoff = now - safeCooldown * 4;
    for (const [key, timestamp] of lastClaims) {
      if (timestamp < cutoff) lastClaims.delete(key);
    }
  }

  return { claim, cleanup };
}

module.exports = {
  ID_PATTERN,
  MAX_EXEMPTIONS,
  MAX_INCIDENTS,
  STAFF_PERMISSION_NAMES,
  DEFAULT_CONFIG,
  normalizeConfig,
  incrementIncidentCounters,
  isExempt,
  createTrapEngine,
};
