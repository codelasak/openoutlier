// OpenOutlier Library – "My account": your own Instagram account through a
// self-hosted chatmany worker. Shows official insights for your posts (views,
// reach, watch time, skip rate), copies them into the library, and manages the
// comment → DM automations. All requests go from this page to the worker you
// entered, with your owner token; nothing else is contacted.
(function (root) {
  'use strict';
  var S = root.ReelScopeStudio;
  var SERVER_KEY = 'rs:studio';
  var KEY_PREFIX = 'rs:p:';
  var STATS_DAYS = 3650;

  function create(env) {
    var h = env.h;
    var fmt = env.fmt;
    var ago = env.ago;

    var server = {}; // { baseUrl, token }
    var data = null; // last snapshot from the worker
    var ui = { loading: false, error: '', msg: '', formMsg: '', connMsg: '', showArchived: false, editing: null, busy: false, postMsg: '', postFormMsg: '', progress: '', showPublished: false };
    var draft = null; // automation form values while it is open
    var base = null;  // the campaign being edited (fields the form does not show)
    var connDraft = null;
    var postDraft = null; // publishing form values while it is open (holds the chosen File objects)
    var pollTimer = null;

    async function load() {
      var r = await chrome.storage.local.get(SERVER_KEY);
      var next = r[SERVER_KEY] || {};
      if (next.baseUrl !== server.baseUrl || next.token !== server.token) data = null;
      server = next;
    }

    function linked() { return !!(server.baseUrl && server.token); }

    async function api(path, body) {
      var res;
      try {
        res = await fetch(server.baseUrl + path, {
          method: body ? 'POST' : 'GET',
          headers: Object.assign({ authorization: 'Bearer ' + server.token }, body ? { 'content-type': 'application/json' } : {}),
          body: body ? JSON.stringify(body) : undefined
        });
      } catch (e) {
        throw new Error('Could not reach ' + server.baseUrl + ' (' + e.message + ').');
      }
      var json = null;
      try { json = await res.json(); } catch (e) { /* not JSON */ }
      if (res.status === 401) throw new Error('The owner token was not accepted.');
      if (!res.ok) throw new Error((json && json.error) || 'The worker answered HTTP ' + res.status + '.');
      return json || {};
    }

    /** Send one file to the worker's storage; resolves to its key. */
    async function upload(blob, contentType) {
      var res;
      try {
        res = await fetch(server.baseUrl + '/api/uploads', { method: 'POST', headers: { authorization: 'Bearer ' + server.token, 'content-type': contentType }, body: blob });
      } catch (e) {
        throw new Error('The upload did not go through (' + e.message + ').');
      }
      var json = null;
      try { json = await res.json(); } catch (e) { /* not JSON */ }
      if (!res.ok || !json || !json.key) throw new Error((json && json.error) || 'The upload failed (HTTP ' + res.status + ').');
      return json.key;
    }

    /** Instagram only takes JPEG: redraw other images (and oversized JPEGs) as one, on white. */
    async function toJpeg(file) {
      var bmp = await createImageBitmap(file);
      var size = S.fitWithin(bmp.width, bmp.height, 2160);
      var canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.drawImage(bmp, 0, 0, size.width, size.height);
      var blob = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', 0.92); });
      if (!blob) throw new Error('Could not convert ' + file.name + ' to JPEG.');
      return blob;
    }

    async function uploadFile(file) {
      var info = S.fileInfo(file);
      if (info.type === 'image' && (info.convert || file.size > S.MAX_IMAGE_BYTES)) return upload(await toJpeg(file), 'image/jpeg');
      return upload(file, file.type);
    }

    async function loadPosts() {
      var r = await api('/api/posts');
      data.publish = { posts: r.posts || [], storage: r.storage !== false, limit: r.limit || null };
      watchPosts();
    }

    /** While something is going out (or about to), re-read the queue so its status moves. */
    function watchPosts() {
      if (pollTimer || !data || !data.publish) return;
      var soon = Date.now() / 1000 + 90;
      var active = data.publish.posts.some(function (p) { return p.status === 'working' || (p.status === 'scheduled' && p.scheduled_at <= soon); });
      if (!active) return;
      pollTimer = setTimeout(function () {
        pollTimer = null;
        if (!linked() || !data) return;
        loadPosts().then(env.rerender, function () { /* next refresh shows it */ });
      }, 15000);
    }

    /** A failed part must not blank the page: return what the call gave, or the error. */
    function part(promise) {
      return promise.then(function (v) { return { value: v }; }, function (e) { return { error: e.message }; });
    }

    async function loadCampaigns() {
      var lists = await Promise.all([api('/api/campaigns'), api('/api/campaigns?archived=1')]);
      data.campaigns = lists[0].campaigns || [];
      data.archived = lists[1].campaigns || [];
    }

    async function loadStats() {
      var stats = {};
      await Promise.all(data.campaigns.map(function (c) {
        return api('/api/dashboard?campaign_id=' + encodeURIComponent(c.campaign_id) + '&days=' + STATS_DAYS)
          .then(function (d) { stats[c.campaign_id] = d.cards; }, function () { /* row shows no numbers */ });
      }));
      data.stats = stats;
    }

    async function saveToLibrary() {
      var username = String(data.status.username || '').toLowerCase();
      if (!username || !data.rows.length) return;
      var key = KEY_PREFIX + username;
      var r = await chrome.storage.local.get(key);
      var rec = r[key] || {};
      var now = Date.now();
      var patch = {};
      patch[key] = Object.assign({}, rec, {
        posts: S.mergeIntoLibrary(rec.posts, data.rows, { username: username, pic: data.status.profile_picture_url }, now),
        updatedAt: now
      });
      await chrome.storage.local.set(patch);
    }

    async function refresh() {
      if (!linked() || ui.loading) return;
      ui.loading = true;
      ui.error = '';
      env.rerender();
      try {
        var status = await api('/api/status');
        var next = { status: status, rows: [], account: null, media: [], campaigns: [], archived: [], stats: {}, publish: null, notes: [], at: Date.now() };
        if (status.connected) {
          var got = await Promise.all([
            part(api('/api/media')),
            part(api('/api/insights')),
            part(api('/api/insights/account?days=7'))
          ]);
          next.media = (got[0].value && got[0].value.media) || [];
          var ins = got[1].value || {};
          next.rows = S.joinMedia(next.media, ins.media);
          next.account = got[2].value || null;
          if (got[0].error) next.notes.push('Posts: ' + got[0].error);
          if (got[1].error) next.notes.push('Insights: ' + got[1].error);
          if (ins.hint) next.notes.push(ins.hint);
          if (got[2].error) next.notes.push('Account totals: ' + got[2].error);
        }
        data = next;
        await loadCampaigns();
        await loadStats();
        // An older worker has no publishing endpoints: the section then says so instead of failing the page.
        await loadPosts().catch(function (e) { data.publish = { posts: [], storage: false, limit: null, error: e.message }; });
        if (status.connected) await saveToLibrary();
      } catch (e) {
        ui.error = e.message;
      }
      ui.loading = false;
      env.rerender();
    }

    /** Run a change on the worker, then re-read the automations. Resolves to whether it worked. */
    async function change(fn, done) {
      if (ui.busy) return false;
      ui.busy = true;
      ui.msg = '';
      var ok = true;
      try {
        await fn();
        await loadCampaigns();
        ui.msg = done || '';
      } catch (e) {
        ok = false;
        ui.msg = e.message;
      }
      ui.busy = false;
      env.rerender();
      return ok;
    }

    // ---- connection ------------------------------------------------------------
    function connectionCard() {
      if (!connDraft) connDraft = { baseUrl: server.baseUrl || '', token: server.token || '' };
      var url = h('input', { type: 'url', name: 'st-url', value: connDraft.baseUrl, placeholder: 'https://chatmany.you.workers.dev', 'aria-label': 'chatmany address' });
      url.addEventListener('input', function () { connDraft.baseUrl = url.value; });
      var token = h('input', { type: 'password', name: 'st-token', value: connDraft.token, placeholder: 'Owner token', autocomplete: 'off', 'aria-label': 'Owner token' });
      token.addEventListener('input', function () { connDraft.token = token.value; });

      function connect() {
        var res = S.normalizeServer(connDraft);
        if (res.error) { ui.connMsg = res.error; env.rerender(); return; }
        // Ask for this one host now, while we still have the click (Chrome requires a user gesture).
        chrome.permissions.request({ origins: [res.origin + '/*'] }).then(async function (granted) {
          if (!granted) { ui.connMsg = 'Chrome permission for ' + res.origin + ' was not granted, so the extension cannot reach it.'; env.rerender(); return; }
          var o = {};
          o[SERVER_KEY] = { baseUrl: res.baseUrl, token: res.token };
          ui.connMsg = '';
          connDraft = null;
          await chrome.storage.local.set(o);
          await load();
          refresh();
        }, function (e) { ui.connMsg = 'Permission request failed: ' + e.message; env.rerender(); });
      }

      return h('section', { class: 'm-card' },
        h('h2', { text: linked() ? 'Connection' : 'Connect your account' }),
        h('p', { class: 'muted', text: 'Your own Instagram account, through the official Instagram API. This needs a chatmany worker you host yourself: it holds the Instagram login, OpenOutlier only talks to that worker. The token stays in this browser and is left out of backups.' }),
        h('div', { class: 'm-form' },
          h('label', { class: 'm-field' }, h('span', { text: 'chatmany address' }), url),
          h('label', { class: 'm-field' }, h('span', { text: 'Owner token' }), token, h('small', { text: 'OWNER_TOKEN of the worker (your chatmany dashboard password).' })),
          h('div', { class: 'm-actions' },
            h('button', { class: 'btn btn-primary', type: 'button', onclick: connect }, linked() ? 'Save & reconnect' : 'Connect'),
            linked() ? h('button', { class: 'btn btn-ghost', type: 'button', title: 'Approve the Instagram login again, e.g. after the worker asks for a new permission', onclick: function () {
              // The same link chatmany's own panel uses; a page navigation cannot send a header.
              window.open(server.baseUrl + '/auth/authorize?token=' + encodeURIComponent(server.token), '_blank', 'noopener');
            } }, 'Reconnect Instagram ↗') : null,
            linked() ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: async function () {
              if (!confirm('Disconnect OpenOutlier from ' + server.baseUrl + '? Your automations keep running on the worker; posts already in the library stay.')) return;
              await chrome.storage.local.remove(SERVER_KEY);
              connDraft = null;
              ui.connMsg = 'Disconnected.';
            } }, 'Disconnect') : null)),
        h('p', { class: 'm-msg', 'aria-live': 'polite', text: ui.connMsg }));
    }

    // ---- account health and totals ---------------------------------------------
    function healthLines() {
      var st = data.status;
      var out = [];
      if (!st.connected) return out;
      if (st.token_expired) out.push(h('p', { class: 'm-error', role: 'status', text: 'The Instagram login expired. Reconnect Instagram in chatmany; automations are stopped until then.' }));
      else if (st.poll_healthy === false) {
        // chatmany reports { at, message }.
        var pe = st.comment_poll_error || st.poll_error;
        var why = pe && (pe.message || (typeof pe === 'string' ? pe : ''));
        out.push(h('p', { class: 'm-error', role: 'status', text: 'Automations are not running' + (why ? ': ' + why : ' (the worker has not checked for comments recently).') }));
      }
      else if (st.expires_in_days <= 7) out.push(h('p', { class: 'm-warn', text: 'The Instagram login expires in ' + st.expires_in_days + ' days. chatmany renews it on its own; reconnect there if this keeps counting down.' }));
      data.notes.forEach(function (t) { out.push(h('p', { class: 'm-warn', text: t })); });
      return out;
    }

    function tiles() {
      var t = (data.account && data.account.totals) || {};
      var days = (data.account && data.account.days) || 7;
      function tile(label, v, tip) {
        return h('div', { class: 's-tile', title: tip || null }, h('b', { text: v === null || v === undefined ? '–' : fmt(v) }), h('span', { text: label }));
      }
      return h('section', { class: 'm-card' },
        h('h2', { text: 'Last ' + days + ' days' }),
        h('div', { class: 's-tiles' },
          tile('Views', t.views),
          tile('Accounts reached', t.reach),
          tile('Accounts engaged', t.accounts_engaged, 'People who liked, commented, saved or shared'),
          tile('Interactions', t.total_interactions),
          tile('Profile link taps', t.profile_links_taps)));
    }

    // ---- posts ---------------------------------------------------------------------
    function automationOn(mediaId) {
      return data.campaigns.filter(function (c) { return c.media_id === mediaId; })[0] || null;
    }

    function postsCard() {
      var card = h('section', { class: 'm-card' },
        h('h2', { text: 'Posts (' + data.rows.length + ')' }),
        h('p', { class: 'muted', text: 'Official numbers from Instagram, also saved to the library under @' + data.status.username + '. Skip rate: viewers who swiped away in the first seconds.' }));
      if (!data.rows.length) {
        card.appendChild(h('p', { class: 'muted', text: 'No posts yet.' }));
        return card;
      }
      var cols = ['Posted', 'Post', 'Views', 'Reach', 'Avg watch', 'Skip rate', 'Likes', 'Comments', 'Saves', 'Shares', 'Automation'];
      card.appendChild(h('div', { class: 's-scroll' }, h('table', { class: 'cmp-table s-table' },
        h('thead', null, h('tr', null, cols.map(function (c, i) { return h('th', { class: i > 1 && i < 10 ? 'num' : null, text: c }); }))),
        h('tbody', null, data.rows.map(function (p) {
          var c = automationOn(p.id);
          function num(v) { return h('td', { class: 'num', text: v === null ? '–' : fmt(v) }); }
          return h('tr', null,
            h('td', { class: 's-date', title: p.takenAt ? new Date(p.takenAt).toLocaleString() : null, text: p.takenAt ? new Date(p.takenAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '–' }),
            h('td', { class: 's-cap' },
              p.permalink ? h('a', { href: p.permalink, target: '_blank', rel: 'noopener', text: p.caption.split('\n')[0] || '(no caption)' }) : (p.caption.split('\n')[0] || '(no caption)'),
              p.error ? h('small', { class: 'm-warn', text: 'No insights: ' + p.error }) : null),
            num(p.views), num(p.reach),
            h('td', { class: 'num', text: S.seconds(p.avgWatchMs) }),
            h('td', { class: 'num', text: S.percent(p.skipRate) }),
            num(p.likes), num(p.comments), num(p.saves), num(p.shares),
            h('td', null, c
              ? h('button', { class: 'chip s-chip' + (c.active ? '' : ' off'), type: 'button', title: 'Edit this automation' + (c.active ? '' : ' (paused)'), onclick: function () { edit(c); } }, (c.keywords || []).join(', '))
              : h('button', { class: 'btn btn-ghost s-add', type: 'button', onclick: function () { create_(p.id); } }, '+ Automation')));
        })))));
      return card;
    }

    // ---- automations -------------------------------------------------------------------
    function edit(c) {
      postDraft = null;
      draft = S.draftFromCampaign(c);
      base = c;
      ui.editing = c.campaign_id;
      ui.msg = '';
      env.rerender();
      window.scrollTo(0, 0);
    }
    function create_(mediaId) {
      postDraft = null;
      draft = S.defaultDraft(mediaId);
      if (!mediaId && data.media.length) draft.attach = 'post';
      base = null;
      ui.editing = 'new';
      ui.msg = '';
      env.rerender();
      window.scrollTo(0, 0);
    }
    function closeForm() { draft = null; base = null; ui.editing = null; }

    function whereText(c) {
      var a = S.attachment(c, data.media);
      if (a.state === 'waiting') return 'Waiting for a post whose caption starts “' + String(c.caption_match || '').slice(0, 50) + '”';
      if (a.state === 'attached') return 'On: ' + (String(a.media.caption || '').split('\n')[0].slice(0, 70) || 'a post without caption');
      return 'On an older post (not among the latest ' + data.media.length + ')';
    }

    function automationRow(c) {
      var toggle = h('input', { type: 'checkbox', checked: c.active, disabled: ui.busy, 'aria-label': (c.active ? 'Pause ' : 'Resume ') + (c.name || c.campaign_id) });
      toggle.addEventListener('change', function () {
        var on = toggle.checked;
        change(function () { return api('/api/campaigns/status', { campaign_id: c.campaign_id, active: on }); }, on ? 'Running.' : 'Paused.');
      });
      var steps = [c.check_follow ? (c.verify_follow ? 'follow check' : 'follow ask') : null, c.ask_email ? 'email' : null, c.public_reply && c.public_reply.enabled ? 'public reply' : null].filter(Boolean);
      return h('li', { class: c.active ? null : 'off' },
        toggle,
        h('div', { class: 'm-w-main' },
          h('b', { text: c.name || c.campaign_id }),
          h('span', { class: 'muted', text: [
            'Keyword: ' + (c.keywords || []).join(', ') + (c.match === 'exact' ? ' (exact)' : ''),
            steps.length ? steps.join(' + ') : null
          ].filter(Boolean).join(' · ') }),
          h('span', { class: 'muted', text: whereText(c) }),
          data.stats[c.campaign_id] ? h('span', { class: 's-funnel', text: S.funnelText(data.stats[c.campaign_id]) }) : null),
        h('div', { class: 'm-w-actions' },
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: function () { edit(c); } }, 'Edit'),
          h('button', { class: 'btn btn-ghost', type: 'button', disabled: ui.busy, title: 'Stop it and move it out of the way, without deleting', onclick: function () {
            change(function () { return api('/api/campaigns/archive', { campaign_id: c.campaign_id, archived: true }); }, 'Archived.');
          } }, 'Archive'),
          h('button', { class: 'btn btn-ghost btn-danger', type: 'button', disabled: ui.busy, onclick: function () {
            if (!confirm('Delete the automation "' + (c.name || c.campaign_id) + '"? This cannot be undone. Archive keeps it instead.')) return;
            if (ui.editing === c.campaign_id) closeForm();
            change(function () { return api('/api/campaigns/delete', { campaign_id: c.campaign_id }); }, 'Deleted.');
          } }, 'Delete')));
    }

    function archivedRow(c) {
      return h('li', { class: 'off' },
        h('div', { class: 'm-w-main' }, h('b', { text: c.name || c.campaign_id }), h('span', { class: 'muted', text: 'Keyword: ' + (c.keywords || []).join(', ') })),
        h('div', { class: 'm-w-actions s-flat' },
          h('button', { class: 'btn btn-ghost', type: 'button', disabled: ui.busy, onclick: function () {
            change(function () { return api('/api/campaigns/archive', { campaign_id: c.campaign_id, archived: false }); }, 'Restored.');
          } }, 'Restore'),
          h('button', { class: 'btn btn-ghost btn-danger', type: 'button', disabled: ui.busy, onclick: function () {
            if (!confirm('Delete the automation "' + (c.name || c.campaign_id) + '"? This cannot be undone.')) return;
            change(function () { return api('/api/campaigns/delete', { campaign_id: c.campaign_id }); }, 'Deleted.');
          } }, 'Delete')));
    }

    function automationsCard() {
      var running = data.campaigns.filter(function (c) { return c.active; }).length;
      var card = h('section', { class: 'm-card' },
        h('div', { class: 'm-inbox-head' },
          h('h2', { text: 'Automations (' + data.campaigns.length + ')' }),
          h('span', { class: 'sub', text: running + ' running' }),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { create_(''); } }, 'New automation')),
        h('p', { class: 'muted', text: 'Someone comments the keyword on your post, chatmany sends them the DM. Changes here apply on the worker right away.' }),
        h('p', { class: 'm-msg', 'aria-live': 'polite', text: ui.msg }));
      if (!data.campaigns.length) card.appendChild(h('p', { class: 'muted', text: 'No automations yet.' }));
      else card.appendChild(h('ul', { class: 'm-watches' }, data.campaigns.map(automationRow)));
      if (data.archived.length) {
        card.appendChild(h('button', { class: 'btn btn-ghost', type: 'button', 'aria-expanded': ui.showArchived ? 'true' : 'false', onclick: function () { ui.showArchived = !ui.showArchived; env.rerender(); } },
          (ui.showArchived ? 'Hide' : 'Show') + ' archived (' + data.archived.length + ')'));
        if (ui.showArchived) card.appendChild(h('ul', { class: 'm-watches' }, data.archived.map(archivedRow)));
      }
      return card;
    }

    // ---- automation form ---------------------------------------------------------------
    function text(label, key, hint, placeholder) {
      var input = h('input', { type: 'text', name: 'a-' + key, value: draft[key], placeholder: placeholder || null });
      input.addEventListener('input', function () { draft[key] = input.value; });
      return h('label', { class: 'm-field' }, h('span', { text: label }), input, hint ? h('small', { text: hint }) : null);
    }
    function area(label, key, hint, rows) {
      var input = h('textarea', { name: 'a-' + key, rows: rows || 3 });
      input.value = draft[key];
      input.addEventListener('input', function () { draft[key] = input.value; });
      return h('label', { class: 'm-field' }, h('span', { text: label }), input, hint ? h('small', { text: hint }) : null);
    }
    function check(label, key, rerender) {
      var cb = h('input', { type: 'checkbox', checked: draft[key], name: 'a-' + key });
      cb.addEventListener('change', function () { draft[key] = cb.checked; if (rerender) env.rerender(); });
      return h('label', { class: 'm-check' }, cb, label);
    }
    function select(label, key, options, rerender) {
      var sel = h('select', { name: 'a-' + key }, options.map(function (o) { return h('option', { value: o[0], text: o[1], selected: draft[key] === o[0] }); }));
      sel.addEventListener('change', function () { draft[key] = sel.value; if (rerender) env.rerender(); });
      return h('label', { class: 'm-field' }, h('span', { text: label }), sel);
    }

    function postOptions() {
      var taken = {};
      data.campaigns.concat(data.archived).forEach(function (c) { if (c.campaign_id !== draft.campaign_id) taken[c.media_id] = c.name || c.campaign_id; });
      var opts = [['', 'Choose a post…']];
      var known = false;
      data.media.forEach(function (m) {
        if (m.id === draft.media_id) known = true;
        var day = m.timestamp ? String(m.timestamp).slice(0, 10) : '';
        opts.push([m.id, day + ' · ' + (String(m.caption || '').split('\n')[0].slice(0, 60) || '(no caption)') + (taken[m.id] ? ' — used by ' + taken[m.id] : '')]);
      });
      if (draft.media_id && !known && !S.isPending(draft.media_id)) opts.push([draft.media_id, 'Current post (older, id ' + draft.media_id + ')']);
      return opts;
    }

    function formCard() {
      var isNew = ui.editing === 'new';
      var formMsg = h('p', { class: 'm-msg m-error', 'aria-live': 'polite', text: ui.formMsg || '' });
      async function save() {
        var res = S.campaignFromDraft(draft, base);
        if (res.error) { ui.formMsg = res.error; env.rerender(); return; }
        ui.formMsg = '';
        var name = res.campaign.name;
        var ok = await change(function () { return api('/api/campaigns', { campaign: res.campaign, active: res.active }); },
          (isNew ? 'Created “' : 'Saved “') + name + '”' + (res.active ? '.' : ' (paused).'));
        if (ok) closeForm(); else { ui.formMsg = ui.msg; ui.msg = ''; }
        env.rerender();
      }
      return h('section', { class: 'm-card s-form' },
        h('h2', { text: isNew ? 'New automation' : 'Edit automation' }),
        h('div', { class: 'm-form' },
          text('Name', 'name', null, 'Excel bug: IF formula'),
          select('Runs on', 'attach', [['post', 'A post that is already published'], ['caption', 'A post I have not published yet']], true),
          draft.attach === 'post'
            ? select('Post', 'media_id', postOptions())
            : area('Caption starts with', 'caption_match', 'Paste the first line of the caption. The automation attaches itself when a post with that caption goes live.', 2),
          text('Keywords', 'keywords', 'Comma-separated. Case does not matter.', 'PRACTICE'),
          select('Match', 'match', [['word', 'Keyword anywhere in the comment'], ['exact', 'The whole comment is the keyword']]),
          text('Never reply to comments containing', 'exclude', 'Optional, comma-separated.'),

          h('h3', { text: 'Messages' }),
          area('Opening DM', 'opening', null, 2),
          text('Button under the opening DM', 'opening_button'),
          select('What they receive', 'reward_type', [['link', 'A link'], ['code', 'A code'], ['text', 'Text']]),
          text('Link, code or text', 'reward_value', null, 'https://…'),
          area('Delivery message', 'delivery', '{reward} is replaced with the link, code or text above.', 2),

          h('h3', { text: 'Optional steps' }),
          check('Ask them to follow first', 'check_follow', true),
          draft.check_follow ? [
            check('Check that they really follow (instead of trusting the tap)', 'verify_follow', true),
            area('Follow message', 'follow_gate', isNew ? null : 'Empty = chatmany’s default wording.', 2),
            text('Follow button', 'follow_button'),
            draft.verify_follow ? area('Message when they still do not follow', 'follow_retry', 'Empty = the follow message again.', 2) : null
          ] : null,
          check('Ask for their email', 'ask_email', true),
          draft.ask_email ? area('Email question', 'email_ask', isNew ? null : 'Empty = chatmany’s default wording.', 2) : null,
          check('Reply publicly to the comment', 'reply_enabled', true),
          draft.reply_enabled ? area('Public replies', 'reply_texts', 'One per line; one is picked at random.', 3) : null,

          check('Running (turn off to save it paused)', 'active'),
          h('div', { class: 'm-actions' },
            h('button', { class: 'btn btn-primary', type: 'button', disabled: ui.busy, onclick: save }, ui.busy ? 'Saving…' : isNew ? 'Create automation' : 'Save automation'),
            h('button', { class: 'btn btn-ghost', type: 'button', onclick: function () { closeForm(); ui.formMsg = ''; env.rerender(); } }, 'Cancel'))),
        formMsg);
    }

    // ---- publishing -------------------------------------------------------------------
    function when(seconds) {
      return new Date(seconds * 1000).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    }

    function openPostForm(post) {
      draft = null; base = null; ui.editing = null;
      ui.postMsg = '';
      postDraft = post ? S.postDraftFromPost(post, Date.now()) : S.defaultPostDraft();
      ui.postFormMsg = '';
      ui.progress = '';
      env.rerender();
      window.scrollTo(0, 0);
    }

    /** Run a change to the queue, then re-read it. Resolves to whether it worked. */
    async function changePost(fn, done) {
      if (ui.busy) return false;
      ui.busy = true;
      ui.postMsg = '';
      var ok = true;
      try {
        await fn();
        await loadPosts();
        ui.postMsg = done || '';
      } catch (e) {
        ok = false;
        ui.postMsg = e.message;
      }
      ui.busy = false;
      env.rerender();
      return ok;
    }

    function campaignName(id) {
      var c = data.campaigns.concat(data.archived).filter(function (x) { return x.campaign_id === id; })[0];
      return c ? (c.name || c.campaign_id) : null;
    }

    function postRow(p) {
      var first = String(p.caption || '').split('\n')[0];
      var auto = p.options && p.options.campaign_id ? campaignName(p.options.campaign_id) : null;
      var line;
      if (p.status === 'working') line = 'Publishing now…';
      else if (p.status === 'scheduled') line = p.scheduled_at * 1000 <= Date.now() ? 'Going out within a minute' : when(p.scheduled_at) + ' · ' + ago(p.scheduled_at * 1000);
      else if (p.status === 'published') line = 'Published ' + when(p.published_at || p.scheduled_at);
      else line = 'Failed · was due ' + when(p.scheduled_at);
      var body = { id: p.id, kind: p.kind, caption: p.caption, media: p.media.map(function (m) { return { key: m.key }; }), options: p.options, scheduled_at: 0 };
      return h('li', { class: p.status === 'published' ? 'off' : null },
        h('span', { class: 'chip s-kind', text: S.postLabel(p) }),
        h('div', { class: 'm-w-main' },
          h('b', { text: first || (p.kind === 'story' ? 'Story' : '(no caption)') }),
          h('span', { class: p.status === 'failed' ? 'm-error' : 'muted', text: line }),
          auto ? h('span', { class: 'muted', text: 'Then attaches: ' + auto }) : null,
          p.error ? h('span', { class: p.status === 'failed' ? 'm-error' : 'm-warn', text: p.error }) : null),
        h('div', { class: 'm-w-actions s-flat' },
          p.permalink ? h('a', { class: 'btn btn-ghost', href: p.permalink, target: '_blank', rel: 'noopener', text: 'Open ↗' }) : null,
          p.status === 'scheduled' || p.status === 'failed' ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: function () { openPostForm(p); } }, p.status === 'failed' ? 'Edit & retry' : 'Edit') : null,
          p.status === 'scheduled' && p.scheduled_at * 1000 > Date.now() ? h('button', { class: 'btn btn-ghost', type: 'button', disabled: ui.busy, onclick: function () {
            if (!confirm('Publish this ' + S.postLabel(p).toLowerCase() + ' to Instagram now?')) return;
            changePost(function () { return api('/api/posts', body); }, 'Going out within a minute.');
          } }, 'Publish now') : null,
          p.status !== 'working' ? h('button', { class: 'btn btn-ghost' + (p.status === 'published' ? '' : ' btn-danger'), type: 'button', disabled: ui.busy, onclick: function () {
            if (p.status !== 'published' && !confirm('Remove this ' + S.postLabel(p).toLowerCase() + ' from the queue? It will not be published.')) return;
            if (postDraft && postDraft.id === p.id) postDraft = null;
            changePost(function () { return api('/api/posts/delete', { id: p.id }); }, p.status === 'published' ? '' : 'Removed.');
          } }, p.status === 'published' ? 'Hide' : 'Delete') : null));
    }

    function publishingCard() {
      var pub = data.publish || { posts: [], storage: false, limit: null };
      var queue = pub.posts.filter(function (p) { return p.status !== 'published'; });
      var done = pub.posts.filter(function (p) { return p.status === 'published'; });
      var card = h('section', { class: 'm-card' },
        h('div', { class: 'm-inbox-head' },
          h('h2', { text: 'Publishing' + (queue.length ? ' (' + queue.length + ')' : '') }),
          pub.limit ? h('span', { class: 'sub', title: 'Instagram allows this many posts through its API in any 24 hours', text: pub.limit.used + ' of ' + pub.limit.total + ' posts used today' }) : null,
          h('button', { class: 'btn btn-primary', type: 'button', disabled: !pub.storage, onclick: function () { openPostForm(null); } }, 'New post')),
        h('p', { class: 'muted', text: 'Reels, photo and carousel posts, and stories. Publish now or pick a time; the worker posts it for you, so Chrome can be closed.' }));
      if (pub.error) card.appendChild(h('p', { class: 'm-warn', text: 'This worker cannot publish yet: ' + pub.error }));
      else if (!pub.storage) card.appendChild(h('p', { class: 'm-warn', text: 'Publishing needs file storage on the worker: enable R2 on the Cloudflare account, create the bucket and deploy (see wrangler.toml).' }));
      card.appendChild(h('p', { class: 'm-msg', 'aria-live': 'polite', text: ui.postMsg }));
      if (queue.length) card.appendChild(h('ul', { class: 'm-watches' }, queue.map(postRow)));
      else if (pub.storage) card.appendChild(h('p', { class: 'muted', text: 'Nothing queued.' }));
      if (done.length) {
        card.appendChild(h('button', { class: 'btn btn-ghost', type: 'button', 'aria-expanded': ui.showPublished ? 'true' : 'false', onclick: function () { ui.showPublished = !ui.showPublished; env.rerender(); } },
          (ui.showPublished ? 'Hide' : 'Show') + ' published from here (' + done.length + ')'));
        if (ui.showPublished) card.appendChild(h('ul', { class: 'm-watches' }, done.map(postRow)));
      }
      return card;
    }

    function sizeText(bytes) { return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB'; }

    function postFormCard() {
      var d = postDraft;
      var isNew = !d.id;
      var multiple = d.kind === 'post';
      var accept = d.kind === 'reel' ? 'video/mp4,video/quicktime' : 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime';

      function pd(key, el, rerender) { return function () { d[key] = el.type === 'checkbox' ? el.checked : el.value; if (rerender) env.rerender(); }; }
      var kind = h('select', { name: 'p-kind' }, [['reel', 'Reel (one video)'], ['post', 'Post (a photo, or a carousel of photos and videos)'], ['story', 'Story (one photo or video, gone after 24 hours)']]
        .map(function (o) { return h('option', { value: o[0], text: o[1], selected: d.kind === o[0] }); }));
      kind.addEventListener('change', pd('kind', kind, true));

      var files = h('input', { type: 'file', name: 'p-files', accept: accept, multiple: multiple });
      files.addEventListener('change', function () { d.files = Array.prototype.slice.call(files.files); ui.postFormMsg = ''; env.rerender(); });
      var chosen = S.postItems(d);
      var fileList = chosen.length ? h('ol', { class: 's-files' }, chosen.map(function (i) {
        return h('li', { class: i.error ? 'm-error' : null, text: i.file ? i.file.name + ' · ' + sizeText(i.file.size) + (i.error ? ' · cannot be published' : '') : 'Already uploaded ' + i.type });
      })) : null;

      var cover = h('input', { type: 'file', name: 'p-cover', accept: 'image/jpeg,image/png,image/webp' });
      cover.addEventListener('change', function () { d.cover = cover.files[0] || null; env.rerender(); });

      var caption = h('textarea', { name: 'p-caption', rows: 6 });
      caption.value = d.caption;
      var counter = h('small', { text: d.caption.trim().length + ' / ' + S.MAX_CAPTION });
      caption.addEventListener('input', function () { d.caption = caption.value; counter.textContent = d.caption.trim().length + ' / ' + S.MAX_CAPTION; });

      var feed = h('input', { type: 'checkbox', name: 'p-feed', checked: d.share_to_feed });
      feed.addEventListener('change', pd('share_to_feed', feed));

      var auto = h('select', { name: 'p-auto' }, [h('option', { value: '', text: 'None', selected: !d.campaign_id })].concat(data.campaigns.map(function (c) {
        return h('option', { value: c.campaign_id, selected: d.campaign_id === c.campaign_id, text: (c.name || c.campaign_id) + (S.isPending(c.media_id) ? '' : ' (now on another post)') });
      })));
      auto.addEventListener('change', pd('campaign_id', auto));

      var whenSel = h('select', { name: 'p-when' }, [['now', 'Now'], ['later', 'At a set time']].map(function (o) { return h('option', { value: o[0], text: o[1], selected: d.when === o[0] }); }));
      whenSel.addEventListener('change', pd('when', whenSel, true));
      var at = h('input', { type: 'datetime-local', name: 'p-at', value: d.at, min: S.localInputValue(Date.now() / 1000) });
      at.addEventListener('input', pd('at', at));

      async function save() {
        var problem = S.postProblem(d, Date.now());
        if (problem) { ui.postFormMsg = problem; env.rerender(); return; }
        if (d.when === 'now' && !confirm('Publish this to Instagram now?')) return;
        ui.busy = true;
        ui.postFormMsg = '';
        try {
          var items = S.postItems(d);
          var keys = [];
          for (var i = 0; i < items.length; i++) {
            if (items[i].key) { keys.push(items[i].key); continue; }
            ui.progress = 'Uploading ' + (i + 1) + ' of ' + items.length + '…';
            env.rerender();
            keys.push(await uploadFile(items[i].file));
          }
          var coverKey = d.cover_key;
          if (d.kind === 'reel' && d.cover) {
            ui.progress = 'Uploading the cover…';
            env.rerender();
            coverKey = await uploadFile(d.cover);
          }
          // The files are on the worker now: keep their keys, so a retry does not upload them again.
          d.media = keys.map(function (k, n) { return { key: k, type: items[n].type }; });
          d.files = [];
          d.cover_key = coverKey;
          d.cover = null;
          ui.progress = 'Saving…';
          env.rerender();
          await api('/api/posts', S.postPayload(d, keys, coverKey));
          await loadPosts();
          ui.postMsg = d.when === 'now' ? 'Queued. It goes out within a minute.' : 'Scheduled for ' + when(Date.parse(d.at) / 1000) + '.';
          postDraft = null;
        } catch (e) {
          ui.postFormMsg = e.message;
        }
        ui.busy = false;
        ui.progress = '';
        env.rerender();
      }

      return h('section', { class: 'm-card s-form' },
        h('h2', { text: isNew ? 'New post' : 'Edit post' }),
        h('div', { class: 'm-form' },
          h('label', { class: 'm-field' }, h('span', { text: 'Type' }), kind),
          h('label', { class: 'm-field' }, h('span', { text: d.kind === 'reel' ? 'Video' : multiple ? 'Photos and videos' : 'Photo or video' }), files,
            h('small', { text: d.kind === 'reel' ? 'MP4 or MOV, up to 95 MB. Vertical 9:16 works best.'
              : d.kind === 'story' ? 'One file, 9:16. PNG and WebP are converted to JPEG.'
              : 'Up to 20, in the order chosen; all are cropped to the first one’s shape. PNG and WebP are converted to JPEG.' })),
          fileList,
          !isNew && !d.files.length ? h('small', { class: 'muted', text: 'Choose files only to replace the uploaded ones.' }) : null,
          d.kind === 'reel' ? h('label', { class: 'm-field' }, h('span', { text: 'Cover image (optional)' }), cover,
            h('small', { text: d.cover ? d.cover.name : d.cover_key ? 'A cover is already uploaded.' : 'Without one Instagram uses the first frame.' })) : null,
          d.kind !== 'story' ? h('label', { class: 'm-field' }, h('span', { text: 'Caption' }), caption, counter) : null,
          d.kind === 'reel' ? h('label', { class: 'm-check' }, feed, 'Also show it in the profile grid') : null,
          d.kind !== 'story' ? h('label', { class: 'm-field' }, h('span', { text: 'Attach an automation' }), auto,
            h('small', { text: 'Once it is published, that automation runs on this post.' })) : null,
          h('label', { class: 'm-field' }, h('span', { text: 'Publish' }), whenSel),
          d.when === 'later' ? h('label', { class: 'm-field' }, h('span', { text: 'Date and time' }), at, h('small', { text: 'Your local time. The worker publishes within a minute of it.' })) : null,
          h('div', { class: 'm-actions' },
            h('button', { class: 'btn btn-primary', type: 'button', disabled: ui.busy, onclick: save }, ui.busy ? (ui.progress || 'Working…') : d.when === 'later' ? 'Schedule' : 'Publish now'),
            h('button', { class: 'btn btn-ghost', type: 'button', disabled: ui.busy, onclick: function () { postDraft = null; ui.postFormMsg = ''; env.rerender(); } }, 'Cancel'))),
        h('p', { class: 'm-msg m-error', 'aria-live': 'polite', text: ui.postFormMsg }));
    }

    // ---- page --------------------------------------------------------------------------
    function render(main) {
      var active = document.activeElement;
      var focusName = active && main.contains(active) ? active.getAttribute('name') : null;
      var caret = null;
      try { caret = focusName && active.selectionStart != null ? active.selectionStart : null; } catch (e) { /* checkbox, select */ }
      main.classList.remove('has-panel');
      main.textContent = '';

      var st = data && data.status;
      var title = st && st.username ? '@' + st.username : 'My account';
      main.appendChild(h('div', { class: 'view-head' },
        h('h1', { text: title }),
        h('span', { class: 'sub', text: !linked() ? 'not connected' : ui.loading ? 'Loading…' : data ? 'Updated ' + ago(data.at) : '' }),
        linked() ? h('span', { class: 's-head-actions' },
          h('button', { class: 'btn btn-ghost', type: 'button', title: 'Contacts and everything else live there', onclick: function () { window.open(server.baseUrl, '_blank', 'noopener'); } }, 'Open chatmany ↗'),
          h('button', { class: 'btn', type: 'button', disabled: ui.loading, onclick: refresh }, ui.loading ? 'Refreshing…' : 'Refresh')) : null));

      if (!linked()) {
        main.appendChild(h('div', { class: 's-narrow' }, connectionCard()));
      } else if (!data) {
        if (ui.error) main.appendChild(h('p', { class: 'm-error', role: 'status', text: ui.error }));
        main.appendChild(h('div', { class: 's-narrow' }, connectionCard()));
        if (!ui.loading && !ui.error) setTimeout(refresh, 0);
      } else {
        var status = h('div', { class: 'm-status' });
        if (ui.error) status.appendChild(h('p', { class: 'm-error', role: 'status', text: ui.error }));
        if (!st.connected) status.appendChild(h('p', { class: 'm-error', role: 'status', text: 'chatmany has no Instagram account connected. Open chatmany and choose Connect Instagram; automations are stopped until then.' }));
        healthLines().forEach(function (el) { status.appendChild(el); });
        if (status.childNodes.length) main.appendChild(status);
        // The form sits beside the lists while it is open; otherwise the tables get the full width.
        var lists = h('div', { class: 'm-col' }, st.connected ? tiles() : null, st.connected ? publishingCard() : null, st.connected ? postsCard() : null, automationsCard(), h('div', { class: 's-narrow' }, connectionCard()));
        var form = postDraft ? postFormCard() : draft ? formCard() : null;
        main.appendChild(form ? h('div', { class: 'm-grid s-grid' }, lists, h('div', { class: 'm-col m-side' }, form)) : lists);
      }

      if (focusName) {
        var again = main.querySelector('[name="' + focusName + '"]');
        if (again) { again.focus(); if (caret !== null && again.setSelectionRange) try { again.setSelectionRange(caret, caret); } catch (e) { /* not a text field */ } }
      }
    }

    function title() { return data && data.status && data.status.username ? '@' + data.status.username : 'My account'; }

    return { load: load, render: render, title: title, linked: linked };
  }

  root.ReelScopeStudioView = { create: create };
})(typeof self !== 'undefined' ? self : this);
