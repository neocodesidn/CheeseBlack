const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { MessageFlags, Collection, ComponentType } = require('discord.js');
const { Store } = require('../src/store');
const { parse, panel, wib } = require('../src/content');
const { iconsFor, thumbnail } = require('../src/media');
const { register } = require('../src/register');
const { latest, button, controls } = require('../src/bot');
const { publish } = require('../src/publish');
const cmd = require('../src/command').toJSON();
const icons = {
  announcement: '<:a:123>',
  products: '<:b:123>',
  community: '<:c:123>',
  calendar: '<:d:123>',
};
const thread = '1443300000000000001';
const date = new Date('2026-11-25T07:35:00Z');
const raw =
  'title: Rilis\n\ndescription:\n**Changes**\n• <:keju:123>\n\n  <#456> @everyone\n\nfooter:\n<#789>';
function draft() {
  const db = new Store(':memory:');
  db.create(thread, 'A', 'owner', 'target', { name: 'FISH IT', link: '' }, '123');
  db.preview(thread, { ...parse(raw), revision: 'first' });
  return db;
}
test('empat subcommand admin, role picker dan autocomplete', () => {
  assert.deepEqual(
    cmd.options.map((o) => o.name),
    ['add', 'list', 'delete', 'changelog'],
  );
  assert.equal(cmd.default_member_permissions, '8');
  assert.deepEqual(cmd.contexts, [0]);
  assert.equal(cmd.options[3].options[1].type, 8);
  for (const n of [2, 3]) assert.equal(cmd.options[n].options[0].autocomplete, true);
});
test('registrasi membersihkan global dan guild lama pada satu aplikasi', async () => {
  const writes = [];
  const guild = '123456789012345678';
  const legacy = '123456789012345679';
  await register(
    {
      get: async (r) => (r.includes('@me') ? [{ id: guild }] : [{}]),
      put: async (r, o) => writes.push([r, o.body]),
    },
    'black',
    legacy,
  );
  assert.deepEqual(
    writes.map((w) => w[0]).sort(),
    [
      '/applications/black/commands',
      ...[guild, legacy].map((g) => '/applications/black/guilds/' + g + '/commands'),
    ].sort(),
  );
  assert.deepEqual(
    writes.map((w) => w[1].length),
    [3, 0, 0],
  );
});
test('isolasi kategori, duplikat, restart, delete', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cheese-')),
    file = join(dir, 'data.sqlite');
  let db = new Store(file);
  try {
    db.add('A', ' FISH IT ', '');
    assert.throws(() => db.add('A', 'fish it', ''));
    db.db.close();
    db = new Store(file);
    assert.deepEqual(db.list('B'), []);
    assert.equal(db.get('A', ' fish IT ').name, 'FISH IT');
    db.remove('A', 'fish it');
    assert.equal(db.get('A', 'FISH IT'), undefined);
  } finally {
    db.db.close();
    rmSync(dir, { recursive: true });
  }
});
test('parser mempertahankan Markdown, mention dan spasi internal', () => {
  assert.deepEqual(parse(raw), {
    title: 'Rilis',
    description: '**Changes**\n• <:keju:123>\n\n  <#456> @everyone',
    footer: '<#789>',
  });
  assert.throws(() => parse('title: saja'));
  assert.throws(() => parse('description: saja'));
  assert.throws(() => parse(raw + '\ntitle: dua'));
});
test('panel V2 dengan thumbnail, jam WIB, footer opsional dan allowlist ping', () => {
  const d = draft().draft(thread),
    body = parse(raw);
  assert.equal(wib(date), '25 November 2026, 14.35 WIB');
  const prev = panel(d, body, icons, 'https://example.org/icon.png', date);
  assert.equal(prev.flags, MessageFlags.IsComponentsV2);
  assert.deepEqual(prev.allowedMentions, { parse: [], roles: [] });
  const box = prev.components[0].toJSON();
  assert.equal(box.accent_color, undefined);
  assert.equal(box.components[0].accessory.media.url, 'https://example.org/icon.png');
  assert.match(box.components[0].components[1].content, /Recipient:\*\* <@&123>/);
  assert.equal(box.components.at(-1).content, '<#789>');
  const live = panel(d, { ...body, footer: '' }, icons, null, date, true);
  assert.deepEqual(live.allowedMentions, { parse: [], roles: ['123'] });
  const content = live.components[0].toJSON().components;
  assert.equal(content.filter((c) => c.type === ComponentType.Separator).length, 1);
  assert.equal(content.at(-1).content, body.description);
});
test('thumbnail Roblox dan fallback untuk state, jaringan dan ikon kosong', async () => {
  const urls = [],
    link = 'https://www.roblox.com/games/123/Game';
  const api = async (url) => {
    urls.push(url);
    return {
      ok: true,
      json: async () =>
        urls.length === 1
          ? { universeId: 99 }
          : { data: [{ state: 'Completed', imageUrl: 'https://cdn.test/icon' }] },
    };
  };
  assert.equal(await thumbnail(link, 'guild', api), 'https://cdn.test/icon');
  assert.match(urls[0], /places\/123/);
  assert.match(urls[1], /universeIds=99/);
  for (const request of [
    async () => {
      throw Error();
    },
    async (url) => ({
      ok: true,
      json: async () => (url.includes('places') ? { universeId: 99 } : { data: [{ state: 'Pending' }] }),
    }),
  ]) {
    assert.equal(await thumbnail(link, 'guild', request), 'guild');
  }
  assert.equal(await thumbnail('', null, api), null);
});
test('dua draft bersamaan dan restart memakai ulang emoji aplikasi', async () => {
  const existing = new Collection();
  let uploads = 0;
  const app = {
    emojis: {
      fetch: async () => existing,
      create: async ({ name, attachment }) => {
        assert.equal(require('node:fs').readFileSync(attachment).subarray(1, 4).toString(), 'PNG');
        uploads++;
        const e = { name, toString: () => name };
        existing.set(name, e);
        return e;
      },
    },
  };
  await Promise.all([iconsFor(app), iconsFor(app)]);
  assert.equal(uploads, 4);
  delete require.cache[require.resolve('../src/media')];
  await require('../src/media').iconsFor(app);
  assert.equal(uploads, 4);
});
test('preview membaca pesan terbaru milik penulis, termasuk edit dari Discord', async () => {
  const messages = new Collection([
    ['3', { author: { id: 'other' }, content: 'x' }],
    ['2', { author: { id: 'owner' }, content: raw }],
  ]);
  assert.deepEqual(await latest({ messages: { fetch: async () => messages } }, 'owner'), parse(raw));
  assert.ok(
    controls(['edit', 'publish', 'cancel'])
      .toJSON()
      .components.every((c) => c.style === 2),
  );
});
test('edit membatalkan snapshot lama dan cancel menutup draft', async () => {
  const db = draft(),
    i = { editReply: async () => {}, channel: { setArchived: async () => {} } };
  await button(i, db, db.draft(thread), 'edit', 'first');
  await assert.rejects(button(i, db, db.draft(thread), 'publish', 'first'));
  await button(i, db, db.draft(thread), 'cancel', '');
  assert.equal(db.draft(thread).state, 'cancelled');
});
test('klik ganda mengirim satu pesan dan penolakan Discord dapat dicoba lagi', async () => {
  const db = draft(),
    d = db.draft(thread);
  let count = 0;
  await assert.rejects(
    publish(
      db,
      d,
      {
        send: async () => {
          throw Object.assign(Error(), { status: 403 });
        },
      },
      {},
    ),
  );
  assert.equal(db.draft(thread).state, 'preview');
  const ch = {
    send: async (p) => {
      assert.equal(p.enforceNonce, true);
      assert.equal(p.nonce, thread);
      count++;
      return { id: 'sent' };
    },
  };
  await Promise.allSettled([publish(db, d, ch, {}), publish(db, d, ch, {})]);
  assert.equal(count, 1);
  assert.equal(db.draft(thread).published, 'sent');
});
test('timeout setelah terbit direkonsiliasi dari marker tanpa kirim kedua', async () => {
  const db = draft(),
    d = db.draft(thread),
    payload = panel(d, parse(raw), icons, null, date, true);
  const channel = {
    client: { user: { id: 'bot' } },
    send: async () => {
      throw Error('timeout');
    },
    messages: {
      fetch: async () =>
        new Collection([['sent', { id: 'sent', author: { id: 'bot' }, components: payload.components }]]),
    },
  };
  await assert.rejects(publish(db, d, channel, payload));
  const pending = db.draft(thread);
  pending.stamp -= 120_000;
  assert.equal(await publish(db, pending, channel, payload), 'sent');
  assert.equal(db.draft(thread).state, 'done');
});
test('halaman game publik memakai og:image setelah jenis gambar dikonfirmasi', async () => {
  const { Readable } = require('node:stream');
  const { imageFromPage } = require('../src/link-image');
  const open = async (url) => {
    const html = url.pathname === '/game';
    const stream = Readable.from(html ? ['<meta property="og:image" content="/icon.png">'] : []);
    stream.statusCode = 200;
    stream.headers = { 'content-type': html ? 'text/html' : 'image/png' };
    return stream;
  };
  assert.equal(
    await thumbnail('https://game.test/game', 'guild', null, (url) => imageFromPage(url, open)),
    'https://game.test/icon.png',
  );
  assert.equal(await thumbnail('http://127.0.0.1/game', 'guild'), 'guild');
});

test('draft privat memakai tujuan pilihan atau channel asal bila opsi kosong', async () => {
  const {openDraft} = require('../src/bot');
  const {ChannelType} = require('discord.js');
  const option = cmd.options[3].options.find(o => o.name === 'channel');
  assert.equal(option.type, 7);
  assert.deepEqual(option.channel_types, [ChannelType.GuildText, ChannelType.GuildAnnouncement]);
  for (const picked of ['updates', null]) {
    const db = new Store(':memory:');
    const expected = picked ?? 'admin';
    const target = {id:expected, type:ChannelType.GuildAnnouncement, permissionsFor:()=>({has:()=>true})};
    const privateThread = {id:thread, members:{add:async()=>{}}, send:async message=>{
      assert.ok(message.content.includes('Tujuan <#'+expected+'>'));
    }};
    const source = {id:'admin', type:ChannelType.GuildText, permissionsFor:target.permissionsFor,
      threads:{create:async options=>{assert.equal(options.type,ChannelType.PrivateThread);return privateThread;}}};
    const i = {channel:source, guildId:'A', guild:{members:{me:{}},channels:{fetch:async id=>{
      assert.equal(id,expected); return picked ? target : source;
    }}},options:{getRole:()=>({id:'role'}),getChannel:()=>picked && target},
      user:{id:'owner',username:'neo'},editReply:async()=>{}};
    await openDraft(i,db,{name:'FISH IT',link:''});
    assert.equal(db.draft(thread).target,expected);
    db.db.close();
  }
});
