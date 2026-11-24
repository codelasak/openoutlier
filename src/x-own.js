// OpenOutlier – X "My account" (docs/x-plan.md section 3, Phase 2, feature x.own).
//
// Pure functions, shared by the service worker (src/x-own-bg.js), the x.com content script
// (src/x-own-content.js), the Library (dashboard/x-own-view.js), the bridge (mcp/x-own.mjs)
// and the tests. Nothing here talks to X: it reads what the user's own x.com tab already loaded.
//
// • parseOverview(raw): the stored accountOverviewDailyQuery response (x.com/i/account_analytics)
//   → verified followers, followers, daily Displayed (impressions) split by verified / not,
//   Follow / Unfollow and every other engagement type, by UTC day. Read defensively: the rows are
//   found wherever `current_time_series` sits, timestamps may be ms, s, or { iso8601_time }.
// • parseContent(raw): contentPageQuery (Analytics → Content). Its tweets_results shape has not
//   been seen yet (Faz 0), so every object with an id and numeric leaves is kept as-is.
// • mergeHistory(history, parsed): captures add up over time (a 7D capture after a 3M one keeps
//   the older days; a newer capture wins for the days it carries).
// • impressions90(days, now): Σ verified Displayed over the last 90 days. Always an UPPER BOUND of
//   what the program counts: Displayed may include replies and non-Home surfaces (Faz 0).
// • estimateFromPosts(posts, now): the fallback when analytics was never opened: Σ views of own
//   originals posted in the last 90 days (views ≠ verified Home impressions: also an upper bound).
// • rewardsProgress(...): verified followers /500 and 90-day verified impressions /500,000 with a
//   4-week pace and an ETA (OpenOutlierOwnMetrics.etaLinear / etaRolling, the YPP logic).
// • earlyCurve / earlyRatio: the account's usual views at 15 min … 48 h from its own measured posts
//   (x_post_stats / the local early series), through src/velocity.js.
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpenOutlierXOwn = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var DAY_MS = 864e5;
  var HOUR = 36e5;
  var OWN_KEY = 'rs:x-own';            // { handle } — the user's setting ("X kullanıcı adım")
  var HISTORY_KEY = 'rs:x-own:history'; // merged analytics days + snapshots (src/x-own-bg.js writes it)
  var EARLY_KEY = 'rs:x-own:early';     // { postId: { owner, takenAt, points: [{ ts, views }] } } for posts < 48 h
  var DEFAULT_HANDLE = 'heyEshagh';

  /**
   * Original Content Rewards eligibility, read 2026-11-24 (plan 3.2). One place to update when X
   * changes them. Replies don't count; only verified users' Home timeline impressions count.
   */
  var REWARDS = {
    checked: '2026-11-24',
    source: 'https://help.x.com/en/using-x/creator-revenue-sharing',
    verifiedFollowers: 500,
    impressions: 500000,
    windowDays: 90,
    paceDays: 28,
    premium: true,
    note: 'Needs X Premium (or Verified Organizations), 500 verified followers and 500K organic impressions from verified users on the Home timeline in the last 90 days; replies do not count.'
  };

  /** Early-hours checkpoints (hours). */
  var EARLY_CPS = [0.25, 0.5, 1, 2, 3, 6, 12, 24, 48];
  var EARLY_MIN_POSTS = 3;

  function OM() {
    var m = root && root.OpenOutlierOwnMetrics;
    if (!m && typeof require === 'function') { try { m = require('./own-metrics.js'); } catch (e) { m = null; } }
    return m;
  }
  function V() {
    var m = root && root.OpenOutlierVelocity;
    if (!m && typeof require === 'function') { try { m = require('./velocity.js'); } catch (e) { m = null; } }
    return m;
  }

  function num(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'object') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function dayOf(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function toMs(d) { return Date.parse(d + 'T00:00:00Z'); }
  function addDays(d, n) { return dayOf(toMs(d) + n * DAY_MS); }
  function round(v, n) { if (v == null) return null; var p = Math.pow(10, n || 0); return Math.round(v * p) / p; }
  function median(list) {
    var a = (list || []).filter(function (x) { return typeof x === 'number' && isFinite(x); }).sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function normHandle(h) { return String(h || '').trim().replace(/^@/, '').replace(/^x\//i, '').toLowerCase(); }
  function ownId(handle) { var h = normHandle(handle || DEFAULT_HANDLE); return h ? 'x/' + h : null; }

  /** ms from a timestamp that may be ms, seconds, an ISO string or { iso8601_time | ms | timestamp }. */
  function tsOf(t) {
    if (t == null) return null;
    if (typeof t === 'object') return tsOf(t.iso8601_time || t.ms || t.timestamp_ms || t.timestamp || t.value || null);
    var n = Number(t);
    if (isFinite(n) && n > 0) return n < 1e11 ? n * 1000 : n;
    var p = Date.parse(String(t));
    return isFinite(p) ? p : null;
  }
  function truthy(v) { return v === true || v === 'true' || v === 1 || v === '1'; }

  // ---- finding things in an unknown tree ------------------------------------------------------
  function walk(node, fn, depth, path) {
    if (!node || typeof node !== 'object' || (depth || 0) > 12) return;
    if (fn(node, path || '') === false) return;
    if (Array.isArray(node)) { for (var i = 0; i < node.length; i++) walk(node[i], fn, (depth || 0) + 1, path); return; }
    for (var k in node) if (node[k] && typeof node[k] === 'object') walk(node[k], fn, (depth || 0) + 1, (path ? path + '.' : '') + k);
  }
  function findKey(node, key) {
    var out;
    walk(node, function (o) { if (out === undefined && !Array.isArray(o) && key in o && o[key] != null) { out = o[key]; return false; } });
    return out;
  }
  /** data.viewer_v2.user_results.result, or the first object with rest_id, or the input. */
  function resultOf(raw) {
    var d = raw && raw.data ? raw.data : raw;
    var r = d && d.viewer_v2 && d.viewer_v2.user_results && d.viewer_v2.user_results.result;
    if (r) return r;
    var any = null;
    walk(d, function (o) { if (!any && !Array.isArray(o) && o.rest_id && (o.current_time_series || o.verified_follower_count != null || o.tweets_results)) { any = o; return false; } });
    return any || d || null;
  }

  // ---- accountOverviewDailyQuery --------------------------------------------------------------
  /** One time-series row → { type, verified, count, ts } or null. */
  function seriesRow(o) {
    if (!o || Array.isArray(o)) return null;
    var type = o.engagement_type || o.engagementType || o.metric_type || o.metricType || o.type;
    var ts = tsOf(o.timestamp != null ? o.timestamp : o.time != null ? o.time : o.date);
    var count = num(o.count != null ? o.count : o.value != null ? o.value : o.metric_value);
    if (!type || typeof type !== 'string' || ts == null || count == null) return null;
    var ver = o.is_engaging_user_verified != null ? o.is_engaging_user_verified : o.isEngagingUserVerified != null ? o.isEngagingUserVerified : o.verified;
    return { type: type, verified: ver == null ? null : truthy(ver), count: count, ts: ts };
  }

  var SKIP = { previous_totals: 1, hourly_backfill: 1, legacy_current_metrics: 1 };
  /**
   * → { restId, verifiedFollowers, followers, activeFollowers, days: { 'YYYY-MM-DD': { <type>: { v, u, n } } },
   *     from, to, types: [...], rows }  (n = rows whose verified flag was missing)
   */
  function parseOverview(raw, opts) {
    var r = resultOf(raw);
    var out = { restId: null, verifiedFollowers: null, followers: null, activeFollowers: null, days: {}, from: null, to: null, types: [], rows: 0 };
    if (!r || typeof r !== 'object') return out;
    out.restId = r.rest_id ? String(r.rest_id) : null;
    out.verifiedFollowers = num(r.verified_follower_count != null ? r.verified_follower_count : findKey(r, 'verified_follower_count'));
    var rc = r.relationship_counts || findKey(r, 'relationship_counts');
    out.followers = num(rc && rc.followers != null ? rc.followers : (r.legacy && r.legacy.followers_count));
    var raf = r.realtime_active_followers || findKey(r, 'realtime_active_followers');
    // Live shape (2026-11-24): { active_count: 36, is_approximate: false }.
    out.activeFollowers = num(raf && typeof raf === 'object' ? (raf.active_count != null ? raf.active_count : raf.count) : raf);
    var series = r.current_time_series || findKey(r, 'current_time_series');
    var rows = [];
    if (series) walk(series, function (o) { var x = seriesRow(o); if (x) { rows.push(x); return false; } });
    else walk(r, function (o, path) { if (SKIP[String(path).split('.').pop()]) return false; var x = seriesRow(o); if (x) { rows.push(x); return false; } });
    var types = {};
    rows.forEach(function (x) {
      var d = dayOf(x.ts);
      var day = out.days[d] || (out.days[d] = {});
      var t = day[x.type] || (day[x.type] = { v: 0, u: 0, n: 0 });
      if (x.verified === true) t.v += x.count; else if (x.verified === false) t.u += x.count; else t.n += x.count;
      types[x.type] = true;
      if (out.from == null || x.ts < out.from) out.from = x.ts;
      if (out.to == null || x.ts > out.to) out.to = x.ts;
    });
    out.rows = rows.length;
    out.types = Object.keys(types).sort();
    var range = rangeOf(opts && opts.vars);
    if (range) out.range = range;
    return out;
  }

  /** The requested range from the GraphQL variables (names unknown: any from/start + to/end time). */
  function rangeOf(vars) {
    if (!vars || typeof vars !== 'object') return null;
    var from = null;
    var to = null;
    walk(vars, function (o) {
      if (Array.isArray(o)) return;
      Object.keys(o).forEach(function (k) {
        var lk = k.toLowerCase();
        var t = typeof o[k] === 'object' ? null : tsOf(o[k]);
        if (t == null || t < 1.1e12) return; // only plausible times (after 2004)
        if (/from|start|since/.test(lk) && from == null) from = t;
        else if (/(^|_)to|end|until/.test(lk) && to == null) to = t;
      });
    });
    return from ? { from: from, to: to } : null;
  }

  // ---- contentPageQuery (shape unknown) -------------------------------------------------------
  /** → { posts: { id: { <metric>: n } }, count, shape: 'list' | 'unknown' } — never throws. */
  function parseContent(raw) {
    var out = { posts: {}, count: 0, shape: 'unknown' };
    try {
      var r = resultOf(raw);
      var tr = r && (r.tweets_results || findKey(r, 'tweets_results'));
      if (!tr) return out;
      walk(tr, function (o) {
        if (Array.isArray(o)) return;
        var id = o.rest_id || o.tweet_id || o.id_str || (o.legacy && o.legacy.id_str);
        if (!id || !/^\d{5,25}$/.test(String(id))) return;
        var m = {};
        walk(o, function (x, path) {
          if (Array.isArray(x)) {
            // [{ metric_type|engagement_type, metric_value|count }] lists
            x.forEach(function (it) { var s = seriesRow(Object.assign({ timestamp: 1.2e12 }, it)); if (s) m[s.type] = (m[s.type] || 0) + s.count; });
            return;
          }
          Object.keys(x).forEach(function (k) {
            var v = x[k];
            if (v == null || typeof v === 'object' || /(^|_)(id|id_str|rest_id|timestamp|time|created_at)$/i.test(k)) return;
            var n = typeof v === 'number' ? v : /^\d+(\.\d+)?$/.test(String(v)) ? Number(v) : null;
            if (n != null) m[(path ? path.split('.').pop() + '.' : '') + k] = n;
          });
        });
        if (Object.keys(m).length) { out.posts[String(id)] = m; out.shape = 'list'; }
        return false;
      });
      out.count = Object.keys(out.posts).length;
    } catch (e) { out.error = String(e && e.message || e); }
    return out;
  }

  // ---- history (merged captures) ----------------------------------------------------------------
  function emptyHistory() { return { restId: null, days: {}, snapshots: [], captures: [], content: null }; }

  /**
   * Merge one parsed capture (+ when it was saved) into the stored history. A newer capture
   * replaces the days it carries; older days stay. Snapshots: one per UTC day (the last one wins).
   */
  function mergeHistory(history, parsed, savedAt, extra) {
    var h = history && history.days ? JSON.parse(JSON.stringify(history)) : emptyHistory();
    if (!parsed) return h;
    var at = savedAt || Date.now();
    if (parsed.restId) {
      if (h.restId && h.restId !== parsed.restId) { h.otherAccount = { restId: parsed.restId, at: at }; return h; }
      h.restId = parsed.restId;
    }
    delete h.otherAccount;
    Object.keys(parsed.days || {}).forEach(function (d) { h.days[d] = parsed.days[d]; });
    var snap = { d: dayOf(at), at: at, verifiedFollowers: parsed.verifiedFollowers, followers: parsed.followers != null ? parsed.followers : extra && extra.followers != null ? extra.followers : null, activeFollowers: parsed.activeFollowers };
    h.snapshots = (h.snapshots || []).filter(function (s) { return s.d !== snap.d; }).concat([snap]).sort(function (a, b) { return a.at - b.at; }).slice(-400);
    var range = parsed.range || (parsed.from ? { from: parsed.from, to: parsed.to, fromRows: true } : null);
    h.captures = (h.captures || []).concat([{ at: at, rows: parsed.rows, from: range && range.from, to: range && range.to, fromRows: !!(range && range.fromRows) }]).slice(-50);
    // Keep about 400 days.
    var keys = Object.keys(h.days).sort();
    if (keys.length > 400) keys.slice(0, keys.length - 400).forEach(function (d) { delete h.days[d]; });
    return h;
  }

  /** The earliest day the captures are known to cover (the requested range when seen, else the first row). */
  function coveredFrom(h) {
    var min = null;
    (h && h.captures || []).forEach(function (c) { if (c.from && (min == null || c.from < min)) min = c.from; });
    if (min == null) { var ds = Object.keys(h && h.days || {}).sort(); if (ds.length) min = toMs(ds[0]); }
    return min == null ? null : dayOf(min);
  }

  function val(day, type, which) {
    var t = day && day[type];
    if (!t) return 0;
    if (which === 'v') return t.v || 0;
    if (which === 'u') return t.u || 0;
    return (t.v || 0) + (t.u || 0) + (t.n || 0);
  }

  /** Daily rows for display / the bridge: [{ d, imp_v, imp_u, follows, unfollows, follows_v, unfollows_v, types }]. */
  function dailyRows(days) {
    return Object.keys(days || {}).sort().map(function (d) {
      var x = days[d];
      return { d: d, imp_v: val(x, 'Displayed', 'v'), imp_u: val(x, 'Displayed', 'u') + ((x.Displayed && x.Displayed.n) || 0),
        follows: val(x, 'Follow'), unfollows: val(x, 'Unfollow'), follows_v: val(x, 'Follow', 'v'), unfollows_v: val(x, 'Unfollow', 'v'), types: x };
    });
  }

  /**
   * Σ Displayed in the window of `windowDays` ending today (UTC). → { verified, unverified, from, to,
   * days_with_data, covered_from, complete, upper_bound: true, source: 'analytics' }
   */
  function impressions90(history, now, windowDays) {
    var w = windowDays || REWARDS.windowDays;
    var end = dayOf(now || Date.now());
    var from = addDays(end, -(w - 1));
    var v = 0;
    var u = 0;
    var n = 0;
    Object.keys(history && history.days || {}).forEach(function (d) {
      if (d < from || d > end) return;
      var x = history.days[d];
      v += val(x, 'Displayed', 'v');
      u += val(x, 'Displayed', 'u') + ((x.Displayed && x.Displayed.n) || 0);
      if (x.Displayed) n++;
    });
    var cov = coveredFrom(history);
    return { verified: v, unverified: u, from: from, to: end, days_with_data: n, covered_from: cov, complete: !!cov && cov <= from,
      upper_bound: true, source: 'analytics' };
  }

  // ---- own posts ---------------------------------------------------------------------------------
  function kindOf(p) { return p.kind || (p.isRepost ? 'repost' : p.isReply ? 'reply' : 'original'); }
  /** Own posts split as plan 3.1 asks: originals (count for the program) and replies (they don't). */
  function splitOwn(posts) {
    var list = (posts || []).filter(Boolean).slice().sort(function (a, b) { return (b.takenAt || 0) - (a.takenAt || 0); });
    return {
      originals: list.filter(function (p) { return kindOf(p) === 'original'; }),
      replies: list.filter(function (p) { var k = kindOf(p); return k === 'reply' || k === 'thread-part'; }),
      reposts: list.filter(function (p) { return kindOf(p) === 'repost'; }).length
    };
  }

  /** Fallback: Σ views of own originals posted in the window. Not impressions; an upper-bound estimate. */
  function estimateFromPosts(posts, now, windowDays) {
    var w = windowDays || REWARDS.windowDays;
    var t = now || Date.now();
    var from = t - w * DAY_MS;
    var sum = 0;
    var n = 0;
    var noViews = 0;
    var daily = {};
    splitOwn(posts).originals.forEach(function (p) {
      if (!p.takenAt || p.takenAt < from || p.takenAt > t) return;
      if (p.views == null) { noViews++; return; }
      sum += p.views;
      n++;
      var d = dayOf(p.takenAt);
      daily[d] = (daily[d] || 0) + p.views;
    });
    return { verified: null, views: sum, posts: n, no_views: noViews, daily: daily, upper_bound: true, source: 'estimate_views',
      note: 'Views of your originals from the last ' + w + ' days. Views count every viewer and surface; the program counts only verified users\' Home impressions, so the real number is lower.' };
  }

  // ---- Original Content Rewards progress -------------------------------------------------------
  /**
   * opts: { history (merged analytics), posts (own posts), now, verifiedFollowers?, snapshots? }
   * → { requirements, verified_followers, impressions, eta_days, eta_date, reached, enough_history, notes }
   */
  function rewardsProgress(opts) {
    var o = opts || {};
    var now = o.now || Date.now();
    var h = o.history || emptyHistory();
    var om = OM();
    var end = dayOf(now);
    var paceDays = REWARDS.paceDays;
    var snaps = (o.snapshots || h.snapshots || []).filter(function (s) { return s && s.verifiedFollowers != null; }).sort(function (a, b) { return a.at - b.at; });
    var last = snaps[snaps.length - 1];
    var vf = o.verifiedFollowers != null ? o.verifiedFollowers : last ? last.verifiedFollowers : null;

    // Verified-follower pace: snapshots ≥ 14 days apart, else the analytics' verified Follow − Unfollow.
    var pace = null;
    var paceSource = null;
    var first = snaps.filter(function (s) { return now - s.at <= paceDays * DAY_MS * 1.5; })[0];
    if (first && last && last.at - first.at >= 14 * DAY_MS) {
      pace = (last.verifiedFollowers - first.verifiedFollowers) / ((last.at - first.at) / DAY_MS);
      paceSource = 'snapshots';
    } else {
      var cov = coveredFrom(h);
      var span = cov ? Math.min(paceDays, Math.round((toMs(end) - toMs(cov)) / DAY_MS) + 1) : 0;
      if (span >= 7) {
        var net = 0;
        for (var i = 0; i < span; i++) { var x = h.days[addDays(end, -i)]; if (x) net += val(x, 'Follow', 'v') - val(x, 'Unfollow', 'v'); }
        pace = net / span;
        paceSource = 'analytics_follows';
      }
    }
    var vfOut = { current: vf, target: REWARDS.verifiedFollowers, pct: vf == null ? null : round(Math.min(1, vf / REWARDS.verifiedFollowers) * 100, 1),
      pace_per_day: round(pace, 3), pace_per_week: pace == null ? null : round(pace * 7, 2), pace_source: paceSource,
      eta_days: vf == null ? null : vf >= REWARDS.verifiedFollowers ? 0 : om && pace != null ? om.etaLinear(vf, REWARDS.verifiedFollowers, pace) : null,
      reached: vf != null && vf >= REWARDS.verifiedFollowers };

    // Impressions: analytics when any capture exists, else the posts' views.
    var hasAnalytics = Object.keys(h.days || {}).length > 0 || (h.captures || []).length > 0; // a flagged other-account capture adds neither
    var imp;
    var daily;
    var historyDays;
    if (hasAnalytics) {
      var s = impressions90(h, now);
      daily = Object.keys(h.days).map(function (d) { return { d: d, v: val(h.days[d], 'Displayed', 'v') }; });
      var cf = coveredFrom(h);
      historyDays = cf ? Math.round((toMs(end) - toMs(cf)) / DAY_MS) + 1 : 0;
      imp = { current: s.verified, unverified: s.unverified, source: 'analytics', upper_bound: true, window_from: s.from, window_to: s.to, covered_from: s.covered_from, complete: s.complete,
        days_with_data: s.days_with_data,
        label: 'Upper bound: X\'s Displayed count from verified users (it may include replies and surfaces other than Home, which the program does not count).' };
    } else {
      var e = estimateFromPosts(o.posts || [], now);
      daily = Object.keys(e.daily).map(function (d) { return { d: d, v: e.daily[d] }; });
      var dated = splitOwn(o.posts || []).originals.filter(function (p) { return p.takenAt; }).map(function (p) { return p.takenAt; });
      historyDays = dated.length ? Math.min(365, Math.round((now - Math.min.apply(null, dated)) / DAY_MS) + 1) : 0;
      imp = { current: o.posts && o.posts.length ? e.views : null, unverified: null, source: e.source, upper_bound: true, posts: e.posts, no_views: e.no_views,
        label: 'Upper-bound estimate: ' + e.note + ' Open x.com/i/account_analytics (3M range) for the real verified count.' };
    }
    var pd = Math.max(7, Math.min(paceDays, historyDays || 0));
    var roll = om && imp.current != null ? om.etaRolling(daily, { window: REWARDS.windowDays, target: REWARDS.impressions, end: end, paceDays: pd }) : null;
    imp.target = REWARDS.impressions;
    imp.pct = imp.current == null ? null : round(Math.min(1, imp.current / REWARDS.impressions) * 100, 2);
    imp.pace_per_day = roll ? roll.pace_per_day : null;
    imp.pace_days = pd;
    imp.eta_days = roll ? roll.days : null;
    imp.reached = imp.current != null && imp.current >= REWARDS.impressions;

    var enough = (historyDays || 0) >= 14;
    var eta = !enough || vfOut.eta_days == null || imp.eta_days == null ? null : Math.max(vfOut.eta_days, imp.eta_days);
    var notes = [];
    if (!hasAnalytics) notes.push('No analytics captured yet: open x.com/i/account_analytics once with OpenOutlier on (choose 3M for the whole 90 days).');
    else if (!imp.complete) notes.push('The captured analytics start on ' + imp.covered_from + ', so the 90-day sum misses earlier days. Choose the 3M range on x.com/i/account_analytics.');
    if (h.otherAccount) notes.push('The last analytics capture belongs to another account (rest_id ' + h.otherAccount.restId + ') and was not counted.');
    if (vf == null) notes.push('Verified followers come from the analytics page; open it once.');
    if (!enough) notes.push('Under 14 days of history: no ETA yet.');
    return {
      requirements: { verified_followers: REWARDS.verifiedFollowers, verified_impressions_90d: REWARDS.impressions, window_days: REWARDS.windowDays, premium_required: REWARDS.premium,
        checked: REWARDS.checked, source: REWARDS.source, note: REWARDS.note },
      verified_followers: vfOut,
      impressions: imp,
      eta_days: eta,
      eta_date: eta == null ? null : addDays(end, eta),
      reached: vfOut.reached && imp.reached,
      enough_history: enough,
      history_days: historyDays || 0,
      notes: notes
    };
  }

  // ---- first hours -------------------------------------------------------------------------------
  /** Add a measurement to the local early series (posts < 48 h). Returns the new map (pruned). */
  function addEarly(map, p, now) {
    var t = now || Date.now();
    var out = {};
    Object.keys(map || {}).forEach(function (k) { var e = map[k]; if (e && e.takenAt && t - e.takenAt < 49 * HOUR) out[k] = e; });
    if (!p || p.views == null || !p.takenAt || t - p.takenAt >= 48 * HOUR) return out;
    var e = out[p.code] || { owner: p.owner, takenAt: p.takenAt, type: p.type, kind: kindOf(p), points: [] };
    var ts = p.seenAt || t;
    var lastPt = e.points[e.points.length - 1];
    if (!lastPt || (lastPt.views !== p.views && ts > lastPt.ts)) e.points = e.points.concat([{ ts: ts, views: p.views }]).slice(-200);
    out[p.code] = e;
    return out;
  }

  /**
   * The usual views at each early checkpoint, from measured posts: [{ takenAt, points: [{ ts, views }] }].
   * → { cps: { h: { value, n } }, posts }  (a checkpoint needs EARLY_MIN_POSTS posts measured around it)
   */
  function earlyCurve(list, opts) {
    var v = V();
    var cps = (opts && opts.cps) || EARLY_CPS;
    var minN = (opts && opts.minPosts) || EARLY_MIN_POSTS;
    var out = { cps: {}, posts: 0 };
    if (!v) return out;
    var at = {};
    (list || []).forEach(function (e) {
      if (!e || !e.takenAt || !e.points || !e.points.length) return;
      var c = v.checkpoints({ published_at: e.takenAt, points: e.points }, cps);
      var any = false;
      cps.forEach(function (h) { if (c[h] != null) { (at[h] = at[h] || []).push(c[h]); any = true; } });
      if (any) out.posts++;
    });
    cps.forEach(function (h) { if (at[h] && at[h].length >= minN) out.cps[h] = { value: median(at[h]), n: at[h].length }; });
    return out;
  }

  /** Expected views at age h from a curve (linear between known checkpoints, log-free). */
  function expectedAt(curve, h) {
    var pts = Object.keys(curve && curve.cps || {}).map(Number).sort(function (a, b) { return a - b; }).map(function (c) { return { h: c, v: curve.cps[c].value, n: curve.cps[c].n }; });
    if (!pts.length || h <= 0) return null;
    if (h <= pts[0].h) return { value: pts[0].v * h / pts[0].h, n: pts[0].n, at: pts[0].h };
    for (var i = 1; i < pts.length; i++) {
      if (h <= pts[i].h) {
        var a = pts[i - 1];
        var b = pts[i];
        return { value: a.v + (b.v - a.v) * (h - a.h) / (b.h - a.h), n: Math.min(a.n, b.n), at: b.h };
      }
    }
    return null; // past the last checkpoint we know
  }

  /**
   * How a young post is doing: views now ÷ the account's usual views at that age (curve), else ÷ its
   * median post's views (fallback, marked). → { ageMin, views, ratio, basis: 'curve' | 'median', expected, n } | null
   */
  function earlyRatio(post, curve, medianViews, now) {
    if (!post || post.views == null || !post.takenAt) return null;
    var t = post.seenAt && post.seenAt <= (now || Date.now()) ? post.seenAt : (now || Date.now());
    var h = (t - post.takenAt) / HOUR;
    if (h <= 0) return null;
    var e = expectedAt(curve, h);
    if (e && e.value > 0) return { ageMin: Math.round(h * 60), views: post.views, ratio: post.views / e.value, basis: 'curve', expected: Math.round(e.value), n: e.n };
    if (medianViews > 0) return { ageMin: Math.round(h * 60), views: post.views, ratio: post.views / medianViews, basis: 'median', expected: Math.round(medianViews), n: null };
    return null;
  }

  return {
    REWARDS: REWARDS, OWN_KEY: OWN_KEY, HISTORY_KEY: HISTORY_KEY, EARLY_KEY: EARLY_KEY, DEFAULT_HANDLE: DEFAULT_HANDLE, EARLY_CPS: EARLY_CPS,
    normHandle: normHandle, ownId: ownId, tsOf: tsOf, dayOf: dayOf, addDays: addDays, median: median,
    parseOverview: parseOverview, parseContent: parseContent, rangeOf: rangeOf,
    emptyHistory: emptyHistory, mergeHistory: mergeHistory, coveredFrom: coveredFrom, dailyRows: dailyRows, impressions90: impressions90,
    splitOwn: splitOwn, estimateFromPosts: estimateFromPosts, rewardsProgress: rewardsProgress,
    addEarly: addEarly, earlyCurve: earlyCurve, expectedAt: expectedAt, earlyRatio: earlyRatio
  };
});
