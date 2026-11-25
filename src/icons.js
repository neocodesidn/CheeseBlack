const {
  REST,
  Routes,
  SlashCommandBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits: P,
} = require('discord.js');
const { readdir, readFile } = require('node:fs/promises');
const path = require('node:path');

const folder = path.join(__dirname, '..', 'assets');
const command = new SlashCommandBuilder()
  .setName('icons')
  .setDescription('Pasang emoji Cheese di server')
  .setContexts(InteractionContextType.Guild)
  .setDefaultMemberPermissions(P.Administrator)
  .addSubcommand((s) =>
    s
      .setName('install')
      .setDescription('Pasang semua ikon atau satu ikon pilihan')
      .addStringOption((o) =>
        o.setName('ikon').setDescription('Kosongkan untuk semua ikon').setAutocomplete(true),
      ),
  );

async function catalog() {
  return (await readdir(folder))
    .filter((f) => /^[a-z0-9_-]+\.png$/.test(f))
    .sort()
    .map((f) => ({
      file: f,
      key: path.basename(f, '.png'),
      name: 'cheese_' + path.basename(f, '.png').replace(/-/g, '_'),
    }));
}

async function upload(rest, guild, icons, progress, deadline) {
  const route = Routes.guildEmojis(guild);
  const known = new Set((await rest.get(route)).map((e) => e.name?.toLowerCase()));
  let added = 0,
    skipped = 0;
  for (const icon of icons) {
    if (known.has(icon.name)) {
      skipped++;
      continue;
    }
    if (Date.now() >= deadline)
      throw Error('Waktu sesi hampir habis. Jalankan /icons install lagi untuk melanjutkan.');
    await progress(added + skipped + '/' + icons.length + ' · Mengunggah ' + icon.name);
    const png = await readFile(path.join(folder, icon.file));
    await rest.post(route, {
      body: { name: icon.name, image: 'data:image/png;base64,' + png.toString('base64') },
      reason: 'Install ikon CheeseBlack',
    });
    known.add(icon.name);
    added++;
  }
  return { added, skipped };
}

function install(client, token) {
  const running = new Set();
  client.on('interactionCreate', async (i) => {
    if (i.commandName !== 'icons' || !i.inGuild()) return;
    const guild = i.guildId;
    let locked = false;
    try {
      const admin = i.memberPermissions?.has(P.Administrator);
      if (i.isAutocomplete()) {
        const focus = i.options.getFocused().toLowerCase();
        return await i.respond(
          admin
            ? (await catalog())
                .filter((x) => x.key.includes(focus))
                .slice(0, 25)
                .map((x) => ({ name: x.key, value: x.key }))
            : [],
        );
      }
      if (!i.isChatInputCommand()) return;
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      if (!admin) throw Error('Khusus administrator server.');
      if (running.has(guild)) throw Error('Pemasangan ikon sedang berjalan di server ini.');
      running.add(guild);
      locked = true;
      const icons = await catalog();
      const selected = i.options.getString('ikon');
      const targets = selected ? icons.filter((icon) => icon.key === selected) : icons;
      if (!targets.length) throw Error('Ikon tidak ditemukan di assets.');
      const deadline = i.createdTimestamp + 12 * 60_000;
      let lastEdit = 0,
        stage = 'Membaca daftar emoji server';
      async function report(content, force = false) {
        if (force || Date.now() - lastEdit >= 2500) {
          await i.editReply(content);
          lastEdit = Date.now();
        }
      }
      const rest = new REST({
        version: '10',
        retries: 0,
        timeout: 30_000,
        hashSweepInterval: 0,
        handlerSweepInterval: 0,
        rejectOnRateLimit: async (data) => {
          const until = Date.now() + data.retryAfter;
          if (until >= deadline) return true;
          await report(
            stage + ' · Discord meminta jeda sampai <t:' + Math.ceil(until / 1000) + ':T>.',
            true,
          );
          return false;
        },
      }).setToken(token);
      await report(stage, true);
      lastEdit = 0;
      const result = await upload(
        rest,
        guild,
        targets,
        async (msg) => {
          stage = msg;
          await report(msg);
        },
        deadline,
      );
      await i.editReply(
        'Selesai · ' +
          targets.length +
          '/' +
          targets.length +
          ' · ' +
          result.added +
          ' baru, ' +
          result.skipped +
          ' sudah ada.',
      );
    } catch (e) {
      let msg = e.message;
      if (e.code === 30008) msg = 'Slot emoji penuh. Setelah tersedia slot, ulangi /icons install.';
      if (e.code === 50013) msg = 'Beri bot izin Create Expressions di server ini lalu coba lagi.';
      if (e.name === 'RateLimitError')
        msg =
          'Discord meminta jeda panjang. Jalankan /icons install lagi <t:' +
          Math.ceil((Date.now() + e.retryAfter) / 1000) +
          ':R>.';
      if (i.deferred) await i.editReply(msg.slice(0, 1800)).catch(() => {});
      else console.error('Install ikon:', msg);
    } finally {
      if (locked) running.delete(guild);
    }
  });
}
module.exports = { command, install, catalog, upload };
