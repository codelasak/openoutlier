// OpenOutlier MCP – the X data the later phases share, read from the bridge's copy of the Library
// (Phase 1 storage: accounts x/<handle>, rs:org) and Phase 2's SQLite tables.
//
//   ownXId(store, lib)          the user's own X account id, one rule for every tool:
//                               Phase 2's handle (meta x_own, from the Library's My X page / analytics),
//                               else the profile Phase 3 marked me: true (x.com side nav), else Phase 2's default
//   xData                       for registerXLlmTools (x_voice_profile, x_draft_check)
//   xPostStats / xFollowerDeltas  for registerXGrowthTools (Phase 3 pace and follower change)
//   putVoice / VOICE_META       the voice profile (rs:x-voice) the extension syncs; never the API key
//
// Read-only towards X: nothing here contacts X.
import { createRequire } from 'node:module';
import { ownAccount } from './x-own.mjs';
import { xMe } from './x-growth-tools.mjs';

const require = createRequire(import.meta.url);
const M = require('../src/metrics.js');
const XP = require('../src/x.js');

const DAY = 864e5;
export const VOICE_META = 'x_voice';
const OWN_META = 'x_own';
const RECENT_DAYS = 14;

const libOf = (store, lib) => lib || store.readLibrary();
const textOf = (p) => String(p.caption || p.title || p.text || '').trim();

/** The own X account id ('x/<handle>'). */
export function ownXId(store, lib) {
  let meta = null;
  try { meta = store.getMeta(OWN_META, null); } catch { /* no table */ }
  if (meta && meta.handle) { try { return ownAccount(store, meta.handle); } catch { /* bad handle: fall through */ } }
  try { const me = xMe(libOf(store, lib)); if (me) return me.id; } catch { /* none */ }
  return ownAccount(store);
}

/** The user's own ORIGINAL posts, newest first, x = views ÷ their own (format) median. */
export function ownPosts(store, { limit = 100 } = {}, lib) {
  const L = libOf(store, lib);
  const id = ownXId(store, L);
  const rec = L.accounts?.[id];
  if (!rec) return [];
  return M.enrich(Object.values(rec.posts || {}))
    .filter((p) => p.kind === 'original' && !p.isRepost && textOf(p))
    .sort((a, b) => (b.takenAt || 0) - (a.takenAt || 0))
    .slice(0, limit)
    .map((p) => ({ id: p.code, text: textOf(p), views: p.views ?? null, x: p.ratio ?? null, format: p.type || null,
      created_at: p.takenAt ? new Date(p.takenAt).toISOString() : null }));
}

/** X posts of other Library accounts seen (or posted) in the last 14 days, newest first. */
export function recentPosts(store, { limit = 200, now = Date.now() } = {}, lib) {
  const L = libOf(store, lib);
  const own = ownXId(store, L);
  const since = now - RECENT_DAYS * DAY;
  const out = [];
  for (const id of Object.keys(L.accounts || {})) {
    if (id === own || !XP.isXId(id)) continue;
    for (const p of Object.values(L.accounts[id].posts || {})) {
      const t = Math.max(p.seenAt || 0, p.takenAt || 0);
      if (t < since || p.kind === 'repost' || !textOf(p)) continue;
      out.push({ id: p.code, text: textOf(p), url: p.url || null, author: p.author || id.slice(2), t });
    }
  }
  return out.sort((a, b) => b.t - a.t).slice(0, limit).map(({ t, ...r }) => r);
}

/** The swipe file (rs:org.swipe.items, any platform) as { id, text, url, author }. */
export function swipeItems(store, lib) {
  const items = libOf(store, lib).org?.swipe?.items;
  if (!items || typeof items !== 'object') return [];
  return Object.values(items).filter((it) => it && String(it.title || it.note || '').trim()).map((it) => ({
    id: it.id,
    text: String(it.title || it.note).trim(),
    url: it.url || (it.platform === 'x' && it.video ? 'https://x.com/i/status/' + it.video : it.platform === 'youtube' && it.video ? 'https://www.youtube.com/watch?v=' + it.video : null),
    author: it.channel || it.account || null
  }));
}

/** rs:x-voice as the extension synced it, or null. */
export function voiceProfile(store) {
  const v = store.getMeta(VOICE_META, null);
  return v && typeof v.text === 'string' && v.text.trim() ? v : null;
}

/** Keep the synced voice profile: only { text, updatedAt, source, model }. null removes it. */
export function putVoice(store, v) {
  if (v === undefined) return;
  if (!v || typeof v !== 'object' || typeof v.text !== 'string') { store.setMeta(VOICE_META, null); return; }
  const clean = {
    text: v.text.slice(0, 20000),
    updatedAt: Number.isFinite(v.updatedAt) ? v.updatedAt : null,
    source: v.source === 'edited' ? 'edited' : 'llm',
    model: typeof v.model === 'string' ? v.model.slice(0, 80) : undefined
  };
  if (JSON.stringify(clean) !== JSON.stringify(store.getMeta(VOICE_META, null))) store.setMeta(VOICE_META, clean);
}

export const xData = { available: true, ownPosts, voiceProfile, recentPosts, swipe: (store) => swipeItems(store) };

/** x_post_stats rows of these accounts → the shape src/x-growth.js paceFromRows takes. */
export function xPostStats(store, accountIds) {
  const ids = (accountIds || []).filter(Boolean);
  if (!ids.length) return [];
  try {
    return store.db.prepare(`SELECT post_id, account_id AS owner, ts, views, taken_at FROM x_post_stats
      WHERE account_id IN (${ids.map(() => '?').join(',')}) AND views IS NOT NULL`).all(...ids);
  } catch { return []; }
}

/** Follow − Unfollow per day of the own account (x_own_daily, from the analytics). */
export function xFollowerDeltas(store, meId) {
  const out = {};
  try {
    for (const r of store.db.prepare('SELECT day, follows, unfollows FROM x_own_daily WHERE handle = ? AND (follows IS NOT NULL OR unfollows IS NOT NULL)').all(meId)) {
      out[r.day] = (r.follows || 0) - (r.unfollows || 0);
    }
  } catch { /* no table */ }
  return out;
}
