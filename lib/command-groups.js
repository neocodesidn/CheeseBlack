'use strict';

function buildRegisteredCommands(plugins) {
  const commands = plugins.flatMap((plugin) => plugin.commands ?? []);
  const seen = new Set();
  for (const command of commands) {
    if (seen.has(command.name)) throw new Error(`Nama command root duplikat: /${command.name}`);
    seen.add(command.name);
  }
  return commands;
}

function optionTypeName(type) {
  return ({ 3: 'teks', 4: 'angka bulat', 5: 'ya/tidak', 6: 'member', 7: 'channel', 8: 'role', 9: 'member/role', 10: 'angka', 11: 'file' })[type] ?? 'nilai';
}
function formatOption(option) {
  const value = `<${optionTypeName(option.type)}>`;
  return option.required ? `${option.name}:${value}` : `[${option.name}:${value}]`;
}
function describeOption(option) {
  const required = option.required ? 'wajib' : 'opsional';
  let line = `- \`${option.name}\` (${required}): ${option.description || 'Tidak ada keterangan.'}`;
  if (option.choices?.length) line += ` Pilihan: ${option.choices.map((choice) => `${choice.name} (${choice.value})`).join(', ')}.`;
  else if (option.autocomplete) line += ' Pilih nilai dari daftar saran yang muncul.';
  return line;
}
function flatten(path, description, options, category, output) {
  const nested = (options ?? []).filter((option) => option.type === 1 || option.type === 2);
  if (!nested.length) {
    const args = (options ?? []).filter((option) => option.type !== 1 && option.type !== 2);
    output.push({ category, path, text: `**\`${path}\`** — ${description || 'Tidak ada keterangan.'}\n\`${path}${args.length ? ` ${args.map(formatOption).join(' ')}` : ''}\`${args.length ? `\n${args.map(describeOption).join('\n')}` : ''}` });
    return;
  }
  for (const option of nested) flatten(`${path} ${option.name}`, option.description, option.options ?? [], category, output);
}
function buildHelpEntries(plugins) {
  const output = [];
  for (const plugin of plugins) {
    if (plugin.name === 'owner') continue;
    for (const command of plugin.commands ?? []) {
      const category = command.name;
      flatten(`/${command.name}`, command.description, command.options ?? [], category, output);
    }
  }
  output.sort((a, b) => a.category.localeCompare(b.category) || a.path.localeCompare(b.path));
  return output;
}
function buildHelpPages(plugins, maxLength = 3300) {
  const entries = buildHelpEntries(plugins);
  const pages = [];
  let current = '';
  let currentCategory = '';
  for (const entry of entries) {
    const heading = entry.category !== currentCategory ? `## ${entry.category.toUpperCase()}\n` : '';
    const block = `${heading}${entry.text}\n\n`;
    if (current && current.length + block.length > maxLength) { pages.push(current.trim()); current = ''; currentCategory = ''; }
    const nextHeading = entry.category !== currentCategory ? `## ${entry.category.toUpperCase()}\n` : '';
    current += `${nextHeading}${entry.text}\n\n`;
    currentCategory = entry.category;
  }
  if (current.trim()) pages.push(current.trim());
  return pages.length ? pages : ['Belum ada command yang terdaftar.'];
}
module.exports = { buildRegisteredCommands, buildHelpEntries, buildHelpPages };
