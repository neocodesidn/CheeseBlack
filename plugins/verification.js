const { atomicWriteJson } = require('../lib/json-storage');
const fs = require('fs');
const path = require('path');
const {
  MessageFlags,
  ButtonStyle,
  ButtonBuilder,
  ActionRowBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  AttachmentBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { generateCode, renderCaptcha } = require('../lib/captcha');
const { sendLog } = require('../lib/logger');
const { editTrackedPanel } = require('../lib/panel-updater');

// ───────────── Konfigurasi ─────────────
const CODE_LENGTH = 5;
const MAX_ATTEMPTS = 3;
const SESSION_TTL_MS = 2 * 60 * 1000; // 2 menit
const COOLDOWN_MS = 60 * 1000; // 1 menit setelah gagal 3x

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const ID = {
  START: 'verify:start',
  ANSWER: 'verify:answer',
  REFRESH: 'verify:refresh',
  MODAL: 'verify:modal',
  INPUT: 'code',
};

const EPHEMERAL = MessageFlags.Ephemeral;
const EPHEMERAL_V2 = MessageFlags.IsComponentsV2 | EPHEMERAL;

// ───────────── Storage config (guildId -> { roleId }) ─────────────
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error('Gagal membaca data yang sudah ada: ' + err.message);
    return {};
  }
}
function saveConfig(cfg) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  atomicWriteJson(CONFIG_FILE, cfg);
}
const config = loadConfig();

// ───────────── Session & cooldown (in-memory) ─────────────
const sessions = new Map(); // key -> { code, expiresAt, attempts }
const cooldowns = new Map(); // key -> timestamp berakhir
const keyOf = (guildId, userId) => `${guildId}:${userId}`;

setInterval(() => {
  const now = Date.now();
  for (const [k, s] of sessions) if (s.expiresAt <= now) sessions.delete(k);
  for (const [k, t] of cooldowns) if (t <= now) cooldowns.delete(k);
}, 60 * 1000).unref();

// ───────────── UI (Components V2, tanpa warna) ─────────────
// ContainerBuilder TANPA setAccentColor() => tidak ada garis warna di samping.
// Tombol memakai ButtonStyle.Secondary (abu-abu netral) supaya tetap tanpa warna.
const text = (content) => new TextDisplayBuilder().setContent(content);
const divider = () =>
  new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const button = (id, label) =>
  new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(ButtonStyle.Secondary);

function panelMessage(guildId) {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(text(`# Verifikasi`))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(
      text(
        'Selamat datang! Untuk mengakses server ini, selesaikan verifikasi captcha terlebih dahulu.\n' +
          'Klik tombol **Verifikasi** di bawah untuk memulai.'
      )
    )
    .addActionRowComponents(new ActionRowBuilder().addComponents(button(ID.START, 'Verifikasi')));

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function hasCustomId(message, customId) {
  const visit = (components) => (components || []).some((component) =>
    component.customId === customId || visit(component.components) || visit(component.accessory ? [component.accessory] : [])
  );
  return visit(message?.components);
}

async function findExistingVerificationPanel(channel, botUserId) {
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  return messages?.find((message) => message.author?.id === botUserId && hasCustomId(message, ID.START)) ?? null;
}

function captchaMessage(buffer, session) {
  const filename = `captcha-${Date.now()}.png`;
  const expiresTs = Math.floor(session.expiresAt / 1000);
  const attemptsLeft = MAX_ATTEMPTS - session.attempts;

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      text(
        '## Captcha\n' +
          `Ketik **${CODE_LENGTH} karakter** pada gambar di bawah.\n` +
          `Sisa percobaan: **${attemptsLeft}** • Berlaku <t:${expiresTs}:R>`
      )
    )
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${filename}`)
      )
    )
    .addSeparatorComponents(divider())
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        button(ID.ANSWER, 'Masukkan Kode'),
        button(ID.REFRESH, 'Ganti Gambar')
      )
    );

  return {
    components: [container],
    files: [new AttachmentBuilder(buffer, { name: filename })],
  };
}

function resultMessage(title, body) {
  const container = new ContainerBuilder().addTextDisplayComponents(text(`## ${title}\n${body}`));
  return { components: [container], files: [], attachments: [] };
}

const SESSION_ENDED = () =>
  resultMessage('Sesi berakhir', 'Klik tombol **Verifikasi** pada panel untuk memulai lagi.');

const deny = (i, content) => i.reply({ content, flags: EPHEMERAL });

// ───────────── Command & interaksi ─────────────
const commands = [
  new SlashCommandBuilder()
    .setName('verification')
    .setDescription('Pengelolaan verifikasi anggota')
    .addSubcommand((sub) => sub.setName('setup').setDescription('Pasang panel verifikasi captcha')
      .addRoleOption((o) => o.setName('role').setDescription('Role setelah verifikasi berhasil').setRequired(true)))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(0)
    .toJSON(),
];

async function setupCommand(i) {
  if (!i.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return deny(i, 'Perintah ini khusus Administrator.');
  }
  const role = i.options.getRole('role', true);
  const me = i.guild.members.me;
  const channel = i.channel;

  if (role.managed || role.id === i.guild.id) {
    return deny(i, 'Role tersebut tidak bisa dipakai (role bot/integrasi atau @everyone).');
  }
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles) || role.comparePositionTo(me.roles.highest) >= 0) {
    return deny(
      i,
      'Bot tidak bisa memberikan role itu. Pastikan bot punya izin **Manage Roles** dan posisi role bot berada **di atas** role tujuan.'
    );
  }
  if (!channel?.isTextBased?.() || !channel.messages || !channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
    return deny(i, 'Bot membutuhkan izin View Channel dan Send Messages di channel ini.');
  }

  await i.deferReply({ flags: EPHEMERAL });
  const previous = config[i.guildId] || {};
  let existingMessage = null;
  if (previous.panel?.channelId === channel.id && previous.panel?.messageId) {
    existingMessage = await channel.messages.fetch(previous.panel.messageId).catch(() => null);
  }
  if (!existingMessage && (!previous.panel || previous.panel.channelId === channel.id)) {
    existingMessage = await findExistingVerificationPanel(channel, i.client.user.id);
  }

  let message;
  try {
    if (existingMessage) message = await existingMessage.edit(panelMessage(i.guildId));
    else message = await channel.send(panelMessage(i.guildId));
  } catch (err) {
    console.error('[verification] Gagal memasang atau memperbarui panel:', err.message);
    return i.editReply(existingMessage
      ? 'Panel verifikasi yang ada gagal diperbarui. Pesan lama dipertahankan; periksa permission bot.'
      : 'Gagal mengirim panel verifikasi. Periksa permission bot di channel ini.');
  }

  config[i.guildId] = {
    ...previous,
    roleId: role.id,
    panel: { channelId: channel.id, messageId: message.id },
  };
  saveConfig(config);

  if (previous.panel?.channelId && previous.panel.channelId !== channel.id && previous.panel.messageId) {
    const oldChannel = await i.guild.channels.fetch(previous.panel.channelId).catch(() => null);
    const oldMessage = oldChannel?.isTextBased()
      ? await oldChannel.messages.fetch(previous.panel.messageId).catch(() => null)
      : null;
    if (oldMessage) await oldMessage.delete().catch(() => {});
  }

  return i.editReply(`Panel verifikasi ${existingMessage ? 'diperbarui pada pesan yang sama' : 'dipasang'}. Role verifikasi: ${role}`);
}

async function onStart(i) {
  const cfg = config[i.guildId];
  const key = keyOf(i.guildId, i.user.id);

  if (!cfg) return deny(i, 'Verifikasi belum dikonfigurasi. Hubungi admin.');
  if (i.member.roles.cache.has(cfg.roleId)) return deny(i, 'Kamu sudah terverifikasi.');

  const cd = cooldowns.get(key);
  if (cd && cd > Date.now()) {
    return deny(i, `Terlalu banyak percobaan gagal. Coba lagi <t:${Math.floor(cd / 1000)}:R>.`);
  }

  const code = generateCode(CODE_LENGTH);
  const session = { code, attempts: 0, expiresAt: Date.now() + SESSION_TTL_MS };
  sessions.set(key, session);

  return i.reply({ ...captchaMessage(renderCaptcha(code), session), flags: EPHEMERAL_V2 });
}

async function onRefresh(i) {
  const session = sessions.get(keyOf(i.guildId, i.user.id));
  if (!session || session.expiresAt <= Date.now()) return i.update(SESSION_ENDED());

  session.code = generateCode(CODE_LENGTH);
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return i.update({ ...captchaMessage(renderCaptcha(session.code), session), attachments: [] });
}

async function onAnswer(i) {
  const session = sessions.get(keyOf(i.guildId, i.user.id));
  if (!session || session.expiresAt <= Date.now()) return i.update(SESSION_ENDED());

  const modal = new ModalBuilder()
    .setCustomId(ID.MODAL)
    .setTitle('Masukkan Kode Captcha')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(ID.INPUT)
          .setLabel(`Kode (${CODE_LENGTH} karakter)`)
          .setStyle(TextInputStyle.Short)
          .setMinLength(CODE_LENGTH)
          .setMaxLength(CODE_LENGTH)
          .setPlaceholder('Contoh: A7K2M')
          .setRequired(true)
      )
    );
  return i.showModal(modal);
}

async function onModal(i) {
  const cfg = config[i.guildId];
  const key = keyOf(i.guildId, i.user.id);
  const session = sessions.get(key);

  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(key);
    return i.isFromMessage() ? i.update(SESSION_ENDED()) : i.reply({ ...SESSION_ENDED(), flags: EPHEMERAL_V2 });
  }

  const input = i.fields.getTextInputValue(ID.INPUT).trim().toUpperCase();

  // Benar
  if (input === session.code) {
    sessions.delete(key);
    try {
      await i.member.roles.add(cfg.roleId, 'Verifikasi captcha berhasil');
    } catch (err) {
      console.error('Gagal memberi role:', err);
      return i.update(resultMessage('Gagal', 'Captcha benar, tetapi bot gagal memberi role. Hubungi admin.'));
    }
    sendLog(i.guild, {
      title: 'Verifikasi berhasil',
      body: `<@${i.user.id}> (${i.user.username}) lolos captcha.`,
      category: 'verification',
    });
    return i.update(resultMessage('Berhasil', 'Verifikasi selesai. Selamat datang di server!'));
  }

  // Salah
  session.attempts += 1;
  if (session.attempts >= MAX_ATTEMPTS) {
    sessions.delete(key);
    const until = Date.now() + COOLDOWN_MS;
    cooldowns.set(key, until);
    return i.update(
      resultMessage('Verifikasi gagal', `Kode salah ${MAX_ATTEMPTS} kali. Coba lagi <t:${Math.floor(until / 1000)}:R>.`)
    );
  }

  // Kode baru setiap salah, supaya tidak bisa ditebak berulang
  session.code = generateCode(CODE_LENGTH);
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return i.update({ ...captchaMessage(renderCaptcha(session.code), session), attachments: [] });
}

async function handle(interaction) {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName !== 'verification' || interaction.options.getSubcommand() !== 'setup') return false;
    await setupCommand(interaction);
    return true;
  }

  if (!interaction.inGuild()) return false;

  if (interaction.isButton()) {
    const handlers = { [ID.START]: onStart, [ID.REFRESH]: onRefresh, [ID.ANSWER]: onAnswer };
    const fn = handlers[interaction.customId];
    if (!fn) return false;
    await fn(interaction);
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId === ID.MODAL) {
    await onModal(interaction);
    return true;
  }
  return false;
}

async function refreshPublicPanels(guild) {
  return [await editTrackedPanel(guild, config[guild.id]?.panel, panelMessage(guild.id))];
}

module.exports = { name: 'verification', commands, handle, refreshPublicPanels };
