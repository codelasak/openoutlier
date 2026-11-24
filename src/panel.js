// OpenOutlier – the on-page panel (Shadow DOM, so Instagram's CSS can't touch it
// and ours can't leak out). All text is set via textContent, never innerHTML.
(function (root) {
  'use strict';
  var M = root.ReelScopeMetrics;
  var B = root.OpenOutlierBrand || null;

  var nf = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
  var nfFull = new Intl.NumberFormat();
  var df = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  function fmt(n) { return n === null || n === undefined ? '–' : nf.format(n); }
  function fmtFull(n) { return n === null || n === undefined ? '–' : nfFull.format(Math.round(n)); }
  function pct(n) {
    if (n === null || n === undefined) return '–';
    return n.toFixed(n < 1 ? 2 : n < 10 ? 1 : 0) + '%';
  }
  function dur(s) {
    if (!(s > 0)) return '';
    s = Math.round(s);
    if (s >= 3600) return Math.floor(s / 3600) + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    return s < 60 ? s + 's' : Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function hourRange(block, size) {
    var a = block * size;
    var b = a + size;
    return String(a).padStart(2, '0') + ':00–' + String(b % 24).padStart(2, '0') + ':00';
  }

  /** Tiny DOM builder: h('div', {class: 'x', onclick: fn}, child, 'text', ...) */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style') { for (var s in v) el.style.setProperty(s, v[s]); }
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, String(v));
      }
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }

  // Pixel icons (filled, on a 16-unit grid, crisp edges): the brand's square-pixel language.
  var PX_CLOSE = 'M2 2h2v2H2zM4 4h2v2H4zM6 6h4v4H6zM10 4h2v2h-2zM12 2h2v2h-2zM4 10h2v2H4zM2 12h2v2H2zM10 10h2v2h-2zM12 12h2v2h-2z';
  var PX_BACK = 'M6 3h2v2H6zM4 5h2v2H4zM2 7h12v2H2zM4 9h2v2H4zM6 11h2v2H6z';
  var PX_GRID = 'M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z';
  var DL_PATH = 'M12 4v11M7 10l5 5 5-5M5 20h14';
  var IMG_PATH = 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5a1 1 0 1 0 0-.01';
  function icon(path, size) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size || 16);
    svg.setAttribute('height', size || 16);
    svg.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(NS, 'path');
    p.setAttribute('d', path);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '2');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
    return svg;
  }
  function pxIcon(path, size) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', size || 16);
    svg.setAttribute('height', size || 16);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('shape-rendering', 'crispEdges');
    var p = document.createElementNS(NS, 'path');
    p.setAttribute('d', path);
    p.setAttribute('fill', 'currentColor');
    svg.appendChild(p);
    return svg;
  }
  /** Three pixels rising up and to the right (the logo's trail): marks an outlier. */
  function stair() { return h('span', { class: 'stair', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')); }
  /** Decorative Haze pixels, rising up-right, for the blue band only. */
  function hazePixels() {
    var pts = [[0, 8], [8, 8], [8, 4], [16, 4], [16, 0], [24, 0], [40, 8], [48, 4], [56, 0], [76, 8], [84, 4], [92, 0], [100, 0]];
    return h('span', { class: 'hazepx', 'aria-hidden': 'true' }, pts.map(function (q) { return h('i', { style: { left: q[0] + 'px', top: q[1] + 'px' } }); }));
  }
  function logo(name, cls, label) {
    if (B) return B.logo(name, cls, label);
    return h('span', { class: cls, text: label || '' });
  }
  /** "9.0×" badge for posts at or above the outlier ratio: lime on ink (light) / ink on lime (dark). */
  function outlierBadge(p, tip) {
    return h('span', { class: 'badge badge-outlier', 'data-tip': tip || null }, stair(), p.ratio.toFixed(1) + '×');
  }
  /**
   * The verdict block of the detail card: × median in the display face plus Viral Score
   * as a 20-pixel meter (each pixel = 5 points; pixels above 75 = 2× are lime when lit).
   */
  function verdict(p, what) {
    if (!p.ratio) return null;
    var score = p.viralScore != null ? p.viralScore : null;
    var meter = h('div', { class: 'meter', 'aria-hidden': 'true' });
    for (var i = 1; i <= 20; i++) {
      var v = i * 5;
      meter.appendChild(h('i', { class: score !== null && v <= score ? (v > 75 ? 'hot' : 'on') : null }));
    }
    return h('div', { class: 'verdict' + (p.outlier ? ' is-outlier' : ''), 'data-tip': 'Viral Score: 50 = median, 75 = 2×, 100 = 4× or more' },
      h('div', { class: 'verdict-big' }, p.ratio.toFixed(1) + '×'),
      h('div', { class: 'verdict-what' }, what, score !== null ? [' · Viral Score ', h('b', { text: String(score) })] : null),
      score !== null ? meter : null,
      score !== null ? h('div', { class: 'meter-scale', 'aria-hidden': 'true' },
        h('span', { style: { left: '0' }, text: '0' }), h('span', { style: { left: '50%' }, text: 'median' }),
        h('span', { style: { left: '75%' }, text: '2×' }), h('span', { style: { left: '100%' }, text: '4×' })) : null);
  }

  var SORT_OPTIONS = [
    ['views', 'Views'],
    ['viralScore', 'Viral Score'],
    ['likes', 'Likes'],
    ['comments', 'Comments'],
    ['shares', 'Shares'],
    ['engagement', 'Engagement rate'],
    ['date', 'Newest'],
    ['duration', 'Longest'],
    ['commentRatio', 'Comments × median']
  ];
  var REDDIT_SORT_OPTIONS = [
    ['views', 'Score'],
    ['viralScore', 'Viral Score (× median)'],
    ['comments', 'Comments'],
    ['upvoteRatio', 'Upvote ratio'],
    ['engagement', 'Comments per score'],
    ['date', 'Newest']
  ];
  // Instagram + TikTok lists (TikTok shows saves publicly).
  var VIDEO_SORT_OPTIONS = SORT_OPTIONS.slice(0, 5).concat([['saves', 'Saves']], SORT_OPTIONS.slice(5));
  // YouTube: likes and comments only come from watch pages, so they sort after views and score.
  var YOUTUBE_SORT_OPTIONS = [
    ['views', 'Views'],
    ['viralScore', 'Viral Score'],
    ['duration', 'Longest'],
    ['date', 'Newest'],
    ['likes', 'Likes'],
    ['comments', 'Comments'],
    ['engagement', 'Engagement rate']
  ];
  // X: replies, reposts, quotes and bookmarks are all public.
  var X_SORT_OPTIONS = [
    ['viralScore', 'Viral Score'],
    ['views', 'Views'],
    ['likes', 'Likes'],
    ['comments', 'Replies'],
    ['shares', 'Reposts'],
    ['quotes', 'Quotes'],
    ['saves', 'Bookmarks'],
    ['engagement', 'Engagement rate'],
    ['date', 'Newest']
  ];
  var X_FORMAT_NAMES = { text: 'Text', image: 'Image', video: 'Video', thread: 'Thread', article: 'Article', link: 'Link', quote: 'Quote' };
  var YOUTUBE_SORT_TR = { views: 'İzlenme', viralScore: 'Viral Skor', duration: 'En uzun', date: 'En yeni', likes: 'Beğeni', comments: 'Yorum', engagement: 'Etkileşim oranı' };

  // The panel's chrome in Turkish when the page asks for it (opts.lang; the YouTube panel). Instagram, TikTok and
  // Reddit panels, and the analytics / export bodies, stay English.
  var CHROME_TR = {
    open: 'OpenOutlier\'ı aç', close: 'Kapat', closeTip: 'Kapat (Esc)', library: 'Library\'yi aç', libraryTip: 'Library\'yi aç: bütün kayıtlı hesaplar, klasörler ve etiketler',
    profile: 'Profil', noProfiles: 'Henüz profil yok', clear: 'Temizle', clearConfirm: '{a} için kayıtlı gönderiler silinsin mi?', auto: 'Otomatik kaydır', stop: 'Durdur', stopTip: 'Kaydırmayı durdur',
    videos: 'Videolar', analytics: 'Analiz', export: 'Dışa aktar', details: 'Gönderi ayrıntıları', collected: '{n} gönderi toplandı',
    sort: 'Sırala', sortBy: 'Sıralama', outliers: 'Sadece outlier\'lar', search: 'Başlıklarda veya #etiketlerde ara', format: 'Biçim', fmtVideos: 'Videolar',
    fmtVideosTip: 'Uzun videolar ve geçmiş canlı yayınlar, kendi medyanlarına göre', fmtShortsTip: 'Shorts, Shorts medyanına göre',
    ytEmpty: 'Henüz YouTube videosu toplanmadı', ytE1: 'Bir kanalın Videolar ya da Shorts sekmesini aç, örn. ', ytE2: 'Aşağı kaydır ya da Otomatik kaydır\'a bas. Videolar YouTube yükledikçe toplanır.',
    ytE3: 'Kesin izlenme, beğeni ve tarih için bir videoyu aç. Sıralamak, analiz etmek ve dışa aktarmak için buraya dön.',
    viewsUnit: 'izlenme', allRounded: 'İzlenmeler YouTube\'un yuvarladığı sayılar (63 B, 1,2 Mn); medyanla karşılaştırmaya yeter. Kesin sayılar için videoyu aç.',
    someRounded: '{b} izlenmenin {a} tanesi YouTube\'un yuvarladığı sayı; gerisi kesin (açılan videolar).', exact: 'Kesin istatistikleri al', exactTop: 'Viral Skor\'a göre ilk {n} için', exactDone: 'İlk {n} kesin',
    ytEnote: 'Her şey bu tarayıcıda kalır. OpenOutlier sadece YouTube\'un zaten yüklediğini okur; beğenmez, abone olmaz, yorum yapmaz, paylaşmaz.'
  };
  var MIXED_SORT_OPTIONS = [
    ['viralScore', 'Viral Score'],
    ['views', 'Views / score'],
    ['comments', 'Comments'],
    ['date', 'Newest']
  ];
  var REDDIT_TYPES = [['all', 'All posts'], ['text', 'Text'], ['image', 'Image'], ['video', 'Video'], ['link', 'Link'], ['gallery', 'Gallery']];
  var PAGE = 150;
  var EXACT_TOP = 10; // YouTube "Get exact stats": how many of the top videos (by Viral Score) it opens at most

  /**
   * 'instagram' | 'tiktok' | 'reddit' | 'mixed' for a list of posts.
   * Instagram + TikTok counts as 'instagram' (both ranked by views); 'mixed' = Reddit with others.
   */
  function platformOf(posts) {
    var r = 0;
    var t = 0;
    var y = 0;
    var x = 0;
    for (var i = 0; i < posts.length; i++) { if (posts[i].platform === 'reddit') r++; else if (posts[i].platform === 'tiktok') t++; else if (posts[i].platform === 'youtube') y++; else if (posts[i].platform === 'x') x++; }
    if (r) return r === posts.length ? 'reddit' : 'mixed';
    if (x && x === posts.length) return 'x';
    if (y && y === posts.length) return 'youtube';
    return t && t === posts.length ? 'tiktok' : 'instagram';
  }
  /** Account id as shown: "@name" for Instagram, "@name (TikTok)" / "@name (YouTube)", "r/excel" / "u/name" for Reddit. */
  function accountLabel(id) {
    var s = String(id || '');
    if (/^(r|u)\//.test(s)) return s;
    if (/^tt\//.test(s)) return '@' + s.slice(3) + ' (TikTok)';
    if (/^x\//.test(s)) return '@' + s.slice(2) + ' (X)';
    if (/^yt\/UC/.test(s)) return s.slice(3) + ' (YouTube)';
    if (/^yt\//.test(s)) return '@' + s.slice(3) + ' (YouTube)';
    return '@' + s;
  }
  function ownerHandle(p) {
    if (!p || !p.owner) return '';
    if (/^yt\//.test(p.owner)) return p.author ? '@' + p.author : p.ownerName || p.owner.slice(3);
    if (isX(p)) return '@' + (p.author || p.owner.slice(2));
    return '@' + String(p.owner).replace(/^tt\//, '');
  }
  function isReddit(p) { return p && p.platform === 'reddit'; }
  function isTT(p) { return p && p.platform === 'tiktok'; }
  function isYT(p) { return p && p.platform === 'youtube'; }
  function isX(p) { return !!p && p.platform === 'x'; }
  function siteName(p) { return isReddit(p) ? 'Reddit' : isTT(p) ? 'TikTok' : isYT(p) ? 'YouTube' : isX(p) ? 'X' : 'Instagram'; }
  /** X: what an X post's × median compares with, for tooltips. */
  function xBaseTip(p) {
    if (p.noViews) return 'X shows no view count on this post (posts before 2023 have none), so it has no score and stays out of the median';
    if (p.ratio == null) return p.kind === 'repost' ? 'A repost has no views of its own' : 'Not enough data: the median needs 8 original posts with a view count';
    var f = X_FORMAT_NAMES[p.type] || 'Text';
    if (p.baselineScope === 'format') return 'Views ÷ the median of this account\'s ' + f.toLowerCase() + ' posts' + (p.baselineApprox ? ' (≈ estimated from the posts on this page)' : '');
    return '≈ Views ÷ this account\'s overall median of original posts' + (p.kind === 'original' ? ' (fewer than 8 ' + f.toLowerCase() + ' posts with views to compare with)' : ' (replies and thread parts are compared with the originals)');
  }
  function engagementTip(p) {
    if (isX(p)) return '(likes + replies + reposts + quotes + bookmarks) ÷ views';
    if (isYT(p)) return p.likes == null && p.comments == null ? 'Likes and comments load when the video is opened on YouTube' : '(likes + comments) ÷ views';
    return isTT(p) ? '(likes + comments + shares + saves) ÷ views' : '(likes + comments) ÷ views';
  }
  var mf = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' });
  /** A date for a row: exact, or "≈ Oct 2026" when YouTube only said "1 month ago". */
  function dateLabel(p) {
    if (!p.takenAt) return '';
    return p.dateApprox && !p.dateDay ? '≈ ' + mf.format(new Date(p.takenAt)) : df.format(new Date(p.takenAt));
  }
  function viewsTip(p) {
    if (p.views === null || p.views === undefined) return 'Views not available for this post';
    if (isYT(p) && p.viewsApprox) return 'About ' + fmtFull(p.views) + ' views: YouTube rounds counts on channel pages. Opening the video gives the exact number.';
    return fmtFull(p.views) + ' views';
  }
  function unitOf(p) { return isReddit(p) ? 'score' : 'views'; }
  var TYPE_NAMES = { reel: 'Reel', video: 'Video', photo: 'Photo', carousel: 'Carousel', text: 'Text post', image: 'Image', link: 'Link', gallery: 'Gallery', poll: 'Poll', crosspost: 'Crosspost', unknown: 'Post' };

  /**
   * create(opts) → panel controller.
   * opts: {
   *   cssText, onAutoScroll(), onClearProfile(user), onSelectProfile(user),
   *   onDownload(name, text, mime), onCopy(text), onDownloadMedia(posts, what, onProgress?), onOpenDashboard(),
   *   embedded: true  → render inline (no launcher/drawer chrome), used by the dashboard page
   *   preEnriched: true → posts already carry ratio/viralScore (e.g. scored per account)
   *   showOwner: true  → show @owner on each row (multi-account lists)
   *   loadImage(img, url) → optional custom image loader (dashboard cache)
   *   onExactStats(posts) / onExactCancel() → YouTube "Get exact stats" (posts: the scored list of the open format);
   *     progress comes back in update({ exact: { running, label } })
   *   features: true → a Features tab (src/features-view.js); update({ features: { flags, env, message } })
   *     feeds it, onFeatureToggle(id, on) / onFeatureFix(code, id) / onFeatureReset() act on it
   *   onApiStats('exact' | 'uploads') → YouTube with the user's Data API key; shown only while
   *     update({ api: { configured, used, limit, running, label } }) has an api object
   * }
   */
  function create(opts) {
    var embedded = !!opts.embedded;
    /** A chrome string: Turkish when opts.lang() says so, else the English given. */
    function tx(key, en, vars) {
      var t = opts.lang && opts.lang() === 'tr' && CHROME_TR[key] != null ? CHROME_TR[key] : en;
      return vars ? String(t).replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; }) : t;
    }
    var host = document.createElement('div');
    host.id = embedded ? 'reelscope-embedded' : 'reelscope-root';
    if (!embedded) host.style.setProperty('all', 'initial');
    var shadow = host.attachShadow({ mode: 'open' });
    try {
      var sheet = new CSSStyleSheet();
      sheet.replaceSync(opts.cssText || '');
      shadow.adoptedStyleSheets = [sheet];
    } catch (e) {
      shadow.appendChild(h('style', { text: opts.cssText || '' }));
    }

    var ui = {
      open: embedded,
      tab: 'reels',
      sort: opts.defaultSort || 'views',
      typeFilter: 'reels',
      ytFormat: 'long',  // YouTube: 'long' (videos + past streams) or 'short'
      ytHint: null,      // the last format the page suggested (Shorts tab → 'short')
      outliersOnly: false,
      query: '',
      shown: PAGE,
      detail: null // code of the post shown in the detail card
    };
    var state = { profiles: [], selected: null, posts: [], auto: { running: false, label: '' }, collect: null, exact: null };
    var plat = 'instagram'; // platform of the current list, set in render()
    var hasTT = false;      // the list has TikTok videos (adds the Saves sort)
    var multiPlat = false;  // the list mixes platforms (rows get a platform badge)
    function sortOptions() {
      var yt = opts.lang && opts.lang() === 'tr' ? YOUTUBE_SORT_OPTIONS.map(function (o) { return [o[0], YOUTUBE_SORT_TR[o[0]] || o[1]]; }) : YOUTUBE_SORT_OPTIONS;
      var all = plat === 'reddit' ? REDDIT_SORT_OPTIONS : plat === 'mixed' ? MIXED_SORT_OPTIONS : plat === 'youtube' ? yt : plat === 'x' ? X_SORT_OPTIONS : hasTT ? VIDEO_SORT_OPTIONS : SORT_OPTIONS;
      // Carousels and photos have no views, length or view-based engagement to sort by.
      return basis === 'likes' ? all.filter(function (o) { return LIKES_ONLY_HIDDEN.indexOf(o[0]) === -1; }) : all;
    }
    var LIKES_ONLY_HIDDEN = ['views', 'duration', 'engagement'];
    /** The sort in effect: "Views" (the default) means likes while the list is carousels and photos. */
    function sortKey() { return basis === 'likes' && LIKES_ONLY_HIDDEN.indexOf(ui.sort) !== -1 ? 'likes' : ui.sort; }
    function listTab() { return plat === 'youtube' || opts.listTabLabel === 'Videos' ? tx('videos', opts.listTabLabel || 'Videos') : opts.listTabLabel || (plat === 'instagram' ? 'Reels' : plat === 'tiktok' ? 'Videos' : 'Posts'); }
    function ytFormatOf(p) { return p.type === 'short' ? 'short' : 'long'; }
    // What the open list is ranked by: 'views', 'likes' (Instagram carousels and photos) or 'mixed' (both in one list).
    var basis = 'views';
    function basisOfList(posts) {
      var likes = posts.filter(M.isLikesScored).length;
      return !likes ? 'views' : likes === posts.length ? 'likes' : 'mixed';
    }
    function unit() { return plat === 'reddit' ? 'score' : plat === 'mixed' ? 'views / score' : basis === 'likes' ? 'likes' : 'views'; }
    function igPosts() { return state.posts.filter(M.isLikesScored).length; }

    // ---- skeleton -----------------------------------------------------------
    var launcherCount = h('span', { class: 'launcher-count', text: '0' });
    var launcher = h('button', { class: 'launcher', type: 'button', 'aria-label': tx('open', 'Open OpenOutlier'), 'data-tip': 'OpenOutlier', onclick: function () { toggle(true); } },
      logo('mark', 'mark'), h('span', { class: 'launcher-sep', 'aria-hidden': 'true' }), launcherCount);

    var profileSelect = h('select', { class: 'profile-select', 'aria-label': tx('profile', 'Profile'), onchange: function () { opts.onSelectProfile(profileSelect.value); } });
    var autoBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { opts.onAutoScroll(); } });
    var autoStatus = h('span', { class: 'status', 'aria-live': 'polite' });
    var collectBtn = opts.onCollect ? h('button', { class: 'btn', type: 'button', onclick: function () { opts.onCollect(); } }) : null;
    // YouTube: "Track" adds the open channel to niche tracking (src/tracking.js); state.track from the content script.
    var trackBtn = opts.onTrackToggle ? h('button', { class: 'btn track-btn', type: 'button', hidden: true, onclick: function () { opts.onTrackToggle(); } }) : null;
    var clearBtn = h('button', { class: 'btn btn-ghost', type: 'button', onclick: function () {
      if (state.selected && confirm(tx('clearConfirm', 'Delete the saved posts for {a}?', { a: accountLabel(state.selected) }))) opts.onClearProfile(state.selected);
    } }, tx('clear', 'Clear'));

    var tabs = {};
    var tabBar = h('div', { class: 'tabs', role: 'tablist' });
    var tabList = [['reels', opts.listTabLabel || 'Reels'], ['analytics', tx('analytics', 'Analytics')], ['export', tx('export', 'Export')]];
    // YouTube: every switchable feature (src/features.js), in the page's language.
    if (opts.features && root.OpenOutlierFeaturesView) tabList.push(['features', root.OpenOutlierFeatures.uiLang() === 'tr' ? 'Özellikler' : 'Features']);
    tabList.forEach(function (t) {
      tabs[t[0]] = h('button', { class: 'tab', type: 'button', role: 'tab', onclick: function () {
        if (ui.tab !== t[0]) body.scrollTop = 0;
        ui.tab = t[0];
        ui.detail = null; // a tab always shows its own content, not a detail card left open
        render();
      } }, t[1]);
      tabBar.appendChild(tabs[t[0]]);
    });

    var body = h('div', { class: 'body' });
    var detailEl = h('div', { class: 'detail', role: 'dialog', 'aria-label': tx('details', 'Post details'), hidden: true });
    var dashBtn = opts.onOpenDashboard
      ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': tx('library', 'Open the Library'), 'data-tip': tx('libraryTip', 'Open the Library: all saved accounts, folders and tags'), onclick: function () { opts.onOpenDashboard(); } }, pxIcon(PX_GRID, 16))
      : null;
    var drawer = h('aside', { class: 'drawer' + (embedded ? ' embedded' : ''), 'aria-label': 'OpenOutlier', hidden: !embedded },
      embedded ? null : h('header', { class: 'head' },
        h('div', { class: 'head-row' },
          logo('wordmark', 'wordmark', 'OpenOutlier'),
          profileSelect,
          dashBtn,
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': tx('close', 'Close'), 'data-tip': tx('closeTip', 'Close (Esc)'), onclick: function () { toggle(false); } }, pxIcon(PX_CLOSE, 16))),
        hazePixels()),
      embedded ? null : h('div', { class: 'toolbar' }, autoBtn, collectBtn, trackBtn, autoStatus, clearBtn),
      tabBar,
      h('div', { class: 'body-wrap' }, body, detailEl));
    var tooltip = h('div', { class: 'tooltip', role: 'tooltip', hidden: true });
    if (!embedded) shadow.appendChild(launcher);
    shadow.appendChild(drawer);
    shadow.appendChild(tooltip);

    // ---- tooltips (any element with data-tip) -------------------------------
    shadow.addEventListener('pointerover', function (e) {
      var t = e.target.closest && e.target.closest('[data-tip]');
      if (!t) { tooltip.hidden = true; return; }
      tooltip.textContent = t.getAttribute('data-tip');
      tooltip.hidden = false;
    });
    shadow.addEventListener('pointermove', function (e) {
      if (tooltip.hidden) return;
      var over = e.target.closest && e.target.closest('[data-tip]');
      if (over && tooltip.textContent !== over.getAttribute('data-tip')) tooltip.textContent = over.getAttribute('data-tip');
      var x =Math.min(e.clientX + 12, window.innerWidth - tooltip.offsetWidth - 8);
      var y = e.clientY + 16;
      if (y + tooltip.offsetHeight > window.innerHeight - 8) y = e.clientY - tooltip.offsetHeight - 10;
      tooltip.style.setProperty('left', x + 'px');
      tooltip.style.setProperty('top', y + 'px');
    });
    shadow.addEventListener('pointerout', function (e) {
      if (!e.relatedTarget || !(e.relatedTarget.closest && e.relatedTarget.closest('[data-tip]'))) tooltip.hidden = true;
    });
    shadow.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (ui.detail) { closeDetail(); return; }
      if (!embedded) toggle(false);
    });

    function toggle(open) {
      if (embedded) return;
      ui.open = open === undefined ? !ui.open : open;
      drawer.hidden = !ui.open;
      launcher.hidden = ui.open || !!ui.launcherOff;
      if (ui.open) render();
    }

    /** Hide the floating button where it would sit on a video player (YouTube watch pages and Shorts). */
    function setLauncherHidden(off) {
      ui.launcherOff = !!off;
      if (!embedded) launcher.hidden = ui.open || ui.launcherOff;
    }

    function applyTheme() {
      var de = document.documentElement;
      var dark = de.classList.contains('__fb-dark-mode') || de.classList.contains('theme-dark') ||
        (!de.classList.contains('__fb-light-mode') && !de.classList.contains('theme-light') && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      host.setAttribute('data-theme', dark ? 'dark' : 'light');
    }

    // ---- data shaping --------------------------------------------------------
    function xTypeOk(p) {
      var k = M.xKind(p);
      if (ui.typeFilter === 'all') return true;
      if (ui.typeFilter === 'replies') return k === 'reply' || k === 'thread-part';
      if (ui.typeFilter === 'reposts') return k === 'repost';
      if (ui.typeFilter.indexOf('fmt:') === 0) return k === 'original' && p.type === ui.typeFilter.slice(4);
      return k === 'original';
    }
    function filtered() {
      if (plat === 'x') return finish(opts.preEnriched ? state.posts.filter(xTypeOk) : M.enrich(state.posts).filter(xTypeOk));
      var base = state.posts.filter(function (p) {
        // YouTube: one format at a time (Shorts and long-form have separate medians).
        if (isYT(p)) return plat !== 'youtube' || ytFormatOf(p) === ui.ytFormat;
        if (isReddit(p)) return ui.typeFilter === 'reels' || ui.typeFilter === 'all' || ui.typeFilter === 'posts' || p.type === ui.typeFilter;
        // X in a mixed list (Library top posts): every original post, whatever its format.
        if (isX(p)) return ui.typeFilter === 'all' || M.xKind(p) === 'original';
        if (ui.typeFilter === 'reels') return p.type === 'reel' || p.type === 'video';
        // Instagram carousels and photos: no view count, so they are ranked by likes on their own median.
        if (ui.typeFilter === 'posts') return M.isLikesScored(p);
        return ui.typeFilter === 'all';
      });
      return finish(opts.preEnriched ? base : M.enrich(base));
    }
    function finish(enriched) {
      basis = basisOfList(enriched);
      var q = ui.query.trim().toLowerCase();
      var out = enriched.filter(function (p) {
        if (ui.outliersOnly && !p.outlier) return false;
        if (q && (p.caption || '').toLowerCase().indexOf(q) === -1 && (p.hashtags || []).join(' ').indexOf(q.replace(/^#/, '')) === -1 &&
          String(p.flair || '').toLowerCase() !== q.replace(/^flair:/, '')) return false;
        return true;
      });
      return { all: enriched, list: M.sortBy(out, sortKey()) };
    }

    // ---- render --------------------------------------------------------------
    function render() {
      applyTheme();
      var total = state.posts.length;
      plat = state.platform || platformOf(state.posts);
      if (plat !== 'instagram') basis = 'views'; // likes-ranked lists are Instagram only (set again in filtered())
      hasTT = state.posts.some(isTT);
      multiPlat = state.posts.some(isTT) + state.posts.some(isReddit) + state.posts.some(isYT) + state.posts.some(isX) + state.posts.some(function (p) { return !isTT(p) && !isReddit(p) && !isYT(p) && !isX(p); }) > 1;
      if (plat === 'x' && ['reels', 'all', 'replies', 'reposts'].indexOf(ui.typeFilter) === -1 && ui.typeFilter.indexOf('fmt:') !== 0) ui.typeFilter = 'reels';
      if (plat !== 'x' && (ui.typeFilter === 'replies' || ui.typeFilter === 'reposts' || ui.typeFilter.indexOf('fmt:') === 0)) ui.typeFilter = 'reels';
      if (plat === 'youtube') {
        // Follow the channel tab that is open (Shorts tab → Shorts), but keep the user's own pick until it changes.
        if (state.view && state.view !== ui.ytHint) { ui.ytHint = state.view; ui.ytFormat = state.view; }
        var nShort = state.posts.filter(function (p) { return p.type === 'short'; }).length;
        if (ui.ytFormat === 'short' && !nShort && state.posts.length) ui.ytFormat = 'long';
        else if (ui.ytFormat === 'long' && nShort === state.posts.length) ui.ytFormat = 'short';
      }
      if (plat === 'reddit' && !sortOptions().some(function (o) { return o[0] === ui.sort; })) ui.sort = 'views';
      if (plat !== 'instagram' && !sortOptions().some(function (o) { return o[0] === ui.sort; })) ui.sort = 'viralScore';
      tabs.reels.textContent = listTab();
      // The dashboard reuses one panel for every platform: drop a Reddit-only type filter on video lists.
      if ((plat === 'instagram' || plat === 'tiktok') && ui.typeFilter !== 'reels' && ui.typeFilter !== 'all' && !(ui.typeFilter === 'posts' && igPosts())) ui.typeFilter = 'reels';
      // A profile collected from its main grid only: open on what there is.
      if (plat === 'instagram' && ui.typeFilter === 'reels' && igPosts() && igPosts() === state.posts.length) ui.typeFilter = 'posts';
      launcherCount.textContent = fmtFull(total);

      // profile select
      profileSelect.textContent = '';
      if (!state.profiles.length) profileSelect.appendChild(h('option', { value: '', text: tx('noProfiles', 'No profiles yet') }));
      state.profiles.forEach(function (p) {
        profileSelect.appendChild(h('option', { value: p.username, selected: p.username === state.selected, text: accountLabel(p.username) + ' (' + p.count + ')' }));
      });
      profileSelect.disabled = !state.profiles.length;

      autoBtn.textContent = state.auto.running ? tx('stop', 'Stop') : tx('auto', 'Auto-scroll');
      autoBtn.setAttribute('data-tip', state.auto.running ? tx('stopTip', 'Stop scrolling') : (opts.autoTip ? (typeof opts.autoTip === 'function' ? opts.autoTip() : opts.autoTip) : 'Scroll this page automatically until every reel has loaded'));
      tabs.analytics.textContent = tx('analytics', 'Analytics');
      tabs.export.textContent = tx('export', 'Export');
      if (tabs.features && root.OpenOutlierFeatures) tabs.features.textContent = root.OpenOutlierFeatures.uiLang() === 'tr' ? 'Özellikler' : 'Features';
      if (collectBtn) {
        var c = state.collect || {};
        collectBtn.textContent = c.running ? 'Stop collecting' : (c.label || 'Collect top posts');
        collectBtn.disabled = !c.running && !c.enabled;
        collectBtn.setAttribute('data-tip', c.tip || '');
      }
      if (trackBtn) renderTrack();
      autoStatus.textContent = state.auto.label || (total ? tx('collected', '{n} posts collected', { n: fmtFull(total) }) : '');
      autoStatus.setAttribute('data-tip', state.auto.label || '');
      clearBtn.disabled = !state.selected;

      Object.keys(tabs).forEach(function (k) {
        tabs[k].setAttribute('aria-selected', k === ui.tab ? 'true' : 'false');
      });
      if (!ui.open) return;

      // Re-rendering replaces the body, so keep scroll position and focus.
      var scrollTop = body.scrollTop;
      var active = shadow.activeElement;
      var focusKey = active && body.contains(active) ? (ui.tab === 'features' && active.closest('[data-feature]') ? active.closest('[data-feature]').getAttribute('data-feature') : active.getAttribute('aria-label')) : null;
      var caret = focusKey && active.selectionStart != null ? active.selectionStart : null;

      body.textContent = '';
      if (ui.tab === 'features' && tabs.features) {
        // Not tied to the collected posts: works on any YouTube page, even before anything is saved.
        detailEl.hidden = true;
        body.appendChild(renderFeatures());
        body.scrollTop = scrollTop;
        if (focusKey) { var f = body.querySelector('[data-feature="' + focusKey.replace(/"/g, '') + '"] input'); if (f) f.focus(); }
        return;
      }
      if (state.notice) body.appendChild(h('p', { class: 'note', role: 'status', text: state.notice }));
      if (!total) { body.appendChild(emptyState()); detailEl.hidden = true; return; }
      var data = filtered();
      if (ui.tab === 'reels') body.appendChild(renderReels(data));
      else if (ui.tab === 'analytics') body.appendChild(renderAnalytics(data.all));
      else body.appendChild(renderExport(data));
      renderDetail(data);

      body.scrollTop = scrollTop;
      if (focusKey) {
        var again = body.querySelector('[aria-label="' + focusKey.replace(/"/g, '') + '"]');
        if (again) {
          again.focus();
          if (caret !== null && again.setSelectionRange) again.setSelectionRange(caret, caret);
        }
      }
    }

    function emptyState() {
      if (opts.platform === 'tiktok') {
        return h('div', { class: 'empty' },
          h('p', { class: 'empty-title', text: 'No TikTok videos collected yet' }),
          h('ol', null,
            h('li', null, 'Open a profile, e.g. ', h('code', { text: 'tiktok.com/@name' })),
            h('li', { text: 'Scroll down, or press Auto-scroll. Videos are collected as TikTok loads them.' }),
            h('li', { text: 'Come back here to sort, analyze and export.' })),
          h('p', { class: 'muted', text: 'Everything stays in this browser. OpenOutlier only reads what TikTok already loaded; it never likes, follows, comments or posts.' }));
      }
      if (opts.platform === 'youtube') {
        return h('div', { class: 'empty' },
          h('p', { class: 'empty-title', text: tx('ytEmpty', 'No YouTube videos collected yet') }),
          h('ol', null,
            h('li', null, tx('ytE1', 'Open a channel\'s Videos or Shorts tab, e.g. '), h('code', { text: 'youtube.com/@name/videos' })),
            h('li', { text: tx('ytE2', 'Scroll down, or press Auto-scroll. Videos are collected as YouTube loads them.') }),
            h('li', { text: tx('ytE3', 'Open a video to get its exact views, likes and date. Come back here to sort, analyze and export.') })),
          h('p', { class: 'muted', text: tx('ytEnote', 'Everything stays in this browser. OpenOutlier only reads what YouTube already loaded; it never likes, subscribes, comments or posts.') }));
      }
      if (opts.platform === 'x') {
        return h('div', { class: 'empty' },
          h('p', { class: 'empty-title', text: 'No X posts collected yet' }),
          h('ol', null,
            h('li', null, 'Open a profile, e.g. ', h('code', { text: 'x.com/name' })),
            h('li', { text: 'Scroll down, or press Auto-scroll (slow on purpose: a page every few seconds, it stops at 6 months, 300 posts or when X\'s rate limit runs low).' }),
            h('li', { text: 'Come back here to sort, analyze and export. Posts on Home, search, lists and post pages get a × median badge.' })),
          h('p', { class: 'muted', text: 'Everything stays in this browser. OpenOutlier only reads what x.com already loaded; it never posts, replies, reposts, likes, follows or sends messages.' }));
      }
      if (opts.platform === 'reddit') {
        return h('div', { class: 'empty' },
          h('p', { class: 'empty-title', text: 'No Reddit posts collected yet' }),
          h('ol', null,
            h('li', null, 'Open a subreddit or a user, e.g. ', h('code', { text: 'reddit.com/r/excel/top/?t=year' })),
            h('li', { text: 'Press "Collect top posts" (pages through the top posts of the year), or scroll / Auto-scroll: posts are collected as they appear.' }),
            h('li', { text: 'Come back here to sort, analyze and export.' })),
          h('p', { class: 'muted', text: 'Everything stays in this browser. OpenOutlier only reads; it never posts, comments, votes or sends messages.' }));
      }
      return h('div', { class: 'empty' },
        h('p', { class: 'empty-title', text: 'No reels collected yet' }),
        h('ol', null,
          h('li', null, 'Open a profile\'s Reels tab, e.g. ', h('code', { text: 'instagram.com/name/reels/' }), ', or its main grid for carousels and photos'),
          h('li', { text: 'Scroll down, or press Auto-scroll. Posts are collected as Instagram loads them.' }),
          h('li', { text: 'Come back here to sort, analyze and export.' })),
        h('p', { class: 'muted', text: 'Everything stays in this browser. OpenOutlier never asks for your password and never posts, likes or follows.' }));
    }

    function xTypeOptions() {
      var n = { original: 0, reply: 0, repost: 0, fmt: {} };
      state.posts.forEach(function (p) {
        var k = M.xKind(p);
        if (k === 'original') { n.original++; n.fmt[p.type] = (n.fmt[p.type] || 0) + 1; } else if (k === 'repost') n.repost++; else n.reply++;
      });
      var o = [h('option', { value: 'reels', selected: ui.typeFilter === 'reels', text: 'Original posts (' + fmtFull(n.original) + ')' })];
      Object.keys(X_FORMAT_NAMES).forEach(function (f) {
        if (n.fmt[f]) o.push(h('option', { value: 'fmt:' + f, selected: ui.typeFilter === 'fmt:' + f, text: '· ' + X_FORMAT_NAMES[f] + ' (' + fmtFull(n.fmt[f]) + ')' }));
      });
      if (n.reply) o.push(h('option', { value: 'replies', selected: ui.typeFilter === 'replies', text: 'Replies & thread parts (' + fmtFull(n.reply) + ')' }));
      if (n.repost) o.push(h('option', { value: 'reposts', selected: ui.typeFilter === 'reposts', text: 'Reposts (' + fmtFull(n.repost) + ')' }));
      o.push(h('option', { value: 'all', selected: ui.typeFilter === 'all', text: 'Everything' }));
      return o;
    }

    function renderReels(data) {
      var wrap = h('div', { class: 'reels' });
      var sortSel = h('select', { 'aria-label': 'Sort by', onchange: function () { ui.sort = sortSel.value; ui.shown = PAGE; render(); } },
        sortOptions().map(function (o) { return h('option', { value: o[0], selected: o[0] === sortKey(), text: o[1] }); }));
      var typeSel = h('select', { 'aria-label': 'Post type', onchange: function () { ui.typeFilter = typeSel.value; ui.shown = PAGE; render(); } },
        plat === 'x' ? xTypeOptions() : plat === 'reddit'
          ? REDDIT_TYPES.map(function (t) { return h('option', { value: t[0], selected: ui.typeFilter === t[0] || (t[0] === 'all' && ui.typeFilter === 'reels'), text: t[1] }); })
          : [h('option', { value: 'reels', selected: ui.typeFilter === 'reels', text: plat === 'mixed' ? 'Reels, videos & Reddit posts' : plat === 'tiktok' ? 'Videos' : 'Reels & videos' }),
            igPosts() ? h('option', { value: 'posts', selected: ui.typeFilter === 'posts', text: 'Carousels & photos (' + fmtFull(igPosts()) + ')' }) : null,
            h('option', { value: 'all', selected: ui.typeFilter === 'all', text: plat === 'tiktok' ? 'Videos & photo posts' : 'All posts' })]);
      var search = h('input', { type: 'search', placeholder: plat === 'reddit' || plat === 'youtube' ? (plat === 'reddit' ? 'Search titles or flair' : tx('search', 'Search titles or #tags')) : 'Search captions or #tags', value: ui.query, 'aria-label': 'Search captions' });
      search.addEventListener('input', function () {
        ui.query = search.value; ui.shown = PAGE;
        render();
      });
      var ytSwitch = null;
      if (plat === 'youtube') {
        var nS = state.posts.filter(function (p) { return p.type === 'short'; }).length;
        var nL = state.posts.length - nS;
        ytSwitch = h('div', { class: 'seg', role: 'group', 'aria-label': tx('format', 'Format') },
          [['long', tx('fmtVideos', 'Videos'), nL, tx('fmtVideosTip', 'Long-form videos and past live streams, scored against their own median')], ['short', 'Shorts', nS, tx('fmtShortsTip', 'Shorts, scored against the Shorts median')]].map(function (f) {
            return h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': ui.ytFormat === f[0] ? 'true' : 'false', 'data-tip': f[3], onclick: function () {
              ui.ytFormat = f[0]; ui.shown = PAGE; ui.detail = null; render();
            } }, f[1], h('span', { class: 'seg-count', text: ' ' + fmtFull(f[2]) }));
          }));
      }
      var outl = h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: ui.outliersOnly, onchange: function (e) { ui.outliersOnly = e.target.checked; ui.shown = PAGE; render(); } }),
        tx('outliers', 'Outliers only'));
      wrap.appendChild(h('div', { class: 'controls' }, ytSwitch, h('label', { class: 'field' }, tx('sort', 'Sort'), sortSel), plat === 'youtube' ? null : typeSel, outl, search));

      var list = data.list;
      if (plat === 'x') {
        var nApproxX = data.all.filter(function (p) { return p.ratio != null && p.baselineApprox; }).length;
        var nNoViews = data.all.filter(function (p) { return p.noViews && M.xKind(p) !== 'repost'; }).length;
        wrap.appendChild(h('p', { class: 'summary', text: fmtFull(list.length) + ' shown · each post against its account\'s median views for its format (text, image, video, thread, article, link, quote) · outlier = ' + M.OUTLIER_RATIO + '× median or more' }));
        var xNotes = [];
        if (nApproxX) xNotes.push(nApproxX + ' scored with ≈: fewer than 8 posts of that format, so against the overall median of original posts.');
        if (nNoViews) xNotes.push(nNoViews + ' without a view count (X shows none before 2023): no score, not in the median.');
        xNotes.push('Replies and reposts stay out of the medians. Views are not the impressions X pays for.');
        wrap.appendChild(h('p', { class: 'muted small', text: xNotes.join(' ') }));
        if (state.profile && state.profile.followers != null) wrap.appendChild(h('p', { class: 'muted small', text: fmtFull(state.posts.length) + ' posts saved' + (state.profile.posts ? ' (the profile shows ' + fmtFull(state.profile.posts) + ')' : '') + ' · ' + fmt(state.profile.followers) + ' followers' + (state.profile.blueVerified ? ' · verified' : '') + '.' }));
      } else wrap.appendChild(h('p', { class: 'summary' },
        plat === 'youtube' && opts.lang && opts.lang() === 'tr'
          ? fmtFull(list.length) + ' gösteriliyor · medyan ' + fmt(M.baselineOf(data.all) !== null ? M.baselineOf(data.all) : M.median(data.all.map(function (p) { var v = M.val(p); return v > 0 ? v : null; }))) + ' izlenme (' + (ui.ytFormat === 'short' ? 'Shorts' : 'uzun') + ') · outlier = medyanın ' + M.OUTLIER_RATIO + ' katı ya da fazlası'
          : fmtFull(list.length) + ' shown · ' + (plat === 'mixed' ? 'scored against each account\'s own median' : basis === 'mixed' ? 'reels scored on views, carousels and photos on likes, each against its own median' : 'median ' + fmt(M.baselineOf(data.all) !== null ? M.baselineOf(data.all) : M.median(data.all.map(function (p) { var v = M.val(p); return v > 0 ? v : null; }))) + ' ' + unit() + (plat === 'youtube' ? (ui.ytFormat === 'short' ? ' (Shorts)' : ' (long-form)') : '')) + ' · outlier = ' + M.OUTLIER_RATIO + '× median or more'));
      if (plat === 'instagram' && basis !== 'views') {
        var scored = data.all.filter(M.isLikesScored);
        wrap.appendChild(h('p', { class: 'muted small', text: scored.length < M.MIN_BASELINE
          ? 'Instagram shows no views on carousels and photos, so they are scored by likes. ' + scored.length + ' saved so far; scores start at ' + M.MIN_BASELINE + '. Open the profile\'s main grid and press Auto-scroll to collect more.'
          : 'Instagram shows no views on carousels and photos, so they are scored by likes against the median carousel or photo. Pinned posts and posts under 3 days old are scored but left out of the median.' }));
      }
      var prof = plat === 'instagram' && state.profile;
      if (prof && prof.posts) {
        wrap.appendChild(h('p', { class: 'muted small', text: fmtFull(state.posts.length) + ' of ' + fmtFull(prof.posts) + ' posts on the profile saved' + (prof.followers != null ? ' · ' + fmt(prof.followers) + ' followers' : '') + '.' }));
      }
      if (plat === 'youtube') {
        var nApprox = data.all.filter(function (p) { return p.viewsApprox; }).length;
        if (nApprox) wrap.appendChild(h('p', { class: 'muted small', text: nApprox === data.all.length
          ? tx('allRounded', 'View counts are YouTube\'s rounded ones (63K, 1.2M), close enough to compare with the median. Open a video for its exact numbers.')
          : tx('someRounded', '{a} of {b} view counts are rounded by YouTube; the rest are exact (opened videos).', { a: nApprox, b: data.all.length }) }));
        if (opts.onExactStats) wrap.appendChild(exactBar(data.all));
      }
      if (plat === 'youtube' && opts.onApiStats && state.api) wrap.appendChild(apiBar());

      if (!list.length) { wrap.appendChild(h('p', { class: 'empty-small', text: 'Nothing matches these filters.' })); return wrap; }

      var ul = h('ol', { class: 'list' });
      list.slice(0, ui.shown).forEach(function (p, i) { ul.appendChild(row(p, i)); });
      wrap.appendChild(ul);
      if (list.length > ui.shown) {
        wrap.appendChild(h('button', { class: 'btn btn-ghost more', type: 'button', onclick: function () { ui.shown += PAGE; render(); } },
          'Show ' + Math.min(PAGE, list.length - ui.shown) + ' more'));
      }
      return wrap;
    }

    /** The Track toggle: state.track = { on, via, niche, mine, excluded, ready, lang } or null (hidden). */
    function renderTrack() {
      var t = state.track;
      trackBtn.hidden = !t;
      if (!t) return;
      var tr = t.lang === 'tr';
      trackBtn.textContent = '';
      trackBtn.appendChild(h('span', { class: 'track-dot', 'aria-hidden': 'true' }));
      trackBtn.appendChild(document.createTextNode(t.on ? (tr ? 'Takip ediliyor' : 'Tracking') : (tr ? 'Takip et' : 'Track')));
      trackBtn.classList.toggle('is-on', !!t.on);
      trackBtn.setAttribute('aria-pressed', t.on ? 'true' : 'false');
      var why = t.on
        ? (t.mine ? (tr ? 'Senin kanalın; nişle karşılaştırılıyor. ' : 'Your channel, compared with the niche. ') : '') +
          (t.via === 'niche' ? (tr ? '"' + t.niche + '" nişinin parçası. ' : 'Part of the "' + t.niche + '" niche. ') : '') +
          (tr ? 'Bridge yeni videoları RSS ile 15 dakikada bir, Data API ile yaşına göre ölçüyor. Kapatmak için tıkla.' : 'The bridge checks RSS every 15 min and measures videos with the Data API by age. Click to stop.')
        : (t.excluded ? (tr ? '"' + t.niche + '" nişinde ama takipten çıkarıldı. ' : 'In the "' + t.niche + '" niche but switched off. ') : '') +
          (tr ? 'Niş takibine ekle: yeni videoların ilk saatlerden itibaren hızı ölçülür ve Library → Niş Takibi\'nde görünür.' : 'Add to niche tracking: new uploads are measured from their first hours and show up in Library → Niche tracking.');
      trackBtn.setAttribute('data-tip', why + (t.ready === false ? (tr ? ' Bridge veya bridge\'deki API anahtarı hazır olunca başlar.' : ' Starts once the bridge (with its API key) is ready.') : ''));
    }

    /** The Features tab: state.features = { flags, env, message } from the content script. */
    function renderFeatures() {
      var fs = state.features || {};
      return root.OpenOutlierFeaturesView.render({
        h: h, compact: true, lang: root.OpenOutlierFeatures.uiLang(),
        flags: fs.flags, env: fs.env, message: fs.message,
        onToggle: function (id, on) { opts.onFeatureToggle(id, on); },
        onFix: opts.onFeatureFix ? function (code, id) { opts.onFeatureFix(code, id); } : null,
        onReset: opts.onFeatureReset || null
      });
    }

    /** YouTube: "Get exact stats" for the top outliers (opens their pages one by one in a background tab). */
    function exactBar(all) {
      var ex = state.exact || {};
      var top = M.sortBy(all.filter(function (p) { return p.ratio != null; }), 'viralScore').slice(0, EXACT_TOP);
      var todo = top.filter(function (p) { return p.viewsApprox || p.dateApprox !== false; }).length;
      var btn = h('button', { class: 'btn' + (ex.running ? '' : ' btn-ghost'), type: 'button', disabled: !ex.running && !todo,
        'data-tip': ex.running ? 'Stop after the current video' : todo
          ? 'Opens the ' + todo + ' of the top ' + top.length + ' videos that still have rounded views or dates, one at a time in a background tab, so their views, likes and dates become exact. Takes about ' + Math.max(1, Math.round(todo * 10 / 60)) + ' min.'
          : 'The top ' + top.length + ' videos already have exact stats',
        onclick: function () { if (ex.running) opts.onExactCancel(); else opts.onExactStats(all); } },
        ex.running ? tx('stop', 'Stop') : tx('exact', 'Get exact stats') + (todo ? ' (' + todo + ')' : ''));
      return h('div', { class: 'exact-bar' }, btn, h('span', { class: 'muted small', 'aria-live': 'polite', text: ex.label || (todo ? tx('exactTop', 'for the top {n} by Viral Score', { n: top.length }) : tx('exactDone', 'Top {n} are exact', { n: top.length })) }));
    }

    /** YouTube with the user's own Data API key: exact stats for every saved video, or the full upload list. */
    function apiBar() {
      var a = state.api;
      var all = state.posts || [];
      var todo = all.filter(function (p) { return p.viewsApprox || p.dateApprox !== false; }).length;
      var units = Math.max(1, Math.ceil(all.length / 50));
      var exactBtn = h('button', { class: 'btn btn-ghost', type: 'button', disabled: a.running || !all.length,
        'data-tip': 'Asks the YouTube Data API (your key) for the exact views, likes, comments, date, length and tags of all ' + all.length + ' saved videos (' + todo + ' still rounded). About ' + units + ' quota unit' + (units === 1 ? '' : 's') + '.',
        onclick: function () { opts.onApiStats('exact'); } }, 'Exact stats via API');
      var upBtn = h('button', { class: 'btn btn-ghost', type: 'button', disabled: a.running,
        'data-tip': 'Lists the channel\'s newest 500 uploads (videos, Shorts, past streams) through the API, with exact stats, including ones the tabs never loaded. About 30 quota units.',
        onclick: function () { opts.onApiStats('uploads'); } }, 'All uploads via API');
      return h('div', { class: 'exact-bar' }, exactBtn, upBtn,
        h('span', { class: 'muted small', 'aria-live': 'polite', text: (a.label ? a.label + ' ' : '') + 'API quota today: ' + fmtFull(a.used || 0) + ' / ' + fmtFull(a.limit || 10000) + ' units.' }));
    }

    function image(url, cls, fallback) {
      if (!url) return h('div', { class: cls + ' thumb-empty' });
      var img = h('img', { class: cls, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', function () {
        if (img.isConnected) img.replaceWith(fallback ? fallback() : h('div', { class: cls + ' thumb-empty' }));
      });
      if (opts.loadImage) opts.loadImage(img, url);
      else img.src = url;
      return img;
    }

    // ---- detail card ---------------------------------------------------------
    function openDetail(p) {
      ui.detail = p.code;
      ui.slide = null;
      detailEl.scrollTop = 0;
      render();
    }

    /**
     * Every slide of a carousel (or every photo of a TikTok photo post) as a strip of thumbnails.
     * Click one to see it large underneath, click it again to close; ⌘/Ctrl-click opens the file.
     */
    function slideStrip(p) {
      var files = p.files || [];
      if (isYT(p) || files.length < 2) return null;
      function stillOf(f) { return f.kind === 'image' ? f.url : f.thumb || null; }
      function blank(cls) { return function () { return h('span', { class: cls + ' thumb-empty' }); }; }
      var strip = h('div', { class: 'd-slides', role: 'group', 'aria-label': 'All ' + files.length + ' slides' }, files.map(function (f, i) {
        var video = f.kind === 'video';
        var src = stillOf(f);
        return h('button', { class: 'd-slide' + (ui.slide === i ? ' is-active' : ''), type: 'button', 'aria-pressed': ui.slide === i ? 'true' : 'false',
          'aria-label': 'Slide ' + (i + 1) + ' of ' + files.length + (video ? ' (video)' : ''),
          'data-tip': 'Slide ' + (i + 1) + (video ? ' (video)' : '') + ': click to enlarge, ⌘/Ctrl-click to open the file',
          onclick: function (e) {
            if (e.metaKey || e.ctrlKey) { window.open(f.url, '_blank', 'noopener'); return; }
            ui.slide = ui.slide === i ? null : i;
            render();
          } },
          src ? image(src, 'd-slide-img', blank('d-slide-img')) : blank('d-slide-img')(),
          h('span', { class: 'd-slide-n', text: (video ? '▶ ' : '') + (i + 1) }));
      }));
      var open = ui.slide != null ? files[ui.slide] : null;
      var big = null;
      if (open) {
        var bigSrc = stillOf(open);
        big = h('div', { class: 'd-slide-open' },
          bigSrc ? image(bigSrc, 'd-slide-big', blank('d-slide-big')) : blank('d-slide-big')(),
          h('p', { class: 'muted small' }, 'Slide ' + (ui.slide + 1) + ' of ' + files.length + (open.kind === 'video' ? ' · video · ' : ' · '),
            h('a', { href: open.url, target: '_blank', rel: 'noopener noreferrer' }, open.kind === 'video' ? 'Open the video ↗' : 'Open full size ↗')));
      }
      return h('div', { class: 'd-slides-wrap' },
        h('p', { class: 'subhead', text: 'All ' + files.length + ' slides' }),
        strip, big,
        big ? null : h('p', { class: 'muted small', text: 'Click a slide to enlarge it. Instagram\'s image links expire after a few days: reload the profile if slides stay blank.' }));
    }

    function closeDetail() {
      ui.detail = null;
      ui.slide = null;
      detailEl.hidden = true;
      render();
    }

    // Download messages per video, kept across re-renders (yt-dlp progress, then "Saved to …").
    var dlMsgs = {};
    var detailMsg = null;
    function setDlMsg(code, text) {
      dlMsgs[code] = text;
      if (detailMsg && detailMsg.__code === code) detailMsg.textContent = text;
    }

    function renderDetail(data) {
      var p = ui.detail && data.all.filter(function (x) { return x.code === ui.detail; })[0];
      if (!p) { ui.detail = null; detailEl.hidden = true; return; }
      var st = detailEl.scrollTop;
      detailEl.hidden = false;
      detailEl.textContent = '';
      if (isReddit(p)) { renderRedditDetail(p); detailEl.scrollTop = st; return; }
      if (isX(p)) { renderXDetail(p); detailEl.scrollTop = st; return; }
      var when = p.takenAt ? new Date(p.takenAt) : null;
      var nFiles = (p.files || []).length;
      var msg = h('p', { class: 'status-line', 'aria-live': 'polite', text: dlMsgs[p.code] || '' });
      msg.__code = p.code;
      detailMsg = msg;
      function dl(what, label, enabled) {
        var b = h('button', { class: what === 'media' ? 'btn btn-primary' : 'btn', type: 'button', disabled: !enabled, onclick: function () {
          b.disabled = true;
          var code = p.code;
          setDlMsg(code, isYT(p) && what === 'media' ? 'Starting yt-dlp…' : '');
          opts.onDownloadMedia([p], what, function (label) { setDlMsg(code, label); }).then(function (r) {
            setDlMsg(code, r && r.message ? r.message : r && r.queued ? 'Saved to Downloads/OpenOutlier/' + String(p.owner || '').replace('/', '_') + '/'
              : (r && r.errors && r.errors[0]) || 'Download failed. Open the post on ' + siteName(p) + ' once, then try again.');
          }, function () { setDlMsg(code, 'Download failed.'); }).then(function () { b.disabled = false; });
        } }, label);
        return b;
      }

      detailEl.appendChild(h('div', { class: 'd-top' },
        h('button', { class: 'btn btn-ghost d-back', type: 'button', onclick: closeDetail }, pxIcon(PX_BACK, 14), 'Back'),
        h('a', { class: 'd-open', href: p.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open on ' + siteName(p) + ' ↗')));

      detailEl.appendChild(h('div', { class: 'd-hero' },
        image(p.thumb, 'd-cover'),
        h('div', { class: 'd-side' },
          h('p', { class: 'd-owner', text: ownerHandle(p) + (multiPlat || isTT(p) ? ' · ' + siteName(p) : '') }),
          h('p', { class: 'muted small d-when', text: !when ? 'Date not loaded yet' : isYT(p) && p.dateApprox && p.dateDay
            ? df.format(when) + ' (no time of day yet)'
            : isYT(p) && p.dateApprox
            ? 'About ' + mf.format(when) + ' (YouTube said "' + agoText(p.takenAt) + '"; open the video for the exact date)'
            : when.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }),
          verdict(p, isYT(p) ? 'this channel\'s median ' + (p.type === 'short' ? 'Shorts' : 'long-form') + ' views' : M.isLikesScored(p) ? 'this account\'s median likes on carousels and photos' : 'this account\'s median views'),
          p.pinned || p.paidPartnership ? h('div', { class: 'badges' },
            p.pinned ? h('span', { class: 'badge' }, 'Pinned') : null,
            p.paidPartnership ? h('span', { class: 'badge' }, 'Paid partnership') : null) : null,
          h('div', { class: 'd-actions' },
            isYT(p) ? h('span', { 'data-tip': 'Saved by yt-dlp on your Mac through the OpenOutlier bridge (needs yt-dlp and ffmpeg: brew install yt-dlp ffmpeg). Also fills in the exact views, likes, comments, date, chapters and heatmap.' }, dl('media', 'Download video', true)) :
              dl('media', nFiles > 1 ? 'Download ' + nFiles + ' files' : (p.type === 'reel' || p.type === 'video' ? 'Download video' : 'Download photo'), nFiles > 0),
            dl('cover', 'Download cover', !!p.thumb),
            h('button', { class: 'btn btn-ghost', type: 'button', onclick: function () {
              opts.onCopy(p.url).then(function () { msg.textContent = 'Link copied.'; }, function () { msg.textContent = p.url; });
            } }, 'Copy link')),
          msg)));

      if (isYT(p)) { renderYouTubeStats(p); detailEl.scrollTop = st; return; }
      if (ui.slide != null && ui.slide >= (p.files || []).length) ui.slide = null;
      var strip = slideStrip(p);
      if (strip) detailEl.appendChild(strip);
      var typeName = p.type === 'reel' ? 'Reel' : p.type.charAt(0).toUpperCase() + p.type.slice(1);
      var ig = !isTT(p);
      var cmtX = ig ? big('Comments × median', p.commentRatio != null ? p.commentRatio.toFixed(1) + '×' : '–', 'Comments compared with this account\'s median ' + (M.isLikesScored(p) ? 'carousel or photo' : 'reel')) : null;
      var cmtLikes = ig ? big('Comments / 100 likes', p.commentsPer100Likes != null ? p.commentsPer100Likes.toFixed(p.commentsPer100Likes < 10 ? 1 : 0) : '–',
        'Far above the account\'s usual usually means a "comment KEYWORD to get the link" post rather than a discussion') : null;
      if (M.isLikesScored(p)) {
        var nSlides = p.slides || (p.files || []).length;
        detailEl.appendChild(h('div', { class: 'd-grid' },
          big('Likes', p.likesHidden && p.likes == null ? 'Hidden' : fmt(p.likes), p.likes != null ? fmtFull(p.likes) : p.likesHidden ? 'The creator hid the like count on this post' : 'Not loaded yet'),
          big('Comments', fmt(p.comments), p.comments != null ? fmtFull(p.comments) : null),
          big('Shares', fmt(p.shares), p.shares != null ? fmtFull(p.shares) : 'Instagram only shares this for some posts'),
          big('× median', p.ratio ? p.ratio.toFixed(1) + '×' : '–', p.ratio ? 'Likes compared with this account\'s median carousel or photo. Instagram shows no views on these.' : 'Needs ' + M.MIN_BASELINE + ' carousels or photos with likes to score'),
          cmtX,
          cmtLikes,
          p.type === 'carousel' ? big('Slides', nSlides ? String(nSlides) : '–', p.slideVideos ? p.slideVideos + ' of them video' : null) : big('Type', typeName),
          p.saves != null ? big('Saves', fmt(p.saves), fmtFull(p.saves)) : big('Views', '–', 'Instagram shows views on carousels and photos only to their owner')));
      } else {
        detailEl.appendChild(h('div', { class: 'd-grid' },
          big('Views', fmt(p.views), p.views != null ? fmtFull(p.views) : 'Not loaded yet'),
          big('Likes', fmt(p.likes), p.likes != null ? fmtFull(p.likes) : null),
          big('Comments', fmt(p.comments), p.comments != null ? fmtFull(p.comments) : null),
          big('Shares', fmt(p.shares), p.shares != null ? fmtFull(p.shares) : 'Instagram only shares this for some posts'),
          big('Duration', p.duration ? dur(p.duration) : '–'),
          big('Engagement', pct(p.engagement), engagementTip(p)),
          big('× median', p.ratio ? p.ratio.toFixed(1) + '×' : '–', 'Views compared with this account\'s median'),
          p.saves != null ? big('Saves', fmt(p.saves), fmtFull(p.saves)) : big('Type', typeName),
          cmtX,
          cmtLikes));
      }
      var factsLine = [];
      if (p.commentKeyword) factsLine.push('Asks for a comment: “' + p.commentKeyword + '”');
      if ((p.collabs || []).length) factsLine.push('Collab with ' + p.collabs.map(function (u) { return '@' + u; }).join(', '));
      if ((p.tagged || []).length) factsLine.push('Tags ' + p.tagged.slice(0, 6).map(function (u) { return '@' + u; }).join(', ') + (p.tagged.length > 6 ? ' +' + (p.tagged.length - 6) : ''));
      if (p.location) factsLine.push(p.location);
      if (p.width && p.height) factsLine.push(p.width + '×' + p.height);
      if (p.commentsOff) factsLine.push('Comments turned off');
      if (factsLine.length) detailEl.appendChild(h('p', { class: 'muted small', text: factsLine.join(' · ') }));

      if (p.audio) {
        detailEl.appendChild(h('p', { class: 'd-audio' }, '♪ ' + (p.audio.kind === 'music' || isTT(p) ? p.audio.title + (p.audio.artist ? ' · ' + p.audio.artist : '') : (p.audio.title || 'Original audio'))));
      }
      if (p.caption) detailEl.appendChild(h('p', { class: 'd-caption', text: p.caption }));
      if ((p.hashtags || []).length) {
        detailEl.appendChild(h('div', { class: 'd-tags' }, p.hashtags.map(function (t) {
          return h('button', { class: 'chip', type: 'button', 'data-tip': 'Show posts with #' + t, onclick: function () {
            ui.query = '#' + t; ui.tab = 'reels'; ui.shown = PAGE; ui.detail = null; detailEl.hidden = true; render();
          } }, '#' + t);
        })));
      }
      detailEl.scrollTop = st;
    }

    /** "3 weeks ago"-style text for an approximate date (what YouTube showed, roughly). */
    function agoText(t) {
      var days = (Date.now() - t) / 864e5;
      if (days < 1) return 'today';
      if (days < 14) return Math.round(days) + ' days ago';
      if (days < 60) return Math.round(days / 7) + ' weeks ago';
      if (days < 365) return Math.round(days / 30.44) + ' months ago';
      var y = Math.round(days / 365.25);
      return y + (y === 1 ? ' year ago' : ' years ago');
    }

    function renderYouTubeStats(p) {
      var fmtName = p.type === 'short' ? 'Short' : p.type === 'live' ? 'Live stream' : 'Video';
      detailEl.appendChild(h('div', { class: 'd-grid' },
        big('Views', (p.viewsApprox ? '≈' : '') + fmt(p.views), viewsTip(p)),
        big('Likes', fmt(p.likes), p.likes != null ? fmtFull(p.likes) : 'Open the video on YouTube to load likes'),
        big('Comments', (p.commentsApprox ? '≈' : '') + fmt(p.comments), p.comments != null ? fmtFull(p.comments) : 'Open the video on YouTube to load comments'),
        big('Duration', p.duration ? dur(p.duration) : '–', p.type === 'short' && !p.duration ? 'The Shorts tab shows no length; open the Short to load it' : null),
        big('Engagement', pct(p.engagement), engagementTip(p)),
        big('× median', p.ratio ? p.ratio.toFixed(1) + '×' : '–', 'Views compared with this channel\'s median ' + (p.type === 'short' ? 'Short' : 'long-form video')),
        big('Format', fmtName),
        big('Category', p.category || '–', p.category ? null : 'Loads when the video is opened')));
      if (p.caption) detailEl.appendChild(h('p', { class: 'd-caption d-title', text: p.caption }));
      if ((p.heatmap || []).length) detailEl.appendChild(ytHeatmap(p));
      if ((p.chapters || []).length) {
        detailEl.appendChild(h('p', { class: 'subhead', text: p.chapters.length + ' chapters' }));
        detailEl.appendChild(h('ol', { class: 'd-chapters' }, p.chapters.map(function (c, i) {
          var next = p.chapters[i + 1];
          var len = (next ? next.start : p.duration || 0) - c.start;
          return h('li', null,
            h('a', { class: 'd-time', href: ytAt(p, c.start), target: '_blank', rel: 'noopener noreferrer', 'data-tip': 'Open at ' + clock(c.start) }, clock(c.start)),
            h('span', { class: 'd-ch-title', text: c.title }),
            len > 0 ? h('span', { class: 'muted small', text: dur(len) }) : null);
        })));
      }
      if (p.description) detailEl.appendChild(h('p', { class: 'd-caption', text: p.description }));
      var facts = [];
      if (p.hasCaptions === true) facts.push(p.autoCaptions ? 'Auto-generated captions' : 'Captions');
      if (p.hasCaptions === false) facts.push('No captions');
      if ((p.keywords || []).length) facts.push('Tags: ' + p.keywords.slice(0, 12).join(', '));
      if (facts.length) detailEl.appendChild(h('p', { class: 'muted small', text: facts.join(' · ') }));
      if ((p.hashtags || []).length) {
        detailEl.appendChild(h('div', { class: 'd-tags' }, p.hashtags.map(function (t) {
          return h('button', { class: 'chip', type: 'button', 'data-tip': 'Show videos with #' + t, onclick: function () {
            ui.query = '#' + t; ui.tab = 'reels'; ui.shown = PAGE; ui.detail = null; detailEl.hidden = true; render();
          } }, '#' + t);
        })));
      }
    }

    /** "0:42" for a moment in a video (0 → "0:00"). */
    function clock(t) {
      t = Math.max(0, Math.round(t || 0));
      var m = Math.floor(t / 60);
      return (m >= 60 ? Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') : String(m)) + ':' + String(t % 60).padStart(2, '0');
    }
    /** The video's link at a time (Shorts can't start at a time: plain link). */
    function ytAt(p, t) { return p.type === 'short' ? p.url : 'https://www.youtube.com/watch?v=' + encodeURIComponent(p.code) + '&t=' + Math.max(0, Math.round(t)) + 's'; }

    /** "Most replayed" strip: YouTube's 100-point heatmap, with its peaks marked. */
    function ytHeatmap(p) {
      var NS = 'http://www.w3.org/2000/svg';
      var vals = p.heatmap;
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 ' + vals.length + ' 24');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('class', 'd-heat');
      svg.setAttribute('role', 'img');
      var total = p.duration || (p.heatmapStep ? p.heatmapStep * vals.length : 0);
      var peaks = p.heatmapPeaks || [];
      svg.setAttribute('aria-label', 'Replay heatmap' + (peaks.length ? ', most replayed at ' + peaks.map(clock).join(', ') : ''));
      var d = 'M0 24';
      vals.forEach(function (v, i) { var y = (24 - v * 23).toFixed(2); d += ' L' + i + ' ' + y + ' L' + (i + 1) + ' ' + y; });
      var area = document.createElementNS(NS, 'path');
      area.setAttribute('d', d + ' L' + vals.length + ' 24 Z');
      area.setAttribute('class', 'd-heat-area');
      svg.appendChild(area);
      (p.chapters || []).forEach(function (c) {
        if (!total || !c.start) return;
        var tick = document.createElementNS(NS, 'rect');
        tick.setAttribute('x', (c.start / total * vals.length - 0.15).toFixed(2));
        tick.setAttribute('y', '0'); tick.setAttribute('width', '0.3'); tick.setAttribute('height', '24');
        tick.setAttribute('class', 'd-heat-chapter');
        svg.appendChild(tick);
      });
      peaks.forEach(function (t) {
        if (!total) return;
        var mark = document.createElementNS(NS, 'rect');
        mark.setAttribute('x', (t / total * vals.length - 0.5).toFixed(2));
        mark.setAttribute('y', '0'); mark.setAttribute('width', '1'); mark.setAttribute('height', '24');
        mark.setAttribute('class', 'd-heat-peak');
        svg.appendChild(mark);
      });
      var line = h('p', { class: 'muted small d-replay' }, peaks.length ? 'Most replayed at ' : 'No single most-replayed moment');
      peaks.forEach(function (t, i) {
        if (i) line.appendChild(document.createTextNode(i === peaks.length - 1 ? ' and ' : ', '));
        var ch = (p.chapters || []).filter(function (c) { return c.start <= t; }).pop();
        line.appendChild(h('a', { class: 'd-time', href: ytAt(p, t), target: '_blank', rel: 'noopener noreferrer', 'data-tip': ch ? 'In "' + ch.title + '"' : 'Open at ' + clock(t) }, clock(t)));
      });
      return h('div', { class: 'd-heat-wrap' }, h('p', { class: 'subhead', text: 'Replays' }), svg, line);
    }

    function big(label, value, tip) {
      return h('div', { class: 'd-stat', 'data-tip': tip || null }, h('span', { class: 'd-stat-value', text: value }), h('span', { class: 'd-stat-label', text: label }));
    }

    function renderRedditDetail(p) {
      var when = p.takenAt ? new Date(p.takenAt) : null;
      var msg = h('p', { class: 'status-line', 'aria-live': 'polite' });
      detailEl.appendChild(h('div', { class: 'd-top' },
        h('button', { class: 'btn btn-ghost d-back', type: 'button', onclick: closeDetail }, pxIcon(PX_BACK, 14), 'Back'),
        h('a', { class: 'd-open', href: p.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open on Reddit ↗')));
      detailEl.appendChild(h('div', { class: 'd-hero d-hero-text' },
        p.thumb ? image(p.thumb, 'd-cover') : null,
        h('div', { class: 'd-side' },
          h('p', { class: 'd-owner', text: (p.subreddit ? 'r/' + p.subreddit : '') + (p.author ? ' · u/' + p.author : '') }),
          h('p', { class: 'muted small d-when', text: when ? when.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Date unknown' }),
          h('p', { class: 'd-title', text: p.title || '' }),
          verdict(p, 'this ' + (/^u\//.test(p.owner || '') ? 'user' : 'subreddit') + '\'s median score'),
          h('div', { class: 'badges' },
            p.flair ? h('span', { class: 'badge' }, p.flair) : null,
            M.isQuestion(p.title) ? h('span', { class: 'badge', 'data-tip': 'The title asks a question' }, 'Question') : null,
            p.pinned ? h('span', { class: 'badge' }, 'Pinned') : null),
          h('div', { class: 'd-actions' },
            h('button', { class: 'btn btn-ghost', type: 'button', onclick: function () {
              opts.onCopy(p.url).then(function () { msg.textContent = 'Link copied.'; }, function () { msg.textContent = p.url; });
            } }, 'Copy link'),
            h('button', { class: 'btn btn-ghost', type: 'button', onclick: function () {
              opts.onCopy(p.title || '').then(function () { msg.textContent = 'Title copied.'; }, function () { msg.textContent = p.title; });
            } }, 'Copy title')),
          msg)));
      detailEl.appendChild(h('div', { class: 'd-grid' },
        big('Score', fmt(p.score), p.score != null ? fmtFull(p.score) + ' (upvotes − downvotes)' : 'Not loaded'),
        big('Comments', fmt(p.comments), p.comments != null ? fmtFull(p.comments) : null),
        big('Upvote ratio', p.upvoteRatio != null ? Math.round(p.upvoteRatio * 100) + '%' : '–', p.upvoteRatio == null ? 'Only in "Collect top posts" data, not on the page itself' : null),
        big('× median', p.ratio ? p.ratio.toFixed(1) + '×' : '–', 'Score compared with this subreddit\'s (or user\'s) median'),
        big('Comments / score', p.engagement != null ? p.engagement.toFixed(0) + '%' : '–', 'comments ÷ score: high = lots of discussion'),
        big('Type', TYPE_NAMES[p.type] || p.type || '–'),
        big('Title', (String(p.title || '').match(/\S+/g) || []).length + ' words'),
        big('Crossposts', p.crossposts != null ? fmt(p.crossposts) : '–')));
      if (p.selftext) detailEl.appendChild(h('p', { class: 'd-caption', text: p.selftext }));
      if (p.linkUrl && /^https:\/\//i.test(p.linkUrl) && p.type === 'link') detailEl.appendChild(h('p', { class: 'muted small' }, 'Links to ', h('a', { href: p.linkUrl, target: '_blank', rel: 'noopener noreferrer', text: p.domain || p.linkUrl })));
      if (p.flair) {
        detailEl.appendChild(h('div', { class: 'd-tags' }, h('button', { class: 'chip', type: 'button', 'data-tip': 'Show posts with this flair', onclick: function () {
          ui.query = 'flair:' + p.flair.toLowerCase(); ui.tab = 'reels'; ui.shown = PAGE; ui.detail = null; detailEl.hidden = true; render();
        } }, 'Flair: ' + p.flair)));
      }
    }

    function renderXDetail(p) {
      var when = p.takenAt ? new Date(p.takenAt) : null;
      var msg = h('p', { class: 'status-line', 'aria-live': 'polite', text: dlMsgs[p.code] || '' });
      msg.__code = p.code;
      detailMsg = msg;
      var nFiles = (p.files || []).length;
      var fname = X_FORMAT_NAMES[p.type] || 'Text';
      detailEl.appendChild(h('div', { class: 'd-top' },
        h('button', { class: 'btn btn-ghost d-back', type: 'button', onclick: closeDetail }, pxIcon(PX_BACK, 14), 'Back'),
        h('a', { class: 'd-open', href: p.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open on X ↗')));
      var dlBtn = h('button', { class: 'btn btn-primary', type: 'button', disabled: !nFiles, onclick: function () {
        dlBtn.disabled = true;
        var code = p.code;
        opts.onDownloadMedia([p], 'media', function (label) { setDlMsg(code, label); }).then(function (r) {
          setDlMsg(code, r && r.message ? r.message : r && r.queued ? 'Saved to Downloads/OpenOutlier/' + String(p.owner || '').replace('/', '_') + '/' : (r && r.errors && r.errors[0]) || 'Download failed.');
        }, function () { setDlMsg(code, 'Download failed.'); }).then(function () { dlBtn.disabled = false; });
      } }, nFiles > 1 ? 'Download ' + nFiles + ' files' : nFiles && p.files[0].kind === 'video' ? 'Download video' : 'Download photo');
      detailEl.appendChild(h('div', { class: 'd-hero' },
        image(p.thumb, 'd-cover'),
        h('div', { class: 'd-side' },
          h('p', { class: 'd-owner', text: ownerHandle(p) + (p.ownerName ? ' · ' + p.ownerName : '') + (multiPlat ? ' · X' : '') }),
          h('p', { class: 'muted small d-when', text: when ? when.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '' }),
          verdict(p, (p.baselineApprox ? '≈ ' : '') + (p.baselineScope === 'format' ? 'this account\'s median ' + fname.toLowerCase() + ' post' : 'this account\'s median original post')),
          p.ratio == null ? h('p', { class: 'muted small', text: xBaseTip(p) }) : null,
          h('div', { class: 'badges' },
            h('span', { class: 'badge' }, p.kind === 'original' ? fname + (p.threadLength ? ' · ' + p.threadLength + ' posts' : '') : p.kind === 'repost' ? 'Repost' : p.kind === 'reply' ? 'Reply' + (p.replyToUser ? ' to @' + p.replyToUser : '') : 'Thread part'),
            p.pinned ? h('span', { class: 'badge' }, 'Pinned') : null,
            p.edit && p.edit.edited ? h('span', { class: 'badge', 'data-tip': 'Edited ' + (p.edit.ids.length - 1) + '×' }, 'Edited') : null,
            p.aiGenerated ? h('span', { class: 'badge', 'data-tip': 'The author marked this as made with AI' }, 'AI') : null,
            p.promoted ? h('span', { class: 'badge' }, 'Promoted') : null),
          h('div', { class: 'd-actions' }, dlBtn,
            h('button', { class: 'btn btn-ghost', type: 'button', onclick: function () {
              opts.onCopy(p.url).then(function () { msg.textContent = 'Link copied.'; }, function () { msg.textContent = p.url; });
            } }, 'Copy link'),
            h('button', { class: 'btn btn-ghost', type: 'button', onclick: function () {
              opts.onCopy(p.caption || '').then(function () { msg.textContent = 'Text copied.'; }, function () { msg.textContent = p.caption; });
            } }, 'Copy text'),
            opts.onSaveSwipe ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: function () {
              Promise.resolve(opts.onSaveSwipe(p)).then(function (r) { msg.textContent = r && r.message || 'Saved to the swipe file.'; }, function () { msg.textContent = 'Could not save.'; });
            } }, 'Save to swipe file') : null),
          msg)));
      detailEl.appendChild(h('div', { class: 'd-grid' },
        big('Views', p.views != null ? fmt(p.views) : '–', p.views != null ? fmtFull(p.views) : xBaseTip(p)),
        big('Likes', fmt(p.likes), p.likes != null ? fmtFull(p.likes) : null),
        big('Replies', fmt(p.comments), p.comments != null ? fmtFull(p.comments) : null),
        big('Reposts', fmt(p.shares), p.shares != null ? fmtFull(p.shares) : null),
        big('Quotes', fmt(p.quotes), p.quotes != null ? fmtFull(p.quotes) : null),
        big('Bookmarks', fmt(p.saves), p.saves != null ? fmtFull(p.saves) : null),
        big('Engagement', pct(p.engagement), engagementTip(p)),
        big('× median', p.ratio ? (p.baselineApprox ? '≈' : '') + p.ratio.toFixed(1) + '×' : '–', xBaseTip(p)),
        big('Author', p.ownerFollowers != null ? fmt(p.ownerFollowers) : '–', 'Followers of ' + ownerHandle(p) + ' when the post was seen'),
        p.duration ? big('Duration', dur(p.duration)) : big('Characters', fmtFull((p.caption || '').length))));
      var facts = [];
      if (p.article && p.article.title) facts.push('Article: “' + p.article.title + '”');
      if (p.hasLink) facts.push('Links to ' + p.links.map(function (u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } }).join(', '));
      if (p.quotedId) facts.push('Quotes another post');
      if (p.lang) facts.push('Language: ' + p.lang);
      if (facts.length) detailEl.appendChild(h('p', { class: 'muted small', text: facts.join(' · ') }));
      if (p.caption) detailEl.appendChild(h('p', { class: 'd-caption', text: p.caption }));
      if ((p.hashtags || []).length) {
        detailEl.appendChild(h('div', { class: 'd-tags' }, p.hashtags.map(function (t) {
          return h('button', { class: 'chip', type: 'button', 'data-tip': 'Show posts with #' + t, onclick: function () {
            ui.query = '#' + t; ui.tab = 'reels'; ui.shown = PAGE; ui.detail = null; detailEl.hidden = true; render();
          } }, '#' + t);
        })));
      }
    }

    function redditRow(p, i) {
      var badges = h('span', { class: 'badges' });
      if (p.outlier) badges.appendChild(outlierBadge(p, 'This post got ' + p.ratio.toFixed(1) + '× the median score'));
      if (p.viralScore !== null && p.viralScore !== undefined) badges.appendChild(h('span', { class: 'badge badge-score', 'data-tip': 'Viral Score: 50 = median score, 75 = 2×, 100 = 4× or more' }, 'VS ' + p.viralScore));
      if (p.flair) badges.appendChild(h('span', { class: 'badge', 'data-tip': 'Flair' }, p.flair));
      var meta = [];
      if (opts.showOwner && p.owner) meta.push(accountLabel(p.owner));
      if (p.comments != null) meta.push(fmt(p.comments) + ' comments');
      if (p.upvoteRatio != null) meta.push(Math.round(p.upvoteRatio * 100) + '% upvoted');
      meta.push(TYPE_NAMES[p.type] || p.type);
      if (p.author && !/^u\//.test(state.selected || '')) meta.push('u/' + p.author);
      if (p.takenAt) meta.push(df.format(new Date(p.takenAt)));
      return h('li', { class: 'row row-reddit' + (p.outlier ? ' is-outlier' : '') + (ui.detail === p.code ? ' is-active' : '') },
        h('button', { class: 'row-link', type: 'button', title: 'Details (⌘/Ctrl-click opens Reddit)', onclick: function (e) {
          if (e.metaKey || e.ctrlKey) { window.open(p.url, '_blank', 'noopener'); return; }
          openDetail(p);
        } },
          h('span', { class: 'rank', text: String(i + 1) }),
          (function () {
            function typeBox() { return h('span', { class: 'thumb thumb-empty thumb-type', text: (TYPE_NAMES[p.type] || 'Post').split(' ')[0] }); }
            return p.thumb ? image(p.thumb, 'thumb', typeBox) : typeBox();
          })(),
          h('span', { class: 'row-main' },
            h('span', { class: 'row-top' },
              h('span', { class: 'views', 'data-tip': p.score != null ? fmtFull(p.score) + ' score' : 'Score hidden' }, p.score != null ? fmt(p.score) : '–', h('span', { class: 'unit', text: ' score' })),
              badges),
            h('span', { class: 'caption caption-title', text: (p.title || '').replace(/\s+/g, ' ') }),
            h('span', { class: 'meta', text: meta.join(' · ') }))));
    }

    function row(p, i) {
      if (isReddit(p)) return redditRow(p, i);
      var thumb = image(p.thumb, 'thumb');

      var badges = h('span', { class: 'badges' });
      var byLikes = M.isLikesScored(p);
      if (p.outlier) badges.appendChild(outlierBadge(p, 'This post got ' + p.ratio.toFixed(1) + '× the profile\'s median ' + (byLikes ? 'likes on carousels and photos' : 'views')));
      if (p.viralScore !== null) badges.appendChild(h('span', { class: 'badge badge-score', 'data-tip': 'Viral Score: 50 = median ' + (byLikes ? 'likes' : 'views') + ', 75 = 2×, 100 = 4× or more' }, 'VS ' + p.viralScore));
      if (p.pinned) badges.appendChild(h('span', { class: 'badge', 'data-tip': 'Pinned to the profile' }, 'Pinned'));
      if (byLikes) badges.appendChild(h('span', { class: 'badge', 'data-tip': p.type === 'carousel' ? 'Carousel' + (p.slides ? ', ' + p.slides + ' slides' : '') : 'Photo' }, p.type === 'carousel' ? (p.slides ? p.slides + ' slides' : 'Carousel') : 'Photo'));
      if (p.commentKeyword) badges.appendChild(h('span', { class: 'badge', 'data-tip': 'The caption asks people to comment “' + p.commentKeyword + '”, so the comment count is driven by the giveaway' }, '“' + p.commentKeyword + '”'));
      if (p.commentRatio >= M.OUTLIER_RATIO && !isTT(p) && !isYT(p)) badges.appendChild(h('span', { class: 'badge', 'data-tip': fmtFull(p.comments) + ' comments: ' + p.commentRatio.toFixed(1) + '× this account\'s median' }, p.commentRatio.toFixed(1) + '× comments'));
      if (isYT(p) && p.type === 'live') badges.appendChild(h('span', { class: 'badge', 'data-tip': p.liveNow ? 'Live now: the count is viewers, not views' : 'A past live stream (scored with the long-form videos)' }, 'Live'));
      if (isYT(p) && p.membersOnly) badges.appendChild(h('span', { class: 'badge', 'data-tip': 'Members only' }, 'Members'));
      // card-velocity (phase 5 brings it to the panel list): tracked videos only, "24 h: 3.4×" from the bridge's tracker.
      var vel = isYT(p) && opts.velocityOf ? opts.velocityOf(p) : null;
      if (vel) badges.appendChild(h('span', { class: 'badge badge-vel' + (vel.hot ? ' is-hot' : ''), 'data-tip': vel.tip }, vel.text));
      if (isX(p)) {
        if (p.ratio != null && p.baselineApprox) badges.appendChild(h('span', { class: 'badge', 'data-tip': xBaseTip(p) }, '≈'));
        if (p.noViews && M.xKind(p) !== 'repost') badges.appendChild(h('span', { class: 'badge', 'data-tip': xBaseTip(p) }, '≈ no data'));
        badges.appendChild(h('span', { class: 'badge', 'data-tip': p.kind === 'original' ? 'Format (scored against this format\'s median)' : p.kind === 'repost' ? 'A repost' : 'A reply' }, p.kind === 'repost' ? 'Repost' : p.kind === 'reply' ? 'Reply' : p.kind === 'thread-part' ? 'Thread part' : (X_FORMAT_NAMES[p.type] || 'Text') + (p.type === 'thread' && p.threadLength ? ' ' + p.threadLength : '')));
      }
      if (multiPlat) badges.appendChild(h('span', { class: 'badge badge-platform', 'data-tip': siteName(p) }, isTT(p) ? 'TT' : isYT(p) ? 'YT' : isX(p) ? 'X' : 'IG'));

      var meta = [];
      var xp = isX(p);
      if (!byLikes && p.likes !== null && p.likes !== undefined) meta.push(fmt(p.likes) + ' likes');
      if (p.comments !== null && p.comments !== undefined) meta.push(fmt(p.comments) + (xp ? ' replies' : ' comments'));
      if (p.shares !== null && p.shares !== undefined) meta.push(fmt(p.shares) + (xp ? ' reposts' : ' shares'));
      if (xp && p.quotes != null) meta.push(fmt(p.quotes) + ' quotes');
      if (p.saves !== null && p.saves !== undefined) meta.push(fmt(p.saves) + (xp ? ' bookmarks' : ' saves'));
      if (byLikes && p.commentsPer100Likes != null) meta.push(p.commentsPer100Likes.toFixed(p.commentsPer100Likes < 10 ? 1 : 0) + ' comments / 100 likes');
      else if (!byLikes && p.engagement !== null) meta.push(pct(p.engagement) + ' eng.');
      if (p.duration) meta.push(dur(p.duration));
      if (p.takenAt) meta.push(dateLabel(p));

      var nFiles = (p.files || []).length;
      var dl = isYT(p)
        ? downloadButton(p, 'media', DL_PATH, 1, 'Download video (yt-dlp through the OpenOutlier bridge)', '')
        : downloadButton(p, 'media', DL_PATH, nFiles,
          nFiles > 1 ? 'Download all ' + nFiles + ' files' : 'Download ' + (nFiles && p.files[0].kind === 'video' ? 'video' : 'photo'),
          isTT(p) ? 'No video link captured yet. Open the video on TikTok once.' : xp ? 'This post has no photo or video.' : 'No video link captured yet. It loads with the post details.');
      var cov = downloadButton(p, 'cover', IMG_PATH, p.thumb ? 1 : 0, 'Download cover image', 'No cover image captured yet.');

      if (opts.showOwner && p.owner) meta.unshift(ownerHandle(p));
      return h('li', { class: 'row' + (p.outlier ? ' is-outlier' : '') + (ui.detail === p.code ? ' is-active' : '') },
        h('button', { class: 'row-link', type: 'button', title: 'Details (⌘/Ctrl-click opens ' + siteName(p) + ')', onclick: function (e) {
          if (e.metaKey || e.ctrlKey) { window.open(p.url, '_blank', 'noopener'); return; }
          openDetail(p);
        } },
          h('span', { class: 'rank', text: String(i + 1) }),
          thumb,
          h('span', { class: 'row-main' },
            h('span', { class: 'row-top' },
              byLikes
                ? h('span', { class: 'views', 'data-tip': p.likes != null ? fmtFull(p.likes) + ' likes. Instagram shows no views on carousels and photos.' : p.likesHidden ? 'The creator hid the like count' : 'Likes not loaded yet' }, p.likes != null ? fmt(p.likes) : '–', h('span', { class: 'unit', text: ' likes' }))
                : h('span', { class: 'views', 'data-tip': xp ? (p.views != null ? fmtFull(p.views) + ' views. ' : '') + xBaseTip(p) : viewsTip(p) }, p.views != null ? (isYT(p) && p.viewsApprox ? '≈' : '') + fmt(p.views) : '–', h('span', { class: 'unit', text: ' ' + (isYT(p) ? tx('viewsUnit', 'views') : 'views') })),
              badges),
            h('span', { class: 'meta', text: meta.join(' · ') }),
            p.caption ? h('span', { class: 'caption', text: p.caption.replace(/\s+/g, ' ') }) : null)),
        h('span', { class: 'row-actions' }, dl, cov));
    }

    function downloadButton(p, what, path, count, tip, emptyTip) {
      if (!count) return h('span', { class: 'icon-btn dl-btn dl-none', 'data-tip': emptyTip }, icon(path, 17));
      var b = h('button', { class: 'icon-btn dl-btn', type: 'button', 'aria-label': tip, 'data-tip': tip, onclick: function () {
        b.disabled = true;
        opts.onDownloadMedia([p], what, function (label) { b.setAttribute('data-tip', label); }).then(function (r) {
          b.setAttribute('data-tip', r && r.message ? r.message : r && r.queued ? 'Saved to Downloads/OpenOutlier/' + String(p.owner || '').replace('/', '_') : (r && r.errors && r.errors[0]) || 'Download failed. Reload the profile and try again.');
        }, function () { b.setAttribute('data-tip', 'Download failed. Reload the profile and try again.'); })
          .then(function () { setTimeout(function () { b.disabled = false; }, 1500); });
      } }, icon(path, 17));
      return b;
    }

    // ---- analytics -------------------------------------------------------------
    function renderAnalytics(posts) {
      if (plat === 'reddit') return renderRedditAnalytics(posts);
      if (plat === 'youtube') return renderYouTubeAnalytics(posts);
      if (plat === 'x') return renderXAnalytics(posts);
      var a = M.analyze(posts);
      var s = a.summary;
      var wrap = h('div', { class: 'analytics' });
      var tt = plat === 'tiktok';
      if (plat === 'mixed') wrap.appendChild(h('p', { class: 'note', text: 'This list mixes Instagram and Reddit. Views and scores are added together below; open one account for clean analytics.' }));
      else if (multiPlat) wrap.appendChild(h('p', { class: 'note', text: 'This list mixes Instagram and TikTok. Open one account for clean analytics, or use Compare in the Library.' }));
      if (posts.length < 12) wrap.appendChild(h('p', { class: 'note', text: 'Only ' + posts.length + ' posts so far. Collect more (Auto-scroll) for reliable patterns.' }));
      // Instagram: reels are counted in views, carousels and photos in likes. One at a time.
      var byLikes = s.basis === 'likes';
      var u = byLikes ? 'likes' : 'views';
      var U = byLikes ? 'Likes' : 'Views';
      if (s.basis === 'mixed') wrap.appendChild(h('p', { class: 'note', text: 'This list mixes reels (counted in views) and carousels and photos (counted in likes), so the medians below add the two together. Pick "Reels & videos" or "Carousels & photos" in the ' + listTab() + ' tab for clean analytics.' }));
      var ig = a.instagram && s.basis !== 'mixed' ? a.instagram : null;

      wrap.appendChild(h('div', { class: 'tiles' },
        tile('Posts analyzed', fmtFull(s.count)),
        tile('Median ' + u, fmt(s.medianViews), fmtFull(s.medianViews) + (byLikes ? ' likes. Instagram shows no views on carousels and photos.' : '')),
        tile('Outliers (≥ ' + M.OUTLIER_RATIO + '×)', fmtFull(s.outliers), 'Posts with ≥ ' + M.OUTLIER_RATIO + '× median ' + u, s.outliers > 0),
        byLikes
          ? tile('Comments / 100 likes', s.medianCommentsPer100Likes != null ? s.medianCommentsPer100Likes.toFixed(1) : '–', 'Median comments per 100 likes')
          : tile('Avg. engagement', pct(s.avgEngagement), tt ? '(likes + comments + shares + saves) ÷ views' : '(likes + comments) ÷ views'),
        tile('Posts / week', s.postsPerWeek ? s.postsPerWeek.toFixed(1) : '–'),
        tile('Total ' + u, fmt(s.totalViews), fmtFull(s.totalViews)),
        ig ? tile('Median comments', fmt(s.medianComments), fmtFull(s.medianComments)) : null,
        ig && s.keywordPosts ? tile('Comment-keyword posts', fmtFull(s.keywordPosts), 'Posts whose caption asks people to comment a keyword ("Comment CFO and I\'ll send the link")') : null,
        tt && s.avgShareRate != null ? tile('Shares / 100 views', s.avgShareRate.toFixed(2), 'Average shares per 100 views. Shares push a video to new viewers.') : null,
        tt && s.avgSaveRate != null ? tile('Saves / 100 views', s.avgSaveRate.toFixed(2), 'Average saves per 100 views. Tutorials people come back to get saved.') : null));

      wrap.appendChild(section('Best time to post', U + ' vs. what the account was getting at the time, by day and time, in your local time. Slots with few posts are pulled toward 1×.',
        bestSlot(a.heatmap, u).concat(heatmapEl(a.heatmap, u))));

      if (ig) {
        var byComments = function (g) { return { key: g.key, count: g.count, medianViews: g.medianComments, lift: s.medianComments ? g.medianComments / s.medianComments : null }; };
        if (ig.cta.length) {
          wrap.appendChild(section('Comment-keyword posts', 'Median comments on posts that ask for a keyword in the comments ("Comment CFO and I\'ll send the link") vs. the rest. Those comments come from the giveaway, not from discussion.',
            bars(ig.cta.map(byComments), function (g) { return g.key; }, 'comments')));
          wrap.appendChild(section('Do keyword posts also get more ' + u + '?', 'Median ' + u + ' of the same two groups.', bars(ig.cta, function (g) { return g.key; }, u)));
        }
        if (ig.keywords.length) {
          wrap.appendChild(section('Keywords asked for', 'Median comments per keyword. The count is how many posts used it.',
            bars(ig.keywords.slice(0, 12).map(byComments), function (g) { return '“' + g.key + '”'; }, 'comments')));
        }
        if (byLikes && ig.types.length > 1) wrap.appendChild(section('Carousels vs. photos', 'Median likes per format.', bars(ig.types, function (g) { return g.key; }, u)));
        if (byLikes && ig.slides.length) wrap.appendChild(section('Carousel length', 'Median likes by number of slides.', bars(ig.slides, function (g) { return g.key; }, u)));
        if (ig.captions.length > 1) wrap.appendChild(section('Caption length', 'Median ' + u + ' by caption length.', bars(ig.captions, function (g) { return g.key; }, u)));
        if (ig.collabs.length) wrap.appendChild(section('Collab posts', 'Median ' + u + ' of posts shared with another account vs. solo posts.', bars(ig.collabs, function (g) { return g.key; }, u)));
      }

      wrap.appendChild(section('Hashtags that bring ' + u,
        'Median ' + u + ' of posts using each hashtag' + (a.hashtags.length && a.hashtags[a.hashtags.length - 1].count >= 2 ? ' (used 2+ times).' : '.'),
        a.hashtags.length ? bars(a.hashtags.slice(0, 12), function (g) { return '#' + g.key; }, u) : h('p', { class: 'muted small', text: 'No hashtags in these captions.' })));

      if (byLikes) {
        if (a.audio.topTracks.length) wrap.appendChild(section('Music on posts', 'Songs added to carousels and photos, by median likes.', bars(a.audio.topTracks, function (g) { return g.key; }, u)));
        return wrap;
      }

      wrap.appendChild(section('Video length', 'Median views by ' + (tt ? 'video' : 'reel') + ' duration.',
        a.durations.length ? bars(a.durations, function (g) { return g.key; }) : h('p', { class: 'muted small', text: 'No duration data yet.' })));

      var audioBody = h('div');
      var kindLabel = function (g) { return tt ? (g.key === 'Licensed music' ? 'Music' : 'Original sound') : g.key; };
      if (a.audio.kinds.length) audioBody.appendChild(bars(a.audio.kinds, kindLabel));
      if (a.audio.topTracks.length) {
        audioBody.appendChild(h('p', { class: 'subhead', text: tt ? 'Top music' : 'Top music tracks' }));
        audioBody.appendChild(bars(a.audio.topTracks, function (g) { return g.key; }));
      }
      if (!a.audio.kinds.length) audioBody.appendChild(h('p', { class: 'muted small', text: 'No audio data yet.' }));
      wrap.appendChild(section(tt ? 'Sounds' : 'Audio', tt ? 'Original sound vs. music, by median views.' : 'Original audio vs. licensed music, by median views.', audioBody));
      return wrap;
    }

    function renderXAnalytics(posts) {
      var all = opts.preEnriched ? state.posts : M.enrich(state.posts);
      // Analytics are about original posts (what the medians are made of), whatever the list shows.
      var originals = all.filter(function (p) { return M.xKind(p) === 'original'; });
      var a = M.analyze(originals, { all: all });
      var s = a.summary;
      var x = a.x;
      var wrap = h('div', { class: 'analytics' });
      wrap.appendChild(h('p', { class: 'muted small', text: 'Original posts only (replies and reposts are listed under Kinds). Views are what X shows on each post, not the verified Home impressions X pays for.' }));
      if (originals.length < 12) wrap.appendChild(h('p', { class: 'note', text: 'Only ' + originals.length + ' original posts so far. Collect more (Auto-scroll) for reliable patterns.' }));
      wrap.appendChild(h('div', { class: 'tiles' },
        tile('Originals analyzed', fmtFull(s.count)),
        tile('Median views', fmt(s.medianViews), s.medianViews != null ? fmtFull(s.medianViews) + ' (all formats together; each post is scored against its own format)' : null),
        tile('Outliers (≥ ' + M.OUTLIER_RATIO + '×)', fmtFull(s.outliers), 'Posts with ≥ ' + M.OUTLIER_RATIO + '× the median of their format', s.outliers > 0),
        tile('Avg. engagement', pct(s.avgEngagement), '(likes + replies + reposts + quotes + bookmarks) ÷ views'),
        tile('Posts / week', s.postsPerWeek ? s.postsPerWeek.toFixed(1) : '–'),
        tile('No view count', fmtFull(x.noViews), 'Posts before 2023 show no views on X; they are left out of every median')));
      wrap.appendChild(section('Formats', 'Median views per format. Each format is scored against its own median; a format with fewer than 8 posts uses the overall median (≈).',
        x.formats.length ? bars(x.formats, function (g) { return g.key; }) : h('p', { class: 'muted small', text: 'No original posts yet.' })));
      if (x.kinds.length > 1) wrap.appendChild(section('Kinds', 'How many of the saved posts are originals, replies, thread parts and reposts.',
        h('p', { class: 'muted small', text: x.kinds.map(function (k) { return k.key + ': ' + fmtFull(k.count); }).join(' · ') })));
      wrap.appendChild(section('Best time to post', 'Views vs. what the account was getting at the time, by day and time, in your local time. Slots with few posts are pulled toward 1×.',
        bestSlot(a.heatmap).concat(heatmapEl(a.heatmap))));
      if (x.lengths.length > 1) wrap.appendChild(section('Text length', 'Median views by length of the post text.', bars(x.lengths, function (g) { return g.key; })));
      if (x.links.length > 1) wrap.appendChild(section('Links', 'Posts with a link to another site vs. without.', bars(x.links, function (g) { return g.key; })));
      if (a.durations.length) wrap.appendChild(section('Video length', 'Median views by video length.', bars(a.durations, function (g) { return g.key; })));
      wrap.appendChild(section('Hashtags that bring views', 'Median views of posts using each hashtag.',
        a.hashtags.length ? bars(a.hashtags.slice(0, 12), function (g) { return '#' + g.key; }) : h('p', { class: 'muted small', text: 'No hashtags in these posts.' })));
      return wrap;
    }

    function renderYouTubeAnalytics(posts) {
      var a = M.analyze(posts, { all: M.enrich(state.posts) });
      var s = a.summary;
      var y = a.youtube;
      var shorts = ui.ytFormat === 'short';
      var what = shorts ? 'Shorts' : 'long-form videos';
      var wrap = h('div', { class: 'analytics' });
      wrap.appendChild(h('p', { class: 'muted small', text: 'Analytics for this channel\'s ' + what + ' (switch with Videos / Shorts in the Videos tab).' }));
      if (posts.length < 12) wrap.appendChild(h('p', { class: 'note', text: 'Only ' + posts.length + ' ' + what + ' so far. Collect more (Auto-scroll) for reliable patterns.' }));
      wrap.appendChild(h('div', { class: 'tiles' },
        tile(shorts ? 'Shorts analyzed' : 'Videos analyzed', fmtFull(s.count)),
        tile('Median views', fmt(s.medianViews), fmtFull(s.medianViews) + (y.approxViews ? ' (from YouTube\'s rounded counts)' : '')),
        tile('Outliers (≥ ' + M.OUTLIER_RATIO + '×)', fmtFull(s.outliers), 'Videos with ≥ ' + M.OUTLIER_RATIO + '× the median views of their format', s.outliers > 0),
        tile('Avg. engagement', pct(s.avgEngagement), s.avgEngagement == null ? 'Likes and comments load when videos are opened on YouTube' : '(likes + comments) ÷ views, over the videos that were opened'),
        tile('Posts / week', s.postsPerWeek ? s.postsPerWeek.toFixed(1) : '–', y.approxDates ? 'From YouTube\'s relative dates ("3 weeks ago"), so roughly' : null),
        tile('Total views', fmt(s.totalViews), fmtFull(s.totalViews))));

      wrap.appendChild(section('Shorts vs. long-form', 'Median views per format on this channel. Each format is scored against its own median, so a Short is an outlier only among Shorts.',
        y.formats.length ? bars(y.formats, function (g) { return g.key; }) : h('p', { class: 'muted small', text: 'No videos yet.' })));

      var timeBody = [];
      var dated = y.exactDates;
      if (dated < posts.length) {
        timeBody.push(h('p', { class: 'note', text: dated + ' of ' + posts.length + ' ' + what + ' have an exact publish date. ' +
          (y.approxDates ? y.approxDates + ' only show "… ago" on the channel page' : '') + (y.approxDates && y.noDates ? ', and ' : '') + (y.noDates ? y.noDates + ' show no date at all (the Shorts tab has none)' : '') +
          '. Best time uses exact dates only' + (dated < a.heatmap.minPosts ? ' and needs at least ' + a.heatmap.minPosts : '') + ': open videos on YouTube to add theirs.' }));
      }
      // Below a slot's worth of exact dates the grid would only show where one or two videos landed.
      if (dated >= a.heatmap.minPosts) timeBody = timeBody.concat(bestSlot(a.heatmap)).concat(heatmapEl(a.heatmap));
      wrap.appendChild(section('Best time to post', 'Views vs. what the channel was getting at the time, by day and time, in your local time. Slots with few videos are pulled toward 1×.', timeBody));

      wrap.appendChild(section('Video length', 'Median views by ' + (shorts ? 'Short' : 'video') + ' length.',
        a.durations.length ? bars(a.durations, function (g) { return g.key; }) : h('p', { class: 'muted small', text: shorts ? 'The Shorts tab shows no length. Open Shorts on YouTube to load theirs.' : 'No length data yet.' })));

      wrap.appendChild(section('Title words that perform', 'Median views of ' + what + ' whose title uses each word (common words left out).',
        y.words.length ? bars(y.words, function (g) { return g.key; }) : h('p', { class: 'muted small', text: 'Not enough titles yet to compare words.' })));
      if (y.phrases.length) wrap.appendChild(section('Phrases that perform', 'Two-word phrases from titles, by median views.', bars(y.phrases, function (g) { return g.key; })));

      wrap.appendChild(section('Hashtags that bring views',
        'Median views of ' + what + ' using each hashtag (titles; descriptions once a video is opened).',
        a.hashtags.length ? bars(a.hashtags.slice(0, 12), function (g) { return '#' + g.key; }) : h('p', { class: 'muted small', text: 'No hashtags in these titles.' })));
      return wrap;
    }

    function renderRedditAnalytics(posts) {
      var a = M.analyze(posts);
      var s = a.summary;
      var r = a.reddit;
      var wrap = h('div', { class: 'analytics' });
      if (posts.length < 25) wrap.appendChild(h('p', { class: 'note', text: 'Only ' + posts.length + ' posts so far. Use "Collect top posts" for reliable patterns.' }));
      wrap.appendChild(h('div', { class: 'tiles' },
        tile('Posts analyzed', fmtFull(s.count)),
        tile('Median score', fmt(s.medianViews), fmtFull(s.medianViews)),
        tile('Outliers (≥ ' + M.OUTLIER_RATIO + '×)', fmtFull(s.outliers), 'Posts with ≥ ' + M.OUTLIER_RATIO + '× the median score', s.outliers > 0),
        tile('Median comments', fmt(s.medianComments)),
        tile('Posts / week', s.postsPerWeek ? s.postsPerWeek.toFixed(1) : '–', 'Among the posts collected (top posts are a sample, not every post)'),
        tile('Avg. upvote ratio', s.avgUpvoteRatio != null ? Math.round(s.avgUpvoteRatio * 100) + '%' : '–')));
      wrap.appendChild(section('Best time to post',
        'Score vs. what the subreddit was getting at the time, by day and time, in your local time. Collect "new" posts too for a fuller picture: top posts only show what won.',
        bestSlot(a.heatmap, 'score').concat(heatmapEl(a.heatmap, 'score'))));
      wrap.appendChild(section('Question vs. statement', 'Median score of titles that ask a question (contain "?" or start with how / why / is there…) vs. the rest.',
        r.questions.length ? bars(r.questions, function (g) { return g.key; }, 'score') : h('p', { class: 'muted small', text: 'No titles yet.' })));
      wrap.appendChild(section('Title length', 'Median score by number of words in the title.',
        r.titleLength.length ? bars(r.titleLength, function (g) { return g.key; }, 'score') : h('p', { class: 'muted small', text: 'No titles yet.' })));
      wrap.appendChild(section('Words that perform', 'Median score of posts whose title uses each word (common words left out).',
        r.words.length ? bars(r.words, function (g) { return g.key; }, 'score') : h('p', { class: 'muted small', text: 'Not enough posts yet to compare words.' })));
      if (r.phrases.length) wrap.appendChild(section('Phrases that perform', 'Two-word phrases from titles, by median score.', bars(r.phrases, function (g) { return g.key; }, 'score')));
      wrap.appendChild(section('Flair', 'Median score by post flair.',
        r.flairs.length ? bars(r.flairs, function (g) { return g.key; }, 'score') : h('p', { class: 'muted small', text: 'No flairs on these posts.' })));
      wrap.appendChild(section('Post type', 'Text, image, video, link or gallery, by median score.',
        r.types.length ? bars(r.types, function (g) { return TYPE_NAMES[g.key] || g.key; }, 'score') : h('p', { class: 'muted small', text: 'No data yet.' })));
      return wrap;
    }

    function tile(label, value, tip, hot) {
      return h('div', { class: 'tile' + (hot ? ' hot' : ''), 'data-tip': tip || null }, h('span', { class: 'tile-value', text: value }), h('span', { class: 'tile-label', text: label }));
    }

    function liftText(c) { return c && c.lift ? c.lift.toFixed(2) + '×' : '–'; }

    /**
     * The strongest slot, called out on blue (the one highlighted number is lime).
     * Ranked by era-adjusted lift; falls back to best day / best hours when no
     * single day × time cell has enough posts.
     */
    function bestSlot(hm, u) {
      u = u || 'views';
      // A "best" that is no better than the account's average isn't worth naming.
      var STANDS_OUT = 1.05;
      var out = [];
      if (hm.best && hm.best.lift >= STANDS_OUT) {
        out.push(h('p', { class: 'callout' }, stair(),
          h('span', null, 'Strongest slot: ', h('b', { text: hm.dayLabels[hm.best.day] + ' ' + hourRange(hm.best.block, hm.blockHours) }),
            ' · ' + liftText(hm.best) + ' the account\'s usual ' + u + ' · ' + hm.best.count + ' posts (' + Math.round(hm.best.share * 100) + '% of all)')));
      }
      var parts = [];
      if (hm.bestDay && hm.bestDay.lift >= STANDS_OUT) parts.push('best day ' + hm.dayLabels[hm.bestDay.day] + ' (' + liftText(hm.bestDay) + ', ' + hm.bestDay.count + ' posts)');
      if (hm.bestHours && hm.bestHours.lift >= STANDS_OUT) parts.push('best time ' + hourRange(hm.bestHours.block, hm.blockHours) + ' (' + liftText(hm.bestHours) + ', ' + hm.bestHours.count + ' posts)');
      if (parts.length) out.push(h('p', { class: 'muted small', text: parts.join(' · ').replace(/^b/, 'B') + '.' }));
      else if (hm.bestDay) out.push(h('p', { class: 'muted small', text: 'No day or time stands out yet: the best ones are within 5% of the account\'s average.' }));
      if (hm.varietyIssue === 'concentrated') {
        out.push(h('p', { class: 'note', text: 'Not enough variety to compare times: the two busiest slots hold ' + Math.round(hm.topTwoShare * 100) + '% of ' + hm.postsWithTime +
          ' posts. This shows when the account posts, not that other times would do worse.' }));
      } else if (hm.varietyIssue === 'thin') {
        out.push(h('p', { class: 'note', text: 'Too few posts per slot to compare times (' + hm.postsWithTime + ' with a date). Collect more posts before trusting this.' }));
      } else if (!hm.best && hm.postsWithTime) {
        out.push(h('p', { class: 'muted small', text: 'No day × time slot has ' + hm.minPosts + '+ posts yet, so no single slot is called out.' }));
      }
      return out;
    }

    function section(title, sub, content) {
      return h('section', { class: 'card' }, h('h3', { text: title }), sub ? h('p', { class: 'muted small', text: sub }) : null, content);
    }

    function bars(groups, labelOf, u) {
      u = u || 'views';
      var max = Math.max.apply(null, groups.map(function (g) { return g.medianViews || 0; })) || 1;
      return h('div', { class: 'bars', role: 'table' }, groups.map(function (g) {
        var tip = labelOf(g) + ': median ' + fmtFull(g.medianViews) + ' ' + u + ' across ' + g.count + ' post' + (g.count === 1 ? '' : 's') + (g.lift ? ' (' + g.lift.toFixed(1) + '× overall median)' : '');
        return h('div', { class: 'bar-row', role: 'row', 'data-tip': tip },
          h('span', { class: 'bar-label', role: 'cell', text: labelOf(g) }),
          h('span', { class: 'bar-track', role: 'cell' },
            h('span', { class: 'bar-fill', style: { width: Math.max(1.5, (g.medianViews / max) * 100) + '%' } })),
          h('span', { class: 'bar-value', role: 'cell' }, fmt(g.medianViews), h('span', { class: 'bar-count', text: ' · ' + g.count })));
      }));
    }

    function heatmapEl(hm, u) {
      u = u || 'views';
      var blocks = 24 / hm.blockHours;
      // Shade by lift (era-adjusted, shrunk toward 1×) on a log scale centred on
      // 1×: s0 ≤ ½×, s5 ≥ 2×. Slots with few posts are pulled toward the middle.
      function stepOf(lift) {
        var l = Math.log2(lift || 1);
        return Math.max(0, Math.min(5, Math.floor((l + 1) / 2 * 6)));
      }
      var grid = h('div', { class: 'heatmap', role: 'table', style: { 'grid-template-columns': '34px repeat(' + blocks + ', 1fr)' } });
      grid.appendChild(h('span', { class: 'hm-corner' }));
      for (var b = 0; b < blocks; b++) grid.appendChild(h('span', { class: 'hm-col', text: String(b * hm.blockHours).padStart(2, '0') }));
      hm.cells.forEach(function (rowCells, d) {
        grid.appendChild(h('span', { class: 'hm-row', text: hm.dayLabels[d] }));
        rowCells.forEach(function (c) {
          var label = hm.dayLabels[d] + ' ' + hourRange(c.block, hm.blockHours);
          if (!c.count) {
            grid.appendChild(h('span', { class: 'hm-cell hm-empty', role: 'cell', 'data-tip': label + ': no posts', 'aria-label': label + ': no posts' }));
            return;
          }
          var step = stepOf(c.lift); // 0..5
          var tip = label + ': ' + liftText(c) + ' usual ' + u + ' · ' + c.count + ' post' + (c.count === 1 ? '' : 's') + ' (' + Math.round(c.share * 100) + '%)' +
            ', median ' + fmtFull(c.medianViews) + ' ' + u + (c.count < hm.minPosts ? ' · too few posts to rank' : '');
          var isBest = hm.best && hm.best.day === c.day && hm.best.block === c.block;
          grid.appendChild(h('span', { class: 'hm-cell hm-s' + step + (c.count < hm.minPosts ? ' hm-thin' : '') + (isBest ? ' hm-best' : ''), role: 'cell', 'data-tip': tip, 'aria-label': tip }));
        });
      });
      var legend = h('div', { class: 'hm-legend' }, h('span', { text: '½× or less' }),
        [0, 1, 2, 3, 4, 5].map(function (s) { return h('span', { class: 'hm-key hm-s' + s }); }),
        h('span', { text: '2× or more' }),
        h('span', { class: 'hm-key hm-s3 hm-thin hm-gap' }), h('span', { text: 'Under ' + hm.minPosts + ' posts' }),
        h('span', { class: 'hm-key hm-empty hm-gap' }), h('span', { text: 'No posts' }));
      return h('div', null, grid, legend);
    }

    // ---- export ---------------------------------------------------------------
    function renderExport(data) {
      var list = data.list;
      var name = 'openoutlier-' + String(state.selected || 'export').replace(/[^\w.-]+/g, '-') + '-' + new Date().toISOString().slice(0, 10);
      var msg = h('p', { class: 'status-line', 'aria-live': 'polite' });
      function flash(text) { msg.textContent = text; setTimeout(function () { if (msg.textContent === text) msg.textContent = ''; }, 3000); }
      return h('div', { class: 'export' },
        h('section', { class: 'card' },
          h('h3', { text: 'Export ' + fmtFull(list.length) + ' posts' }),
          h('p', { class: 'muted small', text: 'Uses the sort and filters from the ' + listTab() + ' tab (' + (sortOptions().filter(function (o) { return o[0] === sortKey(); })[0] || sortOptions()[0])[1] + (ui.outliersOnly ? ', outliers only' : '') + (ui.query ? ', search "' + ui.query + '"' : '') + ').' }),
          h('div', { class: 'export-actions' },
            h('button', { class: 'btn btn-primary', type: 'button', onclick: function () {
              opts.onDownload(name + '.csv', '﻿' + M.toTable(list, ','), 'text/csv;charset=utf-8');
              flash('CSV downloaded.');
            } }, 'Download CSV'),
            h('button', { class: 'btn', type: 'button', onclick: function () {
              opts.onCopy(M.toTable(list, '\t')).then(function () { flash('Copied. Paste into Google Sheets or Excel.'); }, function () { flash('Copy failed. Use Download CSV instead.'); });
            } }, 'Copy for Sheets / Excel'),
            h('button', { class: 'btn btn-ghost', type: 'button', onclick: function () {
              opts.onDownload(name + '.json', JSON.stringify(list, null, 2), 'application/json');
              flash('JSON downloaded.');
            } }, 'Download JSON')),
          msg),
        plat === 'reddit' ? null : downloadCard(list.filter(function (p) { return !isReddit(p); })),
        h('section', { class: 'card' },
          h('h3', { text: 'Columns' }),
          h('p', { class: 'muted small mono', text: (M.isRedditList(list) ? M.REDDIT_COLUMN_NAMES : M.isYouTubeList(list) ? M.YOUTUBE_COLUMN_NAMES : M.hasTikTok(list) ? M.TIKTOK_COLUMN_NAMES : M.COLUMN_NAMES).join(', ') })));
    }

    function downloadCard(list) {
      var msg = h('p', { class: 'status-line', 'aria-live': 'polite' });
      function bulk(what, label) {
        var posts = list.filter(function (p) { return what === 'cover' ? !!p.thumb : (p.files || []).length; });
        var count = what === 'cover' ? posts.length : posts.reduce(function (s, p) { return s + p.files.length; }, 0);
        var btn = h('button', { class: what === 'media' ? 'btn btn-primary' : 'btn', type: 'button', disabled: !count, onclick: function () {
          if (count > 20 && !confirm('Download ' + count + ' files to Downloads/OpenOutlier/' + (state.selected || '') + '?')) return;
          btn.disabled = true;
          msg.textContent = 'Starting ' + count + ' downloads…';
          opts.onDownloadMedia(posts, what).then(function (r) {
            msg.textContent = 'Started ' + r.queued + ' downloads' + (r.failed ? ', ' + r.failed + ' failed' : '') + '. Saved to Downloads/OpenOutlier/' + String(state.selected || '').replace('/', '_') + '/' +
              (r.errors && r.errors[0] ? ' ' + r.errors[0] : '');
          }, function () { msg.textContent = 'Downloads could not start.'; }).then(function () { btn.disabled = false; });
        } }, label.replace('{n}', fmtFull(count)));
        return btn;
      }
      var tt = list.length && list.every(isTT);
      if (list.length && list.every(isYT)) {
        return h('section', { class: 'card' },
          h('h3', { text: 'Download covers' }),
          h('p', { class: 'muted small', text: 'Saves each video\'s cover in the best size YouTube has (1280×720 when there is one), named with its stats, e.g. 801.4Kviews_13.4Klikes_234comments_1.7pct_youtube_ID_cover.jpg. Video files: use the download button on a video (or the overlay on its page); yt-dlp saves them through the OpenOutlier bridge, one at a time. Only download content you have the right to use.' }),
          h('div', { class: 'export-actions' }, bulk('cover', 'Download {n} covers')),
          msg);
      }
      return h('section', { class: 'card' },
        h('h3', { text: 'Download videos, photos & covers' }),
        h('p', { class: 'muted small', text: tt
          ? 'Downloads the videos in the current list, one after another. Files are named with their stats, e.g. 250Kviews_12Klikes_300comments_1.1Kshares_2.4Ksaves_6.3pct_tiktok_ID.mp4. TikTok\'s video links need this site\'s session and expire after a few hours to days: keep a tiktok.com tab open, and reload the profile if downloads fail. Only download content you have the right to use.'
          : 'Downloads the posts in the current list. Files are named with their stats, e.g. 1.2Mviews_11.1Klikes_13Kcomments_2.0pct_post_CODE.mp4. Instagram\'s file links expire after a few days, so reload the profile if downloads fail.' +
            (list.some(isYT) ? ' YouTube: covers are included; video files are saved one at a time with the download button on each video (yt-dlp through the OpenOutlier bridge).' : '') + ' Only download content you have the right to use.' }),
        h('div', { class: 'export-actions' }, bulk('media', 'Download {n} videos & photos'), bulk('cover', 'Download {n} covers')),
        msg);
    }

    return {
      host: host,
      toggle: toggle,
      setLauncherHidden: setLauncherHidden,
      isOpen: function () { return ui.open; },
      update: function (next) {
        for (var k in next) state[k] = next[k];
        render();
      }
    };
  }

  root.ReelScopePanel = { create: create };
})(typeof self !== 'undefined' ? self : this);
