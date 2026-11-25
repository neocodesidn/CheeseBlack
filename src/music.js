const {
  SlashCommandBuilder,
  InteractionContextType,
  ChannelType,
  PermissionFlagsBits: P,
  MessageFlags: F,
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  escapeMarkdown,
} = require('discord.js');

const { wib } = require('./content');

const nameOption = (o) =>
  o.setName('namemusic').setDescription('Nama lagu').setRequired(true).setMaxLength(80);
const command = new SlashCommandBuilder()
  .setName('music')
  .setDescription('Daftar ID musik Roblox')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Tambahkan lagu')
      .addStringOption((o) =>
        o.setName('id').setDescription('ID audio Roblox').setRequired(true).setMaxLength(20),
      )
      .addStringOption(nameOption),
  )
  .addSubcommand((s) => s.setName('bulk').setDescription('Tambahkan banyak lagu sekaligus'))
  .addSubcommand((s) =>
    s
      .setName('delete')
      .setDescription('Hapus lagu')
      .addStringOption((o) => nameOption(o).setAutocomplete(true)),
  )
  .addSubcommand((s) => s.setName('list').setDescription('Lihat daftar lagu dan pilih ID'))
  .addSubcommand((s) => s.setName('panel').setDescription('Pasang panel musik di channel ini'));

const row = (...items) => new ActionRowBuilder().addComponents(...items);
const button = (id, label) =>
  new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(ButtonStyle.Secondary);
const quiet = { parse: [] };
const pageSize = 20;

function parseRow(id, name) {
  id = id.trim();
  name = name.trim();
  if (!/^[1-9]\d{0,19}$/.test(id)) throw Error('ID harus berupa angka positif, maksimal 20 digit.');
  if (!name || name.length > 80 || /[\r\n]/.test(name))
    throw Error('Nama lagu wajib diisi dalam satu baris, maksimal 80 karakter.');
  return { id, name, key: name.toLowerCase() };
}
function parseBulk(text) {
  const songs = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const split = line.indexOf('|');
    try {
      if (split < 0) throw Error('Pakai format ID | nama lagu.');
      songs.push(parseRow(line.slice(0, split), line.slice(split + 1)));
    } catch (err) {
      throw Error('Baris ' + (index + 1) + ': ' + err.message);
    }
  }
  if (!songs.length) throw Error('Isi minimal satu lagu.');
  return songs;
}
function render(songs, requested = 0, iconURL = null, meta = {}) {
  const pages = Math.max(1, Math.ceil(songs.length / pageSize));
  const page = Math.min(Math.max(requested, 0), pages - 1);
  const subset = songs.slice(page * pageSize, (page + 1) * pageSize);
  const box = new ContainerBuilder();
  const divider = () => new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true);
  const heading = new TextDisplayBuilder().setContent('## Musik Roblox');
  const summary = new TextDisplayBuilder().setContent(
    songs.length + ' lagu' + (pages > 1 ? ' · Halaman ' + (page + 1) + ' / ' + pages : ''),
  );
  if (iconURL) {
    box.addSectionComponents(new SectionBuilder().addTextDisplayComponents(heading, summary)
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(iconURL).setDescription('Ikon server')));
  } else {
    box.addTextDisplayComponents(heading, summary);
  }
  box.addSeparatorComponents(divider());
  const names = subset.map((s, i) => page * pageSize + i + 1 + '. ' + escapeMarkdown(s.name));
  box.addTextDisplayComponents(new TextDisplayBuilder().setContent(names.join('\n') || 'Belum ada lagu.'));
  if (subset.length) {
    box.addActionRowComponents(
      row(
        new StringSelectMenuBuilder()
          .setCustomId('music:pick')
          .setPlaceholder('Pilih satu atau beberapa lagu')
          .setMinValues(1)
          .setMaxValues(subset.length)
          .addOptions(subset.map((s) => ({ label: s.name, value: s.id }))),
      ),
    );
  }
  if (pages > 1) {
    box.addActionRowComponents(
      row(
        button('music:page:' + Math.max(0, page - 1), 'Sebelumnya').setDisabled(page === 0),
        button('music:page:' + (page + 1), 'Berikutnya').setDisabled(page === pages - 1),
      ),
    );
  }
  const uploader = meta.uploader ? '<@' + meta.uploader + '>' : 'Belum tercatat';
  const updated = meta.updated ? wib(new Date(meta.updated)) : 'Belum tercatat';
  box.addSeparatorComponents(divider()).addTextDisplayComponents(new TextDisplayBuilder().setContent(
    '-# Unggahan terakhir oleh ' + uploader + '\n-# Terakhir diperbarui · ' + updated,
  ));
  return { components: [box], flags: F.IsComponentsV2, allowedMentions: quiet };
}

function install(client, db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS music_tracks(guild TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,
      key TEXT NOT NULL, PRIMARY KEY(guild,id), UNIQUE(guild,key));
    CREATE TABLE IF NOT EXISTS music_catalog_info(guild TEXT PRIMARY KEY, uploader TEXT, updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS music_panels(guild TEXT PRIMARY KEY,channel TEXT NOT NULL,message TEXT NOT NULL);
  `);
  const list = (g) => db.prepare('SELECT id,name FROM music_tracks WHERE guild=? ORDER BY key').all(g);
  const panel = (g) => db.prepare('SELECT * FROM music_panels WHERE guild=?').get(g);
  function view(g, guild, page = 0) {
    const info = db.prepare('SELECT uploader,updated FROM music_catalog_info WHERE guild=?').get(g);
    return render(list(g), page, guild?.iconURL({ size: 128 }), info);
  }
  const queues = new Map();
  function queued(g, task) {
    const next = (queues.get(g) || Promise.resolve()).catch(() => {}).then(task);
    queues.set(g, next);
    return next.finally(() => {
      if (queues.get(g) === next) queues.delete(g);
    });
  }
  function insert(g, songs) {
    const existing = db.prepare('SELECT id FROM music_tracks WHERE guild=? AND (id=? OR key=?)');
    const add = db.prepare('INSERT INTO music_tracks VALUES(?,?,?,?)');
    for (const [index, s] of songs.entries()) {
      if (existing.get(g, s.id, s.key))
        throw Error('Entri ' + (index + 1) + ': ID atau nama sudah ada (' + s.name + ').');
      add.run(g, s.id, s.name, s.key);
    }
  }
  async function refresh(g) {
    const p = panel(g);
    if (!p) return;
    try {
      const ch = await client.channels.fetch(p.channel);
      await ch.messages.edit(p.message, view(g, ch.guild));
    } catch (e) {
      if ([10003, 10008].includes(e.code)) {
        db.prepare('DELETE FROM music_panels WHERE guild=? AND message=?').run(g, p.message);
        return;
      }
      throw e;
    }
  }
  client.once('clientReady', async () => {
    for (const p of db.prepare('SELECT guild FROM music_panels').all()) {
      await queued(p.guild, () => refresh(p.guild)).catch((e) => console.error('Panel musik:', e.message));
    }
  });
  client.on('interactionCreate', async (i) => {
    const g = i.guildId;
    const slash = i.isChatInputCommand() && i.commandName === 'music';
    const auto = i.isAutocomplete() && i.commandName === 'music';
    const action = i.customId || '';
    if (!g || !(slash || auto || action.startsWith('music:'))) return;
    const admin = i.memberPermissions?.has(P.Administrator);
    const reply = (content) => i.reply({ content, flags: F.Ephemeral, allowedMentions: quiet });
    try {
      if (auto) {
        const q = i.options.getFocused().trim().toLowerCase();
        return await i.respond(
          admin
            ? list(g)
                .filter((s) => s.name.toLowerCase().includes(q))
                .slice(0, 25)
                .map((s) => ({ name: s.name, value: s.name }))
            : [],
        );
      }
      const sub = slash ? i.options.getSubcommand() : '';
      if (sub === 'list' || action.startsWith('music:page:')) {
        const payload = view(g, i.guild, Number(action.split(':')[2] || 0));
        if (!slash && i.message.flags.has(F.Ephemeral)) return await i.update(payload);
        return await i.reply({ ...payload, flags: F.Ephemeral | F.IsComponentsV2 });
      }
      if (i.isStringSelectMenu() && action === 'music:pick') {
        const ids = new Set(i.values);
        const selected = list(g).filter((s) => ids.has(s.id));
        if (selected.length !== ids.size)
          return await reply('Daftar berubah. Buka /music list lalu pilih lagi.');
        const content = selected.map((s) => s.id).join('\n');
        return await i.reply({
          content: 'Tekan Copy ID, lalu tahan pesan dan pilih Salin Teks.\n' + content,
          flags: F.Ephemeral,
          allowedMentions: quiet,
          components: [row(button('music:copy', 'Copy ID'))],
        });
      }
      if (i.isButton() && action === 'music:copy') {
        // Retain only the IDs so Discord's native Copy Text gives a clean list.
        return await i.update({
          content: i.message.content.split('\n').slice(1).join('\n'),
          components: [],
          allowedMentions: quiet,
        });
      }
      if (!admin) return await reply('Pengelolaan musik khusus administrator.');
      if (sub === 'bulk') {
        const field = new TextInputBuilder()
          .setCustomId('songs')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('123 | Test\n456 | Lagu kedua')
          .setRequired(true)
          .setMaxLength(4000);
        return await i.showModal(
          new ModalBuilder()
            .setCustomId('music:bulk')
            .setTitle('Tambah banyak lagu')
            .addLabelComponents(
              new LabelBuilder()
                .setLabel('Satu lagu per baris: ID | nama lagu')
                .setTextInputComponent(field),
            ),
        );
      }
      await i.deferReply({ flags: F.Ephemeral });
      await queued(g, async () => {
        if (sub === 'panel') {
          await refresh(g);
          let p = panel(g);
          if (!p) {
            if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(i.channel?.type))
              throw Error('Pasang panel di channel teks atau pengumuman.');
            const msg = await i.channel.send(view(g, i.guild));
            db.prepare('INSERT INTO music_panels VALUES(?,?,?)').run(g, i.channelId, msg.id);
            p = panel(g);
          }
          return i.editReply(
            'Panel musik: https://discord.com/channels/' + g + '/' + p.channel + '/' + p.message,
          );
        }
        let result;
        db.exec('BEGIN IMMEDIATE');
        try {
          if (sub === 'delete') {
            const key = i.options.getString('namemusic', true).trim().toLowerCase();
            if (!db.prepare('DELETE FROM music_tracks WHERE guild=? AND key=?').run(g, key).changes)
              throw Error('Lagu sudah dihapus atau belum terdaftar.');
            result = 'Lagu dihapus.';
          } else {
            const songs =
              sub === 'add'
                ? [parseRow(i.options.getString('id', true), i.options.getString('namemusic', true))]
                : parseBulk(i.fields.getTextInputValue('songs'));
            insert(g, songs);
            result = songs.length + ' lagu ditambahkan.';
          }
          db.prepare(`
            INSERT INTO music_catalog_info(guild,uploader,updated) VALUES(?,?,?)
            ON CONFLICT(guild) DO UPDATE SET
              uploader=COALESCE(excluded.uploader,music_catalog_info.uploader), updated=excluded.updated
          `).run(g, sub === 'delete' ? null : i.user.id, Date.now());
          db.exec('COMMIT');
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
        try {
          await refresh(g);
        } catch (e) {
          console.error('Panel musik:', e.message);
          result += ' Panel belum diperbarui. Periksa izin bot lalu jalankan /music panel.';
        }
        await i.editReply(result);
      });
    } catch (e) {
      if (auto) {
        console.error('Autocomplete musik:', e.message);
        return;
      }
      const content = e.message.slice(0, 1500);
      if (i.deferred) await i.editReply({ content, allowedMentions: quiet }).catch(() => {});
      else if (!i.replied) await reply(content).catch(() => {});
    }
  });
}
module.exports = { command, install, parseBulk, render };
