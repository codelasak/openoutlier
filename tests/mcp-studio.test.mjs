// The "My account" MCP tools (mcp/studio.mjs) against a stand-in chatmany worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'openoutlier-studio-'));
process.env.OPENOUTLIER_HOME = home;
const St = await import('../mcp/studio.mjs');

const NOW = Date.parse('2026-11-10T12:00:00Z');
const campaign = (over = {}) => ({
  campaign_id: 'bug-1', name: 'Excel Bug #1', media_id: 'm1', keywords: ['PRACTICE'], match: 'word', exclude: [],
  public_reply: { enabled: true, texts: ['Sent!'] }, check_follow: true, verify_follow: true, ask_email: false,
  reward: { type: 'link', value: 'https://x.test/if' }, copy: { opening: 'Hi', delivery: '{reward}' },
  active: true, archived: false, updated_at: 1, ...over
});

// ---- the stand-in worker ----
const state = { campaigns: [], archived: [], posts: [], uploads: [], calls: [], connected: true };
const worker = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const send = (body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.headers.authorization !== 'Bearer secret') return send({ error: 'unauthorized' }, 401);
  const key = req.method + ' ' + url.pathname;
  const body = req.headers['content-type'] === 'application/json' ? JSON.parse(raw.toString() || '{}') : null;
  if (req.method === 'POST') state.calls.push({ path: url.pathname, body, type: req.headers['content-type'], bytes: raw.length });
  switch (key) {
    case 'GET /api/status': return send(state.connected ? { connected: true, username: 'handson.excel', account_type: 'MEDIA_CREATOR', expires_in_days: 59, token_expired: false, poll_healthy: false, comment_poll_error: { at: 1, message: 'rate limited' } } : { connected: false });
    case 'GET /api/insights/account': return send({ days: Number(url.searchParams.get('days')), totals: { views: 393, reach: 346 }, errors: {} });
    case 'GET /api/media': return send({ media: [{ id: 'm1', caption: 'You need 50 to pass.\nMore', media_type: 'VIDEO', permalink: 'https://www.instagram.com/reel/DfhWg2QITjo/', timestamp: '2026-11-09T12:40:31+0000', like_count: 1, comments_count: 2 }] });
    case 'GET /api/insights': return send({ media: [{ id: 'm1', media_product_type: 'REELS', insights: { views: 218, reach: 190, saved: 3, shares: 0, likes: 1, comments: 2, ig_reels_avg_watch_time: 3307, ig_reels_video_view_total_time: 684747, reels_skip_rate: 82.3 } }] });
    case 'GET /api/campaigns': return send({ campaigns: url.searchParams.get('archived') ? state.archived : state.campaigns });
    case 'GET /api/dashboard': return send({ cards: { comments: 12, sends: 10, clicks: 6, follows: 5, emails: 0, delivered: 5 } });
    case 'GET /api/posts': return send({ posts: state.posts, storage: true, limit: { used: 2, total: 100 } });
    case 'POST /api/uploads': { const k = `key${state.uploads.length + 1}`; state.uploads.push({ key: k, type: req.headers['content-type'], bytes: raw.length }); return send({ key: k }); }
    case 'POST /api/posts': {
      const id = body.id || 'p' + (state.posts.length + 1);
      const row = { id, kind: body.kind, caption: body.caption, media: body.media.map((m) => ({ key: m.key, type: m.key === 'key1' && body.kind !== 'post' ? 'video' : 'image' })), options: body.options, scheduled_at: body.scheduled_at || Math.floor(Date.now() / 1000), status: 'scheduled', permalink: null, error: null, published_at: null };
      state.posts = state.posts.filter((p) => p.id !== id).concat(row);
      return send({ ok: true, id });
    }
    case 'POST /api/posts/delete': state.posts = state.posts.filter((p) => p.id !== body.id); return send({ ok: true });
    case 'POST /api/campaigns': {
      const c = { ...body.campaign, active: body.active, archived: false };
      state.campaigns = state.campaigns.filter((x) => x.campaign_id !== c.campaign_id).concat(c);
      return send({ ok: true, campaign_id: c.campaign_id });
    }
    case 'POST /api/campaigns/status':
    case 'POST /api/campaigns/archive':
    case 'POST /api/campaigns/delete': return send({ ok: true });
    default: return send({ error: 'not found' }, 404);
  }
});
await new Promise((r) => worker.listen(0, '127.0.0.1', r));
const cfg = { baseUrl: `http://127.0.0.1:${worker.address().port}`, token: 'secret' };
test.after(() => worker.close());
test.beforeEach(() => { state.campaigns = [campaign()]; state.archived = [campaign({ campaign_id: 'old', name: 'Old', archived: true, active: false })]; state.posts = []; state.uploads = []; state.calls = []; state.connected = true; });

const mp4 = join(home, 'reel.mp4');
const jpg = join(home, 'cover.jpg');
writeFileSync(mp4, Buffer.alloc(5000, 1));
writeFileSync(jpg, Buffer.alloc(900, 2));

test('config: missing settings explain how to set up; the file or the environment provides them', () => {
  assert.throws(() => St.loadConfig(), /chatmany\.json/);
  writeFileSync(St.CONFIG_FILE, JSON.stringify({ baseUrl: 'practice-dm.x.workers.dev/', token: ' t ' }));
  assert.deepEqual(St.loadConfig(), { baseUrl: 'https://practice-dm.x.workers.dev', token: 't' });
  process.env.OPENOUTLIER_CHATMANY_URL = 'http://127.0.0.1:9';
  assert.equal(St.loadConfig().baseUrl, 'http://127.0.0.1:9');
  delete process.env.OPENOUTLIER_CHATMANY_URL;
});

test('a wrong token and an unreachable worker are reported plainly', async () => {
  await assert.rejects(St.account({ ...cfg, token: 'nope' }), /did not accept the owner token/);
  await assert.rejects(St.account({ baseUrl: 'http://127.0.0.1:9', token: 'x' }), /Could not reach/);
});

test('my_account: totals, automation health with the reason, publishing quota', async () => {
  const a = await St.account(cfg, { days: 14 });
  assert.equal(a.username, 'handson.excel');
  assert.equal(a.automations_running, false);
  assert.equal(a.automations_problem, 'rate limited');
  assert.deepEqual(a.totals, { days: 14, views: 393, reach: 346 });
  assert.deepEqual(a.publishing, { ready: true, api_posts_used_today: 2, api_posts_allowed: 100 });
  state.connected = false;
  assert.equal((await St.account(cfg)).connected, false);
});

test('my_post_insights: watch time in seconds, skip rate, saves', async () => {
  const r = await St.postInsights(cfg);
  assert.equal(r.count, 1);
  assert.deepEqual(
    { ...r.posts[0], caption: undefined },
    { media_id: 'm1', code: 'DfhWg2QITjo', url: 'https://www.instagram.com/reel/DfhWg2QITjo/', type: 'reel', posted_at: '2026-11-09T12:40:31.000Z', views: 218, reach: 190, avg_watch_s: 3.3, total_watch_s: 685, skip_rate_pct: 82.3, likes: 1, comments: 2, saves: 3, shares: 0, caption: undefined, insights_error: undefined }
  );
  assert.equal(r.posts[0].caption, 'You need 50 to pass. More');
});

test('list_automations: where each runs, what it sends, its funnel; archived only on request', async () => {
  state.campaigns.push(campaign({ campaign_id: 'bug-2', name: 'Excel Bug #2', media_id: 'PENDING_bug-2', caption_match: 'Top seller gets the bonus', active: false }));
  const r = await St.automations(cfg);
  assert.deepEqual([r.count, r.running, r.archived_hidden], [2, 1, 1]);
  const [a, b] = r.automations;
  assert.deepEqual(a.runs_on, { media_id: 'm1', post: 'You need 50 to pass. More' });
  assert.deepEqual(a.funnel, { comments: 12, dms_sent: 10, button_clicks: 6, follows: 5, emails: 0, delivered: 5 });
  assert.deepEqual(a.steps, ['checks they follow', 'replies publicly']);
  assert.equal(a.messages, undefined);
  assert.deepEqual([b.state, b.runs_on], ['paused', { waiting_for_caption_starting: 'Top seller gets the bonus' }]);
  const all = await St.automations(cfg, { include_archived: true, details: true });
  assert.deepEqual(all.automations.map((x) => x.state), ['running', 'paused', 'archived']);
  assert.deepEqual(all.automations[0].messages, { opening: 'Hi', delivery: '{reward}' });
});

test('save_automation: changing one field leaves the rest of the stored automation as it was', async () => {
  const r = await St.saveAutomation(cfg, { automation_id: 'bug-1', reward_value: 'https://x.test/new' });
  assert.equal(r.created, false);
  const sent = state.calls.at(-1).body;
  const { active, archived, updated_at, ...stored } = campaign();
  assert.deepEqual(sent, { campaign: { ...stored, reward: { type: 'link', value: 'https://x.test/new' } }, active: true });
});

test('save_automation: create on a post, or waiting for a caption; errors say what is missing', async () => {
  const made = await St.saveAutomation(cfg, { name: 'Sort bug', media_id: 'm9', keywords: ['PRACTICE', 'practice'], reward_value: 'https://x.test/sort', public_replies: [], active: false });
  assert.equal(made.created, true);
  const c = state.calls.at(-1).body;
  assert.equal(c.active, false);
  assert.match(c.campaign.campaign_id, /^sort-bug-/);
  assert.deepEqual([c.campaign.media_id, c.campaign.keywords, c.campaign.public_reply.enabled], ['m9', ['PRACTICE'], false]);

  await St.saveAutomation(cfg, { automation_id: 'bug-1', caption_starts_with: 'Lena has Mei’s sales. Sorting broke the rows' });
  const moved = state.calls.at(-1).body.campaign;
  assert.equal(moved.media_id, 'PENDING_bug-1'); // left its old post, waits for the new one
  assert.equal(moved.caption_match, 'Lena has Mei’s sales. Sorting broke the rows');

  await assert.rejects(St.saveAutomation(cfg, { name: 'x', media_id: 'm9', reward_value: 'y' }), /keyword/);
  await assert.rejects(St.saveAutomation(cfg, { automation_id: 'nope', name: 'x' }), /no automation "nope"/);
  await assert.rejects(St.saveAutomation(cfg, { name: 'x', keywords: ['A'], reward_value: 'y', caption_starts_with: 'short' }), /caption/);
});

test('set_automation_state: each action calls the matching endpoint; unknown ids are refused', async () => {
  for (const [action, path, body] of [
    ['pause', '/api/campaigns/status', { campaign_id: 'bug-1', active: false }],
    ['resume', '/api/campaigns/status', { campaign_id: 'bug-1', active: true }],
    ['archive', '/api/campaigns/archive', { campaign_id: 'bug-1', archived: true }],
    ['delete', '/api/campaigns/delete', { campaign_id: 'bug-1' }]
  ]) {
    const r = await St.setAutomationState(cfg, { automation_id: 'bug-1', action });
    assert.deepEqual([r.done, r.name], [action, 'Excel Bug #1']);
    assert.deepEqual([state.calls.at(-1).path, state.calls.at(-1).body], [path, body]);
  }
  await St.setAutomationState(cfg, { automation_id: 'old', action: 'restore' });
  assert.deepEqual(state.calls.at(-1).body, { campaign_id: 'old', archived: false });
  const before = state.calls.length;
  await assert.rejects(St.setAutomationState(cfg, { automation_id: 'nope', action: 'delete' }), /no automation/);
  assert.equal(state.calls.length, before);
});

test('schedule_post: uploads the files, then queues with the time and options', async () => {
  const r = await St.schedulePost(cfg, { kind: 'reel', files: [mp4], cover_file: jpg, caption: ' Spot the bug ', automation_id: 'bug-1', show_in_grid: false, publish_at: '2026-11-12T18:00:00+03:00' }, NOW);
  assert.deepEqual(state.uploads, [{ key: 'key1', type: 'video/mp4', bytes: 5000 }, { key: 'key2', type: 'image/jpeg', bytes: 900 }]);
  assert.deepEqual(state.calls.at(-1).body, {
    kind: 'reel', caption: 'Spot the bug', media: [{ key: 'key1' }], scheduled_at: Date.parse('2026-11-12T15:00:00Z') / 1000,
    options: { share_to_feed: false, cover_key: 'key2', campaign_id: 'bug-1' }
  });
  assert.deepEqual([r.post_id, r.type, r.status, r.publish_at, r.attaches_automation], ['p1', 'Reel', 'scheduled', '2026-11-12T15:00:00.000Z', 'bug-1']);
  assert.match(r.note, /Scheduled/);
});

test('schedule_post: nothing is published without a time or an explicit publish_now', async () => {
  await assert.rejects(St.schedulePost(cfg, { kind: 'reel', files: [mp4] }, NOW), /Say when/);
  await assert.rejects(St.schedulePost(cfg, { kind: 'reel', files: [mp4], publish_now: true, publish_at: '2026-11-12T18:00:00Z' }, NOW), /not both/);
  await assert.rejects(St.schedulePost(cfg, { kind: 'reel', files: [mp4], publish_at: '2026-11-01T18:00:00Z' }, NOW), /has passed/);
  await assert.rejects(St.schedulePost(cfg, { kind: 'reel', files: [mp4], publish_at: 'tomorrow evening' }, NOW), /date and time/);
  assert.equal(state.uploads.length, 0);
  assert.equal(state.calls.length, 0);

  const r = await St.schedulePost(cfg, { kind: 'story', files: [jpg], caption: 'ignored', publish_now: true }, NOW);
  assert.deepEqual(state.calls.at(-1).body, { kind: 'story', caption: '', media: [{ key: 'key1' }], options: {}, scheduled_at: 0 });
  assert.match(r.note, /within a minute/);
});

test('schedule_post: bad input is refused before any upload', async () => {
  const cases = [
    [{ files: [mp4], publish_now: true }, /kind/],
    [{ kind: 'reel', files: [jpg], publish_now: true }, /exactly one video/],
    [{ kind: 'post', files: [mp4], publish_now: true }, /published as a reel/],
    [{ kind: 'reel', files: [join(home, 'missing.mp4')], publish_now: true }, /does not exist/],
    [{ kind: 'reel', files: ['reel.mp4'], publish_now: true }, /full path/],
    [{ kind: 'reel', files: [mp4], automation_id: 'nope', publish_now: true }, /no automation "nope"/],
    [{ kind: 'reel', publish_now: true }, /Choose the video/]
  ];
  for (const [input, re] of cases) await assert.rejects(St.schedulePost(cfg, input, NOW), re);
  assert.equal(state.uploads.length, 0);
});

test('schedule_post: changing a queued post keeps its uploaded files', async () => {
  await St.schedulePost(cfg, { kind: 'reel', files: [mp4], caption: 'v1', publish_at: '2026-11-12T18:00:00Z' }, NOW);
  const r = await St.schedulePost(cfg, { post_id: 'p1', caption: 'v2', publish_at: '2026-11-13T09:30:00Z' }, NOW);
  assert.equal(state.uploads.length, 1);
  const sent = state.calls.at(-1).body;
  assert.deepEqual([sent.id, sent.caption, sent.media, sent.scheduled_at], ['p1', 'v2', [{ key: 'key1' }], Date.parse('2026-11-13T09:30:00Z') / 1000]);
  assert.equal(r.caption, 'v2');
  await assert.rejects(St.schedulePost(cfg, { post_id: 'nope', caption: 'x' }, NOW), /no queued post/);
  state.posts[0].status = 'published';
  await assert.rejects(St.schedulePost(cfg, { post_id: 'p1', caption: 'x' }, NOW), /already published/);
});

test('list_scheduled_posts and cancel_scheduled_post', async () => {
  await St.schedulePost(cfg, { kind: 'reel', files: [mp4], caption: 'One', publish_at: '2026-11-12T18:00:00Z' }, NOW);
  state.posts.push({ id: 'done', kind: 'post', caption: 'Old', media: [{}, {}], options: {}, scheduled_at: 1, status: 'published', permalink: 'https://www.instagram.com/p/X/', published_at: 2, error: null });
  const q = await St.scheduledPosts(cfg);
  assert.deepEqual([q.count, q.api_posts_used_today, q.posts[0].type, q.posts[0].caption], [1, 2, 'Reel', 'One']);
  const all = await St.scheduledPosts(cfg, { include_published: true });
  assert.deepEqual(all.posts.map((p) => [p.type, p.status, p.url]), [['Reel', 'scheduled', undefined], ['Carousel (2)', 'published', 'https://www.instagram.com/p/X/']]);
  await St.cancelPost(cfg, { post_id: 'p1' });
  assert.equal((await St.scheduledPosts(cfg)).count, 0);
});
