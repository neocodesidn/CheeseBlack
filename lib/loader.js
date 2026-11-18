'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Produk baru hanya memuat modul yang memang menjadi bagian dari Community Exploit Bot.
// File plugin lama yang tertinggal di folder tidak otomatis aktif.
const CORE_PLUGINS = Object.freeze([
  'verification', 'roles', 'boost', 'announcements', 'welcome', 'donate',
  'ticket', 'invites', 'logs', 'trap', 'script', 'cmds', 'owner', 'panel',
]);

function loadPlugins() {
  const dir = path.join(__dirname, '..', 'plugins');
  const disabled = new Set((process.env.DISABLED_PLUGINS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  return CORE_PLUGINS
    .filter((name) => !disabled.has(name))
    .map((name) => {
      const file = path.join(dir, `${name}.js`);
      if (!fs.existsSync(file)) throw new Error(`Plugin inti tidak ditemukan: ${name}.js`);
      const plugin = require(file);
      plugin.name ??= name;
      return plugin;
    });
}

module.exports = { CORE_PLUGINS, loadPlugins };
