// Phase 1, niche tracking on the bridge (mcp/niche.mjs, mcp/rss.mjs, mcp/thumbhash.mjs):
// RSS fixtures (long-form + Shorts), the tracking-list sync, the rss / video / channel-stats /
// backfill jobs through the real Tracker with a fake clock and fake YouTube, age-tier
// transitions, quota, title + thumbnail change detection, page stats from the extension,
// breakouts, and the queries behind the Niche page and the MCP tools.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

process.env.OPENOUTLIER_HOME = mkdtempSync(join(tmpdir(), 'openoutlier-niche-home-'));
delete process.env.OPENOUTLIER_YOUTUBE_API_KEY;
const here = dirname(fileURLToPath(import.meta.url));
const fx = (f) => readFileSync(join(here, '..', 'dev', 'youtube', 'niche', f), 'utf8');
const { Store } = await import('../mcp/store.mjs');
const { Tracker } = await import('../mcp/tracker.mjs');
const N = await import('../mcp/niche.mjs');
const R = await import('../mcp/rss.mjs');
const TH = await import('../mcp/thumbhash.mjs');
const SIM = await import('../dev/niche-sim.mjs');
const V = createRequire(import.meta.url)('../src/velocity.js');

const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;
const CID = 'UCdemoExcelChannel000001';
const MINE = 'UChandsOnExcelDemo000002';
const START = Date.UTC(2026, 10, 21, 12, 0, 0);
const KEY = 'AIza' + 'k'.repeat(35);

const clock = (t = START) => { const c = { t, now: () => c.t, advance: (ms) => { c.t += ms; } }; return c; };
const store = () => new Store(mkdtempSync(join(tmpdir(), 'openoutlier-niche-')));
const NO_TOOLS = { ffmpeg: null, sips: null }; // thumbnails: the SHA-1 fallback, no subprocesses

/** Fake YouTube: RSS feeds from the fixtures, videos.list with views growing over time, channels.list, thumbnails. */
function fakeYouTube(c, opts = {}) {
  const calls = [];
  const state = { thumb: 'image-v1', title: null, longXml: fx('rss-long.xml'), shortXml: fx('rss-shorts.xml') };
  const api = JSON.parse(fx('api-videos.json'));
  const pub = Object.fromEntries(api.items.map((it) => [it.id, Date.parse(it.snippet.publishedAt)]));
  const res = (status, body, type = 'application/json') => ({
    ok: status >= 200 && status < 300, status,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    arrayBuffer: async () => new TextEncoder().encode(String(body)).buffer, headers: { get: () => type }
  });
  return {
    calls, state,
    fetch: async (url) => {
      url = String(url);
      calls.push(url);
      if (url.includes('feeds/videos.xml')) {
        if (url.includes('UULF')) return res(200, state.title ? state.longXml.replaceAll('Pivot Tables for Beginners (2026)', state.title) : state.longXml, 'application/atom+xml');
        if (url.includes('UUSH')) return opts.noShorts ? res(404, 'not found') : res(200, state.shortXml, 'application/atom+xml');
      }
      if (url.includes('ytimg.com')) return res(200, state.thumb, 'image/jpeg');
      if (url.includes('/youtube/v3/videos')) {
        const ids = decodeURIComponent(/[?&]id=([^&]+)/.exec(url)[1]).split(',');
        const items = ids.filter((id) => !(opts.missing || []).includes(id)).map((id) => {
          const tpl = api.items.find((x) => x.id === id) || { ...api.items[0], id, snippet: { ...api.items[0].snippet, publishedAt: new Date(opts.published?.[id] ?? START - 40 * D).toISOString(), title: 'Video ' + id } };
          const p = pub[id] ?? opts.published?.[id] ?? START - 40 * D;
          const views = Math.round(Math.max(0, (c.now() - p) / H) * (opts.vph?.[id] ?? 100));
          return { ...tpl, id, statistics: { ...tpl.statistics, viewCount: String(views) } };
        });
        return res(200, { items });
      }
      if (url.includes('/youtube/v3/channels')) {
        const body = JSON.parse(fx('api-channels.json'));
        const ids = (/[?&]id=([^&]+)/.exec(url) || [])[1];
        if (ids) body.items = body.items.filter((it) => decodeURIComponent(ids).split(',').includes(it.id));
        else if (/forHandle=%40handsonexcel/i.test(url)) body.items = body.items.filter((it) => it.id === MINE);
        return res(200, body);
      }
      if (url.includes('/youtube/v3/playlistItems')) {
        const list = /playlistId=([^&]+)/.exec(url)[1];
        if (list.startsWith('UUSH')) return res(200, { items: [{ contentDetails: { videoId: 'yTnicheS001' } }] });
        return res(200, { items: ['yTnicheL001', 'yTnicheS001', 'yTnicheL009'].map((v) => ({ contentDetails: { videoId: v } })) });
      }
      return res(404, { error: { message: 'no route ' + url } });
    }
  };
}

function libWith(org, accounts = {}) { return { accounts, org }; }
const exampleOrg = () => ({
  folders: [{ id: 'f2', name: 'Excel' }],
  accounts: { 'yt/exceldemoacademy': { folder: 'f2', tags: [] }, 'yt/other': { folder: null, tags: [] } },
  niches: { folders: ['f2'], tags: [] },
  tracked: { 'yt/handsonexcel': { on: true, mine: true, channelId: MINE, name: 'Hands on Excel' } }
});
const exampleAccounts = () => ({ 'yt/exceldemoacademy': { posts: {}, profile: { channelId: CID, handle: 'exceldemoacademy', name: 'Excel Demo Academy', subscribers: 412000 } }, 'yt/other': { posts: {}, profile: { channelId: 'UCotherChannel0000000000' } } });

test('RSS: both fixture feeds parse (entities, views, likes, thumbnails, format)', () => {
  const long = R.parseFeed(fx('rss-long.xml'), 'video');
  assert.equal(long.channelId, CID);
  assert.equal(long.channelName, 'Excel Demo Academy');
  assert.equal(long.entries.length, 3);
  const e = long.entries[0];
  assert.equal(e.video_id, 'yTnicheL001');
  assert.equal(e.title, 'XLOOKUP & FILTER: 7 tricks you\'ll use every day');
  assert.equal(e.views, 48213);
  assert.equal(e.likes, 1843);
  assert.equal(e.published_at, Date.parse('2026-11-20T15:00:07Z'));
  assert.equal(e.thumb, 'https://i2.ytimg.com/vi/yTnicheL001/hqdefault.jpg');
  assert.equal(e.type, 'video');
  assert.match(e.description, /practice file/);
  const shorts = R.parseFeed(fx('rss-shorts.xml'), 'short');
  assert.deepEqual(shorts.entries.map((x) => [x.video_id, x.type, x.views]), [['yTnicheS001', 'short', 22950], ['yTnicheS002', 'short', 9120]]);
  assert.equal(shorts.entries[0].title, 'Ctrl+E does WHAT? 🤯 #excel #shorts');
  assert.deepEqual(R.feedUrls(CID), { long: 'https://www.youtube.com/feeds/videos.xml?playlist_id=UULFdemoExcelChannel000001', short: 'https://www.youtube.com/feeds/videos.xml?playlist_id=UUSHdemoExcelChannel000001' });
  assert.equal(R.feedUrls('nope'), null);
});

test('thumbnail hash: dHash, distance, BMP reading, SHA-1 fallback', async () => {
  const a = Array.from({ length: 72 }, (_, i) => (i * 37) % 256);
  const b = a.slice();
  b[0] = 255; b[10] = 0; // a small edit
  const c = a.map((x) => 255 - x); // a different image
  const ha = TH.dhash(a);
  assert.match(ha, /^[0-9a-f]{16}$/);
  assert.ok(TH.hamming(ha, TH.dhash(b)) <= 4);
  assert.ok(TH.hamming(ha, TH.dhash(c)) > 40);
  assert.equal(TH.changed('d:' + ha, 'd:' + TH.dhash(b)), false);
  assert.equal(TH.changed('d:' + ha, 'd:' + TH.dhash(c)), true);
  assert.equal(TH.changed('sha1:aa', 'd:' + ha), false, 'different methods: no claim');
  assert.equal(TH.changed('sha1:aa', 'sha1:bb'), true);
  // A 9×8 24-bit bottom-up BMP.
  const w = 9, h = 8, stride = Math.ceil(w * 3 / 4) * 4;
  const buf = Buffer.alloc(54 + stride * h);
  buf.write('BM', 0); buf.writeUInt32LE(buf.length, 2); buf.writeUInt32LE(54, 10); buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18); buf.writeInt32LE(h, 22); buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = a[y * 9 + x]; const i = 54 + (h - 1 - y) * stride + x * 3; buf[i] = buf[i + 1] = buf[i + 2] = v; }
  const g = TH.bmpGray(buf);
  assert.deepEqual([g.width, g.height], [9, 8]);
  assert.equal(TH.dhash(g.gray), ha);
  assert.match(await TH.hashImage(Buffer.from('not an image'), NO_TOOLS), /^sha1:[0-9a-f]{40}$/);
});

test('tracking list → tracked_channels and jobs; off the list → inactive, jobs gone; unknown id → resolve job', () => {
  const s = store();
  const r = N.syncTracked(s, libWith(exampleOrg(), exampleAccounts()), { now: START, random: () => 0 });
  assert.deepEqual([r.active, r.added, r.removed, r.unresolved], [2, 2, 0, []]);
  const rows = s.db.prepare('SELECT channel_id, account_id, niche, mine, active FROM tracked_channels ORDER BY channel_id').all();
  assert.deepEqual(rows.map((x) => ({ ...x })), [
    { channel_id: CID, account_id: 'yt/exceldemoacademy', niche: 'Excel', mine: 0, active: 1 },
    { channel_id: MINE, account_id: 'yt/handsonexcel', niche: 'Excel', mine: 1, active: 1 } // mine joins the niche it is compared with
  ]);
  const jobs = s.db.prepare('SELECT id, kind FROM tracker_jobs ORDER BY id').all().map((j) => j.id);
  assert.deepEqual(jobs, ['backfill:' + CID, 'backfill:' + MINE, 'rss:' + CID, 'rss:' + MINE]);
  // Again: nothing new.
  assert.equal(N.syncTracked(s, libWith(exampleOrg(), exampleAccounts()), { now: START }).added, 0);
  // The Track button turns the competitor off (it stays in the folder).
  const org = exampleOrg();
  org.tracked['yt/exceldemoacademy'] = { on: false };
  const r2 = N.syncTracked(s, libWith(org, exampleAccounts()), { now: START + H });
  assert.equal(r2.removed, 1);
  assert.equal(s.db.prepare('SELECT active FROM tracked_channels WHERE channel_id = ?').get(CID).active, 0);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM tracker_jobs WHERE channel_id = ?").get(CID).n, 0);
  // A tag niche with a channel whose UC id isn't known yet.
  const org3 = { folders: [], accounts: { 'yt/newchannel': { folder: null, tags: ['excel'] } }, niches: { folders: [], tags: ['excel'] } };
  const r3 = N.syncTracked(s, libWith(org3, { 'yt/newchannel': { posts: {} } }), { now: START + 2 * H, random: () => 0 });
  assert.deepEqual(r3.unresolved, ['yt/newchannel']);
  assert.equal(N.upsertJob.length, 4);
  assert.ok(s.db.prepare("SELECT 1 FROM tracker_jobs WHERE id = 'resolve:yt/newchannel'").get());
});

test('rss job: both feeds → rss measurements, new videos scheduled for the API, Shorts typed; quota untouched', async () => {
  const s = store();
  const c = clock();
  const yt = fakeYouTube(c);
  N.syncTracked(s, libWith(exampleOrg(), exampleAccounts()), { now: c.now(), random: () => 0 });
  const tr = new Tracker({ store: s, now: c.now, random: () => 0, fetch: yt.fetch, apiKey: () => null, ctx: { thumbTools: NO_TOOLS } });
  c.advance(3 * MIN);
  const out = await tr.tick();
  assert.ok(out.ran.includes('rss:' + CID));
  const stats = s.db.prepare("SELECT video_id, views, likes FROM video_stats WHERE source = 'rss' ORDER BY video_id").all().map((r) => [r.video_id, r.views, r.likes]);
  assert.deepEqual(stats, [['yTnicheL001', 48213, 1843], ['yTnicheL002', 31007, 920], ['yTnicheL003', 0, 0], ['yTnicheS001', 22950, 611], ['yTnicheS002', 9120, 208]]);
  const vids = s.db.prepare('SELECT video_id, type, title FROM tracked_videos WHERE channel_id = ? ORDER BY video_id').all(CID);
  assert.deepEqual(vids.map((v) => v.type), ['video', 'video', 'video', 'short', 'short']);
  const vjobs = s.db.prepare("SELECT video_id, next_at FROM tracker_jobs WHERE kind = 'video' ORDER BY video_id").all();
  assert.equal(vjobs.length, 5, 'one job per video (the fixture serves the same feed for both channels)');
  assert.ok(vjobs.every((j) => j.next_at - c.now() <= 2 * MIN), 'new videos are measured by the API right away');
  assert.equal(tr.quota().bridge, 0, 'RSS spends no quota');
  // Without a key the API kinds never run, RSS keeps going.
  c.advance(16 * MIN);
  const again = await tr.tick();
  assert.ok(again.ran.every((id) => id.startsWith('rss:')));
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM video_stats WHERE source = 'rss'").get().n, 10, '5 videos × 2 readings (same video + time once)');
  assert.ok(s.db.prepare('SELECT rss_checked_at FROM tracked_channels WHERE channel_id = ?').get(CID).rss_checked_at > START);
  // A channel without Shorts: 404 on UUSH is not an error.
  const s2 = store();
  N.syncTracked(s2, libWith(exampleOrg(), exampleAccounts()), { now: c.now(), random: () => 0 });
  const tr2 = new Tracker({ store: s2, now: c.now, random: () => 0, fetch: fakeYouTube(c, { noShorts: true }).fetch, apiKey: () => null, ctx: { thumbTools: NO_TOOLS } });
  c.advance(3 * MIN);
  const o2 = await tr2.tick();
  assert.deepEqual(o2.failed, []);
  assert.equal(s2.db.prepare("SELECT COUNT(*) AS n FROM tracked_videos WHERE type = 'short'").get().n, 0);
});

test('title and thumbnail changes go to video_meta_log (thumbnail by its hash, same URL)', async () => {
  const s = store();
  const c = clock();
  const yt = fakeYouTube(c);
  const org = exampleOrg();
  delete org.tracked;
  N.syncTracked(s, libWith(org, exampleAccounts()), { now: c.now(), random: () => 0 });
  const tr = new Tracker({ store: s, now: c.now, random: () => 0, fetch: yt.fetch, apiKey: () => null, ctx: { thumbTools: NO_TOOLS, thumbsPerRun: 10 } });
  c.advance(3 * MIN);
  await tr.tick();
  const log0 = s.db.prepare('SELECT ts, title, thumb_hash FROM video_meta_log WHERE video_id = ?').all('yTnicheL002');
  assert.equal(log0.length, 1);
  assert.match(log0[0].thumb_hash, /^sha1:/);
  // The creator renames the video, and later uploads a new thumbnail behind the same URL.
  yt.state.title = 'Pivot Tables: the ONE trick nobody shows you';
  c.advance(16 * MIN);
  await tr.tick();
  let log = s.db.prepare('SELECT title, thumb_hash FROM video_meta_log WHERE video_id = ? ORDER BY ts').all('yTnicheL002');
  assert.deepEqual(log.map((l) => l.title), ['Pivot Tables for Beginners (2026)', 'Pivot Tables: the ONE trick nobody shows you']);
  yt.state.thumb = 'image-v2';
  c.advance(7 * H); // past the 6 h thumbnail re-check of young videos (this one is 8 days old: daily)
  await tr.tick();
  log = s.db.prepare('SELECT title, thumb_hash FROM video_meta_log WHERE video_id = ? ORDER BY ts').all('yTnicheL001');
  assert.equal(log.length, 2, 'the 1-day-old video got a thumbnail change');
  assert.notEqual(log[0].thumb_hash, log[1].thumb_hash);
  // Phase 4: each version of a young video's thumbnail keeps a small snapshot, so the title history shows before / after.
  const snaps = s.db.prepare('SELECT thumb_snap FROM video_meta_log WHERE video_id = ? ORDER BY ts').all('yTnicheL001')
    .map((r) => r.thumb_snap && Buffer.from(r.thumb_snap.split(',')[1], 'base64').toString());
  assert.deepEqual(snaps, ['image-v1', 'image-v2']);
  assert.match(s.db.prepare('SELECT thumb_snap FROM video_meta_log WHERE video_id = ? ORDER BY ts DESC').get('yTnicheL002').thumb_snap, /^data:image\/jpeg;base64,/, 'a title change keeps the image it had');
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM video_meta_log WHERE video_id = ?').get('yTnicheL002').n, 2, 'the older one is re-checked daily, not yet');
  // title-history off: no thumbnail downloads.
  s.setMeta('features', { 'title-history': false });
  const before = yt.calls.filter((u) => u.includes('ytimg')).length;
  c.advance(25 * H);
  await tr.tick();
  assert.equal(yt.calls.filter((u) => u.includes('ytimg')).length, before);
});

test('video jobs: videos.list in batches of 50 (1 unit each), age tiers 30 min → 1 h → 6 h → 1 d → 7 d', async () => {
  const s = store();
  const c = clock();
  const published = {};
  const ids = [];
  for (let i = 0; i < 60; i++) { const id = ('yTbatch' + i).padEnd(11, 'x'); ids.push(id); published[id] = START - 40 * D; }
  const yt = fakeYouTube(c, { published });
  s.db.prepare("INSERT INTO tracked_channels (channel_id, account_id, niche, mine, added_at, active) VALUES (?, 'yt/exceldemoacademy', 'Excel', 0, ?, 1)").run(CID, START);
  const tr = new Tracker({ store: s, now: c.now, random: () => 0, fetch: yt.fetch, apiKey: () => KEY, ctx: { thumbTools: NO_TOOLS } });
  for (const id of ids) {
    s.db.prepare('INSERT INTO tracked_videos (video_id, channel_id, published_at, type, first_seen) VALUES (?, ?, ?, ?, ?)').run(id, CID, published[id], 'video', START);
    tr.schedule('video:' + id, { kind: 'video', video_id: id, channel_id: CID, published_at: published[id], next_at: START });
  }
  const out = await tr.tick();
  assert.equal(out.ran.filter((x) => x.startsWith('video:')).length, 60);
  assert.equal(yt.calls.filter((u) => u.includes('/youtube/v3/videos')).length, 2, '50 + 10');
  assert.equal(tr.quota().bridge, 2);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM video_stats WHERE source = 'api'").get().n, 60);
  assert.equal(tr.job('video:' + ids[0]).tier, 'd30+');
  assert.equal(tr.job('video:' + ids[0]).next_at, START + 7 * D);

  // One fresh upload, followed through its tiers.
  const s2 = store();
  const c2 = clock();
  const id = 'yTfresh0001';
  const pub = START;
  const yt2 = fakeYouTube(c2, { published: { [id]: pub } });
  s2.db.prepare("INSERT INTO tracked_channels (channel_id, account_id, niche, mine, added_at, active) VALUES (?, 'yt/x', 'Excel', 0, ?, 1)").run(CID, START);
  s2.db.prepare('INSERT INTO tracked_videos (video_id, channel_id, published_at, type, first_seen) VALUES (?, ?, ?, ?, ?)').run(id, CID, pub, 'video', START);
  const tr2 = new Tracker({ store: s2, now: c2.now, random: () => 0, fetch: yt2.fetch, apiKey: () => KEY, ctx: { thumbTools: NO_TOOLS } });
  tr2.schedule('video:' + id, { kind: 'video', video_id: id, channel_id: CID, published_at: pub, next_at: START });
  const seen = [];
  // Walk 40 days; jump straight to each next_at.
  for (let i = 0; i < 400; i++) {
    const j = tr2.job('video:' + id);
    if (j.next_at > pub + 40 * D) break;
    c2.t = Math.max(c2.t, j.next_at);
    await tr2.tick();
    const k = tr2.job('video:' + id);
    seen.push({ age: (c2.t - pub) / H, tier: k.tier, gap: (k.next_at - c2.t) / MIN });
  }
  const gapIn = (lo, hi) => [...new Set(seen.filter((x) => x.age >= lo && x.age < hi).map((x) => Math.round(x.gap)))];
  assert.deepEqual(gapIn(0, 5.4), [30], 'every 30 min in the first 6 h (fastStart)');
  assert.deepEqual(gapIn(6.1, 46), [60], 'hourly to 48 h');
  assert.ok(gapIn(49, 160).every((g) => g === 360 || g < 360), 'every 6 h to 7 days (shorter only to land right after a checkpoint)');
  assert.ok(gapIn(170, 700).every((g) => g <= 1440));
  assert.deepEqual(gapIn(722, 900), [7 * 24 * 60], 'weekly after 30 days');
  assert.deepEqual([...new Set(seen.map((x) => x.tier))], ['h0-6', 'h6-48', 'd2-7', 'd7-30', 'd30+']);
  // Every checkpoint got bracketed closely enough to be known.
  const v = { published_at: pub, points: s2.videoStats(id).map((p) => ({ ts: p.ts, views: p.views })) };
  const cp = V.checkpoints(v);
  assert.ok(V.CHECKPOINTS.every((h) => cp[h] != null), JSON.stringify(cp));
  // fastStart off: hourly from the start.
  s2.setMeta(N.SETTINGS_META, { fastStart: false });
  assert.equal(V.nextMeasure(pub, pub + H, N.nicheSettings(s2)).next_at, pub + 2 * H + 0);
});

test('quota: over the budget the batch waits for the Pacific day; gone videos stop after 3 misses', async () => {
  const s = store();
  const c = clock();
  const yt = fakeYouTube(c, { missing: ['yTgone00001'] });
  s.db.prepare("INSERT INTO tracked_channels (channel_id, account_id, niche, mine, added_at, active) VALUES (?, 'yt/x', 'Excel', 0, ?, 1)").run(CID, START);
  const tr = new Tracker({ store: s, now: c.now, random: () => 0, fetch: yt.fetch, apiKey: () => KEY, budget: 0 });
  tr.schedule('video:yTnicheL001', { kind: 'video', video_id: 'yTnicheL001', channel_id: CID, published_at: START - D, next_at: START });
  const out = await tr.tick();
  assert.deepEqual(out.deferred, ['video:yTnicheL001']);
  assert.equal(yt.calls.length, 0);
  tr.release();
  const tr2 = new Tracker({ store: s, now: c.now, random: () => 0, fetch: yt.fetch, apiKey: () => KEY });
  s.db.prepare('DELETE FROM tracker_jobs').run();
  tr2.schedule('video:yTgone00001', { kind: 'video', video_id: 'yTgone00001', channel_id: CID, published_at: START - D, next_at: START });
  for (let i = 0; i < 3; i++) { await tr2.tick(); c.advance(7 * D + MIN); }
  assert.equal(tr2.job('video:yTgone00001'), null);
});

test('channel-stats (daily, 50 per call) and backfill (All uploads via API → library + tracked videos, once)', async () => {
  const s = store();
  const c = clock();
  const yt = fakeYouTube(c, { published: { yTnicheL009: START - 90 * D } });
  N.syncTracked(s, libWith(exampleOrg(), exampleAccounts()), { now: c.now(), random: () => 0 });
  const tr = new Tracker({ store: s, now: c.now, random: () => 0, fetch: yt.fetch, apiKey: () => KEY, ctx: { thumbTools: NO_TOOLS } });
  tr.seed();
  c.advance(10 * MIN);
  const out = await tr.tick();
  assert.ok(out.ran.includes('channel-stats'));
  assert.ok(out.ran.includes('backfill:' + CID));
  const cs = s.db.prepare('SELECT channel_id, subs, views, videos FROM channel_stats ORDER BY channel_id').all().map((r) => ({ ...r }));
  assert.deepEqual(cs.find((r) => r.channel_id === CID), { channel_id: CID, subs: 412000, views: 48210334, videos: 623 });
  assert.equal(yt.calls.filter((u) => u.includes('/channels?part=snippet%2Cstatistics')).length, 1, 'both channels in one call');
  // Backfill: the uploads are in the library under the account, tracked, measured and scheduled; the job is gone.
  const lib = s.readLibrary();
  assert.deepEqual(Object.keys(lib.accounts['yt/exceldemoacademy'].posts).sort(), ['yTnicheL001', 'yTnicheL009', 'yTnicheS001']);
  assert.equal(lib.accounts['yt/exceldemoacademy'].posts.yTnicheS001.type, 'short');
  assert.equal(s.db.prepare("SELECT found_by FROM tracked_videos WHERE video_id = 'yTnicheL009'").get().found_by, 'backfill');
  assert.ok(s.db.prepare("SELECT 1 FROM tracker_jobs WHERE id = 'video:yTnicheL009'").get());
  assert.equal(tr.job('backfill:' + CID), null);
  assert.ok(s.db.prepare('SELECT backfilled_at FROM tracked_channels WHERE channel_id = ?').get(CID).backfilled_at);
  // Re-tracking later doesn't backfill again.
  const org = exampleOrg(); org.tracked['yt/exceldemoacademy'] = { on: false };
  N.syncTracked(s, libWith(org, exampleAccounts()), { now: c.now() });
  N.syncTracked(s, libWith(exampleOrg(), exampleAccounts()), { now: c.now() });
  assert.equal(tr.job('backfill:' + CID), null);
  assert.ok(s.db.prepare("SELECT 1 FROM tracker_jobs WHERE id = 'video:yTnicheL009'").get(), 'its videos are scheduled again');
});

test('resolve: a tracked @handle without a UC id is looked up once, then tracked', async () => {
  const s = store();
  const c = clock();
  const yt = fakeYouTube(c);
  const org = { folders: [], accounts: {}, niches: { folders: [], tags: [] }, tracked: { 'yt/handsonexcel': { on: true, mine: true } } };
  s.applySync({ full: true, accounts: {}, org });
  N.syncTracked(s, s.readLibrary(), { now: c.now(), random: () => 0 });
  const tr = new Tracker({ store: s, now: c.now, random: () => 0, fetch: yt.fetch, apiKey: () => KEY, ctx: { thumbTools: NO_TOOLS } });
  c.advance(2 * MIN);
  await tr.tick();
  const row = s.db.prepare('SELECT * FROM tracked_channels WHERE channel_id = ?').get(MINE);
  assert.ok(row && row.mine === 1 && row.account_id === 'yt/handsonexcel');
  assert.deepEqual(s.getMeta('niche_unresolved'), []);
});

test('page stats: exact counts the extension saw for tracked channels become source=page rows', () => {
  const s = store();
  N.syncTracked(s, libWith(exampleOrg(), exampleAccounts()), { now: START });
  const T0 = Date.now() - 5 * MIN;
  const post = (views, approx, seenAt) => ({ code: 'yTnicheL001', platform: 'youtube', type: 'video', owner: 'yt/exceldemoacademy', ownerId: CID, views, viewsApprox: approx, likes: 10, comments: 3, seenAt });
  s.applySync({ accounts: { 'yt/exceldemoacademy': { posts: { yTnicheL001: post(48000, true, T0) } } } });
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM video_stats WHERE source = 'page'").get().n, 0, 'rounded counts are not measurements');
  const r = s.applySync({ accounts: { 'yt/exceldemoacademy': { posts: { yTnicheL001: post(48213, false, T0 + 60e3) } } } });
  assert.equal(r.page_stats, 1);
  const row = s.db.prepare("SELECT ts, views, likes, comments FROM video_stats WHERE source = 'page'").get();
  assert.deepEqual({ ...row }, { ts: T0 + 60e3, views: 48213, likes: 10, comments: 3 }); // when the page showed it
  // A channel that isn't tracked: nothing.
  s.applySync({ accounts: { 'yt/other2': { posts: { yTzzzzzzzz1: { ...post(5000, false, T0), code: 'yTzzzzzzzz1', owner: 'yt/other2', ownerId: 'UCzzzzzzzzzzzzzzzzzzzzzz' } } } } });
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM video_stats WHERE source = 'page'").get().n, 1);
});

test('breakouts: ≥ 3× expected at 6 h → one alert (not twice); threshold setting; pending + ack', async () => {
  const s = store();
  const now = START;
  const sim = SIM.simulate(s, { now, seed: 11, weeks: 8 });
  const n = await SIM.markBreakouts(s, now, N.checkBreakouts);
  assert.ok(n >= 1);
  const alert = s.db.prepare('SELECT * FROM niche_alerts WHERE video_id = ?').get(sim.breakout);
  assert.ok(alert && alert.at_h === 6 && alert.score >= 3, JSON.stringify(alert));
  assert.equal(await SIM.markBreakouts(s, now, N.checkBreakouts), 0, 'the same breakout is not alerted twice');
  const pending = N.pendingAlerts(s, now);
  assert.ok(pending.some((p) => p.video_id === sim.breakout && p.title === 'LAMBDA just replaced half my formulas' && p.channel === 'Kenji Explains'));
  assert.equal(N.ackAlerts(s, pending, now), pending.length);
  assert.deepEqual(N.pendingAlerts(s, now), []);
  // A higher threshold: fewer alerts on fresh data.
  const s2 = store();
  SIM.simulate(s2, { now, seed: 11, weeks: 8 });
  s2.setMeta(N.SETTINGS_META, { breakoutRatio: 20 });
  assert.equal(await SIM.markBreakouts(s2, now, N.checkBreakouts), 0);
  // breakout-alerts off: no check.
  assert.equal(N.checkBreakouts({ store: s, now, flags: { 'breakout-alerts': false } }, [sim.breakout]), 0);
});

test('the Niche page and the MCP queries on ten simulated weeks', async () => {
  const s = store();
  const now = START;
  const sim = SIM.simulate(s, { now, seed: 7 });
  await SIM.markBreakouts(s, now, N.checkBreakouts);
  const p = N.nichePage(s, { now, tzOffsetMin: 180 });
  assert.equal(p.niche, 'Excel');
  assert.equal(p.channels.length, 16);
  assert.ok(p.channels.find((c) => c.mine).name === 'Hands on Excel');
  // This week's uploads ranked by velocity score, each with a sparkline and its expected curve.
  assert.ok(p.week.length > 20);
  const scores = p.week.map((v) => v.score).filter((x) => x != null);
  assert.deepEqual(scores, scores.slice().sort((a, b) => b - a));
  assert.ok(p.week[0].spark.points.length > 3 && p.week[0].spark.expected.length > 0);
  // Curves: shares rise to 100 % at 30 days; Shorts front-load more than long-form.
  assert.equal(p.curves.long.share[720], 1);
  assert.ok(p.curves.short.share[48] > p.curves.long.share[48]);
  // What works, gaps, changes, mine vs niche, growth, digest, lag.
  assert.ok(p.what_works.best_day && p.what_works.best_block);
  assert.ok(p.gaps.some((g) => ['lambda', 'copilot', 'gantt', 'checkboxes', 'regex'].includes(g.word)), JSON.stringify(p.gaps.map((g) => g.word)));
  assert.ok(p.changes.length > 0 && p.changes[0].changes[0].field === 'title');
  assert.ok(p.mine.videos.some((v) => v.id === sim.pivot));
  assert.ok(p.mine.videos[0].peers.views_per_sub_48h > 0);
  assert.equal(p.growth.length, 16);
  assert.ok(p.growth[0].series.length >= 60 && p.growth[0].delta_7d);
  assert.ok(p.breakouts.some((b) => b.id === sim.breakout));
  assert.equal(p.rss_lag.verdict, 'rss-ok');
  assert.ok(p.rss_lag.young_lag_min.median >= 20 && p.rss_lag.young_lag_min.median <= 30);
  assert.ok(p.digest_preview.totals.uploads > 0);

  const pulse = N.nichePulse(s, { days: 7, now });
  assert.equal(pulse.niche, 'Excel');
  assert.ok(pulse.ranked.length > 0 && pulse.breakouts.length > 0);
  const vv = N.videoVelocity(s, { video: 'https://www.youtube.com/watch?v=' + sim.breakout, now });
  assert.equal(vv.video.id, sim.breakout);
  assert.ok(vv.checkpoints.find((x) => x.at === '6h').score >= 3);
  assert.ok(vv.series.length > 5);
  assert.match(N.videoVelocity(s, { video: 'zzzzzzzzzzz', now }).error, /not tracked/);
  const g = N.channelGrowth(s, { channel: '@KenjiExplains', days: 30, now });
  assert.equal(g.channels[0].name, 'Kenji Explains');
  assert.ok(g.channels[0].series.length >= 28);
  assert.match(N.channelGrowth(s, { channel: 'nobody', now }).error, /not a tracked channel/);
  const b = N.breakoutList(s, { days: 7, now });
  assert.equal(b.threshold, 3);
  assert.ok(b.breakouts.length > 0 && !b.breakouts[0].spark);
  const rep = N.nicheReport(s, { now });
  assert.ok(rep.top.length > 0 && rep.week.match(/^\d{4}-\d{2}-\d{2}$/));
  const sum = N.trackingSummary(s, now);
  assert.equal(sum.channels, 16);
  assert.equal(sum.rss_lag.verdict, 'rss-ok');
});

test('weekly digest job: Monday, stores the past week', async () => {
  const s = store();
  const monday = Date.UTC(2026, 10, 23, 9, 0); // a Monday
  SIM.simulate(s, { now: monday, seed: 3, weeks: 3 });
  const tr = new Tracker({ store: s, now: () => monday, random: () => 0, apiKey: () => null });
  tr.schedule('digest', { kind: 'digest', next_at: monday });
  const out = await tr.tick();
  assert.ok(out.ran.includes('digest'));
  const row = s.db.prepare('SELECT week, data FROM niche_reports').get();
  assert.equal(row.week, N.weekOf(monday - 7 * D).week);
  assert.ok(JSON.parse(row.data).totals.uploads > 0);
  assert.ok(tr.job('digest').next_at > monday + 6 * D);
});
