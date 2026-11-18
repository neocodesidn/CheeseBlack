const { atomicWriteJson } = require('../lib/json-storage');
const { sendLog } = require('../lib/logger');
const fs = require('fs');
const path = require('path');
const {
  ChannelType,
  ContainerBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits: P,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SlashCommandBuilder,
  TextDisplayBuilder,
} = require('discord.js');

const FILE = path.join(__dirname, '..', 'data', 'boost.json');
const V2 = MessageFlags.IsComponentsV2;
const EPHEMERAL = MessageFlags.Ephemeral;

function load() {
  try {
    const value = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error('Gagal membaca data yang sudah ada: ' + err.message);
    return {};
  }
}

const config = load();
const save = () => {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  atomicWriteJson(FILE, config);
};
const text = (content) => new TextDisplayBuilder().setContent(content);
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

const commands = [
  new SlashCommandBuilder()
    .setName('boost')
    .setDescription('Pengelolaan notifikasi server boost')
    .addSubcommand((sub) => sub.setName('setup').setDescription('Atur channel ucapan boost otomatis')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel teks tujuan').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .setDefaultMemberPermissions(P.ManageGuild)
    .setContexts(0)
    .toJSON(),
];

async function setupCommand(i) {
  if (!i.memberPermissions?.has(P.ManageGuild)) {
    return i.reply({ content: 'Perintah ini membutuhkan izin Manage Server.', flags: EPHEMERAL });
  }
  const channel = i.options.getChannel('channel', true);
  const me = i.guild.members.me ?? (await i.guild.members.fetchMe().catch(() => null));
  if (channel.type !== ChannelType.GuildText) {
    return i.reply({ content: 'Pilih channel teks server.', flags: EPHEMERAL });
  }
  if (!me || !channel.permissionsFor(me)?.has([P.ViewChannel, P.SendMessages])) {
    return i.reply({ content: `Bot membutuhkan izin View Channel dan Send Messages di ${channel}.`, flags: EPHEMERAL });
  }

  config[i.guildId] = { channelId: channel.id, updatedAt: Date.now() };
  save();
  return i.reply({
    components: [new ContainerBuilder().addTextDisplayComponents(text(
      `## Ucapan Boost Diaktifkan\nUcapan otomatis ketika anggota melakukan boost akan dikirim ke ${channel}.`
    ))],
    flags: V2 | EPHEMERAL,
  });
}

async function onMemberUpdate(oldMember, newMember) {
  try {
    // Kirim hanya saat status berubah dari tidak boost menjadi boost.
    if (oldMember.premiumSince || !newMember.premiumSince || newMember.user?.bot) return;
    const setting = config[newMember.guild.id];
    if (!setting?.channelId) return;

    const channel = await newMember.guild.channels.fetch(setting.channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) return;
    const me = newMember.guild.members.me ?? (await newMember.guild.members.fetchMe().catch(() => null));
    if (!me || !channel.permissionsFor(me)?.has([P.ViewChannel, P.SendMessages])) return;

    const boostCount = Number(newMember.guild.premiumSubscriptionCount || 0);
    const tier = Number(newMember.guild.premiumTier || 0);
    const container = new ContainerBuilder()
      .addTextDisplayComponents(text('# TERIMA KASIH SUDAH BOOST!'))
      .addSeparatorComponents(divider())
      .addTextDisplayComponents(text(
        `Terima kasih <@${newMember.id}> telah memberikan **Server Boost** untuk **${newMember.guild.name}**! 💜\n\n` +
        'Dukunganmu membantu komunitas ini berkembang dan membuka lebih banyak fitur untuk semua anggota.'
      ))
      .addSeparatorComponents(divider())
      .addTextDisplayComponents(text(
        `-# Total boost server: ${boostCount} · Level boost: ${tier} · <t:${Math.floor(Date.now() / 1000)}:F>`
      ));

    await channel.send({
      components: [container],
      flags: V2,
      allowedMentions: { parse: [], users: [newMember.id] },
    });
    await sendLog(newMember.guild, { category: 'boost', title: 'Server boost received', body: `<@${newMember.id}> memberikan boost ke server.` });
  } catch (err) {
    console.error('[boost] Gagal mengirim ucapan boost:', err.message);
  }
}

function setup(client) {
  client.on(Events.GuildMemberUpdate, onMemberUpdate);
}

async function handle(i) {
  if (i.isChatInputCommand() && i.commandName === 'boost' && i.options.getSubcommand() === 'setup') {
    await setupCommand(i);
    return true;
  }
  return false;
}

module.exports = {
  name: 'boost',
  intents: [GatewayIntentBits.GuildMembers],
  commands,
  setup,
  handle,
};
