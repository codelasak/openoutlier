// OpenOutlier – X "My account" on the bridge (docs/x-plan.md 3.4 and section 7, Phase 2, feature x.own).
//
// Written by the extension while the bridge is up (Chrome closed = no X data: X has no RSS):
//   • POST /x/own/daily (src/x-own-bg.js): the merged analytics days of the own account
//     (x.com/i/account_analytics → accountOverviewDailyQuery), today's follower snapshot and the
//     90-day verified-impressions sum → x_own_daily.
//   • POST /sync (bridge.mjs calls recordStats): every changed measurement of an X post the
//     extension saved → x_post_stats (own posts always; Library accounts' posts under 7 days old).
// Read by the Library (GET /x/own/page), the post toolbar (GET /x/own/curve) and the MCP tools
// my_x_account, my_x_progress and x_patterns (registerXOwnTools, one call in server.mjs).
// Never contacts X.
import { createRequire } from 'node:module';
import { selectAccounts, xBrief, xAccount } from './library.mjs';

const require = createRequire(import.meta.url);
const O = require('../src/x-own.js');
const P = require('../src/x-patterns.js');
const M = require('../src/metrics.js');
const Features = require('../src/features.js');

const DAY = 864e5;
const HOUR = 36e5;
const META = 'x_own';                 // { handle, restId, coveredFrom, lastCaptureAt }
const STATS_YOUNG_MS = 7 * DAY;       // non-own posts are measured while younger than this
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
const parse = (t, f) => { try { return t ? JSON.parse(t) : f; } catch { return f; } };
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

export function xOwnOn(store) {
  try { return !!Features.resolve(store.getMeta('features', null))['x.own']; } catch { return true; }
}

/** The own account id ('x/heyeshagh'): the argument, else what the extension sent, else the default. */
export function ownAccount(store, handle) {
  const h = O.normHandle(handle || (store.getMeta(META, null) || {}).handle || O.DEFAULT_HANDLE);
  if (!HANDLE_RE.test(h)) throw new Error(`"${handle}" is not an X handle.`);
  return 'x/' + h;
}

// ---- writing --------------------------------------------------------------------------------
/**
 * body: { handle, restId, days: [{ d, imp_v, imp_u, follows, unfollows, follows_v, unfollows_v, types }],
 *   snapshot: { followers, verified_followers }, imp90: { verified, source }, coveredFrom, capturedAt }
 */
export function putDaily(store, body, now = Date.now()) {
  if (!body || !HANDLE_RE.test(O.normHandle(body.handle))) return { ok: false, error: 'bad handle' };
  const handle = 'x/' + O.normHandle(body.handle);
  const days = (Array.isArray(body.days) ? body.days : []).filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(String(r.d))).slice(-400);
  const up = store.db.prepare(`INSERT INTO x_own_daily (handle, day, imp_v, imp_u, follows, unfollows, follows_v, unfollows_v, metric, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(handle, day) DO UPDATE SET imp_v = excluded.imp_v, imp_u = excluded.imp_u, follows = excluded.follows, unfollows = excluded.unfollows,
      follows_v = excluded.follows_v, unfollows_v = excluded.unfollows_v, metric = excluded.metric, updated_at = excluded.updated_at`);
  const snap = store.db.prepare(`INSERT INTO x_own_daily (handle, day, followers, verified_followers, imp90_v, imp90_source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(handle, day) DO UPDATE SET followers = COALESCE(excluded.followers, x_own_daily.followers),
      verified_followers = COALESCE(excluded.verified_followers, x_own_daily.verified_followers),
      imp90_v = COALESCE(excluded.imp90_v, x_own_daily.imp90_v), imp90_source = COALESCE(excluded.imp90_source, x_own_daily.imp90_source), updated_at = excluded.updated_at`);
  store.db.exec('BEGIN IMMEDIATE');
  try {
    for (const r of days) {
      up.run(handle, r.d, num(r.imp_v), num(r.imp_u), num(r.follows), num(r.unfollows), num(r.follows_v), num(r.unfollows_v),
        r.types && typeof r.types === 'object' ? JSON.stringify(r.types) : null, now);
    }
    const s = body.snapshot || {};
    const i = body.imp90 || {};
    if (num(s.followers) != null || num(s.verified_followers) != null || num(i.verified) != null) {
      snap.run(handle, O.dayOf(body.capturedAt || now), num(s.followers), num(s.verified_followers), num(i.verified),
        typeof i.source === 'string' ? i.source.slice(0, 20) : null, now);
    }
    const meta = store.getMeta(META, null) || {};
    const covered = /^\d{4}-\d{2}-\d{2}$/.test(String(body.coveredFrom || '')) ? body.coveredFrom : null;
    store.setMeta(META, {
      handle: O.normHandle(body.handle), restId: /^\d{1,25}$/.test(String(body.restId || '')) ? String(body.restId) : meta.restId || null,
      coveredFrom: covered && (!meta.coveredFrom || covered < meta.coveredFrom || meta.handle !== O.normHandle(body.handle)) ? covered : meta.coveredFrom || covered,
      lastCaptureAt: body.capturedAt || meta.lastCaptureAt || null, updatedAt: now
    });
    store.db.exec('COMMIT');
  } catch (e) { store.db.exec('ROLLBACK'); throw e; }
  return { ok: true, days: days.length };
}

/**
 * The /sync hook: one x_post_stats row per changed measurement. accounts = the sync body's
 * { id: record }. Own posts are always kept; other accounts' while the post is under 7 days old.
 * → rows written
 */
export function recordStats(store, accounts, { now = Date.now() } = {}) {
  if (!accounts || typeof accounts !== 'object' || !xOwnOn(store)) return 0;
  let own;
  try { own = ownAccount(store); } catch { own = null; }
  const last = store.db.prepare('SELECT ts, views, likes, replies, reposts, quotes, bookmarks FROM x_post_stats WHERE post_id = ? ORDER BY ts DESC LIMIT 1');
  const ins = store.db.prepare(`INSERT OR IGNORE INTO x_post_stats (post_id, ts, account_id, taken_at, kind, format, views, likes, replies, reposts, quotes, bookmarks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let n = 0;
  store.db.exec('BEGIN IMMEDIATE');
  try {
    for (const [id, rec] of Object.entries(accounts)) {
      if (!/^x\//.test(id) || !rec || !rec.posts) continue;
      const isOwn = id === own || (rec.profile && own && String(rec.profile.handle || '').toLowerCase() === own.slice(2));
      for (const p of Object.values(rec.posts)) {
        if (!p || !/^\d{1,25}$/.test(String(p.code)) || p.views == null) continue;
        const kind = M.xKind(p);
        if (kind === 'repost') continue;
        if (!isOwn && !(p.takenAt && now - p.takenAt < STATS_YOUNG_MS)) continue;
        const ts = num(p.seenAt) || now;
        const row = [num(p.views), num(p.likes), num(p.comments), num(p.shares), num(p.quotes), num(p.saves)];
        const prev = last.get(String(p.code));
        if (prev && (prev.ts >= ts || [prev.views, prev.likes, prev.replies, prev.reposts, prev.quotes, prev.bookmarks].every((v, i) => (v ?? null) === row[i]))) continue;
        ins.run(String(p.code), ts, id, num(p.takenAt), kind, p.type || 'text', ...row);
        n++;
      }
    }
    store.db.exec('COMMIT');
  } catch (e) { store.db.exec('ROLLBACK'); throw e; }
  return n;
}

// ---- reading ---------------------------------------------------------------------------------
function dailyRows(store, handle) {
  return store.db.prepare('SELECT * FROM x_own_daily WHERE handle = ? ORDER BY day').all(handle);
}

/** x_own_daily → the history shape src/x-own.js works on. */
export function historyOf(store, handle) {
  const h = O.emptyHistory();
  const meta = store.getMeta(META, null) || {};
  if (meta.handle && 'x/' + meta.handle === handle) {
    h.restId = meta.restId || null;
    if (meta.coveredFrom) h.captures.push({ at: meta.lastCaptureAt || null, from: Date.parse(meta.coveredFrom + 'T00:00:00Z') });
  }
  for (const r of dailyRows(store, handle)) {
    const types = parse(r.metric, null);
    if (types) h.days[r.day] = types;
    else if (r.imp_v != null || r.imp_u != null) h.days[r.day] = { Displayed: { v: r.imp_v || 0, u: r.imp_u || 0, n: 0 } };
    if (r.verified_followers != null || r.followers != null) h.snapshots.push({ d: r.day, at: Date.parse(r.day + 'T12:00:00Z'), verifiedFollowers: r.verified_followers, followers: r.followers });
  }
  return h;
}

function libPosts(store, id) {
  const lib = store.readLibrary();
  const rec = lib.accounts[id];
  return { lib, rec, posts: rec ? M.enrich(Object.values(rec.posts || {})) : [] };
}

const row = (p) => ({ ...xBrief(p), type_guess: P.postType(p) });

/** my_x_account: profile, latest snapshot, originals and replies as two tables. */
export function myAccount(store, { handle, limit = 20, now = Date.now() } = {}) {
  const id = ownAccount(store, handle);
  const { rec, posts } = libPosts(store, id);
  const prof = rec?.profile || {};
  const split = O.splitOwn(posts);
  const snaps = dailyRows(store, id).filter((r) => r.verified_followers != null || r.followers != null);
  const last = snaps[snaps.length - 1] || null;
  const med = P.singleHit(split.originals);
  const meta = store.getMeta(META, null) || {};
  return {
    account: id,
    in_library: !!rec,
    handle: prof.handle || id.slice(2),
    name: prof.name || null,
    followers: prof.followers ?? last?.followers ?? null,
    verified_followers: last?.verified_followers ?? null,
    verified_followers_at: last ? last.day : null,
    following: prof.following ?? null,
    posts_on_profile: prof.posts ?? null,
    premium: prof.blueVerified ?? null,
    saved_posts: posts.length,
    last_original_at: split.originals[0]?.takenAt ? new Date(split.originals[0].takenAt).toISOString() : null,
    days_since_last_original: split.originals[0]?.takenAt ? Math.floor((now - split.originals[0].takenAt) / DAY) : null,
    originals_median_views: med.median,
    single_hit: med,
    analytics_last_captured_at: meta.lastCaptureAt ? new Date(meta.lastCaptureAt).toISOString() : null,
    originals: split.originals.slice(0, limit).map(row),
    replies: split.replies.slice(0, limit).map(row),
    counts: { originals: split.originals.length, replies: split.replies.length, reposts: split.reposts },
    note: rec ? 'Two tables on purpose: replies (and thread parts) don\'t count toward Original Content Rewards\' 500K impressions. Views are X\'s own count, not monetized impressions.'
      : `@${id.slice(2)} is not in the Library yet: open x.com/${id.slice(2)} with OpenOutlier on (and the analytics page, x.com/i/account_analytics, for verified numbers).`
  };
}

/** my_x_progress: Original Content Rewards progress and ETA, plus the stored daily series. */
export function myProgress(store, { handle, now = Date.now(), days = 90 } = {}) {
  const id = ownAccount(store, handle);
  const { posts } = libPosts(store, id);
  const history = historyOf(store, id);
  const prog = O.rewardsProgress({ history, posts, now });
  const from = O.addDays(O.dayOf(now), -(days - 1));
  const series = dailyRows(store, id).filter((r) => r.day >= from).map((r) => ({
    day: r.day, verified_impressions: r.imp_v, other_impressions: r.imp_u, follows: r.follows, unfollows: r.unfollows,
    followers: r.followers ?? undefined, verified_followers: r.verified_followers ?? undefined,
    sum90_verified: r.imp90_v ?? undefined, sum90_source: r.imp90_source ?? undefined
  }));
  return { account: id, ...prog, daily: series };
}

/** x_patterns for one account, or every X account of a folder / tag (pooled, each against its own median). */
export function xPatterns(store, { account, folder, tag, lang = 'en', include_small_accounts = true } = {}) {
  const lib = store.readLibrary();
  let ids;
  if (account) {
    const id = account === 'me' ? ownAccount(store) : xAccount(account);
    if (!lib.accounts[id]) throw new Error(`${id} is not in the Library. Open x.com/${id.slice(2)} with OpenOutlier on first (or collect_profile ${id}).`);
    ids = [id];
  } else if (folder || tag) {
    ids = selectAccounts(lib, { folder, tag, platform: 'x', includeSmall: include_small_accounts });
    if (!ids.length) throw new Error('No X accounts in that ' + (folder ? 'folder' : 'tag') + '.');
  } else ids = [ownAccount(store)];
  const per = ids.map((id) => {
    const posts = M.enrich(Object.values(lib.accounts[id]?.posts || {}));
    return { id, posts, base: P.singleHit(posts) };
  });
  if (per.length === 1) {
    const p = per[0];
    return { scope: p.id, ...P.patterns(p.posts, { lang, heatmap: false }) };
  }
  // A pool: each post's views ÷ its own account's median, so big accounts don't drown small ones.
  const pooled = [];
  for (const a of per) {
    if (!(a.base.median > 0)) continue;
    for (const p of a.posts) if (p.views != null) pooled.push({ ...p, views: p.views / a.base.median, rawViews: p.views });
  }
  const pat = P.patterns(pooled, { lang, heatmap: false });
  return {
    scope: folder ? `folder ${folder}` : `tag ${tag}`,
    accounts: per.map((a) => ({ account: a.id, originals_with_views: a.base.n, median: a.base.median, mean: a.base.mean, single_hit: a.base.warning })),
    ...pat,
    note: 'Pooled: every post is first divided by its own account\'s median (so "views" and median_views here are already × that account\'s median), then grouped. ' + pat.note
  };
}

/** The usual early curve of an account from x_post_stats (originals). */
export function curveOf(store, account, { now = Date.now() } = {}) {
  const id = account === 'me' ? ownAccount(store) : xAccount(account);
  const rows = store.db.prepare(`SELECT post_id, ts, views, taken_at FROM x_post_stats
    WHERE account_id = ? AND kind = 'original' AND taken_at IS NOT NULL AND ts - taken_at <= ? ORDER BY post_id, ts`).all(id, 49 * HOUR);
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.post_id)) by.set(r.post_id, { takenAt: r.taken_at, points: [] });
    by.get(r.post_id).points.push({ ts: r.ts, views: r.views });
  }
  const list = [...by.values()].filter((e) => now - e.takenAt > HOUR); // the post being judged isn't its own baseline yet
  return { account: id, ...O.earlyCurve(list) };
}

/** GET /x/own/page: everything the Library's "My X" page shows from the bridge. */
export function ownPage(store, { handle, now = Date.now() } = {}) {
  const id = ownAccount(store, handle);
  return { ok: true, on: xOwnOn(store), account: id, progress: myProgress(store, { handle, now, days: 400 }), curve: curveOf(store, id, { now }),
    stats_rows: store.db.prepare('SELECT COUNT(*) AS n FROM x_post_stats WHERE account_id = ?').get(id).n };
}

/** The bridge's /x/own/* routes. → [status, body] or null. */
export async function handleRoute(method, url, { store, readBody }) {
  if (method === 'POST' && url.pathname === '/x/own/daily') {
    const body = await readBody();
    if (!xOwnOn(store)) return [200, { ok: false, off: true }];
    const r = putDaily(store, body);
    return [r.ok ? 200 : 400, r];
  }
  if (method === 'GET' && url.pathname === '/x/own/page') {
    try { return [200, ownPage(store, { handle: url.searchParams.get('handle') || undefined })]; } catch (e) { return [400, { ok: false, error: e.message }]; }
  }
  if (method === 'GET' && url.pathname === '/x/own/curve') {
    const a = url.searchParams.get('account') || 'me';
    if (a !== 'me' && !/^x\/[a-z0-9_]{1,15}$/.test(a)) return [400, { ok: false, error: 'bad account' }];
    return [200, { ok: true, ...curveOf(store, a) }];
  }
  return null;
}

// ---- MCP -------------------------------------------------------------------------------------
export const INSTRUCTIONS = 'My X account (my_x_account, my_x_progress) reads the user\'s own X account from what their x.com tab loaded (and x.com/i/account_analytics when they opened it): originals and replies as two tables, Original Content Rewards progress (500 verified followers, 500K verified Home impressions in 90 days; the impression sum is always an upper bound) with a 4-week pace and ETA. x_patterns breaks any X account or folder down by post type, length, first line, numbers, emoji, links, language and posting hour against its own median, with a single-hit check (median vs mean). All read-only; nothing is posted.';

export function registerXOwnTools(server, { z, json, safe, store }) {
  const handle = z.string().optional().describe('X handle of the user\'s own account (default: the one set in the extension, heyEshagh)');
  const run = (fn) => safe(() => { try { return json(fn()); } catch (e) { return json({ ok: false, error: e.message }); } });
  server.registerTool('my_x_account', {
    title: 'My X account: summary and latest posts',
    description: 'The user\'s own X account from the Library: followers, verified followers (from X\'s analytics page when captured), days since the last original, the originals median and a single-hit check, and the latest originals and replies as two separate tables (replies don\'t count toward Original Content Rewards). Each post has views, × the account\'s format median and a rule-based type guess.',
    inputSchema: { handle, limit: z.number().int().min(1).max(100).optional().describe('Rows per table (default 20)') },
    annotations: { readOnlyHint: true }
  }, (args) => run(() => myAccount(store(), args)));
  server.registerTool('my_x_progress', {
    title: 'X Original Content Rewards progress and ETA',
    description: 'How far the user\'s own X account is from Original Content Rewards (requirements dated 2026-11-24, with the source link): verified followers /500 and verified impressions in the last 90 days /500,000, each with the 4-week pace and an ETA in days (the rolling 90-day window drops old days). Verified impressions are summed from X\'s analytics (Displayed by verified users) and always labelled an upper bound; without analytics it falls back to an estimate from the originals\' views. Includes the stored daily series.',
    inputSchema: { handle, days: z.number().int().min(7).max(400).optional().describe('Days of daily rows (default 90)') },
    annotations: { readOnlyHint: true }
  }, (args) => run(() => myProgress(store(), args)));
  server.registerTool('x_patterns', {
    title: 'What works on an X account (type, length, hour…)',
    description: 'For one X account (x/name or @name; "me" = the user\'s own) or every X account in a folder or tag: originals broken down by post type (question, list, how-to, story, opinion, announcement, thread, image, video, link, article, quote), length, first-line length, starting with a number, emoji, link, language (TR/EN) and posting hour, each group\'s median views × the account\'s own median with counts and the top 3 posts, plus a single-hit check (median vs mean: does reach come from a few posts?).',
    inputSchema: {
      account: z.string().optional().describe('x/name, @name or "me" (default: the user\'s own account)'),
      folder: z.string().optional().describe('A Library folder: pools its X accounts'),
      tag: z.string().optional().describe('A Library tag: pools its X accounts'),
      lang: z.enum(['en', 'tr']).optional().describe('Labels language (default en)')
    },
    annotations: { readOnlyHint: true }
  }, (args) => run(() => xPatterns(store(), args)));
}
