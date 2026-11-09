// The SQLite library store: safety rules, history, JSON migration, backups.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../mcp/store.mjs';

const home = () => mkdtempSync(join(tmpdir(), 'reelscope-store-'));
const post = (code, views, extra = {}) => ({ code, owner: 'demo', type: 'reel', views, likes: Math.round(views / 20), comments: 3, takenAt: 1700000000000, seenAt: 1700000500000, ...extra });
const rec = (posts) => ({ posts: Object.fromEntries(posts.map((p) => [p.code, p])), updatedAt: Date.now() });

test('a full sync never deletes; an explicit null does', () => {
  const s = new Store(home());
  s.applySync({ full: true, accounts: { a: rec([post('AAAAA1', 100)]), b: rec([post('BBBBB1', 50)]) } });
  // A reinstalled extension with empty storage sends an empty full sync…
  s.applySync({ full: true, accounts: {} });
  assert.deepEqual(Object.keys(s.readLibrary().accounts).sort(), ['a', 'b']);
  // …or a full sync with only some accounts: the rest stay.
  s.applySync({ full: true, accounts: { a: rec([post('AAAAA1', 120)]) } });
  assert.deepEqual(Object.keys(s.readLibrary().accounts).sort(), ['a', 'b']);
  // Pressing Clear in the extension sends null in an incremental sync.
  s.applySync({ full: false, accounts: { b: null } });
  assert.deepEqual(Object.keys(s.readLibrary().accounts), ['a']);
  s.close();
});

test('posts missing from a later sync are kept', () => {
  const s = new Store(home());
  s.applySync({ accounts: { a: rec([post('AAAAA1', 1), post('AAAAA2', 2)]) } });
  s.applySync({ accounts: { a: rec([post('AAAAA2', 5)]) } });
  const posts = s.readLibrary().accounts.a.posts;
  assert.deepEqual(Object.keys(posts).sort(), ['AAAAA1', 'AAAAA2']);
  assert.equal(posts.AAAAA2.views, 5);
  s.close();
});

test('history: one snapshot per change, none when nothing changed', () => {
  const s = new Store(home());
  s.applySync({ accounts: { a: rec([post('AAAAA1', 100)]) } });
  s.applySync({ accounts: { a: rec([post('AAAAA1', 100)]) } }); // same numbers
  s.applySync({ accounts: { a: rec([post('AAAAA1', 250)]) } });
  const h = s.history('AAAAA1');
  assert.equal(h.length, 2);
  assert.deepEqual(h.map((r) => r.views), [100, 250]);
  assert.equal(h[0].seen_at, 1700000500000); // first sighting uses the extension's seenAt
  assert.equal(s.stats().snapshots, 2);
  s.close();
});

test('org, watches and mentions survive; readLibrary is cached per revision', () => {
  const s = new Store(home());
  const org = { folders: [{ id: 'f1', name: 'Excel' }], accounts: { a: { folder: 'f1', tags: ['x'] } } };
  s.applySync({ accounts: { a: rec([post('AAAAA1', 1)]) }, org, watches: [{ id: 'w1', query: 'excel' }], mentions: { items: { t3_x: { id: 't3_x' } }, read: {} } });
  const lib1 = s.readLibrary();
  assert.equal(s.readLibrary(), lib1); // cached
  assert.deepEqual(lib1.org, org);
  assert.equal(lib1.watches[0].id, 'w1');
  assert.ok(lib1.mentions.items.t3_x);
  s.applySync({ accounts: {} }); // org/watches not sent → kept
  const lib2 = s.readLibrary();
  assert.notEqual(lib2, lib1);
  assert.deepEqual(lib2.org, org);
  s.close();
});

test('migrates the old library.json once', () => {
  const h = home();
  writeFileSync(join(h, 'library.json'), JSON.stringify({ syncId: 'old-sync-id', accounts: { a: rec([post('AAAAA1', 7)]) }, org: { folders: [], accounts: {} } }));
  const s = new Store(h);
  assert.equal(s.readLibrary().accounts.a.posts.AAAAA1.views, 7);
  assert.equal(s.readLibrary().syncId, 'old-sync-id');
  assert.ok(!existsSync(join(h, 'library.json')) && existsSync(join(h, 'library.json.migrated')));
  s.close();
});

test('backupTo writes a consistent, readable copy', () => {
  const h = home();
  const s = new Store(h);
  s.applySync({ accounts: { a: rec([post('AAAAA1', 1), post('AAAAA2', 2)]) } });
  const target = join(h, 'copy.db');
  s.backupTo(target);
  const copy = new DatabaseSync(target, { readOnly: true });
  assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM posts').get().n, 2);
  copy.close();
  s.close();
});

test('backup.mjs: verified gzip copy, once a day unless --force', async () => {
  const { execFileSync } = await import('node:child_process');
  const { readdirSync, readFileSync } = await import('node:fs');
  const { gunzipSync } = await import('node:zlib');
  const h = home();
  const s = new Store(h);
  s.applySync({ accounts: { a: rec([post('AAAAA1', 1)]) } });
  s.close();
  const script = new URL('../mcp/backup.mjs', import.meta.url).pathname;
  const env = { ...process.env, REELSCOPE_HOME: h };
  execFileSync(process.execPath, [script, '--no-upload'], { env, stdio: 'pipe' });
  const files = readdirSync(join(h, 'backups')).filter((f) => f.endsWith('.db.gz'));
  assert.equal(files.length, 1);
  const restored = join(h, 'restored.db');
  writeFileSync(restored, gunzipSync(readFileSync(join(h, 'backups', files[0]))));
  const db = new DatabaseSync(restored, { readOnly: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM posts').get().n, 1);
  db.close();
  const status = JSON.parse(readFileSync(join(h, 'status.json'), 'utf8'));
  assert.equal(status.lastBackupOk, true);
  // Second run the same day is a no-op…
  const out = execFileSync(process.execPath, [script, '--no-upload'], { env, stdio: 'pipe', encoding: 'utf8' });
  assert.equal(out, '');
  // …unless forced.
  execFileSync(process.execPath, [script, '--no-upload', '--force'], { env, stdio: 'pipe' });
  assert.equal(readdirSync(join(h, 'backups')).filter((f) => f.endsWith('.db.gz')).length, 1); // same day → same file
});
