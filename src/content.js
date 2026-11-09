// OpenOutlier – content script (isolated world). Receives Instagram responses
// from hook.js, keeps per-profile records in chrome.storage.local, fills in
// missing details, and drives the panel, the on-video toolbar and auto-scroll.
(async function () {
  'use strict';
  if (window.top !== window || window.__reelscopeContent) return;
  window.__reelscopeContent = true;

  var X = self.ReelScopeExtract;
  var P = self.ReelScopePanel;
  var O = self.ReelScopeOverlay;
  var KEY_PREFIX = 'rs:p:';
  var SETTINGS_KEY = 'rs:settings';
  var RESERVED = /^(reel|reels|p|tv|explore|stories|direct|accounts|about|legal|privacy|developer|emails|challenge|web|graphql|api|ar|lite|session|oauth|create|your_activity|nametag|directory|topics|locations|tags)$/i;
  var POST_RE = /\/(?:reels?|p|tv)\/([A-Za-z0-9_-]{5,})/;

  /** username -> { code -> post } */
  var profiles = {};
  var dirty = {};
  var selected = null; // profile the user picked in the panel (null = follow the page)
  var settings = { fetchDetails: true };
  var auto = { running: false, timer: null, stale: 0, last: 0, label: '' };

  // ---- storage --------------------------------------------------------------
  try {
    var saved = await chrome.storage.local.get(null);
    Object.keys(saved).forEach(function (k) {
      // Reddit accounts ("r/…", "u/…") share the key prefix; Instagram names never contain "/".
      if (k.indexOf(KEY_PREFIX) === 0 && k.indexOf('/') === -1 && saved[k] && saved[k].posts) profiles[k.slice(KEY_PREFIX.length)] = saved[k].posts;
    });
    if (saved[SETTINGS_KEY]) Object.assign(settings, saved[SETTINGS_KEY]);
  } catch (e) { /* storage unavailable: run in memory */ }

  // Saving: another tab (opened earlier, so with an older copy) may have saved
  // the same profile meanwhile. Re-read the stored records and merge post by
  // post, so a tab that saw one reel never overwrites 1,000 collected elsewhere.
  var saveTimer = null;
  var saving = Promise.resolve();
  async function writeDirty() {
    var users = Object.keys(dirty).filter(function (u) { return profiles[u]; });
    dirty = {};
    if (!users.length) return;
    var stored = await chrome.storage.local.get(users.map(function (u) { return KEY_PREFIX + u; }));
    var batch = {};
    users.forEach(function (u) {
      var rec = stored[KEY_PREFIX + u];
      if (rec && rec.posts) profiles[u] = X.mergePostMaps(rec.posts, profiles[u]);
      batch[KEY_PREFIX + u] = { posts: profiles[u], updatedAt: Date.now() };
    });
    await chrome.storage.local.set(batch);
  }
  function saveNow() {
    saving = saving.then(writeDirty).catch(function (e) { console.warn('[OpenOutlier] save failed', e); });
    return saving;
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 1500);
  }

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    var changed = false;
    Object.keys(changes).forEach(function (k) {
      if (k === SETTINGS_KEY && changes[k].newValue) {
        Object.assign(settings, changes[k].newValue);
        if (settings.fetchDetails) kickDetails();
        changed = true;
      }
      if (k.indexOf(KEY_PREFIX) !== 0 || k.indexOf('/') !== -1) return;
      var u = k.slice(KEY_PREFIX.length);
      var nv = changes[k].newValue;
      if (!nv) { delete profiles[u]; changed = true; return; } // cleared from the popup
      // Saved by another tab (or by us): take in what it knows.
      if (nv.posts) { profiles[u] = profiles[u] ? X.mergePostMaps(profiles[u], nv.posts) : nv.posts; changed = true; }
    });
    if (changed) scheduleRender();
  });

  // ---- page context ---------------------------------------------------------
  function pageProfile() {
    var seg = location.pathname.split('/').filter(Boolean)[0];
    return seg && !RESERVED.test(seg) && /^[A-Za-z0-9._]{1,30}$/.test(seg) ? seg.toLowerCase() : null;
  }

  function pagePostCode() {
    var m = location.pathname.match(POST_RE);
    return m ? m[1] : null;
  }

  var MIN_POSTS = 5; // smaller "profiles" are usually single reels caught while scrolling the feed

  function profileList() {
    var keep = [pageProfile(), selected];
    var code = pagePostCode();
    var viewing = code && findPost(code);
    if (viewing) keep.push(viewing.owner);
    return Object.keys(profiles)
      .map(function (u) { return { username: u, count: Object.keys(profiles[u]).length }; })
      .filter(function (p) { return p.count >= MIN_POSTS || (p.count > 0 && keep.indexOf(p.username) !== -1); })
      .sort(function (a, b) { return b.count - a.count; });
  }

  function currentProfile() {
    if (selected && profiles[selected]) return selected;
    var page = pageProfile();
    if (page && profiles[page] && Object.keys(profiles[page]).length) return page;
    var code = pagePostCode();
    var viewing = code && findPost(code);
    if (viewing && viewing.owner && profiles[viewing.owner]) return viewing.owner;
    var list = profileList();
    return list.length ? list[0].username : null;
  }

  function findPost(code) {
    for (var u in profiles) if (profiles[u][code]) return profiles[u][code];
    return null;
  }

  // ---- ingest ---------------------------------------------------------------
  function ingest(posts, opts) {
    if (!posts || !posts.length) return 0;
    var fallbackOwner = pageProfile();
    var added = 0;
    posts.forEach(function (p) {
      var owner = p.owner || fallbackOwner;
      if (!owner) return;
      p.owner = owner;
      if (opts && opts.detailed) p.detailed = true;
      var bucket = profiles[owner] || (profiles[owner] = {});
      if (!bucket[p.code]) added++;
      bucket[p.code] = X.merge(bucket[p.code], p);
      dirty[owner] = true;
    });
    scheduleSave();
    scheduleRender();
    kickDetails();
    return added;
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window || !e.data || e.data.__reelscope !== 1 || e.data.type !== 'payload') return;
    try { ingest(X.parseText(e.data.text)); } catch (err) { console.warn('[OpenOutlier] parse failed', err); }
  });

  // Data Instagram embeds in the initial HTML (first page of a profile).
  function scanEmbedded() {
    var scripts = document.querySelectorAll('script[type="application/json"]');
    for (var i = 0; i < scripts.length; i++) {
      var t = scripts[i].textContent;
      if (t && t.length < 8e6 && (t.indexOf('"code"') !== -1 || t.indexOf('"shortcode"') !== -1)) {
        try { ingest(X.parseText(t)); } catch (e) { /* ignore */ }
      }
    }
  }

  // ---- details: fill in what the profile grid leaves out ----------------------
  // Instagram's profile grids send slim records (the Reels tab often has no
  // date/caption/length, the posts grid often has no views). We ask Instagram
  // for one post at a time — the same request its own post page makes — with a
  // pause between requests, and back off as soon as Instagram pushes back.
  var details = { running: false, done: 0, label: '', attempts: {}, cooldown: 0 };
  var COOLDOWNS = [30000, 60000, 120000];

  function isVideo(p) { return p.type === 'reel' || p.type === 'video'; }

  function needsDetails(p) {
    if (p.detailed || (details.attempts[p.code] || 0) >= 2) return false;
    var files = p.files || [];
    return p.takenAt == null ||
      (isVideo(p) && (p.views == null || !p.duration || !files.some(function (f) { return f.kind === 'video'; }))) ||
      !files.length;
  }

  function detailsQueue() {
    var out = [];
    var code = pagePostCode();
    if (code && !details.attempts[code]) {
      var viewing = findPost(code);
      if (!viewing || needsDetails(viewing)) out.push(viewing || { code: code });
    }
    var page = pageProfile();
    var u = page && profiles[page] ? page : currentProfile();
    if (u && profiles[u]) {
      Object.keys(profiles[u]).forEach(function (c) {
        var p = profiles[u][c];
        if (c !== code && needsDetails(p)) out.push(p);
      });
    }
    return out;
  }

  function cookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  /** GET an Instagram web API path from this logged-in page. → { kind: ok|rate|auth|error, text } */
  async function igGet(path) {
    var headers = { 'X-IG-App-ID': '936619743392459', 'X-Requested-With': 'XMLHttpRequest', 'X-ASBD-ID': '129477' };
    var csrf = cookie('csrftoken');
    if (csrf) headers['X-CSRFToken'] = csrf;
    try {
      var claim = sessionStorage.getItem('www-claim-v2');
      if (claim) headers['X-IG-WWW-Claim'] = claim;
    } catch (e) { /* ignore */ }

    var res;
    var text = '';
    try {
      res = await fetch(path, { credentials: 'include', headers: headers });
      text = await res.text();
    } catch (e) {
      return { kind: 'error' };
    }
    if (res.status === 429 || /wait a few minutes|rate.?limit|too many requests/i.test(text)) return { kind: 'rate' };
    if (res.status === 401 || res.status === 403 || /login_required|checkpoint_required/i.test(text)) return { kind: 'auth' };
    if (!res.ok) return { kind: 'error', status: res.status };
    if (/^\s*</.test(text)) return { kind: 'rate' }; // HTML app shell instead of JSON = soft throttle
    return { kind: 'ok', text: text };
  }

  async function fetchDetails(p) {
    var pk = p.pk || X.shortcodeToPk(p.code);
    if (!pk) return { kind: 'error' };
    var r = await igGet('/api/v1/media/' + pk + '/info/');
    if (r.kind !== 'ok') return r;
    return { kind: 'ok', posts: X.parseText(r.text) };
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function kickDetails() {
    if (!settings.fetchDetails || details.running || Date.now() < details.cooldown) return;
    if (!detailsQueue().length) return;
    detailsLoop();
  }

  async function detailsLoop() {
    details.running = true;
    var backoff = 0;
    var batchDone = 0;
    while (settings.fetchDetails) {
      var queue = detailsQueue();
      if (!queue.length) break;
      var p = queue[0];
      details.attempts[p.code] = (details.attempts[p.code] || 0) + 1;
      details.label = 'Loading views & dates… ' + batchDone + ' / ' + (batchDone + queue.length);
      scheduleRender();

      var r = await fetchDetails(p);
      if (r.kind === 'ok') {
        backoff = 0;
        batchDone++;
        var found = r.posts.filter(function (x) { return x.code === p.code; });
        if (!found.length) found = r.posts.slice(0, 1).map(function (x) { return Object.assign(x, { code: p.code }); });
        ingest(found.length ? found : [], { detailed: true });
        var stored = findPost(p.code);
        if (stored) { stored.detailed = true; dirty[stored.owner] = true; }
        overlay.refresh();
      } else if (r.kind === 'rate') {
        details.attempts[p.code]--; // not this post's fault
        if (backoff >= COOLDOWNS.length) {
          details.cooldown = Date.now() + 10 * 60000;
          details.label = 'Instagram is limiting requests. Details will resume in 10 minutes.';
          break;
        }
        details.label = 'Instagram asked to slow down. Waiting ' + COOLDOWNS[backoff] / 1000 + 's…';
        scheduleRender();
        await sleep(COOLDOWNS[backoff++]);
        continue;
      } else if (r.kind === 'auth') {
        details.cooldown = Date.now() + 5 * 60000;
        details.label = 'Log in to Instagram to load views and dates.';
        break;
      }
      await sleep(1700 + Math.random() * 1300);
    }
    if (details.label.indexOf('Loading') === 0) details.label = '';
    details.running = false;
    scheduleSave();
    scheduleRender();
  }

  // ---- auto-scroll ----------------------------------------------------------
  function countFor(u) { return u && profiles[u] ? Object.keys(profiles[u]).length : 0; }

  function stopAuto(label) {
    auto.running = false;
    clearTimeout(auto.timer);
    auto.label = label || '';
    scheduleRender();
  }

  function tick() {
    if (!auto.running) return;
    var u = pageProfile() || currentProfile();
    var n = countFor(u);
    if (n > auto.last) { auto.last = n; auto.stale = 0; } else auto.stale++;
    auto.label = 'Scrolling… ' + n + ' collected';
    scheduleRender();
    if (auto.stale >= 10) { stopAuto('Done: ' + n + ' collected.'); return; }
    // Every few stale rounds, nudge up a little: Instagram sometimes only
    // triggers its next page load on a fresh scroll event.
    if (auto.stale > 0 && auto.stale % 3 === 0) window.scrollBy(0, -800);
    setTimeout(function () { window.scrollTo(0, document.documentElement.scrollHeight); }, auto.stale % 3 === 0 && auto.stale ? 250 : 0);
    auto.timer = setTimeout(tick, 1300 + Math.random() * 1200);
  }

  function toggleAuto() {
    if (auto.running) { stopAuto('Stopped.'); return; }
    if (!pageProfile()) { auto.label = 'Open a profile\'s Reels tab first.'; scheduleRender(); return; }
    auto.running = true;
    auto.stale = 0;
    auto.last = countFor(pageProfile());
    tick();
  }

  // ---- downloads -----------------------------------------------------------
  /** what: 'media' (video/photos) or 'cover' (cover image). */
  function downloadPosts(posts, what) {
    return chrome.runtime.sendMessage({
      type: 'reelscope:download',
      what: what,
      posts: posts.map(function (p) {
        return { code: p.code, owner: p.owner, views: p.views, likes: p.likes, comments: p.comments, files: p.files, cover: p.thumb };
      })
    });
  }

  function downloadFile(filename, text, mime) {
    var url = URL.createObjectURL(new Blob([text], { type: mime }));
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  async function flushSave() {
    clearTimeout(saveTimer);
    await saveNow();
  }

  // ---- agent commands (sent by background.js from the local MCP server) ------
  async function resolveUserId(username) {
    var known = profiles[username] && Object.values(profiles[username]).filter(function (p) { return p.ownerId; })[0];
    if (known) return known.ownerId;
    var r = await igGet('/api/v1/users/web_profile_info/?username=' + encodeURIComponent(username));
    if (r.kind !== 'ok') return { error: r.kind };
    try {
      var id = JSON.parse(r.text).data.user.id;
      return /^\d+$/.test(String(id)) ? String(id) : { error: 'not_found' };
    } catch (e) {
      return { error: 'not_found' };
    }
  }

  /** Page through a profile's posts (about 30 per request) — each item comes with views, date and video link. */
  async function collectProfile(username, maxPosts) {
    var userId = await resolveUserId(username);
    if (!userId || userId.error) {
      var why = userId && userId.error;
      return { ok: false, error: why === 'auth' ? 'Not logged in to Instagram in this browser.' : why === 'rate' ? 'Instagram is limiting requests; try again in a few minutes.' : 'Profile @' + username + ' not found (private or misspelled?).' };
    }
    var maxId = null;
    var got = 0;
    var backoff = 0;
    for (var page = 0; page < 120 && got < maxPosts; page++) {
      var r = await igGet('/api/v1/feed/user/' + userId + '/?count=33' + (maxId ? '&max_id=' + encodeURIComponent(maxId) : ''));
      if (r.kind === 'rate') {
        if (backoff >= COOLDOWNS.length) return { ok: got > 0, partial: true, posts: got, error: 'Instagram is limiting requests; stopped early.' };
        await sleep(COOLDOWNS[backoff++]);
        page--;
        continue;
      }
      if (r.kind !== 'ok') return { ok: got > 0, partial: true, posts: got, error: r.kind === 'auth' ? 'Not logged in to Instagram.' : 'Instagram returned an error.' };
      backoff = 0;
      var posts = X.parseText(r.text).filter(function (p) { return !p.owner || p.owner === username; });
      posts.forEach(function (p) { p.owner = username; });
      ingest(posts, { detailed: true });
      got += posts.length;
      var json = {};
      try { json = JSON.parse(r.text); } catch (e) { /* ignore */ }
      if (!json.more_available || !json.next_max_id) break;
      maxId = json.next_max_id;
      await sleep(2200 + Math.random() * 1500);
    }
    await flushSave();
    var all = profiles[username] ? Object.values(profiles[username]) : [];
    return { ok: true, username: username, collected_now: got, saved_total: all.length, reels: all.filter(isVideo).length };
  }

  async function refreshReel(code) {
    var r = await fetchDetails({ code: code });
    if (r.kind !== 'ok') return { ok: false, error: r.kind === 'auth' ? 'Not logged in to Instagram.' : r.kind === 'rate' ? 'Instagram is limiting requests; try again later.' : 'Could not load this reel (deleted or private?).' };
    var found = r.posts.filter(function (x) { return x.code === code; });
    if (!found.length) return { ok: false, error: 'Instagram did not return this reel.' };
    ingest(found, { detailed: true });
    await flushSave();
    return { ok: true, code: code, owner: found[0].owner };
  }

  async function runCommand(cmd) {
    var a = cmd.args || {};
    if (cmd.type === 'collect_profile') return collectProfile(String(a.username || '').toLowerCase(), Math.min(2000, a.maxReels || 300));
    if (cmd.type === 'refresh_reel') return refreshReel(String(a.code || ''));
    if (cmd.type === 'collect_reddit') return { ok: false, error: 'This is an Instagram tab; Reddit commands run in a reddit.com tab.' };
    return { ok: false, error: 'Unknown command ' + cmd.type };
  }

  // ---- UI -------------------------------------------------------------------
  var cssText = '';
  try { cssText = await (await fetch(chrome.runtime.getURL('src/panel.css'))).text(); } catch (e) { /* unstyled */ }
  try { if (self.OpenOutlierBrand) await self.OpenOutlierBrand.load(); } catch (e) { /* text fallbacks */ }

  var panel = P.create({
    cssText: cssText,
    onAutoScroll: toggleAuto,
    onSelectProfile: function (u) { selected = u || null; scheduleRender(); },
    onClearProfile: function (u) {
      delete profiles[u];
      delete dirty[u];
      if (selected === u) selected = null;
      chrome.storage.local.remove(KEY_PREFIX + u);
      scheduleRender();
    },
    onDownload: downloadFile,
    onCopy: function (text) { return navigator.clipboard.writeText(text); },
    onDownloadMedia: downloadPosts,
    onOpenDashboard: function () {
      var u = currentProfile();
      chrome.runtime.sendMessage({ type: 'reelscope:open-dashboard', hash: u ? '#/account/' + encodeURIComponent(u) : '' });
    }
  });

  var overlay = O.create({
    cssText: cssText,
    getPost: function (code) { return findPost(code); },
    getProfilePosts: function (owner) { return owner && profiles[owner] ? Object.values(profiles[owner]) : []; },
    isLoading: function (code) { return details.running && !!code && !(findPost(code) || {}).detailed && (details.attempts[code] || 0) > 0; },
    onDownloadMedia: downloadPosts,
    onOpenPanel: function () { panel.toggle(true); }
  });

  var renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    setTimeout(function () {
      renderQueued = false;
      var u = currentProfile();
      panel.update({
        profiles: profileList(),
        selected: u,
        posts: u ? Object.values(profiles[u]) : [],
        auto: { running: auto.running, label: details.label || auto.label }
      });
      overlay.refresh();
    }, 250);
  }

  function mount() {
    var parent = document.body || document.documentElement;
    if (!panel.host.isConnected) parent.appendChild(panel.host);
    if (!overlay.host.isConnected) parent.appendChild(overlay.host);
  }

  mount();
  scanEmbedded();
  scheduleRender();
  overlay.setCode(pagePostCode());
  kickDetails();

  // Instagram is a single-page app: watch for navigation.
  var lastPath = location.pathname;
  setInterval(function () {
    mount();
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    selected = null;
    if (auto.running) stopAuto('Stopped: page changed.');
    overlay.setCode(pagePostCode());
    setTimeout(scanEmbedded, 1500);
    scheduleRender();
    kickDetails();
  }, 500);

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg && msg.type === 'reelscope:toggle') {
      panel.toggle(true);
      sendResponse({ ok: true, profile: currentProfile() });
    }
    if (msg && msg.type === 'reelscope:command' && msg.command) {
      // Answer right away; the result goes back as its own message when done.
      sendResponse({ accepted: true });
      runCommand(msg.command).then(function (result) {
        chrome.runtime.sendMessage({ type: 'reelscope:command-done', id: msg.command.id, result: result });
      }, function (e) {
        chrome.runtime.sendMessage({ type: 'reelscope:command-done', id: msg.command.id, result: { ok: false, error: String(e && e.message || e) } });
      });
    }
  });
})();
