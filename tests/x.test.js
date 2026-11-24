// X (x.com) parser and scoring: one test per GraphQL operation (fixtures from dev/make-x-fixture.mjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const X = require('../src/x.js');
const M = require('../src/metrics.js');

const dir = path.join(__dirname, '..', 'dev', 'x');
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
const pages = (op) => JSON.parse(fs.readFileSync(path.join(dir, op + '.json'), 'utf8'));
const parse = (op, i = 0) => { const pg = pages(op)[i]; return X.parsePayload(pg.url, JSON.stringify(pg.body)); };
const allOf = (op) => pages(op).flatMap((pg) => X.parsePayload(pg.url, JSON.stringify(pg.body)).posts);
const DEMO = 'x/excelbugs_demo';
const own = () => allOf('UserOriginalsTimeline').filter((p) => p.owner === DEMO);
const byId = (list, id) => list.find((p) => p.code === id);

test('operation names come from the URL; unknown operations are ignored', () => {
  assert.equal(X.opOf('https://x.com/i/api/graphql/AbC-12_x/UserOriginalsTimeline?variables=%7B%7D'), 'UserOriginalsTimeline');
  assert.equal(X.opOf('https://x.com/i/api/graphql/zzz/TweetDetail'), 'TweetDetail');
  assert.equal(X.opOf('https://x.com/i/api/1.1/jot/client_event.json'), null);
  assert.equal(X.parsePayload('https://x.com/i/api/graphql/q/ViewerBadgeCounts', '{"data":{}}'), null);
  for (const op of X.OPS) assert.match(op, /^[A-Za-z]+$/);
});

test('snowflake ids give the exact post time', () => {
  // (id >> 22) + 1288834974657: 1590000000000000000 → 2022-11-08T15:15:15.428Z
  assert.equal(new Date(X.snowflakeTime('1590000000000000000')).toISOString(), '2022-11-08T15:15:15.428Z');
  assert.equal(X.snowflakeTime(String((BigInt(Date.UTC(2026, 0, 2)) - 1288834974657n) << 22n)), Date.UTC(2026, 0, 2));
  assert.equal(X.snowflakeTime('20'), null); // pre-snowflake
  assert.equal(X.snowflakeTime('nope'), null);
});

test('UserOriginalsTimeline: entries sorted by sortIndex (BigInt), pinned entry, tombstones skipped, cursors', () => {
  const r = parse('UserOriginalsTimeline', 0);
  assert.equal(r.op, 'UserOriginalsTimeline');
  assert.ok(r.cursors.bottom && r.cursors.top);
  const mine = r.posts.filter((p) => p.owner === DEMO);
  const unpinned = mine.filter((p) => !p.pinned);
  for (let i = 1; i < unpinned.length; i++) assert.ok(BigInt(unpinned[i - 1].code) > BigInt(unpinned[i].code), 'newest first');
  const pinned = byId(r.posts, meta.ids.pinned);
  assert.equal(pinned.pinned, true);
  assert.equal(pinned.type, 'video');
  // Tombstone and TweetUnavailable entries on page 2 add nothing.
  const r2 = parse('UserOriginalsTimeline', 1);
  assert.ok(r2.posts.every((p) => /^\d+$/.test(p.code) && p.code.length > 5));
});

test('post fields: counters, views, time, text, media, url, author facts', () => {
  const posts = own();
  const big = byId(posts, meta.ids.bigImage);
  const raw = pages('TweetResultByRestId')[0].body.data.tweetResult.result;
  assert.equal(big.platform, 'x');
  assert.equal(big.url, 'https://x.com/ExcelBugs_Demo/status/' + raw.rest_id);
  assert.equal(big.owner, DEMO);
  assert.equal(big.author, 'ExcelBugs_Demo');
  assert.equal(big.ownerId, meta.demo.restId);
  assert.equal(big.ownerName, 'Excel Bugs (demo)');
  assert.equal(big.ownerFollowers, 18400);
  assert.equal(big.ownerVerified, true);
  assert.deepEqual(big.rel, { following: true, followedBy: true });
  assert.equal(big.views, Number(raw.views.count));
  assert.equal(typeof big.views, 'number');
  assert.equal(big.likes, raw.legacy.favorite_count);
  assert.equal(big.comments, raw.legacy.reply_count);
  assert.equal(big.shares, raw.legacy.retweet_count);
  assert.equal(big.quotes, raw.legacy.quote_count);
  assert.equal(big.saves, raw.legacy.bookmark_count);
  assert.equal(big.takenAt, X.snowflakeTime(raw.rest_id));
  assert.equal(new Date(big.takenAt).toUTCString().slice(0, 16), new Date(Date.parse(raw.legacy.created_at)).toUTCString().slice(0, 16));
  assert.equal(big.kind, 'original');
  assert.equal(big.type, 'image');
  assert.equal(big.caption, 'The 3 Excel shortcuts nobody taught you #excel #shortcuts'); // trailing t.co link dropped
  assert.deepEqual(big.hashtags, ['excel', 'shortcuts']);
  assert.equal(big.media[0].kind, 'photo');
  assert.match(big.files[0].url, /\?name=orig$/);
  assert.equal(big.isReply, false);
  assert.equal(big.isRepost, false);
  assert.equal(big.hasLink, false);
  assert.equal(big.aiGenerated, false);
});

test('views: a missing count is null (posts before 2023), never 0', () => {
  const posts = own();
  for (const id of meta.ids.old) {
    const p = byId(posts, id);
    assert.equal(p.views, null);
    assert.equal(p.viewsHidden, true);
    assert.ok(p.likes > 0);
    assert.ok(new Date(p.takenAt).getUTCFullYear() === 2021);
  }
});

test('formats: video (duration, best mp4), quote, link, thread root, article; long text from note_tweet', () => {
  const posts = own();
  const video = posts.find((p) => p.type === 'video' && !p.pinned);
  assert.ok(video.duration > 0);
  assert.match(video.files[0].url, /1280x720/); // highest bitrate mp4
  assert.equal(video.files[0].kind, 'video');
  const quote = posts.find((p) => p.type === 'quote');
  assert.ok(quote.quotedId);
  // The quoted post is saved too, under its own author.
  assert.ok(allOf('UserOriginalsTimeline').some((p) => p.code === quote.quotedId && p.owner === 'x/sheettips_demo'));
  const link = posts.find((p) => p.type === 'link');
  assert.equal(link.hasLink, true);
  assert.match(link.links[0], /^https:\/\/excelbugs\.example\//);
  const thread = posts.filter((p) => p.type === 'thread');
  assert.equal(thread.length, 3); // legacy.self_thread.id_str === own id
  const art = byId(posts, meta.ids.article);
  assert.equal(art.type, 'article');
  assert.equal(art.article.title, 'The complete guide to dynamic arrays');
  const long = byId(posts, meta.ids.longPost);
  assert.ok(long.caption.length > 280);
  assert.ok(long.caption.startsWith('Long post about LET'));
  assert.ok(!long.caption.includes('…'));
});

test('edit_control and AI disclosure', () => {
  const posts = own();
  const ed = byId(posts, meta.ids.edited);
  assert.equal(ed.edit.edited, true);
  assert.equal(ed.edit.ids.length, 2);
  assert.equal(ed.edit.editsRemaining, 4);
  assert.equal(byId(posts, meta.ids.bigImage).edit.edited, false);
  assert.equal(byId(posts, meta.ids.aiImage).aiGenerated, true);
});

test('user fields: new core.* / relationship_counts.* shape (no legacy)', () => {
  const r = parse('UserByScreenName');
  const u = r.profileUser;
  assert.equal(u.id, DEMO);
  assert.equal(u.handle, 'ExcelBugs_Demo');
  assert.equal(u.restId, meta.demo.restId);
  assert.equal(u.followers, 18400);
  assert.equal(u.following, 300);
  assert.equal(u.posts, 2140);
  assert.equal(u.blueVerified, true);
  assert.equal(u.createdAt, Date.UTC(2019, 4, 2));
  assert.match(u.avatar, /^https:\/\/pbs\.twimg\.com\//);
  assert.deepEqual(u.rel, { following: true, followedBy: true });
  assert.deepEqual(u.pinnedIds, [meta.ids.pinned]);
  assert.equal(r.posts.length, 0);
});

test('UserTweets with the old legacy user shape still parses (fallback); legacy timeline_v2 path', () => {
  const r = parse('UserTweets');
  const mine = r.posts.filter((p) => p.owner === 'x/tiny_maker_demo');
  assert.equal(mine.length, 9);
  assert.equal(mine[0].ownerFollowers, 85);
  assert.equal(mine[0].ownerVerified, false);
  assert.deepEqual(mine[0].rel, { following: false, followedBy: false });
  const u = r.users.find((x) => x.handle === 'tiny_maker_demo');
  assert.equal(u.following, 401);
  assert.equal(mine.filter((p) => p.type === 'quote').length, 4);
});

test('UserRepliesTimeline: profile-conversation modules → the parent post and the reply', () => {
  const r = parse('UserRepliesTimeline');
  const replies = r.posts.filter((p) => p.owner === DEMO);
  assert.equal(replies.length, 6);
  for (const p of replies) {
    assert.equal(p.kind, 'reply');
    assert.equal(p.isReply, true);
    assert.ok(p.replyToId && p.replyToUser);
    assert.equal(p.conversationId, p.replyToId);
  }
  assert.equal(r.posts.filter((p) => p.owner !== DEMO).length, 6);
});

test('UserRepostsTimeline: the repost record and the original under its own author', () => {
  const r = parse('UserRepostsTimeline');
  const reps = r.posts.filter((p) => p.kind === 'repost');
  assert.equal(reps.length, 3);
  for (const p of reps) {
    assert.equal(p.owner, DEMO);
    assert.equal(p.isRepost, true);
    assert.equal(p.views, null);
    assert.ok(meta.ids.reposted.includes(p.repostOf));
  }
  const orig = r.posts.filter((p) => meta.ids.reposted.includes(p.code));
  assert.equal(orig.length, 3);
  assert.ok(orig.every((p) => p.owner === 'x/sheettips_demo' && p.views > 80000 && p.type === 'image'));
});

test('UserVideoTimeline / UserPhotoTimeline: grid modules and TimelineAddToModule', () => {
  const v = allOf('UserVideoTimeline');
  assert.equal(v.length, 10);
  assert.ok(v.every((p) => p.type === 'video'));
  assert.ok(parse('UserPhotoTimeline').posts.every((p) => p.type === 'image'));
  assert.equal(parse('UserHighlightsTweets').posts.length, 2);
  assert.equal(parse('UserTweetsAndReplies').posts.length, 2);
});

test('HomeTimeline: several authors, visibility wrapper unwrapped, promoted flagged, repost unpacked', () => {
  const r = parse('HomeTimeline');
  assert.ok(r.cursors.top && r.cursors.bottom);
  const owners = new Set(r.posts.map((p) => p.owner));
  assert.ok(owners.has('x/tiny_maker_demo')); // came wrapped in TweetWithVisibilityResults
  const promo = byId(r.posts, meta.ids.promo);
  assert.equal(promo.promoted, true);
  assert.equal(promo.type, 'link');
  const rep = r.posts.find((p) => p.kind === 'repost');
  assert.equal(rep.owner, 'x/reply_guy_demo');
  assert.ok(byId(r.posts, rep.repostOf));
  // Every author's facts come along (followers for the follower-range filter).
  assert.equal(r.users.find((u) => u.handle === 'SheetTips_Demo').followers, 920000);
  assert.equal(parse('HomeLatestTimeline').posts.length, 2);
});

test('SearchTimeline and ListLatestTweetsTimeline', () => {
  const s = parse('SearchTimeline');
  assert.equal(s.posts.length, 2);
  assert.deepEqual(s.posts[0].hashtags, ['excel']);
  assert.equal(parse('ListLatestTweetsTimeline').posts.length, 2);
});

test('TweetDetail: thread root, self-replies are thread parts, others are replies, related posts', () => {
  const posts = allOf('TweetDetail');
  const root = byId(posts, meta.ids.root);
  assert.equal(root.kind, 'original');
  assert.equal(root.type, 'thread');
  assert.equal(root.threadLength, 3); // root + 2 parts seen on the first page
  for (const id of meta.ids.parts) {
    const p = byId(posts, id);
    assert.equal(p.kind, 'thread-part');
    assert.equal(p.threadOf, meta.ids.root);
  }
  for (const id of meta.ids.others) assert.equal(byId(posts, id).kind, 'reply');
  assert.ok(byId(posts, meta.ids.related));
  // Across pages: the third part (TimelineAddToModule) links to the same root.
  const all = X.linkThreads(posts.map((p) => ({ ...p })));
  assert.equal(byId(all, meta.ids.root).threadLength, 4);
});

test('TweetResultByRestId and BlueVerifiedFollowers', () => {
  const t = parse('TweetResultByRestId');
  assert.equal(t.posts[0].code, meta.ids.bigImage);
  const b = parse('BlueVerifiedFollowers');
  assert.equal(b.posts.length, 0);
  assert.deepEqual(b.users.map((u) => u.handle).sort(), ['AdBrand_Demo', 'SheetTips_Demo']);
});

test('analytics operations are kept raw for Phase 2', () => {
  const a = parse('accountOverviewDailyQuery');
  assert.equal(a.posts.length, 0);
  assert.equal(a.raw.data.viewer_v2.user_results.result.verified_follower_count, '9');
  assert.ok(parse('contentPageQuery').raw);
});

test('rate-limit headers → { limit, remaining, reset ms }', () => {
  const pg = pages('SearchTimeline')[0];
  const rl = X.rateLimit(pg.rateLimit);
  assert.equal(rl.limit, 50);
  assert.equal(rl.remaining, 49);
  assert.equal(rl.reset, pg.rateLimit.reset * 1000);
  assert.equal(X.rateLimit({}), null);
  assert.deepEqual(X.rateLimit({ limit: '250', remaining: '12', reset: '1795000000' }), { limit: 250, remaining: 12, reset: 1795000000000 });
});

test('merge: counts only grow, a thread stays a thread, views appear later', () => {
  const a = { code: '1', views: null, viewsHidden: true, likes: 5, type: 'thread', pinned: true };
  const b = { code: '1', views: 40, viewsHidden: false, likes: 3, type: 'text', pinned: false };
  const m = X.merge(a, b);
  assert.equal(m.views, 40);
  assert.equal(m.viewsHidden, false);
  assert.equal(m.likes, 5);
  assert.equal(m.type, 'thread');
  assert.equal(m.pinned, true);
  const p = X.mergeProfile({ followers: 10, rel: { following: true, followedBy: null } }, { followers: 12, rel: { following: null, followedBy: true } });
  assert.deepEqual(p, { followers: 12, rel: { following: true, followedBy: true } });
});

test('pageContext, postIdOf, normHandle', () => {
  assert.deepEqual(X.pageContext('/heyEshagh'), { kind: 'profile', handle: 'heyEshagh', id: 'x/heyeshagh', tab: 'posts', status: null, list: null });
  assert.equal(X.pageContext('/heyEshagh/with_replies').tab, 'with_replies');
  assert.equal(X.pageContext('/heyEshagh/media').tab, 'media');
  assert.equal(X.pageContext('/heyEshagh/status/123456789').kind, 'status');
  assert.equal(X.pageContext('/heyEshagh/status/123456789').status, '123456789');
  assert.equal(X.pageContext('/home').kind, 'home');
  assert.equal(X.pageContext('/search').kind, 'search');
  assert.equal(X.pageContext('/i/lists/42').list, '42');
  assert.equal(X.pageContext('/explore').kind, 'other');
  assert.equal(X.pageContext('/heyEshagh/followers').kind, 'other');
  assert.equal(X.postIdOf('https://x.com/a_b/status/1890000000000000000?s=20'), '1890000000000000000');
  assert.equal(X.postIdOf('https://twitter.com/i/web/status/1890000000000000000'), '1890000000000000000');
  assert.equal(X.normHandle('x/HeyEshagh'), 'x/heyeshagh');
  assert.equal(X.normHandle('https://x.com/heyEshagh/status/1'), 'x/heyeshagh');
  assert.equal(X.normHandle('@heyEshagh'), 'x/heyeshagh');
  assert.equal(X.normHandle('x.com/home'), null);
  assert.equal(X.isXId('x/heyeshagh'), true);
  assert.equal(X.isXId('tt/heyeshagh'), false);
});

// ---- scoring ------------------------------------------------------------------
test('per-format medians over originals with views; 90 days / last 50 window', () => {
  const posts = own();
  const b = M.xBaselines(posts, { now: meta.now })[DEMO];
  assert.equal(b.n, 50); // fewer than 50 originals in the last 90 days → the newest 50
  assert.ok(Math.abs(b.byFormat.image.med - 3000) / 3000 < 0.2, 'image median ≈ 3K, got ' + b.byFormat.image.med);
  assert.ok(Math.abs(b.byFormat.video.med - 9000) / 9000 < 0.2);
  assert.equal(b.byFormat.link.med, null); // 5 links < 8
  assert.equal(b.byFormat.thread.med, null);
  // Pinned, fresh (< 24 h), old (no views) and replies stay out.
  const enriched = M.enrich(posts.concat(allOf('UserRepliesTimeline').filter((p) => p.owner === DEMO)), { now: meta.now });
  const big = byId(enriched, meta.ids.bigImage);
  assert.ok(big.ratio > 10 && big.ratio < 14);
  assert.equal(big.outlier, true);
  assert.equal(big.viralScore, 100);
  assert.equal(big.baselineApprox, false);
  assert.equal(big.baselineScope, 'format');
  const link = enriched.find((p) => p.type === 'link' && p.owner === DEMO);
  assert.equal(link.baselineApprox, true); // ≈: the overall median
  assert.equal(link.baseline, b.all);
  const old = byId(enriched, meta.ids.old[0]);
  assert.equal(old.ratio, null);
  assert.equal(old.noViews, true);
  const fresh = byId(enriched, meta.ids.fresh);
  assert.ok(fresh.ratio > 0); // scored, just not in the median
  const reply = enriched.find((p) => p.kind === 'reply');
  assert.equal(reply.baseline, b.all);
  assert.equal(reply.baselineScope, 'all');
  // One median per author when asked.
  const single = M.enrich(posts, { now: meta.now, xSingleMedian: true });
  assert.equal(byId(single, meta.ids.bigImage).baseline, b.all);
  // Engagement counts likes + replies + reposts + quotes + bookmarks.
  assert.equal(big.engagement, (big.likes + big.comments + big.shares + big.quotes + big.saves) / big.views * 100);
});

test('fewer than 8 originals with views: no score ("not enough data")', () => {
  const few = own().slice(0, 7).map((p) => ({ ...p, pinned: false }));
  const e = M.enrich(few, { now: meta.now });
  assert.ok(e.every((p) => p.ratio === null));
});

test('Library baselines win over page posts; page baselines can be marked approximate', () => {
  const home = parse('HomeTimeline').posts;
  const lib = M.xBaselines(own(), { now: meta.now });
  const e = M.enrich(home, { now: meta.now, xBaselines: lib });
  const demoPost = e.find((p) => p.owner === DEMO);
  assert.ok(demoPost.ratio > 0);
  assert.equal(demoPost.baselineApprox, false);
  assert.equal(e.find((p) => p.owner === 'x/sheettips_demo').ratio, null); // one post on the page: no median
  const approx = M.xBaselines(own(), { now: meta.now, approx: true });
  assert.equal(M.enrich(home, { now: meta.now, xBaselines: approx }).find((p) => p.owner === DEMO).baselineApprox, true);
});

test('analyze and CSV for X lists', () => {
  const e = M.enrich(own(), { now: meta.now });
  const a = M.analyze(e, { all: e });
  assert.ok(a.x.formats.some((f) => f.key === 'Quote'));
  assert.ok(a.x.noViews >= 4);
  assert.ok(a.x.approxMedian > 0);
  const csv = M.toTable(M.sortBy(e, 'viralScore'), ',');
  const header = csv.split('\r\n')[0].split(',');
  assert.deepEqual(header, M.X_COLUMN_NAMES);
  assert.ok(header.includes('median_approx') && header.includes('author_followers') && header.includes('bookmarks'));
  assert.match(M.fileBaseName(e[0]), /_x_\d+$/);
});

// ---- hook (src/hook.js on x.com) ------------------------------------------------
const vm = require('node:vm');
function runXHook(responses) {
  const posted = [];
  function FakeXHR() { this.listeners = {}; this.responseType = ''; }
  FakeXHR.prototype.open = function (m, u) { this.url = u; };
  FakeXHR.prototype.send = function () {
    const r = responses[this.url] || { status: 200, text: '{}', headers: {} };
    this.status = r.status;
    this.responseText = r.text;
    this.getResponseHeader = (n) => (r.headers[n] !== undefined ? String(r.headers[n]) : null);
    (this.listeners.load || []).forEach((fn) => fn());
  };
  FakeXHR.prototype.addEventListener = function (t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); };
  const window = { fetch: undefined, XMLHttpRequest: FakeXHR, postMessage: (m) => posted.push(m), location: { origin: 'https://x.com' } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'hook.js'), 'utf8'), { window, location: { hostname: 'x.com' } });
  for (const u of Object.keys(responses)) { const x = new window.XMLHttpRequest(); x.open('GET', u); x.send(); }
  return posted;
}

test('hook: x.com GraphQL responses are forwarded with their rate-limit headers; 429 still reports', () => {
  const pg = pages('UserOriginalsTimeline')[0];
  const rl = { 'x-rate-limit-limit': 250, 'x-rate-limit-remaining': 18, 'x-rate-limit-reset': 1795000000 };
  const posted = runXHook({
    [pg.url]: { status: 200, text: JSON.stringify(pg.body), headers: rl },
    [pages('UserByScreenName')[0].url]: { status: 200, text: JSON.stringify(pages('UserByScreenName')[0].body), headers: rl },
    'https://x.com/i/api/graphql/q/UserOriginalsTimeline?variables=2': { status: 429, text: '{"errors":[{"message":"Rate limit exceeded"}]}', headers: { 'x-rate-limit-remaining': 0, 'x-rate-limit-reset': 1795000000 } },
    'https://x.com/i/api/1.1/jot/client_event.json': { status: 200, text: '{"rest_id":"1","tweet_results":{}}', headers: {} }
  });
  const payloads = posted.filter((m) => m.type === 'payload');
  assert.equal(payloads.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(payloads[0].rateLimit)), { limit: '250', remaining: '18', reset: '1795000000' });
  assert.equal(X.parsePayload(payloads[0].url, payloads[0].text).posts.length > 10, true);
  const rates = posted.filter((m) => m.type === 'ratelimit');
  assert.equal(rates.length, 3);
  assert.equal(rates[2].status, 429);
  assert.equal(X.rateLimit(rates[2].rateLimit).remaining, 0);
});

test('swipe file: X posts are saved with the post id, format, account and × median; links go to x.com', () => {
  const SW = require('../src/swipe.js');
  const out = SW.save({ folders: [], accounts: {} }, { platform: 'x', video: meta.ids.bigImage, type: 'image', title: 'The 3 Excel shortcuts', channel: 'Excel Bugs (demo)', account: DEMO, views: 36000, ratio: 12, clip: { start: 1, end: 5 } }, 1000);
  assert.equal(out.added, true);
  assert.equal(out.item.platform, 'x');
  assert.equal(out.item.type, 'image');
  assert.equal(out.item.account, DEMO);
  assert.equal(out.item.ratio, 12);
  assert.equal(out.item.clip, null);
  assert.equal(SW.url(out.item), 'https://x.com/excelbugs_demo/status/' + meta.ids.bigImage);
  assert.equal(SW.save({ folders: [] }, { platform: 'x', video: 'not-an-id' }).item, null);
  // YouTube items are unchanged.
  assert.equal(SW.save({ folders: [] }, { video: 'abcdefghijk', type: 'short' }).item.platform, 'youtube');
});

// Live check 2026-11-24: two operations x.com loads that the synthetic fixtures did not have.
test('UserArticlesTweets (profile → Articles) and CommunityTweetsTimeline (a pinned community tab) are read', () => {
  const src = pages('UserOriginalsTimeline')[0].body;
  const instructions = src.data.user.result.timeline.timeline.instructions;
  const articles = X.parsePayload('https://x.com/i/api/graphql/q/UserArticlesTweets', JSON.stringify(src));
  assert.ok(articles && articles.posts.length > 0);
  assert.ok(X.PROFILE_OPS.includes('UserArticlesTweets'));
  const community = { data: { communityResults: { result: { __typename: 'Community', ranked_community_timeline: { timeline: { instructions } } } } } };
  const c = X.parsePayload('https://x.com/i/api/graphql/q/CommunityTweetsTimeline', JSON.stringify(community));
  assert.ok(c && c.posts.length > 0);
  assert.equal(c.posts.length, X.parsePayload(pages('UserOriginalsTimeline')[0].url, JSON.stringify(src)).posts.length);
  assert.ok(!X.PROFILE_OPS.includes('CommunityTweetsTimeline'));
});

// Live check 2026-11-24: @levelsio quotes his own old posts, which stopped auto-scroll at "6 months" after one page.
test('posts reached only inside a quote or a repost are flagged embedded; a timeline sighting clears the flag', () => {
  const all = pages('UserOriginalsTimeline').flatMap((pg) => X.parsePayload(pg.url, JSON.stringify(pg.body)).posts);
  assert.ok(all.every((p) => typeof p.embedded === 'boolean'));
  const quoting = all.find((p) => p.quotedId && !p.embedded);
  if (quoting) assert.equal(all.find((p) => p.code === quoting.quotedId)?.embedded ?? true, true);
  assert.equal(X.merge({ code: '1', embedded: true }, { code: '1', embedded: false }).embedded, false);
  assert.equal(X.merge({ code: '1', embedded: false }, { code: '1', embedded: true }).embedded, false);
  assert.equal(X.merge({ code: '1' }, { code: '1', embedded: true }).embedded, true);
});
