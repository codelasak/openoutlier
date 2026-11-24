// X Phase 3 on the bridge (mcp/x-growth-tools.mjs): x_reply_opportunities and x_reply_roi over a
// Library built from the dev/x/growth fixtures, the snapshots-based pace, the optional Phase 2
// inputs, and the two tools through a real MCP client.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const home = mkdtempSync(join(tmpdir(), 'openoutlier-xgrowth-test-'));
process.env.OPENOUTLIER_HOME = home; // never ~/.openoutlier
const req = createRequire(import.meta.url);
const XP = req('../src/x.js');
const G = req('../src/x-growth.js');
const L = await import('../mcp/library.mjs');
const T = await import('../mcp/x-growth-tools.mjs');

const dir = join(here, '..', 'dev', 'x', 'growth');
const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
const NOW = meta.now;
const MIN = 60000;
const DAY = 864e5;
const ids = meta.ids;
const ME = 'x/' + meta.me.handle.toLowerCase();
const A = 'x/' + meta.users.A;
const B = 'x/' + meta.users.B;
const Cc = 'x/' + meta.users.C;
const D = 'x/' + meta.users.D;

/** A Library as the extension would sync it: Library accounts get their posts, the user's replies annotated. */
function buildLib() {
  const accounts = {};
  for (const id of [ME, A, B, Cc]) accounts[id] = { posts: {}, updatedAt: NOW, platform: 'x' };
  const me = { id: ME, restId: meta.me.restId };
  for (const f of ['UserOriginalsTimeline-niche', 'ListLatestTweetsTimeline', 'HomeLatestTimeline', 'UserRepliesTimeline-me', 'TweetDetail-myreply']) {
    const pg = JSON.parse(readFileSync(join(dir, f + '.json'), 'utf8'))[0];
    const r = XP.parsePayload(pg.url, JSON.stringify(pg.body));
    r.posts.forEach((p) => { p.seenAt = NOW; });
    const known = Object.fromEntries(Object.entries(accounts[ME].posts).filter(([, p]) => p.kind === 'reply'));
    const annotated = Object.fromEntries(G.annotateReplies(r.posts, me, known).map((p) => [p.code, p]));
    for (const p0 of r.posts.concat(Object.values(annotated).filter((p) => !r.posts.some((q) => q.code === p.code)))) {
      const p = annotated[p0.code] ? XP.merge(p0, annotated[p0.code]) : p0;
      if (accounts[p.owner]) accounts[p.owner].posts[p.code] = XP.merge(accounts[p.owner].posts[p.code], p);
    }
    for (const u of r.users) if (accounts[u.id]) accounts[u.id].profile = XP.mergeProfile(accounts[u.id].profile, u);
  }
  accounts[ME].profile = { ...(accounts[ME].profile || {}), id: ME, handle: meta.me.handle, restId: meta.me.restId, followers: 80, me: true,
    followersLog: { [G.dayKey(NOW - 3 * DAY, 0)]: 75, [G.dayKey(NOW - 2 * DAY, 0)]: 78, [G.dayKey(NOW - DAY, 0)]: 80 } };
  const org = { folders: [{ id: 'f1', name: 'Excel X' }, { id: 'f2', name: 'Big' }], accounts: { [A]: { folder: 'f1', tags: [] }, [Cc]: { folder: 'f1', tags: [] }, [B]: { folder: 'f2', tags: [] } } };
  return { accounts, org, watches: [], mentions: { items: {}, read: {} } };
}

test('xMe: the profile marked me, or the me argument', () => {
  const lib = buildLib();
  assert.equal(T.xMe(lib).id, ME);
  assert.equal(T.xMe(lib).followers, 80);
  assert.equal(T.xMe(lib, '@Niche_Mut_Demo').id, A);
  assert.throws(() => T.xMe(lib, 'not a handle!'), /not an X handle/);
  delete lib.accounts[ME].profile.me;
  assert.equal(T.xMe(lib), null);
});

test('x_reply_opportunities: followed accounts without a niche folder, the marked folder, a named folder', () => {
  const lib = buildLib();
  const r = T.replyOpportunitiesFor(lib, {}, { now: NOW });
  assert.equal(r.niche.source, 'followed_accounts');
  assert.deepEqual(r.opportunities.map((o) => o.url.split('/status/')[1]).sort(), [ids.aFresh, ids.aHour, ids.bBig, ids.cQuiet].sort());
  assert.equal(r.me.account, ME);
  const top = r.opportunities[0];
  assert.equal(top.author, '@niche_mut_demo');
  assert.equal(top.velocity_basis, 'lifetime');
  assert.equal(top.reply_angles, null, 'Phase 5 hook');
  assert.ok(top.score > r.opportunities.find((o) => o.account === B).score);
  assert.match(r.note, /never replies/);

  lib.org.xNiche = { folders: ['f1'] };
  const n = T.replyOpportunitiesFor(lib, {}, { now: NOW });
  assert.deepEqual(n.niche, { source: 'x_niche_folders', folders: ['Excel X'], accounts: 2 });
  assert.ok(n.opportunities.every((o) => o.account === A || o.account === Cc));
  const b = T.replyOpportunitiesFor(lib, { folder: 'big' }, { now: NOW });
  assert.deepEqual(b.opportunities.map((o) => o.account), [B]);
  assert.throws(() => T.replyOpportunitiesFor(lib, { folder: 'nope' }, { now: NOW }), /No folder named "nope"/);
  assert.equal(T.replyOpportunitiesFor(lib, { window_minutes: 30 }, { now: NOW }).opportunities.length, 1);
});

test('snapshots → the same-age pace (velocity_basis history); Phase 2 rows work the same way', () => {
  const lib = buildLib();
  const store = L.store();
  store.applySync({ full: true, accounts: lib.accounts, org: lib.org });
  // Three earlier A posts seen at 10 and 30 minutes old.
  const old = Object.values(lib.accounts[A].posts).filter((p) => NOW - p.takenAt > DAY).slice(0, 3);
  const ins = store.db.prepare('INSERT OR IGNORE INTO snapshots (account_id, code, seen_at, views) VALUES (?, ?, ?, ?)');
  old.forEach((p) => { ins.run(A, p.code, p.takenAt + 10 * MIN, 75); ins.run(A, p.code, p.takenAt + 30 * MIN, 225); });
  const rows = T.earlyRows(store, XP.isXId(A) ? [A, B, Cc, ME] : []);
  assert.ok(rows.filter((r) => r.owner === A && old.some((p) => p.code === r.post_id)).length >= 6);
  assert.ok(rows.every((r) => r.ts - r.taken_at <= 6 * 3600000), 'early sightings only');
  const r = T.replyOpportunitiesFor(lib, {}, { now: NOW, rows });
  const a = r.opportunities.find((o) => o.url.endsWith(ids.aFresh));
  assert.equal(a.velocity_basis, 'history');
  assert.equal(a.expected_views, 150, '75 → 225 between 10 and 30 minutes: 150 at 20');
  assert.equal(a.velocity, 2);
  assert.deepEqual(T.earlyRows(null, [A]), []);
});

test('x_reply_roi: replies, replies back, follower change from the profile log or injected analytics', () => {
  const lib = buildLib();
  const r = T.replyRoiFor(lib, {}, { now: NOW });
  assert.equal(r.account, ME);
  assert.equal(r.totals.replies, 3);
  const acc = Object.fromEntries(r.accounts.map((a) => [a.account, a]));
  assert.equal(acc[A].author_replied, 1);
  assert.equal(acc[B].author_replied, 1, 'the reply back seen on the TweetDetail page');
  assert.equal(acc[Cc].author_replied, 0);
  // followersLog: +3 on day −2 (B and C share it by views), +2 on day −1 (no replies that day).
  assert.equal(acc[Cc].followers_attributed, 2.1);
  assert.equal(acc[B].followers_attributed, 0.9);
  assert.equal(acc[A].followers_attributed, null, 'day −3 has no previous day in the log');
  assert.match(r.replies[0].at, /^\d{4}-\d\d-\d\dT/);
  // Injected exact deltas (Phase 2) win over the log.
  const x = T.replyRoiFor(lib, {}, { now: NOW, deltas: { [G.dayKey(NOW - 3 * DAY, 0)]: 10 } });
  assert.equal(x.accounts[0].account, A);
  assert.equal(x.accounts[0].followers_attributed, 10);
  assert.equal(T.replyRoiFor(lib, { since_days: 2.5 }, { now: NOW }).totals.replies, 2);
  delete lib.accounts[ME].profile.me;
  assert.match(T.replyRoiFor(lib, {}, { now: NOW }).error, /not known yet/);
  assert.match(T.replyRoiFor(lib, { me: '@nobody_here' }, { now: NOW }).error, /No posts of @nobody_here/);
});

test('registerXGrowthTools: two read-only tools; the optional Phase 2 inputs are used when given', async () => {
  const tools = {};
  const fake = { registerTool: (name, def, fn) => { tools[name] = { def, fn }; } };
  const json = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });
  const safe = async (fn) => { try { return await fn(); } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; } };
  const { z } = createRequire(join(here, '..', 'mcp', 'package.json'))('zod');
  const lib = buildLib();
  let asked = null;
  let askedMe = null;
  T.registerXGrowthTools(fake, { z, json, safe, store: () => null, readLibrary: () => lib,
    xPostStats: (st, accountIds) => { asked = accountIds; return []; },
    xFollowerDeltas: (st, meId) => { askedMe = meId; return {}; } });
  assert.deepEqual(Object.keys(tools).sort(), ['x_reply_opportunities', 'x_reply_roi']);
  for (const t of Object.values(tools)) assert.equal(t.def.annotations.readOnlyHint, true);
  const out = JSON.parse((await tools.x_reply_opportunities.fn({})).content[0].text);
  assert.ok(Array.isArray(out.opportunities), 'runs against "now": the fixture posts are old, so the list may be empty');
  assert.ok(asked.includes(A));
  const roi = JSON.parse((await tools.x_reply_roi.fn({ since_days: 365 })).content[0].text);
  assert.equal(roi.account, ME);
  assert.equal(askedMe, ME, 'Phase 2 follower deltas are asked for the user\'s account');
  const bad = await tools.x_reply_opportunities.fn({ folder: 'nope' });
  assert.equal(bad.isError, true);
});

test('the real server lists both tools and answers x_reply_roi', async () => {
  const mreq = createRequire(join(here, '..', 'mcp', 'package.json'));
  const { Client } = mreq('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = mreq('@modelcontextprotocol/sdk/client/stdio.js');
  const lib = buildLib();
  L.store().applySync({ full: true, accounts: lib.accounts, org: lib.org });
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(here, '..', 'mcp', 'server.mjs')],
    env: { ...process.env, OPENOUTLIER_HOME: home, OPENOUTLIER_PORT: '48311' }, stderr: 'pipe' });
  const client = new Client({ name: 'test-x-growth', version: '1.0.0' });
  await client.connect(transport);
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(names.includes('x_reply_opportunities') && names.includes('x_reply_roi'));
    assert.match(client.getInstructions(), /x_reply_opportunities/);
    const r = await client.callTool({ name: 'x_reply_roi', arguments: { since_days: 365 } });
    const data = JSON.parse(r.content[0].text);
    assert.equal(data.account, ME);
    assert.equal(data.totals.replies, 3);
    const o = await client.callTool({ name: 'x_reply_opportunities', arguments: { window_minutes: 1440 } });
    assert.ok(!o.isError, o.content[0].text);
  } finally { await client.close(); }
});
