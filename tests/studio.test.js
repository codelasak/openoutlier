const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/studio.js');

const campaign = (over = {}) => Object.assign({
  campaign_id: 'if-bug-a1b2c3',
  name: 'IF bug',
  media_id: '18121736053988869',
  keywords: ['PRACTICE'],
  match: 'exact',
  exclude: [],
  public_reply: { enabled: true, texts: ['Sent! 📩'] },
  check_follow: true,
  verify_follow: true,
  ask_email: false,
  reward: { type: 'link', value: 'https://handsonexcel.com/p/if' },
  copy: { opening: 'Hi 👋', opening_button: 'Send it', delivery: 'Here: {reward}', follow_retry: 'Still not following' },
  like_comment: false,
  active: true,
  archived: false,
  updated_at: 1794300000
}, over);

test('server address: origin only, https assumed, token required', () => {
  assert.deepEqual(S.normalizeServer({ baseUrl: ' practice-dm.x.workers.dev/app#/a ', token: ' t ' }),
    { baseUrl: 'https://practice-dm.x.workers.dev', origin: 'https://practice-dm.x.workers.dev', token: 't' });
  assert.equal(S.normalizeServer({ baseUrl: 'http://127.0.0.1:8787/', token: 't' }).baseUrl, 'http://127.0.0.1:8787');
  assert.match(S.normalizeServer({ baseUrl: '', token: 't' }).error, /address/);
  assert.match(S.normalizeServer({ baseUrl: 'ftp://x.dev', token: 't' }).error, /address/);
  assert.match(S.normalizeServer({ baseUrl: 'https://x.dev', token: '  ' }).error, /token/);
});

test('editing and saving without changes keeps the campaign as it was', () => {
  const c = campaign({ caption_match: 'You need 50 to pass. Cem got exactly 50', verify_follow_count: false });
  const res = S.campaignFromDraft(S.draftFromCampaign(c), c);
  assert.equal(res.active, true);
  const { active, archived, updated_at, ...stored } = c;
  assert.deepEqual(res.campaign, stored);
});

test('a paused campaign stays paused; list-only fields are never sent back', () => {
  const c = campaign({ active: false });
  const res = S.campaignFromDraft(S.draftFromCampaign(c), c);
  assert.equal(res.active, false);
  assert.equal('active' in res.campaign, false);
  assert.equal('updated_at' in res.campaign, false);
});

test('new automation on a published post', () => {
  const d = S.defaultDraft('111');
  Object.assign(d, { name: 'Sort bug!', keywords: 'practice, Practice,  LINK\n', reward_value: ' https://x.dev/a ' });
  const res = S.campaignFromDraft(d, null, 'fixed-id');
  assert.equal(res.error, undefined);
  assert.equal(res.campaign.campaign_id, 'fixed-id');
  assert.equal(res.campaign.media_id, '111');
  assert.deepEqual(res.campaign.keywords, ['practice', 'LINK']);
  assert.equal(res.campaign.caption_match, undefined);
  assert.deepEqual(res.campaign.reward, { type: 'link', value: 'https://x.dev/a' });
  assert.equal(res.campaign.copy.opening, S.DEFAULT_COPY.opening);
  assert.equal('follow_retry' in res.campaign.copy, false); // empty optional text is left out
  assert.match(S.campaignFromDraft(Object.assign({}, d, { campaign_id: '' }), null).campaign.campaign_id, /^sort-bug-[a-z0-9]+$/);
});

test('new automation for a post that is not published yet waits on its caption', () => {
  const d = S.defaultDraft('');
  assert.equal(d.attach, 'caption');
  Object.assign(d, { name: 'Next reel', keywords: 'PRACTICE', reward_value: 'x' });
  assert.match(S.campaignFromDraft(Object.assign({}, d, { caption_match: 'Too short…' }), null).error, /caption/);
  const res = S.campaignFromDraft(Object.assign({}, d, { caption_match: 'Lena has Mei’s sales. Sorting broke the rows' }), null, 'next');
  assert.equal(res.campaign.media_id, 'PENDING_next');
  assert.equal(res.campaign.caption_match, 'Lena has Mei’s sales. Sorting broke the rows');
});

test('re-saving a waiting automation keeps its placeholder; it can be moved to a published post', () => {
  const c = campaign({ media_id: 'PENDING_reel-07', caption_match: 'You need 50 to pass. Cem got exactly 50' });
  const d = S.draftFromCampaign(c);
  assert.equal(d.attach, 'caption');
  assert.equal(S.campaignFromDraft(d, c).campaign.media_id, 'PENDING_reel-07');
  const moved = S.campaignFromDraft(Object.assign({}, d, { attach: 'post', media_id: '999' }), c).campaign;
  assert.equal(moved.media_id, '999');
  assert.equal(moved.caption_match, c.caption_match); // as chatmany leaves it after auto-attaching
  assert.match(S.campaignFromDraft(Object.assign({}, d, { attach: 'post' }), c).error, /Choose the post/);
});

test('required fields and dependent switches', () => {
  const ok = S.draftFromCampaign(campaign());
  const err = (over) => S.campaignFromDraft(Object.assign({}, ok, over), null).error;
  assert.match(err({ name: ' ' }), /name/);
  assert.match(err({ keywords: ' , ' }), /keyword/);
  assert.match(err({ opening: '' }), /opening/);
  assert.match(err({ delivery: '' }), /delivery/);
  assert.match(err({ reward_value: '' }), /link, code or text/);
  assert.match(err({ reply_enabled: true, reply_texts: '\n' }), /public reply/);
  // verify_follow means nothing without the follow step
  assert.equal(S.campaignFromDraft(Object.assign({}, ok, { check_follow: false, verify_follow: true }), null).campaign.verify_follow, false);
});

test('attachment: on a recent post, on an older one, or still waiting', () => {
  const media = [{ id: '1', caption: 'a' }];
  assert.equal(S.attachment({ media_id: '1' }, media).state, 'attached');
  assert.equal(S.attachment({ media_id: '2' }, media).state, 'missing');
  assert.equal(S.attachment({ media_id: 'PENDING_x' }, media).state, 'waiting');
});

const MEDIA = [
  { id: 'm1', caption: 'You need 50 to pass.\n\n#excel #ExcelTips learnexcel', media_type: 'VIDEO', thumbnail_url: 'https://cdn/t1.jpg', permalink: 'https://www.instagram.com/reel/DfhWg2QITjo/', timestamp: '2026-11-09T12:40:31+0000', like_count: 1, comments_count: 2 },
  { id: 'm2', caption: 'Lena has Mei’s sales.', media_type: 'VIDEO', thumbnail_url: 'https://cdn/t2.jpg', permalink: 'https://www.instagram.com/reel/DfizlKEoJHh/', timestamp: '2026-11-10T02:13:40+0000', like_count: 0, comments_count: 0 },
  { id: 'm3', caption: 'A photo', media_type: 'IMAGE', media_url: 'https://cdn/p3.jpg', permalink: 'https://www.instagram.com/p/Dabc12345/', timestamp: '2026-11-01T08:00:00+0000', like_count: 4, comments_count: 0 }
];
const INSIGHTS = [
  { id: 'm1', media_product_type: 'REELS', insights: { views: 218, reach: 190, likes: 0, comments: 0, saved: 0, shares: 0, ig_reels_avg_watch_time: 3307, ig_reels_video_view_total_time: 684747, reels_skip_rate: 82.3 } },
  { id: 'm2', media_product_type: 'REELS', insights: null, error: 'Application does not have permission for this action', code: 10 },
  { id: 'm3', media_product_type: 'FEED', insights: { views: 40, reach: 31, likes: 4, comments: 0, saved: 1, shares: 0 } }
];

test('joinMedia: newest first, insights win, public counts fill in when insights are missing', () => {
  const rows = S.joinMedia(MEDIA, INSIGHTS);
  assert.deepEqual(rows.map((r) => r.id), ['m2', 'm1', 'm3']);
  const [m2, m1, m3] = rows;
  assert.equal(m1.takenAt, Date.UTC(2026, 10, 9, 12, 40, 31));
  assert.deepEqual([m1.type, m1.code, m1.views, m1.avgWatchMs, m1.skipRate, m1.likes], ['reel', 'DfhWg2QITjo', 218, 3307, 82.3, 0]);
  assert.deepEqual([m2.views, m2.likes, m2.comments, m2.error], [null, 0, 0, 'Application does not have permission for this action']);
  assert.deepEqual([m3.type, m3.code, m3.thumb, m3.saves, m3.avgWatchMs], ['photo', 'Dabc12345', 'https://cdn/p3.jpg', 1, null]);
  assert.equal(S.joinMedia(MEDIA, undefined).length, 3);
});

test('library records: official counts land on the post the web collector saved', () => {
  const rows = S.joinMedia(MEDIA, INSIGHTS);
  const existing = {
    DfhWg2QITjo: { code: 'DfhWg2QITjo', pk: '377', type: 'reel', views: 240, likes: 1, duration: 14.2, skipRate: 90, audio: { title: 'Original' }, seenAt: 5 },
    other: { code: 'other', views: 7 }
  };
  const out = S.mergeIntoLibrary(existing, rows, { username: 'handson.excel', pic: 'https://cdn/me.jpg' }, 1000);
  const p = out.DfhWg2QITjo;
  assert.equal(p.views, 240);       // counters never go backwards
  assert.equal(p.skipRate, 82.3);   // a rate is replaced by the newest reading
  assert.equal(p.duration, 14.2);   // web-only fields survive
  assert.deepEqual(p.audio, { title: 'Original' });
  assert.deepEqual([p.pk, p.graphId, p.reach, p.avgWatchMs, p.owner, p.source, p.seenAt], ['377', 'm1', 190, 3307, 'handson.excel', 'api', 1000]);
  assert.deepEqual(p.hashtags, ['excel', 'exceltips']);
  assert.equal(out.DfizlKEoJHh.views, null);
  assert.equal(out.DfizlKEoJHh.url, 'https://www.instagram.com/reel/DfizlKEoJHh/');
  assert.equal(out.Dabc12345.url, 'https://www.instagram.com/p/Dabc12345/');
  assert.deepEqual(out.other, { code: 'other', views: 7 });
  assert.equal(existing.DfhWg2QITjo.skipRate, 90); // input untouched
});

test('codeOf reads reel, post and username-prefixed links', () => {
  assert.equal(S.codeOf('https://www.instagram.com/reel/DfhWg2QITjo/'), 'DfhWg2QITjo');
  assert.equal(S.codeOf('https://www.instagram.com/handson.excel/p/Dabc12345/'), 'Dabc12345');
  assert.equal(S.codeOf('https://www.instagram.com/handson.excel/'), null);
  assert.equal(S.codeOf(undefined), null);
});

test('formatting', () => {
  assert.equal(S.seconds(3307), '3.3 s');
  assert.equal(S.seconds(684747), '11 min 25 s');
  assert.equal(S.seconds(null), '–');
  assert.equal(S.percent(82.3), '82%');
  assert.equal(S.percent(7.25), '7.3%');
  assert.equal(S.funnelText({ comments: 12, sends: 10, clicks: 1, delivered: 5 }), '12 comments → 10 DMs → 1 click → 5 delivered');
  assert.equal(S.funnelText({ comments: 0, sends: 0, clicks: 0, delivered: 0 }), 'No comments matched yet');
});

// ---- publishing ----------------------------------------------------------------------
const file = (name, type, size = 1000) => ({ name, type, size });
const NOW_MS = Date.parse('2026-11-10T12:00:00Z');

test('files: what can be published, what gets converted, what is refused', () => {
  assert.deepEqual(S.fileInfo(file('a.jpg', 'image/jpeg')), { type: 'image', convert: false });
  assert.deepEqual(S.fileInfo(file('a.png', 'image/png')), { type: 'image', convert: true });
  assert.deepEqual(S.fileInfo(file('a.webp', 'image/webp')), { type: 'image', convert: true });
  assert.deepEqual(S.fileInfo(file('a.mov', 'video/quicktime')), { type: 'video', convert: false });
  assert.match(S.fileInfo(file('clip.mp4', 'video/mp4', 120 * 1048576)).error, /clip\.mp4 is 120 MB; videos can be up to 95 MB/);
  assert.match(S.fileInfo(file('a.gif', 'image/gif')).error, /cannot be published/);
  assert.match(S.fileInfo(file('a.pdf', '')).error, /a\.pdf cannot be published/);
});

test('post draft: each type takes the files Instagram takes', () => {
  const d = (over) => Object.assign(S.defaultPostDraft(), over);
  const mp4 = file('v.mp4', 'video/mp4');
  const jpg = file('a.jpg', 'image/jpeg');
  const p = (over) => S.postProblem(d(over), NOW_MS);
  assert.match(p({}), /Choose the video/);
  assert.equal(p({ files: [mp4] }), null);
  assert.match(p({ files: [jpg] }), /exactly one video/);
  assert.match(p({ kind: 'post', files: [mp4] }), /published as a reel/);
  assert.equal(p({ kind: 'post', files: [jpg] }), null);
  assert.equal(p({ kind: 'post', files: [jpg, mp4, jpg] }), null);
  assert.match(p({ kind: 'post', files: Array(21).fill(jpg) }), /at most 20/);
  assert.match(p({ kind: 'story', files: [jpg, jpg] }), /one by one/);
  assert.equal(p({ kind: 'story', files: [mp4] }), null);
  assert.match(p({ files: [mp4], cover: mp4 }), /cover must be an image/);
  assert.match(p({ files: [mp4], caption: 'x'.repeat(2201) }), /2201 characters/);
  assert.equal(p({ kind: 'story', files: [jpg], caption: 'x'.repeat(5000) }), null); // stories have no caption
  assert.match(p({ files: [file('x.gif', 'image/gif')] }), /cannot be published/);
});

test('post draft: schedule time must be chosen and in the future', () => {
  const d = Object.assign(S.defaultPostDraft(), { files: [file('v.mp4', 'video/mp4')], when: 'later' });
  assert.match(S.postProblem(d, NOW_MS), /Choose the date and time/);
  assert.match(S.postProblem(Object.assign({}, d, { at: S.localInputValue(NOW_MS / 1000 - 3600) }), NOW_MS), /has passed/);
  assert.equal(S.postProblem(Object.assign({}, d, { at: S.localInputValue(NOW_MS / 1000 + 3600) }), NOW_MS), null);
});

test('post payload: now is 0, a schedule is the local time as unix seconds, options follow the type', () => {
  const at = S.localInputValue(NOW_MS / 1000 + 7200);
  const d = Object.assign(S.defaultPostDraft(), { caption: ' Spot the bug ', campaign_id: 'bug-2', share_to_feed: false });
  assert.deepEqual(S.postPayload(d, ['k1'], 'cover1'), {
    kind: 'reel', caption: 'Spot the bug', media: [{ key: 'k1' }], scheduled_at: 0,
    options: { share_to_feed: false, cover_key: 'cover1', campaign_id: 'bug-2' }
  });
  const later = S.postPayload(Object.assign({}, d, { id: 'p9', kind: 'post', when: 'later', at }), ['k1', 'k2'], '');
  assert.equal(later.scheduled_at, NOW_MS / 1000 + 7200);
  assert.equal(later.id, 'p9');
  assert.deepEqual(later.options, { campaign_id: 'bug-2' });
  assert.deepEqual(S.postPayload(Object.assign({}, d, { kind: 'story' }), ['k1'], 'cover1'), { kind: 'story', caption: '', media: [{ key: 'k1' }], options: {}, scheduled_at: 0 });
});

test('a TikTok draft is one video sent with platform "tiktok", and edits round-trip', () => {
  const d = Object.assign(S.defaultPostDraft(), { kind: 'tiktok', caption: ' Hook ', campaign_id: 'ignored', media: [{ key: 'v1', type: 'video' }] });
  assert.equal(S.postProblem(d, NOW_MS), null);
  assert.deepEqual(S.postPayload(d, ['v1'], 'cover1'), {
    platform: 'tiktok', kind: 'reel', caption: 'Hook', media: [{ key: 'v1' }], options: { tiktok_mode: 'inbox' }, scheduled_at: 0
  });
  assert.equal(S.postProblem(Object.assign({}, d, { media: [{ key: 'i1', type: 'image' }] }), NOW_MS), 'A TikTok post is exactly one video.');
  const stored = { id: 't1', platform: 'tiktok', kind: 'reel', caption: 'Hook', media: [{ key: 'v1', type: 'video' }], options: { tiktok_mode: 'inbox' }, scheduled_at: NOW_MS / 1000 + 600 };
  assert.equal(S.postDraftFromPost(stored, NOW_MS).kind, 'tiktok');
  assert.equal(S.postLabel(stored), 'TikTok');
});

test('editing a queued post keeps its stored files until new ones are chosen', () => {
  const post = { id: 'p1', kind: 'post', caption: 'Slides', media: [{ key: 'k1', type: 'image', url: 'u' }, { key: 'k2', type: 'video', url: 'u' }], options: { campaign_id: 'c' }, scheduled_at: NOW_MS / 1000 + 600 };
  const d = S.postDraftFromPost(post, NOW_MS);
  assert.deepEqual([d.id, d.kind, d.when, d.at, d.campaign_id], ['p1', 'post', 'later', S.localInputValue(post.scheduled_at), 'c']);
  assert.deepEqual(S.postItems(d), [{ type: 'image', key: 'k1' }, { type: 'video', key: 'k2' }]);
  assert.equal(S.postProblem(d, NOW_MS), null);
  d.files = [file('new.jpg', 'image/jpeg')];
  assert.deepEqual(S.postItems(d).map((i) => i.file.name), ['new.jpg']);
  // a post whose time passed (failed, or about to go out) is offered as "now"
  assert.equal(S.postDraftFromPost(Object.assign({}, post, { scheduled_at: NOW_MS / 1000 - 60 }), NOW_MS).when, 'now');
});

test('labels and image sizing', () => {
  assert.equal(S.postLabel({ kind: 'reel', media: [{}] }), 'Reel');
  assert.equal(S.postLabel({ kind: 'post', media: [{}] }), 'Photo');
  assert.equal(S.postLabel({ kind: 'post', media: [{}, {}, {}] }), 'Carousel (3)');
  assert.equal(S.postLabel({ kind: 'story', media: [{}] }), 'Story');
  assert.deepEqual(S.fitWithin(4000, 3000, 2160), { width: 2160, height: 1620 });
  assert.deepEqual(S.fitWithin(800, 600, 2160), { width: 800, height: 600 });
});
