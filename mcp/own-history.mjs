// OpenOutlier – own-channel history (docs/youtube-niche-plan.md 3, phase 2).
//
// The bridge keeps a daily copy of each connected channel's YouTube Analytics so the
// Library's Kanalım page can show progress over time (Studio only shows what Google
// keeps; we keep everything, on this Mac):
//   own_daily        one row per channel and Analytics day (Pacific time): views, engaged
//                    views, watch minutes, average view duration and %, subscribers gained /
//                    lost, likes, comments, shares; thumbnail impressions + CTR where the API
//                    gives them by day; Shorts / long-form split (creatorContentType); revenue
//                    once the channel is in the Partner Program (own-revenue).
//   own_video_daily  the same per video, for uploads of the last 90 days.
//   own_breakdowns   one snapshot per Analytics week (Monday) and kind: traffic sources, the
//                    YouTube search terms that found the channel, countries, age × gender,
//                    devices, subscribed or not, playback locations.
//
// Jobs (mcp/tracker.mjs, gated on the own-history feature, no Data API key units: the
// Analytics API and the OAuth client's own project are used):
//   own-channels   every 5 min: the connected channels (one token file each) → own_channels,
//                  and each channel's jobs below; a disconnected channel's jobs go (its data stays).
//   own-backfill   once per channel: from today back to the channel's first day, 180 days per
//                  request (6 per run, a minute apart), newest first so the page fills fast.
//   own-daily      ~06:00 local: the last 7 days again (Analytics lags 2–3 days and corrects
//                  itself), the channel's subscriber count, milestones.
//   own-videos     ~06:20 local: per-video daily rows of the last 90 days' uploads.
//   own-weekly     ~06:40 local: breakdowns of the last two complete weeks until they settle,
//                  and the last 12 weeks the first time.
// Queries for the page, the MCP tools and the bridge's settings answer (milestones) are at the end.
import { createRequire } from 'node:module';
import * as YA from './youtube-analytics.mjs';
import { upsertJob, peerMedians } from './niche.mjs';

const require = createRequire(import.meta.url);
const OM = require('../src/own-metrics.js');
const A = require('../src/youtube-api.js');
const V = require('../src/velocity.js');

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const FAR = 8.64e15;
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
export const CHUNK_DAYS = 180;
export const CHUNKS_PER_RUN = 6;
export const REFETCH_DAYS = 7;
export const VIDEO_WINDOW_DAYS = 90;
export const BREAKDOWN_WEEKS = 12;
const YOUTUBE_START = '2005-04-23';

/** Today as an Analytics day (Pacific time, like Google's quota day). */
export const today = (now) => A.quotaDay(now);
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const parse = (t, f) => { try { return t ? JSON.parse(t) : f; } catch { return f; } };

/** ms until the next hh:mm local time (the Mac's clock). */
export function untilLocal(now, hh, mm = 0) {
  const d = new Date(now);
  let t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm).getTime();
  if (t <= now) t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, hh, mm).getTime();
  return t - now;
}

// ---- writing ----------------------------------------------------------------------------
function merge(store, table, keyCols, keyVals, patch, now, extra = {}) {
  const where = keyCols.map((c) => c + ' = ?').join(' AND ');
  const old = store.db.prepare(`SELECT metric FROM ${table} WHERE ${where}`).get(...keyVals);
  const next = { ...parse(old && old.metric, {}), ...patch };
  const cols = [...keyCols, 'metric', 'updated_at', ...Object.keys(extra)];
  store.db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
    ON CONFLICT(${keyCols.join(', ')}) DO UPDATE SET metric = excluded.metric, updated_at = excluded.updated_at${Object.keys(extra).map((k) => `, ${k} = COALESCE(excluded.${k}, ${table}.${k})`).join('')}`)
    .run(...keyVals, JSON.stringify(next), now, ...Object.values(extra));
}
function tx(store, fn) {
  store.db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); store.db.exec('COMMIT'); return r; } catch (e) { store.db.exec('ROLLBACK'); throw e; }
}
function setChannel(store, cid, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  store.db.prepare(`UPDATE own_channels SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE channel_id = ?`).run(...keys.map((k) => fields[k]), cid);
}
function hasJob(store, id) { return !!store.db.prepare('SELECT 1 FROM tracker_jobs WHERE id = ?').get(id); }
function dropJob(store, id) { store.db.prepare('DELETE FROM tracker_jobs WHERE id = ?').run(id); }
function channelRow(store, cid) { return store.db.prepare('SELECT * FROM own_channels WHERE channel_id = ?').get(cid) || null; }

// ---- Analytics rows → our fields ------------------------------------------------------------
export function dailyFields(r) {
  return {
    views: num(r.views), engaged: num(r.engagedViews), minutes: num(r.estimatedMinutesWatched), avg_dur: num(r.averageViewDuration), avg_pct: num(r.averageViewPercentage),
    subs_gained: num(r.subscribersGained), subs_lost: num(r.subscribersLost), likes: num(r.likes), comments: num(r.comments), shares: num(r.shares)
  };
}
export function reachFields(r) { return { impressions: num(r.videoThumbnailImpressions), ctr: num(r.videoThumbnailImpressionsClickRate) }; }
export function revenueFields(r) {
  return {
    revenue: num(r.estimatedRevenue), ad_revenue: num(r.estimatedAdRevenue), gross_revenue: num(r.grossRevenue), cpm: num(r.cpm),
    playback_cpm: num(r.playbackBasedCpm), monetized_playbacks: num(r.monetizedPlaybacks), ad_impressions: num(r.adImpressions)
  };
}
function videoFields(r) {
  return { views: num(r.views), engaged: num(r.engagedViews), minutes: num(r.estimatedMinutesWatched), avg_dur: num(r.averageViewDuration), avg_pct: num(r.averageViewPercentage),
    likes: num(r.likes), comments: num(r.comments), shares: num(r.shares), subs_gained: num(r.subscribersGained) };
}

/** [[start, end], …] newest first, `size` days each, covering from → to. */
export function chunks(from, to, size = CHUNK_DAYS) {
  const out = [];
  let end = to;
  while (end >= from) {
    const start = OM.addDays(end, -size + 1) < from ? from : OM.addDays(end, -size + 1);
    out.push([start, end]);
    end = OM.addDays(start, -1);
  }
  return out;
}

function report(ctx, cid, q) {
  return YA.apiGet(YA.reportUrl(q), { fetch: ctx.fetch, now: ctx.now, channel: cid }).then(YA.rowsOf);
}
/** A refusal that means "this query isn't available for this channel" (vs a network or sign-in problem). */
const refused = (e) => e && (e.code === 'bad_query' || e.code === 'forbidden');

/**
 * Daily channel rows for [start, end]: the main metrics, then (each optional, a refusal is
 * remembered on the channel, not fatal) thumbnail reach, the Shorts / long-form split and revenue.
 * → { days, reach, ct, revenue }
 */
export async function fetchDays(ctx, cid, start, end) {
  const { store, now } = ctx;
  const ch = channelRow(store, cid) || {};
  const main = await report(ctx, cid, { metrics: YA.CHANNEL_METRICS, dimensions: 'day', sort: 'day', startDate: start, endDate: end });
  const out = { days: main.length, reach: null, ct: null, revenue: null };
  const patches = new Map();
  const put = (d, p) => patches.set(d, { ...(patches.get(d) || {}), ...p });
  for (const r of main) if (r.day) put(r.day, dailyFields(r));

  if (ch.reach_state !== 'unsupported') {
    try {
      for (const r of await report(ctx, cid, { metrics: YA.REACH_METRICS, dimensions: 'day', sort: 'day', startDate: start, endDate: end })) if (r.day) put(r.day, reachFields(r));
      out.reach = 'ok';
    } catch (e) { if (!refused(e)) throw e; out.reach = 'unsupported'; }
  }
  if (ch.ct_state !== 'unsupported') {
    try {
      const by = {};
      for (const r of await report(ctx, cid, { metrics: ['views', 'estimatedMinutesWatched'], dimensions: 'day,creatorContentType', sort: 'day', startDate: start, endDate: end })) {
        if (!r.day) continue;
        const b = by[r.day] || (by[r.day] = { shorts_views: 0, shorts_minutes: 0, long_views: 0, long_minutes: 0 });
        const t = String(r.creatorContentType || '').toUpperCase();
        if (t === 'SHORTS') { b.shorts_views += num(r.views) || 0; b.shorts_minutes += num(r.estimatedMinutesWatched) || 0; }
        else if (t === 'VIDEO_ON_DEMAND' || t === 'LIVE_STREAM') { b.long_views += num(r.views) || 0; b.long_minutes += num(r.estimatedMinutesWatched) || 0; }
      }
      for (const [d, b] of Object.entries(by)) put(d, b);
      out.ct = 'ok';
    } catch (e) { if (!refused(e)) throw e; out.ct = 'unsupported'; }
  }
  if (ctx.flags && ctx.flags['own-revenue'] !== false) {
    const tok = await YA.readToken(cid).catch(() => null);
    if (!YA.hasMonetary(tok)) out.revenue = 'needs_scope';
    else {
      try {
        const rows = await report(ctx, cid, { metrics: YA.REVENUE_METRICS, dimensions: 'day', sort: 'day', startDate: start, endDate: end, currency: 'USD' });
        let any = false;
        for (const r of rows) { if (!r.day) continue; const f = revenueFields(r); if (f.revenue) any = true; put(r.day, f); }
        out.revenue = any ? 'ok' : 'none';
      } catch (e) {
        if (!refused(e)) throw e;
        // Not in the Partner Program: Google refuses monetary reports ("insufficient permission").
        out.revenue = 'not_monetized';
      }
    }
  }
  tx(store, () => { for (const [d, p] of patches) merge(store, 'own_daily', ['channel_id', 'day'], [cid, d], p, now); });
  const fields = { updated_at: now };
  // A refusal for old dates (the backfill) doesn't undo what recent days already showed works.
  if (out.reach && !(out.reach === 'unsupported' && ch.reach_state === 'ok')) fields.reach_state = out.reach;
  if (out.ct && !(out.ct === 'unsupported' && ch.ct_state === 'ok')) fields.ct_state = out.ct;
  // Revenue: once seen, "ok" isn't downgraded to "none" by a quiet week.
  if (out.revenue && !(['none', 'not_monetized'].includes(out.revenue) && ch.revenue_state === 'ok')) fields.revenue_state = out.revenue;
  setChannel(store, cid, fields);
  return out;
}

// ---- jobs -----------------------------------------------------------------------------------
async function tokenOf(ctx, job) {
  const t = await YA.readToken(job.channel_id).catch(() => null);
  if (!t || !t.channel || t.channel.channel_id !== job.channel_id) { dropJob(ctx.store, job.id); return null; }
  return t;
}
async function guard(ctx, cid, fn) {
  try { const r = await fn(); setChannel(ctx.store, cid, { last_error: null }); return r; } catch (e) {
    setChannel(ctx.store, cid, { last_error: String(e.message || e).slice(0, 300) + (e.code ? ` [${e.code}]` : '') });
    throw e;
  }
}

/** The connected channels → own_channels + their jobs. */
async function channelsJob(ctx) {
  const { store, now } = ctx;
  await YA.adoptLegacyToken({ fetch: ctx.fetch, now }).catch(() => {});
  const tokens = await YA.listTokens();
  const ids = [];
  for (const t of tokens) {
    const c = t.channel || {};
    if (!CHANNEL_ID_RE.test(String(c.channel_id || ''))) continue;
    ids.push(c.channel_id);
    store.db.prepare(`INSERT INTO own_channels (channel_id, title, handle, thumb, created, connected_at, subs, views_total, videos, active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?) ON CONFLICT(channel_id) DO UPDATE SET title = COALESCE(excluded.title, title), handle = COALESCE(excluded.handle, handle),
      thumb = COALESCE(excluded.thumb, thumb), created = COALESCE(excluded.created, created), connected_at = excluded.connected_at,
      subs = COALESCE(own_channels.subs, excluded.subs), views_total = COALESCE(own_channels.views_total, excluded.views_total), videos = COALESCE(own_channels.videos, excluded.videos), active = 1`)
      .run(c.channel_id, c.title || null, c.handle || null, c.thumb || null, c.created || null, Date.parse(t.connected_at || '') || now, c.subscribers ?? null, c.views_total ?? null, c.videos ?? null, now);
    const row = channelRow(store, c.channel_id);
    const want = [['own-daily', 0], ['own-videos', 2 * MIN], ['own-weekly', 4 * MIN]];
    if (!row.backfill_done) want.unshift(['own-backfill', 0]);
    for (const [kind, delay] of want) {
      const id = kind + ':' + c.channel_id;
      if (!hasJob(store, id)) upsertJob(store, id, { kind, channel_id: c.channel_id }, now + delay);
    }
  }
  const gone = store.db.prepare('SELECT channel_id FROM own_channels WHERE active = 1').all().map((r) => r.channel_id).filter((id) => !ids.includes(id));
  for (const id of gone) {
    setChannel(store, id, { active: 0 });
    for (const k of ['own-backfill', 'own-daily', 'own-videos', 'own-weekly']) dropJob(store, k + ':' + id);
  }
  return { data: { channels: ids.length, removed: gone.length } };
}

/** From today back to the channel's first day, CHUNK_DAYS per request. */
export async function backfillJob(ctx, job) {
  const { store, now } = ctx;
  const cid = job.channel_id;
  if (!(await tokenOf(ctx, job))) return { next_at: FAR };
  return guard(ctx, cid, async () => {
    const ch = channelRow(store, cid);
    const from = ch.created && ch.created > YOUTUBE_START ? ch.created : YOUTUBE_START;
    const end = ch.backfill_from ? OM.addDays(ch.backfill_from, -1) : today(now);
    const todo = end >= from ? chunks(from, end, ctx.chunkDays || CHUNK_DAYS) : [];
    let n = 0;
    let rows = 0;
    for (const [s, e] of todo.slice(0, ctx.chunksPerRun || CHUNKS_PER_RUN)) {
      rows += (await fetchDays(ctx, cid, s, e)).days;
      setChannel(store, cid, { backfill_from: s });
      n++;
    }
    const done = n >= todo.length;
    if (done) {
      setChannel(store, cid, { backfill_done: 1, backfill_from: from });
      dropJob(store, job.id);
      return { next_at: FAR, data: { done: true, chunks: n, rows } };
    }
    return { next_at: now + MIN, data: { done: false, chunks: n, rows, left: todo.length - n } };
  });
}

/** The last 7 days again, the subscriber count, milestones. */
export async function dailyJob(ctx, job) {
  const { store, now } = ctx;
  const cid = job.channel_id;
  if (!(await tokenOf(ctx, job))) return { next_at: FAR };
  return guard(ctx, cid, async () => {
    const t = today(now);
    const r = await fetchDays(ctx, cid, OM.addDays(t, -REFETCH_DAYS), t);
    try {
      const c = await YA.myChannel({ fetch: ctx.fetch, now, channel: cid });
      setChannel(store, cid, { subs: c.subscribers, views_total: c.views_total, videos: c.videos, title: c.title, thumb: c.thumb, created: c.created });
    } catch (e) { if (e.code === 'reconnect') throw e; }
    setChannel(store, cid, { last_daily_at: now });
    const m = recordMilestones(store, cid, now);
    return { data: { days: r.days, revenue: r.revenue, milestones: m } };
  });
}

/** The format of an own video: the library's, the tracker's, else by length (≤ 60 s, or ≤ 3 min with #shorts). */
function formatOf(store, id, duration, title) {
  const lib = store.db.prepare("SELECT data FROM posts WHERE code = ? LIMIT 1").get(id);
  const p = lib && parse(lib.data, null);
  if (p && ['short', 'video', 'live'].includes(p.type)) return p.type;
  const t = store.db.prepare('SELECT type FROM tracked_videos WHERE video_id = ?').get(id);
  if (t && t.type) return t.type;
  if (duration != null && (duration <= 60 || (duration <= 180 && /#shorts?\b/i.test(title || '')))) return 'short';
  return 'video';
}
const isoDur = (d) => { const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(d || ''); return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : null; };

/** Uploads of the last VIDEO_WINDOW_DAYS (the uploads playlist, newest first). */
async function recentUploads(ctx, cid, t) {
  const opts = { fetch: ctx.fetch, now: ctx.now, channel: cid };
  const uploads = (t.channel && t.channel.uploads) || 'UU' + cid.slice(2);
  const cut = ctx.now - VIDEO_WINDOW_DAYS * DAY;
  const ids = [];
  let page = '';
  for (let i = 0; i < 4; i++) {
    const body = await YA.apiGet(`${YA.DATA_URL}playlistItems?part=contentDetails&playlistId=${uploads}&maxResults=50${page ? '&pageToken=' + page : ''}`, opts);
    let old = false;
    for (const it of body.items || []) {
      const cd = it.contentDetails || {};
      const at = Date.parse(cd.videoPublishedAt || '');
      if (Number.isFinite(at) && at < cut) { old = true; continue; }
      if (VIDEO_ID_RE.test(String(cd.videoId || ''))) ids.push(cd.videoId);
    }
    page = body.nextPageToken;
    if (old || !page) break;
  }
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const body = await YA.apiGet(`${YA.DATA_URL}videos?part=snippet,contentDetails,status&id=${ids.slice(i, i + 50).join(',')}&maxResults=50`, opts);
    for (const it of body.items || []) {
      if (it.status && it.status.privacyStatus && it.status.privacyStatus !== 'public') continue;
      const published = Date.parse(it.snippet && it.snippet.publishedAt || '');
      if (!Number.isFinite(published) || published < cut) continue;
      out.push({ id: it.id, title: it.snippet.title, published_at: published, duration: isoDur(it.contentDetails && it.contentDetails.duration) });
    }
  }
  return out;
}

/** Per-video daily rows of recent uploads: the whole life the first time, then the last 7 days. */
export async function videosJob(ctx, job) {
  const { store, now } = ctx;
  const cid = job.channel_id;
  const t = await tokenOf(ctx, job);
  if (!t) return { next_at: FAR };
  return guard(ctx, cid, async () => {
    const vids = await recentUploads(ctx, cid, t);
    const end = today(now);
    let rows = 0;
    for (const v of vids) {
      const type = formatOf(store, v.id, v.duration, v.title);
      store.db.prepare(`INSERT INTO own_videos (video_id, channel_id, title, published_at, duration, type, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(video_id) DO UPDATE SET title = excluded.title, published_at = excluded.published_at, duration = excluded.duration, type = excluded.type, updated_at = excluded.updated_at`)
        .run(v.id, cid, v.title, v.published_at, v.duration, type, now);
      const pubDay = today(v.published_at);
      const have = store.db.prepare('SELECT COUNT(*) AS n FROM own_video_daily WHERE video_id = ?').get(v.id).n;
      const start = have ? OM.addDays(end, -REFETCH_DAYS) : pubDay;
      const list = await report(ctx, cid, { metrics: YA.VIDEO_METRICS, dimensions: 'day', filters: 'video==' + v.id, sort: 'day', startDate: start < pubDay ? pubDay : start, endDate: end });
      tx(store, () => { for (const r of list) if (r.day) merge(store, 'own_video_daily', ['video_id', 'day'], [v.id, r.day], videoFields(r), now, { channel_id: cid }); });
      rows += list.length;
    }
    setChannel(store, cid, { last_videos_at: now });
    return { data: { videos: vids.length, rows } };
  });
}

/** What each breakdown asks Analytics for. */
export const BREAKDOWNS = {
  traffic: { dimensions: 'insightTrafficSourceType', metrics: ['views', 'estimatedMinutesWatched'], sort: '-views' },
  search_terms: { dimensions: 'insightTrafficSourceDetail', filters: 'insightTrafficSourceType==YT_SEARCH', metrics: ['views', 'estimatedMinutesWatched'], sort: '-views', maxResults: 25 },
  countries: { dimensions: 'country', metrics: ['views', 'estimatedMinutesWatched'], sort: '-views', maxResults: 25 },
  age_gender: { dimensions: 'ageGroup,gender', metrics: ['viewerPercentage'] },
  devices: { dimensions: 'deviceType', metrics: ['views', 'estimatedMinutesWatched'], sort: '-views' },
  subscribed: { dimensions: 'subscribedStatus', metrics: ['views', 'estimatedMinutesWatched', 'averageViewDuration'] },
  playback: { dimensions: 'insightPlaybackLocationType', metrics: ['views', 'estimatedMinutesWatched'], sort: '-views' }
};

/** One week's breakdowns (week = its Monday). A refused kind is stored as { error } and skipped. */
export async function fetchWeek(ctx, cid, week) {
  const end = OM.addDays(week, 6);
  const out = {};
  for (const [kind, q] of Object.entries(BREAKDOWNS)) {
    let data;
    try {
      const rows = await report(ctx, cid, { ...q, startDate: week, endDate: end });
      data = kind === 'age_gender'
        ? { rows: rows.map((r) => ({ age: String(r.ageGroup || '').replace(/^age/, ''), gender: String(r.gender || '').toLowerCase(), pct: num(r.viewerPercentage) })) }
        : { rows: rows.map((r) => ({ key: String(r[q.dimensions] ?? ''), views: num(r.views), minutes: num(r.estimatedMinutesWatched), avg_dur: r.averageViewDuration != null ? num(r.averageViewDuration) : undefined })) };
    } catch (e) {
      if (!refused(e)) throw e;
      data = { rows: [], error: e.message };
    }
    out[kind] = data;
  }
  tx(ctx.store, () => {
    for (const [kind, data] of Object.entries(out)) {
      ctx.store.db.prepare(`INSERT INTO own_breakdowns (channel_id, week, kind, data, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(channel_id, week, kind) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`).run(cid, week, kind, JSON.stringify(data), ctx.now);
    }
  });
  return out;
}

/** The complete Analytics weeks (Mondays) before today, newest first. */
export function completeWeeks(now, n) {
  const t = today(now);
  let mon = OM.weekStart(t);
  const out = [];
  for (let i = 0; i < n; i++) { mon = OM.addDays(mon, -7); out.push(mon); }
  return out;
}

export async function weeklyJob(ctx, job) {
  const { store, now } = ctx;
  const cid = job.channel_id;
  if (!(await tokenOf(ctx, job))) return { next_at: FAR };
  return guard(ctx, cid, async () => {
    const ch = channelRow(store, cid);
    const stamp = store.db.prepare("SELECT week, MIN(updated_at) AS at FROM own_breakdowns WHERE channel_id = ? GROUP BY week").all(cid);
    const at = Object.fromEntries(stamp.map((r) => [r.week, r.at]));
    const weeks = completeWeeks(now, BREAKDOWN_WEEKS).filter((w) => !ch.created || OM.addDays(w, 6) >= ch.created);
    // Missing weeks, and the last two until their numbers settle (fetched 4+ days after the week ended).
    const todo = weeks.filter((w, i) => !at[w] || (i < 2 && at[w] < Date.parse(OM.addDays(w, 11) + 'T08:00:00Z')));
    for (const w of todo.slice(0, ctx.weeksPerRun || BREAKDOWN_WEEKS)) await fetchWeek(ctx, cid, w);
    setChannel(store, cid, { last_weekly_at: now });
    return { data: { weeks: todo.length } };
  });
}

export const OWN_KINDS = {
  // Seeded once an OAuth client is set up (nothing to look at before that).
  'own-channels': { singleton: true, seedIf: () => { try { return !!YA.loadClient(); } catch { return false; } }, feature: 'own-history', every: 5 * MIN, jitter: 30_000, units: 0, run: channelsJob },
  'own-backfill': { feature: 'own-history', every: MIN, jitter: 10_000, units: 0, run: backfillJob },
  'own-daily': { feature: 'own-history', every: (job, now) => untilLocal(now, 6, 0), jitter: 10 * MIN, units: 0, run: dailyJob },
  'own-videos': { feature: 'own-history', every: (job, now) => untilLocal(now, 6, 20), jitter: 10 * MIN, units: 0, run: videosJob },
  'own-weekly': { feature: 'own-history', every: (job, now) => untilLocal(now, 6, 40), jitter: 10 * MIN, units: 0, run: weeklyJob }
};

/** "Collect now": the channel's daily, video and weekly jobs (and the channel list) run on the next tick. */
export function collectNow(store, channel, now = Date.now()) {
  const ids = channel && CHANNEL_ID_RE.test(channel) ? [channel] : store.db.prepare('SELECT channel_id FROM own_channels WHERE active = 1').all().map((r) => r.channel_id);
  let n = Number(store.db.prepare("UPDATE tracker_jobs SET next_at = ? WHERE id = 'own-channels'").run(now).changes);
  for (const id of ids) for (const k of ['own-backfill', 'own-daily', 'own-videos', 'own-weekly']) n += Number(store.db.prepare('UPDATE tracker_jobs SET next_at = ?, fails = 0 WHERE id = ?').run(now, k + ':' + id).changes);
  return n;
}

// ---- reading ----------------------------------------------------------------------------------
/** Connected channels in the database, the first connected first. */
export function ownChannels(store, { all = false } = {}) {
  return store.db.prepare(`SELECT * FROM own_channels ${all ? '' : 'WHERE active = 1'} ORDER BY connected_at, channel_id`).all();
}

const nrm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/^(yt\/|@)/, '').replace(/[^a-z0-9]/g, '');
/** A channel reference (UC id, @handle, name) → its own_channels row; none = the first. Throws on no match. */
export function resolveOwn(store, ref) {
  const rows = ownChannels(store, { all: true }).sort((a, b) => b.active - a.active);
  const active = rows.filter((r) => r.active);
  if (!rows.length) return null;
  if (ref === undefined || ref === null || ref === '' || ref === 'default') return active[0] || rows[0];
  const r = String(ref).trim();
  const hit = rows.find((c) => c.channel_id === r) || rows.find((c) => nrm(c.handle) && nrm(c.handle) === nrm(r)) || rows.find((c) => nrm(c.title) === nrm(r))
    || (nrm(r).length >= 3 ? rows.find((c) => nrm(c.title).includes(nrm(r))) : null);
  if (!hit) throw Object.assign(new Error(`No connected channel matches "${r}". Connected: ${rows.map((c) => c.title || c.channel_id).join(', ')}.`), { code: 'unknown_channel' });
  return hit;
}

/** The stored daily rows of a channel (oldest first), as own-metrics rows. */
export function dailyRows(store, cid) {
  return store.db.prepare('SELECT day, metric FROM own_daily WHERE channel_id = ? ORDER BY day').all(cid).map((r) => ({ d: r.day, ...parse(r.metric, {}) }));
}

/** The last day Analytics has numbers for (≤ yesterday: today's row is always partial). */
function dataThrough(rows, now) {
  const cap = OM.addDays(today(now), -1);
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].d <= cap && rows[i].views != null) return rows[i].d;
  return null;
}

/** Combine several channels' daily rows into one per day (counts add, rates weighted). */
export function combineRows(lists) {
  const by = new Map();
  for (const list of lists) {
    for (const r of list) {
      const b = by.get(r.d) || { d: r.d, _ctr: 0, _impr: 0, _pct: 0, _pv: 0, _cpm: 0, _mp: 0 };
      for (const k of [...OM.ADD, 'shorts_views', 'shorts_minutes', 'long_views', 'long_minutes', 'subs_cum']) if (r[k] != null) b[k] = (b[k] || 0) + r[k];
      if (r.ctr != null && r.impressions) { b._ctr += r.ctr * r.impressions; b._impr += r.impressions; }
      if (r.avg_pct != null && r.views) { b._pct += r.avg_pct * r.views; b._pv += r.views; }
      if (r.cpm != null && r.monetized_playbacks) { b._cpm += r.cpm * r.monetized_playbacks; b._mp += r.monetized_playbacks; }
      by.set(r.d, b);
    }
  }
  return [...by.values()].sort((a, b) => (a.d < b.d ? -1 : 1)).map((b) => {
    const { _ctr, _impr, _pct, _pv, _cpm, _mp, ...rest } = b;
    return { ...rest, ctr: _impr ? _ctr / _impr : null, avg_pct: _pv ? _pct / _pv : null, cpm: _mp ? _cpm / _mp : null, avg_dur: b.views ? (b.minutes || 0) * 60 / b.views : null };
  });
}

/** Dense daily rows of one channel up to its last Analytics day, with running subscriber / view totals. */
export function seriesOf(store, ch, now) {
  const raw = dailyRows(store, ch.channel_id);
  const end = dataThrough(raw, now);
  if (!end) return { rows: [], end: null, first: null };
  const first = raw.find((r) => r.views != null).d;
  const rows = OM.fillDays(raw.filter((r) => r.d <= end), first, end);
  OM.cumulative(rows, 'subs', ch.subs);
  // Lifetime views: added up from the first day once the history is complete, else anchored at the channel's total.
  OM.cumulative(rows, 'views', ch.backfill_done ? null : ch.views_total);
  return { rows, end, first };
}

const R = (v, n = 0) => (v == null ? null : OM.round(v, n));
/** A daily row as the page gets it (rounded, compact). */
function slim(r) {
  return {
    d: r.d, views: R(r.views), engaged: R(r.engaged), minutes: R(r.minutes, 1), subs_gained: R(r.subs_gained), subs_lost: R(r.subs_lost), subs_cum: R(r.subs_cum),
    likes: R(r.likes), comments: R(r.comments), shares: R(r.shares), impressions: R(r.impressions), ctr: R(r.ctr, 4), avg_pct: R(r.avg_pct, 1), avg_dur: R(r.avg_dur),
    shorts_views: R(r.shorts_views), long_minutes: R(r.long_minutes, 1), revenue: R(r.revenue, 2), monetized_playbacks: R(r.monetized_playbacks), cpm: R(r.cpm, 2)
  };
}

/** YPP progress of one channel (watch hours: long-form only when Analytics splits by content type). */
export function yppOf(ch, rows, end, first) {
  if (!end) return { subs: { current: ch.subs, target: OM.YPP.subs }, paths: [], enough_history: false, no_data: true };
  const split = rows.some((r) => r.long_minutes != null || r.shorts_views != null);
  const yrows = split ? rows.map((r) => ({ ...r, minutes: r.long_minutes != null ? r.long_minutes : (r.minutes || 0) - (r.shorts_minutes || 0) })) : rows;
  const out = OM.ypp({ rows: yrows, end, subs: ch.subs, shorts: split ? rows.map((r) => ({ d: r.d, v: r.shorts_views || 0 })) : null, historyDays: OM.diffDays(first, end) + 1 });
  out.approx_hours = !split; // without the split, Shorts' watch time is counted too (YouTube doesn't)
  out.in_ypp = ch.revenue_state === 'ok' || ch.revenue_state === 'none';
  out.end = end;
  return out;
}

/** The report card: each recent upload's first 48 h / 7 d / 30 d next to the channel's and the niche's median. */
export function reportCard(store, cid, { now = Date.now(), limit = 12 } = {}) {
  const vids = store.db.prepare('SELECT * FROM own_videos WHERE channel_id = ? ORDER BY published_at DESC').all(cid);
  const through = OM.addDays(today(now), -1);
  let peers = null;
  try { peers = peerMedians(store, cid, { now }); } catch { /* niche tracking not set up */ }
  const H = [[48, 2], [168, 7], [720, 30]];
  const all = vids.map((v) => {
    const rows = store.db.prepare('SELECT day, metric FROM own_video_daily WHERE video_id = ? ORDER BY day').all(v.video_id).map((r) => ({ d: r.day, ...parse(r.metric, {}) }));
    const pub = today(v.published_at);
    const tracked = peers && peers.videos[v.video_id];
    const cp = {};
    const pending = {};
    for (const [h, n] of H) {
      if (tracked && tracked[h] != null) { cp[h] = { v: Math.round(tracked[h]), src: 'tracker' }; continue; }
      const last = OM.addDays(pub, n - 1);
      if (last > through || !rows.length) { pending[h] = Math.max(now, v.published_at + h * HOUR); continue; }
      const sum = rows.filter((r) => r.d >= pub && r.d <= last).reduce((s, r) => s + (r.views || 0), 0);
      cp[h] = { v: sum, src: 'analytics' };
    }
    const total = rows.reduce((s, r) => s + (r.views || 0), 0);
    const latest = tracked && tracked.latest != null ? Math.max(tracked.latest, total) : total;
    const minutes = rows.reduce((s, r) => s + (r.minutes || 0), 0);
    const pctRows = rows.filter((r) => r.avg_pct != null && r.views);
    const avgPct = pctRows.length ? pctRows.reduce((s, r) => s + r.avg_pct * r.views, 0) / pctRows.reduce((s, r) => s + r.views, 0) : null;
    const type = v.type === 'short' ? 'short' : v.type === 'live' ? 'live' : 'video';
    return {
      id: v.video_id, title: v.title, type, published_at: v.published_at, duration: v.duration,
      url: type === 'short' ? `https://www.youtube.com/shorts/${v.video_id}` : `https://www.youtube.com/watch?v=${v.video_id}`,
      thumb: `https://i.ytimg.com/vi/${v.video_id}/mqdefault.jpg`, views: latest, watch_hours: R(minutes / 60, 1), avg_pct: R(avgPct, 1),
      subs_gained: rows.reduce((s, r) => s + (r.subs_gained || 0), 0), cp, pending
    };
  });
  const fmt = (v) => (v.type === 'short' ? 'short' : 'long');
  const med = { long: {}, short: {} };
  for (const f of ['long', 'short']) {
    const list = all.filter((v) => fmt(v) === f);
    for (const [h] of H) { const m = OM.median(list.map((v) => v.cp[h] && v.cp[h].v)); med[f][h] = m == null ? null : Math.round(m); }
    med[f].n = list.length;
  }
  const niche = peers ? { niche: peers.niche, scope: peers.scope, channels: peers.channels, long: peers.long, short: peers.short } : null;
  for (const v of all) {
    const f = fmt(v);
    v.vs_channel = {};
    v.vs_niche = {};
    for (const [h] of H) {
      if (!v.cp[h]) continue;
      if (med[f][h] && med[f].n >= 3) v.vs_channel[h] = R(v.cp[h].v / med[f][h], 2);
      if (niche && niche[f][h]) v.vs_niche[h] = R(v.cp[h].v / niche[f][h], 2);
    }
  }
  return { videos: all.slice(0, limit), total: all.length, channel_median: med, niche, window_days: VIDEO_WINDOW_DAYS };
}

function breakdownRows(store, ids, kind, weeks) {
  const q = ids.map(() => '?').join(',');
  return store.db.prepare(`SELECT channel_id, week, data FROM own_breakdowns WHERE kind = ? AND channel_id IN (${q}) ORDER BY week DESC`).all(kind, ...ids)
    .map((r) => ({ channel_id: r.channel_id, week: r.week, ...parse(r.data, { rows: [] }) }))
    .filter((r) => weeks.includes(r.week));
}
function recentWeeks(store, ids, n) {
  const q = ids.map(() => '?').join(',');
  return store.db.prepare(`SELECT DISTINCT week FROM own_breakdowns WHERE channel_id IN (${q}) ORDER BY week DESC LIMIT ?`).all(...ids, n).map((r) => r.week);
}

/** The YouTube search terms that brought viewers: the last 4 weeks, with the latest week against the one before. */
export function searchTerms(store, ids, { weeks = 4, limit = 25 } = {}) {
  ids = [].concat(ids);
  const wk = recentWeeks(store, ids, Math.max(weeks, 8));
  const rows = breakdownRows(store, ids, 'search_terms', wk);
  if (!wk.length) return { weeks: [], terms: [], latest_week: null };
  const latest = wk[0];
  const prev = wk[1] || null;
  const inWindow = wk.slice(0, weeks);
  const terms = new Map();
  for (const r of rows) {
    for (const t of r.rows || []) {
      const k = String(t.key || '').trim().toLowerCase();
      if (!k) continue;
      const e = terms.get(k) || { term: k, views: 0, minutes: 0, last_week: 0, prev_week: 0, weeks: {} };
      if (inWindow.includes(r.week)) { e.views += t.views || 0; e.minutes += t.minutes || 0; }
      if (r.week === latest) e.last_week += t.views || 0;
      if (r.week === prev) e.prev_week += t.views || 0;
      e.weeks[r.week] = (e.weeks[r.week] || 0) + (t.views || 0);
      terms.set(k, e);
    }
  }
  const list = [...terms.values()].filter((e) => e.views > 0 || e.last_week > 0).map((e) => ({
    term: e.term, views: e.views, minutes: R(e.minutes, 1), last_week: e.last_week, prev_week: prev ? e.prev_week : null,
    change: prev ? e.last_week - e.prev_week : null, change_pct: prev && e.prev_week ? R((e.last_week - e.prev_week) / e.prev_week * 100) : null,
    is_new: prev ? e.prev_week === 0 && e.last_week > 0 : false,
    series: [...wk].reverse().map((w) => e.weeks[w] || 0)
  })).sort((a, b) => b.views - a.views || b.last_week - a.last_week);
  return { weeks: [...wk].reverse(), window_weeks: inWindow.length, latest_week: latest, prev_week: prev, terms: list.slice(0, limit), total: list.length };
}

/** Traffic sources, countries, age × gender, devices, subscribed status, playback locations over the last 4 weeks. */
export function audience(store, ids, { weeks = 4 } = {}) {
  ids = [].concat(ids);
  const wk = recentWeeks(store, ids, weeks);
  const out = { weeks: [...wk].reverse() };
  const weekViews = {};
  for (const r of breakdownRows(store, ids, 'traffic', wk)) weekViews[r.channel_id + r.week] = (r.rows || []).reduce((s, x) => s + (x.views || 0), 0);
  for (const kind of ['traffic', 'countries', 'devices', 'subscribed', 'playback']) {
    const sum = new Map();
    let errors = 0;
    const rows = breakdownRows(store, ids, kind, wk);
    for (const r of rows) {
      if (r.error) errors++;
      for (const x of r.rows || []) {
        const e = sum.get(x.key) || { key: x.key, views: 0, minutes: 0 };
        e.views += x.views || 0;
        e.minutes += x.minutes || 0;
        sum.set(x.key, e);
      }
    }
    const total = [...sum.values()].reduce((s, e) => s + e.views, 0);
    out[kind] = { total, unavailable: rows.length > 0 && errors === rows.length, rows: [...sum.values()].sort((a, b) => b.views - a.views).map((e) => ({ ...e, minutes: R(e.minutes, 1), share: total ? R(e.views / total, 4) : null })) };
  }
  // Age × gender: YouTube gives shares (viewerPercentage) per week; weeks weigh by their views.
  const ag = new Map();
  let wsum = 0;
  const agRows = breakdownRows(store, ids, 'age_gender', wk);
  for (const r of agRows) {
    const w = weekViews[r.channel_id + r.week] || 0;
    if (!w || !(r.rows || []).length) continue;
    wsum += w;
    for (const x of r.rows) { const k = x.age + '|' + x.gender; ag.set(k, (ag.get(k) || 0) + (x.pct || 0) * w); }
  }
  const agList = [...ag.entries()].map(([k, v]) => ({ age: k.split('|')[0], gender: k.split('|')[1], pct: wsum ? R(v / wsum, 2) : null })).sort((a, b) => (a.age < b.age ? -1 : 1));
  const byAge = {};
  const byGender = {};
  for (const x of agList) { byAge[x.age] = R((byAge[x.age] || 0) + (x.pct || 0), 2); byGender[x.gender] = R((byGender[x.gender] || 0) + (x.pct || 0), 2); }
  out.age_gender = { rows: agList, by_age: byAge, by_gender: byGender, unavailable: agRows.length > 0 && agRows.every((r) => r.error) };
  return out;
}

/** Last 48 hours from the niche tracker's measurements (Analytics lags 2–3 days). */
export function realtime(store, ids, now = Date.now()) {
  ids = [].concat(ids);
  const q = ids.map(() => '?').join(',');
  const tracked = store.db.prepare(`SELECT channel_id FROM tracked_channels WHERE active = 1 AND channel_id IN (${q})`).all(...ids).map((r) => r.channel_id);
  if (!tracked.length) return { tracked: false };
  const vids = store.db.prepare(`SELECT * FROM tracked_videos WHERE channel_id IN (${tracked.map(() => '?').join(',')})`).all(...tracked);
  const from = now - 48 * HOUR;
  const hours = Array.from({ length: 49 }, (_, i) => from + i * HOUR);
  const totals = hours.map(() => 0);
  const list = [];
  let lastAt = null;
  for (const v of vids) {
    const pts = store.videoStats(v.video_id).filter((p) => p.views != null);
    if (!pts.length || !v.published_at) continue;
    const latest = pts[pts.length - 1];
    lastAt = Math.max(lastAt || 0, latest.ts);
    const at = (ts) => {
      if (ts <= v.published_at) return 0;
      const exact = V.viewsAtTs(pts, v.published_at, ts);
      if (exact != null) return exact;
      const before = pts.filter((p) => p.ts <= ts).pop();
      return before ? before.views : (ts < pts[0].ts ? null : latest.views);
    };
    const base = at(from);
    if (base == null && v.published_at < from) continue;
    const gained = Math.max(0, latest.views - (base || 0));
    hours.forEach((t, i) => { const x = at(Math.min(t, latest.ts)); totals[i] += x == null ? 0 : Math.max(0, x - (base || 0)); });
    const vph = V.vph24(pts, v.published_at, now);
    if (gained > 0 || now - v.published_at < 48 * HOUR) {
      list.push({ id: v.video_id, title: v.title, type: v.type === 'short' ? 'short' : 'video', published_at: v.published_at, views: latest.views, gained_48h: Math.round(gained),
        vph24: vph ? Math.round(vph.vph) : null, new: now - v.published_at < 48 * HOUR, thumb: v.thumb || `https://i.ytimg.com/vi/${v.video_id}/mqdefault.jpg` });
    }
  }
  list.sort((a, b) => b.gained_48h - a.gained_48h);
  return { tracked: true, last_measured_at: lastAt, gained_48h: Math.round(totals[totals.length - 1]), series: totals.map((x) => Math.round(x)), videos: list.slice(0, 6) };
}

/** Milestones of a channel (and the stored ones: when they were first seen). */
function milestonesOf(store, ch, rows) {
  const vids = store.db.prepare('SELECT video_id, title, published_at FROM own_videos WHERE channel_id = ?').all(ch.channel_id).map((v) => {
    const views = store.db.prepare('SELECT metric FROM own_video_daily WHERE video_id = ?').all(v.video_id).reduce((s, r) => s + (parse(r.metric, {}).views || 0), 0);
    return { id: v.video_id, title: v.title, published_at: v.published_at, views };
  });
  const last = rows[rows.length - 1];
  const m = OM.milestones({ rows, subs: ch.subs, views: last ? last.views_cum : ch.views_total, videos: vids });
  const stored = Object.fromEntries(store.db.prepare('SELECT key, reached_day, created_at FROM own_milestones WHERE channel_id = ?').all(ch.channel_id).map((r) => [r.key, r]));
  for (const x of m.reached) if (!x.day && stored[x.key]) x.day = stored[x.key].reached_day || OM.dayOf(stored[x.key].created_at);
  return m;
}

/** After new numbers: new milestones go to own_milestones (the first time all count as already shown). */
export function recordMilestones(store, cid, now = Date.now()) {
  const ch = channelRow(store, cid);
  if (!ch) return 0;
  const { rows } = seriesOf(store, ch, now);
  const m = milestonesOf(store, ch, rows);
  const first = !store.db.prepare('SELECT 1 FROM own_milestones WHERE channel_id = ?').get(cid);
  const ins = store.db.prepare('INSERT OR IGNORE INTO own_milestones (channel_id, key, reached_day, data, created_at, notified_at) VALUES (?, ?, ?, ?, ?, ?)');
  let n = 0;
  for (const x of m.reached) n += Number(ins.run(cid, x.key, x.day || null, JSON.stringify({ kind: x.kind, value: x.value, video: x.video || null }), now, first ? now : null).changes);
  return first ? 0 : n;
}
/** Milestones the extension hasn't shown yet (last 7 days). */
export function pendingMilestones(store, now = Date.now()) {
  return store.db.prepare(`SELECT m.*, c.title FROM own_milestones m JOIN own_channels c ON c.channel_id = m.channel_id
    WHERE m.notified_at IS NULL AND m.created_at >= ? ORDER BY m.created_at`).all(now - 7 * DAY)
    .map((r) => ({ channel_id: r.channel_id, key: r.key, title: r.title, ...parse(r.data, {}) }));
}
export function ackMilestones(store, list, now = Date.now()) {
  const up = store.db.prepare('UPDATE own_milestones SET notified_at = ? WHERE channel_id = ? AND key = ? AND notified_at IS NULL');
  let n = 0;
  for (const m of list || []) if (m && CHANNEL_ID_RE.test(String(m.channel_id)) && typeof m.key === 'string') n += Number(up.run(now, m.channel_id, m.key.slice(0, 40)).changes);
  return n;
}

function revenueOf(ch, rows, end) {
  const state = ch.revenue_state || null;
  if (!end || !rows.some((r) => r.revenue != null)) return { state };
  const w = (n) => {
    const b = OM.bucket(OM.windowRows(rows, end, n), end);
    return { revenue: R(b.revenue, 2), rpm: R(b.rpm, 2), cpm: R(b.cpm, 2), views: b.views, monetized_playbacks: b.monetized_playbacks };
  };
  return { state, currency: 'USD', d28: w(28), d90: w(90), d365: w(365), prev28: (() => { const p = OM.addDays(end, -28); const b = OM.bucket(OM.windowRows(rows, p, 28), p); return { revenue: R(b.revenue, 2) }; })() };
}

function collecting(ch, now) {
  const created = ch.created || null;
  const t = today(now);
  const total = created ? Math.max(1, OM.diffDays(created, t) + 1) : null;
  const covered = ch.backfill_from ? OM.diffDays(ch.backfill_from, t) + 1 : 0;
  return {
    backfill_done: !!ch.backfill_done, backfill_from: ch.backfill_from, created, pct: ch.backfill_done ? 100 : total ? Math.min(99, Math.round(covered / total * 100)) : null,
    last_daily_at: ch.last_daily_at, last_videos_at: ch.last_videos_at, last_weekly_at: ch.last_weekly_at, error: ch.last_error || null,
    reach: ch.reach_state || null, content_type: ch.ct_state || null
  };
}

const uploadsOf = (store, ids, now) => store.db.prepare(`SELECT video_id AS id, channel_id, title, published_at, type FROM own_videos WHERE channel_id IN (${ids.map(() => '?').join(',')}) AND published_at >= ? ORDER BY published_at DESC`).all(...ids, now - 400 * DAY);

/** One channel's page (or the combined one when channel is 'all'). */
export function channelPage(store, ch, now = Date.now()) {
  const { rows, end, first } = seriesOf(store, ch, now);
  return {
    channel_id: ch.channel_id, title: ch.title, handle: ch.handle, thumb: ch.thumb, created: ch.created,
    totals: { subs: ch.subs, views_total: ch.views_total, videos: ch.videos },
    data_through: end, first_day: first, history_days: end ? OM.diffDays(first, end) + 1 : 0,
    collecting: collecting(ch, now),
    daily: rows.slice(-400).map(slim),
    monthly: OM.aggregate(rows, 'month').map((b) => ({ d: b.d, days: b.days, views: R(b.views), minutes: R(b.minutes, 1), subs_net: R(b.subs_net), subs_cum: R(b.subs), impressions: R(b.impressions), ctr: R(b.ctr, 4), avg_pct: R(b.avg_pct, 1), revenue: R(b.revenue, 2) })),
    compare: end ? OM.comparisons(rows, end, first) : null,
    ypp: yppOf(ch, rows, end, first),
    milestones: milestonesOf(store, ch, rows),
    report: reportCard(store, ch.channel_id, { now }),
    search_terms: searchTerms(store, ch.channel_id),
    audience: audience(store, ch.channel_id),
    revenue: revenueOf(ch, rows, end),
    realtime: realtime(store, ch.channel_id, now),
    uploads: uploadsOf(store, [ch.channel_id], now)
  };
}

export function combinedPage(store, chans, now = Date.now()) {
  const per = chans.map((ch) => ({ ch, ...seriesOf(store, ch, now) }));
  const withData = per.filter((p) => p.end);
  const end = withData.length ? withData.map((p) => p.end).sort()[0] : null; // the day every channel has
  const first = withData.length ? withData.map((p) => p.first).sort()[0] : null;
  const rows = end ? OM.fillDays(combineRows(withData.map((p) => p.rows.filter((r) => r.d <= end))), first, end) : [];
  const ids = chans.map((c) => c.channel_id);
  const subs = chans.reduce((s, c) => s + (c.subs || 0), 0);
  return {
    channel_id: 'all', title: null, combined: true,
    totals: { subs, views_total: chans.reduce((s, c) => s + (c.views_total || 0), 0), videos: chans.reduce((s, c) => s + (c.videos || 0), 0) },
    data_through: end, first_day: first, history_days: end ? OM.diffDays(first, end) + 1 : 0,
    daily: rows.slice(-400).map(slim),
    monthly: OM.aggregate(rows, 'month').map((b) => ({ d: b.d, days: b.days, views: R(b.views), minutes: R(b.minutes, 1), subs_net: R(b.subs_net), subs_cum: R(b.subs), impressions: R(b.impressions), ctr: R(b.ctr, 4), avg_pct: R(b.avg_pct, 1), revenue: R(b.revenue, 2) })),
    compare: end ? OM.comparisons(rows, end, first) : null,
    per_channel: per.map((p) => {
      const c = p.end ? OM.compare(p.rows, p.end, 28, p.first) : null;
      const y = yppOf(p.ch, p.rows, p.end, p.first);
      const best = (y.paths || []).find((x) => x.id === y.best);
      return { channel_id: p.ch.channel_id, title: p.ch.title, thumb: p.ch.thumb, subs: p.ch.subs, views_28d: c ? c.views.cur : null, views_pct: c ? c.views.pct : null,
        watch_hours_28d: c ? c.watch_hours.cur : null, subs_28d: c ? c.subs_net.cur : null, data_through: p.end,
        ypp: { in_ypp: y.in_ypp, reached: y.reached, eta_days: y.eta_days, best: y.best, pct: best ? Math.min(best.subs.pct ?? 0, best.metric.pct ?? 0) : null } };
    }),
    search_terms: searchTerms(store, ids),
    audience: audience(store, ids),
    revenue: (() => {
      const st = chans.map((c) => c.revenue_state);
      return revenueOf({ revenue_state: st.includes('ok') ? 'ok' : st.includes('none') ? 'none' : st.includes('needs_scope') ? 'needs_scope' : st.find(Boolean) || null }, rows, end);
    })(),
    realtime: realtime(store, ids, now),
    uploads: uploadsOf(store, ids, now)
  };
}

/**
 * The Library's Kanalım page in one answer. status: YA.status() (the token side: re-consent,
 * reconnect); channel: a UC id, 'all', or nothing (the first connected).
 */
export function ownPage(store, { channel, now = Date.now(), status = null, flags = {} } = {}) {
  const chans = ownChannels(store);
  const st = status || { channels: [] };
  const byId = Object.fromEntries((st.channels || []).map((c) => [c.channel_id, c]));
  const list = chans.map((c, i) => ({
    channel_id: c.channel_id, title: c.title, handle: c.handle, thumb: c.thumb, subs: c.subs, primary: i === 0, created: c.created,
    needs_reconsent: byId[c.channel_id] ? byId[c.channel_id].needs_reconsent : false, reconnect: byId[c.channel_id] ? byId[c.channel_id].reconnect : false,
    revenue_state: c.revenue_state, collecting: collecting(c, now)
  }));
  // Tokens the jobs haven't picked up yet (just connected): listed, page says "collecting".
  for (const c of st.channels || []) if (c.channel_id && !list.find((x) => x.channel_id === c.channel_id)) list.push({ channel_id: c.channel_id, title: c.title, handle: c.handle, thumb: c.thumb, subs: c.subscribers, needs_reconsent: c.needs_reconsent, reconnect: c.reconnect, pending: true, collecting: { backfill_done: false, pct: 0 } });
  const base = { ok: true, now, channels: list, features: { history: flags['own-history'] !== false, revenue: flags['own-revenue'] !== false, milestones: !!flags['own-milestones'] } };
  if (!chans.length) return { ...base, channel: null, page: null };
  let pick = channel === 'all' && chans.length > 1 ? 'all' : (chans.find((c) => c.channel_id === channel) || chans[0]).channel_id;
  const page = pick === 'all' ? combinedPage(store, chans, now) : channelPage(store, chans.find((c) => c.channel_id === pick), now);
  return { ...base, channel: pick, page };
}

// ---- for the MCP tools ---------------------------------------------------------------------------
export function channelHistory(store, { channel, days = 90, granularity = 'day', now = Date.now() } = {}) {
  const ch = resolveOwn(store, channel);
  if (!ch) return { error: 'No channel history yet.', hint: 'Connect a channel (connect_youtube_channel) with the bridge running and the own-history feature on; the first history arrives within minutes.' };
  const { rows, end, first } = seriesOf(store, ch, now);
  if (!end) return { channel: ch.title, channel_id: ch.channel_id, collecting: collecting(ch, now), series: [], note: 'Collecting: no Analytics days stored yet.' };
  const from = days >= 3650 ? first : OM.addDays(end, -days + 1);
  const b = OM.aggregate(rows.filter((r) => r.d >= from), granularity).map((x) => ({
    start: x.d, days: x.days, views: x.views, engaged_views: x.engaged, watch_hours: R(x.watch_hours, 1), subscribers_gained: x.subs_gained, subscribers_lost: x.subs_lost,
    subscribers: x.subs != null ? R(x.subs) : null, likes: x.likes, comments: x.comments, shares: x.shares, impressions: x.impressions, ctr_pct: x.ctr == null ? null : R(x.ctr * 100, 2),
    avg_view_pct: R(x.avg_pct, 1), avg_view_duration_s: R(x.avg_dur), revenue_usd: x.revenue == null ? undefined : R(x.revenue, 2), rpm_usd: x.rpm == null ? undefined : R(x.rpm, 2)
  }));
  const cmp = OM.comparisons(rows, end, first);
  const pick = (c) => Object.fromEntries(['views', 'watch_hours', 'subs_net', 'ctr', 'avg_pct', 'revenue'].map((m) => [m, c[m]]));
  return {
    channel: ch.title, channel_id: ch.channel_id, subscribers_now: ch.subs, data_through: end, first_day: first, granularity, collecting: collecting(ch, now),
    compare: { last_7_days: pick(cmp[7]), last_28_days: pick(cmp[28]), last_90_days: pick(cmp[90]), last_365_days: pick(cmp[365]) },
    series: b,
    note: 'Analytics days are Pacific time and lag 2–3 days; the last days are corrected for a week. compare.pct is null when the previous window is outside the collected history. subscribers is a running total anchored at today\'s count (YouTube rounds counts above 1,000).'
  };
}

export function videoHistory(store, { channel, video, now = Date.now() } = {}) {
  const m = /(?:v=|shorts\/|youtu\.be\/|live\/)?([A-Za-z0-9_-]{11})(?:[?&#]|$)/.exec(String(video || '').trim());
  if (video && !m) return { error: 'Give a YouTube video id or URL.' };
  const ch = resolveOwn(store, channel);
  if (!ch) return { error: 'No channel history yet.' };
  if (!video) {
    const card = reportCard(store, ch.channel_id, { now, limit: 30 });
    return { channel: ch.title, channel_id: ch.channel_id, ...card, note: 'cp: views in the first 48 h / 7 d / 30 d (tracker = hourly measurements; analytics = the first 2 / 7 / 30 Analytics days). vs_channel / vs_niche: ÷ the median. Give video for one video\'s daily rows.' };
  }
  const id = m[1];
  const v = store.db.prepare('SELECT * FROM own_videos WHERE video_id = ?').get(id);
  if (!v) return { error: `Video ${id} isn't one of the last ${VIDEO_WINDOW_DAYS} days' uploads of a connected channel (only those get daily rows).` };
  const rows = store.db.prepare('SELECT day, metric FROM own_video_daily WHERE video_id = ? ORDER BY day').all(id).map((r) => ({ day: r.day, ...parse(r.metric, {}) }));
  const card = reportCard(store, v.channel_id, { now, limit: 1000 }).videos.find((x) => x.id === id);
  return { video: card || { id, title: v.title }, daily: rows.map((r) => ({ day: r.day, views: r.views, engaged_views: r.engaged, watch_minutes: R(r.minutes, 1), avg_view_pct: R(r.avg_pct, 1), likes: r.likes, comments: r.comments, shares: r.shares, subscribers_gained: r.subs_gained })) };
}

export function yppProgress(store, { channel, now = Date.now() } = {}) {
  const ch = resolveOwn(store, channel);
  if (!ch) return { error: 'No channel history yet.' };
  const { rows, end, first } = seriesOf(store, ch, now);
  const y = yppOf(ch, rows, end, first);
  return {
    channel: ch.title, channel_id: ch.channel_id, ...y,
    requirements: '1,000 subscribers and either 4,000 public watch hours on long-form videos in the last 365 days, or 10M public Shorts views in the last 90 days.',
    note: (y.approx_hours ? 'Analytics did not split watch time by content type for this channel, so Shorts\' watch time is included (YouTube does not count it). ' : '')
      + 'eta_days keeps the pace of the last 28 days and drops days as they leave the rolling window; null = not reachable within 3 years at this pace, or under 14 days of history. YouTube Studio\'s numbers are the official ones (they exclude private/unlisted and removed videos).'
  };
}
