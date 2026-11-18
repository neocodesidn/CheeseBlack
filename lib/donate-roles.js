'use strict';
// Assign only a non-privileged, bot-manageable appreciation role.
// Generic Discord objects and injected permission constants keep this testable.
function roleProblem(guild, botMember, role, permissions) {
  if (!role || role.id === guild.id || role.managed) {
    return 'Pilih role biasa, bukan @everyone atau role integrasi/bot.';
  }
  if (!botMember?.permissions?.has(permissions.ManageRoles)) {
    return 'Bot membutuhkan izin Manage Roles untuk memberikan role donatur.';
  }
  if (!botMember.roles?.highest || role.comparePositionTo(botMember.roles.highest) >= 0) {
    return 'Role donatur harus berada di bawah posisi role tertinggi bot.';
  }
  // Donation roles must not silently grant staff/moderator privileges.
  const dangerous = [
    'Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels',
    'BanMembers', 'KickMembers', 'ManageWebhooks', 'ModerateMembers',
    'ManageMessages', 'ManageThreads', 'ManageEvents', 'ManageNicknames',
    'MentionEveryone', 'ViewAuditLog',
  ];
  if (dangerous.some((key) => permissions[key] != null && role.permissions?.has(permissions[key]))) {
    return 'Role donatur tidak boleh memiliki izin admin atau moderasi. Buat role apresiasi biasa.';
  }
  return null;
}

async function grant(guild, record, permissions) {
  const bot = guild.members.me || await guild.members.fetchMe();
  const role = await guild.roles.fetch(record.roleIdAtPayment);
  const error = roleProblem(guild, bot, role, permissions);
  if (error) throw new Error(error);
  // Fetch from API to handle restarts, uncached members, and already-granted roles.
  const member = await guild.members.fetch(record.userId);
  if (member.roles.cache.has(role.id)) return { alreadyHadRole: true };
  await member.roles.add(role, 'Donasi komunitas berhasil diverifikasi');
  return { alreadyHadRole: false };
}

module.exports = { roleProblem, grant };
