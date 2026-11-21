// OpenOutlier – niche tracking metrics (docs/youtube-niche-plan.md 2.3 and 2.4).
//
// Pure functions over measurement series, shared by the bridge (mcp/niche.mjs),
// the MCP tools and the tests. A video is
//   { id, channel_id, published_at (ms), type: 'short' | 'video', duration?, title?,
//     points: [{ ts (ms), views }] }
// where points come from video_stats (RSS, Data API, page) and are in any order.
//
// • Checkpoints: views at 1/3/6/12/24/48/72 h and 7/14/30 d, by linear
//   interpolation between real measurements (the publish moment counts as 0 views).
//   A checkpoint is only known when measurements close enough on both sides exist,
//   so a video first seen at day 10 has no 24 h value instead of a made-up one.
// • Curves: a channel's normal curve is the median of its videos at each checkpoint
//   (Shorts and long-form apart). Until it has 5 videos at a checkpoint, the niche's
//   curve is used instead, scaled to the channel: the niche curve is the median of
//   views(t) ÷ each video's channel baseline (its typical views), so channels of any
//   size share one shape; × this channel's baseline gives its expected views.
// • Velocity score: views(t) ÷ expected(t) at the latest checkpoint the video passed.
// • Views per subscriber at 48 h, evergreen ratio views(30 d) ÷ views(48 h),
//   last-24 h views per hour from the measurements, and the age tiers that decide how
//   often the Data API measures a video.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpenOutlierVelocity = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN = 60000;
  var HOUR = 60 * MIN;
  var DAY = 24 * HOUR;
  /** Checkpoints in hours. */
  var CHECKPOINTS = [1, 3, 6, 12, 24, 48, 72, 168, 336, 720];
  var MIN_CHANNEL_VIDEOS = 5;
  var BREAKOUT_RATIO = 3;
  var BREAKOUT_AT = [6, 24];

  function cpLabel(h) { return h < 168 ? h + 'h' : (h / 24) + 'd'; }

  function median(list) {
    var a = (list || []).filter(function (x) { return typeof x === 'number' && isFinite(x); }).sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  /** Measurements → [{ h, v }] (hours since publish), sorted, with the publish moment as 0 views. */
  function series(points, publishedAt) {
    if (!isFinite(publishedAt)) return [];
    var seen = {};
    var out = [];
    (points || []).forEach(function (p) {
      if (!p || typeof p.views !== 'number' || !isFinite(p.views) || !isFinite(p.ts)) return;
      var h = (p.ts - publishedAt) / HOUR;
      if (h < -0.25) return; // clock skew of a few minutes is fine, earlier than that is junk
      h = Math.max(h, 0);
      var key = Math.round(h * 3600);
      if (seen[key] != null) { out[seen[key]].v = Math.max(out[seen[key]].v, p.views); return; }
      seen[key] = out.length;
      out.push({ h: h, v: p.views });
    });
    if (!out.length) return [];
    out.sort(function (a, b) { return a.h - b.h; });
    if (out[0].h > 0) out.unshift({ h: 0, v: 0, anchor: true });
    return out;
  }

  /** How far apart the two measurements around checkpoint h may be (hours). */
  function maxGap(h) { return Math.max(2, h * 0.5); }
  /** How close a measurement must be to stand for checkpoint h on its own (hours). */
  function nearTol(h) { return Math.max(0.25, h * 0.05); }

  /** Views at h hours, or null when the measurements don't cover it closely enough. */
  function viewsAt(s, h) {
    if (!s.length) return null;
    var a = null;
    var b = null;
    for (var i = 0; i < s.length; i++) {
      if (s[i].h <= h) a = s[i];
      if (s[i].h >= h) { b = s[i]; break; }
    }
    // A measurement right at (or just past) the checkpoint.
    var near = null;
    [a, b].forEach(function (p) { if (p && !p.anchor && Math.abs(p.h - h) <= nearTol(h) && (!near || Math.abs(p.h - h) < Math.abs(near.h - h))) near = p; });
    if (near && (!a || !b || a === b)) return near.v;
    if (!a || !b) return null;
    if (a === b) return a.v;
    if (b.h - a.h > maxGap(h)) return near ? near.v : null;
    return a.v + (b.v - a.v) * (h - a.h) / (b.h - a.h);
  }

  /** { 1: views|null, 3: …, 720: … } for one video. */
  function checkpoints(video, cps) {
    var s = series(video.points, video.published_at);
    var out = {};
    (cps || CHECKPOINTS).forEach(function (h) {
      var v = viewsAt(s, h);
      out[h] = v == null ? null : Math.round(v);
    });
    return out;
  }

  function formatOf(v) { return v && v.type === 'short' ? 'short' : 'long'; }

  /** Median curve of a set of videos: { values: { h: median|null }, n: { h: count } }. */
  function curve(videos, cps) {
    cps = cps || CHECKPOINTS;
    var values = {};
    var n = {};
    var per = (videos || []).map(function (v) { return v.cp || checkpoints(v, cps); });
    cps.forEach(function (h) {
      var list = per.map(function (c) { return c[h]; }).filter(function (x) { return x != null; });
      values[h] = median(list);
      n[h] = list.length;
    });
    return { values: values, n: n };
  }

  /** A channel's typical views for one format: median of its videos at least 3 days old (as the Library's outlier median). */
  function baseline(videos, now) {
    var list = (videos || []).filter(function (v) { return now - v.published_at >= 3 * DAY; })
      .map(function (v) { return latestViews(v); }).filter(function (x) { return x != null && x > 0; });
    return median(list);
  }

  function latestViews(v) {
    var best = null;
    (v.points || []).forEach(function (p) { if (p && typeof p.views === 'number' && (!best || p.ts > best.ts)) best = p; });
    return best ? best.views : (typeof v.views === 'number' ? v.views : null);
  }

  /**
   * The niche's shape: median of views(h) ÷ the video's channel baseline.
   * videos: [{ …, cp?, baseline }] → { values: { h: ratio|null }, n }
   */
  function nicheCurve(videos, cps) {
    cps = cps || CHECKPOINTS;
    var values = {};
    var n = {};
    cps.forEach(function (h) {
      var list = [];
      (videos || []).forEach(function (v) {
        if (!(v.baseline > 0)) return;
        var c = v.cp || checkpoints(v, cps);
        if (c[h] != null) list.push(c[h] / v.baseline);
      });
      values[h] = median(list);
      n[h] = list.length;
    });
    return { values: values, n: n };
  }

  /**
   * The share of its 30-day views a video has at each checkpoint (median across videos
   * that reached 30 days): "a long video gets X % of its first month in 48 h".
   */
  function shareCurve(videos, cps) {
    cps = cps || CHECKPOINTS;
    var last = cps[cps.length - 1];
    var values = {};
    var n = {};
    var per = (videos || []).map(function (v) { return v.cp || checkpoints(v, cps); }).filter(function (c) { return c[last] > 0; });
    cps.forEach(function (h) {
      var list = per.map(function (c) { return c[h] == null ? null : c[h] / c[last]; }).filter(function (x) { return x != null; });
      values[h] = median(list);
      n[h] = list.length;
    });
    return { values: values, n: n, videos: per.length };
  }

  /**
   * What a channel's video is expected to have at each checkpoint:
   * its own median once 5+ videos reached that checkpoint, else niche × baseline.
   * → { h: { value, source: 'channel' | 'niche', n } }
   */
  function expectedCurve(own, niche, base, cps, minVideos) {
    cps = cps || CHECKPOINTS;
    minVideos = minVideos || MIN_CHANNEL_VIDEOS;
    var out = {};
    cps.forEach(function (h) {
      var nOwn = own && own.n ? own.n[h] || 0 : 0;
      if (nOwn >= minVideos && own.values[h] != null) out[h] = { value: own.values[h], source: 'channel', n: nOwn };
      else if (niche && niche.values[h] != null && base > 0) out[h] = { value: niche.values[h] * base, source: 'niche', n: niche.n[h] };
      else out[h] = null;
    });
    return out;
  }

  /** Expected views at any age (hours), interpolating the curve in log-time. */
  function expectedAt(expected, h, cps) {
    cps = cps || CHECKPOINTS;
    var pts = cps.filter(function (c) { return expected[c]; }).map(function (c) { return { h: c, v: expected[c].value }; });
    if (!pts.length || h <= 0) return null;
    if (h <= pts[0].h) return pts[0].v * (h / pts[0].h); // before the first checkpoint: straight from 0
    for (var i = 1; i < pts.length; i++) {
      if (h <= pts[i].h) {
        var a = pts[i - 1];
        var b = pts[i];
        var t = (Math.log(h) - Math.log(a.h)) / (Math.log(b.h) - Math.log(a.h));
        return a.v + (b.v - a.v) * t;
      }
    }
    return null; // past the last known checkpoint: no honest guess
  }

  /**
   * Velocity score at the latest checkpoint the video has passed and has a value for.
   * → { at, label, views, expected, score, source } | null
   */
  function velocity(video, expected, now, cps) {
    cps = cps || CHECKPOINTS;
    var c = video.cp || checkpoints(video, cps);
    var age = (now - video.published_at) / HOUR;
    for (var i = cps.length - 1; i >= 0; i--) {
      var h = cps[i];
      if (h > age + 1e-9) continue;
      if (c[h] == null || !expected[h] || !(expected[h].value > 0)) continue;
      return { at: h, label: cpLabel(h), views: c[h], expected: Math.round(expected[h].value), score: c[h] / expected[h].value, source: expected[h].source };
    }
    return null;
  }

  /** The score at one checkpoint (breakouts look at 6 h and 24 h). */
  function scoreAt(video, expected, h, cps) {
    var c = video.cp || checkpoints(video, cps);
    if (c[h] == null || !expected[h] || !(expected[h].value > 0)) return null;
    return c[h] / expected[h].value;
  }

  /** Breakouts: checkpoints (6 h, 24 h) where the score ≥ ratio. → [{ at, score, views, expected }] */
  function breakouts(video, expected, opts) {
    opts = opts || {};
    var ratio = opts.ratio || BREAKOUT_RATIO;
    var at = opts.at || BREAKOUT_AT;
    var c = video.cp || checkpoints(video);
    var out = [];
    at.forEach(function (h) {
      var s = scoreAt(Object.assign({}, video, { cp: c }), expected, h);
      if (s != null && s >= ratio) out.push({ at: h, label: cpLabel(h), score: s, views: c[h], expected: Math.round(expected[h].value) });
    });
    return out;
  }

  /** views(48 h) ÷ subscribers. */
  function viewsPerSub(video, subs) {
    var c = video.cp || checkpoints(video);
    return c[48] != null && subs > 0 ? c[48] / subs : null;
  }

  /** views(30 d) ÷ views(48 h), with a class: evergreen (≥ 3), spike (≤ 1.3), steady. */
  function evergreen(video) {
    var c = video.cp || checkpoints(video);
    if (!(c[48] > 0) || c[720] == null) return null;
    var r = c[720] / c[48];
    return { ratio: r, kind: r >= 3 ? 'evergreen' : r <= 1.3 ? 'spike' : 'steady' };
  }

  /** Views per hour since publish. */
  function lifetimeVph(views, publishedAt, now) {
    var hours = (now - publishedAt) / HOUR;
    return views != null && hours > 0 ? views / hours : null;
  }

  /** Views at an absolute time from the measurements (null when not bracketed within 24 h). */
  function viewsAtTs(points, publishedAt, ts) {
    var s = series(points, publishedAt);
    var h = (ts - publishedAt) / HOUR;
    if (h <= 0) return 0;
    var a = null;
    var b = null;
    for (var i = 0; i < s.length; i++) {
      if (s[i].h <= h) a = s[i];
      if (s[i].h >= h) { b = s[i]; break; }
    }
    if (!a || !b) return null;
    if (a === b || b.h === a.h) return a.v;
    if (b.h - a.h > 24 && !a.anchor) return null;
    return a.v + (b.v - a.v) * (h - a.h) / (b.h - a.h);
  }

  /**
   * Views per hour over the last 24 h of measurements: (latest − views 24 h before it) ÷ 24.
   * A video younger than a day: views ÷ its age. Stale data (latest older than 6 h) → null.
   * → { vph, hours, at } | null
   */
  function vph24(points, publishedAt, now) {
    var list = (points || []).filter(function (p) { return p && typeof p.views === 'number'; }).sort(function (a, b) { return a.ts - b.ts; });
    if (!list.length) return null;
    var last = list[list.length - 1];
    if (now - last.ts > 6 * HOUR) return null;
    var from = last.ts - DAY;
    if (from <= publishedAt) {
      var hrs = (last.ts - publishedAt) / HOUR;
      return hrs > 0 ? { vph: last.views / hrs, hours: hrs, at: last.ts } : null;
    }
    var base = viewsAtTs(list, publishedAt, from);
    if (base == null) return null;
    return { vph: Math.max(0, last.views - base) / 24, hours: 24, at: last.ts };
  }

  /**
   * How often the Data API measures a video of this age (plan 2.2):
   * 0–48 h hourly (first 6 h every 30 min when fastStart), 2–7 d every 6 h,
   * 7–30 d daily, older weekly. → { tier, every (ms) }
   */
  function ageTier(ageMs, opts) {
    var fast = !opts || opts.fastStart !== false;
    if (ageMs < 6 * HOUR) return { tier: 'h0-6', every: fast ? 30 * MIN : HOUR };
    if (ageMs < 48 * HOUR) return { tier: 'h6-48', every: HOUR };
    if (ageMs < 7 * DAY) return { tier: 'd2-7', every: 6 * HOUR };
    if (ageMs < 30 * DAY) return { tier: 'd7-30', every: DAY };
    return { tier: 'd30+', every: 7 * DAY };
  }

  /** The next measurement time: now + the tier's interval, but never later than the next tier boundary's first slot. */
  function nextMeasure(publishedAt, now, opts) {
    var age = now - publishedAt;
    var t = ageTier(Math.max(0, age), opts);
    var next = now + t.every;
    // Crossing into a slower tier is fine (the boundary itself is not a checkpoint), but don't
    // sleep past a checkpoint by much: wake up just after it so the checkpoint is bracketed.
    var cpTimes = CHECKPOINTS.map(function (h) { return publishedAt + h * HOUR; });
    for (var i = 0; i < cpTimes.length; i++) {
      if (cpTimes[i] > now && cpTimes[i] < next) { next = Math.min(next, cpTimes[i] + 5 * MIN); break; }
    }
    return { next_at: next, tier: t.tier };
  }

  /** The slope (views per hour) over windowH hours before and after a moment, e.g. a title change. */
  function slopeAround(points, publishedAt, ts, windowH) {
    windowH = windowH || 24;
    var before0 = viewsAtTs(points, publishedAt, ts - windowH * HOUR);
    var at = viewsAtTs(points, publishedAt, ts);
    var after = viewsAtTs(points, publishedAt, ts + windowH * HOUR);
    return {
      before: before0 != null && at != null ? (at - before0) / windowH : null,
      after: after != null && at != null ? (after - at) / windowH : null
    };
  }

  // ---- what works / topic gaps (plan 2.4) ---------------------------------------------

  var STOP = ('a an and are as at be by can do for from get got has have how i if in into is it its just my new no not of on or our so than that the their them then this to too up us vs was we what when which who why will with you your ' +
    'bir ve ile için bu da de ne nasıl mi mı mu mü en çok daha gibi ama veya ki o şu her').split(' ');
  var STOPSET = {};
  STOP.forEach(function (w) { STOPSET[w] = true; });

  function words(title) {
    var out = [];
    String(title || '').toLowerCase().replace(/https?:\/\/\S+/g, ' ').split(/[^\p{L}\p{N}+#]+/u).forEach(function (w) {
      if (w.length < 2 || STOPSET[w] || /^\d+$/.test(w)) return;
      if (out.indexOf(w) === -1) out.push(w);
    });
    return out;
  }

  /** Title patterns worth comparing (each a test on the raw title). */
  var PATTERNS = [
    { id: 'number', label: { en: 'A number in the title', tr: 'Başlıkta sayı' }, test: function (t) { return /\d/.test(t); } },
    { id: 'question', label: { en: 'A question', tr: 'Soru' }, test: function (t) { return /\?/.test(t) || /^(how|why|what|which|can|is|do|nasıl|neden)\b/i.test(t); } },
    { id: 'howto', label: { en: '"How to"', tr: '"How to"' }, test: function (t) { return /\bhow to\b/i.test(t); } },
    { id: 'brackets', label: { en: 'Brackets ( ) or [ ]', tr: 'Parantez ( ) ya da [ ]' }, test: function (t) { return /[(\[]/.test(t); } },
    { id: 'caps', label: { en: 'A word in CAPS', tr: 'BÜYÜK harfli kelime' }, test: function (t) { return /\b[A-Z]{3,}\b/.test(t.replace(/\b(XLOOKUP|VLOOKUP|HLOOKUP|SUMIFS|COUNTIFS|IF|AI|PDF|CSV|SQL|VBA|DAX|KPI)\b/g, '')); } },
    { id: 'year', label: { en: 'A year (2025, 2026 …)', tr: 'Yıl (2025, 2026 …)' }, test: function (t) { return /\b20\d\d\b/.test(t); } },
    { id: 'emoji', label: { en: 'An emoji', tr: 'Emoji' }, test: function (t) { return /\p{Extended_Pictographic}/u.test(t); } }
  ];

  function lengthBucket(v) {
    if (v.type === 'short') return 'short';
    var d = v.duration;
    if (!(d > 0)) return null;
    if (d < 300) return '<5m';
    if (d < 600) return '5–10m';
    if (d < 1200) return '10–20m';
    if (d < 2400) return '20–40m';
    return '40m+';
  }
  var LENGTH_ORDER = ['short', '<5m', '5–10m', '10–20m', '20–40m', '40m+'];

  function group(videos, keyFn, minN) {
    var g = {};
    videos.forEach(function (v) {
      var k = keyFn(v);
      if (k == null) return;
      (g[k] = g[k] || []).push(v);
    });
    var out = {};
    Object.keys(g).forEach(function (k) {
      var scores = g[k].map(function (v) { return v.score; });
      out[k] = { n: g[k].length, median: g[k].length >= (minN || 1) ? median(scores) : null };
    });
    return out;
  }

  /**
   * "What works" over scored videos [{ published_at, type, duration, title, score }]
   * (score = velocity at 48 h, or the latest checkpoint). tzOffsetMin: minutes to add to
   * UTC for the user's local time (−new Date().getTimezoneOffset()).
   */
  function whatWorks(videos, opts) {
    opts = opts || {};
    var minN = opts.minN || 2;
    var tz = opts.tzOffsetMin || 0;
    var list = (videos || []).filter(function (v) { return v && typeof v.score === 'number' && isFinite(v.score); });
    var all = median(list.map(function (v) { return v.score; }));
    var local = function (v) { return new Date(v.published_at + tz * MIN); };
    var exact = list.filter(function (v) { return v.dateExact !== false; });
    var byDay = group(exact, function (v) { return local(v).getUTCDay(); }, minN);
    var byBlock = group(exact, function (v) { return Math.floor(local(v).getUTCHours() / 3); }, minN);
    var cells = group(exact, function (v) { var d = local(v); return d.getUTCDay() + ':' + Math.floor(d.getUTCHours() / 3); }, minN);
    var best = function (g) {
      var top = null;
      Object.keys(g).forEach(function (k) { if (g[k].median != null && (!top || g[k].median > g[top].median)) top = k; });
      return top == null ? null : { key: Number(top), median: g[top].median, n: g[top].n };
    };
    var lengths = group(list, lengthBucket, minN);
    var patterns = PATTERNS.map(function (p) {
      var yes = list.filter(function (v) { return p.test(String(v.title || '')); });
      var no = list.filter(function (v) { return !p.test(String(v.title || '')); });
      var my = yes.length >= minN ? median(yes.map(function (v) { return v.score; })) : null;
      var mn = no.length >= minN ? median(no.map(function (v) { return v.score; })) : null;
      return { id: p.id, label: p.label, n: yes.length, with: my, without: mn, lift: my != null && mn ? my / mn : null };
    }).filter(function (p) { return p.n > 0; });
    var formats = group(list, function (v) { return v.type === 'short' ? 'short' : 'long'; }, 1);
    return {
      videos: list.length, median: all,
      weekday: byDay, block: byBlock, cells: cells,
      best_day: best(byDay), best_block: best(byBlock),
      lengths: lengths, length_order: LENGTH_ORDER,
      words: wordLift(list, { minN: opts.minWordN || 3, limit: opts.wordLimit || 12 }),
      patterns: patterns,
      formats: formats
    };
  }

  /**
   * Keep one word per topic: a word whose videos are mostly (≥ 80 %) the videos of a word
   * already kept ("copilot" → "copilot in excel", "gantt" → "chart") says the same thing.
   */
  function distinct(list, idsOf) {
    var kept = [];
    return list.filter(function (w) {
      var ids = idsOf(w);
      var dup = kept.some(function (k) {
        var shared = ids.filter(function (id) { return k[id]; }).length;
        return shared >= 0.8 * Math.min(ids.length, Object.keys(k).length);
      });
      if (dup) return false;
      var set = {};
      ids.forEach(function (id) { set[id] = true; });
      kept.push(set);
      return true;
    });
  }

  /** Title words by median score ÷ overall median (words in ≥ minN videos). */
  function wordLift(list, opts) {
    opts = opts || {};
    var all = median(list.map(function (v) { return v.score; }));
    var by = {};
    list.forEach(function (v) {
      words(v.title).concat((v.keywords || []).map(function (k) { return String(k).toLowerCase(); }).filter(function (k) { return k.length > 1 && !STOPSET[k]; }))
        .filter(function (w, i, a) { return a.indexOf(w) === i; })
        .forEach(function (w) { (by[w] = by[w] || []).push(v); });
    });
    var out = Object.keys(by).filter(function (w) { return by[w].length >= (opts.minN || 3); }).map(function (w) {
      var m = median(by[w].map(function (v) { return v.score; }));
      return { word: w, n: by[w].length, median: m, lift: all ? m / all : null };
    });
    out.sort(function (a, b) { return (b.lift || 0) - (a.lift || 0) || b.n - a.n || a.word.length - b.word.length; });
    out = distinct(out, function (w) { return by[w.word].map(function (v) { return v.id; }); });
    return out.slice(0, opts.limit || 12);
  }

  /**
   * Topic gaps: words (title + tags) whose videos are fast (median score ≥ minLift × the
   * niche median) but rare (between 2 and maxN videos). → [{ word, n, median, lift, examples }]
   */
  function topicGaps(videos, opts) {
    opts = opts || {};
    var list = (videos || []).filter(function (v) { return v && typeof v.score === 'number' && isFinite(v.score); });
    var all = median(list.map(function (v) { return v.score; }));
    if (!all) return [];
    var maxN = opts.maxN || Math.max(3, Math.round(list.length * 0.06));
    var minLift = opts.minLift || 1.5;
    var by = {};
    list.forEach(function (v) {
      words(v.title).concat((v.keywords || []).map(function (k) { return String(k).toLowerCase(); }).filter(function (k) { return k.length > 1 && !STOPSET[k]; }))
        .filter(function (w, i, a) { return a.indexOf(w) === i; })
        .forEach(function (w) { (by[w] = by[w] || []).push(v); });
    });
    var out = Object.keys(by).filter(function (w) { return by[w].length >= 2 && by[w].length <= maxN; }).map(function (w) {
      var vs = by[w];
      var m = median(vs.map(function (v) { return v.score; }));
      var channels = {};
      vs.forEach(function (v) { channels[v.channel_id] = true; });
      return { word: w, ids: vs.map(function (v) { return v.id; }), n: vs.length, channels: Object.keys(channels).length, median: m, lift: m / all,
        examples: vs.slice().sort(function (a, b) { return b.score - a.score; }).slice(0, 3).map(function (v) { return { id: v.id, title: v.title, score: v.score }; }) };
    }).filter(function (g) { return g.lift >= minLift; });
    out.sort(function (a, b) { return b.lift - a.lift || b.n - a.n || a.word.length - b.word.length; });
    return distinct(out, function (g) { return g.ids; }).slice(0, opts.limit || 10).map(function (g) { delete g.ids; return g; });
  }

  // ---- RSS lag (plan 2.2, open item from phase 0) --------------------------------------

  /**
   * How far behind the RSS view count is compared with the Data API, from measurements
   * of the same videos: rows [{ video_id, ts, views, source }] (+ published_at per video).
   * For every RSS reading, the time at which the API series (interpolated) had that many
   * views: lag = rss.ts − that time. Positive = RSS is behind. Also the relative gap of
   * RSS readings taken within 10 min of an API reading.
   * → { samples, videos, lag_min: { median, p90 }, gap_pct: { median, p90 }, young: {…}, verdict }
   */
  function rssLag(rows, publishedAt, opts) {
    opts = opts || {};
    var pub = publishedAt || {};
    var by = {};
    (rows || []).forEach(function (r) {
      if (!r || typeof r.views !== 'number' || (r.source !== 'rss' && r.source !== 'api')) return;
      var g = by[r.video_id] = by[r.video_id] || { rss: [], api: [] };
      g[r.source].push(r);
    });
    var lags = [];
    var lagsYoung = [];
    var gaps = [];
    var nVideos = 0;
    Object.keys(by).forEach(function (id) {
      var g = by[id];
      if (!g.rss.length || g.api.length < 2) return;
      g.api.sort(function (a, b) { return a.ts - b.ts; });
      var used = false;
      g.rss.forEach(function (r) {
        // When did the API series reach r.views?
        for (var i = 1; i < g.api.length; i++) {
          var a = g.api[i - 1];
          var b = g.api[i];
          if (r.views >= a.views && r.views <= b.views && b.views > a.views && b.ts - a.ts <= 12 * HOUR) {
            var t = a.ts + (b.ts - a.ts) * (r.views - a.views) / (b.views - a.views);
            var lag = (r.ts - t) / MIN;
            if (lag > -120 && lag < 48 * 60) {
              lags.push(lag);
              if (pub[id] && r.ts - pub[id] < 48 * HOUR) lagsYoung.push(lag);
              used = true;
            }
            break;
          }
        }
        var near = null;
        g.api.forEach(function (a) { if (Math.abs(a.ts - r.ts) <= 10 * MIN && (!near || Math.abs(a.ts - r.ts) < Math.abs(near.ts - r.ts))) near = a; });
        if (near && near.views > 0) { gaps.push((near.views - r.views) / near.views * 100); used = true; }
      });
      if (used) nVideos++;
    });
    function q(list, p) {
      var a = list.slice().sort(function (x, y) { return x - y; });
      if (!a.length) return null;
      return a[Math.min(a.length - 1, Math.floor(p * (a.length - 1) + 0.5))];
    }
    var med = q(lags, 0.5);
    var medYoung = q(lagsYoung, 0.5);
    var minSamples = opts.minSamples || 12;
    var key = medYoung != null && lagsYoung.length >= minSamples / 2 ? medYoung : med;
    var verdict = lags.length < minSamples ? 'collecting' : key > 60 ? 'rss-lags' : 'rss-ok';
    return {
      samples: lags.length, gap_samples: gaps.length, videos: nVideos,
      lag_min: { median: med == null ? null : Math.round(med), p90: q(lags, 0.9) == null ? null : Math.round(q(lags, 0.9)) },
      young_lag_min: { median: medYoung == null ? null : Math.round(medYoung), samples: lagsYoung.length },
      gap_pct: { median: q(gaps, 0.5) == null ? null : Math.round(q(gaps, 0.5) * 10) / 10, p90: q(gaps, 0.9) == null ? null : Math.round(q(gaps, 0.9) * 10) / 10 },
      verdict: verdict
    };
  }

  return {
    HOUR: HOUR, DAY: DAY, CHECKPOINTS: CHECKPOINTS, MIN_CHANNEL_VIDEOS: MIN_CHANNEL_VIDEOS, BREAKOUT_RATIO: BREAKOUT_RATIO, BREAKOUT_AT: BREAKOUT_AT,
    cpLabel: cpLabel, median: median, series: series, viewsAt: viewsAt, checkpoints: checkpoints, formatOf: formatOf,
    curve: curve, baseline: baseline, latestViews: latestViews, nicheCurve: nicheCurve, shareCurve: shareCurve,
    expectedCurve: expectedCurve, expectedAt: expectedAt, velocity: velocity, scoreAt: scoreAt, breakouts: breakouts,
    viewsPerSub: viewsPerSub, evergreen: evergreen, lifetimeVph: lifetimeVph, viewsAtTs: viewsAtTs, vph24: vph24,
    ageTier: ageTier, nextMeasure: nextMeasure, slopeAround: slopeAround,
    words: words, PATTERNS: PATTERNS, lengthBucket: lengthBucket, LENGTH_ORDER: LENGTH_ORDER,
    whatWorks: whatWorks, wordLift: wordLift, topicGaps: topicGaps, rssLag: rssLag
  };
});
