// OpenOutlier Library – full-page view of every saved account (Instagram
// profiles, TikTok profiles, subreddits and Reddit users side by side), with
// folders, tags, per-account analytics, a cross-account "Top posts" ranking and
// an Instagram ↔ TikTok comparison of the same videos.
// Reads the same chrome.storage.local data the content scripts write.
// Account ids: "name" = Instagram, "tt/name" = TikTok, "r/excel" / "u/name" = Reddit.
(async function () {
  'use strict';
  var M = self.ReelScopeMetrics;
  var P = self.ReelScopePanel;
  var CMP = self.ReelScopeCompare;
  var KEY_PREFIX = 'rs:p:';
  var ORG_KEY = 'rs:org';
  var SMALL = 5;

  var nf = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
  var nfFull = new Intl.NumberFormat();
  var rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  function fmt(n) { return n === null || n === undefined ? '–' : nf.format(n); }
  function ago(ts) {
    if (!ts) return 'never';
    var s = (ts - Date.now()) / 1000;
    var units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
    for (var i = 0; i < units.length; i++) if (Math.abs(s) >= units[i][1]) return rtf.format(Math.round(s / units[i][1]), units[i][0]);
    return 'just now';
  }

  function h(tag, attrs) {
    var el = document.createElement(tag);
    for (var k in attrs || {}) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }

  // ---- state ----------------------------------------------------------------
  var accounts = {}; // username -> { username, posts: [], updatedAt, stats }
  var org = { folders: [], accounts: {} };
  var search = '';
  var showSmall = false;
  try { showSmall = localStorage.getItem('rs:showSmall') === '1'; } catch (e) { /* ignore */ }
  var lastScopeHash = '#/all';

  function isVideo(p) { return p.type === 'reel' || p.type === 'video'; }
  function isRedditId(id) { return /^(r|u)\//.test(String(id || '')); }
  function isTikTokId(id) { return /^tt\//.test(String(id || '')); }
  function handle(id) { return isTikTokId(id) ? '@' + id.slice(3) : '@' + id; }
  function label(id) { return isRedditId(id) ? id : handle(id); }
  function platformOf(id) { return isRedditId(id) ? 'reddit' : isTikTokId(id) ? 'tiktok' : 'instagram'; }
  var PLATFORM_NAMES = { instagram: 'Instagram', tiktok: 'TikTok', reddit: 'Reddit' };
  /** Posts that count for an account: reels/videos on Instagram and TikTok, every post on Reddit. */
  function counts(p) { return p.platform === 'reddit' || isVideo(p); }

  function summarize(username, rec) {
    var posts = Object.values(rec.posts || {});
    var enriched = M.enrich(posts);
    var videos = enriched.filter(counts);
    var withViews = videos.filter(function (p) { return M.val(p) > 0; });
    var latest = posts.slice().sort(function (a, b) { return (b.seenAt || 0) - (a.seenAt || 0); })[0] || {};
    var pic = null;
    var name = null;
    posts.forEach(function (p) { if (!pic && p.ownerPic) pic = p.ownerPic; if (!name && p.ownerName) name = p.ownerName; });
    return {
      username: username,
      platform: platformOf(username),
      profile: rec.profile || null, // TikTok: followers, video count from the profile page
      updatedAt: rec.updatedAt || latest.seenAt || null,
      posts: posts,
      enriched: enriched,
      pic: latest.ownerPic || pic,
      name: latest.ownerName || name,
      count: posts.length,
      reels: videos.length,
      medianViews: M.median(withViews.map(M.val)),
      outliers: videos.filter(function (p) { return p.outlier; }).length,
      top: withViews.slice().sort(function (a, b) { return M.val(b) - M.val(a); }).slice(0, 3)
    };
  }

  async function load() {
    var all = await chrome.storage.local.get(null);
    accounts = {};
    Object.keys(all).forEach(function (k) {
      if (k.indexOf(KEY_PREFIX) !== 0 || !all[k] || !all[k].posts) return;
      var u = k.slice(KEY_PREFIX.length);
      accounts[u] = summarize(u, all[k]);
    });
    var o = all[ORG_KEY];
    org = { folders: (o && Array.isArray(o.folders)) ? o.folders : [], accounts: (o && o.accounts) || {} };
    await mentionsView.load();
  }

  function saveOrg() {
    var patch = {};
    patch[ORG_KEY] = org;
    return chrome.storage.local.set(patch);
  }

  function orgOf(u) {
    if (!org.accounts[u]) org.accounts[u] = { folder: null, tags: [] };
    if (!Array.isArray(org.accounts[u].tags)) org.accounts[u].tags = [];
    return org.accounts[u];
  }
  function folderOf(u) { var f = org.accounts[u] && org.accounts[u].folder; return f && org.folders.some(function (x) { return x.id === f; }) ? f : null; }
  function tagsOf(u) { return (org.accounts[u] && org.accounts[u].tags) || []; }
  function folderName(id) { var f = org.folders.filter(function (x) { return x.id === id; })[0]; return f ? f.name : ''; }
  function allTags() {
    var counts = {};
    Object.keys(accounts).forEach(function (u) { tagsOf(u).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; }); });
    return Object.keys(counts).sort().map(function (t) { return { tag: t, count: counts[t] }; });
  }

  // ---- routing --------------------------------------------------------------
  function route() {
    var parts = location.hash.replace(/^#\/?/, '').split('/').map(function (x) { return decodeURIComponent(x); });
    var kind = parts[0] || 'all';
    if (kind === 'account') return { kind: 'account', id: parts[1] };
    if (kind === 'mentions') return { kind: 'mentions' };
    if (kind === 'compare') return { kind: 'compare', ig: parts[1] || null, tt: parts[2] || null };
    if (kind === 'folder' || kind === 'tag') return { kind: kind, id: parts[1], tab: parts[2] === 'reels' ? 'reels' : 'accounts' };
    if (kind === 'unsorted') return { kind: 'unsorted', tab: parts[1] === 'reels' ? 'reels' : 'accounts' };
    if (kind === 'platform') return { kind: 'platform', id: parts[1] === 'reddit' || parts[1] === 'tiktok' ? parts[1] : 'instagram', tab: parts[2] === 'reels' ? 'reels' : 'accounts' };
    return { kind: 'all', tab: parts[1] === 'reels' ? 'reels' : 'accounts' };
  }
  function scopeHash(r, tab) {
    var base = r.kind === 'folder' || r.kind === 'tag' || r.kind === 'platform' ? '#/' + r.kind + '/' + encodeURIComponent(r.id) : '#/' + r.kind;
    return base + (tab === 'reels' ? '/reels' : '');
  }
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }

  function inScope(u, r) {
    var a = accounts[u];
    if (!a) return false;
    if (!showSmall && a.count < SMALL && r.kind !== 'folder' && r.kind !== 'tag') return false;
    if (search) {
      var q = search.toLowerCase().replace(/^@/, '').replace(/^\/?(r|u|tt)\//, '');
      if (u.indexOf(q) === -1 && String(a.name || '').toLowerCase().indexOf(q) === -1) return false;
    }
    if (r.kind === 'platform') return a.platform === r.id;
    if (r.kind === 'unsorted') return !folderOf(u);
    if (r.kind === 'folder') return folderOf(u) === r.id;
    if (r.kind === 'tag') return tagsOf(u).indexOf(r.id) !== -1;
    return true;
  }
  function scopeAccounts(r) {
    return Object.keys(accounts).filter(function (u) { return inScope(u, r); })
      .sort(function (a, b) { return (accounts[b].updatedAt || 0) - (accounts[a].updatedAt || 0); });
  }
  function scopeTitle(r) {
    if (r.kind === 'unsorted') return 'Unsorted';
    if (r.kind === 'folder') return folderName(r.id) || 'Folder';
    if (r.kind === 'tag') return '#' + r.id;
    if (r.kind === 'platform') return PLATFORM_NAMES[r.id] || 'Instagram';
    return 'All accounts';
  }

  // ---- images (cached, so covers keep working after Instagram's links expire) ---
  var thumbs = (function () {
    var mem = new Map();
    var dbP = new Promise(function (resolve) {
      try {
        var req = indexedDB.open('reelscope', 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('thumbs'); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    function idb(db, mode, fn) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction('thumbs', mode);
          var r = fn(tx.objectStore('thumbs'));
          tx.oncomplete = function () { resolve(r && r.result); };
          tx.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    }
    var queue = [];
    var active = 0;
    function pump() {
      while (active < 6 && queue.length) {
        var job = queue.shift();
        active++;
        get(job.url).then(job.ok, job.fail).then(function () { active--; pump(); });
      }
    }
    async function get(url) {
      if (mem.has(url)) return mem.get(url);
      var db = await dbP;
      var blob = db ? await idb(db, 'readonly', function (s) { return s.get(url); }) : null;
      if (!blob) {
        var res = await fetch(url, { credentials: 'omit' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        blob = await res.blob();
        if (db) idb(db, 'readwrite', function (s) { return s.put(blob, url); });
      }
      var obj = URL.createObjectURL(blob);
      mem.set(url, obj);
      return obj;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        var img = e.target;
        var url = img.getAttribute('data-src');
        queue.push({ url: url, ok: function (u) { img.src = u; }, fail: function () { img.src = url; } });
        pump();
      });
    }, { rootMargin: '300px' });
    return {
      load: function (img, url) {
        if (mem.has(url)) { img.src = mem.get(url); return; }
        img.setAttribute('data-src', url);
        io.observe(img);
      }
    };
  })();

  function img(url, cls, fallbackText) {
    if (!url) return h('div', { class: cls + ' thumb-empty' }, fallbackText || null);
    var el = h('img', { class: cls, alt: '', referrerpolicy: 'no-referrer' });
    el.addEventListener('error', function () { el.replaceWith(h('div', { class: cls + ' thumb-empty' }, fallbackText || null)); });
    thumbs.load(el, url);
    return el;
  }

  // ---- shared actions -------------------------------------------------------
  function downloadPosts(posts, what) {
    return chrome.runtime.sendMessage({
      type: 'reelscope:download',
      what: what,
      posts: posts.map(function (p) {
        return { code: p.code, owner: p.owner, platform: p.platform, views: p.views, likes: p.likes, comments: p.comments, shares: p.shares, saves: p.saves, files: p.files, cover: p.thumb };
      })
    });
  }
  function downloadFile(filename, text, mime) {
    var url = URL.createObjectURL(new Blob([text], { type: mime }));
    var a = h('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  var cssText = await (await fetch('../src/panel.css')).text();
  var common = {
    embedded: true,
    cssText: cssText,
    onDownload: downloadFile,
    onCopy: function (t) { return navigator.clipboard.writeText(t); },
    onDownloadMedia: downloadPosts,
    loadImage: function (el, url) { thumbs.load(el, url); }
  };
  var accountPanel = P.create(Object.assign({}, common));
  var mentionsView = self.ReelScopeMentionsView.create({ h: h, ago: ago, rerender: function () { if (route().kind === 'mentions') { renderSidebar(route()); mentionsView.render(main); } } });
  var reelsPanel = P.create(Object.assign({}, common, { preEnriched: true, showOwner: true, defaultSort: 'viralScore', listTabLabel: 'Posts' }));

  // ---- pixel icons (16-unit grid, crisp edges) -------------------------------
  var PX = {
    bell: 'M7 1h2v2H7zM5 3h6v2H5zM4 5h8v5H4zM3 10h10v2H3zM6 13h4v2H6z',
    all: 'M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z',
    top: 'M2 12h3v3H2zM6 8h3v7H6zM10 3h3v12h-3z',
    folder: 'M1 3h6v2h8v9H1z',
    inbox: 'M1 2h14v12H1zM3 4v4h3v2h4V8h3V4z',
    compare: 'M10 2h2v2h2v2H2V4h8zM2 10h12v2h-2v2h-2v-2H2z',
    back: 'M6 3h2v2H6zM4 5h2v2H4zM2 7h12v2H2zM4 9h2v2H4zM6 11h2v2H6z'
  };
  function px(name, size) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', size || 14);
    svg.setAttribute('height', size || 14);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('shape-rendering', 'crispEdges');
    var path = document.createElementNS(NS, 'path');
    path.setAttribute('d', PX[name]);
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    return svg;
  }
  /** Three pixels rising up-right (the logo's trail): marks an outlier. */
  function stair() { return h('span', { class: 'stair', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')); }
  function outlierBadge(ratio, tip) { return h('span', { class: 'badge-outlier', title: tip || null }, stair(), times(ratio)); }

  // ---- sidebar --------------------------------------------------------------
  function navItem(label, count, hash, current, extra) {
    var ico = extra && extra.icon;
    var b = h('button', { class: 'nav-item', type: 'button', 'aria-current': current ? 'true' : 'false', onclick: function () { go(hash); } },
      h('span', { class: 'nav-ico' }, ico === '#' ? '#' : ico ? px(ico) : null),
      h('span', { class: 'label', text: label }),
      extra && extra.badge ? h('span', { class: 'nav-new', text: String(count) }) : h('span', { class: 'count', text: count == null ? '' : String(count) }));
    if (extra && extra.dropFolder !== undefined) {
      b.addEventListener('dragover', function (e) { e.preventDefault(); b.classList.add('drop-target'); });
      b.addEventListener('dragleave', function () { b.classList.remove('drop-target'); });
      b.addEventListener('drop', function (e) {
        e.preventDefault();
        b.classList.remove('drop-target');
        var u = e.dataTransfer.getData('text/reelscope-account');
        if (!u) return;
        orgOf(u).folder = extra.dropFolder;
        saveOrg().then(render);
      });
    }
    return b;
  }

  function renderSidebar(r) {
    var all = Object.keys(accounts).filter(function (u) { return showSmall || accounts[u].count >= SMALL; });
    var lib = document.getElementById('nav-library');
    lib.textContent = '';
    var unreadMentions = mentionsView.unread();
    lib.appendChild(navItem('Mentions', unreadMentions ? unreadMentions + ' new' : null, '#/mentions', r.kind === 'mentions', { icon: 'bell', badge: !!unreadMentions }));
    lib.appendChild(navItem('All accounts', all.length, '#/all', r.kind === 'all' && r.tab !== 'reels', { icon: 'all' }));
    lib.appendChild(navItem('Top posts', null, '#/all/reels', r.kind === 'all' && r.tab === 'reels', { icon: 'top' }));
    lib.appendChild(navItem('Unsorted', all.filter(function (u) { return !folderOf(u); }).length, '#/unsorted', r.kind === 'unsorted', { dropFolder: null, icon: 'inbox' }));
    var nReddit = all.filter(isRedditId).length;
    var nTikTok = all.filter(isTikTokId).length;
    var nIg = all.length - nReddit - nTikTok;
    if (nReddit || nTikTok) {
      [['instagram', nIg], ['tiktok', nTikTok], ['reddit', nReddit]].forEach(function (x) {
        if (x[1]) lib.appendChild(navItem(PLATFORM_NAMES[x[0]], x[1], '#/platform/' + x[0], r.kind === 'platform' && r.id === x[0], { icon: null }));
      });
    }
    if (nTikTok && nIg) lib.appendChild(navItem('Compare IG ↔ TikTok', null, '#/compare', r.kind === 'compare', { icon: 'compare' }));

    var nf_ = document.getElementById('nav-folders');
    nf_.textContent = '';
    if (!org.folders.length) nf_.appendChild(h('p', { class: 'nav-empty', text: 'No folders yet. Use + to add one.' }));
    org.folders.forEach(function (f) {
      var count = Object.keys(accounts).filter(function (u) { return folderOf(u) === f.id; }).length;
      var current = (r.kind === 'folder' && r.id === f.id) || (r.kind === 'account' && folderOf(r.id) === f.id);
      nf_.appendChild(h('div', { class: 'nav-row' },
        navItem(f.name, count, '#/folder/' + encodeURIComponent(f.id), current, { dropFolder: f.id, icon: 'folder' }),
        h('span', { class: 'row-tools' },
          h('button', { class: 'icon-btn', type: 'button', title: 'Rename folder', 'aria-label': 'Rename folder ' + f.name, onclick: function (e) {
            e.stopPropagation();
            var name = prompt('Rename folder', f.name);
            if (name && name.trim()) { f.name = name.trim().slice(0, 60); saveOrg().then(render); }
          } }, '✎'),
          h('button', { class: 'icon-btn', type: 'button', title: 'Delete folder', 'aria-label': 'Delete folder ' + f.name, onclick: function (e) {
            e.stopPropagation();
            if (!confirm('Delete the folder "' + f.name + '"? Its accounts move to Unsorted (no data is deleted).')) return;
            org.folders = org.folders.filter(function (x) { return x.id !== f.id; });
            Object.keys(org.accounts).forEach(function (u) { if (org.accounts[u].folder === f.id) org.accounts[u].folder = null; });
            saveOrg().then(function () { go('#/all'); });
          } }, '×'))));
    });

    var nt = document.getElementById('nav-tags');
    nt.textContent = '';
    var tags = allTags();
    if (!tags.length) nt.appendChild(h('p', { class: 'nav-empty', text: 'Add tags on an account page.' }));
    tags.forEach(function (t) {
      nt.appendChild(navItem(t.tag, t.count, '#/tag/' + encodeURIComponent(t.tag), r.kind === 'tag' && r.id === t.tag, { icon: '#' }));
    });
    document.getElementById('show-small').checked = showSmall;
  }

  // ---- main views -----------------------------------------------------------
  var main = document.getElementById('main');

  function platformChip(platform) {
    return h('span', { class: 'chip chip-platform', title: PLATFORM_NAMES[platform], text: platform === 'instagram' ? 'IG' : platform === 'tiktok' ? 'TT' : 'Reddit' });
  }

  function accountCard(a) {
    var u = a.username;
    var reddit = a.platform === 'reddit';
    var tiktok = a.platform === 'tiktok';
    var card = h('div', { class: 'card' + (reddit ? ' card-reddit' : ''), role: 'button', tabindex: '0', draggable: 'true', 'aria-label': label(u),
      onclick: function () { go('#/account/' + encodeURIComponent(u)); },
      onkeydown: function (e) { if (e.key === 'Enter') go('#/account/' + encodeURIComponent(u)); },
      ondragstart: function (e) { e.dataTransfer.setData('text/reelscope-account', u); card.classList.add('dragging'); },
      ondragend: function () { card.classList.remove('dragging'); } },
      h('div', { class: 'card-head' },
        reddit ? h('div', { class: 'avatar thumb-empty', text: u.charAt(2).toUpperCase() }) : img(a.pic, 'avatar', handle(u).charAt(1).toUpperCase()),
        h('div', { class: 'card-name' }, h('b', { text: label(u) }), h('span', { text: (reddit ? 'Reddit · ' : (a.name ? a.name + ' · ' : '')) + 'updated ' + ago(a.updatedAt) })),
        platformChip(a.platform)),
      reddit
        ? h('ol', { class: 'top-titles' }, a.top.map(function (p) { return h('li', null, h('b', { text: fmt(p.score) }), ' ', p.title || ''); }))
        : h('div', { class: 'covers' }, [0, 1, 2].map(function (i) {
          var t = a.top[i];
          if (!t) return h('div', { class: 'cover-cell' }, h('div', { class: 'thumb-empty' }));
          return h('div', { class: 'cover-cell' }, img(t.thumb, 'cover'), t.outlier ? outlierBadge(t.ratio, times(t.ratio) + ' this account\'s median views') : null);
        })),
      h('div', { class: 'card-stats' },
        h('div', null, h('b', { text: nfFull.format(a.reels) }), h('span', { text: reddit ? 'posts' : tiktok ? 'videos' : 'reels' })),
        h('div', null, h('b', { text: fmt(a.medianViews) }), h('span', { text: reddit ? 'median score' : 'median views' })),
        h('div', null, h('b', { text: nfFull.format(a.outliers) }), h('span', { text: 'outliers' }))),
      folderOf(u) || tagsOf(u).length ? h('div', { class: 'chips' },
        folderOf(u) ? h('span', { class: 'chip folder' }, px('folder', 12), folderName(folderOf(u))) : null,
        tagsOf(u).map(function (t) { return h('span', { class: 'chip', text: '#' + t }); })) : null);
    return card;
  }

  function renderScope(r) {
    lastScopeHash = scopeHash(r, r.tab);
    var list = scopeAccounts(r);
    main.classList.toggle('has-panel', r.tab === 'reels' && list.length > 0);
    main.textContent = '';
    var seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'View' },
      h('button', { type: 'button', 'aria-pressed': r.tab !== 'reels' ? 'true' : 'false', onclick: function () { go(scopeHash(r, 'accounts')); } }, 'Accounts'),
      h('button', { type: 'button', 'aria-pressed': r.tab === 'reels' ? 'true' : 'false', onclick: function () { go(scopeHash(r, 'reels')); } }, 'Top posts'));
    var by = { instagram: 0, tiktok: 0, reddit: 0 };
    list.forEach(function (u) { by[accounts[u].platform] += accounts[u].reels; });
    main.appendChild(h('div', { class: 'view-head' },
      h('h1', { text: scopeTitle(r) }),
      h('span', { class: 'sub', text: list.length + ' account' + (list.length === 1 ? '' : 's') +
        (by.instagram || (!by.reddit && !by.tiktok) ? ' · ' + nfFull.format(by.instagram) + ' reels' : '') +
        (by.tiktok ? ' · ' + nfFull.format(by.tiktok) + ' TikTok videos' : '') +
        (by.reddit ? ' · ' + nfFull.format(by.reddit) + ' Reddit posts' : '') }),
      seg));

    if (!Object.keys(accounts).length) {
      main.appendChild(h('div', { class: 'empty' },
        h('h2', { text: 'No saved accounts yet' }),
        h('p', null, 'Open a profile\'s Reels tab on instagram.com, a profile on tiktok.com, or a subreddit on reddit.com (e.g. r/excel/top), and scroll or press Auto-scroll / Collect top posts in the OpenOutlier panel. Every account you collect is saved here automatically.')));
      return;
    }
    if (!list.length) {
      main.appendChild(h('div', { class: 'empty' }, h('p', { text: r.kind === 'folder' ? 'This folder is empty. Drag account cards onto it in the sidebar, or pick a folder on an account page.' : 'No accounts match.' })));
      return;
    }

    if (r.tab === 'reels') {
      // Score each reel against its own account's median, then rank them together.
      var posts = [];
      list.forEach(function (u) { posts = posts.concat(accounts[u].enriched); });
      main.appendChild(h('p', { class: 'sub', style: 'margin:-6px 0 12px', text: 'Every reel, TikTok video and Reddit post in this view, scored against its own account\'s median (views on Instagram and TikTok, score on Reddit), so small and big accounts compare fairly.' }));
      main.appendChild(h('div', { class: 'panel-slot' }, reelsPanel.host));
      reelsPanel.update({ posts: posts, selected: scopeTitle(r).replace(/[^\w.-]+/g, '-'), profiles: [], platform: null });
      return;
    }
    var totals = { posts: 0, outliers: 0, last: 0 };
    list.forEach(function (u) { var a = accounts[u]; totals.posts += a.reels; totals.outliers += a.outliers; totals.last = Math.max(totals.last, a.updatedAt || 0); });
    main.appendChild(h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('span', { class: 'kpi-label', text: 'Posts' }), h('b', { text: nfFull.format(totals.posts) })),
      h('div', { class: 'kpi' + (totals.outliers ? ' hot' : '') }, h('span', { class: 'kpi-label', text: 'Outliers (≥ ' + M.OUTLIER_RATIO + '×)' }), h('b', { text: nfFull.format(totals.outliers) })),
      h('div', { class: 'kpi' }, h('span', { class: 'kpi-label', text: 'Accounts' }), h('b', { text: nfFull.format(list.length) })),
      h('div', { class: 'kpi' }, h('span', { class: 'kpi-label', text: 'Last collected' }), h('b', { text: totals.last ? ago(totals.last) : '–' }))));
    main.appendChild(h('div', { class: 'cards' }, list.map(function (u) { return accountCard(accounts[u]); })));
  }

  function renderAccount(u) {
    var a = accounts[u];
    main.classList.add('has-panel');
    main.textContent = '';
    if (!a) {
      main.classList.remove('has-panel');
      main.appendChild(h('div', { class: 'empty' }, h('h2', { text: label(u) + ' has no saved data' }), h('p', null, h('a', { href: lastScopeHash, text: 'Back to the library' }))));
      return;
    }
    var o = orgOf(u);
    var folderSel = h('select', { 'aria-label': 'Folder', onchange: function () {
      if (folderSel.value === '__new') {
        var f = newFolder();
        if (f) o.folder = f.id;
      } else {
        o.folder = folderSel.value || null;
      }
      saveOrg().then(render);
    } },
      h('option', { value: '', text: 'No folder', selected: !folderOf(u) }),
      org.folders.map(function (f) { return h('option', { value: f.id, text: f.name, selected: folderOf(u) === f.id }); }),
      h('option', { value: '__new', text: '+ New folder…' }));

    var tagList = h('datalist', { id: 'tag-options' }, allTags().map(function (t) { return h('option', { value: t.tag }); }));
    var tagInput = h('input', { type: 'text', class: 'tag-input', placeholder: 'Add tag + Enter', list: 'tag-options', 'aria-label': 'Add tag' });
    tagInput.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var t = tagInput.value.trim().toLowerCase().replace(/^#/, '').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 40);
      if (t && o.tags.indexOf(t) === -1) { o.tags.push(t); saveOrg().then(render); }
      tagInput.value = '';
    });

    main.appendChild(h('button', { class: 'btn btn-ghost back', type: 'button', onclick: function () { go(lastScopeHash); } }, px('back'), 'Back'));
    var twin = a.platform === 'tiktok' ? (accounts[u.slice(3)] ? u.slice(3) : null) : a.platform === 'instagram' ? (accounts['tt/' + u] ? 'tt/' + u : null) : null;
    var prof = a.profile || {};
    main.appendChild(h('div', { class: 'acct-head' },
      a.platform === 'reddit' ? h('div', { class: 'avatar big thumb-empty', text: u.charAt(2).toUpperCase() }) : img(a.pic, 'avatar big', handle(u).charAt(1).toUpperCase()),
      h('div', { class: 'acct-title' },
        h('h1', null, label(u), ' ', platformChip(a.platform)),
        h('p', { text: (a.platform === 'reddit' ? 'Reddit · ' : (a.name ? a.name + ' · ' : '')) +
          (prof.followers != null ? fmt(prof.followers) + ' followers · ' : '') +
          nfFull.format(a.count) + ' posts saved' + (prof.videos ? ' of ~' + nfFull.format(prof.videos) : '') + ' · updated ' + ago(a.updatedAt) }),
        h('p', null, a.platform === 'reddit'
          ? h('a', { href: 'https://www.reddit.com/' + (u.charAt(0) === 'u' ? 'user/' + encodeURIComponent(u.slice(2)) + '/submitted/' : 'r/' + encodeURIComponent(u.slice(2)) + '/top/?t=year'), target: '_blank', rel: 'noopener', text: 'Open on Reddit to refresh ↗' })
          : a.platform === 'tiktok'
            ? h('a', { href: 'https://www.tiktok.com/@' + encodeURIComponent(u.slice(3)), target: '_blank', rel: 'noopener', text: 'Open on TikTok to refresh ↗' })
            : h('a', { href: 'https://www.instagram.com/' + encodeURIComponent(u) + '/reels/', target: '_blank', rel: 'noopener', text: 'Open on Instagram to refresh ↗' }),
          twin ? ' · ' : null,
          twin ? h('a', { href: '#/compare/' + encodeURIComponent(a.platform === 'tiktok' ? twin : u) + '/' + encodeURIComponent(a.platform === 'tiktok' ? u : twin), text: '⇄ Compare with ' + (a.platform === 'tiktok' ? 'Instagram' : 'TikTok') }) : null)),
      h('div', { class: 'organize' },
        h('label', null, 'Folder', folderSel),
        h('div', { class: 'chips' }, o.tags.map(function (t) {
          return h('span', { class: 'chip' }, '#' + t, h('button', { type: 'button', 'aria-label': 'Remove tag ' + t, onclick: function () {
            o.tags = o.tags.filter(function (x) { return x !== t; }); saveOrg().then(render);
          } }, '×'));
        })),
        tagInput, tagList,
        h('button', { class: 'btn btn-ghost btn-danger', type: 'button', onclick: function () {
          if (!confirm('Delete all saved data for ' + label(u) + '? This cannot be undone.')) return;
          chrome.storage.local.remove(KEY_PREFIX + u).then(function () {
            delete org.accounts[u];
            return saveOrg();
          }).then(function () { go(lastScopeHash); });
        } }, 'Delete data'))));
    main.appendChild(h('div', { class: 'panel-slot' }, accountPanel.host));
    accountPanel.update({ posts: a.posts, selected: u, profiles: [], platform: a.platform });
  }

  function newFolder() {
    var name = prompt('New folder name');
    if (!name || !name.trim()) return null;
    var f = { id: 'f' + Date.now().toString(36), name: name.trim().slice(0, 60) };
    org.folders.push(f);
    return f;
  }

  // ---- compare: the same videos on Instagram and TikTok ------------------------
  var cmpUi = { sort: 'date' };
  function pct(n) { return n == null ? '–' : n.toFixed(n < 10 ? 1 : 0) + '%'; }
  function times(n) { return n == null ? '–' : n.toFixed(n < 10 ? 1 : 0) + '×'; }
  function shortDate(t) { return t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '–'; }

  function defaultPair(r) {
    var igs = Object.keys(accounts).filter(function (u) { return accounts[u].platform === 'instagram'; });
    var tts = Object.keys(accounts).filter(function (u) { return accounts[u].platform === 'tiktok'; });
    var ig = r.ig && accounts[r.ig] ? r.ig : null;
    var tt = r.tt && accounts[r.tt] ? r.tt : null;
    if (!ig && tt && accounts[tt.slice(3)]) ig = tt.slice(3);
    if (!tt && ig && accounts['tt/' + ig]) tt = 'tt/' + ig;
    if (!ig && !tt) {
      var same = tts.filter(function (t) { return accounts[t.slice(3)]; })[0];
      if (same) { tt = same; ig = same.slice(3); }
    }
    var bySize = function (a, b) { return accounts[b].reels - accounts[a].reels; };
    return { ig: ig || igs.sort(bySize)[0] || null, tt: tt || tts.sort(bySize)[0] || null, igs: igs.sort(), tts: tts.sort() };
  }

  function renderCompare(r) {
    main.classList.remove('has-panel');
    main.textContent = '';
    var pair = defaultPair(r);
    main.appendChild(h('div', { class: 'view-head' }, h('h1', { text: 'Compare Instagram ↔ TikTok' }),
      h('span', { class: 'sub', text: 'The same video on both platforms, side by side' })));
    if (!pair.ig || !pair.tt) {
      main.appendChild(h('div', { class: 'empty' }, h('h2', { text: 'Needs one Instagram and one TikTok account' }),
        h('p', null, 'Collect your Instagram profile (Reels tab) and your TikTok profile (tiktok.com/@name, Auto-scroll), then come back.')));
      return;
    }
    function sel(list, cur, which) {
      var s = h('select', { 'aria-label': which === 'ig' ? 'Instagram account' : 'TikTok account', onchange: function () {
        go('#/compare/' + encodeURIComponent(which === 'ig' ? s.value : pair.ig) + '/' + encodeURIComponent(which === 'tt' ? s.value : pair.tt));
      } }, list.map(function (u) { return h('option', { value: u, selected: u === cur, text: handle(u) + ' (' + accounts[u].reels + ')' }); }));
      return s;
    }
    var res = CMP.match(accounts[pair.ig].enriched, accounts[pair.tt].enriched);
    var sm = res.summary;
    main.appendChild(h('div', { class: 'cmp-pick' },
      h('label', null, platformChip('instagram'), sel(pair.igs, pair.ig, 'ig')),
      h('span', { class: 'cmp-arrow', text: '⇄' }),
      h('label', null, platformChip('tiktok'), sel(pair.tts, pair.tt, 'tt'))));
    main.appendChild(h('p', { class: 'sub cmp-how', text: 'Matched by caption (Turkish letters, emoji and hashtags ignored), shared hashtags, video length (±1.5 s) and posting date (within ±' + CMP.MAX_DAYS + ' days). Different episode numbers ("Bug #12" vs "#13") never match. "× median" compares each video with its own account\'s median views, so the platform with the bigger audience doesn\'t win automatically. Engagement: TikTok counts likes + comments + shares + saves, Instagram likes + comments.' }));

    function tile(label, a, b, tip) {
      return h('div', { class: 'cmp-tile', title: tip || '' }, h('span', { class: 'cmp-tile-label', text: label }),
        b === undefined ? h('b', { text: a }) : h('div', { class: 'cmp-two' }, h('span', null, h('small', { text: 'IG ' }), h('b', { text: a })), h('span', null, h('small', { text: 'TT ' }), h('b', { text: b }))));
    }
    main.appendChild(h('div', { class: 'cmp-tiles' },
      tile('Matched videos', sm.matched + ' / ' + sm.videosA + ' IG · ' + sm.videosB + ' TT'),
      tile('TikTok ÷ Instagram views', times(sm.typicalViewsRatio), undefined, 'Typical ratio for the same video (geometric mean, so one viral hit doesn\'t dominate)'),
      tile('Median views', fmt(sm.medianViewsA), fmt(sm.medianViewsB)),
      tile('Median × own median', times(sm.medianRatioA), times(sm.medianRatioB)),
      tile('Median engagement', pct(sm.medianEngagementA), pct(sm.medianEngagementB)),
      tile('Did better (vs own median)', String(sm.winsA), String(sm.winsB)),
      tile('Hit on both (≥ 2×)', String(sm.hitsOnBoth))));

    var sortSel = h('select', { 'aria-label': 'Sort pairs', onchange: function () { cmpUi.sort = sortSel.value; render(); } },
      [['date', 'Newest'], ['tt', 'TikTok did best (TT ÷ IG views)'], ['ig', 'Instagram did best'], ['score', 'Match confidence']].map(function (o) { return h('option', { value: o[0], selected: cmpUi.sort === o[0], text: o[1] }); }));
    var pairs = res.pairs.slice();
    var vr = function (p) { return p.viewsRatio == null ? -Infinity : p.viewsRatio; };
    if (cmpUi.sort === 'tt') pairs.sort(function (a, b) { return vr(b) - vr(a); });
    else if (cmpUi.sort === 'ig') pairs.sort(function (a, b) { return (a.viewsRatio == null ? Infinity : a.viewsRatio) - (b.viewsRatio == null ? Infinity : b.viewsRatio); });
    else if (cmpUi.sort === 'score') pairs.sort(function (a, b) { return b.score - a.score; });
    main.appendChild(h('div', { class: 'cmp-bar' }, h('h2', { text: res.pairs.length + ' matched videos' }), h('label', null, 'Sort ', sortSel),
      h('button', { class: 'btn', type: 'button', onclick: function () { downloadFile('openoutlier-compare-' + handle(pair.ig).slice(1) + '-' + new Date().toISOString().slice(0, 10) + '.csv', '\ufeff' + compareCsv(res.pairs), 'text/csv;charset=utf-8'); } }, 'Download CSV')));

    function sideCell(x, tt) {
      return h('td', { class: 'cmp-side' },
        h('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer', class: 'cmp-views', text: fmt(x.views) }), h('span', { class: 'muted', text: ' views' }),
        h('div', { class: 'cmp-meta' },
          x.ratio >= M.OUTLIER_RATIO ? outlierBadge(x.ratio, times(x.ratio) + ' this account\'s median') : h('span', { class: 'cmp-x', text: times(x.ratio) + ' median' }),
          h('span', { text: pct(x.engagement) + ' eng.' }),
          tt && x.saves != null ? h('span', { text: fmt(x.saves) + ' saves' }) : null,
          x.shares != null ? h('span', { text: fmt(x.shares) + ' shares' }) : null),
        h('div', { class: 'muted small', text: shortDate(x.posted_at) + (x.duration ? ' · ' + Math.round(x.duration) + 's' : '') }));
    }
    var table = h('table', { class: 'cmp-table' },
      h('thead', null, h('tr', null, h('th', { text: 'Video' }), h('th', null, platformChip('instagram')), h('th', null, platformChip('tiktok')), h('th', { text: 'TT ÷ IG' }), h('th', { text: 'Match' }))),
      h('tbody', null, pairs.map(function (p) {
        return h('tr', null,
          h('td', { class: 'cmp-video' }, img(p.b.thumb || p.a.thumb, 'cmp-thumb'), h('span', { class: 'cmp-cap', text: (p.b.caption || p.a.caption).replace(/\s+/g, ' ').slice(0, 140) })),
          sideCell(p.a, false),
          sideCell(p.b, true),
          h('td', { class: 'cmp-ratio' }, h('b', { text: times(p.viewsRatio) }), p.winner ? h('div', { class: 'cmp-winner', text: (p.winner === 'a' ? 'Instagram' : 'TikTok') + ' did better', title: 'Relative to each account\'s own median' }) : null),
          h('td', { class: 'cmp-score', title: 'caption ' + Math.round((p.parts.text || 0) * 100) + '%, hashtags ' + (p.parts.tags == null ? '–' : Math.round(p.parts.tags * 100) + '%') + ', length ' + (p.parts.duration == null ? '–' : Math.round(p.parts.duration * 100) + '%') + ', date ' + (p.parts.date == null ? '–' : Math.round(p.parts.date * 100) + '%') },
            h('span', { class: 'cmp-conf cmp-' + p.confidence },
              h('span', { class: 'conf-px', 'aria-hidden': 'true' }, [0, 1, 2].map(function (i) { return h('i', { class: i < ({ high: 3, medium: 2, low: 1 }[p.confidence] || 1) ? 'on' : null }); })),
              p.confidence), h('div', { class: 'muted small', text: p.days == null ? '' : p.days + ' d apart' })));
      })));
    main.appendChild(res.pairs.length ? h('div', { class: 'cmp-wrap' }, table) : h('p', { class: 'empty', text: 'No video matched. Are these the same creator? Collect more videos on both sides (dates are needed: open the reels on Instagram so OpenOutlier can load them).' }));

    function onlyList(title, list) {
      if (!list.length) return null;
      return h('details', { class: 'cmp-only' }, h('summary', { text: title + ' (' + list.length + ')' }),
        h('ul', null, list.slice().sort(function (a, b) { return (b.posted_at || 0) - (a.posted_at || 0); }).map(function (x) {
          return h('li', null, h('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer', text: (x.caption || x.code).replace(/\s+/g, ' ').slice(0, 90) }), h('span', { class: 'muted', text: ' · ' + fmt(x.views) + ' views · ' + shortDate(x.posted_at) }));
        })));
    }
    main.appendChild(onlyList('Only on Instagram', res.onlyA));
    main.appendChild(onlyList('Only on TikTok', res.onlyB));
  }

  function compareCsv(pairs) {
    var cols = ['ig_url', 'tt_url', 'ig_posted', 'tt_posted', 'ig_views', 'tt_views', 'tt_div_ig_views', 'ig_x_median', 'tt_x_median', 'ig_engagement_pct', 'tt_engagement_pct', 'tt_shares', 'tt_saves', 'better_on', 'match_score', 'days_apart', 'caption'];
    function c(v) { if (v == null) return ''; var s = String(v); if (/^[=+\-@]/.test(s) && typeof v !== 'number') s = "'" + s; return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
    var r2 = function (n) { return n == null ? null : Math.round(n * 100) / 100; };
    return [cols.join(',')].concat(pairs.map(function (p) {
      return [p.a.url, p.b.url, p.a.posted_at ? new Date(p.a.posted_at).toISOString() : '', p.b.posted_at ? new Date(p.b.posted_at).toISOString() : '',
        p.a.views, p.b.views, r2(p.viewsRatio), r2(p.a.ratio), r2(p.b.ratio), r2(p.a.engagement), r2(p.b.engagement), p.b.shares, p.b.saves,
        p.winner === 'a' ? 'instagram' : p.winner === 'b' ? 'tiktok' : '', p.score, p.days, (p.b.caption || p.a.caption).replace(/\s+/g, ' ')].map(c).join(',');
    })).join('\r\n');
  }

  function render() {
    var r = route();
    renderSidebar(r);
    if (r.kind === 'account') renderAccount(r.id);
    else if (r.kind === 'mentions') mentionsView.render(main);
    else if (r.kind === 'compare') renderCompare(r);
    else renderScope(r);
    document.title = (r.kind === 'account' ? label(r.id) : r.kind === 'mentions' ? 'Mentions' : r.kind === 'compare' ? 'Compare' : scopeTitle(r)) + ' · OpenOutlier';
  }

  // ---- wiring ---------------------------------------------------------------
  document.getElementById('new-folder').addEventListener('click', function () {
    var f = newFolder();
    if (f) saveOrg().then(function () { go('#/folder/' + encodeURIComponent(f.id)); });
  });
  document.getElementById('search').addEventListener('input', function (e) {
    search = e.target.value.trim();
    if (route().kind === 'account' || route().kind === 'mentions' || route().kind === 'compare') go(lastScopeHash); else render();
  });
  document.getElementById('show-small').addEventListener('change', function (e) {
    showSmall = e.target.checked;
    try { localStorage.setItem('rs:showSmall', showSmall ? '1' : '0'); } catch (err) { /* ignore */ }
    render();
  });
  document.getElementById('backup').addEventListener('click', async function () {
    var all = await chrome.storage.local.get(null);
    var out = { app: 'reelscope', version: 1, exportedAt: new Date().toISOString(), data: {} };
    Object.keys(all).forEach(function (k) { if (k.indexOf('rs:') === 0) out.data[k] = all[k]; });
    // Never put the home-server token in a backup file.
    if (out.data['rs:mention-server']) out.data['rs:mention-server'] = Object.assign({}, out.data['rs:mention-server'], { token: '' });
    delete out.data['rs:mentions-state'];
    delete out.data['rs:bridge'];
    downloadFile('openoutlier-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(out), 'application/json');
  });
  document.getElementById('restore').addEventListener('change', async function (e) {
    var file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      var json = JSON.parse(await file.text());
      if (!json || json.app !== 'reelscope' || !json.data) throw new Error('Not an OpenOutlier backup');
      var current = await chrome.storage.local.get(null);
      var patch = {};
      var n = 0;
      Object.keys(json.data).forEach(function (k) {
        if (k.indexOf(KEY_PREFIX) === 0 && json.data[k] && json.data[k].posts) {
          var cur = current[k] && current[k].posts ? current[k].posts : {};
          patch[k] = { posts: Object.assign({}, json.data[k].posts, cur), updatedAt: Math.max((current[k] && current[k].updatedAt) || 0, json.data[k].updatedAt || 0) };
          n++;
        }
      });
      var inOrg = json.data[ORG_KEY];
      if (inOrg) {
        var merged = { folders: org.folders.slice(), accounts: Object.assign({}, inOrg.accounts || {}, org.accounts) };
        (inOrg.folders || []).forEach(function (f) { if (!merged.folders.some(function (x) { return x.id === f.id; })) merged.folders.push(f); });
        patch[ORG_KEY] = merged;
      }
      // Reddit watches (ours win on the same id) and mentions (dedupe by id).
      if (Array.isArray(json.data['rs:watches'])) {
        var mine = Array.isArray(current['rs:watches']) ? current['rs:watches'] : [];
        patch['rs:watches'] = mine.concat(json.data['rs:watches'].filter(function (w) { return w && !mine.some(function (x) { return x.id === w.id; }); }));
      }
      var inM = json.data['rs:mentions'];
      if (inM && inM.items) {
        var curM = current['rs:mentions'] || { items: {}, read: {} };
        var mergedM = self.ReelScopeMentions.mergeMentions(curM.items || {}, Object.values(inM.items));
        patch['rs:mentions'] = { items: mergedM.items, read: Object.assign({}, inM.read || {}, curM.read || {}) };
      }
      await chrome.storage.local.set(patch);
      alert('Restored ' + n + ' accounts.');
    } catch (err) {
      alert('Could not restore: ' + err.message);
    }
  });

  var reloadTimer = null;
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (!Object.keys(changes).some(function (k) { return k.indexOf('rs:') === 0; })) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(function () { load().then(render); }, 600);
  });
  window.addEventListener('hashchange', render);

  await load();
  render();
})();
