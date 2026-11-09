// ReelScope MCP – the on-disk copy of the library and the queries agents run on it.
// The extension pushes its data here (see bridge.mjs); every MCP server
// instance (Claude Desktop, Claude Code, …) reads the same files.
import { createRequire } from 'node:module';
import { promises as fs, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
export const M = require('../src/metrics.js');
export const MN = require('../src/mentions.js');

export const HOME = process.env.REELSCOPE_HOME || join(homedir(), '.reelscope');
export const LIBRARY_FILE = join(HOME, 'library.json');
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

// ---- library file -----------------------------------------------------------

let cache = { mtimeMs: -1, lib: null };

export function emptyLibrary() {
  return { syncId: randomUUID(), syncedAt: null, accounts: {}, org: { folders: [], accounts: {} }, watches: [], mentions: { items: {}, read: {} } };
}

/** Read the library (cached until the file changes). */
export function readLibrary() {
  if (!existsSync(LIBRARY_FILE)) return emptyLibrary();
  const { mtimeMs } = statSync(LIBRARY_FILE);
  if (cache.lib && cache.mtimeMs === mtimeMs) return cache.lib;
  try {
    const lib = JSON.parse(readFileSync(LIBRARY_FILE, 'utf8'));
    lib.accounts = lib.accounts || {};
    lib.org = lib.org || { folders: [], accounts: {} };
    lib.watches = Array.isArray(lib.watches) ? lib.watches : [];
    lib.mentions = lib.mentions && lib.mentions.items ? lib.mentions : { items: {}, read: {} };
    cache = { mtimeMs, lib };
    return lib;
  } catch {
    return cache.lib || emptyLibrary();
  }
}

/**
 * Apply a sync from the extension.
 * full: replace all accounts. Otherwise `accounts` maps username → record or null (deleted).
 */
export async function applySync({ full, accounts, org, watches, mentions }) {
  const prev = readLibrary();
  const lib = full ? { ...emptyLibrary(), syncId: prev.syncId, watches: prev.watches, mentions: prev.mentions } : { ...prev };
  if (full) lib.accounts = {};
  else lib.accounts = { ...lib.accounts };
  for (const [u, rec] of Object.entries(accounts || {})) {
    if (rec && rec.posts) lib.accounts[u] = { posts: rec.posts, updatedAt: rec.updatedAt || Date.now() };
    else delete lib.accounts[u];
  }
  if (org) lib.org = org;
  if (Array.isArray(watches)) lib.watches = watches;
  if (mentions && typeof mentions === 'object') lib.mentions = { items: mentions.items || {}, read: mentions.read || {} };
  lib.syncedAt = Date.now();
  await ensureHome();
  await writeJsonAtomic(LIBRARY_FILE, lib);
  cache = { mtimeMs: -1, lib: null };
  return lib;
}

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

/** Reddit accounts are stored as "r/<sub>" and "u/<user>"; Instagram usernames never contain "/". */
export function isRedditId(id) { return /^(r|u)\/[a-z0-9_-]{2,30}$/.test(String(id || '')); }
export function platformOf(lib, id) { return lib.accounts[id]?.platform === 'reddit' || isRedditId(id) ? 'reddit' : 'instagram'; }
export function labelOf(id) { return isRedditId(id) ? id : '@' + id; }

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
  const m = s.match(/^(?:https?:\/\/)?(?:(?:www|old|new)\.)?(?:reddit\.com)?\/?(r|u|user)\/([A-Za-z0-9_-]{2,30})/i);
  if (m) return (m[1].toLowerCase() === 'r' ? 'r/' : 'u/') + m[2].toLowerCase();
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
  if (platform && platform !== 'all') list = list.filter((u) => platformOf(lib, u) === platform);
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

export function linkExpiry(url) {
  try {
    const oe = new URL(url).searchParams.get('oe');
    return oe ? parseInt(oe, 16) * 1000 : null;
  } catch { return null; }
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
  const out = {
    code: p.code,
    url: p.url,
    account: p.owner,
    type: p.type,
    posted_at: iso(p.takenAt),
    views: p.views ?? null,
    likes: p.likes ?? null,
    comments: p.comments ?? null,
    shares: p.shares ?? null,
    duration_s: p.duration ?? null,
    engagement_pct: round(p.engagement),
    x_account_median: round(p.ratio),
    viral_score: p.viralScore ?? null,
    pinned: p.pinned || undefined,
    audio: p.audio ? (p.audio.kind === 'music' ? `music: ${p.audio.title}${p.audio.artist ? ' – ' + p.audio.artist : ''}` : 'original audio') : null,
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

function bestSlots(heatmap) {
  return heatmap.cells.flat().filter((c) => c.count >= 2)
    .sort((x, y) => y.medianViews - x.medianViews).slice(0, 5)
    .map((c) => ({
      day: DAY[c.day],
      hours_local: `${String(c.block * heatmap.blockHours).padStart(2, '0')}:00–${String((c.block + 1) * heatmap.blockHours % 24).padStart(2, '0')}:00`,
      posts: c.count, median: c.medianViews
    }));
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
    best_posting_slots: bestSlots(a.heatmap).map(({ median, ...s }) => ({ ...s, median_score: median })),
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
  if (!lib.accounts[u]) throw new Error(`@${u} is not in the library. Use collect_profile to collect it.`);
  const posts = enrichedPosts(lib, u);
  const reels = posts.filter(isVideo);
  const a = M.analyze(reels);
  const slots = bestSlots(a.heatmap).map(({ median, ...s }) => ({ ...s, median_views: median }));
  return {
    account: accountRow(lib, u),
    summary: {
      reels_analyzed: a.summary.count,
      median_views: a.summary.medianViews,
      avg_views: round(a.summary.avgViews, 0),
      total_views: a.summary.totalViews,
      avg_engagement_pct: round(a.summary.avgEngagement),
      outliers: a.summary.outliers,
      posts_per_week: round(a.summary.postsPerWeek, 1),
      first_post: iso(a.summary.firstPost),
      last_post: iso(a.summary.lastPost)
    },
    best_posting_slots: slots,
    timezone_note: 'Times use the computer\'s local time zone: ' + Intl.DateTimeFormat().resolvedOptions().timeZone,
    top_hashtags: a.hashtags.slice(0, 15).map((h) => ({ hashtag: '#' + h.key, posts: h.count, median_views: h.medianViews, x_account_median: round(h.lift) })),
    video_length: a.durations.map((d) => ({ bucket: d.key, posts: d.count, median_views: d.medianViews, x_account_median: round(d.lift) })),
    audio: a.audio.kinds.map((k) => ({ kind: k.key, posts: k.count, median_views: k.medianViews })),
    top_reels: M.sortBy(reels, 'views').slice(0, 10).map((p) => brief(p))
  };
}

const SORT_KEYS = { viral_score: 'viralScore', views: 'views', likes: 'likes', comments: 'comments', shares: 'shares', engagement: 'engagement', date: 'date', duration: 'duration' };

export function hiddenSmall(lib, scope) {
  return selectAccounts(lib, { ...scope, includeSmall: true }).length - selectAccounts(lib, scope).length;
}

export function topReels(lib, { folder, tag, usernames, sort = 'viral_score', since_days, limit = 20, min_views = 0, include_photos = false, include_small_accounts = false } = {}) {
  const accounts = selectAccounts(lib, { folder, tag, usernames, includeSmall: include_small_accounts, platform: 'instagram' });
  const since = since_days ? Date.now() - since_days * 864e5 : null;
  let posts = accounts.flatMap((u) => enrichedPosts(lib, u));
  posts = posts.filter((p) => (include_photos || isVideo(p)) && (p.views || 0) >= min_views && (!since || (p.takenAt && p.takenAt >= since)));
  const sorted = M.sortBy(posts, SORT_KEYS[sort] || 'viralScore');
  const hidden = include_small_accounts ? 0 : hiddenSmall(lib, { folder, tag, usernames, platform: 'instagram' });
  return { accounts: accounts.length, hidden_small_accounts: hidden || undefined, matched: posts.length, reels: sorted.slice(0, limit).map((p) => brief(p)) };
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

// ---- Reddit mentions --------------------------------------------------------

/** Mentions inbox, filtered. watch = watch id or (part of) its query. */
export function mentionsQuery(lib, { watch, since_days, since, unread_only = false, subreddit, kind, limit = 50 } = {}) {
  const watches = lib.watches || [];
  const store = lib.mentions || { items: {}, read: {} };
  let watchId = null;
  if (watch) {
    const w = watches.find((x) => x.id === watch) || watches.find((x) => x.query.toLowerCase() === String(watch).toLowerCase()) ||
      watches.find((x) => x.query.toLowerCase().includes(String(watch).toLowerCase()));
    if (!w) throw new Error(`No watch matches "${watch}". Watches: ${watches.map((x) => x.query).join(' | ') || 'none (add them on the Mentions page of the ReelScope Library)'}`);
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
