// OpenOutlier – X Phase 3 on x.com (docs/x-plan.md section 4): a small "Growth" drawer next to the
// page with the reply opportunities feed, reply ROI, people (light CRM), today's goals, the niche
// list and saved searches, plus a small consistency counter. Logic: src/x-growth.js.
//
// Read-only, like src/x-content.js: it sees x.com's own GraphQL responses through the hook block
// x-content.js runs (self.OpenOutlierXHooks), and the side nav's Profile link for the user's handle.
// It sends no request to X and never posts, replies, likes, follows or creates lists.
//   - "Open" on an opportunity opens the post in a new tab and focuses its reply box. The user writes.
//   - The optional list-tab refresh (x.nicheRefresh, off by default) reloads the open list tab, x.com's own
//     page load, every 10 minutes, never while the user types or right after they touched the page.
//   - Reply angles (Phase 5) go through the x-llm service worker only when that feature is set up, with
//     its preview and cost shown before anything is sent. The angles are shown, never typed into X.
(async function () {
  'use strict';
  if (window.top !== window || window.__openoutlierXGrowth) return;
  window.__openoutlierXGrowth = true;

  var X = self.OpenOutlierX;
  var G = self.OpenOutlierXGrowth;
  var FT = self.OpenOutlierFeatures;
  if (!X || !G) return;

  var K = {
    me: 'rs:x:me', src: 'rs:x:niche-src', feed: 'rs:x:feed', pace: 'rs:x:pace', crm: 'rs:x:crm', goals: 'rs:x:goals',
    sent: 'rs:x:sent', searches: 'rs:x:searches', org: 'rs:org', overview: 'rs:x:raw:accountOverviewDailyQuery', focus: 'rs:x:focus-reply'
  };
  var MINE = { me: 1, src: 1, feed: 1, pace: 1, crm: 1, goals: 1, sent: 1, searches: 1 };
  var st = {
    ready: false, me: null, org: null, src: {}, feed: { posts: {} }, pace: { posts: {} }, crm: { accounts: {} }, goals: null,
    sent: { items: {} }, searches: { items: [] }, overview: null
  };
  var dirty = {};
  var lastListLoad = 0;
  var lastInput = 0;

  function api() { return self.OpenOutlierXApi || null; }
  function on(id) { return FT ? FT.isOn(id) : true; }
  function anyOn() { return on('x.niche') || on('x.replyFeed') || on('x.crm') || on('x.consistency'); }
  function ctx() { return X.pageContext(location.pathname); }

  // ---- the hook: registered before anything async, so the first responses are seen -------------------
  var early = [];
  (self.OpenOutlierXHooks = self.OpenOutlierXHooks || []).push({ payload: onPayload });

  function onPayload(res, msg) {
    var op = res ? res.op : X.opOf(msg && msg.url);
    if (!st.ready) { if (res && res.posts && res.posts.length) early.push({ res: res, op: op }); return null; }
    if (!anyOn()) return null;
    var now = Date.now();
    if (op === 'CreateTweet' || op === 'CreateNoteTweet') return onSent(G.parseCreateTweet(op, msg && msg.text), op, now);
    if (!res) return null;
    if (res.raw) { if (op === 'accountOverviewDailyQuery') st.overview = { data: res.raw }; scheduleRender(); return null; }
    observe(res, op, now);
    return annotate(res);
  }

  /** Feed, early-view samples, list / Following sources, saved searches and the user's followers. */
  function observe(res, op, now) {
    detectMe();
    if (st.me) {
      (res.users || []).forEach(function (u) {
        if (!u || (u.id !== st.me.id && !(st.me.restId && u.restId === st.me.restId))) return;
        if (u.restId && st.me.restId !== u.restId) st.me.restId = u.restId;
        st.me = G.logFollowers(st.me, u.followers, now);
        u.me = true;                         // lands on rs:p:x/<me>.profile: the bridge knows who "me" is
        u.followersLog = st.me.followersLog; // and the follower history for x_reply_roi
        dirty.me = true;
      });
    }
    if (on('x.niche') || on('x.replyFeed')) {
      var c = ctx();
      var fresh = (res.posts || []).filter(function (p) { return p.kind === 'original' && !p.promoted && p.takenAt && now - p.takenAt <= G.C.FEED_MAX_AGE_MIN * 60000; });
      if (fresh.length) {
        st.feed = G.feedAdd(st.feed, fresh, G.sourceOf(op) || c.kind, now);
        st.pace = G.paceAdd(st.pace, fresh, now);
        dirty.feed = dirty.pace = true;
      }
      if (op === 'ListLatestTweetsTimeline' || op === 'HomeLatestTimeline' || op === 'CommunityTweetsTimeline') {
        st.src = G.noteSource(st.src, op, c.list, res.posts, now);
        dirty.src = true;
        if (op === 'ListLatestTweetsTimeline') lastListLoad = now;
      }
    }
    if (op === 'SearchTimeline' && on('x.niche')) {
      var q = G.searchFromUrl(location.href);
      if (q) {
        searchPage.q = q.q;
        (res.posts || []).forEach(function (p) { searchPage.posts[p.code] = p; });
        // After x-content.js ingested this response, so its baselines include these authors' page posts.
        setTimeout(recordOpenSearch, 0);
      }
    }
    scheduleSave();
    scheduleRender();
  }

  /** The user's replies in this response: the post they answered, and whether its author answered back. */
  function annotate(res) {
    if (!on('x.crm') || !st.me) return null;
    var known = {};
    var stored = myPostMap();
    Object.keys(stored).forEach(function (k) { if (stored[k].kind === 'reply') known[k] = stored[k]; });
    var changed = G.annotateReplies(res.posts || [], st.me, known);
    if (!changed.length) return null;
    var at = {};
    res.posts.forEach(function (p, i) { at[p.code] = i; });
    changed.forEach(function (p) {
      if (at[p.code] != null) res.posts[at[p.code]] = X.merge(res.posts[at[p.code]], p);
      else res.posts.push(p);
    });
    return res;
  }

  /** A post or reply the user just sent in this tab (x.com's CreateTweet response). */
  function onSent(p, op, now) {
    if (!p) return null;
    detectMe();
    if (st.me && !st.me.restId && p.ownerId && p.owner === st.me.id) { st.me.restId = p.ownerId; dirty.me = true; }
    st.sent = G.sentAdd(st.sent, p, now);
    dirty.sent = true;
    if (p.kind === 'reply' && st.me) {
      var parent = findAnyPost(p.replyToId);
      if (parent) {
        var a = G.annotateReplies([p, parent], st.me, {});
        if (a.length) p = X.merge(p, a[0]);
      }
    }
    scheduleSave();
    scheduleRender();
    return { op: op, posts: [p], users: [], cursors: {}, raw: null, profileUser: null };
  }

  // ---- the user's own account ------------------------------------------------------------------------
  function detectMe() {
    var a = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    var m = a && G.meFromHref(a.getAttribute('href'));
    if (!m || (st.me && st.me.id === m.id)) return;
    st.me = { id: m.id, handle: m.handle, restId: null, source: 'nav', detectedAt: Date.now(), followersLog: {} };
    var prof = api() && api().profile(m.id);
    if (prof && prof.restId) st.me.restId = prof.restId;
    dirty.me = true;
    scheduleSave();
    ensureMeAccount();
    adoptOwnHandle(m.handle);
  }
  /** Phase 2 (My X) reads rs:x-own.handle; if the user never set it, use the handle detected here, so both agree on "me". */
  async function adoptOwnHandle(handle) {
    try {
      var r = await chrome.storage.local.get('rs:x-own');
      var cur = r['rs:x-own'] && typeof r['rs:x-own'] === 'object' ? r['rs:x-own'] : {};
      if (cur.handle || !handle) return;
      await chrome.storage.local.set({ 'rs:x-own': Object.assign({}, cur, { handle: handle, source: 'nav' }) });
    } catch (e) { /* storage unavailable */ }
  }
  /** The user's own account in the Library, so x-content.js keeps their posts and replies wherever they appear. */
  async function ensureMeAccount() {
    if (!st.me || !(on('x.crm') || on('x.consistency'))) return;
    var key = 'rs:p:' + st.me.id;
    try {
      var r = await chrome.storage.local.get(key);
      if (r[key]) return;
      var o = {};
      o[key] = { posts: {}, updatedAt: Date.now(), platform: 'x' };
      await chrome.storage.local.set(o);
    } catch (e) { /* storage unavailable */ }
  }
  function meInfo() {
    if (!st.me) return null;
    var prof = api() && api().profile(st.me.id);
    var log = st.me.followersLog || {};
    var days = Object.keys(log).sort();
    return { id: st.me.id, handle: st.me.handle, restId: st.me.restId || (prof && prof.restId) || null,
      followers: prof && prof.followers != null ? prof.followers : days.length ? log[days[days.length - 1]] : null };
  }
  function myPostMap() { return (st.me && api() && api().posts(st.me.id)) || {}; }
  function myPosts() { var m = myPostMap(); return Object.keys(m).map(function (k) { return m[k]; }); }
  function findAnyPost(id) {
    if (!id) return null;
    var a = api();
    var pp = a ? a.pagePosts() : {};
    return pp[id] || (st.feed.posts && st.feed.posts[id]) || null;
  }
  function profilesMap() {
    var a = api();
    var out = {};
    if (a) a.accountIds().forEach(function (id) { var p = a.profile(id); if (p) out[id] = p; });
    return out;
  }

  // ---- storage ---------------------------------------------------------------------------------------
  try {
    var keys = Object.keys(K).map(function (k) { return K[k]; });
    var saved = await chrome.storage.local.get(keys);
    Object.keys(MINE).forEach(function (k) { if (saved[K[k]]) st[k] = saved[K[k]]; });
    st.org = saved[K.org] || null;
    st.overview = saved[K.overview] || null;
  } catch (e) { /* in memory */ }
  try { if (FT) await FT.ready; } catch (e) { /* defaults */ }
  var now0 = Date.now();
  st.feed = G.feedPrune(st.feed, now0);
  st.pace = G.pacePrune(st.pace, now0);
  st.ready = true;
  early.splice(0).forEach(function (e) { try { observe(e.res, e.op, Date.now()); } catch (err) { /* one response */ } });

  var saveTimer = null;
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 2500); }
  function saveNow() {
    var o = {};
    Object.keys(dirty).forEach(function (k) { if (MINE[k]) o[K[k]] = st[k]; });
    dirty = {};
    if (Object.keys(o).length) chrome.storage.local.set(o).catch(function (e) { console.warn('[OpenOutlier] growth save failed', e); });
  }
  /** Read-modify-write of a shared key (rs:org, an account), so another page's newer copy is never overwritten. */
  async function update(key, fn) {
    var r = await chrome.storage.local.get(key);
    var next = fn(r[key]);
    var o = {};
    o[key] = next;
    await chrome.storage.local.set(o);
    return next;
  }
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    var hit = false;
    Object.keys(MINE).forEach(function (k) {
      // Our own pending (dirty) state wins; other tabs' writes are taken otherwise.
      if (changes[K[k]] && !dirty[k]) { st[k] = changes[K[k]].newValue || st[k]; hit = true; }
    });
    if (changes[K.org]) { st.org = changes[K.org].newValue || null; hit = true; }
    if (changes[K.overview]) { st.overview = changes[K.overview].newValue || null; hit = true; }
    if (Object.keys(changes).some(function (k) { return /^rs:p:x\//.test(k); })) hit = true;
    if (hit) scheduleRender();
  });

  // ---- data for the views ------------------------------------------------------------------------------
  function members() { var a = api(); return G.nicheMembers(st.org, a ? a.accountIds() : null); }
  function opportunities() {
    var now = Date.now();
    var a = api();
    var win = G.C.WINDOW_MIN * 60000;
    var posts = Object.keys(st.feed.posts || {}).map(function (k) { return st.feed.posts[k]; });
    var mem = members();
    if (a) {
      var pp = a.pagePosts();
      Object.keys(pp).forEach(function (k) { if (pp[k].takenAt && now - pp[k].takenAt <= win) posts.push(pp[k]); });
      if (mem) Object.keys(mem).forEach(function (id) {
        var ps = a.posts(id) || {};
        Object.keys(ps).forEach(function (k) { if (ps[k].takenAt && now - ps[k].takenAt <= win) posts.push(ps[k]); });
      });
    }
    var replied = myPosts().filter(function (p) { return p.kind === 'reply'; });
    Object.keys(st.sent.items || {}).forEach(function (k) { if (st.sent.items[k].replyToId) replied.push({ replyToId: st.sent.items[k].replyToId }); });
    return G.replyOpportunities({ posts: posts, now: now, me: meInfo() || {}, members: mem, baselines: a ? a.baselines() : {}, pace: st.pace, myReplies: replied, limit: 40 });
  }
  function roiData() {
    var deltas = G.mergeDeltas(G.deltasFromOverview(st.overview && st.overview.data), G.deltasFromLog(st.me && st.me.followersLog));
    var a = api();
    return G.replyRoi({ myPosts: myPosts(), me: meInfo() || {}, deltas: deltas, parents: a ? a.pagePosts() : {}, now: Date.now() });
  }
  function consistencyData() {
    return G.consistency(G.activityByDay(myPosts(), st.sent, undefined, meInfo()), st.goals, Date.now());
  }

  // ---- saved searches ------------------------------------------------------------------------------------
  var searchPage = { q: null, posts: {} };
  function recordOpenSearch() {
    if (!searchPage.q || !G.findSearch(st.searches, searchPage.q)) return;
    var a = api();
    var posts = Object.keys(searchPage.posts).map(function (k) { return searchPage.posts[k]; });
    st.searches = G.recordSearch(st.searches, searchPage.q, G.rankPosts(posts, a ? a.baselines() : {}, Date.now()), Date.now());
    dirty.searches = true;
    scheduleSave();
    scheduleRender();
  }

  // ---- "Open": the post in a new tab, its reply box focused there ------------------------------------------
  function openPost(p) {
    var o = {};
    o[K.focus] = { id: p.code, at: Date.now() };
    chrome.storage.local.set(o).catch(function () {}).then(function () { window.open(p.url, '_blank', 'noopener'); });
  }
  async function focusReplyIfAsked() {
    var c = ctx();
    if (c.kind !== 'status') return;
    var r;
    try { r = await chrome.storage.local.get(K.focus); } catch (e) { return; }
    var f = r[K.focus];
    if (!f || f.id !== c.status || Date.now() - f.at > 2 * 60000) return;
    chrome.storage.local.remove(K.focus).catch(function () {});
    for (var i = 0; i < 40; i++) {
      var box = document.querySelector('[data-testid="tweetTextarea_0"]');
      if (box) {
        box.scrollIntoView({ block: 'center' });
        box.focus();
        // Focus only: the user writes the reply and presses Reply.
        return;
      }
      await new Promise(function (res) { setTimeout(res, 500); });
    }
  }

  // ---- list-tab refresh (x.nicheRefresh) ---------------------------------------------------------------------
  ['keydown', 'mousedown', 'wheel', 'touchstart'].forEach(function (t) { window.addEventListener(t, function () { lastInput = Date.now(); }, { capture: true, passive: true }); });
  var loadedAt = Date.now();
  function typing() {
    var el = document.activeElement;
    if (el && (el.isContentEditable || /^(TEXTAREA|INPUT)$/.test(el.tagName))) return true;
    var box = document.querySelector('[data-testid="tweetTextarea_0"]');
    return !!(box && box.textContent && box.textContent.trim());
  }
  setInterval(function () {
    var c = ctx();
    if (G.refreshDue({ on: on('x.nicheRefresh') && on('x.niche'), kind: c.kind, lastLoadAt: Math.max(lastListLoad, loadedAt), lastInputAt: lastInput, typing: typing(), now: Date.now() })) {
      saveNow();
      location.reload();
    }
  }, 30000);

  // ---- UI ----------------------------------------------------------------------------------------------------
  var host = document.createElement('div');
  host.id = 'openoutlier-x-growth';
  // Above x.com's account switcher (bottom-left of the nav), below the Post button: at bottom:12px it covered the switcher (live 2026-11-24).
  host.style.cssText = 'position:fixed;left:12px;bottom:78px;z-index:2147483000;';
  var shadow = host.attachShadow({ mode: 'open' });
  var styleEl = document.createElement('style');
  styleEl.textContent = [
    ':host{all:initial}',
    '*{box-sizing:border-box}',
    '.wrap{font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--fg)}',
    '.wrap{--fg:#0f1419;--dim:#536471;--bg:#fff;--line:rgba(15,20,25,.12);--chip:rgba(15,20,25,.06);--hot:#d4ff3a;--hotfg:#0d0d12;--acc:#1d9bf0}',
    '.wrap.dark{--fg:#e7e9ea;--dim:#8b98a5;--bg:#15202b;--line:rgba(231,233,234,.16);--chip:rgba(231,233,234,.08)}',
    '.wrap.black{--bg:#000}',
    '.pill{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--bg);color:var(--fg);border-radius:999px;padding:5px 11px;font:600 12px/1.2 inherit;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.12)}',
    '.pill .dim{font-weight:500;color:var(--dim)}',
    '.pill.met{border-color:#00ba7c}',
    '.drawer{position:absolute;left:0;bottom:40px;width:400px;max-width:calc(100vw - 24px);max-height:min(78vh,720px);display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--line);border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.22);overflow:hidden}',
    '.head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px 6px;font-weight:700}',
    '.x{border:0;background:transparent;color:var(--dim);font:inherit;font-size:18px;cursor:pointer;line-height:1}',
    '.tabs{display:flex;gap:2px;padding:0 8px;border-bottom:1px solid var(--line);overflow-x:auto}',
    '.tab{border:0;background:transparent;color:var(--dim);font:600 12px/1 inherit;padding:9px 8px;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap}',
    '.tab[aria-selected="true"]{color:var(--fg);border-bottom-color:var(--acc)}',
    '.body{overflow:auto;padding:10px 12px 14px}',
    '.note{color:var(--dim);font-size:12px;margin:4px 0 10px}',
    '.card{border:1px solid var(--line);border-radius:12px;padding:9px 10px;margin:0 0 8px}',
    '.row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
    '.who{font-weight:700}',
    '.dim{color:var(--dim)}',
    '.txt{margin:5px 0 7px;white-space:pre-wrap;word-break:break-word;max-height:4.2em;overflow:hidden}',
    '.chip{display:inline-block;padding:1px 7px;border-radius:9px;background:var(--chip);font-size:11px;font-weight:600}',
    '.chip.hot{background:var(--hot);color:var(--hotfg)}',
    '.chip.good{background:rgba(0,186,124,.18)}',
    '.score{margin-left:auto;font-weight:800;font-size:15px}',
    'button.b{font:600 12px/1 inherit;color:var(--fg);background:transparent;border:1px solid var(--line);border-radius:999px;padding:5px 11px;cursor:pointer}',
    'button.b.primary{background:var(--fg);color:var(--bg);border-color:var(--fg)}',
    'button.b:disabled{opacity:.5;cursor:default}',
    'a{color:var(--acc);text-decoration:none}',
    'table{width:100%;border-collapse:collapse;font-size:12px}',
    'th,td{text-align:left;padding:5px 4px;border-bottom:1px solid var(--line);vertical-align:top}',
    'th{color:var(--dim);font-weight:600}',
    'td.n,th.n{text-align:right}',
    'tr.click{cursor:pointer}',
    'tr.click:hover td{background:var(--chip)}',
    'h3{font-size:13px;margin:12px 0 6px}',
    '.big{font-size:22px;font-weight:800}',
    '.bar{height:6px;border-radius:3px;background:var(--chip);overflow:hidden;margin:3px 0 8px}',
    '.bar i{display:block;height:100%;background:#00ba7c}',
    '.grid{display:grid;grid-auto-flow:column;grid-template-rows:repeat(7,12px);gap:3px;margin:6px 0}',
    '.cell{width:12px;height:12px;border-radius:2px;background:var(--chip)}',
    '.l1{background:rgba(0,186,124,.25)}.l2{background:rgba(0,186,124,.45)}.l3{background:rgba(0,186,124,.65)}.l4{background:#00ba7c}',
    '.today{outline:1.5px solid var(--fg)}',
    'input[type=number]{width:54px}',
    'input,textarea,select{font:inherit;color:var(--fg);background:transparent;border:1px solid var(--line);border-radius:8px;padding:4px 7px}',
    'textarea{width:100%;min-height:70px;resize:vertical}',
    'label{display:inline-flex;align-items:center;gap:6px}',
    '.angles{margin-top:8px;border-top:1px dashed var(--line);padding-top:7px}',
    '.angles p{margin:4px 0}'
  ].join('\n');
  shadow.appendChild(styleEl);
  var wrap = document.createElement('div');
  wrap.className = 'wrap';
  shadow.appendChild(wrap);

  var ui = { open: false, tab: null, person: null, angles: {}, llm: null, filter: '' };
  try { var u = JSON.parse(sessionStorage.getItem('oo-x-growth') || '{}'); ui.open = !!u.open; ui.tab = u.tab || null; } catch (e) { /* defaults */ }
  function keepUi() { try { sessionStorage.setItem('oo-x-growth', JSON.stringify({ open: ui.open, tab: ui.tab })); } catch (e) { /* private mode */ } }

  function h(tag, attrs) {
    var el = document.createElement(tag);
    for (var k in attrs || {}) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'text') el.textContent = v;
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      (Array.isArray(c) ? c : [c]).forEach(function (x) { if (x != null && x !== false) el.appendChild(typeof x === 'string' || typeof x === 'number' ? document.createTextNode(String(x)) : x); });
    }
    return el;
  }
  function fmt(n) {
    if (n == null) return '–';
    var a = Math.abs(n);
    return a >= 1e6 ? (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M' : a >= 1e4 ? Math.round(n / 1e3) + 'K' : a >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n));
  }
  function ago(ts) {
    if (!ts) return '–';
    var m = Math.round((Date.now() - ts) / 60000);
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago';
  }
  function handleOf(id) { return '@' + String(id || '').replace(/^x\//, ''); }
  function theme() {
    var bg = getComputedStyle(document.body || document.documentElement).backgroundColor || '';
    var m = bg.match(/\d+/g);
    if (!m) return '';
    var lum = (+m[0] * 299 + +m[1] * 587 + +m[2] * 114) / 1000;
    return lum < 10 ? 'dark black' : lum < 128 ? 'dark' : '';
  }

  function tabsOn() {
    var t = [];
    if (on('x.replyFeed')) t.push(['replies', 'Reply now']);
    if (on('x.crm')) { t.push(['roi', 'Reply ROI']); t.push(['people', 'People']); }
    if (on('x.consistency')) t.push(['today', 'Today']);
    if (on('x.niche')) { t.push(['niche', 'Niche']); t.push(['search', 'Searches']); }
    return t;
  }

  var renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    setTimeout(function () { renderQueued = false; try { render(); } catch (e) { console.warn('[OpenOutlier] growth render failed', e); } }, 300);
  }

  function render() {
    if (!anyOn() || !on('x.collect')) { if (host.isConnected) host.remove(); return; }
    if (!host.isConnected) (document.body || document.documentElement).appendChild(host);
    detectMe();
    wrap.className = 'wrap ' + theme();
    // Keep focus and typing in an open editor (the CRM note) by skipping re-renders while it has focus.
    var act = shadow.activeElement;
    if (act && /^(TEXTAREA|INPUT|SELECT)$/.test(act.tagName)) return;
    wrap.textContent = '';
    wrap.appendChild(pill());
    if (!ui.open) return;
    var tabs = tabsOn();
    if (!tabs.some(function (t) { return t[0] === ui.tab; })) ui.tab = tabs.length ? tabs[0][0] : null;
    var body = h('div', { class: 'body' });
    var d = h('div', { class: 'drawer', role: 'dialog', 'aria-label': 'OpenOutlier growth' },
      h('div', { class: 'head' }, h('span', null, 'OpenOutlier · Growth'), h('button', { class: 'x', 'aria-label': 'Close', onclick: function () { ui.open = false; keepUi(); render(); } }, '×')),
      h('div', { class: 'tabs', role: 'tablist' }, tabs.map(function (t) {
        return h('button', { class: 'tab', role: 'tab', 'aria-selected': ui.tab === t[0] ? 'true' : 'false', onclick: function () { ui.tab = t[0]; ui.person = null; keepUi(); render(); } }, t[1]);
      })),
      body);
    var view = { replies: viewReplies, roi: viewRoi, people: viewPeople, today: viewToday, niche: viewNiche, search: viewSearch }[ui.tab];
    if (view) body.appendChild(view());
    wrap.appendChild(d);
  }

  function pill() {
    var label = [h('span', null, 'OpenOutlier')];
    var met = false;
    if (on('x.consistency') && st.me) {
      var c = consistencyData();
      met = c.today.met;
      label.push(h('span', { class: 'dim' }, c.today.posts + '/' + c.goals.posts + ' posts · ' + c.today.replies + '/' + c.goals.replies + ' replies' + (c.streak ? ' · ' + c.streak + 'd streak' : '')));
    } else if (on('x.replyFeed')) {
      var n = opportunities().length;
      label.push(h('span', { class: 'dim' }, n ? n + ' to reply to' : 'Growth'));
    }
    return h('button', { class: 'pill' + (met ? ' met' : ''), title: 'OpenOutlier growth: reply opportunities, reply ROI, goals', onclick: function () { ui.open = !ui.open; if (ui.open) checkLlm(); keepUi(); render(); } }, label);
  }

  // ---- Reply now -------------------------------------------------------------------------------------------
  function viewReplies() {
    var out = h('div');
    var mem = members();
    var src = st.src || {};
    var lists = Object.keys(src.lists || {}).sort(function (a, b) { return src.lists[b].seenAt - src.lists[a].seenAt; });
    var where = lists.length ? 'your list (read ' + ago(src.lists[lists[0]].seenAt) + ')' : src.followingAt ? 'Home → Following (read ' + ago(src.followingAt) + ')' :
      src.communityAt ? 'a community tab (read ' + ago(src.communityAt) + ')' : null;
    out.appendChild(h('p', { class: 'note' },
      (mem ? 'Niche: ' + Object.keys(mem).length + ' accounts in your X niche folder. ' : 'No X niche folder yet: showing accounts you follow. ') +
      (where ? 'Source: ' + where + '. ' : 'Open your niche list (x.com/i/lists/…) or Home → Following to fill this feed. ') +
      'Originals from the last ' + G.C.WINDOW_MIN + ' minutes.'));
    var ops = opportunities();
    if (!ops.length) { out.appendChild(h('p', { class: 'dim' }, 'Nothing fresh right now. New posts appear here as x.com loads them.')); return out; }
    ops.forEach(function (o) { out.appendChild(opCard(o)); });
    out.appendChild(h('p', { class: 'note' }, '×pace = views so far ÷ what this author\'s posts usually have at the same age (≈: their median spread over a typical ' + (G.C.TYPICAL_LIFETIME_MIN / 60) + '-hour lifetime, until OpenOutlier has seen enough of their posts young). Score adds fewer replies, a mutual follow and an author 1–30× your size. "Open" opens the post and puts the cursor in the reply box; you write and send.'));
    return out;
  }
  function opCard(o) {
    var p = o.post;
    var chips = [];
    if (o.velocity != null) chips.push(h('span', { class: 'chip' + (o.velocity >= 2 ? ' hot' : ''), title: o.velocityBasis === 'history' ? 'vs ' + o.historyPosts + ' of their posts at the same age' : 'vs their median over a typical lifetime (estimate)' }, (o.velocityBasis === 'lifetime' ? '≈' : '') + o.velocity + '× pace'));
    chips.push(h('span', { class: 'chip' }, fmt(p.comments || 0) + ' replies'));
    if (o.mutual === 'mutual') chips.push(h('span', { class: 'chip good' }, 'mutual'));
    if (o.mutual === 'follows_you') chips.push(h('span', { class: 'chip good' }, 'follows you'));
    if (o.coldStart) chips.push(h('span', { class: 'chip', title: 'X boosts originals from ≤50K-follower authors in their first 2 hours while under 200 impressions' }, 'cold start'));
    if (o.replied) chips.push(h('span', { class: 'chip' }, 'replied'));
    var card = h('div', { class: 'card' },
      h('div', { class: 'row' }, h('span', { class: 'who' }, '@' + p.author), h('span', { class: 'dim' }, o.ageMin + ' min · ' + fmt(p.views) + ' views · ' + fmt(p.ownerFollowers) + ' followers'),
        h('span', { class: 'score', title: 'Opportunity score (0–100)' }, String(o.score))),
      h('div', { class: 'txt' }, p.caption || ''),
      h('div', { class: 'row' }, chips),
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { class: 'b primary', onclick: function () { openPost(p); } }, 'Open'),
        ui.llm && ui.llm.ready ? h('button', { class: 'b', onclick: function () { askAngles(o); } }, 'Reply angles') : null));
    var a = ui.angles[p.code];
    if (a) card.appendChild(anglesBox(o, a));
    return card;
  }

  // PHASE 5 HOOK (replyAngles): uses the x-llm service worker (docs/x-llm-notes.md) when it is set up
  // (asked again each time the drawer opens, so turning the helper on needs no reload). prepare → the preview and cost are shown → the user sends → angles are listed (never typed into X).
  function checkLlm() {
    try {
      chrome.runtime.sendMessage({ type: 'reelscope:x-llm-status' }).then(function (r) {
        ui.llm = r && r.ok ? r : null;
        scheduleRender();
      }, function () { ui.llm = null; });
    } catch (e) { ui.llm = null; }
  }
  function askAngles(o) {
    ui.angles[o.post.code] = { state: 'preparing' };
    render();
    chrome.runtime.sendMessage({ type: 'reelscope:x-llm-prepare', task: 'replyAngles', input: G.angleInput(o) }).then(function (r) {
      ui.angles[o.post.code] = r && r.ok ? { state: 'preview', prep: r } : { state: 'error', error: (r && r.error) || 'The LLM helper did not answer.' };
      render();
    }, function (e) { ui.angles[o.post.code] = { state: 'error', error: String(e && e.message || e) }; render(); });
  }
  function anglesBox(o, a) {
    var box = h('div', { class: 'angles' });
    if (a.state === 'preparing' || a.state === 'sending') box.appendChild(h('p', { class: 'dim' }, a.state === 'preparing' ? 'Preparing…' : 'Asking…'));
    if (a.state === 'error') box.appendChild(h('p', { class: 'dim' }, a.error));
    if (a.state === 'preview') {
      var est = a.prep.estimate || {};
      var pv = a.prep.preview || {};
      var sp = a.prep.spend || {};
      var money = function (n) { return n != null && isFinite(n) ? '$' + n.toFixed(4) : '$?'; };
      box.appendChild(h('p', { class: 'dim' }, 'Sends ' + fmt(pv.chars) + ' characters (this post and your voice profile) to ' + (pv.model || 'the model') + '. About ' + money(est.usdTypical) + ', at most ' + money(est.usdMax) + (est.approx ? ' (approximate)' : '') + '. Today: ' + money(sp.todayUsd) + ' of the ' + (sp.capUsd != null ? '$' + Number(sp.capUsd).toFixed(2) : '$?') + ' daily cap.'));
      box.appendChild(h('details', null, h('summary', null, 'The exact text that will be sent'),
        pv.context ? h('pre', { style: 'white-space:pre-wrap;max-height:180px;overflow:auto;font-size:11px' }, pv.context) : null,
        h('pre', { style: 'white-space:pre-wrap;max-height:180px;overflow:auto;font-size:11px' }, pv.message || '')));
      box.appendChild(h('div', { class: 'row' },
        h('button', { class: 'b primary', onclick: function () {
          ui.angles[o.post.code] = { state: 'sending' }; render();
          chrome.runtime.sendMessage({ type: 'reelscope:x-llm-confirm', id: a.prep.id }).then(function (r) {
            ui.angles[o.post.code] = r && r.ok ? { state: 'done', angles: (r.result && r.result.angles) || [], cost: r.cost } : { state: 'error', error: (r && r.error) || 'No answer.' };
            render();
          });
        } }, 'Send'),
        h('button', { class: 'b', onclick: function () { chrome.runtime.sendMessage({ type: 'reelscope:x-llm-cancel', id: a.prep.id }); delete ui.angles[o.post.code]; render(); } }, 'Cancel')));
    }
    if (a.state === 'done') {
      a.angles.forEach(function (x) {
        box.appendChild(h('p', null, h('span', { class: 'chip' }, x.kind), ' ', h('b', null, x.angle), h('br'), h('span', { class: 'dim' }, x.draft), ' ',
          h('button', { class: 'b', onclick: function () { navigator.clipboard.writeText(x.draft).catch(function () {}); } }, 'Copy'),
          replyFillButton(o, x.draft)));
      });
      if (a.cost && a.cost.usd != null) {
        var tk = a.cost.tokens || {};
        box.appendChild(h('p', { class: 'note' }, 'Cost $' + a.cost.usd.toFixed(4) + (a.cost.approx ? ' (approx.)' : '') + ' · ' + fmt(tk.input) + ' in / ' + fmt(tk.output) + ' out tokens. Edit it in your own words before you reply.'));
      }
    }
    return box;
  }

  /** "Put in reply box": only on that post's own page, only when its reply box is there; fills the text, never sends. */
  function replyFillButton(o, text) {
    var F = self.OpenOutlierXFill;
    var c = ctx();
    if (!F || c.kind !== 'status' || c.status !== o.post.code) return null;
    var bx = F.boxes()[0];
    if (!bx) return null;
    var b = h('button', { class: 'b', onclick: function () {
      var ok = F.fill(bx, text);
      b.textContent = ok ? 'In the reply box — edit it, then press Reply yourself' : 'Could not fill the reply box';
    } }, 'Put in reply box');
    return b;
  }

  // ---- Reply ROI ---------------------------------------------------------------------------------------------
  function needMe() {
    return h('p', { class: 'dim' }, 'OpenOutlier could not tell which account is yours yet. It reads it from x.com\'s side menu (the Profile link); open x.com/home once.');
  }
  function viewRoi() {
    var out = h('div');
    if (!st.me) { out.appendChild(needMe()); return out; }
    var r = roiData();
    if (!r.replies.length) {
      out.appendChild(h('p', { class: 'dim' }, 'No replies of yours collected yet. Open ', h('a', { href: 'https://x.com/' + st.me.handle + '/with_replies' }, 'your Replies tab'), ' and scroll a little: OpenOutlier reads the replies x.com loads there. Replies you send from this browser are counted as you send them.'));
      return out;
    }
    out.appendChild(h('p', { class: 'note' }, r.totals.replies + ' replies in 90 days · median ' + fmt(r.totals.median_views) + ' views · the author replied back to ' + r.totals.author_replied + ' of ' + r.totals.author_replied_known + ' known.'));
    out.appendChild(h('h3', null, 'Whose replies grow you'));
    var t = h('table', null, h('tr', null, h('th', null, 'Account'), h('th', { class: 'n' }, 'Replies'), h('th', { class: 'n' }, 'Median views'), h('th', { class: 'n' }, 'Replied back'), h('th', { class: 'n', title: 'Each day\'s follower change shared across that day\'s replies by views: a rough estimate' }, 'Followers ≈')));
    r.accounts.slice(0, 30).forEach(function (a) {
      t.appendChild(h('tr', { class: 'click', onclick: function () { ui.tab = 'people'; ui.person = a.account; keepUi(); render(); } },
        h('td', null, handleOf(a.account), a.mutual ? h('span', { class: 'chip good', style: 'margin-left:4px' }, 'mutual') : null),
        h('td', { class: 'n' }, a.replies), h('td', { class: 'n' }, fmt(a.median_views)),
        h('td', { class: 'n' }, a.author_replied_known ? a.author_replied + '/' + a.author_replied_known : '?'),
        h('td', { class: 'n' }, a.followers_attributed == null ? '–' : (a.followers_attributed > 0 ? '+' : '') + a.followers_attributed)));
    });
    out.appendChild(t);
    out.appendChild(h('h3', null, 'Recent replies'));
    r.replies.slice(0, 15).forEach(function (x) {
      out.appendChild(h('div', { class: 'card' },
        h('div', { class: 'row' }, h('span', { class: 'who' }, 'to ' + handleOf(x.to)), h('span', { class: 'dim' }, ago(x.at) + ' · ' + fmt(x.views) + ' views · ' + fmt(x.likes) + ' likes'),
          h('span', { class: 'chip' + (x.author_replied ? ' good' : '') }, x.author_replied ? 'replied back' : x.author_replied === false ? 'no reply back' : 'reply back: ?')),
        h('div', { class: 'txt' }, x.text), h('a', { href: x.url, target: '_blank', rel: 'noopener' }, 'View')));
    });
    out.appendChild(h('p', { class: 'note' }, r.followers_note + ' "Reply back: ?" means X showed replies to yours that OpenOutlier hasn\'t seen: open the reply to check. X doesn\'t show who liked a reply.'));
    return out;
  }

  // ---- People (CRM) ----------------------------------------------------------------------------------------------
  function viewPeople() {
    if (ui.person) return personPage(ui.person);
    var out = h('div');
    var rows = G.crmTable(st.me ? roiData() : null, st.crm, profilesMap(), members());
    var f = h('input', { type: 'search', placeholder: 'Filter: @name, #tag, note', value: ui.filter, 'aria-label': 'Filter people', oninput: function () { ui.filter = f.value; } , onchange: function () { render(); } });
    out.appendChild(h('div', { class: 'row', style: 'margin-bottom:8px' }, f));
    var q = ui.filter.trim().toLowerCase().replace(/^@/, '');
    rows = rows.filter(function (r) { return !q || r.account.indexOf(q) !== -1 || (r.note || '').toLowerCase().indexOf(q) !== -1 || r.tags.some(function (t) { return '#' + t === q || t === q.replace(/^#/, ''); }); });
    if (!rows.length) { out.appendChild(h('p', { class: 'dim' }, 'People you reply to show up here, with your notes and tags. Notes stay in this browser.')); return out; }
    var t = h('table', null, h('tr', null, h('th', null, 'Account'), h('th', { class: 'n' }, 'Replies'), h('th', { class: 'n' }, 'Back'), h('th', null, 'Last')));
    rows.slice(0, 200).forEach(function (r) {
      t.appendChild(h('tr', { class: 'click', onclick: function () { ui.person = r.account; render(); } },
        h('td', null, handleOf(r.account), r.niche ? h('span', { class: 'chip', style: 'margin-left:4px' }, 'niche') : null, r.tags.length ? h('div', { class: 'dim' }, r.tags.map(function (x) { return '#' + x; }).join(' ')) : null),
        h('td', { class: 'n' }, r.replies), h('td', { class: 'n' }, r.reciprocated_known ? r.reciprocated + '/' + r.reciprocated_known : '–'), h('td', null, ago(r.last_interaction))));
    });
    out.appendChild(t);
    return out;
  }
  function personPage(id) {
    var out = h('div');
    var roi = st.me ? roiData() : { replies: [], accounts: [] };
    var row = G.crmTable(roi, st.crm, profilesMap(), members()).filter(function (r) { return r.account === id; })[0] ||
      { account: id, replies: 0, reciprocated: 0, reciprocated_known: 0, note: '', tags: [], followers: null, mutual: null };
    out.appendChild(h('div', { class: 'row' }, h('button', { class: 'b', onclick: function () { ui.person = null; render(); } }, '← People'),
      h('a', { href: 'https://x.com/' + id.slice(2), target: '_blank', rel: 'noopener' }, 'Profile on x.com')));
    out.appendChild(h('h3', null, (row.name ? row.name + ' ' : '') + handleOf(id)));
    out.appendChild(h('p', { class: 'note' }, [fmt(row.followers) + ' followers', row.mutual ? 'mutual follow' : null, row.replies + ' replies from you',
      row.reciprocated_known ? 'replied back ' + row.reciprocated + '/' + row.reciprocated_known : null, row.median_views != null ? 'median ' + fmt(row.median_views) + ' views' : null,
      row.last_interaction ? 'last ' + ago(row.last_interaction) : null].filter(Boolean).join(' · ')));
    var note = h('textarea', { 'aria-label': 'Note', placeholder: 'A private note (only in this browser)' });
    note.value = row.note || '';
    var msg = h('span', { class: 'dim' });
    out.appendChild(note);
    out.appendChild(h('div', { class: 'row', style: 'margin:6px 0 10px' }, h('button', { class: 'b primary', onclick: function () { saveCrm(id, { note: note.value }).then(function () { msg.textContent = 'Saved.'; }); } }, 'Save note'), msg));
    var tags = h('div', { class: 'row' }, (row.tags || []).map(function (t) {
      return h('span', { class: 'chip' }, '#' + t, ' ', h('button', { class: 'x', style: 'font-size:12px', 'aria-label': 'Remove #' + t, onclick: function () { saveCrm(id, { removeTag: t }).then(render); } }, '×'));
    }));
    var add = h('input', { placeholder: 'Add a tag', 'aria-label': 'Add a tag', onkeydown: function (e) { if (e.key === 'Enter' && add.value.trim()) { var v = add.value; add.value = ''; add.blur(); saveCrm(id, { addTag: v }).then(render); } } });
    tags.appendChild(add);
    out.appendChild(tags);
    var mine = roi.replies.filter(function (r) { return r.to === id; });
    if (mine.length) {
      out.appendChild(h('h3', null, 'Your replies'));
      mine.slice(0, 30).forEach(function (x) {
        out.appendChild(h('div', { class: 'card' }, h('div', { class: 'row' }, h('span', { class: 'dim' }, ago(x.at) + ' · ' + fmt(x.views) + ' views'),
          x.author_replied ? h('span', { class: 'chip good' }, 'replied back') : null), h('div', { class: 'txt' }, x.text), h('a', { href: x.url, target: '_blank', rel: 'noopener' }, 'View')));
      });
    }
    return out;
  }
  async function saveCrm(id, patch) {
    try {
      st.crm = await update(K.crm, function (cur) { return G.crmSet(cur || { accounts: {} }, id, patch, Date.now()); });
    } catch (e) { console.warn('[OpenOutlier] CRM save failed', e); }
  }

  // ---- Today (consistency) -----------------------------------------------------------------------------------------
  function viewToday() {
    var out = h('div');
    if (!st.me) { out.appendChild(needMe()); return out; }
    var c = consistencyData();
    function goal(label, have, want) {
      return h('div', null, h('div', { class: 'row' }, h('b', null, label), h('span', { class: 'dim' }, have + ' / ' + want)),
        h('div', { class: 'bar' }, h('i', { style: 'width:' + (want ? Math.min(100, Math.round(100 * have / want)) : 100) + '%' })));
    }
    out.appendChild(h('div', { class: 'row', style: 'gap:18px;margin-bottom:6px' },
      h('div', null, h('div', { class: 'big' }, String(c.streak)), h('div', { class: 'dim' }, 'day streak')),
      h('div', null, h('div', { class: 'big' }, String(c.best)), h('div', { class: 'dim' }, 'best')),
      h('div', null, h('div', { class: 'big' }, c.week.met + '/' + c.week.days), h('div', { class: 'dim' }, 'days met this week'))));
    out.appendChild(goal('Posts today', c.today.posts, c.goals.posts));
    out.appendChild(goal('Replies today', c.today.replies, c.goals.replies));
    var grid = h('div', { class: 'grid', 'aria-label': 'Last ' + G.C.HEATMAP_WEEKS + ' weeks' });
    c.heatmap.forEach(function (d) {
      grid.appendChild(h('span', { class: 'cell l' + d.level + (d.day === c.today.day ? ' today' : ''), title: d.day + ': ' + d.posts + ' posts, ' + d.replies + ' replies' + (d.met ? ' (goal met)' : '') }));
    });
    out.appendChild(h('h3', null, 'Last ' + G.C.HEATMAP_WEEKS + ' weeks'));
    out.appendChild(grid);
    var gp = h('input', { type: 'number', min: '0', max: '50', value: String(c.goals.posts), 'aria-label': 'Posts per day' });
    var gr = h('input', { type: 'number', min: '0', max: '200', value: String(c.goals.replies), 'aria-label': 'Replies per day' });
    out.appendChild(h('h3', null, 'Daily goals'));
    out.appendChild(h('div', { class: 'row' }, h('label', null, gp, 'posts'), h('label', null, gr, 'replies'),
      h('button', { class: 'b', onclick: function () {
        st.goals = G.goalsOf({ posts: gp.value, replies: gr.value });
        var o = {}; o[K.goals] = st.goals; chrome.storage.local.set(o).then(function () { gp.blur(); gr.blur(); render(); });
      } }, 'Save')));
    out.appendChild(h('p', { class: 'note' }, 'Counted from posts and replies OpenOutlier has seen: the ones you send in this browser, and the ones on your profile\'s Posts and Replies tabs (open them now and then if you also post from your phone). Thread parts and reposts don\'t count. Days are in this computer\'s time zone.'));
    return out;
  }

  // ---- Niche ----------------------------------------------------------------------------------------------------------
  function viewNiche() {
    var out = h('div');
    var org = st.org || { folders: [], accounts: {} };
    var marked = G.nicheFolders(org);
    var mem = members();
    out.appendChild(h('p', { class: 'note' }, 'Mark the Library folders that hold your X niche. Their accounts feed "Reply now". Make an X list with the same accounts and keep its tab open (or use Home → Following): OpenOutlier reads what the tab loads; it never creates lists or follows anyone.'));
    var folders = (org.folders || []);
    if (!folders.length) out.appendChild(h('p', { class: 'dim' }, 'No Library folders yet. Make one in the Library (Accounts), then mark it here.'));
    folders.forEach(function (f) {
      var n = Object.keys(org.accounts || {}).filter(function (id) { return X.isXId(id) && org.accounts[id].folder === f.id; }).length;
      var box = h('input', { type: 'checkbox', checked: marked.indexOf(f.id) !== -1, onchange: function () {
        update(K.org, function (cur) { return G.setNicheFolder(cur || org, f.id, box.checked); }).then(function (o) { st.org = o; render(); });
      } });
      out.appendChild(h('div', null, h('label', null, box, f.name, h('span', { class: 'dim' }, n + ' X accounts'))));
    });
    var src = st.src || {};
    var lists = Object.keys(src.lists || {});
    out.appendChild(h('h3', null, 'Sources'));
    if (!lists.length && !src.followingAt && !src.communityAt) out.appendChild(h('p', { class: 'dim' }, 'Nothing read yet. Open your list (x.com/i/lists/…), Home → Following or a community tab.'));
    lists.forEach(function (id) {
      var l = src.lists[id];
      var missing = G.listAuthorsMissing(src, id, mem);
      var line = h('div', { class: 'card' }, h('div', { class: 'row' }, h('a', { href: 'https://x.com/i/lists/' + id }, 'List ' + id), h('span', { class: 'dim' }, 'read ' + ago(l.seenAt) + ' · ' + l.authors.length + ' authors seen')));
      if (missing.length && marked.length) {
        var sel = h('select', { 'aria-label': 'Folder' }, marked.map(function (fid) { var f = folders.filter(function (x) { return x.id === fid; })[0]; return h('option', { value: fid }, f ? f.name : fid); }));
        line.appendChild(h('div', { class: 'row', style: 'margin-top:6px' }, h('span', { class: 'dim' }, missing.length + ' list authors aren\'t in the niche folder.'), sel,
          h('button', { class: 'b', onclick: function () { addToFolder(missing, sel.value).then(render); } }, 'Add them')));
      }
      out.appendChild(line);
    });
    if (src.followingAt) out.appendChild(h('p', { class: 'dim' }, 'Home → Following read ' + ago(src.followingAt) + '.'));
    out.appendChild(h('h3', null, 'Refresh the list tab'));
    var rf = h('input', { type: 'checkbox', checked: on('x.nicheRefresh'), onchange: function () { if (FT && FT.set) FT.set('x.nicheRefresh', rf.checked).then(render, render); } });
    out.appendChild(h('label', null, rf, 'Reload an open list tab every ' + G.C.REFRESH_EVERY_MIN + ' minutes'));
    out.appendChild(h('p', { class: 'note' }, 'Off by default. It reloads the page like pressing F5 (x.com\'s own request), never while you type or within ' + G.C.REFRESH_IDLE_MIN + ' minutes of your last click or key press.'));
    return out;
  }
  /** Put list authors into a niche folder: an (empty) Library account each, so their posts are kept from now on. */
  async function addToFolder(ids, folderId) {
    var now = Date.now();
    var keys = ids.map(function (id) { return 'rs:p:' + id; });
    var have = await chrome.storage.local.get(keys);
    var batch = {};
    ids.forEach(function (id) {
      if (have['rs:p:' + id]) return;
      var posts = {};
      Object.keys(st.feed.posts || {}).forEach(function (k) { if (st.feed.posts[k].owner === id) posts[k] = st.feed.posts[k]; });
      batch['rs:p:' + id] = { posts: posts, updatedAt: now, platform: 'x' };
    });
    if (Object.keys(batch).length) await chrome.storage.local.set(batch);
    st.org = await update(K.org, function (cur) {
      var o = JSON.parse(JSON.stringify(cur || { folders: [], accounts: {} }));
      o.accounts = o.accounts || {};
      ids.forEach(function (id) { var e = o.accounts[id] || { folder: null, tags: [] }; e.folder = folderId; o.accounts[id] = e; });
      return o;
    });
  }

  // ---- Saved searches --------------------------------------------------------------------------------------------------
  function viewSearch() {
    var out = h('div');
    var cur = G.searchFromUrl(location.href);
    if (cur) {
      var saved = G.findSearch(st.searches, cur.q);
      out.appendChild(h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', null, cur.q),
        saved ? h('span', { class: 'chip good' }, 'saved') : h('button', { class: 'b primary', onclick: function () {
          update(K.searches, function (s) { return G.saveSearch(s || { items: [] }, cur.q, Date.now(), null, cur.f); }).then(function (s) { st.searches = s; recordOpenSearch(); render(); }, function (e) { console.warn('[OpenOutlier] could not save the search', e); });
        } }, 'Save this search'))));
    } else out.appendChild(h('p', { class: 'note' }, 'Search on x.com (Latest works best), then save the search here. Its results are ranked by × their author\'s median whenever you open it again; nothing runs in the background.'));
    var items = (st.searches && st.searches.items) || [];
    items.forEach(function (s) {
      var card = h('div', { class: 'card' }, h('div', { class: 'row' }, h('a', { href: G.searchUrl(s.q, s.f) }, s.label || s.q), h('span', { class: 'dim' }, s.lastOpenedAt ? 'opened ' + ago(s.lastOpenedAt) : 'not opened yet'),
        h('button', { class: 'x', style: 'margin-left:auto', 'aria-label': 'Remove', title: 'Remove', onclick: function () {
          update(K.searches, function (x) { return G.removeSearch(x, s.id); }).then(function (x) { st.searches = x; render(); });
        } }, '×')));
      (s.results || []).slice(0, 8).forEach(function (p) {
        card.appendChild(h('div', { class: 'row', style: 'margin-top:5px' },
          p.ratio != null ? h('span', { class: 'chip' + (p.outlier ? ' hot' : '') }, (p.approx ? '≈' : '') + p.ratio + '×') : h('span', { class: 'chip' }, '–'),
          h('a', { href: p.url, target: '_blank', rel: 'noopener' }, '@' + p.author), h('span', { class: 'dim' }, fmt(p.views) + ' views · ' + ago(p.takenAt)),
          h('div', { class: 'txt', style: 'width:100%;margin:2px 0 0' }, p.caption || '')));
      });
      out.appendChild(card);
    });
    return out;
  }

  // ---- navigation ----------------------------------------------------------------------------------------------------
  var lastPath = location.pathname + location.search;
  function onNav() {
    var p = location.pathname + location.search;
    if (p === lastPath) return;
    lastPath = p;
    var q = G.searchFromUrl(location.href);
    if (!q || q.q !== searchPage.q) searchPage = { q: q ? q.q : null, posts: {} };
    focusReplyIfAsked();
    scheduleRender();
  }
  window.addEventListener('message', function (e) { if (e.source === window && e.data && e.data.__reelscope === 1 && e.data.type === 'nav') onNav(); });
  window.addEventListener('popstate', onNav);
  setInterval(onNav, 1000);
  setInterval(scheduleRender, 60000); // ages and the 120-minute window move on
  if (FT) FT.onChange(function (changed) { if (changed.some(function (k) { return /^x\./.test(k); })) { if (on('x.crm') || on('x.consistency')) ensureMeAccount(); checkLlm(); scheduleRender(); } });

  checkLlm();
  detectMe();
  ensureMeAccount();
  focusReplyIfAsked();
  scheduleRender();
})();
