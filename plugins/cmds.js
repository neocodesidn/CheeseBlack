'use strict';
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, SlashCommandBuilder, TextDisplayBuilder } = require('discord.js');
const { loadPlugins } = require('../lib/loader');
const { buildHelpPages } = require('../lib/command-groups');
const V2 = MessageFlags.IsComponentsV2;
const EPHEMERAL = MessageFlags.Ephemeral;
const text = (content) => new TextDisplayBuilder().setContent(content);
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const pages = () => buildHelpPages(loadPlugins().filter((plugin) => plugin.name !== 'owner'));
function payload(pageIndex, userId) {
  const allPages = pages();
  const index = Math.max(0, Math.min(pageIndex, allPages.length - 1));
  const container = new ContainerBuilder()
    .addTextDisplayComponents(text(`# COMMAND DIRECTORY\n-# Page ${index + 1} of ${allPages.length}\n\n${allPages[index]}`))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text('-# Opsi dalam tanda [ ] bersifat opsional.'))
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`help:page:${userId}:${index - 1}`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
      new ButtonBuilder().setCustomId(`help:page:${userId}:${index + 1}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(index === allPages.length - 1),
    ));
  return { components: [container], flags: V2 | EPHEMERAL };
}
const commands = [new SlashCommandBuilder().setName('help').setDescription('Panduan penggunaan bot')
  .addSubcommand((s) => s.setName('commands').setDescription('Daftar command dan opsi yang tersedia'))
  .setContexts(0).toJSON()];
async function handle(i) {
  if (i.isChatInputCommand() && i.commandName === 'help' && i.options.getSubcommand() === 'commands') { await i.reply(payload(0, i.user.id)); return true; }
  if (i.isButton()) {
    const match = /^help:page:(\d+):(\d+)$/.exec(i.customId);
    if (!match) return false;
    const [, ownerId, pageIndex] = match;
    if (i.user.id !== ownerId) { await i.reply({ content: 'Panel panduan ini bukan milikmu. Jalankan `/help commands` untuk membuka panduan sendiri.', flags: EPHEMERAL }); return true; }
    const updated = payload(Number(pageIndex), ownerId); delete updated.flags; await i.update(updated); return true;
  }
  return false;
}
module.exports = { name: 'cmds', commands, handle };
