// OpenOutlier MCP – x_ideas (docs/x-plan.md 5.2 and 7, phase 4): where the user's next X post can come
// from, read from the Library only (src/x-ideas.js, the same code as the Library's "X ideas" page):
//   • the niche's ≥3× X outliers of the last 30 days (folders marked "X niche", rs:org.xNiche)
//   • the user's own Reels / TikToks / Shorts / YouTube videos that beat their own median (rs:org.xIdeas.own)
//   • Reddit demand: questions and pain points that did well (rs:org.xIdeas.subreddits, else the niche folders')
// The fourth source of the plan, "build in public", has no tool: Claude reads the user's own repositories
// (commits, releases) itself, when the user asks. Read-only; nothing is posted.
import { createRequire } from 'node:module';
import { readLibrary as defaultReadLibrary, normUser, normSubreddit } from './library.mjs';
import { ownXId } from './x-data.mjs';

const require = createRequire(import.meta.url);
const I = require('../src/x-ideas.js');

export const INSTRUCTIONS = 'X ideas (x_ideas): starting points for the user\'s own X posts from what the Library already holds — the niche\'s ≥3× X outliers of the last 30 days (what worked: link or take the idea, never copy or lightly reword someone else\'s post), the user\'s own Reels / TikToks / Shorts / YouTube outliers (their own content, fine to adapt into a post or thread), and Reddit questions and pain points. For "build in public" ideas, read the user\'s own repositories (recent commits, releases, changelogs) yourself when they ask: what they shipped and learned this week. Every idea ends as a draft the user writes and posts themselves.';

/** x_ideas over a Library. args: { only, days, min_ratio, own, subreddits, limit }; exclude: X ids left out of the niche (the user's own). */
export function xIdeasFor(lib, args = {}, now = Date.now(), exclude = []) {
  const opts = { now, only: args.only && args.only !== 'all' ? args.only : undefined, exclude };
  if (args.days) opts.days = args.days;
  if (args.min_ratio) opts.nicheMin = args.min_ratio;
  if (args.limit) opts.limit = args.limit;
  if (Array.isArray(args.own) && args.own.length) opts.own = args.own.map((a) => normUser(a));
  if (Array.isArray(args.subreddits) && args.subreddits.length) opts.subreddits = args.subreddits.map((s) => normSubreddit(s));
  const out = I.ideas(lib, opts);
  out.own_accounts_setting = I.settingsOf(lib.org).own;
  if (out.crossPlatform && !out.crossPlatform.accounts.length && !opts.own) {
    out.crossPlatform.candidates = I.ownCandidates(lib).slice(0, 15);
    out.crossPlatform.note = 'No own accounts chosen yet. Ask which of these are the user\'s (pass own: [...]), or they pick them on the Library\'s X ideas page.';
  }
  return out;
}

export function registerXIdeasTools(server, { z, json, safe, store, readLibrary = defaultReadLibrary }) {
  server.registerTool('x_ideas', {
    title: 'X post ideas (niche outliers, own content, Reddit demand)',
    description: 'Ideas for the user\'s next X posts, from the Library only: (1) niche — X posts from the user\'s X niche (folders marked "X niche", else every saved X account) from the last 30 days at ≥3× their author\'s own median, with format and first line; (2) own — the user\'s own Instagram Reels, TikToks, YouTube Shorts and videos that beat their own median (≥2×), with a suggested X format (video clip, text, thread); (3) reddit — the questions and pain points that did best in the chosen subreddits, grouped into themes. Read-only. Niche posts show what worked: never copy or lightly reword them. For build-in-public ideas, read the user\'s own repositories yourself.',
    inputSchema: {
      only: z.enum(['niche', 'own', 'reddit', 'all']).optional().describe('One source, or all (default)'),
      days: z.number().int().min(1).max(365).optional().describe('Niche window in days (default 30)'),
      min_ratio: z.number().min(1).max(100).optional().describe('Niche outlier threshold, × the author\'s median (default 3)'),
      own: z.array(z.string()).optional().describe('The user\'s own accounts (Instagram username, tt/name, yt/handle); default: the ones chosen in OpenOutlier'),
      subreddits: z.array(z.string()).optional().describe('Subreddits for the Reddit demand (default: the chosen ones, else those in the X-niche folders, else all saved)'),
      limit: z.number().int().min(1).max(100).optional().describe('Per source (default 20)')
    },
    annotations: { readOnlyHint: true }
  }, (args) => safe(() => {
    const lib = readLibrary();
    let me = [];
    try { if (store) me = [ownXId(store(), lib)]; } catch { /* no store */ }
    return json(xIdeasFor(lib, args, Date.now(), me));
  }));
}
