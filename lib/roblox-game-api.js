'use strict';

function parseRobloxPlaceId(value) {
  let url;
  try { url = new URL(String(value)); } catch { throw new Error('Link game Roblox tidak valid.'); }
  const host = url.hostname.toLowerCase();
  if (!(host === 'roblox.com' || host.endsWith('.roblox.com'))) throw new Error('Link harus berasal dari domain roblox.com.');
  const match = url.pathname.match(/\/games\/(\d+)(?:\/|$)/i);
  if (!match) throw new Error('Link Roblox harus berupa link game dengan format /games/PLACE_ID/.');
  const placeId = match[1];
  if (!/^\d{1,20}$/.test(placeId)) throw new Error('Place ID pada link tidak valid.');
  return placeId;
}

async function fetchGameIcon(placeId, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('Runtime Node.js tidak menyediakan fetch().');
  if (!/^\d{1,20}$/.test(String(placeId))) throw new Error('Place ID tidak valid.');
  const endpoint = new URL('https://thumbnails.roblox.com/v1/places/gameicons');
  endpoint.searchParams.set('placeIds', String(placeId));
  endpoint.searchParams.set('size', '512x512');
  endpoint.searchParams.set('format', 'Png');
  endpoint.searchParams.set('isCircular', 'false');
  const response = await fetchImpl(endpoint, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
  if (!response.ok) throw new Error(`Roblox Thumbnail API merespons HTTP ${response.status}.`);
  const payload = await response.json();
  const item = Array.isArray(payload.data) ? payload.data[0] : null;
  if (!item?.imageUrl || item.state !== 'Completed') throw new Error('Game Icon belum tersedia dari Roblox.');
  const imageUrl = new URL(item.imageUrl);
  if (!['tr.rbxcdn.com', 'rbxcdn.com'].some((host) => imageUrl.hostname === host || imageUrl.hostname.endsWith(`.${host}`))) {
    throw new Error('Roblox mengembalikan host gambar yang tidak dikenali.');
  }
  return imageUrl.toString();
}

module.exports = { parseRobloxPlaceId, fetchGameIcon };
