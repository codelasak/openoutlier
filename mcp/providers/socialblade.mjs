// OpenOutlier – Social Blade Business API (optional, off; docs/youtube-niche-plan.md 8.1–8.2).
//
// One job only: a one-time backfill of a tracked competitor's daily subscribers and views from
// before tracking started, into channel_stats with source='socialblade'. Rows the tracker already
// has (source 'api') are never overwritten. Social Blade charges prepaid credits per channel
// (1 = 30 days, 2 = a year, 3 = three years of daily history) and a channel asked again within
// 30 days is free, so quote() shows the cost first and backfill() refuses to run without the
// confirmed quote.
//
// The request (Social Blade's "matrix" endpoint) and its answer, as documented for the Business
// API: GET https://matrix.sbapi.dev/b/youtube/statistics?query=<UC…>&history=default|extended|archive
// with the headers clientid and token → { status: { success }, info: { credits: { available } },
// data: { id: { id, username, display_name }, daily: [{ date, subscribers, views }] } }. Only
// checked against fixtures here (budget $0): the first real call should be watched.
import { PROVIDERS, keyOf, logCall } from './index.mjs';

export const ID = 'socialblade';
export const URL_BASE = 'https://matrix.sbapi.dev/b/youtube/statistics';
const DAY = 864e5;
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
export const HISTORY = {
  '30d': { param: 'default', credits: 1, days: 30 },
  '1y': { param: 'extended', credits: 2, days: 365 },
  '3y': { param: 'archive', credits: 3, days: 1095 }
};
export const FREE_AGAIN_MS = 30 * DAY;

/** Channels asked in the last 30 days (free to ask again). */
function recent(store, now) {
  return new Set(store.db.prepare('SELECT DISTINCT ref FROM provider_log WHERE provider = ? AND at > ?').all(ID, now - FREE_AGAIN_MS).map((r) => r.ref));
}

/**
 * What a backfill would cost. channels: UC ids (default: every active tracked channel that isn't
 * yours). → { history, per_channel, channels, free, credits, est_usd, note }
 */
export function quote(store, { channels, history = '1y', now = Date.now() } = {}) {
  const h = HISTORY[history] || HISTORY['1y'];
  const list = (channels && channels.length ? channels : store.db.prepare('SELECT channel_id FROM tracked_channels WHERE active = 1 AND mine = 0').all().map((r) => r.channel_id))
    .filter((c) => CHANNEL_ID_RE.test(String(c)));
  const uniq = [...new Set(list)];
  const seen = recent(store, now);
  const free = uniq.filter((c) => seen.has(c));
  const credits = (uniq.length - free.length) * h.credits;
  return {
    provider: PROVIDERS[ID].name, history: HISTORY[history] ? history : '1y', per_channel: h.credits, channels: uniq, free, credits,
    est_usd: Math.round(credits * 0.5 * 100) / 100,
    note: 'Social Blade sells 100 credits for about $50; a channel asked again within 30 days costs nothing.'
  };
}

/** Social Blade's answer → { ok, daily: [{ day, subs, views }], credits_left, name, error } */
export function parseStats(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Not a Social Blade answer.' };
  const st = body.status || {};
  if (st.success === false || st.error) return { ok: false, error: String(st.error || st.message || 'Social Blade refused the request.') };
  const d = body.data || {};
  const daily = (Array.isArray(d.daily) ? d.daily : []).map((r) => ({
    day: typeof r.date === 'string' ? r.date.slice(0, 10) : null,
    subs: Number.isFinite(Number(r.subscribers)) ? Math.round(Number(r.subscribers)) : null,
    views: Number.isFinite(Number(r.views)) ? Math.round(Number(r.views)) : null
  })).filter((r) => r.day && /^\d{4}-\d{2}-\d{2}$/.test(r.day) && (r.subs != null || r.views != null));
  const credits = body.info && body.info.credits && Number.isFinite(Number(body.info.credits.available)) ? Number(body.info.credits.available) : null;
  return { ok: true, daily, credits_left: credits, name: d.id && (d.id.display_name || d.id.username) || null };
}

/**
 * The backfill. confirm must repeat the quote's credits (what the user saw and accepted);
 * without the key or the switch it makes no request. → { ok, credits_used, credits_left, channels: [{ channel_id, days, from, to, error }] }
 */
export async function backfill(store, { channels, history = '1y', confirm, fetch: doFetch = globalThis.fetch, home, now = Date.now(), on } = {}) {
  if (!on) return { ok: false, error: 'Social Blade is switched off (Features → Optional providers).' };
  const key = keyOf(ID, home);
  if (!key) return { ok: false, error: 'No Social Blade key yet (Library → Settings → Optional providers).' };
  const q = quote(store, { channels, history, now });
  if (confirm == null || Number(confirm) !== q.credits) return { ok: false, needs_confirm: true, quote: q, error: `This uses ${q.credits} credits; confirm with that number.` };
  const h = HISTORY[q.history];
  const ins = store.db.prepare("INSERT OR IGNORE INTO channel_stats (channel_id, day, subs, views, videos, source) VALUES (?, ?, ?, ?, NULL, 'socialblade')");
  const out = [];
  let used = 0;
  let left = null;
  for (const ch of q.channels) {
    const url = `${URL_BASE}?query=${encodeURIComponent(ch)}&history=${h.param}`;
    let r;
    try {
      const res = await doFetch(url, { headers: { clientid: key.clientId, token: key.token, accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
      const body = await res.json().catch(() => null);
      r = res.ok ? parseStats(body) : { ok: false, error: (body && body.status && (body.status.error || body.status.message)) || `HTTP ${res.status}` };
    } catch (e) { r = { ok: false, error: 'Could not reach Social Blade (' + e.message + ').' }; }
    if (!r.ok) { out.push({ channel_id: ch, error: r.error }); if (/credit/i.test(r.error)) break; continue; }
    const cost = q.free.includes(ch) ? 0 : h.credits;
    used += cost;
    if (r.credits_left != null) left = r.credits_left;
    store.db.exec('BEGIN');
    try { for (const d of r.daily) ins.run(ch, d.day, d.subs, d.views); store.db.exec('COMMIT'); } catch (e) { store.db.exec('ROLLBACK'); throw e; }
    logCall(store, ID, ch, cost, `${q.history}: ${r.daily.length} days`, now);
    const days = r.daily.map((d) => d.day).sort();
    out.push({ channel_id: ch, name: r.name, days: days.length, from: days[0] || null, to: days[days.length - 1] || null });
  }
  return { ok: true, history: q.history, credits_used: used, credits_left: left, channels: out };
}
