// src/velocity.js: checkpoints by interpolation, channel / niche / expected curves,
// velocity score, views per subscriber, evergreen ratio, last-24 h VPH, age tiers,
// what works, topic gaps and the RSS lag diagnostic.
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../src/velocity.js');

const H = 3600e3;
const D = 24 * H;
const PUB = Date.UTC(2026, 10, 1, 15, 0, 0);

/** A video measured at the given hours with views = f(h). */
function vid(id, hours, f, extra = {}) {
  return { id, channel_id: extra.channel_id || 'UCa', published_at: extra.published_at || PUB, type: extra.type || 'video', points: hours.map((h) => ({ ts: (extra.published_at || PUB) + h * H, views: Math.round(f(h)) })), ...extra };
}

test('checkpoints: linear interpolation between measurements, publish = 0 views', () => {
  const v = vid('a', [0.5, 2, 4, 8, 20, 30, 50, 70, 160, 330, 700, 740], (h) => h * 100);
  const c = V.checkpoints(v);
  assert.equal(c[1], 100);
  assert.equal(c[3], 300);
  assert.equal(c[24], 2400);
  assert.equal(c[720], 72000);
  // First measurement at 1.5 h: 1 h comes from (0, 0) → (1.5 h, 150).
  assert.equal(V.checkpoints(vid('b', [1.5], (h) => h * 100))[1], 100);
});

test('checkpoints: unknown when the measurements are too far apart or missing', () => {
  // First seen 10 days after upload: nothing early is invented.
  const late = V.checkpoints(vid('late', [240, 250, 400, 740], (h) => 1000 + h));
  assert.equal(late[1], null);
  assert.equal(late[24], null);
  assert.equal(late[48], null);
  assert.notEqual(late[336], null); // between 250 h and 400 h: gap 150 ≤ 168
  assert.notEqual(late[720], null);
  // Not reached yet.
  assert.equal(V.checkpoints(vid('young', [1, 2, 5], (h) => h * 10))[12], null);
  // A measurement right at the checkpoint stands on its own even with no later one.
  assert.equal(V.checkpoints(vid('edge', [0.5, 6.1], (h) => h * 10))[6], 61);
});

test('series: unsorted, duplicates and junk are cleaned', () => {
  const s = V.series([{ ts: PUB + 2 * H, views: 20 }, { ts: PUB + H, views: 10 }, { ts: PUB + H, views: 12 }, { ts: PUB - 5 * H, views: 3 }, { ts: PUB + 3 * H, views: null }], PUB);
  assert.deepEqual(s.map((p) => [p.h, p.v]), [[0, 0], [1, 12], [2, 20]]);
});

test('channel curve, niche curve, expected curve with the 5-video fallback', () => {
  const hours = [0.5, 1, 2, 3, 5, 6, 8, 12, 20, 24, 30, 48, 60, 72];
  const own = [1, 2, 3].map((k) => vid('o' + k, hours, (h) => k * 100 * h));
  const cOwn = V.curve(own);
  assert.equal(cOwn.values[24], 4800);
  assert.equal(cOwn.n[24], 3);
  // Niche: two channels with different sizes share one shape once divided by their baseline.
  const niche = [
    { ...vid('n1', hours, (h) => 10 * h), baseline: 1000 },
    { ...vid('n2', hours, (h) => 1000 * h), baseline: 100000 },
    { ...vid('n3', hours, (h) => 20 * h), baseline: 1000 }
  ];
  const nc = V.nicheCurve(niche);
  assert.ok(Math.abs(nc.values[24] - 0.24) < 1e-9);
  // 3 own videos < 5: the expected curve comes from the niche, scaled to this channel's baseline.
  const exp = V.expectedCurve(cOwn, nc, 20000);
  assert.equal(exp[24].source, 'niche');
  assert.ok(Math.abs(exp[24].value - 4800) < 1e-6);
  // With 5 own videos it is the channel's own median.
  const own5 = [1, 2, 3, 4, 5].map((k) => vid('p' + k, hours, (h) => k * 100 * h));
  const exp5 = V.expectedCurve(V.curve(own5), nc, 20000);
  assert.equal(exp5[24].source, 'channel');
  assert.equal(exp5[24].value, 7200);
  assert.equal(exp5[720], null); // nobody reached 30 d
});

test('velocity score at the latest passed checkpoint, scoreAt, breakouts', () => {
  const hours = [0.5, 1, 2, 3, 5, 6, 8, 12, 20, 24, 30];
  const exp = {};
  V.CHECKPOINTS.forEach((h) => { exp[h] = { value: h * 100, source: 'channel', n: 9 }; });
  const fast = vid('fast', hours, (h) => h * 340);
  const now = PUB + 26 * H;
  const v = V.velocity(fast, exp, now);
  assert.equal(v.at, 24);
  assert.equal(v.label, '24h');
  assert.ok(Math.abs(v.score - 3.4) < 0.01);
  assert.ok(Math.abs(V.scoreAt(fast, exp, 6) - 3.4) < 0.01);
  const b = V.breakouts(fast, exp);
  assert.deepEqual(b.map((x) => x.at), [6, 24]);
  assert.equal(V.breakouts(fast, exp, { ratio: 4 }).length, 0);
  // Before the first checkpoint there is no score.
  assert.equal(V.velocity(vid('new', [0.2, 0.5], (h) => h * 100), exp, PUB + 0.6 * H), null);
  // expectedAt: log-time between checkpoints, null past the last one.
  assert.equal(Math.round(V.expectedAt(exp, 24)), 2400);
  assert.ok(V.expectedAt(exp, 36) > 2400 && V.expectedAt(exp, 36) < 4800);
});

test('views per subscriber at 48 h and evergreen vs spike', () => {
  const steady = vid('s', [1, 24, 46, 48, 50, 700, 740], (h) => (h <= 48 ? h * 100 : 4800 + (h - 48) * 30));
  assert.equal(V.viewsPerSub(steady, 12000), 0.4);
  const e = V.evergreen(steady);
  assert.ok(e.ratio > 4 && e.kind === 'evergreen');
  const spike = vid('k', [1, 24, 46, 48, 50, 700, 740], (h) => (h <= 48 ? h * 100 : 4800 + (h - 48)));
  assert.equal(V.evergreen(spike).kind, 'spike');
  assert.equal(V.evergreen(vid('y', [1, 20], (h) => h)), null);
});

test('last-24 h VPH from snapshots; lifetime VPH', () => {
  const pts = [{ ts: PUB + 20 * H, views: 2000 }, { ts: PUB + 40 * H, views: 4000 }, { ts: PUB + 60 * H, views: 5200 }];
  // 24 h before 60 h = 36 h → 2000 + 2000·16/20 = 3600 → (5200 − 3600) / 24.
  const r = V.vph24(pts, PUB, PUB + 61 * H);
  assert.ok(Math.abs(r.vph - 1600 / 24) < 1e-9);
  assert.equal(r.hours, 24);
  // Younger than a day: views ÷ age.
  assert.equal(V.vph24([{ ts: PUB + 5 * H, views: 500 }], PUB, PUB + 5 * H).vph, 100);
  // Stale: the newest reading is 7 h old.
  assert.equal(V.vph24(pts, PUB, PUB + 67 * H), null);
  assert.equal(V.lifetimeVph(4800, PUB, PUB + 48 * H), 100);
});

test('age tiers: 30 min → hourly → 6 h → daily → weekly; next measurement wakes after checkpoints', () => {
  const t = (ms, o) => V.ageTier(ms, o);
  assert.deepEqual(t(1 * H), { tier: 'h0-6', every: 30 * 60e3 });
  assert.deepEqual(t(1 * H, { fastStart: false }), { tier: 'h0-6', every: H });
  assert.deepEqual(t(10 * H), { tier: 'h6-48', every: H });
  assert.deepEqual(t(3 * D), { tier: 'd2-7', every: 6 * H });
  assert.deepEqual(t(10 * D), { tier: 'd7-30', every: D });
  assert.deepEqual(t(40 * D), { tier: 'd30+', every: 7 * D });
  // At 70 h (every 6 h) the 72 h checkpoint comes first: wake 5 min after it.
  assert.equal(V.nextMeasure(PUB, PUB + 70 * H).next_at, PUB + 72 * H + 5 * 60e3);
  // At 100 h nothing is in the way: +6 h.
  assert.equal(V.nextMeasure(PUB, PUB + 100 * H).next_at, PUB + 106 * H);
});

test('slope before / after a change', () => {
  const pts = [0, 12, 24, 36, 48].map((h) => ({ ts: PUB + h * H, views: h <= 24 ? h * 10 : 240 + (h - 24) * 40 }));
  const s = V.slopeAround(pts, PUB, PUB + 24 * H, 24);
  assert.equal(s.before, 10);
  assert.equal(s.after, 40);
});

test('what works: best weekday / block, lengths, patterns, words, formats', () => {
  const mk = (id, day, hour, score, title, type = 'video', duration = 700) => ({ id, channel_id: 'UC' + (id.length % 3), published_at: Date.UTC(2026, 10, 1 + day, hour), type, duration, title, score });
  // 2026-11-01 is a Sunday (day 0).
  const list = [
    mk('a', 2, 14, 3.0, 'XLOOKUP in 5 minutes'), mk('b', 2, 15, 2.6, 'Pivot table tricks you need'), mk('c', 9, 13, 2.8, 'XLOOKUP vs VLOOKUP'),
    mk('d', 4, 3, 0.5, 'my desk tour'), mk('e', 11, 4, 0.7, 'desk setup 2026'), mk('f', 5, 20, 1.0, 'Power Query basics', 'video', 1500),
    mk('g', 6, 20, 1.2, 'Excel shortcut #shorts', 'short', 40), mk('h', 7, 9, 0.9, 'Another shortcut', 'short', 30), mk('i', 3, 14, 2.0, 'XLOOKUP explained [2026]')
  ];
  const w = V.whatWorks(list, { minN: 2, minWordN: 2 });
  assert.equal(w.videos, 9);
  assert.equal(w.best_day.key, 2); // Tuesday
  assert.equal(w.best_block.key, 4); // 12:00–15:00 UTC
  assert.equal(w.lengths['10–20m'].n, 6);
  assert.ok(w.formats.short.n === 2 && w.formats.long.n === 7);
  assert.equal(w.words[0].word, 'xlookup');
  assert.ok(w.patterns.find((p) => p.id === 'number').n >= 3);
  // Local time: +3 h moves the 14:00 UTC uploads into the 15:00–18:00 block.
  assert.equal(V.whatWorks(list, { minN: 2, tzOffsetMin: 180 }).best_block.key, 5);
});

test('topic gaps: fast but rare words, one per example set', () => {
  const list = [];
  for (let i = 0; i < 30; i++) list.push({ id: 'v' + i, channel_id: 'UC' + (i % 4), title: 'Excel basics lesson ' + i, score: 1 });
  list.push({ id: 'g1', channel_id: 'UC1', title: 'Excel LAMBDA recursion', score: 3.2 }, { id: 'g2', channel_id: 'UC2', title: 'LAMBDA helper functions', score: 2.8 });
  list.push({ id: 'k1', channel_id: 'UC1', title: 'Gantt chart in Excel', score: 2.2, keywords: ['gantt'] }, { id: 'k2', channel_id: 'UC3', title: 'Project Gantt template', score: 2.4 });
  const g = V.topicGaps(list);
  assert.equal(g[0].word, 'lambda');
  assert.equal(g[0].n, 2);
  assert.equal(g[0].channels, 2);
  assert.ok(g.some((x) => x.word === 'gantt'));
  assert.ok(!g.some((x) => x.word === 'excel'));
  assert.ok(!g.some((x) => x.word === 'recursion' && x.examples.length === 1));
});

test('RSS lag: time the API needed to reach the RSS count; verdicts', () => {
  const rows = [];
  const pub = {};
  // 6 videos measured hourly by the API; RSS reports the count the API had 90 min earlier.
  for (let k = 0; k < 6; k++) {
    const id = 'vid' + k;
    pub[id] = PUB;
    for (let h = 1; h <= 30; h++) rows.push({ video_id: id, ts: PUB + h * H, views: h * 1000 * (k + 1), source: 'api' });
    for (let h = 3; h <= 30; h += 2) rows.push({ video_id: id, ts: PUB + h * H + 5 * 60e3, views: Math.round((h - 1.5) * 1000 * (k + 1)), source: 'rss' });
  }
  const r = V.rssLag(rows, pub);
  assert.equal(r.verdict, 'rss-lags');
  assert.ok(Math.abs(r.lag_min.median - 95) <= 1);
  assert.ok(r.young_lag_min.samples > 0);
  assert.ok(r.gap_pct.median > 0);
  // A fresh RSS feed (same counts within minutes): fine.
  const ok = rows.filter((x) => x.source === 'api').concat(rows.filter((x) => x.source === 'api').map((x) => ({ ...x, ts: x.ts + 10 * 60e3, source: 'rss' })));
  assert.equal(V.rssLag(ok, pub).verdict, 'rss-ok');
  // Too little data.
  assert.equal(V.rssLag(rows.slice(0, 5), pub).verdict, 'collecting');
});
