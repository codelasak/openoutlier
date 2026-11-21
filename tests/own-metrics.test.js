// src/own-metrics.js (phase 2): aggregation, running totals, period comparisons, the YPP
// ETA with rolling windows, milestones.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const OM = require('../src/own-metrics.js');

/** Dense days from `from`, n of them, built by f(i). */
function days(from, n, f) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(Object.assign({ d: OM.addDays(from, i) }, f(i)));
  return out;
}

test('days, weeks and months', () => {
  assert.equal(OM.addDays('2026-02-27', 3), '2026-03-02');
  assert.equal(OM.diffDays('2026-01-01', '2026-12-31'), 364);
  assert.equal(OM.weekStart('2026-11-21'), '2026-11-16', 'Saturday → Monday');
  assert.equal(OM.weekStart('2026-11-16'), '2026-11-16');
  assert.equal(OM.weekStart('2026-11-22'), '2026-11-16', 'Sunday belongs to the week before');
  assert.equal(OM.monthStart('2026-11-21'), '2026-11-01');
  const filled = OM.fillDays([{ d: '2026-01-01', views: 5 }, { d: '2026-01-04', views: 2 }]);
  assert.deepEqual(filled.map((r) => [r.d, r.views]), [['2026-01-01', 5], ['2026-01-02', 0], ['2026-01-03', 0], ['2026-01-04', 2]]);
  assert.equal(filled[1].ctr, undefined, 'a missing day has no rates');
});

test('aggregate: sums for counts; CTR weighted by impressions, average view % by views, CPM by monetized playbacks; RPM from revenue', () => {
  const rows = [
    { d: '2026-11-16', views: 100, minutes: 300, impressions: 1000, ctr: 0.05, avg_pct: 40, subs_gained: 3, subs_lost: 1, revenue: 0.4, cpm: 10, monetized_playbacks: 40 },
    { d: '2026-11-17', views: 300, minutes: 600, impressions: 3000, ctr: 0.03, avg_pct: 60, subs_gained: 2, subs_lost: 0, revenue: 0.8, cpm: 6, monetized_playbacks: 120 },
    { d: '2026-11-23', views: 50, minutes: 100, impressions: 0, ctr: null, avg_pct: 50, subs_gained: 0, subs_lost: 2 }
  ];
  const w = OM.aggregate(rows, 'week');
  assert.deepEqual(w.map((b) => b.d), ['2026-11-16', '2026-11-23']);
  const a = w[0];
  assert.equal(a.views, 400);
  assert.equal(a.watch_hours, 15);
  assert.equal(a.subs_net, 4);
  assert.ok(Math.abs(a.ctr - (50 + 90) / 4000) < 1e-9, 'Σ clicks ÷ Σ impressions, not the mean of rates');
  assert.equal(a.avg_pct, 55);
  assert.equal(a.cpm, 7);
  assert.equal(OM.round(a.rpm, 2), 3);
  assert.equal(a.avg_dur, 900 * 60 / 400);
  assert.equal(w[1].ctr, null);
  assert.equal(w[1].subs_net, -2);
  assert.equal(OM.round(OM.value(a, 'ctr'), 6), 3.5, 'CTR is charted in percent');
  assert.equal(OM.aggregate(rows, 'month').length, 1);
});

test('cumulative: subscriber totals anchored at today\'s count; without an anchor they start at 0', () => {
  const rows = days('2026-11-01', 4, (i) => ({ subs_gained: [2, 0, 5, 1][i], subs_lost: [0, 1, 0, 0][i] }));
  OM.cumulative(rows, 'subs', 100);
  assert.deepEqual(rows.map((r) => r.subs_cum), [95, 94, 99, 100]);
  OM.cumulative(rows, 'subs', null);
  assert.deepEqual(rows.map((r) => r.subs_cum), [2, 1, 6, 7]);
  OM.cumulative(rows, 'subs', 3);
  assert.equal(rows[0].subs_cum, 0, 'never below zero');
});

test('compare: the last N days vs the N before; no percentage when the previous window is outside the history', () => {
  const rows = days('2026-09-01', 70, (i) => ({ views: i < 42 ? 10 : 20, minutes: 60, impressions: 100, ctr: i < 42 ? 0.04 : 0.05, subs_gained: 1, subs_lost: 0 }));
  const end = rows[rows.length - 1].d;
  const c = OM.compare(rows, end, 28, rows[0].d);
  assert.equal(c.covered, true);
  assert.equal(c.views.cur, 560);
  assert.equal(c.views.prev, 280);
  assert.equal(c.views.pct, 100);
  assert.equal(c.watch_hours.cur, 28);
  assert.equal(c.ctr.cur, 5);
  assert.equal(c.ctr.pct, 25);
  const long = OM.compare(rows, end, 90, rows[0].d);
  assert.equal(long.covered, false);
  assert.equal(long.views.pct, null);
  assert.equal(long.views.prev, null);
  assert.deepEqual(Object.keys(OM.comparisons(rows, end, rows[0].d)), ['7', '28', '90', '365']);
});

test('ETA, linear: subscribers at the recent pace', () => {
  assert.equal(OM.etaLinear(400, 1000, 10), 60);
  assert.equal(OM.etaLinear(400, 1000, 7), 86, 'rounded up');
  assert.equal(OM.etaLinear(1200, 1000, 0), 0, 'already there');
  assert.equal(OM.etaLinear(400, 1000, 0), null, 'not moving');
  assert.equal(OM.etaLinear(400, 1000, -2), null, 'losing subscribers');
});

test('ETA, rolling window: old days drop out of the 365-day window', () => {
  const end = '2026-11-20';
  // Steady 10 h/day for two years: 3,650 h in the window, never more: never 4,000 at this pace.
  const steady = days(OM.addDays(end, -729), 730, () => ({ v: 10 }));
  const a = OM.etaRolling(steady, { window: 365, target: 4000, end });
  assert.equal(a.current, 3650);
  assert.equal(a.pace_per_day, 10);
  assert.equal(a.days, null, 'the window drops a day for every day it adds');
  // Started 100 days ago at 12 h/day: nothing drops out for 265 days.
  const young = days(OM.addDays(end, -99), 100, () => ({ v: 12 }));
  const b = OM.etaRolling(young, { window: 365, target: 4000, end });
  assert.equal(b.current, 1200);
  assert.equal(b.days, Math.ceil((4000 - 1200) / 12), '234 days, all within the window');
  // A big month a year ago that is about to leave the window: the ETA has to wait for the pace to replace it.
  const spike = days(OM.addDays(end, -364), 365, (i) => ({ v: i < 30 ? 80 : 5 }));
  const c = OM.etaRolling(spike, { window: 365, target: 4000, end });
  assert.equal(c.current, 30 * 80 + 335 * 5);
  assert.equal(c.reached, true);
  const d = OM.etaRolling(spike, { window: 365, target: 4500, end });
  assert.equal(d.days, null, 'losing 80 h/day for a month at a 5 h/day pace never gets to 4,500');
  // Shorts: 90-day window.
  const shorts = days(OM.addDays(end, -89), 90, () => ({ v: 50000 }));
  const s = OM.etaRolling(shorts, { window: 90, target: 10e6, end });
  assert.equal(s.pct, 45);
  assert.equal(s.days, null, '50K/day caps at 4.5M in 90 days');
  const fast = days(OM.addDays(end, -89), 90, (i) => ({ v: i < 60 ? 20000 : 150000 }));
  assert.ok(OM.etaRolling(fast, { window: 90, target: 10e6, end }).days > 0);
});

test('YPP: both conditions, two paths, the best ETA; little history → no ETA', () => {
  const end = '2026-11-20';
  // 12 h a day for 200 days: 2,400 h; the first days only leave the window after 165 more days.
  const rows = days(OM.addDays(end, -199), 200, () => ({ minutes: 720, subs_gained: 3, subs_lost: 0 }));
  const y = OM.ypp({ rows, end, subs: 700, shorts: rows.map((r) => ({ d: r.d, v: 2000 })) });
  assert.equal(y.subs.days, 100);
  const watch = y.paths.find((p) => p.id === 'watch');
  assert.equal(watch.metric.current, 2400);
  assert.equal(watch.metric.days, Math.ceil(1600 / 12));
  assert.equal(watch.eta_days, 134, 'both conditions: the later one decides');
  const sh = y.paths.find((p) => p.id === 'shorts');
  assert.equal(sh.eta_days, null);
  assert.equal(y.best, 'watch');
  assert.equal(y.eta_days, 134);
  // At 10 h a day the same channel tops out at 3,650 h once its first days leave the window.
  const slow = OM.ypp({ rows: rows.map((r) => Object.assign({}, r, { minutes: 600 })), end, subs: 700 });
  assert.equal(slow.paths[0].metric.days, null);
  assert.equal(slow.eta_days, null);
  assert.equal(y.reached, false);
  const done = OM.ypp({ rows, end, subs: 1200 });
  assert.equal(done.subs.reached, true);
  const tiny = OM.ypp({ rows: rows.slice(-9), end, subs: 1 });
  assert.equal(tiny.enough_history, false);
  assert.equal(tiny.eta_days, null);
  assert.equal(tiny.subs.pct, 0.1);
});

test('milestones: reached with the day they happened, and the next one with progress', () => {
  const rows = days('2026-01-01', 300, (i) => ({ subs_gained: 2, subs_lost: 0, views: 50, minutes: 30 }));
  OM.cumulative(rows, 'subs', 600);
  OM.cumulative(rows, 'views', null);
  const m = OM.milestones({ rows, subs: 600, views: rows[rows.length - 1].views_cum, videos: [{ id: 'a', title: 'A', views: 12000, published_at: 2 }, { id: 'b', title: 'B', views: 1500, published_at: 1 }] });
  const keys = m.reached.map((x) => x.key);
  assert.deepEqual(keys.filter((k) => k.startsWith('subs')), ['subs:10', 'subs:100', 'subs:500']);
  const s500 = m.reached.find((x) => x.key === 'subs:500');
  assert.equal(rows.find((r) => r.d === s500.day).subs_cum >= 500, true);
  assert.equal(rows.find((r) => r.d === OM.addDays(s500.day, -1)).subs_cum < 500, true);
  assert.ok(keys.includes('views:10000'));
  assert.deepEqual(m.reached.filter((x) => x.kind === 'video').map((x) => [x.value, x.video.id]), [[1000, 'b'], [10000, 'a']], 'the first video past each mark');
  assert.ok(keys.includes('hours:100'));
  const next = Object.fromEntries(m.next.map((x) => [x.kind, x]));
  assert.equal(next.subs.value, 1000);
  assert.equal(next.subs.pct, 60);
  assert.equal(next.video.value, 100000);
  assert.equal(next.hours.value, 1000);
});
