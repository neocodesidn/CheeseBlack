const {
  ContainerBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  escapeMarkdown,
} = require('discord.js');
const { markers } = require('./publish');
const text = (value) => new TextDisplayBuilder().setContent(value);
const separator = () => new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small);
function parse(raw) {
  const fields = {};
  let current;
  for (const line of raw.replace(/\r\n?/g, '\n').split('\n')) {
    const header = /^(title|description|footer):[ \t]?(.*)$/i.exec(line);
    if (header) {
      current = header[1].toLowerCase();
      if (fields[current]) throw Error('Setiap label hanya boleh ditulis satu kali.');
      fields[current] = [header[2]];
    } else if (current) fields[current].push(line);
    else if (line.trim()) throw Error('Awali pesan dengan title:, description:, atau footer:.');
  }
  const field = (key) => (fields[key] || []).join('\n').replace(/^\n+|\n+$/g, '');
  const title = field('title').trim(),
    description = field('description'),
    footer = field('footer');
  if (!title || !description.trim()) throw Error('Isi title: dan description: dalam satu pesan.');
  if (title.includes('\n')) throw Error('Gunakan satu baris untuk judul.');
  return { title, description, footer: footer.trim() ? footer : '' };
}
function wib(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}.${parts.minute} WIB`;
}
function panel(d, body, icons, image, date, live = false) {
  const title = '# ' + icons.announcement + ' ' + body.title;
  const metadata = [
    icons.products + ' **Category:** ' + escapeMarkdown(d.name),
    icons.community + ' **Recipient:** <@&' + d.role + '>',
    icons.calendar + ' **Date:** ' + wib(date),
  ].join('\n');
  const previewCaption = live ? '' : 'Tujuan publikasi: <#' + d.target + '>';
  if ([title, metadata, body.description, body.footer, previewCaption].join('').length > 4000)
    throw Error('Panel melebihi 4000 karakter. Ringkas draft.');
  const [boxId, titleId, metaId] = markers(d.thread);
  const box = new ContainerBuilder().setId(boxId);
  const heading = text(title).setId(titleId),
    details = text(metadata).setId(metaId);
  if (image)
    box.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(heading, details)
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(image)),
    );
  else box.addTextDisplayComponents(heading, details);
  box.addSeparatorComponents(separator()).addTextDisplayComponents(text(body.description));
  if (body.footer) box.addSeparatorComponents(separator()).addTextDisplayComponents(text(body.footer));
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [box],
    allowedMentions: { parse: [], roles: live ? [d.role] : [] },
  };
}
module.exports = { parse, panel, wib };
