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
    ['duration', 'Longest']
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
  var MIXED_SORT_OPTIONS = [
    ['viralScore', 'Viral Score'],
    ['views', 'Views / score'],
    ['comments', 'Comments'],
    ['date', 'Newest']
  ];
  var REDDIT_TYPES = [['all', 'All posts'], ['text', 'Text'], ['image', 'Image'], ['video', 'Video'], ['link', 'Link'], ['gallery', 'Gallery']];
  var PAGE = 150;

  /**
   * 'instagram' | 'tiktok' | 'reddit' | 'mixed' for a list of posts.
   * Instagram + TikTok counts as 'instagram' (both ranked by views); 'mixed' = Reddit with others.
   */
  function platformOf(posts) {
    var r = 0;
    var t = 0;
    for (var i = 0; i < posts.length; i++) { if (posts[i].platform === 'reddit') r++; else if (posts[i].platform === 'tiktok') t++; }
    if (r) return r === posts.length ? 'reddit' : 'mixed';
    return t && t === posts.length ? 'tiktok' : 'instagram';
  }
  /** Account id as shown: "@name" for Instagram, "@name (TikTok)" for TikTok, "r/excel" / "u/name" for Reddit. */
  function accountLabel(id) {
    var s = String(id || '');
    if (/^(r|u)\//.test(s)) return s;
    if (/^tt\//.test(s)) return '@' + s.slice(3) + ' (TikTok)';
    return '@' + s;
  }
  function ownerHandle(p) { return p && p.owner ? '@' + String(p.owner).replace(/^tt\//, '') : ''; }
  function isReddit(p) { return p && p.platform === 'reddit'; }
  function isTT(p) { return p && p.platform === 'tiktok'; }
  function siteName(p) { return isReddit(p) ? 'Reddit' : isTT(p) ? 'TikTok' : 'Instagram'; }
  function engagementTip(p) { return isTT(p) ? '(likes + comments + shares + saves) ÷ views' : '(likes + comments) ÷ views'; }
  function unitOf(p) { return isReddit(p) ? 'score' : 'views'; }
  var TYPE_NAMES = { reel: 'Reel', video: 'Video', photo: 'Photo', carousel: 'Carousel', text: 'Text post', image: 'Image', link: 'Link', gallery: 'Gallery', poll: 'Poll', crosspost: 'Crosspost', unknown: 'Post' };

  /**
   * create(opts) → panel controller.
   * opts: {
   *   cssText, onAutoScroll(), onClearProfile(user), onSelectProfile(user),
   *   onDownload(name, text, mime), onCopy(text), onDownloadMedia(posts, what), onOpenDashboard(),
   *   embedded: true  → render inline (no launcher/drawer chrome), used by the dashboard page
   *   preEnriched: true → posts already carry ratio/viralScore (e.g. scored per account)
   *   showOwner: true  → show @owner on each row (multi-account lists)
   *   loadImage(img, url) → optional custom image loader (dashboard cache)
   * }
   */
  function create(opts) {
    var embedded = !!opts.embedded;
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
      outliersOnly: false,
      query: '',
      shown: PAGE,
      detail: null // code of the post shown in the detail card
    };
    var state = { profiles: [], selected: null, posts: [], auto: { running: false, label: '' }, collect: null };
    var plat = 'instagram'; // platform of the current list, set in render()
    var hasTT = false;      // the list has TikTok videos (adds the Saves sort)
    var multiPlat = false;  // the list mixes platforms (rows get a platform badge)
    function sortOptions() { return plat === 'reddit' ? REDDIT_SORT_OPTIONS : plat === 'mixed' ? MIXED_SORT_OPTIONS : hasTT ? VIDEO_SORT_OPTIONS : SORT_OPTIONS; }
    function listTab() { return opts.listTabLabel || (plat === 'instagram' ? 'Reels' : plat === 'tiktok' ? 'Videos' : 'Posts'); }
    function unit() { return plat === 'reddit' ? 'score' : plat === 'mixed' ? 'views / score' : 'views'; }

    // ---- skeleton -----------------------------------------------------------
    var launcherCount = h('span', { class: 'launcher-count', text: '0' });
    var launcher = h('button', { class: 'launcher', type: 'button', 'aria-label': 'Open OpenOutlier', 'data-tip': 'OpenOutlier', onclick: function () { toggle(true); } },
      logo('mark', 'mark'), h('span', { class: 'launcher-sep', 'aria-hidden': 'true' }), launcherCount);

    var profileSelect = h('select', { class: 'profile-select', 'aria-label': 'Profile', onchange: function () { opts.onSelectProfile(profileSelect.value); } });
    var autoBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { opts.onAutoScroll(); } });
    var autoStatus = h('span', { class: 'status', 'aria-live': 'polite' });
    var collectBtn = opts.onCollect ? h('button', { class: 'btn', type: 'button', onclick: function () { opts.onCollect(); } }) : null;
    var clearBtn = h('button', { class: 'btn btn-ghost', type: 'button', onclick: function () {
      if (state.selected && confirm('Delete the saved posts for ' + accountLabel(state.selected) + '?')) opts.onClearProfile(state.selected);
    } }, 'Clear');

    var tabs = {};
    var tabBar = h('div', { class: 'tabs', role: 'tablist' });
    [['reels', opts.listTabLabel || 'Reels'], ['analytics', 'Analytics'], ['export', 'Export']].forEach(function (t) {
      tabs[t[0]] = h('button', { class: 'tab', type: 'button', role: 'tab', onclick: function () {
        if (ui.tab !== t[0]) body.scrollTop = 0;
        ui.tab = t[0];
        ui.detail = null; // a tab always shows its own content, not a detail card left open
        render();
      } }, t[1]);
      tabBar.appendChild(tabs[t[0]]);
    });

    var body = h('div', { class: 'body' });
    var detailEl = h('div', { class: 'detail', role: 'dialog', 'aria-label': 'Post details', hidden: true });
    var dashBtn = opts.onOpenDashboard
      ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Open the Library', 'data-tip': 'Open the Library: all saved accounts, folders and tags', onclick: function () { opts.onOpenDashboard(); } }, pxIcon(PX_GRID, 16))
      : null;
    var drawer = h('aside', { class: 'drawer' + (embedded ? ' embedded' : ''), 'aria-label': 'OpenOutlier', hidden: !embedded },
      embedded ? null : h('header', { class: 'head' },
        h('div', { class: 'head-row' },
          logo('wordmark', 'wordmark', 'OpenOutlier'),
          profileSelect,
          dashBtn,
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', 'data-tip': 'Close (Esc)', onclick: function () { toggle(false); } }, pxIcon(PX_CLOSE, 16))),
        hazePixels()),
      embedded ? null : h('div', { class: 'toolbar' }, autoBtn, collectBtn, autoStatus, clearBtn),
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
      launcher.hidden = ui.open;
      if (ui.open) render();
    }

    function applyTheme() {
      var de = document.documentElement;
      var dark = de.classList.contains('__fb-dark-mode') || de.classList.contains('theme-dark') ||
        (!de.classList.contains('__fb-light-mode') && !de.classList.contains('theme-light') && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      host.setAttribute('data-theme', dark ? 'dark' : 'light');
    }

    // ---- data shaping --------------------------------------------------------
    function filtered() {
      var base = state.posts.filter(function (p) {
        if (isReddit(p)) return ui.typeFilter === 'reels' || ui.typeFilter === 'all' || p.type === ui.typeFilter;
        if (ui.typeFilter === 'reels') return p.type === 'reel' || p.type === 'video';
        return ui.typeFilter === 'all';
      });
      var enriched = opts.preEnriched ? base : M.enrich(base);
      var q = ui.query.trim().toLowerCase();
      var out = enriched.filter(function (p) {
        if (ui.outliersOnly && !p.outlier) return false;
        if (q && (p.caption || '').toLowerCase().indexOf(q) === -1 && (p.hashtags || []).join(' ').indexOf(q.replace(/^#/, '')) === -1 &&
          String(p.flair || '').toLowerCase() !== q.replace(/^flair:/, '')) return false;
        return true;
      });
      return { all: enriched, list: M.sortBy(out, ui.sort) };
    }

    // ---- render --------------------------------------------------------------
    function render() {
      applyTheme();
      var total = state.posts.length;
      plat = state.platform || platformOf(state.posts);
      hasTT = state.posts.some(isTT);
      multiPlat = state.posts.some(isTT) + state.posts.some(isReddit) + state.posts.some(function (p) { return !isTT(p) && !isReddit(p); }) > 1;
      if (plat === 'reddit' && !sortOptions().some(function (o) { return o[0] === ui.sort; })) ui.sort = 'views';
      if (plat !== 'instagram' && !sortOptions().some(function (o) { return o[0] === ui.sort; })) ui.sort = 'viralScore';
      tabs.reels.textContent = listTab();
      // The dashboard reuses one panel for every platform: drop a Reddit-only type filter on video lists.
      if ((plat === 'instagram' || plat === 'tiktok') && ui.typeFilter !== 'reels' && ui.typeFilter !== 'all') ui.typeFilter = 'reels';
      launcherCount.textContent = fmtFull(total);

      // profile select
      profileSelect.textContent = '';
      if (!state.profiles.length) profileSelect.appendChild(h('option', { value: '', text: 'No profiles yet' }));
      state.profiles.forEach(function (p) {
        profileSelect.appendChild(h('option', { value: p.username, selected: p.username === state.selected, text: accountLabel(p.username) + ' (' + p.count + ')' }));
      });
      profileSelect.disabled = !state.profiles.length;

      autoBtn.textContent = state.auto.running ? 'Stop' : 'Auto-scroll';
      autoBtn.setAttribute('data-tip', state.auto.running ? 'Stop scrolling' : (opts.autoTip || 'Scroll this page automatically until every reel has loaded'));
      if (collectBtn) {
        var c = state.collect || {};
        collectBtn.textContent = c.running ? 'Stop collecting' : (c.label || 'Collect top posts');
        collectBtn.disabled = !c.running && !c.enabled;
        collectBtn.setAttribute('data-tip', c.tip || '');
      }
      autoStatus.textContent = state.auto.label || (total ? fmtFull(total) + ' posts collected' : '');
      autoStatus.setAttribute('data-tip', state.auto.label || '');
      clearBtn.disabled = !state.selected;

      Object.keys(tabs).forEach(function (k) {
        tabs[k].setAttribute('aria-selected', k === ui.tab ? 'true' : 'false');
      });
      if (!ui.open) return;

      // Re-rendering replaces the body, so keep scroll position and focus.
      var scrollTop = body.scrollTop;
      var active = shadow.activeElement;
      var focusKey = active && body.contains(active) ? active.getAttribute('aria-label') : null;
      var caret = focusKey && active.selectionStart != null ? active.selectionStart : null;

      body.textContent = '';
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
          h('li', null, 'Open a profile\'s Reels tab, e.g. ', h('code', { text: 'instagram.com/name/reels/' })),
          h('li', { text: 'Scroll down, or press Auto-scroll. Reels are collected as Instagram loads them.' }),
          h('li', { text: 'Come back here to sort, analyze and export.' })),
        h('p', { class: 'muted', text: 'Everything stays in this browser. OpenOutlier never asks for your password and never posts, likes or follows.' }));
    }

    function renderReels(data) {
      var wrap = h('div', { class: 'reels' });
      var sortSel = h('select', { 'aria-label': 'Sort by', onchange: function () { ui.sort = sortSel.value; ui.shown = PAGE; render(); } },
        sortOptions().map(function (o) { return h('option', { value: o[0], selected: o[0] === ui.sort, text: o[1] }); }));
      var typeSel = h('select', { 'aria-label': 'Post type', onchange: function () { ui.typeFilter = typeSel.value; ui.shown = PAGE; render(); } },
        plat === 'reddit'
          ? REDDIT_TYPES.map(function (t) { return h('option', { value: t[0], selected: ui.typeFilter === t[0] || (t[0] === 'all' && ui.typeFilter === 'reels'), text: t[1] }); })
          : [h('option', { value: 'reels', selected: ui.typeFilter === 'reels', text: plat === 'mixed' ? 'Reels, videos & Reddit posts' : plat === 'tiktok' ? 'Videos' : 'Reels & videos' }),
            h('option', { value: 'all', selected: ui.typeFilter === 'all', text: plat === 'tiktok' ? 'Videos & photo posts' : 'All posts' })]);
      var search = h('input', { type: 'search', placeholder: plat === 'reddit' ? 'Search titles or flair' : 'Search captions or #tags', value: ui.query, 'aria-label': 'Search captions' });
      search.addEventListener('input', function () {
        ui.query = search.value; ui.shown = PAGE;
        render();
      });
      var outl = h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: ui.outliersOnly, onchange: function (e) { ui.outliersOnly = e.target.checked; ui.shown = PAGE; render(); } }),
        'Outliers only');
      wrap.appendChild(h('div', { class: 'controls' }, h('label', { class: 'field' }, 'Sort', sortSel), typeSel, outl, search));

      var list = data.list;
      wrap.appendChild(h('p', { class: 'summary' },
        fmtFull(list.length) + ' shown · ' + (plat === 'mixed' ? 'scored against each account\'s own median' : 'median ' + fmt(M.median(data.all.map(function (p) { var v = M.val(p); return v > 0 ? v : null; }))) + ' ' + unit()) + ' · outlier = ' + M.OUTLIER_RATIO + '× median or more'));

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
      detailEl.scrollTop = 0;
      render();
    }

    function closeDetail() {
      ui.detail = null;
      detailEl.hidden = true;
      render();
    }

    function renderDetail(data) {
      var p = ui.detail && data.all.filter(function (x) { return x.code === ui.detail; })[0];
      if (!p) { ui.detail = null; detailEl.hidden = true; return; }
      var st = detailEl.scrollTop;
      detailEl.hidden = false;
      detailEl.textContent = '';
      if (isReddit(p)) { renderRedditDetail(p); detailEl.scrollTop = st; return; }
      var when = p.takenAt ? new Date(p.takenAt) : null;
      var nFiles = (p.files || []).length;
      var msg = h('p', { class: 'status-line', 'aria-live': 'polite' });
      function dl(what, label, enabled) {
        var b = h('button', { class: what === 'media' ? 'btn btn-primary' : 'btn', type: 'button', disabled: !enabled, onclick: function () {
          b.disabled = true;
          opts.onDownloadMedia([p], what).then(function (r) {
            msg.textContent = r && r.queued ? 'Saved to Downloads/OpenOutlier/' + String(p.owner || '').replace('/', '_') + '/'
              : (r && r.errors && r.errors[0]) || 'Download failed. Open the post on ' + siteName(p) + ' once, then try again.';
          }, function () { msg.textContent = 'Download failed.'; }).then(function () { b.disabled = false; });
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
          h('p', { class: 'muted small d-when', text: when ? when.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Date not loaded yet' }),
          verdict(p, 'this account\'s median views'),
          p.pinned || p.paidPartnership ? h('div', { class: 'badges' },
            p.pinned ? h('span', { class: 'badge' }, 'Pinned') : null,
            p.paidPartnership ? h('span', { class: 'badge' }, 'Paid partnership') : null) : null,
          h('div', { class: 'd-actions' },
            dl('media', nFiles > 1 ? 'Download ' + nFiles + ' files' : (p.type === 'reel' || p.type === 'video' ? 'Download video' : 'Download photo'), nFiles > 0),
            dl('cover', 'Download cover', !!p.thumb),
            h('button', { class: 'btn btn-ghost', type: 'button', onclick: function () {
              opts.onCopy(p.url).then(function () { msg.textContent = 'Link copied.'; }, function () { msg.textContent = p.url; });
            } }, 'Copy link')),
          msg)));

      detailEl.appendChild(h('div', { class: 'd-grid' },
        big('Views', fmt(p.views), p.views != null ? fmtFull(p.views) : 'Not loaded yet'),
        big('Likes', fmt(p.likes), p.likes != null ? fmtFull(p.likes) : null),
        big('Comments', fmt(p.comments), p.comments != null ? fmtFull(p.comments) : null),
        big('Shares', fmt(p.shares), p.shares != null ? fmtFull(p.shares) : 'Instagram only shares this for some posts'),
        big('Duration', p.duration ? dur(p.duration) : '–'),
        big('Engagement', pct(p.engagement), engagementTip(p)),
        big('× median', p.ratio ? p.ratio.toFixed(1) + '×' : '–', 'Views compared with this account\'s median'),
        p.saves != null ? big('Saves', fmt(p.saves), fmtFull(p.saves)) : big('Type', p.type === 'reel' ? 'Reel' : p.type.charAt(0).toUpperCase() + p.type.slice(1))));

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
      if (p.outlier) badges.appendChild(outlierBadge(p, 'This post got ' + p.ratio.toFixed(1) + '× the profile\'s median views'));
      if (p.viralScore !== null) badges.appendChild(h('span', { class: 'badge badge-score', 'data-tip': 'Viral Score: 50 = median views, 75 = 2×, 100 = 4× or more' }, 'VS ' + p.viralScore));
      if (p.pinned) badges.appendChild(h('span', { class: 'badge', 'data-tip': 'Pinned to the profile' }, 'Pinned'));
      if (multiPlat) badges.appendChild(h('span', { class: 'badge badge-platform', 'data-tip': siteName(p) }, isTT(p) ? 'TT' : 'IG'));

      var meta = [];
      if (p.likes !== null && p.likes !== undefined) meta.push(fmt(p.likes) + ' likes');
      if (p.comments !== null && p.comments !== undefined) meta.push(fmt(p.comments) + ' comments');
      if (p.shares !== null && p.shares !== undefined) meta.push(fmt(p.shares) + ' shares');
      if (p.saves !== null && p.saves !== undefined) meta.push(fmt(p.saves) + ' saves');
      if (p.engagement !== null) meta.push(pct(p.engagement) + ' eng.');
      if (p.duration) meta.push(dur(p.duration));
      if (p.takenAt) meta.push(df.format(new Date(p.takenAt)));

      var nFiles = (p.files || []).length;
      var dl = downloadButton(p, 'media', DL_PATH, nFiles,
        nFiles > 1 ? 'Download all ' + nFiles + ' files' : 'Download ' + (nFiles && p.files[0].kind === 'video' ? 'video' : 'photo'),
        isTT(p) ? 'No video link captured yet. Open the video on TikTok once.' : 'No video link captured yet. It loads with the post details.');
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
              h('span', { class: 'views', 'data-tip': p.views !== null ? fmtFull(p.views) + ' views' : 'Views not available for this post' }, p.views !== null ? fmt(p.views) : '–', h('span', { class: 'unit', text: ' views' })),
              badges),
            h('span', { class: 'meta', text: meta.join(' · ') }),
            p.caption ? h('span', { class: 'caption', text: p.caption.replace(/\s+/g, ' ') }) : null)),
        h('span', { class: 'row-actions' }, dl, cov));
    }

    function downloadButton(p, what, path, count, tip, emptyTip) {
      if (!count) return h('span', { class: 'icon-btn dl-btn dl-none', 'data-tip': emptyTip }, icon(path, 17));
      var b = h('button', { class: 'icon-btn dl-btn', type: 'button', 'aria-label': tip, 'data-tip': tip, onclick: function () {
        b.disabled = true;
        opts.onDownloadMedia([p], what).then(function (r) {
          b.setAttribute('data-tip', r && r.queued ? 'Saved to Downloads/OpenOutlier/' + String(p.owner || '').replace('/', '_') : (r && r.errors && r.errors[0]) || 'Download failed. Reload the profile and try again.');
        }, function () { b.setAttribute('data-tip', 'Download failed. Reload the profile and try again.'); })
          .then(function () { setTimeout(function () { b.disabled = false; }, 1500); });
      } }, icon(path, 17));
      return b;
    }

    // ---- analytics -------------------------------------------------------------
    function renderAnalytics(posts) {
      if (plat === 'reddit') return renderRedditAnalytics(posts);
      var a = M.analyze(posts);
      var s = a.summary;
      var wrap = h('div', { class: 'analytics' });
      var tt = plat === 'tiktok';
      if (plat === 'mixed') wrap.appendChild(h('p', { class: 'note', text: 'This list mixes Instagram and Reddit. Views and scores are added together below; open one account for clean analytics.' }));
      else if (multiPlat) wrap.appendChild(h('p', { class: 'note', text: 'This list mixes Instagram and TikTok. Open one account for clean analytics, or use Compare in the Library.' }));
      if (posts.length < 12) wrap.appendChild(h('p', { class: 'note', text: 'Only ' + posts.length + ' posts so far. Collect more (Auto-scroll) for reliable patterns.' }));

      wrap.appendChild(h('div', { class: 'tiles' },
        tile('Posts analyzed', fmtFull(s.count)),
        tile('Median views', fmt(s.medianViews), fmtFull(s.medianViews)),
        tile('Outliers (≥ ' + M.OUTLIER_RATIO + '×)', fmtFull(s.outliers), 'Posts with ≥ ' + M.OUTLIER_RATIO + '× median views', s.outliers > 0),
        tile('Avg. engagement', pct(s.avgEngagement), tt ? '(likes + comments + shares + saves) ÷ views' : '(likes + comments) ÷ views'),
        tile('Posts / week', s.postsPerWeek ? s.postsPerWeek.toFixed(1) : '–'),
        tile('Total views', fmt(s.totalViews), fmtFull(s.totalViews)),
        tt && s.avgShareRate != null ? tile('Shares / 100 views', s.avgShareRate.toFixed(2), 'Average shares per 100 views. Shares push a video to new viewers.') : null,
        tt && s.avgSaveRate != null ? tile('Saves / 100 views', s.avgSaveRate.toFixed(2), 'Average saves per 100 views. Tutorials people come back to get saved.') : null));

      wrap.appendChild(section('Best time to post', 'Median views by day and time, in your local time.',
        [bestSlot(a.heatmap, s.medianViews), heatmapEl(a.heatmap)]));

      wrap.appendChild(section('Hashtags that bring views',
        'Median views of posts using each hashtag' + (a.hashtags.length && a.hashtags[a.hashtags.length - 1].count >= 2 ? ' (used 2+ times).' : '.'),
        a.hashtags.length ? bars(a.hashtags.slice(0, 12), function (g) { return '#' + g.key; }) : h('p', { class: 'muted small', text: 'No hashtags in these captions.' })));

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
        'Median score by day and time, in your local time. Collect "new" posts too for a fuller picture: top posts only show what won.',
        [bestSlot(a.heatmap, s.medianViews), heatmapEl(a.heatmap, 'score')]));
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

    /** The strongest slot, called out on blue (the one highlighted number is lime). */
    function bestSlot(hm, overall) {
      if (!hm.best) return null;
      var lift = overall > 0 ? hm.best.medianViews / overall : null;
      return h('p', { class: 'callout' }, stair(),
        h('span', null, 'Strongest slot: ', h('b', { text: hm.dayLabels[hm.best.day] + ' ' + hourRange(hm.best.block, hm.blockHours) }),
          ' · ' + hm.best.count + ' post' + (hm.best.count === 1 ? '' : 's') + ', median ' + fmt(hm.best.medianViews) + (lift ? ' (' + lift.toFixed(1) + '× overall)' : '')));
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
      // Shade by rank (quantile), not by share of the max: one viral post would
      // otherwise push every other cell to the bottom of the scale.
      var medians = [];
      hm.cells.forEach(function (r) { r.forEach(function (c) { if (c.count) medians.push(c.medianViews); }); });
      medians.sort(function (a, b) { return a - b; });
      function stepOf(v) {
        if (medians.length < 2) return 3;
        var below = 0;
        while (below < medians.length && medians[below] < v) below++;
        return Math.min(5, Math.floor((below / (medians.length - 1)) * 6));
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
          var step = stepOf(c.medianViews); // 0..5
          var tip = label + ': ' + c.count + ' post' + (c.count === 1 ? '' : 's') + ', median ' + fmtFull(c.medianViews) + ' ' + u;
          var isBest = hm.best && hm.best.day === c.day && hm.best.block === c.block;
          grid.appendChild(h('span', { class: 'hm-cell hm-s' + step + (isBest ? ' hm-best' : ''), role: 'cell', 'data-tip': tip, 'aria-label': tip }));
        });
      });
      var legend = h('div', { class: 'hm-legend' }, h('span', { text: u === 'score' ? 'Lower score' : 'Fewer views' }),
        [0, 1, 2, 3, 4, 5].map(function (s) { return h('span', { class: 'hm-key hm-s' + s }); }),
        h('span', { text: u === 'score' ? 'Higher score' : 'More views' }),
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
          h('p', { class: 'muted small', text: 'Uses the sort and filters from the ' + listTab() + ' tab (' + (sortOptions().filter(function (o) { return o[0] === ui.sort; })[0] || sortOptions()[0])[1] + (ui.outliersOnly ? ', outliers only' : '') + (ui.query ? ', search "' + ui.query + '"' : '') + ').' }),
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
          h('p', { class: 'muted small mono', text: (M.isRedditList(list) ? M.REDDIT_COLUMN_NAMES : M.hasTikTok(list) ? M.TIKTOK_COLUMN_NAMES : M.COLUMN_NAMES).join(', ') })));
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
      return h('section', { class: 'card' },
        h('h3', { text: 'Download videos, photos & covers' }),
        h('p', { class: 'muted small', text: tt
          ? 'Downloads the videos in the current list, one after another. Files are named with their stats, e.g. 250Kviews_12Klikes_300comments_1.1Kshares_2.4Ksaves_6.3pct_tiktok_ID.mp4. TikTok\'s video links need this site\'s session and expire after a few hours to days: keep a tiktok.com tab open, and reload the profile if downloads fail. Only download content you have the right to use.'
          : 'Downloads the posts in the current list. Files are named with their stats, e.g. 1.2Mviews_11.1Klikes_13Kcomments_2.0pct_post_CODE.mp4. Instagram\'s file links expire after a few days, so reload the profile if downloads fail. Only download content you have the right to use.' }),
        h('div', { class: 'export-actions' }, bulk('media', 'Download {n} videos & photos'), bulk('cover', 'Download {n} covers')),
        msg);
    }

    return {
      host: host,
      toggle: toggle,
      isOpen: function () { return ui.open; },
      update: function (next) {
        for (var k in next) state[k] = next[k];
        render();
      }
    };
  }

  root.ReelScopePanel = { create: create };
})(typeof self !== 'undefined' ? self : this);
