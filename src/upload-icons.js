const { readdir, readFile } = require('node:fs/promises');
const path = require('node:path');
const { Routes } = require('discord.js');
const { authenticate } = require('./config');

async function uploadIcons(rest, guildId, log = console.log) {
  const route = Routes.guildEmojis(guildId);
  const existing = new Set((await rest.get(route)).map(emoji => emoji.name.toLowerCase()));
  const dir = path.join(__dirname, '..', 'assets');
  const files = (await readdir(dir)).filter(file => file.endsWith('.png')).sort();
  let uploaded = 0;
  for (const file of files) {
    const name = 'cheese_' + path.basename(file, '.png').replace(/-/g, '_');
    if (existing.has(name)) {
      log('Sudah ada: ' + name);
      continue;
    }
    const data = await readFile(path.join(dir, file));
    await rest.post(route, {
      body: { name, image: 'data:image/png;base64,' + data.toString('base64') },
      reason: 'Impor ikon Cheese untuk composer changelog',
    });
    existing.add(name);
    uploaded++;
    log('Diunggah: ' + name);
  }
  log('Selesai. Diunggah ' + uploaded + ', sudah ada ' + (files.length - uploaded) + '.');
}

async function main() {
  const id = process.argv[2];
  if (!/^\d{17,20}$/.test(id || '')) throw Error('Ganti ID_SERVER dengan ID numerik server Discord.');
  const { rest } = await authenticate();
  await uploadIcons(rest, id);
}

if (require.main === module) main().catch(error => {
  if (error.code === 30008) console.error('Slot emoji server penuh. Kosongkan slot lalu jalankan lagi.');
  else if (error.code === 50013) console.error('Beri bot izin Create Expressions di server tujuan lalu jalankan lagi.');
  else console.error('Upload terhenti:', error.message);
  process.exitCode = 1;
});
module.exports = { uploadIcons };
