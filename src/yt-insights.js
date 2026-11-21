// OpenOutlier – phase 3's numbers for the in-page badges and cards (docs/youtube-niche-plan.md,
// sections 4–6.1). Pure functions only: no DOM, no chrome.*, no network. Used by the content
// scripts (src/youtube-cards.js, src/youtube-pages.js), the service worker
// (src/youtube-insights-bg.js) and the tests.
//
// Formulas (NexLev's, confirmed from its code, plus ours):
//   VPH       = views ÷ hours since publish (lifetime). Marked approximate ("≈") when the views
//               are rounded ("63K") or the date is relative ("3 weeks ago").
//   Outlier   = views ÷ the channel's median views (ours, the default, saved channels only)
//               or views ÷ the channel's mean views per video = total views ÷ video count (NexLev).
//   Engagement = (likes + comments) ÷ views × 100, capped at 100.
//   Monetized = the watch page HTML contains [{"key":"yt_ad","value":" ; a channel check samples
//               5 videos (index 0, 25 %, 50 %, 75 %, last). A music video (the "Music" header) says
//               nothing about the channel (labels monetize those).
'use strict';

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpenOutlierInsights = api;
})(typeof self !== 'undefined' ? self : this, function () {
  var HOUR = 36e5;
  var DAY = 864e5;
  var FRESH_MS = 72 * HOUR;
  var OUTLIER = 2;
  var MIN_BASELINE = 5;

  // ---- basic numbers ------------------------------------------------------------------
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  function median(list) {
    var a = (list || []).filter(function (v) { return num(v) != null; }).sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function mean(list) {
    var a = (list || []).filter(function (v) { return num(v) != null; });
    return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : null;
  }

  /**
   * Lifetime views per hour. v: { views, viewsApprox, takenAt|publishedAt, dateApprox }.
   * The first hour counts as one hour (a 5-minute-old video isn't "12× faster"), and a video can't
   * be older than its relative label says it was rounded to. → { value, approx } or null.
   */
  function vph(v, now) {
    if (!v) return null;
    var views = num(v.views);
    var at = num(v.publishedAt != null ? v.publishedAt : v.takenAt);
    if (views == null || at == null) return null;
    now = now || Date.now();
    var hours = Math.max(1, (now - at) / HOUR);
    return { value: views / hours, approx: !!v.viewsApprox || v.dateApprox !== false };
  }

  /** NexLev's channel mean: total views ÷ video count. */
  function channelMean(totalViews, videoCount) {
    var t = num(totalViews);
    var n = num(videoCount);
    return t != null && n > 0 ? t / n : null;
  }

  /** views ÷ base, or null. */
  function ratio(views, base) {
    var v = num(views);
    var b = num(base);
    return v != null && b > 0 ? v / b : null;
  }

  /** (likes + comments) ÷ views × 100, capped at 100; null without views or without both counts. */
  function engagement(likes, comments, views) {
    var v = num(views);
    if (!(v > 0) || (num(likes) == null && num(comments) == null)) return null;
    return Math.min(100, ((num(likes) || 0) + (num(comments) || 0)) / v * 100);
  }

  /**
   * A channel's normal per format from saved videos (the Library's rules: pinned videos and
   * videos under 72 hours don't define normal). posts: records of ONE channel.
   * → { long: { median, mean, n }, short: { … } } (median null under MIN_BASELINE videos)
   */
  function libraryBaseline(posts, now) {
    now = now || Date.now();
    var g = { long: [], short: [] };
    (posts || []).forEach(function (p) {
      if (!p || !(num(p.views) >= 0) || p.pinned || p.liveNow) return;
      if (p.takenAt && now - p.takenAt < FRESH_MS && now >= p.takenAt) return;
      g[p.type === 'short' ? 'short' : 'long'].push(p.views);
    });
    function one(list) { return { median: list.length >= MIN_BASELINE ? median(list) : null, mean: list.length >= MIN_BASELINE ? mean(list) : null, n: list.length }; }
    return { long: one(g.long), short: one(g.short) };
  }

  /**
   * The outlier for one card. formula: 'median' (default) | 'mean'.
   * lib: libraryBaseline(...) of the card's channel (or null); ch: cached channels.list facts
   * ({ views, videos }) or null; type: 'short' | 'video' | 'live'.
   * → { value, basis: 'median'|'mean', source: 'library'|'channel', base } or null.
   * Median exists only for saved channels; without one the mean (channels.list) stands in,
   * labelled as such. With formula 'mean' the channel's total ÷ count comes first (NexLev's number),
   * the saved videos' mean second.
   */
  function outlier(views, type, formula, lib, ch) {
    var fmt = type === 'short' ? 'short' : 'long';
    var L = lib && lib[fmt];
    var chMean = ch ? channelMean(ch.views, ch.videos) : null;
    var pick = null;
    if (formula !== 'mean' && L && L.median > 0) pick = { basis: 'median', source: 'library', base: L.median };
    else if (chMean > 0) pick = { basis: 'mean', source: 'channel', base: chMean };
    else if (L && L.mean > 0) pick = { basis: 'mean', source: 'library', base: L.mean };
    if (!pick) return null;
    var r = ratio(views, pick.base);
    if (r == null) return null;
    pick.value = r;
    return pick;
  }

  // ---- monetization (yt_ad) -------------------------------------------------------------
  var YT_AD = '[{"key":"yt_ad","value":"';
  var MUSIC_RE = /"richListHeaderRenderer"\s*:\s*\{[\s\S]{0,600}?"title"\s*:\s*\{\s*"(?:simpleText|runs)"\s*:\s*(?:"Music"|\[\s*\{\s*"text"\s*:\s*"Music")/;

  /**
   * A watch page's HTML → { state: 'yes'|'no'|'music'|'unknown', reason }.
   *   yes:     the ad key is in the page;
   *   music:   a music video (YouTube's "Music" section header): labels monetize these, so it says
   *            nothing about the channel;
   *   no:      a real watch page without the ad key;
   *   unknown: not a watch page (consent / sign-in / error page, or nothing).
   */
  function monetizationFromHtml(html) {
    var s = typeof html === 'string' ? html : '';
    if (!s) return { state: 'unknown', reason: 'empty' };
    if (/consent\.youtube\.com|action="https:\/\/consent\./.test(s) && s.indexOf('ytInitialPlayerResponse') === -1) return { state: 'unknown', reason: 'consent' };
    var watch = s.indexOf('ytInitialPlayerResponse') !== -1 || s.indexOf('"videoDetails"') !== -1;
    if (!watch) return { state: 'unknown', reason: 'not-a-watch-page' };
    if (s.indexOf('"playabilityStatus":{"status":"ERROR"') !== -1 || s.indexOf('"playabilityStatus":{"status":"LOGIN_REQUIRED"') !== -1) return { state: 'unknown', reason: 'unplayable' };
    if (MUSIC_RE.test(s)) return { state: 'music', reason: 'music' };
    if (s.indexOf(YT_AD) !== -1) return { state: 'yes', reason: 'yt_ad' };
    return { state: 'no', reason: 'no-yt_ad' };
  }

  /** The indexes NexLev samples from n videos: 0, 25 %, 50 %, 75 %, last (unique, sorted). */
  function sampleIndices(n) {
    if (!(n > 0)) return [];
    var out = [];
    [0, 0.25, 0.5, 0.75].forEach(function (f) { var i = Math.floor((n - 1) * f); if (out.indexOf(i) === -1) out.push(i); });
    if (out.indexOf(n - 1) === -1) out.push(n - 1);
    return out.sort(function (a, b) { return a - b; });
  }

  /**
   * The videos a channel check samples: long-form first (Shorts never carry the yt_ad key in the
   * same way), newest to oldest, 5 picks. posts: one channel's records. → { ids, shortsOnly }.
   */
  function sampleVideos(posts, count) {
    count = count || 5;
    var all = (posts || []).filter(function (p) { return p && /^[A-Za-z0-9_-]{11}$/.test(String(p.code || '')) && !p.membersOnly && !p.liveNow; });
    var longs = all.filter(function (p) { return p.type !== 'short'; })
      .sort(function (a, b) { return (b.takenAt || 0) - (a.takenAt || 0); });
    if (!longs.length) return { ids: [], shortsOnly: all.length > 0 };
    var idx = sampleIndices(longs.length);
    if (longs.length >= count && idx.length < count) idx = idx.slice(0, count);
    return { ids: idx.map(function (i) { return longs[i].code; }).slice(0, count), shortsOnly: false };
  }

  /** A channel's verdict from its sampled videos' states. → { state: 'yes'|'no'|'music'|'unknown', checked, yes } */
  function channelVerdict(states) {
    var list = states || [];
    var yes = list.filter(function (s) { return s === 'yes'; }).length;
    var no = list.filter(function (s) { return s === 'no'; }).length;
    var music = list.filter(function (s) { return s === 'music'; }).length;
    var state = yes ? 'yes' : no ? 'no' : music ? 'music' : 'unknown';
    return { state: state, checked: yes + no + music, yes: yes };
  }

  // ---- caches and the rate limiter --------------------------------------------------------
  /** A value from a { key: { at, v } } map unless older than ttl ms. */
  function cacheGet(map, key, ttl, now) {
    var e = map && map[key];
    if (!e || typeof e.at !== 'number') return undefined;
    if ((now || Date.now()) - e.at > ttl) return undefined;
    return e.v;
  }
  /** A new map with key set; expired entries dropped and at most max entries kept (newest win). */
  function cachePut(map, key, value, ttl, now, max) {
    now = now || Date.now();
    var out = {};
    var keys = Object.keys(map || {}).filter(function (k) { var e = map[k]; return e && typeof e.at === 'number' && now - e.at <= ttl && k !== key; });
    keys.sort(function (a, b) { return map[b].at - map[a].at; });
    if (max) keys = keys.slice(0, Math.max(0, max - 1));
    keys.forEach(function (k) { out[k] = map[k]; });
    out[key] = { at: now, v: value };
    return out;
  }

  /**
   * Sliding-window limit: at most max events per windowMs. times: the past events (ms).
   * → ms to wait before the next one (0 = now).
   */
  function waitFor(times, now, max, windowMs) {
    var recent = (times || []).filter(function (t) { return now - t < windowMs; }).sort(function (a, b) { return a - b; });
    if (recent.length < max) return 0;
    return Math.max(0, recent[recent.length - max] + windowMs - now);
  }
  /** A serial limiter: run(fn) resolves fn's result, starting each call only when the window allows. */
  function limiter(opts) {
    var max = opts.max || 10;
    var windowMs = opts.windowMs || 60000;
    var clock = opts.now || Date.now;
    var wait = opts.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var times = [];
    var chain = Promise.resolve();
    function run(fn) {
      var p = chain.then(async function () {
        var w;
        while ((w = waitFor(times, clock(), max, windowMs)) > 0) await wait(w);
        times.push(clock());
        times = times.filter(function (t) { return clock() - t < windowMs; });
        return fn();
      });
      chain = p.catch(function () {});
      return p;
    }
    return { run: run, pending: function () { return times.length; } };
  }

  // ---- feed filters -------------------------------------------------------------------------
  var LENGTHS = {
    any: null,
    under4: [0, 240],
    '4to20': [240, 1200],
    over20: [1200, Infinity]
  };
  function defaultFilters() {
    return { minOutlier: null, minVph: null, length: 'any', minViews: null, maxAgeDays: null, minViewsPerSub: null, noShorts: false };
  }
  function activeFilters(f) {
    f = f || {};
    var n = 0;
    ['minOutlier', 'minVph', 'minViews', 'maxAgeDays', 'minViewsPerSub'].forEach(function (k) { if (num(f[k]) != null && f[k] > 0) n++; });
    if (f.length && f.length !== 'any') n++;
    if (f.noShorts) n++;
    return n;
  }
  /**
   * Does a card pass? item: { outlier, vph, duration, views, publishedAt, subs, type }.
   * → { ok, missing: [criteria with no data] }. A criterion without data fails (so "≥ 2×" never
   * shows a card nobody could score) and is reported, so the panel can say why.
   */
  function matchItem(item, f, now) {
    f = f || {};
    item = item || {};
    now = now || Date.now();
    var missing = [];
    var ok = true;
    function need(k, val, test) {
      if (val == null) { missing.push(k); ok = false; return; }
      if (!test(val)) ok = false;
    }
    if (f.noShorts && item.type === 'short') ok = false;
    if (num(f.minOutlier) > 0) need('outlier', num(item.outlier), function (v) { return v >= f.minOutlier; });
    if (num(f.minVph) > 0) need('vph', num(item.vph), function (v) { return v >= f.minVph; });
    if (num(f.minViews) > 0) need('views', num(item.views), function (v) { return v >= f.minViews; });
    if (num(f.maxAgeDays) > 0) need('date', num(item.publishedAt), function (t) { return now - t <= f.maxAgeDays * DAY; });
    var range = LENGTHS[f.length];
    if (range) {
      if (item.type === 'short') { if (range[0] !== 0) ok = false; }
      else need('length', num(item.duration), function (d) { return d >= range[0] && d < range[1]; });
    }
    if (num(f.minViewsPerSub) > 0) {
      var vps = num(item.views) != null && num(item.subs) > 0 ? item.views / item.subs : null;
      need('subs', vps, function (v) { return v >= f.minViewsPerSub; });
    }
    return { ok: ok, missing: missing };
  }

  // ---- channel stats -----------------------------------------------------------------------
  /**
   * The channel card's facts. posts: the channel's saved videos; info: cached channels.list
   * ({ views, videos, subscribers, publishedAt, country }) or null.
   * → { ageDays, totalViews, meanViews, meanFrom, medianViews, uploadsPerMonth, uploadsFrom,
   *     avgLength, hasShorts, country, saved }
   */
  function channelStats(posts, info, now) {
    now = now || Date.now();
    info = info || {};
    posts = (posts || []).filter(Boolean);
    var views = posts.map(function (p) { return p.views; }).filter(function (v) { return num(v) != null; });
    var longs = posts.filter(function (p) { return p.type !== 'short'; });
    var shorts = posts.filter(function (p) { return p.type === 'short'; });
    var lens = longs.map(function (p) { return p.duration; }).filter(function (d) { return num(d) > 0; });
    var cm = channelMean(info.views, info.videos);
    var age = num(info.publishedAt) ? Math.floor((now - info.publishedAt) / DAY) : null;
    var dated = posts.filter(function (p) { return num(p.takenAt) && p.takenAt <= now; });
    var per = null;
    var from = null;
    if (dated.length >= 2) {
      var oldest = Math.min.apply(null, dated.map(function (p) { return p.takenAt; }));
      if (now - oldest >= 90 * DAY) {
        per = dated.filter(function (p) { return now - p.takenAt <= 90 * DAY; }).length / (90 / 30.44);
        from = 'recent';
      } else if (now - oldest >= 14 * DAY) {
        per = dated.length / ((now - oldest) / (30.44 * DAY));
        from = 'saved';
      }
    }
    if (per == null && age > 30 && num(info.videos) != null) { per = info.videos / (age / 30.44); from = 'lifetime'; }
    return {
      ageDays: age,
      totalViews: num(info.views),
      meanViews: cm != null ? cm : (views.length ? mean(views) : null),
      meanFrom: cm != null ? 'channel' : views.length ? 'saved' : null,
      medianViews: views.length >= MIN_BASELINE ? median(longs.length >= MIN_BASELINE ? longs.map(function (p) { return p.views; }) : views) : null,
      uploadsPerMonth: per,
      uploadsFrom: from,
      avgLength: lens.length ? mean(lens) : null,
      hasShorts: shorts.length ? true : info.hasShorts != null ? !!info.hasShorts : null,
      country: info.country || null,
      videos: num(info.videos),
      saved: posts.length
    };
  }

  /** Growth from channel_stats rows ([{ day, subs, views }], oldest first) → { points, subs, views, days }. */
  function growth(rows) {
    var list = (rows || []).filter(function (r) { return r && r.day; });
    if (!list.length) return null;
    var first = list[0];
    var last = list[list.length - 1];
    function d(k) { return num(last[k]) != null && num(first[k]) != null ? last[k] - first[k] : null; }
    return { points: list, subs: d('subs'), views: d('views'), days: Math.round((Date.parse(last.day) - Date.parse(first.day)) / DAY), last: last };
  }

  /** An SVG path through values (nulls skipped) in a w × h box. → '' when fewer than 2 values. */
  function sparkPath(values, w, h, lo, hi) {
    var pts = [];
    (values || []).forEach(function (v, i) { if (num(v) != null) pts.push([i, v]); });
    if (pts.length < 2) return '';
    var n = values.length - 1 || 1;
    if (lo == null) lo = Math.min.apply(null, pts.map(function (p) { return p[1]; }));
    if (hi == null) hi = Math.max.apply(null, pts.map(function (p) { return p[1]; }));
    var span = hi - lo || 1;
    return pts.map(function (p, i) {
      var x = (p[0] / n) * w;
      var y = h - 1 - ((p[1] - lo) / span) * (h - 2);
      return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }).join(' ');
  }

  // ---- labels (TR / EN) ----------------------------------------------------------------------
  var fmtCache = {};
  function nf(lang, opts) {
    var k = lang + JSON.stringify(opts);
    return fmtCache[k] || (fmtCache[k] = new Intl.NumberFormat(lang === 'tr' ? 'tr-TR' : 'en-US', opts));
  }
  /** 1234 → "1.2K" / "1,2 B". */
  function compact(n, lang) {
    if (num(n) == null) return '–';
    return nf(lang, { notation: 'compact', maximumFractionDigits: Math.abs(n) < 10 ? 1 : n < 1e3 ? 0 : 1 }).format(n);
  }
  function full(n, lang) { return num(n) == null ? '–' : nf(lang, { maximumFractionDigits: 0 }).format(n); }
  /** 3.4 → "3.4×" / "3,4×"; ≥ 10 without decimals. */
  function times(r, lang) {
    if (num(r) == null) return '–';
    return nf(lang, { maximumFractionDigits: r >= 10 ? 0 : 1, minimumFractionDigits: r >= 10 ? 0 : 1 }).format(r) + '×';
  }
  function vphLabel(v, lang) {
    if (!v) return '–';
    return (v.approx ? '≈' : '') + compact(v.value, lang) + (lang === 'tr' ? '/sa' : '/h');
  }
  function pct(v, lang) {
    if (num(v) == null) return '–';
    return nf(lang, { maximumFractionDigits: v < 10 ? 1 : 0 }).format(v) + '%';
  }
  /** Seconds → "11:32" / "1:02:03". */
  function clock(s) {
    if (!(num(s) > 0)) return '–';
    s = Math.round(s);
    var hh = Math.floor(s / 3600);
    var mm = Math.floor(s / 60) % 60;
    var ss = s % 60;
    return (hh ? hh + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(ss).padStart(2, '0');
  }
  /** Velocity checkpoint label: 24 → "24h" / "24 sa", 168 → "7d" / "7 g". */
  function cpLabel(h, lang) {
    if (h < 168) return h + (lang === 'tr' ? ' sa' : 'h');
    return Math.round(h / 24) + (lang === 'tr' ? ' g' : 'd');
  }

  return {
    HOUR: HOUR, DAY: DAY, OUTLIER: OUTLIER, MIN_BASELINE: MIN_BASELINE, YT_AD: YT_AD, LENGTHS: LENGTHS,
    median: median, mean: mean, vph: vph, channelMean: channelMean, ratio: ratio, engagement: engagement,
    libraryBaseline: libraryBaseline, outlier: outlier,
    monetizationFromHtml: monetizationFromHtml, sampleIndices: sampleIndices, sampleVideos: sampleVideos, channelVerdict: channelVerdict,
    cacheGet: cacheGet, cachePut: cachePut, waitFor: waitFor, limiter: limiter,
    defaultFilters: defaultFilters, activeFilters: activeFilters, matchItem: matchItem,
    channelStats: channelStats, growth: growth, sparkPath: sparkPath,
    compact: compact, full: full, times: times, vphLabel: vphLabel, pct: pct, clock: clock, cpLabel: cpLabel
  };
});
