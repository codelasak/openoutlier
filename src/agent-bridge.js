// ReelScope – connection to the local MCP server (mcp/server.mjs) so AI agents
// can use your library. Runs in the service worker.
//
// • Finds the server by scanning 127.0.0.1:47811–47820 for /health that
//   answers {"app":"reelscope"} (so it never talks to some other program).
// • Pushes the library: everything once, then only accounts that change.
// • Picks up agent commands (collect a profile, refresh a reel) and runs them
//   in an Instagram tab: an open one if there is one, otherwise a background
//   tab it opens and closes again. Reddit commands (collect_reddit) always get
//   their own small, unfocused window on the subreddit's / user's page, since
//   Reddit is read by scrolling the page (it refuses its listing JSON).
//   TikTok commands (collect_tiktok, refresh_tiktok, download_tiktok) do the
//   same on the profile / video page: TikTok's API is signed, so ReelScope
//   only reads what the page loads.
// Turn it off in the popup ("Connect to AI agents").
'use strict';

(function () {
  var PORTS = [47811, 47812, 47813, 47814, 47815, 47816, 47817, 47818, 47819, 47820];
  var KEY_PREFIX = 'rs:p:';
  var ORG_KEY = 'rs:org';
  var WATCHES_KEY = 'rs:watches';   // Reddit keyword watches (src/mentions-bg.js)
  var MENTIONS_KEY = 'rs:mentions'; // { items: {id: mention}, read: {id: 1} }
  var SETTINGS_KEY = 'rs:settings';
  var STATE_KEY = 'rs:bridge'; // { port, syncId, connected, lastSyncAt, lastError }
  var ALARM = 'reelscope-bridge';

  var RUNNING_KEY = 'rs:running'; // command id → { port, tabId, openedTab, startedAt } (survives worker restarts)
  var TIMEOUT = 12 * 60 * 1000;
  function getRunning() { return chrome.storage.session.get(RUNNING_KEY).then(function (r) { return r[RUNNING_KEY] || {}; }); }
  function putRunning(map) { var o = {}; o[RUNNING_KEY] = map; return chrome.storage.session.set(o); }

  function getState() { return chrome.storage.local.get(STATE_KEY).then(function (r) { return r[STATE_KEY] || {}; }); }
  function setState(patch) {
    return getState().then(function (cur) {
      var o = {};
      o[STATE_KEY] = Object.assign({}, cur, patch);
      return chrome.storage.local.set(o);
    });
  }
  async function enabled() {
    var r = await chrome.storage.local.get(SETTINGS_KEY);
    return !(r[SETTINGS_KEY] && r[SETTINGS_KEY].agentBridge === false);
  }

  async function health(port) {
    try {
      var res = await fetch('http://127.0.0.1:' + port + '/health', { signal: AbortSignal.timeout(900) });
      var j = await res.json();
      return j && j.app === 'reelscope' ? j : null;
    } catch (e) {
      return null;
    }
  }

  async function findServer(state) {
    if (state.port) {
      var h = await health(state.port);
      if (h) return { port: state.port, health: h };
    }
    for (var i = 0; i < PORTS.length; i++) {
      if (PORTS[i] === state.port) continue;
      var h2 = await health(PORTS[i]);
      if (h2) return { port: PORTS[i], health: h2 };
    }
    return null;
  }

  async function post(port, path, body) {
    var res = await fetch('http://127.0.0.1:' + port + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error((await res.json().catch(function () { return {}; })).error || 'HTTP ' + res.status);
    return res.json();
  }

  async function snapshot(onlyUsers) {
    var all = await chrome.storage.local.get(null);
    var accounts = {};
    if (onlyUsers) {
      onlyUsers.forEach(function (u) { accounts[u] = all[KEY_PREFIX + u] || null; });
    } else {
      Object.keys(all).forEach(function (k) { if (k.indexOf(KEY_PREFIX) === 0) accounts[k.slice(KEY_PREFIX.length)] = all[k]; });
    }
    return {
      accounts: accounts, org: all[ORG_KEY] || null,
      watches: all[WATCHES_KEY] || [], mentions: all[MENTIONS_KEY] || { items: {}, read: {} },
      count: Object.keys(all).filter(function (k) { return k.indexOf(KEY_PREFIX) === 0; }).length
    };
  }

  // ---- sync -------------------------------------------------------------------
  var pendingUsers = {};
  var pendingTimer = null;
  var syncing = Promise.resolve();

  async function tick() {
    if (!(await enabled())) { await setState({ connected: false }); return; }
    var state = await getState();
    var found = await findServer(state);
    if (!found) {
      if (state.connected !== false) await setState({ connected: false, port: null });
      return;
    }
    try {
      var snap = await snapshot();
      if (found.health.syncId !== state.syncId || found.health.accounts !== snap.count) {
        var r = await post(found.port, '/sync', { full: true, accounts: snap.accounts, org: snap.org, watches: snap.watches, mentions: snap.mentions });
        await setState({ port: found.port, syncId: r.syncId, connected: true, lastSyncAt: Date.now(), lastError: null, lastBackupAt: found.health.lastBackupAt || null, lastBackupOk: found.health.lastBackupOk });
      } else {
        await setState({ port: found.port, connected: true, lastError: null, lastBackupAt: found.health.lastBackupAt || null, lastBackupOk: found.health.lastBackupOk });
      }
      await pollCommands(found.port);
      await expireStale();
    } catch (e) {
      await setState({ port: found.port, connected: false, lastError: String(e.message || e) });
    }
  }

  function syncSoon(users, org, watches, mentions) {
    users.forEach(function (u) { pendingUsers[u] = true; });
    if (org) pendingUsers[' org'] = true;
    if (watches) pendingUsers[' watches'] = true;
    if (mentions) pendingUsers[' mentions'] = true;
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(function () { syncing = syncing.then(flushSync); }, 2500);
  }

  async function flushSync() {
    clearTimeout(pendingTimer);
    var users = Object.keys(pendingUsers).filter(function (u) { return u.charAt(0) !== ' '; });
    var withOrg = !!pendingUsers[' org'];
    var withWatches = !!pendingUsers[' watches'];
    var withMentions = !!pendingUsers[' mentions'];
    pendingUsers = {};
    if (!users.length && !withOrg && !withWatches && !withMentions) return;
    if (!(await enabled())) return;
    var state = await getState();
    if (!state.connected || !state.port) return; // the next tick does a full sync
    try {
      var snap = await snapshot(users);
      var r = await post(state.port, '/sync', { full: false, accounts: snap.accounts, org: withOrg ? snap.org : undefined,
        watches: withWatches ? snap.watches : undefined, mentions: withMentions ? snap.mentions : undefined });
      await setState({ syncId: r.syncId, lastSyncAt: Date.now(), lastError: null });
    } catch (e) {
      await setState({ connected: false, lastError: String(e.message || e) });
    }
  }

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    var users = Object.keys(changes).filter(function (k) { return k.indexOf(KEY_PREFIX) === 0; }).map(function (k) { return k.slice(KEY_PREFIX.length); });
    var org = !!changes[ORG_KEY];
    var watches = !!changes[WATCHES_KEY];
    var mentions = !!changes[MENTIONS_KEY];
    if (users.length || org || watches || mentions) syncSoon(users, org, watches, mentions);
    if (changes[SETTINGS_KEY]) tick();
  });

  // ---- commands ---------------------------------------------------------------
  async function pollCommands(port) {
    var res = await fetch('http://127.0.0.1:' + port + '/commands');
    if (!res.ok) return;
    var list = (await res.json()).commands || [];
    for (var i = 0; i < list.length; i++) startCommand(port, list[i]);
  }

  async function instagramTab() {
    var tabs = await chrome.tabs.query({ url: 'https://www.instagram.com/*' });
    var ready = tabs.filter(function (t) { return t.status === 'complete' && !t.discarded; });
    return ready[0] || null;
  }

  async function sendCommand(tabId, command) {
    // The content script may still be starting: retry for up to ~40 s.
    for (var i = 0; i < 20; i++) {
      try {
        var r = await chrome.tabs.sendMessage(tabId, { type: 'reelscope:command', command: command });
        if (r && r.accepted) return true;
      } catch (e) { /* not ready yet */ }
      await new Promise(function (r2) { setTimeout(r2, 2000); });
    }
    return false;
  }

  async function finish(id, result) {
    var map = await getRunning();
    var job = map[id];
    if (!job) return;
    delete map[id];
    await putRunning(map);
    syncing = syncing.then(flushSync); // make sure the new data reached the server first
    await syncing;
    if (job.openedTab) chrome.tabs.remove(job.tabId).catch(function () {});
    try { await post(job.port, '/commands/result', { id: id, result: result }); } catch (e) { /* server gone */ }
  }

  async function expireStale() {
    var map = await getRunning();
    Object.keys(map).forEach(function (id) {
      if (Date.now() - map[id].startedAt > TIMEOUT) finish(id, { ok: false, error: 'Timed out after 12 minutes.' });
    });
  }

  function redditUrl(a) {
    var name = encodeURIComponent(String(a.name || '').replace(/^\/?(r|u|user)\//i, ''));
    if (a.kind === 'user') return 'https://www.reddit.com/user/' + name + '/submitted/';
    var sort = /^(hot|new|top|rising|controversial)$/.test(a.sort || '') ? a.sort : 'top';
    return 'https://www.reddit.com/r/' + name + '/' + sort + '/' + (sort === 'top' ? '?t=' + (/^(hour|day|week|month|year|all)$/.test(a.t || '') ? a.t : 'year') : '');
  }

  function tiktokUrl(type, a) {
    var name = encodeURIComponent(String(a.username || '').replace(/^\/?(tt\/|@)/i, '').toLowerCase());
    if (type === 'collect_tiktok') return 'https://www.tiktok.com/@' + name;
    return 'https://www.tiktok.com/@' + (name || 'i') + '/video/' + encodeURIComponent(String(a.id || ''));
  }

  async function startCommand(port, command) {
    var map = await getRunning();
    if (map[command.id]) return;
    var reddit = command.type === 'collect_reddit';
    var tiktok = /^(collect|refresh|download)_tiktok$/.test(command.type);
    var pageUrl = reddit ? redditUrl(command.args || {}) : tiktok ? tiktokUrl(command.type, command.args || {}) : null;
    var tab = pageUrl ? null : await instagramTab();
    var opened = false;
    if (!tab && pageUrl) {
      // Reddit and TikTok are read from the page itself, and their infinite
      // scroll may not load in a background tab: use a small unfocused window of
      // its own, closed again when the command finishes.
      try {
        var win = await chrome.windows.create({ url: pageUrl, focused: false, type: 'normal', width: 520, height: 900 });
        tab = win.tabs && win.tabs[0];
      } catch (e) { tab = null; }
      opened = !!tab;
    }
    if (!tab) {
      tab = await chrome.tabs.create({ url: pageUrl || 'https://www.instagram.com/', active: false });
      opened = true;
    }
    map[command.id] = { port: port, tabId: tab.id, openedTab: opened, startedAt: Date.now() };
    await putRunning(map);
    var ok = await sendCommand(tab.id, command);
    var site = reddit ? 'Reddit' : tiktok ? 'TikTok' : 'Instagram';
    var host = reddit ? 'www.reddit.com' : tiktok ? 'www.tiktok.com' : 'instagram.com';
    if (!ok) finish(command.id, { ok: false, error: 'Could not reach ' + site + ' in the browser. Is ' + host + ' loading and are you logged in?' });
  }

  chrome.runtime.onMessage.addListener(function (msg, sender) {
    if (!msg || sender.id !== chrome.runtime.id) return;
    if (msg.type === 'reelscope:command-done' && msg.id) finish(msg.id, msg.result || {});
    if (msg.type === 'reelscope:bridge-check') tick();
  });

  // ---- schedule -----------------------------------------------------------------
  chrome.alarms.get(ALARM).then(function (a) { if (!a) chrome.alarms.create(ALARM, { periodInMinutes: 0.5 }); },
    function () { chrome.alarms.create(ALARM, { periodInMinutes: 0.5 }); });
  chrome.alarms.onAlarm.addListener(function (a) { if (a.name === ALARM) tick(); });
  chrome.runtime.onStartup.addListener(tick);
  chrome.runtime.onInstalled.addListener(tick);
  tick();
})();
