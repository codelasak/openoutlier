// OpenOutlier – what the in-page badges and cards (phase 3) ask the bridge for.
//
// The extension's YouTube tab sends the video and channel ids it has on screen; the bridge
// answers from the tracker's measurements (video_stats, tracked_videos, channel_stats) and the
// own-channel history (own_video_daily). Read only: nothing here starts a request to YouTube.
//
//   cardsLookup   POST /youtube/cards        latest exact counts + velocity of tracked videos,
//                                            tracked channels' facts and baselines
//   channelCard   GET  /youtube/channel-card the growth chart of a tracked channel
//   videoCard     GET  /youtube/video-card   a watch page: last-24 h VPH, the velocity curve
//                                            against the channel's normal, and "according to
//                                            Analytics" for the user's own videos
import { createRequire } from 'node:module';
import { loadModel, growthOf } from './niche.mjs';

const require = createRequire(import.meta.url);
const V = require('../src/velocity.js');

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
export const MAX_VIDEOS = 300;
export const MAX_CHANNELS = 100;

function fmtOf(v) { return v && v.type === 'short' ? 'short' : 'long'; }
function round(x, d = 2) { return x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d; }

/** The niche model a tracked channel belongs to (one per niche, memoized by niche.mjs). */
function modelFor(store, channelId, now, memo) {
  const ch = store.db.prepare('SELECT niche FROM tracked_channels WHERE channel_id = ?').get(channelId);
  const key = ch ? ch.niche ?? '' : '';
  if (!memo.has(key)) memo.set(key, loadModel(store, { niche: key, now }));
  return memo.get(key);
}

function latestStats(store, ids) {
  if (!ids.length) return new Map();
  const q = ids.map(() => '?').join(',');
  const rows = store.db.prepare(`SELECT s.video_id, s.ts, s.views, s.likes, s.comments, s.source FROM video_stats s
    JOIN (SELECT video_id, MAX(ts) AS ts FROM video_stats WHERE views IS NOT NULL AND video_id IN (${q}) GROUP BY video_id) m
    ON m.video_id = s.video_id AND m.ts = s.ts`).all(...ids);
  return new Map(rows.map((r) => [r.video_id, r]));
}

/**
 * { videos: [ids], channels: [UC…] } → {
 *   videos:   { id: { views, likes, comments, ts, source, published_at, type, tracked, velocity: { at, hours, score, views, expected } | null } },
 *   channels: { UC: { tracked, mine, niche, name, subs, views, videos, day, baseline: { long, short } } }
 * } Unknown ids are left out.
 */
export function cardsLookup(store, { videos = [], channels = [], now = Date.now() } = {}) {
  const vids = [...new Set((videos || []).filter((x) => VIDEO_ID_RE.test(String(x))))].slice(0, MAX_VIDEOS);
  const chs = [...new Set((channels || []).filter((x) => CHANNEL_ID_RE.test(String(x))))].slice(0, MAX_CHANNELS);
  const out = { videos: {}, channels: {} };
  const memo = new Map();
  const latest = latestStats(store, vids);
  const tracked = new Map();
  if (vids.length) {
    const q = vids.map(() => '?').join(',');
    for (const r of store.db.prepare(`SELECT video_id, channel_id, published_at, type FROM tracked_videos WHERE video_id IN (${q})`).all(...vids)) tracked.set(r.video_id, r);
  }
  for (const id of vids) {
    const l = latest.get(id);
    const t = tracked.get(id);
    if (!l && !t) continue;
    const o = { views: l ? l.views : null, likes: l ? l.likes : null, comments: l ? l.comments : null, ts: l ? l.ts : null, source: l ? l.source : null,
      published_at: t ? t.published_at : null, type: t ? t.type : null, tracked: !!t, velocity: null };
    if (t) {
      const m = modelFor(store, t.channel_id, now, memo);
      const v = m.byId.get(id);
      if (v && v.velocity) o.velocity = { at: v.velocity.label, hours: v.velocity.at, score: round(v.velocity.score), views: v.velocity.views, expected: v.velocity.expected };
    }
    out.videos[id] = o;
  }
  if (chs.length) {
    const q = chs.map(() => '?').join(',');
    const rows = store.db.prepare(`SELECT * FROM tracked_channels WHERE channel_id IN (${q})`).all(...chs);
    for (const c of rows) {
      const st = store.db.prepare('SELECT day, subs, views, videos FROM channel_stats WHERE channel_id = ? ORDER BY day DESC LIMIT 1').get(c.channel_id);
      const o = { tracked: !!c.active, mine: !!c.mine, niche: c.niche || null, name: c.name || null, subs: st && st.subs != null ? st.subs : c.subs ?? null,
        views: st ? st.views : null, videos: st ? st.videos : null, day: st ? st.day : null, baseline: { long: null, short: null } };
      if (c.active) {
        const m = modelFor(store, c.channel_id, now, memo);
        for (const f of ['long', 'short']) { const g = m.perGroup.get(c.channel_id + '|' + f); if (g && g.baseline) o.baseline[f] = Math.round(g.baseline); }
      }
      out.channels[c.channel_id] = o;
    }
  }
  return out;
}

/** The channel page's growth chart: { tracked, since, series: [{ day, subs, views, videos }], delta_7d, delta_28d } or { tracked: false }. */
export function channelCard(store, { channel, days = 90, now = Date.now() } = {}) {
  if (!CHANNEL_ID_RE.test(String(channel || ''))) return { error: 'Give a channel id (UC…).' };
  const c = store.db.prepare('SELECT * FROM tracked_channels WHERE channel_id = ?').get(channel);
  if (!c) return { tracked: false };
  const [g] = growthOf(store, [c], now, days);
  return { tracked: !!c.active, mine: !!c.mine, niche: c.niche || null, since: c.added_at, name: g.name, subs: g.subs, series: g.series, delta_7d: g.delta_7d, delta_28d: g.delta_28d };
}

/**
 * A watch page's extras: { tracked, published_at, type, latest, vph24, velocity, curve, own }.
 *   curve: the video's views at hours since publish next to the channel's expected views there
 *          (the sparkline), points: [{ h, views, expected }];
 *   own:   for the user's own uploads, the YouTube Analytics totals so far.
 */
export function videoCard(store, { video, now = Date.now() } = {}) {
  const id = String(video || '');
  if (!VIDEO_ID_RE.test(id)) return { error: 'Give a YouTube video id.' };
  const out = { tracked: false, own: ownVideo(store, id) };
  const t = store.db.prepare('SELECT video_id, channel_id, published_at, type FROM tracked_videos WHERE video_id = ?').get(id);
  const all = store.videoStats(id);
  const last = [...all].reverse().find((p) => p.views != null) || null;
  if (last) out.latest = { views: last.views, likes: last.likes, comments: last.comments, ts: last.ts, source: last.source };
  if (!t) return out;
  out.tracked = true;
  out.published_at = t.published_at;
  out.type = t.type;
  if (t.published_at) {
    const v24 = V.vph24(all, t.published_at, now);
    if (v24) out.vph24 = { vph: Math.round(v24.vph), hours: round(v24.hours, 1), at: v24.at };
    const m = modelFor(store, t.channel_id, now, new Map());
    const v = m.byId.get(id);
    if (v) {
      if (v.velocity) out.velocity = { at: v.velocity.label, hours: v.velocity.at, score: round(v.velocity.score), views: v.velocity.views, expected: v.velocity.expected };
      const g = m.perGroup.get(t.channel_id + '|' + fmtOf(v));
      out.baseline = g && g.baseline ? Math.round(g.baseline) : null;
      out.curve = V.CHECKPOINTS.filter((h) => h <= (now - t.published_at) / HOUR + 1e-9).map((h) => ({
        h, views: v.cp[h] != null ? Math.round(v.cp[h]) : null, expected: v.expected && v.expected[h] ? Math.round(v.expected[h].value) : null
      })).filter((p) => p.views != null || p.expected != null);
    }
  }
  return out;
}

/** The user's own upload: YouTube Analytics totals from own_video_daily, or null. */
export function ownVideo(store, id) {
  const meta = store.db.prepare('SELECT video_id, channel_id, title, published_at, type FROM own_videos WHERE video_id = ?').get(id);
  const rows = store.db.prepare('SELECT day, metric FROM own_video_daily WHERE video_id = ? ORDER BY day').all(id);
  if (!meta && !rows.length) return null;
  const sum = { views: 0, minutes: 0, likes: 0, comments: 0, shares: 0, subs_gained: 0 };
  let pctW = 0;
  let pctV = 0;
  let days = 0;
  for (const r of rows) {
    let m;
    try { m = JSON.parse(r.metric); } catch { continue; }
    days++;
    for (const k of Object.keys(sum)) if (Number.isFinite(m[k])) sum[k] += m[k];
    if (Number.isFinite(m.avg_pct) && m.views > 0) { pctW += m.avg_pct * m.views; pctV += m.views; }
  }
  return {
    channel_id: meta ? meta.channel_id : null, days, through: rows.length ? rows[rows.length - 1].day : null, first_day: rows.length ? rows[0].day : null,
    views: sum.views, watch_hours: round(sum.minutes / 60, 1), avg_pct: pctV ? round(pctW / pctV, 1) : null,
    likes: sum.likes, comments: sum.comments, shares: sum.shares, subs_gained: sum.subs_gained
  };
}
