// OpenOutlier – the feature registry: every switchable YouTube feature in one
// place (docs/youtube-niche-plan.md, section 4).
//
// Each feature has an id, TR/EN label and description, a group, a default, what
// it needs to work (`requires`: all must be met; `optional`: works without, better
// with) and where it shows up (`surface`). `available: false` marks features a
// later phase builds; they are listed as "coming soon" and can already be preset.
//
// The user's choices live in chrome.storage.local `rs:settings.features`
// ({ id: true|false }, only the ones they changed). Unknown or missing keys fall
// back to the default, so a new default reaches everyone who never touched it.
// The bridge gets the same map (src/agent-bridge.js → POST /settings) and keeps
// it in the database's meta table (`features`); mcp/tracker.mjs runs a job only
// when its feature is on.
//
// Pure data + functions here; the chrome.storage part only runs where
// chrome.storage exists (content scripts, popup, Library, service worker), so
// Node (the bridge, tests) can require this file too.
'use strict';

(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpenOutlierFeatures = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  var SETTINGS_KEY = 'rs:settings';
  var BRIDGE_KEY = 'rs:bridge';

  var GROUPS = [
    { id: 'cards', label: { tr: 'Video kartları', en: 'Video cards' }, hint: { tr: 'Arama, ana sayfa, yan liste ve kanal ızgarası', en: 'Search, home, the watch-page sidebar and channel grids' } },
    { id: 'feeds', label: { tr: 'Akışlar', en: 'Feeds' }, hint: { tr: 'Arama, ana sayfa ve abonelikler', en: 'Search, home and subscriptions' } },
    { id: 'channel', label: { tr: 'Kanal sayfası', en: 'Channel page' }, hint: null },
    { id: 'video', label: { tr: 'Video sayfası', en: 'Watch page' }, hint: null },
    { id: 'shorts', label: { tr: 'Shorts akışı', en: 'Shorts feed' }, hint: null },
    { id: 'studio', label: { tr: 'YouTube Studio', en: 'YouTube Studio' }, hint: null },
    { id: 'background', label: { tr: 'Arka plan (bridge)', en: 'Background (bridge)' }, hint: { tr: 'Mac\'teki OpenOutlier bridge\'i çalıştırır; Chrome kapalıyken de devam eder', en: 'Run by the OpenOutlier bridge on your Mac, also while Chrome is closed' } }
  ];

  // requires / optional: 'apiKey' (a Data API key in this browser), 'bridge' (the bridge
  // on this Mac is connected), 'bridgeKey' (the bridge has a Data API key), 'oauth'
  // (My YouTube channel is connected), 'tracker' (the tracker feature is on and can run).
  // notes: 'thirdParty' (a third party gets the video id), 'ytRequest' (OpenOutlier asks
  // YouTube itself, slowly), 'mcp' (the analysis part runs in Claude through MCP), 'estimate'.
  function F(id, group, phase, on, tr, en, trDesc, enDesc, extra) {
    var f = { id: id, group: group, phase: phase, default: on, available: false, label: { tr: tr, en: en }, desc: { tr: trDesc, en: enDesc },
      requires: [], optional: [], notes: [], surface: [] };
    for (var k in extra || {}) f[k] = extra[k];
    return f;
  }

  var FEATURES = [
    F('card-vph', 'cards', 3, true, 'VPH rozeti', 'VPH badge',
      'Saat başına izlenme (izlenme ÷ yayından beri geçen saat).', 'Views per hour (views ÷ hours since it was published).',
      { surface: ['youtube:cards'] }),
    F('card-outlier', 'cards', 3, true, 'Outlier rozeti', 'Outlier badge',
      'Videonun kanalın medyanına (ya da ortalamasına) göre kaç kat olduğu.', 'How many times the channel\'s median (or average) a video got.',
      { optional: ['apiKey'], surface: ['youtube:cards'] }),
    F('card-subs', 'cards', 3, true, 'Abone sayısı', 'Subscriber count',
      'Kartta kanalın abone sayısı.', 'The channel\'s subscribers on each card.',
      { requires: ['apiKey'], surface: ['youtube:cards'] }),
    F('card-velocity', 'cards', 1, true, 'Hız skoru', 'Velocity score',
      'Takip edilen videolarda "24 s: 3,4×" gibi erken hız.', 'Early speed on tracked videos, like "24 h: 3.4×".',
      { requires: ['tracker'], surface: ['youtube:cards'] }),

    F('feed-filters', 'feeds', 3, true, 'Gelişmiş filtreler', 'Advanced filters',
      'Outlier, VPH, süre, izlenme, tarih ve abone/izlenme oranına göre süz.', 'Filter by outlier, VPH, length, views, date and views per subscriber.',
      { surface: ['youtube:search', 'youtube:home', 'youtube:subscriptions'] }),
    F('hide-shorts', 'feeds', 3, false, 'Aramada Shorts\'u gizle', 'Hide Shorts in search',
      'Arama sonuçlarından Shorts\'u kaldırır.', 'Removes Shorts from search results.',
      { surface: ['youtube:search'] }),
    F('channel-sort', 'feeds', 3, true, 'Outlier\'a göre sırala', 'Sort by outlier',
      'Kanal videolarını outlier skoruna göre sıralar.', 'Sorts a channel\'s videos by outlier score.',
      { surface: ['youtube:channel'] }),

    F('channel-stats', 'channel', 3, true, 'Kanal istatistikleri', 'Channel stats',
      'Yaş, toplam izlenme, video başına ortalama ve medyan, aylık yükleme, ortalama süre, ülke.', 'Age, total views, average and median per video, uploads per month, average length, country.',
      { optional: ['apiKey'], surface: ['youtube:channel'] }),
    F('channel-growth', 'channel', 1, true, 'Büyüme grafiği', 'Growth chart',
      'Takip başladıktan sonra günlük abone ve izlenme.', 'Daily subscribers and views since tracking started.',
      { available: true, requires: ['tracker'], surface: ['youtube:channel', 'library'] }),
    F('channel-track', 'channel', 1, true, 'Takip et butonu', 'Track button',
      'Kanalı niş takibine ekler.', 'Adds the channel to niche tracking.',
      { available: true, requires: ['bridge', 'bridgeKey'], surface: ['youtube:channel'] }),
    F('channel-monetization', 'channel', 3, true, 'Monetized rozeti', 'Monetized badge',
      'Kanalın reklam gösterip göstermediği (5 örnek video).', 'Whether the channel shows ads (5 sample videos).',
      { notes: ['ytRequest'], surface: ['youtube:channel'] }),
    F('channel-similar', 'channel', 5, true, 'Benzer kanallar', 'Similar channels',
      'Birlikte önerilen ve benzer başlıklı kanallar.', 'Channels recommended together and with similar titles.',
      { surface: ['youtube:channel', 'library'] }),
    F('channel-sponsors', 'channel', 4, true, 'Sponsor taraması', 'Sponsor scan',
      'Açıklamalardaki sponsor ve affiliate linkleri.', 'Sponsor and affiliate links in descriptions.',
      { requires: ['apiKey'], surface: ['youtube:channel', 'library'] }),
    F('channel-rpm', 'channel', 3, false, 'Tahmini RPM ve gelir', 'Estimated RPM & revenue',
      'Kategori tablosu × izlenme; kaba bir tahmin.', 'Category table × views; a rough estimate.',
      { notes: ['estimate'], surface: ['youtube:channel'] }),

    F('video-card', 'video', 3, true, 'Video kartı', 'Video card',
      'Outlier, VPH (ömür boyu ve son 24 saat), etkileşim ve hız eğrisi.', 'Outlier, VPH (lifetime and last 24 h), engagement and the velocity curve.',
      { optional: ['tracker'], surface: ['youtube:watch'] }),
    F('video-monetization', 'video', 3, true, 'Monetized rozeti', 'Monetized badge',
      'Videoda reklam olup olmadığı.', 'Whether the video shows ads.',
      { notes: ['ytRequest'], surface: ['youtube:watch'] }),
    F('transcript-tools', 'video', 4, true, 'Transcript araçları', 'Transcript tools',
      'Kopyala, txt/srt/md olarak dışa aktar, Claude\'a gönder.', 'Copy, export as txt/srt/md, send to Claude.',
      { notes: ['mcp'], surface: ['youtube:watch'] }),
    F('comment-tools', 'video', 4, true, 'Yorum araçları', 'Comment tools',
      'Soru, kelime ve küfür filtreleri, dışa aktarma, Claude ile analiz.', 'Question, word and profanity filters, export, analysis with Claude.',
      { notes: ['mcp'], surface: ['youtube:watch'] }),
    F('frame-capture', 'video', 4, true, 'Kare yakala', 'Frame capture',
      'O anki kareyi kopyala ya da indir.', 'Copy or download the current frame.',
      { surface: ['youtube:watch'] }),
    F('title-history', 'video', 1, true, 'Başlık ve thumbnail geçmişi', 'Title & thumbnail history',
      'Rakiplerin başlık ve thumbnail değişiklikleri.', 'Title and thumbnail changes on tracked videos.',
      { available: true, requires: ['tracker'], surface: ['youtube:watch', 'library'] }),
    F('swipe-save', 'video', 4, true, 'Swipe file', 'Swipe file',
      'Videoyu not, etiket ve zaman aralığıyla klasöre kaydet.', 'Save a video to a folder with a note, tags and a time range.',
      { surface: ['youtube:watch', 'library'] }),
    F('dislikes', 'video', 3, true, 'Dislike sayısı', 'Dislike count',
      'Return YouTube Dislike\'tan tahmini dislike sayısı.', 'Estimated dislikes from Return YouTube Dislike.',
      { notes: ['thirdParty'], link: 'https://returnyoutubedislike.com/', surface: ['youtube:watch'] }),

    F('shorts-overlay', 'shorts', 3, true, 'Shorts kartı', 'Shorts card',
      'VPH, yayın tarihi, kanal yaşı ve kanalın ortalama Shorts izlenmesi.', 'VPH, publish date, channel age and the channel\'s average Shorts views.',
      { optional: ['apiKey'], surface: ['youtube:shorts'] }),

    F('thumb-compress', 'studio', 4, true, 'Thumbnail sıkıştırıcı', 'Thumbnail compressor',
      '2 MB\'tan büyük thumbnail\'i yüklemeden önce küçültür.', 'Shrinks thumbnails over 2 MB before upload.',
      { surface: ['studio'] }),
    F('thumb-preview', 'studio', 4, true, 'Thumbnail ve başlık testi', 'Thumbnail & title tester',
      'Rakiplerin yanında sahte bir ana sayfa ızgarasında gör.', 'See it next to competitors in a mock home-page grid.',
      { surface: ['studio', 'library'] }),

    F('tracker', 'background', 1, true, 'Niş takibi', 'Niche tracking',
      'Takip edilen kanalları RSS ve Data API ile düzenli ölçer.', 'Measures tracked channels on a schedule with RSS and the Data API.',
      { available: true, requires: ['bridge', 'bridgeKey'], surface: ['bridge', 'library'] }),
    F('breakout-alerts', 'background', 1, true, 'Hızlı yükselen bildirimi', 'Breakout alerts',
      '6. veya 24. saatte kanal medyanının 3 katını geçen videolar.', 'Videos past 3× the channel\'s median at hour 6 or 24.',
      { available: true, requires: ['tracker'], surface: ['bridge', 'library'] }),
    F('weekly-digest', 'background', 1, true, 'Haftalık niş raporu', 'Weekly niche digest',
      'Her pazartesi nişin özeti, Library\'de.', 'A summary of the niche every Monday, in the Library.',
      { available: true, requires: ['tracker'], surface: ['bridge', 'library'] }),
    F('niche-radar', 'background', 5, false, 'Niş radarı', 'Niche radar',
      'Anahtar kelimelerle günlük arama; arama başına 100 birim.', 'A daily keyword search; 100 quota units per search.',
      { requires: ['bridge', 'bridgeKey'], surface: ['bridge', 'library'] }),
    F('own-history', 'background', 2, true, 'Kendi kanal geçmişim', 'My channel history',
      'YouTube Analytics\'ten günlük kanal ve video verisi, kanalın ilk gününden itibaren; her sabah son 7 gün yenilenir.', 'Daily channel and video data from YouTube Analytics since the channel\'s first day; the last 7 days are refreshed every morning.',
      { available: true, requires: ['bridge', 'oauth'], surface: ['bridge', 'library'] }),
    F('own-revenue', 'background', 2, true, 'Gelir ve RPM', 'Revenue & RPM',
      'YouTube Partner Programı\'na girince tahmini gelir, RPM ve CPM. Eski bağlantılar bir kez yeniden onay ister.', 'Estimated revenue, RPM and CPM once the channel is in the Partner Program. Older connections need one re-consent.',
      { available: true, requires: ['bridge', 'oauth'], surface: ['bridge', 'library'] }),
    F('own-milestones', 'background', 2, false, 'Kilometre taşı bildirimi', 'Milestone notifications',
      '100, 500, 1.000 abone ya da ilk 10 bin izlenmeli video gibi anlarda Chrome bildirimi.', 'A Chrome notification at 100, 500, 1,000 subscribers, the first 10K-view video and the like.',
      { available: true, requires: ['bridge', 'oauth'], surface: ['bridge', 'library'] }),
    F('api-retention-30d', 'background', 0, false, 'Rakip API verisini 30 günde sil', 'Delete competitors\' API data after 30 days',
      'YouTube API politikasına uyum: Data API\'den gelen rakip ölçümleri 30 günden sonra silinir; RSS ve sayfa ölçümleri kalır.',
      'For YouTube\'s API policy: competitors\' Data API measurements are deleted after 30 days; RSS and page measurements stay.',
      { available: true, requires: ['bridge'], surface: ['bridge'] })
  ];

  var BY_ID = {};
  FEATURES.forEach(function (f) { BY_ID[f.id] = f; });

  function get(id) { return BY_ID[id] || null; }
  function defaults() {
    var o = {};
    FEATURES.forEach(function (f) { o[f.id] = f.default; });
    return o;
  }
  /** Only known ids with boolean values (what may be stored or sent to the bridge). */
  function sanitize(stored) {
    var o = {};
    if (!stored || typeof stored !== 'object') return o;
    Object.keys(stored).forEach(function (k) { if (BY_ID[k] && typeof stored[k] === 'boolean') o[k] = stored[k]; });
    return o;
  }
  /** The full on/off map: the stored choices over the defaults. */
  function resolve(stored) {
    var o = defaults();
    var s = sanitize(stored);
    Object.keys(s).forEach(function (k) { o[k] = s[k]; });
    return o;
  }
  function isOnIn(id, stored) {
    if (!BY_ID[id]) return false;
    return resolve(stored)[id];
  }

  /**
   * What a feature still needs. env: { apiKey, bridge, bridgeKey, oauth } booleans
   * (undefined = unknown, never reported as missing). flags: the resolved map.
   * → ['apiKey', 'tracker', …] in a stable order.
   */
  function missing(id, env, flags) {
    var f = BY_ID[id];
    if (!f) return [];
    env = env || {};
    flags = flags || defaults();
    var out = [];
    f.requires.forEach(function (r) {
      if (r === 'tracker') {
        if (!flags.tracker) out.push('tracker');
        else missing('tracker', env, flags).forEach(function (m) { if (out.indexOf(m) === -1) out.push(m); });
      } else if (env[r] === false && out.indexOf(r) === -1) out.push(r);
    });
    return out;
  }

  /** UI language: ?hl= on the page, then the page's <html lang> (YouTube's own setting) on content pages,
   *  then Chrome's language. 'tr' or 'en'. A saved choice (rs:settings.uiLang) wins. */
  function lang(saved) {
    if (saved === 'tr' || saved === 'en') return saved;
    try {
      var q = new URLSearchParams(root.location.search).get('hl');
      if (q) return /^tr/i.test(q) ? 'tr' : 'en';
    } catch (e) { /* no location */ }
    try {
      if (root.location && root.location.protocol !== 'chrome-extension:' && root.document && root.document.documentElement.lang) {
        return /^tr/i.test(root.document.documentElement.lang) ? 'tr' : 'en';
      }
    } catch (e) { /* ignore */ }
    try {
      var nav = (root.chrome && root.chrome.i18n && root.chrome.i18n.getUILanguage && root.chrome.i18n.getUILanguage()) || (root.navigator && root.navigator.language) || '';
      return /^tr/i.test(nav) ? 'tr' : 'en';
    } catch (e) { return 'en'; }
  }

  // ---- chrome.storage (extension pages, content scripts, service worker) ----------
  var hasChrome = !!(root.chrome && root.chrome.storage && root.chrome.storage.local);
  var cache = { stored: {}, flags: defaults(), uiLang: null, loaded: false };
  var subs = [];

  function take(settings) {
    var prev = cache.flags;
    cache.stored = sanitize(settings && settings.features);
    cache.flags = resolve(cache.stored);
    cache.uiLang = settings && settings.uiLang || null;
    cache.loaded = true;
    return Object.keys(cache.flags).filter(function (k) { return prev[k] !== cache.flags[k]; });
  }

  var ready = hasChrome
    ? root.chrome.storage.local.get(SETTINGS_KEY).then(function (r) { take(r[SETTINGS_KEY]); return cache.flags; }, function () { return cache.flags; })
    : Promise.resolve(cache.flags);

  if (hasChrome && root.chrome.storage.onChanged) {
    root.chrome.storage.onChanged.addListener(function (changes, area) {
      if (area && area !== 'local') return;
      if (!changes[SETTINGS_KEY] && !changes[BRIDGE_KEY]) return;
      var changed = changes[SETTINGS_KEY] ? take(changes[SETTINGS_KEY].newValue) : [];
      subs.slice().forEach(function (fn) { try { fn(changed, cache.flags); } catch (e) { console.warn('[OpenOutlier] feature listener failed', e); } });
    });
  }

  /** Whether a feature is on (synchronous: the defaults until storage has loaded; await ready first if it matters). */
  function isOn(id) { return !!cache.flags[id]; }
  function flags() { return Object.assign({}, cache.flags); }
  /** cb(changedIds, flags) after the settings (or the bridge state) change. Returns an unsubscribe function. */
  function onChange(cb) {
    subs.push(cb);
    return function () { subs = subs.filter(function (x) { return x !== cb; }); };
  }
  /** Turn a feature on or off (stored in rs:settings.features). */
  async function set(id, on) {
    if (!BY_ID[id] || !hasChrome) return false;
    var r = await root.chrome.storage.local.get(SETTINGS_KEY);
    var s = Object.assign({}, r[SETTINGS_KEY]);
    var feats = sanitize(s.features);
    feats[id] = !!on;
    s.features = feats;
    var o = {};
    o[SETTINGS_KEY] = s;
    await root.chrome.storage.local.set(o);
    take(s);
    return true;
  }
  /** Back to the defaults (forgets every choice). */
  async function reset() {
    if (!hasChrome) return;
    var r = await root.chrome.storage.local.get(SETTINGS_KEY);
    var s = Object.assign({}, r[SETTINGS_KEY]);
    delete s.features;
    var o = {};
    o[SETTINGS_KEY] = s;
    await root.chrome.storage.local.set(o);
    take(s);
  }

  /** What is set up, from storage: { apiKey, bridge, bridgeKey, oauth } (undefined = not known yet). */
  async function env() {
    if (!hasChrome) return {};
    var r = await root.chrome.storage.local.get([SETTINGS_KEY, BRIDGE_KEY]);
    var s = r[SETTINGS_KEY] || {};
    var b = r[BRIDGE_KEY] || {};
    var key = s.youtubeApiKey;
    var connected = s.agentBridge !== false && !!b.connected;
    return {
      apiKey: typeof key === 'string' && /^[A-Za-z0-9_-]{30,60}$/.test(key.trim()),
      bridge: connected,
      // Only known while connected to a bridge that reports them (older bridges don't). Without a
      // bridge they are unknown, not missing: the bridge itself is what to fix first.
      bridgeKey: connected && b.bridgeApiKey != null ? !!b.bridgeApiKey : undefined,
      oauth: connected && b.oauthConnected != null ? !!b.oauthConnected : undefined,
      bridgeSettings: connected && !!b.settingsAt
    };
  }

  return {
    SETTINGS_KEY: SETTINGS_KEY, GROUPS: GROUPS, FEATURES: FEATURES,
    get: get, defaults: defaults, sanitize: sanitize, resolve: resolve, isOnIn: isOnIn, missing: missing, lang: lang,
    ready: ready, isOn: isOn, flags: flags, onChange: onChange, set: set, reset: reset, env: env,
    uiLang: function () { return lang(cache.uiLang); }
  };
});
