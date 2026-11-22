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
      lang: 'Language', langHint: 'For the Library, the YouTube panel and cards, and the popup. Auto follows YouTube\'s language on YouTube and Chrome\'s here.',
      langAuto: 'Auto', apiTitle: 'YouTube Data API key',
      apiText: 'Your own key from Google Cloud (YouTube Data API v3). Free quota: 10,000 units a day. Without a key OpenOutlier never calls the API.',
      apiSaved: 'Saved (…{k}).', apiNone: 'No key in this browser.', apiReplace: 'Paste a new key to replace it', save: 'Save', removeKey: 'Remove the key',
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
      srcFile: 'from the key file', srcEnv: 'from OPENOUTLIER_YOUTUBE_API_KEY',
      prov: {
        title: 'Provider keys', text: 'Third-party APIs, all off. A provider makes no request until its feature is on (Features → Optional providers) and its API key is here. Keys go to the bridge only (~/.openoutlier/providers.json, readable only by you, never in backups) and are never shown again.',
        noBridge: 'Keys are kept by the bridge on this Mac, and it isn\'t connected.', on: 'on', off: 'off', keySet: 'key set', noKey: 'no key', noKeyNeeded: 'no key needed',
        scraping: 'scraping-based', scrapingTip: 'The provider scrapes YouTube. YouTube\'s API policy (§III.E.6) doesn\'t allow that data next to an API key in the same app, so it is a separate switch and its rows are labelled.',
        paid: 'paid', free: 'free', save: 'Save key', remove: 'Remove key', savedMsg: 'Saved on the bridge.', removedMsg: 'Removed from the bridge.',
        fields: { clientId: 'Client ID', token: 'Token', login: 'API login', password: 'API password' },
        sbScope: 'Channels', sbScopeSmall: 'Tracked, under 100K subscribers', sbScopeAll: 'All tracked', sbHistory: 'History', sb30: '30 days (1 credit)', sb1y: '1 year (2 credits)', sb3y: '3 years (3 credits)', sbQuote: 'Show the cost', sbQuoteLine: { one: '{n} tracked channel × {p} credits = {c} credits (about ${u}).', other: '{n} tracked channels × {p} credits = {c} credits (about ${u}).' }, sbFree: { one: '{n} asked in the last 30 days: free.', other: '{n} asked in the last 30 days: free.' },
        sbGo: 'Backfill for {c} credits', sbDone: { one: 'Backfilled {n} channel ({d} days); {u} credits used.', other: 'Backfilled {n} channels ({d} days); {u} credits used.' }, sbLeft: '{l} credits left.', sbOff: 'Turn on Social Blade in Features to backfill.',
        dfsLine: { one: '{n} keyword tracked for rank (Niche tracking → Keywords), about ${c} a day.', other: '{n} keywords tracked for rank (Niche tracking → Keywords), about ${c} a day.' }, dfsCheck: 'Check now', dfsDone: { one: 'Checked {n} keyword.', other: 'Checked {n} keywords.' }, dfsNone: 'Pick keywords in Niche tracking → Keywords → Track rank.'
      }
    },
    tr: {
      title: 'Ayarlar', sub: 'Özellikler, anahtarlar ve bridge',
      features: 'Özellikler',
      lang: 'Dil', langHint: 'Kütüphane, YouTube paneli ve kartları, popup için. Otomatik: YouTube\'da YouTube\'un dili, burada Chrome\'un dili.',
      langAuto: 'Otomatik', apiTitle: 'YouTube Data API anahtarı',
      apiText: 'Google Cloud\'dan kendi anahtarın (YouTube Data API v3). Bedava kota günde 10.000 birim. Anahtar yoksa OpenOutlier API\'yi hiç çağırmaz.',
      apiSaved: 'Kayıtlı (…{k}).', apiNone: 'Bu tarayıcıda anahtar yok.', apiReplace: 'Değiştirmek için yeni anahtarı yapıştır', save: 'Kaydet', removeKey: 'Anahtarı sil',
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
      srcFile: 'anahtar dosyasından', srcEnv: 'OPENOUTLIER_YOUTUBE_API_KEY\'den',
      prov: {
        title: 'Servis anahtarları', text: 'Üçüncü parti API\'ler, hepsi kapalı. Bir servis, özelliği açılıp (Özellikler → İsteğe bağlı servisler) API anahtarı buraya eklenmeden hiçbir istek atmaz. Anahtarlar sadece bridge\'e gider (~/.openoutlier/providers.json, yalnız sen okuyabilirsin, yedeklere girmez) ve bir daha gösterilmez.',
        noBridge: 'Anahtarları bu Mac\'teki bridge tutar ve bridge bağlı değil.', on: 'açık', off: 'kapalı', keySet: 'anahtar var', noKey: 'anahtar yok', noKeyNeeded: 'anahtar gerekmez',
        scraping: 'scraping tabanlı', scrapingTip: 'Servis YouTube\'u kazıyor. YouTube\'un API politikası (§III.E.6) bu veriyi aynı uygulamada bir API anahtarıyla kullanmaya izin vermiyor; bu yüzden ayrı bir ayar ve satırları ayrı etiketli.',
        paid: 'ücretli', free: 'bedava', save: 'Anahtarı kaydet', remove: 'Anahtarı sil', savedMsg: 'Bridge\'e kaydedildi.', removedMsg: 'Bridge\'den silindi.',
        fields: { clientId: 'Client ID', token: 'Token', login: 'API kullanıcı adı', password: 'API parolası' },
        sbScope: 'Kanallar', sbScopeSmall: 'Takip edilenler, 100K abone altı', sbScopeAll: 'Tüm takip edilenler', sbHistory: 'Geçmiş', sb30: '30 gün (1 kredi)', sb1y: '1 yıl (2 kredi)', sb3y: '3 yıl (3 kredi)', sbQuote: 'Maliyeti göster', sbQuoteLine: '{n} takip edilen kanal × {p} kredi = {c} kredi (yaklaşık ${u}).', sbFree: '{n} kanal son 30 günde soruldu: bedava.',
        sbGo: '{c} krediyle geçmişi çek', sbDone: '{n} kanalın geçmişi yüklendi ({d} gün); {u} kredi kullanıldı.', sbLeft: '{l} kredi kaldı.', sbOff: 'Geçmiş çekmek için Özellikler\'den Social Blade\'i aç.',
        dfsLine: 'Sırası takip edilen {n} kelime (Niş Takibi → Anahtar kelimeler), günde yaklaşık ${c}.', dfsCheck: 'Şimdi kontrol et', dfsDone: '{n} kelime kontrol edildi.', dfsNone: 'Kelimeleri Niş Takibi → Anahtar kelimeler → Sırayı takip et ile seç.'
      }
    }
  };

  function create(env) {
    var h = env.h;
    function nf() { return new Intl.NumberFormat(F.uiLang() === 'tr' ? 'tr-TR' : 'en-US'); }
    var st = { flags: F.flags(), env: {}, settings: {}, bridge: {}, quota: null, msg: '', apiMsg: '', bridgeMsg: '', busy: false };

    async function load() {
      await F.ready;
      var r = await chrome.storage.local.get([SETTINGS_KEY, 'rs:bridge', 'rs:yt-api-quota']);
      st.settings = r[SETTINGS_KEY] || {};
      st.bridge = r['rs:bridge'] || {};
      st.quota = r['rs:yt-api-quota'] || null;
      st.flags = F.flags();
      st.env = await F.env();
      if (st.env.bridge) {
        var p = await chrome.runtime.sendMessage({ type: 'reelscope:discovery', what: 'providers' }).catch(function () { return null; });
        st.providers = p && p.ok ? p.providers : null;
        st.providersOld = !!(p && p.oldBridge);
      } else st.providers = null;
    }

    function L() { return S[F.uiLang()] || S.en; }
    function fill(s, o) { return s.replace(/\{(\w)\}/g, function (_, k) { return o[k] != null ? o[k] : ''; }); }
    function isKey(k) { return typeof k === 'string' && /^[A-Za-z0-9_-]{30,60}$/.test(k.trim()); }

    // Every write goes through the shared helper (src/features.js): only this key changes, from a fresh read.
    function setSetting(key, value) {
      var p = {};
      p[key] = value === null ? undefined : value;
      return F.updateSettings(p);
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
      var el = document.getElementById(code === 'bridge' ? 'set-bridge' : code === 'providerKey' ? 'set-providers' : 'set-apikey');
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
      var input = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: on ? T.apiReplace : 'AIza…', 'aria-label': T.apiTitle,
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
        on ? h('p', { class: 'muted small', text: fill(T.quota, { u: nf().format(mine + onBridge), l: nf().format(10000), e: nf().format(mine), b: nf().format(onBridge) }) }) : null,
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


    // ---- phase 5: optional providers (mcp/providers/) ----------------------------------------------------
    // A string, or plural forms ({ one, other }) picked by o.n (B5).
    function fill2(s, o) {
      if (s && typeof s === 'object') { var rule = 'other'; try { rule = new Intl.PluralRules(F.locale()).select(Number(o.n)); } catch (e) { /* other */ } s = s[rule] != null ? s[rule] : s.other; }
      return String(s).replace(/\{(\w+)\}/g, function (_, k) { return o[k] != null ? o[k] : ''; });
    }
    var pv = { drafts: {}, msg: {}, sbHistory: '1y', sbScope: '100000', quote: null, busy: false };
    async function provCall(what, extra) {
      pv.busy = true;
      env.rerender();
      var r = await chrome.runtime.sendMessage(Object.assign({ type: 'reelscope:discovery', what: what }, extra || {})).catch(function (e) { return { ok: false, error: e.message }; });
      pv.busy = false;
      return r || { ok: false, error: '?' };
    }
    function providersCard(T) {
      var P = T.prov;
      var lg = F.uiLang();
      var list = F.FEATURES.filter(function (f) { return f.group === 'providers'; });
      var body = [];
      if (!st.env.bridge || !st.providers) body.push(h('p', { class: 'muted small', text: st.providersOld ? T.bridgeOn.replace('{p}', st.bridge.port) + ' ' + (lg === 'tr' ? 'Bridge eski: yeniden başlat.' : 'The bridge is older: restart it.') : P.noBridge }));
      list.forEach(function (f) {
        var id = f.provider;
        var info = st.providers && st.providers[id];
        var on = !!st.flags[f.id];
        var scraping = f.notes.indexOf('scraping') !== -1;
        var paid = f.notes.indexOf('paid') !== -1;
        var head = h('div', { class: 'set-prov-head' },
          h('b', { text: info ? info.name : f.label[lg] }),
          h('span', { class: 'set-pill' + (on ? ' is-on' : ''), text: on ? P.on : P.off }),
          info ? h('span', { class: 'set-pill' + (info.configured && info.needs_key ? ' is-ok' : ''), text: !info.needs_key ? P.noKeyNeeded : info.configured ? P.keySet : P.noKey }) : null,
          // The English word stays English under TR uppercase ("SCRAPING", not "SCRAPİNG").
          scraping ? h('span', { class: 'set-pill is-warn', title: P.scrapingTip }, h('span', { lang: 'en', text: 'scraping' }), P.scraping.replace(/^scraping/, '')) : null,
          h('span', { class: 'set-pill is-soft', text: paid ? P.paid : P.free }));
        var rows = [head];
        if (info && info.cost) rows.push(h('p', { class: 'muted small', text: info.cost[lg] || info.cost.en }));
        if (info && info.needs_key) {
          var inputs = info.fields.map(function (k) {
            var i = h('input', { type: k === 'clientId' || k === 'login' ? 'text' : 'password', autocomplete: 'off', spellcheck: 'false', 'aria-label': (info.name + ' ' + (P.fields[k] || k)), placeholder: P.fields[k] || k,
              oninput: function (e) { pv.drafts[id + '.' + k] = e.target.value; } });
            i.value = pv.drafts[id + '.' + k] || '';
            return i;
          });
          rows.push(h('form', { class: 'set-provkey', onsubmit: async function (e) {
            e.preventDefault();
            var key = {};
            info.fields.forEach(function (k) { key[k] = (pv.drafts[id + '.' + k] || '').trim(); });
            var r = await provCall('provider-key', { id: id, key: key });
            if (r.ok) info.fields.forEach(function (k) { delete pv.drafts[id + '.' + k]; });
            pv.msg[id] = r.ok ? P.savedMsg : r.error || '?';
            await load(); env.rerender();
          } }, inputs, h('button', { class: 'btn', type: 'submit', disabled: pv.busy }, P.save),
            info.configured ? h('button', { class: 'btn btn-ghost', type: 'button', disabled: pv.busy, onclick: async function () {
              var r = await provCall('provider-key', { id: id, remove: true });
              pv.msg[id] = r.ok ? P.removedMsg : r.error || '?';
              await load(); env.rerender();
            } }, P.remove) : null));
        }
        if (id === 'socialblade' && info && info.configured) {
          if (!on) rows.push(h('p', { class: 'muted small', text: P.sbOff }));
          else {
            var hsel = h('select', { 'aria-label': P.sbHistory, onchange: function () { pv.sbHistory = hsel.value; pv.quote = null; env.rerender(); } },
              [['30d', P.sb30], ['1y', P.sb1y], ['3y', P.sb3y]].map(function (o) { return h('option', { value: o[0], selected: pv.sbHistory === o[0], text: o[1] }); }));
            // The free account's 50 monthly credits: small channels' growth matters more than the giants'.
            var ssel = h('select', { 'aria-label': P.sbScope, onchange: function () { pv.sbScope = ssel.value; pv.quote = null; env.rerender(); } },
              [['100000', P.sbScopeSmall], ['', P.sbScopeAll]].map(function (o) { return h('option', { value: o[0], selected: pv.sbScope === o[0], text: o[1] }); }));
            var maxSubs = function () { return pv.sbScope ? Number(pv.sbScope) : null; };
            rows.push(h('div', { class: 'm-actions set-actions' }, ssel, hsel,
              h('button', { class: 'btn btn-ghost', type: 'button', disabled: pv.busy, onclick: async function () { var r = await provCall('sb-quote', { history: pv.sbHistory, maxSubs: maxSubs() }); pv.quote = r.ok ? r : null; pv.msg[id] = r.ok ? '' : r.error; env.rerender(); } }, P.sbQuote)));
            if (pv.quote) {
              var q = pv.quote;
              rows.push(h('p', { class: 'small', text: fill2(P.sbQuoteLine, { n: q.channels.length, p: q.per_channel, c: q.credits, u: q.est_usd }) + (q.free.length ? ' ' + fill2(P.sbFree, { n: q.free.length }) : '') }));
              rows.push(h('div', { class: 'm-actions set-actions' }, h('button', { class: 'btn btn-primary', type: 'button', disabled: pv.busy || !q.channels.length, onclick: async function () {
                var r = await provCall('sb-backfill', { history: q.history, maxSubs: q.max_subs, confirm: q.credits });
                pv.quote = null;
                pv.msg[id] = r.ok ? fill2(P.sbDone, { n: r.channels.filter(function (c) { return !c.error; }).length, d: r.channels.reduce(function (a, c) { return a + (c.days || 0); }, 0), u: r.credits_used }) + (r.credits_left != null ? ' ' + fill2(P.sbLeft, { l: r.credits_left }) : '') : r.error || '?';
                env.rerender();
              } }, fill2(P.sbGo, { c: q.credits }))));
            }
          }
        }
        if (id === 'dataforseo' && info && info.configured && on) {
          var rk = (st.settings.radar && st.settings.radar.rankKeywords) || [];
          rows.push(h('p', { class: 'small', text: rk.length ? fill2(P.dfsLine, { n: rk.length, c: (rk.length * 0.002).toFixed(3) }) : P.dfsNone }));
          if (rk.length) rows.push(h('div', { class: 'm-actions set-actions' }, h('button', { class: 'btn btn-ghost', type: 'button', disabled: pv.busy, onclick: async function () {
            var r = await provCall('dfs-check');
            pv.msg[id] = r.ok ? fill2(P.dfsDone, { n: r.checked.length }) : r.error || '?';
            env.rerender();
          } }, P.dfsCheck)));
        }
        if (pv.msg[id]) rows.push(h('p', { class: 'm-msg small', role: 'status', text: pv.msg[id] }));
        body.push(h('div', { class: 'set-prov' + (on ? ' is-on' : '') }, rows));
      });
      return h('section', { class: 'm-card set-card', id: 'set-providers' }, h('h2', { text: P.title }), h('p', { class: 'muted small', text: P.text }), body);
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
        h('aside', { class: 'set-side' }, apiCard(T), bridgeCard(T), providersCard(T), langCard(T))));
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
