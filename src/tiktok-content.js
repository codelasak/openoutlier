// ReelScope – content script for www.tiktok.com (isolated world).
//
// Read-only, from the user's own tab. Two ways in:
//  1. TikTok's own API responses (/api/post/item_list, /api/item/detail,
//     /api/recommend/item_list, /api/search/…), forwarded by hook.js.
//  2. The SSR JSON TikTok embeds in the page
//     (<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">, older: SIGI_STATE).
// ReelScope makes no TikTok API requests: they are signed (X-Bogus, msToken)
// and replayed requests break. Auto-scroll makes TikTok load more by itself.
//
// Storage: rs:p:tt/<username> = { posts: {id: post}, updatedAt, platform: 'tiktok', profile }.
(async function () {
  'use strict';
  if (window.top !== window || window.__reelscopeTikTok) return;
  window.__reelscopeTikTok = true;

  var T = self.ReelScopeTikTok;
  var P = self.ReelScopePanel;
  var O = self.ReelScopeOverlay;
  var KEY_PREFIX = 'rs:p:';
  var MIN_POSTS = 5;

  /** account id ("tt/name") -> { id -> post } */
  var accounts = {};
  var profiles = {}; // account id -> profile facts from the SSR blob (followers, videos …)
  var dirty = {};
  var selected = null;
  var auto = { running: false, timer: null, stale: 0, last: 0, label: '', done: null };

  function isTikTokKey(k) { return k.indexOf(KEY_PREFIX) === 0 && T.isTikTokId(k.slice(KEY_PREFIX.length)); }

  // ---- storage --------------------------------------------------------------
  try {
    var saved = await chrome.storage.local.get(null);
    Object.keys(saved).forEach(function (k) {
      if (!isTikTokKey(k) || !saved[k] || !saved[k].posts) return;
      var id = k.slice(KEY_PREFIX.length);
      accounts[id] = saved[k].posts;
      if (saved[k].profile) profiles[id] = saved[k].profile;
    });
  } catch (e) { /* storage unavailable: run in memory */ }

  function record(id) {
    var r = { posts: accounts[id], updatedAt: Date.now(), platform: 'tiktok' };
    if (profiles[id]) r.profile = profiles[id];
    return r;
  }

  // Saving re-reads the stored records and merges post by post, so a tab with an
  // older copy never overwrites what another tab collected.
  var saveTimer = null;
  var saving = Promise.resolve();
  async function writeDirty() {
    var ids = Object.keys(dirty).filter(function (id) { return accounts[id]; });
    dirty = {};
    if (!ids.length) return;
    var stored = await chrome.storage.local.get(ids.map(function (id) { return KEY_PREFIX + id; }));
    var batch = {};
    ids.forEach(function (id) {
      var rec = stored[KEY_PREFIX + id];
      if (rec && rec.posts) accounts[id] = T.mergePostMaps(rec.posts, accounts[id]);
      if (rec && rec.profile && !profiles[id]) profiles[id] = rec.profile;
      batch[KEY_PREFIX + id] = record(id);
    });
    await chrome.storage.local.set(batch);
  }
  function saveNow() {
    saving = saving.then(writeDirty).catch(function (e) { console.warn('[ReelScope] save failed', e); });
    return saving;
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 1500);
  }
  async function flushSave() {
    clearTimeout(saveTimer);
    await saveNow();
  }

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    var changed = false;
    Object.keys(changes).forEach(function (k) {
      if (!isTikTokKey(k)) return;
      var id = k.slice(KEY_PREFIX.length);
      var nv = changes[k].newValue;
      if (!nv) { delete accounts[id]; changed = true; return; }
      if (nv.posts) { accounts[id] = accounts[id] ? T.mergePostMaps(accounts[id], nv.posts) : nv.posts; changed = true; }
    });
    if (changed) scheduleRender();
  });

  // ---- page context ---------------------------------------------------------
  function ctx() { return T.pageContext(location.pathname); }

  function findPost(id) {
    for (var a in accounts) if (accounts[a][id]) return accounts[a][id];
    return null;
  }

  function accountList() {
    var c = ctx();
    var keep = [c.id, selected];
    var viewing = c.video && findPost(c.video);
    if (viewing) keep.push(viewing.owner);
    return Object.keys(accounts)
      .map(function (id) { return { username: id, count: Object.keys(accounts[id]).length }; })
      .filter(function (a) { return a.count >= MIN_POSTS || (a.count > 0 && keep.indexOf(a.username) !== -1); })
      .sort(function (a, b) { return b.count - a.count; });
  }

  function currentAccount() {
    if (selected && accounts[selected]) return selected;
    var c = ctx();
    if (c.id && accounts[c.id] && Object.keys(accounts[c.id]).length) return c.id;
    var viewing = c.video && findPost(c.video);
    if (viewing && accounts[viewing.owner]) return viewing.owner;
    var list = accountList();
    return list.length ? list[0].username : null;
  }

  function countFor(id) { return id && accounts[id] ? Object.keys(accounts[id]).length : 0; }

  // ---- ingest ---------------------------------------------------------------
  function sig(p) { var o = Object.assign({}, p); delete o.seenAt; return JSON.stringify(o); }

  function ingest(posts) {
    var added = 0;
    (posts || []).forEach(function (p) {
      var id = p.owner;
      if (!T.isTikTokId(id)) return;
      var bucket = accounts[id] || (accounts[id] = {});
      if (!bucket[p.code]) added++;
      var before = bucket[p.code] ? sig(bucket[p.code]) : null;
      bucket[p.code] = T.merge(bucket[p.code], p);
      if (before !== sig(bucket[p.code])) dirty[id] = true;
    });
    if (Object.keys(dirty).length) { scheduleSave(); scheduleRender(); }
    return added;
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window || !e.data || e.data.__reelscope !== 1 || e.data.type !== 'payload') return;
    try { ingest(T.parseText(e.data.text)); } catch (err) { console.warn('[ReelScope] TikTok parse failed', err); }
  });

  /** The SSR blob(s) in the page: items (video page, sometimes the first profile page) and profile facts. */
  function scanSsr() {
    var seen = [];
    T.SSR_IDS.forEach(function (id) { var el = document.getElementById(id); if (el) seen.push(el); });
    // Defensive: TikTok has renamed this blob before. Any JSON script with video items will do.
    document.querySelectorAll('script[type="application/json"]').forEach(function (el) { if (seen.indexOf(el) === -1) seen.push(el); });
    var found = 0;
    seen.forEach(function (el) {
      var t = el.textContent;
      if (!t || t.length > 8e6 || t.indexOf('"createTime"') === -1 && t.indexOf('"uniqueId"') === -1) return;
      var json;
      try { json = JSON.parse(t); } catch (e) { return; }
      var user = T.parseUser(json);
      if (user) {
        var uid = T.ttId(user.username);
        profiles[uid] = Object.assign({}, user, { seenAt: Date.now() });
        if (accounts[uid]) dirty[uid] = true;
      }
      var items = T.itemsFrom(json);
      found += items.length;
      ingest(items);
    });
    return found;
  }

  // ---- auto-scroll (TikTok loads the next page of the grid by itself) --------
  function captchaShown() {
    return !!document.querySelector('#captcha-verify-container, .captcha_verify_container, .captcha-verify-container, [id^="captcha_container"], div[class*="captcha_verify"]');
  }

  /** The element that actually scrolls the video grid (the window, or a container TikTok uses). */
  function scroller() {
    var grid = document.querySelector('[data-e2e="user-post-item-list"], [data-e2e="search_top-item-list"], [data-e2e="challenge-item-list"]');
    for (var el = grid; el && el !== document.body; el = el.parentElement) {
      var st = getComputedStyle(el);
      if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 20) return el;
    }
    return null;
  }

  function scrollDown(nudge) {
    var el = scroller();
    if (nudge) { window.scrollBy(0, -800); if (el) el.scrollTop -= 800; }
    setTimeout(function () {
      window.scrollTo(0, document.documentElement.scrollHeight);
      if (el) el.scrollTop = el.scrollHeight;
    }, nudge ? 250 : 0);
  }

  function stopAuto(label) {
    auto.running = false;
    clearTimeout(auto.timer);
    auto.label = label || '';
    if (auto.done) { var d = auto.done; auto.done = null; d(); }
    scheduleRender();
  }

  function tick() {
    if (!auto.running) return;
    var id = ctx().id || currentAccount();
    var n = countFor(id);
    if (n > auto.last) { auto.last = n; auto.stale = 0; } else auto.stale++;
    auto.label = 'Scrolling… ' + n + ' collected';
    scheduleRender();
    if (captchaShown()) { stopAuto('TikTok is showing a puzzle. Solve it, then press Auto-scroll again (' + n + ' collected).'); return; }
    if (auto.stale >= 10 || (auto.deadline && Date.now() > auto.deadline) || (auto.max && n >= auto.max)) { stopAuto('Done: ' + n + ' collected.'); return; }
    scrollDown(auto.stale > 0 && auto.stale % 3 === 0);
    auto.timer = setTimeout(tick, 1500 + Math.random() * 1300);
  }

  function startAuto(deadline, max) {
    auto.running = true;
    auto.stale = 0;
    auto.deadline = deadline || null;
    auto.max = max || null;
    auto.last = countFor(ctx().id);
    tick();
  }

  function toggleAuto() {
    if (auto.running) { stopAuto('Stopped.'); return; }
    if (ctx().kind !== 'profile') { auto.label = 'Open a profile first, e.g. tiktok.com/@name'; scheduleRender(); return; }
    selected = null;
    startAuto();
  }

  // ---- downloads -----------------------------------------------------------
  function slim(p) {
    return { code: p.code, owner: p.owner, platform: 'tiktok', views: p.views, likes: p.likes, comments: p.comments, shares: p.shares, saves: p.saves, files: p.files, cover: p.thumb };
  }
  function downloadPosts(posts, what) {
    return chrome.runtime.sendMessage({ type: 'reelscope:download', what: what, posts: posts.map(slim) });
  }

  /**
   * Fallback for videos the browser can't download directly (TikTok's video CDN
   * wants this site's cookies and referer): fetch it from this page, then hand
   * the bytes to the background as a data: URL.
   */
  var MAX_FETCH = 60 * 1024 * 1024;
  async function pageFetch(urls) {
    var last = 'error';
    for (var i = 0; i < urls.length; i++) {
      try {
        var res = await fetch(urls[i], { credentials: 'include', referrer: 'https://www.tiktok.com/', signal: AbortSignal.timeout(90000) });
        if (!res.ok) { last = 'HTTP ' + res.status; continue; }
        var blob = await res.blob();
        if (blob.size < 1024) { last = 'empty response'; continue; }
        if (blob.size > MAX_FETCH) return { ok: false, error: 'File too large to pass through the page (' + Math.round(blob.size / 1048576) + ' MB).' };
        var dataUrl = await new Promise(function (resolve, reject) {
          var fr = new FileReader();
          fr.onload = function () { resolve(fr.result); };
          fr.onerror = function () { reject(fr.error); };
          fr.readAsDataURL(blob);
        });
        return { ok: true, dataUrl: dataUrl, bytes: blob.size, type: blob.type };
      } catch (e) {
        last = String(e && e.name === 'TypeError' ? 'blocked (' + e.message + ')' : (e && e.message) || e);
      }
    }
    return { ok: false, error: last };
  }

  // ---- agent commands (sent by agent-bridge.js from the local MCP server) -----
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function collectTikTok(a) {
    var name = String(a.username || '').replace(/^\/?(tt\/|@)/i, '').toLowerCase();
    var id = T.ttId(name);
    if (!T.isTikTokId(id)) return { ok: false, error: 'Not a valid TikTok username.' };
    var c = ctx();
    if (c.id !== id) return { ok: false, account: id, error: 'This tab is not on @' + name + '.' };
    var before = countFor(id);
    // Let the first page arrive (SSR or the first item_list response).
    for (var i = 0; i < 20 && !countFor(id); i++) { scanSsr(); await sleep(500); }
    if (captchaShown()) return { ok: false, account: id, error: 'TikTok is showing a puzzle (captcha) in the collection window. Open tiktok.com in Chrome, solve it once, then try again.' };
    if (!countFor(id) && /couldn.t find this account|bu hesap bulunamadı/i.test(document.body ? document.body.innerText.slice(0, 5000) : '')) return { ok: false, account: id, error: '@' + name + ' was not found on TikTok.' };
    var max = Math.min(2000, a.maxPosts || 300);
    await new Promise(function (resolve) { auto.done = resolve; startAuto(Date.now() + 4 * 60000, max); });
    await flushSave();
    var got = countFor(id) - before;
    var prof = profiles[id];
    return {
      ok: countFor(id) > 0, account: id, collected_now: got, saved_total: countFor(id),
      profile_videos: prof && prof.videos != null ? prof.videos : undefined,
      followers: prof && prof.followers != null ? prof.followers : undefined,
      note: 'ReelScope scrolled tiktok.com/@' + name + ' in a small window and read the videos TikTok loaded (no API requests of its own).' +
        (prof && prof.videos && countFor(id) < prof.videos * 0.8 ? ' TikTok loaded ' + countFor(id) + ' of about ' + prof.videos + ' videos; it may load fewer while that window is hidden. For the rest, open the profile in Chrome and press Auto-scroll in the ReelScope panel.' : '')
    };
  }

  /** On a video page: read its SSR blob (or wait for /api/item/detail) so the record and its links are fresh. */
  async function refreshTikTok(a) {
    var vid = String(a.id || '');
    var started = Date.now();
    for (var i = 0; i < 30; i++) {
      scanSsr();
      var p = findPost(vid);
      if (p && p.seenAt >= started - 1000) break;
      await sleep(500);
    }
    var post = findPost(vid);
    await flushSave();
    if (!post || post.seenAt < started - 1000) return { ok: false, id: vid, error: captchaShown() ? 'TikTok is showing a puzzle (captcha). Open tiktok.com in Chrome, solve it once, then try again.' : 'TikTok did not show this video (deleted, private or region-locked?).' };
    return { ok: true, id: vid, account: post.owner };
  }

  async function downloadTikTok(a) {
    var r = await refreshTikTok(a);
    if (!r.ok) return r;
    var p = findPost(String(a.id));
    var what = a.what === 'cover' ? ['cover'] : a.what === 'both' ? ['media', 'cover'] : ['media'];
    var out = { ok: false, id: p.code, account: p.owner, files: [], errors: [] };
    for (var i = 0; i < what.length; i++) {
      var res = await downloadPosts([p], what[i]);
      (res && res.files || []).forEach(function (f) { out.files.push(f); });
      (res && res.errors || []).forEach(function (e) { out.errors.push(e); });
    }
    out.ok = out.files.length > 0;
    if (!out.errors.length) delete out.errors;
    return out;
  }

  async function runCommand(cmd) {
    var a = cmd.args || {};
    if (cmd.type === 'collect_tiktok') return collectTikTok(a);
    if (cmd.type === 'refresh_tiktok') return refreshTikTok(a);
    if (cmd.type === 'download_tiktok') return downloadTikTok(a);
    return { ok: false, error: 'This is a TikTok tab; it cannot run ' + cmd.type + '.' };
  }

  // ---- UI -------------------------------------------------------------------
  var cssText = '';
  try { cssText = await (await fetch(chrome.runtime.getURL('src/panel.css'))).text(); } catch (e) { /* unstyled */ }

  function downloadFile(filename, text, mime) {
    var url = URL.createObjectURL(new Blob([text], { type: mime }));
    var el = document.createElement('a');
    el.href = url;
    el.download = filename;
    document.body.appendChild(el);
    el.click();
    el.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  var panel = P.create({
    cssText: cssText,
    platform: 'tiktok',
    listTabLabel: 'Videos',
    autoTip: 'Scroll this profile automatically until every video has loaded',
    onAutoScroll: toggleAuto,
    onSelectProfile: function (id) { selected = id || null; scheduleRender(); },
    onClearProfile: function (id) {
      delete accounts[id];
      delete dirty[id];
      if (selected === id) selected = null;
      chrome.storage.local.remove(KEY_PREFIX + id);
      scheduleRender();
    },
    onDownload: downloadFile,
    onCopy: function (text) { return navigator.clipboard.writeText(text); },
    onDownloadMedia: downloadPosts,
    onOpenDashboard: function () {
      var id = currentAccount();
      chrome.runtime.sendMessage({ type: 'reelscope:open-dashboard', hash: id ? '#/account/' + encodeURIComponent(id) : '' });
    }
  });

  var overlay = O.create({
    cssText: cssText,
    getPost: function (id) { return findPost(id); },
    getProfilePosts: function (owner) { return owner && accounts[owner] ? Object.values(accounts[owner]) : []; },
    isLoading: function () { return false; },
    onDownloadMedia: downloadPosts,
    onOpenPanel: function () { panel.toggle(true); }
  });

  var renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    setTimeout(function () {
      renderQueued = false;
      var id = currentAccount();
      var prof = id && profiles[id];
      panel.update({
        platform: 'tiktok',
        profiles: accountList(),
        selected: id,
        posts: id ? Object.values(accounts[id]) : [],
        auto: { running: auto.running, label: auto.label || (prof && prof.videos ? countFor(id) + ' of ~' + prof.videos + ' videos collected' : '') }
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
  scanSsr();
  scheduleRender();
  overlay.setCode(ctx().video);

  // TikTok is a single-page app: watch for navigation (also the video modal on profiles).
  var lastPath = location.pathname;
  setInterval(function () {
    mount();
    if (location.pathname === lastPath) return;
    var prevProfile = T.pageContext(lastPath).id;
    lastPath = location.pathname;
    var c = ctx();
    if (c.id !== prevProfile) selected = null;
    if (auto.running && c.kind !== 'profile' && !auto.deadline) stopAuto('Stopped: page changed.');
    overlay.setCode(c.video);
    setTimeout(scanSsr, 1200);
    scheduleRender();
  }, 500);

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg) return;
    if (msg.type === 'reelscope:toggle') {
      panel.toggle(true);
      sendResponse({ ok: true, profile: currentAccount() });
    }
    if (msg.type === 'reelscope:tt-fetch' && Array.isArray(msg.urls)) {
      pageFetch(msg.urls.filter(function (u) { return /^https:\/\//.test(u); })).then(sendResponse);
      return true;
    }
    if (msg.type === 'reelscope:command' && msg.command) {
      sendResponse({ accepted: true });
      runCommand(msg.command).then(function (result) {
        chrome.runtime.sendMessage({ type: 'reelscope:command-done', id: msg.command.id, result: result });
      }, function (e) {
        chrome.runtime.sendMessage({ type: 'reelscope:command-done', id: msg.command.id, result: { ok: false, error: String(e && e.message || e) } });
      });
    }
  });
})();
