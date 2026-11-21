// OpenOutlier – DataForSEO YouTube SERP (optional, off; docs/youtube-niche-plan.md 8.1–8.2).
//
// Rank tracking for the keywords the user picks (Library → Niş Takibi → Keywords → "Track rank"):
// once a day, where the user's own tracked channel ranks in YouTube's results for each keyword.
// DataForSEO gets these results by scraping YouTube, which YouTube's API policy (§III.E.6) does not
// allow next to a Data API key in the same app: that is why it is a separate switch, off by
// default, its rows are labelled source='dataforseo', and the UI says "scraping-based".
//
// Request: POST https://api.dataforseo.com/v3/serp/youtube/organic/live/advanced with HTTP Basic
// auth (login:password) and [{ keyword, location_code, language_code, device, block_depth }].
// Answer: { status_code: 20000, cost, tasks: [{ status_code, result: [{ items: [{ type: 'youtube_video',
// rank_absolute, video_id, channel_id, title, channel_name }] }] }] }. Checked against fixtures only.
import { keyOf, logCall } from './index.mjs';

export const ID = 'dataforseo';
export const ENDPOINT = 'https://api.dataforseo.com/v3/serp/youtube/organic/live/advanced';
export const EST_USD = 0.002; // per keyword, live mode (approximate; the answer's `cost` is what gets logged)
export const LOCATIONS = { US: 2840, GB: 2826, TR: 2792, DE: 2276, CA: 2124, AU: 2036, IN: 2356 };

export function estimate(n) { return { keywords: n, est_usd: Math.round(n * EST_USD * 1000) / 1000, per_keyword: EST_USD }; }

/** One keyword's answer → { ok, items: [{ rank, video_id, channel_id, title, channel }], cost } */
export function parseSerp(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Not a DataForSEO answer.' };
  if (body.status_code && body.status_code !== 20000) return { ok: false, error: String(body.status_message || 'DataForSEO refused the request.') };
  const task = (body.tasks || [])[0] || {};
  if (task.status_code && task.status_code !== 20000) return { ok: false, error: String(task.status_message || 'DataForSEO task failed.') };
  const items = (((task.result || [])[0] || {}).items || []).filter((i) => i && i.type === 'youtube_video' && i.video_id)
    .map((i) => ({ rank: Number(i.rank_absolute || i.rank_group) || null, video_id: String(i.video_id), channel_id: i.channel_id ? String(i.channel_id) : null, title: i.title || null, channel: i.channel_name || null }))
    .sort((a, b) => (a.rank || 999) - (b.rank || 999));
  return { ok: true, items, cost: Number.isFinite(Number(task.cost ?? body.cost)) ? Number(task.cost ?? body.cost) : null };
}

/**
 * Check where `mine` channels rank for each keyword and store one row per keyword and day in serp_ranks.
 * → { ok, checked: [{ keyword, rank, video_id }], cost }
 */
export async function checkRanks(store, { keywords, region = 'US', lang = 'en', fetch: doFetch = globalThis.fetch, home, now = Date.now(), on } = {}) {
  if (!on) return { ok: false, error: 'DataForSEO is switched off (Features → Optional providers).' };
  const key = keyOf(ID, home);
  if (!key) return { ok: false, error: 'No DataForSEO login yet (Library → Settings → Optional providers).' };
  const mine = new Set(store.db.prepare('SELECT channel_id FROM tracked_channels WHERE mine = 1').all().map((r) => r.channel_id));
  const day = new Date(now).toISOString().slice(0, 10);
  const auth = 'Basic ' + Buffer.from(key.login + ':' + key.password).toString('base64');
  const put = store.db.prepare('INSERT OR REPLACE INTO serp_ranks (keyword, day, source, rank, video_id, channel_id, top, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const out = [];
  let cost = 0;
  for (const kw of (keywords || []).slice(0, 50)) {
    let r;
    try {
      const res = await doFetch(ENDPOINT, { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' },
        body: JSON.stringify([{ keyword: kw, location_code: LOCATIONS[region] || LOCATIONS.US, language_code: lang, device: 'desktop', block_depth: 40 }]), signal: AbortSignal.timeout(60000) });
      const body = await res.json().catch(() => null);
      r = res.ok ? parseSerp(body) : { ok: false, error: `HTTP ${res.status}` };
    } catch (e) { r = { ok: false, error: 'Could not reach DataForSEO (' + e.message + ').' }; }
    if (!r.ok) { out.push({ keyword: kw, error: r.error }); if (/auth|credit|balance|401|402/i.test(r.error)) break; continue; }
    const hit = r.items.find((i) => i.channel_id && mine.has(i.channel_id)) || null;
    put.run(kw, day, ID, hit ? hit.rank : null, hit ? hit.video_id : null, hit ? hit.channel_id : null, JSON.stringify(r.items.slice(0, 10)), now);
    cost += r.cost || EST_USD;
    logCall(store, ID, kw, r.cost ?? EST_USD, hit ? 'rank ' + hit.rank : 'not ranked', now);
    out.push({ keyword: kw, rank: hit ? hit.rank : null, video_id: hit ? hit.video_id : null });
  }
  return { ok: true, checked: out, cost: Math.round(cost * 10000) / 10000 };
}

/** The latest rank per keyword and the one 7 days before. → { keyword: { rank, day, prev } } */
export function latestRanks(store) {
  const rows = store.db.prepare('SELECT keyword, day, rank FROM serp_ranks WHERE source = ? ORDER BY day DESC').all(ID);
  const out = {};
  for (const r of rows) {
    const e = out[r.keyword];
    if (!e) out[r.keyword] = { rank: r.rank, day: r.day, prev: null };
    else if (e.prev === null && Date.parse(e.day) - Date.parse(r.day) >= 6.5 * 864e5) e.prev = r.rank ?? 0;
  }
  return out;
}
