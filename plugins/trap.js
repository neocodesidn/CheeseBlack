'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits: P,
  SlashCommandBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SectionBuilder,
  TextDisplayBuilder,
} = require('discord.js');
const { atomicWriteJson, readJson } = require('../lib/json-storage');
const { isOwner } = require('../lib/owner-access');
const panelRegistry = require('../lib/panel-registry');
const { editTrackedPanel } = require('../lib/panel-updater');
const securityAudit = require('../lib/security-audit');
const logger = require('../lib/console-logger');
const {
  DEFAULT_CONFIG,
  ID_PATTERN,
  MAX_EXEMPTIONS,
  normalizeConfig,
  incrementIncidentCounters,
  isExempt,
  createTrapEngine,
} = require('../lib/trap-engine');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'trap.json');
const PANEL_KIND = 'trap';
const PANEL_COUNT_ID = 'trap:count:';
const V2 = MessageFlags.IsComponentsV2;
const EPHEMERAL_V2 = V2 | MessageFlags.Ephemeral;
const text = (content) => new TextDisplayBuilder().setContent(content);
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const engine = createTrapEngine();

let storageHealthy = true;
let configs = {};
try {
  const stored = readJson(FILE, {});
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    throw new Error('Root trap.json harus berupa object.');
  }
  configs = Object.fromEntries(Object.entries(stored)
    .filter(([guildId, value]) => ID_PATTERN.test(guildId) && value && typeof value === 'object' && !Array.isArray(value))
    .map(([guildId, value]) => [guildId, normalizeConfig(value)]));
} catch (error) {
  storageHealthy = false;
  logger.error({ err: error }, 'COMMUNITY TRAP: konfigurasi tidak dapat dibaca; deteksi otomatis dinonaktifkan sampai file dipulihkan');
}

function getConfig(guildId) {
  return normalizeConfig(configs[guildId] ?? DEFAULT_CONFIG);
}

function saveConfig(guildId, patch) {
  if (!storageHealthy) throw new Error('data/trap.json bermasalah. Pulihkan file dari backup sebelum mengubah konfigurasi.');
  if (!ID_PATTERN.test(String(guildId || ''))) throw new Error('ID server tidak valid.');
  const next = normalizeConfig({ ...getConfig(guildId), ...patch });
  const nextConfigs = { ...configs, [guildId]: next };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  atomicWriteJson(FILE, nextConfigs);
  configs = nextConfigs;
  return next;
}

function recordIncident(guildId, incident) {
  const current = getConfig(guildId);
  const nextIncident = {
    id: String(incident.id || '').slice(0, 80),
    userId: incident.userId || null,
    username: String(incident.username || 'unknown').slice(0, 80),
    channelId: incident.channelId || null,
    isBot: incident.isBot === true,
    isWebhook: incident.isWebhook === true,
    messageDeleted: incident.messageDeleted === true,
    actionResult: String(incident.actionResult || 'unknown').slice(0, 120),
    detectedAt: Number(incident.detectedAt) || Date.now(),
  };
  return saveConfig(guildId, {
    ...incrementIncidentCounters(current, nextIncident),
    lastTriggeredAt: nextIncident.detectedAt,
    recentIncidents: [...current.recentIncidents, nextIncident].slice(-25),
  });
}

function panelPayload(guildId, guild = null) {
  const cfg = getConfig(guildId);
  const warning = new SectionBuilder()
    .addTextDisplayComponents(text(
      '**DO NOT SEND MESSAGES IN THIS CHANNEL!**\n' +
      'This channel is used to catch spam bots. Any messages sent here will result in an automatic kick.'
    ));

  const container = new ContainerBuilder()
    .addSectionComponents(warning)
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PANEL_COUNT_ID}${guildId}`)
        .setLabel(`Kicks: ${cfg.kickCount}`)
        
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    ));

  return {
    components: [container],
    attachments: [],
    flags: V2,
    allowedMentions: { parse: [] },
  };
}

function responsePayload(title, body) {
  return {
    components: [new ContainerBuilder().addTextDisplayComponents(text(`## ${title}\n${body}`))],
    flags: EPHEMERAL_V2,
    allowedMentions: { parse: [] },
  };
}

async function reply(interaction, title, body) {
  return interaction.reply(responsePayload(title, body));
}

function canManage(interaction) {
  return Boolean(interaction.inGuild?.() && (
    interaction.memberPermissions?.has(P.ManageGuild) || isOwner(interaction.user?.id)
  ));
}

function channelTypeIsText(channel) {
  return Boolean(channel && channel.type === ChannelType.GuildText && channel.messages);
}

function everyoneCanUse(channel, guild) {
  const permissions = channel.permissionsFor(guild.roles.everyone);
  return Boolean(permissions?.has(P.ViewChannel) && permissions?.has(P.SendMessages));
}

async function setupTrap(interaction) {
  if (!storageHealthy) return reply(interaction, 'PENYIMPANAN BERMASALAH', 'Konfigurasi tidak dapat dibaca. Perbaiki `data/trap.json` sebelum mengaktifkan deteksi.');
  const trapChannel = interaction.options.getChannel('channel', true);
  const logChannel = interaction.options.getChannel('log-channel', true);
  const confirmed = interaction.options.getBoolean('confirm-kick', true);
  if (!confirmed) {
    return reply(interaction, 'KONFIRMASI DIPERLUKAN', 'Aktivasi dibatalkan. Semua pesan dari anggota non-staff di channel honeypot akan memicu penghapusan pesan dan percobaan kick.');
  }
  if (!channelTypeIsText(trapChannel) || !channelTypeIsText(logChannel)) {
    return reply(interaction, 'CHANNEL TIDAK VALID', 'Pilih dua channel teks server biasa.');
  }
  if (trapChannel.id === logChannel.id) {
    return reply(interaction, 'CHANNEL TIDAK BOLEH SAMA', 'Pisahkan channel honeypot dan channel security log.');
  }

  const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
  if (!botMember?.permissions.has(P.KickMembers)) {
    return reply(interaction, 'IZIN BOT BELUM CUKUP', 'Bot membutuhkan izin **Kick Members** pada server.');
  }
  if (!trapChannel.permissionsFor(botMember)?.has([P.ViewChannel, P.ManageMessages])) {
    return reply(interaction, 'IZIN CHANNEL BELUM CUKUP', `Bot membutuhkan **View Channel** dan **Manage Messages** di ${trapChannel}.`);
  }
  if (!logChannel.permissionsFor(botMember)?.has([P.ViewChannel, P.SendMessages])) {
    return reply(interaction, 'IZIN LOG BELUM CUKUP', `Bot membutuhkan **View Channel** dan **Send Messages** di ${logChannel}.`);
  }

  let cfg;
  try {
    cfg = saveConfig(interaction.guildId, {
      enabled: true,
      channelId: trapChannel.id,
      logChannelId: logChannel.id,
      action: 'kick',
      deleteMessage: true,
    });
  } catch (error) {
    logger.error({ err: error, guildId: interaction.guildId }, 'COMMUNITY TRAP: gagal menyimpan konfigurasi');
    return reply(interaction, 'GAGAL MENYIMPAN', String(error.message || error).slice(0, 500));
  }

  const publicWarning = everyoneCanUse(trapChannel, interaction.guild)
    ? ''
    : '\n\n**Perhatian:** @everyone belum memiliki izin View Channel dan Send Messages. Akun umum mungkin tidak dapat memicu honeypot.';
  return reply(
    interaction,
    'COMMUNITY TRAP AKTIF',
    `**Channel honeypot:** ${trapChannel}\n**Security log:** ${logChannel}\n**Tindakan otomatis:** Kick Member\n**Hapus pesan pemicu:** Aktif\n**Whitelist:** ${cfg.exemptUserIds.length} user · ${cfg.exemptRoleIds.length} role\n\nPemilik server, Bot Owner, anggota dengan izin moderasi/administrasi, serta user/role whitelist dikecualikan.${publicWarning}\n\nGunakan command /trap panel untuk memasang pesan peringatan COMMUNITY TRAP.`
  );
}

async function disableTrap(interaction) {
  try {
    saveConfig(interaction.guildId, { enabled: false });
    return reply(interaction, 'COMMUNITY TRAP DINONAKTIFKAN', 'Deteksi honeypot dihentikan. Channel, whitelist, dan histori tetap disimpan. Jalankan `/trap setup` untuk mengaktifkan kembali.');
  } catch (error) {
    return reply(interaction, 'GAGAL MENONAKTIFKAN', String(error.message || error).slice(0, 500));
  }
}

async function status(interaction) {
  const cfg = getConfig(interaction.guildId);
  const last = cfg.lastTriggeredAt ? `<t:${Math.floor(cfg.lastTriggeredAt / 1000)}:F>` : 'Belum ada';
  return reply(
    interaction,
    'COMMUNITY TRAP STATUS',
    `**Status:** ${cfg.enabled ? 'Aktif' : 'Nonaktif'}\n**Channel honeypot:** ${cfg.channelId ? `<#${cfg.channelId}>` : 'Belum diatur'}\n**Security log:** ${cfg.logChannelId ? `<#${cfg.logChannelId}>` : 'Belum diatur'}\n**Tindakan:** Kick Member\n**Total deteksi:** ${cfg.triggerCount}\n**Deteksi terakhir:** ${last}\n**Whitelist user:** ${cfg.exemptUserIds.length}\n**Whitelist role:** ${cfg.exemptRoleIds.length}\n**Penyimpanan:** ${storageHealthy ? 'Normal' : 'Bermasalah'}\n\nGunakan command /trap setup untuk konfigurasi atau /trap disable untuk menonaktifkan.`
  );
}


async function history(interaction) {
  const cfg = getConfig(interaction.guildId);
  if (!cfg.recentIncidents.length) {
    return reply(interaction, 'COMMUNITY TRAP HISTORY', 'Belum ada aktivitas yang memicu honeypot.');
  }
  const lines = cfg.recentIncidents.slice(-10).reverse().map((incident, index) => {
    const actor = incident.userId ? `<@${incident.userId}> (${incident.username})` : incident.username;
    const when = incident.detectedAt ? `<t:${Math.floor(incident.detectedAt / 1000)}:R>` : 'waktu tidak tersedia';
    return `**${index + 1}. ${actor}** · ${when}\nChannel: <#${incident.channelId}> · ${incident.isBot ? 'Bot' : incident.isWebhook ? 'Webhook' : 'User'}\nHasil: ${incident.actionResult}`;
  });
  return reply(interaction, '10 DETEKSI TERAKHIR', lines.join('\n\n').slice(0, 3800));
}

async function manageWhitelist(interaction, type) {
  const isUser = type === 'user';
  const selected = isUser ? interaction.options.getUser('user', true) : interaction.options.getRole('role', true);
  const action = interaction.options.getString('action', true);
  const cfg = getConfig(interaction.guildId);
  const key = isUser ? 'exemptUserIds' : 'exemptRoleIds';
  const values = [...cfg[key]];
  const exists = values.includes(selected.id);
  if (action === 'add' && !exists) {
    if (values.length >= MAX_EXEMPTIONS) return reply(interaction, 'BATAS WHITELIST TERCAPAI', `Maksimal ${MAX_EXEMPTIONS} ${isUser ? 'user' : 'role'} whitelist.`);
    values.push(selected.id);
  } else if (action === 'remove' && exists) {
    values.splice(values.indexOf(selected.id), 1);
  } else {
    return reply(interaction, 'WHITELIST TIDAK BERUBAH', action === 'add' ? 'Item tersebut sudah ada di whitelist.' : 'Item tersebut tidak ditemukan di whitelist.');
  }
  try {
    saveConfig(interaction.guildId, { [key]: values });
    return reply(interaction, 'WHITELIST DIPERBARUI', `${isUser ? `<@${selected.id}>` : `<@&${selected.id}>`} ${action === 'add' ? 'ditambahkan ke' : 'dihapus dari'} whitelist COMMUNITY TRAP.`);
  } catch (error) {
    return reply(interaction, 'GAGAL MENYIMPAN WHITELIST', String(error.message || error).slice(0, 500));
  }
}

async function deployPanel(interaction) {
  const channel = interaction.channel;
  if (!channelTypeIsText(channel)) {
    return reply(interaction, 'CHANNEL TIDAK VALID', 'Jalankan command ini di channel teks tempat panel COMMUNITY TRAP ingin dipasang.');
  }
  const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
  if (!botMember || !channel.permissionsFor(botMember)?.has([P.ViewChannel, P.SendMessages, P.ReadMessageHistory])) {
    return reply(interaction, 'IZIN PANEL BELUM CUKUP', 'Bot membutuhkan View Channel, Send Messages, dan Read Message History di channel ini.');
  }

  const existing = panelRegistry.get(interaction.guildId, PANEL_KIND);
  let existingMessage = null;
  if (existing) {
    const existingChannel = interaction.guild.channels.cache.get(existing.channelId)
      || await interaction.guild.channels.fetch(existing.channelId).catch(() => null);
    existingMessage = existingChannel?.messages
      ? await existingChannel.messages.fetch(existing.messageId).catch(() => null)
      : null;
    if (existingMessage && existing.channelId !== channel.id) {
      return reply(interaction, 'PANEL SUDAH TERPASANG', `Panel aktif berada di <#${existing.channelId}>. Hapus pesan panel lama secara manual jika ingin memindahkannya, lalu jalankan command ini di channel baru.`);
    }
  }

  try {
    const message = existingMessage
      ? await existingMessage.edit(panelPayload(interaction.guildId, interaction.guild))
      : await channel.send(panelPayload(interaction.guildId, interaction.guild));
    panelRegistry.set(interaction.guildId, PANEL_KIND, { channelId: channel.id, messageId: message.id });
    return reply(interaction, existingMessage ? 'PANEL DIPERBARUI' : 'PANEL DIPASANG', `Panel COMMUNITY TRAP ${existingMessage ? 'diperbarui pada pesan yang sama' : `berhasil dipasang di ${channel}`}. Panel akan ikut diperbarui oleh panel updater.`);
  } catch (error) {
    logger.error({ err: error, guildId: interaction.guildId, channelId: channel.id }, 'COMMUNITY TRAP: gagal memasang panel');
    return reply(interaction, 'GAGAL MEMASANG PANEL', 'Periksa izin bot dan coba lagi. Pesan panel lama tidak sengaja dihapus.');
  }
}

async function handleMessage(message) {
  if (!message?.guild || !message.author || message.system) return false;
  const guildId = message.guild.id;
  const cfg = getConfig(guildId);
  if (!storageHealthy || !cfg.enabled || message.channelId !== cfg.channelId) return false;
  if (message.author.id === message.client?.user?.id) return false;

  // Webhook messages have no kickable guild member. Delete and report them instead.
  const isWebhook = Boolean(message.webhookId);
  let member = null;
  if (!isWebhook) {
    member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
    const roleIds = member?.roles?.cache ? [...member.roles.cache.keys()] : [];
    const permissionNames = [
      'Administrator', 'ManageGuild', 'ManageMessages', 'ModerateMembers',
      'KickMembers', 'BanMembers', 'ManageChannels', 'ManageRoles',
    ].filter((name) => {
      const bit = P[name];
      return typeof bit === 'bigint' && member?.permissions?.has(bit);
    });
    if (isExempt({
      userId: message.author.id,
      guildOwnerId: message.guild.ownerId,
      botOwnerIds: isOwner(message.author.id) ? [message.author.id] : [],
      config: cfg,
      roleIds,
      permissionNames,
    })) return false;
  }

  const actorId = isWebhook ? `webhook:${message.webhookId}` : message.author.id;
  if (!engine.claim({ guildId, userId: actorId })) return false;

  let messageDeleted = false;
  if (cfg.deleteMessage) {
    messageDeleted = await message.delete().then(() => true).catch((error) => {
      logger.warn({ err: error, guildId, channelId: message.channelId, messageId: message.id }, 'COMMUNITY TRAP: gagal menghapus pesan pemicu');
      return false;
    });
  }

  let actionResult = isWebhook
    ? (messageDeleted ? 'webhook: pesan dihapus; tidak ada member untuk di-kick' : 'webhook: gagal menghapus pesan; tidak ada member untuk di-kick')
    : 'member tidak ditemukan; kick tidak dilakukan';
  if (!isWebhook && member) {
    const botMember = message.guild.members.me || await message.guild.members.fetchMe().catch(() => null);
    if (!botMember?.permissions.has(P.KickMembers)) {
      actionResult = 'gagal: bot tidak memiliki izin Kick Members';
    } else if (!member.kickable) {
      actionResult = 'gagal: role target setara/lebih tinggi dari role bot atau target tidak dapat di-kick';
    } else {
      actionResult = await member.kick('COMMUNITY TRAP: honeypot channel triggered')
        .then(() => 'berhasil di-kick')
        .catch((error) => {
          logger.error({ err: error, guildId, userId: message.author.id }, 'COMMUNITY TRAP: Discord menolak kick member');
          return `gagal kick: ${String(error.message || error).slice(0, 100)}`;
        });
    }
  }

  const incident = {
    id: message.id,
    userId: isWebhook ? null : message.author.id,
    username: isWebhook ? `webhook ${message.webhookId}` : (message.author.tag || message.author.username),
    channelId: message.channelId,
    isBot: message.author.bot === true,
    isWebhook,
    messageDeleted,
    actionResult,
    detectedAt: Date.now(),
  };

  try {
    recordIncident(guildId, incident);
  } catch (error) {
    logger.error({ err: error, guildId, userId: incident.userId }, 'COMMUNITY TRAP: gagal menyimpan histori deteksi');
  }

  try {
    securityAudit.record({
      action: 'trap_triggered',
      actorId: incident.userId,
      guildId,
      details: {
        channelId: message.channelId,
        messageId: message.id,
        isBot: incident.isBot,
        isWebhook,
        messageDeleted,
        actionResult,
      },
    });
  } catch (error) {
    logger.warn({ err: error, guildId }, 'COMMUNITY TRAP: gagal menulis security audit');
  }

  logger.warn({
    guildId,
    userId: incident.userId,
    username: incident.username,
    channelId: message.channelId,
    isBot: incident.isBot,
    isWebhook,
    messageDeleted,
    actionResult,
  }, 'COMMUNITY TRAP: honeypot terpicu');

  await sendSecurityLog(message.guild, cfg, incident);
  return true;
}

async function sendSecurityLog(guild, cfg, incident) {
  const channel = guild.channels.cache.get(cfg.logChannelId)
    || await guild.channels.fetch(cfg.logChannelId).catch(() => null);
  if (!channel || !channelTypeIsText(channel)) {
    logger.error({ guildId: guild.id, logChannelId: cfg.logChannelId }, 'COMMUNITY TRAP: security log channel tidak ditemukan');
    return false;
  }
  const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!botMember || !channel.permissionsFor(botMember)?.has([P.ViewChannel, P.SendMessages])) {
    logger.error({ guildId: guild.id, logChannelId: cfg.logChannelId }, 'COMMUNITY TRAP: bot tidak memiliki izin mengirim security log');
    return false;
  }

  const actor = incident.userId ? `<@${incident.userId}> (${incident.username})` : incident.username;
  const timestamp = Math.floor(incident.detectedAt / 1000);
  const container = new ContainerBuilder()
    .addTextDisplayComponents(text('## COMMUNITY TRAP — DETEKSI HONEYPOT'))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text(
      `**Akun:** ${actor}\n` +
      `**Tipe akun:** ${incident.isWebhook ? 'Webhook' : incident.isBot ? 'Bot account' : 'User'}\n` +
      `**Channel:** <#${incident.channelId}>\n` +
      `**Pesan dihapus:** ${incident.messageDeleted ? 'Ya' : 'Gagal / tidak tersedia'}\n` +
      `**Tindakan:** ${incident.actionResult}\n` +
      `**Waktu:** <t:${timestamp}:F>\n` +
      '-# Isi pesan tidak disimpan atau disalin ke security log.'
    ));
  try {
    await channel.send({ components: [container], flags: V2, allowedMentions: { parse: [] } });
    return true;
  } catch (error) {
    logger.error({ err: error, guildId: guild.id, logChannelId: cfg.logChannelId }, 'COMMUNITY TRAP: gagal mengirim security log');
    return false;
  }
}

const commands = [
  new SlashCommandBuilder()
    .setName('trap')
    .setDescription('Konfigurasi COMMUNITY TRAP honeypot server')
    .addSubcommand((s) => s.setName('setup').setDescription('Aktifkan honeypot dan tentukan channel deteksi serta log')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel honeypot yang dipantau').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addChannelOption((o) => o.setName('log-channel').setDescription('Channel khusus security log').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addBooleanOption((o) => o.setName('confirm-kick').setDescription('Konfirmasi: pesan non-staff di channel ini akan memicu kick').setRequired(true)))
    .addSubcommand((s) => s.setName('status').setDescription('Lihat status COMMUNITY TRAP'))
    .addSubcommand((s) => s.setName('history').setDescription('Lihat 10 deteksi honeypot terakhir'))
    .addSubcommand((s) => s.setName('disable').setDescription('Nonaktifkan deteksi tanpa menghapus konfigurasi'))
    .addSubcommand((s) => s.setName('whitelist-user').setDescription('Tambahkan atau hapus user dari whitelist')
      .addUserOption((o) => o.setName('user').setDescription('User yang dikecualikan').setRequired(true))
      .addStringOption((o) => o.setName('action').setDescription('Aksi whitelist').setRequired(true).addChoices(
        { name: 'Tambahkan', value: 'add' }, { name: 'Hapus', value: 'remove' },
      )))
    .addSubcommand((s) => s.setName('whitelist-role').setDescription('Tambahkan atau hapus role dari whitelist')
      .addRoleOption((o) => o.setName('role').setDescription('Role yang dikecualikan').setRequired(true))
      .addStringOption((o) => o.setName('action').setDescription('Aksi whitelist').setRequired(true).addChoices(
        { name: 'Tambahkan', value: 'add' }, { name: 'Hapus', value: 'remove' },
      )))
    .addSubcommand((s) => s.setName('panel').setDescription('Pasang atau perbarui pesan peringatan COMMUNITY TRAP di channel ini'))
    .setContexts(0)
    .toJSON(),
];

async function handle(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'trap') return false;
  if (!interaction.inGuild() || !interaction.guild) {
    await reply(interaction, 'HANYA UNTUK SERVER', 'COMMUNITY TRAP hanya dapat dikonfigurasi di server Discord.');
    return true;
  }
  if (!canManage(interaction)) {
    await reply(interaction, 'AKSES DITOLAK', 'Perintah COMMUNITY TRAP membutuhkan izin **Manage Server** atau akses Bot Owner.');
    return true;
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'setup') await setupTrap(interaction);
  else if (subcommand === 'status') await status(interaction);
  else if (subcommand === 'history') await history(interaction);
  else if (subcommand === 'disable') await disableTrap(interaction);
  else if (subcommand === 'whitelist-user') await manageWhitelist(interaction, 'user');
  else if (subcommand === 'whitelist-role') await manageWhitelist(interaction, 'role');
  else if (subcommand === 'panel') await deployPanel(interaction);
  else return false;
  return true;
}

function setup(client) {
  client.on(Events.MessageCreate, (message) => {
    handleMessage(message).catch((error) => {
      logger.error({ err: error, guildId: message.guildId, channelId: message.channelId, messageId: message.id }, 'COMMUNITY TRAP: gagal memproses event pesan');
    });
  });
  const cleanup = setInterval(() => engine.cleanup(), 60 * 1000);
  cleanup.unref?.();
}

async function refreshPublicPanels(guild) {
  const target = panelRegistry.get(guild.id, PANEL_KIND);
  if (!target) return 'skipped';
  return editTrackedPanel(guild, target, panelPayload(guild.id, guild));
}

module.exports = {
  name: 'trap',
  intents: [GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers],
  commands,
  setup,
  handle,
  getConfig,
  panelPayload,
  handleMessage,
  refreshPublicPanels,
};
