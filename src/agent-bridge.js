// OpenOutlier – connection to the local MCP server (mcp/server.mjs) so AI agents
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
//   same on the profile / video page: TikTok's API is signed, so OpenOutlier
//   only reads what the page loads.
//   YouTube commands: collect_youtube opens the channel's Videos tab in a small
//   unfocused window (its grid only loads more while it is rendered), scrolls it,
//   then loads the Shorts tab in the same window and scrolls that (one step per
//   tab, each a fresh page load so YouTube inlines that tab's first page).
//   refresh_youtube opens one watch / Shorts page in a muted background tab and
//   waits for its exact stats, like "Get exact stats" (youtube-exact.js).
// • Sends the feature switches (src/features.js) and today's Data API unit count
//   to POST /settings; the answer (does the bridge have an API key, is My YouTube
//   channel connected, the bridge's own unit count) goes into rs:bridge for the
//   Features tab and the popup. "Copy key to bridge" (reelscope:bridge-key) sends
//   the key from rs:settings to the bridge, which stores it in
//   ~/.openoutlier/youtube-api-key for background jobs.
// • Niche tracking (phase 1): the tracking list rides along with the org record; the
//   breakout threshold (rs:settings.niche) goes with the settings, and the bridge's
//   answer carries new breakouts, which become a Chrome notification (breakout-alerts)
//   and the "Hızlı yükselenler" list (rs:niche-alerts). The Library's Niş Takibi page
//   asks the bridge through reelscope:niche.
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
  var ALERTS_KEY = 'rs:niche-alerts'; // { items: [breakout], unseen: n } (newest first, at most 40)
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

  // Old MCP servers (one per Claude session, started before an update) can keep answering on a
  // second port with older code. The saved port is kept only while it serves everything this
  // extension knows about; otherwise every port is checked and the most capable bridge wins
  // (ties: the lowest port, normally the launchd daemon's 47811).
  var WANT_FEATURES = ['settings', 'tracker', 'niche', 'own-history', 'cards', 'content-tools', 'discovery', 'providers'];
  function capability(h) {
    var f = (h && h.features) || [];
    return WANT_FEATURES.filter(function (x) { return f.indexOf(x) !== -1; }).length;
  }
  async function findServer(state) {
    if (state.port) {
      var h = await health(state.port);
      if (h && capability(h) === WANT_FEATURES.length) return { port: state.port, health: h };
    }
    var all = await Promise.all(PORTS.map(function (p) { return health(p).then(function (x) { return x ? { port: p, health: x } : null; }); }));
    var best = null;
    all.forEach(function (s) { if (s && (!best || capability(s.health) > capability(best.health))) best = s; });
    return best;
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

  /**
   * A read from the bridge. Chrome sends no Origin header on an extension's GET to a host it
   * has permission for, and the bridge only answers its paired extension (it checks Origin),
   * so a plain GET is refused. Reads go out as POST …?as=get, which does carry the Origin.
   */
  function read(port, path, timeoutMs) {
    return fetch('http://127.0.0.1:' + port + path + (path.indexOf('?') === -1 ? '?' : '&') + 'as=get', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined
    });
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
      // A refused settings call must not make the bridge look disconnected (sync and commands still work).
      await pushSettings(found).catch(function (e) { console.warn('[OpenOutlier] the bridge refused the feature settings:', e && e.message); });
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

  // ---- feature switches + quota → the bridge ---------------------------------------
  var QUOTA_KEY = 'rs:yt-api-quota';
  var lastSettings = { body: '', at: 0 };
  var SETTINGS_EVERY = 5 * 60 * 1000; // also refreshes what the bridge reports (key, OAuth)

  async function pushSettings(found, force) {
    if ((found.health.features || []).indexOf('settings') === -1) return; // an older bridge
    var F = self.OpenOutlierFeatures;
    var r = await chrome.storage.local.get([SETTINGS_KEY, QUOTA_KEY]);
    var s = r[SETTINGS_KEY] || {};
    // Niche and radar settings have their own storage keys (src/features.js SPLIT); older installs have them in rs:settings.
    var niche = F && F.readSetting ? await F.readSetting('niche') : s.niche;
    var radar = F && F.readSetting ? await F.readSetting('radar') : s.radar;
    var body = JSON.stringify({ features: F ? F.sanitize(s.features) : {}, quota: r[QUOTA_KEY] || null, niche: niche && typeof niche === 'object' ? niche : null,
      radar: radar && typeof radar === 'object' ? radar : null });
    if (!force && body === lastSettings.body && Date.now() - lastSettings.at < SETTINGS_EVERY) return;
    var res = await post(found.port, '/settings', JSON.parse(body));
    lastSettings = { body: body, at: Date.now() };
    await saveSettingsAnswer(res);
    if (res.radarProposal && res.radarProposal.keywords) await applyRadarProposal(res.radarProposal).catch(function () {});
    if (res.niche && Array.isArray(res.niche.alerts) && res.niche.alerts.length) await showBreakouts(found.port, res.niche.alerts);
    if (res.own && Array.isArray(res.own.milestones) && res.own.milestones.length) await showMilestones(found.port, res.own.milestones);
  }

  // ---- own-channel milestones → Chrome notification (only with own-milestones on; acked either way) ----
  async function showMilestones(port, list) {
    var F = self.OpenOutlierFeatures;
    var on = false;
    try { if (F) { await F.ready; on = F.isOn('own-milestones'); } } catch (e) { /* default off */ }
    if (on) {
      var tr = F && F.uiLang && F.uiLang() === 'tr';
      var n = function (v) { return Number(v).toLocaleString(tr ? 'tr-TR' : 'en-US'); };
      var line = function (m) {
        var kind = { subs: tr ? 'abone' : 'subscribers', views: tr ? 'toplam izlenme' : 'total views', hours: tr ? 'saat izlenme' : 'watch hours', video: tr ? 'izlenmeli ilk video' : 'views on one video' }[m.kind] || '';
        return n(m.value) + ' ' + kind + (m.video && m.video.title ? ': ' + String(m.video.title).slice(0, 60) : '');
      };
      try {
        chrome.notifications.create('openoutlier-milestone-' + Date.now(), { type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title: (tr ? 'Kilometre taşı: ' : 'Milestone: ') + (list[0].title || 'YouTube'), message: list.slice(0, 4).map(line).join('\n'), priority: 1 });
      } catch (e) { /* notifications unavailable */ }
    }
    await post(port, '/youtube/own/milestones/ack', { milestones: list.map(function (m) { return { channel_id: m.channel_id, key: m.key }; }) }).catch(function () {});
  }

  // ---- breakouts → Chrome notification + the Library's list ----------------------------
  async function showBreakouts(port, alerts) {
    var F = self.OpenOutlierFeatures;
    var on = true;
    try { if (F) { await F.ready; on = F.isOn('breakout-alerts'); } } catch (e) { /* default on */ }
    var r = await chrome.storage.local.get(ALERTS_KEY);
    var cur = r[ALERTS_KEY] || { items: [], unseen: 0 };
    var have = {};
    cur.items.forEach(function (a) { have[a.video_id + ':' + a.at_h] = true; });
    var fresh = alerts.filter(function (a) { return a && /^[A-Za-z0-9_-]{11}$/.test(String(a.video_id)) && !have[a.video_id + ':' + a.at_h]; });
    var o = {};
    o[ALERTS_KEY] = { items: fresh.map(function (a) { return Object.assign({ seenAt: Date.now() }, a); }).reverse().concat(cur.items).slice(0, 40), unseen: (cur.unseen || 0) + fresh.length };
    await chrome.storage.local.set(o);
    if (on && fresh.length) notifyBreakouts(fresh);
    // Acked either way: switched off means "don't tell me", not "tell me later".
    await post(port, '/youtube/niche/alerts/ack', { alerts: alerts.map(function (a) { return { video_id: a.video_id, at_h: a.at_h }; }) }).catch(function () {});
  }

  function notifyBreakouts(list) {
    var F = self.OpenOutlierFeatures;
    var tr = F && F.uiLang && F.uiLang() === 'tr';
    var x = function (a) { return (Math.round(a.score * 10) / 10).toLocaleString(tr ? 'tr-TR' : 'en-US') + '×'; };
    var first = list[0];
    var title = list.length === 1
      ? (tr ? 'Hızlı yükselen: ' : 'Breakout: ') + (first.channel || 'YouTube')
      : (tr ? list.length + ' hızlı yükselen video' : list.length + ' breakout videos');
    var message = list.length === 1
      ? (first.title || first.video_id) + '\n' + (tr ? first.at + ' içinde kanalın normalinin ' + x(first) + '\'i' : x(first) + ' the channel\'s normal at ' + first.at)
      : list.slice(0, 4).map(function (a) { return x(a) + ' · ' + (a.channel || '') + ': ' + String(a.title || '').slice(0, 50); }).join('\n');
    try {
      chrome.notifications.create('openoutlier-breakout-' + Date.now(), { type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'), title: title, message: message, priority: 1 });
    } catch (e) { /* notifications unavailable */ }
  }

  if (chrome.notifications && chrome.notifications.onClicked) {
    chrome.notifications.onClicked.addListener(function (id) {
      if (id.indexOf('openoutlier-breakout-') !== 0 && id.indexOf('openoutlier-milestone-') !== 0) return;
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html#/' + (id.indexOf('openoutlier-milestone-') === 0 ? 'my-youtube' : 'niche')) });
      chrome.notifications.clear(id);
    });
  }

  // Radar keywords the bridge offers (added by an agent with radar_keywords): merged into rs:radar once
  // per offer, after the user's own; the storage change pushes them back, and the bridge drops the offer.
  async function applyRadarProposal(p) {
    var F = self.OpenOutlierFeatures;
    if (!F || !F.updateSettings || !F.readSetting) return;
    var state = await getState();
    if (state.radarProposalAt === p.at) return;
    await F.updateSettings(async function () {
      var rd = Object.assign({}, (await F.readSetting('radar')) || {});
      var kw = Object.assign({}, rd.keywords && typeof rd.keywords === 'object' ? rd.keywords : {});
      Object.keys(p.keywords).forEach(function (n) {
        var cur = Array.isArray(kw[n]) ? kw[n].slice() : [];
        (Array.isArray(p.keywords[n]) ? p.keywords[n] : []).forEach(function (k) { k = String(k || '').trim().toLowerCase().slice(0, 80); if (k && cur.indexOf(k) === -1) cur.push(k); });
        kw[n] = cur.slice(0, 30);
      });
      rd.keywords = kw;
      return { radar: rd };
    });
    await setState({ radarProposalAt: p.at });
  }

  function saveSettingsAnswer(res) {
    return setState({
      bridgeApiKey: !!(res.apiKey && res.apiKey.configured),
      bridgeApiKeySource: res.apiKey && res.apiKey.source || null,
      oauthConnected: !!(res.oauth && res.oauth.connected),
      bridgeQuota: res.bridgeQuota || null,
      // Phase 5: which optional providers are on and have a key (never the key itself).
      providers: res.providers && typeof res.providers === 'object' ? Object.keys(res.providers).reduce(function (o, k) { var p = res.providers[k]; o[k] = { on: !!p.on, configured: !!p.configured, scraping: !!p.scraping }; return o; }, {}) : null,
      settingsAt: Date.now()
    });
  }

  var settingsTimer = null;
  function pushSettingsSoon() {
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(async function () {
      if (!(await enabled())) return;
      var state = await getState();
      if (!state.connected || !state.port) return;
      var h = await health(state.port);
      if (h) pushSettings({ port: state.port, health: h }, true).catch(function () {});
    }, 1500);
  }

  /** "Copy key to bridge" / "Remove from bridge". The key never leaves this worker except to the paired bridge. */
  async function bridgeKey(msg) {
    var found = await findServer(await getState());
    if (!found) return { ok: false, noBridge: true, error: NO_BRIDGE_SETTINGS };
    if ((found.health.features || []).indexOf('settings') === -1) return { ok: false, oldBridge: true, error: OLD_BRIDGE_SETTINGS };
    var body;
    if (msg.action === 'remove') body = { remove: true };
    else {
      var r = await chrome.storage.local.get(SETTINGS_KEY);
      var key = r[SETTINGS_KEY] && r[SETTINGS_KEY].youtubeApiKey;
      if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{30,60}$/.test(key.trim())) return { ok: false, error: 'No YouTube Data API key is saved in this browser. Add one in the popup first.' };
      body = { key: key.trim() };
    }
    var res = await post(found.port, '/settings/youtube-api-key', body);
    await saveSettingsAnswer(res);
    return { ok: true, configured: !!(res.apiKey && res.apiKey.configured), source: res.apiKey && res.apiKey.source || null };
  }

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (changes[QUOTA_KEY] || changes['rs:niche-settings'] || changes['rs:radar']) pushSettingsSoon();
    var users = Object.keys(changes).filter(function (k) { return k.indexOf(KEY_PREFIX) === 0; }).map(function (k) { return k.slice(KEY_PREFIX.length); });
    var org = !!changes[ORG_KEY];
    var watches = !!changes[WATCHES_KEY];
    var mentions = !!changes[MENTIONS_KEY];
    if (users.length || org || watches || mentions) syncSoon(users, org, watches, mentions);
    if (changes[SETTINGS_KEY]) tick();
  });

  // ---- the Library's Niş Takibi page ------------------------------------------------
  var NO_BRIDGE_NICHE = 'Niche tracking runs in the OpenOutlier bridge on your Mac (it keeps measuring while Chrome is closed), and the bridge isn\'t running. ' +
    'Start it once with: sh mcp/launchd/install.sh (in the OpenOutlier folder). See the README, "Niche tracking".';
  var OLD_BRIDGE_NICHE = 'The OpenOutlier bridge that is running is older than this extension and has no niche tracking. ' +
    'Restart it: launchctl kickstart -k gui/$(id -u)/dev.openoutlier.bridge (or restart Claude if it runs the bridge).';
  async function niche(msg) {
    var path = msg.path === '/youtube/niche/video' ? '/youtube/niche/video' : '/youtube/niche/page';
    var q = new URLSearchParams();
    if (path === '/youtube/niche/page') {
      if (typeof msg.niche === 'string') q.set('niche', msg.niche.slice(0, 80));
      if (Number.isFinite(msg.tz)) q.set('tz', String(Math.round(msg.tz)));
    } else {
      if (!/^[A-Za-z0-9_-]{11}$/.test(String(msg.id || ''))) return { ok: false, error: 'Not a YouTube video id.' };
      q.set('id', msg.id);
    }
    var found = await findServer(await getState());
    if (!found) return { ok: false, noBridge: true, error: NO_BRIDGE_NICHE };
    if ((found.health.features || []).indexOf('niche') === -1) return { ok: false, oldBridge: true, error: OLD_BRIDGE_NICHE };
    var res = await read(found.port, path + '?' + q, 60000);
    var j = await res.json().catch(function () { return {}; });
    if (!res.ok) return { ok: false, error: j.error || 'HTTP ' + res.status };
    return j;
  }

  // ---- commands ---------------------------------------------------------------
  async function pollCommands(port) {
    var res = await read(port, '/commands');
    if (!res.ok) {
      // Syncing still works, so the bridge looks connected while commands never arrive: say why.
      console.warn('[OpenOutlier] the bridge refused the command check (HTTP ' + res.status + '). Restart the OpenOutlier bridge so it matches this extension.');
      return;
    }
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

  // organize_library: folders, tags and tracking in rs:org, applied here in one write (src/org-ops.js).
  // No tab; the storage change syncs the record to the bridge, which starts tracking new niche members.
  async function orgEdit(port, command) {
    var O = self.OpenOutlierOrgOps;
    var result;
    try {
      if (!O) throw new Error('This extension version can\'t edit folders yet: reload it.');
      var r = await chrome.storage.local.get(ORG_KEY);
      var out = O.apply(r[ORG_KEY] || { folders: [], accounts: {} }, (command.args || {}).ops, Date.now());
      if (out.changes.length) { var patch = {}; patch[ORG_KEY] = out.org; await chrome.storage.local.set(patch); }
      result = { ok: true, changed: out.changes.length, changes: out.changes.slice(0, 300), errors: out.errors, folders: out.org.folders.map(function (f) { return f.name; }) };
    } catch (e) {
      result = { ok: false, error: e.message };
    }
    try { await post(port, '/commands/result', { id: command.id, result: result }); } catch (e) { /* server gone */ }
  }

  async function finish(id, result) {
    var map = await getRunning();
    var job = map[id];
    if (!job) return;
    if (job.results) result = combineSteps(job.results.concat([result]));
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

  var YT_TABS = ['videos', 'shorts', 'streams'];
  /** youtube.com page for a YouTube command: a channel tab (collect) or one video (refresh). */
  function youtubeUrl(type, a, tab) {
    if (type === 'refresh_youtube') {
      var v = encodeURIComponent(String(a.id || ''));
      return a.type === 'short' ? 'https://www.youtube.com/shorts/' + v : 'https://www.youtube.com/watch?v=' + v;
    }
    var s = String(a.id || '').replace(/^yt\//, '');
    var base = /^UC[A-Za-z0-9_-]{22}$/.test(s) ? 'https://www.youtube.com/channel/' + s : 'https://www.youtube.com/@' + encodeURIComponent(s);
    return base + '/' + (YT_TABS.indexOf(tab) !== -1 ? tab : 'videos');
  }
  function youtubeTabs(a) {
    var tabs = (Array.isArray(a.tabs) ? a.tabs : ['videos', 'shorts']).filter(function (t, i, all) { return YT_TABS.indexOf(t) !== -1 && all.indexOf(t) === i; });
    return tabs.length ? tabs : ['videos'];
  }

  /** collect_youtube ran one step per channel tab: one result for the MCP server. */
  function combineSteps(results) {
    var tabs = results.map(function (r) { return r || {}; });
    var last = tabs.filter(function (r) { return r.account; }).pop() || {};
    var ok = tabs.some(function (r) { return r.ok; });
    var notes = tabs.map(function (r) { return r.note; }).filter(Boolean);
    return {
      ok: ok,
      account: last.account,
      saved_total: last.saved_total,
      long_form: last.long_form,
      shorts: last.shorts,
      channel_videos: last.channel_videos,
      subscribers: last.subscribers,
      tabs: tabs.map(function (r) { return { tab: r.tab, ok: !!r.ok, collected_now: r.collected_now, end_reached: r.end_reached, error: r.error || undefined, skipped: r.skipped || undefined }; }),
      error: ok ? undefined : (tabs.map(function (r) { return r.error; }).filter(Boolean)[0] || 'Nothing was collected.'),
      note: notes.length ? notes.join(' ') : undefined
    };
  }

  /** A YouTube collect step finished: load the next channel tab in the same window, or finish. */
  async function stepDone(id, result) {
    var map = await getRunning();
    var job = map[id];
    if (!job || !job.steps || !job.steps.length || (result && result.fatal)) { finish(id, result); return; }
    var tab = job.steps.shift();
    job.results = (job.results || []).concat([result || {}]);
    var cmd = Object.assign({}, job.command, { args: Object.assign({}, job.command.args, { tab: tab, prevTab: job.command.args.tab }) });
    job.command = cmd;
    map[id] = job;
    await putRunning(map);
    try { await chrome.tabs.update(job.tabId, { url: youtubeUrl('collect_youtube', cmd.args, tab) }); } catch (e) { finish(id, { ok: false, tab: tab, error: 'The collection window was closed.' }); return; }
    var ok = await sendCommand(job.tabId, cmd);
    if (!ok) finish(id, { ok: false, tab: tab, error: 'Could not reach YouTube in the browser for the ' + tab + ' tab.' });
  }

  function tiktokUrl(type, a) {
    var name = encodeURIComponent(String(a.username || '').replace(/^\/?(tt\/|@)/i, '').toLowerCase());
    if (type === 'collect_tiktok') return 'https://www.tiktok.com/@' + name;
    return 'https://www.tiktok.com/@' + (name || 'i') + '/video/' + encodeURIComponent(String(a.id || ''));
  }

  async function startCommand(port, command) {
    var map = await getRunning();
    if (map[command.id]) return;
    if (command.type === 'org_edit') return orgEdit(port, command);
    var reddit = command.type === 'collect_reddit';
    var tiktok = /^(collect|refresh|download)_tiktok$/.test(command.type);
    var youtube = /^(collect|refresh)_youtube$/.test(command.type);
    var steps = null;
    if (command.type === 'collect_youtube') {
      // One step per channel tab: the first now, the rest after each finishes (stepDone).
      steps = youtubeTabs(command.args || {});
      command = Object.assign({}, command, { args: Object.assign({}, command.args, { tab: steps.shift() }) });
    }
    var pageUrl = reddit ? redditUrl(command.args || {}) : tiktok ? tiktokUrl(command.type, command.args || {}) :
      youtube ? youtubeUrl(command.type, command.args || {}, (command.args || {}).tab) : null;
    var tab = pageUrl ? null : await instagramTab();
    var opened = false;
    if (command.type === 'refresh_youtube') {
      // One watch page: its inline data is all that's needed, so a muted background tab is enough.
      try {
        tab = await chrome.tabs.create({ url: pageUrl, active: false });
        chrome.tabs.update(tab.id, { muted: true }).catch(function () {});
        opened = true;
      } catch (e) { tab = null; }
    }
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
    if (steps) { map[command.id].steps = steps; map[command.id].command = command; map[command.id].results = []; }
    await putRunning(map);
    var ok = await sendCommand(tab.id, command);
    var site = reddit ? 'Reddit' : tiktok ? 'TikTok' : youtube ? 'YouTube' : 'Instagram';
    var host = reddit ? 'www.reddit.com' : tiktok ? 'www.tiktok.com' : youtube ? 'www.youtube.com' : 'instagram.com';
    if (!ok) finish(command.id, { ok: false, error: 'Could not reach ' + site + ' in the browser. Is ' + host + ' loading and are you logged in?' });
  }

  chrome.runtime.onMessage.addListener(function (msg, sender) {
    if (!msg || sender.id !== chrome.runtime.id) return;
    if (msg.type === 'reelscope:command-done' && msg.id) stepDone(msg.id, msg.result || {});
    if (msg.type === 'reelscope:bridge-check') tick();
  });

  // ---- YouTube video files: yt-dlp on the Mac, started through the bridge ------------
  // Works whether or not "Connect to AI agents" is on: it only sends the video id
  // (plus its channel and format, for the folder name) when you press download.
  var NO_BRIDGE = 'YouTube videos are saved by yt-dlp on your Mac through the OpenOutlier bridge, and the bridge isn\'t running. ' +
    'Start it once with: sh mcp/launchd/install.sh (in the OpenOutlier folder; it then stays on), or add the OpenOutlier MCP server to Claude. ' +
    'See the README, "Connect AI agents". Covers download without it.';
  var OLD_BRIDGE = 'The OpenOutlier bridge that is running is older than this extension and can\'t download YouTube videos. ' +
    'Restart it: launchctl kickstart -k gui/$(id -u)/dev.openoutlier.bridge (or restart Claude if it runs the bridge).';
  var JOB_RE = /^[0-9a-f-]{36}$/;

  async function ytVideoStart(msg) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(String(msg.id || ''))) return { ok: false, error: 'Not a YouTube video id.' };
    var found = await findServer(await getState());
    if (!found) return { ok: false, noBridge: true, error: NO_BRIDGE };
    if ((found.health.features || []).indexOf('youtube-download') === -1) return { ok: false, oldBridge: true, error: OLD_BRIDGE };
    var facts = msg.post && typeof msg.post === 'object' ? { owner: msg.post.owner, type: msg.post.type } : undefined;
    var r = await post(found.port, '/youtube/download', { id: msg.id, what: msg.what || 'video', post: facts });
    return { ok: true, port: found.port, job: r.job, state: r.state, label: r.label };
  }

  async function ytVideoStatus(msg) {
    if (PORTS.indexOf(msg.port) === -1 || !JOB_RE.test(String(msg.job || ''))) return { ok: false, error: 'Bad request.' };
    var res = await read(msg.port, '/youtube/download/' + msg.job, 5000);
    var j = await res.json().catch(function () { return {}; });
    if (!res.ok) return { ok: false, error: j.error || 'HTTP ' + res.status };
    return j;
  }

  // ---- My YouTube channel: YouTube Analytics through the bridge (the OAuth sign-in and
  // tokens live on the Mac, mcp/youtube-analytics.mjs). Only these paths are passed on.
  var YT_ANALYTICS = { 'GET /youtube/analytics/status': 1, 'POST /youtube/analytics/connect': 1, 'POST /youtube/analytics/disconnect': 1,
    'GET /youtube/analytics/channel': 1, 'GET /youtube/analytics/videos': 1, 'GET /youtube/analytics/retention': 1 };
  var NO_BRIDGE_ANALYTICS = 'My YouTube channel runs through the OpenOutlier bridge on your Mac (it keeps the Google sign-in), and the bridge isn\'t running. ' +
    'Start it once with: sh mcp/launchd/install.sh (in the OpenOutlier folder), or add the OpenOutlier MCP server to Claude. See the README, "My YouTube channel".';
  var OLD_BRIDGE_ANALYTICS = 'The OpenOutlier bridge that is running is older than this extension and has no YouTube Analytics. ' +
    'Restart it: launchctl kickstart -k gui/$(id -u)/dev.openoutlier.bridge (or restart Claude if it runs the bridge).';

  var NO_BRIDGE_SETTINGS = 'The OpenOutlier bridge on your Mac isn\'t running, so there is nowhere to copy the key to. ' +
    'Start it once with: sh mcp/launchd/install.sh (in the OpenOutlier folder; it then stays on). See the README, "Connect AI agents".';
  var OLD_BRIDGE_SETTINGS = 'The OpenOutlier bridge that is running is older than this extension and can\'t take feature settings or an API key. ' +
    'Restart it: launchctl kickstart -k gui/$(id -u)/dev.openoutlier.bridge (or restart Claude if it runs the bridge).';

  async function ytAnalytics(msg) {
    var method = msg.method === 'POST' ? 'POST' : 'GET';
    var path = String(msg.path || '');
    if (!YT_ANALYTICS[method + ' ' + path]) return { ok: false, error: 'Bad request.' };
    var q = new URLSearchParams();
    if (msg.days) q.set('days', String(Math.min(3650, Math.max(1, Number(msg.days) || 28))));
    if (msg.limit) q.set('limit', String(Math.min(200, Math.max(1, Number(msg.limit) || 50))));
    if (msg.id) { if (!/^[A-Za-z0-9_-]{11}$/.test(String(msg.id))) return { ok: false, error: 'Not a YouTube video id.' }; q.set('id', msg.id); }
    // Which connected channel (phase 2: one token per channel); none = the first connected.
    if (msg.channel) { if (!/^UC[A-Za-z0-9_-]{22}$/.test(String(msg.channel))) return { ok: false, error: 'Not a YouTube channel id.' }; q.set('channel', msg.channel); }
    var found = await findServer(await getState());
    if (!found) return { ok: false, noBridge: true, error: NO_BRIDGE_ANALYTICS };
    if ((found.health.features || []).indexOf('youtube-analytics') === -1) return { ok: false, oldBridge: true, error: OLD_BRIDGE_ANALYTICS };
    var full = path + (String(q) ? '?' + q : '');
    var res = method === 'POST'
      ? await fetch('http://127.0.0.1:' + found.port + full, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(60000) })
      : await read(found.port, full, 60000);
    var j = await res.json().catch(function () { return {}; });
    if (!res.ok) return { ok: false, error: j.error || 'HTTP ' + res.status };
    return j;
  }

  // ---- the Library's Kanalım page: the stored history of the connected channels (mcp/own-history.mjs).
  var OLD_BRIDGE_OWN = 'The OpenOutlier bridge that is running is older than this extension and keeps no channel history yet. ' +
    'Restart it: launchctl kickstart -k gui/$(id -u)/dev.openoutlier.bridge (or restart Claude if it runs the bridge).';
  async function own(msg) {
    var found = await findServer(await getState());
    if (!found) return { ok: false, noBridge: true, error: NO_BRIDGE_ANALYTICS };
    if ((found.health.features || []).indexOf('own-history') === -1) return { ok: false, oldBridge: true, error: OLD_BRIDGE_OWN };
    var ch = /^UC[A-Za-z0-9_-]{22}$/.test(String(msg.channel || '')) || msg.channel === 'all' ? msg.channel : null;
    if (msg.path === '/youtube/own/refresh') return post(found.port, '/youtube/own/refresh', { channel: ch });
    var res = await read(found.port, '/youtube/own/page' + (ch ? '?channel=' + encodeURIComponent(ch) : ''), 60000);
    var j = await res.json().catch(function () { return {}; });
    if (!res.ok) return { ok: false, error: j.error || 'HTTP ' + res.status };
    return j;
  }

  /**
   * Phase 3's badges and cards (mcp/cards.mjs): msg.what = 'cards' ({ videos, channels }),
   * 'channel' ({ channel: UC… }) or 'video' ({ id }). Quietly empty without a (new enough) bridge.
   */
  async function cards(msg) {
    var st = await getState();
    if (!st.connected) return { ok: false, noBridge: true };
    var found = await findServer(st);
    if (!found) return { ok: false, noBridge: true };
    if ((found.health.features || []).indexOf('cards') === -1) return { ok: false, oldBridge: true };
    if (msg.what === 'cards') {
      var body = {
        videos: (Array.isArray(msg.videos) ? msg.videos : []).filter(function (x) { return /^[A-Za-z0-9_-]{11}$/.test(String(x)); }).slice(0, 300),
        channels: (Array.isArray(msg.channels) ? msg.channels : []).filter(function (x) { return /^UC[A-Za-z0-9_-]{22}$/.test(String(x)); }).slice(0, 100)
      };
      return post(found.port, '/youtube/cards', body);
    }
    var path = msg.what === 'channel' && /^UC[A-Za-z0-9_-]{22}$/.test(String(msg.channel || '')) ? '/youtube/channel-card?channel=' + msg.channel
      : msg.what === 'video' && /^[A-Za-z0-9_-]{11}$/.test(String(msg.id || '')) ? '/youtube/video-card?id=' + msg.id : null;
    if (!path) return { ok: false, error: 'bad request' };
    var res = await read(found.port, path, 20000);
    var j = await res.json().catch(function () { return {}; });
    if (!res.ok) return { ok: false, error: j.error || 'HTTP ' + res.status };
    return j;
  }

  /**
   * Phase 4's content tools (mcp/content.mjs): msg.what = 'comments' (the comments a watch page loaded,
   * for get_comments; the bridge keeps them 7 days) or 'sponsors' ({ channel: UC… }, the channel card).
   * Quietly empty without a (new enough) bridge.
   */
  async function content(msg) {
    var st = await getState();
    if (!st.connected) return { ok: false, noBridge: true };
    var found = await findServer(st);
    if (!found) return { ok: false, noBridge: true };
    if ((found.health.features || []).indexOf('content-tools') === -1) return { ok: false, oldBridge: true };
    if (msg.what === 'comments') {
      if (!/^[A-Za-z0-9_-]{11}$/.test(String(msg.video || ''))) return { ok: false, error: 'bad request' };
      var list = (Array.isArray(msg.comments) ? msg.comments : []).slice(-2000).map(function (c) {
        return { id: c.id, author: c.author, authorId: c.authorId, text: String(c.text || '').slice(0, 5000), likes: c.likes, replies: c.replies, published: c.published, reply: !!c.reply, parent: c.parent, pinned: !!c.pinned, hearted: !!c.hearted, creator: !!c.creator };
      });
      return post(found.port, '/youtube/comments', { video: msg.video, title: msg.title ? String(msg.title).slice(0, 300) : null, channel_id: /^UC[A-Za-z0-9_-]{22}$/.test(String(msg.channel_id || '')) ? msg.channel_id : null, total: msg.total, comments: list });
    }
    if (msg.what === 'sponsors' && /^UC[A-Za-z0-9_-]{22}$/.test(String(msg.channel || ''))) {
      var res = await read(found.port, '/youtube/sponsors?channel=' + msg.channel, 20000);
      var j = await res.json().catch(function () { return {}; });
      if (!res.ok) return { ok: false, error: j.error || 'HTTP ' + res.status };
      return j;
    }
    return { ok: false, error: 'bad request' };
  }


  // ---- phase 5: discovery (mcp/discovery.mjs) and the optional providers (mcp/providers/) -------
  // msg.what: radar | radar-run | map | keywords | similar | thumbs | corec | providers | provider-key |
  // sb-quote | sb-backfill | dfs-check. Reads are quiet without a (new enough) bridge for the in-page
  // parts (similar, corec); the Library pages get the reason.
  var OLD_BRIDGE_DISCOVERY = 'The OpenOutlier bridge that is running is older than this extension and has no discovery tools. ' +
    'Restart it: launchctl kickstart -k gui/$(id -u)/dev.openoutlier.bridge (or restart Claude if it runs the bridge).';
  var UC_RE = /^UC[A-Za-z0-9_-]{22}$/;
  async function discovery(msg) {
    var found = await findServer(await getState());
    if (!found) return { ok: false, noBridge: true, error: NO_BRIDGE_NICHE };
    var feats = found.health.features || [];
    var prov = /^(providers|provider-key|sb-|dfs-)/.test(String(msg.what || ''));
    if (feats.indexOf(prov ? 'providers' : 'discovery') === -1) return { ok: false, oldBridge: true, error: OLD_BRIDGE_DISCOVERY };
    var q = new URLSearchParams();
    if (typeof msg.niche === 'string') q.set('niche', msg.niche.slice(0, 80));
    var get = async function (path) {
      var res = await read(found.port, path + (String(q) ? '?' + q : ''), 60000);
      var j = await res.json().catch(function () { return {}; });
      if (!res.ok && j.ok === undefined) return { ok: false, error: j.error || 'HTTP ' + res.status };
      return j;
    };
    switch (msg.what) {
      case 'radar': return get('/youtube/discovery/radar');
      case 'radar-run': return post(found.port, '/youtube/discovery/radar/run', {});
      case 'map': return get('/youtube/discovery/map');
      case 'keywords':
        ['seed', 'expand'].forEach(function (k) { if (typeof msg[k] === 'string' && msg[k].trim()) q.set(k, msg[k].trim().slice(0, 100)); });
        if (/^[a-z]{2}$/.test(String(msg.hl || ''))) q.set('hl', msg.hl);
        if (/^[A-Z]{2}$/.test(String(msg.gl || ''))) q.set('gl', msg.gl);
        if (msg.lang === 'tr') q.set('lang', 'tr');
        return get('/youtube/discovery/keywords');
      case 'similar':
        if (!UC_RE.test(String(msg.channel || ''))) return { ok: false, error: 'bad request' };
        q.set('channel', msg.channel);
        return get('/youtube/discovery/similar');
      case 'thumbs':
        if (!/^[A-Za-z0-9_-]{11}$/.test(String(msg.id || ''))) return { ok: false, error: 'Not a YouTube video id.' };
        q.set('id', msg.id);
        return get('/youtube/discovery/thumbs');
      case 'corec':
        if (!UC_RE.test(String(msg.source || '')) || !Array.isArray(msg.recs)) return { ok: false, error: 'bad request' };
        return post(found.port, '/youtube/discovery/corec', { source: msg.source, recs: msg.recs.slice(0, 40).map(function (r) {
          return { id: UC_RE.test(String(r && r.id || '')) ? r.id : null, name: r && r.name ? String(r.name).slice(0, 120) : null, handle: r && r.handle ? String(r.handle).slice(0, 60) : null };
        }).filter(function (r) { return r.id; }) });
      case 'providers': return get('/providers');
      case 'provider-key': {
        var res = await fetch('http://127.0.0.1:' + found.port + '/providers/key', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(msg.remove ? { id: msg.id, remove: true } : { id: msg.id, key: msg.key }) });
        var j = await res.json().catch(function () { return {}; });
        pushSettingsSoon();
        return j;
      }
      case 'sb-quote': return post(found.port, '/providers/socialblade/quote', { channels: msg.channels, history: msg.history, maxSubs: msg.maxSubs });
      case 'sb-backfill': return post(found.port, '/providers/socialblade/backfill', { channels: msg.channels, history: msg.history, maxSubs: msg.maxSubs, confirm: msg.confirm });
      case 'dfs-check': return post(found.port, '/providers/dataforseo/check', {});
    }
    return { ok: false, error: 'bad request' };
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || sender.id !== chrome.runtime.id) return;
    var fn = msg.type === 'reelscope:yt-content' ? content : msg.type === 'reelscope:yt-cards' ? cards : msg.type === 'reelscope:yt-video' ? ytVideoStart : msg.type === 'reelscope:yt-video-status' ? ytVideoStatus : msg.type === 'reelscope:yt-analytics' ? ytAnalytics
      : msg.type === 'reelscope:bridge-key' ? bridgeKey : msg.type === 'reelscope:niche' ? niche : msg.type === 'reelscope:own' ? own : msg.type === 'reelscope:discovery' ? discovery : null;
    if (!fn) return;
    fn(msg).then(sendResponse, function (e) {
      sendResponse({ ok: false, error: /Failed to fetch|NetworkError/i.test(String(e && e.message)) ? NO_BRIDGE : String(e && e.message || e) });
    });
    return true;
  });

  // ---- schedule -----------------------------------------------------------------
  chrome.alarms.get(ALARM).then(function (a) { if (!a) chrome.alarms.create(ALARM, { periodInMinutes: 0.5 }); },
    function () { chrome.alarms.create(ALARM, { periodInMinutes: 0.5 }); });
  chrome.alarms.onAlarm.addListener(function (a) { if (a.name === ALARM) tick(); });
  chrome.runtime.onStartup.addListener(tick);
  chrome.runtime.onInstalled.addListener(tick);
  tick();
})();
