// OpenOutlier – content script for www.youtube.com (isolated world).
//
// Read-only, from the user's own tab. Two ways in:
//  1. The data YouTube inlines in the first page it serves
//     (<script>var ytInitialData = {…}; / var ytInitialPlayerResponse = {…};).
//     Read once: YouTube is a single-page app and keeps those scripts (with the
//     first page's data) after in-app navigation.
//  2. YouTube's own /youtubei/v1/* responses (browse, get_watch, player, next,
//     reel/*), forwarded by hook.js as the page loads them.
// OpenOutlier makes no YouTube requests of its own. Auto-scroll makes YouTube
// load the next page of a channel's grid by itself.
//
// Storage: rs:p:yt/<handle> = { posts: {id: post}, updatedAt, platform: 'youtube', profile }.
(async function () {
  'use strict';
  if (window.top !== window || window.__openoutlierYouTube) return;
  window.__openoutlierYouTube = true;

  var Y = self.OpenOutlierYouTube;
  var P = self.ReelScopePanel;
  var O = self.ReelScopeOverlay;
  var M = self.ReelScopeMetrics;
  var FT = self.OpenOutlierFeatures; // feature on/off (src/features.js); later phases ask FT.isOn(id) before mounting
  var KEY_PREFIX = 'rs:p:';
  var MIN_POSTS = 5;
  var GRID_TABS = ['videos', 'shorts', 'streams'];

  /** account id ("yt/name") -> { id -> post } */
  var accounts = {};
  var profiles = {};  // account id -> channel facts (subscribers, videos, UC id …)
  var ucMap = {};     // "UC…" -> "yt/handle"
  var dirty = {};
  var selected = null;
  var more = {};      // "<account>|<tab>" -> false once YouTube says the grid has no more pages
  var warning = '';   // shown in the panel when a grid had items but none could be read
  var langNote = '';
  var auto = { running: false, timer: null, stale: 0, last: 0, label: '', done: null, deadline: null, max: null };
  var loadedAt = Date.now(); // records parsed from this page's own data are at least this new

  function isYouTubeKey(k) { return k.indexOf(KEY_PREFIX) === 0 && Y.isYouTubeId(k.slice(KEY_PREFIX.length)); }

  function rememberProfile(id, prof) {
    profiles[id] = prof;
    if (prof && prof.channelId && !/^yt\/UC/.test(id)) ucMap[prof.channelId] = id;
  }

  // ---- storage --------------------------------------------------------------
  try {
    var saved = await chrome.storage.local.get(null);
    Object.keys(saved).forEach(function (k) {
      if (!isYouTubeKey(k) || !saved[k] || !saved[k].posts) return;
      var id = k.slice(KEY_PREFIX.length);
      accounts[id] = saved[k].posts;
      if (saved[k].profile) rememberProfile(id, saved[k].profile);
    });
  } catch (e) { /* storage unavailable: run in memory */ }
  // Saved counts when this page loaded, so an agent command can say how many it added.
  var initialCounts = {};
  Object.keys(accounts).forEach(function (id) { initialCounts[id] = Object.keys(accounts[id]).length; });

  function record(id) {
    var r = { posts: accounts[id], updatedAt: Date.now(), platform: 'youtube' };
    if (profiles[id]) r.profile = profiles[id];
    return r;
  }

  // Saving re-reads the stored records and merges post by post, so a tab with an
  // older copy never overwrites what another tab collected.
  var saveTimer = null;
  var saving = Promise.resolve();
  var removeKeys = [];
  async function writeDirty() {
    var ids = Object.keys(dirty).filter(function (id) { return accounts[id]; });
    dirty = {};
    var drop = removeKeys.splice(0);
    if (drop.length) await chrome.storage.local.remove(drop);
    if (!ids.length) return;
    var stored = await chrome.storage.local.get(ids.map(function (id) { return KEY_PREFIX + id; }));
    var batch = {};
    ids.forEach(function (id) {
      var rec = stored[KEY_PREFIX + id];
      if (rec && rec.posts) accounts[id] = Y.mergePostMaps(rec.posts, accounts[id]);
      if (rec && rec.profile && !profiles[id]) rememberProfile(id, rec.profile);
      batch[KEY_PREFIX + id] = record(id);
    });
    await chrome.storage.local.set(batch);
  }
  function saveNow() {
    saving = saving.then(writeDirty).catch(function (e) { console.warn('[OpenOutlier] save failed', e); });
    return saving;
  }
  function flushSave() { clearTimeout(saveTimer); return saveNow(); }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 1500);
  }

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    var changed = false;
    Object.keys(changes).forEach(function (k) {
      if (!isYouTubeKey(k)) return;
      var id = k.slice(KEY_PREFIX.length);
      var nv = changes[k].newValue;
      if (!nv) { delete accounts[id]; changed = true; return; }
      if (nv.posts) { accounts[id] = accounts[id] ? Y.mergePostMaps(accounts[id], nv.posts) : nv.posts; changed = true; }
    });
    if (changed) scheduleRender();
  });

  // ---- page context ---------------------------------------------------------
  function ctx() { return Y.pageContext(location.pathname, location.search); }

  /** The account a channel page belongs to ("/@name", "/channel/UC…", or the last channel data seen for /c/ and /user/). */
  var lastChannel = null;
  function pageAccount(c) {
    c = c || ctx();
    if (c.kind !== 'channel') return null;
    if (c.channelId) return ucMap[c.channelId] || c.id;
    if (c.id) return c.id;
    return lastChannel ? lastChannel.id : null;
  }

  function findPost(id) {
    for (var a in accounts) if (accounts[a][id]) return accounts[a][id];
    return null;
  }

  function accountList() {
    var c = ctx();
    var keep = [pageAccount(c), selected];
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
    var pa = pageAccount(c);
    if (pa && accounts[pa] && Object.keys(accounts[pa]).length) return pa;
    var viewing = c.video && findPost(c.video);
    if (viewing && accounts[viewing.owner]) return viewing.owner;
    var list = accountList();
    return list.length ? list[0].username : null;
  }

  function countFor(id) { return id && accounts[id] ? Object.keys(accounts[id]).length : 0; }

  // ---- language -------------------------------------------------------------
  /**
   * The language of YouTube's labels. <html lang> follows YouTube's own setting;
   * Turkish words in the data override it (the ambiguous "B" makes that the risky one).
   */
  function langFor(raw) {
    var html = String(document.documentElement.getAttribute('lang') || '');
    var n = Y.normLang(html);
    var d = Y.detectLang(raw);
    if (d === 'tr') return 'tr';
    if (n) return n;
    if (!html) return d || 'en';
    return 'unknown-' + html;
  }

  function noteLang(lang) {
    var next = /^unknown-/.test(lang)
      ? 'YouTube is shown in "' + lang.slice(8) + '". OpenOutlier reads rounded view counts and dates in English and Turkish only, so channel-tab videos are saved without them. Switch YouTube\'s language to English (profile menu → Language) and reload, or open videos for exact counts.'
      : '';
    if (next !== langNote) { langNote = next; scheduleRender(); }
  }

  // ---- ingest ---------------------------------------------------------------
  function sig(p) { var o = Object.assign({}, p); delete o.seenAt; return JSON.stringify(o); }

  /** A channel's handle became known: move posts saved under "yt/UC…" to "yt/<handle>". */
  function adoptChannel(ch) {
    if (!ch || !ch.id) return;
    var prev = profiles[ch.id] || {};
    // A watch page knows fewer facts than the channel page (no video count, description): keep the rest.
    var known = {};
    Object.keys(ch).forEach(function (k) { if (ch[k] != null) known[k] = ch[k]; });
    rememberProfile(ch.id, Object.assign({}, prev, known, { seenAt: Date.now() }));
    if (accounts[ch.id]) dirty[ch.id] = true;
    if (ch.channelId && ch.handle) {
      var old = Y.ytId(ch.channelId);
      if (old !== ch.id && accounts[old]) {
        var bucket = accounts[ch.id] || (accounts[ch.id] = {});
        Object.keys(accounts[old]).forEach(function (code) {
          var p = Object.assign({}, accounts[old][code], { owner: ch.id, author: ch.handle });
          bucket[code] = Y.merge(bucket[code], p);
        });
        delete accounts[old];
        delete profiles[old];
        removeKeys.push(KEY_PREFIX + old);
        dirty[ch.id] = true;
      }
    }
  }

  // Fragments (comment counts from reel_item_watch, /next) that arrived before their video's
  // record: kept briefly and applied when it shows up (on a Short, /player can come second).
  var pending = {};
  var pendingOrder = [];
  function hold(p) {
    if (!pending[p.code]) { pendingOrder.push(p.code); if (pendingOrder.length > 60) delete pending[pendingOrder.shift()]; }
    pending[p.code] = Y.merge(pending[p.code], p);
  }

  function ingest(posts) {
    var added = 0;
    (posts || []).forEach(function (p) {
      if (!p || !p.code) return;
      if (pending[p.code] && p.type) {
        var frag = pending[p.code];
        delete pending[p.code];
        p = Y.merge(p, Object.assign({}, frag, { owner: p.owner, author: p.author, ownerId: p.ownerId }));
      }
      if (p.ownerId && ucMap[p.ownerId] && p.owner !== ucMap[p.ownerId]) {
        p = Object.assign({}, p, { owner: ucMap[p.ownerId] });
        if (!p.author) p.author = (profiles[p.owner] || {}).handle || null;
      }
      var id = p.owner;
      if (!p.type && p.ownerId) {
        // A fragment from another channel than the stored video's: it was matched to the wrong video.
        var mine = findPost(p.code);
        if (mine && mine.ownerId && mine.ownerId !== p.ownerId) return;
      }
      if (!Y.isYouTubeId(id)) {
        // A partial record (no channel in that response): only fills in a video we already have.
        var known = findPost(p.code);
        if (!known) { hold(p); return; }
        id = known.owner;
        p = Object.assign({}, p, { owner: id });
      }
      var bucket = accounts[id] || (accounts[id] = {});
      if (!bucket[p.code]) {
        if (!p.type) { hold(p); return; } // never start a record from a fragment
        added++;
      }
      var before = bucket[p.code] ? sig(bucket[p.code]) : null;
      bucket[p.code] = Y.merge(bucket[p.code], p);
      if (before !== sig(bucket[p.code])) dirty[id] = true;
    });
    if (Object.keys(dirty).length || removeKeys.length) { scheduleSave(); scheduleRender(); }
    return added;
  }

  /** Apply one parse result (page data or a hooked response). */
  function apply(res, c) {
    if (res.channel) { adoptChannel(res.channel); lastChannel = res.channel; }
    var acct = res.channel ? res.channel.id : pageAccount(c);
    var tab = res.tab || c.tab;
    if (acct && tab && res.hasMore !== null && GRID_TABS.indexOf(tab) !== -1) more[acct + '|' + tab] = res.hasMore;
    ingest(res.posts);
    // A grid that had items but gave no videos: YouTube changed its page format.
    if (res.items > 0 && !res.posts.length && (res.kind === 'channel' || res.kind === 'continuation') && pageAccount(c)) {
      warning = 'YouTube showed ' + res.items + ' items here, but OpenOutlier could not read them (YouTube may have changed its page format). Please report this.';
    } else if (res.posts.length && (res.kind === 'channel' || res.kind === 'continuation')) {
      warning = '';
    }
    scheduleRender();
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window || !e.data || e.data.__reelscope !== 1 || e.data.type !== 'payload') return;
    var c = ctx();
    try {
      var lang = langFor(e.data.text);
      noteLang(lang);
      // Continuations don't name the channel: attribute them to the channel page that is open.
      var acct = pageAccount(c);
      var ch = acct && profiles[acct] ? profiles[acct] : (lastChannel && lastChannel.id === acct ? lastChannel : null);
      // The URL's video id only stands in for Shorts responses that don't name their video (reel_item_watch).
      apply(Y.parseText(e.data.text, { lang: lang, channel: ch, tab: c.tab, videoId: c.kind === 'short' ? c.video : null }), c);
    } catch (err) { console.warn('[OpenOutlier] YouTube parse failed', err); }
  });

  /** First load only: the data YouTube inlined into the HTML it served. */
  function scanInline() {
    var parts = [];
    document.querySelectorAll('script:not([src])').forEach(function (el) {
      var t = el.textContent;
      if (t && t.length < 1.2e7 && (t.indexOf('ytInitialData') !== -1 || t.indexOf('ytInitialPlayerResponse') !== -1)) parts.push(t);
    });
    if (!parts.length) return;
    var source = parts.join('\n;\n');
    var c = ctx();
    var lang = langFor(source);
    noteLang(lang);
    try { apply(Y.parsePage(source, { lang: lang, tab: c.tab, videoId: c.video }), c); } catch (err) { console.warn('[OpenOutlier] YouTube page parse failed', err); }
  }

  // ---- auto-scroll (YouTube loads the next page of the grid by itself) --------
  function onGridTab(c) { return c.kind === 'channel' && GRID_TABS.indexOf(c.tab) !== -1; }

  function scrollDown(nudge) {
    if (nudge) window.scrollBy(0, -900);
    setTimeout(function () { window.scrollTo(0, document.documentElement.scrollHeight); }, nudge ? 300 : 0);
  }

  function stopAuto(label) {
    auto.running = false;
    clearTimeout(auto.timer);
    auto.label = label || '';
    if (auto.done) { var d = auto.done; auto.done = null; d(); }
    scheduleRender();
  }

  /** Saved videos of the format a channel tab lists (Shorts tab → Shorts, Live → live, Videos → the rest). */
  function tabCount(id, tab) {
    if (!id || !accounts[id]) return 0;
    var want = tab === 'shorts' ? 'short' : tab === 'streams' ? 'live' : 'video';
    return Object.values(accounts[id]).filter(function (p) { return (p.type === 'short' || p.type === 'live' ? p.type : 'video') === want; }).length;
  }

  function tick() {
    if (!auto.running) return;
    var c = ctx();
    if (!onGridTab(c)) { stopAuto('Stopped: page changed.'); return; }
    var id = pageAccount(c);
    var n = countFor(id);
    if (n > auto.last) { auto.last = n; auto.stale = 0; } else auto.stale++;
    auto.label = 'Scrolling… ' + n + ' collected';
    scheduleRender();
    if (id && more[id + '|' + c.tab] === false) { stopAuto('Done: ' + n + ' collected (end of this tab).'); return; }
    if (auto.stale >= 10 || (auto.deadline && Date.now() > auto.deadline) || (auto.max && tabCount(id, c.tab) >= auto.max)) { stopAuto('Done: ' + n + ' collected.'); return; }
    scrollDown(auto.stale > 0 && auto.stale % 3 === 0);
    auto.timer = setTimeout(tick, 1400 + Math.random() * 1200);
  }

  function toggleAuto() {
    if (auto.running) { stopAuto('Stopped.'); return; }
    var c = ctx();
    if (!onGridTab(c)) { auto.label = 'Open a channel\'s Videos, Shorts or Live tab first, e.g. youtube.com/@name/videos'; scheduleRender(); return; }
    selected = null;
    startAuto();
  }

  function startAuto(deadline, max) {
    auto.running = true;
    auto.stale = 0;
    auto.deadline = deadline || null;
    auto.max = max || null;
    auto.last = countFor(pageAccount(ctx()));
    tick();
  }

  // ---- downloads -----------------------------------------------------------
  function slim(p) {
    return { code: p.code, owner: p.owner, platform: 'youtube', type: p.type, views: p.views, likes: p.likes, comments: p.comments, files: [], cover: p.thumb };
  }
  /**
   * Covers: chrome.downloads in the service worker. Video files: yt-dlp on the Mac,
   * started through the OpenOutlier bridge (src/agent-bridge.js finds it); progress
   * goes to onProgress(label). Resolves { ok, queued, message?, errors? }.
   */
  function downloadPosts(posts, what, onProgress) {
    if (what === 'cover') return chrome.runtime.sendMessage({ type: 'reelscope:download', what: 'cover', posts: posts.map(slim) });
    var list = (posts || []).filter(function (p) { return p && Y.isVideoId(p.code); });
    var out = { ok: true, queued: 0, failed: 0, errors: [], saved: [] };
    var chain = Promise.resolve();
    list.forEach(function (p, i) {
      chain = chain.then(function () {
        return videoDownload(p, function (label) {
          if (onProgress) onProgress(list.length > 1 ? (i + 1) + ' of ' + list.length + ': ' + label : label);
        }).then(function (r) {
          if (r.ok) { out.queued++; if (r.path) out.saved.push(r.path); } else { out.failed++; out.errors.push.apply(out.errors, r.errors || []); }
          return r;
        });
      });
    });
    return chain.then(function () {
      out.ok = out.queued > 0;
      if (out.saved.length === 1) out.message = 'Saved to ' + out.saved[0];
      else if (out.saved.length) out.message = 'Saved ' + out.saved.length + ' videos to ' + out.saved[0].replace(/\/[^/]*$/, '/');
      if (!out.errors.length) delete out.errors;
      return out;
    });
  }

  /** One video through the bridge: start the yt-dlp job, then poll it until it ends. */
  function videoDownload(p, onProgress) {
    onProgress('Starting yt-dlp…');
    return chrome.runtime.sendMessage({ type: 'reelscope:yt-video', id: p.code, what: 'video', post: { owner: p.owner, type: p.type } }).then(function (r) {
      if (!r || !r.ok) return { ok: false, errors: [(r && r.error) || 'Could not start the download.'] };
      return new Promise(function (resolve) {
        var misses = 0;
        function step() {
          chrome.runtime.sendMessage({ type: 'reelscope:yt-video-status', port: r.port, job: r.job }).then(function (st) {
            if (!st || st.ok === false) {
              if (++misses >= 5) { resolve({ ok: false, errors: [(st && st.error) || 'Lost the connection to the OpenOutlier bridge.'] }); return; }
              setTimeout(step, 2000);
              return;
            }
            misses = 0;
            if (st.post) adoptExact(st.post);
            if (st.state === 'done') {
              var f = (st.files || []).filter(function (x) { return x.kind === 'video'; })[0];
              resolve({ ok: true, path: f ? f.display || f.path : null });
            } else if (st.state === 'error') {
              var e = st.error || {};
              resolve({ ok: false, errors: [[e.message || 'yt-dlp failed.', e.hint].filter(Boolean).join(' ')] });
            } else {
              onProgress(st.label || 'Downloading…');
              setTimeout(step, 1000);
            }
          }, function () {
            if (++misses >= 5) resolve({ ok: false, errors: ['Lost the connection to the extension. Reload the page.'] });
            else setTimeout(step, 2000);
          });
        }
        setTimeout(step, 600);
      });
    }, function (e) { return { ok: false, errors: ['Could not start the download: ' + (e && e.message || e)] }; });
  }

  /** yt-dlp's exact stats (views, likes, comments, upload time, chapters, heatmap) into the saved video. */
  function adoptExact(post) {
    if (!post || !Y.isVideoId(post.code)) return;
    var known = findPost(post.code);
    ingest([known ? Object.assign({}, post, { owner: known.owner }) : post]);
  }

  // ---- Get exact stats (the service worker opens the videos' pages one by one) ---
  var EXACT_TOP = 10;
  var exact = { running: false, label: '' };

  function setExact(st) {
    if (!st) return;
    exact = { running: !!st.running, label: st.label || '' };
    if (st.running && st.total) exact.label = (st.label || '') + ' ' + st.done + ' updated so far.';
    scheduleRender();
  }

  /** posts: the panel's scored list for the open format; take the top ones by Viral Score that are not exact yet. */
  function startExact(posts) {
    var top = M.sortBy((posts || []).filter(function (p) { return p.ratio != null; }), 'viralScore').slice(0, EXACT_TOP);
    var todo = top.filter(function (p) { return p.viewsApprox || p.dateApprox !== false; });
    if (!todo.length) { setExact({ running: false, label: 'The top ' + top.length + ' already have exact stats.' }); return; }
    setExact({ running: true, label: 'Starting…' });
    chrome.runtime.sendMessage({ type: 'reelscope:yt-exact', videos: todo.map(function (p) { return { code: p.code, owner: p.owner, type: p.type }; }) })
      .then(function (r) {
        if (!r || !r.ok) setExact({ running: false, label: (r && r.error) || 'Could not start.' });
      }, function (e) { setExact({ running: false, label: 'Could not start: ' + (e && e.message || e) }); });
  }

  function cancelExact() {
    exact.label = 'Stopping…';
    scheduleRender();
    chrome.runtime.sendMessage({ type: 'reelscope:yt-exact-cancel' }).then(setExact, function () {});
  }

  // ---- Exact stats via the optional YouTube Data API key (service worker) -----
  // Only offered when the user saved their own key in the popup; the panel shows
  // nothing about it otherwise.
  var api = { configured: false, used: 0, limit: 10000, running: false, label: '' };
  function loadApiStatus() {
    chrome.runtime.sendMessage({ type: 'reelscope:yt-api-status' }).then(function (st) {
      if (!st) return;
      api.configured = !!st.configured;
      if (st.quota) { api.used = st.quota.used; api.limit = st.quota.limit; }
      scheduleRender();
    }, function () { /* worker asleep or an old build */ });
  }
  function startApi(action) {
    var id = currentAccount();
    if (!id || api.running) return;
    api.running = true;
    api.label = action === 'uploads' ? 'Loading the channel\'s uploads…' : 'Getting exact stats…';
    scheduleRender();
    flushSave().then(function () {
      return chrome.runtime.sendMessage({ type: 'reelscope:yt-api', action: action, owner: id, max: 500 });
    }).then(function (r) {
      api.running = false;
      if (!r || !r.ok) api.label = (r && r.error) || 'Could not reach the service worker.';
      else {
        var parts = [];
        if (r.added) parts.push(r.added + ' added');
        parts.push((r.updated || 0) + ' updated');
        if (r.missing) parts.push(r.missing + ' no longer on YouTube');
        api.label = 'Done: ' + parts.join(', ') + ' (' + r.units + ' quota unit' + (r.units === 1 ? '' : 's') + ').' + (r.note ? ' ' + r.note : '');
      }
      if (r && r.quota) api.used = r.quota.used;
      scheduleRender();
    }, function (e) { api.running = false; api.label = 'Could not start: ' + (e && e.message || e); scheduleRender(); });
  }
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'local' && (changes['rs:settings'] || changes['rs:yt-api-quota'])) loadApiStatus();
  });
  loadApiStatus();

  // ---- agent commands (agent-bridge.js, from the local MCP server) ------------
  // collect_youtube arrives once per channel tab (the service worker loads each tab
  // in the same window); refresh_youtube on one watch / Shorts page.
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var TAB_NAMES = { videos: 'Videos', shorts: 'Shorts', streams: 'Live' };

  /** Is this page the one the command was sent for? (Right after a navigation the old page may still answer.) */
  function commandFits(cmd) {
    var a = cmd.args || {};
    var c = ctx();
    if (cmd.type === 'refresh_youtube') return (c.kind === 'watch' || c.kind === 'short') && c.video === a.id;
    if (cmd.type === 'collect_youtube') return c.kind === 'channel' && !(a.prevTab && c.tab === a.prevTab && a.prevTab !== a.tab);
    return true;
  }

  async function collectYouTubeTab(a) {
    if (!Y.isYouTubeId(a.id)) return { ok: false, fatal: true, error: 'Not a valid YouTube channel.' };
    var tab = GRID_TABS.indexOf(a.tab) !== -1 ? a.tab : 'videos';
    var name = TAB_NAMES[tab];
    // The first page came inline (read at startup); give a slow page a few seconds.
    for (var i = 0; i < 16 && !countFor(pageAccount(ctx())); i++) { scanInline(); await sleep(500); }
    var c = ctx();
    var id = pageAccount(c);
    var prof = id && profiles[id];
    var start = initialCounts[id] || (prof && prof.channelId ? initialCounts[Y.ytId(prof.channelId)] : 0) || 0;
    if (!prof && !countFor(id)) {
      return { ok: false, fatal: true, tab: tab, error: Y.label(a.id) + ' was not found on YouTube (or YouTube showed a consent / sign-in page instead of the channel).' };
    }
    if (c.tab !== tab) {
      // YouTube sent us elsewhere: the channel has no such tab.
      return { ok: true, tab: tab, skipped: true, account: id, saved_total: countFor(id), note: 'This channel has no ' + name + ' tab.' };
    }
    var max = Math.min(2000, a.maxPosts || 300);
    if (more[id + '|' + tab] !== false && tabCount(id, tab) < max) {
      await new Promise(function (resolve) { auto.done = resolve; startAuto(Date.now() + 3 * 60000, max); });
    }
    await flushSave();
    id = pageAccount(ctx()) || id; // a yt/UC… account moves under its handle once that is seen
    prof = profiles[id] || prof || {};
    var all = accounts[id] ? Object.values(accounts[id]) : [];
    var shorts = all.filter(function (p) { return p.type === 'short'; }).length;
    var end = more[id + '|' + tab] === false;
    var notes = [];
    if (!tabCount(id, tab)) notes.push('No ' + name + ' on this channel.');
    else if (!end) notes.push('Stopped on the ' + name + ' tab before its end (time or max_reels limit); open it in Chrome and press Auto-scroll in the OpenOutlier panel for the rest.');
    if (langNote) notes.push(langNote);
    return {
      ok: true, account: id, tab: tab,
      collected_now: Math.max(0, countFor(id) - start),
      saved_total: countFor(id), long_form: all.length - shorts, shorts: shorts,
      end_reached: end,
      channel_videos: prof.videos != null ? prof.videos : undefined,
      subscribers: prof.subscribers != null ? prof.subscribers : undefined,
      note: notes.join(' ') || undefined
    };
  }

  /** On a watch / Shorts page: wait until its exact stats (player data) are saved. */
  async function refreshYouTube(a) {
    var vid = String(a.id || '');
    if (!Y.isVideoId(vid)) return { ok: false, error: 'Not a YouTube video id.' };
    var fresh = function (p) { return p && (p.seenAt || 0) >= loadedAt - 1000; };
    for (var i = 0; i < 50; i++) {
      var p = findPost(vid);
      if (fresh(p) && !p.viewsApprox && p.dateApprox === false) break;
      if (i % 4 === 0) scanInline();
      await sleep(500);
    }
    var post = findPost(vid);
    await flushSave();
    if (!fresh(post)) return { ok: false, id: vid, error: 'YouTube did not show this video (private, deleted, members-only, age-restricted, or a consent page?).' };
    return { ok: true, id: vid, account: post.owner, exact_views: !post.viewsApprox, exact_date: post.dateApprox === false };
  }

  async function runCommand(cmd) {
    var a = cmd.args || {};
    if (cmd.type === 'collect_youtube') return collectYouTubeTab(a);
    if (cmd.type === 'refresh_youtube') return refreshYouTube(a);
    return { ok: false, error: 'This is a YouTube tab; it cannot run ' + cmd.type + '.' };
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

  var panel = P.create({
    cssText: cssText,
    platform: 'youtube',
    listTabLabel: 'Videos',
    autoTip: 'Scroll this channel tab automatically until every video has loaded',
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
    onExactStats: startExact,
    onExactCancel: cancelExact,
    onApiStats: startApi,
    onOpenDashboard: function () {
      var id = currentAccount();
      chrome.runtime.sendMessage({ type: 'reelscope:open-dashboard', hash: id ? '#/account/' + encodeURIComponent(id) : '' });
    },
    features: !!FT,
    onFeatureToggle: function (id, on) { FT.set(id, on); },
    onFeatureReset: function () { FT.reset().then(function () { featureState.message = FT.uiLang() === 'tr' ? 'Varsayılanlar geri yüklendi.' : 'Defaults restored.'; scheduleRender(); }); },
    onFeatureFix: fixFeature
  });

  // ---- Features tab -----------------------------------------------------------
  // Flags and what is set up come from storage; a change anywhere (this tab, another
  // tab, the Library, the popup) re-renders without a reload.
  var featureState = { flags: FT ? FT.flags() : null, env: {}, message: '' };
  function loadFeatureState() {
    if (!FT) return Promise.resolve();
    return FT.env().then(function (env) { featureState.flags = FT.flags(); featureState.env = env; scheduleRender(); });
  }
  function fixFeature(code) {
    var tr = FT.uiLang() === 'tr';
    if (code === 'tracker') { FT.set('tracker', true); return; }
    if (code === 'copyKey') {
      featureState.message = tr ? 'Anahtar bridge\'e kopyalanıyor…' : 'Copying the key to the bridge…';
      scheduleRender();
      chrome.runtime.sendMessage({ type: 'reelscope:bridge-key', action: 'copy' }).then(function (r) {
        featureState.message = r && r.ok ? (tr ? 'Anahtar bridge\'e kopyalandı.' : 'The key is on the bridge now.') : ((tr ? 'Kopyalanamadı: ' : 'Could not copy: ') + ((r && r.error) || '?'));
        loadFeatureState();
      }, function (e) { featureState.message = String(e && e.message || e); scheduleRender(); });
      return;
    }
    // API key, bridge setup: Library → Settings; YouTube Analytics: Library → My YouTube channel.
    chrome.runtime.sendMessage({ type: 'reelscope:open-dashboard', hash: code === 'oauth' ? '#/my-youtube' : '#/settings' });
  }
  if (FT) {
    FT.ready.then(loadFeatureState);
    FT.onChange(function () { featureState.message = ''; loadFeatureState(); });
  }

  /** The page's main player: the watch page's, or the Short that is on screen. */
  function mainVideo() {
    var c = ctx();
    // Shorts keep several players in the DOM (previous / next); the one on screen is the biggest visible one.
    if (c.kind === 'short') return mostVisible(document.querySelectorAll('ytd-shorts video, #shorts-player video')) || mostVisible(document.querySelectorAll('video'));
    var sel = ['#movie_player video', 'ytd-watch-flexy video', 'ytd-player video'];
    for (var i = 0; i < sel.length; i++) { var v = document.querySelector(sel[i]); if (v) return v; }
    return document.querySelector('video');
  }

  function mostVisible(list) {
    var best = null;
    var bestArea = 0;
    for (var i = 0; i < list.length; i++) {
      var r = list[i].getBoundingClientRect();
      var w = Math.min(r.right, window.innerWidth) - Math.max(r.left, 0);
      var hgt = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
      var area = Math.max(0, w) * Math.max(0, hgt);
      if (area > bestArea) { bestArea = area; best = list[i]; }
    }
    return bestArea > 20000 ? best : null;
  }

  /** Where the toolbar goes: never on top of YouTube's player (it has its own controls there). */
  function overlayPlacement() {
    var c = ctx();
    if (c.kind === 'watch') {
      // The like / share row under the video; YouTube lays it out, so nothing is covered.
      var rows = document.querySelectorAll('ytd-watch-metadata #top-level-buttons-computed');
      for (var i = 0; i < rows.length; i++) if (rows[i].getBoundingClientRect().width > 0) return { inline: rows[i] };
      return null;
    }
    if (c.kind === 'short') {
      var v = mainVideo();
      var r = v && v.getBoundingClientRect();
      // Right of the Short, above YouTube's like / comment column; over the video only on very narrow windows.
      if (r && r.width > 100 && window.innerWidth - r.right >= 60) return { rail: r };
    }
    return null;
  }

  var overlay = O.create({
    cssText: cssText,
    placement: overlayPlacement,
    openKey: 'reelscope:yt-card-open',
    defaultOpen: false,
    getPost: function (id) { return findPost(id); },
    getProfilePosts: function (owner) { return owner && accounts[owner] ? Object.values(accounts[owner]) : []; },
    isLoading: function () { return false; },
    onDownloadMedia: downloadPosts,
    onSeek: function (t) { var v = mainVideo(); if (v) { try { v.currentTime = t; } catch (e) { /* not seekable yet */ } } },
    onOpenPanel: function () { panel.toggle(true); }
  });

  /** 'short' on a Shorts tab or Short, 'long' on the Videos / Live tab or a watch page, null elsewhere. */
  function viewOf(c) {
    if (c.kind === 'short' || (c.kind === 'channel' && c.tab === 'shorts')) return 'short';
    if (c.kind === 'watch' || (c.kind === 'channel' && (c.tab === 'videos' || c.tab === 'streams'))) return 'long';
    return null;
  }

  var renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    setTimeout(function () {
      renderQueued = false;
      var c = ctx();
      var id = currentAccount();
      var prof = id && profiles[id];
      var notice = [warning, langNote].filter(Boolean).join(' ');
      panel.update({
        platform: 'youtube',
        profiles: accountList(),
        selected: id,
        posts: id ? Object.values(accounts[id]) : [],
        // The Videos / Shorts switch follows the channel tab that is open.
        view: viewOf(c),
        notice: notice || null,
        exact: exact,
        api: api.configured ? api : null,
        features: featureState,
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

  /** The overlay follows the video in the URL (watch page or the Short on screen). */
  var overlayCode;
  function syncOverlay() {
    var c = ctx();
    var code = (c.kind === 'watch' || c.kind === 'short') && c.video ? c.video : null;
    if (code !== overlayCode) { overlayCode = code; overlay.setCode(code); }
    // On a watch page the floating button would cover the player's fullscreen / settings
    // controls; the toolbar under the video opens the panel there instead.
    panel.setLauncherHidden(c.kind === 'watch');
  }

  mount();
  scanInline();
  scheduleRender();
  syncOverlay();
  // A page reloaded while "Get exact stats" runs picks the progress up again.
  chrome.runtime.sendMessage({ type: 'reelscope:yt-exact-status', owner: currentAccount() }).then(function (st) { if (st && (st.running || st.finished)) setExact(st); }, function () {});

  // YouTube is a single-page app: it fires yt-navigate-finish after in-app navigation
  // (its data arrived through the hook already). The URL check is a fallback.
  var lastHref = location.href;
  function onNavigate() {
    mount();
    syncOverlay();
    if (location.href === lastHref) return;
    var prev = Y.pageContext(new URL(lastHref).pathname, new URL(lastHref).search);
    lastHref = location.href;
    var c = ctx();
    if (pageAccount(c) !== pageAccount(prev)) selected = null;
    if (auto.running && (!onGridTab(c) || c.tab !== prev.tab || pageAccount(c) !== pageAccount(prev))) stopAuto('Stopped: page changed.');
    warning = '';
    scheduleRender();
  }
  document.addEventListener('yt-navigate-finish', onNavigate);
  setInterval(onNavigate, 700);

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg) return;
    if (msg.type === 'reelscope:toggle') {
      panel.toggle(true);
      sendResponse({ ok: true, profile: currentAccount() });
    }
    if (msg.type === 'reelscope:yt-exact-progress') setExact(msg.state);
    if (msg.type === 'reelscope:command' && msg.command) {
      if (!commandFits(msg.command)) { sendResponse({ accepted: false }); return; }
      sendResponse({ accepted: true });
      runCommand(msg.command).then(function (result) {
        chrome.runtime.sendMessage({ type: 'reelscope:command-done', id: msg.command.id, result: result });
      }, function (e) {
        chrome.runtime.sendMessage({ type: 'reelscope:command-done', id: msg.command.id, result: { ok: false, error: String(e && e.message || e) } });
      });
    }
  });
})();
