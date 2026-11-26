const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, escapeMarkdown,
  MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, SectionBuilder,
  SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, ThumbnailBuilder,
} = require('discord.js');
const { wib } = require('./content');

function initialize(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS game_copy_panels(
    id TEXT PRIMARY KEY, guild TEXT NOT NULL, channel TEXT NOT NULL, source TEXT NOT NULL
  )`);
}

async function destination(guild, raw) {
  if (!raw) return null;
  const value = raw.trim();
  const mention = /^<#(\d{17,20})>$/.exec(value);
  if (mention || value.startsWith('#')) {
    let channel;
    if (mention) channel = await guild.channels.fetch(mention[1]);
    else {
      const channels = await guild.channels.fetch();
      const matches = channels.filter(c => c && c.name === value.slice(1));
      if (matches.size > 1) throw Error('Nama channel ganda. Pilih mention channel atau tempel link channel.');
      channel = matches.first();
    }
    if (!channel || channel.guildId !== guild.id) throw Error('Channel tujuan tidak ditemukan di server ini.');
    return 'https://discord.com/channels/' + guild.id + '/' + channel.id;
  }
  let url;
  try { url = new URL(value); } catch {}
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 512)
    throw Error('Gunakan URL HTTP(S) lengkap atau mention #channel.');
  return url.href;
}

async function publish(i, db, category) {
  const source = i.options.getString('loadstring', true);
  if (!source.trim() || source.length > 2000) throw Error('Isi loadstring antara 1 dan 2000 karakter.');
  const label = i.options.getString('namebutton')?.trim();
  const target = await destination(i.guild, i.options.getString('redirectbutton'));
  if (label && !target) throw Error('Isi redirectbutton sebagai tujuan tombol.');
  const image = i.options.getAttachment('image');
  const extensions = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'};
  if (image && !Object.hasOwn(extensions,image.contentType)) throw Error('Unggah gambar PNG, JPG, WebP atau GIF.');
  const box = new ContainerBuilder();
  const text = value => new TextDisplayBuilder().setContent(value);
  const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
  const files = [];

  if (image) {
    const name = 'game-panel.' + extensions[image.contentType];
    files.push({ attachment: image.url, name });
    box.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL('attachment://' + name).setDescription('Gambar ' + category.name),
    ));
  }

  const heading = [
    text('-# Loadstring Roblox'),
    text('# ' + escapeMarkdown(category.name)),
  ];
  const icon = i.guild.iconURL({ size: 128 });
  if (icon) {
    box.addSectionComponents(new SectionBuilder().addTextDisplayComponents(...heading)
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(icon).setDescription('Ikon server')));
  } else {
    box.addTextDisplayComponents(...heading);
  }

  const buttons = new ActionRowBuilder().addComponents(new ButtonBuilder()
    .setCustomId('game:copy:' + i.id).setLabel('Copy Loadstring').setStyle(ButtonStyle.Secondary));
  if (target) {
    buttons.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link)
      .setLabel(label || 'Buka tujuan').setURL(target));
  }
  box.addSeparatorComponents(divider())
    .addTextDisplayComponents(text('Untuk menyalin, tahan pesan privat yang muncul lalu pilih **Salin Teks**.'))
    .addActionRowComponents(buttons)
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text(
      '-# Diunggah oleh <@' + i.user.id + '>\n-# ' + wib(new Date(i.createdTimestamp)),
    ));
  box.toJSON();
  // Save first so buttons work immediately, including after an ambiguous send response.
  db.prepare('INSERT INTO game_copy_panels VALUES(?,?,?,?)').run(i.id,i.guildId,i.channelId,source);
  let message;
  try {
    message = await i.channel.send({components:[box], files, flags:MessageFlags.IsComponentsV2,
      allowedMentions:{parse:[]},nonce:i.id,enforceNonce:true});
  } catch(e) {
    if (e.status >= 400 && e.status < 500 && e.status !== 408)
      db.prepare('DELETE FROM game_copy_panels WHERE id=?').run(i.id);
    throw e;
  }
  return i.editReply('Panel terbit di '+message.url);
}

async function copy(i,db) {
  const id = i.customId.slice('game:copy:'.length);
  const panel = db.prepare('SELECT source FROM game_copy_panels WHERE id=? AND guild=? AND channel=?')
    .get(id,i.guildId,i.channelId);
  if (!panel) throw Error('Loadstring panel ini tidak tersedia.');
  return i.editReply({content:panel.source,allowedMentions:{parse:[]},flags:MessageFlags.SuppressEmbeds});
}
module.exports = {initialize,publish,copy,destination};
