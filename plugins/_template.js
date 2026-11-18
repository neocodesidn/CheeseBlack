// Template plugin baru. Salin file ini, ganti namanya (tanpa awalan "_"),
// lalu jalankan `npm run register` dan restart bot. Plugin otomatis dimuat.
//
// Bentuk plugin:
//   name      nama plugin (dipakai untuk DISABLED_PLUGINS di .env)
//   intents   (opsional) intent tambahan yang dibutuhkan plugin
//   commands  (opsional) daftar slash command (hasil .toJSON())
//   setup     (opsional) dipanggil sekali dengan client, untuk pasang event listener
//   handle    (opsional) dipanggil untuk setiap interaction; return true kalau sudah ditangani
const { MessageFlags, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Cek bot hidup').setContexts(0).toJSON(),
];

async function handle(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'ping') return false;
  await interaction.reply({ content: 'Pong!', flags: MessageFlags.Ephemeral });
  return true;
}

module.exports = { name: 'template', commands, handle };
