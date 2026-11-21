// OpenOutlier – own-channel history metrics (docs/youtube-niche-plan.md 3.2, phase 2).
//
// Pure functions over the daily rows the bridge keeps for a connected channel
// (own_daily, from the YouTube Analytics API), shared by the bridge
// (mcp/own-history.mjs), the MCP tools, the Library's Kanalım page and the tests.
// A daily row is
//   { d: 'YYYY-MM-DD', views, engaged, minutes, subs_gained, subs_lost, likes, comments,
//     shares, impressions, ctr (fraction), avg_pct, avg_dur (s), revenue, ad_revenue,
//     gross_revenue, cpm, playback_cpm, monetized_playbacks, ad_impressions }
// (any field may be missing). Days are Analytics days (Pacific time).
//
// • aggregate: daily → weekly (Monday) / monthly buckets; sums for counts, weighted
//   averages for CTR (by impressions), average view % (by views), CPM (by monetized
//   playbacks), and RPM = revenue ÷ views × 1000.
// • cumulative: running totals anchored at a known current total (subscribers from
//   the Data API), because Analytics only has gained / lost per day.
// • compare: the last N days against the N days before ("+34 % vs the previous 28 days").
// • YPP: 1,000 subscribers plus 4,000 watch hours in the last 365 days, or 10M Shorts
//   views in the last 90 days. The ETA keeps the recent pace and lets the rolling
//   windows drop their oldest days, so a channel whose old views fall out of the
//   365-day window can be told "not at this pace".
// • milestones: 100 / 500 / 1,000 … subscribers, total views, the first video past
//   1K / 10K / 100K views, watch hours.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpenOutlierOwnMetrics = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY_MS = 864e5;
  /** Fields that add up across days. */
  var ADD = ['views', 'engaged', 'minutes', 'subs_gained', 'subs_lost', 'likes', 'comments', 'shares', 'impressions',
    'revenue', 'ad_revenue', 'gross_revenue', 'monetized_playbacks', 'ad_impressions'];
  var YPP = { subs: 1000, hours: 4000, hoursWindow: 365, shorts: 10000000, shortsWindow: 90 };
  var MILESTONES = {
    subs: [10, 100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000],
    views: [1000, 10000, 100000, 1000000, 10000000, 100000000],
    video: [1000, 10000, 100000, 1000000],
    hours: [100, 1000, 4000, 10000]
  };
  var COMPARE_METRICS = ['views', 'watch_hours', 'subs_net', 'ctr', 'avg_pct', 'engaged', 'impressions', 'revenue', 'likes'];

  // ---- days ---------------------------------------------------------------------------
  function toMs(d) { return Date.parse(d + 'T00:00:00Z'); }
  function dayOf(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function addDays(d, n) { return dayOf(toMs(d) + n * DAY_MS); }
  function diffDays(a, b) { return Math.round((toMs(b) - toMs(a)) / DAY_MS); }
  /** Monday of the week (ISO weeks). */
  function weekStart(d) { var t = new Date(toMs(d)); var wd = (t.getUTCDay() + 6) % 7; return dayOf(toMs(d) - wd * DAY_MS); }
  function monthStart(d) { return d.slice(0, 7) + '-01'; }

  function median(list) {
    var a = (list || []).filter(function (x) { return x != null && isFinite(x); }).sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function num(v) { return v == null || v === '' || !isFinite(Number(v)) ? null : Number(v); }
  function round(v, n) { if (v == null) return null; var p = Math.pow(10, n || 0); return Math.round(v * p) / p; }

  /** Rows sorted by day, one per day from `from` to `to` (missing days count as zero views; ratios stay unknown). */
  function fillDays(rows, from, to) {
    var by = {};
    (rows || []).forEach(function (r) { if (r && r.d) by[r.d] = r; });
    var days = Object.keys(by).sort();
    from = from || days[0];
    to = to || days[days.length - 1];
    if (!from || !to || from > to) return [];
    var out = [];
    for (var d = from; d <= to; d = addDays(d, 1)) {
      var r = by[d];
      if (r) out.push(r);
      else { var z = { d: d, filled: true }; ADD.slice(0, 9).forEach(function (k) { z[k] = 0; }); out.push(z); }
      if (out.length > 20000) break;
    }
    return out;
  }

  /**
   * Running totals: rows get `subs` (and `views_cum` when asked). anchor = the current total
   * (at the last row); without one, the count starts at 0 on the first row.
   */
  function cumulative(rows, key, anchor, out) {
    out = out || key + '_cum';
    var net = function (r) { return key === 'subs' ? (num(r.subs_gained) || 0) - (num(r.subs_lost) || 0) : num(r[key]) || 0; };
    var total = 0;
    rows.forEach(function (r) { total += net(r); });
    var start = anchor != null ? anchor - total : 0;
    var run = start;
    rows.forEach(function (r) { run += net(r); r[out] = Math.max(0, run); });
    return rows;
  }

  /** One bucket from a list of daily rows. */
  function bucket(list, d) {
    var b = { d: d, days: list.length };
    ADD.forEach(function (k) {
      var s = null;
      list.forEach(function (r) { var v = num(r[k]); if (v != null) s = (s || 0) + v; });
      b[k] = s;
    });
    var wsum = function (val, w) {
      var top = 0; var bot = 0;
      list.forEach(function (r) { var v = num(r[val]); var ww = num(r[w]); if (v != null && ww) { top += v * ww; bot += ww; } });
      return bot ? top / bot : null;
    };
    b.ctr = wsum('ctr', 'impressions');
    b.avg_pct = wsum('avg_pct', 'views');
    b.cpm = wsum('cpm', 'monetized_playbacks');
    b.avg_dur = b.views ? (b.minutes || 0) * 60 / b.views : null;
    b.subs_net = b.subs_gained == null && b.subs_lost == null ? null : (b.subs_gained || 0) - (b.subs_lost || 0);
    b.watch_hours = b.minutes == null ? null : b.minutes / 60;
    b.rpm = b.revenue != null && b.views ? b.revenue / b.views * 1000 : null;
    var last = list[list.length - 1];
    if (last && last.subs_cum != null) b.subs = last.subs_cum;
    if (last && last.views_cum != null) b.views_total = last.views_cum;
    return b;
  }

  /** Daily rows → day / week / month buckets (oldest first). */
  function aggregate(rows, gran) {
    if (gran !== 'week' && gran !== 'month') return rows.map(function (r) { return bucket([r], r.d); });
    var keyOf = gran === 'week' ? weekStart : monthStart;
    var groups = [];
    var cur = null;
    rows.forEach(function (r) {
      var k = keyOf(r.d);
      if (!cur || cur.k !== k) { cur = { k: k, list: [] }; groups.push(cur); }
      cur.list.push(r);
    });
    return groups.map(function (g) { return bucket(g.list, g.k); });
  }

  /** A metric of a bucket, as charted: subs (total), subs_net, views, watch_hours, ctr (%), avg_pct … */
  function value(b, metric) {
    if (!b) return null;
    if (metric === 'ctr') return b.ctr == null ? null : b.ctr * 100;
    return b[metric] == null ? null : b[metric];
  }

  /** The rows of [end − days + 1, end]. */
  function windowRows(rows, end, days) {
    var from = addDays(end, -days + 1);
    return rows.filter(function (r) { return r.d >= from && r.d <= end; });
  }

  /**
   * The last `days` days (ending at `end`, the last day with data) vs the `days` before.
   * covered: the previous window lies inside the collected history (else pct is null:
   * a new channel isn't "+∞ %").
   */
  function compare(rows, end, days, firstDay) {
    var cur = bucket(windowRows(rows, end, days), end);
    var prevEnd = addDays(end, -days);
    var prev = bucket(windowRows(rows, prevEnd, days), prevEnd);
    var covered = !!firstDay && addDays(prevEnd, -days + 1) >= firstDay;
    var out = { days: days, end: end, covered: covered };
    COMPARE_METRICS.forEach(function (m) {
      var c = value(cur, m);
      var p = value(prev, m);
      var pct = covered && c != null && p ? (c - p) / Math.abs(p) * 100 : null;
      out[m] = { cur: c == null ? null : round(c, 3), prev: covered && p != null ? round(p, 3) : null, pct: pct == null ? null : round(pct, 1) };
    });
    return out;
  }

  /** compare() for the usual windows that fit the history (7 always, others when at least half covered). */
  function comparisons(rows, end, firstDay) {
    var out = {};
    [7, 28, 90, 365].forEach(function (n) { out[n] = compare(rows, end, n, firstDay); });
    return out;
  }

  // ---- ETA ----------------------------------------------------------------------------------
  /** Linear: days until `target` at `perDay` (null when not moving towards it). */
  function etaLinear(current, target, perDay) {
    if (current >= target) return 0;
    if (!(perDay > 0)) return null;
    return Math.ceil((target - current) / perDay);
  }

  /**
   * A rolling-window target (watch hours in 365 days, Shorts views in 90 days).
   * daily: [{ d, v }] dense up to `end`. The future keeps the pace of the last
   * `paceDays`; each simulated day drops the day leaving the window.
   * → { current, target, pct, pace_per_day, days (null = not within maxDays), reached }
   */
  function etaRolling(daily, opts) {
    var window = opts.window;
    var target = opts.target;
    var end = opts.end;
    var paceDays = opts.paceDays || 28;
    var maxDays = opts.maxDays || 1095;
    var by = {};
    daily.forEach(function (p) { by[p.d] = num(p.v) || 0; });
    var at = function (d) { return by[d] || 0; };
    var current = 0;
    for (var i = 0; i < window; i++) current += at(addDays(end, -i));
    var paceSum = 0;
    for (var j = 0; j < paceDays; j++) paceSum += at(addDays(end, -j));
    var pace = paceSum / paceDays;
    var out = { current: round(current, 1), target: target, pct: round(Math.min(1, current / target) * 100, 1), pace_per_day: round(pace, 2), days: null, reached: current >= target };
    if (out.reached) { out.days = 0; return out; }
    if (!(pace > 0)) return out;
    var total = current;
    for (var t = 1; t <= maxDays; t++) {
      var leaving = addDays(end, t - window); // the day that falls out of the window today
      total += pace - (leaving <= end ? at(leaving) : pace);
      if (total >= target) { out.days = t; return out; }
    }
    return out;
  }

  /**
   * YPP progress. rows: dense daily rows (with minutes) up to `end`; shorts: [{ d, v }] daily
   * Shorts views (null when unknown); subs: the current subscriber count; history: days collected.
   * → { subs, paths: [watch, shorts], best, eta_days, enough_history }
   */
  function ypp(opts) {
    var rows = opts.rows || [];
    var end = opts.end;
    var subs = opts.subs;
    var history = opts.historyDays == null ? rows.length : opts.historyDays;
    var enough = history >= 14;
    var paceDays = Math.max(7, Math.min(28, history));
    var net = 0;
    windowRows(rows, end, paceDays).forEach(function (r) { net += (num(r.subs_gained) || 0) - (num(r.subs_lost) || 0); });
    var subsPace = net / paceDays;
    var s = { current: subs, target: YPP.subs, pct: subs == null ? null : round(Math.min(1, subs / YPP.subs) * 100, 1), pace_per_day: round(subsPace, 3),
      days: subs == null ? null : etaLinear(subs, YPP.subs, subsPace), reached: subs != null && subs >= YPP.subs };
    var hours = etaRolling(rows.map(function (r) { return { d: r.d, v: (num(r.minutes) || 0) / 60 }; }), { window: YPP.hoursWindow, target: YPP.hours, end: end, paceDays: paceDays });
    var paths = [{ id: 'watch', subs: s, metric: Object.assign({ id: 'watch_hours' }, hours) }];
    if (opts.shorts) {
      var sv = etaRolling(opts.shorts, { window: YPP.shortsWindow, target: YPP.shorts, end: end, paceDays: paceDays });
      paths.push({ id: 'shorts', subs: s, metric: Object.assign({ id: 'shorts_views' }, sv) });
    }
    paths.forEach(function (p) {
      p.reached = s.reached && p.metric.reached;
      p.eta_days = !enough ? null : s.days == null || p.metric.days == null ? null : Math.max(s.days, p.metric.days);
    });
    var best = paths.slice().sort(function (a, b) {
      if (a.reached !== b.reached) return a.reached ? -1 : 1;
      if (a.eta_days == null) return b.eta_days == null ? (b.metric.pct || 0) - (a.metric.pct || 0) : 1;
      if (b.eta_days == null) return -1;
      return a.eta_days - b.eta_days;
    })[0];
    return { subs: s, paths: paths, best: best ? best.id : null, eta_days: best ? best.eta_days : null, reached: paths.some(function (p) { return p.reached; }), enough_history: enough, pace_days: paceDays };
  }

  // ---- milestones -----------------------------------------------------------------------------
  /**
   * rows: daily rows with subs_cum / views_cum / minutes; videos: [{ id, title, views }].
   * → { reached: [{ key, kind, value, day? , video? }], next: [{ key, kind, value, current, pct }] }
   */
  function milestones(opts) {
    var rows = opts.rows || [];
    var reached = [];
    var next = [];
    function scan(kind, steps, current, cumKey) {
      var nextDone = false;
      steps.forEach(function (v) {
        if (current != null && current >= v) {
          var hit = cumKey ? rows.filter(function (r) { return r[cumKey] != null && r[cumKey] >= v; })[0] : null;
          reached.push({ key: kind + ':' + v, kind: kind, value: v, day: hit ? hit.d : null });
        } else if (!nextDone) {
          nextDone = true;
          next.push({ key: kind + ':' + v, kind: kind, value: v, current: current == null ? null : round(current, 1), pct: current == null ? null : round(Math.min(1, current / v) * 100, 1) });
        }
      });
    }
    scan('subs', MILESTONES.subs, opts.subs, 'subs_cum');
    scan('views', MILESTONES.views, opts.views, 'views_cum');
    var hoursCum = 0;
    rows.forEach(function (r) { hoursCum += (num(r.minutes) || 0) / 60; r.hours_cum = hoursCum; });
    scan('hours', MILESTONES.hours, rows.length ? hoursCum : null, 'hours_cum');
    var vids = (opts.videos || []).filter(function (v) { return v && v.views != null; });
    var top = vids.reduce(function (a, b) { return !a || b.views > a.views ? b : a; }, null);
    MILESTONES.video.forEach(function (v) {
      var first = vids.filter(function (x) { return x.views >= v; }).sort(function (a, b) { return (a.published_at || 0) - (b.published_at || 0); })[0];
      if (first) reached.push({ key: 'video:' + v, kind: 'video', value: v, day: null, video: { id: first.id, title: first.title, views: first.views } });
    });
    var vNext = MILESTONES.video.filter(function (v) { return !top || top.views < v; })[0];
    if (vNext) next.push({ key: 'video:' + vNext, kind: 'video', value: vNext, current: top ? top.views : 0, pct: round(Math.min(1, (top ? top.views : 0) / vNext) * 100, 1), video: top ? { id: top.id, title: top.title } : null });
    rows.forEach(function (r) { delete r.hours_cum; });
    return { reached: reached, next: next };
  }

  return {
    ADD: ADD, YPP: YPP, MILESTONES: MILESTONES, COMPARE_METRICS: COMPARE_METRICS,
    addDays: addDays, diffDays: diffDays, weekStart: weekStart, monthStart: monthStart, dayOf: dayOf,
    median: median, round: round, fillDays: fillDays, cumulative: cumulative, bucket: bucket, aggregate: aggregate, value: value,
    windowRows: windowRows, compare: compare, comparisons: comparisons, etaLinear: etaLinear, etaRolling: etaRolling, ypp: ypp, milestones: milestones
  };
});
