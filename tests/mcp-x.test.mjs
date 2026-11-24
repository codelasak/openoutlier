// X (x.com) in the MCP server: a real MCP client talks to mcp/server.mjs over stdio,
// the library is synced over the localhost bridge from the dev/x fixtures, and this
// test plays the extension's part for the collect_x and org_edit commands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '..', 'mcp', 'package.json'));
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const req = createRequire(import.meta.url);
const XS = req('../src/x.js');
const C = req('../src/compare.js');

const FIRST = 47991; // test port range, away from the real one and the other tests
const EXT_ORIGIN = 'chrome-extension://' + 'b'.repeat(32);
const home = mkdtempSync(join(tmpdir(), 'openoutlier-x-test-'));
process.env.OPENOUTLIER_HOME = home; // library.mjs (imported below) must never see ~/.openoutlier
const L = await import('../mcp/library.mjs');

// ---- library from the dev/x fixtures ---------------------------------------------
const dir = join(here, '..', 'dev', 'x');
const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
const DEMO = 'x/excelbugs_demo';
const xAccounts = {};
for (const f of readdirSync(dir).filter((n) => n.endsWith('.json') && n !== 'meta.json')) {
  for (const pg of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    const r = XS.parsePayload(pg.url, JSON.stringify(pg.body));
    if (!r) continue;
    for (const p of r.posts) {
      const acc = xAccounts[p.owner] || (xAccounts[p.owner] = { posts: {}, updatedAt: Date.now(), platform: 'x' });
      acc.posts[p.code] = XS.merge(acc.posts[p.code], p);
    }
    for (const u of r.users || []) if (xAccounts[u.id]) xAccounts[u.id].profile = XS.mergeProfile(xAccounts[u.id].profile, u);
  }
}
const demoPosts = Object.values(xAccounts[DEMO].posts);
const xVideos = demoPosts.filter((p) => p.type === 'video' && p.kind === 'original').sort((a, b) => b.takenAt - a.takenAt);

// The same "tip" videos cross-posted as Instagram reels a day later (6 of the 11), plus unrelated reels.
const TWINS = xVideos.filter((p) => !p.pinned).slice(0, 6);
const igPosts = {};
TWINS.forEach((p, i) => {
  igPosts['IGTWIN' + i] = { code: 'IGTWIN' + i, owner: 'excelbugs_demo', type: 'reel', url: 'https://www.instagram.com/reel/IGTWIN' + i + '/',
    caption: p.caption + ' 🔥', hashtags: ['excel'], duration: p.duration, takenAt: p.takenAt + 864e5, views: 20000 + i * 5000, likes: 900, comments: 40 };
});
for (let i = 0; i < 10; i++) {
  igPosts['IGFILL' + i] = { code: 'IGFILL' + i, owner: 'excelbugs_demo', type: 'reel', url: 'https://www.instagram.com/reel/IGFILL' + i + '/',
    caption: ['sourdough bread at home', 'garden tomatoes harvest', 'morning run vlog', 'coffee latte art', 'desk setup tour'][i % 5] + ' ' + 'abcdefghij'[i],
    hashtags: ['life'], duration: 15, takenAt: Date.UTC(2025, 0, 1 + i * 10), views: 15000 + i * 1000, likes: 500, comments: 20 };
}
const org = { folders: [{ id: 'fx', name: 'Excel' }], accounts: { [DEMO]: { folder: 'fx', tags: ['x'] }, 'x/sheettips_demo': { folder: 'fx', tags: [] }, excelbugs_demo: { folder: 'fx', tags: [] } } };

// ---- server ---------------------------------------------------------------------
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(here, '..', 'mcp', 'server.mjs')],
  env: { ...process.env, OPENOUTLIER_HOME: home, OPENOUTLIER_PORT: String(FIRST) },
  stderr: 'pipe'
});
const client = new Client({ name: 'test-x', version: '1.0.0' });
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
function bridge(path, { method = 'GET', body } = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'content-type': 'application/json', origin: EXT_ORIGIN }, body: body ? JSON.stringify(body) : undefined });
}
async function nextCommands() {
  let cmds = [];
  for (let i = 0; i < 25 && !cmds.length; i++) {
    cmds = (await (await bridge('/commands')).json()).commands;
    if (!cmds.length) await new Promise((r) => setTimeout(r, 200));
  }
  return cmds;
}

test.after(async () => { await client.close(); });

test('sync: X accounts arrive with platform x next to Instagram', async () => {
  assert.ok(port, 'bridge port');
  const r = await bridge('/sync', { method: 'POST', body: { full: true, accounts: { ...xAccounts, excelbugs_demo: { posts: igPosts, updatedAt: Date.now() } }, org } });
  assert.equal(r.status, 200);
  assert.match(client.getInstructions(), /x\/name/);
  assert.match(client.getInstructions(), /never posts, likes, reposts or follows/);
});

test('ids: normUser, labels, platformOf, xAccount', () => {
  assert.deepEqual(['x/ExcelBugs_Demo', 'x:@Foo', 'https://x.com/ExcelBugs_Demo', 'twitter.com/Some_One/status/123', 'https://mobile.twitter.com/abc?s=20'].map(L.normUser),
    ['x/excelbugs_demo', 'x/foo', 'x/excelbugs_demo', 'x/some_one', 'x/abc']);
  assert.equal(L.normUser('@foo'), 'foo', 'a bare @name stays Instagram');
  assert.equal(L.normUser('https://x.com/home'), 'https://x.com/home', 'x.com/home is not a profile');
  assert.equal(L.labelOf(DEMO), '@excelbugs_demo (X)');
  const lib = { accounts: { [DEMO]: { posts: {}, platform: 'x' }, foo: { posts: {} } } };
  assert.equal(L.platformOf(lib, DEMO), 'x');
  assert.equal(L.platformOf(lib, 'x/unsaved'), 'x');
  assert.equal(L.platformOf(lib, 'foo'), 'instagram');
  assert.equal(L.xAccount('@Foo_Bar'), 'x/foo_bar');
  assert.equal(L.xAccount('x.com/Foo_Bar'), 'x/foo_bar');
  assert.equal(L.xPostIdOf('https://x.com/a/status/2120051831731126351?s=20'), '2120051831731126351');
  assert.equal(L.xPostIdOf('2120051831731126351'), null, 'bare ids are looked up as they are');
});

test('compare.js: X original videos only, X goes last', () => {
  assert.equal(C.isVideo({ platform: 'x', type: 'video', kind: 'original' }), true);
  assert.equal(C.isVideo({ platform: 'x', type: 'video', kind: 'reply' }), false);
  assert.equal(C.isVideo({ platform: 'x', type: 'video', kind: 'repost' }), false);
  assert.equal(C.isVideo({ platform: 'x', type: 'image', kind: 'original' }), false);
  assert.deepEqual(C.sideOrder('x', 'instagram'), ['instagram', 'x']);
  assert.deepEqual(C.sideOrder('youtube', 'x'), ['youtube', 'x']);
  assert.deepEqual(C.sideOrder('tiktok', 'instagram'), ['instagram', 'tiktok']);
});

test('list_accounts and list_folders_and_tags: X rows, per-format medians, folder counts', async () => {
  const list = await call('list_accounts', { platform: 'x' });
  assert.ok(list.data.accounts.every((a) => a.platform === 'x'));
  const row = list.data.accounts.find((a) => a.username === DEMO);
  assert.equal(row.handle, '@ExcelBugs_Demo');
  assert.equal(row.name, 'Excel Bugs (demo)');
  assert.equal(row.followers, 18400);
  assert.equal(row.verified, true);
  assert.equal(row.folder, 'Excel');
  assert.deepEqual(row.tags, ['x']);
  assert.ok(row.originals > 50 && row.replies > 0 && row.reposts > 0);
  assert.ok(row.median_views > 0);
  assert.ok(row.median_views_by_format.text > 0 && row.median_views_by_format.image > 0);
  assert.ok(row.formats_on_overall_median.includes('video'), 'fewer than 8 video posts with views: the overall median stands in');
  assert.ok(row.without_views >= meta.ids.old.length);

  const all = await call('list_accounts');
  assert.ok(all.data.accounts.some((a) => a.platform === 'x') && all.data.accounts.some((a) => a.platform === 'instagram'));

  const ft = await call('list_folders_and_tags');
  assert.deepEqual(ft.data.folders.find((f) => f.name === 'Excel'), { name: 'Excel', accounts: 3, instagram: 1, x: 2 });
});

test('account_summary for X: kinds, ≈ formats, posts without views, top originals', async () => {
  const s = await call('account_summary', { username: 'https://x.com/ExcelBugs_Demo' });
  assert.equal(s.isError, false, s.text);
  const d = s.data;
  assert.equal(d.account.platform, 'x');
  assert.ok(d.kinds.originals > 50 && d.kinds.replies > 0 && d.kinds.thread_parts > 0 && d.kinds.reposts > 0);
  const fmt = Object.fromEntries(d.formats.map((f) => [f.format, f]));
  assert.equal(fmt.text.approximate, undefined);
  assert.equal(fmt.text.median_text, String(fmt.text.median_views));
  assert.equal(fmt.video.approximate, true);
  assert.equal(fmt.video.median_views, d.summary.median_views);
  assert.match(fmt.video.median_text, /^≈\d+/);
  assert.ok(d.posts_without_views.count >= meta.ids.old.length);
  assert.match(d.views_note, /not the monetized impressions/);
  assert.match(d.how_scored, /fewer than 8/);
  assert.ok(d.summary.scored_approximately > 0 && d.summary.scored > d.summary.scored_approximately);
  assert.equal(d.top_posts.length, 10);
  assert.ok(d.top_posts.every((p) => p.platform === 'x' && p.kind === 'original'));
  for (let i = 1; i < d.top_posts.length; i++) assert.ok(d.top_posts[i - 1].x_account_median >= d.top_posts[i].x_account_median);
  const approx = d.top_posts.find((p) => p.median_approx);
  assert.ok(approx, 'some top posts are scored against the overall median');
  assert.match(approx.x_median_text, /^≈/);
  assert.match(approx.scored_against, /overall originals median/);
  assert.ok(Array.isArray(d.best_days) && d.text_length.length > 0 && d.links.length > 0);

  const missing = await call('account_summary', { username: 'x/nobody_here' });
  assert.ok(missing.isError && /collect_profile with x\/nobody_here/.test(missing.text));
});

test('top_reels / top_posts / search_reels rank X originals against their own medians', async () => {
  const xOnly = await call('top_reels', { platform: 'x', limit: 200 });
  assert.deepEqual(xOnly.data.platforms, ['x']);
  assert.ok(xOnly.data.reels.every((p) => p.platform === 'x' && p.kind === 'original'));
  assert.ok(new Set(xOnly.data.reels.map((p) => p.format)).size > 3, 'platform x ranks every format');
  assert.match(xOnly.data.x_note, /originals only/);

  const images = await call('top_reels', { x_format: 'image', usernames: ['@ExcelBugs_Demo'] });
  assert.equal(images.data.accounts, 1);
  assert.ok(images.data.reels.length > 0 && images.data.reels.every((p) => p.format === 'image' && p.account === DEMO));

  const mixed = await call('top_reels', { folder: 'Excel', limit: 200 });
  assert.deepEqual(mixed.data.platforms.sort(), ['instagram', 'x']);
  const xs = mixed.data.reels.filter((p) => p.platform === 'x');
  assert.ok(xs.length > 0 && xs.every((p) => p.format === 'video' && p.kind === 'original'), 'reels mode: X video posts only');
  assert.ok(mixed.data.reels.some((p) => p.platform === 'instagram'));

  const tp = await call('top_posts', { platform: 'x', accounts: ['x.com/ExcelBugs_Demo'], sort: 'score', limit: 20 });
  assert.equal(tp.data.platform, 'x');
  assert.ok(tp.data.posts.every((p) => p.account === DEMO && p.kind === 'original'));
  for (let i = 1; i < tp.data.posts.length; i++) assert.ok((tp.data.posts[i - 1].views ?? -1) >= (tp.data.posts[i].views ?? -1));
  const threads = await call('top_posts', { platform: 'x', post_type: 'thread' });
  assert.ok(threads.data.posts.length > 0 && threads.data.posts.every((p) => p.format === 'thread'));
  assert.ok((await call('top_posts', { platform: 'x', post_type: 'gallery' })).isError);
  assert.equal((await call('top_posts')).data.posts.length, 0, 'top_posts stays Reddit by default');

  const found = await call('search_reels', { query: 'tip', platform: 'x', limit: 200 });
  assert.ok(found.data.matched > 0);
  assert.ok(found.data.reels.every((p) => p.platform === 'x' && p.kind !== 'repost'));
});

test('get_reel: x.com and twitter.com status URLs and bare ids', async () => {
  const id = meta.ids.bigImage;
  const byUrl = await call('get_reel', { code: `https://x.com/ExcelBugs_Demo/status/${id}?s=20` });
  assert.equal(byUrl.data.platform, 'x');
  assert.equal(byUrl.data.code, id);
  assert.equal(byUrl.data.format, 'image');
  assert.equal(byUrl.data.author, '@ExcelBugs_Demo');
  assert.ok(byUrl.data.views > 0 && byUrl.data.x_account_median > 0);
  assert.ok(Array.isArray(byUrl.data.media) && byUrl.data.media.length > 0);
  assert.match(byUrl.data.views_note, /monetized/);
  assert.equal((await call('get_reel', { code: `https://twitter.com/excelbugs_demo/status/${id}` })).data.code, id);
  assert.equal((await call('get_reel', { code: id })).data.platform, 'x');

  const old = await call('get_reel', { code: meta.ids.old[0] });
  assert.equal(old.data.views, null);
  assert.equal(old.data.no_views, true);
  assert.equal(old.data.x_account_median, null);
  assert.match(old.data.views_note, /before 2023/);

  const repost = await call('get_reel', { code: meta.ids.reposts[0] });
  assert.equal(repost.data.kind, 'repost');
  assert.equal(repost.data.x_account_median, null);

  const nope = await call('get_reel', { code: 'https://x.com/someone/status/1999999999999999999' });
  assert.ok(nope.isError && /X post/.test(nope.text));
});

test('download_reel and refresh_reel never reach x.com for X posts', async () => {
  const dl = await call('download_reel', { code: `https://x.com/ExcelBugs_Demo/status/${meta.ids.pinned}` });
  assert.ok(dl.isError && /X post/.test(dl.text));
  assert.ok((await call('download_reel', { code: meta.ids.pinned })).isError);
  const rf = await call('refresh_reel', { code: meta.ids.bigImage, wait_seconds: 0 });
  assert.ok(rf.isError && /collect_profile with x\//.test(rf.text));
  assert.ok((await call('refresh_reel', { code: `https://x.com/a/status/${meta.ids.bigImage}`, wait_seconds: 0 })).isError);
  assert.equal((await (await bridge('/commands')).json()).commands.length, 0, 'nothing was queued');
});

test('collect_profile queues collect_x (≤ 300 posts) and returns the extension\'s result', async () => {
  const pending = call('collect_profile', { username: 'https://twitter.com/Some_New', max_reels: 1000, wait_seconds: 8 });
  const cmds = await nextCommands();
  assert.equal(cmds.length, 1);
  assert.equal(cmds[0].type, 'collect_x');
  assert.deepEqual(cmds[0].args, { username: 'some_new', maxPosts: 300 });
  const result = { ok: true, account: 'x/some_new', collected_now: 120, saved_total: 120, followers: 5000, rate_limit: { remaining: 38, reset: Date.now() + 9e5 }, stopped_because: 'six_months', note: 'Reached posts older than 6 months.' };
  await bridge('/commands/result', { method: 'POST', body: { id: cmds[0].id, result } });
  const res = await pending;
  assert.equal(res.data.state, 'done');
  assert.equal(res.data.account, 'x/some_new');
  assert.equal(res.data.result.stopped_because, 'six_months');
  assert.equal(res.data.result.rate_limit.remaining, 38);
  assert.equal(res.data.hint, 'Reached posts older than 6 months.');

  const pending2 = call('collect_profile', { username: 'x/Other_One', max_reels: 50, wait_seconds: 0 });
  const c2 = await nextCommands();
  assert.deepEqual(c2[0].args, { username: 'other_one', maxPosts: 50 });
  const r2 = await pending2;
  assert.match(r2.data.hint, /scrolls the X profile slowly/);
});

test('compare_platforms: X video posts against the same reels on Instagram', async () => {
  const cmp = await call('compare_platforms', { account_x: 'x/excelbugs_demo' });
  assert.equal(cmp.isError, false, cmp.text);
  const d = cmp.data;
  assert.equal(d.instagram, 'excelbugs_demo', 'default partner: the same handle on Instagram');
  assert.equal(d.x, DEMO);
  assert.deepEqual(d.platforms, ['Instagram', 'X (video posts)']);
  assert.equal(d.summary.x_videos, xVideos.length);
  assert.equal(d.summary.matched, TWINS.length);
  assert.equal(d.only_on_x.count, xVideos.length - TWINS.length);
  assert.equal(d.summary.x_video_median.approximate, true);
  assert.match(d.summary.x_note, /approximate/);
  assert.match(d.how_matched, /video posts/);
  for (const p of d.pairs) {
    assert.equal(p.x.caption.replace(/\s+/g, ' '), p.instagram.caption.replace(' 🔥', ''));
    assert.ok(p.days_apart <= 3 && ['instagram', 'x'].includes(p.better_on));
    assert.equal(p.x.median_approx, true);
    assert.ok(p.x.saves != null, 'bookmarks on the X side');
    assert.ok(p.x.x_account_median > 0 && p.instagram.x_account_median > 0);
  }
  assert.ok(d.summary.typical_x_to_instagram_views > 0);

  // x/name in another argument works too, as does a URL; IG given explicitly.
  assert.equal((await call('compare_platforms', { account_ig: 'x/excelbugs_demo' })).data.summary.matched, TWINS.length);
  assert.equal((await call('compare_platforms', { account_ig: 'excelbugs_demo', account_x: 'https://x.com/ExcelBugs_Demo' })).data.summary.matched, TWINS.length);

  const missing = await call('compare_platforms', { account_x: 'x/nobody_here', account_ig: 'excelbugs_demo' });
  assert.ok(missing.isError && /X account @nobody_here \(X\) is not in the library/.test(missing.text));
  assert.ok((await call('compare_platforms', { account_x: DEMO, account_ig: 'excelbugs_demo', account_tt: 'tt/someone' })).isError);
  const alone = await call('compare_platforms', { account_x: 'x/sheettips_demo' });
  assert.ok(alone.isError && /account_ig, account_tt or account_yt/.test(alone.text));
});

test('organize_library: X profile URLs become x/name, other accounts pass as given', async () => {
  const pending = call('organize_library', { ops: [
    { op: 'move', account: 'https://x.com/ExcelBugs_Demo', folder: 'X niche' },
    { op: 'tag', account: 'twitter.com/Sheettips_Demo', add: ['x'] },
    { op: 'move', account: 'excelbugs_demo', folder: 'X niche' }
  ], wait_seconds: 3 });
  const cmds = await nextCommands();
  assert.equal(cmds[0].type, 'org_edit');
  assert.deepEqual(cmds[0].args.ops.map((o) => o.account), [DEMO, 'x/sheettips_demo', 'excelbugs_demo']);
  await bridge('/commands/result', { method: 'POST', body: { id: cmds[0].id, result: { ok: true, changes: ['moved'] } } });
  assert.equal((await pending).data.state, 'done');
});
