// OpenOutlier – Return YouTube Dislike on the bridge (optional, off; docs/youtube-niche-plan.md 8.2).
//
// The extension already shows RYD's dislike estimate on watch pages (the `dislikes` feature, phase 3,
// src/youtube-insights-bg.js). This is the same call for Claude: with `provider-ryd` on, the MCP
// tool video_velocity adds the estimate. No key; the video id goes to returnyoutubedislikeapi.com,
// which asks for attribution (returnyoutubedislike.com) and allows 100 requests a minute per client.
export const ID = 'ryd';
export const ENDPOINT = 'https://returnyoutubedislikeapi.com/votes?videoId=';
const cache = new Map(); // video id → { at, value }
const TTL = 24 * 3600 * 1000;

/** → { likes, dislikes, rating, via } | null (quietly: RYD is an estimate, never required). */
export async function votes(videoId, { fetch: doFetch = globalThis.fetch, now = Date.now() } = {}) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(String(videoId || ''))) return null;
  const hit = cache.get(videoId);
  if (hit && now - hit.at < TTL) return hit.value;
  try {
    const res = await doFetch(ENDPOINT + videoId, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const j = await res.json();
    const value = j && Number.isFinite(Number(j.dislikes)) ? { likes: Number(j.likes) || null, dislikes: Number(j.dislikes), rating: Number(j.rating) || null, via: 'returnyoutubedislike.com (estimate)' } : null;
    cache.set(videoId, { at: now, value });
    return value;
  } catch { return null; }
}
