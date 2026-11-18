'use strict';
const {
  MessageFlags, ContainerBuilder, TextDisplayBuilder, FileBuilder, AttachmentBuilder,
  PermissionFlagsBits: P,
} = require('discord.js');
const settings = require('./settings');
const V2 = MessageFlags.IsComponentsV2;
const text = (content) => new TextDisplayBuilder().setContent(content);

/** Kirim log ke channel khusus kategori; fallback ke logChannelId lama bila tersedia. */
async function sendLog(guild, { title, body, file, category = 'system' }) {
  const config = settings.get(guild.id);
  const channelId = config.logChannels?.[category];
  if (!channelId) return false;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!channel?.permissionsFor(me)?.has([P.ViewChannel, P.SendMessages])) return false;
  const ts = Math.floor(Date.now() / 1000);
  const container = new ContainerBuilder().addTextDisplayComponents(
    text(`## ${title}\n${String(body).slice(0, 3500)}`),
    text(`-# Category: ${category} · <t:${ts}:F>`),
  );
  const payload = { components: [container], flags: V2, allowedMentions: { parse: [] } };
  if (file) {
    container.addFileComponents(new FileBuilder().setURL(`attachment://${file.name}`));
    payload.files = [new AttachmentBuilder(file.buffer, { name: file.name })];
  }
  try { await channel.send(payload); return true; }
  catch (err) { console.error(`Gagal kirim log ${category}:`, err.message); return false; }
}
module.exports = { sendLog };
