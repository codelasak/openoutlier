// ReelScope – service worker: saves media files with chrome.downloads (content
// scripts can't download cross-origin CDN files themselves); the MCP bridge and
// the Reddit Mentions checker live in their own files (imported below).
'use strict';
importScripts('metrics.js', 'agent-bridge.js', 'mentions.js', 'mentions-bg.js'); // fileBaseName + local MCP bridge + Reddit mentions

var ALLOWED_HOST = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i;

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

function isAllowed(url) {
  try {
    var u = new URL(url);
    return u.protocol === 'https:' && ALLOWED_HOST.test(u.hostname);
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
    files.forEach(function (f, i) {
      if (!f || !isAllowed(f.url)) { skipped++; return; }
      var suffix = what === 'cover' ? '_cover' : (files.length > 1 ? '_' + (i + 1) : '');
      jobs.push({
        url: f.url,
        filename: 'ReelScope/' + safeName(p.owner) + '/' + base + suffix + '.' + extensionFor(f.url, f.kind),
        conflictAction: 'uniquify',
        saveAs: false
      });
    });
  });
  return { jobs: jobs, skipped: skipped };
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || sender.id !== chrome.runtime.id) return; // only our own content scripts / pages
  if (msg.type === 'reelscope:open-dashboard') {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') + (msg.hash || '') });
    return;
  }
  if (msg.type !== 'reelscope:download' || !Array.isArray(msg.posts)) return;

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
