'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {
  Events, GatewayIntentBits, ChannelType, ContainerBuilder, MessageFlags,
  PermissionFlagsBits: P, SeparatorBuilder, SeparatorSpacingSize, SlashCommandBuilder, TextDisplayBuilder,
} = require('discord.js');
const { atomicWriteJson, readJson } = require('../lib/json-storage');
const { findUsedInvite, safeText } = require('../lib/community-engine');
const FILE = path.join(__dirname, '..', 'data', 'invites.json');
const EPHEMERAL = MessageFlags.Ephemeral;
const V2 = MessageFlags.IsComponentsV2;
const text = (value) => new TextDisplayBuilder().setContent(value);
const line = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
let state = { guilds: {} }, healthy = true;
const inviteCache = new Map();
try {
  const loaded = readJson(FILE, { guilds: {} });
  if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded) || !loaded.guilds || typeof loaded.guilds !== 'object' || Array.isArray(loaded.guilds)) throw new Error('Struktur invites.json tidak valid.');
  state = loaded;
} catch (error) { healthy = false; console.error('[invites] Data invite tracking tidak dapat dibaca; tracking dinonaktifkan:', error.message); }
function defaultGuild() { return { enabled: false, logChannelId: null, counts: {}, joinRecords: {} }; }
function getGuild(id) {
  const g = state.guilds[id];
  if (!g || typeof g !== 'object' || Array.isArray(g)) return defaultGuild();
  return { enabled: g.enabled === true, logChannelId: typeof g.logChannelId === 'string' ? g.logChannelId : null, counts: g.counts && typeof g.counts === 'object' ? g.counts : {}, joinRecords: g.joinRecords && typeof g.joinRecords === 'object' ? g.joinRecords : {} };
}
function saveGuild(id, value) {
  if (!healthy) throw new Error('data/invites.json bermasalah. Pulihkan dari backup terlebih dahulu.');
  state.guilds[id] = value; fs.mkdirSync(path.dirname(FILE), { recursive: true }); atomicWriteJson(FILE, state);
}
async function fetchSnapshot(guild) {
  const invites = await guild.invites.fetch();
  return [...invites.values()].map((invite) => ({ code: invite.code, uses: Number(invite.uses) || 0, inviterId: invite.inviter?.id || invite.inviterId || null }));
}
function canManage(i) { return i.memberPermissions?.has(P.ManageGuild) === true; }
const reply = (i, content) => i.reply({ content, flags: EPHEMERAL, allowedMentions: { parse: [] } });
const commands = [
  new SlashCommandBuilder().setName('invites').setDescription('Invite tracking dan statistik undangan')
    .addSubcommand((s) => s.setName('setup').setDescription('Aktifkan tracking dan atur channel log')
      .addBooleanOption((o) => o.setName('enabled').setDescription('Aktifkan atau nonaktifkan tracking'))
      .addChannelOption((o) => o.setName('log-channel').setDescription('Channel laporan invite').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((s) => s.setName('stats').setDescription('Lihat jumlah anggota yang diundang')
      .addUserOption((o) => o.setName('user').setDescription('Pengundang yang ingin dilihat')))
    .setContexts(0).toJSON(),
];
async function handleCommand(i, subcommand) {
  if (!i.inGuild() || !i.guildId) return reply(i, 'Fitur ini hanya tersedia di server Discord.');
  const cfg = getGuild(i.guildId);
  if (subcommand === 'setup') {
    if (!canManage(i)) return reply(i, 'Perintah ini membutuhkan izin Manage Server.');
    const enabled = i.options.getBoolean('enabled');
    const channel = i.options.getChannel('log-channel');
    if (enabled === null && !channel) return reply(i, `Invite tracking: **${cfg.enabled ? 'aktif' : 'nonaktif'}**\nChannel log: ${cfg.logChannelId ? `<#${cfg.logChannelId}>` : 'belum diatur'}\nData hanya menghitung join yang dapat dicocokkan setelah tracking aktif.`);
    if ((enabled === true || (enabled === null && cfg.enabled)) && !i.guild.members.me?.permissions.has(P.ManageGuild)) return reply(i, 'Bot membutuhkan izin **Manage Server** untuk membaca daftar invite. Pastikan juga Server Members Intent dan Guild Invites Intent tersedia di konfigurasi aplikasi.');
    const next = { ...cfg, ...(enabled === null ? {} : { enabled }), ...(channel ? { logChannelId: channel.id } : {}) };
    try {
      saveGuild(i.guildId, next);
      if (next.enabled) {
        try { inviteCache.set(i.guildId, await fetchSnapshot(i.guild)); }
        catch (error) { return reply(i, `Konfigurasi disimpan, tetapi bot belum dapat membaca invite: ${safeText(error.message, 180)}. Periksa izin Manage Server dan coba lagi.`); }
      }
      return reply(i, `Konfigurasi invite tracking disimpan.\nStatus: **${next.enabled ? 'aktif' : 'nonaktif'}**\nChannel log: ${next.logChannelId ? `<#${next.logChannelId}>` : 'belum diatur'}`);
    } catch (error) { return reply(i, `Gagal menyimpan konfigurasi: ${safeText(error.message, 180)}`); }
  }
  if (subcommand === 'stats') {
    const user = i.options.getUser('user') || i.user;
    const count = Math.max(0, Number(cfg.counts[user.id]) || 0);
    return reply(i, `**Invite tracking — ${user.tag || user.username}**\nAnggota yang tercatat diundang: **${count}**\nStatus tracking: **${cfg.enabled ? 'aktif' : 'nonaktif'}**\n-# Jumlah ini merupakan catatan join yang berhasil dicocokkan, bukan total invite yang masih aktif.`);
  }
  return false;
}
async function logJoin(guild, cfg, member, invite) {
  const channelId = cfg.logChannelId;
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.() || !channel.permissionsFor(guild.members.me)?.has([P.ViewChannel, P.SendMessages])) return;
  const inviteLine = invite ? `**Invite:** \`${safeText(invite.code, 60)}\`\n**Pengundang:** <@${invite.inviterId}>` : '**Invite:** tidak dapat ditentukan (vanity, cache belum siap, atau invite eksternal).';
  const container = new ContainerBuilder().addTextDisplayComponents(text('## INVITE TRACKING'), text(`**Anggota baru:** <@${member.id}>\n${inviteLine}\n-# Data hanya mencatat kode invite yang dapat dicocokkan.`)).addSeparatorComponents(line());
  await channel.send({ components: [container], flags: V2, allowedMentions: { parse: [] } }).catch((error) => console.warn('[invites] Gagal mengirim log join:', error.message));
}
async function onMemberAdd(member) {
  if (!healthy || !member.guild || !member.guild.id) return;
  const cfg = getGuild(member.guild.id);
  if (!cfg.enabled) return;
  try {
    let previous = inviteCache.get(member.guild.id);
    if (!previous) previous = await fetchSnapshot(member.guild);
    const current = await fetchSnapshot(member.guild);
    inviteCache.set(member.guild.id, current);
    const used = findUsedInvite(previous, current);
    const records = { ...cfg.joinRecords, [member.id]: { inviterId: used?.inviterId || null, inviteCode: used?.code || null, joinedAt: Date.now() } };
    const keys = Object.keys(records);
    for (const key of keys.slice(0, Math.max(0, keys.length - 5000))) delete records[key];
    const counts = { ...cfg.counts };
    if (used?.inviterId) counts[used.inviterId] = (Math.max(0, Number(counts[used.inviterId]) || 0) + 1);
    const next = { ...cfg, counts, joinRecords: records };
    saveGuild(member.guild.id, next);
    await logJoin(member.guild, next, member, used);
  } catch (error) { console.warn(`[invites] Tidak dapat melacak join pada guild ${member.guild.id}:`, error.message); }
}
function setup(client) {
  client.once(Events.ClientReady, async (readyClient) => {
    for (const guild of readyClient.guilds.cache.values()) {
      if (!getGuild(guild.id).enabled) continue;
      try { inviteCache.set(guild.id, await fetchSnapshot(guild)); }
      catch (error) { console.warn(`[invites] Cache invite tidak tersedia untuk guild ${guild.id}: ${error.message}`); }
    }
  });
  client.on(Events.InviteCreate, (invite) => {
    if (!invite.guild) return;
    const current = inviteCache.get(invite.guild.id) || [];
    const next = current.filter((entry) => entry.code !== invite.code);
    next.push({ code: invite.code, uses: Number(invite.uses) || 0, inviterId: invite.inviter?.id || invite.inviterId || null });
    inviteCache.set(invite.guild.id, next);
  });
  client.on(Events.InviteDelete, (invite) => {
    if (!invite.guild) return;
    inviteCache.set(invite.guild.id, (inviteCache.get(invite.guild.id) || []).filter((entry) => entry.code !== invite.code));
  });
  client.on(Events.GuildMemberAdd, (member) => { void onMemberAdd(member); });
}
async function handle(i) {
  if (!i.isChatInputCommand() || i.commandName !== 'invites') return false;
  const subcommand = i.options.getSubcommand();
  if (!['setup', 'stats'].includes(subcommand)) return false;
  await handleCommand(i, subcommand); return true;
}
module.exports = { name: 'invites', commands, intents: [GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildInvites], setup, handle };
