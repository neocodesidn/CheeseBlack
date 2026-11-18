'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'script.js'), 'utf8');
const start = source.indexOf(".addSubcommand((s) => s.setName('update')");
const end = source.indexOf(".addSubcommand((s) => s.setName('history')", start);
const updateCommand = source.slice(start, end);

test('required Script Update options are declared before optional display and button options', () => {
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const firstOptional = updateCommand.indexOf(".addStringOption((o) => o.setName('title')");
  assert.notEqual(firstOptional, -1);
  for (const name of ['category', 'recipient', 'description', 'button1', 'directchannelbutton1']) {
    const optionIndex = updateCommand.indexOf(`.setName('${name}')`);
    assert.ok(optionIndex >= 0 && optionIndex < firstOptional, `${name} must be declared before optional options`);
  }
});

test('Script Update exposes the recipient role and editable default title/emoji fields', () => {
  assert.match(updateCommand, /addRoleOption\(\(o\) => o\.setName\('recipient'\)[\s\S]*?\.setRequired\(true\)/);
  for (const name of ['title', 'title_emoji', 'category_emoji', 'recipient_emoji']) {
    assert.ok(updateCommand.includes(`.setName('${name}')`), `missing ${name} option`);
  }
  assert.match(updateCommand, /Date is generated|default: New Update Released!/i);
});
