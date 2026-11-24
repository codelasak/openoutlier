// OpenOutlier – content script for x.com (isolated world). docs/x-plan.md section 2 (Phase 1).
//
// Read-only, from the user's own tab. x.com's own GraphQL responses are forwarded by
// src/hook.js (page world) and parsed by src/x.js. OpenOutlier never sends a request to X,
// never replays X's, and never posts, replies, reposts, likes, follows or sends messages.
// Auto-scroll only scrolls the page, slowly: at least 3 s between pages, and it stops at
// 6 months / 300 posts, when x-rate-limit-remaining drops under 20, or on a 429.
//
// What is saved (chrome.storage.local):
//   rs:p:x/<handle> = { posts: { <rest_id>: post }, updatedAt, platform: 'x', profile }
//     posts of: the profile being viewed, the author of an open post page, and accounts already in
//     the Library (so a niche account's posts on Home, lists and search are kept too). Everyone
//     else's posts stay in memory, only for the timeline badges. An account keeps its id when its
//     handle changes: posts are matched to it by the author's rest_id (profile.restId).
//   rs:x:raw:<operation> = { savedAt, url, data, vars } — the latest accountOverviewDailyQuery and
//     contentPageQuery responses, raw, for Phase 2 (own account, Original Content Rewards).
//   rs:x:rate = { <operation>: { limit, remaining, reset, status, at } } — the last rate-limit headers.
(async function () {
  'use strict';
  if (window.top !== window || window.__openoutlierX) return;
  window.__openoutlierX = true;

  var X = self.OpenOutlierX;
  var M = self.ReelScopeMetrics;
  var P = self.ReelScopePanel;
  var FT = self.OpenOutlierFeatures;
  var SW = self.OpenOutlierSwipe;
  var KEY_PREFIX = 'rs:p:';
  var RAW_PREFIX = 'rs:x:raw:';
  var RATE_KEY = 'rs:x:rate';
  var MIN_POSTS = 5;
  // Auto-scroll limits (plan 2.2 and the Faz 0 notes).
  var AUTO = { minDelay: 3000, jitter: 2000, maxPosts: 300, maxAgeMs: 182 * 864e5, minRemaining: 20, staleTicks: 6 };
  var PAGE_CAP = 4000; // posts kept in memory for badges

  /** account id ("x/name") -> { id -> post } */
  var accounts = {};
  var profiles = {};   // account id -> profile (user facts)
  var byRestId = {};   // author rest_id -> account id (survives handle changes)
  var pagePosts = {};  // id -> post, everything seen on this tab (badges)
  var pageOrder = [];
  var dirty = {};
  var selected = null;
  var rate = {};       // operation -> last rate-limit info
  var auto = { running: false, timer: null, stale: 0, last: 0, label: '', done: null, seen: {}, stopReason: null };
  var libBase = null;  // cached xBaselines over the Library (exact)
  var pageBase = null; // cached xBaselines over the page's posts (approximate)

  try { await FT.ready; } catch (e) { /* defaults */ }
  function on(id) { return FT.isOn(id); }

  function isXKey(k) { return k.indexOf(KEY_PREFIX) === 0 && X.isXId(k.slice(KEY_PREFIX.length)); }

  // ---- storage --------------------------------------------------------------
  try {
    var saved = await chrome.storage.local.get(null);
    Object.keys(saved).forEach(function (k) {
      if (!isXKey(k) || !saved[k] || !saved[k].posts) return;
      var id = k.slice(KEY_PREFIX.length);
      accounts[id] = saved[k].posts;
      if (saved[k].profile) profiles[id] = saved[k].profile;
      indexAccount(id);
    });
    if (saved[RATE_KEY]) rate = saved[RATE_KEY];
  } catch (e) { /* storage unavailable: run in memory */ }

  function indexAccount(id) {
    var prof = profiles[id];
    if (prof && prof.restId) byRestId[prof.restId] = id;
    var posts = accounts[id] || {};
    for (var k in posts) { var p = posts[k]; if (p.ownerId && p.kind !== 'repost' && !byRestId[p.ownerId]) byRestId[p.ownerId] = id; }
  }

  function record(id) {
    var r = { posts: accounts[id], updatedAt: Date.now(), platform: 'x' };
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
      if (rec && rec.posts) accounts[id] = X.mergePostMaps(rec.posts, accounts[id]);
      if (rec && rec.profile) profiles[id] = X.mergeProfile(rec.profile, profiles[id]);
      batch[KEY_PREFIX + id] = record(id);
    });
    await chrome.storage.local.set(batch);
  }
  function saveNow() {
    saving = saving.then(writeDirty).catch(function (e) { console.warn('[OpenOutlier] save failed', e); });
    return saving;
  }
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 1500); }
  async function flushSave() { clearTimeout(saveTimer); await saveNow(); }

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    var changed = false;
    Object.keys(changes).forEach(function (k) {
      if (!isXKey(k)) return;
      var id = k.slice(KEY_PREFIX.length);
      var nv = changes[k].newValue;
      if (!nv) { delete accounts[id]; delete profiles[id]; changed = true; return; }
      if (nv.posts) { accounts[id] = accounts[id] ? X.mergePostMaps(accounts[id], nv.posts) : nv.posts; changed = true; }
      if (nv.profile) profiles[id] = X.mergeProfile(profiles[id], nv.profile);
      indexAccount(id);
    });
    if (changed) { libBase = null; scheduleRender(); scheduleBadges(); }
  });

  // ---- page context ---------------------------------------------------------
  function ctx() { return X.pageContext(location.pathname); }
  /** The account id a profile / post page is about (the stored id when the handle was renamed). */
  function ctxAccount() {
    var c = ctx();
    if (!c.id) return null;
    var prof = Object.keys(profiles).filter(function (k) { return profiles[k].handle && profiles[k].handle.toLowerCase() === c.handle.toLowerCase(); })[0];
    return prof || c.id;
  }

  function findPost(id) {
    if (pagePosts[id]) return pagePosts[id];
    for (var a in accounts) if (accounts[a][id]) return accounts[a][id];
    return null;
  }
  function countFor(id) { return id && accounts[id] ? Object.keys(accounts[id]).length : 0; }

  function accountList() {
    var keep = [ctxAccount(), selected];
    return Object.keys(accounts)
      .map(function (id) { return { username: id, count: Object.keys(accounts[id]).length }; })
      .filter(function (a) { return a.count >= MIN_POSTS || (a.count > 0 && keep.indexOf(a.username) !== -1); })
      .sort(function (a, b) { return b.count - a.count; });
  }
  function currentAccount() {
    if (selected && accounts[selected]) return selected;
    var id = ctxAccount();
    if (id && countFor(id)) return id;
    var c = ctx();
    var viewing = c.status && findPost(c.status);
    if (viewing && accounts[viewing.owner]) return viewing.owner;
    var list = accountList();
    return list.length ? list[0].username : null;
  }

  // ---- ingest ---------------------------------------------------------------
  function sig(p) { var o = Object.assign({}, p); delete o.seenAt; return JSON.stringify(o); }

  /** Where a post is saved: an account already in the Library (by rest_id, then id), or the page's own profile / post author. */
  function storeIdFor(p, c) {
    if (p.ownerId && byRestId[p.ownerId]) return byRestId[p.ownerId];
    if (accounts[p.owner]) return p.owner;
    if (c.id && c.id === p.owner) return p.owner;
    return null;
  }

  function remember(p) {
    if (!pagePosts[p.code]) pageOrder.push(p.code);
    pagePosts[p.code] = X.merge(pagePosts[p.code], p);
    if (pageOrder.length > PAGE_CAP) pageOrder.splice(0, pageOrder.length - PAGE_CAP).forEach(function (k) { delete pagePosts[k]; });
  }

  function ingest(res) {
    var c = ctx();
    var collect = on('x.collect');
    var touched = {};
    (res.posts || []).forEach(function (p) {
      remember(p);
      if (!collect) return;
      var id = storeIdFor(p, c);
      if (!id) return;
      if (id !== p.owner) p = Object.assign({}, p, { owner: id });
      var bucket = accounts[id] || (accounts[id] = {});
      var before = bucket[p.code] ? sig(bucket[p.code]) : null;
      bucket[p.code] = X.merge(bucket[p.code], p);
      if (before !== sig(bucket[p.code])) { dirty[id] = true; touched[id] = true; }
      if (p.ownerId && p.kind !== 'repost' && !byRestId[p.ownerId]) byRestId[p.ownerId] = id;
      if (auto.running && id === auto.account) auto.seen[p.code] = p;
    });
    // A thread root seen before its parts (or after): link them inside the stored account.
    Object.keys(touched).forEach(function (id) { X.linkThreads(Object.values(accounts[id])); });
    if (collect) {
      (res.users || []).forEach(function (u) {
        var id = (u.restId && byRestId[u.restId]) || (accounts[u.id] ? u.id : null) || (c.id === u.id ? u.id : null);
        if (!id) return;
        profiles[id] = X.mergeProfile(profiles[id], Object.assign({}, u, { id: id, seenAt: Date.now() }));
        if (u.restId) byRestId[u.restId] = id;
        if (!accounts[id]) accounts[id] = {};
        dirty[id] = true;
      });
    }
    if (Object.keys(dirty).length) { libBase = null; scheduleSave(); }
    pageBase = null;
    scheduleRender();
    scheduleBadges();
  }

  function saveRaw(op, url, data) {
    if (!on('x.collect')) return;
    var o = {};
    o[RAW_PREFIX + op] = { savedAt: Date.now(), url: String(url).split('?')[0], data: data, vars: varsOf(url) };
    chrome.storage.local.set(o).catch(function () {});
  }

  /** The request's GraphQL variables (Phase 2 reads the analytics range from them), or null. */
  function varsOf(url) {
    try { var v = new URL(url, location.origin).searchParams.get('variables'); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }

  var rateTimer = null;
  function noteRate(msg) {
    var op = X.opOf(msg.url) || 'unknown';
    var rl = X.rateLimit(msg.rateLimit) || {};
    rate[op] = { limit: rl.limit, remaining: rl.remaining, reset: rl.reset, status: msg.status || 200, at: Date.now() };
    clearTimeout(rateTimer);
    rateTimer = setTimeout(function () { var o = {}; o[RATE_KEY] = rate; chrome.storage.local.set(o).catch(function () {}); }, 2000);
    if (!auto.running) return;
    if (msg.status === 429) { stopAuto('Stopped: X answered "rate limit exceeded".' + resetText(rl.reset), 'rate_limit'); return; }
    if (rl.remaining != null && rl.remaining < AUTO.minRemaining && X.PROFILE_OPS.indexOf(op) !== -1) {
      stopAuto('Stopped: only ' + rl.remaining + ' of ' + (rl.limit || '?') + ' ' + op + ' requests left in this 15-minute window.' + resetText(rl.reset), 'rate_limit');
    }
  }
  function resetText(reset) {
    if (!reset) return '';
    return ' X resets it at ' + new Date(reset).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) + '.';
  }

  // ---- X add-on hooks (Phase 3: src/x-growth-content.js) ------------------------------------
  // An add-on content script pushes { payload(res, msg) } onto self.OpenOutlierXHooks. It sees every
  // parsed response (res is null for operations src/x.js doesn't read, e.g. CreateTweet) and may return
  // a response to ingest instead: the user's annotated replies, a post they just sent. Read-only access
  // to what this tab collected goes through self.OpenOutlierXApi.
  function xHooks(res, msg) {
    (self.OpenOutlierXHooks || []).forEach(function (h) {
      try { var r = h && h.payload ? h.payload(res, msg) : null; if (r) res = r; } catch (err) { console.warn('[OpenOutlier] X hook failed', err); }
    });
    return res;
  }
  self.OpenOutlierXApi = {
    baselines: function () { return baselines(); },
    posts: function (id) { return accounts[id] || null; },
    profile: function (id) { return profiles[id] || null; },
    accountIds: function () { return Object.keys(accounts); },
    accountOf: function (restId) { return byRestId[restId] || null; },
    pagePosts: function () { return pagePosts; },
    flush: function () { return flushSave(); }
  };

  window.addEventListener('message', function (e) {
    if (e.source !== window || !e.data || e.data.__reelscope !== 1) return;
    var d = e.data;
    if (d.type === 'ratelimit') { noteRate(d); return; }
    if (d.type === 'nav') { onNavigate(); return; }
    if (d.type !== 'payload') return;
    try {
      var res = xHooks(X.parsePayload(d.url, d.text), d);
      if (!res) return;
      if (res.raw) { saveRaw(res.op, d.url, res.raw); return; }
      ingest(res);
    } catch (err) { console.warn('[OpenOutlier] X parse failed', err); }
  });

  // ---- auto-scroll (slow, plan 2.2) --------------------------------------------
  function stopAuto(label, reason) {
    auto.running = false;
    clearTimeout(auto.timer);
    auto.label = label || '';
    auto.stopReason = reason || auto.stopReason || 'stopped';
    if (auto.done) { var d = auto.done; auto.done = null; d(); }
    scheduleRender();
  }

  function seenStats() {
    var list = Object.values(auto.seen);
    var oldest = null;
    list.forEach(function (p) { if (!p.pinned && p.takenAt && (oldest === null || p.takenAt < oldest)) oldest = p.takenAt; });
    return { n: list.length, oldest: oldest };
  }

  function tick() {
    if (!auto.running) return;
    var s = seenStats();
    if (s.n > auto.last) { auto.last = s.n; auto.stale = 0; } else auto.stale++;
    var age = s.oldest ? Math.round((Date.now() - s.oldest) / 864e5) : null;
    auto.label = 'Scrolling slowly… ' + s.n + ' posts this run' + (age != null ? ', back to ' + age + ' days ago' : '') + '.';
    scheduleRender();
    if (s.n >= auto.max) { stopAuto('Done: ' + s.n + ' posts (the ' + auto.max + '-post limit).', 'max_posts'); return; }
    if (s.oldest && Date.now() - s.oldest > AUTO.maxAgeMs) { stopAuto('Done: reached posts from 6 months ago (' + s.n + ' posts this run).', 'six_months'); return; }
    if (auto.stale >= AUTO.staleTicks) { stopAuto('Done: X loaded nothing new (' + s.n + ' posts this run). That may be the end of the profile.', 'end'); return; }
    if (auto.deadline && Date.now() > auto.deadline) { stopAuto('Stopped: time is up (' + s.n + ' posts this run).', 'time'); return; }
    // Scroll to the bottom; every few stale ticks nudge up and down so X's loader fires again.
    if (auto.stale > 0 && auto.stale % 3 === 0) { window.scrollBy(0, -900); setTimeout(function () { window.scrollTo(0, document.documentElement.scrollHeight); }, 400); }
    else window.scrollTo(0, document.documentElement.scrollHeight);
    auto.timer = setTimeout(tick, AUTO.minDelay + Math.random() * AUTO.jitter);
  }

  function lowRate() {
    var now = Date.now();
    for (var op in rate) {
      var r = rate[op];
      if (X.PROFILE_OPS.indexOf(op) === -1 || !r || r.reset && r.reset < now) continue;
      if (r.status === 429 || (r.remaining != null && r.remaining < AUTO.minRemaining)) return r;
    }
    return null;
  }

  function startAuto(deadline, max) {
    var low = lowRate();
    if (low) { auto.label = 'X\'s rate limit is low (' + (low.remaining != null ? low.remaining + ' left' : '429') + ').' + resetText(low.reset) + ' Try again after that.'; auto.stopReason = 'rate_limit'; scheduleRender(); if (auto.done) { var d = auto.done; auto.done = null; d(); } return; }
    auto.running = true;
    auto.stale = 0;
    auto.seen = {};
    auto.last = 0;
    auto.stopReason = null;
    auto.account = ctxAccount();
    auto.deadline = deadline || null;
    auto.max = Math.min(max || AUTO.maxPosts, AUTO.maxPosts);
    // Count what is already on the page for this account as seen this run.
    Object.values(pagePosts).forEach(function (p) { if (storeIdFor(p, ctx()) === auto.account) auto.seen[p.code] = p; });
    auto.timer = setTimeout(tick, 600);
    scheduleRender();
  }

  function toggleAuto() {
    if (auto.running) { stopAuto('Stopped.', 'user'); return; }
    if (!on('x.autoscroll')) { auto.label = 'Auto-scroll is off (Library → Settings → Features → X).'; scheduleRender(); return; }
    if (ctx().kind !== 'profile') { auto.label = 'Open a profile first, e.g. x.com/name'; scheduleRender(); return; }
    selected = null;
    startAuto();
  }

  // ---- downloads, swipe file ---------------------------------------------------
  function slim(p) { return { code: p.code, owner: p.owner, platform: 'x', views: p.views, likes: p.likes, comments: p.comments, shares: p.shares, files: p.files, cover: p.thumb }; }
  function downloadPosts(posts, what) { return chrome.runtime.sendMessage({ type: 'reelscope:download', what: what, posts: posts.map(slim) }); }

  async function saveSwipe(p) {
    if (!SW) return { message: 'Swipe file not available.' };
    var r = await chrome.storage.local.get('rs:org');
    var org = r['rs:org'] && Array.isArray(r['rs:org'].folders) ? r['rs:org'] : { folders: [], accounts: {} };
    var scored = scoreOf(p);
    var out = SW.save(org, { platform: 'x', video: p.code, type: p.type, title: p.caption || '', channel: p.ownerName || '@' + p.author, account: X.isXId(p.owner) ? p.owner : null,
      thumb: p.thumb, views: p.views, duration: p.duration, publishedAt: p.takenAt, ratio: scored && scored.ratio != null ? Math.round(scored.ratio * 100) / 100 : null }, Date.now());
    if (!out.item) return { message: 'Could not save this post.' };
    await chrome.storage.local.set({ 'rs:org': out.org });
    return { message: out.added ? 'Saved to the swipe file (Library → Swipe file).' : 'Already in the swipe file: updated.' };
  }

  // ---- scoring for badges ------------------------------------------------------
  function baselines() {
    var now = Date.now();
    if (!libBase) {
      var all = [];
      Object.keys(accounts).forEach(function (id) { var ps = accounts[id]; for (var k in ps) all.push(ps[k]); });
      libBase = M.xBaselines(all, { now: now });
    }
    if (!pageBase) {
      var page = Object.values(pagePosts).filter(function (p) { return !libBase[p.owner] && !(p.ownerId && byRestId[p.ownerId]); });
      pageBase = M.xBaselines(page, { now: now, approx: true });
    }
    var map = Object.assign({}, pageBase);
    Object.keys(libBase).forEach(function (k) { map[k] = libBase[k]; });
    return map;
  }
  function scoreOf(p) {
    if (!p) return null;
    var id = (p.ownerId && byRestId[p.ownerId]) || p.owner;
    var q = id !== p.owner ? Object.assign({}, p, { owner: id }) : p;
    var stored = accounts[id] && accounts[id][p.code];
    if (stored) q = X.merge(stored, q);
    return M.enrich([q], { xBaselines: baselines() })[0];
  }

  // ---- badges and the post-page toolbar (plan 2.2) ---------------------------------
  var STYLE_ID = 'openoutlier-x-style';
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = [
      '.oo-x-badge{display:inline-flex;align-items:center;gap:3px;margin-left:6px;padding:0 6px;height:18px;border-radius:9px;font:600 11px/18px system-ui,-apple-system,sans-serif;',
      'background:rgba(127,127,127,.14);color:inherit;white-space:nowrap;vertical-align:middle;cursor:help;letter-spacing:.01em}',
      '.oo-x-badge.is-hot{background:#d4ff3a;color:#0d0d12}',
      '.oo-x-badge .oo-x-vs{opacity:.7;font-weight:500}',
      '.oo-x-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:10px 0 4px;padding:8px 10px;border-radius:12px;',
      'border:1px solid rgba(127,127,127,.28);font:13px/1.35 system-ui,-apple-system,sans-serif;color:inherit}',
      '.oo-x-bar b{font-size:15px}',
      '.oo-x-bar .oo-x-dim{opacity:.7}',
      '.oo-x-bar button{font:inherit;color:inherit;background:transparent;border:1px solid rgba(127,127,127,.45);border-radius:999px;padding:2px 10px;cursor:pointer}',
      '.oo-x-bar button:hover{background:rgba(127,127,127,.14)}'
    ].join('');
    (document.head || document.documentElement).appendChild(st);
  }

  var FORMAT_NAMES = { text: 'text', image: 'image', video: 'video', thread: 'thread', article: 'article', link: 'link', quote: 'quote' };
  function ratioText(s) { return (s.baselineApprox ? '≈' : '') + (s.ratio >= 10 ? Math.round(s.ratio) : s.ratio.toFixed(1)) + '×'; }
  function badgeTip(s) {
    if (s.noViews) return 'OpenOutlier: X shows no view count on this post (posts before 2023 have none).';
    var who = '@' + (s.author || String(s.owner).slice(2));
    var base = s.baselineScope === 'format' ? who + '\'s median ' + FORMAT_NAMES[s.type] + ' post' : who + '\'s median original post';
    var src = s.baselineApprox ? (s.baselineScope === 'format' ? ' (≈ estimated from the posts loaded on this page)' : ' (≈ fewer than 8 ' + FORMAT_NAMES[s.type] + ' posts to compare with)') : ' (from the Library)';
    return 'OpenOutlier: ' + (s.views != null ? s.views.toLocaleString() + ' views = ' : '') + ratioText(s) + ' ' + base + src + '. Viral Score ' + s.viralScore + ' (50 = median, 75 = 2×, 100 = 4×+).';
  }

  function postIdOfArticle(article) {
    var t = article.querySelector('a[href*="/status/"] time');
    var a = t && t.closest('a');
    if (!a) return null;
    var m = /^\/[A-Za-z0-9_]{1,15}\/status\/(\d{1,25})/.exec(a.pathname || '');
    return m ? m[1] : null;
  }

  function paintArticle(article, focal) {
    var id = postIdOfArticle(article);
    var s = id ? scoreOf(findPost(id)) : null;
    var key = s ? [id, s.ratio, s.viralScore, s.baselineApprox, s.noViews].join('|') : 'none';
    var old = article.querySelector(':scope .oo-x-badge');
    if (article.getAttribute('data-oo-x') === key && (old || !s || (s.ratio == null && !s.noViews))) { if (focal) paintToolbar(article, id, s); return; }
    article.setAttribute('data-oo-x', key);
    if (old) old.remove();
    if (s && (s.ratio != null || (s.noViews && s.kind !== 'repost' && accounts[s.owner]))) {
      var b = document.createElement('span');
      b.className = 'oo-x-badge' + (s.outlier ? ' is-hot' : '');
      b.title = badgeTip(s);
      if (s.ratio != null) {
        b.textContent = ratioText(s);
        var vs = document.createElement('span');
        vs.className = 'oo-x-vs';
        vs.textContent = ' · ' + s.viralScore;
        b.appendChild(vs);
      } else b.textContent = '≈ no data';
      var time = article.querySelector('a[href*="/status/"] time');
      var link = time && time.closest('a');
      if (link && link.parentElement) link.insertAdjacentElement('afterend', b);
    }
    if (focal) paintToolbar(article, id, s);
  }

  function paintToolbar(article, id, s) {
    var bar = article.querySelector(':scope .oo-x-bar');
    var p = id ? findPost(id) : null;
    if (!p) { if (bar) bar.remove(); return; }
    var sig2 = [id, s && s.ratio, p.views].join('|');
    if (bar && bar.getAttribute('data-sig') === sig2) return;
    if (bar) bar.remove();
    bar = document.createElement('div');
    bar.className = 'oo-x-bar';
    bar.setAttribute('data-sig', sig2);
    function span(cls, text, tip) { var e = document.createElement('span'); if (cls) e.className = cls; e.textContent = text; if (tip) e.title = tip; return e; }
    var label = span('', 'OpenOutlier');
    label.style.fontWeight = '600';
    bar.appendChild(label);
    if (s && s.ratio != null) {
      var r = document.createElement('b');
      r.textContent = ratioText(s);
      r.title = badgeTip(s);
      bar.appendChild(r);
      bar.appendChild(span('oo-x-dim', 'Viral Score ' + s.viralScore));
    } else bar.appendChild(span('oo-x-dim', s && s.noViews ? 'no view count on this post' : 'not enough posts from this author to score (needs 8 with views)'));
    bar.appendChild(span('', p.kind === 'original' ? FORMAT_NAMES[p.type] + (p.threadLength ? ' · ' + p.threadLength + ' posts' : '') : p.kind === 'thread-part' ? 'thread part' : p.kind));
    // Early speed: views per hour while the post is young (the velocity the algorithm reacts to).
    var ageH = p.takenAt ? (Date.now() - p.takenAt) / 3600000 : null;
    if (p.views != null && ageH != null && ageH > 0.05 && ageH < 48) {
      var vph = p.views / ageH;
      bar.appendChild(span('oo-x-dim', Math.round(vph).toLocaleString() + ' views/h over its first ' + (ageH < 1 ? Math.round(ageH * 60) + ' min' : Math.round(ageH) + ' h'),
        'Views so far ÷ hours since it was posted' + (accounts[p.owner] ? ' (this account is in the Library)' : '')));
    }
    if (on('x.collect') && SW) {
      var save = document.createElement('button');
      save.type = 'button';
      save.textContent = 'Save to swipe file';
      save.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        save.disabled = true;
        saveSwipe(p).then(function (r) { save.textContent = r.message; }, function () { save.textContent = 'Could not save'; });
      });
      bar.appendChild(save);
    }
    if (on('x.collect')) {
      var open = document.createElement('button');
      open.type = 'button';
      open.textContent = 'Panel';
      open.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); if (accounts[p.owner]) selected = p.owner; if (panel) panel.toggle(true); scheduleRender(); });
      bar.appendChild(open);
    }
    // Below the post's text: after the last direct block of the article's content column.
    var group = article.querySelectorAll('[role="group"]');
    var anchor = group.length ? group[group.length - 1] : null;
    if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(bar, anchor);
    else article.appendChild(bar);
  }

  var badgeQueued = false;
  function scheduleBadges() {
    if (badgeQueued) return;
    badgeQueued = true;
    setTimeout(function () {
      badgeQueued = false;
      if (!on('x.badges')) {
        document.querySelectorAll('.oo-x-badge, .oo-x-bar').forEach(function (e) { e.remove(); });
        document.querySelectorAll('article[data-oo-x]').forEach(function (a) { a.removeAttribute('data-oo-x'); });
        return;
      }
      ensureStyle();
      var c = ctx();
      document.querySelectorAll('article[data-testid="tweet"]').forEach(function (a) {
        try { paintArticle(a, c.kind === 'status' && postIdOfArticle(a) === c.status); } catch (e) { /* one article */ }
      });
    }, 300);
  }
  var observer = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      if (muts[i].addedNodes && muts[i].addedNodes.length) { scheduleBadges(); return; }
    }
  });

  // ---- agent commands (sent by agent-bridge.js from the local MCP server) -----
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function collectX(a) {
    var name = String(a.username || '').replace(/^\/?(x\/|@)/i, '');
    var id = X.xId(name);
    if (!X.isXId(id)) return { ok: false, error: 'Not a valid X handle.' };
    var c = ctx();
    if (c.id !== id) return { ok: false, account: id, error: 'This tab is not on x.com/' + name + '.' };
    if (!on('x.collect')) return { ok: false, account: id, error: 'X collection is turned off (Library → Settings → Features → X).' };
    var acct = ctxAccount();
    var before = countFor(acct);
    for (var i = 0; i < 30 && !Object.values(pagePosts).some(function (p) { return storeIdFor(p, ctx()) === acct; }); i++) await sleep(500);
    var txt = document.body ? document.body.innerText.slice(0, 4000) : '';
    if (!countFor(acct) && /This account doesn.t exist|Bu hesap mevcut değil|Account suspended|Hesap askıya alındı/i.test(txt)) return { ok: false, account: id, error: '@' + name + ' was not found on X (or is suspended).' };
    if (/Sign in to X|X'e giriş yap|Log in|Giriş yap/i.test(txt) && !countFor(acct)) return { ok: false, account: id, error: 'X shows a sign-in page. Log in to x.com in Chrome, then try again.' };
    var max = Math.min(AUTO.maxPosts, a.maxPosts || AUTO.maxPosts);
    if (on('x.autoscroll')) await new Promise(function (resolve) { auto.done = resolve; startAuto(Date.now() + 8 * 60000, max); });
    await flushSave();
    var prof = profiles[acct];
    var r = rate.UserOriginalsTimeline || rate.UserTweets || null;
    return {
      ok: countFor(acct) > 0, account: acct, collected_now: countFor(acct) - before, saved_total: countFor(acct),
      followers: prof && prof.followers != null ? prof.followers : undefined,
      profile_posts: prof && prof.posts != null ? prof.posts : undefined,
      rate_limit: r ? { remaining: r.remaining, limit: r.limit, reset: r.reset ? new Date(r.reset).toISOString() : null } : undefined,
      stopped_because: on('x.autoscroll') ? auto.stopReason : 'autoscroll_off',
      note: 'OpenOutlier scrolled x.com/' + name + ' slowly (≥3 s per page) in a small window and read the posts X loaded; it sent no requests of its own.' +
        (auto.stopReason === 'rate_limit' ? ' It stopped early because X\'s rate limit ran low; try again after the reset time.' : '')
    };
  }

  async function runCommand(cmd) {
    if (cmd.type === 'collect_x') return collectX(cmd.args || {});
    return { ok: false, error: 'This is an x.com tab; it cannot run ' + cmd.type + '.' };
  }

  // ---- UI -------------------------------------------------------------------
  var cssText = '';
  try { cssText = await (await fetch(chrome.runtime.getURL('src/panel.css'))).text(); } catch (e) { /* unstyled */ }
  try { if (self.OpenOutlierBrand) await self.OpenOutlierBrand.load(); } catch (e) { /* text fallbacks */ }

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

  var panel = null;
  function makePanel() {
    panel = P.create({
      cssText: cssText,
      platform: 'x',
      listTabLabel: 'Posts',
      defaultSort: 'viralScore',
      autoTip: function () { return on('x.autoscroll') ? 'Scroll this profile slowly (≥3 s per page) until 6 months, 300 posts or X\'s rate limit runs low' : 'Auto-scroll is off in Settings → Features → X'; },
      onAutoScroll: toggleAuto,
      onSelectProfile: function (id) { selected = id || null; scheduleRender(); },
      onClearProfile: function (id) {
        delete accounts[id];
        delete profiles[id];
        delete dirty[id];
        Object.keys(byRestId).forEach(function (k) { if (byRestId[k] === id) delete byRestId[k]; });
        if (selected === id) selected = null;
        chrome.storage.local.remove(KEY_PREFIX + id);
        libBase = null;
        scheduleRender();
      },
      onDownload: downloadFile,
      onCopy: function (text) { return navigator.clipboard.writeText(text); },
      onDownloadMedia: downloadPosts,
      onSaveSwipe: saveSwipe,
      onOpenDashboard: function () {
        var id = currentAccount();
        chrome.runtime.sendMessage({ type: 'reelscope:open-dashboard', hash: id ? '#/account/' + encodeURIComponent(id) : '' });
      }
    });
  }

  var renderQueued = false;
  function scheduleRender() {
    if (renderQueued || !panel) return;
    renderQueued = true;
    setTimeout(function () {
      renderQueued = false;
      if (!panel) return;
      var id = currentAccount();
      var prof = id && profiles[id];
      panel.update({
        platform: 'x',
        profiles: accountList(),
        selected: id,
        profile: prof || null,
        posts: id && accounts[id] ? Object.values(accounts[id]) : [],
        auto: { running: auto.running, label: auto.label || (prof && prof.posts ? countFor(id) + ' saved · the profile shows ' + prof.posts + ' posts' : '') }
      });
    }, 250);
  }

  function mount() {
    if (!on('x.collect')) { if (panel && panel.host.isConnected) panel.host.remove(); return; }
    if (!panel) makePanel();
    var parent = document.body || document.documentElement;
    if (!panel.host.isConnected) parent.appendChild(panel.host);
  }

  var lastPath = location.pathname;
  function onNavigate() {
    mount();
    if (location.pathname === lastPath) return;
    var prev = X.pageContext(lastPath).id;
    lastPath = location.pathname;
    var c = ctx();
    if (c.id !== prev) selected = null;
    if (auto.running && (c.kind !== 'profile' || c.id !== prev) && !auto.deadline) stopAuto('Stopped: page changed.', 'page_changed');
    scheduleRender();
    scheduleBadges();
  }

  mount();
  scheduleRender();
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  else document.addEventListener('DOMContentLoaded', function () { observer.observe(document.body, { childList: true, subtree: true }); });
  scheduleBadges();
  window.addEventListener('popstate', onNavigate);
  // Fallback for navigation the hook could not see (and re-mounting if X replaces <body>).
  setInterval(onNavigate, 1000);

  FT.onChange(function (changed) {
    if (!changed.some(function (k) { return /^x\./.test(k); })) return;
    if (!on('x.autoscroll') && auto.running) stopAuto('Stopped: auto-scroll was turned off.', 'feature_off');
    mount();
    scheduleRender();
    scheduleBadges();
  });

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg) return;
    if (msg.type === 'reelscope:toggle') {
      if (!on('x.collect')) { sendResponse({ ok: false, error: 'X collection is off' }); return; }
      mount();
      panel.toggle(true);
      sendResponse({ ok: true, profile: currentAccount() });
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
