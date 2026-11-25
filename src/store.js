const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const { dirname } = require('node:path');
class Store {
  constructor(file) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA busy_timeout=5000;
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS categories(guild TEXT, key TEXT, name TEXT, link TEXT, PRIMARY KEY(guild,key));
      CREATE TABLE IF NOT EXISTS drafts(thread TEXT PRIMARY KEY, guild TEXT, owner TEXT, target TEXT, name TEXT,
        link TEXT, role TEXT, state TEXT DEFAULT 'edit', preview TEXT, stamp INTEGER, published TEXT);
    `);
  }
  add(guild, name, link) {
    name = name.trim();
    if (!name) throw Error('Nama kategori wajib diisi.');
    const r = this.db
      .prepare('INSERT OR IGNORE INTO categories VALUES(?,?,?,?)')
      .run(guild, name.toLowerCase(), name, link);
    if (!r.changes) throw Error('Kategori tersebut sudah ada.');
  }
  get(guild, name) {
    return this.db
      .prepare('SELECT * FROM categories WHERE guild=? AND key=?')
      .get(guild, name.trim().toLowerCase());
  }
  list(guild) {
    return this.db.prepare('SELECT * FROM categories WHERE guild=? ORDER BY key').all(guild);
  }
  remove(guild, key) {
    return this.db.prepare('DELETE FROM categories WHERE guild=? AND key=?').run(guild, key);
  }
  create(thread, guild, owner, target, category, role) {
    this.db
      .prepare('INSERT INTO drafts(thread,guild,owner,target,name,link,role) VALUES(?,?,?,?,?,?,?)')
      .run(thread, guild, owner, target, category.name, category.link, role);
  }
  draft(thread) {
    return this.db.prepare('SELECT * FROM drafts WHERE thread=?').get(thread);
  }
  preview(thread, value) {
    this.db
      .prepare("UPDATE drafts SET state='preview',preview=? WHERE thread=? AND state='edit'")
      .run(JSON.stringify(value), thread);
  }
  state(thread, from, to) {
    return this.db.prepare('UPDATE drafts SET state=? WHERE thread=? AND state=?').run(to, thread, from)
      .changes;
  }
  reserve(thread) {
    return this.db
      .prepare("UPDATE drafts SET state='sending',stamp=? WHERE thread=? AND state='preview'")
      .run(Date.now(), thread).changes;
  }
  finish(thread, id) {
    this.db
      .prepare("UPDATE drafts SET state='done',published=?,preview=NULL WHERE thread=?")
      .run(id, thread);
  }
}
module.exports = { Store };
