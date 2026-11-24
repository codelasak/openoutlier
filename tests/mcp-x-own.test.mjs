// X Phase 2 on the bridge (docs/x-plan.md 3.4 and section 7): migration 9 (x_own_daily, x_post_stats),
// POST /x/own/daily from the extension, the /sync hook that keeps every post measurement, and the
// queries behind my_x_account, my_x_progress, x_patterns and the first-hours curve. Nothing talks to X.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const home = mkdtempSync(join(tmpdir(), 'openoutlier-xown-'));
process.env.OPENOUTLIER_HOME = home;
const here = dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);
const XS = req('../src/x.js');
const O = req('../src/x-own.js');
const { Store, SCHEMA_VERSION } = await import('../mcp/store.mjs');
const XOWN = await import('../mcp/x-own.mjs');

const dir = join(here, '..', 'dev', 'x');
const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
const NOW = meta.now;
const DAY = 864e5;
const H = 36e5;
const OWN = 'x/excelbugs_demo';
const freshStore = () => new Store(mkdtempSync(join(tmpdir(), 'openoutlier-xown-db-')));

function fixtureAccounts() {
  const acc = {};
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json') && n !== 'meta.json')) {
    for (const pg of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
      const r = XS.parsePayload(pg.url, JSON.stringify(pg.body));
      if (!r) continue;
      for (const p of r.posts) {
        const a = acc[p.owner] || (acc[p.owner] = { posts: {}, updatedAt: NOW, platform: 'x' });
        a.posts[p.code] = XS.merge(a.posts[p.code], p);
      }
      for (const u of r.users || []) if (acc[u.id]) acc[u.id].profile = XS.mergeProfile(acc[u.id].profile, u);
    }
  }
  return acc;
}
function overviewBody() {
  const raw = JSON.parse(readFileSync(join(dir, 'accountOverviewDailyQuery.json'), 'utf8'))[0].body;
  const p = O.parseOverview(raw);
  const h = O.mergeHistory(null, p, NOW);
  return { p, h, body: { handle: 'ExcelBugs_Demo', restId: p.restId, days: O.dailyRows(h.days), snapshot: { followers: 80, verified_followers: 9 },
    imp90: { verified: O.impressions90(h, NOW).verified, source: 'analytics' }, coveredFrom: O.coveredFrom(h), capturedAt: NOW } };
}

test('migration 9: x_own_daily and x_post_stats exist, idempotent', () => {
  const s = freshStore();
  assert.ok(SCHEMA_VERSION >= 9);
  assert.equal(Number(s.getMeta('schema_version')), SCHEMA_VERSION);
  const tables = s.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  for (const t of ['x_own_daily', 'x_post_stats']) assert.ok(tables.includes(t), t);
  assert.equal(s.migrate(), SCHEMA_VERSION);
  // A database from before Phase 2 (schema_version 8) gets the tables on open.
  s.db.exec('DROP TABLE x_own_daily; DROP TABLE x_post_stats');
  s.setMeta('schema_version', 8);
  s.close();
  const again = new Store(s.home);
  assert.ok(again.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'x_post_stats'").get());
  assert.equal(Number(again.getMeta('schema_version')), SCHEMA_VERSION);
});

test('putDaily: analytics days and today\'s snapshot; a second capture updates days and keeps the snapshot', () => {
  const s = freshStore();
  const { h, body } = overviewBody();
  assert.deepEqual(XOWN.putDaily(s, body, NOW), { ok: true, days: 30 });
  const rows = s.db.prepare('SELECT * FROM x_own_daily WHERE handle = ? ORDER BY day').all(OWN);
  assert.equal(rows.length, 30);
  const today = rows.find((r) => r.day === O.dayOf(NOW));
  assert.equal(today.verified_followers, 9);
  assert.equal(today.followers, 80);
  assert.equal(today.imp90_source, 'analytics');
  assert.equal(today.imp90_v, O.impressions90(h, NOW).verified);
  assert.equal(today.imp_v, h.days[O.dayOf(NOW)].Displayed.v);
  assert.deepEqual(JSON.parse(today.metric).Displayed, h.days[O.dayOf(NOW)].Displayed);
  // Again with only today's day changed and no snapshot: the snapshot stays.
  const d = { ...body.days.find((r) => r.d === O.dayOf(NOW)), imp_v: 50 };
  XOWN.putDaily(s, { handle: 'excelbugs_demo', days: [d] }, NOW + 1000);
  const t2 = s.db.prepare('SELECT * FROM x_own_daily WHERE handle = ? AND day = ?').get(OWN, O.dayOf(NOW));
  assert.equal(t2.imp_v, 50);
  assert.equal(t2.verified_followers, 9);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM x_own_daily').get().n, 30);
  assert.equal(s.getMeta('x_own').handle, 'excelbugs_demo');
  assert.equal(s.getMeta('x_own').coveredFrom, O.coveredFrom(h));
  assert.deepEqual(XOWN.putDaily(s, { handle: 'not a handle!' }), { ok: false, error: 'bad handle' });
});

test('recordStats (/sync hook): every changed measurement; own posts always, others only under 7 days; reposts never', () => {
  const s = freshStore();
  s.setMeta('x_own', { handle: 'me_own' });
  const post = (code, owner, extra) => ({ code, owner, platform: 'x', kind: 'original', type: 'text', views: 10, likes: 1, comments: 0, shares: 0, quotes: 0, saves: 0, takenAt: NOW - 2 * DAY, seenAt: NOW, ...extra });
  const accounts = {
    'x/me_own': { posts: { 1001: post('1001', 'x/me_own', { takenAt: NOW - 300 * DAY }), 1002: post('1002', 'x/me_own', { kind: 'repost', views: null }) } },
    'x/other': { posts: { 2001: post('2001', 'x/other'), 2002: post('2002', 'x/other', { takenAt: NOW - 30 * DAY }) } },
    'tt/someone': { posts: { 3001: { code: '3001', views: 5 } } }
  };
  assert.equal(XOWN.recordStats(s, accounts, { now: NOW }), 2); // own old post + other's young post
  // Same numbers again (a later sync of the same record): nothing new.
  assert.equal(XOWN.recordStats(s, accounts, { now: NOW }), 0);
  // New views a bit later: one row each.
  accounts['x/me_own'].posts[1001] = { ...accounts['x/me_own'].posts[1001], views: 12, seenAt: NOW + H };
  assert.equal(XOWN.recordStats(s, accounts, { now: NOW + H }), 1);
  const rows = s.db.prepare("SELECT * FROM x_post_stats WHERE post_id = '1001' ORDER BY ts").all();
  assert.deepEqual(rows.map((r) => r.views), [10, 12]);
  assert.equal(rows[0].account_id, 'x/me_own');
  assert.equal(rows[0].kind, 'original');
  // An older measurement arriving late is ignored.
  accounts['x/me_own'].posts[1001] = { ...accounts['x/me_own'].posts[1001], views: 11, seenAt: NOW + 10 };
  assert.equal(XOWN.recordStats(s, accounts, { now: NOW + 2 * H }), 0);
  // Feature off: nothing.
  s.setMeta('features', { 'x.own': false });
  accounts['x/me_own'].posts[1001] = { ...accounts['x/me_own'].posts[1001], views: 99, seenAt: NOW + 3 * H };
  assert.equal(XOWN.recordStats(s, accounts, { now: NOW + 3 * H }), 0);
});

test('my_x_progress / my_x_account / x_patterns from the stored rows and the synced library', () => {
  const s = freshStore();
  const accounts = fixtureAccounts();
  s.applySync({ full: true, accounts, org: { folders: [{ id: 'f1', name: 'Excel X' }], accounts: { [OWN]: { folder: 'f1' }, ['x/' + meta.small.handle]: { folder: 'f1' } } } });
  const { h, body } = overviewBody();
  XOWN.putDaily(s, body, NOW);
  const pr = XOWN.myProgress(s, { now: NOW });
  assert.equal(pr.account, OWN);
  assert.equal(pr.verified_followers.current, 9);
  assert.equal(pr.impressions.source, 'analytics');
  assert.equal(pr.impressions.current, O.impressions90(h, NOW).verified);
  assert.equal(pr.impressions.upper_bound, true);
  assert.equal(pr.requirements.checked, '2026-11-24');
  assert.equal(pr.daily.length, 30);
  assert.equal(pr.daily[pr.daily.length - 1].verified_followers, 9);

  const me = XOWN.myAccount(s, { limit: 5, now: NOW });
  assert.equal(me.in_library, true);
  assert.equal(me.verified_followers, 9);
  assert.equal(me.originals.length, 5);
  assert.ok(me.originals.every((p) => p.kind === 'original' && p.type_guess));
  assert.ok(me.replies.every((p) => p.kind === 'reply' || p.kind === 'thread-part'));
  assert.ok(me.counts.originals > me.counts.replies);
  assert.ok(me.originals_median_views > 0);
  assert.match(me.note, /replies/);
  // An account that isn't saved: a hint, no crash.
  assert.match(XOWN.myAccount(s, { handle: 'nobody_here' }).note, /not in the Library/);
  assert.throws(() => XOWN.myAccount(s, { handle: 'bad handle!' }), /not an X handle/);

  const pat = XOWN.xPatterns(s, { account: 'me' });
  assert.equal(pat.scope, OWN);
  assert.ok(pat.types.length > 2);
  assert.ok(pat.single_hit.n > 10);
  assert.ok(pat.best_hours);
  assert.equal(pat.best_hours.heatmap, undefined);
  assert.equal(XOWN.xPatterns(s, { account: '@ExcelBugs_Demo' }).scope, OWN);
  assert.throws(() => XOWN.xPatterns(s, { account: 'x/nobody' }), /not in the Library/);
  const pool = XOWN.xPatterns(s, { folder: 'Excel X' });
  assert.equal(pool.scope, 'folder Excel X');
  assert.ok(pool.accounts.length >= 1);
  assert.match(pool.note, /Pooled/);
  assert.ok(Math.abs(pool.base_median - 1) < 0.5, 'pooled views are × each account\'s median');
});

test('curveOf: the account\'s usual views at 15 min … 48 h from x_post_stats; routes', async () => {
  const s = freshStore();
  s.setMeta('x_own', { handle: 'me_own' });
  // Four past posts, each read at 15, 30, 60 and 120 minutes.
  for (let i = 0; i < 4; i++) {
    const t0 = NOW - (10 + i) * DAY;
    for (const [hh, v] of [[0.25, 5], [0.5, 10], [1, 20], [2, 40]]) {
      XOWN.recordStats(s, { 'x/me_own': { posts: { ['50' + i]: { code: '50' + i, owner: 'x/me_own', kind: 'original', type: 'text', takenAt: t0, seenAt: t0 + hh * H, views: v * (i + 1) } } } }, { now: NOW });
    }
  }
  const c = XOWN.curveOf(s, 'me', { now: NOW });
  assert.equal(c.account, 'x/me_own');
  assert.equal(c.posts, 4);
  assert.deepEqual(c.cps[0.5], { value: 25, n: 4 });  // median of 10, 20, 30, 40
  assert.deepEqual(c.cps[1], { value: 50, n: 4 });
  assert.ok(!c.cps[24]);
  // Routes.
  const url = (p) => new URL('http://127.0.0.1' + p);
  const r1 = await XOWN.handleRoute('GET', url('/x/own/curve?account=me'), { store: s, readBody: async () => ({}) });
  assert.equal(r1[0], 200);
  assert.equal(r1[1].cps[1].value, 50);
  const r2 = await XOWN.handleRoute('GET', url('/x/own/curve?account=../../etc'), { store: s, readBody: async () => ({}) });
  assert.equal(r2[0], 400);
  const r3 = await XOWN.handleRoute('POST', url('/x/own/daily'), { store: s, readBody: async () => overviewBody().body });
  assert.deepEqual(r3, [200, { ok: true, days: 30 }]);
  const r4 = await XOWN.handleRoute('GET', url('/x/own/page'), { store: s, readBody: async () => ({}) });
  assert.equal(r4[0], 200);
  assert.equal(r4[1].account, OWN);
  assert.equal(r4[1].progress.verified_followers.current, 9);
  assert.equal(await XOWN.handleRoute('GET', url('/x/own/nothing'), { store: s, readBody: async () => ({}) }), null);
  s.setMeta('features', { 'x.own': false });
  const r5 = await XOWN.handleRoute('POST', url('/x/own/daily'), { store: s, readBody: async () => overviewBody().body });
  assert.deepEqual(r5, [200, { ok: false, off: true }]);
});

test('registerXOwnTools: three read-only tools with one call', async () => {
  const s = freshStore();
  s.applySync({ full: true, accounts: fixtureAccounts() });
  XOWN.putDaily(s, overviewBody().body, NOW);
  const tools = {};
  const server = { registerTool: (name, def, fn) => { tools[name] = { def, fn }; } };
  // A stand-in for zod (the schema chains are only built here, the MCP SDK validates them in the server).
  const chain = new Proxy(function () {}, { get: () => () => chain, apply: () => chain });
  const z = new Proxy({}, { get: () => () => chain });
  const json = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });
  const safe = async (fn) => { try { return await fn(); } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; } };
  XOWN.registerXOwnTools(server, { z, json, safe, store: () => s });
  assert.deepEqual(Object.keys(tools).sort(), ['my_x_account', 'my_x_progress', 'x_patterns']);
  for (const t of Object.values(tools)) assert.equal(t.def.annotations.readOnlyHint, true);
  const prog = JSON.parse((await tools.my_x_progress.fn({})).content[0].text);
  assert.equal(prog.account, OWN);
  assert.equal(prog.verified_followers.current, 9);
  const bad = JSON.parse((await tools.x_patterns.fn({ account: 'x/nobody' })).content[0].text);
  assert.equal(bad.ok, false);
});
