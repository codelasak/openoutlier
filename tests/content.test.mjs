// Phase 4 on the bridge (mcp/content.mjs, mcp/cards.mjs): comments the extension captured (kept
// 7 days, then purged), get_comments (captured first, else commentThreads.list with the bridge's
// key, quota counted and budgeted, filters), sponsor_mentions over tracked channels' descriptions
// and the Library, the channel card, the watch page's title history, and migration 4.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

process.env.OPENOUTLIER_HOME = mkdtempSync(join(tmpdir(), 'openoutlier-content-home-'));
const { Store, SCHEMA_VERSION } = await import('../mcp/store.mjs');
const CO = await import('../mcp/content.mjs');
const C = await import('../mcp/cards.mjs');
const { quotaOf } = await import('../mcp/youtube-api.mjs');
const CT = createRequire(import.meta.url)('../src/content-tools.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const FX = join(HERE, '..', 'dev', 'youtube', 'content');
const H = 3_600_000;
const D = 24 * H;
const NOW = Date.UTC(2026, 10, 21, 12);
const KEY = 'AIza' + 'T'.repeat(35);
const VID = 'yTdemo00029';
const store = () => new Store(mkdtempSync(join(tmpdir(), 'openoutlier-content-')));
const captured = () => CT.parseComments(readFileSync(join(FX, 'next-comments.json'), 'utf8'), { lang: 'en' });

/** commentThreads.list stand-in: `pages` pages of 100 (or what's left of `total`). */
function fakeApi({ total = 250, error } = {}) {
  const calls = [];
  async function fetch(url) {
    calls.push(url);
    const u = new URL(url);
    if (error) return { ok: false, status: 403, json: async () => ({ error: { code: 403, message: error.message, errors: [{ reason: error.reason }] } }) };
    const page = Number(u.searchParams.get('pageToken') || 0);
    const n = Math.min(100, total - page * 100);
    const items = Array.from({ length: Math.max(0, n) }, (_, i) => {
      const k = page * 100 + i;
      return { id: 'th' + k, snippet: { channelId: 'UCdemoExcelChannel000000', videoId: u.searchParams.get('videoId'), totalReplyCount: k % 4,
        topLevelComment: { id: 'UgyApi' + String(k).padStart(4, '0'), snippet: { textOriginal: k % 10 === 0 ? 'How do I do this on a Mac?' : 'Comment number ' + k, textDisplay: 'x', authorDisplayName: '@user' + k,
          authorChannelId: { value: k === 5 ? 'UCdemoExcelChannel000000' : 'UCuser' + String(k).padStart(18, '0') }, likeCount: 1000 - k, publishedAt: '2026-11-1' + (k % 9) + 'T10:00:00Z' } } } };
    });
    return { ok: true, status: 200, json: async () => ({ items, nextPageToken: (page + 1) * 100 < total ? String(page + 1) : undefined }) };
  }
  return { fetch, calls };
}

test('migration 4: comment tables, descriptions, thumbnail snapshots', () => {
  const s = store();
  assert.equal(SCHEMA_VERSION, 4);
  assert.equal(Number(s.getMeta('schema_version')), 4);
  const cols = (t) => s.db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  assert.ok(cols('video_comments').includes('text') && cols('video_comments').includes('fetched_at'));
  assert.ok(cols('comment_sets').includes('total'));
  assert.ok(cols('tracked_videos').includes('description') && cols('tracked_videos').includes('thumb_snap'));
  assert.ok(cols('video_meta_log').includes('thumb_snap'));
  assert.equal(s.migrate(), 4, 'idempotent');
});

test('captured comments: stored per video, merged by id, purged after 7 days', () => {
  const s = store();
  const list = captured();
  assert.deepEqual(CO.putComments(s, { video: VID, title: 'XLOOKUP vs VLOOKUP', channel_id: 'UCdemoExcelChannel000000', total: 234, comments: list.slice(0, 10), now: NOW }), { ok: true, stored: 10, total: 234 });
  // The next batch as the user scrolls: overlaps by two, two have new like counts.
  const more = list.slice(8).map((c) => (c.id === 'UgxA000009' ? Object.assign({}, c, { likes: 99 }) : c));
  assert.equal(CO.putComments(s, { video: VID, comments: more, now: NOW + 60_000 }).stored, 15);
  const got = CO.storedComments(s, VID, NOW + 120_000);
  assert.equal(got.comments.length, 15);
  assert.equal(got.comments[0].id, 'UgxPin0001', 'YouTube\'s order is kept');
  assert.equal(got.comments.find((c) => c.id === 'UgxA000009').likes, 99);
  assert.equal(got.title, 'XLOOKUP vs VLOOKUP', 'a later batch without a title keeps it');
  assert.equal(got.total, 234);
  assert.equal(got.comments.find((c) => c.pinned).creator, true);
  // Bad input.
  assert.equal(CO.putComments(s, { video: 'nope', comments: list }).ok, false);
  assert.equal(CO.putComments(s, { video: 'yTdemo00035', comments: [{ id: 'x', text: 'too short id' }, { id: 'UgxOk00001', text: '   ' }], now: NOW }).stored, 0);
  // Seven days later the text is gone.
  assert.equal(CO.storedComments(s, VID, NOW + 7 * D + 2 * 60_000), null);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM video_comments').get().n, 0);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM comment_sets').get().n, 0);
});

test('get_comments: captured first, filters applied; no key and nothing captured → a clear hint', async () => {
  const s = store();
  CO.putComments(s, { video: VID, title: 'XLOOKUP vs VLOOKUP', total: 15, comments: captured(), now: NOW });
  const api = fakeApi();
  const r = await CO.getComments(s, { video: 'https://www.youtube.com/watch?v=' + VID + '&t=4s', key: KEY, fetch: api.fetch, now: NOW + 1000 });
  assert.equal(r.ok, true);
  assert.equal(r.source, 'captured');
  assert.equal(r.stored, 15);
  assert.equal(api.calls.length, 0, 'all 15 YouTube shows are captured: no API call');
  assert.equal(r.questions, 7);
  assert.equal(r.kept_until, new Date(NOW + 7 * D).toISOString());
  const q = await CO.getComments(s, { video: VID, questions: true, hide_profanity: true, sort: 'likes', key: null, now: NOW });
  assert.deepEqual(q.comments.map((c) => c.likes), [842, 311, 188, 96, 57, 22, 8]);
  assert.ok(q.comments.every((c) => c.is_question));
  const p = await CO.getComments(s, { video: VID, phrase: 'xlookup, vlookup', hide_profanity: true, key: null, now: NOW });
  assert.equal(p.hidden_profane, 1, 'the profane VLOOKUP rant is hidden');
  assert.equal(p.matched, 3);
  const none = await CO.getComments(store(), { video: VID, key: null, now: NOW });
  assert.deepEqual([none.ok, none.error], [false, 'no_comments']);
  assert.match(none.hint, /Comment tools/);
  assert.equal((await CO.getComments(s, { video: 'not a video' })).ok, false);
});

test('get_comments: commentThreads.list with the bridge key, 1 unit per 100, budget respected', async () => {
  const s = store();
  const api = fakeApi({ total: 250 });
  const r = await CO.getComments(s, { video: VID, max: 300, key: KEY, fetch: api.fetch, now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.source, 'api');
  assert.equal(r.stored, 250);
  assert.equal(r.units_spent, 3);
  assert.equal(api.calls.length, 3);
  assert.ok(api.calls.every((u) => u.includes('/commentThreads?') && u.includes('maxResults=100') && u.includes('textFormat=plainText')));
  assert.equal(quotaOf(s, NOW).bridge, 3, 'the shared quota counter');
  assert.equal(r.comments.find((c) => c.author === '@user5').by_creator, true);
  assert.equal(r.questions, 25);
  // A captured set that is smaller than YouTube's count: the API fills it in, both sources noted.
  const s2 = store();
  CO.putComments(s2, { video: VID, total: 234, comments: captured(), now: NOW });
  const r2 = await CO.getComments(s2, { video: VID, max: 120, key: KEY, fetch: fakeApi({ total: 120 }).fetch, now: NOW });
  assert.equal(r2.source, 'captured+api');
  assert.equal(r2.stored, 135);
  // Over the day's budget: nothing is fetched, captured ones answer with a note.
  const s3 = store();
  CO.putComments(s3, { video: VID, total: 234, comments: captured(), now: NOW });
  s3.setMeta('youtube_api_quota_ext', { day: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(NOW)), units: 9000 });
  const api3 = fakeApi();
  const r3 = await CO.getComments(s3, { video: VID, max: 200, key: KEY, fetch: api3.fetch, now: NOW });
  assert.equal(api3.calls.length, 0);
  assert.equal(r3.source, 'captured');
  assert.match(r3.note, /budget/);
  // Comments turned off on the video.
  const off = await CO.getComments(store(), { video: VID, key: KEY, fetch: fakeApi({ error: { reason: 'commentsDisabled', message: 'The video identified by the videoId parameter has disabled comments.' } }).fetch, now: NOW });
  assert.equal(off.ok, false);
  assert.equal(off.error, 'disabled');
});

function sponsorStore() {
  const s = store();
  const fx = JSON.parse(readFileSync(join(FX, 'descriptions.json'), 'utf8'));
  const chans = [...new Set(fx.map((d) => d.channel))];
  const id = (name) => ('UC' + name.normalize('NFD').replace(/[^A-Za-z]/g, '')).padEnd(24, 'x').slice(0, 24);
  chans.forEach((name, i) => s.db.prepare('INSERT INTO tracked_channels (channel_id, account_id, niche, mine, added_at, active, name) VALUES (?, ?, ?, 0, ?, 1, ?)')
    .run(id(name), 'yt/' + name.toLowerCase().replace(/\W/g, ''), i === 3 ? 'Turkish Excel' : 'Excel', NOW - 90 * D, name));
  fx.forEach((d, i) => s.db.prepare('INSERT INTO tracked_videos (video_id, channel_id, published_at, type, title, description, first_seen) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(('yTsp' + i).padEnd(11, 'x'), id(d.channel), NOW - (i + 1) * D, 'video', d.id, d.text, NOW));
  // One very old video (outside 365 days) and one from the Library only (a saved description).
  s.db.prepare('INSERT INTO tracked_videos (video_id, channel_id, published_at, type, title, description, first_seen) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('yTspOldxxxx', id('Excel Demo'), NOW - 500 * D, 'video', 'old', 'Sponsored by Squarespace: https://squarespace.com/exceldemo', NOW);
  s.mergePost('yt/exceldemo', 'yTspLibxxxx', { code: 'yTspLibxxxx', platform: 'youtube', type: 'video', owner: 'yt/exceldemo', caption: 'From the Library', takenAt: NOW - 3 * D,
    description: 'Thanks to NordVPN for sponsoring! https://nordvpn.com/exceldemo2 code EXCELDEMO for 70% off' }, { platform: 'youtube' });
  return { s, id };
}

test('sponsor_mentions: who promotes what across the tracked niche, one channel, a period', () => {
  const { s, id } = sponsorStore();
  const all = CO.sponsorMentions(s, { now: NOW });
  assert.equal(all.channels_scanned, 5);
  assert.equal(all.scanned, 14, '13 fixtures + the Library post; the 500-day-old video is outside 365 days');
  assert.deepEqual(all.brands.map((b) => b.key).sort(), ['ablebits', 'amazon', 'brilliant', 'hostinger', 'kutools', 'nordvpn', 'notion', 'skillshare']);
  const nord = all.brands.find((b) => b.key === 'nordvpn');
  assert.equal(nord.videos, 2, 'the tracked video and the Library post');
  assert.deepEqual(nord.codes, ['EXCELDEMO']);
  assert.match(nord.last_at, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(all.short_links, 1);
  assert.match(all.rules, /Rule-based/);
  const excel = CO.sponsorMentions(s, { niche: 'Excel', now: NOW });
  assert.ok(!excel.brands.some((b) => b.key === 'kutools'), 'the Turkish channel is in another niche');
  const long = CO.sponsorMentions(s, { days: 3650, now: NOW });
  assert.ok(long.brands.some((b) => b.key === 'squarespace'));
  const one = CO.sponsorMentions(s, { channel: id('Formül Okulu'), now: NOW });
  assert.deepEqual(one.brands.map((b) => b.key).sort(), ['hostinger', 'kutools']);
  assert.equal(CO.sponsorMentions(s, { channel: 'nope' }).error, 'Give a channel id (UC…).');
  // The channel page card.
  const card = CO.channelSponsors(s, { channel: id('Excel Demo'), now: NOW });
  assert.equal(card.tracked, true);
  assert.deepEqual(card.brands.map((b) => b.brand).sort(), ['NordVPN', 'Skillshare']);
  assert.ok(card.brands[0].example && card.brands[0].example.text);
  const untracked = CO.channelSponsors(s, { channel: 'UCnotTrackedxxxxxxxxxxxx', now: NOW });
  assert.deepEqual([untracked.tracked, untracked.scanned, untracked.brands.length], [false, 0, 0]);
});

test('title history on the watch card: changes newest first, VPH before / after, thumbnail snapshots', () => {
  const s = store();
  const CID = 'UChistoryTestChannel0001';
  const pub = NOW - 10 * D;
  s.db.prepare("INSERT INTO tracked_channels (channel_id, account_id, niche, mine, added_at, active) VALUES (?, 'yt/hist', 'Excel', 0, ?, 1)").run(CID, NOW - 60 * D);
  s.db.prepare('INSERT INTO tracked_videos (video_id, channel_id, published_at, type, first_seen) VALUES (?, ?, ?, ?, ?)').run('histVideoxx', CID, pub, 'video', pub);
  const stats = [];
  for (let h = 1; h <= 240; h += 1) stats.push({ video_id: 'histVideoxx', ts: pub + h * H, views: h <= 72 ? h * 100 : 7200 + (h - 72) * 400, source: 'api' });
  s.addVideoStats(stats);
  const log = s.db.prepare('INSERT INTO video_meta_log (video_id, ts, title, thumb_hash, thumb_snap, source) VALUES (?, ?, ?, ?, ?, ?)');
  log.run('histVideoxx', pub + H, 'Pivot tables for beginners', 'd:00000000000000ff', 'data:image/jpeg;base64,djE=', 'rss');
  log.run('histVideoxx', pub + 72 * H, 'Pivot tables: the ONE trick', 'd:00000000000000ff', 'data:image/jpeg;base64,djE=', 'rss');
  log.run('histVideoxx', pub + 120 * H, 'Pivot tables: the ONE trick', 'd:ffffffff00000000', 'data:image/jpeg;base64,djI=', 'rss');
  log.run('histVideoxx', NOW - 2 * H, 'Pivot tables in 10 minutes', 'd:ffffffff00000000', 'data:image/jpeg;base64,djI=', 'rss');
  const card = C.videoCard(s, { video: 'histVideoxx', now: NOW });
  assert.equal(card.history.length, 3);
  const [latest, thumb, title] = card.history;
  assert.deepEqual([latest.field, latest.before, latest.after, latest.vph_after], ['title', 'Pivot tables: the ONE trick', 'Pivot tables in 10 minutes', null], 'too recent for an "after"');
  assert.deepEqual([thumb.field, thumb.before_snap, thumb.after_snap], ['thumb', 'data:image/jpeg;base64,djE=', 'data:image/jpeg;base64,djI=']);
  assert.deepEqual([title.field, title.before, title.after], ['title', 'Pivot tables for beginners', 'Pivot tables: the ONE trick']);
  assert.equal(title.vph_before, 100);
  assert.equal(title.vph_after, 400, 'the retitle at 72 h: 100 → 400 views/h');
  assert.equal(C.videoCard(s, { video: 'unknownxxxx', now: NOW }).history, undefined, 'untracked videos have none');
});
