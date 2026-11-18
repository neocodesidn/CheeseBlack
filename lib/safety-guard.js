'use strict';
const { isOwner } = require('./owner-access');
const { BOT_NAME } = require('./brand');

function isSafetyExemptInteraction(interaction) {
  return Boolean(
    interaction?.isChatInputCommand?.() &&
    interaction.commandName === 'help' &&
    interaction.options?.getSubcommand?.(false) === 'commands'
  );
}

function getBlockReason(interaction, controls, ownerCheck = isOwner) {
  if (!interaction?.guildId || ownerCheck(interaction.user?.id) || isSafetyExemptInteraction(interaction)) return null;
  const global = controls.getGlobalMaintenance();
  if (global.enabled) return { type: 'global-maintenance', reason: global.reason || `${BOT_NAME} sedang menjalani pemeliharaan.` };
  const guild = controls.getGuildState(interaction.guildId);
  if (guild.paused) return { type: 'guild-paused', reason: guild.reason || `Fitur ${BOT_NAME} sementara dinonaktifkan pada server ini.` };
  return null;
}
module.exports = { getBlockReason, isSafetyExemptInteraction };
