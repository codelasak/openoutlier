// OpenOutlier was ReelScope: new names first, former names still honoured.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { setting, dbFile } from '../mcp/env.mjs';
import { Store } from '../mcp/store.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'openoutlier-env-'));

test('OPENOUTLIER_* wins over the former REELSCOPE_*', () => {
  const keep = { ...process.env };
  try {
    process.env.REELSCOPE_PORT = '1111';
    delete process.env.OPENOUTLIER_PORT;
    assert.equal(setting('PORT'), '1111');
    process.env.OPENOUTLIER_PORT = '2222';
    assert.equal(setting('PORT'), '2222');
    process.env.OPENOUTLIER_PORT = '';
    assert.equal(setting('PORT'), '1111', 'an empty new value falls back');
  } finally { process.env = keep; }
});

test('database file: openoutlier.db, unless only a former reelscope.db exists', () => {
  const fresh = dir();
  assert.equal(dbFile(fresh), join(fresh, 'openoutlier.db'));
  const old = dir();
  writeFileSync(join(old, 'reelscope.db'), '');
  assert.equal(dbFile(old), join(old, 'reelscope.db'));
  writeFileSync(join(old, 'openoutlier.db'), '');
  assert.equal(dbFile(old), join(old, 'openoutlier.db'), 'once moved, the new name wins');
  const s = new Store(dir());
  assert.ok(s.file.endsWith('openoutlier.db'));
  s.close();
});

test('data folder: ~/.openoutlier, else a not-yet-moved ~/.reelscope', () => {
  const resolve = (home) => execFileSync(process.execPath, ['--input-type=module', '-e',
    `import { resolveHome } from ${JSON.stringify(new URL('../mcp/env.mjs', import.meta.url).href)}; console.log(resolveHome());`],
  { env: { PATH: process.env.PATH, HOME: home }, encoding: 'utf8' }).trim();
  const h = dir();
  assert.equal(resolve(h), join(h, '.openoutlier'));
  mkdirSync(join(h, '.reelscope'));
  assert.equal(resolve(h), join(h, '.reelscope'));
  mkdirSync(join(h, '.openoutlier'));
  assert.equal(resolve(h), join(h, '.openoutlier'));
});
