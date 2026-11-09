const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const X = require('../src/extract.js');

const fixture = fs.readFileSync(path.join(__dirname, '..', 'dev', 'graphql', 'query.json'), 'utf8');

test('parses every reel from a clips connection response', () => {
  const posts = X.parseText(fixture);
  assert.equal(posts.length, 64);
  const p = posts[0];
  assert.equal(p.type, 'reel');
  assert.equal(p.owner, 'demo.kitchen');
  assert.match(p.url, /^https:\/\/www\.instagram\.com\/reel\/[\w-]+\/$/);
  assert.ok(p.views > 0 && p.likes > 0 && p.comments >= 0);
  assert.ok(p.takenAt > Date.UTC(2025, 0, 1));
  assert.ok(p.hashtags.length >= 1);
  assert.equal(p.files.length, 1);
  assert.equal(p.files[0].kind, 'video');
});

test('reads views from whichever counter field is filled', () => {
  const posts = X.parseText(fixture);
  assert.ok(posts.every((p) => p.views > 0), 'play_count:0 / null must fall back to ig_play_count');
});

test('detects pinned reels', () => {
  const posts = X.parseText(fixture);
  assert.equal(posts.filter((p) => p.pinned).length, 1);
});

test('handles the for(;;); prefix and line-delimited JSON', () => {
  const one = JSON.stringify({ data: { media: { code: 'ABCDE12', taken_at: 1700000000, media_type: 1, like_count: 5 } } });
  const two = JSON.stringify({ data: { media: { code: 'FGHIJ34', taken_at: 1700000100, media_type: 1, like_count: 7 } } });
  assert.equal(X.parseText('for (;;);' + one).length, 1);
  assert.equal(X.parseText(one + '\n' + two).length, 2);
  assert.deepEqual(X.parseText('not json'), []);
});

test('carousel posts expose one file per slide', () => {
  const carousel = {
    code: 'CARO1234', taken_at: 1700000000, media_type: 8, like_count: 10,
    carousel_media: [
      { media_type: 1, image_versions2: { candidates: [{ url: 'https://scontent.cdninstagram.com/a.jpg' }] } },
      { media_type: 2, video_versions: [{ url: 'https://scontent.cdninstagram.com/b.mp4' }] }
    ]
  };
  const p = X.parseMedia(carousel);
  assert.equal(p.type, 'carousel');
  assert.deepEqual(p.files.map((f) => f.kind), ['image', 'video']);
  assert.match(p.url, /\/p\/CARO1234\/$/);
});

test('ignores objects that only look like they have a code', () => {
  assert.equal(X.parseMedia({ code: 'ABCDEFG' }), null); // no media markers
  assert.equal(X.parseMedia({ code: 'x', taken_at: 1 }), null); // too short
  assert.equal(X.parseMedia({ code: 'ABCDEFG', taken_at: 1, extra: '<script>' }).caption, '');
});

test('legacy GraphQL shape (edge_*) is supported', () => {
  const legacy = {
    shortcode: 'LEGACY12', __typename: 'GraphVideo', is_video: true, taken_at_timestamp: 1600000000,
    video_view_count: 1234, edge_media_preview_like: { count: 50 }, edge_media_to_comment: { count: 3 },
    edge_media_to_caption: { edges: [{ node: { text: 'Hello #World #world #Ünicode' } }] }, owner: { username: 'Someone' }
  };
  const p = X.parseMedia(legacy);
  assert.equal(p.views, 1234);
  assert.equal(p.likes, 50);
  assert.equal(p.comments, 3);
  assert.equal(p.owner, 'someone');
  assert.deepEqual(p.hashtags, ['world', 'ünicode']);
});

test('merge keeps the highest counts and the newest file links', () => {
  const a = { code: 'AAAAAA', type: 'reel', views: 100, likes: 10, files: [{ kind: 'video', url: 'old' }], caption: 'x', pinned: true };
  const b = { code: 'AAAAAA', type: 'unknown', views: 150, likes: null, files: [{ kind: 'video', url: 'new' }], caption: '', pinned: false };
  const m = X.merge(a, b);
  assert.equal(m.views, 150);
  assert.equal(m.likes, 10);
  assert.equal(m.files[0].url, 'new');
  assert.equal(m.caption, 'x');
  assert.equal(m.type, 'reel');
  assert.equal(m.pinned, true);
});

test('shortcodeToPk decodes base64 shortcodes', () => {
  const enc = (n) => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'; let s = ''; while (n > 0n) { s = A[Number(n % 64n)] + s; n /= 64n; } return s; };
  const pk = 3500000000000000123n;
  assert.equal(X.shortcodeToPk(enc(pk)), pk.toString());
  assert.equal(X.shortcodeToPk('B'), null);
  assert.equal(X.shortcodeToPk('bad code!'), null);
});

test('parseMedia keeps the numeric media id', () => {
  assert.equal(X.parseMedia({ code: 'ABCDEFG', pk: '123', taken_at: 1 }).pk, '123');
  assert.equal(X.parseMedia({ code: 'ABCDEFG', id: '456_789', taken_at: 1 }).pk, '456');
});

test('a reel without its video link has no files (not its cover)', () => {
  const p = X.parseMedia({ code: 'NOVID123', taken_at: 1, media_type: 2, product_type: 'clips', image_versions2: { candidates: [{ url: 'https://x.cdninstagram.com/c.jpg' }] } });
  assert.deepEqual(p.files, []);
  assert.equal(p.thumb, 'https://x.cdninstagram.com/c.jpg');
});

test('another tab\'s copy never wipes stored reels (mergePostMaps)', () => {
  const stored = {};
  X.parseText(fixture).forEach((p) => { stored[p.code] = p; });
  const code = Object.keys(stored)[0];
  // A tab opened earlier saw one of these reels from the feed: fewer fields, a lower view count.
  const mine = { [code]: { code, owner: stored[code].owner, views: 5, likes: null, caption: '' } };
  const merged = X.mergePostMaps(stored, mine);
  assert.equal(Object.keys(merged).length, 64);
  assert.equal(merged[code].views, stored[code].views, 'counts keep their max');
  assert.equal(merged[code].caption, stored[code].caption, 'empty values do not erase');
  assert.ok(merged[code].takenAt && merged[code].files.length, 'dates and files kept');
});
