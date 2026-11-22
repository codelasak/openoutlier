// OpenOutlier – phase 5 (keşif / discovery) on the bridge (docs/youtube-niche-plan.md 6.4–6.6, 8.2).
//
//   • niche-radar (6.5): a daily job, one search.list per keyword (100 units; publishedAfter = 7 days
//     ago, order=viewCount, type=video), then videos.list and channels.list for the results (1 unit
//     per 50). It stops before the shared daily budget runs out (the tracker's 9,000 units, the
//     extension's included, keeping a reserve for the tracker's own jobs). Results → radar_videos /
//     seen_channels; the page turns them into "small-channel breakouts this week" and "rising
//     channels you don't track" (src/discovery.js → radarLists).
//   • channel-similar (6.4): the extension posts each watch page's "Up Next" channels (co_recs:
//     aggregated, decaying counts only), TF-IDF over the channels' titles, tags and descriptions
//     (tracked videos + the Library), and a perceptual hash of thumbnails (thumb_hashes, filled by a
//     slow background job) for "similar thumbnails".
//   • keyword ideas (6.6): YouTube's autocomplete through the bridge (rate-limited, cached 7 days),
//     merged with the niche's title words, topic gaps and the user's own search terms (phase 2).
//   • MCP: similar_channels, keyword_ideas, niche_radar.
import { createRequire } from 'node:module';
import { apiKeyInfo, quotaOf } from './youtube-api.mjs';
import { nicheNames, nicheSignals, upsertJob } from './niche.mjs';
import { ownChannels, searchTerms } from './own-history.mjs';
import { thumbAndSnap, hamming } from './thumbhash.mjs';
import * as PROV from './providers/index.mjs';
import * as DFS from './providers/dataforseo.mjs';

const require = createRequire(import.meta.url);
const D = require('../src/discovery.js');
const A = require('../src/youtube-api.js');
const I = require('../src/yt-insights.js');
const Features = require('../src/features.js');

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
export const RADAR_META = 'radar_settings';
// Keywords added from the bridge side (an agent, a script). The extension owns the radar settings
// (rs:radar) and pushes them one way, so the bridge offers these in its /settings answer; the
// extension merges them into rs:radar once and pushes back; the offer is cleared when they arrive.
export const RADAR_PROPOSAL_META = 'radar_proposal';
export const BUDGET = 9000;           // the tracker's daily budget (mcp/tracker.mjs)
export const RADAR_RESERVE = 500;     // left for the tracker's own jobs when the radar runs
export const SUGGEST_TTL = 7 * DAY;
export const THUMB_BATCH = 40;
export const THUMB_MAX_DIST = 12;     // of 64 bits: "looks alike" (the title history calls > 10 a new image)

const flagsOf = (store) => Features.resolve(store.getMeta('features', null));
const parse = (t, d) => { try { return t ? JSON.parse(t) : d; } catch { return d; } };
const R = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const ytUrl = (id, type) => (type === 'short' ? 'https://www.youtube.com/shorts/' + id : 'https://www.youtube.com/watch?v=' + id);

// ---- settings (rs:settings.radar → POST /settings → meta.radar_settings) -------------------------------
export function radarSettings(store) { return D.sanitizeRadar(store.getMeta(RADAR_META, null)); }
export function saveRadarSettings(store, s) {
  const next = D.sanitizeRadar(s);
  if (JSON.stringify(next) !== JSON.stringify(store.getMeta(RADAR_META, null))) store.setMeta(RADAR_META, next);
  return next;
}
/**
 * Add radar keywords for a niche from the bridge: applied here at once (the next radar run uses
 * them) and offered to the extension, which keeps them. → { ok, niche, keywords (the niche's list now), added }
 */
export function proposeRadarKeywords(store, { niche, keywords, now = Date.now() } = {}) {
  const n = String(niche ?? '').slice(0, 80);
  const clean = D.sanitizeRadar({ keywords: { [n]: Array.isArray(keywords) ? keywords : [] } }).keywords[n] || [];
  const cur = radarSettings(store);
  const had = cur.keywords[n] || [];
  const added = clean.filter((k) => !had.includes(k));
  saveRadarSettings(store, { ...cur, keywords: { ...cur.keywords, [n]: had.concat(added).slice(0, 30) } });
  const prev = store.getMeta(RADAR_PROPOSAL_META, null);
  const kw = { ...(prev && prev.keywords) };
  kw[n] = [...new Set((kw[n] || []).concat(clean))].slice(0, 30);
  store.setMeta(RADAR_PROPOSAL_META, { keywords: kw, at: now });
  return { ok: true, niche: n || null, keywords: radarSettings(store).keywords[n] || [], added };
}
/** The extension pushed its radar settings: drop the offer once every offered keyword is in them. */
export function settleRadarProposal(store) {
  const p = store.getMeta(RADAR_PROPOSAL_META, null);
  if (!p || !p.keywords) return false;
  const cur = radarSettings(store).keywords;
  const done = Object.entries(p.keywords).every(([n, list]) => list.every((k) => (cur[n] || []).includes(k)));
  if (done) store.setMeta(RADAR_PROPOSAL_META, null);
  return done;
}
function pickNiche(store, niche) {
  const names = nicheNames(store);
  const pick = niche !== undefined && niche !== null ? niche : (names.find((n) => n.mine) || names[0] || { name: null }).name;
  return { names, pick: pick ?? null };
}

// ---- channel names (tracked, seen in sidebars / radar, saved in the Library) -------------------------
function libraryChannels(lib) {
  const out = new Map(); // UC → { account, name, handle, posts }
  for (const [acct, rec] of Object.entries(lib.accounts || {})) {
    if (!/^yt\//.test(acct)) continue;
    const posts = Object.values(rec.posts || {});
    let uc = rec.profile && CHANNEL_ID_RE.test(String(rec.profile.channelId || '')) ? rec.profile.channelId : null;
    if (!uc && /^yt\/UC/.test(acct) && CHANNEL_ID_RE.test(acct.slice(3))) uc = acct.slice(3);
    if (!uc) for (const p of posts) if (CHANNEL_ID_RE.test(String(p.ownerId || ''))) { uc = p.ownerId; break; }
    if (!uc) continue;
    const prof = rec.profile || {};
    out.set(uc, { account: acct, name: prof.name || rec.name || (posts[0] && posts[0].ownerName) || null, handle: prof.handle || (/^yt\/UC/.test(acct) ? null : acct.slice(3)),
      subs: prof.subscribers ?? null, thumb: prof.avatar || null, posts });
  }
  return out;
}
function nameIndex(store, lib) {
  const idx = new Map();
  const put = (id, o) => { const e = idx.get(id) || { id }; for (const k of Object.keys(o)) if (o[k] != null && e[k] == null) e[k] = o[k]; idx.set(id, e); };
  for (const c of store.db.prepare('SELECT * FROM tracked_channels').all()) put(c.channel_id, { name: c.name, handle: c.handle, account: c.account_id, subs: c.subs, tracked: !!c.active, mine: !!c.mine, niche: c.niche });
  for (const [uc, c] of libraryChannels(lib)) put(uc, { name: c.name, handle: c.handle, account: c.account, subs: c.subs, thumb: c.thumb, saved: true });
  for (const c of store.db.prepare('SELECT * FROM seen_channels').all()) put(c.channel_id, { name: c.name, handle: c.handle, subs: c.subs, thumb: c.thumb });
  return idx;
}
function brief(idx, id, extra) {
  const e = idx.get(id) || {};
  return { id, name: e.name || (e.handle ? '@' + e.handle : id), handle: e.handle || null, account: e.account || (e.handle ? 'yt/' + e.handle : 'yt/' + id), subs: e.subs ?? null,
    thumb: e.thumb || null, tracked: !!e.tracked, mine: !!e.mine, saved: !!e.saved, url: 'https://www.youtube.com/' + (e.handle ? '@' + e.handle : 'channel/' + id), ...extra };
}
/** A channel reference (UC id, yt/handle, @handle, name) → UC id or null. */
export function resolveChannel(store, ref, lib = store.readLibrary()) {
  const r = String(ref || '').trim();
  if (!r) return null;
  if (CHANNEL_ID_RE.test(r)) return r;
  const m = /^yt\/(UC[A-Za-z0-9_-]{22})$/.exec(r);
  if (m) return m[1];
  const n = (s) => String(s || '').toLowerCase().replace(/^(yt\/|@)/, '').replace(/[^a-z0-9\u00c0-\uffff]+/g, '');
  const want = n(r);
  if (!want) return null;
  for (const [id, e] of nameIndex(store, lib)) if (n(e.handle) === want || n(e.account) === want || n(e.name) === want) return id;
  return null;
}

// ---- co-recommendations (6.4a) ------------------------------------------------------------------------
/**
 * One watch page's "Up Next" channels from the extension: { source: UC…, recs: [{ id, name, handle }] }.
 * Adds 1 to every (source, rec) pair after decaying its weight; keeps names for display. Rows not
 * seen for 200 days (weight < 1 %) are dropped. → { ok, pairs }
 */
export function putCoRecs(store, { source, recs } = {}, now = Date.now()) {
  if (!flagsOf(store)['channel-similar']) return { ok: false, off: true };
  const pairs = D.coRecPairs(source, (Array.isArray(recs) ? recs : []).map((r) => ({ ownerId: r && r.id, ownerName: r && r.name, author: r && r.handle })));
  if (!pairs) return { ok: false, error: 'need a source channel and at least one other channel' };
  const get = store.db.prepare('SELECT weight, n, updated_at FROM co_recs WHERE a = ? AND b = ?');
  const put = store.db.prepare('INSERT OR REPLACE INTO co_recs (a, b, weight, n, updated_at) VALUES (?, ?, ?, ?, ?)');
  const seen = store.db.prepare(`INSERT INTO seen_channels (channel_id, name, handle, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(channel_id) DO UPDATE SET name = COALESCE(excluded.name, name), handle = COALESCE(excluded.handle, handle), updated_at = excluded.updated_at`);
  store.db.exec('BEGIN');
  try {
    for (const r of pairs.recs) {
      const cur = get.get(pairs.source, r.id);
      const w = (cur ? D.decayed(cur.weight, cur.updated_at, now) : 0) + 1;
      put.run(pairs.source, r.id, w, (cur ? cur.n : 0) + 1, now);
      if (r.name || r.handle) seen.run(r.id, r.name, r.handle, now);
    }
    store.db.prepare('DELETE FROM co_recs WHERE updated_at < ?').run(now - 200 * DAY);
    store.db.exec('COMMIT');
  } catch (e) { store.db.exec('ROLLBACK'); throw e; }
  return { ok: true, pairs: pairs.recs.length };
}

// ---- TF-IDF documents (6.4b) --------------------------------------------------------------------------
function channelDocs(store, lib) {
  const docs = {};
  const add = (uc, title, tags, desc) => {
    const d = docs[uc] || (docs[uc] = { titles: [], tags: [], descriptions: [] });
    if (d.titles.length >= 300) return;
    if (title) d.titles.push(title);
    if (tags && tags.length) d.tags.push(...tags.slice(0, 15));
    if (desc) d.descriptions.push(desc);
  };
  const seen = new Set();
  for (const v of store.db.prepare('SELECT video_id, channel_id, title, keywords, description FROM tracked_videos ORDER BY published_at DESC').all()) {
    seen.add(v.video_id);
    add(v.channel_id, v.title, parse(v.keywords, []), v.description);
  }
  for (const [uc, c] of libraryChannels(lib)) {
    for (const p of c.posts) if (!seen.has(p.code)) add(uc, p.caption || p.title, (p.keywords || []).concat(p.hashtags || []), p.description);
  }
  for (const v of store.db.prepare('SELECT video_id, channel_id, title FROM radar_videos').all()) if (!seen.has(v.video_id)) add(v.channel_id, v.title, [], null);
  return docs;
}

/** Everything similarity needs, computed once: vectors for every channel and all co-rec rows. */
function simContext(store, now, lib = store.readLibrary()) {
  const docs = channelDocs(store, lib);
  const counts = {};
  for (const id of Object.keys(docs)) counts[id] = D.termCounts(docs[id]);
  return { now, lib, vec: D.tfidf(counts), rows: store.db.prepare('SELECT a, b, weight, n, updated_at FROM co_recs').all(), idx: nameIndex(store, lib) };
}
function textNeighbors(ctx, id, limit = 30) {
  const me = ctx.vec[id];
  if (!me) return [];
  const out = [];
  for (const [k, v] of Object.entries(ctx.vec)) {
    if (k === id) continue;
    const s = D.cosine(me, v);
    if (s >= 0.05) out.push({ id: k, score: R(s, 3), terms: Object.keys(me).filter((t) => v[t] && !D.isFiller(t)).sort((a, b) => me[b] * v[b] - me[a] * v[a]).slice(0, 4) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
function neighbors(ctx, id, limit) {
  const co = D.coRecScores(ctx.rows, id, ctx.now, { limit: 30 });
  return D.combineSimilar(co, textNeighbors(ctx, id), { limit });
}

/**
 * similar_channels / the channel card's "Similar channels" row. → { ok, channel, similar: [{ id, name, score,
 * why: corec|text|both, co (decayed co-recommendations), seen, text (cosine), terms, tracked, saved, url }], basis }
 */
export function similarChannels(store, { channel, limit = 12, now = Date.now() } = {}) {
  const lib = store.readLibrary();
  const uc = resolveChannel(store, channel, lib);
  if (!uc) return { ok: false, error: `No channel matches "${channel}". Use a UC… id, yt/handle or @handle of a channel the Library or the tracker knows.` };
  const ctx = simContext(store, now, lib);
  const list = neighbors(ctx, uc, limit).map((x) => brief(ctx.idx, x.id, { score: x.score, why: x.why, co: x.co, seen: x.seen, text: x.text, terms: x.terms }));
  return {
    ok: true, channel: brief(ctx.idx, uc), similar: list,
    basis: { co_rec_pairs: ctx.rows.filter((r) => r.a === uc || r.b === uc).length, text_channels: Object.keys(ctx.vec).length, has_text: !!ctx.vec[uc] },
    note: 'co = co-recommendations ("Up Next" lists the extension saw on watch pages, decaying with a 30-day half-life); text = TF-IDF cosine over titles, tags and descriptions of tracked and saved videos. score mixes both (0.6 co + 0.4 text, each scaled to the best).'
  };
}

/**
 * The niche's "kanal haritası" as ranked lists: each tracked channel's closest neighbours, and the
 * channels you don't track that sit closest to the niche (co-recommended with its channels and/or
 * written like them). → { ok, niche, niches, channels: [{ …, neighbors }], outside: [{ …, links }] }
 */
export function channelMap(store, { niche, now = Date.now(), limit = 25 } = {}) {
  const { names, pick } = pickNiche(store, niche);
  const where = pick === null || pick === '' ? 'niche IS NULL' : 'niche = ?';
  const chans = store.db.prepare(`SELECT * FROM tracked_channels WHERE active = 1 AND ${where} ORDER BY mine DESC, name`).all(...(pick ? [pick] : []));
  const ctx = simContext(store, now);
  const inNiche = new Set(chans.map((c) => c.channel_id));
  const allTracked = new Set(store.db.prepare('SELECT channel_id FROM tracked_channels WHERE active = 1').all().map((r) => r.channel_id));
  const outside = new Map();
  const channels = chans.map((c) => {
    const nb = neighbors(ctx, c.channel_id, 30);
    for (const x of nb) {
      // A link counts when YouTube recommends them together, or their words are clearly alike.
      if (inNiche.has(x.id) || !(x.co || (x.text || 0) >= 0.3)) continue;
      const e = outside.get(x.id) || { id: x.id, score: 0, co: 0, seen: 0, text: 0, links: [], terms: [] };
      e.score += x.score;
      e.co += x.co || 0;
      e.seen += x.seen || 0;
      e.text = Math.max(e.text, x.text || 0);
      e.links.push(c.name || c.handle || c.channel_id);
      for (const t of x.terms || []) if (!e.terms.includes(t) && e.terms.length < 5) e.terms.push(t);
      outside.set(x.id, e);
    }
    return brief(ctx.idx, c.channel_id, { neighbors: nb.slice(0, 4).map((x) => brief(ctx.idx, x.id, { score: x.score, why: x.why })) });
  });
  const out = [...outside.values()].map((e) => brief(ctx.idx, e.id, { score: R(e.score, 3), co: R(e.co, 2), seen: e.seen, text: R(e.text, 3), links: e.links.slice(0, 6), link_count: e.links.length, terms: e.terms,
    why: e.co && e.text ? 'both' : e.co ? 'corec' : 'text', tracked: allTracked.has(e.id) }))
    .sort((a, b) => b.score - a.score || b.link_count - a.link_count).slice(0, limit);
  return { ok: true, now, niche: pick, niches: names, channels, outside: out, basis: { co_rec_pairs: ctx.rows.length, text_channels: Object.keys(ctx.vec).length }, feature: !!flagsOf(store)['channel-similar'] };
}

// ---- similar thumbnails (6.4b) ------------------------------------------------------------------------
function thumbCandidates(store, lib) {
  const meta = new Map(); // video id → { id, title, channel, channel_id, thumb, views, type, published_at }
  for (const [uc, c] of libraryChannels(lib)) {
    for (const p of c.posts) if (VIDEO_ID_RE.test(String(p.code || ''))) meta.set(p.code, { id: p.code, title: p.caption || null, channel: c.name, channel_id: uc, thumb: p.thumb || null, views: p.views ?? null, type: p.type || 'video', published_at: p.takenAt || null, saved: true });
  }
  const tv = store.db.prepare('SELECT video_id, channel_id, title, thumb, type, published_at, thumb_hash FROM tracked_videos').all();
  const names = new Map(store.db.prepare('SELECT channel_id, name, handle FROM tracked_channels').all().map((c) => [c.channel_id, c.name || c.handle]));
  for (const v of tv) {
    const e = meta.get(v.video_id) || { id: v.video_id, views: null };
    Object.assign(e, { title: e.title || v.title, channel: e.channel || names.get(v.channel_id) || null, channel_id: v.channel_id, thumb: e.thumb || v.thumb, type: v.type || e.type, published_at: v.published_at || e.published_at, hash: v.thumb_hash && /^d:/.test(v.thumb_hash) ? v.thumb_hash : null });
    meta.set(v.video_id, e);
  }
  const seenNames = new Map(store.db.prepare('SELECT channel_id, name FROM seen_channels').all().map((c) => [c.channel_id, c.name]));
  for (const v of store.db.prepare('SELECT video_id, channel_id, title, thumb, type, views, published_at FROM radar_videos').all()) {
    if (!meta.has(v.video_id)) meta.set(v.video_id, { id: v.video_id, title: v.title, channel: seenNames.get(v.channel_id) || null, channel_id: v.channel_id, thumb: v.thumb, type: v.type, views: v.views, published_at: v.published_at });
  }
  for (const h of store.db.prepare('SELECT video_id, hash FROM thumb_hashes WHERE hash IS NOT NULL').all()) {
    const e = meta.get(h.video_id);
    if (e && !e.hash && /^d:/.test(h.hash)) e.hash = h.hash;
  }
  return meta;
}
function thumbUrl(e) { return e.thumb && /^https:\/\/i[0-9]?\.ytimg\.com\//.test(e.thumb) ? e.thumb : 'https://i.ytimg.com/vi/' + e.id + '/mqdefault.jpg'; }

/** Background: hash up to THUMB_BATCH thumbnails that have none yet (Library videos first, newest first). */
async function thumbIndexJob(ctx) {
  const store = ctx.store;
  const meta = thumbCandidates(store, store.readLibrary());
  const tried = new Set(store.db.prepare('SELECT video_id FROM thumb_hashes WHERE hash IS NOT NULL OR at > ?').all(ctx.now - 7 * DAY).map((r) => r.video_id));
  const todo = [...meta.values()].filter((e) => !e.hash && !tried.has(e.id)).sort((a, b) => (b.saved ? 1 : 0) - (a.saved ? 1 : 0) || (b.published_at || 0) - (a.published_at || 0)).slice(0, ctx.thumbBatch || THUMB_BATCH);
  const put = store.db.prepare('INSERT OR REPLACE INTO thumb_hashes (video_id, hash, at) VALUES (?, ?, ?)');
  let done = 0;
  for (const e of todo) {
    let hash = null;
    try { const r = await thumbAndSnap(thumbUrl(e), { fetch: ctx.fetch, tools: ctx.thumbTools || {} }); hash = r && r.hash; } catch { /* next time */ }
    put.run(e.id, hash && /^d:/.test(hash) ? hash : null, ctx.now);
    if (hash) done++;
  }
  return { data: { hashed: done, tried: todo.length, left: [...meta.values()].filter((e) => !e.hash).length - done } };
}

/**
 * Library videos whose thumbnails look like this one's (dHash distance ≤ maxDist of 64 bits).
 * The target is hashed on the spot when it has no hash yet (one i.ytimg.com request).
 * → { ok, video, similar: [{ id, title, channel, thumb, url, views, distance }], indexed, pending }
 */
export async function similarThumbs(store, { video, limit = 24, maxDist = THUMB_MAX_DIST, fetch: doFetch = globalThis.fetch, thumbTools, now = Date.now() } = {}) {
  const ref = String(video || '').trim();
  const m = /(?:v=|\/shorts\/|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(ref);
  const id = m ? m[1] : VIDEO_ID_RE.test(ref) ? ref : null;
  if (!id) return { ok: false, error: 'Not a YouTube video id.' };
  const meta = thumbCandidates(store, store.readLibrary());
  let me = meta.get(id) || { id, title: null, channel: null };
  if (!me.hash) {
    try {
      const r = await thumbAndSnap(thumbUrl(me), { fetch: doFetch, tools: thumbTools || {} });
      if (r && /^d:/.test(r.hash)) { me.hash = r.hash; store.db.prepare('INSERT OR REPLACE INTO thumb_hashes (video_id, hash, at) VALUES (?, ?, ?)').run(id, r.hash, now); }
    } catch { /* no hash */ }
  }
  const all = [...meta.values()];
  const indexed = all.filter((e) => e.hash).length;
  const pending = all.length - indexed;
  const out = { ok: true, video: { id, title: me.title || null, channel: me.channel || null, thumb: thumbUrl(me), url: ytUrl(id, me.type), hashed: !!me.hash }, indexed, pending, max_distance: maxDist };
  if (!me.hash) return { ...out, similar: [], note: 'This thumbnail could not be hashed (no ffmpeg or sips on this Mac, or the image did not load).' };
  const a = me.hash.slice(2);
  out.similar = all.filter((e) => e.id !== id && e.hash).map((e) => ({ e, d: hamming(a, e.hash.slice(2)) })).filter((x) => x.d <= maxDist)
    .sort((x, y) => x.d - y.d || (y.e.views || 0) - (x.e.views || 0)).slice(0, limit)
    .map(({ e, d }) => ({ id: e.id, title: e.title, channel: e.channel, channel_id: e.channel_id, thumb: thumbUrl(e), url: ytUrl(e.id, e.type), views: e.views, type: e.type, published_at: e.published_at, distance: d, same_channel: !!(e.channel_id && e.channel_id === me.channel_id) }));
  return out;
}

// ---- niche radar (6.5) ----------------------------------------------------------------------------------
function videoType(r) { return r.type === 'live' ? 'live' : r.duration && (r.duration <= 60 || (r.duration <= 180 && /#shorts/i.test((r.caption || '') + ' ' + (r.description || '')))) ? 'short' : 'video'; }

/** The daily job: every niche with keywords, while the shared budget allows. */
async function radarJob(ctx) {
  const store = ctx.store;
  const s = radarSettings(store);
  const niches = Object.keys(s.keywords).filter((n) => s.keywords[n].length);
  if (!niches.length) return { data: { idle: 'no keywords' } };
  const client = A.client({ key: ctx.apiKey, fetch: ctx.fetch, onUnits: (n) => ctx.quota.spend(n) });
  const after = new Date(ctx.now - 7 * DAY).toISOString();
  const perKw = D.radarCost(1, { perKeyword: s.perKeyword }).total;
  const upV = store.db.prepare(`INSERT INTO radar_videos (video_id, channel_id, niche, keywords, title, thumb, type, published_at, views, likes, comments, duration, first_seen, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(video_id) DO UPDATE SET niche = excluded.niche, keywords = excluded.keywords, title = excluded.title, thumb = COALESCE(excluded.thumb, thumb), type = excluded.type,
      views = excluded.views, likes = excluded.likes, comments = excluded.comments, duration = COALESCE(excluded.duration, duration), updated_at = excluded.updated_at`);
  const kwOf = store.db.prepare('SELECT keywords FROM radar_videos WHERE video_id = ?');
  const upC = store.db.prepare(`INSERT INTO seen_channels (channel_id, name, handle, thumb, subs, views_total, videos, created, stats_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(channel_id) DO UPDATE SET name = COALESCE(excluded.name, name), handle = COALESCE(excluded.handle, handle), thumb = COALESCE(excluded.thumb, thumb), subs = excluded.subs,
      views_total = excluded.views_total, videos = excluded.videos, created = COALESCE(excluded.created, created), stats_at = excluded.stats_at, updated_at = excluded.updated_at`);
  const runs = [];
  let stop = null;
  for (const niche of niches) {
    const found = new Map(); // video id → [keywords]
    const ran = [];
    const skipped = [];
    let units = 0;
    let error = null;
    for (const kw of s.keywords[niche]) {
      if (stop || !ctx.quota.canSpend(perKw + RADAR_RESERVE)) { skipped.push(kw); continue; }
      try {
        const body = await client.get('search', { part: 'snippet', type: 'video', order: 'viewCount', publishedAfter: after, maxResults: s.perKeyword, q: kw, regionCode: s.region, relevanceLanguage: s.lang });
        ctx.quota.spend(D.SEARCH_UNITS - 1); // the client counted 1; search.list costs 100
        units += D.SEARCH_UNITS;
        ran.push(kw);
        for (const it of body.items || []) {
          const id = it && it.id && it.id.videoId;
          if (VIDEO_ID_RE.test(String(id || ''))) found.set(id, (found.get(id) || []).concat(kw));
        }
      } catch (e) {
        if (e.code !== 'network') { ctx.quota.spend(D.SEARCH_UNITS - 1); units += D.SEARCH_UNITS; }
        error = e.message;
        if (e.code === 'quota' || e.code === 'bad_key' || e.code === 'api_disabled') { stop = e.message; skipped.push(kw); }
      }
    }
    const ids = [...found.keys()];
    const chans = new Set();
    if (ids.length) {
      const items = await client.videos(ids);
      units += Math.ceil(ids.length / 50);
      store.db.exec('BEGIN');
      try {
        for (const it of items) {
          const r = A.videoRecord(it, { now: ctx.now });
          if (!r || !r.ownerId) continue;
          chans.add(r.ownerId);
          const prev = parse(kwOf.get(r.code)?.keywords, []);
          const kws = [...new Set(prev.concat(found.get(r.code) || []))].slice(0, 10);
          upV.run(r.code, r.ownerId, niche, JSON.stringify(kws), r.caption || null, r.thumb || null, videoType(r), r.takenAt || null, r.views ?? null, r.likes ?? null, r.comments ?? null, r.duration || null, ctx.now, ctx.now);
        }
        store.db.exec('COMMIT');
      } catch (e) { store.db.exec('ROLLBACK'); throw e; }
      const list = [...chans];
      for (let i = 0; i < list.length; i += 50) {
        const infos = await client.channels(list.slice(i, i + 50));
        units += 1;
        for (const c of infos) upC.run(c.channelId, c.name, c.handle, c.avatar, c.subscribers, c.views, c.videos, c.publishedAt, ctx.now, ctx.now);
      }
    }
    store.db.prepare('INSERT INTO radar_runs (at, niche, keywords, skipped, units, videos, error) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(ctx.now, niche, JSON.stringify(ran), JSON.stringify(skipped), units, ids.length, error);
    runs.push({ niche, ran: ran.length, skipped: skipped.length, units, videos: ids.length, error });
  }
  store.db.prepare('DELETE FROM radar_videos WHERE updated_at < ?').run(ctx.now - 60 * DAY);
  store.db.prepare('DELETE FROM radar_runs WHERE at < ?').run(ctx.now - 90 * DAY);
  return { data: { runs, stopped: stop } };
}

// ---- niche sample (the radar's denominator) ------------------------------------------------------------
export const SAMPLE_MEASURE_DAYS = 31;   // measured daily until a video is this old
/** The sample's search terms for a niche: the saved ones, else the niche's prefix ("excel"). */
function sampleTermsOf(store, s, niche, now) {
  if (s.sampleTerms[niche || '']) return s.sampleTerms[niche || ''];
  if (!niche) return []; // channels tracked outside a niche: only with terms set for them (they'd repeat the niche's search)
  let sig = { titles: [], texts: [] };
  try { sig = nicheSignals(store, { niche: niche ?? '', now }); } catch { /* nothing tracked */ }
  const prefix = D.nichePrefix(sig.texts || sig.titles);
  return prefix ? [prefix] : [];
}
/** Units of one daily run: one search.list per term, then videos.list / channels.list for everything still measured. */
export function sampleCost(store, { terms = 1, now = Date.now() } = {}) {
  const active = store.db.prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT channel_id) AS c FROM sample_videos WHERE done_at IS NULL AND published_at >= ?').get(now - SAMPLE_MEASURE_DAYS * DAY);
  const s = radarSettings(store);
  terms *= s.sampleDurations.length; // one search per term and length
  const steady = SAMPLE_MEASURE_DAYS * s.samplePerTerm * terms; // a month in: every day's finds still measured
  return {
    search: terms * D.SEARCH_UNITS,
    measure_now: Math.ceil((active.n + s.samplePerTerm * terms) / 50) + Math.ceil((active.c + s.samplePerTerm * terms) / 50),
    measure_steady: Math.ceil(steady / 50) * 2,
    total_steady: terms * D.SEARCH_UNITS + Math.ceil(steady / 50) * 2
  };
}

/**
 * The daily job, per tracked niche: 1) search.list order=date for uploads of the last 24 h, once per
 * term and length (videoDuration medium / long by default; the
 * newest, not the most viewed, so videos that go nowhere are in it), 2) videos.list for every
 * sampled video under 31 days old (50 per unit), 3) channels.list for their channels (subscribers
 * when found, and now). Measuring comes first: a day without new finds is fine, a gap in a curve isn't.
 */
async function sampleJob(ctx) {
  const store = ctx.store;
  const s = radarSettings(store);
  const niches = nicheNames(store).map((n) => n.name);
  if (!niches.length) return { data: { idle: 'no tracked niche' } };
  const client = A.client({ key: ctx.apiKey, fetch: ctx.fetch, onUnits: (n) => ctx.quota.spend(n) });
  const now = ctx.now;
  const insV = store.db.prepare(`INSERT OR IGNORE INTO sample_videos (video_id, channel_id, niche, term, search, title, published_at, found_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const setLang = store.db.prepare('UPDATE sample_videos SET lang = ? WHERE video_id = ? AND lang IS NULL');
  const insS = store.db.prepare('INSERT OR REPLACE INTO sample_stats (video_id, ts, views, likes, comments) VALUES (?, ?, ?, ?, ?)');
  const setMeta = store.db.prepare('UPDATE sample_videos SET title = COALESCE(?, title), type = ?, duration = COALESCE(?, duration), published_at = COALESCE(?, published_at) WHERE video_id = ?');
  const done = store.db.prepare('UPDATE sample_videos SET done_at = ? WHERE video_id = ?');
  const upC = store.db.prepare(`INSERT INTO sample_channels (channel_id, name, handle, created, first_seen, subs_first, videos_first, subs_last, videos_last, last_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(channel_id) DO UPDATE SET name = COALESCE(excluded.name, name), handle = COALESCE(excluded.handle, handle), created = COALESCE(created, excluded.created),
      subs_last = excluded.subs_last, videos_last = excluded.videos_last, last_at = excluded.last_at`);
  const subsFound = store.db.prepare('UPDATE sample_videos SET subs_found = ? WHERE channel_id = ? AND subs_found IS NULL AND found_at >= ?');
  const runs = [];
  let stop = null;
  for (const niche of niches) {
    const terms = sampleTermsOf(store, s, niche, now);
    let units = 0;
    let found = 0;
    let error = null;
    // 1) the newest uploads
    for (const [term, dur] of terms.flatMap((t) => s.sampleDurations.map((d) => [t, d]))) {
      if (stop || !ctx.quota.canSpend(D.SEARCH_UNITS + RADAR_RESERVE)) break;
      try {
        const params = { part: 'snippet', type: 'video', order: 'date', publishedAfter: new Date(now - DAY).toISOString(), maxResults: s.samplePerTerm, q: term, regionCode: s.region, relevanceLanguage: s.lang };
        if (dur !== 'any') params.videoDuration = dur;
        const body = await client.get('search', params);
        ctx.quota.spend(D.SEARCH_UNITS - 1); // the client counted 1; search.list costs 100
        units += D.SEARCH_UNITS;
        for (const it of body.items || []) {
          const id = it && it.id && it.id.videoId;
          const sn = (it && it.snippet) || {};
          if (!VIDEO_ID_RE.test(String(id || '')) || !CHANNEL_ID_RE.test(String(sn.channelId || ''))) continue;
          const pub = Date.parse(sn.publishedAt || '');
          found += Number(insV.run(id, sn.channelId, niche, term, dur, typeof sn.title === 'string' ? sn.title.slice(0, 300) : null, Number.isFinite(pub) ? pub : null, now).changes);
        }
      } catch (e) {
        if (e.code !== 'network') { ctx.quota.spend(D.SEARCH_UNITS - 1); units += D.SEARCH_UNITS; }
        error = e.message;
        if (e.code === 'quota' || e.code === 'bad_key' || e.code === 'api_disabled') stop = e.message;
      }
    }
    // 2) measure everything still young
    const active = store.db.prepare('SELECT video_id, channel_id, published_at FROM sample_videos WHERE niche IS ? AND done_at IS NULL').all(niche);
    const ids = active.map((v) => v.video_id);
    let measured = 0;
    if (ids.length && !stop) {
      const items = await client.videos(ids);
      units += Math.ceil(ids.length / 50);
      const seen = new Set();
      store.db.exec('BEGIN');
      try {
        for (const it of items) {
          const r = A.videoRecord(it, { now });
          if (!r || !r.code) continue;
          seen.add(r.code);
          insS.run(r.code, now, r.views ?? null, r.likes ?? null, r.comments ?? null);
          setMeta.run(r.caption || null, videoType(r), r.duration || null, r.takenAt || null, r.code);
          // The audio language (YouTube detects it); the title language (defaultLanguage) is often 'en' on Hindi videos.
          const lang = it && it.snippet && typeof it.snippet.defaultAudioLanguage === 'string' ? it.snippet.defaultAudioLanguage.slice(0, 12) : null;
          if (lang) setLang.run(lang, r.code);
          measured++;
        }
        for (const v of active) {
          const pub = v.published_at || now;
          if (!seen.has(v.video_id) || now - pub >= SAMPLE_MEASURE_DAYS * DAY) done.run(now, v.video_id); // deleted / private, or old enough
        }
        store.db.exec('COMMIT');
      } catch (e) { store.db.exec('ROLLBACK'); throw e; }
      // 3) their channels
      const chans = [...new Set(active.map((v) => v.channel_id))];
      for (let i = 0; i < chans.length; i += 50) {
        const infos = await client.channels(chans.slice(i, i + 50));
        units += 1;
        for (const c of infos) {
          upC.run(c.channelId, c.name || null, c.handle || null, c.publishedAt || null, now, c.subscribers ?? null, c.videos ?? null, c.subscribers ?? null, c.videos ?? null, now);
          if (c.subscribers != null) subsFound.run(c.subscribers, c.channelId, now - 2 * DAY);
        }
      }
    }
    store.db.prepare('INSERT INTO sample_runs (at, niche, terms, found, measured, units, error) VALUES (?, ?, ?, ?, ?, ?, ?)').run(now, niche, JSON.stringify(terms), found, measured, units, error);
    runs.push({ niche, terms, durations: s.sampleDurations, found, measured, units, error });
  }
  store.db.prepare('DELETE FROM sample_runs WHERE at < ?').run(now - 180 * DAY);
  return { data: { runs, stopped: stop } };
}

/**
 * The sample's answer for one niche (niche_sample). lang: an audio language to keep ('en' keeps en,
 * en-US, en-IN …; default the radar's language; 'all' keeps every video, unknown included).
 * searches: which searches count (default the current lengths; videos found by an older setting are
 * reported, not mixed in).
 */
export function samplePage(store, { niche, now = Date.now(), top = 10, lang, searches } = {}) {
  const { names, pick } = pickNiche(store, niche);
  const s = radarSettings(store);
  const flags = flagsOf(store);
  const terms = sampleTermsOf(store, s, pick, now);
  const want = String(lang || s.lang).toLowerCase();
  const keepSearch = Array.isArray(searches) && searches.length ? searches : s.sampleDurations;
  const all = store.db.prepare('SELECT video_id, channel_id, title, type, published_at, subs_found, found_at, search, lang FROM sample_videos WHERE niche IS ?').all(pick);
  const langs = {};
  for (const v of all) { const k = v.lang ? v.lang.split('-')[0].toLowerCase() : 'unknown'; langs[k] = (langs[k] || 0) + 1; }
  const inSearch = all.filter((v) => keepSearch.includes(v.search || 'any'));
  const videos = want === 'all' ? inSearch : inSearch.filter((v) => v.lang && v.lang.split('-')[0].toLowerCase() === want);
  const filter = {
    lang: want, searches: keepSearch, kept: videos.length, total: all.length,
    other_searches: all.length - inSearch.length, other_lang: inSearch.length - videos.length - (want === 'all' ? 0 : inSearch.filter((v) => !v.lang).length),
    lang_unknown: want === 'all' ? 0 : inSearch.filter((v) => !v.lang).length,
    languages: Object.entries(langs).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => ({ lang: k, videos: n }))
  };
  const stats = {};
  if (videos.length) {
    for (const r of store.db.prepare('SELECT s.video_id, s.ts, s.views FROM sample_stats s JOIN sample_videos v ON v.video_id = s.video_id WHERE v.niche IS ? ORDER BY s.video_id, s.ts').iterate(pick)) {
      (stats[r.video_id] ||= []).push({ ts: r.ts, views: r.views });
    }
  }
  const keepIds = new Set(videos.map((v) => v.video_id));
  for (const k of Object.keys(stats)) if (!keepIds.has(k)) delete stats[k];
  const channels = {};
  for (const c of store.db.prepare('SELECT * FROM sample_channels WHERE channel_id IN (SELECT DISTINCT channel_id FROM sample_videos WHERE niche IS ?)').all(pick)) channels[c.channel_id] = c;
  const summary = D.sampleSummary(videos, stats, channels, { now, top });
  const runs = store.db.prepare('SELECT at, terms, found, measured, units, error FROM sample_runs WHERE niche IS ? ORDER BY at DESC LIMIT 7').all(pick).map((r) => ({ ...r, terms: parse(r.terms, []) }));
  const first = all.reduce((m, v) => Math.min(m, v.found_at), Infinity);
  return {
    ok: true, now, niche: pick, niches: names, feature: !!flags['niche-sample'], api_key: !!apiKeyInfo().key, terms,
    per_term: s.samplePerTerm, durations: s.sampleDurations, region: s.region, filter, cost: sampleCost(store, { terms: terms.length || 1, now }),
    collecting_since: Number.isFinite(first) ? first : null, days_collecting: Number.isFinite(first) ? Math.floor((now - first) / DAY) : 0,
    ...summary, runs,
    how_to_read: 'Every video is a recent upload found by search.list order=date (the newest, not the most viewed), once per length (videoDuration: medium = 4–20 min, long = over 20 min), measured daily for 30 days. filter says which videos count: the audio language YouTube detected (lang; \'all\' for every language) and the searches of the current setting. at[1|7|30] = views at that age (only videos old enough); share_at_least = share of those videos at or above 100 / 1K / 10K / 100K views. by_subs buckets use the channel\'s subscribers when the video was found. channels_hit_10k_by_30d = share of channels with at least one sampled video at 10K+ by day 30 (judged = channels with a 30-day value). new_channels = channels created within a year before they were found. sub_growth_30d = median subscriber change of channels watched ≥ 25 days, split by whether they had such a hit. Limits: YouTube search still filters and orders by relevance inside "newest", region/language settings apply, and only one or a few terms are sampled; the 30-day numbers need about 5 weeks of collecting.'
  };
}

/** "Run now": the radar job's next run moves to the next tracker tick. */
export function radarRunNow(store, now = Date.now()) {
  upsertJob(store, 'radar', { kind: 'radar' }, now);
  store.db.prepare("UPDATE tracker_jobs SET fails = 0 WHERE id = 'radar'").run();
  return { ok: true, at: now };
}

function ownSearchTerms(store, niche) {
  const own = ownChannels(store).map((c) => c.channel_id);
  if (!own.length) return { connected: false, terms: [] };
  const inNiche = store.db.prepare('SELECT channel_id FROM tracked_channels WHERE mine = 1 AND active = 1 AND ' + (niche ? 'niche = ?' : 'niche IS NULL')).all(...(niche ? [niche] : [])).map((r) => r.channel_id).filter((c) => own.includes(c));
  try { return { connected: true, terms: searchTerms(store, inNiche.length ? inNiche : own, { limit: 50 }).terms }; } catch { return { connected: true, terms: [] }; }
}

/** The Radar tab's one answer. */
export function radarPage(store, { niche, now = Date.now() } = {}) {
  const { names, pick } = pickNiche(store, niche);
  const s = radarSettings(store);
  const kw = s.keywords[pick || ''] || [];
  const flags = flagsOf(store);
  const q = quotaOf(store, now);
  const rows = store.db.prepare('SELECT * FROM radar_videos WHERE ' + (pick ? 'niche = ?' : '(niche IS NULL OR niche = \'\')') + ' AND published_at >= ?').all(...(pick ? [pick] : []), now - 7 * DAY)
    .map((r) => ({ ...r, keywords: parse(r.keywords, []), url: ytUrl(r.video_id, r.type) }));
  const chans = {};
  for (const c of store.db.prepare('SELECT * FROM seen_channels').all()) chans[c.channel_id] = { title: c.name, handle: c.handle, subs: c.subs, thumb: c.thumb, created: c.created };
  const tracked = {};
  for (const r of store.db.prepare('SELECT channel_id FROM tracked_channels WHERE active = 1').all()) tracked[r.channel_id] = true;
  const lists = D.radarLists(rows, chans, tracked, { ...s, now });
  const runs = store.db.prepare('SELECT * FROM radar_runs WHERE ' + (pick ? 'niche = ?' : '(niche IS NULL OR niche = \'\')') + ' ORDER BY at DESC LIMIT 7').all(...(pick ? [pick] : []))
    .map((r) => ({ at: r.at, keywords: parse(r.keywords, []), skipped: parse(r.skipped, []), units: r.units, videos: r.videos, error: r.error }));
  const job = store.db.prepare("SELECT next_at, last_run_at, last_error FROM tracker_jobs WHERE id = 'radar'").get();
  let sig = { titleWords: [], gaps: [], titles: [], texts: [] };
  try { sig = nicheSignals(store, { niche: pick ?? '', now }); } catch { /* no tracked channels */ }
  const own = ownSearchTerms(store, pick);
  const allKw = Object.values(s.keywords).reduce((n, l) => n + l.length, 0);
  return {
    ok: true, now, niche: pick, niches: names, feature: !!flags['niche-radar'], api_key: !!apiKeyInfo().key,
    keywords: kw, settings: { ...s, keywords: undefined }, all_keywords: s.keywords,
    cost: D.radarCost(kw.length, { perKeyword: s.perKeyword }), cost_all: D.radarCost(allKw, { perKeyword: s.perKeyword }),
    quota: { used_today: q.used_today, budget: BUDGET, limit: 10000, reserve: RADAR_RESERVE, remaining: Math.max(0, BUDGET - q.used_today) },
    runs, next_run_at: job ? job.next_at : null, last_error: job ? job.last_error : null,
    breakouts: lists.breakouts.slice(0, 30), rising: lists.rising.slice(0, 20), results: rows.length,
    suggestions: D.suggestKeywords({ titleWords: sig.titleWords, searchTerms: own.terms, gaps: sig.gaps, existing: kw }, { prefix: D.nichePrefix(sig.texts || sig.titles) }),
    own_terms: own.connected
  };
}

// ---- keyword ideas (6.6) ---------------------------------------------------------------------------------
// Google's autocomplete is unofficial: at most 10 requests in 10 s from this bridge, one at a time, and
// every answer is cached for 7 days per (query, hl, gl).
export const suggestLimiter = I.limiter({ max: 10, windowMs: 10_000 });

/** One autocomplete query (cached). → { q, suggestions, cached, error } */
export async function autocomplete(store, q, { hl = 'en', gl = 'US', fetch: doFetch = globalThis.fetch, now = Date.now(), limiter = suggestLimiter } = {}) {
  q = String(q || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!q) return { q, suggestions: [], cached: false };
  const hit = store.db.prepare('SELECT suggestions, fetched_at FROM keyword_cache WHERE q = ? AND hl = ? AND gl = ?').get(q, hl, gl);
  if (hit && now - hit.fetched_at < SUGGEST_TTL) return { q, suggestions: parse(hit.suggestions, []), cached: true };
  try {
    const list = await limiter.run(async () => {
      const res = await doFetch(D.suggestUrl(q, { hl, gl }), { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return D.parseSuggest(await res.text());
    });
    store.db.prepare('INSERT OR REPLACE INTO keyword_cache (q, hl, gl, suggestions, fetched_at) VALUES (?, ?, ?, ?, ?)').run(q, hl, gl, JSON.stringify(list), now);
    return { q, suggestions: list, cached: false };
  } catch (e) {
    if (hit) return { q, suggestions: parse(hit.suggestions, []), cached: true, stale: true };
    return { q, suggestions: [], cached: false, error: e.message };
  }
}

/**
 * The Keywords tab / keyword_ideas. seeds: default the radar's keywords for the niche, the niche's
 * prefix ("excel") and its fastest title words as phrases; expand: one seed to widen with "seed a" … "seed z".
 * → { ok, niche, hl, gl, seeds, ideas, own_terms, prompt, ranks, … }
 */
export async function keywordIdeas(store, { niche, seeds, expand, hl, gl, autocomplete: useAc = true, limit = 120, fetch: doFetch = globalThis.fetch, now = Date.now(), limiter, lang } = {}) {
  const { names, pick } = pickNiche(store, niche);
  const s = radarSettings(store);
  hl = /^[a-z]{2}$/.test(String(hl || '')) ? hl : s.lang;
  gl = /^[A-Z]{2}$/.test(String(gl || '')) ? gl : s.region;
  const flags = flagsOf(store);
  let sig = { titleWords: [], gaps: [], titles: [], texts: [] };
  try { sig = nicheSignals(store, { niche: pick ?? '', now }); } catch { /* nothing tracked */ }
  const prefix = D.nichePrefix(sig.texts || sig.titles);
  const radar = s.keywords[pick || ''] || [];
  const own = ownSearchTerms(store, pick);
  let list = Array.isArray(seeds) && seeds.length ? seeds : [prefix].concat(radar.slice(0, 5), sig.titleWords.slice(0, 3).map((w) => (prefix && w.word !== prefix ? prefix + ' ' + w.word : w.word)));
  list = [...new Set(list.filter(Boolean).map((x) => String(x).toLowerCase().trim()).filter((x) => x.length >= 2))].slice(0, 10);
  const suggestions = {};
  const errors = [];
  let fetched = 0;
  let cached = 0;
  const on = useAc && flags['keyword-ideas'] !== false;
  if (on) {
    const queries = list.slice();
    if (expand) for (const e of D.expansions(String(expand).toLowerCase().trim())) queries.push(e);
    for (const qq of queries) {
      const r = await autocomplete(store, qq, { hl, gl, fetch: doFetch, now, limiter });
      if (r.error) errors.push(r.q + ': ' + r.error);
      else if (r.cached) cached++; else fetched++;
      const seed = list.includes(qq) ? qq : String(expand).toLowerCase().trim();
      suggestions[seed] = [...new Set((suggestions[seed] || []).concat(r.suggestions))];
    }
  }
  const ideas = D.keywordIdeas({ suggestions, titleWords: sig.titleWords, ownTerms: own.terms, gaps: sig.gaps, prefix, radar }, { limit });
  let ranks = {};
  try { ranks = DFS.latestRanks(store); } catch { /* none */ }
  for (const i of ideas) if (ranks[i.keyword]) i.serp = ranks[i.keyword];
  const ask = ideas.filter((i) => !i.ranks).slice(0, 10).map((i) => i.keyword);
  return {
    ok: true, now, niche: pick, niches: names, hl, gl, seeds: list, prefix, expand: expand || null, autocomplete: on, feature: flags['keyword-ideas'] !== false,
    ideas, own_terms: own.terms.length, own_connected: own.connected, title_words: sig.titleWords.length, gaps: sig.gaps.length,
    fetched, cached, errors: errors.slice(0, 5), radar_keywords: radar, rank_keywords: s.rankKeywords, ranks,
    prompt: { en: D.volumePrompt(ask, { niche: pick, hl, gl, lang: 'en' }), tr: D.volumePrompt(ask, { niche: pick, hl, gl, lang: 'tr' }) }[lang === 'tr' ? 'tr' : 'en'],
    prompt_keywords: ask
  };
}

// ---- optional provider jobs --------------------------------------------------------------------------------
async function serpJob(ctx) {
  const s = radarSettings(ctx.store);
  if (!s.rankKeywords.length || !PROV.ready(ctx.store, 'dataforseo')) return { data: { idle: true } };
  const r = await DFS.checkRanks(ctx.store, { keywords: s.rankKeywords, region: s.region, lang: s.lang, fetch: ctx.fetch, now: ctx.now, on: true, home: ctx.providersHome });
  if (!r.ok) throw new Error(r.error);
  return { data: { checked: r.checked.length, cost: r.cost } };
}

/** Tracker job kinds (mcp/tracker.mjs): the radar, the thumbnail index and the optional rank check. */
export const DISCOVERY_KINDS = {
  radar: { singleton: true, feature: 'niche-radar', every: DAY, jitter: 30 * MIN, units: D.SEARCH_UNITS + 2, run: radarJob },
  sample: { singleton: true, feature: 'niche-sample', every: DAY, jitter: 30 * MIN, units: D.SEARCH_UNITS + 2, run: sampleJob },
  'thumb-index': { singleton: true, feature: 'channel-similar', every: 20 * MIN, jitter: 2 * MIN, units: 0, run: thumbIndexJob },
  'serp-ranks': { singleton: true, feature: 'provider-dataforseo', every: DAY, jitter: 30 * MIN, units: 0, run: serpJob }
};

// ---- MCP ---------------------------------------------------------------------------------------------------
export const INSTRUCTIONS = 'Discovery (YouTube, phase 5): similar_channels ranks channels like a given one by co-recommendations (the "Up Next" lists the extension saw, decaying) and TF-IDF over titles, tags and descriptions; keyword_ideas merges YouTube autocomplete (free, unofficial, rate-limited) with the niche\'s fast title words, topic gaps and the user\'s own search terms (ranks = viewers already find the user with it); niche_radar shows this week\'s small-channel breakouts and rising channels the user doesn\'t track (from the optional daily search.list radar, 100 units per keyword); the radar searches by view count, so it only sees winners: for base rates (what a typical new upload gets, how often a small channel breaks out) use niche_sample, the newest uploads measured for 30 days. ' +
  'Third-party connectors, if the user connected them in Claude, are for what OpenOutlier cannot know, and their free limits are small: NexLev MCP (about 50 calls a week) for channels outside the Library (similar-channel and niche overviews, monetization and RPM estimates, faceless checks); vidIQ MCP (about 30 calls a month) for YouTube search volume and competition of keywords. Use OpenOutlier\'s own tools first, then at most a few connector calls per question (batch keywords in one vidIQ call where possible), never repeat a lookup already done this week/month, and say when a limit is reached instead of guessing.';

export function registerDiscoveryTools(server, { z, json, safe, store }) {
  const niche = z.string().optional().describe('Niche name (the folder or "#tag" marked as a tracked niche); default: the one with the user\'s channel');
  server.registerTool('similar_channels', {
    title: 'Similar YouTube channels',
    description: 'Channels similar to one YouTube channel, from OpenOutlier\'s own data: co-recommendations (which channels YouTube\'s "Up Next" list showed next to this channel\'s videos when the user watched them; aggregated counts that decay with a 30-day half-life) and text similarity (TF-IDF over the titles, tags and descriptions of tracked and saved videos). Each result says why (corec / text / both), whether it is tracked or saved, and the shared terms. For channels the Library has never seen, NexLev\'s MCP (if connected) can help, sparingly.',
    inputSchema: { channel: z.string().describe('UC… id, yt/handle, @handle or channel name'), limit: z.number().int().min(1).max(50).optional() },
    annotations: { readOnlyHint: true }
  }, (args) => safe(() => json(similarChannels(store(), args))));
  server.registerTool('keyword_ideas', {
    title: 'YouTube keyword ideas',
    description: 'Keyword ideas for a tracked niche: YouTube\'s autocomplete (through this computer, rate-limited, cached 7 days; hl/gl choose language and country) merged with the niche\'s fastest title words, topic gaps and the user\'s own YouTube search terms (ranks = the user\'s channel already gets views from that search). No search volume: for volume, use the vidIQ connector if the user connected it — at most ~10 keywords per request and batch them, its free plan has about 30 calls a month. The answer includes a ready prompt for that (prompt).',
    inputSchema: {
      niche,
      seed: z.string().optional().describe('A seed to start from instead of the niche\'s own seeds'),
      expand: z.boolean().optional().describe('Widen the seed with "seed a" … "seed z" (24 more autocomplete calls)'),
      hl: z.string().regex(/^[a-z]{2}$/).optional().describe('Language, default from the radar settings (en)'),
      gl: z.string().regex(/^[A-Z]{2}$/).optional().describe('Country, default US'),
      autocomplete: z.boolean().optional().describe('false = only the Library\'s own signals, no request to Google'),
      limit: z.number().int().min(1).max(300).optional()
    },
    annotations: { readOnlyHint: true }
  }, ({ niche: n, seed, expand, hl, gl, autocomplete: ac, limit }) => safe(async () => json(await keywordIdeas(store(), { niche: n, seeds: seed ? [seed] : undefined, expand: expand && seed ? seed : undefined, hl, gl, autocomplete: ac !== false, limit }))));
  server.registerTool('niche_radar', {
    title: 'Niche radar (small-channel breakouts)',
    description: 'This week\'s results of the niche radar (an optional daily YouTube search per keyword, 100 quota units each, off by default): videos from channels under the subscriber limit with many views per subscriber, and rising channels the user doesn\'t track yet; plus the radar\'s keywords, cost per run, recent runs and keyword suggestions.',
    inputSchema: { niche },
    annotations: { readOnlyHint: true }
  }, ({ niche: n }) => safe(() => {
    const p = radarPage(store(), { niche: n });
    return json({ ...p, breakouts: p.breakouts.slice(0, 20), rising: p.rising.slice(0, 12), hint: p.feature ? undefined : 'The radar is off (Features → Niche radar). Turning it on spends about ' + p.cost.total + ' Data API units a day for this niche\'s keywords.' });
  }));
  server.registerTool('radar_keywords', {
    title: 'Add niche radar keywords',
    description: 'Add search keywords to a niche\'s radar (the daily small-channel breakout search; 100 Data API units per keyword a day, quota is free but shared with niche tracking). The bridge uses them from the next run and the extension keeps them in its radar settings (Niche tracking → Radar), where the user can remove them. Up to 30 per niche. Say the daily cost to the user.',
    inputSchema: { niche, keywords: z.array(z.string().min(2).max(80)).min(1).max(30).describe('Keywords to add, e.g. "excel budget template"') }
  }, ({ niche: n, keywords }) => safe(() => {
    const pick = pickNiche(store(), n).pick;
    const r = proposeRadarKeywords(store(), { niche: pick, keywords });
    const p = radarPage(store(), { niche: pick });
    return json({ ...r, cost_per_day: p.cost.total, radar_on: p.feature, hint: p.feature ? undefined : 'The radar is off (Features → Niche radar): nothing runs until it is on.' });
  }));
  server.registerTool('niche_sample', {
    title: 'Niche sample (base rates of new uploads)',
    description: 'The denominator the radar can\'t give: once a day the newest uploads for the niche\'s search term (search.list order=date, so videos that never get views are included; one search per length, medium 4–20 min, long 20+ min and short under 4 min by default; filtered by the audio language, English by default), each measured daily for 30 days, with its channel\'s subscribers. Answers "what does a typical new upload get at 1 / 7 / 30 days", "what share passes 1K / 10K", by channel size (<1K, 1K–10K, 10K–100K, 100K+) and format, how many small channels have a 10K hit within 30 days, new channels (under a year old), subscriber growth with and without a hit, and the best small-channel videos. Off by default (Features → Niche sample); about 100 units per search a day plus ~1 per 50 measured videos (three searches: ~300 a day, ~490 once a month is measured). The Data API quota is free.',
    inputSchema: {
      niche,
      top: z.number().int().min(1).max(50).optional().describe('How many small-channel videos to list (default 10)'),
      lang: z.string().regex(/^([a-z]{2,3}|all)$/).optional().describe('Audio language to keep (en keeps en, en-US, en-IN …); default the radar language (en); all = every video'),
      searches: z.array(z.enum(['any', 'short', 'medium', 'long'])).optional().describe('Which searches count (default the current setting: medium, long and short)')
    },
    annotations: { readOnlyHint: true }
  }, ({ niche: n, top, lang, searches }) => safe(() => {
    const p = samplePage(store(), { niche: n, top, lang, searches });
    return json({ ...p, hint: p.feature ? (p.days_collecting < 35 ? 'Still collecting: 30-day numbers need about 5 weeks.' : undefined) : 'The sample is off (Features → Niche sample). It spends about ' + p.cost.total_steady + ' Data API units a day once a month of videos is being measured.' });
  }));
}
