// Phase 6 X reach forecast (src/x-forecast.js): the rolling-median target, features, ridge,
// the time-based split (≥ 40 train, ≥ 20 test) and the "only when it beats the median" gate.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../src/x-forecast.js');

/** Deterministic PRNG (LCG). */
function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; }; }
const T0 = Date.UTC(2026, 0, 1);
/** n posts every 12–48 h; with signal, videos do 3× and quotes 0.5× the normal (±50 % noise). */
function gen(n, { signal = true, seed = 7 } = {}) {
  const r = rng(seed);
  const fm = ['text', 'video', 'image', 'quote'];
  let t = T0;
  const out = [];
  for (let i = 0; i < n; i++) {
    t += Math.floor(r() * 36 + 12) * 3600e3;
    const f = fm[Math.floor(r() * 4)];
    const noise = Math.exp((r() - 0.5) * 0.8);
    const lift = signal ? (f === 'video' ? 3 : f === 'quote' ? 0.5 : 1) : 1;
    out.push({ id: String(i), createdAt: t, views: Math.round(200 * lift * noise), format: f, text: 'post ' + i, quote: f === 'quote' });
  }
  return out;
}

test('samples: y = ln(views ÷ rolling median of the previous posts), oldest first', () => {
  const posts = [100, 200, 300, 400, 500, 600, 50, 1000].map((v, i) => ({ id: 'p' + i, createdAt: T0 + i * 3600e3, views: v, text: 'x' }));
  const shuffled = posts.slice().reverse();
  const s = F.samples(shuffled, { minPrev: 5, window: 3 });
  assert.equal(s.used, 8);
  assert.deepEqual(s.rows.map((r) => r.id), ['p5', 'p6', 'p7']);
  assert.equal(s.rows[0].baseline, 400, 'median of 300, 400, 500 (window 3)');
  assert.ok(Math.abs(s.rows[0].y - Math.log(600 / 400)) < 1e-12);
  assert.equal(s.rows[1].baseline, 500);
  assert.deepEqual(s.recent, [600, 50, 1000]);
});

test('samples: posts without views, replies and reposts are left out', () => {
  const posts = [
    { id: 'a', createdAt: T0, views: null }, { id: 'b', createdAt: T0 + 1, views: '120' }, { id: 'c', createdAt: T0 + 2, views: 0 },
    { id: 'd', createdAt: T0 + 3, views: 90, isReply: true }, { id: 'e', createdAt: T0 + 4, views: 90, is_repost: true }, { id: 'f', views: 50 }
  ];
  assert.equal(F.samples(posts).used, 1, 'only b: string views are read, the rest are dropped');
});

test('featurize: format, length bucket, hour, weekday, number / emoji / link, quote', () => {
  const at = Date.UTC(2026, 10, 25, 20, 30); // a Wednesday, 20:30 UTC
  const x = F.featurize({ text: 'Top 5 Excel tricks 🔥 https://handsonexcel.com', format: 'video', createdAt: at }, 0);
  const on = F.FEATURES.filter((_, i) => x[i]);
  assert.deepEqual(on, ['format:video', 'length:short', 'hour:evening', 'weekday:3', 'has:number', 'has:emoji', 'has:link']);
  const tr = F.featurize({ text: 'a'.repeat(200), quote: true, createdAt: at }, 240); // UTC+4 → Thursday 00:30
  assert.deepEqual(F.FEATURES.filter((_, i) => tr[i]), ['format:quote', 'length:long', 'hour:night', 'weekday:4', 'is:quote']);
  const link = F.featurize({ text: 'read this example.com/post', createdAt: at }, 0);
  assert.ok(link[F.FEATURES.indexOf('format:link')], 'no format + external link → link');
});

test('fitRidge: recovers a clear effect and keeps the intercept unpenalised', () => {
  const vid = F.FEATURES.indexOf('format:video');
  const rows = [];
  for (let i = 0; i < 60; i++) {
    const x = F.FEATURES.map(() => 0);
    if (i % 2) x[vid] = 1; else x[F.FEATURES.indexOf('format:text')] = 1;
    rows.push({ x, y: 0.2 + (i % 2 ? 1 : 0) });
  }
  const m = F.fitRidge(rows, 0.01);
  const pv = m.intercept + m.beta[vid];
  const pt = m.intercept + m.beta[F.FEATURES.indexOf('format:text')];
  assert.ok(Math.abs(pv - 1.2) < 0.01 && Math.abs(pt - 0.2) < 0.01);
});

test('train: too few posts → not shown, with how many are needed', () => {
  const r = F.train(gen(50));
  assert.equal(r.shown, false);
  assert.equal(r.reason, 'not-enough-posts');
  assert.equal(r.need, 60);
  assert.equal(r.have, 45, '50 posts − the first 5 that only feed the median');
  assert.ok(r.tr && r.en);
});

test('train: time-based split, ≥ 40 train and ≥ 20 test, newest are the test set', () => {
  const m = F.train(gen(70), { tzOffsetMinutes: 0 });
  assert.equal(m.shown, true);
  assert.equal(m.eval.train + m.eval.test, 65);
  assert.ok(m.eval.train >= 40 && m.eval.test >= 20);
  const s = F.samples(gen(70));
  assert.equal(m.eval.testFrom, s.rows[m.eval.train].at, 'test starts right after the last training post');
  assert.equal(m.eval.testTo, s.rows[s.rows.length - 1].at);
});

test('train + forecastDraft: a real effect beats the median and is shown', () => {
  const m = F.train(gen(90), { tzOffsetMinutes: 0 });
  assert.equal(m.shown, true);
  assert.ok(m.eval.mae < m.eval.baselineMae, 'beats the median on the test posts');
  assert.ok(m.eval.gain > 0.2);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(m)), 'the model is JSON-safe (cacheable)');
  const at = Date.UTC(2026, 10, 25, 9);
  const v = F.forecastDraft(m, { text: 'A new video about XLOOKUP', format: 'video', at });
  const q = F.forecastDraft(m, { text: 'A quote', format: 'quote', at });
  assert.equal(v.shown, true);
  assert.ok(v.ratio > 2 && v.ratio < 4.5, 'videos ~3× the median: ' + v.ratio);
  assert.ok(q.ratio < 0.8, 'quotes ~0.5×: ' + q.ratio);
  assert.ok(v.low <= v.views && v.views <= v.high);
  assert.ok(Math.abs(v.views - v.baseline * v.ratio) <= v.baseline * 0.01, 'views = baseline × ratio');
  assert.equal(v.drivers[0].feature, 'format:video');
  assert.ok(v.drivers[0].effect > 1);
  assert.ok(v.drivers.every((d) => d.tr && d.en));
  const newer = F.forecastDraft(m, { text: 'x', format: 'text', at }, { recent: [1000, 1000, 1000] });
  assert.equal(newer.baseline, 1000, 'newer views override the model\'s baseline');
});

test('train: no signal → the model does not beat the median → not shown', () => {
  const r = F.train(gen(90, { signal: false }), { tzOffsetMinutes: 0 });
  assert.equal(r.shown, false);
  assert.equal(r.reason, 'no-gain');
  assert.ok(r.eval.mae >= r.eval.baselineMae);
  assert.deepEqual(F.forecastDraft(r, { text: 'x' }), r, 'forecastDraft passes the refusal through');
  assert.equal(F.forecastDraft(null, { text: 'x' }).reason, 'no-model');
});

test('forecast: one call; minGain raises the bar', () => {
  const posts = gen(90);
  assert.equal(F.forecast(posts, { text: 'v', format: 'video', at: T0 }, { tzOffsetMinutes: 0 }).shown, true);
  assert.equal(F.forecast(posts, { text: 'v', format: 'video', at: T0 }, { tzOffsetMinutes: 0, minGain: 0.99 }).reason, 'no-gain');
});
