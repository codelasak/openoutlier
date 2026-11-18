// The optional YouTube Data API key (phase 5): src/youtube-api.js, the MCP tool
// (mcp/youtube-api.mjs) and the service-worker job (src/youtube-api-bg.js), all
// with a mocked fetch. Without a key nothing may be requested.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const A = require('../src/youtube-api.js');
const Y = require('../src/youtube.js');

const home = mkdtempSync(join(tmpdir(), 'openoutlier-ytapi-'));
process.env.OPENOUTLIER_HOME = home;
delete process.env.OPENOUTLIER_YOUTUBE_API_KEY;
const KEY = 'AIza' + 'k'.repeat(35);
const UC = 'UC' + 'q'.repeat(22);
const id = (i) => 'yTapi' + String(i).padStart(6, '0');

function item(i, extra = {}) {
  return {
    id: id(i),
    snippet: { publishedAt: '2026-10-0' + ((i % 9) + 1) + 'T15:30:00Z', channelId: UC, channelTitle: 'Demo', title: 'Tip ' + i + ' #excel', description: 'More #exceltips', tags: ['excel'], categoryId: '27',
      thumbnails: { high: { url: `https://i.ytimg.com/vi/${id(i)}/hqdefault.jpg` }, maxres: { url: `https://i.ytimg.com/vi/${id(i)}/maxresdefault.jpg` } }, liveBroadcastContent: 'none' },
    statistics: { viewCount: String(1000 + i), likeCount: String(10 + i), commentCount: String(i) },
    contentDetails: { duration: i % 2 ? 'PT45S' : 'PT9M52S', caption: 'false' },
    ...extra
  };
}

/** A fake Google: answers videos / channels / playlistItems from small tables and logs every URL. */
function fakeGoogle({ videos = {}, uploads = [], shorts = null, channel = true, fail = null } = {}) {
  const calls = [];
  const res = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const fetch = async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (fail) return res(fail.status, fail.body);
    const path = u.pathname.split('/').pop();
    if (path === 'videos') return res(200, { items: u.searchParams.get('id').split(',').filter((x) => videos[x]).map((x) => videos[x]) });
    if (path === 'channels') return res(200, { items: channel ? [{ id: UC, snippet: { title: 'Demo', customUrl: '@DemoHandle', thumbnails: { high: { url: 'https://yt3.ggpht.com/a.jpg' } } }, statistics: { subscriberCount: '712000', videoCount: '776' }, contentDetails: { relatedPlaylists: { uploads: 'UU' + UC.slice(2) } } }] : [] });
    if (path === 'playlistItems') {
      const pl = u.searchParams.get('playlistId');
      const list = pl.startsWith('UUSH') ? shorts : uploads;
      if (!list) return res(404, { error: { code: 404, message: 'The playlist identified with the request\'s playlistId parameter cannot be found.', errors: [{ reason: 'playlistNotFound' }] } });
      const start = Number(u.searchParams.get('pageToken') || 0);
      const page = list.slice(start, start + 50);
      return res(200, { items: page.map((v) => ({ contentDetails: { videoId: v } })), nextPageToken: start + 50 < list.length ? String(start + 50) : undefined });
    }
    return res(404, {});
  };
  return { fetch, calls };
}

test('pure helpers: ISO durations, the Pacific quota day, keys', () => {
  assert.equal(A.isoDuration('PT9M52S'), 592);
  assert.equal(A.isoDuration('PT1H2M3S'), 3723);
  assert.equal(A.isoDuration('P1DT1S'), 86401);
  assert.equal(A.isoDuration('P0D'), 0);
  assert.equal(A.isoDuration('nope'), null);
  // 07:59 UTC on Nov 18 is still Nov 17 in Los Angeles; 08:00 UTC is Nov 18 (PST = UTC−8).
  assert.equal(A.quotaDay(Date.UTC(2026, 10, 18, 7, 59)), '2026-11-17');
  assert.equal(A.quotaDay(Date.UTC(2026, 10, 18, 8, 0)), '2026-11-18');
  const st = A.addUnits(A.addUnits(null, 3, Date.UTC(2026, 10, 18, 9)), 2, Date.UTC(2026, 10, 18, 20));
  assert.deepEqual(st, { day: '2026-11-18', units: 5 });
  assert.equal(A.usedToday(st, Date.UTC(2026, 10, 19, 9)), 0, 'a new Pacific day starts at 0');
  assert.ok(A.isKey(KEY));
  assert.ok(!A.isKey('') && !A.isKey('has spaces in it 1234567890') && !A.isKey(undefined));
});

test('videos.list item → an exact record that beats the rounded one through Y.merge', () => {
  const r = A.videoRecord(item(2), { owner: 'yt/demohandle' });
  assert.equal(r.views, 1002);
  assert.equal(r.viewsApprox, false);
  assert.equal(r.likes, 12);
  assert.equal(r.comments, 2);
  assert.equal(r.takenAt, Date.parse('2026-10-03T15:30:00Z'));
  assert.equal(r.dateApprox, false);
  assert.equal(r.duration, 592);
  assert.deepEqual(r.keywords, ['excel']);
  assert.deepEqual(r.hashtags, ['excel', 'exceltips']);
  assert.equal(r.category, 'Education');
  assert.equal(r.thumb, `https://i.ytimg.com/vi/${id(2)}/maxresdefault.jpg`);
  assert.equal(r.type, undefined, 'the API cannot tell a Short from a video: no type unless known');
  const rounded = { code: id(2), platform: 'youtube', type: 'short', owner: 'yt/demohandle', views: 1000, viewsApprox: true, takenAt: Date.UTC(2026, 9, 1), dateApprox: true };
  const m = Y.merge(rounded, r);
  assert.equal(m.type, 'short');
  assert.equal(m.views, 1002);
  assert.equal(m.viewsApprox, false);
  assert.equal(m.dateApprox, false);
  // Hidden likes / comments off: those fields stay unset.
  const hidden = A.videoRecord(item(3, { statistics: { viewCount: '5' } }));
  assert.equal(hidden.likes, undefined);
  assert.equal(hidden.comments, undefined);
  assert.equal(A.videoRecord(item(4, { liveStreamingDetails: { actualStartTime: 'x' } })).type, 'live');
});

test('exact stats: 50 ids per call (1 unit each), only the key, part=statistics,snippet,contentDetails', async () => {
  const videos = {};
  for (let i = 0; i < 120; i++) videos[id(i)] = item(i);
  const g = fakeGoogle({ videos });
  let units = 0;
  const posts = Object.keys(videos).map((code) => ({ code, owner: 'yt/demohandle' })).concat([{ code: 'goneVideo00', owner: 'yt/demohandle' }]);
  const r = await A.exactStats({ key: KEY, fetch: g.fetch, onUnits: (n) => { units += n; }, posts });
  assert.equal(g.calls.length, 3);
  assert.equal(units, 3);
  for (const url of g.calls) {
    const u = new URL(url);
    assert.equal(u.origin + u.pathname, 'https://www.googleapis.com/youtube/v3/videos');
    assert.match(u.searchParams.get('part'), /^statistics,snippet,contentDetails/);
    assert.ok(u.searchParams.get('id').split(',').length <= 50);
    assert.equal(u.searchParams.get('key'), KEY);
  }
  assert.equal(r.records.length, 120);
  assert.deepEqual(r.missing, ['goneVideo00']);
  assert.ok(r.records.every((x) => x.owner === 'yt/demohandle'));
});

test('channel uploads: channels.list + playlistItems pages, Shorts from the UUSH list, never search.list', async () => {
  const videos = {};
  const uploads = [];
  for (let i = 0; i < 60; i++) { videos[id(i)] = item(i); uploads.push(id(i)); }
  const shorts = uploads.filter((_, i) => i % 2);
  const g = fakeGoogle({ videos, uploads, shorts });
  const r = await A.channelUploads({ key: KEY, fetch: g.fetch, handle: 'demohandle', owner: 'yt/demohandle', max: 60, known: { [id(0)]: { type: 'live' } } });
  assert.ok(!g.calls.some((u) => /\/search\?/.test(u)), 'search.list costs 100 units: never used');
  const paths = g.calls.map((u) => new URL(u).pathname.split('/').pop());
  assert.deepEqual(paths, ['channels', 'playlistItems', 'playlistItems', 'playlistItems', 'videos', 'videos']);
  assert.equal(new URL(g.calls[0]).searchParams.get('forHandle'), '@demohandle');
  assert.equal(r.channel.channelId, UC);
  assert.equal(r.channel.subscribers, 712000);
  assert.equal(r.records.length, 60);
  assert.equal(r.records.find((x) => x.code === id(1)).type, 'short');
  assert.equal(r.records.find((x) => x.code === id(2)).type, 'video');
  assert.equal(r.records.find((x) => x.code === id(0)).type, 'live', 'a known type is kept');
  assert.equal(r.records.find((x) => x.code === id(1)).url, 'https://www.youtube.com/shorts/' + id(1));
  assert.ok(r.shortsKnown);

  // No Shorts playlist: ≤ 60 s counts as a Short, flagged as a guess.
  const g2 = fakeGoogle({ videos, uploads: uploads.slice(0, 4), shorts: null });
  const r2 = await A.channelUploads({ key: KEY, fetch: g2.fetch, channelId: UC, max: 4 });
  assert.equal(r2.shortsKnown, false);
  const odd = r2.records.find((x) => x.code === id(1));
  assert.equal(odd.type, 'short');
  assert.equal(odd.typeGuessed, true);
  assert.equal(r2.records.find((x) => x.code === id(2)).type, 'video');
});

test('API errors name the fix: quota, disabled API, bad key; no key → nothing requested', async () => {
  const quota = fakeGoogle({ fail: { status: 403, body: { error: { code: 403, message: 'The request cannot be completed because you have exceeded your quota.', errors: [{ reason: 'quotaExceeded' }] } } } });
  await assert.rejects(A.exactStats({ key: KEY, fetch: quota.fetch, posts: [{ code: id(1) }] }), (e) => e.code === 'quota' && /midnight Pacific/.test(e.hint));
  const off = fakeGoogle({ fail: { status: 403, body: { error: { code: 403, message: 'YouTube Data API v3 has not been used in project 1 before or it is disabled.', errors: [{ reason: 'accessNotConfigured' }] } } } });
  await assert.rejects(A.exactStats({ key: KEY, fetch: off.fetch, posts: [{ code: id(1) }] }), (e) => e.code === 'api_disabled');
  const bad = fakeGoogle({ fail: { status: 400, body: { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', errors: [{ reason: 'badRequest' }] } } } });
  await assert.rejects(A.exactStats({ key: KEY, fetch: bad.fetch, posts: [{ code: id(1) }] }), (e) => e.code === 'bad_key');
  const none = fakeGoogle({});
  await assert.rejects(A.exactStats({ key: '', fetch: none.fetch, posts: [{ code: id(1) }] }), (e) => e.code === 'no_key');
  assert.equal(none.calls.length, 0);
});

test('MCP youtube_api_stats: off without OPENOUTLIER_YOUTUBE_API_KEY; with it, exact values merge into the library', async () => {
  const lib = await import('../mcp/library.mjs');
  const api = await import('../mcp/youtube-api.mjs');
  const g = fakeGoogle({ videos: { [id(1)]: item(1), [id(2)]: item(2) }, uploads: [id(1), id(2), id(3)], shorts: [id(1)] });
  // No key: no request, a setup hint.
  const off = await api.apiStats({ account: 'yt/demohandle' }, { fetch: g.fetch, key: null });
  assert.equal(off.configured, false);
  assert.match(off.hint, /OPENOUTLIER_YOUTUBE_API_KEY/);
  assert.equal(g.calls.length, 0);
  assert.equal(api.apiKey(), null);

  lib.store().applySync({ full: false, accounts: { 'yt/demohandle': { platform: 'youtube', updatedAt: Date.now(), posts: {
    [id(1)]: { code: id(1), platform: 'youtube', type: 'short', owner: 'yt/demohandle', views: 1000, viewsApprox: true, files: [] },
    [id(2)]: { code: id(2), platform: 'youtube', type: 'video', owner: 'yt/demohandle', views: 1000, viewsApprox: true, takenAt: Date.UTC(2026, 9, 1), dateApprox: true, files: [] }
  } } } });
  const r = await api.apiStats({ account: 'yt/demohandle' }, { fetch: g.fetch, key: KEY });
  assert.equal(r.updated, 2);
  assert.equal(r.units_used, 1);
  assert.equal(r.quota.used_today, 1);
  let posts = lib.readLibrary().accounts['yt/demohandle'].posts;
  assert.equal(posts[id(2)].views, 1002);
  assert.equal(posts[id(2)].viewsApprox, false);
  assert.equal(posts[id(2)].dateApprox, false);
  assert.equal(posts[id(1)].type, 'short');

  // Uploads: adds the video the tabs never showed, fills the profile.
  const up = await api.apiStats({ account: 'yt/demohandle', uploads: true }, { fetch: g.fetch, key: KEY });
  assert.equal(up.channel.subscribers, 712000);
  assert.equal(up.uploads_listed, 2, 'id 3 is listed but videos.list does not return it');
  posts = lib.readLibrary().accounts['yt/demohandle'].posts;
  assert.equal(Object.keys(posts).length, 2);
  assert.equal(lib.readLibrary().accounts['yt/demohandle'].profile.channelId, UC);
  assert.ok(up.quota.used_today > r.quota.used_today);

  // A later extension sync with rounded numbers can't undo the API's exact ones.
  lib.store().applySync({ full: false, accounts: { 'yt/demohandle': { platform: 'youtube', updatedAt: Date.now(), posts: {
    [id(2)]: { code: id(2), platform: 'youtube', type: 'video', owner: 'yt/demohandle', views: 1000, viewsApprox: true, takenAt: Date.UTC(2026, 9, 1), dateApprox: true, files: [] }
  } } } });
  assert.equal(lib.readLibrary().accounts['yt/demohandle'].posts[id(2)].views, 1002);
  assert.equal(lib.readLibrary().accounts['yt/demohandle'].posts[id(2)].dateApprox, false);
});

test('service worker: "Exact stats via API" merges into chrome.storage and counts quota; no key → no fetch', async () => {
  const local = {};
  const listeners = [];
  const g = fakeGoogle({ videos: { [id(1)]: item(1), [id(2)]: item(2), [id(5)]: item(5) }, uploads: [id(1), id(2), id(5)], shorts: [id(1)] });
  const chrome = {
    runtime: { id: 'ext', onMessage: { addListener: (fn) => listeners.push(fn) } },
    storage: { local: {
      get: async (k) => { const out = {}; for (const x of [].concat(k)) if (x in local) out[x] = JSON.parse(JSON.stringify(local[x])); return out; },
      set: async (o) => { Object.assign(local, JSON.parse(JSON.stringify(o))); }
    } }
  };
  const ctx = { self: {}, chrome, console, Promise, Date, Math, Object, Array, String, JSON, Number, URL, Intl, isFinite, encodeURIComponent, setTimeout };
  ctx.self.fetch = g.fetch;
  ctx.self.OpenOutlierYouTube = Y;
  vm.runInNewContext(readFileSync(join(here, '..', 'src', 'youtube-api.js'), 'utf8'), ctx);
  vm.runInNewContext(readFileSync(join(here, '..', 'src', 'youtube-api-bg.js'), 'utf8'), ctx);
  const send = (msg) => new Promise((resolve) => { listeners.forEach((fn) => fn(msg, { id: 'ext' }, resolve)); });

  local['rs:p:yt/demohandle'] = { platform: 'youtube', posts: {
    [id(1)]: { code: id(1), platform: 'youtube', type: 'short', owner: 'yt/demohandle', views: 1000, viewsApprox: true },
    [id(2)]: { code: id(2), platform: 'youtube', type: 'video', owner: 'yt/demohandle', views: 1000, viewsApprox: true, dateApprox: true, takenAt: 1 }
  }, profile: { handle: 'DemoHandle' } };

  let st = await send({ type: 'reelscope:yt-api-status' });
  assert.equal(st.configured, false);
  const off = await send({ type: 'reelscope:yt-api', action: 'exact', owner: 'yt/demohandle' });
  assert.equal(off.ok, false);
  assert.equal(off.code, 'no_key');
  assert.equal(g.calls.length, 0, 'no key, no request');

  local['rs:settings'] = { youtubeApiKey: KEY };
  st = await send({ type: 'reelscope:yt-api-status' });
  assert.equal(st.configured, true);
  const r = await send({ type: 'reelscope:yt-api', action: 'exact', owner: 'yt/demohandle' });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.updated, 2);
  assert.equal(r.units, 1);
  const p2 = local['rs:p:yt/demohandle'].posts[id(2)];
  assert.equal(p2.views, 1002);
  assert.equal(p2.viewsApprox, false);
  assert.equal(p2.dateApprox, false);
  assert.equal(local['rs:p:yt/demohandle'].posts[id(1)].type, 'short');
  await new Promise((res) => setTimeout(res, 20));
  assert.equal(local['rs:yt-api-quota'].units, 1);

  const up = await send({ type: 'reelscope:yt-api', action: 'uploads', owner: 'yt/demohandle' });
  assert.equal(up.ok, true, up.error);
  assert.equal(up.added, 1);
  assert.equal(local['rs:p:yt/demohandle'].posts[id(5)].type, 'video', '45 s but not in the Shorts list: the list wins over the length');
  assert.equal(local['rs:p:yt/demohandle'].profile.subscribers, 712000);
  assert.equal(local['rs:p:yt/demohandle'].profile.handle, 'DemoHandle', 'the stored handle case is kept');
  assert.equal(new URL(g.calls.find((u) => /channels\?/.test(u))).searchParams.get('forHandle'), '@DemoHandle');
  const bad = await send({ type: 'reelscope:yt-api', action: 'exact', owner: '../etc' });
  assert.equal(bad.ok, false);
});
