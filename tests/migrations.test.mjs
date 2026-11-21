// store.mjs migrations for YouTube niche tracking (docs/youtube-niche-plan.md 2.2, 3.1):
// an existing database keeps its data, the new tables appear, running again is harmless,
// and the api-retention-30d purge only touches other people's Data API rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store, MIGRATIONS, SCHEMA_VERSION } from '../mcp/store.mjs';

const home = () => mkdtempSync(join(tmpdir(), 'openoutlier-migrate-'));
const NEW_TABLES = ['tracked_channels', 'video_stats', 'video_meta_log', 'channel_stats', 'tracker_jobs', 'own_daily', 'own_video_daily', 'own_breakdowns'];
const tables = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);

/** A database as the previous release left it: the old tables only, with data, no schema_version. */
function oldDatabase(dir) {
  const db = new DatabaseSync(join(dir, 'openoutlier.db'));
  db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE accounts (id TEXT PRIMARY KEY, platform TEXT, profile TEXT, updated_at INTEGER);
    CREATE TABLE posts (account_id TEXT NOT NULL, code TEXT NOT NULL, data TEXT NOT NULL, views INTEGER, likes INTEGER, comments INTEGER, shares INTEGER, saves INTEGER, taken_at INTEGER, updated_at INTEGER NOT NULL, PRIMARY KEY (account_id, code));
    CREATE TABLE snapshots (account_id TEXT NOT NULL, code TEXT NOT NULL, seen_at INTEGER NOT NULL, views INTEGER, likes INTEGER, comments INTEGER, shares INTEGER, saves INTEGER, PRIMARY KEY (account_id, code, seen_at));`);
  db.prepare('INSERT INTO meta VALUES (?, ?)').run('syncId', JSON.stringify('keep-this-sync-id'));
  db.prepare('INSERT INTO meta VALUES (?, ?)').run('revision', '7');
  db.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)').run('yt/exceldemo', 'youtube', JSON.stringify({ channelId: 'UCdemoExcelChannel000000' }), 1);
  db.prepare('INSERT INTO posts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('yt/exceldemo', 'yTdemo00001', JSON.stringify({ code: 'yTdemo00001', platform: 'youtube', views: 1234 }), 1234, 10, 2, null, null, 1700000000000, 1);
  db.prepare('INSERT INTO snapshots VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('yt/exceldemo', 'yTdemo00001', 1700000000000, 1234, 10, 2, null, null);
  db.close();
}

test('an existing database gets the new tables and keeps every row', () => {
  const dir = home();
  oldDatabase(dir);
  const s = new Store(dir);
  for (const t of NEW_TABLES) assert.ok(tables(s.db).includes(t), t);
  assert.equal(s.getMeta('schema_version'), SCHEMA_VERSION);
  assert.equal(s.getMeta('syncId'), 'keep-this-sync-id');
  assert.equal(s.revision(), 7);
  const lib = s.readLibrary();
  assert.equal(lib.accounts['yt/exceldemo'].posts.yTdemo00001.views, 1234);
  assert.equal(lib.accounts['yt/exceldemo'].profile.channelId, 'UCdemoExcelChannel000000');
  assert.equal(s.history('yTdemo00001').length, 1);
  const st = s.stats();
  assert.deepEqual([st.accounts, st.posts, st.snapshots, st.tracked_channels, st.video_stats, st.schema_version], [1, 1, 1, 0, 0, SCHEMA_VERSION]);
  s.close();
});

test('migrations are idempotent: reopening, re-running and a lost schema_version change nothing', () => {
  const dir = home();
  const s = new Store(dir);
  s.addVideoStats([{ video_id: 'yTdemo00001', ts: 1000, views: 5, source: 'rss' }]);
  assert.equal(s.migrate(), SCHEMA_VERSION);
  s.close();
  const again = new Store(dir);
  assert.equal(again.videoStats('yTdemo00001').length, 1, 'rows survive a reopen');
  // A copy of the database whose meta row went missing: the steps run again without harm.
  again.db.prepare("DELETE FROM meta WHERE key = 'schema_version'").run();
  assert.equal(again.migrate(), SCHEMA_VERSION);
  assert.equal(again.videoStats('yTdemo00001').length, 1);
  // Every step is safe to run twice.
  for (const m of MIGRATIONS) m.up(again);
  again.addColumn('video_meta_log', 'title', 'TEXT'); // exists: no-op
  again.addColumn('video_meta_log', 'extra_test_col', 'TEXT');
  again.addColumn('video_meta_log', 'extra_test_col', 'TEXT');
  assert.ok(again.db.prepare('PRAGMA table_info(video_meta_log)').all().some((c) => c.name === 'extra_test_col'));
  again.close();
});

test('video_stats: sources are checked, the same video + time is stored once', () => {
  const s = new Store(home());
  const n = s.addVideoStats([
    { video_id: 'v1', ts: 10, views: 1, source: 'rss' },
    { video_id: 'v1', ts: 10, views: 2, source: 'api' }, // same instant: first wins
    { video_id: 'v1', ts: 20, views: 3, likes: 1, comments: 0, source: 'api' },
    { video_id: 'v1', ts: 30, views: 4, source: 'scraped' }, // not a known source
    null
  ]);
  assert.equal(n, 2);
  assert.deepEqual(s.videoStats('v1').map((r) => [r.ts, r.views, r.source]), [[10, 1, 'rss'], [20, 3, 'api']]);
  s.close();
});

test('purgeApiData (api-retention-30d) drops old Data API rows of other channels only', () => {
  const s = new Store(home());
  const now = Date.UTC(2026, 10, 21);
  const old = now - 40 * 864e5;
  const recent = now - 5 * 864e5;
  // My channel (mine = 1), mapped to a library account; a competitor (mine = 0).
  s.db.prepare('INSERT INTO tracked_channels (channel_id, account_id, niche, mine, added_at) VALUES (?, ?, ?, ?, ?)').run('UCmine', 'yt/handsonexcel', 'Excel', 1, old);
  s.db.prepare('INSERT INTO tracked_channels (channel_id, account_id, niche, mine, added_at) VALUES (?, ?, ?, ?, ?)').run('UCother', 'yt/rival', 'Excel', 0, old);
  s.db.prepare("INSERT INTO tracker_jobs (id, kind, video_id, channel_id, next_at) VALUES ('video:mineJob001', 'video', 'mineJob001', 'UCmine', 0)").run();
  s.mergePost('yt/handsonexcel', 'minePost01', { code: 'minePost01', platform: 'youtube', type: 'video', views: 10 }, { platform: 'youtube' });
  s.addVideoStats([
    { video_id: 'rivalVid01', ts: old, views: 1, source: 'api' },      // deleted
    { video_id: 'rivalVid01', ts: recent, views: 2, source: 'api' },   // too new
    { video_id: 'rivalVid01', ts: old + 1, views: 1, source: 'rss' },  // RSS stays
    { video_id: 'rivalVid01', ts: old + 2, views: 1, source: 'page' }, // page stays
    { video_id: 'mineJob001', ts: old, views: 9, source: 'api' },      // mine (tracker job)
    { video_id: 'minePost01', ts: old, views: 9, source: 'api' }       // mine (library post)
  ]);
  const day = (t) => new Date(t).toISOString().slice(0, 10);
  s.db.prepare("INSERT INTO channel_stats (channel_id, day, subs, source) VALUES ('UCother', ?, 100, 'api'), ('UCother', ?, 120, 'api'), ('UCmine', ?, 5, 'api')").run(day(old), day(recent), day(old));
  const r = s.purgeApiData(now, 30);
  assert.deepEqual(r, { video_stats: 1, channel_stats: 1 });
  assert.deepEqual(s.videoStats('rivalVid01').map((x) => x.source), ['rss', 'page', 'api']);
  assert.equal(s.videoStats('mineJob001').length, 1);
  assert.equal(s.videoStats('minePost01').length, 1);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM channel_stats WHERE channel_id = 'UCmine'").get().n, 1);
  assert.deepEqual(s.purgeApiData(now, 30), { video_stats: 0, channel_stats: 0 }, 'nothing left to do');
  s.close();
});
