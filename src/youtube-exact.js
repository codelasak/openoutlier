// OpenOutlier – YouTube "Get exact stats" (service worker).
//
// Channel tabs only show rounded views ("63K") and relative dates ("1 month
// ago"). A video's own page has the exact numbers, and youtube-content.js
// reads them from the HTML YouTube serves. So, only when the user presses the
// panel button, this opens the chosen videos' pages one at a time in a single
// muted background tab, waits until the content script in that tab has saved
// exact values, pauses a few seconds, and moves on. Capped, throttled, one job
// at a time, cancellable; the tab is closed at the end. No YouTube API requests
// of its own: it is the same page load a person clicking through would make.
'use strict';

(function () {
  var KEY_PREFIX = 'rs:p:';
  var STATE_KEY = 'rs:yt-exact';       // chrome.storage.session: progress, so a reloaded page can show it
  var MAX_VIDEOS = 25;                  // hard cap per job
  var MAX_MISSES_IN_A_ROW = 3;
  var T = {
    pageTimeout: 25000,                 // per video: give up waiting for exact values after this
    gapMin: 4000,                       // pause between pages: 4–8 s
    gapRandom: 4000,
    poll: 1000
  };          // consent / sign-in / error pages: stop instead of trying them all
  var VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
  var ACCOUNT = /^yt\/[^\s/]{1,60}$/;

  var job = null;

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function pageUrl(v) {
    return v.type === 'short' ? 'https://www.youtube.com/shorts/' + v.code : 'https://www.youtube.com/watch?v=' + v.code;
  }

  function isExact(p) { return !!p && p.viewsApprox === false && p.dateApprox === false; }

  function snapshot() {
    if (!job) return { running: false };
    return { running: !job.finished, total: job.videos.length, index: job.index, done: job.done, failed: job.failed,
      skipped: job.skipped, cancelled: job.cancelled, label: job.label, owner: job.owner, finished: !!job.finished };
  }

  function report() {
    var s = snapshot();
    var o = {};
    o[STATE_KEY] = Object.assign({ at: Date.now() }, s);
    chrome.storage.session.set(o).catch(function () {});
    if (job && job.requester != null) {
      chrome.tabs.sendMessage(job.requester, { type: 'reelscope:yt-exact-progress', state: s }).catch(function () { /* page closed */ });
    }
  }

  async function storedPost(owner, code) {
    var key = KEY_PREFIX + owner;
    var r = await chrome.storage.local.get(key);
    var rec = r[key];
    return rec && rec.posts ? rec.posts[code] || null : null;
  }

  /** Wait until the content script in the worker tab has saved exact values for v (or time out / cancel). */
  async function waitExact(v) {
    var until = Date.now() + T.pageTimeout;
    while (Date.now() < until && !job.cancelled && job.tabId != null) {
      await sleep(T.poll);
      try { if (isExact(await storedPost(v.owner, v.code))) return true; } catch (e) { /* keep waiting */ }
    }
    return false;
  }

  /** A pause that ends early on cancel. */
  async function gap() {
    var until = Date.now() + T.gapMin + Math.random() * T.gapRandom;
    while (Date.now() < until && !job.cancelled) await sleep(Math.min(500, T.poll));
  }

  async function openPage(url) {
    if (job.tabId != null) {
      try { await chrome.tabs.update(job.tabId, { url: url, muted: true }); return true; } catch (e) { job.tabId = null; }
    }
    if (job.cancelled) return false;
    var tab = await chrome.tabs.create({ url: url, active: false, windowId: job.windowId != null ? job.windowId : undefined });
    job.tabId = tab.id;
    job.openedTab = true;
    chrome.tabs.update(tab.id, { muted: true }).catch(function () {});
    return true;
  }

  async function run() {
    var misses = 0;
    try {
      for (job.index = 0; job.index < job.videos.length; job.index++) {
        if (job.cancelled) break;
        var v = job.videos[job.index];
        if (isExact(await storedPost(v.owner, v.code).catch(function () { return null; }))) { job.skipped++; continue; }
        job.label = 'Opening ' + (job.index + 1) + ' of ' + job.videos.length + '…';
        report();
        if (!(await openPage(pageUrl(v)))) break;
        var ok = await waitExact(v);
        if (job.cancelled) break;
        if (job.tabId == null) { job.cancelled = true; job.closedByUser = true; break; }
        if (ok) { job.done++; misses = 0; } else { job.failed++; misses++; }
        report();
        if (misses >= MAX_MISSES_IN_A_ROW) { job.stoppedEarly = true; break; }
        if (job.index < job.videos.length - 1) await gap();
      }
    } catch (e) {
      job.error = String(e && e.message || e);
    } finally {
      if (job.tabId != null && job.openedTab) chrome.tabs.remove(job.tabId).catch(function () {});
      job.tabId = null;
      job.finished = true;
      var parts = [job.done + ' updated'];
      if (job.skipped) parts.push(job.skipped + ' already exact');
      if (job.failed) parts.push(job.failed + ' not read');
      job.label = (job.error ? 'Stopped: ' + job.error + '. '
        : job.stoppedEarly ? 'Stopped: YouTube did not show ' + MAX_MISSES_IN_A_ROW + ' videos in a row (a sign-in, consent or error page?). '
        : job.closedByUser ? 'Stopped: the tab was closed. '
        : job.cancelled ? 'Stopped. ' : 'Done: ') + parts.join(', ') + '.';
      report();
    }
  }

  function start(msg, sender) {
    if (job && !job.finished) return { ok: false, error: 'Already getting exact stats (' + (job.index + 1) + ' of ' + job.videos.length + '). Stop it first.' };
    var seen = {};
    var videos = (Array.isArray(msg.videos) ? msg.videos : []).filter(function (v) {
      if (!v || !VIDEO_ID.test(String(v.code || '')) || !ACCOUNT.test(String(v.owner || '')) || seen[v.code]) return false;
      seen[v.code] = true;
      return true;
    }).slice(0, MAX_VIDEOS).map(function (v) { return { code: v.code, owner: v.owner, type: v.type === 'short' ? 'short' : 'video' }; });
    if (!videos.length) return { ok: false, error: 'No videos to update.' };
    job = {
      videos: videos, index: 0, done: 0, failed: 0, skipped: 0, cancelled: false, finished: false,
      owner: videos[0].owner, label: 'Starting…', tabId: null, openedTab: false,
      requester: sender.tab ? sender.tab.id : null, windowId: sender.tab ? sender.tab.windowId : null
    };
    run();
    return { ok: true, total: videos.length, max: MAX_VIDEOS };
  }

  chrome.tabs.onRemoved.addListener(function (tabId) {
    if (job && !job.finished && tabId === job.tabId) job.tabId = null;
  });

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || sender.id !== chrome.runtime.id) return;
    if (msg.type === 'reelscope:yt-exact') { sendResponse(start(msg, sender)); return; }
    if (msg.type === 'reelscope:yt-exact-cancel') {
      if (job && !job.finished) { job.cancelled = true; job.label = 'Stopping…'; report(); }
      sendResponse(snapshot());
      return;
    }
    if (msg.type === 'reelscope:yt-exact-status') {
      // A page that was reloaded mid-job takes over the progress messages.
      if (job && !job.finished && sender.tab && sender.tab.id !== job.tabId && msg.owner === job.owner) job.requester = sender.tab.id;
      sendResponse(snapshot());
    }
  });

  self.OpenOutlierYouTubeExact = {
    MAX_VIDEOS: MAX_VIDEOS, isExact: isExact, snapshot: snapshot,
    _timing: function (t) { Object.assign(T, t); } // tests only
  };
})();
