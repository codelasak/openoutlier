const test = require('node:test');
const assert = require('node:assert/strict');
const MN = require('../src/mentions.js');

const post = (title, body = '', subreddit = 'excel') => ({ kind: 'post', title, body, subreddit });
const comment = (body, subreddit = 'excel') => ({ kind: 'comment', title: 'Some thread', body, subreddit });

test('phrase matching: whole words, any case/spacing, no partial words', () => {
  const w = { id: 'a', query: '"excel formula"' };
  assert.equal(MN.matches(post('My EXCEL   formula, broken'), w), true);
  assert.equal(MN.matches(post('excelformula'), w), false);
  assert.equal(MN.matches(post('excel formulas are hard'), w), false);
  assert.equal(MN.matches(post('formula excel'), w), false);
  // phrase + bare word: both must appear, anywhere
  const w2 = { id: 'b', query: '"excel formula" vlookup' };
  assert.equal(MN.matches(post('Excel formula help', 'I use VLOOKUP'), w2), true);
  assert.equal(MN.matches(post('Excel formula help'), w2), false);
});

test('prefix words, Turkish i and accents fold', () => {
  assert.equal(MN.matches(post('Formulas everywhere'), { id: 'p', query: 'formula*' }), true);
  assert.equal(MN.matches(post('İSTANBUL ILÇE listesi'), { id: 't', query: 'istanbul ilce' }), true);
  assert.equal(MN.matches(post('naïve café'), { id: 'c', query: 'cafe naive' }), true);
  assert.equal(MN.matches(post('zero​width'), { id: 'z', query: 'zerowidth' }), true);
});

test('exclude words and phrases reject an item', () => {
  const w = { id: 'x', query: 'vlookup', exclude: ['xlookup', 'google sheets'] };
  assert.equal(MN.matches(post('VLOOKUP help'), w), true);
  assert.equal(MN.matches(post('VLOOKUP vs XLOOKUP'), w), false);
  assert.equal(MN.matches(post('VLOOKUP in Google   Sheets'), w), false);
  assert.equal(MN.matches(post('VLOOKUP in Google Docs and Sheets'), w), true, 'exclude phrase needs the words together');
});

test('subreddit filter, kinds and disabled watches', () => {
  const w = { id: 's', query: 'pivot', subreddits: ['r/Excel', 'spreadsheets'] };
  assert.equal(MN.matches(post('Pivot table', '', 'Excel'), w), true);
  assert.equal(MN.matches(post('Pivot table', '', 'spreadsheets'), w), true);
  assert.equal(MN.matches(post('Pivot table', '', 'googlesheets'), w), false);
  assert.equal(MN.matches(comment('pivot please'), { id: 'k', query: 'pivot', kinds: ['posts'] }), false);
  assert.equal(MN.matches(comment('pivot please'), { id: 'k', query: 'pivot', kinds: ['comments'] }), true);
  assert.equal(MN.matches(post('Pivot'), { id: 'd', query: 'pivot', enabled: false }), false);
  // a comment is matched on its body, not on the thread title
  assert.equal(MN.matches({ kind: 'comment', title: 'pivot thread', body: 'thanks', subreddit: 'excel' }, { id: 'b', query: 'pivot' }), false);
});

test('normalizeWatch cleans UI input', () => {
  const r = MN.normalizeWatch({ query: '  "excel formula" ', subreddits: 'r/Excel, spreadsheets, excel', exclude: 'hiring,  ', kinds: [] });
  assert.ok(r.watch.id);
  assert.equal(r.watch.query, '"excel formula"');
  assert.deepEqual(r.watch.subreddits, ['excel', 'spreadsheets']);
  assert.deepEqual(r.watch.exclude, ['hiring']);
  assert.deepEqual(r.watch.kinds, ['posts', 'comments']);
  assert.equal(r.watch.enabled, true);
  assert.ok(MN.normalizeWatch({ query: '  ' }).error);
  assert.ok(MN.normalizeWatch({ query: 'x', subreddits: 'not a sub!' }).error);
});

test('planJobs: one search per watch, comment feeds shared per subreddit', () => {
  const { jobs, warnings } = MN.planJobs([
    { id: 'a', query: '"excel formula" vlookup*', subreddits: ['excel', 'spreadsheets'] },
    { id: 'b', query: 'pivot', subreddits: ['excel'], kinds: ['comments'] },
    { id: 'c', query: 'handsonexcel' },
    { id: 'd', query: 'off', enabled: false }
  ]);
  const keys = jobs.map((j) => j.key);
  assert.ok(keys.includes('posts:/r/excel+spreadsheets/search.json?q=%22excel%20formula%22%20vlookup&restrict_sr=1&sort=new&type=link&limit=50&raw_json=1'));
  assert.ok(keys.includes('posts:/search.json?q=handsonexcel&sort=new&type=link&limit=50&raw_json=1'));
  assert.deepEqual(jobs.find((j) => j.key === 'comments:excel').watchIds, ['a', 'b']);
  assert.ok(jobs.find((j) => j.key === 'comments:spreadsheets'));
  assert.equal(jobs.length, 4);
  assert.equal(warnings.length, 1); // "c" wants comments but has no subreddits
});

test('Atom feeds parse to the same items (RSS fallback)', () => {
  const xml = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>x</title>' +
    '<entry><author><name>/u/ann</name></author><category term="excel" label="r/excel"/>' +
    '<content type="html">&lt;!-- SC_OFF --&gt;&lt;div class=&quot;md&quot;&gt;&lt;p&gt;My excel formula &amp;amp; VLOOKUP&lt;br/&gt;line two&lt;/p&gt;&lt;/div&gt;&lt;!-- SC_ON --&gt; &amp;#32; submitted by &lt;a href=&quot;x&quot;&gt; /u/ann &lt;/a&gt;</content>' +
    '<id>t3_abc1</id><link href="https://www.reddit.com/r/excel/comments/abc1/x/"/><updated>2026-11-09T14:00:00+00:00</updated><published>2026-11-09T13:59:00+00:00</published><title>Formula &amp; dates</title></entry>' +
    '<entry><author><name>/u/bo</name></author><category term="Excel" label="r/excel"/><content type="html">&lt;p&gt;reply&lt;/p&gt;</content>' +
    '<id>t1_xyz9</id><link href="https://www.reddit.com/r/excel/comments/abc1/x/xyz9/"/><updated>2026-11-09T14:05:00+00:00</updated><title>/u/bo on Formula &amp; dates</title></entry>' +
    '<entry><id>t5_skip</id></entry></feed>';
  const items = MN.itemsFromAtom(xml);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { id: 't3_abc1', kind: 'post', title: 'Formula & dates', body: 'My excel formula & VLOOKUP\nline two', subreddit: 'excel', author: 'ann', permalink: 'https://www.reddit.com/r/excel/comments/abc1/x/', createdAt: Date.parse('2026-11-09T13:59:00Z'), score: null });
  assert.equal(items[1].kind, 'comment');
  assert.equal(items[1].title, 'Formula & dates');
  assert.equal(items[1].subreddit, 'excel');
  assert.equal(MN.matches(items[0], { id: 'w', query: '"excel formula"' }), true);
});

test('every job has the equivalent RSS feed (same URLs as reddit-watch)', () => {
  const { jobs } = MN.planJobs([{ id: 'a', query: '"excel formula"', subreddits: ['spreadsheets', 'excel'] }, { id: 'c', query: 'handsonexcel', kinds: ['posts'] }]);
  assert.deepEqual(jobs.map((j) => j.rssPath), [
    '/r/excel+spreadsheets/search.rss?q=%22excel%20formula%22&restrict_sr=1&sort=new&limit=100',
    '/r/excel/comments/.rss?limit=100',
    '/r/spreadsheets/comments/.rss?limit=100',
    '/search.rss?q=handsonexcel&sort=new&limit=100'
  ]);
});

const listing = {
  kind: 'Listing',
  data: { children: [
    { kind: 't3', data: { id: 'p1', title: 'Excel formula returns #N/A', selftext: 'My VLOOKUP breaks', subreddit: 'excel', author: 'alice', permalink: '/r/excel/comments/p1/x/', created_utc: 1794200000, score: 12 } },
    { kind: 't1', data: { id: 'c1', name: 't1_c1', body: 'Try an excel formula with XLOOKUP instead of VLOOKUP', link_title: 'Lookup help', subreddit: 'Excel', author: 'bob', permalink: '/r/excel/comments/p9/x/c1/', created_utc: 1794200100, score: 3 } },
    { kind: 't5', data: { id: 'sub' } }
  ] }
};

test('itemsFromListing reads posts and comments', () => {
  const items = MN.itemsFromListing(JSON.stringify(listing));
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { id: 't3_p1', kind: 'post', title: 'Excel formula returns #N/A', body: 'My VLOOKUP breaks', subreddit: 'excel', author: 'alice', permalink: 'https://www.reddit.com/r/excel/comments/p1/x/', createdAt: 1794200000000, score: 12 });
  assert.equal(items[1].id, 't1_c1');
  assert.equal(items[1].kind, 'comment');
  assert.equal(items[1].title, 'Lookup help');
  assert.equal(items[1].subreddit, 'excel');
});

test('processItems: exact record shape, dedupe by fullname, first watch wins', () => {
  const items = MN.itemsFromListing(listing);
  const watches = [{ id: 'w1', query: '"excel formula"' }, { id: 'w2', query: 'vlookup' }];
  const now = 1794200500000;
  const found = MN.processItems({}, watches, items.concat(items), { now, firstSeen: { w1: now - 1000 } });
  assert.equal(found.length, 2, 'duplicates in the batch are dropped');
  const m = found[0];
  assert.deepEqual(Object.keys(m).filter((k) => k !== 'notify'), MN.MENTION_FIELDS);
  assert.equal(m.id, 't3_p1');
  assert.equal(m.watchId, 'w1');
  assert.equal(m.query, '"excel formula"');
  assert.equal(m.source, 'extension');
  assert.equal(m.foundAt, now);
  assert.equal(m.notify, true);
  // already known ids are skipped, whichever watch found them
  assert.equal(MN.processItems({ t3_p1: {}, t1_c1: {} }, watches, items, { now }).length, 0);
  // items much older than a brand-new watch are stored but don't notify
  const quiet = MN.processItems({}, watches, items, { now, firstSeen: { w1: now + 10 * 3600000 } });
  assert.equal(quiet[0].notify, false);
});

test('mergeMentions: server and extension results dedupe by id, earliest foundAt wins', () => {
  const ext = MN.shape({ id: 't3_p1', kind: 'post', watchId: 'w1', query: 'q', foundAt: 2000 }, 'extension');
  let r = MN.mergeMentions({}, [ext]);
  assert.equal(r.added.length, 1);
  const fromServer = [
    { id: 't3_p1', kind: 'post', watchId: 'w1', query: 'q', foundAt: 1000, source: 'hayati', notify: true },
    { id: 't1_zz', kind: 'comment', watchId: 'w1', query: 'q', foundAt: 3000, extra: 'dropped' },
    { id: 'bogus', kind: 'post' }
  ];
  r = MN.mergeMentions(r.items, fromServer, 'hayati');
  assert.deepEqual(r.added.map((m) => m.id), ['t1_zz']);
  assert.equal(r.items.t3_p1.source, 'extension', 'the first record is kept');
  assert.equal(r.items.t3_p1.foundAt, 1000, 'but the earliest foundAt wins');
  assert.equal(r.items.t1_zz.source, 'hayati');
  assert.equal(r.items.t1_zz.extra, undefined);
  assert.deepEqual(Object.keys(r.items.t1_zz), MN.MENTION_FIELDS);
});

test('list filters and prune keeps the newest', () => {
  const items = {};
  for (let i = 0; i < 10; i++) items['t3_a' + i] = MN.shape({ id: 't3_a' + i, kind: 'post', watchId: i % 2 ? 'odd' : 'even', subreddit: 'excel', createdAt: i * 1000, foundAt: i * 1000 });
  const store = { items, read: { t3_a9: 1, t3_a1: 1 } };
  assert.equal(MN.list(store).length, 10);
  assert.equal(MN.list(store)[0].id, 't3_a9');
  assert.equal(MN.list(store, { watchId: 'odd' }).length, 5);
  assert.equal(MN.list(store, { watchId: 'odd', unreadOnly: true }).length, 3);
  assert.equal(MN.list(store, { since: 5000 }).length, 5);
  const pruned = MN.prune(store, 3);
  assert.deepEqual(Object.keys(pruned.items).sort(), ['t3_a7', 't3_a8', 't3_a9']);
  assert.deepEqual(pruned.read, { t3_a9: 1 });
});

test('shape coerces types and keeps only reddit.com https permalinks', () => {
  const m = MN.shape({ id: 't3_a1', createdAt: '2026-11-09T10:00:00Z', foundAt: '1794200000', score: '7', permalink: 'https://www.reddit.com/r/x/comments/a1/' });
  assert.equal(m.createdAt, Date.parse('2026-11-09T10:00:00Z'));
  assert.equal(m.foundAt, 1794200000000, 'numeric seconds → ms');
  assert.equal(m.score, 7);
  assert.equal(m.kind, 'post');
  assert.equal(MN.shape({ id: 't1_b', foundAt: 1794200000123 }).foundAt, 1794200000123);
  assert.equal(MN.shape({ id: 't1_b', permalink: 'javascript:alert(1)' }).permalink, null);
  assert.equal(MN.shape({ id: 't1_b', permalink: 'http://www.reddit.com/r/x/' }).permalink, null);
  assert.equal(MN.shape({ id: 't1_b', permalink: 'https://reddit.com.evil.net/' }).permalink, null);
  assert.equal(MN.shape({ id: 't1_b', score: 'lots' }).score, null);
});
