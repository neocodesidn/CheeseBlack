const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { ChannelType, MessageFlags } = require('discord.js');
const music = require('../src/music');
const icons = require('../src/icons');

test('36 PNG server dapat dipasang, instalasi ulang melewati nama yang sama', async () => {
  const rows = await icons.catalog();
  assert.equal(rows.length, 36);
  const known = [];
  const rest = {
    get: async () => known,
    post: async (route, { body }) => {
      assert.equal(route, '/guilds/123/emojis');
      assert.ok(body.image.startsWith('data:image/png;base64,iVBOR'));
      known.push({ name: body.name });
    },
  };
  const run = (rows) => icons.upload(rest, '123', rows, async () => {}, Date.now() + 60000);
  assert.deepEqual(await run(rows.slice(0, 1)), { added: 1, skipped: 0 });
  assert.deepEqual(await run(rows), { added: 35, skipped: 1 });
  assert.deepEqual(await run(rows), { added: 0, skipped: 36 });
});
test('modal bulk, panel publik, rollback duplikat, pilihan privat, salin dan hapus', async () => {
  let listener, reply, modal, sent;
  const db = new DatabaseSync(':memory:');
  const guild = { iconURL: () => 'https://example.org/server.png' };
  const channel = {
    guild,
    type: ChannelType.GuildText,
    send: async (data) => {
      sent = data;
      return { id: 'panel' };
    },
    messages: {
      edit: async (_id, data) => {
        sent = data;
      },
    },
  };
  const client = {
    once() {},
    on(_e, cb) {
      listener = cb;
    },
    channels: { fetch: async () => channel },
  };
  music.install(client, db);
  const interact = async (sub, opts = {}) => {
    reply = undefined;
    const i = {
      guild,
      guildId: 'guild',
      user: { id: '123456789012345678' },
      channelId: 'channel',
      channel,
      commandName: 'music',
      memberPermissions: { has: () => true },
      isChatInputCommand: () => Boolean(sub),
      isAutocomplete: () => false,
      isButton: () => false,
      isStringSelectMenu: () => false,
      options: { getSubcommand: () => sub, getString: n => n === 'category' ? null : 'test' },
      reply: async (data) => {
        reply = data;
      },
      editReply: async (data) => {
        reply = data;
      },
      deferReply: async () => {
        i.deferred = true;
      },
      showModal: async (data) => {
        modal = data.toJSON();
      },
      update: async (data) => {
        reply = data;
      },
      ...opts,
    };
    await listener(i);
  };
  const bulk = (text) =>
    interact('', { customId: 'music:bulk', fields: { getTextInputValue: () => text } });
  const count = () => db.prepare('SELECT count(*) AS n FROM music_tracks').get().n;
  await interact('panel');
  await interact('bulk');
  assert.equal(modal.custom_id, 'music:bulk:Umum');
  await bulk('123 | Test\n456 | Lagu B');
  assert.equal(count(), 2);
  assert.match(JSON.stringify(sent.components[0].toJSON()), /Lagu B/);
  const metadata = () => db.prepare('SELECT * FROM music_catalog_info WHERE guild=?').get('guild');
  const first = metadata();
  assert.equal(first.uploader, '123456789012345678');
  assert.ok(first.updated > 0);
  const box = sent.components[0].toJSON();
  assert.equal(box.components[0].accessory.media.url, guild.iconURL());
  assert.equal(box.components.filter(c=>c.type === 14 && c.spacing === 1 && c.divider).length,2);
  assert.match(box.components.at(-1).content, /<@123456789012345678>/);
  assert.match(box.components.at(-1).content, /WIB/);
  await bulk('789 | Lagu C\n123 | Nama lain');
  assert.equal(count(), 2);
  assert.deepEqual(metadata(), first);
  await interact('', {
    customId: 'music:pick',
    isStringSelectMenu: () => true,
    values: ['123', '456'],
    memberPermissions: { has: () => false },
  });
  assert.equal(reply.flags, MessageFlags.Ephemeral);
  await interact('', { customId: 'music:copy', isButton: () => true, message: { content: reply.content } });
  assert.deepEqual(reply.content.split('\n').sort(), ['123', '456']);
  await interact('delete', {user:{id:'other-admin'}});
  assert.equal(metadata().uploader, first.uploader);
  assert.equal(count(), 1);
  assert.ok(!JSON.stringify(sent.components[0].toJSON()).includes('Test'));
  await interact('add', { memberPermissions: { has: () => false } });
  assert.match(reply.content, /administrator/);
  db.close();
});
test('panel 21 lagu bisa berpindah ke halaman dua', () => {
  const songs = Array.from({ length: 21 }, (_, i) => ({ id: String(i + 1), name: 'Lagu ' + (i + 1) }));
  const box = music.render(songs, 1).components[0].toJSON();
  assert.match(JSON.stringify(box), /Halaman 2 \/ 2/);
  assert.ok(box.components.some((c) => c.components?.some((x) => x.options?.length === 1)));
});

test('footer katalog lama jujur, footer baru memakai hari dan jam Jakarta', () => {
  const legacy = music.render([]).components[0].toJSON();
  assert.match(legacy.components.at(-1).content, /Belum tercatat/);
  const known = music.render([],0,null,{uploader:'123',updated:Date.parse('2026-11-24T19:35:00Z')});
  assert.match(known.components[0].toJSON().components.at(-1).content, /25 November 2026, 02\.35 WIB/);
});

test('database lama: pindah kategori mempertahankan ID, panel, uploader, dan data server lain setelah restart', async () => {
  const {mkdtempSync,rmSync}=require('node:fs');
  const {tmpdir}=require('node:os');
  const {join}=require('node:path');
  const folder=mkdtempSync(join(tmpdir(),'music-v1-'));
  const file=join(folder,'game.sqlite');
  let db=new DatabaseSync(file), listener, response;
  const client={on(event,cb){listener=cb;},once(){},channels:{fetch:async()=>({messages:{edit:async()=>{}}})}};
  async function interact(sub,values={},extra={}) {
    const i={guildId:'A',commandName:'music',user:{id:'admin'},memberPermissions:{has:()=>true},
      isChatInputCommand:()=>Boolean(sub),isAutocomplete:()=>false,isButton:()=>false,isStringSelectMenu:()=>false,
      options:{getSubcommand:()=>sub,getString:name=>values[name]??null},
      reply:async data=>{response=data;},editReply:async data=>{response=data;},
      deferReply:async()=>{i.deferred=true;},...extra};
    await listener(i);
  }
  try {
    db.exec(`CREATE TABLE music_tracks(guild TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,
      key TEXT NOT NULL,PRIMARY KEY(guild,id),UNIQUE(guild,key));
      INSERT INTO music_tracks VALUES('A','123','Lagu lama','lagu lama'),('B','123','Lagu lain','lagu lain');
      CREATE TABLE music_catalog_info(guild TEXT PRIMARY KEY,uploader TEXT,updated INTEGER NOT NULL);
      INSERT INTO music_catalog_info VALUES('A','pengunggah-asli',25);
      CREATE TABLE music_panels(guild TEXT PRIMARY KEY,channel TEXT NOT NULL,message TEXT NOT NULL);
      INSERT INTO music_panels VALUES('A','channel','message');`);
    music.install(client,db);
    const song=(guild)=>db.prepare('SELECT * FROM music_tracks WHERE guild=? AND id=?').get(guild,'123');
    assert.equal(song('A').category,'Umum');
    await interact('move',{category:' Galau ',namemusic:'Lagu lama'});
    assert.equal(song('A').category,'Galau');
    assert.equal(db.prepare('SELECT uploader FROM music_catalog_info WHERE guild=?').get('A').uploader,'pengunggah-asli');
    await interact('',{}, {customId:'music:bulk:galau',fields:{getTextInputValue:()=> '234 | Lagu kedua'}});
    await interact('add',{category:'DJ',id:'345',namemusic:'Beat'});
    await interact('list',{category:'GALAU'});
    const options=response.components[0].toJSON().components.flatMap(c=>c.components||[]).find(c=>c.custom_id==='music:pick').options;
    assert.deepEqual(options.map(o=>o.value).sort(),['123','234']);
    await interact('move',{category:'Dangdut',namemusic:'Beat'},{memberPermissions:{has:()=>false}});
    assert.match(response.content,/administrator/);
    assert.equal(song('B').category,'Umum');
    db.close();db=new DatabaseSync(file);
    music.install(client,db);
    assert.deepEqual({...song('A')},{guild:'A',id:'123',name:'Lagu lama',key:'lagu lama',category:'Galau'});
    assert.equal(db.prepare('SELECT message FROM music_panels').get().message,'message');
  } finally {db.close();rmSync(folder,{recursive:true});}
});
