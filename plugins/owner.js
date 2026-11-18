'use strict';
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { BOT_NAME } = require('../lib/brand');
const { isOwner, parseOwnerIds } = require('../lib/owner-access');
const controls = require('../lib/safety-controls');
const audit = require('../lib/security-audit');
const logger = require('../lib/console-logger');
const EPHEMERAL = MessageFlags.Ephemeral;
let clientRef;
const validGuildId = (value) => /^\d{15,22}$/.test(String(value || ''));
const safe = (value, max = 200) => String(value ?? '').replace(/@/g, '@\u200b').replace(/[\r\n]/g, ' ').slice(0, max);
const dateLabel = (value) => value ? new Date(value).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'n/a';
function reply(i, content) { return i.reply({ content, flags: EPHEMERAL, allowedMentions: { parse: [] } }); }
function record(event) { try { audit.record(event); return true; } catch (err) { logger.error({ err, action: event.action }, 'Gagal menulis security audit'); return false; } }
const commands = [
  new SlashCommandBuilder().setName('admin').setDescription(`Kontrol global ${BOT_NAME}, khusus Bot Owner`)
    .addSubcommand((s) => s.setName('overview').setDescription('Ringkasan kesehatan bot dan status keamanan'))
    .addSubcommand((s) => s.setName('servers').setDescription('Daftar server tempat bot terpasang'))
    .addSubcommand((s) => s.setName('maintenance').setDescription('Aktifkan atau matikan maintenance global')
      .addBooleanOption((o) => o.setName('enabled').setDescription('Status maintenance').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Alasan maintenance').setMaxLength(500)))
    .addSubcommand((s) => s.setName('server-control').setDescription('Jeda atau aktifkan fitur pada satu server')
      .addStringOption((o) => o.setName('guild-id').setDescription('Discord server ID').setRequired(true).setMinLength(15).setMaxLength(22))
      .addStringOption((o) => o.setName('action').setDescription('Tindakan').setRequired(true).addChoices({ name: 'Pause', value: 'pause' }, { name: 'Resume', value: 'resume' }))
      .addStringOption((o) => o.setName('reason').setDescription('Alasan tindakan').setMaxLength(500)))
    .addSubcommand((s) => s.setName('audit').setDescription('Lihat tindakan administratif terbaru'))
    .setContexts(0).toJSON(),
];
async function handle(i) {
  if (!i.isChatInputCommand() || i.commandName !== 'admin') return false;
  if (!isOwner(i.user?.id)) { await reply(i, 'Akses ditolak. Command ini hanya tersedia untuk Bot Owner yang terdaftar di BOT_OWNER_IDS.'); return true; }
  if (!clientRef) { await reply(i, 'Bot belum selesai tersambung. Coba lagi sebentar.'); return true; }
  try {
    const sub = i.options.getSubcommand();
    if (sub === 'overview') {
      const maintenance = controls.getGlobalMaintenance();
      const paused = controls.listPausedGuilds();
      await reply(i, [
        `## ${BOT_NAME} · Overview`,
        `**Servers:** ${clientRef.guilds.cache.size}`,
        `**Latency:** ${Math.round(clientRef.ws.ping)} ms`,
        `**Uptime:** ${Math.floor(process.uptime())} seconds`,
        `**Configured owners:** ${parseOwnerIds().length}`,
        `**Global maintenance:** ${maintenance.enabled ? 'ON' : 'OFF'}`,
        maintenance.enabled ? `**Reason:** ${safe(maintenance.reason, 300)}` : '',
        `**Paused servers:** ${paused.length}`,
      ].filter(Boolean).join('\n'));
      return true;
    }
    if (sub === 'servers') {
      const paused = new Set(controls.listPausedGuilds().map((entry) => entry.guildId));
      const guilds = [...clientRef.guilds.cache.values()].sort((a, b) => a.name.localeCompare(b.name));
      const lines = guilds.slice(0, 30).map((guild) => `• **${safe(guild.name, 80)}** · \`${guild.id}\` · ${paused.has(guild.id) ? 'PAUSED' : 'ACTIVE'}`);
      await reply(i, `## Connected Servers\n${lines.join('\n') || 'Belum ada server.'}${guilds.length > 30 ? `\n-# Menampilkan 30 dari ${guilds.length} server.` : ''}`);
      return true;
    }
    if (sub === 'maintenance') {
      const enabled = i.options.getBoolean('enabled', true);
      const reason = (i.options.getString('reason') || '').trim();
      if (enabled && !reason) { await reply(i, 'Isi reason saat mengaktifkan maintenance.'); return true; }
      const state = controls.setGlobalMaintenance({ enabled, reason, actorId: i.user.id });
      const logged = record({ action: enabled ? 'global_maintenance_enabled' : 'global_maintenance_disabled', actorId: i.user.id, guildId: i.guildId, details: { reason: state.reason } });
      await reply(i, `Global maintenance **${enabled ? 'AKTIF' : 'NONAKTIF'}**.\nAlasan: ${safe(state.reason || '-', 300)}\nAudit: ${logged ? 'tersimpan' : 'gagal disimpan'}`);
      return true;
    }
    if (sub === 'server-control') {
      const guildId = i.options.getString('guild-id', true).trim();
      const action = i.options.getString('action', true);
      const reason = (i.options.getString('reason') || '').trim();
      if (!validGuildId(guildId) || !clientRef.guilds.cache.has(guildId)) { await reply(i, 'Server ID tidak valid atau bot tidak berada di server tersebut.'); return true; }
      if (action === 'pause' && !reason) { await reply(i, 'Isi reason saat menjeda server.'); return true; }
      const state = controls.setGuildPaused({ guildId, paused: action === 'pause', reason, actorId: i.user.id });
      const logged = record({ action: action === 'pause' ? 'guild_paused' : 'guild_resumed', actorId: i.user.id, guildId: i.guildId, targetGuildId: guildId, details: { reason: state.reason } });
      await reply(i, `Server **${safe(clientRef.guilds.cache.get(guildId).name, 100)}** ${action === 'pause' ? 'dijeda' : 'diaktifkan kembali'}.\nAudit: ${logged ? 'tersimpan' : 'gagal disimpan'}`);
      return true;
    }
    if (sub === 'audit') {
      const entries = audit.list(10);
      await reply(i, `## Security Audit\n${entries.map((entry) => `**${safe(entry.action, 80)}** · ${dateLabel(entry.timestamp)}\nActor: \`${safe(entry.actorId || 'system', 30)}\` · Guild: \`${safe(entry.targetGuildId || entry.guildId || '-', 30)}\``).join('\n\n') || 'Belum ada aktivitas.'}`);
      return true;
    }
  } catch (err) {
    logger.error({ err, actorId: i.user?.id, guildId: i.guildId }, 'Admin command gagal');
    await reply(i, 'Operasi gagal. Periksa log dan penyimpanan bot.');
    return true;
  }
  return false;
}
function setup(client) { clientRef = client; }
module.exports = { name: 'owner', commands, setup, handle };
