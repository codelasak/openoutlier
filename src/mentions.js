// OpenOutlier – Reddit keyword "Mentions": matching, request planning, parsing,
// dedupe and merge. Pure functions (no DOM / chrome.*), so they run in Node tests.
//
// The matching rules and the mention record are a contract shared with the
// reddit-watch home-server service (~/web_code/reddit-watch/src/match.js):
//
//   query     `"excel formula" vlookup`  → every quoted phrase AND every bare word must appear.
//             Case-insensitive, accent/width-insensitive (NFKC), Turkish dotted/dotless i
//             fold to "i", whole words only: "excel formula" matches "Excel   formula," but
//             not "excelformula" or "excel formulas". A bare word ending in * is a prefix.
//   exclude   words/phrases; if any appears, the item is rejected.
//   subreddits optional list (with or without "r/", any case); empty = everywhere.
//   kinds     ["posts", "comments"] (default both). Comments need a subreddit list
//             (Reddit has no comment search), so comment watches without one only check posts.
//   Text matched: post = title + body, comment = body.
//
//   mention = { id, kind: "post"|"comment", watchId, query, title, excerpt, subreddit,
//               author, permalink, createdAt, score, foundAt, source: "extension"|"hayati" }
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReelScopeMentions = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KINDS = ['posts', 'comments'];
  var MENTION_FIELDS = ['id', 'kind', 'watchId', 'query', 'title', 'excerpt', 'subreddit', 'author', 'permalink', 'createdAt', 'score', 'foundAt', 'source'];
  var ALERT_SLACK_MS = 60 * 60000;   // items up to 1 h older than a new watch still notify
  var MAX_ALERT_AGE_MS = 48 * 3600000;
  var MAX_STORED = 3000;

  // ---- matching (keep identical to reddit-watch/src/match.js) ------------------

  function fold(s) {
    return String(s == null ? '' : s)
      .normalize('NFKC')
      .replace(/[​-‏⁠﻿]/g, '')
      .replace(/[İIı]/g, 'i')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/\p{M}/gu, '');
  }

  function tokenize(s) {
    return fold(s).match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || [];
  }

  /** `"a b" c*` → [["a","b"], ["c*"]]. Unbalanced quotes close at the end. */
  function parseQuery(query) {
    var parts = [];
    var re = /"([^"]*)"?|(\S+)/g;
    var m;
    var q = String(query == null ? '' : query);
    while ((m = re.exec(q))) {
      if (m[1] !== undefined) {
        var t = tokenize(m[1]);
        if (t.length) parts.push(t);
      } else {
        var raw = m[2];
        var toks = tokenize(raw);
        if (!toks.length) continue;
        if (/\*$/.test(raw)) toks[toks.length - 1] += '*';
        parts.push(toks);
      }
    }
    return parts;
  }

  function tokenEq(pattern, tok) {
    return /\*$/.test(pattern) ? tok.indexOf(pattern.slice(0, -1)) === 0 : tok === pattern;
  }

  function containsPhrase(tokens, phrase) {
    if (!phrase.length) return false;
    outer: for (var i = 0; i + phrase.length <= tokens.length; i++) {
      for (var j = 0; j < phrase.length; j++) if (!tokenEq(phrase[j], tokens[i + j])) continue outer;
      return true;
    }
    return false;
  }

  function normalizeSubreddit(s) {
    return String(s == null ? '' : s).trim().replace(/^\/?r\//i, '').replace(/\/+$/, '').toLowerCase();
  }

  function itemText(item) {
    return item.kind === 'post' ? (item.title || '') + '\n' + (item.body || '') : String(item.body || '');
  }

  /** Does item ({kind:'post'|'comment', title, body, subreddit}) match watch? Disabled watches never match. */
  function matches(item, watch) {
    if (!watch || watch.enabled === false) return false;
    var kinds = watch.kinds && watch.kinds.length ? watch.kinds : KINDS;
    if (kinds.indexOf(item.kind === 'post' ? 'posts' : 'comments') === -1) return false;
    var subs = (watch.subreddits || []).map(normalizeSubreddit).filter(Boolean);
    if (subs.length && subs.indexOf(normalizeSubreddit(item.subreddit)) === -1) return false;
    var phrases = parseQuery(watch.query);
    if (!phrases.length) return false;
    var tokens = tokenize(itemText(item));
    if (!phrases.every(function (p) { return containsPhrase(tokens, p); })) return false;
    var ex = watch.exclude || [];
    for (var i = 0; i < ex.length; i++) {
      var exParts = parseQuery(ex[i].indexOf('"') !== -1 ? ex[i] : '"' + ex[i] + '"');
      if (exParts.some(function (p) { return containsPhrase(tokens, p); })) return false;
    }
    return true;
  }

  /** Watch query → Reddit search `q` (local matching re-checks everything). */
  function toRedditSearchQuery(query) {
    return parseQuery(query).map(function (p) {
      var words = p.map(function (t) { return t.replace(/\*$/, ''); });
      return words.length > 1 ? '"' + words.join(' ') + '"' : words[0];
    }).join(' ');
  }

  // ---- watches ----------------------------------------------------------------

  function strList(v) {
    if (typeof v === 'string') v = v.split(/[,\n]/);
    if (!Array.isArray(v)) return [];
    return v.map(function (s) { return String(s).trim(); }).filter(Boolean);
  }

  function newId() { return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /** Clean a watch from the UI / storage. Returns { watch } or { error }. */
  function normalizeWatch(w) {
    if (!w || typeof w !== 'object') return { error: 'not a watch' };
    var query = String(w.query || '').trim();
    if (!parseQuery(query).length) return { error: 'The query needs at least one word.' };
    var subs = strList(w.subreddits).map(normalizeSubreddit).filter(function (s, i, a) { return a.indexOf(s) === i; });
    var bad = subs.filter(function (s) { return !/^[a-z0-9_]{2,32}$/.test(s); });
    if (bad.length) return { error: 'Not a subreddit name: ' + bad.join(', ') };
    var kinds = strList(w.kinds).filter(function (k) { return KINDS.indexOf(k) !== -1; });
    var out = {};
    for (var k in w) if (Object.prototype.hasOwnProperty.call(w, k)) out[k] = w[k]; // keep unknown fields
    out.id = w.id != null && String(w.id).trim() ? String(w.id) : newId();
    out.query = query;
    out.subreddits = subs;
    out.exclude = strList(w.exclude);
    out.kinds = kinds.length ? KINDS.filter(function (x) { return kinds.indexOf(x) !== -1; }) : KINDS.slice();
    out.enabled = w.enabled !== false;
    return { watch: out };
  }

  // ---- requests -------------------------------------------------------------------

  /**
   * Which requests cover the enabled watches.
   * posts: one search per distinct (query, subreddits), sorted by new;
   * comments: one /r/<sub>/comments.json per subreddit, shared by every comment watch.
   * Each job has the Atom feed `rssPath` (same URLs reddit-watch uses), which is
   * what the extension requests, and the equivalent listing JSON `path` (Reddit
   * currently answers it with 403, even for logged-in tabs).
   * → { jobs: [{ key, path, rssPath, watchIds }], warnings: [] }
   */
  function planJobs(watches) {
    var jobs = {};
    var order = [];
    var warnings = [];
    function add(key, path, rssPath, id) {
      if (!jobs[key]) { jobs[key] = { key: key, path: path, rssPath: rssPath, watchIds: [] }; order.push(key); }
      if (jobs[key].watchIds.indexOf(id) === -1) jobs[key].watchIds.push(id);
    }
    (watches || []).forEach(function (w) {
      if (!w || w.enabled === false || !parseQuery(w.query).length) return;
      var kinds = w.kinds && w.kinds.length ? w.kinds : KINDS;
      var subs = (w.subreddits || []).map(normalizeSubreddit).filter(Boolean).sort();
      if (kinds.indexOf('posts') !== -1) {
        var q = encodeURIComponent(toRedditSearchQuery(w.query));
        var path = subs.length
          ? '/r/' + subs.join('+') + '/search.json?q=' + q + '&restrict_sr=1&sort=new&type=link&limit=50&raw_json=1'
          : '/search.json?q=' + q + '&sort=new&type=link&limit=50&raw_json=1';
        var rss = subs.length
          ? '/r/' + subs.join('+') + '/search.rss?q=' + q + '&restrict_sr=1&sort=new&limit=100'
          : '/search.rss?q=' + q + '&sort=new&limit=100';
        add('posts:' + path, path, rss, w.id);
      }
      if (kinds.indexOf('comments') !== -1) {
        if (!subs.length) warnings.push('"' + w.query + '": comments need a subreddit list (Reddit has no comment search), so only posts are checked.');
        subs.forEach(function (s) { add('comments:' + s, '/r/' + s + '/comments.json?limit=100&raw_json=1', '/r/' + s + '/comments/.rss?limit=100', w.id); });
      }
    });
    return { jobs: order.map(function (k) { return jobs[k]; }), warnings: warnings };
  }

  /** Posts (t3) and comments (t1) from listing JSON → [{ id, kind, title, body, subreddit, author, permalink, createdAt, score }] */
  function itemsFromListing(value) {
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch (e) { return []; } }
    var out = [];
    (Array.isArray(value) ? value : [value]).forEach(function (l) {
      if (!l || l.kind !== 'Listing' || !l.data || !Array.isArray(l.data.children)) return;
      l.data.children.forEach(function (c) {
        var d = c && c.data;
        if (!d || typeof d.id !== 'string' || !/^[a-z0-9]{2,12}$/.test(d.id)) return;
        if (c.kind !== 't3' && c.kind !== 't1') return;
        var post = c.kind === 't3';
        out.push({
          id: (post ? 't3_' : 't1_') + d.id,
          kind: post ? 'post' : 'comment',
          title: String((post ? d.title : d.link_title) || ''),
          body: String((post ? d.selftext : d.body) || '').replace(/^\[(removed|deleted)\]$/, ''),
          subreddit: String(d.subreddit || '').toLowerCase(),
          author: typeof d.author === 'string' ? d.author : '',
          permalink: typeof d.permalink === 'string' ? (/^https?:/.test(d.permalink) ? d.permalink : 'https://www.reddit.com' + d.permalink) : '',
          createdAt: typeof d.created_utc === 'number' ? Math.round(d.created_utc * 1000) : null,
          score: typeof d.score === 'number' ? d.score : null
        });
      });
    });
    return out;
  }

  // ---- Atom feeds (port of reddit-watch/src/atom.js) ------------------------------

  var NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#32': ' ' };

  function decodeXml(s) {
    return String(s == null ? '' : s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, e) {
      if (e[0] === '#') {
        var code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
      }
      var v = NAMED[e.toLowerCase()];
      return v === undefined ? m : v;
    });
  }

  /** Reddit HTML body → plain text (drops the "submitted by … [link] [comments]" trailer). */
  function htmlToText(html) {
    var s = String(html == null ? '' : html);
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    s = s.replace(/&#32;\s*submitted by[\s\S]*$/i, '').replace(/\s*submitted by\s*<a[\s\S]*$/i, '');
    s = s.replace(/<(br|\/p|\/li|\/h\d|\/blockquote|\/pre)\s*\/?>/gi, '\n');
    s = s.replace(/<[^>]+>/g, '');
    s = decodeXml(s);
    return s.replace(/[ \t\r\f\v]+/g, ' ').replace(/\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim();
  }

  function xmlTag(xml, name) {
    var m = xml.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>'));
    return m ? m[1] : undefined;
  }

  function xmlAttr(xml, name, attrName) {
    var m = xml.match(new RegExp('<' + name + '\\s[^>]*\\b' + attrName + '="([^"]*)"'));
    return m ? decodeXml(m[1]) : undefined;
  }

  /** Atom feed (search.rss, /r/x/comments/.rss) → same items as itemsFromListing (no score in feeds). */
  function itemsFromAtom(xml) {
    var out = [];
    var re = /<entry>([\s\S]*?)<\/entry>/g;
    var m;
    var text = String(xml == null ? '' : xml);
    while ((m = re.exec(text))) {
      var e = m[1];
      var id = decodeXml(xmlTag(e, 'id') || '').trim();
      if (!/^t[13]_[a-z0-9]+$/i.test(id)) continue;
      var kind = id.indexOf('t3_') === 0 ? 'post' : 'comment';
      var rawTitle = decodeXml(xmlTag(e, 'title') || '').trim();
      var author = decodeXml(xmlTag(xmlTag(e, 'author') || '', 'name') || '').trim().replace(/^\/?u\//, '');
      var date = xmlTag(e, 'published') || xmlTag(e, 'updated');
      var createdAt = date ? Date.parse(date.trim()) : NaN;
      out.push({
        id: id,
        kind: kind,
        title: kind === 'comment' ? rawTitle.replace(/^\/u\/\S+\s+on\s+/, '') : rawTitle,
        body: htmlToText(decodeXml(xmlTag(e, 'content') || '')),
        subreddit: String(xmlAttr(e, 'category', 'term') || '').toLowerCase(),
        author: author,
        permalink: xmlAttr(e, 'link', 'href') || '',
        createdAt: isFinite(createdAt) ? createdAt : null,
        score: null
      });
    }
    return out;
  }

  /** Short excerpt around the first occurrence of needle (same as reddit-watch). */
  function excerpt(text, needle, max) {
    max = max || 280;
    var t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    var start = 0;
    if (needle) {
      var i = t.toLowerCase().indexOf(String(needle).toLowerCase());
      if (i > max / 3) start = Math.max(0, i - Math.floor(max / 3));
    }
    return (start > 0 ? '…' : '') + t.slice(start, start + max) + (start + max < t.length ? '…' : '');
  }

  // ---- mentions -------------------------------------------------------------------

  /** Keep exactly the shared record fields. */
  /** Epoch ms from a number (ms), a numeric string (s or ms) or an ISO date; else null. */
  function toMs(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v !== 'string' || !v.trim()) return null;
    var t = v.trim();
    if (/^\d+(\.\d+)?$/.test(t)) { var n = Number(t); return n < 1e11 ? Math.round(n * 1000) : n; }
    var d = Date.parse(t);
    return isFinite(d) ? d : null;
  }
  function toNum(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
    return null;
  }
  function toStr(v) { return v === undefined || v === null ? null : String(v); }

  /** Only https links on reddit.com are kept as permalinks (the server's values are untrusted). */
  function safePermalink(u) {
    u = typeof u === 'string' ? u.trim() : '';
    return /^https:\/\/(?:[a-z0-9-]+\.)?reddit\.com(?:[/?#]|$)/i.test(u) ? u : null;
  }

  /** Keep exactly the shared record fields, with the right types. */
  function shape(m, source) {
    var out = {};
    MENTION_FIELDS.forEach(function (f) { out[f] = m[f] === undefined ? null : m[f]; });
    ['id', 'watchId', 'query', 'title', 'excerpt', 'subreddit', 'author'].forEach(function (f) { out[f] = toStr(out[f]); });
    out.kind = out.kind === 'post' || out.kind === 'comment' ? out.kind : (/^t3_/.test(out.id || '') ? 'post' : 'comment');
    out.createdAt = toMs(out.createdAt);
    out.foundAt = toMs(out.foundAt);
    out.score = toNum(out.score);
    out.permalink = safePermalink(out.permalink);
    out.source = source || (m.source === 'hayati' ? 'hayati' : 'extension');
    return out;
  }

  /**
   * Match fetched items against watches; dedupe by Reddit fullname against
   * `known` ({id: anything}) and within the batch. First matching watch wins.
   * firstSeen: {watchId: ms the watch was first checked} → decides `notify`.
   * → [mention + { notify }]
   */
  function processItems(known, watches, items, opts) {
    opts = opts || {};
    var now = opts.now || Date.now();
    var firstSeen = opts.firstSeen || {};
    var added = [];
    var seen = {};
    items.slice().sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); }).forEach(function (item) {
      if (seen[item.id] || (known && known[item.id])) return;
      seen[item.id] = true;
      var watch = null;
      for (var i = 0; i < watches.length; i++) if (matches(item, watches[i])) { watch = watches[i]; break; }
      if (!watch) return;
      var first = parseQuery(watch.query)[0];
      var m = shape({
        id: item.id, kind: item.kind, watchId: watch.id, query: watch.query,
        title: item.title || '', excerpt: excerpt(item.body, first ? first.join(' ').replace(/\*$/, '') : ''),
        subreddit: item.subreddit, author: item.author, permalink: item.permalink,
        createdAt: item.createdAt, score: item.score == null ? null : item.score, foundAt: now
      }, 'extension');
      var fs = firstSeen[watch.id] || 0;
      m.notify = item.createdAt != null && item.createdAt >= fs - ALERT_SLACK_MS && now - item.createdAt <= MAX_ALERT_AGE_MS;
      added.push(m);
    });
    return added;
  }

  /**
   * Merge incoming mentions (from this extension or the home server) into the
   * stored map {id: mention}. Dedupe by id; an id already stored keeps its
   * record, but the earliest foundAt wins. → { items, added: [new mentions] }
   */
  function mergeMentions(items, incoming, source) {
    var out = {};
    for (var k in items || {}) out[k] = items[k];
    var added = [];
    (incoming || []).forEach(function (raw) {
      if (!raw || typeof raw.id !== 'string' || !/^t[13]_[a-z0-9]+$/i.test(raw.id)) return;
      var m = shape(raw, source);
      if (!m.kind) m.kind = m.id.indexOf('t3_') === 0 ? 'post' : 'comment';
      if (typeof m.foundAt !== 'number') m.foundAt = Date.now();
      var prev = out[m.id];
      if (prev) {
        if (typeof prev.foundAt !== 'number' || m.foundAt < prev.foundAt) out[m.id] = Object.assign({}, prev, { foundAt: m.foundAt });
        return;
      }
      out[m.id] = m;
      added.push(m);
    });
    return { items: out, added: added };
  }

  /** Keep the newest `max` mentions (by foundAt, then createdAt); drop read flags of removed ones. */
  function prune(store, max) {
    max = max || MAX_STORED;
    var ids = Object.keys(store.items || {});
    if (ids.length <= max) return store;
    ids.sort(function (a, b) {
      var x = store.items[a];
      var y = store.items[b];
      return (y.foundAt || 0) - (x.foundAt || 0) || (y.createdAt || 0) - (x.createdAt || 0);
    });
    var items = {};
    var read = {};
    ids.slice(0, max).forEach(function (id) { items[id] = store.items[id]; if (store.read && store.read[id]) read[id] = store.read[id]; });
    return { items: items, read: read };
  }

  /** Sorted, filtered list for the inbox / MCP. opts: { watchId, unreadOnly, since, kind, subreddit } */
  function list(store, opts) {
    opts = opts || {};
    var read = store.read || {};
    return Object.keys(store.items || {}).map(function (id) { return store.items[id]; })
      .filter(function (m) {
        if (opts.watchId && m.watchId !== opts.watchId) return false;
        if (opts.unreadOnly && read[m.id]) return false;
        if (opts.since && (m.createdAt || m.foundAt || 0) < opts.since) return false;
        if (opts.kind && m.kind !== opts.kind) return false;
        if (opts.subreddit && normalizeSubreddit(m.subreddit) !== normalizeSubreddit(opts.subreddit)) return false;
        return true;
      })
      .sort(function (a, b) { return (b.createdAt || b.foundAt || 0) - (a.createdAt || a.foundAt || 0); });
  }

  return {
    KINDS: KINDS,
    MENTION_FIELDS: MENTION_FIELDS,
    fold: fold,
    tokenize: tokenize,
    parseQuery: parseQuery,
    containsPhrase: containsPhrase,
    normalizeSubreddit: normalizeSubreddit,
    matches: matches,
    toRedditSearchQuery: toRedditSearchQuery,
    normalizeWatch: normalizeWatch,
    planJobs: planJobs,
    itemsFromListing: itemsFromListing,
    itemsFromAtom: itemsFromAtom,
    htmlToText: htmlToText,
    excerpt: excerpt,
    shape: shape,
    safePermalink: safePermalink,
    processItems: processItems,
    mergeMentions: mergeMentions,
    prune: prune,
    list: list
  };
});
