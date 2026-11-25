const { Routes } = require('discord.js');
const { authenticate } = require('./config');
const commands = [require('./command'), require('./music').command, require('./icons').command];

async function register(rest, id, legacy = '') {
  const guilds = new Set(
    legacy
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  if ([...guilds].some((s) => !/^\d{17,20}$/.test(s))) throw Error('Periksa daftar ID guild lama.');
  let after = '0';
  for (;;) {
    const page = await rest.get(Routes.userGuilds(), {
      query: new URLSearchParams({ limit: '200', after }),
    });
    for (const guild of page) guilds.add(guild.id);
    if (page.length < 200) break;
    after = page.reduce((max, g) => (BigInt(g.id) > BigInt(max) ? g.id : max), after);
  }
  await rest.put(Routes.applicationCommands(id), { body: commands.map((command) => command.toJSON()) });
  for (const guild of guilds) {
    const route = Routes.applicationGuildCommands(id, guild);
    if ((await rest.get(route)).length) await rest.put(route, { body: [] });
  }
}
if (require.main === module)
  authenticate()
    .then(({ rest, id }) =>
      register(rest, id, [process.env.LEGACY_GUILD_IDS, process.env.GUILD_ID].filter(Boolean).join(',')),
    )
    .then(() => console.log('/game, /music dan /icons terdaftar, scope guild lama sudah diperiksa.'))
    .catch((e) => {
      console.error('Registrasi gagal:', e.message);
      process.exitCode = 1;
    });
module.exports = { register };
