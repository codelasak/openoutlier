// OpenOutlier Library – Settings (#/settings): the Features list (the same one the
// YouTube panel's Features tab shows, src/features-view.js), the YouTube Data API
// key with "Copy key to bridge", the bridge's state and the label language.
// Everything is stored in chrome.storage (rs:settings); the service worker
// (src/agent-bridge.js) passes the feature switches on to the bridge.
(function (root) {
  'use strict';

  var F = root.OpenOutlierFeatures;
  var FV = root.OpenOutlierFeaturesView;
  var SETTINGS_KEY = 'rs:settings';
  var API_ORIGIN = 'https://www.googleapis.com/*';

  var S = {
    en: {
      title: 'Settings', sub: 'Features, keys and the bridge',
      features: 'Features',
      lang: 'Language', langHint: 'For the Features list and this page. Auto follows YouTube\'s language on YouTube and Chrome\'s here.',
      langAuto: 'Auto', apiTitle: 'YouTube Data API key',
      apiText: 'Your own key from Google Cloud (YouTube Data API v3). Free quota: 10,000 units a day. Without a key OpenOutlier never calls the API.',
      apiSaved: 'Saved (…{k}).', apiNone: 'No key in this browser.', save: 'Save', removeKey: 'Remove the key',
      apiBad: 'That doesn\'t look like an API key (letters, digits, - and _, usually 39 characters starting with AIza).',
      apiPerm: 'Chrome needs permission to reach www.googleapis.com for the key to work. Nothing was saved.',
      apiSavedMsg: 'Saved. The key stays in this browser until you copy it to the bridge.', apiRemovedMsg: 'Removed from this browser.',
      quota: 'Used today: {u} of {l} units ({e} in this browser, {b} by the bridge). Resets at midnight Pacific time.',
      copy: 'Copy key to bridge', copyAgain: 'Copy again', uncopy: 'Remove from bridge',
      copied: 'Copied. The bridge keeps it in ~/.openoutlier/youtube-api-key, readable only by you.', uncopied: 'Removed from the bridge.',
      bridgeTitle: 'Bridge on this Mac',
      bridgeOn: 'Connected on port {p}.', bridgeOff: 'Not connected.',
      bridgeKeyYes: 'The bridge has an API key ({s}).', bridgeKeyNo: 'The bridge has no API key yet: background jobs can\'t use the API.',
      bridgeHow: 'Background jobs (niche tracking, your channel\'s daily history) run in the OpenOutlier bridge, which stays on through launchd, also while Chrome is closed. Install it once from the OpenOutlier folder:',
      bridgeMore: 'README → "Connect AI agents". The bridge answers only this extension, on 127.0.0.1.',
      srcFile: 'from the key file', srcEnv: 'from OPENOUTLIER_YOUTUBE_API_KEY'
    },
    tr: {
      title: 'Ayarlar', sub: 'Özellikler, anahtarlar ve bridge',
      features: 'Özellikler',
      lang: 'Dil', langHint: 'Özellikler listesi ve bu sayfa için. Otomatik: YouTube\'da YouTube\'un dili, burada Chrome\'un dili.',
      langAuto: 'Otomatik', apiTitle: 'YouTube Data API anahtarı',
      apiText: 'Google Cloud\'dan kendi anahtarın (YouTube Data API v3). Bedava kota günde 10.000 birim. Anahtar yoksa OpenOutlier API\'yi hiç çağırmaz.',
      apiSaved: 'Kayıtlı (…{k}).', apiNone: 'Bu tarayıcıda anahtar yok.', save: 'Kaydet', removeKey: 'Anahtarı sil',
      apiBad: 'Bu bir API anahtarına benzemiyor (harf, rakam, - ve _; genelde AIza ile başlayan 39 karakter).',
      apiPerm: 'Anahtarın çalışması için Chrome\'un www.googleapis.com\'a erişim izni gerekiyor. Hiçbir şey kaydedilmedi.',
      apiSavedMsg: 'Kaydedildi. Bridge\'e kopyalayana kadar anahtar bu tarayıcıda kalır.', apiRemovedMsg: 'Bu tarayıcıdan silindi.',
      quota: 'Bugün kullanılan: {u} / {l} birim (bu tarayıcı {e}, bridge {b}). Pasifik saatiyle gece yarısı sıfırlanır.',
      copy: 'Anahtarı bridge\'e kopyala', copyAgain: 'Tekrar kopyala', uncopy: 'Bridge\'den sil',
      copied: 'Kopyalandı. Bridge onu ~/.openoutlier/youtube-api-key dosyasında tutar, yalnız sen okuyabilirsin.', uncopied: 'Bridge\'den silindi.',
      bridgeTitle: 'Bu Mac\'teki bridge',
      bridgeOn: '{p} portunda bağlı.', bridgeOff: 'Bağlı değil.',
      bridgeKeyYes: 'Bridge\'de API anahtarı var ({s}).', bridgeKeyNo: 'Bridge\'de henüz API anahtarı yok: arka plan işleri API\'yi kullanamaz.',
      bridgeHow: 'Arka plan işleri (niş takibi, kanalının günlük geçmişi) OpenOutlier bridge\'inde çalışır; launchd sayesinde Chrome kapalıyken de açık kalır. OpenOutlier klasöründen bir kez kur:',
      bridgeMore: 'README → "Connect AI agents". Bridge yalnız bu eklentiye, 127.0.0.1 üzerinden cevap verir.',
      srcFile: 'anahtar dosyasından', srcEnv: 'OPENOUTLIER_YOUTUBE_API_KEY\'den'
    }
  };

  function create(env) {
    var h = env.h;
    var nf = new Intl.NumberFormat();
    var st = { flags: F.flags(), env: {}, settings: {}, bridge: {}, quota: null, msg: '', apiMsg: '', bridgeMsg: '', busy: false };

    async function load() {
      await F.ready;
      var r = await chrome.storage.local.get([SETTINGS_KEY, 'rs:bridge', 'rs:yt-api-quota']);
      st.settings = r[SETTINGS_KEY] || {};
      st.bridge = r['rs:bridge'] || {};
      st.quota = r['rs:yt-api-quota'] || null;
      st.flags = F.flags();
      st.env = await F.env();
    }

    function L() { return S[F.uiLang()] || S.en; }
    function fill(s, o) { return s.replace(/\{(\w)\}/g, function (_, k) { return o[k] != null ? o[k] : ''; }); }
    function isKey(k) { return typeof k === 'string' && /^[A-Za-z0-9_-]{30,60}$/.test(k.trim()); }

    async function setSetting(key, value) {
      var r = await chrome.storage.local.get(SETTINGS_KEY);
      var s = Object.assign({}, r[SETTINGS_KEY]);
      if (value === null) delete s[key]; else s[key] = value;
      var o = {};
      o[SETTINGS_KEY] = s;
      await chrome.storage.local.set(o);
    }

    async function bridgeKey(action) {
      st.busy = true;
      env.rerender();
      var r = await chrome.runtime.sendMessage({ type: 'reelscope:bridge-key', action: action }).catch(function (e) { return { ok: false, error: e.message }; });
      st.busy = false;
      st.bridgeMsg = r && r.ok ? (action === 'remove' ? L().uncopied : L().copied) : String((r && r.error) || '?');
      await load();
      env.rerender();
    }

    function fix(code) {
      if (code === 'tracker') { F.set('tracker', true); return; }
      if (code === 'copyKey') { bridgeKey('copy'); return; }
      if (code === 'oauth') { location.hash = '#/my-youtube'; return; }
      var el = document.getElementById(code === 'bridge' ? 'set-bridge' : 'set-apikey');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.add('flash');
        setTimeout(function () { el.classList.remove('flash'); }, 1600);
        var input = el.querySelector('input');
        if (input) input.focus({ preventScroll: true });
      }
    }

    function langCard(T) {
      var cur = st.settings.uiLang === 'tr' || st.settings.uiLang === 'en' ? st.settings.uiLang : 'auto';
      return h('section', { class: 'm-card set-card' },
        h('h2', { text: T.lang }),
        h('div', { class: 'seg', role: 'group', 'aria-label': T.lang },
          [['auto', T.langAuto], ['tr', 'Türkçe'], ['en', 'English']].map(function (o) {
            return h('button', { type: 'button', 'aria-pressed': cur === o[0] ? 'true' : 'false', onclick: function () { setSetting('uiLang', o[0] === 'auto' ? null : o[0]); } }, o[1]);
          })),
        h('p', { class: 'muted small', text: T.langHint }));
    }

    function apiCard(T) {
      var key = st.settings.youtubeApiKey;
      var on = isKey(key);
      var A = root.OpenOutlierYouTubeApi;
      var mine = A ? A.usedToday(st.quota) : 0;
      var onBridge = A ? A.usedToday(st.bridge.bridgeQuota) : 0;
      // The page re-renders on storage changes (the bridge state every ~30 s): keep what was typed.
      var input = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: on ? fill(T.apiSaved, { k: key.slice(-4) }) : 'AIza…', 'aria-label': T.apiTitle,
        oninput: function (e) { st.draft = e.target.value; } });
      input.value = st.draft || '';
      var connected = st.env.bridge;
      return h('section', { class: 'm-card set-card', id: 'set-apikey' },
        h('h2', { text: T.apiTitle }),
        h('p', { class: 'muted small', text: T.apiText }),
        h('p', { class: 'set-state' + (on ? ' is-ok' : ''), text: on ? fill(T.apiSaved, { k: key.slice(-4) }) : T.apiNone }),
        h('form', { class: 'set-keyrow', onsubmit: async function (e) {
          e.preventDefault();
          var k = input.value.trim();
          if (!isKey(k)) { st.apiMsg = T.apiBad; env.rerender(); return; }
          var granted = false;
          try { granted = await chrome.permissions.request({ origins: [API_ORIGIN] }); } catch (err) { granted = false; }
          if (!granted) { st.apiMsg = T.apiPerm; env.rerender(); return; }
          st.draft = '';
          await setSetting('youtubeApiKey', k);
          st.apiMsg = T.apiSavedMsg;
        } }, input, h('button', { class: 'btn', type: 'submit' }, T.save)),
        on ? h('p', { class: 'muted small', text: fill(T.quota, { u: nf.format(mine + onBridge), l: nf.format(10000), e: nf.format(mine), b: nf.format(onBridge) }) }) : null,
        st.apiMsg ? h('p', { class: 'm-msg', role: 'status', text: st.apiMsg }) : null,
        h('div', { class: 'm-actions set-actions' },
          on && connected ? h('button', { class: 'btn btn-primary', type: 'button', disabled: st.busy, onclick: function () { bridgeKey('copy'); } }, st.env.bridgeKey ? T.copyAgain : T.copy) : null,
          on ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: async function () {
            await setSetting('youtubeApiKey', '');
            chrome.permissions.remove({ origins: [API_ORIGIN] }).catch(function () {});
            st.apiMsg = T.apiRemovedMsg;
          } }, T.removeKey) : null));
    }

    function bridgeCard(T) {
      var b = st.bridge;
      var connected = st.env.bridge;
      var src = b.bridgeApiKeySource === 'env' ? T.srcEnv : T.srcFile;
      return h('section', { class: 'm-card set-card', id: 'set-bridge' },
        h('h2', { text: T.bridgeTitle }),
        h('p', { class: 'set-state' + (connected ? ' is-ok' : ' is-off'), text: connected ? fill(T.bridgeOn, { p: b.port }) : T.bridgeOff }),
        connected && st.env.bridgeKey != null ? h('p', { class: 'muted small', text: st.env.bridgeKey ? fill(T.bridgeKeyYes, { s: src }) : T.bridgeKeyNo }) : null,
        st.bridgeMsg ? h('p', { class: 'm-msg', role: 'status', text: st.bridgeMsg }) : null,
        connected && st.env.bridgeKey && b.bridgeApiKeySource === 'file'
          ? h('div', { class: 'm-actions set-actions' }, h('button', { class: 'btn btn-ghost', type: 'button', disabled: st.busy, onclick: function () { bridgeKey('remove'); } }, T.uncopy)) : null,
        connected ? null : [h('p', { class: 'muted small', text: T.bridgeHow }), h('pre', { class: 'set-code' }, h('code', { text: 'sh mcp/launchd/install.sh' })), h('p', { class: 'muted small', text: T.bridgeMore })]);
    }

    function render(main) {
      var T = L();
      var active = document.activeElement;
      var refocus = active && main.contains(active) ? (active.closest('[data-feature]') ? '[data-feature="' + active.closest('[data-feature]').getAttribute('data-feature') + '"] input' : active.id === '' && active.closest('#set-apikey') && active.tagName === 'INPUT' ? '#set-apikey input' : null) : null;
      main.classList.remove('has-panel');
      main.textContent = '';
      main.appendChild(h('div', { class: 'view-head' }, h('h1', { text: T.title }), h('span', { class: 'sub', text: T.sub })));
      var list = FV.render({
        h: h, lang: F.uiLang(), flags: st.flags, env: st.env, message: st.msg,
        onToggle: function (id, on) { st.msg = ''; F.set(id, on); },
        onFix: fix,
        onReset: function () { F.reset().then(function () { st.msg = T === S.tr ? S.tr.features + ': varsayılanlar geri yüklendi.' : 'Features: defaults restored.'; return load(); }).then(env.rerender); }
      });
      main.appendChild(h('div', { class: 'set-grid' },
        h('section', { class: 'set-main', 'aria-label': T.features }, h('h2', { class: 'set-h', text: T.features }), list),
        h('aside', { class: 'set-side' }, apiCard(T), bridgeCard(T), langCard(T))));
      if (refocus) { var el = main.querySelector(refocus); if (el) el.focus({ preventScroll: true }); }
    }

    function title() { return L().title; }

    // Any change (this page, the popup, a YouTube tab, the bridge state) re-renders.
    F.onChange(function () { load().then(env.rerender); });
    chrome.storage.onChanged.addListener(function (c, area) { if (area === 'local' && c['rs:yt-api-quota']) load().then(env.rerender); });

    return { load: load, render: render, title: title };
  }

  root.OpenOutlierSettingsView = { create: create };
})(typeof self !== 'undefined' ? self : this);
