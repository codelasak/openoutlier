// Phase 5 on the bridge (mcp/discovery.mjs, mcp/providers/): migration 5, the niche radar job over
// fixture search.list / videos.list / channels.list answers (quota math, the shared budget), the
// co-recommendation aggregation and its decay, similar channels and thumbnails, autocomplete with its
// cache and rate limiter, keyword ideas, provider keys (mode 600, never echoed, outside the backup),
// Social Blade and DataForSEO with fake APIs, and the MCP tools.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const HOME = mkdtempSync(join(tmpdir(), 'openoutlier-disc-home-'));
process.env.OPENOUTLIER_HOME = HOME;
const { Store, SCHEMA_VERSION } = await import('../mcp/store.mjs');
const DISC = await import('../mcp/discovery.mjs');
const PROV = await import('../mcp/providers/index.mjs');
const SB = await import('../mcp/providers/socialblade.mjs');
const DFS = await import('../mcp/providers/dataforseo.mjs');
const RYD = await import('../mcp/providers/ryd.mjs');
const { Tracker } = await import('../mcp/tracker.mjs');
const { quotaOf } = await import('../mcp/youtube-api.mjs');
const { simulate } = await import('../dev/niche-sim.mjs');
const { fakeFetch, RADAR_KEYWORDS, NOW } = await import('../dev/make-discovery-fixture.mjs');
const I = createRequire(import.meta.url)('../src/yt-insights.js');

const H = 3600e3;
const DAY = 24 * H;
const KEY = 'AIza' + 'Q'.repeat(35);
const store = () => new Store(mkdtempSync(join(tmpdir(), 'openoutlier-disc-')));
const uc = (s) => ('UCrdr' + s + 'xxxxxxxxxxxxxxxxxxxxxx').slice(0, 24);
const instant = { run: (fn) => fn() };
function quotaCtx(budget = Infinity) {
  const q = { used: 0, spend: (n) => { q.used += n; }, canSpend: (n) => q.used + n <= budget };
  return q;
}

test('migration 5: discovery tables, idempotent', () => {
  const s = store();
  assert.equal(SCHEMA_VERSION, 8);
  assert.equal(Number(s.getMeta("schema_version")), 8);
  const tables = s.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  for (const t of ['co_recs', 'seen_channels', 'radar_runs', 'radar_videos', 'thumb_hashes', 'keyword_cache', 'serp_ranks', 'provider_log']) assert.ok(tables.includes(t), t);
  assert.equal(s.migrate(), 8);
});

test('radar job: one search.list per keyword (100 units), then videos.list and channels.list; results and lists', async () => {
  const s = store();
  simulate(s, { now: NOW, seed: 7 });
  s.setMeta('features', { 'niche-radar': true });
  DISC.saveRadarSettings(s, { keywords: { Excel: RADAR_KEYWORDS }, maxSubs: 50000, minRatio: 1, minViews: 1000, perKeyword: 25 });
  const { fetch, calls } = fakeFetch();
  const q = quotaCtx();
  const r = await DISC.DISCOVERY_KINDS.radar.run({ store: s, now: NOW, apiKey: KEY, fetch, quota: q });
  const search = calls.filter((u) => u.includes('/search?'));
  assert.equal(search.length, 4);
  const u = new URL(search[0]);
  assert.deepEqual([u.searchParams.get('order'), u.searchParams.get('type'), u.searchParams.get('publishedAfter'), u.searchParams.get('maxResults'), u.searchParams.get('regionCode'), u.searchParams.get('relevanceLanguage')],
    ['viewCount', 'video', new Date(NOW - 7 * DAY).toISOString(), '25', 'US', 'en']);
  assert.equal(calls.filter((x) => x.includes('/videos?')).length, 1, '13 videos: one videos.list call');
  assert.equal(calls.filter((x) => x.includes('/channels?')).length, 1, '9 channels: one channels.list call');
  assert.equal(q.used, 4 * 100 + 1 + 1, 'quota: 4 × 100 + 1 + 1');
  assert.deepEqual(r.data.runs[0], { niche: 'Excel', ran: 4, skipped: 0, units: 402, videos: 13, error: null });
  assert.equal(DISC.radarPage(s, { niche: 'Excel', now: NOW }).cost.total, 404, 'the shown cost is an upper bound of the real one');
  const p = DISC.radarPage(s, { niche: 'Excel', now: NOW });
  assert.equal(p.feature, true);
  assert.deepEqual(p.keywords, RADAR_KEYWORDS);
  assert.equal(p.runs[0].units, 402);
  const ids = p.breakouts.map((v) => v.video_id);
  assert.equal(ids[0], 'rdrSW000001', 'best views per subscriber first (61K on 4.2K subs)');
  assert.ok(!ids.includes('rdrOP000001'), 'over the subscriber limit');
  assert.ok(!ids.includes('rdrOLD00001'), 'older than 7 days');
  assert.ok(!ids.includes('rdrKJ000001'), 'Kenji Explains (1.1M subs) is over the limit too');
  assert.ok(p.breakouts.every((v) => v.views_per_sub >= 1 && v.subs <= 50000));
  assert.equal(p.breakouts.find((v) => v.video_id === 'rdrSS000002').type, 'short');
  assert.deepEqual(p.breakouts.find((v) => v.video_id === 'rdrDD000001').keywords.sort(), ['excel dashboard', 'power query']);
  assert.equal(p.rising[0].channel, 'Sheet Wizard');
  assert.equal(p.rising[0].videos.length, 2);
  assert.ok(p.suggestions.length && p.suggestions.every((x) => !RADAR_KEYWORDS.includes(x.keyword)));
  // A tracked channel is never "rising"; it still shows among breakouts when small.
  s.db.prepare("INSERT INTO tracked_channels (channel_id, account_id, niche, mine, added_at, active, name) VALUES (?, 'yt/sheetwizard', 'Excel', 0, ?, 1, 'Sheet Wizard')").run(uc('sheetwizard'), NOW);
  const p2 = DISC.radarPage(s, { niche: 'Excel', now: NOW });
  assert.ok(!p2.rising.some((c) => c.channel_id === uc('sheetwizard')));
  assert.ok(p2.breakouts.find((v) => v.video_id === 'rdrSW000001').tracked);
  // Nothing to do without keywords: no request.
  DISC.saveRadarSettings(s, { keywords: {} });
  const none = fakeFetch();
  const idle = await DISC.DISCOVERY_KINDS.radar.run({ store: s, now: NOW, apiKey: KEY, fetch: none.fetch, quota: quotaCtx() });
  assert.deepEqual(idle.data, { idle: 'no keywords' });
  assert.equal(none.calls.length, 0);
});

test('radar and the shared budget: stops before the reserve, leaves the rest for the next run; Google\'s quota error stops it', async () => {
  const s = store();
  DISC.saveRadarSettings(s, { keywords: { Excel: RADAR_KEYWORDS } });
  // Room for two keywords above the 500-unit reserve.
  const q = quotaCtx(102 * 2 + DISC.RADAR_RESERVE + 5);
  const { fetch, calls } = fakeFetch();
  const r = await DISC.DISCOVERY_KINDS.radar.run({ store: s, now: NOW, apiKey: KEY, fetch, quota: q });
  assert.equal(calls.filter((u) => u.includes('/search?')).length, 2);
  assert.deepEqual([r.data.runs[0].ran, r.data.runs[0].skipped], [2, 2]);
  const run = DISC.radarPage(s, { niche: 'Excel', now: NOW }).runs[0];
  assert.deepEqual(run.skipped, ['excel pivot table', 'power query']);
  // quotaExceeded from Google: counted (Google counts failed calls), no more searches.
  const s2 = store();
  DISC.saveRadarSettings(s2, { keywords: { Excel: RADAR_KEYWORDS } });
  let n = 0;
  const q2 = quotaCtx();
  const failing = async () => { n++; return { ok: false, status: 403, json: async () => ({ error: { code: 403, message: 'quota', errors: [{ reason: 'quotaExceeded' }] } }) }; };
  const r2 = await DISC.DISCOVERY_KINDS.radar.run({ store: s2, now: NOW, apiKey: KEY, fetch: failing, quota: q2 });
  assert.equal(n, 1, 'stops after the first quota error');
  assert.equal(q2.used, 100);
  assert.match(r2.data.stopped, /quota/);
  // Through the tracker: off by default (no request), deferred past the day's budget when on.
  const s3 = store();
  DISC.saveRadarSettings(s3, { keywords: { Excel: ['excel xlookup'] } });
  const f3 = fakeFetch();
  const t = new Tracker({ store: s3, now: () => NOW, fetch: f3.fetch, apiKey: () => KEY, random: () => 0, budget: 9000 });
  t.seed();
  await t.tick();
  assert.equal(f3.calls.length, 0, 'niche-radar is off by default');
  s3.setMeta('features', { 'niche-radar': true });
  s3.setMeta('youtube_api_quota', { day: createRequire(import.meta.url)('../src/youtube-api.js').quotaDay(NOW), units: 8950 });
  const out = await t.tick();
  assert.ok(out.deferred.includes('radar'), 'deferred: only 50 units left of the 9,000 budget');
  assert.equal(f3.calls.filter((u) => u.includes('/search?')).length, 0);
});

test('co-recommendations: aggregated per channel pair with time decay; only counts are kept', () => {
  const s = store();
  const A = uc('aaa');
  const B = uc('bbb');
  const C = uc('ccc');
  assert.deepEqual(DISC.putCoRecs(s, { source: A, recs: [{ id: B, name: 'Bee', handle: 'bee' }, { id: C }, { id: B }, { id: A }] }, NOW), { ok: true, pairs: 2 });
  DISC.putCoRecs(s, { source: A, recs: [{ id: B }] }, NOW + 30 * DAY);
  const row = s.db.prepare('SELECT * FROM co_recs WHERE a = ? AND b = ?').get(A, B);
  assert.equal(row.weight, 1.5, '1 decayed for 30 days (0.5) + 1');
  assert.equal(row.n, 2);
  assert.deepEqual(Object.keys(row).sort(), ['a', 'b', 'n', 'updated_at', 'weight'], 'no video ids, titles or watch times');
  assert.equal(s.db.prepare('SELECT name FROM seen_channels WHERE channel_id = ?').get(B).name, 'Bee');
  assert.equal(DISC.putCoRecs(s, { source: 'nope', recs: [{ id: B }] }, NOW).ok, false);
  // Old pairs are dropped after 200 days without a sighting.
  DISC.putCoRecs(s, { source: B, recs: [{ id: C }] }, NOW + 300 * DAY);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM co_recs WHERE a = ?').get(A).n, 0);
  // Switched off: nothing is written.
  s.setMeta('features', { 'channel-similar': false });
  assert.deepEqual(DISC.putCoRecs(s, { source: A, recs: [{ id: B }] }, NOW), { ok: false, off: true });
});

test('similar channels, the channel map and similar thumbnails over the simulated niche', async () => {
  const s = store();
  const sim = simulate(s, { now: NOW, seed: 7 });
  const id = (n) => sim.channels.find((c) => c.name === n).channel_id;
  for (let i = 0; i < 6; i++) DISC.putCoRecs(s, { source: id('Kenji Explains'), recs: [{ id: id('Leila Gharani'), name: 'Leila Gharani' }, { id: uc('outsider'), name: 'Outsider', handle: 'outsider' }] }, NOW - i * DAY);
  DISC.putCoRecs(s, { source: id('Excel Campus'), recs: [{ id: uc('outsider'), name: 'Outsider' }] }, NOW);
  const r = DISC.similarChannels(s, { channel: 'KenjiExplains', now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.channel.id, id('Kenji Explains'), 'a handle resolves to the UC id');
  assert.equal(r.similar[0].id, id('Leila Gharani'));
  assert.equal(r.similar[0].why, 'both', 'co-recommended and written alike');
  assert.equal(r.similar.find((x) => x.id === uc('outsider')).why, 'corec');
  assert.ok(r.similar.find((x) => x.id === uc('outsider')).seen === 6);
  assert.equal(DISC.similarChannels(s, { channel: 'nobody-at-all' }).ok, false);
  const m = DISC.channelMap(s, { niche: 'Excel', now: NOW });
  assert.equal(m.outside[0].id, uc('outsider'));
  assert.deepEqual(m.outside[0].links.sort(), ['Excel Campus', 'Kenji Explains']);
  assert.equal(m.channels.length, sim.channels.length);
  assert.ok(m.channels.every((c) => c.neighbors.length <= 4));
  // Thumbnails: the index job hashes them (fake ffmpeg-less tools → no request without a hash method is fine), similarity by bits.
  const vids = s.db.prepare('SELECT video_id FROM tracked_videos ORDER BY video_id LIMIT 4').all().map((v) => v.video_id);
  const put = s.db.prepare('INSERT OR REPLACE INTO thumb_hashes (video_id, hash, at) VALUES (?, ?, ?)');
  put.run(vids[0], 'd:ffff0000ffff0000', NOW);
  put.run(vids[1], 'd:ffff0000ffff0001', NOW); // 1 bit apart
  put.run(vids[2], 'd:ffff0000ff000000', NOW); // 8 bits apart
  put.run(vids[3], 'd:0000ffff0000ffff', NOW); // 64 bits apart
  const t = await DISC.similarThumbs(s, { video: 'https://www.youtube.com/watch?v=' + vids[0], now: NOW, fetch: async () => { throw new Error('no network in tests'); } });
  assert.deepEqual(t.similar.map((x) => [x.id, x.distance]), [[vids[1], 1], [vids[2], 8]]);
  assert.equal(t.video.hashed, true);
  const none = await DISC.similarThumbs(s, { video: 'zzzzzzzzzzz', now: NOW, fetch: async () => ({ ok: false }) });
  assert.equal(none.video.hashed, false);
  assert.deepEqual(none.similar, []);
  assert.equal((await DISC.similarThumbs(s, { video: 'bad' })).ok, false);
  // The background job: hashes what has none, at most THUMB_BATCH, remembers failures for a week.
  const seen = [];
  const r2 = await DISC.DISCOVERY_KINDS['thumb-index'].run({ store: s, now: NOW, fetch: async (u) => { seen.push(u); return { ok: false }; }, thumbBatch: 5 });
  assert.equal(seen.length, 5);
  assert.ok(seen.every((u) => /^https:\/\/i\.ytimg\.com\//.test(u)));
  assert.equal(r2.data.tried, 5);
  const again = [];
  await DISC.DISCOVERY_KINDS['thumb-index'].run({ store: s, now: NOW + H, fetch: async (u) => { again.push(u); return { ok: false }; }, thumbBatch: 5 });
  assert.ok(again.every((u) => !seen.includes(u)), 'a failed thumbnail waits a week');
});

test('autocomplete: cached 7 days per (q, hl, gl), rate-limited, a stale answer beats an error', async () => {
  const s = store();
  const { fetch, calls } = fakeFetch();
  let clock = NOW;
  const waits = [];
  const lim = I.limiter({ max: 10, windowMs: 10_000, now: () => clock, sleep: async (ms) => { waits.push(ms); clock += ms; } });
  for (let i = 0; i < 12; i++) await DISC.autocomplete(s, 'excel ' + i, { fetch, now: NOW, limiter: lim });
  assert.equal(calls.length, 12);
  assert.equal(waits.length, 1, 'the 11th call waited for the 10-second window (the 12th then fits the new one)');
  assert.equal(waits[0], 10_000);
  assert.equal(clock - NOW, 10_000, '12 calls took 10 s: at most 10 in any 10 s');
  const a = await DISC.autocomplete(s, 'excel', { fetch, now: NOW, limiter: instant });
  assert.equal(a.cached, false);
  assert.ok(a.suggestions.includes('excel xlookup'));
  assert.equal(new URL(calls[calls.length - 1]).searchParams.get('hl'), 'en');
  assert.equal((await DISC.autocomplete(s, 'Excel ', { fetch, now: NOW + DAY, limiter: instant })).cached, true);
  assert.equal((await DISC.autocomplete(s, 'excel', { fetch, now: NOW, limiter: instant, hl: 'tr', gl: 'TR' })).cached, false, 'another language is another query');
  const down = async () => { throw new Error('offline'); };
  const stale = await DISC.autocomplete(s, 'excel', { fetch: down, now: NOW + 8 * DAY, limiter: instant });
  assert.deepEqual([stale.cached, stale.stale], [true, true]);
  const err = await DISC.autocomplete(s, 'never asked', { fetch: down, now: NOW, limiter: instant });
  assert.equal(err.error, 'offline');
});

test('keyword ideas: autocomplete + title words + gaps + own search terms; ranks; off = no request', async () => {
  const s = store();
  const sim = simulate(s, { now: NOW, seed: 7 });
  DISC.saveRadarSettings(s, { keywords: { Excel: ['excel xlookup'] } });
  s.db.prepare('INSERT INTO own_channels (channel_id, title, connected_at, active) VALUES (?, ?, ?, 1)').run(sim.mine, 'Hands on Excel', NOW);
  s.db.prepare('INSERT INTO own_breakdowns (channel_id, week, kind, data) VALUES (?, ?, ?, ?)').run(sim.mine, '2026-11-09', 'search_terms', JSON.stringify({ rows: [{ key: 'excel xlookup', views: 12 }, { key: 'pivot table excel', views: 5 }] }));
  const { fetch, calls } = fakeFetch();
  const k = await DISC.keywordIdeas(s, { niche: 'Excel', fetch, now: NOW, limiter: instant });
  assert.equal(k.prefix, 'excel');
  assert.ok(k.seeds.includes('excel') && k.seeds.includes('excel xlookup'));
  assert.equal(k.ideas[0].keyword, 'excel xlookup');
  assert.deepEqual(k.ideas[0].ranks, { views: 12, last_week: 12 });
  assert.ok(k.ideas.some((i) => i.sources.includes('gap')) && k.ideas.some((i) => i.sources.includes('title')));
  assert.ok(k.ideas.find((i) => i.keyword === 'excel xlookup multiple criteria').sources.includes('autocomplete'));
  assert.equal(k.own_terms, 2);
  assert.ok(k.prompt_keywords.length <= 10 && !k.prompt_keywords.includes('excel xlookup'), 'the vidIQ prompt skips what you already rank for');
  assert.equal(calls.length, k.seeds.length);
  await DISC.keywordIdeas(s, { niche: 'Excel', expand: 'excel lambda', fetch, now: NOW, limiter: instant });
  assert.ok(calls.some((u) => new URL(u).searchParams.get('q') === 'excel lambda z'));
  const before = calls.length;
  s.setMeta('features', { 'keyword-ideas': false });
  const off = await DISC.keywordIdeas(s, { niche: 'Excel', fetch, now: NOW + 9 * DAY, limiter: instant });
  assert.equal(calls.length, before, 'switched off: no request to Google');
  assert.equal(off.autocomplete, false);
  assert.ok(off.ideas.length > 0, 'the Library\'s own signals still list ideas');
});

test('provider keys: mode 600, atomic, never echoed, outside the database backup', () => {
  const home = mkdtempSync(join(tmpdir(), 'openoutlier-prov-'));
  const s = new Store(home);
  assert.equal(PROV.saveKey('socialblade', { clientId: 'cid-123', token: 'tok-SECRET-456' }, home).ok, true);
  assert.equal(PROV.saveKey('dataforseo', { login: 'me@example.com' }, home).ok, false, 'every field is needed');
  assert.equal(PROV.saveKey('ryd', { x: 'y' }, home).ok, false, 'RYD needs no key');
  assert.equal(PROV.saveKey('nope', {}, home).ok, false);
  const f = PROV.providersFile(home);
  assert.equal(statSync(f).mode & 0o777, 0o600);
  assert.deepEqual(PROV.keyOf('socialblade', home), { clientId: 'cid-123', token: 'tok-SECRET-456' });
  const st = PROV.status(s, home);
  assert.equal(st.socialblade.configured, true);
  assert.equal(st.socialblade.on, false, 'off by default');
  assert.equal(st.dataforseo.scraping, true);
  assert.ok(!JSON.stringify(st).includes('SECRET'), 'status never carries the key');
  assert.equal(PROV.ready(s, 'socialblade', home), false, 'a key alone isn\'t enough: the switch is off');
  s.setMeta('features', { 'provider-socialblade': true });
  assert.equal(PROV.ready(s, 'socialblade', home), true);
  // The daily backup copies the database only: the key is not in it.
  const copy = join(home, 'backup-copy.db');
  s.backupTo(copy);
  assert.ok(!readFileSync(copy).includes(Buffer.from('tok-SECRET-456')));
  assert.ok(!readFileSync(s.file).includes(Buffer.from('tok-SECRET-456')));
  // A loose mode is tightened on read.
  writeFileSync(f, readFileSync(f), { mode: 0o644 });
  PROV.readKeys(home);
  assert.equal(statSync(f).mode & 0o777, 0o600);
  assert.equal(PROV.removeKey('socialblade', home).removed, true);
  assert.equal(PROV.keyOf('socialblade', home), null);
});

test('Social Blade: the credit quote first, a confirmed backfill into channel_stats (source socialblade) that never overwrites API rows', async () => {
  const home = mkdtempSync(join(tmpdir(), 'openoutlier-sb-'));
  const s = new Store(home);
  const chans = [uc('one'), uc('two')];
  for (const c of chans) s.db.prepare("INSERT INTO tracked_channels (channel_id, account_id, mine, added_at, active) VALUES (?, ?, 0, ?, 1)").run(c, 'yt/' + c, NOW);
  s.db.prepare("INSERT INTO channel_stats (channel_id, day, subs, views, videos, source) VALUES (?, '2026-11-01', 999, 9999, 9, 'api')").run(chans[0]);
  const q = SB.quote(s, { history: '3y', now: NOW });
  assert.deepEqual([q.channels.length, q.per_channel, q.credits, q.est_usd], [2, 3, 6, 3]);
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push({ url, headers: opts.headers });
    const id = new URL(url).searchParams.get('query');
    return { ok: true, status: 200, json: async () => ({ status: { success: true }, info: { credits: { available: 94 } }, data: { id: { id, display_name: 'Chan ' + id.slice(5, 8) },
      daily: [{ date: '2026-11-01', subscribers: 100, views: 1000 }, { date: '2026-10-31', subscribers: 99, views: 990 }, { date: 'bad', subscribers: 1 }] } }) };
  };
  assert.equal((await SB.backfill(s, { history: '3y', confirm: 6, fetch, home, now: NOW, on: false })).ok, false, 'switched off: no request');
  assert.match((await SB.backfill(s, { history: '3y', confirm: 6, fetch, home, now: NOW, on: true })).error, /No Social Blade key/);
  assert.equal(calls.length, 0);
  PROV.saveKey('socialblade', { clientId: 'cid', token: 'tok' }, home);
  const unconfirmed = await SB.backfill(s, { history: '3y', fetch, home, now: NOW, on: true });
  assert.equal(unconfirmed.needs_confirm, true);
  assert.equal(calls.length, 0, 'nothing is spent without the confirmed number');
  const r = await SB.backfill(s, { history: '3y', confirm: 6, fetch, home, now: NOW, on: true });
  assert.deepEqual([r.ok, r.credits_used, r.credits_left, r.channels.map((c) => c.days)], [true, 6, 94, [2, 2]]);
  assert.equal(new URL(calls[0].url).searchParams.get('history'), 'archive');
  assert.deepEqual(calls[0].headers.clientid + '/' + calls[0].headers.token, 'cid/tok');
  const kept = s.db.prepare("SELECT subs, source FROM channel_stats WHERE channel_id = ? AND day = '2026-11-01'").get(chans[0]);
  assert.deepEqual({ ...kept }, { subs: 999, source: 'api' }, 'the tracker\'s own row wins');
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM channel_stats WHERE source = 'socialblade'").get().n, 3);
  // Asked again within 30 days: free.
  assert.deepEqual([SB.quote(s, { history: '1y', now: NOW + DAY }).credits, SB.quote(s, { history: '1y', now: NOW + DAY }).free.length], [0, 2]);
  assert.equal(SB.parseStats({ status: { success: false, error: 'Not enough credits' } }).error, 'Not enough credits');
  // maxSubs: only tracked channels under the limit (unknown counts left out), so free credits go to small channels.
  s.db.prepare("UPDATE tracked_channels SET subs = 4000 WHERE channel_id = ?").run(chans[0]);
  s.db.prepare("UPDATE tracked_channels SET subs = 3000000 WHERE channel_id = ?").run(chans[1]);
  const small = SB.quote(s, { history: '3y', maxSubs: 100000, now: NOW + 40 * DAY });
  assert.deepEqual([small.channels, small.credits, small.max_subs], [[chans[0]], 3, 100000]);
  assert.equal(SB.quote(s, { history: '3y', now: NOW + 40 * DAY }).credits, 6, 'no limit: every tracked channel');
  const sized = await SB.backfill(s, { history: '3y', maxSubs: 100000, confirm: 6, fetch, home, now: NOW + 40 * DAY, on: true });
  assert.equal(sized.needs_confirm, true, 'the confirmed number must match the filtered quote');
  // The shape of Social Blade's public example (developers page, 2026-11): `subs`, ISO dates.
  const pub = SB.parseStats({ status: { success: true, status: 200 }, data: { id: { id: 'UCl6vWwMCjufI8OPtOInHf0g', display_name: 'Social Blade' },
    daily: [{ date: '2026-11-22T00:00:00.000Z', subs: 358000, views: 43192512 }, { date: '2026-11-21T00:00:00.000Z', subs: 358000, views: 43192471 }] } });
  assert.deepEqual(pub.daily[0], { day: '2026-11-22', subs: 358000, views: 43192512 });
  assert.equal(pub.name, 'Social Blade');
});

test('DataForSEO: where your channel ranks, stored per keyword and day; RYD for video_velocity', async () => {
  const home = mkdtempSync(join(tmpdir(), 'openoutlier-dfs-'));
  const s = new Store(home);
  const mine = uc('mine');
  s.db.prepare("INSERT INTO tracked_channels (channel_id, account_id, mine, added_at, active) VALUES (?, 'yt/mine', 1, ?, 1)").run(mine, NOW);
  PROV.saveKey('dataforseo', { login: 'me@example.com', password: 'pw' }, home);
  const bodies = [];
  const fetch = async (url, opts) => {
    bodies.push(JSON.parse(opts.body)[0]);
    assert.equal(opts.headers.authorization, 'Basic ' + Buffer.from('me@example.com:pw').toString('base64'));
    const kw = JSON.parse(opts.body)[0].keyword;
    return { ok: true, status: 200, json: async () => ({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0.002, result: [{ items: [
      { type: 'youtube_video', rank_absolute: 1, video_id: 'aaaaaaaaaaa', channel_id: uc('other') },
      { type: 'youtube_channel', rank_absolute: 2, channel_id: mine },
      kw === 'excel pivot table' ? { type: 'youtube_video', rank_absolute: 7, video_id: 'bbbbbbbbbbb', channel_id: mine, title: 'Mine' } : null
    ].filter(Boolean) }] }] }) };
  };
  assert.equal((await DFS.checkRanks(s, { keywords: ['x'], fetch, home, now: NOW, on: false })).ok, false);
  const r = await DFS.checkRanks(s, { keywords: ['excel pivot table', 'excel xlookup'], region: 'TR', lang: 'tr', fetch, home, now: NOW, on: true });
  assert.deepEqual(r.checked, [{ keyword: 'excel pivot table', rank: 7, video_id: 'bbbbbbbbbbb' }, { keyword: 'excel xlookup', rank: null, video_id: null }]);
  assert.equal(r.cost, 0.004);
  assert.deepEqual([bodies[0].location_code, bodies[0].language_code], [2792, 'tr']);
  assert.equal(DFS.latestRanks(s)['excel pivot table'].rank, 7);
  assert.equal(s.db.prepare('SELECT source FROM serp_ranks LIMIT 1').get().source, 'dataforseo');
  assert.deepEqual(DFS.estimate(50), { keywords: 50, est_usd: 0.1, per_keyword: 0.002 });
  // RYD: quiet on errors, cached for a day.
  let n = 0;
  const v = await RYD.votes('yTdemo00029', { fetch: async () => { n++; return { ok: true, json: async () => ({ likes: 10, dislikes: 2, rating: 4.3 }) }; }, now: NOW });
  assert.deepEqual(v, { likes: 10, dislikes: 2, rating: 4.3, via: 'returnyoutubedislike.com (estimate)' });
  await RYD.votes('yTdemo00029', { fetch: async () => { n++; return { ok: false }; }, now: NOW + H });
  assert.equal(n, 1);
  assert.equal(await RYD.votes('bad'), null);
});

test('MCP tools: similar_channels, keyword_ideas, niche_radar, niche_sample', async () => {
  const s = store();
  const sim = simulate(s, { now: Date.now(), seed: 7 });
  DISC.putCoRecs(s, { source: sim.channels[0].channel_id, recs: [{ id: sim.channels[1].channel_id }] });
  const tools = {};
  const server = { registerTool: (name, meta, fn) => { tools[name] = { meta, fn }; } };
  const json = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });
  const safe = async (fn) => { try { return await fn(); } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; } };
  const { z } = await import(createRequire(join(process.cwd(), 'mcp', 'package.json')).resolve('zod'));
  DISC.registerDiscoveryTools(server, { z, json, safe, store: () => s });
  assert.deepEqual(Object.keys(tools).sort(), ['keyword_ideas', 'niche_radar', 'niche_sample', 'similar_channels']);
  for (const t of Object.values(tools)) assert.equal(t.meta.annotations.readOnlyHint, true);
  assert.match(tools.keyword_ideas.meta.description, /vidIQ/);
  const sc = JSON.parse((await tools.similar_channels.fn({ channel: sim.channels[0].channel_id })).content[0].text);
  assert.equal(sc.similar[0].id, sim.channels[1].channel_id);
  const kw = JSON.parse((await tools.keyword_ideas.fn({ niche: 'Excel', autocomplete: false })).content[0].text);
  assert.equal(kw.autocomplete, false);
  assert.ok(kw.ideas.length > 0 && kw.prompt.includes('vidIQ'));
  const nr = JSON.parse((await tools.niche_radar.fn({ niche: 'Excel' })).content[0].text);
  assert.equal(nr.feature, false);
  assert.match(nr.hint, /off/);
  const ns = JSON.parse((await tools.niche_sample.fn({ niche: 'Excel' })).content[0].text);
  assert.deepEqual([ns.feature, ns.videos, ns.terms], [false, 0, ['excel']], 'off, empty, the niche prefix as its term');
  assert.match(ns.hint, /off/);
  assert.match(DISC.INSTRUCTIONS, /niche_sample/);
  assert.match(DISC.INSTRUCTIONS, /NexLev MCP \(about 50 calls a week\)/);
  assert.match(DISC.INSTRUCTIONS, /vidIQ MCP \(about 30 calls a month\)/);
});

// ---- niche sample ------------------------------------------------------------------------------------
function sampleFetch({ found = [], views = () => 0, subs = {}, created = {} }) {
  const calls = [];
  let searches = 0;
  const fetch = async (url) => {
    calls.push(url);
    const u = new URL(url);
    const path = u.pathname.split('/').pop();
    let body;
    if (path === 'search') {
      body = { items: searches++ === 0 ? found.map((v) => ({ id: { kind: 'youtube#video', videoId: v.id }, snippet: { channelId: v.ch, title: v.title, publishedAt: new Date(v.pub).toISOString() } })) : [] };
    } else if (path === 'videos') {
      const ids = u.searchParams.get('id').split(',');
      body = { items: found.filter((v) => ids.includes(v.id) && !v.gone).map((v) => ({ id: v.id, snippet: { channelId: v.ch, title: v.title, publishedAt: new Date(v.pub).toISOString(), description: '', defaultAudioLanguage: v.lang || 'en', defaultLanguage: 'en' },
        statistics: { viewCount: String(views(v)), likeCount: '1', commentCount: '0' }, contentDetails: { duration: v.short ? 'PT40S' : 'PT9M' } })) };
    } else if (path === 'channels') {
      const ids = u.searchParams.get('id').split(',');
      body = { items: ids.map((id) => ({ id, snippet: { title: 'Chan ' + id.slice(5, 9), publishedAt: new Date(created[id] || NOW - 5 * 365 * DAY).toISOString() },
        statistics: { subscriberCount: String(typeof subs[id] === 'function' ? subs[id]() : subs[id] ?? 100), videoCount: '10', viewCount: '1000', hiddenSubscriberCount: false } })) };
    } else body = { items: [] };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } };
  };
  return { fetch, calls };
}

test('niche sample: newest uploads (order=date), measured daily for 30 days, then base rates by channel size', async () => {
  const s = store();
  s.db.prepare("INSERT INTO tracked_channels (channel_id, account_id, niche, mine, added_at, active) VALUES (?, 'yt/x', 'Excel', 0, ?, 1)").run(uc('tracked'), NOW);
  s.db.prepare("INSERT INTO tracked_channels (channel_id, account_id, niche, mine, added_at, active) VALUES (?, 'yt/y', NULL, 0, ?, 1)").run(uc('loose'), NOW);
  DISC.saveRadarSettings(s, { sampleTerms: { Excel: ['excel'] }, sampleDurations: ['any'] });
  const tiny = uc('tiny'), mid = uc('mid'), big = uc('big');
  const found = [
    { id: 'smpTiny0001', ch: tiny, title: 'My first Excel dashboard', pub: NOW - 3 * H },
    { id: 'smpTiny0002', ch: tiny, title: 'Excel budget', pub: NOW - 5 * H, short: true },
    { id: 'smpMid00001', ch: mid, title: 'Pivot tables', pub: NOW - 2 * H },
    { id: 'smpBig00001', ch: big, title: 'XLOOKUP', pub: NOW - 6 * H },
    { id: 'smpGone0001', ch: mid, title: 'Deleted later', pub: NOW - 1 * H, gone: false }
  ];
  let t = NOW;
  // Views grow with age: the tiny channel's dashboard breaks out (20K at 30 days), the rest stay small.
  const per = { smpTiny0001: 700, smpTiny0002: 3, smpMid00001: 30, smpBig00001: 400, smpGone0001: 1 };
  const views = (v) => Math.round(per[v.id] * Math.max(0, (t - v.pub) / DAY));
  let tinySubs = 40;
  const fx = sampleFetch({ found, views, subs: { [tiny]: () => tinySubs, [mid]: 4000, [big]: 250000 }, created: { [tiny]: NOW - 60 * DAY } });
  const q = quotaCtx();
  const r = await DISC.DISCOVERY_KINDS.sample.run({ store: s, now: t, apiKey: KEY, fetch: fx.fetch, quota: q });
  const search = new URL(fx.calls.find((u) => u.includes('/search?')));
  assert.deepEqual([search.searchParams.get('order'), search.searchParams.get('q'), search.searchParams.get('publishedAfter'), search.searchParams.get('maxResults')],
    ['date', 'excel', new Date(NOW - DAY).toISOString(), '50'], 'the newest uploads of the last 24 h, not the most viewed');
  assert.equal(fx.calls.filter((u) => u.includes('/search?')).length, 1, 'a channel tracked outside a niche doesn\'t repeat the niche\'s search');
  assert.equal(q.used, 100 + 1 + 1, 'one search, one videos.list, one channels.list');
  assert.deepEqual(r.data.runs.find((x) => x.niche === 'Excel'), { niche: 'Excel', terms: ['excel'], durations: ['any'], found: 5, measured: 5, units: 102, error: null });
  assert.deepEqual(s.db.prepare("SELECT subs_found FROM sample_videos WHERE video_id = 'smpTiny0001'").get().subs_found, 40);
  assert.equal(s.db.prepare("SELECT type FROM sample_videos WHERE video_id = 'smpTiny0002'").get().type, 'short');
  // A month of daily runs; one video disappears on day 3, the tiny channel gains subscribers.
  for (let d = 1; d <= 32; d++) {
    t = NOW + d * DAY;
    if (d === 3) found[4].gone = true;
    tinySubs = 40 + d * 30;
    await DISC.DISCOVERY_KINDS.sample.run({ store: s, now: t, apiKey: KEY, fetch: fx.fetch, quota: quotaCtx() });
  }
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM sample_videos WHERE done_at IS NULL').get().n, 0, 'everything stops after 31 days (or when gone)');
  const goneRows = s.db.prepare("SELECT COUNT(*) AS n FROM sample_stats WHERE video_id = 'smpGone0001'").get().n;
  assert.equal(goneRows, 3, 'measured until it disappeared');
  const p = DISC.samplePage(s, { niche: 'Excel', now: t });
  assert.deepEqual([p.videos, p.channels, p.terms, p.days_collecting], [5, 3, ['excel'], 32]);
  assert.equal(p.at[30].all.n, 4, 'the deleted video has no 30-day value');
  assert.equal(p.at[30].by_subs['<1K'].n, 2);
  assert.ok(Math.abs(p.at[30].by_subs['<1K'].max - 21000) <= 1, 'interpolated between daily readings');
  assert.equal(p.at[30].all.share_at_least['10000'], 0.5, 'the tiny dashboard (21K) and the big channel\'s XLOOKUP (12K)');
  assert.equal(p.at[30].by_subs['<1K'].share_at_least['10000'], 0.5);
  assert.equal(p.at[30].by_format.short.n, 1);
  assert.deepEqual(p.channels_hit_10k_by_30d['<1K'], { channels: 1, judged: 1, hit_10k: 1, share: 1 });
  assert.deepEqual(p.channels_hit_10k_by_30d['1K-10K'], { channels: 1, judged: 1, hit_10k: 0, share: 0 });
  assert.deepEqual(p.new_channels, { channels: 1, judged: 1, hit_10k: 1, share: 1 }, 'the tiny channel is two months old');
  assert.ok(p.sub_growth_30d['<1K'].median_pct_with_hit > 1000, 'the tiny channel grew from 40 subscribers');
  assert.equal(p.top_small[0].video_id, 'smpTiny0001');
  assert.ok(Math.abs(p.top_small[0].views_30d - 21000) <= 1);
  assert.ok(!p.top_small.some((v) => v.video_id === 'smpBig00001'), 'only channels under 10K');
  assert.ok(p.runs.length && p.cost.total_steady === 100 + 2 * Math.ceil(31 * 50 / 50));
  // Off by default in the tracker; the purge (when switched on) includes it.
  assert.equal(DISC.DISCOVERY_KINDS.sample.feature, 'niche-sample');
  assert.equal(s.purgeApiData(t + 40 * DAY, 30).sample_stats > 0, true);
});

test('niche sample: viewsAt interpolates between close readings only', () => {
  const D = createRequire(import.meta.url)('../src/discovery.js');
  const rows = [{ ts: 0, views: 0 }, { ts: DAY, views: 100 }, { ts: 6 * DAY, views: 600 }];
  assert.equal(D.viewsAt(rows, 12 * H), 50);
  assert.equal(D.viewsAt(rows, 3 * DAY), null, 'readings 5 days apart: unknown');
  assert.equal(D.viewsAt(rows, 6 * DAY + 6 * H), 600, 'within 12 h of the last reading');
  assert.equal(D.viewsAt([], DAY), null);
});

test('niche sample: one search per length (medium, long, short by default), the audio language kept, the report filtered to it', async () => {
  const s = store();
  s.db.prepare("INSERT INTO tracked_channels (channel_id, account_id, niche, mine, added_at, active) VALUES (?, 'yt/x', 'Excel', 0, ?, 1)").run(uc('tracked'), NOW);
  DISC.saveRadarSettings(s, { sampleTerms: { Excel: ['excel'] } });
  assert.deepEqual(DISC.radarSettings(s).sampleDurations, ['medium', 'long', 'short'], 'long-form and short by default');
  DISC.saveRadarSettings(s, { sampleTerms: { Excel: ['excel'] }, sampleDurations: ['medium', 'long'] });
  const found = [
    { id: 'lngEn000001', ch: uc('a'), title: 'Excel dashboard', pub: NOW - H, lang: 'en-US' },
    { id: 'lngHi000001', ch: uc('b'), title: 'Excel dashboard (Hindi, title tagged en)', pub: NOW - H, lang: 'hi' },
    { id: 'lngEn000002', ch: uc('c'), title: 'Excel budget', pub: NOW - 2 * H, lang: 'en' }
  ];
  const fx = sampleFetch({ found, views: () => 50 });
  const q = quotaCtx();
  const r = await DISC.DISCOVERY_KINDS.sample.run({ store: s, now: NOW, apiKey: KEY, fetch: fx.fetch, quota: q });
  const searches = fx.calls.filter((u) => u.includes('/search?')).map((u) => new URL(u).searchParams.get('videoDuration'));
  assert.deepEqual(searches, ['medium', 'long']);
  assert.equal(q.used, 2 * 100 + 1 + 1);
  assert.deepEqual(r.data.runs[0].durations, ['medium', 'long']);
  assert.deepEqual(s.db.prepare('SELECT video_id, search, lang FROM sample_videos ORDER BY video_id').all().map((x) => ({ ...x })), [
    { video_id: 'lngEn000001', search: 'medium', lang: 'en-US' }, { video_id: 'lngEn000002', search: 'medium', lang: 'en' }, { video_id: 'lngHi000001', search: 'medium', lang: 'hi' }
  ], 'the first search found them all (the fake answers once); the audio language, not the title language');
  // An older 'any' row stays out of the default report.
  s.db.prepare("INSERT INTO sample_videos (video_id, channel_id, niche, term, search, published_at, found_at, lang) VALUES ('oldAny00001', ?, 'Excel', 'excel', 'any', ?, ?, 'en')").run(uc('d'), NOW - 2 * H, NOW);
  const p = DISC.samplePage(s, { niche: 'Excel', now: NOW + 2 * DAY });
  DISC.saveRadarSettings(s, { sampleTerms: { Excel: ['excel'] } });
  assert.equal(DISC.samplePage(s, { niche: 'Excel', now: NOW + 2 * DAY }).cost.search, 300, 'with short: three searches a day');
  assert.deepEqual([p.filter.lang, p.filter.kept, p.filter.total, p.filter.other_searches, p.filter.other_lang], ['en', 2, 4, 1, 1]);
  assert.equal(p.videos, 2);
  assert.deepEqual(p.filter.languages[0], { lang: 'en', videos: 3 });
  assert.equal(DISC.samplePage(s, { niche: 'Excel', lang: 'all', now: NOW + 2 * DAY }).videos, 3);
  assert.equal(DISC.samplePage(s, { niche: 'Excel', lang: 'all', searches: ['any', 'medium', 'long'], now: NOW + 2 * DAY }).videos, 4);
  assert.equal(p.cost.search, 200, 'two searches a day');
  assert.equal(p.cost.total_steady, 200 + 2 * Math.ceil(31 * 100 / 50));
});
