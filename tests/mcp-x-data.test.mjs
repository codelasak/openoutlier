// The X data the later phases share on the bridge (mcp/x-data.mjs): which account is "me", the user's own
// originals with × their median, other accounts' recent posts, the swipe file, the synced voice profile
// (never the API key), Phase 2's x_post_stats / x_own_daily for Phase 3, and x_voice_profile / x_draft_check
// end to end on a real store. Nothing talks to X.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

process.env.OPENOUTLIER_HOME = mkdtempSync(join(tmpdir(), 'openoutlier-xdata-'));
const here = dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);
const XS = req('../src/x.js');
const G = req('../src/x-growth.js');
const { Store } = await import('../mcp/store.mjs');
const D = await import('../mcp/x-data.mjs');
const XOWN = await import('../mcp/x-own.mjs');
const XT = await import('../mcp/x-llm-tools.mjs');
const { z } = await import(createRequire(join(process.cwd(), 'mcp', 'package.json')).resolve('zod'));

const dir = join(here, '..', 'dev', 'x');
const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
const NOW = meta.now;
const DAY = 864e5;
const OWN = 'x/excelbugs_demo';
const SMALL = 'x/' + meta.small.handle.toLowerCase();
const freshStore = () => new Store(mkdtempSync(join(tmpdir(), 'openoutlier-xdata-db-')));

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

test('ownXId: Phase 2\'s handle, else the profile marked me: true, else the default', () => {
  const s = freshStore();
  const accounts = fixtureAccounts();
  s.applySync({ full: true, accounts });
  assert.equal(D.ownXId(s), 'x/heyeshagh', 'nothing known: Phase 2\'s default');
  accounts[SMALL].profile = { ...accounts[SMALL].profile, me: true };
  s.applySync({ full: true, accounts });
  assert.equal(D.ownXId(s), SMALL, 'the x.com side nav (Phase 3)');
  s.setMeta('x_own', { handle: 'ExcelBugs_Demo' });
  assert.equal(D.ownXId(s), OWN, 'the handle set in the Library wins');
});

test('ownPosts / recentPosts / swipe from the synced Library', () => {
  const s = freshStore();
  const accounts = fixtureAccounts();
  // A young post by the other account, so recentPosts has something within 14 days of now.
  const fresh = { code: '9990000000000000001', platform: 'x', owner: SMALL, author: meta.small.handle, kind: 'original', type: 'text', views: 40,
    caption: 'Fresh niche post about pivot tables', takenAt: Date.now() - DAY, seenAt: Date.now() };
  accounts[SMALL].posts[fresh.code] = fresh;
  const swipe = { v: 1, items: { a: { id: 'a', platform: 'x', video: '123', type: 'text', title: 'Saved post text', channel: 'someone', savedAt: 1 },
    b: { id: 'b', platform: 'youtube', video: 'abcdefghijk', type: 'video', title: 'A saved video title', channel: 'Chan', savedAt: 2 } } };
  s.applySync({ full: true, accounts, org: { folders: [], accounts: {}, swipe } });
  s.setMeta('x_own', { handle: 'excelbugs_demo' });

  const own = D.ownPosts(s, { limit: 500 });
  const originals = Object.values(accounts[OWN].posts).filter((p) => p.kind === 'original' && (p.caption || '').trim());
  assert.equal(own.length, originals.length, 'originals only (no replies, thread parts or reposts)');
  for (let i = 1; i < own.length; i++) assert.ok((own[i - 1].created_at || '') >= (own[i].created_at || ''), 'newest first');
  assert.ok(own.some((p) => p.x != null && p.x > 2), 'x = × their own median');
  assert.deepEqual(Object.keys(own[0]).sort(), ['created_at', 'format', 'id', 'text', 'views', 'x']);

  const recent = D.recentPosts(s, { limit: 50 });
  assert.ok(recent.some((p) => p.id === fresh.code), 'the other account\'s fresh post');
  assert.ok(!recent.some((p) => accounts[OWN].posts[p.id]), 'never the own posts');

  const sw = D.swipeItems(s);
  assert.deepEqual(sw.map((x) => x.text).sort(), ['A saved video title', 'Saved post text']);
  assert.equal(sw.find((x) => x.id === 'a').url, 'https://x.com/i/status/123');
});

test('putVoice keeps only the profile fields; null removes it; undefined leaves it', () => {
  const s = freshStore();
  assert.equal(D.voiceProfile(s), null);
  D.putVoice(s, { text: 'Numbers first. Short lines.', updatedAt: 5, source: 'edited', key: 'sk-ant-nope', extra: 1 });
  assert.deepEqual(s.getMeta(D.VOICE_META), { text: 'Numbers first. Short lines.', updatedAt: 5, source: 'edited' });
  assert.equal(D.voiceProfile(s).text, 'Numbers first. Short lines.');
  D.putVoice(s, undefined);
  assert.ok(D.voiceProfile(s));
  D.putVoice(s, null);
  assert.equal(D.voiceProfile(s), null);
});

test('xPostStats rows feed Phase 3\'s pace; xFollowerDeltas reads x_own_daily', () => {
  const s = freshStore();
  s.setMeta('x_own', { handle: 'me_own' });
  const t0 = NOW - 3 * DAY;
  const post = (views, seenAt) => ({ code: '5001', owner: 'x/other', platform: 'x', kind: 'original', type: 'text', views, likes: 0, comments: 0, shares: 0, quotes: 0, saves: 0, takenAt: t0, seenAt });
  XOWN.recordStats(s, { 'x/other': { posts: { 5001: post(10, t0 + 30 * 60000) } } }, { now: t0 + 30 * 60000 });
  XOWN.recordStats(s, { 'x/other': { posts: { 5001: post(60, t0 + 90 * 60000) } } }, { now: t0 + 90 * 60000 });
  const rows = D.xPostStats(s, ['x/other']);
  assert.equal(rows.length, 2);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['owner', 'post_id', 'taken_at', 'ts', 'views']);
  const pace = G.paceFromRows(rows);
  assert.deepEqual(pace.posts['5001'].s, [[30, 10], [90, 60]]);
  assert.deepEqual(D.xPostStats(s, []), []);

  XOWN.putDaily(s, { handle: 'me_own', days: [{ d: '2026-11-20', follows: 5, unfollows: 2 }, { d: '2026-11-21', follows: 1, unfollows: 0 }] }, NOW);
  assert.deepEqual(D.xFollowerDeltas(s, 'x/me_own'), { '2026-11-20': 3, '2026-11-21': 1 });
  assert.deepEqual(D.xFollowerDeltas(s, 'x/nobody'), {});
});

test('x_voice_profile and x_draft_check on a real store, with the real composer', async () => {
  const s = freshStore();
  s.applySync({ full: true, accounts: fixtureAccounts(), org: { folders: [], accounts: {}, swipe: { v: 1, items: {} } } });
  s.setMeta('x_own', { handle: 'excelbugs_demo' });
  const tools = {};
  const server = { registerTool: (name, m, fn) => { tools[name] = { meta: m, fn }; } };
  const json = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });
  const safe = async (fn) => { try { return await fn(); } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; } };
  XT.setComposer();
  XT.registerXLlmTools(server, { z, json, safe, store: () => s, xData: D.xData });
  const run = async (name, args) => {
    const r = await tools[name].fn(z.object(tools[name].meta.inputSchema).parse(args));
    assert.equal(r.isError, undefined, r.content[0].text);
    return JSON.parse(r.content[0].text);
  };
  const v = await run('x_voice_profile', { limit: 10 });
  assert.equal(v.saved_profile, null);
  assert.ok(v.post_count > 0 && v.post_count <= 10);
  D.putVoice(s, { text: 'Dry, numbers first.', updatedAt: 1, source: 'llm' });
  assert.equal((await run('x_voice_profile', {})).saved_profile.text, 'Dry, numbers first.');
  const d = await run('x_draft_check', { draft: 'Like and RT if you agree: Excel is a database' });
  assert.equal(d.checks.available, true);
  assert.equal(d.voice_profile, 'Dry, numbers first.');
  assert.ok(d.own_posts_counted > 0);
  assert.ok(Array.isArray(d.own_outliers));
});
