// Ambil teks dari komponen Components V2 (pesan bot tidak punya message.content)
function flattenText(components = []) {
  const out = [];
  for (const c of components) {
    if (typeof c.content === 'string') out.push(c.content);
    if (Array.isArray(c.components)) out.push(...flattenText(c.components));
  }
  return out;
}

const stamp = (d) => d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

/** Bangun transcript teks dari seluruh pesan di channel (maksimal 1000 pesan terakhir). */
async function buildTranscript(channel) {
  const all = [];
  let before;
  for (let i = 0; i < 10; i++) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    all.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  all.reverse();

  const lines = [
    `Transcript #${channel.name}`,
    `Server : ${channel.guild.name}`,
    `Dibuat : ${stamp(new Date())}`,
    `Pesan  : ${all.length}`,
    '='.repeat(48),
    '',
  ];

  for (const m of all) {
    lines.push(`[${stamp(m.createdAt)}] ${m.author.username} (${m.author.id})`);

    const parts = [];
    if (m.content) parts.push(m.content);
    parts.push(...flattenText(m.components));
    for (const e of m.embeds) {
      const t = [e.title, e.description].filter(Boolean).join(' - ');
      if (t) parts.push(`[embed] ${t}`);
    }
    for (const a of m.attachments.values()) parts.push(`[lampiran] ${a.url}`);

    for (const p of parts) {
      for (const line of String(p).split('\n')) lines.push(`    ${line}`);
    }
    lines.push('');
  }

  return { buffer: Buffer.from(lines.join('\n'), 'utf8'), count: all.length };
}

module.exports = { buildTranscript };
