// OpenOutlier – X "what works" (docs/x-plan.md 3.3, Phase 2).
//
// Pure functions over X posts (src/x.js shape), for any account: the user's own (Hesabım) and
// any account or folder in the Library (MCP x_patterns). Every breakdown is measured against the
// account's own median (originals with a view count), with counts and the top 3 posts.
//
// • postType(p): rule-based content type — question, list, how-to, story, opinion, announcement —
//   else the format (thread, image, video, link, article, quote), else 'other'. A better guess
//   from the LLM layer (Phase 5) wins when it sets p.llmType.
// • features(p): length bucket, first-line length, starts with a number, emoji, link, language
//   (TR / EN / other).
// • breakdown(posts, keyFn): groups with n, median views, × the account's median, top 3.
// • singleHit(posts): median vs mean side by side; "reach comes from a few posts" when the mean
//   is far above the median (SuperX's calculator idea), with the top posts' share of all views.
// • patterns(posts): all of the above plus the best-hour heatmap from src/metrics.js (local time).
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpenOutlierXPatterns = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var TYPES = ['question', 'list', 'how-to', 'story', 'opinion', 'announcement', 'thread', 'image', 'video', 'link', 'article', 'quote', 'other'];
  var TYPE_LABELS = {
    en: { question: 'Question', list: 'List', 'how-to': 'How-to', story: 'Story / experience', opinion: 'Opinion', announcement: 'Announcement / product', thread: 'Thread', image: 'Image', video: 'Video', link: 'Link', article: 'Article', quote: 'Quote', other: 'Other' },
    tr: { question: 'Soru', list: 'Liste', 'how-to': 'Nasıl yapılır', story: 'Hikaye / deneyim', opinion: 'Görüş', announcement: 'Duyuru / ürün', thread: 'Thread', image: 'Görsel', video: 'Video', link: 'Link', article: 'Makale', quote: 'Alıntı', other: 'Diğer' }
  };
  var MIN_GROUP = 3;          // a group needs this many posts to get a × (it is listed with fewer, without one)
  var SINGLE_HIT_RATIO = 2;   // mean ≥ 2 × median → "reach comes from a few posts"
  var SINGLE_HIT_SHARE = 0.5; // or the top 3 hold half of all views

  function M() {
    var m = root && root.ReelScopeMetrics;
    if (!m && typeof require === 'function') { try { m = require('./metrics.js'); } catch (e) { m = null; } }
    return m;
  }
  function median(list) {
    var a = (list || []).filter(function (x) { return typeof x === 'number' && isFinite(x); }).sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function mean(list) {
    var a = (list || []).filter(function (x) { return typeof x === 'number' && isFinite(x); });
    return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : null;
  }
  function round(v, n) { if (v == null) return null; var p = Math.pow(10, n == null ? 2 : n); return Math.round(v * p) / p; }
  function kindOf(p) { return p.kind || (p.isRepost ? 'repost' : p.isReply ? 'reply' : 'original'); }

  // ---- text features -----------------------------------------------------------------------------
  /** The post text without t.co links, @mentions at the start (reply prefixes) and trailing spaces. */
  function textOf(p) {
    return String(p && p.caption || '').replace(/https?:\/\/t\.co\/\S+/g, '').replace(/^(@\w{1,15}\s+)+/, '').trim();
  }
  function firstLine(t) { return String(t || '').split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean)[0] || ''; }
  var EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{1F900}-\u{1F9FF}\u{2B50}\u{2B06}\u{2194}-\u{21AA}]/u;
  var TR_CHARS = /[çğışöüÇĞİŞÖÜ]/;
  var TR_WORDS = /\b(ve|bir|bu|için|ile|da|de|çok|ama|gibi|daha|ne|nasıl|neden|ben|sen|biz|olarak|olan|şu|her|en|mi|mı|mu|mü)\b/i;
  var EN_WORDS = /\b(the|and|is|are|you|your|to|of|for|with|this|that|how|what|why|my|it|in|on|i)\b/i;

  /** 'tr' | 'en' | 'other' — X's own lang when it says tr / en, else a word / letter check. */
  function langOf(p) {
    var l = String(p && p.lang || '').toLowerCase();
    if (l === 'tr' || l === 'en') return l;
    var t = textOf(p);
    if (!t) return 'other';
    if (TR_CHARS.test(t) || TR_WORDS.test(t)) return 'tr';
    if (EN_WORDS.test(t)) return 'en';
    return 'other';
  }

  var LENGTH_BUCKETS = [
    { key: '<50', max: 49, label: 'Under 50 chars' }, { key: '50–99', max: 99, label: '50–99' }, { key: '100–199', max: 199, label: '100–199' },
    { key: '200–280', max: 280, label: '200–280' }, { key: '281–999', max: 999, label: '281–999 (long post)' }, { key: '1000+', max: Infinity, label: '1,000+' }
  ];
  var FIRST_LINE_BUCKETS = [
    { key: '<40', max: 39, label: 'First line under 40 chars' }, { key: '40–79', max: 79, label: 'First line 40–79' }, { key: '80+', max: Infinity, label: 'First line 80+' }
  ];
  function bucket(list, n) { for (var i = 0; i < list.length; i++) if (n <= list[i].max) return list[i].key; return list[list.length - 1].key; }

  function features(p) {
    var t = textOf(p);
    var fl = firstLine(t);
    return {
      length: bucket(LENGTH_BUCKETS, t.length),
      chars: t.length,
      firstLine: bucket(FIRST_LINE_BUCKETS, fl.length),
      firstLineChars: fl.length,
      startsWithNumber: /^[\d#₺$€£]|^(one|two|three|four|five|six|seven|eight|nine|ten|bir|iki|üç|dört|beş|altı|yedi|sekiz|dokuz|on)\b/i.test(fl),
      emoji: EMOJI_RE.test(t),
      link: !!(p && (p.hasLink || (p.links && p.links.length))),
      lang: langOf(p)
    };
  }

  // ---- post type (rules) -----------------------------------------------------------------------------
  var RULES = {
    question: /\?\s*$|^(what|why|how|who|which|when|where|is|are|do|does|did|can|should|would|anyone|ne|neden|niye|nasıl|kim|hangi|nerede|kaç)\b[^.!]*\?|\b(mi|mı|mu|mü)\s*\?/i,
    howto: /\b(how to|how i|step[- ]by[- ]step|tutorial|guide|tips?|trick|shortcut|here'?s how|nasıl yapılır|adım adım|ipucu|rehber|şöyle yap)\b/i,
    announcement: /\b(launch(ed|ing)?|introducing|just shipped|shipped|released?|now live|is live|new feature|announc|v\d+(\.\d+)+|beta|waitlist|yayında|yayınladım|duyuru|çıktı|yeni özellik|lansman|sürüm)\b|🚀/i,
    story: /\b(i (was|had|used to|spent|learned|realized|quit|started|built|made|lost|got)|years? ago|last (week|month|year)|yesterday|my (first|journey|story)|story time|geçen (hafta|ay|yıl)|yıl önce|ilk kez|başıma geldi|öğrendim|fark ettim)\b/i,
    opinion: /\b(unpopular opinion|hot take|i think|i believe|imo|in my opinion|honestly|overrated|underrated|the truth is|stop |nobody talks|bence|bana göre|açıkçası|dürüst olmak|abartılıyor|kimse)\b/i
  };
  /** A list: 3+ lines that start with a bullet, number or emoji, or "N things / N ways …". */
  function isList(t) {
    var lines = String(t || '').split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    var marked = lines.filter(function (l) { return /^(\d{1,2}[.)/-]|[-•*→▪︎✅✔️❌👉]|\p{Extended_Pictographic})/u.test(l); }).length;
    return marked >= 3 || /^\s*(the\s+|top\s+)?\d{1,2}\s+([\wçğıöşü]+\s+){0,2}(things|ways|tools|tips|lessons|mistakes|reasons|books|habits|shortcuts|formulas|ideas|steps|şey|yol|araç|ipucu|ders|hata|neden|kitap|alışkanlık|kısayol|formül|fikir|adım)\b/i.test(firstLine(t));
  }

  /** → one of TYPES. */
  function postType(p) {
    if (!p) return 'other';
    if (p.llmType && TYPES.indexOf(p.llmType) !== -1) return p.llmType;
    var t = textOf(p);
    var fmt = p.type || 'text';
    if (fmt === 'article') return 'article';
    if (fmt === 'thread' || p.threadLength > 1) return 'thread';
    if (t) {
      if (isList(t)) return 'list';
      if (RULES.question.test(firstLine(t)) || RULES.question.test(t)) return 'question';
      if (RULES.howto.test(t)) return 'how-to';
      if (RULES.announcement.test(t)) return 'announcement';
      if (RULES.story.test(t)) return 'story';
      if (RULES.opinion.test(t)) return 'opinion';
    }
    if (fmt === 'quote' || fmt === 'video' || fmt === 'image' || fmt === 'link') return fmt;
    return 'other';
  }

  // ---- breakdowns -------------------------------------------------------------------------------------
  /** Originals with a view count: what every breakdown uses. */
  function scored(posts) { return (posts || []).filter(function (p) { return p && kindOf(p) === 'original' && typeof p.views === 'number' && isFinite(p.views); }); }

  function brief(p, base) {
    return { code: p.code, url: p.url, views: p.views, x: base ? round(p.views / base) : null, posted_at: p.takenAt ? new Date(p.takenAt).toISOString() : null,
      format: p.type || 'text', text: String(p.caption || '').replace(/\s+/g, ' ').slice(0, 140) };
  }

  /**
   * Group posts by keyFn and compare each group with the account's median.
   * → [{ key, n, median_views, x (median ÷ account median, null under MIN_GROUP), top: [3 posts] }] by n desc.
   */
  function breakdown(posts, keyFn, opts) {
    var list = scored(posts);
    var base = opts && opts.base != null ? opts.base : median(list.map(function (p) { return p.views; }));
    var groups = {};
    list.forEach(function (p) {
      var k = keyFn(p);
      if (k == null) return;
      (groups[k] = groups[k] || []).push(p);
    });
    var order = opts && opts.order;
    return Object.keys(groups).map(function (k) {
      var g = groups[k];
      var med = median(g.map(function (p) { return p.views; }));
      return {
        key: k, n: g.length, median_views: med == null ? null : round(med, 1),
        x: base > 0 && med != null && g.length >= MIN_GROUP ? round(med / base) : null,
        few: g.length < MIN_GROUP || undefined,
        top: g.slice().sort(function (a, b) { return b.views - a.views; }).slice(0, 3).map(function (p) { return brief(p, base); })
      };
    }).sort(function (a, b) {
      if (order) return order.indexOf(a.key) - order.indexOf(b.key);
      return b.n - a.n || (b.x || 0) - (a.x || 0);
    });
  }

  /**
   * Median vs mean. → { n, median, mean, mean_over_median, top3_share, warning, message }
   * Works for any account's posts (own, a niche account, a folder's pool).
   */
  function singleHit(posts) {
    var views = scored(posts).map(function (p) { return p.views; }).sort(function (a, b) { return b - a; });
    var med = median(views);
    var avg = mean(views);
    var total = views.reduce(function (s, v) { return s + v; }, 0);
    var top3 = views.slice(0, 3).reduce(function (s, v) { return s + v; }, 0);
    var ratio = med > 0 && avg != null ? avg / med : null;
    var share = total > 0 ? top3 / total : null;
    var warn = views.length >= 6 && ((ratio != null && ratio >= SINGLE_HIT_RATIO) || (share != null && share >= SINGLE_HIT_SHARE && views.length >= 10));
    return {
      n: views.length, median: med == null ? null : round(med, 1), mean: avg == null ? null : round(avg, 1), mean_over_median: round(ratio),
      top3_share: round(share, 3), warning: warn,
      message: !views.length ? 'No originals with a view count.'
        : warn ? 'Reach comes from a few posts: the average (' + Math.round(avg).toLocaleString('en-US') + ') is ' + round(ratio, 1) + '× the median (' + Math.round(med).toLocaleString('en-US') + ')' + (share != null ? ' and the top 3 posts hold ' + Math.round(share * 100) + '% of all views' : '') + '. Judge a typical post by the median.'
        : 'Steady: the average is ' + (ratio == null ? '—' : round(ratio, 1) + '×') + ' the median.'
    };
  }

  /** The best-hour heatmap from src/metrics.js over originals with views (hours in the viewer's local time). */
  function bestHours(posts) {
    var m = M();
    if (!m || !(m.heatmap || m.analyze)) return null;
    var list = scored(posts).filter(function (p) { return p.takenAt; });
    if (!list.length) return null;
    // metrics.js keeps heatmap() internal; analyze() returns it (same function, same posts).
    var hm = m.heatmap ? m.heatmap(list) : m.analyze(list).heatmap;
    if (!hm) return null;
    var cell = function (c) { return c ? { day: hm.dayLabels[c.day] != null ? hm.dayLabels[c.day] : c.day, block: c.block, hours: c.block != null ? (c.block * hm.blockHours) + ':00–' + ((c.block + 1) * hm.blockHours) + ':00' : undefined, lift: round(c.lift), posts: c.count, confidence: c.confidence } : null; };
    return {
      posts: hm.postsWithTime, block_hours: hm.blockHours, min_posts: hm.minPosts,
      best_slot: cell(hm.best), best_day: hm.bestDay ? { day: hm.dayLabels[hm.bestDay.day], lift: round(hm.bestDay.lift), posts: hm.bestDay.count } : null,
      best_hours: hm.bestHours ? { hours: (hm.bestHours.block * hm.blockHours) + ':00–' + ((hm.bestHours.block + 1) * hm.blockHours) + ':00', lift: round(hm.bestHours.lift), posts: hm.bestHours.count } : null,
      hours: hm.hours.map(function (c) { return { hours: (c.block * hm.blockHours) + ':00–' + ((c.block + 1) * hm.blockHours) + ':00', posts: c.count, lift: round(c.lift) }; }),
      variety_issue: hm.varietyIssue,
      heatmap: hm
    };
  }

  var YES_NO = ['yes', 'no'];
  /**
   * Everything for one account (or a pool). opts: { lang: 'en' | 'tr', heatmap: false to leave the raw grid out }
   * → { n, base_median, types, lengths, first_line, starts_with_number, emoji, link, language, best_hours, single_hit, replies, note }
   */
  function patterns(posts, opts) {
    var list = scored(posts);
    var base = median(list.map(function (p) { return p.views; }));
    var o = { base: base };
    var f = function (key) { return function (p) { return features(p)[key]; }; };
    var yn = function (key) { return function (p) { return features(p)[key] ? 'yes' : 'no'; }; };
    var hours = bestHours(posts);
    if (hours && opts && opts.heatmap === false) delete hours.heatmap;
    var replies = (posts || []).filter(function (p) { var k = kindOf(p); return k === 'reply' || k === 'thread-part'; });
    var labels = TYPE_LABELS[(opts && opts.lang) || 'en'] || TYPE_LABELS.en;
    return {
      n: list.length,
      base_median: base == null ? null : round(base, 1),
      types: breakdown(posts, postType, o).map(function (g) { g.label = labels[g.key] || g.key; return g; }),
      lengths: breakdown(posts, f('length'), Object.assign({ order: LENGTH_BUCKETS.map(function (b) { return b.key; }) }, o)),
      first_line: breakdown(posts, f('firstLine'), Object.assign({ order: FIRST_LINE_BUCKETS.map(function (b) { return b.key; }) }, o)),
      starts_with_number: breakdown(posts, yn('startsWithNumber'), Object.assign({ order: YES_NO }, o)),
      emoji: breakdown(posts, yn('emoji'), Object.assign({ order: YES_NO }, o)),
      link: breakdown(posts, yn('link'), Object.assign({ order: YES_NO }, o)),
      language: breakdown(posts, f('lang'), o),
      best_hours: hours,
      single_hit: singleHit(posts),
      replies: { n: replies.length, median_views: median(replies.map(function (p) { return p.views; }).filter(function (v) { return v != null; })) },
      note: 'Originals with a view count only, each group\'s median views ÷ this account\'s median (' + (base == null ? '—' : Math.round(base)) + '). Groups under ' + MIN_GROUP + ' posts have no ×. Types are guessed from the text with simple rules.'
    };
  }

  return {
    TYPES: TYPES, TYPE_LABELS: TYPE_LABELS, LENGTH_BUCKETS: LENGTH_BUCKETS, FIRST_LINE_BUCKETS: FIRST_LINE_BUCKETS, MIN_GROUP: MIN_GROUP,
    textOf: textOf, langOf: langOf, features: features, postType: postType, isList: isList,
    breakdown: breakdown, singleHit: singleHit, bestHours: bestHours, patterns: patterns, scored: scored
  };
});
