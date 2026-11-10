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

export const HOME = resolveHome();
export const COMMANDS_DIR = join(HOME, 'commands');
export const STATUS_FILE = join(HOME, 'status.json');

export async function ensureHome() {
  await fs.mkdir(COMMANDS_DIR, { recursive: true });
}

async function writeJsonAtomic(file, value) {
  const tmp = file + '.' + process.pid + '.tmp';
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

const isVideo = (p) => p.type === 'reel' || p.type === 'video';
const isRedditPost = (p) => p.platform === 'reddit';

/** Reddit accounts are stored as "r/<sub>" and "u/<user>", TikTok as "tt/<user>"; Instagram usernames never contain "/". */
export function isRedditId(id) { return /^(r|u)\/[a-z0-9_-]{2,30}$/.test(String(id || '')); }
export const isTikTokId = (id) => T.isTikTokId(id);
export function platformOf(lib, id) {
  if (lib.accounts[id]?.platform === 'reddit' || isRedditId(id)) return 'reddit';
  if (lib.accounts[id]?.platform === 'tiktok' || isTikTokId(id)) return 'tiktok';
  return 'instagram';
}
export function labelOf(id) { return isRedditId(id) ? id : isTikTokId(id) ? '@' + id.slice(3) + ' (TikTok)' : '@' + id; }

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
 * "u/Name", "/user/name" → "u/name".
 */
export function normUser(u) {
  const s = String(u || '').trim();
  // TikTok: "tt/name", "tiktok:@name", "tiktok.com/@name", "https://www.tiktok.com/@name/video/…"
  const t = s.match(/^(?:tt\/|tiktok:\s*@?)([A-Za-z0-9._]{1,30})$/i) || s.match(/^(?:https?:\/\/)?(?:(?:www|m)\.)?tiktok\.com\/@([A-Za-z0-9._]{1,30})/i);
  if (t) return 'tt/' + t[1].toLowerCase();
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
  // platform: 'instagram' | 'tiktok' | 'reddit' | 'video' (Instagram + TikTok) | 'all'
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

/** Compact reel record for agents (Reddit posts get redditBrief). */
export function brief(p, { full = false } = {}) {
  if (isRedditPost(p)) return redditBrief(p, { full });
  const tt = p.platform === 'tiktok';
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
    engagement_pct: round(p.engagement),
    x_account_median: round(p.ratio),
    viral_score: p.viralScore ?? null,
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
  const withViews = vids.filter((p) => p.views > 0);
  const name = posts.find((p) => p.ownerName)?.ownerName || null;
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
    posts_saved: posts.length,
    reels: vids.length,
    median_views: M.median(withViews.map((p) => p.views)),
    outliers: vids.filter((p) => p.outlier).length,
    updated_at: iso(lib.accounts[u]?.updatedAt)
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

/** Rank Reddit posts across subreddits / users (each scored against its own account's median). */
export function topPosts(lib, { folder, tag, subreddits, sort = 'viral_score', since_days, limit = 20, min_score = 0, flair, post_type, questions_only = false, include_small_accounts = false } = {}) {
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

export function accountSummary(lib, u) {
  if (platformOf(lib, u) === 'reddit') return subredditSummary(lib, u);
  if (!lib.accounts[u]) throw new Error(`${labelOf(u)} is not in the library. Use collect_profile ${isTikTokId(u) ? 'with ' + u + ' ' : ''}to collect it.`);
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
    top_reels: M.sortBy(reels, 'views').slice(0, 10).map((p) => brief(p))
  };
}

const SORT_KEYS = { viral_score: 'viralScore', views: 'views', likes: 'likes', comments: 'comments', shares: 'shares', saves: 'saves', engagement: 'engagement', date: 'date', duration: 'duration' };

export function hiddenSmall(lib, scope) {
  return selectAccounts(lib, { ...scope, includeSmall: true }).length - selectAccounts(lib, scope).length;
}

/** Rank Instagram reels and TikTok videos (platform: 'all' = both, default). Reddit has top_posts. */
export function topReels(lib, { folder, tag, usernames, sort = 'viral_score', since_days, limit = 20, min_views = 0, include_photos = false, include_small_accounts = false, platform = 'all' } = {}) {
  const plat = platform === 'instagram' || platform === 'tiktok' ? platform : 'video';
  const accounts = selectAccounts(lib, { folder, tag, usernames, includeSmall: include_small_accounts, platform: plat });
  const since = since_days ? Date.now() - since_days * 864e5 : null;
  let posts = accounts.flatMap((u) => enrichedPosts(lib, u));
  posts = posts.filter((p) => (include_photos || isVideo(p)) && (p.views || 0) >= min_views && (!since || (p.takenAt && p.takenAt >= since)));
  const sorted = M.sortBy(posts, SORT_KEYS[sort] || 'viralScore');
  const hidden = include_small_accounts ? 0 : hiddenSmall(lib, { folder, tag, usernames, platform: plat });
  const platforms = [...new Set(accounts.map((u) => platformOf(lib, u)))];
  return { accounts: accounts.length, platforms, hidden_small_accounts: hidden || undefined, matched: posts.length, reels: sorted.slice(0, limit).map((p) => brief(p)) };
}

export function searchReels(lib, { query, folder, tag, usernames, limit = 20, include_small_accounts = false, platform = 'all' } = {}) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) throw new Error('query is empty');
  const words = q.split(/\s+/);
  const accounts = selectAccounts(lib, { folder, tag, usernames, includeSmall: include_small_accounts, platform });
  const hits = accounts.flatMap((u) => enrichedPosts(lib, u)).filter((p) => {
    const hay = ((p.caption || '') + ' ' + (p.hashtags || []).map((t) => '#' + t).join(' ') + ' ' + (p.audio?.title || '') + ' ' + (p.flair || '')).toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  return { matched: hits.length, reels: M.sortBy(hits, 'viralScore').slice(0, limit).map((p) => brief(p)) };
}

export function findReel(lib, code) {
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
export function comparePlatforms(lib, { account_ig, account_tt, since_days, min_score, limit = 50 } = {}) {
  let ig = account_ig ? normUser(account_ig) : null;
  let tt = account_tt ? normUser(account_tt) : null;
  if (ig && isTikTokId(ig) && !tt) { tt = ig; ig = null; }
  if (tt && !isTikTokId(tt)) tt = 'tt/' + tt.replace(/^@/, '');
  if (!ig && tt) ig = tt.slice(3);
  if (!tt && ig) tt = 'tt/' + ig;
  if (!ig || !tt) throw new Error('Give account_ig and/or account_tt.');
  const igIds = Object.keys(lib.accounts).filter((u) => platformOf(lib, u) === 'instagram');
  const ttIds = Object.keys(lib.accounts).filter((u) => platformOf(lib, u) === 'tiktok');
  if (!lib.accounts[ig] || platformOf(lib, ig) !== 'instagram') throw new Error(`Instagram account @${ig} is not in the library. Saved Instagram accounts: ${igIds.slice(0, 15).join(', ') || 'none'}.`);
  if (!lib.accounts[tt]) throw new Error(`TikTok account ${labelOf(tt)} is not in the library. Saved TikTok accounts: ${ttIds.map((u) => u.slice(3)).slice(0, 15).join(', ') || 'none'}. Use collect_profile with tt/<name>.`);
  const since = since_days ? Date.now() - since_days * 864e5 : null;
  const keep = (p) => !since || (p.takenAt && p.takenAt >= since);
  const r = C.match(enrichedPosts(lib, ig).filter(keep), enrichedPosts(lib, tt).filter(keep), { minScore: min_score });
  const sideOut = (x) => ({
    code: x.code, url: x.url, posted_at: iso(x.posted_at), views: x.views, likes: x.likes, comments: x.comments,
    shares: x.shares, saves: x.platform === 'tiktok' ? x.saves : undefined, duration_s: x.duration,
    engagement_pct: round(x.engagement), x_account_median: round(x.ratio), viral_score: x.viralScore,
    caption: (x.caption || '').replace(/\s+/g, ' ').slice(0, 160)
  });
  const s = r.summary;
  return {
    instagram: ig,
    tiktok: tt,
    how_matched: `Same video = similar caption (Turkish letters, emoji, hashtags ignored), shared hashtags, length within ~1.5 s and posted within ±${C.MAX_DAYS} days; different episode numbers ("Bug #12" vs "#13") never match. Each video is matched once. x_account_median compares each side with its own account's median views, so the platform with the bigger audience doesn't win automatically.`,
    summary: {
      instagram_videos: s.videosA,
      tiktok_videos: s.videosB,
      matched: s.matched,
      typical_tiktok_to_instagram_views: round(s.typicalViewsRatio),
      median_views: { instagram: s.medianViewsA, tiktok: s.medianViewsB },
      median_x_account_median: { instagram: round(s.medianRatioA), tiktok: round(s.medianRatioB) },
      median_engagement_pct: { instagram: round(s.medianEngagementA), tiktok: round(s.medianEngagementB) },
      better_relative_to_own_median: { instagram: s.winsA, tiktok: s.winsB },
      hits_on_both: s.hitsOnBoth,
      engagement_note: 'TikTok engagement counts likes + comments + shares + saves; Instagram counts likes + comments (shares/saves are rarely public there).'
    },
    pairs: r.pairs.slice(0, limit).map((p) => ({
      match_score: p.score, confidence: p.confidence, days_apart: p.days,
      better_on: p.winner === 'a' ? 'instagram' : p.winner === 'b' ? 'tiktok' : null,
      tiktok_to_instagram_views: round(p.viewsRatio),
      instagram: sideOut(p.a), tiktok: sideOut(p.b)
    })),
    only_on_instagram: { count: r.onlyA.length, examples: r.onlyA.slice(0, 10).map((x) => ({ code: x.code, url: x.url, posted_at: iso(x.posted_at), views: x.views, caption: (x.caption || '').slice(0, 100) })) },
    only_on_tiktok: { count: r.onlyB.length, examples: r.onlyB.slice(0, 10).map((x) => ({ code: x.code, url: x.url, posted_at: iso(x.posted_at), views: x.views, caption: (x.caption || '').slice(0, 100) })) }
  };
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
