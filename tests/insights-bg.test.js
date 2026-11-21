// Phase 3's service-worker side (src/youtube-insights-bg.js) in a sandbox with a fake chrome,
// a fake fetch and a fake clock: channels.list batching and its 7-day cache (and nothing without
// a key), the monetization queue (checking → cached verdict, a channel stops at its first ad,
// ≤ 10 watch pages a minute, off means no request), Return YouTube Dislike (cache, failures).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const src = (f) => readFileSync(join(__dirname, '..', 'src', f), 'utf8');
const fx = (f) => readFileSync(join(__dirname, '..', 'dev', 'youtube', 'cards', f), 'utf8');
const KEY = 'AIza' + 'k'.repeat(35);
const T0 = Date.UTC(2026, 10, 21, 12);

function worker(opts = {}) {
  const local = JSON.parse(JSON.stringify(opts.local || {}));
  const session = {};
  const listeners = [];
  const clock = { t: T0 };
  const fetches = [];
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { super(...(a.length ? a : [clock.t])); } static now() { return clock.t; } }
  const store = (m) => ({
    get: async (k) => { const out = {}; for (const x of [].concat(k)) if (x in m) out[x] = JSON.parse(JSON.stringify(m[x])); return out; },
    set: async (o) => { for (const [k, v] of Object.entries(o)) m[k] = JSON.parse(JSON.stringify(v)); }
  });
  const chrome = {
    runtime: { id: 'ext', onMessage: { addListener: (fn) => listeners.push(fn) } },
    storage: { local: store(local), session: store(session), onChanged: { addListener() {} } }
  };
  const res = (status, body, json) => ({ ok: status >= 200 && status < 300, status, text: async () => body, json: async () => json !== undefined ? json : JSON.parse(body) });
  const fetch = async (url) => {
    url = String(url);
    fetches.push({ url, at: clock.t });
    if (opts.fetch) { const r = await opts.fetch(url, clock); if (r) return r; }
    if (url.includes('/youtube/v3/channels')) {
      const ids = decodeURIComponent(url.match(/[?&]id=([^&]+)/)[1]).split(',');
      return res(200, '', { items: ids.filter((id) => !id.includes('Gone')).map((id) => ({ id, snippet: { title: 'T ' + id.slice(2, 6), customUrl: '@h' + id.slice(2, 6), publishedAt: '2020-01-01T00:00:00Z', country: 'TR' }, statistics: { subscriberCount: '1000', viewCount: '500000', videoCount: '50' } })) });
    }
    if (url.includes('returnyoutubedislikeapi.com')) return res(200, '', { id: 'x', likes: 100, dislikes: 7, rating: 4.8 });
    if (url.includes('youtube.com/watch')) return res(200, fx('watch-not-monetized.html'));
    return res(404, 'no');
  };
  const sandbox = {
    console, Promise, Object, Array, JSON, Math, Number, String, RegExp, Error, encodeURIComponent, decodeURIComponent, isFinite, Intl, URLSearchParams,
    Date: FakeDate,
    AbortSignal: { timeout: () => undefined },
    setTimeout: (fn, ms) => { setImmediate(() => { clock.t += ms || 0; fn(); }); return 0; },
    clearTimeout() {}
  };
  sandbox.self = sandbox;
  sandbox.chrome = chrome;
  sandbox.fetch = fetch;
  vm.createContext(sandbox);
  for (const f of ['features.js', 'youtube.js', 'youtube-api.js', 'yt-insights.js']) vm.runInContext(src(f), sandbox, { filename: f });
  // The quota bookkeeping lives in youtube-api-bg.js; a stand-in counts the units.
  const units = [];
  sandbox.OpenOutlierYouTubeApiBg = { spend: (n) => units.push(n), status: async () => ({ quota: { used: opts.used || 0 } }) };
  vm.runInContext(src('youtube-insights-bg.js'), sandbox, { filename: 'youtube-insights-bg.js' });
  // Answers cross the sandbox boundary as JSON, like chrome.runtime messages do.
  const send = (msg) => new Promise((resolve) => { listeners.forEach((fn) => fn(msg, { id: 'ext' }, (r) => resolve(JSON.parse(JSON.stringify(r))))); });
  return { send, local, fetches, clock, units, Bg: sandbox.OpenOutlierInsightsBg };
}
const settle = () => new Promise((r) => setTimeout(r, 30));
async function until(fn, n = 400) { for (let i = 0; i < n; i++) { if (await fn()) return true; await new Promise((r) => setImmediate(r)); } return false; }

test('channels.list: nothing without a key; one call per 50 with one; a 7-day cache; missing channels cached as null', async () => {
  const ids = ['UCaaaa' + 'a'.repeat(18), 'UCbbbb' + 'b'.repeat(18), 'UCGone' + 'c'.repeat(18)];
  const w0 = worker();
  const r0 = await w0.send({ type: 'reelscope:yt-channels', ids });
  assert.deepEqual([r0.ok, r0.noKey, Object.keys(r0.channels).length, w0.fetches.length], [true, true, 0, 0]);

  const w = worker({ local: { 'rs:settings': { youtubeApiKey: KEY } } });
  const r = await w.send({ type: 'reelscope:yt-channels', ids: ids.concat(['not-a-channel', ids[0]]) });
  assert.equal(w.fetches.length, 1, 'one channels.list call');
  assert.match(w.fetches[0].url, /part=snippet%2Cstatistics/);
  assert.deepEqual(w.units, [1]);
  assert.deepEqual(r.channels[ids[0]], { name: 'T aaaa', handle: 'haaaa', subscribers: 1000, views: 500000, videos: 50, publishedAt: Date.UTC(2020, 0, 1), country: 'TR' });
  assert.equal(r.channels[ids[2]], null, 'YouTube has no such channel');
  assert.ok(w.local['rs:yt-ch-cache'][ids[1]]);
  const again = await w.send({ type: 'reelscope:yt-channels', ids });
  assert.equal(w.fetches.length, 1, 'served from the cache');
  assert.equal(again.channels[ids[2]], null);
  w.clock.t += 8 * 864e5;
  await w.send({ type: 'reelscope:yt-channels', ids: [ids[0]] });
  assert.equal(w.fetches.length, 2, 'after 7 days it asks again');
  const many = Array.from({ length: 120 }, (_, i) => 'UC' + String(i).padStart(22, 'm'));
  await w.send({ type: 'reelscope:yt-channels', ids: many });
  assert.equal(w.fetches.length, 5, '120 channels = 3 calls');

  const low = worker({ local: { 'rs:settings': { youtubeApiKey: KEY } }, used: 9500 });
  const rl = await low.send({ type: 'reelscope:yt-channels', ids });
  assert.deepEqual([rl.quotaLow, low.fetches.length], [true, 0], 'the day\'s quota is left to the user\'s own buttons');
});

test('monetization: "checking" first, the verdict lands in the cache, then comes straight from it', async () => {
  const w = worker({ fetch: async (url) => url.includes('v=monetVidxxx') ? { ok: true, status: 200, text: async () => fx('watch-monetized.html') } : null });
  const first = await w.send({ type: 'reelscope:yt-monetization', kind: 'video', id: 'monetVidxxx' });
  assert.equal(first.state, 'checking');
  assert.ok(await until(() => w.local['rs:yt-mon-cache'] && w.local['rs:yt-mon-cache']['v:monetVidxxx']));
  const second = await w.send({ type: 'reelscope:yt-monetization', kind: 'video', id: 'monetVidxxx' });
  assert.equal(second.state, 'yes');
  assert.equal(w.fetches.length, 1);
  assert.match(w.fetches[0].url, /^https:\/\/www\.youtube\.com\/watch\?v=monetVidxxx/);
  // A consent wall: one more try with cookies, then "unknown" is remembered (no refetch on reload).
  const c = worker({ fetch: async () => ({ ok: true, status: 200, text: async () => fx('watch-consent.html') }) });
  await c.send({ type: 'reelscope:yt-monetization', kind: 'video', id: 'consentVidx' });
  assert.ok(await until(() => c.local['rs:yt-mon-cache'] && c.local['rs:yt-mon-cache']['v:consentVidx']));
  assert.equal(c.fetches.length, 2);
  assert.equal((await c.send({ type: 'reelscope:yt-monetization', kind: 'video', id: 'consentVidx' })).state, 'unknown');
  assert.equal(c.fetches.length, 2);
});

test('monetization: a channel samples its videos and stops at the first ad; Shorts-only channels can\'t be checked', async () => {
  const w = worker({ fetch: async (url) => url.includes('v=chanVid002') ? { ok: true, status: 200, text: async () => fx('watch-monetized.html') } : null });
  const ch = 'UCmonetChannel0000000000';
  const ids = ['chanVid001x', 'chanVid002x', 'chanVid003x', 'chanVid004x', 'chanVid005x'];
  assert.equal((await w.send({ type: 'reelscope:yt-monetization', kind: 'channel', channel: ch, ids })).state, 'checking');
  assert.ok(await until(() => w.local['rs:yt-mon-cache'] && w.local['rs:yt-mon-cache']['c:' + ch]));
  assert.equal(w.fetches.length, 2, 'not monetized, then monetized: done');
  const v = await w.send({ type: 'reelscope:yt-monetization', kind: 'channel', channel: ch, ids });
  assert.deepEqual([v.state, v.yes, v.sampled], ['yes', 1, 5]);
  assert.equal((await w.send({ type: 'reelscope:yt-monetization', kind: 'channel', channel: 'UCshortsOnly000000000000', ids: [], shortsOnly: true })).state, 'shorts-only');
  // Every sampled page without the key: "no"; the per-video results are cached too.
  const n = worker();
  await n.send({ type: 'reelscope:yt-monetization', kind: 'channel', channel: ch, ids: ids.slice(0, 3) });
  assert.ok(await until(() => n.local['rs:yt-mon-cache'] && n.local['rs:yt-mon-cache']['c:' + ch]));
  assert.equal((await n.send({ type: 'reelscope:yt-monetization', kind: 'channel', channel: ch, ids })).state, 'no');
  assert.equal((await n.send({ type: 'reelscope:yt-monetization', kind: 'video', id: ids[1] })).state, 'no', 'the sample\'s videos are cached one by one');
  assert.equal(n.fetches.length, 3);
});

test('monetization: at most 10 watch pages a minute, across the queue; off means no request', async () => {
  const w = worker();
  for (let i = 0; i < 13; i++) await w.send({ type: 'reelscope:yt-monetization', kind: 'video', id: ('rate' + i).padEnd(11, 'x') });
  assert.ok(await until(() => Object.keys(w.local['rs:yt-mon-cache'] || {}).length === 13, 4000));
  const at = w.fetches.map((f) => f.at);
  assert.equal(at.length, 13);
  for (let i = 10; i < at.length; i++) assert.ok(at[i] - at[i - 10] >= 60000, 'request ' + i + ' waited for the window');
  assert.ok(at[9] - at[0] < 1000, 'the first ten go right away');

  const off = worker({ local: { 'rs:settings': { features: { 'video-monetization': false, 'channel-monetization': false, dislikes: false } } } });
  await settle();
  assert.equal((await off.send({ type: 'reelscope:yt-monetization', kind: 'video', id: 'offVideoxxx' })).off, true);
  assert.equal((await off.send({ type: 'reelscope:yt-monetization', kind: 'channel', channel: 'UCoff0000000000000000000', ids: ['offVideoxxx'] })).off, true);
  assert.equal((await off.send({ type: 'reelscope:yt-ryd', id: 'offVideoxxx' })).off, true);
  assert.equal(off.fetches.length, 0);
  assert.equal((await w.send({ type: 'reelscope:yt-monetization', kind: 'video', id: 'bad' })).ok, false);
});

test('Return YouTube Dislike: the count, a 1-day cache, failures are quiet', async () => {
  const w = worker();
  const r = await w.send({ type: 'reelscope:yt-ryd', id: 'rydVideoxxx' });
  assert.deepEqual([r.ok, r.dislikes, r.likes], [true, 7, 100]);
  assert.match(w.fetches[0].url, /^https:\/\/returnyoutubedislikeapi\.com\/votes\?videoId=rydVideoxxx$/);
  assert.equal((await w.send({ type: 'reelscope:yt-ryd', id: 'rydVideoxxx' })).cached, true);
  assert.equal(w.fetches.length, 1);
  const f = worker({ fetch: async () => ({ ok: false, status: 429, json: async () => ({}) }) });
  assert.deepEqual(await f.send({ type: 'reelscope:yt-ryd', id: 'rydVideoxxx' }), { ok: false, status: 429, error: 'rate-limited' });
  const n = worker({ fetch: async () => { throw new Error('offline'); } });
  assert.deepEqual(await n.send({ type: 'reelscope:yt-ryd', id: 'rydVideoxxx' }), { ok: false, error: 'network' });
  assert.equal((await w.send({ type: 'reelscope:yt-ryd', id: '../etc' })).ok, false);
});
