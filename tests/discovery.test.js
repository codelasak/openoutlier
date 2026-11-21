// Phase 5 (src/discovery.js): TF-IDF similarity, the co-recommendation counts and their decay,
// the radar's cost and lists, autocomplete parsing and the keyword merge, the RPM estimate.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/discovery.js');

const H = 3600e3;
const DAY = 24 * H;
const NOW = Date.UTC(2026, 10, 21, 12);
const uc = (s) => ('UC' + s + 'x'.repeat(22)).slice(0, 24);

test('TF-IDF: channels that write about the same things are similar, shared terms explain why', () => {
  const ch = {
    a: { titles: ['XLOOKUP with two criteria', 'Pivot table basics', 'XLOOKUP vs VLOOKUP'], tags: ['excel', 'xlookup'], descriptions: ['Download the workbook: https://x.io'] },
    b: { titles: ['XLOOKUP explained', 'Pivot table tricks'], tags: ['excel', 'pivot table'] },
    c: { titles: ['Sourdough starter in 5 days', 'Baking bread at home'], tags: ['bread', 'baking'] },
    d: { titles: ['Excel dashboard design'], tags: ['excel'] }
  };
  const r = D.similarByText(ch, 'a');
  assert.equal(r[0].id, 'b');
  assert.ok(r[0].terms.includes('xlookup'));
  assert.ok(!r.some((x) => x.id === 'c'), 'unrelated channel left out');
  assert.ok(r[0].score > (r.find((x) => x.id === 'd') || { score: 0 }).score);
  // Vectors are unit length; a channel is identical to itself; IDF downweights words every channel has.
  const v = D.tfidf({ a: D.termCounts(ch.a), b: D.termCounts(ch.b), c: D.termCounts(ch.c) });
  const norm = Math.sqrt(Object.values(v.a).reduce((s, x) => s + x * x, 0));
  assert.ok(Math.abs(norm - 1) < 1e-9);
  assert.ok(Math.abs(D.cosine(v.a, v.a) - 1) < 1e-9);
  assert.equal(D.cosine(v.a, v.c), 0);
  // URLs, stop words and boilerplate never become terms; a multi-word tag stays one term as well.
  const tf = D.termCounts({ titles: ['How to subscribe to the channel'], tags: ['pivot table'], descriptions: ['https://example.com/xyz'] });
  assert.ok(!('subscribe' in tf) && !('channel' in tf) && !('https' in tf) && !('example' in tf));
  assert.ok('pivot table' in tf && 'pivot' in tf);
  assert.deepEqual(D.similarByText(ch, 'nope'), []);
});

test('co-recommendations: one count per channel per sidebar, decaying with a 30-day half-life', () => {
  const src = uc('Src');
  const cards = [{ ownerId: uc('A'), ownerName: 'A' }, { ownerId: uc('A'), ownerName: 'A again' }, { ownerId: src }, { ownerId: uc('B'), author: '@bee' }, { ownerId: 'not-a-channel' }, {}];
  const p = D.coRecPairs(src, cards);
  assert.deepEqual(p.recs.map((r) => r.id), [uc('A'), uc('B')], 'each channel once, the source and junk left out');
  assert.equal(p.recs[1].handle, 'bee');
  assert.equal(D.coRecPairs('x', cards), null);
  assert.equal(D.coRecPairs(src, [{ ownerId: src }]), null);
  // Decay: half after 30 days, a quarter after 60.
  assert.equal(D.decayed(4, NOW, NOW + 30 * DAY), 2);
  assert.equal(D.decayed(4, NOW, NOW + 60 * DAY), 1);
  assert.equal(D.decayed(4, NOW, NOW - DAY), 4, 'no growth backwards');
  const rows = {};
  D.addCoRec(rows, p, NOW);
  D.addCoRec(rows, p, NOW + 30 * DAY);
  assert.equal(rows[src + '|' + uc('A')].weight, 1.5);
  assert.equal(rows[src + '|' + uc('A')].n, 2);
  // Both directions count; shares add up; old pairs fade under the floor.
  const flat = [
    { a: src, b: uc('A'), weight: 3, n: 3, updated_at: NOW },
    { a: uc('A'), b: src, weight: 1, n: 1, updated_at: NOW },
    { a: src, b: uc('B'), weight: 1, n: 1, updated_at: NOW - 30 * DAY },
    { a: src, b: uc('Old'), weight: 1, n: 1, updated_at: NOW - 300 * DAY },
    { a: uc('X'), b: uc('Y'), weight: 9, n: 9, updated_at: NOW }
  ];
  const s = D.coRecScores(flat, src, NOW);
  assert.deepEqual(s.map((x) => [x.id, x.weight, x.seen]), [[uc('A'), 4, 4], [uc('B'), 0.5, 1]]);
  assert.ok(Math.abs(s[0].share + s[1].share - 1) < 0.01);
  // Combined with text similarity: both signals beat either alone.
  const c = D.combineSimilar(s, [{ id: uc('B'), score: 0.4, terms: ['xlookup'] }, { id: uc('T'), score: 0.5, terms: [] }]);
  assert.equal(c[0].id, uc('A'));
  assert.equal(c.find((x) => x.id === uc('B')).why, 'both');
  assert.equal(c.find((x) => x.id === uc('T')).why, 'text');
});

test('radar: cost per run, settings, views per subscriber and the two lists', () => {
  assert.deepEqual(D.radarCost(4), { searches: 4, search: 400, videos: 2, channels: 2, total: 404, perKeyword: 25 });
  assert.equal(D.radarCost(20).total, 2000 + 10 + 10, '20 keywords ≈ 2,000 units a day (plan 6.5)');
  assert.equal(D.radarCost(1, { perKeyword: 50 }).total, 102);
  assert.equal(D.radarCost(0).total, 0);
  const s = D.sanitizeRadar({ maxSubs: 'x', minRatio: 500, region: 'tr', lang: 'TR', keywords: { Excel: [' Excel  XLOOKUP ', 'excel xlookup', '', 'Power Query'], '': ['a'] }, rankKeywords: ['A', 'a', 'b'] });
  assert.equal(s.maxSubs, D.RADAR_DEFAULTS.maxSubs);
  assert.equal(s.minRatio, 100);
  assert.equal(s.region, 'US');
  assert.equal(s.lang, 'en');
  assert.deepEqual(s.keywords.Excel, ['excel xlookup', 'power query']);
  assert.deepEqual(s.rankKeywords, ['a', 'b']);
  assert.deepEqual(D.radarMetrics({ views: 1000, published_at: NOW - 10 * H }, { subs: 500 }, NOW), { age_h: 10, vph: 100, views_per_sub: 2 });
  assert.equal(D.radarMetrics({ views: 1000, published_at: NOW }, { subs: null }, NOW).views_per_sub, null);
  const vids = [
    { video_id: 'v1', channel_id: 'small', views: 20000, published_at: NOW - 50 * H, keywords: ['excel xlookup'] },
    { video_id: 'v2', channel_id: 'small', views: 3000, published_at: NOW - 30 * H, keywords: ['excel dashboard'] },
    { video_id: 'v3', channel_id: 'big', views: 900000, published_at: NOW - 30 * H },
    { video_id: 'v4', channel_id: 'tracked', views: 30000, published_at: NOW - 30 * H },
    { video_id: 'v5', channel_id: 'small', views: 50000, published_at: NOW - 9 * DAY },
    { video_id: 'v6', channel_id: 'hidden', views: 50000, published_at: NOW - 9 * H },
    { video_id: 'v7', channel_id: 'tiny', views: 300, published_at: NOW - 9 * H }
  ];
  const chans = { small: { subs: 4000, title: 'Small' }, big: { subs: 2e6 }, tracked: { subs: 9000, title: 'T' }, hidden: { subs: null }, tiny: { subs: 10 } };
  const l = D.radarLists(vids, chans, { tracked: true }, { now: NOW, maxSubs: 50000, minRatio: 0.5, minViews: 1000 });
  assert.deepEqual(l.breakouts.map((v) => v.video_id), ['v1', 'v4', 'v2'], 'big, old, hidden-count and too-few-views videos left out; best ratio first');
  assert.equal(l.breakouts.find((v) => v.video_id === 'v4').tracked, true);
  assert.deepEqual(l.rising.map((c) => c.channel_id), ['small'], 'tracked channels are not "rising channels you don\'t track"');
  assert.deepEqual(l.rising[0].keywords, ['excel xlookup', 'excel dashboard']);
  assert.equal(l.rising[0].videos.length, 2);
});

test('keyword suggestions for the radar and the niche prefix', () => {
  assert.equal(D.nichePrefix(['XLOOKUP in 10 minutes excel', 'Pivot tables excel', 'excel dashboard', 'Did you know this trick?']), 'excel');
  assert.equal(D.nichePrefix(['a b', 'c d']), null);
  const sug = D.suggestKeywords({
    searchTerms: [{ term: 'excel pivot table', views: 40 }, { term: 'hands on excel', views: 4 }],
    gaps: [{ word: 'lambda', n: 3 }, { word: 'did', n: 2 }],
    titleWords: [{ word: 'xlookup', n: 20, lift: 1.3 }, { word: 'tricks', n: 9, lift: 2 }, { word: 'slow', n: 4, lift: 0.6 }, { word: 'excel', n: 50, lift: 1 }],
    existing: ['excel pivot table']
  }, { prefix: 'excel' });
  assert.deepEqual(sug.map((x) => [x.keyword, x.from]), [['hands on excel', 'search'], ['excel lambda', 'gap'], ['excel xlookup', 'title']], 'no fillers, no slow words, no duplicates of the list');
});

test('autocomplete: both answer formats, and the URL carries hl/gl', () => {
  assert.deepEqual(D.parseSuggest('["excel",["excel formulas","Excel  <b>tutorial</b>","excel formulas"],[],{}]'), ['excel formulas', 'excel tutorial']);
  assert.deepEqual(D.parseSuggest('window.google.ac.h(["excel",[["excel xlookup",0,[512]],["excel vba",0]],{"k":1}])'), ['excel xlookup', 'excel vba']);
  assert.deepEqual(D.parseSuggest(['q', ['a b']]), ['a b']);
  assert.deepEqual(D.parseSuggest('<html>blocked</html>'), []);
  assert.deepEqual(D.parseSuggest('{"a":1}'), []);
  const u = new URL(D.suggestUrl('excel pivot', { hl: 'tr', gl: 'TR' }));
  assert.equal(u.hostname, 'suggestqueries.google.com');
  assert.deepEqual([u.searchParams.get('client'), u.searchParams.get('ds'), u.searchParams.get('q'), u.searchParams.get('hl'), u.searchParams.get('gl')], ['firefox', 'yt', 'excel pivot', 'tr', 'TR']);
  assert.equal(D.expansions('excel').length, 24);
});

test('keyword ideas: merged sources, "you rank" from own search terms, ranked first; the vidIQ prompt stays within limits', () => {
  const ideas = D.keywordIdeas({
    suggestions: { excel: ['excel xlookup', 'excel formulas', 'excel lambda'], 'excel xlookup': ['excel xlookup multiple criteria'] },
    titleWords: [{ word: 'lambda', lift: 2.1 }, { word: 'xlookup', lift: 1.0 }],
    gaps: [{ word: 'regex', lift: 1.9 }],
    ownTerms: [{ term: 'Excel XLOOKUP', views: 30, last_week: 9 }, { term: 'how to use excel lambda function', views: 4 }],
    prefix: 'excel', radar: ['excel formulas']
  });
  const by = Object.fromEntries(ideas.map((i) => [i.keyword, i]));
  assert.equal(ideas[0].keyword, 'excel xlookup', 'a term you already rank for comes first');
  assert.deepEqual(by['excel xlookup'].ranks, { views: 30, last_week: 9 });
  assert.deepEqual(by['excel xlookup'].sources.sort(), ['autocomplete', 'search', 'title'].sort());
  assert.ok(by['excel lambda'].ranks, 'a two-word idea inside a longer search term ranks');
  assert.equal(by['excel lambda'].lift, 2.1);
  assert.equal(by['excel regex'].sources[0], 'gap');
  assert.equal(by['excel formulas'].on_radar, true);
  assert.deepEqual(by['excel xlookup multiple criteria'].seeds, ['excel xlookup']);
  assert.ok(ideas.indexOf(by['excel lambda']) < ideas.indexOf(by['excel regex']));
  const p = D.volumePrompt(ideas.map((i) => i.keyword), { niche: 'Excel', max: 5 });
  assert.match(p, /vidIQ/);
  assert.match(p, /at most 5 calls/);
  assert.equal((p.match(/^- /gm) || []).length, 5);
  assert.match(D.volumePrompt(['a'], { lang: 'tr' }), /ayda ~30 çağrı/);
});

test('channel-rpm: category RPM × monthly views, labelled as an estimate', () => {
  assert.equal(D.mainCategory([{ category: 'Education' }, { category: 'Education' }, { category: 'Music' }, {}]), 'Education');
  const e = D.rpmEstimate({ category: 'Education', views: 100000 });
  assert.deepEqual([e.known, e.rpm, e.monthly, e.estimate], [true, D.RPM_TABLE.Education, [300, 900], true]);
  const sh = D.rpmEstimate({ category: 'Education', views: 100000, shortsShare: 0.5 });
  assert.deepEqual(sh.monthly, [151, 454], 'Shorts views earn the Shorts rate');
  const u = D.rpmEstimate({ category: 'Unknown cat', views: 10000 });
  assert.deepEqual([u.known, u.rpm, u.monthly], [false, D.RPM_DEFAULT, [15, 50]]);
  assert.equal(D.rpmEstimate({ category: 'Gaming' }).monthly, null);
  // Monthly views: the tracker's series first, then the lifetime average, then recent uploads (a floor).
  const series = Array.from({ length: 15 }, (_, i) => ({ day: new Date(NOW - (14 - i) * DAY).toISOString().slice(0, 10), views: 1e6 + i * 2000 }));
  assert.deepEqual(D.monthlyViews({ series, now: NOW }), { views: 60000, basis: 'tracked', days: 14 });
  assert.deepEqual(D.monthlyViews({ totalViews: 1.2e6, createdAt: NOW - 360 * DAY, now: NOW }), { views: 100000, basis: 'lifetime' });
  const posts = [1, 2, 3].map((i) => ({ takenAt: NOW - i * 10 * DAY, views: 3000 }));
  assert.deepEqual(D.monthlyViews({ posts, now: NOW }), { views: 3000, basis: 'recent-uploads' });
  assert.equal(D.monthlyViews({ now: NOW }), null);
});

test('a watch page\'s /next answer → the co-recommendation pairs src/youtube-similar.js sends', () => {
  const Y = require('../src/youtube.js');
  const j = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'dev', 'youtube', 'discovery', 'next-watch.json'), 'utf8'));
  const cur = j.currentVideoEndpoint.watchEndpoint.videoId;
  const owner = Y.parseNext(j, {}).ownerId;
  const cards = Y.parseCards(j.contents.twoColumnWatchNextResults.secondaryResults, {}).filter((c) => c.code !== cur);
  const p = D.coRecPairs(owner, cards);
  assert.equal(p.source, 'UCdemoExcelChannel000000');
  assert.ok(p.recs.length >= 2);
  assert.ok(p.recs.every((r) => /^UC[A-Za-z0-9_-]{22}$/.test(r.id) && r.id !== p.source));
  assert.equal(new Set(p.recs.map((r) => r.id)).size, p.recs.length);
  assert.ok(!JSON.stringify(p).includes(cur), 'no video id in what is sent');
});
