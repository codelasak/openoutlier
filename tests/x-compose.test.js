// The pure part of the x.com draft strip (src/x-compose.js): checks as display rows, the data it feeds
// checkDraft, LLM examples, the preview and cost lines, the forecast line.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const XC = require('../src/x-compose.js');
const M = require('../src/metrics.js');

test('stripModel: count, remaining, findings in the UI language, similarity links', () => {
  const empty = XC.stripModel('', {}, 'en');
  assert.equal(empty.empty, true);
  assert.deepEqual(empty.findings, [], 'no "empty" row');

  const m = XC.stripModel('Like and retweet if you agree! https://example.com/page', {}, 'en');
  assert.equal(m.empty, false);
  assert.equal(m.limit, 280);
  assert.equal(m.weighted + m.remaining, 280);
  assert.ok(m.findings.some((f) => f.id === 'bait' && f.severity === 'warn' && /engagement bait/.test(f.text)));
  assert.ok(m.findings.some((f) => f.id === 'link'));
  const tr = XC.stripModel('Beğenin ve RT\'leyin, takip edin!', {}, 'tr');
  assert.ok(tr.findings.some((f) => f.id === 'bait' && /dilenme/.test(f.text)), 'Turkish text');

  const copied = 'The fastest way to clean a messy Excel table is Power Query, not formulas: three clicks and it refreshes.';
  const sim = XC.stripModel(copied, { recent: [{ id: '1', text: copied, url: 'https://x.com/a/status/1', author: 'a' }] }, 'en');
  const f = sim.findings.find((x) => x.id === 'similar');
  assert.ok(f, 'flags the copy');
  assert.equal(f.severity, 'warn');
  assert.equal(f.url, 'https://x.com/a/status/1');

  const long = 'word '.repeat(80);
  assert.equal(XC.stripModel(long, { premium: false }, 'en').over, true);
  assert.ok(XC.stripModel(long, { premium: false }, 'en').findings.some((x) => x.id === 'length-over' && x.severity === 'error'));
  assert.ok(!XC.stripModel(long, { premium: true }, 'en').findings.some((x) => x.severity === 'error'), 'Premium: a long post is fine');
  assert.equal(XC.stripModel(long, { premium: true }, 'en').hook.truncated, true);
});

test('swipeTexts / recentTexts: every platform in the swipe file, page + feed posts without own and reposts', () => {
  const org = { swipe: { items: {
    a: { platform: 'x', video: '123456', account: 'x/someone', title: 'A saved X post that is long enough to compare', channel: 'Someone' },
    b: { platform: 'youtube', video: 'abcdefghijk', title: 'A YouTube title that is long enough too', channel: 'Chan' },
    c: { platform: 'youtube', video: 'abcdefghijl', title: 'short' }
  } } };
  const sw = XC.swipeTexts(org);
  assert.equal(sw.length, 2);
  assert.equal(sw[0].url, 'https://x.com/someone/status/123456');
  assert.equal(sw[1].url, 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.deepEqual(XC.swipeTexts(null), []);

  const page = {
    1: { code: '1', owner: 'x/a', author: 'a', kind: 'original', caption: 'A post someone else wrote, seen on Home today' },
    2: { code: '2', owner: 'x/me', author: 'me', kind: 'original', caption: 'My own post must not count as "seen elsewhere"' },
    3: { code: '3', owner: 'x/b', author: 'b', kind: 'repost', caption: 'a repost of something that is long enough' }
  };
  const feed = { posts: { 1: page[1], 4: { code: '4', owner: 'x/c', author: 'c', kind: 'original', caption: 'From the niche list feed, long enough to compare' } } };
  const rc = XC.recentTexts(page, feed, 'x/me');
  assert.deepEqual(rc.map((r) => r.id).sort(), ['1', '4']);
  assert.equal(rc.find((r) => r.id === '1').url, 'https://x.com/a/status/1');
});

test('ownExamples: own originals at ≥2× their median, best first, at most 10', () => {
  const now = Date.now();
  const posts = [];
  for (let i = 0; i < 14; i++) {
    posts.push({ code: String(1e17 + i), platform: 'x', owner: 'x/me', kind: 'original', type: 'text', views: i < 3 ? 1000 * (i + 1) : 100, takenAt: now - (i + 2) * 864e5, caption: 'post ' + i });
  }
  posts.push({ code: '9', platform: 'x', owner: 'x/me', kind: 'reply', type: 'text', views: 99999, takenAt: now - 3 * 864e5, caption: 'a reply' });
  const ex = XC.ownExamples(posts, M, 10);
  assert.deepEqual(ex.map((e) => e.text), ['post 2', 'post 1', 'post 0']);
  assert.ok(ex[0].x >= 2);
  assert.deepEqual(XC.ownExamples([], M), []);
  assert.equal(XC.premiumOf({ blueVerified: true }), true);
  assert.equal(XC.premiumOf({}), null);
});

test('replaceFirstLine, previewInfo, costLine, forecastLine', () => {
  assert.equal(XC.replaceFirstLine('old hook\nbody\nmore', 'New hook'), 'New hook\nbody\nmore');
  assert.equal(XC.replaceFirstLine('one line', 'Other'), 'Other');

  const prep = { id: 'x', task: 'scoreDraft', preview: { model: 'claude-opus-5-5', effort: 'low', chars: 1234, context: 'voice', message: '<draft>hi</draft>' },
    estimate: { usdTypical: 0.0123, usdMax: 0.09, approx: true }, spend: { todayUsd: 0.2, capUsd: 1, calls: 3 } };
  const en = XC.previewInfo(prep, 'en');
  assert.match(en.summary, /1,234 characters to claude-opus-5-5/);
  assert.match(en.summary, /About \$0\.012, at most \$0\.090/);
  assert.match(en.spend, /\$0\.200 of the \$1\.00 daily cap, 3 calls/);
  assert.equal(en.message, '<draft>hi</draft>');
  assert.match(XC.previewInfo(prep, 'tr').summary, /karakter/);

  assert.equal(XC.costLine(null), '');
  assert.match(XC.costLine({ usd: 0.0042, tokens: { input: 900, cacheRead: 600, output: 120 } }, 'claude-opus-5-5'), /Cost \$0\.0042 · input 900 \(cache read 600\) · output 120 tokens · claude-opus-5-5/);

  assert.equal(XC.forecastLine({ shown: false }), null, 'nothing when it did not beat the median');
  assert.match(XC.forecastLine({ shown: true, views: 1200, low: 600, high: 2400, ratio: 1.3, drivers: [{ en: 'video', tr: 'video', effect: 1.8 }] }, 'en'), /Reach forecast: ~1,200 views \(600–2,400, ×1\.3 your median\) · video ×1\.8/);
});
