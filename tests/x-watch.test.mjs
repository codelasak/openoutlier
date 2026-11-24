// Phase 6 X bridge watch jobs (mcp/x-watch.mjs): the weekly x-algorithm weights check and the daily
// GraphQL schema-drift check, over fixture files with a fake fetch (no network), the x.* toggles,
// the raw-GitHub-only rule, and both jobs through the real Tracker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

process.env.OPENOUTLIER_HOME = mkdtempSync(join(tmpdir(), 'openoutlier-xwatch-home-'));
const W = await import('../mcp/x-watch.mjs');
const { Store } = await import('../mcp/store.mjs');
const { Tracker, KINDS } = await import('../mcp/tracker.mjs');
const ALGO = createRequire(import.meta.url)('../src/x-algo.js');

const NOW = Date.UTC(2026, 10, 24, 12);

/** A param.rs like the real one (multi-line and one-line param! calls, non-numeric params). */
function paramRs(weights = ALGO.WEIGHTS.weights, coldStart = ALGO.WEIGHTS.coldStart) {
  const lines = ['use crate::param;', '', 'param!(ValueModelMode, String, "rust_home_mixer_value_model_mode", "weighted");',
    'param!(\n    HistoryTopicsEnabled,\n    bool,\n    "rust_home_mixer_history_topics_enabled",\n    false\n);'];
  let i = 0;
  for (const [name, key] of Object.entries(ALGO.PARAM_KEYS)) {
    if (weights[name] == null) continue;
    const v = Number.isInteger(weights[name]) ? weights[name].toFixed(1) : String(weights[name]);
    lines.push(i++ % 2 ? `param!(${name}Weight, f64, "${key}", ${v});` : `param!(\n    ${name}Weight,\n    f64,\n    "${key}",\n    ${v}\n);`);
  }
  for (const [name, key] of Object.entries(ALGO.COLD_START_KEYS)) lines.push(`param!(\n    ColdStart${name},\n    u32,\n    "${key}",\n    ${coldStart[name]}\n);`);
  return lines.join('\n');
}
/** GraphQL.json as fa0311 publishes it: an array of { n, exports: { queryId, operationName, operationType, metadata } }. */
function graphql({ drop = [], add = {}, ids = {} } = {}) {
  const names = W.USED_OPERATIONS.map((u) => u.op).filter((n) => !drop.includes(n));
  for (let i = 0; i < 120; i++) names.push('FillerOperation' + i);
  names.push(...Object.keys(add));
  return JSON.stringify(names.map((n, i) => ({ n: String(1000 + i), exports: { queryId: ids[n] || add[n] || 'id-' + n, operationName: n, operationType: 'query', metadata: { featureSwitches: [], fieldToggles: [] } } })));
}
function fakeFetch(files) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (!(url in files)) return { ok: false, status: 404, text: async () => 'not found' };
    const body = files[url];
    if (body instanceof Error) throw body;
    return { ok: true, status: 200, text: async () => body };
  };
  return { fetch, calls };
}
function memStore(features = null) {
  const meta = new Map();
  if (features) meta.set('features', features);
  return { meta, getMeta: (k, f = null) => (meta.has(k) ? meta.get(k) : f), setMeta: (k, v) => meta.set(k, v) };
}

test('parseParamRs: numeric params in both layouts; strings and bools are skipped', () => {
  const p = W.parseParamRs(paramRs());
  assert.equal(p.rust_home_mixer_favorite_weight, 0.708);
  assert.equal(p.rust_home_mixer_report_weight, -234);
  assert.equal(p.rust_home_mixer_cold_start_follower_cap, 50000);
  assert.equal(p.rust_home_mixer_value_model_mode, undefined);
  assert.equal(p.rust_home_mixer_history_topics_enabled, undefined);
  assert.equal(Object.keys(p).length, Object.keys(ALGO.PARAM_KEYS).length + Object.keys(ALGO.COLD_START_KEYS).length);
});

test('weightsFromParams: the versioned shape, or null without the core weights', () => {
  const w = W.weightsFromParams(W.parseParamRs(paramRs()), { now: NOW, sha: 'abc' });
  assert.equal(w.version, '2026-11-24');
  assert.equal(w.sha256, 'abc');
  assert.equal(w.fetchedAt, NOW);
  assert.deepEqual(w.weights, ALGO.WEIGHTS.weights);
  assert.deepEqual(w.coldStart, ALGO.WEIGHTS.coldStart);
  assert.deepEqual(ALGO.diffWeights(ALGO.WEIGHTS, w), []);
  const noReply = { ...ALGO.WEIGHTS.weights };
  delete noReply.reply;
  assert.equal(W.weightsFromParams(W.parseParamRs(paramRs(noReply))), null);
});

test('checkWeights: same weights → unchanged; a new value → the diff and the new object', async () => {
  const same = await W.checkWeights({ fetch: fakeFetch({ [W.ALGO_RAW_URL]: paramRs() }).fetch, now: NOW });
  assert.equal(same.changed, false);
  assert.equal(same.weights, ALGO.WEIGHTS, 'keeps the current object');
  const changed = await W.checkWeights({ fetch: fakeFetch({ [W.ALGO_RAW_URL]: paramRs({ ...ALGO.WEIGHTS.weights, reply: 13.5 }) }).fetch, now: NOW + 7 * 864e5 });
  assert.equal(changed.changed, true);
  assert.deepEqual(changed.diff, [{ key: 'reply', from: 5, to: 13.5 }]);
  assert.equal(changed.weights.version, '2026-12-01');
  assert.match(changed.sha256, /^[0-9a-f]{64}$/);
  await assert.rejects(W.checkWeights({ fetch: fakeFetch({ [W.ALGO_RAW_URL]: 'fn main() {}' }).fetch }), /no longer has/);
  await assert.rejects(W.checkWeights({ fetch: fakeFetch({}).fetch }), /404/);
});

test('raw GitHub only: other hosts are refused before any request', async () => {
  assert.throws(() => W.assertRaw('https://api.x.com/2/tweets'), /raw\.githubusercontent\.com only/);
  assert.throws(() => W.assertRaw('https://github.com/xai-org/x-algorithm'), /only/);
  assert.throws(() => W.assertRaw('http://raw.githubusercontent.com/a/b/c'), /only/);
  const f = fakeFetch({});
  await assert.rejects(W.checkWeights({ fetch: f.fetch, url: 'https://x.com/i/api/graphql/abc/TweetDetail' }), /only/);
  assert.equal(f.calls.length, 0);
  assert.match(W.ALGO_RAW_URL, /^https:\/\/raw\.githubusercontent\.com\//);
  assert.match(W.GRAPHQL_RAW_URL, /^https:\/\/raw\.githubusercontent\.com\/fa0311\/TwitterInternalAPIDocument\//);
});

test('weightsJob: stores a newer set, records the check, keeps changedAt; off → no request', async () => {
  const st = memStore();
  const f1 = fakeFetch({ [W.ALGO_RAW_URL]: paramRs() });
  assert.deepEqual((await W.weightsJob({ store: st, fetch: f1.fetch, now: NOW })).data, { changed: false, diff: 0, version: '2026-11-24' });
  assert.equal(st.getMeta(W.WEIGHTS_META), null, 'nothing stored while it matches the bundled copy');
  assert.equal(W.currentWeights(st), ALGO.WEIGHTS);

  const later = NOW + 7 * 864e5;
  const f2 = fakeFetch({ [W.ALGO_RAW_URL]: paramRs({ ...ALGO.WEIGHTS.weights, favorite: 0.9 }) });
  const logs = [];
  const r2 = await W.weightsJob({ store: st, fetch: f2.fetch, now: later, log: (...a) => logs.push(a.join(' ')) });
  assert.equal(r2.data.changed, true);
  assert.equal(W.currentWeights(st).weights.favorite, 0.9);
  assert.equal(W.currentWeights(st).version, '2026-12-01');
  assert.match(logs[0], /favorite 0\.708 → 0\.9/);
  assert.equal(ALGO.algoSignal({ views: 100, likes: 10 }, { weights: W.currentWeights(st) }).version, '2026-12-01', 'algoSignal takes the stored copy');

  // Next week: the same file again → compared with the stored copy, unchanged, changedAt kept.
  await W.weightsJob({ store: st, fetch: f2.fetch, now: later + 7 * 864e5 });
  const status = st.getMeta(W.WEIGHTS_STATUS_META);
  assert.deepEqual([status.changed, status.changedAt, status.checkedAt], [false, later, later + 7 * 864e5]);

  const off = memStore({ 'x.weightsUpdate': false });
  const f3 = fakeFetch({ [W.ALGO_RAW_URL]: paramRs() });
  assert.deepEqual((await W.weightsJob({ store: off, fetch: f3.fetch, now: NOW })).data, { off: true });
  assert.equal(f3.calls.length, 0);
});

test('toggleOn: default on; only an explicit false turns it off', () => {
  assert.equal(W.toggleOn(memStore(), 'x.weightsUpdate'), true);
  assert.equal(W.toggleOn(memStore({ 'x.schemaWatch': true }), 'x.schemaWatch'), true);
  assert.equal(W.toggleOn(memStore({ 'x.schemaWatch': false }), 'x.schemaWatch'), false);
  assert.equal(W.toggleOn(memStore({ 'x.schemaWatch': false }), 'x.weightsUpdate'), true);
});

test('parseGraphQL: the array dump and a keyed object', () => {
  const a = W.parseGraphQL(graphql());
  assert.deepEqual(a.TweetDetail, { queryId: 'id-TweetDetail', type: 'query' });
  assert.equal(Object.keys(a).length, W.USED_OPERATIONS.length + 120);
  const o = W.parseGraphQL({ TweetDetail: { queryId: 'q1', operationName: 'TweetDetail', operationType: 'query' } });
  assert.deepEqual(o, { TweetDetail: { queryId: 'q1', type: 'query' } });
});

test('USED_OPERATIONS: the plan 2.1 and Faz 0 lists', () => {
  const ops = W.USED_OPERATIONS.map((u) => u.op);
  for (const op of ['UserOriginalsTimeline', 'UserRepliesTimeline', 'UserRepostsTimeline', 'UserHighlightsTweets', 'UserPhotoTimeline', 'UserVideoTimeline',
    'UserTweets', 'UserTweetsAndReplies', 'HomeTimeline', 'HomeLatestTimeline', 'SearchTimeline', 'ListLatestTweetsTimeline', 'TweetDetail',
    'TweetResultByRestId', 'UserByScreenName', 'BlueVerifiedFollowers', 'accountOverviewDailyQuery', 'contentPageQuery']) assert.ok(ops.includes(op), op);
  assert.deepEqual(W.USED_OPERATIONS.filter((u) => u.legacy).map((u) => u.op), ['UserTweets', 'UserTweetsAndReplies']);
});

test('checkSchema: missing, renamed (new names since the last run), legacy as info, query id changes', () => {
  const first = W.parseGraphQL(graphql());
  const prev = { names: Object.keys(first), ops: Object.fromEntries(Object.entries(first).map(([k, v]) => [k, v.queryId])) };
  assert.deepEqual(W.checkSchema(first, { previous: prev }).warnings, []);

  const next = W.parseGraphQL(graphql({ drop: ['UserOriginalsTimeline', 'contentPageQuery', 'UserTweets'], add: { UserOriginalPostsTimeline: 'q9' }, ids: { TweetDetail: 'new-id' } }));
  const r = W.checkSchema(next, { previous: prev });
  assert.equal(r.ok, false);
  assert.deepEqual(r.warnings.map((w) => [w.op, w.kind, w.severity]), [
    ['UserOriginalsTimeline', 'renamed', 'warn'], ['UserTweets', 'missing', 'info'], ['contentPageQuery', 'missing', 'warn']
  ]);
  assert.deepEqual(r.warnings[0].candidates, ['UserOriginalPostsTimeline']);
  assert.match(r.warnings[0].en, /renamed to "UserOriginalPostsTimeline"/);
  assert.match(r.warnings[0].tr, /UserOriginalPostsTimeline/);
  assert.deepEqual(r.added, ['UserOriginalPostsTimeline']);
  assert.deepEqual(r.queryIdChanged, [{ op: 'TweetDetail', from: 'id-TweetDetail', to: 'new-id' }]);

  const onlyLegacy = W.checkSchema(W.parseGraphQL(graphql({ drop: ['UserTweets', 'UserTweetsAndReplies'] })));
  assert.equal(onlyLegacy.ok, true, 'legacy operations going away is not a failure');
  assert.equal(onlyLegacy.warnings.length, 2);
  assert.ok(W.nameSimilarity('UserOriginalsTimeline', 'UserOriginalPostsTimeline') >= 0.5);
  assert.ok(W.nameSimilarity('TweetDetail', 'FillerOperation1') < 0.5);
});

test('schemaJob: stores the result for the Library, new warnings once, refuses a broken dump; off → no request', async () => {
  const st = memStore();
  const f1 = fakeFetch({ [W.GRAPHQL_RAW_URL]: graphql() });
  assert.deepEqual((await W.schemaJob({ store: st, fetch: f1.fetch, now: NOW })).data, { ok: true, warnings: 0, fresh: 0, count: W.USED_OPERATIONS.length + 120 });
  assert.deepEqual(f1.calls, [W.GRAPHQL_RAW_URL]);

  const f2 = fakeFetch({ [W.GRAPHQL_RAW_URL]: graphql({ drop: ['TweetDetail'], add: { TweetDetailV2: 'q' } }) });
  const logs = [];
  const r2 = await W.schemaJob({ store: st, fetch: f2.fetch, now: NOW + 864e5, log: (...a) => logs.push(a.join(' ')) });
  assert.deepEqual(r2.data, { ok: false, warnings: 1, fresh: 1, count: W.USED_OPERATIONS.length + 120 });
  assert.match(logs[0], /TweetDetail renamed/);
  const saved = st.getMeta(W.SCHEMA_META);
  assert.deepEqual(saved.newWarnings, ['TweetDetail']);
  assert.deepEqual(saved.warnings[0].candidates, ['TweetDetailV2']);
  // The day after: the same warning is not "new" again.
  const r3 = await W.schemaJob({ store: st, fetch: f2.fetch, now: NOW + 2 * 864e5 });
  assert.equal(r3.data.fresh, 0);

  const status = W.watchStatus(st);
  assert.equal(status.schema.ok, false);
  assert.equal(status.schema.warnings[0].op, 'TweetDetail');
  assert.equal(status.schema.names, undefined, 'the status has no op-name dump');
  assert.equal(status.weights.bundled, true);

  await assert.rejects(W.schemaJob({ store: st, fetch: fakeFetch({ [W.GRAPHQL_RAW_URL]: '[]' }).fetch, now: NOW }), /only 0 operations/);
  assert.equal(st.getMeta(W.SCHEMA_META).checkedAt, NOW + 2 * 864e5, 'the last good result is kept');

  const off = memStore({ 'x.schemaWatch': false });
  const f4 = fakeFetch({ [W.GRAPHQL_RAW_URL]: graphql() });
  assert.deepEqual((await W.schemaJob({ store: off, fetch: f4.fetch, now: NOW })).data, { off: true });
  assert.equal(f4.calls.length, 0);
});

test('X_WATCH_KINDS through the Tracker: weekly + daily singletons, only raw GitHub requests', async () => {
  const st = new Store(mkdtempSync(join(tmpdir(), 'openoutlier-xwatch-')));
  let now = NOW;
  const f = fakeFetch({ [W.ALGO_RAW_URL]: paramRs({ ...ALGO.WEIGHTS.weights, quote: 6 }), [W.GRAPHQL_RAW_URL]: graphql() });
  const t = new Tracker({ store: st, kinds: W.X_WATCH_KINDS, now: () => now, fetch: f.fetch, random: () => 0 });
  t.seed();
  assert.deepEqual((await t.tick()).ran, [], 'a new bridge waits 10 minutes before the first check');
  assert.equal(f.calls.length, 0);
  now = NOW + 10 * 60000;
  const out = await t.tick();
  assert.deepEqual(out.ran.sort(), ['x-schema', 'x-weights']);
  assert.ok(f.calls.every((u) => u.startsWith('https://raw.githubusercontent.com/')));
  assert.equal(W.currentWeights(st).weights.quote, 6);
  assert.equal(st.getMeta(W.SCHEMA_META).ok, true);
  assert.equal(t.job('x-weights').next_at, now + 7 * 864e5);
  assert.equal(t.job('x-schema').next_at, now + 864e5);

  now += 864e5;
  const day2 = await t.tick();
  assert.deepEqual(day2.ran, ['x-schema'], 'the next day only the daily job is due');

  st.setMeta('features', { 'x.schemaWatch': false });
  now += 864e5;
  const n = f.calls.length;
  await t.tick();
  assert.equal(f.calls.length, n, 'switched off: no request');
  assert.ok(!t.enabled('x-schema') && t.enabled('x-weights'), 'the tracker skips a kind whose x.* feature is off');
  st.close();
});

test('wired: the bridge tracker runs both kinds behind x.weightsUpdate / x.schemaWatch (src/features.js)', () => {
  assert.equal(KINDS['x-weights'], W.X_WATCH_KINDS['x-weights']);
  assert.equal(KINDS['x-schema'], W.X_WATCH_KINDS['x-schema']);
  assert.equal(KINDS['x-weights'].feature, 'x.weightsUpdate');
  assert.equal(KINDS['x-schema'].feature, 'x.schemaWatch');
  const F = createRequire(import.meta.url)('../src/features.js');
  assert.equal(F.defaults()['x.weightsUpdate'], true);
  assert.equal(F.defaults()['x.schemaWatch'], true);
  // Unknown ids would be dropped by Features.sanitize on the bridge's /settings route; these survive.
  assert.deepEqual(F.sanitize({ 'x.schemaWatch': false }), { 'x.schemaWatch': false });
});

test('what the extension stores as rs:x:watch: watchStatus + currentWeights, usable by algoSignal as is', () => {
  const st = new Store(mkdtempSync(join(tmpdir(), 'openoutlier-xwatch-st-')));
  const post = { views: 10000, likes: 200, replies: 30, reposts: 20, quotes: 5 };
  const bundled = W.currentWeights(st);
  assert.equal(bundled, ALGO.WEIGHTS);
  const newer = { ...ALGO.WEIGHTS, version: '2026-12-01', weights: { ...ALGO.WEIGHTS.weights, reply: ALGO.WEIGHTS.weights.reply * 2 } };
  st.setMeta(W.WEIGHTS_META, JSON.parse(JSON.stringify(newer)));
  const cur = JSON.parse(JSON.stringify(W.currentWeights(st))); // as it travels through the /settings answer and chrome.storage
  assert.equal(cur.version, '2026-12-01');
  const a = ALGO.algoSignal(post);
  const b = ALGO.algoSignal(post, { weights: cur });
  assert.equal(b.version, '2026-12-01');
  assert.ok(b.score > a.score, 'the newer reply weight is used');
  const status = W.watchStatus(st);
  assert.deepEqual(Object.keys(status).sort(), ['schema', 'weights']);
  assert.equal(status.weights.bundled, false);
  assert.ok(Array.isArray(status.schema.warnings));
  st.close();
});
