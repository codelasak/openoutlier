// OpenOutlier Library – Kanalım / My YouTube channel (#/my-youtube): the user's own
// channels through the YouTube Analytics API (optional). The Google sign-ins live on the
// Mac (mcp/youtube-analytics.mjs, one token per channel); the bridge keeps a daily copy of
// each channel's Analytics (mcp/own-history.mjs, phase 2 of docs/youtube-niche-plan.md).
// This page asks the bridge, through the service worker, for:
//   reelscope:own          the stored history in one answer: progress charts with period
//                          comparisons, YPP progress + ETA, milestones, the video report
//                          card, search terms, traffic / geography / demographics, revenue,
//                          the last 48 hours (niche tracker), uploads for the profit calculator;
//   reelscope:yt-analytics the token side (status, Add channel / Reconnect / Disconnect) and
//                          the live per-video table with retention curves (as before).
// Several channels: a switcher and a combined view. TR/EN like the Niş Takibi page.
(function (root) {
  'use strict';

  var F = root.OpenOutlierFeatures;
  var OM = root.OpenOutlierOwnMetrics;
  var SETTINGS_KEY = 'rs:settings';
  var PICK_KEY = 'oo:kanalim-channel';

  var S = {
    en: {
      nav: 'My YouTube channel', title: 'My YouTube channel', loading: 'Loading…', refresh: 'Refresh', collect: 'Collect now', combined: 'Combined', addChannel: 'Add channel',
      subsN: '{n} subscribers', subs1: '1 subscriber', through: 'Analytics through {d}', since: 'since {d}', channelsN: '{n} channels',
      kSubs: 'Subscribers', kViews: 'Views · {n} d', kHours: 'Watch hours · {n} d', kCtr: 'Thumbnail CTR · {n} d', kPct: 'Avg. view % · {n} d',
      vsPrev: 'vs previous {n} d', newCh: 'too new to compare', noCtr: 'not reported by day',
      progress: 'Progress', progressSub: 'Daily numbers from YouTube Analytics, kept on this Mac since the channel\'s first day.',
      mSubs: 'Subscribers', mViews: 'Views', mHours: 'Watch hours', mCtr: 'CTR', mPct: 'Avg. view %',
      gDay: 'Day', gWeek: 'Week', gMonth: 'Month', r7: '7 days', r28: '28 days', r90: '90 days', r365: '365 days', rAll: 'All time',
      ledeViews: '{v} views in the last {n} days', ledeHours: '{v} watch hours in the last {n} days', ledeSubs: '{v} subscribers in the last {n} days', ledeCtr: '{v} thumbnail click-through rate in the last {n} days', ledePct: 'People watched {v} of a video on average in the last {n} days',
      ledeFirst: '{v} {unit} in the channel\'s first {d} days of Analytics.', unitSubs: 'subscribers', unitViews: 'views', unitHours: 'watch hours', ledeChange: ', {p} vs the previous {n} days.', ledeNew: '. Too new to compare with the {n} days before.', ledeFlat: ', the same as the previous {n} days.',
      prevPeriod: 'previous period', chartEmpty: 'No Analytics days yet for this range. YouTube Analytics is 2–3 days behind; the first days show up soon after connecting.',
      noReach: 'YouTube didn\'t report thumbnail impressions by day for this channel, so CTR stays empty.',
      cmpRow: 'Change vs the period before',
      report: 'Video report card', reportSub: 'Each upload\'s first 48 hours, 7 days and 30 days, next to your channel\'s median (same format) and the niche\'s.',
      chMedian: 'Your median', nicheMedian: 'Niche median', nicheScopeSimilar: '{niche}, channels your size ({n})', nicheScopeAll: '{niche}, whole niche ({n} channels)',
      noNiche: 'Track your channel in Niche tracking to compare with the niche.', h48: '48 h', d7: '7 d', d30: '30 d', total: 'Total', due: 'on {d}', long: 'Video', short: 'Short', live: 'Live',
      reportEmpty: 'No uploads in the last 90 days. Your next upload shows up here from its first days.', medianNote: 'Median from {n} videos', tooFew: 'too few videos for a median yet',
      vsChannel: '{x} your median', vsNiche: '{x} the niche', watchedPct: '{p} watched',
      search: 'Search terms that found you', searchSub: 'YouTube searches that led to your videos, last {w} weeks. Good words for your next titles and descriptions.',
      searchEmpty: 'No search views yet. YouTube lists a term once a few people find you through it (it hides rare ones), so small channels see few.',
      lastWeek: 'last week', newTerm: 'new', showAll: 'Show all {n}', showFewer: 'Show fewer', terms4w: '{w} wk',
      traffic: 'Traffic sources', geo: 'Geography', demo: 'Audience', devices: 'Devices', subscribed: 'Subscribed', playback: 'Where they watch', last4: 'Last {w} weeks · {n} views', lastW: 'Last {w} weeks, share of views', audEmpty: 'Fills in after the first complete week of views.',
      ageGender: 'Age and gender', male: 'Male', female: 'Female', other: 'Other', unavailable: 'YouTube doesn\'t report this for a channel this size (it needs more views).',
      ypp: 'Partner Program', yppSub: '1,000 subscribers, plus 4,000 watch hours on long videos in 365 days or 10M Shorts views in 90 days.',
      yppIn: 'In the Partner Program', yppInText: 'Revenue arrives below; YouTube Studio decides the rest.', yppReached: 'Eligible: you can apply in YouTube Studio → Earn.',
      pathWatch: 'Watch hours · 365 d', pathShorts: 'Shorts views · 90 d', or: 'or', best: 'closest',
      eta: 'At this pace: {t} ({d})', etaSubs: 'Subscribers at this pace: {t}', etaNever: 'Not at this pace ({p}/day). The oldest days leave the window as fast as new ones come.', etaEarly: 'Too early for an estimate: it needs 14 days of history.',
      etaStill: 'Not at this pace: {p} a day in the last {n} days.', paceH: '{v} h', approx: 'Includes Shorts\' watch time (Analytics didn\'t split it for this channel); YouTube Studio\'s count is the official one.',
      realtime: 'Last 48 hours', realtimeSub: 'From niche tracking\'s hourly measurements: YouTube Analytics is 2–3 days behind.', gained: 'views in 48 h', perHour: '{n}/h', isNew: 'new',
      realtimeOff: 'Hourly numbers come from niche tracking. Add this channel to a tracked niche (or press Track on its channel page) to see its last 48 hours here.', openNiche: 'Open Niche tracking', measured: 'measured {t}',
      milestones: 'Milestones', next: 'Next', reached: 'Reached', notify: 'Notify me (Chrome notification)', msSubs: '{n} subscribers', msViews: '{n} total views', msHours: '{n} watch hours', msVideo: 'First video with {n} views', msNone: 'Your first milestone, 10 subscribers, is next.',
      revenue: 'Revenue', revenueSub: 'Estimated, in USD, from YouTube Analytics.', revNot: 'Revenue shows up here once the channel is in the Partner Program. Nothing to set up: the permission is already granted.',
      revScope: 'Revenue needs one more read-only permission. Reconnect once to add it.', revNone: 'In the Partner Program, but no revenue reported yet.', revOff: 'Revenue is switched off in Features.',
      rev28: 'last 28 days', rpm: 'RPM', cpm: 'CPM', rpmHint: 'revenue per 1,000 views', cpmHint: 'what advertisers pay per 1,000 ad impressions',
      profit: 'Profit calculator', profitSub: 'What a video costs you (voice, thumbnail, your time) against what the channel earns.', costVideo: 'Per video', costShort: 'Per Short', currency: 'Currency', period: 'Period',
      uploadsN: '{v} videos · {s} Shorts', costTotal: 'Cost', revenueTotal: 'Revenue', net: 'Net', breakEven: 'Break-even RPM', breakEvenText: 'You\'d need an RPM of {v} to cover these costs with this period\'s views ({n}).',
      usdOnly: 'Revenue is reported in USD: pick USD to see the net.', enterCost: 'Enter what a video costs to see the result.',
      channels: 'Connected channels', primary: 'default', historyDone: 'history since {d}', historyLoading: 'loading history · {p}%', historyPending: 'starting…', lastDaily: 'updated {t}',
      reconnect: 'Reconnect', disconnect: 'Disconnect', addHint: 'A family member\'s channel: they sign in with their own Google account on this Mac; only read access is granted.',
      bannerScope: '{c}: revenue, RPM and CPM need one more read-only permission. Google asks once more; nothing else changes.', bannerExpired: 'Google no longer accepts the saved sign-in for {c} (apps in "Testing" get 7-day sign-ins). The history collected so far stays; reconnecting continues it.',
      bannerOff: 'Channel history is switched off, so nothing new is collected.', turnOn: 'Turn on', oldBridge: 'The bridge that is running is older than this page and keeps no channel history yet. Restart it: launchctl kickstart -k gui/$(id -u)/dev.openoutlier.bridge',
      collecting: 'Collecting {c}\'s history', collectingText: 'From {d} to today, newest first. The charts fill in as it goes; this page updates by itself.', collectingSoon: 'Starts within a minute of connecting.',
      perChannel: 'Channels side by side', perChannelSub: 'Last 28 days of each channel.', ch: 'Channel', views28: 'Views', hours28: 'Watch h', subs28: 'Subs', yppCol: 'Partner Program',
      liveVideos: 'Video details', show: 'Show', hide: 'Hide', liveSub: 'Live from YouTube Analytics for the period you pick: retention, impressions and CTR per video.', retention: 'Retention', period7: 'Last 7 days', period28: 'Last 28 days', period90: 'Last 90 days', period365: 'Last 365 days',
      cols: ['Video', 'Views', 'Engaged', 'Avg. view %', 'Avg. view', 'Impressions', 'CTR', 'Likes', 'Comments', 'Subs', ''], noViews: 'No views in this period.', reachErr: 'Thumbnail impressions and CTR are unavailable: {e}',
      setupTitle: 'Set up (optional)', setupText: 'Your own channel\'s analytics come from the YouTube Analytics API and need a Google OAuth client you create yourself. OpenOutlier keeps the sign-in on this Mac, read-only.',
      setupSteps: ['Google Cloud console: create a project, enable "YouTube Analytics API" and "YouTube Data API v3".', 'OAuth consent screen: External, publishing status Testing, add your Google account (and a family member\'s, for their channel) as test users.', 'Credentials → Create credentials → OAuth client ID → Desktop app. Download the JSON.', 'Save it as ~/.openoutlier/youtube-oauth.json (or set OPENOUTLIER_YOUTUBE_CLIENT_ID and OPENOUTLIER_YOUTUBE_CLIENT_SECRET for the bridge), then come back and press Connect.'],
      setupMore: 'Details: README → "My YouTube channel".', connectTitle: 'Connect your channel', connectText: 'Opens Google\'s sign-in. Approve read-only access (YouTube Analytics, revenue once you\'re in the Partner Program, and your channel\'s video list); Google sends you back to the OpenOutlier bridge on this Mac, which keeps the sign-in. Nothing goes anywhere else.',
      connectBtn: 'Connect YouTube', waiting: 'Waiting for Google…', waitMsg: 'Sign in with the Google account that owns the channel in the tab that just opened, and approve read-only access. This page updates when it\'s done.',
      connected: 'Connected. The history starts loading now.', notYet: 'Still not connected. Try again.', disconnected: 'Disconnected. The collected history stays on this Mac.',
      confirmDisconnect: 'Disconnect {c}? OpenOutlier deletes its Google sign-in from this Mac and asks Google to revoke it. The history collected so far stays.',
      noBridge: 'My YouTube channel runs through the OpenOutlier bridge on your Mac, and it isn\'t running.', install: 'Install it once (it stays on through launchd):',
      traffics: { YT_SEARCH: 'YouTube search', RELATED_VIDEO: 'Suggested videos', SUBSCRIBER: 'Browse features', SHORTS: 'Shorts feed', NO_LINK_OTHER: 'Direct or unknown', EXT_URL: 'External', PLAYLIST: 'Playlists', YT_CHANNEL: 'Channel pages', NOTIFICATION: 'Notifications', END_SCREEN: 'End screens', YT_OTHER_PAGE: 'Other YouTube pages', HASHTAGS: 'Hashtag pages', ADVERTISING: 'Ads', ANNOTATION: 'Cards', NO_LINK_EMBEDDED: 'Embedded', YT_PLAYLIST_PAGE: 'Playlist pages', SOUND_PAGE: 'Sound pages', LIVE_REDIRECT: 'Live redirects', PRODUCT_PAGE: 'Product pages', VIDEO_REMIXES: 'Remixes', CAMPAIGN_CARD: 'Campaign cards', PROMOTED: 'Promoted', IMMERSIVE_LIVE: 'Immersive live' },
      devicesL: { MOBILE: 'Phone', DESKTOP: 'Computer', TABLET: 'Tablet', TV: 'TV', GAME_CONSOLE: 'Game console', UNKNOWN_PLATFORM: 'Other' },
      subsL: { SUBSCRIBED: 'Subscribed', UNSUBSCRIBED: 'Not subscribed' },
      placesL: { WATCH: 'Watch page', YT_OTHER: 'Shorts feed & other', BROWSE: 'Home & browse', EMBEDDED: 'Embedded', CHANNEL: 'Channel page', SEARCH: 'Search results', EXTERNAL_APP: 'External apps', MOBILE: 'Mobile site' },
      days: 'd', months: 'mo', years: 'y', justNow: 'just now', of: 'of'
    },
    tr: {
      nav: 'Kanalım', title: 'Kanalım', loading: 'Yükleniyor…', refresh: 'Yenile', collect: 'Şimdi topla', combined: 'Birleşik', addChannel: 'Kanal ekle',
      subsN: '{n} abone', subs1: '1 abone', through: 'Analytics {d} tarihine kadar', since: '{d} tarihinden beri', channelsN: '{n} kanal',
      kSubs: 'Abone', kViews: 'İzlenme · {n} g', kHours: 'İzlenme süresi (sa) · {n} g', kCtr: 'Thumbnail TO · {n} g', kPct: 'Ort. izlenme % · {n} g',
      vsPrev: 'önceki {n} güne göre', newCh: 'karşılaştırmak için yeni', noCtr: 'günlük olarak verilmiyor',
      progress: 'İlerleme', progressSub: 'YouTube Analytics\'ten günlük sayılar; kanalın ilk gününden beri bu Mac\'te saklanıyor.',
      mSubs: 'Abone', mViews: 'İzlenme', mHours: 'İzlenme süresi', mCtr: 'TO', mPct: 'Ort. izlenme %',
      gDay: 'Gün', gWeek: 'Hafta', gMonth: 'Ay', r7: '7 gün', r28: '28 gün', r90: '90 gün', r365: '365 gün', rAll: 'Tüm zamanlar',
      ledeViews: 'Son {n} günde {v} izlenme', ledeHours: 'Son {n} günde {v} saat izlenme', ledeSubs: 'Son {n} günde {v} abone', ledeCtr: 'Son {n} günde thumbnail tıklama oranı {v}', ledePct: 'Son {n} günde izleyiciler bir videonun ortalama {v} kadarını izledi',
      ledeFirst: 'Kanalın Analytics\'teki ilk {d} gününde {v} {unit}.', unitSubs: 'abone', unitViews: 'izlenme', unitHours: 'saat izlenme', ledeChange: '; önceki {n} güne göre {p}.', ledeNew: '. Önceki {n} günle karşılaştırmak için çok yeni.', ledeFlat: '; önceki {n} günle aynı.',
      prevPeriod: 'önceki dönem', chartEmpty: 'Bu aralık için henüz Analytics günü yok. YouTube Analytics 2–3 gün geriden gelir; ilk günler bağlandıktan kısa süre sonra görünür.',
      noReach: 'YouTube bu kanal için günlük thumbnail gösterimini vermedi; TO boş kalıyor.',
      cmpRow: 'Önceki döneme göre değişim',
      report: 'Video karnesi', reportSub: 'Her yüklemenin ilk 48 saati, 7 günü ve 30 günü; kanalının medyanıyla (aynı format) ve nişin medyanıyla yan yana.',
      chMedian: 'Senin medyanın', nicheMedian: 'Niş medyanı', nicheScopeSimilar: '{niche}, senin büyüklüğündeki kanallar ({n})', nicheScopeAll: '{niche}, bütün niş ({n} kanal)',
      noNiche: 'Nişle karşılaştırmak için kanalını Niş Takibi\'ne ekle.', h48: '48 sa', d7: '7 g', d30: '30 g', total: 'Toplam', due: '{d}', long: 'Video', short: 'Short', live: 'Canlı',
      reportEmpty: 'Son 90 günde yükleme yok. Bir sonraki yüklemen ilk günlerinden itibaren burada görünür.', medianNote: '{n} videonun medyanı', tooFew: 'medyan için henüz az video var',
      vsChannel: 'medyanının {x}', vsNiche: 'nişin {x}', watchedPct: '{p} izlendi',
      search: 'Seni bulan arama terimleri', searchSub: 'Videolarına getiren YouTube aramaları, son {w} hafta. Bir sonraki başlık ve açıklama için iyi kelimeler.',
      searchEmpty: 'Henüz aramadan izlenme yok. YouTube bir terimi ancak birkaç kişi seni onunla bulunca listeler (nadir olanları gizler); küçük kanallar az görür.',
      lastWeek: 'geçen hafta', newTerm: 'yeni', showAll: '{n} terimin hepsini göster', showFewer: 'Daha az göster', terms4w: '{w} hf',
      traffic: 'Trafik kaynakları', geo: 'Coğrafya', demo: 'Kitle', devices: 'Cihazlar', subscribed: 'Abonelik', playback: 'Nerede izliyorlar', last4: 'Son {w} hafta · {n} izlenme', lastW: 'Son {w} hafta, izlenme payı', audEmpty: 'İlk tam haftanın izlenmesinden sonra dolar.',
      ageGender: 'Yaş ve cinsiyet', male: 'Erkek', female: 'Kadın', other: 'Diğer', unavailable: 'YouTube bu büyüklükteki bir kanal için bunu vermiyor (daha çok izlenme gerekiyor).',
      ypp: 'Partner Programı', yppSub: '1.000 abone; ayrıca 365 günde uzun videolarda 4.000 saat izlenme ya da 90 günde 10 milyon Shorts izlenmesi.',
      yppIn: 'Partner Programı\'nda', yppInText: 'Gelir aşağıda; gerisine YouTube Studio karar verir.', yppReached: 'Şartlar tamam: YouTube Studio → Para kazan\'dan başvurabilirsin.',
      pathWatch: 'İzlenme süresi · 365 g', pathShorts: 'Shorts izlenmesi · 90 g', or: 'ya da', best: 'en yakın',
      eta: 'Bu hızla: {t} ({d})', etaSubs: 'Bu hızla abone: {t}', etaNever: 'Bu hızla olmuyor (günde {p}). En eski günler, yenileri geldiği hızla pencereden çıkıyor.', etaEarly: 'Tahmin için erken: 14 günlük geçmiş gerekiyor.',
      etaStill: 'Bu hızla olmuyor: son {n} günün ortalaması günde {p}.', paceH: '{v} sa', approx: 'Shorts\'un izlenme süresi de dahil (Analytics bu kanal için ayırmadı); resmi sayı YouTube Studio\'daki.',
      realtime: 'Son 48 saat', realtimeSub: 'Niş takibinin saatlik ölçümlerinden: YouTube Analytics 2–3 gün geriden gelir.', gained: '48 saatte izlenme', perHour: '{n}/sa', isNew: 'yeni',
      realtimeOff: 'Saatlik sayılar niş takibinden gelir. Bu kanalı takip edilen bir nişe ekle (ya da kanal sayfasında Takip et\'e bas); son 48 saati burada görünür.', openNiche: 'Niş Takibi\'ni aç', measured: '{t} ölçüldü',
      milestones: 'Kilometre taşları', next: 'Sıradaki', reached: 'Ulaşılan', notify: 'Bana haber ver (Chrome bildirimi)', msSubs: '{n} abone', msViews: 'toplam {n} izlenme', msHours: '{n} saat izlenme', msVideo: '{n} izlenmeli ilk video', msNone: 'İlk kilometre taşın, 10 abone, sırada.',
      revenue: 'Gelir', revenueSub: 'YouTube Analytics\'ten tahmini, USD.', revNot: 'Kanal Partner Programı\'na girince gelir burada görünür. Kurulacak bir şey yok: izin zaten verildi.',
      revScope: 'Gelir için bir okuma izni daha gerekiyor. Eklemek için bir kez yeniden bağlan.', revNone: 'Partner Programı\'nda, ama henüz gelir görünmüyor.', revOff: 'Gelir, Özellikler\'de kapalı.',
      rev28: 'son 28 gün', rpm: 'RPM', cpm: 'CPM', rpmHint: '1.000 izlenme başına gelir', cpmHint: 'reklamverenin 1.000 reklam gösterimine ödediği',
      profit: 'Kâr hesaplayıcı', profitSub: 'Bir videonun sana maliyeti (ses, thumbnail, zamanın) ve kanalın kazancı.', costVideo: 'Video başına', costShort: 'Short başına', currency: 'Para birimi', period: 'Dönem',
      uploadsN: '{v} video · {s} Shorts', costTotal: 'Maliyet', revenueTotal: 'Gelir', net: 'Net', breakEven: 'Başa baş RPM', breakEvenText: 'Bu maliyeti bu dönemin izlenmesiyle ({n}) karşılamak için {v} RPM gerekir.',
      usdOnly: 'Gelir USD olarak geliyor: neti görmek için USD seç.', enterCost: 'Sonucu görmek için bir videonun maliyetini gir.',
      channels: 'Bağlı kanallar', primary: 'varsayılan', historyDone: '{d} tarihinden beri geçmiş', historyLoading: 'geçmiş yükleniyor · %{p}', historyPending: 'başlıyor…', lastDaily: '{t} güncellendi',
      reconnect: 'Yeniden bağlan', disconnect: 'Bağlantıyı kes', addHint: 'Bir aile üyesinin kanalı: bu Mac\'te kendi Google hesabıyla giriş yapar; yalnız okuma izni verilir.',
      bannerScope: '{c}: gelir, RPM ve CPM için bir okuma izni daha gerekiyor. Google bir kez daha sorar; başka hiçbir şey değişmez.', bannerExpired: 'Google, {c} için kayıtlı oturumu artık kabul etmiyor ("Testing" modundaki uygulamalar 7 günlük oturum verir). Toplanan geçmiş duruyor; yeniden bağlanınca devam eder.',
      bannerOff: 'Kanal geçmişi kapalı; yeni veri toplanmıyor.', turnOn: 'Aç', oldBridge: 'Çalışan bridge bu sayfadan eski ve henüz kanal geçmişi tutmuyor. Yeniden başlat: launchctl kickstart -k gui/$(id -u)/dev.openoutlier.bridge',
      collecting: '{c} kanalının geçmişi toplanıyor', collectingText: '{d} tarihinden bugüne, en yeniden başlayarak. Grafikler doldukça güncellenir; sayfa kendiliğinden yenilenir.', collectingSoon: 'Bağlandıktan sonra bir dakika içinde başlar.',
      perChannel: 'Kanallar yan yana', perChannelSub: 'Her kanalın son 28 günü.', ch: 'Kanal', views28: 'İzlenme', hours28: 'İzl. sa', subs28: 'Abone', yppCol: 'Partner Programı',
      liveVideos: 'Video ayrıntıları', show: 'Göster', hide: 'Gizle', liveSub: 'Seçtiğin dönem için YouTube Analytics\'ten canlı: video başına izleyici tutma, gösterim ve TO.', retention: 'İzleyici tutma', period7: 'Son 7 gün', period28: 'Son 28 gün', period90: 'Son 90 gün', period365: 'Son 365 gün',
      cols: ['Video', 'İzlenme', 'Etkileşimli', 'Ort. izl. %', 'Ort. süre', 'Gösterim', 'TO', 'Beğeni', 'Yorum', 'Abone', ''], noViews: 'Bu dönemde izlenme yok.', reachErr: 'Thumbnail gösterimi ve TO alınamadı: {e}',
      setupTitle: 'Kurulum (isteğe bağlı)', setupText: 'Kendi kanalının analitiği YouTube Analytics API\'den gelir ve senin oluşturacağın bir Google OAuth istemcisi gerekir. OpenOutlier oturumu bu Mac\'te, yalnız okuma izniyle tutar.',
      setupSteps: ['Google Cloud konsolu: bir proje aç, "YouTube Analytics API" ve "YouTube Data API v3"ü etkinleştir.', 'OAuth izin ekranı: External, yayın durumu Testing; Google hesabını (ve kanalı için bir aile üyesininkini) test kullanıcısı olarak ekle.', 'Credentials → Create credentials → OAuth client ID → Desktop app. JSON\'u indir.', '~/.openoutlier/youtube-oauth.json olarak kaydet (ya da bridge için OPENOUTLIER_YOUTUBE_CLIENT_ID ve OPENOUTLIER_YOUTUBE_CLIENT_SECRET ayarla), sonra buraya dönüp Bağla\'ya bas.'],
      setupMore: 'Ayrıntılar: README → "My YouTube channel".', connectTitle: 'Kanalını bağla', connectText: 'Google\'ın giriş sayfasını açar. Yalnız okuma iznini onayla (YouTube Analytics, Partner Programı\'na girince gelir ve kanalının video listesi); Google seni bu Mac\'teki OpenOutlier bridge\'ine geri gönderir, oturumu o tutar. Başka hiçbir yere bir şey gitmez.',
      connectBtn: 'YouTube\'u bağla', waiting: 'Google bekleniyor…', waitMsg: 'Az önce açılan sekmede kanalın sahibi olan Google hesabıyla giriş yap ve yalnız okuma iznini onayla. Bitince bu sayfa güncellenir.',
      connected: 'Bağlandı. Geçmiş şimdi yüklenmeye başlıyor.', notYet: 'Hâlâ bağlı değil. Tekrar dene.', disconnected: 'Bağlantı kesildi. Toplanan geçmiş bu Mac\'te duruyor.',
      confirmDisconnect: '{c} bağlantısı kesilsin mi? OpenOutlier Google oturumunu bu Mac\'ten siler ve Google\'dan iptal etmesini ister. Şimdiye kadar toplanan geçmiş kalır.',
      noBridge: 'Kanalım, Mac\'teki OpenOutlier bridge\'i üzerinden çalışır ve bridge çalışmıyor.', install: 'Bir kez kur (launchd sayesinde açık kalır):',
      traffics: { YT_SEARCH: 'YouTube araması', RELATED_VIDEO: 'Önerilen videolar', SUBSCRIBER: 'Göz atma özellikleri', SHORTS: 'Shorts akışı', NO_LINK_OTHER: 'Doğrudan ya da bilinmiyor', EXT_URL: 'Harici', PLAYLIST: 'Oynatma listeleri', YT_CHANNEL: 'Kanal sayfaları', NOTIFICATION: 'Bildirimler', END_SCREEN: 'Bitiş ekranları', YT_OTHER_PAGE: 'Diğer YouTube sayfaları', HASHTAGS: 'Hashtag sayfaları', ADVERTISING: 'Reklamlar', ANNOTATION: 'Kartlar', NO_LINK_EMBEDDED: 'Gömülü', YT_PLAYLIST_PAGE: 'Liste sayfaları', SOUND_PAGE: 'Ses sayfaları', LIVE_REDIRECT: 'Canlı yönlendirme', PRODUCT_PAGE: 'Ürün sayfaları', VIDEO_REMIXES: 'Remiksler', CAMPAIGN_CARD: 'Kampanya kartları', PROMOTED: 'Tanıtım', IMMERSIVE_LIVE: 'Sürükleyici canlı' },
      devicesL: { MOBILE: 'Telefon', DESKTOP: 'Bilgisayar', TABLET: 'Tablet', TV: 'TV', GAME_CONSOLE: 'Oyun konsolu', UNKNOWN_PLATFORM: 'Diğer' },
      subsL: { SUBSCRIBED: 'Abone', UNSUBSCRIBED: 'Abone değil' },
      placesL: { WATCH: 'İzleme sayfası', YT_OTHER: 'Shorts akışı ve diğer', BROWSE: 'Ana sayfa ve göz atma', EMBEDDED: 'Gömülü', CHANNEL: 'Kanal sayfası', SEARCH: 'Arama sonuçları', EXTERNAL_APP: 'Harici uygulamalar', MOBILE: 'Mobil site' },
      days: 'g', months: 'ay', years: 'yıl', justNow: 'az önce', of: '/'
    }
  };

  function create(env) {
    // Resolved here: dashboard.html loads features.js and own-metrics.js after this file.
    F = root.OpenOutlierFeatures;
    OM = root.OpenOutlierOwnMetrics;
    var h = env.h;
    var ui = { channel: null, metric: 'views', gran: 'day', range: 28, days: 28, loading: false, error: '', msg: '', open: null, waiting: false, termsAll: false, liveOpen: false, at: 0 };
    try { ui.channel = root.localStorage.getItem(PICK_KEY) || null; } catch (e) { /* storage off */ }
    var st = null;       // token status { configured, connected, channels: [...] }
    var own = null;      // the stored history page (reelscope:own) | { error, oldBridge }
    var live = null;     // { channel, totals, videos, reach_error } for the live table
    var curves = {};     // video id -> { points, summary } | { error }
    var profit = {};     // rs:settings.ownProfit: { [channel]: { video, short, currency } }
    var waitTimer = null;
    var pollTimer = null;
    var flags = F && F.flags ? F.flags() : {};

    function lang() { return F && F.uiLang ? F.uiLang() : 'en'; }
    function L() { return S[lang()] || S.en; }
    function fill(s, o) { return String(s).replace(/\{(\w+)\}/g, function (_, k) { return o[k] != null ? o[k] : ''; }); }
    function loc() { return lang() === 'tr' ? 'tr-TR' : 'en-US'; }
    function num(n) { return n == null ? '–' : new Intl.NumberFormat(loc(), { notation: 'compact', maximumFractionDigits: Math.abs(n) < 1000 ? 0 : 1 }).format(n); }
    function full(n) { return n == null ? '–' : new Intl.NumberFormat(loc()).format(Math.round(n)); }
    function dec(n, d) { return n == null ? '–' : new Intl.NumberFormat(loc(), { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(n); }
    function pctv(v, d) { return v == null ? '–' : new Intl.NumberFormat(loc(), { style: 'percent', maximumFractionDigits: d == null ? 1 : d }).format(v / 100); }
    function money(v, cur) { return v == null ? '–' : new Intl.NumberFormat(loc(), { style: 'currency', currency: cur || 'USD', maximumFractionDigits: Math.abs(v) < 100 ? 2 : 0 }).format(v); }
    function times(x) { return x == null ? '–' : new Intl.NumberFormat(loc(), { maximumFractionDigits: x < 10 ? 1 : 0, minimumFractionDigits: x < 10 ? 1 : 0 }).format(x) + '×'; }
    function signedPct(p) { return p == null ? '–' : (p > 0 ? '+' : p < 0 ? '−' : '±') + new Intl.NumberFormat(loc(), { maximumFractionDigits: Math.abs(p) < 10 ? 1 : 0 }).format(Math.abs(p)) + '%'; }
    function signed(n) { return n == null ? '–' : (n > 0 ? '+' : n < 0 ? '−' : '±') + num(Math.abs(n)); }
    function dayLabel(d, opts) { return d ? new Date(d + 'T12:00:00Z').toLocaleDateString(loc(), Object.assign({ day: 'numeric', month: 'short', timeZone: 'UTC' }, opts || {})) : '–'; }
    function dateOf(t) { return t ? new Date(t).toLocaleDateString(loc(), { day: 'numeric', month: 'short' }) : '–'; }
    function monthYear(d) { return dayLabel(d, { day: undefined, month: 'short', year: 'numeric' }); }
    function ago(t) {
      if (!t) return '–';
      var s = (t - Date.now()) / 1000;
      if (Math.abs(s) < 60) return L().justNow;
      var rtf = new Intl.RelativeTimeFormat(loc(), { numeric: 'auto' });
      var units = [['day', 86400], ['hour', 3600], ['minute', 60]];
      for (var i = 0; i < units.length; i++) if (Math.abs(s) >= units[i][1]) return rtf.format(Math.round(s / units[i][1]), units[i][0]);
      return L().justNow;
    }
    function span(days) {
      if (days == null) return '–';
      if (days <= 45) return '~' + days + ' ' + L().days;
      if (days < 365) return '~' + Math.round(days / 30.4) + ' ' + L().months;
      return '~' + dec(Math.round(days / 36.5) / 10, 1) + ' ' + L().years;
    }
    function dur(s) { if (s == null) return '–'; s = Math.round(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
    function vdur(s) { if (!s) return ''; s = Math.round(s); var hh = Math.floor(s / 3600); var mm = Math.floor((s % 3600) / 60); var ss = s % 60; return (hh ? hh + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(ss).padStart(2, '0'); }
    function errText(r) { return (r.error || 'Failed.') + (r.hint ? ' ' + r.hint : ''); }

    // ---- talking to the bridge ---------------------------------------------------------
    function call(path, extra) {
      return chrome.runtime.sendMessage(Object.assign({ type: 'reelscope:yt-analytics', path: path, method: /connect$|disconnect$/.test(path) ? 'POST' : 'GET' }, extra || {}))
        .then(function (r) { return r || { ok: false, error: 'No answer from the service worker.' }; }, function (e) { return { ok: false, error: e.message }; });
    }
    function callOwn(extra) {
      return chrome.runtime.sendMessage(Object.assign({ type: 'reelscope:own', path: '/youtube/own/page' }, extra || {}))
        .then(function (r) { return r || { ok: false, error: 'No answer from the service worker.' }; }, function (e) { return { ok: false, error: e.message }; });
    }

    async function load() {
      st = await call('/youtube/analytics/status');
      if (st.ok && st.connected) await loadOwn();
    }
    async function loadOwn() {
      ui.loading = true;
      env.rerender();
      var r = await callOwn({ channel: ui.channel || undefined });
      ui.loading = false;
      own = r;
      ui.at = Date.now();
      if (r.ok && ui.channel && r.channel !== ui.channel) ui.channel = r.channel; // a channel that went away
      if (r.ok && !r.page) ui.liveOpen = true;
      schedulePoll();
      env.rerender();
      try { var p = await chrome.storage.local.get(SETTINGS_KEY); profit = (p[SETTINGS_KEY] || {}).ownProfit || {}; } catch (e) { /* none */ }
    }
    // While a channel's history is still loading, look again every 20 s.
    function schedulePoll() {
      clearTimeout(pollTimer);
      var busy = own && own.ok && (own.channels || []).some(function (c) { return !c.collecting || !c.collecting.backfill_done; });
      if (busy) pollTimer = setTimeout(function () { if (document.visibilityState !== 'hidden') loadOwn(); else schedulePoll(); }, 20000);
    }
    async function refreshAll() {
      st = await call('/youtube/analytics/status');
      if (live) live = null;
      await loadOwn();
      if (ui.liveOpen) refreshLive();
    }
    async function collectNow() {
      await callOwn({ path: '/youtube/own/refresh', channel: ui.channel && ui.channel !== 'all' ? ui.channel : undefined });
      ui.msg = '';
      setTimeout(loadOwn, 4000);
    }
    function pick(id) {
      ui.channel = id;
      try { root.localStorage.setItem(PICK_KEY, id); } catch (e) { /* storage off */ }
      live = null;
      curves = {};
      ui.open = null;
      loadOwn();
      if (ui.liveOpen) refreshLive();
    }
    function liveChannel() { return ui.channel && ui.channel !== 'all' ? ui.channel : own && own.channel && own.channel !== 'all' ? own.channel : undefined; }
    async function refreshLive() {
      ui.liveLoading = true;
      env.rerender();
      var ch = liveChannel();
      var both = await Promise.all([call('/youtube/analytics/channel', { days: ui.days, channel: ch }), call('/youtube/analytics/videos', { days: ui.days, limit: 100, channel: ch })]);
      ui.liveLoading = false;
      var c = both[0];
      var v = both[1];
      live = { channel: c.ok ? c.channel : null, totals: c.ok ? c.totals : null, videos: v.ok ? v.videos : [], reach_error: v.ok ? v.reach_error : null, error: !c.ok && !v.ok ? errText(c) : !v.ok ? errText(v) : '' };
      env.rerender();
    }

    async function connect(channel) {
      ui.msg = '';
      var before = st && st.channels ? JSON.stringify(st.channels.map(function (c) { return [c.channel_id, c.needs_reconsent, c.reconnect]; })) : '';
      var r = await call('/youtube/analytics/connect', channel ? { channel: channel } : {});
      if (!r.ok || !r.url) { ui.msg = errText(r); env.rerender(); return; }
      window.open(r.url, '_blank', 'noopener');
      ui.waiting = channel || 'new';
      ui.msg = L().waitMsg;
      env.rerender();
      var until = Date.now() + 15 * 60000;
      clearInterval(waitTimer);
      waitTimer = setInterval(async function () {
        var s = await call('/youtube/analytics/status');
        var now = s.ok && s.channels ? JSON.stringify(s.channels.map(function (c) { return [c.channel_id, c.needs_reconsent, c.reconnect]; })) : '';
        if ((s.ok && s.connected && now !== before) || Date.now() > until) {
          clearInterval(waitTimer);
          ui.waiting = false;
          st = s;
          ui.msg = s.connected && now !== before ? L().connected : L().notYet;
          if (s.connected) { setTimeout(function () { callOwn({ path: '/youtube/own/refresh' }).then(function () { setTimeout(loadOwn, 3000); }); }, 500); loadOwn(); } else env.rerender();
        }
      }, 3000);
    }
    async function disconnect(c) {
      if (!confirm(fill(L().confirmDisconnect, { c: c.title || c.channel_id }))) return;
      await call('/youtube/analytics/disconnect', { channel: c.channel_id });
      if (ui.channel === c.channel_id) ui.channel = null;
      live = null;
      curves = {};
      st = await call('/youtube/analytics/status');
      ui.msg = L().disconnected;
      if (st.ok && st.connected) await loadOwn(); else { own = null; env.rerender(); }
    }
    async function toggleCurve(id) {
      if (ui.open === id) { ui.open = null; env.rerender(); return; }
      ui.open = id;
      env.rerender();
      if (!curves[id]) {
        var r = await call('/youtube/analytics/retention', { id: id, channel: liveChannel() });
        curves[id] = r.ok ? r : { error: errText(r) };
        env.rerender();
      }
    }
    async function saveProfit(key, patch) {
      profit[key] = Object.assign({}, profit[key], patch);
      try {
        var r = await chrome.storage.local.get(SETTINGS_KEY);
        var s = Object.assign({}, r[SETTINGS_KEY]);
        s.ownProfit = profit;
        var o = {};
        o[SETTINGS_KEY] = s;
        await chrome.storage.local.set(o);
      } catch (e) { /* kept for this visit */ }
    }

    // ---- SVG ------------------------------------------------------------------------------
    var NS = 'http://www.w3.org/2000/svg';
    function svg(tag, attrs, kids) {
      var el = document.createElementNS(NS, tag);
      for (var k in attrs || {}) if (attrs[k] != null) el.setAttribute(k, attrs[k]);
      (kids || []).forEach(function (c) { if (c) el.appendChild(c); });
      return el;
    }
    function txt(x, y, s, cls, anchor) { var t = svg('text', { x: x, y: y, class: cls, 'text-anchor': anchor || 'start' }); t.textContent = s; return t; }
    function niceMax(v) {
      if (!(v > 0)) return 1;
      var p = Math.pow(10, Math.floor(Math.log10(v)));
      var m = v / p;
      return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
    }
    function spark(values, cls, w, hh) {
      w = w || 64; hh = hh || 20;
      var max = Math.max.apply(null, values.concat([1]));
      var d = values.map(function (v, i) { return (i ? 'L' : 'M') + (values.length > 1 ? i * (w - 2) / (values.length - 1) + 1 : w / 2).toFixed(1) + ' ' + (hh - 2 - (v / max) * (hh - 4)).toFixed(1); }).join(' ');
      return svg('svg', { viewBox: '0 0 ' + w + ' ' + hh, class: 'kc-spark ' + (cls || ''), 'aria-hidden': 'true' }, [svg('path', { d: d })]);
    }

    // ---- data for the progress chart -----------------------------------------------------------
    var METRICS = [['subs', 'mSubs'], ['views', 'mViews'], ['watch_hours', 'mHours'], ['ctr', 'mCtr'], ['avg_pct', 'mPct']];
    function isLine(m) { return m === 'subs' || m === 'ctr' || m === 'avg_pct'; }
    function series(p) {
      var daily = (p.daily || []).map(function (r) { return Object.assign({}, r); });
      if (ui.range === 'all') {
        var monthly = (p.monthly || []).map(function (b) { return { d: b.d, views: b.views, watch_hours: b.minutes == null ? null : b.minutes / 60, subs: b.subs_cum, subs_net: b.subs_net, ctr: b.ctr, avg_pct: b.avg_pct, impressions: b.impressions }; });
        return { cur: monthly, prev: null, gran: 'month' };
      }
      var n = ui.range;
      var end = p.data_through;
      if (!end || !OM) return { cur: [], prev: null, gran: ui.gran };
      var from = OM.addDays(end, -n + 1);
      var prevFrom = OM.addDays(from, -n);
      var curRows = daily.filter(function (r) { return r.d >= from && r.d <= end; });
      var prevRows = daily.filter(function (r) { return r.d >= prevFrom && r.d < from; });
      var gran = ui.gran === 'month' && n < 90 ? 'week' : ui.gran === 'week' && n < 14 ? 'day' : ui.gran;
      function shape(rows) { return OM.aggregate(rows, gran).map(function (b) { return { d: b.d, days: b.days, views: b.views, watch_hours: b.watch_hours, subs: b.subs, subs_net: b.subs_net, ctr: b.ctr, avg_pct: b.avg_pct, impressions: b.impressions }; }); }
      // subs_cum rides along on the daily rows; aggregate keeps the last of each bucket.
      return { cur: shape(curRows), prev: prevRows.length >= curRows.length * 0.5 && p.first_day && prevFrom >= p.first_day ? shape(prevRows) : null, gran: gran };
    }
    function val(b, m) { if (!b) return null; if (m === 'ctr') return b.ctr == null ? null : b.ctr * 100; return b[m] == null ? null : b[m]; }
    function fmtMetric(m, v, short) {
      if (v == null) return '–';
      if (m === 'ctr' || m === 'avg_pct') return pctv(v);
      if (m === 'watch_hours') return v < 100 ? dec(v, 1) : short ? num(v) : full(v);
      return short ? num(v) : full(v);
    }

    function chart(p) {
      var s = series(p);
      var m = ui.metric;
      var cur = s.cur;
      if (!cur.length || cur.every(function (b) { return val(b, m) == null; })) return empty(m === 'ctr' && cur.length ? L().noReach : L().chartEmpty);
      // Drawn at the width it will show at, so the axis text stays readable on a phone.
      var mainW = (document.querySelector('main') || {}).clientWidth || 900;
      var W = Math.max(300, Math.min(680, mainW - 72)); var Hh = W < 500 ? 200 : 230; var padL = 46; var padR = 12; var padT = 14; var padB = 26;
      // The subscriber total is a running line (no "previous period" overlay); the rest compare with the period before.
      var prev = m === 'subs' ? null : s.prev;
      var vals = cur.map(function (b) { return val(b, m); }).concat(prev ? prev.map(function (b) { return val(b, m); }) : []).filter(function (v) { return v != null; });
      var lo = 0;
      var top;
      if (m === 'subs') {
        var mn = Math.min.apply(null, vals);
        var mx = Math.max.apply(null, vals);
        var rng = Math.max(2, niceMax((mx - mn) * 1.2));
        lo = Math.max(0, Math.floor(mn / (rng / 2)) * (rng / 2));
        top = lo + rng;
        while (top < mx) top += rng / 2;
      } else top = niceMax(Math.max.apply(null, vals.concat([0])) * 1.04) || 1;
      var n = cur.length;
      var bw = (W - padL - padR) / n;
      var X = function (i) { return padL + bw * (i + 0.5); };
      var Y = function (v) { return padT + (1 - (v - lo) / ((top - lo) || 1)) * (Hh - padT - padB); };
      var g = [];
      [0, 0.5, 1].forEach(function (f) {
        var v = lo + (top - lo) * f;
        g.push(svg('line', { x1: padL, x2: W - padR, y1: Y(v), y2: Y(v), class: 'kc-grid' + (f === 0 ? ' is-base' : '') }));
        g.push(txt(padL - 8, Y(v) + 4, fmtMetric(m, v, true), 'kc-axis', 'end'));
      });
      // x labels: about 6 across
      var every = Math.max(1, Math.ceil(n / (W < 500 ? 4 : 6)));
      cur.forEach(function (b, i) {
        if (i % every !== 0 && i !== n - 1) return;
        if (i === n - 1 && i % every !== 0 && (n - 1) % every < every * 0.6) return;
        g.push(txt(X(i), Hh - 8, s.gran === 'month' ? monthYear(b.d) : dayLabel(b.d), 'kc-axis', 'middle'));
      });
      if (prev) {
        var pl = prev.slice(-n);
        var off = n - pl.length;
        var pd = pl.map(function (b, i) { var v = val(b, m); return v == null ? null : [X(i + off), Y(v)]; }).filter(Boolean);
        if (pd.length > 1) g.push(svg('path', { d: pd.map(function (q, i) { return (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1); }).join(' '), class: 'kc-prev' }));
      }
      if (!isLine(m)) {
        cur.forEach(function (b, i) {
          var v = val(b, m);
          if (v == null) return;
          var y = Y(Math.max(lo, v));
          g.push(svg('rect', { x: (X(i) - Math.max(1, bw * 0.36)).toFixed(1), y: y.toFixed(1), width: Math.max(2, bw * 0.72).toFixed(1), height: Math.max(v > 0 ? 1.5 : 0, Y(lo) - y).toFixed(1), class: 'kc-bar' + (i === n - 1 ? ' is-last' : '') }));
        });
      } else {
        var pts = cur.map(function (b, i) { var v = val(b, m); return v == null ? null : [X(i), Y(v)]; }).filter(Boolean);
        if (pts.length) {
          if (m === 'subs') g.push(svg('path', { d: 'M' + pts[0][0].toFixed(1) + ' ' + Y(lo).toFixed(1) + pts.map(function (q) { return 'L' + q[0].toFixed(1) + ' ' + q[1].toFixed(1); }).join('') + 'L' + pts[pts.length - 1][0].toFixed(1) + ' ' + Y(lo).toFixed(1) + 'Z', class: 'kc-area' }));
          g.push(svg('path', { d: pts.map(function (q, i) { return (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1); }).join(' '), class: 'kc-line' }));
          var last = pts[pts.length - 1];
          g.push(svg('rect', { x: last[0] - 3, y: last[1] - 3, width: 6, height: 6, class: 'kc-dot' }));
        }
      }
      var hover = svg('line', { x1: 0, x2: 0, y1: padT, y2: Hh - padB, class: 'kc-hover', visibility: 'hidden' });
      g.push(hover);
      var el = svg('svg', { viewBox: '0 0 ' + W + ' ' + Hh, class: 'kc-chart', role: 'img', 'aria-label': L().progress + ': ' + L()[METRICS.filter(function (x) { return x[0] === m; })[0][1]] }, g);
      var readout = h('p', { class: 'kc-readout', 'aria-live': 'polite' }, ' ');
      function show(i) {
        var b = cur[i];
        if (!b) return;
        hover.setAttribute('x1', X(i)); hover.setAttribute('x2', X(i)); hover.setAttribute('visibility', 'visible');
        var label = s.gran === 'month' ? monthYear(b.d) : s.gran === 'week' ? dayLabel(b.d) + ' – ' + dayLabel(OM.addDays(b.d, (b.days || 7) - 1)) : dayLabel(b.d, { weekday: 'short' });
        var pv = prev ? prev.slice(-n)[i - (n - prev.slice(-n).length)] : null;
        readout.textContent = label + ' · ' + fmtMetric(m, val(b, m)) + ' ' + L()[METRICS.filter(function (x) { return x[0] === m; })[0][1]].toLowerCase() + (m === 'subs' && b.subs_net != null ? ' (' + signed(b.subs_net) + ')' : '') + (pv && val(pv, m) != null ? ' · ' + L().prevPeriod + ' ' + fmtMetric(m, val(pv, m)) : '');
      }
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        var x = (e.clientX - r.left) / r.width * W;
        show(Math.max(0, Math.min(n - 1, Math.floor((x - padL) / bw))));
      });
      el.addEventListener('pointerleave', function () { hover.setAttribute('visibility', 'hidden'); readout.textContent = ' '; });
      var keys = h('p', { class: 'kc-legend' }, h('span', { class: 'kc-key ' + (isLine(m) ? 'is-line' : 'is-bar') }), L()[METRICS.filter(function (x) { return x[0] === m; })[0][1]],
        prev ? [h('span', { class: 'kc-key is-prev' }), L().prevPeriod] : null);
      return h('div', null, h('div', { class: 'kc-chart-wrap' }, el), h('div', { class: 'kc-chart-foot' }, keys, readout));
    }

    // ---- pieces ----------------------------------------------------------------------------
    function card(cls, title, sub, body, extra) {
      return h('section', { class: 'm-card kc-card ' + (cls || '') },
        h('div', { class: 'kc-card-head' }, h('h2', { text: title }), extra || null),
        sub ? h('p', { class: 'kc-sub', text: sub }) : null,
        body);
    }
    function empty(text, action) { return h('div', { class: 'kc-empty' }, h('span', { class: 'kc-empty-px', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('span', null, text, action ? [' ', action] : null)); }
    function seg(label, opts, cur, on) {
      return h('div', { class: 'seg kc-seg', role: 'group', 'aria-label': label }, opts.map(function (o) {
        return h('button', { type: 'button', 'aria-pressed': String(cur === o[0]), onclick: function () { on(o[0]); } }, o[1]);
      }));
    }
    function delta(c, invert) {
      if (!c || c.pct == null) return null;
      var up = invert ? c.pct < 0 : c.pct > 0;
      return h('span', { class: 'kc-delta' + (Math.abs(c.pct) < 0.5 ? '' : up ? ' is-up' : ' is-down') }, h('span', { 'aria-hidden': 'true', text: Math.abs(c.pct) < 0.5 ? '' : c.pct > 0 ? '▲ ' : '▼ ' }), signedPct(c.pct));
    }
    function bar(v, max, cls) { return h('span', { class: 'kc-track' }, h('span', { class: 'kc-fill ' + (cls || ''), style: 'width:' + Math.max(v > 0 ? 1.5 : 0, Math.min(100, (v || 0) / (max || 1) * 100)).toFixed(1) + '%' })); }
    function thumb(v) {
      var wrap = h('a', { class: 'kc-thumb' + (v.type === 'short' ? ' is-short' : ''), href: v.url, target: '_blank', rel: 'noopener noreferrer', tabindex: '-1', 'aria-hidden': 'true' });
      var im = h('img', { alt: '', loading: 'lazy', decoding: 'async' });
      im.addEventListener('error', function () { im.remove(); wrap.classList.add('is-blank'); });
      if (env.loadImage) env.loadImage(im, v.thumb); else im.src = v.thumb;
      wrap.appendChild(im);
      if (v.duration && v.type !== 'short') wrap.appendChild(h('span', { class: 'kc-dur', text: vdur(v.duration) }));
      if (v.type === 'short') wrap.appendChild(h('span', { class: 'kc-dur', text: 'Shorts' }));
      return wrap;
    }
    function avatar(c, cls) {
      var wrap = h('span', { class: 'kc-avatar ' + (cls || ''), 'aria-hidden': 'true' });
      var initials = String(c && c.title || '?').split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
      wrap.appendChild(h('b', { text: initials }));
      if (c && c.thumb) {
        var im = h('img', { alt: '', decoding: 'async' });
        im.addEventListener('load', function () { wrap.classList.add('has-img'); });
        im.addEventListener('error', function () { im.remove(); });
        if (env.loadImage) env.loadImage(im, c.thumb); else im.src = c.thumb;
        wrap.appendChild(im);
      }
      return wrap;
    }

    function kpis(p) {
      var c = p.compare && p.compare[28];
      var through = p.data_through;
      function k(label, value, sub, extra) { return h('div', { class: 'kpi kc-kpi' }, h('span', { class: 'kpi-label', text: label }), h('b', { text: value }), h('span', { class: 'kc-kpi-sub' }, extra || null, sub ? h('small', { text: sub }) : null)); }
      var cmpSub = c && c.covered ? fill(L().vsPrev, { n: 28 }) : L().newCh;
      var subsNet = c ? c.subs_net : null;
      return h('div', { class: 'kpis kc-kpis' },
        k(L().kSubs, full(p.totals && p.totals.subs), subsNet && subsNet.cur != null ? signed(subsNet.cur) + ' · 28 ' + L().days : null),
        k(fill(L().kViews, { n: 28 }), c ? full(c.views.cur) : '–', cmpSub, c ? delta(c.views) : null),
        k(fill(L().kHours, { n: 28 }), c ? fmtMetric('watch_hours', c.watch_hours.cur) : '–', cmpSub, c ? delta(c.watch_hours) : null),
        k(fill(L().kCtr, { n: 28 }), c && c.ctr.cur != null ? pctv(c.ctr.cur) : '–', c && c.ctr.cur == null ? L().noCtr : cmpSub, c ? delta(c.ctr) : null),
        k(fill(L().kPct, { n: 28 }), c && c.avg_pct.cur != null ? pctv(c.avg_pct.cur) : '–', cmpSub, c ? delta(c.avg_pct) : null));
    }

    function progressCard(p) {
      var c = p.compare || {};
      var m = ui.metric;
      var n = ui.range === 'all' ? null : ui.range;
      var cm = { subs: 'subs_net', views: 'views', watch_hours: 'watch_hours', ctr: 'ctr', avg_pct: 'avg_pct' }[m];
      var w = n && c[n] ? c[n] : null;
      var lede = null;
      if (w && w[cm] && w[cm].cur != null) {
        var tpl = { subs: L().ledeSubs, views: L().ledeViews, watch_hours: L().ledeHours, ctr: L().ledeCtr, avg_pct: L().ledePct }[m];
        var v = m === 'subs' ? signed(w[cm].cur) : fmtMetric(m, w[cm].cur);
        var pc = w[cm].pct;
        // A channel younger than the window: say "in its first N days" instead of comparing with days it didn't exist.
        if (p.history_days && p.history_days < n) {
          lede = m === 'ctr' || m === 'avg_pct' ? fill(tpl, { v: v, n: p.history_days }) + '.'
            : fill(L().ledeFirst, { v: v, unit: { subs: L().unitSubs, views: L().unitViews, watch_hours: L().unitHours }[m], d: p.history_days });
        }
        else lede = fill(tpl, { v: v, n: n }) + (pc == null ? fill(L().ledeNew, { n: n }) : Math.abs(pc) < 0.5 ? fill(L().ledeFlat, { n: n }) : fill(L().ledeChange, { n: n, p: signedPct(pc) }));
      }
      var metricSeg = seg(L().progress, METRICS.map(function (x) { return [x[0], L()[x[1]]]; }), m, function (v) { ui.metric = v; env.rerender(); });
      var rangeSel = h('select', { 'aria-label': L().period, class: 'kc-select', onchange: function (e) { ui.range = e.target.value === 'all' ? 'all' : Number(e.target.value); env.rerender(); } },
        [[7, L().r7], [28, L().r28], [90, L().r90], [365, L().r365], ['all', L().rAll]].map(function (o) { return h('option', { value: String(o[0]), selected: String(ui.range) === String(o[0]), text: o[1] }); }));
      var granSeg = ui.range === 'all' ? null : seg(L().period, [['day', L().gDay], ['week', L().gWeek], ['month', L().gMonth]].filter(function (o) { return o[0] !== 'month' || ui.range >= 90; }).filter(function (o) { return o[0] !== 'week' || ui.range >= 14; }), ui.gran === 'month' && ui.range < 90 ? 'week' : ui.gran === 'week' && ui.range < 14 ? 'day' : ui.gran, function (v) { ui.gran = v; env.rerender(); });
      var chips = [7, 28, 90, 365].filter(function (d) { return c[d]; }).map(function (d) {
        var x = c[d][cm];
        return h('span', { class: 'kc-chip' + (ui.range === d ? ' is-on' : '') }, h('small', { text: d + ' ' + L().days }), x && x.pct != null ? delta(x) : h('span', { class: 'kc-delta', text: '–' }));
      });
      return card('kc-progress', L().progress, null, h('div', null,
        h('div', { class: 'kc-controls' }, metricSeg, h('span', { class: 'kc-controls-r' }, granSeg, rangeSel)),
        lede ? h('p', { class: 'kc-lede', text: lede }) : null,
        chart(p),
        h('div', { class: 'kc-chips', 'aria-label': L().cmpRow }, h('span', { class: 'kc-chips-label', text: L().cmpRow }), chips)));
    }

    function reportCard(p) {
      var r = p.report || { videos: [] };
      var vids = r.videos || [];
      if (!vids.length) return card('kc-report', L().report, L().reportSub, empty(L().reportEmpty));
      var med = r.channel_median || {};
      var nm = r.niche;
      var H = [[48, L().h48], [168, L().d7], [720, L().d30]];
      function medLine(label, o, note) {
        return h('div', { class: 'kc-med' }, h('span', { class: 'kc-med-label', text: label }),
          ['long', 'short'].filter(function (f) { return o[f] && (o[f][48] != null || o[f][168] != null); }).map(function (f) {
            return h('span', { class: 'kc-med-f' }, h('b', { text: f === 'short' ? 'Shorts' : L().long }), H.map(function (x) { return h('span', null, h('small', { text: x[1] }), num(o[f][x[0]])); }));
          }), note ? h('small', { class: 'kc-med-note', text: note }) : null);
      }
      var heads = h('div', { class: 'kc-meds' },
        medLine(L().chMedian, med, null),
        nm ? medLine(L().nicheMedian, nm, fill(nm.scope === 'similar' ? L().nicheScopeSimilar : L().nicheScopeAll, { niche: nm.niche || '', n: nm.channels })) : h('p', { class: 'kc-med-none' }, L().noNiche, ' ', h('a', { href: '#/niche', text: L().openNiche + ' →' })));
      var rows = vids.map(function (v) {
        return h('li', { class: 'kc-rc-row' },
          thumb(v),
          h('div', { class: 'kc-rc-main' },
            h('a', { class: 'kc-title', href: v.url, target: '_blank', rel: 'noopener noreferrer', text: v.title || v.id }),
            h('div', { class: 'kc-meta' }, h('span', { class: 'kc-tag' + (v.type === 'short' ? ' is-short' : ''), text: v.type === 'short' ? L().short : v.type === 'live' ? L().live : L().long }), h('span', { text: dateOf(v.published_at) }),
              v.avg_pct != null ? h('span', { text: fill(L().watchedPct, { p: pctv(v.avg_pct, 0) }) }) : null)),
          H.map(function (x) {
            var cpv = v.cp && v.cp[x[0]];
            if (!cpv) return h('div', { class: 'kc-rc-cell is-pending' }, h('small', { text: x[1] }), h('span', { text: v.pending && v.pending[x[0]] ? fill(L().due, { d: dateOf(v.pending[x[0]]) }) : '–' }));
            var rc = v.vs_channel && v.vs_channel[x[0]];
            var rn = v.vs_niche && v.vs_niche[x[0]];
            var tip = [rc != null ? fill(L().vsChannel, { x: times(rc) }) : null, rn != null ? fill(L().vsNiche, { x: times(rn) }) : null].filter(Boolean).join(' · ');
            return h('div', { class: 'kc-rc-cell', title: tip || null },
              h('small', { text: x[1] }), h('b', { text: full(cpv.v) }),
              rc != null ? h('span', { class: 'kc-x' + (rc >= 2 ? ' is-out' : rc >= 1.15 ? ' is-up' : rc < 0.7 ? ' is-low' : '') }, rc >= 2 ? h('span', { class: 'stair', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')) : null, times(rc)) : null);
          }),
          h('div', { class: 'kc-rc-cell is-total' }, h('small', { text: L().total }), h('b', { text: num(v.views) })));
      });
      return card('kc-report', L().report, L().reportSub, h('div', null, heads, h('ol', { class: 'kc-rc' }, rows)));
    }

    function termsCard(p) {
      var t = p.search_terms || { terms: [] };
      var list = t.terms || [];
      var w = t.window_weeks || 4;
      if (!list.length) return card('kc-terms', L().search, fill(L().searchSub, { w: w }), empty(L().searchEmpty));
      var max = Math.max.apply(null, list.map(function (x) { return x.views; }).concat([1]));
      var shown = ui.termsAll ? list : list.slice(0, 10);
      var body = h('ol', { class: 'kc-terms-list' }, shown.map(function (x, i) {
        var ch = x.change;
        return h('li', null,
          h('span', { class: 'kc-rank', text: String(i + 1) }),
          h('span', { class: 'kc-term' }, h('b', { text: x.term }), x.is_new ? h('span', { class: 'kc-new', text: L().newTerm }) : null),
          bar(x.views, max),
          h('span', { class: 'kc-num', title: fill(L().terms4w, { w: w }), text: full(x.views) }),
          h('span', { class: 'kc-wow' + (ch > 0 ? ' is-up' : ch < 0 ? ' is-down' : ''), title: L().lastWeek + ': ' + full(x.last_week) + (x.prev_week != null ? ' (' + full(x.prev_week) + ')' : '') }, ch == null ? '' : (ch > 0 ? '▲ ' : ch < 0 ? '▼ ' : '') + (ch === 0 ? '±0' : signed(ch))),
          spark(x.series || [], '', 56, 18));
      }));
      var more = list.length > 10 ? h('button', { class: 'btn btn-ghost kc-more', type: 'button', onclick: function () { ui.termsAll = !ui.termsAll; env.rerender(); } }, ui.termsAll ? L().showFewer : fill(L().showAll, { n: list.length })) : null;
      var head = h('div', { class: 'kc-terms-head', 'aria-hidden': 'true' }, h('span'), h('span'), h('span'), h('span', { text: fill(L().terms4w, { w: w }) }), h('span', { text: L().lastWeek }), h('span'));
      return card('kc-terms', L().search, fill(L().searchSub, { w: w }), h('div', null, head, body, more));
    }

    function barsList(rows, labelOf, opts) {
      opts = opts || {};
      var max = Math.max.apply(null, rows.map(function (r) { return r.share || 0; }).concat([0.01]));
      return h('ul', { class: 'kc-bars' }, rows.slice(0, opts.limit || 8).map(function (r) {
        return h('li', null, h('span', { class: 'kc-bar-label', text: labelOf(r.key) }), bar(r.share, max, opts.cls), h('span', { class: 'kc-num', text: pctv((r.share || 0) * 100, 0) }));
      }));
    }
    function audienceCards(p) {
      var a = p.audience || {};
      var w = (a.weeks || []).length || 4;
      var none = function (kind) { return !a[kind] || !a[kind].rows || !a[kind].rows.length; };
      var regions = null;
      try { regions = new Intl.DisplayNames([loc()], { type: 'region' }); } catch (e) { /* old engine */ }
      var sub = function (kind) { return a[kind] && a[kind].total ? fill(L().last4, { w: w, n: full(a[kind].total) }) : null; };
      var traffic = card('kc-aud', L().traffic, sub('traffic'), none('traffic') ? empty(a.traffic && a.traffic.unavailable ? L().unavailable : L().audEmpty) : barsList(a.traffic.rows, function (k) { return L().traffics[k] || k; }));
      var geo = card('kc-aud', L().geo, sub('countries'), none('countries') ? empty(a.countries && a.countries.unavailable ? L().unavailable : L().audEmpty) : barsList(a.countries.rows, function (k) { try { return regions ? regions.of(k) : k; } catch (e) { return k; } }, { cls: 'is-geo' }));
      var ag = a.age_gender || {};
      var ages = Object.keys(ag.by_age || {});
      var demo;
      if (!ages.length) demo = empty(ag.unavailable ? L().unavailable : L().audEmpty);
      else {
        var maxA = Math.max.apply(null, ages.map(function (k) { return ag.by_age[k]; }).concat([1]));
        var g = ag.by_gender || {};
        demo = h('div', null,
          h('div', { class: 'kc-gender' }, ['male', 'female', 'user_specified'].filter(function (k) { return g[k]; }).map(function (k) {
            return h('span', { class: 'kc-gender-' + k, style: 'flex:' + g[k] }, h('b', { text: pctv(g[k], 0) }), ' ', k === 'male' ? L().male : k === 'female' ? L().female : L().other);
          })),
          h('ul', { class: 'kc-ages' }, ages.map(function (k) {
            var m = (ag.rows || []).filter(function (r) { return r.age === k && r.gender === 'male'; })[0];
            var f = (ag.rows || []).filter(function (r) { return r.age === k && r.gender === 'female'; })[0];
            return h('li', null, h('span', { class: 'kc-bar-label', text: k.replace('-', '–').replace(/–$/, '+') }),
              h('span', { class: 'kc-track kc-stack' }, h('span', { class: 'kc-fill is-m', style: 'width:' + ((m ? m.pct : 0) / maxA * 100).toFixed(1) + '%' }), h('span', { class: 'kc-fill is-f', style: 'width:' + ((f ? f.pct : 0) / maxA * 100).toFixed(1) + '%' })),
              h('span', { class: 'kc-num', text: pctv(ag.by_age[k], 0) }));
          })));
      }
      var demoCard = card('kc-aud', L().ageGender, ages.length ? fill(L().lastW, { w: w }) : null, demo);
      var small = card('kc-aud', L().devices, sub('devices'), h('div', { class: 'kc-aud-small' },
        none('devices') ? empty(L().audEmpty) : barsList(a.devices.rows, function (k) { return L().devicesL[k] || k; }, { limit: 4 }),
        none('subscribed') ? null : h('div', null, h('h3', { text: L().subscribed }), barsList(a.subscribed.rows, function (k) { return L().subsL[k] || k; }, { limit: 2, cls: 'is-alt' })),
        none('playback') ? null : h('div', null, h('h3', { text: L().playback }), barsList(a.playback.rows, function (k) { return L().placesL[k] || k; }, { limit: 4, cls: 'is-alt' }))));
      return h('div', { class: 'kc-aud-grid' }, traffic, geo, demoCard, small);
    }

    function yppCard(p) {
      var y = p.ypp || {};
      if (y.in_ypp) return card('kc-ypp is-in', L().ypp, null, h('div', { class: 'kc-ypp-in' }, h('span', { class: 'kc-ypp-badge' }, h('span', { class: 'stair', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), L().yppIn), h('p', { class: 'kc-sub', text: L().yppInText })));
      var s = y.subs || {};
      function meter(label, cur, target, fmtV, reached, extra) {
        return h('div', { class: 'kc-meter' + (reached ? ' is-done' : '') },
          h('div', { class: 'kc-meter-head' }, h('span', { text: label }), h('b', null, fmtV(cur), h('small', { text: ' / ' + fmtV(target) }))),
          h('span', { class: 'kc-meter-track', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(target), 'aria-valuenow': String(cur || 0), 'aria-label': label },
            h('span', { style: 'width:' + Math.max(cur > 0 ? 1.2 : 0, Math.min(100, (cur || 0) / target * 100)).toFixed(1) + '%' })),
          extra || null);
      }
      function etaText(days, pace, paceFmt) {
        if (!y.enough_history) return L().etaEarly;
        if (days === 0) return null;
        if (days == null) return fill(L().etaStill, { p: paceFmt(pace), n: y.pace_days || 28 });
        return fill(L().eta, { t: span(days), d: monthYear(OM ? OM.addDays(y.end || p.data_through, days) : '') });
      }
      var subsEta = s.reached ? null : y.enough_history && s.days != null ? fill(L().etaSubs, { t: span(s.days) }) : null;
      var paths = (y.paths || []).map(function (q, i) {
        var mm = q.metric;
        var isW = q.id === 'watch';
        var fmtV = isW ? function (v) { return full(v); } : function (v) { return num(v); };
        var e = mm.reached ? null : etaText(mm.days, mm.pace_per_day, isW ? function (v) { return fill(L().paceH, { v: dec(v, 1) }); } : function (v) { return num(v); });
        return h('div', { class: 'kc-path' + (y.best === q.id && (y.paths || []).length > 1 ? ' is-best' : '') },
          i ? h('span', { class: 'kc-or', text: L().or }) : null,
          meter(isW ? L().pathWatch : L().pathShorts, mm.current, mm.target, fmtV, mm.reached, e ? h('p', { class: 'kc-eta', text: e }) : null),
          y.best === q.id && (y.paths || []).length > 1 && !y.reached ? h('span', { class: 'kc-best', text: L().best }) : null);
      });
      return card('kc-ypp', L().ypp, L().yppSub, h('div', null,
        y.reached ? h('p', { class: 'kc-ypp-badge is-ready' }, h('span', { class: 'stair', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), L().yppReached) : null,
        meter(L().kSubs, s.current, s.target || 1000, full, s.reached, subsEta ? h('p', { class: 'kc-eta', text: subsEta }) : null),
        h('div', { class: 'kc-paths' }, paths),
        y.eta_days != null && !y.reached ? h('p', { class: 'kc-ypp-eta' }, h('span', { class: 'stair', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), fill(L().eta, { t: span(y.eta_days), d: monthYear(OM.addDays(y.end || p.data_through, y.eta_days)) })) : null,
        y.approx_hours ? h('p', { class: 'kc-note', text: L().approx }) : null));
    }

    function realtimeCard(p) {
      var r = p.realtime || {};
      if (!r.tracked) return card('kc-rt', L().realtime, null, empty(L().realtimeOff, h('a', { href: '#/niche', text: L().openNiche + ' →' })));
      var max = Math.max.apply(null, (r.series || []).concat([1]));
      var W = 300; var Hh = 56;
      var pts = (r.series || []).map(function (v, i, a) { return [i * W / Math.max(1, a.length - 1), Hh - 4 - v / max * (Hh - 10)]; });
      var area = pts.length ? svg('svg', { viewBox: '0 0 ' + W + ' ' + Hh, class: 'kc-rt-chart', 'aria-hidden': 'true', preserveAspectRatio: 'none' }, [
        svg('path', { d: 'M0 ' + Hh + pts.map(function (q) { return 'L' + q[0].toFixed(1) + ' ' + q[1].toFixed(1); }).join('') + 'L' + W + ' ' + Hh + 'Z', class: 'kc-area' }),
        svg('path', { d: pts.map(function (q, i) { return (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1); }).join(' '), class: 'kc-line' })]) : null;
      return card('kc-rt', L().realtime, L().realtimeSub, h('div', null,
        h('div', { class: 'kc-rt-top' }, h('b', { class: 'kc-big', text: signed(r.gained_48h) }), h('span', { text: L().gained })),
        area,
        (r.videos || []).length ? h('ul', { class: 'kc-rt-list' }, r.videos.slice(0, 4).map(function (v) {
          return h('li', null, h('span', { class: 'kc-rt-title' }, v.new ? h('span', { class: 'kc-new', text: L().isNew }) : null, v.title || v.id),
            h('b', { text: signed(v.gained_48h) }), v.vph24 != null ? h('small', { text: fill(L().perHour, { n: num(v.vph24) }) }) : h('small'));
        })) : null,
        r.last_measured_at ? h('p', { class: 'kc-note', text: fill(L().measured, { t: ago(r.last_measured_at) }) }) : null));
    }

    function milestonesCard(p) {
      var m = p.milestones || { reached: [], next: [] };
      var label = function (x) { var n = full(x.value); return x.kind === 'subs' ? fill(L().msSubs, { n: n }) : x.kind === 'views' ? fill(L().msViews, { n: n }) : x.kind === 'hours' ? fill(L().msHours, { n: n }) : fill(L().msVideo, { n: n }); };
      var next = (m.next || []).slice().sort(function (a, b) { return (b.pct || 0) - (a.pct || 0); });
      var reached = (m.reached || []).slice().sort(function (a, b) { return String(b.day || '').localeCompare(String(a.day || '')); });
      var notify = F ? h('label', { class: 'm-check kc-notify' }, h('input', { type: 'checkbox', checked: !!(F.flags ? F.flags()['own-milestones'] : flags['own-milestones']), onchange: function (e) { F.set('own-milestones', e.target.checked); } }), L().notify) : null;
      return card('kc-ms', L().milestones, null, h('div', null,
        next.length ? h('div', null, h('h3', { text: L().next }), h('ul', { class: 'kc-ms-next' }, next.map(function (x) {
          return h('li', null, h('div', { class: 'kc-meter-head' }, h('span', { text: label(x) }), h('small', { text: (x.kind === 'hours' ? dec(x.current, 1) : full(x.current)) + ' ' + L().of + ' ' + full(x.value) })), h('span', { class: 'kc-meter-track is-thin' }, h('span', { style: 'width:' + Math.max(x.pct > 0 ? 1.5 : 0, x.pct || 0) + '%' })),
            x.video && x.video.title ? h('small', { class: 'kc-ms-video', text: x.video.title }) : null);
        }))) : null,
        reached.length ? h('div', null, h('h3', { text: L().reached }), h('ul', { class: 'kc-ms-done' }, reached.slice(0, 8).map(function (x) {
          return h('li', null, h('span', { class: 'kc-check', 'aria-hidden': 'true' }), h('span', { class: 'kc-ms-label' }, label(x), x.video && x.video.title ? h('small', { text: x.video.title }) : null), h('small', { text: x.day ? dayLabel(x.day, { year: 'numeric' }) : '' }));
        }))) : h('p', { class: 'kc-sub', text: L().msNone }),
        notify));
    }

    function revenueCard(p, chans) {
      var r = p.revenue || {};
      var feats = own && own.features || {};
      var body;
      if (feats.revenue === false) body = empty(L().revOff, h('a', { href: '#/settings', text: '→' }));
      else if (r.state === 'needs_scope') {
        var c = (chans || []).filter(function (x) { return x.needs_reconsent && (p.channel_id === 'all' || x.channel_id === p.channel_id); })[0];
        body = empty(L().revScope, c ? h('button', { class: 'btn kc-inline-btn', type: 'button', disabled: !!ui.waiting, onclick: function () { connect(c.channel_id); } }, L().reconnect) : null);
      } else if (r.state === 'ok' && r.d28) {
        var d = r.d28;
        var pc = r.prev28 && r.prev28.revenue ? (d.revenue - r.prev28.revenue) / r.prev28.revenue * 100 : null;
        body = h('div', null,
          h('div', { class: 'kc-rt-top' }, h('b', { class: 'kc-big', text: money(d.revenue) }), h('span', null, L().rev28, ' ', pc != null ? delta({ pct: pc }) : null)),
          h('div', { class: 'kc-tiles' },
            h('div', { title: L().rpmHint }, h('span', { text: L().rpm }), h('b', { text: money(d.rpm) }), h('small', { text: L().rpmHint })),
            h('div', { title: L().cpmHint }, h('span', { text: L().cpm }), h('b', { text: money(d.cpm) }), h('small', { text: L().cpmHint }))),
          r.d365 ? h('p', { class: 'kc-note', text: '365 ' + L().days + ': ' + money(r.d365.revenue) + ' · RPM ' + money(r.d365.rpm) }) : null);
      } else if (r.state === 'none' || r.state === 'ok') body = empty(L().revNone);
      else body = empty(L().revNot);
      return card('kc-rev', L().revenue, r.state === 'ok' ? L().revenueSub : null, body);
    }

    function profitCard(p) {
      var key = p.channel_id || 'default';
      var cfg = Object.assign({ video: '', short: '', currency: 'USD', days: 28 }, profit[key]);
      var days = Number(cfg.days) || 28;
      var end = p.data_through;
      var from = end && OM ? OM.addDays(end, -days + 1) : null;
      var ups = (p.uploads || []).filter(function (u) { var d = new Date(u.published_at).toISOString().slice(0, 10); return from && d >= from && d <= end; });
      var nv = ups.filter(function (u) { return u.type !== 'short'; }).length;
      var ns = ups.length - nv;
      var cost = (Number(cfg.video) || 0) * nv + (Number(cfg.short) || 0) * ns;
      var win = (p.daily || []).filter(function (r) { return from && r.d >= from && r.d <= end; });
      var views = win.reduce(function (s, r) { return s + (r.views || 0); }, 0);
      var rev = win.some(function (r) { return r.revenue != null; }) ? win.reduce(function (s, r) { return s + (r.revenue || 0); }, 0) : null;
      var out = h('div', { class: 'kc-profit-out', 'aria-live': 'polite' });
      function draw() {
        out.textContent = '';
        var c2 = Object.assign({ video: '', short: '', currency: 'USD' }, profit[key]);
        var cst = (Number(c2.video) || 0) * nv + (Number(c2.short) || 0) * ns;
        out.appendChild(h('div', { class: 'kc-profit-row' }, h('span', { text: L().period }), h('b', { text: fill(L().uploadsN, { v: nv, s: ns }) })));
        if (!(cst > 0)) { out.appendChild(h('p', { class: 'kc-note', text: L().enterCost })); return; }
        out.appendChild(h('div', { class: 'kc-profit-row' }, h('span', { text: L().costTotal }), h('b', { text: money(cst, c2.currency) })));
        if (rev != null) {
          out.appendChild(h('div', { class: 'kc-profit-row' }, h('span', { text: L().revenueTotal }), h('b', { text: money(rev, 'USD') })));
          if (c2.currency === 'USD') out.appendChild(h('div', { class: 'kc-profit-row is-net' + (rev - cst >= 0 ? ' is-up' : ' is-down') }, h('span', { text: L().net }), h('b', { text: money(rev - cst, 'USD') })));
          else out.appendChild(h('p', { class: 'kc-note', text: L().usdOnly }));
        }
        if (views > 0) out.appendChild(h('div', { class: 'kc-profit-row is-be' }, h('span', { text: L().breakEven }), h('b', { text: money(cst / views * 1000, c2.currency) }), h('small', { text: fill(L().breakEvenText, { v: money(cst / views * 1000, c2.currency), n: full(views) }) })));
      }
      function input(field, label) {
        var el = h('input', { type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: cfg[field] === '' ? null : String(cfg[field]), placeholder: '0', 'aria-label': label });
        el.addEventListener('input', function () { saveProfit(key, (function () { var o = {}; o[field] = el.value === '' ? '' : Number(el.value); return o; })()); draw(); });
        return h('label', { class: 'kc-field' }, h('span', { text: label }), el);
      }
      var cur = h('select', { class: 'kc-select', 'aria-label': L().currency, onchange: function (e) { saveProfit(key, { currency: e.target.value }); draw(); } }, ['USD', 'TRY', 'EUR', 'GBP'].map(function (c) { return h('option', { value: c, selected: cfg.currency === c, text: c }); }));
      var per = h('select', { class: 'kc-select', 'aria-label': L().period, onchange: function (e) { saveProfit(key, { days: Number(e.target.value) }); env.rerender(); } }, [[28, L().r28], [90, L().r90], [365, L().r365]].map(function (o) { return h('option', { value: String(o[0]), selected: days === o[0], text: o[1] }); }));
      draw();
      return card('kc-profit', L().profit, L().profitSub, h('div', null,
        h('div', { class: 'kc-profit-in' }, input('video', L().costVideo), input('short', L().costShort), h('label', { class: 'kc-field' }, h('span', { text: L().currency }), cur), h('label', { class: 'kc-field' }, h('span', { text: L().period }), per)),
        out));
    }

    function channelsCard(chans, noHistory) {
      return card('kc-chans', L().channels, null, h('div', null,
        h('ul', { class: 'kc-chan-list' }, chans.map(function (c) {
          var col = c.collecting || {};
          var stateText = c.reconnect || noHistory ? null : c.pending || !col.backfill_from && !col.backfill_done ? L().historyPending : col.backfill_done ? fill(L().historyDone, { d: monthYear(col.created || col.backfill_from) }) : fill(L().historyLoading, { p: col.pct || 0 });
          return h('li', { class: c.reconnect || c.needs_reconsent ? 'is-warn' : null },
            avatar(c),
            h('div', { class: 'kc-chan-main' },
              h('div', { class: 'kc-chan-name' }, h('b', { text: c.title || c.channel_id }), c.primary ? h('span', { class: 'kc-tag is-soft', text: L().primary }) : null),
              h('small', { class: 'muted', text: [c.subs != null ? (c.subs === 1 ? L().subs1 : fill(L().subsN, { n: full(c.subs) })) : null, stateText, col.last_daily_at ? fill(L().lastDaily, { t: ago(col.last_daily_at) }) : null].filter(Boolean).join(' · ') }),
              col.error && !c.reconnect ? h('small', { class: 'kc-err', text: col.error }) : null,
              !col.backfill_done && !c.pending && col.pct != null ? h('span', { class: 'kc-meter-track is-thin' }, h('span', { style: 'width:' + (col.pct || 0) + '%' })) : null),
            h('span', { class: 'kc-chan-actions' },
              c.reconnect || c.needs_reconsent ? h('button', { class: 'btn kc-small', type: 'button', disabled: !!ui.waiting, onclick: function () { connect(c.channel_id); } }, ui.waiting === c.channel_id ? L().waiting : L().reconnect) : null,
              h('button', { class: 'btn btn-ghost kc-small', type: 'button', onclick: function () { disconnect(c); } }, L().disconnect)));
        })),
        h('div', { class: 'kc-add' },
          h('button', { class: 'btn btn-primary', type: 'button', disabled: !!ui.waiting, onclick: function () { connect(); } }, ui.waiting === 'new' ? L().waiting : '+ ' + L().addChannel),
          h('small', { class: 'muted', text: L().addHint })),
        ui.msg ? h('p', { class: 'm-msg', 'aria-live': 'polite', text: ui.msg }) : null));
    }

    function perChannelCard(p) {
      var rows = p.per_channel || [];
      return card('kc-per', L().perChannel, L().perChannelSub, h('div', { class: 'cmp-wrap' }, h('table', { class: 'kc-per-table' },
        h('thead', null, h('tr', null, h('th', { text: L().ch }), h('th', { class: 'num', text: L().kSubs }), h('th', { class: 'num', text: L().views28 }), h('th', { class: 'num', text: L().hours28 }), h('th', { class: 'num', text: L().subs28 }), h('th', { text: L().yppCol }))),
        h('tbody', null, rows.map(function (r) {
          var y = r.ypp || {};
          return h('tr', null,
            h('th', null, h('button', { class: 'kc-per-name', type: 'button', onclick: function () { pick(r.channel_id); } }, avatar(r, 'is-small'), r.title)),
            h('td', { class: 'num', text: full(r.subs) }),
            h('td', { class: 'num' }, full(r.views_28d), ' ', delta({ pct: r.views_pct })),
            h('td', { class: 'num', text: fmtMetric('watch_hours', r.watch_hours_28d) }),
            h('td', { class: 'num', text: signed(r.subs_28d) }),
            h('td', null, y.in_ypp ? h('span', { class: 'kc-tag', text: 'YPP' }) : h('span', { class: 'kc-per-ypp' }, h('span', { class: 'kc-meter-track is-thin' }, h('span', { style: 'width:' + Math.min(100, y.pct || 0) + '%' })), h('small', { text: y.reached ? '✓' : y.eta_days != null ? span(y.eta_days) : pctv(y.pct, 0) }))));
        })))));
    }

    function banners(chans) {
      var out = [];
      var feats = own && own.features || {};
      if (feats.history === false) out.push(h('p', { class: 'ft-warn kc-banner' }, L().bannerOff, h('button', { class: 'ft-fix', type: 'button', onclick: function () { F.set('own-history', true).then(function () { setTimeout(loadOwn, 2500); }); } }, L().turnOn)));
      chans.filter(function (c) { return c.reconnect; }).forEach(function (c) {
        out.push(h('p', { class: 'ft-warn kc-banner' }, h('span', { text: fill(L().bannerExpired, { c: c.title || c.channel_id }) }), h('button', { class: 'ft-fix', type: 'button', disabled: !!ui.waiting, onclick: function () { connect(c.channel_id); } }, ui.waiting === c.channel_id ? L().waiting : L().reconnect)));
      });
      chans.filter(function (c) { return c.needs_reconsent && !c.reconnect; }).forEach(function (c) {
        out.push(h('p', { class: 'kc-banner kc-banner-info' }, h('span', { class: 'kc-banner-px', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('span', { text: fill(L().bannerScope, { c: c.title || c.channel_id }) }), h('button', { class: 'btn btn-primary kc-small', type: 'button', disabled: !!ui.waiting, onclick: function () { connect(c.channel_id); } }, ui.waiting === c.channel_id ? L().waiting : L().reconnect)));
      });
      return out;
    }

    function collectingCard(c) {
      var col = c.collecting || {};
      var pctDone = col.pct || 0;
      return h('section', { class: 'm-card kc-collect' },
        h('div', { class: 'kc-collect-head' }, h('span', { class: 'kc-collect-px', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')), h('b', { text: fill(L().collecting, { c: c.title || '' }) }), h('span', { class: 'kc-collect-pct', text: c.pending ? '' : pctv(pctDone, 0) })),
        h('span', { class: 'kc-meter-track' }, h('span', { style: 'width:' + Math.max(2, pctDone) + '%' })),
        h('p', { class: 'kc-sub', text: c.pending || !col.created ? L().collectingSoon : fill(L().collectingText, { d: dayLabel(col.created, { year: 'numeric' }) }) }));
    }

    function liveCard() {
      var head = h('span', { class: 'kc-live-actions' },
        ui.liveOpen ? h('select', { class: 'kc-select', 'aria-label': L().period, onchange: function (e) { ui.days = Number(e.target.value); refreshLive(); } },
          [[7, L().period7], [28, L().period28], [90, L().period90], [365, L().period365]].map(function (o) { return h('option', { value: String(o[0]), selected: ui.days === o[0], text: o[1] }); })) : null,
        h('button', { class: 'btn', type: 'button', 'aria-expanded': String(!!ui.liveOpen), onclick: function () { ui.liveOpen = !ui.liveOpen; if (ui.liveOpen && !live) refreshLive(); else env.rerender(); } }, ui.liveOpen ? L().hide : L().show));
      if (!ui.liveOpen) return card('kc-live is-closed', L().liveVideos, L().liveSub, null, head);
      var body;
      if (ui.liveLoading || !live) body = h('p', { class: 'muted', text: L().loading });
      else if (live.error) body = h('p', { class: 'm-error', text: live.error });
      else {
        var vids = live.videos || [];
        var cols = L().cols;
        var rows = [];
        vids.forEach(function (v) {
          rows.push(h('tr', null,
            h('td', { class: 'yc-title' }, h('a', { href: 'https://www.youtube.com/' + (v.format === 'short' ? 'shorts/' : 'watch?v=') + v.id, target: '_blank', rel: 'noopener noreferrer', text: v.title || v.id }),
              v.format ? h('span', { class: 'muted small', text: ' · ' + (v.format === 'short' ? 'Short' : v.format === 'live' ? L().live : L().long.toLowerCase()) }) : null),
            h('td', { class: 'num', text: full(v.views) }),
            h('td', { class: 'num', text: full(v.engaged_views) }),
            h('td', { class: 'num', text: pctv(v.avg_view_pct) }),
            h('td', { class: 'num', text: dur(v.avg_view_duration_s) }),
            h('td', { class: 'num', text: full(v.impressions) }),
            h('td', { class: 'num', text: pctv(v.ctr_pct) }),
            h('td', { class: 'num', text: full(v.likes) }),
            h('td', { class: 'num', text: full(v.comments) }),
            h('td', { class: 'num', text: v.subscribers_gained == null ? '–' : '+' + full(v.subscribers_gained) }),
            h('td', null, h('button', { class: 'btn btn-ghost kc-small', type: 'button', 'aria-expanded': ui.open === v.id ? 'true' : 'false', onclick: function () { toggleCurve(v.id); } }, L().retention))));
          if (ui.open === v.id) rows.push(h('tr', { class: 'yc-open' }, h('td', { colspan: String(cols.length) }, curveEl(curves[v.id]))));
        });
        body = h('div', null,
          live.reach_error ? h('p', { class: 'm-warn', text: fill(L().reachErr, { e: live.reach_error }) }) : null,
          vids.length ? h('div', { class: 'cmp-wrap' }, h('table', { class: 'cmp-table yc-table' },
            h('thead', null, h('tr', null, cols.map(function (c, i) { return h('th', { class: i && i < cols.length - 1 ? 'num' : null, text: c }); }))),
            h('tbody', null, rows))) : empty(L().noViews));
      }
      return card('kc-live', L().liveVideos, L().liveSub, body, head);
    }

    /** Retention curve: share of viewers still watching over the video (1.0 = everyone; above = rewatched). */
    function curveEl(c) {
      if (!c) return h('p', { class: 'muted', text: L().loading });
      if (c.error) return h('p', { class: 'm-error', text: c.error });
      var pts = c.points || [];
      if (!pts.length) return h('p', { class: 'muted', text: 'YouTube has no retention data for this video yet (it needs some views).' });
      var W = 600;
      var Hh = 140;
      var top = Math.max(1, Math.max.apply(null, pts.map(function (q) { return q.watch_ratio; })));
      var d = pts.map(function (q, i) { return (i ? 'L' : 'M') + (q.at * W).toFixed(1) + ' ' + (Hh - (q.watch_ratio / top) * Hh).toFixed(1); }).join(' ');
      var s = c.summary || {};
      var el = svg('svg', { viewBox: '0 0 ' + W + ' ' + Hh, class: 'yc-curve', role: 'img', 'aria-label': 'Retention: ' + Math.round((s.at_25pct || 0) * 100) + '% at a quarter, ' + Math.round((s.at_50pct || 0) * 100) + '% at half, ' + Math.round((s.end || 0) * 100) + '% at the end' },
        [0.25, 0.5, 0.75].map(function (x) { return svg('line', { x1: x * W, x2: x * W, y1: 0, y2: Hh, class: 'yc-grid' }); }).concat([svg('path', { d: d, class: 'yc-line' })]));
      var p100 = function (v) { return v == null ? '–' : Math.round(v * 100) + '%'; };
      return h('div', { class: 'yc-curve-wrap' }, el,
        h('p', { class: 'muted small', text: '25 %: ' + p100(s.at_25pct) + ' · 50 %: ' + p100(s.at_50pct) + ' · 75 %: ' + p100(s.at_75pct) + ' · 100 %: ' + p100(s.end) +
          (s.steepest_drop ? ' · ▼ ' + Math.round(s.steepest_drop.at * 100) + ' %' : '') }));
    }

    function setupCard() {
      return h('section', { class: 'm-card' },
        h('h2', { text: L().setupTitle }),
        h('p', { class: 'muted', text: L().setupText }),
        h('ol', { class: 'yc-steps' }, L().setupSteps.map(function (s) { return h('li', { text: s }); })),
        h('p', { class: 'muted small', text: L().setupMore }));
    }
    function connectCard() {
      return h('section', { class: 'm-card' },
        h('h2', { text: L().connectTitle }),
        h('p', { class: 'muted', text: L().connectText }),
        h('div', { class: 'm-actions' }, h('button', { class: 'btn btn-primary', type: 'button', disabled: !!ui.waiting, onclick: function () { connect(); } }, ui.waiting ? L().waiting : L().connectBtn)),
        h('p', { class: 'm-msg', 'aria-live': 'polite', text: ui.msg }));
    }
    function skeleton() {
      return h('div', { class: 'kc-skel', 'aria-busy': 'true', 'aria-label': L().loading },
        h('div', { class: 'kc-skel-kpis' }, [0, 1, 2, 3, 4].map(function () { return h('i'); })),
        h('div', { class: 'kc-grid' }, h('div', { class: 'kc-col' }, h('i', { class: 'kc-skel-card is-tall' }), h('i', { class: 'kc-skel-card' })), h('div', { class: 'kc-col' }, h('i', { class: 'kc-skel-card' }), h('i', { class: 'kc-skel-card' }))));
    }

    // ---- render ------------------------------------------------------------------------------
    function render(main) {
      main.classList.remove('has-panel');
      main.textContent = '';
      flags = F && F.flags ? F.flags() : flags;
      var connected = st && st.ok && st.connected;
      var chans = own && own.ok ? own.channels || [] : (st && st.channels || []).map(function (c) { return Object.assign({}, c, { subs: c.subscribers }); });
      var p = own && own.ok ? own.page : null;
      var cur = p && p.channel_id !== 'all' ? chans.filter(function (c) { return c.channel_id === p.channel_id; })[0] || p : null;
      var titleText = !connected ? L().title : p && p.combined ? L().combined : (cur && cur.title) || (st.channel && st.channel.title) || L().title;
      var subBits = [];
      if (!st) subBits.push(L().loading);
      else if (p) {
        var subs = p.totals && p.totals.subs;
        if (subs != null) subBits.push(subs === 1 ? L().subs1 : fill(L().subsN, { n: full(subs) }));
        if (p.combined) subBits.push(fill(L().channelsN, { n: chans.length }));
        if (p.data_through) subBits.push(fill(L().through, { d: dayLabel(p.data_through) }));
      } else if (ui.loading) subBits.push(L().loading);
      var switcher = null;
      if (connected && chans.length > 1) {
        var opts = chans.map(function (c) { return [c.channel_id, c.title || c.channel_id]; }).concat([['all', L().combined]]);
        var curId = own && own.channel || ui.channel;
        switcher = chans.length <= 3
          ? h('div', { class: 'seg kc-switch', role: 'group', 'aria-label': L().channels }, opts.map(function (o) {
            var c = chans.filter(function (x) { return x.channel_id === o[0]; })[0];
            return h('button', { type: 'button', 'aria-pressed': String(curId === o[0]), onclick: function () { pick(o[0]); } }, c ? avatar(c, 'is-tiny') : h('span', { class: 'kc-sum', 'aria-hidden': 'true', text: 'Σ' }), h('span', { class: 'kc-switch-name', text: o[1] }));
          }))
          : h('select', { class: 'kc-select', 'aria-label': L().channels, onchange: function (e) { pick(e.target.value); } }, opts.map(function (o) { return h('option', { value: o[0], selected: curId === o[0], text: o[1] }); }));
      }
      main.appendChild(h('div', { class: 'view-head kc-head' },
        connected && cur && !p.combined ? avatar(cur, 'is-head') : null,
        h('h1', { text: titleText }),
        h('span', { class: 'sub', text: subBits.join(' · ') }),
        connected ? h('span', { class: 's-head-actions' },
          own && own.ok && own.page ? h('button', { class: 'btn btn-ghost', type: 'button', title: L().collect, onclick: collectNow }, L().collect) : null,
          h('button', { class: 'btn', type: 'button', disabled: ui.loading, onclick: refreshAll }, ui.loading ? L().loading : L().refresh)) : null));
      if (switcher) main.appendChild(h('div', { class: 'kc-switch-row' }, switcher));
      if (!st) { load().then(env.rerender); return; }
      if (!st.ok) {
        main.appendChild(st.noBridge
          ? h('section', { class: 'm-card s-narrow' }, h('h2', { text: L().title }), h('p', { class: 'muted', text: L().noBridge }), h('p', { class: 'muted small', text: L().install }), h('pre', { class: 'set-code', text: 'sh mcp/launchd/install.sh' }))
          : h('p', { class: 'm-error', role: 'status', text: errText(st) }));
        return;
      }
      if (!st.configured) { main.appendChild(h('div', { class: 's-narrow' }, setupCard())); return; }
      if (!connected) { main.appendChild(h('div', { class: 's-narrow' }, connectCard())); return; }
      if (!own) { main.appendChild(skeleton()); if (!ui.loading) loadOwn(); return; }
      banners(chans).forEach(function (el) { main.appendChild(el); });
      if (!own.ok) {
        main.appendChild(h('p', { class: own.oldBridge ? 'ft-warn kc-banner' : 'm-error', role: 'status', text: own.oldBridge ? L().oldBridge : errText(own) }));
        // What still works without the stored history: the live table (opened right away) and the channel list.
        if (!ui.liveOpen) { ui.liveOpen = true; refreshLive(); }
        main.appendChild(h('div', { class: 'kc-grid' }, h('div', { class: 'kc-col' }, liveCard()), h('div', { class: 'kc-col kc-side' }, channelsCard(chans, true))));
        return;
      }
      var loadingOnes = chans.filter(function (c) { return c.pending || (c.collecting && !c.collecting.backfill_done); });
      if (!p) {
        loadingOnes.forEach(function (c) { main.appendChild(collectingCard(c)); });
        main.appendChild(h('div', { class: 'kc-grid' }, h('div', { class: 'kc-col' }, liveCard()), h('div', { class: 'kc-col kc-side' }, channelsCard(chans))));
        return;
      }
      loadingOnes.filter(function (c) { return p.combined || c.channel_id === p.channel_id; }).forEach(function (c) { main.appendChild(collectingCard(c)); });
      main.appendChild(kpis(p));
      if (p.combined) {
        main.appendChild(h('div', { class: 'kc-grid' },
          h('div', { class: 'kc-col' }, progressCard(p), perChannelCard(p), termsCard(p), audienceCards(p)),
          h('div', { class: 'kc-col kc-side' }, realtimeCard(p), revenueCard(p, chans), profitCard(p), channelsCard(chans))));
        return;
      }
      main.appendChild(h('div', { class: 'kc-grid' },
        h('div', { class: 'kc-col' }, progressCard(p), reportCard(p), termsCard(p), audienceCards(p), liveCard()),
        h('div', { class: 'kc-col kc-side' }, yppCard(p), realtimeCard(p), milestonesCard(p), revenueCard(p, chans), profitCard(p), channelsCard(chans))));
    }

    function title() { var p = own && own.ok && own.page; return p && p.title ? p.title + ' · ' + L().title : L().title; }
    function navLabel() { return L().nav; }

    return { load: load, render: render, title: title, navLabel: navLabel, connected: function () { return !!(st && st.connected); } };
  }

  root.OpenOutlierYouTubeChannelView = { create: create };
})(typeof self !== 'undefined' ? self : this);
