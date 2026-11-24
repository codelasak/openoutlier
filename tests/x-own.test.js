// X Phase 2 (docs/x-plan.md section 3), the pure parts: the analytics parser (the Faz 0 shape from
// dev/x/accountOverviewDailyQuery.json plus defensive variants), merging captures, the 90-day verified
// sum and its upper-bound label, Original Content Rewards progress and ETA, the first-hours curve,
// and "what works" (post types, breakdowns, single-hit check, best hours).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const O = require('../src/x-own.js');
const P = require('../src/x-patterns.js');
const X = require('../src/x.js');
const M = require('../src/metrics.js');

const dir = join(__dirname, '..', 'dev', 'x');
const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
const NOW = meta.now;
const DAY = 864e5;
const page = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))[0];
const overview = page('accountOverviewDailyQuery.json');

function fixturePosts() {
  const all = [];
  for (const f of ['UserOriginalsTimeline.json', 'UserRepliesTimeline.json']) {
    for (const pg of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
      const r = X.parsePayload(pg.url, JSON.stringify(pg.body));
      all.push(...r.posts);
    }
  }
  return all;
}

test('parseOverview: the Faz 0 shape → verified followers, followers and daily Displayed split by verified', () => {
  const p = O.parseOverview(overview.body);
  assert.equal(p.restId, '1400000000000023757');
  assert.equal(p.verifiedFollowers, 9);
  assert.equal(p.followers, 80);
  assert.equal(p.activeFollowers, 36);
  assert.deepEqual(p.types, ['Displayed', 'Follow']);
  assert.equal(p.rows, 70);
  const days = Object.keys(p.days).sort();
  assert.equal(days.length, 30);
  const last = p.days[O.dayOf(NOW)];
  assert.deepEqual(last.Displayed, { v: 2, u: 5, n: 0 });
  assert.deepEqual(last.Follow, { v: 0, u: 1, n: 0 });
  // The sum of every verified Displayed row in the fixture.
  const v = overview.body.data.viewer_v2.user_results.result.current_time_series.filter((r) => r.engagement_type === 'Displayed' && r.is_engaging_user_verified === 'true').reduce((s, r) => s + Number(r.count), 0);
  assert.equal(Object.values(p.days).reduce((s, d) => s + (d.Displayed ? d.Displayed.v : 0), 0), v);
});

test('parseOverview reads defensively: seconds, ISO and nested timestamps, a nested series, no flag, and skips previous_totals', () => {
  const t = Date.UTC(2026, 10, 20, 0, 0, 0);
  const raw = { data: { viewer_v2: { user_results: { result: {
    rest_id: '42', verified_follower_count: 3,
    previous_totals: [{ engagement_type: 'Displayed', is_engaging_user_verified: 'true', count: '999', timestamp: String(t) }],
    current_time_series: { days: [
      { engagement_type: 'Displayed', is_engaging_user_verified: true, count: 4, timestamp: t / 1000 },
      { engagement_type: 'Displayed', is_engaging_user_verified: 'false', count: '6', timestamp: { iso8601_time: new Date(t).toISOString() } },
      { engagement_type: 'Displayed', count: '1', timestamp: String(t - DAY) },
      { engagement_type: 'Unfollow', is_engaging_user_verified: 'true', count: '1', timestamp: String(t - DAY) },
      { engagement_type: 'Displayed', is_engaging_user_verified: 'true', count: 'n/a', timestamp: String(t) },
      { nothing: true }
    ] } } } } } };
  const p = O.parseOverview(raw);
  assert.equal(p.verifiedFollowers, 3);
  assert.equal(p.rows, 4);
  assert.deepEqual(p.days['2026-11-20'].Displayed, { v: 4, u: 6, n: 0 });
  assert.deepEqual(p.days['2026-11-19'].Displayed, { v: 0, u: 0, n: 1 });
  assert.equal(p.days['2026-11-19'].Unfollow.v, 1);
  // Nothing usable: no throw, an empty result.
  assert.deepEqual(O.parseOverview(null).days, {});
  assert.deepEqual(O.parseOverview({ errors: [{ message: 'x' }] }).days, {});
  // The requested range from the GraphQL variables when it is there (names unknown).
  const r = O.parseOverview(raw, { vars: { requested_metrics: ['x'], from_time: '2026-08-22T00:00:00.000Z', to_time: '2026-11-20T00:00:00.000Z' } });
  assert.deepEqual(r.range, { from: Date.parse('2026-08-22T00:00:00.000Z'), to: Date.parse('2026-11-20T00:00:00.000Z') });
  assert.equal(O.rangeOf({ count: 20 }), null);
});

test('parseContent: unknown tweets_results shapes are kept as numbers per post id, never throws', () => {
  assert.deepEqual(O.parseContent(page('contentPageQuery.json').body), { posts: {}, count: 0, shape: 'unknown' });
  const guess = { data: { viewer_v2: { user_results: { result: { rest_id: '1', tweets_results: [
    { rest_id: '1900000000000000001', metrics: { impressions: '120', likes: 3, engagements: '9' }, created_at: 'x' },
    { result: { rest_id: '1900000000000000002', metric_values: [{ metric_type: 'Impressions', metric_value: '40' }, { metric_type: 'Likes', metric_value: '2' }] } },
    { rest_id: 'not-an-id', impressions: 5 }
  ] } } } } };
  const c = O.parseContent(guess);
  assert.equal(c.count, 2);
  assert.equal(c.posts['1900000000000000001']['metrics.impressions'], 120);
  assert.equal(c.posts['1900000000000000002'].Impressions, 40);
  assert.equal(O.parseContent({ data: { viewer_v2: 5 } }).count, 0);
});

test('mergeHistory: captures add up, newer days win, another account is flagged and not merged', () => {
  const p1 = O.parseOverview(overview.body);
  let h = O.mergeHistory(null, p1, NOW - DAY);
  assert.equal(Object.keys(h.days).length, 30);
  assert.equal(h.snapshots.length, 1);
  assert.equal(h.snapshots[0].verifiedFollowers, 9);
  // A later 7-day capture: today's count grew, a new verified follower; older days stay.
  const today = O.dayOf(NOW);
  const p2 = { restId: p1.restId, verifiedFollowers: 10, followers: 81, days: { [today]: { Displayed: { v: 7, u: 9, n: 0 } } }, rows: 2, from: NOW, to: NOW };
  h = O.mergeHistory(h, p2, NOW);
  assert.equal(Object.keys(h.days).length, 30);
  assert.deepEqual(h.days[today].Displayed, { v: 7, u: 9, n: 0 });
  assert.equal(h.snapshots.length, 2);
  assert.equal(h.captures.length, 2);
  const other = O.mergeHistory(h, Object.assign({}, p2, { restId: '999', days: { '2026-01-01': { Displayed: { v: 1e6, u: 0, n: 0 } } } }), NOW);
  assert.equal(other.otherAccount.restId, '999');
  assert.ok(!other.days['2026-01-01']);
});

test('impressions90: the verified sum of the last 90 days, always an upper bound, with coverage', () => {
  const h = O.mergeHistory(null, O.parseOverview(overview.body), NOW);
  const s = O.impressions90(h, NOW);
  assert.equal(s.upper_bound, true);
  assert.equal(s.source, 'analytics');
  assert.equal(s.to, O.dayOf(NOW));
  assert.equal(s.from, O.addDays(O.dayOf(NOW), -89));
  // The fixture holds days 0, 3 … 87 days back: all inside the window.
  const all = Object.values(h.days).reduce((t, d) => t + d.Displayed.v, 0);
  assert.equal(s.verified, all);
  assert.equal(s.days_with_data, 30);
  // It starts 87 days back (first row), so the 90 days are not fully covered.
  assert.equal(s.complete, false);
  // Days older than 90 drop out.
  const old = JSON.parse(JSON.stringify(h));
  old.days['2026-01-01'] = { Displayed: { v: 1000, u: 0, n: 0 } };
  assert.equal(O.impressions90(old, NOW).verified, all);
  assert.equal(O.impressions90(old, NOW).complete, false, 'coverage comes from the captures, not from stray days');
  old.captures.push({ at: NOW, from: Date.parse('2026-01-01T00:00:00Z') });
  assert.equal(O.impressions90(old, NOW).complete, true);
  assert.equal(O.impressions90(old, NOW).covered_from, '2026-01-01');
});

test('rewardsProgress: dated requirements, verified followers /500 and impressions /500K, 4-week pace and an ETA', () => {
  const t0 = Date.UTC(2026, 10, 24, 12);
  // 60 days of 3,000 verified impressions a day and one new verified follower every 2 days.
  const h = O.emptyHistory();
  for (let i = 0; i < 60; i++) {
    const d = O.addDays(O.dayOf(t0), -i);
    h.days[d] = { Displayed: { v: 3000, u: 9000, n: 0 }, Follow: { v: i % 2 ? 0 : 1, u: 2, n: 0 } };
  }
  h.captures.push({ at: t0, from: Date.parse(O.addDays(O.dayOf(t0), -59) + 'T00:00:00Z') });
  h.snapshots.push({ d: O.dayOf(t0), at: t0, verifiedFollowers: 100 });
  const pr = O.rewardsProgress({ history: h, now: t0 });
  assert.equal(pr.requirements.checked, '2026-11-24');
  assert.match(pr.requirements.source, /^https:\/\/help\.x\.com\//);
  assert.equal(pr.requirements.verified_followers, 500);
  assert.equal(pr.requirements.verified_impressions_90d, 500000);
  assert.equal(pr.verified_followers.current, 100);
  assert.equal(pr.verified_followers.pace_source, 'analytics_follows');
  assert.equal(pr.verified_followers.pace_per_day, 0.5);
  assert.equal(pr.verified_followers.eta_days, 800);          // (500 − 100) ÷ 0.5
  assert.equal(pr.impressions.current, 180000);               // 60 × 3,000
  assert.equal(pr.impressions.upper_bound, true);
  assert.equal(pr.impressions.source, 'analytics');
  assert.equal(pr.impressions.pace_per_day, 3000);
  // 180K + 3K a day with nothing leaving the 90-day window for 30 days: 500K after 107 days → no, the
  // window drops the first days after day 30, so it plateaus at 270K: not reachable at this pace.
  assert.equal(pr.impressions.eta_days, null);
  assert.equal(pr.eta_days, null);
  assert.equal(pr.enough_history, true);
  // Faster: 8,000 a day → 90 × 8,000 = 720K, reachable inside the window.
  Object.keys(h.days).forEach((d) => { h.days[d].Displayed.v = 8000; });
  const fast = O.rewardsProgress({ history: h, now: t0 });
  assert.equal(fast.impressions.current, 480000);
  assert.equal(fast.impressions.eta_days, 3);
  assert.equal(fast.eta_days, 800);                            // the slower of the two
  assert.equal(fast.eta_date, O.addDays(O.dayOf(t0), 800));
  // Snapshots ≥ 14 days apart win for the follower pace.
  h.snapshots.unshift({ d: O.addDays(O.dayOf(t0), -20), at: t0 - 20 * DAY, verifiedFollowers: 80 });
  const snap = O.rewardsProgress({ history: h, now: t0 });
  assert.equal(snap.verified_followers.pace_source, 'snapshots');
  assert.equal(snap.verified_followers.pace_per_day, 1);
  assert.equal(snap.verified_followers.eta_days, 400);
});

test('rewardsProgress without analytics: the fallback estimate from own originals\' views, labelled', () => {
  const posts = fixturePosts().filter((p) => p.owner === 'x/excelbugs_demo');
  const e = O.estimateFromPosts(posts, NOW);
  const want = posts.filter((p) => p.kind === 'original' && p.views != null && p.takenAt >= NOW - 90 * DAY && p.takenAt <= NOW).reduce((s, p) => s + p.views, 0);
  assert.equal(e.views, want);
  assert.equal(e.source, 'estimate_views');
  const pr = O.rewardsProgress({ history: null, posts, now: NOW });
  assert.equal(pr.impressions.source, 'estimate_views');
  assert.equal(pr.impressions.current, want);
  assert.equal(pr.impressions.upper_bound, true);
  assert.match(pr.impressions.label, /Upper-bound estimate/);
  assert.equal(pr.verified_followers.current, null);
  assert.ok(pr.notes.some((n) => /account_analytics/.test(n)));
  // Nothing at all: no crash, nulls.
  const none = O.rewardsProgress({});
  assert.equal(none.impressions.current, null);
  assert.equal(none.eta_days, null);
});

test('splitOwn: originals and replies (with thread parts) are two tables; reposts are only counted', () => {
  const posts = fixturePosts().filter((p) => p.owner === 'x/excelbugs_demo');
  const s = O.splitOwn(posts);
  assert.ok(s.originals.length > 10);
  assert.ok(s.originals.every((p) => p.kind === 'original'));
  assert.ok(s.replies.every((p) => p.kind === 'reply' || p.kind === 'thread-part'));
  assert.ok(s.originals[0].takenAt >= s.originals[s.originals.length - 1].takenAt, 'newest first');
});

test('first hours: the early series, the account curve at 15 min … 48 h, and "at minute 30 this post is at 1.8×"', () => {
  const H = 36e5;
  const t0 = Date.UTC(2026, 10, 1);
  // Five past posts, each measured at 15 / 30 / 60 / 120 min: 10, 20, 40, 80 views (×k).
  const list = [1, 1, 1, 2, 0.5].map((k, i) => ({ takenAt: t0 + i * DAY, points: [0.25, 0.5, 1, 2].map((h, j) => ({ ts: t0 + i * DAY + h * H, views: Math.round(10 * Math.pow(2, j) * k) })) }));
  const c = O.earlyCurve(list);
  assert.equal(c.posts, 5);
  assert.deepEqual(c.cps[0.5], { value: 20, n: 5 });
  assert.deepEqual(c.cps[2], { value: 80, n: 5 });
  assert.ok(!c.cps[24], 'no checkpoint without measurements around it');
  const young = { code: '1', views: 36, takenAt: NOW - 30 * 60000, seenAt: NOW };
  const r = O.earlyRatio(young, c, 200, NOW);
  assert.equal(r.ageMin, 30);
  assert.equal(r.basis, 'curve');
  assert.equal(r.expected, 20);
  assert.equal(Math.round(r.ratio * 10) / 10, 1.8);
  // No curve yet: the median post, marked.
  const m = O.earlyRatio(young, { cps: {} }, 20, NOW);
  assert.equal(m.basis, 'median');
  assert.equal(m.ratio, 1.8);
  assert.equal(O.earlyRatio({ views: null, takenAt: NOW }, c, 1, NOW), null);
  // The local early series: one point per change, posts over 48 h dropped.
  let e = O.addEarly({}, { code: 'a', owner: 'x/me', views: 5, takenAt: NOW - H, seenAt: NOW - 50 * 60000, kind: 'original' }, NOW);
  e = O.addEarly(e, { code: 'a', owner: 'x/me', views: 5, takenAt: NOW - H, seenAt: NOW - 40 * 60000 }, NOW);
  e = O.addEarly(e, { code: 'a', owner: 'x/me', views: 9, takenAt: NOW - H, seenAt: NOW - 30 * 60000 }, NOW);
  e = O.addEarly(e, { code: 'old', owner: 'x/me', views: 9, takenAt: NOW - 50 * H, seenAt: NOW }, NOW);
  assert.deepEqual(e.a.points.map((p) => p.views), [5, 9]);
  assert.ok(!e.old);
  assert.ok(!O.addEarly(e, null, NOW + 60 * H).a, 'pruned after 49 h');
});

test('postType: rule-based content types, else the format', () => {
  const t = (caption, extra) => P.postType(Object.assign({ caption, type: 'text', kind: 'original' }, extra || {}));
  assert.equal(t('What is your favourite Excel shortcut?'), 'question');
  assert.equal(t('Hangi formülü en çok kullanıyorsun?'), 'question');
  assert.equal(t('5 Excel tools I use daily:\n1. XLOOKUP\n2. LET\n3. LAMBDA\n4. FILTER'), 'list');
  assert.equal(t('The 3 Excel shortcuts nobody taught you'), 'list');
  assert.equal(t('How to remove duplicates in 10 seconds'), 'how-to');
  assert.equal(t('Just shipped v2.1 of OpenOutlier 🚀'), 'announcement');
  assert.equal(t('Yeni özellik yayında: X desteği'), 'announcement');
  assert.equal(t('Two years ago I quit my job to build this.'), 'story');
  assert.equal(t('Unpopular opinion: pivot tables are overrated'), 'opinion');
  assert.equal(t('Bence en iyi araç Power Query'), 'opinion');
  assert.equal(t('look', { type: 'image' }), 'image');
  assert.equal(t('', { type: 'video' }), 'video');
  assert.equal(t('this', { type: 'quote' }), 'quote');
  assert.equal(t('x', { type: 'thread', threadLength: 4 }), 'thread');
  assert.equal(t('x', { type: 'article' }), 'article');
  assert.equal(t('read this https://t.co/abc', { type: 'link' }), 'link');
  assert.equal(t('hmm'), 'other');
  assert.equal(t('hmm', { llmType: 'story' }), 'story', 'the LLM layer\'s guess wins');
});

test('features: length, first line, number start, emoji, link, language', () => {
  const f = P.features({ caption: '3 things I learned 🚀\nmore text here', lang: 'en', hasLink: true });
  assert.equal(f.startsWithNumber, true);
  assert.equal(f.emoji, true);
  assert.equal(f.link, true);
  assert.equal(f.lang, 'en');
  assert.equal(f.length, '<50');
  assert.equal(f.firstLine, '<40');
  assert.equal(P.features({ caption: 'Bugün çok güzel bir şey öğrendim', lang: 'und' }).lang, 'tr');
  assert.equal(P.features({ caption: 'This is how you do it', lang: 'qme' }).lang, 'en');
  assert.equal(P.features({ caption: '@someone thanks', lang: 'zxx' }).lang, 'other');
  assert.equal(P.features({ caption: 'x'.repeat(300) }).length, '281–999');
});

test('breakdown and patterns: each group against the account median with counts and the top 3', () => {
  const posts = [];
  const add = (n, caption, views, extra) => { for (let i = 0; i < n; i++) posts.push(Object.assign({ code: String(posts.length + 1), url: 'https://x.com/a/status/' + (posts.length + 1), kind: 'original', type: 'text', caption, views: views + i, takenAt: NOW - posts.length * 36e5 * 7 }, extra || {})); };
  add(6, 'What do you think about LAMBDA?', 100);
  add(4, 'How to use XLOOKUP', 400);
  add(2, 'Unpopular opinion: VBA is fine', 50);
  add(3, 'reply text', 10, { kind: 'reply' });
  add(2, 'no views', null, { views: null });
  const base = M.median(posts.filter((p) => p.kind === 'original' && p.views != null).map((p) => p.views));
  const types = P.breakdown(posts, P.postType);
  const q = types.find((g) => g.key === 'question');
  assert.equal(q.n, 6);
  assert.equal(q.median_views, 102.5);
  assert.equal(q.x, Math.round(102.5 / base * 100) / 100);
  assert.equal(q.top.length, 3);
  assert.equal(q.top[0].views, 105);
  const op = types.find((g) => g.key === 'opinion');
  assert.equal(op.x, null, 'under 3 posts: no ×');
  assert.equal(op.few, true);
  assert.ok(!types.some((g) => g.n === 3 && g.key === 'other'), 'replies are not in the breakdown');
  const pat = P.patterns(posts, { heatmap: false });
  assert.equal(pat.n, 12);
  assert.equal(pat.base_median, base);
  assert.equal(pat.replies.n, 3);
  assert.deepEqual(pat.lengths.map((g) => g.key), ['<50']);
  assert.deepEqual(pat.starts_with_number.map((g) => g.key), ['no']);
  assert.ok(pat.best_hours && pat.best_hours.hours.length === 8, 'the heatmap from metrics.js');
  assert.equal(pat.best_hours.heatmap, undefined);
  assert.equal(P.patterns(posts, { lang: 'tr' }).types.find((g) => g.key === 'question').label, 'Soru');
});

test('singleHit: median vs mean, "reach comes from a few posts", for any account', () => {
  const flat = Array.from({ length: 12 }, (_, i) => ({ kind: 'original', views: 100 + i }));
  const s1 = P.singleHit(flat);
  assert.equal(s1.warning, false);
  assert.match(s1.message, /^Steady/);
  const spiky = flat.concat([{ kind: 'original', views: 20000 }]);
  const s2 = P.singleHit(spiky);
  assert.equal(s2.warning, true);
  assert.equal(s2.median, 106);
  assert.ok(s2.mean_over_median > 10);
  assert.match(s2.message, /a few posts/);
  assert.ok(s2.top3_share > 0.9);
  assert.equal(P.singleHit([]).message, 'No originals with a view count.');
  // The fixture account (a real-looking spread) works too.
  const posts = M.enrich(fixturePosts().filter((p) => p.owner === 'x/excelbugs_demo'));
  const s3 = P.singleHit(posts);
  assert.ok(s3.n > 30 && s3.median > 0 && s3.mean > 0);
});
