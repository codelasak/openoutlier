// ReelScope Library – full-page view of every saved account (Instagram
// profiles, subreddits and Reddit users side by side), with folders, tags,
// per-account analytics and a cross-account "Top posts" ranking.
// Reads the same chrome.storage.local data the content scripts write.
// Account ids: "name" = Instagram, "r/excel" / "u/name" = Reddit.
(async function () {
  'use strict';
  var M = self.ReelScopeMetrics;
  var P = self.ReelScopePanel;
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
  function label(id) { return isRedditId(id) ? id : '@' + id; }
  function platformOf(id) { return isRedditId(id) ? 'reddit' : 'instagram'; }
  /** Posts that count for an account: reels/videos on Instagram, every post on Reddit. */
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
    if (kind === 'folder' || kind === 'tag') return { kind: kind, id: parts[1], tab: parts[2] === 'reels' ? 'reels' : 'accounts' };
    if (kind === 'unsorted') return { kind: 'unsorted', tab: parts[1] === 'reels' ? 'reels' : 'accounts' };
    if (kind === 'platform') return { kind: 'platform', id: parts[1] === 'reddit' ? 'reddit' : 'instagram', tab: parts[2] === 'reels' ? 'reels' : 'accounts' };
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
      var q = search.toLowerCase().replace(/^@/, '').replace(/^\/?(r|u)\//, '');
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
    if (r.kind === 'platform') return r.id === 'reddit' ? 'Reddit' : 'Instagram';
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
        return { code: p.code, owner: p.owner, views: p.views, likes: p.likes, comments: p.comments, files: p.files, cover: p.thumb };
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

  // ---- sidebar --------------------------------------------------------------
  function navItem(label, count, hash, current, extra) {
    var b = h('button', { class: 'nav-item', type: 'button', 'aria-current': current ? 'true' : 'false', onclick: function () { go(hash); } },
      h('span', { class: 'label', text: label }), h('span', { class: 'count', text: count == null ? '' : String(count) }));
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
    lib.appendChild(navItem('🔔 Mentions', unreadMentions ? unreadMentions + ' new' : null, '#/mentions', r.kind === 'mentions'));
    lib.appendChild(navItem('All accounts', all.length, '#/all', r.kind === 'all'));
    lib.appendChild(navItem('Unsorted', all.filter(function (u) { return !folderOf(u); }).length, '#/unsorted', r.kind === 'unsorted', { dropFolder: null }));
    var nReddit = all.filter(isRedditId).length;
    if (nReddit) {
      lib.appendChild(navItem('Instagram', all.length - nReddit, '#/platform/instagram', r.kind === 'platform' && r.id === 'instagram'));
      lib.appendChild(navItem('Reddit', nReddit, '#/platform/reddit', r.kind === 'platform' && r.id === 'reddit'));
    }

    var nf_ = document.getElementById('nav-folders');
    nf_.textContent = '';
    if (!org.folders.length) nf_.appendChild(h('p', { class: 'nav-empty', text: 'No folders yet. Use + to add one.' }));
    org.folders.forEach(function (f) {
      var count = Object.keys(accounts).filter(function (u) { return folderOf(u) === f.id; }).length;
      var current = (r.kind === 'folder' && r.id === f.id) || (r.kind === 'account' && folderOf(r.id) === f.id);
      nf_.appendChild(h('div', { class: 'nav-row' },
        navItem('📁 ' + f.name, count, '#/folder/' + encodeURIComponent(f.id), current, { dropFolder: f.id }),
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
      nt.appendChild(navItem('#' + t.tag, t.count, '#/tag/' + encodeURIComponent(t.tag), r.kind === 'tag' && r.id === t.tag));
    });
    document.getElementById('show-small').checked = showSmall;
  }

  // ---- main views -----------------------------------------------------------
  var main = document.getElementById('main');

  function accountCard(a) {
    var u = a.username;
    var reddit = a.platform === 'reddit';
    var card = h('div', { class: 'card' + (reddit ? ' card-reddit' : ''), role: 'button', tabindex: '0', draggable: 'true', 'aria-label': label(u),
      onclick: function () { go('#/account/' + encodeURIComponent(u)); },
      onkeydown: function (e) { if (e.key === 'Enter') go('#/account/' + encodeURIComponent(u)); },
      ondragstart: function (e) { e.dataTransfer.setData('text/reelscope-account', u); card.classList.add('dragging'); },
      ondragend: function () { card.classList.remove('dragging'); } },
      h('div', { class: 'card-head' },
        reddit ? h('div', { class: 'avatar thumb-empty avatar-reddit', text: u.charAt(0) }) : img(a.pic, 'avatar', u.charAt(0).toUpperCase()),
        h('div', { class: 'card-name' }, h('b', { text: label(u) }), h('span', { text: (reddit ? 'Reddit · ' : (a.name ? a.name + ' · ' : '')) + 'updated ' + ago(a.updatedAt) }))),
      reddit
        ? h('ol', { class: 'top-titles' }, a.top.map(function (p) { return h('li', null, h('b', { text: fmt(p.score) }), ' ', p.title || ''); }))
        : h('div', { class: 'covers' }, [0, 1, 2].map(function (i) { return a.top[i] ? img(a.top[i].thumb, 'cover') : h('div', { class: 'thumb-empty' }); })),
      h('div', { class: 'card-stats' },
        h('div', null, h('b', { text: nfFull.format(a.reels) }), h('span', { text: reddit ? 'posts' : 'reels' })),
        h('div', null, h('b', { text: fmt(a.medianViews) }), h('span', { text: reddit ? 'median score' : 'median views' })),
        h('div', null, h('b', { text: nfFull.format(a.outliers) }), h('span', { text: 'outliers' }))),
      h('div', { class: 'chips' },
        folderOf(u) ? h('span', { class: 'chip folder', text: '📁 ' + folderName(folderOf(u)) }) : null,
        tagsOf(u).map(function (t) { return h('span', { class: 'chip', text: '#' + t }); })));
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
    var reelCount = list.reduce(function (s, u) { return s + (isRedditId(u) ? 0 : accounts[u].reels); }, 0);
    var redditCount = list.reduce(function (s, u) { return s + (isRedditId(u) ? accounts[u].reels : 0); }, 0);
    main.appendChild(h('div', { class: 'view-head' },
      h('h1', { text: scopeTitle(r) }),
      h('span', { class: 'sub', text: list.length + ' account' + (list.length === 1 ? '' : 's') +
        (reelCount || !redditCount ? ' · ' + nfFull.format(reelCount) + ' reels' : '') + (redditCount ? ' · ' + nfFull.format(redditCount) + ' Reddit posts' : '') }),
      seg));

    if (!Object.keys(accounts).length) {
      main.appendChild(h('div', { class: 'empty' },
        h('h2', { text: 'No saved accounts yet' }),
        h('p', null, 'Open a profile\'s Reels tab on instagram.com, or a subreddit on reddit.com (e.g. r/excel/top), and scroll or press Auto-scroll / Collect top posts in the ReelScope panel. Every account you collect is saved here automatically.')));
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
      main.appendChild(h('p', { class: 'sub', style: 'margin:-6px 0 12px', text: 'Every reel and Reddit post in this view, scored against its own account\'s median (views on Instagram, score on Reddit), so small and big accounts compare fairly.' }));
      main.appendChild(h('div', { class: 'panel-slot' }, reelsPanel.host));
      reelsPanel.update({ posts: posts, selected: scopeTitle(r).replace(/[^\w.-]+/g, '-'), profiles: [], platform: null });
      return;
    }
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

    main.appendChild(h('button', { class: 'btn btn-ghost back', type: 'button', onclick: function () { go(lastScopeHash); } }, '← ' + 'Back'));
    main.appendChild(h('div', { class: 'acct-head' },
      a.platform === 'reddit' ? h('div', { class: 'avatar big thumb-empty avatar-reddit', text: u.charAt(0) }) : img(a.pic, 'avatar big', u.charAt(0).toUpperCase()),
      h('div', { class: 'acct-title' },
        h('h1', { text: label(u) }),
        h('p', { text: (a.platform === 'reddit' ? 'Reddit · ' : (a.name ? a.name + ' · ' : '')) + nfFull.format(a.count) + ' posts saved · updated ' + ago(a.updatedAt) }),
        h('p', null, a.platform === 'reddit'
          ? h('a', { href: 'https://www.reddit.com/' + (u.charAt(0) === 'u' ? 'user/' + encodeURIComponent(u.slice(2)) + '/submitted/' : 'r/' + encodeURIComponent(u.slice(2)) + '/top/?t=year'), target: '_blank', rel: 'noopener', text: 'Open on Reddit to refresh ↗' })
          : h('a', { href: 'https://www.instagram.com/' + encodeURIComponent(u) + '/reels/', target: '_blank', rel: 'noopener', text: 'Open on Instagram to refresh ↗' }))),
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

  function render() {
    var r = route();
    renderSidebar(r);
    if (r.kind === 'account') renderAccount(r.id);
    else if (r.kind === 'mentions') mentionsView.render(main);
    else renderScope(r);
    document.title = (r.kind === 'account' ? label(r.id) : r.kind === 'mentions' ? 'Mentions' : scopeTitle(r)) + ' · ReelScope';
  }

  // ---- wiring ---------------------------------------------------------------
  document.getElementById('new-folder').addEventListener('click', function () {
    var f = newFolder();
    if (f) saveOrg().then(function () { go('#/folder/' + encodeURIComponent(f.id)); });
  });
  document.getElementById('search').addEventListener('input', function (e) {
    search = e.target.value.trim();
    if (route().kind === 'account' || route().kind === 'mentions') go(lastScopeHash); else render();
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
    downloadFile('reelscope-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(out), 'application/json');
  });
  document.getElementById('restore').addEventListener('change', async function (e) {
    var file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      var json = JSON.parse(await file.text());
      if (!json || json.app !== 'reelscope' || !json.data) throw new Error('Not a ReelScope backup');
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
