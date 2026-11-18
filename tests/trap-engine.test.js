'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTrapEngine, DEFAULT_CONFIG, normalizeConfig, incrementIncidentCounters, isExempt } = require('../lib/trap-engine');

test('trap engine rate limits repeated claims and allows after cooldown', () => {
  const engine = createTrapEngine({ cooldownMs: 1000 });
  assert.equal(engine.claim({ guildId: 'g', userId: 'u', now: 1000 }), true);
  assert.equal(engine.claim({ guildId: 'g', userId: 'u', now: 1500 }), false);
  assert.equal(engine.claim({ guildId: 'g', userId: 'u', now: 2100 }), true);
});

test('trap config normalizes IDs and counters', () => {
  const cfg = normalizeConfig({ enabled: true, channelId: '123456789012345', logChannelId: '123456789012346', triggerCount: 2, kickCount: 1 });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.triggerCount, 2);
  assert.equal(incrementIncidentCounters(cfg, { actionResult: 'berhasil di-kick' }).kickCount, 2);
  assert.equal(normalizeConfig({ enabled: true }).enabled, false);
  assert.equal(DEFAULT_CONFIG.enabled, false);
});

test('trap exemptions include owner, bot owner, user and role allowlists', () => {
  const cfg = normalizeConfig({ exemptUserIds: ['123456789012345'], exemptRoleIds: ['123456789012346'] });
  assert.equal(isExempt({ userId: '123456789012345', config: cfg }), true);
  assert.equal(isExempt({ userId: '999999999999999', config: cfg, roleIds: ['123456789012346'] }), true);
  assert.equal(isExempt({ userId: '999999999999999', config: cfg, guildOwnerId: '999999999999999' }), true);
});
