// My YouTube channel (phase 5): OAuth (PKCE, loopback to the bridge), the token
// file, YouTube Analytics reports and the bridge routes, all against a mocked
// Google. Nothing here talks to Google; see docs/youtube-plan.md phase 5 notes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, statSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const home = mkdtempSync(join(tmpdir(), 'openoutlier-yta-'));
const FIRST = 47971; // test port range, away from the real one and the other tests
Object.assign(process.env, { OPENOUTLIER_HOME: home, OPENOUTLIER_PORT: String(FIRST) });
for (const k of ['OPENOUTLIER_YOUTUBE_CLIENT_ID', 'OPENOUTLIER_YOUTUBE_CLIENT_SECRET']) delete process.env[k];
const YA = await import('../mcp/youtube-analytics.mjs');
const { startBridge } = await import('../mcp/bridge.mjs');

const CLIENT = { installed: { client_id: '1234-abc.apps.googleusercontent.com', client_secret: 'GOCSPX-test-secret', redirect_uris: ['http://localhost'] } };
const NOW = Date.UTC(2026, 10, 18, 12);
const vid = (i) => 'yTown' + String(i).padStart(6, '0');

/** A fake Google for OAuth + Analytics + Data API; logs requests. */
function fakeGoogle({ reachFails = false, refreshFails = false } = {}) {
  const calls = [];
  const res = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    const u = new URL(url);
    if (u.href.startsWith(YA.TOKEN_URL)) {
      const form = new URLSearchParams(init.body);
      if (form.get('grant_type') === 'authorization_code') {
        if (form.get('code') !== 'good-code') return res(400, { error: 'invalid_grant' });
        return res(200, { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3599, scope: YA.SCOPES.join(' '), token_type: 'Bearer' });
      }
      if (refreshFails) return res(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      return res(200, { access_token: 'at-2', expires_in: 3599 });
    }
    if (u.href.startsWith('https://oauth2.googleapis.com/revoke')) return res(200, {});
    assert.match(init.headers.authorization, /^Bearer at-/);
    if (u.pathname.endsWith('/channels')) return res(200, { items: [{ id: 'UC' + 'm'.repeat(22), snippet: { title: 'My Channel', customUrl: '@MyHandle', thumbnails: { medium: { url: 'https://yt3.ggpht.com/me.jpg' } } }, statistics: { subscriberCount: '1200', videoCount: '40' } }] });
    if (u.pathname.endsWith('/videos')) return res(200, { items: u.searchParams.get('id').split(',').map((id, i) => ({ id, snippet: { title: 'Video ' + id, publishedAt: '2026-10-0' + (i + 1) + 'T10:00:00Z' }, contentDetails: { duration: 'PT1M5S' } })) });
    if (u.origin + u.pathname === YA.REPORTS_URL) {
      const metrics = u.searchParams.get('metrics').split(',');
      const dim = u.searchParams.get('dimensions');
      const headers = (dim ? [dim] : []).concat(metrics).map((name) => ({ name, columnType: name === dim ? 'DIMENSION' : 'METRIC' }));
      if (metrics.includes('videoThumbnailImpressions')) {
        if (reachFails) return res(400, { error: { code: 400, message: 'The query is not supported.', errors: [{ reason: 'badRequest' }] } });
        return res(200, { columnHeaders: headers, rows: [[vid(1), 20000, 0.054], [vid(2), 5000, 0.031]] });
      }
      if (dim === 'video') return res(200, { columnHeaders: headers, rows: [
        [vid(1), 5000, 4200, 9000, 108, 46.3, 300, 20, 12, 40],
        [vid(2), 900, 700, 1200, 80, 61.2, 40, 2, 1, 3]
      ] });
      if (dim === 'elapsedVideoTimeRatio') {
        const rows = [];
        for (let i = 1; i <= 100; i++) rows.push([i / 100, i === 1 ? 1.05 : i < 10 ? 0.9 - i * 0.02 : Math.max(0.2, 0.75 - i * 0.005), 0.55]);
        return res(200, { columnHeaders: headers, rows });
      }
      return res(200, { columnHeaders: headers, rows: [[12000, 9000, 30000, 95, 48.2, 60, 5, 700, 40, 33]] });
    }
    return res(404, { error: { message: 'unexpected ' + url } });
  };
  return { fetch, calls };
}

test('without an OAuth client: off, with the setup steps; nothing is contacted', async () => {
  const st = await YA.status();
  assert.equal(st.configured, false);
  assert.match(st.hint, /Desktop app/);
  const r = await YA.beginConnect({ port: FIRST });
  assert.equal(r.ok, false);
  assert.equal(r.configured, false);
  await assert.rejects(YA.videoReport({ fetch: async () => { throw new Error('must not fetch'); } }), (e) => e.code === 'not_connected');
});

test('connect: PKCE + state + offline access to the bridge\'s loopback, then the callback stores a 0600 token', async () => {
  writeFileSync(YA.CONFIG_FILE, JSON.stringify(CLIENT));
  assert.equal(YA.loadClient().clientId, CLIENT.installed.client_id);
  const r = await YA.beginConnect({ port: FIRST, now: NOW });
  assert.equal(r.ok, true);
  const u = new URL(r.url);
  assert.equal(u.origin + u.pathname, YA.AUTH_URL);
  assert.equal(u.searchParams.get('redirect_uri'), `http://127.0.0.1:${FIRST}/youtube/oauth/callback`);
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.deepEqual(u.searchParams.get('scope').split(' '), YA.SCOPES);
  assert.ok(YA.SCOPES.every((s) => /readonly$/.test(s)), 'read-only scopes only');
  const state = u.searchParams.get('state');
  assert.ok(state.length >= 30);
  assert.ok(!r.url.includes('GOCSPX'), 'the client secret never goes into the browser URL');

  const g = fakeGoogle();
  // A forged state is refused, and nothing is exchanged.
  const forged = await YA.finishConnect(new URLSearchParams({ code: 'good-code', state: 'not-the-state' }), { fetch: g.fetch, now: NOW });
  assert.equal(forged.ok, false);
  assert.equal(g.calls.length, 0);

  const ok = await YA.finishConnect(new URLSearchParams({ code: 'good-code', state }), { fetch: g.fetch, now: NOW + 1000 });
  assert.equal(ok.ok, true, ok.error);
  assert.equal(ok.channel.title, 'My Channel');
  assert.equal(ok.channel.account, 'yt/myhandle');
  const form = new URLSearchParams(g.calls[0].init.body);
  assert.equal(form.get('grant_type'), 'authorization_code');
  assert.equal(form.get('redirect_uri'), `http://127.0.0.1:${FIRST}/youtube/oauth/callback`);
  // The verifier sent now matches the challenge sent to the browser earlier.
  const challenge = createHash('sha256').update(form.get('code_verifier')).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(challenge, u.searchParams.get('code_challenge'));
  assert.equal(statSync(YA.TOKEN_FILE).mode & 0o777, 0o600);
  const tok = JSON.parse(readFileSync(YA.TOKEN_FILE, 'utf8'));
  assert.equal(tok.refresh_token, 'rt-1');
  // The state is single-use.
  assert.equal((await YA.finishConnect(new URLSearchParams({ code: 'good-code', state }), { fetch: g.fetch, now: NOW + 2000 })).ok, false);
  const st = await YA.status();
  assert.equal(st.connected, true);
  assert.equal(st.channel.handle, 'MyHandle');
});

test('reports: per-video retention %, engaged views, impressions + CTR; channel totals; the retention curve', async () => {
  const g = fakeGoogle();
  const v = await YA.videoReport({ days: 28, fetch: g.fetch, now: NOW });
  assert.deepEqual(v.range, ['2026-10-21', '2026-11-18']);
  const main = new URL(g.calls.find((c) => c.url.includes('dimensions=video') && c.url.includes('engagedViews')).url);
  assert.equal(main.searchParams.get('ids'), 'channel==MINE');
  assert.equal(main.searchParams.get('sort'), '-views');
  for (const m of ['views', 'engagedViews', 'averageViewPercentage', 'averageViewDuration']) assert.ok(main.searchParams.get('metrics').split(',').includes(m), m);
  const reach = new URL(g.calls.find((c) => c.url.includes('videoThumbnailImpressions')).url);
  assert.equal(reach.searchParams.get('metrics'), 'videoThumbnailImpressions,videoThumbnailImpressionsClickRate');
  const a = v.videos[0];
  assert.equal(a.id, vid(1));
  assert.equal(a.title, 'Video ' + vid(1));
  assert.equal(a.duration_s, 65);
  assert.equal(a.views, 5000);
  assert.equal(a.engaged_views, 4200);
  assert.equal(a.avg_view_pct, 46.3);
  assert.equal(a.avg_view_duration_s, 108);
  assert.equal(a.impressions, 20000);
  assert.equal(a.ctr_pct, 5.4);
  assert.equal(a.subscribers_gained, 40);
  assert.equal(v.reach_error, undefined);

  const t = await YA.channelReport({ days: 28, fetch: g.fetch, now: NOW });
  assert.equal(t.engaged_views, 9000);
  assert.equal(t.avg_view_pct, 48.2);
  assert.equal(t.subscribers_lost, 5);

  const c = await YA.retention({ id: vid(1), fetch: g.fetch, now: NOW });
  const q = new URL(g.calls[g.calls.length - 1].url);
  assert.equal(q.searchParams.get('dimensions'), 'elapsedVideoTimeRatio');
  assert.equal(q.searchParams.get('filters'), 'video==' + vid(1));
  assert.equal(q.searchParams.get('metrics'), 'audienceWatchRatio,relativeRetentionPerformance');
  assert.equal(c.points.length, 100);
  assert.equal(c.summary.start, 1.05);
  assert.deepEqual(c.summary.rewatched_at, [0.01]);
  assert.ok(c.summary.at_50pct < c.summary.at_25pct);
  await assert.rejects(YA.retention({ id: 'bad id', fetch: g.fetch }), (e) => e.code === 'bad_id');

  // A refused reach query (thumbnail metrics) doesn't lose the rest.
  const g2 = fakeGoogle({ reachFails: true });
  const v2 = await YA.videoReport({ fetch: g2.fetch, now: NOW });
  assert.equal(v2.videos.length, 2);
  assert.equal(v2.videos[0].ctr_pct, null);
  assert.match(v2.reach_error, /not supported/);
});

test('tokens: refreshed when expired; a revoked sign-in says to reconnect; disconnect revokes and deletes', async () => {
  const g = fakeGoogle();
  await YA.channelReport({ fetch: g.fetch, now: NOW + 2 * 3600e3 });
  const ref = g.calls.find((c) => c.url === YA.TOKEN_URL);
  assert.equal(new URLSearchParams(ref.init.body).get('grant_type'), 'refresh_token');
  assert.equal(JSON.parse(readFileSync(YA.TOKEN_FILE, 'utf8')).access_token, 'at-2');

  const bad = fakeGoogle({ refreshFails: true });
  await assert.rejects(YA.channelReport({ fetch: bad.fetch, now: NOW + 10 * 3600e3 }), (e) => e.code === 'reconnect' && /7-day/.test(e.message));
});

test('bridge: the Google callback page and the extension-only analytics routes', async () => {
  const b = await startBridge();
  assert.equal(b.port, FIRST);
  try {
    const health = await (await fetch(`http://127.0.0.1:${FIRST}/health`)).json();
    assert.ok(health.features.includes('youtube-analytics'));
    // Websites can't use the analytics routes (no extension Origin).
    const web = await fetch(`http://127.0.0.1:${FIRST}/youtube/analytics/status`, { headers: { origin: 'https://evil.example' } });
    assert.equal(web.status, 403);
    // The callback is a browser navigation: answered with a page; a wrong state changes nothing.
    const cb = await fetch(`http://127.0.0.1:${FIRST}/youtube/oauth/callback?code=x&state=forged`);
    assert.equal(cb.status, 400);
    assert.match(cb.headers.get('content-type'), /text\/html/);
    assert.match(await cb.text(), /Not connected/);
    const ext = 'chrome-extension://' + 'b'.repeat(32);
    const st = await (await fetch(`http://127.0.0.1:${FIRST}/youtube/analytics/status`, { headers: { origin: ext } })).json();
    assert.equal(st.ok, true);
    assert.equal(st.configured, true);
    const c = await (await fetch(`http://127.0.0.1:${FIRST}/youtube/analytics/connect`, { method: 'POST', headers: { origin: ext, 'content-type': 'application/json' }, body: '{}' })).json();
    assert.equal(c.ok, true);
    assert.equal(new URL(c.url).searchParams.get('redirect_uri'), `http://127.0.0.1:${FIRST}/youtube/oauth/callback`);
    const denied = await fetch(`http://127.0.0.1:${FIRST}/youtube/oauth/callback?error=access_denied&state=${new URL(c.url).searchParams.get('state')}`);
    assert.match(await denied.text(), /cancelled/);
  } finally {
    await new Promise((r) => b.server.close(r));
  }
  await YA.disconnect({ fetch: fakeGoogle().fetch });
  assert.ok(!existsSync(YA.TOKEN_FILE));
});
