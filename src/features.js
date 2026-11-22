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
  // Sub-settings edited by different pages live in their own storage keys, so a write from one
  // page (or the popup, or a content script) can never put back an old copy of another's.
  // They used to sit inside rs:settings; migrateSplit() moves them once, readers fall back.
  var SPLIT = { radar: 'rs:radar', niche: 'rs:niche-settings', ownProfit: 'rs:own-profit' };

  var GROUPS = [
    { id: 'cards', label: { tr: 'Video kartları', en: 'Video cards' }, hint: { tr: 'Arama, ana sayfa, yan liste ve kanal ızgarası', en: 'Search, home, the watch-page sidebar and channel grids' } },
    { id: 'feeds', label: { tr: 'Akışlar', en: 'Feeds' }, hint: { tr: 'Arama, ana sayfa ve abonelikler', en: 'Search, home and subscriptions' } },
    { id: 'channel', label: { tr: 'Kanal sayfası', en: 'Channel page' }, hint: null },
    { id: 'video', label: { tr: 'Video sayfası', en: 'Watch page' }, hint: null },
    { id: 'shorts', label: { tr: 'Shorts akışı', en: 'Shorts feed' }, hint: null },
    { id: 'studio', label: { tr: 'YouTube Studio', en: 'YouTube Studio' }, hint: null },
    { id: 'background', label: { tr: 'Arka plan (bridge)', en: 'Background (bridge)' }, hint: { tr: 'Mac\'teki OpenOutlier bridge\'i çalıştırır; Chrome kapalıyken de devam eder', en: 'Run by the OpenOutlier bridge on your Mac, also while Chrome is closed' } },
    { id: 'providers', label: { tr: 'İsteğe bağlı servisler', en: 'Optional providers' }, hint: { tr: 'Üçüncü parti API\'ler; hepsi kapalı başlar, açıp anahtarını eklemeden hiçbir istek atılmaz. Anahtarlar Ayarlar\'da, bu Mac\'te (~/.openoutlier/providers.json) durur.', en: 'Third-party APIs; all start off, and none makes a request until you turn it on and add its key. Keys are set in Settings and stay on this Mac (~/.openoutlier/providers.json).' } }
  ];

  // requires / optional: 'apiKey' (a Data API key in this browser), 'bridge' (the bridge
  // on this Mac is connected), 'bridgeKey' (the bridge has a Data API key), 'oauth'
  // (My YouTube channel is connected), 'tracker' (the tracker feature is on and can run).
  // 'providerKey' (an optional provider's key is set on the bridge; f.provider names it).
  // notes: 'thirdParty' (a third party gets the video id), 'ytRequest' (OpenOutlier asks
  // YouTube itself, slowly), 'mcp' (the analysis part runs in Claude through MCP), 'estimate',
  // 'quota' (spends Data API units: the cost is shown before it runs), 'scraping' (the provider
  // scrapes YouTube, which YouTube's API policy §III.E.6 doesn't allow next to an API key),
  // 'paid' (the provider charges per call), 'suggest' (asks Google's autocomplete, unofficially).
  function F(id, group, phase, on, tr, en, trDesc, enDesc, extra) {
    var f = { id: id, group: group, phase: phase, default: on, available: false, label: { tr: tr, en: en }, desc: { tr: trDesc, en: enDesc },
      requires: [], optional: [], notes: [], surface: [] };
    for (var k in extra || {}) f[k] = extra[k];
    return f;
  }

  var FEATURES = [
    F('card-vph', 'cards', 3, true, 'VPH rozeti', 'VPH badge',
      'Saat başına izlenme (izlenme ÷ yayından beri geçen saat).', 'Views per hour (views ÷ hours since it was published).',
      { available: true, surface: ['youtube:cards'] }),
    F('card-outlier', 'cards', 3, true, 'Outlier rozeti', 'Outlier badge',
      'Videonun kanalın medyanına (ya da ortalamasına) göre kaç kat olduğu.', 'How many times the channel\'s median (or average) a video got.',
      { available: true, optional: ['apiKey'], surface: ['youtube:cards'] }),
    F('card-subs', 'cards', 3, true, 'Abone sayısı', 'Subscriber count',
      'Kartta kanalın abone sayısı (sayfadan, kayıtlı kanaldan ya da önbellekteki channels.list\'ten).', 'The channel\'s subscribers on each card (from the page, a saved channel or the cached channels.list).',
      { available: true, optional: ['apiKey'], surface: ['youtube:cards'] }),
    F('card-velocity', 'cards', 3, true, 'Hız skoru', 'Velocity score',
      'Takip edilen videolarda "24 sa: 3,4×" gibi erken hız.', 'Early speed on tracked videos, like "24 h: 3.4×".',
      { available: true, requires: ['tracker'], surface: ['youtube:cards'] }),

    F('feed-filters', 'feeds', 3, true, 'Gelişmiş filtreler', 'Advanced filters',
      'Outlier, VPH, süre, izlenme, tarih ve abone/izlenme oranına göre süz.', 'Filter by outlier, VPH, length, views, date and views per subscriber.',
      { available: true, surface: ['youtube:search', 'youtube:home', 'youtube:subscriptions'] }),
    F('hide-shorts', 'feeds', 3, false, 'Aramada Shorts\'u gizle', 'Hide Shorts in search',
      'Arama sonuçlarından Shorts\'u kaldırır.', 'Removes Shorts from search results.',
      { available: true, surface: ['youtube:search'] }),
    F('channel-sort', 'feeds', 3, true, 'Outlier\'a göre sırala', 'Sort by outlier',
      'Kanal videolarını outlier skoruna göre sıralar.', 'Sorts a channel\'s videos by outlier score.',
      { available: true, surface: ['youtube:channel'] }),

    F('channel-stats', 'channel', 3, true, 'Kanal istatistikleri', 'Channel stats',
      'Yaş, toplam izlenme, video başına ortalama ve medyan, aylık yükleme, ortalama süre, ülke.', 'Age, total views, average and median per video, uploads per month, average length, country.',
      { available: true, optional: ['apiKey'], surface: ['youtube:channel'] }),
    F('channel-growth', 'channel', 1, true, 'Büyüme grafiği', 'Growth chart',
      'Takip başladıktan sonra günlük abone ve izlenme.', 'Daily subscribers and views since tracking started.',
      { available: true, requires: ['tracker'], surface: ['youtube:channel', 'library'] }),
    F('channel-track', 'channel', 1, true, 'Takip et butonu', 'Track button',
      'Kanalı niş takibine ekler.', 'Adds the channel to niche tracking.',
      { available: true, requires: ['bridge', 'bridgeKey'], surface: ['youtube:channel'] }),
    F('channel-monetization', 'channel', 3, true, 'Para kazanma rozeti', 'Monetized badge',
      'Kanalın reklam gösterip göstermediği (5 örnek video).', 'Whether the channel shows ads (5 sample videos).',
      { available: true, notes: ['ytRequest'], surface: ['youtube:channel'] }),
    F('channel-similar', 'channel', 5, true, 'Benzer kanallar', 'Similar channels',
      'İzleme sayfalarındaki "Sıradaki" listelerinden birlikte önerilen kanallar (yalnız sayılar, bu Mac\'te) ve başlık/etiket benzerliği; kanal kartında satır, Niş Takibi\'nde kanal haritası, benzer thumbnail\'ler.',
      'Channels recommended together in the "Up Next" lists of watch pages (counts only, on this Mac) and by similar titles and tags: a row on the channel card, the channel map in Niche tracking, similar thumbnails.',
      { available: true, requires: ['bridge'], surface: ['youtube:channel', 'youtube:watch', 'library'] }),
    F('channel-sponsors', 'channel', 4, true, 'Sponsor taraması', 'Sponsor scan',
      'Takip edilen kanalların açıklamalarındaki sponsorlar, indirim kodları ve affiliate linkleri (kanal kartı, Niş Takibi, MCP).', 'Sponsors, discount codes and affiliate links in tracked channels\' descriptions (channel card, Niche tracking, MCP).',
      { available: true, requires: ['bridge'], optional: ['tracker'], surface: ['youtube:channel', 'library'] }),
    F('channel-rpm', 'channel', 5, false, 'Tahmini RPM ve gelir', 'Estimated RPM & revenue',
      'Kanal kartında kategori RPM tablosu × aylık izlenmeyle tahmini aylık gelir aralığı.', 'An estimated monthly revenue range on the channel card: a category RPM table × monthly views.',
      { available: true, notes: ['estimate'], surface: ['youtube:channel'] }),

    F('video-card', 'video', 3, true, 'Video kartı', 'Video card',
      'Outlier, VPH (ömür boyu ve son 24 saat), etkileşim ve hız eğrisi.', 'Outlier, VPH (lifetime and last 24 h), engagement and the velocity curve.',
      { available: true, optional: ['tracker'], surface: ['youtube:watch'] }),
    F('video-monetization', 'video', 3, true, 'Para kazanma rozeti', 'Monetized badge',
      'Videoda reklam olup olmadığı.', 'Whether the video shows ads.',
      { available: true, notes: ['ytRequest'], surface: ['youtube:watch'] }),
    F('transcript-tools', 'video', 4, true, 'Transkript araçları', 'Transcript tools',
      'YouTube\'un transkriptini oku: kopyala, txt/srt/md olarak indir, Claude\'a gönder.', 'Reads YouTube\'s transcript: copy, download as txt/srt/md, send to Claude.',
      { available: true, notes: ['mcp'], surface: ['youtube:watch'] }),
    F('comment-tools', 'video', 4, true, 'Yorum araçları', 'Comment tools',
      'Soru, kelime ve küfür filtreleri, CSV/JSON, Claude ile analiz. Yorumlar get_comments için bridge\'de 7 gün tutulur.', 'Question, phrase and profanity filters, CSV/JSON, analysis with Claude. Comments are kept on the bridge for get_comments for 7 days.',
      { available: true, notes: ['mcp'], surface: ['youtube:watch', 'youtube:shorts'] }),
    F('frame-capture', 'video', 4, true, 'Kare yakala', 'Frame capture',
      'Araç çubuğundaki kamera: o anki kareyi PNG olarak kopyala ya da indir.', 'The toolbar\'s camera: copy or download the current frame as PNG.',
      { available: true, surface: ['youtube:watch', 'youtube:shorts'] }),
    F('title-history', 'video', 1, true, 'Başlık ve thumbnail geçmişi', 'Title & thumbnail history',
      'Takip edilen videolarda başlık ve thumbnail değişiklikleri, öncesi ve sonrası saatlik izlenmeyle (video kartında ve Library\'de).', 'Title and thumbnail changes on tracked videos, with views per hour before and after (watch card and Library).',
      { available: true, requires: ['tracker'], surface: ['youtube:watch', 'library'] }),
    F('swipe-save', 'video', 4, true, 'Swipe file', 'Swipe file',
      'Videoyu ya da Short\'u not, etiket ve klip aralığıyla bir klasöre kaydet; Library\'de Swipe file.', 'Save a video or Short with a note, tags and a clip to a folder; Swipe file in the Library.',
      { available: true, surface: ['youtube:watch', 'youtube:shorts', 'library'] }),
    F('dislikes', 'video', 3, true, 'Dislike sayısı', 'Dislike count',
      'Return YouTube Dislike\'tan tahmini dislike sayısı.', 'Estimated dislikes from Return YouTube Dislike.',
      { available: true, notes: ['thirdParty'], link: 'https://returnyoutubedislike.com/', surface: ['youtube:watch'] }),

    F('shorts-overlay', 'shorts', 3, true, 'Shorts kartı', 'Shorts card',
      'VPH, yayın tarihi, kanal yaşı ve kanalın ortalama Shorts izlenmesi.', 'VPH, publish date, channel age and the channel\'s average Shorts views.',
      { available: true, optional: ['apiKey'], surface: ['youtube:shorts'] }),

    F('thumb-compress', 'studio', 4, true, 'Thumbnail sıkıştırıcı', 'Thumbnail compressor',
      '2 MB\'tan büyük thumbnail\'i seçince bu sekmede sığacak kadar küçültmeyi önerir; hiçbir şey yüklemez.', 'Offers to shrink a thumbnail over 2 MB in the tab when you pick it; never uploads anything.',
      { available: true, surface: ['studio'] }),
    F('thumb-preview', 'studio', 4, true, 'Thumbnail ve başlık testi', 'Thumbnail & title tester',
      'Thumbnail\'ini ve başlığını nişteki rakiplerin yanında, sahte bir ana sayfa ve arama listesinde gör (açık/koyu, masaüstü/mobil).', 'See your thumbnail and title next to the niche\'s competitors on a mock home grid and search list (light/dark, desktop/mobile).',
      { available: true, surface: ['studio', 'library'] }),

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
      'Nişin anahtar kelimeleriyle günlük arama: bu hafta küçük kanallarda patlayan videolar ve takip etmediğin yükselen kanallar (Niş Takibi → Radar). Kelime başına ~102 birim.',
      'A daily search for the niche\'s keywords: this week\'s breakouts on small channels and rising channels you don\'t track (Niche tracking → Radar). About 102 units per keyword.',
      { available: true, requires: ['bridge', 'bridgeKey'], notes: ['quota'], surface: ['bridge', 'library'] }),
    F('niche-sample', 'background', 5, false, 'Niş örneklemi', 'Niche sample',
      'Radarın göremediği payda: her gün nişin arama kelimesindeki en yeni yüklemeler (izlenmeye göre değil, tarihe göre), 30 gün boyunca günlük ölçülür. Varsayılan: uzun video (4–20 ve 20+ dk) ve kısa video (4 dk altı), İngilizce. Yeni bir videonun tipik izlenmesi ve küçük kanalların ne sıklıkla patladığı (niche_sample). Arama başına günde ~100 birim (üç arama: ~300) + ölçülen 50 video başına 1.',
      'The denominator the radar can\'t see: every day the newest uploads for the niche\'s search term (by date, not by views), measured daily for 30 days. Long-form (4–20 and 20+ min) and short (under 4 min), English by default. What a typical new upload gets and how often small channels break out (niche_sample). About 100 units per search a day (three: ~300) + 1 per 50 measured videos.',
      { available: true, requires: ['bridge', 'bridgeKey'], notes: ['quota'], surface: ['bridge'] }),
    F('keyword-ideas', 'background', 5, true, 'Anahtar kelime fikirleri', 'Keyword ideas',
      'YouTube\'un otomatik tamamlamasını (bridge üzerinden, yavaşlatılmış, 7 gün önbellek) nişin başlık kelimeleri, konu boşlukları ve kendi arama terimlerinle birleştirir (Niş Takibi → Anahtar kelimeler, MCP keyword_ideas).',
      'Merges YouTube\'s autocomplete (through the bridge, rate-limited, cached 7 days) with the niche\'s title words, topic gaps and your own search terms (Niche tracking → Keywords, MCP keyword_ideas).',
      { available: true, requires: ['bridge'], notes: ['suggest'], surface: ['bridge', 'library'] }),
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
      { available: true, requires: ['bridge'], surface: ['bridge'] }),

    F('provider-ryd', 'providers', 5, false, 'Return YouTube Dislike (MCP)', 'Return YouTube Dislike (MCP)',
      'video_velocity\'ye tahmini dislike sayısını ekler (bridge sorar; anahtar gerekmez). Video sayfasındaki dislike hücresi ayrı: Video sayfası → Dislike sayısı.',
      'Adds the estimated dislikes to video_velocity (asked by the bridge; no key). The watch page\'s dislike cell is separate: Watch page → Dislike count.',
      { available: true, provider: 'ryd', requires: ['bridge'], notes: ['thirdParty'], link: 'https://returnyoutubedislike.com/', surface: ['bridge'] }),
    F('provider-socialblade', 'providers', 5, false, 'Social Blade geçmişi', 'Social Blade history',
      'Takip edilen rakiplerin takip öncesi günlük abone ve izlenme geçmişi, bir kerelik (channel_stats, kaynak socialblade). Kredi maliyeti çalıştırmadan önce gösterilir.',
      'A one-time backfill of tracked competitors\' daily subscribers and views from before tracking (channel_stats, source socialblade). The credit cost is shown before it runs.',
      { available: true, provider: 'socialblade', requires: ['bridge', 'providerKey'], notes: ['paid'], link: 'https://socialblade.com/business-api', surface: ['bridge', 'library'] }),
    F('provider-dataforseo', 'providers', 5, false, 'DataForSEO sıralama takibi', 'DataForSEO rank tracking',
      'Seçtiğin anahtar kelimelerde kanalının YouTube aramasındaki sırası, günde bir (Niş Takibi → Anahtar kelimeler).',
      'Where your channel ranks in YouTube search for the keywords you pick, once a day (Niche tracking → Keywords).',
      { available: true, provider: 'dataforseo', requires: ['bridge', 'providerKey'], notes: ['scraping', 'paid'], link: 'https://dataforseo.com/apis/serp-api/youtube-serp-api', surface: ['bridge', 'library'] })
  ];

  var BY_ID = {};
  FEATURES.forEach(function (f) { BY_ID[f.id] = f; });

  // Settings that are a choice rather than an on/off switch (rs:settings.<name>), shown under the
  // feature they belong to. outlierFormula: 'median' (ours: views ÷ the channel's median, saved
  // channels only) or 'mean' (NexLev's: views ÷ total views ÷ video count).
  var CHOICES = {
    outlierFormula: {
      feature: 'card-outlier', default: 'median', values: ['median', 'mean'],
      label: { tr: 'Outlier formülü', en: 'Outlier formula' },
      options: {
        median: { tr: 'Medyan', en: 'Median' },
        mean: { tr: 'Ortalama (NexLev)', en: 'Average (NexLev)' }
      },
      hint: {
        tr: 'Medyan yalnız kayıtlı kanallarda var; olmayanlarda rozet ortalamayı "ort." etiketiyle gösterir (API anahtarıyla, 50 kanal = 1 birim, 7 gün önbellek).',
        en: 'The median exists for saved channels only; elsewhere the badge shows the average, labelled "avg" (with an API key: 50 channels = 1 unit, cached 7 days).'
      }
    }
  };
  function choiceOf(name, stored) {
    var c = CHOICES[name];
    if (!c) return null;
    return c.values.indexOf(stored) !== -1 ? stored : c.default;
  }

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
      } else if (r === 'providerKey') {
        // env.providers: { id: { configured } } from the bridge's settings answer; unknown → not reported.
        var p = env.providers && f.provider ? env.providers[f.provider] : null;
        if (p && p.configured === false && out.indexOf(r) === -1) out.push(r);
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

  // ---- shared TR/EN formatting (every page and content script loads this file) -----------
  function locale(l) { return (l || lang()) === 'tr' ? 'tr-TR' : 'en-US'; }
  var MINUS = '\u2212';
  /**
   * A count with its noun: plural(3, { one: '{n} video', other: '{n} videos' }) → '3 videos'.
   * Intl.PluralRules picks the form; Turkish strings give the same text for both. n is formatted
   * for the language ('1.234' in TR); forms may also be a plain string (no plural).
   */
  function plural(n, forms, l) {
    l = l || lang();
    var f = typeof forms === 'string' ? { other: forms } : forms || {};
    var rule = 'other';
    try { rule = new Intl.PluralRules(locale(l)).select(Number(n)); } catch (e) { rule = Number(n) === 1 ? 'one' : 'other'; }
    var text = f[rule] != null ? f[rule] : f.other != null ? f.other : '';
    var shown = typeof n === 'number' && isFinite(n) ? n.toLocaleString(locale(l)) : String(n);
    return String(text).replace(/\{n\}/g, shown);
  }
  /** A signed percent change from a fraction (0.21 → '+21%' / '+%21', −0.13 → '−13%' / '−%13'); 0 has no sign. */
  function signedPct(x, l, digits) {
    if (x == null || !isFinite(x)) return '';
    var d = digits != null ? digits : Math.abs(x) < 0.1 ? 1 : 0;
    return new Intl.NumberFormat(locale(l), { style: 'percent', signDisplay: 'exceptZero', maximumFractionDigits: d, minimumFractionDigits: 0 }).format(x).replace('-', MINUS);
  }
  /** A plain percent from a fraction (0.032 → '3.2%' / '%3,2'). */
  function pct(x, l, digits) {
    if (x == null || !isFinite(x)) return '';
    return new Intl.NumberFormat(locale(l), { style: 'percent', maximumFractionDigits: digits != null ? digits : 1 }).format(x);
  }
  /** A change of a rate in percentage points (0.8 → '+0.8 pts' / '+0,8 puan'). */
  function signedPts(x, l, digits) {
    if (x == null || !isFinite(x)) return '';
    l = l || lang();
    var v = new Intl.NumberFormat(locale(l), { signDisplay: 'exceptZero', maximumFractionDigits: digits != null ? digits : 1 }).format(x).replace('-', MINUS);
    return v + (l === 'tr' ? ' puan' : ' pts');
  }
  /** Put the UI language on an element (the document, a shadow host) so CSS uppercase and hyphenation follow it (İ, ı). */
  function applyLang(el, l) {
    try { (el || (root.document && root.document.documentElement)).setAttribute('lang', l || lang(cache.uiLang)); } catch (e) { /* no DOM */ }
  }

  // ---- chrome.storage (extension pages, content scripts, service worker) ----------
  var hasChrome = !!(root.chrome && root.chrome.storage && root.chrome.storage.local);
  var cache = { stored: {}, flags: defaults(), uiLang: null, loaded: false, choices: {} };
  Object.keys(CHOICES).forEach(function (k) { cache.choices[k] = CHOICES[k].default; });
  var subs = [];

  function take(settings) {
    var prev = cache.flags;
    cache.stored = sanitize(settings && settings.features);
    cache.flags = resolve(cache.stored);
    cache.uiLang = settings && settings.uiLang || null;
    cache.loaded = true;
    var changed = Object.keys(cache.flags).filter(function (k) { return prev[k] !== cache.flags[k]; });
    Object.keys(CHOICES).forEach(function (k) {
      var v = choiceOf(k, settings && settings[k]);
      if (v !== cache.choices[k]) { cache.choices[k] = v; changed.push(k); }
    });
    return changed;
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
  // Writes go one at a time: two quick switches must not read the same old settings and lose one.
  var writes = Promise.resolve();
  function serial(fn) { var p = writes.then(fn); writes = p.catch(function () {}); return p; }

  /**
   * The one way to write settings. patch: { key: value } or fn(freshSettings) → patch. Each
   * top-level key is merged into a fresh read of rs:settings (undefined deletes it); the split
   * keys (radar, niche, ownProfit) go to their own storage keys. Writes in this context run one at
   * a time; across contexts only the changed keys are written, from a read made just before.
   * → the new rs:settings
   */
  function updateSettings(patch) {
    // A content script (youtube.com origin) can't share a lock with the extension's pages: it asks
    // the service worker to write for it. Only data patches travel (functions stay local).
    if (hasChrome && !extOrigin() && typeof patch !== 'function' && root.chrome.runtime && root.chrome.runtime.sendMessage) {
      return serial(function () { return viaWorker({ patch: patch }); });
    }
    return serial(function () { return locked(function () { return updateNow(patch); }); });
  }
  // The Library, the popup and the service worker share the extension origin, so a Web Lock
  // serializes their read-merge-write across contexts (not only within one page).
  function extOrigin() { try { return root.location && root.location.protocol === 'chrome-extension:'; } catch (e) { return false; } }
  function locked(fn) {
    var locks = root.navigator && root.navigator.locks;
    return locks && extOrigin() ? locks.request('openoutlier:rs-settings', fn) : fn();
  }
  async function viaWorker(msg) {
    try {
      var r = await root.chrome.runtime.sendMessage(Object.assign({ type: 'reelscope:settings-update' }, msg));
      if (r && r.ok) { take(r.settings); return r.settings; }
    } catch (e) { /* no worker (a demo page): write here */ }
    return locked(function () { return msg.feature ? updateNow(featurePatch(msg.feature.id, msg.feature.on)) : updateNow(msg.patch); });
  }
  function featurePatch(id, on) { return function (s) { var feats = sanitize(s.features); feats[id] = !!on; return { features: feats }; }; }
  async function updateNow(patch) {
    if (!hasChrome) return {};
    var r = await root.chrome.storage.local.get(SETTINGS_KEY);
    var s = Object.assign({}, r[SETTINGS_KEY]);
    var p = typeof patch === 'function' ? await patch(Object.assign({}, s)) : patch;
    if (!p || typeof p !== 'object') return s;
    var o = {};
    var drop = [];
    var touched = false;
    Object.keys(p).forEach(function (k) {
      if (SPLIT[k]) {
        if (p[k] === undefined) drop.push(SPLIT[k]); else o[SPLIT[k]] = p[k];
        if (k in s) { delete s[k]; touched = true; }
        return;
      }
      if (p[k] === undefined) delete s[k]; else s[k] = p[k];
      touched = true;
    });
    if (touched) o[SETTINGS_KEY] = s;
    if (Object.keys(o).length) await root.chrome.storage.local.set(o);
    if (drop.length) await root.chrome.storage.local.remove(drop);
    if (touched) take(s);
    return s;
  }
  // The service worker writes for content scripts (one lock with the extension's pages).
  if (hasChrome && root.chrome.runtime && root.chrome.runtime.onMessage && typeof root.importScripts === 'function') {
    root.chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
      if (!msg || msg.type !== 'reelscope:settings-update' || (sender && sender.id && root.chrome.runtime.id && sender.id !== root.chrome.runtime.id)) return;
      var patch = msg.feature && BY_ID[msg.feature.id] ? featurePatch(msg.feature.id, msg.feature.on) : msg.patch;
      if (!patch || (typeof patch !== 'function' && typeof patch !== 'object')) { reply({ ok: false }); return; }
      serial(function () { return locked(function () { return updateNow(patch); }); }).then(function (s) { reply({ ok: true, settings: s }); }, function (e) { reply({ ok: false, error: String(e && e.message || e) }); });
      return true;
    });
  }

  /** One setting, wherever it lives (a split key, else rs:settings). */
  async function readSetting(name) {
    if (!hasChrome) return undefined;
    var keys = SPLIT[name] ? [SPLIT[name], SETTINGS_KEY] : [SETTINGS_KEY];
    var r = await root.chrome.storage.local.get(keys);
    if (SPLIT[name] && r[SPLIT[name]] !== undefined) return r[SPLIT[name]];
    return (r[SETTINGS_KEY] || {})[name];
  }
  /** Move radar / niche / ownProfit out of rs:settings (once; the service worker calls it at start). */
  function migrateSplit() {
    return serial(async function () {
      if (!hasChrome) return 0;
      var keys = [SETTINGS_KEY].concat(Object.keys(SPLIT).map(function (k) { return SPLIT[k]; }));
      var r = await root.chrome.storage.local.get(keys);
      var s = Object.assign({}, r[SETTINGS_KEY]);
      var o = {};
      var n = 0;
      Object.keys(SPLIT).forEach(function (k) {
        if (!(k in s)) return;
        if (r[SPLIT[k]] === undefined && s[k] != null) o[SPLIT[k]] = s[k];
        delete s[k];
        n++;
      });
      if (!n) return 0;
      o[SETTINGS_KEY] = s;
      await root.chrome.storage.local.set(o);
      take(s);
      return n;
    });
  }

  /** Turn a feature on or off (stored in rs:settings.features). */
  function set(id, on) {
    if (!BY_ID[id] || !hasChrome) return Promise.resolve(false);
    var done = function () { return true; };
    if (!extOrigin() && root.chrome.runtime && root.chrome.runtime.sendMessage) return serial(function () { return viaWorker({ feature: { id: id, on: !!on } }); }).then(done);
    return updateSettings(featurePatch(id, on)).then(done);
  }
  /** A choice setting's current value (CHOICES), e.g. choice('outlierFormula') → 'median'. */
  function choice(name) { return cache.choices[name] != null ? cache.choices[name] : choiceOf(name); }
  /** Store a choice setting (rs:settings.<name>). */
  function setChoice(name, value) {
    if (!CHOICES[name] || CHOICES[name].values.indexOf(value) === -1 || !hasChrome) return Promise.resolve(false);
    var p = {};
    p[name] = value;
    return updateSettings(p).then(function () { return true; });
  }

  /** Back to the defaults (forgets every choice). */
  function reset() {
    if (!hasChrome) return Promise.resolve();
    var p = { features: undefined };
    Object.keys(CHOICES).forEach(function (k) { p[k] = undefined; });
    return updateSettings(p).then(function () {});
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
      providers: connected && b.providers && typeof b.providers === 'object' ? b.providers : undefined,
      bridgeSettings: connected && !!b.settingsAt
    };
  }

  return {
    SETTINGS_KEY: SETTINGS_KEY, GROUPS: GROUPS, FEATURES: FEATURES, CHOICES: CHOICES, choiceOf: choiceOf, choice: choice, setChoice: setChoice,
    get: get, defaults: defaults, sanitize: sanitize, resolve: resolve, isOnIn: isOnIn, missing: missing, lang: lang,
    ready: ready, isOn: isOn, flags: flags, onChange: onChange, set: set, reset: reset, env: env,
    SPLIT: SPLIT, updateSettings: updateSettings, readSetting: readSetting, migrateSplit: migrateSplit,
    locale: function (l) { return locale(l || lang(cache.uiLang)); }, plural: function (n, forms, l) { return plural(n, forms, l || lang(cache.uiLang)); },
    signedPct: function (x, l, d) { return signedPct(x, l || lang(cache.uiLang), d); }, pct: function (x, l, d) { return pct(x, l || lang(cache.uiLang), d); },
    signedPts: function (x, l, d) { return signedPts(x, l || lang(cache.uiLang), d); }, applyLang: applyLang,
    uiLang: function () { return lang(cache.uiLang); }
  };
});
