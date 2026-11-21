// OpenOutlier – phase 3 on youtube.com: badges on video cards, feed filters, "hide Shorts" in
// search and "sort by outlier" on a channel's grid (docs/youtube-niche-plan.md 4–5).
//
// Where the numbers come from, best first:
//   • exact counts: the tracker's latest measurement (bridge, video_stats), a saved video with
//     exact views / date (Library: watch pages, "Get exact stats", the API buttons);
//   • the card's own data: YouTube's responses (hook.js → Y.parseCards), else the card's text
//     (rounded views, "3 weeks ago": the VPH is then marked ≈);
//   • the channel's normal: the median of its saved videos (Library, per format), else the mean
//     from a cached channels.list (the user's API key, 50 channels = 1 unit, 7 days), labelled "avg";
//   • velocity: tracked videos only, from the bridge (mcp/cards.mjs).
//
// Every piece checks its switch (src/features.js) and takes itself out when it is turned off,
// without a reload. Badges sit absolutely on the thumbnail's top-left corner (YouTube keeps its
// own duration / live badges bottom-right and its hover buttons top-right), so nothing moves.
// Shared with src/youtube-pages.js through self.OpenOutlierYTData.
(function () {
  'use strict';
  if (window.top !== window || window.__openoutlierYTCards) return;
  window.__openoutlierYTCards = true;

  var Y = self.OpenOutlierYouTube;
  var I = self.OpenOutlierInsights;
  var FT = self.OpenOutlierFeatures;
  if (!Y || !I || !FT) return;

  var BADGE_FEATURES = ['card-vph', 'card-outlier', 'card-subs', 'card-velocity'];
  var ALL_FEATURES = BADGE_FEATURES.concat(['feed-filters', 'hide-shorts', 'channel-sort']);

  // ---- strings -------------------------------------------------------------------------------
  var S = {
    en: {
      avg: 'avg', subs: 'subs', perHour: '/h',
      tipOutMedian: '{x} this channel\'s median {fmt} views ({n} saved videos).',
      tipOutMeanCh: '{x} this channel\'s average views per video (total views ÷ video count, from channels.list). Not the median: save the channel in OpenOutlier for that.',
      tipOutMeanLib: '{x} the average of this channel\'s {n} saved {fmt} videos.',
      fmtLong: 'long-form', fmtShort: 'Shorts',
      tipVph: 'Views per hour since it was published.',
      tipVphApprox: 'Views per hour, approximate: YouTube shows rounded views and a relative date here. Open the video for the exact number.',
      tipSubs: 'Channel subscribers.',
      tipVel: 'Velocity: {views} views at {at}, {x} what this channel\'s videos usually have by then (OpenOutlier niche tracking).',
      filters: 'Filters', reset: 'Reset', close: 'Close',
      showing: 'Showing {a} of {b} loaded videos', showingAll: '{b} videos loaded',
      loadedNote: 'Filters only what YouTube has loaded so far. Scroll down to load more.',
      noData: '{n} hidden for lack of data',
      fOutlier: 'Outlier at least', fVph: 'Views per hour at least', fViews: 'Views at least', fAge: 'Uploaded', fLength: 'Length', fVps: 'Views per subscriber at least', fNoShorts: 'Hide Shorts',
      any: 'Any', age1: 'Last 24 hours', age7: 'This week', age30: 'This month', age365: 'This year',
      lenUnder4: 'Under 4 min', len4to20: '4–20 min', lenOver20: 'Over 20 min',
      sort: 'Sort by outlier', sortOn: 'Sorted by outlier', sortTip: 'Orders the videos loaded so far by how many times the channel\'s normal they got. YouTube\'s own order comes back when you turn it off.',
      sortNoLayout: 'This grid layout can\'t be reordered.',
      brand: 'OpenOutlier'
    },
    tr: {
      avg: 'ort.', subs: 'abone', perHour: '/sa',
      tipOutMedian: 'Bu kanalın {fmt} medyan izlenmesinin {x} katı ({n} kayıtlı video).',
      tipOutMeanCh: 'Bu kanalın video başına ortalama izlenmesinin {x} katı (toplam izlenme ÷ video sayısı, channels.list\'ten). Medyan değil: onun için kanalı OpenOutlier\'a kaydet.',
      tipOutMeanLib: 'Bu kanalın {n} kayıtlı {fmt} videosunun ortalamasının {x} katı.',
      fmtLong: 'uzun video', fmtShort: 'Shorts',
      tipVph: 'Yayından beri saat başına izlenme.',
      tipVphApprox: 'Saat başına izlenme, yaklaşık: YouTube burada yuvarlanmış izlenme ve göreli tarih gösteriyor. Kesin sayı için videoyu aç.',
      tipSubs: 'Kanalın abone sayısı.',
      tipVel: 'Hız: {at} noktasında {views} izlenme, bu kanalın videolarının o saatte normalde aldığının {x} katı (OpenOutlier niş takibi).',
      filters: 'Filtreler', reset: 'Sıfırla', close: 'Kapat',
      showing: 'Yüklenen {b} videodan {a} tanesi gösteriliyor', showingAll: '{b} video yüklendi',
      loadedNote: 'Filtreler sadece YouTube\'un şu ana kadar yüklediği videolara uygulanır. Daha fazlası için aşağı kaydır.',
      noData: '{n} video verisi olmadığı için gizlendi',
      fOutlier: 'En az outlier', fVph: 'En az saatlik izlenme', fViews: 'En az izlenme', fAge: 'Yükleme tarihi', fLength: 'Süre', fVps: 'Abone başına en az izlenme', fNoShorts: 'Shorts\'u gizle',
      any: 'Hepsi', age1: 'Son 24 saat', age7: 'Bu hafta', age30: 'Bu ay', age365: 'Bu yıl',
      lenUnder4: '4 dk altı', len4to20: '4–20 dk', lenOver20: '20 dk üstü',
      sort: 'Outlier\'a göre sırala', sortOn: 'Outlier\'a göre sıralı', sortTip: 'Şu ana kadar yüklenen videoları kanalın normalinin kaç katı aldıklarına göre sıralar. Kapatınca YouTube\'un sırası geri gelir.',
      sortNoLayout: 'Bu ızgara düzeni yeniden sıralanamıyor.',
      brand: 'OpenOutlier'
    }
  };
  function lang() { return FT.uiLang() === 'tr' ? 'tr' : 'en'; }
  function T() { return S[lang()]; }
  function fill(s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o[k] != null ? o[k] : m; }); }

  // ---- page --------------------------------------------------------------------------------
  function ctx() { return Y.pageContext(location.pathname, location.search); }
  /** 'search' | 'home' | 'subscriptions' | 'watch' | 'channel' | 'short' | 'other' */
  function pageKind() {
    var p = location.pathname;
    if (p === '/results') return 'search';
    if (p === '/' || p === '') return 'home';
    if (/^\/feed\/subscriptions/.test(p)) return 'subscriptions';
    var c = ctx();
    return c.kind === 'channel' ? 'channel' : c.kind;
  }
  /** YouTube keeps earlier pages in the DOM, hidden: work only inside the one on screen. */
  function activePage() {
    var pm = document.querySelector('ytd-page-manager');
    if (pm) {
      for (var i = 0; i < pm.children.length; i++) {
        var el = pm.children[i];
        if (!el.hasAttribute('hidden') && el.offsetParent !== null) return el;
      }
    }
    return document.querySelector('[data-oo-page]') || document.body;
  }
  /** YouTube's label language: <html lang>, or Turkish words in the data. */
  function dataLang(raw) {
    var n = Y.normLang(String(document.documentElement.getAttribute('lang') || ''));
    var d = raw ? Y.detectLang(raw) : null;
    return d === 'tr' ? 'tr' : n || d || 'en';
  }

  // ---- data -----------------------------------------------------------------------------------
  var items = {};      // video id → card record (Y.parseCards)
  var chInfo = {};     // UC… → channels.list facts | null
  var chAsked = {};    // UC… → asked at (ms)
  var chNoKey = false;
  var bridgeV = {};    // video id → bridge answer
  var bridgeC = {};    // UC… → bridge answer
  var bridgeAsked = {};
  var bridgeOk = null; // null = unknown, false = no (new enough) bridge
  var dataSubs = [];
  var dirtyData = false;

  function changed() {
    dirtyData = true;
    scheduleRender();
    dataSubs.slice().forEach(function (fn) { try { fn(); } catch (e) { console.warn('[OpenOutlier] data listener failed', e); } });
  }

  function addItems(list) {
    var n = 0;
    (list || []).forEach(function (r) {
      if (!r || !r.code) return;
      var prev = items[r.code];
      items[r.code] = prev ? Object.assign({}, prev, pickDefined(r)) : r;
      n++;
    });
    if (n) changed();
  }
  function pickDefined(o) { var out = {}; Object.keys(o).forEach(function (k) { if (o[k] != null) out[k] = o[k]; }); return out; }

  function anyOn(list) { for (var i = 0; i < list.length; i++) if (FT.isOn(list[i])) return true; return false; }

  window.addEventListener('message', function (e) {
    if (e.source !== window || !e.data || e.data.__reelscope !== 1 || e.data.type !== 'payload') return;
    if (!anyOn(ALL_FEATURES) && !FT.isOn('video-card') && !FT.isOn('shorts-overlay')) return;
    var t = e.data.text;
    if (typeof t !== 'string' || (t.indexOf('"videoId"') === -1 && t.indexOf('"contentId"') === -1)) return;
    try {
      var json = JSON.parse(t.replace(/^\)\]\}'\s*/, ''));
      addItems(Y.parseCards(json, { lang: dataLang(t) }));
    } catch (err) { /* not JSON or a format we don't read */ }
  });

  function scanInline() {
    document.querySelectorAll('script:not([src])').forEach(function (el) {
      var t = el.textContent;
      if (!t || t.length > 1.2e7 || t.indexOf('ytInitialData') === -1) return;
      var data = Y.extractVar(t, 'ytInitialData');
      if (data) addItems(Y.parseCards(data, { lang: dataLang(t) }));
    });
  }

  // The Library this tab holds (src/youtube-content.js); it may still be loading.
  function lib() { return self.OpenOutlierYTLib || null; }
  var postIndex = null;   // video id → saved post
  var ownerIndex = null;  // UC… → account id
  var baseCache = {};     // account → { n, base }
  function indexLib() {
    var L = lib();
    postIndex = {};
    ownerIndex = {};
    baseCache = {};
    if (!L) return;
    Object.keys(L.accounts).forEach(function (acct) {
      var posts = L.accounts[acct];
      Object.keys(posts).forEach(function (code) {
        var p = posts[code];
        postIndex[code] = p;
        if (p && p.ownerId && !ownerIndex[p.ownerId]) ownerIndex[p.ownerId] = acct;
      });
    });
    Object.keys(L.ucMap || {}).forEach(function (uc) { ownerIndex[uc] = L.ucMap[uc]; });
  }
  function hookLib() {
    var L = lib();
    if (!L || hookLib.done) return;
    hookLib.done = true;
    indexLib();
    L.onChange(function () { postIndex = null; changed(); });
    changed();
  }
  document.addEventListener('openoutlier-yt-lib', hookLib);

  function savedPost(id) { if (!postIndex) indexLib(); return postIndex[id] || null; }
  /** The Library account of a channel (UC… and/or handle), or null. */
  function accountOf(uc, handle) {
    var L = lib();
    if (!L) return null;
    if (!postIndex) indexLib();
    if (uc && ownerIndex[uc]) return ownerIndex[uc];
    if (handle) { var id = Y.ytId(handle); if (L.accounts[id]) return id; }
    if (uc && L.accounts['yt/' + uc]) return 'yt/' + uc;
    return null;
  }
  function baselineOf(acct) {
    var L = lib();
    if (!acct || !L || !L.accounts[acct]) return null;
    var posts = L.accounts[acct];
    var n = Object.keys(posts).length;
    var c = baseCache[acct];
    if (c && c.n === n) return c.base;
    var base = I.libraryBaseline(Object.values(posts), Date.now());
    baseCache[acct] = { n: n, base: base };
    return base;
  }
  function profileOf(acct) { var L = lib(); return acct && L && L.profiles[acct] || null; }

  /**
   * Everything a card / page needs about one video. rec: a card record (or { code }).
   * → { id, type, views, viewsExact, publishedAt, dateExact, duration, uc, handle, acct, vph, outlier, subs, velocity, likes, comments }
   */
  function videoFacts(id, rec) {
    rec = rec || items[id] || { code: id };
    var saved = savedPost(id);
    var br = bridgeV[id];
    var f = { id: id, type: rec.type || (saved && saved.type) || (br && br.type) || 'video', duration: rec.duration != null ? rec.duration : saved && saved.duration,
      uc: rec.ownerId || (saved && saved.ownerId) || null, handle: rec.author || (saved && saved.author) || null };
    // Views: an exact count beats a rounded one; between two exact ones the newer.
    var cands = [];
    if (br && br.views != null) cands.push({ v: br.views, exact: true, at: br.ts || 0 });
    if (saved && saved.views != null) cands.push({ v: saved.views, exact: !saved.viewsApprox, at: saved.seenAt || 0 });
    if (rec.views != null) cands.push({ v: rec.views, exact: !rec.viewsApprox, at: rec.seenAt || 0 });
    cands.sort(function (a, b) { return (b.exact - a.exact) || (b.at - a.at); });
    if (cands.length) { f.views = cands[0].v; f.viewsExact = cands[0].exact; }
    if (br && br.published_at) { f.publishedAt = br.published_at; f.dateExact = true; }
    else if (saved && saved.takenAt && saved.dateApprox === false) { f.publishedAt = saved.takenAt; f.dateExact = true; }
    else if (rec.takenAt) { f.publishedAt = rec.takenAt; f.dateExact = rec.dateApprox === false; }
    else if (saved && saved.takenAt) { f.publishedAt = saved.takenAt; f.dateExact = false; }
    f.likes = br && br.likes != null ? br.likes : saved ? saved.likes : null;
    f.comments = br && br.comments != null ? br.comments : saved ? saved.comments : null;
    f.vph = I.vph({ views: f.views, viewsApprox: !f.viewsExact, publishedAt: f.publishedAt, dateApprox: !f.dateExact }, Date.now());
    f.acct = accountOf(f.uc, f.handle) || (saved && saved.owner) || null;
    if (!f.uc && f.acct) { var pr = profileOf(f.acct); if (pr && pr.channelId) f.uc = pr.channelId; }
    var base = baselineOf(f.acct);
    var info = f.uc ? chInfo[f.uc] : null;
    var bc = f.uc ? bridgeC[f.uc] : null;
    f.outlier = I.outlier(f.views, f.type, FT.choice('outlierFormula'), base, info || (bc && bc.views != null && bc.videos ? { views: bc.views, videos: bc.videos } : null));
    if (f.outlier) {
      var fk = f.type === 'short' ? 'short' : 'long';
      f.outlier.n = base && base[fk] ? base[fk].n : null;
    }
    var prof = profileOf(f.acct);
    f.subs = bc && bc.subs != null ? bc.subs : info && info.subscribers != null ? info.subscribers : prof && prof.subscribers != null ? prof.subscribers : null;
    f.velocity = br && br.velocity ? br.velocity : null;
    return f;
  }

  // ---- channels.list and the bridge, batched ---------------------------------------------------
  var wantCh = {};
  var wantV = {};
  var flushTimer = null;
  function want(f) {
    if (f.uc && !(f.uc in chInfo) && !chAsked[f.uc] && needsChannel(f)) wantCh[f.uc] = true;
    if (bridgeOk !== false && !bridgeAsked[f.id] && (FT.isOn('card-velocity') || FT.isOn('card-vph') || FT.isOn('video-card'))) wantV[f.id] = true;
    if (bridgeOk !== false && f.uc && !(f.uc in bridgeC) && !bridgeAsked['c:' + f.uc]) wantV['c:' + f.uc] = true;
    if (!flushTimer && (Object.keys(wantCh).length || Object.keys(wantV).length)) flushTimer = setTimeout(flush, 600);
  }
  /** channels.list only when it adds something: no median for the outlier, no subscriber count, or the mean formula. */
  function needsChannel(f) {
    if (chNoKey) return false;
    var base = baselineOf(f.acct);
    var fk = f.type === 'short' ? 'short' : 'long';
    var outNeed = FT.isOn('card-outlier') && (FT.choice('outlierFormula') === 'mean' || !(base && base[fk] && base[fk].median));
    var prof = profileOf(f.acct);
    var subsNeed = FT.isOn('card-subs') && !(prof && prof.subscribers != null);
    return outNeed || subsNeed;
  }
  function flush() {
    flushTimer = null;
    var chs = Object.keys(wantCh).slice(0, 150);
    chs.forEach(function (k) { delete wantCh[k]; chAsked[k] = Date.now(); });
    var vids = [];
    var bchs = [];
    Object.keys(wantV).slice(0, 300).forEach(function (k) {
      delete wantV[k];
      bridgeAsked[k] = Date.now();
      if (k.indexOf('c:') === 0) bchs.push(k.slice(2)); else vids.push(k);
    });
    if (chs.length) requestChannels(chs);
    if ((vids.length || bchs.length) && bridgeOk !== false) {
      send({ type: 'reelscope:yt-cards', what: 'cards', videos: vids, channels: bchs }).then(function (r) {
        if (!r || r.ok === false) { if (r && (r.noBridge || r.oldBridge)) bridgeOk = false; return; }
        bridgeOk = true;
        var got = false;
        Object.keys(r.videos || {}).forEach(function (id) { bridgeV[id] = r.videos[id]; got = true; });
        bchs.forEach(function (uc) { bridgeC[uc] = (r.channels || {})[uc] || null; });
        if (got || Object.keys(r.channels || {}).length) changed();
      });
    }
    if (Object.keys(wantCh).length || Object.keys(wantV).length) flushTimer = setTimeout(flush, 600);
  }
  function requestChannels(ids) {
    return send({ type: 'reelscope:yt-channels', ids: ids }).then(function (r) {
      if (!r) return;
      if (r.noKey) chNoKey = true;
      var got = false;
      Object.keys(r.channels || {}).forEach(function (uc) { chInfo[uc] = r.channels[uc]; got = true; });
      if (got) changed();
    });
  }
  function send(msg) {
    try { return chrome.runtime.sendMessage(msg).catch(function () { return null; }); } catch (e) { return Promise.resolve(null); }
  }
  // A new API key (or none any more): ask again.
  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area !== 'local') return;
    if (ch['rs:settings']) {
      var a = ch['rs:settings'].oldValue || {};
      var b = ch['rs:settings'].newValue || {};
      if (a.youtubeApiKey !== b.youtubeApiKey) { chNoKey = false; chAsked = {}; }
    }
    if (ch['rs:bridge']) { var nb = ch['rs:bridge'].newValue || {}; if (nb.connected && bridgeOk === false) { bridgeOk = null; bridgeAsked = {}; } }
  });

  // ---- styles (light DOM, one sheet; custom tag names can't clash with YouTube's) -------------
  var CSS = [
    'oo-cq{position:absolute;inset:0;z-index:2;pointer-events:none;container-type:inline-size;container-name:oo}',
    'oo-badges{position:absolute;top:6px;left:6px;display:flex;flex-wrap:nowrap;gap:3px;max-width:calc(100% - 12px);overflow:hidden;font:500 11.5px/18px Roboto,"YouTube Sans",Arial,sans-serif;letter-spacing:.01em;pointer-events:auto}',
    'oo-b{display:inline-flex;align-items:center;flex:none;height:18px;padding:0 5px;border-radius:4px;background:rgba(11,14,26,.8);color:#F6F7F2;white-space:nowrap;font-variant-numeric:tabular-nums;cursor:default}',
    'oo-b.oo-out{background:rgba(11,14,26,.8);color:#F6F7F2}',
    'oo-b.oo-hot{background:#C8FF2E;color:#0B0E1A;font-weight:700}',
    'oo-b.oo-vel{background:#1E3BFF;color:#F6F7F2}',
    'oo-b i{font-style:normal;opacity:.78;font-size:10px;margin-left:3px;font-weight:500}',
    'oo-b.oo-hot i{opacity:.7}',
    '@container oo (max-width: 230px){oo-b.oo-subs{display:none}}',
    '@container oo (max-width: 175px){oo-b.oo-vel i{display:none}oo-badges{top:4px;left:4px;gap:2px}oo-b{padding:0 4px;font-size:11px}}',
    '@container oo (max-width: 135px){oo-b.oo-vph{display:none}}',
    '[data-oo-hidden]{display:none!important}',
    // Hide Shorts (search): shelves and single results; the attribute comes and goes with the switch.
    'html[data-oo-hide-shorts] ytd-search ytd-reel-shelf-renderer,html[data-oo-hide-shorts] ytd-search grid-shelf-view-model,' +
    'html[data-oo-hide-shorts] ytd-search ytd-shelf-renderer:has(ytd-reel-item-renderer),html[data-oo-hide-shorts] ytd-search ytd-shelf-renderer:has(ytm-shorts-lockup-view-model),' +
    'html[data-oo-hide-shorts] ytd-search ytd-video-renderer:has(a[href^="/shorts/"]),html[data-oo-hide-shorts] ytd-search [data-oo-short],' +
    'html[data-oo-hide-shorts] ytd-search ytd-item-section-renderer:has(> #contents > grid-shelf-view-model:only-child){display:none!important}'
  ].join('\n');
  function ensureStyle() {
    if (document.getElementById('openoutlier-cards-css')) return;
    var st = document.createElement('style');
    st.id = 'openoutlier-cards-css';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  // ---- cards in the DOM ------------------------------------------------------------------------
  var CARD_SEL = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-reel-item-renderer, ' +
    'yt-lockup-view-model, ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2, ytd-playlist-video-renderer, [data-oo-card]';
  var THUMB_SEL = 'yt-thumbnail-view-model, ytd-thumbnail, .shortsLockupViewModelHostThumbnailContainer, .ShortsLockupViewModelHostThumbnailContainer, a#thumbnail, [data-oo-thumb]';
  var LINK_SEL = 'a[href*="/watch?v="], a[href*="/shorts/"]';
  var cards = new Set();     // outer card elements we manage
  var others = new Set();    // mixes / playlists in a feed: no badges, hidden while a filter is on
  var SHELF_SEL = 'ytd-rich-section-renderer, ytd-reel-shelf-renderer, grid-shelf-view-model, ytd-shelf-renderer';
  var state = new WeakMap(); // card → { id, sig, host }

  function idOfLink(a) {
    var href = a && a.getAttribute('href') || '';
    var m = href.match(/[?&]v=([A-Za-z0-9_-]{11})/) || href.match(/\/shorts\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }
  /** Mixes and playlists carry a video link too; they are not one video. */
  function isCollection(card) {
    return !!card.querySelector('yt-collection-thumbnail-view-model, ytd-playlist-thumbnail, yt-collections-stack') || card.tagName === 'YTD-RADIO-RENDERER';
  }
  function outerCard(el) {
    var cur = el;
    var p = el.parentElement && el.parentElement.closest(CARD_SEL);
    while (p) { cur = p; p = p.parentElement && p.parentElement.closest(CARD_SEL); }
    return cur;
  }

  var scanTimer = null;
  function scheduleScan() { if (!scanTimer) scanTimer = setTimeout(scan, 180); }
  function scan() {
    scanTimer = null;
    var kind = pageKind();
    var page = activePage();
    var wantBadges = anyOn(BADGE_FEATURES) && kind !== 'short';
    var wantFilter = FT.isOn('feed-filters') && (kind === 'search' || kind === 'home' || kind === 'subscriptions');
    var wantSort = FT.isOn('channel-sort') && kind === 'channel';
    var wantShorts = FT.isOn('hide-shorts') && kind === 'search';
    if (wantShorts) document.documentElement.setAttribute('data-oo-hide-shorts', ''); else document.documentElement.removeAttribute('data-oo-hide-shorts');
    // Forget cards that left the page.
    cards.forEach(function (c) { if (!c.isConnected) { cards.delete(c); } });
    if (wantBadges || wantFilter || wantSort || wantShorts) {
      ensureStyle();
      var found = page.querySelectorAll(CARD_SEL);
      var seen = new Set();
      for (var i = 0; i < found.length; i++) {
        var c = outerCard(found[i]);
        if (seen.has(c)) continue;
        seen.add(c);
        var link = c.querySelector(LINK_SEL);
        var id = idOfLink(link);
        if (!id || isCollection(c)) { if (cards.has(c)) unmount(c); if (id) others.add(c); continue; }
        var st = state.get(c);
        if (!st || st.id !== id) { state.set(c, { id: id, sig: '', host: st && st.host }); }
        if (/\/shorts\//.test(link.getAttribute('href') || '')) c.setAttribute('data-oo-short', ''); else c.removeAttribute('data-oo-short');
        cards.add(c);
      }
    }
    render();
    mountBar(kind, page, wantFilter, wantSort);
  }

  function domFacts(card, id) {
    // Text fallback for a card no response named (first page in some layouts, other extensions' rewrites).
    if (items[id]) return items[id];
    var texts = [];
    card.querySelectorAll('#metadata-line span, .yt-content-metadata-view-model__metadata-text, .yt-content-metadata-view-model-wiz__metadata-text, .inline-metadata-item, [data-oo-meta]').forEach(function (s) { texts.push(s.textContent); });
    var badge = card.querySelector('.yt-badge-shape__text, ytd-thumbnail-overlay-time-status-renderer #text, badge-shape .badge-shape-wiz__text');
    if (badge) texts.push(badge.textContent);
    var r = Y.parseMetaTexts(texts, dataLang(texts.join(' ')), Date.now());
    r.code = id;
    var ch = card.querySelector('a[href^="/@"], a[href^="/channel/UC"]');
    if (ch) {
      var href = ch.getAttribute('href');
      var m = href.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})/);
      if (m) r.ownerId = m[1];
      var hd = Y.handleOf(href);
      if (hd) r.author = hd;
    }
    if (card.hasAttribute('data-oo-short')) r.type = 'short';
    return r;
  }

  var renderTimer = null;
  function scheduleRender() { if (!renderTimer) renderTimer = setTimeout(function () { renderTimer = null; render(); }, 120); }

  /** Badges (and the filters' / sort's numbers) for every managed card. Updates the DOM only where text changed. */
  function render() {
    var L = T();
    var lg = lang();
    var kind = pageKind();
    var showBadges = anyOn(BADGE_FEATURES) && kind !== 'short';
    var list = [];
    cards.forEach(function (c) {
      var st = state.get(c);
      if (!st || !c.isConnected) return;
      var rec = items[st.id];
      if (!rec) {
        // Text fallback, read once per video (again while YouTube hasn't filled the card in yet).
        if (!st.dom || st.dom.views == null) st.dom = domFacts(c, st.id);
        rec = st.dom;
      }
      var f = videoFacts(st.id, rec);
      st.facts = f;
      list.push(c);
      want(f);
      if (!showBadges) { if (st.host) { st.host.remove(); st.host = null; st.sig = ''; } return; }
      var chips = chipsFor(f, L, lg);
      var sig = JSON.stringify(chips);
      if (sig === st.sig && st.host && st.host.isConnected) return;
      st.sig = sig;
      paint(c, st, chips);
    });
    applyFilters(list);
    applySort(list);
    dirtyData = false;
  }

  function chipsFor(f, L, lg) {
    var out = [];
    if (FT.isOn('card-outlier') && f.outlier) {
      var o = f.outlier;
      var fmt = f.type === 'short' ? L.fmtShort : L.fmtLong;
      var tip = o.basis === 'median' ? fill(L.tipOutMedian, { x: I.times(o.value, lg), fmt: fmt, n: o.n })
        : o.source === 'channel' ? fill(L.tipOutMeanCh, { x: I.times(o.value, lg) }) : fill(L.tipOutMeanLib, { x: I.times(o.value, lg), n: o.n, fmt: fmt });
      out.push({ k: 'out' + (o.value >= I.OUTLIER ? ' oo-hot' : ''), t: I.times(o.value, lg), s: o.basis === 'mean' ? L.avg : '', tip: tip });
    }
    if (FT.isOn('card-velocity') && f.velocity && f.velocity.score != null) {
      var at = I.cpLabel(f.velocity.hours, lg);
      out.push({ k: 'vel', t: at + ' ' + I.times(f.velocity.score, lg), s: '', tip: fill(L.tipVel, { views: I.full(f.velocity.views, lg), at: at, x: I.times(f.velocity.score, lg) }) });
    }
    if (FT.isOn('card-vph') && f.vph) out.push({ k: 'vph', t: I.vphLabel(f.vph, lg), s: '', tip: f.vph.approx ? L.tipVphApprox : L.tipVph });
    if (FT.isOn('card-subs') && f.subs != null) out.push({ k: 'subs', t: I.compact(f.subs, lg), s: L.subs, tip: L.tipSubs + ' ' + I.full(f.subs, lg) });
    return out;
  }

  function thumbOf(card) {
    var t = card.querySelector(THUMB_SEL);
    if (!t) { var img = card.querySelector('img'); t = img && img.parentElement; }
    return t;
  }

  function paint(card, st, chips) {
    if (!chips.length) { if (st.host) { st.host.remove(); st.host = null; } return; }
    var thumb = thumbOf(card);
    if (!thumb) return;
    if (!st.host || st.host.parentNode !== thumb) {
      if (st.host) st.host.remove();
      st.host = document.createElement('oo-cq');
      st.host.appendChild(document.createElement('oo-badges'));
      if (getComputedStyle(thumb).position === 'static') thumb.style.position = 'relative';
      thumb.appendChild(st.host);
    }
    var box = st.host.firstChild;
    box.textContent = '';
    chips.forEach(function (c) {
      var b = document.createElement('oo-b');
      b.className = 'oo-' + c.k;
      b.textContent = c.t;
      if (c.s) { var i = document.createElement('i'); i.textContent = c.s; b.appendChild(i); }
      b.title = c.tip;
      box.appendChild(b);
    });
  }
  function unmount(card) {
    var st = state.get(card);
    if (st && st.host) st.host.remove();
    card.removeAttribute('data-oo-hidden');
    card.style.removeProperty('order');
    cards.delete(card);
    state.delete(card);
  }

  // ---- feed filters ---------------------------------------------------------------------------
  // One set of filters per feed (search / home / subscriptions), kept for this tab's session.
  var filterKind = pageKind();
  var filters = loadFilters(filterKind);
  var filterStats = { shown: 0, total: 0, missing: 0 };
  function loadFilters(kind) {
    try { var f = JSON.parse(sessionStorage.getItem('openoutlier-feed-filters:' + kind) || 'null'); if (f) return Object.assign(I.defaultFilters(), f); } catch (e) { /* none */ }
    return I.defaultFilters();
  }
  function saveFilters() { try { sessionStorage.setItem('openoutlier-feed-filters:' + filterKind, JSON.stringify(filters)); } catch (e) { /* ignore */ } }

  function applyFilters(list) {
    var kind = pageKind();
    var on = FT.isOn('feed-filters') && (kind === 'search' || kind === 'home' || kind === 'subscriptions') && I.activeFilters(filters) > 0;
    var shown = 0;
    var missing = 0;
    list.forEach(function (c) {
      var st = state.get(c);
      if (!on) { if (c.hasAttribute('data-oo-hidden')) c.removeAttribute('data-oo-hidden'); shown++; return; }
      var f = st.facts;
      var m = I.matchItem({ outlier: f.outlier && f.outlier.value, vph: f.vph && f.vph.value, duration: f.duration, views: f.views, publishedAt: f.publishedAt, subs: f.subs, type: f.type }, filters, Date.now());
      if (m.ok) { c.removeAttribute('data-oo-hidden'); shown++; } else { c.setAttribute('data-oo-hidden', ''); if (m.missing.length) missing++; }
    });
    others.forEach(function (c) {
      if (!c.isConnected) { others.delete(c); return; }
      if (on) c.setAttribute('data-oo-hidden', ''); else c.removeAttribute('data-oo-hidden');
    });
    // A shelf (Shorts …) whose every card is filtered out goes too, heading and all.
    var shelves = new Set();
    list.forEach(function (c) { var sh = c.parentElement && c.parentElement.closest(SHELF_SEL); if (sh) shelves.add(sh); });
    document.querySelectorAll('[data-oo-shelf-hidden]').forEach(function (sh) { shelves.add(sh); });
    shelves.forEach(function (sh) {
      var inside = list.filter(function (c) { return sh.contains(c); });
      var empty = on && inside.length && inside.every(function (c) { return c.hasAttribute('data-oo-hidden'); });
      if (empty) { sh.setAttribute('data-oo-hidden', ''); sh.setAttribute('data-oo-shelf-hidden', ''); }
      else if (sh.hasAttribute('data-oo-shelf-hidden')) { sh.removeAttribute('data-oo-hidden'); sh.removeAttribute('data-oo-shelf-hidden'); }
    });
    filterStats = { shown: shown, total: list.length, missing: missing };
    updateBar();
  }

  // ---- channel sort ----------------------------------------------------------------------------
  var sortOn = false;
  var sortLayoutOk = true;
  function applySort(list) {
    var kind = pageKind();
    var active = sortOn && FT.isOn('channel-sort') && kind === 'channel';
    var parents = new Set();
    list.forEach(function (c) { if (c.parentElement) parents.add(c.parentElement); });
    if (!active) {
      list.forEach(function (c) { if (c.style.order) c.style.removeProperty('order'); });
      parents.forEach(function (p) { var cont = p.querySelector(':scope > ytd-continuation-item-renderer'); if (cont) cont.style.removeProperty('order'); });
      return;
    }
    sortLayoutOk = true;
    parents.forEach(function (p) { var d = getComputedStyle(p).display; if (d.indexOf('flex') === -1 && d.indexOf('grid') === -1) sortLayoutOk = false; });
    if (!sortLayoutOk) return;
    var ranked = list.map(function (c) { var f = state.get(c).facts; return { c: c, v: f && f.outlier ? f.outlier.value : -1 }; });
    ranked.sort(function (a, b) { return b.v - a.v; });
    ranked.forEach(function (r, i) { var o = String(i + 1); if (r.c.style.order !== o) r.c.style.order = o; });
    parents.forEach(function (p) { var cont = p.querySelector(':scope > ytd-continuation-item-renderer'); if (cont) cont.style.order = '100000'; });
  }

  // ---- the bar above the results: Filters (search, home, subscriptions) or Sort (channel) ----------
  var bar = null;   // { host, root, kind }
  function barSlot(page, kind) {
    if (!page) return null;
    if (kind === 'search') {
      var sl = page.querySelector('ytd-section-list-renderer');
      var c = sl && sl.querySelector(':scope > #contents');
      return c ? { parent: sl, before: c } : null;
    }
    var grid = page.querySelector('ytd-rich-grid-renderer');
    var gc = grid && grid.querySelector(':scope > #contents');
    if (gc) return { parent: grid, before: gc };
    var slot = page.querySelector('[data-oo-bar-slot]');
    return slot ? { parent: slot, before: slot.firstChild } : null;
  }

  function mountBar(kind, page, wantFilter, wantSort) {
    var mode = wantFilter ? 'filters' : wantSort ? 'sort' : null;
    var slot = mode ? barSlot(page, kind) : null;
    if (!slot) { if (bar) { bar.host.remove(); bar = null; } return; }
    if (!bar || bar.mode !== mode) {
      if (bar) bar.host.remove();
      bar = buildBar(mode);
    }
    if (bar.host.parentNode !== slot.parent || bar.host.nextSibling !== slot.before) slot.parent.insertBefore(bar.host, slot.before);
    updateBar();
  }

  var BAR_CSS = [
    ':host{display:block;margin:0 0 12px;font:400 14px/20px Roboto,Arial,sans-serif;color:#0f0f0f;--chip:rgba(0,0,0,.05);--chip-h:rgba(0,0,0,.1);--line:rgba(0,0,0,.1);--muted:#606060;--pop:#fff;--ink:#0B0E1A;--blue:#1E3BFF;--lime:#C8FF2E;--paper:#F6F7F2;--focus:#1E3BFF}',
    ':host-context(html[dark]){color:#f1f1f1;--chip:rgba(255,255,255,.1);--chip-h:rgba(255,255,255,.2);--line:rgba(255,255,255,.2);--muted:#aaa;--pop:#212121;--focus:#C8FF2E}',
    '.row{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;min-height:32px}',
    '.btn{position:relative;display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px 0 10px;border:0;border-radius:8px;background:var(--chip);color:inherit;font:500 14px/1 Roboto,Arial,sans-serif;cursor:pointer;white-space:nowrap}',
    '.btn:hover{background:var(--chip-h)}',
    '.btn:focus-visible,.pop :focus-visible{outline:2px solid var(--focus);outline-offset:2px}',
    '.btn[aria-pressed="true"],.btn.has{background:var(--ink);color:var(--paper)}',
    ':host-context(html[dark]) .btn[aria-pressed="true"],:host-context(html[dark]) .btn.has{background:var(--paper);color:var(--ink)}',
    '.mk{width:14px;height:14px;flex:none;display:block}',
    '.n{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 4px;border-radius:4px;background:var(--lime);color:var(--ink);font-size:11.5px;font-weight:700;box-sizing:border-box}',
    '.st{color:var(--muted);font-size:13px;min-width:0}',
    '.st b{color:inherit;font-weight:500}',
    '.lnk{border:0;background:none;padding:0;color:inherit;font:inherit;text-decoration:underline;text-underline-offset:2px;cursor:pointer}',
    '.wrap{position:relative}',
    '.pop{position:absolute;top:calc(100% + 8px);left:0;z-index:2100;width:min(340px,calc(100vw - 32px));box-sizing:border-box;padding:12px 14px 14px;border-radius:12px;background:var(--pop);box-shadow:0 4px 32px rgba(0,0,0,.18),0 0 0 1px var(--line)}',
    '.pop[hidden]{display:none}',
    '.ph{display:flex;align-items:center;gap:8px;margin:0 0 6px;font-weight:500;font-size:15px}',
    '.ph .x{margin-left:auto;width:32px;height:32px;border:0;border-radius:50%;background:none;color:inherit;font-size:20px;line-height:1;cursor:pointer}',
    '.ph .x:hover{background:var(--chip)}',
    '.f{display:grid;grid-template-columns:1fr 120px;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--line)}',
    '.f:first-of-type{border-top:0}',
    '.f label{font-size:13px}',
    '.f input,.f select{box-sizing:border-box;width:100%;height:30px;padding:0 8px;border:1px solid var(--line);border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:13px;font-variant-numeric:tabular-nums}',
    '.f select option{background:var(--pop);color:inherit}',
    '.f.ck{grid-template-columns:1fr auto}',
    '.f.ck input{width:18px;height:18px;margin:0;accent-color:var(--blue)}',
    '.note{margin:8px 0 0;color:var(--muted);font-size:12px;line-height:16px}',
    '.foot{display:flex;align-items:center;gap:8px;margin-top:10px}',
    '.foot .sp{flex:1}',
    '.pill{height:30px;padding:0 12px;border:0;border-radius:15px;background:var(--chip);color:inherit;font:500 13px Roboto,Arial,sans-serif;cursor:pointer}',
    '.pill:hover{background:var(--chip-h)}',
    '.pill.pri{background:var(--blue);color:var(--paper)}',
    '@media (max-width:520px){.st{flex-basis:100%}}'
  ].join('\n');

  var MARK = '<svg class="mk" viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges"><path fill="currentColor" d="M4 2h6v2H4zM2 4h2v8H2zM10 4h2v8h-2zM4 12h6v2H4z"/><path fill="#C8FF2E" d="M12 2h2v2h-2zM14 0h2v2h-2z"/></svg>';

  function buildBar(mode) {
    var host = document.createElement('div');
    host.className = 'openoutlier-feedbar';
    host.setAttribute('data-openoutlier', mode);
    var root = host.attachShadow({ mode: 'open' });
    var b = { host: host, root: root, mode: mode, open: false };
    root.innerHTML = '<style>' + BAR_CSS + '</style><div class="row"></div>';
    b.row = root.querySelector('.row');
    root.addEventListener('keydown', function (e) { if (e.key === 'Escape' && b.open) { b.open = false; updateBar(); var t = root.querySelector('.btn'); if (t) t.focus(); } });
    document.addEventListener('click', function (e) { if (b.open && !e.composedPath().includes(host)) { b.open = false; updateBar(); } }, true);
    return b;
  }

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null && attrs[k] !== false) e.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }

  var barSig = '';
  function updateBar() {
    if (!bar) return;
    var L = T();
    var lg = lang();
    var sig = JSON.stringify([bar.mode, bar.open, lg, filters, filterStats, sortOn, sortLayoutOk, document.documentElement.hasAttribute('dark')]);
    if (sig === barSig && bar.row.childNodes.length) return;
    barSig = sig;
    var keepFocus = bar.root.activeElement && bar.root.activeElement.getAttribute('data-k');
    bar.row.textContent = '';
    if (bar.mode === 'sort') {
      var sb = el('button', { class: 'btn', type: 'button', 'aria-pressed': sortOn ? 'true' : 'false', title: L.sortTip, 'data-k': 'sort',
        onclick: function () { sortOn = !sortOn; render(); updateBar(); } }, []);
      sb.innerHTML = MARK;
      sb.appendChild(document.createTextNode(sortOn ? L.sortOn : L.sort));
      bar.row.appendChild(sb);
      if (sortOn && !sortLayoutOk) bar.row.appendChild(el('span', { class: 'st', text: L.sortNoLayout }));
      else if (sortOn) bar.row.appendChild(el('span', { class: 'st', text: fill(L.showingAll, { b: filterStats.total }) + ' · ' + L.loadedNote }));
      return;
    }
    var n = I.activeFilters(filters);
    var wrap = el('span', { class: 'wrap' });
    var btn = el('button', { class: 'btn' + (n ? ' has' : ''), type: 'button', 'aria-expanded': bar.open ? 'true' : 'false', 'aria-haspopup': 'dialog', 'data-k': 'open',
      onclick: function () { bar.open = !bar.open; updateBar(); } });
    btn.innerHTML = MARK;
    btn.appendChild(document.createTextNode(L.filters));
    if (n) btn.appendChild(el('span', { class: 'n', text: String(n) }));
    wrap.appendChild(btn);
    wrap.appendChild(popover(L, lg));
    bar.row.appendChild(wrap);
    var st = el('span', { class: 'st', role: 'status', 'aria-live': 'polite' });
    if (n) {
      st.appendChild(el('b', { text: fill(L.showing, { a: filterStats.shown, b: filterStats.total }) }));
      if (filterStats.missing) st.appendChild(document.createTextNode(' · ' + fill(L.noData, { n: filterStats.missing })));
      st.appendChild(document.createTextNode(' · '));
      st.appendChild(el('button', { class: 'lnk', type: 'button', 'data-k': 'reset', onclick: function () { filters = I.defaultFilters(); saveFilters(); render(); }, text: L.reset }));
    } else {
      st.textContent = fill(L.showingAll, { b: filterStats.total });
    }
    bar.row.appendChild(st);
    if (keepFocus) { var f = bar.root.querySelector('[data-k="' + keepFocus + '"]'); if (f) f.focus(); }
  }

  function popover(L, lg) {
    var pop = el('div', { class: 'pop', role: 'dialog', 'aria-label': L.filters, hidden: !bar.open });
    if (!bar.open) return pop;
    pop.appendChild(el('div', { class: 'ph' }, [el('span', { text: L.filters }), el('button', { class: 'x', type: 'button', 'aria-label': L.close, 'data-k': 'x', onclick: function () { bar.open = false; updateBar(); }, text: '×' })]));
    function numField(key, label, step, ph) {
      var id = 'oo-f-' + key;
      var input = el('input', { id: id, type: 'number', min: '0', step: step, inputmode: 'decimal', placeholder: ph, 'data-k': key, value: filters[key] != null ? String(filters[key]) : null });
      input.addEventListener('change', function () { var v = parseFloat(input.value); filters[key] = isFinite(v) && v > 0 ? v : null; saveFilters(); render(); });
      return el('div', { class: 'f' }, [el('label', { for: id, text: label }), input]);
    }
    function selField(key, label, opts) {
      var id = 'oo-f-' + key;
      var s = el('select', { id: id, 'data-k': key });
      opts.forEach(function (o) { var op = el('option', { value: String(o[0]), text: o[1] }); if (String(filters[key] == null ? '' : filters[key]) === String(o[0])) op.selected = true; s.appendChild(op); });
      s.addEventListener('change', function () { var v = s.value; filters[key] = key === 'length' ? v : (v ? Number(v) : null); saveFilters(); render(); });
      return el('div', { class: 'f' }, [el('label', { for: id, text: label }), s]);
    }
    pop.appendChild(numField('minOutlier', L.fOutlier + ' (×)', '0.5', L.any));
    pop.appendChild(numField('minVph', L.fVph, '10', L.any));
    pop.appendChild(numField('minViews', L.fViews, '1000', L.any));
    pop.appendChild(selField('maxAgeDays', L.fAge, [['', L.any], [1, L.age1], [7, L.age7], [30, L.age30], [365, L.age365]]));
    pop.appendChild(selField('length', L.fLength, [['any', L.any], ['under4', L.lenUnder4], ['4to20', L.len4to20], ['over20', L.lenOver20]]));
    pop.appendChild(numField('minViewsPerSub', L.fVps, '0.1', L.any));
    var ck = el('input', { id: 'oo-f-noShorts', type: 'checkbox', 'data-k': 'noShorts' });
    ck.checked = !!filters.noShorts;
    ck.addEventListener('change', function () { filters.noShorts = ck.checked; saveFilters(); render(); });
    pop.appendChild(el('div', { class: 'f ck' }, [el('label', { for: 'oo-f-noShorts', text: L.fNoShorts }), ck]));
    pop.appendChild(el('p', { class: 'note', text: L.loadedNote }));
    pop.appendChild(el('div', { class: 'foot' }, [
      el('span', { class: 'st', text: fill(L.showing, { a: filterStats.shown, b: filterStats.total }) }),
      el('span', { class: 'sp' }),
      el('button', { class: 'pill', type: 'button', 'data-k': 'reset2', onclick: function () { filters = I.defaultFilters(); saveFilters(); render(); }, text: L.reset }),
      el('button', { class: 'pill pri', type: 'button', 'data-k': 'done', onclick: function () { bar.open = false; updateBar(); }, text: L.close })
    ]));
    return pop;
  }

  // ---- switches and navigation ------------------------------------------------------------------
  function teardownAll() {
    cards.forEach(function (c) { unmount(c); });
    others.forEach(function (c) { c.removeAttribute('data-oo-hidden'); });
    others.clear();
    document.querySelectorAll('[data-oo-shelf-hidden]').forEach(function (sh) { sh.removeAttribute('data-oo-hidden'); sh.removeAttribute('data-oo-shelf-hidden'); });
    if (bar) { bar.host.remove(); bar = null; }
    document.documentElement.removeAttribute('data-oo-hide-shorts');
  }
  FT.onChange(function (changedIds) {
    if (changedIds.indexOf('outlierFormula') !== -1) { chAsked = {}; }
    if (!anyOn(ALL_FEATURES)) { teardownAll(); return; }
    cards.forEach(function (c) { var st = state.get(c); if (st) st.sig = ''; });
    scan();
  });

  function ours(n) { return n.nodeType !== 1 || /^OO-/.test(n.tagName) || (n.classList && n.classList.contains('openoutlier-feedbar')); }
  var mo = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      var t = m.target;
      // Our own nodes (badges, the bar) don't need a rescan.
      if (t && t.nodeType === 1 && /^OO-/.test(t.tagName)) continue;
      if (m.type === 'childList' && Array.prototype.every.call(m.addedNodes, ours) && Array.prototype.every.call(m.removedNodes, ours)) continue;
      scheduleScan();
      return;
    }
  });

  var lastPath = location.pathname + location.search;
  function onNav() {
    var p = location.pathname + location.search;
    if (p === lastPath) return;
    lastPath = p;
    if (pageKind() !== 'channel') sortOn = false;
    if (pageKind() !== filterKind) { filterKind = pageKind(); filters = loadFilters(filterKind); }
    if (bar) bar.open = false;
    scheduleScan();
  }

  FT.ready.then(function () {
    hookLib();
    scanInline();
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'hidden'] });
    document.addEventListener('yt-navigate-finish', function () { onNav(); scheduleScan(); });
    setInterval(onNav, 800);
    // Relative dates age: refresh the VPH once a minute.
    setInterval(function () { if (cards.size) { cards.forEach(function (c) { var st = state.get(c); if (st) st.sig = st.sig + '~'; }); scheduleRender(); } }, 60000);
    scan();
  });

  // ---- shared with youtube-pages.js -----------------------------------------------------------------
  self.OpenOutlierYTData = {
    lang: lang,
    items: items,
    videoFacts: videoFacts,
    accountOf: accountOf,
    baselineOf: baselineOf,
    profileOf: profileOf,
    lib: lib,
    channelInfo: function (uc) { return uc ? chInfo[uc] : undefined; },
    bridgeVideo: function (id) { return bridgeV[id]; },
    bridgeChannel: function (uc) { return bridgeC[uc]; },
    /** Ask channels.list (cached, with the user's key) for these channels now; resolves when the answer is in. */
    requestChannels: function (ids) {
      ids = (ids || []).filter(function (x) { return /^UC[A-Za-z0-9_-]{22}$/.test(String(x)) && !(x in chInfo) && !(chAsked[x] && Date.now() - chAsked[x] < 60000); });
      if (!ids.length) return Promise.resolve();
      ids.forEach(function (x) { chAsked[x] = Date.now(); });
      return requestChannels(ids);
    },
    noKey: function () { return chNoKey; },
    bridgeKnown: function () { return bridgeOk; },
    send: send,
    onData: function (cb) { dataSubs.push(cb); return function () { dataSubs = dataSubs.filter(function (x) { return x !== cb; }); }; },
    addItems: addItems,
    pageKind: pageKind,
    activePage: activePage,
    dataLang: dataLang
  };
})();
