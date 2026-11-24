// OpenOutlier – X idea sources (docs/x-plan.md 5.2, phase 4). Pure, UMD: the Library page
// (dashboard/x-ideas-view.js) and the MCP tool x_ideas (mcp/x-ideas.mjs) both use it.
//
// Three sources, all from what the Library already holds (nothing is fetched):
//   niche          X posts of the niche (folders marked "X niche", rs:org.xNiche) from the last 30 days
//                  at ≥3× their author's own median (format medians, src/metrics.js)
//   crossPlatform  the user's OWN Reels / TikToks / Shorts / YouTube videos that were outliers (≥2× their
//                  own median): their own content, fine to adapt for X
//   reddit         questions and pain points that did well in the chosen subreddits (M.contentIdeas)
//
// Which accounts are "own" and which subreddits count are kept in rs:org.xIdeas (synced to the bridge
// with the rest of rs:org):  { own: ['handson.excel', 'yt/handsonexcel', …], subreddits: ['r/excel', …] }.
// Every idea is a starting point for the user's own post. Nothing here rewrites someone else's post:
// niche outliers are shown as "what worked", with a link, never as text to copy (plan 8).
'use strict';

(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpenOutlierXIdeas = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  var M = root.ReelScopeMetrics;
  var XG = root.OpenOutlierXGrowth;
  if (typeof require === 'function' && typeof module === 'object') {
    try { M = M || require('./metrics.js'); } catch (e) { /* browser */ }
    try { XG = XG || require('./x-growth.js'); } catch (e) { /* optional */ }
  }
  var DAY = 864e5;
  var DEFAULTS = { days: 30, nicheMin: 3, ownMin: 2, ownDays: 365, redditDays: 365, limit: 20 };

  function platformOf(id, rec) {
    var p = rec && rec.platform;
    if (p) return p;
    if (/^x\//.test(id)) return 'x';
    if (/^tt\//.test(id)) return 'tiktok';
    if (/^yt\//.test(id)) return 'youtube';
    if (/^(r|u)\//.test(id)) return 'reddit';
    return 'instagram';
  }
  function textOf(p) { return String(p.caption || p.title || p.text || p.desc || '').trim(); }
  function round(n, d) { if (n == null || !isFinite(n)) return null; var k = Math.pow(10, d || 1); return Math.round(n * k) / k; }
  function firstLine(t, max) { var s = String(t || '').split(/\n/)[0].trim(); return s.length > (max || 140) ? s.slice(0, (max || 140) - 1) + '…' : s; }
  function postsOf(lib, id) { var rec = lib.accounts && lib.accounts[id]; return rec ? Object.values(rec.posts || {}) : []; }
  function settingsOf(org) {
    var s = org && org.xIdeas && typeof org.xIdeas === 'object' ? org.xIdeas : {};
    return { own: Array.isArray(s.own) ? s.own.filter(Boolean) : [], subreddits: Array.isArray(s.subreddits) ? s.subreddits.filter(Boolean) : [] };
  }
  /** rs:org with new xIdeas settings (the caller writes it back). */
  function setSettings(org, patch) {
    var o = JSON.parse(JSON.stringify(org || {}));
    var cur = settingsOf(o);
    if (patch && Array.isArray(patch.own)) cur.own = patch.own.filter(function (x, i, a) { return x && a.indexOf(x) === i; }).slice(0, 50);
    if (patch && Array.isArray(patch.subreddits)) cur.subreddits = patch.subreddits.filter(function (x, i, a) { return x && a.indexOf(x) === i; }).slice(0, 50);
    o.xIdeas = cur;
    return o;
  }

  /** The niche's X accounts: folders marked X niche; with none, every X account in the Library. */
  function nicheIds(lib, exclude) {
    var ids = Object.keys(lib.accounts || {}).filter(function (id) { return platformOf(id, lib.accounts[id]) === 'x'; });
    var me = ids.filter(function (id) { var p = lib.accounts[id].profile; return (p && p.me === true) || (exclude || []).indexOf(id) !== -1; });
    var set = XG && XG.nicheMembers ? XG.nicheMembers(lib.org || {}, ids) : null;
    var out = set ? ids.filter(function (id) { return set[id]; }) : ids;
    return { ids: out.filter(function (id) { return me.indexOf(id) === -1; }), marked: !!set };
  }

  /** Niche X outliers: originals of the last `days` at ≥ nicheMin × their author's median, best first. */
  function nicheOutliers(lib, o) {
    var n = nicheIds(lib, o.exclude);
    var since = o.now - o.days * DAY;
    var rows = [];
    n.ids.forEach(function (id) {
      M.enrich(postsOf(lib, id), { now: o.now }).forEach(function (p) {
        if (p.kind !== 'original' || p.promoted || !p.takenAt || p.takenAt < since) return;
        if (p.ratio == null || p.ratio < o.nicheMin) return;
        rows.push({
          source: 'niche', account: id, author: p.author || id.slice(2), code: p.code, url: p.url || null,
          text: textOf(p), first_line: firstLine(textOf(p)), format: p.type || null,
          views: p.views, ratio: round(p.ratio, 1), approx: !!p.baselineApprox, viral_score: p.viralScore,
          taken_at: p.takenAt
        });
      });
    });
    rows.sort(function (a, b) { return b.ratio - a.ratio || b.views - a.views; });
    return { accounts: n.ids.length, niche_marked: n.marked, min_ratio: o.nicheMin, days: o.days, posts: rows.slice(0, o.limit), total: rows.length };
  }

  function kindOf(platform, p) {
    if (platform === 'youtube') return p.type === 'short' || p.isShort || p.short ? 'short' : 'video';
    if (platform === 'tiktok') return 'tiktok';
    return 'reel';
  }
  /** The user's own outliers on Instagram, TikTok and YouTube (≥ ownMin × their own median). */
  function ownOutliers(lib, o) {
    var since = o.now - o.ownDays * DAY;
    var own = o.own.filter(function (id) { var pl = platformOf(id, lib.accounts && lib.accounts[id]); return pl !== 'x' && pl !== 'reddit'; });
    var rows = [];
    var missing = [];
    own.forEach(function (id) {
      var rec = lib.accounts && lib.accounts[id];
      if (!rec) { missing.push(id); return; }
      var pl = platformOf(id, rec);
      M.enrich(postsOf(lib, id), { now: o.now }).forEach(function (p) {
        if (p.ratio == null || p.ratio < o.ownMin || (p.takenAt && p.takenAt < since)) return;
        var kind = kindOf(pl, p);
        rows.push({
          source: 'own', platform: pl, kind: kind, account: id, code: p.code, url: p.url || null,
          text: textOf(p), first_line: firstLine(textOf(p)), views: p.views, ratio: round(p.ratio, 1), viral_score: p.viralScore,
          duration: p.duration || null, taken_at: p.takenAt || null,
          suggest: kind === 'video' ? 'thread' : (p.duration && p.duration <= 140 ? 'video' : 'text')
        });
      });
    });
    rows.sort(function (a, b) { return b.ratio - a.ratio || (b.views || 0) - (a.views || 0); });
    return { accounts: own.filter(function (id) { return missing.indexOf(id) === -1; }), missing: missing, min_ratio: o.ownMin, posts: rows.slice(0, o.limit), total: rows.length,
      note: own.length ? null : 'No own accounts chosen yet: pick your Instagram, TikTok or YouTube accounts (rs:org.xIdeas.own).' };
  }

  /** Reddit demand: the chosen subreddits, else the ones in the X-niche folders, else every saved subreddit. */
  function redditDemand(lib, o) {
    var all = Object.keys(lib.accounts || {}).filter(function (id) { return platformOf(id, lib.accounts[id]) === 'reddit'; });
    var subs = o.subreddits.filter(function (id) { return all.indexOf(id) !== -1; });
    var how = 'chosen';
    if (!subs.length) {
      var org = lib.org || {};
      var folders = XG && XG.nicheFolders ? XG.nicheFolders(org) : [];
      var acc = org.accounts || {};
      subs = all.filter(function (id) { return acc[id] && folders.indexOf(acc[id].folder) !== -1; });
      how = 'niche-folders';
    }
    if (!subs.length) { subs = all; how = 'all'; }
    if (!subs.length) return { subreddits: [], scope: 'none', ideas: [], themes: [], note: 'No subreddits in the Library. Collect one (collect_subreddit or open it with OpenOutlier).' };
    var since = o.now - o.redditDays * DAY;
    var posts = [];
    subs.forEach(function (id) { posts = posts.concat(M.enrich(postsOf(lib, id), { now: o.now }).filter(function (p) { return !p.takenAt || p.takenAt >= since; })); });
    var res = M.contentIdeas(posts, { limit: o.limit, themes: 8 });
    return {
      subreddits: subs, scope: how, considered: posts.length,
      ideas: res.ideas.slice(0, o.limit).map(function (p) {
        return { source: 'reddit', subreddit: p.subreddit ? 'r/' + p.subreddit : p.owner, title: p.title, url: p.url || null, score: p.score, comments: p.comments, ratio: round(p.ratio, 1), need: p.needKind, taken_at: p.takenAt || null };
      }),
      themes: (res.themes || []).slice(0, 8).map(function (t) { return { theme: t.key, posts: t.count, median_ratio: round(t.medianRatio, 1) }; })
    };
  }

  /**
   * All three sources. lib = { accounts: { id: { posts, profile, platform } }, org }.
   * opts: { now, days, nicheMin, ownMin, own (ids; default rs:org.xIdeas.own), subreddits, limit, only: 'niche'|'own'|'reddit',
   *   exclude: X account ids left out of the niche (the user's own X account; profile.me is always left out) }.
   */
  function ideas(lib, opts) {
    opts = opts || {};
    lib = lib || { accounts: {}, org: {} };
    var s = settingsOf(lib.org);
    var o = {};
    for (var k in DEFAULTS) o[k] = opts[k] != null ? opts[k] : DEFAULTS[k];
    o.now = opts.now || Date.now();
    o.own = Array.isArray(opts.own) && opts.own.length ? opts.own : s.own;
    o.exclude = Array.isArray(opts.exclude) ? opts.exclude : [];
    o.subreddits = Array.isArray(opts.subreddits) && opts.subreddits.length ? opts.subreddits : s.subreddits;
    var out = { generated_at: new Date(o.now).toISOString() };
    if (!opts.only || opts.only === 'niche') out.niche = nicheOutliers(lib, o);
    if (!opts.only || opts.only === 'own') out.crossPlatform = ownOutliers(lib, o);
    if (!opts.only || opts.only === 'reddit') out.reddit = redditDemand(lib, o);
    out.rules = 'Starting points for the user\'s own posts. Niche outliers show what worked: link to them or take the idea, never copy or lightly reword the text (the draft strip checks similarity). Adapting the user\'s own Reels, Shorts and videos is their own content.';
    return out;
  }

  /** Candidate "own" accounts for the picker: Instagram, TikTok and YouTube accounts in the Library. */
  function ownCandidates(lib) {
    return Object.keys((lib && lib.accounts) || {}).filter(function (id) {
      var pl = platformOf(id, lib.accounts[id]);
      return pl === 'instagram' || pl === 'tiktok' || pl === 'youtube';
    }).map(function (id) { return { id: id, platform: platformOf(id, lib.accounts[id]), posts: postsOf(lib, id).length }; })
      .sort(function (a, b) { return b.posts - a.posts; });
  }

  return { ideas: ideas, nicheOutliers: nicheOutliers, ownOutliers: ownOutliers, redditDemand: redditDemand, settingsOf: settingsOf, setSettings: setSettings, ownCandidates: ownCandidates, platformOf: platformOf, DEFAULTS: DEFAULTS };
});
