const {
  Events,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  PermissionFlagsBits: P,
  ChannelType,
  GatewayIntentBits,
} = require('discord.js');

const settings = require('../lib/settings');
const { sendLog } = require('../lib/logger');

const V2 = MessageFlags.IsComponentsV2;
const EPHEMERAL = MessageFlags.Ephemeral;

const MODAL_ID = 'welcome:modal';

const DEFAULTS = {
  welcomeTitle: 'Selamat Datang!',
  welcomeBody:
    'Halo {user}, selamat datang di **{server}**!\n' +
    'Kamu member ke-**{count}**. Baca peraturan dan selesaikan verifikasi ya.',
  goodbyeBody:
    '**{username}** telah meninggalkan **{server}**. Sampai jumpa!',
};

const GOODBYE_TITLE = 'Sampai Jumpa';

// ───────────── Components V2 Helpers ─────────────

const text = (content) =>
  new TextDisplayBuilder().setContent(content);

const divider = () =>
  new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(SeparatorSpacingSize.Small);

const fill = (tpl, vars) =>
  String(tpl ?? '').replace(
    /\{(user|username|server|count)\}/g,
    (_, key) => vars[key] ?? ''
  );

const varsOf = (member) => ({
  user: `<@${member.id}>`,
  username: member.user.username,
  server: member.guild.name,
  count: String(member.guild.memberCount),
});

/**
 * Panel Welcome / Goodbye.
 *
 * Hanya menggunakan satu gambar:
 * avatar user pada ThumbnailBuilder.
 *
 * Tidak menambahkan gambar atau thumbnail server.
 */
function memberPanel(title, body, user) {
  const timestamp = Math.floor(Date.now() / 1000);

  const userAvatar = user.displayAvatarURL({
    extension: 'png',
    size: 256,
  });

  // Keep the title and body in the same text display as the avatar accessory.
  // This prevents the thumbnail's height from creating a large visual gap
  // between the title and body in welcome/goodbye panels.
  const memberSection = new SectionBuilder()
    .addTextDisplayComponents(
      text(`# ${title}\n${body}`)
    )
    .setThumbnailAccessory(
      new ThumbnailBuilder().setURL(userAvatar)
    );

  const container = new ContainerBuilder()
    .addSectionComponents(memberSection)
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(
      text(`-# <t:${timestamp}:F>`)
    );

  return container;
}

// ───────────── Permission Helpers ─────────────

const canSend = (guild, channel) =>
  channel
    ?.permissionsFor(guild.members.me)
    ?.has([P.ViewChannel, P.SendMessages]) ?? false;

const deny = (interaction, content) =>
  interaction.reply({
    content,
    flags: EPHEMERAL,
  });

const isAdmin = (interaction) =>
  interaction.memberPermissions?.has(P.Administrator) ?? false;

// ───────────── Event Join / Leave ─────────────

async function onMemberEvent(member, kind) {
  try {
    // Abaikan bot.
    if (member.user?.bot) return;

    const cfg = settings.get(member.guild.id)?.welcome;

    // Welcome belum dikonfigurasi.
    if (!cfg) return;

    const channelId =
      kind === 'welcome'
        ? cfg.welcomeChannelId
        : cfg.goodbyeChannelId || cfg.welcomeChannelId;

    const channel = member.guild.channels.cache.get(channelId);

    if (!canSend(member.guild, channel)) return;

    const title =
      kind === 'welcome'
        ? cfg.welcomeTitle ?? DEFAULTS.welcomeTitle
        : GOODBYE_TITLE;

    const body =
      kind === 'welcome'
        ? cfg.welcomeBody ?? DEFAULTS.welcomeBody
        : cfg.goodbyeBody ?? DEFAULTS.goodbyeBody;

    await channel.send({
      components: [
        memberPanel(
          title,
          fill(body, varsOf(member)),
          member.user
        ),
      ],
      flags: V2,

      // Hanya izinkan mention user yang baru bergabung.
      // Tidak mengizinkan mention massal.
      allowedMentions: {
        parse: [],
        users: kind === 'welcome' ? [member.id] : [],
      },
    });
    await sendLog(member.guild, { category: 'welcome', title: kind === 'welcome' ? 'Member joined' : 'Member left', body: `<@${member.id}> (${member.user.username}) ${kind === 'welcome' ? 'bergabung dengan' : 'meninggalkan'} server.` });
  } catch (err) {
    console.error(`Gagal mengirim ${kind}:`, err);
  }
}

function registerWelcomeEvents(client) {
  client.on(
    Events.GuildMemberAdd,
    (member) => onMemberEvent(member, 'welcome')
  );

  client.on(
    Events.GuildMemberRemove,
    (member) => onMemberEvent(member, 'goodbye')
  );
}

// ───────────── Setup Command ─────────────

async function setupCommand(interaction) {
  if (!isAdmin(interaction)) {
    return deny(
      interaction,
      'Perintah ini khusus Administrator.'
    );
  }

  const guild = interaction.guild;

  const welcomeCh = interaction.options.getChannel(
    'welcome-channel',
    true
  );

  const goodbyeCh = interaction.options.getChannel(
    'goodbye-channel'
  );

  for (const channel of [welcomeCh, goodbyeCh].filter(Boolean)) {
    if (!canSend(guild, channel)) {
      return deny(
        interaction,
        `Bot tidak bisa mengirim pesan ke ${channel}. ` +
          'Periksa permission bot di channel tersebut.'
      );
    }
  }

  const cfg = settings.get(guild.id)?.welcome ?? {};

  const input = (id, label, style, value, max) =>
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId(id)
        .setLabel(label)
        .setStyle(style)
        .setMinLength(1)
        .setMaxLength(max)
        .setValue(value)
        .setRequired(true)
    );

  const modal = new ModalBuilder()
    .setCustomId(
      `${MODAL_ID}:${welcomeCh.id}:${goodbyeCh?.id ?? '0'}`
    )
    .setTitle('Pesan Welcome & Goodbye')
    .addComponents(
      input(
        'wtitle',
        'Judul welcome',
        TextInputStyle.Short,
        cfg.welcomeTitle ?? DEFAULTS.welcomeTitle,
        100
      ),
      input(
        'wbody',
        'Pesan welcome ({user} {server} {count})',
        TextInputStyle.Paragraph,
        cfg.welcomeBody ?? DEFAULTS.welcomeBody,
        1500
      ),
      input(
        'gbody',
        'Pesan goodbye ({username} {server})',
        TextInputStyle.Paragraph,
        cfg.goodbyeBody ?? DEFAULTS.goodbyeBody,
        1500
      )
    );

  return interaction.showModal(modal);
}

// ───────────── Modal Submit ─────────────

async function modalSubmit(interaction) {
  if (!isAdmin(interaction)) {
    return deny(
      interaction,
      'Perintah ini khusus Administrator.'
    );
  }

  const [, , welcomeId, goodbyeId] =
    interaction.customId.split(':');

  if (!welcomeId || !goodbyeId) {
    return deny(
      interaction,
      'Data konfigurasi tidak valid. Jalankan kembali `/welcome setup`.'
    );
  }

  const welcomeTitle =
    interaction.fields.getTextInputValue('wtitle').trim();

  const welcomeBody =
    interaction.fields.getTextInputValue('wbody').trim();

  const goodbyeBody =
    interaction.fields.getTextInputValue('gbody').trim();

  if (!welcomeTitle || !welcomeBody || !goodbyeBody) {
    return deny(
      interaction,
      'Judul dan isi pesan tidak boleh kosong.'
    );
  }

  settings.set(interaction.guildId, {
    welcome: {
      welcomeChannelId: welcomeId,
      goodbyeChannelId:
        goodbyeId === '0' ? null : goodbyeId,
      welcomeTitle,
      welcomeBody,
      goodbyeBody,
    },
  });

  const goodbyeChannel =
    goodbyeId === '0' ? welcomeId : goodbyeId;

  return deny(
    interaction,
    'Welcome dan goodbye berhasil diaktifkan.\n' +
      `Welcome: <#${welcomeId}>\n` +
      `Goodbye: <#${goodbyeChannel}>\n\n` +
      'Uji tampilannya dengan `/welcome test`.'
  );
}

// ───────────── Test Welcome Command ─────────────

async function testCommand(interaction) {
  if (!isAdmin(interaction)) {
    return deny(
      interaction,
      'Perintah ini khusus Administrator.'
    );
  }

  const cfg = settings.get(interaction.guildId)?.welcome;

  if (!cfg) {
    return deny(
      interaction,
      'Welcome belum diatur. Jalankan `/welcome setup` terlebih dahulu.'
    );
  }

  const vars = varsOf(interaction.member);

  const welcomeTitle =
    cfg.welcomeTitle ?? DEFAULTS.welcomeTitle;

  const welcomeBody =
    cfg.welcomeBody ?? DEFAULTS.welcomeBody;

  const goodbyeBody =
    cfg.goodbyeBody ?? DEFAULTS.goodbyeBody;

  return interaction.reply({
    components: [
      memberPanel(
        welcomeTitle,
        fill(welcomeBody, vars),
        interaction.user
      ),
      memberPanel(
        GOODBYE_TITLE,
        fill(goodbyeBody, vars),
        interaction.user
      ),
    ],
    flags: V2 | EPHEMERAL,

    allowedMentions: {
      parse: [],
      users: [],
    },
  });
}

// ───────────── Interaction Handler ─────────────

async function handleWelcome(interaction) {
  if (
    interaction.isChatInputCommand() &&
    interaction.commandName === 'welcome'
  ) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'setup') {
      await setupCommand(interaction);
      return true;
    }

    if (subcommand === 'test') {
      await testCommand(interaction);
      return true;
    }

    return false;
  }

  if (
    interaction.isModalSubmit() &&
    interaction.customId.startsWith(`${MODAL_ID}:`)
  ) {
    await modalSubmit(interaction);
    return true;
  }

  return false;
}

// ───────────── Slash Commands ─────────────

const commands = [
  new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Pengelolaan pesan anggota masuk dan keluar')
    .addSubcommand((sub) => sub.setName('setup').setDescription('Atur pesan welcome dan goodbye otomatis')
      .addChannelOption((option) => option.setName('welcome-channel').setDescription('Channel pesan welcome').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addChannelOption((option) => option.setName('goodbye-channel').setDescription('Channel pesan goodbye (opsional)').addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((sub) => sub.setName('test').setDescription('Lihat pratinjau pesan welcome dan goodbye'))
    .setDefaultMemberPermissions(P.Administrator)
    .setContexts(0)
    .toJSON(),
];

// ───────────── Module Export ─────────────

module.exports = {
  name: 'welcome',

  // Aktifkan Server Members Intent di Discord Developer Portal.
  intents: [GatewayIntentBits.GuildMembers],

  commands,

  setup: registerWelcomeEvents,

  handle: handleWelcome,
};
