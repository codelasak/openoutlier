const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Y = require('../src/youtube.js');
const M = require('../src/metrics.js');

const dir = path.join(__dirname, '..', 'dev', 'youtube');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const json = (f) => JSON.parse(read(f));
const NOW = Date.parse('2026-11-18T12:00:00Z');
const page = (f, lang) => Y.parsePage(read(f), { lang, now: NOW });
const byCode = (posts) => Object.fromEntries(posts.map((p) => [p.code, p]));
const DAY = 864e5;

// ---- text helpers ------------------------------------------------------------

test('counts: "B" is billion in English and thousand (bin) in Turkish', () => {
  assert.equal(Y.parseCount('63K', 'en'), 63000);
  assert.equal(Y.parseCount('63 thousand views', 'en'), 63000);
  assert.equal(Y.parseCount('1.2M views', 'en'), 1200000);
  assert.equal(Y.parseCount('2.1B views', 'en'), 2100000000);
  assert.equal(Y.parseCount('801,352 views', 'en'), 801352);
  assert.equal(Y.parseCount('No views', 'en'), 0);
  assert.equal(Y.parseCount('63 B', 'tr'), 63000);
  assert.equal(Y.parseCount('2,8 B görüntüleme', 'tr'), 2800);
  assert.equal(Y.parseCount('2,8 bin görüntüleme', 'tr'), 2800);
  assert.equal(Y.parseCount('1,2 Mn görüntüleme', 'tr'), 1200000);
  assert.equal(Y.parseCount('3 milyar', 'tr'), 3e9);
  assert.equal(Y.parseCount('801.352 görüntüleme', 'tr'), 801352);
  assert.equal(Y.parseCount('712 bin abone', 'tr'), 712000);
  assert.ok(Y.isRounded('63 B', 'tr') && Y.isRounded('63K', 'en') && !Y.isRounded('801,352 views', 'en'));
  // A language without a table: rounded labels are not guessed at, exact numbers still work.
  assert.equal(Y.parseCount('1,2 Mio. Aufrufe', 'de'), null);
  assert.equal(Y.parseCount('801352', 'de'), 801352);
});

test('relative dates, lengths and languages', () => {
  assert.equal(Y.parseAgo('1mo ago', 'en', NOW), Math.round(NOW - 30.44 * DAY));
  assert.equal(Y.parseAgo('3 weeks ago', 'en', NOW), NOW - 21 * DAY);
  assert.equal(Y.parseAgo('Streamed 4 years ago', 'en', NOW), Math.round(NOW - 4 * 365.25 * DAY));
  assert.equal(Y.parseAgo('5 hours ago', 'en', NOW), NOW - 5 * 36e5);
  assert.equal(Y.parseAgo('2 gün önce', 'tr', NOW), NOW - 2 * DAY);
  assert.equal(Y.parseAgo('1 ay önce', 'tr', NOW), Math.round(NOW - 30.44 * DAY));
  assert.equal(Y.parseAgo('1 yıl önce', 'tr', NOW), Math.round(NOW - 365.25 * DAY));
  assert.equal(Y.parseAgo('vor 2 Tagen', 'de', NOW), null);
  assert.equal(Y.parseDuration('9:52'), 592);
  assert.equal(Y.parseDuration('1:07:28'), 4048);
  assert.equal(Y.parseDuration('LIVE'), null);
  assert.equal(Y.normLang('tr-TR'), 'tr');
  assert.equal(Y.normLang('en-GB'), 'en');
  assert.equal(Y.normLang('de-DE'), null);
  assert.equal(Y.detectLang(read('channel-videos.tr.html')), 'tr');
  assert.equal(Y.detectLang(read('channel-videos.html')), 'en');
});

test('account ids, labels and URLs', () => {
  assert.equal(Y.ytId('@ExcelDemo'), 'yt/exceldemo');
  assert.equal(Y.ytId('yt/ExcelDemo'), 'yt/exceldemo');
  assert.equal(Y.ytId('UCdemoExcelChannel000000'), 'yt/UCdemoExcelChannel000000');
  assert.ok(Y.isYouTubeId('yt/exceldemo') && Y.isYouTubeId('yt/UCdemoExcelChannel000000') && Y.isYouTubeId('yt/çay.saati'));
  assert.ok(!Y.isYouTubeId('exceldemo') && !Y.isYouTubeId('tt/exceldemo') && !Y.isYouTubeId('yt/'));
  assert.equal(Y.label('yt/exceldemo'), '@exceldemo');
  assert.equal(Y.label('yt/UCdemoExcelChannel000000'), 'UCdemoExcelChannel000000');
  assert.equal(Y.videoIdOf('https://www.youtube.com/watch?v=yTdemo00029&t=3s'), 'yTdemo00029');
  assert.equal(Y.videoIdOf('https://youtu.be/yTdemo00029'), 'yTdemo00029');
  assert.equal(Y.videoIdOf('https://www.youtube.com/shorts/yTdemo00035'), 'yTdemo00035');
  assert.deepEqual(Y.coverUrls('yTdemo00029'), ['maxresdefault', 'sddefault', 'hqdefault'].map((n) => `https://i.ytimg.com/vi/yTdemo00029/${n}.jpg`));
});

test('page context', () => {
  assert.deepEqual(Y.pageContext('/@ExcelDemo/videos'), { kind: 'channel', id: 'yt/exceldemo', handle: 'ExcelDemo', channelId: null, tab: 'videos', video: null });
  assert.equal(Y.pageContext('/@ExcelDemo').tab, 'home');
  assert.equal(Y.pageContext('/@ExcelDemo/shorts').tab, 'shorts');
  const ch = Y.pageContext('/channel/UCdemoExcelChannel000000/streams');
  assert.equal(ch.id, 'yt/UCdemoExcelChannel000000');
  assert.equal(ch.tab, 'streams');
  assert.deepEqual([Y.pageContext('/watch', '?v=yTdemo00029').kind, Y.pageContext('/watch', '?v=yTdemo00029').video], ['watch', 'yTdemo00029']);
  assert.equal(Y.pageContext('/shorts/yTdemo00035').video, 'yTdemo00035');
  assert.equal(Y.pageContext('/feed/subscriptions').kind, 'other');
});

// ---- channel tabs ---------------------------------------------------------------

test('channel Videos tab (en): channel facts, rounded views, relative dates, lengths', () => {
  const r = page('channel-videos.html', 'en');
  assert.equal(r.kind, 'channel');
  assert.equal(r.tab, 'videos');
  assert.equal(r.hasMore, true);
  assert.deepEqual(r.channel && [r.channel.id, r.channel.handle, r.channel.channelId, r.channel.name, r.channel.subscribers, r.channel.subscribersApprox, r.channel.videos, r.channel.verified],
    ['yt/exceldemo', 'ExcelDemo', 'UCdemoExcelChannel000000', 'Excel Demo', 712000, true, 776, true]);
  assert.ok(r.posts.length >= 5);
  assert.equal(r.posts.length, r.items);
  const p = r.posts[0];
  assert.equal(p.platform, 'youtube');
  assert.equal(p.code, 'yTdemo00001');
  assert.equal(p.url, 'https://www.youtube.com/watch?v=yTdemo00001');
  assert.equal(p.owner, 'yt/exceldemo');
  assert.equal(p.author, 'ExcelDemo');
  assert.equal(p.ownerId, 'UCdemoExcelChannel000000');
  assert.equal(p.type, 'video');
  assert.equal(p.views, 63000);
  assert.equal(p.viewsApprox, true);
  assert.equal(p.takenAt, Math.round(NOW - 30.44 * DAY));
  assert.equal(p.dateApprox, true);
  assert.equal(p.duration, 592);
  assert.equal(p.caption, 'XLOOKUP vs VLOOKUP in 60 seconds 🤯');
  assert.match(p.thumb, /^https:\/\/i\.ytimg\.com\/vi\/yTdemo00001\//);
  assert.deepEqual(p.files, []);
  assert.ok(r.posts.every((x) => x.owner === 'yt/exceldemo' && x.type === 'video' && x.views > 0 && x.takenAt && x.duration > 0));
});

test('the Turkish channel page gives the same numbers as the English one', () => {
  const en = page('channel-videos.html', 'en');
  const tr = page('channel-videos.tr.html', 'tr');
  assert.equal(tr.channel.subscribers, 712000);
  assert.equal(tr.channel.verified, true);
  assert.deepEqual(tr.posts.map((p) => [p.code, p.views, p.takenAt, p.duration]), en.posts.map((p) => [p.code, p.views, p.takenAt, p.duration]));
  // Read with the wrong language, Turkish "63 B" would be 63 billion: the language matters.
  const wrong = page('channel-videos.tr.html', 'en');
  assert.ok(wrong.posts.every((p) => p.views == null || p.views !== byCode(tr.posts)[p.code].views || p.views < 1e9));
});

test('Shorts tab (en and tr): views from the long label, no date or length', () => {
  const en = page('channel-shorts.html', 'en');
  const tr = page('channel-shorts.tr.html', 'tr');
  assert.equal(en.tab, 'shorts');
  assert.ok(en.posts.length >= 5);
  const s = en.posts[0];
  assert.equal(s.type, 'short');
  assert.equal(s.url, 'https://www.youtube.com/shorts/yTdemo00031');
  assert.equal(s.views, 2800);
  assert.equal(s.viewsApprox, true);
  assert.equal(s.takenAt, undefined);
  assert.equal(s.duration, undefined);
  assert.deepEqual(s.hashtags, ['spill']);
  assert.match(s.thumb, /sardefault/);
  assert.deepEqual(tr.posts.map((p) => [p.code, p.views]), en.posts.map((p) => [p.code, p.views]));
  assert.equal(byCode(en.posts).yTdemo00035.views, 20000);
});

test('Live tab: past streams are typed live, with "Streamed … ago" dates', () => {
  const r = page('channel-streams.html', 'en');
  assert.equal(r.tab, 'streams');
  assert.equal(r.hasMore, false);
  assert.ok(r.posts.length >= 3);
  assert.ok(r.posts.every((p) => p.type === 'live' && p.views > 0 && p.dateApprox));
  assert.equal(r.posts[0].views, 8200);
  assert.equal(r.posts[0].duration, 4048);
});

test('browse continuations need the page\'s channel (they don\'t name it)', () => {
  const ch = page('channel-videos.html', 'en').channel;
  const none = Y.parseText(read('browse-videos.json'), { lang: 'en', now: NOW });
  assert.equal(none.kind, 'continuation');
  assert.equal(none.posts.length, 0);
  assert.ok(none.items > 0);
  const v = Y.parseText(read('browse-videos.json'), { lang: 'en', now: NOW, channel: ch, tab: 'videos' });
  assert.equal(v.hasMore, true);
  assert.ok(v.posts.length >= 3);
  assert.ok(v.posts.every((p) => p.owner === 'yt/exceldemo' && p.type === 'video' && p.viewsApprox && p.dateApprox));
  assert.equal(v.posts[0].views, 120000);
  const s = Y.parseText(read('browse-shorts.json'), { lang: 'en', now: NOW, channel: ch, tab: 'shorts' });
  assert.ok(s.posts.length >= 3 && s.posts.every((p) => p.type === 'short' && p.views > 0));
});

test('a lockup that names another channel is not filed under this one', () => {
  const ch = page('channel-videos.html', 'en').channel;
  const data = json('browse-videos.json');
  const items = data.onResponseReceivedActions[0].appendContinuationItemsAction.continuationItems;
  const lvm = items.find((x) => x.richItemRenderer).richItemRenderer.content.lockupViewModel;
  lvm.metadata.lockupMetadataViewModel.image = { decoratedAvatarViewModel: { rendererContext: { commandContext: { onTap: { innertubeCommand: { browseEndpoint: { browseId: 'UCsomeoneElse0000000000x', canonicalBaseUrl: '/@SomeoneElse' } } } } } } };
  const r = Y.parseJson(data, { lang: 'en', now: NOW, channel: ch });
  assert.ok(!r.posts.some((p) => p.code === lvm.contentId));
});

test('older grid shapes still parse (videoRenderer / reelItemRenderer)', () => {
  const ch = page('channel-videos.html', 'en').channel;
  const data = { onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [
    { richItemRenderer: { content: { videoRenderer: { videoId: 'oldShape001', title: { runs: [{ text: 'Old #shape' }] }, viewCountText: { simpleText: '1,234 views' }, publishedTimeText: { simpleText: '2 days ago' }, lengthText: { simpleText: '3:05' } } } } },
    { richItemRenderer: { content: { reelItemRenderer: { videoId: 'oldShape002', headline: { simpleText: 'Old short' }, viewCountText: { simpleText: '1.5K views', accessibility: { accessibilityData: { label: '1.5 thousand views' } } } } } } }
  ] } }] };
  const r = Y.parseJson(data, { lang: 'en', now: NOW, channel: ch });
  assert.deepEqual(r.posts.map((p) => [p.code, p.type, p.views, !!p.viewsApprox, p.duration || null]), [['oldShape001', 'video', 1234, false, 185], ['oldShape002', 'short', 1500, true, null]]);
  assert.deepEqual(r.posts[0].hashtags, ['shape']);
});

// ---- watch and Shorts pages ------------------------------------------------------------

function checkWatch(p) {
  assert.equal(p.code, 'yTdemo00029');
  assert.equal(p.owner, 'yt/exceldemo');
  assert.equal(p.ownerId, 'UCdemoExcelChannel000000');
  assert.equal(p.type, 'video');
  assert.equal(p.views, 801352);
  assert.equal(p.viewsApprox, false);
  assert.equal(p.likes, 13398);
  assert.equal(p.takenAt, Date.parse('2025-05-08T04:30:48-07:00'));
  assert.equal(p.dateApprox, false);
  assert.equal(p.duration, 717);
  assert.equal(p.category, 'Education');
  assert.deepEqual(p.hashtags, ['excel', 'macros', 'vba']);
  assert.ok(p.description.startsWith('Turn a repetitive Excel task'));
  assert.deepEqual(p.keywords, ['excel', 'Excel Demo']);
}

test('watch page (en, tr) and get_watch: exact views, likes, date, comments', () => {
  for (const [f, lang] of [['watch.html', 'en'], ['watch.tr.html', 'tr']]) {
    const r = page(f, lang);
    assert.equal(r.kind, 'watch');
    assert.equal(r.posts.length, 1);
    checkWatch(r.posts[0]);
    assert.equal(r.posts[0].comments, 234);
    assert.equal(r.posts[0].hasCaptions, true);
  }
  const g = Y.parseText(read('get_watch.json'), { lang: 'en', now: NOW });
  assert.equal(g.kind, 'watch');
  checkWatch(g.posts[0]);
  assert.equal(g.posts[0].comments, 234);
  assert.equal(g.posts[0].autoCaptions, true);
});

test('/player and /next on their own', () => {
  const p = Y.parseText(read('player.json'), { lang: 'en', now: NOW });
  assert.equal(p.kind, 'player');
  checkWatch(p.posts[0]);
  const n = Y.parseText(read('next.json'), { lang: 'en', now: NOW });
  assert.equal(n.kind, 'next');
  assert.deepEqual([n.posts[0].code, n.posts[0].owner, n.posts[0].views, n.posts[0].viewsApprox, n.posts[0].comments], ['yTdemo00029', 'yt/exceldemo', 801352, false, 234]);
  assert.equal(n.posts[0].type, undefined); // a fragment: it never starts a record on its own
});

// ---- phase 2: chapters, heatmap, watch-page channel facts, dates -----------------------

const CHAPTERS = [
  { title: 'Introduction', start: 0 },
  { title: 'Record Macro', start: 17 },
  { title: 'Run the Macro', start: 292 },
  { title: 'Fix issues with Chatgpt', start: 426 }
];

test('watch page (en, tr), get_watch and /next: chapters, heatmap, subscribers', () => {
  const results = [
    page('watch.html', 'en'),
    page('watch.tr.html', 'tr'),
    Y.parseText(read('get_watch.json'), { lang: 'en', now: NOW }),
    Y.parseText(read('next.json'), { lang: 'en', now: NOW })
  ];
  for (const r of results) {
    const p = r.posts[0];
    assert.deepEqual(p.chapters, CHAPTERS);
    assert.equal(p.heatmap.length, 100);
    assert.ok(p.heatmap.every((v) => v >= 0 && v <= 1));
    assert.equal(Math.max(...p.heatmap), 1);
    // Two "Most replayed" labels (en) / "En çok tekrar oynatılan an" (tr), at 64.53 s and 136.23 s.
    assert.deepEqual(p.heatmapPeaks, [65, 136]);
    assert.equal(p.heatmapStep, 7.17);
    assert.deepEqual([r.channel.id, r.channel.channelId, r.channel.subscribers, r.channel.subscribersApprox, r.channel.verified],
      ['yt/exceldemo', 'UCdemoExcelChannel000000', 712000, true, true]);
  }
  // Shorts have neither.
  const s = page('short.html', 'en').posts[0];
  assert.equal(s.chapters, undefined);
  assert.equal(s.heatmap, undefined);
});

test('calendar date labels (en, tr): /next alone gives the day, the player the exact time', () => {
  assert.equal(Y.parseDateText('May 8, 2025', 'en'), Date.UTC(2025, 4, 8, 12));
  assert.equal(Y.parseDateText('Premiered Nov 7, 2026', 'en'), Date.UTC(2026, 10, 7, 12));
  assert.equal(Y.parseDateText('8 May 2025', 'tr'), Date.UTC(2025, 4, 8, 12));
  assert.equal(Y.parseDateText('8 Ağu 2025', 'tr'), Date.UTC(2025, 7, 8, 12));
  assert.equal(Y.parseDateText('1 year ago', 'en'), null);
  assert.equal(Y.parseDateText('8. Mai 2025', 'de'), null);
  const n = Y.parseText(read('next.json'), { lang: 'en', now: NOW }).posts[0];
  assert.deepEqual([n.takenAt, n.dateApprox, n.dateDay], [Date.UTC(2025, 4, 8, 12), true, true]);
  // On a full watch page the player's publishDate (with time) wins.
  const w = page('watch.html', 'en').posts[0];
  assert.deepEqual([w.takenAt, w.dateApprox, w.dateDay], [Date.parse('2025-05-08T04:30:48-07:00'), false, undefined]);
  // A Short's reel item has the day from its description panel.
  const reel = Y.parseText(read('reel-item-watch.json'), { lang: 'en', now: NOW }).posts[0];
  assert.deepEqual([reel.takenAt, reel.dateDay], [Date.UTC(2026, 10, 7, 12), true]);
});

test('merge: dates rank exact > calendar day > relative; chapters and heatmap are kept', () => {
  const grid = byCode(page('channel-videos.html', 'en').posts).yTdemo00029;
  const next = Y.parseText(read('next.json'), { lang: 'en', now: NOW }).posts[0];
  const player = Y.parseText(read('player.json'), { lang: 'en', now: NOW }).posts[0];
  const a = Y.merge(grid, next);
  assert.deepEqual([a.takenAt, a.dateApprox, a.dateDay, a.views, a.viewsApprox, a.type], [next.takenAt, true, true, 801352, false, 'video']);
  assert.deepEqual(a.chapters, CHAPTERS);
  const b = Y.merge(a, grid); // the grid again: "1 year ago" does not replace the day
  assert.deepEqual([b.takenAt, b.dateDay, b.views], [next.takenAt, true, 801352]);
  assert.equal(b.heatmap.length, 100);
  const c = Y.merge(b, player); // the player's exact time replaces the day
  assert.deepEqual([c.takenAt, c.dateApprox, c.dateDay], [player.takenAt, false, undefined]);
  const d = Y.merge(c, next); // and the day never replaces the exact time
  assert.deepEqual([d.takenAt, d.dateApprox, d.dateDay], [player.takenAt, false, undefined]);
  assert.deepEqual(d.heatmapPeaks, [65, 136]);
});

test('heatmap: a heatmap without "Most replayed" labels uses its highest point; other videos are ignored', () => {
  const markers = Array.from({ length: 100 }, (_, i) => ({ startMillis: String(i * 2000), durationMillis: '2000', intensityScoreNormalized: i === 0 ? 1 : i === 40 ? 0.9 : 0.2 }));
  const json = { frameworkUpdates: { entityBatchUpdate: { mutations: [
    { payload: { macroMarkersListEntity: { externalVideoId: 'otherVideo1', markersList: { markerType: 'MARKER_TYPE_HEATMAP', markers: markers.map((m) => Object.assign({}, m, { intensityScoreNormalized: 0.5 })) } } } },
    { payload: { macroMarkersListEntity: { externalVideoId: 'yTdemo00029', markersList: { markerType: 'MARKER_TYPE_HEATMAP', markers } } } }
  ] } } };
  const hm = Y.heatmapOf(json, 'yTdemo00029');
  assert.equal(hm.values[40], 0.9);
  assert.equal(hm.step, 2);
  assert.deepEqual(hm.peaks, [81]);
  assert.equal(Y.heatmapOf({}, 'x'), null);
});

test('Shorts: the view count comes from the microformat (videoDetails has none)', () => {
  const s = Y.parseText(read('player-short.json'), { lang: 'en', now: NOW }).posts[0];
  assert.equal(s.code, 'yTdemo00035');
  assert.equal(s.type, 'short');
  assert.equal(s.url, 'https://www.youtube.com/shorts/yTdemo00035');
  assert.equal(s.views, 20651);
  assert.equal(s.viewsApprox, false);
  assert.equal(s.likes, 255);
  assert.equal(s.takenAt, Date.parse('2026-11-07T10:15:14-08:00'));
  assert.equal(s.duration, 54);
  const pg = page('short.html', 'en');
  assert.equal(pg.posts[0].views, 20651);
  assert.equal(pg.posts[0].comments, 3);
  const reel = Y.parseText(read('reel-item-watch.json'), { lang: 'en', now: NOW });
  assert.equal(reel.kind, 'reel');
  assert.deepEqual([reel.posts[0].code, reel.posts[0].owner, reel.posts[0].comments], ['yTdemo00035', 'yt/exceldemo', 3]);
  const seq = Y.parseText(read('reel-watch-sequence.json'), { lang: 'en', now: NOW });
  assert.equal(seq.kind, 'sequence');
  assert.ok(seq.posts.some((p) => p.type === 'short' && p.views > 0 && p.dateApprox === false));
});

test('extractVar reads inline JSON with braces and quotes inside strings', () => {
  const src = 'x=1;var ytInitialData = {"a":"}{\\"","b":{"c":[1,2]}};var meta = {};';
  assert.deepEqual(Y.extractVar(src, 'ytInitialData'), { a: '}{"', b: { c: [1, 2] } });
  assert.deepEqual(Y.extractVar('window["ytInitialData"] = {"x":1};', 'ytInitialData'), { x: 1 });
  assert.equal(Y.extractVar('nothing here', 'ytInitialData'), null);
});

// ---- merging ------------------------------------------------------------------------

test('merge: exact values replace rounded ones, not the other way round', () => {
  const grid = byCode(page('channel-videos.html', 'en').posts.concat(page('channel-shorts.html', 'en').posts));
  const watch = page('watch.html', 'en').posts[0];
  const g = grid.yTdemo00029;
  assert.ok(g && g.viewsApprox && g.dateApprox, 'the watch video is in the grid too');
  const m = Y.merge(g, watch);
  assert.deepEqual([m.views, m.viewsApprox, m.takenAt, m.dateApprox, m.likes, m.comments], [801352, false, watch.takenAt, false, 13398, 234]);
  // Seeing the grid again later must not undo it…
  const again = Y.merge(m, Object.assign({}, g, { views: 801000 }));
  assert.deepEqual([again.views, again.viewsApprox, again.takenAt, again.dateApprox], [801352, false, watch.takenAt, false]);
  assert.deepEqual(again.hashtags, ['excel', 'macros', 'vba']);
  // …unless the rounded (rounded-down) count is higher: the video has grown since.
  const grown = Y.merge(m, Object.assign({}, g, { views: 950000 }));
  assert.deepEqual([grown.views, grown.viewsApprox], [950000, true]);
  // The Short: grid (rounded, no date) + player (exact) + reel item (comments).
  const short = [page('short.html', 'en').posts[0], Y.parseText(read('reel-item-watch.json'), { lang: 'en' }).posts[0]].reduce(Y.merge, grid.yTdemo00035);
  assert.deepEqual([short.type, short.views, short.viewsApprox, short.likes, short.comments, short.dateApprox, short.url], [
    'short', 20651, false, 255, 3, false, 'https://www.youtube.com/shorts/yTdemo00035']);
  // Live and Short types are not downgraded to "video".
  assert.equal(Y.merge({ code: 'x', type: 'live' }, { code: 'x', type: 'video' }).type, 'live');
});

// ---- metrics ------------------------------------------------------------------------

function channelPosts() {
  const all = {};
  for (const f of ['channel-videos.html', 'channel-shorts.html', 'channel-streams.html']) {
    for (const p of page(f, 'en').posts) all[p.code] = Y.merge(all[p.code], p);
  }
  const w = page('watch.html', 'en').posts[0];
  all[w.code] = Y.merge(all[w.code], w);
  return Object.values(all);
}

test('metrics: Shorts and long-form are scored against separate medians', () => {
  const posts = channelPosts();
  const e = M.enrich(posts);
  const longMed = M.median(posts.filter((p) => p.type !== 'short').map((p) => p.views));
  const shortMed = M.median(posts.filter((p) => p.type === 'short').map((p) => p.views));
  assert.ok(longMed > shortMed * 3);
  for (const p of e) {
    const med = p.type === 'short' ? shortMed : longMed;
    assert.ok(Math.abs(p.ratio - p.views / med) < 1e-9, p.code);
  }
  // Engagement only where likes or comments are known (opened videos).
  const watched = e.find((p) => p.code === 'yTdemo00029');
  assert.ok(Math.abs(watched.engagement - (13398 + 234) / 801352 * 100) < 1e-9);
  assert.ok(e.filter((p) => p.code !== 'yTdemo00029').every((p) => p.engagement === null));
  // Instagram / TikTok lists keep one shared median.
  const ig = M.enrich([{ views: 100 }, { views: 300 }, { views: 1000, type: 'reel' }]);
  assert.deepEqual(ig.map((p) => p.ratio), [1 / 3, 1, 10 / 3]);
});

test('metrics: best time uses exact dates only; long-form length buckets; Shorts vs long-form', () => {
  const posts = M.enrich(channelPosts());
  const long = posts.filter((p) => p.type !== 'short');
  const a = M.analyze(long, { all: posts });
  assert.equal(a.heatmap.postsWithTime, 1); // only the opened video has an exact date
  assert.equal(a.youtube.exactDates, 1);
  assert.equal(a.youtube.approxDates, long.length - 1);
  assert.ok(a.durations.every((d) => /min/.test(d.key)));
  assert.deepEqual(a.youtube.formats.map((f) => f.key).sort(), ['Live', 'Long-form', 'Shorts']);
  assert.equal(a.youtube.formats.find((f) => f.key === 'Shorts').count, posts.filter((p) => p.type === 'short').length);
});

test('metrics: CSV columns and file names for YouTube', () => {
  const posts = M.sortBy(M.enrich(channelPosts()), 'views');
  const csv = M.toTable(posts, ',').split('\r\n');
  assert.equal(csv[0], M.YOUTUBE_COLUMN_NAMES.join(','));
  const cols = M.YOUTUBE_COLUMN_NAMES;
  const row = (code) => csv[posts.findIndex((p) => p.code === code) + 1].split(',');
  const w = row('yTdemo00029');
  assert.equal(w[cols.indexOf('views')], '801352');
  assert.equal(w[cols.indexOf('views_approx')], '');
  assert.equal(w[cols.indexOf('date_approx')], '');
  assert.notEqual(w[cols.indexOf('weekday')], '');
  assert.equal(w[cols.indexOf('account')], "'@exceldemo"); // leading @ is escaped against spreadsheet formulas, as for TikTok
  const g = row('yTdemo00001');
  assert.equal(g[cols.indexOf('views_approx')], 'yes');
  assert.equal(g[cols.indexOf('date_approx')], 'yes');
  assert.equal(g[cols.indexOf('weekday')], '');
  assert.equal(M.fileBaseName(posts.find((p) => p.code === 'yTdemo00029')), '801.4Kviews_13.4Klikes_234comments_1.7pct_youtube_yTdemo00029');
  assert.equal(M.fileBaseName({ platform: 'youtube', type: 'short', code: 'yTdemo00031', views: 2800 }), '2.8Kviews_short_yTdemo00031');
});

// ---- hook -----------------------------------------------------------------------------

function runHook(hostname, urls) {
  const forwarded = [];
  const body = '{"videoId":"yTdemo00029","contentId":"x","code":"ABC","createTime":1,"stats":{}}';
  const window = {
    fetch: async () => new Response(body, { headers: { 'content-type': 'application/json' } }),
    postMessage: (m) => forwarded.push(m.url),
    XMLHttpRequest: null,
    location: { origin: 'https://' + hostname }
  };
  vm.runInNewContext(read('../../src/hook.js'), { window, location: { hostname }, Response });
  return Promise.all(urls.map((u) => window.fetch(u))).then(() => new Promise((r) => setTimeout(r, 20))).then(() => forwarded);
}

test('hook: forwards YouTube data endpoints only; Instagram and TikTok unchanged', async () => {
  const yt = await runHook('www.youtube.com', [
    '/youtubei/v1/browse?prettyPrint=false', '/youtubei/v1/get_watch?prettyPrint=false', '/youtubei/v1/player', '/youtubei/v1/next',
    '/youtubei/v1/reel/reel_item_watch', '/youtubei/v1/reel/reel_watch_sequence?x=1',
    '/youtubei/v1/browse/edit_playlist', '/youtubei/v1/guide', '/youtubei/v1/log_event', '/api/v1/feed/'
  ]);
  assert.deepEqual(yt, ['/youtubei/v1/browse?prettyPrint=false', '/youtubei/v1/get_watch?prettyPrint=false', '/youtubei/v1/player', '/youtubei/v1/next',
    '/youtubei/v1/reel/reel_item_watch', '/youtubei/v1/reel/reel_watch_sequence?x=1']);
  assert.deepEqual(await runHook('www.instagram.com', ['/graphql/query', '/api/v1/feed/user/1/', '/youtubei/v1/browse']), ['/graphql/query', '/api/v1/feed/user/1/']);
  assert.deepEqual(await runHook('www.tiktok.com', ['/api/post/item_list/', '/api/comment/list/', '/youtubei/v1/browse']), ['/api/post/item_list/']);
});

// ---- "Get exact stats" (service worker) ---------------------------------------------

/** Load src/youtube-exact.js against a fake chrome API. The fake "tab" plays the content script:
 * loading a video's page saves exact values for it (unless that id is in `blank`). */
function exactHarness({ blank = [] } = {}) {
  const local = {};
  const session = {};
  const events = { created: [], updated: [], removed: [], progress: [] };
  const listeners = [];
  const removedListeners = [];
  let nextTab = 100;
  function load(tabId, url) {
    const id = (url.match(/(?:v=|shorts\/)([A-Za-z0-9_-]{11})/) || [])[1];
    setTimeout(() => {
      if (blank.includes(id)) return;
      for (const k of Object.keys(local)) {
        const p = local[k].posts && local[k].posts[id];
        if (p) local[k].posts[id] = Object.assign({}, p, { viewsApprox: false, dateApprox: false, views: (p.views || 0) + 1 });
      }
    }, 5);
  }
  const chrome = {
    runtime: { id: 'ext', onMessage: { addListener: (fn) => listeners.push(fn) } },
    storage: {
      local: { get: async (k) => (k in local ? { [k]: JSON.parse(JSON.stringify(local[k])) } : {}) },
      session: { set: async (o) => Object.assign(session, o) }
    },
    tabs: {
      create: async (o) => { const tab = { id: nextTab++, windowId: 1 }; events.created.push(o); load(tab.id, o.url); return tab; },
      update: async (id, o) => { events.updated.push([id, o]); if (o.url) load(id, o.url); return { id }; },
      remove: async (id) => { events.removed.push(id); removedListeners.forEach((fn) => fn(id)); },
      sendMessage: async (id, m) => { events.progress.push(m.state); },
      onRemoved: { addListener: (fn) => removedListeners.push(fn) }
    }
  };
  const ctx = { self: {}, chrome, console, setTimeout, clearTimeout, Promise, Date, Math, Object, Array, String, JSON };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'youtube-exact.js'), 'utf8'), ctx);
  ctx.self.OpenOutlierYouTubeExact._timing({ pageTimeout: 120, gapMin: 5, gapRandom: 0, poll: 10 });
  function send(msg) {
    let out;
    listeners.forEach((fn) => fn(msg, { id: 'ext', tab: { id: 7, windowId: 1 } }, (r) => { out = r; }));
    return out;
  }
  async function until(fn, ms = 3000) {
    const t = Date.now();
    while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 10)); }
  }
  return { local, session, events, send, until, chrome, api: ctx.self.OpenOutlierYouTubeExact };
}

function seedChannel(local, n) {
  const posts = {};
  for (let i = 0; i < n; i++) {
    const code = 'yTdemo' + String(i).padStart(5, '0');
    posts[code] = { code, owner: 'yt/exceldemo', type: i % 2 ? 'short' : 'video', views: 1000, viewsApprox: true, dateApprox: true };
  }
  local['rs:p:yt/exceldemo'] = { posts };
  return Object.keys(posts);
}

test('Get exact stats: one muted background tab, one video at a time, then closed', async () => {
  const H = exactHarness();
  const codes = seedChannel(H.local, 4);
  H.local['rs:p:yt/exceldemo'].posts[codes[2]].viewsApprox = false;
  H.local['rs:p:yt/exceldemo'].posts[codes[2]].dateApprox = false; // already exact: skipped without opening
  const r = H.send({ type: 'reelscope:yt-exact', videos: codes.map((c, i) => ({ code: c, owner: 'yt/exceldemo', type: i % 2 ? 'short' : 'video' })) });
  assert.deepEqual([r.ok, r.total], [true, 4]);
  // A second job while one runs is refused.
  assert.equal(H.send({ type: 'reelscope:yt-exact', videos: [{ code: codes[0], owner: 'yt/exceldemo' }] }).ok, false);
  await H.until(() => H.api.snapshot().finished);
  const s = H.api.snapshot();
  assert.deepEqual([s.done, s.skipped, s.failed, s.running], [3, 1, 0, false]);
  assert.match(s.label, /^Done: 3 updated, 1 already exact\.$/);
  assert.equal(H.events.created.length, 1, 'one tab for the whole job');
  assert.equal(H.events.created[0].active, false);
  assert.equal(H.events.created[0].url, 'https://www.youtube.com/watch?v=' + codes[0]);
  assert.deepEqual(H.events.updated.filter(([, o]) => o.url).map(([, o]) => o.url), [
    'https://www.youtube.com/shorts/' + codes[1], 'https://www.youtube.com/shorts/' + codes[3]]);
  assert.ok(H.events.updated.some(([, o]) => o.muted === true));
  assert.equal(H.events.removed.length, 1, 'the tab is closed at the end');
  assert.ok(H.events.progress.length >= 3 && H.events.progress.at(-1).finished);
  assert.equal(H.session['rs:yt-exact'].finished, true);
});

test('Get exact stats: capped, validated, cancellable, and stops after repeated misses', async () => {
  const H = exactHarness();
  const codes = seedChannel(H.local, 30);
  const bad = [{ code: 'not-an-id', owner: 'yt/exceldemo' }, { code: codes[0], owner: 'instagram_user' }];
  const r = H.send({ type: 'reelscope:yt-exact', videos: bad.concat(codes.map((c) => ({ code: c, owner: 'yt/exceldemo' }))) });
  assert.equal(r.total, 25);
  await H.until(() => H.api.snapshot().done >= 1);
  H.send({ type: 'reelscope:yt-exact-cancel' });
  await H.until(() => H.api.snapshot().finished);
  const s = H.api.snapshot();
  assert.ok(s.done < 25 && /^Stopped\./.test(s.label), s.label);
  assert.equal(H.events.removed.length, 1);

  // Consent / sign-in pages: three videos in a row never become exact → stop early.
  const H2 = exactHarness({ blank: ['yTdemo00000', 'yTdemo00001', 'yTdemo00002'] });
  seedChannel(H2.local, 5);
  H2.send({ type: 'reelscope:yt-exact', videos: ['yTdemo00000', 'yTdemo00001', 'yTdemo00002', 'yTdemo00003'].map((c) => ({ code: c, owner: 'yt/exceldemo' })) });
  await H2.until(() => H2.api.snapshot().finished);
  assert.deepEqual([H2.api.snapshot().failed, H2.api.snapshot().done], [3, 0]);
  assert.match(H2.api.snapshot().label, /did not show 3 videos in a row/);

  // Closing the worker tab stops the job.
  const H3 = exactHarness({ blank: ['yTdemo00000'] });
  seedChannel(H3.local, 3);
  H3.send({ type: 'reelscope:yt-exact', videos: ['yTdemo00000', 'yTdemo00001'].map((c) => ({ code: c, owner: 'yt/exceldemo' })) });
  await H3.until(() => H3.events.created.length === 1);
  await H3.chrome.tabs.remove(100);
  await H3.until(() => H3.api.snapshot().finished);
  assert.match(H3.api.snapshot().label, /tab was closed/);
});

test('reel_item_watch: the response\'s own video id beats the page URL\'s (it can arrive before the URL changes)', () => {
  const r = Y.parseText(read('reel-item-watch.json'), { lang: 'en', videoId: 'yTdemo00029' });
  assert.equal(r.posts[0].code, 'yTdemo00035');
  // Without an id of its own (logged in), the URL's id is the fallback.
  const j = json('reel-item-watch.json');
  const strip = (o) => { if (o && typeof o === 'object') for (const k of Object.keys(o)) { if (k === 'signInEndpoint') delete o[k]; else strip(o[k]); } };
  strip(j);
  assert.equal(Y.parseJson(j, { lang: 'en', videoId: 'yTdemo00099' }).posts[0].code, 'yTdemo00099');
  assert.equal(Y.parseJson(j, { lang: 'en' }).posts.length, 0);
});

// ---- agent commands in the service worker (src/agent-bridge.js) ----------------------

/** Load src/agent-bridge.js against a fake chrome API and a fake MCP bridge. The fake tab
 * plays the YouTube content script: it answers commands and reports them done. */
function bridgeHarness() {
  const clone = (o) => JSON.parse(JSON.stringify(o)); // objects made inside the vm have another realm's prototypes
  const queue = [];
  const results = [];
  const events = { windows: [], created: [], updated: [], removed: [], sent: [] };
  const listeners = [];
  const urls = {};
  let staleOnce = false; // right after a navigation the old page answers first
  const reply = (body) => ({ ok: true, json: async () => body });
  const fetch = async (url, opts = {}) => {
    if (url.endsWith('/health')) return reply({ app: 'reelscope', syncId: 's1', accounts: 0, features: ['youtube-download'] });
    if (url.endsWith('/sync')) return reply({ syncId: 's1' });
    if (url.endsWith('/commands')) return reply({ commands: queue.splice(0) });
    if (url.endsWith('/commands/result')) { results.push(JSON.parse(opts.body)); return reply({ ok: true }); }
    throw new Error('unexpected ' + url);
  };
  const store = { local: {}, session: {} };
  const area = (o) => ({
    get: async (k) => (k == null ? { ...o } : typeof k === 'string' ? (k in o ? { [k]: o[k] } : {}) : {}),
    set: async (v) => { Object.assign(o, v); },
    remove: async () => {}
  });
  const ev = () => ({ addListener: () => {} });
  const chrome = {
    runtime: { id: 'ext', onMessage: { addListener: (fn) => listeners.push(fn) }, onStartup: ev(), onInstalled: ev() },
    storage: { local: area(store.local), session: area(store.session), onChanged: ev() },
    alarms: { get: async () => null, create: () => {}, onAlarm: ev() },
    windows: { create: async (o) => { events.windows.push(clone(o)); urls[5] = o.url; return { tabs: [{ id: 5 }] }; } },
    tabs: {
      query: async () => [],
      create: async (o) => { events.created.push(clone(o)); urls[9] = o.url; return { id: 9 }; },
      update: async (id, o) => { events.updated.push([id, clone(o)]); if (o.url) { urls[id] = o.url; staleOnce = true; } return { id }; },
      remove: async (id) => { events.removed.push(id); },
      sendMessage: async (id, m) => {
        if (staleOnce) { staleOnce = false; return { accepted: false }; }
        events.sent.push([id, urls[id], clone(m.command.args)]);
        const a = m.command.args;
        setTimeout(() => {
          const result = m.command.type === 'refresh_youtube'
            ? { ok: true, id: a.id, account: 'yt/somechannel', exact_views: true }
            : { ok: true, account: 'yt/somechannel', tab: a.tab, collected_now: a.tab === 'shorts' ? 4 : 30, saved_total: a.tab === 'shorts' ? 34 : 30,
              long_form: 30, shorts: a.tab === 'shorts' ? 4 : 0, end_reached: true, channel_videos: 40, note: a.tab === 'shorts' ? 'shorts note' : undefined };
          listeners.forEach((fn) => fn({ type: 'reelscope:command-done', id: m.command.id, result }, { id: 'ext' }));
        }, 5);
        return { accepted: true };
      }
    }
  };
  const ctx = { chrome, fetch, console, setTimeout, clearTimeout, Promise, Date, Math, Object, Array, String, JSON, AbortSignal };
  async function until(fn, ms = 6000) {
    const t = Date.now();
    while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 10)); }
  }
  function run(cmd) {
    queue.push(cmd);
    listeners.forEach((fn) => fn({ type: 'reelscope:bridge-check' }, { id: 'ext' }));
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'agent-bridge.js'), 'utf8'), ctx);
  return { run, results, events, until };
}

test('agent bridge: collect_youtube scrolls Videos, then Shorts, in one window; refresh_youtube uses a muted background tab', async () => {
  const H = bridgeHarness();
  H.run({ id: 'c1', type: 'collect_youtube', args: { id: 'yt/somechannel', maxPosts: 300, tabs: ['videos', 'shorts'] } });
  await H.until(() => H.results.length === 1);
  assert.equal(H.events.windows[0].url, 'https://www.youtube.com/@somechannel/videos');
  assert.equal(H.events.windows[0].focused, false);
  assert.deepEqual(H.events.updated, [[5, { url: 'https://www.youtube.com/@somechannel/shorts' }]]);
  // The Shorts step was only accepted by the new page, and knows which tab came before.
  assert.deepEqual(H.events.sent.map((s) => [s[1], s[2].tab, s[2].prevTab]), [
    ['https://www.youtube.com/@somechannel/videos', 'videos', undefined],
    ['https://www.youtube.com/@somechannel/shorts', 'shorts', 'videos']
  ]);
  const r = H.results[0];
  assert.equal(r.id, 'c1');
  assert.deepEqual([r.result.ok, r.result.account, r.result.saved_total, r.result.long_form, r.result.shorts, r.result.note],
    [true, 'yt/somechannel', 34, 30, 4, 'shorts note']);
  assert.deepEqual(r.result.tabs.map((t) => [t.tab, t.collected_now]), [['videos', 30], ['shorts', 4]]);
  assert.deepEqual(H.events.removed, [5]); // the window's tab is closed at the end

  H.run({ id: 'c2', type: 'collect_youtube', args: { id: 'yt/UCabcdefghijklmnopqrstuv', tabs: ['shorts'] } });
  await H.until(() => H.results.length === 2);
  assert.equal(H.events.windows[1].url, 'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv/shorts');
  assert.deepEqual(H.results[1].result.tabs.map((t) => t.tab), ['shorts']);

  H.run({ id: 'r1', type: 'refresh_youtube', args: { id: 'yTdemo00035', type: 'short' } });
  await H.until(() => H.results.length === 3);
  assert.deepEqual(H.events.created[0], { url: 'https://www.youtube.com/shorts/yTdemo00035', active: false });
  assert.ok(H.events.updated.some(([id, o]) => id === 9 && o.muted === true));
  assert.deepEqual(H.results[2].result, { ok: true, id: 'yTdemo00035', account: 'yt/somechannel', exact_views: true });
  assert.ok(H.events.removed.includes(9));
});
