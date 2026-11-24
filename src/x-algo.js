// OpenOutlier – X ranking weights and the "algo signal" badge (docs/x-plan.md 6, phase 6).
//
// WEIGHTS is a dated copy of the For You ranking weights published in xai-org/x-algorithm
// (Apache-2.0), home-mixer/params/param.rs. The bridge (mcp/x-watch.mjs) checks GitHub weekly
// and keeps a newer copy in its database; callers pass that one in, or get this bundled one.
//
// The weights multiply the model's *predicted probability* of each action for one viewer, not raw
// counts. algoSignal() uses the observed rates (likes ÷ views, …) as a public proxy for those
// probabilities, so it is a rough "how much of what the ranker rewards did this post get", not
// X's score. Negative signals (not interested, mute, block, report) are never visible to anyone
// but X, so the signal cannot subtract them; the result says so.
//
// Pure functions; UMD: self.OpenOutlierXAlgo.
'use strict';

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpenOutlierXAlgo = api;
})(typeof self !== 'undefined' ? self : this, function () {
  var SOURCE_URL = 'https://github.com/xai-org/x-algorithm/blob/main/home-mixer/params/param.rs';
  var RAW_URL = 'https://raw.githubusercontent.com/xai-org/x-algorithm/main/home-mixer/params/param.rs';

  /** Our name → the param key in param.rs (`param!(Name, f64, "<key>", value)`). */
  var PARAM_KEYS = {
    favorite: 'rust_home_mixer_favorite_weight',
    reply: 'rust_home_mixer_reply_weight',
    bidirectionalReplyBoost: 'rust_home_mixer_bidirectional_follow_reply_weight_boost',
    retweet: 'rust_home_mixer_retweet_weight',
    quote: 'rust_home_mixer_quote_weight',
    share: 'rust_home_mixer_share_weight',
    shareViaDm: 'rust_home_mixer_share_via_dm_weight',
    shareViaCopyLink: 'rust_home_mixer_share_via_copy_link_weight',
    followAuthor: 'rust_home_mixer_follow_author_weight',
    profileClick: 'rust_home_mixer_profile_click_weight',
    click: 'rust_home_mixer_click_weight',
    openLink: 'rust_home_mixer_open_link_weight',
    photoExpand: 'rust_home_mixer_photo_expand_weight',
    videoOpen: 'rust_home_mixer_video_open_weight',
    vqv: 'rust_home_mixer_vqv_weight',
    dwell: 'rust_home_mixer_dwell_weight',
    contDwellTime: 'rust_home_mixer_cont_dwell_time_weight',
    contClickDwellTime: 'rust_home_mixer_cont_click_dwell_time_weight',
    quotedClick: 'rust_home_mixer_quoted_click_weight',
    notInterested: 'rust_home_mixer_not_interested_weight',
    muteAuthor: 'rust_home_mixer_mute_author_weight',
    blockAuthor: 'rust_home_mixer_block_author_weight',
    report: 'rust_home_mixer_report_weight',
    notDwelled: 'rust_home_mixer_not_dwelled_weight'
  };
  var COLD_START_KEYS = {
    impressionThreshold: 'rust_home_mixer_cold_start_impression_threshold',
    followerCap: 'rust_home_mixer_cold_start_follower_cap',
    maxPostAgeSecs: 'rust_home_mixer_cold_start_max_post_age_secs'
  };
  /** Never observable from outside X. */
  var NEGATIVE = ['notInterested', 'muteAuthor', 'blockAuthor', 'report', 'notDwelled'];

  /** The bundled copy (read 2026-11-24, commit e005f95 of 2026-11-24T08:24:35Z). */
  var WEIGHTS = {
    version: '2026-11-24',
    source: SOURCE_URL,
    raw: RAW_URL,
    commit: 'e005f9528e504596f2c024a274d5fb533ce6488a',
    committedAt: '2026-11-24T08:24:35Z',
    license: 'Apache-2.0 (xai-org/x-algorithm)',
    weights: {
      favorite: 0.708,
      reply: 5.0,
      bidirectionalReplyBoost: 15.0,
      retweet: 1.0,
      quote: 5.0,
      share: 2.118,
      shareViaDm: 5.0,
      shareViaCopyLink: 20.0,
      followAuthor: 4.0,
      profileClick: 0.0,
      click: 0.274,
      openLink: 0.2,
      photoExpand: 0.05,
      videoOpen: 0.0,
      vqv: 0.0,
      dwell: 0.05,
      contDwellTime: 0.0075,
      contClickDwellTime: 0.385,
      quotedClick: 0.05,
      notInterested: -53.07,
      muteAuthor: -58.8,
      blockAuthor: -31.2,
      report: -234.0,
      notDwelled: -0.02
    },
    coldStart: { impressionThreshold: 200, followerCap: 50000, maxPostAgeSecs: 7200 },
    // From docs/x-research.md 5 (MAX_POST_AGE, not in param.rs): For You drops posts older than 48 h.
    maxPostAgeHours: 48
  };

  /**
   * The public counters the signal uses: { counter field on the post, weight name, label }.
   * Bookmarks have no weight of their own in param.rs; views are the denominator.
   */
  var OBSERVED = [
    { field: 'likes', weight: 'favorite', tr: 'beğeni', en: 'likes' },
    { field: 'replies', weight: 'reply', tr: 'yanıt', en: 'replies' },
    { field: 'reposts', weight: 'retweet', tr: 'repost', en: 'reposts' },
    { field: 'quotes', weight: 'quote', tr: 'alıntı', en: 'quotes' }
  ];
  // Accepted spellings of each counter (src/x.js may use legacy names).
  var ALIASES = {
    views: ['views', 'viewCount', 'view_count', 'impressions'],
    likes: ['likes', 'likeCount', 'favorite_count', 'favorites', 'favs'],
    replies: ['replies', 'replyCount', 'reply_count'],
    reposts: ['reposts', 'retweets', 'repostCount', 'retweet_count'],
    quotes: ['quotes', 'quoteCount', 'quote_count']
  };
  function count(post, name) {
    var keys = ALIASES[name];
    for (var i = 0; i < keys.length; i++) {
      var v = post[keys[i]];
      if (v == null || v === '') continue;
      var n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n)) return n;
    }
    return null;
  }

  var NOTE = {
    tr: 'Gözlenen oranlar (÷ görüntülenme) × x-algorithm ağırlıkları. Negatif sinyaller (ilgilenmiyorum, sessize alma, engelleme, şikayet) dışarıdan görülemez, bu yüzden düşülmedi. X\'in kendi puanı değildir.',
    en: 'Observed rates (÷ views) × x-algorithm weights. Negative signals (not interested, mute, block, report) are not visible from outside, so they are not subtracted. This is not X\'s own score.'
  };

  /** Valid weights object (a stored newer copy) or the bundled one. */
  function pick(w) {
    return w && w.weights && typeof w.weights === 'object' && Number.isFinite(w.weights.favorite) ? w : WEIGHTS;
  }

  /**
   * Σ (count ÷ views) × weight over likes, replies, reposts and quotes.
   * post: { views, likes, replies, reposts, quotes } (strings allowed, like X's views.count).
   * opts: { weights (a versioned object like WEIGHTS) }
   * → null without views (or views ≤ 0); else
   *   { score, per1k (score × 1000), terms: [{ signal, count, rate, weight, contribution }],
   *     negativeObservable: false, missing: [counters not present], version, note: { tr, en } }
   */
  function algoSignal(post, opts) {
    if (!post || typeof post !== 'object') return null;
    var views = count(post, 'views');
    if (views == null || !(views > 0)) return null;
    var W = pick(opts && opts.weights);
    var terms = [];
    var missing = [];
    var score = 0;
    OBSERVED.forEach(function (o) {
      var c = count(post, o.field);
      var w = W.weights[o.weight];
      if (c == null) { missing.push(o.field); return; }
      if (!Number.isFinite(w)) return;
      var rate = c / views;
      var contribution = rate * w;
      score += contribution;
      terms.push({ signal: o.field, weightName: o.weight, count: c, rate: rate, weight: w, contribution: contribution });
    });
    if (!terms.length) return null;
    return {
      score: score,
      per1k: Math.round(score * 1000 * 10) / 10,
      views: views,
      terms: terms,
      negativeObservable: false,
      negativeSignals: NEGATIVE.slice(),
      missing: missing,
      version: W.version,
      note: NOTE
    };
  }

  function median(xs) {
    var a = xs.filter(function (x) { return Number.isFinite(x); }).sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  /**
   * The post's signal against the median signal of other posts (e.g. the author's originals).
   * → null when the post has no signal or fewer than `min` (5) others do; else { ratio, median, score, n }
   */
  function signalVsMedian(post, others, opts) {
    var me = algoSignal(post, opts);
    if (!me) return null;
    var scores = (others || []).map(function (p) { var s = algoSignal(p, opts); return s ? s.score : null; }).filter(function (x) { return x != null; });
    var min = (opts && opts.min) || 5;
    if (scores.length < min) return null;
    var med = median(scores);
    return { score: me.score, median: med, ratio: med > 0 ? me.score / med : null, n: scores.length };
  }

  /** [{ key, from, to }] between two versioned weight objects (weights and coldStart). */
  function diffWeights(a, b) {
    var out = [];
    ['weights', 'coldStart'].forEach(function (group) {
      var x = (a && a[group]) || {}, y = (b && b[group]) || {};
      var keys = Object.keys(x).concat(Object.keys(y).filter(function (k) { return !(k in x); }));
      keys.forEach(function (k) {
        var f = x[k] == null ? null : x[k], t = y[k] == null ? null : y[k];
        if (f !== t) out.push({ key: group === 'weights' ? k : group + '.' + k, from: f, to: t });
      });
    });
    return out;
  }

  return {
    WEIGHTS: WEIGHTS, PARAM_KEYS: PARAM_KEYS, COLD_START_KEYS: COLD_START_KEYS, NEGATIVE: NEGATIVE, OBSERVED: OBSERVED,
    SOURCE_URL: SOURCE_URL, RAW_URL: RAW_URL, NOTE: NOTE,
    algoSignal: algoSignal, signalVsMedian: signalVsMedian, diffWeights: diffWeights, pick: pick, median: median
  };
});
