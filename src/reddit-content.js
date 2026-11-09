// OpenOutlier – content script for www.reddit.com (isolated world).
//
// Two ways in, both read-only and from your own logged-in tab:
//  1. Posts on the page: every <shreddit-post> element (and the ones that load
//     while you scroll) is read from its attributes.
//  2. "Collect top posts": pages through same-origin listing JSON
//     (/r/<sub>/top.json?t=year&limit=100&after=…, /user/<name>/submitted.json),
//     one request every ~2 s, backing off on 429. If Reddit refuses the JSON
//     (403 / login wall), OpenOutlier switches to DOM-only mode and says so.
// It never posts, comments, votes or sends messages.
//
// Storage: rs:p:r/<sub> and rs:p:u/<user> = { posts: {id: post}, updatedAt, platform: 'reddit' }.
(async function () {
  'use strict';
  if (window.top !== window || window.__reelscopeReddit) return;
  window.__reelscopeReddit = true;

  var R = self.ReelScopeReddit;
  var P = self.ReelScopePanel;
  var KEY_PREFIX = 'rs:p:';
  var MIN_POSTS = 5;
  var COOLDOWNS = [30000, 60000, 120000];

  /** account id ("r/excel", "u/name") -> { id -> post } */
  var accounts = {};
  var dirty = {};
  var selected = null;
  var auto = { running: false, timer: null, stale: 0, last: 0, label: '', done: null };
  var collect = { running: false, stop: false, label: '' };
  // Reddit has been answering listing .json with 403 even for logged-in tabs.
  // Remember that (for a day) so agent commands go straight to reading the page.
  var JSON_KEY = 'rs:reddit-json';
  var JSON_RETRY_MS = 24 * 3600000;
  var jsonBlockedUntil = 0;
  var AUTO_KEY = 'reelscope:collect'; // sessionStorage: "start collecting after this navigation"

  function isRedditKey(k) { return k.indexOf(KEY_PREFIX) === 0 && R.isRedditId(k.slice(KEY_PREFIX.length)); }

  // ---- storage --------------------------------------------------------------
  try {
    var saved = await chrome.storage.local.get(null);
    Object.keys(saved).forEach(function (k) {
      if (isRedditKey(k) && saved[k] && saved[k].posts) accounts[k.slice(KEY_PREFIX.length)] = saved[k].posts;
    });
    if (saved[JSON_KEY] && saved[JSON_KEY].blockedUntil) jsonBlockedUntil = saved[JSON_KEY].blockedUntil;
  } catch (e) { /* storage unavailable: run in memory */ }

  function record(id) {
    return { posts: accounts[id], updatedAt: Date.now(), platform: 'reddit', kind: id.indexOf('u/') === 0 ? 'user' : 'subreddit' };
  }

  // Saving re-reads the stored records and merges post by post, so a tab with
  // an older copy (e.g. the home feed, which saw one r/excel post) never
  // overwrites the 1,000 posts another tab collected.
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
      if (rec && rec.posts) accounts[id] = R.mergePostMaps(rec.posts, accounts[id]);
      batch[KEY_PREFIX + id] = record(id);
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
  async function flushSave() {
    clearTimeout(saveTimer);
    await saveNow();
  }

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    var changed = false;
    Object.keys(changes).forEach(function (k) {
      if (!isRedditKey(k)) return;
      var id = k.slice(KEY_PREFIX.length);
      var nv = changes[k].newValue;
      if (!nv) { delete accounts[id]; changed = true; return; }
      // Saved by another tab (or by us): take in what it knows.
      if (nv.posts) { accounts[id] = accounts[id] ? R.mergePostMaps(accounts[id], nv.posts) : nv.posts; changed = true; }
    });
    if (changed) scheduleRender();
  });

  // ---- page context ---------------------------------------------------------
  function ctx() { return R.pageContext(location.pathname, location.search); }

  function accountList() {
    var c = ctx();
    var keep = [c.id, selected];
    return Object.keys(accounts)
      .map(function (id) { return { username: id, count: Object.keys(accounts[id]).length }; })
      .filter(function (a) { return a.count >= MIN_POSTS || (a.count > 0 && keep.indexOf(a.username) !== -1); })
      .sort(function (a, b) { return b.count - a.count; });
  }

  function currentAccount() {
    if (selected && accounts[selected]) return selected;
    var c = ctx();
    if (c.id && accounts[c.id] && Object.keys(accounts[c.id]).length) return c.id;
    var list = accountList();
    return list.length ? list[0].username : null;
  }

  function countFor(id) { return id && accounts[id] ? Object.keys(accounts[id]).length : 0; }

  // ---- ingest ---------------------------------------------------------------
  function sig(p) { var o = Object.assign({}, p); delete o.seenAt; return JSON.stringify(o); }

  /** target: account id to file the posts under (null = each post's own subreddit). */
  function ingest(posts, target) {
    var added = 0;
    posts.forEach(function (p) {
      var id = target || p.owner;
      if (!id || !R.isRedditId(id)) return;
      p.owner = id;
      if (id.indexOf('u/') === 0) p.ownerName = 'u/' + (p.author || id.slice(2));
      var bucket = accounts[id] || (accounts[id] = {});
      if (!bucket[p.code]) added++;
      var before = bucket[p.code] ? sig(bucket[p.code]) : null;
      bucket[p.code] = R.merge(bucket[p.code], p);
      if (before !== sig(bucket[p.code])) dirty[id] = true;
    });
    if (Object.keys(dirty).length) { scheduleSave(); scheduleRender(); }
    return added;
  }

  /** Where a post seen on this page belongs. */
  function targetFor(p, c) {
    if (c.kind === 'user') return p.author && p.author.toLowerCase() === c.name.toLowerCase() ? c.id : null;
    if ((c.kind === 'subreddit' || c.kind === 'post') && p.subreddit === c.name.toLowerCase()) return c.id;
    return p.owner; // home feed etc.: the post's own subreddit
  }

  // ---- 1. posts on the page ---------------------------------------------------
  var seenEls = new WeakSet();
  var FLAIR_SEL = 'shreddit-post-flair, [slot="post-flair"], flair-content, [noun="post_flair"]';

  function attrsOf(el) {
    var a = {};
    el.getAttributeNames().forEach(function (n) { a[n.toLowerCase()] = el.getAttribute(n); });
    if (!a.flair) {
      var f = el.querySelector(FLAIR_SEL);
      var text = f && f.textContent.replace(/\s+/g, ' ').trim();
      if (text && text.length < 80) a.flair = text;
    }
    return a;
  }

  function scanPage() {
    var els = document.querySelectorAll('shreddit-post');
    if (!els.length) return;
    var c = ctx();
    var fresh = [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (seenEls.has(el)) continue;
      var p = R.fromShredditAttrs(attrsOf(el));
      if (!p) continue; // ads / placeholders without a title
      seenEls.add(el);
      fresh.push(p);
    }
    if (!fresh.length) return;
    var byTarget = {};
    fresh.forEach(function (p) { var t = targetFor(p, c); if (t) (byTarget[t] = byTarget[t] || []).push(p); });
    Object.keys(byTarget).forEach(function (t) { ingest(byTarget[t], t); });
  }

  var scanTimer = null;
  new MutationObserver(function () {
    if (scanTimer) return;
    scanTimer = setTimeout(function () { scanTimer = null; scanPage(); }, 400);
  }).observe(document.documentElement, { childList: true, subtree: true });

  // ---- 2. listing JSON ----------------------------------------------------------
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /** GET same-origin listing JSON with this tab's cookies. → { kind: ok|rate|refused|error, json } */
  async function rGet(path) {
    var res;
    var text = '';
    try {
      res = await fetch(path, { credentials: 'include', headers: { accept: 'application/json' } });
      text = await res.text();
    } catch (e) {
      return { kind: 'error' };
    }
    if (res.status === 429) return { kind: 'rate' };
    if (res.status === 401 || res.status === 403) return { kind: 'refused', status: res.status };
    if (res.status === 404) return { kind: 'missing' };
    if (!res.ok) return { kind: 'error', status: res.status };
    if (/^\s*</.test(text)) return { kind: 'refused', status: res.status }; // HTML (login wall / block page) instead of JSON
    try { return { kind: 'ok', json: JSON.parse(text) }; } catch (e) { return { kind: 'error' }; }
  }

  var BLOCKED_MSG = 'Reddit refused the JSON listing. DOM-only mode: scroll the page (or press Auto-scroll) to collect the posts you see.';

  /**
   * Page through a subreddit's / user's listing.
   * target: { kind: 'subreddit'|'user', id, name }; opts: { sort, t, max, onProgress }
   */
  async function collectListing(target, opts) {
    var got = 0;
    var after = null;
    var backoff = 0;
    var pages = Math.ceil(Math.min(1000, opts.max || 1000) / 100);
    for (var page = 0; page < pages && !collect.stop; page++) {
      var path = R.listingPath(target, { sort: opts.sort, t: opts.t, after: after, limit: 100 });
      var r = await rGet(path);
      if (r.kind === 'rate') {
        if (backoff >= COOLDOWNS.length) return { ok: got > 0, partial: true, collected_now: got, error: 'Reddit is limiting requests; stopped early. Try again in a few minutes.' };
        opts.onProgress && opts.onProgress('Reddit asked to slow down. Waiting ' + COOLDOWNS[backoff] / 1000 + 's…');
        await sleep(COOLDOWNS[backoff++]);
        page--;
        continue;
      }
      if (r.kind === 'refused') {
        jsonBlockedUntil = Date.now() + JSON_RETRY_MS;
        var o = {};
        o[JSON_KEY] = { blockedUntil: jsonBlockedUntil, status: r.status || null, at: Date.now() };
        chrome.storage.local.set(o).catch(function () {});
        return { ok: got > 0, partial: true, json_blocked: true, collected_now: got, error: BLOCKED_MSG };
      }
      if (r.kind === 'missing') return { ok: false, collected_now: got, error: (target.kind === 'user' ? 'u/' : 'r/') + target.name + ' was not found (private, banned or misspelled?).' };
      if (r.kind !== 'ok') return { ok: got > 0, partial: true, collected_now: got, error: 'Reddit returned an error' + (r.status ? ' (HTTP ' + r.status + ')' : '') + '.' };
      backoff = 0;
      var listing = R.parseListing(r.json);
      ingest(listing.posts, target.id);
      got += listing.posts.length;
      opts.onProgress && opts.onProgress('Collecting… ' + got + ' posts');
      if (!listing.after || !listing.posts.length) break;
      after = listing.after;
      await sleep(1800 + Math.random() * 1200);
    }
    await flushSave();
    return { ok: true, collected_now: got };
  }

  function collectTarget() {
    var c = ctx();
    if (c.kind === 'subreddit' || c.kind === 'post') return { kind: 'subreddit', id: c.id, name: c.name };
    if (c.kind === 'user') return { kind: 'user', id: c.id, name: c.name };
    return null;
  }

  /** Is this page the listing "Collect top posts" reads (top of a subreddit / a user's posts)? */
  function onCollectPage(target, c) {
    if (target.kind === 'user') return c.kind === 'user' && /^(submitted|posts)$/.test(c.tab || '');
    return c.kind === 'subreddit' && c.sort === 'top';
  }

  /**
   * "Collect top posts": open the subreddit's top posts of the year (or the
   * user's posts) and scroll until no more load, reading every post on the
   * page. (Reddit refuses its listing JSON, so the page is the source.)
   */
  function onCollect() {
    if (collect.running) { collect.stop = true; stopAuto('Stopped: ' + countFor(collectTarget() && collectTarget().id) + ' saved.'); return; }
    var target = collectTarget();
    if (!target) { collect.label = 'Open a subreddit or a user first.'; scheduleRender(); return; }
    if (!onCollectPage(target, ctx())) {
      try { sessionStorage.setItem(AUTO_KEY, JSON.stringify({ id: target.id, at: Date.now() })); } catch (e) { /* ignore */ }
      collect.label = 'Opening the top posts…';
      scheduleRender();
      location.assign(R.pageUrl(target.id, { sort: 'top', t: 'year' }));
      return;
    }
    collect.running = true;
    collect.stop = false;
    selected = null;
    collect.label = 'Collecting ' + target.id + '…';
    var before = countFor(target.id);
    auto.done = function () {
      collect.running = false;
      collect.label = (collect.stop ? 'Stopped' : 'Done') + ': ' + (countFor(target.id) - before) + ' new, ' + countFor(target.id) + ' saved.';
      flushSave();
      scheduleRender();
    };
    startAuto(null, 1000);
  }

  /** Started from another page with "Collect top posts": carry on here. */
  function resumeCollect() {
    var flag = null;
    try { flag = JSON.parse(sessionStorage.getItem(AUTO_KEY) || 'null'); sessionStorage.removeItem(AUTO_KEY); } catch (e) { /* ignore */ }
    var target = collectTarget();
    if (flag && target && flag.id === target.id && Date.now() - flag.at < 60000 && onCollectPage(target, ctx())) onCollect();
  }

  // ---- auto-scroll ----------------------------------------------------------
  function stopAuto(label) {
    auto.running = false;
    clearTimeout(auto.timer);
    auto.label = label || '';
    if (auto.done) { var d = auto.done; auto.done = null; d(); }
    scheduleRender();
  }

  function tick() {
    if (!auto.running) return;
    scanPage();
    var id = ctx().id || currentAccount();
    var n = countFor(id);
    if (n > auto.last) { auto.last = n; auto.stale = 0; } else auto.stale++;
    auto.label = 'Scrolling… ' + n + ' collected';
    scheduleRender();
    if (auto.stale >= 10 || (auto.deadline && Date.now() > auto.deadline) || (auto.max && n >= auto.max)) { stopAuto('Done: ' + n + ' collected.'); return; }
    if (auto.stale > 0 && auto.stale % 3 === 0) window.scrollBy(0, -800);
    setTimeout(function () { window.scrollTo(0, document.documentElement.scrollHeight); }, auto.stale % 3 === 0 && auto.stale ? 250 : 0);
    auto.timer = setTimeout(tick, 1300 + Math.random() * 1200);
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
    var c = ctx();
    if (c.kind !== 'subreddit' && c.kind !== 'user') { auto.label = 'Open a subreddit or a user first.'; scheduleRender(); return; }
    startAuto();
  }

  // ---- agent commands (sent by background.js from the local MCP server) ------
  // agent-bridge.js opens a background tab on the account's page for each command,
  // so the DOM fallback can scroll the right page.
  async function collectReddit(a) {
    var kind = a.kind === 'user' ? 'user' : 'subreddit';
    var name = String(a.name || '').replace(/^\/?(r|u|user)\//i, '');
    if (!/^[A-Za-z0-9_-]{2,30}$/.test(name)) return { ok: false, error: 'Not a valid ' + kind + ' name.' };
    var target = { kind: kind, name: name, id: kind === 'user' ? R.userId(name) : R.subId(name) };
    var before = countFor(target.id);
    var max = Math.min(1000, a.maxPosts || 500);
    // JSON listings first only if Reddit hasn't refused them in the last day.
    var r = Date.now() < jsonBlockedUntil ? { json_blocked: true } : await collectListing(target, { sort: a.sort || 'top', t: a.t || 'year', max: max });
    if (!r.json_blocked) return Object.assign(r, { account: target.id, mode: 'json', saved_total: countFor(target.id) });
    // Read the page instead: agent-bridge opened this tab on the account's page; scroll it for up to 4 minutes.
    if (ctx().id !== target.id) return { ok: false, account: target.id, json_blocked: true, error: 'This tab is not on ' + target.id + '.' };
    await new Promise(function (resolve) { auto.done = resolve; startAuto(Date.now() + 4 * 60000, max); });
    await flushSave();
    var got = countFor(target.id) - before;
    return { ok: countFor(target.id) > 0, account: target.id, mode: 'page', collected_now: got, saved_total: countFor(target.id),
      note: 'Reddit refuses its listing JSON, so OpenOutlier scrolled ' + R.pageUrl(target.id, a) + ' in a small window and read the posts (no upvote ratio).' +
        (got < 50 ? ' Few posts loaded: Reddit may load less while that window is hidden behind others. For more, open the page in Chrome and press Collect top posts in the OpenOutlier panel.' : '') };
  }

  async function runCommand(cmd) {
    if (cmd.type === 'collect_reddit') return collectReddit(cmd.args || {});
    return { ok: false, error: 'This is a Reddit tab; it cannot run ' + cmd.type + '.' };
  }

  // ---- UI -------------------------------------------------------------------
  var cssText = '';
  try { cssText = await (await fetch(chrome.runtime.getURL('src/panel.css'))).text(); } catch (e) { /* unstyled */ }
  try { if (self.OpenOutlierBrand) await self.OpenOutlierBrand.load(); } catch (e) { /* text fallbacks */ }

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

  var panel = P.create({
    cssText: cssText,
    platform: 'reddit',
    listTabLabel: 'Posts',
    autoTip: 'Scroll this page automatically and collect every post that loads',
    onAutoScroll: toggleAuto,
    onCollect: onCollect,
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
    onDownloadMedia: function () { return Promise.resolve({ ok: false, queued: 0 }); },
    onOpenDashboard: function () {
      var id = currentAccount();
      chrome.runtime.sendMessage({ type: 'reelscope:open-dashboard', hash: id ? '#/account/' + encodeURIComponent(id) : '' });
    }
  });

  var renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    setTimeout(function () {
      renderQueued = false;
      var id = currentAccount();
      var target = collectTarget();
      panel.update({
        platform: 'reddit',
        profiles: accountList(),
        selected: id,
        posts: id ? Object.values(accounts[id]) : [],
        auto: { running: auto.running, label: collect.running || (collect.label && !auto.running) ? collect.label : auto.label },
        collect: {
          running: collect.running,
          enabled: !!target,
          label: 'Collect top posts',
          tip: target ? 'Open the top posts of the year of ' + target.id + ' and scroll until no more load (up to 1,000), reading every post' : 'Open a subreddit or a user first'
        }
      });
    }, 250);
  }

  function mount() {
    var parent = document.body || document.documentElement;
    if (!panel.host.isConnected) parent.appendChild(panel.host);
  }

  mount();
  scanPage();
  scheduleRender();
  setTimeout(resumeCollect, 1500);

  // reddit.com navigates client-side too: watch for it.
  var lastPath = location.pathname + location.search;
  setInterval(function () {
    mount();
    var now = location.pathname + location.search;
    if (now === lastPath) return;
    lastPath = now;
    selected = null;
    if (auto.running) stopAuto('Stopped: page changed.');
    if (!collect.running) collect.label = '';
    setTimeout(scanPage, 800);
    scheduleRender();
  }, 500);

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg && msg.type === 'reelscope:toggle') {
      panel.toggle(true);
      sendResponse({ ok: true, profile: currentAccount() });
    }
    if (msg && msg.type === 'reelscope:command' && msg.command) {
      sendResponse({ accepted: true });
      runCommand(msg.command).then(function (result) {
        chrome.runtime.sendMessage({ type: 'reelscope:command-done', id: msg.command.id, result: result });
      }, function (e) {
        chrome.runtime.sendMessage({ type: 'reelscope:command-done', id: msg.command.id, result: { ok: false, error: String(e && e.message || e) } });
      });
    }
  });
})();
