// Generates fake x.com GraphQL responses shaped like the ones x.com's web app loads
// (verified live in Phase 0, docs/x-plan.md "Faz 0 notları"), used by tests/x.test.js and
// the MCP tests. All accounts, texts, numbers and links are made up; no real data.
//   node dev/make-x-fixture.mjs
//
// Each dev/x/<Operation>.json is an array of pages: { url, rateLimit: { limit, remaining, reset }, body }.
//
// Shapes worth knowing (Faz 0):
//   - The user object has NO `legacy`: core.{name, screen_name, created_at}, relationship_counts.{followers, following},
//     tweet_counts.{tweets, media_tweets}, avatar.image_url, is_blue_verified, relationship_perspectives.{following, followed_by}.
//     UserTweets.json keeps the old `legacy` user shape, to test the fallback.
//   - Post counters are still under legacy; views = { count: "25", state: "EnabledWithCount" }; posts before
//     2023 have { state: "Enabled" } and no count.
//   - Home wraps some posts in TweetWithVisibilityResults; promoted entries carry promotedMetadata.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'x');
mkdirSync(out, { recursive: true });

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(11);
const TWEPOCH = 1288834974657n;
export const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const DAY = 86400000;
let seq = 0;
/** A snowflake id for a time (ms). */
function snow(ms) { return String(((BigInt(ms) - TWEPOCH) << 22n) | BigInt(++seq % 4096)); }
const fmtDate = (ms) => new Date(ms).toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) ([\d:]+) GMT$/, '$1 $3 $2 $5 +0000 $4');

// ---- users ---------------------------------------------------------------------
let userSeq = 0;
function makeUser(handle, name, followers, opts = {}) {
  const restId = String(1400000000000000000n + BigInt(++userSeq * 7919));
  return { handle, name, followers, restId, following: opts.following ?? 300, tweets: opts.tweets ?? 900, blue: opts.blue ?? true,
    created: opts.created ?? Date.UTC(2019, 4, 2), rel: opts.rel ?? { following: false, followed_by: false } };
}
/** The new user shape (no legacy). */
function userNode(u) {
  return {
    __typename: 'User', id: Buffer.from('User:' + u.restId).toString('base64'), rest_id: u.restId,
    affiliates_highlighted_label: {},
    avatar: { image_url: `https://pbs.twimg.com/profile_images/${u.restId}/demo_normal.jpg` },
    core: { created_at: fmtDate(u.created), name: u.name, screen_name: u.handle },
    dm_permissions: { can_dm: false },
    has_graduated_access: true,
    is_blue_verified: u.blue,
    location: { location: '' },
    privacy: { protected: false },
    profile_bio: { description: 'Demo account for OpenOutlier tests' },
    relationship_counts: { followers: u.followers, following: u.following },
    tweet_counts: { tweets: u.tweets, media_tweets: Math.round(u.tweets / 5) },
    verification: { verified: false },
    professional: u.blue ? { rest_id: u.restId, professional_type: 'Creator', category: [] } : undefined,
    relationship_perspectives: u.rel,
    pinned_items: u.pinned ? [{ rest_id: u.pinned }] : []
  };
}
/** The old shape (legacy block), still handled as a fallback. */
function legacyUserNode(u) {
  return {
    __typename: 'User', rest_id: u.restId, is_blue_verified: u.blue,
    legacy: { screen_name: u.handle, name: u.name, followers_count: u.followers, friends_count: u.following, statuses_count: u.tweets,
      media_count: 12, created_at: fmtDate(u.created), profile_image_url_https: `https://pbs.twimg.com/profile_images/${u.restId}/old_normal.jpg`,
      verified: false, following: u.rel.following, followed_by: u.rel.followed_by, pinned_tweet_ids_str: [] }
  };
}

const demo = makeUser('ExcelBugs_Demo', 'Excel Bugs (demo)', 18400, { tweets: 2140, rel: { following: true, followed_by: true } });
const other = makeUser('SheetTips_Demo', 'Sheet Tips (demo)', 920000, { rel: { following: true, followed_by: false } });
const small = makeUser('tiny_maker_demo', 'Tiny Maker', 85, { blue: false, tweets: 211, following: 401 });
const brand = makeUser('AdBrand_Demo', 'Ad Brand', 51000);
const fan = makeUser('reply_guy_demo', 'Reply Guy', 1300, { blue: false });

// ---- tweets ----------------------------------------------------------------------
const TOPICS = ['XLOOKUP', 'Power Query', 'pivot tables', 'LET', 'dynamic arrays', 'conditional formatting', 'FILTER', 'LAMBDA', 'charts', 'shortcuts'];
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

/**
 * A Tweet node. o: { user, at (ms), text, views (number | null for "no count"), likes, replies, reposts, quotes,
 * bookmarks, media: [{type, duration}], url (external link), quoted (tweet node), replyTo ({id, user}), selfThread (root id),
 * article ({title}), note (long text), ai, edits, rt (tweet node: this is a repost), legacyUser }
 */
function tweet(o) {
  const id = o.id || snow(o.at);
  const text = o.text || `${pick(TOPICS)} tip #${seq}`;
  const media = (o.media || []).map((m, i) => {
    const base = { display_url: 'pic.x.com/demo', expanded_url: `https://x.com/${o.user.handle}/status/${id}/${m.type === 'photo' ? 'photo' : 'video'}/${i + 1}`,
      id_str: snow(o.at), indices: [0, 0], media_key: `3_${id}${i}`, media_url_https: `https://pbs.twimg.com/media/demo${id}${i}.jpg`,
      type: m.type, url: 'https://t.co/demoMedia', original_info: { width: 1280, height: 720 } };
    if (m.type !== 'photo') {
      base.media_url_https = `https://pbs.twimg.com/ext_tw_video_thumb/${id}/pu/img/demo${i}.jpg`;
      base.video_info = { aspect_ratio: [16, 9], duration_millis: m.type === 'animated_gif' ? undefined : Math.round((m.duration || 30) * 1000),
        variants: [
          { content_type: 'application/x-mpegURL', url: `https://video.twimg.com/ext_tw_video/${id}/pu/pl/demo.m3u8` },
          { bitrate: 256000, content_type: 'video/mp4', url: `https://video.twimg.com/ext_tw_video/${id}/pu/vid/480x270/demo.mp4` },
          { bitrate: 2176000, content_type: 'video/mp4', url: `https://video.twimg.com/ext_tw_video/${id}/pu/vid/1280x720/demo.mp4` },
          { bitrate: 832000, content_type: 'video/mp4', url: `https://video.twimg.com/ext_tw_video/${id}/pu/vid/640x360/demo.mp4` }
        ] };
    }
    return base;
  });
  const urls = o.url ? [{ display_url: o.url.replace(/^https?:\/\//, '').slice(0, 24), expanded_url: o.url, url: 'https://t.co/demoLink', indices: [0, 0] }] : [];
  const legacy = {
    bookmark_count: o.bookmarks ?? 0, bookmarked: false, created_at: fmtDate(o.at), conversation_id_str: o.conversation || id,
    display_text_range: [0, text.length],
    entities: { hashtags: (text.match(/#[A-Za-z]\w*/g) || []).map((h) => ({ indices: [0, 0], text: h.slice(1) })), symbols: [], timestamps: [],
      urls, user_mentions: o.replyTo ? [{ id_str: o.replyTo.user.restId, name: o.replyTo.user.name, screen_name: o.replyTo.user.handle, indices: [0, 0] }] : [] },
    favorite_count: o.likes ?? 0, favorited: false,
    full_text: (o.replyTo ? '@' + o.replyTo.user.handle + ' ' : '') + (o.note ? o.note.slice(0, 270) + '…' : text) + (media.length || o.quoted ? ' https://t.co/demoMedia' : ''),
    is_quote_status: !!o.quoted, lang: o.lang || 'en', possibly_sensitive: false,
    quote_count: o.quotes ?? 0, reply_count: o.replies ?? 0, retweet_count: o.reposts ?? 0, retweeted: false,
    user_id_str: o.user.restId, id_str: id
  };
  if (media.length) { legacy.entities.media = media; legacy.extended_entities = { media }; }
  if (o.replyTo) Object.assign(legacy, { in_reply_to_status_id_str: o.replyTo.id, in_reply_to_user_id_str: o.replyTo.user.restId, in_reply_to_screen_name: o.replyTo.user.handle });
  if (o.selfThread) legacy.self_thread = { id_str: o.selfThread };
  if (o.quoted) legacy.quoted_status_id_str = o.quoted.rest_id;
  if (o.rt) { legacy.retweeted_status_result = { result: o.rt }; legacy.full_text = 'RT @' + o.rt.core.user_results.result.core.screen_name + ': ' + o.rt.legacy.full_text.slice(0, 100); }
  const node = {
    __typename: 'Tweet', rest_id: id,
    core: { user_results: { result: o.legacyUser ? legacyUserNode(o.user) : userNode(o.user) } },
    unmention_data: {},
    edit_control: o.edits
      ? { edit_tweet_ids: o.edits, editable_until_msecs: String(o.at + 3600000), is_edit_eligible: true, edits_remaining: '4' }
      : { edit_tweet_ids: [id], editable_until_msecs: String(o.at + 3600000), is_edit_eligible: !o.rt && !o.replyTo, edits_remaining: '5' },
    is_translatable: false,
    views: o.views === null ? { state: 'Enabled' } : { count: String(o.views ?? 0), state: 'EnabledWithCount' },
    source: '<a href="https://mobile.twitter.com" rel="nofollow">Twitter Web App</a>',
    legacy
  };
  if (o.note) node.note_tweet = { is_expandable: true, note_tweet_results: { result: { id: 'Tm90ZVR3ZWV0OjE=', text: o.note, entity_set: { hashtags: [], symbols: [], urls: [], user_mentions: [] } } } };
  if (o.quoted) node.quoted_status_result = { result: o.quoted };
  if (o.url) node.card = { rest_id: 'card://' + id, legacy: { name: 'summary_large_image', url: 'https://t.co/demoLink', binding_values: [{ key: 'card_url', value: { string_value: 'https://t.co/demoLink', type: 'STRING' } }, { key: 'title', value: { string_value: 'Demo page', type: 'STRING' } }] } };
  if (o.article) node.article = { article_results: { result: { rest_id: snow(o.at), title: o.article.title, preview_text: 'Preview…', cover_media: {} } } };
  if (o.ai) node.content_disclosure = { ai_generated_disclosure: { is_ai_generated: true } };
  if (o.visibility) return { __typename: 'TweetWithVisibilityResults', tweet: node, tweetInterstitial: { __typename: 'ContextualTweetInterstitial' } };
  return node;
}
const plain = (t) => (t.__typename === 'TweetWithVisibilityResults' ? t.tweet : t);

function tweetEntry(t, opts = {}) {
  const id = plain(t).rest_id;
  const ic = { itemType: 'TimelineTweet', __typename: 'TimelineTweet', tweet_results: { result: t }, tweetDisplayType: 'Tweet' };
  if (opts.promoted) ic.promotedMetadata = { advertiser_results: { result: userNode(brand) }, disclosureType: 'NoDisclosure', impressionId: 'demo', clickTrackingInfo: {} };
  if (opts.pinned) ic.socialContext = { type: 'TimelineGeneralContext', contextType: 'Pin', text: 'Pinned' };
  return { entryId: (opts.promoted ? 'promoted-tweet-' : 'tweet-') + id, sortIndex: opts.sortIndex || id, content: { entryType: 'TimelineTimelineItem', __typename: 'TimelineTimelineItem', itemContent: ic } };
}
function moduleEntry(entryId, tweets, sortIndex, displayType = 'VerticalConversation') {
  return { entryId, sortIndex, content: { entryType: 'TimelineTimelineModule', __typename: 'TimelineTimelineModule', displayType,
    items: tweets.map((t) => ({ entryId: entryId + '-tweet-' + plain(t).rest_id, item: { itemContent: { itemType: 'TimelineTweet', __typename: 'TimelineTweet', tweet_results: { result: t }, tweetDisplayType: 'Tweet' } } })) } };
}
function cursor(kind, sortIndex) {
  return { entryId: `cursor-${kind}-${sortIndex}`, sortIndex, content: { entryType: 'TimelineTimelineCursor', __typename: 'TimelineTimelineCursor', value: `DAABCgAB${kind}${sortIndex}`, cursorType: kind === 'top' ? 'Top' : 'Bottom' } };
}
const userTimeline = (instructions) => ({ data: { user: { result: { __typename: 'User', timeline: { timeline: { instructions, metadata: { scribeConfig: { page: 'profile' } } } } } } } });
const url = (op, vars = {}) => `https://x.com/i/api/graphql/${Buffer.from(op).toString('base64url').slice(0, 22)}/${op}?variables=${encodeURIComponent(JSON.stringify(vars))}&features=%7B%7D`;
const RESET = Math.floor(NOW / 1000) + 900;
function page(op, body, remaining = 240, limit = 250) { return { url: url(op, { count: 20 }), rateLimit: { limit, remaining, reset: RESET }, body }; }

// ---- @ExcelBugs_Demo's originals: ~60 posts over the last ~200 days, plus older ones without views ----
// Format medians on purpose: text ~1.5K, image ~3K, video ~9K, quote ~800, link ~600, thread ~5K.
const BASE = { text: 1500, image: 3000, video: 9000, quote: 800, link: 600, thread: 5000 };
const originals = [];
const quotedPool = [];
function addOriginal(fmt, at, mult, extra = {}) {
  const views = Math.round(BASE[fmt] * mult);
  const o = { user: demo, at, views, likes: Math.round(views * 0.012), replies: Math.round(views * 0.002), reposts: Math.round(views * 0.001),
    quotes: Math.round(views * 0.0003), bookmarks: Math.round(views * 0.004), ...extra };
  if (fmt === 'image') o.media = [{ type: 'photo' }];
  if (fmt === 'video') o.media = [{ type: 'video', duration: 20 + Math.round(rnd() * 70) }];
  if (fmt === 'link') o.url = 'https://excelbugs.example/blog/' + seq;
  if (fmt === 'quote') { const q = tweet({ user: other, at: at - 3 * 3600000, views: 40000, likes: 900 }); quotedPool.push(q); o.quoted = q; }
  if (fmt === 'thread') o.selfThread = 'SELF';
  const t = tweet(o);
  if (fmt === 'thread') t.legacy.self_thread.id_str = t.rest_id;
  originals.push(t);
  return t;
}
const plan = [];
for (let i = 0; i < 12; i++) plan.push('text');
for (let i = 0; i < 10; i++) plan.push('image');
for (let i = 0; i < 10; i++) plan.push('video');
for (let i = 0; i < 9; i++) plan.push('quote');
for (let i = 0; i < 5; i++) plan.push('link'); // under 8: falls back to the overall median (≈)
for (let i = 0; i < 3; i++) plan.push('thread');
// Shuffle, then spread over ~200 days (newest first), keeping the multipliers deterministic.
plan.sort(() => rnd() - 0.5);
const mults = plan.map((_, i) => [0.4, 0.6, 0.8, 0.9, 1, 1, 1.1, 1.25, 1.5, 0.7][i % 10]);
plan.forEach((fmt, i) => addOriginal(fmt, NOW - (1.5 + i * 3.3) * DAY - Math.round(rnd() * 8) * 3600000, mults[i]));
// Outliers: an image at 12× its median and a text post at 6×.
const bigImage = addOriginal('image', NOW - 10.2 * DAY, 12, { text: 'The 3 Excel shortcuts nobody taught you #excel #shortcuts' });
const bigText = addOriginal('text', NOW - 22.6 * DAY, 6, { text: 'Stop using VLOOKUP. Here is why (thread-free version).' });
// A long post (note_tweet), an edited post, an AI-disclosed image, an article.
const noteText = 'Long post about LET and LAMBDA. '.repeat(18).trim();
const longPost = addOriginal('text', NOW - 30.1 * DAY, 1, { note: noteText, edits: null });
const edited = tweet({ user: demo, at: NOW - 40.4 * DAY, views: 1400, likes: 20, text: 'Edited: fixed a typo in this tip' });
edited.edit_control = { edit_control_initial: { edit_tweet_ids: [snow(NOW - 40.5 * DAY), edited.rest_id], editable_until_msecs: String(NOW - 40 * DAY), is_edit_eligible: true, edits_remaining: '4' } };
originals.push(edited);
const aiImage = addOriginal('image', NOW - 45.3 * DAY, 1, { ai: true, text: 'Made the cover with an image model' });
const article = tweet({ user: demo, at: NOW - 50.2 * DAY, views: 7000, likes: 140, article: { title: 'The complete guide to dynamic arrays' }, text: 'x.com/i/article/demo' });
originals.push(article);
// The pinned post (an old video outlier, pinned at the top of the profile).
const pinned = tweet({ user: demo, at: NOW - 160 * DAY, views: 250000, likes: 5100, replies: 210, reposts: 800, quotes: 90, bookmarks: 4400, media: [{ type: 'video', duration: 58 }], text: 'My most-watched Excel trick. #excel' });
demo.pinned = pinned.rest_id;
// Fresh post (6 hours old): scored, not in the median.
const fresh = addOriginal('text', NOW - 6 * 3600000, 0.2, { text: 'Fresh post, still collecting views' });
// Pre-2023 posts: views state "Enabled", no count.
const oldPosts = [0, 1, 2, 3].map((i) => tweet({ user: demo, at: Date.UTC(2021, 3 + i, 10, 15), views: null, likes: 40 + i, replies: 2, text: 'An old post from 2021 #' + i }));
// A tombstone entry and an unavailable one.
const tombstone = { entryId: 'tweet-1', sortIndex: '1', content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineTweet', tweet_results: { result: { __typename: 'TweetTombstone', tombstone: { text: { text: 'This Post was deleted.' } } } } } } };
const unavailable = { entryId: 'tweet-2', sortIndex: '2', content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineTweet', tweet_results: { result: { __typename: 'TweetUnavailable', reason: 'Suspended' } } } } };

const ordered = originals.slice().sort((a, b) => (BigInt(b.rest_id) > BigInt(a.rest_id) ? 1 : -1));
// Shuffle the entries' order inside the response: the parser sorts by sortIndex (BigInt).
const half = Math.ceil(ordered.length / 2);
const p1 = ordered.slice(0, half);
const p2 = ordered.slice(half).concat(oldPosts);
const scramble = (list) => list.slice().sort(() => rnd() - 0.5);
writeFileSync(join(out, 'UserOriginalsTimeline.json'), JSON.stringify([
  page('UserOriginalsTimeline', userTimeline([
    { type: 'TimelineClearCache' },
    { type: 'TimelinePinEntry', entry: tweetEntry(pinned, { pinned: true, sortIndex: '1898000000000000000' }) },
    { type: 'TimelineAddEntries', entries: scramble(p1.map((t) => tweetEntry(t))).concat([cursor('top', '1897999999999999999'), cursor('bottom', p1[p1.length - 1].rest_id)]) }
  ]), 244),
  page('UserOriginalsTimeline', userTimeline([
    { type: 'TimelineAddEntries', entries: scramble(p2.map((t) => tweetEntry(t))).concat([tombstone, unavailable, cursor('bottom', '100')]) }
  ]), 243)
], null, 1));

// ---- replies tab: profile-conversation modules (someone's post + @ExcelBugs_Demo's reply) ----
const replyModules = [];
const replies = [];
for (let i = 0; i < 6; i++) {
  const at = NOW - (2 + i * 4) * DAY;
  const parent = tweet({ user: i % 2 ? other : small, at: at - 3600000, views: 20000 + i * 100, likes: 300 });
  const reply = tweet({ user: demo, at, views: 150 + i * 40, likes: 3 + i, replyTo: { id: parent.rest_id, user: i % 2 ? other : small }, conversation: parent.rest_id, text: 'Great point, also try ' + pick(TOPICS) });
  replies.push(reply);
  replyModules.push(moduleEntry('profile-conversation-' + reply.rest_id, [parent, reply], reply.rest_id));
}
writeFileSync(join(out, 'UserRepliesTimeline.json'), JSON.stringify([page('UserRepliesTimeline', userTimeline([
  { type: 'TimelineClearCache' }, { type: 'TimelineAddEntries', entries: replyModules.concat([cursor('bottom', '200')]) }
]))], null, 1));

// ---- reposts tab ----
const reposted = [0, 1, 2].map((i) => tweet({ user: other, at: NOW - (3 + i * 5) * DAY, views: 88000 + i, likes: 2000, media: [{ type: 'photo' }] }));
const reposts = reposted.map((r, i) => tweet({ user: demo, at: NOW - (3 + i * 5) * DAY + 7200000, views: 0, rt: r, text: 'RT' }));
writeFileSync(join(out, 'UserRepostsTimeline.json'), JSON.stringify([page('UserRepostsTimeline', userTimeline([
  { type: 'TimelineAddEntries', entries: reposts.map((t) => tweetEntry(t)).concat([cursor('bottom', '300')]) }
]))], null, 1));

// ---- media tab (videos): a grid module, the next page appended with TimelineAddToModule ----
const vids = originals.filter((t) => (t.legacy.extended_entities?.media || []).some((m) => m.type === 'video'));
writeFileSync(join(out, 'UserVideoTimeline.json'), JSON.stringify([
  page('UserVideoTimeline', userTimeline([{ type: 'TimelineAddEntries', entries: [moduleEntry('profile-grid-0', vids.slice(0, 5), '1897000000000000000', 'VerticalGrid'), cursor('bottom', '400')] }])),
  page('UserVideoTimeline', userTimeline([{ type: 'TimelineAddToModule', moduleEntryId: 'profile-grid-0', prepend: false,
    moduleItems: vids.slice(5).map((t) => ({ entryId: 'profile-grid-0-tweet-' + t.rest_id, item: { itemContent: { itemType: 'TimelineTweet', tweet_results: { result: t } } } })) }, { type: 'TimelineAddEntries', entries: [cursor('bottom', '401')] }]))
], null, 1));
const photos = originals.filter((t) => (t.legacy.extended_entities?.media || []).some((m) => m.type === 'photo'));
writeFileSync(join(out, 'UserPhotoTimeline.json'), JSON.stringify([page('UserPhotoTimeline', userTimeline([
  { type: 'TimelineAddEntries', entries: [moduleEntry('profile-grid-0', photos, '1897000000000000000', 'VerticalGrid')] }]))], null, 1));
writeFileSync(join(out, 'UserHighlightsTweets.json'), JSON.stringify([page('UserHighlightsTweets', userTimeline([
  { type: 'TimelineAddEntries', entries: [tweetEntry(bigImage), tweetEntry(bigText), cursor('bottom', '500')] }]))], null, 1));

// ---- the older operations, with the old `legacy` user shape (fallback) ----
const smallPosts = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => tweet({ user: small, at: NOW - (1.5 + i * 9) * DAY, views: [16, 9, 30, 12, 679, 20, 14, 18, 11][i], likes: i, legacyUser: true,
  quoted: i % 2 ? tweet({ user: other, at: NOW - (2 + i * 9) * DAY, views: 5000 }) : undefined, text: 'Building in public, day ' + i }));
writeFileSync(join(out, 'UserTweets.json'), JSON.stringify([{ ...page('UserTweets', { data: { user: { result: { __typename: 'User', timeline_v2: { timeline: { instructions: [
  { type: 'TimelineAddEntries', entries: smallPosts.map((t) => tweetEntry(t)) }] } } } } } }) }], null, 1));
writeFileSync(join(out, 'UserTweetsAndReplies.json'), JSON.stringify([page('UserTweetsAndReplies', userTimeline([
  { type: 'TimelineAddEntries', entries: [tweetEntry(smallPosts[0]), moduleEntry('profile-conversation-x', [replies[0]], '1')] }]))], null, 1));

// ---- Home: several authors, a visibility wrapper, a promoted post, a repost, an alert ----
const homeTweets = [
  tweet({ user: other, at: NOW - 2 * 3600000, views: 120000, likes: 3000, media: [{ type: 'video', duration: 41 }] }),
  tweet({ user: small, at: NOW - 5 * 3600000, views: 40, likes: 2, visibility: true }),
  tweet({ user: demo, at: NOW - 7 * 3600000, views: 2600, likes: 30 }),
  tweet({ user: fan, at: NOW - 8 * 3600000, views: 300, likes: 4, rt: reposted[0] })
];
const promo = tweet({ user: brand, at: NOW - 40 * DAY, views: 900000, likes: 80, url: 'https://brand.example/buy' });
writeFileSync(join(out, 'HomeTimeline.json'), JSON.stringify([{ ...page('HomeTimeline', { data: { home: { home_timeline_urt: { instructions: [
  { type: 'TimelineAddEntries', entries: homeTweets.map((t) => tweetEntry(t)).concat([tweetEntry(promo, { promoted: true, sortIndex: '1897500000000000000' }), cursor('top', '9'), cursor('bottom', '8')]) },
  { type: 'TimelineShowAlert', alertType: 'NewTweets', triggerDelayMs: 240000, usersResults: [] }
], metadata: {} } } } }, 497, 500) }], null, 1));
writeFileSync(join(out, 'HomeLatestTimeline.json'), JSON.stringify([page('HomeLatestTimeline', { data: { home: { home_timeline_urt: { instructions: [
  { type: 'TimelineAddEntries', entries: homeTweets.slice(0, 2).map((t) => tweetEntry(t)) }] } } } })], null, 1));

// ---- Search (Latest) and a list ----
const searchTweets = [tweet({ user: other, at: NOW - 3600000, views: 5100, likes: 70, text: 'XLOOKUP vs INDEX/MATCH #excel' }), tweet({ user: fan, at: NOW - 2 * 3600000, views: 80, likes: 1, text: 'excel is fun' })];
writeFileSync(join(out, 'SearchTimeline.json'), JSON.stringify([page('SearchTimeline', { data: { search_by_raw_query: { search_timeline: { timeline: { instructions: [
  { type: 'TimelineAddEntries', entries: searchTweets.map((t) => tweetEntry(t)).concat([cursor('bottom', '7')]) }] } } } } }, 49, 50)], null, 1));
writeFileSync(join(out, 'ListLatestTweetsTimeline.json'), JSON.stringify([page('ListLatestTweetsTimeline', { data: { list: { tweets_timeline: { timeline: { instructions: [
  { type: 'TimelineAddEntries', entries: [tweetEntry(homeTweets[0]), tweetEntry(homeTweets[2])] }] } } } } })], null, 1));

// ---- TweetDetail: a thread root, its self-replies (thread parts), other people's replies, related posts ----
const rootAt = NOW - 12 * DAY;
const root = tweet({ user: demo, at: rootAt, views: 26000, likes: 410, replies: 33, reposts: 60, text: '10 Excel functions I use every day. A thread 🧵' });
const parts = [1, 2, 3].map((i) => tweet({ user: demo, at: rootAt + i * 60000, views: 4000 - i * 500, likes: 30, replyTo: { id: i === 1 ? root.rest_id : 'prev', user: demo }, conversation: root.rest_id, text: `${i}/ ${pick(TOPICS)}` }));
parts.forEach((p, i) => { if (i > 0) p.legacy.in_reply_to_status_id_str = parts[i - 1].rest_id; });
const others = [0, 1].map((i) => tweet({ user: fan, at: rootAt + (10 + i) * 60000, views: 90, likes: 1, replyTo: { id: root.rest_id, user: demo }, conversation: root.rest_id, text: 'Nice thread' }));
const related = tweet({ user: other, at: NOW - 20 * DAY, views: 31000, likes: 500 });
writeFileSync(join(out, 'TweetDetail.json'), JSON.stringify([
  page('TweetDetail', { data: { threaded_conversation_with_injections_v2: { instructions: [
    { type: 'TimelineAddEntries', entries: [
      tweetEntry(root),
      moduleEntry('conversationthread-' + parts[0].rest_id, parts.slice(0, 2), '7'),
      moduleEntry('conversationthread-' + others[0].rest_id, [others[0]], '6'),
      moduleEntry('tweetdetailrelatedtweets-1', [related], '5', 'Vertical'),
      { entryId: 'cursor-showmorethreads-1', sortIndex: '4', content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineTimelineCursor', value: 'more', cursorType: 'ShowMoreThreads' } } }
    ] },
    { type: 'TimelineTerminateTimeline', direction: 'Top' }
  ] } } }, 148, 150),
  page('TweetDetail', { data: { threaded_conversation_with_injections_v2: { instructions: [
    { type: 'TimelineAddToModule', moduleEntryId: 'conversationthread-' + parts[0].rest_id, prepend: false, moduleItems: [{ entryId: 'x-tweet-' + parts[2].rest_id, item: { itemContent: { itemType: 'TimelineTweet', tweet_results: { result: parts[2] } } } }] },
    { type: 'TimelineAddEntries', entries: [moduleEntry('conversationthread-' + others[1].rest_id, [others[1]], '3')] }
  ] } } }, 147, 150)
], null, 1));
writeFileSync(join(out, 'TweetResultByRestId.json'), JSON.stringify([page('TweetResultByRestId', { data: { tweetResult: { result: bigImage } } })], null, 1));

// ---- users ----
writeFileSync(join(out, 'UserByScreenName.json'), JSON.stringify([page('UserByScreenName', { data: { user: { result: userNode(demo) } } }, 149, 150)], null, 1));
const userEntry = (u) => ({ entryId: 'user-' + u.restId, sortIndex: '1', content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineUser', __typename: 'TimelineUser', user_results: { result: userNode(u) }, userDisplayType: 'User' } } });
writeFileSync(join(out, 'BlueVerifiedFollowers.json'), JSON.stringify([page('BlueVerifiedFollowers', userTimeline([
  { type: 'TimelineAddEntries', entries: [userEntry(other), userEntry(brand), cursor('bottom', '0|1')] }]))], null, 1));

// ---- analytics (stored raw for Phase 2) ----
const series = [];
for (let d = 0; d < 90; d += 3) {
  for (const verified of ['true', 'false']) {
    series.push({ engagement_type: 'Displayed', is_engaging_user_verified: verified, count: String(verified === 'true' ? 2 + d % 5 : 5 + d % 7), timestamp: String(NOW - d * DAY) });
  }
  if (d % 9 === 0) series.push({ engagement_type: 'Follow', is_engaging_user_verified: 'false', count: '1', timestamp: String(NOW - d * DAY) });
}
writeFileSync(join(out, 'accountOverviewDailyQuery.json'), JSON.stringify([page('accountOverviewDailyQuery', { data: { viewer_v2: { user_results: { result: {
  __typename: 'User', rest_id: small.restId, verified_follower_count: '9', relationship_counts: { followers: 80 },
  current_time_series: series, previous_totals: [], hourly_backfill: [], legacy_current_metrics: {}, realtime_active_followers: { active_count: 36, is_approximate: false }
} } } } }, 99, 100)], null, 1));
writeFileSync(join(out, 'contentPageQuery.json'), JSON.stringify([page('contentPageQuery', { data: { viewer_v2: { user_results: { result: {
  __typename: 'User', rest_id: small.restId, tweets_results: [] } } } } }, 99, 100)], null, 1));

writeFileSync(join(out, 'meta.json'), JSON.stringify({
  now: NOW, demo: { handle: demo.handle, restId: demo.restId }, small: { handle: small.handle, restId: small.restId },
  ids: { pinned: pinned.rest_id, bigImage: bigImage.rest_id, bigText: bigText.rest_id, longPost: longPost.rest_id, edited: edited.rest_id,
    aiImage: aiImage.rest_id, article: article.rest_id, fresh: fresh.rest_id, old: oldPosts.map((t) => t.rest_id), root: root.rest_id,
    parts: parts.map((t) => t.rest_id), others: others.map((t) => t.rest_id), related: related.rest_id, promo: promo.rest_id,
    reposts: reposts.map((t) => t.rest_id), reposted: reposted.map((t) => t.rest_id), replies: replies.map((t) => t.rest_id) }
}, null, 1));
console.log('wrote', out, originals.length + 1, 'originals for @' + demo.handle);
