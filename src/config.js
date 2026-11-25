const { REST, Routes } = require('discord.js');
async function authenticate(env = process.env) {
  const token = env.CHEESEBLACK_TOKEN;
  const id = env.CHEESEBLACK_APPLICATION_ID;
  if (!token || !/^\d{17,20}$/.test(id ?? ''))
    throw Error('Isi CHEESEBLACK_TOKEN dan CHEESEBLACK_APPLICATION_ID dari aplikasi CheeseBlack.');
  const rest = new REST({ version: '10' }).setToken(token);
  const app = await rest.get(Routes.currentApplication());
  if (app.id !== id) throw Error('Token dan Application ID CheeseBlack tidak cocok.');
  return { rest, id, token };
}
module.exports = { authenticate };
