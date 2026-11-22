// mcp/tracker.mjs with a fake clock and a fake YouTube API: schedule + jitter, feature
// gating, single flight, the cross-process lease, restart and crash safety, the daily
// quota budget, the heartbeat and the api-retention-30d purge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Nothing here may touch the real ~/.openoutlier.
process.env.OPENOUTLIER_HOME = mkdtempSync(join(tmpdir(), 'openoutlier-tracker-home-'));
delete process.env.OPENOUTLIER_YOUTUBE_API_KEY;
const { Store } = await import('../mcp/store.mjs');
const { Tracker, KINDS, nextQuotaDay, featureFlags } = await import('../mcp/tracker.mjs');
const { quotaOf } = await import('../mcp/youtube-api.mjs');

const MIN = 60_000;
const START = Date.UTC(2026, 10, 21, 12, 0, 0); // 04:00 in California

function clock(t = START) {
  const c = { t, now: () => c.t, advance: (ms) => { c.t += ms; } };
  return c;
}
const store = () => new Store(mkdtempSync(join(tmpdir(), 'openoutlier-tracker-')));
/** Deterministic "random": cycles through the given values. */
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };

/** A fake Data API: counts calls; channels.list costs 1 unit. */
function fakeApi() {
  const calls = [];
  return {
    calls,
    fetch: async (url) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ items: [{ id: 'UCdemo', statistics: { subscriberCount: '712000' } }] }) };
    }
  };
}

/** A job kind that uses the API (what phase 1's channel-stats job will look like). */
const apiKind = (extra = {}) => ({
  feature: 'tracker', every: 60 * MIN, jitter: 0, units: 1,
  async run(ctx, job) {
    const r = await ctx.fetch('https://www.googleapis.com/youtube/v3/channels?part=statistics&id=' + job.channel_id + '&key=' + ctx.apiKey);
    ctx.quota.spend(1);
    const j = await r.json();
    ctx.store.db.prepare('INSERT OR REPLACE INTO channel_stats (channel_id, day, subs, source) VALUES (?, ?, ?, ?)')
      .run(job.channel_id, new Date(ctx.now).toISOString().slice(0, 10), Number(j.items[0].statistics.subscriberCount), 'api');
    return { data: { subs: j.items[0].statistics.subscriberCount } };
  },
  ...extra
});

test('heartbeat: seeded once, runs when due, next run = every + jitter; nothing runs early', async () => {
  const s = store();
  s.setMeta('features', { 'channel-similar': false }); // phase 5's thumbnail index (on by default) isn't what these scheduler tests are about
  const c = clock();
  const tr = new Tracker({ store: s, now: c.now, random: seq(0.5), apiKey: () => null });
  tr.seed();
  tr.seed(); // idempotent
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM tracker_jobs').get().n, Object.values(KINDS).filter((k) => k.singleton && (!k.seedIf || k.seedIf())).length, 'own-channels waits for an OAuth client');
  const hb = tr.job('heartbeat');
  assert.equal(hb.next_at, START + 30_000, 'first run after half the jitter (random 0.5 × 60 s)');

  assert.deepEqual((await tr.tick()).ran, [], 'not due yet');
  c.advance(30_000);
  const r = await tr.tick();
  assert.deepEqual(r.ran, ['heartbeat']);
  const after = tr.job('heartbeat');
  assert.equal(after.runs, 1);
  assert.equal(after.last_ok, 1);
  assert.equal(after.next_at, c.t + 15 * MIN + 30_000);
  assert.deepEqual(s.getMeta('tracker_heartbeat'), { at: c.t, runs: 1, pid: process.pid });
  assert.deepEqual((await tr.tick()).ran, [], 'ran once, not again in the same minute');
  const st = tr.status();
  assert.equal(st.enabled, true);
  assert.equal(st.last_heartbeat_at, new Date(c.t).toISOString());
  assert.deepEqual(st.enabled_kinds, ['heartbeat', 'rss', 'digest', 'own-channels', 'own-backfill', 'own-daily', 'own-videos', 'own-weekly'], 'retention is off by default, API kinds need a key (RSS, the digest and the Analytics jobs don\'t)');
  s.close();
});

test('feature gating: a job of a switched-off feature waits (still due) and runs once it is on again', async () => {
  const s = store();
  s.setMeta('features', { 'channel-similar': false }); // phase 5's thumbnail index (on by default) isn't what these scheduler tests are about
  const c = clock();
  const tr = new Tracker({ store: s, now: c.now, random: () => 0, apiKey: () => null });
  tr.seed();
  s.setMeta('features', { tracker: false, 'channel-similar': false });
  assert.equal(featureFlags(s).tracker, false);
  assert.deepEqual((await tr.tick()).ran, []);
  assert.equal(tr.job('heartbeat').runs, 0);
  c.advance(2 * 60 * MIN);
  assert.deepEqual((await tr.tick()).ran, [], 'missed runs are not replayed while off');
  s.setMeta('features', { 'channel-similar': false }); // back to the default (on) for the tracker
  assert.deepEqual((await tr.tick()).ran, ['heartbeat'], 'runs once, right away');
  assert.deepEqual((await tr.tick()).ran, []);
  s.close();
});

test('single flight: overlapping ticks share one run', async () => {
  const s = store();
  const c = clock();
  let running = 0;
  let maxParallel = 0;
  let runs = 0;
  const kinds = { slow: { singleton: true, every: MIN, jitter: 0, units: 0, async run() { running++; maxParallel = Math.max(maxParallel, running); runs++; await new Promise((r) => setTimeout(r, 20)); running--; } } };
  const tr = new Tracker({ store: s, kinds, now: c.now, random: () => 0, apiKey: () => null });
  tr.seed();
  const [a, b, d] = [tr.tick(), tr.tick(), tr.tick()];
  assert.equal(a, b);
  assert.equal(b, d);
  await Promise.all([a, b, d]);
  assert.equal(runs, 1);
  assert.equal(maxParallel, 1);
  s.close();
});

test('lease: a second process waits while the first holds it, and takes over when it lapses', async () => {
  const s = store();
  s.setMeta('features', { 'channel-similar': false }); // phase 5's thumbnail index (on by default) isn't what these scheduler tests are about
  const c = clock();
  const one = new Tracker({ store: s, now: c.now, random: () => 0, apiKey: () => null, owner: 'daemon', leaseMs: 10 * MIN });
  const two = new Tracker({ store: s, now: c.now, random: () => 0, apiKey: () => null, owner: 'mcp-server', leaseMs: 10 * MIN });
  one.seed();
  assert.deepEqual((await one.tick()).ran, ['heartbeat']);
  c.advance(20 * MIN);
  const blocked = await two.tick();
  assert.equal(blocked.lease, true, 'the first lease lapsed after 10 min');
  assert.deepEqual(blocked.ran, ['heartbeat']);
  c.advance(MIN);
  const r = await one.tick();
  assert.equal(r.lease, false, 'now "mcp-server" holds it');
  assert.deepEqual(r.ran, []);
  two.stop(); // releases
  assert.equal((await one.tick()).lease, true);
  s.close();
});

test('restart: a new tracker on the same database keeps the schedule and picks up what is due', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openoutlier-tracker-restart-'));
  const c = clock();
  let s = new Store(dir);
  s.setMeta('features', { 'channel-similar': false }); // phase 5's thumbnail index (on by default) isn't what these scheduler tests are about
  const first = new Tracker({ store: s, now: c.now, random: () => 0, apiKey: () => null });
  first.seed();
  await first.tick();
  const next = first.job('heartbeat').next_at;
  first.stop();
  s.close();

  // The process dies; three hours later launchd starts a new one.
  c.advance(3 * 60 * MIN);
  s = new Store(dir);
  const second = new Tracker({ store: s, now: c.now, random: () => 0, apiKey: () => null });
  second.seed();
  assert.equal(second.job('heartbeat').next_at, next, 'seed keeps the existing schedule');
  const r = await second.tick();
  assert.deepEqual(r.ran, ['heartbeat'], 'one catch-up run, not twelve');
  assert.equal(second.job('heartbeat').runs, 2);
  s.close();
});

test('failures back off and are recorded; a crash mid-run is not retried in a loop', async () => {
  const s = store();
  const c = clock();
  let attempt = 0;
  const kinds = { flaky: { singleton: true, every: 60 * MIN, jitter: 0, units: 0, run() { attempt++; if (attempt < 3) throw new Error('YouTube said 503'); return { data: { ok: attempt } }; } } };
  const tr = new Tracker({ store: s, kinds, now: c.now, random: () => 0, apiKey: () => null });
  tr.seed();
  assert.deepEqual((await tr.tick()).failed, ['flaky']);
  let j = tr.job('flaky');
  assert.equal(j.fails, 1);
  assert.equal(j.last_ok, 0);
  assert.match(j.last_error, /503/);
  assert.equal(j.next_at, c.t + 2 * MIN, '1 min × 2^1');
  c.advance(2 * MIN);
  await tr.tick();
  j = tr.job('flaky');
  assert.equal(j.fails, 2);
  assert.equal(j.next_at, c.t + 4 * MIN);
  c.advance(4 * MIN);
  assert.deepEqual((await tr.tick()).ran, ['flaky']);
  j = tr.job('flaky');
  assert.equal(j.fails, 0);
  assert.equal(j.last_error, null);
  assert.deepEqual(j.data, { ok: 3 });
  assert.equal(j.next_at, c.t + 60 * MIN);

  // A job that never returns (the process is killed while it runs) was claimed first:
  // the row already points past its backoff, so a restart doesn't start it again at once.
  const hang = { singleton: true, every: 60 * MIN, jitter: 0, units: 0, run: () => new Promise(() => {}) };
  const s2 = store();
  const t2 = new Tracker({ store: s2, kinds: { hang }, now: c.now, random: () => 0, apiKey: () => null });
  t2.seed();
  t2.tick(); // never settles
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(t2.job('hang').next_at > c.t, 'claimed');
  assert.equal(t2.job('hang').last_run_at, c.t);
  const t3 = new Tracker({ store: s2, kinds: { hang }, now: c.now, random: () => 0, apiKey: () => null, owner: 'after-restart' });
  s2.setMeta('tracker_lease', null); // the dead process's lease
  assert.deepEqual((await t3.tick()).ran, []);
  s.close();
});

test('quota: API jobs need a key, count their units with the extension\'s, and wait for the Pacific reset past the budget', async () => {
  const s = store();
  const c = clock();
  const api = fakeApi();
  let key = null;
  const kinds = { channel: apiKind() };
  const tr = new Tracker({ store: s, kinds, now: c.now, random: () => 0, fetch: api.fetch, apiKey: () => key, budget: 5 });
  tr.schedule('channel:UCdemo', { kind: 'channel', channel_id: 'UCdemo', next_at: c.t });
  assert.deepEqual((await tr.tick()).ran, [], 'no key: no request');
  assert.equal(api.calls.length, 0);

  key = 'AIza' + 'k'.repeat(35);
  assert.deepEqual((await tr.tick()).ran, ['channel:UCdemo']);
  assert.equal(api.calls.length, 1);
  assert.match(api.calls[0], /channels\?part=statistics&id=UCdemo/);
  assert.equal(s.db.prepare("SELECT subs FROM channel_stats WHERE channel_id = 'UCdemo'").get().subs, 712000);
  assert.equal(quotaOf(s, c.t).bridge, 1);

  // The extension reports 3 units of its own: 1 + 3 = 4 of the budget of 5.
  s.setMeta('youtube_api_quota_ext', { day: quotaOf(s, c.t).day, units: 3 });
  assert.equal(tr.quota().used_today, 4);
  c.advance(60 * MIN);
  assert.deepEqual((await tr.tick()).ran, ['channel:UCdemo'], 'one unit left');
  c.advance(60 * MIN);
  const r = await tr.tick();
  assert.deepEqual(r.deferred, ['channel:UCdemo'], 'budget spent');
  assert.equal(api.calls.length, 2);
  const next = tr.job('channel:UCdemo').next_at;
  assert.equal(next, nextQuotaDay(c.t));
  // nextQuotaDay is the first hour of the next Pacific day.
  const pacific = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(t);
  assert.notEqual(pacific(next), pacific(c.t));
  assert.equal(pacific(next - 60 * MIN), pacific(c.t));
  c.t = next;
  assert.equal(tr.quota().used_today, 0, 'a new day');
  assert.deepEqual((await tr.tick()).ran, ['channel:UCdemo']);
  s.close();
});

test('api-retention-30d: the purge job runs only while the setting is on', async () => {
  const s = store();
  const c = clock();
  const tr = new Tracker({ store: s, now: c.now, random: () => 0, apiKey: () => null });
  tr.seed();
  s.addVideoStats([{ video_id: 'rivalVid01', ts: c.t - 40 * 864e5, views: 1, source: 'api' }, { video_id: 'rivalVid01', ts: c.t - 40 * 864e5 + 1, views: 1, source: 'rss' }]);
  let r = await tr.tick();
  assert.ok(!r.ran.includes('api-retention'), 'off by default: everything is kept');
  assert.equal(s.videoStats('rivalVid01').length, 2);
  s.setMeta('features', { 'api-retention-30d': true });
  r = await tr.tick();
  assert.ok(r.ran.includes('api-retention'));
  assert.deepEqual(s.videoStats('rivalVid01').map((x) => x.source), ['rss']);
  assert.deepEqual(tr.job('api-retention').data, { video_stats: 1, channel_stats: 0, sample_stats: 0 });
  assert.equal(tr.job('api-retention').next_at, c.t + 864e5);
  s.close();
});

test('start/stop: timers are unref\'d and stop releases the lease', async () => {
  const s = store();
  const tr = new Tracker({ store: s, random: () => 0, apiKey: () => null, tickMs: 50 });
  tr.start({ firstDelayMs: 0 });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(tr.job('heartbeat').runs, 1);
  assert.equal(tr.status().running_here, true);
  assert.equal(tr.status().lease_holder, tr.owner);
  tr.stop();
  assert.equal(tr.status().running_here, false);
  assert.equal(tr.status().lease_holder, null);
  s.close();
});
