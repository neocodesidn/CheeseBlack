'use strict';
const path = require('node:path');
const { atomicWriteJson, readJson } = require('./json-storage');

const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'safety-controls.json');
const emptyState = () => ({
  version: 1,
  globalMaintenance: { enabled: false, reason: '', updatedAt: null, updatedBy: null },
  guilds: {},
});
const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

function createSafetyControls(filename = DEFAULT_FILE, clock = () => new Date()) {
  function readState() {
    const value = readJson(filename, emptyState());
    if (!isObject(value) || !isObject(value.globalMaintenance) || !isObject(value.guilds)) {
      throw new Error('Struktur safety-controls.json tidak valid. Pulihkan file dari backup atau gunakan struktur default.');
    }
    return {
      version: 1,
      globalMaintenance: {
        enabled: value.globalMaintenance.enabled === true,
        reason: typeof value.globalMaintenance.reason === 'string' ? value.globalMaintenance.reason : '',
        updatedAt: value.globalMaintenance.updatedAt ?? null,
        updatedBy: value.globalMaintenance.updatedBy ?? null,
      },
      guilds: value.guilds,
    };
  }

  function writeState(state) {
    atomicWriteJson(filename, state);
    return state;
  }

  function getGlobalMaintenance() {
    return readState().globalMaintenance;
  }

  function getGuildState(guildId) {
    if (typeof guildId !== 'string' || !/^\d{15,22}$/.test(guildId)) throw new Error('guildId tidak valid');
    const state = readState().guilds[guildId];
    return {
      paused: state?.paused === true,
      reason: typeof state?.reason === 'string' ? state.reason : '',
      updatedAt: state?.updatedAt ?? null,
      updatedBy: state?.updatedBy ?? null,
    };
  }

  function setGlobalMaintenance({ enabled, reason = '', actorId }) {
    if (typeof enabled !== 'boolean') throw new TypeError('enabled harus boolean');
    if (typeof actorId !== 'string' || !/^\d{15,22}$/.test(actorId)) throw new Error('actorId tidak valid');
    const state = readState();
    state.globalMaintenance = {
      enabled,
      reason: String(reason).trim().slice(0, 500),
      updatedAt: clock().toISOString(),
      updatedBy: actorId,
    };
    writeState(state);
    return state.globalMaintenance;
  }

  function setGuildPaused({ guildId, paused, reason = '', actorId }) {
    if (typeof guildId !== 'string' || !/^\d{15,22}$/.test(guildId)) throw new Error('guildId tidak valid');
    if (typeof paused !== 'boolean') throw new TypeError('paused harus boolean');
    if (typeof actorId !== 'string' || !/^\d{15,22}$/.test(actorId)) throw new Error('actorId tidak valid');
    const state = readState();
    state.guilds[guildId] = {
      paused,
      reason: String(reason).trim().slice(0, 500),
      updatedAt: clock().toISOString(),
      updatedBy: actorId,
    };
    writeState(state);
    return state.guilds[guildId];
  }

  function listPausedGuilds() {
    const state = readState();
    return Object.entries(state.guilds)
      .filter(([, value]) => value?.paused === true)
      .map(([guildId, value]) => ({
        guildId,
        paused: true,
        reason: typeof value.reason === 'string' ? value.reason : '',
        updatedAt: value.updatedAt ?? null,
        updatedBy: value.updatedBy ?? null,
      }));
  }

  return { getGlobalMaintenance, getGuildState, setGlobalMaintenance, setGuildPaused, listPausedGuilds };
}

const controls = createSafetyControls();
module.exports = { ...controls, createSafetyControls, DEFAULT_FILE };
