const { atomicWriteJson } = require('../lib/json-storage');
const crypto = require('crypto');
const { editTrackedPanel } = require('../lib/panel-updater');
const { sendLog } = require('../lib/logger');
const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits: P,
  SlashCommandBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} = require('discord.js');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'roles.json');
const V2 = MessageFlags.IsComponentsV2;
const EPHEMERAL = MessageFlags.Ephemeral;
const MAX_ROLES = 22;
const PRIVILEGED_ROLE_PERMISSIONS = [
  P.Administrator,
  P.ManageGuild,
  P.ManageRoles,
  P.ManageChannels,
  P.ManageWebhooks,
  P.ManageMessages,
  P.KickMembers,
  P.BanMembers,
  P.ModerateMembers,
  P.ManageNicknames,
  P.ViewAuditLog,
  P.ManageEvents,
  P.ManageGuildExpressions,
  P.CreateGuildExpressions,
  P.CreateEvents,
  P.MuteMembers,
  P.DeafenMembers,
  P.MoveMembers,
  P.ManageThreads,
  P.MentionEveryone,
].filter((permission) => typeof permission === 'bigint');

function load() {
  try {
    const value = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { panels: value.panels && typeof value.panels === 'object' ? value.panels : {} };
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error('Gagal membaca data yang sudah ada: ' + err.message);
    return { panels: {} };
  }
}

const data = load();
function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  atomicWriteJson(FILE, data);
}

const text = (content) => new TextDisplayBuilder().setContent(content);
const divider = () =>
  new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const button = (panelId, role) =>
  new ButtonBuilder()
    .setCustomId(`roles:toggle:${panelId}:${role.id}`)
    .setLabel(role.name.slice(0, 80))
    .setStyle(ButtonStyle.Secondary);
const reply = (i, title, body) =>
  i.reply({
    components: [new ContainerBuilder().addTextDisplayComponents(text(`## ${title}\n${body}`))],
    flags: V2 | EPHEMERAL,
  });

function isPrivileged(role) {
  return PRIVILEGED_ROLE_PERMISSIONS.some((permission) => role.permissions.has(permission));
}

function panelPayload(panel, roles) {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(text(`# ${panel.title}`))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(
      text(
        `${panel.description}\n\n` +
          'Klik tombol role untuk mengambil role. Klik tombol yang sama sekali lagi untuk menghapus role tersebut. Kamu dapat mengambil beberapa role sekaligus.'
      )
    )
    .addSeparatorComponents(divider());

  for (let start = 0; start < roles.length; start += 5) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(...roles.slice(start, start + 5).map((role) => button(panel.id, role)))
    );
  }
  return { components: [container], flags: V2, allowedMentions: { parse: [] } };
}

async function createPanel(i) {
  if (!i.memberPermissions?.has(P.ManageRoles)) {
    return i.reply({ content: 'Perintah ini membutuhkan izin Manage Roles.', flags: EPHEMERAL });
  }

  const guild = i.guild;
  const channel = i.options.getChannel('channel', true);
  const selectedRoles = [];
  for (let n = 1; n <= MAX_ROLES; n += 1) {
    const role = i.options.getRole(`role${n}`, n === 1);
    if (role) selectedRoles.push(role);
  }
  const roles = [...new Map(selectedRoles.map((role) => [role.id, role])).values()];
  if (roles.length < 1) return i.reply({ content: 'Pilih minimal satu role.', flags: EPHEMERAL });
  if (channel.type !== ChannelType.GuildText) {
    return i.reply({ content: 'Pilih channel teks server.', flags: EPHEMERAL });
  }

  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!me?.permissions.has(P.ManageRoles)) {
    return i.reply({ content: 'Bot membutuhkan izin Manage Roles.', flags: EPHEMERAL });
  }
  if (!channel.permissionsFor(me)?.has([P.ViewChannel, P.SendMessages])) {
    return i.reply({ content: `Bot membutuhkan izin View Channel dan Send Messages di ${channel}.`, flags: EPHEMERAL });
  }

  for (const role of roles) {
    if (role.id === guild.id || role.managed) {
      return i.reply({ content: `Role ${role} tidak dapat digunakan pada panel self-role.`, flags: EPHEMERAL });
    }
    if (role.position >= me.roles.highest.position) {
      return i.reply({ content: `Pindahkan role bot ke atas ${role} sebelum memasukkan role tersebut ke panel.`, flags: EPHEMERAL });
    }
    if (isPrivileged(role)) {
      return i.reply({ content: `Role ${role} memiliki permission staff/admin dan tidak boleh dijadikan self-role.`, flags: EPHEMERAL });
    }
  }

  const title = (i.options.getString('title') || 'PILIH ROLE').trim().slice(0, 80) || 'PILIH ROLE';
  const description = (i.options.getString('description') || 'Pilih role yang sesuai dengan minat atau kebutuhanmu.').trim().slice(0, 1500);
  const existing = Object.values(data.panels)
    .filter((entry) => entry.guildId === guild.id && entry.channelId === channel.id && entry.messageId)
    .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))[0] || null;
  const panelId = existing?.id || crypto.randomBytes(5).toString('hex');
  const panel = {
    id: panelId,
    guildId: guild.id,
    channelId: channel.id,
    messageId: existing?.messageId ?? null,
    roleIds: roles.map((role) => role.id),
    title,
    description,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };

  await i.deferReply({ flags: V2 | EPHEMERAL });
  let message = null;
  let existingMessage = null;
  if (existing?.messageId) {
    existingMessage = await channel.messages.fetch(existing.messageId).catch(() => null);
  }
  try {
    if (existingMessage) {
      message = await existingMessage.edit(panelPayload(panel, roles));
    } else {
      message = await channel.send(panelPayload(panel, roles));
    }
    panel.messageId = message.id;
    data.panels[panelId] = panel;
    save();
    await sendLog(guild, { category: 'roles', title: 'Role panel configured', body: `Panel role berisi ${roles.length} role dipasang/diperbarui di <#${channel.id}> oleh <@${i.user.id}>.` });
    await i.editReply({
      components: [
        new ContainerBuilder().addTextDisplayComponents(
          text(`## Panel Role ${existingMessage ? 'Diperbarui' : 'Dibuat'}\nPanel berisi **${roles.length} role** telah ${existingMessage ? 'diperbarui pada pesan yang sama' : `dipasang di ${channel}`}. Anggota dapat mengambil beberapa role dan menghapusnya dengan menekan tombol yang sama.`)
        ),
      ],
      flags: V2 | EPHEMERAL,
    });
  } catch (err) {
    console.error('[roles] Gagal memasang atau memperbarui panel:', err.message);
    await i.editReply({
      components: [new ContainerBuilder().addTextDisplayComponents(text(
        existingMessage
          ? '## Gagal Memperbarui Panel\nPesan panel lama dipertahankan. Periksa permission bot dan coba lagi.'
          : '## Gagal Membuat Panel\nGagal mengirim panel. Periksa permission bot pada channel tujuan.'
      ))],
      flags: V2 | EPHEMERAL,
    });
  }
}

async function toggleRole(i) {
  const match = /^roles:toggle:([a-f0-9]+):(\d{15,22})$/.exec(i.customId);
  if (!match) return false;
  const [, panelId, roleId] = match;
  const panel = data.panels[panelId];
  if (!panel || panel.guildId !== i.guildId || panel.messageId !== i.message.id || !panel.roleIds.includes(roleId)) {
    await reply(i, 'Panel Tidak Berlaku', 'Panel role ini tidak ditemukan atau sudah tidak aktif.');
    return true;
  }

  const role = await i.guild.roles.fetch(roleId).catch(() => null);
  if (!role || role.managed || role.id === i.guild.id || isPrivileged(role)) {
    await reply(i, 'Role Tidak Tersedia', 'Role ini sudah tidak dapat diberikan. Hubungi administrator server.');
    return true;
  }
  const me = i.guild.members.me ?? (await i.guild.members.fetchMe().catch(() => null));
  if (!me?.permissions.has(P.ManageRoles) || role.position >= me.roles.highest.position) {
    await reply(i, 'Permission Bot Tidak Cukup', 'Bot tidak dapat mengelola role ini. Administrator perlu memeriksa izin dan urutan role bot.');
    return true;
  }

  await i.deferReply({ flags: V2 | EPHEMERAL });
  try {
    const member = await i.guild.members.fetch(i.user.id);
    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role, 'Self-role dilepas melalui panel Components V2');
      await sendLog(i.guild, { category: 'roles', title: 'Self-role removed', body: `<@${i.user.id}> melepas role **${role.name}**.` });
      await i.editReply({
        components: [new ContainerBuilder().addTextDisplayComponents(text(`## Role Dihapus\nRole ${role} telah dihapus dari akunmu.`))],
        flags: V2 | EPHEMERAL,
      });
    } else {
      await member.roles.add(role, 'Self-role diambil melalui panel Components V2');
      await sendLog(i.guild, { category: 'roles', title: 'Self-role added', body: `<@${i.user.id}> mengambil role **${role.name}**.` });
      await i.editReply({
        components: [new ContainerBuilder().addTextDisplayComponents(text(`## Role Ditambahkan\nRole ${role} telah diberikan ke akunmu. Tekan tombol yang sama lagi jika ingin melepasnya.`))],
        flags: V2 | EPHEMERAL,
      });
    }
  } catch (err) {
    console.error('[roles] Gagal toggle role:', err.message);
    await i.editReply({
      components: [new ContainerBuilder().addTextDisplayComponents(text('## Gagal Mengubah Role\nBot tidak berhasil mengubah role. Periksa permission Manage Roles dan posisi role bot.'))],
      flags: V2 | EPHEMERAL,
    });
  }
  return true;
}

const commands = [
  new SlashCommandBuilder()
    .setName('roles')
    .setDescription('Pengelolaan self-role komunitas')
    .addSubcommand((sub) => {
      sub.setName('panel').setDescription('Buat panel self-role dengan tombol toggle')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel tujuan panel').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addRoleOption((o) => o.setName('role1').setDescription('Role pertama (wajib)').setRequired(true));
      for (let n = 2; n <= MAX_ROLES; n += 1) sub.addRoleOption((o) => o.setName(`role${n}`).setDescription(`Role tambahan ${n} (opsional)`));
      return sub
        .addStringOption((o) => o.setName('title').setDescription('Judul panel (opsional)').setMaxLength(80))
        .addStringOption((o) => o.setName('description').setDescription('Deskripsi panel (opsional)').setMaxLength(1500));
    })
    .setDefaultMemberPermissions(P.ManageRoles)
    .setContexts(0)
    .toJSON(),
];

async function handle(interaction) {
  if (interaction.isChatInputCommand() && interaction.commandName === 'roles' && interaction.options.getSubcommand() === 'panel') {
    await createPanel(interaction);
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith('roles:toggle:')) {
    return toggleRole(interaction);
  }
  return false;
}

async function refreshPublicPanels(guild) {
  const panels = Object.values(data.panels).filter((p) => p.guildId === guild.id);
  if (!panels.length) return ['missing'];
  const statuses = [];
  for (const panel of panels) {
    const roles = panel.roleIds.map((id) => guild.roles.cache.get(id)).filter(Boolean);
    if (!roles.length) { statuses.push('failed'); continue; }
    statuses.push(await editTrackedPanel(guild, panel, panelPayload(panel, roles)));
  }
  return statuses;
}

module.exports = { name: 'roles', commands, handle, refreshPublicPanels };
