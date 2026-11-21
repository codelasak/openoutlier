// Stand-ins for youtube.com's own DOM on dev/youtube-demo.html?surface=… (phase 3): home,
// search, subscriptions, watch, channel and Shorts, built from the fixtures in dev/youtube/cards
// with YouTube's element names (ytd-rich-item-renderer, yt-lockup-view-model, ytd-video-renderer,
// yt-thumbnail-view-model, ytd-watch-metadata #top-row / #bottom-row …) and roughly its look in
// light and dark (html[dark]), so the badges, the filters bar and the cards can be checked for
// alignment, overlap and clipping. Not a copy of YouTube: plain boxes, no YouTube artwork.
(function () {
  'use strict';
  var Y = self.OpenOutlierYouTube;

  var CSS = `
  :root{--yt-bg:#fff;--yt-text:#0f0f0f;--yt-muted:#606060;--yt-chip:rgba(0,0,0,.05);--yt-line:rgba(0,0,0,.1);--yt-badge:rgba(0,0,0,.6)}
  html[dark]{--yt-bg:#0f0f0f;--yt-text:#f1f1f1;--yt-muted:#aaa;--yt-chip:rgba(255,255,255,.1);--yt-line:rgba(255,255,255,.2)}
  body.surf{margin:0;background:var(--yt-bg);color:var(--yt-text);font:400 14px/20px Roboto,Arial,sans-serif}
  body.surf > header, body.surf > nav, body.surf > main, body.surf > .ch-head{display:none}
  ytd-app,ytd-page-manager,ytd-browse,ytd-search,ytd-watch-flexy,ytd-shorts,ytd-rich-grid-renderer,ytd-section-list-renderer,ytd-item-section-renderer,ytd-rich-section-renderer,ytd-reel-shelf-renderer,ytd-watch-metadata,ytd-tabbed-page-header{display:block}
  .mast{position:sticky;top:0;z-index:2020;height:56px;display:flex;align-items:center;gap:16px;padding:0 16px;background:var(--yt-bg)}
  .mast .logo{display:flex;align-items:center;gap:4px;font:700 18px/1 Roboto,Arial;letter-spacing:-.5px}
  .mast .logo i{width:28px;height:20px;border-radius:6px;background:#f00;display:inline-block}
  .mast .sb{flex:0 1 560px;margin:0 auto;height:40px;border:1px solid var(--yt-line);border-radius:20px;display:flex;align-items:center;padding:0 16px;color:var(--yt-muted)}
  .mast .me{width:32px;height:32px;border-radius:50%;background:#7b5ea7}
  ytd-page-manager{padding:0 24px 40px}
  .chips{display:flex;gap:12px;padding:12px 0;position:sticky;top:56px;z-index:2010;background:var(--yt-bg);overflow:hidden}
  .chip{height:32px;padding:0 12px;border-radius:8px;background:var(--yt-chip);display:inline-flex;align-items:center;font-weight:500;white-space:nowrap}
  .chip.on{background:var(--yt-text);color:var(--yt-bg)}
  ytd-rich-grid-renderer > #contents{display:flex;flex-wrap:wrap;gap:40px 16px}
  ytd-rich-item-renderer{display:block;width:calc((100% - 48px) / 4)}
  @media (max-width:1250px){ytd-rich-item-renderer{width:calc((100% - 32px) / 3)}}
  @media (max-width:880px){ytd-rich-item-renderer{width:calc((100% - 16px) / 2)}}
  @media (max-width:560px){ytd-rich-item-renderer{width:100%}ytd-page-manager{padding:0 12px 40px}}
  ytd-rich-section-renderer{width:100%}
  .shelf-h{display:flex;align-items:center;gap:8px;font:700 20px/28px Roboto,Arial;margin:0 0 16px}
  .shelf-h i{width:22px;height:22px;border-radius:6px;background:#f00}
  .shelf{display:flex;gap:16px;overflow:hidden}
  yt-lockup-view-model{display:block}
  .lk{display:flex;flex-direction:column;gap:12px}
  .lk.h{flex-direction:row;gap:8px}
  .lk .ci{display:block;position:relative;border-radius:12px;overflow:hidden}
  .lk.h .ci{width:168px;flex:none;border-radius:8px}
  yt-thumbnail-view-model,ytd-thumbnail{display:block;position:relative;aspect-ratio:16/9;border-radius:inherit;overflow:hidden}
  .th{position:absolute;inset:0;display:flex;align-items:flex-end;padding:10% 8%;box-sizing:border-box;font:900 clamp(12px,2.2vw,30px)/1 Arial Black,Arial;color:#fff;text-shadow:0 2px 0 rgba(0,0,0,.35);text-transform:uppercase}
  .dur{position:absolute;right:8px;bottom:8px;height:18px;padding:0 4px;border-radius:4px;background:var(--yt-badge);color:#fff;font:500 12px/18px Roboto,Arial}
  .lk.h .dur{right:4px;bottom:4px}
  .meta{display:flex;gap:12px;min-width:0}
  .av{width:36px;height:36px;border-radius:50%;flex:none}
  .tx{min-width:0;display:flex;flex-direction:column}
  .tt{margin:0 0 4px;font:500 16px/22px Roboto,Arial;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .lk.h .tt{font-size:14px;line-height:20px}
  .yt-content-metadata-view-model__metadata-row{color:var(--yt-muted);font-size:14px;line-height:20px}
  .lk.h .yt-content-metadata-view-model__metadata-row{font-size:12px;line-height:18px}
  .lk .menu{position:absolute;right:-8px;top:0;width:24px;height:24px;color:var(--yt-muted)}
  ytm-shorts-lockup-view-model{display:block;width:calc((100% - 48px) / 4);flex:none}
  .sh .ci{display:block;position:relative;border-radius:12px;overflow:hidden}
  .shortsLockupViewModelHostThumbnailContainer{position:relative;aspect-ratio:9/16}
  .sh .tt{font-size:16px;margin:8px 0 0}
  .sh .v{color:var(--yt-muted)}
  /* search */
  ytd-search{max-width:1096px;margin:0 auto}
  ytd-search .sfilters{display:flex;justify-content:space-between;align-items:center;padding:12px 0}
  ytd-search .sfilters .fb{height:36px;padding:0 12px;border-radius:18px;font-weight:500;display:flex;align-items:center;gap:6px}
  ytd-video-renderer{display:flex;gap:16px;margin:0 0 16px}
  ytd-video-renderer ytd-thumbnail{width:360px;flex:none;border-radius:12px}
  @media (max-width:760px){ytd-video-renderer{flex-direction:column}ytd-video-renderer ytd-thumbnail{width:100%}}
  ytd-video-renderer .tt{font-size:18px;line-height:26px;font-weight:400}
  ytd-video-renderer #metadata-line{color:var(--yt-muted);font-size:12px;line-height:18px}
  ytd-video-renderer #metadata-line span + span::before{content:" • "}
  ytd-video-renderer .chn{display:flex;align-items:center;gap:8px;color:var(--yt-muted);font-size:12px;margin:12px 0}
  ytd-video-renderer .chn .av{width:24px;height:24px}
  ytd-video-renderer .desc{color:var(--yt-muted);font-size:12px}
  ytd-reel-shelf-renderer{margin:8px 0 24px;padding:0 0 16px;border-bottom:1px solid var(--yt-line)}
  ytd-reel-shelf-renderer ytm-shorts-lockup-view-model{width:210px}
  /* watch */
  ytd-watch-flexy{display:flex;gap:24px;max-width:1700px;margin:0 auto;padding-top:24px}
  ytd-watch-flexy #primary{flex:1;min-width:0}
  ytd-watch-flexy #secondary{width:402px;flex:none}
  @media (max-width:1000px){ytd-watch-flexy{flex-direction:column}ytd-watch-flexy #secondary{width:auto}}
  #movie_player{aspect-ratio:16/9;background:#000;border-radius:12px;overflow:hidden;position:relative}
  #movie_player video{width:100%;height:100%;display:block}
  ytd-watch-metadata #title h1{font:700 20px/28px Roboto,Arial;margin:12px 0 0}
  #top-row{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;margin-top:12px}
  #owner{display:flex;align-items:center;gap:12px}
  #owner .av{width:40px;height:40px}
  #owner b{display:block;font-weight:500;font-size:16px}
  #owner small{color:var(--yt-muted);font-size:12px}
  .sub-btn{height:36px;padding:0 16px;border:0;border-radius:18px;background:var(--yt-text);color:var(--yt-bg);font:500 14px Roboto,Arial;margin-left:12px}
  #top-level-buttons-computed{display:flex;gap:8px}
  .pill{height:36px;padding:0 16px;border-radius:18px;background:var(--yt-chip);display:inline-flex;align-items:center;gap:6px;font-weight:500;white-space:nowrap}
  .seg{display:inline-flex;border-radius:18px;background:var(--yt-chip);overflow:hidden}
  .seg span{height:36px;padding:0 14px;display:inline-flex;align-items:center;font-weight:500}
  .seg span + span{border-left:1px solid var(--yt-line)}
  #bottom-row{margin-top:12px;padding:12px;border-radius:12px;background:var(--yt-chip)}
  #bottom-row b{font-weight:500}
  #secondary .chips{position:static;padding:0 0 12px}
  #secondary yt-lockup-view-model{margin:0 0 8px}
  /* channel */
  ytd-tabbed-page-header{display:block;max-width:1284px;margin:0 auto}
  #page-header{display:flex;gap:20px;align-items:center;padding:16px 0 4px}
  .ch-avatar{width:160px;height:160px;border-radius:50%;background:#1f7a44;color:#fff;display:grid;place-items:center;font:600 64px Roboto,Arial,sans-serif;flex:none}
  @media (max-width:640px){.ch-avatar{width:72px;height:72px;font-size:30px}}
  .ch-name{font:700 36px/1.2 Roboto,Arial,sans-serif}
  .ch-meta{color:var(--yt-muted);margin:6px 0 4px}
  .ch-desc{color:var(--yt-muted);margin:0 0 12px}
  .ch-actions{display:flex;align-items:center}
  .ch-sub{height:36px;padding:0 16px;border-radius:18px;border:0;background:var(--yt-text);color:var(--yt-bg);font:500 14px Roboto,Arial,sans-serif}
  #tabs-container{display:flex;gap:24px;border-bottom:1px solid var(--yt-line);margin:8px 0 0}
  #tabs-container span{padding:12px 0;font-weight:500;color:var(--yt-muted)}
  #tabs-container span.on{color:var(--yt-text);box-shadow:inset 0 -2px 0 var(--yt-text)}
  ytd-browse[page-subtype=channels] ytd-rich-grid-renderer{max-width:1284px;margin:0 auto}
  /* shorts */
  ytd-shorts{display:flex;justify-content:center;align-items:flex-start;gap:16px;padding-top:16px}
  #shorts-player{position:relative;height:calc(100vh - 88px);max-height:860px;aspect-ratio:9/16;border-radius:12px;overflow:hidden;background:#000}
  #shorts-player video{width:100%;height:100%;display:block;object-fit:cover}
  .sp-top{position:absolute;left:12px;right:12px;top:12px;display:flex;justify-content:space-between;color:#fff}
  .sp-top i{width:40px;height:40px;border-radius:50%;background:rgba(0,0,0,.35);display:inline-block}
  .sp-meta{position:absolute;left:12px;right:12px;bottom:16px;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.6)}
  .sp-meta b{display:block;font-weight:500}
  .sp-acts{display:flex;flex-direction:column;justify-content:flex-end;gap:16px;align-self:flex-end;padding-bottom:16px}
  .sp-acts span{width:48px;height:48px;border-radius:50%;background:var(--yt-chip);display:grid;place-items:center;font-size:11px}
  `;

  var PALETTE = ['#1E3BFF', '#0B8A5F', '#B3261E', '#7B3FB2', '#C45A00', '#005F73', '#9C2A6B', '#2D3142'];
  function hue(s) { var x = 0; for (var i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0; return PALETTE[x % PALETTE.length]; }
  function words(t) { return String(t || '').replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(function (w) { return w.length > 3; }).slice(0, 2).join(' '); }

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'style') e.style.cssText = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function thumbBox(r, tag) {
    var t = h(tag || 'yt-thumbnail-view-model', {}, [h('div', { class: 'th', style: 'background:linear-gradient(135deg,' + hue(r.code) + ',' + hue(r.code + 'x') + ')', text: words(r.caption) })]);
    if (r.duration) t.appendChild(h('div', { class: 'dur', text: Y ? clock(r.duration) : '' }));
    return t;
  }
  function clock(s) { var m = Math.floor(s / 60); return (m >= 60 ? Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); }
  function views(r, lang) {
    if (r.views == null) return '';
    var n = new Intl.NumberFormat(lang === 'tr' ? 'tr-TR' : 'en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(r.views);
    return lang === 'tr' ? n + ' görüntüleme' : n + ' views';
  }
  function agoText(r, lang) {
    if (!r.takenAt) return '';
    var d = (Date.now() - r.takenAt) / 864e5;
    var u = d >= 365 ? [Math.round(d / 365), 'year', 'yıl'] : d >= 30 ? [Math.round(d / 30.44), 'month', 'ay'] : d >= 7 ? [Math.round(d / 7), 'week', 'hafta'] : d >= 1 ? [Math.round(d), 'day', 'gün'] : [Math.max(1, Math.round(d * 24)), 'hour', 'saat'];
    return lang === 'tr' ? u[0] + ' ' + u[2] + ' önce' : u[0] + ' ' + u[1] + (u[0] === 1 ? '' : 's') + ' ago';
  }
  function chName(r) { return r.ownerName || (r.author ? r.author.replace(/([a-z])([A-Z])/g, '$1 $2') : ''); }
  function link(r) { return r.type === 'short' ? '/shorts/' + r.code : '/watch?v=' + r.code; }

  /** A home / subscriptions / channel grid card (yt-lockup-view-model). opts: { avatar, compact } */
  function lockup(r, lang, opts) {
    opts = opts || {};
    var meta = [views(r, lang), agoText(r, lang)].filter(Boolean).join(' • ');
    var text = h('div', { class: 'tx' }, [
      h('h3', { class: 'tt', text: r.caption }),
      opts.noChannel ? null : h('div', { class: 'yt-content-metadata-view-model__metadata-row' }, [h('a', { href: '/@' + (r.author || ''), class: 'yt-content-metadata-view-model__metadata-text', style: 'color:inherit;text-decoration:none', text: chName(r) })]),
      h('div', { class: 'yt-content-metadata-view-model__metadata-row' }, [h('span', { class: 'yt-content-metadata-view-model__metadata-text', text: meta })])
    ]);
    var lk = h('div', { class: 'lk' + (opts.compact ? ' h' : '') }, [
      h('a', { class: 'ci yt-lockup-view-model__content-image', href: link(r) }, [thumbBox(r)]),
      h('div', { class: 'meta' }, [opts.avatar ? h('div', { class: 'av', style: 'background:' + hue(r.author || 'x') }) : null, text])
    ]);
    return h('yt-lockup-view-model', {}, [lk]);
  }
  function shortsLockup(r, lang) {
    return h('ytm-shorts-lockup-view-model', { class: 'sh' }, [
      h('a', { class: 'ci', href: '/shorts/' + r.code }, [h('div', { class: 'shortsLockupViewModelHostThumbnailContainer' }, [h('div', { class: 'th', style: 'background:linear-gradient(160deg,' + hue(r.code) + ',#111)', text: words(r.caption) })])]),
      h('h3', { class: 'tt', text: r.caption }),
      h('div', { class: 'v', text: views(r, lang) })
    ]);
  }
  function videoRenderer(r, lang) {
    var meta = h('div', { id: 'metadata-line' }, [h('span', { class: 'inline-metadata-item', text: views(r, lang) }), r.takenAt ? h('span', { class: 'inline-metadata-item', text: agoText(r, lang) }) : null]);
    return h('ytd-video-renderer', {}, [
      h('ytd-thumbnail', {}, [h('a', { id: 'thumbnail', href: link(r), style: 'position:absolute;inset:0' }, [thumbBox(r, 'div')])]),
      h('div', { class: 'tx' }, [
        h('h3', { class: 'tt', text: r.caption }), meta,
        h('div', { class: 'chn' }, [h('div', { class: 'av', style: 'background:' + hue(r.author || 'x') }), h('a', { href: '/@' + (r.author || ''), style: 'color:inherit;text-decoration:none', text: chName(r) })]),
        h('div', { class: 'desc', text: lang === 'tr' ? 'Bu videoda adım adım gösteriyorum…' : 'In this video I show you step by step…' })
      ])
    ]);
  }
  function mast(lang, q) {
    return h('div', { class: 'mast' }, [h('div', { class: 'logo' }, [h('i'), 'YouTube']), h('div', { class: 'sb', text: q || (lang === 'tr' ? 'Ara' : 'Search') }), h('div', { class: 'me' })]);
  }
  function chips(list) { return h('div', { class: 'chips', id: 'header' }, list.map(function (c, i) { return h('span', { class: 'chip' + (i ? '' : ' on'), text: c }); })); }

  function pageWrap(lang, q, page) {
    var app = h('ytd-app', {}, [mast(lang, q), h('ytd-page-manager', {}, [page])]);
    // The legacy demo's own channel header (and its Track slot) isn't part of these pages.
    Array.prototype.forEach.call(document.querySelectorAll('body > .ch-head, body > header, body > nav, body > main'), function (el) { el.remove(); });
    document.body.classList.add('surf');
    document.body.appendChild(app);
    return app;
  }

  /** Build one surface. data: the fixture JSON; extra: { lang, records (channel grid) } */
  function build(surface, data, extra) {
    var lang = extra.lang;
    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    var recs = surface === 'channel' ? extra.records : Y.parseCards(data, { lang: 'en' });
    var tr = lang === 'tr';
    if (surface === 'home' || surface === 'subscriptions') {
      var grid = h('div', { id: 'contents' });
      var shortsDone = false;
      recs.forEach(function (r, i) {
        if (r.type === 'short') {
          if (shortsDone) return;
          shortsDone = true;
          var shelf = h('div', { class: 'shelf' }, recs.filter(function (x) { return x.type === 'short'; }).map(function (x) { return shortsLockup(x, lang); }));
          grid.appendChild(h('ytd-rich-section-renderer', {}, [h('div', { class: 'shelf-h' }, [h('i'), 'Shorts']), shelf]));
          return;
        }
        grid.appendChild(h('ytd-rich-item-renderer', {}, [lockup(r, lang, { avatar: true })]));
        if (surface === 'home' && i === 3) {
          // A mix: has a watch link with &list=, must get no badges.
          grid.appendChild(h('ytd-rich-item-renderer', {}, [h('yt-lockup-view-model', {}, [h('div', { class: 'lk' }, [
            h('a', { class: 'ci', href: '/watch?v=yTdemo00029&list=RDmixdemo0001' }, [h('yt-collection-thumbnail-view-model', {}, [h('yt-thumbnail-view-model', {}, [h('div', { class: 'th', style: 'background:linear-gradient(135deg,#333,#777)', text: 'Mix' })])])]),
            h('div', { class: 'meta' }, [h('div', { class: 'tx' }, [h('h3', { class: 'tt', text: 'Mix – Excel Demo' }), h('div', { class: 'yt-content-metadata-view-model__metadata-row', text: tr ? 'Excel Demo, Sheet Academy ve diğerleri' : 'Excel Demo, Sheet Academy and more' })])])])])]));
        }
      });
      var rg = h('ytd-rich-grid-renderer', {}, [surface === 'home' ? chips(tr ? ['Tümü', 'Excel', 'Microsoft', 'Dashboards', 'Müzik', 'Yeni yüklenenler'] : ['All', 'Excel', 'Microsoft', 'Dashboards', 'Music', 'Recently uploaded']) : h('div', { id: 'header', class: 'shelf-h', style: 'padding:16px 0 0', text: tr ? 'En son' : 'Latest' }), grid]);
      pageWrap(lang, '', h('ytd-browse', { 'page-subtype': surface === 'home' ? 'home' : 'subscriptions' }, [rg]));
    } else if (surface === 'search') {
      var list = h('div', { id: 'contents' });
      var shelfDone = false;
      recs.forEach(function (r) {
        if (r.type === 'short' && !/^srch/.test(r.code)) {
          if (shelfDone) return;
          shelfDone = true;
          list.appendChild(h('ytd-reel-shelf-renderer', {}, [h('div', { class: 'shelf-h' }, [h('i'), 'Shorts']), h('div', { class: 'shelf' }, recs.filter(function (x) { return x.type === 'short' && !/^srch/.test(x.code); }).map(function (x) { return shortsLockup(x, lang); }))]));
          return;
        }
        list.appendChild(videoRenderer(r, lang));
      });
      var sl = h('ytd-section-list-renderer', {}, [h('div', { class: 'sfilters', id: 'header' }, [h('div', { class: 'chips', style: 'position:static;padding:0' }, [h('span', { class: 'chip on', text: tr ? 'Tümü' : 'All' }), h('span', { class: 'chip', text: 'Shorts' }), h('span', { class: 'chip', text: tr ? 'Videolar' : 'Videos' }), h('span', { class: 'chip', text: tr ? 'İzlenmemiş' : 'Unwatched' })]), h('span', { class: 'fb', text: tr ? 'Filtreler' : 'Filters' })]), h('ytd-item-section-renderer', {}, [list])]);
      // YouTube's section list: #contents holds the item sections; the bar goes right before it.
      var contents = h('div', { id: 'contents' }, [sl.lastChild]);
      sl.appendChild(contents);
      pageWrap(lang, 'excel pivot table', h('ytd-search', {}, [sl]));
    } else if (surface === 'watch') {
      var side = h('div', { id: 'secondary' }, [chips(tr ? ['Tümü', 'Excel Demo kanalından', 'İlgili'] : ['All', 'From Excel Demo', 'Related'])].concat(recs.map(function (r) { return lockup(r, lang, { compact: true }); })));
      var w = extra.watch || {};
      var primary = h('div', { id: 'primary' }, [
        h('div', { id: 'movie_player' }, [h('video', { muted: '', playsinline: '' })]),
        h('ytd-watch-metadata', {}, [h('div', { id: 'above-the-fold' }, [
          h('div', { id: 'title' }, [h('h1', { text: w.title || 'XLOOKUP vs VLOOKUP in 60 seconds' })]),
          h('div', { id: 'top-row' }, [
            h('div', { id: 'owner' }, [h('div', { class: 'av', style: 'background:#1f7a44' }), h('div', {}, [h('b', { text: 'Excel Demo' }), h('small', { text: tr ? '712 B abone' : '712K subscribers' })]), h('button', { class: 'sub-btn', text: tr ? 'Abone ol' : 'Subscribe' })]),
            h('div', { id: 'top-level-buttons-computed' }, [h('span', { class: 'seg' }, [h('span', { text: '👍 13K' }), h('span', { text: '👎' })]), h('span', { class: 'pill', text: tr ? 'Paylaş' : 'Share' }), h('span', { class: 'pill', text: tr ? 'İndir' : 'Download' }), h('span', { class: 'pill', text: '…' })])
          ]),
          h('div', { id: 'bottom-row' }, [h('b', { text: (tr ? '801.352 görüntüleme  8 May 2025' : '801,352 views  May 8, 2025') }), h('div', { text: tr ? 'XLOOKUP ile VLOOKUP arasındaki fark, 60 saniyede…' : 'The difference between XLOOKUP and VLOOKUP, in 60 seconds…' })])
        ])])
      ]);
      pageWrap(lang, 'xlookup', h('ytd-watch-flexy', {}, [primary, side]));
    } else if (surface === 'channel') {
      var g = h('div', { id: 'contents' }, recs.map(function (r) { return h('ytd-rich-item-renderer', {}, [lockup(r, lang, { noChannel: true })]); }));
      var header = h('ytd-tabbed-page-header', {}, [h('div', { id: 'page-header-container' }, [
        h('div', { id: 'page-header' }, [h('div', { class: 'ch-avatar', text: 'E' }), h('div', {}, [
          h('div', { class: 'ch-name', text: 'Excel Demo' }),
          h('div', { class: 'ch-meta', text: tr ? '@ExcelDemo · 712 B abone · 776 video' : '@ExcelDemo · 712K subscribers · 776 videos' }),
          h('div', { class: 'ch-desc', text: tr ? 'Her hafta bir Excel tekniği, 10 dakikada.' : 'One Excel technique a week, in 10 minutes.' }),
          h('div', { class: 'ch-actions', 'data-openoutlier-track-slot': '' }, [h('button', { class: 'ch-sub', text: tr ? 'Abone ol' : 'Subscribe' })])
        ])]),
        h('div', { id: 'tabs-container' }, [h('span', { text: tr ? 'Ana sayfa' : 'Home' }), h('span', { class: 'on', text: tr ? 'Videolar' : 'Videos' }), h('span', { text: 'Shorts' }), h('span', { text: tr ? 'Canlı' : 'Live' }), h('span', { text: tr ? 'Oynatma listeleri' : 'Playlists' })])
      ])]);
      var cg = h('ytd-rich-grid-renderer', {}, [chips(tr ? ['En son', 'Popüler', 'En eski'] : ['Latest', 'Popular', 'Oldest']), g]);
      pageWrap(lang, '', h('ytd-browse', { 'page-subtype': 'channels' }, [header, cg]));
    } else if (surface === 'shorts') {
      var s = extra.short || {};
      pageWrap(lang, '', h('ytd-shorts', {}, [
        h('div', { id: 'shorts-player' }, [h('video', { muted: '', playsinline: '', style: 'background:linear-gradient(170deg,#0B8A5F,#111)' }),
          h('div', { class: 'sp-top' }, [h('span', {}, [h('i'), ' ', h('i')]), h('i')]),
          h('div', { class: 'sp-meta' }, [h('b', { text: '@ExcelDemo' }), h('span', { text: s.title || 'Ctrl + T in 10 seconds' })])]),
        h('div', { class: 'sp-acts' }, ['👍', '👎', '💬', '↗', '⋯'].map(function (x) { return h('span', { text: x }); }))
      ]));
    }
  }

  self.OpenOutlierDemoSurfaces = { build: build };
})();
