// Every browser script parses: `npm test` doesn't load most UI files (panel.js, the views), so a
// syntax error there would otherwise pass the suite.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

test('every extension script parses', () => {
  const root = join(__dirname, '..');
  const files = ['src', 'dashboard', 'popup', 'dev'].flatMap((d) => readdirSync(join(root, d)).filter((f) => f.endsWith('.js')).map((f) => join(d, f)));
  assert.ok(files.length > 40);
  for (const f of files) assert.doesNotThrow(() => new vm.Script(readFileSync(join(root, f), 'utf8'), { filename: f }), f);
});
