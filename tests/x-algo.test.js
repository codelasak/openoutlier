// Phase 6 X algo signal (src/x-algo.js): the dated x-algorithm weights, Σ rate × weight, null
// without views, the "negative signals are not observable" note, newer stored weights, diffs.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/x-algo.js');

test('WEIGHTS: a versioned copy of param.rs with source and date', () => {
  const W = A.WEIGHTS;
  assert.equal(W.version, '2026-11-24');
  assert.match(W.source, /github\.com\/xai-org\/x-algorithm\/blob\/main\/home-mixer\/params\/param\.rs$/);
  assert.match(W.raw, /^https:\/\/raw\.githubusercontent\.com\/xai-org\/x-algorithm\/main\//);
  // docs/x-research.md 5
  assert.deepEqual([W.weights.favorite, W.weights.reply, W.weights.retweet, W.weights.quote, W.weights.shareViaCopyLink, W.weights.shareViaDm, W.weights.followAuthor],
    [0.708, 5.0, 1.0, 5.0, 20.0, 5.0, 4.0]);
  assert.deepEqual([W.weights.notInterested, W.weights.muteAuthor, W.weights.blockAuthor, W.weights.report], [-53.07, -58.8, -31.2, -234.0]);
  assert.equal(W.weights.bidirectionalReplyBoost, 15.0);
  assert.deepEqual(W.coldStart, { impressionThreshold: 200, followerCap: 50000, maxPostAgeSecs: 7200 });
  for (const k of Object.keys(W.weights)) assert.ok(A.PARAM_KEYS[k], 'every weight maps to a param.rs key: ' + k);
});

test('algoSignal: Σ observed rates × weights', () => {
  const s = A.algoSignal({ views: 10000, likes: 200, replies: 20, reposts: 10, quotes: 5 });
  const expected = 0.02 * 0.708 + 0.002 * 5 + 0.001 * 1 + 0.0005 * 5;
  assert.ok(Math.abs(s.score - expected) < 1e-12);
  assert.equal(s.per1k, Math.round(expected * 10000) / 10);
  assert.deepEqual(s.terms.map((t) => [t.signal, t.weightName, t.count, t.weight]), [
    ['likes', 'favorite', 200, 0.708], ['replies', 'reply', 20, 5], ['reposts', 'retweet', 10, 1], ['quotes', 'quote', 5, 5]
  ]);
  assert.equal(s.negativeObservable, false);
  assert.deepEqual(s.negativeSignals, ['notInterested', 'muteAuthor', 'blockAuthor', 'report', 'notDwelled']);
  assert.match(s.note.en, /not visible from outside/);
  assert.match(s.note.tr, /dışarıdan görülemez/);
  assert.equal(s.version, '2026-11-24');
});

test('algoSignal: null without views; strings and legacy field names are read', () => {
  assert.equal(A.algoSignal({ likes: 5 }), null);
  assert.equal(A.algoSignal({ views: null, likes: 5 }), null);
  assert.equal(A.algoSignal({ views: 0, likes: 5 }), null);
  assert.equal(A.algoSignal({ views: '', likes: 5 }), null);
  assert.equal(A.algoSignal(null), null);
  assert.equal(A.algoSignal({ views: 100 }), null, 'no counters at all');
  const s = A.algoSignal({ views: '1000', favorite_count: 10, reply_count: '2', retweet_count: 1 });
  assert.ok(Math.abs(s.score - (0.01 * 0.708 + 0.002 * 5 + 0.001)) < 1e-12);
  assert.deepEqual(s.missing, ['quotes']);
});

test('algoSignal: a newer stored weights object is used; a broken one falls back', () => {
  const newer = { ...A.WEIGHTS, version: '2026-12-01', weights: { ...A.WEIGHTS.weights, reply: 10 } };
  const s = A.algoSignal({ views: 1000, replies: 10 }, { weights: newer });
  assert.equal(s.version, '2026-12-01');
  assert.ok(Math.abs(s.score - 0.1) < 1e-12);
  assert.equal(A.algoSignal({ views: 1000, replies: 10 }, { weights: { version: 'x', weights: {} } }).version, '2026-11-24');
});

test('signalVsMedian: the post against the author\'s other posts', () => {
  const others = [1, 2, 3, 4, 5].map((i) => ({ views: 1000, likes: 10 * i }));
  const r = A.signalVsMedian({ views: 1000, likes: 60 }, others);
  assert.equal(r.n, 5);
  assert.ok(Math.abs(r.ratio - 2) < 1e-9, '60 likes vs the median 30');
  assert.equal(A.signalVsMedian({ views: 1000, likes: 60 }, others.slice(0, 4)), null, 'fewer than 5 others');
  assert.equal(A.signalVsMedian({ likes: 60 }, others), null);
});

test('diffWeights: changed, added and removed keys', () => {
  const b = { weights: { ...A.WEIGHTS.weights, reply: 13.5, newThing: 1 }, coldStart: { ...A.WEIGHTS.coldStart, followerCap: 100000 } };
  delete b.weights.vqv;
  assert.deepEqual(A.diffWeights(A.WEIGHTS, b), [
    { key: 'reply', from: 5, to: 13.5 },
    { key: 'vqv', from: 0, to: null },
    { key: 'newThing', from: null, to: 1 },
    { key: 'coldStart.followerCap', from: 50000, to: 100000 }
  ]);
  assert.deepEqual(A.diffWeights(A.WEIGHTS, A.WEIGHTS), []);
});
