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
const categoryOption = (o) => o.setName('category').setDescription('Kategori musik, misalnya Galau atau DJ')
  .setMaxLength(40).setAutocomplete(true);
function categoryName(value) {
  if (value == null) return 'Umum';
  const name = value.trim().replace(/ +/g, ' ');
  if (!name || name.length > 40 || /[\u0000-\u001f]/.test(name)) throw Error('Isi nama kategori dalam satu baris, maksimal 40 karakter.');
  return name.toLowerCase() === 'umum' ? 'Umum' : name;
}
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
      .addStringOption(nameOption).addStringOption(categoryOption),
  )
  .addSubcommand((s) => s.setName('bulk').setDescription('Tambahkan banyak lagu sekaligus').addStringOption(categoryOption))
  .addSubcommand(s => s.setName('move').setDescription('Pindahkan lagu ke kategori lain')
    .addStringOption(o=>nameOption(o).setAutocomplete(true))
    .addStringOption(o=>categoryOption(o).setRequired(true)))
  .addSubcommand((s) =>
    s
      .setName('delete')
      .setDescription('Hapus lagu')
      .addStringOption((o) => nameOption(o).setAutocomplete(true)),
  )
  .addSubcommand((s) => s.setName('list').setDescription('Lihat daftar lagu dan pilih ID').addStringOption(categoryOption))
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
function render(songs, requested = 0, iconURL = null, meta = {}, category = null) {
  const pages = Math.max(1, Math.ceil(songs.length / pageSize));
  const page = Math.min(Math.max(requested, 0), pages - 1);
  const subset = songs.slice(page * pageSize, (page + 1) * pageSize);
  const box = new ContainerBuilder();
  const divider = () => new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true);
  const heading = new TextDisplayBuilder().setContent('## Musik Roblox');
  const summary = new TextDisplayBuilder().setContent(
    (category ? escapeMarkdown(category) + ' · ' : '') + songs.length + ' lagu' + (pages > 1 ? ' · Halaman ' + (page + 1) + ' / ' + pages : ''),
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
  const navigation = row(button('music:categories:0', 'Pilih kategori'));
  if (pages > 1) {
    const suffix = category ? ':' + category : '';
    navigation.addComponents(
      button('music:page:' + Math.max(0, page - 1) + suffix, 'Sebelumnya').setDisabled(page === 0),
      button('music:page:' + (page + 1) + suffix, 'Berikutnya').setDisabled(page === pages - 1),
    );
  }
  box.addActionRowComponents(navigation);
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
  if (!db.prepare('PRAGMA table_info(music_tracks)').all().some(c => c.name === 'category')) {
    db.exec("ALTER TABLE music_tracks ADD COLUMN category TEXT NOT NULL DEFAULT 'Umum'");
  }
  const list = (g) => db.prepare('SELECT id,name,category FROM music_tracks WHERE guild=? ORDER BY key').all(g);
  const categories = g => db.prepare(
    'SELECT category, COUNT(*) AS total FROM music_tracks WHERE guild=? GROUP BY category ORDER BY category COLLATE NOCASE'
  ).all(g);
  function resolveCategory(g,value) {
    const name=categoryName(value);
    return categories(g).find(c=>c.category.toLowerCase()===name.toLowerCase())?.category ?? name;
  }
  function categoryMenu(g, requested) {
    const groups = categories(g);
    const pages = Math.max(1, Math.ceil(groups.length / 24));
    const page = Math.max(0,Math.min(requested,pages-1));
    const options = [{label:'Semua lagu',value:'all'}];
    for(const group of groups.slice(page*24,page*24+24)) {
      options.push({label:group.category,value:'c:'+group.category,description:group.total+' lagu'});
    }
    const box = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(
      '## Kategori musik'+(pages>1?'\n-# Halaman '+(page+1)+' / '+pages:'')
    )).addActionRowComponents(row(new StringSelectMenuBuilder().setCustomId('music:filter')
      .setPlaceholder('Pilih kategori musik').addOptions(options)));
    if(pages>1) box.addActionRowComponents(row(
      button('music:categories:'+Math.max(0,page-1),'Sebelumnya').setDisabled(page===0),
      button('music:categories:'+(page+1),'Berikutnya').setDisabled(page===pages-1)
    ));
    return {components:[box],flags:F.IsComponentsV2,allowedMentions:quiet};
  }
  const panel = (g) => db.prepare('SELECT * FROM music_panels WHERE guild=?').get(g);
  function view(g, guild, page = 0, category = null) {
    const info = db.prepare('SELECT uploader,updated FROM music_catalog_info WHERE guild=?').get(g);
    const songs = list(g);
    return render(category ? songs.filter(s=>s.category===category) : songs, page, guild?.iconURL({ size: 128 }), info, category);
  }
  const queues = new Map();
  function queued(g, task) {
    const next = (queues.get(g) || Promise.resolve()).catch(() => {}).then(task);
    queues.set(g, next);
    return next.finally(() => {
      if (queues.get(g) === next) queues.delete(g);
    });
  }
  function insert(g, songs, category) {
    const existing = db.prepare('SELECT id FROM music_tracks WHERE guild=? AND (id=? OR key=?)');
    const add = db.prepare('INSERT INTO music_tracks(guild,id,name,key,category) VALUES(?,?,?,?,?)');
    for (const [index, s] of songs.entries()) {
      if (existing.get(g, s.id, s.key))
        throw Error('Entri ' + (index + 1) + ': ID atau nama sudah ada (' + s.name + ').');
      add.run(g, s.id, s.name, s.key, category);
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
        const focused = i.options.getFocused(true);
        const q = focused.value.trim().toLowerCase();
        const isPublic = i.options.getSubcommand() === 'list';
        const names = !admin && !isPublic ? [] : focused.name === 'category'
          ? categories(g).map(c=>c.category) : list(g).map(s=>s.name);
        return await i.respond(names.filter(name=>name.toLowerCase().includes(q)).slice(0,25)
          .map(name=>({name,value:name})));
      }
      const sub = slash ? i.options.getSubcommand() : '';
      if (sub==='list' || action.startsWith('music:page:') || action.startsWith('music:categories:') || action==='music:filter') {
        const [,mode,number,...rest] = action.split(':');
        let category = rest.join(':') || null;
        if(sub==='list' && i.options.getString('category')) category=resolveCategory(g,i.options.getString('category'));
        if(mode==='filter') category=i.values[0]==='all'?null:i.values[0].slice(2);
        const payload = mode==='categories' ? categoryMenu(g,Number(number)) : view(g,i.guild,Number(number||0),category);
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
            .setCustomId('music:bulk:' + categoryName(i.options.getString('category')))
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
          } else if (sub === 'move') {
            const key=i.options.getString('namemusic',true).trim().toLowerCase();
            const category=resolveCategory(g,i.options.getString('category',true));
            const song=db.prepare('SELECT category FROM music_tracks WHERE guild=? AND key=?').get(g,key);
            if(!song) throw Error('Lagu tidak ditemukan.');
            if(song.category===category) throw Error('Lagu sudah berada di kategori ini.');
            db.prepare('UPDATE music_tracks SET category=? WHERE guild=? AND key=?').run(category,g,key);
            result='Lagu dipindahkan ke '+category+'.';
          } else {
            const songs =
              sub === 'add'
                ? [parseRow(i.options.getString('id', true), i.options.getString('namemusic', true))]
                : parseBulk(i.fields.getTextInputValue('songs'));
            const value = sub==='add' ? i.options.getString('category') : (action.slice('music:bulk:'.length) || null);
            insert(g,songs,resolveCategory(g,value));
            result = songs.length + ' lagu ditambahkan.';
          }
          db.prepare(`
            INSERT INTO music_catalog_info(guild,uploader,updated) VALUES(?,?,?)
            ON CONFLICT(guild) DO UPDATE SET
              uploader=COALESCE(excluded.uploader,music_catalog_info.uploader), updated=excluded.updated
          `).run(g, sub === 'delete' || sub === 'move' ? null : i.user.id, Date.now());
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
