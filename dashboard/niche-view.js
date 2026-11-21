// OpenOutlier Library – Niş Takibi / Niche tracking (#/niche), phase 1 of
// docs/youtube-niche-plan.md. The measurements live in the bridge's database
// (mcp/niche.mjs); this page asks the bridge for one ready-made answer through the
// service worker (reelscope:niche) and draws it:
//   this week's uploads ranked by velocity (with sparklines), the niche's curves,
//   what works (day/time, length, title words and patterns, Shorts vs long-form),
//   topic gaps, title / thumbnail changes, my videos vs the niche, breakouts,
//   channel growth, the weekly digest, the tracked channels and the RSS lag check.
// Phase 5 adds tabs (Radar, Channel map, Keywords, and similar thumbnails at #/niche/thumbs/<id>),
// drawn by dashboard/discovery-view.js.
// The tracking list itself is part of rs:org (src/tracking.js); the one-click helper
// that starts the Excel niche writes it there.
(function (root) {
  'use strict';

  var F = root.OpenOutlierFeatures;
  var TR = root.OpenOutlierTracking;
  var CPS = [1, 3, 6, 12, 24, 48, 72, 168, 336, 720];
  var BREAKOUT = 3;
  var ALERTS_KEY = 'rs:niche-alerts';
  var SETTINGS_KEY = 'rs:settings';

  var S = {
    en: {
      nav: 'Niche tracking', title: 'Niche tracking', loading: 'Loading…', refresh: 'Refresh', channelsBtn: 'Channels',
      updated: 'updated {t}', channelsN: '{n} channels', niche: 'Niche', allNiches: 'Untitled niche',
      kUploads: 'Uploads this week', kShorts: '{n} Shorts', kBreakouts: 'Breakouts (14 days)', kLong48: 'Long videos: 30-day views in 48 h', kShort48: 'Shorts: 30-day views in 48 h',
      kNoData: 'not enough data yet',
      week: 'This week', weekSub: 'Uploads of the last 7 days, fastest first. Score = views ÷ what the channel normally has at that age.',
      fAll: 'All', fLong: 'Videos', fShort: 'Shorts', showAll: 'Show all {n}', showFewer: 'Show the top 12', weekEmpty: 'No uploads in the last 7 days yet. New videos appear here within 15 minutes of going live.',
      score: '{x} at {at}', noScore: 'too new', expected: 'expected {n}', vph: '{n}/h', views: '{n} views', ago: '{t}',
      curveFromNiche: 'compared with the niche curve (the channel has fewer than 5 tracked videos)',
      curves: 'Niche curve', curvesSub: 'How much of its first 30 days a video has at each age (median of tracked videos).',
      curvesSentence: 'In this niche a long video gets {l} of its 30-day views in the first 48 hours; a Short gets {s}.',
      curvesSentenceL: 'In this niche a long video gets {l} of its 30-day views in the first 48 hours.',
      curvesNorm: 'Not enough videos have reached 30 days yet, so this shows views as a multiple of each channel\'s typical video.',
      curvesEmpty: 'Curves appear after the first new uploads are tracked from their first hours: the 48-hour points within about 2 days, the full 30-day shape within a month.',
      long: 'Long-form', short: 'Shorts', videosN: '{n} videos',
      works: 'What works', worksSub: 'By 48-hour velocity, from videos the tracker saw young (exact upload times, your time zone).',
      worksEmpty: 'Patterns need scored videos: they fill in as new uploads pass their first checkpoints (from 1 hour) and get stronger with every week.',
      bestSlot: 'Best slot: {d}, {b}', heat: 'Upload day × time', lengths: 'Length', words: 'Title words', patterns: 'Title patterns', formats: 'Shorts vs long-form', perWeek: 'Uploads per week (8 weeks)',
      withP: 'with', withoutP: 'without', nVideos: '{n} videos', medianScore: 'median {x}',
      gaps: 'Topic gaps', gapsSub: 'Fast but rare: words whose few videos beat the niche\'s median by 1.5× or more.', gapsEmpty: 'No gaps yet. They show up once there are enough scored videos to compare topics.',
      gapLine: '{n} videos · {c} channels', example: 'e.g.',
      changes: 'Title & thumbnail changes', changesSub: 'Competitors\' retitles and new thumbnails, with views per hour in the 24 h before and after.',
      changesEmpty: 'No changes seen yet. Titles are compared on every RSS read; thumbnails by a perceptual hash, so a new image behind the same URL counts too.',
      chTitle: 'Title', chThumb: 'Thumbnail', before: 'before', after: 'after', slope: '{a}/h → {b}/h',
      mine: 'My videos vs the niche', mineSub: 'Views at 48 h and per subscriber, against channels of your size (⅓× to 3× subscribers) or the whole niche.',
      mineNone: 'Mark your own channel to compare it: on its page in the Library, or with "Start tracking" below (Hands on Excel is preselected).',
      mineEmpty: 'Your next upload shows up here from its first hours.', peersSimilar: 'channels your size', peersNiche: 'the niche',
      at48: 'at 48 h', perSub: 'per subscriber', vsPeers: 'vs {n} for {p}', pending48: 'The 48-hour comparison comes on {d}.', nowAge: 'now, at {h}',
      breakouts: 'Fast risers', breakoutsSub: 'At {x}× or more of the channel\'s normal at 6 h or 24 h.', breakoutsEmpty: 'Nothing has broken out in the last 14 days. A Chrome notification comes when one does.',
      growth: 'Channel growth', growthSub: 'Daily subscribers since tracking started.', growthEmpty: 'Daily channel stats start the day a channel is tracked.',
      subs: 'subs', d7: '7 d', d28: '28 d',
      digest: 'Weekly digest', digestSub: 'Saved every Monday morning; this week so far until then.', digestWeek: 'Week of {d}', digestRunning: 'This week so far',
      digestTop: 'Top uploads', uploadsN: '{n} uploads', breakoutsN: '{n} breakouts', digestNone: 'No uploads yet this week.', digestAsk: 'Ask Claude for the write-up: "niche_report" (OpenOutlier MCP).',
      tracked: 'Tracked channels', backfilled: 'history loaded', backfillPending: 'loading history…', rssAt: 'RSS {t}', rssNever: 'waiting for the first RSS read',
      unresolved: 'Looking up {n} channel(s) by handle.', remove: 'Stop tracking',
      lag: 'RSS vs Data API', lagHow: 'How to read this', lagCollecting: 'Measuring: {n} of 12 samples so far.', lagOk: 'RSS view counts trail the API by ~{m} min (median, videos under 48 h). RSS is good enough for early curves.',
      lagBad: 'RSS trails the API by ~{m} min: the hourly API readings carry the first 48 hours.',
      lagExplain: 'For each RSS reading: how many minutes earlier the Data API already had that view count (two API readings of the same video, interpolated). Under 60 minutes is fine.',
      startTitle: 'Start tracking a niche', startText: 'Pick the YouTube channels to follow. They go into one folder that becomes the tracked niche; the bridge then checks their RSS feeds every 15 minutes and measures new videos with your Data API key, also while Chrome is closed.',
      startFolder: 'Folder', startPick: 'Channels in your library', startMine: 'Your channel', startMineMissing: 'Hands on Excel isn\'t saved yet; it will be tracked by its handle.',
      startGo: 'Track {n} channels', startOther: 'Any folder or tag can be a tracked niche: open it and press "Track as niche".', startNone: 'No YouTube channels saved yet. Open a channel on YouTube (Videos tab) and they are saved here.',
      missingNames: 'Not in your library yet: {list}.', cancel: 'Cancel', mineTag: 'mine', excelTag: 'Excel list',
      noBridge: 'Niche tracking runs in the OpenOutlier bridge on your Mac, and it isn\'t running.', install: 'Install it once (it stays on through launchd):',
      trackerOff: 'Niche tracking is switched off.', turnOn: 'Turn on', noKey: 'The bridge has no Data API key yet: only RSS runs (no exact counts, comments or lengths).', addKey: 'Copy the key in Settings',
      settings: 'Alert threshold', settingsHint: 'Breakout when a video reaches this multiple of its channel\'s normal at 6 h or 24 h.', fastStart: 'Measure every 30 min in the first 6 hours',
      days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], blocks: ['0–3', '3–6', '6–9', '9–12', '12–15', '15–18', '18–21', '21–24'],
      evergreen: 'evergreen', spike: 'spike', steady: 'steady', justNow: 'just now', sourceNiche: 'niche curve',
      sponsors: 'Who promotes what', sponsorsSub: 'Sponsors, discount codes and affiliate links in the tracked channels\' descriptions (last 365 days), most widespread first.',
      sponsorsEmpty: 'No sponsors or affiliate links found yet. Descriptions come in with each new upload\'s Data API reading and from the channels\' history; short links (bit.ly …) are counted, not followed.',
      spScanned: '{n} descriptions from {c} channels', spChannels: '{n} channels', spChannel1: '1 channel', spVideos: '{n} videos', spVideo1: '1 video', spLast: 'last {d}', spCodes: 'Codes',
      spShort: '{n} short links (target not visible)', spDisclose: '{n} disclose affiliate links', spAsk: 'Ask Claude: "sponsor_mentions" (OpenOutlier MCP).',
      kSponsor: 'sponsor', kAffiliate: 'affiliate', kLink: 'sponsor link', kUtm: 'tracked link', kCode: 'code', kDiscount: 'discount'
    },
    tr: {
      nav: 'Niş Takibi', title: 'Niş Takibi', loading: 'Yükleniyor…', refresh: 'Yenile', channelsBtn: 'Kanallar',
      updated: '{t} güncellendi', channelsN: '{n} kanal', niche: 'Niş', allNiches: 'Adsız niş',
      kUploads: 'Bu haftaki yüklemeler', kShorts: '{n} Shorts', kBreakouts: 'Hızlı yükselen (14 gün)', kLong48: 'Uzun video: 30 günün 48 saatteki payı', kShort48: 'Shorts: 30 günün 48 saatteki payı',
      kNoData: 'henüz yeterli veri yok',
      week: 'Bu hafta', weekSub: 'Son 7 günün yüklemeleri, en hızlısı başta. Skor = izlenme ÷ kanalın o yaştaki normali.',
      fAll: 'Hepsi', fLong: 'Videolar', fShort: 'Shorts', showAll: '{n} videonun hepsini göster', showFewer: 'İlk 12\'yi göster', weekEmpty: 'Son 7 günde yükleme yok. Yeni videolar yayına girdikten sonra 15 dakika içinde burada görünür.',
      score: '{at}: {x}', noScore: 'çok yeni', expected: 'beklenen {n}', vph: '{n}/sa', views: '{n} izlenme', ago: '{t}',
      curveFromNiche: 'niş eğrisiyle karşılaştırıldı (kanalın 5\'ten az takip edilen videosu var)',
      curves: 'Nişin eğrisi', curvesSub: 'Bir videonun ilk 30 gününün ne kadarını hangi yaşta aldığı (takip edilen videoların medyanı).',
      curvesSentence: 'Bu nişte bir uzun video 30 günlük izlenmesinin {l}\'ini ilk 48 saatte alıyor; bir Short {s}\'ini.',
      curvesSentenceL: 'Bu nişte bir uzun video 30 günlük izlenmesinin {l}\'ini ilk 48 saatte alıyor.',
      curvesNorm: 'Henüz yeterince video 30 güne ulaşmadı; grafik izlenmeyi her kanalın tipik videosunun katı olarak gösteriyor.',
      curvesEmpty: 'Eğriler, ilk yeni yüklemeler ilk saatlerinden itibaren takip edilince oluşur: 48 saatlik noktalar yaklaşık 2 günde, 30 günlük şekil bir ayda.',
      long: 'Uzun video', short: 'Shorts', videosN: '{n} video',
      works: 'Ne işe yarıyor', worksSub: '48 saatlik hıza göre; takipçinin genç yakaladığı videolardan (kesin yükleme zamanı, senin saat dilimin).',
      worksEmpty: 'Kalıplar skorlu video ister: yeni yüklemeler ilk kontrol noktalarını (1. saatten itibaren) geçtikçe dolar, her hafta güçlenir.',
      bestSlot: 'En iyi zaman: {d}, {b}', heat: 'Yükleme günü × saat', lengths: 'Süre', words: 'Başlık kelimeleri', patterns: 'Başlık kalıpları', formats: 'Shorts ve uzun video', perWeek: 'Haftalık yükleme (8 hafta)',
      withP: 'olan', withoutP: 'olmayan', nVideos: '{n} video', medianScore: 'medyan {x}',
      gaps: 'Konu boşlukları', gapsSub: 'Hızlı ama az: birkaç videosu nişin medyanını 1,5 kat ya da daha fazla geçen kelimeler.', gapsEmpty: 'Henüz boşluk yok. Konuları karşılaştıracak kadar skorlu video olunca görünür.',
      gapLine: '{n} video · {c} kanal', example: 'örn.',
      changes: 'Başlık ve thumbnail değişiklikleri', changesSub: 'Rakiplerin başlık ve thumbnail değişiklikleri; öncesi ve sonrasındaki 24 saatte saat başına izlenme.',
      changesEmpty: 'Henüz değişiklik yok. Başlıklar her RSS okumasında karşılaştırılır; thumbnail\'ler perceptual hash ile, yani aynı adresteki yeni görsel de sayılır.',
      chTitle: 'Başlık', chThumb: 'Thumbnail', before: 'önce', after: 'sonra', slope: '{a}/sa → {b}/sa',
      mine: 'Benim videolarım ve niş', mineSub: '48. saatteki izlenme ve abone başına izlenme; senin büyüklüğündeki kanallarla (⅓× ile 3× abone) ya da bütün nişle.',
      mineNone: 'Karşılaştırmak için kendi kanalını işaretle: Library\'deki sayfasından ya da aşağıdaki "Takibi başlat" ile (Hands on Excel seçili gelir).',
      mineEmpty: 'Bir sonraki yüklemen ilk saatlerinden itibaren burada görünür.', peersSimilar: 'senin büyüklüğündeki kanallar', peersNiche: 'niş',
      at48: '48. saatte', perSub: 'abone başına', vsPeers: '{p}: {n}', pending48: '48 saatlik karşılaştırma {d} gelir.', nowAge: 'şu an, {h}',
      breakouts: 'Hızlı yükselenler', breakoutsSub: '6. veya 24. saatte kanalın normalinin {x} katı ya da fazlası.', breakoutsEmpty: 'Son 14 günde hızlı yükselen yok. Olunca Chrome bildirimi gelir.',
      growth: 'Kanal büyümesi', growthSub: 'Takip başladığından beri günlük abone.', growthEmpty: 'Günlük kanal istatistikleri, kanal takibe girdiği gün başlar.',
      subs: 'abone', d7: '7 g', d28: '28 g',
      digest: 'Haftalık özet', digestSub: 'Her pazartesi sabahı kaydedilir; o zamana kadar bu haftanın gidişatı.', digestWeek: '{d} haftası', digestRunning: 'Bu hafta şimdiye kadar',
      digestTop: 'En iyi yüklemeler', uploadsN: '{n} yükleme', breakoutsN: '{n} hızlı yükselen', digestNone: 'Bu hafta henüz yükleme yok.', digestAsk: 'Yorumu Claude\'a yazdır: "niche_report" (OpenOutlier MCP).',
      tracked: 'Takip edilen kanallar', backfilled: 'geçmiş yüklendi', backfillPending: 'geçmiş yükleniyor…', rssAt: 'RSS {t}', rssNever: 'ilk RSS okuması bekleniyor',
      unresolved: '{n} kanal handle ile aranıyor.', remove: 'Takibi bırak',
      lag: 'RSS ve Data API', lagHow: 'Nasıl okunur', lagCollecting: 'Ölçülüyor: şimdiye kadar 12 örnekten {n}.', lagOk: 'RSS izlenme sayısı API\'nin ~{m} dk gerisinde (medyan, 48 saatten genç videolar). Erken eğriler için RSS yeterli.',
      lagBad: 'RSS, API\'nin ~{m} dk gerisinde: ilk 48 saati saatlik API ölçümleri taşıyor.',
      lagExplain: 'Her RSS okuması için: Data API o izlenme sayısına kaç dakika önce ulaşmıştı (aynı videonun iki API ölçümü arasında ara değer). 60 dakikanın altı iyi.',
      startTitle: 'Bir nişi takibe başla', startText: 'Takip edilecek YouTube kanallarını seç. Bir klasöre girerler ve o klasör takip edilen niş olur; bridge RSS akışlarını 15 dakikada bir okur, yeni videoları Data API anahtarınla ölçer, Chrome kapalıyken de.',
      startFolder: 'Klasör', startPick: 'Library\'deki kanallar', startMine: 'Senin kanalın', startMineMissing: 'Hands on Excel henüz kayıtlı değil; handle\'ıyla takip edilecek.',
      startGo: '{n} kanalı takip et', startOther: 'Her klasör ya da etiket takip edilen niş olabilir: aç ve "Niş olarak takip et"e bas.', startNone: 'Henüz kayıtlı YouTube kanalı yok. YouTube\'da bir kanalın Videolar sekmesini aç; burada kaydolur.',
      missingNames: 'Henüz Library\'de değil: {list}.', cancel: 'Vazgeç', mineTag: 'benim', excelTag: 'Excel listesi',
      noBridge: 'Niş takibi Mac\'teki OpenOutlier bridge\'inde çalışır ve bridge çalışmıyor.', install: 'Bir kez kur (launchd sayesinde açık kalır):',
      trackerOff: 'Niş takibi kapalı.', turnOn: 'Aç', noKey: 'Bridge\'de henüz Data API anahtarı yok: sadece RSS çalışıyor (kesin sayı, yorum ve süre yok).', addKey: 'Anahtarı Ayarlar\'dan kopyala',
      settings: 'Uyarı eşiği', settingsHint: 'Bir video 6. veya 24. saatte kanalının normalinin bu katına ulaşınca hızlı yükselen sayılır.', fastStart: 'İlk 6 saatte 30 dakikada bir ölç',
      days: ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'], blocks: ['0–3', '3–6', '6–9', '9–12', '12–15', '15–18', '18–21', '21–24'],
      evergreen: 'evergreen', spike: 'patlama', steady: 'dengeli', justNow: 'az önce', sourceNiche: 'niş eğrisi',
      sponsors: 'Kim neyi tanıtıyor', sponsorsSub: 'Takip edilen kanalların açıklamalarındaki sponsorlar, indirim kodları ve affiliate linkler (son 365 gün), en yaygını başta.',
      sponsorsEmpty: 'Henüz sponsor ya da affiliate link bulunmadı. Açıklamalar her yeni yüklemenin Data API ölçümüyle ve kanalların geçmişinden gelir; kısa linkler (bit.ly …) sayılır, açılmaz.',
      spScanned: '{c} kanaldan {n} açıklama', spChannels: '{n} kanal', spChannel1: '1 kanal', spVideos: '{n} video', spVideo1: '1 video', spLast: 'son {d}', spCodes: 'Kodlar',
      spShort: '{n} kısa link (hedefi görünmüyor)', spDisclose: '{n} açıklama affiliate link olduğunu belirtiyor', spAsk: 'Claude\'a sor: "sponsor_mentions" (OpenOutlier MCP).',
      kSponsor: 'sponsor', kAffiliate: 'affiliate', kLink: 'sponsor linki', kUtm: 'takipli link', kCode: 'kod', kDiscount: 'indirim'
    }
  };

  function create(env) {
    var h = env.h;
    var ui = { loading: false, error: '', data: null, niche: undefined, filter: 'all', showChannels: false, start: null, msg: '', busy: false, at: 0 };

    function lang() { return F && F.uiLang ? F.uiLang() : 'en'; }
    function L() { return S[lang()] || S.en; }
    function fill(s, o) { return String(s).replace(/\{(\w+)\}/g, function (_, k) { return o[k] != null ? o[k] : ''; }); }
    function loc() { return lang() === 'tr' ? 'tr-TR' : 'en-US'; }
    function num(n) { return n == null ? '–' : new Intl.NumberFormat(loc(), { notation: 'compact', maximumFractionDigits: n < 1000 ? 0 : 1 }).format(n); }
    function full(n) { return n == null ? '–' : new Intl.NumberFormat(loc()).format(Math.round(n)); }
    function times(x) { return x == null ? '–' : new Intl.NumberFormat(loc(), { maximumFractionDigits: x < 10 ? 1 : 0, minimumFractionDigits: x < 10 ? 1 : 0 }).format(x) + '×'; }
    function pct(x) { return x == null ? '–' : new Intl.NumberFormat(loc(), { style: 'percent', maximumFractionDigits: 0 }).format(x); }
    function signed(n) { return n == null ? '–' : (n > 0 ? '+' : n < 0 ? '−' : '') + num(Math.abs(n)); }
    function ago(t) {
      if (!t) return '–';
      var s = (t - Date.now()) / 1000;
      if (Math.abs(s) < 60) return L().justNow;
      var rtf = new Intl.RelativeTimeFormat(loc(), { numeric: 'auto' });
      var units = [['day', 86400], ['hour', 3600], ['minute', 60]];
      for (var i = 0; i < units.length; i++) if (Math.abs(s) >= units[i][1]) return rtf.format(Math.round(s / units[i][1]), units[i][0]);
      return L().justNow;
    }
    function when(t) { return t ? new Date(t).toLocaleString(loc(), { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '–'; }
    function day(t) { return t ? new Date(t).toLocaleDateString(loc(), { day: 'numeric', month: 'short' }) : '–'; }
    function dur(s) { if (!s) return ''; s = Math.round(s); var hh = Math.floor(s / 3600); var mm = Math.floor((s % 3600) / 60); var ss = s % 60; return (hh ? hh + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(ss).padStart(2, '0'); }
    function dec(x, n) { return x == null ? '–' : new Intl.NumberFormat(loc(), { maximumFractionDigits: n }).format(x); }
    function subsOf(d, v) { var c = (d.channels || []).filter(function (x) { return x.channel_id === v.channel_id; })[0]; return c && c.subs; }
    function cp(hrs) { return hrs < 168 ? hrs + (lang() === 'tr' ? ' sa' : ' h') : (hrs / 24) + (lang() === 'tr' ? ' g' : ' d'); }
    function cpLabel(lbl) { var m = /^(\d+)([hd])$/.exec(String(lbl || '')); return m ? m[1] + (m[2] === 'h' ? (lang() === 'tr' ? ' sa' : ' h') : (lang() === 'tr' ? ' g' : ' d')) : lbl; }

    function call(extra) {
      return chrome.runtime.sendMessage(Object.assign({ type: 'reelscope:niche', path: '/youtube/niche/page', tz: -new Date().getTimezoneOffset() }, extra || {}))
        .then(function (r) { return r || { ok: false, error: 'No answer from the service worker.' }; }, function (e) { return { ok: false, error: e.message }; });
    }

    async function refresh() {
      ui.loading = true;
      ui.error = '';
      env.rerender();
      var r = await call(ui.niche !== undefined ? { niche: ui.niche || '' } : {});
      ui.loading = false;
      if (!r.ok) { ui.error = r.error || 'Failed.'; ui.noBridge = !!r.noBridge; ui.data = null; }
      else { ui.data = r; ui.noBridge = false; ui.at = Date.now(); }
      env.rerender();
      // Opening the page counts as seeing the breakouts.
      chrome.storage.local.get(ALERTS_KEY).then(function (x) {
        var a = x[ALERTS_KEY];
        if (a && a.unseen) { var o = {}; o[ALERTS_KEY] = Object.assign({}, a, { unseen: 0 }); chrome.storage.local.set(o); }
      });
    }

    // ---- SVG helpers --------------------------------------------------------------------
    var NS = 'http://www.w3.org/2000/svg';
    function svg(tag, attrs, kids) {
      var el = document.createElementNS(NS, tag);
      for (var k in attrs || {}) if (attrs[k] != null) el.setAttribute(k, attrs[k]);
      (kids || []).forEach(function (c) { if (c) el.appendChild(c); });
      return el;
    }
    function txt(x, y, s, cls, anchor) { var t = svg('text', { x: x, y: y, class: cls, 'text-anchor': anchor || 'start' }); t.textContent = s; return t; }

    /** Sparkline of one video: its views (line) and the channel's expected curve (dashed), on log-hours. */
    function spark(v) {
      var W = 132;
      var Hh = 38;
      var pts = (v.spark && v.spark.points) || [];
      var exp = (v.spark && v.spark.expected) || [];
      var maxH = Math.max(1, v.age_h || 1, pts.length ? pts[pts.length - 1][0] : 1);
      var maxV = Math.max(1, Math.max.apply(null, pts.map(function (p) { return p[1]; }).concat(exp.filter(function (e) { return e[0] <= maxH * 1.05; }).map(function (e) { return e[1]; }))));
      var X = function (hr) { return 2 + (Math.log(1 + hr) / Math.log(1 + maxH)) * (W - 4); };
      var Yv = function (val) { return Hh - 3 - (val / maxV) * (Hh - 6); };
      var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Yv(p[1]).toFixed(1); }).join(' ');
      var e = [[0, 0]].concat(exp.filter(function (q) { return q[0] <= maxH * 1.05; }));
      var eLine = e.length > 1 ? e.map(function (p, i) { return (i ? 'L' : 'M') + X(Math.min(p[0], maxH)).toFixed(1) + ' ' + Yv(p[1]).toFixed(1); }).join(' ') : null;
      var hot = v.score != null && v.score >= BREAKOUT;
      var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + Hh, class: 'nv-spark' + (hot ? ' is-hot' : ''), role: 'img', 'aria-label': (v.score != null ? times(v.score) + ' · ' : '') + full(v.views) },
        [eLine ? svg('path', { d: eLine, class: 'nv-spark-exp' }) : null, line ? svg('path', { d: line, class: 'nv-spark-line' }) : null,
          pts.length ? svg('rect', { x: X(pts[pts.length - 1][0]) - 2, y: Yv(pts[pts.length - 1][1]) - 2, width: 4, height: 4, class: 'nv-spark-dot' }) : null]);
      return s;
    }

    /** The niche curve chart: checkpoints evenly spaced; long-form and Shorts. */
    function curveChart(c, mode) {
      var W = 640;
      var Hh = 220;
      var padL = 40;
      var padR = 72;
      var padT = 12;
      var padB = 28;
      var key = mode === 'share' ? 'share' : 'norm';
      var series = [['long', L().long, 'nv-c-long'], ['short', L().short, 'nv-c-short']].filter(function (s) { return c[s[0]] && CPS.some(function (h) { return c[s[0]][key][h] != null; }); });
      var maxY = mode === 'share' ? 1 : Math.max(0.5, Math.max.apply(null, series.map(function (s) { return Math.max.apply(null, CPS.map(function (h) { return c[s[0]][key][h] || 0; })); })) * 1.1);
      var X = function (i) { return padL + i * (W - padL - padR) / (CPS.length - 1); };
      var Yv = function (val) { return padT + (1 - val / maxY) * (Hh - padT - padB); };
      var g = [];
      var ticks = mode === 'share' ? [0, 0.25, 0.5, 0.75, 1] : [0, maxY / 2, maxY].map(function (x) { return Math.round(x * 10) / 10; });
      ticks.forEach(function (t) {
        g.push(svg('line', { x1: padL, x2: W - padR, y1: Yv(t), y2: Yv(t), class: 'nv-grid' }));
        g.push(txt(padL - 6, Yv(t) + 4, mode === 'share' ? pct(t) : times(t), 'nv-axis', 'end'));
      });
      CPS.forEach(function (hr, i) { g.push(txt(X(i), Hh - 8, cp(hr), 'nv-axis', 'middle')); });
      g.push(svg('line', { x1: X(5), x2: X(5), y1: padT, y2: Hh - padB, class: 'nv-mark' }));
      var labels = [];
      series.forEach(function (s) {
        var vals = CPS.map(function (hr, i) { return { i: i, v: c[s[0]][key][hr] }; }).filter(function (p) { return p.v != null; });
        g.push(svg('path', { d: vals.map(function (p, j) { return (j ? 'L' : 'M') + X(p.i).toFixed(1) + ' ' + Yv(p.v).toFixed(1); }).join(' '), class: 'nv-c-line ' + s[2] }));
        vals.forEach(function (p) { g.push(svg('rect', { x: X(p.i) - 2.5, y: Yv(p.v) - 2.5, width: 5, height: 5, class: 'nv-c-pt ' + s[2] })); });
        var last = vals[vals.length - 1];
        labels.push({ y: Yv(last.v), x: X(last.i), text: s[1], cls: s[2] });
      });
      // Direct labels at the line ends, nudged apart when they collide.
      labels.sort(function (a, b) { return a.y - b.y; });
      for (var i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
      labels.forEach(function (lb) { g.push(txt(lb.x + 8, lb.y + 4, lb.text, 'nv-c-label ' + lb.cls)); });
      return svg('svg', { viewBox: '0 0 ' + W + ' ' + Hh, class: 'nv-curve', role: 'img', 'aria-label': L().curves }, g);
    }

    // ---- pieces -----------------------------------------------------------------------------
    function card(cls, title, sub, body, extra) {
      return h('section', { class: 'm-card nv-card ' + (cls || '') },
        h('div', { class: 'nv-card-head' }, h('h2', { text: title }), extra || null),
        sub ? h('p', { class: 'nv-sub', text: sub }) : null,
        body);
    }
    function empty(text) { return h('p', { class: 'nv-empty' }, h('span', { class: 'nv-empty-px', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('span', { text: text })); }
    function thumb(v, cls) {
      var wrap = h('a', { class: 'nv-thumb ' + (cls || '') + (v.type === 'short' ? ' is-short' : ''), href: v.url, target: '_blank', rel: 'noopener noreferrer', tabindex: '-1', 'aria-hidden': 'true' });
      var im = h('img', { alt: '', loading: 'lazy', decoding: 'async' });
      im.addEventListener('error', function () { im.remove(); wrap.classList.add('is-blank'); });
      if (env.loadImage) env.loadImage(im, v.thumb); else im.src = v.thumb;
      wrap.appendChild(im);
      if (v.duration && v.type !== 'short') wrap.appendChild(h('span', { class: 'nv-dur', text: dur(v.duration) }));
      if (v.type === 'short') wrap.appendChild(h('span', { class: 'nv-dur', text: 'Shorts' }));
      return wrap;
    }
    function scoreBadge(v, big) {
      if (v.score == null) return h('span', { class: 'nv-score is-none', text: L().noScore });
      var cls = v.score >= BREAKOUT ? ' is-hot' : v.score >= 2 ? ' is-out' : v.score < 0.7 ? ' is-low' : '';
      return h('span', { class: 'nv-score' + cls + (big ? ' big' : ''), title: fill(L().expected, { n: full(v.expected) }) + (v.curve_from === 'niche' ? ' · ' + L().curveFromNiche : '') },
        v.score >= 2 ? h('span', { class: 'stair', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')) : null,
        h('b', { text: times(v.score) }), h('small', { text: cpLabel(v.score_at) }));
    }

    function kpis(d) {
      var w = d.week || [];
      var hot = (d.breakouts || []).length;
      var lk = d.curves.long.share_48h;
      var sk = d.curves.short.share_48h;
      function k(label, value, sub, cls) { return h('div', { class: 'kpi' + (cls ? ' ' + cls : '') }, h('span', { class: 'kpi-label', text: label }), h('b', { text: value }), sub ? h('small', { class: 'nv-kpi-sub', text: sub }) : null); }
      return h('div', { class: 'kpis nv-kpis' },
        k(L().kUploads, full(w.length), fill(L().kShorts, { n: w.filter(function (v) { return v.type === 'short'; }).length })),
        k(L().kBreakouts, full(hot), null, hot ? 'hot' : null),
        k(L().kLong48, lk == null ? '–' : pct(lk), lk == null ? L().kNoData : fill(L().videosN, { n: d.curves.long.share_videos })),
        k(L().kShort48, sk == null ? '–' : pct(sk), sk == null ? L().kNoData : fill(L().videosN, { n: d.curves.short.share_videos })));
    }

    function weekCard(d) {
      var list = (d.week || []).filter(function (v) { return ui.filter === 'all' || (ui.filter === 'short' ? v.type === 'short' : v.type !== 'short'); });
      var seg = h('div', { class: 'seg nv-seg', role: 'group', 'aria-label': L().week },
        [['all', L().fAll], ['long', L().fLong], ['short', L().fShort]].map(function (o) {
          return h('button', { type: 'button', 'aria-pressed': ui.filter === o[0] ? 'true' : 'false', onclick: function () { ui.filter = o[0]; env.rerender(); } }, o[1]);
        }));
      var shown = ui.weekAll ? list : list.slice(0, 12);
      var body = list.length ? h('ol', { class: 'nv-week' }, shown.map(function (v, i) {
        return h('li', { class: 'nv-row' + (v.mine ? ' is-mine' : '') },
          h('span', { class: 'nv-rank', text: String(i + 1) }),
          thumb(v),
          h('div', { class: 'nv-main' },
            h('a', { class: 'nv-title', href: v.url, target: '_blank', rel: 'noopener noreferrer', text: v.title || v.id }),
            h('div', { class: 'nv-meta' },
              h('span', { class: 'nv-chan', text: v.channel }), v.mine ? h('span', { class: 'nv-tag', text: L().mineTag }) : null,
              h('span', { text: when(v.published_at) }), h('span', { text: ago(v.published_at) }))),
          spark(v),
          h('div', { class: 'nv-nums' },
            scoreBadge(v),
            h('span', { class: 'nv-views', text: fill(L().views, { n: num(v.views) }) }),
            v.vph24 != null ? h('span', { class: 'nv-vph', text: fill(L().vph, { n: num(v.vph24) }) }) : null));
      })) : empty(L().weekEmpty);
      var more = list.length > shown.length || ui.weekAll && list.length > 12
        ? h('button', { class: 'btn btn-ghost nv-more', type: 'button', onclick: function () { ui.weekAll = !ui.weekAll; env.rerender(); } }, ui.weekAll ? L().showFewer : fill(L().showAll, { n: list.length }))
        : null;
      return card('nv-weekcard', L().week, L().weekSub, h('div', null, body, more), seg);
    }

    function curvesCard(d) {
      var c = d.curves;
      var hasShare = ['long', 'short'].some(function (f) { return c[f].share_videos >= 3 && c[f].share[48] != null; });
      var hasNorm = ['long', 'short'].some(function (f) { return CPS.some(function (h) { return c[f].norm[h] != null; }); });
      var body;
      if (!hasShare && !hasNorm) body = empty(L().curvesEmpty);
      else {
        var sentence = c.long.share_48h != null ? (c.short.share_48h != null ? fill(L().curvesSentence, { l: pct(c.long.share_48h), s: pct(c.short.share_48h) }) : fill(L().curvesSentenceL, { l: pct(c.long.share_48h) })) : null;
        body = h('div', null,
          sentence ? h('p', { class: 'nv-lede', text: sentence }) : h('p', { class: 'nv-sub', text: L().curvesNorm }),
          h('div', { class: 'nv-chart-wrap' }, curveChart(c, hasShare ? 'share' : 'norm')),
          h('p', { class: 'nv-legend' },
            h('span', { class: 'nv-key nv-c-long' }), L().long + ' · ' + fill(L().videosN, { n: c.long.videos }), '   ',
            h('span', { class: 'nv-key nv-c-short' }), L().short + ' · ' + fill(L().videosN, { n: c.short.videos })));
      }
      return card('nv-curvecard', L().curves, L().curvesSub, body);
    }

    function heatmap(ww) {
      var cells = ww.cells || {};
      var vals = Object.keys(cells).map(function (k) { return cells[k].median; }).filter(function (x) { return x != null; });
      var lo = Math.min.apply(null, vals.concat([1]));
      var hi = Math.max.apply(null, vals.concat([1]));
      var order = lang() === 'tr' ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
      var grid = h('div', { class: 'nv-heat', role: 'table', 'aria-label': L().heat });
      grid.appendChild(h('span', { class: 'nv-heat-corner' }));
      L().blocks.forEach(function (b) { grid.appendChild(h('span', { class: 'nv-heat-col', text: b })); });
      order.forEach(function (dIdx) {
        grid.appendChild(h('span', { class: 'nv-heat-row', text: L().days[dIdx] }));
        for (var b = 0; b < 8; b++) {
          var c = cells[dIdx + ':' + b];
          var v = c && c.median;
          var lvl = v == null ? -1 : hi === lo ? 3 : Math.round((v - lo) / (hi - lo) * 5);
          grid.appendChild(h('span', { class: 'nv-heat-cell' + (lvl < 0 ? ' is-empty' : ' l' + lvl), title: c ? L().days[dIdx] + ' ' + L().blocks[b] + ': ' + fill(L().medianScore, { x: times(v) }) + ' · ' + fill(L().nVideos, { n: c.n }) : '' },
            v != null && c.n >= 2 ? times(v) : ''));
        }
      });
      return grid;
    }

    function bars(rows, max) {
      return h('div', { class: 'nv-bars' }, rows.map(function (r) {
        return h('div', { class: 'nv-bar-row' },
          h('span', { class: 'nv-bar-label', text: r.label }),
          h('span', { class: 'nv-bar-track' }, h('span', { class: 'nv-bar' + (r.v >= 1 ? ' is-up' : ''), style: 'width:' + Math.max(2, Math.min(100, (r.v || 0) / max * 100)).toFixed(1) + '%' })),
          h('span', { class: 'nv-bar-val', text: r.v == null ? '–' : times(r.v) }),
          h('span', { class: 'nv-bar-n', text: fill(L().nVideos, { n: r.n }) }));
      }));
    }

    function worksCard(d) {
      var ww = d.what_works || {};
      if (!ww.videos) return card('nv-workscard', L().works, L().worksSub, empty(L().worksEmpty));
      var lenOrder = (ww.length_order || []).filter(function (k) { return ww.lengths[k]; });
      var lenRows = lenOrder.map(function (k) { return { label: k === 'short' ? L().short : k, v: ww.lengths[k].median, n: ww.lengths[k].n }; });
      var fmtRows = ['long', 'short'].filter(function (k) { return ww.formats[k]; }).map(function (k) { return { label: k === 'short' ? L().short : L().long, v: ww.formats[k].median, n: ww.formats[k].n }; });
      var maxBar = Math.max.apply(null, lenRows.concat(fmtRows).map(function (r) { return r.v || 0; }).concat([1.5]));
      var best = ww.best_day && ww.best_block ? fill(L().bestSlot, { d: L().days[ww.best_day.key], b: L().blocks[ww.best_block.key] }) : null;
      var words = (ww.words || []).slice(0, 10);
      var pats = (ww.patterns || []).filter(function (p) { return p.lift != null; }).sort(function (a, b) { return b.lift - a.lift; });
      var per = (ww.uploads_per_week || []).slice(0, 8);
      return card('nv-workscard', L().works, L().worksSub, h('div', { class: 'nv-works' },
        h('div', { class: 'nv-w-block nv-w-heat' },
          h('h3', { text: L().heat }), best ? h('p', { class: 'nv-best' }, h('span', { class: 'stair', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), best) : null, heatmap(ww)),
        h('div', { class: 'nv-w-block' }, h('h3', { text: L().lengths }), bars(lenRows, maxBar)),
        h('div', { class: 'nv-w-block' }, h('h3', { text: L().formats }), bars(fmtRows, maxBar)),
        words.length ? h('div', { class: 'nv-w-block' }, h('h3', { text: L().words }),
          h('div', { class: 'nv-words' }, words.map(function (w) {
            return h('span', { class: 'nv-word' + (w.lift >= 1.2 ? ' is-up' : w.lift < 0.85 ? ' is-down' : ''), title: fill(L().nVideos, { n: w.n }) }, w.word, h('b', { text: times(w.lift) }));
          }))) : null,
        pats.length ? h('div', { class: 'nv-w-block' }, h('h3', { text: L().patterns }),
          h('table', { class: 'nv-pat' }, h('tbody', null, pats.map(function (p) {
            return h('tr', null, h('th', { text: (p.label && (p.label[lang()] || p.label.en)) || p.id }),
              h('td', { class: 'num' + (p.lift >= 1.1 ? ' is-up' : p.lift < 0.9 ? ' is-down' : ''), text: times(p.lift) }),
              h('td', { class: 'muted', text: fill(L().nVideos, { n: p.n }) }));
          })))) : null,
        per.length ? h('div', { class: 'nv-w-block' }, h('h3', { text: L().perWeek }),
          h('table', { class: 'nv-pat' }, h('tbody', null, per.map(function (p) {
            return h('tr', null, h('th', { text: p.name }), h('td', { class: 'num', text: String(p.per_week).replace('.', lang() === 'tr' ? ',' : '.') + '/' + (lang() === 'tr' ? 'hf' : 'wk') }),
              h('td', { class: 'muted', text: p.median_score == null ? '' : fill(L().medianScore, { x: times(p.median_score) }) }));
          })))) : null));
    }

    function gapsCard(d) {
      var g = d.gaps || [];
      return card('nv-gapcard', L().gaps, L().gapsSub, g.length ? h('ol', { class: 'nv-gaps' }, g.map(function (x) {
        return h('li', null,
          h('div', { class: 'nv-gap-head' }, h('b', { class: 'nv-gap-word', text: x.word }), h('span', { class: 'nv-score is-out' }, h('b', { text: times(x.lift) }))),
          h('span', { class: 'nv-gap-n', text: fill(L().gapLine, { n: x.n, c: x.channels }) }),
          x.examples && x.examples[0] ? h('span', { class: 'nv-gap-ex', text: L().example + ' “' + x.examples[0].title + '”' }) : null);
      })) : empty(L().gapsEmpty));
    }

    function changesCard(d) {
      var list = d.changes || [];
      return card('nv-chcard', L().changes, L().changesSub, list.length ? h('ul', { class: 'nv-changes' }, list.slice(0, 8).map(function (v) {
        return h('li', null, thumb(Object.assign({ url: 'https://www.youtube.com/watch?v=' + v.id }, v), 'small'),
          h('div', { class: 'nv-main' },
            h('div', { class: 'nv-meta' }, h('span', { class: 'nv-chan', text: v.channel })),
            v.changes.slice(0, 2).map(function (c) {
              var up = c.slope_before != null && c.slope_after != null ? c.slope_after - c.slope_before : null;
              return h('div', { class: 'nv-change' },
                h('span', { class: 'nv-ch-kind', text: c.field === 'title' ? L().chTitle : L().chThumb }),
                c.field === 'title'
                  ? h('span', { class: 'nv-ch-titles' }, h('s', { text: c.before || '' }), h('span', { class: 'nv-arrow', 'aria-hidden': 'true', text: '→' }), h('span', { text: c.after || '' }))
                  : h('span', { class: 'nv-ch-titles muted', text: day(c.at) }),
                c.slope_before != null || c.slope_after != null ? h('span', { class: 'nv-slope' + (up > 0 ? ' is-up' : up < 0 ? ' is-down' : ''), text: fill(L().slope, { a: num(c.slope_before), b: num(c.slope_after) }) }) : null,
                h('span', { class: 'nv-ch-when', text: ago(c.at) }));
            })));
      })) : empty(L().changesEmpty));
    }

    // Phase 4 (channel-sponsors): src/sponsors.js over the niche's descriptions, from the bridge (mcp/content.mjs).
    function sponsorsCard(d) {
      var sp = d.sponsors;
      if (!sp) return null;
      var list = (sp.brands || []).slice(0, 12);
      var sub = L().sponsorsSub;
      var meta = h('p', { class: 'nv-sub sp-meta' }, fill(L().spScanned, { n: full(sp.scanned), c: full(sp.channels_scanned) }),
        sp.short_links ? ' · ' + fill(L().spShort, { n: full(sp.short_links) }) : '');
      if (!list.length) return card('sp-card', L().sponsors, sub, h('div', null, meta, empty(L().sponsorsEmpty)));
      var KIND = { sponsor: L().kSponsor, affiliate: L().kAffiliate, 'brand-link': L().kLink, utm: L().kUtm, code: L().kCode, discount: L().kDiscount };
      var max = Math.max.apply(null, list.map(function (b) { return b.videos; }));
      var body = h('ol', { class: 'sp-list' }, list.map(function (b, i) {
        var chans = b.channels || [];
        return h('li', { class: 'sp-row' },
          h('span', { class: 'nv-rank', text: String(i + 1) }),
          h('div', { class: 'sp-main' },
            h('div', { class: 'sp-head' }, h('b', { class: 'sp-brand', text: b.brand }),
              (b.kinds || []).filter(function (k) { return KIND[k]; }).map(function (k) { return h('span', { class: 'nv-tag is-soft', text: KIND[k] }); })),
            h('div', { class: 'sp-chans', title: chans.map(function (c) { return c.name + ' (' + c.videos + ')'; }).join('\n') },
              chans.slice(0, 4).map(function (c) { return c.name; }).join(' · ') + (chans.length > 4 ? ' · +' + (chans.length - 4) : '')),
            b.codes && b.codes.length ? h('div', { class: 'sp-codes' }, h('span', { class: 'muted', text: L().spCodes }), b.codes.slice(0, 4).map(function (c) { return h('code', { text: c }); })) : null,
            b.examples && b.examples[0] && b.examples[0].text ? h('p', { class: 'sp-ex', text: '“' + b.examples[0].text + '”' }) : null),
          h('div', { class: 'sp-nums' },
            h('span', { class: 'sp-bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(6, b.videos / max * 100).toFixed(1) + '%' })),
            h('b', { text: chans.length === 1 ? L().spChannel1 : fill(L().spChannels, { n: chans.length }) }),
            h('span', { text: (b.videos === 1 ? L().spVideo1 : fill(L().spVideos, { n: full(b.videos) })) + (b.last_at ? ' · ' + fill(L().spLast, { d: day(Date.parse(b.last_at + 'T12:00:00Z')) }) : '') })));
      }));
      var disc = (sp.channels || []).reduce(function (n, c) { return n + (c.disclosure || 0); }, 0);
      return card('sp-card', L().sponsors, sub, h('div', null, meta, body,
        h('p', { class: 'nv-sub sp-foot' }, disc ? fill(L().spDisclose, { n: full(disc) }) + ' · ' : '', L().spAsk)));
    }

    function mineCard(d) {
      var m = d.mine || { channels: [], videos: [] };
      if (!m.channels.length) return card('nv-minecard', L().mine, null, empty(L().mineNone));
      var vids = m.videos.slice(0, 5);
      return card('nv-minecard', L().mine, L().mineSub, vids.length ? h('ul', { class: 'nv-mine' }, vids.map(function (v) {
        var p = v.peers || {};
        var peerName = p.scope === 'similar' ? L().peersSimilar : L().peersNiche;
        var ratio = v.views_48h != null && p.views_48h ? v.views_48h / p.views_48h : null;
        return h('li', null,
          h('div', { class: 'nv-mine-head' }, h('a', { class: 'nv-title', href: v.url, target: '_blank', rel: 'noopener noreferrer', text: v.title }), scoreBadge(v)),
          // Before 48 h: today's numbers, and when the 48 h comparison comes.
          h('div', { class: 'nv-mine-grid' },
            h('div', null, h('b', { text: full(v.views_48h != null ? v.views_48h : v.views) }), h('span', { text: v.views_48h != null ? L().at48 : fill(L().nowAge, { h: cp(Math.max(1, Math.round(v.age_h))) }) }),
              h('small', { text: fill(L().vsPeers, { n: full(p.views_48h), p: peerName }) })),
            h('div', null, h('b', { text: dec(v.views_per_sub_48h != null ? v.views_per_sub_48h : (subsOf(d, v) ? (v.views || 0) / subsOf(d, v) : null), 2) }), h('span', { text: L().perSub + (v.views_per_sub_48h != null ? ' · ' + L().at48 : '') }),
              h('small', { text: fill(L().vsPeers, { n: dec(p.views_per_sub_48h, 3), p: peerName }) }))),
          v.views_48h == null ? h('p', { class: 'nv-pending', text: fill(L().pending48, { d: when(v.published_at + 48 * 3600e3) }) }) : null,
          ratio != null ? h('span', { class: 'nv-meter', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.min(100, ratio * 50) + '%' })) : null);
      })) : empty(L().mineEmpty));
    }

    function breakoutsCard(d) {
      var b = d.breakouts || [];
      var thr = (d.settings && d.settings.breakoutRatio) || BREAKOUT;
      return card('nv-bocard', L().breakouts, fill(L().breakoutsSub, { x: String(thr).replace('.', lang() === 'tr' ? ',' : '.') }), b.length ? h('ul', { class: 'nv-bo' }, b.slice(0, 6).map(function (v) {
        return h('li', null, thumb(v, 'small'),
          h('div', { class: 'nv-main' },
            h('a', { class: 'nv-title', href: v.url, target: '_blank', rel: 'noopener noreferrer', text: v.title }),
            h('div', { class: 'nv-meta' }, h('span', { class: 'nv-chan', text: v.channel }), h('span', { text: ago(v.alert.created_at) }))),
          h('span', { class: 'nv-score is-hot' }, h('span', { class: 'stair', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('b', { text: times(v.alert.score) }), h('small', { text: cpLabel(v.alert.at) })));
      })) : empty(L().breakoutsEmpty));
    }

    function growthSpark(series) {
      var pts = series.filter(function (s) { return s.subs != null; });
      if (pts.length < 2) return h('span', { class: 'nv-gspark-none' });
      var W = 54;
      var Hh = 20;
      var lo = Math.min.apply(null, pts.map(function (p) { return p.subs; }));
      var hi = Math.max.apply(null, pts.map(function (p) { return p.subs; }));
      var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + (i / (pts.length - 1) * (W - 2) + 1).toFixed(1) + ' ' + (hi === lo ? Hh / 2 : Hh - 2 - (p.subs - lo) / (hi - lo) * (Hh - 4)).toFixed(1); }).join(' ');
      return svg('svg', { viewBox: '0 0 ' + W + ' ' + Hh, class: 'nv-gspark', 'aria-hidden': 'true' }, [svg('path', { d: d })]);
    }

    function growthCard(d) {
      var g = (d.growth || []).filter(function (x) { return x.series.length; });
      if (!g.length) return card('nv-growcard', L().growth, null, empty(L().growthEmpty));
      g.sort(function (a, b) { return (b.mine - a.mine) || ((b.delta_28d && b.delta_28d.subs) || 0) / Math.max(1, b.subs || 1) - ((a.delta_28d && a.delta_28d.subs) || 0) / Math.max(1, a.subs || 1); });
      return card('nv-growcard', L().growth, L().growthSub, h('table', { class: 'nv-grow' },
        h('colgroup', null, h('col', { class: 'c-name' }), h('col', { class: 'c-num' }), h('col', { class: 'c-num' }), h('col', { class: 'c-28' }), h('col', { class: 'c-spark' })),
        h('thead', null, h('tr', null, h('th', null), h('th', { class: 'num', text: L().subs }), h('th', { class: 'num', text: L().d7 }), h('th', { class: 'num', text: L().d28 }), h('th', null))),
        h('tbody', null, g.slice(0, 16).map(function (x) {
          var d28 = x.delta_28d && x.delta_28d.subs;
          return h('tr', { class: x.mine ? 'is-mine' : null },
            h('th', { class: 'nv-grow-name', text: x.name }),
            h('td', { class: 'num', text: num(x.subs) }),
            h('td', { class: 'num' + (x.delta_7d && x.delta_7d.subs > 0 ? ' is-up' : ''), text: signed(x.delta_7d && x.delta_7d.subs) }),
            h('td', { class: 'num', text: d28 == null ? '–' : signed(d28) + (x.subs ? ' (' + pct(d28 / Math.max(1, x.subs - d28)) + ')' : '') }),
            h('td', null, growthSpark(x.series)));
        }))));
    }

    function digestCard(d) {
      var dg = d.digest || d.digest_preview;
      if (!dg) return null;
      var saved = !!d.digest;
      var top = (dg.top || []).slice(0, 3);
      return card('nv-digcard', L().digest, L().digestSub, h('div', null,
        h('p', { class: 'nv-dig-week' }, h('b', { text: saved ? fill(L().digestWeek, { d: day(Date.parse(dg.week + 'T12:00:00Z')) }) : L().digestRunning }),
          ' · ' + fill(L().uploadsN, { n: dg.totals.uploads }) + (dg.totals.breakouts ? ' · ' + fill(L().breakoutsN, { n: dg.totals.breakouts }) : '')),
        top.length ? h('ol', { class: 'nv-dig' }, top.map(function (v) {
          return h('li', null, h('a', { href: v.url, target: '_blank', rel: 'noopener noreferrer', text: v.title }), h('span', { class: 'muted', text: ' · ' + v.channel + ' · ' }), v.score != null ? h('b', { text: times(v.score) }) : null);
        })) : h('p', { class: 'muted', text: L().digestNone }),
        dg.best_slot && dg.best_slot.day && dg.best_slot.block ? h('p', { class: 'nv-best small' }, fill(L().bestSlot, { d: L().days[dg.best_slot.day.key], b: L().blocks[dg.best_slot.block.key] })) : null,
        h('p', { class: 'nv-sub', text: L().digestAsk })));
    }

    function lagCard(d) {
      var r = d.rss_lag || {};
      var text = r.verdict === 'collecting' || !r.verdict ? fill(L().lagCollecting, { n: r.samples || 0 })
        : fill(r.verdict === 'rss-ok' ? L().lagOk : L().lagBad, { m: r.young_lag_min && r.young_lag_min.median != null ? r.young_lag_min.median : r.lag_min.median });
      return h('details', { class: 'nv-lag' },
        h('summary', null, h('span', { class: 'set-state ' + (r.verdict === 'rss-ok' ? 'is-ok' : r.verdict === 'rss-lags' ? 'is-off' : '') }, L().lag), h('span', { class: 'nv-lag-text', text: text })),
        h('p', { class: 'nv-sub', text: L().lagExplain }),
        r.samples ? h('p', { class: 'nv-sub', text: 'n = ' + r.samples + ' · p90 ' + (r.lag_min.p90 ?? '–') + ' min · gap ' + (r.gap_pct.median ?? '–') + ' %' }) : null);
    }

    function channelsCard(d) {
      var chans = d.channels || [];
      return card('nv-chancard', L().tracked, null, h('div', null,
        h('ul', { class: 'nv-chans' }, chans.map(function (c) {
          return h('li', { class: c.mine ? 'is-mine' : null },
            h('div', { class: 'nv-chan-name' }, h('b', { text: c.name }), c.mine ? h('span', { class: 'nv-tag', text: L().mineTag }) : null, c.subs != null ? h('span', { class: 'muted', text: num(c.subs) + ' ' + L().subs }) : null),
            h('div', { class: 'nv-chan-state' },
              h('span', { class: 'set-state ' + (c.error ? 'is-off' : c.rss_checked_at ? 'is-ok' : '') , text: c.rss_checked_at ? fill(L().rssAt, { t: ago(c.rss_checked_at) }) : L().rssNever }),
              h('span', { class: 'muted', text: c.backfilled_at ? L().backfilled : L().backfillPending })),
            c.error ? h('p', { class: 'm-warn small', text: c.error }) : null);
        })),
        (d.unresolved || []).length ? h('p', { class: 'nv-sub', text: fill(L().unresolved, { n: d.unresolved.length }) }) : null,
        lagCard(d),
        settingsRow(d)));
    }

    function settingsRow(d) {
      var s = d.settings || {};
      var sel = h('select', { 'aria-label': L().settings, onchange: function () { saveNiche({ breakoutRatio: Number(sel.value) }); } },
        [2, 2.5, 3, 4, 5].map(function (x) { return h('option', { value: String(x), selected: Number(s.breakoutRatio || BREAKOUT) === x, text: times(x) }); }));
      var fast = h('input', { type: 'checkbox', checked: s.fastStart !== false, onchange: function () { saveNiche({ fastStart: fast.checked }); } });
      return h('div', { class: 'nv-settings' },
        h('label', { class: 'nv-set' }, h('span', null, h('b', { text: L().settings }), h('small', { text: L().settingsHint })), sel),
        h('label', { class: 'm-check' }, fast, L().fastStart));
    }

    async function saveNiche(patch) {
      var r = await chrome.storage.local.get(SETTINGS_KEY);
      var s = Object.assign({}, r[SETTINGS_KEY]);
      s.niche = Object.assign({}, s.niche, patch);
      var o = {};
      o[SETTINGS_KEY] = s;
      await chrome.storage.local.set(o);
      if (ui.data) ui.data.settings = Object.assign({}, ui.data.settings, patch);
      env.rerender();
    }

    // ---- start tracking: the one-click helper -------------------------------------------------
    function savedChannels() {
      return env.youtubeAccounts().map(function (a) { return { id: a.id, name: a.name, handle: a.handle, videos: a.count }; });
    }
    function openStart(quiet) {
      var org = env.getOrg();
      var sug = TR.suggest(savedChannels(), org);
      ui.start = { sug: sug, picked: {}, folder: TR.STARTER_FOLDER, mine: true };
      sug.items.forEach(function (i) { if (i.picked) ui.start.picked[i.id] = true; });
      if (!quiet) env.rerender();
    }
    async function applyStart() {
      var st = ui.start;
      var org = env.getOrg();
      var picked = Object.keys(st.picked).filter(function (k) { return st.picked[k]; });
      var mineItem = st.sug.items.filter(function (i) { return i.mine; })[0];
      var mine = st.mine ? (mineItem ? mineItem.id : TR.MINE.id) : null;
      TR.applySuggestion(org, { folder: st.folder, picked: picked.filter(function (id) { return id !== mine; }), mine: mine, mineInfo: { name: TR.MINE.name } }, Date.now());
      ui.busy = true;
      env.rerender();
      await env.saveOrg(org);
      ui.start = null;
      ui.busy = false;
      ui.niche = undefined;
      setTimeout(refresh, 3500); // the org reaches the bridge with the next sync (~2.5 s)
      env.rerender();
    }
    function startCard() {
      var st = ui.start;
      var items = st.sug.items;
      if (!items.length && !st.sug.mine) return h('section', { class: 'm-card nv-start' }, h('h2', { text: L().startTitle }), empty(L().startNone));
      var n = Object.keys(st.picked).filter(function (k) { return st.picked[k]; }).length + (st.mine && st.sug.mine ? 1 : 0);
      var folder = h('input', { type: 'text', value: st.folder, 'aria-label': L().startFolder, oninput: function () { st.folder = folder.value; } });
      return h('section', { class: 'm-card nv-start' },
        h('h2', { text: L().startTitle }),
        h('p', { class: 'nv-sub', text: L().startText }),
        h('label', { class: 'm-field nv-start-folder' }, L().startFolder, folder),
        h('h3', { text: L().startPick }),
        h('ul', { class: 'nv-pick' },
          st.sug.mine ? h('li', { class: 'is-mine' }, h('label', { class: 'nv-pick-label' },
            h('input', { type: 'checkbox', checked: st.mine, onchange: function (e) { st.mine = e.target.checked; env.rerender(); } }),
            h('span', { class: 'nv-pick-text' }, h('b', { text: TR.MINE.name }), h('small', { class: 'muted', text: L().startMineMissing })),
            h('span', { class: 'nv-tag', text: L().mineTag }))) : null,
          items.map(function (i) {
            return h('li', { class: i.mine ? 'is-mine' : null }, h('label', { class: 'nv-pick-label' },
              h('input', { type: 'checkbox', checked: i.mine ? st.mine : !!st.picked[i.id], onchange: function (e) { if (i.mine) st.mine = e.target.checked; else st.picked[i.id] = e.target.checked; env.rerender(); } }),
              h('span', { class: 'nv-pick-text' }, h('b', { text: i.name || i.id }), i.handle ? h('small', { class: 'muted', text: '@' + i.handle }) : null),
              i.mine ? h('span', { class: 'nv-tag', text: L().mineTag }) : i.reason === 'excel' ? h('span', { class: 'nv-tag is-soft', text: L().excelTag }) : null));
          })),
        st.sug.missing.length ? h('p', { class: 'nv-sub', text: fill(L().missingNames, { list: st.sug.missing.join(', ') }) }) : null,
        h('div', { class: 'm-actions' },
          h('button', { class: 'btn btn-primary', type: 'button', disabled: !n || ui.busy, onclick: applyStart }, fill(L().startGo, { n: n })),
          ui.data && ui.data.channels && ui.data.channels.length ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: function () { ui.start = null; env.rerender(); } }, L().cancel) : null),
        h('p', { class: 'nv-sub', text: L().startOther }));
    }

    function statusBanner(d) {
      var st = d.status || {};
      var out = [];
      if (st.tracker === false) out.push(h('p', { class: 'ft-warn nv-banner' }, L().trackerOff, h('button', { class: 'ft-fix', type: 'button', onclick: function () { F.set('tracker', true).then(function () { setTimeout(refresh, 2000); }); } }, L().turnOn)));
      if (st.api_key === false) out.push(h('p', { class: 'ft-warn nv-banner' }, L().noKey, h('a', { class: 'ft-fix', href: '#/settings' }, L().addKey)));
      return out;
    }

    // ---- phase 5: the discovery tabs (dashboard/discovery-view.js) ------------------------------
    var DVM = root.OpenOutlierDiscoveryView;
    var dv = DVM ? DVM.create({ h: h, loadImage: env.loadImage, rerender: env.rerender, getOrg: env.getOrg, saveOrg: env.saveOrg, niche: function () { return ui.niche; } }) : null;
    var TABS = ['tracking', 'radar', 'map', 'keywords'];
    function tabOf() {
      var p = location.hash.replace(/^#\/?/, '').split('/');
      var t = p[1] || 'tracking';
      if (t === 'thumbs' && /^[A-Za-z0-9_-]{11}$/.test(p[2] || '')) return { tab: 'thumbs', arg: p[2] };
      return { tab: TABS.indexOf(t) !== -1 ? t : 'tracking', arg: null };
    }
    function tabStrip(cur) {
      if (!dv) return null;
      var names = dv.tabs();
      return h('nav', { class: 'dv-tabs', 'aria-label': L().title }, TABS.map(function (t) {
        return h('a', { class: 'dv-tab', href: t === 'tracking' ? '#/niche' : '#/niche/' + t, 'aria-current': cur === t ? 'page' : null }, names[t]);
      }));
    }
    function nicheSelect(names, current) {
      if (!names || names.length < 2) return null;
      var sel = h('select', { 'aria-label': L().niche, onchange: function () { ui.niche = sel.value; ui.data = null; if (dv) dv.invalidate(); env.rerender(); } },
        names.map(function (n) { return h('option', { value: n.name || '', selected: (n.name || null) === (current || null), text: (n.name || L().allNiches) + ' (' + n.channels + ')' }); }));
      return sel;
    }
    function renderDiscovery(main, t) {
      var cur = dv.currentNiche();
      main.appendChild(h('div', { class: 'view-head' },
        h('h1', { text: L().title }),
        h('span', { class: 'sub', text: cur !== undefined ? (cur || L().allNiches) : '' }),
        h('span', { class: 's-head-actions' }, nicheSelect(dv.niches(), cur))));
      main.appendChild(tabStrip(t.tab));
      dv.render(main, t.tab, t.arg);
    }

    // ---- render -------------------------------------------------------------------------------
    function render(main) {
      main.classList.remove('has-panel');
      main.textContent = '';
      var t = tabOf();
      if (dv && t.tab !== 'tracking') { renderDiscovery(main, t); return; }
      var d = ui.data;
      var names = d && d.niches || [];
      var sel = names.length > 1 ? h('select', { 'aria-label': L().niche, onchange: function () { ui.niche = sel.value; if (dv) dv.invalidate(); refresh(); } },
        names.map(function (n) { return h('option', { value: n.name || '', selected: (n.name || null) === (d.niche || null), text: (n.name || L().allNiches) + ' (' + n.channels + ')' }); })) : null;
      main.appendChild(h('div', { class: 'view-head' },
        h('h1', { text: L().title }),
        h('span', { class: 'sub', text: !d ? (ui.loading ? L().loading : '') : [(d.niche || (d.channels.length ? L().allNiches : null)), d.channels.length ? fill(L().channelsN, { n: d.channels.length }) : null, ui.at ? fill(L().updated, { t: ago(ui.at) }) : null].filter(Boolean).join(' · ') }),
        h('span', { class: 's-head-actions' }, sel,
          TR && d && d.channels.length ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: openStart }, L().channelsBtn) : null,
          h('button', { class: 'btn', type: 'button', disabled: ui.loading, onclick: refresh }, ui.loading ? L().loading : L().refresh))));
      if (!ui.error && dv) main.appendChild(tabStrip('tracking'));
      if (!d && !ui.error) { if (!ui.loading) setTimeout(refresh, 0); return; }
      if (ui.error) {
        main.appendChild(ui.noBridge
          ? h('section', { class: 'm-card s-narrow' }, h('h2', { text: L().title }), h('p', { class: 'muted', text: L().noBridge }), h('p', { class: 'muted small', text: L().install }), h('pre', { class: 'set-code', text: 'sh mcp/launchd/install.sh' }))
          : h('p', { class: 'm-error', role: 'status', text: ui.error }));
        return;
      }
      statusBanner(d).forEach(function (el) { main.appendChild(el); });
      if (!d.channels.length) {
        if (!ui.start && TR) { openStart(true); ui.start.auto = true; }
        main.appendChild(h('div', { class: 'nv-onboard' }, ui.start ? startCard() : null));
        return;
      }
      if (ui.start && ui.start.auto) ui.start = null; // opened because nothing was tracked: done now
      if (ui.start) main.appendChild(h('div', { class: 'nv-onboard' }, startCard()));
      main.appendChild(kpis(d));
      main.appendChild(h('div', { class: 'nv-grid' },
        h('div', { class: 'nv-col' }, weekCard(d), curvesCard(d), worksCard(d), h('div', { class: 'nv-two' }, gapsCard(d), changesCard(d)), sponsorsCard(d)),
        h('div', { class: 'nv-col nv-side' }, breakoutsCard(d), mineCard(d), digestCard(d), growthCard(d), channelsCard(d))));
    }

    function title() { return L().title; }
    function navLabel() { return L().nav; }
    function invalidate() { ui.data = null; }

    return { render: render, title: title, navLabel: navLabel, refresh: refresh, invalidate: invalidate };
  }

  root.OpenOutlierNicheView = { create: create };
})(typeof self !== 'undefined' ? self : this);
