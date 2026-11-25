// A stable Discord nonce covers an uncertain network response during the short retry window.
async function publish(store, d, channel, payload) {
  const retry = d.state === 'sending';
  if (retry && Date.now() - d.stamp > 60_000) {
    // A public panel has three explicit component IDs encoding the thread snowflake.
    // Find the existing message before reporting an unresolved attempt.
    let before;
    for (;;) {
      const page = await channel.messages.fetch({ limit: 100, before });
      const found = page.find((m) => m.author.id === channel.client.user.id && matches(m, d.thread));
      if (found) {
        store.finish(d.thread, found.id);
        return found.id;
      }
      if (page.size < 100) break;
      before = page.last().id;
      if (BigInt(before) <= BigInt(d.thread)) break;
    }
    throw Error(
      'Status pengiriman sebelumnya belum terkonfirmasi. Periksa riwayat channel tujuan. Draft disimpan; kirim ulang otomatis dihentikan agar tidak ganda.',
    );
  }
  if (!retry && !store.reserve(d.thread)) throw Error('Draft sudah diproses.');
  let message;
  try {
    message = await channel.send({ ...payload, nonce: d.thread, enforceNonce: true });
  } catch (e) {
    const definite = e.status >= 400 && e.status < 500 && e.status !== 408;
    if (definite && !retry) store.state(d.thread, 'sending', 'preview');
    throw Error(
      definite && !retry
        ? 'Discord menolak pengiriman. Periksa izin atau isi panel lalu coba Publish lagi.'
        : 'Status pengiriman belum pasti. Tekan Publish lagi segera untuk memeriksa dengan nonce yang sama.',
    );
  }
  store.finish(d.thread, message.id);
  return message.id;
}
function markers(thread) {
  const id = BigInt(thread);
  return [0n, 1n, 2n].map((n) => Number(((n + 1n) << 22n) | ((id >> (22n * n)) & 0x3fffffn)));
}
function matches(message, thread) {
  const box = message.components[0]?.toJSON();
  const first = box?.components?.[0];
  const [a, b, c] = markers(thread);
  const texts = first?.type === 9 ? first.components : box?.components;
  return box?.id === a && texts?.[0]?.id === b && texts?.[1]?.id === c;
}
module.exports = { publish, markers };
