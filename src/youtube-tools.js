// OpenOutlier – phase 4's content tools on youtube.com (docs/youtube-niche-plan.md 4):
//
//   transcript-tools  watch page: read YouTube's own transcript panel (opened and closed again if
//                     needed), else the captions the player loaded (CC), else the caption track the
//                     player response lists; copy (plain / with timestamps), .txt / .srt / .md, and
//                     "Send to Claude" (a ready prompt; the MCP tool get_transcript does the same).
//   comment-tools     watch page and Shorts: the comments YouTube's /next responses carry as you
//                     scroll; filters (questions, a phrase, hide profanity), sort by likes, CSV /
//                     JSON, "Analyse with Claude"; sent to the bridge for get_comments (kept 7 days).
//   frame-capture     the toolbar's camera: copy the current frame as PNG or download it.
//   swipe-save        save the video / Short to the swipe file (rs:org.swipe): folder, note, tags and
//                     a clip (start / end from the playhead).
//
// Watch page: a row of YouTube-style chips under phase 3's watch card; one panel opens under it.
// Shorts and the toolbar: buttons in the OpenOutlier toolbar (src/overlay.js) open a popover.
// Every part follows its feature switch and goes away the moment it is turned off.
(function () {
  'use strict';
  if (window.top !== window || window.__openoutlierYTTools) return;
  window.__openoutlierYTTools = true;

  var Y = self.OpenOutlierYouTube;
  var I = self.OpenOutlierInsights;
  var FT = self.OpenOutlierFeatures;
  var D = self.OpenOutlierYTData;
  var CT = self.OpenOutlierContentTools;
  var SW = self.OpenOutlierSwipe;
  if (!Y || !I || !FT || !D || !CT || !SW) return;
  function Lib() { return self.OpenOutlierYTLib || null; }

  var S = {
    en: {
      transcript: 'Transcript', comments: 'Comments', save: 'Save', saved: 'Saved', tools: 'OpenOutlier tools',
      tLoading: 'Reading YouTube\'s transcript…', tNone: 'This video has no transcript YouTube will show.', tRetry: 'Try again',
      tFromPanel: 'From YouTube\'s transcript', tFromCC: 'From the captions the player loaded', tFromTrack: 'From the caption track ({lang})', auto: 'auto-generated',
      segs: '{n} lines', copy: 'Copy', copyText: 'Text', copyTs: 'With timestamps', download: 'Download', toClaude: 'Send to Claude',
      copied: 'Copied.', copyFail: 'The browser blocked the clipboard. Click again, or download it instead.', copiedPrompt: 'Copied a prompt with the transcript ({n} characters). Paste it into Claude. With OpenOutlier\'s MCP server connected, Claude can also fetch it with get_transcript.',
      filter: 'Search the transcript', noMatch: 'No line contains that.', jump: 'Jump to {t}',
      cCount: '{n} comments read', cOf: '{n} of {total} comments read', cNone: 'No comments read yet. Scroll down to YouTube\'s comments: OpenOutlier reads them as they load.',
      cNoneShorts: 'No comments read yet. Open the Short\'s comments: OpenOutlier reads them as they load.',
      cMore: 'Scroll further down YouTube\'s comments to read more.', questions: 'Questions', hideProfanity: 'Hide profanity', sortTop: 'Top', sortLikes: 'Most liked',
      phrase: 'Words or phrases (comma = any)', cMatch: '{n} shown', cHidden: '{n} hidden as profane', cEmpty: 'No comment matches these filters.',
      pinned: 'Pinned', hearted: 'Hearted by the creator', creator: 'Creator', question: 'Question', likes: '{n} likes', reply: 'Reply',
      analyse: 'Analyse with Claude', copiedComments: 'Copied a prompt with {n} comments. Paste it into Claude. With the MCP server connected, Claude can fetch more with get_comments.',
      exportCsv: 'CSV', exportJson: 'JSON', cKept: 'Sent to the OpenOutlier bridge on this Mac for get_comments; kept 7 days.', cLocal: 'Kept in this browser for 3 days. With the OpenOutlier bridge running, Claude can read them with get_comments.',
      frame: 'Capture frame', frameCopy: 'Copy frame', frameDownload: 'Download PNG', frameCopied: 'Frame at {t} copied.', frameSaved: 'Saved {name}.',
      frameTainted: 'The browser won\'t let extensions read this video\'s pixels (it comes from another site). Download the cover instead.',
      frameNone: 'No frame yet: start the video first.', frameFail: 'Couldn\'t capture the frame: {e}', clipboardFail: 'The clipboard refused the image; downloaded it instead.',
      swipeTitle: 'Save to swipe file', folder: 'Folder', noFolder: 'Swipe file (no folder)', newFolder: 'New folder…', newFolderName: 'Folder name',
      clip: 'Clip', clipOn: 'Save a clip', start: 'Start', end: 'End', setNow: 'Now ({t})', note: 'Note', notePh: 'What stands out: hook, thumbnail, pacing…',
      tags: 'Tags', tagsPh: 'hook, thumbnail, b-roll', saveBtn: 'Save', update: 'Update', remove: 'Remove', savedTo: 'Saved to {where}.', removed: 'Removed from the swipe file.',
      openLibrary: 'Open the swipe file', badClip: 'Clip end must be after its start.', close: 'Close'
    },
    tr: {
      transcript: 'Transcript', comments: 'Yorumlar', save: 'Kaydet', saved: 'Kaydedildi', tools: 'OpenOutlier araçları',
      tLoading: 'YouTube\'un transcript\'i okunuyor…', tNone: 'Bu videonun YouTube\'da gösterilen bir transcript\'i yok.', tRetry: 'Tekrar dene',
      tFromPanel: 'YouTube\'un transcript\'inden', tFromCC: 'Oynatıcının yüklediği altyazıdan', tFromTrack: 'Altyazı kanalından ({lang})', auto: 'otomatik',
      segs: '{n} satır', copy: 'Kopyala', copyText: 'Metin', copyTs: 'Zaman damgalı', download: 'İndir', toClaude: 'Claude\'a gönder',
      copied: 'Kopyalandı.', copyFail: 'Tarayıcı panoya yazmayı engelledi. Tekrar tıkla ya da dosya olarak indir.', copiedPrompt: 'Transcript\'li bir istem kopyalandı ({n} karakter). Claude\'a yapıştır. OpenOutlier MCP sunucusu bağlıysa Claude get_transcript ile de alabilir.',
      filter: 'Transcript\'te ara', noMatch: 'Bunu içeren satır yok.', jump: '{t} anına git',
      cCount: '{n} yorum okundu', cOf: '{total} yorumdan {n} tanesi okundu', cNone: 'Henüz yorum okunmadı. Aşağı, YouTube\'un yorumlarına in: OpenOutlier onları yüklendikçe okur.',
      cNoneShorts: 'Henüz yorum okunmadı. Short\'un yorumlarını aç: OpenOutlier onları yüklendikçe okur.',
      cMore: 'Daha fazlası için YouTube\'un yorumlarında aşağı kaydır.', questions: 'Sorular', hideProfanity: 'Küfürü gizle', sortTop: 'Öne çıkan', sortLikes: 'En çok beğenilen',
      phrase: 'Kelime ya da ifade (virgül = herhangi biri)', cMatch: '{n} gösteriliyor', cHidden: '{n} tanesi küfür diye gizlendi', cEmpty: 'Bu filtrelere uyan yorum yok.',
      pinned: 'Sabitlendi', hearted: 'Kanal sahibi kalp bıraktı', creator: 'Kanal sahibi', question: 'Soru', likes: '{n} beğeni', reply: 'Yanıt',
      analyse: 'Claude ile analiz', copiedComments: '{n} yorumlu bir istem kopyalandı. Claude\'a yapıştır. MCP sunucusu bağlıysa Claude get_comments ile daha fazlasını alabilir.',
      exportCsv: 'CSV', exportJson: 'JSON', cKept: 'get_comments için bu Mac\'teki OpenOutlier bridge\'ine gönderilir; 7 gün tutulur.', cLocal: 'Bu tarayıcıda 3 gün tutulur. OpenOutlier bridge çalışırken Claude get_comments ile okuyabilir.',
      frame: 'Kareyi yakala', frameCopy: 'Kareyi kopyala', frameDownload: 'PNG indir', frameCopied: '{t} anındaki kare kopyalandı.', frameSaved: '{name} kaydedildi.',
      frameTainted: 'Tarayıcı bu videonun piksellerini eklentilere vermiyor (başka bir siteden geliyor). Onun yerine kapak görselini indir.',
      frameNone: 'Henüz kare yok: önce videoyu başlat.', frameFail: 'Kare yakalanamadı: {e}', clipboardFail: 'Pano görseli kabul etmedi; onun yerine indirildi.',
      swipeTitle: 'Swipe file\'a kaydet', folder: 'Klasör', noFolder: 'Swipe file (klasörsüz)', newFolder: 'Yeni klasör…', newFolderName: 'Klasör adı',
      clip: 'Klip', clipOn: 'Klip olarak kaydet', start: 'Başlangıç', end: 'Bitiş', setNow: 'Şimdi ({t})', note: 'Not', notePh: 'Öne çıkan ne: hook, thumbnail, tempo…',
      tags: 'Etiketler', tagsPh: 'hook, thumbnail, b-roll', saveBtn: 'Kaydet', update: 'Güncelle', remove: 'Kaldır', savedTo: '{where} içine kaydedildi.', removed: 'Swipe file\'dan kaldırıldı.',
      openLibrary: 'Swipe file\'ı aç', badClip: 'Klibin bitişi başlangıcından sonra olmalı.', close: 'Kapat'
    }
  };
  function lang() { return D.lang(); }
  function T() { return S[lang()]; }
  function fill(s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o[k] != null ? o[k] : m; }); }
  function ctx() { return Y.pageContext(location.pathname, location.search); }
  function dataLang() { return /^tr/i.test(document.documentElement.lang || '') ? 'tr' : 'en'; }

  // ---- look: YouTube's surfaces and chips, the brand's blue for the one primary action ------------
  var CSS = [
    // In the watch page's OpenOutlier row: the chips and the open panel become items of that row (the panel on a line of its own).
    ':host(.in-row){display:contents}',
    ':host(.in-row) .box{flex:1 1 100%;min-width:0}',
    ':host(.in-row) .box:empty{display:none}',
    ':host(.in-row) .panel{margin-top:0}',
    ':host{display:block;font:400 14px/20px Roboto,Arial,sans-serif;color:#0f0f0f;--surf:rgba(0,0,0,.05);--surf2:rgba(0,0,0,.1);--line:rgba(0,0,0,.1);--muted:#606060;--chip:rgba(0,0,0,.05);--chip-h:rgba(0,0,0,.1);',
    '--on-bg:#0f0f0f;--on-fg:#fff;--link:#065fd4;--blue:#1E3BFF;--ink:#0B0E1A;--lime:#C8FF2E;--field:#fff;--hl:rgba(30,59,255,.12)}',
    ':host-context(html[dark]){color:#f1f1f1;--surf:rgba(255,255,255,.1);--surf2:rgba(255,255,255,.16);--line:rgba(255,255,255,.16);--muted:#aaa;--chip:rgba(255,255,255,.1);--chip-h:rgba(255,255,255,.2);--on-bg:#f1f1f1;--on-fg:#0f0f0f;--link:#3ea6ff;--field:#121212;--hl:rgba(62,166,255,.18)}',
    '*{box-sizing:border-box}',
    'button,input,select,textarea{font:inherit;color:inherit}',
    '.row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}',
    '.chip{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:0;border-radius:8px;background:var(--chip);font-weight:500;font-size:14px;cursor:pointer;white-space:nowrap}',
    '.chip:hover{background:var(--chip-h)}',
    '.chip[aria-pressed="true"],.chip[aria-expanded="true"]{background:var(--on-bg);color:var(--on-fg)}',
    '.chip svg{width:18px;height:18px;flex:none}',
    '.chip .n{font-weight:400;opacity:.75;font-variant-numeric:tabular-nums}',
    '.chip:focus-visible,.btn:focus-visible,.seg button:focus-visible,.ts:focus-visible{outline:2px solid var(--link);outline-offset:2px}',
    '.brand{display:inline-flex;align-items:center;margin-left:auto;color:var(--muted);font-size:12px;gap:6px}',
    '.mk{width:14px;height:14px}',
    '.mk .mk-o,.mk .mk-t{fill:var(--blue)}',
    ':host-context(html[dark]) .mk .mk-o{fill:currentColor}:host-context(html[dark]) .mk .mk-t{fill:var(--lime)}',
    // In the watch page's OpenOutlier row the chips match YouTube's 36 px pills.
    ':host(.in-row) .chip{height:36px}',
    '.panel{margin-top:8px;border-radius:12px;background:var(--surf);padding:12px 14px}',
    '.ph{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin-bottom:10px}',
    '.ph h3{margin:0;font-size:16px;line-height:22px;font-weight:500}',
    '.ph .meta{color:var(--muted);font-size:12px}',
    '.ph .acts{margin-left:auto;display:flex;flex-wrap:wrap;gap:6px;align-items:center}',
    '.btn{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:15px;border:0;background:var(--chip);font-size:13px;font-weight:500;cursor:pointer;white-space:nowrap}',
    '.btn:hover{background:var(--chip-h)}',
    '.btn.primary{background:var(--blue);color:#fff}',
    '.btn.primary:hover{background:#1530d9}',
    '.btn.ghost{background:transparent;box-shadow:inset 0 0 0 1px var(--line)}',
    '.btn.danger{background:transparent;color:#cc0000;box-shadow:inset 0 0 0 1px var(--line)}',
    ':host-context(html[dark]) .btn.danger{color:#ff7c7c}',
    '.btn svg{width:16px;height:16px}',
    '.seg{display:inline-flex;border-radius:15px;background:var(--chip);overflow:hidden;height:30px}',
    '.seg span{display:inline-flex;align-items:center;padding:0 4px 0 12px;font-size:12px;color:var(--muted)}',
    '.seg button{border:0;background:transparent;padding:0 10px;font-size:13px;font-weight:500;cursor:pointer}',
    '.seg button:hover{background:var(--chip-h)}',
    '.seg button+button{box-shadow:inset 1px 0 0 var(--line)}',
    '.input{height:32px;border-radius:8px;border:1px solid var(--line);background:var(--field);padding:0 10px;font-size:13px;min-width:0}',
    '.input:focus{outline:none;border-color:var(--link)}',
    'textarea.input{height:auto;min-height:56px;padding:6px 10px;resize:vertical;line-height:18px}',
    '.list{max-height:360px;overflow:auto;margin:0 -6px;padding:0 6px;overscroll-behavior:contain;scrollbar-width:thin}',
    '.seg-row{display:grid;grid-template-columns:56px 1fr;gap:10px;padding:5px 6px;border-radius:8px;align-items:baseline}',
    '.seg-row:hover{background:var(--surf)}',
    '.ts{border:0;background:transparent;color:var(--link);font-size:13px;font-variant-numeric:tabular-nums;cursor:pointer;padding:0;text-align:left}',
    '.seg-row mark,.cm mark{background:var(--hl);color:inherit;border-radius:2px}',
    '.note{color:var(--muted);font-size:12px;line-height:16px;margin:8px 0 0}',
    '.msg{font-size:13px;margin:8px 0 0;color:var(--muted)}',
    '.msg.ok{color:inherit}',
    '.msg.ok::before{content:"";display:inline-block;width:6px;height:6px;margin:0 8px 2px 0;background:var(--blue)}',
    '.empty{color:var(--muted);padding:16px 2px;font-size:13px}',
    '.sk{display:block;height:12px;border-radius:3px;background:var(--surf2);margin:8px 0}',
    '.filters{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:10px}',
    '.filters .input{flex:1 1 220px}',
    '.cm{padding:8px 6px;border-radius:8px;display:grid;gap:2px}',
    '.cm + .cm{border-top:1px solid var(--line);border-radius:0}',
    '.cm .au{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;font-size:12px;color:var(--muted)}',
    '.cm .au b{font-weight:500;color:inherit;font-size:13px}',
    ':host-context(html[dark]) .cm .au b{color:#f1f1f1}',
    '.cm .au b{color:#0f0f0f}',
    '.cm .tx{font-size:14px;line-height:20px;white-space:pre-wrap;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}',
    '.cm.reply{padding-left:26px}',
    '.tag{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:4px;font-size:11px;font-weight:500;background:var(--surf2);color:inherit}',
    '.tag.q{background:var(--blue);color:#fff}',
    '.tag.pin{background:var(--ink);color:#F6F7F2}',
    ':host-context(html[dark]) .tag.pin{background:#F6F7F2;color:var(--ink)}',
    '.form{display:grid;grid-template-columns:auto 1fr;gap:10px 12px;align-items:start}',
    '.form label.l{font-size:13px;color:var(--muted);padding-top:6px}',
    '.form .chk{min-height:32px}',
    '.form .full{grid-column:1/-1}',
    '.form textarea.input,.form input[type=text].input:not(.clip .input){width:100%}',
    '.clip{display:flex;flex-wrap:wrap;gap:6px;align-items:center}',
    '.clip .input{width:84px;font-variant-numeric:tabular-nums}',
    '.clip .to{color:var(--muted)}',
    '.chk{display:inline-flex;align-items:center;gap:8px;font-size:13px;cursor:pointer}',
    '.chk input{width:16px;height:16px;accent-color:var(--blue);margin:0}',
    '.sugg{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}',
    '.sugg button{border:0;background:var(--chip);border-radius:10px;height:22px;padding:0 8px;font-size:12px;cursor:pointer}',
    '.sugg button:hover{background:var(--chip-h)}',
    '.foot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px}',
    '.foot .sp{flex:1}',
    'a.lnk{color:var(--link);text-decoration:none;font-size:13px;cursor:pointer}a.lnk:hover{text-decoration:underline}',
    '[hidden]{display:none!important}',
    '@media (max-width:640px){.brand{display:none}.form{grid-template-columns:1fr}.ph .acts{margin-left:0}.seg-row{grid-template-columns:48px 1fr}}',
    // The popover (toolbar buttons, Shorts): the toolbar's ink card.
    '.pop{font:400 14px/20px Roboto,Arial,sans-serif;text-align:left;position:fixed;z-index:2147483000;width:360px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;border-radius:12px;background:#fff;color:#0f0f0f;box-shadow:0 4px 32px rgba(0,0,0,.22),0 0 0 1px rgba(0,0,0,.06);padding:12px 14px}',
    ':host-context(html[dark]) .pop{background:#282828;color:#f1f1f1;box-shadow:0 4px 32px rgba(0,0,0,.6)}',
    '.pop.menu{width:auto;min-width:200px;padding:6px}',
    '.pop .panel{margin:0;padding:0;background:transparent}',
    '.mi{display:flex;width:100%;align-items:center;gap:12px;height:36px;padding:0 12px;border:0;background:transparent;border-radius:8px;font-size:14px;cursor:pointer;text-align:left;white-space:nowrap}',
    '.mi:hover,.mi:focus-visible{background:var(--chip);outline:none}',
    '.mi svg{width:20px;height:20px;flex:none}',
    '.mi small{margin-left:auto;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}',
    '.pop .msg{margin:6px 6px 2px;max-width:300px;white-space:normal}',
    '.x{position:absolute;top:8px;right:8px;width:28px;height:28px;border:0;border-radius:14px;background:transparent;cursor:pointer;color:var(--muted);font-size:18px;line-height:1}',
    '.x:hover{background:var(--chip)}'
  ].join('\n');
  var MARK = '<svg class="mk" viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges"><path class="mk-o" d="M4 2h6v2H4zM2 4h2v8H2zM10 4h2v8h-2zM4 12h6v2H4z"/><path class="mk-t" d="M12 2h2v2h-2zM14 0h2v2h-2z"/></svg>';
  var ICON = {
    transcript: 'M4 6h16M4 11h16M4 16h10',
    comments: 'M4 5h16v11H9l-5 4z',
    save: 'M7 4h10v16l-5-4-5 4z',
    saved: 'M7 4h10v16l-5-4-5 4zM9.5 10l2 2 3.5-4',
    camera: 'M4 8h3.5l1.5-2.5h6L16.5 8H20v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    copy: 'M8 8h11v12H8zM5 16V4h11',
    down: 'M12 4v11M7 10l5 5 5-5M5 20h14',
    spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z'
  };
  function svg(d) {
    var NS = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '1.8');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    s.appendChild(p);
    return s;
  }
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
    for (var i = 2; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }
  function add(e, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(e, x); }); return; }
    e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  function highlight(text, q) {
    var qs = String(q || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    if (!qs.length) return document.createTextNode(text);
    var frag = document.createDocumentFragment();
    var low = CT.fold(text);
    var i = 0;
    while (i < text.length) {
      var best = -1;
      var len = 0;
      qs.forEach(function (x) { var f = CT.fold(x); var at = low.indexOf(f, i); if (at !== -1 && (best === -1 || at < best)) { best = at; len = f.length; } });
      if (best === -1 || !len) { frag.appendChild(document.createTextNode(text.slice(i))); break; }
      if (best > i) frag.appendChild(document.createTextNode(text.slice(i, best)));
      frag.appendChild(h('mark', { text: text.slice(best, best + len) }));
      i = best + len;
    }
    return frag;
  }

  // ---- clipboard and files --------------------------------------------------------------------
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
    ta.remove();
    if (!ok) throw new Error('clipboard');
  }
  function saveBlob(name, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    window.__ooLastDownload = name; // read by the dev demo page
  }
  function saveText(name, text, type) { saveBlob(name, new Blob([text], { type: (type || 'text/plain') + ';charset=utf-8' })); }

  // ---- the video on the page ------------------------------------------------------------------
  function video() {
    var L = Lib();
    if (L && L.mainVideo) { try { var v = L.mainVideo(); if (v) return v; } catch (e) { /* fall through */ } }
    return document.querySelector('#movie_player video, ytd-player video, video');
  }
  function now() { var v = video(); return v && Number.isFinite(v.currentTime) ? v.currentTime : 0; }
  function seek(t) { var v = video(); if (v) { try { v.currentTime = t; v.play && v.play().catch(function () {}); } catch (e) { /* not seekable */ } } }
  /** What the page knows about the video: title, channel, thumbnail … for exports and the swipe file. */
  function meta(id) {
    var L = Lib();
    var p = L && L.findPost ? L.findPost(id) : null;
    var f = D.videoFacts(id);
    var page = D.activePage();
    // The page's own title first when it is this video's page (it is what the viewer sees now).
    var onPage = ctx().video === id;
    var title = (onPage && textOf(page.querySelector('ytd-watch-metadata #title h1, ytd-watch-metadata h1, #title h1'))) || (p && p.caption) || (onPage ? document.title.replace(/\s*-\s*YouTube$/, '') : '');
    var chan = (p && p.ownerName) || textOf(page.querySelector('ytd-watch-metadata #owner #channel-name a, ytd-watch-metadata #owner ytd-channel-name a, #owner b')) || (f.handle ? '@' + f.handle : null);
    var v = video();
    return {
      id: id, type: f.type === 'short' || ctx().kind === 'short' ? 'short' : 'video', title: title || id, channel: chan || null, account: f.acct || (p && p.owner) || null,
      channelId: f.uc || null, thumb: 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg', views: f.views != null ? f.views : null,
      duration: (p && p.duration) || f.duration || (v && Number.isFinite(v.duration) ? Math.round(v.duration) : null), publishedAt: f.publishedAt || null
    };
  }
  function textOf(el) { return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }

  // ---- transcript --------------------------------------------------------------------------------
  var tracks = {};   // video id → caption tracks from player responses
  var heard = {};    // video id → segments from captions the player itself loaded (CC on)
  var trans = {};    // video id → { state: 'loading' | 'ready' | 'none', segs, source, lang, auto }
  function noteTracks(text) {
    var r = CT.captionTracks(text);
    if (r && r.videoId && r.tracks.length) tracks[r.videoId] = r.tracks;
  }
  function scanInline() {
    document.querySelectorAll('script:not([src])').forEach(function (el) {
      var t = el.textContent;
      if (t && t.length < 1.2e7 && t.indexOf('"captionTracks":') !== -1) noteTracks(t);
    });
  }
  function transcriptPanel() {
    var ps = document.querySelectorAll('ytd-engagement-panel-section-list-renderer');
    var cand = [];
    for (var i = 0; i < ps.length; i++) {
      if (/transcript/i.test(ps[i].getAttribute('target-id') || '') || ps[i].querySelector('ytd-transcript-segment-renderer, transcript-segment-view-model, ytd-transcript-search-panel-renderer')) cand.push(ps[i]);
    }
    return cand.filter(function (p) { return p.getAttribute('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED'; })[0] || cand[0] || null;
  }
  function transcriptButton() {
    var page = D.activePage();
    var b = page.querySelector('ytd-video-description-transcript-section-renderer button, ytd-video-description-transcript-section-renderer [role="button"]');
    if (b) return b;
    var all = page.querySelectorAll('button[aria-label], yt-button-shape button');
    for (var i = 0; i < all.length; i++) {
      var l = (all[i].getAttribute('aria-label') || all[i].textContent || '');
      if (/show transcript|transkripti göster|metni göster|transkript/i.test(l)) return all[i];
    }
    return null;
  }
  function closePanel(p) {
    var x = p.querySelector('#visibility-button button, button[aria-label*="Close" i], button[aria-label*="Kapat" i]');
    if (x) x.click(); else p.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN');
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function readTranscript(id) {
    var p = transcriptPanel();
    var segs = p ? CT.readTranscriptDom(p) : [];
    if (segs.length) return { segs: segs, source: 'panel' };
    var btn = transcriptButton();
    if (btn) {
      var wasOpen = p && p.getAttribute('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED';
      btn.click();
      for (var i = 0; i < 40 && !segs.length; i++) {
        await sleep(150);
        p = transcriptPanel();
        segs = p ? CT.readTranscriptDom(p) : [];
      }
      // Leave the page as it was: close the panel we opened.
      if (p && !wasOpen) closePanel(p);
      if (segs.length) return { segs: segs, source: 'panel' };
    }
    if (heard[id] && heard[id].length) return { segs: heard[id], source: 'cc' };
    var tr = CT.pickTrack(tracks[id], dataLang());
    if (tr) {
      try {
        var res = await fetch(CT.json3Url(tr.url), { credentials: 'include' });
        var body = res.ok ? await res.text() : '';
        segs = body ? CT.parseJson3(body) : [];
        if (!segs.length) {
          var r2 = await fetch(tr.url, { credentials: 'include' });
          segs = r2.ok ? CT.parseCaptionXml(await r2.text()) : [];
        }
      } catch (e) { segs = []; }
      if (segs.length) return { segs: segs, source: 'track', lang: tr.lang, auto: tr.auto };
    }
    return { segs: [], source: null };
  }
  function loadTranscript(id, force) {
    if (trans[id] && !force && trans[id].state !== 'none') return;
    trans[id] = { state: 'loading' };
    paint();
    readTranscript(id).then(function (r) {
      trans[id] = r.segs.length ? { state: 'ready', segs: r.segs, source: r.source, lang: r.lang, auto: r.auto } : { state: 'none' };
      paint();
    }, function () { trans[id] = { state: 'none' }; paint(); });
  }

  // ---- comments: read from YouTube's own responses as they load --------------------------------
  var CACHE_KEY = 'oo-cache:yt-comments'; // not "rs:": not in backups, not synced as library data
  var CACHE_TTL = 3 * 864e5;
  var CACHE_MAX = 25;
  var comments = {};   // video id → { items, total, at, sent }
  var pushTimer = {};
  function addComments(id, list, total) {
    if (!id || (!list.length && total == null)) return;
    var c = comments[id] || (comments[id] = { items: [], total: null, at: 0 });
    c.items = CT.mergeComments(c.items, list, 2000);
    if (total != null) c.total = total;
    c.at = Date.now();
    persist(id);
    if (list.length) push(id);
    if (state.open === 'comments' || pop.kind === 'comments') paintComments();
    paintChips();
  }
  function persist(id) {
    clearTimeout(persist.t);
    persist.t = setTimeout(function () {
      chrome.storage.local.get(CACHE_KEY).then(function (r) {
        var m = r[CACHE_KEY] || {};
        var nowT = Date.now();
        Object.keys(m).forEach(function (k) { if (!m[k] || nowT - m[k].at > CACHE_TTL) delete m[k]; });
        if (comments[id]) m[id] = { at: comments[id].at, total: comments[id].total, items: comments[id].items };
        var keys = Object.keys(m).sort(function (a, b) { return m[b].at - m[a].at; });
        keys.slice(CACHE_MAX).forEach(function (k) { delete m[k]; });
        var o = {};
        o[CACHE_KEY] = m;
        return chrome.storage.local.set(o);
      }).catch(function () {});
    }, 1500);
  }
  function restore(id) {
    if (comments[id] || restore.asked === id) return;
    restore.asked = id;
    chrome.storage.local.get(CACHE_KEY).then(function (r) {
      var e = (r[CACHE_KEY] || {})[id];
      if (e && Date.now() - e.at < CACHE_TTL && !comments[id]) { comments[id] = { items: e.items || [], total: e.total, at: e.at }; paint(); }
    }).catch(function () {});
  }
  /** To the bridge (get_comments), a few seconds after the last batch. */
  function push(id) {
    clearTimeout(pushTimer[id]);
    pushTimer[id] = setTimeout(function () {
      if (!FT.isOn('comment-tools') || !comments[id]) return;
      var m = meta(id);
      D.send({ type: 'reelscope:yt-content', what: 'comments', video: id, title: m.title, channel_id: m.channelId, total: comments[id].total, comments: comments[id].items.slice(-2000) });
    }, 4000);
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window || !e.data || e.data.__reelscope !== 1 || e.data.type !== 'payload') return;
    var text = e.data.text;
    var url = String(e.data.url || '');
    if (typeof text !== 'string') return;
    try {
      if (text.indexOf('"captionTracks":') !== -1) noteTracks(text);
      var c = ctx();
      if (/\/api\/timedtext/.test(url) && FT.isOn('transcript-tools')) {
        var vid = (/[?&]v=([A-Za-z0-9_-]{11})/.exec(url) || [])[1] || c.video;
        var segs = text.trim().charAt(0) === '<' ? CT.parseCaptionXml(text) : CT.parseJson3(text);
        if (vid && segs.length && (!heard[vid] || segs.length > heard[vid].length)) heard[vid] = segs;
        return;
      }
      if (!FT.isOn('comment-tools') || !(c.kind === 'watch' || c.kind === 'short') || !c.video) return;
      if (text.indexOf('"commentEntityPayload"') === -1 && text.indexOf('"commentRenderer"') === -1 && text.indexOf('"commentsHeaderRenderer"') === -1) return;
      var lg = /"(görüntüleme|yorum|beğeni)/.test(text) ? 'tr' : dataLang();
      addComments(c.video, CT.parseComments(text, { lang: lg }), CT.commentsTotal(text, { lang: lg }));
    } catch (err) { console.warn('[OpenOutlier] comment / caption read failed', err); }
  });

  // ---- state --------------------------------------------------------------------------------------
  var state = { open: null, video: null, msg: '', msgOk: false, tFilter: '', filters: { questions: false, hideProfanity: false, phrase: '', sort: 'top' }, form: null };
  function setMsg(text, ok) { state.msg = text || ''; state.msgOk = !!ok; }

  // ---- watch page: the chip row and its panel ------------------------------------------------------
  var bar = null; // { el, root, chips, panelBox }
  function anyWatchTool() { return FT.isOn('transcript-tools') || FT.isOn('comment-tools') || FT.isOn('swipe-save'); }
  function barSlot() {
    // The watch page's OpenOutlier row (youtube-content.js): the chips sit right after the toolbar, one toolbar.
    var lib = Lib();
    var row = lib && lib.watchRow ? lib.watchRow() : null;
    if (row) return { parent: row, before: null, row: true };
    var page = D.activePage();
    var card = page.querySelector('.openoutlier-watch-card');
    if (card && card.parentNode) return { parent: card.parentNode, before: card.nextSibling };
    var s = page.querySelector('[data-oo-watch-slot]');
    if (s) return { parent: s, before: null };
    var bottom = page.querySelector('ytd-watch-metadata #above-the-fold > #bottom-row, ytd-watch-metadata #bottom-row');
    if (bottom) return { parent: bottom.parentNode, before: bottom };
    return null;
  }
  function makeBar() {
    var el = document.createElement('div');
    el.className = 'openoutlier-tools';
    el.setAttribute('data-openoutlier', 'tools');
    var root = el.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' + CSS + '</style>';
    var row = h('div', { class: 'row', role: 'toolbar' });
    var box = h('div', { class: 'box' });
    root.appendChild(row);
    root.appendChild(box);
    return { el: el, root: root, row: row, box: box, sig: '' };
  }
  function chip(id, label, iconD, count) {
    var pressed = state.open === id;
    return h('button', { class: 'chip', type: 'button', 'aria-expanded': pressed ? 'true' : 'false', 'data-tool': id, onclick: function () { toggle(id); } },
      svg(iconD), label, count != null ? h('span', { class: 'n', text: count }) : null);
  }
  function toggle(id) {
    state.open = state.open === id ? null : id;
    setMsg('');
    if (state.open === 'transcript' && state.video) loadTranscript(state.video);
    if (state.open === 'save') state.form = null;
    paint();
  }
  function paintChips() {
    if (!bar) return;
    var L = T();
    var id = state.video;
    var c = id && comments[id];
    var saved = id ? SW.findSame(orgCache, id, null) || Object.values(SW.state(orgCache).items).filter(function (x) { return x.video === id; })[0] : null;
    var sig = JSON.stringify([lang(), state.open, FT.flags(), c ? c.items.length : 0, !!saved]);
    if (bar.sig === sig) return;
    bar.sig = sig;
    bar.el.setAttribute('lang', lang());
    if (pop.el) pop.el.setAttribute('lang', lang());
    bar.row.textContent = '';
    if (FT.isOn('transcript-tools')) bar.row.appendChild(chip('transcript', L.transcript, ICON.transcript));
    if (FT.isOn('comment-tools')) bar.row.appendChild(chip('comments', L.comments, ICON.comments, c && c.items.length ? I.compact(c.items.length, lang()) : null));
    if (FT.isOn('swipe-save')) bar.row.appendChild(chip('save', saved ? L.saved : L.save, saved ? ICON.saved : ICON.save));
    // In the shared row the toolbar already carries the OpenOutlier mark.
    if (!bar.el.classList.contains('in-row')) {
      var br = h('span', { class: 'brand', title: L.tools });
      br.innerHTML = MARK;
      bar.row.appendChild(br);
    }
  }
  function watchBar() {
    var c = ctx();
    var on = c.kind === 'watch' && c.video && anyWatchTool();
    var slot = on ? barSlot() : null;
    if (!slot) { if (bar) { bar.el.remove(); bar = null; } return; }
    if (state.video !== c.video) { state.video = c.video; state.open = null; state.form = null; setMsg(''); restore(c.video); }
    if (state.open && !FT.isOn(state.open === 'transcript' ? 'transcript-tools' : state.open === 'comments' ? 'comment-tools' : 'swipe-save')) state.open = null;
    if (!bar) bar = makeBar();
    bar.el.classList.toggle('in-row', !!slot.row);
    bar.el.style.margin = slot.row ? '' : '12px 0 0';
    if (bar.el.parentNode !== slot.parent || (slot.before && bar.el.nextSibling !== slot.before && bar.el !== slot.before)) slot.parent.insertBefore(bar.el, slot.before);
    paintChips();
    paintPanel();
  }

  var panelSig = '';
  function paintPanel() {
    if (!bar) return;
    var sig = JSON.stringify([state.open, state.video, lang(), trans[state.video] && trans[state.video].state]);
    if (panelSig === sig && bar.box.firstChild) return;
    panelSig = sig;
    bar.box.textContent = '';
    if (!state.open) return;
    var panel = h('div', { class: 'panel', role: 'region', 'aria-label': T()[state.open === 'save' ? 'swipeTitle' : state.open] });
    bar.box.appendChild(panel);
    renderTool(state.open, panel, state.video, false);
  }
  function paint() {
    try { watchBar(); } catch (e) { console.warn('[OpenOutlier] tools failed', e); }
    try { if (pop.el && pop.kind) renderPop(); } catch (e) { console.warn('[OpenOutlier] tools popover failed', e); }
  }

  // ---- panels (shared by the watch page and the popover) ---------------------------------------------
  function renderTool(kind, panel, id, inPop) {
    panel.textContent = '';
    if (kind === 'transcript') renderTranscript(panel, id);
    else if (kind === 'comments') renderComments(panel, id, inPop);
    else if (kind === 'save') renderSave(panel, id);
  }

  function renderTranscript(panel, id) {
    var L = T();
    var t = trans[id] || { state: 'loading' };
    var head = h('div', { class: 'ph' }, h('h3', { text: L.transcript }));
    panel.appendChild(head);
    if (t.state === 'loading') {
      head.appendChild(h('span', { class: 'meta', role: 'status', text: L.tLoading }));
      panel.appendChild(h('div', {}, [70, 92, 54, 81].map(function (w) { return h('span', { class: 'sk', style: 'width:' + w + '%' }); })));
      return;
    }
    if (t.state === 'none') {
      panel.appendChild(h('p', { class: 'empty', text: L.tNone }));
      panel.appendChild(h('button', { class: 'btn ghost', type: 'button', onclick: function () { loadTranscript(id, true); } }, L.tRetry));
      return;
    }
    var segs = t.segs;
    var m = meta(id);
    var src = t.source === 'panel' ? L.tFromPanel : t.source === 'cc' ? L.tFromCC : fill(L.tFromTrack, { lang: (t.lang || '?') + (t.auto ? ', ' + L.auto : '') });
    head.appendChild(h('span', { class: 'meta', text: src + ' · ' + fill(L.segs, { n: I.full(segs.length, lang()) }) }));
    var base = CT.slug(m.title, id);
    var msg = h('p', { class: 'msg', role: 'status', 'aria-live': 'polite' });
    function done(text) { msg.textContent = text; msg.className = 'msg ok'; }
    function failed() { msg.textContent = L.copyFail; msg.className = 'msg'; }
    head.appendChild(h('div', { class: 'acts' },
      h('div', { class: 'seg', role: 'group', 'aria-label': L.copy }, h('span', { text: L.copy }),
        h('button', { type: 'button', onclick: function () { copyText(CT.asText(segs)).then(function () { done(L.copied); }, failed); } }, L.copyText),
        h('button', { type: 'button', onclick: function () { copyText(CT.asText(segs, { timestamps: true })).then(function () { done(L.copied); }, failed); } }, L.copyTs)),
      h('div', { class: 'seg', role: 'group', 'aria-label': L.download }, h('span', { text: L.download }),
        h('button', { type: 'button', onclick: function () { saveText(base + '.txt', CT.asText(segs, { timestamps: true })); } }, '.txt'),
        h('button', { type: 'button', onclick: function () { saveText(base + '.srt', CT.toSrt(segs), 'application/x-subrip'); } }, '.srt'),
        h('button', { type: 'button', onclick: function () { saveText(base + '.md', CT.toMarkdown(segs, Object.assign({ source: src }, m)), 'text/markdown'); } }, '.md')),
      h('button', { class: 'btn primary', type: 'button', onclick: function () {
        var prompt = CT.transcriptPrompt(segs, m, lang());
        copyText(prompt).then(function () { done(fill(L.copiedPrompt, { n: I.full(prompt.length, lang()) })); }, failed);
      } }, svg(ICON.spark), L.toClaude)));
    var search = h('input', { class: 'input', type: 'search', placeholder: L.filter, 'aria-label': L.filter, value: state.tFilter, style: 'width:100%;margin-bottom:8px' });
    var list = h('div', { class: 'list' });
    function fillList() {
      list.textContent = '';
      var q = search.value.trim();
      state.tFilter = q;
      var shown = q ? segs.filter(function (s) { return CT.matchesPhrase(s.text, q); }) : segs;
      if (!shown.length) { list.appendChild(h('p', { class: 'empty', text: L.noMatch })); return; }
      var frag = document.createDocumentFragment();
      shown.forEach(function (s) {
        frag.appendChild(h('div', { class: 'seg-row' },
          h('button', { class: 'ts', type: 'button', title: fill(L.jump, { t: CT.clock(s.start) }), onclick: function () { seek(s.start); } }, CT.clock(s.start)),
          h('span', {}, highlight(s.text, q))));
      });
      list.appendChild(frag);
    }
    search.addEventListener('input', fillList);
    panel.appendChild(search);
    panel.appendChild(list);
    panel.appendChild(msg);
    fillList();
  }

  var commentsBox = null; // { list, count, msg } of the open comments panel
  function renderComments(panel, id, inPop) {
    var L = T();
    var lg = lang();
    var f = state.filters;
    var head = h('div', { class: 'ph' }, h('h3', { text: L.comments }));
    var count = h('span', { class: 'meta', role: 'status' });
    head.appendChild(count);
    var msg = h('p', { class: 'msg', role: 'status', 'aria-live': 'polite' });
    function done(text) { msg.textContent = text; msg.className = 'msg ok'; }
    function failed() { msg.textContent = L.copyFail; msg.className = 'msg'; }
    function shown() { return CT.filterComments((comments[id] || { items: [] }).items, { questions: f.questions, phrase: f.phrase, hideProfanity: f.hideProfanity, sort: f.sort }); }
    var m = meta(id);
    head.appendChild(h('div', { class: 'acts' },
      h('div', { class: 'seg', role: 'group', 'aria-label': L.download }, h('span', { text: L.download }),
        h('button', { type: 'button', onclick: function () { saveText(CT.slug(m.title, id) + '-comments.csv', CT.commentsCsv(shown().items, id), 'text/csv'); } }, L.exportCsv),
        h('button', { type: 'button', onclick: function () { saveText(CT.slug(m.title, id) + '-comments.json', CT.commentsJson(shown().items, m), 'application/json'); } }, L.exportJson)),
      h('button', { class: 'btn primary', type: 'button', onclick: function () {
        var list = shown().items;
        copyText(CT.commentPrompt(list, m, lg)).then(function () { done(fill(L.copiedComments, { n: I.full(list.length, lg) })); }, failed);
      } }, svg(ICON.spark), L.analyse)));
    panel.appendChild(head);
    function toggleBtn(key, label) {
      return h('button', { class: 'chip', type: 'button', 'aria-pressed': f[key] ? 'true' : 'false', onclick: function (e) { f[key] = !f[key]; e.currentTarget.setAttribute('aria-pressed', f[key] ? 'true' : 'false'); fillList(); } }, label);
    }
    var sortBtn = h('button', { class: 'chip', type: 'button', 'aria-pressed': f.sort === 'likes' ? 'true' : 'false', onclick: function (e) { f.sort = f.sort === 'likes' ? 'top' : 'likes'; e.currentTarget.setAttribute('aria-pressed', f.sort === 'likes' ? 'true' : 'false'); fillList(); } }, L.sortLikes);
    var phrase = h('input', { class: 'input', type: 'search', placeholder: L.phrase, 'aria-label': L.phrase, value: f.phrase });
    phrase.addEventListener('input', function () { f.phrase = phrase.value; fillList(); });
    panel.appendChild(h('div', { class: 'filters' }, toggleBtn('questions', L.questions), toggleBtn('hideProfanity', L.hideProfanity), sortBtn, phrase));
    var list = h('div', { class: 'list', style: inPop ? 'max-height:min(420px,calc(100vh - 220px))' : null });
    panel.appendChild(list);
    panel.appendChild(msg);
    panel.appendChild(h('p', { class: 'note', text: bridgeOn ? L.cKept : L.cLocal }));
    function fillList() {
      var c = comments[id];
      var all = c ? c.items : [];
      var r = shown();
      count.textContent = !all.length ? '' : (c.total ? fill(L.cOf, { n: I.full(all.length, lg), total: I.full(c.total, lg) }) : fill(L.cCount, { n: I.full(all.length, lg) })) +
        (all.length ? ' · ' + fill(L.cMatch, { n: I.full(r.items.length, lg) }) : '') + (r.hiddenProfane ? ' · ' + fill(L.cHidden, { n: r.hiddenProfane }) : '');
      list.textContent = '';
      if (!all.length) { list.appendChild(h('p', { class: 'empty', text: ctx().kind === 'short' ? L.cNoneShorts : L.cNone })); return; }
      if (!r.items.length) { list.appendChild(h('p', { class: 'empty', text: L.cEmpty })); return; }
      var frag = document.createDocumentFragment();
      r.items.slice(0, 400).forEach(function (cm) {
        var q = CT.isQuestion(cm.text);
        frag.appendChild(h('div', { class: 'cm' + (cm.reply ? ' reply' : '') },
          h('div', { class: 'au' }, h('b', { text: cm.author || '–' }), cm.published ? h('span', { text: cm.published }) : null,
            h('span', { title: fill(L.likes, { n: I.full(cm.likes || 0, lg) }), text: '👍 ' + I.compact(cm.likes || 0, lg) }),
            cm.pinned ? h('span', { class: 'tag pin', text: L.pinned }) : null, cm.hearted ? h('span', { class: 'tag', text: '♥ ' + L.creator, title: L.hearted }) : null,
            cm.creator ? h('span', { class: 'tag', text: L.creator }) : null, q ? h('span', { class: 'tag q', text: L.question }) : null),
          h('div', { class: 'tx' }, highlight(cm.text, f.phrase))));
      });
      list.appendChild(frag);
      if (c.total && all.length < c.total) list.appendChild(h('p', { class: 'note', text: L.cMore }));
    }
    commentsBox = { fill: fillList, id: id };
    fillList();
  }
  function paintComments() { if (commentsBox && (state.open === 'comments' || pop.kind === 'comments')) commentsBox.fill(); }

  // ---- swipe file ---------------------------------------------------------------------------------------
  var orgCache = { folders: [], accounts: {} };
  var bridgeOn = false; // whether comments reach the bridge (the note under the comments says so)
  chrome.storage.local.get(['rs:org', 'rs:bridge', 'rs:settings']).then(function (r) {
    bridgeOn = !!(r['rs:bridge'] && r['rs:bridge'].connected) && !(r['rs:settings'] && r['rs:settings'].agentBridge === false);
    if (r['rs:org']) { orgCache = r['rs:org']; paint(); }
  }).catch(function () {});
  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area === 'local' && ch['rs:bridge']) bridgeOn = !!(ch['rs:bridge'].newValue && ch['rs:bridge'].newValue.connected);
    if (area !== 'local' || !ch['rs:org']) return;
    orgCache = ch['rs:org'].newValue || { folders: [], accounts: {} };
    if (bar) bar.sig = '';
    paintChips();
  });
  async function writeOrg(fn) {
    var r = await chrome.storage.local.get('rs:org');
    var org = r['rs:org'] && Array.isArray(r['rs:org'].folders) ? r['rs:org'] : { folders: [], accounts: {} };
    var out = fn(org);
    var o = {};
    o['rs:org'] = out.org;
    await chrome.storage.local.set(o);
    orgCache = out.org;
    return out;
  }
  function allTags() {
    var c = SW.tagCounts(orgCache);
    Object.keys(orgCache.accounts || {}).forEach(function (u) { ((orgCache.accounts[u] || {}).tags || []).forEach(function (t) { c[t] = (c[t] || 0) + 1; }); });
    return Object.keys(c).sort(function (a, b) { return c[b] - c[a] || a.localeCompare(b); });
  }
  function renderSave(panel, id) {
    var L = T();
    var existing = Object.values(SW.state(orgCache).items).filter(function (x) { return x.video === id; }).sort(function (a, b) { return b.updatedAt - a.updatedAt; })[0] || null;
    var fm = state.form && state.form.video === id ? state.form : (state.form = {
      video: id, id: existing ? existing.id : null, folder: existing ? existing.folder : null, note: existing ? existing.note : '', tags: existing ? existing.tags.join(', ') : '',
      clipOn: !!(existing && existing.clip), start: existing && existing.clip ? existing.clip.start : Math.floor(now()), end: existing && existing.clip ? existing.clip.end : Math.floor(now()) + 30
    });
    panel.appendChild(h('div', { class: 'ph' }, h('h3', { text: L.swipeTitle }), h('span', { class: 'meta', text: meta(id).title })));
    var folderSel = h('select', { class: 'input', 'aria-label': L.folder },
      h('option', { value: '', text: L.noFolder }),
      (orgCache.folders || []).map(function (f) { return h('option', { value: f.id, text: f.name, selected: fm.folder === f.id }); }),
      h('option', { value: '__new', text: L.newFolder }));
    if (!fm.folder) folderSel.value = '';
    var newName = h('input', { class: 'input', type: 'text', placeholder: L.newFolderName, 'aria-label': L.newFolderName, hidden: true, maxlength: '60' });
    folderSel.addEventListener('change', function () { newName.hidden = folderSel.value !== '__new'; if (!newName.hidden) newName.focus(); fm.folder = folderSel.value === '__new' ? null : folderSel.value || null; });
    var clipChk = h('input', { type: 'checkbox', checked: fm.clipOn });
    var startIn = h('input', { class: 'input', type: 'text', inputmode: 'numeric', value: CT.clock(fm.start), 'aria-label': L.start });
    var endIn = h('input', { class: 'input', type: 'text', inputmode: 'numeric', value: CT.clock(fm.end), 'aria-label': L.end });
    var nowA = h('button', { class: 'btn ghost', type: 'button', onclick: function () { startIn.value = CT.clock(Math.floor(now())); } });
    var nowB = h('button', { class: 'btn ghost', type: 'button', onclick: function () { endIn.value = CT.clock(Math.floor(now())); } });
    // "Now (1:23)" follows the playhead while the form is open.
    function tick() { if (!panel.isConnected) { clearInterval(timer); return; } var t = fill(L.setNow, { t: CT.clock(now()) }); if (nowA.textContent !== t) { nowA.textContent = t; nowB.textContent = t; } }
    var timer = setInterval(tick, 500);
    tick();
    var clipRow = h('div', { class: 'clip', hidden: !fm.clipOn }, startIn, nowA, h('span', { class: 'to', text: '→' }), endIn, nowB);
    clipChk.addEventListener('change', function () { fm.clipOn = clipChk.checked; clipRow.hidden = !clipChk.checked; });
    var note = h('textarea', { class: 'input', rows: '2', placeholder: L.notePh, 'aria-label': L.note, maxlength: '2000' });
    note.value = fm.note || '';
    note.addEventListener('input', function () { fm.note = note.value; });
    var tags = h('input', { class: 'input', type: 'text', placeholder: L.tagsPh, 'aria-label': L.tags, value: fm.tags });
    tags.addEventListener('input', function () { fm.tags = tags.value; });
    var sugg = h('div', { class: 'sugg' }, allTags().slice(0, 10).map(function (t) {
      return h('button', { type: 'button', onclick: function () { var have = SW.normTags(tags.value); if (have.indexOf(t) === -1) { have.push(t); tags.value = have.join(', '); fm.tags = tags.value; } } }, '#' + t);
    }));
    var msg = h('p', { class: 'msg', role: 'status', 'aria-live': 'polite' });
    if (state.msg) { msg.textContent = state.msg; msg.className = 'msg' + (state.msgOk ? ' ok' : ''); }
    panel.appendChild(h('div', { class: 'form' },
      h('label', { class: 'l', text: L.folder }), h('div', { class: 'row' }, folderSel, newName),
      h('label', { class: 'l', text: L.clip }), h('div', {}, h('label', { class: 'chk' }, clipChk, L.clipOn), clipRow),
      h('label', { class: 'l', text: L.note }), note,
      h('label', { class: 'l', text: L.tags }), h('div', {}, tags, sugg.childNodes.length ? sugg : null)));
    var foot = h('div', { class: 'foot' },
      h('button', { class: 'btn primary', type: 'button', onclick: doSave }, svg(ICON.save), fm.id ? L.update : L.saveBtn),
      fm.id ? h('button', { class: 'btn danger', type: 'button', onclick: doRemove }, L.remove) : null,
      h('span', { class: 'sp' }),
      h('a', { class: 'lnk', role: 'link', tabindex: '0', onclick: function () { D.send({ type: 'reelscope:open-dashboard', hash: '#/swipe' }); } }, L.openLibrary));
    panel.appendChild(foot);
    panel.appendChild(msg);
    function doSave() {
      var clip = null;
      if (clipChk.checked) {
        var s = CT.parseClock(startIn.value);
        var e = CT.parseClock(endIn.value);
        if (s == null || e == null || !(e > s)) { msg.textContent = L.badClip; msg.className = 'msg'; return; }
        clip = { start: s, end: e };
      }
      var folderName = folderSel.value === '__new' ? newName.value.trim() : '';
      writeOrg(function (org) {
        var folder = folderSel.value && folderSel.value !== '__new' ? folderSel.value : null;
        if (folderName) {
          var f = { id: 'f' + Date.now().toString(36), name: folderName.slice(0, 60) };
          org = Object.assign({}, org, { folders: (org.folders || []).concat([f]) });
          folder = f.id;
        }
        var m = meta(id);
        return SW.save(org, Object.assign({}, m, { video: id, id: fm.id || undefined, folder: folder, note: note.value, tags: SW.normTags(tags.value), clip: clip }), Date.now());
      }).then(function (r) {
        if (!r.item) return;
        fm.id = r.item.id;
        var fName = r.item.folder ? ((orgCache.folders || []).filter(function (x) { return x.id === r.item.folder; })[0] || {}).name : null;
        setMsg(fill(L.savedTo, { where: fName || 'Swipe file' }), true);
        state.form = null;
        if (pop.kind === 'save') renderPop(true); else { panelSig = ''; paintPanel(); }
        if (bar) bar.sig = '';
        paintChips();
      }, function (e) { msg.textContent = String(e && e.message || e); });
    }
    function doRemove() {
      writeOrg(function (org) { return SW.remove(org, fm.id); }).then(function () {
        setMsg(L.removed, true);
        state.form = null;
        if (pop.kind === 'save') renderPop(true); else { panelSig = ''; paintPanel(); }
        if (bar) bar.sig = '';
        paintChips();
      });
    }
  }

  // ---- frame capture ----------------------------------------------------------------------------------------
  function captureFrame() {
    return new Promise(function (resolve, reject) {
      var v = video();
      if (!v || !v.videoWidth) { reject(Object.assign(new Error('no frame'), { code: 'none' })); return; }
      var c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      try {
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        c.toBlob(function (b) { if (b) resolve({ blob: b, t: v.currentTime || 0 }); else reject(new Error('empty image')); }, 'image/png');
      } catch (e) {
        reject(e && e.name === 'SecurityError' ? Object.assign(new Error('tainted'), { code: 'tainted' }) : e);
      }
    });
  }
  function frameName(t) {
    var id = ctx().video || 'video';
    var tt = CT.clock(t).replace(/:/g, '-');
    return CT.slug(meta(id).title, id) + '_' + tt + '.png';
  }
  function frameError(e) {
    var L = T();
    return e && e.code === 'tainted' ? L.frameTainted : e && e.code === 'none' ? L.frameNone : fill(L.frameFail, { e: String(e && e.message || e) });
  }
  function frameCopy() {
    var L = T();
    return captureFrame().then(function (r) {
      var item;
      try { item = new ClipboardItem({ 'image/png': r.blob }); } catch (e) { item = null; }
      var p = item && navigator.clipboard && navigator.clipboard.write ? navigator.clipboard.write([item]) : Promise.reject(new Error('clipboard'));
      return p.then(function () { window.__ooLastFrame = { at: r.t, size: r.blob.size, copied: true }; return fill(L.frameCopied, { t: CT.clock(r.t) }); },
        function () { var n = frameName(r.t); saveBlob(n, r.blob); return L.clipboardFail; });
    }, function (e) { throw new Error(frameError(e)); });
  }
  function frameDownload() {
    var L = T();
    return captureFrame().then(function (r) { var n = frameName(r.t); saveBlob(n, r.blob); window.__ooLastFrame = { at: r.t, size: r.blob.size, name: n }; return fill(L.frameSaved, { name: n }); },
      function (e) { throw new Error(frameError(e)); });
  }

  // ---- the popover (toolbar buttons) ---------------------------------------------------------------------------
  var pop = { el: null, root: null, box: null, kind: null, anchor: null, msg: '', msgOk: false };
  function ensurePop() {
    if (pop.el) return;
    pop.el = document.createElement('div');
    pop.el.setAttribute('data-openoutlier', 'tools-popover');
    pop.el.style.cssText = 'all:initial;position:fixed;z-index:2147483000;left:0;top:0;width:0;height:0';
    pop.root = pop.el.attachShadow({ mode: 'open' });
    pop.el.setAttribute('lang', lang());
    pop.root.innerHTML = '<style>' + CSS + '</style>';
    pop.box = h('div', { class: 'pop', role: 'dialog' });
    pop.root.appendChild(pop.box);
    document.documentElement.appendChild(pop.el);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && pop.kind) closePop(); }, true);
    document.addEventListener('mousedown', function (e) {
      if (!pop.kind) return;
      var path = e.composedPath ? e.composedPath() : [];
      if (path.indexOf(pop.el) !== -1 || (pop.anchor && path.indexOf(pop.anchor) !== -1)) return;
      closePop();
    }, true);
  }
  function openPop(kind, anchor) {
    ensurePop();
    if (pop.kind === kind) { closePop(); return; }
    pop.kind = kind;
    pop.anchor = anchor;
    pop.msg = '';
    setMsg('');
    state.form = null;
    if (kind === 'transcript' && ctx().video) loadTranscript(ctx().video);
    renderPop(true);
    syncToolbar();
  }
  function closePop() {
    pop.kind = null;
    pop.anchor = null;
    if (pop.box) pop.box.hidden = true;
    commentsBox = state.open === 'comments' ? commentsBox : null;
    syncToolbar();
  }
  var popSig = '';
  function renderPop(force) {
    if (!pop.kind) return;
    var id = ctx().video;
    if (!id) { closePop(); return; }
    var feat = { frame: 'frame-capture', comments: 'comment-tools', save: 'swipe-save', transcript: 'transcript-tools' }[pop.kind];
    if (!FT.isOn(feat)) { closePop(); return; }
    var sig = JSON.stringify([pop.kind, id, lang(), trans[id] && trans[id].state]);
    if (force || sig !== popSig) {
      popSig = sig;
      pop.box.hidden = false;
      pop.box.textContent = '';
      pop.box.className = 'pop' + (pop.kind === 'frame' ? ' menu' : '');
      if (pop.kind === 'frame') renderFrameMenu(pop.box);
      else {
        var L = T();
        pop.box.appendChild(h('button', { class: 'x', type: 'button', 'aria-label': L.close, title: L.close, onclick: closePop }, '×'));
        var panel = h('div', { class: 'panel' });
        pop.box.appendChild(panel);
        renderTool(pop.kind, panel, id, true);
      }
    }
    placePop();
  }
  function renderFrameMenu(box) {
    var L = T();
    var t = CT.clock(now());
    var msg = h('p', { class: 'msg', role: 'status', 'aria-live': 'polite', hidden: !pop.msg, text: pop.msg });
    if (pop.msgOk) msg.className = 'msg ok';
    function run(fn) {
      msg.hidden = false;
      msg.className = 'msg';
      msg.textContent = '…';
      fn().then(function (text) { pop.msg = text; pop.msgOk = true; msg.textContent = text; msg.className = 'msg ok'; placePop(); },
        function (e) { pop.msg = e.message; pop.msgOk = false; msg.textContent = e.message; msg.className = 'msg'; placePop(); });
    }
    box.appendChild(h('button', { class: 'mi', type: 'button', role: 'menuitem', onclick: function () { run(frameCopy); } }, svg(ICON.copy), L.frameCopy, h('small', { text: t })));
    box.appendChild(h('button', { class: 'mi', type: 'button', role: 'menuitem', onclick: function () { run(frameDownload); } }, svg(ICON.down), L.frameDownload, h('small', { text: 'PNG' })));
    box.appendChild(msg);
  }
  function placePop() {
    if (!pop.kind || !pop.box || pop.box.hidden) return;
    var r = pop.anchor && pop.anchor.isConnected ? pop.anchor.getBoundingClientRect() : null;
    if (!r || !r.width) { closePop(); return; }
    var b = pop.box.getBoundingClientRect();
    var w = b.width || 360;
    var hh = b.height || 200;
    var L = Lib();
    var rail = L && L.overlay && L.overlay.mode && L.overlay.mode() === 'rail';
    var x;
    var y;
    if (rail) {
      // Beside the vertical toolbar (Shorts); flip to its left when there is no room.
      x = r.right + 8 + w <= innerWidth - 8 ? r.right + 8 : r.left - 8 - w;
      y = Math.min(Math.max(8, r.top), innerHeight - hh - 8);
    } else {
      x = Math.min(Math.max(8, r.left), innerWidth - w - 8);
      y = r.bottom + 8 + hh <= innerHeight - 8 ? r.bottom + 8 : Math.max(8, r.top - 8 - hh);
    }
    pop.box.style.left = Math.round(Math.max(8, x)) + 'px';
    pop.box.style.top = Math.round(y) + 'px';
  }

  // ---- the toolbar's buttons ------------------------------------------------------------------------------------
  var tbButtons = null;
  function syncToolbar() {
    var L = Lib();
    if (L && L.overlay && L.overlay.refresh) L.overlay.refresh();
  }
  function setupToolbar() {
    var L = Lib();
    if (tbButtons || !L || !L.overlay || !L.overlay.addButton) return;
    var ov = L.overlay;
    tbButtons = {
      frame: ov.addButton({ id: 'frame', icon: ICON.camera, title: function () { return T().frame; }, visible: function () { return FT.isOn('frame-capture') && !!ctx().video; }, pressed: function () { return pop.kind === 'frame'; },
        onClick: function (b) { openPop('frame', b); } }),
      // Shorts have no chip row: their comments and the swipe file open from the toolbar.
      comments: ov.addButton({ id: 'comments', icon: ICON.comments, title: function () { return T().comments; }, visible: function () { return FT.isOn('comment-tools') && ctx().kind === 'short'; }, pressed: function () { return pop.kind === 'comments'; },
        onClick: function (b) { openPop('comments', b); } }),
      save: ov.addButton({ id: 'save', icon: ICON.save, title: function () { return T().swipeTitle; }, visible: function () { return FT.isOn('swipe-save') && ctx().kind === 'short'; }, pressed: function () { return pop.kind === 'save'; },
        onClick: function (b) { openPop('save', b); } })
    };
  }

  // ---- loop ---------------------------------------------------------------------------------------------------
  var queued = false;
  function refresh() {
    if (queued) return;
    queued = true;
    setTimeout(function () {
      queued = false;
      setupToolbar();
      var c = ctx();
      if ((c.kind === 'watch' || c.kind === 'short') && c.video) restore(c.video);
      paint();
      if (pop.kind) placePop();
    }, 60);
  }
  var lastUrl = location.href;
  function onNav() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (pop.kind) closePop();
      panelSig = '';
    }
    refresh();
  }
  FT.ready.then(function () {
    scanInline();
    D.onData(refresh);
    FT.onChange(function () { if (bar) bar.sig = ''; panelSig = ''; syncToolbar(); refresh(); });
    document.addEventListener('yt-navigate-finish', onNav);
    document.addEventListener('openoutlier-yt-lib', refresh);
    window.addEventListener('resize', function () { if (pop.kind) placePop(); });
    window.addEventListener('scroll', function () { if (pop.kind) placePop(); }, { passive: true, capture: true });
    setInterval(onNav, 700);
    refresh();
  });

  // For the dev demo page and tests.
  self.OpenOutlierYTTools = { state: state, comments: comments, trans: trans, readTranscript: readTranscript, captureFrame: captureFrame, openPop: openPop, closePop: closePop };
})();
