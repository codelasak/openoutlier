// OpenOutlier – turn x.com's own GraphQL responses (the /i/api/graphql/<id>/<Operation>
// calls its web app makes) into normalized post and user records.
// Pure functions, no DOM or chrome.* access, so they run in Node tests too.
//
// OpenOutlier makes no X API requests of its own and never replays x.com's: everything
// here comes from responses the page already received (forwarded by src/hook.js).
// Query ids change every week, operation names rarely, so responses are matched by
// operation name (docs/x-plan.md 2.1 and its "Faz 0 notları").
//
// Account ids: "x/<handle>" (lower case). The user's numeric rest_id is kept as
// ownerId on posts and restId on the profile, so a renamed handle is still the same account.
//
// Post record (stored in rs:p:x/<handle>.posts[<rest_id>]):
//   code, platform 'x', url, owner 'x/<handle>', author (handle as written), ownerId (user rest_id),
//   ownerName, ownerPic, ownerFollowers, ownerVerified (blue), rel { following, followedBy } (the viewer's
//   relationship to the author at the time),
//   kind 'original' | 'reply' | 'thread-part' | 'repost', type = format:
//   'text' | 'image' | 'video' | 'thread' | 'article' | 'link' | 'quote',
//   takenAt (from the snowflake id), views (null when X shows none: posts before 2023), viewsHidden,
//   likes, comments (= replies), shares (= reposts), quotes, saves (= bookmarks),
//   caption (note_tweet text when longer), lang, hashtags, mentions, links (non-X URLs), hasLink,
//   media [{ kind 'photo'|'video'|'gif', url, thumb, duration }], duration (s), thumb, files,
//   isReply, isRepost, quotedId, replyToId, replyToUser, conversationId, threadOf (root id),
//   threadLength (on a thread root), repostOf, article { id, title }, aiGenerated, edit { ids, editable,
//   editsRemaining, edited }, pinned, promoted, seenAt.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpenOutlierX = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ID_RE = /^\d{1,25}$/;
  var USER_RE = /^[A-Za-z0-9_]{1,15}$/;
  var TWEPOCH = 1288834974657;
  var CAPTION_MAX = 4000;
  var FORMATS = ['text', 'image', 'video', 'thread', 'article', 'link', 'quote'];
  var KINDS = ['original', 'reply', 'thread-part', 'repost'];

  // Operations we read (plan 2.1). Analytics ones are stored raw for Phase 2.
  var TIMELINE_OPS = ['UserOriginalsTimeline', 'UserRepliesTimeline', 'UserRepostsTimeline', 'UserHighlightsTweets',
    'UserPhotoTimeline', 'UserVideoTimeline', 'UserTweets', 'UserTweetsAndReplies', 'UserMedia',
    'HomeTimeline', 'HomeLatestTimeline', 'SearchTimeline', 'ListLatestTweetsTimeline', 'TweetDetail', 'TweetResultByRestId',
    'TweetResultsByRestIds', 'Bookmarks', 'Likes', 'UserArticlesTweets', 'CommunityTweetsTimeline'];
  var USER_OPS = ['UserByScreenName', 'UserByRestId', 'BlueVerifiedFollowers', 'Followers', 'Following'];
  var RAW_OPS = ['accountOverviewDailyQuery', 'contentPageQuery'];
  var OPS = TIMELINE_OPS.concat(USER_OPS, RAW_OPS);
  // Profile tabs: which ops come from "the profile being viewed" (their posts are the author's own).
  var PROFILE_OPS = ['UserOriginalsTimeline', 'UserRepliesTimeline', 'UserRepostsTimeline', 'UserHighlightsTweets',
    'UserPhotoTimeline', 'UserVideoTimeline', 'UserTweets', 'UserTweetsAndReplies', 'UserMedia', 'UserArticlesTweets'];

  var OP_RE = /\/i\/api\/graphql\/[^/?]+\/([A-Za-z]+)/;

  // Paths on x.com that are not profiles.
  var RESERVED = ('home explore search notifications messages i settings compose login logout signup tos privacy ' +
    'jobs premium premium_sign_up verified-choose communities lists bookmarks topics account intent share hashtag ' +
    'about download following followers grok jobs').split(' ');

  function num(v) {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v)) return Number(v);
    return null;
  }
  function str(v) { return typeof v === 'string' && v ? v : null; }
  function getPath(obj, path) {
    var cur = obj;
    for (var i = 0; i < path.length; i++) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[path[i]];
    }
    return cur;
  }
  function firstDefined() {
    for (var i = 0; i < arguments.length; i++) if (arguments[i] !== undefined && arguments[i] !== null) return arguments[i];
    return null;
  }

  // ---- ids -----------------------------------------------------------------
  function xId(handle) { return 'x/' + String(handle || '').replace(/^\/?(x\/|@)/i, '').toLowerCase(); }
  function isXId(id) { return /^x\/[a-z0-9_]{1,15}$/.test(String(id || '')); }
  /** "x/name" → "@name". */
  function label(id) { return '@' + String(id || '').replace(/^x\//, ''); }

  /** Exact post time from a snowflake id: (id >> 22) + 1288834974657 ms. Ids before Nov 2010 aren't snowflakes: null. */
  function snowflakeTime(id) {
    if (!ID_RE.test(String(id || ''))) return null;
    try {
      var big = BigInt(id);
      if (big < 4294967296n) return null; // pre-snowflake ids (before Nov 2010) are small sequential numbers
      var t = Number((big >> 22n) + BigInt(TWEPOCH));
      // Pre-snowflake ids give a time before the epoch (or garbage): not usable.
      return t > Date.UTC(2010, 10, 4) && t < Date.UTC(2100, 0, 1) ? t : null;
    } catch (e) { return null; }
  }

  function parseDate(s) {
    var t = typeof s === 'string' ? Date.parse(s) : NaN;
    return isFinite(t) ? t : null;
  }

  /** The operation name in an x.com GraphQL URL ("…/graphql/abc123/UserOriginalsTimeline?variables=…"), or null. */
  function opOf(url) {
    var m = OP_RE.exec(String(url || ''));
    return m ? m[1] : null;
  }

  /** Rate-limit headers forwarded by hook.js → { limit, remaining, reset (ms) } or null. */
  function rateLimit(h) {
    if (!h || typeof h !== 'object') return null;
    var limit = num(h.limit);
    var remaining = num(h.remaining);
    var reset = num(h.reset);
    if (limit === null && remaining === null && reset === null) return null;
    return { limit: limit, remaining: remaining, reset: reset !== null ? (reset < 1e11 ? reset * 1000 : reset) : null };
  }

  // ---- users ---------------------------------------------------------------
  /** Unwrap a user_results / user result node to the User object (or null). */
  function unwrapUser(u) {
    if (!u || typeof u !== 'object') return null;
    if (u.result) u = u.result;
    if (u && u.__typename === 'UserUnavailable') return null;
    return u && typeof u === 'object' && (u.rest_id || u.legacy || u.core) ? u : null;
  }

  /**
   * Normalize a GraphQL User. New fields first (core.*, relationship_counts.*, tweet_counts.*,
   * avatar.image_url, relationship_perspectives.*), then the old `legacy` block.
   */
  function parseUser(raw) {
    var u = unwrapUser(raw);
    if (!u) return null;
    var lg = u.legacy && typeof u.legacy === 'object' ? u.legacy : {};
    var core = u.core && typeof u.core === 'object' ? u.core : {};
    var rc = u.relationship_counts && typeof u.relationship_counts === 'object' ? u.relationship_counts : {};
    var tc = u.tweet_counts && typeof u.tweet_counts === 'object' ? u.tweet_counts : {};
    var rp = u.relationship_perspectives && typeof u.relationship_perspectives === 'object' ? u.relationship_perspectives : {};
    var handle = str(core.screen_name) || str(lg.screen_name);
    if (!handle || !USER_RE.test(handle)) return null;
    var restId = u.rest_id != null && ID_RE.test(String(u.rest_id)) ? String(u.rest_id) : null;
    var pinned = Array.isArray(getPath(u, ['pinned_items'])) ? u.pinned_items : null;
    var pinnedIds = [];
    (pinned || lg.pinned_tweet_ids_str || []).forEach(function (x) {
      var id = typeof x === 'string' ? x : x && (x.rest_id || x.tweet_id || getPath(x, ['tweet_results', 'result', 'rest_id']));
      if (id && ID_RE.test(String(id))) pinnedIds.push(String(id));
    });
    function bool(a, b) { return a === true || b === true ? true : a === false || b === false ? false : null; }
    return {
      id: xId(handle),
      handle: handle,
      restId: restId,
      name: str(core.name) || str(lg.name),
      followers: firstDefined(num(rc.followers), num(lg.followers_count)),
      following: firstDefined(num(rc.following), num(lg.friends_count)),
      posts: firstDefined(num(tc.tweets), num(lg.statuses_count)),
      mediaPosts: firstDefined(num(tc.media_tweets), num(lg.media_count)),
      blueVerified: u.is_blue_verified === true || getPath(u, ['verification', 'is_blue_verified']) === true,
      verified: getPath(u, ['verification', 'verified']) === true || lg.verified === true,
      createdAt: parseDate(core.created_at) || parseDate(lg.created_at),
      avatar: str(getPath(u, ['avatar', 'image_url'])) || str(lg.profile_image_url_https),
      professional: !!(u.professional && typeof u.professional === 'object'),
      pinnedIds: pinnedIds,
      rel: {
        following: bool(rp.following, lg.following),
        followedBy: bool(rp.followed_by, lg.followed_by)
      }
    };
  }

  // ---- tweets --------------------------------------------------------------
  /** Unwrap tweet_results / TweetWithVisibilityResults to a Tweet, or null for tombstones and unavailable posts. */
  function unwrapTweet(t) {
    if (!t || typeof t !== 'object') return null;
    if (t.tweet_results) t = t.tweet_results;
    if (t.result) t = t.result;
    if (!t || typeof t !== 'object') return null;
    if (t.__typename === 'TweetWithVisibilityResults' || (t.tweet && !t.legacy)) t = t.tweet;
    if (!t || typeof t !== 'object') return null;
    if (t.__typename === 'TweetTombstone' || t.__typename === 'TweetUnavailable' || t.tombstone) return null;
    if (!t.legacy || !t.rest_id) return null;
    return t;
  }

  function isXUrl(u) {
    try {
      var host = new URL(u).hostname.toLowerCase();
      return /(^|\.)(x\.com|twitter\.com|t\.co)$/.test(host);
    } catch (e) { return true; }
  }

  function mediaOf(lg) {
    var list = getPath(lg, ['extended_entities', 'media']) || getPath(lg, ['entities', 'media']) || [];
    if (!Array.isArray(list)) return [];
    return list.map(function (m) {
      if (!m || typeof m !== 'object') return null;
      var kind = m.type === 'video' ? 'video' : m.type === 'animated_gif' ? 'gif' : m.type === 'photo' ? 'photo' : null;
      if (!kind) return null;
      var thumb = str(m.media_url_https);
      var out = { kind: kind, thumb: thumb, url: kind === 'photo' && thumb ? thumb + (thumb.indexOf('?') === -1 ? '?name=orig' : '') : null, duration: null };
      if (kind !== 'photo') {
        var vi = m.video_info || {};
        var d = num(vi.duration_millis);
        out.duration = d ? Math.round(d / 100) / 10 : null;
        var best = (Array.isArray(vi.variants) ? vi.variants : []).filter(function (v) {
          return v && v.content_type === 'video/mp4' && /^https:\/\//.test(v.url || '');
        }).sort(function (a, b) { return (b.bitrate || 0) - (a.bitrate || 0); });
        out.url = best.length ? best[0].url : null;
        if (best.length > 1) out.alt = best.slice(1, 3).map(function (v) { return v.url; });
      }
      return out;
    }).filter(Boolean);
  }

  function linksOf(lg, card, note) {
    var seen = {};
    var out = [];
    function add(u) { if (u && /^https?:\/\//.test(u) && !isXUrl(u) && !seen[u]) { seen[u] = true; out.push(u); } }
    (getPath(lg, ['entities', 'urls']) || []).forEach(function (x) { add(x && (x.expanded_url || x.url)); });
    (getPath(note, ['entity_set', 'urls']) || []).forEach(function (x) { add(x && (x.expanded_url || x.url)); });
    // A link card whose target was shortened away from the text.
    var cardUrl = getPath(card, ['legacy', 'binding_values']);
    if (Array.isArray(cardUrl)) {
      cardUrl.forEach(function (b) {
        if (b && b.key === 'card_url') add(getPath(b, ['value', 'string_value']));
      });
    }
    return out;
  }

  function tagsOf(lg, note, text) {
    var out = [];
    var seen = {};
    function add(t) { t = String(t || '').replace(/^#/, '').toLowerCase(); if (t && !seen[t]) { seen[t] = true; out.push(t); } }
    (getPath(note, ['entity_set', 'hashtags']) || getPath(lg, ['entities', 'hashtags']) || []).forEach(function (h) { add(h && h.text); });
    if (!out.length) {
      var re = /#([\p{L}\p{N}_]+)/gu;
      var m;
      while ((m = re.exec(text || ''))) if (!/^\d+$/.test(m[1])) add(m[1]);
    }
    return out;
  }

  function aiDisclosure(t) {
    var v = getPath(t, ['content_disclosure', 'ai_generated_disclosure']);
    if (v === undefined) v = t.ai_generated_disclosure;
    if (v === undefined) v = getPath(t, ['legacy', 'ai_generated_disclosure']);
    if (v === true) return true;
    if (!v || typeof v !== 'object') return false;
    if (v.is_ai_generated === false || v.disclosed === false) return false;
    return Object.keys(v).length > 0;
  }

  function editOf(t) {
    var ec = t.edit_control && typeof t.edit_control === 'object' ? t.edit_control : null;
    if (!ec) return null;
    if (ec.edit_control_initial) ec = ec.edit_control_initial;
    var ids = (Array.isArray(ec.edit_tweet_ids) ? ec.edit_tweet_ids : []).map(String).filter(function (x) { return ID_RE.test(x); });
    var until = num(ec.editable_until_msecs);
    return {
      ids: ids,
      edited: ids.length > 1,
      editable: ec.is_edit_eligible === true,
      editableUntil: until,
      editsRemaining: num(ec.edits_remaining)
    };
  }

  /** Format class (plan 1 + Faz 0 "quote"): article > thread > quote > video > image > link > text. */
  function formatOf(o) {
    if (o.article) return 'article';
    if (o.threadLength > 1 || o.selfThreadRoot) return 'thread';
    if (o.quotedId) return 'quote';
    if (o.media.some(function (m) { return m.kind === 'video' || m.kind === 'gif'; })) return 'video';
    if (o.media.length) return 'image';
    if (o.hasLink) return 'link';
    return 'text';
  }

  /**
   * Normalize one Tweet (any wrapper). extra: { pinned, promoted }.
   * Returns the post record, or null for tombstones, unavailable posts and anything without an author.
   */
  function parseTweet(raw, extra) {
    var t = unwrapTweet(raw);
    if (!t) return null;
    var lg = t.legacy;
    var user = parseUser(getPath(t, ['core', 'user_results']));
    if (!user) return null;
    var id = String(t.rest_id);
    var takenAt = snowflakeTime(id) || parseDate(lg.created_at);
    var note = getPath(t, ['note_tweet', 'note_tweet_results', 'result']);
    var text = str(note && note.text) || (typeof lg.full_text === 'string' ? lg.full_text : '');
    // Drop the trailing t.co link X appends for attached media / quotes.
    text = text.replace(/\s*https:\/\/t\.co\/[A-Za-z0-9]+\s*$/, '');
    var card = t.card || null;
    var media = mediaOf(lg);
    var links = linksOf(lg, card, note);
    var quoted = unwrapTweet(t.quoted_status_result);
    var quotedId = (quoted && String(quoted.rest_id)) || (lg.is_quote_status && str(lg.quoted_status_id_str)) || null;
    var rt = unwrapTweet(lg.retweeted_status_result || t.retweeted_status_result);
    var replyToId = str(lg.in_reply_to_status_id_str);
    var replyToUserId = str(lg.in_reply_to_user_id_str);
    var selfReply = !!replyToId && !!replyToUserId && replyToUserId === user.restId;
    var selfThread = str(getPath(lg, ['self_thread', 'id_str']));
    var art = getPath(t, ['article', 'article_results', 'result']);
    var article = art && typeof art === 'object' ? { id: str(art.rest_id), title: str(art.title) || '' } : null;
    var views = getPath(t, ['views']);
    var viewCount = views ? num(views.count) : null;
    var kind = rt ? 'repost' : selfReply ? 'thread-part' : replyToId ? 'reply' : 'original';
    var dur = null;
    media.forEach(function (m) { if (m.duration && (!dur || m.duration > dur)) dur = m.duration; });
    var files = media.filter(function (m) { return m.url; }).map(function (m) {
      var f = { kind: m.kind === 'photo' ? 'image' : 'video', url: m.url };
      if (m.alt) f.alt = m.alt;
      if (m.kind !== 'photo' && m.thumb) f.thumb = m.thumb;
      return f;
    });
    var o = {
      code: id,
      platform: 'x',
      url: 'https://x.com/' + user.handle + '/status/' + id,
      owner: user.id,
      author: user.handle,
      ownerId: user.restId,
      ownerName: user.name,
      ownerPic: user.avatar,
      ownerFollowers: user.followers,
      ownerVerified: user.blueVerified,
      rel: user.rel,
      kind: kind,
      type: 'text',
      takenAt: takenAt,
      views: rt ? null : viewCount,
      viewsHidden: !rt && viewCount === null,
      likes: rt ? null : num(lg.favorite_count),
      comments: rt ? null : num(lg.reply_count),
      shares: rt ? null : num(lg.retweet_count),
      quotes: rt ? null : num(lg.quote_count),
      saves: rt ? null : num(lg.bookmark_count),
      caption: text.length > CAPTION_MAX ? text.slice(0, CAPTION_MAX) + '…' : text,
      lang: str(lg.lang),
      hashtags: tagsOf(lg, note, text),
      mentions: (getPath(lg, ['entities', 'user_mentions']) || []).map(function (m) { return m && str(m.screen_name); }).filter(Boolean),
      links: links,
      hasLink: links.length > 0,
      media: media,
      duration: dur,
      thumb: media.length ? media[0].thumb : null,
      files: files,
      isReply: !!replyToId,
      isRepost: !!rt,
      quotedId: quotedId,
      replyToId: replyToId,
      replyToUser: str(lg.in_reply_to_screen_name),
      conversationId: str(lg.conversation_id_str),
      threadOf: selfReply ? (selfThread && selfThread !== id ? selfThread : str(lg.conversation_id_str)) : null,
      threadLength: null,
      selfThreadRoot: !replyToId && selfThread === id,
      repostOf: rt ? String(rt.rest_id) : null,
      article: article,
      aiGenerated: aiDisclosure(t),
      edit: editOf(t),
      pinned: !!(extra && extra.pinned) || user.pinnedIds.indexOf(id) !== -1,
      promoted: !!(extra && extra.promoted),
      seenAt: Date.now()
    };
    if (rt) { o.media = []; o.files = []; o.thumb = null; o.links = []; o.hasLink = false; o.hashtags = []; o.caption = ''; }
    o.type = formatOf(o);
    if (!o.selfThreadRoot) delete o.selfThreadRoot;
    // The author's full facts, picked up (and removed) by parseResponse.
    Object.defineProperty(o, '_user', { value: user, enumerable: false });
    return o;
  }

  /** The post plus its embedded posts (a quoted post, the original of a repost) as separate records. */
  function tweetAndEmbedded(raw, extra, out) {
    var t = unwrapTweet(raw);
    if (!t) return;
    var p = parseTweet(t, extra);
    if (p) out.push(p);
    var rt = getPath(t, ['legacy', 'retweeted_status_result']) || t.retweeted_status_result;
    if (rt) tweetAndEmbedded(rt, null, out);
    if (t.quoted_status_result) tweetAndEmbedded(t.quoted_status_result, null, out);
  }

  // ---- timelines -----------------------------------------------------------
  /** Instruction arrays of a response, by operation name, with a deep search as a fallback. */
  function instructionsOf(json, op) {
    var d = json && json.data;
    if (!d) return [];
    var paths = {
      HomeTimeline: [['home', 'home_timeline_urt', 'instructions']],
      HomeLatestTimeline: [['home', 'home_timeline_urt', 'instructions']],
      SearchTimeline: [['search_by_raw_query', 'search_timeline', 'timeline', 'instructions']],
      ListLatestTweetsTimeline: [['list', 'tweets_timeline', 'timeline', 'instructions']],
      TweetDetail: [['threaded_conversation_with_injections_v2', 'instructions']],
      Bookmarks: [['bookmark_timeline_v2', 'timeline', 'instructions']],
      // A community's timeline (Home tabs of pinned communities; seen live 2026-11-24).
      CommunityTweetsTimeline: [['communityResults', 'result', 'ranked_community_timeline', 'timeline', 'instructions']]
    };
    var tries = (paths[op] || []).concat([
      ['user', 'result', 'timeline', 'timeline', 'instructions'],
      ['user', 'result', 'timeline_v2', 'timeline', 'instructions'],
      ['user', 'result', 'timeline', 'instructions']
    ]);
    for (var i = 0; i < tries.length; i++) {
      var v = getPath(d, tries[i]);
      if (Array.isArray(v)) return v;
    }
    var found = [];
    (function walk(x, depth) {
      if (!x || typeof x !== 'object' || depth > 8 || found.length) return;
      if (Array.isArray(x.instructions)) { found = x.instructions; return; }
      for (var k in x) if (Object.prototype.hasOwnProperty.call(x, k)) walk(x[k], depth + 1);
    })(d, 0);
    return found;
  }

  /** BigInt-safe comparison of two sortIndex strings, descending (newest first). */
  function bySortIndexDesc(a, b) {
    var x = a.sortIndex;
    var y = b.sortIndex;
    if (x === y) return a.order - b.order;
    try {
      var bx = BigInt(x || '0');
      var by = BigInt(y || '0');
      return bx > by ? -1 : bx < by ? 1 : a.order - b.order;
    } catch (e) { return a.order - b.order; }
  }

  /** Item contents of one entry (a single item, or every item of a module). */
  function itemsOfEntry(entry) {
    var c = entry && entry.content;
    if (!c) return [];
    if (c.itemContent) return [c.itemContent];
    if (Array.isArray(c.items)) return c.items.map(function (x) { return getPath(x, ['item', 'itemContent']) || getPath(x, ['item', 'content']); }).filter(Boolean);
    return [];
  }

  /**
   * Flatten the instructions into entries: TimelineAddEntries, TimelinePinEntry (pinned),
   * TimelineAddToModule (module items appended to a thread / conversation), sorted by sortIndex.
   * → { entries: [{ entryId, sortIndex, pinned, items: [itemContent] }], cursors: { top, bottom } }
   */
  function flatten(instructions) {
    var entries = [];
    var cursors = {};
    var order = 0;
    function addEntry(e, pinned) {
      if (!e || typeof e !== 'object') return;
      var c = e.content || {};
      if (c.cursorType || c.entryType === 'TimelineTimelineCursor' || /^cursor-/.test(e.entryId || '')) {
        var ct = String(c.cursorType || '').toLowerCase();
        if (ct === 'bottom' || ct === 'top') cursors[ct] = str(c.value);
        return;
      }
      entries.push({ entryId: e.entryId || '', sortIndex: e.sortIndex || '0', pinned: !!pinned, items: itemsOfEntry(e), order: order++ });
    }
    (instructions || []).forEach(function (ins) {
      if (!ins || typeof ins !== 'object') return;
      var type = ins.type || ins.__typename;
      if (type === 'TimelineAddEntries') (ins.entries || []).forEach(function (e) { addEntry(e, false); });
      else if (type === 'TimelinePinEntry') addEntry(ins.entry, true);
      else if (type === 'TimelineReplaceEntry') addEntry(ins.entry, false);
      else if (type === 'TimelineAddToModule') {
        (ins.moduleItems || []).forEach(function (mi) {
          var ic = getPath(mi, ['item', 'itemContent']);
          if (ic) entries.push({ entryId: mi.entryId || '', sortIndex: '0', pinned: false, items: [ic], order: order++, module: ins.moduleEntryId || null });
        });
      }
    });
    // Module items keep the place of their module; everything else goes by sortIndex, newest first.
    var top = entries.filter(function (e) { return !e.module; }).sort(bySortIndexDesc);
    var tail = entries.filter(function (e) { return e.module; });
    return { entries: top.concat(tail), cursors: cursors };
  }

  /** Mark thread roots (self-replies found in the same list) and count their parts. Mutates and returns posts. */
  function linkThreads(posts) {
    var byId = {};
    posts.forEach(function (p) { byId[p.code] = p; });
    var counts = {};
    posts.forEach(function (p) { if (p.kind === 'thread-part' && p.threadOf) counts[p.threadOf] = (counts[p.threadOf] || 1) + 1; });
    Object.keys(counts).forEach(function (rootId) {
      var r = byId[rootId];
      if (!r || r.kind !== 'original') return;
      r.threadLength = Math.max(r.threadLength || 0, counts[rootId]);
      if (r.type !== 'article') r.type = 'thread';
    });
    return posts;
  }

  /** Merge duplicates (same post seen twice in one response). */
  function dedupe(list) {
    var byId = {};
    var order = [];
    list.forEach(function (p) {
      if (!byId[p.code]) order.push(p.code);
      byId[p.code] = merge(byId[p.code], p);
    });
    return order.map(function (id) { return byId[id]; });
  }

  /**
   * Parse one GraphQL response.
   * → { op, posts: [post], users: [user], cursors: { top, bottom }, raw: json for analytics ops, profileUser }
   * users: every author seen (newest facts) plus the users a user list (BlueVerifiedFollowers) shows.
   */
  function parseResponse(op, input) {
    var json = input;
    if (typeof input === 'string') {
      try { json = JSON.parse(input); } catch (e) { return { op: op, posts: [], users: [], cursors: {}, raw: null }; }
    }
    var out = { op: op || null, posts: [], users: [], cursors: {}, raw: null, profileUser: null };
    if (!json || typeof json !== 'object') return out;
    if (RAW_OPS.indexOf(op) !== -1) { out.raw = json; return out; }
    var d = json.data || {};
    var users = {};
    function addUser(u) { if (u) users[u.restId || u.id] = Object.assign({}, users[u.restId || u.id] || {}, u); }

    if (op === 'UserByScreenName' || op === 'UserByRestId') {
      var pu = parseUser(getPath(d, ['user', 'result']) || getPath(d, ['user_result_by_screen_name', 'result']));
      if (pu) { addUser(pu); out.profileUser = pu; }
    }
    if (op === 'TweetResultByRestId') {
      tweetAndEmbedded(getPath(d, ['tweetResult', 'result']) || getPath(d, ['tweetResult']), null, out.posts);
    }
    if (op === 'TweetResultsByRestIds') {
      (getPath(d, ['tweetResult']) || []).forEach(function (r) { tweetAndEmbedded(r, null, out.posts); });
    }

    var flat = flatten(instructionsOf(json, op));
    out.cursors = flat.cursors;
    flat.entries.forEach(function (e) {
      e.items.forEach(function (ic) {
        if (!ic || typeof ic !== 'object') return;
        if (ic.itemType === 'TimelineUser' || ic.__typename === 'TimelineUser' || ic.user_results) {
          addUser(parseUser(ic.user_results));
          return;
        }
        if (ic.tweet_results) {
          tweetAndEmbedded(ic.tweet_results, { pinned: e.pinned, promoted: !!ic.promotedMetadata }, out.posts);
        }
      });
    });
    out.posts = linkThreads(dedupe(out.posts));
    // Every author's facts come with each post: followers, blue check, the viewer's relationship.
    out.posts.forEach(function (p) {
      var u = p._user;
      if (!u || !u.restId) return;
      users[u.restId] = Object.assign({}, u, users[u.restId] || {});
    });
    out.users = Object.keys(users).map(function (k) { return users[k]; });
    // A profile tab's owner (UserOriginalsTimeline …) is the author of most of its posts.
    return out;
  }

  /** Parse a forwarded payload: { url, text } → parseResponse(opOf(url), text) (null for operations we don't read). */
  function parsePayload(url, text) {
    var op = opOf(url);
    if (!op || OPS.indexOf(op) === -1) return null;
    return parseResponse(op, text);
  }

  // ---- merge -----------------------------------------------------------------
  /** Merge a fresh record into a stored one: higher counts win (views only grow), gaps are filled, newest links win. */
  function merge(prev, next) {
    if (!prev) return next;
    var out = {};
    var k;
    for (k in prev) out[k] = prev[k];
    for (k in next) {
      var a = prev[k];
      var b = next[k];
      if (b === null || b === undefined || b === '' || (Array.isArray(b) && b.length === 0)) continue;
      if (typeof a === 'number' && typeof b === 'number') {
        out[k] = k === 'duration' || k === 'ownerFollowers' ? b : Math.max(a, b);
      } else if (k === 'pinned' || k === 'promoted' || k === 'aiGenerated') out[k] = Boolean(a) || Boolean(b);
      else if (k === 'viewsHidden') out[k] = Boolean(a) && Boolean(b);
      else if (k === 'type' && a === 'thread' && b !== 'article') out[k] = a; // a root stays a thread once its parts were seen
      else out[k] = b;
    }
    if (out.views != null) out.viewsHidden = false;
    return out;
  }

  function mergePostMaps(base, extra) {
    var out = {};
    var k;
    for (k in base || {}) out[k] = base[k];
    for (k in extra || {}) out[k] = merge(out[k], extra[k]);
    return out;
  }

  /** Merge user facts: newer non-empty values win. */
  function mergeProfile(prev, next) {
    if (!prev) return next;
    var out = Object.assign({}, prev);
    Object.keys(next || {}).forEach(function (k) {
      var v = next[k];
      if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return;
      if (k === 'rel' && v && typeof v === 'object') {
        out.rel = Object.assign({}, prev.rel || {});
        if (v.following != null) out.rel.following = v.following;
        if (v.followedBy != null) out.rel.followedBy = v.followedBy;
        return;
      }
      out[k] = v;
    });
    return out;
  }

  // ---- page context ------------------------------------------------------------
  /**
   * What an x.com path is about.
   * → { kind: 'profile'|'status'|'home'|'search'|'list'|'other', handle, id: 'x/<handle>'|null,
   *     tab: 'posts'|'with_replies'|'media'|'highlights'|'articles'|null, status: '<post id>'|null, list: '<list id>'|null }
   */
  function pageContext(pathname) {
    var path = String(pathname || '').replace(/\/+$/, '') || '/';
    var none = { kind: 'other', handle: null, id: null, tab: null, status: null, list: null };
    if (path === '/home' || path === '/') return Object.assign({}, none, { kind: 'home' });
    if (/^\/search(\/|$)/.test(path)) return Object.assign({}, none, { kind: 'search' });
    var lm = path.match(/^\/i\/lists\/(\d{1,25})/);
    if (lm) return Object.assign({}, none, { kind: 'list', list: lm[1] });
    var sm = path.match(/^\/i\/(?:web\/)?status\/(\d{1,25})/);
    if (sm) return Object.assign({}, none, { kind: 'status', status: sm[1] });
    var m = path.match(/^\/([A-Za-z0-9_]{1,15})(?:\/(status)\/(\d{1,25})|\/(with_replies|media|highlights|articles|superfollows|likes))?(?:\/|$)/);
    if (!m || RESERVED.indexOf(m[1].toLowerCase()) !== -1) return none;
    var handle = m[1];
    if (m[2]) return { kind: 'status', handle: handle, id: xId(handle), tab: null, status: m[3], list: null };
    var rest = path.slice(m[0].length);
    if (rest && !m[4]) return none; // /name/followers, /name/lists …
    return { kind: 'profile', handle: handle, id: xId(handle), tab: m[4] || 'posts', status: null, list: null };
  }

  /** A post id from an x.com / twitter.com status URL or a bare id. */
  function postIdOf(s) {
    var t = String(s || '').trim();
    var m = t.match(/(?:x|twitter)\.com\/(?:[A-Za-z0-9_]{1,15}|i(?:\/web)?)\/status(?:es)?\/(\d{1,25})/i) || t.match(/^(\d{5,25})$/);
    return m ? m[1] : null;
  }

  /** "x/name", "@name", "x.com/name", "https://twitter.com/name" → "x/name" (or null). */
  function normHandle(s) {
    var t = String(s || '').trim();
    var m = t.match(/^(?:x\/|x:\s*@?|@)([A-Za-z0-9_]{1,15})$/i) ||
      t.match(/^(?:https?:\/\/)?(?:(?:www|mobile)\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i);
    if (!m || RESERVED.indexOf(m[1].toLowerCase()) !== -1) return null;
    return xId(m[1]);
  }

  return {
    OPS: OPS,
    TIMELINE_OPS: TIMELINE_OPS,
    USER_OPS: USER_OPS,
    RAW_OPS: RAW_OPS,
    PROFILE_OPS: PROFILE_OPS,
    FORMATS: FORMATS,
    KINDS: KINDS,
    xId: xId,
    isXId: isXId,
    label: label,
    snowflakeTime: snowflakeTime,
    opOf: opOf,
    rateLimit: rateLimit,
    parseUser: parseUser,
    parseTweet: parseTweet,
    flatten: flatten,
    instructionsOf: instructionsOf,
    linkThreads: linkThreads,
    parseResponse: parseResponse,
    parsePayload: parsePayload,
    merge: merge,
    mergePostMaps: mergePostMaps,
    mergeProfile: mergeProfile,
    pageContext: pageContext,
    postIdOf: postIdOf,
    normHandle: normHandle
  };
});
