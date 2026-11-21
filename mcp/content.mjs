// OpenOutlier – phase 4's content tools on the bridge (docs/youtube-niche-plan.md 4, 6.3).
//
//   comments   The extension sends the comments it saw in a watch page's /next responses
//              (POST /youtube/comments, `comment-tools` on). They are kept per video for
//              COMMENT_TTL (7 days), then deleted: comment text isn't kept longer than the
//              analysis needs. get_comments answers from them, or else (with the bridge's Data
//              API key) from commentThreads.list: 100 comments = 1 unit, counted in the shared
//              quota and refused when the tracker's daily budget is spent.
//   sponsors   src/sponsors.js over the tracked channels' descriptions (tracked_videos.description
//              from videos.list, plus descriptions saved in the Library): who promotes what, how
//              often (sponsor_mentions, the Niş Takibi list, the channel page card).
import { createRequire } from 'node:module';
import { apiKey as bridgeApiKey, spendOn, quotaOf } from './youtube-api.mjs';

const require = createRequire(import.meta.url);
const CT = require('../src/content-tools.js');
const SP = require('../src/sponsors.js');
const A = require('../src/youtube-api.js');
const Features = require('../src/features.js');

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const COMMENT_TTL = 7 * DAY;
export const MAX_PER_VIDEO = 2000;
export const BUDGET = 9000; // the tracker's daily budget (mcp/tracker.mjs), extension's units included
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const COMMENT_ID_RE = /^[A-Za-z0-9_.-]{6,100}$/;

// Tables: video_comments, comment_sets (mcp/store.mjs, migration 4).

const flagsOf = (store) => Features.resolve(store.getMeta('features', null));
const str = (v, n) => (v == null ? null : String(v).slice(0, n));
const int = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : null);

// ---- comments -------------------------------------------------------------------------------

/** Delete comment text older than the TTL (and its video's row). → rows removed */
export function purgeComments(store, now = Date.now(), ttl = COMMENT_TTL) {
  const n = Number(store.db.prepare('DELETE FROM video_comments WHERE fetched_at < ?').run(now - ttl).changes);
  store.db.prepare('DELETE FROM comment_sets WHERE fetched_at < ? AND video_id NOT IN (SELECT DISTINCT video_id FROM video_comments)').run(now - ttl);
  return n;
}

/** Comments the extension (or the Data API) read. → { ok, stored, total } */
export function putComments(store, { video, title, channel_id: channelId, total, comments, source = 'page', now = Date.now() } = {}) {
  if (!VIDEO_ID_RE.test(String(video || ''))) return { ok: false, error: 'Give a YouTube video id.' };
  const list = (Array.isArray(comments) ? comments : []).filter((c) => c && COMMENT_ID_RE.test(String(c.id || '')) && typeof c.text === 'string' && c.text.trim()).slice(0, MAX_PER_VIDEO);
  purgeComments(store, now);
  const base = Number(store.db.prepare('SELECT COUNT(*) AS n FROM video_comments WHERE video_id = ?').get(video).n) || 0;
  const up = store.db.prepare(`INSERT INTO video_comments (video_id, comment_id, author, author_id, text, likes, replies, published, is_reply, parent_id, pinned, hearted, by_creator, pos, source, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(video_id, comment_id) DO UPDATE SET text = excluded.text, likes = excluded.likes, replies = excluded.replies, author = COALESCE(excluded.author, author),
      published = COALESCE(excluded.published, published), pinned = excluded.pinned, hearted = excluded.hearted, source = excluded.source, fetched_at = excluded.fetched_at`);
  store.db.exec('BEGIN');
  try {
    list.forEach((c, i) => up.run(video, c.id, str(c.author, 120), CHANNEL_ID_RE.test(String(c.authorId || '')) ? c.authorId : null, String(c.text).slice(0, 5000), int(c.likes) ?? 0, int(c.replies) ?? 0,
      str(c.published, 40), c.reply ? 1 : 0, c.parent ? str(c.parent, 100) : null, c.pinned ? 1 : 0, c.hearted ? 1 : 0, c.creator ? 1 : 0, base + i, source === 'api' ? 'api' : 'page', now));
    store.db.prepare(`INSERT INTO comment_sets (video_id, title, channel_id, total, source, fetched_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(video_id) DO UPDATE SET title = COALESCE(excluded.title, title), channel_id = COALESCE(excluded.channel_id, channel_id), total = COALESCE(excluded.total, total),
        source = excluded.source, fetched_at = excluded.fetched_at`).run(video, str(title, 300), CHANNEL_ID_RE.test(String(channelId || '')) ? channelId : null, int(total), source === 'api' ? 'api' : 'page', now);
    store.db.exec('COMMIT');
  } catch (e) { store.db.exec('ROLLBACK'); throw e; }
  return { ok: true, stored: Number(store.db.prepare('SELECT COUNT(*) AS n FROM video_comments WHERE video_id = ?').get(video).n), total: int(total) };
}

/** What is stored for a video: { video, title, channel_id, total, source, fetched_at, comments } | null. */
export function storedComments(store, video, now = Date.now()) {
  purgeComments(store, now);
  const set = store.db.prepare('SELECT * FROM comment_sets WHERE video_id = ?').get(video);
  const rows = store.db.prepare('SELECT * FROM video_comments WHERE video_id = ? ORDER BY pos, rowid').all(video);
  if (!rows.length) return null;
  return {
    video, title: set ? set.title : null, channel_id: set ? set.channel_id : null, total: set ? set.total : null,
    source: [...new Set(rows.map((r) => r.source))].join('+'), fetched_at: Math.max(...rows.map((r) => r.fetched_at)),
    comments: rows.map((r) => ({ id: r.comment_id, author: r.author, authorId: r.author_id, text: r.text, likes: r.likes || 0, replies: r.replies || 0, published: r.published,
      reply: !!r.is_reply, parent: r.parent_id, pinned: !!r.pinned, hearted: !!r.hearted, creator: !!r.by_creator }))
  };
}

/** commentThreads.list item → the extension's comment shape. */
export function apiComment(it) {
  const top = it && it.snippet && it.snippet.topLevelComment;
  const s = top && top.snippet;
  if (!s || !top.id) return null;
  return {
    id: top.id, author: s.authorDisplayName || null, authorId: s.authorChannelId && s.authorChannelId.value || null,
    text: CT.clean(s.textOriginal != null ? s.textOriginal : s.textDisplay), likes: s.likeCount || 0, replies: it.snippet.totalReplyCount || 0,
    published: s.publishedAt || null, reply: false, parent: null, pinned: false, hearted: false, creator: !!(s.authorChannelId && it.snippet.channelId && s.authorChannelId.value === it.snippet.channelId)
  };
}

/** commentThreads.list pages until `max` comments (100 per call = 1 unit). → { comments, units, error? } */
export async function fetchComments({ video, max = 200, order = 'relevance', key, fetch: doFetch = globalThis.fetch, onUnits = () => {}, canSpend = () => true }) {
  const c = A.client({ key, fetch: doFetch, onUnits });
  const out = [];
  let token = null;
  let units = 0;
  let videoChannel = null;
  do {
    if (!canSpend(1)) return { comments: out, units, error: { code: 'budget', message: 'The day\'s Data API budget is spent; the rest waits for midnight Pacific time.' } };
    let body;
    try {
      body = await c.get('commentThreads', { part: 'snippet', videoId: video, maxResults: 100, order: order === 'time' ? 'time' : 'relevance', textFormat: 'plainText', pageToken: token });
    } catch (e) {
      units++;
      if (/commentsDisabled/i.test(String(e.message)) || e.code === 'failed' && /disabled comments/i.test(String(e.message))) return { comments: out, units, error: { code: 'disabled', message: 'Comments are turned off for this video.' } };
      return { comments: out, units, error: { code: e.code || 'failed', message: e.message, hint: e.hint || undefined } };
    }
    units++;
    for (const it of body.items || []) {
      const cm = apiComment(it);
      if (cm) out.push(cm);
      if (!videoChannel && it.snippet) videoChannel = it.snippet.channelId || null;
    }
    token = body.nextPageToken || null;
  } while (token && out.length < max);
  return { comments: out.slice(0, max), units, channel_id: videoChannel };
}

/**
 * get_comments. Captured comments first; else (or with refresh) commentThreads.list with the bridge's key.
 * opts: { video, max, refresh, order, questions, phrase, hide_profanity, sort, replies, fetch, key, now }
 */
export async function getComments(store, opts = {}) {
  const now = opts.now || Date.now();
  const m = /(?:v=|shorts\/|youtu\.be\/|^)([A-Za-z0-9_-]{11})(?:[?&#/]|$)/.exec(String(opts.video || '').trim());
  const video = m ? m[1] : null;
  if (!video) return { ok: false, error: 'Give a YouTube video id or URL.' };
  const max = Math.min(1000, Math.max(1, Number(opts.max) || 200));
  let stored = storedComments(store, video, now);
  let source = stored ? 'captured' : null;
  let note;
  let fetched = null;
  const key = opts.key !== undefined ? opts.key : bridgeApiKey();
  // Captured ones answer unless more are wanted (or a refresh is asked for) and a key can fetch them.
  const wantApi = !stored || opts.refresh === true || (stored.comments.length < max && (stored.total == null || stored.comments.length < stored.total));
  if (wantApi && key) {
    const before = quotaOf(store, now).used_today;
    fetched = await fetchComments({ video, max, order: opts.order, key, fetch: opts.fetch, onUnits: (n) => spendOn(store, n, now), canSpend: (n) => quotaOf(store, now).used_today + n <= BUDGET });
    if (fetched.comments.length) {
      putComments(store, { video, channel_id: fetched.channel_id, comments: fetched.comments, source: 'api', now });
      stored = storedComments(store, video, now);
      source = stored.source.indexOf('page') !== -1 ? 'captured+api' : 'api';
    }
    if (fetched.error && !stored) return { ok: false, video, error: fetched.error.code, message: fetched.error.message, hint: fetched.error.hint, quota_before: before };
    if (fetched.error) note = fetched.error.message;
  } else if (!stored) {
    return { ok: false, video, error: 'no_comments', message: 'No comments captured for this video yet and the bridge has no YouTube Data API key.',
      hint: 'Open the video in Chrome with OpenOutlier\'s Comment tools on and scroll to the comments (they are sent to this computer and kept 7 days), or copy a Data API key to the bridge (popup → Copy key to bridge): commentThreads.list costs 1 unit per 100 comments.' };
  } else if (wantApi) note = 'Only the comments captured from the page; copy a Data API key to the bridge for more.';
  const all = stored.comments;
  const filtered = CT.filterComments(all, { questions: !!opts.questions, phrase: opts.phrase || '', hideProfanity: !!opts.hide_profanity, sort: opts.sort === 'likes' || opts.sort === 'replies' ? opts.sort : 'top', replies: opts.replies === false ? false : undefined });
  const items = filtered.items.slice(0, max);
  return {
    ok: true, video, url: 'https://www.youtube.com/watch?v=' + video, title: stored.title, channel_id: stored.channel_id, source, total_on_youtube: stored.total,
    stored: all.length, matched: filtered.items.length, returned: items.length, hidden_profane: filtered.hiddenProfane || undefined,
    questions: all.filter((c) => CT.isQuestion(c.text)).length, fetched_at: new Date(stored.fetched_at).toISOString(), kept_until: new Date(stored.fetched_at + COMMENT_TTL).toISOString(),
    units_spent: fetched ? fetched.units : 0, note,
    comments: items.map((c) => ({ id: c.id, author: c.author, text: c.text, likes: c.likes, replies: c.replies, published: c.published, is_reply: c.reply || undefined,
      pinned: c.pinned || undefined, hearted: c.hearted || undefined, by_creator: c.creator || undefined, is_question: CT.isQuestion(c.text) || undefined }))
  };
}

// ---- sponsors -----------------------------------------------------------------------------------

/** Descriptions to scan: tracked videos (videos.list) plus Library posts of the same channels. */
function descriptions(store, { niche, channel, days, now }) {
  const chans = store.db.prepare('SELECT channel_id, account_id, name, handle, niche FROM tracked_channels WHERE active = 1').all()
    .filter((c) => (channel ? c.channel_id === channel : niche == null || niche === '*' || (c.niche || '') === niche));
  const since = days ? now - days * DAY : 0;
  const lib = store.readLibrary();
  const byId = new Map();
  const add = (v) => {
    if (!v.description || (v.published_at && v.published_at < since)) return;
    const prev = byId.get(v.id);
    if (!prev || String(v.description).length > String(prev.description).length) byId.set(v.id, { ...prev, ...v });
  };
  for (const c of chans) {
    const name = c.name || c.handle || c.channel_id;
    for (const r of store.db.prepare('SELECT video_id, title, published_at, description FROM tracked_videos WHERE channel_id = ? AND description IS NOT NULL').all(c.channel_id)) {
      add({ id: r.video_id, channel_id: c.channel_id, channel: name, title: r.title, published_at: r.published_at, description: r.description });
    }
    const acct = c.account_id && lib.accounts[c.account_id];
    for (const p of Object.values((acct && acct.posts) || {})) {
      if (p && p.description) add({ id: p.code, channel_id: c.channel_id, channel: name, title: p.caption || null, published_at: p.takenAt || null, description: p.description });
    }
  }
  return { videos: [...byId.values()], channels: chans };
}

/**
 * sponsor_mentions: { scope, scanned, channels_scanned, brands: [...], channels: [...], short_links, rules }.
 * Give channel (UC…) for one channel, else a niche ('*' = every tracked channel).
 */
export function sponsorMentions(store, { niche, channel, days = 365, limit = 50, now = Date.now() } = {}) {
  if (channel && !CHANNEL_ID_RE.test(String(channel))) return { error: 'Give a channel id (UC…).' };
  const { videos, channels } = descriptions(store, { niche: niche === undefined ? '*' : niche, channel, days, now });
  const agg = SP.aggregate(videos);
  return {
    scope: channel ? { channel } : { niche: niche === undefined || niche === '*' ? 'all tracked channels' : niche }, days,
    scanned: agg.scanned, channels_scanned: channels.length, short_links: agg.short_links,
    brands: agg.brands.slice(0, limit).map((b) => ({ ...b, first_at: b.first_at ? new Date(b.first_at).toISOString().slice(0, 10) : null, last_at: b.last_at ? new Date(b.last_at).toISOString().slice(0, 10) : null })),
    channels: agg.channels,
    rules: 'Rule-based (src/sponsors.js): "sponsored by / thanks to X for sponsoring / in partnership with" (and Turkish forms), "use code ABC", "% off / % indirim", Amazon tag= and amzn.to, affiliate networks, ref= / aff= links, utm_* links, known sponsor domains. Short links (bit.ly …) are counted, not followed.'
  };
}

/** The channel page card: what one channel promotes (tracked channels, or a saved channel's Library descriptions). */
export function channelSponsors(store, { channel, now = Date.now() } = {}) {
  if (!CHANNEL_ID_RE.test(String(channel || ''))) return { error: 'Give a channel id (UC…).' };
  const tracked = store.db.prepare('SELECT channel_id FROM tracked_channels WHERE channel_id = ? AND active = 1').get(channel);
  let res;
  if (tracked) res = sponsorMentions(store, { channel, days: 365, limit: 8, now });
  else {
    // Not tracked: whatever the Library has saved for it.
    const lib = store.readLibrary();
    const videos = [];
    for (const [acct, rec] of Object.entries(lib.accounts || {})) {
      if (!/^yt\//.test(acct)) continue;
      const uc = rec.profile && rec.profile.channelId;
      for (const p of Object.values(rec.posts || {})) {
        if ((p.ownerId || uc) !== channel || !p.description) continue;
        videos.push({ id: p.code, channel_id: channel, channel: p.ownerName || acct, title: p.caption, published_at: p.takenAt, description: p.description });
      }
    }
    const agg = SP.aggregate(videos);
    res = { scope: { channel }, scanned: agg.scanned, brands: agg.brands.slice(0, 8), channels: agg.channels };
  }
  return { tracked: !!tracked, scanned: res.scanned, brands: res.brands.map((b) => ({ brand: b.brand, key: b.key, videos: b.videos, kinds: b.kinds, codes: b.codes, last_at: b.last_at, example: b.examples[0] || null })),
    disclosure: (res.channels[0] || {}).disclosure || 0 };
}

// ---- MCP tools -------------------------------------------------------------------------------------
export const INSTRUCTIONS = 'Content tools (YouTube): get_comments returns a video\'s comments (captured from the watch page by the extension and kept 7 days, else commentThreads.list with the bridge\'s Data API key, 1 unit per 100) with local filters (questions, phrase, profanity) — do the sentiment and idea analysis yourself; sponsor_mentions lists who the tracked channels promote (sponsors, codes, affiliate links) from their descriptions; get_transcript gives captions for summaries and hooks.';

export function registerContentTools(server, { z, json, safe, store }) {
  server.registerTool('get_comments', {
    title: 'YouTube comments of a video',
    description: 'A YouTube video\'s comments with likes, reply counts and flags (pinned, hearted by the creator, by the creator, is a question). Source: the comments the OpenOutlier extension captured on the watch page (kept 7 days), else commentThreads.list with the bridge\'s Data API key (100 comments = 1 quota unit; refresh: true asks the API even when captured ones exist). Local filters: questions (TR + EN question detection), phrase (case- and accent-insensitive, comma = any), hide_profanity (TR + EN word lists), sort by likes or replies. Analyse sentiment, likes / dislikes, questions to answer and video ideas yourself.',
    inputSchema: {
      video: z.string().describe('YouTube video id or URL (watch, Shorts or youtu.be)'),
      max: z.number().int().min(1).max(1000).optional().describe('At most this many comments (default 200)'),
      refresh: z.boolean().optional().describe('Fetch from the Data API even when captured comments exist'),
      order: z.enum(['relevance', 'time']).optional().describe('Data API order (default relevance)'),
      questions: z.boolean().optional().describe('Only questions'),
      phrase: z.string().optional().describe('Only comments containing this phrase (comma-separated = any)'),
      hide_profanity: z.boolean().optional(),
      sort: z.enum(['top', 'likes', 'replies']).optional().describe('top = YouTube\'s order'),
      replies: z.boolean().optional().describe('false = leave out replies')
    },
    annotations: { readOnlyHint: true }
  }, (args) => safe(async () => json(await getComments(store(), args))));
  server.registerTool('sponsor_mentions', {
    title: 'Sponsors and affiliate links in tracked channels',
    description: 'Who promotes what, how often: a rule-based scan of tracked YouTube channels\' video descriptions (Data API descriptions and the ones saved in the Library) for sponsor phrases ("sponsored by", "thanks to … for sponsoring", Turkish forms), discount codes, "% off", Amazon / affiliate-network / ref= links, utm-tagged links and known sponsor domains. Brands are ranked by how many channels and videos mention them, with codes, first / last seen and example lines; per channel, which brands it promotes and how many descriptions disclose affiliate links.',
    inputSchema: {
      niche: z.string().optional().describe('Tracked niche (folder or #tag); default every tracked channel'),
      channel: z.string().optional().describe('One channel id (UC…)'),
      days: z.number().int().min(7).max(3650).optional().describe('Only videos from the last N days (default 365)'),
      limit: z.number().int().min(1).max(200).optional()
    },
    annotations: { readOnlyHint: true }
  }, (args) => safe(() => {
    const r = sponsorMentions(store(), args);
    if (r.error) return json({ ok: false, error: r.error });
    if (!flagsOf(store())['channel-sponsors']) r.note = 'The "Sponsor scan" feature is off in OpenOutlier\'s Features tab; the scan still works here.';
    return json(r);
  }));
}
