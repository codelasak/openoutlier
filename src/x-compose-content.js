// OpenOutlier – the draft strip under x.com's compose boxes (docs/x-plan.md 5.3, 5.4, 6; phases 4–6).
//
//   Phase 4 (x.composer, on):    weighted character count, the part shown before "Show more", engagement
//                                bait, similarity to the swipe file and to recently seen posts, link note.
//   Phase 5 (x.llm, off):        draft tools through the x-llm service worker with the user's own key:
//                                score → one fix → variants, hooks, thread split, TR↔EN, idea → draft.
//                                prepare → the exact text and the cost are shown → the user sends → result.
//   Phase 6 (x.reachForecast, off): the forecast for this draft when the Library's model beat the median.
//
// It reads the box's text and the storage; it sends nothing to X. "Put in compose box" only replaces the
// text inside that box (the user reads it, edits it and presses Post / Reply themselves). It never clicks
// Post, Reply or anything else of x.com's. Pure logic: src/x-compose.js.
(async function () {
  'use strict';
  if (window.top !== window || window.__openoutlierXCompose) return;
  window.__openoutlierXCompose = true;

  var XC = self.OpenOutlierXCompose;
  var FT = self.OpenOutlierFeatures;
  var M = self.ReelScopeMetrics;
  if (!XC || !self.OpenOutlierXComposer) return;
  try { if (FT) await FT.ready; } catch (e) { /* defaults */ }

  // x.com's compose boxes: the Draft.js contenteditable of the inline composer (Home), the compose modal,
  // the reply box on a post page and every box of a thread being written (tweetTextarea_0, _1, …).
  var BOX_SEL = '[data-testid^="tweetTextarea_"][contenteditable="true"], [data-testid^="tweetTextarea_"] [contenteditable="true"]';
  var KEYS = { org: 'rs:org', feed: 'rs:x:feed', own: 'rs:x-own', me: 'rs:x:me', forecast: 'rs:x:forecast' };

  var data = { org: null, feed: null, own: null, me: null, forecast: null };
  var strips = [];   // { box, host, root, text, model, tools: { … } }
  var llm = null;    // reelscope:x-llm-status answer
  var llmAt = 0;

  function on(id) { return FT ? FT.isOn(id) : true; }
  function lang() { try { return FT && FT.uiLang() === 'tr' ? 'tr' : 'en'; } catch (e) { return 'en'; } }
  function T(en, tr) { return lang() === 'tr' ? tr : en; }

  try {
    var got = await chrome.storage.local.get([KEYS.org, KEYS.feed, KEYS.own, KEYS.me, KEYS.forecast]);
    Object.keys(KEYS).forEach(function (k) { data[k] = got[KEYS[k]] || null; });
  } catch (e) { /* storage unavailable */ }
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    var hit = false;
    Object.keys(KEYS).forEach(function (k) { if (changes[KEYS[k]]) { data[k] = changes[KEYS[k]].newValue || null; hit = true; } });
    if (hit) strips.forEach(function (s) { s.text = null; });
  });

  // ---- context for the checks -------------------------------------------------------------------------
  function api() { return self.OpenOutlierXApi || null; }
  function meId() {
    var h = (data.own && data.own.handle) || (data.me && data.me.handle);
    return h ? 'x/' + String(h).replace(/^@/, '').toLowerCase() : null;
  }
  function checkCtx() {
    var a = api();
    var id = meId();
    var prof = a && id ? a.profile(id) : null;
    return {
      swipe: XC.swipeTexts(data.org),
      recent: XC.recentTexts(a ? a.pagePosts() : {}, data.feed, id),
      premium: XC.premiumOf(prof)
    };
  }
  function ownExamples() {
    var a = api();
    var id = meId();
    var posts = a && id ? a.posts(id) : null;
    return posts && M ? XC.ownExamples(Object.values(posts), M, 10) : [];
  }

  // ---- the LLM helper's status (cached for 20 s) ------------------------------------------------------
  function refreshLlm(force) {
    if (!force && Date.now() - llmAt < 20000) return;
    llmAt = Date.now();
    try {
      chrome.runtime.sendMessage({ type: 'reelscope:x-llm-status' }).then(function (r) {
        var was = llm && llm.ready;
        llm = r && r.ok ? r : null;
        if (!!(llm && llm.ready) !== !!was) strips.forEach(function (s) { renderTools(s); });
      }, function () { llm = null; });
    } catch (e) { llm = null; }
  }
  function send(msg) {
    try { return chrome.runtime.sendMessage(msg).then(function (r) { return r || { ok: false, error: 'No answer.' }; }, function (e) { return { ok: false, error: String(e && e.message || e) }; }); }
    catch (e) { return Promise.resolve({ ok: false, error: String(e && e.message || e) }); }
  }

  // ---- DOM helpers ------------------------------------------------------------------------------------
  function h(tag, attrs) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      [].concat(arguments[i]).forEach(function (c) { if (c != null && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    }
    return e;
  }
  function btn(label, fn, primary) {
    return h('button', { type: 'button', class: primary ? 'b primary' : 'b', onclick: function (ev) { ev.preventDefault(); ev.stopPropagation(); fn(ev); } }, label);
  }

  var CSS = [
    ':host{all:initial;display:block}',
    '.strip{font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--fg,#0f1419);margin:6px 0 4px;padding:8px 10px;border:1px solid rgba(127,127,127,.3);border-radius:12px;background:rgba(127,127,127,.05)}',
    '@media (prefers-color-scheme: dark){.strip{--fg:#e7e9ea}}',
    '.top{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}',
    '.brand{font-weight:700;letter-spacing:.01em}',
    '.count{font-variant-numeric:tabular-nums;font-weight:600}',
    '.count.over{color:#f4212e}',
    '.dim{opacity:.72}',
    '.hook{margin:4px 0 0;opacity:.8;font-size:12px}',
    '.hook q{font-style:italic}',
    'ul.f{list-style:none;margin:6px 0 0;padding:0}',
    'ul.f li{margin:2px 0;padding:3px 8px;border-radius:8px;background:rgba(127,127,127,.08)}',
    'ul.f li.error{background:rgba(244,33,46,.12)}',
    'ul.f li.warn{background:rgba(255,173,31,.18)}',
    'a{color:#1d9bf0}',
    '.tools{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-items:center}',
    '.b{font:inherit;font-size:12px;color:inherit;background:transparent;border:1px solid rgba(127,127,127,.5);border-radius:999px;padding:2px 10px;cursor:pointer}',
    '.b:hover{background:rgba(127,127,127,.14)}',
    '.b.primary{background:#d4ff3a;color:#0d0d12;border-color:#d4ff3a;font-weight:600}',
    '.b[disabled]{opacity:.5;cursor:default}',
    '.pane{margin-top:8px;padding:8px;border-radius:10px;border:1px dashed rgba(127,127,127,.45)}',
    '.pane p{margin:4px 0}',
    '.pane pre{white-space:pre-wrap;font:12px/1.35 ui-monospace,Menlo,monospace;max-height:220px;overflow:auto;margin:4px 0;padding:6px;background:rgba(127,127,127,.08);border-radius:6px}',
    '.res{margin:6px 0;padding:6px 8px;border-radius:8px;background:rgba(127,127,127,.08)}',
    '.res .t{white-space:pre-wrap}',
    '.row{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;align-items:center}',
    '.score{font-size:20px;font-weight:700}',
    'textarea{width:100%;box-sizing:border-box;font:inherit;color:inherit;background:transparent;border:1px solid rgba(127,127,127,.45);border-radius:8px;padding:6px;min-height:52px}',
    '.chip{display:inline-block;padding:0 6px;border-radius:6px;background:rgba(127,127,127,.18);font-size:11px;margin-right:4px}',
    '.fc{margin-top:4px;font-size:12px}'
  ].join('\n');

  // ---- the box's text, and filling it -------------------------------------------------------------------
  function boxText(box) {
    var t = box.innerText || box.textContent || '';
    return t.replace(/​/g, '').replace(/\n$/, '');
  }
  /**
   * Replace the box's text with `text`. Only the text: nothing is clicked or sent. → Promise<boolean>.
   * Draft.js (x.com) takes a paste event; a plain contenteditable takes execCommand('insertText').
   * Draft.js reads the DOM selection on selectionchange, a tick later: pasting right after selecting used its old
   * caret and appended the text to the draft (live 2026-11-24). So select, wait, then paste.
   */
  function fillBox(box, text) {
    var norm = function (s) { return String(s).replace(/\s+/g, ' ').trim(); };
    function selectAll() {
      box.focus();
      var sel = window.getSelection();
      var r = document.createRange();
      r.selectNodeContents(box);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    function paste() {
      var handled = false;
      try {
        var dt = new DataTransfer();
        dt.setData('text/plain', text);
        var ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        box.dispatchEvent(ev);
        handled = ev.defaultPrevented;
      } catch (e) { handled = false; }
      if (!handled) document.execCommand('insertText', false, text);
    }
    var wait = function (ms) { return new Promise(function (res) { setTimeout(res, ms); }); };
    return (async function () {
      for (var attempt = 0; attempt < 2; attempt++) {
        try { selectAll(); await wait(60 + attempt * 140); paste(); } catch (e) { /* checked below */ }
        await wait(80);
        if (norm(boxText(box)) === norm(text)) return true;
      }
      return false;
    })();
  }

  // ---- strips -------------------------------------------------------------------------------------------
  /** Where the strip goes: right after the editor's container, outside Draft.js's own tree. */
  function anchorOf(box) {
    var label = box.closest('[data-testid^="tweetTextarea_"][data-testid$="_label"]');
    if (label) return label;
    var rich = box.closest('[data-testid$="RichTextInputContainer"]');
    if (rich) return rich;
    var draft = box.closest('.DraftEditor-root');
    var el = draft || box;
    // Climb out of the testid wrapper too, so the strip sits under the whole text area.
    var wrap = el.parentElement && el.parentElement.closest('[data-testid^="tweetTextarea_"]');
    return wrap && wrap !== box ? wrap : el;
  }

  function makeStrip(box) {
    var host = h('div', { class: 'oo-x-compose', 'data-oo-compose': '1' });
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    root.appendChild(h('style', { text: CSS }));
    var wrap = h('div', { class: 'strip' });
    root.appendChild(wrap);
    var s = { box: box, host: host, wrap: wrap, checks: h('div'), toolsEl: h('div'), pane: h('div'), text: null, tool: null, idea: null };
    wrap.appendChild(s.checks);
    wrap.appendChild(s.toolsEl);
    wrap.appendChild(s.pane);
    // Clicks inside the strip must not blur-close x.com's composer.
    host.addEventListener('mousedown', function (e) { if (!(e.target && /TEXTAREA|INPUT/.test((e.composedPath && e.composedPath()[0] || e.target).tagName))) e.preventDefault(); });
    strips.push(s);
    place(s);
    renderTools(s);
    return s;
  }
  // The anchor can sit in a flex *row* (live 2026-11-24: tweetTextarea_0_label's parent is a row next to the
  // avatar), where a full-width strip squeezes the editor to 0 px. Climb until the parent stacks children vertically.
  function isRow(el) {
    try { var cs = getComputedStyle(el); return /flex/.test(cs.display) && !/column/.test(cs.flexDirection); } catch (e) { return false; }
  }
  function placeAfter(a) {
    for (var i = 0; i < 6 && a && a.parentElement && isRow(a.parentElement); i++) a = a.parentElement;
    return a;
  }
  function place(s) {
    var a = placeAfter(anchorOf(s.box));
    if (a && a.parentElement && a.nextSibling !== s.host) a.parentElement.insertBefore(s.host, a.nextSibling);
  }

  function renderChecks(s) {
    var text = boxText(s.box);
    if (text === s.text) return;
    s.text = text;
    var m = XC.stripModel(text, checkCtx(), lang());
    var c = s.checks;
    c.textContent = '';
    var top = h('div', { class: 'top' }, h('span', { class: 'brand', text: 'OpenOutlier' }));
    if (m.empty) {
      top.appendChild(h('span', { class: 'dim', text: T('Draft checks appear as you write. Nothing is sent.', 'Yazdıkça taslak kontrolleri burada. Hiçbir şey gönderilmez.') }));
      c.appendChild(top);
      return;
    }
    top.appendChild(h('span', { class: 'count' + (m.over ? ' over' : ''), title: T('Weighted like X counts it: a link is 23, emoji and CJK are 2.', 'X\'in saydığı gibi: link 23, emoji ve CJK 2 sayılır.'),
      text: m.weighted + ' / ' + m.limit + (m.over ? '' : ' · ' + m.remaining + T(' left', ' kaldı')) }));
    if (m.ok && !m.findings.length) top.appendChild(h('span', { class: 'dim', text: T('No issues found.', 'Sorun bulunmadı.') }));
    c.appendChild(top);
    if (m.hook.truncated) {
      c.appendChild(h('p', { class: 'hook' }, T('Before "Show more": ', '"Daha fazla göster"den önce: '), h('q', { text: m.hook.visible }), ' (' + m.hook.hidden + T(' characters hidden)', ' karakter gizli)')));
    }
    if (m.findings.length) {
      c.appendChild(h('ul', { class: 'f' }, m.findings.map(function (f) {
        return h('li', { class: f.severity }, f.icon + ' ' + f.text, f.url ? [' ', h('a', { href: f.url, target: '_blank', rel: 'noopener', text: T('see post', 'postu gör') })] : null);
      })));
    }
    if (on('x.reachForecast') && data.forecast && data.forecast.model && data.forecast.model.shown && self.OpenOutlierXForecast) {
      try {
        var line = XC.forecastLine(self.OpenOutlierXForecast.forecastDraft(data.forecast.model, { text: text, at: Date.now() }), lang());
        if (line) c.appendChild(h('p', { class: 'fc dim', title: T('Learned from your own posts; shown only because it beat "the post does the median" on held-out posts.', 'Kendi postlarından öğrenildi; test postlarında medyandan isabetli olduğu için gösteriliyor.') }, line));
      } catch (e) { /* no forecast */ }
    }
  }

  // ---- Phase 5 tools ----------------------------------------------------------------------------------
  function renderTools(s) {
    var t = s.toolsEl;
    t.textContent = '';
    if (!llm || !llm.ready) {
      t.appendChild(h('p', { class: 'dim', style: 'margin:6px 0 0;font-size:12px' },
        T('Writing helper is off — Library → Settings → X writing helper; or ask Claude via MCP (x_draft_check).', 'Yazım yardımcısı kapalı — Library → Ayarlar → X yazım yardımcısı; ya da MCP ile Claude\'a sor (x_draft_check).'), ' ',
        btn(T('Open settings', 'Ayarları aç'), function () { send({ type: 'reelscope:open-dashboard', hash: '#/settings' }); })));
      return;
    }
    var row = h('div', { class: 'tools' }, h('span', { class: 'dim', text: T('Draft tools (' + llm.model + '):', 'Taslak araçları (' + llm.model + '):') }));
    function need(fn) { return function () { var d = boxText(s.box).trim(); if (!d) { showMsg(s, T('Write a draft first.', 'Önce bir taslak yaz.')); return; } fn(d); }; }
    row.appendChild(btn(T('Score', 'Puanla'), need(function (d) { run(s, 'scoreDraft', { draft: d }); })));
    row.appendChild(btn(T('Hooks', 'Hook\'lar'), need(function (d) { run(s, 'hooks', { draft: d }); })));
    row.appendChild(btn(T('Split into thread', 'Thread\'e böl'), need(function (d) { run(s, 'splitThread', { text: d }); })));
    row.appendChild(btn(T('Translate TR↔EN', 'Çevir TR↔EN'), need(function (d) { run(s, 'translate', { text: d, to: /[çğıöşüÇĞİÖŞÜ]/.test(d) ? 'en' : 'tr' }); })));
    row.appendChild(btn(T('Idea → draft', 'Fikirden taslağa'), function () { ideaForm(s, boxText(s.box).trim(), '', null); }));
    t.appendChild(row);
  }
  function showMsg(s, text) { s.pane.textContent = ''; s.pane.appendChild(h('div', { class: 'pane' }, h('p', { class: 'dim', text: text }))); }

  function ideaForm(s, idea, material, question) {
    s.pane.textContent = '';
    var ia = h('textarea', { placeholder: T('The idea, in a line or two', 'Fikir, bir iki satırda') });
    ia.value = idea || '';
    var ma = h('textarea', { placeholder: T('Your own experience, data or example (the draft is built around it)', 'Kendi deneyimin, verin ya da örneğin (taslak bunun etrafında kurulur)') });
    ma.value = material || '';
    s.pane.appendChild(h('div', { class: 'pane' },
      h('p', null, h('b', { text: T('Idea → draft', 'Fikirden taslağa') })),
      ia,
      h('p', { text: question || T('What is your own experience, data or example for this?', 'Bunun için kendi deneyimin, verin ya da örneğin ne?') }),
      ma,
      h('div', { class: 'row' },
        btn(T('Prepare', 'Hazırla'), function () { run(s, 'ideaToDraft', { idea: ia.value.trim(), material: ma.value.trim() || undefined }); }, true),
        btn(T('Close', 'Kapat'), function () { s.pane.textContent = ''; }))));
  }

  function errorBox(s, r) {
    var codes = { disabled: 1, no_key: 1, no_permission: 1, no_sdk: 1 };
    s.pane.textContent = '';
    s.pane.appendChild(h('div', { class: 'pane' }, h('p', { text: '⚠ ' + (r.error || T('Something went wrong.', 'Bir şey ters gitti.')) }),
      codes[r.code] ? h('div', { class: 'row' }, btn(T('Open settings', 'Ayarları aç'), function () { send({ type: 'reelscope:open-dashboard', hash: '#/settings' }); }),
        h('span', { class: 'dim', text: T('Or ask Claude through MCP (x_draft_check): no key needed.', 'Ya da MCP ile Claude\'a sor (x_draft_check): anahtar gerekmez.') })) : null,
      h('div', { class: 'row' }, btn(T('Close', 'Kapat'), function () { s.pane.textContent = ''; }))));
  }

  /** prepare → preview (exact text, cost) → the user sends or cancels. */
  function run(s, task, input) {
    showMsg(s, T('Preparing… (nothing is sent yet)', 'Hazırlanıyor… (henüz bir şey gönderilmedi)'));
    send({ type: 'reelscope:x-llm-prepare', task: task, input: input, examples: ownExamples() }).then(function (r) {
      if (!r.ok) {
        if (r.code === 'need_material') return ideaForm(s, input.idea, input.material, r.question && (r.question[lang()] || r.question.en));
        return errorBox(s, r);
      }
      preview(s, r, input);
    });
  }
  function preview(s, prep, input) {
    var info = XC.previewInfo(prep, lang());
    s.pane.textContent = '';
    var sendB, cancelB;
    s.pane.appendChild(h('div', { class: 'pane' },
      h('p', null, h('b', { text: T('Check before sending', 'Göndermeden önce bak') }), ' · ', info.summary),
      h('p', { class: 'dim', text: info.spend }),
      h('details', null, h('summary', { text: T('The exact text that will be sent', 'Gönderilecek metnin tamamı') }),
        info.context ? [h('p', { class: 'dim', text: T('Context (your voice profile, your own outliers):', 'Bağlam (ses profilin, kendi outlier\'ların):') }), h('pre', { text: info.context })] : null,
        h('p', { class: 'dim', text: T('Message:', 'Mesaj:') }), h('pre', { text: info.message })),
      h('div', { class: 'row' },
        sendB = btn(T('Send', 'Gönder'), function () {
          sendB.disabled = cancelB.disabled = true;
          sendB.textContent = T('Asking…', 'Soruluyor…');
          send({ type: 'reelscope:x-llm-confirm', id: prep.id }).then(function (r) { if (!r.ok) return errorBox(s, r); result(s, prep.task, r, input); });
        }, true),
        cancelB = btn(T('Cancel', 'Vazgeç'), function () { send({ type: 'reelscope:x-llm-cancel', id: prep.id }); s.pane.textContent = ''; }))));
  }

  function fillButton(s, text) {
    var b = btn(T('Put in compose box', 'Yazma kutusuna aktar'), function () {
      if (!s.box.isConnected) { b.textContent = T('The compose box is gone', 'Yazma kutusu kapandı'); return; }
      b.disabled = true;
      fillBox(s.box, text).then(function (ok) {
        if (!ok) { try { navigator.clipboard.writeText(text); } catch (e) { /* no clipboard */ } }
        b.textContent = ok ? T('In the box — edit it, then press Post yourself', 'Kutuda — düzenle, Post\'a sen bas') : T('Could not fill; copied instead', 'Doldurulamadı; kopyalandı');
        b.disabled = false;
        s.text = null;
      });
    });
    return b;
  }
  function copyButton(text) {
    var b = btn(T('Copy', 'Kopyala'), function () { navigator.clipboard.writeText(text).then(function () { b.textContent = T('Copied', 'Kopyalandı'); }, function () {}); });
    return b;
  }
  function textResult(s, text, note) {
    return h('div', { class: 'res' }, h('div', { class: 't', text: text }), note ? h('p', { class: 'dim', text: note }) : null,
      h('div', { class: 'row' }, fillButton(s, text), copyButton(text)));
  }

  function result(s, task, r, input) {
    var res = r.result || {};
    var box = h('div', { class: 'pane' });
    if (task === 'scoreDraft') {
      box.appendChild(h('p', null, h('span', { class: 'score', text: String(res.score) }), ' / 100', res.penalty ? h('span', { class: 'dim', text: T('  (−' + res.penalty + ' engagement bait)', '  (−' + res.penalty + ' etkileşim dilenme)') }) : null));
      box.appendChild(h('ul', { class: 'f' }, (res.criteria || []).map(function (c) { return h('li', null, h('b', { text: c.id + ' ' + c.points + '/' + c.max }), ' ', c.note || ''); })));
      if (res.fix) {
        box.appendChild(h('p', null, h('b', { text: T('One fix: ', 'Tek düzeltme: ') }), res.fix.instruction, h('br'), h('span', { class: 'dim', text: res.fix.why || '' })));
        box.appendChild(h('div', { class: 'row' }, btn(T('3 variants with this fix', 'Bu düzeltmeyle 3 varyant'), function () { run(s, 'variants', { draft: input.draft, fix: res.fix }); }, true)));
      }
      if (res.rationale) box.appendChild(h('p', { class: 'dim', text: res.rationale }));
    } else if (task === 'variants') {
      (res.variants || []).forEach(function (v) { box.appendChild(textResult(s, v.text, v.note)); });
    } else if (task === 'hooks') {
      (res.hooks || []).forEach(function (x) {
        var full = XC.replaceFirstLine(boxText(s.box), x.text);
        box.appendChild(h('div', { class: 'res' }, h('span', { class: 'chip', text: x.pattern || 'hook' }), h('span', { class: 't', text: x.text }),
          h('div', { class: 'row' }, fillButton(s, full), copyButton(x.text))));
      });
      box.appendChild(h('p', { class: 'dim', text: T('"Put in compose box" swaps only the first line of your draft.', '"Yazma kutusuna aktar" taslağın sadece ilk satırını değiştirir.') }));
    } else if (task === 'splitThread') {
      (res.posts || []).forEach(function (p, i) { box.appendChild(textResult(s, p.text, (i + 1) + '/' + res.posts.length + ' · ' + p.length + (p.over ? T(' — over 280', ' — 280\'i aşıyor') : ''))); });
      box.appendChild(h('p', { class: 'dim', text: T('Add the next post with x.com\'s own + button; each box gets its own strip.', 'Sonraki postu x.com\'un + butonuyla ekle; her kutunun kendi şeridi olur.') }));
      if (res.note) box.appendChild(h('p', { class: 'dim', text: res.note }));
    } else if (task === 'translate') {
      box.appendChild(textResult(s, res.text, res.note));
    } else if (task === 'ideaToDraft') {
      box.appendChild(textResult(s, res.draft, (res.placeholders || []).length ? T('Fill in: ', 'Doldur: ') + res.placeholders.join(', ') : null));
    }
    box.appendChild(h('p', { class: 'dim', text: XC.costLine(r.cost, r.model) + (r.fallback ? T(' (answered by a fallback model)', ' (yedek model yanıtladı)') : '') }));
    box.appendChild(h('p', { class: 'dim', text: T('A starting draft: edit it in your own words. OpenOutlier never posts.', 'Bir başlangıç taslağı: kendi sözlerinle düzenle. OpenOutlier asla paylaşmaz.') }));
    box.appendChild(h('div', { class: 'row' }, btn(T('Close', 'Kapat'), function () { s.pane.textContent = ''; })));
    s.pane.textContent = '';
    s.pane.appendChild(box);
  }

  // ---- finding boxes, keeping strips in sync ---------------------------------------------------------------
  function boxes() {
    var out = [];
    document.querySelectorAll(BOX_SEL).forEach(function (b) {
      var own = /^tweetTextarea_\d+$/.test(b.getAttribute('data-testid') || '');
      // The editable itself carries tweetTextarea_N; otherwise it must sit inside a tweetTextarea_N wrapper
      // (not just inside the _label / RichTextInputContainer ones).
      if (!own && !b.closest('[data-testid^="tweetTextarea_"]:not([data-testid$="_label"]):not([data-testid$="RichTextInputContainer"])')) return;
      if (out.indexOf(b) === -1) out.push(b);
    });
    return out;
  }
  function tick() {
    if (!on('x.composer')) {
      strips.forEach(function (s) { s.host.remove(); });
      strips = [];
      return;
    }
    var live = boxes();
    strips = strips.filter(function (s) { if (live.indexOf(s.box) === -1 || !s.box.isConnected) { s.host.remove(); return false; } return true; });
    live.forEach(function (b) { if (!strips.some(function (s) { return s.box === b; })) makeStrip(b); });
    if (strips.length) refreshLlm(false);
    strips.forEach(function (s) { if (!s.host.isConnected || s.host.previousSibling !== anchorOf(s.box)) place(s); renderChecks(s); });
  }
  var queued = false;
  function soon() { if (queued) return; queued = true; setTimeout(function () { queued = false; tick(); }, 250); }
  document.addEventListener('input', soon, true);
  document.addEventListener('keyup', soon, true);
  document.addEventListener('paste', function () { setTimeout(soon, 50); }, true);
  new MutationObserver(soon).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(tick, 1500);
  if (FT && FT.onChange) FT.onChange(function (changed) { if (changed.some(function (k) { return /^x\./.test(k); })) { strips.forEach(function (s) { s.text = null; }); refreshLlm(true); soon(); } });
  refreshLlm(true);
  tick();

  // For src/x-growth-content.js (reply angles): fill a post page's reply box the same way.
  self.OpenOutlierXFill = { fill: fillBox, boxes: boxes, text: boxText };
})();
