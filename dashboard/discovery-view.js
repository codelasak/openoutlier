// OpenOutlier Library – phase 5 (keşif / discovery) tabs of the Niş Takibi page
// (docs/youtube-niche-plan.md 6.4–6.6), drawn by dashboard/niche-view.js under its tab strip:
//   #/niche/radar        the niche radar: keyword list per niche, thresholds, the cost per run before
//                        it is switched on, this week's small-channel breakouts and rising channels
//                        you don't track (one-click Track)
//   #/niche/map          the channel map as ranked lists: channels near the niche you don't track,
//                        and each tracked channel's closest neighbours
//   #/niche/keywords     keyword ideas (autocomplete + title words + topic gaps + your search terms),
//                        "ranks" for your own search terms, "Ask Claude for the volume" (vidIQ MCP)
//   #/niche/thumbs/<id>  similar thumbnails in the Library (perceptual hash), opened from the watch card
// Answers come from the bridge (mcp/discovery.mjs) through the service worker (reelscope:discovery).
// Settings the user edits here (keywords, thresholds, hl/gl, rank keywords) live in rs:settings.radar
// and reach the bridge with the other settings (src/agent-bridge.js).
(function (root) {
  'use strict';

  var F = root.OpenOutlierFeatures;
  var D = root.OpenOutlierDiscovery;
  var TR = root.OpenOutlierTracking;
  var SETTINGS_KEY = 'rs:settings';

  var S = {
    en: {
      tabs: { tracking: 'Tracking', radar: 'Radar', map: 'Channel map', keywords: 'Keywords' },
      loading: 'Loading…', retry: 'Try again', saved: 'Saved. The bridge picks it up within a few seconds.',
      // radar
      radarTitle: 'Niche radar', radarSub: 'Once a day, the bridge searches YouTube for each keyword (uploads of the last 7 days, most viewed first) and looks for small channels whose videos break out.',
      radarOff: 'The radar is off', radarOffText: 'It spends Data API units every day, so it starts off. Check the cost below, then turn it on.', turnOn: 'Turn the radar on', turnOff: 'Turn the radar off',
      noKey: 'The bridge has no Data API key, so the radar can\'t search.', addKey: 'Add the key in Settings',
      keywords: 'Keywords for {n}', keywordsNone: 'No keywords yet. Add a few searches people type, like "excel pivot table" or "xlookup".', add: 'Add', addPh: 'Add a keyword…', remove: 'Remove {k}',
      suggest: 'Suggestions', sugSearch: 'your search term', sugGap: 'topic gap', sugTitle: 'title word',
      cost: 'Cost per run', costLine: '{u} units a day for {n} keywords', costDetail: '{s} for search.list (100 each) + up to {v} for videos.list and channels.list',
      costShare: '{p} of the daily 10,000 · all niches: {a}', costBudget: 'It stops before the day\'s budget ({b} units, tracking included) and keeps {r} for niche tracking; leftover keywords wait for the next day.',
      thresholds: 'Thresholds', maxSubs: 'Channels up to', minRatio: 'Views per subscriber at least', minViews: 'Views at least', perKw: 'Results per keyword', market: 'Market',
      status: 'Runs', lastRun: 'Last run {t}: {k} keywords, {u} units, {v} videos', skipped: '{n} keywords waited for the budget', nextRun: 'Next run {t}', never: 'Not run yet.', runNow: 'Run now', runQueued: 'Queued: the bridge runs it within a minute.',
      breakouts: 'Breaking out on small channels this week', breakoutsSub: 'Uploads of the last 7 days from channels with at most {s} subscribers and at least {r} views per subscriber, best ratio first.',
      breakoutsEmpty: 'Nothing matched this week. Lower the thresholds or add keywords; results refresh with each daily run.', radarEmpty: 'No results yet: the first run fills this in.',
      perSub: '{x} views/sub', subsN: '{n} subs', viewsN: '{n} views', vph: '{n}/h', foundBy: 'via',
      rising: 'Rising channels you don\'t track', risingSub: 'Channels behind those breakouts that aren\'t in your niche yet. Track adds one to {n}.', risingEmpty: 'No untracked channel stood out this week.',
      track: 'Track', tracking: 'Tracking', videosN: '{n} videos', video1: '1 video', best: 'best {x}',
      // map
      mapTitle: 'Channel map', mapSub: 'Who sits next to your niche: channels YouTube recommends alongside its channels ("Up Next" lists of the videos you watch, fading over ~30 days) and channels whose titles and tags read alike.',
      outside: 'Close to the niche, not tracked', outsideSub: 'Ranked by how many of the niche\'s channels they are near, then by how near.', outsideEmpty: 'Nothing yet. Watch a few videos of the niche on YouTube: every "Up Next" list adds to this map.',
      nearN: 'near {n}', withList: 'next to {list}', whyCo: 'Up Next ×{n}', whyText: 'similar titles', whyBoth: 'Up Next ×{n} · titles', terms: 'shared words',
      neighbours: 'Each channel\'s closest', neighboursSub: 'The three channels most like each tracked channel, in or out of the niche.', none: '–',
      basis: '{p} recommendation pairs · text of {t} channels', mapOff: 'Similar channels is switched off.',
      // keywords
      kwTitle: 'Keyword ideas', kwSub: 'YouTube\'s autocomplete for the niche\'s seeds, merged with its fast title words, topic gaps and the searches that already bring you viewers.',
      seed: 'Start from', seedPh: 'a seed, e.g. excel pivot', go: 'Search', lang: 'Language', country: 'Country', expand: 'More: {s} a–z', expanding: 'Widening "{s}"…',
      fAll: 'All', fRanks: 'You rank', fIdeas: 'New ideas', ranks: 'you rank', ranksTip: '{v} views from this search in the last 4 weeks (YouTube Analytics)',
      src: { autocomplete: 'autocomplete', title: 'title word', gap: 'topic gap', search: 'your search' }, lift: 'title words with it: {x} the niche median',
      toRadar: '+ Radar', onRadar: 'on radar', toRank: 'Track rank', ranked: 'rank #{r}', notRanked: 'not in top 40', rankTracked: 'rank tracked',
      kwEmpty: 'No ideas yet. Add a seed above, or track the niche so its title words and gaps can feed this list.', kwOff: 'Keyword ideas are off: only the Library\'s own signals are listed.',
      kwFetched: '{f} fetched · {c} from cache (7 days) · hl={hl} gl={gl}', kwOwn: 'Your search terms: {n}', kwOwnNone: 'Connect your channel (My YouTube channel) to mark the terms you already rank for.',
      claude: 'Ask Claude for the volume', claudeSub: 'Search volume needs the vidIQ connector in Claude: its free plan has about 30 calls a month, so this prompt asks for at most 10 keywords and tells Claude to batch them and stop at the limit.',
      copy: 'Copy prompt', copied: 'Copied', claudeNone: 'Every idea here is already a term you rank for.',
      rankNote: 'Rank tracking uses DataForSEO (optional, paid, scraping-based): {n} keywords, about ${c} a day.', rankOff: 'Turn on DataForSEO in Settings to track ranks.',
      // thumbs
      thumbsTitle: 'Similar thumbnails', thumbsSub: 'Library videos whose thumbnails look like this one: a 64-bit perceptual hash, compared bit by bit (0 = the same image).',
      dist: '{d} bits apart', same: 'same image', vclose: 'very close', close: 'close', sameChannel: 'same channel', thumbsEmpty: 'No thumbnail in the Library is this close yet.',
      thumbsIdx: '{i} thumbnails indexed · {p} waiting (about 40 every 20 minutes)', thumbsNoHash: 'This thumbnail couldn\'t be hashed (it needs ffmpeg or macOS sips on the bridge\'s Mac).',
      back: '← Niche tracking', open: 'Open on YouTube',
      noBridge: 'Discovery runs in the OpenOutlier bridge on your Mac, and it isn\'t running.', oldBridge: 'The bridge is older than this extension. Restart it: launchctl kickstart -k gui/$(id -u)/dev.openoutlier.bridge'
    },
    tr: {
      tabs: { tracking: 'Takip', radar: 'Radar', map: 'Kanal haritası', keywords: 'Anahtar kelimeler' },
      loading: 'Yükleniyor…', retry: 'Tekrar dene', saved: 'Kaydedildi. Bridge birkaç saniye içinde alır.',
      radarTitle: 'Niş radarı', radarSub: 'Bridge günde bir kez her anahtar kelimeyi YouTube\'da arar (son 7 günün yüklemeleri, en çok izlenen başta) ve videoları patlayan küçük kanalları bulur.',
      radarOff: 'Radar kapalı', radarOffText: 'Her gün Data API birimi harcadığı için kapalı başlar. Aşağıdaki maliyete bak, sonra aç.', turnOn: 'Radarı aç', turnOff: 'Radarı kapat',
      noKey: 'Bridge\'de Data API anahtarı yok, radar arama yapamaz.', addKey: 'Anahtarı Ayarlar\'dan ekle',
      keywords: '{n} için anahtar kelimeler', keywordsNone: 'Henüz kelime yok. İnsanların yazdığı birkaç arama ekle: "excel pivot table", "xlookup" gibi.', add: 'Ekle', addPh: 'Anahtar kelime ekle…', remove: '{k} kaldır',
      suggest: 'Öneriler', sugSearch: 'arama terimin', sugGap: 'konu boşluğu', sugTitle: 'başlık kelimesi',
      cost: 'Çalışma başına maliyet', costLine: '{n} kelime için günde {u} birim', costDetail: 'search.list için {s} (her biri 100) + videos.list ve channels.list için en çok {v}',
      costShare: 'günlük 10.000\'in {p}\'i · tüm nişler: {a}', costBudget: 'Günün bütçesine ({b} birim, takip dahil) gelmeden durur ve niş takibi için {r} bırakır; kalan kelimeler ertesi günü bekler.',
      thresholds: 'Eşikler', maxSubs: 'En çok abone', minRatio: 'Abone başına en az izlenme', minViews: 'En az izlenme', perKw: 'Kelime başına sonuç', market: 'Pazar',
      status: 'Çalışmalar', lastRun: 'Son çalışma {t}: {k} kelime, {u} birim, {v} video', skipped: '{n} kelime bütçe yüzünden bekledi', nextRun: 'Sonraki çalışma {t}', never: 'Henüz çalışmadı.', runNow: 'Şimdi çalıştır', runQueued: 'Sıraya alındı: bridge bir dakika içinde çalıştırır.',
      breakouts: 'Bu hafta küçük kanallarda patlayanlar', breakoutsSub: 'En çok {s} aboneli kanalların son 7 gündeki yüklemeleri, abone başına en az {r} izlenmeyle; en yüksek oran başta.',
      breakoutsEmpty: 'Bu hafta eşleşen yok. Eşikleri düşür ya da kelime ekle; sonuçlar her günlük çalışmada yenilenir.', radarEmpty: 'Henüz sonuç yok: ilk çalışma burayı doldurur.',
      perSub: 'abone başına {x}', subsN: '{n} abone', viewsN: '{n} izlenme', vph: '{n}/sa', foundBy: 'kelime',
      rising: 'Takip etmediğin yükselen kanallar', risingSub: 'Bu patlamaların arkasındaki, henüz nişinde olmayan kanallar. Takip et, kanalı {n} nişine ekler.', risingEmpty: 'Bu hafta öne çıkan takip dışı kanal yok.',
      track: 'Takip et', tracking: 'Takipte', videosN: '{n} video', video1: '1 video', best: 'en iyi {x}',
      mapTitle: 'Kanal haritası', mapSub: 'Nişinin yanında kimler var: YouTube\'un nişin kanallarıyla birlikte önerdiği kanallar (izlediğin videoların "Sıradaki" listeleri, ~30 günde solar) ve başlık ve etiketleri benzeyen kanallar.',
      outside: 'Nişe yakın, takip edilmeyen', outsideSub: 'Nişin kaç kanalına yakın olduklarına, sonra ne kadar yakın olduklarına göre.', outsideEmpty: 'Henüz yok. YouTube\'da nişin birkaç videosunu izle: her "Sıradaki" listesi bu haritaya ekler.',
      nearN: '{n} kanala yakın', withList: '{list} ile', whyCo: 'Sıradaki ×{n}', whyText: 'benzer başlıklar', whyBoth: 'Sıradaki ×{n} · başlıklar', terms: 'ortak kelimeler',
      neighbours: 'Her kanalın en yakınları', neighboursSub: 'Takip edilen her kanala en çok benzeyen üç kanal, nişin içinden ya da dışından.', none: '–',
      basis: '{p} öneri eşleşmesi · {t} kanalın metni', mapOff: 'Benzer kanallar kapalı.',
      kwTitle: 'Anahtar kelime fikirleri', kwSub: 'Nişin tohum kelimeleri için YouTube\'un otomatik tamamlaması; nişin hızlı başlık kelimeleri, konu boşlukları ve sana zaten izleyici getiren aramalarla birleşik.',
      seed: 'Başlangıç', seedPh: 'bir tohum, örn. excel pivot', go: 'Ara', lang: 'Dil', country: 'Ülke', expand: 'Daha fazla: {s} a–z', expanding: '"{s}" genişletiliyor…',
      fAll: 'Hepsi', fRanks: 'Sıralandıkların', fIdeas: 'Yeni fikirler', ranks: 'sıralanıyorsun', ranksTip: 'Son 4 haftada bu aramadan {v} izlenme (YouTube Analytics)',
      src: { autocomplete: 'otomatik tamamlama', title: 'başlık kelimesi', gap: 'konu boşluğu', search: 'arama terimin' }, lift: 'bu kelimeli başlıklar: nişin medyanının {x}',
      toRadar: '+ Radar', onRadar: 'radarda', toRank: 'Sırayı takip et', ranked: '#{r}. sıra', notRanked: 'ilk 40\'ta yok', rankTracked: 'sıra takipte',
      kwEmpty: 'Henüz fikir yok. Yukarıya bir tohum ekle ya da nişi takip et ki başlık kelimeleri ve boşluklar bu listeyi beslesin.', kwOff: 'Anahtar kelime fikirleri kapalı: sadece Library\'nin kendi sinyalleri listeleniyor.',
      kwFetched: '{f} yeni · {c} önbellekten (7 gün) · hl={hl} gl={gl}', kwOwn: 'Arama terimlerin: {n}', kwOwnNone: 'Zaten sıralandığın terimleri işaretlemek için kanalını bağla (Kanalım).',
      claude: 'Claude ile hacim sor', claudeSub: 'Arama hacmi için Claude\'daki vidIQ bağlayıcısı gerekiyor: ücretsiz planı ayda ~30 çağrı veriyor; bu istem en çok 10 kelime sorar, Claude\'a kelimeleri tek çağrıda toplamasını ve limitte durmasını söyler.',
      copy: 'İstemi kopyala', copied: 'Kopyalandı', claudeNone: 'Buradaki her fikir zaten sıralandığın bir terim.',
      rankNote: 'Sıra takibi DataForSEO kullanır (isteğe bağlı, ücretli, scraping tabanlı): {n} kelime, günde yaklaşık ${c}.', rankOff: 'Sıra takibi için Ayarlar\'dan DataForSEO\'yu aç.',
      thumbsTitle: 'Benzer thumbnail\'ler', thumbsSub: 'Thumbnail\'i buna benzeyen Library videoları: 64 bitlik perceptual hash, bit bit karşılaştırılır (0 = aynı görsel).',
      dist: '{d} bit fark', same: 'aynı görsel', vclose: 'çok yakın', close: 'yakın', sameChannel: 'aynı kanal', thumbsEmpty: 'Library\'de henüz bu kadar yakın bir thumbnail yok.',
      thumbsIdx: '{i} thumbnail dizinde · {p} bekliyor (20 dakikada ~40)', thumbsNoHash: 'Bu thumbnail\'in hash\'i alınamadı (bridge\'in Mac\'inde ffmpeg ya da macOS sips gerekir).',
      back: '← Niş Takibi', open: 'YouTube\'da aç',
      noBridge: 'Keşif araçları Mac\'teki OpenOutlier bridge\'inde çalışır ve bridge çalışmıyor.', oldBridge: 'Bridge bu eklentiden eski. Yeniden başlat: launchctl kickstart -k gui/$(id -u)/dev.openoutlier.bridge'
    }
  };
  var MARKETS = [['US', 'en', 'US · English'], ['GB', 'en', 'UK · English'], ['TR', 'tr', 'Türkiye · Türkçe'], ['DE', 'de', 'Deutschland · Deutsch'], ['IN', 'en', 'India · English'], ['CA', 'en', 'Canada · English'], ['AU', 'en', 'Australia · English']];

  function create(env) {
    var h = env.h;
    var st = { tab: null, key: '', data: null, loading: false, error: '', noBridge: false, msg: '', filter: 'all', seed: '', expand: null, copied: false, kwInput: '', queued: false };

    function lang() { return F && F.uiLang ? F.uiLang() : 'en'; }
    function L() { return S[lang()] || S.en; }
    function fill(s, o) { return String(s).replace(/\{(\w+)\}/g, function (_, k) { return o[k] != null ? o[k] : ''; }); }
    function loc() { return lang() === 'tr' ? 'tr-TR' : 'en-US'; }
    function num(n) { return n == null ? '–' : new Intl.NumberFormat(loc(), { notation: 'compact', maximumFractionDigits: n < 1000 ? 0 : 1 }).format(n); }
    function full(n) { return n == null ? '–' : new Intl.NumberFormat(loc()).format(Math.round(n)); }
    function times(x) { return x == null ? '–' : new Intl.NumberFormat(loc(), { maximumFractionDigits: x < 10 ? 1 : 0 }).format(x) + '×'; }
    function pct(x) { return new Intl.NumberFormat(loc(), { style: 'percent', maximumFractionDigits: x < 0.1 ? 1 : 0 }).format(x); }
    function ago(t) {
      if (!t) return '–';
      var s = (t - Date.now()) / 1000;
      var rtf = new Intl.RelativeTimeFormat(loc(), { numeric: 'auto' });
      var units = [['day', 86400], ['hour', 3600], ['minute', 60]];
      for (var i = 0; i < units.length; i++) if (Math.abs(s) >= units[i][1]) return rtf.format(Math.round(s / units[i][1]), units[i][0]);
      return rtf.format(0, 'minute');
    }
    function nicheLabel(n) { return n || (lang() === 'tr' ? 'Adsız niş' : 'Untitled niche'); }

    function call(what, extra) {
      return chrome.runtime.sendMessage(Object.assign({ type: 'reelscope:discovery', what: what }, extra || {}))
        .then(function (r) { return r || { ok: false, error: 'No answer from the service worker.' }; }, function (e) { return { ok: false, error: e.message }; });
    }

    // ---- data -----------------------------------------------------------------------------------
    function want(tab, arg) {
      var niche = env.niche();
      var k = tab + '|' + (arg || '') + '|' + (niche === undefined ? '*' : niche) + '|' + (tab === 'keywords' ? [st.seed, st.expand, lang()].join('|') : '');
      if (st.key === k && (st.data || st.loading || st.error)) return;
      st.key = k;
      load(tab, arg);
    }
    async function load(tab, arg, quiet) {
      var k = st.key;
      if (!quiet) { st.loading = true; st.error = ''; st.data = null; env.rerender(); }
      var niche = env.niche();
      var extra = niche !== undefined ? { niche: niche || '' } : {};
      var r;
      if (tab === 'radar') r = await call('radar', extra);
      else if (tab === 'map') r = await call('map', extra);
      else if (tab === 'keywords') {
        var s = radarSettings();
        r = await call('keywords', Object.assign(extra, { seed: st.seed || undefined, expand: st.expand || undefined, hl: s.lang, gl: s.region, lang: lang() }));
      } else if (tab === 'thumbs') r = await call('thumbs', { id: arg });
      if (k !== st.key) return; // the user moved on
      st.loading = false;
      if (!r || r.ok === false) { st.error = r && r.error || 'Failed.'; st.noBridge = !!(r && r.noBridge); st.oldBridge = !!(r && r.oldBridge); st.data = null; }
      else { st.data = r; st.error = ''; }
      env.rerender();
    }
    function reload(delay) { var k = st.key; setTimeout(function () { if (st.key === k) load(st.tab, st.arg, true); }, delay || 0); }

    // ---- rs:settings.radar --------------------------------------------------------------------------
    var settings = {};
    function radarSettings() { return D.sanitizeRadar(settings.radar); }
    chrome.storage.local.get(SETTINGS_KEY).then(function (r) { settings = r[SETTINGS_KEY] || {}; });
    chrome.storage.onChanged.addListener(function (c, area) { if (area === 'local' && c[SETTINGS_KEY]) settings = c[SETTINGS_KEY].newValue || {}; });
    async function saveRadar(fn) {
      var r = await chrome.storage.local.get(SETTINGS_KEY);
      var s = Object.assign({}, r[SETTINGS_KEY]);
      var rd = D.sanitizeRadar(s.radar);
      fn(rd);
      s.radar = D.sanitizeRadar(rd);
      settings = s;
      var o = {};
      o[SETTINGS_KEY] = s;
      await chrome.storage.local.set(o);
      st.msg = L().saved;
      env.rerender();
      reload(2500); // the settings reach the bridge ~1.5 s after a change
    }
    function nicheKey() { return st.data && st.data.niche != null ? st.data.niche : ''; }
    function setKeywords(list) { var n = nicheKey(); return saveRadar(function (rd) { rd.keywords[n] = list; }); }

    // ---- shared bits ---------------------------------------------------------------------------------
    function card(cls, title, sub, body, extra) {
      return h('section', { class: 'm-card nv-card ' + (cls || '') },
        h('div', { class: 'nv-card-head' }, h('h2', { text: title }), extra || null),
        sub ? h('p', { class: 'nv-sub', text: sub }) : null,
        body);
    }
    function empty(text) { return h('p', { class: 'nv-empty' }, h('span', { class: 'nv-empty-px', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('span', { text: text })); }
    function thumb(v, cls) {
      var url = v.url || 'https://www.youtube.com/watch?v=' + (v.video_id || v.id);
      var wrap = h('a', { class: 'nv-thumb ' + (cls || '') + (v.type === 'short' ? ' is-short' : ''), href: url, target: '_blank', rel: 'noopener noreferrer', tabindex: '-1', 'aria-hidden': 'true' });
      var im = h('img', { alt: '', loading: 'lazy', decoding: 'async' });
      im.addEventListener('error', function () { im.remove(); wrap.classList.add('is-blank'); });
      var src = v.thumb || 'https://i.ytimg.com/vi/' + (v.video_id || v.id) + '/mqdefault.jpg';
      if (env.loadImage) env.loadImage(im, src); else im.src = src;
      wrap.appendChild(im);
      if (v.type === 'short') wrap.appendChild(h('span', { class: 'nv-dur', text: 'Shorts' }));
      return wrap;
    }
    function avatar(c) {
      var a = h('span', { class: 'dv-av', 'aria-hidden': 'true' }, h('b', { text: String(c.name || c.channel || '?').replace(/^@/, '').slice(0, 1).toUpperCase() }));
      if (c.thumb) { var im = h('img', { alt: '', loading: 'lazy' }); im.addEventListener('error', function () { im.remove(); }); if (env.loadImage) env.loadImage(im, c.thumb); else im.src = c.thumb; a.appendChild(im); }
      return a;
    }
    function chanUrl(c) { return c.url || 'https://www.youtube.com/' + (c.handle ? '@' + c.handle : 'channel/' + (c.channel_id || c.id)); }
    function accountId(c) { return c.handle ? 'yt/' + String(c.handle).replace(/^@/, '').toLowerCase() : 'yt/' + (c.channel_id || c.id); }
    function isTracked(c) {
      if (c.tracked) return true;
      if (!TR) return false;
      return TR.status(env.getOrg(), accountId(c)).on;
    }
    function trackBtn(c) {
      if (!TR) return null;
      var on = isTracked(c);
      return h('button', { class: 'btn dv-track' + (on ? ' is-on' : ''), type: 'button', disabled: on, 'aria-pressed': on ? 'true' : 'false', onclick: async function () {
        var org = env.getOrg();
        TR.trackInNiche(org, accountId(c), { channelId: c.channel_id || c.id, name: c.channel || c.name }, nicheKey() || null, Date.now());
        await env.saveOrg(org);
        c.tracked = true;
        env.rerender();
      } }, h('span', { class: 'track-dot', 'aria-hidden': 'true' }), on ? L().tracking : L().track);
    }
    function whyText(x) { return x.why === 'both' ? fill(L().whyBoth, { n: full(x.seen || 0) }) : x.why === 'corec' ? fill(L().whyCo, { n: full(x.seen || 0) }) : L().whyText; }
    function errorBox() {
      if (st.noBridge) return h('section', { class: 'm-card s-narrow' }, h('p', { class: 'muted', text: L().noBridge }), h('pre', { class: 'set-code', text: 'sh mcp/launchd/install.sh' }));
      if (st.oldBridge) return h('p', { class: 'ft-warn nv-banner', text: L().oldBridge });
      return h('p', { class: 'm-error', role: 'status' }, st.error + ' ', h('button', { class: 'btn btn-ghost', type: 'button', onclick: function () { load(st.tab, st.arg); } }, L().retry));
    }

    // ---- radar -----------------------------------------------------------------------------------------
    function radarTab(d) {
      var T = L();
      var s = radarSettings();
      var kws = (s.keywords[nicheKey()] || d.keywords || []).slice();
      var cost = D.radarCost(kws.length, { perKeyword: s.perKeyword });
      var allN = Object.keys(s.keywords).reduce(function (n, k) { return n + (k === nicheKey() ? kws.length : s.keywords[k].length); }, 0);
      var costAll = D.radarCost(allN, { perKeyword: s.perKeyword });
      var out = [];
      if (!d.feature) {
        out.push(h('div', { class: 'dv-off' },
          h('div', null, h('b', { text: T.radarOff }), h('p', { text: T.radarOffText })),
          h('button', { class: 'btn btn-primary', type: 'button', disabled: !kws.length, onclick: function () { F.set('niche-radar', true).then(function () { reload(2000); }); } }, T.turnOn)));
      } else if (!d.api_key) {
        out.push(h('p', { class: 'ft-warn nv-banner' }, T.noKey, h('a', { class: 'ft-fix', href: '#/settings' }, T.addKey)));
      }
      // keyword editor + cost
      var input = h('input', { type: 'text', class: 'dv-input', placeholder: T.addPh, 'aria-label': T.addPh, value: st.kwInput, maxlength: '80',
        oninput: function () { st.kwInput = input.value; },
        onkeydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); addKw(); } } });
      function addKw(k) {
        var v = String(k || st.kwInput || '').toLowerCase().replace(/\s+/g, ' ').trim();
        if (!v || kws.indexOf(v) !== -1) return;
        st.kwInput = '';
        setKeywords(kws.concat(v));
      }
      var chips = kws.length ? h('ul', { class: 'dv-chips', 'aria-label': fill(T.keywords, { n: nicheLabel(d.niche) }) }, kws.map(function (k) {
        return h('li', { class: 'dv-chip' }, h('span', { text: k }), h('button', { type: 'button', class: 'dv-x', 'aria-label': fill(T.remove, { k: k }), title: fill(T.remove, { k: k }),
          onclick: function () { setKeywords(kws.filter(function (x) { return x !== k; })); } }, '×'));
      })) : h('p', { class: 'nv-sub', text: T.keywordsNone });
      var sugs = (d.suggestions || []).filter(function (x) { return kws.indexOf(x.keyword) === -1; });
      var sugEl = sugs.length ? h('div', { class: 'dv-sug' }, h('h3', { text: T.suggest }), h('div', { class: 'dv-chips' }, sugs.map(function (x) {
        return h('button', { type: 'button', class: 'dv-chip is-sug', onclick: function () { addKw(x.keyword); }, title: x.from === 'search' ? T.sugSearch : x.from === 'gap' ? T.sugGap : T.sugTitle },
          h('span', { text: '+ ' + x.keyword }), h('small', { text: x.from === 'search' ? T.sugSearch : x.from === 'gap' ? T.sugGap : T.sugTitle }));
      }))) : null;
      var costEl = h('div', { class: 'dv-cost' + (d.feature ? '' : ' is-preview') },
        h('span', { class: 'kpi-label', text: T.cost }),
        h('b', { text: fill(T.costLine, { u: full(cost.total), n: kws.length }) }),
        h('small', { text: fill(T.costDetail, { s: full(cost.search), v: full(cost.videos + cost.channels) }) }),
        h('div', { class: 'dv-meter', role: 'img', 'aria-label': pct(costAll.total / 10000) },
          h('span', { class: 'dv-meter-used', style: 'width:' + Math.min(100, (d.quota.used_today || 0) / 100) + '%' }),
          h('span', { class: 'dv-meter-radar', style: 'width:' + Math.min(100, costAll.total / 100) + '%' })),
        h('small', { text: fill(T.costShare, { p: pct(cost.total / 10000), a: full(costAll.total) }) }),
        h('small', { class: 'muted', text: fill(T.costBudget, { b: full(d.quota.budget), r: full(d.quota.reserve) }) }));
      var add = h('div', { class: 'dv-add' }, input, h('button', { class: 'btn', type: 'button', onclick: function () { addKw(); } }, T.add));
      out.push(h('div', { class: 'dv-radar-top' },
        card('dv-kwcard', fill(T.keywords, { n: nicheLabel(d.niche) }), T.radarSub, h('div', null, chips, add, sugEl)),
        h('div', { class: 'dv-side' }, h('section', { class: 'm-card nv-card' }, costEl), thresholdsCard(s), runsCard(d))));
      // results
      var bo = d.breakouts || [];
      out.push(card('dv-bocard', T.breakouts, fill(T.breakoutsSub, { s: num(s.maxSubs), r: times(s.minRatio) }),
        bo.length ? h('ol', { class: 'nv-week dv-bo' }, bo.map(function (v, i) {
          return h('li', { class: 'nv-row dv-row' },
            h('span', { class: 'nv-rank', text: String(i + 1) }),
            thumb(v),
            h('div', { class: 'nv-main' },
              h('a', { class: 'nv-title', href: v.url, target: '_blank', rel: 'noopener noreferrer', text: v.title || v.video_id }),
              h('div', { class: 'nv-meta' },
                h('a', { class: 'nv-chan', href: chanUrl(v), target: '_blank', rel: 'noopener noreferrer', text: v.channel || v.channel_id }),
                h('span', { text: fill(T.subsN, { n: num(v.subs) }) }), h('span', { text: ago(v.published_at) }),
                v.tracked ? h('span', { class: 'nv-tag is-soft', text: T.tracking }) : null),
              h('div', { class: 'dv-kws' }, h('small', { class: 'muted', text: T.foundBy }), (v.keywords || []).slice(0, 3).map(function (k) { return h('span', { class: 'dv-kw', text: k }); }))),
            h('div', { class: 'nv-nums' },
              h('span', { class: 'nv-score' + (v.views_per_sub >= 2 ? ' is-out' : '') + (v.views_per_sub >= 10 ? ' is-hot' : '') }, h('b', { text: times(v.views_per_sub) }), h('small', { text: lang() === 'tr' ? 'abone b.' : 'per sub' })),
              h('span', { class: 'nv-views', text: fill(T.viewsN, { n: num(v.views) }) }),
              v.vph != null ? h('span', { class: 'nv-vph', text: fill(T.vph, { n: num(v.vph) }) }) : null));
        })) : empty(d.results ? T.breakoutsEmpty : T.radarEmpty)));
      var ri = d.rising || [];
      out.push(card('dv-risecard', T.rising, fill(T.risingSub, { n: nicheLabel(d.niche) }),
        ri.length ? h('ul', { class: 'dv-chlist' }, ri.map(function (c) {
          return h('li', { class: 'dv-ch' },
            avatar(c),
            h('div', { class: 'dv-ch-main' },
              h('a', { class: 'dv-ch-name', href: chanUrl(c), target: '_blank', rel: 'noopener noreferrer', text: c.channel || c.channel_id }),
              h('div', { class: 'nv-meta' }, h('span', { text: fill(T.subsN, { n: num(c.subs) }) }), h('span', { text: c.videos.length === 1 ? T.video1 : fill(T.videosN, { n: c.videos.length }) }), h('span', { text: fill(T.viewsN, { n: num(c.views) }) }),
                h('span', { class: 'dv-kws' }, c.keywords.slice(0, 3).map(function (k) { return h('span', { class: 'dv-kw', text: k }); }))),
              h('a', { class: 'dv-ch-video', href: 'https://www.youtube.com/watch?v=' + c.videos[0].video_id, target: '_blank', rel: 'noopener noreferrer', text: c.videos[0].title })),
            h('span', { class: 'nv-score is-out' }, h('b', { text: times(c.best_ratio) }), h('small', { text: lang() === 'tr' ? 'en iyi' : 'best' })),
            trackBtn(c));
        })) : empty(d.results ? T.risingEmpty : T.radarEmpty)));
      return out;
    }
    function thresholdsCard(s) {
      var T = L();
      function sel(label, key, opts, fmt) {
        var el = h('select', { 'aria-label': label, onchange: function () { var v = Number(el.value); saveRadar(function (rd) { rd[key] = v; }); } },
          opts.map(function (x) { return h('option', { value: String(x), selected: Number(s[key]) === x, text: fmt(x) }); }));
        return h('label', { class: 'dv-field' }, h('span', { text: label }), el);
      }
      var cur = s.region + '|' + s.lang;
      var mk = h('select', { 'aria-label': T.market, onchange: function () { var p = mk.value.split('|'); saveRadar(function (rd) { rd.region = p[0]; rd.lang = p[1]; }); } },
        MARKETS.map(function (m) { return h('option', { value: m[0] + '|' + m[1], selected: cur === m[0] + '|' + m[1], text: m[2] }); }));
      return h('section', { class: 'm-card nv-card dv-thr' }, h('h3', { text: T.thresholds }),
        h('div', { class: 'dv-fields' },
          sel(T.maxSubs, 'maxSubs', [10000, 50000, 100000, 250000, 1000000], num),
          sel(T.minRatio, 'minRatio', [0.5, 1, 2, 3, 5, 10], times),
          sel(T.minViews, 'minViews', [0, 1000, 5000, 10000, 50000], num),
          sel(T.perKw, 'perKeyword', [10, 25, 50], String),
          h('label', { class: 'dv-field' }, h('span', { text: T.market }), mk)),
        st.msg ? h('p', { class: 'm-msg small', role: 'status', text: st.msg }) : null);
    }
    function runsCard(d) {
      var T = L();
      var last = (d.runs || [])[0];
      return h('section', { class: 'm-card nv-card dv-runs' },
        h('div', { class: 'nv-card-head' }, h('h3', { text: T.status }),
          d.feature ? h('button', { class: 'btn btn-ghost dv-small', type: 'button', disabled: st.queued, onclick: async function () {
            var r = await call('radar-run');
            st.queued = !!(r && r.ok);
            env.rerender();
            setTimeout(function () { st.queued = false; load('radar', null, true); }, 60000);
          } }, T.runNow) : null),
        last ? h('p', { class: 'small', text: fill(T.lastRun, { t: ago(last.at), k: last.keywords.length, u: full(last.units), v: full(last.videos) }) }) : h('p', { class: 'small muted', text: T.never }),
        last && last.skipped && last.skipped.length ? h('p', { class: 'small ft-warn-text', text: fill(T.skipped, { n: last.skipped.length }) }) : null,
        last && last.error ? h('p', { class: 'small m-warn', text: last.error }) : null,
        st.queued ? h('p', { class: 'small m-msg', role: 'status', text: T.runQueued }) : d.feature && d.next_run_at ? h('p', { class: 'small muted', text: fill(T.nextRun, { t: ago(d.next_run_at) }) }) : null,
        d.feature ? h('button', { class: 'btn btn-ghost dv-small dv-offbtn', type: 'button', onclick: function () { F.set('niche-radar', false).then(function () { reload(1500); }); } }, T.turnOff) : null);
    }

    // ---- channel map -------------------------------------------------------------------------------------
    function mapTab(d) {
      var T = L();
      var out = [];
      if (!d.feature) out.push(h('p', { class: 'ft-warn nv-banner' }, T.mapOff, h('button', { class: 'ft-fix', type: 'button', onclick: function () { F.set('channel-similar', true).then(function () { reload(1500); }); } }, lang() === 'tr' ? 'Aç' : 'Turn on')));
      var o = d.outside || [];
      out.push(h('div', { class: 'nv-grid dv-map' },
        h('div', { class: 'nv-col' }, card('dv-outcard', T.outside, T.outsideSub, o.length ? h('ol', { class: 'dv-chlist is-ranked' }, o.map(function (c, i) {
          return h('li', { class: 'dv-ch' },
            h('span', { class: 'nv-rank', text: String(i + 1) }),
            avatar(c),
            h('div', { class: 'dv-ch-main' },
              h('a', { class: 'dv-ch-name', href: chanUrl(c), target: '_blank', rel: 'noopener noreferrer', text: c.name }),
              h('div', { class: 'nv-meta' }, c.subs != null ? h('span', { text: fill(T.subsN, { n: num(c.subs) }) }) : null, h('span', { class: 'dv-why is-' + c.why, text: whyText(c) }),
                h('span', { text: fill(T.nearN, { n: c.link_count }) })),
              h('p', { class: 'dv-links', text: fill(T.withList, { list: c.links.slice(0, 3).join(', ') + (c.links.length > 3 ? ' +' + (c.links.length - 3) : '') }) }),
              c.terms && c.terms.length ? h('div', { class: 'dv-kws', title: T.terms }, c.terms.slice(0, 4).map(function (t) { return h('span', { class: 'dv-kw', text: t }); })) : null),
            trackBtn({ channel_id: c.id, name: c.name, handle: c.handle, tracked: c.tracked }));
        })) : empty(T.outsideEmpty))),
        h('div', { class: 'nv-col nv-side' }, card('dv-nbcard', T.neighbours, T.neighboursSub, h('div', null, h('ul', { class: 'dv-nb' }, (d.channels || []).map(function (c) {
          return h('li', null, h('b', { text: c.name }), c.mine ? h('span', { class: 'nv-tag', text: lang() === 'tr' ? 'benim' : 'mine' }) : null,
            h('div', { class: 'dv-nb-list' }, c.neighbors.length ? c.neighbors.slice(0, 3).map(function (n) {
              return h('a', { class: 'dv-pill' + (n.tracked ? ' is-tracked' : ''), href: n.url, target: '_blank', rel: 'noopener noreferrer', title: whyText(n) }, h('span', { text: n.name }), h('small', { text: Math.round(n.score * 100) + '' }));
            }) : h('span', { class: 'muted small', text: T.none })));
        })), h('p', { class: 'nv-sub dv-basis', text: fill(T.basis, { p: full(d.basis.co_rec_pairs), t: full(d.basis.text_channels) }) }))))));
      return out;
    }

    // ---- keywords ------------------------------------------------------------------------------------------
    function keywordsTab(d) {
      var T = L();
      var s = radarSettings();
      var seedIn = h('input', { type: 'text', class: 'dv-input', placeholder: T.seedPh, value: st.seed, 'aria-label': T.seed, maxlength: '100',
        onkeydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); st.seed = seedIn.value.trim(); st.expand = null; env.rerender(); } } });
      var cur = s.region + '|' + s.lang;
      var mk = h('select', { 'aria-label': T.country, onchange: function () { var p = mk.value.split('|'); saveRadar(function (rd) { rd.region = p[0]; rd.lang = p[1]; }).then(function () { st.key = ''; env.rerender(); }); } },
        MARKETS.map(function (m) { return h('option', { value: m[0] + '|' + m[1], selected: cur === m[0] + '|' + m[1], text: m[2] }); }));
      var controls = h('div', { class: 'dv-kwbar' },
        h('label', { class: 'dv-field is-grow' }, h('span', { text: T.seed }), h('span', { class: 'dv-add' }, seedIn, h('button', { class: 'btn', type: 'button', onclick: function () { st.seed = seedIn.value.trim(); st.expand = null; env.rerender(); } }, T.go))),
        h('label', { class: 'dv-field' }, h('span', { text: T.country }), mk),
        h('div', { class: 'dv-seeds' }, (d.seeds || []).map(function (sd) {
          return h('button', { type: 'button', class: 'dv-chip is-seed' + (d.expand === sd ? ' is-on' : ''), title: fill(T.expand, { s: sd }), onclick: function () { st.expand = sd; env.rerender(); } }, h('span', { text: sd }), h('small', { text: 'a–z' }));
        })));
      var ideas = (d.ideas || []).filter(function (i) { return st.filter === 'all' || (st.filter === 'ranks' ? !!i.ranks : !i.ranks); });
      var seg = h('div', { class: 'seg nv-seg', role: 'group', 'aria-label': T.kwTitle }, [['all', T.fAll], ['ranks', T.fRanks], ['ideas', T.fIdeas]].map(function (o) {
        return h('button', { type: 'button', 'aria-pressed': st.filter === o[0] ? 'true' : 'false', onclick: function () { st.filter = o[0]; env.rerender(); } }, o[1]);
      }));
      var dfsOn = F.isOn('provider-dataforseo');
      var radar = s.keywords[nicheKey()] || [];
      var table = ideas.length ? h('ul', { class: 'dv-ideas' }, ideas.slice(0, 120).map(function (i) {
        var onRadar = radar.indexOf(i.keyword) !== -1;
        var ranked = s.rankKeywords.indexOf(i.keyword) !== -1;
        return h('li', { class: 'dv-idea' + (i.ranks ? ' is-ranks' : '') },
          h('div', { class: 'dv-idea-main' },
            h('b', { class: 'dv-idea-kw', text: i.keyword }),
            h('div', { class: 'dv-srcs' }, i.sources.map(function (x) { return h('span', { class: 'dv-src is-' + x, text: T.src[x] || x }); }),
              i.lift != null && i.lift >= 1.2 ? h('span', { class: 'dv-lift', title: fill(T.lift, { x: times(i.lift) }), text: '↑ ' + times(i.lift) }) : null)),
          h('div', { class: 'dv-idea-side' },
            i.ranks ? h('span', { class: 'dv-ranks', title: fill(T.ranksTip, { v: full(i.ranks.views) }) }, h('i', { 'aria-hidden': 'true' }), T.ranks + ' · ' + num(i.ranks.views)) : null,
            i.serp ? h('span', { class: 'dv-serp', text: i.serp.rank ? fill(T.ranked, { r: i.serp.rank }) : T.notRanked }) : null,
            onRadar ? h('span', { class: 'dv-onradar', text: T.onRadar }) : h('button', { class: 'btn btn-ghost dv-small', type: 'button', onclick: function () { setKeywords(radar.concat(i.keyword)); } }, T.toRadar),
            dfsOn ? (ranked ? h('span', { class: 'dv-onradar', text: T.rankTracked }) : h('button', { class: 'btn btn-ghost dv-small', type: 'button', onclick: function () { saveRadar(function (rd) { rd.rankKeywords = rd.rankKeywords.concat(i.keyword); }); } }, T.toRank)) : null));
      })) : empty(d.feature ? T.kwEmpty : T.kwOff);
      var meta = h('p', { class: 'nv-sub' }, [fill(T.kwFetched, { f: d.fetched, c: d.cached, hl: d.hl, gl: d.gl }), ' · ', d.own_connected ? fill(T.kwOwn, { n: d.own_terms }) : T.kwOwnNone].join(''));
      var prompt = d.prompt_keywords && d.prompt_keywords.length ? d.prompt : null;
      var copyBtn = h('button', { class: 'btn btn-primary', type: 'button', disabled: !prompt, onclick: function () {
        navigator.clipboard.writeText(prompt).then(function () { st.copied = true; env.rerender(); setTimeout(function () { st.copied = false; env.rerender(); }, 1800); });
      } }, st.copied ? T.copied : T.copy);
      var rankKw = s.rankKeywords || [];
      return [
        h('div', { class: 'nv-grid dv-kwgrid' },
          h('div', { class: 'nv-col' }, card('dv-kwlist', T.kwTitle, T.kwSub, h('div', null, controls, st.loading && st.expand ? h('p', { class: 'small muted', text: fill(T.expanding, { s: st.expand }) }) : null, meta, table), seg)),
          h('div', { class: 'nv-col nv-side' },
            card('dv-claude', T.claude, T.claudeSub, prompt ? h('div', null, h('pre', { class: 'dv-prompt', tabindex: '0', text: prompt }), h('div', { class: 'm-actions' }, copyBtn)) : empty(T.claudeNone)),
            dfsOn || rankKw.length ? h('section', { class: 'm-card nv-card' }, h('p', { class: 'small' }, dfsOn ? fill(T.rankNote, { n: rankKw.length, c: (rankKw.length * 0.002).toFixed(3) }) : T.rankOff),
              rankKw.length ? h('div', { class: 'dv-chips' }, rankKw.map(function (k) {
                return h('span', { class: 'dv-chip' }, h('span', { text: k }), h('button', { type: 'button', class: 'dv-x', 'aria-label': fill(T.remove, { k: k }), onclick: function () { saveRadar(function (rd) { rd.rankKeywords = rd.rankKeywords.filter(function (x) { return x !== k; }); }); } }, '×'));
              })) : null) : null))
      ];
    }

    // ---- similar thumbnails ------------------------------------------------------------------------------
    function thumbsTab(d) {
      var T = L();
      var v = d.video || {};
      var head = h('section', { class: 'm-card nv-card dv-thead' },
        h('a', { class: 'nv-thumb dv-tbig', href: v.url, target: '_blank', rel: 'noopener noreferrer' }, (function () { var im = h('img', { alt: '' }); if (env.loadImage) env.loadImage(im, v.thumb); else im.src = v.thumb; return im; })()),
        h('div', { class: 'nv-main' },
          h('h2', { text: T.thumbsTitle }),
          h('a', { class: 'nv-title', href: v.url, target: '_blank', rel: 'noopener noreferrer', text: v.title || v.id }),
          v.channel ? h('span', { class: 'nv-chan', text: v.channel }) : null,
          h('p', { class: 'nv-sub', text: T.thumbsSub }),
          h('p', { class: 'small muted', text: v.hashed === false ? T.thumbsNoHash : fill(T.thumbsIdx, { i: full(d.indexed), p: full(d.pending) }) })));
      var list = d.similar || [];
      var grid = list.length ? h('ul', { class: 'dv-tgrid' }, list.map(function (x) {
        var label = x.distance === 0 ? T.same : x.distance <= 5 ? T.vclose : T.close;
        return h('li', { class: 'dv-tcell' },
          thumb(x),
          h('div', { class: 'dv-tmeta' },
            h('a', { class: 'nv-title', href: x.url, target: '_blank', rel: 'noopener noreferrer', text: x.title || x.id }),
            h('div', { class: 'nv-meta' }, x.channel ? h('span', { class: 'nv-chan', text: x.channel }) : null, x.views != null ? h('span', { text: fill(T.viewsN, { n: num(x.views) }) }) : null),
            h('div', { class: 'dv-dist' }, h('span', { class: 'dv-dbar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(4, 100 - x.distance / 12 * 100) + '%' })),
              h('small', { text: label + ' · ' + fill(T.dist, { d: x.distance }) }), x.same_channel ? h('span', { class: 'nv-tag is-soft', text: T.sameChannel }) : null)));
      })) : empty(T.thumbsEmpty);
      return [head, h('section', { class: 'm-card nv-card' }, grid)];
    }

    // ---- entry -------------------------------------------------------------------------------------------
    /** Draw tab ('radar' | 'map' | 'keywords' | 'thumbs') into main (after niche-view's head and tabs). */
    function render(main, tab, arg) {
      if (st.tab !== tab || st.arg !== arg) { st.msg = ''; st.filter = st.tab === tab ? st.filter : 'all'; }
      st.tab = tab;
      st.arg = arg;
      want(tab, arg);
      if (st.error) { main.appendChild(errorBox()); return; }
      var d = st.data;
      if (!d) { main.appendChild(h('p', { class: 'muted dv-loading', role: 'status', text: L().loading })); return; }
      var parts = tab === 'radar' ? radarTab(d) : tab === 'map' ? mapTab(d) : tab === 'keywords' ? keywordsTab(d) : thumbsTab(d);
      main.appendChild(h('div', { class: 'dv dv-' + tab }, parts));
    }
    function tabs() { return L().tabs; }
    function niches() { return st.data && st.data.niches || null; }
    function currentNiche() { return st.data ? st.data.niche : undefined; }
    function invalidate() { st.key = ''; }

    return { render: render, tabs: tabs, niches: niches, currentNiche: currentNiche, invalidate: invalidate, strings: S };
  }

  root.OpenOutlierDiscoveryView = { create: create };
})(typeof self !== 'undefined' ? self : this);
