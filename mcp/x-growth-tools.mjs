// OpenOutlier MCP – X Phase 3 (docs/x-plan.md 4.2, 4.3, 7): x_reply_opportunities and x_reply_roi.
// Read-only, from the Library the extension syncs (rs:p:x/*, rs:org) and the bridge's snapshots
// table (each post's counts every time the extension saw them change). The scoring is the
// extension's own (src/x-growth.js), so the tools and the x.com drawer agree.
//
// Optional inputs from X Phase 2 (own account history), injected by mcp/server.mjs once merged:
//   xPostStats(store, accountIds)  → rows { post_id, owner, ts, views, taken_at } (per-post history,
//                                    e.g. the x_post_stats table): better "same age" paces.
//   xFollowerDeltas(store, meId)   → { 'YYYY-MM-DD': follower change } (exact, from the analytics).
// Without them: snapshots for the pace, and the follower log the extension keeps on the user's own
// profile record (profile.followersLog) for the follower change.
import { createRequire } from 'node:module';
import { readLibrary as defaultReadLibrary } from './library.mjs';

const require = createRequire(import.meta.url);
const G = require('../src/x-growth.js');
const M = require('../src/metrics.js');
const XP = require('../src/x.js');

const MIN = 60_000;

export const INSTRUCTIONS = 'X growth (Phase 3): x_reply_opportunities lists fresh originals (last 120 min) from the user\'s X niche (Library folders marked "X niche" in the x.com drawer, else accounts they follow), scored by pace vs the author\'s own posts at the same age, saturation, mutual follows and size fit; x_reply_roi shows which accounts\' replies brought views, replies back and followers. Both only read: OpenOutlier never posts or replies. To help with a reply, suggest 2–3 angles (a question, extra data, a respectful counter view) for the user to write in their own words.';

const xIds = (lib) => Object.keys(lib.accounts || {}).filter((id) => XP.isXId(id));
const postsOf = (lib, id) => Object.values(lib.accounts[id]?.posts || {});

function folderNamed(lib, name) {
  const n = String(name || '').trim().toLowerCase();
  return (lib.org?.folders || []).find((f) => f.name.toLowerCase() === n || f.id === name) || null;
}

/** The user's own X account: the `me` argument, else the account whose profile the extension marked me: true. */
export function xMe(lib, me) {
  if (me) {
    const id = XP.isXId(me) ? me : XP.normHandle(me) || XP.normHandle('@' + String(me).replace(/^@/, ''));
    if (!id) throw new Error(`"${me}" is not an X handle.`);
    const prof = lib.accounts?.[id]?.profile || null;
    return { id, handle: prof?.handle || id.slice(2), restId: prof?.restId || null, followers: prof?.followers ?? null, profile: prof };
  }
  const id = xIds(lib).find((k) => lib.accounts[k].profile?.me === true);
  if (!id) return null;
  const prof = lib.accounts[id].profile;
  return { id, handle: prof.handle || id.slice(2), restId: prof.restId || null, followers: prof.followers ?? null, profile: prof };
}

/** Early snapshots (≤ 6 h after posting) of these accounts' posts → pace rows. */
export function earlyRows(st, accountIds) {
  if (!st || !accountIds.length) return [];
  const marks = accountIds.map(() => '?').join(',');
  try {
    return st.db.prepare(`SELECT s.account_id AS owner, s.code AS post_id, s.seen_at AS ts, s.views AS views, p.taken_at AS taken_at
      FROM snapshots s JOIN posts p ON p.account_id = s.account_id AND p.code = s.code
      WHERE s.account_id IN (${marks}) AND s.views IS NOT NULL AND p.taken_at IS NOT NULL AND s.seen_at - p.taken_at BETWEEN 0 AND ?`)
      .all(...accountIds, G.C.PACE_MAX_AGE_MIN * MIN);
  } catch { return []; }
}

/**
 * x_reply_opportunities over a Library. args: { folder, me, window_minutes, limit, include_replied }.
 * deps: { rows (pace rows), now }.
 */
export function replyOpportunitiesFor(lib, args = {}, deps = {}) {
  const now = deps.now || Date.now();
  const ids = xIds(lib);
  let members = null;
  let niche;
  if (args.folder) {
    const f = folderNamed(lib, args.folder);
    if (!f) throw new Error(`No folder named "${args.folder}". Folders: ${(lib.org?.folders || []).map((x) => x.name).join(', ') || 'none'}`);
    members = Object.fromEntries(ids.filter((id) => lib.org.accounts?.[id]?.folder === f.id).map((id) => [id, true]));
    niche = { source: 'folder', folders: [f.name], accounts: Object.keys(members).length };
  } else {
    members = G.nicheMembers(lib.org, ids);
    niche = members
      ? { source: 'x_niche_folders', folders: G.nicheFolders(lib.org).map((fid) => (lib.org.folders.find((f) => f.id === fid) || {}).name), accounts: Object.keys(members).length }
      : { source: 'followed_accounts', note: 'No Library folder is marked "X niche" yet: using saved accounts the user follows on X.' };
  }
  const me = xMe(lib, args.me);
  const all = ids.flatMap((id) => postsOf(lib, id));
  const baselines = M.xBaselines(all, { now });
  const candidates = (members ? Object.keys(members) : ids).flatMap((id) => postsOf(lib, id));
  const byId = Object.fromEntries(all.map((p) => [p.code, p]));
  const pace = G.paceFromRows(deps.rows || [], byId);
  const myReplies = me ? postsOf(lib, me.id).filter((p) => p.kind === 'reply') : [];
  const windowMin = args.window_minutes || G.C.WINDOW_MIN;
  const ops = G.replyOpportunities({ posts: candidates, now, me: me || {}, members, baselines, pace, myReplies, windowMin, limit: args.limit || 20, includeReplied: !!args.include_replied });
  const freshest = candidates.reduce((m, p) => Math.max(m, p.seenAt || 0), 0);
  return {
    niche,
    me: me ? { account: me.id, followers: me.followers } : null,
    window_minutes: windowMin,
    last_seen_post_at: freshest ? new Date(freshest).toISOString() : null,
    opportunities: ops.map((o) => ({
      url: o.post.url, author: '@' + o.post.author, account: o.post.owner, posted_at: new Date(o.post.takenAt).toISOString(), age_minutes: o.ageMin,
      views: o.post.views ?? null, replies: o.post.comments ?? null, author_followers: o.post.ownerFollowers ?? null,
      velocity: o.velocity, velocity_basis: o.velocityBasis, expected_views: o.expected, history_posts: o.historyPosts,
      saturation: o.saturation, mutual: o.mutual, size_ratio: o.sizeRatio, cold_start: o.coldStart, already_replied: o.replied,
      score: o.score, text: o.post.caption || '',
      reply_angles: null // Phase 5 hook: the x.com drawer asks the user's own LLM key on demand; here, suggest angles yourself.
    })),
    note: 'Only posts the extension has seen and synced count: a niche account\'s posts reach the Library when the user\'s list tab, Home → Following, or the profile is open in Chrome. ' +
      'velocity = views ÷ the author\'s usual views at the same age (velocity_basis "history": from earlier sightings of their young posts; "lifetime": their median spread over a typical ' + G.C.TYPICAL_LIFETIME_MIN / 60 + '-hour lifetime, an estimate). ' +
      'score (0–100) multiplies pace, a saturation penalty (many replies / a high replies-to-views ratio), a mutual-follow bonus and size fit (author 1–30× the user\'s followers). OpenOutlier never replies: the user writes every reply.'
  };
}

/** x_reply_roi over a Library. args: { me, since_days, limit }. deps: { deltas, now }. */
export function replyRoiFor(lib, args = {}, deps = {}) {
  const now = deps.now || Date.now();
  const me = xMe(lib, args.me);
  if (!me) return { error: 'The user\'s own X account is not known yet.', hint: 'Open x.com in Chrome with the extension (it reads the handle from the side menu), then open the profile\'s Replies tab. Or pass me: "@handle".' };
  const mine = postsOf(lib, me.id);
  if (!mine.length) return { error: `No posts of @${me.handle} in the Library yet.`, hint: `Open x.com/${me.handle}/with_replies in Chrome and scroll a little; replies sent from that browser are added as they are sent.` };
  const parents = Object.fromEntries(xIds(lib).flatMap((id) => postsOf(lib, id)).map((p) => [p.code, p]));
  const deltas = G.mergeDeltas(deps.deltas || {}, G.deltasFromLog(me.profile?.followersLog));
  const roi = G.replyRoi({ myPosts: mine, me, deltas, parents, now, sinceDays: args.since_days || 90 });
  const limit = args.limit || 25;
  const iso = (t) => (t ? new Date(t).toISOString() : null);
  return {
    account: me.id,
    since_days: args.since_days || 90,
    totals: roi.totals,
    accounts: roi.accounts.slice(0, limit).map((a) => ({ ...a, last_reply_at: iso(a.last_reply_at) })),
    replies: roi.replies.slice(0, limit).map((r) => ({ ...r, at: iso(r.at), author_reply_at: iso(r.author_reply_at) })),
    notes: [roi.followers_note,
      'author_replied: true when the author\'s reply to the user\'s reply was seen; false when X showed no replies at all; null = not known (open that reply on x.com). author_liked is only known to be false (0 likes): X does not show who liked a reply.',
      'The user\'s per-account notes and tags (the People tab on x.com) stay in the browser and are not part of this answer.']
  };
}

export function registerXGrowthTools(server, { z, json, safe, store, readLibrary = defaultReadLibrary, xPostStats, xFollowerDeltas }) {
  const st = () => { try { return store(); } catch { return null; } };
  server.registerTool('x_reply_opportunities', {
    title: 'X reply opportunities (fresh niche posts to reply to)',
    description: 'Fresh original X posts (default: the last 120 minutes) from the user\'s X niche — accounts in Library folders marked "X niche", or a folder you name, else saved accounts the user follows — ranked by a score: views vs the author\'s usual pace at the same age, a saturation penalty (many replies already), a mutual-follow bonus and size fit (author 1–30× the user\'s followers). Each has url, age, views, replies, velocity and score. Read-only: suggest angles if asked; the user writes and sends every reply.',
    inputSchema: {
      folder: z.string().optional().describe('A Library folder name to use as the niche (default: the folders marked X niche)'),
      me: z.string().optional().describe('The user\'s X handle, if the extension has not detected it'),
      window_minutes: z.number().int().min(10).max(1440).optional().describe('How fresh, in minutes (default 120)'),
      limit: z.number().int().min(1).max(100).optional().describe('Default 20'),
      include_replied: z.boolean().optional().describe('Also list posts the user already replied to (flagged)')
    },
    annotations: { readOnlyHint: true }
  }, (args) => safe(() => {
    const lib = readLibrary();
    const ids = xIds(lib);
    const rows = earlyRows(st(), ids);
    if (xPostStats) { try { rows.push(...(xPostStats(store(), ids) || [])); } catch { /* optional */ } }
    return json(replyOpportunitiesFor(lib, args, { rows }));
  }));
  server.registerTool('x_reply_roi', {
    title: 'X reply ROI (whose replies grow the user)',
    description: 'The user\'s own X replies (last 90 days by default): per reply its views, likes, whether the author replied back, and that day\'s follower change shared across the day\'s replies; per account replied to: replies, median views, how often they replied back, followers attributed (a rough estimate) and the last reply. Ranked by followers attributed, then median views.',
    inputSchema: {
      me: z.string().optional().describe('The user\'s X handle, if the extension has not detected it'),
      since_days: z.number().int().min(1).max(365).optional().describe('Default 90'),
      limit: z.number().int().min(1).max(200).optional().describe('Rows per list (default 25)')
    },
    annotations: { readOnlyHint: true }
  }, (args) => safe(() => {
    const lib = readLibrary();
    let deltas = {};
    if (xFollowerDeltas) {
      const me = xMe(lib, args.me);
      if (me) { try { deltas = xFollowerDeltas(store(), me.id) || {}; } catch { /* optional */ } }
    }
    return json(replyRoiFor(lib, args, { deltas }));
  }));
}
