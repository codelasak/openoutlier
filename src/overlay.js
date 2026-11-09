// ReelScope – toolbar + stats card shown on top of the reel/post you're viewing
// (instagram.com/reel/…, /reels/…, /p/…). It lives in its own Shadow DOM host
// and is positioned over the video with position:fixed, so it never touches
// Instagram's own markup.
(function (root) {
  'use strict';
  var M = root.ReelScopeMetrics;
  var nf = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
  var nfFull = new Intl.NumberFormat();
  var df = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  var OPEN_KEY = 'reelscope:card-open';

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
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }

  function icon(d) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '2');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
    return svg;
  }
  var I_LOGO = 'M4 20V10M10 20V4M16 20v-7M21 21l-3.2-3.2M18.5 15.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0z';
  var I_DOWN = 'M12 4v11M7 10l5 5 5-5M5 20h14';
  var I_IMAGE = 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5a1 1 0 1 0 0-.01';

  function fmt(n) { return n === null || n === undefined ? '–' : nf.format(n); }
  function dur(s) {
    if (!(s > 0)) return '–';
    s = Math.round(s);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function readOpen() { try { return localStorage.getItem(OPEN_KEY) !== '0'; } catch (e) { return true; } }
  function writeOpen(v) { try { localStorage.setItem(OPEN_KEY, v ? '1' : '0'); } catch (e) { /* ignore */ } }

  /** The <video> (or big image) that is most visible right now. */
  function findMedia() {
    var best = null;
    var bestArea = 0;
    function consider(el, minW) {
      var r = el.getBoundingClientRect();
      if (r.width < minW || r.height < 120) return;
      var w = Math.min(r.right, window.innerWidth) - Math.max(r.left, 0);
      var hgt = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
      var area = Math.max(0, w) * Math.max(0, hgt);
      if (area > bestArea) { bestArea = area; best = r; }
    }
    var vids = document.querySelectorAll('video');
    for (var i = 0; i < vids.length; i++) consider(vids[i], 140);
    if (!best) {
      var scope = document.querySelector('div[role="dialog"] article') || document.querySelector('main article') || document.querySelector('main');
      if (scope) {
        var imgs = scope.querySelectorAll('img');
        for (var j = 0; j < imgs.length; j++) consider(imgs[j], 240);
      }
    }
    return best && bestArea > 20000 ? best : null;
  }

  function create(opts) {
    var host = document.createElement('div');
    host.id = 'reelscope-overlay';
    host.style.setProperty('all', 'initial');
    var shadow = host.attachShadow({ mode: 'open' });
    try {
      var sheet = new CSSStyleSheet();
      sheet.replaceSync(opts.cssText || '');
      shadow.adoptedStyleSheets = [sheet];
    } catch (e) {
      shadow.appendChild(h('style', { text: opts.cssText || '' }));
    }

    var code = null;
    var open = readOpen();
    var timer = null;
    var status = '';

    var statsBtn = h('button', { class: 'ov-btn ov-logo', type: 'button', title: 'ReelScope stats', 'aria-label': 'Show ReelScope stats', onclick: function () { open = !open; writeOpen(open); render(); } }, icon(I_LOGO));
    var dlBtn = h('button', { class: 'ov-btn', type: 'button', title: 'Download video', 'aria-label': 'Download video', onclick: function () { download('media'); } }, icon(I_DOWN));
    var coverBtn = h('button', { class: 'ov-btn', type: 'button', title: 'Download cover image', 'aria-label': 'Download cover image', onclick: function () { download('cover'); } }, icon(I_IMAGE));
    var bar = h('div', { class: 'ov-bar' }, dlBtn, statsBtn, coverBtn);
    var card = h('div', { class: 'ov-card' });
    var wrap = h('div', { class: 'ov-wrap', hidden: true }, bar, card);
    shadow.appendChild(wrap);

    function download(what) {
      var p = code && opts.getPost(code);
      if (!p) { status = 'Still loading this post…'; render(); return; }
      var has = what === 'cover' ? !!p.thumb : (p.files || []).length > 0;
      if (!has) { status = 'No file link yet. Wait a second and try again.'; render(); return; }
      status = 'Starting download…';
      render();
      opts.onDownloadMedia([p], what).then(function (r) {
        status = r && r.queued ? 'Saved to Downloads/ReelScope/' + (p.owner || '') : 'Download failed. Reload the page and try again.';
        render();
        setTimeout(function () { status = ''; render(); }, 3500);
      }, function () { status = 'Download failed.'; render(); });
    }

    function stat(label, value, tip) {
      return h('div', { class: 'ov-stat', title: tip || null }, h('span', { class: 'ov-stat-label', text: label }), h('span', { class: 'ov-stat-value', text: value }));
    }

    function render() {
      var p = code && opts.getPost(code);
      dlBtn.title = p && p.files && p.files.length > 1 ? 'Download all ' + p.files.length + ' files' : (p && p.type !== 'reel' && p.type !== 'video' ? 'Download photo' : 'Download video');
      statsBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
      card.hidden = !open;
      if (!open) return;
      card.textContent = '';
      if (!p) {
        card.appendChild(h('p', { class: 'ov-muted', text: opts.isLoading(code) ? 'Loading stats…' : 'Loading stats… (scroll a little if this stays empty)' }));
        if (status) card.appendChild(h('p', { class: 'ov-status', text: status }));
        return;
      }
      var eng = p.views > 0 ? (((p.likes || 0) + (p.comments || 0)) / p.views) * 100 : null;
      card.appendChild(h('div', { class: 'ov-head' },
        h('span', { class: 'ov-owner', text: p.owner ? '@' + p.owner : '' }),
        h('span', { class: 'ov-muted', text: p.takenAt ? df.format(new Date(p.takenAt)) : '' })));
      card.appendChild(h('div', { class: 'ov-grid' },
        stat('Views', fmt(p.views), p.views != null ? nfFull.format(p.views) : null),
        stat('Likes', fmt(p.likes), p.likes != null ? nfFull.format(p.likes) : null),
        stat('Comments', fmt(p.comments), p.comments != null ? nfFull.format(p.comments) : null),
        stat('Shares', fmt(p.shares), p.shares != null ? nfFull.format(p.shares) : 'Instagram only shares this for some posts'),
        stat('Duration', dur(p.duration)),
        stat('Engagement', eng === null ? '–' : eng.toFixed(2) + '%', '(likes + comments) ÷ views')));

      // Compare with the creator's other posts we know about.
      var others = opts.getProfilePosts(p.owner).filter(function (x) { return x.views > 0 && (x.type === 'reel' || x.type === 'video'); });
      if (others.length >= 5 && p.views > 0) {
        var med = M.median(others.map(function (x) { return x.views; }));
        var ratio = p.views / med;
        card.appendChild(h('p', { class: 'ov-compare' + (ratio >= M.OUTLIER_RATIO ? ' is-outlier' : '') },
          ratio.toFixed(1) + '× @' + p.owner + '\'s median · Viral Score ' + M.viralScore(p.views, med)));
      }
      var audio = p.audio ? (p.audio.kind === 'music' ? '♪ ' + p.audio.title + (p.audio.artist ? ' · ' + p.audio.artist : '') : '♪ Original audio') : '';
      if (audio) card.appendChild(h('p', { class: 'ov-muted ov-audio', text: audio }));
      if (opts.isLoading(code)) card.appendChild(h('p', { class: 'ov-muted', text: 'Loading more details…' }));
      if (status) card.appendChild(h('p', { class: 'ov-status', text: status }));
      card.appendChild(h('button', { class: 'ov-link', type: 'button', onclick: opts.onOpenPanel }, 'Open ReelScope panel'));
    }

    function position() {
      if (!code) { wrap.hidden = true; return; }
      var r = findMedia();
      if (!r) { wrap.hidden = true; return; }
      wrap.hidden = false;
      var width = Math.min(300, Math.max(220, r.width - 24));
      wrap.style.setProperty('width', width + 'px');
      wrap.style.setProperty('left', Math.round(r.left + r.width / 2 - width / 2) + 'px');
      wrap.style.setProperty('top', Math.round(Math.max(8, r.top + 10)) + 'px');
    }

    return {
      host: host,
      setCode: function (c) {
        code = c;
        status = '';
        clearInterval(timer);
        if (code) timer = setInterval(position, 300);
        position();
        render();
      },
      refresh: function () { if (code) { render(); position(); } }
    };
  }

  root.ReelScopeOverlay = { create: create };
})(typeof self !== 'undefined' ? self : this);
