'use strict';
// Donation module is independent from the script and community management modules.
const {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType,
  ContainerBuilder, Events, LabelBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder,
  MessageFlags, ModalBuilder, PermissionFlagsBits: P, SeparatorBuilder,
  SeparatorSpacingSize, SlashCommandBuilder, TextDisplayBuilder,
  TextInputBuilder, TextInputStyle,
} = require('discord.js');
const QRCode = require('qrcode');
const api = require('../lib/donate-api');
const { createStore } = require('../lib/donate-store');
const { topDonors } = require('../lib/donate-ranking');
const donateRoles = require('../lib/donate-roles');
const { editTrackedPanel } = require('../lib/panel-updater');
const logger = require('../lib/console-logger');
const { BOT_NAME } = require('../lib/brand');
const { sendLog } = require('../lib/logger');

const ledger = createStore();
const EPHEMERAL = MessageFlags.Ephemeral;
const V2 = MessageFlags.IsComponentsV2;
const TICK_MS = 10_000;
const PAID_CLOSE_MS = 60_000;
const ID = { OPEN: 'donate:open', MODAL: 'donate:modal', AMOUNT: 'donate:amount', NOTE: 'donate:note' };
const lastOpened = new Map();
let clientRef = null;
let running = false;
const text = (content) => new TextDisplayBuilder().setContent(content);
const line = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const rupiah = (num) => `Rp${Number(num).toLocaleString('id-ID')}`;
const safeNote = (value) => String(value || '').replace(/@/g, '@\u200b').replace(/\r/g, '').slice(0, 400);
const primary = (id, label) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(ButtonStyle.Primary);
const noMentions = { parse: [] };

function publicPanel() {
  const ranking = topDonors(ledger.list(), 3);
  const rankingText = ranking.length
    ? ranking.map((entry, index) =>
      `${index + 1}. <@${entry.userId}> — **${rupiah(entry.total)}**`
    ).join('\n')
    : 'Our top 3 donors will be featured here.';

  const container = new ContainerBuilder()
    .addTextDisplayComponents(text(`# Support ${BOT_NAME}`))
    .addTextDisplayComponents(text(
      'Support our journey and help us build a better experience for the community.'
    ))
    .addSeparatorComponents(line())
    .addTextDisplayComponents(text('## Top Donors'))
    .addTextDisplayComponents(text(
      `${rankingText}\n\n-# All successful donations are automatically included in the leaderboard.`
    ))
    .addSeparatorComponents(line())
    .addTextDisplayComponents(text('## Donation'))
    .addTextDisplayComponents(text(
      '**QRIS Payment**\n' +
      `Support ${BOT_NAME} with a quick and secure donation.\n\n` +
      'Click **Donate Now** to enter your amount and receive a personal QRIS payment ticket.'
    ))
    .addSeparatorComponents(line())
    .addTextDisplayComponents(text('## Information'))
    .addTextDisplayComponents(text(
      '- **No Minimum** — Every contribution matters.\n' +
      '- **Secure Payment** — Complete your donation via QRIS.\n' +
      '- **Community Support** — Help the community grow and improve.\n\n' +
      'Your support makes a difference.'
    ))
    .addSeparatorComponents(line())
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      primary(ID.OPEN, 'Donate Now')
    ));

  // No emoji or custom icon is added inside the panel. The shared server-icon
  // integration decorates the first heading with this guild's server icon.

  return { components: [container], flags: V2, allowedMentions: noMentions };
}

function qrPayload(record, png) {
  const name = `donate-${record.id.slice(0, 8)}.png`;
  const expires = Math.floor(record.expiresAt / 1000);
  const body = new ContainerBuilder()
    .addTextDisplayComponents(text(`## ${BOT_NAME} Donation — QRIS`))
    .addSeparatorComponents(line())
    .addTextDisplayComponents(text(
      `Donatur: <@${record.userId}>\n` +
      `Nominal donasi: **${rupiah(record.baseAmount)}**\n` +
      `Kode unik: **+${rupiah(record.uniqueCode)}**\n` +
      `**Total yang harus dibayar: ${rupiah(record.totalAmount)}**\n\n` +
      `Scan QRIS berikut dengan nominal persis **${rupiah(record.totalAmount)}**.\n` +
      `Berlaku hingga <t:${expires}:T> (<t:${expires}:R>). Bot mengecek transaksi setiap **10 detik**.`
    ))
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL(`attachment://${name}`).setDescription('QRIS donasi dengan nominal unik')
    ))
    .addSeparatorComponents(line())
    .addTextDisplayComponents(text(
      `${record.message ? `**Pesan donasi:** ${safeNote(record.message)}\n` : ''}` +
      '-# Jika waktu habis, channel akan otomatis dihapus. Jangan membayar QRIS yang sudah kedaluwarsa.'
    ));
  return {
    components: [body], files: [new AttachmentBuilder(png, { name })],
    flags: V2, allowedMentions: noMentions,
  };
}
function statusPayload(title, description) {
  return { components: [new ContainerBuilder()
    .addTextDisplayComponents(text(`## ${title}`))
    .addSeparatorComponents(line())
    .addTextDisplayComponents(text(description))],
  flags: V2, allowedMentions: noMentions };
}
function notifyPayload(record) {
  return statusPayload(
    'New Donation Received',
    `Terima kasih <@${record.userId}> atas dukungannya kepada **${BOT_NAME}**!\n` +
    `**Donasi:** ${rupiah(record.baseAmount)}\n` +
    `**Total pembayaran:** ${rupiah(record.totalAmount)} (termasuk kode unik ${rupiah(record.uniqueCode)})` +
    (record.message ? `\n**Pesan:** ${safeNote(record.message)}` : '') +
    (record.roleGrantedAt ? `\n**Role donatur:** <@&${record.roleIdAtPayment}>` : '')
  );
}

async function findChannel(guild, channelId) {
  if (!guild || !channelId) return null;
  return guild.channels.cache.get(channelId) || guild.channels.fetch(channelId).catch(() => null);
}
async function closeTicket(record, reason) {
  const guild = clientRef?.guilds.cache.get(record.guildId);
  if (!guild) return; // retry when bot rejoins cache
  const channel = await findChannel(guild, record.channelId);
  if (!channel) { ledger.closed(record.id); return; }
  try {
    if (channel.type === ChannelType.GuildText && channel.topic === `donate:${record.id}:${record.userId}`) {
      await channel.delete(reason);
      ledger.closed(record.id);
    } else {
      logger.warn({ donationId: record.id }, 'Channel donasi tidak cocok, melewati penghapusan');
      ledger.closed(record.id);
    }
  } catch (err) {
    logger.warn({ donationId: record.id, error: err.message }, 'Channel donasi gagal dihapus, akan dicoba lagi');
  }
}
async function announce(record) {
  const guild = clientRef?.guilds.cache.get(record.guildId);
  if (!guild) return;
  const targetId = ledger.guildConfig(record.guildId).notificationChannelId;
  if (!targetId) { ledger.notified(record.id); return; }
  const channel = await findChannel(guild, targetId);
  if (!channel?.send) {
    logger.warn({ guildId: record.guildId }, 'Channel notifikasi donate tidak ditemukan');
    return;
  }
  try {
    await channel.send(notifyPayload(record));
    ledger.notified(record.id);
    await sendLog(guild, { category: 'donation', title: 'Donasi berhasil', body: `Donatur: <@${record.userId}>\nNominal: **${rupiah(record.totalAmount)}**\nStatus: **PAID**` });
  } catch (err) {
    logger.warn({ guildId: record.guildId, error: err.message }, 'Notifikasi donasi gagal dikirim');
  }
}
async function awardRole(record) {
  if (!ledger.roleDue(record)) return;
  const guild = clientRef?.guilds.cache.get(record.guildId);
  if (!guild) return; // no attempt recorded; retry when the guild is available
  try {
    const result = await donateRoles.grant(guild, record, P);
    ledger.roleGranted(record.id, result.alreadyHadRole);
    logger.info({ guildId: record.guildId, donorId: record.userId, roleId: record.roleIdAtPayment },
      result.alreadyHadRole ? 'Role donatur sudah dimiliki' : 'Role donatur berhasil diberikan');
  } catch (err) {
    ledger.roleFailed(record.id, err.message);
    logger.warn({ guildId: record.guildId, donationId: record.id, error: err.message },
      'Role donatur gagal diberikan; akan dicoba kembali dengan jeda');
  }
}
async function refreshDonationPanels() {
  if (!clientRef) return [];
  const results = [];
  // Leaderboard data is global, so every server's combined panel is synchronized.
  for (const guild of clientRef.guilds.cache.values()) {
    const cfg = ledger.guildConfig(guild.id);
    results.push(await editTrackedPanel(guild, cfg.panel, publicPanel()));
  }
  return results;
}

async function publishPaid(record) {
  await awardRole(record);
  record = ledger.get(record.id) || record;
  // Update the combined donation/leaderboard panel immediately after payment verification.
  await refreshDonationPanels();
  const guild = clientRef?.guilds.cache.get(record.guildId);
  const channel = await findChannel(guild, record.channelId);
  if (channel?.send) {
    await channel.send(statusPayload(
      'Payment Received — Thank You!',
      `Donasi **${rupiah(record.baseAmount)}** berhasil dikonfirmasi otomatis.\n` +
      `Total diterima: **${rupiah(record.totalAmount)}**.\n` +
      `Terima kasih telah mendukung ${BOT_NAME}! Tiket akan ditutup otomatis dalam sekitar 1 menit.` +
      (record.roleGrantedAt ? `\nRole apresiasi: <@&${record.roleIdAtPayment}>.` :
        record.roleIdAtPayment ? '\nRole apresiasi sedang diproses; hubungi admin jika belum diterima.' : '')
    )).catch((err) => logger.warn({ error: err.message }, 'Tidak dapat mengirim konfirmasi ke tiket'));
  }
  await announce(record);
}

async function sweep() {
  if (running || !clientRef?.isReady()) return;
  running = true;
  try {
    // Expire first; never match payments reported after the five-minute deadline.
    const now = Date.now();
    for (const record of ledger.expired(now)) {
      await closeTicket(record, 'Donasi kedaluwarsa setelah 5 menit');
    }
    for (const record of ledger.list()) {
      if (record.status === 'expired' && !record.closedAt) await closeTicket(record, 'Pembersihan donasi kedaluwarsa');
    }
    const pending = ledger.list().filter((r) => r.status === 'pending' && r.expiresAt > Date.now());
    if (pending.length) {
      let transactions = [];
      try { transactions = await api.history(); }
      catch (err) { logger.warn({ error: err.message }, 'Gagal memeriksa history donasi, akan mencoba lagi'); }
      // Match exact integer rupiah, success status, reference ID not already used,
      // and provider timestamp strictly within donor-specific payment window.
      for (const record of pending) {
        const fresh = transactions.filter((tx) => tx?.status === 'success' &&
          Number(tx.amount) === record.totalAmount &&
          Number.isSafeInteger(Number(tx.amount)) &&
          typeof tx.time === 'string' && Date.parse(tx.time) >= Math.floor(record.createdAt / 1000) * 1000 &&
          Date.parse(tx.time) <= record.expiresAt && (tx.reference_id || tx.id));
        if (fresh.length !== 1) continue; // ambiguous history must not confirm automatically
        const paid = ledger.markPaid(record.id, fresh[0], Date.now());
        if (paid) await publishPaid(paid);
      }
    }
    for (const record of ledger.list()) {
      if (record.status !== 'paid') continue;
      if (ledger.roleDue(record)) await awardRole(record);
      if (!record.notifiedAt) await announce(record);
      if (!record.closedAt && Date.now() >= record.paidAt + PAID_CLOSE_MS) {
        await closeTicket(record, 'Donasi telah dibayar');
      }
    }
  } catch (err) { logger.warn({ error: err.message }, 'Donate polling error'); }
  finally { running = false; }
}

function setup(client) {
  clientRef = client;
  client.once(Events.ClientReady, () => {
    void sweep();
    setInterval(() => void sweep(), TICK_MS).unref();
    logger.info('Donate checker aktif setiap 10 detik; tiket QRIS kedaluwarsa setelah 5 menit.');
  });
}
function hasAdmin(i) { return i.inGuild() && Boolean(i.memberPermissions?.has(P.ManageGuild)); }
const commands = [
  new SlashCommandBuilder().setName('donation').setDescription('Pengelolaan donasi komunitas')
    .addSubcommandGroup((g) => g.setName('setup').setDescription('Pengaturan role apresiasi donatur')
      .addSubcommand((s) => s.setName('role').setDescription('Atur role otomatis untuk donatur sukses')
        .addRoleOption((o) => o.setName('role').setDescription('Role apresiasi donatur').setRequired(true)))
      .addSubcommand((s) => s.setName('role-disable').setDescription('Nonaktifkan role otomatis donatur')))
    .addSubcommand((s) => s.setName('panel').setDescription('Pasang panel donasi')
      .addChannelOption((o) => o.setName('panel-channel').setDescription('Channel panel donasi').setRequired(true).addChannelTypes(ChannelType.GuildText))
      .addChannelOption((o) => o.setName('category').setDescription('Kategori tiket donasi privat').addChannelTypes(ChannelType.GuildCategory))
      .addChannelOption((o) => o.setName('notify-channel').setDescription('Channel notifikasi pembayaran').addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((s) => s.setName('notify').setDescription('Atur channel notifikasi donasi berhasil')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel notifikasi').setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((s) => s.setName('logs').setDescription('Lihat riwayat transaksi donasi'))
    .addSubcommand((s) => s.setName('status').setDescription('Lihat status konfigurasi donasi'))
    .setDefaultMemberPermissions(P.ManageGuild).setContexts(0).toJSON(),
];

async function setupPanel(i) {
  const channel = i.options.getChannel('panel-channel', true);
  const category = i.options.getChannel('category');
  const notify = i.options.getChannel('notify-channel');
  const me = i.guild.members.me || await i.guild.members.fetchMe();
  if (!me.permissions.has(P.ManageChannels)) return i.reply({ content: 'Bot membutuhkan izin Manage Channels untuk membuat tiket privat.', flags: EPHEMERAL });
  if (!channel.permissionsFor(me)?.has([P.ViewChannel, P.SendMessages, P.ReadMessageHistory])) {
    return i.reply({ content: 'Bot membutuhkan View Channel, Send Messages, Read Message History pada channel panel.', flags: EPHEMERAL });
  }
  if (notify && !notify.permissionsFor(me)?.has([P.ViewChannel, P.SendMessages])) {
    return i.reply({ content: 'Bot tidak dapat mengirim notifikasi ke channel tersebut.', flags: EPHEMERAL });
  }
  await i.deferReply({ flags: EPHEMERAL });
  const previous = ledger.guildConfig(i.guildId);
  let message = null;
  if (previous.panel?.channelId === channel.id) {
    message = await channel.messages.fetch(previous.panel.messageId).catch(() => null);
    if (message && message.author?.id !== i.client.user.id) message = null;
  }
  try {
    if (message) await message.edit(publicPanel());
    else message = await channel.send(publicPanel());
  } catch (err) {
    logger.warn({ error: err.message }, 'Gagal memasang donate panel');
    return i.editReply('Gagal memasang panel. Periksa izin bot dan coba lagi.');
  }
  ledger.configure(i.guildId, {
    panel: { channelId: channel.id, messageId: message.id },
    categoryId: category?.id ?? previous.categoryId ?? channel.parentId ?? null,
    notificationChannelId: notify?.id ?? previous.notificationChannelId ?? null,
  });
  if (previous.panel?.channelId && previous.panel.channelId !== channel.id) {
    const oldChannel = await findChannel(i.guild, previous.panel.channelId);
    const old = await oldChannel?.messages?.fetch(previous.panel.messageId).catch(() => null);
    if (old?.author?.id === i.client.user.id) await old.delete().catch(() => {});
  }
  return i.editReply(`Panel gabungan donasi ${message ? 'siap' : 'dipasang'} di ${channel}. Kategori tiket: ${category || (ledger.guildConfig(i.guildId).categoryId ? `<#${ledger.guildConfig(i.guildId).categoryId}>` : 'tanpa kategori')}. ${notify ? `Notifikasi: ${notify}.` : ''}\nPanel Donate menggunakan tampilan bersih tanpa emoji atau ikon.`);
}
function modal() {
  const amount = new TextInputBuilder().setCustomId(ID.AMOUNT)
    .setStyle(TextInputStyle.Short).setPlaceholder('1000').setMinLength(1).setMaxLength(7).setRequired(true);
  const note = new TextInputBuilder().setCustomId(ID.NOTE)
    .setStyle(TextInputStyle.Paragraph).setPlaceholder('Pesan untuk developer (opsional)')
    .setMaxLength(400).setRequired(false);
  return new ModalBuilder().setCustomId(ID.MODAL).setTitle('Donate for Developer').addLabelComponents(
    new LabelBuilder().setLabel('Nominal donasi (angka saja)').setTextInputComponent(amount),
    new LabelBuilder().setLabel('Pesan donasi (opsional)').setTextInputComponent(note)
  );
}
async function openDonate(i) {
  const cfg = ledger.guildConfig(i.guildId);
  if (!cfg.panel) return i.reply({ content: 'Panel donate belum dikonfigurasi.', flags: EPHEMERAL });
  try { api.config(); } catch (_) {
    return i.reply({ content: 'Sistem donasi belum siap. Developer perlu mengatur QRIS dan token API di .env.', flags: EPHEMERAL });
  }
  const active = ledger.openFor(i.guildId, i.user.id);
  if (active) return i.reply({ content: `Kamu sudah punya donasi aktif${active.guildId === i.guildId && active.channelId ? `: <#${active.channelId}>` : ' di server Discord lain atau sedang dibuat'}.`, flags: EPHEMERAL });
  await i.showModal(modal());
}
async function submitDonate(i) {
  const value = i.fields.getTextInputValue(ID.AMOUNT).trim();
  const note = (i.fields.getTextInputValue(ID.NOTE) || '').trim();
  try { ledger.validateAmount(value); }
  catch (err) { return i.reply({ content: err.message, flags: EPHEMERAL }); }
  const cfg = ledger.guildConfig(i.guildId);
  if (!cfg.panel) return i.reply({ content: 'Sistem donasi belum dikonfigurasi.', flags: EPHEMERAL });
  try { api.config(); } catch (_) { return i.reply({ content: 'Konfigurasi API belum tersedia.', flags: EPHEMERAL }); }
  if (lastOpened.get(i.user.id) > Date.now()) {
    return i.reply({ content: 'Tunggu 30 detik sebelum mencoba membuat donasi baru.', flags: EPHEMERAL });
  }
  await i.deferReply({ flags: EPHEMERAL });
  let record;
  try { record = ledger.reserve({ guildId: i.guildId, userId: i.user.id, amountInput: value, message: note }); }
  catch (err) { return i.editReply(err.message); }
  lastOpened.set(i.user.id, Date.now() + 30_000);
  const bot = i.guild.members.me || await i.guild.members.fetchMe();
  const slug = i.user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) || i.user.id;
  let channel;
  let stage = 'qris-create';
  try {
    // Generate first: a failed provider request should not create an empty ticket.
    const qr = await api.createQris(record.totalAmount);
    if (Date.now() >= record.expiresAt) throw Error('Waktu pembuatan QRIS sudah melewati batas 5 menit.');
    stage = 'ticket-create';
    channel = await i.guild.channels.create({
      name: `donate-${slug}`,
      type: ChannelType.GuildText,
      parent: cfg.categoryId || undefined,
      topic: `donate:${record.id}:${i.user.id}`,
      permissionOverwrites: [
        { id: i.guild.roles.everyone.id, deny: [P.ViewChannel] },
        { id: i.user.id, allow: [P.ViewChannel, P.ReadMessageHistory, P.SendMessages] },
        { id: bot.id, allow: [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.ManageChannels, P.AttachFiles] },
      ],
      reason: 'Tiket donasi komunitas',
    });
    ledger.channel(record.id, channel.id);
    // Render our own QR PNG from the API-provided QR string; do not trust remote image URLs.
    stage = 'qr-render';
    const png = await QRCode.toBuffer(qr.qrString, {
      type: 'png', errorCorrectionLevel: 'M', width: 512, margin: 3,
      color: { dark: '#171717', light: '#FFFFFF' },
    });
    if (Date.now() >= record.expiresAt) throw Error('Waktu pembuatan QRIS sudah melewati batas 5 menit.');
    stage = 'ticket-send';
    const posted = await channel.send(qrPayload(record, png));
    ledger.ready(record.id, posted.id);
    await i.editReply(`Tiket donasimu sudah dibuat: ${channel}\nBayar **${rupiah(record.totalAmount)}** dalam 5 menit. Setelah kedaluwarsa, tiket akan dihapus.`);
  } catch (err) {
    ledger.fail(record.id);
    logger.warn({ donationId: record.id, stage, error: err.message }, 'Gagal membuat tiket QRIS donate');
    if (channel) await closeTicket({ ...record, channelId: channel.id }, 'Gagal membuat QRIS donasi');
    await i.editReply('Gagal membuat QRIS/tiket donasi. Tidak ada pembayaran yang dikonfirmasi. Coba lagi nanti.').catch(() => {});
  }
}
async function handle(i) {
  if (i.isChatInputCommand() && i.commandName === 'donation') {
    if (!hasAdmin(i)) {
      await i.reply({ content: 'Perintah ini memerlukan izin Manage Server.', flags: EPHEMERAL });
      return true;
    }
    const group = i.options.getSubcommandGroup(false);
    const sub = i.options.getSubcommand();
    if (group === 'setup' && (sub === 'role' || sub === 'role-disable')) {
      if (!i.memberPermissions?.has(P.Administrator)) {
        await i.reply({ content: 'Hanya Administrator yang boleh mengatur role donatur.', flags: EPHEMERAL });
        return true;
      }
      if (sub === 'role-disable') {
        ledger.configure(i.guildId, { donatorRoleId: null });
        await i.reply({ content: 'Auto-role donatur dinonaktifkan. Donasi yang sudah berhasil tetap tercatat; role yang telah diberikan tidak dicabut.', flags: EPHEMERAL });
        return true;
      }
      const role = i.options.getRole('role', true);
      const bot = i.guild.members.me || await i.guild.members.fetchMe();
      const problem = donateRoles.roleProblem(i.guild, bot, role, P);
      if (problem) { await i.reply({ content: problem, flags: EPHEMERAL }); return true; }
      ledger.configure(i.guildId, { donatorRoleId: role.id });
      await i.reply({ content: `Role donatur disetel menjadi <@&${role.id}>. Role diberikan otomatis pada pembayaran berikutnya yang berhasil diverifikasi.`, flags: EPHEMERAL, allowedMentions: noMentions });
      return true;
    }
    if (sub === 'panel') { await setupPanel(i); return true; }
    if (sub === 'notify') {
      const channel = i.options.getChannel('channel', true);
      const me = i.guild.members.me || await i.guild.members.fetchMe();
      if (!channel.permissionsFor(me)?.has([P.ViewChannel, P.SendMessages])) {
        await i.reply({ content: 'Bot tidak memiliki izin mengirim pesan di channel tersebut.', flags: EPHEMERAL });
      } else {
        ledger.configure(i.guildId, { notificationChannelId: channel.id });
        await i.reply({ content: `Notifikasi donasi berhasil akan dikirim ke ${channel}.`, flags: EPHEMERAL });
      }
      return true;
    }
    if (sub === 'logs') {
      const rows = ledger.list().filter((r) => r.guildId === i.guildId).slice(-10).reverse();
      const body = rows.length ? rows.map((r) => `• <@${r.userId}> — **${rupiah(r.totalAmount)}** — ${String(r.status).toUpperCase()} — <t:${Math.floor(r.createdAt / 1000)}:R>`).join('\n') : 'Belum ada transaksi donasi.';
      await i.reply({ content: `## Riwayat Donasi\n${body}`, flags: EPHEMERAL, allowedMentions: noMentions });
      return true;
    }
    if (sub === 'status') {
      const cfg = ledger.guildConfig(i.guildId);
      const all = ledger.list().filter((r) => r.guildId === i.guildId);
      const active = all.filter((r) => ['pending', 'creating'].includes(r.status) && r.expiresAt > Date.now());
      let envOk = true; try { api.config(); } catch (_) { envOk = false; }
      await i.reply({ content: `API: **${envOk ? 'configured' : 'not configured'}**\nPanel: ${cfg.panel ? `<#${cfg.panel.channelId}>` : 'belum diatur'}\nKategori: ${cfg.categoryId ? `<#${cfg.categoryId}>` : 'belum diatur'}\nNotifikasi: ${cfg.notificationChannelId ? `<#${cfg.notificationChannelId}>` : 'belum diatur'}\nRole donatur: ${cfg.donatorRoleId ? `<@&${cfg.donatorRoleId}>` : 'nonaktif'}\nRole belum diberikan: **${all.filter((r) => r.status === 'paid' && r.roleIdAtPayment && !r.roleGrantedAt).length}**\nDonasi aktif: **${active.length}** · Tercatat dibayar: **${all.filter((r) => r.status === 'paid').length}**.`, flags: EPHEMERAL, allowedMentions: noMentions });
      return true;
    }
    return false;
  }
  if (i.isButton() && i.customId === ID.OPEN) { await openDonate(i); return true; }
  if (i.isModalSubmit() && i.customId === ID.MODAL) { await submitDonate(i); return true; }
  return false;
}
async function refreshPublicPanels(guild) {
  const cfg = ledger.guildConfig(guild.id);
  return [await editTrackedPanel(guild, cfg.panel, publicPanel())];
}
module.exports = { name: 'donate', commands, setup, handle, refreshPublicPanels, publicPanel };
