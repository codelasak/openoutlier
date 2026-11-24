// OpenOutlier – X Phase 3 ("Büyüme", docs/x-plan.md section 4): the niche list, the reply
// opportunities feed, reply ROI with a light CRM, consistency goals and saved searches.
// Pure functions over Phase 1 post records (src/x.js) and small storage objects: no DOM, no
// chrome.*, so Node tests and the MCP bridge (mcp/x-growth-tools.mjs) use the same code.
//
// Nothing here talks to X. Everything comes from responses x.com's own page already received
// (src/hook.js → src/x-content.js → src/x-growth-content.js). OpenOutlier never posts, replies,
// likes, follows or creates lists: "Open" on an opportunity only opens the post and focuses the
// reply box; the user writes and sends.
//
// Storage this module defines (chrome.storage.local; see docs/x-phase3-notes.md):
//   rs:org.xNiche          = { folders: [folderId] }            Library folders marked "X niche" (synced with rs:org)
//   rs:x:me                = { id, handle, restId, source, detectedAt, followersLog: { 'YYYY-MM-DD': followers } }
//   rs:x:niche-src         = { lists: { <listId>: { seenAt, posts, authors: ['x/h'] } }, followingAt }
//   rs:x:feed              = { posts: { <id>: slim post }, at }  recent originals from the list / Following tab / Home
//   rs:x:pace              = { posts: { <id>: { o: 'x/h', t: takenAt, s: [[ageMin, views], …] } } }  early view samples
//   rs:x:crm               = { accounts: { 'x/h': { note, tags: [], updatedAt } } }
//   rs:x:goals             = { posts: 2, replies: 10 }
//   rs:x:sent              = { items: { <id>: { at, kind, replyTo } } }  posts and replies the user sent in this browser (CreateTweet)
//   rs:x:searches          = { items: [{ id, q, label, createdAt, lastOpenedAt, results: [slim + ratio] }] }
// On post records (rs:p:x/<me>, synced to the bridge): the user's replies get
//   parent: { code, owner, author, views, comments, ownerFollowers, takenAt, rel }, authorReplied (true | false),
//   authorReplyId, authorReplyAt. The user's own profile record gets me: true and followersLog.
(function (root, factory) {
  var deps = typeof module === 'object' && module.exports
    ? { X: require('./x.js'), M: require('./metrics.js') }
    : { X: root.OpenOutlierX, M: root.ReelScopeMetrics };
  var api = factory(deps.X, deps.M);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpenOutlierXGrowth = api;
})(typeof self !== 'undefined' ? self : this, function (X, M) {
  'use strict';

  var MIN = 60000;
  var HOUR = 60 * MIN;
  var DAY = 24 * HOUR;

  // ---- constants (documented in docs/x-phase3-notes.md) -------------------------------------
  var C = {
    WINDOW_MIN: 120,              // the feed: originals posted in the last 2 hours (plan 4.2)
    // Fallback pace when an author has no early-view history: median ÷ an effective lifetime.
    // X posts are front-loaded (For You drops posts after 48 h, docs/x-research.md): roughly a third
    // to a half of a post's views arrive in its first two hours. Spreading the author's median over
    // 6 hours gives the pace a typical post keeps during those first hours, so ×1 ≈ "normal".
    TYPICAL_LIFETIME_MIN: 360,
    MIN_SEEN_AGE_MIN: 5,          // views at 1 minute say nothing; treat younger sightings as 5 min old
    MIN_PACE_POSTS: 3,            // history pace needs ≥ 3 of the author's posts seen at that age
    PACE_MAX_AGE_MIN: 360,        // keep early samples up to 6 h after posting
    PACE_SAMPLE_GAP_MIN: 4,       // at most one sample per post every 4 minutes
    PACE_SAMPLES: 16,             // per post
    PACE_KEEP_DAYS: 30,
    PACE_MAX_POSTS: 3000,
    FEED_MAX_AGE_MIN: 180,
    FEED_CAP: 600,
    SAT_REPLIES: 30,              // 30 replies already → saturation ×0.5
    SAT_RATIO_FREE: 0.005,        // replies/views up to 0.5 % costs nothing
    SAT_RATIO_STEP: 0.01,         // every further 1 % halves it again (1 / (1 + excess / step))
    MUTUAL_BONUS: 1.5,            // the author follows you and you follow them (a reply back is weighted +15, research 5)
    FOLLOWS_YOU_BONUS: 1.3,
    SIZE_MIN: 1,                  // author 1–30× your followers fits best (plan 4.2)
    SIZE_MAX: 30,
    COLD_START_FOLLOWERS: 50000,  // x-algorithm: ≤ 50K-follower authors' originals, first 2 h, < 200 impressions
    COLD_START_VIEWS: 200,
    GOALS: { posts: 2, replies: 10 },
    HEATMAP_WEEKS: 12,
    SEARCH_RESULTS: 40,
    SEARCHES_MAX: 30,
    SENT_KEEP_DAYS: 400,
    REFRESH_EVERY_MIN: 10,        // x.nicheRefresh (off by default)
    REFRESH_IDLE_MIN: 2           // never reload within 2 minutes of the user's last key press / click
  };

  // ---- small helpers ------------------------------------------------------------------------
  function num(v) { var n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v; return typeof n === 'number' && isFinite(n) ? n : null; }
  function median(values) {
    var v = values.filter(function (x) { return typeof x === 'number' && isFinite(x); }).sort(function (a, b) { return a - b; });
    if (!v.length) return null;
    var m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }
  function round(x, d) { if (x == null || !isFinite(x)) return null; var f = Math.pow(10, d == null ? 2 : d); return Math.round(x * f) / f; }
  function clone(o) { return JSON.parse(JSON.stringify(o == null ? {} : o)); }
  function idOf(handle) { return handle ? X.xId(handle) : null; }
  function isMine(p, me) {
    if (!p || !me) return false;
    if (me.restId && p.ownerId) return String(p.ownerId) === String(me.restId);
    return !!me.id && p.owner === me.id;
  }

  /** Local calendar day "YYYY-MM-DD". tzOffsetMin = Date#getTimezoneOffset() (UTC − local, minutes); default: this machine's. */
  function dayKey(ts, tzOffsetMin) {
    var off = tzOffsetMin == null ? new Date(ts).getTimezoneOffset() : tzOffsetMin;
    return new Date(ts - off * MIN).toISOString().slice(0, 10);
  }
  function addDays(day, n) { return new Date(Date.parse(day + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10); }

  /** The Library's tag rule (dashboard.js, src/org-ops.js). */
  function normTag(t) {
    return String(t || '').trim().replace(/İ/g, 'i').toLowerCase().replace(/^#/, '').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  }

  /** Who the user is, from the side nav's Profile link href ("/heyEshagh"). */
  function meFromHref(href) {
    var m = /^\/?([A-Za-z0-9_]{1,15})\/?$/.exec(String(href || '').replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com/i, ''));
    if (!m) return null;
    var id = X.xId(m[1]);
    return X.isXId(id) ? { id: id, handle: m[1] } : null;
  }

  // ---- niche (plan 4.1) ---------------------------------------------------------------------
  /** Library folder ids marked "X niche" (rs:org.xNiche.folders), only the ones that still exist. */
  function nicheFolders(org) {
    var ids = org && org.xNiche && Array.isArray(org.xNiche.folders) ? org.xNiche.folders : [];
    var have = {};
    (org && Array.isArray(org.folders) ? org.folders : []).forEach(function (f) { if (f && f.id) have[f.id] = true; });
    return ids.filter(function (id) { return have[id]; });
  }
  /** Mark / unmark a folder as X niche → a new org (the caller writes rs:org). */
  function setNicheFolder(org, folderId, on) {
    var o = clone(org);
    o.folders = Array.isArray(o.folders) ? o.folders : [];
    o.accounts = o.accounts && typeof o.accounts === 'object' ? o.accounts : {};
    if (!o.folders.some(function (f) { return f && f.id === folderId; })) return o;
    var list = o.xNiche && Array.isArray(o.xNiche.folders) ? o.xNiche.folders.slice() : [];
    var k = list.indexOf(folderId);
    if (on !== false && k === -1) list.push(folderId);
    if (on === false && k !== -1) list.splice(k, 1);
    o.xNiche = { folders: list };
    return o;
  }
  /**
   * The niche's X accounts: accounts in folders marked X niche. With no folder marked, null
   * (callers then fall back to the accounts the user follows: the list / Following tab).
   */
  function nicheMembers(org, accountIds) {
    var folders = nicheFolders(org);
    if (!folders.length) return null;
    var acc = (org && org.accounts) || {};
    var set = {};
    (accountIds || Object.keys(acc)).forEach(function (id) {
      if (X.isXId(id) && acc[id] && folders.indexOf(acc[id].folder) !== -1) set[id] = true;
    });
    return set;
  }
  /** Which niche source a GraphQL operation is: 'list' | 'following' | 'community' | 'home' | 'search' | null. */
  function sourceOf(op) {
    return op === 'ListLatestTweetsTimeline' ? 'list' : op === 'HomeLatestTimeline' ? 'following' : op === 'CommunityTweetsTimeline' ? 'community' :
      op === 'HomeTimeline' ? 'home' : op === 'SearchTimeline' ? 'search' : null;
  }
  /** Remember that a list (or the Following tab) was read: rs:x:niche-src. */
  function noteSource(src, op, listId, posts, now) {
    var s = clone(src);
    s.lists = s.lists && typeof s.lists === 'object' ? s.lists : {};
    if (op === 'ListLatestTweetsTimeline' && listId) {
      var l = s.lists[listId] || { authors: [] };
      var authors = {};
      (l.authors || []).forEach(function (a) { authors[a] = true; });
      (posts || []).forEach(function (p) { if (p.kind !== 'repost' && !p.promoted && X.isXId(p.owner)) authors[p.owner] = true; });
      s.lists[listId] = { seenAt: now, posts: (l.posts || 0) + (posts || []).length, authors: Object.keys(authors).slice(0, 500) };
    }
    if (op === 'HomeLatestTimeline') s.followingAt = now;
    if (op === 'CommunityTweetsTimeline') s.communityAt = now;
    return s;
  }
  /** Authors seen on a list who are not in the niche folders yet (to offer "add to the niche folder"). */
  function listAuthorsMissing(src, listId, members) {
    var l = src && src.lists && src.lists[listId];
    if (!l) return [];
    return (l.authors || []).filter(function (a) { return !members || !members[a]; });
  }

  // ---- the recent-originals feed (rs:x:feed) and early-view samples (rs:x:pace) ----------------
  var SLIM_FIELDS = ['code', 'platform', 'url', 'owner', 'author', 'ownerId', 'ownerName', 'ownerPic', 'ownerFollowers', 'ownerVerified', 'rel',
    'kind', 'type', 'takenAt', 'views', 'likes', 'comments', 'shares', 'quotes', 'saves', 'caption', 'lang', 'thumb', 'promoted', 'seenAt',
    'replyToId', 'replyToUser', 'conversationId'];
  function slim(p, extra) {
    var o = {};
    SLIM_FIELDS.forEach(function (k) { if (p[k] !== undefined && p[k] !== null) o[k] = p[k]; });
    if (o.caption && o.caption.length > 400) o.caption = o.caption.slice(0, 400) + '…';
    for (var k in extra || {}) o[k] = extra[k];
    return o;
  }
  /** Add fresh originals to the feed, drop old ones. sources: { postId: 'list' | 'following' | … }. */
  function feedAdd(feed, posts, source, now) {
    var f = { posts: Object.assign({}, feed && feed.posts), at: now };
    (posts || []).forEach(function (p) {
      if (!p || p.platform !== 'x' || p.kind !== 'original' || p.promoted || !p.takenAt) return;
      if (now - p.takenAt > C.FEED_MAX_AGE_MIN * MIN) return;
      var prev = f.posts[p.code];
      var srcs = (prev && prev.sources) || [];
      if (source && srcs.indexOf(source) === -1) srcs = srcs.concat(source);
      f.posts[p.code] = slim(prev ? X.merge(prev, p) : p, { sources: srcs });
    });
    return feedPrune(f, now);
  }
  function feedPrune(feed, now) {
    var list = Object.keys((feed && feed.posts) || {}).map(function (k) { return feed.posts[k]; })
      .filter(function (p) { return p.takenAt && now - p.takenAt <= C.FEED_MAX_AGE_MIN * MIN; })
      .sort(function (a, b) { return b.takenAt - a.takenAt; }).slice(0, C.FEED_CAP);
    var out = {};
    list.forEach(function (p) { out[p.code] = p; });
    return { posts: out, at: feed && feed.at };
  }

  /** Record (age, views) samples for young posts: the history the velocity is measured against. */
  function paceAdd(pace, posts, now) {
    var pc = { posts: Object.assign({}, pace && pace.posts) };
    (posts || []).forEach(function (p) {
      if (!p || p.platform !== 'x' || p.kind !== 'original' || p.promoted || !p.takenAt || num(p.views) == null) return;
      var at = p.seenAt || now;
      var age = (at - p.takenAt) / MIN;
      if (age < 0 || age > C.PACE_MAX_AGE_MIN) return;
      var e = pc.posts[p.code] ? { o: pc.posts[p.code].o, t: pc.posts[p.code].t, s: pc.posts[p.code].s.slice() } : { o: p.owner, t: p.takenAt, s: [] };
      var last = e.s[e.s.length - 1];
      var a = Math.round(age * 10) / 10;
      if (last && a - last[0] < C.PACE_SAMPLE_GAP_MIN) { if (p.views > last[1]) e.s[e.s.length - 1] = [last[0], p.views]; }
      else if (!last || a > last[0]) e.s.push([a, num(p.views)]);
      if (e.s.length > C.PACE_SAMPLES) e.s.splice(1, e.s.length - C.PACE_SAMPLES); // keep the first and the newest
      pc.posts[p.code] = e;
    });
    return pacePrune(pc, now);
  }
  function pacePrune(pace, now) {
    var ids = Object.keys((pace && pace.posts) || {}).filter(function (k) { return now - pace.posts[k].t <= C.PACE_KEEP_DAYS * DAY; })
      .sort(function (a, b) { return pace.posts[b].t - pace.posts[a].t; }).slice(0, C.PACE_MAX_POSTS);
    var out = {};
    ids.forEach(function (k) { out[k] = pace.posts[k]; });
    return { posts: out };
  }
  /**
   * Injected history → the pace map. Rows from Phase 2's x_post_stats or the bridge's snapshots table:
   * { post_id | code | id, owner | account_id | account, ts | seen_at | at | captured_at (ms or ISO), views,
   *   taken_at | takenAt (optional: else postsById[id].takenAt, else the snowflake time) }.
   */
  function paceFromRows(rows, postsById) {
    var out = { posts: {} };
    (rows || []).forEach(function (r) {
      if (!r) return;
      var id = String(r.post_id || r.code || r.id || '');
      var views = num(r.views);
      var ts = r.ts != null ? r.ts : r.seen_at != null ? r.seen_at : r.at != null ? r.at : r.captured_at;
      ts = typeof ts === 'string' && !/^\d+$/.test(ts) ? Date.parse(ts) : num(ts);
      if (!id || views == null || !ts) return;
      var post = postsById && postsById[id];
      var taken = num(r.taken_at != null ? r.taken_at : r.takenAt) || (post && post.takenAt) || X.snowflakeTime(id);
      var owner = r.owner || r.account_id || r.account || (post && post.owner);
      if (!taken || !owner) return;
      var age = (ts - taken) / MIN;
      if (age < 0 || age > C.PACE_MAX_AGE_MIN) return;
      var e = out.posts[id] || (out.posts[id] = { o: owner, t: taken, s: [] });
      e.s.push([Math.round(age * 10) / 10, views]);
    });
    Object.keys(out.posts).forEach(function (k) { out.posts[k].s.sort(function (a, b) { return a[0] - b[0]; }); });
    return out;
  }
  function mergePace(a, b) {
    var out = { posts: Object.assign({}, a && a.posts) };
    Object.keys((b && b.posts) || {}).forEach(function (k) {
      var x = out.posts[k];
      var y = b.posts[k];
      if (!x) { out.posts[k] = y; return; }
      var s = x.s.concat(y.s).sort(function (p, q) { return p[0] - q[0]; });
      out.posts[k] = { o: x.o || y.o, t: x.t || y.t, s: s };
    });
    return out;
  }

  /** Views at age t (minutes) from a post's samples, linear from (0, 0); null when the samples don't reach t. */
  function viewsAt(samples, t) {
    if (!samples || !samples.length) return null;
    var prev = [0, 0];
    for (var i = 0; i < samples.length; i++) {
      var s = samples[i];
      if (s[0] >= t) {
        if (s[0] === prev[0]) return s[1];
        return prev[1] + (s[1] - prev[1]) * (t - prev[0]) / (s[0] - prev[0]);
      }
      prev = s;
    }
    return null;
  }
  /** The author's median views at age t over their other posts in the pace map (≥ MIN_PACE_POSTS), else null. */
  function historyExpected(pace, owner, t, excludeId) {
    var vals = [];
    var posts = (pace && pace.posts) || {};
    for (var k in posts) {
      if (k === excludeId || posts[k].o !== owner) continue;
      var v = viewsAt(posts[k].s, t);
      if (v != null) vals.push(v);
    }
    return vals.length >= C.MIN_PACE_POSTS ? { med: median(vals), n: vals.length } : null;
  }

  // ---- reply opportunities (plan 4.2) ---------------------------------------------------------
  function sizeFit(authorFollowers, myFollowers) {
    var a = num(authorFollowers);
    var mine = num(myFollowers);
    if (a == null || mine == null) return { factor: 1, ratio: null };
    var k = a / Math.max(1, mine);
    var f = k < C.SIZE_MIN ? 0.5 + 0.5 * k : k <= C.SIZE_MAX ? 1 : 1 / (1 + Math.log10(k / C.SIZE_MAX));
    return { factor: f, ratio: k };
  }
  function saturation(replies, views) {
    var c = num(replies) || 0;
    var v = num(views);
    var byCount = 1 / (1 + c / C.SAT_REPLIES);
    var rv = v > 0 ? c / v : 0;
    var byRatio = rv <= C.SAT_RATIO_FREE ? 1 : 1 / (1 + (rv - C.SAT_RATIO_FREE) / C.SAT_RATIO_STEP);
    return { factor: byCount * byRatio, repliesPerView: v > 0 ? rv : null };
  }
  function mutualOf(rel) {
    if (!rel) return { factor: 1, kind: null };
    if (rel.following && rel.followedBy) return { factor: C.MUTUAL_BONUS, kind: 'mutual' };
    if (rel.followedBy) return { factor: C.FOLLOWS_YOU_BONUS, kind: 'follows_you' };
    return { factor: 1, kind: rel.following ? 'you_follow' : null };
  }
  /** The author's median for this post: its format's, else the overall originals median (from M.xBaselines). */
  function authorMedian(p, baselines) {
    var b = baselines && baselines[p.owner];
    if (!b) return null;
    var f = M.xBaselineFor(p, b);
    return f.med ? { med: f.med, scope: f.scope, approx: f.approx } : null;
  }

  /**
   * Score one fresh original. ctx: { now, me, myFollowers, baselines, pace }.
   * → { velocity, velocityBasis: 'history' | 'lifetime' | 'none', expected, saturation, mutual, sizeFit, freshness, raw, score (0–100) }
   */
  function scoreOpportunity(p, ctx) {
    var now = ctx.now;
    var ageMin = (now - p.takenAt) / MIN;
    var seenAge = Math.max(C.MIN_SEEN_AGE_MIN, ((p.seenAt || now) - p.takenAt) / MIN);
    var views = num(p.views);
    var expected = null;
    var basis = 'none';
    var hist = historyExpected(ctx.pace, p.owner, seenAge, p.code);
    var med = authorMedian(p, ctx.baselines);
    if (hist && hist.med > 0) { expected = hist.med; basis = 'history'; }
    else if (med) { expected = med.med * Math.min(1, seenAge / C.TYPICAL_LIFETIME_MIN); basis = 'lifetime'; }
    var velocity = views != null && expected > 0 ? views / expected : null;
    var vf = velocity == null ? 1 : Math.log2(1 + Math.min(velocity, 50));
    var sat = saturation(p.comments, views);
    var mu = mutualOf(p.rel);
    var sz = sizeFit(p.ownerFollowers, ctx.myFollowers);
    var fresh = 1 - 0.35 * Math.min(1, Math.max(0, ageMin) / C.WINDOW_MIN);
    var raw = vf * sat.factor * mu.factor * sz.factor * fresh;
    return {
      ageMin: Math.round(ageMin), velocity: round(velocity, 2), velocityBasis: basis, expected: round(expected, 0),
      historyPosts: hist ? hist.n : 0, median: med ? med.med : null,
      saturation: round(sat.factor, 3), repliesPerView: round(sat.repliesPerView, 4),
      mutual: mu.kind, mutualFactor: mu.factor, sizeRatio: round(sz.ratio, 1), sizeFit: round(sz.factor, 3), freshness: round(fresh, 3),
      coldStart: num(p.ownerFollowers) != null && p.ownerFollowers <= C.COLD_START_FOLLOWERS && ageMin <= C.WINDOW_MIN && views != null && views < C.COLD_START_VIEWS,
      raw: round(raw, 4), score: Math.round(100 * (1 - Math.exp(-raw / 2)))
    };
  }

  /**
   * The reply opportunities feed.
   * opts: { posts (any X posts: Library, feed, page), now, me: { id, restId, followers }, members (set of
   *   'x/h' → true, or null = any author the user follows), baselines (M.xBaselines over the Library),
   *   pace (rs:x:pace, merged with injected history), myReplies (the user's reply posts: already-replied
   *   posts are dropped, or flagged with includeReplied), windowMin, limit, includeReplied }
   * → [{ post (slim), ...scoreOpportunity, replied, replyAngles: null }] best first.
   */
  function replyOpportunities(opts) {
    var now = opts.now || Date.now();
    var windowMs = (opts.windowMin || C.WINDOW_MIN) * MIN;
    var me = opts.me || {};
    var replied = {};
    (opts.myReplies || []).forEach(function (r) { if (r && r.replyToId) replied[r.replyToId] = true; });
    var seen = {};
    var out = [];
    (opts.posts || []).forEach(function (p) {
      if (!p || p.platform !== 'x' || p.kind !== 'original' || p.promoted || !p.takenAt) return;
      if (now - p.takenAt > windowMs || p.takenAt > now + MIN) return;
      if (isMine(p, me)) return;
      var member = opts.members ? !!opts.members[p.owner] : !!(p.rel && p.rel.following);
      if (!member) return;
      if (seen[p.code]) { seen[p.code] = X.merge(seen[p.code], p); return; }
      seen[p.code] = p;
    });
    Object.keys(seen).forEach(function (k) {
      var p = seen[k];
      var wasReplied = !!replied[p.code];
      if (wasReplied && !opts.includeReplied) return;
      var s = scoreOpportunity(p, { now: now, me: me, myFollowers: me.followers, baselines: opts.baselines, pace: opts.pace });
      // PHASE 5 HOOK (replyAngles): left null here. The content script fills it on demand through the
      // x-llm service worker (task 'replyAngles', input from angleInput()); MCP clients write their own.
      out.push(Object.assign({ post: slim(p), replied: wasReplied, replyAngles: null }, s));
    });
    out.sort(function (a, b) { return b.score - a.score || (b.velocity || 0) - (a.velocity || 0) || b.post.takenAt - a.post.takenAt; });
    return opts.limit ? out.slice(0, opts.limit) : out;
  }

  /** Phase 5's replyAngles input for an opportunity ({ post, context }, docs/x-llm-notes.md). */
  function angleInput(op) {
    var p = op.post || op;
    return {
      post: { text: p.caption || '', author: '@' + (p.author || String(p.owner || '').slice(2)), url: p.url, views: p.views, replies: p.comments, ageMin: op.ageMin },
      context: 'A post from the user\'s X niche, ' + (op.ageMin != null ? op.ageMin + ' minutes old' : 'recent') + (op.velocity != null ? ', ' + op.velocity + '× the author\'s usual pace' : '') + '. The user replies by hand.'
    };
  }

  // ---- the user's own posts: CreateTweet, reply annotations, follower deltas ------------------------
  /** A post the user just sent in this tab, from x.com's CreateTweet / CreateNoteTweet response (null otherwise). */
  function parseCreateTweet(op, text) {
    if (op !== 'CreateTweet' && op !== 'CreateNoteTweet') return null;
    var json = text;
    if (typeof text === 'string') { try { json = JSON.parse(text); } catch (e) { return null; } }
    var d = (json && json.data) || {};
    var r = (d.create_tweet && d.create_tweet.tweet_results) || (d.notetweet_create && d.notetweet_create.tweet_results);
    var p = r ? X.parseTweet(r.result || r) : null;
    return p;
  }
  function sentAdd(sent, p, now) {
    var s = { items: Object.assign({}, sent && sent.items) };
    if (p && p.code && p.kind !== 'repost') s.items[p.code] = { at: p.takenAt || now, kind: p.kind, replyTo: p.replyToUser ? X.xId(p.replyToUser) : null, replyToId: p.replyToId || null };
    Object.keys(s.items).forEach(function (k) { if (now - s.items[k].at > C.SENT_KEEP_DAYS * DAY) delete s.items[k]; });
    return s;
  }

  function parentSnap(p) {
    return { code: p.code, owner: p.owner, author: p.author, views: num(p.views), comments: num(p.comments), likes: num(p.likes),
      ownerFollowers: num(p.ownerFollowers), takenAt: p.takenAt, rel: p.rel || null };
  }
  /**
   * Annotate the user's replies with what a payload shows: the post replied to (parent snapshot, its
   * author's followers and relationship) and whether that author replied back. posts: the payload's
   * posts; known: { id: post } of the user's stored replies (so a reply back in another payload still lands).
   * → the user's reply posts that changed (full records, ready to merge into rs:p:x/<me>).
   */
  function annotateReplies(posts, me, known) {
    if (!me || (!me.id && !me.restId)) return [];
    var byId = {};
    (posts || []).forEach(function (p) { if (p && p.code) byId[p.code] = p; });
    var mine = {};
    Object.keys(known || {}).forEach(function (k) { var p = known[k]; if (p && p.kind === 'reply') mine[k] = p; });
    (posts || []).forEach(function (p) { if (p && p.kind === 'reply' && isMine(p, me)) mine[p.code] = mine[p.code] ? X.merge(mine[p.code], p) : p; });
    var changed = {};
    function touch(id, fields) {
      var cur = mine[id];
      var next = Object.assign({}, cur, fields);
      if (JSON.stringify(cur) !== JSON.stringify(next)) { mine[id] = next; changed[id] = true; }
    }
    Object.keys(mine).forEach(function (id) {
      var r = mine[id];
      var parent = r.replyToId && byId[r.replyToId];
      if (parent && !isMine(parent, me)) touch(id, { parent: parentSnap(parent) });
      // Nobody replied (X's own reply count is 0): the author did not reply back, for now.
      if (num(r.comments) === 0 && r.authorReplied !== true && byId[id]) touch(id, { authorReplied: false });
    });
    (posts || []).forEach(function (p) {
      if (!p || !p.replyToId || !mine[p.replyToId] || isMine(p, me)) return;
      var r = mine[p.replyToId];
      var parentAuthor = (r.parent && r.parent.owner) || (r.replyToUser && X.xId(r.replyToUser));
      if (parentAuthor && p.owner === parentAuthor) touch(p.replyToId, { authorReplied: true, authorReplyId: p.code, authorReplyAt: p.takenAt });
    });
    return Object.keys(changed).map(function (k) { return mine[k]; });
  }

  /** { 'YYYY-MM-DD': followers } → { day: change since the day before } (only for back-to-back days). */
  function deltasFromLog(log) {
    var days = Object.keys(log || {}).sort();
    var out = {};
    for (var i = 1; i < days.length; i++) {
      if (addDays(days[i - 1], 1) !== days[i]) continue;
      var a = num(log[days[i - 1]]);
      var b = num(log[days[i]]);
      if (a != null && b != null) out[days[i]] = b - a;
    }
    return out;
  }
  /** accountOverviewDailyQuery (raw, rs:x:raw:…) → { day: follows − unfollows } from current_time_series. */
  function deltasFromOverview(raw) {
    var res = raw && (raw.data || raw);
    var r = res && res.viewer_v2 && res.viewer_v2.user_results && res.viewer_v2.user_results.result;
    var series = r && Array.isArray(r.current_time_series) ? r.current_time_series : [];
    var out = {};
    series.forEach(function (e) {
      if (!e || (e.engagement_type !== 'Follow' && e.engagement_type !== 'Unfollow')) return;
      var ts = num(e.timestamp);
      var n = num(e.count);
      if (!ts || n == null) return;
      // Daily buckets are stamped at UTC midnight: keep the UTC day.
      var day = dayKey(ts, 0);
      out[day] = (out[day] || 0) + (e.engagement_type === 'Follow' ? n : -n);
    });
    return out;
  }
  function logFollowers(me, followers, now, tzOffsetMin) {
    var m = clone(me);
    var n = num(followers);
    if (n == null) return m;
    m.followersLog = m.followersLog || {};
    m.followersLog[dayKey(now, tzOffsetMin)] = n;
    var days = Object.keys(m.followersLog).sort();
    if (days.length > 400) days.slice(0, days.length - 400).forEach(function (d) { delete m.followersLog[d]; });
    return m;
  }

  // ---- reply ROI (plan 4.3) -------------------------------------------------------------------------
  /**
   * opts: { myPosts (the user's posts: rs:p:x/<me>), me, deltas ({ day: follower change }; exact ones from
   *   the analytics win over the followers log), parents ({ id: post } from the Library), now, sinceDays (90), tzOffsetMin }
   * → { replies: [...], accounts: [...] (best growers first), totals, followers_note }
   */
  function replyRoi(opts) {
    var now = opts.now || Date.now();
    var since = now - (opts.sinceDays || 90) * DAY;
    var me = opts.me || {};
    var deltas = opts.deltas || {};
    var parents = opts.parents || {};
    var rows = (opts.myPosts || []).filter(function (p) {
      return p && p.kind === 'reply' && p.takenAt >= since && (!me.restId || !p.ownerId || String(p.ownerId) === String(me.restId));
    }).map(function (p) {
      var parent = p.parent || (parents[p.replyToId] ? parentSnap(parents[p.replyToId]) : null);
      var to = (parent && parent.owner) || (p.replyToUser ? X.xId(p.replyToUser) : null);
      var day = dayKey(p.takenAt, opts.tzOffsetMin);
      return {
        code: p.code, url: p.url, at: p.takenAt, day: day, to: to, parent_id: p.replyToId || null,
        parent_views: parent ? parent.views : null, author_followers: parent ? parent.ownerFollowers : null,
        mutual: parent && parent.rel ? !!(parent.rel.following && parent.rel.followedBy) : null,
        views: num(p.views), likes: num(p.likes), replies: num(p.comments),
        // "false" was noted while X showed 0 replies; once replies exist it is unknown again until seen.
        author_replied: p.authorReplied === true ? true : p.authorReplied === false && num(p.comments) === 0 ? false : null,
        author_reply_at: p.authorReplied === true ? num(p.authorReplyAt) : null,
        author_liked: p.authorLiked === true ? true : p.authorLiked === false ? false : num(p.likes) === 0 ? false : null,
        followers_day: deltas[day] != null ? deltas[day] : null, followers_share: null, text: (p.caption || '').slice(0, 140)
      };
    });
    // Share each known day's follower change across that day's replies, by views (equal split without views).
    var byDay = {};
    rows.forEach(function (r) { (byDay[r.day] = byDay[r.day] || []).push(r); });
    Object.keys(byDay).forEach(function (d) {
      if (deltas[d] == null) return;
      var list = byDay[d];
      var tot = list.reduce(function (s, r) { return s + (r.views || 0); }, 0);
      list.forEach(function (r) { r.followers_share = round(deltas[d] * (tot > 0 ? (r.views || 0) / tot : 1 / list.length), 2); });
    });
    var acc = {};
    rows.forEach(function (r) {
      if (!r.to) return;
      var a = acc[r.to] || (acc[r.to] = { account: r.to, replies: 0, views: [], reciprocated: 0, known: 0, liked_back: 0, followers: null, last_at: 0, mutual: null, author_followers: null });
      a.replies++;
      if (r.views != null) a.views.push(r.views);
      if (r.author_replied != null) a.known++;
      if (r.author_replied) a.reciprocated++;
      if (r.author_liked) a.liked_back++;
      if (r.followers_share != null) a.followers = round((a.followers || 0) + r.followers_share, 2);
      if (r.at > a.last_at) { a.last_at = r.at; if (r.mutual != null) a.mutual = r.mutual; if (r.author_followers != null) a.author_followers = r.author_followers; }
    });
    var accounts = Object.keys(acc).map(function (k) {
      var a = acc[k];
      var tot = a.views.reduce(function (s, v) { return s + v; }, 0);
      return { account: a.account, replies: a.replies, total_views: tot, median_views: median(a.views), avg_views: a.views.length ? Math.round(tot / a.views.length) : null,
        author_replied: a.reciprocated, author_replied_known: a.known, reciprocity: a.known ? round(a.reciprocated / a.known, 2) : null,
        liked_back: a.liked_back, followers_attributed: a.followers, last_reply_at: a.last_at, mutual: a.mutual, author_followers: a.author_followers };
    }).sort(function (a, b) {
      return (b.followers_attributed || 0) - (a.followers_attributed || 0) || (b.median_views || 0) - (a.median_views || 0) || b.replies - a.replies;
    });
    var views = rows.map(function (r) { return r.views; });
    return {
      replies: rows.sort(function (a, b) { return b.at - a.at; }),
      accounts: accounts,
      totals: { replies: rows.length, median_views: median(views), author_replied: rows.filter(function (r) { return r.author_replied; }).length,
        author_replied_known: rows.filter(function (r) { return r.author_replied != null; }).length,
        days_with_follower_data: Object.keys(byDay).filter(function (d) { return deltas[d] != null; }).length },
      followers_note: 'Follower change is per day, not per reply: each day\'s change is shared across that day\'s replies by views, so followers_attributed is a rough estimate. Posts and other activity that day count too.'
    };
  }
  /** Combine follower deltas: exact ones (analytics) win over the followers log. */
  function mergeDeltas(exact, fromLog) { return Object.assign({}, fromLog || {}, exact || {}); }

  // ---- light CRM (plan 4.3) ----------------------------------------------------------------------------
  /** Edit rs:x:crm → a new crm object. patch: { note?, tags? (replace), addTag?, removeTag? }. Throws on a bad account. */
  function crmSet(crm, account, patch, now) {
    var id = X.isXId(account) ? account : X.normHandle(account);
    if (!id) throw new Error('Not an X account: ' + account);
    var c = { accounts: Object.assign({}, crm && crm.accounts) };
    var e = Object.assign({ note: '', tags: [] }, c.accounts[id]);
    e.tags = (e.tags || []).slice();
    if (patch && typeof patch.note === 'string') e.note = patch.note.slice(0, 2000);
    if (patch && Array.isArray(patch.tags)) e.tags = patch.tags.map(normTag).filter(Boolean);
    if (patch && patch.addTag) { var t = normTag(patch.addTag); if (t && e.tags.indexOf(t) === -1) e.tags.push(t); }
    if (patch && patch.removeTag) { var r = normTag(patch.removeTag); e.tags = e.tags.filter(function (x) { return x !== r; }); }
    e.tags = e.tags.filter(function (x, i, a) { return a.indexOf(x) === i; }).slice(0, 20);
    e.updatedAt = now || Date.now();
    if (!e.note && !e.tags.length) delete c.accounts[id]; else c.accounts[id] = e;
    return c;
  }
  /**
   * The CRM table: every account the user replied to (from replyRoi) plus every account with a note,
   * with what is known about them. profiles: { 'x/h': profile } from the Library.
   */
  function crmTable(roi, crm, profiles, members) {
    var rows = {};
    ((roi && roi.accounts) || []).forEach(function (a) {
      rows[a.account] = { account: a.account, replies: a.replies, reciprocated: a.author_replied, reciprocated_known: a.author_replied_known,
        median_views: a.median_views, followers_attributed: a.followers_attributed, last_interaction: a.last_reply_at, mutual: a.mutual, followers: a.author_followers };
    });
    ((roi && roi.replies) || []).forEach(function (r) {
      // the author's reply back is an interaction too
      var t = r.author_reply_at || 0;
      if (r.to && rows[r.to] && t > (rows[r.to].last_interaction || 0)) rows[r.to].last_interaction = t;
    });
    var notes = (crm && crm.accounts) || {};
    Object.keys(notes).forEach(function (id) {
      if (!rows[id]) rows[id] = { account: id, replies: 0, reciprocated: 0, reciprocated_known: 0, median_views: null, followers_attributed: null, last_interaction: null, mutual: null, followers: null };
    });
    return Object.keys(rows).map(function (id) {
      var r = rows[id];
      var prof = profiles && profiles[id];
      if (prof) {
        if (prof.followers != null) r.followers = prof.followers;
        if (prof.rel) r.mutual = !!(prof.rel.following && prof.rel.followedBy);
        r.name = prof.name || null;
        r.handle = prof.handle || null;
      }
      r.note = notes[id] ? notes[id].note : '';
      r.tags = notes[id] ? notes[id].tags : [];
      r.niche = !!(members && members[id]);
      return r;
    }).sort(function (a, b) { return (b.last_interaction || 0) - (a.last_interaction || 0) || a.account.localeCompare(b.account); });
  }

  // ---- consistency (plan 4.4) ------------------------------------------------------------------------
  function goalsOf(g) {
    var p = num(g && g.posts);
    var r = num(g && g.replies);
    return { posts: p != null && p >= 0 && p <= 50 ? Math.round(p) : C.GOALS.posts, replies: r != null && r >= 0 && r <= 200 ? Math.round(r) : C.GOALS.replies };
  }
  /**
   * Posts and replies per local day, from the user's collected posts and the CreateTweet log (by id, so
   * nothing counts twice). Originals (any format, a thread counts once, quotes count) are posts; replies
   * to other people are replies; thread parts and reposts don't count.
   */
  function activityByDay(myPosts, sent, tzOffsetMin, me) {
    var kinds = {};
    (myPosts || []).forEach(function (p) { if (p && p.code && p.takenAt && (!me || !p.ownerId || !me.restId || String(p.ownerId) === String(me.restId))) kinds[p.code] = { at: p.takenAt, kind: p.kind }; });
    var items = (sent && sent.items) || {};
    Object.keys(items).forEach(function (k) { if (!kinds[k]) kinds[k] = { at: items[k].at, kind: items[k].kind }; });
    var days = {};
    Object.keys(kinds).forEach(function (k) {
      var e = kinds[k];
      if (e.kind !== 'original' && e.kind !== 'reply') return;
      var d = dayKey(e.at, tzOffsetMin);
      var o = days[d] || (days[d] = { posts: 0, replies: 0 });
      if (e.kind === 'original') o.posts++; else o.replies++;
    });
    return days;
  }
  /**
   * → { goals, today: { day, posts, replies, met, left: { posts, replies } }, streak (days in a row the goals
   *   were met, today included once met), best, activeStreak (days in a row with any post or reply),
   *   heatmap: [{ day, posts, replies, met, level 0–4 }] (HEATMAP_WEEKS weeks, Monday first), week }
   */
  function consistency(activity, goals, now, tzOffsetMin) {
    var g = goalsOf(goals);
    var today = dayKey(now, tzOffsetMin);
    function at(d) { return (activity && activity[d]) || { posts: 0, replies: 0 }; }
    function met(d) { var a = at(d); return a.posts >= g.posts && a.replies >= g.replies && (g.posts + g.replies > 0); }
    function active(d) { var a = at(d); return a.posts + a.replies > 0; }
    function run(test) {
      var n = 0;
      var d = test(today) ? today : addDays(today, -1);
      while (test(d) && n < 3650) { n++; d = addDays(d, -1); }
      return n;
    }
    var days = Object.keys(activity || {}).sort();
    var best = 0;
    var cur = 0;
    var prev = null;
    days.forEach(function (d) {
      if (!met(d)) { cur = 0; prev = d; return; }
      cur = prev && addDays(prev, 1) === d && met(prev) ? cur + 1 : 1;
      if (cur > best) best = cur;
      prev = d;
    });
    // The heatmap starts on a Monday, HEATMAP_WEEKS weeks back.
    var dow = (new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7; // Monday = 0
    var start = addDays(today, -dow - (C.HEATMAP_WEEKS - 1) * 7);
    var heat = [];
    var target = Math.max(1, g.posts + g.replies);
    for (var d = start; d <= today; d = addDays(d, 1)) {
      var a = at(d);
      var tot = a.posts + a.replies;
      heat.push({ day: d, posts: a.posts, replies: a.replies, met: met(d), level: tot === 0 ? 0 : met(d) ? 4 : Math.min(3, 1 + Math.floor(3 * tot / target)) });
    }
    var week = heat.slice(-dow - 1);
    var t = at(today);
    return {
      goals: g,
      today: { day: today, posts: t.posts, replies: t.replies, met: met(today), left: { posts: Math.max(0, g.posts - t.posts), replies: Math.max(0, g.replies - t.replies) } },
      streak: run(met), best: Math.max(best, run(met)), activeStreak: run(active),
      heatmap: heat,
      week: { days: week.length, met: week.filter(function (x) { return x.met; }).length, posts: week.reduce(function (s, x) { return s + x.posts; }, 0), replies: week.reduce(function (s, x) { return s + x.replies; }, 0) }
    };
  }

  // ---- saved searches (plan 4.5) -------------------------------------------------------------------------
  function normQuery(q) { return String(q || '').trim().replace(/\s+/g, ' ').slice(0, 300); }
  function searchKey(q) { return normQuery(q).toLowerCase(); }
  /** The search an x.com URL shows: { q, f } or null. */
  function searchFromUrl(href) {
    try {
      var u = new URL(href, 'https://x.com');
      if (!/^\/search\/?$/.test(u.pathname)) return null;
      var q = normQuery(u.searchParams.get('q'));
      return q ? { q: q, f: u.searchParams.get('f') || 'top' } : null;
    } catch (e) { return null; }
  }
  function searchUrl(q, f) { return 'https://x.com/search?q=' + encodeURIComponent(normQuery(q)) + '&src=typed_query' + (f && f !== 'top' ? '&f=' + encodeURIComponent(f) : ''); }
  function saveSearch(state, q, now, label, f) {
    var s = { items: ((state && state.items) || []).slice() };
    var key = searchKey(q);
    if (!key) throw new Error('Empty search');
    if (s.items.some(function (x) { return searchKey(x.q) === key; })) return s;
    if (s.items.length >= C.SEARCHES_MAX) throw new Error('At most ' + C.SEARCHES_MAX + ' saved searches');
    s.items.push({ id: 's' + now.toString(36), q: normQuery(q), f: f || 'live', label: String(label || '').slice(0, 60) || normQuery(q), createdAt: now, lastOpenedAt: null, results: [] });
    return s;
  }
  function removeSearch(state, id) { return { items: ((state && state.items) || []).filter(function (x) { return x.id !== id; }) }; }
  function findSearch(state, q) { var key = searchKey(q); return ((state && state.items) || []).filter(function (x) { return searchKey(x.q) === key; })[0] || null; }
  /** Score posts against their authors' medians (Library first, else the posts at hand, ≈) and rank: outliers first. */
  function rankPosts(posts, baselines, now) {
    var list = (posts || []).filter(function (p) { return p && p.platform === 'x' && p.kind !== 'repost' && !p.promoted; });
    var scored = M.enrich(list, { xBaselines: baselines || {}, now: now });
    return scored.sort(function (a, b) {
      return (b.ratio == null ? -1 : b.ratio) - (a.ratio == null ? -1 : a.ratio) || (b.views || 0) - (a.views || 0);
    });
  }
  /** Keep a saved search's newest ranked results (merged with earlier ones), while the user has it open. */
  function recordSearch(state, q, ranked, now) {
    var s = { items: ((state && state.items) || []).map(function (x) { return Object.assign({}, x); }) };
    var key = searchKey(q);
    var it = s.items.filter(function (x) { return searchKey(x.q) === key; })[0];
    if (!it) return s;
    var by = {};
    (it.results || []).forEach(function (r) { by[r.code] = r; });
    (ranked || []).forEach(function (p) {
      by[p.code] = slim(p, { ratio: round(p.ratio, 2), viralScore: p.viralScore, outlier: !!p.outlier, approx: !!p.baselineApprox });
    });
    it.results = Object.keys(by).map(function (k) { return by[k]; })
      .sort(function (a, b) { return (b.ratio == null ? -1 : b.ratio) - (a.ratio == null ? -1 : a.ratio) || (b.views || 0) - (a.views || 0); })
      .slice(0, C.SEARCH_RESULTS);
    it.lastOpenedAt = now;
    return s;
  }

  // ---- list-tab auto-refresh (x.nicheRefresh, off by default) ----------------------------------------
  /**
   * Whether the open list tab should be reloaded now. s: { on, kind ('list' | …), lastLoadAt, lastInputAt,
   * typing (a reply box has text or focus), now }. The reload is x.com's own page load; OpenOutlier sends nothing.
   */
  function refreshDue(s) {
    if (!s || !s.on || s.kind !== 'list' || s.typing) return false;
    if (s.lastInputAt && s.now - s.lastInputAt < C.REFRESH_IDLE_MIN * MIN) return false;
    return !!s.lastLoadAt && s.now - s.lastLoadAt >= C.REFRESH_EVERY_MIN * MIN;
  }

  return {
    C: C,
    dayKey: dayKey,
    addDays: addDays,
    median: median,
    normTag: normTag,
    meFromHref: meFromHref,
    idOf: idOf,
    isMine: isMine,
    // niche
    nicheFolders: nicheFolders,
    setNicheFolder: setNicheFolder,
    nicheMembers: nicheMembers,
    sourceOf: sourceOf,
    noteSource: noteSource,
    listAuthorsMissing: listAuthorsMissing,
    slim: slim,
    feedAdd: feedAdd,
    feedPrune: feedPrune,
    paceAdd: paceAdd,
    pacePrune: pacePrune,
    paceFromRows: paceFromRows,
    mergePace: mergePace,
    viewsAt: viewsAt,
    historyExpected: historyExpected,
    // opportunities
    sizeFit: sizeFit,
    saturation: saturation,
    mutualOf: mutualOf,
    scoreOpportunity: scoreOpportunity,
    replyOpportunities: replyOpportunities,
    angleInput: angleInput,
    // own posts, ROI, CRM
    parseCreateTweet: parseCreateTweet,
    sentAdd: sentAdd,
    annotateReplies: annotateReplies,
    deltasFromLog: deltasFromLog,
    deltasFromOverview: deltasFromOverview,
    mergeDeltas: mergeDeltas,
    logFollowers: logFollowers,
    replyRoi: replyRoi,
    crmSet: crmSet,
    crmTable: crmTable,
    // consistency
    goalsOf: goalsOf,
    activityByDay: activityByDay,
    consistency: consistency,
    // saved searches
    normQuery: normQuery,
    searchKey: searchKey,
    searchFromUrl: searchFromUrl,
    searchUrl: searchUrl,
    saveSearch: saveSearch,
    removeSearch: removeSearch,
    findSearch: findSearch,
    rankPosts: rankPosts,
    recordSearch: recordSearch,
    refreshDue: refreshDue
  };
});
