// Own-channel history (phase 2, docs/youtube-niche-plan.md 3): one token per channel and the
// move from the old single token file, re-consent for the revenue scope, the Analytics
// backfill in chunks, the daily / per-video / weekly jobs over a simulated Google
// (dev/own-sim.mjs), revenue and refusals, and the page / tool queries. Nothing talks to Google.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const home = mkdtempSync(join(tmpdir(), 'openoutlier-own-'));
process.env.OPENOUTLIER_HOME = home;
for (const k of ['OPENOUTLIER_YOUTUBE_CLIENT_ID', 'OPENOUTLIER_YOUTUBE_CLIENT_SECRET']) delete process.env[k];
const here = dirname(fileURLToPath(import.meta.url));
const YA = await import('../mcp/youtube-analytics.mjs');
const OWN = await import('../mcp/own-history.mjs');
const { Store } = await import('../mcp/store.mjs');
const { Tracker } = await import('../mcp/tracker.mjs');
const SIM = await import('../dev/own-sim.mjs');
const F = createRequire(import.meta.url)('../src/features.js');
const fixture = (n) => JSON.parse(readFileSync(join(here, '..', 'dev', 'youtube', 'own', 'fixtures', n), 'utf8'));

const NOW = Date.UTC(2026, 10, 21, 15, 0, 0); // Sat 21 Nov 2026, 07:00 in California
const CLIENT = { installed: { client_id: '1234-abc.apps.googleusercontent.com', client_secret: 'GOCSPX-test' } };
writeFileSync(YA.CONFIG_FILE, JSON.stringify(CLIENT));
const freshStore = () => new Store(mkdtempSync(join(tmpdir(), 'openoutlier-own-db-')));
async function rmTokens() { const { rm } = await import('node:fs/promises'); for (const f of readdirSync(home)) if (/^youtube-token/.test(f)) await rm(join(home, f)); }
const ctxOf = (store, google, extra = {}) => ({ store, now: NOW, fetch: google.fetch, flags: F.resolve(null), log: () => {}, ...extra });

// ---- fixtures: what Analytics answers, and how we read it -----------------------------
test('fixtures: day series, video day series, breakdowns, revenue and the refusals map to our fields and error codes', async () => {
  const day = YA.rowsOf(fixture('day-series.json'));
  assert.equal(day.length, 3);
  const f = OWN.dailyFields(day[0]);
  assert.deepEqual(f, { views: 132, engaged: 117, minutes: 412.5, avg_dur: 187, avg_pct: 41.2, subs_gained: 3, subs_lost: 1, likes: 5, comments: 1, shares: 2 });
  assert.deepEqual(OWN.reachFields(YA.rowsOf(fixture('day-reach.json'))[0]), { impressions: 2900, ctr: 0.0455 });
  const vday = YA.rowsOf(fixture('video-day-series.json'));
  assert.equal(vday[0].day, '2026-11-19');
  assert.equal(vday[1].views, 31);
  const rev = OWN.revenueFields(YA.rowsOf(fixture('revenue.json'))[1]);
  assert.equal(rev.revenue, 4.21);
  assert.equal(rev.monetized_playbacks, 610);
  const terms = YA.rowsOf(fixture('breakdown-search-terms.json'));
  assert.equal(terms[0].insightTrafficSourceDetail, 'excel pivot table');
  const ag = YA.rowsOf(fixture('breakdown-age-gender.json'));
  assert.equal(ag.reduce((s, r) => s + r.viewerPercentage, 0), 100);
  // Refusals: a bridge-level fetch answers with the fixture; apiGet maps them.
  const answer = (status, body) => async () => ({ ok: false, status, json: async () => body });
  const call = (status, body) => YA.apiGet('https://youtubeanalytics.googleapis.com/v2/reports?x', { accessToken: 'at', fetch: answer(status, body) });
  await assert.rejects(call(403, fixture('error-insufficient-permissions.json')), (e) => e.code === 'forbidden' && /Insufficient permission/.test(e.message));
  await assert.rejects(call(403, fixture('error-not-monetized.json')), (e) => e.code === 'forbidden');
  await assert.rejects(call(400, fixture('error-bad-query.json')), (e) => e.code === 'bad_query');
  await assert.rejects(call(403, fixture('error-quota.json')), (e) => e.code === 'quota');
});

// ---- tokens ---------------------------------------------------------------------------------
test('multi-token migration: the old youtube-token.json moves to youtube-token-<UC…>.json without breaking the connection', async () => {
  await rmTokens();
  const old = { refresh_token: 'rt-old', access_token: 'at-old', expires_at: NOW + 3600e3, scope: YA.ANALYTICS_SCOPE + ' ' + YA.YOUTUBE_SCOPE, connected_at: '2026-10-01T10:00:00.000Z',
    channel: { channel_id: 'UCsimhandsonexcelxxxxxxx', title: 'Hands on Excel', handle: 'handsonexcel', account: 'yt/handsonexcel' } };
  writeFileSync(YA.LEGACY_TOKEN_FILE, JSON.stringify(old), { mode: 0o600 });
  const tokens = await YA.listTokens();
  assert.equal(tokens.length, 1);
  assert.ok(!existsSync(YA.LEGACY_TOKEN_FILE), 'the old file is gone');
  const file = YA.tokenFile('UCsimhandsonexcelxxxxxxx');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).refresh_token, 'rt-old');
  // Still connected, and the same access token is used (no new sign-in).
  assert.equal(await YA.accessToken({ now: NOW }), 'at-old');
  const st = await YA.status();
  assert.equal(st.connected, true);
  assert.equal(st.channels.length, 1);
  assert.equal(st.channels[0].needs_reconsent, true, 'a pre-phase-2 sign-in lacks the revenue scope');
  assert.equal(st.needs_reconsent, true);
  // Running it again changes nothing.
  assert.equal(await YA.migrateLegacyToken(), false);
  assert.equal((await YA.listTokens()).length, 1);

  // An old file whose channel was never looked up keeps working as it is, then is adopted.
  await rmTokens();
  writeFileSync(YA.LEGACY_TOKEN_FILE, JSON.stringify({ ...old, channel: undefined, access_token: 'at-UCsimhandsonexcelxxxxxxx' }), { mode: 0o600 });
  const t2 = await YA.listTokens();
  assert.equal(t2.length, 1);
  assert.equal(t2[0].legacy, true);
  assert.ok(existsSync(YA.LEGACY_TOKEN_FILE));
  const ch = SIM.simChannel(SIM.SPECS.handsonexcel, NOW);
  const g = SIM.fakeGoogle({ [ch.spec.id]: ch });
  assert.equal(await YA.adoptLegacyToken({ fetch: g.fetch, now: NOW }), true);
  assert.ok(!existsSync(YA.LEGACY_TOKEN_FILE));
  assert.equal((await YA.readToken()).channel.title, 'Hands on Excel');
});

test('a sign-in whose channel lookup fails waits in a pending file, never on top of another channel\'s old token; the next lookup adopts both (review A7)', async () => {
  await rmTokens();
  const a = SIM.simChannel(SIM.SPECS.handsonexcel, NOW);
  const b = SIM.simChannel(SIM.SPECS.quran, NOW);
  const g = SIM.fakeGoogle({ [a.spec.id]: a, [b.spec.id]: b });
  // Channel A: an old single-file sign-in whose channel was never looked up.
  const oldA = { refresh_token: 'rt-' + a.spec.id, access_token: 'at-' + a.spec.id, expires_at: NOW + 3600e3, scope: YA.ANALYTICS_SCOPE + ' ' + YA.YOUTUBE_SCOPE, connected_at: '2026-10-01T10:00:00.000Z' };
  writeFileSync(YA.LEGACY_TOKEN_FILE, JSON.stringify(oldA), { mode: 0o600 });
  // Channel B signs in; Google's channels.list fails right then.
  const r = await YA.beginConnect({ port: 47999, now: NOW });
  const state = new URL(r.url).searchParams.get('state');
  const flaky = async (url, init) => (String(url).includes('/youtube/v3/channels') ? { ok: false, status: 503, json: async () => ({ error: { code: 503, message: 'backend error' } }) } : g.fetch(url, init));
  const done = await YA.finishConnect(new URLSearchParams({ code: 'code-' + b.spec.id, state }), { fetch: flaky, now: NOW + 1000 });
  assert.equal(done.ok, true);
  assert.equal(done.channel, null);
  assert.equal(JSON.parse(readFileSync(YA.LEGACY_TOKEN_FILE, 'utf8')).refresh_token, oldA.refresh_token, 'channel A\'s old token is untouched');
  const pending = readdirSync(home).filter((f) => /^youtube-token-pending-[a-f0-9]+\.json$/.test(f));
  assert.equal(pending.length, 1);
  assert.equal(statSync(join(home, pending[0])).mode & 0o777, 0o600);
  const listed = await YA.listTokens();
  assert.equal(listed.length, 2, 'both sign-ins are listed');
  assert.ok(listed.every((t) => t.legacy && t.file));
  assert.ok((await YA.status()).channels.every((c) => c.pending_lookup));
  // Using the pending token refreshes it in place (not into youtube-token.json).
  assert.equal(await YA.accessToken({ file: join(home, pending[0]), now: NOW + 7200e3, fetch: g.fetch }), 'at-' + b.spec.id);
  assert.equal(JSON.parse(readFileSync(YA.LEGACY_TOKEN_FILE, 'utf8')).refresh_token, oldA.refresh_token);
  // The next successful lookup (the own-channels job) moves each to its channel's file.
  assert.equal(await YA.adoptLegacyToken({ fetch: g.fetch, now: NOW + 2000 }), true);
  assert.ok(!existsSync(YA.LEGACY_TOKEN_FILE));
  assert.equal(readdirSync(home).filter((f) => /pending/.test(f)).length, 0);
  assert.equal(JSON.parse(readFileSync(YA.tokenFile(a.spec.id), 'utf8')).refresh_token, 'rt-' + a.spec.id);
  assert.equal(JSON.parse(readFileSync(YA.tokenFile(b.spec.id), 'utf8')).refresh_token, 'rt-' + b.spec.id);
  assert.deepEqual((await YA.listTokens()).map((t) => t.channel.channel_id).sort(), [a.spec.id, b.spec.id].sort());
  assert.equal(await YA.adoptLegacyToken({ fetch: g.fetch, now: NOW + 3000 }), false, 'nothing left to adopt');
});

test('two channels: add with another Google account, pick by id / @handle / name, default = first connected; reconnect keeps the order; disconnect one', async () => {
  await rmTokens();
  const a = SIM.simChannel(SIM.SPECS.handsonexcel, NOW);
  const b = SIM.simChannel(SIM.SPECS.quran, NOW);
  const g = SIM.fakeGoogle({ [a.spec.id]: a, [b.spec.id]: b });
  const connect = async (id, at, channel) => {
    const r = await YA.beginConnect({ port: 47999, now: at, channel });
    const u = new URL(r.url);
    assert.match(u.searchParams.get('prompt'), /select_account/, 'Google lets the user pick the account');
    assert.ok(u.searchParams.get('scope').split(' ').includes(YA.MONETARY_SCOPE), 'the revenue scope is asked for');
    return YA.finishConnect(new URLSearchParams({ code: 'code-' + id, state: u.searchParams.get('state') }), { fetch: g.fetch, now: at + 1000 });
  };
  const r1 = await connect(a.spec.id, NOW - 5 * 864e5);
  assert.equal(r1.ok, true);
  assert.equal(r1.added, true);
  const r2 = await connect(b.spec.id, NOW - 864e5);
  assert.equal(r2.ok, true);
  assert.equal(r2.channel.title, 'Quran Recitations (demo)');
  assert.ok(existsSync(YA.tokenFile(a.spec.id)) && existsSync(YA.tokenFile(b.spec.id)));
  let st = await YA.status();
  assert.deepEqual(st.channels.map((c) => [c.title, c.primary, c.needs_reconsent]), [['Hands on Excel', true, false], ['Quran Recitations (demo)', false, false]]);
  assert.equal((await YA.readToken()).channel.channel_id, a.spec.id);
  assert.equal((await YA.readToken('@quranrecitationsdemo')).channel.channel_id, b.spec.id);
  assert.equal((await YA.readToken('quran')).channel.channel_id, b.spec.id);
  assert.equal((await YA.readToken(b.spec.id)).channel.channel_id, b.spec.id);
  await assert.rejects(YA.readToken('nope nope'), (e) => e.code === 'unknown_channel');
  // Reports go out with that channel's token.
  await YA.channelReport({ fetch: g.fetch, now: NOW, channel: 'quran' });
  assert.match(g.calls[g.calls.length - 1].init.headers.authorization, new RegExp(b.spec.id));
  // Reconnecting the first channel keeps it first.
  const r3 = await connect(a.spec.id, NOW, a.spec.id);
  assert.equal(r3.reconnected, true);
  st = await YA.status();
  assert.equal(st.channels[0].channel_id, a.spec.id);
  // A revoked sign-in is marked for the page, per channel.
  const revoked = SIM.fakeGoogle({ [a.spec.id]: a, [b.spec.id]: b }, { revoked: { [b.spec.id]: true } });
  await assert.rejects(YA.channelReport({ fetch: revoked.fetch, now: NOW + 2 * 3600e3, channel: b.spec.id }), (e) => e.code === 'reconnect' && /Quran/.test(e.message));
  st = await YA.status();
  assert.deepEqual(st.channels.map((c) => c.reconnect), [false, true]);
  // Disconnect one: the other stays.
  const d = await YA.disconnect({ fetch: g.fetch, channel: b.spec.id });
  assert.equal(d.disconnected, b.spec.id);
  assert.equal(d.connected, true);
  assert.ok(!existsSync(YA.tokenFile(b.spec.id)));
  assert.equal((await YA.status()).channels.length, 1);
});

// ---- collection -----------------------------------------------------------------------------
test('backfill chunking: newest first, contiguous, no overlap, CHUNK_DAYS each, down to the channel\'s first day', async () => {
  assert.deepEqual(OWN.chunks('2025-01-01', '2025-12-31', 180), [['2025-07-05', '2025-12-31'], ['2025-01-06', '2025-07-04'], ['2025-01-01', '2025-01-05']]);
  assert.deepEqual(OWN.chunks('2025-03-01', '2025-03-01', 180), [['2025-03-01', '2025-03-01']]);
  assert.deepEqual(OWN.chunks('2025-03-02', '2025-03-01'), []);

  await rmTokens();
  const ch = SIM.simChannel(SIM.SPECS.excelbugs, NOW);
  writeFileSync(YA.tokenFile(ch.spec.id), JSON.stringify(SIM.tokenFor(ch, { connectedAt: '2026-11-01T00:00:00Z' })), { mode: 0o600 });
  const asked = [];
  const g = SIM.fakeGoogle({ [ch.spec.id]: ch }, { onReport: (q) => { if (q.get('dimensions') === 'day' && !q.get('filters') && q.get('metrics').includes('subscribersLost')) asked.push([q.get('startDate'), q.get('endDate')]); } });
  const s = freshStore();
  let t = NOW;
  const tr = new Tracker({ store: s, now: () => t, random: () => 0, fetch: g.fetch, apiKey: () => null, ctx: { chunksPerRun: 2 } });
  tr.seed();
  assert.ok(tr.job('own-channels'), 'seeded once an OAuth client exists');
  await tr.tick(); // own-channels → jobs; same tick: nothing else due yet (created this tick)
  assert.ok(tr.job('own-backfill:' + ch.spec.id));
  for (let i = 0; i < 10 && tr.job('own-backfill:' + ch.spec.id); i++) {
    t += 61_000;
    await tr.tick();
  }
  const row = s.db.prepare('SELECT * FROM own_channels WHERE channel_id = ?').get(ch.spec.id);
  assert.equal(row.backfill_done, 1);
  assert.equal(row.backfill_from, '2024-06-01');
  // Each request ≤ 180 days, newest first, joined end to end, from today back to the first day.
  const back = asked.filter((x) => !(x[0] === SIM.addDays(OWN.today(NOW), -OWN.REFETCH_DAYS) && x[1] === OWN.today(NOW))); // not the daily job's refetch
  assert.equal(back.length, 6);
  for (const [s1, e1] of back) assert.ok((Date.parse(e1) - Date.parse(s1)) / 864e5 <= OWN.CHUNK_DAYS - 1, `${s1}…${e1}`);
  assert.equal(back[0][1], OWN.today(NOW));
  for (let i = 1; i < back.length; i++) assert.equal(SIM.addDays(back[i][1], 1), back[i - 1][0]);
  assert.equal(back[back.length - 1][0], '2024-06-01');
  const days = s.db.prepare('SELECT COUNT(*) AS n, MIN(day) AS lo, MAX(day) AS hi FROM own_daily WHERE channel_id = ?').get(ch.spec.id);
  assert.equal(days.lo, '2024-06-01');
  assert.equal(days.hi, SIM.addDays(OWN.today(NOW), -2), 'Analytics lags two days');
  assert.equal(days.n, SIM.addDays(OWN.today(NOW), -2) === days.hi ? (Date.parse(days.hi) - Date.parse(days.lo)) / 864e5 + 1 : -1);
  const one = JSON.parse(s.db.prepare('SELECT metric FROM own_daily WHERE channel_id = ? AND day = ?').get(ch.spec.id, '2026-10-01').metric);
  const sim = ch.dayRow('2026-10-01');
  assert.equal(one.views, sim.views);
  assert.equal(one.subs_gained, sim.subs_gained);
  assert.ok(one.impressions > 0 && one.ctr > 0.02 && one.ctr < 0.08, 'thumbnail reach by day');
  assert.equal(one.shorts_views + one.long_views, sim.views, 'Shorts / long-form split');
  assert.equal(row.revenue_state, 'not_monetized', 'Google refuses monetary reports outside the YPP');
  s.close();
});

test('daily job: the last 7 days again (corrections win), the subscriber count, milestones (the first time all count as shown)', async () => {
  await rmTokens();
  const ch = SIM.simChannel(SIM.SPECS.excelbugs, NOW);
  writeFileSync(YA.tokenFile(ch.spec.id), JSON.stringify(SIM.tokenFor(ch, { connectedAt: '2026-11-01T00:00:00Z' })), { mode: 0o600 });
  const g = SIM.fakeGoogle({ [ch.spec.id]: ch });
  const s = freshStore();
  s.db.prepare('INSERT INTO own_channels (channel_id, title, created, connected_at, active) VALUES (?, ?, ?, ?, 1)').run(ch.spec.id, ch.spec.title, ch.created, NOW);
  // A stale value Analytics has corrected since.
  s.db.prepare('INSERT INTO own_daily (channel_id, day, metric, updated_at) VALUES (?, ?, ?, ?)').run(ch.spec.id, SIM.addDays(OWN.today(NOW), -4), JSON.stringify({ views: 1, note: 'kept' }), 1);
  const ctx = ctxOf(s, g);
  const r = await OWN.dailyJob(ctx, { id: 'own-daily:' + ch.spec.id, channel_id: ch.spec.id });
  assert.ok(r.data.days >= 5);
  const fixed = JSON.parse(s.db.prepare('SELECT metric FROM own_daily WHERE channel_id = ? AND day = ?').get(ch.spec.id, SIM.addDays(OWN.today(NOW), -4)).metric);
  assert.equal(fixed.views, ch.dayRow(SIM.addDays(OWN.today(NOW), -4)).views);
  assert.equal(fixed.note, 'kept', 'fields Analytics doesn\'t send stay');
  const row = s.db.prepare('SELECT * FROM own_channels WHERE channel_id = ?').get(ch.spec.id);
  assert.equal(row.subs, ch.subsTotal());
  assert.ok(row.last_daily_at === NOW);
  assert.ok(s.db.prepare('SELECT COUNT(*) AS n FROM own_milestones WHERE channel_id = ?').get(ch.spec.id).n > 0);
  assert.deepEqual(OWN.pendingMilestones(s, NOW), [], 'existing milestones are not announced');
  // A new one later is.
  s.db.prepare('UPDATE own_channels SET subs = 1000 WHERE channel_id = ?').run(ch.spec.id);
  assert.equal(OWN.recordMilestones(s, ch.spec.id, NOW + 1), 1);
  const p = OWN.pendingMilestones(s, NOW + 2);
  assert.deepEqual(p.map((m) => m.key), ['subs:1000']);
  assert.equal(OWN.ackMilestones(s, p, NOW + 3), 1);
  assert.deepEqual(OWN.pendingMilestones(s, NOW + 4), []);
  // Its schedule: around 06:00 local time.
  const next = new Date(NOW + OWN.OWN_KINDS['own-daily'].every(null, NOW));
  assert.equal(next.getHours(), 6);
  assert.equal(next.getMinutes(), 0);
  assert.ok(next.getTime() > NOW && next.getTime() - NOW <= 864e5);
  s.close();
});

test('revenue: the scope missing → needs_scope (no request); monetized → revenue, RPM, CPM; not monetized → refused politely; reach / content type unsupported → the rest still stored', async () => {
  await rmTokens();
  const m = SIM.simChannel(SIM.SPECS.sheetsensei, NOW);
  const e = SIM.simChannel(SIM.SPECS.excelbugs, NOW);
  writeFileSync(YA.tokenFile(m.spec.id), JSON.stringify(SIM.tokenFor(m, { connectedAt: '2026-01-01T00:00:00Z' })), { mode: 0o600 });
  writeFileSync(YA.tokenFile(e.spec.id), JSON.stringify(SIM.tokenFor(e, { connectedAt: '2026-02-01T00:00:00Z', monetary: false })), { mode: 0o600 });
  const revAsks = [];
  const g = SIM.fakeGoogle({ [m.spec.id]: m, [e.spec.id]: e }, { monetary: { [e.spec.id]: false }, noReach: true, noContentType: true, onReport: (q, id) => { if (q.get('metrics').includes('estimatedRevenue')) revAsks.push(id); } });
  const s = freshStore();
  for (const c of [m, e]) s.db.prepare('INSERT INTO own_channels (channel_id, title, created, connected_at, active) VALUES (?, ?, ?, ?, 1)').run(c.spec.id, c.spec.title, c.created, NOW);
  const ctx = ctxOf(s, g);
  const from = SIM.addDays(OWN.today(NOW), -60);
  const rm = await OWN.fetchDays(ctx, m.spec.id, from, OWN.today(NOW));
  assert.equal(rm.revenue, 'ok');
  assert.equal(rm.reach, 'unsupported');
  assert.equal(rm.ct, 'unsupported');
  const re = await OWN.fetchDays(ctx, e.spec.id, from, OWN.today(NOW));
  assert.equal(re.revenue, 'needs_scope');
  assert.deepEqual(revAsks, [m.spec.id], 'no revenue request without the scope');
  const day = SIM.addDays(OWN.today(NOW), -10);
  const row = JSON.parse(s.db.prepare('SELECT metric FROM own_daily WHERE channel_id = ? AND day = ?').get(m.spec.id, day).metric);
  assert.ok(row.revenue > 0 && row.cpm > 0 && row.monetized_playbacks > 0);
  assert.equal(row.impressions, undefined, 'no reach for this channel');
  assert.ok(row.views > 0, 'the main metrics are there anyway');
  const ch = OWN.ownChannels(s).find((c) => c.channel_id === m.spec.id);
  assert.equal(ch.reach_state, 'unsupported');
  // A later reach refusal for old dates doesn't undo a working state.
  s.db.prepare("UPDATE own_channels SET reach_state = 'ok' WHERE channel_id = ?").run(e.spec.id);
  await OWN.fetchDays(ctx, e.spec.id, '2024-07-01', '2024-07-10');
  assert.equal(OWN.ownChannels(s).find((c) => c.channel_id === e.spec.id).reach_state, 'ok');
  // The page: revenue card numbers (RPM = revenue ÷ views × 1000) and the YPP state.
  const page = OWN.ownPage(s, { channel: m.spec.id, now: NOW }).page;
  assert.equal(page.revenue.state, 'ok');
  assert.ok(page.revenue.d28.revenue > 0);
  const end = page.data_through;
  const rows = OWN.dailyRows(s, m.spec.id).filter((r) => r.d > SIM.addDays(end, -28) && r.d <= end);
  const rev = rows.reduce((a, r) => a + r.revenue, 0);
  const views = rows.reduce((a, r) => a + r.views, 0);
  assert.ok(Math.abs(page.revenue.d28.rpm - rev / views * 1000) < 0.02);
  assert.equal(page.ypp.in_ypp, true);
  assert.equal(OWN.ownPage(s, { channel: e.spec.id, now: NOW }).page.revenue.state, 'needs_scope');
  s.close();
});

test('videos and weekly jobs: per-video daily rows of the last 90 days\' uploads, the report card, search terms week over week, audience', async () => {
  await rmTokens();
  const ch = SIM.simChannel(SIM.SPECS.excelbugs, NOW);
  writeFileSync(YA.tokenFile(ch.spec.id), JSON.stringify(SIM.tokenFor(ch, { connectedAt: '2026-11-01T00:00:00Z' })), { mode: 0o600 });
  const g = SIM.fakeGoogle({ [ch.spec.id]: ch });
  const s = freshStore();
  s.db.prepare('INSERT INTO own_channels (channel_id, title, created, connected_at, subs, active) VALUES (?, ?, ?, ?, ?, 1)').run(ch.spec.id, ch.spec.title, ch.created, NOW, ch.subsTotal());
  const ctx = ctxOf(s, g);
  const v = await OWN.videosJob(ctx, { id: 'own-videos:' + ch.spec.id, channel_id: ch.spec.id });
  const recent = ch.videos.filter((x) => x.published >= NOW - 90 * 864e5);
  assert.equal(v.data.videos, recent.length);
  const own = s.db.prepare('SELECT * FROM own_videos WHERE channel_id = ?').all(ch.spec.id);
  assert.equal(own.length, recent.length);
  assert.ok(own.some((x) => x.type === 'short') && own.some((x) => x.type === 'video'), 'formats from the length');
  const card = OWN.reportCard(s, ch.spec.id, { now: NOW, limit: 100 });
  const old = card.videos.find((x) => x.published_at < NOW - 40 * 864e5);
  const sim = recent.find((x) => x.id === old.id);
  const pub = OWN.today(sim.published);
  const sum = (n) => { let t = 0; for (let i = 0; i < n; i++) t += ch.viewsOn(sim, SIM.addDays(pub, i)); return t; };
  assert.equal(old.cp[48].v, sum(2));
  assert.equal(old.cp[168].v, sum(7));
  assert.equal(old.cp[720].v, sum(30));
  const young = card.videos.find((x) => x.published_at > NOW - 3 * 864e5);
  if (young) assert.ok(young.pending[720] && !young.cp[720], 'a 2-day-old video\'s 30 days are pending');
  assert.ok(card.channel_median.long[48] > 0);
  assert.ok(Object.keys(old.vs_channel).length > 0);
  assert.equal(card.niche, null, 'not a tracked channel: no niche medians');
  // A second run only asks for the last 7 days.
  const asks = [];
  const g2 = SIM.fakeGoogle({ [ch.spec.id]: ch }, { onReport: (q) => { if ((q.get('filters') || '').startsWith('video==')) asks.push(q.get('startDate')); } });
  await OWN.videosJob(ctxOf(s, g2), { id: 'own-videos:' + ch.spec.id, channel_id: ch.spec.id });
  assert.ok(asks.every((d) => d >= SIM.addDays(OWN.today(NOW), -7)));

  const w = await OWN.weeklyJob(ctx, { id: 'own-weekly:' + ch.spec.id, channel_id: ch.spec.id });
  assert.equal(w.data.weeks, OWN.BREAKDOWN_WEEKS);
  const weeks = OWN.completeWeeks(NOW, 2);
  assert.equal(weeks[0], '2026-11-09', 'the last complete Analytics week (Mon–Sun before today)');
  const st = OWN.searchTerms(s, ch.spec.id);
  assert.equal(st.latest_week, '2026-11-09');
  assert.equal(st.prev_week, '2026-11-02');
  assert.ok(st.terms.length >= 6);
  const top = st.terms[0];
  assert.equal(top.change, top.last_week - top.prev_week);
  assert.equal(top.series.length, st.weeks.length);
  assert.ok(st.terms.some((t) => t.is_new), 'terms that only showed up in the last weeks are new');
  const au = OWN.audience(s, ch.spec.id);
  assert.equal(au.traffic.rows[0].key, 'YT_SEARCH');
  assert.ok(Math.abs(au.traffic.rows.reduce((a, r) => a + r.share, 0) - 1) < 0.01);
  assert.equal(au.countries.rows[0].key, 'US');
  assert.ok(Math.abs(Object.values(au.age_gender.by_age).reduce((a, x) => a + x, 0) - 100) < 1);
  assert.ok(au.age_gender.by_gender.male > au.age_gender.by_gender.female);
  // Already fetched and settled: the next run fetches nothing new.
  const again = await OWN.weeklyJob({ ...ctx, now: NOW + 864e5 }, { id: 'own-weekly:' + ch.spec.id, channel_id: ch.spec.id });
  assert.ok(again.data.weeks <= 2);
  s.close();
});

test('a disconnected channel: its jobs go, its data stays; the page and tools still show it by name', async () => {
  await rmTokens();
  const a = SIM.simChannel(SIM.SPECS.handsonexcel, NOW);
  const b = SIM.simChannel(SIM.SPECS.quran, NOW);
  writeFileSync(YA.tokenFile(a.spec.id), JSON.stringify(SIM.tokenFor(a, { connectedAt: '2026-10-01T00:00:00Z' })), { mode: 0o600 });
  writeFileSync(YA.tokenFile(b.spec.id), JSON.stringify(SIM.tokenFor(b, { connectedAt: '2026-11-01T00:00:00Z' })), { mode: 0o600 });
  const g = SIM.fakeGoogle({ [a.spec.id]: a, [b.spec.id]: b });
  const s = freshStore();
  let t = NOW;
  const tr = new Tracker({ store: s, now: () => t, random: () => 0, fetch: g.fetch, apiKey: () => null, ctx: { chunksPerRun: 20 } });
  tr.seed();
  await tr.tick();
  t = NOW + 5 * 60e3;
  await tr.tick();
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM tracker_jobs WHERE id LIKE 'own-%:' || ?").get(b.spec.id).n >= 3, true);
  const page = OWN.ownPage(s, { now: NOW + 6 * 60e3 });
  assert.equal(page.channel, a.spec.id, 'the first connected is the default');
  assert.equal(page.channels.length, 2);
  const all = OWN.ownPage(s, { channel: 'all', now: NOW + 6 * 60e3 });
  assert.equal(all.page.combined, true);
  assert.equal(all.page.per_channel.length, 2);
  assert.equal(all.page.totals.subs, a.subsTotal() + b.subsTotal());
  const lastA = OWN.dailyRows(s, a.spec.id).find((r) => r.d === all.page.data_through);
  const lastB = OWN.dailyRows(s, b.spec.id).find((r) => r.d === all.page.data_through);
  assert.equal(all.page.daily[all.page.daily.length - 1].views, lastA.views + lastB.views, 'combined days add up');
  // Disconnect b (token gone): the next own-channels run drops its jobs and keeps its rows.
  await YA.disconnect({ fetch: g.fetch, channel: b.spec.id });
  const before = s.db.prepare('SELECT COUNT(*) AS n FROM own_daily WHERE channel_id = ?').get(b.spec.id).n;
  s.db.prepare("UPDATE tracker_jobs SET next_at = 0 WHERE id = 'own-channels'").run();
  t = NOW + 7 * 60e3;
  await tr.tick();
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM tracker_jobs WHERE id LIKE 'own-%:' || ?").get(b.spec.id).n, 0);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM own_daily WHERE channel_id = ?').get(b.spec.id).n, before);
  assert.equal(OWN.ownPage(s, { now: NOW }).channels.length, 1);
  assert.equal(OWN.channelHistory(s, { channel: 'quran', days: 30, now: NOW }).channel, 'Quran Recitations (demo)', 'kept data stays reachable by name');
  s.close();
});

test('page and tool queries on a tiny new channel: no division by zero, "collecting" answers, pending report card', async () => {
  await rmTokens();
  const ch = SIM.simChannel(SIM.SPECS.tinynew, NOW);
  writeFileSync(YA.tokenFile(ch.spec.id), JSON.stringify(SIM.tokenFor(ch, { connectedAt: '2026-11-20T00:00:00Z' })), { mode: 0o600 });
  const g = SIM.fakeGoogle({ [ch.spec.id]: ch });
  const s = freshStore();
  // Just connected: listed as pending, no page yet.
  const st = await YA.status();
  const empty = OWN.ownPage(s, { now: NOW, status: st });
  assert.equal(empty.page, null);
  assert.equal(empty.channels[0].pending, true);
  assert.deepEqual(OWN.channelHistory(s, {}), { error: 'No channel history yet.', hint: OWN.channelHistory(s, {}).hint });
  let t = NOW;
  const tr = new Tracker({ store: s, now: () => t, random: () => 0, fetch: g.fetch, apiKey: () => null });
  tr.seed();
  await tr.tick();
  t = NOW + 5 * 60e3;
  await tr.tick();
  const p = OWN.ownPage(s, { now: NOW + 6 * 60e3, status: st }).page;
  assert.ok(p.history_days >= 6 && p.history_days <= 8, String(p.history_days));
  assert.equal(p.compare[28].covered, false);
  assert.equal(p.compare[28].views.pct, null, 'no "+∞ %" for a new channel');
  assert.equal(p.ypp.enough_history, false);
  assert.equal(p.ypp.eta_days, null);
  assert.equal(p.ypp.subs.current, 1);
  assert.equal(p.milestones.next[0].key, 'subs:10');
  assert.ok(p.report.videos.length >= 1);
  assert.ok(p.report.videos.some((v) => v.pending[720]));
  assert.equal(p.realtime.tracked, false);
  const y = OWN.yppProgress(s, { now: NOW + 6 * 60e3 });
  assert.equal(y.subs.target, 1000);
  assert.match(y.requirements, /4,000/);
  s.close();
});
