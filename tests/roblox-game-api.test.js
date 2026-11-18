'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRobloxPlaceId, fetchGameIcon } = require('../lib/roblox-game-api');

test('extracts Place ID from Roblox game URLs', () => {
  assert.equal(parseRobloxPlaceId('https://www.roblox.com/games/123456789/Fish-It'), '123456789');
  assert.equal(parseRobloxPlaceId('https://roblox.com/games/987654321'), '987654321');
});

test('rejects non-Roblox or non-game URLs', () => {
  assert.throws(() => parseRobloxPlaceId('https://example.com/games/123'), /domain roblox.com/);
  assert.throws(() => parseRobloxPlaceId('https://www.roblox.com/catalog/123'), /format \/games/);
  assert.throws(() => parseRobloxPlaceId('not a URL'), /tidak valid/);
});

test('requests the latest game icon from Roblox thumbnail API', async () => {
  let requested;
  const fetchMock = async (url, options) => {
    requested = { url: String(url), options };
    return { ok: true, json: async () => ({ data: [{ state: 'Completed', imageUrl: 'https://tr.rbxcdn.com/example/image.png' }] }) };
  };
  const result = await fetchGameIcon('12345', fetchMock);
  assert.equal(result, 'https://tr.rbxcdn.com/example/image.png');
  assert.match(requested.url, /placeIds=12345/);
  assert.match(requested.url, /size=512x512/);
});

test('rejects untrusted image hosts returned by API', async () => {
  const fetchMock = async () => ({ ok: true, json: async () => ({ data: [{ state: 'Completed', imageUrl: 'https://example.com/image.png' }] }) });
  await assert.rejects(fetchGameIcon('12345', fetchMock), /host gambar/);
});
