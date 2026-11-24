// X idea sources (src/x-ideas.js, docs/x-plan.md 5.2): niche ≥3× outliers of the last 30 days, the user's own
// Reels / Shorts / YouTube outliers, and Reddit demand — all from the Library, nothing fetched.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../src/x-ideas.js');

const NOW = Date.UTC(2026, 10, 24, 12);
const DAY = 864e5;

function xAccount(id, n, bigViews, extra) {
  const posts = {};
  for (let i = 0; i < n; i++) {
    const code = String(2100000000000000000n + BigInt(id.length * 1000 + i));
    posts[code] = { code, platform: 'x', owner: id, author: id.slice(2), kind: 'original', type: 'text', views: i === 0 ? bigViews : 100 + i,
      takenAt: NOW - (i + 2) * DAY, caption: 'Post ' + i + ' by ' + id, url: 'https://x.com/' + id.slice(2) + '/status/' + code };
  }
  return Object.assign({ posts, platform: 'x', profile: { handle: id.slice(2) } }, extra || {});
}
function igAccount(id, n, bigViews) {
  const posts = {};
  for (let i = 0; i < n; i++) posts['ig' + i] = { code: 'ig' + i, owner: id, views: i === 0 ? bigViews : 1000 + i * 10, takenAt: NOW - (i + 1) * 3 * DAY, caption: 'Reel ' + i + '\nmore', duration: 30 };
  return { posts };
}
function redditAccount(id) {
  const sub = id.slice(2);
  const titles = ['How do I stop XLOOKUP returning #N/A?', 'Why is my pivot table not refreshing?', 'XLOOKUP vs INDEX MATCH, which one?', 'Look at my dashboard', 'Weekly thread', 'Pivot table stuck on old data, help?', 'My chart', 'Another chart'];
  const posts = {};
  titles.forEach((t, i) => { posts['r' + i] = { code: 'r' + i, platform: 'reddit', owner: id, subreddit: sub, title: t, score: i < 3 ? 400 - i * 50 : 20 + i, comments: 30, takenAt: NOW - (i + 1) * DAY, url: 'https://reddit.com/r/' + sub + '/' + i }; });
  return { posts, platform: 'reddit' };
}

function lib() {
  return {
    accounts: {
      'x/niche_a': xAccount('x/niche_a', 12, 5000),
      'x/niche_b': xAccount('x/niche_b', 12, 150),
      'x/other': xAccount('x/other', 12, 9000),
      'x/me': xAccount('x/me', 12, 9000, { profile: { handle: 'me', me: true } }),
      'handson.excel': igAccount('handson.excel', 10, 50000),
      'r/excel': redditAccount('r/excel')
    },
    org: {
      folders: [{ id: 'f1', name: 'Excel X' }],
      accounts: { 'x/niche_a': { folder: 'f1' }, 'x/niche_b': { folder: 'f1' }, 'x/me': { folder: 'f1' } },
      xNiche: { folders: ['f1'] },
      xIdeas: { own: ['handson.excel', 'yt/missing'] }
    }
  };
}

test('niche: only the X-niche folders, originals ≥3× in the last 30 days, never the own account', () => {
  const r = I.ideas(lib(), { now: NOW });
  assert.equal(r.niche.niche_marked, true);
  assert.equal(r.niche.accounts, 2, 'niche_a and niche_b (x/me is mine, x/other is outside the folder)');
  assert.deepEqual(r.niche.posts.map((p) => p.account), ['x/niche_a']);
  assert.ok(r.niche.posts[0].ratio >= 3);
  assert.match(r.niche.posts[0].url, /^https:\/\/x\.com\//);
  // Older than the window: gone.
  assert.equal(I.ideas(lib(), { now: NOW + 40 * DAY }).niche.posts.length, 0);
  // Without a marked folder: every X account except mine (and exclude).
  const l = lib(); delete l.org.xNiche;
  const all = I.ideas(l, { now: NOW, exclude: ['x/other'] });
  assert.equal(all.niche.niche_marked, false);
  assert.deepEqual(all.niche.posts.map((p) => p.account), ['x/niche_a']);
});

test('crossPlatform: the user\'s own outliers from rs:org.xIdeas.own, missing accounts reported', () => {
  const r = I.ideas(lib(), { now: NOW });
  assert.deepEqual(r.crossPlatform.accounts, ['handson.excel']);
  assert.deepEqual(r.crossPlatform.missing, ['yt/missing']);
  assert.equal(r.crossPlatform.posts[0].code, 'ig0');
  assert.equal(r.crossPlatform.posts[0].kind, 'reel');
  assert.equal(r.crossPlatform.posts[0].first_line, 'Reel 0');
  assert.ok(r.crossPlatform.posts.every((p) => p.ratio >= 2));
  const none = I.ideas(Object.assign(lib(), { org: {} }), { now: NOW, only: 'own' });
  assert.match(none.crossPlatform.note, /own accounts/);
  assert.equal(none.niche, undefined, 'only: one source');
  assert.deepEqual(I.ownCandidates(lib()).map((c) => c.id), ['handson.excel']);
});

test('reddit: questions and pain points that did well, with themes', () => {
  const r = I.ideas(lib(), { now: NOW, only: 'reddit' });
  assert.equal(r.reddit.scope, 'all');
  assert.deepEqual(r.reddit.subreddits, ['r/excel']);
  assert.ok(r.reddit.ideas.length >= 2);
  assert.ok(r.reddit.ideas.every((i) => i.need));
  assert.match(r.reddit.ideas[0].title, /\?/);
  const empty = I.ideas({ accounts: {}, org: {} }, { now: NOW, only: 'reddit' });
  assert.equal(empty.reddit.scope, 'none');
});

test('setSettings writes rs:org.xIdeas without touching the rest', () => {
  const org = lib().org;
  const next = I.setSettings(org, { own: ['a', 'a', 'yt/b'], subreddits: ['r/excel'] });
  assert.deepEqual(next.xIdeas, { own: ['a', 'yt/b'], subreddits: ['r/excel'] });
  assert.deepEqual(next.xNiche, org.xNiche);
  assert.deepEqual(org.xIdeas.own, ['handson.excel', 'yt/missing'], 'the input is not changed');
});
