// End-to-end test of the local MCP server: a real MCP client talks to
// mcp/server.mjs over stdio, and this test plays the browser extension's part
// over the localhost bridge.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '..', 'mcp', 'package.json'));
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const X = createRequire(import.meta.url)('../src/extract.js');

const FIRST = 47911; // test range, away from the real one
const EXT_ORIGIN = 'chrome-extension://' + 'a'.repeat(32);
const home = mkdtempSync(join(tmpdir(), 'reelscope-test-'));

// A program that is NOT ReelScope sitting on the first port: the server must skip it.
const squatter = http.createServer((req, res) => { res.end('hello from another app'); });
await new Promise((r) => squatter.listen(FIRST, '127.0.0.1', r));

// A tiny "CDN" for download_reel.
const cdnSeen = [];
const cdn = http.createServer((req, res) => {
  cdnSeen.push({ url: req.url, referer: req.headers.referer || null });
  if (req.url.includes('forbidden')) { res.writeHead(403); res.end('no'); return; } // TikTok without the browser session
  res.writeHead(200, { 'content-type': 'video/mp4' }); res.end(Buffer.alloc(2048, 7));
});
await new Promise((r) => cdn.listen(0, '127.0.0.1', r));
const cdnUrl = `http://127.0.0.1:${cdn.address().port}/v/clip.mp4?oe=${(Math.floor(Date.now() / 1000) + 86400).toString(16)}`;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(here, '..', 'mcp', 'server.mjs')],
  env: { ...process.env, REELSCOPE_HOME: home, REELSCOPE_PORT: String(FIRST) },
  stderr: 'pipe'
});
const client = new Client({ name: 'test', version: '1.0.0' });
await client.connect(transport);

async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content[0].text;
  return { isError: !!r.isError, text, data: r.isError ? null : JSON.parse(text) };
}

async function findPort() {
  for (let p = FIRST; p < FIRST + 10; p++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${p}/health`)).json();
      if (j.app === 'reelscope') return p;
    } catch { /* next */ }
  }
  return null;
}
const port = await findPort();

function bridge(path, { method = 'GET', body, origin = EXT_ORIGIN } = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
}

// Library: two accounts built from the fixture.
const base = X.parseText(readFileSync(join(here, '..', 'dev', 'graphql', 'query.json'), 'utf8'));
function account(owner, scale) {
  const posts = {};
  base.forEach((p, i) => {
    const q = { ...p, owner, code: p.code + owner.length, views: Math.round(p.views * scale) };
    if (i === 0) q.files = [{ kind: 'video', url: cdnUrl }];
    posts[q.code] = q;
  });
  return { posts, updatedAt: Date.now() };
}

test.after(async () => {
  await client.close();
  squatter.close();
  cdn.close();
});

test('skips a port used by another program', () => {
  assert.ok(port && port !== FIRST, 'should have moved past the squatted port, got ' + port);
});

test('bridge refuses websites and wrong hosts', async () => {
  assert.equal((await bridge('/commands', { origin: 'https://evil.example' })).status, 403);
  assert.equal((await bridge('/commands', { origin: null })).status, 403);
  // DNS rebinding: a page on evil.example resolving to 127.0.0.1 sends Host: evil.example.
  // (fetch() ignores a custom Host header, so use http.request.)
  const status = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/health', headers: { host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(status, 403);
});

test('extension can sync and agents can read it', async () => {
  const org = { folders: [{ id: 'f1', name: 'Food' }], accounts: { 'demo.kitchen': { folder: 'f1', tags: ['competitor'] } } };
  const r = await bridge('/sync', { method: 'POST', body: { full: true, accounts: { 'demo.kitchen': account('demo.kitchen', 1), 'big.chef': account('big.chef', 5) }, org } });
  assert.equal(r.status, 200);

  const list = await call('list_accounts');
  assert.equal(list.data.count, 2);
  assert.equal(list.data.extension_connected, true);
  assert.equal(list.data.accounts[0].username, 'big.chef'); // higher median first

  const ft = await call('list_folders_and_tags');
  assert.deepEqual(ft.data.folders, [{ name: 'Food', accounts: 1 }]);

  const sum = await call('account_summary', { username: '@demo.kitchen' });
  assert.equal(sum.data.account.folder, 'Food');
  assert.ok(sum.data.best_posting_slots.length > 0);
  assert.ok(sum.data.top_hashtags[0].hashtag.startsWith('#'));

  const top = await call('top_reels', { folder: 'Food', limit: 5 });
  assert.equal(top.data.accounts, 1);
  assert.equal(top.data.reels.length, 5);
  assert.ok(top.data.reels.every((x) => x.account === 'demo.kitchen'));

  const bad = await call('top_reels', { folder: 'Nope' });
  assert.ok(bad.isError && /No folder named/.test(bad.text));

  const found = await call('search_reels', { query: 'pasta' });
  assert.ok(found.data.matched > 0);
});

test('get_reel exposes the mp4 link and its expiry; download_reel saves it', async () => {
  const code = base[0].code + 'demo.kitchen'.length;
  const reel = await call('get_reel', { code: `https://www.instagram.com/reel/${code}/` });
  assert.equal(reel.data.video_url, cdnUrl);
  assert.equal(reel.data.link_expired, false);
  assert.ok(reel.data.link_expires_at);

  const dir = join(home, 'dl');
  const dl = await call('download_reel', { code, directory: dir });
  assert.equal(dl.isError, false, dl.text);
  const file = dl.data.saved[0].path;
  assert.match(file, /views_.*likes_.*comments_.*pct_post_.*\.mp4$/);
  assert.ok(existsSync(file) && statSync(file).size === 2048);
});

test('agent commands reach the extension and come back', async () => {
  const pending = call('collect_profile', { username: '@new.creator', wait_seconds: 8 });
  // Extension side: pick up the command, report a result.
  let cmds = [];
  for (let i = 0; i < 20 && !cmds.length; i++) {
    cmds = (await (await bridge('/commands')).json()).commands;
    if (!cmds.length) await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal(cmds.length, 1);
  assert.equal(cmds[0].type, 'collect_profile');
  assert.equal(cmds[0].args.username, 'new.creator');
  // A command is handed out once.
  assert.equal((await (await bridge('/commands')).json()).commands.length, 0);
  await bridge('/commands/result', { method: 'POST', body: { id: cmds[0].id, result: { ok: true, collected_now: 42 } } });
  const res = await pending;
  assert.equal(res.data.state, 'done');
  assert.equal(res.data.result.collected_now, 42);

  const st = await call('command_status', { command_id: cmds[0].id });
  assert.equal(st.data.state, 'done');
});

test('incremental sync updates one account and can delete one', async () => {
  await bridge('/sync', { method: 'POST', body: { full: false, accounts: { 'big.chef': null } } });
  const list = await call('list_accounts');
  assert.deepEqual(list.data.accounts.map((a) => a.username), ['demo.kitchen']);
});

test('accounts with fewer than 5 posts are hidden unless asked for', async () => {
  const one = Object.values(account('feed.only', 1).posts)[0];
  await bridge('/sync', { method: 'POST', body: { full: false, accounts: { 'feed.only': { posts: { [one.code]: { ...one, owner: 'feed.only', views: 99000000 } }, updatedAt: Date.now() } } } });
  const list = await call('list_accounts');
  assert.ok(!list.data.accounts.some((a) => a.username === 'feed.only'));
  assert.equal(list.data.hidden_small_accounts, 1);
  const all = await call('list_accounts', { include_small_accounts: true });
  assert.ok(all.data.accounts.some((a) => a.username === 'feed.only'));
  const top = await call('top_reels', { sort: 'views', limit: 1 });
  assert.notEqual(top.data.reels[0].account, 'feed.only');
  const named = await call('top_reels', { usernames: ['feed.only'] });
  assert.equal(named.data.reels[0].account, 'feed.only');
});

test('Reddit: subreddits sit next to Instagram accounts and get their own tools', async () => {
  const R = createRequire(import.meta.url)('../src/reddit.js');
  const listings = JSON.parse(readFileSync(join(here, '..', 'dev', 'reddit', 'listings.json'), 'utf8'));
  const rec = (pages) => {
    const posts = {};
    R.parseListing(pages).posts.forEach((p) => { posts[p.code] = p; });
    return { posts, updatedAt: Date.now(), platform: 'reddit', kind: 'subreddit' };
  };
  // An Instagram competitor whose captions talk about XLOOKUP.
  const ig = account('excel.tips', 2);
  Object.values(ig.posts).forEach((p, i) => { p.owner = 'excel.tips'; p.caption = i % 4 === 0 ? 'XLOOKUP trick you need' : 'Pivot tables in 30 seconds'; });
  const org = {
    folders: [{ id: 'f1', name: 'Food' }, { id: 'fx', name: 'Excel' }],
    accounts: { 'demo.kitchen': { folder: 'f1', tags: ['competitor'] }, 'excel.tips': { folder: 'fx', tags: [] }, 'r/excel': { folder: 'fx', tags: ['research'] }, 'r/spreadsheets': { folder: 'fx', tags: [] } }
  };
  const r = await bridge('/sync', { method: 'POST', body: { full: false, accounts: { 'r/excel': rec(listings.excel), 'r/spreadsheets': rec(listings.spreadsheets), 'excel.tips': ig }, org } });
  assert.equal(r.status, 200);

  const list = await call('list_accounts', { folder: 'Excel' });
  assert.deepEqual(list.data.accounts.map((a) => [a.username, a.platform]).sort(), [['excel.tips', 'instagram'], ['r/excel', 'reddit'], ['r/spreadsheets', 'reddit']]);
  const sub = list.data.accounts.find((a) => a.username === 'r/excel');
  assert.equal(sub.posts_saved, 90);
  assert.ok(sub.median_score > 0);
  const onlyReddit = await call('list_accounts', { platform: 'reddit' });
  assert.ok(onlyReddit.data.accounts.every((a) => a.platform === 'reddit'));
  const ft = await call('list_folders_and_tags');
  assert.deepEqual(ft.data.folders.find((f) => f.name === 'Excel'), { name: 'Excel', accounts: 3, instagram: 1, reddit: 2 });

  const sum = await call('subreddit_summary', { name: 'https://www.reddit.com/r/Excel/top/?t=year' });
  assert.equal(sum.isError, false, sum.text);
  assert.equal(sum.data.account.username, 'r/excel');
  assert.equal(sum.data.summary.posts_analyzed, 90);
  assert.ok(sum.data.best_posting_slots.length > 0);
  assert.ok(sum.data.question_vs_statement.length === 2);
  assert.ok(sum.data.words_that_perform.length > 0);
  assert.ok(sum.data.flairs.some((f) => f.flair === 'solved'));
  assert.equal(sum.data.top_posts.length, 10);
  assert.ok(sum.data.top_posts[0].score >= sum.data.top_posts[1].score);
  // account_summary hands Reddit names to subreddit_summary.
  assert.equal((await call('account_summary', { username: 'r/excel' })).data.account.platform, 'reddit');
  assert.ok((await call('subreddit_summary', { name: 'nope_sub' })).isError);

  const top = await call('top_posts', { folder: 'Excel', limit: 5, questions_only: true });
  assert.equal(top.data.accounts, 2);
  assert.equal(top.data.posts.length, 5);
  assert.ok(top.data.posts.every((p) => p.platform === 'reddit' && p.question));
  const solved = await call('top_posts', { subreddits: ['excel'], flair: 'solved', sort: 'score' });
  assert.ok(solved.data.posts.every((p) => p.flair === 'solved' && p.account === 'r/excel'));

  const ideas = await call('content_ideas', { folder: 'Excel', limit: 8 });
  assert.equal(ideas.isError, false, ideas.text);
  assert.deepEqual(ideas.data.subreddits.sort(), ['r/excel', 'r/spreadsheets']);
  assert.equal(ideas.data.instagram_accounts_compared, 1);
  assert.equal(ideas.data.ideas.length, 8);
  assert.ok(ideas.data.ideas.every((p) => p.kind === 'question' || p.kind === 'pain point'));
  const x = ideas.data.themes.find((t) => t.theme === 'xlookup');
  assert.ok(x, 'xlookup theme');
  assert.ok(x.on_instagram.reels > 0 && x.on_instagram.best.account === 'excel.tips');
  assert.ok((await call('content_ideas', { folder: 'Food' })).isError, 'no subreddits in Food');

  // Instagram-only tools stay Instagram-only; search covers both.
  const reels = await call('top_reels', { folder: 'Excel' });
  assert.ok(reels.data.reels.every((p) => p.account === 'excel.tips'));
  const found = await call('search_reels', { query: 'xlookup', folder: 'Excel' });
  assert.ok(found.data.reels.some((p) => p.platform === 'reddit') && found.data.reels.some((p) => p.account === 'excel.tips'));
  const one = await call('get_reel', { code: found.data.reels.find((p) => p.platform === 'reddit').url });
  assert.equal(one.data.platform, 'reddit');
  assert.ok((await call('download_reel', { code: one.data.id })).isError);

  // Collect commands for subreddits go to the extension as collect_reddit.
  const pending = call('collect_subreddit', { name: 'r/PowerBI', time: 'month', wait_seconds: 8 });
  let cmds = [];
  for (let i = 0; i < 20 && !cmds.length; i++) {
    cmds = (await (await bridge('/commands')).json()).commands;
    if (!cmds.length) await new Promise((res) => setTimeout(res, 200));
  }
  assert.equal(cmds[0].type, 'collect_reddit');
  assert.deepEqual(cmds[0].args, { kind: 'subreddit', name: 'powerbi', sort: 'top', t: 'month', maxPosts: 500 });
  await bridge('/commands/result', { method: 'POST', body: { id: cmds[0].id, result: { ok: true, account: 'r/powerbi', collected_now: 300 } } });
  const done = await pending;
  assert.equal(done.data.state, 'done');
  assert.equal(done.data.result.collected_now, 300);

  const viaProfile = call('collect_profile', { username: 'u/ExcelByChris', wait_seconds: 3 });
  cmds = [];
  for (let i = 0; i < 20 && !cmds.length; i++) {
    cmds = (await (await bridge('/commands')).json()).commands;
    if (!cmds.length) await new Promise((res) => setTimeout(res, 200));
  }
  assert.equal(cmds[0].type, 'collect_reddit');
  assert.equal(cmds[0].args.kind, 'user');
  assert.equal(cmds[0].args.name, 'excelbychris');
  await viaProfile;
});

test('Reddit mentions: watches and the inbox sync, the mentions tool filters them', async () => {
  const MN = createRequire(import.meta.url)('../src/mentions.js');
  const now = Date.now();
  const watches = [
    { id: 'w1', query: '"excel formula"', subreddits: ['excel'], exclude: [], kinds: ['posts', 'comments'], enabled: true },
    { id: 'w2', query: 'handsonexcel', subreddits: [], exclude: [], kinds: ['posts'], enabled: true }
  ];
  const items = {};
  [
    { id: 't3_aa1', kind: 'post', watchId: 'w1', query: '"excel formula"', title: 'Excel formula help', subreddit: 'excel', createdAt: now - 3600e3, foundAt: now - 3000e3, source: 'extension' },
    { id: 't1_bb2', kind: 'comment', watchId: 'w1', query: '"excel formula"', title: 'Thread', subreddit: 'excel', createdAt: now - 10 * 864e5, foundAt: now - 10 * 864e5, source: 'hayati' },
    { id: 't3_cc3', kind: 'post', watchId: 'w2', query: 'handsonexcel', title: 'Anyone tried handsonexcel?', subreddit: 'learnexcel', createdAt: now - 7200e3, foundAt: now - 7000e3, source: 'extension' }
  ].forEach((m) => { items[m.id] = MN.shape(m); });
  // Watches and mentions ride along with an incremental sync, without touching the accounts.
  const r = await bridge('/sync', { method: 'POST', body: { full: false, accounts: {}, watches, mentions: { items, read: { t1_bb2: 1 } } } });
  assert.equal(r.status, 200);

  const all = await call('mentions');
  assert.equal(all.isError, false, all.text);
  assert.equal(all.data.total, 3);
  assert.equal(all.data.unread, 2);
  assert.deepEqual(all.data.watches.map((w) => [w.id, w.found, w.unread]), [['w1', 2, 1], ['w2', 1, 1]]);
  assert.equal(all.data.mentions[0].id, 't3_aa1'); // newest first
  assert.equal(all.data.mentions.find((m) => m.id === 't1_bb2').read, true);
  assert.equal(all.data.mentions.find((m) => m.id === 't1_bb2').source, 'hayati');

  assert.deepEqual((await call('mentions', { watch: 'excel formula', unread_only: true })).data.mentions.map((m) => m.id), ['t3_aa1']);
  assert.deepEqual((await call('mentions', { since_days: 2 })).data.mentions.map((m) => m.id).sort(), ['t3_aa1', 't3_cc3']);
  assert.deepEqual((await call('mentions', { kind: 'comment' })).data.mentions.map((m) => m.id), ['t1_bb2']);
  assert.ok((await call('mentions', { watch: 'nothing like this' })).isError);

  // A later full sync without watches/mentions (e.g. an older extension) keeps the inbox.
  await bridge('/sync', { method: 'POST', body: { full: true, accounts: { 'demo.kitchen': account('demo.kitchen', 1) } } });
  assert.deepEqual((await call('list_accounts')).data.accounts.map((a) => a.username), ['demo.kitchen']);
  assert.equal((await call('mentions')).data.total, 3);
});

test('TikTok: accounts next to Instagram, top_reels across platforms, compare_platforms, collect and download', async () => {
  const T = createRequire(import.meta.url)('../src/tiktok.js');
  const pages = JSON.parse(readFileSync(join(here, '..', 'dev', 'tiktok', 'item_list.json'), 'utf8'));
  const igTwin = JSON.parse(readFileSync(join(here, '..', 'dev', 'tiktok', 'ig-twin.json'), 'utf8'));
  const items = T.parseText(JSON.stringify(pages)).filter((p) => p.owner === 'tt/excel.bugs.demo');
  const exp = (Math.floor(Date.now() / 1000) + 86400).toString();
  const ok = items.find((p) => p.type === 'video');
  const blocked = items.filter((p) => p.type === 'video')[1];
  ok.files = [{ kind: 'video', url: `http://127.0.0.1:${cdn.address().port}/tt/ok.mp4?expire=${exp}` }];
  blocked.files = [{ kind: 'video', url: `http://127.0.0.1:${cdn.address().port}/tt/forbidden.mp4?expire=${exp}` }];
  const ttPosts = {};
  items.forEach((p) => { ttPosts[p.code] = p; });
  const igPosts = {};
  igTwin.forEach((p) => { igPosts[p.code] = p; });
  const org = { folders: [{ id: 'fb', name: 'Excel Bug' }], accounts: { 'excel.bugs.demo': { folder: 'fb', tags: [] }, 'tt/excel.bugs.demo': { folder: 'fb', tags: ['tiktok'] } } };
  const r = await bridge('/sync', { method: 'POST', body: { full: false, org, accounts: {
    'tt/excel.bugs.demo': { posts: ttPosts, updatedAt: Date.now(), platform: 'tiktok', profile: { username: 'excel.bugs.demo', nickname: 'Excel Bugs (demo)', followers: 48213, videos: 40 } },
    'excel.bugs.demo': { posts: igPosts, updatedAt: Date.now() }
  } } });
  assert.equal(r.status, 200);

  const tt = await call('list_accounts', { platform: 'tiktok' });
  assert.equal(tt.data.count, 1);
  const row = tt.data.accounts[0];
  assert.equal(row.username, 'tt/excel.bugs.demo');
  assert.equal(row.platform, 'tiktok');
  assert.equal(row.handle, '@excel.bugs.demo');
  assert.equal(row.followers, 48213);
  assert.equal(row.videos, 39);
  assert.ok(row.median_views > 0 && row.saves_per_100_views > 0 && row.shares_per_100_views > 0);
  const ig = await call('list_accounts', { platform: 'instagram', folder: 'Excel Bug' });
  assert.deepEqual(ig.data.accounts.map((a) => a.username), ['excel.bugs.demo']);
  const ft = await call('list_folders_and_tags');
  assert.deepEqual(ft.data.folders.find((f) => f.name === 'Excel Bug'), { name: 'Excel Bug', accounts: 2, instagram: 1, tiktok: 1 });

  const sum = await call('account_summary', { username: 'https://www.tiktok.com/@Excel.Bugs.Demo' });
  assert.equal(sum.isError, false, sum.text);
  assert.equal(sum.data.account.platform, 'tiktok');
  assert.equal(sum.data.summary.videos_analyzed, 39);
  assert.ok(sum.data.summary.saves_per_100_views > 0);
  assert.ok(sum.data.audio.some((a) => a.kind === 'Original sound'));
  assert.ok(sum.data.top_reels.every((p) => p.platform === 'tiktok' && p.saves != null));
  // The same handle on Instagram is a different account.
  assert.equal((await call('account_summary', { username: 'excel.bugs.demo' })).data.account.platform, 'instagram');

  const both = await call('top_reels', { folder: 'Excel Bug', limit: 200 });
  assert.deepEqual(both.data.platforms.sort(), ['instagram', 'tiktok']);
  assert.ok(both.data.reels.some((p) => p.platform === 'tiktok') && both.data.reels.some((p) => p.platform === 'instagram'));
  const onlyTT = await call('top_reels', { folder: 'Excel Bug', platform: 'tiktok', sort: 'saves', limit: 3 });
  assert.ok(onlyTT.data.reels.every((p) => p.platform === 'tiktok'));
  assert.ok(onlyTT.data.reels[0].saves >= onlyTT.data.reels[1].saves);
  assert.ok((await call('search_reels', { query: 'düşeyara', platform: 'tiktok' })).data.reels.every((p) => p.platform === 'tiktok'));

  const one = await call('get_reel', { code: ok.url + '?is_from_webapp=1' });
  assert.equal(one.isError, false, one.text);
  assert.equal(one.data.platform, 'tiktok');
  assert.equal(one.data.video_url, ok.files[0].url);
  assert.equal(one.data.link_expired, false);
  assert.ok(one.data.link_expires_at);

  // Download: works directly when the CDN allows it (sent with a tiktok.com referer) …
  const dir = join(home, 'tt-dl');
  const dl = await call('download_reel', { code: ok.code, directory: dir });
  assert.equal(dl.isError, false, dl.text);
  assert.match(dl.data.saved[0].path, /views_.*likes_.*comments_.*shares_.*saves_.*pct_tiktok_\d+\.mp4$/);
  assert.equal(dl.data.saved[0].via, 'direct');
  assert.ok(existsSync(dl.data.saved[0].path));
  assert.equal(cdnSeen.find((x) => x.url.includes('/tt/ok.mp4')).referer, 'https://www.tiktok.com/');
  // … and otherwise asks the extension to download it in the browser.
  const pendingDl = call('download_reel', { code: blocked.url });
  let cmds = [];
  for (let i = 0; i < 40 && !cmds.length; i++) {
    cmds = (await (await bridge('/commands')).json()).commands;
    if (!cmds.length) await new Promise((res) => setTimeout(res, 200));
  }
  assert.equal(cmds[0].type, 'download_tiktok');
  assert.deepEqual(cmds[0].args, { id: blocked.code, username: 'excel.bugs.demo', what: 'video' });
  await bridge('/commands/result', { method: 'POST', body: { id: cmds[0].id, result: { ok: true, files: [{ filename: '/Users/x/Downloads/ReelScope/tt_excel.bugs.demo/a_tiktok_1.mp4', state: 'complete' }] } } });
  const viaBrowser = await pendingDl;
  assert.equal(viaBrowser.isError, false, viaBrowser.text);
  assert.equal(viaBrowser.data.saved[0].via, 'browser');
  assert.match(viaBrowser.data.saved[0].path, /tt_excel\.bugs\.demo/);

  // Same videos on both platforms.
  const cmp = await call('compare_platforms', { account_ig: '@excel.bugs.demo' });
  assert.equal(cmp.isError, false, cmp.text);
  assert.equal(cmp.data.tiktok, 'tt/excel.bugs.demo');
  assert.equal(cmp.data.summary.matched, 35);
  assert.equal(cmp.data.only_on_instagram.count, 5);
  assert.equal(cmp.data.only_on_tiktok.count, 4);
  for (const p of cmp.data.pairs) {
    assert.equal(p.instagram.caption.match(/Bug (\d+)/)[1], p.tiktok.caption.match(/Bug #(\d+)/)[1]);
    assert.ok(p.days_apart <= 3 && ['instagram', 'tiktok'].includes(p.better_on));
  }
  assert.ok(cmp.data.summary.typical_tiktok_to_instagram_views > 1);
  assert.ok((await call('compare_platforms', { account_tt: 'tt/excel.bugs.demo', account_ig: 'nobody.here' })).isError);
  assert.equal((await call('compare_platforms', { account_tt: 'https://www.tiktok.com/@excel.bugs.demo' })).data.instagram, 'excel.bugs.demo');

  // Collect / refresh go to the extension as TikTok commands.
  const pendingCollect = call('collect_profile', { username: 'https://www.tiktok.com/@SomeOne.New', wait_seconds: 3 });
  cmds = [];
  for (let i = 0; i < 20 && !cmds.length; i++) {
    cmds = (await (await bridge('/commands')).json()).commands;
    if (!cmds.length) await new Promise((res) => setTimeout(res, 200));
  }
  assert.equal(cmds[0].type, 'collect_tiktok');
  assert.deepEqual(cmds[0].args, { username: 'someone.new', maxPosts: 300 });
  await pendingCollect;
  const pendingRefresh = call('refresh_reel', { code: ok.code, wait_seconds: 2 });
  cmds = [];
  for (let i = 0; i < 20 && !cmds.length; i++) {
    cmds = (await (await bridge('/commands')).json()).commands;
    if (!cmds.length) await new Promise((res) => setTimeout(res, 200));
  }
  assert.equal(cmds[0].type, 'refresh_tiktok');
  assert.deepEqual(cmds[0].args, { id: ok.code, username: 'excel.bugs.demo' });
  await pendingRefresh;
});
