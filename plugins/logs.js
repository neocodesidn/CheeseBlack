'use strict';
const { ChannelType, MessageFlags, PermissionFlagsBits: P, SlashCommandBuilder } = require('discord.js');
const settings = require('../lib/settings');
const { sendLog } = require('../lib/logger');

const LOG_TYPES = [
  { name: 'Verification', value: 'verification' },
  { name: 'Role Panel', value: 'roles' },
  { name: 'Ticket', value: 'ticket' },
  { name: 'Donation', value: 'donation' },
  { name: 'Boost', value: 'boost' },
  { name: 'Welcome', value: 'welcome' },
  { name: 'Announcement', value: 'announcement' },
  { name: 'Script Management', value: 'script' },
  { name: 'System', value: 'system' },
];
const EPHEMERAL = MessageFlags.Ephemeral;
const commands = [
  new SlashCommandBuilder().setName('logs').setDescription('Pengaturan channel log per fitur')
    .addSubcommand((s) => s.setName('set').setDescription('Atur channel log untuk satu jenis aktivitas')
      .addStringOption((o) => o.setName('type').setDescription('Jenis log').setRequired(true).addChoices(...LOG_TYPES))
      .addChannelOption((o) => o.setName('channel').setDescription('Channel tujuan log').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand((s) => s.setName('status').setDescription('Lihat seluruh pemetaan channel log'))
    .setDefaultMemberPermissions(P.Administrator).setContexts(0).toJSON(),
];
async function handle(i) {
  if (!i.isChatInputCommand() || i.commandName !== 'logs') return false;
  if (!i.memberPermissions?.has(P.Administrator)) {
    await i.reply({ content: 'Perintah ini khusus Administrator.', flags: EPHEMERAL });
    return true;
  }
  const sub = i.options.getSubcommand();
  const current = settings.get(i.guildId);
  if (sub === 'set') {
    const type = i.options.getString('type', true);
    const channel = i.options.getChannel('channel', true);
    const me = i.guild.members.me || await i.guild.members.fetchMe();
    if (!channel.permissionsFor(me)?.has([P.ViewChannel, P.SendMessages])) {
      await i.reply({ content: `Bot tidak memiliki izin mengirim pesan di ${channel}.`, flags: EPHEMERAL });
      return true;
    }
    const logChannels = { ...(current.logChannels || {}), [type]: channel.id };
    settings.set(i.guildId, { logChannels });
    await sendLog(i.guild, { category: type, title: 'Log channel configured', body: `Jenis log **${type}** sekarang dikirim ke ${channel}.` });
    await i.reply({ content: `Channel log **${type}** berhasil diatur ke ${channel}.`, flags: EPHEMERAL });
    return true;
  }
  if (sub === 'status') {
    const channels = current.logChannels || {};
    const lines = LOG_TYPES.map((type) => `**${type.name}:** ${channels[type.value] ? `<#${channels[type.value]}>` : 'Belum diatur'}`);
    await i.reply({ content: `## Log Channel Mapping\n${lines.join('\n')}\n\n-# Setiap jenis log memiliki channel terpisah.`, flags: EPHEMERAL });
    return true;
  }
  return false;
}
module.exports = { name: 'logs', commands, handle, LOG_TYPES };
