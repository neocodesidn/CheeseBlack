require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { loadPlugins } = require('./lib/loader');
const { buildRegisteredCommands } = require('./lib/command-groups');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('DISCORD_TOKEN dan CLIENT_ID wajib diisi di file .env');
  process.exit(1);
}

const plugins = loadPlugins();
const commands = buildRegisteredCommands(plugins);

const seen = new Set();
for (const command of commands) {
  if (seen.has(command.name)) {
    console.error(`Nama command dobel: /${command.name}. Periksa kategori command.`);
    process.exit(1);
  }
  seen.add(command.name);
}

const rest = new REST().setToken(DISCORD_TOKEN);

(async () => {
  try {
    const names = commands.map((command) => command.name).join(', ');

    if (GUILD_ID) {
      const ids = GUILD_ID.split(',').map((value) => value.trim()).filter(Boolean);
      for (const id of ids) {
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, id), { body: commands });
        console.log(`Terdaftar di server ${id} (${commands.length} command utama): ${names}`);
      }
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
      console.log('Command global dikosongkan (menghindari command lama muncul dobel).');
    } else {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log(`Terdaftar secara global (${commands.length} command utama): ${names}`);
    }
  } catch (err) {
    console.error('Gagal mendaftarkan command:', err.message);
    process.exit(1);
  }
})();
