// OpenOutlier – match the same video posted on two platforms (e.g. an "Excel Bug"
// episode on Instagram and on TikTok) and compare how it did on each.
// Pure functions (Node-testable); used by the Library page and the MCP server.
//
// A pair is scored on:
//   caption similarity (words + character trigrams, hashtags/mentions/emoji removed)
//   hashtag overlap, video length (±1.5 s = same), posting date (must be within ±3 days)
// and episode numbers: "Excel Bug #12" never matches "Excel Bug #13".
// Each video is matched at most once (best pairs first).
(function (root, factory) {
  var api = factory(typeof module === 'object' && module.exports ? require('./metrics.js') : root.ReelScopeMetrics);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReelScopeCompare = api;
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';

  var DAY = 864e5;
  var MAX_DAYS = 3;
  var MIN_SCORE = 0.45;
  var WEIGHTS = { text: 0.45, tags: 0.2, duration: 0.2, date: 0.15 };
  var STOP = {};
  ('the a an and or of to in on for with is it this that you your my me i we be are was at as by from how what why when ' +
   've ile bir bu şu da de ki mi mı mu mü için ama gibi daha çok en ne nasıl neden ben sen o biz siz onlar var yok olan olarak').split(' ').forEach(function (w) { STOP[w] = true; });

  function fold(s) {
    return String(s || '').toLocaleLowerCase('tr')
      .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  /** Caption without hashtags, mentions, links and emoji, folded to plain lowercase. */
  function cleanCaption(s) {
    return fold(s)
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[#@][\p{L}\p{N}_.]+/gu, ' ')
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function words(clean) {
    return clean.split(' ').filter(function (w) { return w && !STOP[w] && (w.length > 1 || /\d/.test(w)); });
  }

  function trigrams(clean) {
    var s = ' ' + clean.replace(/\s+/g, ' ') + ' ';
    var out = {};
    for (var i = 0; i < s.length - 2; i++) out[s.slice(i, i + 3)] = true;
    return out;
  }

  function dice(a, b) {
    var ka = Object.keys(a);
    var kb = Object.keys(b);
    if (!ka.length || !kb.length) return 0;
    var common = 0;
    ka.forEach(function (k) { if (b[k]) common++; });
    return (2 * common) / (ka.length + kb.length);
  }

  function setOf(list) { var o = {}; list.forEach(function (x) { o[x] = true; }); return o; }

  /** Episode-style numbers in a caption or its hashtags ("bug #12", "part 3", "#excelbug12"). */
  function numbers(p) {
    var text = fold((p.caption || '') + ' ' + (p.hashtags || []).join(' '));
    var out = {};
    (text.match(/\d{1,4}/g) || []).forEach(function (n) {
      n = String(Number(n));
      // Years and very common counts ("2026", "3 ways") are weak; years are dropped.
      if (Number(n) >= 1900 && Number(n) <= 2100) return;
      out[n] = true;
    });
    return out;
  }

  function prep(p) {
    var clean = cleanCaption(p.caption);
    return { p: p, clean: clean, words: setOf(words(clean)), grams: trigrams(clean), tags: setOf((p.hashtags || []).map(fold)), nums: numbers(p) };
  }

  /** How alike two prepared posts are. → { score 0–1, parts } or null when they can't be the same video. */
  function similarity(a, b) {
    var pa = a.p;
    var pb = b.p;
    var days = pa.takenAt && pb.takenAt ? Math.abs(pa.takenAt - pb.takenAt) / DAY : null;
    if (days !== null && days > MAX_DAYS) return null;
    var hasText = a.clean.length >= 4 && b.clean.length >= 4;
    var text = hasText ? Math.max(dice(a.words, b.words), dice(a.grams, b.grams)) : 0;
    var ta = Object.keys(a.tags);
    var tb = Object.keys(b.tags);
    var tags = ta.length && tb.length ? dice(a.tags, b.tags) : null;
    var dur = null;
    if (pa.duration > 0 && pb.duration > 0) {
      var d = Math.abs(pa.duration - pb.duration);
      dur = d <= 1.5 ? 1 : d <= 3 ? 0.6 : d <= 6 ? 0.2 : 0;
    }
    var date = days === null ? null : 1 - (days / MAX_DAYS) * 0.6;
    // Missing signals are left out and the others re-weighted.
    var parts = { text: hasText ? text : null, tags: tags, duration: dur, date: date };
    var sum = 0;
    var w = 0;
    Object.keys(WEIGHTS).forEach(function (k) { if (parts[k] !== null) { sum += parts[k] * WEIGHTS[k]; w += WEIGHTS[k]; } });
    if (!w) return null;
    var score = sum / w;
    // Episode numbers on both sides that never overlap: a different episode.
    var na = Object.keys(a.nums);
    var nb = Object.keys(b.nums);
    var numClash = na.length && nb.length && !na.some(function (n) { return b.nums[n]; });
    if (numClash) score *= 0.35;
    // No date on one side: only trust clearly similar captions.
    if (days === null && text < 0.6) score *= 0.6;
    if (dur === 0) score *= 0.7;
    return { score: Math.round(score * 1000) / 1000, days: days, parts: parts, numClash: !!numClash };
  }

  function isVideo(p) { return p.type === 'reel' || p.type === 'video'; }

  function side(p) {
    return {
      code: p.code, url: p.url, account: p.owner, platform: p.platform || 'instagram', posted_at: p.takenAt || null,
      views: p.views == null ? null : p.views, likes: p.likes == null ? null : p.likes, comments: p.comments == null ? null : p.comments,
      shares: p.shares == null ? null : p.shares, saves: p.saves == null ? null : p.saves,
      duration: p.duration || null, engagement: p.engagement == null ? null : p.engagement,
      ratio: p.ratio == null ? null : p.ratio, viralScore: p.viralScore == null ? null : p.viralScore,
      caption: p.caption || '', thumb: p.thumb || null
    };
  }

  /**
   * Match videos of account A with videos of account B.
   * a, b: enriched posts (each scored against its own account's median: ratio, viralScore, engagement).
   * opts: { minScore }
   * → { pairs: [{ score, confidence, days, a, b, winner, viewsRatio }], onlyA: [...], onlyB: [...], summary }
   */
  function match(a, b, opts) {
    opts = opts || {};
    var min = opts.minScore != null ? opts.minScore : MIN_SCORE;
    var A = a.filter(isVideo).map(prep);
    var B = b.filter(isVideo).map(prep);
    var cands = [];
    A.forEach(function (x, i) {
      B.forEach(function (y, j) {
        var s = similarity(x, y);
        if (s && s.score >= min) cands.push({ i: i, j: j, s: s });
      });
    });
    cands.sort(function (x, y) { return y.s.score - x.s.score || (x.s.days || 0) - (y.s.days || 0); });
    var usedA = {};
    var usedB = {};
    var pairs = [];
    cands.forEach(function (c) {
      if (usedA[c.i] || usedB[c.j]) return;
      usedA[c.i] = usedB[c.j] = true;
      var pa = A[c.i].p;
      var pb = B[c.j].p;
      var winner = pa.ratio != null && pb.ratio != null ? (pa.ratio >= pb.ratio ? 'a' : 'b') : null;
      pairs.push({
        score: c.s.score,
        confidence: c.s.score >= 0.7 ? 'high' : c.s.score >= 0.55 ? 'medium' : 'low',
        days: c.s.days == null ? null : Math.round(c.s.days * 10) / 10,
        parts: c.s.parts,
        a: side(pa),
        b: side(pb),
        viewsRatio: pa.views > 0 && pb.views > 0 ? pb.views / pa.views : null,
        winner: winner
      });
    });
    pairs.sort(function (x, y) { return (y.a.posted_at || y.b.posted_at || 0) - (x.a.posted_at || x.b.posted_at || 0); });
    var onlyA = A.filter(function (x, i) { return !usedA[i]; }).map(function (x) { return side(x.p); });
    var onlyB = B.filter(function (x, j) { return !usedB[j]; }).map(function (x) { return side(x.p); });
    return { pairs: pairs, onlyA: onlyA, onlyB: onlyB, summary: summarize(pairs, A.length, B.length) };
  }

  function summarize(pairs, nA, nB) {
    var both = pairs.filter(function (p) { return p.a.views > 0 && p.b.views > 0; });
    var logs = both.map(function (p) { return Math.log(p.b.views / p.a.views); });
    var meanLog = logs.length ? logs.reduce(function (s, v) { return s + v; }, 0) / logs.length : null;
    var decided = pairs.filter(function (p) { return p.winner; });
    return {
      videosA: nA,
      videosB: nB,
      matched: pairs.length,
      // Typical B ÷ A views for the same video (geometric mean, so one viral hit doesn't dominate).
      typicalViewsRatio: meanLog === null ? null : Math.exp(meanLog),
      medianViewsA: M.median(pairs.map(function (p) { return p.a.views; })),
      medianViewsB: M.median(pairs.map(function (p) { return p.b.views; })),
      medianRatioA: M.median(pairs.map(function (p) { return p.a.ratio; })),
      medianRatioB: M.median(pairs.map(function (p) { return p.b.ratio; })),
      medianEngagementA: M.median(pairs.map(function (p) { return p.a.engagement; })),
      medianEngagementB: M.median(pairs.map(function (p) { return p.b.engagement; })),
      winsA: decided.filter(function (p) { return p.winner === 'a'; }).length,
      winsB: decided.filter(function (p) { return p.winner === 'b'; }).length,
      // Same video, both over 2× their own account's median: a hit everywhere.
      hitsOnBoth: pairs.filter(function (p) { return p.a.ratio >= M.OUTLIER_RATIO && p.b.ratio >= M.OUTLIER_RATIO; }).length
    };
  }

  return { match: match, similarity: function (a, b) { return similarity(prep(a), prep(b)); }, cleanCaption: cleanCaption, MAX_DAYS: MAX_DAYS, MIN_SCORE: MIN_SCORE };
});
