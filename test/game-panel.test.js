const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {Collection,ButtonStyle}=require('discord.js');
const {initialize,publish,copy,destination}=require('../src/game-panel');
const guild={id:'123456789012345678',iconURL:()=>null};
const channel={id:'123456789012345679',guildId:guild.id,name:'game-links'};
guild.channels={fetch:async id=>id===undefined ? new Collection([[channel.id,channel]]) : channel};

test('redirect menerima URL, mention channel dan nama channel',async()=>{
  const expected='https://discord.com/channels/'+guild.id+'/'+channel.id;
  assert.equal(await destination(guild,'<#'+channel.id+'>'),expected);
  assert.equal(await destination(guild,'#game-links'),expected);
  assert.equal(await destination(guild,'https://example.org/game'),'https://example.org/game');
  await assert.rejects(destination(guild,'javascript:abc'));
  await assert.rejects(destination(guild,'#unknown'));
});
test('panel dengan dan tanpa gambar, tautan dan salinan privat tepat',async()=>{
  for(const extras of [true,false]){
    const db=new DatabaseSync(':memory:');initialize(db);
    const id='123456789012345680',source='print("test")\n-- @everyone';
    const options={loadstring:source,namebutton:extras?'Diskusi':null,redirectbutton:extras?'#game-links':null};
    let payload,reply;
    const i={id,guild:{...guild,iconURL:()=>extras?'https://example.org/server.png':null},guildId:guild.id,channelId:channel.id,user:{id:'owner'},createdTimestamp:Date.now(),
      channel:{send:async data=>{payload=data;return {url:'https://discord.com'};}},editReply:async data=>{reply=data;},
      options:{getString:n=>options[n],getAttachment:()=>extras?{url:'https://cdn.discordapp.com/example.png',contentType:'image/png'}:null}};
    await publish(i,db,{name:'FISH IT'});
    const components=payload.components[0].toJSON().components;
    assert.deepEqual(components.map(c=>c.type),extras?[12,9,14,10,1,14,10]:[10,10,14,10,1,14,10]);
    if(extras) assert.equal(components[1].accessory.media.url,'https://example.org/server.png');
    assert.match(components.at(-1).content,/<@owner>\n-# .* WIB$/);
    assert.ok(components.filter(c=>c.type===14).every(c=>c.spacing===1 && c.divider));
    const buttons=components.find(x=>x.type===1).components;
    assert.equal(buttons[0].style,ButtonStyle.Secondary);
    assert.equal(buttons.length,extras?2:1);
    assert.equal(components.some(x=>x.type===12),extras);
    assert.equal(payload.files.length,extras?1:0);
    await copy({...i,customId:buttons[0].custom_id,user:{id:'member'}},db);
    assert.equal(reply.content,source);assert.deepEqual(reply.allowedMentions,{parse:[]});
    await assert.rejects(copy({...i,customId:buttons[0].custom_id,guildId:'other'},db));
    db.close();
  }
});
