// OpenOutlier Library – the Reddit "Mentions" page: watch list editor, inbox and
// the optional link to the reddit-watch home server. The checking itself runs
// in the service worker (src/mentions-bg.js); this page only edits storage.
(function (root) {
  'use strict';
  var MN = root.ReelScopeMentions;
  var WATCHES_KEY = 'rs:watches';
  var MENTIONS_KEY = 'rs:mentions';
  var STATE_KEY = 'rs:mentions-state';
  var SERVER_KEY = 'rs:mention-server';
  var PAGE = 100;

  function create(env) {
    var h = env.h;
    var ago = env.ago;
    var data = { watches: [], store: { items: {}, read: {} }, state: {}, server: {} };
    var ui = { watchId: '', unreadOnly: false, shown: PAGE, editing: null, msg: '', serverMsg: '' };
    // Form drafts survive re-renders (the page re-renders whenever storage changes).
    var draft = { query: '', subreddits: '', exclude: '', posts: true, comments: true };
    var serverDraft = null;

    async function load() {
      var r = await chrome.storage.local.get([WATCHES_KEY, MENTIONS_KEY, STATE_KEY, SERVER_KEY]);
      var st = r[MENTIONS_KEY] || {};
      data = {
        watches: Array.isArray(r[WATCHES_KEY]) ? r[WATCHES_KEY] : [],
        store: { items: st.items || {}, read: st.read || {} },
        state: r[STATE_KEY] || {},
        server: r[SERVER_KEY] || {}
      };
    }

    function unread() {
      return Object.keys(data.store.items).filter(function (id) { return !data.store.read[id]; }).length;
    }

    function saveWatches(list) {
      var o = {};
      o[WATCHES_KEY] = list;
      return chrome.storage.local.set(o);
    }

    async function setRead(ids, value) {
      var r = await chrome.storage.local.get(MENTIONS_KEY);
      var s = r[MENTIONS_KEY] || { items: {}, read: {} };
      s.read = s.read || {};
      ids.forEach(function (id) { if (value) s.read[id] = 1; else delete s.read[id]; });
      var o = {};
      o[MENTIONS_KEY] = s;
      await chrome.storage.local.set(o);
    }

    function when(ts) { return ts ? ago(ts) : 'never'; }

    // ---- watch editor --------------------------------------------------------
    function field(label, key, placeholder, hint) {
      var input = h('input', { type: 'text', name: 'w-' + key, value: draft[key], placeholder: placeholder, 'aria-label': label });
      input.addEventListener('input', function () { draft[key] = input.value; });
      return h('label', { class: 'm-field' }, h('span', { text: label }), input, hint ? h('small', { text: hint }) : null);
    }

    function watchForm() {
      var msg = h('p', { class: 'm-msg', 'aria-live': 'polite', text: ui.msg });
      function kind(key, label) {
        var cb = h('input', { type: 'checkbox', checked: draft[key], name: 'w-' + key });
        cb.addEventListener('change', function () { draft[key] = cb.checked; });
        return h('label', { class: 'm-check' }, cb, label);
      }
      var save = h('button', { class: 'btn btn-primary', type: 'button', onclick: function () {
        var kinds = [draft.posts ? 'posts' : null, draft.comments ? 'comments' : null].filter(Boolean);
        var base = ui.editing ? data.watches.filter(function (w) { return w.id === ui.editing; })[0] || {} : {};
        var res = MN.normalizeWatch(Object.assign({}, base, { query: draft.query, subreddits: draft.subreddits, exclude: draft.exclude, kinds: kinds.length ? kinds : ['posts'], enabled: base.enabled !== false }));
        if (res.error) { ui.msg = res.error; env.rerender(); return; }
        var list = data.watches.filter(function (w) { return w.id !== res.watch.id; });
        if (ui.editing) list = data.watches.map(function (w) { return w.id === res.watch.id ? res.watch : w; });
        else list.push(res.watch);
        ui.msg = (ui.editing ? 'Saved. ' : 'Added. ') + 'First check in a few seconds.' +
          (res.watch.kinds.indexOf('comments') !== -1 && !res.watch.subreddits.length ? ' Comments need a subreddit list, so only posts are checked for this one.' : '');
        ui.editing = null;
        draft = { query: '', subreddits: '', exclude: '', posts: true, comments: true };
        saveWatches(list);
      } }, ui.editing ? 'Save watch' : 'Add watch');
      return h('section', { class: 'm-card' },
        h('h2', { text: ui.editing ? 'Edit watch' : 'New watch' }),
        h('div', { class: 'm-form' },
          field('Keywords or phrase', 'query', '"excel formula" vlookup', 'All words must appear. "Quotes" = exact phrase, formula* = prefix. Case and accents don\'t matter (İ/ı = i).'),
          field('Only in subreddits (optional)', 'subreddits', 'excel, spreadsheets', 'Comma-separated. Empty = all of Reddit (posts only).'),
          field('Exclude (optional)', 'exclude', 'google sheets, hiring', 'Skip items that contain any of these.'),
          h('div', { class: 'm-kinds' }, kind('posts', 'Posts'), kind('comments', 'Comments (needs subreddits)')),
          h('div', { class: 'm-actions' }, save,
            ui.editing ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: function () {
              ui.editing = null; draft = { query: '', subreddits: '', exclude: '', posts: true, comments: true }; ui.msg = ''; env.rerender();
            } }, 'Cancel') : null)),
        msg);
    }

    function watchList() {
      var counts = {};
      Object.keys(data.store.items).forEach(function (id) {
        var m = data.store.items[id];
        var c = counts[m.watchId] || (counts[m.watchId] = { all: 0, unread: 0 });
        c.all++;
        if (!data.store.read[id]) c.unread++;
      });
      if (!data.watches.length) {
        return h('section', { class: 'm-card' }, h('h2', { text: 'Watches' }),
          h('p', { class: 'muted', text: 'No watches yet. Add one above, e.g. "excel formula" in r/excel, or your brand name everywhere.' }));
      }
      return h('section', { class: 'm-card' }, h('h2', { text: 'Watches (' + data.watches.length + ')' }),
        h('ul', { class: 'm-watches' }, data.watches.map(function (w) {
          var c = counts[w.id] || { all: 0, unread: 0 };
          var toggle = h('input', { type: 'checkbox', checked: w.enabled !== false, 'aria-label': 'Enable ' + w.query });
          toggle.addEventListener('change', function () {
            saveWatches(data.watches.map(function (x) { return x.id === w.id ? Object.assign({}, x, { enabled: toggle.checked }) : x; }));
          });
          return h('li', { class: w.enabled === false ? 'off' : null },
            toggle,
            h('div', { class: 'm-w-main' },
              h('b', { text: w.query }),
              h('span', { class: 'muted', text: [
                w.subreddits && w.subreddits.length ? 'r/' + w.subreddits.join(', r/') : 'all of Reddit',
                (w.kinds || MN.KINDS).join(' + '),
                w.exclude && w.exclude.length ? 'not: ' + w.exclude.join(', ') : null
              ].filter(Boolean).join(' · ') })),
            h('div', { class: 'm-w-actions' },
            h('button', { class: 'btn btn-ghost m-count', type: 'button', title: 'Show its mentions', onclick: function () { ui.watchId = w.id; ui.shown = PAGE; env.rerender(); } },
              c.all + ' found' + (c.unread ? ' · ' + c.unread + ' new' : '')),
            h('button', { class: 'btn btn-ghost', type: 'button', onclick: function () {
              ui.editing = w.id;
              draft = { query: w.query, subreddits: (w.subreddits || []).join(', '), exclude: (w.exclude || []).join(', '),
                posts: (w.kinds || MN.KINDS).indexOf('posts') !== -1, comments: (w.kinds || MN.KINDS).indexOf('comments') !== -1 };
              ui.msg = '';
              env.rerender();
              window.scrollTo(0, 0);
            } }, 'Edit'),
            h('button', { class: 'btn btn-ghost btn-danger', type: 'button', onclick: function () {
              if (!confirm('Delete the watch "' + w.query + '"? Mentions it already found stay in the inbox.')) return;
              saveWatches(data.watches.filter(function (x) { return x.id !== w.id; }));
            } }, 'Delete')));
        })));
    }

    // ---- status -----------------------------------------------------------------
    function statusLine() {
      var st = data.state;
      var parts = [];
      if (st.running) parts.push('Checking now…');
      else parts.push('Last check ' + when(st.lastRunAt) + (st.lastNew ? ' (' + st.lastNew + ' new)' : ''));
      parts.push('runs every 15 min while Chrome is open');
      parts.push('Reddit RSS feeds, about one a minute' + (st.via === 'tab' ? ', via your reddit.com tab' : ''));
      var q = (st.rssQueue || []).length;
      if (q) parts.push(q + ' feed' + (q === 1 ? '' : 's') + ' queued' + (st.rssNextAt && st.rssNextAt > Date.now() ? ', next in ' + Math.ceil((st.rssNextAt - Date.now()) / 1000) + ' s' : ''));
      var el = h('div', { class: 'm-status' }, h('span', { text: parts.join(' · ') }));
      if (st.tabProblem) el.appendChild(h('p', { class: 'm-warn', text: st.tabProblem }));
      if (st.lastError) {
        el.appendChild(h('p', { class: 'm-error', role: 'status', text: 'Reddit: ' + st.lastError + (st.backoffUntil && st.backoffUntil > Date.now() ? ' Next try ' + ago(st.backoffUntil) + '.' : '') }));
      }
      (st.warnings || []).forEach(function (w) { el.appendChild(h('p', { class: 'm-warn', text: w })); });
      var srv = st.server || {};
      if (data.server.enabled) {
        el.appendChild(h('p', { class: srv.lastError && (!srv.lastOkAt || srv.lastFailAt > srv.lastOkAt) ? 'm-error' : 'muted' },
          srv.lastError && (!srv.lastOkAt || srv.lastFailAt > srv.lastOkAt)
            ? 'Home server unreachable: ' + srv.lastError.replace(/^\S+ /, '') + '. The extension keeps checking on its own.'
            : 'Home server connected' + (srv.version ? ' (reddit-watch ' + srv.version + ')' : '') + ', last sync ' + when(srv.lastOkAt) + '.'));
      }
      return el;
    }

    // ---- inbox ----------------------------------------------------------------------
    function inbox() {
      var byId = {};
      data.watches.forEach(function (w) { byId[w.id] = w; });
      var list = MN.list(data.store, { watchId: ui.watchId || null, unreadOnly: ui.unreadOnly });
      var sel = h('select', { 'aria-label': 'Filter by watch', onchange: function () { ui.watchId = sel.value; ui.shown = PAGE; env.rerender(); } },
        h('option', { value: '', text: 'All watches', selected: !ui.watchId }),
        data.watches.map(function (w) { return h('option', { value: w.id, text: w.query, selected: ui.watchId === w.id }); }));
      var unreadCb = h('input', { type: 'checkbox', checked: ui.unreadOnly });
      unreadCb.addEventListener('change', function () { ui.unreadOnly = unreadCb.checked; ui.shown = PAGE; env.rerender(); });
      var unreadIds = list.filter(function (m) { return !data.store.read[m.id]; }).map(function (m) { return m.id; });
      var head = h('div', { class: 'm-inbox-head' },
        h('h2', { text: 'Inbox' }),
        sel,
        h('label', { class: 'm-check' }, unreadCb, 'Unread only'),
        h('button', { class: 'btn btn-ghost', type: 'button', disabled: !unreadIds.length, onclick: function () { setRead(unreadIds, true); } }, 'Mark ' + (unreadIds.length || '') + ' read'));
      var wrap = h('section', { class: 'm-card' }, head);
      if (!list.length) {
        wrap.appendChild(h('p', { class: 'muted', text: Object.keys(data.store.items).length ? 'Nothing matches this filter.' : 'No mentions yet. New posts and comments that match a watch show up here.' }));
        return wrap;
      }
      wrap.appendChild(h('ol', { class: 'm-list' }, list.slice(0, ui.shown).map(function (m) {
        var isRead = !!data.store.read[m.id];
        var w = byId[m.watchId];
        var link = MN.safePermalink(m.permalink); // https://…reddit.com only
        function open() {
          if (link) window.open(link, '_blank', 'noopener');
          if (!isRead) setRead([m.id], true);
        }
        return h('li', { class: 'm-item' + (isRead ? '' : ' unread') },
          h('div', { class: 'm-meta' },
            h('span', { class: 'm-kind', text: m.kind === 'comment' ? 'Comment' : 'Post' }),
            h('span', { text: 'r/' + (m.subreddit || '?') }),
            m.author ? h('span', { text: 'u/' + m.author }) : null,
            h('span', { title: m.createdAt ? new Date(m.createdAt).toLocaleString() : '', text: m.createdAt ? ago(m.createdAt) : '' }),
            m.score != null ? h('span', { text: m.score + ' pts' }) : null,
            h('span', { class: 'm-query', title: w ? 'Watch' : 'This watch was deleted', text: 'Watch: ' + (m.query || '') + (w ? '' : ' (deleted)') }),
            m.source === 'hayati' ? h('span', { class: 'm-source', title: 'Found by the reddit-watch home server', text: 'home server' }) : null),
          h('button', { class: 'm-title', type: 'button', onclick: open }, (m.kind === 'comment' ? 'Comment on: ' : '') + (m.title || '(no title)')),
          m.excerpt ? h('p', { class: 'm-excerpt', text: m.excerpt }) : null,
          h('div', { class: 'm-item-actions' },
            h('button', { class: 'btn', type: 'button', onclick: open, disabled: !link, title: link ? null : 'No valid reddit.com link' }, 'Open thread ↗'),
            h('button', { class: 'btn btn-ghost', type: 'button', onclick: function () { setRead([m.id], !isRead); } }, isRead ? 'Mark unread' : 'Mark read')));
      })));
      if (list.length > ui.shown) {
        wrap.appendChild(h('button', { class: 'btn btn-ghost', type: 'button', onclick: function () { ui.shown += PAGE; env.rerender(); } }, 'Show more (' + (list.length - ui.shown) + ')'));
      }
      return wrap;
    }

    // ---- server link ----------------------------------------------------------------
    function serverCard() {
      if (!serverDraft) serverDraft = { baseUrl: data.server.baseUrl || '', token: data.server.token || '' };
      var url = h('input', { type: 'url', name: 's-url', value: serverDraft.baseUrl, placeholder: 'http://100.x.y.z:8787', 'aria-label': 'Server address' });
      url.addEventListener('input', function () { serverDraft.baseUrl = url.value; });
      var token = h('input', { type: 'password', name: 's-token', value: serverDraft.token, placeholder: 'API token', autocomplete: 'off', 'aria-label': 'API token' });
      token.addEventListener('input', function () { serverDraft.token = token.value; });
      var msg = h('p', { class: 'm-msg', 'aria-live': 'polite', text: ui.serverMsg });

      function connect() {
        var origin;
        try { origin = new URL(serverDraft.baseUrl.trim()).origin; } catch (e) { origin = null; }
        if (!origin || !/^https?:/.test(origin)) { ui.serverMsg = 'Enter the server address, e.g. http://100.101.102.103:8787 or https://watch.example.com'; env.rerender(); return; }
        if (!serverDraft.token.trim()) { ui.serverMsg = 'Enter the API token (API_TOKEN in the server\'s .env).'; env.rerender(); return; }
        // Ask for this one host now, while we still have the click (Chrome requires a user gesture).
        chrome.permissions.request({ origins: [origin + '/*'] }).then(async function (granted) {
          if (!granted) { ui.serverMsg = 'Chrome permission for ' + origin + ' was not granted, so the extension cannot reach the server.'; env.rerender(); return; }
          var o = {};
          o[SERVER_KEY] = { enabled: true, baseUrl: serverDraft.baseUrl.trim().replace(/\/+$/, ''), token: serverDraft.token.trim() };
          await chrome.storage.local.set(o);
          ui.serverMsg = 'Connecting…';
          env.rerender();
          var r = await chrome.runtime.sendMessage({ type: 'reelscope:mentions-server-sync' });
          await load();
          var srv = data.state.server || {};
          ui.serverMsg = srv.lastError && srv.lastFailAt >= (srv.lastOkAt || 0)
            ? 'Could not connect: ' + srv.lastError.replace(/^\S+ /, '')
            : 'Connected. Watches pushed to the server' + (r && r.added ? ', ' + r.added + ' mentions pulled.' : '.');
          env.rerender();
        }, function (e) { ui.serverMsg = 'Permission request failed: ' + e.message; env.rerender(); });
      }

      return h('section', { class: 'm-card' },
        h('h2', { text: 'Home server (optional)' }),
        h('p', { class: 'muted', text: 'Link the reddit-watch service on your home server so watching continues 24/7 when Chrome is closed. OpenOutlier sends it your watch list and pulls its matches into this inbox. The extension keeps working on its own if the server is down. Off by default.' }),
        h('div', { class: 'm-form' },
          h('label', { class: 'm-field' }, h('span', { text: 'Server address' }), url, h('small', { text: 'Tailscale IP or tunnel host, e.g. http://100.101.102.103:8787' })),
          h('label', { class: 'm-field' }, h('span', { text: 'API token' }), token),
          h('div', { class: 'm-actions' },
            h('button', { class: 'btn btn-primary', type: 'button', onclick: connect }, data.server.enabled ? 'Save & reconnect' : 'Connect'),
            data.server.enabled ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: async function () {
              var o = {};
              o[SERVER_KEY] = Object.assign({}, data.server, { enabled: false });
              await chrome.storage.local.set(o);
              ui.serverMsg = 'Disconnected. The extension keeps checking on its own.';
            } }, 'Disconnect') : null)),
        msg);
    }

    // ---- page ------------------------------------------------------------------------
    function render(main) {
      var active = document.activeElement;
      var focusName = active && main.contains(active) ? active.getAttribute('name') : null;
      var caret = focusName && active.selectionStart != null ? active.selectionStart : null;
      main.classList.remove('has-panel');
      main.textContent = '';
      var n = unread();
      main.appendChild(h('div', { class: 'view-head' },
        h('h1', { text: 'Mentions' }),
        h('span', { class: 'sub', text: Object.keys(data.store.items).length + ' found · ' + n + ' new' }),
        h('button', { class: 'btn', type: 'button', style: 'margin-left:auto', disabled: !!data.state.running || !data.watches.length, onclick: function (e) {
          e.target.disabled = true;
          chrome.runtime.sendMessage({ type: 'reelscope:mentions-check' });
        } }, data.state.running ? 'Checking…' : 'Check now')));
      main.appendChild(statusLine());
      main.appendChild(h('div', { class: 'm-grid' },
        h('div', { class: 'm-col' }, inbox()),
        h('div', { class: 'm-col m-side' }, watchForm(), watchList(), serverCard())));
      if (focusName) {
        var again = main.querySelector('[name="' + focusName + '"]');
        if (again) { again.focus(); if (caret !== null && again.setSelectionRange) try { again.setSelectionRange(caret, caret); } catch (e) { /* not a text field */ } }
      }
    }

    return { load: load, render: render, unread: unread };
  }

  root.ReelScopeMentionsView = { create: create };
})(typeof self !== 'undefined' ? self : this);
