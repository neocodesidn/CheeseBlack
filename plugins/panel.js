'use strict';
const { Events, MessageFlags, PermissionFlagsBits: P, SlashCommandBuilder } = require('discord.js');
const updater = require('../lib/panel-updater');
const logger = require('../lib/console-logger');
const EPHEMERAL = MessageFlags.Ephemeral;
let running = false;
async function tick(client) {
  if (running) return;
  running = true;
  try {
    for (const guild of client.guilds.cache.values()) {
      if (updater.isBusy(guild.id)) continue;
      const stats = await updater.run(guild);
      if (stats.failed) logger.warn({ guildId: guild.id, ...stats }, 'Sebagian panel gagal diperbarui');
    }
  } catch (err) { logger.warn({ err }, 'Auto-refresh panel mengalami kesalahan'); }
  finally { running = false; }
}
function setup(client) {
  client.once(Events.ClientReady, () => {
    tick(client).catch((err) => logger.warn({ err }, 'Gagal refresh panel saat startup'));
    setInterval(() => tick(client), 60_000).unref();
    logger.info('Panel updater aktif setiap 60 detik.');
  });
}
const commands = [new SlashCommandBuilder().setName('panels').setDescription('Pengelolaan panel permanen')
  .addSubcommand((s) => s.setName('refresh').setDescription('Perbarui panel permanen di server ini'))
  .setDefaultMemberPermissions(P.ManageGuild).setContexts(0).toJSON()];
async function handle(i) {
  if (!i.isChatInputCommand() || i.commandName !== 'panels' || i.options.getSubcommand() !== 'refresh') return false;
  if (!i.memberPermissions?.has(P.ManageGuild)) { await i.reply({ content: 'Perintah ini membutuhkan izin Manage Server.', flags: EPHEMERAL }); return true; }
  await i.deferReply({ flags: EPHEMERAL });
  const stats = await updater.run(i.guild);
  await i.editReply(`Panel refresh selesai. Diperbarui: **${stats.updated}** · Tidak ditemukan: **${stats.missing}** · Gagal: **${stats.failed}**.`);
  return true;
}
module.exports = { name: 'panel', commands, setup, handle };
