// The Library's Top posts filters (dashboard/top-filters.js): ≥2× / ≥5× / ≥10×, the author's
// follower range, format and date range, over posts scored per account (X included).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const TF = require('../dashboard/top-filters.js');
const M = require('../src/metrics.js');
const X = require('../src/x.js');

const NOW = Date.UTC(2026, 10, 24, 12);
const DAY = 864e5;
const POSTS = [
  { code: 'a', platform: 'x', type: 'text', ratio: 12, takenAt: NOW - 2 * DAY, ownerFollowers: 85 },
  { code: 'b', platform: 'x', type: 'image', ratio: 5.5, takenAt: NOW - 20 * DAY, ownerFollowers: 18400 },
  { code: 'c', platform: 'x', type: 'video', ratio: 2.1, takenAt: NOW - 60 * DAY, ownerFollowers: 920000 },
  { code: 'd', platform: 'x', type: 'text', ratio: null, noViews: true, takenAt: NOW - 900 * DAY, ownerFollowers: 85 },
  { code: 'e', platform: 'instagram', type: 'reel', ratio: 3, takenAt: NOW - 5 * DAY, owner: 'ig.demo' },
  { code: 'f', platform: 'youtube', type: 'short', ratio: 0.4, owner: 'yt/demo' }
];
const codes = (r) => r.list.map((p) => p.code).join('');

test('parseCount reads 12k, 1.5M, 2,000; junk is null', () => {
  assert.deepEqual(['12k', '1.5M', '2,000', ' 850 ', '', 'abc', '-5', null, 3].map(TF.parseCount), [12000, 1500000, 2000, 850, null, null, null, null, 3]);
});

test('normalize: unknown presets fall back, a reversed range is swapped', () => {
  assert.deepEqual(TF.normalize({ min: 3, days: 14, fmin: '50k', fmax: '1k', format: 'text' }), { min: 0, fmin: 1000, fmax: 50000, format: 'text', days: 0 });
  assert.deepEqual(TF.normalize(null), TF.DEFAULTS);
  assert.equal(TF.isActive({}), false);
  assert.equal(TF.isActive({ min: 2 }), true);
  assert.equal(TF.isActive({ fmax: '10k' }), true);
});

test('thresholds keep posts at or above the preset; posts without a score drop out', () => {
  assert.equal(codes(TF.apply(POSTS, {}, { now: NOW })), 'abcdef');
  assert.equal(codes(TF.apply(POSTS, { min: 2 }, { now: NOW })), 'abce');
  assert.equal(codes(TF.apply(POSTS, { min: 5 }, { now: NOW })), 'ab');
  assert.equal(codes(TF.apply(POSTS, { min: 10 }, { now: NOW })), 'a');
});

test('follower range: unknown followers are hidden and counted; followersOf can look them up', () => {
  const r = TF.apply(POSTS, { fmin: '1k', fmax: '100k' }, { now: NOW });
  assert.equal(codes(r), 'b');
  assert.equal(r.hiddenNoFollowers, 2);
  const look = (p) => p.ownerFollowers != null ? p.ownerFollowers : ({ 'ig.demo': 40000, 'yt/demo': 7000 })[p.owner];
  assert.equal(codes(TF.apply(POSTS, { fmin: '1k', fmax: '100k' }, { now: NOW, followersOf: look })), 'bef');
  assert.equal(codes(TF.apply(POSTS, { fmax: 100 }, { now: NOW })), 'ad');
});

test('date range and format', () => {
  const r = TF.apply(POSTS, { days: 7 }, { now: NOW });
  assert.equal(codes(r), 'ae');
  assert.equal(r.hiddenNoDate, 1);
  assert.equal(codes(TF.apply(POSTS, { days: 90 }, { now: NOW })), 'abce');
  assert.equal(codes(TF.apply(POSTS, { format: 'text' }, { now: NOW })), 'ad');
  assert.equal(codes(TF.apply(POSTS, { format: 'text', min: 2, days: 30 }, { now: NOW })), 'a');
  assert.deepEqual(TF.formatsOf(POSTS).map((f) => [f.key, f.label, f.count]),
    [['text', 'Text', 2], ['image', 'Image', 1], ['reel', 'Reels', 1], ['short', 'Shorts', 1], ['video', 'Video', 1]]);
});

test('X fixture: scored per account, filtered and exported with the X columns', () => {
  const by = {};
  for (const op of ['UserOriginalsTimeline', 'UserRepliesTimeline', 'UserRepostsTimeline']) {
    for (const pg of JSON.parse(readFileSync(join(__dirname, '..', 'dev', 'x', op + '.json'), 'utf8'))) {
      X.parsePayload(pg.url, JSON.stringify(pg.body)).posts.forEach((p) => { (by[p.owner] = by[p.owner] || {})[p.code] = X.merge((by[p.owner] || {})[p.code], p); });
    }
  }
  const meta = JSON.parse(readFileSync(join(__dirname, '..', 'dev', 'x', 'meta.json'), 'utf8'));
  // One enrich per account (the per-format medians need the whole account), reposts left out as on the page.
  let all = [];
  Object.keys(by).forEach((u) => { all = all.concat(M.enrich(Object.values(by[u]), { now: meta.now }).filter((p) => M.xKind(p) !== 'repost')); });
  assert.ok(all.length > 20);
  const hits = TF.apply(all, { min: 2 }, { now: meta.now }).list;
  assert.ok(hits.length > 0 && hits.every((p) => p.ratio >= 2 && p.platform === 'x'));
  const ten = TF.apply(all, { min: 10 }, { now: meta.now }).list;
  assert.ok(ten.length <= hits.length);
  const csv = M.toTable(M.sortBy(hits, 'viralScore'), ',').split('\r\n');
  assert.deepEqual(csv[0].split(','), M.X_COLUMN_NAMES);
  assert.equal(csv.length, hits.length + 1);
  const tsv = M.toTable(hits, '\t');
  assert.ok(tsv.split('\r\n')[0].indexOf('\tx_median\t') !== -1);
  assert.ok(TF.formatsOf(all).some((f) => f.key === 'thread'));
});
