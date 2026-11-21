// OpenOutlier Library – Thumbnail & title tester (#/thumb-test), phase 4 (`thumb-preview`).
// Drop a thumbnail, type a title: it is shown on a mock YouTube home grid and search list next to
// real thumbnails from the tracked niche (the Library's saved videos of those channels), in light
// and dark, at desktop and phone sizes. Everything stays in this tab: the image is read with
// FileReader and never leaves the browser (kept in sessionStorage so a reload keeps it).
(function (root) {
  'use strict';
  var F = root.OpenOutlierFeatures;
  var TR = root.OpenOutlierTracking;
  var STORE = 'oo:thumb-test';

  var S = {
    en: {
      nav: 'Thumbnail tester', title: 'Thumbnail tester', sub: 'Your thumbnail and title among the niche\'s real videos, the way viewers meet them.',
      drop: 'Drop your thumbnail here', dropOr: 'or', pick: 'Choose an image', dropHint: 'JPG, PNG or WebP, 16:9 (1280×720). It stays in this tab.', replace: 'Replace', clearImg: 'Remove',
      titleL: 'Title', titlePh: 'Your video title', channelL: 'Channel', viewsL: 'Views', ageL: 'Hours ago', durL: 'Length',
      chips: ['All', 'Excel', 'Tutorials', 'Data', 'Office', 'Recently uploaded'],
      views: '{n} views', from: 'Competitors', fromNiche: 'Tracked niche ({n})', fromAll: 'All saved YouTube channels ({n})', fromFolder: '{f} ({n})',
      shuffle: 'Shuffle', position: 'Your video', posFirst: 'First', posRandom: 'Random', highlight: 'Outline mine',
      home: 'Home', search: 'Search', desktop: 'Desktop', mobile: 'Phone', light: 'Light', dark: 'Dark',
      noComp: 'No competitor videos with thumbnails yet. Track a niche (Niche tracking) or save some YouTube channels: their videos fill the grid.',
      noImg: 'Drop a thumbnail on the left to see it here.', yours: 'Your video', titleLen: '{n} characters', titleLong: '{n} characters: YouTube cuts titles at about 60–70 on the home page.',
      off: 'The thumbnail tester is switched off in Features.', turnOn: 'Turn on', readFail: 'Couldn\'t read that image.', searchQ: 'Search', ago: '{t} ago', live: 'just now'
    },
    tr: {
      nav: 'Thumbnail testi', title: 'Thumbnail testi', sub: 'Thumbnail\'in ve başlığın, nişin gerçek videolarının arasında, izleyicinin gördüğü gibi.',
      drop: 'Thumbnail\'ini buraya bırak', dropOr: 'ya da', pick: 'Görsel seç', dropHint: 'JPG, PNG ya da WebP, 16:9 (1280×720). Bu sekmede kalır.', replace: 'Değiştir', clearImg: 'Kaldır',
      titleL: 'Başlık', titlePh: 'Videonun başlığı', channelL: 'Kanal', viewsL: 'İzlenme', ageL: 'Saat önce', durL: 'Süre',
      chips: ['Tümü', 'Excel', 'Eğitimler', 'Veri', 'Office', 'Son yüklenenler'],
      views: '{n} görüntüleme', from: 'Rakipler', fromNiche: 'Takip edilen niş ({n})', fromAll: 'Bütün kayıtlı YouTube kanalları ({n})', fromFolder: '{f} ({n})',
      shuffle: 'Karıştır', position: 'Senin videon', posFirst: 'İlk sırada', posRandom: 'Rastgele', highlight: 'Benimkini çerçevele',
      home: 'Ana sayfa', search: 'Arama', desktop: 'Masaüstü', mobile: 'Telefon', light: 'Açık', dark: 'Koyu',
      noComp: 'Henüz thumbnail\'li rakip videosu yok. Bir niş takip et (Niş Takibi) ya da birkaç YouTube kanalı kaydet: videoları ızgarayı doldurur.',
      noImg: 'Burada görmek için soldaki alana bir thumbnail bırak.', yours: 'Senin videon', titleLen: '{n} karakter', titleLong: '{n} karakter: YouTube ana sayfada başlıkları 60–70 karakter civarında keser.',
      off: 'Thumbnail testi Özellikler\'de kapalı.', turnOn: 'Aç', readFail: 'Bu görsel okunamadı.', searchQ: 'Ara', ago: '{t} önce', live: 'az önce'
    }
  };

  function create(env) {
    var h = env.h;
    var st = { img: null, title: '', channel: '', views: null, age: 2, dur: '12:34', src: 'niche', pos: 'random', seed: 1, hl: false, surface: 'home', device: 'desktop', theme: 'light', err: '' };
    try { var saved = JSON.parse(sessionStorage.getItem(STORE) || '{}'); Object.keys(saved).forEach(function (k) { if (k in st) st[k] = saved[k]; }); } catch (e) { /* none */ }
    if (!st.theme || (st.theme !== 'light' && st.theme !== 'dark')) st.theme = root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    function keep() { try { sessionStorage.setItem(STORE, JSON.stringify(st)); } catch (e) { try { var x = Object.assign({}, st, { img: null }); sessionStorage.setItem(STORE, JSON.stringify(x)); } catch (e2) { /* full */ } } }
    function lang() { return F && F.uiLang ? F.uiLang() : 'en'; }
    function L() { return S[lang()] || S.en; }
    function fill(s, o) { return String(s).replace(/\{(\w+)\}/g, function (_, k) { return o[k] != null ? o[k] : ''; }); }
    function loc() { return lang() === 'tr' ? 'tr-TR' : 'en-US'; }
    function num(n) { return n == null ? '' : new Intl.NumberFormat(loc(), { notation: 'compact', maximumFractionDigits: n < 1e6 ? 0 : 1 }).format(n); }
    function ago(t) {
      var s = (Date.now() - t) / 1000;
      var rtf = new Intl.RelativeTimeFormat(loc(), { numeric: 'always' });
      var u = s < 3600 ? ['minute', 60] : s < 86400 ? ['hour', 3600] : s < 86400 * 7 ? ['day', 86400] : s < 86400 * 30 ? ['week', 604800] : s < 86400 * 365 ? ['month', 2629800] : ['year', 31557600];
      return rtf.format(-Math.max(1, Math.round(s / u[1])), u[0]);
    }
    function clock(sec) { sec = Math.round(sec || 0); var m = Math.floor(sec / 60); return (m >= 60 ? Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') : m) + ':' + String(sec % 60).padStart(2, '0'); }
    function rand(seed) { var x = Math.sin(seed) * 10000; return x - Math.floor(x); }

    // ---- competitors: saved videos of the tracked niche (else every saved YouTube channel) ----------
    function sources() {
      var org = env.getOrg();
      var accts = env.accounts();
      var yt = Object.keys(accts).filter(function (u) { return /^yt\//.test(u); });
      var tracked = TR ? TR.desired(org, yt).filter(function (c) { return !c.mine; }).map(function (c) { return c.account_id; }).filter(function (u) { return accts[u]; }) : [];
      var out = [];
      if (tracked.length) out.push({ id: 'niche', label: fill(L().fromNiche, { n: tracked.length }), accts: tracked });
      (org.folders || []).forEach(function (f) {
        var inF = yt.filter(function (u) { return org.accounts[u] && org.accounts[u].folder === f.id; });
        if (inF.length) out.push({ id: 'f:' + f.id, label: fill(L().fromFolder, { f: f.name, n: inF.length }), accts: inF });
      });
      if (yt.length) out.push({ id: 'all', label: fill(L().fromAll, { n: yt.length }), accts: yt });
      return out;
    }
    function competitors(src, type) {
      var accts = env.accounts();
      var vids = [];
      (src ? src.accts : []).forEach(function (u) {
        var a = accts[u];
        (a.posts || []).forEach(function (p) {
          if (!p || !p.thumb || !p.caption || (type === 'short') !== (p.type === 'short')) return;
          vids.push({ id: p.code, title: p.caption, channel: p.ownerName || a.name || u.slice(3), views: p.views, at: p.takenAt, dur: p.duration, thumb: p.thumb, pic: p.ownerPic || a.pic, x: a.medianViews ? (p.views || 0) / a.medianViews : 0 });
        });
      });
      // Recent and strong first (what a viewer's feed is full of), at most 3 per channel.
      vids.sort(function (a, b) { return (b.x * (1 + ((b.at || 0) > Date.now() - 365 * 864e5)) - a.x * (1 + ((a.at || 0) > Date.now() - 365 * 864e5))); });
      var per = {};
      var pick = vids.filter(function (v) { per[v.channel] = (per[v.channel] || 0) + 1; return per[v.channel] <= 3; }).slice(0, 23);
      // Shuffle by the seed so "Shuffle" gives another order.
      return pick.map(function (v, i) { return { v: v, r: rand(st.seed * 97 + i) }; }).sort(function (a, b) { return a.r - b.r; }).map(function (x) { return x.v; });
    }
    function mine() {
      // C11: the default count is written the way YouTube writes it in this language (1,2 B / 1.2K).
      return { mine: true, title: st.title || L().titlePh, channel: st.channel || (myChannel() || 'Hands on Excel'), viewsText: st.views || num(1200), ageText: st.age, dur: st.dur, thumb: st.img };
    }
    function myChannel() {
      var org = env.getOrg();
      var t = org.tracked || {};
      var k = Object.keys(t).filter(function (u) { return t[u] && t[u].mine; })[0];
      if (!k) return null;
      var a = env.accounts()[k];
      return (t[k].name) || (a && a.name) || k.slice(3);
    }
    function withMine(list, n) {
      var m = mine();
      var at = st.pos === 'first' ? 0 : Math.floor(rand(st.seed * 13) * Math.min(n, list.length + 1));
      var out = list.slice(0, n - 1);
      out.splice(Math.min(at, out.length), 0, m);
      return out;
    }

    // ---- the mock --------------------------------------------------------------------------------
    function avatar(v) {
      var el = h('span', { class: 'yt-av', 'aria-hidden': 'true' });
      var letter = String(v.channel || '?').replace(/^@/, '').charAt(0).toUpperCase();
      if (v.pic && env.loadImage) { var im = h('img', { alt: '' }); env.loadImage(im, v.pic); im.addEventListener('error', function () { im.remove(); el.textContent = letter; }); el.appendChild(im); }
      else el.textContent = letter;
      return el;
    }
    function thumbBox(v) {
      var t = h('div', { class: 'yt-th' });
      if (v.mine) {
        if (v.thumb) t.appendChild(h('img', { alt: '', src: v.thumb }));
        else t.appendChild(h('span', { class: 'yt-th-none', text: L().noImg }));
      } else {
        var im = h('img', { alt: '', loading: 'lazy' });
        im.addEventListener('error', function () { im.remove(); });
        if (env.loadImage) env.loadImage(im, v.thumb); else im.src = v.thumb;
        t.appendChild(im);
      }
      var d = v.mine ? v.dur : v.dur ? clock(v.dur) : '';
      if (d) t.appendChild(h('span', { class: 'yt-dur', text: d }));
      return t;
    }
    function metaLine(v) {
      if (v.mine) return [fill(L().views, { n: v.viewsText }), fill(L().ago, { t: v.ageText + (lang() === 'tr' ? ' saat' : ' hours') })];
      return [v.views != null ? fill(L().views, { n: num(v.views) }) : null, v.at ? ago(v.at) : null].filter(Boolean);
    }
    function homeCard(v) {
      return h('div', { class: 'yt-card' + (v.mine && st.hl ? ' is-mine' : ''), title: v.mine ? L().yours : null },
        thumbBox(v),
        h('div', { class: 'yt-info' }, avatar(v),
          h('div', { class: 'yt-txt' }, h('div', { class: 'yt-title', text: v.title }), h('div', { class: 'yt-ch', text: v.channel }), h('div', { class: 'yt-meta' }, metaLine(v).map(function (x) { return h('span', { text: x }); })))));
    }
    function searchRow(v) {
      return h('div', { class: 'yt-srow' + (v.mine && st.hl ? ' is-mine' : '') },
        thumbBox(v),
        h('div', { class: 'yt-stxt' }, h('div', { class: 'yt-title', text: v.title }), h('div', { class: 'yt-meta' }, metaLine(v).map(function (x) { return h('span', { text: x }); })),
          h('div', { class: 'yt-sch' }, avatar(v), h('span', { text: v.channel })),
          h('div', { class: 'yt-desc', text: v.mine ? (st.title || '') : '' })));
    }
    function mock(list) {
      var mob = st.device === 'mobile';
      var frame = h('div', { class: 'yt-mock ' + (st.theme === 'dark' ? 'is-dark' : 'is-light') + (mob ? ' is-mobile' : ' is-desktop'), role: 'img', 'aria-label': (st.surface === 'home' ? L().home : L().search) + ' · ' + (mob ? L().mobile : L().desktop) + ' · ' + (st.theme === 'dark' ? L().dark : L().light) });
      frame.appendChild(h('div', { class: 'yt-top' }, h('span', { class: 'yt-logo' }, h('i'), 'YouTube'),
        h('span', { class: 'yt-q', text: st.surface === 'search' ? (st.title.split(/\s+/).slice(0, 3).join(' ') || L().searchQ) : L().searchQ }), h('span', { class: 'yt-me' })));
      if (st.surface === 'home') {
        frame.appendChild(h('div', { class: 'yt-chips' }, L().chips.map(function (c, i) { return h('span', { class: i ? '' : 'on', text: c }); })));
        frame.appendChild(h('div', { class: 'yt-grid' }, withMine(list, mob ? 6 : 12).map(homeCard)));
      } else {
        frame.appendChild(h('div', { class: mob ? 'yt-grid' : 'yt-slist' }, withMine(list, mob ? 6 : 8).map(mob ? homeCard : searchRow)));
      }
      return frame;
    }

    function readFile(file) {
      if (!file || !/^image\//.test(file.type)) { st.err = L().readFail; env.rerender(); return; }
      var r = new FileReader();
      r.onload = function () { st.img = r.result; st.err = ''; keep(); env.rerender(); };
      r.onerror = function () { st.err = L().readFail; env.rerender(); };
      r.readAsDataURL(file);
    }

    function seg(key, opts) {
      return h('div', { class: 'seg tt-seg', role: 'group' }, opts.map(function (o) {
        return h('button', { type: 'button', 'aria-pressed': st[key] === o[0] ? 'true' : 'false', onclick: function () { st[key] = o[0]; keep(); env.rerender(); } }, o[1]);
      }));
    }

    function render(main) {
      main.textContent = '';
      var on = !F || F.isOn('thumb-preview');
      main.appendChild(h('div', { class: 'view-head' }, h('h1', { text: L().title }), h('span', { class: 'sub', text: L().sub })));
      if (!on) main.appendChild(h('div', { class: 'kc-banner-info sw-banner' }, h('span', { text: L().off }), h('button', { class: 'btn', type: 'button', onclick: function () { F.set('thumb-preview', true).then(env.rerender); } }, L().turnOn)));
      // Controls
      var fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: function (e) { readFile(e.target.files[0]); } });
      var drop = h('div', { class: 'tt-drop' + (st.img ? ' has-img' : ''), tabindex: '0', role: 'button', 'aria-label': L().pick, onclick: function () { fileIn.click(); }, onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } } });
      if (st.img) drop.appendChild(h('img', { src: st.img, alt: '' }));
      else drop.appendChild(h('div', { class: 'tt-drop-in' }, h('span', { class: 'stair', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('b', { text: L().drop }), h('span', { class: 'muted', text: L().dropOr + ' ' }), h('span', { class: 'tt-pick', text: L().pick }), h('small', { class: 'muted', text: L().dropHint })));
      ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); }); });
      ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); }); });
      drop.addEventListener('drop', function (e) { var f = e.dataTransfer && e.dataTransfer.files[0]; if (f) readFile(f); });
      var title = h('input', { class: 'sw-in', type: 'text', value: st.title, placeholder: L().titlePh, maxlength: '100', 'aria-label': L().titleL });
      var tlen = h('small', { class: 'muted tt-len' });
      function lenNote() { var n = title.value.length; tlen.textContent = n > 70 ? fill(L().titleLong, { n: n }) : fill(L().titleLen, { n: n }); tlen.classList.toggle('is-warn', n > 70); }
      lenNote();
      var mockHost = h('div', { class: 'tt-stage' });
      title.addEventListener('input', function () { st.title = title.value; lenNote(); keep(); paintMock(); });
      function field(label, el) { return h('label', { class: 'sw-lbl' }, label, el); }
      function small(key, label, w) { var i = h('input', { class: 'sw-in', type: 'text', value: st[key] == null ? '' : String(st[key]), placeholder: key === 'views' ? num(1200) : null, style: 'width:' + w, 'aria-label': label }); i.addEventListener('input', function () { st[key] = i.value; keep(); paintMock(); }); return field(label, i); }
      var srcs = sources();
      if (!srcs.some(function (s) { return s.id === st.src; })) st.src = srcs[0] ? srcs[0].id : 'all';
      var srcSel = h('select', { class: 'sw-in', 'aria-label': L().from }, srcs.map(function (s) { return h('option', { value: s.id, text: s.label, selected: s.id === st.src }); }));
      srcSel.addEventListener('change', function () { st.src = srcSel.value; keep(); paintMock(); });
      var chan = h('input', { class: 'sw-in', type: 'text', value: st.channel || myChannel() || '', placeholder: 'Hands on Excel', 'aria-label': L().channelL });
      chan.addEventListener('input', function () { st.channel = chan.value; keep(); paintMock(); });
      var controls = h('section', { class: 'm-card tt-controls' },
        drop, fileIn,
        st.img ? h('div', { class: 'tt-imgacts' }, h('button', { class: 'btn', type: 'button', onclick: function () { fileIn.click(); } }, L().replace),
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: function () { st.img = null; keep(); env.rerender(); } }, L().clearImg)) : null,
        st.err ? h('p', { class: 'sw-err', role: 'alert', text: st.err }) : null,
        field(L().titleL, title), tlen,
        field(L().channelL, chan),
        h('div', { class: 'tt-row3' }, small('views', L().viewsL, '100%'), small('age', L().ageL, '100%'), small('dur', L().durL, '100%')),
        field(L().from, srcSel),
        h('div', { class: 'tt-row' }, h('span', { class: 'muted', text: L().position }), seg('pos', [['first', L().posFirst], ['random', L().posRandom]]),
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: function () { st.seed = (st.seed % 997) + 1; keep(); paintMock(); } }, '↻ ' + L().shuffle)),
        h('label', { class: 'sw-chk' }, h('input', { type: 'checkbox', checked: st.hl, onchange: function (e) { st.hl = e.target.checked; keep(); paintMock(); } }), L().highlight));
      var bar = h('div', { class: 'tt-bar' }, seg('surface', [['home', L().home], ['search', L().search]]), seg('device', [['desktop', L().desktop], ['mobile', L().mobile]]), seg('theme', [['light', L().light], ['dark', L().dark]]));
      main.appendChild(h('div', { class: 'tt-wrap' }, controls, h('div', { class: 'tt-preview' }, bar, mockHost)));
      function paintMock() {
        mockHost.textContent = '';
        var src = sources().filter(function (s) { return s.id === st.src; })[0];
        var list = competitors(src, 'video');
        if (!list.length) mockHost.appendChild(h('p', { class: 'nv-empty' }, h('span', { class: 'nv-empty-px', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('span', { text: L().noComp })));
        mockHost.appendChild(mock(list));
      }
      paintMock();
    }

    return { render: render, title: function () { return L().title; }, navLabel: function () { return L().nav; } };
  }

  root.OpenOutlierThumbTestView = { create: create };
})(typeof self !== 'undefined' ? self : this);
