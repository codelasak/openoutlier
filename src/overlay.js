// OpenOutlier – toolbar + stats card shown on top of the reel/post you're viewing
// (instagram.com/reel/…, /reels/…, /p/…; tiktok.com/@user/video/…; youtube.com/watch, /shorts/…).
// It lives in its own Shadow DOM host
// and is positioned over the video with position:fixed, so it never touches
// Instagram's own markup.
(function (root) {
  'use strict';
  var M = root.ReelScopeMetrics;
  var nf = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
  var nfFull = new Intl.NumberFormat();
  var df = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  var OPEN_KEY = 'reelscope:card-open';

  // The toolbar and card in the page's UI language (YouTube passes opts.lang; Instagram and TikTok stay English).
  var STR = {
    en: {
      views: 'Views', likes: 'Likes', comments: 'Comments', shares: 'Shares', saves: 'Saves', duration: 'Duration', engagement: 'Engagement', chapters: 'Chapters',
      loadsWith: 'Loads with the video', about: 'About ', noChapters: 'No chapters', approxDate: 'Approximate: YouTube showed a relative date',
      engTip: '(likes + comments) ÷ views', engTipTT: '(likes + comments + shares + saves) ÷ views', sharesTip: 'Instagram only shares this for some posts',
      medianOf: 'Median of {n} {what} views collected from this channel: {m}', fmtMedian: '{h}\'s {what} median · Viral Score {s}', igMedian: '{h}\'s median · Viral Score {s}',
      shortsW: 'Shorts', longW: 'long-form',
      collect: 'Collect this channel\'s {tab} tab to compare with its median ({n} of 5 {what} so far).', tabShorts: 'Shorts', tabVideos: 'Videos', whatShorts: 'Shorts', whatLong: 'long-form videos',
      replayed: 'Most replayed at ', and: ' and ', noPeak: 'Most replayed: no clear peak', jump: 'Jump to {t}',
      openPanel: 'Open the OpenOutlier panel', loading: 'Loading stats…', loadingScroll: 'Loading stats… (scroll a little if this stays empty)', loadingMore: 'Loading more details…',
      stats: 'Show OpenOutlier stats', statsTitle: 'OpenOutlier stats', more: 'More tools', dlVideo: 'Download video', dlPhoto: 'Download photo', dlAll: 'Download all {n} files', dlCover: 'Download cover image',
      stillLoading: 'Still loading this post…', noFile: 'No file link yet. Wait a second and try again.', starting: 'Starting download…', savedTo: 'Saved to Downloads/OpenOutlier/{d}',
      dlFailed: 'Download failed. Reload the page and try again.', dlFailedShort: 'Download failed.', original: 'Original audio'
    },
    tr: {
      views: 'İzlenme', likes: 'Beğeni', comments: 'Yorum', shares: 'Paylaşım', saves: 'Kaydetme', duration: 'Süre', engagement: 'Etkileşim', chapters: 'Bölümler',
      loadsWith: 'Videoyla birlikte yüklenir', about: 'Yaklaşık ', noChapters: 'Bölüm yok', approxDate: 'Yaklaşık: YouTube göreli bir tarih gösterdi',
      engTip: '(beğeni + yorum) ÷ izlenme', engTipTT: '(beğeni + yorum + paylaşım + kaydetme) ÷ izlenme', sharesTip: 'Instagram bunu sadece bazı gönderilerde veriyor',
      medianOf: 'Bu kanaldan toplanan {n} {what} videonun medyan izlenmesi: {m}', fmtMedian: '{h} {what} medyanı · Viral Skor {s}', igMedian: '{h} medyanı · Viral Skor {s}',
      shortsW: 'Shorts', longW: 'uzun',
      collect: 'Medyanla karşılaştırmak için kanalın {tab} sekmesini topla (şimdilik {n} / 5 {what}).', tabShorts: 'Shorts', tabVideos: 'Videolar', whatShorts: 'Shorts', whatLong: 'uzun video',
      replayed: 'En çok tekrar izlenen an: ', and: ' ve ', noPeak: 'En çok tekrar izlenen: belirgin bir an yok', jump: '{t} anına git',
      openPanel: 'OpenOutlier panelini aç', loading: 'İstatistikler yükleniyor…', loadingScroll: 'İstatistikler yükleniyor… (boş kalırsa biraz kaydır)', loadingMore: 'Ayrıntılar yükleniyor…',
      stats: 'OpenOutlier istatistiklerini göster', statsTitle: 'OpenOutlier istatistikleri', more: 'Diğer araçlar', dlVideo: 'Videoyu indir', dlPhoto: 'Fotoğrafı indir', dlAll: '{n} dosyanın hepsini indir', dlCover: 'Kapak görselini indir',
      stillLoading: 'Gönderi hâlâ yükleniyor…', noFile: 'Henüz dosya linki yok. Bir saniye bekleyip tekrar dene.', starting: 'İndirme başlıyor…', savedTo: 'İndirilenler/OpenOutlier/{d} içine kaydedildi',
      dlFailed: 'İndirme başarısız. Sayfayı yenileyip tekrar dene.', dlFailedShort: 'İndirme başarısız.', original: 'Orijinal ses'
    }
  };
  function fillS(s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o[k] != null ? o[k] : m; }); }

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
  function brandLogo(name, cls) {
    var B = root.OpenOutlierBrand;
    return B ? B.logo(name, cls) : h('span', { class: cls, text: 'O' });
  }
  var I_DOWN = 'M12 4v11M7 10l5 5 5-5M5 20h14';
  var I_IMAGE = 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5a1 1 0 1 0 0-.01';

  function fmt(n) { return n === null || n === undefined ? '–' : nf.format(n); }
  function dur(s) {
    if (!(s > 0)) return '–';
    s = Math.round(s);
    if (s >= 3600) return Math.floor(s / 3600) + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  /** A time in the video ("0:42", "1:02:03"); 0 s is "0:00". */
  function at(s) { return s > 0 ? dur(s) : '0:00'; }
  var mf = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' });

  /** YouTube: Shorts and long-form videos are compared with their own format only. */
  function sameFormat(a, b) { return (a.type === 'short') === (b.type === 'short'); }

  /** A small "most replayed" strip: one bar per heatmap value, peaks marked. */
  function heatStrip(p, onSeek, L) {
    L = L || STR.en;
    var NS = 'http://www.w3.org/2000/svg';
    var vals = p.heatmap || [];
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + vals.length + ' 20');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', 'ov-heat');
    svg.setAttribute('aria-hidden', 'true');
    var d = 'M0 20';
    vals.forEach(function (v, i) { d += ' L' + i + ' ' + (20 - v * 19).toFixed(2) + ' L' + (i + 1) + ' ' + (20 - v * 19).toFixed(2); });
    d += ' L' + vals.length + ' 20 Z';
    var path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'ov-heat-area');
    svg.appendChild(path);
    var total = p.duration || (p.heatmapStep ? p.heatmapStep * vals.length : 0);
    (p.heatmapPeaks || []).forEach(function (t) {
      if (!total) return;
      var x = Math.min(vals.length, Math.max(0, t / total * vals.length));
      var line = document.createElementNS(NS, 'rect');
      line.setAttribute('x', (x - 0.4).toFixed(2));
      line.setAttribute('y', '0');
      line.setAttribute('width', '0.8');
      line.setAttribute('height', '20');
      line.setAttribute('class', 'ov-heat-peak');
      svg.appendChild(line);
    });
    var peaks = (p.heatmapPeaks || []).slice(0, 3);
    var label = h('p', { class: 'ov-muted ov-replay' }, L.replayed);
    peaks.forEach(function (t, i) {
      if (i) label.appendChild(document.createTextNode(i === peaks.length - 1 ? L.and : ', '));
      label.appendChild(onSeek
        ? h('button', { class: 'ov-time', type: 'button', title: fillS(L.jump, { t: at(t) }), onclick: function () { onSeek(t); } }, at(t))
        : h('b', { text: at(t) }));
    });
    return h('div', { class: 'ov-heat-wrap' }, svg, peaks.length ? label : h('p', { class: 'ov-muted ov-replay', text: L.noPeak }));
  }

  function readOpen(key, dflt) {
    try { var v = localStorage.getItem(key); return v === null ? dflt : v !== '0'; } catch (e) { return dflt; }
  }
  function writeOpen(key, v) { try { localStorage.setItem(key, v ? '1' : '0'); } catch (e) { /* ignore */ } }

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
    // opts.openKey / opts.defaultOpen: YouTube keeps the card closed until asked, since it sits beside the player.
    // opts.persistOpen === false (YouTube): the open state is not remembered, so it never reopens on the next video by itself.
    var openKey = opts.openKey || OPEN_KEY;
    var persist = opts.persistOpen !== false;
    var open = persist ? readOpen(openKey, opts.defaultOpen !== false) : opts.defaultOpen === true;
    var timer = null;
    var status = '';
    var more = false; // narrow inline toolbar: the extra buttons are shown
    function L() { var l = opts.lang ? opts.lang() : 'en'; return STR[l] || STR.en; }
    function curLang() { return opts.lang ? opts.lang() : 'en'; }
    function locale() { return curLang() === 'tr' ? 'tr-TR' : 'en-US'; }

    // opts.onStats(): a site may handle the stats button itself (YouTube's watch page scrolls to its inline card); true = handled.
    var statsBtn = h('button', { class: 'ov-btn ov-logo', type: 'button', onclick: function () {
      if (opts.onStats && opts.onStats()) return;
      open = !open; if (persist) writeOpen(openKey, open); render(); position();
    } }, brandLogo('markInk', 'mark mark-on-ink'), brandLogo('mark', 'mark mark-on-blue'));
    var dlBtn = h('button', { class: 'ov-btn ov-tool', type: 'button', onclick: function () { download('media'); } }, icon(I_DOWN));
    var coverBtn = h('button', { class: 'ov-btn ov-tool', type: 'button', onclick: function () { download('cover'); } }, icon(I_IMAGE));
    var moreBtn = h('button', { class: 'ov-btn ov-more', type: 'button', 'aria-expanded': 'false', onclick: function () { more = !more; render(); } }, icon('M5 12h.01M12 12h.01M19 12h.01'));
    var bar = h('div', { class: 'ov-bar', role: 'toolbar' }, dlBtn, statsBtn, coverBtn);
    // Buttons other scripts add (YouTube phase 4: frame capture, swipe file, comments on Shorts).
    var extras = [];
    function syncExtras() {
      extras.forEach(function (x) {
        x.b.hidden = !!(x.o.visible && !x.o.visible());
        var t = typeof x.o.title === 'function' ? x.o.title() : x.o.title;
        if (t && x.b.title !== t) { x.b.title = t; x.b.setAttribute('aria-label', t); }
        if (x.o.pressed) x.b.setAttribute('aria-pressed', x.o.pressed() ? 'true' : 'false');
      });
    }
    function addButton(o) {
      var b = h('button', { class: 'ov-btn ov-extra ov-tool', type: 'button', 'data-oo-btn': o.id, onclick: function (ev) { o.onClick(b, ev); } }, icon(o.icon));
      extras.push({ o: o, b: b });
      bar.insertBefore(b, moreBtn.parentNode === bar ? moreBtn : null);
      syncExtras();
      return b;
    }
    var card = h('div', { class: 'ov-card' });
    var wrap = h('div', { class: 'ov-wrap', hidden: true }, bar, card);
    shadow.appendChild(wrap);
    bar.appendChild(moreBtn);
    function labels() {
      var S = L();
      var p = code && opts.getPost(code);
      var dl = p && p.files && p.files.length > 1 ? fillS(S.dlAll, { n: p.files.length }) : (p && p.type !== 'reel' && p.type !== 'video' && p.type !== 'short' && p.platform !== 'youtube' ? S.dlPhoto : S.dlVideo);
      [[statsBtn, S.stats], [dlBtn, dl], [coverBtn, S.dlCover], [moreBtn, S.more]].forEach(function (x) { x[0].title = x[1]; x[0].setAttribute('aria-label', x[1]); });
      moreBtn.setAttribute('aria-expanded', more ? 'true' : 'false');
      wrap.classList.toggle('is-more', more);
      try { host.setAttribute('lang', curLang()); } catch (e) { /* ignore */ }
    }

    function download(what) {
      var p = code && opts.getPost(code);
      var S = L();
      if (!p) { status = S.stillLoading; render(); return; }
      // YouTube video files come from yt-dlp through the bridge (the callback finds it and says when it isn't running).
      var has = what === 'cover' ? !!p.thumb : (p.platform === 'youtube' || (p.files || []).length > 0);
      if (!has) { status = S.noFile; open = true; render(); return; }
      // Progress and the saved path show in the card, so open it (without changing the saved preference).
      open = true;
      status = S.starting;
      render();
      var startedFor = code;
      // YouTube videos report yt-dlp's progress (through the bridge) as they go.
      var progress = function (label) { if (code === startedFor && label) { status = label; render(); } };
      opts.onDownloadMedia([p], what, progress).then(function (r) {
        if (code !== startedFor) return;
        status = r && r.message ? r.message : r && r.queued ? fillS(S.savedTo, { d: String(p.owner || '').replace('/', '_') }) : (r && r.errors && r.errors[0]) || S.dlFailed;
        render();
        var shownFor = code;
        setTimeout(function () { if (code === shownFor) { status = ''; render(); } }, r && r.message ? 12000 : r && r.queued ? 3500 : r && r.errors && r.errors[0] && r.errors[0].length > 120 ? 20000 : 7000);
      }, function () { status = S.dlFailedShort; render(); });
    }

    function stat(label, value, tip) {
      return h('div', { class: 'ov-stat', title: tip || null }, h('span', { class: 'ov-stat-label', text: label }), h('span', { class: 'ov-stat-value', text: value }));
    }

    function render() {
      syncExtras();
      labels();
      var S = L();
      var p = code && opts.getPost(code);
      statsBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
      card.hidden = !open;
      if (!open) return;
      card.textContent = '';
      if (!p) {
        card.appendChild(h('p', { class: 'ov-muted', text: opts.isLoading(code) ? S.loading : S.loadingScroll }));
        if (status) card.appendChild(h('p', { class: 'ov-status', text: status }));
        return;
      }
      var tt = p.platform === 'tiktok';
      if (p.platform === 'youtube') { renderYouTube(p); return; }
      var handle = p.owner ? '@' + String(p.owner).replace(/^tt\//, '') : '';
      var eng = p.views > 0 ? (M.interactions(p) / p.views) * 100 : null;
      card.appendChild(h('div', { class: 'ov-head' },
        h('span', { class: 'ov-owner', text: handle }),
        h('span', { class: 'ov-muted', text: p.takenAt ? df.format(new Date(p.takenAt)) : '' })));
      card.appendChild(h('div', { class: 'ov-grid' },
        stat('Views', fmt(p.views), p.views != null ? nfFull.format(p.views) : null),
        stat('Likes', fmt(p.likes), p.likes != null ? nfFull.format(p.likes) : null),
        stat('Comments', fmt(p.comments), p.comments != null ? nfFull.format(p.comments) : null),
        stat('Shares', fmt(p.shares), p.shares != null ? nfFull.format(p.shares) : 'Instagram only shares this for some posts'),
        tt ? stat('Saves', fmt(p.saves), p.saves != null ? nfFull.format(p.saves) : null) : null,
        stat('Duration', dur(p.duration)),
        stat('Engagement', eng === null ? '–' : eng.toFixed(2) + '%', tt ? '(likes + comments + shares + saves) ÷ views' : '(likes + comments) ÷ views')));

      // Compare with the creator's other posts we know about.
      var others = opts.getProfilePosts(p.owner).filter(function (x) { return x.views > 0 && (x.type === 'reel' || x.type === 'video'); });
      if (others.length >= 5 && p.views > 0) {
        var med = M.median(others.map(function (x) { return x.views; }));
        var ratio = p.views / med;
        var hit = ratio >= M.OUTLIER_RATIO;
        card.appendChild(h('p', { class: 'ov-compare' + (hit ? ' is-outlier' : '') },
          hit ? h('span', { class: 'stair', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')) : null,
          h('b', { text: ratio.toFixed(1) + '×' }),
          h('span', { text: handle + '\'s median · Viral Score ' + M.viralScore(p.views, med) })));
      }
      var audio = p.audio ? (p.audio.kind === 'music' || tt ? '♪ ' + p.audio.title + (p.audio.artist && p.audio.kind === 'music' ? ' · ' + p.audio.artist : '') : '♪ Original audio') : '';
      if (audio) card.appendChild(h('p', { class: 'ov-muted ov-audio', text: audio }));
      if (opts.isLoading(code)) card.appendChild(h('p', { class: 'ov-muted', text: 'Loading more details…' }));
      if (status) card.appendChild(h('p', { class: 'ov-status', text: status }));
      card.appendChild(h('button', { class: 'ov-link', type: 'button', onclick: opts.onOpenPanel }, S.openPanel));
    }

    function renderYouTube(p) {
      var S = L();
      var dfl = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
      var mfl = new Intl.DateTimeFormat(locale(), { month: 'short', year: 'numeric' });
      var nfl = new Intl.NumberFormat(locale());
      var nfc = new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 });
      var fmtL = function (n) { return n === null || n === undefined ? '–' : nfc.format(n); };
      var handle = p.author ? '@' + p.author : (p.ownerName || String(p.owner || '').replace(/^yt\//, ''));
      var short = p.type === 'short';
      var when = !p.takenAt ? '' : p.dateApprox && !p.dateDay ? '≈ ' + mfl.format(new Date(p.takenAt)) : dfl.format(new Date(p.takenAt));
      card.appendChild(h('div', { class: 'ov-head' },
        h('span', { class: 'ov-owner', text: handle }),
        h('span', { class: 'ov-muted', text: when, title: p.dateApprox ? S.approxDate : null })));
      var eng = M.engagementOf ? M.engagementOf(p, p.views) : (p.views > 0 ? (M.interactions(p) / p.views) * 100 : null);
      var pctF = new Intl.NumberFormat(locale(), { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });
      card.appendChild(h('div', { class: 'ov-grid' },
        stat(S.views, (p.viewsApprox ? '≈' : '') + fmtL(p.views), p.views != null ? (p.viewsApprox ? S.about : '') + nfl.format(p.views) : null),
        stat(S.likes, fmtL(p.likes), p.likes != null ? nfl.format(p.likes) : S.loadsWith),
        stat(S.comments, (p.commentsApprox ? '≈' : '') + fmtL(p.comments), p.comments != null ? nfl.format(p.comments) : S.loadsWith),
        stat(S.duration, dur(p.duration)),
        stat(S.engagement, eng == null ? '–' : pctF.format(eng / 100), S.engTip),
        stat(S.chapters, (p.chapters || []).length ? String(p.chapters.length) : '–', (p.chapters || []).map(function (c) { return at(c.start) + ' ' + c.title; }).join('\n') || S.noChapters)));

      // Score against this channel's median for the same format (Shorts vs long-form).
      var group = opts.getProfilePosts(p.owner).filter(function (x) { return x.views > 0 && sameFormat(x, p); });
      var what = short ? S.shortsW : S.longW;
      if (group.length >= 5 && p.views > 0) {
        var med = M.median(group.map(function (x) { return x.views; }));
        var ratio = p.views / med;
        var hit = ratio >= M.OUTLIER_RATIO;
        card.appendChild(h('p', { class: 'ov-compare' + (hit ? ' is-outlier' : ''), title: fillS(S.medianOf, { n: group.length, what: what, m: nfl.format(Math.round(med)) }) },
          hit ? h('span', { class: 'stair', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')) : null,
          h('b', { text: new Intl.NumberFormat(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(ratio) + '×' }),
          h('span', { text: fillS(S.fmtMedian, { h: handle, what: what, s: M.viralScore(p.views, med) }) })));
      } else {
        card.appendChild(h('p', { class: 'ov-muted', text: fillS(S.collect, { tab: short ? S.tabShorts : S.tabVideos, n: group.length, what: short ? S.whatShorts : S.whatLong }) }));
      }
      if ((p.heatmap || []).length) card.appendChild(heatStrip(p, opts.onSeek, S));
      if (status) card.appendChild(h('p', { class: 'ov-status', text: status }));
      card.appendChild(h('button', { class: 'ov-link', type: 'button', onclick: opts.onOpenPanel }, S.openPanel));
    }

    function clearPos() {
      ['width', 'left', 'top'].forEach(function (k) { wrap.style.removeProperty(k); });
    }

    function setMode(mode, flip) {
      wrap.classList.toggle('is-inline', mode === 'inline');
      wrap.classList.toggle('is-rail', mode === 'rail');
      wrap.classList.toggle('is-flip', !!flip);
    }

    /** Back on <body> (fixed positioning) after being placed inside the page's own markup. */
    function toBody() {
      var body = document.body || document.documentElement;
      if (host.parentNode !== body) body.appendChild(host);
      host.style.removeProperty('display');
      host.style.removeProperty('vertical-align');
    }

    // opts.placement() lets a site put the toolbar somewhere other than over the video:
    //   { inline: element } → inside that element, first child (YouTube's like/share row)
    //   { rail: DOMRect }   → a vertical toolbar right of that rect (YouTube Shorts' action column)
    //   null                → over the video, as on Instagram and TikTok
    function position() {
      if (!code) { wrap.hidden = true; return; }
      var pl = opts.placement ? opts.placement() : null;
      if (pl && pl.inline) {
        // Our own row (YouTube: a row of its own under the title row, never inside YouTube's like / share row).
        if (host.parentNode !== pl.inline || pl.inline.firstChild !== host) pl.inline.insertBefore(host, pl.inline.firstChild);
        host.style.setProperty('display', 'inline-flex');
        host.style.setProperty('vertical-align', 'middle');
        setMode('inline');
        // Narrow windows: the stats button plus "…", which shows the other buttons.
        var narrow = !!(opts.collapseBelow && window.innerWidth < opts.collapseBelow);
        wrap.classList.toggle('is-narrow', narrow);
        clearPos();
        wrap.hidden = false;
        if (open) {
          var br = bar.getBoundingClientRect();
          var cw = Math.min(300, window.innerWidth - 16);
          var minTop = (opts.topInset ? opts.topInset() : 0) + 8;
          card.style.setProperty('width', cw + 'px');
          card.style.setProperty('left', Math.round(Math.min(Math.max(8, br.left), window.innerWidth - cw - 8)) + 'px');
          // Never above the site's sticky header (YouTube's masthead): the card is fixed, the toolbar scrolls away under it.
          card.style.setProperty('top', Math.round(Math.max(minTop, br.bottom + 8)) + 'px');
        }
        return;
      }
      wrap.classList.remove('is-narrow');
      card.style.removeProperty('width');
      card.style.removeProperty('left');
      card.style.removeProperty('top');
      toBody();
      if (pl && pl.rail) {
        var rr = pl.rail;
        var x = Math.round(rr.right + 12);
        var barW = 40;
        var cardW = 300;
        var flip = open && window.innerWidth - x < barW + 6 + cardW + 8;
        setMode('rail', flip);
        wrap.style.removeProperty('width');
        wrap.style.setProperty('left', (flip ? x + barW - (barW + 6 + cardW) : x) + 'px');
        wrap.style.setProperty('top', Math.round(Math.max((opts.topInset ? opts.topInset() : 0) + 8, rr.top)) + 'px');
        wrap.hidden = false;
        return;
      }
      setMode(null);
      var r = findMedia();
      if (!r) { wrap.hidden = true; return; }
      wrap.hidden = false;
      var width = Math.min(300, Math.max(220, r.width - 24));
      wrap.style.setProperty('width', width + 'px');
      wrap.style.setProperty('left', Math.round(r.left + r.width / 2 - width / 2) + 'px');
      wrap.style.setProperty('top', Math.round(Math.max((opts.topInset ? opts.topInset() : 0) + 8, r.top + 10)) + 'px');
    }

    // The inline card is position:fixed, so it has to follow the toolbar while the page scrolls.
    window.addEventListener('scroll', function () {
      if (code && open && wrap.classList.contains('is-inline')) position();
    }, { passive: true, capture: true });

    return {
      host: host,
      addButton: addButton,
      /** The toolbar's rectangle on screen (null while hidden), for popovers that hang off it. */
      barRect: function () { return wrap.hidden ? null : bar.getBoundingClientRect(); },
      mode: function () { return wrap.classList.contains('is-rail') ? 'rail' : wrap.classList.contains('is-inline') ? 'inline' : 'over'; },
      setCode: function (c) {
        code = c;
        status = '';
        clearInterval(timer);
        if (code) timer = setInterval(position, 300);
        position();
        render();
      },
      refresh: function () { if (code) { render(); position(); } },
      /** Open or close the card (YouTube: when the inline watch card isn't there to scroll to). */
      setOpen: function (v) { open = !!v; render(); position(); },
      isOpen: function () { return open; }
    };
  }

  root.ReelScopeOverlay = { create: create };
})(typeof self !== 'undefined' ? self : this);
