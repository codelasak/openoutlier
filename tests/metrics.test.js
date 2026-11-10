const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const X = require('../src/extract.js');
const M = require('../src/metrics.js');

const posts = X.parseText(fs.readFileSync(path.join(__dirname, '..', 'dev', 'graphql', 'query.json'), 'utf8'));

test('median', () => {
  assert.equal(M.median([3, 1, 2]), 2);
  assert.equal(M.median([4, 1, 2, 3]), 2.5);
  assert.equal(M.median([]), null);
  assert.equal(M.median([null, 5]), 5);
});

test('viral score is anchored on the median', () => {
  assert.equal(M.viralScore(100, 100), 50);
  assert.equal(M.viralScore(200, 100), 75);
  assert.equal(M.viralScore(400, 100), 100);
  assert.equal(M.viralScore(10000, 100), 100);
  assert.equal(M.viralScore(50, 100), 25);
  assert.equal(M.viralScore(1, 100), 0);
  assert.equal(M.viralScore(0, 100), null);
  assert.equal(M.viralScore(100, 0), null);
});

test('enrich flags outliers at 2x median', () => {
  const e = M.enrich([{ views: 100 }, { views: 100 }, { views: 100 }, { views: 250 }, { views: null }]);
  assert.deepEqual(e.map((p) => p.outlier), [false, false, false, true, false]);
  assert.equal(e[3].ratio, 2.5);
  assert.equal(e[4].viralScore, null);
});

test('sortBy puts missing values last in both directions', () => {
  const list = [{ views: 5 }, { views: null }, { views: 9 }];
  assert.deepEqual(M.sortBy(list, 'views').map((p) => p.views), [9, 5, null]);
  assert.deepEqual(M.sortBy(list, 'views', true).map((p) => p.views), [5, 9, null]);
});

test('analyze produces all sections from the fixture', () => {
  const a = M.analyze(M.enrich(posts));
  assert.equal(a.summary.count, 64);
  assert.ok(a.summary.medianViews > 0);
  assert.ok(a.summary.outliers >= 1);
  assert.ok(a.summary.postsPerWeek > 1);
  assert.equal(a.heatmap.cells.length, 7);
  assert.equal(a.heatmap.cells[0].length, 8);
  assert.equal(a.heatmap.days.length, 7);
  assert.equal(a.heatmap.hours.length, 8);
  assert.ok(a.heatmap.postsWithTime > 0);
  assert.ok(!a.heatmap.best || a.heatmap.best.count >= a.heatmap.minPosts);
  assert.ok(a.heatmap.bestDay && a.heatmap.bestDay.count >= a.heatmap.minPosts);
  assert.ok(a.hashtags.length > 0 && a.hashtags.every((h) => h.count >= 2));
  assert.ok(a.durations.length > 0);
  assert.deepEqual(a.audio.kinds.map((k) => k.key).sort(), ['Licensed music', 'Original audio']);
});

test('CSV escapes quotes/commas and neutralizes formulas', () => {
  const rows = [{ code: 'AAAAAA', url: 'u', type: 'reel', views: 10, caption: '=HYPERLINK("x"), hi', hashtags: [] }];
  const csv = M.toTable(rows, ',');
  const line = csv.split('\r\n')[1];
  assert.ok(line.endsWith('"\'=HYPERLINK(""x""), hi"'), line);
  assert.equal(csv.split('\r\n')[0], M.COLUMN_NAMES.join(','));
});

test('TSV has no stray tabs or newlines inside cells', () => {
  const rows = [{ code: 'AAAAAA', url: 'u', type: 'reel', views: 10, caption: 'a\tb\nc', hashtags: ['x'] }];
  const tsv = M.toTable(rows, '\t');
  const cells = tsv.split('\r\n')[1].split('\t');
  assert.equal(cells.length, M.COLUMN_NAMES.length);
});

test('download file names carry the stats', () => {
  assert.equal(
    M.fileBaseName({ code: 'DZPcVltsTAa', views: 1200000, likes: 11100, comments: 13000 }),
    '1.2Mviews_11.1Klikes_13Kcomments_2.0pct_post_DZPcVltsTAa');
  assert.equal(M.fileBaseName({ code: 'DX33sMtMhaN', views: 2000000, likes: 44300, comments: 16900 }), '2Mviews_44.3Klikes_16.9Kcomments_3.1pct_post_DX33sMtMhaN');
  assert.equal(M.fileBaseName({ code: 'ABCDEF', views: null, likes: 55, comments: 0 }), '55likes_0comments_post_ABCDEF');
  assert.equal(M.compactNumber(202), '202');
  assert.equal(M.compactNumber(81800), '81.8K');
});

test('viral score sort breaks ties above 100 using the ratio', () => {
  const e = M.enrich([{ views: 100 }, { views: 100 }, { views: 100 }, { views: 500 }, { views: 900 }]);
  assert.deepEqual(M.sortBy(e, 'viralScore').map((p) => p.views).slice(0, 2), [900, 500]);
});

// ---- best time to post --------------------------------------------------------

const HOUR = 3600e3;
// Mon 2026-01-05 00:00 local; slot k = day offset + hour.
const MON = new Date(2026, 0, 5).getTime();
function at(week, day, hour) { return MON + (week * 7 + day) * 24 * HOUR + hour * HOUR; }

test('heatmap adjusts for account growth instead of ranking raw views', () => {
  // The account 10× its views halfway through. Early posts went out on Monday
  // 09:00, later ones on Friday 15:00. Within each era every post does the same,
  // so neither slot is genuinely better: raw medians would crown Friday by 10×.
  const posts = [];
  for (let w = 0; w < 20; w++) posts.push({ type: 'reel', views: 1000, takenAt: at(w, 0, 9) });
  for (let w = 20; w < 40; w++) posts.push({ type: 'reel', views: 10000, takenAt: at(w, 4, 15) });
  const hm = M.analyze(M.enrich(posts)).heatmap;
  const mon = hm.cells[0][3];
  const fri = hm.cells[4][5];
  assert.equal(fri.medianViews / mon.medianViews, 10);
  // Era medians near the switch mix both levels, so allow a little drift.
  assert.ok(fri.lift < 1.6 && mon.lift > 0.6, `fri ${fri.lift} mon ${mon.lift}`);
  assert.ok(Math.abs(Math.log2(fri.lift / mon.lift)) < 1.2);
  assert.equal(hm.varietyIssue, 'concentrated', 'two slots hold every post');
});

test('heatmap shrinks thin slots and will not rank them', () => {
  const posts = [];
  // 40 ordinary posts on Tuesday 12:00 …
  for (let w = 0; w < 40; w++) posts.push({ type: 'reel', views: 1000 + (w % 5) * 50, takenAt: at(w, 1, 12) });
  // … and 3 lucky ones on Sunday 21:00 at 6×.
  for (let w = 0; w < 3; w++) posts.push({ type: 'reel', views: 6000, takenAt: at(w * 10 + 5, 6, 21) });
  const hm = M.analyze(M.enrich(posts)).heatmap;
  const sun = hm.cells[6][7];
  assert.equal(sun.count, 3);
  assert.ok(sun.rawLift > 4, 'raw lift sees the luck');
  assert.ok(sun.lift < sun.rawLift && sun.lift < 2, 'shrunk toward 1×');
  assert.equal(sun.confidence, 'low');
  assert.equal(hm.best.day, 1, 'the thin slot is not called out');
  assert.equal(hm.best.confidence, 'high');
  assert.ok(Math.abs(hm.cells[1][4].share - 40 / 43) < 1e-9);
});

test('heatmap finds a real slot effect when the account posts at many times', () => {
  const posts = [];
  let i = 0;
  for (let w = 0; w < 12; w++) {
    for (let d = 0; d < 7; d++) {
      const hour = [9, 12, 15, 18, 21][(w + d) % 5];
      const boost = hour === 18 ? 3 : 1;
      posts.push({ type: 'reel', views: (900 + (i++ % 7) * 30) * boost, takenAt: at(w, d, hour) });
    }
  }
  const hm = M.analyze(M.enrich(posts)).heatmap;
  assert.equal(hm.varietyIssue, null);
  assert.equal(hm.bestHours.block, 6, '18:00–21:00');
  assert.ok(hm.bestHours.lift > 1.5);
});
