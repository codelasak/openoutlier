// ReelScope – turn Reddit data into normalized post records.
// Two sources: listing JSON (/r/<sub>/top.json …, from the logged-in tab) and
// the <shreddit-post> elements on www.reddit.com pages. Pure functions, no
// DOM or chrome.* access, so they run in Node tests too.
//
// Reddit accounts live next to Instagram ones in the library with ids that
// can't collide with an Instagram username (those never contain "/"):
//   r/<subreddit>  and  u/<username>   (lowercase)
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReelScopeReddit = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ID_RE = /^[a-z0-9]{2,12}$/;
  var NAME_RE = /^[A-Za-z0-9_-]{2,30}$/;
  var CAPTION_MAX = 600;
  var SELFTEXT_MAX = 1500;
  var SORTS = /^(hot|new|top|rising|controversial|best)$/;
  var TIMES = /^(hour|day|week|month|year|all)$/;
  var MULTI = /^(all|popular|friends|mod)$/i; // feeds, not real subreddits

  function num(v) {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
    return null;
  }

  /** "15" → 15, "1.2k" → 1200, "3.4M" → 3400000, "•" → null */
  function parseCount(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var m = String(v).trim().replace(/,/g, '').match(/^(-?\d+(?:\.\d+)?)\s*([kmb])?$/i);
    if (!m) return null;
    var mult = { k: 1e3, m: 1e6, b: 1e9 }[String(m[2] || '').toLowerCase()] || 1;
    return Math.round(Number(m[1]) * mult);
  }

  function decodeEntities(s) {
    return String(s).replace(/&(amp|lt|gt|quot|#39|#x27|#x2F|nbsp);/g, function (all, e) {
      return { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'", '#x2F': '/', nbsp: ' ' }[e];
    });
  }

  /** ISO strings Reddit uses ("2025-03-01T14:05:09.123000+0000"), epoch seconds or ms → ms. */
  function parseTime(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = num(v);
    if (n !== null) return n < 1e11 ? Math.round(n * 1000) : Math.round(n);
    var s = String(v).trim()
      .replace(/(\.\d{3})\d+/, '$1')          // microseconds → ms
      .replace(/([+-]\d{2})(\d{2})$/, '$1:$2') // +0000 → +00:00
      .replace(/ /, 'T');
    var t = Date.parse(s);
    return isFinite(t) ? t : null;
  }

  /** Only https: links leave ReelScope (no javascript:, data:, http: …). */
  function httpsOnly(u) {
    u = typeof u === 'string' ? u.trim() : '';
    return /^https:\/\/[^\s/]+/i.test(u) ? u : null;
  }
  /** An https link on reddit.com (permalinks). */
  function isRedditUrl(u) {
    return /^https:\/\/(?:[a-z0-9-]+\.)?reddit\.com(?:[/?#]|$)/i.test(String(u || '').trim());
  }

  function clip(s, max) {
    s = String(s || '');
    return s.length > max ? s.slice(0, max) + '…' : s;
  }

  function subId(name) { return 'r/' + String(name).replace(/^\/?r\//i, '').toLowerCase(); }
  function userId(name) { return 'u/' + String(name).replace(/^\/?(u|user)\//i, '').toLowerCase(); }
  function isRedditId(id) { return /^(r|u)\/[a-z0-9_-]{2,30}$/.test(String(id || '')); }

  /** "r/excel" → "r/excel", "u/x" → "u/x", "@name" → "@name" (Instagram). */
  function label(id) { return isRedditId(id) ? id : '@' + id; }

  var IMG_EXT = /\.(jpe?g|png|gif|webp)(\?|$)/i;

  function typeOfThing(d) {
    if (d.crosspost_parent) return 'crosspost';
    if (d.is_gallery || d.gallery_data) return 'gallery';
    if (d.poll_data) return 'poll';
    if (d.is_video || d.post_hint === 'hosted:video' || d.post_hint === 'rich:video') return 'video';
    if (d.post_hint === 'image' || d.domain === 'i.redd.it' || IMG_EXT.test(String(d.url || ''))) return 'image';
    if (d.is_self) return 'text';
    return 'link';
  }

  function thumbOf(d) {
    var src = d.preview && d.preview.images && d.preview.images[0];
    var url = src && ((src.resolutions && src.resolutions[Math.min(2, src.resolutions.length - 1)]) || src.source);
    url = url && url.url;
    if (!url && typeof d.thumbnail === 'string' && /^https:\/\//.test(d.thumbnail)) url = d.thumbnail;
    return url ? decodeEntities(url) : null;
  }

  function base(fields) {
    var title = fields.title;
    var selftext = clip(fields.selftext, SELFTEXT_MAX);
    return Object.assign({
      platform: 'reddit',
      caption: clip(title + (selftext ? '\n\n' + selftext : ''), CAPTION_MAX),
      selftext: selftext,
      hashtags: [],
      files: [],
      seenAt: Date.now()
    }, fields, { selftext: selftext });
  }

  /** One post ("t3" thing data) from listing JSON, or null. */
  function parseThing(d) {
    if (!d || typeof d !== 'object' || typeof d.id !== 'string' || !ID_RE.test(d.id) || typeof d.title !== 'string') return null;
    if (d.name && !/^t3_/.test(d.name)) return null;
    var sub = String(d.subreddit || '');
    var permalink = typeof d.permalink === 'string' && d.permalink[0] === '/' ? d.permalink : (sub ? '/r/' + sub + '/comments/' + d.id + '/' : '/comments/' + d.id + '/');
    var type = typeOfThing(d);
    return base({
      code: d.id,
      url: 'https://www.reddit.com' + permalink,
      owner: sub ? subId(sub) : null,
      ownerName: d.subreddit_name_prefixed || (sub ? 'r/' + sub : null),
      subreddit: sub.toLowerCase() || null,
      author: typeof d.author === 'string' && d.author !== '[deleted]' ? d.author : null,
      title: decodeEntities(d.title),
      selftext: d.is_self && typeof d.selftext === 'string' && d.selftext !== '[removed]' && d.selftext !== '[deleted]' ? decodeEntities(d.selftext) : '',
      type: type,
      flair: typeof d.link_flair_text === 'string' && d.link_flair_text.trim() ? decodeEntities(d.link_flair_text.trim()) : null,
      domain: d.domain || null,
      linkUrl: !d.is_self && typeof d.url === 'string' ? httpsOnly(decodeEntities(d.url)) : null,
      takenAt: parseTime(d.created_utc),
      score: num(d.score),
      comments: num(d.num_comments),
      upvoteRatio: num(d.upvote_ratio),
      crossposts: num(d.num_crossposts),
      nsfw: d.over_18 === true,
      pinned: d.stickied === true || d.pinned === true,
      thumb: thumbOf(d),
      detailed: true
    });
  }

  /** Listing JSON (object, array of listings, or text) → { posts, after }. */
  function parseListing(value) {
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch (e) { return { posts: [], after: null }; }
    }
    var out = { posts: [], after: null };
    (Array.isArray(value) ? value : [value]).forEach(function (l) {
      if (!l || l.kind !== 'Listing' || !l.data || !Array.isArray(l.data.children)) return;
      if (!out.after && typeof l.data.after === 'string') out.after = l.data.after;
      l.data.children.forEach(function (c) {
        if (!c || c.kind !== 't3') return;
        var p = parseThing(c.data);
        if (p) out.posts.push(p);
      });
    });
    return out;
  }

  var POST_TYPES = {
    text: 'text', self: 'text', image: 'image', gif: 'video', video: 'video', link: 'link',
    gallery: 'gallery', multi_media: 'gallery', poll: 'poll', crosspost: 'crosspost'
  };

  /**
   * One post from the attributes of a <shreddit-post> element (a plain
   * {name: value} object). Attribute names have changed before, so several
   * spellings are tried. → post or null.
   */
  function fromShredditAttrs(a) {
    if (!a || typeof a !== 'object') return null;
    function get() {
      for (var i = 0; i < arguments.length; i++) {
        var v = a[arguments[i]];
        if (v !== undefined && v !== null && v !== '') return String(v);
      }
      return null;
    }
    var rawId = get('id', 'post-id', 'thingid', 'data-fullname');
    var id = rawId ? rawId.replace(/^t3_/, '') : null;
    var title = get('post-title', 'title', 'aria-label');
    if (!id || !ID_RE.test(id) || !title) return null;
    var subPref = get('subreddit-prefixed-name', 'subreddit-name-prefixed');
    var sub = (subPref || get('subreddit-name', 'subreddit') || '').replace(/^r\//i, '');
    if (/^u_/.test(sub)) sub = ''; // a post on a user's profile, not in a subreddit
    var permalink = get('permalink');
    var author = get('author', 'author-name');
    var typeAttr = String(get('post-type', 'type') || '').toLowerCase();
    var type = POST_TYPES[typeAttr] || (typeAttr ? 'link' : 'text');
    var href = get('content-href', 'url');
    var ratio = num(get('upvote-ratio'));
    return base({
      code: id,
      url: permalink && permalink[0] === '/' ? 'https://www.reddit.com' + permalink : isRedditUrl(permalink) ? permalink.trim() : 'https://www.reddit.com/comments/' + id + '/',
      owner: sub ? subId(sub) : null,
      ownerName: sub ? 'r/' + sub : null,
      subreddit: sub ? sub.toLowerCase() : null,
      author: author && author !== '[deleted]' ? author : null,
      title: title,
      selftext: '',
      type: type,
      flair: get('flair', 'link-flair-text'),
      domain: get('domain'),
      linkUrl: type !== 'text' && href ? httpsOnly(href) : null,
      takenAt: parseTime(get('created-timestamp', 'created-utc', 'created')),
      score: parseCount(get('score', 'vote-count')),
      comments: parseCount(get('comment-count', 'comments-count')),
      upvoteRatio: ratio !== null && ratio > 1 ? ratio / 100 : ratio,
      nsfw: a.nsfw !== undefined || a['is-nsfw'] !== undefined,
      pinned: a.stickied !== undefined || a.pinned !== undefined,
      thumb: null,
      detailed: false
    });
  }

  var TAG_RE = /<shreddit-post((?:\s+[\w:.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/gi;
  var ATTR_RE = /([\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

  /** Attribute map of every <shreddit-post> opening tag in an HTML string (for tests / saved pages). */
  function shredditAttrsFromHtml(html) {
    var out = [];
    var m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(String(html || '')))) {
      var attrs = {};
      var a;
      ATTR_RE.lastIndex = 0;
      while ((a = ATTR_RE.exec(m[1]))) {
        var v = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : '';
        attrs[a[1].toLowerCase()] = decodeEntities(v);
      }
      out.push(attrs);
    }
    return out;
  }

  function parseShredditHtml(html) {
    return shredditAttrsFromHtml(html).map(fromShredditAttrs).filter(Boolean);
  }

  /**
   * Where are we on reddit.com? → { kind: 'subreddit'|'user'|'post'|'feed', id, name, sort, t }
   */
  function pageContext(pathname, search) {
    var seg = String(pathname || '/').split('/').filter(Boolean);
    var params = {};
    String(search || '').replace(/^\?/, '').split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('=');
      try {
        params[decodeURIComponent(i < 0 ? kv : kv.slice(0, i))] = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1));
      } catch (e) { /* a bare "%" in the query string: ignore that parameter */ }
    });
    var t = TIMES.test(params.t || '') ? params.t : null;
    if (seg[0] === 'r' && seg[1] && NAME_RE.test(seg[1]) && !MULTI.test(seg[1])) {
      if (seg[2] === 'comments' && seg[3]) return { kind: 'post', id: subId(seg[1]), name: seg[1], postId: seg[3].toLowerCase() };
      return { kind: 'subreddit', id: subId(seg[1]), name: seg[1], sort: SORTS.test(seg[2] || '') ? seg[2] : 'hot', t: t };
    }
    if ((seg[0] === 'user' || seg[0] === 'u') && seg[1] && NAME_RE.test(seg[1])) {
      return { kind: 'user', id: userId(seg[1]), name: seg[1], sort: SORTS.test(params.sort || '') ? params.sort : 'new', t: t, tab: seg[2] || 'overview' };
    }
    return { kind: 'feed', id: null };
  }

  /** Same-origin listing JSON path for a subreddit or user. */
  function listingPath(ctx, opts) {
    opts = opts || {};
    var sort = SORTS.test(opts.sort || '') ? opts.sort : 'top';
    var t = TIMES.test(opts.t || '') ? opts.t : 'year';
    var limit = Math.max(1, Math.min(100, opts.limit || 100));
    var name = encodeURIComponent(String(ctx.name || ctx.id || '').replace(/^(r|u|user)\//i, ''));
    var q = 'limit=' + limit + '&raw_json=1' + (opts.after ? '&after=' + encodeURIComponent(opts.after) : '');
    if (ctx.kind === 'user') return '/user/' + name + '/submitted.json?sort=' + sort + '&t=' + t + '&' + q;
    return '/r/' + name + '/' + sort + '.json?' + q + (sort === 'top' || sort === 'controversial' ? '&t=' + t : '');
  }

  /** The page to open for an account: subreddit top of the year / user's posts. */
  function pageUrl(id, opts) {
    opts = opts || {};
    var name = encodeURIComponent(String(id).slice(2));
    if (String(id).indexOf('u/') === 0) return 'https://www.reddit.com/user/' + name + '/submitted/';
    var sort = SORTS.test(opts.sort || '') ? opts.sort : 'top';
    return 'https://www.reddit.com/r/' + name + '/' + sort + '/' + (sort === 'top' ? '?t=' + (TIMES.test(opts.t || '') ? opts.t : 'year') : '');
  }

  /** Merge a fresh record into a stored one. Newer non-empty values win (scores move both ways). */
  function merge(prev, next) {
    if (!prev) return next;
    var out = {};
    var k;
    for (k in prev) out[k] = prev[k];
    for (k in next) {
      var b = next[k];
      if (b === null || b === undefined || b === '' || (Array.isArray(b) && b.length === 0)) continue;
      // DOM records are thinner than JSON ones: don't let them blank out JSON-only fields.
      if (k === 'detailed') { out[k] = Boolean(prev[k]) || Boolean(b); continue; }
      if (!next.detailed && prev.detailed && (k === 'type' || k === 'url' || k === 'caption')) continue;
      if (k === 'seenAt' && typeof prev[k] === 'number') { out[k] = Math.max(prev[k], b); continue; }
      out[k] = b;
    }
    return out;
  }

  /** Merge two stored {id: post} maps post by post (another tab saved the same account). */
  function mergePostMaps(base, extra) {
    var out = {};
    var k;
    for (k in base || {}) out[k] = base[k];
    for (k in extra || {}) out[k] = merge(out[k], extra[k]);
    return out;
  }

  return {
    mergePostMaps: mergePostMaps,
    httpsOnly: httpsOnly,
    isRedditUrl: isRedditUrl,
    parseCount: parseCount,
    parseTime: parseTime,
    parseThing: parseThing,
    parseListing: parseListing,
    fromShredditAttrs: fromShredditAttrs,
    shredditAttrsFromHtml: shredditAttrsFromHtml,
    parseShredditHtml: parseShredditHtml,
    pageContext: pageContext,
    listingPath: listingPath,
    pageUrl: pageUrl,
    merge: merge,
    subId: subId,
    userId: userId,
    isRedditId: isRedditId,
    label: label
  };
});
