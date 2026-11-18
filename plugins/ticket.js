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
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits: P,
} = require('discord.js');
const { sendLog } = require('../lib/logger');
const settings = require('../lib/settings');
const { editTrackedPanel } = require('../lib/panel-updater');
const { buildTranscript } = require('../lib/transcript');

// ───────────── Konfigurasi ─────────────
const COOLDOWN_MS = 30 * 1000; // jeda antar pembuatan tiket per user
const CLOSE_DELAY_MS = 5 * 1000; // jeda sebelum channel tiket dihapus

const DISCLAIMER =
  'Dilarang **spam** atau **main-main** dengan tiket. Pelanggaran akan dikenakan **ban permanen**.';

const ID = {
  OPEN: 'ticket:open',
  MODAL: 'ticket:modal',
  SUBJECT: 'subject',
  DETAIL: 'detail',
  CLOSE: 'ticket:close',
  CLOSE_YES: 'ticket:close:yes',
  CLOSE_NO: 'ticket:close:no',
};

const V2 = MessageFlags.IsComponentsV2;
const EPHEMERAL = MessageFlags.Ephemeral;

// ───────────── Storage (guildId -> { staffRoleId, categoryId }) ─────────────
const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'ticket.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error('Gagal membaca data yang sudah ada: ' + err.message);
    return {};
  }
}
function save(cfg) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  atomicWriteJson(FILE, cfg);
}

const config = load();
const cooldowns = new Map(); // `${guildId}:${userId}` -> timestamp

// ───────────── Helper ─────────────
const text = (content) => new TextDisplayBuilder().setContent(content);
const divider = () =>
  new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const button = (id, label) =>
  new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(ButtonStyle.Secondary);

const result = (title, body) => ({
  components: [new ContainerBuilder().addTextDisplayComponents(text(`## ${title}\n${body}`))],
});

// Penanda tiket disimpan di topic channel: "ticket:<userId>"
const isTicket = (ch) => ch?.type === ChannelType.GuildText && ch.topic?.startsWith('ticket:');
const ownerOf = (ch) => ch.topic.slice('ticket:'.length).split(' ')[0];
const findOpenTicket = (guild, userId) =>
  guild.channels.cache.find((c) => isTicket(c) && ownerOf(c) === userId);

function hasCustomId(message, customId) {
  const visit = (components) => (components || []).some((component) =>
    component.customId === customId || visit(component.components) || visit(component.accessory ? [component.accessory] : [])
  );
  return visit(message?.components);
}

async function findExistingTicketPanel(channel, botUserId) {
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  return messages?.find((message) => message.author?.id === botUserId && hasCustomId(message, ID.OPEN)) ?? null;
}

// ───────────── UI (Components V2, tanpa warna) ─────────────
function panelMessage(guildId) {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(text(`# Tiket Bantuan`))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(
      text(
        'Butuh bantuan, ingin melapor, atau punya pertanyaan?\n' +
          'Buat tiket dan staff akan membantumu secara pribadi.'
      )
    )
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text(`### Disclaimer\n${DISCLAIMER}`))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(button(ID.OPEN, 'Buat Tiket'))
    );
  return { components: [container], flags: V2 };
}

function ticketMessage(user, staffRoleId, subject, detail) {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      text(`## Tiket Baru\nDibuat oleh <@${user.id}> • Staff: <@&${staffRoleId}>`)
    )
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text(`**Subjek**\n${subject}\n\n**Detail**\n${detail}`))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text(`-# ${DISCLAIMER}`))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(button(ID.CLOSE, 'Tutup Tiket'))
    );
  return {
    components: [container],
    flags: V2,
    // Cegah user menyisipkan @everyone/@role lewat isi tiket
    allowedMentions: { users: [user.id], roles: [staffRoleId] },
  };
}

function closeConfirmMessage() {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      text('## Tutup tiket?\nChannel ini akan dihapus permanen dan tidak bisa dikembalikan.')
    )
    .addSeparatorComponents(divider())
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        button(ID.CLOSE_YES, 'Ya, tutup'),
        button(ID.CLOSE_NO, 'Batal')
      )
    );
  return { components: [container], flags: V2 | EPHEMERAL };
}

// ───────────── Handler ─────────────
async function setup(interaction) {
  if (!interaction.memberPermissions?.has(P.Administrator)) {
    return interaction.reply({ content: 'Perintah ini khusus Administrator.', flags: EPHEMERAL });
  }
  const guild = interaction.guild;
  const staff = interaction.options.getRole('staff-role', true);
  const category = interaction.options.getChannel('category');
  const picked = interaction.options.getChannel('channel');
  const target = picked ? guild.channels.cache.get(picked.id) : interaction.channel;

  if (staff.managed || staff.id === guild.id) {
    return interaction.reply({
      content: 'Role staff tidak valid (role bot/integrasi atau @everyone).',
      flags: EPHEMERAL,
    });
  }
  if (!guild.members.me.permissions.has(P.ManageChannels)) {
    return interaction.reply({
      content: 'Bot butuh permission **Manage Channels** untuk membuat channel tiket.',
      flags: EPHEMERAL,
    });
  }
  if (!target?.isTextBased?.() || !target.messages) {
    return interaction.reply({ content: 'Pilih channel teks yang dapat menyimpan panel.', flags: EPHEMERAL });
  }
  if (!target.permissionsFor(guild.members.me)?.has([P.ViewChannel, P.SendMessages])) {
    return interaction.reply({
      content: `Bot tidak bisa mengirim pesan ke ${target}. Cek permission bot di channel itu.`,
      flags: EPHEMERAL,
    });
  }

  await interaction.deferReply({ flags: EPHEMERAL });
  const previous = config[guild.id] || {};
  let message = null;
  if (previous.panel?.channelId === target.id && previous.panel?.messageId) {
    message = await target.messages.fetch(previous.panel.messageId).catch(() => null);
  }
  if (!message && (!previous.panel || previous.panel.channelId === target.id)) {
    message = await findExistingTicketPanel(target, guild.client.user.id);
  }

  let updated = false;
  try {
    if (message) {
      await message.edit(panelMessage(guild.id));
      updated = true;
    } else {
      message = await target.send(panelMessage(guild.id));
    }
  } catch (err) {
    console.error('[ticket] Gagal memasang atau memperbarui panel:', err.message);
    return interaction.editReply({
      content: message
        ? 'Panel tiket yang ada gagal diperbarui. Pesan lama dipertahankan; periksa permission bot.'
        : `Bot tidak bisa mengirim panel ke ${target}. Cek permission bot di channel tujuan.`,
    });
  }

  config[guild.id] = {
    ...previous,
    staffRoleId: staff.id,
    categoryId: category?.id ?? null,
    panel: { channelId: target.id, messageId: message.id },
  };
  settings.set(guild.id, { ticketStaffRoleId: staff.id });
  save(config);

  if (previous.panel?.channelId && previous.panel.channelId !== target.id && previous.panel.messageId) {
    const oldChannel = await guild.channels.fetch(previous.panel.channelId).catch(() => null);
    const oldMessage = oldChannel?.isTextBased()
      ? await oldChannel.messages.fetch(previous.panel.messageId).catch(() => null)
      : null;
    if (oldMessage) await oldMessage.delete().catch(() => {});
  }

  return interaction.editReply({
    content: `Panel tiket ${updated ? 'diperbarui' : 'dipasang'} di ${target}. Staff: ${staff}${category ? ` • Kategori: ${category}` : ''}`,
  });
}

async function openModal(interaction) {
  const { guild, user } = interaction;
  if (!config[guild.id]) {
    return interaction.reply({
      content: 'Sistem tiket belum dikonfigurasi. Hubungi admin.',
      flags: EPHEMERAL,
    });
  }

  const existing = findOpenTicket(guild, user.id);
  if (existing) {
    return interaction.reply({
      content: `Kamu masih punya tiket yang terbuka: ${existing}`,
      flags: EPHEMERAL,
    });
  }

  const cd = cooldowns.get(`${guild.id}:${user.id}`);
  if (cd && cd > Date.now()) {
    return interaction.reply({
      content: `Tunggu sebentar, coba lagi <t:${Math.floor(cd / 1000)}:R>.`,
      flags: EPHEMERAL,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId(ID.MODAL)
    .setTitle('Buat Tiket')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(ID.SUBJECT)
          .setLabel('Subjek')
          .setStyle(TextInputStyle.Short)
          .setMinLength(3)
          .setMaxLength(80)
          .setPlaceholder('Contoh: Pertanyaan pembelian')
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(ID.DETAIL)
          .setLabel('Jelaskan masalahmu')
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(10)
          .setMaxLength(1000)
          .setRequired(true)
      )
    );
  return interaction.showModal(modal);
}

async function createTicket(interaction) {
  const { guild, user } = interaction;
  const cfg = config[guild.id];
  const key = `${guild.id}:${user.id}`;

  if (!cfg) {
    return interaction.reply({
      content: 'Sistem tiket belum dikonfigurasi. Hubungi admin.',
      flags: EPHEMERAL,
    });
  }

  // Cek ulang (mencegah double submit)
  const existing = findOpenTicket(guild, user.id);
  if (existing) {
    return interaction.reply({
      content: `Kamu masih punya tiket yang terbuka: ${existing}`,
      flags: EPHEMERAL,
    });
  }
  const cd = cooldowns.get(key);
  if (cd && cd > Date.now()) {
    return interaction.reply({
      content: `Tunggu sebentar, coba lagi <t:${Math.floor(cd / 1000)}:R>.`,
      flags: EPHEMERAL,
    });
  }

  await interaction.deferReply({ flags: EPHEMERAL });
  cooldowns.set(key, Date.now() + COOLDOWN_MS);

  const subject = interaction.fields.getTextInputValue(ID.SUBJECT).trim();
  const detail = interaction.fields.getTextInputValue(ID.DETAIL).trim();

  if (!guild.roles.cache.has(cfg.staffRoleId)) {
    cooldowns.delete(key);
    return interaction.editReply('Role staff tidak ditemukan. Hubungi admin untuk setup ulang tiket.');
  }

  const slug = user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || user.id;
  const parent =
    cfg.categoryId && guild.channels.cache.has(cfg.categoryId) ? cfg.categoryId : undefined;

  const memberPerms = [
    P.ViewChannel,
    P.SendMessages,
    P.ReadMessageHistory,
    P.AttachFiles,
    P.EmbedLinks,
  ];

  let channel;
  try {
    channel = await guild.channels.create({
      name: `ticket-${slug}`,
      type: ChannelType.GuildText,
      parent,
      topic: `ticket:${user.id}`,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
        { id: user.id, allow: memberPerms },
        { id: cfg.staffRoleId, allow: [...memberPerms, P.ManageMessages] },
        { id: guild.members.me.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] },
      ],
      reason: `Tiket dibuat oleh ${user.tag}`,
    });
    await channel.send(ticketMessage(user, cfg.staffRoleId, subject, detail));
  } catch (err) {
    console.error('Gagal membuat tiket:', err);
    cooldowns.delete(key);
    return interaction.editReply(
      'Gagal membuat tiket. Pastikan bot punya izin **Manage Channels** dan kategori tidak penuh.'
    );
  }

  sendLog(guild, {
    title: 'Tiket dibuka',
    body: `**Channel:** ${channel}\n**Pembuat:** <@${user.id}> (${user.username})\n**Subjek:** ${subject}`,
    category: 'ticket',
  });
  return interaction.editReply(`Tiket dibuat: ${channel}`);
}

function canClose(interaction) {
  const ch = interaction.channel;
  const cfg = config[interaction.guildId];
  return (
    ownerOf(ch) === interaction.user.id ||
    (cfg && interaction.member.roles.cache.has(cfg.staffRoleId)) ||
    interaction.memberPermissions.has(P.ManageChannels)
  );
}

async function handleClose(interaction) {
  const ch = interaction.channel;

  if (!isTicket(ch)) {
    return interaction.reply({ content: 'Ini bukan channel tiket.', flags: EPHEMERAL });
  }
  if (!canClose(interaction)) {
    return interaction.reply({
      content: 'Hanya pembuat tiket atau staff yang bisa menutup tiket ini.',
      flags: EPHEMERAL,
    });
  }

  if (interaction.customId === ID.CLOSE) {
    return interaction.reply(closeConfirmMessage());
  }

  if (interaction.customId === ID.CLOSE_NO) {
    return interaction.update(result('Dibatalkan', 'Tiket tetap terbuka.'));
  }

  // CLOSE_YES
  await interaction.update(
    result('Menutup tiket', `Channel akan dihapus dalam ${CLOSE_DELAY_MS / 1000} detik.`)
  );

  // Transcript + log sebelum channel dihapus
  try {
    const { buffer, count } = await buildTranscript(ch);
    await sendLog(interaction.guild, {
      title: 'Tiket ditutup',
      body:
        `**Channel:** #${ch.name}\n**Pembuat:** <@${ownerOf(ch)}>\n` +
        `**Ditutup oleh:** <@${interaction.user.id}>\n**Jumlah pesan:** ${count}`,
      file: { name: `transcript-${ch.name}.txt`, buffer },
      category: 'ticket',
    });
  } catch (err) {
    console.error('Gagal membuat transcript:', err);
  }
  await ch.send({
    components: [
      new ContainerBuilder().addTextDisplayComponents(
        text(
          `## Tiket ditutup\nDitutup oleh <@${interaction.user.id}>. ` +
            `Channel dihapus dalam ${CLOSE_DELAY_MS / 1000} detik.`
        )
      ),
    ],
    flags: V2,
    allowedMentions: { parse: [] },
  });
  setTimeout(
    () => ch.delete(`Tiket ditutup oleh ${interaction.user.tag}`).catch(() => {}),
    CLOSE_DELAY_MS
  );
}

/** Return true kalau interaction ditangani oleh modul tiket. */
async function handleTicket(interaction) {
  if (interaction.isChatInputCommand() && interaction.commandName === 'ticket' && interaction.options.getSubcommand() === 'setup') {
    await setup(interaction);
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith('ticket:')) {
    if (interaction.customId === ID.OPEN) await openModal(interaction);
    else await handleClose(interaction);
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId === ID.MODAL) {
    await createTicket(interaction);
    return true;
  }

  return false;
}

// ───────────── Slash command ─────────────
const D = require('discord.js');
const ADMIN_PERM = D.PermissionFlagsBits.Administrator;
const commands = [
  new D.SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Pengelolaan ticket bantuan komunitas')
    .addSubcommand((sub) => sub.setName('setup').setDescription('Pasang panel ticket bantuan')
      .addRoleOption((o) => o.setName('staff-role').setDescription('Role staff yang menangani ticket').setRequired(true))
      .addChannelOption((o) => o.setName('category').setDescription('Kategori channel ticket').addChannelTypes(D.ChannelType.GuildCategory))
      .addChannelOption((o) => o.setName('channel').setDescription('Channel panel (default: channel ini)').addChannelTypes(D.ChannelType.GuildText)))
    .setDefaultMemberPermissions(ADMIN_PERM)
    .setContexts(0)
    .toJSON(),
];

async function refreshPublicPanels(guild) {
  return [await editTrackedPanel(guild, config[guild.id]?.panel, panelMessage(guild.id))];
}

module.exports = { name: 'ticket', commands, handle: handleTicket, refreshPublicPanels };
