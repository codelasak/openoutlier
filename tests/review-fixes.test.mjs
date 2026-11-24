// Review fixes (docs/youtube-niche-review.md, A1–A3): unchanged RSS readings collapse into runs
// (writer and migration 6) without changing curves or checkpoints, breakout checks run once per
// niche per tracker tick, and the niche model's memo uses a write counter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

process.env.OPENOUTLIER_HOME = mkdtempSync(join(tmpdir(), 'openoutlier-review-home-'));
delete process.env.OPENOUTLIER_YOUTUBE_API_KEY;
const { Store, collapseRssRuns, RSS_GAP_YOUNG, SCHEMA_VERSION } = await import('../mcp/store.mjs');
const { Tracker } = await import('../mcp/tracker.mjs');
const N = await import('../mcp/niche.mjs');
const V = createRequire(import.meta.url)('../src/velocity.js');

const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;
const T0 = Date.UTC(2026, 10, 1, 12, 0, 0);
const store = () => new Store(mkdtempSync(join(tmpdir(), 'openoutlier-review-')));

/** A young video read by RSS every 15 min for 3 days; RSS refreshes the count only every few hours (a step function), the API every hour. */
function readings(pub = T0, { days = 3, refreshH = 3 } = {}) {
  const views = (t) => Math.round(5000 * Math.sqrt(Math.max(0, t - pub) / D));
  const rows = [];
  for (let t = pub + 10 * MIN; t <= pub + days * D; t += 15 * MIN) {
    const stepped = pub + Math.floor((t - pub) / (refreshH * H)) * refreshH * H;
    rows.push({ video_id: 'yTreview001', ts: t, views: views(stepped), likes: Math.round(views(stepped) / 40), source: 'rss', published_at: pub });
    if ((t - pub) % H === 10 * MIN) rows.push({ video_id: 'yTreview001', ts: t + 1, views: views(t), likes: Math.round(views(t) / 40), source: 'api' });
  }
  return rows;
}

const pointsOf = (rows) => rows.filter((r) => r.views != null).map((r) => ({ ts: r.ts, views: r.views }));
const cpOf = (rows, pub = T0) => V.checkpoints({ published_at: pub, points: pointsOf(rows) });
/** Views at every quarter hour, linearly interpolated: the whole curve, not only the checkpoints. */
function curveOf(rows, pub = T0, days = 3) {
  const s = V.series(pointsOf(rows), pub);
  const out = [];
  for (let h = 0; h <= days * 24; h += 0.25) {
    let a = null; let b = null;
    for (const p of s) { if (p.h <= h) a = p; if (p.h >= h) { b = p; break; } }
    out.push(!a || !b ? null : a === b ? a.v : Math.round(a.v + (b.v - a.v) * (h - a.h) / (b.h - a.h)));
  }
  return out;
}

test('A1 writer: an unchanged RSS reading collapses into its run; curves and checkpoints stay the same', () => {
  const all = readings();
  const s = store();
  const before = s.statsRev();
  for (const r of all) s.addVideoStats([r]); // one RSS job at a time, as the tracker writes them
  const kept = s.videoStats('yTreview001');
  // RSS alone (a video without API measurements): most rows go.
  const onlyRss = all.filter((r) => r.source === 'rss').map((r) => ({ ...r, video_id: 'yTreviewRss' }));
  for (const r of onlyRss) s.addVideoStats([r]);
  const keptRss = s.videoStats('yTreviewRss');
  assert.ok(keptRss.length <= onlyRss.length / 3, `rss rows: ${keptRss.length} kept of ${onlyRss.length}`);
  assert.deepEqual(cpOf(keptRss), cpOf(onlyRss));
  assert.deepEqual(curveOf(keptRss), curveOf(onlyRss));
  assert.ok(kept.length < all.length, `with hourly API rows in between: ${kept.length} of ${all.length}`);
  assert.equal(kept.filter((r) => r.source === 'api').length, all.filter((r) => r.source === 'api').length, 'API rows are never collapsed');
  assert.deepEqual(cpOf(kept), cpOf(all), 'checkpoints unchanged');
  assert.deepEqual(curveOf(kept), curveOf(all), 'the interpolated curve is unchanged at every quarter hour');
  // No gap between kept rows is longer than the young-video gap (so every checkpoint stays "known").
  const ts = kept.map((r) => r.ts);
  for (let i = 1; i < ts.length; i++) assert.ok(ts[i] - ts[i - 1] <= RSS_GAP_YOUNG, `gap at ${i}`);
  // The latest reading is still the latest moment RSS looked.
  assert.equal(kept[kept.length - 1].ts, Math.max(...all.map((r) => r.ts)));
  assert.ok(s.statsRev() > before, 'new rows bump the stats revision');
  // A reading that equals the last one but not the one before starts a run (kept), the third moves it.
  const s2 = store();
  const r = (ts, views) => ({ video_id: 'yTreview002', ts, views, likes: 1, source: 'rss', published_at: T0 });
  assert.equal(s2.addVideoStats([r(T0 + H, 10)]), 1);
  assert.equal(s2.addVideoStats([r(T0 + H + 15 * MIN, 10)]), 1);
  assert.equal(s2.addVideoStats([r(T0 + H + 30 * MIN, 10)]), 1);
  const rev = s2.statsRev();
  assert.equal(s2.addVideoStats([r(T0 + H + 45 * MIN, 10)]), 0, 'replaces the middle row, adds nothing');
  assert.equal(s2.statsRev(), rev, 'a longer run does not invalidate the model');
  assert.deepEqual(s2.videoStats('yTreview002').map((x) => x.ts), [T0 + H, T0 + H + 30 * MIN, T0 + H + 45 * MIN], 'first and last two');
  // Old videos (> 30 days): at most about one reading a day while nothing changes.
  const s3 = store();
  const old = T0 - 90 * D;
  for (let t = T0; t <= T0 + 3 * D; t += 15 * MIN) s3.addVideoStats([{ video_id: 'yTreview003', ts: t, views: 777, likes: 7, source: 'rss', published_at: old }]);
  assert.ok(s3.videoStats('yTreview003').length <= 6, `old unchanged video: ${s3.videoStats('yTreview003').length} rows over 3 days`);
});

test('A1 migration 6: existing runs of equal RSS readings collapse, curves and checkpoints unchanged, idempotent', () => {
  const s = store();
  const all = readings();
  const old = T0 - 60 * D;
  const oldRows = [];
  for (let t = T0; t <= T0 + 4 * D; t += 15 * MIN) oldRows.push({ video_id: 'yTreviewOld', ts: t, views: 1000 + Math.floor((t - T0) / (2 * D)), likes: 3, source: 'rss' });
  // Rows as the old writer stored them: every reading.
  const ins = s.db.prepare('INSERT INTO video_stats (video_id, ts, views, likes, comments, source) VALUES (?, ?, ?, ?, NULL, ?)');
  for (const r of all.concat(oldRows)) ins.run(r.video_id, r.ts, r.views, r.likes, r.source);
  s.db.prepare("INSERT INTO tracked_videos (video_id, channel_id, published_at, first_seen, updated_at) VALUES ('yTreviewOld', 'UCx', ?, ?, ?), ('yTreview001', 'UCx', ?, ?, ?)")
    .run(old, T0, T0, T0, T0, T0);
  const countAll = s.db.prepare('SELECT COUNT(*) AS n FROM video_stats').get().n;
  const beforeNew = s.videoStats('yTreview001');
  const beforeOld = s.videoStats('yTreviewOld');
  // Run migration 6 again from version 5.
  s.setMeta('schema_version', 5);
  assert.equal(s.migrate(), SCHEMA_VERSION);
  const countAfter = s.db.prepare('SELECT COUNT(*) AS n FROM video_stats').get().n;
  assert.ok(countAfter < countAll * 0.5, `rows ${countAll} → ${countAfter}`);
  const afterNew = s.videoStats('yTreview001');
  assert.deepEqual(cpOf(afterNew), cpOf(beforeNew), 'young video: checkpoints unchanged');
  assert.deepEqual(curveOf(afterNew), curveOf(beforeNew), 'young video: curve unchanged');
  const afterOld = s.videoStats('yTreviewOld');
  assert.ok(afterOld.length <= 12, `old video: ${beforeOld.length} → ${afterOld.length} rows`);
  assert.deepEqual(curveOf(afterOld, old, 64).slice(-4 * 24 * 4), curveOf(beforeOld, old, 64).slice(-4 * 24 * 4), 'old video: same values over the 4 days');
  assert.equal(afterOld[afterOld.length - 1].ts, beforeOld[beforeOld.length - 1].ts, 'the latest reading stays');
  assert.equal(collapseRssRuns(s), 0, 'running it again deletes nothing');
});

/** Two channels in one niche, a young video each, served by a fake RSS feed. */
function feedFetch(c) {
  const xml = (cid, vid) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
<title>${cid}</title><entry><yt:videoId>${vid}</yt:videoId><yt:channelId>${cid}</yt:channelId><title>Video ${vid}</title>
<published>${new Date(c.t - 3 * H).toISOString()}</published><media:group><media:thumbnail url="https://i.ytimg.com/vi/${vid}/hqdefault.jpg"/>
<media:community><media:starRating count="10"/><media:statistics views="${1000 + Math.floor((c.t - T0) / H)}"/></media:community></media:group></entry></feed>`;
  return async (url) => {
    url = String(url);
    const m = url.match(/playlist_id=UU(?:LF|SH)([\w-]+)/) || url.match(/channel_id=UC([\w-]+)/);
    const cid = m ? 'UC' + m[1] : '';
    const short = url.includes('UUSH');
    const body = short ? '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>' : xml(cid, cid.endsWith('1') ? 'yTreviewA01' : 'yTreviewB01');
    return { ok: true, status: 200, text: async () => body, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => 'application/atom+xml' } };
  };
}

test('A2: breakout checks run once per niche per tick, after all RSS jobs', async () => {
  const s = store();
  const c = { t: T0, now: () => c.t };
  const ch = (i) => 'UCreviewChannel00000000' + i;
  const org = { folders: { Excel: { name: 'Excel' } }, niches: { folders: ['Excel'], tags: [] }, tracked: {} };
  org.tracked['yt/one'] = { on: true, channelId: ch(1), name: 'One', niche: 'Excel' };
  org.tracked['yt/two'] = { on: true, channelId: ch(2), name: 'Two', niche: 'Excel' };
  N.syncTracked(s, { accounts: {}, org }, { now: c.now(), random: () => 0 });
  const calls = [];
  const tr = new Tracker({
    store: s, now: c.now, random: () => 0, fetch: feedFetch(c), apiKey: () => null, ctx: { thumbTools: { ffmpeg: null, sips: null } },
    afterTick: { breakouts: (ctx, lists) => { calls.push(lists); return N.NICHE_AFTER_TICK.breakouts(ctx, lists); } }
  });
  c.t += 3 * MIN;
  const out = await tr.tick();
  const rssRan = out.ran.filter((id) => id.startsWith('rss:'));
  assert.equal(rssRan.length, 2, 'both RSS jobs ran');
  assert.equal(calls.length, 1, 'one breakout check for the tick');
  assert.deepEqual(calls[0].flat().sort(), ['yTreviewA01', 'yTreviewB01'], 'with every RSS job\'s young videos');
  assert.ok('breakouts' in out.after);
  // A job run by hand (no tracker) still checks right away.
  assert.equal(typeof N.NICHE_AFTER_TICK.breakouts, 'function');
});

test('A3: the niche model memo uses a write counter; read paths reuse a slightly stale model', () => {
  const s = store();
  const org = { folders: { Excel: { name: 'Excel' } }, niches: { folders: ['Excel'], tags: [] }, tracked: { 'yt/one': { on: true, channelId: 'UCreviewChannel000000001', name: 'One', niche: 'Excel' } } };
  N.syncTracked(s, { accounts: {}, org }, { now: T0, random: () => 0 });
  const m1 = N.loadModel(s, { niche: 'Excel', now: T0 });
  assert.equal(N.loadModel(s, { niche: 'Excel', now: T0 + 1000 }), m1, 'nothing written: memo hit');
  s.addVideoStats([{ video_id: 'yTsomething', ts: T0, views: 5, source: 'api' }]);
  const m2 = N.loadModel(s, { niche: 'Excel', now: T0 + 2000 });
  assert.notEqual(m2, m1, 'a new row invalidates it');
  s.addVideoStats([{ video_id: 'yTsomething', ts: T0 + 5000, views: 6, source: 'api' }]);
  assert.equal(N.loadModel(s, { niche: 'Excel', now: T0 + 6000, maxAge: 5 * MIN }), m2, 'a read path accepts a model up to maxAge old');
  assert.notEqual(N.loadModel(s, { niche: 'Excel', now: T0 + 7000 }), m2);
});
