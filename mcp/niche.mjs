// OpenOutlier – niche tracking on the bridge (docs/youtube-niche-plan.md 2, phase 1).
//
// • The tracking list: the Library's org record (src/tracking.js) → tracked_channels
//   rows and their jobs (syncTracked, run after every sync that carries the org).
// • Job kinds for mcp/tracker.mjs:
//     rss            every 15 min per channel: both RSS feeds (long-form UULF…, Shorts UUSH…),
//                    views + likes as source 'rss', new videos get scheduled, title and
//                    thumbnail (perceptual hash) changes go to video_meta_log
//     video          Data API videos.list in batches of 50, on the age tiers of 2.2
//     channel-stats  daily channels.list (50 per call) → channel_stats
//     backfill       once per channel: the "All uploads via API" path (newest 500 uploads)
//     resolve        a tracked yt/handle without a known UC… id → channels.list forHandle
//     digest         Monday: the weekly niche report (weekly-digest)
//   After measurements the breakout check runs (breakout-alerts): a video at ≥ 3×
//   (configurable) its expected views at 6 h or 24 h becomes a niche_alerts row; the
//   extension shows it as a Chrome notification and in "Hızlı yükselenler".
// • Queries for the Library's Niş Takibi page and the MCP tools (nichePage, nichePulse,
//   videoVelocity, breakoutList, channelGrowth, nicheReport), all from src/velocity.js.
// Everything is kept (decision 2026-11-21); api-retention-30d (tracker.mjs) is the only purge.
import { createRequire } from 'node:module';
import { fetchFeeds } from './rss.mjs';
import { thumbAndSnap, changed as thumbChanged } from './thumbhash.mjs';

const require = createRequire(import.meta.url);
const V = require('../src/velocity.js');
const A = require('../src/youtube-api.js');
const TR = require('../src/tracking.js');

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
export const SETTINGS_META = 'niche_settings';
const DEFAULT_SETTINGS = { breakoutRatio: V.BREAKOUT_RATIO, fastStart: true };
const FAR = 8.64e15;

/** { breakoutRatio, fastStart } (the extension sends them with its settings). */
export function nicheSettings(store) {
  const s = store.getMeta(SETTINGS_META, null) || {};
  const ratio = Number(s.breakoutRatio);
  return { breakoutRatio: ratio >= 1.5 && ratio <= 20 ? ratio : DEFAULT_SETTINGS.breakoutRatio, fastStart: s.fastStart !== false };
}
export function sanitizeSettings(s) {
  if (!s || typeof s !== 'object') return null;
  const out = {};
  const r = Number(s.breakoutRatio);
  if (Number.isFinite(r) && r >= 1.5 && r <= 20) out.breakoutRatio = Math.round(r * 10) / 10;
  if (typeof s.fastStart === 'boolean') out.fastStart = s.fastStart;
  return out;
}

/** Create or update a tracker_jobs row (the SQL behind Tracker.schedule). */
export function upsertJob(store, id, fields, nextAt) {
  store.db.prepare(`INSERT INTO tracker_jobs (id, kind, video_id, channel_id, published_at, next_at, tier, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, video_id = COALESCE(excluded.video_id, tracker_jobs.video_id),
      channel_id = COALESCE(excluded.channel_id, tracker_jobs.channel_id), published_at = COALESCE(excluded.published_at, tracker_jobs.published_at),
      next_at = excluded.next_at, tier = COALESCE(excluded.tier, tracker_jobs.tier), data = COALESCE(excluded.data, tracker_jobs.data)`)
    .run(id, fields.kind, fields.video_id ?? null, fields.channel_id ?? null, fields.published_at ?? null, nextAt, fields.tier ?? null,
      fields.data === undefined ? null : JSON.stringify(fields.data));
}
function hasJob(store, id) { return !!store.db.prepare('SELECT 1 FROM tracker_jobs WHERE id = ?').get(id); }
function dropJob(store, id) { store.db.prepare('DELETE FROM tracker_jobs WHERE id = ?').run(id); }

// ---- the tracking list --------------------------------------------------------------

function channelIdOf(lib, d) {
  if (CHANNEL_ID_RE.test(String(d.channelId || ''))) return d.channelId;
  const rec = lib.accounts[d.account_id];
  if (rec && rec.profile && CHANNEL_ID_RE.test(String(rec.profile.channelId || ''))) return rec.profile.channelId;
  const m = /^yt\/(UC[A-Za-z0-9_-]{22})$/.exec(d.account_id);
  if (m) return m[1];
  for (const p of Object.values((rec && rec.posts) || {})) if (CHANNEL_ID_RE.test(String(p.ownerId || ''))) return p.ownerId;
  return null;
}

/**
 * Bring tracked_channels and their jobs in line with the org's tracking list.
 * New channels get an RSS job right away and a one-time backfill; channels taken off the
 * list become inactive (their measurements stay) and lose their jobs.
 * → { active, added, removed, unresolved: [account ids] }
 */
export function syncTracked(store, lib, { now = Date.now(), random = Math.random } = {}) {
  const want = TR.desired(lib.org || {}, Object.keys(lib.accounts || {}));
  const db = store.db;
  const rows = new Map(db.prepare('SELECT * FROM tracked_channels').all().map((r) => [r.channel_id, r]));
  const keep = new Set();
  const unresolved = [];
  let added = 0;
  for (const d of want) {
    const cid = channelIdOf(lib, d);
    if (!cid) {
      unresolved.push(d.account_id);
      const handle = d.account_id.slice(3);
      if (!hasJob(store, 'resolve:' + d.account_id)) upsertJob(store, 'resolve:' + d.account_id, { kind: 'resolve', data: { account: d.account_id, handle } }, now + Math.floor(random() * MIN));
      continue;
    }
    keep.add(cid);
    const prof = (lib.accounts[d.account_id] && lib.accounts[d.account_id].profile) || {};
    const prev = rows.get(cid);
    db.prepare(`INSERT INTO tracked_channels (channel_id, account_id, niche, mine, added_at, active, name, handle, subs)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(channel_id) DO UPDATE SET account_id = excluded.account_id, niche = excluded.niche, mine = excluded.mine, active = 1,
        name = COALESCE(excluded.name, tracked_channels.name), handle = COALESCE(excluded.handle, tracked_channels.handle),
        subs = COALESCE(tracked_channels.subs, excluded.subs)`)
      .run(cid, d.account_id, d.niche, d.mine ? 1 : 0, now, prof.name || d.name || null, prof.handle || (/^yt\/UC/.test(d.account_id) ? null : d.account_id.slice(3)), typeof prof.subscribers === 'number' ? prof.subscribers : null);
    if (!prev || !prev.active) {
      added++;
      upsertJob(store, 'rss:' + cid, { kind: 'rss', channel_id: cid }, now + Math.floor(random() * 2 * MIN));
      if (!(prev && prev.backfilled_at)) upsertJob(store, 'backfill:' + cid, { kind: 'backfill', channel_id: cid, data: { account: d.account_id } }, now + MIN + Math.floor(random() * 4 * MIN));
      else rescheduleVideos(store, cid, now, random);
    }
    dropJob(store, 'resolve:' + d.account_id);
  }
  let removed = 0;
  for (const [cid, r] of rows) {
    if (keep.has(cid) || !r.active) continue;
    db.prepare('UPDATE tracked_channels SET active = 0 WHERE channel_id = ?').run(cid);
    db.prepare("DELETE FROM tracker_jobs WHERE channel_id = ? AND kind IN ('rss', 'video', 'backfill')").run(cid);
    removed++;
  }
  // Resolve jobs for channels no longer wanted.
  const wantIds = new Set(want.map((d) => d.account_id));
  for (const j of db.prepare("SELECT id, data FROM tracker_jobs WHERE kind = 'resolve'").all()) {
    let acct = null;
    try { acct = JSON.parse(j.data).account; } catch { /* drop */ }
    if (!acct || !wantIds.has(acct) || !unresolved.includes(acct)) dropJob(store, j.id);
  }
  store.setMeta('niche_unresolved', unresolved);
  return { active: keep.size, added, removed, unresolved };
}

/** A channel tracked again: its known videos get their API schedule back. */
function rescheduleVideos(store, cid, now, random) {
  const vids = store.db.prepare('SELECT video_id, published_at FROM tracked_videos WHERE channel_id = ?').all(cid);
  for (const v of vids) scheduleVideo(store, v, now, {}, random);
}

function scheduleVideo(store, v, now, settings = {}, random = Math.random, soon = false) {
  const pub = v.published_at || now;
  const m = V.nextMeasure(pub, now, settings);
  let next = soon ? now + Math.floor(random() * 2 * MIN) : m.next_at;
  // Weekly videos get spread over the week so a backfill doesn't make them all due at once.
  if (!soon && m.tier === 'd30+') next = now + Math.floor(random() * 7 * DAY);
  upsertJob(store, 'video:' + v.video_id, { kind: 'video', video_id: v.video_id, channel_id: v.channel_id, published_at: pub, tier: m.tier }, next);
}

// ---- writing what the jobs learn ---------------------------------------------------------

function upsertVideo(store, v, now, foundBy) {
  const prev = store.db.prepare('SELECT * FROM tracked_videos WHERE video_id = ?').get(v.video_id);
  if (!prev) {
    store.db.prepare(`INSERT INTO tracked_videos (video_id, channel_id, published_at, type, title, thumb, duration, keywords, description, first_seen, found_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(v.video_id, v.channel_id, v.published_at ?? null, v.type || null, v.title || null, v.thumb || null,
      v.duration ?? null, v.keywords ? JSON.stringify(v.keywords) : null, v.description || null, now, foundBy, now);
    store.bumpStatsRev();
    return { added: true, prev: null };
  }
  const kw = v.keywords ? JSON.stringify(v.keywords) : null;
  const typeNext = v.type === 'live' || !prev.type ? v.type || null : null;
  // Only a change the niche model reads invalidates its memo (the RSS job rewrites every entry every 15 min).
  if ((v.published_at != null && v.published_at !== prev.published_at) || (typeNext && typeNext !== prev.type) || (v.title && v.title !== prev.title)
    || (v.thumb && v.thumb !== prev.thumb) || (v.duration != null && v.duration !== prev.duration) || (kw && kw !== prev.keywords)) store.bumpStatsRev();
  store.db.prepare(`UPDATE tracked_videos SET published_at = COALESCE(?, published_at), type = COALESCE(?, type), title = COALESCE(?, title),
    thumb = COALESCE(?, thumb), duration = COALESCE(?, duration), keywords = COALESCE(?, keywords), description = COALESCE(?, description), updated_at = ? WHERE video_id = ?`)
    .run(v.published_at ?? null, v.type === 'live' || !prev.type ? v.type || null : null, v.title || null, v.thumb || null, v.duration ?? null,
      v.keywords ? JSON.stringify(v.keywords) : null, v.description || null, now, v.video_id);
  return { added: false, prev };
}

/** Log the first known title / thumbnail, and every change after it. → 'title' | 'thumb' | null */
function noteMeta(store, videoId, { title, thumbHash, thumbUrl, duration, snap }, now, source) {
  const last = store.db.prepare('SELECT * FROM video_meta_log WHERE video_id = ? ORDER BY ts DESC LIMIT 1').get(videoId);
  const lastHash = last ? store.db.prepare('SELECT thumb_hash FROM video_meta_log WHERE video_id = ? AND thumb_hash IS NOT NULL ORDER BY ts DESC LIMIT 1').get(videoId) : null;
  const titleChanged = last && title && last.title && title !== last.title;
  const thumbDiff = thumbHash && lastHash && thumbChanged(lastHash.thumb_hash, thumbHash);
  const firstHash = thumbHash && last && !lastHash;
  if (!last || titleChanged || thumbDiff) {
    // The thumbnail snapshot of this version (young videos only): the current image, or the one the last row had.
    const lastSnap = last ? store.db.prepare('SELECT thumb_snap FROM video_meta_log WHERE video_id = ? AND thumb_snap IS NOT NULL ORDER BY ts DESC LIMIT 1').get(videoId) : null;
    store.db.prepare('INSERT OR IGNORE INTO video_meta_log (video_id, ts, title, thumb_hash, duration, thumb_url, source, thumb_snap) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(videoId, now, title || (last && last.title) || null, thumbHash || (lastHash && lastHash.thumb_hash) || null, duration ?? (last && last.duration) ?? null, thumbUrl || null, source,
        snap || (!thumbDiff && lastSnap ? lastSnap.thumb_snap : null));
    return titleChanged ? 'title' : thumbDiff ? 'thumb' : null;
  }
  if (firstHash) store.db.prepare('UPDATE video_meta_log SET thumb_hash = ?, thumb_snap = COALESCE(thumb_snap, ?) WHERE video_id = ? AND ts = ?').run(thumbHash, snap || null, videoId, last.ts);
  else if (snap && last && !last.thumb_snap && !thumbDiff) store.db.prepare('UPDATE video_meta_log SET thumb_snap = ? WHERE video_id = ? AND ts = ?').run(snap, videoId, last.ts);
  return null;
}

// ---- job kinds ---------------------------------------------------------------------------

function apiClient(ctx) {
  return A.client({ key: ctx.apiKey, fetch: ctx.fetch, onUnits: (n) => ctx.quota.spend(n) });
}

async function rssJob(ctx, job) {
  const { store, now } = ctx;
  const cid = job.channel_id;
  const ch = store.db.prepare('SELECT * FROM tracked_channels WHERE channel_id = ?').get(cid);
  if (!ch || !ch.active) { dropJob(store, job.id); return { next_at: FAR }; }
  const feeds = await fetchFeeds(cid, { fetch: ctx.fetch, now: () => now });
  const settings = nicheSettings(store);
  const entries = feeds.long.concat(feeds.short).filter((e) => e.published_at && e.published_at <= now + 5 * MIN);
  const stats = [];
  let added = 0;
  const changes = [];
  for (const e of entries) {
    const r = upsertVideo(store, { ...e, channel_id: cid }, now, 'rss');
    // A Short can also appear in the long-form feed of channels YouTube hasn't split yet: Shorts feed wins.
    if (!r.added && e.type === 'short' && r.prev.type !== 'short') { store.db.prepare("UPDATE tracked_videos SET type = 'short' WHERE video_id = ?").run(e.video_id); store.bumpStatsRev(); }
    if (r.added) { added++; scheduleVideo(store, { ...e, channel_id: cid }, now, settings, ctx.random, true); }
    else if (!hasJob(store, 'video:' + e.video_id)) scheduleVideo(store, { ...e, channel_id: cid }, now, settings, ctx.random);
    // Premieres and scheduled videos show 0 views until they start.
    if (e.views != null && !(e.views === 0 && now - e.published_at < 10 * MIN)) stats.push({ video_id: e.video_id, ts: now, views: e.views, likes: e.likes, source: 'rss', published_at: e.published_at });
    const c = noteMeta(store, e.video_id, { title: e.title, thumbUrl: e.thumb }, now, 'rss');
    if (c) changes.push({ video_id: e.video_id, field: c });
  }
  store.addVideoStats(stats);
  // Thumbnails: a few per run, each video at most every 6 h (first week) or daily.
  let hashed = 0;
  if (ctx.flags['title-history'] !== false) {
    const due = entries.map((e) => ({ e, row: store.db.prepare('SELECT thumb_hash, thumb_checked_at FROM tracked_videos WHERE video_id = ?').get(e.video_id) }))
      .filter(({ e, row }) => e.thumb && (!row.thumb_checked_at || now - row.thumb_checked_at > (now - e.published_at < 7 * DAY ? 6 * HOUR : DAY)))
      .slice(0, ctx.thumbsPerRun ?? 4);
    for (const { e } of due) {
      let hash = null;
      let snap = null;
      // Snapshots of the image for the first 30 days (when creators test thumbnails), so a change shows before and after.
      try { const r = await thumbAndSnap(e.thumb, { fetch: ctx.fetch, tools: ctx.thumbTools || {}, keep: now - e.published_at < 30 * DAY }); if (r) { hash = r.hash; snap = r.snap; } } catch { /* try again next time */ }
      store.db.prepare('UPDATE tracked_videos SET thumb_checked_at = ?, thumb_hash = COALESCE(?, thumb_hash) WHERE video_id = ?').run(now, hash, e.video_id);
      if (!hash) continue;
      hashed++;
      const c = noteMeta(store, e.video_id, { title: e.title, thumbHash: hash, thumbUrl: e.thumb, snap }, now, 'rss');
      if (c) changes.push({ video_id: e.video_id, field: c });
    }
  }
  store.db.prepare('UPDATE tracked_channels SET rss_checked_at = ?, name = COALESCE(name, ?), last_error = ? WHERE channel_id = ?')
    .run(now, feeds.channelName || null, feeds.errors.length ? feeds.errors.join('; ').slice(0, 300) : null, cid);
  const alerts = queueBreakouts(ctx, entries.filter((e) => now - e.published_at < 30 * HOUR).map((e) => e.video_id));
  return { data: { long: feeds.long.length, short: feeds.short.length, new: added, stats: stats.length, hashed, changes, alerts, errors: feeds.errors.length ? feeds.errors : undefined } };
}

async function videoBatch(ctx, jobs) {
  const { store, now } = ctx;
  const settings = nicheSettings(store);
  const items = await apiClient(ctx).videos(jobs.map((j) => j.video_id));
  const byId = new Map(items.map((it) => [it.id, it]));
  const stats = [];
  const results = {};
  for (const j of jobs) {
    const it = byId.get(j.video_id);
    if (!it) {
      const misses = ((j.data && j.data.misses) || 0) + 1;
      // Gone (deleted, private): ask again a few times, then stop.
      if (misses >= 3) { dropJob(store, j.id); results[j.id] = { next_at: FAR }; continue; }
      results[j.id] = { next_at: now + 7 * DAY, data: { misses } };
      continue;
    }
    const r = A.videoRecord(it, { now });
    const v = { video_id: j.video_id, channel_id: r.ownerId || j.channel_id, published_at: r.takenAt, title: r.caption, thumb: r.thumb, duration: r.duration, keywords: r.keywords, description: r.description, type: r.type === 'live' ? 'live' : null };
    upsertVideo(store, v, now, 'api');
    if (r.views != null) stats.push({ video_id: j.video_id, ts: now, views: r.views, likes: r.likes, comments: r.comments, source: 'api' });
    noteMeta(store, j.video_id, { title: r.caption, duration: r.duration }, now, 'api');
    const m = V.nextMeasure(r.takenAt || j.published_at || now, now, settings);
    results[j.id] = { next_at: m.next_at, tier: m.tier, data: null };
  }
  store.addVideoStats(stats);
  queueBreakouts(ctx, jobs.filter((j) => j.published_at && now - j.published_at < 30 * HOUR).map((j) => j.video_id));
  return results;
}

async function channelStatsJob(ctx) {
  const { store, now } = ctx;
  const ids = store.db.prepare('SELECT channel_id FROM tracked_channels WHERE active = 1').all().map((r) => r.channel_id);
  if (!ids.length) return { data: { channels: 0 } };
  const c = apiClient(ctx);
  const day = new Date(now).toISOString().slice(0, 10);
  let n = 0;
  for (const group of A.chunk(ids, 50)) {
    if (!ctx.quota.canSpend(1)) break;
    const body = await c.get('channels', { part: 'snippet,statistics', id: group.join(','), maxResults: 50 });
    for (const item of body.items || []) {
      const ch = A.channelInfo(item);
      if (!ch) continue;
      store.db.prepare(`INSERT INTO channel_stats (channel_id, day, subs, views, videos, source) VALUES (?, ?, ?, ?, ?, 'api')
        ON CONFLICT(channel_id, day) DO UPDATE SET subs = excluded.subs, views = excluded.views, videos = excluded.videos`).run(ch.channelId, day, ch.subscribers, ch.views, ch.videos);
      store.db.prepare('UPDATE tracked_channels SET subs = COALESCE(?, subs), name = COALESCE(?, name), handle = COALESCE(handle, ?) WHERE channel_id = ?')
        .run(ch.subscribers, ch.name, ch.handle, ch.channelId);
      n++;
    }
  }
  return { data: { channels: n, day } };
}

async function backfillJob(ctx, job) {
  const { store, now } = ctx;
  const cid = job.channel_id;
  const ch = store.db.prepare('SELECT * FROM tracked_channels WHERE channel_id = ?').get(cid);
  if (!ch || !ch.active) { dropJob(store, job.id); return { next_at: FAR }; }
  const account = (job.data && job.data.account) || ch.account_id || 'yt/' + cid;
  const lib = store.readLibrary();
  const known = (lib.accounts[account] && lib.accounts[account].posts) || {};
  const res = await A.channelUploads({ key: ctx.apiKey, fetch: ctx.fetch, onUnits: (n) => ctx.quota.spend(n), channelId: cid, owner: account, known, max: ctx.backfillMax || 500, now });
  const settings = nicheSettings(store);
  const stats = [];
  for (const r of res.records) {
    // The same records "All uploads via API" saves: into the library (exact beats rounded).
    store.mergePost(account, r.code, { ...r, owner: account }, { platform: 'youtube' });
    const v = { video_id: r.code, channel_id: cid, published_at: r.takenAt, type: r.type, title: r.caption, thumb: r.thumb, duration: r.duration, keywords: r.keywords, description: r.description };
    upsertVideo(store, v, now, 'backfill');
    if (r.views != null) stats.push({ video_id: r.code, ts: now, views: r.views, likes: r.likes, comments: r.comments, source: 'api' });
    noteMeta(store, r.code, { title: r.caption, duration: r.duration }, now, 'api');
    if (!hasJob(store, 'video:' + r.code)) scheduleVideo(store, v, now, settings, ctx.random);
  }
  store.addVideoStats(stats);
  const info = res.channel;
  store.mergeProfile(account, { channelId: info.channelId, handle: info.handle, name: info.name, avatar: info.avatar, subscribers: info.subscribers, videos: info.videos }, { platform: 'youtube' });
  store.db.prepare(`INSERT INTO channel_stats (channel_id, day, subs, views, videos, source) VALUES (?, ?, ?, ?, ?, 'api')
    ON CONFLICT(channel_id, day) DO UPDATE SET subs = excluded.subs, views = excluded.views, videos = excluded.videos`).run(cid, new Date(now).toISOString().slice(0, 10), info.subscribers, info.views ?? null, info.videos);
  store.db.prepare('UPDATE tracked_channels SET backfilled_at = ?, name = COALESCE(?, name), handle = COALESCE(?, handle), subs = COALESCE(?, subs) WHERE channel_id = ?')
    .run(now, info.name, info.handle, info.subscribers, cid);
  dropJob(store, job.id);
  return { next_at: FAR, data: { uploads: res.records.length, shorts: res.records.filter((r) => r.type === 'short').length } };
}

async function resolveJob(ctx, job) {
  const { store, now } = ctx;
  const d = job.data || {};
  if (!d.account || !d.handle) { dropJob(store, job.id); return { next_at: FAR }; }
  const ch = await apiClient(ctx).channel({ handle: d.handle });
  if (!ch) { store.setMeta('niche_resolve_error', { account: d.account, at: now, error: 'YouTube has no channel @' + d.handle }); return { next_at: now + 7 * DAY }; }
  store.mergeProfile(d.account, { channelId: ch.channelId, handle: ch.handle, name: ch.name, avatar: ch.avatar, subscribers: ch.subscribers, videos: ch.videos }, { platform: 'youtube' });
  dropJob(store, job.id);
  syncTracked(store, store.readLibrary(), { now, random: ctx.random });
  return { next_at: FAR, data: { channel_id: ch.channelId } };
}

/** The Monday (local time) of the week that contains t, as YYYY-MM-DD, and its start in ms. */
export function weekOf(t, tzOffsetMin = -new Date(t).getTimezoneOffset()) {
  const local = new Date(t + tzOffsetMin * MIN);
  const dow = (local.getUTCDay() + 6) % 7; // Monday = 0
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - dow) - tzOffsetMin * MIN;
  return { week: new Date(start + tzOffsetMin * MIN).toISOString().slice(0, 10), start };
}

function digestEvery(job, now) {
  // Next Monday 07:00 local time.
  const { start } = weekOf(now);
  let next = start + 7 * DAY + 7 * HOUR;
  if (next <= now) next += 7 * DAY;
  return next - now;
}

async function digestJob(ctx) {
  const { store, now } = ctx;
  const prev = weekOf(weekOf(now).start - DAY);
  const data = nicheReport(store, { week: prev.week, now });
  store.db.prepare('INSERT INTO niche_reports (week, data, created_at) VALUES (?, ?, ?) ON CONFLICT(week) DO UPDATE SET data = excluded.data, created_at = excluded.created_at')
    .run(prev.week, JSON.stringify(data), now);
  return { data: { week: prev.week, uploads: data.totals.uploads } };
}

/**
 * Breakout checks run once per niche per tracker tick (the tracker calls NICHE_AFTER_TICK.breakouts
 * with every job's candidates), not once per RSS job: each check rebuilds the niche model.
 * Without a tracker (a job run by hand) the check runs right away. → alerts added now (0 when queued)
 */
function queueBreakouts(ctx, ids) {
  if (!ids.length) return 0;
  if (typeof ctx.after === 'function') { ctx.after('breakouts', ids); return 0; }
  return checkBreakouts(ctx, ids);
}
export const NICHE_AFTER_TICK = { breakouts: (ctx, lists) => checkBreakouts(ctx, lists.flat()) };

export const NICHE_KINDS = {
  rss: { feature: 'tracker', every: 15 * MIN, jitter: 2 * MIN, units: 0, run: rssJob },
  video: {
    feature: 'tracker', jitter: 2 * MIN, units: 1, batchSize: 50, maxBatches: 10,
    every: (job, now) => V.ageTier(now - (job.published_at || now)).every,
    runBatch: videoBatch
  },
  'channel-stats': { singleton: true, feature: 'tracker', every: DAY, jitter: 30 * MIN, units: 1, run: channelStatsJob },
  backfill: { feature: 'tracker', every: DAY, jitter: 10 * MIN, units: 35, run: backfillJob },
  resolve: { feature: 'tracker', every: DAY, jitter: 5 * MIN, units: 1, run: resolveJob },
  // The first digest comes on the next Monday morning (the Niche page shows the running week until then).
  digest: { singleton: true, feature: 'weekly-digest', every: digestEvery, first: (now) => now + digestEvery(null, now), jitter: 20 * MIN, units: 0, run: digestJob }
};

// ---- the model: videos, curves and scores of a niche -----------------------------------

const memo = new Map();
const MEMO_MS = 60_000;

function parseJson(t, fallback) { try { return t ? JSON.parse(t) : fallback; } catch { return fallback; } }

/** The niches (folder / tag names) with active channels, biggest first. */
export function nicheNames(store) {
  return store.db.prepare(`SELECT COALESCE(niche, '') AS niche, COUNT(*) AS channels, SUM(mine) AS mine FROM tracked_channels WHERE active = 1
    GROUP BY COALESCE(niche, '') ORDER BY channels DESC`).all().map((r) => ({ name: r.niche || null, channels: r.channels, mine: r.mine || 0 }));
}

/**
 * Everything the insights need for one niche (null = every tracked channel).
 * Points are limited to each video's first 31 days (the curves stop at 30 d); the
 * latest reading of every video comes separately.
 */
export function loadModel(store, { niche, now = Date.now(), fresh = false, maxAge = 0 } = {}) {
  const key = store.file + '|' + (niche ?? '*');
  const hit = memo.get(key);
  // The signature is a write counter (store.statsRev: new video_stats rows, tracked_videos changes),
  // so a read costs one meta lookup. Read paths (the YouTube card lookups while the user scrolls)
  // pass maxAge to reuse a model that is a little behind instead of rebuilding after every write.
  const sig = store.statsRev();
  const age = hit ? now - hit.at : Infinity;
  if (!fresh && hit && age >= 0 && ((hit.sig === sig && age < MEMO_MS) || age < maxAge)) return hit.model;
  const where = niche === undefined || niche === null || niche === '*' ? '' : niche === '' ? ' AND niche IS NULL' : ' AND niche = ?';
  const args = where.includes('?') ? [niche] : [];
  const channels = store.db.prepare('SELECT * FROM tracked_channels WHERE active = 1' + where + ' ORDER BY mine DESC, name').all(...args);
  const chById = new Map(channels.map((c) => [c.channel_id, c]));
  const ids = channels.map((c) => c.channel_id);
  const q = ids.map(() => '?').join(',') || "''";
  const vids = store.db.prepare(`SELECT * FROM tracked_videos WHERE channel_id IN (${q})`).all(...ids);
  const byId = new Map();
  for (const v of vids) {
    byId.set(v.video_id, { id: v.video_id, channel_id: v.channel_id, published_at: v.published_at, type: v.type === 'short' ? 'short' : v.type === 'live' ? 'live' : 'video',
      title: v.title, thumb: v.thumb, duration: v.duration, keywords: parseJson(v.keywords, []), first_seen: v.first_seen, found_by: v.found_by, points: [], latest: null });
  }
  const pts = store.db.prepare(`SELECT s.video_id, s.ts, s.views, s.source FROM video_stats s JOIN tracked_videos t ON t.video_id = s.video_id
    WHERE t.channel_id IN (${q}) AND s.views IS NOT NULL AND (t.published_at IS NULL OR s.ts <= t.published_at + ?) ORDER BY s.ts`).all(...ids, 31 * DAY);
  for (const p of pts) { const v = byId.get(p.video_id); if (v) v.points.push({ ts: p.ts, views: p.views, source: p.source }); }
  const latest = store.db.prepare(`SELECT s.video_id, s.ts, s.views, s.likes, s.comments FROM video_stats s
    JOIN (SELECT video_id, MAX(ts) AS ts FROM video_stats WHERE views IS NOT NULL AND video_id IN (SELECT video_id FROM tracked_videos WHERE channel_id IN (${q})) GROUP BY video_id) m
    ON m.video_id = s.video_id AND m.ts = s.ts`).all(...ids);
  for (const l of latest) { const v = byId.get(l.video_id); if (v) v.latest = { ts: l.ts, views: l.views, likes: l.likes, comments: l.comments }; }

  const videos = [...byId.values()].filter((v) => v.published_at);
  for (const v of videos) v.cp = V.checkpoints(v);
  // Per channel and format: baseline (typical views, from the latest readings) and own curve.
  const fmt = (v) => (v.type === 'short' ? 'short' : 'long');
  const groups = new Map();
  for (const v of videos) {
    const k = v.channel_id + '|' + fmt(v);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(v);
  }
  const perGroup = new Map();
  for (const [k, list] of groups) {
    const base = V.baseline(list.map((v) => ({ published_at: v.published_at, views: v.latest ? v.latest.views : null })), now);
    perGroup.set(k, { baseline: base, own: V.curve(list), n: list.length });
    for (const v of list) v.baseline = base;
  }
  const niches = { long: V.nicheCurve(videos.filter((v) => fmt(v) === 'long')), short: V.nicheCurve(videos.filter((v) => fmt(v) === 'short')) };
  for (const [k, g] of perGroup) g.expected = V.expectedCurve(g.own, niches[k.split('|')[1]], g.baseline);
  for (const v of videos) {
    const g = perGroup.get(v.channel_id + '|' + fmt(v));
    v.expected = g.expected;
    v.velocity = V.velocity(v, g.expected, now);
    const ch = chById.get(v.channel_id);
    v.vps48 = V.viewsPerSub(v, ch && ch.subs);
    v.evergreen = V.evergreen(v);
  }
  const model = { niche: niche ?? null, now, channels, chById, videos, byId, perGroup, niches, settings: nicheSettings(store) };
  memo.set(key, { sig, at: now, model });
  return model;
}

// ---- breakouts ---------------------------------------------------------------------------

/** After new measurements: record breakouts of the given (young) videos. → number of new alerts */
export function checkBreakouts(ctx, videoIds) {
  if (!videoIds.length || ctx.flags['breakout-alerts'] === false) return 0;
  const { store, now } = ctx;
  const ins = store.db.prepare('INSERT OR IGNORE INTO niche_alerts (video_id, at_h, score, views, expected, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  // Each video against its own niche's curves.
  const byNiche = new Map();
  for (const id of new Set(videoIds)) {
    const r = store.db.prepare('SELECT c.niche FROM tracked_videos v JOIN tracked_channels c ON c.channel_id = v.channel_id WHERE v.video_id = ?').get(id);
    if (!r) continue;
    const k = r.niche ?? '';
    if (!byNiche.has(k)) byNiche.set(k, []);
    byNiche.get(k).push(id);
  }
  let n = 0;
  for (const [niche, ids] of byNiche) {
    const model = loadModel(store, { niche, now, fresh: true });
    const ratio = model.settings.breakoutRatio;
    for (const id of ids) {
      const v = model.byId.get(id);
      if (!v || !v.expected) continue;
      for (const b of V.breakouts(v, v.expected, { ratio })) n += Number(ins.run(id, b.at, Math.round(b.score * 100) / 100, b.views, b.expected, now).changes);
    }
  }
  return n;
}

function videoBrief(model, v, now, { points = false } = {}) {
  const ch = model.chById.get(v.channel_id) || {};
  const vel = v.velocity;
  const vph = V.vph24(v.points.length ? v.points : (v.latest ? [{ ts: v.latest.ts, views: v.latest.views }] : []), v.published_at, now);
  const out = {
    id: v.id, title: v.title, type: v.type, duration: v.duration, thumb: v.thumb || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
    url: v.type === 'short' ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}`,
    channel_id: v.channel_id, channel: ch.name || ch.handle || v.channel_id, account: ch.account_id || null, mine: !!ch.mine,
    published_at: v.published_at, age_h: Math.round((now - v.published_at) / HOUR * 10) / 10,
    views: v.latest ? v.latest.views : null, likes: v.latest ? v.latest.likes : null, comments: v.latest ? v.latest.comments : null,
    score: vel ? Math.round(vel.score * 100) / 100 : null, score_at: vel ? vel.label : null, expected: vel ? vel.expected : null, curve_from: vel ? vel.source : null,
    vph24: vph ? Math.round(vph.vph) : null, vph_lifetime: v.latest ? Math.round(V.lifetimeVph(v.latest.views, v.published_at, now) || 0) : null,
    views_48h: v.cp[48], views_per_sub_48h: v.vps48 == null ? null : Math.round(v.vps48 * 1000) / 1000,
    evergreen: v.evergreen ? { ratio: Math.round(v.evergreen.ratio * 100) / 100, kind: v.evergreen.kind } : null
  };
  if (points) {
    const age = (now - v.published_at) / HOUR;
    out.spark = {
      points: V.series(v.points, v.published_at).map((p) => [Math.round(p.h * 100) / 100, p.v]),
      expected: V.CHECKPOINTS.filter((h) => v.expected && v.expected[h] && h <= Math.max(age * 1.25, 1)).map((h) => [h, Math.round(v.expected[h].value)])
    };
  }
  return out;
}

function scored(model, now, sinceMs = 120 * DAY) {
  // A video's "48 h velocity" where known, else its latest score (only videos the tracker saw young enough).
  return model.videos.filter((v) => now - v.published_at <= sinceMs).map((v) => {
    const s48 = v.expected ? V.scoreAt(v, v.expected, 48) : null;
    const score = s48 != null ? s48 : v.velocity ? v.velocity.score : null;
    return score == null ? null : { id: v.id, channel_id: v.channel_id, published_at: v.published_at, type: v.type, duration: v.duration, title: v.title, keywords: v.keywords, score };
  }).filter(Boolean);
}

function curvesOf(model) {
  const out = {};
  for (const f of ['long', 'short']) {
    const vids = model.videos.filter((v) => (v.type === 'short' ? 'short' : 'long') === f);
    const share = V.shareCurve(vids);
    const norm = model.niches[f];
    const r = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
    out[f] = {
      videos: vids.length,
      tracked_young: vids.filter((v) => v.cp[1] != null || v.cp[3] != null || v.cp[6] != null).length,
      share: Object.fromEntries(V.CHECKPOINTS.map((h) => [h, r(share.values[h])])), share_n: share.n, share_videos: share.videos,
      norm: Object.fromEntries(V.CHECKPOINTS.map((h) => [h, r(norm.values[h])])), norm_n: norm.n,
      share_48h: share.values[48] != null ? r(share.values[48]) : null
    };
  }
  return out;
}

function lagOf(store, now, days = 7) {
  const rows = store.db.prepare(`SELECT s.video_id, s.ts, s.views, s.source FROM video_stats s
    WHERE s.ts >= ? AND s.source IN ('rss', 'api') AND s.video_id IN (
      SELECT video_id FROM video_stats WHERE ts >= ? AND source = 'rss' INTERSECT SELECT video_id FROM video_stats WHERE ts >= ? AND source = 'api')`)
    .all(now - days * DAY, now - days * DAY, now - days * DAY);
  const pub = {};
  for (const r of store.db.prepare('SELECT video_id, published_at FROM tracked_videos WHERE video_id IN (SELECT DISTINCT video_id FROM video_stats WHERE ts >= ? AND source = \'rss\')').all(now - days * DAY)) pub[r.video_id] = r.published_at;
  return { days, ...V.rssLag(rows, pub) };
}

/** The RSS-vs-API diagnostic (bridge_status and the Niche page). */
export function rssLagReport(store, { now = Date.now(), days = 7 } = {}) {
  const r = lagOf(store, now, days);
  r.how_to_read = 'For each RSS reading, lag = how many minutes earlier the Data API already had that view count (interpolated between two API readings of the same video). young_lag_min covers videos under 48 h, where it matters. gap_pct = how far below the API count RSS was when both were read within 10 minutes. Verdict: collecting (fewer than 12 samples), rss-ok (median lag ≤ 60 min), rss-lags (> 60 min: the hourly API readings carry the first 48 h; plan 2.2).';
  return r;
}

export function growthOf(store, channels, now, days = 90) {
  const from = new Date(now - days * DAY).toISOString().slice(0, 10);
  return channels.map((c) => {
    const series = store.db.prepare('SELECT day, subs, views, videos FROM channel_stats WHERE channel_id = ? AND day >= ? ORDER BY day').all(c.channel_id, from);
    const delta = (n) => {
      if (!series.length) return null;
      const last = series[series.length - 1];
      const cut = new Date(Date.parse(last.day) - n * DAY).toISOString().slice(0, 10);
      const base = series.filter((s) => s.day <= cut).pop() || null;
      return base ? { subs: last.subs != null && base.subs != null ? last.subs - base.subs : null, views: last.views != null && base.views != null ? last.views - base.views : null, days: Math.round((Date.parse(last.day) - Date.parse(base.day)) / DAY) } : null;
    };
    return { channel_id: c.channel_id, name: c.name || c.handle || c.channel_id, account: c.account_id, mine: !!c.mine, subs: c.subs, series, delta_7d: delta(7), delta_28d: delta(28) };
  });
}

function changesOf(store, model, now, days = 60) {
  const ids = [...model.byId.keys()];
  if (!ids.length) return [];
  const rows = store.db.prepare(`SELECT * FROM video_meta_log WHERE video_id IN (${ids.map(() => '?').join(',')}) ORDER BY video_id, ts`).all(...ids);
  const by = new Map();
  for (const r of rows) { if (!by.has(r.video_id)) by.set(r.video_id, []); by.get(r.video_id).push(r); }
  const out = [];
  for (const [id, log] of by) {
    if (log.length < 2) continue;
    const v = model.byId.get(id);
    const all = store.videoStats(id).filter((p) => p.views != null);
    const list = [];
    for (let i = 1; i < log.length; i++) {
      const a = log[i - 1];
      const b = log[i];
      if (now - b.ts > days * DAY) continue;
      const field = a.title !== b.title ? 'title' : 'thumb';
      const s = V.slopeAround(all, v.published_at, b.ts, 24);
      list.push({ at: b.ts, field, before: field === 'title' ? a.title : a.thumb_hash, after: field === 'title' ? b.title : b.thumb_hash,
        slope_before: s.before == null ? null : Math.round(s.before), slope_after: s.after == null ? null : Math.round(s.after) });
    }
    if (list.length) {
      const ch = model.chById.get(v.channel_id) || {};
      out.push({ id, title: v.title, thumb: v.thumb || `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, channel: ch.name || ch.handle, mine: !!ch.mine, type: v.type, changes: list.reverse() });
    }
  }
  out.sort((a, b) => b.changes[0].at - a.changes[0].at);
  return out.slice(0, 30);
}

/** My videos next to the niche: views at 48 h and per subscriber, against channels of my size (⅓× to 3× subs). */
function mineVsNiche(model, now) {
  const mine = model.channels.filter((c) => c.mine);
  if (!mine.length) return { channels: [], videos: [] };
  const others = model.channels.filter((c) => !c.mine);
  const out = [];
  for (const c of mine) {
    const similar = others.filter((o) => c.subs > 0 && o.subs > 0 && o.subs >= c.subs / 3 && o.subs <= c.subs * 3);
    const peers = similar.length >= 2 ? similar : others;
    const scope = similar.length >= 2 ? 'similar' : 'niche';
    const peerIds = new Set(peers.map((p) => p.channel_id));
    for (const f of ['long', 'short']) {
      const pv = model.videos.filter((v) => peerIds.has(v.channel_id) && (v.type === 'short' ? 'short' : 'long') === f);
      const m48 = V.median(pv.map((v) => v.cp[48]));
      const mvps = V.median(pv.map((v) => v.vps48));
      const my = model.videos.filter((v) => v.channel_id === c.channel_id && (v.type === 'short' ? 'short' : 'long') === f && now - v.published_at <= 120 * DAY)
        .sort((a, b) => b.published_at - a.published_at).slice(0, 8);
      for (const v of my) {
        out.push({ ...videoBrief(model, v, now), format: f, peers: { scope, channels: peers.length, videos: pv.filter((x) => x.cp[48] != null).length, views_48h: m48 == null ? null : Math.round(m48), views_per_sub_48h: mvps == null ? null : Math.round(mvps * 1000) / 1000 } });
      }
    }
  }
  out.sort((a, b) => b.published_at - a.published_at);
  return { channels: mine.map((c) => ({ channel_id: c.channel_id, name: c.name, subs: c.subs })), videos: out };
}

/**
 * For the Kanalım page's video report card (phase 2): the niche's median views at 48 h, 7 d and
 * 30 d per format, among channels the size of `channelId` (⅓× to 3× subscribers, the same peers as
 * mineVsNiche) or the whole niche, plus the channel's own tracked checkpoints per video.
 * → null when the channel isn't tracked.
 */
export function peerMedians(store, channelId, { now = Date.now() } = {}) {
  const ch = store.db.prepare('SELECT * FROM tracked_channels WHERE channel_id = ? AND active = 1').get(channelId);
  if (!ch) return null;
  const model = loadModel(store, { niche: ch.niche ?? '', now });
  const me = model.chById.get(channelId) || ch;
  const others = model.channels.filter((c) => c.channel_id !== channelId);
  const similar = others.filter((o) => me.subs > 0 && o.subs > 0 && o.subs >= me.subs / 3 && o.subs <= me.subs * 3);
  const peers = similar.length >= 2 ? similar : others;
  const peerIds = new Set(peers.map((p) => p.channel_id));
  const out = { niche: model.niche, scope: similar.length >= 2 ? 'similar' : 'niche', channels: peers.length, long: {}, short: {}, videos: {} };
  for (const f of ['long', 'short']) {
    const pv = model.videos.filter((v) => peerIds.has(v.channel_id) && (v.type === 'short' ? 'short' : 'long') === f);
    for (const h of [48, 168, 720]) {
      const m = V.median(pv.map((v) => v.cp[h]));
      out[f][h] = m == null ? null : Math.round(m);
    }
    out[f].n = pv.filter((v) => v.cp[48] != null).length;
  }
  for (const v of model.videos.filter((x) => x.channel_id === channelId)) out.videos[v.id] = { 48: v.cp[48], 168: v.cp[168], 720: v.cp[720], latest: v.latest ? v.latest.views : null };
  return out;
}

function breakoutRows(store, model, now, days = 14) {
  const ids = [...model.byId.keys()];
  if (!ids.length) return [];
  const rows = store.db.prepare(`SELECT * FROM niche_alerts WHERE created_at >= ? AND video_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at DESC`).all(now - days * DAY, ...ids);
  const seen = new Map();
  for (const r of rows) {
    const prev = seen.get(r.video_id);
    if (!prev || r.at_h > prev.at_h) seen.set(r.video_id, r);
  }
  return [...seen.values()].sort((a, b) => b.created_at - a.created_at).map((r) => {
    const v = model.byId.get(r.video_id);
    return { ...videoBrief(model, v, now, { points: true }), alert: { at: V.cpLabel(r.at_h), at_h: r.at_h, score: r.score, views: r.views, expected: r.expected, created_at: r.created_at, notified: !!r.notified_at } };
  });
}

function uploadsPerWeek(model, now) {
  const weeks = 8;
  return model.channels.map((c) => {
    const list = model.videos.filter((v) => v.channel_id === c.channel_id && now - v.published_at <= weeks * 7 * DAY);
    const s = list.map((v) => (v.velocity ? v.velocity.score : null));
    return { channel_id: c.channel_id, name: c.name || c.handle, per_week: Math.round(list.length / weeks * 10) / 10, median_score: V.median(s) == null ? null : Math.round(V.median(s) * 100) / 100 };
  }).sort((a, b) => b.per_week - a.per_week);
}

/**
 * The weekly digest for a niche: uploads of the week ranked, breakouts, growth,
 * the best slot, and my channel. week: YYYY-MM-DD (a Monday, local time).
 */
export function nicheReport(store, { niche, week, now = Date.now(), tzOffsetMin } = {}) {
  const tz = tzOffsetMin ?? -new Date(now).getTimezoneOffset();
  const w = week ? { week, start: Date.parse(week + 'T00:00:00Z') - tz * MIN } : weekOf(now, tz);
  const end = w.start + 7 * DAY;
  const model = loadModel(store, { niche, now });
  const inWeek = model.videos.filter((v) => v.published_at >= w.start && v.published_at < end);
  const ranked = inWeek.map((v) => videoBrief(model, v, now)).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.published_at - a.published_at);
  const ww = V.whatWorks(scored(model, now), { tzOffsetMin: tz });
  const growth = growthOf(store, model.channels, now, 35);
  const alerts = store.db.prepare('SELECT video_id, MAX(score) AS score, MAX(at_h) AS at_h FROM niche_alerts WHERE created_at >= ? AND created_at < ? GROUP BY video_id ORDER BY score DESC')
    .all(w.start, end).filter((a) => model.byId.has(a.video_id))
    .map((a) => ({ ...videoBrief(model, model.byId.get(a.video_id), now), alert: { score: a.score, at: V.cpLabel(a.at_h) } }));
  const mine = mineVsNiche(model, now);
  return {
    niche: model.niche, week: w.week, from: new Date(w.start).toISOString(), to: new Date(end).toISOString(), complete: now >= end,
    totals: { channels: model.channels.length, uploads: inWeek.length, shorts: inWeek.filter((v) => v.type === 'short').length, breakouts: alerts.length },
    top: ranked.slice(0, 5), breakouts: alerts.slice(0, 10),
    best_slot: { day: ww.best_day, block: ww.best_block, tz_offset_min: tz, based_on: ww.videos },
    growth: growth.filter((g) => g.delta_7d).sort((a, b) => (b.delta_7d.subs || 0) - (a.delta_7d.subs || 0)).slice(0, 5)
      .map((g) => ({ channel: g.name, mine: g.mine, subs: g.subs, subs_7d: g.delta_7d.subs, views_7d: g.delta_7d.views })),
    mine: mine.videos.filter((v) => v.published_at >= w.start && v.published_at < end),
    curves: curvesOf(model),
    note: 'Numbers only; the commentary is written by Claude (plan 2.4). score = views ÷ the channel\'s expected views at the latest checkpoint (≥ 3× is a breakout).'
  };
}

/** The Library's Niş Takibi page: everything in one answer. */
export function nichePage(store, { niche, now = Date.now(), tzOffsetMin, status } = {}) {
  const names = nicheNames(store);
  const pick = niche !== undefined && niche !== null ? niche : (names.find((n) => n.mine) || names[0] || { name: null }).name;
  const model = loadModel(store, { niche: pick ?? '', now });
  const tz = tzOffsetMin ?? -new Date(now).getTimezoneOffset();
  const week = model.videos.filter((v) => now - v.published_at <= 7 * DAY)
    .map((v) => videoBrief(model, v, now, { points: true }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.published_at - a.published_at);
  const sc = scored(model, now);
  const lastDigest = store.db.prepare('SELECT week, data, created_at FROM niche_reports ORDER BY week DESC LIMIT 1').get();
  const counts = Object.fromEntries(store.db.prepare('SELECT kind, COUNT(*) AS n FROM tracker_jobs GROUP BY kind').all().map((r) => [r.kind, r.n]));
  return {
    ok: true, now, niche: pick ?? null, niches: names,
    settings: model.settings,
    channels: model.channels.map((c) => {
      const vids = model.videos.filter((v) => v.channel_id === c.channel_id);
      return { channel_id: c.channel_id, account: c.account_id, name: c.name || c.handle || c.channel_id, handle: c.handle, mine: !!c.mine, subs: c.subs,
        videos: vids.length, young: vids.filter((v) => v.cp[6] != null).length, last_upload: vids.reduce((m, v) => Math.max(m, v.published_at), 0) || null,
        rss_checked_at: c.rss_checked_at, backfilled_at: c.backfilled_at, added_at: c.added_at, error: c.last_error || null };
    }),
    unresolved: store.getMeta('niche_unresolved', []),
    week, curves: curvesOf(model),
    what_works: { ...V.whatWorks(sc, { tzOffsetMin: tz }), uploads_per_week: uploadsPerWeek(model, now) },
    gaps: V.topicGaps(sc),
    changes: changesOf(store, model, now),
    mine: mineVsNiche(model, now),
    growth: growthOf(store, model.channels, now),
    breakouts: breakoutRows(store, model, now),
    digest: lastDigest ? { week: lastDigest.week, created_at: lastDigest.created_at, ...parseJson(lastDigest.data, {}) } : null,
    digest_preview: nicheReport(store, { niche: pick ?? '', now, tzOffsetMin: tz }),
    rss_lag: rssLagReport(store, { now }),
    jobs: counts,
    status: status || null
  };
}

// ---- MCP tools ------------------------------------------------------------------------------

function findChannel(store, ref) {
  const r = String(ref || '').trim();
  if (!r) return null;
  const rows = store.db.prepare('SELECT * FROM tracked_channels').all();
  const n = TR.norm(r.replace(/^yt\//, ''));
  return rows.find((c) => c.channel_id === r || c.account_id === r || 'yt/' + c.channel_id === r || TR.norm(c.handle) === n || TR.norm(c.name) === n || TR.norm(String(c.account_id).slice(3)) === n) || null;
}

/** niche_pulse: the last N days of a niche. */
export function nichePulse(store, { niche, days = 7, limit = 25, now = Date.now() } = {}) {
  const names = nicheNames(store);
  if (!names.length) return { tracked: false, hint: 'No channel is tracked yet. In the Library, mark a folder or tag as a tracked niche (or press Track on a channel page), with the bridge running and a Data API key copied to it.' };
  const pick = niche ?? (names.find((x) => x.mine) || names[0]).name;
  const model = loadModel(store, { niche: pick ?? '', now });
  const recent = model.videos.filter((v) => now - v.published_at <= days * DAY).map((v) => videoBrief(model, v, now))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const c = curvesOf(model);
  return {
    niche: pick, niches: names, days, channels: model.channels.length,
    uploads: recent.length, shorts: recent.filter((v) => v.type === 'short').length,
    ranked: recent.slice(0, limit),
    curves: { long_share_48h: c.long.share_48h, short_share_48h: c.short.share_48h, long_videos: c.long.videos, short_videos: c.short.videos },
    breakouts: breakoutRows(store, model, now, days).map((b) => ({ id: b.id, title: b.title, channel: b.channel, alert: b.alert })),
    note: 'score = views ÷ expected views at the latest checkpoint (1/3/6/12/24/48/72 h, 7/14/30 d); expected = the channel\'s median curve, or the niche\'s curve scaled to the channel until it has 5 tracked videos.'
  };
}

/** video_velocity: one video's curve next to its channel's expected curve. */
export function videoVelocity(store, { video, now = Date.now() } = {}) {
  const m = /(?:v=|shorts\/|youtu\.be\/)?([A-Za-z0-9_-]{11})(?:[?&#]|$)/.exec(String(video || '').trim());
  const id = m && VIDEO_ID_RE.test(m[1]) ? m[1] : null;
  if (!id) return { error: 'Give a YouTube video id or URL.' };
  const row = store.db.prepare('SELECT channel_id FROM tracked_videos WHERE video_id = ?').get(id);
  if (!row) return { error: `Video ${id} is not tracked (only videos of tracked channels have curves).` };
  const ch = store.db.prepare('SELECT niche FROM tracked_channels WHERE channel_id = ?').get(row.channel_id);
  const model = loadModel(store, { niche: ch ? ch.niche ?? '' : '', now });
  const v = model.byId.get(id);
  if (!v) return { error: `Video ${id} has no publish time yet.` };
  const all = store.videoStats(id);
  const g = model.perGroup.get(v.channel_id + '|' + (v.type === 'short' ? 'short' : 'long'));
  const fmtFull = (x) => (x == null ? null : Math.round(x));
  const log = store.db.prepare('SELECT ts, title, thumb_hash FROM video_meta_log WHERE video_id = ? ORDER BY ts').all(id);
  return {
    video: videoBrief(model, v, now),
    checkpoints: V.CHECKPOINTS.map((h) => ({ at: V.cpLabel(h), hours: h, views: v.cp[h], expected: v.expected && v.expected[h] ? fmtFull(v.expected[h].value) : null,
      expected_from: v.expected && v.expected[h] ? v.expected[h].source : null, score: v.expected && v.expected[h] && v.cp[h] != null ? Math.round(v.cp[h] / v.expected[h].value * 100) / 100 : null })),
    channel_baseline: g ? fmtFull(g.baseline) : null,
    channel_curve_videos: g ? g.own.n : null,
    niche_curve_x_baseline: Object.fromEntries(V.CHECKPOINTS.map((h) => [V.cpLabel(h), model.niches[v.type === 'short' ? 'short' : 'long'].values[h] != null && g && g.baseline ? fmtFull(model.niches[v.type === 'short' ? 'short' : 'long'].values[h] * g.baseline) : null])),
    measurements: all.length, measurements_by_source: all.reduce((o, p) => { o[p.source] = (o[p.source] || 0) + 1; return o; }, {}),
    series: downsample(all, 60).map((p) => ({ at: new Date(p.ts).toISOString(), hours: Math.round((p.ts - v.published_at) / HOUR * 10) / 10, views: p.views, likes: p.likes, source: p.source })),
    title_thumbnail_log: log.map((l) => ({ at: new Date(l.ts).toISOString(), title: l.title, thumb_hash: l.thumb_hash }))
  };
}

function downsample(list, n) {
  if (list.length <= n) return list;
  const out = [];
  for (let i = 0; i < n; i++) out.push(list[Math.round(i * (list.length - 1) / (n - 1))]);
  return out;
}

/** breakouts: recent alerts (≥ the threshold at 6 h or 24 h). */
export function breakoutList(store, { niche, days = 7, now = Date.now() } = {}) {
  const model = loadModel(store, { niche: niche ?? '*', now });
  return { threshold: model.settings.breakoutRatio, days, breakouts: breakoutRows(store, model, now, days).map((b) => { delete b.spark; return b; }) };
}

/** channel_growth: daily subscribers, views and video count since tracking started. */
export function channelGrowth(store, { channel, days = 90, now = Date.now() } = {}) {
  const rows = channel ? [findChannel(store, channel)].filter(Boolean) : store.db.prepare('SELECT * FROM tracked_channels WHERE active = 1').all();
  if (!rows.length) return { error: channel ? `${channel} is not a tracked channel.` : 'No channel is tracked yet.' };
  const g = growthOf(store, rows, now, days);
  return { days, channels: channel ? g : g.map((x) => ({ ...x, series: undefined, days_recorded: x.series.length })), note: channel ? undefined : 'Pass channel for the daily series.' };
}

/** For bridge_status. */
export function trackingSummary(store, now = Date.now()) {
  const one = (sql, ...a) => store.db.prepare(sql).get(...a);
  return {
    channels: one('SELECT COUNT(*) AS n FROM tracked_channels WHERE active = 1').n,
    mine: one('SELECT COUNT(*) AS n FROM tracked_channels WHERE active = 1 AND mine = 1').n,
    niches: nicheNames(store),
    videos: one('SELECT COUNT(*) AS n FROM tracked_videos').n,
    last_rss_at: (() => { const t = one('SELECT MAX(rss_checked_at) AS t FROM tracked_channels').t; return t ? new Date(t).toISOString() : null; })(),
    unresolved: store.getMeta('niche_unresolved', []),
    alerts_7d: one('SELECT COUNT(*) AS n FROM niche_alerts WHERE created_at >= ?', now - 7 * DAY).n,
    settings: nicheSettings(store),
    rss_lag: rssLagReport(store, { now })
  };
}

/** Alerts the extension hasn't shown yet (it marks them with ackAlerts). */
export function pendingAlerts(store, now = Date.now()) {
  const rows = store.db.prepare(`SELECT a.*, v.title, v.type, v.channel_id, c.name AS channel FROM niche_alerts a
    JOIN tracked_videos v ON v.video_id = a.video_id LEFT JOIN tracked_channels c ON c.channel_id = v.channel_id
    WHERE a.notified_at IS NULL AND a.created_at >= ? ORDER BY a.created_at`).all(now - 2 * DAY);
  return rows.map((r) => ({ video_id: r.video_id, at_h: r.at_h, at: V.cpLabel(r.at_h), score: r.score, views: r.views, expected: r.expected, title: r.title, type: r.type, channel: r.channel }));
}
export function ackAlerts(store, list, now = Date.now()) {
  const up = store.db.prepare('UPDATE niche_alerts SET notified_at = ? WHERE video_id = ? AND at_h = ? AND notified_at IS NULL');
  let n = 0;
  for (const a of list || []) if (a && VIDEO_ID_RE.test(String(a.video_id)) && Number.isFinite(Number(a.at_h))) n += Number(up.run(now, a.video_id, Number(a.at_h)).changes);
  return n;
}

/**
 * Phase 5 (discovery): what a niche's tracked videos say about topics, for the radar's keyword
 * suggestions and the keyword ideas: title words by velocity lift, topic gaps, and the titles.
 */
export function nicheSignals(store, { niche, now = Date.now() } = {}) {
  const names = nicheNames(store);
  const pick = niche !== undefined && niche !== null ? niche : (names.find((n) => n.mine) || names[0] || { name: null }).name;
  const model = loadModel(store, { niche: pick ?? '', now });
  const sc = scored(model, now);
  return {
    niche: pick ?? null,
    niches: names,
    channels: model.channels,
    titles: model.videos.map((v) => v.title).filter(Boolean),
    texts: model.videos.map((v) => [v.title || ''].concat(v.keywords || []).join(' ')),
    titleWords: V.wordLift(sc, { limit: 15, minN: 2 }),
    gaps: V.topicGaps(sc, { limit: 10 })
  };
}
