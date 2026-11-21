// OpenOutlier – the service-worker side of phase 3's in-page badges and cards.
//
// Three small jobs, each behind its feature switch (src/features.js) and each cached:
//
//   reelscope:yt-channels      channels.list for channels on screen that the Library doesn't know
//                              well enough (outlier "avg" badge, subscriber counts, channel age /
//                              total views / country). Only with the user's own Data API key;
//                              50 channels = 1 unit; cached 7 days (rs:yt-ch-cache).
//   reelscope:yt-monetization  NexLev's method: fetch a watch page and look for the yt_ad key.
//                              Our one exception to "OpenOutlier makes no YouTube requests of its
//                              own" (README → Privacy). Serial, at most 10 a minute across every
//                              tab, cached 7 days per video and per channel (rs:yt-mon-cache).
//                              Turn off: Features → channel-monetization / video-monetization.
//   reelscope:yt-ryd           Return YouTube Dislike: the video id goes to
//                              returnyoutubedislikeapi.com; cached 1 day (rs:yt-ryd-cache).
//                              Turn off: Features → dislikes.
//
// Content scripts get the answer right away from the cache; a monetization check that has to
// fetch answers { state: 'checking' } and the result lands in storage, which the open tabs watch.
'use strict';

(function () {
  var I = self.OpenOutlierInsights;
  var A = self.OpenOutlierYouTubeApi;
  var F = self.OpenOutlierFeatures;
  var CH_KEY = 'rs:yt-ch-cache';
  var MON_KEY = 'rs:yt-mon-cache';
  var RYD_KEY = 'rs:yt-ryd-cache';
  var MON_TIMES = 'rs:yt-mon-times'; // session storage: when the last watch pages were fetched
  var WEEK = 7 * I.DAY;
  var CH_TTL = WEEK;
  var CH_MISS_TTL = I.DAY;   // a channel YouTube didn't return: ask again tomorrow
  var MON_TTL = WEEK;
  // "Couldn't tell" (consent wall, network, a signed-in page without ad config) is retried soon.
  var MON_UNKNOWN_TTL = 6 * 3600000;
  var RYD_TTL = I.DAY;
  var MAX_CH = 4000;
  var MAX_MON = 3000;
  var MAX_RYD = 600;
  var MON_PER_MIN = 10;
  var QUOTA_RESERVE = 9000;  // leave the rest of the day's quota to the user's own buttons and the bridge
  var RYD_API = 'https://returnyoutubedislikeapi.com/votes?videoId=';

  // ---- storage helpers (read-modify-write, one at a time) -------------------------------
  var writing = Promise.resolve();
  function update(key, fn) {
    var p = writing.then(async function () {
      var r = await chrome.storage.local.get(key);
      var next = fn(r[key] || {});
      var o = {};
      o[key] = next;
      await chrome.storage.local.set(o);
      return next;
    });
    writing = p.catch(function () {});
    return p;
  }
  async function readMap(key) { return (await chrome.storage.local.get(key))[key] || {}; }
  async function flagOn(id) { try { await F.ready; } catch (e) { /* defaults */ } return F.isOn(id); }

  // ---- channels.list ------------------------------------------------------------------------
  var inflight = {};
  async function apiKey() {
    var r = await chrome.storage.local.get('rs:settings');
    var k = r['rs:settings'] && r['rs:settings'].youtubeApiKey;
    return A.isKey(k) ? k.trim() : null;
  }

  /** ids: UC… → { ok, channels: { UC: info | null }, noKey } (null = YouTube has no such channel). */
  async function channels(msg) {
    var ids = (Array.isArray(msg.ids) ? msg.ids : []).filter(function (x) { return /^UC[A-Za-z0-9_-]{22}$/.test(String(x)); });
    ids = ids.filter(function (x, i) { return ids.indexOf(x) === i; }).slice(0, 200);
    var now = Date.now();
    var cache = await readMap(CH_KEY);
    var out = {};
    var todo = [];
    ids.forEach(function (id) {
      var e = cache[id];
      var ttl = e && e.v === null ? CH_MISS_TTL : CH_TTL;
      var v = I.cacheGet(cache, id, ttl, now);
      if (v !== undefined) out[id] = v; else todo.push(id);
    });
    if (!todo.length || msg.cacheOnly) return { ok: true, channels: out };
    var key = await apiKey();
    if (!key) return { ok: true, channels: out, noKey: true };
    var Bg = self.OpenOutlierYouTubeApiBg;
    if (Bg && Bg.status) {
      var st = await Bg.status();
      if (st.quota && st.quota.used >= QUOTA_RESERVE) return { ok: true, channels: out, quotaLow: true };
    }
    // One request per 50 ids; ids already being asked for by another tab wait for that answer.
    var fresh = todo.filter(function (id) { return !inflight[id]; });
    var waits = todo.filter(function (id) { return inflight[id]; }).map(function (id) { return inflight[id]; });
    var groups = A.chunk(fresh, 50);
    var job = (async function () {
      var got = {};
      for (var i = 0; i < groups.length; i++) {
        var c = A.client({ key: key, fetch: self.fetch.bind(self), onUnits: function (n) { if (Bg && Bg.spend) Bg.spend(n); } });
        var list = await c.channels(groups[i]);
        groups[i].forEach(function (id) { got[id] = null; });
        list.forEach(function (info) { if (info && info.channelId) got[info.channelId] = slim(info); });
      }
      await update(CH_KEY, function (m) {
        var next = m;
        Object.keys(got).forEach(function (id) { next = I.cachePut(next, id, got[id], CH_TTL, Date.now(), MAX_CH); });
        return next;
      });
      return got;
    })();
    fresh.forEach(function (id) { inflight[id] = job; });
    try {
      var got = await job;
      Object.assign(out, got);
      (await Promise.all(waits.map(function (p) { return p.catch(function () { return {}; }); }))).forEach(function (g) {
        todo.forEach(function (id) { if (g && g[id] !== undefined) out[id] = g[id]; });
      });
      return { ok: true, channels: out };
    } catch (e) {
      return { ok: false, channels: out, error: e && e.message || String(e), code: e && e.code };
    } finally {
      fresh.forEach(function (id) { delete inflight[id]; });
    }
  }

  function slim(info) {
    return { name: info.name || null, handle: info.handle || null, subscribers: info.subscribers, views: info.views, videos: info.videos,
      publishedAt: info.publishedAt || null, country: info.country || null };
  }

  // ---- monetization (yt_ad) ----------------------------------------------------------------
  var queue = [];          // [{ kind, key, ids }]
  var running = false;
  var queued = {};         // key → true while waiting or running

  async function monTimes() { try { return ((await chrome.storage.session.get(MON_TIMES))[MON_TIMES]) || []; } catch (e) { return []; } }
  async function setMonTimes(t) { try { var o = {}; o[MON_TIMES] = t; await chrome.storage.session.set(o); } catch (e) { /* no session storage */ } }

  /** One watch page, rate-limited (≤ 10 a minute over every tab and worker restart). → 'yes'|'no'|'music'|'unknown' */
  async function checkVideo(id) {
    for (;;) {
      var times = await monTimes();
      var w = I.waitFor(times, Date.now(), MON_PER_MIN, 60000);
      if (!w) { times.push(Date.now()); await setMonTimes(times.filter(function (t) { return Date.now() - t < 60000; })); break; }
      await new Promise(function (r) { setTimeout(r, Math.min(w + 50, 61000)); });
    }
    var url = 'https://www.youtube.com/watch?v=' + id + '&hl=en&gl=US';
    var res = I.monetizationFromHtml('');
    try {
      // No cookies first (nothing tied to the user); a consent wall then gets one try with them.
      var r = await fetch(url, { credentials: 'omit', cache: 'no-store' });
      res = I.monetizationFromHtml(await r.text());
      if (res.state === 'unknown' && res.reason === 'consent') {
        var r2 = await fetch(url, { credentials: 'include', cache: 'no-store' });
        res = I.monetizationFromHtml(await r2.text());
        // With the user's cookies a YouTube Premium session gets no ad config at all: no ad marker
        // there doesn't mean "not monetized", so only a positive answer counts.
        if (res.state === 'no') res = { state: 'unknown', reason: 'signed-in' };
      }
    } catch (e) { res = { state: 'unknown', reason: 'network' }; }
    return res.state;
  }

  /** A cached verdict, with the short lifetime for "unknown". */
  function monGet(cache, key, now) {
    var e = cache && cache[key];
    return I.cacheGet(cache, key, e && e.v && e.v.state === 'unknown' ? MON_UNKNOWN_TTL : MON_TTL, now);
  }
  // Every entry is stored with the long TTL (cachePut prunes the others by it); monGet ages "unknown" out early.
  function monPut(key, value) { return update(MON_KEY, function (m) { return I.cachePut(m, key, value, MON_TTL, Date.now(), MAX_MON); }); }

  async function runJob(job) {
    var on = await flagOn(job.kind === 'channel' ? 'channel-monetization' : 'video-monetization');
    if (!on) return;
    var cache = await readMap(MON_KEY);
    var states = [];
    for (var i = 0; i < job.ids.length; i++) {
      var vid = job.ids[i];
      var hit = monGet(cache, 'v:' + vid, Date.now());
      var st = hit ? hit.state : await checkVideo(vid);
      if (!hit && st !== 'unknown') cache = await monPut('v:' + vid, { state: st });
      states.push(st);
      // A channel is monetized as soon as one sampled video shows ads: no need to fetch the rest.
      if (job.kind === 'channel' && st === 'yes') break;
    }
    if (job.kind === 'channel') {
      var verdict = I.channelVerdict(states);
      verdict.sampled = job.ids.length;
      await monPut(job.key, verdict);
    } else if (states[0] === 'unknown') {
      // Remember "couldn't check" for a few hours so a reload doesn't fetch again at once.
      await monPut(job.key, { state: 'unknown' });
    }
  }

  async function runQueue() {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        var job = queue.shift();
        // One failing job (storage full, a thrown fetch) must not leave its key "checking" or stop the queue.
        try { await runJob(job); } catch (e) { /* the badge shows unknown; the next page view asks again */ } finally { delete queued[job.key]; }
      }
    } finally { running = false; }
  }

  /**
   * msg: { kind: 'video', id } or { kind: 'channel', channel: UC…, ids: [sampled video ids], shortsOnly }.
   * → { ok, state: 'yes'|'no'|'music'|'unknown'|'checking'|'shorts-only', at?, checked? }
   */
  async function monetization(msg) {
    var kind = msg.kind === 'channel' ? 'channel' : 'video';
    if (!(await flagOn(kind === 'channel' ? 'channel-monetization' : 'video-monetization'))) return { ok: false, off: true };
    var now = Date.now();
    var cache = await readMap(MON_KEY);
    if (kind === 'video') {
      if (!/^[A-Za-z0-9_-]{11}$/.test(String(msg.id || ''))) return { ok: false, error: 'bad id' };
      var k = 'v:' + msg.id;
      var e = cache[k];
      var v = monGet(cache, k, now);
      if (v) return { ok: true, state: v.state, at: e.at };
      if (!queued[k]) { queued[k] = true; queue.push({ kind: 'video', key: k, ids: [msg.id] }); runQueue(); }
      return { ok: true, state: 'checking', ahead: queue.length };
    }
    if (!/^UC[A-Za-z0-9_-]{22}$/.test(String(msg.channel || ''))) return { ok: false, error: 'bad channel' };
    var ck = 'c:' + msg.channel;
    var ce = cache[ck];
    var cv = monGet(cache, ck, now);
    if (cv) return Object.assign({ ok: true, at: ce.at }, cv);
    var ids = (Array.isArray(msg.ids) ? msg.ids : []).filter(function (x) { return /^[A-Za-z0-9_-]{11}$/.test(String(x)); }).slice(0, 5);
    if (!ids.length) return { ok: true, state: msg.shortsOnly ? 'shorts-only' : 'unknown' };
    if (!queued[ck]) { queued[ck] = true; queue.push({ kind: 'channel', key: ck, ids: ids }); runQueue(); }
    return { ok: true, state: 'checking', ahead: queue.length };
  }

  // ---- Return YouTube Dislike ------------------------------------------------------------------
  async function ryd(msg) {
    if (!(await flagOn('dislikes'))) return { ok: false, off: true };
    var id = String(msg.id || '');
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return { ok: false, error: 'bad id' };
    var cache = await readMap(RYD_KEY);
    var hit = I.cacheGet(cache, id, RYD_TTL, Date.now());
    if (hit) return Object.assign({ ok: true, cached: true }, hit);
    try {
      var r = await fetch(RYD_API + encodeURIComponent(id), { credentials: 'omit', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) return { ok: false, status: r.status, error: r.status === 429 ? 'rate-limited' : 'HTTP ' + r.status };
      var j = await r.json();
      if (typeof j.dislikes !== 'number') return { ok: false, error: 'no count' };
      var v = { dislikes: j.dislikes, likes: typeof j.likes === 'number' ? j.likes : null, rating: typeof j.rating === 'number' ? j.rating : null };
      await update(RYD_KEY, function (m) { return I.cachePut(m, id, v, RYD_TTL, Date.now(), MAX_RYD); });
      return Object.assign({ ok: true }, v);
    } catch (e) {
      return { ok: false, error: e && e.name === 'TimeoutError' ? 'timeout' : 'network' };
    }
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || sender.id !== chrome.runtime.id) return;
    var fn = msg.type === 'reelscope:yt-channels' ? channels : msg.type === 'reelscope:yt-monetization' ? monetization : msg.type === 'reelscope:yt-ryd' ? ryd : null;
    if (!fn) return;
    fn(msg).then(sendResponse, function (e) { sendResponse({ ok: false, error: String(e && e.message || e) }); });
    return true;
  });

  self.OpenOutlierInsightsBg = { channels: channels, monetization: monetization, ryd: ryd, checkVideo: checkVideo };
})();
