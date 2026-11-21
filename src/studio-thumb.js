// OpenOutlier – YouTube Studio (studio.youtube.com), phase 4 (docs/youtube-niche-plan.md 4):
//
//   thumb-compress  When you pick (or drop) a thumbnail over YouTube's 2 MB limit, Studio would only
//                   say "too large". OpenOutlier steps in first and offers to shrink it in this tab with
//                   a canvas (JPEG, falling quality, then smaller sizes, never under 1280 px wide), shows
//                   before / after, and hands the smaller file to Studio's own file field. OpenOutlier
//                   never uploads anything: Studio does, when you save the video as always.
//   thumb-preview   a small link next to Studio's thumbnail section to the Library's thumbnail tester.
//
// Runs only on studio.youtube.com (manifest: a narrow match). Turning a switch off removes its part.
(function () {
  'use strict';
  if (window.top !== window || window.__openoutlierStudioThumb) return;
  window.__openoutlierStudioThumb = true;
  var FT = self.OpenOutlierFeatures;
  var CT = self.OpenOutlierContentTools;
  if (!FT || !CT) return;

  var S = {
    en: {
      title: 'Thumbnail over 2 MB', body: '{name} is {size}. YouTube accepts thumbnails up to 2 MB.', compress: 'Compress to fit', keep: 'Use original', cancel: 'Cancel',
      working: 'Compressing in this tab…', done: '{a} → {b} · {w}×{h} JPEG, quality {q}%', use: 'Use compressed', download: 'Download', fail: 'Couldn\'t get it under 2 MB. Try a smaller or simpler image.',
      readFail: 'Couldn\'t read this image: {e}', never: 'OpenOutlier never uploads anything: Studio uploads the file when you save, as always.',
      before: 'Original', after: 'Compressed', handed: 'Handed the compressed file to Studio.', tester: 'Test it next to competitors', testerTip: 'OpenOutlier\'s thumbnail & title tester (Library)'
    },
    tr: {
      title: 'Thumbnail 2 MB\'tan büyük', body: '{name} {size}. YouTube en fazla 2 MB\'lık thumbnail kabul ediyor.', compress: 'Sığacak kadar sıkıştır', keep: 'Orijinali kullan', cancel: 'Vazgeç',
      working: 'Bu sekmede sıkıştırılıyor…', done: '{a} → {b} · {w}×{h} JPEG, kalite %{q}', use: 'Sıkıştırılmışı kullan', download: 'İndir', fail: '2 MB\'ın altına indirilemedi. Daha küçük ya da sade bir görsel dene.',
      readFail: 'Bu görsel okunamadı: {e}', never: 'OpenOutlier hiçbir şey yüklemez: dosyayı her zamanki gibi kaydettiğinde Studio yükler.',
      before: 'Orijinal', after: 'Sıkıştırılmış', handed: 'Sıkıştırılmış dosya Studio\'ya verildi.', tester: 'Rakiplerin yanında dene', testerTip: 'OpenOutlier\'ın thumbnail ve başlık testi (Library)'
    }
  };
  function lang() { return FT.uiLang() === 'tr' ? 'tr' : 'en'; }
  function T() { return S[lang()]; }
  function fill(s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o[k] != null ? o[k] : m; }); }
  function dark() { return document.documentElement.hasAttribute('dark') || /dark/i.test(document.documentElement.getAttribute('theme') || ''); }
  function h(tag, attrs) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (k === 'text') e.textContent = v;
      else if (k === 'class') e.className = v;
      else e.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) { var c = arguments[i]; if (c != null && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
    return e;
  }

  // ---- Studio's look (its dialogs: white / #282828, 8px radius, blue primary button) -------------------
  var CSS = [
    ':host{all:initial}',
    '.scrim{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px}',
    '.dlg{width:520px;max-width:100%;max-height:calc(100vh - 32px);overflow:auto;border-radius:8px;background:#fff;color:#0d0d0d;font:400 14px/20px Roboto,Arial,sans-serif;box-shadow:0 8px 40px rgba(0,0,0,.35)}',
    '.dk .dlg{background:#282828;color:#f1f1f1}',
    '.hd{display:flex;align-items:center;gap:10px;padding:20px 24px 4px}',
    '.hd h2{margin:0;font:500 20px/28px "YouTube Sans",Roboto,Arial,sans-serif}',
    '.mk{width:18px;height:18px;flex:none}',
    '.bd{padding:8px 24px 4px}',
    '.bd p{margin:0 0 10px}',
    '.muted{color:#606060;font-size:12px;line-height:16px}',
    '.dk .muted{color:#aaa}',
    '.cmp{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}',
    '.cmp figure{margin:0}',
    '.cmp img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:6px;background:#eee}',
    '.dk .cmp img{background:#3a3a3a}',
    '.cmp figcaption{font-size:12px;color:#606060;margin-top:4px;font-variant-numeric:tabular-nums}',
    '.dk .cmp figcaption{color:#aaa}',
    '.res{font-weight:500;font-variant-numeric:tabular-nums}',
    '.res::before{content:"";display:inline-block;width:7px;height:7px;margin:0 8px 1px 0;background:#C8FF2E;box-shadow:0 0 0 1px #0B0E1A}',
    '.err{color:#c00}.dk .err{color:#ff7c7c}',
    '.ft{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;padding:12px 24px 20px}',
    'button{font:500 14px/36px Roboto,Arial,sans-serif;height:36px;padding:0 16px;border-radius:18px;border:0;cursor:pointer;background:transparent;color:#065fd4}',
    '.dk button{color:#3ea6ff}',
    'button:hover{background:rgba(6,95,212,.08)}',
    'button.primary{background:#065fd4;color:#fff}.dk button.primary{background:#3ea6ff;color:#0d0d0d}',
    'button.primary:hover{background:#0556bf}',
    'button:focus-visible{outline:2px solid #065fd4;outline-offset:2px}',
    'button[disabled]{opacity:.5;cursor:default}',
    '.bar{height:4px;border-radius:2px;background:#e5e5e5;overflow:hidden;margin:10px 0}',
    '.bar i{display:block;height:100%;width:40%;background:#065fd4;animation:oo-run 1s linear infinite}',
    '@keyframes oo-run{from{transform:translateX(-100%)}to{transform:translateX(260%)}}',
    '@media (prefers-reduced-motion:reduce){.bar i{animation:none;width:100%}}'
  ].join('\n');
  var MARK = '<svg class="mk" viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges"><path fill="currentColor" d="M4 2h6v2H4zM2 4h2v8H2zM10 4h2v8h-2zM4 12h6v2H4z"/><path fill="#C8FF2E" d="M12 2h2v2h-2zM14 0h2v2h-2z"/></svg>';

  // ---- compressing ------------------------------------------------------------------------------------
  function toBlob(canvas, q) { return new Promise(function (r) { canvas.toBlob(function (b) { r(b); }, 'image/jpeg', q); }); }
  async function compress(file) {
    var bmp = await createImageBitmap(file);
    var plan = CT.thumbPlan(bmp.width, bmp.height);
    var c = document.createElement('canvas');
    for (var i = 0; i < plan.length; i++) {
      var s = plan[i];
      if (c.width !== s.w || c.height !== s.h) {
        c.width = s.w;
        c.height = s.h;
        var g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        // JPEG has no transparency: a PNG's clear parts become white, as Studio would show them.
        g.fillStyle = '#fff';
        g.fillRect(0, 0, s.w, s.h);
        g.drawImage(bmp, 0, 0, s.w, s.h);
      }
      var b = await toBlob(c, s.q);
      if (b && b.size <= CT.THUMB_TARGET) { if (bmp.close) bmp.close(); return { blob: b, w: s.w, h: s.h, q: s.q }; }
    }
    if (bmp.close) bmp.close();
    return null;
  }
  function outName(name) { return String(name || 'thumbnail').replace(/\.[a-z0-9]+$/i, '') + '-2mb.jpg'; }

  // ---- the prompt --------------------------------------------------------------------------------------
  var open = null;
  function prompt(file, input) {
    if (open) open.close();
    var L = T();
    var lg = lang();
    var host = document.createElement('div');
    host.setAttribute('data-openoutlier', 'thumb-compress');
    var root = host.attachShadow({ mode: 'open' });
    host.setAttribute('lang', lg);
    root.innerHTML = '<style>' + CSS + '</style>';
    var origUrl = URL.createObjectURL(file);
    var made = null;
    var madeUrl = null;
    function close() {
      host.remove();
      URL.revokeObjectURL(origUrl);
      if (madeUrl) URL.revokeObjectURL(madeUrl);
      document.removeEventListener('keydown', onKey, true);
      open = null;
    }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
    document.addEventListener('keydown', onKey, true);
    var hd = h('div', { class: 'hd' });
    hd.innerHTML = MARK;
    hd.appendChild(h('h2', { id: 'oo-tc-t', text: L.title }));
    var bd = h('div', { class: 'bd' }, h('p', { text: fill(L.body, { name: file.name, size: CT.fileSize(file.size, lg) }) }));
    var cmp = h('div', { class: 'cmp' }, h('figure', {}, h('img', { src: origUrl, alt: L.before }), h('figcaption', { text: L.before + ' · ' + CT.fileSize(file.size, lg) })));
    bd.appendChild(cmp);
    var status = h('p', { role: 'status', 'aria-live': 'polite' });
    bd.appendChild(status);
    bd.appendChild(h('p', { class: 'muted', text: L.never }));
    var ft = h('div', { class: 'ft' });
    var dlg = h('div', { class: 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'oo-tc-t' }, hd, bd, ft);
    var scrim = h('div', { class: 'scrim' + (dark() ? ' dk' : '') }, dlg);
    scrim.addEventListener('mousedown', function (e) { if (e.target === scrim) close(); });
    root.appendChild(scrim);
    function buttons(list) { ft.textContent = ''; list.forEach(function (b) { ft.appendChild(b); }); var p = ft.querySelector('.primary'); if (p) p.focus(); }
    var cancel = h('button', { type: 'button', onclick: close }, L.cancel);
    var keep = h('button', { type: 'button', onclick: function () { close(); hand(input, file); } }, L.keep);
    var go = h('button', { class: 'primary', type: 'button', onclick: run }, L.compress);
    buttons([cancel, keep, go]);
    function run() {
      status.className = '';
      status.textContent = L.working;
      status.appendChild(h('div', { class: 'bar' }, h('i')));
      buttons([cancel, keep, h('button', { class: 'primary', type: 'button', disabled: true }, L.compress)]);
      compress(file).then(function (r) {
        if (!r) { status.className = 'err'; status.textContent = L.fail; buttons([cancel, keep]); return; }
        made = new File([r.blob], outName(file.name), { type: 'image/jpeg', lastModified: Date.now() });
        madeUrl = URL.createObjectURL(made);
        cmp.appendChild(h('figure', {}, h('img', { src: madeUrl, alt: L.after }), h('figcaption', { text: L.after + ' · ' + CT.fileSize(made.size, lg) })));
        status.className = 'res';
        status.textContent = fill(L.done, { a: CT.fileSize(file.size, lg), b: CT.fileSize(made.size, lg), w: r.w, h: r.h, q: Math.round(r.q * 100) });
        window.__ooThumbResult = { size: made.size, w: r.w, h: r.h, q: r.q };
        buttons([cancel, h('button', { type: 'button', onclick: function () { download(made); } }, L.download), h('button', { class: 'primary', type: 'button', onclick: function () { close(); hand(input, made); } }, L.use)]);
      }, function (e) { status.className = 'err'; status.textContent = fill(L.readFail, { e: String(e && e.message || e) }); buttons([cancel, keep]); });
    }
    document.documentElement.appendChild(host);
    open = { close: close, host: host };
  }
  function download(file) {
    var url = URL.createObjectURL(file);
    var a = h('a', { href: url, download: file.name, style: 'display:none' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }
  /** Give Studio's own file field this file and let its change handler run (Studio uploads on save). */
  function hand(input, file) {
    if (!input) return;
    try {
      var dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
    } catch (e) { return; }
    input.__ooPass = true;
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    setTimeout(function () { input.__ooPass = false; }, 0);
    window.__ooThumbHanded = { name: file.name, size: file.size };
  }

  // ---- catching the file before Studio does ---------------------------------------------------------------
  function isThumbInput(el) {
    return el && el.tagName === 'INPUT' && el.type === 'file' && (/image/i.test(el.accept || '') || !!(el.closest && el.closest('[class*="thumbnail" i], ytcp-thumbnail-uploader, ytcp-thumbnails-compact-editor-uploader')));
  }
  function bigImage(f) { return f && /^image\/(jpeg|png|gif|bmp|webp)$/i.test(f.type) && f.size > CT.THUMB_LIMIT; }
  function onChange(e) {
    if (!FT.isOn('thumb-compress')) return;
    var t = e.composedPath ? e.composedPath()[0] : e.target;
    if (!isThumbInput(t) || t.__ooPass) return;
    var f = t.files && t.files[0];
    if (!bigImage(f)) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    prompt(f, t);
  }
  function onDrop(e) {
    if (!FT.isOn('thumb-compress')) return;
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!bigImage(f)) return;
    var path = e.composedPath ? e.composedPath() : [];
    var zone = null;
    for (var i = 0; i < path.length; i++) { var el = path[i]; if (el && el.querySelector && el.querySelector('input[type="file"]') && /thumbnail/i.test((el.tagName || '') + ' ' + (el.className || ''))) { zone = el; break; } }
    if (!zone) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    prompt(f, zone.querySelector('input[type="file"]'));
  }
  var hooked = [];
  function hook(root) {
    if (hooked.indexOf(root) !== -1) return;
    hooked.push(root);
    root.addEventListener('change', onChange, true);
    root.addEventListener('drop', onDrop, true);
  }
  hook(document);
  // A change event doesn't leave a shadow root: listen inside the open ones that hold a file field.
  function scanShadows() {
    if (!FT.isOn('thumb-compress')) return;
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var sr = all[i].shadowRoot;
      if (sr && sr.querySelector('input[type="file"]')) hook(sr);
    }
  }

  // ---- thumb-preview: a link beside Studio's thumbnail section -----------------------------------------------
  var link = null;
  function testerLink() {
    var on = FT.isOn('thumb-preview');
    var sec = on ? document.querySelector('ytcp-thumbnails-compact-editor, ytcp-video-thumbnail-editor, #still-picker, [data-oo-studio-thumbs]') : null;
    if (!sec) { if (link) { link.remove(); link = null; } return; }
    var L = T();
    if (!link) {
      link = document.createElement('div');
      link.setAttribute('data-openoutlier', 'thumb-tester-link');
      var r = link.attachShadow({ mode: 'open' });
      link.setAttribute('lang', lang());
      r.innerHTML = '<style>:host{display:block;margin:8px 0 0}a{display:inline-flex;align-items:center;gap:6px;font:500 13px/20px Roboto,Arial,sans-serif;color:#065fd4;text-decoration:none;cursor:pointer}' +
        ':host-context(html[dark]) a{color:#3ea6ff}a:hover{text-decoration:underline}.mk{width:14px;height:14px;color:currentColor}</style><a role="link" tabindex="0"></a>';
      var a = r.querySelector('a');
      var open = function () { try { chrome.runtime.sendMessage({ type: 'reelscope:open-dashboard', hash: '#/thumb-test' }); } catch (e) { /* extension reloaded */ } };
      a.addEventListener('click', open);
      a.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(); });
    }
    var anchor = link.shadowRoot.querySelector('a');
    if (anchor.textContent !== L.tester) { anchor.innerHTML = MARK; anchor.appendChild(document.createTextNode(L.tester)); anchor.title = L.testerTip; }
    if (link.previousSibling !== sec && sec.parentNode) sec.after(link);
  }

  FT.ready.then(function () {
    scanShadows();
    testerLink();
    FT.onChange(function () { testerLink(); if (!FT.isOn('thumb-compress') && open) open.close(); });
    setInterval(function () { scanShadows(); testerLink(); }, 2500);
  });
  self.OpenOutlierStudioThumb = { compress: compress, prompt: prompt };
})();
