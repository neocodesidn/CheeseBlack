require('dotenv').config();
const { Client, Events, GatewayIntentBits, MessageFlags } = require('discord.js');
const { loadPlugins } = require('./lib/loader');
const logger = require('./lib/console-logger');
const { BOT_NAME, BOT_DESCRIPTION } = require('./lib/brand');
const safetyControls = require('./lib/safety-controls');
const securityAudit = require('./lib/security-audit');
const { parseOwnerIds, isOwner } = require('./lib/owner-access');
const { getBlockReason, isSafetyExemptInteraction } = require('./lib/safety-guard');

if (!process.env.DISCORD_TOKEN) {
  logger.fatal('DISCORD_TOKEN belum diatur. Periksa file .env.');
  process.exit(1);
}

logger.info({ node: process.version, botName: BOT_NAME, description: BOT_DESCRIPTION }, `Memulai ${BOT_NAME}`);

// Tidak ada icon pack atau dekorasi ikon otomatis pada versi awal.
// Semua fitur ada di folder /plugins (lihat plugins/_template.js untuk membuat plugin baru).
const plugins = loadPlugins();
logger.info(
  { count: plugins.length, plugins: plugins.map((plugin) => plugin.name) },
  'Plugin berhasil dimuat'
);
if (!parseOwnerIds().length) {
  logger.warn('BOT_OWNER_IDS belum diatur. Semua akses /admin akan ditolak sampai Discord user ID pemilik ditambahkan ke .env.');
}

// Intent digabung dari kebutuhan tiap plugin.
const intents = new Set([GatewayIntentBits.Guilds]);
for (const plugin of plugins) {
  for (const intent of plugin.intents ?? []) intents.add(intent);
}

const client = new Client({ intents: [...intents] });
for (const plugin of plugins) plugin.setup?.(client);

client.once(Events.ClientReady, (readyClient) => {
  logger.info(
    {
      user: readyClient.user.tag,
      userId: readyClient.user.id,
      guilds: readyClient.guilds.cache.size,
      shards: readyClient.ws.shards.size,
      pingMs: readyClient.ws.ping,
    },
    'Bot berhasil terhubung ke Discord'
  );
  logger.info('Semua handler siap menerima interaksi');
});

client.on(Events.InteractionCreate, async (interaction) => {
  // Safety gate applies before plugin handlers. Owner controls remain available
  // during maintenance or a guild pause. Fail closed if the
  // safety-control file is corrupt, but do not block the configured owner.
  try {
    const block = getBlockReason(interaction, safetyControls, isOwner);
    if (block) {
      if (interaction.isAutocomplete()) { await interaction.respond([]).catch(() => {}); return; }
      const reason = String(block.reason || 'Fitur sementara tidak tersedia.').replace(/@/g, '@\u200b').slice(0, 700);
      const heading = block.type === 'global-maintenance'
        ? `${BOT_NAME} sedang dalam maintenance global.`
        : `Fitur ${BOT_NAME} sementara dijeda pada server ini.`;
      await interaction.reply({
        content: `${heading}\nAlasan: ${reason}\nUntuk melaporkan penyalahgunaan atau masalah, gunakan /help commands.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }
  } catch (err) {
    logger.error({ err, userId: interaction.user?.id, guildId: interaction.guildId }, 'Safety control gagal dibaca; interaksi diblokir (fail closed)');
    if (interaction.isAutocomplete()) { await interaction.respond([]).catch(() => {}); }
    else if (interaction.guildId && !isOwner(interaction.user?.id) && !isSafetyExemptInteraction(interaction) && interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: `Kontrol keamanan ${BOT_NAME} sedang bermasalah. Fitur diblokir sementara untuk melindungi server. Hubungi Bot Owner.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      }).catch(() => {});
    }
    return;
  }

  let activePlugin = 'unknown';

  try {
    for (const plugin of plugins) {
      if (!plugin.handle) continue;
      activePlugin = plugin.name;
      if (await plugin.handle(interaction)) return;
    }
  } catch (err) {
    logger.error(
      {
        err,
        plugin: activePlugin,
        interactionType: interaction.type,
        command: interaction.isChatInputCommand() ? interaction.commandName : undefined,
        customId: interaction.customId,
        userId: interaction.user?.id,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
      },
      'Gagal memproses interaction'
    );

    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      interaction
        .reply({ content: 'Terjadi kesalahan. Coba lagi.', flags: MessageFlags.Ephemeral })
        .catch((replyError) => {
          logger.warn({ err: replyError }, 'Tidak dapat mengirim respons error ke pengguna');
        });
    }
  }
});

client.on(Events.GuildCreate, (guild) => {
  logger.info({ guildId: guild.id }, `${BOT_NAME} ditambahkan ke server baru`);
  try { securityAudit.record({ action: 'guild_joined', targetGuildId: guild.id, details: {} }); }
  catch (err) { logger.warn({ err, guildId: guild.id }, 'Gagal mencatat event server baru ke audit log'); }
});

client.on(Events.GuildDelete, (guild) => {
  logger.warn({ guildId: guild.id }, `${BOT_NAME} keluar atau dihapus dari server`);
  try { securityAudit.record({ action: 'guild_left', targetGuildId: guild.id, details: {} }); }
  catch (err) { logger.warn({ err, guildId: guild.id }, 'Gagal mencatat event server keluar ke audit log'); }
});

client.on(Events.Error, (err) => {
  logger.error({ err }, 'Discord client mengalami error');
});

client.on(Events.Warn, (warning) => {
  logger.warn({ warning }, 'Peringatan dari Discord.js');
});

client.on(Events.ShardError, (err, shardId) => {
  logger.error({ err, shardId }, 'Koneksi shard mengalami error');
});

client.on(Events.ShardDisconnect, (closeEvent, shardId) => {
  logger.warn(
    { shardId, code: closeEvent.code, reason: closeEvent.reason },
    'Shard terputus dari Discord'
  );
});

client.on(Events.ShardReconnecting, (shardId) => {
  logger.warn({ shardId }, 'Mencoba menghubungkan ulang shard');
});

client.on(Events.ShardResume, (shardId, replayedEvents) => {
  logger.info({ shardId, replayedEvents }, 'Koneksi shard berhasil dipulihkan');
});

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});

client.login(process.env.DISCORD_TOKEN).catch((err) => {
  if (err.code === 'DisallowedIntents') {
    logger.fatal(
      { errCode: err.code },
      'Discord menolak intent. Buka Developer Portal > Bot > Privileged Gateway Intents.'
    );
    logger.error(
      'Aktifkan Server Members Intent untuk Welcome, Boost, Invites, dan Trap; aktifkan Guild Invites Intent untuk Invite Tracking.'
    );
  } else {
    logger.fatal({ err }, 'Gagal login ke Discord');
  }
  process.exit(1);
});
