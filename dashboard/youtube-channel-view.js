// OpenOutlier Library – "My YouTube channel": your own channel through the
// YouTube Analytics API (optional). The Google sign-in and its tokens live on
// the Mac (mcp/youtube-analytics.mjs, through the local bridge); this page only
// asks the bridge, via the service worker (src/agent-bridge.js), for:
// channel totals, per-video retention (average view %), engaged views,
// thumbnail impressions + CTR, and one video's retention curve.
(function (root) {
  'use strict';

  function create(env) {
    var h = env.h;
    var fmt = env.fmt;
    var ui = { days: 28, loading: false, error: '', msg: '', open: null, waiting: false };
    var st = null;       // bridge status { configured, connected, channel, hint }
    var data = null;     // { channel, totals, videos, reach_error }
    var curves = {};     // video id -> { points, summary } | { error }
    var waitTimer = null;

    function call(path, extra) {
      return chrome.runtime.sendMessage(Object.assign({ type: 'reelscope:yt-analytics', path: path, method: /connect$|disconnect$/.test(path) ? 'POST' : 'GET' }, extra || {}))
        .then(function (r) { return r || { ok: false, error: 'No answer from the service worker.' }; }, function (e) { return { ok: false, error: e.message }; });
    }

    async function load() {
      st = await call('/youtube/analytics/status');
      if (!st.ok) { data = null; return; }
      if (st.connected && !data && !ui.loading) refresh();
    }

    async function refresh() {
      ui.loading = true;
      ui.error = '';
      env.rerender();
      var both = await Promise.all([call('/youtube/analytics/channel', { days: ui.days }), call('/youtube/analytics/videos', { days: ui.days, limit: 100 })]);
      ui.loading = false;
      var ch = both[0];
      var vids = both[1];
      if (!ch.ok && !vids.ok) { ui.error = errText(ch); data = null; }
      else {
        data = { channel: ch.ok ? ch.channel : (st && st.channel), totals: ch.ok ? ch.totals : null, videos: vids.ok ? vids.videos : [], reach_error: vids.ok ? vids.reach_error : null, at: Date.now() };
        if (!ch.ok) ui.error = errText(ch);
        else if (!vids.ok) ui.error = errText(vids);
      }
      env.rerender();
    }

    function errText(r) { return (r.error || 'Failed.') + (r.hint ? ' ' + r.hint : ''); }

    async function connect() {
      ui.msg = '';
      var r = await call('/youtube/analytics/connect');
      if (!r.ok || !r.url) { ui.msg = errText(r); env.rerender(); return; }
      window.open(r.url, '_blank', 'noopener');
      ui.waiting = true;
      ui.msg = 'Sign in with the Google account that owns the channel in the tab that just opened, and approve read-only access. This page updates when it\'s done.';
      env.rerender();
      var until = Date.now() + 15 * 60000;
      clearInterval(waitTimer);
      waitTimer = setInterval(async function () {
        var s = await call('/youtube/analytics/status');
        if ((s.ok && s.connected) || Date.now() > until) {
          clearInterval(waitTimer);
          ui.waiting = false;
          st = s;
          ui.msg = s.connected ? 'Connected.' : 'Still not connected. Try again.';
          if (s.connected) refresh(); else env.rerender();
        }
      }, 3000);
    }

    async function disconnect() {
      if (!confirm('Disconnect your YouTube channel? OpenOutlier deletes its Google sign-in from this Mac and asks Google to revoke it.')) return;
      await call('/youtube/analytics/disconnect');
      data = null;
      curves = {};
      st = await call('/youtube/analytics/status');
      ui.msg = 'Disconnected.';
      env.rerender();
    }

    async function toggleCurve(id) {
      if (ui.open === id) { ui.open = null; env.rerender(); return; }
      ui.open = id;
      env.rerender();
      if (!curves[id]) {
        var r = await call('/youtube/analytics/retention', { id: id });
        curves[id] = r.ok ? r : { error: errText(r) };
        env.rerender();
      }
    }

    // ---- pieces ----------------------------------------------------------------------
    function num(v) { return v === null || v === undefined ? '–' : fmt(v); }
    function pctText(v) { return v === null || v === undefined ? '–' : (Math.round(v * 10) / 10) + '%'; }
    function dur(s) { if (s == null) return '–'; s = Math.round(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

    function setupCard() {
      return h('section', { class: 'm-card' },
        h('h2', { text: 'Set up (optional)' }),
        h('p', { class: 'muted', text: 'Your own channel\'s analytics (retention, average view percentage, engaged views, thumbnail impressions and click-through rate) come from the YouTube Analytics API and need a Google OAuth client you create yourself. OpenOutlier keeps the sign-in on this Mac, read-only.' }),
        h('ol', { class: 'yc-steps' },
          h('li', { text: 'Google Cloud console: create a project, enable "YouTube Analytics API" and "YouTube Data API v3".' }),
          h('li', { text: 'OAuth consent screen: External, publishing status Testing, add your Google account as a test user.' }),
          h('li', { text: 'Credentials → Create credentials → OAuth client ID → Desktop app. Download the JSON.' }),
          h('li', { text: 'Save it as ~/.openoutlier/youtube-oauth.json (or set OPENOUTLIER_YOUTUBE_CLIENT_ID and OPENOUTLIER_YOUTUBE_CLIENT_SECRET for the bridge), then come back and press Connect.' })),
        h('p', { class: 'muted small', text: 'Details: README → "My YouTube channel".' }));
    }

    function connectCard() {
      return h('section', { class: 'm-card' },
        h('h2', { text: 'Connect your channel' }),
        h('p', { class: 'muted', text: 'Opens Google\'s sign-in. Approve read-only access (YouTube Analytics and your channel\'s video list); Google sends you back to the OpenOutlier bridge on this Mac, which keeps the sign-in. Nothing goes anywhere else.' }),
        h('div', { class: 'm-actions' }, h('button', { class: 'btn btn-primary', type: 'button', disabled: ui.waiting, onclick: connect }, ui.waiting ? 'Waiting for Google…' : 'Connect YouTube')),
        h('p', { class: 'm-msg', 'aria-live': 'polite', text: ui.msg }));
    }

    function tiles() {
      var t = data.totals || {};
      function tile(label, v, tip) { return h('div', { class: 's-tile', title: tip || null }, h('b', { text: v }), h('span', { text: label })); }
      return h('section', { class: 'm-card' },
        h('h2', { text: 'Last ' + ui.days + ' days' }),
        h('div', { class: 's-tiles' },
          tile('Views', num(t.views)),
          tile('Engaged views', num(t.engaged_views), 'Views past the first seconds (what YouTube counts for Shorts monetization since 2025)'),
          tile('Watch hours', t.watch_minutes == null ? '–' : fmt(Math.round(t.watch_minutes / 60))),
          tile('Avg. view', dur(t.avg_view_duration_s) + ' · ' + pctText(t.avg_view_pct), 'Average view duration and percentage of the video watched'),
          tile('Subscribers', (t.subscribers_gained == null ? '–' : '+' + fmt(t.subscribers_gained)) + ' / ' + (t.subscribers_lost == null ? '–' : '−' + fmt(t.subscribers_lost)))));
    }

    /** Retention curve: share of viewers still watching over the video (1.0 = everyone; above = rewatched). */
    function curveEl(c) {
      if (!c) return h('p', { class: 'muted', text: 'Loading…' });
      if (c.error) return h('p', { class: 'm-error', text: c.error });
      var pts = c.points || [];
      if (!pts.length) return h('p', { class: 'muted', text: 'YouTube has no retention data for this video yet (it needs some views).' });
      var W = 600;
      var H = 140;
      var top = Math.max(1, Math.max.apply(null, pts.map(function (p) { return p.watch_ratio; })));
      var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + (p.at * W).toFixed(1) + ' ' + (H - (p.watch_ratio / top) * H).toFixed(1); }).join(' ');
      var ns = 'http://www.w3.org/2000/svg';
      var svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.setAttribute('class', 'yc-curve');
      svg.setAttribute('role', 'img');
      var s = c.summary || {};
      svg.setAttribute('aria-label', 'Retention: ' + Math.round((s.at_25pct || 0) * 100) + '% still watching at a quarter, ' + Math.round((s.at_50pct || 0) * 100) + '% at half, ' + Math.round((s.end || 0) * 100) + '% at the end');
      [0.25, 0.5, 0.75].forEach(function (x) {
        var l = document.createElementNS(ns, 'line');
        l.setAttribute('x1', x * W); l.setAttribute('x2', x * W); l.setAttribute('y1', 0); l.setAttribute('y2', H);
        l.setAttribute('class', 'yc-grid');
        svg.appendChild(l);
      });
      var path = document.createElementNS(ns, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'yc-line');
      svg.appendChild(path);
      var p100 = function (v) { return v == null ? '–' : Math.round(v * 100) + '%'; };
      return h('div', { class: 'yc-curve-wrap' }, svg,
        h('p', { class: 'muted small', text: 'Still watching: ' + p100(s.at_25pct) + ' at 25 % · ' + p100(s.at_50pct) + ' at 50 % · ' + p100(s.at_75pct) + ' at 75 % · ' + p100(s.end) + ' at the end' +
          (s.steepest_drop ? '. Steepest drop at ' + Math.round(s.steepest_drop.at * 100) + ' % of the video' : '') + (s.rewatched_at ? '. Rewatched around ' + s.rewatched_at.slice(0, 3).map(function (x) { return Math.round(x * 100) + ' %'; }).join(', ') : '') + '.' }));
    }

    function videosCard() {
      var vids = data.videos || [];
      var cols = ['Video', 'Views', 'Engaged', 'Avg. view %', 'Avg. view', 'Impressions', 'CTR', 'Likes', 'Comments', 'Subs', ''];
      var rows = [];
      vids.forEach(function (v) {
        rows.push(h('tr', null,
          h('td', { class: 'yc-title' }, h('a', { href: 'https://www.youtube.com/' + (v.format === 'short' ? 'shorts/' : 'watch?v=') + v.id, target: '_blank', rel: 'noopener noreferrer', text: v.title || v.id }),
            v.format ? h('span', { class: 'muted small', text: ' · ' + (v.format === 'short' ? 'Short' : v.format === 'live' ? 'live' : 'video') }) : null),
          h('td', { class: 'num', text: num(v.views) }),
          h('td', { class: 'num', text: num(v.engaged_views) }),
          h('td', { class: 'num', text: pctText(v.avg_view_pct) }),
          h('td', { class: 'num', text: dur(v.avg_view_duration_s) }),
          h('td', { class: 'num', text: num(v.impressions) }),
          h('td', { class: 'num', text: pctText(v.ctr_pct) }),
          h('td', { class: 'num', text: num(v.likes) }),
          h('td', { class: 'num', text: num(v.comments) }),
          h('td', { class: 'num', text: v.subscribers_gained == null ? '–' : '+' + fmt(v.subscribers_gained) }),
          h('td', null, h('button', { class: 'btn btn-ghost', type: 'button', 'aria-expanded': ui.open === v.id ? 'true' : 'false', onclick: function () { toggleCurve(v.id); } }, 'Retention'))));
        if (ui.open === v.id) rows.push(h('tr', { class: 'yc-open' }, h('td', { colspan: String(cols.length) }, curveEl(curves[v.id]))));
      });
      return h('section', { class: 'm-card' },
        h('h2', { text: 'Videos (last ' + ui.days + ' days)' }),
        data.reach_error ? h('p', { class: 'm-warn', text: 'Thumbnail impressions and CTR are unavailable: ' + data.reach_error }) : null,
        vids.length ? h('div', { class: 'cmp-wrap' }, h('table', { class: 'cmp-table yc-table' },
          h('thead', null, h('tr', null, cols.map(function (c, i) { return h('th', { class: i && i < cols.length - 1 ? 'num' : null, text: c }); }))),
          h('tbody', null, rows)))
          : h('p', { class: 'muted', text: 'No views in this period.' }));
    }

    function render(main) {
      main.classList.remove('has-panel');
      main.textContent = '';
      var ch = (data && data.channel) || (st && st.channel);
      var daySel = h('select', { 'aria-label': 'Period', onchange: function () { ui.days = Number(daySel.value); refresh(); } },
        [[7, 'Last 7 days'], [28, 'Last 28 days'], [90, 'Last 90 days'], [365, 'Last 365 days']].map(function (o) { return h('option', { value: String(o[0]), selected: ui.days === o[0], text: o[1] }); }));
      var connected = st && st.ok && st.connected;
      main.appendChild(h('div', { class: 'view-head' },
        h('h1', { text: ch ? ch.title || ('@' + ch.handle) : 'My YouTube channel' }),
        h('span', { class: 'sub', text: !st ? 'Loading…' : !connected ? 'not connected' : ui.loading ? 'Loading…' : (ch && ch.subscribers != null ? fmt(ch.subscribers) + ' subscribers · ' : '') + 'YouTube Analytics' }),
        connected ? h('span', { class: 's-head-actions' }, daySel,
          h('button', { class: 'btn', type: 'button', disabled: ui.loading, onclick: refresh }, ui.loading ? 'Refreshing…' : 'Refresh'),
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: disconnect }, 'Disconnect')) : null));
      if (!st) { load().then(env.rerender); return; }
      if (!st.ok) { main.appendChild(h('p', { class: 'm-error', role: 'status', text: errText(st) })); return; }
      if (!st.configured) { main.appendChild(h('div', { class: 's-narrow' }, setupCard())); return; }
      if (!connected) { main.appendChild(h('div', { class: 's-narrow' }, connectCard())); return; }
      if (ui.error) main.appendChild(h('p', { class: 'm-error', role: 'status', text: ui.error }));
      if (ui.msg) main.appendChild(h('p', { class: 'm-msg', text: ui.msg }));
      if (!data) { if (!ui.loading && !ui.error) setTimeout(refresh, 0); return; }
      main.appendChild(h('div', { class: 'm-col' }, data.totals ? tiles() : null, videosCard()));
    }

    function title() { var ch = (data && data.channel) || (st && st.channel); return ch && ch.title ? ch.title + ' (YouTube)' : 'My YouTube channel'; }

    return { load: load, render: render, title: title, connected: function () { return !!(st && st.connected); } };
  }

  root.OpenOutlierYouTubeChannelView = { create: create };
})(typeof self !== 'undefined' ? self : this);
