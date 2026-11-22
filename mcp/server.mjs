#!/usr/bin/env node
// OpenOutlier MCP server (stdio). Gives AI agents read access to your OpenOutlier
// library, video files for analysis, and a way to ask the extension to
// collect or refresh profiles. That part stays on this computer. The optional
// "My account" tools (mcp/studio.mjs) talk to your own chatmany worker instead.
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
  M, MIN_POSTS, postCount, hiddenSmall, readLibrary, readStatus, postHistory, store, DB_FILE, selectAccounts, accountRow, accountSummary, topReels, searchReels,
  findReel, brief, normUser, normSubreddit, isRedditId, isTikTokId, isYouTubeId, youtubeIdOf, platformOf, subredditSummary, topPosts, contentIdeas, mentionsQuery,
  comparePlatforms, queueCommand, waitForCommand, readCommandState, linkExpiry, T
} from './library.mjs';
import { startJob, waitJob, isVideoId as isYouTubeVideoId, tildify, locateYtDlp, findExecutable, INSTALL_HINT } from './youtube-dl.mjs';
import { registerStudioTools, INSTRUCTIONS as STUDIO_INSTRUCTIONS } from './studio.mjs';
import { registerTranscriptTool } from './youtube-transcript.mjs';
import { registerAnalyticsTools, INSTRUCTIONS as YT_ANALYTICS_INSTRUCTIONS } from './youtube-analytics.mjs';
import { registerYouTubeApiTool, apiKeyInfo as youtubeApiKeyInfo, quota as youtubeApiQuota } from './youtube-api.mjs';
import { Tracker, trackerStatus } from './tracker.mjs';
import { registerNicheTools, INSTRUCTIONS as NICHE_INSTRUCTIONS, trackingSummary } from './niche-tools.mjs';
import { registerContentTools, INSTRUCTIONS as CONTENT_INSTRUCTIONS } from './content.mjs';
import { registerOwnTools } from './own-tools.mjs';
import { registerDiscoveryTools, INSTRUCTIONS as DISCOVERY_INSTRUCTIONS } from './discovery.mjs';
import { status as providerStatus } from './providers/index.mjs';

const log = (...a) => console.error('[openoutlier-mcp]', ...a);

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
  return 'The OpenOutlier extension has not contacted this server in the last few minutes. Make sure Chrome is open with OpenOutlier installed and "Connect to AI agents" turned on in its popup. The command stays queued for 20 minutes.';
}

const server = new McpServer(
  { name: 'openoutlier', version: '0.1.0' },
  {
    instructions: [
      'OpenOutlier is a local library of Instagram Reels, TikTok videos, YouTube videos and Shorts, and Reddit posts the user collected with the OpenOutlier browser extension.',
      'Start with list_accounts (or list_folders_and_tags) to see what is saved. Accounts are organized in folders and tags by the user; a folder can mix Instagram accounts (username), TikTok accounts (tt/username), YouTube channels (yt/handle, or yt/UC… for a channel without a handle) and subreddits (r/name) / Reddit users (u/name). The same handle can exist on several platforms: "name" is Instagram, "tt/name" is TikTok, "yt/name" is YouTube.',
      'Instagram, TikTok and YouTube: x_account_median = views ÷ that account\'s median views. YouTube Shorts and long-form videos have separate medians inside one channel (a Short is compared with the channel\'s Shorts, a video or past live stream with its long-form videos). Reddit: the same with score (upvotes) ÷ the subreddit\'s (or user\'s) median score. viral_score = 50 + 25·log2(x), capped 0–100. ≥2× is an outlier. TikTok engagement counts likes + comments + shares + saves (TikTok shows them publicly); Instagram and YouTube count likes + comments.',
      'YouTube channel pages show rounded views ("63K") and relative dates ("3 weeks ago"): views_exact and date ("exact" | "day" | "approximate") say which. refresh_reel opens a video\'s watch page for exact views, likes, comments, date, chapters and the most-replayed heatmap; download_reel does the same through yt-dlp. Best posting times use exact dates only.',
      'compare_platforms matches the same short videos posted to Instagram and TikTok, or a YouTube channel\'s Shorts and Instagram or TikTok (caption / title, hashtags, length, date ±3 days) and shows how each did on both, relative to each account\'s median (the Shorts median for YouTube).',
      'Reddit tools: subreddit_summary (one subreddit: best times, title analysis, flair, post types), top_posts (rank posts across subreddits), content_ideas (most-upvoted questions and pain points in a folder of subreddits, with how much Instagram competitors in that folder already cover each theme — use it to turn Reddit demand into new reel ideas).',
      'To analyze a video itself, use download_reel to save the mp4 locally and work with the returned file path. Instagram CDN links expire after a few days; refresh_reel gets fresh ones. YouTube videos are downloaded by yt-dlp on this computer (bridge_status says whether yt-dlp and ffmpeg are installed).',
      'mentions: Reddit posts and comments that matched the user\'s keyword watches (checked every ~15 min by the extension, and 24/7 by the optional reddit-watch home server; source tells which).',
      'collect_profile / collect_subreddit ask the extension to collect an Instagram profile, a TikTok profile (tt/name), a YouTube channel (yt/name: its Videos tab, then its Shorts tab) or a subreddit in a background Chrome tab or small window (logged-in session); they need Chrome running.',
      STUDIO_INSTRUCTIONS,
      'YouTube extras (optional, each off until the user sets it up): get_transcript (captions via yt-dlp, with the first ~30 s as hook), youtube_api_stats (exact stats through the user\'s own YouTube Data API key; makes no request without one).',
      YT_ANALYTICS_INSTRUCTIONS,
      NICHE_INSTRUCTIONS,
      CONTENT_INSTRUCTIONS,
      DISCOVERY_INSTRUCTIONS
    ].join('\n')
  }
);

const scope = {
  folder: z.string().optional().describe('Folder name (as shown in the OpenOutlier library)'),
  tag: z.string().optional().describe('Tag, with or without #'),
  usernames: z.array(z.string()).optional().describe('Limit to these accounts')
};

server.registerTool('list_accounts', {
  title: 'List saved accounts',
  description: 'All accounts saved in the OpenOutlier library — Instagram profiles (username), TikTok profiles (tt/username), YouTube channels (yt/handle), subreddits (r/name) and Reddit users (u/name) — with platform, folder, tags, post count, median views (Instagram, TikTok; YouTube: separate long-form and Shorts medians) or median score (Reddit) and outliers. Filter by folder, tag or platform.',
  inputSchema: {
    folder: scope.folder,
    tag: scope.tag,
    platform: z.enum(['instagram', 'tiktok', 'youtube', 'reddit', 'all']).optional().describe('Default all'),
    include_small_accounts: z.boolean().optional().describe(`Also list accounts with fewer than ${MIN_POSTS} saved posts (usually single reels picked up while scrolling the feed). Default false.`)
  },
  annotations: { readOnlyHint: true }
}, ({ folder, tag, platform, include_small_accounts = false }) => safe(() => {
  const lib = readLibrary();
  const rows = selectAccounts(lib, { folder, tag, platform, includeSmall: include_small_accounts }).map((u) => accountRow(lib, u))
    .sort((a, b) => (b.posts_saved - a.posts_saved) || ((b.median_views || b.median_views_long_form || 0) - (a.median_views || a.median_views_long_form || 0)));
  const hidden = include_small_accounts ? 0 : hiddenSmall(lib, { folder, tag, platform });
  return json({ ...bridgeInfo(), count: rows.length, hidden_small_accounts: hidden || undefined, accounts: rows });
}));

server.registerTool('list_folders_and_tags', {
  title: 'List folders and tags',
  description: 'The folders and tags the user created in the OpenOutlier library, with how many accounts each has.',
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
      const youtube = inF.filter((u) => platformOf(lib, u) === 'youtube').length;
      return { name: f.name, accounts: inF.length, ...(reddit || tiktok || youtube ? { instagram: inF.length - reddit - tiktok - youtube, ...(tiktok ? { tiktok } : {}), ...(youtube ? { youtube } : {}), ...(reddit ? { reddit } : {}) } : {}) };
    }),
    unsorted_accounts: real.filter((u) => !lib.org.accounts?.[u]?.folder).length,
    small_accounts_hidden: users.length - real.length,
    tags: Object.entries(tags).map(([tag, accounts]) => ({ tag: '#' + tag, accounts }))
  });
}));

server.registerTool('account_summary', {
  title: 'Account analytics',
  description: 'Analytics for one Instagram, TikTok or YouTube account: median/total views, engagement, posting frequency, best posting day & time, hashtags that bring views, best video length, original vs licensed audio (TikTok: original sound vs music, top music, shares and saves per 100 views), and its top 10 videos. Instagram also returns carousels_and_photos (no public views, so scored by likes against their own median: formats, carousel length, best times, top posts) and comment stats for both (median comments, comments per 100 likes, "comment KEYWORD" posts vs the rest, each keyword, most commented posts), plus followers and posts_on_profile once the profile was collected. YouTube channels get two sections, long_form and shorts, each against its own median (plus title words, exact vs approximate dates; best times from exact dates only). (Given r/name or u/name it returns subreddit_summary instead.)',
  inputSchema: { username: z.string().describe('Instagram username, with or without @; TikTok as tt/name or a tiktok.com/@name URL; YouTube as yt/name, a youtube.com/@name or /channel/UC… URL (or r/name, u/name)') },
  annotations: { readOnlyHint: true }
}, ({ username }) => safe(() => json(accountSummary(readLibrary(), normUser(username)))));

server.registerTool('top_reels', {
  title: 'Top reels',
  description: 'Rank Instagram reels, TikTok videos and YouTube videos and Shorts across accounts (a folder, a tag, a list of usernames, or everything). post_type: "carousels_photos" ranks Instagram carousels and photos instead (scored by likes, since Instagram shows no views on them), "all" ranks both together. Each video is scored against its own account\'s median (YouTube: the channel\'s Shorts median for Shorts, its long-form median for videos), so viral_score compares fairly across big and small accounts and across platforms. Every result has a platform field. For Reddit posts use top_posts.',
  inputSchema: {
    ...scope,
    platform: z.enum(['instagram', 'tiktok', 'youtube', 'all']).optional().describe('Default all (Instagram, TikTok and YouTube)'),
    format: z.enum(['shorts', 'long_form']).optional().describe('YouTube only: just Shorts or just long-form videos (and past live streams)'),
    sort: z.enum(['viral_score', 'views', 'likes', 'comments', 'comments_x_median', 'shares', 'saves', 'engagement', 'date', 'duration']).optional().describe('Default viral_score. saves: TikTok only. comments_x_median: comments ÷ the account\'s median comments for that format'),
    post_type: z.enum(['reels', 'carousels_photos', 'all']).optional().describe('Default reels (videos). carousels_photos: Instagram carousels and photos, ranked by likes. all: both'),
    since_days: z.number().positive().optional().describe('Only reels posted in the last N days'),
    min_views: z.number().min(0).optional(),
    limit: z.number().int().min(1).max(200).optional().describe('Default 20'),
    include_photos: z.boolean().optional().describe('Same as post_type "all" (kept for older prompts)'),
    include_small_accounts: z.boolean().optional().describe(`Include accounts with fewer than ${MIN_POSTS} saved posts (default false; accounts named in usernames/folder/tag are always included)`)
  },
  annotations: { readOnlyHint: true }
}, (args) => safe(() => json(topReels(readLibrary(), args))));

server.registerTool('search_reels', {
  title: 'Search reels and posts',
  description: 'Find Instagram reels and TikTok videos (caption, hashtags, audio title), YouTube videos and Shorts (title, hashtags, tags, description) and Reddit posts (title, text, flair) that contain all the given words. Results ranked by viral score (each against its own account\'s median).',
  inputSchema: { query: z.string().describe('Words or #hashtags'), ...scope, platform: z.enum(['instagram', 'tiktok', 'youtube', 'reddit', 'all']).optional().describe('Default all'), format: z.enum(['shorts', 'long_form']).optional().describe('YouTube only: just Shorts or just long-form videos'), limit: z.number().int().min(1).max(200).optional(), include_small_accounts: z.boolean().optional() },
  annotations: { readOnlyHint: true }
}, (args) => safe(() => json(searchReels(readLibrary(), args))));

server.registerTool('get_reel', {
  title: 'Get one reel or post',
  description: 'Everything saved about one reel or video, including the full caption, the mp4 video_url and cover_url, and when those links expire. Accepts an Instagram shortcode or instagram.com/reel/… URL, a TikTok video id or tiktok.com/@name/video/… URL, a YouTube video id or youtube.com/watch?v=… / /shorts/… / youtu.be/… URL (format short/video/live, exact or rounded views, exact or approximate date, description, category, tags, chapters, the most-replayed heatmap and its peaks, captions), or a Reddit post id or reddit.com/r/…/comments/… URL (full title and text).',
  inputSchema: { code: z.string().describe('Shortcode (e.g. DZPcVltsTAa), reel URL, TikTok video id / URL, YouTube video id / URL, or Reddit post id / URL') },
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
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 OpenOutlier', ...headers } });
  if (!res.ok) throw new Error(`HTTP ${res.status}${res.status === 403 || res.status === 410 ? ' (link expired: call refresh_reel)' : ''}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
  return (await fs.stat(file)).size;
}

server.registerTool('download_reel', {
  title: 'Download a reel',
  description: 'Save a reel\'s or TikTok / YouTube video\'s file (mp4) and/or cover image to this computer and return the file paths, so the video can be analyzed (frames, audio, transcription). Default folder: ~/Downloads/OpenOutlier/<account>/. Files are named with their stats. TikTok: tries the saved link directly; TikTok usually refuses that without the browser session, so OpenOutlier then asks the extension to open the video in a small Chrome window and download it there (Chrome must be running; the file lands in Chrome\'s Downloads/OpenOutlier/tt_<name>/ folder and its path is returned). YouTube (a video id in the library, or any youtube.com/watch, /shorts/ or youtu.be URL): runs yt-dlp on this computer (needs `brew install yt-dlp ffmpeg`), also saves yt-dlp\'s .info.json next to the video, and back-fills the library with exact views, likes, comments, upload time, tags, chapters and the most-replayed heatmap; returns those stats. Long videos can take minutes: if it is not finished within wait_seconds you get state "running" — call download_reel again with the same code to keep waiting.',
  inputSchema: {
    code: z.string().describe('Shortcode, reel URL, TikTok video id or URL, YouTube video id or URL'),
    what: z.enum(['video', 'cover', 'both']).optional().describe('Default video'),
    directory: z.string().optional().describe('Save here instead of ~/Downloads/OpenOutlier/<account>'),
    wait_seconds: z.number().int().min(0).max(110).optional().describe('YouTube only: how long to wait for yt-dlp before returning "running" (default 100)')
  }
}, ({ code, what = 'video', directory, wait_seconds = 100 }) => safe(async () => {
  const ytUrlId = youtubeIdOf(code);
  const p = findReel(readLibrary(), ytUrlId || code);
  if (ytUrlId && (!p || p.platform === 'youtube')) return downloadYouTubeTool(ytUrlId, p, what, directory, wait_seconds);
  if (!p) return fail(`Reel ${code} is not in the library. Use refresh_reel or collect_profile first.${isYouTubeVideoId(String(code).trim()) ? ' For a YouTube video that is not saved yet, pass its full URL (youtube.com/watch?v=… or /shorts/…).' : ''}`);
  if (p.platform === 'youtube') return downloadYouTubeTool(p.code, p, what, directory, wait_seconds);
  if (p.platform === 'reddit') return fail('That is a Reddit post. OpenOutlier does not download Reddit media; use get_reel for its title, text and link.');
  if (p.platform === 'tiktok') return downloadTikTok(p, what, directory);
  const dir = directory ? resolve(directory.replace(/^~(?=$|\/)/, homedir())) : join(homedir(), 'Downloads', 'OpenOutlier', safeName(p.owner));
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

/** YouTube: yt-dlp through mcp/youtube-dl.mjs (the same jobs the bridge runs for the extension). */
async function downloadYouTubeTool(id, p, what, directory, waitSeconds) {
  const started = startJob({ id, what, directory: directory || undefined, prev: p ? { code: p.code, platform: 'youtube', owner: p.owner, type: p.type } : undefined });
  const st = await waitJob(started.job, waitSeconds);
  if (st.state === 'queued' || st.state === 'running') {
    return json({ state: st.state, job: st.job, progress: st.label, percent: st.percent, hint: 'yt-dlp is still working. Call download_reel again with the same code and what to keep waiting (it joins this download).' });
  }
  if (st.state !== 'done') {
    const e = st.error || {};
    return fail([e.message || 'yt-dlp failed.', e.hint].filter(Boolean).join('\n'));
  }
  const q = st.post || {};
  const stats = {
    views: q.views ?? null, likes: q.likes ?? null, comments: q.comments ?? null,
    published: q.takenAt ? new Date(q.takenAt).toISOString() : null, date_exact: q.dateApprox === false,
    duration_s: q.duration ?? null, type: q.type || null, category: q.category || null, tags: q.keywords || [],
    chapters: q.chapters || [], most_replayed_at_s: q.heatmapPeaks || [],
    heatmap: q.heatmap ? { step_s: q.heatmapStep ?? null, values: q.heatmap } : null
  };
  return json({
    saved: st.files.map((f) => ({ kind: f.kind, path: f.path, bytes: f.bytes })),
    folder: st.dir ? tildify(st.dir) : null,
    via: 'yt-dlp',
    library_updated: !!(q.owner && readLibrary().accounts[q.owner]?.posts?.[q.code]),
    stats,
    title: q.caption || null, account: q.owner || null, url: q.url || null
  });
}

const TT_HEADERS = { referer: 'https://www.tiktok.com/', 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36' };

/** TikTok: try the saved links from here (with a tiktok.com referer); if TikTok refuses, let the extension download it in the browser. */
async function downloadTikTok(p, what, directory) {
  const dir = directory ? resolve(directory.replace(/^~(?=$|\/)/, homedir())) : join(homedir(), 'Downloads', 'OpenOutlier', safeName(p.owner));
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
  description: 'Ask the OpenOutlier extension to collect an Instagram profile in a background Chrome tab: it pages the profile\'s feed, newest first (reels, carousels and photos together, about 33 per request), with views, likes, comments, dates, slides and files, and notes its followers and how many posts it has. New and existing accounts both work; results land in the library, and the result counts reels, carousels and photos. Waits up to wait_seconds, then returns a command id you can check with command_status. Given tt/name or a tiktok.com/@name URL it collects that TikTok profile: the extension opens it in a small unfocused Chrome window and scrolls it for up to ~4 minutes, reading the videos TikTok loads (no TikTok API calls of its own; if TikTok shows a puzzle, the user has to solve it once). Given yt/name, a youtube.com/@name or /channel/UC… URL it collects that YouTube channel: the extension opens its Videos tab in a small unfocused Chrome window, scrolls it (up to ~3 minutes, max_reels videos), then does the same on its Shorts tab, reading what YouTube loads (no YouTube API calls of its own). Views from channel tabs are YouTube\'s rounded ones and dates are relative ("3 weeks ago"); use refresh_reel on the videos that matter for exact numbers. Given r/name or u/name it collects that subreddit / Reddit user instead (see collect_subreddit).',
  inputSchema: {
    username: z.string().describe('Instagram username, TikTok as tt/name or tiktok.com/@name, YouTube as yt/name or youtube.com/@name (or r/name, u/name for Reddit)'),
    max_reels: z.number().int().min(12).max(2000).optional().describe('Stop after this many posts (default 300; Instagram counts reels, carousels and photos together; YouTube: per tab)'),
    youtube_tabs: z.array(z.enum(['videos', 'shorts', 'streams'])).optional().describe('YouTube only: which channel tabs to collect, in order (default ["videos", "shorts"])'),
    wait_seconds: z.number().int().min(0).max(110).optional().describe('How long to wait for it to finish (default 45)')
  }
}, ({ username, max_reels = 300, wait_seconds = 45, youtube_tabs }) => safe(async () => {
  const u = normUser(username);
  if (isRedditId(u)) return collectReddit({ id: u, max_posts: Math.min(1000, max_reels), wait_seconds });
  if (isYouTubeId(u)) {
    const tabs = [...new Set(youtube_tabs?.length ? youtube_tabs : ['videos', 'shorts'])];
    const cmd = await queueCommand('collect_youtube', { id: u, maxPosts: max_reels, tabs });
    const st = await waitForCommand(cmd.id, wait_seconds);
    return json({ command_id: cmd.id, account: u, ...st, hint: st.state === 'done' ? (st.result?.note || undefined) : (bridgeInfo().extension_connected ? `Still running (the extension scrolls each channel tab for up to ~3 minutes: ${tabs.join(', ')}). Check again with command_status, or call account_summary later.` : noExtensionHint()) });
  }
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
  description: 'Ask the OpenOutlier extension to collect a subreddit\'s (or a Reddit user\'s) posts with the user\'s logged-in Chrome: it opens the top posts of the year (default) in a small unfocused window, scrolls until no more load (up to max_posts, at most ~4 minutes) and reads every post. Reddit currently refuses its listing JSON, so this is page reading: no upvote ratio, and Reddit may load fewer posts while that window is hidden behind others. Read-only: never posts, comments or votes. Results land in the library as r/<name> or u/<name>.',
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
  description: 'Reddit posts and comments that matched the user\'s keyword watches (TrackReddit-style "Mentions" inbox in OpenOutlier), newest first, plus the watch list with found/unread counts. Each mention: id (t3_/t1_), kind, watchId, query, title, excerpt, subreddit, author, permalink, createdAt, score, foundAt, source (extension | hayati = home server), read.',
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
  description: 'Ask the extension to open one reel, TikTok video or YouTube video in a background tab (TikTok: a small window) so its stats and video/cover links are refreshed (links expire after a few days). Use before download_reel when the link is expired. YouTube: opens the watch (or Shorts) page and saves exact views, likes, comments, publish date, chapters and the most-replayed heatmap in place of the channel page\'s rounded counts; works for videos not in the library yet when given their URL.',
  inputSchema: { code: z.string().describe('Shortcode, reel URL, TikTok video id or URL, YouTube video id (if saved) or URL'), wait_seconds: z.number().int().min(0).max(110).optional() }
}, ({ code, wait_seconds = 40 }) => safe(async () => {
  const yid = youtubeIdOf(code);
  const savedYt = !yid && isYouTubeVideoId(String(code).trim()) ? findReel(readLibrary(), String(code).trim()) : null;
  if (yid || savedYt?.platform === 'youtube') {
    const id = yid || savedYt.code;
    const known = savedYt || findReel(readLibrary(), id);
    const type = known?.type || (/\/shorts\//i.test(String(code)) ? 'short' : 'video');
    const cmd = await queueCommand('refresh_youtube', { id, type });
    const st = await waitForCommand(cmd.id, wait_seconds);
    const p = findReel(readLibrary(), id);
    return json({ command_id: cmd.id, ...st, reel: p ? brief(p, { full: true }) : null, hint: st.state === 'done' ? undefined : (bridgeInfo().extension_connected ? 'Still running; check command_status.' : noExtensionHint()) });
  }
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
  title: 'Compare Instagram, TikTok and YouTube Shorts',
  description: 'Match the same short videos posted to two accounts on different platforms (e.g. an "Excel Bug" series cross-posted): Instagram ↔ TikTok, or a YouTube channel\'s Shorts ↔ Instagram or TikTok. Matched by caption / Shorts title similarity, hashtags, video length and posting date (±3 days; different episode numbers never match), then compared side by side: views, engagement and × each account\'s own median (YouTube: the channel\'s Shorts median; long-form videos are left out). YouTube dates only count when exact or day-precise; Shorts without one (the Shorts tab shows no dates) only match on clearly similar titles, and the summary says how many. Summary: how many matched, typical views ratio, which platform did better relative to its median, hits on both, and videos posted on only one side.',
  inputSchema: {
    account_ig: z.string().optional().describe('Instagram username (default: same handle as the other account)'),
    account_tt: z.string().optional().describe('TikTok username, tt/name or tiktok.com/@name (default: same handle as account_ig)'),
    account_yt: z.string().optional().describe('YouTube channel: yt/handle, yt/UC… or youtube.com/@handle. Compare its Shorts with account_ig or account_tt (default: the same handle on Instagram, else TikTok)'),
    since_days: z.number().positive().optional().describe('Only videos from the last N days'),
    min_score: z.number().min(0.2).max(0.95).optional().describe('Match threshold 0–1 (default 0.45; raise it for stricter matches)'),
    limit: z.number().int().min(1).max(500).optional().describe('How many pairs to return (default 50)')
  },
  annotations: { readOnlyHint: true }
}, (args) => safe(() => json(comparePlatforms(readLibrary(), args))));

server.registerTool('organize_library', {
  title: 'Organize the Library (folders, tags, tracking)',
  description: 'Change the user\'s Library organisation through the extension (it owns folders, tags and the niche tracking list): create folders, move accounts into folders (by name; a missing folder is created), add or remove tags, mark a folder as a tracked niche, and track a YouTube channel (yt/handle, with its UC id) inside a niche. Nothing is deleted. A folder marked as a tracked niche tracks every YouTube channel in it (niche tracking: RSS every 15 min, Data API measurements, a one-time 500-upload backfill per new channel), so moving channels into a niche folder starts tracking them; the niche is the folder\'s name. Tags follow the Library\'s rule (lower case, letters, digits, _ and -). Show the user the plan before a large reorganisation. Waits up to wait_seconds for the extension (it checks for commands every 30 s).',
  inputSchema: {
    ops: z.array(z.union([
      z.object({ op: z.literal('folder'), name: z.string().min(1).max(60) }),
      z.object({ op: z.literal('move'), account: z.string().min(1).max(120), folder: z.string().max(60).nullable() }),
      z.object({ op: z.literal('tag'), account: z.string().min(1).max(120), add: z.array(z.string().max(40)).optional(), remove: z.array(z.string().max(40)).optional() }),
      z.object({ op: z.literal('niche'), folder: z.string().min(1).max(60), on: z.boolean().optional() }),
      z.object({ op: z.literal('track'), account: z.string().regex(/^yt\//), channelId: z.string().regex(/^UC[A-Za-z0-9_-]{22}$/).optional(), name: z.string().max(120).optional(), niche: z.string().max(80).optional(), on: z.boolean().optional() })
    ])).min(1).max(500),
    wait_seconds: z.number().int().min(0).max(110).optional().describe('How long to wait for the extension (default 60)')
  }
}, ({ ops, wait_seconds = 60 }) => safe(async () => {
  const cmd = await queueCommand('org_edit', { ops });
  const st = await waitForCommand(cmd.id, wait_seconds);
  return json({ command_id: cmd.id, ...st, hint: st.state === 'done' ? undefined : (bridgeInfo().extension_connected ? 'Not applied yet: the extension checks every 30 s. Check with command_status.' : noExtensionHint()) });
}));

server.registerTool('command_status', {
  title: 'Command status',
  description: 'Check a collect_profile / collect_subreddit / refresh_reel / download_reel (TikTok) command started earlier. (YouTube downloads are not commands: call download_reel again with the same code.)',
  inputSchema: { command_id: z.string() },
  annotations: { readOnlyHint: true }
}, ({ command_id }) => safe(async () => json(await readCommandState(command_id))));

server.registerTool('bridge_status', {
  title: 'Connection status',
  description: 'Whether the OpenOutlier extension is connected to this server, when the library was last synced, the last backup, whether yt-dlp + ffmpeg (for YouTube video downloads) are installed, the YouTube Data API key and today\'s quota use (bridge + extension together), the feature switches the user changed, the background tracker (jobs, last heartbeat) and niche tracking (channels, last RSS read, breakouts in the last 7 days, and rss_lag: how far RSS view counts trail the Data API, with how_to_read).',
  inputSchema: {},
  annotations: { readOnlyHint: true }
}, () => safe(() => {
  const lib = readLibrary();
  const all = Object.keys(lib.accounts);
  const st = readStatus();
  const iso = (t) => (t ? new Date(t).toISOString() : null);
  return json({
    ...bridgeInfo(), ports: PORTS,
    accounts: all.filter((u) => postCount(lib, u) >= MIN_POSTS).length,
    small_accounts_hidden: all.filter((u) => postCount(lib, u) < MIN_POSTS).length,
    database: { file: DB_FILE, ...store().stats() },
    last_backup: st.lastBackupAt ? { at: iso(st.lastBackupAt), ok: !!st.lastBackupOk, file: st.lastBackupFile || null, remote: st.lastBackupRemote || null, error: st.lastBackupError || undefined } : null,
    youtube_downloads: (() => {
      const y = locateYtDlp();
      const ff = findExecutable('ffmpeg');
      return { yt_dlp: y.bin || null, ffmpeg: ff, ready: !!(y.bin && ff), hint: y.bin && ff ? undefined : (y.error ? y.error.message + ' ' : '') + INSTALL_HINT };
    })(),
    // One count for the key's Google Cloud project: this bridge's calls plus the extension's (it reports them with its settings).
    youtube_data_api: (() => { const k = youtubeApiKeyInfo(); return { configured: !!k.key, key_source: k.source || undefined, ...youtubeApiQuota() }; })(),
    features: (() => { const f = store().getMeta('features', null); return f ? { off: Object.keys(f).filter((k) => f[k] === false), on: Object.keys(f).filter((k) => f[k] === true), note: 'Only the ones changed from the default (src/features.js).' } : { note: 'The extension has not sent its feature settings yet; the defaults apply.' }; })(),
    tracker: tracker ? tracker.status() : trackerStatus(store()),
    // Niche tracking: channels, last RSS read, breakouts, and the RSS-vs-API lag check (rss_lag.how_to_read).
    niche_tracking: (() => { try { return trackingSummary(store()); } catch (e) { return { error: e.message }; } })(),
    // Phase 5: the optional third-party providers (on / key set / scraping-based), never the keys.
    providers: (() => { try { return providerStatus(store()); } catch (e) { return { error: e.message }; } })()
  });
}));

server.registerTool('reel_history', {
  title: 'Reel history',
  description: 'How one post\'s views, likes, comments, shares and saves changed over time. OpenOutlier records a dated snapshot every time it sees new numbers, so this shows growth (e.g. first 48 hours vs. later). Accepts a shortcode, TikTok or YouTube video id, or post URL.',
  inputSchema: { code: z.string().describe('Shortcode, video id or URL') },
  annotations: { readOnlyHint: true }
}, ({ code }) => safe(() => {
  const p = findReel(readLibrary(), code);
  if (!p) return fail(`Post ${code} is not in the library.`);
  const rows = postHistory(p.code);
  const posted = p.takenAt || null;
  return json({
    reel: brief(p),
    snapshots: rows.map((r) => ({
      seen_at: new Date(r.seen_at).toISOString(),
      hours_since_posted: posted ? Math.round((r.seen_at - posted) / 36e5 * 10) / 10 : null,
      views: r.views, likes: r.likes, comments: r.comments, shares: r.shares, saves: r.saves
    })),
    note: rows.length < 2 ? 'Only one snapshot so far. History grows each time the extension sees this post again with new numbers.' : undefined
  });
}));

registerStudioTools(server, { z, json, safe });
registerYouTubeApiTool(server, { z, json, safe });
registerNicheTools(server, { z, json, safe, store });
registerContentTools(server, { z, json, safe, store });
registerDiscoveryTools(server, { z, json, safe, store });
registerOwnTools(server, { z, json, safe, store });
registerTranscriptTool(server, { z, json, safe, fail, youtubeIdOf, findReel, readLibrary });
// The bridge port Google's sign-in redirects to; it must be a bridge that knows the callback.
registerAnalyticsTools(server, { z, json, safe, bridgePort: async () => {
  const port = readStatus().bridgePort;
  if (!port) return null;
  try {
    const h = await (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) })).json();
    if (h.app === 'reelscope' && (h.features || []).includes('youtube-analytics')) return port;
    throw new Error('The OpenOutlier bridge that is running is older than this server and can\'t finish a Google sign-in. Restart it: launchctl kickstart -k gui/$(id -u)/dev.openoutlier.bridge (or restart Claude if it runs the bridge).');
  } catch (e) {
    if (/older than/.test(e.message)) throw e;
    return null;
  }
} });

// ---- start ----------------------------------------------------------------
let bridge = await startBridge();
// Background jobs (mcp/tracker.mjs) run where the bridge port is held; a lease in the database keeps it to one process.
var tracker = null;
function startTracker() {
  if (!tracker && bridge.server) tracker = new Tracker({ store: store(), log: (...a) => log('[tracker]', ...a) }).start();
}
startTracker();
// If another instance owns the bridge and later quits, take over.
setInterval(async () => {
  if (bridge.server) return;
  try {
    const r = await fetch(`http://127.0.0.1:${bridge.port}/health`, { signal: AbortSignal.timeout(1500) });
    if ((await r.json()).app === 'reelscope') return;
  } catch { /* gone */ }
  bridge = await startBridge();
  startTracker();
}, 30000).unref();

await server.connect(new StdioServerTransport());
log('ready');
