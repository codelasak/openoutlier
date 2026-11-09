// OpenOutlier – Reddit "Mentions" checker. Runs in the service worker.
//
// • Every ~15 min (chrome.alarms) while Chrome is open, checks each enabled
//   watch (search sorted by new; latest comments of the watched subreddits),
//   using the logged-in reddit.com session: through an open reddit.com tab when
//   there is one (a same-origin request injected with chrome.scripting),
//   otherwise straight from here with the browser's cookies.
//   Mentions use Reddit's RSS/Atom feeds only (search.rss with restrict_sr,
//   /r/<sub>/comments/.rss — the URLs reddit-watch uses): Reddit answers listing
//   .json with 403 even for logged-in tabs. Feeds allow about one request a
//   minute, so an alarm-driven queue sends one every ≥61 s.
//   Read-only: never posts, comments or votes.
// • New matches → a Chrome notification + the Mentions inbox in the Library.
// • Optional link to the reddit-watch home-server service (off by default):
//   GET /health, PUT /watches (our list is the source of truth), GET
//   /mentions?since=… merged into the same inbox. If the server is down the
//   extension keeps working on its own and says so in the Library.
//
// Storage: rs:watches = [watch], rs:mentions = { items: {id: mention}, read: {id: 1} },
//          rs:mentions-state = run status, rs:mention-server = { enabled, baseUrl, token }.
'use strict';

(function () {
  var MN = self.ReelScopeMentions;
  var WATCHES_KEY = 'rs:watches';
  var MENTIONS_KEY = 'rs:mentions';
  var STATE_KEY = 'rs:mentions-state';
  var SERVER_KEY = 'rs:mention-server';
  var ALARM = 'reelscope-mentions';
  var INTERVAL_MIN = 15;
  var BACKOFF_MIN = [15, 30, 60, 120]; // extra wait after the feeds are refused, growing while it repeats
  var DASHBOARD = 'dashboard/dashboard.html#/mentions';

  function get(keys) { return chrome.storage.local.get(keys); }
  function set(obj) { return chrome.storage.local.set(obj); }

  async function load() {
    var r = await get([WATCHES_KEY, MENTIONS_KEY, STATE_KEY, SERVER_KEY]);
    var store = r[MENTIONS_KEY] || {};
    return {
      watches: Array.isArray(r[WATCHES_KEY]) ? r[WATCHES_KEY] : [],
      store: { items: store.items || {}, read: store.read || {} },
      state: r[STATE_KEY] || {},
      server: r[SERVER_KEY] || {}
    };
  }

  async function patchState(patch) {
    var cur = (await get(STATE_KEY))[STATE_KEY] || {};
    var next = Object.assign({}, cur, patch);
    var o = {};
    o[STATE_KEY] = next;
    await set(o);
    return next;
  }

  /** Add mentions to the inbox (re-reading storage so a concurrent "mark read" isn't lost). */
  async function saveMentions(incoming, source) {
    var r = await get(MENTIONS_KEY);
    var cur = r[MENTIONS_KEY] || {};
    var merged = MN.mergeMentions(cur.items || {}, incoming, source);
    var store = MN.prune({ items: merged.items, read: cur.read || {} });
    var o = {};
    o[MENTIONS_KEY] = store;
    await set(o);
    await updateBadge(store);
    return merged.added;
  }

  async function updateBadge(store) {
    if (!store) store = (await get(MENTIONS_KEY))[MENTIONS_KEY] || {};
    var unread = Object.keys(store.items || {}).filter(function (id) { return !(store.read || {})[id]; }).length;
    try {
      await chrome.action.setBadgeBackgroundColor({ color: '#ff4500' });
      await chrome.action.setBadgeText({ text: unread ? (unread > 99 ? '99+' : String(unread)) : '' });
    } catch (e) { /* no action API in tests */ }
  }

  // ---- Reddit transport -------------------------------------------------------------
  async function redditTab() {
    var tabs = await chrome.tabs.query({ url: 'https://www.reddit.com/*' });
    return tabs.filter(function (t) { return t.status === 'complete' && !t.discarded; })[0] || null;
  }

  function classify(status, text, format) {
    if (status === 429) return { kind: 'rate' };
    if (status === 401 || status === 403) return { kind: 'refused', status: status };
    if (status === 404) return { kind: 'missing', status: status };
    if (status < 200 || status >= 300) return { kind: 'error', status: status };
    if (format === 'rss') return /<feed[\s>]/.test(text) ? { kind: 'ok', xml: text } : { kind: 'refused', status: status };
    if (/^\s*</.test(text)) return { kind: 'refused', status: status }; // HTML block / login page instead of JSON
    try { return { kind: 'ok', json: JSON.parse(text) }; } catch (e) { return { kind: 'error' }; }
  }

  // Runs inside the reddit.com tab (injected with chrome.scripting, so it works
  // even in tabs opened before OpenOutlier was installed or reloaded): a
  // same-origin, read-only GET with the page's own cookies. Must be self-contained.
  async function fetchInPage(path, accept) {
    try {
      var res = await fetch(path, { credentials: 'include', headers: { accept: accept }, signal: AbortSignal.timeout(20000) });
      var text = await res.text();
      var h = {};
      ['retry-after', 'x-ratelimit-reset', 'x-ratelimit-remaining'].forEach(function (n) { h[n] = res.headers.get(n); });
      return { status: res.status, text: text.length > 4e6 ? text.slice(0, 4e6) : text, headers: h };
    } catch (e) {
      return { status: 0, text: '', error: String(e && e.message || e) };
    }
  }

  /** How long Reddit asks us to wait, from Retry-After / x-ratelimit-* headers (ms, or 0). */
  function headerWaitMs(h, isRate) {
    if (!h) return 0;
    var ra = Number(h['retry-after']);
    if (isFinite(ra) && ra > 0) return Math.min(ra, 3600) * 1000;
    var reset = Number(h['x-ratelimit-reset']);
    var remaining = Number(h['x-ratelimit-remaining']);
    if (isFinite(reset) && reset > 0 && (isRate || (h['x-ratelimit-remaining'] != null && isFinite(remaining) && remaining < 1))) return Math.min(reset, 3600) * 1000 + 1000;
    return 0;
  }

  var tabProblem = null;

  /** GET a reddit.com path ('json' listing or 'rss' feed) with the user's session. Prefers an open reddit.com tab. */
  async function redditGet(path, format) {
    var accept = format === 'rss' ? 'application/atom+xml, application/xml;q=0.9, */*;q=0.5' : 'application/json';
    var tab = await redditTab();
    tabProblem = null;
    if (tab && chrome.scripting) {
      try {
        var out = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fetchInPage, args: [path, accept] });
        var res = out && out[0] && out[0].result;
        if (res && res.status) return Object.assign(classify(res.status, res.text, format), { via: 'tab', waitMs: headerWaitMs(res.headers, res.status === 429) });
        if (res && res.error) tabProblem = 'The reddit.com tab could not make the request (' + res.error + ').';
      } catch (e) {
        tabProblem = 'OpenOutlier could not use your reddit.com tab (' + String(e && e.message || e) + '). Reload that tab.';
      }
    }
    try {
      var r = await fetch('https://www.reddit.com' + path, { credentials: 'include', headers: { accept: accept }, signal: AbortSignal.timeout(20000) });
      var hd = {};
      ['retry-after', 'x-ratelimit-reset', 'x-ratelimit-remaining'].forEach(function (n) { hd[n] = r.headers && r.headers.get ? r.headers.get(n) : null; });
      return Object.assign(classify(r.status, await r.text(), format), { via: 'direct', waitMs: headerWaitMs(hd, r.status === 429) });
    } catch (e) {
      return { kind: 'error', via: 'direct', message: String(e.message || e) };
    }
  }

  // ---- notifications --------------------------------------------------------------
  function notify(list) {
    var show = list.filter(function (m) { return m.notify !== false; });
    if (!show.length) return;
    var first = show[0];
    var title = show.length === 1
      ? 'Reddit: "' + first.query + '" in r/' + first.subreddit
      : show.length + ' new Reddit mentions';
    var message = show.length === 1
      ? (first.kind === 'comment' ? 'Comment on: ' : '') + (first.title || '') + (first.excerpt ? '\n' + first.excerpt.slice(0, 140) : '')
      : show.slice(0, 4).map(function (m) { return '“' + m.query + '” · r/' + m.subreddit + ': ' + (m.title || m.excerpt || '').slice(0, 60); }).join('\n');
    try {
      chrome.notifications.create('reelscope-mentions-' + Date.now(), {
        type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: title, message: message, priority: 0
      });
    } catch (e) { /* notifications unavailable */ }
  }

  if (chrome.notifications && chrome.notifications.onClicked) {
    chrome.notifications.onClicked.addListener(function (id) {
      if (id.indexOf('reelscope-mentions-') !== 0) return;
      chrome.tabs.create({ url: chrome.runtime.getURL(DASHBOARD) });
      chrome.notifications.clear(id);
    });
  }

  // ---- the check ------------------------------------------------------------------
  var running = null;

  function runCheck(opts) {
    if (running) return running;
    running = doCheck(opts || {}).catch(function (e) {
      return patchState({ running: false, lastError: String(e && e.message || e) });
    }).then(function (r) { running = null; return r; });
    return running;
  }

  var RSS_GAP_MS = 61000; // Reddit's feeds allow about one request a minute
  var RSS_ALARM = 'reelscope-mentions-rss';

  function errorText(r) {
    return r.kind === 'rate' ? 'Reddit asked to slow down (HTTP 429).'
      : r.kind === 'refused' ? 'Reddit refused the feed request (HTTP ' + (r.status || '?') + ').'
      : r.kind === 'missing' ? 'Not found (HTTP 404): check the subreddit names.'
      : 'Request failed' + (r.status ? ' (HTTP ' + r.status + ')' : r.message ? ': ' + r.message : '') + '.';
  }

  /** Match items of one job, store the new ones; returns the newly added mentions (with notify). */
  async function handleItems(job, items, watches, firstSeen) {
    var known = (await get(MENTIONS_KEY))[MENTIONS_KEY] || {};
    var owners = watches.filter(function (w) { return job.watchIds.indexOf(w.id) !== -1; });
    var found = MN.processItems(known.items || {}, owners, items, { now: Date.now(), firstSeen: firstSeen });
    var added = found.length ? await saveMentions(found, 'extension') : [];
    added.forEach(function (a) { var f = found.filter(function (x) { return x.id === a.id; })[0]; a.notify = f ? f.notify : false; });
    return added;
  }

  /**
   * Every 15 minutes (or "Check now" / a watch edit): queue every job's RSS feed,
   * send the first one if the 61 s gap allows, and sync with the home server.
   * The rest of the queue goes out one a minute through the RSS alarm.
   * (Reddit answers listing .json with 403 even for logged-in tabs, so Mentions
   * uses the Atom feeds only — the same URLs as reddit-watch.)
   */
  async function doCheck(opts) {
    var d = await load();
    var now = Date.now();
    var watches = d.watches.filter(function (w) { return w && w.enabled !== false; });
    var plan = MN.planJobs(watches);
    var state = d.state;
    if (!opts.manual && state.backoffUntil && now < state.backoffUntil) {
      await syncServer(d);
      return { skipped: 'backoff' };
    }
    var firstSeen = Object.assign({}, state.firstSeen || {});
    watches.forEach(function (w) { if (!firstSeen[w.id]) firstSeen[w.id] = now; });
    var keys = plan.jobs.map(function (j) { return j.key; });
    var jobs = Object.assign({}, state.jobs || {});
    Object.keys(jobs).forEach(function (k) { if (keys.indexOf(k) === -1) delete jobs[k]; });
    // Drop queued feeds of watches that were removed or edited, then add today's plan.
    var queue = await withQueue(async function () {
      var cur = (await get(STATE_KEY))[STATE_KEY] || {};
      var q = queueJobs((cur.rssQueue || []).filter(function (x) { return keys.indexOf(x.key) !== -1; }), plan.jobs);
      var fresh = { warnings: plan.warnings, firstSeen: firstSeen, jobs: jobs, rssQueue: q, lastCheckAt: now,
        mode: null, note: null, jsonBlockedUntil: null }; // (mode/note/jsonBlockedUntil: leftovers of the JSON version)
      // A manual check, or an expired backoff, starts clean.
      if (opts.manual || !cur.backoffUntil || now >= cur.backoffUntil) Object.assign(fresh, { backoffUntil: null, lastError: null }); // (rssNextAt still holds: a 429 wait is respected)
      await patchState(fresh);
      return q;
    });
    var sent = await pumpRss();
    var fromServer = await syncServer(await load());
    return { jobs: plan.jobs.length, queued: queue.length, sent: sent.sent || 0, new: sent.new || 0, kind: sent.kind, fromServer: fromServer };
  }

  /** Add jobs to the RSS queue (by key, no duplicates, keeps order). */
  function queueJobs(queue, jobs) {
    var out = (queue || []).slice();
    jobs.forEach(function (j) {
      if (!out.some(function (q) { return q.key === j.key; })) out.push({ key: j.key, rssPath: j.rssPath, watchIds: j.watchIds });
    });
    return out;
  }

  // Every read-modify-write of the RSS queue (doCheck refilling it, the pump
  // taking from it) goes through this one chain, so they can't overwrite each other.
  var queueChain = Promise.resolve();
  function withQueue(fn) {
    var p = queueChain.then(fn);
    queueChain = p.catch(function () {});
    return p;
  }

  function pumpRss() {
    return withQueue(pumpOnce).catch(function (e) { return patchState({ lastError: String(e && e.message || e) }).then(function () { return { sent: 0 }; }); });
  }

  var RATE_MAX_MS = 60 * 60000;

  /**
   * Send at most one RSS request (≥61 s after the previous one, longer when
   * Reddit's headers say so), then schedule the next with an alarm, so the
   * service worker never sleeps for a minute. Call only through withQueue.
   */
  async function pumpOnce() {
    var d = await load();
    var st = d.state;
    var queue = (st.rssQueue || []).slice();
    var watches = d.watches.filter(function (w) { return w && w.enabled !== false; });
    // Drop feeds whose watch was edited or removed since they were queued.
    queue = queue.filter(function (j) { return j.rssPath && watches.some(function (w) { return j.watchIds.indexOf(w.id) !== -1; }); });
    if (!queue.length) {
      if ((st.rssQueue || []).length) await patchState({ rssQueue: [] });
      try { chrome.alarms.clear(RSS_ALARM); } catch (e) { /* ignore */ }
      return { sent: 0 };
    }
    var now = Date.now();
    if (st.rssNextAt && now < st.rssNextAt) {
      if (queue.length !== st.rssQueue.length) await patchState({ rssQueue: queue });
      chrome.alarms.create(RSS_ALARM, { when: st.rssNextAt });
      return { sent: 0, waitMs: st.rssNextAt - now };
    }
    var job = queue.shift();
    var r = await redditGet(job.rssPath, 'rss');
    var jobs = Object.assign({}, st.jobs || {});
    var patch = { rssQueue: queue, rssNextAt: Date.now() + Math.max(RSS_GAP_MS, r.waitMs || 0), via: r.via, tabProblem: tabProblem };
    var added = [];
    if (r.kind === 'ok') {
      var items = MN.itemsFromAtom(r.xml);
      added = await handleItems(job, items, watches, st.firstSeen || {});
      jobs[job.key] = { lastOk: Date.now(), lastError: null, items: items.length };
      Object.assign(patch, { lastRunAt: Date.now(), lastOkAt: Date.now(), lastError: null, strikes: 0, backoffUntil: null, lastNew: added.length });
    } else {
      jobs[job.key] = Object.assign({}, jobs[job.key], { lastError: new Date().toISOString() + ' ' + errorText(r) });
      if (r.kind === 'rate') {
        // Growing wait (2, 4, 8 … min, at most 1 h), or longer if Reddit's headers say so.
        // The feed goes to the back of the queue so one bad feed can't starve the others.
        var rs = (st.strikes || 0) + 1;
        var wait = Math.min(RATE_MAX_MS, Math.max(r.waitMs || 0, 2 * RSS_GAP_MS * Math.pow(2, rs - 1)));
        Object.assign(patch, { rssQueue: queue.concat([job]), strikes: rs, rssNextAt: Date.now() + wait, backoffUntil: Date.now() + wait,
          lastRunAt: Date.now(), lastError: 'Reddit asked to slow down (HTTP 429). Waiting ' + Math.round(wait / 60000) + ' min.' });
      } else if (r.kind === 'refused') {
        var strikes = (st.strikes || 0) + 1;
        Object.assign(patch, { rssQueue: [], lastRunAt: Date.now(), strikes: strikes,
          lastError: 'Reddit refused its RSS feeds (HTTP ' + (r.status || '?') + '). OpenOutlier will try again later; your home server (if linked) keeps watching.',
          backoffUntil: Date.now() + BACKOFF_MIN[Math.min(strikes, BACKOFF_MIN.length) - 1] * 60000 });
      } else {
        Object.assign(patch, { lastRunAt: Date.now(), lastError: errorText(r) });
      }
    }
    patch.jobs = jobs;
    var next = await patchState(patch);
    notify(added);
    if ((next.rssQueue || []).length) chrome.alarms.create(RSS_ALARM, { when: next.rssNextAt });
    return { sent: 1, new: added.length, kind: r.kind };
  }

  // ---- optional home-server link (reddit-watch) ---------------------------------------
  function serverOrigin(baseUrl) {
    try { var u = new URL(baseUrl); return /^https?:$/.test(u.protocol) ? u.origin : null; } catch (e) { return null; }
  }

  async function serverFetch(cfg, method, path, body) {
    var url = String(cfg.baseUrl).replace(/\/+$/, '') + path;
    var res = await fetch(url, {
      method: method,
      headers: Object.assign({ authorization: 'Bearer ' + (cfg.token || '') }, body ? { 'content-type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000)
    });
    var text = await res.text();
    if (res.status === 401) throw new Error('The server refused the token (401).');
    if (!res.ok) throw new Error('HTTP ' + res.status + (text ? ': ' + text.slice(0, 120) : ''));
    return text ? JSON.parse(text) : null;
  }

  function watchesHash(watches) {
    var s = JSON.stringify(watches);
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return String(h);
  }

  /** Returns how many new mentions came from the server (0 when off / unreachable). */
  async function syncServer(d, opts) {
    opts = opts || {};
    var cfg = d.server;
    if (!cfg.enabled || !cfg.baseUrl) return 0;
    var origin = serverOrigin(cfg.baseUrl);
    var st = Object.assign({}, d.state.server || {});
    try {
      if (!origin) throw new Error('The server address is not a valid http(s) URL.');
      var granted = await chrome.permissions.contains({ origins: [origin + '/*'] });
      if (!granted) throw new Error('Chrome has no permission for ' + origin + '. Save the server settings in the Library again to grant it.');
      var h = await serverFetch(cfg, 'GET', '/health');
      if (!h || h.app !== 'reddit-watch') throw new Error('That address is not a reddit-watch server.');
      var hash = watchesHash(d.watches);
      var push = opts.forcePush || st.pushedHash !== hash || st.pushedTo !== origin;
      if (!push && d.watches.length) {
        // The server may have lost its list (reinstalled, database reset): push again if it has none.
        try {
          var theirs = await serverFetch(cfg, 'GET', '/watches');
          if (Array.isArray(theirs) && !theirs.length) push = true;
        } catch (e) { /* older server without GET /watches: keep going */ }
      }
      if (push) {
        await serverFetch(cfg, 'PUT', '/watches', d.watches);
        st.pushedHash = hash;
        st.pushedTo = origin;
        st.lastPushAt = Date.now();
      }
      // 1 ms back: if the server capped its answer, items sharing the last foundAt aren't skipped (dedupe by id).
      var since = st.lastPullTo === origin && st.lastPullFoundAt ? st.lastPullFoundAt - 1 : Date.now() - 7 * 864e5;
      var list = await serverFetch(cfg, 'GET', '/mentions?since=' + since);
      list = Array.isArray(list) ? list : (list && Array.isArray(list.mentions) ? list.mentions : []);
      var maxFound = since;
      list.forEach(function (m) { var f = MN.shape(m).foundAt; if (f && f > maxFound) maxFound = f; });
      var added = list.length ? await saveMentions(list, 'hayati') : [];
      var firstPull = st.lastPullTo !== origin;
      added.forEach(function (m) { m.notify = !firstPull && m.createdAt != null && Date.now() - m.createdAt <= 48 * 3600000; });
      notify(added);
      st.lastPullFoundAt = maxFound;
      st.lastPullTo = origin;
      st.lastOkAt = Date.now();
      st.lastError = null;
      st.version = h.version || null;
      await patchState({ server: st });
      return added.length;
    } catch (e) {
      st.lastError = new Date().toISOString() + ' ' + String(e && e.message || e);
      st.lastFailAt = Date.now();
      await patchState({ server: st });
      return 0;
    }
  }

  // ---- wiring ----------------------------------------------------------------------
  // Create the 15-minute alarm only if it doesn't exist: re-creating it on every
  // service-worker start would keep pushing the next check back.
  chrome.alarms.get(ALARM).then(function (a) {
    if (!a) chrome.alarms.create(ALARM, { periodInMinutes: INTERVAL_MIN, delayInMinutes: 1 });
  }, function () { chrome.alarms.create(ALARM, { periodInMinutes: INTERVAL_MIN, delayInMinutes: 1 }); });
  chrome.alarms.onAlarm.addListener(function (a) {
    if (a.name === ALARM) runCheck({});
    if (a.name === RSS_ALARM) pumpRss();
  });

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || sender.id !== chrome.runtime.id) return;
    if (msg.type === 'reelscope:mentions-check') {
      runCheck({ manual: true }).then(sendResponse, function (e) { sendResponse({ error: String(e) }); });
      return true;
    }
    if (msg.type === 'reelscope:mentions-server-sync') {
      load().then(function (d) { return syncServer(d, { forcePush: true }); }).then(function (n) { sendResponse({ ok: true, added: n }); }, function (e) { sendResponse({ error: String(e) }); });
      return true;
    }
  });

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (changes[MENTIONS_KEY]) updateBadge(changes[MENTIONS_KEY].newValue || {});
    // A new or edited watch: check soon instead of waiting up to 15 minutes.
    if (changes[WATCHES_KEY]) {
      clearTimeout(self.__rsWatchTimer);
      self.__rsWatchTimer = setTimeout(function () { runCheck({}); }, 4000);
    }
  });

  chrome.runtime.onStartup.addListener(function () { updateBadge(); });
  updateBadge();

  self.ReelScopeMentionsBg = { runCheck: runCheck, syncServer: syncServer, pumpRss: pumpRss };
})();
