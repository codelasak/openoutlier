// OpenOutlier – X reach forecast for the user's own posts (docs/x-plan.md 6, phase 6).
//
// The reach-optimizer approach (AytuncYildizli/reach-optimizer, MIT): the target is
// log(views ÷ rolling median of the previous posts), so the model learns what lifts a post above
// the account's own normal, not how big the account is. A ridge regression on a few simple
// features, a time-based split (≥ 40 train, ≥ 20 test posts, the newest are the test), and the
// number is shown only when it beats "the post will do the median" on the test posts.
//
//   samples(posts, opts)          the rows the model sees ({ id, at, y, x, baseline })
//   train(posts, opts)            → a JSON-safe model { shown: true, … } or { shown: false, reason, … }
//   forecastDraft(model, draft)   → { shown: true, views, low, high, ratio, baseline, drivers } or { shown: false, reason }
//   forecast(posts, draft, opts)  both in one call
//
// posts: the user's own ORIGINAL posts (no replies or reposts), each
//   { id, createdAt (ms), views, format ('text'|'image'|'video'|'thread'|'article'|'link'|'quote'), text, quote (bool) }
// Posts without a view count (pre-2023 posts) are left out.
//
// Pure functions; UMD: self.OpenOutlierXForecast. Uses OpenOutlierXComposer for weighted length,
// links and emoji when it is loaded (falls back to simple rules when not).
'use strict';

(function (root, factory) {
  var composer = null;
  if (typeof module === 'object' && module.exports) {
    try { composer = require('./x-composer.js'); } catch (e) { composer = null; }
  }
  var api = factory(function () { return composer || (root && root.OpenOutlierXComposer) || null; });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpenOutlierXForecast = api;
})(typeof self !== 'undefined' ? self : this, function (getComposer) {
  var DEFAULTS = {
    window: 20,        // the rolling median uses up to this many previous posts
    minPrev: 5,        // a post needs this many previous posts to get a target
    minTrain: 40,
    minTest: 20,
    testShare: 0.3,    // the newest 30 % (at least minTest) are the test set
    lambdas: [0.3, 1, 3, 10, 30],
    minGain: 0,        // the model's test MAE must be below the baseline's × (1 − minGain)
    tzOffsetMinutes: null // hours and weekdays in this UTC offset; null = the local time zone
  };
  var FORMATS = ['text', 'image', 'video', 'thread', 'article', 'link', 'quote', 'other'];
  var LENGTHS = [['short', 70], ['medium', 140], ['long', 280], ['xl', Infinity]];
  var HOURS = [['night', 6], ['morning', 12], ['afternoon', 18], ['evening', 24]];
  var FEATURES = [].concat(
    FORMATS.map(function (f) { return 'format:' + f; }),
    LENGTHS.map(function (l) { return 'length:' + l[0]; }),
    HOURS.map(function (h) { return 'hour:' + h[0]; }),
    [0, 1, 2, 3, 4, 5, 6].map(function (d) { return 'weekday:' + d; }),
    ['has:number', 'has:emoji', 'has:link', 'is:quote']
  );
  var LABELS = {
    'format:text': ['metin', 'text'], 'format:image': ['görsel', 'image'], 'format:video': ['video', 'video'], 'format:thread': ['thread', 'thread'],
    'format:article': ['makale', 'article'], 'format:link': ['link', 'link'], 'format:quote': ['alıntı', 'quote'], 'format:other': ['diğer', 'other'],
    'length:short': ['kısa (≤70)', 'short (≤70)'], 'length:medium': ['orta (71–140)', 'medium (71–140)'], 'length:long': ['uzun (141–280)', 'long (141–280)'], 'length:xl': ['uzun post (>280)', 'long post (>280)'],
    'hour:night': ['gece (00–06)', 'night (00–06)'], 'hour:morning': ['sabah (06–12)', 'morning (06–12)'], 'hour:afternoon': ['öğleden sonra (12–18)', 'afternoon (12–18)'], 'hour:evening': ['akşam (18–24)', 'evening (18–24)'],
    'weekday:0': ['pazar', 'Sunday'], 'weekday:1': ['pazartesi', 'Monday'], 'weekday:2': ['salı', 'Tuesday'], 'weekday:3': ['çarşamba', 'Wednesday'],
    'weekday:4': ['perşembe', 'Thursday'], 'weekday:5': ['cuma', 'Friday'], 'weekday:6': ['cumartesi', 'Saturday'],
    'has:number': ['rakam var', 'has a number'], 'has:emoji': ['emoji var', 'has emoji'], 'has:link': ['link var', 'has a link'], 'is:quote': ['alıntı post', 'quote post']
  };
  var REASONS = {
    'not-enough-posts': ['Tahmin için yeterli post yok', 'Not enough posts for a forecast'],
    'no-gain': ['Model, test postlarında "medyan kadar olur" tahmininden daha isabetli değil; sayı gösterilmiyor', 'The model is not more accurate than "it will do the median" on the test posts, so no number is shown'],
    'no-model': ['Model yok', 'No model'],
    'no-baseline': ['Son postların medyanı yok', 'No median of recent posts']
  };
  function reason(code, extra) {
    var r = { shown: false, reason: code, tr: REASONS[code][0], en: REASONS[code][1] };
    if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
    return r;
  }

  // ---- helpers ------------------------------------------------------------------------------------------
  function opt(o) {
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) { out[k] = o && o[k] != null ? o[k] : DEFAULTS[k]; });
    return out;
  }
  function median(xs) {
    var a = xs.slice().sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function quantile(xs, q) {
    var a = xs.slice().sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return a[lo] + (a[hi] - a[lo]) * (pos - lo);
  }
  function timeOf(p) {
    var t = p.createdAt != null ? p.createdAt : p.time != null ? p.time : p.created_at;
    if (typeof t === 'string') t = /^\d+$/.test(t) ? Number(t) : Date.parse(t);
    return typeof t === 'number' && Number.isFinite(t) ? t : null;
  }
  function viewsOf(p) {
    var v = p.views;
    if (v == null || v === '') return null;
    v = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(v) && v > 0 ? v : null;
  }
  function clock(at, tz) {
    if (tz == null) { var d = new Date(at); return { hour: d.getHours(), day: d.getDay() }; }
    var u = new Date(at + tz * 60000);
    return { hour: u.getUTCHours(), day: u.getUTCDay() };
  }
  function textInfo(text) {
    var C = getComposer();
    var s = String(text || '');
    var len, link, emoji;
    if (C) {
      len = C.weightedLength(s).weighted;
      link = C.links(s).some(function (l) { return l.external; });
      emoji = C.emojis(s).length > 0;
    } else {
      len = Array.from(s).length;
      link = /https?:\/\/(?!(?:www\.)?(?:x|twitter)\.com)/i.test(s);
      emoji = /\p{Extended_Pictographic}/u.test(s);
    }
    return { len: len, link: link, emoji: emoji, number: /\d/.test(s) };
  }
  function formatOf(p, info) {
    var f = String(p.format || '').toLowerCase();
    if (FORMATS.indexOf(f) !== -1) return f;
    if (f) return 'other';
    if (p.quote || p.quoted_id) return 'quote';
    return info.link ? 'link' : 'text';
  }

  /** The feature vector of one post or draft (0/1 per FEATURES entry). */
  function featurize(p, tz) {
    var info = textInfo(p.text);
    var at = timeOf(p);
    var x = FEATURES.map(function () { return 0; });
    function on(name) { var i = FEATURES.indexOf(name); if (i !== -1) x[i] = 1; }
    on('format:' + formatOf(p, info));
    for (var i = 0; i < LENGTHS.length; i++) { if (info.len <= LENGTHS[i][1]) { on('length:' + LENGTHS[i][0]); break; } }
    if (at != null) {
      var c = clock(at, tz);
      for (var j = 0; j < HOURS.length; j++) { if (c.hour < HOURS[j][1]) { on('hour:' + HOURS[j][0]); break; } }
      on('weekday:' + c.day);
    }
    if (info.number) on('has:number');
    if (info.emoji) on('has:emoji');
    if (info.link) on('has:link');
    if (p.quote || p.quoted_id || formatOf(p, info) === 'quote') on('is:quote');
    return x;
  }

  /**
   * The training rows: posts with views, oldest first, each with y = ln(views ÷ median(previous ≤ window)).
   * → { rows: [{ id, at, views, baseline, y, x }], used (posts with views), recent (the last `window` views) }
   */
  function samples(posts, o) {
    o = opt(o);
    var list = (Array.isArray(posts) ? posts : []).filter(function (p) {
      return p && !p.isReply && !p.is_reply && !p.isRepost && !p.is_repost && viewsOf(p) != null && timeOf(p) != null;
    }).sort(function (a, b) { return timeOf(a) - timeOf(b); });
    var rows = [];
    var prev = [];
    list.forEach(function (p) {
      var v = viewsOf(p);
      if (prev.length >= o.minPrev) {
        var base = median(prev.slice(-o.window));
        rows.push({ id: p.id != null ? p.id : null, at: timeOf(p), views: v, baseline: base, y: Math.log(v / base), x: featurize(p, o.tzOffsetMinutes) });
      }
      prev.push(v);
    });
    return { rows: rows, used: list.length, recent: prev.slice(-o.window) };
  }

  // ---- ridge regression ------------------------------------------------------------------------------------
  /** Solve A b = c (A symmetric positive definite) by Gaussian elimination with partial pivoting. */
  function solve(A, c) {
    var n = c.length;
    var M = A.map(function (row, i) { return row.slice().concat([c[i]]); });
    for (var col = 0; col < n; col++) {
      var piv = col;
      for (var r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      var t = M[col]; M[col] = M[piv]; M[piv] = t;
      var d = M[col][col];
      if (Math.abs(d) < 1e-12) continue;
      for (var r2 = 0; r2 < n; r2++) {
        if (r2 === col) continue;
        var f = M[r2][col] / d;
        if (!f) continue;
        for (var k = col; k <= n; k++) M[r2][k] -= f * M[col][k];
      }
    }
    return M.map(function (row, i) { return Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]; });
  }
  /** Ridge with an unpenalised intercept (centred X and y). → { beta, intercept } */
  function fitRidge(rows, lambda) {
    var n = rows.length, p = FEATURES.length;
    var mx = new Array(p).fill(0), my = 0;
    rows.forEach(function (r) { my += r.y; for (var j = 0; j < p; j++) mx[j] += r.x[j]; });
    my /= n; for (var j = 0; j < p; j++) mx[j] /= n;
    var A = [], c = new Array(p).fill(0);
    for (var a = 0; a < p; a++) A.push(new Array(p).fill(0));
    rows.forEach(function (r) {
      var xc = r.x.map(function (v, k) { return v - mx[k]; });
      var yc = r.y - my;
      for (var i = 0; i < p; i++) {
        if (!xc[i]) continue;
        c[i] += xc[i] * yc;
        for (var k = 0; k < p; k++) A[i][k] += xc[i] * xc[k];
      }
    });
    for (var d = 0; d < p; d++) A[d][d] += lambda;
    var beta = solve(A, c);
    var intercept = my;
    for (var q = 0; q < p; q++) intercept -= mx[q] * beta[q];
    return { beta: beta, intercept: intercept, mean: mx };
  }
  function predict(m, x) {
    var s = m.intercept;
    for (var j = 0; j < x.length; j++) s += m.beta[j] * x[j];
    return s;
  }
  function mae(m, rows) {
    var s = 0;
    rows.forEach(function (r) { s += Math.abs(r.y - (m ? predict(m, r.x) : 0)); });
    return rows.length ? s / rows.length : null;
  }

  /**
   * Fit and validate. → { shown: true, version, features, beta, intercept, mean, lambda, eval, residuals, recent, … }
   *                  or { shown: false, reason, tr, en, have, need, eval? }
   */
  function train(posts, opts) {
    var o = opt(opts);
    var s = samples(posts, o);
    var n = s.rows.length;
    var nTest = Math.max(o.minTest, Math.round(n * o.testShare));
    var nTrain = n - nTest;
    if (nTrain < o.minTrain) {
      return reason('not-enough-posts', { have: n, need: o.minTrain + o.minTest, postsWithViews: s.used, minPrev: o.minPrev });
    }
    var trainRows = s.rows.slice(0, nTrain);
    var testRows = s.rows.slice(nTrain);

    // λ from a time split inside the training set (its newest quarter).
    var nVal = Math.max(10, Math.round(nTrain * 0.25));
    var fitRows = trainRows.slice(0, nTrain - nVal), valRows = trainRows.slice(nTrain - nVal);
    var lambda = o.lambdas[0], best = Infinity;
    o.lambdas.forEach(function (l) {
      var e = mae(fitRidge(fitRows, l), valRows);
      if (e < best - 1e-12) { best = e; lambda = l; }
    });

    var m = fitRidge(trainRows, lambda);
    var modelMae = mae(m, testRows);
    var baseMae = mae(null, testRows);
    var gain = baseMae > 0 ? 1 - modelMae / baseMae : 0;
    var ev = { train: nTrain, test: nTest, lambda: lambda, mae: round(modelMae), baselineMae: round(baseMae), gain: round(gain),
      testFrom: testRows[0].at, testTo: testRows[testRows.length - 1].at };
    if (!(modelMae < baseMae * (1 - o.minGain))) return reason('no-gain', { eval: ev, have: n });

    var resid = testRows.map(function (r) { return r.y - predict(m, r.x); });
    var full = fitRidge(s.rows, lambda); // the forecast uses every post; the test above decided whether to show it
    return {
      shown: true,
      version: 1,
      features: FEATURES.slice(),
      beta: full.beta.map(round),
      intercept: round(full.intercept),
      mean: full.mean.map(round),
      lambda: lambda,
      eval: ev,
      residuals: { p10: round(quantile(resid, 0.1)), p90: round(quantile(resid, 0.9)) },
      recent: s.recent,
      window: o.window,
      tzOffsetMinutes: o.tzOffsetMinutes,
      lastPostAt: s.rows[n - 1].at,
      n: n
    };
  }
  function round(x) { return x == null ? null : Math.round(x * 1e6) / 1e6; }

  /**
   * A draft through a trained model.
   * draft: { text, format, quote, at (planned time, ms; default now) }
   * opts: { now, recent (newer views to use for the baseline instead of the model's) }
   * → { shown: true, views, low, high, ratio, baseline, drivers: [{ feature, effect (× on views), tr, en }], eval }
   */
  function forecastDraft(model, draft, opts) {
    if (!model || model.shown !== true) return model && model.shown === false ? model : reason('no-model');
    opts = opts || {};
    var recent = Array.isArray(opts.recent) && opts.recent.length ? opts.recent : model.recent;
    var base = median((recent || []).filter(function (v) { return Number.isFinite(v) && v > 0; }).slice(-(model.window || DEFAULTS.window)));
    if (!base) return reason('no-baseline');
    var d = Object.assign({}, draft || {});
    if (d.createdAt == null) d.createdAt = d.at != null ? d.at : (opts.now != null ? opts.now : Date.now());
    var x = featurize(d, model.tzOffsetMinutes);
    var y = predict(model, x);
    var drivers = [];
    x.forEach(function (v, j) {
      var eff = model.beta[j] * (v - model.mean[j]);
      if (v && Math.abs(eff) > 0.01) drivers.push({ feature: FEATURES[j], effect: Math.round(Math.exp(eff) * 100) / 100, tr: LABELS[FEATURES[j]][0], en: LABELS[FEATURES[j]][1], log: eff });
    });
    drivers.sort(function (a, b) { return Math.abs(b.log) - Math.abs(a.log); });
    return {
      shown: true,
      ratio: Math.round(Math.exp(y) * 100) / 100,
      views: Math.round(base * Math.exp(y)),
      low: Math.round(base * Math.exp(y + model.residuals.p10)),
      high: Math.round(base * Math.exp(y + model.residuals.p90)),
      baseline: base,
      drivers: drivers.slice(0, 3).map(function (dr) { return { feature: dr.feature, effect: dr.effect, tr: dr.tr, en: dr.en }; }),
      eval: model.eval
    };
  }

  function forecast(posts, draft, opts) { return forecastDraft(train(posts, opts), draft, opts); }

  return {
    DEFAULTS: DEFAULTS, FEATURES: FEATURES, FORMATS: FORMATS, LABELS: LABELS,
    samples: samples, featurize: featurize, fitRidge: fitRidge, train: train, forecastDraft: forecastDraft, forecast: forecast, median: median
  };
});
