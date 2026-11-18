'use strict';
const path = require('node:path');
const {
  ChannelType, ContainerBuilder, MediaGalleryBuilder,
  MediaGalleryItemBuilder, MessageFlags, PermissionFlagsBits: P,
  SeparatorBuilder, SeparatorSpacingSize, SlashCommandBuilder, TextDisplayBuilder,
} = require('discord.js');
const { atomicWriteJson, readJson } = require('../lib/json-storage');
const panels = require('../lib/panel-registry');
const { editTrackedPanel } = require('../lib/panel-updater');
const { sendLog } = require('../lib/logger');

const V2 = MessageFlags.IsComponentsV2;
const EPHEMERAL = MessageFlags.Ephemeral;
const RULES_FILE = path.join(__dirname, '..', 'data', 'rules.json');
const text = (value) => new TextDisplayBuilder().setContent(value);
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const isAdmin = (i) => i.memberPermissions?.has(P.Administrator) === true;
const deny = (i, content) => i.reply({ content, flags: EPHEMERAL, allowedMentions: { parse: [] } });
const safe = (value, max) => String(value ?? '').replace(/@/g, '@\u200b').trim().slice(0, max);

function loadRules() {
  const value = readJson(RULES_FILE, {});
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
const rulesState = loadRules();
function saveRules() { atomicWriteJson(RULES_FILE, rulesState); }
function canSend(guild, channel) {
  const me = guild.members.me;
  return channel?.isTextBased?.() && channel.permissionsFor(me)?.has([P.ViewChannel, P.SendMessages]);
}
function rulesPayload(guildId, data) {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(text(`# ${data.title}`))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text(data.body))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text(`-# ${data.footer || 'Harap baca dan patuhi seluruh peraturan komunitas.'}`));
  return { components: [container], flags: V2, allowedMentions: { parse: [] } };
}

const commands = [
  new SlashCommandBuilder().setName('announcement').setDescription('Publikasi pengumuman komunitas')
    .addSubcommand((s) => s.setName('send').setDescription('Kirim pengumuman tanpa modal/form')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel tujuan').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
      .addStringOption((o) => o.setName('title').setDescription('Judul pengumuman').setMaxLength(100).setRequired(true))
      .addStringOption((o) => o.setName('description').setDescription('Isi pengumuman').setMaxLength(3500).setRequired(true))
      .addStringOption((o) => o.setName('ping').setDescription('Mention yang disertakan').addChoices({ name: 'Tanpa ping', value: 'none' }, { name: '@everyone', value: 'everyone' }, { name: '@here', value: 'here' }))
      .addRoleOption((o) => o.setName('role').setDescription('Role yang di-mention (opsional)'))
      .addAttachmentOption((o) => o.setName('image').setDescription('Gambar opsional untuk pengumuman')))
    .setDefaultMemberPermissions(P.Administrator).setContexts(0).toJSON(),
  new SlashCommandBuilder().setName('rules').setDescription('Pengelolaan peraturan server')
    .addSubcommand((s) => s.setName('publish').setDescription('Terbitkan atau perbarui panel rules tanpa form/translate')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel tujuan (default: channel ini)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addStringOption((o) => o.setName('title').setDescription('Judul panel rules').setMaxLength(100).setRequired(true))
      .addStringOption((o) => o.setName('body').setDescription('Isi peraturan server').setMaxLength(3500).setRequired(true))
      .addStringOption((o) => o.setName('footer').setDescription('Catatan penutup opsional').setMaxLength(500)))
    .setDefaultMemberPermissions(P.Administrator).setContexts(0).toJSON(),
];

async function sendAnnouncement(i) {
  if (!isAdmin(i)) return deny(i, 'Perintah ini khusus Administrator.');
  const channel = i.options.getChannel('channel', true);
  if (!canSend(i.guild, channel)) return deny(i, `Bot tidak memiliki izin mengirim pesan di ${channel}.`);
  const title = safe(i.options.getString('title', true), 100);
  const description = safe(i.options.getString('description', true), 3500);
  const ping = i.options.getString('ping') || 'none';
  const role = i.options.getRole('role');
  const image = i.options.getAttachment('image');
  if (image && (!String(image.contentType || '').startsWith('image/') || image.size > 8 * 1024 * 1024)) {
    return deny(i, 'Lampiran harus berupa gambar dengan ukuran maksimal 8 MB.');
  }
  await i.deferReply({ flags: EPHEMERAL });
  const mentions = [];
  if (ping === 'everyone') mentions.push('@everyone');
  if (ping === 'here') mentions.push('@here');
  if (role) mentions.push(`<@&${role.id}>`);
  const container = new ContainerBuilder()
    .addTextDisplayComponents(text(`# ${title}`))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text(description))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text(`-# Diumumkan oleh <@${i.user.id}> · <t:${Math.floor(Date.now() / 1000)}:F>`));
  if (image) {
    const perms = channel.permissionsFor(i.guild.members.me);
    if (!perms?.has(P.EmbedLinks)) return i.editReply('Bot membutuhkan izin Embed Links untuk menampilkan gambar pengumuman.');
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL(image.url).setDescription(title)
    ));
  }
  const payload = {
    components: [...(mentions.length ? [text(mentions.join(' '))] : []), container],
    flags: V2,
    allowedMentions: { parse: ping === 'everyone' || ping === 'here' ? ['everyone'] : [], roles: role ? [role.id] : [], users: [] },
  };
  try {
    await channel.send(payload);
    await sendLog(i.guild, { category: 'announcement', title: 'Announcement published', body: `Judul: **${title}**\nChannel: <#${channel.id}>\nPublished by: <@${i.user.id}>` });
    return i.editReply(`Pengumuman berhasil diterbitkan di ${channel}.`);
  } catch (error) {
    console.error('[announcement] Gagal menerbitkan pengumuman:', error);
    return i.editReply('Pengumuman gagal dikirim. Periksa izin bot dan coba lagi.');
  }
}

async function publishRules(i) {
  if (!isAdmin(i)) return deny(i, 'Perintah ini khusus Administrator.');
  const channel = i.options.getChannel('channel') || i.channel;
  if (!canSend(i.guild, channel)) return deny(i, `Bot tidak memiliki izin mengirim pesan di ${channel}.`);
  const data = {
    title: safe(i.options.getString('title', true), 100),
    body: safe(i.options.getString('body', true), 3500),
    footer: safe(i.options.getString('footer') || 'Dengan tetap berada di server ini, kamu dianggap menyetujui peraturan yang berlaku.', 500),
  };
  await i.deferReply({ flags: EPHEMERAL });
  const previous = panels.get(i.guildId, 'rules');
  let existing = null;
  if (previous?.channelId === channel.id && previous.messageId) existing = await channel.messages.fetch(previous.messageId).catch(() => null);
  try {
    const message = existing
      ? await existing.edit(rulesPayload(i.guildId, data))
      : await channel.send(rulesPayload(i.guildId, data));
    rulesState[i.guildId] = { ...data, channelId: channel.id, messageId: message.id, updatedAt: Date.now() };
    saveRules();
    panels.set(i.guildId, 'rules', { channelId: channel.id, messageId: message.id });
    await sendLog(i.guild, { category: 'announcement', title: 'Server rules published', body: `Channel: <#${channel.id}>\nUpdated by: <@${i.user.id}>` });
    return i.editReply(`Panel rules ${existing ? 'diperbarui' : 'diterbitkan'} di ${channel}. Tidak ada tombol translate atau form input.`);
  } catch (error) {
    console.error('[rules] Gagal menerbitkan rules:', error);
    return i.editReply('Panel rules gagal diterbitkan. Periksa izin bot dan coba lagi.');
  }
}

async function handle(i) {
  if (!i.isChatInputCommand()) return false;
  if (i.commandName === 'announcement' && i.options.getSubcommand() === 'send') { await sendAnnouncement(i); return true; }
  if (i.commandName === 'rules' && i.options.getSubcommand() === 'publish') { await publishRules(i); return true; }
  return false;
}

async function refreshPublicPanels(guild) {
  const data = rulesState[guild.id];
  if (!data) return ['missing'];
  return [await editTrackedPanel(guild, { channelId: data.channelId, messageId: data.messageId }, rulesPayload(guild.id, data))];
}

module.exports = { name: 'announcements', commands, handle, refreshPublicPanels };
