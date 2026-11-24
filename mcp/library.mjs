// OpenOutlier MCP – the on-disk copy of the library and the queries agents run on it.
// The extension pushes its data here (see bridge.mjs); every MCP server
// instance (Claude Desktop, Claude Code, …) reads the same files.
import { resolveHome, dbFile } from './env.mjs';
import { createRequire } from 'node:module';
import { promises as fs, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore } from './store.mjs';

const require = createRequire(import.meta.url);
export const M = require('../src/metrics.js');
export const MN = require('../src/mentions.js');
export const T = require('../src/tiktok.js');
export const C = require('../src/compare.js');
export const Y = require('../src/youtube.js');
export const XP = require('../src/x.js');

export const HOME = resolveHome();
export const COMMANDS_DIR = join(HOME, 'commands');
export const STATUS_FILE = join(HOME, 'status.json');

export async function ensureHome() {
  await fs.mkdir(COMMANDS_DIR, { recursive: true });
}

let tmpSeq = 0;
async function writeJsonAtomic(file, value) {
  // A unique temp name per write: concurrent requests in one process must not rename each other's file.
  const tmp = `${file}.${process.pid}.${++tmpSeq}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value));
  await fs.rename(tmp, file);
}

// ---- library (SQLite, see store.mjs) ------------------------------------------

export const DB_FILE = dbFile(HOME);
export function store() { return openStore(HOME); }

export function emptyLibrary() {
  return { syncId: randomUUID(), syncedAt: null, accounts: {}, org: { folders: [], accounts: {} }, watches: [], mentions: { items: {}, read: {} } };
}

/** Read the library (cached until the database changes). */
export function readLibrary() {
  try {
    return store().readLibrary();
  } catch (e) {
    console.error('[openoutlier] could not read the library:', e.message);
    return emptyLibrary();
  }
}

/**
 * Apply a sync from the extension.
 * full: the extension's whole library — adds and updates only, never deletes.
 * Otherwise `accounts` maps id → record, or null to delete that account.
 */
export async function applySync({ full, accounts, org, watches, mentions }) {
  await ensureHome();
  store().applySync({ full: !!full, accounts, org, watches, mentions });
  return readLibrary();
}

/** Dated history of a post's counts. */
export function postHistory(code) { return store().history(code); }

export async function writeStatus(patch) {
  let cur = {};
  try { cur = JSON.parse(await fs.readFile(STATUS_FILE, 'utf8')); } catch { /* new */ }
  await ensureHome();
  await writeJsonAtomic(STATUS_FILE, { ...cur, ...patch });
}

export function readStatus() {
  try { return JSON.parse(readFileSync(STATUS_FILE, 'utf8')); } catch { return {}; }
}

// ---- commands (agent → extension) -------------------------------------------

export async function queueCommand(type, args) {
  await ensureHome();
  const cmd = { id: randomUUID(), type, args, createdAt: Date.now() };
  await writeJsonAtomic(join(COMMANDS_DIR, cmd.id + '.json'), cmd);
  return cmd;
}

const COMMAND_TTL = 20 * 60 * 1000;

/** Commands the extension hasn't picked up yet. Marks them as taken. */
export async function takePendingCommands() {
  await ensureHome();
  const files = await fs.readdir(COMMANDS_DIR);
  const out = [];
  for (const f of files) {
    if (!/^[\w-]+\.json$/.test(f) || f.includes('.result') || f.includes('.taken')) continue;
    const id = f.slice(0, -5);
    const path = join(COMMANDS_DIR, f);
    let cmd;
    try { cmd = JSON.parse(await fs.readFile(path, 'utf8')); } catch { continue; }
    if (Date.now() - cmd.createdAt > COMMAND_TTL) { await fs.rm(path, { force: true }); continue; }
    if (existsSync(join(COMMANDS_DIR, id + '.taken.json')) || existsSync(join(COMMANDS_DIR, id + '.result.json'))) continue;
    await writeJsonAtomic(join(COMMANDS_DIR, id + '.taken.json'), { takenAt: Date.now() });
    out.push(cmd);
  }
  return out;
}

export async function saveCommandResult(id, result) {
  if (!/^[\w-]+$/.test(id)) throw new Error('bad id');
  await writeJsonAtomic(join(COMMANDS_DIR, id + '.result.json'), { ...result, finishedAt: Date.now() });
}

export async function readCommandState(id) {
  const res = join(COMMANDS_DIR, id + '.result.json');
  if (existsSync(res)) return { state: 'done', result: JSON.parse(await fs.readFile(res, 'utf8')) };
  if (existsSync(join(COMMANDS_DIR, id + '.taken.json'))) return { state: 'running' };
  if (existsSync(join(COMMANDS_DIR, id + '.json'))) return { state: 'waiting for the extension' };
  return { state: 'unknown' };
}

export async function waitForCommand(id, seconds) {
  const until = Date.now() + seconds * 1000;
  let st = await readCommandState(id);
  while (st.state !== 'done' && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1500));
    st = await readCommandState(id);
  }
  return st;
}

// ---- queries ----------------------------------------------------------------

// Reels (Instagram), videos (TikTok, YouTube long-form), YouTube Shorts and past live streams,
// and X video posts (originals only: a reply or repost is not the author's own video).
const isXPost = (p) => p.platform === 'x';
const isVideo = (p) => (isXPost(p) ? p.type === 'video' && M.xKind(p) === 'original'
  : p.type === 'reel' || p.type === 'video' || (p.platform === 'youtube' && (p.type === 'short' || p.type === 'live')));
const isYouTubePost = (p) => p.platform === 'youtube';
const isRedditPost = (p) => p.platform === 'reddit';
/** X posts that are ranked: originals (replies, thread parts and reposts are not the author's own posts). */
const isXOriginal = (p) => isXPost(p) && M.xKind(p) === 'original';

/**
 * Reddit accounts are stored as "r/<sub>" and "u/<user>", TikTok as "tt/<user>", YouTube as
 * "yt/<handle>" (or "yt/UC…" for a channel without a handle), X as "x/<handle>"; Instagram usernames never contain "/".
 */
export function isRedditId(id) { return /^(r|u)\/[a-z0-9_-]{2,30}$/.test(String(id || '')); }
export const isTikTokId = (id) => T.isTikTokId(id);
export const isYouTubeId = (id) => Y.isYouTubeId(id);
export const isXId = (id) => XP.isXId(id);
export function platformOf(lib, id) {
  if (lib.accounts[id]?.platform === 'reddit' || isRedditId(id)) return 'reddit';
  if (lib.accounts[id]?.platform === 'tiktok' || isTikTokId(id)) return 'tiktok';
  if (lib.accounts[id]?.platform === 'youtube' || isYouTubeId(id)) return 'youtube';
  if (lib.accounts[id]?.platform === 'x' || isXId(id)) return 'x';
  return 'instagram';
}
export function labelOf(id) {
  if (isRedditId(id)) return id;
  if (isTikTokId(id)) return '@' + id.slice(3) + ' (TikTok)';
  if (isYouTubeId(id)) return Y.label(id) + ' (YouTube)';
  if (isXId(id)) return XP.label(id) + ' (X)';
  return '@' + id;
}

export function folderOf(lib, u) {
  const f = lib.org.accounts?.[u]?.folder;
  return f ? lib.org.folders.find((x) => x.id === f) || null : null;
}
export function tagsOf(lib, u) { return lib.org.accounts?.[u]?.tags || []; }

function folderByName(lib, name) {
  const n = String(name).toLowerCase();
  return lib.org.folders.find((f) => f.name.toLowerCase() === n || f.id === name) || null;
}

/**
 * Normalize an account reference: "@Name" → "name"; "r/Excel", "/r/excel", "reddit.com/r/excel/top" → "r/excel";
 * "u/Name", "/user/name" → "u/name"; "tt/name" / tiktok.com/@name → TikTok; "yt/name", "youtube:@name",
 * youtube.com/@Name or /channel/UC… → "yt/name" (channel ids keep their case); "x/Name", "x:@name",
 * x.com/Name or twitter.com/Name (also a status URL) → "x/name". A bare "@name" stays Instagram.
 */
export function normUser(u) {
  const s = String(u || '').trim();
  // YouTube: "yt/name", "yt/UC…", "youtube:@name", "youtube.com/@name/videos", "youtube.com/channel/UC…"
  const yt = s.match(/^(?:yt\/|youtube:\s*)@?([^\s/?#]{1,40})$/i) ||
    s.match(/^(?:https?:\/\/)?(?:(?:www|m)\.)?youtube\.com\/(?:@([^\s/?#]{1,40})|channel\/(UC[A-Za-z0-9_-]{22}))/i);
  if (yt) {
    const id = Y.ytId(yt[1] || yt[2]);
    if (isYouTubeId(id)) return id;
  }
  // TikTok: "tt/name", "tiktok:@name", "tiktok.com/@name", "https://www.tiktok.com/@name/video/…"
  const t = s.match(/^(?:tt\/|tiktok:\s*@?)([A-Za-z0-9._]{1,30})$/i) || s.match(/^(?:https?:\/\/)?(?:(?:www|m)\.)?tiktok\.com\/@([A-Za-z0-9._]{1,30})/i);
  if (t) return 'tt/' + t[1].toLowerCase();
  // X: "x/name", "x:@name", "x.com/name", "twitter.com/name/status/…"
  if (/^(?:x\/|x:)|^(?:https?:\/\/)?(?:(?:www|mobile)\.)?(?:x|twitter)\.com\//i.test(s)) {
    const x = XP.normHandle(s);
    if (x) return x;
  }
  const m = s.match(/^(?:https?:\/\/)?(?:(?:www|old|new)\.)?(?:reddit\.com)?\/?(r|u|user)\/([A-Za-z0-9_-]{2,30})/i);
  if (m) return (m[1].toLowerCase() === 'r' ? 'r/' : 'u/') + m[2].toLowerCase();
  const ig = s.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,30})/i);
  if (ig) return ig[1].toLowerCase();
  return s.replace(/^@/, '').toLowerCase();
}

/** A subreddit reference: "excel", "r/excel" or a URL → "r/excel"; "u/name" stays a user. */
export function normSubreddit(name) {
  const n = normUser(name);
  return isRedditId(n) ? n : 'r/' + n.replace(/^@/, '');
}

/** Usernames matching a folder / tag / explicit list. Throws on unknown folder. */
/**
 * Accounts with fewer saved posts are usually ones the extension only brushed
 * past while you scrolled your feed (1–2 reels). They're hidden unless asked
 * for by name, folder or tag, or with includeSmall.
 */
export const MIN_POSTS = 5;

export function postCount(lib, u) { return Object.keys(lib.accounts[u]?.posts || {}).length; }

export function selectAccounts(lib, { folder, tag, usernames, includeSmall = false, platform } = {}) {
  let list = Object.keys(lib.accounts);
  // platform: 'instagram' | 'tiktok' | 'youtube' | 'reddit' | 'x' | 'video' (everything but Reddit) | 'all'
  if (platform === 'video') list = list.filter((u) => platformOf(lib, u) !== 'reddit');
  else if (platform && platform !== 'all') list = list.filter((u) => platformOf(lib, u) === platform);
  const explicit = (usernames && usernames.length) || folder || tag;
  if (!explicit && !includeSmall) list = list.filter((u) => postCount(lib, u) >= MIN_POSTS);
  if (usernames && usernames.length) {
    const want = new Set(usernames.map(normUser));
    list = list.filter((u) => want.has(u));
  }
  if (folder) {
    const f = folderByName(lib, folder);
    if (!f) throw new Error(`No folder named "${folder}". Folders: ${lib.org.folders.map((x) => x.name).join(', ') || 'none'}`);
    list = list.filter((u) => folderOf(lib, u)?.id === f.id);
  }
  if (tag) {
    const t = String(tag).replace(/^#/, '').toLowerCase();
    list = list.filter((u) => tagsOf(lib, u).includes(t));
  }
  return list;
}

/** Posts of one account, scored against that account's own median. */
export function enrichedPosts(lib, u) {
  return M.enrich(Object.values(lib.accounts[u]?.posts || {}));
}

/** When a CDN link stops working: Instagram's "oe" (hex seconds), TikTok's "x-expires" / "expire" (seconds). */
export function linkExpiry(url) {
  try {
    const oe = new URL(url).searchParams.get('oe');
    if (oe) return parseInt(oe, 16) * 1000;
  } catch { return null; }
  return T.linkExpiry(url);
}

const round = (n, d = 2) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);
const iso = (t) => (t ? new Date(t).toISOString() : null);

/** Compact Reddit post record for agents. */
export function redditBrief(p, { full = false } = {}) {
  return {
    id: p.code,
    platform: 'reddit',
    url: p.url,
    account: p.owner,
    subreddit: p.subreddit ? 'r/' + p.subreddit : null,
    author: p.author ? 'u/' + p.author : null,
    title: p.title,
    type: p.type,
    flair: p.flair || undefined,
    posted_at: iso(p.takenAt),
    score: p.score ?? null,
    comments: p.comments ?? null,
    upvote_ratio: p.upvoteRatio ?? undefined,
    x_account_median: round(p.ratio),
    viral_score: p.viralScore ?? null,
    question: M.isQuestion(p.title) || undefined,
    selftext: full ? (p.selftext || undefined) : ((p.selftext || '').replace(/\s+/g, ' ').slice(0, 220) || undefined),
    link_url: full ? (p.linkUrl || undefined) : undefined,
    last_seen_at: full ? iso(p.seenAt) : undefined
  };
}

const fmtClock = (s) => {
  if (s == null) return null;
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), sec = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};
/** "exact" (publish time known), "day" (calendar day only) or "approximate" ("3 weeks ago" on a channel tab). */
const dateKind = (p) => (!p.takenAt ? null : p.dateApprox === false ? 'exact' : p.dateDay ? 'day' : 'approximate');
/** YouTube format as agents see it: short | video | live. */
const ytFormat = (p) => (p.type === 'short' || p.type === 'live' ? p.type : 'video');

/**
 * Compact YouTube record. Views and dates from channel tabs are YouTube's rounded /
 * relative ones until the video is opened (watch page) or downloaded (yt-dlp).
 */
export function youtubeBrief(p, { full = false } = {}) {
  const format = ytFormat(p);
  const out = {
    code: p.code,
    platform: 'youtube',
    url: p.url || Y.videoUrl(p.code, p.type),
    account: p.owner,
    channel: p.ownerName || undefined,
    format,
    title: p.caption || null,
    posted_at: iso(p.takenAt),
    date: dateKind(p) || undefined,
    views: p.views ?? null,
    views_exact: p.views == null ? undefined : !p.viewsApprox,
    likes: p.likes ?? null,
    comments: p.comments ?? null,
    duration_s: p.duration ?? null,
    engagement_pct: round(p.engagement),
    // Shorts are scored against the channel's Shorts median, videos and live streams against its long-form median.
    x_account_median: round(p.ratio),
    median_group: format === 'short' ? 'shorts' : 'long_form',
    viral_score: p.viralScore ?? null,
    category: p.category || undefined,
    tags: p.keywords?.length ? (full ? p.keywords : p.keywords.slice(0, 12)) : undefined,
    hashtags: p.hashtags?.length ? p.hashtags : undefined,
    chapters: p.chapters?.length ? (full ? p.chapters.map((c) => ({ start_s: c.start, at: fmtClock(c.start), title: c.title })) : p.chapters.length) : undefined,
    most_replayed_at: p.heatmapPeaks?.length ? p.heatmapPeaks.map(fmtClock) : undefined,
    captions: p.hasCaptions == null ? undefined : p.hasCaptions ? (p.autoCaptions ? 'auto-generated' : 'yes') : 'none',
    transcript: p.hasTranscript == null ? undefined : p.hasTranscript ? 'available (get_transcript)' : 'none',
    members_only: p.membersOnly || undefined,
    live_now: p.liveNow || undefined,
    unlisted: p.unlisted || undefined,
    description: full ? (p.description || undefined) : undefined
  };
  if (full) {
    out.most_replayed_at_s = p.heatmapPeaks?.length ? p.heatmapPeaks : undefined;
    out.heatmap = p.heatmap?.length ? { step_s: p.heatmapStep ?? null, values: p.heatmap, note: 'YouTube\'s "most replayed" graph: 100 values 0–1 across the video, 1 = the most re-watched moment.' } : undefined;
    out.cover_url = p.thumb || Y.coverUrls(p.code)[0] || null;
    out.channel_id = p.ownerId || undefined;
    out.download_note = 'download_reel saves this video with yt-dlp on this computer and fills in exact views, likes, comments, upload time, tags, chapters and the heatmap.';
    out.last_seen_at = iso(p.seenAt);
    if (p.viewsApprox || p.dateApprox !== false) {
      out.exact_stats_hint = 'Views' + (p.viewsApprox ? ' are rounded' : ' are exact') + ' and the date is ' + (dateKind(p) || 'unknown') + '. refresh_reel opens the watch page (exact views, likes, comments, date, chapters, heatmap); download_reel does the same through yt-dlp.';
    }
  }
  return out;
}

/** "3.2×" or "≈3.2×" (approximate: the author's overall median stood in for a thin format). */
const xTimes = (p) => (p.ratio == null ? null : (p.baselineApprox ? '≈' : '') + round(p.ratio, 1) + '×');

/**
 * Compact X post record. views are X's own view count (null on posts before 2023, when X showed
 * none); x_account_median compares them with the author's median for that format (median_approx:
 * the format had too few posts, so the author's overall originals median stood in).
 */
export function xBrief(p, { full = false } = {}) {
  const kind = M.xKind(p);
  const out = {
    code: p.code,
    platform: 'x',
    url: p.url,
    account: p.owner,
    author: p.author ? '@' + p.author : undefined,
    kind,
    format: p.type || 'text',
    posted_at: iso(p.takenAt),
    views: p.views ?? null,
    no_views: p.views == null || undefined,
    likes: p.likes ?? null,
    replies: p.comments ?? null,
    reposts: p.shares ?? null,
    quotes: p.quotes ?? null,
    bookmarks: p.saves ?? null,
    engagement_pct: round(p.engagement),
    x_account_median: round(p.ratio),
    x_median_text: xTimes(p) || undefined,
    median_approx: p.ratio != null && p.baselineApprox ? true : undefined,
    scored_against: kind === 'repost' ? 'not scored (a repost has no views of its own)'
      : p.baselineScope === 'format' ? `this author's ${p.type || 'text'} median` : p.baselineScope === 'all' ? 'this author\'s overall originals median' : 'not enough data (fewer than 8 originals with views)',
    viral_score: p.viralScore ?? null,
    duration_s: p.duration ?? undefined,
    thread_length: p.threadLength || undefined,
    thread_of: p.threadOf && p.threadOf !== p.code ? p.threadOf : undefined,
    reply_to: p.replyToId || undefined,
    quoted: p.quotedId || undefined,
    repost_of: p.repostOf || undefined,
    article: p.article?.title || undefined,
    has_link: p.hasLink || undefined,
    hashtags: p.hashtags?.length ? p.hashtags : undefined,
    ai_generated: p.aiGenerated || undefined,
    edited: p.edit?.edited || undefined,
    pinned: p.pinned || undefined,
    promoted: p.promoted || undefined,
    text: full ? (p.caption || null) : (p.caption || '').replace(/\s+/g, ' ').slice(0, 220) || undefined
  };
  if (full) {
    out.name = p.ownerName || undefined;
    out.author_followers = p.ownerFollowers ?? undefined;
    out.author_verified = p.ownerVerified ?? undefined;
    out.links = p.links?.length ? p.links : undefined;
    out.media = p.media?.length ? p.media.map((m) => ({ kind: m.kind, url: m.url || null, thumb: m.thumb || undefined, duration_s: m.duration ?? undefined })) : undefined;
    out.cover_url = p.thumb || null;
    out.article = p.article || undefined;
    out.views_note = p.views == null ? 'X shows no view count on posts from before 2023 (or when the author hid it), so this post has no score.' : 'X views = how often the post was shown (X\'s own count). They are not the monetized impressions of X\'s creator revenue sharing.';
    out.last_seen_at = iso(p.seenAt);
  }
  return out;
}

/** Compact reel record for agents (Reddit posts get redditBrief, YouTube videos youtubeBrief, X posts xBrief). */
export function brief(p, { full = false } = {}) {
  if (isRedditPost(p)) return redditBrief(p, { full });
  if (isYouTubePost(p)) return youtubeBrief(p, { full });
  if (isXPost(p)) return xBrief(p, { full });
  const tt = p.platform === 'tiktok';
  const byLikes = M.isLikesScored(p);
  const out = {
    code: p.code,
    platform: tt ? 'tiktok' : 'instagram',
    url: p.url,
    account: p.owner,
    type: p.type,
    posted_at: iso(p.takenAt),
    views: p.views ?? null,
    likes: p.likes ?? null,
    comments: p.comments ?? null,
    shares: p.shares ?? null,
    // Instagram shows saves, reach and watch time only to the owner: present on the user's own
    // posts, which My account copies in from the official API (source "api").
    saves: tt || p.saves != null ? (p.saves ?? null) : undefined,
    reach: p.reach ?? undefined,
    avg_watch_s: p.avgWatchMs != null ? Math.round(p.avgWatchMs / 100) / 10 : undefined,
    skip_rate_pct: p.skipRate ?? undefined,
    duration_s: p.duration ?? null,
    // Carousels and photos have no views: their "engagement" is comments_per_100_likes below.
    engagement_pct: byLikes ? null : round(p.engagement),
    x_account_median: round(p.ratio),
    viral_score: p.viralScore ?? null,
    scored_by: byLikes ? 'likes' : undefined,
    slides: p.type === 'carousel' ? (p.slides || (p.files || []).length || undefined) : undefined,
    comments_x_account_median: round(p.commentRatio) ?? undefined,
    comments_per_100_likes: round(p.commentsPer100Likes, 1) ?? undefined,
    comment_keyword: p.commentKeyword || undefined,
    likes_hidden: p.likesHidden || undefined,
    collab_with: p.collabs?.length ? p.collabs : undefined,
    tagged: p.tagged?.length ? p.tagged : undefined,
    location: p.location || undefined,
    title: p.title || undefined,
    pinned: p.pinned || undefined,
    audio: p.audio ? (p.audio.kind === 'music' ? `music: ${p.audio.title}${p.audio.artist ? ' – ' + p.audio.artist : ''}` : tt ? `original sound: ${p.audio.title}` : 'original audio') : null,
    hashtags: p.hashtags?.length ? p.hashtags : undefined,
    caption: full ? p.caption : (p.caption || '').replace(/\s+/g, ' ').slice(0, 220) || undefined
  };
  if (full) {
    const video = (p.files || []).find((f) => f.kind === 'video');
    const exp = video ? linkExpiry(video.url) : null;
    out.files = (p.files || []).map((f) => ({ kind: f.kind, url: f.url, expires_at: iso(linkExpiry(f.url)) }));
    out.video_url = video?.url || null;
    out.cover_url = p.thumb || null;
    out.link_expires_at = iso(exp);
    out.link_expired = exp ? exp < Date.now() : null;
    out.saves = p.saves ?? null;
    if (!tt) {
      out.slide_videos = p.slideVideos ?? undefined;
      out.size = p.width && p.height ? `${p.width}x${p.height}` : undefined;
      out.sponsors = p.sponsors?.length ? p.sponsors : undefined;
      out.comments_off = p.commentsOff || undefined;
    }
    if (tt) out.download_note = 'TikTok video links need the browser session: download_reel tries directly, then asks the extension to fetch it in a tiktok.com tab.';
    out.last_seen_at = iso(p.seenAt);
  }
  return out;
}

export function accountRow(lib, u) {
  if (platformOf(lib, u) === 'reddit') {
    const posts = enrichedPosts(lib, u);
    return {
      username: u,
      platform: 'reddit',
      kind: u.startsWith('u/') ? 'user' : 'subreddit',
      folder: folderOf(lib, u)?.name || null,
      tags: tagsOf(lib, u),
      posts_saved: posts.length,
      median_score: M.median(posts.filter((p) => p.score > 0).map((p) => p.score)),
      median_comments: M.median(posts.map((p) => p.comments)),
      outliers: posts.filter((p) => p.outlier).length,
      updated_at: iso(lib.accounts[u]?.updatedAt)
    };
  }
  const posts = enrichedPosts(lib, u);
  const vids = posts.filter(isVideo);
  const igPosts = posts.filter(M.isLikesScored);
  const withViews = vids.filter((p) => p.views > 0);
  const name = posts.find((p) => p.ownerName)?.ownerName || null;
  if (platformOf(lib, u) === 'youtube') return youtubeAccountRow(lib, u, posts, name);
  if (platformOf(lib, u) === 'x') return xAccountRow(lib, u, posts);
  if (platformOf(lib, u) === 'tiktok') {
    const prof = lib.accounts[u]?.profile || {};
    const rate = (k) => round(M.mean(withViews.filter((p) => p[k] != null).map((p) => p[k] / p.views * 100)));
    return {
      username: u,
      platform: 'tiktok',
      handle: '@' + u.slice(3),
      name: prof.nickname || name,
      followers: prof.followers ?? undefined,
      videos_on_profile: prof.videos ?? undefined,
      folder: folderOf(lib, u)?.name || null,
      tags: tagsOf(lib, u),
      posts_saved: posts.length,
      videos: vids.length,
      median_views: M.median(withViews.map((p) => p.views)),
      median_engagement_pct: round(M.median(vids.map((p) => p.engagement))),
      shares_per_100_views: rate('shares'),
      saves_per_100_views: rate('saves'),
      outliers: vids.filter((p) => p.outlier).length,
      updated_at: iso(lib.accounts[u]?.updatedAt)
    };
  }
  return {
    username: u,
    platform: 'instagram',
    name,
    folder: folderOf(lib, u)?.name || null,
    tags: tagsOf(lib, u),
    followers: lib.accounts[u]?.profile?.followers ?? undefined,
    posts_on_profile: lib.accounts[u]?.profile?.posts ?? undefined,
    posts_saved: posts.length,
    reels: vids.length,
    median_views: M.baselineOf(vids) ?? M.median(withViews.map((p) => p.views)),
    outliers: vids.filter((p) => p.outlier).length,
    // Carousels and photos have no public views: counted in likes, against their own median.
    carousels_and_photos: igPosts.length || undefined,
    median_likes_carousels_photos: igPosts.length ? (M.baselineOf(igPosts) ?? M.median(igPosts.map((p) => (p.likes > 0 ? p.likes : null)))) : undefined,
    outliers_carousels_photos: igPosts.length ? igPosts.filter((p) => p.outlier).length : undefined,
    updated_at: iso(lib.accounts[u]?.updatedAt)
  };
}

/** YouTube channel: Shorts and long-form (videos + past live streams) have separate medians. */
function youtubeAccountRow(lib, u, posts, name) {
  const prof = lib.accounts[u]?.profile || {};
  const shorts = posts.filter((p) => p.type === 'short');
  const long = posts.filter((p) => p.type !== 'short');
  const med = (list) => M.median(list.filter((p) => p.views > 0).map((p) => p.views));
  return {
    username: u,
    platform: 'youtube',
    handle: prof.handle ? '@' + prof.handle : (/^yt\/UC/.test(u) ? undefined : '@' + u.slice(3)),
    channel_id: prof.channelId || posts.find((p) => p.ownerId)?.ownerId || undefined,
    name: prof.name || name,
    subscribers: prof.subscribers ?? undefined,
    videos_on_channel: prof.videos ?? undefined,
    verified: prof.verified || undefined,
    folder: folderOf(lib, u)?.name || null,
    tags: tagsOf(lib, u),
    posts_saved: posts.length,
    long_form: long.length,
    shorts: shorts.length,
    live: posts.filter((p) => p.type === 'live').length || undefined,
    median_views_long_form: med(long),
    median_views_shorts: med(shorts),
    outliers: posts.filter((p) => p.outlier).length,
    exact_views: posts.filter((p) => p.views != null && !p.viewsApprox).length,
    exact_dates: posts.filter((p) => p.dateApprox === false).length,
    updated_at: iso(lib.accounts[u]?.updatedAt)
  };
}

// ---- X ----------------------------------------------------------------------------

const X_FORMATS = ['text', 'image', 'video', 'thread', 'article', 'link', 'quote'];

/** The account's X baseline (src/metrics.js xBaselines): its own key, else the biggest one (a renamed handle). */
function xBaselineOf(posts, u) {
  const all = M.xBaselines(posts);
  return all[u] || Object.values(all).sort((a, b) => b.n - a.n)[0] || null;
}

/**
 * Per-format medians of an X account's originals: a format with fewer than 8 originals with views
 * uses the author's overall originals median instead (approximate, shown as ≈).
 */
function xFormatTable(originals, b) {
  const seen = X_FORMATS.filter((f) => originals.some((p) => (p.type || 'text') === f));
  return seen.map((f) => {
    const own = b?.byFormat?.[f];
    const mine = originals.filter((p) => (p.type || 'text') === f);
    const exact = own && own.med;
    return {
      format: f,
      originals: mine.length,
      in_median: own ? own.n : 0,
      median_views: exact ? own.med : (b?.all ?? null),
      approximate: !exact && b?.all != null ? true : undefined,
      median_text: exact ? String(own.med) : b?.all != null ? '≈' + b.all : 'not enough data',
      outliers: mine.filter((p) => p.outlier).length
    };
  });
}

const xKindCounts = (posts) => {
  const c = { original: 0, reply: 0, 'thread-part': 0, repost: 0 };
  posts.forEach((p) => { c[M.xKind(p)] = (c[M.xKind(p)] || 0) + 1; });
  return c;
};

function xAccountRow(lib, u, posts) {
  const prof = lib.accounts[u]?.profile || {};
  const b = xBaselineOf(posts, u);
  const originals = posts.filter(isXOriginal);
  const c = xKindCounts(posts);
  const table = xFormatTable(originals, b);
  const byFormat = {};
  table.filter((f) => !f.approximate && f.median_views != null).forEach((f) => { byFormat[f.format] = f.median_views; });
  const approx = table.filter((f) => f.approximate).map((f) => f.format);
  const any = (k) => posts.find((p) => p[k] != null)?.[k];
  return {
    username: u,
    platform: 'x',
    handle: '@' + (prof.handle || any('author') || u.slice(2)),
    name: prof.name || any('ownerName') || null,
    followers: prof.followers ?? any('ownerFollowers') ?? undefined,
    following: prof.following ?? undefined,
    posts_on_profile: prof.posts ?? undefined,
    verified: prof.blueVerified || prof.verified || any('ownerVerified') || undefined,
    folder: folderOf(lib, u)?.name || null,
    tags: tagsOf(lib, u),
    posts_saved: posts.length,
    originals: c.original,
    replies: c.reply || undefined,
    thread_parts: c['thread-part'] || undefined,
    reposts: c.repost || undefined,
    without_views: posts.filter((p) => p.views == null && M.xKind(p) !== 'repost').length || undefined,
    median_views: b?.all ?? null,
    median_views_by_format: Object.keys(byFormat).length ? byFormat : undefined,
    formats_on_overall_median: approx.length ? approx : undefined,
    outliers: originals.filter((p) => p.outlier).length,
    updated_at: iso(lib.accounts[u]?.updatedAt)
  };
}

const X_HOW_SCORED = 'Each original post is scored by views ÷ this author\'s median views for that format (text, image, video, thread, article, link, quote), over the originals of the last 90 days or the last 50, whichever is more. A format with fewer than 8 such posts uses the author\'s overall originals median instead: those scores are approximate (median_approx, shown as ≈). With fewer than 8 originals with views there is no score. Replies and thread parts are scored against the overall originals median but left out of every median; reposts are never scored. Pinned, promoted and less-than-a-day-old posts are scored but stay out of the median.';
const X_VIEWS_NOTE = 'X views are X\'s own count of how often a post was shown. They are not the monetized impressions X pays creators for (revenue sharing counts only engagement from verified Premium users, which nobody but X sees). Posts from before 2023 have no view count at all.';

/** X account analytics: originals vs replies/reposts, per-format medians (≈ where approximate), top originals. */
function xSummary(lib, u) {
  const posts = enrichedPosts(lib, u);
  const originals = posts.filter(isXOriginal);
  const b = xBaselineOf(posts, u);
  const c = xKindCounts(posts);
  const noViews = posts.filter((p) => p.views == null && M.xKind(p) !== 'repost');
  const base = {
    account: accountRow(lib, u),
    how_scored: X_HOW_SCORED,
    views_note: X_VIEWS_NOTE,
    kinds: { originals: c.original, replies: c.reply, thread_parts: c['thread-part'], reposts: c.repost },
    formats: xFormatTable(originals, b),
    posts_without_views: { count: noViews.length, originals: noViews.filter(isXOriginal).length, note: noViews.length ? 'No view count (posts before 2023, or hidden): they have no score and stay out of the medians.' : undefined }
  };
  if (!originals.length) return { ...base, note: 'No original posts saved yet. collect_profile with ' + u + ' scrolls the profile.' };
  const a = M.analyze(originals, { all: posts });
  const x = a.x || {};
  const stat = (g) => ({ posts: g.count, median_views: g.medianViews, x_account_median: round(g.lift) });
  return {
    ...base,
    summary: {
      originals_analyzed: originals.length,
      scored: originals.filter((p) => p.ratio != null).length,
      scored_approximately: originals.filter((p) => p.ratio != null && p.baselineApprox).length,
      median_views: b?.all ?? null,
      avg_views: round(a.summary.avgViews, 0),
      total_views: a.summary.totalViews,
      avg_engagement_pct: round(a.summary.avgEngagement),
      engagement_note: 'X engagement = (likes + replies + reposts + quotes + bookmarks) ÷ views.',
      outliers: a.summary.outliers,
      posts_per_week: round(a.summary.postsPerWeek, 1),
      first_post: iso(a.summary.firstPost),
      last_post: iso(a.summary.lastPost)
    },
    ...postingTimes(a.heatmap, 'views'),
    timezone_note: 'Times use the computer\'s local time zone: ' + Intl.DateTimeFormat().resolvedOptions().timeZone + '. X post times are exact (from the post id).',
    text_length: (x.lengths || []).map((g) => ({ bucket: g.key, ...stat(g) })),
    links: (x.links || []).map((g) => ({ group: g.key, ...stat(g) })),
    top_hashtags: a.hashtags.slice(0, 15).map((h) => ({ hashtag: '#' + h.key, posts: h.count, median_views: h.medianViews, x_account_median: round(h.lift) })),
    top_posts: M.sortBy(originals, 'viralScore').slice(0, 10).map((p) => xBrief(p))
  };
}

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const hourRange = (block, size) => `${String(block * size).padStart(2, '0')}:00–${String((block + 1) * size % 24).padStart(2, '0')}:00`;

/** One slot / day / hour group as the MCP tools report it. `unit` is views or score. */
const slotRow = (unit) => (c) => ({
  posts: c.count,
  share_of_posts_pct: round(c.share * 100, 1),
  x_account_median: round(c.lift),
  raw_x_account_median: round(c.rawLift),
  [`median_${unit}`]: c.medianViews,
  confidence: c.confidence
});

/**
 * Best posting times. Slots are ranked by lift (era-adjusted, shrunk toward 1×),
 * not raw median views, and only slots with enough posts are ranked.
 */
function postingTimes(hm, unit) {
  const row = slotRow(unit);
  const slots = hm.cells.flat().filter((c) => c.count >= hm.minPosts)
    .sort((x, y) => y.lift - x.lift).slice(0, 5)
    .map((c) => ({ day: DAY[c.day], hours_local: hourRange(c.block, hm.blockHours), ...row(c) }));
  const byLift = (x, y) => (y.count >= hm.minPosts) - (x.count >= hm.minPosts) || y.lift - x.lift;
  const notes = [
    `x_account_median here = each post's ${unit} ÷ the median of the ~30 posts around it in time (so account growth doesn't skew old vs. new slots), averaged per slot (geometric mean) and scaled so the account's average post = 1×, then pulled toward 1× when a slot has few posts. raw_x_account_median is the same without that pull. Only slots with ${hm.minPosts}+ posts are ranked.`
  ];
  if (!hm.postsWithTime) notes.push('No posts with a posting time yet.');
  else if (hm.varietyIssue === 'concentrated') {
    notes.push(`Not enough variety to compare times: the two busiest slots hold ${Math.round(hm.topTwoShare * 100)}% of ${hm.postsWithTime} dated posts. This shows when the account posts, not that other times would do worse.`);
  } else if (hm.varietyIssue === 'thin') {
    notes.push(`Too few posts per slot to compare times: ${hm.postsWithTime} dated posts, ${hm.rankedSlots} day × time slot(s) and ${hm.rankedHours} time block(s) with ${hm.minPosts}+ posts. Collect more posts before trusting these.`);
  }
  return {
    posts_with_time: hm.postsWithTime,
    best_posting_slots: slots,
    best_days: hm.days.slice().sort(byLift).map((c) => ({ day: DAY[c.day], ...row(c) })),
    best_hours: hm.hours.slice().sort(byLift).map((c) => ({ hours_local: hourRange(c.block, hm.blockHours), ...row(c) })),
    enough_variety_to_compare: !hm.concentrated,
    timing_note: notes.join(' ')
  };
}

const groupRow = (label) => (g) => ({ [label]: g.key, posts: g.count, median_score: g.medianViews, x_median: round(g.lift) });

/** Analytics for one subreddit or Reddit user. */
export function subredditSummary(lib, id) {
  if (!lib.accounts[id]) {
    throw new Error(`${id} is not in the library. Use collect_subreddit to collect it (or open it on reddit.com with the extension).`);
  }
  const posts = enrichedPosts(lib, id);
  const a = M.analyze(posts);
  const r = a.reddit || { questions: [], titleLength: [], words: [], phrases: [], flairs: [], types: [] };
  return {
    account: accountRow(lib, id),
    summary: {
      posts_analyzed: a.summary.count,
      median_score: a.summary.medianViews,
      avg_score: round(a.summary.avgViews, 0),
      median_comments: a.summary.medianComments,
      avg_upvote_ratio: round(a.summary.avgUpvoteRatio),
      outliers: a.summary.outliers,
      posts_per_week_in_sample: round(a.summary.postsPerWeek, 1),
      first_post: iso(a.summary.firstPost),
      last_post: iso(a.summary.lastPost)
    },
    ...postingTimes(a.heatmap, 'score'),
    timezone_note: 'Times use the computer\'s local time zone: ' + Intl.DateTimeFormat().resolvedOptions().timeZone + '. Collected "top" posts only show what won; collect "new" too for a fairer time picture.',
    question_vs_statement: r.questions.map(groupRow('title')),
    title_length: r.titleLength.map(groupRow('words')),
    words_that_perform: r.words.map(groupRow('word')),
    phrases_that_perform: r.phrases.map(groupRow('phrase')),
    flairs: r.flairs.map(groupRow('flair')),
    post_types: r.types.map(groupRow('type')),
    top_posts: M.sortBy(posts, 'score').slice(0, 10).map((p) => redditBrief(p))
  };
}

const REDDIT_SORT = { score: 'score', viral_score: 'viralScore', comments: 'comments', upvote_ratio: 'upvoteRatio', date: 'date', discussion: 'engagement' };

const X_POST_SORT = { viral_score: 'viral_score', score: 'views', views: 'views', comments: 'comments', discussion: 'engagement', date: 'date', likes: 'likes', shares: 'shares', saves: 'saves', engagement: 'engagement', upvote_ratio: 'viral_score' };

/**
 * Rank Reddit posts across subreddits / users (each scored against its own account's median).
 * platform 'x': rank X originals across X accounts instead (accounts: x/name list; post_type: an X format; score = views).
 */
export function topPosts(lib, { platform = 'reddit', accounts: xAccounts, folder, tag, subreddits, sort = 'viral_score', since_days, limit = 20, min_score = 0, flair, post_type, questions_only = false, include_small_accounts = false } = {}) {
  if (platform === 'x') {
    if (post_type && !X_FORMATS.includes(post_type)) throw new Error(`post_type for X is one of ${X_FORMATS.join(', ')}.`);
    const r = topReels(lib, { folder, tag, usernames: xAccounts?.length ? xAccounts : undefined, sort: X_POST_SORT[sort] || 'viral_score', since_days, limit, min_views: min_score, include_small_accounts, platform: 'x', post_type: 'all', x_format: post_type });
    return { platform: 'x', accounts: r.accounts, hidden_small_accounts: r.hidden_small_accounts, matched: r.matched, scoring_note: X_RANK_NOTE + ' score / min_score mean views here.', posts: r.reels };
  }
  const usernames = subreddits?.length ? subreddits.map(normSubreddit) : undefined;
  const accounts = selectAccounts(lib, { folder, tag, usernames, includeSmall: include_small_accounts, platform: 'reddit' });
  const since = since_days ? Date.now() - since_days * 864e5 : null;
  const fl = flair ? String(flair).toLowerCase() : null;
  let posts = accounts.flatMap((u) => enrichedPosts(lib, u));
  posts = posts.filter((p) => (p.score || 0) >= min_score && (!since || (p.takenAt && p.takenAt >= since)) &&
    (!fl || String(p.flair || '').toLowerCase() === fl) && (!post_type || p.type === post_type) && (!questions_only || M.isQuestion(p.title)));
  const hidden = include_small_accounts ? 0 : selectAccounts(lib, { folder, tag, usernames, includeSmall: true, platform: 'reddit' }).length - accounts.length;
  return { accounts: accounts.length, hidden_small_accounts: hidden || undefined, matched: posts.length, posts: M.sortBy(posts, REDDIT_SORT[sort] || 'viralScore').slice(0, limit).map((p) => redditBrief(p)) };
}

/**
 * Questions and pain points that did well in a set of subreddits, grouped
 * into themes, with how much of each theme Instagram accounts in the same
 * scope already cover.
 */
export function contentIdeas(lib, { folder, tag, subreddits, since_days = 365, limit = 20, min_score = 0, include_small_accounts = false } = {}) {
  const usernames = subreddits?.length ? subreddits.map(normSubreddit) : undefined;
  const reddit = selectAccounts(lib, { folder, tag, usernames, includeSmall: include_small_accounts, platform: 'reddit' });
  if (!reddit.length) {
    throw new Error('No subreddits in this scope. Collect some first (collect_subreddit), and put them in a folder next to your Instagram competitors.');
  }
  const since = since_days ? Date.now() - since_days * 864e5 : null;
  const posts = reddit.flatMap((u) => enrichedPosts(lib, u))
    .filter((p) => (p.score || 0) >= min_score && (!since || (p.takenAt && p.takenAt >= since)));
  const res = M.contentIdeas(posts, { limit, themes: 12 });

  // Instagram reels in the same folder/tag (competitors) that already touch each theme.
  const ig = (folder || tag) ? selectAccounts(lib, { folder, tag, platform: 'instagram' }) : [];
  const reels = ig.flatMap((u) => enrichedPosts(lib, u)).filter(isVideo);
  const covered = (word) => {
    const hits = reels.filter((p) => ((p.caption || '') + ' ' + (p.hashtags || []).join(' ')).toLowerCase().includes(word));
    if (!hits.length) return { reels: 0 };
    const best = M.sortBy(hits, 'viralScore')[0];
    return { reels: hits.length, median_viral_score: M.median(hits.map((p) => p.viralScore)), best: { code: best.code, account: best.owner, url: best.url, views: best.views, viral_score: best.viralScore } };
  };

  return {
    subreddits: reddit,
    instagram_accounts_compared: ig.length || undefined,
    posts_considered: posts.length,
    matched_questions_and_pain_points: res.matched,
    how_ranked: 'Each post is scored against its own subreddit\'s median score (x_account_median), weighted by comment count. Questions = titles with "?" / how / why / is there… or a help flair (solved, unsolved, Waiting on OP); pain points = error / stuck / not working / #N/A … in the title.',
    themes: res.themes.map((t) => ({
      theme: t.key,
      posts: t.count,
      median_x_subreddit_median: round(t.medianRatio),
      median_score: t.medianScore,
      examples: t.posts.map((p) => ({ title: p.title, url: p.url, score: p.score, comments: p.comments })),
      ...(ig.length ? { on_instagram: covered(t.key) } : {})
    })),
    ideas: res.ideas.map((p) => ({ ...redditBrief(p), kind: p.needKind }))
  };
}

const termRow = (label) => (g) => ({ [label]: g.key, posts: g.count, median_views: g.medianViews, x_median: round(g.lift) });

/** One YouTube format (Shorts or long-form) of a channel, analyzed on its own median. */
function youtubeFormatSummary(posts, all, label) {
  if (!posts.length) return { videos_analyzed: 0, note: `No ${label} saved yet. collect_profile collects the channel's Videos and Shorts tabs.` };
  const a = M.analyze(posts, { all });
  const y = a.youtube;
  const times = postingTimes(a.heatmap, 'views');
  return {
    videos_analyzed: a.summary.count,
    median_views: a.summary.medianViews,
    avg_views: round(a.summary.avgViews, 0),
    total_views: a.summary.totalViews,
    avg_engagement_pct: round(a.summary.avgEngagement),
    engagement_note: a.summary.avgEngagement == null ? 'Likes and comments only load when a video is opened (refresh_reel) or downloaded (download_reel).' : '(likes + comments) ÷ views, over the videos whose likes/comments are known.',
    outliers: a.summary.outliers,
    posts_per_week: round(a.summary.postsPerWeek, 1),
    first_post: iso(a.summary.firstPost),
    last_post: iso(a.summary.lastPost),
    views_rounded: y.approxViews,
    dates: { exact: y.exactDates, approximate: y.approxDates, unknown: y.noDates },
    ...times,
    timing_note: `Best time uses exact publish dates only (${y.exactDates} of ${posts.length}); channel tabs give rounded views and "3 weeks ago" dates. ` + times.timing_note,
    video_length: a.durations.map((d) => ({ bucket: d.key, posts: d.count, median_views: d.medianViews, x_account_median: round(d.lift) })),
    title_words: y.words.map(termRow('word')),
    title_phrases: y.phrases.map(termRow('phrase')),
    top_hashtags: a.hashtags.slice(0, 15).map((h) => ({ hashtag: '#' + h.key, posts: h.count, median_views: h.medianViews, x_account_median: round(h.lift) })),
    top_videos: M.sortBy(posts, 'views').slice(0, 10).map((p) => youtubeBrief(p))
  };
}

/** YouTube channel analytics: Shorts and long-form separately (Shorts get far more views). */
function youtubeSummary(lib, u) {
  const posts = enrichedPosts(lib, u);
  const shorts = posts.filter((p) => p.type === 'short');
  const long = posts.filter((p) => p.type !== 'short');
  const formats = M.analyze(posts, { all: posts }).youtube.formats;
  return {
    account: accountRow(lib, u),
    how_scored: 'Each Short is compared with the median of this channel\'s Shorts and each long-form video (including past live streams) with the median of its long-form videos, so Shorts don\'t make every video look like an outlier.',
    formats: formats.map((g) => ({ format: g.key, videos: g.count, median_views: g.medianViews, avg_views: round(g.avgViews, 0) })),
    long_form: youtubeFormatSummary(long, posts, 'long-form videos'),
    shorts: youtubeFormatSummary(shorts, posts, 'Shorts'),
    timezone_note: 'Times use the computer\'s local time zone: ' + Intl.DateTimeFormat().resolvedOptions().timeZone,
    view_count_note: 'YouTube changed how it counts views for Shorts in March 2025 (every start or replay counts) and for all formats in August 2026, so newer videos can look stronger than older ones. Best-time slots are era-adjusted (each video vs. the ~30 around it in time).'
  };
}

export function accountSummary(lib, u) {
  if (platformOf(lib, u) === 'reddit') return subredditSummary(lib, u);
  if (!lib.accounts[u]) throw new Error(`${labelOf(u)} is not in the library. Use collect_profile ${isTikTokId(u) || isYouTubeId(u) || isXId(u) ? 'with ' + u + ' ' : ''}to collect it.`);
  if (platformOf(lib, u) === 'youtube') return youtubeSummary(lib, u);
  if (platformOf(lib, u) === 'x') return xSummary(lib, u);
  const tt = platformOf(lib, u) === 'tiktok';
  const posts = enrichedPosts(lib, u);
  const reels = posts.filter(isVideo);
  const a = M.analyze(reels);
  return {
    account: accountRow(lib, u),
    summary: {
      ...(tt ? { videos_analyzed: a.summary.count, shares_per_100_views: round(a.summary.avgShareRate), saves_per_100_views: round(a.summary.avgSaveRate),
        engagement_note: 'TikTok engagement = (likes + comments + shares + saves) ÷ views; Instagram only counts likes + comments.' } : { reels_analyzed: a.summary.count }),
      median_views: a.summary.medianViews,
      avg_views: round(a.summary.avgViews, 0),
      total_views: a.summary.totalViews,
      avg_engagement_pct: round(a.summary.avgEngagement),
      outliers: a.summary.outliers,
      posts_per_week: round(a.summary.postsPerWeek, 1),
      first_post: iso(a.summary.firstPost),
      last_post: iso(a.summary.lastPost)
    },
    ...postingTimes(a.heatmap, 'views'),
    timezone_note: 'Times use the computer\'s local time zone: ' + Intl.DateTimeFormat().resolvedOptions().timeZone,
    top_hashtags: a.hashtags.slice(0, 15).map((h) => ({ hashtag: '#' + h.key, posts: h.count, median_views: h.medianViews, x_account_median: round(h.lift) })),
    video_length: a.durations.map((d) => ({ bucket: d.key, posts: d.count, median_views: d.medianViews, x_account_median: round(d.lift) })),
    audio: a.audio.kinds.map((k) => ({ kind: tt ? (k.key === 'Licensed music' ? 'Music' : 'Original sound') : k.key, posts: k.count, median_views: k.medianViews })),
    top_music: tt ? a.audio.topTracks.map((t) => ({ track: t.key, posts: t.count, median_views: t.medianViews })) : undefined,
    top_reels: M.sortBy(reels, 'views').slice(0, 10).map((p) => brief(p)),
    ...(tt ? {} : {
      reel_comments: commentSection(a, 'views'),
      carousels_and_photos: carouselSummary(posts.filter(M.isLikesScored))
    })
  };
}

const commentRow = (unit) => (g) => ({
  group: g.key, posts: g.count, median_comments: g.medianComments, total_comments: g.totalComments,
  comments_per_100_likes: round(g.medianCommentsPer100Likes, 1), ['median_' + unit]: g.medianViews
});

/** Comment stats of one Instagram format: the median, "comment KEYWORD" posts vs the rest, each keyword, the most commented posts. */
function commentSection(a, unit) {
  const ig = a.instagram;
  if (!ig) return undefined;
  return {
    median_comments: a.summary.medianComments,
    total_comments: a.summary.totalComments,
    median_comments_per_100_likes: round(a.summary.medianCommentsPer100Likes, 1),
    keyword_posts: a.summary.keywordPosts,
    keyword_note: 'comment_keyword = the caption asks people to comment a word to get something ("Comment CFO and I\'ll send the link"). Those comments come from the giveaway, so read comments_x_account_median on such posts as reach of the offer, not as discussion.',
    keyword_vs_rest: ig.cta.length ? ig.cta.map(commentRow(unit)) : undefined,
    keywords: ig.keywords.length ? ig.keywords.map((g) => ({ keyword: g.key, posts: g.count, median_comments: g.medianComments, total_comments: g.totalComments, ['median_' + unit]: g.medianViews })) : undefined,
    caption_length: ig.captions.map((g) => ({ bucket: g.key, posts: g.count, ['median_' + unit]: g.medianViews, median_comments: g.medianComments })),
    collab_vs_solo: ig.collabs.length ? ig.collabs.map(commentRow(unit)) : undefined,
    most_commented: ig.topComments.slice(0, 5).map((p) => brief(p))
  };
}

/** Instagram carousels and photos: no public view count, so everything here is in likes, against their own median. */
function carouselSummary(posts) {
  if (!posts.length) return { posts_analyzed: 0, note: 'No carousels or photos saved yet. collect_profile pages the whole feed (reels, carousels and photos).' };
  const a = M.analyze(posts);
  const ig = a.instagram;
  const scored = posts.some((p) => p.ratio != null);
  return {
    how_scored: `Instagram shows views on carousels and photos only to their owner, so each one is scored by likes ÷ this account's median likes on carousels and photos. Pinned posts and posts under 3 days old are scored but left out of the median. Needs ${M.MIN_BASELINE} posts with likes.` + (scored ? '' : ' Not enough yet: no scores.'),
    posts_analyzed: a.summary.count,
    formats: ig.types.map((g) => ({ format: g.key, posts: g.count, median_likes: g.medianViews, median_comments: g.medianComments })),
    median_likes: a.summary.medianViews,
    avg_likes: round(a.summary.avgViews, 0),
    total_likes: a.summary.totalViews,
    outliers: a.summary.outliers,
    posts_per_week: round(a.summary.postsPerWeek, 1),
    first_post: iso(a.summary.firstPost),
    last_post: iso(a.summary.lastPost),
    ...postingTimes(a.heatmap, 'likes'),
    carousel_length: ig.slides.map((g) => ({ bucket: g.key, posts: g.count, median_likes: g.medianViews, x_account_median: round(g.lift) })),
    top_hashtags: a.hashtags.slice(0, 15).map((h) => ({ hashtag: '#' + h.key, posts: h.count, median_likes: h.medianViews, x_account_median: round(h.lift) })),
    comments: commentSection(a, 'likes'),
    top_posts: M.sortBy(posts, 'viralScore').slice(0, 10).map((p) => brief(p))
  };
}

const SORT_KEYS = { viral_score: 'viralScore', views: 'views', likes: 'likes', comments: 'comments', comments_x_median: 'commentRatio', shares: 'shares', saves: 'saves', engagement: 'engagement', date: 'date', duration: 'duration' };

export function hiddenSmall(lib, scope) {
  return selectAccounts(lib, { ...scope, includeSmall: true }).length - selectAccounts(lib, scope).length;
}

/** YouTube format filter: 'shorts' | 'long_form' keep only YouTube videos of that format. */
const formatFilter = (format) => (format === 'shorts' ? (p) => isYouTubePost(p) && p.type === 'short'
  : format === 'long_form' ? (p) => isYouTubePost(p) && p.type !== 'short' : () => true);

/** An account reference meant as X: "x/name", an x.com URL, or a bare handle → "x/name". */
export function xAccount(a) {
  const n = normUser(a);
  return isXId(n) ? n : XP.xId(String(a || '').trim().replace(/^@/, ''));
}

/** X filter for rankings: originals only (replies, thread parts and reposts are not ranked), optionally one format. */
const xRankOk = (xFormat) => (p) => !isXPost(p) || (isXOriginal(p) && (!xFormat || (p.type || 'text') === xFormat));

const X_RANK_NOTE = 'X posts: originals only (replies, thread parts and reposts are left out), each scored by views ÷ its author\'s median for that format; median_approx (≈) = the author had fewer than 8 posts of that format, so the overall originals median was used. Posts before 2023 have no views and no score.';

/**
 * Rank Instagram reels, TikTok videos, YouTube videos/Shorts and X posts (platform: 'all' = all of them, default;
 * with post_type 'reels' X contributes its video posts, platform 'x' ranks every X format). Reddit has top_posts.
 */
export function topReels(lib, { folder, tag, usernames, sort = 'viral_score', since_days, limit = 20, min_views = 0, include_photos = false, post_type, include_small_accounts = false, platform = 'all', format, x_format } = {}) {
  // post_type: 'reels' (default; 'all' for platform x) | 'carousels_photos' (Instagram carousels and photos, ranked by likes) | 'all'
  if (x_format && !format && (!platform || platform === 'all')) platform = 'x';
  const kind = post_type || (include_photos || platform === 'x' ? 'all' : 'reels');
  const kindOk = kind === 'all' ? () => true : kind === 'carousels_photos' ? (p) => M.isLikesScored(p) : isVideo;
  if (kind === 'carousels_photos' && platform === 'all') platform = 'instagram';
  const plat = ['instagram', 'tiktok', 'youtube', 'x'].includes(platform) ? platform : format ? 'youtube' : 'video';
  if (plat === 'x' && usernames?.length) usernames = usernames.map(xAccount);
  const accounts = selectAccounts(lib, { folder, tag, usernames, includeSmall: include_small_accounts, platform: plat });
  const since = since_days ? Date.now() - since_days * 864e5 : null;
  const fmtOk = formatFilter(format);
  const xOk = xRankOk(x_format);
  let posts = accounts.flatMap((u) => enrichedPosts(lib, u));
  posts = posts.filter((p) => kindOk(p) && fmtOk(p) && xOk(p) && (M.val(p) || 0) >= min_views && (!since || (p.takenAt && p.takenAt >= since)));
  const sorted = M.sortBy(posts, SORT_KEYS[sort] || 'viralScore');
  const hidden = include_small_accounts ? 0 : hiddenSmall(lib, { folder, tag, usernames, platform: plat });
  const platforms = [...new Set(accounts.map((u) => platformOf(lib, u)))];
  return {
    accounts: accounts.length, platforms, hidden_small_accounts: hidden || undefined, matched: posts.length,
    scoring_note: kind !== 'reels' ? `Instagram carousels and photos have no public views: they are scored by likes against their account's median carousel or photo (scored_by: "likes"; needs ${M.MIN_BASELINE} of them), so viral_score still compares fairly with reels. min_views applies to likes for them.` : undefined,
    youtube_note: platforms.includes('youtube') ? 'YouTube Shorts are scored against their channel\'s Shorts median and long-form videos against its long-form median. views_exact: false = YouTube\'s rounded channel-page count.' : undefined,
    x_note: platforms.includes('x') ? X_RANK_NOTE + (kind === 'reels' ? ' With post_type "reels" only X video posts are included; platform "x" ranks every format.' : '') : undefined,
    reels: sorted.slice(0, limit).map((p) => brief(p))
  };
}

export function searchReels(lib, { query, folder, tag, usernames, limit = 20, include_small_accounts = false, platform = 'all', format } = {}) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) throw new Error('query is empty');
  const words = q.split(/\s+/);
  if (platform === 'x' && usernames?.length) usernames = usernames.map(xAccount);
  const accounts = selectAccounts(lib, { folder, tag, usernames, includeSmall: include_small_accounts, platform: format && (!platform || platform === 'all') ? 'youtube' : platform });
  const fmtOk = formatFilter(format);
  const hits = accounts.flatMap((u) => enrichedPosts(lib, u)).filter((p) => {
    if (!fmtOk(p)) return false;
    // X: a repost is someone else's text.
    if (isXPost(p) && M.xKind(p) === 'repost') return false;
    // YouTube: title, tags (keywords) and description too. X: an article's title.
    const hay = ((p.caption || '') + ' ' + (p.hashtags || []).map((t) => '#' + t).join(' ') + ' ' + (p.audio?.title || '') + ' ' + (p.flair || '') +
      ' ' + (p.keywords || []).join(' ') + ' ' + (p.description || '') + ' ' + (p.article?.title || '')).toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  return { matched: hits.length, reels: M.sortBy(hits, 'viralScore').slice(0, limit).map((p) => brief(p)) };
}

/** A YouTube video id from a youtube.com/watch?v=, /shorts/, /live/ or youtu.be/ URL (not from a bare id). */
export function youtubeIdOf(code) {
  return /youtube\.com|youtu\.be/i.test(String(code || '')) ? Y.videoIdOf(code) : null;
}

/** An X post id from an x.com / twitter.com status URL (not from a bare id: those are looked up as they are). */
export function xPostIdOf(code) {
  return /(?:^|[/.])(?:x|twitter)\.com\//i.test(String(code || '')) ? XP.postIdOf(code) : null;
}

export function findReel(lib, code) {
  const xid = xPostIdOf(code);
  if (xid) {
    for (const u of Object.keys(lib.accounts)) {
      if (lib.accounts[u].posts?.[xid]) return enrichedPosts(lib, u).find((p) => p.code === xid);
    }
    return null;
  }
  const yid = youtubeIdOf(code);
  if (yid) {
    for (const u of Object.keys(lib.accounts)) {
      if (lib.accounts[u].posts?.[yid]) return enrichedPosts(lib, u).find((p) => p.code === yid);
    }
    return null;
  }
  const tid = T.videoIdOf(code);
  if (tid) {
    for (const u of Object.keys(lib.accounts)) {
      if (lib.accounts[u].posts?.[tid]) return enrichedPosts(lib, u).find((p) => p.code === tid);
    }
    return null;
  }
  const c = String(code || '').trim()
    .replace(/^.*\/comments\/([a-z0-9]+).*$/i, '$1') // reddit.com/r/x/comments/<id>/…
    .replace(/^t3_/, '')
    .replace(/^.*\/(?:reels?|p)\/([\w-]+).*$/, '$1');
  for (const u of Object.keys(lib.accounts)) {
    if (lib.accounts[u].posts?.[c]) {
      const enriched = enrichedPosts(lib, u).find((p) => p.code === c);
      return enriched;
    }
  }
  return null;
}

// ---- cross-platform comparison -------------------------------------------------

/**
 * Match the same videos on an Instagram account and a TikTok account (caption
 * similarity, hashtags, duration, posting date ±3 days, episode numbers) and
 * compare views, engagement and × each account's own median.
 * account_ig: Instagram username; account_tt: TikTok username (tt/ optional). If one is missing, the same handle is used.
 */
const CMP_NAMES = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube Shorts', x: 'X (video posts)' };
/** yt/name, yt/UC…, youtube.com/@name, or a bare handle → the YouTube account id. */
const ytAccount = (u) => { const n = normUser(u); return isYouTubeId(n) ? n : normUser('yt/' + String(u).trim().replace(/^@/, '')); };
/** The platform an account reference names by itself (tt/…, yt/…, x/… or a URL), else null. */
const namedPlatform = (n) => (isTikTokId(n) ? 'tiktok' : isYouTubeId(n) ? 'youtube' : isXId(n) ? 'x' : null);
const CMP_ENGAGEMENT = {
  instagram: 'Instagram counts likes + comments (shares/saves are rarely public there)',
  tiktok: 'TikTok counts likes + comments + shares + saves',
  youtube: 'YouTube counts likes + comments',
  x: 'X counts likes + replies (comments) + reposts (shares) + quotes + bookmarks (saves)'
};

/**
 * Match the same short videos across two accounts on different platforms:
 * Instagram ↔ TikTok (as before), a YouTube channel's Shorts ↔ Instagram or TikTok, or an X account's
 * video posts ↔ any of those. Each side is scored against its own median (a channel's Shorts median
 * for YouTube, the author's video-format median for X).
 * An argument that names its platform itself (tt/…, yt/…, x/…, a URL) counts for that platform.
 */
export function comparePlatforms(lib, { account_ig, account_tt, account_yt, account_x, since_days, min_score, limit = 50 } = {}) {
  const given = {};
  const put = (plat, id) => {
    if (given[plat] && given[plat] !== id) throw new Error(`Two ${CMP_NAMES[plat]} accounts given (${labelOf(given[plat])} and ${labelOf(id)}): compare two accounts on different platforms.`);
    given[plat] = id;
  };
  if (account_ig) { const n = normUser(account_ig); put(namedPlatform(n) || 'instagram', n); }
  if (account_tt) { const n = normUser(account_tt); const p = namedPlatform(n); put(p || 'tiktok', p ? n : 'tt/' + n.replace(/^@/, '')); }
  if (account_yt) { const p = namedPlatform(normUser(account_yt)); if (p && p !== 'youtube') put(p, normUser(account_yt)); else put('youtube', ytAccount(account_yt)); }
  if (account_x) { const p = namedPlatform(normUser(account_x)); if (p && p !== 'x') put(p, normUser(account_x)); else put('x', xAccount(account_x)); }
  const ids = (plat) => Object.keys(lib.accounts).filter((u) => platformOf(lib, u) === plat);
  const plats = Object.keys(given);
  if (plats.length > 2) throw new Error('Compare two accounts at a time: two of account_ig, account_tt, account_yt and account_x.');
  if (!plats.length) throw new Error('Give two of account_ig, account_tt, account_yt and account_x.');
  if (plats.length === 1) {
    const only = plats[0];
    const id = given[only];
    if (only === 'youtube' || only === 'x') {
      // Same handle on Instagram, else on TikTok (else, for X, on YouTube).
      const h = id.slice(only === 'x' ? 2 : 3).toLowerCase();
      if (lib.accounts[h] && platformOf(lib, h) === 'instagram') given.instagram = h;
      else if (lib.accounts['tt/' + h]) given.tiktok = 'tt/' + h;
      else if (only === 'x' && lib.accounts['yt/' + h]) given.youtube = 'yt/' + h;
      else if (only === 'youtube') throw new Error(`Give account_ig or account_tt to compare ${labelOf(id)}'s Shorts with (no Instagram or TikTok account named ${h} is saved).`);
      else throw new Error(`Give account_ig, account_tt or account_yt to compare ${labelOf(id)}'s video posts with (no Instagram, TikTok or YouTube account named ${h} is saved).`);
    } else if (only === 'tiktok') given.instagram = id.slice(3);
    else given.tiktok = 'tt/' + id;
  }
  const { instagram: ig, tiktok: tt, youtube: yt, x } = given;
  if (yt && (!lib.accounts[yt] || platformOf(lib, yt) !== 'youtube')) throw new Error(`YouTube channel ${labelOf(yt)} is not in the library. Saved channels: ${ids('youtube').slice(0, 15).join(', ') || 'none'}. Use collect_profile with yt/<handle>.`);
  if (ig && (!lib.accounts[ig] || platformOf(lib, ig) !== 'instagram')) throw new Error(`Instagram account @${ig} is not in the library. Saved Instagram accounts: ${ids('instagram').slice(0, 15).join(', ') || 'none'}.`);
  if (tt && !lib.accounts[tt]) throw new Error(`TikTok account ${labelOf(tt)} is not in the library. Saved TikTok accounts: ${ids('tiktok').map((u) => u.slice(3)).slice(0, 15).join(', ') || 'none'}. Use collect_profile with tt/<name>.`);
  if (x && (!lib.accounts[x] || platformOf(lib, x) !== 'x')) throw new Error(`X account ${labelOf(x)} is not in the library. Saved X accounts: ${ids('x').slice(0, 15).join(', ') || 'none'}. Use collect_profile with x/<name>.`);

  const [pa, pb] = C.sideOrder(...Object.keys(given));
  const idOf = given;
  const hasYT = !!yt;
  const hasX = !!x;
  const since = since_days ? Date.now() - since_days * 864e5 : null;
  const keep = (p) => !since || (p.takenAt && p.takenAt >= since) || (p.platform === 'youtube' && !C.dateOf(p)); // undated Shorts stay in
  const r = C.match(enrichedPosts(lib, idOf[pa]).filter(keep), enrichedPosts(lib, idOf[pb]).filter(keep), { minScore: min_score });
  const sideOut = (v) => ({
    code: v.code, url: v.url, posted_at: iso(v.posted_at), date: v.platform === 'youtube' ? v.date : undefined,
    views: v.views, likes: v.likes, comments: v.comments,
    shares: v.platform === 'youtube' ? undefined : v.shares, saves: v.platform === 'tiktok' || v.platform === 'x' ? v.saves : undefined, duration_s: v.duration,
    engagement_pct: round(v.engagement), x_account_median: round(v.ratio),
    median_approx: v.platform === 'x' && v.ratio != null && v.medianApprox ? true : undefined,
    viral_score: v.viralScore,
    caption: (v.caption || '').replace(/\s+/g, ' ').slice(0, 160)
  });
  const vidKey = (p) => (p === 'youtube' ? 'youtube_shorts' : `${p}_videos`);
  const s = r.summary;
  const out = { [pa]: idOf[pa], [pb]: idOf[pb] };
  out.how_matched = `Same video = similar caption${hasYT ? ' / Shorts title' : ''}${hasX ? ' / X post text' : ''} (Turkish letters, emoji, hashtags ignored), shared hashtags, length within ~1.5 s and posted within ±${C.MAX_DAYS} days; different episode numbers ("Bug #12" vs "#13") never match. Each video is matched once. x_account_median compares each side with its own account's median views${hasYT ? ' (for YouTube, the channel\'s Shorts median; long-form videos are left out)' : ''}${hasX ? ' (for X, the author\'s median for video posts; median_approx = fewer than 8 video posts with views, so the overall originals median stood in; X text, image and other posts, replies and reposts are left out)' : ''}, so the platform with the bigger audience doesn't win automatically.`;
  out.summary = {
    [vidKey(pa)]: s.videosA,
    [vidKey(pb)]: s.videosB,
    matched: s.matched,
    [`typical_${pb}_to_${pa}_views`]: round(s.typicalViewsRatio),
    median_views: { [pa]: s.medianViewsA, [pb]: s.medianViewsB },
    median_x_account_median: { [pa]: round(s.medianRatioA), [pb]: round(s.medianRatioB) },
    median_engagement_pct: { [pa]: round(s.medianEngagementA), [pb]: round(s.medianEngagementB) },
    better_relative_to_own_median: { [pa]: s.winsA, [pb]: s.winsB },
    hits_on_both: s.hitsOnBoth,
    engagement_note: CMP_ENGAGEMENT[pa] + '; ' + CMP_ENGAGEMENT[pb] + '.'
  };
  if (hasYT) {
    const shorts = enrichedPosts(lib, yt).filter((p) => C.isVideo(p));
    const dated = shorts.filter((p) => C.dateOf(p)).length;
    out.summary.youtube_dates = { exact_or_day: dated, without_usable_date: shorts.length - dated };
    if (shorts.length - dated) out.summary.dates_note = `${shorts.length - dated} of ${shorts.length} Shorts have no exact date (the Shorts tab shows none), so they only match on clearly similar titles. youtube_api_stats (with an API key), refresh_reel or download_reel fill in exact dates.`;
  }
  if (hasX) {
    const vids = enrichedPosts(lib, x).filter((p) => C.isVideo(p));
    const scored = vids.filter((p) => p.ratio != null);
    const approx = scored.filter((p) => p.baselineApprox).length;
    out.summary.x_video_median = { median_views: scored[0]?.baseline ?? null, approximate: approx ? true : undefined, scored: scored.length, without_views: vids.filter((p) => p.views == null).length || undefined };
    if (approx) out.summary.x_note = `${labelOf(x)} has fewer than 8 video posts with views, so its videos are scored against its overall originals median: x_account_median on the X side is approximate (≈).`;
  }
  out.pairs = r.pairs.slice(0, limit).map((p) => ({
    match_score: p.score, confidence: p.confidence, days_apart: p.days,
    better_on: p.winner === 'a' ? pa : p.winner === 'b' ? pb : null,
    [`${pb}_to_${pa}_views`]: round(p.viewsRatio),
    [pa]: sideOut(p.a), [pb]: sideOut(p.b)
  }));
  const only = (list) => ({ count: list.length, examples: list.slice(0, 10).map((v) => ({ code: v.code, url: v.url, posted_at: iso(v.posted_at), views: v.views, caption: (v.caption || '').slice(0, 100) })) });
  out[`only_on_${pa}`] = only(r.onlyA);
  out[`only_on_${pb}`] = only(r.onlyB);
  out.platforms = [CMP_NAMES[pa], CMP_NAMES[pb]];
  return out;
}

// ---- Reddit mentions --------------------------------------------------------

/** Mentions inbox, filtered. watch = watch id or (part of) its query. */
export function mentionsQuery(lib, { watch, since_days, since, unread_only = false, subreddit, kind, limit = 50 } = {}) {
  const watches = lib.watches || [];
  const store = lib.mentions || { items: {}, read: {} };
  let watchId = null;
  if (watch) {
    const w = watches.find((x) => x.id === watch) || watches.find((x) => x.query.toLowerCase() === String(watch).toLowerCase()) ||
      watches.find((x) => x.query.toLowerCase().includes(String(watch).toLowerCase()));
    if (!w) throw new Error(`No watch matches "${watch}". Watches: ${watches.map((x) => x.query).join(' | ') || 'none (add them on the Mentions page of the OpenOutlier Library)'}`);
    watchId = w.id;
  }
  const sinceMs = since ? Date.parse(since) : since_days ? Date.now() - since_days * 864e5 : null;
  if (since && !Number.isFinite(sinceMs)) throw new Error('since must be an ISO date, e.g. 2026-11-01');
  const all = MN.list(store, { watchId, unreadOnly: unread_only, since: sinceMs, kind, subreddit });
  const counts = {};
  Object.values(store.items).forEach((m) => {
    const c = counts[m.watchId] || (counts[m.watchId] = { found: 0, unread: 0 });
    c.found++;
    if (!store.read[m.id]) c.unread++;
  });
  return {
    watches: watches.map((w) => ({ id: w.id, query: w.query, subreddits: w.subreddits, exclude: w.exclude?.length ? w.exclude : undefined, kinds: w.kinds, enabled: w.enabled !== false, ...(counts[w.id] || { found: 0, unread: 0 }) })),
    total: Object.keys(store.items).length,
    unread: Object.keys(store.items).filter((id) => !store.read[id]).length,
    matched: all.length,
    mentions: all.slice(0, limit).map((m) => ({ ...m, createdAt: iso(m.createdAt), foundAt: iso(m.foundAt), read: !!store.read[m.id] }))
  };
}
