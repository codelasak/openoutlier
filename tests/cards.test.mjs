// Phase 3 on the bridge (mcp/cards.mjs): what the in-page badges and cards read — the latest
// exact counts and velocity of tracked videos, tracked channels' facts and baselines, the growth
// chart, the watch card's curve and last-24 h VPH, "according to Analytics" for own videos — and
// the HTTP routes the extension calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.OPENOUTLIER_HOME = mkdtempSync(join(tmpdir(), 'openoutlier-cards-home-'));
const { Store } = await import('../mcp/store.mjs');
const C = await import('../mcp/cards.mjs');

const H = 3_600_000;
const D = 24 * H;
const NOW = Date.UTC(2026, 10, 21, 12);
const CID = 'UCcardsTestChannel000001';
const OTHER = 'UCcardsTestChannel000002';

function seeded() {
  const s = new Store(mkdtempSync(join(tmpdir(), 'openoutlier-cards-')));
  s.db.prepare("INSERT INTO tracked_channels (channel_id, account_id, niche, mine, added_at, active, name, subs) VALUES (?, 'yt/cardstest', 'Excel', 0, ?, 1, 'Cards Test', 9000)").run(CID, NOW - 60 * D);
  const ins = s.db.prepare('INSERT INTO tracked_videos (video_id, channel_id, published_at, type, first_seen) VALUES (?, ?, ?, ?, ?)');
  const stats = [];
  // Six older videos: a normal curve (1,000 views at 24 h).
  for (let i = 0; i < 6; i++) {
    const id = ('cardOld' + i).padEnd(11, 'x');
    const pub = NOW - (40 - i * 4) * D;
    ins.run(id, CID, pub, 'video', pub);
    for (const h of [1, 3, 6, 12, 24, 48, 72, 168, 336, 720]) if (pub + h * H <= NOW) stats.push({ video_id: id, ts: pub + h * H, views: Math.round(1000 * Math.sqrt(h / 24)), likes: 10, comments: 1, source: 'api' });
  }
  // A young breakout: 3× the normal at 24 h, measured an hour ago.
  const young = 'cardYoungxx';
  const yp = NOW - 30 * H;
  ins.run(young, CID, yp, 'video', yp);
  for (const h of [1, 3, 6, 12, 24, 29]) stats.push({ video_id: young, ts: yp + h * H, views: Math.round(3000 * Math.sqrt(h / 24)), likes: 120, comments: 14, source: 'api' });
  // An untracked video with a page reading only.
  stats.push({ video_id: 'pageOnlyxxx', ts: NOW - 2 * H, views: 4242, likes: 42, comments: 4, source: 'page' });
  s.addVideoStats(stats);
  const cs = s.db.prepare('INSERT INTO channel_stats (channel_id, day, subs, views, videos) VALUES (?, ?, ?, ?, ?)');
  for (let d = 30; d >= 0; d--) cs.run(CID, new Date(NOW - d * D).toISOString().slice(0, 10), 9000 + (30 - d) * 10, 500000 + (30 - d) * 2000, 60);
  // An own video with Analytics days.
  s.db.prepare('INSERT INTO own_videos (video_id, channel_id, title, published_at, duration, type, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('ownVideoxxx', OTHER, 'Mine', NOW - 10 * D, 600, 'video', NOW);
  const od = s.db.prepare('INSERT INTO own_video_daily (video_id, day, metric, updated_at, channel_id) VALUES (?, ?, ?, ?, ?)');
  od.run('ownVideoxxx', '2026-11-12', JSON.stringify({ views: 300, minutes: 600, avg_pct: 50, likes: 10, comments: 2, subs_gained: 3 }), NOW, OTHER);
  od.run('ownVideoxxx', '2026-11-13', JSON.stringify({ views: 100, minutes: 120, avg_pct: 30, likes: 2, comments: 0, subs_gained: 1 }), NOW, OTHER);
  return s;
}

test('cardsLookup: latest exact counts for any measured video, velocity for tracked ones, channel facts', () => {
  const s = seeded();
  const r = C.cardsLookup(s, { videos: ['cardYoungxx', 'cardOld0xxx', 'pageOnlyxxx', 'unknownxxxx', 'bad id', 'cardYoungxx'], channels: [CID, OTHER, 'nope'], now: NOW });
  assert.deepEqual(Object.keys(r.videos).sort(), ['cardOld0xxx', 'cardYoungxx', 'pageOnlyxxx'], 'unknown and malformed ids are left out');
  const y = r.videos.cardYoungxx;
  assert.equal(y.tracked, true);
  assert.equal(y.views, Math.round(3000 * Math.sqrt(29 / 24)));
  assert.equal(y.published_at, NOW - 30 * H);
  assert.equal(y.velocity.hours, 24);
  assert.ok(y.velocity.score > 2.5 && y.velocity.score < 3.5, 'about 3× the channel\'s normal at 24 h: ' + y.velocity.score);
  const p = r.videos.pageOnlyxxx;
  assert.deepEqual([p.tracked, p.views, p.source, p.velocity], [false, 4242, 'page', null]);
  assert.deepEqual(Object.keys(r.channels), [CID], 'only tracked channels are known');
  const c = r.channels[CID];
  assert.deepEqual([c.tracked, c.niche, c.subs, c.views, c.videos], [true, 'Excel', 9300, 560000, 60]);
  assert.ok(c.baseline.long > 0);
  assert.equal(c.baseline.short, null);
  assert.deepEqual(C.cardsLookup(s, {}), { videos: {}, channels: {} });
  const many = Array.from({ length: 500 }, (_, i) => ('m' + i).padEnd(11, 'x'));
  assert.doesNotThrow(() => C.cardsLookup(s, { videos: many, now: NOW }), 'capped at ' + C.MAX_VIDEOS);
});

test('channelCard: the growth series of a tracked channel, nothing for others', () => {
  const s = seeded();
  const r = C.channelCard(s, { channel: CID, now: NOW });
  assert.equal(r.tracked, true);
  assert.equal(r.series.length, 31);
  assert.equal(r.delta_7d.subs, 70);
  assert.deepEqual(C.channelCard(s, { channel: OTHER, now: NOW }), { tracked: false });
  assert.ok(C.channelCard(s, { channel: 'x' }).error);
});

test('videoCard: last-24 h VPH, velocity and the curve against the channel\'s normal; Analytics for own videos', () => {
  const s = seeded();
  const v = C.videoCard(s, { video: 'cardYoungxx', now: NOW });
  assert.equal(v.tracked, true);
  assert.ok(v.vph24 && v.vph24.vph > 0);
  assert.equal(v.velocity.hours, 24);
  assert.ok(v.curve.length >= 5 && v.curve.every((p) => p.h <= 30));
  assert.ok(v.curve.find((p) => p.h === 24).views > v.curve.find((p) => p.h === 24).expected * 2);
  assert.equal(v.own, null);
  const own = C.videoCard(s, { video: 'ownVideoxxx', now: NOW });
  assert.equal(own.tracked, false);
  assert.deepEqual([own.own.days, own.own.views, own.own.watch_hours, own.own.avg_pct, own.own.subs_gained, own.own.through], [2, 400, 12, 45, 4, '2026-11-13'], 'avg % weighted by views');
  const page = C.videoCard(s, { video: 'pageOnlyxxx', now: NOW });
  assert.deepEqual([page.tracked, page.latest.views], [false, 4242]);
  assert.ok(C.videoCard(s, { video: '' }).error);
});
