const {
  Client,
  Events,
  GatewayIntentBits,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits: P,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  TextDisplayBuilder,
} = require('discord.js');
const { randomBytes } = require('node:crypto');
const { authenticate } = require('./config');
const { Store } = require('./store');
const { parse, panel } = require('./content');
const { iconsFor, thumbnail } = require('./media');
const { publish } = require('./publish');

const silent = { parse: [] };
const labels = { preview: 'Preview', edit: 'Edit Draft', publish: 'Publish', cancel: 'Cancel' };
function controls(actions, rev = '') {
  return new ActionRowBuilder().addComponents(
    actions.map((action) =>
      new ButtonBuilder()
        .setCustomId(['game', action, rev].join(':'))
        .setLabel(labels[action])
        .setStyle(ButtonStyle.Secondary),
    ),
  );
}
const example =
  'title: New Update Released!\n\ndescription:\n**Changes**\n• Menambahkan area memancing baru.\n\nfooter:\n**Diskusi:** ';
async function destination(guild, id) {
  const target = await guild.channels.fetch(id);
  if (!target || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(target.type))
    throw Error('Pilih channel teks atau pengumuman di server ini.');
  if (!target.permissionsFor(guild.members.me)?.has([P.ViewChannel, P.SendMessages, P.ReadMessageHistory]))
    throw Error('CheeseBlack perlu View Channel, Send Messages dan Read Message History di <#' + id + '>.');
  return target;
}
async function openDraft(i, db, category) {
  const channel = i.channel;
  if (channel.type !== ChannelType.GuildText)
    throw Error('Jalankan /game changelog di channel teks biasa agar bot bisa membuka thread privat.');
  const required = [
    P.ViewChannel,
    P.SendMessages,
    P.CreatePrivateThreads,
    P.SendMessagesInThreads,
    P.ReadMessageHistory,
    P.ManageThreads,
  ];
  if (!channel.permissionsFor(i.guild.members.me)?.has(required))
    throw Error('Periksa izin channel dan thread CheeseBlack sesuai README.');
  const target = await destination(i.guild, i.options.getChannel('channel')?.id ?? channel.id);
  const role = i.options.getRole('recipient', true);
  if (role.id === i.guildId) throw Error('Pilih role penerima khusus selain @everyone.');
  const thread = await channel.threads.create({
    name: 'draft-' + category.name.slice(0, 65) + '-' + i.user.username.slice(0, 24),
    type: ChannelType.PrivateThread,
    invitable: false,
    autoArchiveDuration: 60,
  });
  try {
    await thread.members.add(i.user.id);
    db.create(thread.id, i.guildId, i.user.id, target.id, category, role.id);
    await thread.send({
      content:
        '**Draft changelog** · Tujuan <#' +
        target.id +
        '>\nSalin contoh ini ke satu pesan. Pilih emoji, role, dan channel langsung di composer. Isi footer jika perlu.\n\n```\n' +
        example +
        '\n```\nSetelah mengirim pesan, tekan **Preview**.',
      components: [controls(['preview', 'cancel'])],
      allowedMentions: silent,
    });
  } catch (e) {
    db.state(thread.id, 'edit', 'cancelled');
    await thread.delete().catch(() => {});
    throw e;
  }
  return i.editReply('Buka draft privat di <#' + thread.id + '>.');
}
async function slash(i, db) {
  const sub = i.options.getSubcommand();
  const name = i.options.getString('categoryname');
  if (sub === 'add') {
    const link = i.options.getString('linkgame') || '';
    if (link && !URL.canParse(link)) throw Error('Masukkan URL game lengkap.');
    if (link && !['https:', 'http:'].includes(new URL(link).protocol))
      throw Error('Gunakan link HTTP atau HTTPS.');
    db.add(i.guildId, name, link);
    return i.editReply('Kategori ditambahkan.');
  }
  if (sub === 'list') {
    const lines = db.list(i.guildId).map((c) => '• ' + c.name);
    if (!lines.length) return i.editReply('Belum ada kategori. Gunakan /game add untuk membuatnya.');
    let page = '',
      first = true;
    async function sendPage() {
      if (first) await i.editReply({ content: page, allowedMentions: silent });
      else await i.followUp({ content: page, flags: MessageFlags.Ephemeral, allowedMentions: silent });
      first = false;
    }
    for (const line of lines) {
      if (page.length + line.length + 1 > 1950) {
        await sendPage();
        page = '';
      }
      page += (page ? '\n' : '') + line;
    }
    return sendPage();
  }
  const category = db.get(i.guildId, name);
  if (!category) throw Error('Kategori sudah tidak tersedia. Pilih kembali dari autocomplete.');
  if (sub === 'delete') {
    db.remove(i.guildId, category.key);
    return i.editReply('Kategori dihapus.');
  }
  return openDraft(i, db, category);
}
async function latest(thread, owner) {
  let before;
  for (;;) {
    const page = await thread.messages.fetch({ limit: 100, before });
    const message = page.find((m) => m.author.id === owner && !m.system);
    if (message) return parse(message.content);
    if (page.size < 100) throw Error('Kirim satu pesan berisi title: dan description: terlebih dahulu.');
    before = page.last().id;
  }
}
async function render(i, d, body, live) {
  const [icons, image] = await Promise.all([
    iconsFor(i.client.application),
    thumbnail(d.link, i.guild.iconURL({ size: 128 })),
  ]);
  return panel(d, body, icons, image, new Date(), live);
}
async function button(i, db, d, action, rev) {
  if (d.state === 'done')
    return i.editReply(
      'Sudah terbit di https://discord.com/channels/' + d.guild + '/' + d.target + '/' + d.published,
    );
  if (d.state === 'cancelled') throw Error('Draft ini sudah dibatalkan.');
  if (d.state === 'sending' && action !== 'publish')
    throw Error('Publikasi sedang menunggu konfirmasi. Gunakan Publish pada preview terakhir.');
  if (action === 'cancel') {
    db.state(d.thread, d.state, 'cancelled');
    await i.editReply('Draft dibatalkan.');
    await i.channel.setArchived(true).catch(() => {});
    return;
  }
  if (action === 'preview') {
    const body = await latest(i.channel, d.owner);
    body.revision = randomBytes(8).toString('hex');
    const payload = await render(i, d, body, false);
    // Keep the destination outside the changelog panel.
    await i.channel.send({
      ...payload,
      components: [
        ...payload.components,
        new TextDisplayBuilder().setContent('Tujuan publikasi: <#' + d.target + '>'),
        controls(['edit', 'publish', 'cancel'], body.revision),
      ],
    });
    if (d.state === 'preview') db.state(d.thread, 'preview', 'edit');
    db.preview(d.thread, body);
    return i.editReply('Preview siap. Publish akan mengirim ke <#' + d.target + '>.');
  }
  const body = JSON.parse(d.preview || 'null');
  if (!body || rev !== body.revision || !['sending', 'preview'].includes(d.state))
    throw Error('Preview sudah berubah. Gunakan tombol pada preview terbaru.');
  if (action === 'edit') {
    db.state(d.thread, 'preview', 'edit');
    return i.editReply({
      content:
        'Edit pesan draft asli atau kirim satu pesan pengganti di thread ini, lalu tekan Preview. Tujuan <#' +
        d.target +
        '>.',
      components: [controls(['preview', 'cancel'])],
    });
  }
  if (action !== 'publish') throw Error('Tombol tidak dikenal.');
  const channel = await destination(i.guild, d.target);
  if (!(await i.guild.roles.fetch(d.role, { force: true })))
    throw Error('Role penerima sudah dihapus. Buat draft dengan role yang tersedia.');
  const payload = await render(i, d, body, true);
  payload.components.forEach((c) => c.toJSON());
  const id = await publish(db, d, channel, payload);
  await i.editReply('Terbit di https://discord.com/channels/' + d.guild + '/' + d.target + '/' + id);
  await i.channel.setArchived(true).catch(() => {});
}
async function main() {
  const { token } = await authenticate();
  const db = new Store(process.env.DATA_FILE || './data/game.sqlite');
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    allowedMentions: silent,
    rest: { retries: 0 },
  });
  const busy = new Set();
  client.on(Events.InteractionCreate, async (i) => {
    let lock;
    try {
      const admin = i.inGuild() && i.memberPermissions?.has(P.Administrator);
      if (i.isAutocomplete() && i.commandName === 'game') {
        const query = i.options.getFocused().trim().toLowerCase();
        return await i.respond(
          admin
            ? db
                .list(i.guildId)
                .filter((c) => c.key.includes(query))
                .slice(0, 25)
                .map((c) => ({ name: c.name, value: c.name }))
            : [],
        );
      }
      const isButton = i.isButton() && i.customId.startsWith('game:');
      if (!isButton && !(i.isChatInputCommand() && i.commandName === 'game')) return;
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      if (!admin) throw Error('Khusus administrator server.');
      if (!isButton) return await slash(i, db);
      const d = db.draft(i.channelId);
      if (!d || d.owner !== i.user.id || d.guild !== i.guildId)
        throw Error('Tombol ini hanya untuk pembuat draft.');
      if (busy.has(d.thread)) throw Error('Draft sedang diproses. Tunggu sebentar.');
      lock = d.thread;
      busy.add(lock);
      const [, action, rev] = i.customId.split(':');
      await button(i, db, d, action, rev);
    } catch (e) {
      console.error(e.name, e.message);
      if (i.deferred)
        await i.editReply({ content: e.message.slice(0, 1800), allowedMentions: silent }).catch(() => {});
    } finally {
      if (lock) busy.delete(lock);
    }
  });
  client.once(Events.ClientReady, (c) => console.log('CheeseBlack siap sebagai ' + c.user.tag));
  await client.login(token);
}
if (require.main === module)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
module.exports = { button, latest, controls, openDraft };
