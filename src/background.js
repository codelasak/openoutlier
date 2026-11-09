// ReelScope – service worker: saves media files with chrome.downloads (content
// scripts can't download cross-origin CDN files themselves); the MCP bridge and
// the Reddit Mentions checker live in their own files (imported below).
'use strict';
importScripts('metrics.js', 'agent-bridge.js', 'mentions.js', 'mentions-bg.js'); // fileBaseName + local MCP bridge + Reddit mentions

var ALLOWED_HOST = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i;
var TIKTOK_HOST = /(^|\.)(tiktokcdn(-[a-z]+)?\.com|tiktok\.com|tiktokv\.com|ibyteimg\.com|ibytedtos\.com|byteoversea\.com|muscdn\.com)$/i;

function safeName(s) {
  return String(s || '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(0, 80) || 'instagram';
}

function extensionFor(url, kind) {
  try {
    var m = new URL(url).pathname.match(/\.(mp4|mov|jpe?g|png|webp|heic)$/i);
    if (m) return m[1].toLowerCase().replace('jpeg', 'jpg');
  } catch (e) { /* fall through */ }
  return kind === 'video' ? 'mp4' : 'jpg';
}

function isAllowed(url, tiktok) {
  try {
    var u = new URL(url);
    return u.protocol === 'https:' && (tiktok ? TIKTOK_HOST : ALLOWED_HOST).test(u.hostname);
  } catch (e) {
    return false;
  }
}

/** Build the download jobs. what = 'media' (videos/photos) or 'cover' (cover image only). */
function jobsFor(posts, what) {
  var jobs = [];
  var skipped = 0;
  posts.forEach(function (p) {
    var files = what === 'cover'
      ? (p.cover ? [{ kind: 'image', url: p.cover }] : [])
      : (Array.isArray(p.files) ? p.files : []);
    var base = self.ReelScopeMetrics.fileBaseName(p);
    var tiktok = p.platform === 'tiktok';
    files.forEach(function (f, i) {
      if (!f || !isAllowed(f.url, tiktok)) { skipped++; return; }
      var suffix = what === 'cover' ? '_cover' : (files.length > 1 ? '_' + (i + 1) : '');
      var job = {
        url: f.url,
        filename: 'ReelScope/' + safeName(p.owner) + '/' + base + suffix + '.' + extensionFor(f.url, f.kind),
        conflictAction: 'uniquify',
        saveAs: false
      };
      // TikTok: other links to the same file, for the page-fetch fallback.
      if (tiktok) job.alt = (Array.isArray(f.alt) ? f.alt : []).filter(function (u) { return isAllowed(u, true); });
      jobs.push(job);
    });
  });
  return { jobs: jobs, skipped: skipped };
}

// ---- TikTok ---------------------------------------------------------------------
// TikTok's video CDN usually wants the site's cookies and a tiktok.com referer,
// which chrome.downloads can't send. So: try chrome.downloads first; if TikTok
// refuses, fetch the file inside a tiktok.com tab (same cookies and referer as
// the player) and save those bytes. The working route is remembered for a day.
var TT_MODE_KEY = 'rs:tt-download'; // { mode: 'direct'|'page', at }
var TT_MODE_TTL = 24 * 3600 * 1000;

/** Wait until a download finishes. → { state: 'complete'|'interrupted'|'in_progress', error, filename } */
function waitDownload(id, ms) {
  return new Promise(function (resolve) {
    var done = false;
    function finish(state, error) {
      if (done) return;
      done = true;
      chrome.downloads.onChanged.removeListener(onChange);
      clearTimeout(timer);
      chrome.downloads.search({ id: id }).then(function (r) {
        resolve({ state: state, error: error || (r[0] && r[0].error) || null, filename: r[0] && r[0].filename || null, bytes: r[0] && r[0].fileSize || null });
      }, function () { resolve({ state: state, error: error || null }); });
    }
    function onChange(d) {
      if (d.id !== id || !d.state) return;
      if (d.state.current === 'complete') finish('complete');
      if (d.state.current === 'interrupted') finish('interrupted', d.error && d.error.current);
    }
    chrome.downloads.onChanged.addListener(onChange);
    var timer = setTimeout(function () { finish('in_progress'); }, ms);
    chrome.downloads.search({ id: id }).then(function (r) {
      if (r[0] && r[0].state === 'complete') finish('complete');
      if (r[0] && r[0].state === 'interrupted') finish('interrupted', r[0].error);
    }, function () {});
  });
}

async function directDownload(job) {
  var id = await chrome.downloads.download({ url: job.url, filename: job.filename, conflictAction: 'uniquify', saveAs: false });
  var r = await waitDownload(id, 25000);
  if (r.state === 'interrupted') {
    chrome.downloads.erase({ id: id }).catch(function () {}); // don't leave a "Failed – Forbidden" row behind
    return { ok: false, error: r.error || 'interrupted' };
  }
  return { ok: true, filename: r.filename, state: r.state };
}

async function tiktokTab(preferred) {
  if (preferred && preferred.url && /^https:\/\/www\.tiktok\.com\//.test(preferred.url)) return preferred.id;
  var tabs = await chrome.tabs.query({ url: 'https://www.tiktok.com/*' });
  var ready = tabs.filter(function (t) { return t.status === 'complete' && !t.discarded; });
  return ready[0] ? ready[0].id : null;
}

async function pageDownload(job, senderTab) {
  var tabId = await tiktokTab(senderTab);
  if (tabId == null) return { ok: false, error: 'no-tab' };
  var r;
  try { r = await chrome.tabs.sendMessage(tabId, { type: 'reelscope:tt-fetch', urls: [job.url].concat(job.alt || []) }); } catch (e) { return { ok: false, error: 'tab: ' + (e.message || e) }; }
  if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'page fetch failed' };
  var id = await chrome.downloads.download({ url: r.dataUrl, filename: job.filename, conflictAction: 'uniquify', saveAs: false });
  var w = await waitDownload(id, 30000);
  if (w.state === 'interrupted') return { ok: false, error: w.error || 'interrupted' };
  return { ok: true, filename: w.filename, state: w.state };
}

async function tiktokDownloads(jobs, senderTab) {
  var st = (await chrome.storage.local.get(TT_MODE_KEY))[TT_MODE_KEY] || {};
  var pageFirst = st.mode === 'page' && Date.now() - (st.at || 0) < TT_MODE_TTL;
  var out = { ok: true, queued: 0, failed: 0, files: [], errors: [] };
  for (var i = 0; i < jobs.length; i++) {
    var job = jobs[i];
    var r = null;
    var directError = null;
    if (!pageFirst) {
      try { r = await directDownload(job); } catch (e) { r = { ok: false, error: e.message || String(e) }; }
      if (r.ok) { out.via = out.via || 'direct'; }
      else directError = r.error;
    }
    if (!r || !r.ok) {
      r = await pageDownload(job, senderTab);
      if (r.ok) {
        out.via = 'page';
        if (!pageFirst) { pageFirst = true; var o = {}; o[TT_MODE_KEY] = { mode: 'page', at: Date.now(), directError: directError }; chrome.storage.local.set(o); }
      }
    }
    if (r.ok) { out.queued++; out.files.push({ filename: r.filename, state: r.state }); }
    else {
      out.failed++;
      out.errors.push(r.error === 'no-tab'
        ? 'TikTok refused the direct download (' + (directError || 'forbidden') + '). Open any tiktok.com tab and try again: ReelScope then fetches the file inside that tab.'
        : 'TikTok refused this file (' + (directError ? 'direct: ' + directError + '; ' : '') + 'in the page: ' + r.error + '). The link may have expired: open the video on TikTok and try again.');
    }
  }
  if (!out.errors.length) delete out.errors;
  return out;
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || sender.id !== chrome.runtime.id) return; // only our own content scripts / pages
  if (msg.type === 'reelscope:open-dashboard') {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') + (msg.hash || '') });
    return;
  }
  if (msg.type !== 'reelscope:download' || !Array.isArray(msg.posts)) return;

  if (msg.posts.length && msg.posts.every(function (p) { return p && p.platform === 'tiktok'; })) {
    var ttPlan = jobsFor(msg.posts, msg.what === 'cover' ? 'cover' : 'media');
    tiktokDownloads(ttPlan.jobs, sender.tab).then(function (r) {
      r.skipped = ttPlan.skipped;
      sendResponse(r);
    }, function (e) { sendResponse({ ok: false, queued: 0, failed: ttPlan.jobs.length, errors: [String(e.message || e)] }); });
    return true;
  }

  var plan = jobsFor(msg.posts, msg.what === 'cover' ? 'cover' : 'media');
  // Start downloads one after another so Chrome isn't flooded.
  (async function () {
    var queued = 0;
    var failed = 0;
    for (var i = 0; i < plan.jobs.length; i++) {
      try {
        await chrome.downloads.download(plan.jobs[i]);
        queued++;
      } catch (e) {
        failed++;
      }
      if (plan.jobs.length > 5) await new Promise(function (r) { setTimeout(r, 350); });
    }
    sendResponse({ ok: true, queued: queued, skipped: plan.skipped, failed: failed });
  })();
  return true; // async response
});
