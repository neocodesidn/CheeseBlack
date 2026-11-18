'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRegisteredCommands, buildHelpPages } = require('../lib/command-groups');

test('registers active plugin commands as direct command roots', () => {
  const plugins = [{ name: 'a', commands: [{ name: 'verification', options: [] }, { name: 'script', options: [] }] }];
  assert.deepEqual(buildRegisteredCommands(plugins).map((c) => c.name), ['verification', 'script']);
});

test('rejects duplicate command roots', () => {
  assert.throws(() => buildRegisteredCommands([{ commands: [{ name: 'logs' }] }, { commands: [{ name: 'logs' }] }]), /duplikat/);
});

test('builds readable help pages from subcommands', () => {
  const pages = buildHelpPages([{ name: 'x', commands: [{ name: 'donation', description: 'Donasi', options: [{ type: 1, name: 'panel', description: 'Pasang panel', options: [] }] }] }]);
  assert.match(pages.join('\n'), /\/donation panel/);
});
