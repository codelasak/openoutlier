// X Phase 3 (src/x-growth.js): niche sources, the reply opportunities score, reply ROI, the CRM
// store, consistency streaks and saved searches, over the dev/x/growth fixtures
// (node dev/make-x-growth-fixture.mjs).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const X = require('../src/x.js');
const M = require('../src/metrics.js');
const G = require('../src/x-growth.js');

const dir = path.join(__dirname, '..', 'dev', 'x', 'growth');
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
const NOW = meta.now;
const MIN = 60000;
const DAY = 864e5;
const ids = meta.ids;
const ME = { id: 'x/' + meta.me.handle.toLowerCase(), handle: meta.me.handle, restId: meta.me.restId, followers: meta.me.followers };
const A = 'x/' + meta.users.A;
const B = 'x/' + meta.users.B;
const Cc = 'x/' + meta.users.C;
const D = 'x/' + meta.users.D;

function pages(name) { return JSON.parse(fs.readFileSync(path.join(dir, name + '.json'), 'utf8')); }
/** Parse a fixture as x-content.js would, with seenAt = the fixture's "now". */
function parse(name) {
  const pg = pages(name)[0];
  const r = X.parsePayload(pg.url, JSON.stringify(pg.body));
  if (r) r.posts.forEach((p) => { p.seenAt = NOW; });
  return r;
}
const byCode = (posts) => Object.fromEntries(posts.map((p) => [p.code, p]));

// ---- parsing: the list and the Following tab (plan 4.1) -------------------------------------------
test('ListLatestTweetsTimeline: list posts parse with kind, rel and promoted flags', () => {
  const r = parse('ListLatestTweetsTimeline');
  assert.equal(r.op, 'ListLatestTweetsTimeline');
  assert.equal(G.sourceOf(r.op), 'list');
  const p = byCode(r.posts);
  assert.equal(p[ids.aFresh].kind, 'original');
  assert.deepEqual(p[ids.aFresh].rel, { following: true, followedBy: true });
  assert.equal(p[ids.aFresh].ownerFollowers, 1200);
  assert.equal(p[ids.aReply].kind, 'reply');
  assert.equal(p[ids.aRepost].kind, 'repost');
  assert.equal(p[ids.promo].promoted, true);
  assert.equal(p[ids.dList].rel.following, false, 'a list member the user does not follow');
  assert.equal(X.pageContext('/i/lists/' + meta.listId).list, meta.listId);
});

test('HomeLatestTimeline (the Following tab) unwraps visibility results', () => {
  const r = parse('HomeLatestTimeline');
  assert.equal(G.sourceOf(r.op), 'following');
  assert.deepEqual(r.posts.map((p) => p.code).sort(), [ids.aHour, ids.cQuiet].sort());
  assert.equal(G.sourceOf('HomeTimeline'), 'home');
  assert.equal(G.sourceOf('SearchTimeline'), 'search');
  assert.equal(G.sourceOf('UserTweets'), null);
});

test('niche folders: mark, members, list authors missing from the folder', () => {
  const org = { folders: [{ id: 'f1', name: 'Excel X' }, { id: 'f2', name: 'Other' }], accounts: { [A]: { folder: 'f1', tags: [] }, [B]: { folder: 'f1', tags: [] }, [D]: { folder: 'f2', tags: [] }, excelbugs: { folder: 'f1', tags: [] } } };
  assert.equal(G.nicheMembers(org), null, 'no folder marked → null (fall back to followed accounts)');
  const marked = G.setNicheFolder(org, 'f1', true);
  assert.deepEqual(marked.xNiche, { folders: ['f1'] });
  assert.equal(org.xNiche, undefined, 'pure: the input is untouched');
  assert.deepEqual(G.setNicheFolder(marked, 'f1', true).xNiche.folders, ['f1'], 'idempotent');
  assert.deepEqual(G.setNicheFolder(marked, 'nope', true).xNiche.folders, ['f1'], 'unknown folder ignored');
  assert.deepEqual(G.nicheMembers(marked), { [A]: true, [B]: true }, 'X accounts only');
  assert.deepEqual(G.nicheFolders({ folders: [], xNiche: { folders: ['gone'] } }), [], 'deleted folders drop out');
  assert.deepEqual(G.setNicheFolder(marked, 'f1', false).xNiche.folders, []);

  const r = parse('ListLatestTweetsTimeline');
  const src = G.noteSource({}, r.op, meta.listId, r.posts, NOW);
  assert.equal(src.lists[meta.listId].seenAt, NOW);
  assert.ok(!src.lists[meta.listId].authors.includes('x/promo_demo'), 'promoted authors are not list members');
  assert.deepEqual(G.listAuthorsMissing(src, meta.listId, G.nicheMembers(marked)).sort(), [Cc, D].sort());
  const f = G.noteSource(src, 'HomeLatestTimeline', null, [], NOW + 1);
  assert.equal(f.followingAt, NOW + 1);
  assert.ok(f.lists[meta.listId], 'keeps the lists');
});

test('feed and pace: fresh originals only, samples per age, pruning', () => {
  const r = parse('ListLatestTweetsTimeline');
  const feed = G.feedAdd({}, r.posts, 'list', NOW);
  const codes = Object.keys(feed.posts).sort();
  assert.deepEqual(codes, [ids.aFresh, ids.bBig, ids.cQuiet, ids.dList].sort(), 'no reply, repost, promoted or >3 h post');
  assert.deepEqual(feed.posts[ids.aFresh].sources, ['list']);
  const f2 = G.feedAdd(feed, parse('HomeLatestTimeline').posts, 'following', NOW);
  assert.deepEqual(f2.posts[ids.cQuiet].sources, ['list', 'following']);
  assert.equal(Object.keys(G.feedPrune(f2, NOW + 3 * 3600000).posts).length, 0, 'everything ages out');

  let pace = G.paceAdd({}, r.posts, NOW);
  assert.deepEqual(pace.posts[ids.aFresh], { o: A, t: NOW - 20 * MIN, s: [[20, 300]] });
  assert.ok(!pace.posts[ids.aOld] || pace.posts[ids.aOld].s.length === 1);
  // 2 minutes later: under the 4-minute gap → the sample is updated, not added
  pace = G.paceAdd(pace, [Object.assign({}, r.posts.find((p) => p.code === ids.aFresh), { views: 320, seenAt: NOW + 2 * MIN })], NOW + 2 * MIN);
  assert.deepEqual(pace.posts[ids.aFresh].s, [[20, 320]]);
  pace = G.paceAdd(pace, [Object.assign({}, r.posts.find((p) => p.code === ids.aFresh), { views: 500, seenAt: NOW + 10 * MIN })], NOW + 10 * MIN);
  assert.deepEqual(pace.posts[ids.aFresh].s, [[20, 320], [30, 500]]);
  assert.equal(G.viewsAt([[20, 320], [30, 500]], 25), 410);
  assert.equal(G.viewsAt([[20, 320], [30, 500]], 10), 160, 'linear from (0, 0)');
  assert.equal(G.viewsAt([[20, 320]], 40), null, 'samples must reach the age');
  assert.equal(Object.keys(G.pacePrune(pace, NOW + 31 * DAY).posts).length, 0);
});

test('injected history (x_post_stats / snapshots rows) → pace', () => {
  const t0 = NOW - 5 * DAY;
  const rows = [
    { post_id: '1', owner: A, ts: t0 + 30 * MIN, views: 200, taken_at: t0 },
    { code: '1', account_id: A, seen_at: t0 + 60 * MIN, views: 400, takenAt: t0 },
    { id: '2', account: A, captured_at: new Date(t0 + 30 * MIN).toISOString(), views: 100 },
    { post_id: '3', ts: t0 + 30 * MIN, views: 999 }, // no owner, no post → dropped
    { post_id: '4', owner: A, ts: t0 + 10 * DAY, views: 5, taken_at: t0 } // too old for "early"
  ];
  const pace = G.paceFromRows(rows, { 2: { owner: A, takenAt: t0 } });
  assert.deepEqual(pace.posts['1'].s, [[30, 200], [60, 400]]);
  assert.deepEqual(pace.posts['2'], { o: A, t: t0, s: [[30, 100]] });
  assert.equal(pace.posts['3'], undefined);
  assert.equal(pace.posts['4'], undefined);
  const merged = G.mergePace({ posts: { 1: { o: A, t: t0, s: [[45, 300]] } } }, pace);
  assert.deepEqual(merged.posts['1'].s, [[30, 200], [45, 300], [60, 400]]);
});

// ---- the score (plan 4.2) ---------------------------------------------------------------------------
test('score parts: saturation, mutual bonus, size fit', () => {
  assert.equal(G.saturation(0, 1000).factor, 1);
  assert.equal(G.saturation(30, 100000).factor, 0.5, '30 replies halve it');
  assert.equal(G.saturation(15, 1000).factor.toFixed(3), (1 / 1.5 * 1 / 2).toFixed(3), '1.5 % replies/views: ratio penalty ×0.5');
  assert.deepEqual(G.mutualOf({ following: true, followedBy: true }), { factor: 1.5, kind: 'mutual' });
  assert.deepEqual(G.mutualOf({ following: false, followedBy: true }), { factor: 1.3, kind: 'follows_you' });
  assert.deepEqual(G.mutualOf({ following: true, followedBy: false }), { factor: 1, kind: 'you_follow' });
  assert.deepEqual(G.mutualOf(null), { factor: 1, kind: null });
  assert.equal(G.sizeFit(80, 80).factor, 1);
  assert.equal(G.sizeFit(2400, 80).factor, 1, '30× is still in the sweet spot');
  assert.equal(G.sizeFit(40, 80).factor, 0.75, 'smaller than you');
  assert.equal(G.sizeFit(24000, 80).factor.toFixed(3), (1 / (1 + Math.log10(10))).toFixed(3), '300× → 0.5');
  assert.equal(G.sizeFit(1000, null).factor, 1, 'unknown followers: neutral');
});

function niche() {
  const lib = parse('UserOriginalsTimeline-niche').posts; // A's history: median 1,000
  const listPosts = parse('ListLatestTweetsTimeline').posts;
  const following = parse('HomeLatestTimeline').posts;
  const baselines = M.xBaselines(lib, { now: NOW });
  return { lib, listPosts, following, baselines };
}

test('velocity: lifetime fallback (median ÷ 6 h) and the history pace', () => {
  const { listPosts, baselines } = niche();
  assert.equal(baselines[A].byFormat.text.med, 1000);
  const aFresh = listPosts.find((p) => p.code === ids.aFresh);
  const s = G.scoreOpportunity(aFresh, { now: NOW, myFollowers: 80, baselines, pace: null });
  assert.equal(s.velocityBasis, 'lifetime');
  assert.equal(s.expected, Math.round(1000 * 20 / 360));
  assert.equal(s.velocity, +(300 / (1000 * 20 / 360)).toFixed(2));
  assert.equal(s.mutual, 'mutual');
  assert.equal(s.ageMin, 20);
  assert.equal(s.coldStart, false, '300 views ≥ 200');

  // History: three earlier A posts had ~150 views at 20 minutes → 300 is 2×.
  const pace = { posts: {} };
  [140, 150, 160].forEach((v, i) => { pace.posts['h' + i] = { o: A, t: NOW - (i + 2) * DAY, s: [[10, v / 2], [30, v * 1.5]] }; });
  const h = G.scoreOpportunity(aFresh, { now: NOW, myFollowers: 80, baselines, pace });
  assert.equal(h.velocityBasis, 'history');
  assert.equal(h.historyPosts, 3);
  assert.equal(h.expected, 150);
  assert.equal(h.velocity, 2);
  // Two history posts are not enough → back to the lifetime pace.
  delete pace.posts.h2;
  assert.equal(G.scoreOpportunity(aFresh, { now: NOW, baselines, pace }).velocityBasis, 'lifetime');
  // No median at all → no velocity, neutral factor.
  const n = G.scoreOpportunity(listPosts.find((p) => p.code === ids.dList), { now: NOW, baselines, pace: null });
  assert.equal(n.velocityBasis, 'none');
  assert.equal(n.velocity, null);
  assert.equal(n.coldStart, true, '≤50K followers, under 2 h, under 200 views');
});

test('replyOpportunities: window, niche filter, ranking, replied posts, Phase 5 hook', () => {
  const { lib, listPosts, following, baselines } = niche();
  const posts = listPosts.concat(following, lib);
  // No niche folder: authors the user follows.
  const ops = G.replyOpportunities({ posts, now: NOW, me: ME, baselines });
  const codes = ops.map((o) => o.post.code);
  assert.ok(!codes.includes(ids.dList), 'not followed and no niche folder → out');
  assert.ok(!codes.includes(ids.aOld), 'older than 120 minutes → out');
  assert.ok(!codes.includes(ids.aReply) && !codes.includes(ids.aRepost) && !codes.includes(ids.promo), 'originals only, no ads');
  assert.deepEqual(codes.slice().sort(), [ids.aFresh, ids.aHour, ids.bBig, ids.cQuiet].sort());
  assert.equal(codes.filter((c) => c === ids.cQuiet).length, 1, 'a post seen in the list and the Following tab counts once');
  const by = Object.fromEntries(ops.map((o) => [o.post.code, o]));
  assert.ok(by[ids.bBig].score < by[ids.aFresh].score, 'the saturated big account ranks below the mutual small one');
  assert.ok(by[ids.bBig].saturation < 0.2);
  assert.ok(by[ids.bBig].sizeFit < 0.5, '5,000× your followers');
  assert.equal(by[ids.aFresh].replyAngles, null, 'PHASE 5 HOOK left empty');
  assert.ok(ops.every((o, i) => i === 0 || ops[i - 1].score >= o.score), 'best first');
  assert.ok(ops.every((o) => o.score >= 0 && o.score <= 100));

  // A niche folder: its members only, even the one the user does not follow.
  const members = { [A]: true, [D]: true };
  const ops2 = G.replyOpportunities({ posts, now: NOW, me: ME, baselines, members });
  assert.deepEqual(ops2.map((o) => o.post.code).sort(), [ids.aFresh, ids.aHour, ids.dList].sort());

  // The user already replied to C's post (CreateTweet) → dropped, or flagged.
  const sent = G.parseCreateTweet('CreateTweet', JSON.stringify(pages('CreateTweet')[0].body));
  const ops3 = G.replyOpportunities({ posts, now: NOW, me: ME, baselines, myReplies: [sent] });
  assert.ok(!ops3.some((o) => o.post.code === ids.cQuiet));
  const ops4 = G.replyOpportunities({ posts, now: NOW, me: ME, baselines, myReplies: [sent], includeReplied: true });
  assert.equal(ops4.find((o) => o.post.code === ids.cQuiet).replied, true);
  // The user's own posts never show up.
  const mine = Object.assign({}, listPosts.find((p) => p.code === ids.aFresh), { code: '999', ownerId: ME.restId, owner: ME.id });
  assert.ok(!G.replyOpportunities({ posts: [mine], now: NOW, me: ME, members: { [ME.id]: true } }).length);
  // windowMin and limit
  assert.equal(G.replyOpportunities({ posts, now: NOW, me: ME, baselines, windowMin: 30 }).length, 1);
  assert.equal(G.replyOpportunities({ posts, now: NOW, me: ME, baselines, limit: 2 }).length, 2);

  const input = G.angleInput(by[ids.aFresh]);
  assert.equal(input.post.author, '@niche_mut_demo');
  assert.match(input.context, /20 minutes old/);
});

// ---- the user's own posts: CreateTweet, reply annotations (plan 4.3) --------------------------------------
test('CreateTweet: the sent reply parses; other operations are ignored', () => {
  const body = JSON.stringify(pages('CreateTweet')[0].body);
  const p = G.parseCreateTweet('CreateTweet', body);
  assert.equal(p.code, ids.sent);
  assert.equal(p.kind, 'reply');
  assert.equal(p.replyToId, ids.cQuiet);
  assert.equal(p.ownerId, ME.restId);
  assert.equal(G.parseCreateTweet('UserTweets', body), null);
  assert.equal(G.parseCreateTweet('CreateTweet', '{bad'), null);
  const note = G.parseCreateTweet('CreateNoteTweet', { data: { notetweet_create: { tweet_results: { result: pages('CreateTweet')[0].body.data.create_tweet.tweet_results.result } } } });
  assert.equal(note.code, ids.sent);
  const sent = G.sentAdd({}, p, NOW);
  assert.deepEqual(sent.items[ids.sent], { at: p.takenAt, kind: 'reply', replyTo: Cc, replyToId: ids.cQuiet });
  assert.deepEqual(G.sentAdd(sent, null, NOW + 500 * DAY).items, {}, 'old entries expire');
});

test('annotateReplies: parent snapshot, author replied back (same or later payload), no replies = false', () => {
  const r = parse('UserRepliesTimeline-me');
  const changed = byCode(G.annotateReplies(r.posts, ME, {}));
  assert.deepEqual(Object.keys(changed).sort(), [ids.myA, ids.myB, ids.myC].sort());
  assert.equal(changed[ids.myA].authorReplied, true, 'A answered inside the conversation module');
  assert.equal(changed[ids.myA].authorReplyId, ids.backA);
  assert.equal(changed[ids.myA].parent.owner, A);
  assert.equal(changed[ids.myA].parent.views, 5000);
  assert.deepEqual(changed[ids.myA].parent.rel, { following: true, followedBy: true });
  assert.equal(changed[ids.myB].authorReplied, undefined, '3 replies, none seen yet → unknown');
  assert.equal(changed[ids.myC].authorReplied, false, 'X shows 0 replies → no reply back');
  // Later, the TweetDetail of the reply to B shows B's answer (a stranger's reply does not count).
  const td = parse('TweetDetail-myreply');
  const later = G.annotateReplies(td.posts, ME, changed);
  const b = later.find((p) => p.code === ids.myB);
  assert.equal(b.authorReplied, true);
  assert.equal(b.authorReplyId, ids.backB);
  // Nothing new → nothing changed.
  const again = byCode(later);
  assert.equal(G.annotateReplies(td.posts, ME, Object.assign({}, changed, again)).length, 0);
  assert.deepEqual(G.annotateReplies(r.posts, null, {}), []);
});

test('follower deltas: from the followers log (back-to-back days) and from the analytics series', () => {
  assert.deepEqual(G.deltasFromLog({ '2026-11-20': 70, '2026-11-21': 72, '2026-11-23': 80, '2026-11-24': 79 }), { '2026-11-21': 2, '2026-11-24': -1 });
  const raw = pages('accountOverviewDailyQuery-me')[0].body;
  const d = G.deltasFromOverview(raw);
  assert.deepEqual(d, { [G.dayKey(NOW - 3 * DAY, 0)]: 3, [G.dayKey(NOW - 2 * DAY, 0)]: 2 });
  assert.deepEqual(G.deltasFromOverview({ data: raw.data }), d, 'with or without the data wrapper');
  assert.deepEqual(G.mergeDeltas({ a: 1 }, { a: 5, b: 2 }), { a: 1, b: 2 }, 'exact analytics win');
  let me = G.logFollowers({ id: ME.id }, 80, NOW, 0);
  me = G.logFollowers(me, 82, NOW + DAY, 0);
  assert.deepEqual(G.deltasFromLog(me.followersLog), { [G.dayKey(NOW + DAY, 0)]: 2 });
});

function myLibrary() {
  const r = parse('UserRepliesTimeline-me');
  const td = parse('TweetDetail-myreply');
  let mine = {};
  r.posts.filter((p) => p.owner === ME.id).forEach((p) => { mine[p.code] = p; });
  G.annotateReplies(r.posts, ME, mine).forEach((p) => { mine[p.code] = X.merge(mine[p.code], p); });
  G.annotateReplies(td.posts, ME, mine).forEach((p) => { mine[p.code] = X.merge(mine[p.code], p); });
  return Object.values(mine);
}

test('replyRoi: per reply and per account, follower change shared by views', () => {
  const myPosts = myLibrary();
  const deltas = G.deltasFromOverview(pages('accountOverviewDailyQuery-me')[0].body);
  const roi = G.replyRoi({ myPosts, me: ME, deltas, now: NOW, tzOffsetMin: 0 });
  assert.equal(roi.totals.replies, 3, 'the original post is not a reply');
  const rep = byCode(roi.replies);
  assert.equal(rep[ids.myA].to, A);
  assert.equal(rep[ids.myA].author_replied, true);
  assert.equal(rep[ids.myA].followers_day, 3);
  assert.equal(rep[ids.myA].followers_share, 3, 'alone that day');
  assert.equal(rep[ids.myC].author_replied, false);
  const stale = G.replyRoi({ myPosts: myPosts.map((p) => (p.code === ids.myC ? Object.assign({}, p, { comments: 2 }) : p)), me: ME, now: NOW });
  assert.equal(byCode(stale.replies)[ids.myC].author_replied, null, 'a "no reply back" noted at 0 replies is unknown once replies exist');
  assert.equal(rep[ids.myC].author_liked, false, '0 likes → the author did not like it');
  assert.equal(rep[ids.myB].author_liked, null, 'X does not say who liked a reply');
  // B and C share day −2's +2 by views (60 vs 140).
  assert.equal(rep[ids.myB].followers_share, 0.6);
  assert.equal(rep[ids.myC].followers_share, 1.4);
  assert.deepEqual(roi.accounts.map((a) => a.account), [A, Cc, B], 'most followers attributed first');
  const a = roi.accounts[0];
  assert.equal(a.replies, 1);
  assert.equal(a.reciprocity, 1);
  assert.equal(a.mutual, true);
  assert.equal(a.author_followers, 1200);
  assert.equal(roi.totals.author_replied, 2);
  assert.equal(roi.totals.days_with_follower_data, 2);
  assert.match(roi.followers_note, /rough estimate/);
  // Without follower data: ranked by views; nothing attributed.
  const bare = G.replyRoi({ myPosts, me: ME, now: NOW });
  assert.ok(bare.accounts.every((x) => x.followers_attributed === null));
  assert.equal(bare.accounts[0].account, A, '420 views');
  // sinceDays
  assert.equal(G.replyRoi({ myPosts, me: ME, now: NOW, sinceDays: 2.5 }).totals.replies, 2);
});

// ---- CRM storage ------------------------------------------------------------------------------------------
test('crmSet: notes and tags, normalized, removed when empty; crmTable merges ROI', () => {
  let crm = G.crmSet({}, '@Niche_Mut_Demo', { note: 'Met at a meetup', addTag: '#Excel Pro' }, 1000);
  assert.deepEqual(crm.accounts[A], { note: 'Met at a meetup', tags: ['excel-pro'], updatedAt: 1000 });
  crm = G.crmSet(crm, A, { addTag: 'excel-pro' }, 1001);
  assert.deepEqual(crm.accounts[A].tags, ['excel-pro'], 'no duplicate tags');
  crm = G.crmSet(crm, 'https://x.com/list_only_demo', { tags: ['a', 'B', 'a', ''] }, 1002);
  assert.deepEqual(crm.accounts[D].tags, ['a', 'b']);
  assert.equal(G.crmSet(crm, A, { note: 'x'.repeat(5000) }, 1).accounts[A].note.length, 2000);
  assert.throws(() => G.crmSet(crm, 'not a handle!', { note: 'x' }), /Not an X account/);
  const cleared = G.crmSet(crm, D, { removeTag: 'a' }, 1003);
  assert.deepEqual(cleared.accounts[D].tags, ['b']);
  assert.equal(G.crmSet(cleared, D, { removeTag: 'b' }, 1004).accounts[D], undefined, 'nothing left → removed');
  assert.ok(crm.accounts[A], 'pure');

  const roi = G.replyRoi({ myPosts: myLibrary(), me: ME, now: NOW, tzOffsetMin: 0 });
  const table = G.crmTable(roi, crm, { [A]: { followers: 1250, rel: { following: true, followedBy: true }, name: 'Mutual Niche', handle: 'niche_mut_demo' } }, { [A]: true });
  const row = table.find((r) => r.account === A);
  assert.equal(row.replies, 1);
  assert.equal(row.reciprocated, 1);
  assert.equal(row.followers, 1250, 'the Library profile is newer');
  assert.equal(row.note, 'Met at a meetup');
  assert.equal(row.niche, true);
  assert.equal(row.last_interaction, NOW - 3 * DAY + 30 * MIN, 'A\'s reply back, 30 minutes after the user\'s reply');
  const dRow = table.find((r) => r.account === D);
  assert.equal(dRow.replies, 0, 'a note without replies still gets a row');
  assert.ok(table.findIndex((r) => r.account === B) < table.findIndex((r) => r.account === A), 'most recent interaction first');
});

// ---- consistency (plan 4.4) -----------------------------------------------------------------------------
test('activityByDay counts originals and replies once (collected + sent)', () => {
  const myPosts = myLibrary();
  const sent = G.sentAdd({}, G.parseCreateTweet('CreateTweet', pages('CreateTweet')[0].body), NOW);
  sent.items[ids.myA] = { at: NOW - 3 * DAY, kind: 'reply' }; // also collected: not twice
  const act = G.activityByDay(myPosts, sent, 0, ME);
  assert.deepEqual(act[G.dayKey(NOW, 0)], { posts: 0, replies: 1 });
  assert.deepEqual(act[G.dayKey(NOW - DAY, 0)], { posts: 1, replies: 0 });
  assert.deepEqual(act[G.dayKey(NOW - 2 * DAY, 0)], { posts: 0, replies: 2 });
  assert.deepEqual(act[G.dayKey(NOW - 3 * DAY, 0)], { posts: 0, replies: 1 });
});

test('consistency: streaks, best streak, today, heatmap levels', () => {
  const day = (n) => G.dayKey(NOW - n * DAY, 0);
  const full = { posts: 2, replies: 10 };
  const act = { [day(1)]: full, [day(2)]: full, [day(3)]: { posts: 3, replies: 12 }, [day(4)]: { posts: 1, replies: 0 }, [day(10)]: full, [day(11)]: full, [day(12)]: full, [day(13)]: full };
  const c = G.consistency(act, null, NOW, 0);
  assert.deepEqual(c.goals, { posts: 2, replies: 10 });
  assert.equal(c.streak, 3, 'today is still open: counted through yesterday');
  assert.equal(c.best, 4);
  assert.equal(c.activeStreak, 4);
  assert.deepEqual(c.today, { day: day(0), posts: 0, replies: 0, met: false, left: { posts: 2, replies: 10 } });
  act[day(0)] = full;
  const c2 = G.consistency(act, null, NOW, 0);
  assert.equal(c2.streak, 4, 'today counts once met');
  assert.equal(c2.today.met, true);
  assert.equal(c2.heatmap.length % 7, (new Date(day(0) + 'T00:00:00Z').getUTCDay() + 6) % 7 + 1, 'Monday-first weeks, ending today');
  assert.ok(c2.heatmap.length > 77 && c2.heatmap.length <= 84);
  const h = Object.fromEntries(c2.heatmap.map((x) => [x.day, x]));
  assert.equal(h[day(1)].level, 4);
  assert.equal(h[day(4)].level, 1);
  assert.equal(h[day(5)].level, 0);
  assert.equal(G.consistency({ [day(0)]: { posts: 1, replies: 0 } }, { posts: 1, replies: 0 }, NOW, 0).streak, 1, 'custom goals');
  assert.deepEqual(G.goalsOf({ posts: -1, replies: 'x' }), { posts: 2, replies: 10 });
  assert.equal(G.consistency({}, { posts: 0, replies: 0 }, NOW, 0).streak, 0, 'zero goals never count as met');
  assert.equal(c.week.days, c.heatmap.slice(-c.week.days).length);
});

test('dayKey uses the local offset', () => {
  const t = Date.UTC(2026, 10, 24, 22, 30);
  assert.equal(G.dayKey(t, 0), '2026-11-24');
  assert.equal(G.dayKey(t, -180), '2026-11-25', 'Istanbul (UTC+3) is already on the 25th');
  assert.equal(G.addDays('2026-12-31', 1), '2027-01-01');
});

// ---- saved searches (plan 4.5) --------------------------------------------------------------------------
test('saved searches: save, rank with outlier badges, keep results, remove', () => {
  assert.deepEqual(G.searchFromUrl('https://x.com/search?q=excel%20%20lambda&src=typed_query&f=live'), { q: 'excel lambda', f: 'live' });
  assert.equal(G.searchFromUrl('https://x.com/home'), null);
  assert.equal(G.searchUrl('excel lambda', 'live'), 'https://x.com/search?q=excel%20lambda&src=typed_query&f=live');
  let s = G.saveSearch({}, ' Excel  Lambda ', NOW);
  assert.equal(s.items[0].q, 'Excel Lambda');
  assert.equal(G.saveSearch(s, 'excel lambda', NOW + 1).items.length, 1, 'same search (case, spaces) → one entry');
  assert.throws(() => G.saveSearch(s, '   ', NOW), /Empty/);
  assert.ok(G.findSearch(s, 'EXCEL lambda'));

  const { lib, baselines } = niche();
  const results = parse('SearchTimeline').posts;
  const ranked = G.rankPosts(results, baselines, NOW);
  assert.equal(ranked[0].code, ids.search[0], 'A\'s post: 9× its Library median, ranked first');
  assert.equal(ranked[0].ratio, 9);
  assert.equal(ranked[0].outlier, true);
  assert.equal(ranked[1].ratio, null, 'no median for the others: listed after');
  s = G.recordSearch(s, 'excel lambda', ranked, NOW);
  assert.equal(s.items[0].results.length, 3);
  assert.equal(s.items[0].results[0].ratio, 9);
  assert.equal(s.items[0].lastOpenedAt, NOW);
  assert.ok(!('media' in s.items[0].results[0]), 'slim records');
  assert.equal(G.recordSearch(s, 'not saved', ranked, NOW).items[0].lastOpenedAt, NOW, 'unsaved searches are not recorded');
  assert.equal(G.removeSearch(s, s.items[0].id).items.length, 0);
  assert.ok(lib.length);
});

// ---- list-tab auto-refresh, the user's handle ------------------------------------------------------------------
test('refreshDue: only on a list tab, every 10 min, never while typing or right after input', () => {
  const base = { on: true, kind: 'list', lastLoadAt: NOW - 11 * MIN, lastInputAt: NOW - 5 * MIN, typing: false, now: NOW };
  assert.equal(G.refreshDue(base), true);
  assert.equal(G.refreshDue(Object.assign({}, base, { on: false })), false, 'off by default');
  assert.equal(G.refreshDue(Object.assign({}, base, { kind: 'home' })), false);
  assert.equal(G.refreshDue(Object.assign({}, base, { typing: true })), false);
  assert.equal(G.refreshDue(Object.assign({}, base, { lastInputAt: NOW - MIN })), false);
  assert.equal(G.refreshDue(Object.assign({}, base, { lastLoadAt: NOW - 9 * MIN })), false);
});

test('meFromHref reads the side nav\'s Profile link', () => {
  assert.deepEqual(G.meFromHref('/heyEshagh'), { id: 'x/heyeshagh', handle: 'heyEshagh' });
  assert.deepEqual(G.meFromHref('https://x.com/heyEshagh'), { id: 'x/heyeshagh', handle: 'heyEshagh' });
  assert.equal(G.meFromHref('/heyEshagh/status/1'), null);
  assert.equal(G.meFromHref(''), null);
});
