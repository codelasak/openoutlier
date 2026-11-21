// OpenOutlier – phase 5 (keşif / discovery) of docs/youtube-niche-plan.md, the pure part.
// Used by the bridge (mcp/discovery.mjs), the Library and the YouTube content scripts.
//
//   • similar channels (6.4): TF-IDF over each channel's titles, tags and descriptions and
//     cosine similarity; the co-recommendation counts ("Up Next" sidebars) with time decay
//   • niche radar (6.5): what one run costs in Data API units, views per subscriber and VPH
//     of a search result, the two lists (small-channel breakouts, rising channels you don't track)
//   • keyword ideas (6.6): YouTube autocomplete parsing, merging it with title words, your own
//     search terms and topic gaps, and the "ask Claude for the volume" prompt (vidIQ MCP)
//   • channel-rpm: a category RPM table × views, always labelled as an estimate
//
// No I/O here. UMD: Node require()s it, extension pages get self.OpenOutlierDiscovery.
'use strict';

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpenOutlierDiscovery = api;
})(typeof self !== 'undefined' ? self : this, function () {
  var HOUR = 3600000;
  var DAY = 24 * HOUR;
  var CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;

  // ---- words ---------------------------------------------------------------------------------
  // English + Turkish function words, and YouTube boilerplate that every description has.
  var STOP = ('a an and are as at be by can do does for from get got has have how i if in into is it its just my new no not of on or our so than that the their them then ' +
    'this to too up us vs was we what when which who why will with you your yours me more most all any one two out about over use using used here there these those ' +
    'video videos channel subscribe like comment comments share watch full free link links below click please thanks thank follow instagram twitter tiktok facebook ' +
    'http https www com youtube youtu shorts short official part ep episode ' +
    'bir ve ile için bu da de ne nasıl mi mı mu mü en çok daha gibi ama veya ki o şu her olan olarak var yok ben sen biz siz kanal abone ol video videoyu').split(' ');
  var STOPSET = {};
  STOP.forEach(function (w) { STOPSET[w] = true; });

  /** Lower-case words of a text (letters, digits, + and #), without stop words, URLs or bare numbers. */
  function words(text) {
    var out = [];
    String(text || '').toLocaleLowerCase('en-US').replace(/https?:\/\/\S+/g, ' ').replace(/[@#]\w+/g, function (m) { return m.charAt(0) === '#' ? ' ' + m.slice(1) + ' ' : ' '; })
      .split(/[^\p{L}\p{N}+#]+/u).forEach(function (w) {
        if (w.length < 2 || w.length > 40 || STOPSET[w] || /^\d+$/.test(w)) return;
        out.push(w);
      });
    return out;
  }
  function isStop(w) { return !!STOPSET[String(w || '').toLowerCase()]; }
  // Title words that say how, not what: never a keyword on their own.
  var FILLER = {};
  ('did know trick tricks tip tips hack hacks way ways explained explain guide complete minutes minute seconds second beginners beginner stop doing old ' +
    'every day days actually works work prompts replaced half one first best easy quick fast simple ultimate secret secrets vs nobody talks finally ' +
    'everything need must never always really still today now part dakika saniye yeni kolay hızlı').split(' ').forEach(function (w) { FILLER[w] = true; });
  function isFiller(w) { return !!FILLER[String(w || '').toLowerCase()] || /^\d+$/.test(String(w)); }

  // ---- TF-IDF similarity (6.4b) -----------------------------------------------------------------
  /**
   * One channel's term counts. ch: { titles: [], tags: [], descriptions: [] }. Titles count 2×,
   * tags 1× (a multi-word tag also adds its words), descriptions 0.5× and only their first 500
   * characters (the rest is links and boilerplate).
   */
  function termCounts(ch) {
    var tf = {};
    function add(w, k) { tf[w] = (tf[w] || 0) + k; }
    (ch.titles || []).forEach(function (t) { words(t).forEach(function (w) { add(w, 2); }); });
    (ch.tags || []).forEach(function (t) {
      var s = String(t || '').toLowerCase().trim();
      if (!s || isStop(s)) return;
      var ws = words(s);
      if (ws.length > 1) add(ws.join(' '), 1);
      ws.forEach(function (w) { add(w, 0.5); });
    });
    (ch.descriptions || []).forEach(function (d) { words(String(d || '').slice(0, 500)).forEach(function (w) { add(w, 0.5); }); });
    return tf;
  }

  /**
   * TF-IDF vectors for a set of channels. docs: { id: termCounts }. Log-scaled term frequency,
   * smoothed IDF, each vector L2-normalized. Terms in only one channel still count (they keep
   * a channel apart); terms in every channel weigh almost nothing. → { id: { term: weight } }
   */
  function tfidf(docs) {
    var ids = Object.keys(docs);
    var n = ids.length;
    var df = {};
    ids.forEach(function (id) { Object.keys(docs[id]).forEach(function (t) { df[t] = (df[t] || 0) + 1; }); });
    var out = {};
    ids.forEach(function (id) {
      var v = {};
      var norm = 0;
      Object.keys(docs[id]).forEach(function (t) {
        var w = (1 + Math.log(docs[id][t])) * Math.log((1 + n) / (1 + df[t]));
        if (w > 0) { v[t] = w; norm += w * w; }
      });
      norm = Math.sqrt(norm) || 1;
      Object.keys(v).forEach(function (t) { v[t] /= norm; });
      out[id] = v;
    });
    return out;
  }
  function cosine(a, b) {
    var s = 0;
    var small = Object.keys(a).length < Object.keys(b).length ? a : b;
    var big = small === a ? b : a;
    Object.keys(small).forEach(function (t) { if (big[t]) s += small[t] * big[t]; });
    return s;
  }
  /** The terms two vectors share, by their contribution to the similarity. */
  function sharedTerms(a, b, n) {
    return Object.keys(a).filter(function (t) { return b[t] && !isFiller(t); }).map(function (t) { return [t, a[t] * b[t]]; })
      .sort(function (x, y) { return y[1] - x[1]; }).slice(0, n || 5).map(function (x) { return x[0]; });
  }
  /**
   * Channels most like `id` by their words. channels: { id: { titles, tags, descriptions } }.
   * → [{ id, score (0–1 cosine), terms: [shared] }], best first, score ≥ min (default 0.05).
   */
  function similarByText(channels, id, opts) {
    opts = opts || {};
    var docs = {};
    Object.keys(channels).forEach(function (k) { docs[k] = termCounts(channels[k]); });
    if (!docs[id]) return [];
    var vec = tfidf(docs);
    var me = vec[id];
    return Object.keys(vec).filter(function (k) { return k !== id; }).map(function (k) {
      return { id: k, score: round(cosine(me, vec[k]), 3), terms: sharedTerms(me, vec[k], opts.terms || 4) };
    }).filter(function (r) { return r.score >= (opts.min != null ? opts.min : 0.05); })
      .sort(function (a, b) { return b.score - a.score; }).slice(0, opts.limit || 12);
  }

  // ---- co-recommendation (6.4a) -------------------------------------------------------------------
  // The extension sees each watch page's "Up Next" list (the /next response). For the watched
  // video's channel A and every other channel B in that list, the bridge adds 1 to the pair's
  // weight after decaying it: weight · 2^(−Δt / half-life). Only these aggregated, decaying
  // counts are stored: no video ids, no watch times.
  var HALF_LIFE = 30 * DAY;
  var MAX_RECS = 25;
  function decayed(weight, from, to, halfLife) {
    if (!weight) return 0;
    var dt = Math.max(0, (to || 0) - (from || 0));
    return weight * Math.pow(2, -dt / (halfLife || HALF_LIFE));
  }
  /**
   * One sidebar → the pairs to count. source: UC… of the watched video's channel; cards: parseCards
   * records ({ ownerId, ownerName, author }). Each other channel once (a channel with three videos
   * in the list is one co-recommendation), the source itself left out, at most MAX_RECS.
   * → { source, recs: [{ id, name, handle }] } or null.
   */
  function coRecPairs(source, cards) {
    if (!CHANNEL_ID_RE.test(String(source || ''))) return null;
    var seen = {};
    var recs = [];
    (cards || []).forEach(function (c) {
      var id = c && c.ownerId;
      if (!CHANNEL_ID_RE.test(String(id || '')) || id === source || seen[id] || recs.length >= MAX_RECS) return;
      seen[id] = true;
      recs.push({ id: id, name: c.ownerName ? String(c.ownerName).slice(0, 120) : null, handle: c.author ? String(c.author).replace(/^@/, '').slice(0, 60) : null });
    });
    return recs.length ? { source: source, recs: recs } : null;
  }
  /** Add one sidebar to aggregated rows ({ 'A|B': { weight, n, at } }); returns the rows (mutated). */
  function addCoRec(rows, pairs, now, halfLife) {
    if (!pairs) return rows;
    pairs.recs.forEach(function (r) {
      var k = pairs.source + '|' + r.id;
      var cur = rows[k] || { weight: 0, n: 0, at: now };
      rows[k] = { weight: decayed(cur.weight, cur.at, now, halfLife) + 1, n: cur.n + 1, at: now };
    });
    return rows;
  }
  /**
   * Channels recommended alongside `id`, both directions (A's sidebar shows B, or B's shows A).
   * rows: [{ a, b, weight, n, updated_at }]. → [{ id, weight (decayed to now), seen (count), share }]
   * share = this channel's weight ÷ the sum over all of `id`'s co-recommendations.
   */
  function coRecScores(rows, id, now, opts) {
    opts = opts || {};
    var by = {};
    (rows || []).forEach(function (r) {
      var other = r.a === id ? r.b : r.b === id ? r.a : null;
      if (!other || other === id) return;
      var e = by[other] || (by[other] = { id: other, weight: 0, seen: 0 });
      e.weight += decayed(r.weight, r.updated_at, now, opts.halfLife);
      e.seen += r.n || 0;
    });
    var list = Object.keys(by).map(function (k) { return by[k]; }).filter(function (e) { return e.weight >= (opts.minWeight || 0.05); });
    var total = list.reduce(function (s, e) { return s + e.weight; }, 0) || 1;
    list.forEach(function (e) { e.share = round(e.weight / total, 3); e.weight = round(e.weight, 3); });
    list.sort(function (a, b) { return b.weight - a.weight || b.seen - a.seen; });
    return list.slice(0, opts.limit || 20);
  }
  /**
   * Both signals in one ranked list. co: coRecScores, text: similarByText. score = 0.6 · co-rec
   * (its share, scaled so the top one is 1) + 0.4 · text similarity (scaled the same way); a
   * channel found by both ranks above one found by either alone. → [{ id, score, co, text, terms, seen, why }]
   */
  function combineSimilar(co, text, opts) {
    opts = opts || {};
    var maxCo = Math.max.apply(null, [0].concat((co || []).map(function (x) { return x.weight; })));
    var maxTx = Math.max.apply(null, [0].concat((text || []).map(function (x) { return x.score; })));
    var by = {};
    (co || []).forEach(function (x) { by[x.id] = { id: x.id, co: x.weight, seen: x.seen, text: null, terms: [] }; });
    (text || []).forEach(function (x) { var e = by[x.id] || (by[x.id] = { id: x.id, co: null, seen: 0 }); e.text = x.score; e.terms = x.terms; });
    var out = Object.keys(by).map(function (k) {
      var e = by[k];
      var c = e.co && maxCo ? e.co / maxCo : 0;
      var t = e.text && maxTx ? e.text / maxTx : 0;
      e.score = round(0.6 * c + 0.4 * t, 3);
      e.why = e.co && e.text ? 'both' : e.co ? 'corec' : 'text';
      return e;
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, opts.limit || 12);
  }

  // ---- niche radar (6.5) --------------------------------------------------------------------------
  var SEARCH_UNITS = 100;
  var RADAR_DEFAULTS = { maxSubs: 50000, minRatio: 1, minViews: 1000, region: 'US', lang: 'en', perKeyword: 25 };
  /**
   * Data API units for one radar run: search.list costs 100 per keyword; the results' videos.list
   * and channels.list cost 1 per 50 ids each. Up to `perKeyword` results per search (≤ 50), so
   * each keyword adds at most one videos.list call and one channels.list call (fewer when results
   * overlap). → { searches, search, videos, channels, total, perKeyword }
   */
  function radarCost(nKeywords, opts) {
    opts = opts || {};
    var n = Math.max(0, Math.floor(nKeywords || 0));
    var per = Math.min(50, opts.perKeyword || RADAR_DEFAULTS.perKeyword);
    var maxVideos = n * per;
    var videos = Math.ceil(maxVideos / 50);
    var channels = Math.ceil(maxVideos / 50);
    return { searches: n, search: n * SEARCH_UNITS, videos: videos, channels: channels, total: n * SEARCH_UNITS + videos + channels, perKeyword: per };
  }
  function sanitizeRadar(s) {
    s = s && typeof s === 'object' ? s : {};
    var out = {};
    var num = function (v, lo, hi, d) { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
    out.maxSubs = num(s.maxSubs, 1000, 10000000, RADAR_DEFAULTS.maxSubs);
    out.minRatio = num(s.minRatio, 0.1, 100, RADAR_DEFAULTS.minRatio);
    out.minViews = num(s.minViews, 0, 10000000, RADAR_DEFAULTS.minViews);
    out.perKeyword = Math.round(num(s.perKeyword, 5, 50, RADAR_DEFAULTS.perKeyword));
    out.region = /^[A-Z]{2}$/.test(String(s.region || '')) ? s.region : RADAR_DEFAULTS.region;
    out.lang = /^[a-z]{2}$/.test(String(s.lang || '')) ? s.lang : RADAR_DEFAULTS.lang;
    out.keywords = {};
    var kw = s.keywords && typeof s.keywords === 'object' ? s.keywords : {};
    Object.keys(kw).slice(0, 20).forEach(function (niche) {
      var list = Array.isArray(kw[niche]) ? kw[niche] : [];
      var clean = [];
      list.forEach(function (k) {
        var t = String(k || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        if (t && clean.indexOf(t.toLowerCase()) === -1) clean.push(t.toLowerCase());
      });
      out.keywords[String(niche).slice(0, 80)] = clean.slice(0, 30);
    });
    // Keywords whose YouTube rank DataForSEO checks (optional provider).
    out.rankKeywords = (Array.isArray(s.rankKeywords) ? s.rankKeywords : []).map(function (k) { return String(k || '').trim().toLowerCase().slice(0, 80); })
      .filter(function (k, i, a) { return k && a.indexOf(k) === i; }).slice(0, 50);
    return out;
  }
  /** Views per subscriber, VPH and age of one result. v: { views, published_at }, ch: { subs }. */
  function radarMetrics(v, ch, now) {
    var age = v.published_at ? Math.max(1, (now - v.published_at) / HOUR) : null;
    var subs = ch && ch.subs != null ? ch.subs : null;
    return {
      age_h: age != null ? round(age, 1) : null,
      vph: age != null && v.views != null ? round(v.views / age, 1) : null,
      views_per_sub: subs ? round(v.views / subs, 2) : null
    };
  }
  /**
   * The radar's two lists from stored results. videos: [{ video_id, channel_id, views, published_at, … }],
   * channels: { UC: { subs, title, … } }, tracked: { UC: true }. opts: radar settings + now + days (7).
   *   breakouts: videos of the last `days` from channels with ≤ maxSubs subscribers (hidden
   *     subscriber counts left out) whose views ≥ minViews and views ÷ subs ≥ minRatio, best ratio first.
   *   rising: channels you don't track with at least one such video, by their best ratio, with their
   *     videos in the results and which keywords found them.
   */
  function radarLists(videos, channels, tracked, opts) {
    opts = Object.assign({}, RADAR_DEFAULTS, opts || {});
    var now = opts.now || Date.now();
    var since = now - (opts.days || 7) * DAY;
    tracked = tracked || {};
    var out = [];
    (videos || []).forEach(function (v) {
      if (!v || !v.published_at || v.published_at < since) return;
      var ch = channels[v.channel_id] || {};
      if (ch.subs == null || ch.subs > opts.maxSubs) return;
      var m = radarMetrics(v, ch, now);
      if ((v.views || 0) < opts.minViews || m.views_per_sub == null || m.views_per_sub < opts.minRatio) return;
      out.push(Object.assign({}, v, m, { subs: ch.subs, channel: ch.title || null, handle: ch.handle || null, tracked: !!tracked[v.channel_id] }));
    });
    out.sort(function (a, b) { return b.views_per_sub - a.views_per_sub || b.vph - a.vph; });
    var by = {};
    out.forEach(function (v) {
      if (v.tracked) return;
      var e = by[v.channel_id] || (by[v.channel_id] = { channel_id: v.channel_id, channel: v.channel, handle: v.handle, subs: v.subs, thumb: (channels[v.channel_id] || {}).thumb || null,
        videos: [], keywords: [], best_ratio: 0, views: 0 });
      e.videos.push({ video_id: v.video_id, title: v.title, views: v.views, views_per_sub: v.views_per_sub, vph: v.vph, published_at: v.published_at });
      (v.keywords || [v.keyword]).forEach(function (k) { if (k && e.keywords.indexOf(k) === -1) e.keywords.push(k); });
      e.best_ratio = Math.max(e.best_ratio, v.views_per_sub);
      e.views += v.views || 0;
    });
    var rising = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.best_ratio - a.best_ratio || b.views - a.views; });
    return { breakouts: out, rising: rising };
  }
  /**
   * Keyword suggestions for a niche's radar list, from what the niche already says works.
   * src: { titleWords: [{ word, n, lift }], searchTerms: [{ term, views }], gaps: [{ word, lift }], existing: [] }
   * → [{ keyword, from: 'search'|'gap'|'title', n }] (your own search terms first: viewers already find you there).
   */
  function suggestKeywords(src, opts) {
    opts = opts || {};
    var have = {};
    (src.existing || []).forEach(function (k) { have[String(k).toLowerCase()] = true; });
    var out = [];
    function add(k, from, n) {
      k = String(k || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (!k || k.length < 3 || have[k] || isStop(k)) return;
      have[k] = true;
      out.push({ keyword: k, from: from, n: n == null ? null : n });
    }
    (src.searchTerms || []).slice().sort(function (a, b) { return (b.views || 0) - (a.views || 0); }).slice(0, 6).forEach(function (t) { add(t.term, 'search', t.views); });
    var prefix = opts.prefix ? String(opts.prefix).toLowerCase() : null;
    (src.gaps || []).filter(function (g) { return !isFiller(g.word); }).slice(0, 5).forEach(function (g) { add(prefix && g.word.indexOf(prefix) === -1 ? prefix + ' ' + g.word : g.word, 'gap', g.n); });
    (src.titleWords || []).filter(function (w) { return !isFiller(w.word) && w.word !== prefix && (w.lift == null || w.lift >= 1); }).slice(0, 8)
      .forEach(function (w) { add(prefix && w.word.indexOf(prefix) === -1 ? prefix + ' ' + w.word : w.word, 'title', w.n); });
    return out.slice(0, opts.limit || 12);
  }
  /**
   * The niche's most common word: the prefix that makes "pivot" into "excel pivot". texts: one string
   * per video (its title and tags); the word must be in at least 30 % of them.
   */
  function nichePrefix(texts) {
    var c = {};
    (texts || []).forEach(function (t) { words(t).filter(function (w, i, a) { return a.indexOf(w) === i && !isFiller(w); }).forEach(function (w) { c[w] = (c[w] || 0) + 1; }); });
    var best = Object.keys(c).sort(function (a, b) { return c[b] - c[a] || a.localeCompare(b); })[0];
    return best && c[best] >= Math.max(3, (texts || []).length * 0.3) ? best : null;
  }

  // ---- keyword ideas (6.6) -------------------------------------------------------------------------
  var SUGGEST_URL = 'https://suggestqueries.google.com/complete/search';
  /** The autocomplete request (unofficial, free): YouTube's own suggestions (ds=yt). hl/gl matter: without them Google answers in the IP's language. */
  function suggestUrl(q, opts) {
    opts = opts || {};
    return SUGGEST_URL + '?client=firefox&ds=yt&q=' + encodeURIComponent(String(q || '').slice(0, 100)) + '&hl=' + encodeURIComponent(opts.hl || 'en') + '&gl=' + encodeURIComponent(opts.gl || 'US');
  }
  /**
   * The autocomplete answer → suggestions. client=firefox: ["q", ["s1", "s2", …], …]; the
   * youtube client's JSONP: window.google.ac.h(["q", [["s1", 0, …], …], …]). Anything else → [].
   */
  function parseSuggest(body) {
    var j = body;
    if (typeof body === 'string') {
      var t = body.trim();
      var m = /^[\w.$]+\(([\s\S]*)\)\s*;?\s*$/.exec(t);
      if (m) t = m[1];
      try { j = JSON.parse(t); } catch (e) { return []; }
    }
    if (!Array.isArray(j) || !Array.isArray(j[1])) return [];
    var out = [];
    j[1].forEach(function (s) {
      var v = Array.isArray(s) ? s[0] : s;
      v = typeof v === 'string' ? v.replace(/<\/?b>/g, '').replace(/\s+/g, ' ').trim() : '';
      if (v && v.length <= 120 && out.indexOf(v.toLowerCase()) === -1) out.push(v.toLowerCase());
    });
    return out;
  }
  /** The usual "a…z" expansion of a seed: "excel a", "excel b" … (each one more autocomplete call). */
  function expansions(seed, letters) {
    return String(letters || 'abcdefghijklmnoprstuvwyz').split('').map(function (c) { return seed + ' ' + c; });
  }
  function normTerm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  /**
   * Merge everything into one list. src: {
   *   suggestions: { seed: [strings] }  (autocomplete, seed order kept),
   *   titleWords: [{ word, n, lift }], ownTerms: [{ term, views, last_week }], gaps: [{ word, n, lift }],
   *   prefix: 'excel' (to make one-word ideas searchable), radar: [keywords already on the radar]
   * }
   * → [{ keyword, sources: [...], seeds: [...], ranks: { views, last_week } | null, lift, on_radar }]
   * Order: terms you already rank for, then autocomplete ideas that match a fast title word or a gap,
   * then the rest of autocomplete, then title words / gaps that autocomplete didn't return.
   */
  function keywordIdeas(src, opts) {
    opts = opts || {};
    var by = {};
    var order = [];
    function get(k) {
      k = normTerm(k);
      if (!k || k.length < 2) return null;
      if (!by[k]) { by[k] = { keyword: k, sources: [], seeds: [], ranks: null, lift: null, on_radar: false }; order.push(k); }
      return by[k];
    }
    function tag(e, s) { if (e && e.sources.indexOf(s) === -1) e.sources.push(s); }
    var own = {};
    (src.ownTerms || []).forEach(function (t) { var k = normTerm(t.term); if (k) own[k] = { views: t.views || 0, last_week: t.last_week != null ? t.last_week : null }; });
    var lift = {};
    (src.titleWords || []).forEach(function (w) { lift[normTerm(w.word)] = { lift: w.lift, from: 'title' }; });
    (src.gaps || []).forEach(function (g) { lift[normTerm(g.word)] = { lift: g.lift, from: 'gap' }; });
    var sug = src.suggestions || {};
    Object.keys(sug).forEach(function (seed) {
      (sug[seed] || []).forEach(function (s) { var e = get(s); if (e) { tag(e, 'autocomplete'); if (e.seeds.indexOf(seed) === -1) e.seeds.push(seed); } });
    });
    var prefix = src.prefix ? normTerm(src.prefix) : null;
    function phrase(w) { return prefix && w.indexOf(prefix) === -1 ? prefix + ' ' + w : w; }
    (src.titleWords || []).forEach(function (w) { if (!isFiller(w.word) && normTerm(w.word) !== prefix) tag(get(phrase(w.word)), 'title'); });
    (src.gaps || []).forEach(function (g) { if (!isFiller(g.word)) tag(get(phrase(g.word)), 'gap'); });
    (src.ownTerms || []).forEach(function (t) { tag(get(t.term), 'search'); });
    var radar = {};
    (src.radar || []).forEach(function (k) { radar[normTerm(k)] = true; });
    var list = order.map(function (k) {
      var e = by[k];
      // Ranks: the term itself is one of your search terms, or one of them contains it word for word.
      var r = own[k] || null;
      if (!r) Object.keys(own).forEach(function (t) { if (!r && (' ' + t + ' ').indexOf(' ' + k + ' ') !== -1 && k.split(' ').length >= 2) r = own[t]; });
      e.ranks = r;
      var best = null;
      k.split(' ').forEach(function (w) { var l = lift[w]; if (l && l.lift != null && (best == null || l.lift > best)) best = l.lift; });
      e.lift = best != null ? round(best, 2) : null;
      e.on_radar = !!radar[k];
      return e;
    });
    function rank(e) {
      if (e.ranks) return 0;
      var ac = e.sources.indexOf('autocomplete') !== -1;
      if (ac && e.lift != null && e.lift >= 1.2) return 1;
      if (ac) return 2;
      return 3;
    }
    list.forEach(function (e, i) { e._i = i; });
    list.sort(function (a, b) { return rank(a) - rank(b) || (b.ranks ? b.ranks.views : 0) - (a.ranks ? a.ranks.views : 0) || (b.lift || 0) - (a.lift || 0) || a._i - b._i; });
    list.forEach(function (e) { delete e._i; });
    return list.slice(0, opts.limit || 150);
  }
  /**
   * The text for "Ask Claude for the volume": Claude looks the volume up through the vidIQ MCP
   * connector (~30 calls a month on the free plan), so the prompt asks for at most `max` calls
   * and only for keywords that don't already have an answer.
   */
  function volumePrompt(keywords, opts) {
    opts = opts || {};
    var tr = opts.lang === 'tr';
    var list = (keywords || []).map(normTerm).filter(Boolean).slice(0, opts.max || 10);
    var max = Math.min(list.length, opts.max || 10);
    if (tr) {
      return 'vidIQ MCP bağlayıcısıyla şu YouTube anahtar kelimelerinin aylık arama hacmini ve rekabetini bul (' + (opts.gl || 'US') + ', ' + (opts.hl || 'en') + '):\n' +
        list.map(function (k) { return '- ' + k; }).join('\n') + '\n\n' +
        'Kurallar: vidIQ\'nun ücretsiz planı ayda ~30 çağrı veriyor; bu iş için en fazla ' + max + ' çağrı yap, mümkünse birden çok kelimeyi tek çağrıda sor. ' +
        'Bir kelimenin hacmini bu ay zaten sorduysan tekrar sorma. vidIQ bağlı değilse ya da limit dolduysa dur ve söyle; tahmin uydurma. ' +
        'Sonucu hacim, rekabet ve "bu kanal için öncelik" sütunlu bir tabloyla ver. Bağlam için OpenOutlier MCP\'nin keyword_ideas aracına (' + (opts.niche ? 'niş: ' + opts.niche : 'varsayılan niş') + ') bakabilirsin.';
    }
    return 'Use the vidIQ MCP connector to look up the monthly YouTube search volume and competition of these keywords (' + (opts.gl || 'US') + ', ' + (opts.hl || 'en') + '):\n' +
      list.map(function (k) { return '- ' + k; }).join('\n') + '\n\n' +
      'Rules: vidIQ\'s free plan allows about 30 calls a month; use at most ' + max + ' calls for this, asking for several keywords per call where the tool allows. ' +
      'Don\'t look up a keyword you already checked this month. If vidIQ isn\'t connected or its limit is used up, stop and say so; never guess numbers. ' +
      'Answer with a table: volume, competition, and priority for this channel. For context, OpenOutlier MCP\'s keyword_ideas tool (' + (opts.niche ? 'niche: ' + opts.niche : 'the default niche') + ') has where each idea came from.';
  }

  // ---- channel-rpm: estimated RPM and revenue -------------------------------------------------------
  // What a creator typically earns per 1,000 long-form views (RPM, after YouTube's share), by the
  // video's YouTube category, USD, for mostly US/UK/CA/AU audiences. Rough public ranges (creator
  // reports and RPM surveys, 2024–2026); real RPM varies 3× or more by country, season and topic.
  // Shorts are paid from a shared pool and earn far less per view.
  var RPM_TABLE = {
    'Education': [3, 9], 'Science & Technology': [3, 8], 'Howto & Style': [2, 6], 'People & Blogs': [1.5, 5], 'Autos & Vehicles': [3, 8],
    'Travel & Events': [2, 6], 'News & Politics': [1.5, 5], 'Nonprofits & Activism': [1.5, 4], 'Film & Animation': [1.5, 4], 'Pets & Animals': [1.5, 4],
    'Sports': [1.5, 4], 'Entertainment': [1, 4], 'Comedy': [1, 3], 'Gaming': [1, 3.5], 'Music': [0.5, 2]
  };
  var RPM_DEFAULT = [1.5, 5];
  var SHORTS_RPM = [0.02, 0.08];
  /** The most common category among saved videos (watch pages and the Data API name it). */
  function mainCategory(posts) {
    var c = {};
    (posts || []).forEach(function (p) { if (p && p.category) c[p.category] = (c[p.category] || 0) + 1; });
    return Object.keys(c).sort(function (a, b) { return c[b] - c[a]; })[0] || null;
  }
  /**
   * Views per month: the tracker's daily total views (the last ≤ 28 days, scaled to 30), else the
   * channel's lifetime average (total views ÷ months since it started), else the saved videos of the
   * last 90 days (a floor: back-catalog views are missing). → { views, basis } | null
   */
  function monthlyViews(opts) {
    var s = (opts.series || []).filter(function (p) { return p && p.views != null; });
    if (s.length >= 7) {
      var last = s[s.length - 1];
      var first = s[Math.max(0, s.length - 29)];
      var days = Math.max(1, (Date.parse(last.day) - Date.parse(first.day)) / DAY);
      if (days >= 6 && last.views >= first.views) return { views: Math.round((last.views - first.views) / days * 30), basis: 'tracked', days: Math.round(days) };
    }
    var now = opts.now || Date.now();
    if (opts.totalViews && opts.createdAt && now - opts.createdAt > 30 * DAY) {
      return { views: Math.round(opts.totalViews / ((now - opts.createdAt) / (30 * DAY))), basis: 'lifetime' };
    }
    var recent = (opts.posts || []).filter(function (p) { return p && p.takenAt && now - p.takenAt < 90 * DAY && p.views; });
    if (recent.length >= 3) return { views: Math.round(recent.reduce(function (a, p) { return a + p.views; }, 0) / 3), basis: 'recent-uploads' };
    return null;
  }
  /**
   * The estimate. opts: { category, views (per month), shortsShare (0–1 of those views from Shorts) }.
   * → { category, known (category in the table), rpm: [lo, hi], shortsRpm, monthly: [lo, hi] | null, estimate: true }
   */
  function rpmEstimate(opts) {
    opts = opts || {};
    var known = !!RPM_TABLE[opts.category];
    var rpm = known ? RPM_TABLE[opts.category] : RPM_DEFAULT;
    var out = { category: opts.category || null, known: known, rpm: rpm.slice(), shortsRpm: SHORTS_RPM.slice(), monthly: null, estimate: true };
    if (opts.views != null && opts.views >= 0) {
      var sh = Math.min(1, Math.max(0, opts.shortsShare || 0));
      var lv = opts.views * (1 - sh);
      var sv = opts.views * sh;
      out.monthly = [round(lv / 1000 * rpm[0] + sv / 1000 * SHORTS_RPM[0], 0), round(lv / 1000 * rpm[1] + sv / 1000 * SHORTS_RPM[1], 0)];
    }
    return out;
  }

  function round(x, d) { if (x == null || !isFinite(x)) return null; var p = Math.pow(10, d == null ? 2 : d); return Math.round(x * p) / p; }

  return {
    HALF_LIFE: HALF_LIFE, MAX_RECS: MAX_RECS, SEARCH_UNITS: SEARCH_UNITS, RADAR_DEFAULTS: RADAR_DEFAULTS, RPM_TABLE: RPM_TABLE, RPM_DEFAULT: RPM_DEFAULT, SHORTS_RPM: SHORTS_RPM,
    words: words, isStop: isStop, isFiller: isFiller, termCounts: termCounts, tfidf: tfidf, cosine: cosine, similarByText: similarByText,
    decayed: decayed, coRecPairs: coRecPairs, addCoRec: addCoRec, coRecScores: coRecScores, combineSimilar: combineSimilar,
    radarCost: radarCost, sanitizeRadar: sanitizeRadar, radarMetrics: radarMetrics, radarLists: radarLists, suggestKeywords: suggestKeywords, nichePrefix: nichePrefix,
    suggestUrl: suggestUrl, parseSuggest: parseSuggest, expansions: expansions, keywordIdeas: keywordIdeas, volumePrompt: volumePrompt,
    mainCategory: mainCategory, monthlyViews: monthlyViews, rpmEstimate: rpmEstimate
  };
});
