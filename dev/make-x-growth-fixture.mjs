// Generates fake x.com GraphQL responses for X Phase 3 (niche list, Following tab, the user's
// replies, a reply back, CreateTweet, search), shaped like dev/make-x-fixture.mjs's (Faz 0 shapes).
// All accounts, texts and numbers are made up.
//   node dev/make-x-growth-fixture.mjs   → dev/x/growth/*.json (+ meta.json)
//
// Each file is an array of pages: { url, rateLimit, body }, like dev/x/*.json.
// Not verified live: ListLatestTweetsTimeline (the user has no list yet), CreateTweet's
// data.create_tweet.tweet_results shape (the common web-client shape).
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'x', 'growth');
mkdirSync(out, { recursive: true });

const TWEPOCH = 1288834974657n;
export const NOW = Date.UTC(2026, 10, 24, 15, 0, 0);
const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
let seq = 0;
const snow = (ms) => String(((BigInt(ms) - TWEPOCH) << 22n) | BigInt(++seq % 4096));
const fmtDate = (ms) => new Date(ms).toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) ([\d:]+) GMT$/, '$1 $3 $2 $5 +0000 $4');

let userSeq = 0;
function makeUser(handle, name, followers, rel) {
  return { handle, name, followers, restId: String(1500000000000000000n + BigInt(++userSeq * 104729)), rel };
}
function userNode(u) {
  return {
    __typename: 'User', rest_id: u.restId,
    avatar: { image_url: `https://pbs.twimg.com/profile_images/${u.restId}/demo_normal.jpg` },
    core: { created_at: fmtDate(Date.UTC(2020, 1, 1)), name: u.name, screen_name: u.handle },
    is_blue_verified: true, verification: { verified: false }, privacy: { protected: false },
    relationship_counts: { followers: u.followers, following: 200 }, tweet_counts: { tweets: 500, media_tweets: 50 },
    relationship_perspectives: u.rel, pinned_items: []
  };
}

export const me = makeUser('oo_me_demo', 'Me (demo)', 80, {});
const A = makeUser('niche_mut_demo', 'Mutual Niche', 1200, { following: true, followed_by: true });
const B = makeUser('niche_big_demo', 'Big Niche', 400000, { following: true, followed_by: false });
const Cc = makeUser('niche_fit_demo', 'Fitting Niche', 900, { following: true, followed_by: false });
const D = makeUser('list_only_demo', 'List Only', 2400, { following: false, followed_by: false });
const brand = makeUser('Promo_Demo', 'Promo', 90000, { following: false, followed_by: false });

/** o: { user, at, text, views, likes, replies, replyTo: { id, user }, conversation, rt, quoted } */
function tweet(o) {
  const id = o.id || snow(o.at);
  const legacy = {
    bookmark_count: 0, created_at: fmtDate(o.at), conversation_id_str: o.conversation || id, display_text_range: [0, 10],
    entities: { hashtags: [], symbols: [], urls: [], user_mentions: o.replyTo ? [{ id_str: o.replyTo.user.restId, screen_name: o.replyTo.user.handle, name: o.replyTo.user.name, indices: [0, 0] }] : [] },
    favorite_count: o.likes ?? 0, full_text: (o.replyTo ? '@' + o.replyTo.user.handle + ' ' : '') + (o.text || 'post ' + seq), is_quote_status: !!o.quoted,
    lang: 'en', quote_count: 0, reply_count: o.replies ?? 0, retweet_count: 0, user_id_str: o.user.restId, id_str: id
  };
  if (o.replyTo) Object.assign(legacy, { in_reply_to_status_id_str: o.replyTo.id, in_reply_to_user_id_str: o.replyTo.user.restId, in_reply_to_screen_name: o.replyTo.user.handle });
  if (o.rt) legacy.retweeted_status_result = { result: o.rt };
  if (o.quoted) legacy.quoted_status_id_str = o.quoted.rest_id;
  const node = { __typename: 'Tweet', rest_id: id, core: { user_results: { result: userNode(o.user) } },
    views: o.views === null ? { state: 'Enabled' } : { count: String(o.views ?? 0), state: 'EnabledWithCount' }, legacy };
  if (o.quoted) node.quoted_status_result = { result: o.quoted };
  if (o.visibility) return { __typename: 'TweetWithVisibilityResults', tweet: node };
  return node;
}
const plain = (t) => (t.__typename === 'TweetWithVisibilityResults' ? t.tweet : t);
function tweetEntry(t, promoted) {
  const ic = { itemType: 'TimelineTweet', __typename: 'TimelineTweet', tweet_results: { result: t } };
  if (promoted) ic.promotedMetadata = { advertiser_results: { result: userNode(brand) } };
  return { entryId: (promoted ? 'promoted-tweet-' : 'tweet-') + plain(t).rest_id, sortIndex: plain(t).rest_id, content: { entryType: 'TimelineTimelineItem', itemContent: ic } };
}
function moduleEntry(entryId, tweets, sortIndex) {
  return { entryId, sortIndex, content: { entryType: 'TimelineTimelineModule', displayType: 'VerticalConversation',
    items: tweets.map((t) => ({ entryId: entryId + '-tweet-' + plain(t).rest_id, item: { itemContent: { itemType: 'TimelineTweet', tweet_results: { result: t } } } })) } };
}
const url = (op, vars = {}) => `https://x.com/i/api/graphql/${Buffer.from(op).toString('base64url').slice(0, 22)}/${op}?variables=${encodeURIComponent(JSON.stringify(vars))}&features=%7B%7D`;
const RESET = Math.floor(NOW / 1000) + 900;
const page = (op, body, vars) => ({ url: url(op, vars || { count: 20 }), rateLimit: { limit: 500, remaining: 480, reset: RESET }, body });
const write = (name, pages) => writeFileSync(join(out, name + '.json'), JSON.stringify(pages, null, 1));
const userTimeline = (instructions) => ({ data: { user: { result: { __typename: 'User', timeline: { timeline: { instructions } } } } } });

// ---- A's history: 12 text originals over the last month (median 1,000 views) → baselines ----
const aHistory = [800, 900, 950, 1000, 1000, 1000, 1050, 1100, 1200, 700, 1300, 1000].map((v, i) =>
  tweet({ user: A, at: NOW - (2 + i * 2.5) * DAY, views: v, likes: Math.round(v / 50), replies: Math.round(v / 200), text: 'Spreadsheet tip ' + i }));
write('UserOriginalsTimeline-niche', [page('UserOriginalsTimeline', userTimeline([{ type: 'TimelineAddEntries', entries: aHistory.map((t) => tweetEntry(t)) }]))]);

// ---- the list (ListLatestTweetsTimeline, list 1790000000000000001) ----
const LIST_ID = '1790000000000000001';
const list = {
  aFresh: tweet({ user: A, at: NOW - 20 * MIN, views: 300, likes: 9, replies: 2, text: 'Hot take: LET makes formulas readable' }),
  bBig: tweet({ user: B, at: NOW - 45 * MIN, views: 40000, likes: 900, replies: 220, text: 'Big account post' }),
  cQuiet: tweet({ user: Cc, at: NOW - 90 * MIN, views: 150, likes: 3, replies: 0, text: 'A quiet post with no replies yet' }),
  dList: tweet({ user: D, at: NOW - 30 * MIN, views: 90, likes: 1, replies: 1, text: 'List member nobody follows' }),
  aOld: tweet({ user: A, at: NOW - 200 * MIN, views: 900, likes: 20, replies: 4, text: 'Older than two hours' })
};
list.aReply = tweet({ user: A, at: NOW - 10 * MIN, views: 30, replies: 0, replyTo: { id: list.bBig.rest_id, user: B }, conversation: list.bBig.rest_id, text: 'agreed' });
list.aRepost = tweet({ user: A, at: NOW - 15 * MIN, views: 0, rt: list.bBig, text: 'RT' });
list.promo = tweet({ user: brand, at: NOW - 5 * MIN, views: 9000, text: 'Buy now' });
write('ListLatestTweetsTimeline', [page('ListLatestTweetsTimeline', { data: { list: { tweets_timeline: { timeline: { instructions: [
  { type: 'TimelineAddEntries', entries: [list.aFresh, list.bBig, list.cQuiet, list.dList, list.aOld, list.aReply, list.aRepost].map((t) => tweetEntry(t)).concat([tweetEntry(list.promo, true)]) }
] } } } } }, { listId: LIST_ID, count: 20 })]);

// ---- the Following tab (HomeLatestTimeline): no list needed ----
const following = {
  aHour: tweet({ user: A, at: NOW - 60 * MIN, views: 700, likes: 14, replies: 3, text: 'An hour old, doing well', visibility: true }),
  cQuiet: list.cQuiet
};
write('HomeLatestTimeline', [page('HomeLatestTimeline', { data: { home: { home_timeline_urt: { instructions: [
  { type: 'TimelineAddEntries', entries: [following.aHour, following.cQuiet].map((t) => tweetEntry(t)) }
] } } } })]);

// ---- the user's Replies tab: [parent, my reply, (the author's reply back)] modules ----
const parA = tweet({ user: A, at: NOW - 3 * DAY - 2 * HOUR, views: 5000, likes: 80, replies: 12, text: 'What is your favourite Excel function?' });
const myA = tweet({ user: me, at: NOW - 3 * DAY, views: 420, likes: 6, replies: 1, replyTo: { id: parA.rest_id, user: A }, conversation: parA.rest_id, text: 'XLOOKUP, by far' });
const backA = tweet({ user: A, at: NOW - 3 * DAY + 30 * MIN, views: 200, likes: 2, replies: 0, replyTo: { id: myA.rest_id, user: me }, conversation: parA.rest_id, text: 'Same here!' });
const parB = tweet({ user: B, at: NOW - 2 * DAY - 3 * HOUR, views: 90000, likes: 2000, replies: 400, text: 'Power Query or VBA?' });
const myB = tweet({ user: me, at: NOW - 2 * DAY, views: 60, likes: 1, replies: 3, replyTo: { id: parB.rest_id, user: B }, conversation: parB.rest_id, text: 'Power Query for cleaning' });
const parC = tweet({ user: Cc, at: NOW - 2 * DAY - 1 * HOUR, views: 800, likes: 10, replies: 2, text: 'Shipping my first add-in' });
const myC = tweet({ user: me, at: NOW - 2 * DAY + 2 * HOUR, views: 140, likes: 0, replies: 0, replyTo: { id: parC.rest_id, user: Cc }, conversation: parC.rest_id, text: 'Congrats, what does it do?' });
const myOrig = tweet({ user: me, at: NOW - 1 * DAY, views: 35, likes: 1, text: 'My own post' });
write('UserRepliesTimeline-me', [page('UserRepliesTimeline', userTimeline([{ type: 'TimelineAddEntries', entries: [
  moduleEntry('profile-conversation-' + myC.rest_id, [parC, myC], myC.rest_id),
  moduleEntry('profile-conversation-' + myB.rest_id, [parB, myB], myB.rest_id),
  moduleEntry('profile-conversation-' + myA.rest_id, [parA, myA, backA], myA.rest_id),
  tweetEntry(myOrig)
] }]))]);

// ---- TweetDetail of my reply to B: B answered later ----
const backB = tweet({ user: B, at: NOW - 2 * DAY + 4 * HOUR, views: 3000, likes: 40, replies: 0, replyTo: { id: myB.rest_id, user: me }, conversation: parB.rest_id, text: 'Good call' });
const strangerB = tweet({ user: D, at: NOW - 2 * DAY + 5 * HOUR, views: 50, replyTo: { id: myB.rest_id, user: me }, conversation: parB.rest_id, text: 'nah' });
write('TweetDetail-myreply', [page('TweetDetail', { data: { threaded_conversation_with_injections_v2: { instructions: [
  { type: 'TimelineAddEntries', entries: [tweetEntry(parB), tweetEntry(myB), moduleEntry('conversationthread-' + strangerB.rest_id, [strangerB], '6'), moduleEntry('conversationthread-' + backB.rest_id, [backB], '5')] }
] } } })]);

// ---- CreateTweet: the user replies to C's fresh list post in this tab ----
const sent = tweet({ user: me, at: NOW - 2 * MIN, views: 0, replies: 0, replyTo: { id: list.cQuiet.rest_id, user: Cc }, conversation: list.cQuiet.rest_id, text: 'Nice one' });
write('CreateTweet', [page('CreateTweet', { data: { create_tweet: { tweet_results: { result: sent } } } }, {})]);

// ---- a saved search's results ----
const searchTweets = [
  tweet({ user: A, at: NOW - 5 * HOUR, views: 9000, likes: 200, replies: 30, text: 'excel lambda trick' }),
  tweet({ user: D, at: NOW - 3 * HOUR, views: 400, likes: 4, text: 'excel lambda question' }),
  tweet({ user: B, at: NOW - 6 * HOUR, views: 50000, likes: 800, text: 'excel lambda thread' })
];
write('SearchTimeline', [page('SearchTimeline', { data: { search_by_raw_query: { search_timeline: { timeline: { instructions: [
  { type: 'TimelineAddEntries', entries: searchTweets.map((t) => tweetEntry(t)) }] } } } } }, { rawQuery: 'excel lambda', count: 20, product: 'Latest' })]);

// ---- the user's analytics: follows / unfollows on the reply days (UTC-midnight buckets) ----
const dayStart = (ms) => Date.UTC(new Date(ms).getUTCFullYear(), new Date(ms).getUTCMonth(), new Date(ms).getUTCDate());
const series = [
  { engagement_type: 'Follow', is_engaging_user_verified: 'false', count: '3', timestamp: String(dayStart(NOW - 3 * DAY)) },
  { engagement_type: 'Follow', is_engaging_user_verified: 'true', count: '1', timestamp: String(dayStart(NOW - 3 * DAY)) },
  { engagement_type: 'Unfollow', is_engaging_user_verified: 'false', count: '1', timestamp: String(dayStart(NOW - 3 * DAY)) },
  { engagement_type: 'Follow', is_engaging_user_verified: 'false', count: '2', timestamp: String(dayStart(NOW - 2 * DAY)) },
  { engagement_type: 'Displayed', is_engaging_user_verified: 'false', count: '40', timestamp: String(dayStart(NOW - 2 * DAY)) }
];
write('accountOverviewDailyQuery-me', [page('accountOverviewDailyQuery', { data: { viewer_v2: { user_results: { result: {
  __typename: 'User', rest_id: me.restId, verified_follower_count: '9', relationship_counts: { followers: 80 }, current_time_series: series } } } } })]);

writeFileSync(join(out, 'meta.json'), JSON.stringify({
  now: NOW, listId: LIST_ID,
  me: { handle: me.handle, restId: me.restId, followers: me.followers },
  users: { A: A.handle, B: B.handle, C: Cc.handle, D: D.handle },
  ids: {
    aFresh: list.aFresh.rest_id, bBig: list.bBig.rest_id, cQuiet: list.cQuiet.rest_id, dList: list.dList.rest_id, aOld: list.aOld.rest_id,
    aReply: list.aReply.rest_id, aRepost: list.aRepost.rest_id, promo: list.promo.rest_id, aHour: plain(following.aHour).rest_id,
    parA: parA.rest_id, myA: myA.rest_id, backA: backA.rest_id, parB: parB.rest_id, myB: myB.rest_id, backB: backB.rest_id,
    parC: parC.rest_id, myC: myC.rest_id, myOrig: myOrig.rest_id, sent: sent.rest_id, search: searchTweets.map((t) => t.rest_id)
  }
}, null, 1));
console.log('wrote', out);
