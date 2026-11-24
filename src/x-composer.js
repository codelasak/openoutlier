// OpenOutlier – X draft checks without an LLM (docs/x-plan.md 5.3, phase 4).
//
// What the composer strip on x.com shows while the user writes. Nothing here posts, fills or
// changes anything: it only reads the draft text and returns findings.
//
//   weightedLength(text)      twitter-text v3 weighted count: URL = 23, CJK and emoji = 2, the rest = 1
//   hook(text)                the first line (the hook) and the part visible before "Show more"
//   findBait(text)            engagement-bait phrases (TR + EN), each with its span in the text
//   similarity(text, list)    character-trigram Jaccard (and containment) against a swipe file / recent posts
//   links(text)               the URLs, with whether they leave x.com
//   checkDraft(text, opts)    everything above as one list of findings, TR + EN messages
//
// Spans are UTF-16 indexes into the original text (what a textarea / DOM Range uses).
// Pure functions; UMD: self.OpenOutlierXComposer.
'use strict';

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpenOutlierXComposer = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // ---- twitter-text v3 configuration (github.com/twitter/twitter-text, config/v3.json) --------------
  var CONFIG = {
    version: 3,
    maxWeightedTweetLength: 280,
    scale: 100,
    defaultWeight: 200,
    transformedURLLength: 23,
    emojiParsingEnabled: true,
    // Code point ranges that weigh 100 (= 1 character). Everything else (CJK, most emoji…) weighs 200.
    ranges: [
      { start: 0, end: 4351, weight: 100 },
      { start: 8192, end: 8205, weight: 100 },
      { start: 8208, end: 8223, weight: 100 },
      { start: 8242, end: 8247, weight: 100 }
    ]
  };
  /** Premium long posts (help.x.com, 2026-11): up to 25,000 characters; the timeline cuts at "Show more". */
  var PREMIUM_LIMIT = 25000;
  /** A first line longer than this (weighted) reads as a paragraph, not a hook. */
  var HOOK_LONG = 120;
  /** Similarity: Jaccard at or above this is "near copy"; containment of the draft in a post likewise. */
  var SIM_WARN = 0.5;
  var SIM_INFO = 0.35;
  var CONTAIN_WARN = 0.8;
  var SIM_MIN_CHARS = 30;

  // ---- URLs -------------------------------------------------------------------------------------------
  // A practical subset of twitter-text's extractor: explicit http(s) links and bare domains with a
  // known TLD. Trailing punctuation is not part of the URL.
  var TLDS = 'com|net|org|io|dev|co|ai|app|me|tr|com\\.tr|org\\.tr|net\\.tr|edu|gov|info|biz|xyz|so|sh|ly|gg|tv|fm|to|us|uk|co\\.uk|de|fr|es|it|nl|eu|ca|au|in|jp|cn|ru|br|link|site|online|store|blog|page|news|tech|cloud|studio|design|tools|ws|cc';
  var URL_RE = new RegExp('(?:https?:\\/\\/[^\\s<>"\']+|(?<![\\p{L}\\p{N}@._/-])(?:www\\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:' + TLDS + ')(?![\\p{L}\\p{N}-])(?:\\/[^\\s<>"\']*)?)', 'giu');
  var TRAIL_RE = /[.,:;!?)\]}'"»”’…]+$/;
  var X_HOST_RE = /^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x\.com|twitter\.com|t\.co)(?:[\/?#]|$)/i;

  /** [{ url, start, end, external }] — external = leaves x.com / twitter.com. */
  function links(text) {
    var s = String(text || '');
    var out = [];
    URL_RE.lastIndex = 0;
    var m;
    while ((m = URL_RE.exec(s))) {
      var u = m[0];
      var trail = u.match(TRAIL_RE);
      // Keep a closing ")" when the URL has its own "(" (Wikipedia-style links).
      if (trail) {
        var cut = trail[0];
        if (cut.charAt(0) === ')' && u.indexOf('(') !== -1) cut = cut.slice(1);
        u = u.slice(0, u.length - cut.length);
      }
      if (!u || !/[a-z0-9]/i.test(u)) continue;
      out.push({ url: u, start: m.index, end: m.index + u.length, external: !X_HOST_RE.test(u) });
    }
    return out;
  }

  // ---- emoji ------------------------------------------------------------------------------------------
  // One emoji = one weight-200 unit however many code points it has (ZWJ families, skin tones, flags,
  // keycaps, tag sequences). Text-style symbols (© ® ‼) count as emoji only with VS16 (U+FE0F).
  var EMOJI_RE = /(?:\p{Regional_Indicator}{2}|[#*0-9]️?⃣|(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}️)(?:\p{Emoji_Modifier}|️)?(?:[\u{E0020}-\u{E007E}]+\u{E007F})?(?:‍(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:\p{Emoji_Modifier}|️)?)*)/gu;
  function emojis(text) {
    var s = String(text || '');
    var out = [];
    EMOJI_RE.lastIndex = 0;
    var m;
    while ((m = EMOJI_RE.exec(s))) out.push({ emoji: m[0], start: m.index, end: m.index + m[0].length });
    return out;
  }

  function weightOf(cp) {
    for (var i = 0; i < CONFIG.ranges.length; i++) {
      var r = CONFIG.ranges[i];
      if (cp >= r.start && cp <= r.end) return r.weight;
    }
    return CONFIG.defaultWeight;
  }

  /**
   * The weighted length of a draft, as X counts it.
   * → { weighted, limit, remaining, valid, chars (code points), urls, emojis, permillage }
   */
  function weightedLength(text, opts) {
    opts = opts || {};
    var s = String(text || '').normalize('NFC');
    var limit = opts.limit || CONFIG.maxWeightedTweetLength;
    var skip = []; // [start, end, weight] for URLs and emoji
    links(s).forEach(function (l) { skip.push([l.start, l.end, CONFIG.transformedURLLength * CONFIG.scale]); });
    if (CONFIG.emojiParsingEnabled) {
      emojis(s).forEach(function (e) {
        var inside = skip.some(function (k) { return e.start >= k[0] && e.start < k[1]; });
        if (!inside) skip.push([e.start, e.end, CONFIG.defaultWeight]);
      });
    }
    skip.sort(function (a, b) { return a[0] - b[0]; });
    var total = 0, chars = 0, i = 0, k = 0;
    while (i < s.length) {
      if (k < skip.length && skip[k][0] === i) {
        total += skip[k][2];
        chars += Array.from(s.slice(skip[k][0], skip[k][1])).length;
        i = skip[k][1];
        k++;
        continue;
      }
      var cp = s.codePointAt(i);
      total += weightOf(cp);
      chars++;
      i += cp > 0xFFFF ? 2 : 1;
    }
    var weighted = Math.ceil(total / CONFIG.scale);
    return {
      weighted: weighted,
      limit: limit,
      remaining: limit - weighted,
      valid: weighted > 0 && weighted <= limit && !!s.trim(),
      chars: chars,
      urls: links(s).length,
      emojis: emojis(s).length,
      permillage: Math.floor(total / CONFIG.scale * 1000 / limit)
    };
  }

  /** The longest prefix of text whose weighted length is ≤ max (cut at a word boundary when it can). */
  function prefixUpTo(text, max) {
    var s = String(text || '');
    if (weightedLength(s).weighted <= max) return s;
    // Binary search over UTF-16 cut points (never inside a surrogate pair).
    var lo = 0, hi = s.length;
    while (lo < hi) {
      var mid = Math.ceil((lo + hi) / 2);
      if (weightedLength(s.slice(0, mid)).weighted <= max) lo = mid; else hi = mid - 1;
    }
    var cut = lo;
    if (cut > 0 && /[\uDC00-\uDFFF]/.test(s.charAt(cut)) && /[\uD800-\uDBFF]/.test(s.charAt(cut - 1))) cut--;
    var word = s.slice(0, cut).search(/\s\S*$/);
    if (word > cut * 0.6) cut = word;
    return s.slice(0, cut).replace(/\s+$/, '');
  }

  /**
   * The hook: the first non-empty line, and what the timeline shows before "Show more" (posts longer
   * than 280 weighted characters are Premium long posts, cut at ~280 on the timeline).
   * → { firstLine, firstLineWeighted, firstLineWords, lines, visible, hidden (weighted chars after the cut), truncated }
   */
  function hook(text) {
    var s = String(text || '');
    var lines = s.split(/\r?\n/);
    var first = '';
    for (var i = 0; i < lines.length; i++) { if (lines[i].trim()) { first = lines[i].trim(); break; } }
    var total = weightedLength(s).weighted;
    var truncated = total > CONFIG.maxWeightedTweetLength;
    var visible = truncated ? prefixUpTo(s, CONFIG.maxWeightedTweetLength) : s;
    return {
      firstLine: first,
      firstLineWeighted: weightedLength(first).weighted,
      firstLineWords: first ? first.split(/\s+/).length : 0,
      lines: lines.filter(function (l) { return l.trim(); }).length,
      visible: visible,
      hidden: truncated ? total - weightedLength(visible).weighted : 0,
      truncated: truncated
    };
  }

  // ---- engagement bait ----------------------------------------------------------------------------------
  // Original Content Rewards (help.x.com, 2026-11-24) does not pay for "engagement baiting".
  // level: 'warn' = asks for likes / reposts / follows / replies outright; 'info' = softer CTA.
  // Patterns run on a lower-cased copy of the same length (İ/I → i), so spans map 1:1. Turkish word
  // ends use (?![\p{L}\p{N}]) because \b does not know ğ, ş, ı.
  var E = '(?![\\p{L}\\p{N}])';
  var B = '(?<![\\p{L}\\p{N}])';
  var BAIT = [
    // English
    { id: 'en-like-if', lang: 'en', level: 'warn', re: B + '(?:like|fav|heart)\\s+(?:this\\s+)?(?:post\\s+|tweet\\s+)?if' + E },
    { id: 'en-rt-if', lang: 'en', level: 'warn', re: B + '(?:rt|retweet|repost|share)\\s+(?:this\\s+)?(?:post\\s+|tweet\\s+)?(?:if|so|to\\s+(?:help|save|spread))' + E },
    { id: 'en-like-rt', lang: 'en', level: 'warn', re: B + '(?:like|fav)\\s*(?:and|&|\\+|\\/)\\s*(?:rt|retweet|repost|share|follow)' + E },
    { id: 'en-rt-like', lang: 'en', level: 'warn', re: B + '(?:rt|retweet|repost)\\s*(?:and|&|\\+|\\/)\\s*(?:like|follow)' + E },
    { id: 'en-follow-more', lang: 'en', level: 'warn', re: B + 'follow\\s+(?:me\\s+|@\\w+\\s+)?for\\s+(?:more|daily|part)' + E },
    { id: 'en-follow-me', lang: 'en', level: 'warn', re: B + '(?:make\\s+sure\\s+(?:to|you)\\s+|don\'?t\\s+forget\\s+to\\s+)?follow\\s+(?:me|us)\\s+(?:so|to|if|and)' + E },
    { id: 'en-comment-below', lang: 'en', level: 'warn', re: B + '(?:comment|reply|drop\\s+(?:a\\s+)?(?:comment|reply))\\s+(?:below|down\\s+below)' + E },
    { id: 'en-comment-word', lang: 'en', level: 'warn', re: B + '(?:comment|reply)\\s+(?:with\\s+)?["“\'][^"”\']{1,20}["”\']\\s+(?:and|&|to\\s+get|for)' + E },
    { id: 'en-type-yes', lang: 'en', level: 'warn', re: B + '(?:type|say|reply|comment)\\s+["“\']?(?:yes|yes!|1|me|🙋|🔥)["”\']?\\s+if' + E },
    { id: 'en-tag-friend', lang: 'en', level: 'warn', re: B + 'tag\\s+(?:a|your|someone|somebody|3|three|a\\s+friend|your\\s+friends?)' + E },
    { id: 'en-smash-like', lang: 'en', level: 'warn', re: B + '(?:smash|hit)\\s+(?:that|the)\\s+(?:like|follow|retweet|repost)' + E },
    { id: 'en-dont-scroll', lang: 'en', level: 'info', re: B + 'don\'?t\\s+(?:just\\s+)?scroll(?:\\s+past)?' + E },
    { id: 'en-bookmark', lang: 'en', level: 'info', re: B + '(?:bookmark|save)\\s+this(?:\\s+(?:post|thread|tweet))?(?:\\s+for\\s+later)?' + E },
    // Turkish
    { id: 'tr-rt', lang: 'tr', level: 'warn', re: B + '(?:rt|retweet|repost)(?:\'?le(?:yin|yiniz)?|\\s+(?:at(?:ın)?|yap(?:ın)?|edin|et))' + E },
    { id: 'tr-like', lang: 'tr', level: 'warn', re: B + '(?:beğen(?:in|iniz)?|beğenirsen(?:iz)?|like(?:\'?la(?:yın)?|\\s+at(?:ın)?))' + E },
    { id: 'tr-like-and', lang: 'tr', level: 'warn', re: B + 'beğen(?:ip|\\s+ve)\\s+(?:rt|retweet|paylaş|takip|kaydet|yorum)' },
    { id: 'tr-follow', lang: 'tr', level: 'warn', re: B + 'takip\\s+(?:et(?:meyi\\s+unutma(?:yın)?|men\\s+yeterli)?|edin(?:iz)?)' + E },
    { id: 'tr-follow-more', lang: 'tr', level: 'warn', re: B + '(?:daha\\s+fazlası|devamı|fazlası)\\s+için\\s+takip' },
    { id: 'tr-comment', lang: 'tr', level: 'warn', re: B + '(?:yorum(?:lar)?a|yoruma|alta|aşağıya)\\s+(?:yaz(?:ın)?|bırak(?:ın)?|ekle(?:yin)?)' + E },
    { id: 'tr-comment-do', lang: 'tr', level: 'warn', re: B + 'yorum\\s+(?:yap(?:ın)?|bırak(?:ın)?|yaz(?:ın)?)' + E },
    { id: 'tr-write-get', lang: 'tr', level: 'warn', re: B + 'yaz(?:ın)?[,]?\\s+(?:göndereyim|atayım|yollayayım|dm\'?den)' },
    { id: 'tr-tag', lang: 'tr', level: 'warn', re: B + '(?:arkadaşını|arkadaşlarını|birini|dostunu)\\s+etiketle(?:yin)?' + E },
    { id: 'tr-reach', lang: 'tr', level: 'warn', re: B + '(?:çok|daha\\s+çok)\\s+kişiye\\s+ulaşsın' + E },
    { id: 'tr-heart', lang: 'tr', level: 'warn', re: B + '(?:kalp|❤️?|🔥)\\s+(?:bırak|at)(?:ın)?' + E },
    { id: 'tr-save', lang: 'tr', level: 'info', re: B + '(?:kaydet(?:in)?|yer\\s+işaretine\\s+ekle)(?:\\s+sonra\\s+lazım\\s+olur)?' + E },
    { id: 'tr-dont-scroll', lang: 'tr', level: 'info', re: B + '(?:geçme(?:yin)?|kaydırma(?:yın)?)[,!]?\\s*(?:oku|okuyun|bak)' }
  ].map(function (p) { return { id: p.id, lang: p.lang, level: p.level, re: new RegExp(p.re, 'giu') }; });

  /** Lower-case without changing the length (İ, I → i), so match indexes are indexes into the original. */
  function lowerSameLength(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === 'İ' || c === 'I') { out += 'i'; continue; }
      var l = c.toLowerCase();
      out += l.length === 1 ? l : c;
    }
    return out;
  }

  /** [{ id, lang, level, text, start, end }], sorted by position; overlapping matches keep the first/longest. */
  function findBait(text) {
    var s = String(text || '');
    var low = lowerSameLength(s).replace(/[’‘]/g, "'");
    var hits = [];
    BAIT.forEach(function (p) {
      p.re.lastIndex = 0;
      var m;
      while ((m = p.re.exec(low))) {
        if (!m[0]) { p.re.lastIndex++; continue; }
        hits.push({ id: p.id, lang: p.lang, level: p.level, text: s.slice(m.index, m.index + m[0].length), start: m.index, end: m.index + m[0].length });
      }
    });
    hits.sort(function (a, b) { return a.start - b.start || (b.end - b.start) - (a.end - a.start); });
    var out = [];
    hits.forEach(function (h) {
      var last = out[out.length - 1];
      if (last && h.start < last.end) {
        if (h.level === 'warn' && last.level !== 'warn') out[out.length - 1] = h;
        return;
      }
      out.push(h);
    });
    return out;
  }

  // ---- similarity -------------------------------------------------------------------------------------------
  /** Text for comparison: lower case, no URLs or @mentions, letters and digits only, single spaces. */
  function normForSim(text) {
    var s = String(text || '').normalize('NFC');
    links(s).reverse().forEach(function (l) { s = s.slice(0, l.start) + ' ' + s.slice(l.end); });
    s = lowerSameLength(s).replace(/@\w+/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    return s;
  }
  function trigrams(text) {
    var s = ' ' + normForSim(text) + ' ';
    var cps = Array.from(s);
    var set = new Set();
    for (var i = 0; i + 3 <= cps.length; i++) set.add(cps[i] + cps[i + 1] + cps[i + 2]);
    return set;
  }
  /** Jaccard of two trigram sets, and how much of a is in b (containment). */
  function compareSets(a, b) {
    if (!a.size || !b.size) return { jaccard: 0, containment: 0 };
    var inter = 0;
    var small = a.size <= b.size ? a : b, big = small === a ? b : a;
    small.forEach(function (g) { if (big.has(g)) inter++; });
    return { jaccard: inter / (a.size + b.size - inter), containment: inter / a.size };
  }
  function itemText(it) { return typeof it === 'string' ? it : it && (it.text || it.full_text || it.note || it.title) || ''; }

  /**
   * The draft against a list of texts (strings or { id, text, url, author }).
   * opts: { source ('swipe' | 'recent' | …), threshold (SIM_WARN), top (3) }
   * → { top: [{ source, index, id, url, author, jaccard, containment, level }], flagged: [...same, level != null] }
   */
  function similarity(text, list, opts) {
    opts = opts || {};
    var warnAt = opts.threshold == null ? SIM_WARN : opts.threshold;
    var infoAt = Math.min(SIM_INFO, warnAt);
    var a = trigrams(text);
    var draftLen = normForSim(text).length;
    var rows = [];
    (Array.isArray(list) ? list : []).forEach(function (it, i) {
      var t = itemText(it);
      if (!t) return;
      var r = compareSets(a, trigrams(t));
      var level = null;
      if (draftLen >= SIM_MIN_CHARS) {
        if (r.jaccard >= warnAt || (r.containment >= CONTAIN_WARN && draftLen >= 40)) level = 'warn';
        else if (r.jaccard >= infoAt) level = 'info';
      }
      rows.push({ source: opts.source || null, index: i, id: it && it.id || null, url: it && it.url || null, author: it && it.author || null,
        jaccard: round3(r.jaccard), containment: round3(r.containment), level: level });
    });
    rows.sort(function (x, y) { return y.jaccard - x.jaccard || y.containment - x.containment; });
    return { top: rows.slice(0, opts.top || 3), flagged: rows.filter(function (r) { return r.level; }) };
  }
  function round3(x) { return Math.round(x * 1000) / 1000; }

  // ---- checkDraft --------------------------------------------------------------------------------------------
  function finding(id, severity, tr, en, extra) {
    var f = { id: id, severity: severity, tr: tr, en: en };
    if (extra) Object.keys(extra).forEach(function (k) { f[k] = extra[k]; });
    return f;
  }
  var SEV = { error: 0, warn: 1, info: 2 };

  /**
   * All draft checks.
   * opts: {
   *   swipe:  [string | { id, text, url, author }]   the swipe file (5.1)
   *   recent: [string | { id, text, url, author }]   posts seen lately (timeline, niche)
   *   media:  [{ type: 'image'|'video'|'gif', ai: bool }]  attachments; ai = the user marked it AI-made
   *   aiDisclosed: bool      the post already carries X's "Made with AI" label
   *   premium: bool | null   whether the account can post long posts (null = unknown)
   *   similarityThreshold: number (0.5)
   * }
   * → { ok (no error/warn), count, hook, bait, links, similar: { swipe, recent }, findings: [{ id, severity, tr, en, … }] }
   */
  function checkDraft(text, opts) {
    opts = opts || {};
    var s = String(text || '');
    var findings = [];
    var count = weightedLength(s);
    var h = hook(s);
    var premium = opts.premium == null ? null : !!opts.premium;

    // Length
    if (count.weighted > CONFIG.maxWeightedTweetLength) {
      if (premium === false) {
        findings.push(finding('length-over', 'error', count.weighted + ' / 280 karakter: ' + (count.weighted - 280) + ' fazla.',
          count.weighted + ' / 280 characters: ' + (count.weighted - 280) + ' over.', { weighted: count.weighted }));
      } else if (count.weighted > PREMIUM_LIMIT) {
        findings.push(finding('length-over', 'error', 'Premium sınırı da aşıldı (' + count.weighted + ' / 25.000).',
          'Over the Premium limit as well (' + count.weighted + ' / 25,000).', { weighted: count.weighted }));
      } else {
        findings.push(finding('long-post', premium ? 'info' : 'warn',
          (premium ? '' : 'Premium gerekir. ') + 'Uzun post: zaman akışında ilk ~280 karakter görünür, gerisi "Daha fazla göster" arkasında (' + h.hidden + ' karakter).',
          (premium ? '' : 'Needs Premium. ') + 'Long post: the timeline shows the first ~280 characters, the rest is behind "Show more" (' + h.hidden + ' characters).',
          { weighted: count.weighted, hidden: h.hidden }));
      }
    }
    if (!s.trim()) findings.push(finding('empty', 'info', 'Taslak boş.', 'The draft is empty.'));

    // Hook
    if (h.firstLine && h.firstLineWeighted > HOOK_LONG) {
      findings.push(finding('hook-long', 'info', 'İlk satır ' + h.firstLineWeighted + ' karakter. Kısa bir ilk satır (≤ ' + HOOK_LONG + ') akışta daha çok okunur.',
        'The first line is ' + h.firstLineWeighted + ' characters. A short first line (≤ ' + HOOK_LONG + ') reads better in the feed.', { weighted: h.firstLineWeighted }));
    }

    // Engagement bait
    var bait = findBait(s);
    bait.forEach(function (b) {
      findings.push(finding('bait', b.level === 'warn' ? 'warn' : 'info',
        '"' + b.text + '": etkileşim dilenme sayılabilir. Original Content Rewards bunu ödemeye saymıyor.',
        '"' + b.text + '": this may count as engagement bait, which Original Content Rewards does not pay for.',
        { span: { start: b.start, end: b.end }, pattern: b.id }));
    });

    // Similarity
    var threshold = opts.similarityThreshold;
    var sw = similarity(s, opts.swipe, { source: 'swipe', threshold: threshold });
    var rc = similarity(s, opts.recent, { source: 'recent', threshold: threshold });
    sw.flagged.concat(rc.flagged).forEach(function (m) {
      var pct = Math.round(Math.max(m.jaccard, m.level === 'warn' ? m.containment : 0) * 100);
      var whereTr = m.source === 'swipe' ? 'swipe dosyasındaki bir posta' : 'yakında görülen bir posta';
      var whereEn = m.source === 'swipe' ? 'a post in your swipe file' : 'a post you saw recently';
      findings.push(finding('similar', m.level,
        'Taslak ' + whereTr + ' %' + pct + ' benziyor' + (m.level === 'warn' ? ': kopya veya az değiştirilmiş içerik sayılabilir.' : '.'),
        'The draft is ' + pct + '% similar to ' + whereEn + (m.level === 'warn' ? ': it may count as copied or lightly edited content.' : '.'),
        { match: m }));
    });

    // Links in the main post
    var ls = links(s);
    var ext = ls.filter(function (l) { return l.external; });
    if (ext.length) {
      findings.push(finding('link', 'info', 'Ana postta link var. Linki ilk yanıta koymayı düşünebilirsin (kesin kural değil, öneri).',
        'The main post has a link. You could put it in the first reply instead (a suggestion, not a rule).',
        { spans: ext.map(function (l) { return { start: l.start, end: l.end }; }) }));
    }

    // AI disclosure
    var media = Array.isArray(opts.media) ? opts.media : [];
    var aiMedia = media.filter(function (m) { return m && m.ai; });
    if (aiMedia.length && !opts.aiDisclosed) {
      findings.push(finding('ai-disclosure', 'warn', 'AI ile üretilmiş görsel/video var: X\'in "AI ile yapıldı" etiketini eklemeyi unutma.',
        'AI-made image/video attached: remember to add X\'s "Made with AI" label.', { media: aiMedia.length }));
    }

    findings.sort(function (a, b) { return SEV[a.severity] - SEV[b.severity]; });
    return {
      ok: !findings.some(function (f) { return f.severity !== 'info'; }),
      count: count,
      hook: h,
      bait: bait,
      links: ls,
      similar: { swipe: sw.top, recent: rc.top },
      findings: findings
    };
  }

  return {
    CONFIG: CONFIG, PREMIUM_LIMIT: PREMIUM_LIMIT, HOOK_LONG: HOOK_LONG, SIM_WARN: SIM_WARN, SIM_INFO: SIM_INFO,
    BAIT_PATTERNS: BAIT.map(function (p) { return { id: p.id, lang: p.lang, level: p.level, source: p.re.source }; }),
    weightedLength: weightedLength, links: links, emojis: emojis, hook: hook, prefixUpTo: prefixUpTo,
    findBait: findBait, normForSim: normForSim, trigrams: trigrams, similarity: similarity, checkDraft: checkDraft
  };
});
