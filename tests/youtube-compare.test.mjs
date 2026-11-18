// Compare YouTube Shorts with Instagram Reels / TikTok (phase 5): src/compare.js and
// comparePlatforms in mcp/library.mjs. Shorts only (long-form never matches), YouTube
// dates only when exact or day-precise, each side against its own median.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../src/compare.js');
const M = require('../src/metrics.js');
process.env.OPENOUTLIER_HOME = mkdtempSync(join(tmpdir(), 'openoutlier-cmp-'));
const lib = await import('../mcp/library.mjs');

const DAY = 864e5;
const T0 = Date.UTC(2026, 9, 1, 15);
const yid = (i) => 'yTshort' + String(i).padStart(4, '0');

function reel(i, views) {
  return { code: 'IGreel' + i, platform: 'instagram', type: 'reel', owner: 'excel.demo', caption: `Excel Bug #${i}: the date that turns into a number #excel #exceltips`, hashtags: ['excel', 'exceltips'], duration: 30 + i, takenAt: T0 + i * 7 * DAY, views };
}
function short(i, views, date = 'exact') {
  const p = { code: yid(i), platform: 'youtube', type: 'short', owner: 'yt/exceldemo', caption: `Excel Bug #${i}: the date that turns into a number #excel`, hashtags: ['excel'], duration: 30 + i, views, viewsApprox: false };
  if (date === 'exact') { p.takenAt = T0 + i * 7 * DAY + 3600e3; p.dateApprox = false; }
  else if (date === 'day') { p.takenAt = T0 + i * 7 * DAY; p.dateApprox = true; p.dateDay = true; }
  else if (date === 'relative') { p.takenAt = T0 + (i * 7 + 20) * DAY; p.dateApprox = true; } // "3 weeks ago": off by weeks
  return p;
}
function longVideo(i, views) {
  return { code: 'yTlong' + String(i).padStart(5, '0'), platform: 'youtube', type: 'video', owner: 'yt/exceldemo', caption: `Excel Bug #${i}: the date that turns into a number #excel`, hashtags: ['excel'], duration: 600, views, takenAt: T0 + i * 7 * DAY, dateApprox: false };
}

test('compare.js: Shorts match reels; long-form never does; relative YouTube dates are ignored, not trusted', () => {
  const ig = M.enrich([1, 2, 3, 4, 5].map((i) => reel(i, 1000 * i)));
  const yt = M.enrich([short(1, 5000), short(2, 900, 'day'), short(3, 4000, 'relative'), short(4, 800, 'none'), longVideo(5, 100000)]);
  const r = C.match(ig, yt);
  const byIg = Object.fromEntries(r.pairs.map((p) => [p.a.code, p.b]));
  assert.equal(byIg.IGreel1.code, yid(1));
  assert.equal(byIg.IGreel2.code, yid(2));
  assert.equal(byIg.IGreel2.date, 'day');
  // "3 weeks ago" is 20 days off: as a date it would rule the pair out; it is ignored, and the near-identical title still matches.
  assert.equal(byIg.IGreel3.code, yid(3));
  assert.equal(byIg.IGreel3.date, 'approximate');
  assert.equal(r.pairs.find((p) => p.a.code === 'IGreel3').days, null);
  assert.equal(byIg.IGreel4.code, yid(4));
  assert.ok(!r.pairs.some((p) => p.b.code.startsWith('yTlong')), 'long-form videos are not compared');
  assert.equal(r.summary.videosB, 4, 'only the Shorts count on the YouTube side');
  assert.deepEqual(r.onlyA.map((x) => x.code), ['IGreel5']);
  // An exact YouTube date more than 3 days away still rules a pair out.
  const far = Object.assign(short(1, 10), { takenAt: T0 + 7 * DAY + 5 * DAY });
  assert.equal(C.similarity(reel(1, 1), far), null);
  // Different episode numbers never match.
  assert.equal(C.match(M.enrich([reel(1, 1)]), M.enrich([short(2, 1, 'none')])).pairs.length, 0);
  assert.equal(C.dateOf(short(1, 1, 'relative')), null);
  assert.deepEqual(C.sideOrder('youtube', 'instagram'), ['instagram', 'youtube']);
});

test('each side against its own median: the YouTube side uses the channel\'s Shorts median', () => {
  const ig = M.enrich([1, 2, 3, 4, 5].map((i) => reel(i, 1000)));
  const yt = M.enrich([short(1, 2000), short(2, 1000), short(3, 1000), short(4, 1000), short(5, 1000), longVideo(9, 1e6), longVideo(10, 1e6)]);
  const pair = C.match(ig, yt).pairs.find((p) => p.a.code === 'IGreel1');
  assert.equal(pair.a.ratio, 1);
  assert.equal(pair.b.ratio, 2, '2000 ÷ the Shorts median (1000), not the long-form median');
  assert.equal(pair.winner, 'b');
});

test('compare_platforms with account_yt: IG ↔ YouTube Shorts, TT ↔ YouTube Shorts, same-handle default and errors', () => {
  const posts = (list) => Object.fromEntries(list.map((p) => [p.code, p]));
  const tt = [1, 2, 3].map((i) => ({ ...reel(i, 3000), code: 'TT' + i, platform: 'tiktok', type: 'video', owner: 'tt/exceldemo', shares: 5, saves: 9 }));
  lib.store().applySync({ full: false, accounts: {
    'excel.demo': { platform: 'instagram', updatedAt: Date.now(), posts: posts([1, 2, 3, 4, 5].map((i) => reel(i, 1000 * i))) },
    'yt/exceldemo': { platform: 'youtube', updatedAt: Date.now(), posts: posts([short(1, 5000), short(2, 900, 'day'), short(3, 4000, 'none'), longVideo(5, 1e5)]) },
    'tt/exceldemo': { platform: 'tiktok', updatedAt: Date.now(), posts: posts(tt) }
  } });
  const L = lib.readLibrary();
  const r = lib.comparePlatforms(L, { account_yt: 'yt/exceldemo', account_ig: 'excel.demo' });
  assert.equal(r.instagram, 'excel.demo');
  assert.equal(r.youtube, 'yt/exceldemo');
  assert.equal(r.summary.youtube_shorts, 3);
  assert.equal(r.summary.instagram_videos, 5);
  assert.equal(r.summary.matched, 3);
  assert.ok('typical_youtube_to_instagram_views' in r.summary);
  assert.deepEqual(r.summary.youtube_dates, { exact_or_day: 2, without_usable_date: 1 });
  assert.match(r.summary.dates_note, /1 of 3 Shorts/);
  const p1 = r.pairs.find((p) => p.instagram.code === 'IGreel1');
  assert.equal(p1.youtube.code, yid(1));
  assert.equal(p1.youtube.date, 'exact');
  assert.equal(p1.youtube.shares, undefined);
  assert.ok('youtube_to_instagram_views' in p1);
  assert.match(r.how_matched, /Shorts median/);
  assert.equal(r.only_on_instagram.count, 2);

  // TikTok ↔ YouTube, and the same handle by default (Instagram first, but this one is "excel.demo" ≠ "exceldemo").
  const t = lib.comparePlatforms(L, { account_yt: 'youtube.com/@exceldemo' });
  assert.equal(t.tiktok, 'tt/exceldemo');
  assert.equal(t.youtube, 'yt/exceldemo');
  assert.ok('typical_youtube_to_tiktok_views' in t.summary);
  assert.equal(t.pairs[0].tiktok.saves, 9);

  // IG ↔ TT keeps its old shape.
  const old = lib.comparePlatforms(L, { account_ig: 'excel.demo', account_tt: 'tt/exceldemo' });
  assert.equal(old.instagram, 'excel.demo');
  assert.equal(old.tiktok, 'tt/exceldemo');
  assert.ok('typical_tiktok_to_instagram_views' in old.summary);
  assert.ok('only_on_tiktok' in old);

  assert.throws(() => lib.comparePlatforms(L, { account_yt: 'yt/nobody' }), /no Instagram or TikTok account named nobody/);
  assert.throws(() => lib.comparePlatforms(L, { account_yt: 'yt/missing', account_ig: 'excel.demo' }), /not in the library/);
  assert.throws(() => lib.comparePlatforms(L, { account_yt: 'yt/exceldemo', account_ig: 'excel.demo', account_tt: 'tt/exceldemo' }), /two accounts at a time/);
});
