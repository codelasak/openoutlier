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
  assert.ok(a.heatmap.best && a.heatmap.best.count >= 2);
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
