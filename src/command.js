const { ChannelType, SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } = require('discord.js');

function category(option, autocomplete = false) {
  return option
    .setName('categoryname')
    .setDescription('Nama kategori game')
    .setRequired(true)
    .setMaxLength(100)
    .setAutocomplete(autocomplete);
}
const command = new SlashCommandBuilder()
  .setName('game')
  .setDescription('Kelola kategori dan changelog game')
  .setContexts(InteractionContextType.Guild)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Tambahkan kategori game')
      .addStringOption((o) => category(o))
      .addStringOption((o) =>
        o.setName('linkgame').setDescription('URL halaman game, misalnya Roblox').setMaxLength(1500),
      ),
  )
  .addSubcommand((s) => s.setName('list').setDescription('Lihat kategori server ini'))
  .addSubcommand((s) =>
    s
      .setName('delete')
      .setDescription('Hapus kategori')
      .addStringOption((o) => category(o, true)),
  )
  .addSubcommand((s) =>
    s
      .setName('changelog')
      .setDescription('Tulis changelog dalam thread privat')
      .addStringOption((o) => category(o, true))
      .addRoleOption((o) => o.setName('recipient').setDescription('Role penerima').setRequired(true))
      .addChannelOption((o) => o.setName('channel').setDescription('Tujuan publikasi (default: channel saat ini)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
  )
  .addSubcommand(s => s.setName('panel').setDescription('Terbitkan panel loadstring untuk kategori game')
    .addStringOption(o => category(o, true))
    .addStringOption(o => o.setName('loadstring').setDescription('Teks yang dapat disalin member')
      .setRequired(true).setMaxLength(2000))
    .addAttachmentOption(o => o.setName('image').setDescription('Gambar panel (opsional)'))
    .addStringOption(o => o.setName('namebutton').setDescription('Label tombol tujuan').setMaxLength(80))
    .addStringOption(o => o.setName('redirectbutton').setDescription('URL http(s) atau #channel server ini').setMaxLength(512))
  );
module.exports = command;
