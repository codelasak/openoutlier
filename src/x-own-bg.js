// OpenOutlier – X "My account" in the service worker (docs/x-plan.md 3.2–3.5, Phase 2, feature x.own).
//
// The single writer of the merged own-account state, so the x.com tabs and the Library only read:
//   rs:x-own:history  ← every new rs:x:raw:accountOverviewDailyQuery (and contentPageQuery) capture,
//                       merged day by day (src/x-own.js mergeHistory); captures of another account
//                       are flagged, not counted.
//   rs:x-own:early    ← each new measurement of an own post younger than 48 h (the first-hours curve
//                       without the bridge; src/x-own-content.js shows it).
// When the bridge is up (and has 'x-own'), the merged days and today's snapshot go to POST /x/own/daily
// (→ x_own_daily). The post measurements reach x_post_stats through the normal library sync.
// Messages: reelscope:x-own { what: 'curve', account } | { what: 'page' } → the bridge's answer, quietly
// { ok: false, noBridge } without one. Nothing here contacts X.
'use strict';

(function () {
  var O = self.OpenOutlierXOwn;
  var F = self.OpenOutlierFeatures;
  if (!O) return;
  var RAW_OVERVIEW = 'rs:x:raw:accountOverviewDailyQuery';
  var RAW_CONTENT = 'rs:x:raw:contentPageQuery';
  var KEY_PREFIX = 'rs:p:';
  var PUSH_EVERY = 30 * 60000; // snapshot pushes without a new capture: at most every 30 min

  function on() { try { return !F || F.isOn('x.own'); } catch (e) { return true; } }
  async function ownHandle() {
    var r = await chrome.storage.local.get(O.OWN_KEY);
    return (r[O.OWN_KEY] && r[O.OWN_KEY].handle) || O.DEFAULT_HANDLE;
  }

  var queue = Promise.resolve();
  function serial(fn) { var p = queue.then(fn); queue = p.catch(function (e) { console.warn('[OpenOutlier] x-own', e); }); return p; }

  /** Merge any capture newer than the last one we merged. → the history (changed or not). */
  async function mergeCaptures(force) {
    var keys = [RAW_OVERVIEW, RAW_CONTENT, O.HISTORY_KEY];
    var r = await chrome.storage.local.get(keys);
    var h = r[O.HISTORY_KEY] && r[O.HISTORY_KEY].days ? r[O.HISTORY_KEY] : O.emptyHistory();
    var changed = false;
    var raw = r[RAW_OVERVIEW];
    var handle = await ownHandle();
    // The own handle changed in Settings: the old account's days are not this one's.
    if (h.handle && O.normHandle(h.handle) !== O.normHandle(handle)) { h = O.emptyHistory(); h.handle = handle; changed = true; }
    if (raw && raw.data && (force || !h.lastRawAt || raw.savedAt > h.lastRawAt)) {
      var prof = (await chrome.storage.local.get(KEY_PREFIX + O.ownId(handle)))[KEY_PREFIX + O.ownId(handle)];
      var profile = prof && prof.profile || {};
      // An own profile already saved with another rest_id: the capture is someone else's account.
      if (!h.restId && profile.restId) h.restId = profile.restId;
      var parsed = O.parseOverview(raw.data, { vars: raw.vars });
      h = O.mergeHistory(h, parsed, raw.savedAt, { followers: profile.followers });
      h.lastRawAt = raw.savedAt;
      h.handle = handle;
      changed = true;
    }
    var rc = r[RAW_CONTENT];
    if (rc && rc.data && (!h.content || rc.savedAt > (h.content.savedAt || 0))) {
      var c = O.parseContent(rc.data);
      h.content = { savedAt: rc.savedAt, shape: c.shape, count: c.count, posts: c.posts, error: c.error };
      changed = true;
    }
    if (changed) { var o = {}; o[O.HISTORY_KEY] = h; await chrome.storage.local.set(o); }
    return { history: h, changed: changed };
  }

  /** New measurements of own posts → rs:x-own:early. */
  async function noteOwnPosts(record) {
    if (!record || !record.posts) return;
    var r = await chrome.storage.local.get(O.EARLY_KEY);
    var cur = r[O.EARLY_KEY] || {};
    var next = O.addEarly(cur, null);
    Object.keys(record.posts).forEach(function (k) {
      var p = record.posts[k];
      if (p && p.kind !== 'repost') next = O.addEarly(next, p);
    });
    if (JSON.stringify(next) !== JSON.stringify(cur)) { var o = {}; o[O.EARLY_KEY] = next; await chrome.storage.local.set(o); }
  }

  // ---- bridge ----------------------------------------------------------------------------------
  var lastPush = 0;
  async function bridge() {
    var L = self.OpenOutlierBridgeLink;
    if (!L) return null;
    var st = await L.getState();
    if (!st.connected) return null;
    var found = await L.findServer(st);
    if (!found || (found.health.features || []).indexOf('x-own') === -1) return null;
    return { L: L, port: found.port };
  }

  async function push(history, force) {
    if (!force && Date.now() - lastPush < PUSH_EVERY) return;
    var b = await bridge().catch(function () { return null; });
    if (!b) return;
    var handle = await ownHandle();
    var id = O.ownId(handle);
    var rec = (await chrome.storage.local.get(KEY_PREFIX + id))[KEY_PREFIX + id];
    var posts = rec && rec.posts ? Object.values(rec.posts) : [];
    var h = history && !history.otherAccount ? history : O.emptyHistory();
    var hasAnalytics = Object.keys(h.days).length > 0;
    var imp = hasAnalytics ? O.impressions90(h, Date.now()) : O.estimateFromPosts(posts, Date.now());
    var snaps = h.snapshots || [];
    var last = snaps[snaps.length - 1];
    var today = O.dayOf(Date.now());
    await b.L.post(b.port, '/x/own/daily', {
      handle: handle, restId: h.restId || (rec && rec.profile && rec.profile.restId) || null,
      days: O.dailyRows(h.days).slice(-400),
      snapshot: { followers: rec && rec.profile && rec.profile.followers != null ? rec.profile.followers : last && last.followers, verified_followers: last && last.d === today ? last.verifiedFollowers : null },
      imp90: { verified: hasAnalytics ? imp.verified : posts.length ? imp.views : null, source: imp.source },
      coveredFrom: O.coveredFrom(h), capturedAt: h.lastRawAt || null
    });
    lastPush = Date.now();
  }

  function run(forceMerge, forcePush) {
    return serial(async function () {
      if (!on()) return;
      var m = await mergeCaptures(forceMerge);
      await push(m.history, forcePush || m.changed).catch(function () { /* bridge down: next time */ });
    });
  }

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (changes[RAW_OVERVIEW] || changes[RAW_CONTENT]) run(false, true);
    if (changes[O.OWN_KEY]) run(true, true);
    Object.keys(changes).forEach(function (k) {
      if (k.indexOf(KEY_PREFIX + 'x/') !== 0 || !changes[k].newValue) return;
      serial(async function () {
        if (!on()) return;
        var id = O.ownId(await ownHandle());
        if (k !== KEY_PREFIX + id) return;
        await noteOwnPosts(changes[k].newValue);
        var h = (await chrome.storage.local.get(O.HISTORY_KEY))[O.HISTORY_KEY];
        await push(h, false).catch(function () {});
      });
    });
  });

  // ---- messages (x.com tabs and the Library) ---------------------------------------------------------
  async function ask(msg) {
    var b = await bridge();
    if (!b) return { ok: false, noBridge: true };
    var path;
    if (msg.what === 'curve') {
      var a = String(msg.account || 'me').toLowerCase();
      if (a !== 'me' && !/^x\/[a-z0-9_]{1,15}$/.test(a)) return { ok: false, error: 'bad account' };
      path = '/x/own/curve?account=' + encodeURIComponent(a);
    } else if (msg.what === 'page') {
      path = '/x/own/page?handle=' + encodeURIComponent(await ownHandle());
    } else if (msg.what === 'push') {
      await run(true, true);
      return { ok: true };
    } else return { ok: false, error: 'bad request' };
    var res = await b.L.read(b.port, path, 30000);
    var j = await res.json().catch(function () { return {}; });
    if (!res.ok) return { ok: false, error: j.error || 'HTTP ' + res.status };
    return j;
  }
  chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
    if (!msg || msg.type !== 'reelscope:x-own' || sender.id !== chrome.runtime.id) return;
    ask(msg).then(reply, function (e) { reply({ ok: false, error: String(e && e.message || e) }); });
    return true;
  });

  // A capture saved while the worker slept: merge it now.
  run(false, false);
  self.OpenOutlierXOwnBg = { run: run, mergeCaptures: mergeCaptures };
})();
