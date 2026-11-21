// Phase 3's numbers (src/yt-insights.js) and the card parsers (src/youtube.js parseCards /
// parseMetaTexts): VPH and its "≈", median / mean outliers, engagement, the yt_ad monetization
// check on fixture pages, channel sampling, feed filter predicates, the caches and the rate
// limiter, channel stats, labels in TR / EN; fixtures in dev/youtube/cards (make-cards-fixture.mjs).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const I = require('../src/yt-insights.js');
const Y = require('../src/youtube.js');

const H = 36e5;
const D = 864e5;
const NOW = Date.UTC(2026, 10, 21, 12);
const fx = (f) => readFileSync(join(__dirname, '..', 'dev', 'youtube', 'cards', f), 'utf8');
const fxJson = (f) => JSON.parse(fx(f));

test('VPH: views ÷ hours since publish, ≈ when the views are rounded or the date is relative', () => {
  const exact = I.vph({ views: 12000, viewsApprox: false, publishedAt: NOW - 24 * H, dateApprox: false }, NOW);
  assert.deepEqual(exact, { value: 500, approx: false });
  assert.equal(I.vph({ views: 12000, viewsApprox: true, publishedAt: NOW - 24 * H, dateApprox: false }, NOW).approx, true, 'rounded views');
  assert.equal(I.vph({ views: 12000, takenAt: NOW - 24 * H, dateApprox: true }, NOW).approx, true, '"1 day ago"');
  assert.equal(I.vph({ views: 12000, takenAt: NOW - 24 * H }, NOW).approx, true, 'an unknown date kind counts as approximate');
  assert.equal(I.vph({ views: 300, publishedAt: NOW - 5 * 60000, dateApprox: false }, NOW).value, 300, 'the first hour counts as one hour');
  assert.equal(I.vph({ views: 300, publishedAt: NOW + H, dateApprox: false }, NOW).value, 300, 'a clock a bit ahead never divides by ≤ 0');
  assert.equal(I.vph({ views: null, publishedAt: NOW - H }, NOW), null);
  assert.equal(I.vph({ views: 5 }, NOW), null);
  assert.equal(I.vph(null, NOW), null);
});

test('outlier: the saved channel\'s median per format first, else the channels.list mean, labelled', () => {
  const posts = [];
  for (let i = 0; i < 8; i++) posts.push({ type: 'video', views: 1000 * (i + 1), takenAt: NOW - (10 + i) * D });
  for (let i = 0; i < 5; i++) posts.push({ type: 'short', views: 20000, takenAt: NOW - (10 + i) * D });
  posts.push({ type: 'video', views: 1e9, takenAt: NOW - 2 * H }, { type: 'video', views: 1e9, pinned: true, takenAt: NOW - 100 * D });
  const lib = I.libraryBaseline(posts, NOW);
  assert.equal(lib.long.median, 4500, 'videos under 72 h and pinned ones are left out');
  assert.equal(lib.long.n, 8);
  assert.equal(lib.short.median, 20000);
  const ch = { views: 6_000_000, videos: 400 }; // mean 15,000

  const med = I.outlier(9000, 'video', 'median', lib, ch);
  assert.equal(med.basis, 'median');
  assert.equal(med.source, 'library');
  assert.equal(med.value, 2);
  assert.equal(I.outlier(40000, 'short', 'median', lib, ch).value, 2, 'Shorts against Shorts');

  const mean = I.outlier(30000, 'video', 'mean', lib, ch);
  assert.deepEqual([mean.basis, mean.source, mean.value], ['mean', 'channel', 2], 'NexLev: total views ÷ video count');
  const unsaved = I.outlier(30000, 'video', 'median', null, ch);
  assert.deepEqual([unsaved.basis, unsaved.source], ['mean', 'channel'], 'no saved channel: the mean stands in');
  const fewSaved = I.libraryBaseline(posts.slice(0, 3), NOW);
  assert.equal(fewSaved.long.median, null, 'fewer than 5 saved videos: no median');
  assert.equal(I.outlier(30000, 'video', 'median', fewSaved, null), null);
  const libMean = I.outlier(9000, 'video', 'mean', lib, null);
  assert.deepEqual([libMean.basis, libMean.source, libMean.value], ['mean', 'library', 9000 / 4500]);
  assert.equal(I.outlier(null, 'video', 'median', lib, ch), null);
  assert.equal(I.channelMean(100, 0), null);
});

test('engagement: (likes + comments) ÷ views × 100, capped at 100', () => {
  assert.equal(I.engagement(13398, 234, 801352).toFixed(2), '1.70');
  assert.equal(I.engagement(50, 80, 100), 100);
  assert.equal(I.engagement(10, null, 1000), 1);
  assert.equal(I.engagement(null, null, 1000), null, 'no counts: unknown, not 0 %');
  assert.equal(I.engagement(5, 5, 0), null);
});

test('monetization: NexLev\'s yt_ad marker on watch pages, music videos and non-pages apart', () => {
  assert.deepEqual(I.monetizationFromHtml(fx('watch-monetized.html')), { state: 'yes', reason: 'yt_ad' });
  assert.deepEqual(I.monetizationFromHtml(fx('watch-not-monetized.html')), { state: 'no', reason: 'no-yt_ad' });
  assert.equal(I.monetizationFromHtml(fx('watch-music.html')).state, 'music', 'labels monetize music: says nothing about the channel');
  assert.deepEqual(I.monetizationFromHtml(fx('watch-consent.html')), { state: 'unknown', reason: 'consent' });
  assert.equal(I.monetizationFromHtml('').state, 'unknown');
  assert.equal(I.monetizationFromHtml('<html>hello</html>').state, 'unknown');
  assert.equal(I.monetizationFromHtml('var ytInitialPlayerResponse = {"playabilityStatus":{"status":"ERROR"}}').state, 'unknown');
  assert.equal(I.YT_AD, '[{"key":"yt_ad","value":"');
  // The marker has to be the first key of a params list (NexLev's exact string).
  assert.equal(I.monetizationFromHtml('var ytInitialPlayerResponse = {"videoDetails":{},"x":[{"key":"a","value":"1"},{"key":"yt_ad","value":"1"}]}').state, 'no');
});

test('channel sampling: index 0, 25 %, 50 %, 75 %, last; long-form only; verdicts', () => {
  assert.deepEqual(I.sampleIndices(0), []);
  assert.deepEqual(I.sampleIndices(1), [0]);
  assert.deepEqual(I.sampleIndices(2), [0, 1]);
  assert.deepEqual(I.sampleIndices(5), [0, 1, 2, 3, 4]);
  assert.deepEqual(I.sampleIndices(9), [0, 2, 4, 6, 8]);
  assert.deepEqual(I.sampleIndices(100), [0, 24, 49, 74, 99]);
  const posts = [];
  for (let i = 0; i < 20; i++) posts.push({ code: ('vid' + i).padEnd(11, 'x'), type: i % 4 === 0 ? 'short' : 'video', takenAt: NOW - i * D });
  posts.push({ code: 'membersxxxx', type: 'video', membersOnly: true, takenAt: NOW }, { code: 'bad' });
  const s = I.sampleVideos(posts);
  assert.equal(s.ids.length, 5);
  assert.equal(s.shortsOnly, false);
  assert.ok(s.ids.every((id) => posts.find((p) => p.code === id).type === 'video'));
  assert.equal(s.ids[0], 'vid1xxxxxxx', 'newest long-form first');
  assert.equal(s.ids[4], 'vid19xxxxxx', 'oldest last');
  assert.ok(!s.ids.includes('membersxxxx'), 'members-only pages show no ads to the public');
  assert.deepEqual(I.sampleVideos([{ code: 'shortxxxxxx', type: 'short' }]), { ids: [], shortsOnly: true });
  assert.deepEqual(I.sampleVideos([]), { ids: [], shortsOnly: false });

  assert.equal(I.channelVerdict(['no', 'no', 'yes']).state, 'yes', 'one ad is enough');
  assert.equal(I.channelVerdict(['no', 'music', 'no']).state, 'no');
  assert.equal(I.channelVerdict(['music', 'music']).state, 'music');
  assert.equal(I.channelVerdict(['unknown', 'unknown']).state, 'unknown');
  assert.deepEqual(I.channelVerdict(['yes', 'unknown']), { state: 'yes', checked: 1, yes: 1 });
});

test('feed filters: each predicate, Shorts and length, missing data fails and is reported', () => {
  const base = { outlier: 3, vph: 120, duration: 600, views: 50000, publishedAt: NOW - 3 * D, subs: 10000, type: 'video' };
  const m = (f, x = base) => I.matchItem(x, Object.assign(I.defaultFilters(), f), NOW);
  assert.equal(I.activeFilters(I.defaultFilters()), 0);
  assert.equal(I.activeFilters({ minOutlier: 2, length: 'under4', noShorts: true, minVph: 0 }), 3);
  assert.equal(m({}).ok, true);
  assert.equal(m({ minOutlier: 2 }).ok, true);
  assert.equal(m({ minOutlier: 4 }).ok, false);
  assert.equal(m({ minVph: 100 }).ok, true);
  assert.equal(m({ minVph: 200 }).ok, false);
  assert.equal(m({ minViews: 50000 }).ok, true);
  assert.equal(m({ maxAgeDays: 7 }).ok, true);
  assert.equal(m({ maxAgeDays: 1 }).ok, false);
  assert.equal(m({ length: '4to20' }).ok, true);
  assert.equal(m({ length: 'over20' }).ok, false);
  assert.equal(m({ length: 'under4' }).ok, false);
  assert.equal(m({ minViewsPerSub: 5 }).ok, true, '50,000 views ÷ 10,000 subs = 5');
  assert.equal(m({ minViewsPerSub: 6 }).ok, false);
  const short = Object.assign({}, base, { type: 'short', duration: 40 });
  assert.equal(m({ noShorts: true }, short).ok, false);
  assert.equal(m({ length: 'under4' }, short).ok, true, 'a Short is under 4 minutes');
  assert.equal(m({ length: 'over20' }, short).ok, false);
  const unknown = m({ minOutlier: 2, minViewsPerSub: 1 }, { views: 100, type: 'video' });
  assert.deepEqual(unknown, { ok: false, missing: ['outlier', 'subs'] });
  assert.deepEqual(m({ minOutlier: 2 }, Object.assign({}, base, { outlier: 0.5 })).missing, [], 'known and too low is not "missing"');
});

test('caches: TTL, newest kept under the cap, expired entries dropped on write', () => {
  let map = {};
  map = I.cachePut(map, 'a', { x: 1 }, 1000, NOW, 3);
  map = I.cachePut(map, 'b', null, 1000, NOW + 10, 3);
  assert.deepEqual(I.cacheGet(map, 'a', 1000, NOW + 500), { x: 1 });
  assert.equal(I.cacheGet(map, 'b', 1000, NOW + 500), null, 'a cached "no such channel" is null, not a miss');
  assert.equal(I.cacheGet(map, 'a', 1000, NOW + 1001), undefined, 'expired');
  assert.equal(I.cacheGet(map, 'zz', 1000, NOW), undefined);
  map = I.cachePut(map, 'c', 3, 1000, NOW + 20, 3);
  map = I.cachePut(map, 'd', 4, 1000, NOW + 30, 3);
  assert.deepEqual(Object.keys(map).sort(), ['b', 'c', 'd'], 'the oldest goes over the cap');
  map = I.cachePut(map, 'e', 5, 1000, NOW + 1015, 10);
  assert.deepEqual(Object.keys(map).sort(), ['c', 'd', 'e'], 'expired ones are dropped');
  assert.equal(I.cacheGet({ a: { v: 1 } }, 'a', 1000, NOW), undefined, 'malformed entries are misses');
});

test('rate limiter: at most 10 a minute, serial, on a fake clock', async () => {
  assert.equal(I.waitFor([], NOW, 10, 60000), 0);
  const ten = Array.from({ length: 10 }, (_, i) => NOW - 50000 + i * 1000);
  assert.equal(I.waitFor(ten, NOW, 10, 60000), 10000, 'the oldest of the ten leaves the window in 10 s');
  assert.equal(I.waitFor(ten.slice(1), NOW, 10, 60000), 0);
  assert.equal(I.waitFor([NOW - 70000], NOW, 1, 60000), 0, 'old events don\'t count');

  let t = NOW;
  const starts = [];
  const lim = I.limiter({ max: 10, windowMs: 60000, now: () => t, sleep: async (ms) => { t += ms; } });
  const order = [];
  const all = [];
  for (let i = 0; i < 25; i++) all.push(lim.run(async () => { starts.push(t); order.push(i); t += 200; return i; }));
  const out = await Promise.all(all);
  assert.deepEqual(out, order, 'one at a time, in order');
  for (let i = 10; i < starts.length; i++) assert.ok(starts[i] - starts[i - 10] >= 60000, 'never 11 inside one minute (' + i + ')');
  assert.ok(starts[24] - starts[0] < 3 * 60000, 'and not slower than it has to be');
  // A failing call doesn't stop the queue.
  const bad = lim.run(async () => { throw new Error('boom'); });
  await assert.rejects(bad, /boom/);
  assert.equal(await lim.run(async () => 'next'), 'next');
});

test('channel stats: age, totals, mean (channel) vs mean (saved), median, uploads per month, length, Shorts', () => {
  const posts = [];
  for (let i = 0; i < 12; i++) posts.push({ type: 'video', views: 1000 + i * 1000, duration: 600 + i * 60, takenAt: NOW - i * 10 * D });
  posts.push({ type: 'short', views: 99999, duration: 30, takenAt: NOW - 5 * D });
  const info = { views: 2_000_000, videos: 100, publishedAt: NOW - 1000 * D, country: 'TR' };
  const s = I.channelStats(posts, info, NOW);
  assert.equal(s.ageDays, 1000);
  assert.equal(s.totalViews, 2_000_000);
  assert.equal(s.meanViews, 20000);
  assert.equal(s.meanFrom, 'channel');
  assert.equal(s.medianViews, 6500, 'long-form median when there are 5+');
  assert.equal(s.uploadsFrom, 'recent');
  assert.equal(Math.round(s.uploadsPerMonth * 100) / 100, Math.round(11 / (90 / 30.44) * 100) / 100, '11 uploads (10 videos + 1 Short) in the last 90 days');
  assert.equal(s.avgLength, 930);
  assert.equal(s.hasShorts, true);
  assert.equal(s.country, 'TR');
  const bare = I.channelStats(posts.slice(0, 3), null, NOW);
  assert.equal(bare.ageDays, null);
  assert.equal(bare.meanFrom, 'saved');
  assert.equal(bare.medianViews, null, 'under 5 saved videos');
  assert.equal(bare.uploadsFrom, 'saved');
  assert.equal(bare.hasShorts, null, 'no Shorts saved: unknown, not "no"');
  const lifetime = I.channelStats([], { videos: 120, publishedAt: NOW - 365.25 * D }, NOW);
  assert.equal(lifetime.uploadsFrom, 'lifetime');
  assert.equal(Math.round(lifetime.uploadsPerMonth), 10);
});

test('growth and the sparkline path', () => {
  const g = I.growth([{ day: '2026-11-01', subs: 100, views: 1000 }, { day: '2026-11-11', subs: 130, views: 1600 }, { day: '2026-11-21', subs: 160, views: null }]);
  assert.deepEqual([g.subs, g.views, g.days], [60, null, 20]);
  assert.equal(I.growth([]), null);
  assert.equal(I.sparkPath([1], 100, 20), '');
  const d = I.sparkPath([0, null, 10], 100, 20);
  assert.equal(d, 'M0.0 19.0 L100.0 1.0', 'nulls are skipped, the range fills the box');
});

test('labels: TR / EN numbers, ×, ≈ and per-hour units', () => {
  const sp = (x) => x.replace(/[\u00a0\u202f]/g, ' '); // Intl puts a no-break space before "B" in Turkish
  assert.equal(I.times(3.4, 'en'), '3.4×');
  assert.equal(I.times(3.4, 'tr'), '3,4×');
  assert.equal(I.times(12.3, 'en'), '12×');
  assert.equal(I.vphLabel({ value: 1234, approx: true }, 'en'), '≈1.2K/h');
  assert.equal(sp(I.vphLabel({ value: 1234, approx: false }, 'tr')), '1,2 B/sa');
  assert.equal(I.vphLabel({ value: 7.25, approx: false }, 'en'), '7.3/h');
  assert.equal(I.compact(412000, 'en'), '412K');
  assert.equal(sp(I.compact(412000, 'tr')), '412 B');
  assert.equal(I.compact(null, 'en'), '–');
  assert.equal(I.clock(692), '11:32');
  assert.equal(I.clock(3723), '1:02:03');
  assert.equal(I.cpLabel(24, 'tr'), '24 sa');
  assert.equal(I.cpLabel(168, 'en'), '7d');
  assert.equal(I.pct(1.7, 'tr'), '1,7%');
});

test('parseCards: search results (videoRenderer + lockups + a Shorts shelf), exact long counts, "/shorts/" results', () => {
  const r = Y.parseCards(fxJson('search.json'), { lang: 'en', now: NOW });
  assert.equal(r.length, 11);
  const first = r[0];
  assert.equal(first.code, 'srchxxxxxx1');
  assert.equal(first.ownerId, 'UCsheetAcademy0000000000');
  assert.equal(first.author, 'SheetAcademy');
  assert.equal(first.owner, 'yt/sheetacademy');
  assert.equal(first.ownerName, 'Sheet Academy');
  assert.equal(first.views, 2412903);
  assert.equal(first.viewsApprox, false, 'search shows the exact count next to "2.4M"');
  assert.equal(first.duration, 614);
  assert.equal(first.dateApprox, true);
  assert.ok(Math.abs(first.takenAt - (NOW - 2 * 365.25 * D)) < D);
  const lk = r.find((x) => x.code === 'srcLxxxxxx7');
  assert.equal(lk.ownerId, 'UCpivotPointTV0000000000', 'a search lockup: the channel from its avatar');
  assert.equal(lk.viewsApprox, true);
  const shorts = r.filter((x) => x.type === 'short');
  assert.equal(shorts.length, 4);
  assert.ok(shorts.some((x) => x.code === 'srchxxxxxx6' && x.ownerId === 'UCformulaFriday000000000'), 'a "/shorts/" videoRenderer is a Short');
  assert.ok(shorts.filter((x) => x.code !== 'srchxxxxxx6').every((x) => x.owner === null && x.views > 0), 'shelf Shorts name no channel');
  assert.ok(r.every((x) => !('files' in x)));
});

test('parseCards: home (lockups with avatars, a Shorts shelf, a mix skipped), subscriptions, watch sidebar', () => {
  const home = Y.parseCards(fxJson('home.json'), { lang: 'en', now: NOW });
  assert.equal(home.length, 16);
  assert.ok(!home.some((x) => /^RD/.test(x.code)), 'a mix is not a video');
  const h0 = home.find((x) => x.code === 'homexxxxx13');
  assert.deepEqual([h0.ownerId, h0.author, h0.ownerName, h0.views, h0.duration], ['UCpivotPointTV0000000000', 'PivotPointTV', 'Pivot Point', 94230, 482]);
  const subs = Y.parseCards(fxJson('subscriptions.json'), { lang: 'en', now: NOW });
  assert.equal(subs.length, 8);
  const grid = subs.find((x) => x.code === 'subsxxxxx34');
  assert.deepEqual([grid.ownerId, grid.views, grid.viewsApprox], ['UCpivotPointTV0000000000', 903, false], 'gridVideoRenderer: shortBylineText');
  const side = Y.parseCards(fxJson('next.json'), { lang: 'en', now: NOW });
  assert.equal(side.length, 8);
  const s0 = side[0];
  assert.deepEqual([s0.ownerId, s0.author, s0.ownerName], ['UCdemoExcelChannel000000', 'ExcelDemo', 'Excel Demo'], 'a sidebar lockup: the channel from the metadata row link');
  const compact = side.find((x) => x.code === 'sidexxxxx42');
  assert.equal(compact.ownerId, 'UCsheetAcademy0000000000', 'compactVideoRenderer: longBylineText');
  // The channel-grid fixture (no channel on the items) still parses; owner fields stay empty.
  const html = readFileSync(join(__dirname, '..', 'dev', 'youtube', 'channel-videos.html'), 'utf8');
  const grid2 = Y.parseCards(Y.extractVar(html, 'ytInitialData'), { lang: 'en', now: NOW });
  assert.ok(grid2.length >= 7 && grid2.every((x) => x.owner === null && x.views != null));
  assert.deepEqual(Y.parseCards(null), []);
  assert.deepEqual(Y.parseCards({ a: [1, 'x', null] }), []);
});

test('parseMetaTexts: the card\'s visible text, EN and TR', () => {
  const en = Y.parseMetaTexts(['Excel Campus', '63K views • 3 weeks ago', '9:52'], 'en', NOW);
  assert.deepEqual([en.views, en.viewsApprox, en.dateApprox, en.duration], [63000, true, true, 592]);
  assert.ok(Math.abs(en.takenAt - (NOW - 21 * D)) < 1000);
  const tr = Y.parseMetaTexts(['63 B görüntüleme', '2 gün önce'], 'tr', NOW);
  assert.deepEqual([tr.views, tr.viewsApprox], [63000, true]);
  assert.ok(Math.abs(tr.takenAt - (NOW - 2 * D)) < 1000);
  const exact = Y.parseMetaTexts(['801,352 views'], 'en', NOW);
  assert.deepEqual([exact.views, exact.viewsApprox], [801352, false]);
  assert.equal(Y.parseMetaTexts(['1.2K watching'], 'en', NOW).live, true);
  assert.deepEqual(Y.parseMetaTexts([], 'en', NOW), {});
});
