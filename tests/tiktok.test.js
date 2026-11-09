const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const T = require('../src/tiktok.js');
const M = require('../src/metrics.js');
const C = require('../src/compare.js');
const R = require('../src/reddit.js');

const dir = path.join(__dirname, '..', 'dev', 'tiktok');
const pages = JSON.parse(fs.readFileSync(path.join(dir, 'item_list.json'), 'utf8'));
const html = fs.readFileSync(path.join(dir, 'video.html'), 'utf8');
const sigi = JSON.parse(fs.readFileSync(path.join(dir, 'sigi.json'), 'utf8'));
const igTwin = JSON.parse(fs.readFileSync(path.join(dir, 'ig-twin.json'), 'utf8'));

function ssrJson(page) {
  const m = page.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  return JSON.parse(m[1]);
}
const allItems = () => T.parseText(JSON.stringify(pages[0])).concat(T.parseText(JSON.stringify(pages[1])));
const ownItems = () => allItems().filter((p) => p.owner === 'tt/excel.bugs.demo');

test('parses an item_list page into normalized records', () => {
  const posts = T.parseText(JSON.stringify(pages[0]));
  assert.equal(posts.length, 25);
  const p = posts[0];
  const raw = pages[0].itemList[0];
  assert.equal(p.platform, 'tiktok');
  assert.equal(p.code, raw.id);
  assert.equal(p.owner, 'tt/excel.bugs.demo');
  assert.equal(p.author, 'excel.bugs.demo');
  assert.equal(p.ownerName, 'Excel Bugs (demo)');
  assert.equal(p.url, `https://www.tiktok.com/@excel.bugs.demo/video/${raw.id}`);
  assert.equal(p.type, 'video');
  assert.equal(p.takenAt, raw.createTime * 1000);
  assert.equal(p.views, raw.stats.playCount);
  assert.equal(p.likes, raw.stats.diggCount);
  assert.equal(p.comments, raw.stats.commentCount);
  assert.equal(p.shares, raw.stats.shareCount);
  assert.equal(p.saves, Number(raw.statsV2.collectCount));
  assert.equal(p.duration, raw.video.duration);
  assert.equal(p.thumb, raw.video.cover);
  assert.equal(p.files[0].kind, 'video');
  assert.equal(p.files[0].url, raw.video.playAddr);
  assert.ok(p.files[0].alt.includes(raw.video.downloadAddr));
  assert.equal(p.pinned, true);
  assert.deepEqual(p.audio.kind, 'original');
});

test('statsV2 strings count, and the larger counter wins', () => {
  const posts = allItems();
  const raw = pages[0].itemList.concat(pages[1].itemList).find((x) => !x.isAd && x.statsV2.playCount !== String(x.stats.playCount));
  const p = posts.find((x) => x.code === raw.id);
  assert.equal(p.views, Number(raw.statsV2.playCount));
  // collectCount missing from stats but present (as a string) in statsV2
  const noCollect = pages[0].itemList.concat(pages[1].itemList).find((x) => x.stats.collectCount === undefined);
  assert.equal(posts.find((x) => x.code === noCollect.id).saves, Number(noCollect.statsV2.collectCount));
});

test('hashtags come from textExtra (not #40 or #YOK in the text); music and photo posts', () => {
  const posts = allItems();
  const p = posts[0];
  assert.ok(p.hashtags.includes('excelbug') && p.hashtags.includes('düşeyara'));
  assert.ok(!p.hashtags.includes('40') && !p.hashtags.includes('yok'));
  const music = posts.find((x) => x.audio && x.audio.kind === 'music');
  assert.ok(music.audio.title && music.audio.artist);
  const photo = posts.find((x) => x.type === 'carousel');
  assert.ok(photo, 'photo-mode post');
  assert.equal(photo.files.length, 3);
  assert.ok(photo.files.every((f) => f.kind === 'image'));
  assert.match(photo.url, /\/photo\//);
  assert.ok(photo.thumb);
});

test('promoted items are kept (and flagged) under their own author; junk is ignored', () => {
  const posts = allItems();
  // On tiktok.com a creator's own promoted videos carry isAd too, so they must not be dropped.
  assert.equal(posts.filter((p) => p.owner === 'tt/excel.bugs.demo').length, 40);
  const ad = posts.find((p) => p.owner === 'tt/some.brand');
  assert.ok(ad && ad.promoted === true);
  assert.ok(posts.filter((p) => p.owner === 'tt/excel.bugs.demo').every((p) => !p.promoted));
  assert.deepEqual(T.parseText('not json'), []);
  assert.deepEqual(T.parseText(JSON.stringify({ itemList: [{ id: '123', desc: 'x' }] })), []);
  // Comments carry createTime too, but no video/stats: not items.
  assert.deepEqual(T.parseText(JSON.stringify({ comments: [{ cid: '7300000000000000001', create_time: 1, text: 'hi', user: { unique_id: 'x' } }] })), []);
});

test('reads the SSR blob of a video page (item + profile facts)', () => {
  const json = ssrJson(html);
  const items = T.itemsFrom(json);
  assert.equal(items.length, 1);
  const raw = pages[0].itemList[2];
  assert.equal(items[0].code, raw.id);
  assert.equal(items[0].views, raw.stats.playCount + 5000);
  const user = T.parseUser(json);
  assert.deepEqual({ ...user, avatar: !!user.avatar }, { username: 'excel.bugs.demo', nickname: 'Excel Bugs (demo)', followers: 48213, videos: 40, likes: 2100000, avatar: true });
});

test('reads the older SIGI_STATE shape (author as a string)', () => {
  const items = T.itemsFrom(sigi);
  assert.equal(items.length, 4);
  assert.ok(items.every((p) => p.owner === 'tt/excel.bugs.demo' && p.ownerName === 'Excel Bugs (demo)'));
  assert.equal(T.parseUser(sigi).followers, 48000);
});

test('page context, ids and links', () => {
  assert.deepEqual(T.pageContext('/@Excel.Bugs'), { kind: 'profile', username: 'excel.bugs', id: 'tt/excel.bugs', video: null });
  assert.deepEqual(T.pageContext('/@excel.bugs/video/7300000000040000883'), { kind: 'video', username: 'excel.bugs', id: 'tt/excel.bugs', video: '7300000000040000883' });
  assert.equal(T.pageContext('/foryou').kind, 'other');
  assert.equal(T.pageContext('/explore').kind, 'other');
  assert.equal(T.videoIdOf('https://www.tiktok.com/@a/video/7300000000040000883?is_from_webapp=1'), '7300000000040000883');
  assert.equal(T.videoIdOf('7300000000040000883'), '7300000000040000883');
  assert.equal(T.linkExpiry('https://x.tiktokcdn.com/a.jpeg?x-expires=1794675600&x-signature=s'), 1794675600000);
  assert.equal(T.linkExpiry('https://v16-webapp-prime.tiktok.com/video/?a=1&expire=1794675600'), 1794675600000);
});

test('TikTok, Reddit and Instagram ids never collide', () => {
  assert.ok(T.isTikTokId('tt/excel.bugs'));
  assert.ok(!T.isTikTokId('excel.bugs') && !T.isTikTokId('r/excel'));
  assert.ok(!R.isRedditId('tt/excel.bugs'), 'Reddit content script must ignore tt/ keys');
  assert.ok('tt/excel.bugs'.indexOf('/') !== -1, 'Instagram content script skips keys containing "/"');
});

test('merge keeps the higher counts and the newest links', () => {
  const [a] = T.parseText(JSON.stringify(pages[0]));
  const older = { ...a, views: a.views + 10, files: [{ kind: 'video', url: 'https://old' }] };
  const m = T.merge(older, a);
  assert.equal(m.views, a.views + 10);
  assert.equal(m.files[0].url, a.files[0].url);
  const maps = T.mergePostMaps({ [a.code]: older }, { [a.code]: a, x: { code: 'x' } });
  assert.equal(Object.keys(maps).length, 2);
});

test('metrics: TikTok engagement counts shares and saves; file names; CSV columns', () => {
  const posts = M.enrich(allItems().filter((x) => x.owner === 'tt/excel.bugs.demo'));
  const p = posts.find((x) => x.views > 0 && x.saves > 0);
  assert.ok(Math.abs(p.engagement - (p.likes + p.comments + p.shares + p.saves) / p.views * 100) < 1e-9);
  assert.equal(M.sortBy(posts, 'saves')[0].saves, Math.max(...posts.map((x) => x.saves || 0)));
  const name = M.fileBaseName({ platform: 'tiktok', code: '7300000000040000883', views: 250000, likes: 12000, comments: 300, shares: 1100, saves: 2400 });
  assert.equal(name, '250Kviews_12Klikes_300comments_1.1Kshares_2.4Ksaves_6.3pct_tiktok_7300000000040000883');
  // Instagram names are unchanged.
  assert.equal(M.fileBaseName({ code: 'ABC', views: 1000, likes: 10, comments: 10, shares: 99 }), '1Kviews_10likes_10comments_2.0pct_post_ABC');
  const csv = M.toTable(M.sortBy(posts, 'views'), ',').split('\r\n');
  assert.equal(csv[0], M.TIKTOK_COLUMN_NAMES.join(','));
  assert.ok(csv[0].includes('saves') && csv[0].includes('platform'));
  assert.equal(csv.length, 41);
  const a = M.analyze(posts.filter((x) => x.type === 'video'));
  assert.ok(a.summary.avgShareRate > 0 && a.summary.avgSaveRate > 0);
  assert.ok(a.hashtags.length && a.durations.length && a.audio.kinds.length === 2);
});

test('compare: finds the same Excel Bug episode on both platforms, never a neighbouring episode', () => {
  const tt = M.enrich(ownItems());
  const ig = M.enrich(igTwin);
  const r = C.match(ig, tt);
  // 36 episodes on Instagram; #5 is a photo post on TikTok, so 35 can match.
  assert.equal(r.summary.matched, 35);
  for (const pair of r.pairs) {
    const ka = pair.a.caption.match(/Bug (\d+)/)[1];
    const kb = pair.b.caption.match(/Bug #(\d+)/)[1];
    assert.equal(ka, kb, `matched IG #${ka} with TikTok #${kb}`);
    assert.ok(pair.days <= 3);
    assert.ok(['high', 'medium', 'low'].includes(pair.confidence));
  }
  assert.equal(r.onlyA.length, 5); // 4 Instagram-only reels + episode 5
  assert.equal(r.onlyB.length, 4); // TikTok episodes 37–40
  assert.ok(r.summary.typicalViewsRatio > 1, 'TikTok gets more views in this fixture');
  assert.equal(r.summary.winsA + r.summary.winsB, 35);
});

test('compare: more than 3 days apart, or a different episode number, is not a match', () => {
  const base = { type: 'reel', caption: 'Excel Bug #12: DÜŞEYARA #YOK hatası', hashtags: ['excel', 'excelbug'], duration: 30, takenAt: Date.UTC(2026, 0, 10), views: 100 };
  assert.ok(C.similarity(base, { ...base, platform: 'tiktok', takenAt: base.takenAt + 2 * 864e5 }).score > 0.7);
  assert.equal(C.similarity(base, { ...base, takenAt: base.takenAt + 4 * 864e5 }), null);
  const other = C.similarity(base, { ...base, caption: 'Excel Bug #13: DÜŞEYARA #YOK hatası' });
  assert.ok(other.numClash && other.score < C.MIN_SCORE);
  // Turkish letters and emoji don't matter.
  assert.equal(C.cleanCaption('DÜŞEYARA İşte 🤯 #excel @someone'), 'duseyara iste');
});
