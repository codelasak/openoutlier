// OpenOutlier – scoring, analytics and CSV. Pure functions (Node-testable).
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReelScopeMetrics = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var OUTLIER_RATIO = 2; // ≥ 2× the profile's median views = outlier
  // Instagram carousels and photos are scored by likes. With fewer than this many
  // to compare with, a "2× post" is the sample, not an outlier: no score yet.
  var MIN_BASELINE = 8;
  // A post this new is still collecting views and likes: it gets a score, but stays out of the median.
  var FRESH_MS = 72 * 3600 * 1000;
  var DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var BLOCK_HOURS = 3;
  var DURATION_BUCKETS = [
    { label: '< 15s', max: 15 },
    { label: '15–30s', max: 30 },
    { label: '30–60s', max: 60 },
    { label: '1–1.5 min', max: 90 },
    { label: '1.5–3 min', max: 180 },
    { label: '3 min +', max: Infinity }
  ];
  // YouTube long-form videos run far longer than reels.
  var LONG_BUCKETS = [
    { label: '< 5 min', max: 300 },
    { label: '5–10 min', max: 600 },
    { label: '10–20 min', max: 1200 },
    { label: '20–40 min', max: 2400 },
    { label: '40 min +', max: Infinity }
  ];

  function median(values) {
    var a = values.filter(function (v) { return typeof v === 'number' && isFinite(v); }).sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }

  function mean(values) {
    var a = values.filter(function (v) { return typeof v === 'number' && isFinite(v); });
    if (!a.length) return null;
    return a.reduce(function (s, v) { return s + v; }, 0) / a.length;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function isInstagram(p) { return !!p && (!p.platform || p.platform === 'instagram'); }
  function isX(p) { return !!p && p.platform === 'x'; }
  /** Instagram shows no view count on carousels and photos, so those are ranked by likes. */
  function isLikesScored(p) { return isInstagram(p) && (p.type === 'carousel' || p.type === 'photo'); }

  /**
   * The number a post is ranked by: views on reels and videos (Instagram, TikTok,
   * YouTube), likes on Instagram carousels and photos, score (upvotes) on Reddit.
   */
  function val(p) { return p && p.platform === 'reddit' ? p.score : isLikesScored(p) ? p.likes : p.views; }
  /** 'views' | 'likes' | 'score': what val() counts for this post. */
  function basisOf(p) { return p && p.platform === 'reddit' ? 'score' : isLikesScored(p) ? 'likes' : 'views'; }

  /**
   * Interactions that count toward engagement. TikTok shows shares and saves
   * publicly, so they count there; Instagram only reliably shows likes and
   * comments; Reddit uses comments (÷ score).
   */
  function interactions(p) {
    // Reddit and Instagram carousels/photos: comments per 100 upvotes / likes.
    if (p.platform === 'reddit' || isLikesScored(p)) return p.comments || 0;
    // YouTube: likes + comments where known (channel tabs show neither; watch pages show both).
    if (p.platform === 'tiktok') return (p.likes || 0) + (p.comments || 0) + (p.shares || 0) + (p.saves || 0);
    // X: likes + replies + reposts + quotes + bookmarks (all public on every post).
    if (p.platform === 'x') return (p.likes || 0) + (p.comments || 0) + (p.shares || 0) + (p.quotes || 0) + (p.saves || 0);
    return (p.likes || 0) + (p.comments || 0);
  }
  function isTikTok(p) { return !!p && p.platform === 'tiktok'; }
  function isYouTube(p) { return !!p && p.platform === 'youtube'; }
  /** YouTube Shorts and long-form get separate medians: Shorts get far more views. */
  function formatOf(p) { return p.type === 'short' ? 'short' : 'long'; }
  function engagementOf(p, v) {
    if (!(v > 0)) return null;
    if (isYouTube(p) && p.likes == null && p.comments == null) return null;
    return (interactions(p) / v) * 100;
  }

  /**
   * Viral Score (0–100) compares a post's views to the profile's own median:
   *   score = 50 + 25 × log2(views / median)
   * 1× median → 50, 2× → 75, 4×+ → 100, ½× → 25, ¼× or less → 0.
   */
  function viralScore(views, med) {
    if (!(views > 0) || !(med > 0)) return null;
    return Math.round(clamp(50 + 25 * Math.log2(views / med), 0, 100));
  }

  /**
   * Add ratio / viralScore / engagement / outlier to each post (returns new objects).
   * Reddit: ratio is against the median score; engagement = comments ÷ score × 100.
   * YouTube: each video is scored against its own channel's median for its format
   * (Shorts vs long-form, live streams count as long-form). Other posts share one median, as before.
   */
  function medianGroup(p) { return isYouTube(p) ? 'yt|' + p.owner + '|' + formatOf(p) : isLikesScored(p) ? 'ig-posts' : ''; }

  /** Pinned posts (usually the account's best) and posts under 72 hours old don't define "normal". */
  function inBaseline(p, now) {
    return !p.pinned && !(p.takenAt && now - p.takenAt < FRESH_MS && now >= p.takenAt);
  }

  /**
   * The keyword of a "comment X and I'll send you the link" call to action, upper-cased, or null.
   * Those posts collect comments from the giveaway, not from the content, so they are flagged.
   */
  var DQ = '["“”„«»]';
  var NOT_DQ = '[^"“”„«»\\n]';
  var KEYWORD_RES = [
    // Comment "CFO" · Comment below “AI”
    new RegExp('\\bcomment(?:s|ing)?\\b[^"“”„«»\\n.!?]{0,24}' + DQ + '(' + NOT_DQ + '{1,30})' + DQ, 'i'),
    // comment 'guide' (one word: an apostrophe is not a quote, "comment and I'll send it")
    new RegExp('\\bcomment(?:s|ing)?\\b[^\\n]{0,24}?\\s[\'‘]([\\p{L}\\p{N}_-]{2,20})[\'’](?![\\p{L}\\p{N}])', 'iu'),
    // Drop "CFO" in the comments · type "guide" below
    new RegExp('\\b(?:drop|type|write|leave|send|say)\\s+' + DQ + '(' + NOT_DQ + '{1,30})' + DQ + '\\s+(?:in\\s+the\\s+comments?|below)', 'i'),
    // Yorumlara "EXCEL" yaz
    new RegExp('\\byorum\\p{L}*' + NOT_DQ + '{0,12}' + DQ + '(' + NOT_DQ + '{1,30})' + DQ, 'iu'),
    // Comment CFO (a bare word in capitals)
    /\b[Cc]omment\s+(?:the\s+word\s+)?([A-Z][A-Z0-9]{1,19})\b/
  ];
  function commentKeyword(caption) {
    var text = String(caption || '');
    if (text.length < 9) return null;
    for (var i = 0; i < KEYWORD_RES.length; i++) {
      var m = KEYWORD_RES[i].exec(text);
      var k = m && m[1].trim();
      // A keyword is a word or two, not a quoted sentence.
      if (k && /[\p{L}\p{N}]/u.test(k) && k.split(/\s+/).length <= 3) return k.toUpperCase();
    }
    return null;
  }

  /**
   * Scores every post against the median of its own group. opts.now (ms) is "today" for the 72-hour rule.
   * Adds: ratio, viralScore, outlier, engagement, basis ('views' | 'likes' | 'score'),
   * commentRatio (comments ÷ the group's median comments), commentsPer100Likes, commentKeyword.
   */
  /** The median a list was scored against, when all of it shares one (else null). */
  function baselineOf(posts) {
    var b = posts.length ? posts[0].baseline : null;
    if (b === null || b === undefined) return null;
    for (var i = 1; i < posts.length; i++) if (posts[i].baseline !== b) return null;
    return b;
  }

  // ---- X (docs/x-plan.md 1, Faz 0 deviations) ----------------------------------
  // Views ÷ the author's median of ORIGINAL posts (replies, thread parts and reposts stay out of
  // the median), one median per format (text, image, video, thread, article, link, quote). Only
  // posts with a view count count (X shows none on posts before 2023). The baseline is the
  // newest originals of the last 90 days or the last 50, whichever is more. A format with fewer
  // than 8 such posts falls back to the author's overall median, marked approximate (≈); with
  // fewer than 8 overall there is no score ("not enough data").
  var X_WINDOW_MS = 90 * 24 * 3600 * 1000;
  var X_MIN_RECENT = 50;
  var X_FRESH_MS = 24 * 3600 * 1000; // X posts collect most of their views within a day
  function xKind(p) { return p.kind || (p.isRepost ? 'repost' : p.isReply ? 'reply' : 'original'); }
  function xInBaseline(p, now) {
    return xKind(p) === 'original' && p.views > 0 && !p.pinned && !p.promoted && !(p.takenAt && now - p.takenAt < X_FRESH_MS && now >= p.takenAt);
  }
  /**
   * Per-author X baselines from a list of X posts.
   * → { owner: { all: number|null, n, byFormat: { format: { med, n } }, approx: bool (from page posts, not the Library) } }
   * opts.now; opts.approx marks every baseline as approximate (badges computed from a page's posts).
   */
  function xBaselines(posts, opts) {
    var now = (opts && opts.now) || Date.now();
    var by = {};
    posts.forEach(function (p) {
      if (!isX(p) || !p.owner) return;
      (by[p.owner] = by[p.owner] || []).push(p);
    });
    var out = {};
    Object.keys(by).forEach(function (owner) {
      var pool = by[owner].filter(function (p) { return xInBaseline(p, now); })
        .sort(function (a, b) { return (b.takenAt || 0) - (a.takenAt || 0); });
      var recent = pool.filter(function (p) { return p.takenAt && now - p.takenAt <= X_WINDOW_MS; }).length;
      var take = pool.slice(0, Math.max(recent, X_MIN_RECENT));
      var byFormat = {};
      take.forEach(function (p) { (byFormat[p.type || 'text'] = byFormat[p.type || 'text'] || []).push(p.views); });
      var fm = {};
      Object.keys(byFormat).forEach(function (f) { fm[f] = { med: byFormat[f].length >= MIN_BASELINE ? median(byFormat[f]) : null, n: byFormat[f].length }; });
      out[owner] = { all: take.length >= MIN_BASELINE ? median(take.map(function (p) { return p.views; })) : null, n: take.length, byFormat: fm, approx: !!(opts && opts.approx) };
    });
    return out;
  }
  /**
   * The median an X post is scored against → { med, approx, scope: 'format' | 'all' | null }.
   * Originals: their format's median, else the overall one (approx). Replies and thread parts: the
   * overall originals median. Reposts: none (a repost has no views of its own). single: one median per author.
   */
  function xBaselineFor(p, b, single) {
    var none = { med: null, approx: false, scope: null };
    if (!b || xKind(p) === 'repost') return none;
    if (xKind(p) === 'original' && !single) {
      var f = b.byFormat[p.type || 'text'];
      if (f && f.med) return { med: f.med, approx: !!b.approx, scope: 'format' };
      if (b.all) return { med: b.all, approx: true, scope: 'all' };
      return none;
    }
    return b.all ? { med: b.all, approx: !!b.approx, scope: 'all' } : none;
  }

  /**
   * opts.xBaselines: { owner: baseline } from the Library (xBaselines over each saved account), used
   * before anything computed from `posts`; opts.xSingleMedian: one median per author instead of per format.
   */
  function enrich(posts, opts) {
    var now = (opts && opts.now) || Date.now();
    var groups = {};
    var xs = posts.filter(isX);
    var xb = xs.length ? xBaselines(xs, { now: now }) : {};
    if (opts && opts.xBaselines) Object.keys(opts.xBaselines).forEach(function (k) { if (opts.xBaselines[k]) xb[k] = opts.xBaselines[k]; });
    posts.forEach(function (p) {
      if (isX(p)) return;
      var g = groups[medianGroup(p)] || (groups[medianGroup(p)] = { all: [], base: [], comments: [], likesScored: isLikesScored(p) });
      var v = val(p);
      g.all.push(v > 0 ? v : null);
      if (!inBaseline(p, now)) return;
      g.base.push(v > 0 ? v : null);
      if (typeof p.comments === 'number') g.comments.push(p.comments);
    });
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      var n = g.base.filter(function (v) { return v !== null; }).length;
      // Everything pinned or brand new: fall back to what there is.
      g.med = median(n ? g.base : g.all);
      if (g.likesScored && (n || g.all.filter(function (v) { return v !== null; }).length) < MIN_BASELINE) g.med = null;
      g.medComments = g.med === null ? null : median(g.comments);
    });
    return posts.map(function (p) {
      var v = val(p);
      if (isX(p)) {
        var xbf = xBaselineFor(p, xb[p.owner], opts && opts.xSingleMedian);
        var xr = v > 0 && xbf.med > 0 ? v / xbf.med : null;
        return Object.assign({}, p, {
          ratio: xr,
          viralScore: viralScore(v, xbf.med),
          engagement: engagementOf(p, v),
          outlier: xr !== null && xr >= OUTLIER_RATIO,
          basis: 'views',
          baseline: xbf.med,
          baselineApprox: xbf.approx,
          baselineScope: xbf.scope,
          noViews: p.views === null || p.views === undefined,
          commentRatio: null,
          commentsPer100Likes: typeof p.comments === 'number' && p.likes > 0 ? p.comments / p.likes * 100 : null,
          commentKeyword: null
        });
      }
      var g = groups[medianGroup(p)];
      var med = g.med;
      var ratio = v > 0 && med > 0 ? v / med : null;
      return Object.assign({}, p, {
        ratio: ratio,
        viralScore: viralScore(v, med),
        engagement: engagementOf(p, v),
        outlier: ratio !== null && ratio >= OUTLIER_RATIO,
        basis: basisOf(p),
        baseline: med, // the median this post was scored against
        commentRatio: typeof p.comments === 'number' && g.medComments > 0 ? p.comments / g.medComments : null,
        commentsPer100Likes: typeof p.comments === 'number' && p.likes > 0 && p.platform !== 'reddit' ? p.comments / p.likes * 100 : null,
        commentKeyword: p.platform === 'reddit' ? null : commentKeyword(p.caption)
      });
    });
  }

  var SORTERS = {
    // "Views" stays views: carousels and photos (ranked by likes) have none and go last.
    views: function (p) { return p && p.platform === 'reddit' ? p.score : p.views; },
    score: val,
    commentRatio: function (p) { return p.commentRatio; },
    slides: function (p) { return p.slides; },
    upvoteRatio: function (p) { return p.upvoteRatio; },
    // Score is capped at 100, so rank by the uncapped ratio (same order, no ties at the top).
    viralScore: function (p) { return p.viralScore === null || p.viralScore === undefined ? null : p.ratio; },
    likes: function (p) { return p.likes; },
    comments: function (p) { return p.comments; },
    shares: function (p) { return p.shares; },
    saves: function (p) { return p.saves; },
    engagement: function (p) { return p.engagement; },
    date: function (p) { return p.takenAt; },
    duration: function (p) { return p.duration; }
  };

  /** Sort descending by key; missing values always go last. */
  function sortBy(posts, key, ascending) {
    var get = SORTERS[key] || SORTERS.views;
    return posts.slice().sort(function (a, b) {
      var va = get(a);
      var vb = get(b);
      var na = va === null || va === undefined;
      var nb = vb === null || vb === undefined;
      if (na && nb) return 0;
      if (na) return 1;
      if (nb) return -1;
      return ascending ? va - vb : vb - va;
    });
  }

  function dayIndex(date) { return (date.getDay() + 6) % 7; } // Mon = 0

  // ---- best time to post ----------------------------------------------------
  //
  // Raw median views per slot mixes up *when* a post went out with *how big the
  // account was then* (old slots look bad because the account was small). So:
  //  1. each post is scored against the median of the posts around it in time
  //     (its era), not the all-time median, then centred so the account's
  //     average post is 1×;
  //  2. a slot's lift is the mean log2 of those ratios, shrunk toward 1× by
  //     SLOT_PRIOR pseudo-posts, so a slot with 4 lucky posts can't beat one
  //     with 50;
  //  3. slots need SLOT_MIN_POSTS to be ranked; days and hours are also scored
  //     on their own (7 + 8 groups instead of 56 cells, much more data each);
  //  4. we report each slot's share of posts and flag accounts that post in
  //     too few slots to compare ("they always post then" ≠ "it works then").
  var SLOT_MIN_POSTS = 8;
  var SLOT_PRIOR = 8;          // pseudo-posts at 1× pulling small slots toward neutral
  var ERA_WINDOW = 15;         // posts on each side used for the era median
  var LOG_CLIP = 3;            // cap one post's pull at 8× / ⅛× so a single viral hit can't own a slot
  var CONCENTRATED_SHARE = 0.7;

  /** For each post (with a date and views), views ÷ median views of the ±ERA_WINDOW posts around it. */
  function eraRatios(posts) {
    var dated = posts.filter(function (p) { return p.takenAt && val(p) > 0; })
      .sort(function (a, b) { return a.takenAt - b.takenAt; });
    var overall = median(dated.map(val));
    return dated.map(function (p, i) {
      var ref = dated.length > 2 * ERA_WINDOW
        ? median(dated.slice(Math.max(0, i - ERA_WINDOW), i + ERA_WINDOW + 1).map(val))
        : overall;
      return { post: p, ratio: ref > 0 ? val(p) / ref : null };
    }).filter(function (r) { return r.ratio > 0; });
  }

  function confidenceOf(n) { return n >= 20 ? 'high' : n >= SLOT_MIN_POSTS ? 'medium' : 'low'; }

  /** Turn collected { views, logs } into the public slot stats. */
  function slotStats(c, total) {
    var n = c.logs.length;
    var sum = c.logs.reduce(function (s, v) { return s + v; }, 0);
    c.count = n;
    c.share = total ? n / total : 0;
    c.avgViews = mean(c.views);
    c.medianViews = median(c.views);
    c.rawLift = n ? Math.pow(2, sum / n) : null;           // geometric mean of era ratios
    c.lift = n ? Math.pow(2, sum / (n + SLOT_PRIOR)) : null; // shrunk toward 1×
    c.confidence = confidenceOf(n);
    delete c.views;
    delete c.logs;
    return c;
  }

  function addTo(c, r) {
    c.views.push(val(r.post));
    c.logs.push(r.log);
  }

  function bestOf(list) {
    var best = null;
    list.forEach(function (c) {
      if (c.count >= SLOT_MIN_POSTS && (!best || c.lift > best.lift)) best = c;
    });
    return best;
  }

  function heatmap(posts) {
    var blocks = 24 / BLOCK_HOURS;
    var cells = [];
    var days = [];
    var hours = [];
    for (var d = 0; d < 7; d++) {
      cells.push([]);
      days.push({ day: d, views: [], logs: [] });
      for (var b = 0; b < blocks; b++) cells[d].push({ day: d, block: b, views: [], logs: [] });
    }
    for (var hb = 0; hb < blocks; hb++) hours.push({ block: hb, views: [], logs: [] });

    // Centre the (clipped) log ratios so the account's average post is exactly
    // 1×: views are skewed, so the mean log ratio is rarely 0 on its own.
    var rated = eraRatios(posts);
    rated.forEach(function (r) { r.log = clamp(Math.log2(r.ratio), -LOG_CLIP, LOG_CLIP); });
    var centre = mean(rated.map(function (r) { return r.log; })) || 0;
    rated.forEach(function (r) {
      r.log -= centre;
      var dt = new Date(r.post.takenAt);
      var di = dayIndex(dt);
      var bi = Math.floor(dt.getHours() / BLOCK_HOURS);
      addTo(cells[di][bi], r);
      addTo(days[di], r);
      addTo(hours[bi], r);
    });
    var total = rated.length;
    var flat = [];
    cells.forEach(function (row) { row.forEach(function (c) { flat.push(slotStats(c, total)); }); });
    days.forEach(function (c) { slotStats(c, total); });
    hours.forEach(function (c) { slotStats(c, total); });

    var ranked = flat.filter(function (c) { return c.count >= SLOT_MIN_POSTS; });
    var topTwoShare = flat.map(function (c) { return c.share; }).sort(function (a, b) { return b - a; })
      .slice(0, 2).reduce(function (s, v) { return s + v; }, 0);
    // Too few distinct times to compare: most posts sit in two slots, or there
    // aren't enough well-filled slots *and* not even two well-filled hour blocks.
    var rankedHours = hours.filter(function (c) { return c.count >= SLOT_MIN_POSTS; }).length;
    var varietyIssue = !total ? null
      : topTwoShare >= CONCENTRATED_SHARE ? 'concentrated'
      : ranked.length < 3 && rankedHours < 2 ? 'thin'
      : null;

    return {
      dayLabels: DAY_LABELS,
      blockHours: BLOCK_HOURS,
      minPosts: SLOT_MIN_POSTS,
      postsWithTime: total,
      cells: cells,
      days: days,
      hours: hours,
      best: bestOf(flat),
      bestDay: bestOf(days),
      bestHours: bestOf(hours),
      rankedSlots: ranked.length,
      rankedHours: rankedHours,
      topTwoShare: topTwoShare,
      concentrated: !!varietyIssue,
      varietyIssue: varietyIssue, // 'concentrated' (always posts at the same times) | 'thin' (too few posts per slot) | null
      maxMedian: Math.max.apply(null, flat.map(function (c) { return c.medianViews || 0; }))
    };
  }

  function groupStats(groups, med) {
    return Object.keys(groups).map(function (key) {
      var views = groups[key].map(val).filter(function (v) { return v > 0; });
      var mv = median(views);
      return {
        key: key,
        count: groups[key].length,
        medianViews: mv,
        avgViews: mean(views),
        lift: mv && med ? mv / med : null
      };
    });
  }

  function hashtags(posts, med) {
    var groups = {};
    posts.forEach(function (p) {
      (p.hashtags || []).forEach(function (t) { (groups[t] = groups[t] || []).push(p); });
    });
    var all = groupStats(groups, med);
    var minUses = all.some(function (g) { return g.count >= 2; }) ? 2 : 1;
    return all
      .filter(function (g) { return g.count >= minUses && g.medianViews !== null; })
      .sort(function (a, b) { return b.medianViews - a.medianViews; });
  }

  function durations(posts, med) {
    var groups = {};
    // YouTube long-form (no Shorts in the list): minutes-scale buckets.
    var buckets = posts.length && posts.every(function (p) { return isYouTube(p) && formatOf(p) === 'long'; }) ? LONG_BUCKETS : DURATION_BUCKETS;
    buckets.forEach(function (b) { groups[b.label] = []; });
    posts.forEach(function (p) {
      if (!(p.duration > 0)) return;
      for (var i = 0; i < buckets.length; i++) {
        if (p.duration < buckets[i].max) { groups[buckets[i].label].push(p); break; }
      }
    });
    var stats = groupStats(groups, med);
    return buckets.map(function (b) {
      return stats.filter(function (s) { return s.key === b.label; })[0];
    }).filter(function (s) { return s.count > 0; });
  }

  function audio(posts, med) {
    var kinds = { 'Original audio': [], 'Licensed music': [] };
    var tracks = {};
    posts.forEach(function (p) {
      if (!p.audio) return;
      kinds[p.audio.kind === 'music' ? 'Licensed music' : 'Original audio'].push(p);
      if (p.audio.kind === 'music') {
        var name = p.audio.title + (p.audio.artist ? ' · ' + p.audio.artist : '');
        (tracks[name] = tracks[name] || []).push(p);
      }
    });
    return {
      kinds: groupStats(kinds, med).filter(function (k) { return k.count > 0; }),
      topTracks: groupStats(tracks, med)
        .filter(function (t) { return t.medianViews !== null; })
        .sort(function (a, b) { return b.medianViews - a.medianViews; })
        .slice(0, 8)
    };
  }

  function summary(posts) {
    var withViews = posts.filter(function (p) { return val(p) > 0; });
    var dated = posts.map(function (p) { return p.takenAt; }).filter(Boolean).sort(function (a, b) { return a - b; });
    var weeks = dated.length >= 2 ? Math.max(1, (dated[dated.length - 1] - dated[0]) / (7 * 864e5)) : null;
    var scoredAgainst = baselineOf(posts);
    return {
      count: posts.length,
      // The same median the scores use (pinned and brand-new posts left out) when the list has one.
      medianViews: scoredAgainst !== null ? scoredAgainst : median(withViews.map(val)),
      avgViews: mean(withViews.map(val)),
      totalViews: withViews.reduce(function (s, p) { return s + val(p); }, 0),
      medianComments: median(posts.map(function (p) { return p.comments; })),
      medianLikes: median(posts.map(function (p) { return p.likes > 0 ? p.likes : null; })),
      totalComments: posts.reduce(function (s, p) { return s + (p.comments || 0); }, 0),
      medianCommentsPer100Likes: median(posts.map(function (p) { return p.commentsPer100Likes; })),
      keywordPosts: posts.filter(function (p) { return p.commentKeyword; }).length,
      // 'views' | 'likes' | 'score' when every post is ranked by the same number, else 'mixed'.
      basis: posts.length ? posts.map(basisOf).reduce(function (a, b) { return a === b ? a : 'mixed'; }) : 'views',
      avgUpvoteRatio: mean(posts.map(function (p) { return p.upvoteRatio; })),
      avgEngagement: mean(posts.map(function (p) { return p.engagement; })),
      // Per 100 views; only posts that show the counter (TikTok always does).
      avgShareRate: mean(withViews.filter(function (p) { return p.shares != null; }).map(function (p) { return p.shares / val(p) * 100; })),
      avgSaveRate: mean(withViews.filter(function (p) { return p.saves != null; }).map(function (p) { return p.saves / val(p) * 100; })),
      outliers: posts.filter(function (p) { return p.outlier; }).length,
      postsPerWeek: weeks ? dated.length / weeks : null,
      firstPost: dated[0] || null,
      lastPost: dated[dated.length - 1] || null
    };
  }

  // ---- Reddit: titles, flair, post type, content ideas -------------------------

  var STOPWORDS = {};
  ('a an the and or but if then else of to in on at by for with from into onto over under about as is are was were be been being am do does did done have has had having ' +
   'i me my mine we us our you your yours he him his she her it its they them their this that these those there here what which who whom whose when where why how ' +
   'not no nor so too very can could should would will shall may might must just also only than such any some all each every both few more most other own same ' +
   'up down out off again once vs via per get got getting make made use using used one two new way ways like want need anyone someone something thing things ' +
   'im ive dont doesnt cant isnt wont didnt whats thats theres youre theyre lets').split(' ').forEach(function (w) { STOPWORDS[w] = true; });

  var QUESTION_START = /^(how|what|why|when|where|which|who|whom|is|are|was|were|can|could|should|would|will|does|do|did|has|have|any|anyone|anybody|help|need|looking for|is there|are there|best way)\b/i;
  var QUESTION_FLAIR = /^(solved|unsolved|waiting on op|question|help|needs help|answered)$/i;
  var PAIN_RE = /\b(help|stuck|error|errors|issue|issues|problem|problems|struggl\w*|can'?t|cannot|won'?t|doesn'?t|isn'?t|not working|broken|wrong|fail\w*|bug|bugs|confus\w*|frustrat\w*|slow|crash\w*|annoying|hate|messed|trouble|weird|strange|keeps?|losing|lost|corrupt\w*)\b|#(n\/a|value!?|ref!?|div\/0!?|name\??|spill!?|num!?|null!?)/i;

  /** Lowercase content words of a title (stopwords and 1–2 letter words dropped; keeps things like "xlookup", "vba", "#n/a"). */
  function titleWords(title) {
    var raw = String(title || '').toLowerCase().match(/#?[\p{L}\p{N}][\p{L}\p{N}'’\/+.#!-]*/gu) || [];
    return raw.map(function (w) { return w.replace(/[’']/g, '').replace(/[.!/-]+$/, function (t) { return /^#/.test(w) ? t : ''; }); })
      .filter(function (w) { return w && !STOPWORDS[w] && (w.length >= 3 || /^#/.test(w)) && !/^\d+$/.test(w); });
  }

  function isQuestion(title) {
    var t = String(title || '').trim();
    return /\?/.test(t) || QUESTION_START.test(t);
  }

  /** A question, a pain point, or a post flaired as a help request. */
  function needKind(p) {
    var title = p.title || p.caption || '';
    if (isQuestion(title) || (p.flair && QUESTION_FLAIR.test(String(p.flair).trim()))) return 'question';
    if (PAIN_RE.test(title + ' ' + String(p.selftext || '').slice(0, 300))) return 'pain point';
    return null;
  }

  var TITLE_BUCKETS = [
    { label: '1–5 words', max: 5 }, { label: '6–10 words', max: 10 }, { label: '11–15 words', max: 15 },
    { label: '16–20 words', max: 20 }, { label: '21+ words', max: Infinity }
  ];

  function wordCount(title) { return (String(title || '').match(/\S+/g) || []).length; }

  function byMedian(a, b) { return (b.medianViews || 0) - (a.medianViews || 0) || b.count - a.count; }

  /** Words / two-word phrases whose posts score above the median. Needs a few uses to count. */
  function termStats(posts, med, phrases) {
    var groups = {};
    posts.forEach(function (p) {
      var w = titleWords(p.title || p.caption);
      var seen = {};
      var terms = phrases ? w.slice(1).map(function (x, i) { return w[i] + ' ' + x; }) : w;
      terms.forEach(function (t) { if (!seen[t]) { seen[t] = true; (groups[t] = groups[t] || []).push(p); } });
    });
    var minUses = Math.max(posts.length >= 60 ? 3 : 2, Math.min(6, Math.round(posts.length / 30)));
    // Words that always show up together ("pivot", "table") would list the same posts twice: keep the first.
    var seenSets = {};
    return groupStats(groups, med).filter(function (g) { return g.count >= minUses && g.medianViews !== null; }).sort(byMedian)
      .filter(function (g) {
        var sig = groups[g.key].map(function (p) { return p.code; }).sort().join(',');
        if (seenSets[sig]) return false;
        seenSets[sig] = true;
        return true;
      });
  }

  function redditAnalysis(posts, med) {
    var len = {};
    TITLE_BUCKETS.forEach(function (b) { len[b.label] = []; });
    var qs = { Question: [], Statement: [] };
    var flairs = {};
    var types = {};
    posts.forEach(function (p) {
      var n = wordCount(p.title);
      for (var i = 0; i < TITLE_BUCKETS.length; i++) if (n <= TITLE_BUCKETS[i].max) { len[TITLE_BUCKETS[i].label].push(p); break; }
      qs[isQuestion(p.title) ? 'Question' : 'Statement'].push(p);
      if (p.flair) (flairs[p.flair] = flairs[p.flair] || []).push(p);
      (types[p.type || 'unknown'] = types[p.type || 'unknown'] || []).push(p);
    });
    var lenStats = groupStats(len, med);
    return {
      titleLength: TITLE_BUCKETS.map(function (b) { return lenStats.filter(function (s) { return s.key === b.label; })[0]; }).filter(function (s) { return s.count > 0; }),
      questions: groupStats(qs, med).filter(function (g) { return g.count > 0; }),
      words: termStats(posts, med, false).slice(0, 15),
      phrases: termStats(posts, med, true).slice(0, 10),
      flairs: groupStats(flairs, med).filter(function (g) { return g.medianViews !== null; }).sort(byMedian).slice(0, 15),
      types: groupStats(types, med).filter(function (g) { return g.medianViews !== null; }).sort(byMedian)
    };
  }

  /**
   * Questions and pain points that did well (each post already scored against
   * its own subreddit's median), plus recurring themes among them.
   * Expects enriched Reddit posts. → { ideas: [post + needKind], themes: [{ key, count, medianRatio, posts }] }
   */
  function contentIdeas(posts, opts) {
    opts = opts || {};
    var limit = opts.limit || 20;
    var ideas = posts.filter(function (p) { return p.platform === 'reddit' && val(p) > 0; })
      .map(function (p) { return Object.assign({}, p, { needKind: needKind(p) }); })
      .filter(function (p) { return p.needKind; });
    // Rank by how far above its subreddit's median a post got, then by discussion.
    function weight(p) { return (p.ratio || 0) * Math.log2(2 + (p.comments || 0)); }
    ideas.sort(function (a, b) { return weight(b) - weight(a); });
    // The subreddits' own names ("excel" in r/excel) are not a theme.
    var skip = {};
    posts.forEach(function (p) { if (p.subreddit) skip[String(p.subreddit).toLowerCase()] = true; });
    (opts.exclude || []).forEach(function (w) { skip[String(w).toLowerCase()] = true; });
    var groups = {};
    ideas.forEach(function (p) {
      var seen = {};
      titleWords(p.title).forEach(function (w) { if (!seen[w] && !skip[w]) { seen[w] = true; (groups[w] = groups[w] || []).push(p); } });
    });
    var seenSets = {};
    var themes = Object.keys(groups).filter(function (k) { return groups[k].length >= 2; }).map(function (k) {
      var g = groups[k];
      return { key: k, count: g.length, medianRatio: median(g.map(function (p) { return p.ratio; })), medianScore: median(g.map(val)), posts: g.slice(0, 3) };
    }).sort(function (a, b) { return (b.count * (b.medianRatio || 0)) - (a.count * (a.medianRatio || 0)); })
      .filter(function (t) {
        var sig = groups[t.key].map(function (p) { return p.code; }).sort().join(',');
        if (seenSets[sig]) return false;
        seenSets[sig] = true;
        return true;
      });
    return { matched: ideas.length, ideas: ideas.slice(0, limit), themes: themes.slice(0, opts.themes || 12) };
  }

  // ---- Instagram: comments, calls to action, carousels --------------------------

  var SLIDE_BUCKETS = [
    { label: '2–4 slides', max: 4 }, { label: '5–7 slides', max: 7 }, { label: '8–10 slides', max: 10 }, { label: '11+ slides', max: Infinity }
  ];
  var CAPTION_BUCKETS = [
    { label: 'No caption', max: 0 }, { label: '1–20 words', max: 20 }, { label: '21–60 words', max: 60 },
    { label: '61–150 words', max: 150 }, { label: '151+ words', max: Infinity }
  ];
  var TYPE_LABELS = { reel: 'Reels', video: 'Videos', carousel: 'Carousels', photo: 'Photos' };

  function bucketed(posts, buckets, numOf, med) {
    var groups = {};
    buckets.forEach(function (b) { groups[b.label] = []; });
    posts.forEach(function (p) {
      var n = numOf(p);
      if (n === null || n === undefined) return;
      for (var i = 0; i < buckets.length; i++) if (n <= buckets[i].max) { groups[buckets[i].label].push(p); break; }
    });
    var stats = groupStats(groups, med);
    return buckets.map(function (b) { return stats.filter(function (s) { return s.key === b.label; })[0]; }).filter(function (s) { return s.count > 0; });
  }

  /** Like groupStats, plus how each group does on comments. */
  function commentStats(groups, med) {
    return groupStats(groups, med).map(function (g) {
      var list = groups[g.key];
      g.medianComments = median(list.map(function (p) { return p.comments; }));
      g.totalComments = list.reduce(function (s, p) { return s + (p.comments || 0); }, 0);
      g.medianCommentsPer100Likes = median(list.map(function (p) { return p.commentsPer100Likes; }));
      return g;
    });
  }

  /**
   * Instagram extras for a list of enriched posts (one scoring basis: reels, or carousels and photos):
   *   types       carousels vs photos (or reels vs videos), by the list's median
   *   slides      carousel length buckets
   *   captions    caption length buckets
   *   cta         posts with a "comment KEYWORD" call to action vs the rest (median comments, comments per 100 likes)
   *   keywords    each keyword: posts, median and total comments
   *   collabs     collab posts vs solo; tagged: posts tagging people vs none
   *   topComments the posts furthest above the median comment count
   */
  function instagramAnalysis(posts, med) {
    var types = {};
    var cta = { 'Comment keyword': [], 'No keyword': [] };
    var keywords = {};
    var collabs = { 'Collab post': [], 'Solo post': [] };
    var tagged = { 'Tags people': [], 'No tags': [] };
    posts.forEach(function (p) {
      var t = TYPE_LABELS[p.type] || 'Other';
      (types[t] = types[t] || []).push(p);
      cta[p.commentKeyword ? 'Comment keyword' : 'No keyword'].push(p);
      if (p.commentKeyword) (keywords[p.commentKeyword] = keywords[p.commentKeyword] || []).push(p);
      collabs[(p.collabs || []).length ? 'Collab post' : 'Solo post'].push(p);
      tagged[(p.tagged || []).length ? 'Tags people' : 'No tags'].push(p);
    });
    function both(groups) {
      var g = commentStats(groups, med).filter(function (x) { return x.count > 0; });
      return g.length > 1 ? g : [];
    }
    return {
      types: commentStats(types, med).filter(function (g) { return g.count > 0; }).sort(function (a, b) { return b.count - a.count; }),
      slides: bucketed(posts.filter(function (p) { return p.type === 'carousel'; }), SLIDE_BUCKETS, function (p) { return p.slides || (p.files || []).length || null; }, med),
      captions: bucketed(posts, CAPTION_BUCKETS, function (p) { return wordCount(p.caption); }, med),
      cta: both(cta),
      keywords: commentStats(keywords, med).sort(function (a, b) { return b.totalComments - a.totalComments || b.count - a.count; }).slice(0, 15),
      collabs: both(collabs),
      tagged: both(tagged),
      topComments: sortBy(posts.filter(function (p) { return p.commentRatio !== null && p.commentRatio !== undefined; }), 'commentRatio').slice(0, 10)
    };
  }

  function isInstagramList(posts) {
    return posts.length > 0 && posts.every(isInstagram);
  }

  function isRedditList(posts) {
    return posts.length > 0 && posts.every(function (p) { return p.platform === 'reddit'; });
  }

  function isYouTubeList(posts) {
    return posts.length > 0 && posts.every(isYouTube);
  }

  /**
   * YouTube extras: Shorts vs long-form (pass every format of the channel in `all`),
   * title words, and how many dates are exact (best time uses only those).
   */
  function youtubeAnalysis(posts, med, all) {
    var formats = { Shorts: [], 'Long-form': [], Live: [] };
    (all || posts).forEach(function (p) { formats[p.type === 'short' ? 'Shorts' : p.type === 'live' ? 'Live' : 'Long-form'].push(p); });
    var exact = posts.filter(function (p) { return p.takenAt && p.dateApprox === false; }).length;
    return {
      formats: groupStats(formats, null).filter(function (g) { return g.count > 0; }),
      words: termStats(posts, med, false).slice(0, 15),
      phrases: termStats(posts, med, true).slice(0, 10),
      exactDates: exact,
      approxDates: posts.filter(function (p) { return p.takenAt && p.dateApprox !== false; }).length,
      noDates: posts.filter(function (p) { return !p.takenAt; }).length,
      approxViews: posts.filter(function (p) { return p.views != null && p.viewsApprox; }).length
    };
  }

  /**
   * Everything the Analytics tab needs. Expects enriched posts.
   * opts.all: YouTube only, the channel's posts in every format (for Shorts vs long-form).
   */
  function analyze(posts, opts) {
    var s = summary(posts);
    var yt = isYouTubeList(posts);
    var out = {
      summary: s,
      // YouTube: best time only from exact publish dates ("3 weeks ago" can't place a weekday or hour).
      heatmap: heatmap(yt ? posts.filter(function (p) { return p.dateApprox === false; }) : posts),
      hashtags: hashtags(posts, s.medianViews),
      durations: durations(posts, s.medianViews),
      audio: audio(posts, s.medianViews)
    };
    if (isRedditList(posts)) out.reddit = redditAnalysis(posts, s.medianViews);
    if (isInstagramList(posts)) out.instagram = instagramAnalysis(posts, s.medianViews);
    if (yt) out.youtube = youtubeAnalysis(posts, s.medianViews, opts && opts.all);
    if (isXList(posts)) out.x = xAnalysis(posts, s.medianViews, opts && opts.all);
    return out;
  }

  var X_FORMAT_LABELS = { text: 'Text', image: 'Image', video: 'Video', thread: 'Thread', article: 'Article', link: 'Link', quote: 'Quote' };
  var X_LENGTH_BUCKETS = [
    { label: 'Under 50 chars', max: 49 }, { label: '50–139', max: 139 }, { label: '140–279', max: 279 },
    { label: '280–999 (long post)', max: 999 }, { label: '1,000+', max: Infinity }
  ];
  /**
   * X extras (pass every post of the account in `all`): formats (originals, each against the overall
   * median), originals vs replies vs reposts, text length, link vs none, how many have no view count.
   */
  function xAnalysis(posts, med, all) {
    var list = all || posts;
    var originals = list.filter(function (p) { return xKind(p) === 'original'; });
    var formats = {};
    originals.forEach(function (p) { var k = X_FORMAT_LABELS[p.type] || 'Text'; (formats[k] = formats[k] || []).push(p); });
    var kinds = { Originals: originals, Replies: list.filter(function (p) { return xKind(p) === 'reply'; }),
      'Thread parts': list.filter(function (p) { return xKind(p) === 'thread-part'; }), Reposts: list.filter(function (p) { return xKind(p) === 'repost'; }) };
    var links = { 'Has a link': [], 'No link': [] };
    originals.forEach(function (p) { links[p.hasLink ? 'Has a link' : 'No link'].push(p); });
    return {
      formats: groupStats(formats, med).filter(function (g) { return g.count > 0; }).sort(function (a, b) { return b.count - a.count; }),
      kinds: Object.keys(kinds).map(function (k) { return { key: k, count: kinds[k].length }; }).filter(function (k) { return k.count > 0; }),
      lengths: bucketed(originals, X_LENGTH_BUCKETS, function (p) { return (p.caption || '').length; }, med),
      links: groupStats(links, med).filter(function (g) { return g.count > 0; }),
      noViews: list.filter(function (p) { return p.views == null && xKind(p) !== 'repost'; }).length,
      approxMedian: posts.filter(function (p) { return p.ratio != null && p.baselineApprox; }).length
    };
  }

  // ---- file names -----------------------------------------------------------

  /** 1234 → "1.2K", 2000000 → "2M", 202 → "202" */
  function compactNumber(n) {
    if (typeof n !== 'number' || !isFinite(n)) return null;
    function trim(x) { return x.toFixed(1).replace(/\.0$/, ''); }
    if (n >= 1e9) return trim(n / 1e9) + 'B';
    if (n >= 1e6) return trim(n / 1e6) + 'M';
    if (n >= 1e3) return trim(n / 1e3) + 'K';
    return String(Math.round(n));
  }

  /**
   * e.g. "1.2Mviews_11.1Klikes_13Kcomments_2.0pct_post_DZPcVltsTAa" (missing stats are left out).
   * TikTok adds shares and saves and counts them in the engagement:
   * "250Kviews_12Klikes_300comments_1.1Kshares_2.4Ksaves_6.3pct_tiktok_7412345678901234567".
   */
  function fileBaseName(p) {
    var parts = [];
    var tt = isTikTok(p);
    var yt = isYouTube(p);
    var v = compactNumber(p.views);
    var l = compactNumber(p.likes);
    var c = compactNumber(p.comments);
    if (v) parts.push(v + 'views');
    if (l) parts.push(l + 'likes');
    if (c) parts.push(c + 'comments');
    if (tt && compactNumber(p.shares)) parts.push(compactNumber(p.shares) + 'shares');
    if (tt && compactNumber(p.saves)) parts.push(compactNumber(p.saves) + 'saves');
    if (p.views > 0 && (p.likes != null || p.comments != null)) {
      parts.push((interactions(p) / p.views * 100).toFixed(1) + 'pct');
    }
    parts.push(tt ? 'tiktok' : yt ? (p.type === 'short' ? 'short' : 'youtube') : isX(p) ? 'x' : 'post', String(p.code || 'unknown').replace(/[^A-Za-z0-9_-]/g, ''));
    return parts.join('_');
  }

  // ---- export ---------------------------------------------------------------

  var COLUMNS = [
    ['rank', function (p, i) { return i + 1; }],
    ['url', function (p) { return p.url; }],
    ['shortcode', function (p) { return p.code; }],
    ['type', function (p) { return p.type; }],
    ['posted_at', function (p) { return p.takenAt ? new Date(p.takenAt).toISOString() : ''; }],
    ['weekday', function (p) { return p.takenAt ? DAY_LABELS[dayIndex(new Date(p.takenAt))] : ''; }],
    ['hour_local', function (p) { return p.takenAt ? new Date(p.takenAt).getHours() : ''; }],
    ['views', function (p) { return p.views; }],
    ['likes', function (p) { return p.likes; }],
    ['comments', function (p) { return p.comments; }],
    ['shares', function (p) { return p.shares; }],
    ['engagement_rate_pct', function (p) { return p.engagement == null ? '' : p.engagement.toFixed(2); }],
    ['viral_score', function (p) { return p.viralScore; }],
    ['x_median', function (p) { return p.ratio == null ? '' : p.ratio.toFixed(2); }],
    ['scored_by', function (p) { return p.basis || basisOf(p); }],
    ['comments_x_median', function (p) { return p.commentRatio == null ? '' : p.commentRatio.toFixed(2); }],
    ['comments_per_100_likes', function (p) { return p.commentsPer100Likes == null ? '' : p.commentsPer100Likes.toFixed(1); }],
    ['comment_keyword', function (p) { return p.commentKeyword || ''; }],
    ['slides', function (p) { return p.type === 'carousel' ? (p.slides || (p.files || []).length || '') : ''; }],
    ['duration_s', function (p) { return p.duration; }],
    ['pinned', function (p) { return p.pinned ? 'yes' : ''; }],
    ['collabs', function (p) { return (p.collabs || []).join(' '); }], // bare usernames: a leading @ reads as a formula in spreadsheets
    ['tagged', function (p) { return (p.tagged || []).join(' '); }], // bare usernames: a leading @ reads as a formula in spreadsheets
    ['location', function (p) { return p.location || ''; }],
    ['audio', function (p) { return p.audio ? (p.audio.kind === 'music' ? 'music: ' : 'original: ') + p.audio.title + (p.audio.artist ? ' – ' + p.audio.artist : '') : ''; }],
    ['hashtags', function (p) { return (p.hashtags || []).map(function (t) { return '#' + t; }).join(' '); }],
    ['caption', function (p) { return (p.caption || '').replace(/\s+/g, ' ').trim(); }]
  ];

  var REDDIT_COLUMNS = [
    ['rank', function (p, i) { return i + 1; }],
    ['url', function (p) { return p.url; }],
    ['id', function (p) { return p.code; }],
    ['subreddit', function (p) { return p.subreddit ? 'r/' + p.subreddit : ''; }],
    ['author', function (p) { return p.author ? 'u/' + p.author : ''; }],
    ['type', function (p) { return p.type; }],
    ['flair', function (p) { return p.flair; }],
    ['posted_at', function (p) { return p.takenAt ? new Date(p.takenAt).toISOString() : ''; }],
    ['weekday', function (p) { return p.takenAt ? DAY_LABELS[dayIndex(new Date(p.takenAt))] : ''; }],
    ['hour_local', function (p) { return p.takenAt ? new Date(p.takenAt).getHours() : ''; }],
    ['score', function (p) { return p.score; }],
    ['comments', function (p) { return p.comments; }],
    ['upvote_ratio', function (p) { return p.upvoteRatio; }],
    ['comments_per_100_score', function (p) { return p.engagement == null ? '' : p.engagement.toFixed(1); }],
    ['viral_score', function (p) { return p.viralScore; }],
    ['x_median', function (p) { return p.ratio == null ? '' : p.ratio.toFixed(2); }],
    ['title_words', function (p) { return wordCount(p.title); }],
    ['question', function (p) { return isQuestion(p.title) ? 'yes' : ''; }],
    ['title', function (p) { return (p.title || '').replace(/\s+/g, ' ').trim(); }],
    ['selftext', function (p) { return (p.selftext || '').replace(/\s+/g, ' ').trim().slice(0, 500); }]
  ];

  var TIKTOK_COLUMNS = [
    ['rank', function (p, i) { return i + 1; }],
    ['platform', function (p) { return p.platform || 'instagram'; }],
    ['url', function (p) { return p.url; }],
    ['id', function (p) { return p.code; }],
    ['account', function (p) { return p.owner ? '@' + String(p.owner).replace(/^(tt|x)\//, '') : ''; }],
    ['type', function (p) { return p.type; }],
    ['posted_at', function (p) { return p.takenAt ? new Date(p.takenAt).toISOString() : ''; }],
    ['weekday', function (p) { return p.takenAt ? DAY_LABELS[dayIndex(new Date(p.takenAt))] : ''; }],
    ['hour_local', function (p) { return p.takenAt ? new Date(p.takenAt).getHours() : ''; }],
    ['views', function (p) { return p.views; }],
    ['likes', function (p) { return p.likes; }],
    ['comments', function (p) { return p.comments; }],
    ['shares', function (p) { return p.shares; }],
    ['saves', function (p) { return p.saves; }],
    ['engagement_rate_pct', function (p) { return p.engagement == null ? '' : p.engagement.toFixed(2); }],
    ['viral_score', function (p) { return p.viralScore; }],
    ['x_median', function (p) { return p.ratio == null ? '' : p.ratio.toFixed(2); }],
    ['duration_s', function (p) { return p.duration; }],
    ['pinned', function (p) { return p.pinned ? 'yes' : ''; }],
    ['sound', function (p) { return p.audio ? (p.audio.kind === 'music' ? 'music: ' : 'original: ') + p.audio.title + (p.audio.artist ? ' – ' + p.audio.artist : '') : ''; }],
    ['hashtags', function (p) { return (p.hashtags || []).map(function (t) { return '#' + t; }).join(' '); }],
    ['caption', function (p) { return (p.caption || '').replace(/\s+/g, ' ').trim(); }]
  ];

  // YouTube: dates from channel tabs are approximate ("3 weeks ago"), so weekday and hour
  // are only filled from exact publish dates; *_approx columns say which values are rounded.
  function exactDate(p) { return p.takenAt && p.dateApprox === false ? new Date(p.takenAt) : null; }
  var YOUTUBE_COLUMNS = [
    ['rank', function (p, i) { return i + 1; }],
    ['platform', function (p) { return p.platform || 'instagram'; }],
    ['url', function (p) { return p.url; }],
    ['id', function (p) { return p.code; }],
    ['account', function (p) { return p.owner ? (/^yt\/UC/.test(p.owner) ? p.owner.slice(3) : '@' + String(p.owner).replace(/^(yt|tt)\//, '')) : ''; }],
    ['format', function (p) { return p.type; }],
    ['posted_at', function (p) { return p.takenAt ? new Date(p.takenAt).toISOString() : ''; }],
    ['date_approx', function (p) { return p.takenAt ? (p.dateApprox === false ? '' : p.dateDay ? 'day' : 'yes') : ''; }],
    ['weekday', function (p) { var d = exactDate(p); return d ? DAY_LABELS[dayIndex(d)] : ''; }],
    ['hour_local', function (p) { var d = exactDate(p); return d ? d.getHours() : ''; }],
    ['views', function (p) { return p.views; }],
    ['views_approx', function (p) { return p.views != null && p.viewsApprox ? 'yes' : ''; }],
    ['likes', function (p) { return p.likes; }],
    ['comments', function (p) { return p.comments; }],
    ['engagement_rate_pct', function (p) { return p.engagement == null ? '' : p.engagement.toFixed(2); }],
    ['viral_score', function (p) { return p.viralScore; }],
    ['x_median', function (p) { return p.ratio == null ? '' : p.ratio.toFixed(2); }],
    ['duration_s', function (p) { return p.duration; }],
    ['category', function (p) { return p.category; }],
    ['chapters', function (p) { return (p.chapters || []).length || ''; }],
    ['most_replayed_s', function (p) { return (p.heatmapPeaks || []).join(' '); }],
    ['hashtags', function (p) { return (p.hashtags || []).map(function (t) { return '#' + t; }).join(' '); }],
    ['title', function (p) { return (p.caption || '').replace(/\s+/g, ' ').trim(); }]
  ];

  var X_KIND_NAMES = { original: 'original', reply: 'reply', 'thread-part': 'thread part', repost: 'repost' };
  var X_COLUMNS = [
    ['rank', function (p, i) { return i + 1; }],
    ['platform', function (p) { return p.platform; }],
    ['url', function (p) { return p.url; }],
    ['id', function (p) { return p.code; }],
    ['account', function (p) { return p.author || String(p.owner || '').replace(/^x\//, ''); }], // bare handle: a leading @ reads as a formula
    ['kind', function (p) { return X_KIND_NAMES[p.kind] || p.kind || ''; }],
    ['format', function (p) { return p.type; }],
    ['posted_at', function (p) { return p.takenAt ? new Date(p.takenAt).toISOString() : ''; }],
    ['weekday', function (p) { return p.takenAt ? DAY_LABELS[dayIndex(new Date(p.takenAt))] : ''; }],
    ['hour_local', function (p) { return p.takenAt ? new Date(p.takenAt).getHours() : ''; }],
    ['views', function (p) { return p.views; }],
    ['likes', function (p) { return p.likes; }],
    ['replies', function (p) { return p.comments; }],
    ['reposts', function (p) { return p.shares; }],
    ['quotes', function (p) { return p.quotes; }],
    ['bookmarks', function (p) { return p.saves; }],
    ['engagement_rate_pct', function (p) { return p.engagement == null ? '' : p.engagement.toFixed(2); }],
    ['viral_score', function (p) { return p.viralScore; }],
    ['x_median', function (p) { return p.ratio == null ? '' : p.ratio.toFixed(2); }],
    ['median_approx', function (p) { return p.ratio != null && p.baselineApprox ? 'yes' : ''; }],
    ['author_followers', function (p) { return p.ownerFollowers; }],
    ['duration_s', function (p) { return p.duration; }],
    ['thread_length', function (p) { return p.threadLength || ''; }],
    ['has_link', function (p) { return p.hasLink ? 'yes' : ''; }],
    ['pinned', function (p) { return p.pinned ? 'yes' : ''; }],
    ['article_title', function (p) { return p.article ? p.article.title : ''; }],
    ['hashtags', function (p) { return (p.hashtags || []).map(function (t) { return '#' + t; }).join(' '); }],
    ['text', function (p) { return (p.caption || '').replace(/\s+/g, ' ').trim(); }]
  ];

  /** Any TikTok (or X) post in a list without Reddit posts → TikTok columns (they add platform, saves). */
  function hasTikTok(posts) { return posts.some(isTikTok) || posts.some(isX); }
  function isXList(posts) { return posts.length > 0 && posts.every(isX); }

  function cell(value, delimiter) {
    if (value === null || value === undefined) return '';
    var s = String(value);
    // Neutralize spreadsheet formula injection from captions.
    if (/^[=+\-@\t\r]/.test(s) && typeof value !== 'number') s = "'" + s;
    if (delimiter === '\t') return s.replace(/[\t\r\n]+/g, ' ');
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /** delimiter ',' → CSV (for files), '\t' → TSV (for pasting into Sheets/Excel). */
  function toTable(posts, delimiter) {
    delimiter = delimiter || ',';
    var cols = isRedditList(posts) ? REDDIT_COLUMNS : isYouTubeList(posts) ? YOUTUBE_COLUMNS : isXList(posts) ? X_COLUMNS : hasTikTok(posts) ? TIKTOK_COLUMNS : COLUMNS;
    var lines = [cols.map(function (c) { return c[0]; }).join(delimiter)];
    posts.forEach(function (p, i) {
      lines.push(cols.map(function (c) { return cell(c[1](p, i), delimiter); }).join(delimiter));
    });
    return lines.join('\r\n');
  }

  return {
    OUTLIER_RATIO: OUTLIER_RATIO,
    COLUMN_NAMES: COLUMNS.map(function (c) { return c[0]; }),
    REDDIT_COLUMN_NAMES: REDDIT_COLUMNS.map(function (c) { return c[0]; }),
    TIKTOK_COLUMN_NAMES: TIKTOK_COLUMNS.map(function (c) { return c[0]; }),
    YOUTUBE_COLUMN_NAMES: YOUTUBE_COLUMNS.map(function (c) { return c[0]; }),
    X_COLUMN_NAMES: X_COLUMNS.map(function (c) { return c[0]; }),
    isX: isX,
    isXList: isXList,
    xKind: xKind,
    xBaselines: xBaselines,
    xBaselineFor: xBaselineFor,
    MIN_BASELINE: MIN_BASELINE,
    FRESH_MS: FRESH_MS,
    val: val,
    basisOf: basisOf,
    baselineOf: baselineOf,
    isInstagram: isInstagram,
    isLikesScored: isLikesScored,
    inBaseline: inBaseline,
    commentKeyword: commentKeyword,
    isInstagramList: isInstagramList,
    interactions: interactions,
    isTikTok: isTikTok,
    hasTikTok: hasTikTok,
    isYouTube: isYouTube,
    isYouTubeList: isYouTubeList,
    formatOf: formatOf,
    engagementOf: engagementOf,
    titleWords: titleWords,
    isQuestion: isQuestion,
    needKind: needKind,
    contentIdeas: contentIdeas,
    isRedditList: isRedditList,
    median: median,
    mean: mean,
    viralScore: viralScore,
    enrich: enrich,
    sortBy: sortBy,
    analyze: analyze,
    toTable: toTable,
    compactNumber: compactNumber,
    fileBaseName: fileBaseName
  };
});
