// OpenOutlier – "Exact stats via API" in the service worker (optional).
//
// Only runs when the user has entered their own YouTube Data API key in the
// popup (rs:settings.youtubeApiKey) and pressed the panel's API button. Without
// a key this file answers "not configured" and never makes a request.
//
// Two actions, one at a time:
//   • exact:   videos.list for the given saved videos (50 per unit);
//   • uploads: channels.list + playlistItems.list for a channel's uploads, then
//              videos.list for their stats (adds videos the tabs never showed).
// Results are merged into chrome.storage with Y.merge (exact beats rounded), the
// same rules the content script and the MCP store use; the open YouTube tab
// picks them up through storage.onChanged. Units used today (Pacific day) are
// kept in rs:yt-api-quota and reported to the bridge (src/agent-bridge.js), which
// answers with its own count, so both sides show the same total.
'use strict';

(function () {
  var Y = self.OpenOutlierYouTube;
  var A = self.OpenOutlierYouTubeApi;
  var KEY_PREFIX = 'rs:p:';
  var SETTINGS_KEY = 'rs:settings';
  var QUOTA_KEY = 'rs:yt-api-quota';
  var MAX_EXACT = 1000;   // videos per press (20 units)
  var MAX_UPLOADS = 500;  // uploads per press (~31 units)
  var busy = null;

  async function apiKey() {
    var r = await chrome.storage.local.get(SETTINGS_KEY);
    var k = r[SETTINGS_KEY] && r[SETTINGS_KEY].youtubeApiKey;
    return A.isKey(k) ? k.trim() : null;
  }

  /** Units used today: this browser's plus the bridge's (rs:bridge.bridgeQuota, from its /settings answer),
   *  since the same key spends one Google Cloud project's quota. */
  async function quota() {
    var r = await chrome.storage.local.get([QUOTA_KEY, 'rs:bridge']);
    var mine = A.usedToday(r[QUOTA_KEY]);
    var bridge = A.usedToday((r['rs:bridge'] || {}).bridgeQuota);
    return { used: mine + bridge, extension: mine, bridge: bridge, limit: A.DAILY_QUOTA, day: A.quotaDay() };
  }

  // Unit counting is serialized so two quick calls can't lose one.
  var counting = Promise.resolve();
  function spend(n) {
    counting = counting.then(async function () {
      var r = await chrome.storage.local.get(QUOTA_KEY);
      var o = {};
      o[QUOTA_KEY] = A.addUnits(r[QUOTA_KEY], n);
      await chrome.storage.local.set(o);
    }).catch(function () {});
  }

  async function status() {
    return { configured: !!(await apiKey()), quota: await quota(), running: !!busy, label: busy || '' };
  }

  /** Merge patches into the stored account (re-read right before writing). */
  async function save(owner, records, channel) {
    var key = KEY_PREFIX + owner;
    var r = await chrome.storage.local.get(key);
    var rec = r[key] || { posts: {}, platform: 'youtube' };
    var posts = Object.assign({}, rec.posts);
    var added = 0;
    var updated = 0;
    records.forEach(function (p) {
      var patch = Object.assign({}, p, { owner: owner });
      if (posts[p.code]) updated++; else { if (!patch.type) return; added++; }
      posts[p.code] = Y.merge(posts[p.code], patch);
    });
    var out = Object.assign({}, rec, { posts: posts, updatedAt: Date.now(), platform: 'youtube' });
    if (channel) {
      var prof = Object.assign({}, rec.profile);
      if (channel.channelId) prof.channelId = channel.channelId;
      if (channel.handle && !prof.handle) prof.handle = channel.handle;
      if (channel.name && !prof.name) prof.name = channel.name;
      if (channel.avatar && !prof.avatar) prof.avatar = channel.avatar;
      if (channel.subscribers != null) { prof.subscribers = channel.subscribers; prof.subscribersApprox = false; }
      if (channel.videos != null) prof.videos = channel.videos;
      out.profile = prof;
    }
    var o = {};
    o[key] = out;
    await chrome.storage.local.set(o);
    return { added: added, updated: updated };
  }

  function errText(e) {
    return (e && e.message || String(e)) + (e && e.hint ? ' ' + e.hint : '');
  }

  async function run(msg) {
    var key = await apiKey();
    if (!key) return { ok: false, code: 'no_key', error: 'No YouTube Data API key is set. Add one in the OpenOutlier popup (optional).' };
    var owner = String(msg.owner || '');
    if (!Y.isYouTubeId(owner)) return { ok: false, error: 'Not a YouTube channel: ' + owner };
    if (busy) return { ok: false, error: 'Already running: ' + busy };
    var before = (await quota()).used;
    var counted = 0;
    var opts = { key: key, fetch: self.fetch.bind(self), onUnits: function (n) { counted += n; spend(n); } };
    try {
      if (msg.action === 'uploads') {
        busy = 'Loading the channel\'s uploads…';
        var stored = (await chrome.storage.local.get(KEY_PREFIX + owner))[KEY_PREFIX + owner] || {};
        var prof = stored.profile || {};
        var handle = /^yt\/UC/.test(owner) ? null : (prof.handle || owner.slice(3));
        var res = await A.channelUploads(Object.assign(opts, {
          channelId: prof.channelId || (/^yt\/(UC[A-Za-z0-9_-]{22})$/.exec(owner) || [])[1],
          handle: handle, owner: owner, known: stored.posts || {},
          max: Math.min(Math.max(1, msg.max || 200), MAX_UPLOADS)
        }));
        var n = await save(owner, res.records, res.channel);
        return { ok: true, added: n.added, updated: n.updated, units: counted, quota: { used: before + counted, limit: A.DAILY_QUOTA },
          note: res.shortsKnown ? '' : 'YouTube did not list this channel\'s Shorts, so videos of 60 s or less were counted as Shorts.' };
      }
      busy = 'Getting exact stats…';
      var rec = (await chrome.storage.local.get(KEY_PREFIX + owner))[KEY_PREFIX + owner] || {};
      var codes = Array.isArray(msg.codes) ? msg.codes : Object.keys(rec.posts || {});
      var posts = codes.filter(Y.isVideoId).slice(0, MAX_EXACT).map(function (c) {
        var p = (rec.posts || {})[c] || {};
        return { code: c, owner: owner, type: p.type };
      });
      if (!posts.length) return { ok: false, error: 'No saved videos to update.' };
      var ex = await A.exactStats(Object.assign(opts, { posts: posts }));
      var m = await save(owner, ex.records, null);
      return { ok: true, updated: m.updated, missing: ex.missing.length, units: counted, quota: { used: before + counted, limit: A.DAILY_QUOTA } };
    } catch (e) {
      return { ok: false, code: e && e.code, error: errText(e), units: counted };
    } finally {
      busy = null;
    }
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || sender.id !== chrome.runtime.id) return;
    if (msg.type === 'reelscope:yt-api-status') { status().then(sendResponse); return true; }
    if (msg.type === 'reelscope:yt-api') { run(msg).then(sendResponse); return true; }
  });

  self.OpenOutlierYouTubeApiBg = { run: run, status: status, save: save, spend: spend, quota: quota };
})();
