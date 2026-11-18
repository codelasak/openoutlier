// OpenOutlier MCP – your own YouTube channel through the YouTube Analytics API
// (phase 5, optional). The YouTube side of "My account".
//
// Off until the user creates their own OAuth client in Google Cloud (type
// "Desktop app") and gives it to OpenOutlier:
//   OPENOUTLIER_YOUTUBE_CLIENT_ID + OPENOUTLIER_YOUTUBE_CLIENT_SECRET, or the
//   file <home>/youtube-oauth.json = the JSON Google lets you download
//   ({"installed": {"client_id": …, "client_secret": …}}) or {client_id, client_secret}.
// Connecting: a Google sign-in page (PKCE, read-only scopes) that redirects to
// the local bridge (http://127.0.0.1:<port>/youtube/oauth/callback), which
// trades the code for a refresh token kept in <home>/youtube-token.json
// (mode 0600). Requests go only to Google (accounts.google.com,
// oauth2.googleapis.com, youtubeanalytics.googleapis.com, www.googleapis.com).
//
// What it reads, per video: views, engagedViews, averageViewDuration,
// averageViewPercentage, likes/comments/shares, subscribers gained, thumbnail
// impressions and their click-through rate (videoThumbnailImpressions,
// videoThumbnailImpressionsClickRate), and the retention curve of one video
// (audienceWatchRatio and relativeRetentionPerformance by elapsedVideoTimeRatio).
//
// Built against Google's documentation with mocked responses; see
// docs/youtube-plan.md "Notes from phase 5" for what was not verified live.
import { promises as fs, existsSync, readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { setting } from './env.mjs';
import { HOME, ensureHome, readLibrary, readStatus } from './library.mjs';

export const CONFIG_FILE = join(HOME, 'youtube-oauth.json');
export const TOKEN_FILE = join(HOME, 'youtube-token.json');
const PENDING_FILE = join(HOME, 'youtube-oauth-pending.json');
export const SCOPES = ['https://www.googleapis.com/auth/yt-analytics.readonly', 'https://www.googleapis.com/auth/youtube.readonly'];
export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const REPORTS_URL = 'https://youtubeanalytics.googleapis.com/v2/reports';
const DATA_URL = 'https://www.googleapis.com/youtube/v3/';
export const CALLBACK_PATH = '/youtube/oauth/callback';
const PENDING_MS = 15 * 60 * 1000;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export const VIDEO_METRICS = ['views', 'engagedViews', 'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage', 'likes', 'comments', 'shares', 'subscribersGained'];
export const REACH_METRICS = ['videoThumbnailImpressions', 'videoThumbnailImpressionsClickRate'];
export const CHANNEL_METRICS = ['views', 'engagedViews', 'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage', 'subscribersGained', 'subscribersLost', 'likes', 'comments', 'shares'];
export const RETENTION_METRICS = ['audienceWatchRatio', 'relativeRetentionPerformance'];

export const SETUP_HINT = 'Optional, and only for your own channel. In Google Cloud: enable "YouTube Analytics API" and "YouTube Data API v3", set up the OAuth consent screen (External, Testing, add your Google account as a test user), then Credentials → Create credentials → OAuth client ID → Desktop app. Download its JSON to ~/.openoutlier/youtube-oauth.json (or set OPENOUTLIER_YOUTUBE_CLIENT_ID and OPENOUTLIER_YOUTUBE_CLIENT_SECRET), then connect from the Library (My YouTube channel) or with connect_youtube_channel. README → "My YouTube channel".';

// ---- configuration and token ------------------------------------------------------
/** { clientId, clientSecret } or null when the user hasn't set up an OAuth client. */
export function loadClient() {
  let id = setting('YOUTUBE_CLIENT_ID');
  let secret = setting('YOUTUBE_CLIENT_SECRET');
  if ((!id || !secret) && existsSync(CONFIG_FILE)) {
    let f;
    try { f = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')); } catch (e) { throw new Error(`${CONFIG_FILE} is not valid JSON: ${e.message}`); }
    const c = f.installed || f.web || f;
    id = id || c.client_id;
    secret = secret || c.client_secret;
  }
  if (!id || !/\.apps\.googleusercontent\.com$/.test(String(id).trim())) return null;
  return { clientId: String(id).trim(), clientSecret: secret ? String(secret).trim() : '' };
}

export async function readToken() {
  try { return JSON.parse(await fs.readFile(TOKEN_FILE, 'utf8')); } catch { return null; }
}
async function writeToken(t) {
  await ensureHome();
  await fs.writeFile(TOKEN_FILE, JSON.stringify(t, null, 2), { mode: 0o600 });
  await fs.chmod(TOKEN_FILE, 0o600).catch(() => {});
}

// ---- OAuth (authorization code + PKCE, loopback redirect) ----------------------------
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function pkce() {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}
export const redirectUri = (port) => `http://127.0.0.1:${port}${CALLBACK_PATH}`;

export function authUrl({ clientId, port, state, challenge }) {
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri(port), response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
    code_challenge: challenge, code_challenge_method: 'S256', state
  });
  return `${AUTH_URL}?${q}`;
}

/** Start connecting: → { url } to open in a browser. The pending state is kept in a file so whichever process owns the bridge port can finish. */
export async function beginConnect({ port, now = Date.now() } = {}) {
  const client = loadClient();
  if (!client) return { ok: false, configured: false, error: 'No YouTube OAuth client is set up.', hint: SETUP_HINT };
  if (!port) return { ok: false, error: 'The OpenOutlier bridge is not running, and Google needs it to finish signing in.', hint: 'Start it with sh mcp/launchd/install.sh, or add the OpenOutlier MCP server to Claude.' };
  const { verifier, challenge } = pkce();
  const state = b64url(randomBytes(24));
  await ensureHome();
  await fs.writeFile(PENDING_FILE, JSON.stringify({ state, verifier, port, at: now }), { mode: 0o600 });
  return { ok: true, url: authUrl({ clientId: client.clientId, port, state, challenge }), expires_in_minutes: PENDING_MS / 60000 };
}

async function postForm(doFetch, url, form) {
  let res;
  try {
    res = await doFetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
  } catch (e) { throw new Error(`Could not reach Google (${e.message}).`); }
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const err = new Error(body && (body.error_description || body.error) || `Google answered HTTP ${res.status}.`);
    err.code = body && body.error;
    throw err;
  }
  return body || {};
}

/** The bridge's callback: check state, trade the code for tokens, remember the channel. → { ok, channel?, error? } */
export async function finishConnect(params, { fetch: doFetch = globalThis.fetch, now = Date.now() } = {}) {
  let pending = null;
  try { pending = JSON.parse(await fs.readFile(PENDING_FILE, 'utf8')); } catch { /* none */ }
  if (params.get('error')) return { ok: false, error: params.get('error') === 'access_denied' ? 'You cancelled the Google sign-in.' : 'Google said: ' + params.get('error') };
  const state = params.get('state');
  if (!pending || !state || pending.state !== state) return { ok: false, error: 'This sign-in link is not the one OpenOutlier started (or it was already used). Start again from the Library.' };
  await fs.rm(PENDING_FILE, { force: true });
  if (now - pending.at > PENDING_MS) return { ok: false, error: 'The sign-in took too long. Start again.' };
  const client = loadClient();
  if (!client) return { ok: false, error: 'The OAuth client is no longer configured.' };
  const code = params.get('code');
  if (!code) return { ok: false, error: 'Google sent no code.' };
  const tok = await postForm(doFetch, TOKEN_URL, {
    grant_type: 'authorization_code', code, code_verifier: pending.verifier, redirect_uri: redirectUri(pending.port),
    client_id: client.clientId, ...(client.clientSecret ? { client_secret: client.clientSecret } : {})
  });
  if (!tok.refresh_token) return { ok: false, error: 'Google gave no refresh token. Remove OpenOutlier\'s access at myaccount.google.com/permissions and connect again.' };
  const granted = String(tok.scope || '').split(' ');
  const missing = SCOPES.filter((s) => !granted.includes(s));
  const token = { refresh_token: tok.refresh_token, access_token: tok.access_token, expires_at: now + (tok.expires_in || 3600) * 1000, scope: tok.scope || SCOPES.join(' '), connected_at: new Date(now).toISOString() };
  await writeToken(token);
  let channel = null;
  try {
    channel = await myChannel({ fetch: doFetch, now });
    token.channel = channel;
    await writeToken(token);
  } catch (e) { /* shown on the next status */ }
  return { ok: true, channel, missingScopes: missing.length ? missing : undefined };
}

/** A valid access token (refreshed when it's about to expire). */
export async function accessToken({ fetch: doFetch = globalThis.fetch, now = Date.now() } = {}) {
  const t = await readToken();
  if (!t || !t.refresh_token) throw Object.assign(new Error('Your YouTube channel is not connected.'), { code: 'not_connected', hint: loadClient() ? 'Connect it from the Library (My YouTube channel) or with connect_youtube_channel.' : SETUP_HINT });
  if (t.access_token && t.expires_at > now + 60000) return t.access_token;
  const client = loadClient();
  if (!client) throw Object.assign(new Error('No YouTube OAuth client is set up.'), { code: 'not_configured', hint: SETUP_HINT });
  let r;
  try {
    r = await postForm(doFetch, TOKEN_URL, { grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: client.clientId, ...(client.clientSecret ? { client_secret: client.clientSecret } : {}) });
  } catch (e) {
    if (e.code === 'invalid_grant') {
      throw Object.assign(new Error('Google no longer accepts the saved sign-in (revoked, or it expired: apps in "Testing" get 7-day sign-ins).'), { code: 'reconnect', hint: 'Connect again from the Library (My YouTube channel) or with connect_youtube_channel.' });
    }
    throw e;
  }
  t.access_token = r.access_token;
  t.expires_at = now + (r.expires_in || 3600) * 1000;
  await writeToken(t);
  return t.access_token;
}

export async function disconnect({ fetch: doFetch = globalThis.fetch } = {}) {
  const t = await readToken();
  if (t && t.refresh_token) await doFetch(`${REVOKE_URL}?token=${encodeURIComponent(t.refresh_token)}`, { method: 'POST' }).catch(() => {});
  await fs.rm(TOKEN_FILE, { force: true });
  return { ok: true, connected: false };
}

// ---- API calls ------------------------------------------------------------------------
async function apiGet(url, opts) {
  const token = await accessToken(opts);
  let res;
  try {
    res = await (opts.fetch || globalThis.fetch)(url, { headers: { authorization: 'Bearer ' + token, accept: 'application/json' } });
  } catch (e) { throw new Error(`Could not reach Google (${e.message}).`); }
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const e = body && body.error || {};
    const reason = e.errors && e.errors[0] && e.errors[0].reason || e.status || '';
    const err = new Error('YouTube: ' + (e.message || `HTTP ${res.status}`));
    err.code = /quota/i.test(reason) ? 'quota' : /SERVICE_DISABLED|accessNotConfigured/i.test(reason + e.message) ? 'api_disabled' : res.status === 403 ? 'forbidden' : res.status === 400 ? 'bad_query' : 'failed';
    if (err.code === 'api_disabled') err.hint = 'Enable "YouTube Analytics API" and "YouTube Data API v3" for the OAuth client\'s project in Google Cloud.';
    throw err;
  }
  return body || {};
}

/** The analytics response ({ columnHeaders, rows }) → [{ column: value }]. */
export function rowsOf(report) {
  const cols = (report && report.columnHeaders || []).map((c) => c.name);
  return (report && report.rows || []).map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
}

const day = (t) => new Date(t).toISOString().slice(0, 10);
/** [startDate, endDate] for "the last N days" (analytics data lags 2–3 days; the end date is today). */
export function range(days, now = Date.now()) {
  return [day(now - Math.max(1, days) * 864e5), day(now)];
}

export function reportUrl({ metrics, dimensions, filters, sort, maxResults, days = 28, now = Date.now() }) {
  const [startDate, endDate] = range(days, now);
  const q = new URLSearchParams({ ids: 'channel==MINE', startDate, endDate, metrics: metrics.join(',') });
  if (dimensions) q.set('dimensions', dimensions);
  if (filters) q.set('filters', filters);
  if (sort) q.set('sort', sort);
  if (maxResults) q.set('maxResults', String(maxResults));
  return `${REPORTS_URL}?${q}`;
}

export async function myChannel(opts = {}) {
  const body = await apiGet(`${DATA_URL}channels?part=snippet,statistics,contentDetails&mine=true`, opts);
  const c = (body.items || [])[0];
  if (!c) throw Object.assign(new Error('This Google account has no YouTube channel.'), { code: 'no_channel' });
  const handle = String(c.snippet && c.snippet.customUrl || '').replace(/^@/, '') || null;
  return {
    channel_id: c.id, title: c.snippet && c.snippet.title, handle,
    account: handle ? 'yt/' + handle.toLowerCase() : 'yt/' + c.id,
    subscribers: c.statistics && !c.statistics.hiddenSubscriberCount ? Number(c.statistics.subscriberCount) : null,
    videos: c.statistics ? Number(c.statistics.videoCount) : null,
    thumb: c.snippet && c.snippet.thumbnails && (c.snippet.thumbnails.medium || c.snippet.thumbnails.default || {}).url || null
  };
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const r3 = (v) => (v == null ? null : Math.round(v * 1000) / 1000);

/** Titles, publish dates and lengths for video ids (Data API with the same sign-in, 1 unit per 50). */
async function videoFacts(ids, opts) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const body = await apiGet(`${DATA_URL}videos?part=snippet,contentDetails&id=${ids.slice(i, i + 50).join(',')}&maxResults=50`, opts);
    for (const it of body.items || []) {
      const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(it.contentDetails && it.contentDetails.duration || '');
      out[it.id] = {
        title: it.snippet && it.snippet.title, published: it.snippet && it.snippet.publishedAt,
        duration_s: m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : null
      };
    }
  }
  return out;
}

/** The library's format for a saved video (short / video / live), else null. */
function savedFormat(lib, id) {
  for (const rec of Object.values(lib.accounts || {})) {
    const p = rec.posts && rec.posts[id];
    if (p && p.platform === 'youtube') return p.type || null;
  }
  return null;
}

/**
 * Per-video analytics for the last `days` days, best first.
 * → { range, videos: [{ id, title, … , impressions, ctr_pct }], reach_error? }
 */
export async function videoReport({ days = 28, limit = 50, sort = 'views', now = Date.now(), ...opts } = {}) {
  const max = Math.min(Math.max(1, limit), 200);
  const main = rowsOf(await apiGet(reportUrl({ metrics: VIDEO_METRICS, dimensions: 'video', sort: '-' + (VIDEO_METRICS.includes(sort) ? sort : 'views'), maxResults: max, days, now }), { ...opts, now }));
  // Thumbnail impressions and CTR are "reach" metrics: asked separately so a refusal there doesn't lose the rest.
  let reach = {};
  let reachError;
  try {
    for (const r of rowsOf(await apiGet(reportUrl({ metrics: REACH_METRICS, dimensions: 'video', sort: '-videoThumbnailImpressions', maxResults: 200, days, now }), { ...opts, now }))) reach[r.video] = r;
  } catch (e) { reachError = e.message; }
  const ids = main.map((r) => r.video).filter((id) => VIDEO_ID_RE.test(String(id)));
  let facts = {};
  try { facts = await videoFacts(ids, { ...opts, now }); } catch { /* titles are a nicety */ }
  const lib = readLibrary();
  return {
    range: range(days, now), days,
    videos: main.filter((r) => VIDEO_ID_RE.test(String(r.video))).map((r) => {
      const f = facts[r.video] || {};
      const x = reach[r.video] || {};
      const ctr = num(x.videoThumbnailImpressionsClickRate);
      return {
        id: r.video, title: f.title || null, published: f.published || null, duration_s: f.duration_s ?? null, format: savedFormat(lib, r.video),
        views: num(r.views), engaged_views: num(r.engagedViews), watch_minutes: num(r.estimatedMinutesWatched),
        avg_view_duration_s: num(r.averageViewDuration), avg_view_pct: r1(num(r.averageViewPercentage)),
        likes: num(r.likes), comments: num(r.comments), shares: num(r.shares), subscribers_gained: num(r.subscribersGained),
        // Read as a fraction (0.054 = 5.4 %) like the API's other *Rate metrics; shown in percent. (Not checked against a live channel.)
        impressions: num(x.videoThumbnailImpressions), ctr_pct: ctr == null ? null : r1(ctr * 100)
      };
    }),
    reach_error: reachError
  };
}

/** Channel totals for the last `days` days. */
export async function channelReport({ days = 28, now = Date.now(), ...opts } = {}) {
  const row = rowsOf(await apiGet(reportUrl({ metrics: CHANNEL_METRICS, days, now }), { ...opts, now }))[0] || {};
  return {
    range: range(days, now), days,
    views: num(row.views), engaged_views: num(row.engagedViews), watch_minutes: num(row.estimatedMinutesWatched),
    avg_view_duration_s: num(row.averageViewDuration), avg_view_pct: r1(num(row.averageViewPercentage)),
    subscribers_gained: num(row.subscribersGained), subscribers_lost: num(row.subscribersLost),
    likes: num(row.likes), comments: num(row.comments), shares: num(row.shares)
  };
}

/**
 * Audience retention of one video: 100 points (elapsedVideoTimeRatio 0.01…1.0).
 * audience_watch_ratio can exceed 1 where people rewatch; relative_performance compares
 * with YouTube videos of similar length (0.5 = typical).
 */
export async function retention({ id, days = 3650, now = Date.now(), ...opts } = {}) {
  if (!VIDEO_ID_RE.test(String(id || ''))) throw Object.assign(new Error('Not a YouTube video id.'), { code: 'bad_id' });
  const rows = rowsOf(await apiGet(reportUrl({ metrics: RETENTION_METRICS, dimensions: 'elapsedVideoTimeRatio', filters: 'video==' + id, sort: 'elapsedVideoTimeRatio', days, now }), { ...opts, now }));
  const points = rows.map((r) => ({ at: r3(num(r.elapsedVideoTimeRatio)), watch_ratio: r3(num(r.audienceWatchRatio)), relative: r3(num(r.relativeRetentionPerformance)) }))
    .filter((p) => p.at != null && p.watch_ratio != null);
  return { id, points, summary: retentionSummary(points) };
}

/** Where people leave: the share still watching at 30 s-equivalents is unknown without the length, so it uses ratios of the video. */
export function retentionSummary(points) {
  if (!points.length) return null;
  const at = (x) => { const p = points.reduce((best, q) => (Math.abs(q.at - x) < Math.abs(best.at - x) ? q : best), points[0]); return p.watch_ratio; };
  let drop = null;
  for (let i = 1; i < points.length; i++) {
    const d = points[i - 1].watch_ratio - points[i].watch_ratio;
    if (!drop || d > drop.loss) drop = { at: points[i].at, loss: r3(d) };
  }
  const rewatch = points.filter((p) => p.watch_ratio > 1).map((p) => p.at);
  return { start: at(points[0].at), at_25pct: at(0.25), at_50pct: at(0.5), at_75pct: at(0.75), end: at(1), steepest_drop: drop, rewatched_at: rewatch.length ? rewatch.slice(0, 10) : undefined };
}

// ---- status (the Library and MCP) -------------------------------------------------------
export async function status() {
  const client = (() => { try { return loadClient(); } catch (e) { return { error: e.message }; } })();
  if (!client || client.error) return { configured: false, connected: false, error: client && client.error, hint: SETUP_HINT };
  const t = await readToken();
  return { configured: true, connected: !!(t && t.refresh_token), channel: t && t.channel || null, connected_at: t && t.connected_at || null, redirect_port: readStatus().bridgePort || null };
}

// ---- bridge routes ------------------------------------------------------------------------
/** Google's redirect lands here (a browser navigation, so no extension Origin). A small HTML page answers. */
export async function callbackPage(url, opts = {}) {
  let r;
  try { r = await finishConnect(url.searchParams, opts); } catch (e) { r = { ok: false, error: e.message }; }
  const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const body = r.ok
    ? `<h1>YouTube connected</h1><p>${esc(r.channel ? r.channel.title : 'Your channel')} is linked to OpenOutlier on this computer. You can close this tab and go back to the Library.</p>`
    : `<h1>Not connected</h1><p>${esc(r.error)}</p>`;
  return { status: r.ok ? 200 : 400, html: `<!doctype html><meta charset="utf-8"><title>OpenOutlier</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:32em;margin:15vh auto;padding:0 16px}</style>${body}` };
}

/** The extension's calls (already checked by the bridge: Host, Origin, pairing). → [status, body] or null when the path isn't ours. */
export async function handleRoute(method, url, { port, fetch: doFetch } = {}) {
  const p = url.pathname;
  const o = doFetch ? { fetch: doFetch } : {};
  const wrap = async (fn) => {
    try { return [200, { ok: true, ...(await fn()) }]; } catch (e) { return [200, { ok: false, error: e.message, code: e.code, hint: e.hint }]; }
  };
  const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 28, 1), 3650);
  if (method === 'GET' && p === '/youtube/analytics/status') return [200, { ok: true, ...(await status()) }];
  if (method === 'POST' && p === '/youtube/analytics/connect') return [200, await beginConnect({ port })];
  if (method === 'POST' && p === '/youtube/analytics/disconnect') return wrap(() => disconnect(o));
  if (method === 'GET' && p === '/youtube/analytics/channel') return wrap(async () => ({ channel: (await readToken() || {}).channel || await myChannel(o), totals: await channelReport({ days, ...o }) }));
  if (method === 'GET' && p === '/youtube/analytics/videos') return wrap(() => videoReport({ days, limit: Number(url.searchParams.get('limit')) || 50, ...o }));
  if (method === 'GET' && p === '/youtube/analytics/retention') return wrap(() => retention({ id: url.searchParams.get('id'), ...o }));
  return null;
}

// ---- MCP tools -------------------------------------------------------------------------------
export const INSTRUCTIONS = 'My YouTube channel tools (my_youtube_channel, my_youtube_videos, my_youtube_retention, connect_youtube_channel) read the user\'s OWN channel through the YouTube Analytics API, only after they set up their own Google OAuth client and connected: retention (audience watch ratio per point of the video), average view percentage, engaged views, thumbnail impressions and click-through rate. Read-only.';

export function registerAnalyticsTools(server, { z, json, safe, bridgePort }) {
  const days = z.number().int().min(1).max(3650).optional().describe('The last N days (default 28). YouTube Analytics data lags 2–3 days.');
  server.registerTool('connect_youtube_channel', {
    title: 'Connect my YouTube channel',
    description: 'Start connecting the user\'s own YouTube channel to OpenOutlier (YouTube Analytics API, read-only). Returns a Google sign-in URL for the user to open in their browser; after they approve, the local bridge finishes it. Needs their own OAuth client (Desktop app) set up first; without one it says how. Also reports whether a channel is already connected.',
    inputSchema: {}
  }, () => safe(async () => {
    const st = await status();
    if (!st.configured) return json(st);
    const r = await beginConnect({ port: await bridgePort() });
    return json({ already_connected: st.connected ? st.channel : undefined, ...r, next: r.ok ? 'Ask the user to open url, sign in with the Google account that owns the channel, and approve read-only access. Then call my_youtube_channel.' : undefined });
  }));
  server.registerTool('my_youtube_channel', {
    title: 'My YouTube channel',
    description: 'The user\'s own channel (connected with connect_youtube_channel): totals for the last N days from the YouTube Analytics API: views, engaged views, watch time, average view duration and percentage, subscribers gained/lost, likes, comments, shares.',
    inputSchema: { days },
    annotations: { readOnlyHint: true }
  }, ({ days: d = 28 }) => safe(async () => {
    try {
      const t = await readToken();
      return json({ channel: t && t.channel || await myChannel(), totals: await channelReport({ days: d }) });
    } catch (e) { return json({ ok: false, error: e.message, code: e.code, hint: e.hint }); }
  }));
  server.registerTool('my_youtube_videos', {
    title: 'My YouTube videos: retention, CTR, engaged views',
    description: 'Per-video analytics for the user\'s own channel (last N days): views, engaged views, watch minutes, average view duration and average view percentage (how much of the video people watched), likes, comments, shares, subscribers gained, thumbnail impressions and impression click-through rate (ctr_pct). format says short/video/live when the video is in the library.',
    inputSchema: { days, limit: z.number().int().min(1).max(200).optional().describe('How many videos (default 50)'), sort: z.enum(['views', 'engagedViews', 'averageViewPercentage', 'estimatedMinutesWatched', 'subscribersGained']).optional() },
    annotations: { readOnlyHint: true }
  }, ({ days: d = 28, limit = 50, sort = 'views' }) => safe(async () => {
    try { return json(await videoReport({ days: d, limit, sort })); } catch (e) { return json({ ok: false, error: e.message, code: e.code, hint: e.hint }); }
  }));
  server.registerTool('my_youtube_retention', {
    title: 'Retention curve of one of my videos',
    description: 'Audience retention of one video on the user\'s own channel: 100 points over the video (at = share of the video elapsed), watch_ratio (share of views still watching; above 1 = rewatched), relative (vs YouTube videos of similar length, 0.5 = typical), plus a summary: start, 25/50/75 %, end, the steepest drop.',
    inputSchema: { code: z.string().describe('Video id or youtube.com / youtu.be URL') },
    annotations: { readOnlyHint: true }
  }, ({ code }) => safe(async () => {
    const m = String(code).match(/(?:v=|shorts\/|youtu\.be\/|live\/)([A-Za-z0-9_-]{11})/) || String(code).trim().match(/^([A-Za-z0-9_-]{11})$/);
    if (!m) return json({ ok: false, error: 'Not a YouTube video id or URL.' });
    try { return json(await retention({ id: m[1] })); } catch (e) { return json({ ok: false, error: e.message, code: e.code, hint: e.hint }); }
  }));
}
