// Instagram carousels and photos (scored by likes), comment stats and the extra
// post facts the extractor keeps. All accounts and numbers are made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const X = require('../src/extract.js');
const M = require('../src/metrics.js');

const NOW = Date.UTC(2026, 10, 19, 12);
const DAY = 864e5;

const carousel = (i, likes, extra = {}) => ({
  code: 'CAR' + String(i).padStart(4, '0'), owner: 'demo', type: 'carousel', likes, comments: 10, takenAt: NOW - (10 + i) * DAY,
  caption: 'Five budgeting rules #finance', hashtags: ['finance'], slides: 3 + (i % 8), ...extra
});
const reel = (i, views, extra = {}) => ({
  code: 'REEL' + String(i).padStart(3, '0'), owner: 'demo', type: 'reel', views, likes: Math.round(views / 20), comments: 5, takenAt: NOW - (10 + i) * DAY, ...extra
});

test('extract: a carousel keeps its slides, people, place, size and full caption', () => {
  const longCaption = 'Hook line. ' + 'word '.repeat(300) + '👉 Comment “CFO” and I’ll send you the link #finance';
  const p = X.parseMedia({
    code: 'CAROUSEL01', pk: '99', taken_at: 1700000000, media_type: 8, carousel_media_count: 3,
    like_count: 420, comment_count: 37, reshare_count: 12,
    caption: { text: longCaption },
    user: { username: 'Demo', pk: '5', full_name: 'Demo Account' },
    usertags: { in: [{ user: { username: 'FriendOne' } }] },
    coauthor_producers: [{ username: 'Partner' }],
    location: { name: 'Istanbul, Turkey' },
    music_metadata: { music_info: { music_asset_info: { title: 'Golden Hour', display_artist: 'Studio Band' } } },
    carousel_media: [
      { media_type: 1, original_width: 1080, original_height: 1350, image_versions2: { candidates: [{ url: 'https://cdn.example/1.jpg' }] } },
      { media_type: 2, video_versions: [{ url: 'https://cdn.example/2.mp4' }], usertags: { in: [{ user: { username: 'friendtwo' } }, { user: { username: 'friendone' } }] } },
      { media_type: 1, image_versions2: { candidates: [{ url: 'https://cdn.example/3.jpg' }] } }
    ]
  });
  assert.equal(p.type, 'carousel');
  assert.equal(p.slides, 3);
  assert.equal(p.slideVideos, 1);
  assert.deepEqual(p.tagged, ['friendone', 'friendtwo']);
  assert.deepEqual(p.collabs, ['partner']);
  assert.equal(p.location, 'Istanbul, Turkey');
  assert.equal(p.width, 1080);
  assert.equal(p.height, 1350);
  assert.equal(p.shares, 12);
  assert.deepEqual(p.audio, { kind: 'music', title: 'Golden Hour', artist: 'Studio Band' });
  assert.equal(p.caption, longCaption, 'the caption is kept whole: the call to action sits at its end');
  assert.equal(M.commentKeyword(p.caption), 'CFO');
  assert.equal(p.files.length, 3);
});

test('extract: slim records stay slim, hidden likes and closed comments are noted', () => {
  const slim = X.parseMedia({ code: 'SLIMPOST1', media_type: 1, taken_at: 1700000000, like_count: 5 });
  ['slides', 'tagged', 'collabs', 'location', 'width', 'likesHidden', 'commentsOff', 'title'].forEach((k) => assert.ok(!(k in slim), k));
  const hidden = X.parseMedia({ code: 'HIDDEN001', media_type: 1, taken_at: 1700000000, like_and_view_counts_disabled: true, comments_disabled: true, comment_count: 3 });
  assert.equal(hidden.likesHidden, true);
  assert.equal(hidden.commentsOff, true);
  assert.equal(hidden.likes, null);
  // GraphQL shape
  const g = X.parseMedia({
    shortcode: 'GRAPHQL01', __typename: 'GraphSidecar', taken_at_timestamp: 1700000000, dimensions: { width: 1080, height: 1080 },
    edge_media_preview_like: { count: 9 }, edge_media_to_tagged_user: { edges: [{ node: { user: { username: 'Someone' } } }] },
    edge_sidecar_to_children: { edges: [{ node: { is_video: false, display_url: 'https://cdn.example/a.jpg' } }, { node: { is_video: true, video_url: 'https://cdn.example/b.mp4' } }] }
  });
  assert.equal(g.slides, 2);
  assert.equal(g.slideVideos, 1);
  assert.deepEqual(g.tagged, ['someone']);
  assert.equal(g.width, 1080);
});

test('extract: profile facts from web_profile_info and from the newer user shape', () => {
  const a = X.parseProfile(JSON.stringify({ data: { user: {
    id: '123', username: 'Demo', full_name: 'Demo Account', is_verified: true, category_name: 'Finance',
    edge_followed_by: { count: 250000 }, edge_follow: { count: 310 }, edge_owner_to_timeline_media: { count: 1840, edges: [] }
  } } }));
  assert.deepEqual({ ...a, seenAt: 0 }, { username: 'demo', id: '123', name: 'Demo Account', followers: 250000, following: 310, posts: 1840, verified: true, private: false, category: 'Finance', seenAt: 0 });
  const b = X.profileOf({ user: { pk: '77', username: 'other', follower_count: 12, following_count: 3, media_count: 40 } });
  assert.equal(b.followers, 12);
  assert.equal(b.posts, 40);
  assert.equal(b.id, '77');
  assert.equal(X.parseProfile('{"items":[{"user":{"username":"x","follower_count":5}}]}'), null, 'a user nested in a feed item is not the profile');
  assert.equal(X.parseProfile('{"data":{"user":{"username":"x"}}}'), null);
  assert.equal(X.parseProfile('not json "follower_count"'), null);
});

test('metrics: carousels and photos are scored by likes, on their own median', () => {
  const posts = [];
  for (let i = 0; i < 9; i++) posts.push(carousel(i, 100));
  posts.push(carousel(9, 450));                          // 4.5× the median carousel
  posts.push({ code: 'PHOTO0001', owner: 'demo', type: 'photo', likes: 50, comments: 2, takenAt: NOW - 30 * DAY });
  for (let i = 0; i < 5; i++) posts.push(reel(i, 10000));
  posts.push(reel(5, 30000));
  const e = M.enrich(posts, { now: NOW });
  const by = Object.fromEntries(e.map((p) => [p.code, p]));
  assert.equal(by.CAR0009.basis, 'likes');
  assert.equal(by.CAR0009.ratio, 4.5);
  assert.equal(by.CAR0009.outlier, true);
  assert.equal(by.CAR0009.viralScore, 100);
  assert.equal(by.PHOTO0001.ratio, 0.5, 'photos share the carousel median');
  assert.equal(by.CAR0000.ratio, 1);
  assert.equal(by.REEL005.basis, 'views');
  assert.equal(by.REEL005.ratio, 3, 'reels keep their own views median, untouched by the carousels');
  assert.equal(by.REEL000.ratio, 1);
  // Engagement of a carousel = comments per 100 likes (it has no views).
  assert.equal(by.CAR0000.engagement, 10);
  assert.equal(by.CAR0000.commentsPer100Likes, 10);
  assert.equal(by.REEL000.commentsPer100Likes, 1);
  // Sorting by views never ranks a carousel by its likes.
  assert.equal(M.sortBy(e, 'views')[0].code, 'REEL005');
  assert.equal(M.sortBy(e, 'views').pop().type !== 'reel', true);
  assert.equal(M.sortBy(e, 'viralScore')[0].code, 'CAR0009');
  // TikTok photo posts have views and stay on views.
  assert.equal(M.basisOf({ platform: 'tiktok', type: 'photo', views: 5 }), 'views');
});

test('metrics: no likes score below 8 carousels and photos; reels are scored as before', () => {
  const few = [];
  for (let i = 0; i < 7; i++) few.push(carousel(i, 100));
  few.push(carousel(7, null));                           // likes hidden: does not count toward the 8
  const e = M.enrich(few.concat([reel(0, 100), reel(1, 300)]), { now: NOW });
  assert.ok(e.filter((p) => p.type === 'carousel').every((p) => p.ratio === null && p.viralScore === null && !p.outlier));
  assert.equal(e.find((p) => p.code === 'REEL001').ratio, 1.5);
  assert.equal(M.MIN_BASELINE, 8);
});

test('metrics: pinned posts and posts under 72 hours old are scored but left out of the median', () => {
  const posts = [];
  for (let i = 0; i < 8; i++) posts.push(carousel(i, 100));
  posts.push(carousel(8, 5000, { pinned: true }));
  posts.push(carousel(9, 5000, { pinned: true }));
  posts.push(carousel(10, 4, { takenAt: NOW - 2 * 3600e3 }));   // two hours old
  posts.push(carousel(11, 4, { takenAt: NOW - 20 * 3600e3 }));
  const e = M.enrich(posts, { now: NOW });
  const by = Object.fromEntries(e.map((p) => [p.code, p]));
  assert.equal(by.CAR0000.ratio, 1, 'the median is still 100');
  assert.equal(by.CAR0008.ratio, 50);
  assert.equal(by.CAR0010.ratio, 0.04);
  assert.equal(M.inBaseline({ takenAt: NOW - 73 * 3600e3 }, NOW), true);
  assert.equal(M.inBaseline({ takenAt: NOW - 71 * 3600e3 }, NOW), false);
  assert.equal(M.inBaseline({}, NOW), true, 'no date: counts');
  // Reels follow the same rule.
  const reels = [reel(0, 100), reel(1, 100), reel(2, 100), reel(3, 900, { pinned: true }), reel(4, 900, { pinned: true }), reel(5, 900, { pinned: true }), reel(6, 900, { pinned: true })];
  assert.equal(M.enrich(reels, { now: NOW })[0].ratio, 1);
  // Nothing but pinned posts: fall back to what there is.
  assert.equal(M.enrich([reel(0, 100, { pinned: true }), reel(1, 300, { pinned: true })], { now: NOW })[1].ratio, 1.5);
});

test('metrics: comment score, comments per 100 likes and the comment keyword', () => {
  const posts = [];
  for (let i = 0; i < 9; i++) posts.push(carousel(i, 100, { comments: 20 }));
  posts.push(carousel(9, 120, { comments: 600, caption: 'I built a course\n👉 Comment “CFO” and I’ll send you the link' }));
  const e = M.enrich(posts, { now: NOW });
  const hit = e.find((p) => p.code === 'CAR0009');
  assert.equal(hit.commentRatio, 30);
  assert.equal(hit.commentsPer100Likes, 500);
  assert.equal(hit.commentKeyword, 'CFO');
  assert.equal(hit.outlier, false, 'by likes it is an ordinary post: the comments are what stand out');
  assert.equal(M.sortBy(e, 'commentRatio')[0].code, 'CAR0009');
  assert.equal(e[0].commentKeyword, null);

  const kw = M.commentKeyword;
  assert.equal(kw('Follow @x + Comment “Copilot” and I’ll send you my FREE ebook'), 'COPILOT');
  assert.equal(kw('comment \'guide\' to get it'), 'GUIDE');
  assert.equal(kw('Drop "AI" in the comments'), 'AI');
  assert.equal(kw('Yorumlara "EXCEL" yaz, linki göndereyim'), 'EXCEL');
  assert.equal(kw('Comment CFO and I will DM you'), 'CFO');
  assert.equal(kw('Comment and I’ll send it. Don’t miss it'), null, 'an apostrophe is not a quote');
  assert.equal(kw('Let me know in the comments what you think'), null);
  assert.equal(kw('I read every comment. "Thanks" to all'), null);
  assert.equal(kw('Comment below and tell me "what do you really think about this one"'), null, 'a sentence is not a keyword');
  assert.equal(kw(''), null);
  assert.equal(kw(null), null);
});

test('metrics: Instagram analytics for a carousel list, and the CSV columns', () => {
  const posts = [];
  for (let i = 0; i < 12; i++) posts.push(carousel(i, 100 + i * 10, { comments: 10 + i, slides: i < 6 ? 3 : 9 }));
  posts.push(carousel(12, 300, { comments: 900, caption: 'Comment "GUIDE" to get it', collabs: ['partner'] }));
  posts.push(carousel(13, 280, { comments: 700, caption: 'Comment "GUIDE" for the file' }));
  posts.push({ code: 'PHOTO0001', owner: 'demo', type: 'photo', likes: 60, comments: 1, takenAt: NOW - 40 * DAY, caption: '' });
  const e = M.enrich(posts, { now: NOW });
  const a = M.analyze(e);
  assert.equal(a.summary.basis, 'likes');
  assert.equal(a.summary.keywordPosts, 2);
  assert.equal(a.summary.medianViews, M.median(posts.map((p) => p.likes)), 'for carousels and photos the "views" slots hold likes');
  const ig = a.instagram;
  assert.deepEqual(ig.types.map((g) => [g.key, g.count]), [['Carousels', 14], ['Photos', 1]]);
  assert.deepEqual(ig.slides.map((g) => [g.key, g.count]), [['2–4 slides', 6], ['5–7 slides', 1], ['8–10 slides', 7]]);
  assert.deepEqual(ig.keywords.map((g) => [g.key, g.count, g.medianComments, g.totalComments]), [['GUIDE', 2, 800, 1600]]);
  assert.deepEqual(ig.cta.map((g) => g.key), ['Comment keyword', 'No keyword']);
  assert.ok(ig.cta[0].medianComments > ig.cta[1].medianComments * 10);
  assert.deepEqual(ig.collabs.map((g) => [g.key, g.count]), [['Collab post', 1], ['Solo post', 14]]);
  assert.equal(ig.topComments[0].code, 'CAR0012');
  assert.ok(ig.captions.some((g) => g.key === 'No caption' && g.count === 1));

  // A list of reels and carousels together is flagged as mixed (views + likes).
  assert.equal(M.analyze(M.enrich(posts.concat([reel(0, 1000)]), { now: NOW })).summary.basis, 'mixed');
  assert.equal(M.analyze(M.enrich([reel(0, 1000)], { now: NOW })).summary.basis, 'views');

  ['scored_by', 'comments_x_median', 'comments_per_100_likes', 'comment_keyword', 'slides', 'collabs', 'tagged', 'location'].forEach((c) => assert.ok(M.COLUMN_NAMES.includes(c), c));
  const rows = M.toTable(M.sortBy(e, 'commentRatio').slice(0, 1)).split('\r\n');
  const col = (name) => rows[1].split(',')[rows[0].split(',').indexOf(name)];
  assert.equal(col('scored_by'), 'likes');
  assert.equal(col('comment_keyword'), 'GUIDE');
  assert.equal(col('collabs'), 'partner');
  assert.equal(col('slides'), '7');
});

test('MCP library: carousels in account rows, account_summary and top_reels', async () => {
  const L = await import('../mcp/library.mjs');
  const posts = {};
  for (let i = 0; i < 10; i++) { const c = carousel(i, 100, { url: 'https://www.instagram.com/p/x/' }); posts[c.code] = c; }
  const big = carousel(10, 900, { comments: 400, caption: 'Comment "PLAN" and I will send it' });
  posts[big.code] = big;
  for (let i = 0; i < 6; i++) { const r = reel(i, 1000 * (i + 1)); posts[r.code] = r; }
  const lib = { accounts: { demo: { posts, updatedAt: NOW, profile: { followers: 250000, posts: 1840 } } }, org: { folders: [], accounts: {} } };

  const row = L.accountRow(lib, 'demo');
  assert.equal(row.reels, 6);
  assert.equal(row.carousels_and_photos, 11);
  assert.equal(row.median_likes_carousels_photos, 100);
  assert.equal(row.outliers_carousels_photos, 1);
  assert.equal(row.followers, 250000);
  assert.equal(row.posts_on_profile, 1840);

  const s = L.accountSummary(lib, 'demo');
  assert.equal(s.summary.reels_analyzed, 6, 'the reel summary still covers reels only');
  const c = s.carousels_and_photos;
  assert.equal(c.posts_analyzed, 11);
  assert.equal(c.median_likes, 100);
  assert.equal(c.outliers, 1);
  assert.equal(c.top_posts[0].code, big.code);
  assert.equal(c.top_posts[0].scored_by, 'likes');
  assert.equal(c.top_posts[0].x_account_median, 9);
  assert.equal(c.top_posts[0].comment_keyword, 'PLAN');
  assert.equal(c.top_posts[0].engagement_pct, null);
  assert.equal(c.comments.keyword_posts, 1);
  assert.deepEqual(c.comments.keywords.map((k) => [k.keyword, k.total_comments]), [['PLAN', 400]]);
  assert.equal(s.reel_comments.median_comments, 5);

  const reels = L.topReels(lib, { usernames: ['demo'] });
  assert.ok(reels.reels.every((p) => p.type === 'reel'));
  const cp = L.topReels(lib, { usernames: ['demo'], post_type: 'carousels_photos' });
  assert.equal(cp.matched, 11);
  assert.equal(cp.reels[0].code, big.code);
  assert.match(cp.scoring_note, /likes/);
  const all = L.topReels(lib, { usernames: ['demo'], include_photos: true, sort: 'comments_x_median' });
  assert.equal(all.matched, 17);
  assert.equal(all.reels[0].code, big.code);
  assert.equal(L.topReels(lib, { usernames: ['demo'], post_type: 'carousels_photos', min_views: 500 }).matched, 1, 'min_views filters likes for carousels');

  // An account with only a few carousels: listed, but not scored yet.
  const few = {};
  for (let i = 0; i < 3; i++) { const c2 = carousel(i, 100 * (i + 1)); few[c2.code] = c2; }
  const lib2 = { accounts: { small: { posts: few, updatedAt: NOW } }, org: { folders: [], accounts: {} } };
  const sm = L.accountSummary(lib2, 'small').carousels_and_photos;
  assert.equal(sm.outliers, 0);
  assert.match(sm.how_scored, /Not enough yet/);
});

test('extract: a video slide keeps a still frame, so every slide of a carousel can be shown', () => {
  const p = X.parseMedia({
    code: 'SLIDES0001', taken_at: 1700000000, media_type: 8, like_count: 10,
    carousel_media: [
      { media_type: 1, image_versions2: { candidates: [{ url: 'https://cdn.example/1.jpg' }] } },
      { media_type: 2, video_versions: [{ url: 'https://cdn.example/2.mp4' }], image_versions2: { candidates: [{ url: 'https://cdn.example/2-frame.jpg' }] } },
      { media_type: 2, video_versions: [{ url: 'https://cdn.example/3.mp4' }] }
    ]
  });
  assert.deepEqual(p.files, [
    { kind: 'image', url: 'https://cdn.example/1.jpg' },
    { kind: 'video', url: 'https://cdn.example/2.mp4', thumb: 'https://cdn.example/2-frame.jpg' },
    { kind: 'video', url: 'https://cdn.example/3.mp4' }
  ]);
});
