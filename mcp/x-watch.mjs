// OpenOutlier – X bridge watch jobs (docs/x-plan.md 1 "Algoritma ağırlıkları" / "Şema kayması", 6).
//
// • x-weights (weekly): reads xai-org/x-algorithm's home-mixer/params/param.rs from GitHub, compares
//   the ranking weights with the copy we use (the stored newer one, else src/x-algo.js's bundled
//   one) and stores the new set when they differ. The extension and MCP read currentWeights().
// • x-schema (daily): reads fa0311/TwitterInternalAPIDocument's GraphQL.json (a daily dump of
//   x.com's GraphQL operations) and warns when an operation the X collector uses is gone or looks
//   renamed. The Library shows schemaStatus().warnings.
//
// Network: only raw.githubusercontent.com (assertRaw), never x.com or the X API. Every function
// takes its fetch from the caller, so tests run without the network. Both jobs are behind the
// x.weightsUpdate / x.schemaWatch toggles (rs:settings.features, default on).
//
// Scheduler: X_WATCH_KINDS has the same shape as DISCOVERY_KINDS / OWN_KINDS; mcp/tracker.mjs
// runs it once it is spread into KINDS (`...X_WATCH_KINDS`).
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const ALGO = require('../src/x-algo.js');
const F = require('../src/features.js');

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const ALGO_RAW_URL = ALGO.RAW_URL;
export const GRAPHQL_RAW_URL = 'https://raw.githubusercontent.com/fa0311/TwitterInternalAPIDocument/master/docs/json/GraphQL.json';
export const WEIGHTS_META = 'x_algo_weights';         // a newer versioned weights object than the bundled one
export const WEIGHTS_STATUS_META = 'x_algo_weights_status';
export const SCHEMA_META = 'x_schema_watch';          // { checkedAt, ok, warnings, ops: { name: queryId }, … }
export const TOGGLES = { weights: 'x.weightsUpdate', schema: 'x.schemaWatch' };

/**
 * The GraphQL operations the X collector reads (docs/x-plan.md 2.1 and the Faz 0 table).
 * legacy: read for older pages only; its disappearance is an "info", not a "warn".
 */
export const USED_OPERATIONS = [
  { op: 'UserOriginalsTimeline', group: 'profile' },
  { op: 'UserRepliesTimeline', group: 'profile' },
  { op: 'UserRepostsTimeline', group: 'profile' },
  { op: 'UserHighlightsTweets', group: 'profile' },
  { op: 'UserPhotoTimeline', group: 'profile' },
  { op: 'UserVideoTimeline', group: 'profile' },
  { op: 'UserArticlesTweets', group: 'profile' },
  { op: 'UserTweets', group: 'profile', legacy: true },
  { op: 'UserTweetsAndReplies', group: 'profile', legacy: true },
  { op: 'HomeTimeline', group: 'feeds' },
  { op: 'HomeLatestTimeline', group: 'feeds' },
  { op: 'SearchTimeline', group: 'feeds' },
  { op: 'ListLatestTweetsTimeline', group: 'feeds' },
  { op: 'CommunityTweetsTimeline', group: 'feeds' },
  { op: 'TweetDetail', group: 'post' },
  { op: 'TweetResultByRestId', group: 'post' },
  { op: 'UserByScreenName', group: 'user' },
  { op: 'BlueVerifiedFollowers', group: 'user' },
  { op: 'accountOverviewDailyQuery', group: 'analytics' },
  { op: 'contentPageQuery', group: 'analytics' }
];

// ---- toggles and network ---------------------------------------------------------------------------------------
/**
 * Whether an x.* toggle is on. Known to src/features.js → its resolved value; otherwise the raw stored
 * value (the bridge keeps meta.features), where anything but an explicit false is on.
 */
export function toggleOn(store, id) {
  let stored = null;
  try { stored = store.getMeta('features', null); } catch { /* no store */ }
  if (F.get && F.get(id)) return !!F.resolve(stored)[id];
  return !(stored && stored[id] === false);
}

/** Only raw GitHub files. */
export function assertRaw(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.hostname !== 'raw.githubusercontent.com') throw new Error('x-watch fetches raw.githubusercontent.com only, not ' + u.hostname);
  return url;
}

async function getText(fetchFn, url, { timeoutMs = 20000, maxBytes = 8 * 1024 * 1024 } = {}) {
  assertRaw(url);
  const f = fetchFn || globalThis.fetch;
  const r = await f(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'text/plain, application/json' } });
  if (!r || !r.ok) throw new Error(`GET ${url} → ${r ? r.status : 'no response'}`);
  const text = await r.text();
  if (text.length > maxBytes) throw new Error(`GET ${url}: ${text.length} bytes is more than ${maxBytes}`);
  return text;
}

// ---- weights ------------------------------------------------------------------------------------------------------
/** Numeric params of a param.rs file: { "<rust key>": number } from `param!(Name, f64|u32|…, "<key>", <number>)`. */
export function parseParamRs(text) {
  const out = {};
  const re = /param!\s*\(\s*(\w+)\s*,\s*(f64|f32|u64|u32|i64|i32|usize)\s*,\s*"([^"]+)"\s*,\s*(-?\d+(?:\.\d+)?(?:e-?\d+)?)\s*,?\s*\)/g;
  let m;
  while ((m = re.exec(String(text || '')))) out[m[3]] = Number(m[4]);
  return out;
}

/**
 * A versioned weights object (same shape as ALGO.WEIGHTS) from parsed params, or null when the file
 * no longer has the core weights (a moved or rewritten file must not replace a good copy).
 */
export function weightsFromParams(params, { now = Date.now(), sha = null } = {}) {
  const weights = {};
  for (const [name, key] of Object.entries(ALGO.PARAM_KEYS)) if (Number.isFinite(params[key])) weights[name] = params[key];
  for (const core of ['favorite', 'reply', 'retweet', 'quote']) if (!Number.isFinite(weights[core])) return null;
  const coldStart = {};
  for (const [name, key] of Object.entries(ALGO.COLD_START_KEYS)) if (Number.isFinite(params[key])) coldStart[name] = params[key];
  return {
    version: new Date(now).toISOString().slice(0, 10),
    source: ALGO.SOURCE_URL,
    raw: ALGO.RAW_URL,
    sha256: sha,
    fetchedAt: now,
    license: ALGO.WEIGHTS.license,
    weights,
    coldStart: Object.keys(coldStart).length ? coldStart : { ...ALGO.WEIGHTS.coldStart },
    maxPostAgeHours: ALGO.WEIGHTS.maxPostAgeHours
  };
}

/** The weights in use: the stored newer copy, else the bundled one. */
export function currentWeights(store) {
  let stored = null;
  try { stored = store.getMeta(WEIGHTS_META, null); } catch { /* none */ }
  return ALGO.pick(stored);
}

/**
 * Fetch and compare. → { changed, diff: [{ key, from, to }], weights (the new object, or the current one) }
 * Throws when the file can't be read or no longer has the core weights.
 */
export async function checkWeights({ fetch: fetchFn, now = Date.now(), current = ALGO.WEIGHTS, url = ALGO_RAW_URL } = {}) {
  const text = await getText(fetchFn, url);
  const sha = createHash('sha256').update(text).digest('hex');
  const next = weightsFromParams(parseParamRs(text), { now, sha });
  if (!next) throw new Error('param.rs no longer has the favorite/reply/retweet/quote weights; keeping version ' + current.version);
  const diff = ALGO.diffWeights(current, next);
  return { changed: diff.length > 0, diff, weights: diff.length ? next : current, sha256: sha };
}

/** The weekly job: store a newer set when it changed; always record when it last looked. */
export async function weightsJob(ctx) {
  const { store, now = Date.now() } = ctx;
  if (!toggleOn(store, TOGGLES.weights)) return { data: { off: true } };
  const current = currentWeights(store);
  const r = await checkWeights({ fetch: ctx.fetch, now, current });
  if (r.changed) {
    store.setMeta(WEIGHTS_META, r.weights);
    ctx.log?.('x-algorithm weights changed:', r.diff.map((d) => `${d.key} ${d.from} → ${d.to}`).join(', '));
  }
  const status = { checkedAt: now, changed: r.changed, diff: r.diff, version: r.weights.version, sha256: r.sha256 };
  if (r.changed) status.changedAt = now;
  else { const prev = store.getMeta(WEIGHTS_STATUS_META, null); if (prev && prev.changedAt) status.changedAt = prev.changedAt; }
  store.setMeta(WEIGHTS_STATUS_META, status);
  return { data: { changed: r.changed, diff: r.diff.length, version: r.weights.version } };
}

// ---- schema drift -----------------------------------------------------------------------------------------------
/** GraphQL.json → { operationName: { queryId, type } }. Takes the array dump ({ exports: {…} }) or a keyed object. */
export function parseGraphQL(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  const out = {};
  const add = (e) => {
    const x = e && (e.exports || e);
    if (x && typeof x.operationName === 'string') out[x.operationName] = { queryId: x.queryId || null, type: x.operationType || null };
  };
  if (Array.isArray(data)) data.forEach(add);
  else if (data && typeof data === 'object') Object.values(data).forEach(add);
  return out;
}

function tokens(name) { return String(name).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); }
/** 0…1: shared camel-case words (Dice) — "UserTweets" vs "UserOriginalsTimeline" shares "user". */
export function nameSimilarity(a, b) {
  const x = tokens(a), y = tokens(b);
  if (!x.length || !y.length) return 0;
  const ys = new Set(y);
  const inter = x.filter((t) => ys.has(t)).length;
  return (2 * inter) / (x.length + y.length);
}

/**
 * Compare the dump with the operations we use (and the previous run's names, when known).
 * → { ok, missing: [{ op, group, legacy, candidates: [names] }], queryIdChanged: [{ op, from, to }],
 *     added (new names since the last run), warnings: [{ op, kind: 'missing'|'renamed', severity, tr, en }], ops: { used op: queryId } }
 */
export function checkSchema(current, { previous = null, used = USED_OPERATIONS } = {}) {
  const names = Object.keys(current);
  const prevNames = previous && Array.isArray(previous.names) ? new Set(previous.names) : null;
  const added = prevNames ? names.filter((n) => !prevNames.has(n)) : [];
  const missing = [];
  const queryIdChanged = [];
  const ops = {};
  for (const u of used) {
    const hit = current[u.op];
    if (hit) {
      ops[u.op] = hit.queryId;
      const before = previous && previous.ops && previous.ops[u.op];
      if (before && hit.queryId && before !== hit.queryId) queryIdChanged.push({ op: u.op, from: before, to: hit.queryId });
      continue;
    }
    // Rename candidates: names new since the last run first, then any name that shares most words.
    const pool = added.length ? added : names;
    const candidates = pool.map((n) => ({ n, s: nameSimilarity(u.op, n) })).filter((c) => c.s >= 0.5)
      .sort((a, b) => b.s - a.s).slice(0, 3).map((c) => c.n);
    missing.push({ op: u.op, group: u.group, legacy: !!u.legacy, candidates });
  }
  const warnings = missing.map((m) => {
    const renamed = m.candidates.length > 0;
    const severity = m.legacy ? 'info' : 'warn';
    const tr = renamed
      ? `X'in GraphQL listesinde "${m.op}" yok; adı "${m.candidates[0]}" olarak değişmiş olabilir. X toplayıcısı bu sayfada veri okuyamayabilir.`
      : `X'in GraphQL listesinde "${m.op}" artık yok. X toplayıcısı bu sayfada veri okuyamayabilir.`;
    const en = renamed
      ? `"${m.op}" is no longer in X's GraphQL list; it may have been renamed to "${m.candidates[0]}". The X collector may miss that page.`
      : `"${m.op}" is no longer in X's GraphQL list. The X collector may miss that page.`;
    return { op: m.op, kind: renamed ? 'renamed' : 'missing', severity, candidates: m.candidates, tr, en };
  });
  return { ok: !warnings.some((w) => w.severity === 'warn'), missing, queryIdChanged, added, warnings, ops };
}

/** The daily job: fetch, compare with the last run, store the result for the Library. */
export async function schemaJob(ctx) {
  const { store, now = Date.now() } = ctx;
  if (!toggleOn(store, TOGGLES.schema)) return { data: { off: true } };
  const text = await getText(ctx.fetch, GRAPHQL_RAW_URL);
  const current = parseGraphQL(text);
  const n = Object.keys(current).length;
  // A broken or emptied dump would flag everything: keep the last good result instead.
  if (n < 100) throw new Error(`GraphQL.json has only ${n} operations; not comparing`);
  const prev = store.getMeta(SCHEMA_META, null);
  const r = checkSchema(current, { previous: prev });
  const wasWarned = new Set((prev && prev.warnings || []).map((w) => w.op));
  const fresh = r.warnings.filter((w) => !wasWarned.has(w.op));
  if (fresh.length) ctx.log?.('X schema drift:', fresh.map((w) => `${w.op} ${w.kind}`).join(', '));
  store.setMeta(SCHEMA_META, {
    checkedAt: now, ok: r.ok, warnings: r.warnings, newWarnings: fresh.map((w) => w.op), queryIdChanged: r.queryIdChanged,
    added: r.added.slice(0, 50), ops: r.ops, names: Object.keys(current).sort(), count: n, source: GRAPHQL_RAW_URL
  });
  return { data: { ok: r.ok, warnings: r.warnings.length, fresh: fresh.length, count: n } };
}

/** What the Library / bridge_status shows (no op-name dump). */
export function watchStatus(store) {
  const s = store.getMeta(SCHEMA_META, null);
  const w = store.getMeta(WEIGHTS_STATUS_META, null);
  const cur = currentWeights(store);
  return {
    weights: { on: toggleOn(store, TOGGLES.weights), version: cur.version, bundled: cur === ALGO.WEIGHTS, checkedAt: w?.checkedAt || null, changedAt: w?.changedAt || null, lastDiff: w?.diff || [] },
    schema: { on: toggleOn(store, TOGGLES.schema), checkedAt: s?.checkedAt || null, ok: s ? s.ok : null, warnings: s?.warnings || [], queryIdChanged: s?.queryIdChanged || [], count: s?.count || null }
  };
}

// ---- tracker kinds (mcp/tracker.mjs) -------------------------------------------------------------------------------
// Spread into KINDS in mcp/tracker.mjs. The tracker runs a kind only while its x.* feature is on
// (src/features.js: x.weightsUpdate, x.schemaWatch, both on by default); each job also checks its toggle.
// A new bridge waits FIRST_DELAY before the first check, so a short-lived process (a test, a quick restart) makes no request.
const FIRST_DELAY = 10 * MIN;
export const X_WATCH_KINDS = {
  'x-weights': { singleton: true, feature: TOGGLES.weights, first: (now) => now + FIRST_DELAY, every: 7 * DAY, jitter: 2 * HOUR, units: 0, run: weightsJob },
  'x-schema': { singleton: true, feature: TOGGLES.schema, first: (now) => now + FIRST_DELAY, every: DAY, jitter: HOUR, units: 0, run: schemaJob }
};
