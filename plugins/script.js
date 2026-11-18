'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ContainerBuilder,
  MessageFlags, PermissionFlagsBits: P, SectionBuilder, SlashCommandBuilder,
  TextDisplayBuilder, ThumbnailBuilder,
} = require('discord.js');
const { atomicWriteJson, readJson } = require('../lib/json-storage');
const { sendLog } = require('../lib/logger');
const { parseRobloxPlaceId, fetchGameIcon } = require('../lib/roblox-game-api');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CATEGORY_FILE = path.join(DATA_DIR, 'script-categories.json');
const UPDATE_FILE = path.join(DATA_DIR, 'script-updates.json');
const EPHEMERAL_V2 = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
const V2 = MessageFlags.IsComponentsV2;
const EPHEMERAL = MessageFlags.Ephemeral;
const DRAFT_TTL_MS = 10 * 60 * 1000;
const drafts = new Map();
const text = (value) => new TextDisplayBuilder().setContent(value);
const noMentions = { parse: [] };

const categoryState = readJson(CATEGORY_FILE, { version: 1, guilds: {} });
const updateState = readJson(UPDATE_FILE, { version: 1, updates: [] });
if (!categoryState.guilds || typeof categoryState.guilds !== 'object' || Array.isArray(categoryState.guilds)) throw new Error('script-categories.json memiliki struktur tidak valid.');
if (!Array.isArray(updateState.updates)) throw new Error('script-updates.json memiliki struktur tidak valid.');

function saveCategories() { atomicWriteJson(CATEGORY_FILE, categoryState); }
function saveUpdates() { atomicWriteJson(UPDATE_FILE, updateState); }
function categoriesFor(guildId) { return Array.isArray(categoryState.guilds[guildId]) ? categoryState.guilds[guildId] : []; }
function setCategories(guildId, categories) { categoryState.guilds[guildId] = categories; saveCategories(); }
function slugify(value) { return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'game'; }
function safeText(value, max = 3500) { return String(value ?? '').replace(/@/g, '@\u200b').trim().slice(0, max); }
function isAdmin(i) { return i.memberPermissions?.has(P.ManageGuild) === true; }
function categoryById(guildId, id) { return categoriesFor(guildId).find((item) => item.id === id || item.slug === id) || null; }
function canSend(guild, channel) {
  const me = guild.members.me;
  return channel?.type === ChannelType.GuildText && channel.permissionsFor(me)?.has([P.ViewChannel, P.SendMessages]) === true;
}
function reply(i, content) { return i.reply({ content, flags: EPHEMERAL, allowedMentions: noMentions }); }

async function refreshIcon(category) {
  try {
    const latest = await fetchGameIcon(category.placeId);
    category.iconUrl = latest;
    category.iconUpdatedAt = Date.now();
    return { url: latest, refreshed: true };
  } catch (error) {
    return { url: category.iconUrl || null, refreshed: false, error: error.message };
  }
}

function buildCategoryPanel(category, iconUrl) {
  const section = new SectionBuilder().addTextDisplayComponents(text(
    `# ${category.name}\n**Category ID:** \`${category.slug}\`\n**Place ID:** \`${category.placeId}\`\n**Game:** [Open on Roblox](${category.gameUrl})\n**Status:** ${category.active ? 'Active' : 'Archived'}\n**Changelog:** ${category.changelogChannelId ? `<#${category.changelogChannelId}>` : 'Belum diatur'}`
  ));
  if (iconUrl) section.setThumbnailAccessory(new ThumbnailBuilder().setURL(iconUrl).setDescription(`${category.name} game icon`));
  const container = new ContainerBuilder().addSectionComponents(section);
  return { components: [container], flags: EPHEMERAL_V2, allowedMentions: noMentions };
}

function changelogContainer(record, { preview = false } = {}) {
  const ts = Math.floor((record.publishedAt || record.createdAt || Date.now()) / 1000);
  const section = new SectionBuilder().addTextDisplayComponents(text(
    `# ⬆️ New Script Update!\n**🎮 Game:** ${record.gameName}\n**📜 Script:** ${record.title}\n**🕒 Date:** <t:${ts}:F>\n\n## ⚙️ Changes\n${record.description}`
  ));
  if (record.iconUrl) section.setThumbnailAccessory(new ThumbnailBuilder().setURL(record.iconUrl).setDescription(`${record.gameName} game icon`));
  const container = new ContainerBuilder().addSectionComponents(section);
  const buttonStyles = [ButtonStyle.Success, ButtonStyle.Danger, ButtonStyle.Primary];
  const actionButtons = record.buttons.map((item, index) => new ButtonBuilder()
    .setCustomId(preview ? `script:preview:${record.id}:${index + 1}` : `script:target:${record.id}:${index + 1}`)
    .setLabel(item.label)
    .setStyle(buttonStyles[index])
    .setDisabled(preview));
  if (actionButtons.length) container.addActionRowComponents(new ActionRowBuilder().addComponents(...actionButtons));
  if (preview) {
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`script:publish:${record.id}`).setLabel('Publish').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`script:cancel:${record.id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    ));
  }
  return { components: [container], flags: preview ? EPHEMERAL_V2 : V2, allowedMentions: noMentions };
}

function addCategoryCommand() {
  return new SlashCommandBuilder().setName('script').setDescription('Script Exploit Management')
    .addSubcommandGroup((g) => g.setName('category').setDescription('Kelola kategori game Roblox')
      .addSubcommand((s) => s.setName('add').setDescription('Daftarkan game baru sebagai kategori script')
        .addStringOption((o) => o.setName('name').setDescription('Nama game').setRequired(true).setMaxLength(80))
        .addStringOption((o) => o.setName('game_link').setDescription('Link game Roblox').setRequired(true).setMaxLength(300)))
      .addSubcommand((s) => s.setName('list').setDescription('Lihat kategori game yang terdaftar'))
      .addSubcommand((s) => s.setName('edit').setDescription('Ubah nama atau link game')
        .addStringOption((o) => o.setName('category').setDescription('Kategori yang akan diubah').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('name').setDescription('Nama baru (opsional)').setMaxLength(80))
        .addStringOption((o) => o.setName('game_link').setDescription('Link game Roblox baru (opsional)').setMaxLength(300)))
      .addSubcommand((s) => s.setName('archive').setDescription('Nonaktifkan kategori tanpa menghapus riwayat')
        .addStringOption((o) => o.setName('category').setDescription('Kategori yang akan diarsipkan').setRequired(true).setAutocomplete(true)))
      .addSubcommand((s) => s.setName('preview').setDescription('Lihat data dan Game Icon kategori')
        .addStringOption((o) => o.setName('category').setDescription('Kategori game').setRequired(true).setAutocomplete(true))))
    .addSubcommandGroup((g) => g.setName('channel').setDescription('Pengaturan channel publikasi')
      .addSubcommand((s) => s.setName('set').setDescription('Tetapkan channel changelog untuk kategori')
        .addStringOption((o) => o.setName('category').setDescription('Kategori game').setRequired(true).setAutocomplete(true))
        .addChannelOption((o) => o.setName('channel').setDescription('Channel changelog').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))))
    .addSubcommand((s) => s.setName('update').setDescription('Buat changelog script dan tampilkan preview')
      .addStringOption((o) => o.setName('category').setDescription('Kategori game').setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName('title').setDescription('Judul/nama script update').setRequired(true).setMaxLength(100))
      .addStringOption((o) => o.setName('description').setDescription('Daftar perubahan script').setRequired(true).setMaxLength(3000))
      .addStringOption((o) => o.setName('button1').setDescription('Label tombol utama (wajib)').setRequired(true).setMaxLength(80))
      .addChannelOption((o) => o.setName('directchannelbutton1').setDescription('Channel tujuan tombol utama').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addStringOption((o) => o.setName('button2').setDescription('Label tombol kedua (opsional)').setMaxLength(80))
      .addChannelOption((o) => o.setName('directchannelbutton2').setDescription('Channel tujuan tombol kedua').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addStringOption((o) => o.setName('button3').setDescription('Label tombol ketiga (opsional)').setMaxLength(80))
      .addChannelOption((o) => o.setName('directchannelbutton3').setDescription('Channel tujuan tombol ketiga').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((s) => s.setName('history').setDescription('Lihat riwayat changelog yang pernah diterbitkan')
      .addStringOption((o) => o.setName('category').setDescription('Filter kategori game (opsional)').setAutocomplete(true))
      .addIntegerOption((o) => o.setName('limit').setDescription('Jumlah riwayat (1–10)').setMinValue(1).setMaxValue(10)));
}

const commands = [addCategoryCommand().setDefaultMemberPermissions(P.ManageGuild).setContexts(0).toJSON()];

async function handleAutocomplete(i) {
  if (i.commandName !== 'script') return false;
  const focused = i.options.getFocused(true);
  if (focused.name !== 'category') return false;
  const query = String(focused.value || '').toLowerCase();
  const options = categoriesFor(i.guildId).filter((c) => c.active && (`${c.name} ${c.slug}`.toLowerCase().includes(query)))
    .slice(0, 25).map((c) => ({ name: `${c.name} · ${c.slug}`.slice(0, 100), value: c.id }));
  await i.respond(options);
  return true;
}

async function addCategory(i) {
  const name = safeText(i.options.getString('name', true), 80);
  if (!name) return reply(i, 'Nama game tidak boleh kosong.');
  let placeId;
  try { placeId = parseRobloxPlaceId(i.options.getString('game_link', true)); }
  catch (error) { return reply(i, error.message); }
  const current = categoriesFor(i.guildId);
  if (current.some((c) => c.placeId === placeId)) return reply(i, 'Game tersebut sudah terdaftar sebagai kategori di server ini.');
  if (current.some((c) => c.slug === slugify(name) && c.active)) return reply(i, 'Nama kategori tersebut sudah digunakan.');
  await i.deferReply({ flags: EPHEMERAL });
  const gameUrl = `https://www.roblox.com/games/${placeId}`;
  let iconUrl = null;
  let iconWarning = '';
  try { iconUrl = await fetchGameIcon(placeId); }
  catch (error) { iconWarning = `\n-# Game Icon belum berhasil diambil: ${safeText(error.message, 180)}. Bot akan mencoba lagi saat preview/update.`; }
  const category = {
    id: crypto.randomBytes(5).toString('hex'), slug: slugify(name), name, gameUrl, placeId,
    iconUrl, iconUpdatedAt: iconUrl ? Date.now() : null,
    changelogChannelId: null, active: true, createdAt: Date.now(), updatedAt: Date.now(),
  };
  setCategories(i.guildId, [...current, category]);
  await i.editReply(`Kategori **${name}** berhasil didaftarkan.\nCategory ID: \`${category.slug}\`\nPlace ID: \`${placeId}\`\nGame Icon: ${iconUrl ? 'berhasil diambil' : 'belum tersedia'}${iconWarning}\n\nLangkah berikutnya: atur channel dengan \`/script channel set\`.`);
}

async function listCategories(i) {
  const categories = categoriesFor(i.guildId);
  if (!categories.length) return reply(i, 'Belum ada kategori game. Gunakan `/script category add` untuk mendaftarkan game.');
  const lines = categories.map((c) => `• **${safeText(c.name, 80)}** · \`${c.slug}\` · ${c.active ? 'Active' : 'Archived'} · ${c.changelogChannelId ? `<#${c.changelogChannelId}>` : 'channel belum diatur'}`);
  return reply(i, `## Script Game Categories\n${lines.join('\n')}`);
}

async function editCategory(i) {
  const id = i.options.getString('category', true);
  const name = i.options.getString('name');
  const gameLink = i.options.getString('game_link');
  if (!name && !gameLink) return reply(i, 'Isi minimal salah satu: name atau game_link.');
  const categories = categoriesFor(i.guildId);
  const index = categories.findIndex((c) => c.id === id);
  if (index < 0) return reply(i, 'Kategori tidak ditemukan. Pilih kembali dari autocomplete.');
  const next = { ...categories[index], updatedAt: Date.now() };
  if (name) {
    const cleanName = safeText(name, 80);
    if (!cleanName) return reply(i, 'Nama kategori tidak boleh kosong.');
    const slug = slugify(cleanName);
    if (categories.some((c, n) => n !== index && c.slug === slug && c.active)) return reply(i, 'Nama kategori sudah digunakan.');
    next.name = cleanName; next.slug = slug;
  }
  if (gameLink) {
    let placeId;
    try { placeId = parseRobloxPlaceId(gameLink); } catch (error) { return reply(i, error.message); }
    if (categories.some((c, n) => n !== index && c.placeId === placeId)) return reply(i, 'Game tersebut sudah digunakan kategori lain.');
    next.placeId = placeId; next.gameUrl = `https://www.roblox.com/games/${placeId}`;
    await i.deferReply({ flags: EPHEMERAL });
    try { next.iconUrl = await fetchGameIcon(placeId); next.iconUpdatedAt = Date.now(); }
    catch (error) { next.iconUrl = null; next.iconUpdatedAt = null; }
  }
  categories[index] = next; setCategories(i.guildId, categories);
  if (i.deferred) return i.editReply(`Kategori berhasil diperbarui: **${next.name}**.`);
  return reply(i, `Kategori berhasil diperbarui: **${next.name}**.`);
}

async function archiveCategory(i) {
  const id = i.options.getString('category', true);
  const categories = categoriesFor(i.guildId);
  const category = categories.find((c) => c.id === id);
  if (!category) return reply(i, 'Kategori tidak ditemukan.');
  category.active = false; category.updatedAt = Date.now(); setCategories(i.guildId, categories);
  return reply(i, `Kategori **${category.name}** diarsipkan. Riwayat changelog tetap disimpan.`);
}

async function previewCategory(i) {
  const id = i.options.getString('category', true);
  const category = categoryById(i.guildId, id);
  if (!category) return reply(i, 'Kategori tidak ditemukan.');
  await i.deferReply({ flags: EPHEMERAL_V2 });
  const refreshed = await refreshIcon(category);
  if (refreshed.refreshed) { category.iconUrl = refreshed.url; category.iconUpdatedAt = Date.now(); setCategories(i.guildId, categoriesFor(i.guildId)); }
  await i.editReply({ ...buildCategoryPanel(category, refreshed.url), flags: EPHEMERAL_V2 });
}

async function setCategoryChannel(i) {
  const id = i.options.getString('category', true);
  const channel = i.options.getChannel('channel', true);
  const categories = categoriesFor(i.guildId);
  const category = categories.find((c) => c.id === id);
  if (!category || !category.active) return reply(i, 'Kategori tidak ditemukan atau sudah diarsipkan.');
  const me = i.guild.members.me || await i.guild.members.fetchMe();
  if (!channel.permissionsFor(me)?.has([P.ViewChannel, P.SendMessages])) return reply(i, `Bot tidak memiliki izin mengirim pesan di ${channel}.`);
  category.changelogChannelId = channel.id; category.updatedAt = Date.now(); setCategories(i.guildId, categories);
  return reply(i, `Channel changelog untuk **${category.name}** disimpan ke ${channel}. Pengaturan ini akan digunakan otomatis setiap update kategori tersebut.`);
}

function makeButtons(i) {
  const labels = [i.options.getString('button1', true), i.options.getString('button2'), i.options.getString('button3')];
  const channels = [i.options.getChannel('directchannelbutton1', true), i.options.getChannel('directchannelbutton2'), i.options.getChannel('directchannelbutton3')];
  const buttons = [];
  for (let index = 0; index < 3; index += 1) {
    if (Boolean(labels[index]) !== Boolean(channels[index])) throw new Error(`Button ${index + 1}: label dan directchannel harus diisi berpasangan.`);
    if (labels[index] && channels[index]) {
      const label = safeText(labels[index], 80);
      if (!label) throw new Error(`Label Button ${index + 1} tidak boleh kosong.`);
      buttons.push({ label, channelId: channels[index].id });
    }
  }
  if (!buttons.length) throw new Error('Button 1 wajib diisi.');
  return buttons;
}

async function createUpdatePreview(i) {
  const id = i.options.getString('category', true);
  const category = categoryById(i.guildId, id);
  if (!category || !category.active) return reply(i, 'Kategori tidak ditemukan atau sudah diarsipkan.');
  if (!category.changelogChannelId) return reply(i, `Channel changelog untuk **${category.name}** belum diatur. Jalankan \/script channel set terlebih dahulu.`);
  let buttons;
  try { buttons = makeButtons(i); } catch (error) { return reply(i, error.message); }
  if (i.options.getString('button3') && !i.options.getString('button2')) return reply(i, 'Button 3 hanya dapat digunakan jika Button 2 juga diisi.');
  const title = safeText(i.options.getString('title', true), 100);
  const description = safeText(i.options.getString('description', true), 3000);
  if (!title || !description) return reply(i, 'Title dan description tidak boleh kosong.');
  const draftId = crypto.randomBytes(5).toString('hex');
  await i.deferReply({ flags: EPHEMERAL_V2 });
  const channel = i.guild.channels.cache.get(category.changelogChannelId) || await i.guild.channels.fetch(category.changelogChannelId).catch(() => null);
  const me = i.guild.members.me || await i.guild.members.fetchMe();
  if (!channel?.isTextBased?.() || !channel.permissionsFor(me)?.has([P.ViewChannel, P.SendMessages])) {
    return i.editReply({ components: [new ContainerBuilder().addTextDisplayComponents(text('## Channel Unavailable\nChannel changelog tidak tersedia atau bot tidak memiliki izin mengirim pesan.'))], flags: V2, allowedMentions: noMentions });
  }
  const icon = await refreshIcon(category);
  if (icon.refreshed) { category.iconUrl = icon.url; category.iconUpdatedAt = Date.now(); setCategories(i.guildId, categoriesFor(i.guildId)); }
  const draft = {
    id: draftId, guildId: i.guildId, ownerId: i.user.id, categoryId: category.id,
    gameName: category.name, title,
    description,
    buttons, iconUrl: icon.url, createdAt: Date.now(), expiresAt: Date.now() + DRAFT_TTL_MS,
    publishing: false,
  };
  drafts.set(draftId, draft);
  await i.editReply({ ...changelogContainer(draft, { preview: true }), flags: EPHEMERAL_V2 });
  if (!icon.refreshed && icon.error) await i.followUp({ content: `-# Catatan: ikon terbaru gagal diambil (${safeText(icon.error, 160)}); preview menggunakan ikon terakhir yang tersimpan jika tersedia.`, flags: EPHEMERAL });
}

async function publishDraft(i, draftId) {
  const draft = drafts.get(draftId);
  if (!draft || draft.expiresAt < Date.now()) { drafts.delete(draftId); return i.update({ components: [new ContainerBuilder().addTextDisplayComponents(text('## Preview Expired\nPreview sudah kedaluwarsa. Buat changelog baru.'))], flags: V2, allowedMentions: noMentions }); }
  if (draft.ownerId !== i.user.id || draft.guildId !== i.guildId) return i.reply({ content: 'Preview ini bukan milikmu.', flags: EPHEMERAL });
  if (draft.publishing) return i.reply({ content: 'Changelog sedang diproses. Tunggu sebentar.', flags: EPHEMERAL });
  draft.publishing = true;
  await i.deferUpdate();
  try {
    const category = categoryById(i.guildId, draft.categoryId);
    if (!category || !category.active || !category.changelogChannelId) throw new Error('Kategori tidak aktif atau channel changelog belum diatur.');
    const channel = i.guild.channels.cache.get(category.changelogChannelId) || await i.guild.channels.fetch(category.changelogChannelId).catch(() => null);
    const me = i.guild.members.me || await i.guild.members.fetchMe();
    if (!channel?.isTextBased?.() || !channel.permissionsFor(me)?.has([P.ViewChannel, P.SendMessages])) throw new Error('Bot tidak memiliki izin mengirim pesan ke channel changelog.');
    const latestIcon = await refreshIcon(category);
    if (latestIcon.refreshed) { category.iconUrl = latestIcon.url; category.iconUpdatedAt = Date.now(); setCategories(i.guildId, categoriesFor(i.guildId)); }
    draft.iconUrl = latestIcon.url;
    const record = {
      id: draft.id, guildId: draft.guildId, categoryId: draft.categoryId,
      gameName: draft.gameName, title: draft.title, description: draft.description,
      buttons: draft.buttons, iconUrl: draft.iconUrl, channelId: channel.id,
      messageId: null, createdAt: draft.createdAt, publishedAt: Date.now(),
      publishedBy: i.user.id, status: 'publishing',
    };
    updateState.updates.push(record);
    if (updateState.updates.length > 2000) updateState.updates.splice(0, updateState.updates.length - 2000);
    saveUpdates(); // Persist button routing before the public message is sent.
    let message;
    try {
      message = await channel.send(changelogContainer({ ...draft, publishedAt: record.publishedAt }));
    } catch (sendError) {
      updateState.updates = updateState.updates.filter((item) => item.id !== record.id);
      saveUpdates();
      throw sendError;
    }
    drafts.delete(draftId); // Never allow a second publish after Discord accepted the message.
    record.messageId = message.id;
    record.status = 'published';
    record.publishedAt = Date.now();
    let historySaved = true;
    try { saveUpdates(); } catch (saveError) { historySaved = false; console.error('[script] Changelog published but final history update failed:', saveError); }
    await sendLog(i.guild, { category: 'script', title: 'Script changelog published', body: `Game: **${record.gameName}**\nScript: **${record.title}**\nChannel: <#${channel.id}>\nPublished by: <@${i.user.id}>` });
    await i.editReply({ components: [new ContainerBuilder().addTextDisplayComponents(text(`## Changelog Published\n**${record.title}** untuk **${record.gameName}** berhasil diterbitkan di <#${channel.id}>.\n[Open changelog](https://discord.com/channels/${i.guildId}/${channel.id}/${message.id})${historySaved ? '' : '\n\n-# Peringatan: pesan sudah terbit, tetapi riwayat akhir gagal diperbarui. Periksa file script-updates.json.'}`))], flags: V2, allowedMentions: noMentions });
  } catch (error) {
    draft.publishing = false;
    await i.editReply({ components: [new ContainerBuilder().addTextDisplayComponents(text(`## Publish Failed\n${safeText(error.message, 500)}\n\nPreview masih tersedia selama belum kedaluwarsa. Silakan coba kembali.`))], flags: V2, allowedMentions: noMentions });
  }
}

async function cancelDraft(i, draftId) {
  const draft = drafts.get(draftId);
  if (!draft) return i.update({ components: [new ContainerBuilder().addTextDisplayComponents(text('## Preview Unavailable\nPreview sudah tidak tersedia.'))], flags: V2, allowedMentions: noMentions });
  if (draft.ownerId !== i.user.id || draft.guildId !== i.guildId) return i.reply({ content: 'Preview ini bukan milikmu.', flags: EPHEMERAL });
  drafts.delete(draftId);
  return i.update({ components: [new ContainerBuilder().addTextDisplayComponents(text('## Changelog Cancelled\nDraft dibatalkan dan tidak diterbitkan.'))], flags: V2, allowedMentions: noMentions });
}

async function openButtonTarget(i, updateId, buttonNumber) {
  const record = updateState.updates.find((item) => item.id === updateId && item.guildId === i.guildId);
  const target = record?.buttons?.[buttonNumber - 1];
  if (!target) return reply(i, 'Tujuan tombol tidak ditemukan. Hubungi administrator server.');
  await i.deferReply({ flags: EPHEMERAL });
  const channel = i.guild.channels.cache.get(target.channelId) || await i.guild.channels.fetch(target.channelId).catch(() => null);
  if (!channel) return i.editReply('Channel tujuan sudah tidak tersedia. Hubungi administrator server.');
  const url = `https://discord.com/channels/${i.guildId}/${target.channelId}`;
  return i.editReply({ content: `**${target.label}**\nChannel tujuan: ${channel}\n[Open channel](${url})`, allowedMentions: noMentions });
}

async function showHistory(i) {
  const categoryId = i.options.getString('category');
  const limit = i.options.getInteger('limit') || 10;
  let records = updateState.updates.filter((item) => item.guildId === i.guildId);
  if (categoryId) records = records.filter((item) => item.categoryId === categoryId);
  records = records.slice(-limit).reverse();
  const lines = records.map((item) => `• **${safeText(item.gameName, 80)}** — ${safeText(item.title, 100)} · <t:${Math.floor(item.publishedAt / 1000)}:R> · ${item.messageId ? `[Open](https://discord.com/channels/${item.guildId}/${item.channelId}/${item.messageId})` : 'message link pending'}`);
  return reply(i, `## Script Changelog History\n${lines.join('\n') || 'Belum ada changelog yang diterbitkan.'}`);
}

async function handle(i) {
  if (i.isAutocomplete()) return handleAutocomplete(i);
  if (i.isChatInputCommand() && i.commandName === 'script') {
    if (!i.memberPermissions?.has(P.ManageGuild)) return reply(i, 'Command Script Management membutuhkan izin Manage Server.');
    const group = i.options.getSubcommandGroup(false);
    const sub = i.options.getSubcommand();
    if (group === 'category') {
      if (sub === 'add') { await addCategory(i); return true; }
      if (sub === 'list') { await listCategories(i); return true; }
      if (sub === 'edit') { await editCategory(i); return true; }
      if (sub === 'archive') { await archiveCategory(i); return true; }
      if (sub === 'preview') { await previewCategory(i); return true; }
    }
    if (group === 'channel' && sub === 'set') { await setCategoryChannel(i); return true; }
    if (!group && sub === 'update') { await createUpdatePreview(i); return true; }
    if (!group && sub === 'history') { await showHistory(i); return true; }
    return false;
  }
  if (i.isButton()) {
    let match = /^script:publish:([a-f0-9]{10})$/.exec(i.customId);
    if (match) { await publishDraft(i, match[1]); return true; }
    match = /^script:cancel:([a-f0-9]{10})$/.exec(i.customId);
    if (match) { await cancelDraft(i, match[1]); return true; }
    match = /^script:target:([a-f0-9]{10}):(\d)$/.exec(i.customId);
    if (match) { await openButtonTarget(i, match[1], Number(match[2])); return true; }
    if (i.customId.startsWith('script:preview:')) { await reply(i, 'Preview Mode', 'Tombol tujuan hanya aktif setelah changelog diterbitkan.'); return true; }
  }
  return false;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, draft] of drafts) if (draft.expiresAt <= now) drafts.delete(id);
}, 60_000).unref();

module.exports = { name: 'script', commands, handle };
