#!/usr/bin/env node
// ReelScope MCP server (stdio). Gives AI agents read access to your ReelScope
// library, video files for analysis, and a way to ask the extension to
// collect or refresh profiles. Everything stays on this computer.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createWriteStream, promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { startBridge, PORTS } from './bridge.mjs';
import {
  M, MIN_POSTS, postCount, hiddenSmall, readLibrary, readStatus, selectAccounts, accountRow, accountSummary, topReels, searchReels,
  findReel, brief, normUser, normSubreddit, isRedditId, isTikTokId, platformOf, subredditSummary, topPosts, contentIdeas, mentionsQuery,
  comparePlatforms, queueCommand, waitForCommand, readCommandState, linkExpiry, T
} from './library.mjs';

const log = (...a) => console.error('[reelscope-mcp]', ...a);

function json(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 1) }] };
}
function fail(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}
async function safe(fn) {
  try { return await fn(); } catch (e) { return fail(e.message || String(e)); }
}

function bridgeInfo() {
  const st = readStatus();
  const seen = st.extensionSeenAt || 0;
  return {
    extension_connected: Date.now() - seen < 3 * 60 * 1000,
    extension_last_seen: seen ? new Date(seen).toISOString() : null,
    library_synced_at: readLibrary().syncedAt ? new Date(readLibrary().syncedAt).toISOString() : null
  };
}

function noExtensionHint() {
  return 'The ReelScope extension has not contacted this server in the last few minutes. Make sure Chrome is open with ReelScope installed and "Connect to AI agents" turned on in its popup. The command stays queued for 20 minutes.';
}

const server = new McpServer(
  { name: 'reelscope', version: '0.1.0' },
  {
    instructions: [
      'ReelScope is a local library of Instagram Reels, TikTok videos and Reddit posts the user collected with the ReelScope browser extension.',
      'Start with list_accounts (or list_folders_and_tags) to see what is saved. Accounts are organized in folders and tags by the user; a folder can mix Instagram accounts (username), TikTok accounts (tt/username) and subreddits (r/name) / Reddit users (u/name). The same handle can exist on Instagram and TikTok: "name" is Instagram, "tt/name" is TikTok.',
      'Instagram and TikTok: x_account_median = views ÷ that account\'s median views. Reddit: the same with score (upvotes) ÷ the subreddit\'s (or user\'s) median score. viral_score = 50 + 25·log2(x), capped 0–100. ≥2× is an outlier. TikTok engagement counts likes + comments + shares + saves (TikTok shows them publicly); Instagram counts likes + comments.',
      'compare_platforms matches the same videos posted to Instagram and TikTok (caption, hashtags, length, date ±3 days) and shows how each did on both, relative to each account\'s median.',
      'Reddit tools: subreddit_summary (one subreddit: best times, title analysis, flair, post types), top_posts (rank posts across subreddits), content_ideas (most-upvoted questions and pain points in a folder of subreddits, with how much Instagram competitors in that folder already cover each theme — use it to turn Reddit demand into new reel ideas).',
      'To analyze a video itself, use download_reel to save the mp4 locally and work with the returned file path. Instagram CDN links expire after a few days; refresh_reel gets fresh ones.',
      'mentions: Reddit posts and comments that matched the user\'s keyword watches (checked every ~15 min by the extension, and 24/7 by the optional reddit-watch home server; source tells which).',
      'collect_profile / collect_subreddit ask the extension to collect an Instagram profile, a TikTok profile (tt/name) or a subreddit in a background Chrome tab or small window (logged-in session); they need Chrome running.'
    ].join('\n')
  }
);

const scope = {
  folder: z.string().optional().describe('Folder name (as shown in the ReelScope library)'),
  tag: z.string().optional().describe('Tag, with or without #'),
  usernames: z.array(z.string()).optional().describe('Limit to these accounts')
};

server.registerTool('list_accounts', {
  title: 'List saved accounts',
  description: 'All accounts saved in the ReelScope library — Instagram profiles (username), TikTok profiles (tt/username), subreddits (r/name) and Reddit users (u/name) — with platform, folder, tags, post count, median views (Instagram, TikTok) or median score (Reddit) and outliers. Filter by folder, tag or platform.',
  inputSchema: {
    folder: scope.folder,
    tag: scope.tag,
    platform: z.enum(['instagram', 'tiktok', 'reddit', 'all']).optional().describe('Default all'),
    include_small_accounts: z.boolean().optional().describe(`Also list accounts with fewer than ${MIN_POSTS} saved posts (usually single reels picked up while scrolling the feed). Default false.`)
  },
  annotations: { readOnlyHint: true }
}, ({ folder, tag, platform, include_small_accounts = false }) => safe(() => {
  const lib = readLibrary();
  const rows = selectAccounts(lib, { folder, tag, platform, includeSmall: include_small_accounts }).map((u) => accountRow(lib, u))
    .sort((a, b) => (b.posts_saved - a.posts_saved) || ((b.median_views || 0) - (a.median_views || 0)));
  const hidden = include_small_accounts ? 0 : hiddenSmall(lib, { folder, tag, platform });
  return json({ ...bridgeInfo(), count: rows.length, hidden_small_accounts: hidden || undefined, accounts: rows });
}));

server.registerTool('list_folders_and_tags', {
  title: 'List folders and tags',
  description: 'The folders and tags the user created in the ReelScope library, with how many accounts each has.',
  inputSchema: {},
  annotations: { readOnlyHint: true }
}, () => safe(() => {
  const lib = readLibrary();
  const users = Object.keys(lib.accounts);
  const real = users.filter((u) => postCount(lib, u) >= MIN_POSTS);
  const tags = {};
  users.forEach((u) => (lib.org.accounts?.[u]?.tags || []).forEach((t) => { tags[t] = (tags[t] || 0) + 1; }));
  return json({
    folders: lib.org.folders.map((f) => {
      const inF = users.filter((u) => lib.org.accounts?.[u]?.folder === f.id);
      const reddit = inF.filter((u) => platformOf(lib, u) === 'reddit').length;
      const tiktok = inF.filter((u) => platformOf(lib, u) === 'tiktok').length;
      return { name: f.name, accounts: inF.length, ...(reddit || tiktok ? { instagram: inF.length - reddit - tiktok, ...(tiktok ? { tiktok } : {}), ...(reddit ? { reddit } : {}) } : {}) };
    }),
    unsorted_accounts: real.filter((u) => !lib.org.accounts?.[u]?.folder).length,
    small_accounts_hidden: users.length - real.length,
    tags: Object.entries(tags).map(([tag, accounts]) => ({ tag: '#' + tag, accounts }))
  });
}));

server.registerTool('account_summary', {
  title: 'Account analytics',
  description: 'Analytics for one Instagram or TikTok account: median/total views, engagement, posting frequency, best posting day & time, hashtags that bring views, best video length, original vs licensed audio (TikTok: original sound vs music, top music, shares and saves per 100 views), and its top 10 videos. (Given r/name or u/name it returns subreddit_summary instead.)',
  inputSchema: { username: z.string().describe('Instagram username, with or without @; TikTok as tt/name or a tiktok.com/@name URL (or r/name, u/name)') },
  annotations: { readOnlyHint: true }
}, ({ username }) => safe(() => json(accountSummary(readLibrary(), normUser(username)))));

server.registerTool('top_reels', {
  title: 'Top reels',
  description: 'Rank Instagram reels and TikTok videos across accounts (a folder, a tag, a list of usernames, or everything). Each video is scored against its own account\'s median, so viral_score compares fairly across big and small accounts and across platforms. Every result has a platform field. For Reddit posts use top_posts.',
  inputSchema: {
    ...scope,
    platform: z.enum(['instagram', 'tiktok', 'all']).optional().describe('Default all (Instagram and TikTok)'),
    sort: z.enum(['viral_score', 'views', 'likes', 'comments', 'shares', 'saves', 'engagement', 'date', 'duration']).optional().describe('Default viral_score. saves: TikTok only'),
    since_days: z.number().positive().optional().describe('Only reels posted in the last N days'),
    min_views: z.number().min(0).optional(),
    limit: z.number().int().min(1).max(200).optional().describe('Default 20'),
    include_photos: z.boolean().optional().describe('Include photo/carousel posts (default false)'),
    include_small_accounts: z.boolean().optional().describe(`Include accounts with fewer than ${MIN_POSTS} saved posts (default false; accounts named in usernames/folder/tag are always included)`)
  },
  annotations: { readOnlyHint: true }
}, (args) => safe(() => json(topReels(readLibrary(), args))));

server.registerTool('search_reels', {
  title: 'Search reels and posts',
  description: 'Find Instagram reels and TikTok videos (caption, hashtags, audio title) and Reddit posts (title, text, flair) that contain all the given words. Results ranked by viral score (each against its own account\'s median).',
  inputSchema: { query: z.string().describe('Words or #hashtags'), ...scope, platform: z.enum(['instagram', 'tiktok', 'reddit', 'all']).optional().describe('Default all'), limit: z.number().int().min(1).max(200).optional(), include_small_accounts: z.boolean().optional() },
  annotations: { readOnlyHint: true }
}, (args) => safe(() => json(searchReels(readLibrary(), args))));

server.registerTool('get_reel', {
  title: 'Get one reel or post',
  description: 'Everything saved about one reel or video, including the full caption, the mp4 video_url and cover_url, and when those links expire. Accepts an Instagram shortcode or instagram.com/reel/… URL, a TikTok video id or tiktok.com/@name/video/… URL, or a Reddit post id or reddit.com/r/…/comments/… URL (full title and text).',
  inputSchema: { code: z.string().describe('Shortcode (e.g. DZPcVltsTAa), reel URL, TikTok video id / URL, or Reddit post id / URL') },
  annotations: { readOnlyHint: true }
}, ({ code }) => safe(() => {
  const p = findReel(readLibrary(), code);
  if (!p) return fail(`Reel ${code} is not in the library. If it belongs to a saved account, run collect_profile for that account; or refresh_reel to load just this one.`);
  const out = brief(p, { full: true });
  if (out.link_expired) out.hint = 'The video link has expired. Call refresh_reel to get a fresh one.';
  return json(out);
}));

function safeName(s) { return String(s || '').replace(/[^\w.-]+/g, '_').slice(0, 80) || 'instagram'; }

async function save(url, file, headers = {}) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 ReelScope', ...headers } });
  if (!res.ok) throw new Error(`HTTP ${res.status}${res.status === 403 || res.status === 410 ? ' (link expired: call refresh_reel)' : ''}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
  return (await fs.stat(file)).size;
}

server.registerTool('download_reel', {
  title: 'Download a reel',
  description: 'Save a reel\'s or TikTok video\'s file (mp4) and/or cover image to this computer and return the file paths, so the video can be analyzed (frames, audio, transcription). Default folder: ~/Downloads/ReelScope/<account>/. Files are named with their stats. TikTok: tries the saved link directly; TikTok usually refuses that without the browser session, so ReelScope then asks the extension to open the video in a small Chrome window and download it there (Chrome must be running; the file lands in Chrome\'s Downloads/ReelScope/tt_<name>/ folder and its path is returned).',
  inputSchema: {
    code: z.string().describe('Shortcode, reel URL, TikTok video id or URL'),
    what: z.enum(['video', 'cover', 'both']).optional().describe('Default video'),
    directory: z.string().optional().describe('Save here instead of ~/Downloads/ReelScope/<account>')
  }
}, ({ code, what = 'video', directory }) => safe(async () => {
  const p = findReel(readLibrary(), code);
  if (!p) return fail(`Reel ${code} is not in the library. Use refresh_reel or collect_profile first.`);
  if (p.platform === 'reddit') return fail('That is a Reddit post. ReelScope does not download Reddit media; use get_reel for its title, text and link.');
  if (p.platform === 'tiktok') return downloadTikTok(p, what, directory);
  const dir = directory ? resolve(directory.replace(/^~(?=$|\/)/, homedir())) : join(homedir(), 'Downloads', 'ReelScope', safeName(p.owner));
  await fs.mkdir(dir, { recursive: true });
  const base = M.fileBaseName(p);
  const saved = [];
  const problems = [];
  if (what === 'video' || what === 'both') {
    const files = (p.files || []);
    if (!files.length) problems.push('No video link saved for this reel yet. Call refresh_reel, then try again.');
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const exp = linkExpiry(f.url);
      if (exp && exp < Date.now()) { problems.push(`${f.kind} link expired ${new Date(exp).toISOString()}. Call refresh_reel, then try again.`); continue; }
      const ext = f.kind === 'video' ? 'mp4' : 'jpg';
      const file = join(dir, `${base}${files.length > 1 ? '_' + (i + 1) : ''}.${ext}`);
      try { saved.push({ kind: f.kind, path: file, bytes: await save(f.url, file) }); } catch (e) { problems.push(`${f.kind}: ${e.message}`); }
    }
  }
  if (what === 'cover' || what === 'both') {
    if (!p.thumb) problems.push('No cover link saved.');
    else {
      const file = join(dir, `${base}_cover.jpg`);
      try { saved.push({ kind: 'cover', path: file, bytes: await save(p.thumb, file) }); } catch (e) { problems.push(`cover: ${e.message}`); }
    }
  }
  if (!saved.length) return fail(problems.join('\n'));
  return json({ saved, problems: problems.length ? problems : undefined, reel: brief(p) });
}));

const TT_HEADERS = { referer: 'https://www.tiktok.com/', 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36' };

/** TikTok: try the saved links from here (with a tiktok.com referer); if TikTok refuses, let the extension download it in the browser. */
async function downloadTikTok(p, what, directory) {
  const dir = directory ? resolve(directory.replace(/^~(?=$|\/)/, homedir())) : join(homedir(), 'Downloads', 'ReelScope', safeName(p.owner));
  const base = M.fileBaseName(p);
  const saved = [];
  const problems = [];
  const want = [];
  if (what === 'video' || what === 'both') want.push('media');
  if (what === 'cover' || what === 'both') want.push('cover');
  const browserNeeded = [];
  for (const w of want) {
    const files = w === 'cover' ? (p.thumb ? [{ kind: 'cover', url: p.thumb }] : []) : (p.files || []);
    if (!files.length) { problems.push(w === 'cover' ? 'No cover link saved.' : 'No video link saved yet.'); browserNeeded.push(w); continue; }
    let ok = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const exp = linkExpiry(f.url);
      if (exp && exp < Date.now()) { problems.push(`${f.kind} link expired ${new Date(exp).toISOString()}.`); continue; }
      const ext = f.kind === 'video' ? 'mp4' : 'jpg';
      const file = join(dir, `${base}${w === 'cover' ? '_cover' : files.length > 1 ? '_' + (i + 1) : ''}.${ext}`);
      for (const url of [f.url, ...(f.alt || [])]) {
        try { await fs.mkdir(dir, { recursive: true }); saved.push({ kind: f.kind, path: file, bytes: await save(url, file, TT_HEADERS), via: 'direct' }); ok++; break; } catch (e) { problems.push(`${f.kind} (direct): ${e.message}`); }
      }
    }
    if (!ok) browserNeeded.push(w);
  }
  if (browserNeeded.length) {
    const cmd = await queueCommand('download_tiktok', { id: p.code, username: p.author || p.owner.slice(3), what: browserNeeded.length === 2 ? 'both' : browserNeeded[0] === 'cover' ? 'cover' : 'video' });
    const st = await waitForCommand(cmd.id, 100);
    if (st.state === 'done' && st.result?.ok) {
      (st.result.files || []).forEach((f) => saved.push({ kind: /_cover\.\w+$/.test(f.filename || '') ? 'cover' : 'video', path: f.filename || null, via: 'browser', state: f.state }));
      problems.length = 0;
      if (directory) problems.push(`Saved by Chrome to its own Downloads folder (not ${dir}).`);
    } else if (st.state === 'done') {
      problems.push('Browser: ' + (st.result?.error || (st.result?.errors || []).join(' ') || 'failed'));
    } else {
      problems.push(bridgeInfo().extension_connected ? `The extension is still downloading (command ${cmd.id}); check command_status.` : noExtensionHint());
    }
  }
  if (!saved.length) return fail(problems.join('\n'));
  return json({ saved, problems: problems.length ? problems : undefined, reel: brief(p) });
}

server.registerTool('collect_profile', {
  title: 'Collect a profile',
  description: 'Ask the ReelScope extension to open an Instagram profile\'s Reels tab in a background Chrome tab, scroll through it and load views and dates. New and existing accounts both work; results land in the library. Waits up to wait_seconds, then returns a command id you can check with command_status. Given tt/name or a tiktok.com/@name URL it collects that TikTok profile: the extension opens it in a small unfocused Chrome window and scrolls it for up to ~4 minutes, reading the videos TikTok loads (no TikTok API calls of its own; if TikTok shows a puzzle, the user has to solve it once). Given r/name or u/name it collects that subreddit / Reddit user instead (see collect_subreddit).',
  inputSchema: {
    username: z.string().describe('Instagram username, TikTok as tt/name or tiktok.com/@name (or r/name, u/name for Reddit)'),
    max_reels: z.number().int().min(12).max(2000).optional().describe('Stop after this many reels (default 300)'),
    wait_seconds: z.number().int().min(0).max(110).optional().describe('How long to wait for it to finish (default 45)')
  }
}, ({ username, max_reels = 300, wait_seconds = 45 }) => safe(async () => {
  const u = normUser(username);
  if (isRedditId(u)) return collectReddit({ id: u, max_posts: Math.min(1000, max_reels), wait_seconds });
  if (isTikTokId(u)) {
    const cmd = await queueCommand('collect_tiktok', { username: u.slice(3), maxPosts: max_reels });
    const st = await waitForCommand(cmd.id, wait_seconds);
    return json({ command_id: cmd.id, account: u, ...st, hint: st.state === 'done' ? (st.result?.note || undefined) : (bridgeInfo().extension_connected ? 'Still running (the extension scrolls the profile for up to ~4 minutes). Check again with command_status, or call account_summary later.' : noExtensionHint()) });
  }
  if (!/^[a-z0-9._]{1,30}$/.test(u)) return fail('That is not a valid Instagram username.');
  const cmd = await queueCommand('collect_profile', { username: u, maxReels: max_reels });
  const st = await waitForCommand(cmd.id, wait_seconds);
  const info = bridgeInfo();
  return json({ command_id: cmd.id, ...st, hint: st.state === 'done' ? undefined : (info.extension_connected ? 'Still running. Check again with command_status, or call account_summary later.' : noExtensionHint()) });
}));

async function collectReddit({ id, sort = 'top', time = 'year', max_posts = 500, wait_seconds = 60 }) {
  if (!isRedditId(id)) return fail('That is not a valid subreddit (r/name) or Reddit user (u/name).');
  const cmd = await queueCommand('collect_reddit', { kind: id.startsWith('u/') ? 'user' : 'subreddit', name: id.slice(2), sort, t: time, maxPosts: max_posts });
  const st = await waitForCommand(cmd.id, wait_seconds);
  const info = bridgeInfo();
  return json({ command_id: cmd.id, account: id, ...st, hint: st.state === 'done' ? (st.result?.note || undefined) : (info.extension_connected ? 'Still running (the extension scrolls the page for up to ~4 minutes). Check again with command_status, or call subreddit_summary later.' : noExtensionHint()) });
}

server.registerTool('collect_subreddit', {
  title: 'Collect a subreddit',
  description: 'Ask the ReelScope extension to collect a subreddit\'s (or a Reddit user\'s) posts with the user\'s logged-in Chrome: it opens the top posts of the year (default) in a small unfocused window, scrolls until no more load (up to max_posts, at most ~4 minutes) and reads every post. Reddit currently refuses its listing JSON, so this is page reading: no upvote ratio, and Reddit may load fewer posts while that window is hidden behind others. Read-only: never posts, comments or votes. Results land in the library as r/<name> or u/<name>.',
  inputSchema: {
    name: z.string().describe('Subreddit (excel, r/excel, or a reddit.com URL) or a user as u/name'),
    sort: z.enum(['top', 'new', 'hot', 'controversial']).optional().describe('Default top'),
    time: z.enum(['day', 'week', 'month', 'year', 'all']).optional().describe('For top/controversial. Default year'),
    max_posts: z.number().int().min(25).max(1000).optional().describe('Default 500'),
    wait_seconds: z.number().int().min(0).max(110).optional().describe('How long to wait for it to finish (default 60)')
  }
}, ({ name, sort, time, max_posts, wait_seconds }) => safe(() => collectReddit({ id: normSubreddit(name), sort, time, max_posts, wait_seconds })));

const redditScope = {
  folder: scope.folder,
  tag: scope.tag,
  subreddits: z.array(z.string()).optional().describe('Limit to these subreddits / users, e.g. ["excel", "r/spreadsheets", "u/someone"]')
};

server.registerTool('subreddit_summary', {
  title: 'Subreddit analytics',
  description: 'Analytics for one subreddit (or Reddit user): median score and comments, upvote ratio, best posting day & time, question vs statement titles, title length, words and phrases that perform, flairs, post types (text/image/video/link), and its top 10 posts.',
  inputSchema: { name: z.string().describe('Subreddit (excel, r/excel, URL) or u/name') },
  annotations: { readOnlyHint: true }
}, ({ name }) => safe(() => json(subredditSummary(readLibrary(), normSubreddit(name)))));

server.registerTool('top_posts', {
  title: 'Top Reddit posts',
  description: 'Rank Reddit posts across subreddits and users (a folder, a tag, a list, or every saved subreddit). Each post is scored against its own subreddit\'s median score, so small and big subreddits compare fairly.',
  inputSchema: {
    ...redditScope,
    sort: z.enum(['viral_score', 'score', 'comments', 'upvote_ratio', 'discussion', 'date']).optional().describe('Default viral_score. discussion = comments per score'),
    since_days: z.number().positive().optional().describe('Only posts from the last N days'),
    min_score: z.number().min(0).optional(),
    flair: z.string().optional().describe('Only posts with this flair (e.g. "solved")'),
    post_type: z.enum(['text', 'image', 'video', 'link', 'gallery', 'poll', 'crosspost']).optional(),
    questions_only: z.boolean().optional().describe('Only titles that ask a question'),
    limit: z.number().int().min(1).max(200).optional().describe('Default 20'),
    include_small_accounts: z.boolean().optional().describe(`Include subreddits with fewer than ${MIN_POSTS} saved posts (default false)`)
  },
  annotations: { readOnlyHint: true }
}, (args) => safe(() => json(topPosts(readLibrary(), args))));

server.registerTool('content_ideas', {
  title: 'Content ideas from Reddit',
  description: 'Find the most-upvoted questions and pain points in a set of subreddits (e.g. the user\'s Excel folder) and group them into themes, so they can become new short-video ideas. When the scope is a folder or tag, each theme also shows how many reels Instagram accounts in that folder already made about it (on_instagram), to spot gaps. Use the titles as hooks; open the URLs for the details people asked about.',
  inputSchema: {
    ...redditScope,
    since_days: z.number().positive().optional().describe('Only posts from the last N days (default 365)'),
    min_score: z.number().min(0).optional(),
    limit: z.number().int().min(1).max(100).optional().describe('How many ideas (default 20)'),
    include_small_accounts: z.boolean().optional()
  },
  annotations: { readOnlyHint: true }
}, (args) => safe(() => json(contentIdeas(readLibrary(), args))));

server.registerTool('mentions', {
  title: 'Reddit mentions',
  description: 'Reddit posts and comments that matched the user\'s keyword watches (TrackReddit-style "Mentions" inbox in ReelScope), newest first, plus the watch list with found/unread counts. Each mention: id (t3_/t1_), kind, watchId, query, title, excerpt, subreddit, author, permalink, createdAt, score, foundAt, source (extension | hayati = home server), read.',
  inputSchema: {
    watch: z.string().optional().describe('Watch id or (part of) its query'),
    since_days: z.number().positive().optional().describe('Only mentions created in the last N days'),
    since: z.string().optional().describe('Only mentions created after this ISO date'),
    unread_only: z.boolean().optional(),
    subreddit: z.string().optional(),
    kind: z.enum(['post', 'comment']).optional(),
    limit: z.number().int().min(1).max(500).optional().describe('Default 50')
  },
  annotations: { readOnlyHint: true }
}, (args) => safe(() => json(mentionsQuery(readLibrary(), args))));

server.registerTool('refresh_reel', {
  title: 'Refresh one reel',
  description: 'Ask the extension to open one reel or TikTok video in a background tab (TikTok: a small window) so its stats and video/cover links are refreshed (links expire after a few days). Use before download_reel when the link is expired.',
  inputSchema: { code: z.string().describe('Shortcode, reel URL, TikTok video id or URL'), wait_seconds: z.number().int().min(0).max(110).optional() }
}, ({ code, wait_seconds = 40 }) => safe(async () => {
  const tid = T.videoIdOf(code);
  if (tid) {
    const known = findReel(readLibrary(), tid);
    const m = String(code).match(/tiktok\.com\/@([A-Za-z0-9._]{1,30})/i);
    const username = known?.author || (m && m[1].toLowerCase()) || '';
    if (!username) return fail('Give the full TikTok URL (tiktok.com/@name/video/…): this video is not in the library yet, so the account is unknown.');
    const cmd = await queueCommand('refresh_tiktok', { id: tid, username });
    const st = await waitForCommand(cmd.id, wait_seconds);
    const p = findReel(readLibrary(), tid);
    return json({ command_id: cmd.id, ...st, reel: p ? brief(p, { full: true }) : null, hint: st.state === 'done' ? undefined : (bridgeInfo().extension_connected ? 'Still running; check command_status.' : noExtensionHint()) });
  }
  const c = String(code).trim().replace(/^.*\/(?:reels?|p)\/([\w-]+).*$/, '$1');
  if (!/^[\w-]{5,64}$/.test(c)) return fail('That is not a valid reel shortcode or URL.');
  const cmd = await queueCommand('refresh_reel', { code: c });
  const st = await waitForCommand(cmd.id, wait_seconds);
  const p = findReel(readLibrary(), c);
  return json({ command_id: cmd.id, ...st, reel: p ? brief(p, { full: true }) : null, hint: st.state === 'done' ? undefined : (bridgeInfo().extension_connected ? 'Still running; check command_status.' : noExtensionHint()) });
}));

server.registerTool('compare_platforms', {
  title: 'Compare Instagram and TikTok',
  description: 'Match the same videos posted to an Instagram account and a TikTok account (e.g. an "Excel Bug" series cross-posted to both) by caption similarity, hashtags, video length and posting date (±3 days; different episode numbers never match), and compare each pair side by side: views, engagement and × each account\'s own median. Summary: how many matched, typical TikTok ÷ Instagram views, which platform did better relative to its median, hits on both, and videos posted on only one side.',
  inputSchema: {
    account_ig: z.string().optional().describe('Instagram username (default: same handle as account_tt)'),
    account_tt: z.string().optional().describe('TikTok username, tt/name or tiktok.com/@name (default: same handle as account_ig)'),
    since_days: z.number().positive().optional().describe('Only videos from the last N days'),
    min_score: z.number().min(0.2).max(0.95).optional().describe('Match threshold 0–1 (default 0.45; raise it for stricter matches)'),
    limit: z.number().int().min(1).max(500).optional().describe('How many pairs to return (default 50)')
  },
  annotations: { readOnlyHint: true }
}, (args) => safe(() => json(comparePlatforms(readLibrary(), args))));

server.registerTool('command_status', {
  title: 'Command status',
  description: 'Check a collect_profile / collect_subreddit / refresh_reel / download_reel (TikTok) command started earlier.',
  inputSchema: { command_id: z.string() },
  annotations: { readOnlyHint: true }
}, ({ command_id }) => safe(async () => json(await readCommandState(command_id))));

server.registerTool('bridge_status', {
  title: 'Connection status',
  description: 'Whether the ReelScope extension is connected to this server and when the library was last synced.',
  inputSchema: {},
  annotations: { readOnlyHint: true }
}, () => safe(() => {
  const lib = readLibrary();
  const all = Object.keys(lib.accounts);
  return json({ ...bridgeInfo(), ports: PORTS, accounts: all.filter((u) => postCount(lib, u) >= MIN_POSTS).length, small_accounts_hidden: all.filter((u) => postCount(lib, u) < MIN_POSTS).length });
}));

// ---- start ----------------------------------------------------------------
let bridge = await startBridge();
// If another instance owns the bridge and later quits, take over.
setInterval(async () => {
  if (bridge.server) return;
  try {
    const r = await fetch(`http://127.0.0.1:${bridge.port}/health`, { signal: AbortSignal.timeout(1500) });
    if ((await r.json()).app === 'reelscope') return;
  } catch { /* gone */ }
  bridge = await startBridge();
}, 30000).unref();

await server.connect(new StdioServerTransport());
log('ready');
