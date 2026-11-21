// OpenOutlier – phase 3's page cards on youtube.com (docs/youtube-niche-plan.md 4, 6.1):
//
//   channel page   channel-stats (age, total views, mean / median per video, uploads per month,
//                  average length, Shorts, country), channel-growth (the tracker's daily
//                  subscribers, tracked channels only), channel-monetization (5 sampled videos)
//   watch page     video-card (outlier, lifetime VPH, last-24 h VPH, engagement, the velocity
//                  curve against the channel's normal; "according to Analytics" on your own
//                  videos), video-monetization, dislikes (Return YouTube Dislike, attributed)
//   Shorts         shorts-overlay (VPH, published, channel age, the channel's average Shorts views)
//
// Each card is one shadow-DOM host placed in YouTube's own flow (under the channel header,
// under the like / share row) or, for Shorts, fixed beside the video; it reserves its height
// when it mounts, so the numbers arriving later move nothing. A switch turned off removes its
// part at once. Data helpers come from src/youtube-cards.js (self.OpenOutlierYTData).
(function () {
  'use strict';
  if (window.top !== window || window.__openoutlierYTPages) return;
  window.__openoutlierYTPages = true;

  var Y = self.OpenOutlierYouTube;
  var I = self.OpenOutlierInsights;
  var FT = self.OpenOutlierFeatures;
  var D = self.OpenOutlierYTData;
  var DS = self.OpenOutlierDiscovery; // phase 5: similar channels, the RPM estimate (src/discovery.js)
  if (!Y || !I || !FT || !D) return;

  var S = {
    en: {
      stats: 'Channel stats', age: 'Age', days: '{n} days', since: 'since {d}', total: 'Total views', mean: 'Avg / video', median: 'Median / video', perMonth: 'Uploads / month',
      avgLen: 'Avg length', shorts: 'Shorts', yes: 'Yes', no: 'No', country: 'Country', growth: 'Subscribers', growthTip: 'Daily subscribers since OpenOutlier started tracking this channel.',
      growthNone: 'Tracking started; the chart fills in daily.', growthOff: 'Track the channel for a growth chart.',
      fromSaved: 'from {n} saved videos', fromChannel: 'total views ÷ video count', recent: 'last 90 days', lifetime: 'lifetime',
      needKey: 'Add a YouTube Data API key (popup) for age, total views and country.',
      monYes: 'Monetized', monNo: 'Not monetized', monChecking: 'Checking ads…', monUnknown: 'Can\'t check ads', monShorts: 'Can\'t check: Shorts only', monMusic: 'Music video',
      monTipCh: 'Watch pages of {n} sampled videos checked for YouTube\'s ad key (yt_ad), {when}. OpenOutlier asks YouTube itself: at most 10 pages a minute, cached for 7 days. Turn off in Features.',
      monTipV: 'This video\'s watch page has YouTube\'s ad key (yt_ad) or not, checked {when}. Cached for 7 days. Turn off in Features.',
      monTipMusic: 'A music video: labels monetize these, so it says nothing about the channel.',
      monTipChecking: 'Waiting for its turn: at most 10 YouTube pages a minute.',
      outlier: 'Outlier', vph: 'Views / hour', vph24: 'Last 24 h', eng: 'Engagement', dislikes: 'Dislikes', velocity: 'Velocity',
      vphTip: 'Views ÷ hours since it was published.', vph24Tip: 'Views gained in the last 24 hours ÷ 24, from OpenOutlier\'s tracker.', vph24None: 'Tracked videos only',
      engTip: '(likes + comments) ÷ views × 100.', curveTip: 'Views at 1 h … 30 d after publishing (solid) against what this channel\'s videos usually have by then (dashed).',
      outTipMedian: 'Views ÷ the median of this channel\'s {n} saved {fmt} videos.', outTipMean: 'Views ÷ the channel\'s average views per video (total views ÷ video count).', outTipMeanLib: 'Views ÷ the average of {n} saved {fmt} videos.',
      outNone: 'Save the channel (OpenOutlier panel) or add an API key', avg: 'avg', fmtLong: 'long-form', fmtShort: 'Shorts',
      rydBy: 'via Return YouTube Dislike', rydTip: 'An estimate from Return YouTube Dislike (the video id goes to returnyoutubedislike.com). Turn off in Features.', rydFail: 'unavailable',
      own: 'YouTube Analytics', ownLine: '{views} views · {hours} h watched · {pct} viewed on average · +{subs} subscribers', ownThrough: 'through {d}',
      published: 'Published', chAge: 'Channel age', avgShorts: 'Avg Shorts views', avgShortsMean: 'avg views / video', noVph: 'waiting for exact data',
      history: 'Title & thumbnail changes', histTitle: 'Title', histThumb: 'Thumbnail', histVph: '{a} → {b} views/h', histVphPending: '{a} views/h before · after: in 24 h',
      histTip: 'Views per hour in the 24 hours before and after the change, from OpenOutlier\'s tracker.', histNoSnap: 'new image', histMore: '+{n} earlier',
      promotes: 'Promotes', promotesTip: 'Sponsor phrases, discount codes and affiliate / tracked links in this channel\'s video descriptions (rule-based scan, {n} descriptions).',
      promotesNone: 'No sponsors or affiliate links in {n} descriptions', promotesUntracked: 'Track the channel to scan its descriptions for sponsors', vids: '{n} videos', vid1: '1 video', code: 'code {c}', promotesScan: 'from {n} descriptions',
      kindSponsor: 'sponsor', kindAffiliate: 'affiliate', kindLink: 'link', kindUtm: 'tracked link', kindCode: 'code', kindDiscount: 'discount',
      similar: 'Similar channels', similarTip: 'Recommended next to this channel in the "Up Next" lists of videos you watched (counts kept on this Mac, fading over ~30 days) and channels whose titles and tags read alike.',
      simCo: 'Up Next ×{n}', simText: 'similar titles', simBoth: 'Up Next ×{n} · titles', simNone: 'Nothing yet: it learns from the "Up Next" lists of the videos you watch.', simMap: 'Channel map', simTracked: 'tracked',
      rpm: 'Est. revenue / mo', rpmEst: 'estimate', rpmSub: 'RPM ${lo}–{hi} · {cat}', rpmSubShorts: 'RPM ${lo}–{hi} · {cat} · Shorts ${slo}–{shi}', rpmNone: 'needs views per month',
      rpmTip: 'A rough estimate, not the channel\'s real revenue: {views} views a month ({basis}) × a typical RPM for {cat} (what creators earn per 1,000 views, mostly US/UK audiences). Real RPM varies 3× by country, season and topic.',
      rpmTracked: 'tracker, last {d} days', rpmLifetime: 'lifetime average', rpmRecent: 'saved uploads of the last 90 days, a floor', rpmOther: 'general',
      simThumbs: 'Similar thumbnails', simThumbsTip: 'Library videos whose thumbnails look like this one (perceptual hash), in the OpenOutlier Library.',
      title: 'OpenOutlier'
    },
    tr: {
      stats: 'Kanal istatistikleri', age: 'Yaş', days: '{n} gün', since: '{d} tarihinden beri', total: 'Toplam izlenme', mean: 'Video başına ort.', median: 'Video başına medyan', perMonth: 'Aylık yükleme',
      avgLen: 'Ort. süre', shorts: 'Shorts', yes: 'Var', no: 'Yok', country: 'Ülke', growth: 'Abone', growthTip: 'OpenOutlier bu kanalı takip etmeye başladığından beri günlük abone sayısı.',
      growthNone: 'Takip başladı; grafik her gün dolacak.', growthOff: 'Büyüme grafiği için kanalı takip et.',
      fromSaved: '{n} kayıtlı videodan', fromChannel: 'toplam izlenme ÷ video sayısı', recent: 'son 90 gün', lifetime: 'kanal ömrü',
      needKey: 'Yaş, toplam izlenme ve ülke için bir YouTube Data API anahtarı ekle (popup).',
      monYes: 'Para kazanıyor', monNo: 'Para kazanmıyor', monChecking: 'Reklam kontrol ediliyor…', monUnknown: 'Reklam kontrol edilemedi', monShorts: 'Kontrol edilemiyor: sadece Shorts', monMusic: 'Müzik videosu',
      monTipCh: '{n} örnek videonun izleme sayfasında YouTube\'un reklam anahtarı (yt_ad) arandı, {when}. OpenOutlier YouTube\'a kendisi sorar: dakikada en fazla 10 sayfa, 7 gün önbellek. Özellikler\'den kapatılabilir.',
      monTipV: 'Bu videonun izleme sayfasında YouTube\'un reklam anahtarı (yt_ad) var mı, {when} kontrol edildi. 7 gün önbellekte. Özellikler\'den kapatılabilir.',
      monTipMusic: 'Bir müzik videosu: bunları plak şirketleri para kazandırır, kanal hakkında bir şey söylemez.',
      monTipChecking: 'Sırasını bekliyor: dakikada en fazla 10 YouTube sayfası.',
      outlier: 'Outlier', vph: 'Saatlik izlenme', vph24: 'Son 24 saat', eng: 'Etkileşim', dislikes: 'Dislike', velocity: 'Hız',
      vphTip: 'İzlenme ÷ yayından beri geçen saat.', vph24Tip: 'Son 24 saatte kazanılan izlenme ÷ 24, OpenOutlier takibinden.', vph24None: 'Sadece takip edilen videolar',
      engTip: '(beğeni + yorum) ÷ izlenme × 100.', curveTip: 'Yayından 1 sa … 30 g sonraki izlenme (düz) ve bu kanalın videolarının o saatte normalde aldığı (kesik).',
      outTipMedian: 'İzlenme ÷ bu kanalın {n} kayıtlı {fmt} videosunun medyanı.', outTipMean: 'İzlenme ÷ kanalın video başına ortalama izlenmesi (toplam izlenme ÷ video sayısı).', outTipMeanLib: 'İzlenme ÷ {n} kayıtlı {fmt} videonun ortalaması.',
      outNone: 'Kanalı kaydet (OpenOutlier paneli) ya da API anahtarı ekle', avg: 'ort.', fmtLong: 'uzun', fmtShort: 'Shorts',
      rydBy: 'Return YouTube Dislike\'tan', rydTip: 'Return YouTube Dislike\'ın tahmini (video ID\'si returnyoutubedislike.com\'a gider). Özellikler\'den kapatılabilir.', rydFail: 'alınamadı',
      own: 'YouTube Analytics', ownLine: '{views} izlenme · {hours} sa izlenme süresi · ort. {pct} izlendi · +{subs} abone', ownThrough: '{d} tarihine kadar',
      published: 'Yayın', chAge: 'Kanal yaşı', avgShorts: 'Ort. Shorts izlenmesi', avgShortsMean: 'video başına ort.', noVph: 'kesin veri bekleniyor',
      history: 'Başlık ve thumbnail değişiklikleri', histTitle: 'Başlık', histThumb: 'Thumbnail', histVph: 'saatte {a} → {b} izlenme', histVphPending: 'önce saatte {a} izlenme · sonrası: 24 saatte',
      histTip: 'Değişiklikten önceki ve sonraki 24 saatte saat başına izlenme, OpenOutlier takibinden.', histNoSnap: 'yeni görsel', histMore: '+{n} önceki',
      promotes: 'Tanıttıkları', promotesTip: 'Bu kanalın video açıklamalarındaki sponsor ifadeleri, indirim kodları ve affiliate / takipli linkler (kurallarla tarama, {n} açıklama).',
      promotesNone: '{n} açıklamada sponsor ya da affiliate link yok', promotesUntracked: 'Açıklamalarını sponsorlar için taramak üzere kanalı takip et', vids: '{n} video', vid1: '1 video', code: 'kod {c}', promotesScan: '{n} açıklamadan',
      kindSponsor: 'sponsor', kindAffiliate: 'affiliate', kindLink: 'link', kindUtm: 'takipli link', kindCode: 'kod', kindDiscount: 'indirim',
      similar: 'Benzer kanallar', similarTip: 'İzlediğin videoların "Sıradaki" listelerinde bu kanalın yanında önerilenler (sayılar bu Mac\'te, ~30 günde solar) ve başlık ve etiketleri benzeyen kanallar.',
      simCo: 'Sıradaki ×{n}', simText: 'benzer başlıklar', simBoth: 'Sıradaki ×{n} · başlıklar', simNone: 'Henüz yok: izlediğin videoların "Sıradaki" listelerinden öğrenir.', simMap: 'Kanal haritası', simTracked: 'takipte',
      rpm: 'Tahmini gelir / ay', rpmEst: 'tahmin', rpmSub: 'RPM ${lo}–{hi} · {cat}', rpmSubShorts: 'RPM ${lo}–{hi} · {cat} · Shorts ${slo}–{shi}', rpmNone: 'aylık izlenme gerekli',
      rpmTip: 'Kaba bir tahmin, kanalın gerçek geliri değil: ayda {views} izlenme ({basis}) × {cat} için tipik RPM (içerik üreticisinin 1.000 izlenme başına kazancı, çoğunlukla ABD/İngiltere izleyicisi). Gerçek RPM ülkeye, mevsime ve konuya göre 3 kat değişir.',
      rpmTracked: 'takipten, son {d} gün', rpmLifetime: 'kanal ömrü ortalaması', rpmRecent: 'son 90 günün kayıtlı yüklemeleri, alt sınır', rpmOther: 'genel',
      simThumbs: 'Benzer thumbnail\'ler', simThumbsTip: 'Thumbnail\'i buna benzeyen Library videoları (perceptual hash), OpenOutlier Library\'de.',
      title: 'OpenOutlier'
    }
  };
  function lang() { return D.lang(); }
  function T() { return S[lang()]; }
  function fill(s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o[k] != null ? o[k] : m; }); }
  function ctx() { return Y.pageContext(location.pathname, location.search); }
  function dateFmt(t, lg, opts) { try { return new Intl.DateTimeFormat(lg === 'tr' ? 'tr-TR' : 'en-US', opts || { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(t)); } catch (e) { return ''; } }
  function ago(t, lg) {
    var s = (Date.now() - t) / 1000;
    var rtf;
    try { rtf = new Intl.RelativeTimeFormat(lg === 'tr' ? 'tr' : 'en', { numeric: 'auto' }); } catch (e) { return ''; }
    if (s < 3600) return rtf.format(-Math.max(1, Math.round(s / 60)), 'minute');
    if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
    if (s < 86400 * 60) return rtf.format(-Math.round(s / 86400), 'day');
    if (s < 86400 * 730) return rtf.format(-Math.round(s / 86400 / 30.44), 'month');
    return rtf.format(-Math.round(s / 86400 / 365.25), 'year');
  }
  function countryName(code, lg) { try { return new Intl.DisplayNames([lg === 'tr' ? 'tr' : 'en'], { type: 'region' }).of(code); } catch (e) { return code; } }

  // ---- shared look (YouTube's own type and surfaces, the brand's accents) -------------------------
  var CSS = [
    ':host{display:block;font:400 14px/20px Roboto,Arial,sans-serif;color:#0f0f0f;--surf:rgba(0,0,0,.05);--line:rgba(0,0,0,.1);--muted:#606060;--ink:#0B0E1A;--blue:#1E3BFF;--lime:#C8FF2E;--paper:#F6F7F2;--link:#1E3BFF;--hot-bg:#0B0E1A;--hot-fg:#C8FF2E}',
    ':host-context(html[dark]){color:#f1f1f1;--surf:rgba(255,255,255,.1);--line:rgba(255,255,255,.16);--muted:#aaa;--link:#8FA0FF;--hot-bg:#C8FF2E;--hot-fg:#0B0E1A}',
    // Cells wrap on narrow pages; each has a divider on its left, pulled 1px out so the one that starts a
    // row is clipped by the card's edge (no stray line at the start of a wrapped row).
    '.card{display:flex;flex-wrap:wrap;align-items:stretch;row-gap:10px;border-radius:12px;background:var(--surf);padding:10px 4px 10px 0;box-sizing:border-box;min-height:64px;overflow:hidden}',
    '.cell{display:flex;flex-direction:column;justify-content:center;gap:1px;padding:2px 14px;min-width:0;border-left:1px solid var(--line);margin-left:-1px}',
    '.cell:first-child{border-left:0;margin-left:0}',
    '.lb{display:flex;align-items:center;gap:5px;font-size:12px;line-height:16px;color:var(--muted);white-space:nowrap}',
    '.v{font-size:15px;line-height:22px;font-weight:500;white-space:nowrap;font-variant-numeric:tabular-nums}',
    '.v small{font-size:11.5px;font-weight:400;color:var(--muted);margin-left:4px}',
    '.v.hot{display:inline-flex;align-self:flex-start;padding:0 6px;border-radius:4px;background:var(--hot-bg);color:var(--hot-fg);font-weight:700}',
    '.v.hot small{color:inherit;opacity:.75}',
    '.sub{font-size:11.5px;line-height:15px;color:var(--muted);white-space:nowrap}',
    '.head{flex-direction:row;align-items:center;justify-content:flex-start;gap:8px;padding:0 14px 0 10px;border-left:0}',
    '.mk{width:16px;height:16px;flex:none}',
    '.ttl{font-weight:500;font-size:14px;white-space:nowrap}',
    '.mon{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px;border-radius:12px;font-size:12.5px;font-weight:500;white-space:nowrap;background:transparent;box-shadow:inset 0 0 0 1px var(--line)}',
    '.mon i{width:6px;height:6px;flex:none;background:currentColor}',
    '.mon.yes{background:var(--hot-bg);color:var(--hot-fg);box-shadow:none}',
    '.mon.no,.mon.unknown,.mon.music,.mon.shorts{color:var(--muted)}',
    '.mon.checking i{animation:oo-blink 1s steps(2,end) infinite}',
    '@keyframes oo-blink{50%{opacity:.2}}',
    '@media (prefers-reduced-motion:reduce){.mon.checking i{animation:none}}',
    '.spark{display:block;overflow:visible}',
    '.spark .a{fill:none;stroke:var(--link);stroke-width:1.75;vector-effect:non-scaling-stroke}',
    '.spark .e{fill:none;stroke:var(--muted);stroke-width:1.25;stroke-dasharray:3 3;vector-effect:non-scaling-stroke}',
    '.spark .d{fill:var(--link)}',
    '.note{flex-basis:100%;margin:6px 14px 0;font-size:12px;line-height:16px;color:var(--muted)}',
    '.note a,.lb a,.sub a{color:var(--link);text-decoration:none}.note a:hover,.lb a:hover,.sub a:hover{text-decoration:underline}',
    '.own{flex-basis:100%;display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px;margin:8px 10px 0;padding:6px 8px 0;border-top:1px solid var(--line);font-size:13px}',
    '.own b{font-weight:500}',
    '.own .sub{white-space:normal}',
    '.sk{display:inline-block;width:44px;height:12px;border-radius:3px;background:var(--line);vertical-align:middle}',
    // Phase 4: title / thumbnail history (watch card) and what the channel promotes (channel card).
    '.wide{flex-basis:100%;display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin:8px 10px 0;padding:8px 8px 0;border-top:1px solid var(--line);font-size:13px;line-height:18px;min-width:0}',
    '.wide > b{font-weight:500;white-space:nowrap}',
    '.hist{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;min-width:0;flex:1 1 100%}',
    '.hist + .hist{margin-top:2px}',
    '.hist .when{color:var(--muted);font-size:12px;white-space:nowrap;min-width:84px;font-variant-numeric:tabular-nums}',
    '.hist .fld{font-size:11px;font-weight:500;padding:0 6px;border-radius:4px;background:var(--line);line-height:18px}',
    '.hist .old{color:var(--muted);text-decoration:line-through;text-decoration-thickness:1px;overflow-wrap:anywhere}',
    '.hist .new{overflow-wrap:anywhere}',
    '.hist .arr{color:var(--muted)}',
    '.hist .vph{margin-left:auto;font-size:12px;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}',
    '.hist .vph b{font-weight:500;color:inherit}',
    '.hist .vph b.up{color:#0a7d3a}.hist .vph b.down{color:#c00}',
    ':host-context(html[dark]) .hist .vph b.up{color:#5be08c}:host-context(html[dark]) .hist .vph b.down{color:#ff7c7c}',
    '.snap{width:64px;height:36px;border-radius:4px;object-fit:cover;background:var(--line);display:block}',
    '.snap.ph{display:inline-flex;align-items:center;justify-content:center;font-size:10px;color:var(--muted)}',
    '.pr{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px;border-radius:12px;box-shadow:inset 0 0 0 1px var(--line);font-size:12.5px;white-space:nowrap}',
    '.pr b{font-weight:500}',
    '.pr small{color:var(--muted);font-size:11.5px}',
    '.wide .sub{white-space:normal}',
    // Phase 5: similar channels (channel card) and the similar-thumbnails link (watch card).
    '.sim{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px 0 4px;border-radius:13px;box-shadow:inset 0 0 0 1px var(--line);font-size:12.5px;white-space:nowrap;color:inherit;text-decoration:none;max-width:100%}',
    '.sim:hover{background:var(--line)}',
    '.sim img,.sim .av{width:18px;height:18px;border-radius:50%;flex:none;object-fit:cover;background:var(--line)}',
    '.sim b{font-weight:500;overflow:hidden;text-overflow:ellipsis}',
    '.sim small{color:var(--muted);font-size:11.5px}',
    '.wide a.more,.cell a.go{color:var(--link);text-decoration:none;font-size:12.5px;white-space:nowrap}',
    '.wide a.more:hover,.cell a.go:hover{text-decoration:underline}',
    '.cell a.go{font-size:14px;font-weight:500;line-height:22px}',
    '.est{display:inline-block;margin-left:6px;padding:0 5px;border-radius:4px;font-size:10.5px;font-weight:500;line-height:16px;vertical-align:2px;color:var(--muted);box-shadow:inset 0 0 0 1px var(--line)}',
    '@media (max-width:640px){.cell{padding:2px 10px}.v{font-size:14px}}'
  ].join('\n');
  var MARK = '<svg class="mk" viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges"><path fill="currentColor" d="M4 2h6v2H4zM2 4h2v8H2zM10 4h2v8h-2zM4 12h6v2H4z"/><path fill="#C8FF2E" d="M12 2h2v2h-2zM14 0h2v2h-2z"/></svg>';

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'class') e.className = v;
      else e.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c != null && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function cell(label, value, opts) {
    opts = opts || {};
    var lb = h('span', { class: 'lb' }, [label]);
    var v = typeof value === 'string' || value == null ? h('span', { class: 'v' + (opts.hot ? ' hot' : ''), text: value == null ? '–' : value }) : value;
    if (opts.small && v.classList) v.appendChild(h('small', { text: opts.small }));
    return h('div', { class: 'cell' + (opts.cls ? ' ' + opts.cls : ''), title: opts.tip || null }, [lb, v, opts.sub ? h('span', { class: 'sub', text: opts.sub }) : null]);
  }
  function host(name) {
    var el = document.createElement('div');
    el.className = 'openoutlier-' + name;
    el.setAttribute('data-openoutlier', name);
    var root = el.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' + CSS + '</style><div class="card"></div>';
    return { el: el, root: root, card: root.querySelector('.card'), sig: '' };
  }
  function draw(hc, sig, build) {
    if (hc.sig === sig) return;
    hc.sig = sig;
    hc.card.textContent = '';
    build(hc.card);
  }
  function sparkSvg(series, expected, w, hgt, tip) {
    var all = series.concat(expected || []).filter(function (v) { return v != null; });
    if (all.length < 2) return null;
    var lo = Math.min.apply(null, all);
    var hi = Math.max.apply(null, all);
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'spark');
    svg.setAttribute('width', w);
    svg.setAttribute('height', hgt);
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + hgt);
    svg.setAttribute('role', 'img');
    if (tip) svg.setAttribute('aria-label', tip);
    if (expected) {
      var pe = document.createElementNS(NS, 'path');
      pe.setAttribute('class', 'e');
      pe.setAttribute('d', I.sparkPath(expected, w, hgt, lo, hi));
      svg.appendChild(pe);
    }
    var d = I.sparkPath(series, w, hgt, lo, hi);
    var pa = document.createElementNS(NS, 'path');
    pa.setAttribute('class', 'a');
    pa.setAttribute('d', d);
    svg.appendChild(pa);
    var last = d.split(/[ML]/).filter(Boolean).pop();
    if (last) {
      var xy = last.trim().split(' ');
      var dot = document.createElementNS(NS, 'rect');
      dot.setAttribute('class', 'd');
      dot.setAttribute('x', (Number(xy[0]) - 2).toFixed(1));
      dot.setAttribute('y', (Number(xy[1]) - 2).toFixed(1));
      dot.setAttribute('width', '4');
      dot.setAttribute('height', '4');
      svg.appendChild(dot);
    }
    return svg;
  }

  // ---- monetization + RYD answers, shared by the cards -----------------------------------------
  var mon = {};    // 'c:UC' / 'v:id' → answer
  var monAt = {};
  function askMon(key, msg) {
    var a = mon[key];
    // Ask again while checking (the result lands in storage) at most every 20 s.
    if (a && a.state !== 'checking') return a;
    if (monAt[key] && Date.now() - monAt[key] < 20000) return a || { state: 'checking' };
    monAt[key] = Date.now();
    D.send(Object.assign({ type: 'reelscope:yt-monetization' }, msg)).then(function (r) {
      if (!r || r.ok === false) { mon[key] = { state: r && r.off ? 'off' : 'unknown' }; } else mon[key] = r;
      refresh();
    });
    return a || { state: 'checking' };
  }
  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area !== 'local' || !ch['rs:yt-mon-cache']) return;
    Object.keys(mon).forEach(function (k) { if (mon[k] && mon[k].state === 'checking') { delete mon[k]; monAt[k] = 0; } });
    refresh();
  });
  function monPill(a, L, lg, kind) {
    var st = a ? a.state : 'checking';
    var text = st === 'yes' ? L.monYes : st === 'no' ? L.monNo : st === 'music' ? L.monMusic : st === 'shorts-only' ? L.monShorts : st === 'checking' ? L.monChecking : L.monUnknown;
    var cls = st === 'shorts-only' ? 'shorts' : st;
    var when = a && a.at ? ago(a.at, lg) : '';
    var tip = st === 'checking' ? L.monTipChecking : st === 'music' ? L.monTipMusic : kind === 'channel' ? fill(L.monTipCh, { n: a && a.sampled || a && a.checked || 5, when: when }) : fill(L.monTipV, { when: when });
    return h('span', { class: 'mon ' + cls, title: tip, role: 'status' }, [h('i', {}), text]);
  }

  var ryd = {};
  function askRyd(id) {
    if (ryd[id]) return ryd[id];
    ryd[id] = { pending: true };
    D.send({ type: 'reelscope:yt-ryd', id: id }).then(function (r) { ryd[id] = r && r.ok ? r : { failed: true, off: r && r.off }; refresh(); });
    return ryd[id];
  }

  // ---- bridge answers ---------------------------------------------------------------------------
  var bridgePage = {}; // 'c:UC' / 'v:id' → answer | { none }
  function askBridge(key, msg) {
    if (bridgePage[key]) return bridgePage[key].none ? null : bridgePage[key];
    bridgePage[key] = { none: true, pending: true };
    D.send(Object.assign({ type: 'reelscope:yt-cards' }, msg)).then(function (r) {
      bridgePage[key] = r && r.ok ? r : { none: true };
      refresh();
    });
    return null;
  }

  // ---- channel page ----------------------------------------------------------------------------------
  var chCard = null;
  function channelSlot() {
    var page = D.activePage();
    return page.querySelector('[data-oo-channel-slot]') ||
      (function () {
        var head = page.querySelector('ytd-tabbed-page-header #page-header, #page-header-container > #page-header, ytd-c4-tabbed-header-renderer');
        return head ? { after: head } : null;
      })();
  }
  function channelCard() {
    var c = ctx();
    var on = c.kind === 'channel' && (FT.isOn('channel-stats') || FT.isOn('channel-growth') || FT.isOn('channel-monetization') || FT.isOn('channel-sponsors') || FT.isOn('channel-similar') || FT.isOn('channel-rpm'));
    var acct = on ? (D.lib() && D.lib().pageAccount()) || c.id : null;
    var slot = on && acct ? channelSlot() : null;
    if (!slot) { if (chCard) { chCard.el.remove(); chCard = null; } return; }
    if (!chCard) chCard = host('channel-card');
    var target = slot.after ? slot.after : slot;
    if (slot.after) { if (chCard.el.previousSibling !== target) target.after(chCard.el); }
    else if (chCard.el.parentNode !== target) target.appendChild(chCard.el);
    chCard.el.style.margin = '12px 0 4px';

    var L = T();
    var lg = lang();
    var L0 = D.lib();
    var prof = D.profileOf(acct) || {};
    var posts = L0 && L0.accounts[acct] ? Object.values(L0.accounts[acct]) : [];
    var uc = prof.channelId || (c.channelId) || (posts[0] && posts[0].ownerId) || null;
    if (uc && FT.isOn('channel-stats')) D.requestChannels([uc]);
    var info = uc ? D.channelInfo(uc) : null;
    var st = I.channelStats(posts, info || (prof.videos != null ? { videos: prof.videos } : null), Date.now());
    var growth = uc && (FT.isOn('channel-growth') || FT.isOn('channel-rpm')) ? askBridge('c:' + uc, { what: 'channel', channel: uc }) : null;
    if (uc && FT.isOn('channel-rpm') && !FT.isOn('channel-stats')) D.requestChannels([uc]);
    var sim = uc && DS && FT.isOn('channel-similar') ? askSimilar(uc) : null;
    var rpm = DS && FT.isOn('channel-rpm') ? rpmOf(posts, info, growth, prof) : null;
    var monA = null;
    if (FT.isOn('channel-monetization') && uc) {
      var smp = I.sampleVideos(posts, 5);
      monA = posts.length ? askMon('c:' + uc, { kind: 'channel', channel: uc, ids: smp.ids, shortsOnly: smp.shortsOnly }) : { state: 'checking' };
    }
    var spons = uc && FT.isOn('channel-sponsors') ? askSponsors(uc) : null;
    var sig = JSON.stringify([lg, acct, st, growth && growth.series && growth.series.length, growth && growth.tracked, monA, spons && [spons.scanned, spons.brands.length], sim && sim.similar && sim.similar.map(function (x) { return x.id; }), rpm, FT.flags(), D.noKey(), document.documentElement.hasAttribute('dark')]);
    draw(chCard, sig, function (card) {
      card.setAttribute('aria-label', L.stats);
      var head = h('div', { class: 'cell head' }, []);
      head.innerHTML = MARK;
      head.appendChild(h('span', { class: 'ttl', text: L.stats }));
      if (monA) head.appendChild(monPill(monA, L, lg, 'channel'));
      card.appendChild(head);
      if (FT.isOn('channel-stats')) {
        if (st.ageDays != null) card.appendChild(cell(L.age, fill(L.days, { n: I.full(st.ageDays, lg) }), { sub: info && info.publishedAt ? fill(L.since, { d: dateFmt(info.publishedAt, lg, { month: 'short', year: 'numeric' }) }) : null }));
        if (st.totalViews != null) card.appendChild(cell(L.total, I.compact(st.totalViews, lg), { tip: I.full(st.totalViews, lg) }));
        if (st.meanViews != null) card.appendChild(cell(L.mean, I.compact(st.meanViews, lg), { sub: st.meanFrom === 'channel' ? L.fromChannel : fill(L.fromSaved, { n: st.saved }) }));
        if (st.medianViews != null) card.appendChild(cell(L.median, I.compact(st.medianViews, lg), { sub: fill(L.fromSaved, { n: st.saved }) }));
        if (st.uploadsPerMonth != null) card.appendChild(cell(L.perMonth, I.compact(st.uploadsPerMonth, lg), { sub: st.uploadsFrom === 'recent' ? L.recent : st.uploadsFrom === 'lifetime' ? L.lifetime : fill(L.fromSaved, { n: st.saved }) }));
        if (st.avgLength != null) card.appendChild(cell(L.avgLen, I.clock(st.avgLength)));
        if (st.hasShorts != null) card.appendChild(cell(L.shorts, st.hasShorts ? L.yes : L.no));
        if (st.country) card.appendChild(cell(L.country, countryName(st.country, lg)));
      }
      if (FT.isOn('channel-growth')) {
        var g = growth && growth.series && growth.series.length ? I.growth(growth.series) : null;
        if (g && g.points.length >= 2) {
          var svg = sparkSvg(g.points.map(function (p) { return p.subs; }), null, 96, 26, L.growthTip);
          var v = h('span', { class: 'v' }, [svg || '']);
          card.appendChild(cell(L.growth, v, { tip: L.growthTip, sub: (g.subs >= 0 ? '+' : '') + I.compact(g.subs, lg) + ' · ' + fill(L.days, { n: g.days }) }));
        } else if (growth && growth.tracked) {
          card.appendChild(cell(L.growth, h('span', { class: 'v' }, [h('span', { class: 'sk' })]), { sub: L.growthNone }));
        }
      }
      if (rpm) card.appendChild(rpmCell(rpm, L, lg));
      if (FT.isOn('channel-stats') && !info && D.noKey()) card.appendChild(h('p', { class: 'note', text: L.needKey }));
      // Untracked channels without saved descriptions get no row (no clutter on every channel page).
      if (spons && (spons.brands.length || spons.tracked)) card.appendChild(sponsorRow(spons, L, lg));
      // Similar channels: shown when there is something to show, or (as a hint) on channels the tracker or the Library knows.
      if (sim && (sim.similar.length || sim.channel && (sim.channel.tracked || sim.channel.saved))) card.appendChild(similarRow(sim, L, lg));
    });
  }

  // ---- channel-similar (phase 5, mcp/discovery.mjs through the bridge) ----------------------------------
  var similar = {}; // UC → answer | { pending } | { none }
  function askSimilar(uc) {
    if (similar[uc]) return similar[uc].none || similar[uc].pending ? null : similar[uc];
    similar[uc] = { pending: true };
    D.send({ type: 'reelscope:discovery', what: 'similar', channel: uc }).then(function (r) { similar[uc] = r && r.ok ? r : { none: true }; refresh(); });
    return null;
  }
  function similarRow(sim, L, lg) {
    var row = h('div', { class: 'wide', title: L.similarTip }, [h('b', { text: L.similar })]);
    if (!sim.similar.length) { row.appendChild(h('span', { class: 'sub', text: L.simNone })); return row; }
    sim.similar.slice(0, 6).forEach(function (x) {
      var why = x.why === 'both' ? fill(L.simBoth, { n: I.full(x.seen || 0, lg) }) : x.why === 'corec' ? fill(L.simCo, { n: I.full(x.seen || 0, lg) }) : L.simText;
      var tip = [x.name, x.subs != null ? I.compact(x.subs, lg) : null, x.tracked ? L.simTracked : null, x.terms && x.terms.length ? x.terms.join(', ') : null].filter(Boolean).join(' · ');
      var av = x.thumb ? h('img', { src: x.thumb, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('span', { class: 'av' });
      row.appendChild(h('a', { class: 'sim', href: x.url, title: tip }, [av, h('b', { text: x.name }), h('small', { text: why })]));
    });
    var more = h('a', { class: 'more', href: '#', text: L.simMap + ' →' });
    more.addEventListener('click', function (e) { e.preventDefault(); try { chrome.runtime.sendMessage({ type: 'reelscope:open-dashboard', hash: '#/niche/map' }); } catch (err) { /* reloaded */ } });
    row.appendChild(more);
    return row;
  }

  // ---- channel-rpm (phase 5): category RPM × views per month, always labelled an estimate ----------------
  function rpmOf(posts, info, growth, prof) {
    var mv = DS.monthlyViews({ series: growth && growth.series, totalViews: info && info.views, createdAt: info && info.publishedAt, posts: posts, now: Date.now() });
    var cat = DS.mainCategory(posts);
    var recent = posts.filter(function (p) { return p.takenAt && Date.now() - p.takenAt < 180 * 864e5 && p.views; });
    var tot = recent.reduce(function (a, p) { return a + p.views; }, 0);
    var sh = tot ? recent.filter(function (p) { return p.type === 'short'; }).reduce(function (a, p) { return a + p.views; }, 0) / tot : 0;
    var est = DS.rpmEstimate({ category: cat, views: mv ? mv.views : null, shortsShare: sh });
    est.basis = mv;
    est.shortsShare = sh;
    return est;
  }
  function money(x, lg) { return new Intl.NumberFormat(lg === 'tr' ? 'tr-TR' : 'en-US', { notation: x >= 10000 ? 'compact' : 'standard', maximumFractionDigits: x >= 10000 ? 1 : 0 }).format(x); }
  function rpmCell(est, L, lg) {
    var cat = est.known ? est.category : L.rpmOther;
    var n = function (x) { return new Intl.NumberFormat(lg === 'tr' ? 'tr-TR' : 'en-US', { maximumFractionDigits: 2 }).format(x); };
    var sub = est.shortsShare >= 0.2 ? fill(L.rpmSubShorts, { lo: n(est.rpm[0]), hi: n(est.rpm[1]), cat: cat, slo: n(est.shortsRpm[0]), shi: n(est.shortsRpm[1]) }) : fill(L.rpmSub, { lo: n(est.rpm[0]), hi: n(est.rpm[1]), cat: cat });
    var b = est.basis;
    var basis = !b ? '' : b.basis === 'tracked' ? fill(L.rpmTracked, { d: b.days }) : b.basis === 'lifetime' ? L.rpmLifetime : L.rpmRecent;
    var v = h('span', { class: 'v' }, [est.monthly ? '$' + money(est.monthly[0], lg) + '–' + money(est.monthly[1], lg) : '–', h('span', { class: 'est', text: L.rpmEst })]);
    return cell(L.rpm, v, { tip: b ? fill(L.rpmTip, { views: I.compact(b.views, lg), basis: basis, cat: cat }) : null, sub: est.monthly ? sub : L.rpmNone });
  }

  // ---- title-history (phase 1's video_meta_log through /youtube/video-card) ---------------------------
  function snapEl(src, L) {
    return src ? h('img', { class: 'snap', src: src, alt: '', loading: 'lazy' }) : h('span', { class: 'snap ph', text: L.histNoSnap });
  }
  function historyRow(list, L, lg) {
    var row = h('div', { class: 'wide', title: L.histTip }, [h('b', { text: L.history })]);
    list.slice(0, 3).forEach(function (c) {
      var line = h('div', { class: 'hist' }, [h('span', { class: 'when', text: dateFmt(c.at, lg, { day: 'numeric', month: 'short' }) + ' · ' + ago(c.at, lg) }),
        h('span', { class: 'fld', text: c.field === 'title' ? L.histTitle : L.histThumb })]);
      if (c.field === 'title') {
        line.appendChild(h('span', { class: 'old', text: c.before || '–' }));
        line.appendChild(h('span', { class: 'arr', text: '→', 'aria-hidden': 'true' }));
        line.appendChild(h('span', { class: 'new', text: c.after || '–' }));
      } else {
        line.appendChild(snapEl(c.before_snap, L));
        line.appendChild(h('span', { class: 'arr', text: '→', 'aria-hidden': 'true' }));
        line.appendChild(snapEl(c.after_snap, L));
      }
      if (c.vph_before != null) {
        var v = h('span', { class: 'vph' });
        if (c.vph_after != null) {
          var cls = c.vph_after > c.vph_before * 1.1 ? 'up' : c.vph_after < c.vph_before * 0.9 ? 'down' : '';
          var parts = fill(L.histVph, { a: '\u0000', b: '\u0001' }).split(/\u0000|\u0001/);
          v.appendChild(document.createTextNode(parts[0]));
          v.appendChild(h('b', { text: I.compact(c.vph_before, lg) }));
          v.appendChild(document.createTextNode(parts[1]));
          v.appendChild(h('b', { class: cls, text: I.compact(c.vph_after, lg) }));
          v.appendChild(document.createTextNode(parts[2] || ''));
        } else v.textContent = fill(L.histVphPending, { a: I.compact(c.vph_before, lg) });
        line.appendChild(v);
      }
      row.appendChild(line);
    });
    if (list.length > 3) row.appendChild(h('span', { class: 'sub', text: fill(L.histMore, { n: list.length - 3 }) }));
    return row;
  }

  // ---- channel-sponsors (mcp/content.mjs through the bridge) --------------------------------------------
  var sponsors = {}; // UC → answer | { pending } | { none }
  function askSponsors(uc) {
    if (sponsors[uc]) return sponsors[uc].none || sponsors[uc].pending ? null : sponsors[uc];
    sponsors[uc] = { pending: true };
    D.send({ type: 'reelscope:yt-content', what: 'sponsors', channel: uc }).then(function (r) { sponsors[uc] = r && r.ok ? r : { none: true }; refresh(); });
    return null;
  }
  function sponsorRow(sp, L, lg) {
    var row = h('div', { class: 'wide', title: fill(L.promotesTip, { n: sp.scanned }) }, [h('b', { text: L.promotes })]);
    if (!sp.brands.length) {
      row.appendChild(h('span', { class: 'sub', text: sp.scanned ? fill(L.promotesNone, { n: I.full(sp.scanned, lg) }) : L.promotesUntracked }));
      return row;
    }
    var KIND = { sponsor: L.kindSponsor, affiliate: L.kindAffiliate, 'brand-link': L.kindLink, utm: L.kindUtm, code: L.kindCode, discount: L.kindDiscount };
    sp.brands.slice(0, 6).forEach(function (b) {
      var kinds = (b.kinds || []).filter(function (k) { return KIND[k]; }).map(function (k) { return KIND[k]; });
      var tip = [kinds.join(', '), b.codes && b.codes.length ? fill(L.code, { c: b.codes.join(', ') }) : null, b.example && b.example.text ? '“' + b.example.text + '”' : null].filter(Boolean).join('\n');
      row.appendChild(h('span', { class: 'pr', title: tip }, [h('b', { text: b.brand }), h('small', { text: b.videos === 1 ? L.vid1 : fill(L.vids, { n: I.full(b.videos, lg) }) })]));
    });
    row.appendChild(h('span', { class: 'sub', text: fill(L.promotesScan, { n: I.full(sp.scanned, lg) }) }));
    return row;
  }

  // ---- watch page -------------------------------------------------------------------------------------
  var wCard = null;
  function watchSlot() {
    var page = D.activePage();
    var s = page.querySelector('[data-oo-watch-slot]');
    if (s) return { parent: s, before: null };
    var bottom = page.querySelector('ytd-watch-metadata #above-the-fold > #bottom-row, ytd-watch-metadata #bottom-row');
    if (bottom) return { parent: bottom.parentNode, before: bottom };
    var top = page.querySelector('ytd-watch-metadata #top-row');
    return top ? { parent: top.parentNode, before: top.nextSibling } : null;
  }
  function watchCard() {
    var c = ctx();
    var on = c.kind === 'watch' && c.video && (FT.isOn('video-card') || FT.isOn('video-monetization') || FT.isOn('dislikes') || FT.isOn('title-history') || FT.isOn('channel-similar'));
    var slot = on ? watchSlot() : null;
    if (!slot) { if (wCard) { wCard.el.remove(); wCard = null; } return; }
    if (!wCard) wCard = host('watch-card');
    // Phase 4's tool row (src/youtube-tools.js) sits right after the card: that is still "in place".
    var nx = wCard.el.nextSibling;
    if (nx && nx.classList && nx.classList.contains('openoutlier-tools')) nx = nx.nextSibling;
    if (wCard.el.parentNode !== slot.parent || (slot.before && nx !== slot.before)) slot.parent.insertBefore(wCard.el, slot.before);
    wCard.el.style.margin = '12px 0 0';
    var L = T();
    var lg = lang();
    var id = c.video;
    var f = D.videoFacts(id);
    if (f.uc && FT.isOn('video-card')) D.requestChannels([f.uc]);
    var b = FT.isOn('video-card') || FT.isOn('title-history') ? askBridge('v:' + id, { what: 'video', id: id }) : null;
    var monA = FT.isOn('video-monetization') ? askMon('v:' + id, { kind: 'video', id: id }) : null;
    var dis = FT.isOn('dislikes') ? askRyd(id) : null;
    var eng = I.engagement(f.likes, f.comments, f.views);
    var hist = FT.isOn('title-history') && b && b.history && b.history.length ? b.history : null;
    var sig = JSON.stringify([lg, id, f.views, f.viewsExact, f.publishedAt, f.outlier, eng, b && [b.vph24, b.velocity, b.curve && b.curve.length, !!b.own], hist && hist.map(function (x) { return x.at; }), monA, dis, FT.flags(), Math.floor(Date.now() / 60000)]);
    draw(wCard, sig, function (card) {
      var head = h('div', { class: 'cell head', title: L.title }, []);
      head.innerHTML = MARK;
      if (monA) head.appendChild(monPill(monA, L, lg, 'video'));
      card.appendChild(head);
      if (FT.isOn('video-card')) {
        var o = f.outlier;
        var fmt = f.type === 'short' ? L.fmtShort : L.fmtLong;
        card.appendChild(o ? cell(L.outlier, I.times(o.value, lg), { hot: o.value >= I.OUTLIER, small: o.basis === 'mean' ? L.avg : null,
          tip: o.basis === 'median' ? fill(L.outTipMedian, { n: o.n, fmt: fmt }) : o.source === 'channel' ? L.outTipMean : fill(L.outTipMeanLib, { n: o.n, fmt: fmt }) })
          : cell(L.outlier, '–', { sub: L.outNone }));
        card.appendChild(cell(L.vph, f.vph ? I.vphLabel(f.vph, lg) : '–', { tip: L.vphTip, sub: f.vph ? null : L.noVph }));
        card.appendChild(cell(L.vph24, b && b.vph24 ? I.compact(b.vph24.vph, lg) + (lg === 'tr' ? '/sa' : '/h') : '–', { tip: L.vph24Tip, sub: b && b.vph24 ? null : L.vph24None }));
        card.appendChild(cell(L.eng, eng != null ? I.pct(eng, lg) : '–', { tip: L.engTip }));
        if (b && b.curve && b.curve.length >= 2) {
          var svg = sparkSvg(b.curve.map(function (p) { return p.views; }), b.curve.map(function (p) { return p.expected; }), 104, 26, L.curveTip);
          var vv = h('span', { class: 'v' }, [svg || '']);
          card.appendChild(cell(L.velocity, vv, { tip: L.curveTip, sub: b.velocity ? I.cpLabel(b.velocity.hours, lg) + ': ' + I.times(b.velocity.score, lg) : null }));
        }
      }
      if (dis && !dis.off) {
        var lb = h('span', { class: 'lb' }, [L.dislikes]);
        var val = h('span', { class: 'v', text: dis.pending ? '' : dis.failed ? '–' : I.compact(dis.dislikes, lg) });
        if (dis.pending) val.appendChild(h('span', { class: 'sk' }));
        var link = h('a', { href: 'https://returnyoutubedislike.com/', target: '_blank', rel: 'noopener noreferrer', text: dis.failed ? L.rydFail : L.rydBy });
        card.appendChild(h('div', { class: 'cell', title: L.rydTip }, [lb, val, h('span', { class: 'sub' }, [link])]));
      }
      if (FT.isOn('channel-similar')) {
        var go = h('a', { class: 'go', href: '#', text: L.simThumbs + ' →' });
        go.addEventListener('click', function (e) { e.preventDefault(); try { chrome.runtime.sendMessage({ type: 'reelscope:open-dashboard', hash: '#/niche/thumbs/' + id }); } catch (err) { /* reloaded */ } });
        card.appendChild(h('div', { class: 'cell', title: L.simThumbsTip }, [h('span', { class: 'lb' }, ['Library']), go]));
      }
      if (hist) card.appendChild(historyRow(hist, L, lg));
      var own = b && b.own;
      if (FT.isOn('video-card') && own && own.days) {
        card.appendChild(h('div', { class: 'own' }, [h('b', { text: L.own }),
          h('span', { text: fill(L.ownLine, { views: I.full(own.views, lg), hours: I.compact(own.watch_hours, lg), pct: own.avg_pct != null ? I.pct(own.avg_pct, lg) : '–', subs: I.full(own.subs_gained, lg) }) }),
          own.through ? h('span', { class: 'sub', text: fill(L.ownThrough, { d: dateFmt(Date.parse(own.through + 'T12:00:00Z'), lg) }) }) : null]));
      }
    });
  }

  // ---- Shorts -----------------------------------------------------------------------------------------
  var sCard = null;
  function shortsVideo() {
    var list = document.querySelectorAll('ytd-shorts video, #shorts-player video, [data-oo-short-player] video');
    var best = null;
    var bestA = 0;
    for (var i = 0; i < list.length; i++) {
      var r = list[i].getBoundingClientRect();
      var a = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
      if (a > bestA) { bestA = a; best = list[i]; }
    }
    return bestA > 20000 ? best : null;
  }
  var SHORTS_CSS = [
    ':host{position:fixed;z-index:2000;width:196px;pointer-events:auto}',
    '.card{flex-direction:column;flex-wrap:nowrap;padding:8px 0;border-radius:12px;background:rgba(255,255,255,.92);box-shadow:0 1px 2px rgba(0,0,0,.08),0 0 0 1px rgba(0,0,0,.06)}',
    ':host-context(html[dark]) .card{background:rgba(33,33,33,.92);box-shadow:0 0 0 1px rgba(255,255,255,.08)}',
    '.cell{border-left:0;margin-left:0;border-top:1px solid var(--line);padding:6px 12px}',
    '.cell:first-child{border-top:0}',
    '.head{padding:2px 12px 6px}',
    ':host(.compact){width:auto;max-width:calc(100vw - 24px)}',
    ':host(.compact) .card{flex-direction:row;flex-wrap:wrap;row-gap:4px;padding:4px 0;min-height:0;background:rgba(11,14,26,.78);color:#F6F7F2;box-shadow:none;--muted:#C3C9E0;--line:rgba(246,247,242,.18)}',
    ':host(.compact) .cell{border-top:0;border-left:1px solid var(--line);margin-left:-1px;padding:0 8px}',
    ':host(.compact) .cell:first-child{border-left:0}',
    ':host(.compact) .v{font-size:13px;line-height:18px}',
    ':host(.compact) .lb{font-size:10.5px;line-height:13px}',
    ':host(.compact) .sub,:host(.compact) .head{display:none}'
  ].join('\n');
  function shortsCard() {
    var c = ctx();
    var on = c.kind === 'short' && c.video && FT.isOn('shorts-overlay');
    var v = on ? shortsVideo() : null;
    if (!v) { if (sCard) { sCard.el.remove(); sCard = null; } return; }
    if (!sCard) {
      sCard = host('shorts-card');
      var st = document.createElement('style');
      st.textContent = SHORTS_CSS;
      sCard.root.appendChild(st);
      document.documentElement.appendChild(sCard.el);
    }
    var r = v.getBoundingClientRect();
    var room = r.left;
    var compact = room < 212;
    sCard.el.classList.toggle('compact', compact);
    if (compact) {
      // Narrow window: one line over the top of the video, under YouTube's play / volume row.
      sCard.el.style.left = Math.max(8, r.left + 12) + 'px';
      sCard.el.style.top = Math.max(8, r.top + 56) + 'px';
      sCard.el.style.right = 'auto';
      sCard.el.style.maxWidth = Math.max(160, r.width - 24) + 'px';
    } else {
      sCard.el.style.left = Math.max(8, r.left - 196 - 16) + 'px';
      sCard.el.style.top = Math.max(64, r.top) + 'px';
      sCard.el.style.maxWidth = '';
    }
    var L = T();
    var lg = lang();
    var f = D.videoFacts(c.video);
    if (f.uc) D.requestChannels([f.uc]);
    var info = f.uc ? D.channelInfo(f.uc) : null;
    var base = D.baselineOf(f.acct);
    var sb = base && base.short;
    var avgShorts = sb && sb.mean ? { v: sb.mean, sub: fill(L.fromSaved, { n: sb.n }) } : info ? { v: I.channelMean(info.views, info.videos), sub: L.avgShortsMean } : null;
    var sig = JSON.stringify([lg, c.video, f.vph, f.publishedAt, f.dateExact, info && info.publishedAt, avgShorts, compact, document.documentElement.hasAttribute('dark')]);
    draw(sCard, sig, function (card) {
      var head = h('div', { class: 'cell head' }, []);
      head.innerHTML = MARK;
      head.appendChild(h('span', { class: 'ttl', text: L.title }));
      card.appendChild(head);
      card.appendChild(cell(L.vph, f.vph ? I.vphLabel(f.vph, lg) : '–', { tip: L.vphTip, sub: f.vph ? null : L.noVph }));
      card.appendChild(cell(L.published, f.publishedAt ? (f.dateExact ? '' : '≈') + ago(f.publishedAt, lg) : '–', { sub: f.publishedAt && f.dateExact ? dateFmt(f.publishedAt, lg, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null }));
      var age = info && info.publishedAt ? Math.floor((Date.now() - info.publishedAt) / I.DAY) : null;
      card.appendChild(cell(L.chAge, age != null ? fill(L.days, { n: I.full(age, lg) }) : '–', { sub: age == null && D.noKey() ? L.needKey.split(' (')[0] : null }));
      card.appendChild(cell(L.avgShorts, avgShorts && avgShorts.v != null ? I.compact(avgShorts.v, lg) : '–', { sub: avgShorts ? avgShorts.sub : null }));
    });
  }

  // ---- loop --------------------------------------------------------------------------------------------
  var queued = false;
  function refresh() {
    if (queued) return;
    queued = true;
    // A timeout, not requestAnimationFrame: a tab opened in the background gets its cards too.
    setTimeout(function () {
      queued = false;
      try { channelCard(); } catch (e) { console.warn('[OpenOutlier] channel card failed', e); }
      try { watchCard(); } catch (e) { console.warn('[OpenOutlier] watch card failed', e); }
      try { shortsCard(); } catch (e) { console.warn('[OpenOutlier] Shorts card failed', e); }
    }, 40);
  }
  var lastUrl = location.href;
  function onNav() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (chCard) chCard.sig = '';
      if (wCard) wCard.sig = '';
    }
    refresh();
  }
  FT.ready.then(function () {
    D.onData(refresh);
    FT.onChange(function () { if (chCard) chCard.sig = ''; if (wCard) wCard.sig = ''; if (sCard) sCard.sig = ''; refresh(); });
    document.addEventListener('yt-navigate-finish', onNav);
    window.addEventListener('resize', refresh);
    window.addEventListener('scroll', function () { if (sCard) refresh(); }, { passive: true });
    setInterval(onNav, 700);
    refresh();
  });
})();
