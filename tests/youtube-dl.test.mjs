// YouTube video downloads (mcp/youtube-dl.mjs): arguments, id checks, error
// mapping, info JSON → library, the bridge route and download_reel, all with a
// fake yt-dlp (a small node script) instead of the real one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'openoutlier-ytdl-'));
const home = join(tmp, 'home');
const downloads = join(tmp, 'Downloads');
const argLog = join(tmp, 'args.jsonl');
const FIRST = 47951; // test range, away from the real one and tests/mcp.test.mjs

const ID = 'yTdemo00029';
const UC = 'UC' + 'x'.repeat(22);
const heat = Array.from({ length: 100 }, (_, i) => ({ start_time: i * 5.92, end_time: (i + 1) * 5.92, value: i === 0 ? 1 : i === 42 ? 0.9 : 0.2 }));
const INFO = {
  id: ID, title: 'Lookup in Excel #excel', description: 'All about lookups. #exceltips', fulltitle: 'Lookup in Excel #excel',
  channel: 'Demo Channel', channel_id: UC, uploader_id: '@DemoHandle', uploader_url: 'https://www.youtube.com/@DemoHandle',
  view_count: 801352, like_count: 13398, comment_count: 234, timestamp: 1746703848, upload_date: '20250508',
  duration: 592, tags: ['excel', 'xlookup'], categories: ['Education'], media_type: 'video', width: 1920, height: 1080,
  chapters: [{ start_time: 0, end_time: 60, title: 'Intro' }, { start_time: 60.4, end_time: 592, title: 'XLOOKUP' }],
  heatmap: heat, thumbnail: `https://i.ytimg.com/vi/${ID}/maxresdefault.jpg`, availability: 'public', live_status: 'not_live',
  automatic_captions: { en: [] }, subtitles: {}
};

// The fake yt-dlp: logs its arguments, prints progress like the real one, writes the files.
const fake = join(tmp, 'fake-yt-dlp');
writeFileSync(fake, `#!${process.execPath}
const fs = require('fs'), path = require('path');
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(argLog)}, JSON.stringify(a) + '\\n');
const url = a[a.length - 1];
const id = url.split('v=')[1];
const P = a[a.indexOf('-P') + 1];
const out = (ext) => path.join(P, a[a.indexOf('-o') + 1].replace('%(ext)s', ext));
const info = ${JSON.stringify(INFO)};
if (id === 'privAteVid0') { console.error('ERROR: [youtube] privAteVid0: Private video. Sign in if you\\'ve been granted access to this video'); process.exit(1); }
if (id === 'bLockedVid0') { console.error('WARNING: [youtube] bLockedVid0: Some web client https formats have been skipped as they are missing a url. YouTube is forcing SABR streaming for this client.'); console.error('ERROR: [youtube] bLockedVid0: Requested format is not available. Use --list-formats for a list of available formats'); process.exit(1); }
if (id === 'sLowVideo00') { setTimeout(() => {}, 60000); return; }
info.id = id;
console.log('[youtube] Extracting URL: ' + url);
console.log('[info] ' + id + ': Downloading 1 format(s): 137+140');
fs.writeFileSync(out('info.json'), JSON.stringify(info));
if (a.includes('--write-thumbnail')) { fs.writeFileSync(out('jpg'), Buffer.alloc(3000, 1)); console.log('[ThumbnailsConvertor] Converting thumbnail'); }
if (!a.includes('--skip-download')) {
  console.log('[download] Destination: ' + out('f137.mp4'));
  console.log('[oo-progress] 500 1000 NA 250000.5 2');
  console.log('[oo-progress] 1000 1000 NA 250000.5 0');
  console.log('[download] Destination: ' + out('f140.m4a'));
  console.log('[oo-progress] 10 NA 40 NA NA');
  console.log('[Merger] Merging formats into "' + out('mp4') + '"');
  fs.writeFileSync(out('mp4'), Buffer.alloc(5000, 2));
}
`);
chmodSync(fake, 0o755);

Object.assign(process.env, { OPENOUTLIER_HOME: home, OPENOUTLIER_DOWNLOADS: downloads, OPENOUTLIER_YTDLP: fake, OPENOUTLIER_PORT: String(FIRST) });
delete process.env.OPENOUTLIER_YTDLP_COOKIES;
const D = await import('../mcp/youtube-dl.mjs');
const { store, readLibrary } = await import('../mcp/library.mjs');
const { startBridge } = await import('../mcp/bridge.mjs');
const Y = createRequire(import.meta.url)('../src/youtube.js');

const lastArgs = () => JSON.parse(readFileSync(argLog, 'utf8').trim().split('\n').pop());

// A rounded record as the extension saves it from a channel grid.
const rounded = { code: ID, platform: 'youtube', type: 'video', owner: 'yt/demohandle', author: 'DemoHandle', url: Y.videoUrl(ID, 'video'),
  views: 801000, viewsApprox: true, takenAt: Date.UTC(2025, 4, 1), dateApprox: true, caption: 'Lookup in Excel #excel', thumb: `https://i.ytimg.com/vi/${ID}/hq720.jpg`, files: [] };
store().applySync({ full: false, accounts: { 'yt/demohandle': { posts: { [ID]: rounded }, updatedAt: Date.now(), platform: 'youtube' } } });

test('arguments: format, merge, thumbnail, info JSON, no playlist, URL after --', () => {
  const v = D.buildArgs({ id: ID, what: 'video', outDir: '/x', base: 'oo-' + ID });
  assert.deepEqual(v.slice(-2), ['--', 'https://www.youtube.com/watch?v=' + ID]);
  assert.equal(v[v.indexOf('-f') + 1], 'bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b');
  assert.equal(v[v.indexOf('--merge-output-format') + 1], 'mp4');
  for (const f of ['--write-info-json', '--no-playlist']) assert.ok(v.includes(f), f);
  assert.ok(!v.includes('--write-thumbnail') && !v.includes('--skip-download') && !v.includes('--cookies-from-browser'));
  assert.equal(v[v.indexOf('-P') + 1], '/x');
  assert.equal(v[v.indexOf('-o') + 1], `oo-${ID}.%(ext)s`);

  const b = D.buildArgs({ id: ID, what: 'both', outDir: '/x', base: 'b', ffmpeg: '/opt/homebrew/bin/ffmpeg', cookies: 'chrome' });
  assert.ok(b.includes('--write-thumbnail') && b.includes('-f'));
  assert.equal(b[b.indexOf('--convert-thumbnails') + 1], 'jpg');
  assert.equal(b[b.indexOf('--ffmpeg-location') + 1], '/opt/homebrew/bin/ffmpeg');
  assert.equal(b[b.indexOf('--cookies-from-browser') + 1], 'chrome');

  const c = D.buildArgs({ id: '-dashStart1', what: 'cover', outDir: '/x', base: 'c' });
  assert.ok(c.includes('--skip-download') && c.includes('--write-thumbnail') && !c.includes('-f'));
  assert.equal(c[c.length - 1], 'https://www.youtube.com/watch?v=-dashStart1'); // an id starting with "-" is never read as an option
});

test('video ids are checked before anything runs', async () => {
  for (const bad of ['short', 'yTdemo000290', 'yTdemo0002;', '../../etc/x', 'a b c d e f', '$(rm -rf ~)', null, 12345678901]) {
    assert.equal(D.isVideoId(bad), false, String(bad));
    assert.throws(() => D.buildArgs({ id: bad, outDir: '/x', base: 'b' }));
  }
  const before = existsSync(argLog) ? readFileSync(argLog, 'utf8') : '';
  const r = await D.downloadYouTube({ id: 'x;touch /tmp/p' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'bad_id');
  assert.equal(existsSync(argLog) ? readFileSync(argLog, 'utf8') : '', before, 'yt-dlp must not run');
  assert.throws(() => D.buildArgs({ id: ID, what: 'audio', outDir: '/x', base: 'b' }));
  assert.throws(() => D.buildArgs({ id: ID, outDir: '/x', base: '../b' }));
});

test('locating yt-dlp: the setting wins, a wrong path says so with the install hint', () => {
  assert.equal(D.locateYtDlp().bin, fake);
  process.env.OPENOUTLIER_YTDLP = join(tmp, 'nope');
  try {
    const r = D.locateYtDlp();
    assert.equal(r.error.code, 'missing');
    assert.match(r.error.message, /OPENOUTLIER_YTDLP/);
    assert.match(r.error.hint, /brew install yt-dlp/);
  } finally { process.env.OPENOUTLIER_YTDLP = fake; }
  delete process.env.OPENOUTLIER_YTDLP;
  try {
    assert.equal(D.findExecutable('yt-dlp', { path: tmp, extra: [] }), null);
    writeFileSync(join(tmp, 'yt-dlp'), 'x'); // not executable
    assert.equal(D.findExecutable('yt-dlp', { path: tmp, extra: [] }), null);
    chmodSync(join(tmp, 'yt-dlp'), 0o755);
    assert.equal(D.findExecutable('yt-dlp', { path: '/nowhere', extra: [tmp] }), join(tmp, 'yt-dlp'));
  } finally { process.env.OPENOUTLIER_YTDLP = fake; }
});

test('errors are mapped to what to do', () => {
  const e = (s, o) => D.explainError(s, o);
  assert.equal(e('', { spawnError: Object.assign(new Error('spawn x ENOENT'), { code: 'ENOENT' }) }).code, 'missing');
  assert.match(e('', { spawnError: { code: 'ENOENT' } }).hint, /brew install yt-dlp/);
  assert.equal(e('', { timedOut: true }).code, 'timeout');
  assert.equal(e('ERROR: [youtube] abc: Private video. Sign in if you\'ve been granted access').code, 'private');
  assert.equal(e('ERROR: [youtube] abc: Join this channel to get access to members-only content like this video').code, 'members_only');
  const age = e('ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.');
  assert.equal(age.code, 'age_restricted');
  assert.match(age.hint, /OPENOUTLIER_YTDLP_COOKIES/);
  for (const s of ['ERROR: [youtube] abc: Requested format is not available', 'WARNING: [youtube] abc: YouTube is forcing SABR streaming for this client', 'ERROR: abc: nsig extraction failed: You may experience throttling', 'WARNING: [youtube] abc: GVS PO Token is required for this format', 'ERROR: unable to download video data: HTTP Error 403: Forbidden']) {
    const r = e(s);
    assert.equal(r.code, 'blocked', s);
    assert.match(r.hint, /brew upgrade yt-dlp/);
    assert.match(r.hint, /bgutil-ytdlp-pot-provider/);
  }
  assert.equal(e('WARNING: [youtube] Some web client https formats have been skipped as they are missing a url. YouTube is forcing SABR streaming for this client.\nERROR: [youtube] jNQXAC9IVRw: The page needs to be reloaded.').code, 'blocked'); // real output of yt-dlp 2025.06 in Nov 2026
  const js = e('WARNING: [youtube] No supported JavaScript runtime could be found. YouTube extraction without a JS runtime has been deprecated\nERROR: [youtube] abc: Requested format is not available');
  assert.equal(js.code, 'js_runtime');
  assert.match(js.hint, /brew install deno/);
  assert.equal(e('ERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies-from-browser').code, 'bot_check');
  assert.equal(e('ERROR: Postprocessing: ffprobe and ffmpeg not found. Please install or provide the path using --ffmpeg-location').code, 'ffmpeg_missing');
  assert.equal(e('ERROR: [youtube] abc: Video unavailable. This video has been removed by the uploader').code, 'unavailable');
  assert.equal(e('ERROR: [youtube] abc: This live event will begin in 3 hours.').code, 'live');
  const other = e('ERROR: something new', { exitCode: 2 });
  assert.equal(other.code, 'failed');
  assert.match(other.message, /exit 2.*something new/);
});

test('progress lines', () => {
  const st = { streams: 0, split: true };
  assert.equal(D.parseProgressLine('[youtube] abc: Downloading webpage', st).phase, 'starting');
  assert.equal(D.parseProgressLine('[download] Destination: /x/oo.f137.mp4', st).phase, 'video');
  const p = D.parseProgressLine('[oo-progress] 250 1000 NA 1234.5 3', st);
  assert.deepEqual([p.phase, p.percent, p.eta], ['video', 25, 3]);
  assert.match(D.progressLabel(p), /Downloading video 25% \(3s left\)/);
  D.parseProgressLine('[download] Destination: /x/oo.f140.m4a', st);
  const a = D.parseProgressLine('[oo-progress] 10 NA 40 NA NA', st);
  assert.deepEqual([a.phase, a.percent], ['audio', 25]);
  assert.equal(D.parseProgressLine('[Merger] Merging formats into "x.mp4"', st).phase, 'merging');
  assert.equal(D.parseProgressLine('[download]  42.0% of 10MiB', st).percent, 42);
  assert.equal(D.parseProgressLine('random text', st), null);
});

test('info JSON → record in the phase 2 shapes', () => {
  const r = D.recordFromInfo(INFO, { now: 1 });
  assert.equal(r.owner, 'yt/demohandle');
  assert.equal(r.ownerId, UC);
  assert.deepEqual([r.views, r.viewsApprox, r.likes, r.comments], [801352, false, 13398, 234]);
  assert.deepEqual([r.takenAt, r.dateApprox], [1746703848000, false]);
  assert.deepEqual(r.keywords, ['excel', 'xlookup']);
  assert.equal(r.category, 'Education');
  assert.deepEqual(r.chapters, [{ title: 'Intro', start: 0 }, { title: 'XLOOKUP', start: 60 }]);
  assert.equal(r.heatmap.length, 100);
  assert.equal(r.heatmap[42], 0.9);
  assert.deepEqual(r.heatmapPeaks, [Math.round(42.5 * 5.92)]); // highest point after the first value
  assert.equal(r.heatmapStep, 5.92);
  assert.deepEqual(r.hashtags, ['excel', 'exceltips']);
  assert.equal(r.type, 'video');
  assert.equal(r.hasCaptions, true);
  assert.equal(r.autoCaptions, true);
  // Shorts, live streams and an upload date without a time.
  assert.equal(D.recordFromInfo({ ...INFO, media_type: 'short' }).type, 'short');
  assert.equal(D.recordFromInfo({ ...INFO, media_type: 'short' }).url, 'https://www.youtube.com/shorts/' + ID);
  assert.equal(D.recordFromInfo({ ...INFO, media_type: undefined, duration: 40, width: 1080, height: 1920 }).type, 'short');
  assert.equal(D.recordFromInfo({ ...INFO, media_type: undefined, live_status: 'was_live' }).type, 'live');
  const day = D.recordFromInfo({ ...INFO, timestamp: undefined });
  assert.deepEqual([day.takenAt, day.dateApprox, day.dateDay], [Date.UTC(2025, 4, 8, 12), true, true]);
  assert.equal(D.recordFromInfo({ ...INFO, id: 'bad' }), null);
  assert.equal(D.recordFromInfo({ ...INFO, uploader_id: null, uploader_url: null, channel_url: null }).owner, 'yt/' + UC);
});

test('download: files named with the exact stats, library back-filled, a later rounded sync can\'t undo it', async () => {
  const seen = [];
  const r = await D.downloadYouTube({ id: ID, what: 'both', onProgress: (p) => seen.push(p) });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const dir = join(downloads, 'yt_demohandle');
  assert.equal(r.dir, dir);
  const names = readdirSync(dir).sort();
  const base = '801.4Kviews_13.4Klikes_234comments_1.7pct_youtube_' + ID;
  assert.deepEqual(names, [base + '.info.json', base + '.mp4', base + '_cover.jpg']);
  assert.deepEqual(r.files.map((f) => f.kind).sort(), ['cover', 'info', 'video']);
  assert.equal(r.files.find((f) => f.kind === 'video').bytes, 5000);
  assert.ok(!readdirSync(downloads).some((f) => f.startsWith('.openoutlier-')), 'staging folder removed');
  assert.ok(seen.some((p) => p.phase === 'video' && p.percent === 50));
  assert.ok(seen.some((p) => p.phase === 'audio'));
  assert.ok(seen.some((p) => p.phase === 'merging'));

  let p = readLibrary().accounts['yt/demohandle'].posts[ID];
  assert.deepEqual([p.views, p.viewsApprox, p.likes, p.comments, p.takenAt, p.dateApprox], [801352, false, 13398, 234, 1746703848000, false]);
  assert.equal(p.heatmap.length, 100);
  assert.equal(p.chapters.length, 2);
  assert.equal(p.thumb, `https://i.ytimg.com/vi/${ID}/maxresdefault.jpg`);
  assert.equal(r.post.views, 801352);
  assert.ok(store().history(ID).some((h) => h.views === 801352), 'a snapshot with the exact numbers');

  // The extension syncs its rounded copy again (full and incremental): exact values stay.
  store().applySync({ full: true, accounts: { 'yt/demohandle': { posts: { [ID]: rounded }, updatedAt: Date.now(), platform: 'youtube' } } });
  store().applySync({ full: false, accounts: { 'yt/demohandle': { posts: { [ID]: { ...rounded, views: 790000 } }, updatedAt: Date.now(), platform: 'youtube' } } });
  p = readLibrary().accounts['yt/demohandle'].posts[ID];
  assert.deepEqual([p.views, p.viewsApprox, p.takenAt, p.dateApprox], [801352, false, 1746703848000, false]);
  assert.equal(p.heatmap.length, 100, 'fields the extension never had stay');
  // A rounded number above the exact one means the video grew: it wins, flagged rounded.
  store().applySync({ full: false, accounts: { 'yt/demohandle': { posts: { [ID]: { ...rounded, views: 900000 } }, updatedAt: Date.now(), platform: 'youtube' } } });
  p = readLibrary().accounts['yt/demohandle'].posts[ID];
  assert.deepEqual([p.views, p.viewsApprox, p.dateApprox], [900000, true, false]);
  // Instagram posts still sync as before (replaced, no merge).
  store().applySync({ full: false, accounts: { 'ig.acc': { posts: { abc: { code: 'abc', views: 10, caption: 'x' } }, updatedAt: Date.now() } } });
  store().applySync({ full: false, accounts: { 'ig.acc': { posts: { abc: { code: 'abc', views: 5 } }, updatedAt: Date.now() } } });
  assert.deepEqual(readLibrary().accounts['ig.acc'].posts.abc, { code: 'abc', views: 5 });
});

test('download: video only has no cover; cover only keeps no video and no info JSON', async () => {
  const dir = join(tmp, 'custom');
  const v = await D.downloadYouTube({ id: ID, what: 'video', directory: dir });
  assert.equal(v.ok, true);
  assert.ok(!lastArgs().includes('--write-thumbnail'));
  assert.deepEqual(readdirSync(dir).filter((f) => !f.startsWith('.')).map((f) => f.replace(/^.*_youtube_/, '')).sort(), [ID + '.info.json', ID + '.mp4']);
  const c = await D.downloadYouTube({ id: ID, what: 'cover', directory: join(tmp, 'covers') });
  assert.equal(c.ok, true);
  assert.ok(lastArgs().includes('--skip-download'));
  assert.deepEqual(c.files.map((f) => f.kind), ['cover']);
  assert.deepEqual(readdirSync(join(tmp, 'covers')), [c.files[0].path.split('/').pop()]);
});

test('download errors: clear message, staging removed, nothing half-saved', async () => {
  const r = await D.downloadYouTube({ id: 'privAteVid0', what: 'video' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'private');
  const b = await D.downloadYouTube({ id: 'bLockedVid0', what: 'video' });
  assert.equal(b.error.code, 'blocked');
  assert.match(b.error.hint, /brew upgrade yt-dlp/);
  const t = await D.downloadYouTube({ id: 'sLowVideo00', what: 'video', timeoutMs: 300 });
  assert.equal(t.error.code, 'timeout');
  assert.ok(!readdirSync(downloads).some((f) => f.startsWith('.openoutlier-')));
  process.env.OPENOUTLIER_YTDLP = join(tmp, 'missing-yt-dlp');
  try {
    const m = await D.downloadYouTube({ id: ID });
    assert.equal(m.error.code, 'missing');
  } finally { process.env.OPENOUTLIER_YTDLP = fake; }
});

test('cookies only when OPENOUTLIER_YTDLP_COOKIES is set', async () => {
  await D.downloadYouTube({ id: ID, what: 'cover', directory: join(tmp, 'c2') });
  assert.ok(!lastArgs().includes('--cookies-from-browser'));
  process.env.OPENOUTLIER_YTDLP_COOKIES = 'chrome';
  try {
    await D.downloadYouTube({ id: ID, what: 'cover', directory: join(tmp, 'c3') });
    const a = lastArgs();
    assert.equal(a[a.indexOf('--cookies-from-browser') + 1], 'chrome');
  } finally { delete process.env.OPENOUTLIER_YTDLP_COOKIES; }
});

test('bridge: POST /youtube/download starts a job, the status route reports progress and files', async () => {
  const b = await startBridge();
  assert.ok(b.server && b.port >= FIRST);
  const origin = 'chrome-extension://' + 'b'.repeat(32);
  const req = (path, opts = {}) => fetch(`http://127.0.0.1:${b.port}${path}`, { ...opts, headers: { 'content-type': 'application/json', ...(opts.origin === null ? {} : { origin: opts.origin || origin }) } });
  try {
    assert.equal((await req('/youtube/download', { method: 'POST', body: JSON.stringify({ id: ID }), origin: 'https://www.youtube.com' })).status, 403);
    assert.equal((await req('/youtube/download', { method: 'POST', body: JSON.stringify({ id: ID }), origin: null })).status, 403);
    assert.equal((await req('/youtube/download', { method: 'POST', body: JSON.stringify({ id: '../x' }) })).status, 400);
    assert.equal((await req('/youtube/download', { method: 'POST', body: JSON.stringify({ id: ID, what: 'audio' }) })).status, 400);
    const health = await (await fetch(`http://127.0.0.1:${b.port}/health`)).json();
    assert.ok(health.features.includes('youtube-download'));

    const start = await (await req('/youtube/download', { method: 'POST', body: JSON.stringify({ id: ID, what: 'video', post: { owner: 'yt/demohandle', type: 'video', views: 1 } }) })).json();
    assert.equal(start.ok, true);
    assert.match(start.job, /^[0-9a-f-]{36}$/);
    let st;
    for (let i = 0; i < 50; i++) {
      st = await (await req('/youtube/download/' + start.job)).json();
      if (st.state === 'done' || st.state === 'error') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(st.state, 'done', JSON.stringify(st));
    const video = st.files.find((f) => f.kind === 'video');
    assert.ok(video.path.startsWith(join(downloads, 'yt_demohandle')));
    assert.equal(st.post.views, 801352);
    assert.equal(st.post.viewsApprox, false);
    assert.equal((await req('/youtube/download/00000000-0000-0000-0000-000000000000')).status, 404);
    // The extension's status poll as Chrome sends it: POST …?as=get (its GETs carry no Origin).
    const polled = await req('/youtube/download/' + start.job + '?as=get', { method: 'POST', body: '{}' });
    assert.equal(polled.status, 200);
    assert.equal((await polled.json()).state, 'done');
    assert.equal((await req('/youtube/download/' + start.job + '?as=get', { method: 'POST', body: '{}', origin: null })).status, 403);
    const err = await (await req('/youtube/download', { method: 'POST', body: JSON.stringify({ id: 'privAteVid0' }) })).json();
    for (let i = 0; i < 50; i++) {
      st = await (await req('/youtube/download/' + err.job)).json();
      if (st.state !== 'queued' && st.state !== 'running') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(st.state, 'error');
    assert.equal(st.error.code, 'private');
  } finally {
    b.server.close();
  }
});

test('MCP download_reel: YouTube URL not in the library, and a saved video', async () => {
  const require = createRequire(join(here, '..', 'mcp', 'package.json'));
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(here, '..', 'mcp', 'server.mjs')],
    env: { ...process.env, OPENOUTLIER_HOME: home, OPENOUTLIER_DOWNLOADS: downloads, OPENOUTLIER_YTDLP: fake, OPENOUTLIER_PORT: String(FIRST + 5) },
    stderr: 'pipe'
  });
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(transport);
  try {
    const call = async (args) => { const r = await client.callTool({ name: 'download_reel', arguments: args }); return { isError: !!r.isError, text: r.content[0].text }; };
    const saved = await call({ code: ID, what: 'video' });
    assert.equal(saved.isError, false, saved.text);
    const d = JSON.parse(saved.text);
    assert.equal(d.via, 'yt-dlp');
    assert.equal(d.saved.find((f) => f.kind === 'video').bytes, 5000);
    assert.equal(d.stats.views, 801352);
    assert.equal(d.stats.date_exact, true);
    assert.deepEqual(d.stats.most_replayed_at_s, [Math.round(42.5 * 5.92)]);
    assert.equal(d.library_updated, true);

    const fresh = await call({ code: 'https://youtu.be/newVideo012?si=x', what: 'cover', directory: join(tmp, 'mcp') });
    assert.equal(fresh.isError, false, fresh.text);
    assert.equal(JSON.parse(fresh.text).saved[0].kind, 'cover');
    assert.equal(readLibrary().accounts['yt/demohandle'].posts.newVideo012.views, 801352, 'a video not saved before joins its channel');

    const priv = await call({ code: 'https://www.youtube.com/watch?v=privAteVid0' });
    assert.equal(priv.isError, true);
    assert.match(priv.text, /private/i);
    const unknown = await call({ code: 'zzzzzzzzzzz' });
    assert.equal(unknown.isError, true);
    assert.match(unknown.text, /full URL/);
  } finally {
    await client.close();
  }
});
