const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../src/reddit.js');
const M = require('../src/metrics.js');

const listings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'dev', 'reddit', 'listings.json'), 'utf8'));
const html = fs.readFileSync(path.join(__dirname, '..', 'dev', 'reddit', 'shreddit.html'), 'utf8');

test('parses a listing page and its "after" cursor', () => {
  const page1 = R.parseListing(listings.excel[0]);
  assert.equal(page1.posts.length, 45);
  assert.match(page1.after, /^t3_[a-z0-9]+$/);
  const last = R.parseListing(JSON.stringify(listings.excel[1]));
  assert.equal(last.after, null);
  const p = page1.posts[0];
  assert.equal(p.platform, 'reddit');
  assert.equal(p.owner, 'r/excel');
  assert.equal(p.subreddit, 'excel');
  assert.match(p.url, /^https:\/\/www\.reddit\.com\/r\/excel\/comments\/[a-z0-9]+\//);
  assert.ok(p.score > 0 && p.comments >= 0 && p.upvoteRatio > 0 && p.upvoteRatio <= 1);
  assert.ok(p.takenAt > Date.UTC(2025, 0, 1));
  assert.ok(p.title.length > 5);
  assert.deepEqual(p.files, []);
});

test('detects post types and unescapes preview links', () => {
  const all = R.parseListing(listings.excel).posts; // an array of listings works too
  assert.equal(all.length, 90);
  const types = new Set(all.map((p) => p.type));
  for (const t of ['text', 'image', 'video', 'link']) assert.ok(types.has(t), 'missing type ' + t);
  const img = all.find((p) => p.type === 'image');
  assert.ok(img.thumb && !img.thumb.includes('&amp;'), img.thumb);
  assert.ok(all.filter((p) => p.type === 'text').every((p) => p.selftext.length > 0));
  assert.ok(all.some((p) => p.flair === 'solved'));
});

test('ignores comments, deleted text and junk', () => {
  const mixed = [
    { kind: 'Listing', data: { after: null, children: [
      { kind: 't3', data: { id: 'abc12', title: 'Hi &amp; bye', subreddit: 'Excel', score: 5, num_comments: 1, created_utc: 1760000000, is_self: true, selftext: '[removed]', author: '[deleted]' } },
      { kind: 't1', data: { id: 'c1', body: 'a comment' } },
      { kind: 't3', data: { id: 'NOT VALID', title: 'x' } }
    ] } }
  ];
  const { posts } = R.parseListing(mixed);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].title, 'Hi & bye');
  assert.equal(posts[0].selftext, '');
  assert.equal(posts[0].author, null);
  assert.equal(posts[0].owner, 'r/excel');
  assert.deepEqual(R.parseListing('not json'), { posts: [], after: null });
});

test('reads <shreddit-post> attributes defensively', () => {
  const posts = R.parseShredditHtml(html);
  assert.equal(posts.length, 4, 'the promoted post without a title is skipped');
  const [a, b, c, d] = posts;
  assert.equal(a.code, '1abc2de');
  assert.equal(a.title, 'How do I stop Excel from turning "1-2" into a date?');
  assert.equal(a.score, 1532);
  assert.equal(a.comments, 214);
  assert.equal(a.type, 'text');
  assert.equal(a.owner, 'r/excel');
  assert.equal(a.takenAt, Date.UTC(2026, 9, 14, 15, 4, 9, 123));
  assert.equal(a.detailed, false);
  assert.equal(b.score, 2400); // "2.4k"
  assert.equal(b.type, 'image');
  assert.equal(c.title, 'XLOOKUP > VLOOKUP, change my mind'); // ">" inside a quoted attribute
  assert.equal(c.comments, 1100);
  assert.equal(c.author, null);
  assert.equal(c.takenAt, 1760000000 * 1000);
  assert.equal(d.score, null); // "•" = hidden score
  assert.equal(d.type, 'video');
  assert.equal(d.pinned, true);
  // Older / alternative attribute spellings.
  const alt = R.fromShredditAttrs({ 'post-id': 't3_xyz99', title: 'Alt', 'subreddit-name': 'spreadsheets', 'vote-count': '12', 'comments-count': '3', 'created-utc': '1760000000', 'post-type': 'multi_media', flair: 'Discussion' });
  assert.equal(alt.owner, 'r/spreadsheets');
  assert.equal(alt.type, 'gallery');
  assert.equal(alt.score, 12);
  assert.equal(alt.flair, 'Discussion');
});

test('page context and listing paths', () => {
  assert.deepEqual(R.pageContext('/r/Excel/top/', '?t=year'), { kind: 'subreddit', id: 'r/excel', name: 'Excel', sort: 'top', t: 'year' });
  assert.equal(R.pageContext('/r/excel/').sort, 'hot');
  assert.equal(R.pageContext('/r/excel/comments/1abc2de/some_title/').kind, 'post');
  assert.equal(R.pageContext('/user/ExcelByChris/submitted/').id, 'u/excelbychris');
  assert.equal(R.pageContext('/u/someone/').kind, 'user');
  assert.equal(R.pageContext('/r/popular/').kind, 'feed');
  assert.equal(R.pageContext('/').kind, 'feed');
  assert.equal(R.listingPath({ kind: 'subreddit', name: 'excel' }, { sort: 'top', t: 'year', after: 't3_abc' }), '/r/excel/top.json?limit=100&raw_json=1&after=t3_abc&t=year');
  assert.equal(R.listingPath({ kind: 'subreddit', name: 'excel' }, { sort: 'new' }), '/r/excel/new.json?limit=100&raw_json=1');
  assert.equal(R.listingPath({ kind: 'user', name: 'bob' }, { sort: 'top', t: 'all' }), '/user/bob/submitted.json?sort=top&t=all&limit=100&raw_json=1');
  assert.equal(R.pageUrl('r/excel'), 'https://www.reddit.com/r/excel/top/?t=year');
  assert.equal(R.label('r/excel'), 'r/excel');
  assert.equal(R.label('handson.excel'), '@handson.excel');
});

test('merge: newer counts win, DOM data does not blank out JSON data', () => {
  const json = R.parseListing(listings.excel[0]).posts[0];
  const dom = { platform: 'reddit', code: json.code, title: json.title, score: json.score - 3, comments: json.comments + 2, type: 'link', url: 'x', upvoteRatio: null, detailed: false, seenAt: Date.now() + 1 };
  const m = R.merge(json, dom);
  assert.equal(m.score, json.score - 3);
  assert.equal(m.comments, json.comments + 2);
  assert.equal(m.type, json.type);
  assert.equal(m.url, json.url);
  assert.equal(m.upvoteRatio, json.upvoteRatio);
  assert.equal(m.detailed, true);
});

test('metrics score Reddit posts against the median score', () => {
  const e = M.enrich([
    { platform: 'reddit', score: 10, comments: 5 }, { platform: 'reddit', score: 10, comments: 1 },
    { platform: 'reddit', score: 10 }, { platform: 'reddit', score: 40, comments: 20 }, { platform: 'reddit', score: 0 }
  ]);
  assert.deepEqual(e.map((p) => p.outlier), [false, false, false, true, false]);
  assert.equal(e[3].ratio, 4);
  assert.equal(e[3].viralScore, 100);
  assert.equal(e[3].engagement, 50); // comments ÷ score
  assert.equal(e[4].viralScore, null);
  assert.deepEqual(M.sortBy(e, 'score').map((p) => p.score), [40, 10, 10, 10, 0]);
});

test('Reddit analytics: heatmap, questions, title words, flair and type', () => {
  const posts = M.enrich(R.parseListing(listings.excel).posts);
  const a = M.analyze(posts);
  assert.equal(a.summary.count, 90);
  assert.ok(a.summary.medianViews > 0, 'median score');
  assert.ok(a.summary.avgUpvoteRatio > 0.7);
  assert.ok(a.heatmap.best && a.heatmap.best.count >= 2);
  assert.ok(a.reddit, 'reddit section only for Reddit lists');
  assert.deepEqual(a.reddit.questions.map((q) => q.key).sort(), ['Question', 'Statement']);
  assert.ok(a.reddit.titleLength.length >= 2);
  assert.ok(a.reddit.words.length > 0 && a.reddit.words.every((w) => w.count >= 3));
  assert.ok(a.reddit.words.some((w) => w.key === 'xlookup'));
  assert.ok(a.reddit.flairs.some((f) => f.key === 'solved'));
  assert.ok(a.reddit.types.some((t) => t.key === 'text'));
  assert.equal(M.analyze(M.enrich([{ views: 5, type: 'reel' }])).reddit, undefined);
});

test('title helpers', () => {
  assert.deepEqual(M.titleWords('How do I use XLOOKUP with #N/A errors in Excel 365?'), ['xlookup', '#n/a', 'errors', 'excel']);
  assert.equal(M.isQuestion('Is there a way to sum by color'), true);
  assert.equal(M.isQuestion('My monthly dashboard'), false);
  assert.equal(M.needKind({ title: 'Formula returns #VALUE! when I drag it down' }), 'pain point');
  assert.equal(M.needKind({ title: 'Pivot table', flair: 'unsolved' }), 'question');
  assert.equal(M.needKind({ title: 'My monthly sales dashboard' }), null);
});

test('content ideas surface strong questions and skip the subreddit name as a theme', () => {
  const posts = M.enrich(R.parseListing(listings.excel).posts);
  const res = M.contentIdeas(posts, { limit: 10 });
  assert.ok(res.matched > 10);
  assert.equal(res.ideas.length, 10);
  assert.ok(res.ideas.every((p) => p.needKind));
  assert.ok(res.ideas[0].ratio >= 2, 'top idea is an outlier for its subreddit');
  assert.ok(res.themes.length > 2);
  assert.ok(!res.themes.some((t) => t.key === 'excel'));
  assert.ok(res.themes.some((t) => t.key === 'xlookup'));
});

test('Reddit CSV uses Reddit columns', () => {
  const posts = M.enrich(R.parseListing(listings.excel[0]).posts);
  const csv = M.toTable(posts.slice(0, 3), ',');
  const [head, first] = csv.split('\r\n');
  assert.equal(head, M.REDDIT_COLUMN_NAMES.join(','));
  assert.match(first, /,r\/excel,u\/user_\d+,/);
  // Instagram lists keep the Instagram columns.
  assert.equal(M.toTable([{ code: 'AAAAAA', views: 1 }]).split('\r\n')[0], M.COLUMN_NAMES.join(','));
});

test('another tab\'s copy never wipes stored posts (mergePostMaps)', () => {
  const stored = {};
  R.parseListing(listings.excel).posts.forEach((p) => { stored[p.code] = p; });
  const first = Object.keys(stored)[0];
  // A tab opened earlier on the home feed saw one r/excel post (from the page, thinner data).
  const mine = { [first]: { platform: 'reddit', code: first, title: stored[first].title, score: stored[first].score + 5, detailed: false, type: 'link' }, newone: { platform: 'reddit', code: 'newone', title: 'Fresh', score: 1 } };
  const merged = R.mergePostMaps(stored, mine);
  assert.equal(Object.keys(merged).length, 91);
  assert.equal(merged[first].score, stored[first].score + 5, 'newer count wins');
  assert.equal(merged[first].type, stored[first].type, 'JSON fields survive');
  assert.equal(merged[first].upvoteRatio, stored[first].upvoteRatio);
});

test('a bare % in the query string does not crash page detection', () => {
  assert.equal(R.pageContext('/r/excel/top/', '?t=year&q=100%').kind, 'subreddit');
  assert.equal(R.pageContext('/r/excel/top/', '?q=%E0%A4%A&t=week').t, 'week');
});

test('only https links leave the parser', () => {
  const p = R.parseThing({ id: 'lnk1', title: 't', subreddit: 'excel', url: 'javascript:alert(1)', is_self: false, permalink: '/r/excel/comments/lnk1/t/' });
  assert.equal(p.linkUrl, null);
  assert.equal(R.parseThing({ id: 'lnk2', title: 't', subreddit: 'excel', url: 'https://example.com/a', is_self: false }).linkUrl, 'https://example.com/a');
  const dom = R.fromShredditAttrs({ id: 't3_abc99', 'post-title': 'x', permalink: 'javascript:alert(1)', 'content-href': 'data:text/html,hi', 'post-type': 'link' });
  assert.equal(dom.url, 'https://www.reddit.com/comments/abc99/');
  assert.equal(dom.linkUrl, null);
  assert.equal(R.fromShredditAttrs({ id: 't3_abc98', 'post-title': 'x', permalink: 'https://www.reddit.com/r/excel/comments/abc98/x/' }).url, 'https://www.reddit.com/r/excel/comments/abc98/x/');
  assert.equal(R.isRedditUrl('https://evil.com/reddit.com'), false);
  assert.equal(R.isRedditUrl('https://reddit.com.evil.com/'), false);
});
