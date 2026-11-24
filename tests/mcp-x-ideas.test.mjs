// x_ideas on the bridge (mcp/x-ideas.mjs): rs:org.xIdeas / xNiche survive the sync, arguments are normalised,
// the user's own X account is left out of the niche, and the tool is read-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

process.env.OPENOUTLIER_HOME = mkdtempSync(join(tmpdir(), 'openoutlier-xideas-'));
const { Store } = await import('../mcp/store.mjs');
const XI = await import('../mcp/x-ideas.mjs');
const { z } = await import(createRequire(join(process.cwd(), 'mcp', 'package.json')).resolve('zod'));

const NOW = Date.now();
const DAY = 864e5;
function xAccount(id, n, big) {
  const posts = {};
  for (let i = 0; i < n; i++) {
    const code = String(2100000000000000000n + BigInt(id.length * 1000 + i));
    posts[code] = { code, platform: 'x', owner: id, author: id.slice(2), kind: 'original', type: 'text', views: i === 0 ? big : 100 + i, takenAt: NOW - (i + 2) * DAY, caption: 'Post ' + i };
  }
  return { posts, platform: 'x', updatedAt: NOW };
}
function ig(id, n, big) {
  const posts = {};
  for (let i = 0; i < n; i++) posts['c' + i] = { code: 'c' + i, owner: id, views: i === 0 ? big : 1000 + i, takenAt: NOW - (i + 1) * DAY, caption: 'Reel ' + i };
  return { posts, updatedAt: NOW };
}

function setup() {
  const s = new Store(mkdtempSync(join(tmpdir(), 'openoutlier-xideas-db-')));
  s.applySync({ full: true,
    accounts: { 'x/niche_a': xAccount('x/niche_a', 12, 5000), 'x/heyeshagh': xAccount('x/heyeshagh', 12, 9000), 'handson.excel': ig('handson.excel', 10, 40000) },
    org: { folders: [{ id: 'f1', name: 'Excel X' }], accounts: {}, xIdeas: { own: ['handson.excel'] } } });
  return s;
}

test('rs:org.xIdeas and xNiche survive the bridge\'s org sync', () => {
  const s = setup();
  s.applySync({ full: false, accounts: {}, org: { folders: [{ id: 'f1', name: 'Excel X' }], accounts: { 'x/niche_a': { folder: 'f1' } }, xNiche: { folders: ['f1'] }, xIdeas: { own: ['handson.excel'], subreddits: ['r/excel'] } } });
  const org = s.readLibrary().org;
  assert.deepEqual(org.xNiche, { folders: ['f1'] });
  assert.deepEqual(org.xIdeas, { own: ['handson.excel'], subreddits: ['r/excel'] });
});

test('x_ideas: read-only, the own X account left out, own accounts from the setting or the argument', async () => {
  const s = setup();
  const tools = {};
  const server = { registerTool: (name, meta, fn) => { tools[name] = { meta, fn }; } };
  const json = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });
  const safe = async (fn) => { try { return await fn(); } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; } };
  XI.registerXIdeasTools(server, { z, json, safe, store: () => s, readLibrary: () => s.readLibrary() });
  assert.deepEqual(Object.keys(tools), ['x_ideas']);
  assert.equal(tools.x_ideas.meta.annotations.readOnlyHint, true);
  const run = async (args) => {
    const r = await tools.x_ideas.fn(z.object(tools.x_ideas.meta.inputSchema).parse(args));
    assert.equal(r.isError, undefined, r.content[0].text);
    return JSON.parse(r.content[0].text);
  };
  const all = await run({});
  assert.deepEqual(all.niche.posts.map((p) => p.account), ['x/niche_a'], 'x/heyeshagh is the user (Phase 2 default)');
  assert.deepEqual(all.crossPlatform.accounts, ['handson.excel']);
  assert.deepEqual(all.own_accounts_setting, ['handson.excel']);
  assert.ok(all.reddit && all.rules);
  const own = await run({ only: 'own', own: ['@Handson.Excel'] });
  assert.equal(own.niche, undefined);
  assert.deepEqual(own.crossPlatform.accounts, ['handson.excel']);
});

test('xIdeasFor: no own accounts set → candidates to ask about; thresholds pass through', () => {
  const s = setup();
  const lib = s.readLibrary();
  lib.org = { folders: [], accounts: {} };
  const r = XI.xIdeasFor(lib, { only: 'own' }, NOW);
  assert.deepEqual(r.crossPlatform.candidates.map((c) => c.id), ['handson.excel']);
  const strict = XI.xIdeasFor(s.readLibrary(), { only: 'niche', min_ratio: 100 }, NOW);
  assert.equal(strict.niche.posts.length, 0);
  assert.equal(strict.niche.min_ratio, 100);
});
