// ReelScope – scoring, analytics and CSV. Pure functions (Node-testable).
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReelScopeMetrics = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var OUTLIER_RATIO = 2; // ≥ 2× the profile's median views = outlier
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

  /** The number a post is ranked by: views on Instagram and TikTok, score (upvotes) on Reddit. */
  function val(p) { return p && p.platform === 'reddit' ? p.score : p.views; }

  /**
   * Interactions that count toward engagement. TikTok shows shares and saves
   * publicly, so they count there; Instagram only reliably shows likes and
   * comments; Reddit uses comments (÷ score).
   */
  function interactions(p) {
    if (p.platform === 'reddit') return p.comments || 0;
    if (p.platform === 'tiktok') return (p.likes || 0) + (p.comments || 0) + (p.shares || 0) + (p.saves || 0);
    return (p.likes || 0) + (p.comments || 0);
  }
  function isTikTok(p) { return !!p && p.platform === 'tiktok'; }

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
   */
  function enrich(posts) {
    var med = median(posts.map(function (p) { var v = val(p); return v > 0 ? v : null; }));
    return posts.map(function (p) {
      var v = val(p);
      var ratio = v > 0 && med > 0 ? v / med : null;
      return Object.assign({}, p, {
        ratio: ratio,
        viralScore: viralScore(v, med),
        engagement: v > 0 ? (interactions(p) / v) * 100 : null,
        outlier: ratio !== null && ratio >= OUTLIER_RATIO
      });
    });
  }

  var SORTERS = {
    views: val,
    score: val,
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

  function heatmap(posts) {
    var blocks = 24 / BLOCK_HOURS;
    var cells = [];
    for (var d = 0; d < 7; d++) {
      cells.push([]);
      for (var b = 0; b < blocks; b++) cells[d].push({ day: d, block: b, views: [] });
    }
    posts.forEach(function (p) {
      if (!p.takenAt || !(val(p) > 0)) return;
      var dt = new Date(p.takenAt);
      cells[dayIndex(dt)][Math.floor(dt.getHours() / BLOCK_HOURS)].views.push(val(p));
    });
    var best = null;
    var flat = [];
    cells.forEach(function (row) {
      row.forEach(function (c) {
        c.count = c.views.length;
        c.avgViews = mean(c.views);
        c.medianViews = median(c.views);
        delete c.views;
        flat.push(c);
        if (c.count >= 2 && (!best || c.medianViews > best.medianViews)) best = c;
      });
    });
    return { dayLabels: DAY_LABELS, blockHours: BLOCK_HOURS, cells: cells, best: best, maxMedian: Math.max.apply(null, flat.map(function (c) { return c.medianViews || 0; })) };
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
    DURATION_BUCKETS.forEach(function (b) { groups[b.label] = []; });
    posts.forEach(function (p) {
      if (!(p.duration > 0)) return;
      for (var i = 0; i < DURATION_BUCKETS.length; i++) {
        if (p.duration < DURATION_BUCKETS[i].max) { groups[DURATION_BUCKETS[i].label].push(p); break; }
      }
    });
    var stats = groupStats(groups, med);
    return DURATION_BUCKETS.map(function (b) {
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
    return {
      count: posts.length,
      medianViews: median(withViews.map(val)),
      avgViews: mean(withViews.map(val)),
      totalViews: withViews.reduce(function (s, p) { return s + val(p); }, 0),
      medianComments: median(posts.map(function (p) { return p.comments; })),
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

  function isRedditList(posts) {
    return posts.length > 0 && posts.every(function (p) { return p.platform === 'reddit'; });
  }

  /** Everything the Analytics tab needs. Expects enriched posts. */
  function analyze(posts) {
    var s = summary(posts);
    var out = {
      summary: s,
      heatmap: heatmap(posts),
      hashtags: hashtags(posts, s.medianViews),
      durations: durations(posts, s.medianViews),
      audio: audio(posts, s.medianViews)
    };
    if (isRedditList(posts)) out.reddit = redditAnalysis(posts, s.medianViews);
    return out;
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
    parts.push(tt ? 'tiktok' : 'post', String(p.code || 'unknown').replace(/[^A-Za-z0-9_-]/g, ''));
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
    ['duration_s', function (p) { return p.duration; }],
    ['pinned', function (p) { return p.pinned ? 'yes' : ''; }],
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
    ['account', function (p) { return p.owner ? '@' + String(p.owner).replace(/^tt\//, '') : ''; }],
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

  /** Any TikTok post in a list without Reddit posts → TikTok columns (they add platform, saves). */
  function hasTikTok(posts) { return posts.some(isTikTok); }

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
    var cols = isRedditList(posts) ? REDDIT_COLUMNS : hasTikTok(posts) ? TIKTOK_COLUMNS : COLUMNS;
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
    val: val,
    interactions: interactions,
    isTikTok: isTikTok,
    hasTikTok: hasTikTok,
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
