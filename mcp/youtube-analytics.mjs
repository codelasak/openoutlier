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
// trades the code for a refresh token kept in <home>/youtube-token-<UC…>.json
// (mode 0600), one file per connected channel (phase 2 of docs/youtube-niche-plan.md:
// the user's channel and a family member's; the first connected is the default, and
// the single youtube-token.json of earlier versions moves over on first use). Scopes:
// read-only Analytics, revenue (yt-analytics-monetary, so sign-ins from before phase 2
// show needs_reconsent) and the channel's video list. Requests go only to Google (accounts.google.com,
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
/** The one token file of earlier versions (a single channel). Moved to youtube-token-<UC…>.json on first use. */
export const LEGACY_TOKEN_FILE = join(HOME, 'youtube-token.json');
export const TOKEN_FILE = LEGACY_TOKEN_FILE; // (old name, kept for callers that only check it)
const TOKEN_RE = /^youtube-token-(UC[A-Za-z0-9_-]{22})\.json$/;
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
/** One token file per connected channel (phase 2: Hands on Excel + a second channel). */
export const tokenFile = (channelId) => join(HOME, `youtube-token-${channelId}.json`);
const PENDING_FILE = join(HOME, 'youtube-oauth-pending.json');
export const ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/yt-analytics.readonly';
// Revenue, RPM and CPM (phase 2, asked for now: the data arrives once the channel is in the Partner Program).
export const MONETARY_SCOPE = 'https://www.googleapis.com/auth/yt-analytics-monetary.readonly';
export const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
export const SCOPES = [ANALYTICS_SCOPE, MONETARY_SCOPE, YOUTUBE_SCOPE];
export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const REPORTS_URL = 'https://youtubeanalytics.googleapis.com/v2/reports';
export const DATA_URL = 'https://www.googleapis.com/youtube/v3/';
export const CALLBACK_PATH = '/youtube/oauth/callback';
const PENDING_MS = 15 * 60 * 1000;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export const VIDEO_METRICS = ['views', 'engagedViews', 'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage', 'likes', 'comments', 'shares', 'subscribersGained'];
export const REACH_METRICS = ['videoThumbnailImpressions', 'videoThumbnailImpressionsClickRate'];
export const CHANNEL_METRICS = ['views', 'engagedViews', 'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage', 'subscribersGained', 'subscribersLost', 'likes', 'comments', 'shares'];
export const RETENTION_METRICS = ['audienceWatchRatio', 'relativeRetentionPerformance'];
export const REVENUE_METRICS = ['estimatedRevenue', 'estimatedAdRevenue', 'grossRevenue', 'cpm', 'playbackBasedCpm', 'monetizedPlaybacks', 'adImpressions'];

export const SETUP_HINT = 'Optional, and only for your own channel. In Google Cloud: enable "YouTube Analytics API" and "YouTube Data API v3", set up the OAuth consent screen (External, Testing, add your Google account as a test user), then Credentials → Create credentials → OAuth client ID → Desktop app. Download its JSON to ~/.openoutlier/youtube-oauth.json (or set OPENOUTLIER_YOUTUBE_CLIENT_ID and OPENOUTLIER_YOUTUBE_CLIENT_SECRET), then connect from the Library (My YouTube channel) or with connect_youtube_channel. README → "My YouTube channel".';
export const RECONSENT_HINT = 'Revenue, RPM and CPM need one more read-only permission (yt-analytics-monetary.readonly). Reconnect once from the Library (Kanalım → Reconnect) or with connect_youtube_channel; nothing else changes.';

// ---- configuration and tokens ------------------------------------------------------
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

async function readJson(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; } }
async function writeFile0600(file, obj) {
  await ensureHome();
  const tmp = file + '.' + process.pid + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), { mode: 0o600 });
  await fs.chmod(tmp, 0o600).catch(() => {});
  await fs.rename(tmp, file);
}

/**
 * The old single youtube-token.json → youtube-token-<UC…>.json, once its channel is known.
 * The connection keeps working throughout: until the channel is known (the lookup after
 * signing in failed), the old file is used as it is. → true when it moved.
 */
export async function migrateLegacyToken() {
  const t = await readJson(LEGACY_TOKEN_FILE);
  if (!t) return false;
  const id = t.channel && t.channel.channel_id;
  if (!t.refresh_token) { await fs.rm(LEGACY_TOKEN_FILE, { force: true }); return false; }
  if (!CHANNEL_ID_RE.test(String(id || ''))) return false;
  const cur = await readJson(tokenFile(id));
  // A newer sign-in of the same channel already has its own file: the old one is stale.
  if (!cur || !cur.refresh_token || Date.parse(cur.connected_at || 0) <= Date.parse(t.connected_at || 0)) await writeFile0600(tokenFile(id), t);
  await fs.rm(LEGACY_TOKEN_FILE, { force: true });
  return true;
}

/** Every connected channel's token, the first connected first (that one is the default). */
export async function listTokens() {
  await migrateLegacyToken().catch(() => {});
  let names = [];
  try { names = await fs.readdir(HOME); } catch { /* no home yet */ }
  const out = [];
  for (const n of names) {
    const m = TOKEN_RE.exec(n);
    if (!m) continue;
    const t = await readJson(join(HOME, n));
    if (t && t.refresh_token) out.push({ ...t, channel: { ...(t.channel || {}), channel_id: m[1] } });
  }
  const legacy = await readJson(LEGACY_TOKEN_FILE);
  if (legacy && legacy.refresh_token) out.push({ ...legacy, legacy: true });
  out.sort((a, b) => (Date.parse(a.connected_at || 0) || 0) - (Date.parse(b.connected_at || 0) || 0) || String(a.channel && a.channel.channel_id).localeCompare(String(b.channel && b.channel.channel_id)));
  return out;
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/^(yt\/|@)/, '').replace(/[^a-z0-9]/g, '');
/** Which token a channel reference means: UC id, @handle, yt/handle, or (part of) the title. No reference = the first. */
export function pickToken(tokens, ref) {
  if (!tokens.length) return null;
  if (ref === undefined || ref === null || ref === '' || ref === 'default') return tokens[0];
  const r = String(ref).trim();
  const ch = (t) => t.channel || {};
  const hit = tokens.find((t) => ch(t).channel_id === r) || tokens.find((t) => norm(ch(t).handle) && norm(ch(t).handle) === norm(r))
    || tokens.find((t) => ch(t).account && ch(t).account.toLowerCase() === r.toLowerCase()) || tokens.find((t) => norm(ch(t).title) === norm(r))
    || (norm(r).length >= 3 ? tokens.find((t) => norm(ch(t).title).includes(norm(r))) : null);
  if (!hit) {
    const list = tokens.map((t) => ch(t).title || ch(t).channel_id || 'a channel').join(', ');
    throw Object.assign(new Error(`No connected channel matches "${r}". Connected: ${list}.`), { code: 'unknown_channel' });
  }
  return hit;
}

/** The token of one channel (default: the first connected), or null when none is connected. */
export async function readToken(channel) {
  return pickToken(await listTokens(), channel);
}
async function writeToken(t) {
  const { legacy, ...clean } = t;
  const id = clean.channel && clean.channel.channel_id;
  await writeFile0600(CHANNEL_ID_RE.test(String(id || '')) ? tokenFile(id) : LEGACY_TOKEN_FILE, clean);
}
/** Whether a token carries the revenue scope (sign-ins from before phase 2 don't). */
export const hasMonetary = (t) => String(t && t.scope || '').split(/\s+/).includes(MONETARY_SCOPE);

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
    // select_account: "Add channel" may be another Google account (the second channel's owner).
    access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'true',
    code_challenge: challenge, code_challenge_method: 'S256', state
  });
  return `${AUTH_URL}?${q}`;
}

/**
 * Start connecting: → { url } to open in a browser. The pending state is kept in a file so whichever
 * process owns the bridge port can finish. channel: reconnect that channel (its id, for the answer);
 * without it, the sign-in adds whatever channel the chosen Google account has (or replaces it if
 * it is already connected).
 */
export async function beginConnect({ port, now = Date.now(), channel } = {}) {
  const client = loadClient();
  if (!client) return { ok: false, configured: false, error: 'No YouTube OAuth client is set up.', hint: SETUP_HINT };
  if (!port) return { ok: false, error: 'The OpenOutlier bridge is not running, and Google needs it to finish signing in.', hint: 'Start it with sh mcp/launchd/install.sh, or add the OpenOutlier MCP server to Claude.' };
  const { verifier, challenge } = pkce();
  const state = b64url(randomBytes(24));
  await ensureHome();
  await fs.writeFile(PENDING_FILE, JSON.stringify({ state, verifier, port, at: now, reconnect: CHANNEL_ID_RE.test(String(channel || '')) ? channel : null }), { mode: 0o600 });
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

/**
 * The bridge's callback: check state, trade the code for tokens, find the channel, keep its token
 * in youtube-token-<UC…>.json. → { ok, channel?, added?, reconnected?, missingScopes?, error? }
 */
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
  let channel = null;
  try { channel = await myChannel({ fetch: doFetch, now, accessToken: tok.access_token }); } catch { /* kept in the old single file until the channel is known */ }
  let added = true;
  if (channel) {
    const prev = await readJson(tokenFile(channel.channel_id));
    if (prev && prev.refresh_token) {
      added = false;
      token.connected_at = prev.connected_at || token.connected_at; // keeps its place (the first connected is the default)
      token.reconnected_at = new Date(now).toISOString();
    }
    token.channel = channel;
  }
  await writeToken(token);
  return {
    ok: true, channel, added, reconnected: !added,
    // Reconnect was pressed for one channel but Google's account chooser gave another.
    other_channel: pending.reconnect && channel && channel.channel_id !== pending.reconnect ? true : undefined,
    missingScopes: missing.length ? missing : undefined
  };
}

/** A token whose channel wasn't known when it was saved: look it up and move it to its own file. */
export async function adoptLegacyToken(opts = {}) {
  const t = await readJson(LEGACY_TOKEN_FILE);
  if (!t || !t.refresh_token || (t.channel && t.channel.channel_id)) return migrateLegacyToken();
  const channel = await myChannel({ ...opts, channel: undefined, legacy: true });
  const cur = await readJson(LEGACY_TOKEN_FILE);
  await writeToken({ ...cur, channel });
  await fs.rm(LEGACY_TOKEN_FILE, { force: true });
  return true;
}

/** A valid access token for one channel (refreshed when it's about to expire). */
export async function accessToken({ fetch: doFetch = globalThis.fetch, now = Date.now(), channel, legacy } = {}) {
  const t = legacy ? { ...(await readJson(LEGACY_TOKEN_FILE)), legacy: true } : await readToken(channel);
  if (!t || !t.refresh_token) throw Object.assign(new Error('Your YouTube channel is not connected.'), { code: 'not_connected', hint: loadClient() ? 'Connect it from the Library (My YouTube channel) or with connect_youtube_channel.' : SETUP_HINT });
  if (t.access_token && t.expires_at > now + 60000) return t.access_token;
  const client = loadClient();
  if (!client) throw Object.assign(new Error('No YouTube OAuth client is set up.'), { code: 'not_configured', hint: SETUP_HINT });
  let r;
  try {
    r = await postForm(doFetch, TOKEN_URL, { grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: client.clientId, ...(client.clientSecret ? { client_secret: client.clientSecret } : {}) });
  } catch (e) {
    if (e.code === 'invalid_grant') {
      if (!t.reconnect) await writeToken({ ...t, reconnect: new Date(now).toISOString() }).catch(() => {});
      const who = t.channel && t.channel.title ? ` for ${t.channel.title}` : '';
      throw Object.assign(new Error(`Google no longer accepts the saved sign-in${who} (revoked, or it expired: apps in "Testing" get 7-day sign-ins).`), { code: 'reconnect', channel: t.channel && t.channel.channel_id, hint: 'Connect again from the Library (My YouTube channel → Reconnect) or with connect_youtube_channel.' });
    }
    throw e;
  }
  const { reconnect, ...rest } = t;
  await writeToken({ ...rest, access_token: r.access_token, expires_at: now + (r.expires_in || 3600) * 1000 });
  return r.access_token;
}

/** Disconnect one channel (default: the first): Google revokes the sign-in, its token file goes. Collected history stays. */
export async function disconnect({ fetch: doFetch = globalThis.fetch, channel } = {}) {
  const t = await readToken(channel);
  if (!t) return { ok: true, connected: false };
  if (t.refresh_token) await doFetch(`${REVOKE_URL}?token=${encodeURIComponent(t.refresh_token)}`, { method: 'POST' }).catch(() => {});
  const id = t.channel && t.channel.channel_id;
  await fs.rm(t.legacy || !id ? LEGACY_TOKEN_FILE : tokenFile(id), { force: true });
  const left = await listTokens();
  return { ok: true, disconnected: id || null, connected: left.length > 0, channels: left.length };
}

// ---- API calls ------------------------------------------------------------------------
export async function apiGet(url, opts) {
  const token = opts.accessToken || await accessToken(opts);
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
    err.code = /quota|rateLimit/i.test(reason) ? 'quota' : /SERVICE_DISABLED|accessNotConfigured/i.test(reason + e.message) ? 'api_disabled'
      : res.status === 401 ? 'reconnect' : res.status === 403 ? 'forbidden' : res.status === 400 ? 'bad_query' : 'failed';
    err.status = res.status;
    err.reason = reason;
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

export function reportUrl({ metrics, dimensions, filters, sort, maxResults, days = 28, now = Date.now(), startDate: from, endDate: to, currency }) {
  const [startDate, endDate] = from && to ? [from, to] : range(days, now);
  const q = new URLSearchParams({ ids: 'channel==MINE', startDate, endDate, metrics: metrics.join(',') });
  if (dimensions) q.set('dimensions', dimensions);
  if (filters) q.set('filters', filters);
  if (sort) q.set('sort', sort);
  if (maxResults) q.set('maxResults', String(maxResults));
  if (currency) q.set('currency', currency);
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
    views_total: c.statistics && c.statistics.viewCount != null ? Number(c.statistics.viewCount) : null,
    created: c.snippet && c.snippet.publishedAt ? String(c.snippet.publishedAt).slice(0, 10) : null,
    uploads: c.contentDetails && c.contentDetails.relatedPlaylists && c.contentDetails.relatedPlaylists.uploads || null,
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
/** One connected channel, as the Library and the tools show it. */
export function channelInfo(t, i = 0) {
  const c = t.channel || {};
  return {
    channel_id: c.channel_id || null, title: c.title || null, handle: c.handle || null, account: c.account || null, thumb: c.thumb || null,
    subscribers: c.subscribers ?? null, created: c.created || null, connected_at: t.connected_at || null, primary: i === 0,
    monetary_scope: hasMonetary(t),
    // Sign-ins from before phase 2 lack the revenue scope: one re-consent adds it.
    needs_reconsent: !hasMonetary(t),
    // Google refused the refresh token (revoked, or a 7-day "Testing" sign-in expired).
    reconnect: !!t.reconnect,
    pending_lookup: t.legacy && !c.channel_id ? true : undefined
  };
}

export async function status() {
  const client = (() => { try { return loadClient(); } catch (e) { return { error: e.message }; } })();
  if (!client || client.error) return { configured: false, connected: false, channels: [], error: client && client.error, hint: SETUP_HINT };
  const tokens = await listTokens();
  const channels = tokens.map(channelInfo);
  const t = tokens[0];
  return {
    configured: true, connected: channels.length > 0, channel: t && t.channel || null, connected_at: t && t.connected_at || null,
    channels, needs_reconsent: channels.some((c) => c.needs_reconsent), reconnect: channels.some((c) => c.reconnect),
    redirect_port: readStatus().bridgePort || null
  };
}

// ---- bridge routes ------------------------------------------------------------------------
/** Google's redirect lands here (a browser navigation, so no extension Origin). A small HTML page answers. */
export async function callbackPage(url, opts = {}) {
  let r;
  try { r = await finishConnect(url.searchParams, opts); } catch (e) { r = { ok: false, error: e.message }; }
  const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const name = esc(r.channel ? r.channel.title : 'Your channel');
  const body = r.ok
    ? `<h1>YouTube connected</h1><p>${name} is ${r.reconnected ? 'reconnected' : 'linked'} to OpenOutlier on this computer${r.other_channel ? ' (this Google account has a different channel than the one you meant to reconnect; it was added next to it)' : ''}. You can close this tab and go back to the Library.</p>`
      + (r.missingScopes && r.missingScopes.includes(MONETARY_SCOPE) ? '<p>Revenue access was not granted, so revenue stays empty. Connect again and leave every box ticked to add it.</p>' : '')
    : `<h1>Not connected</h1><p>${esc(r.error)}</p>`;
  return { status: r.ok ? 200 : 400, html: `<!doctype html><meta charset="utf-8"><title>OpenOutlier</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:32em;margin:15vh auto;padding:0 16px}</style>${body}` };
}

/** A channel parameter as given by the extension or a tool: UC id, 'all' is not a channel here. */
export function channelParam(v) {
  const s = v == null ? '' : String(v).trim().slice(0, 100);
  return s && s !== 'all' ? s : undefined;
}

/** The extension's calls (already checked by the bridge: Host, Origin, pairing). → [status, body] or null when the path isn't ours. */
export async function handleRoute(method, url, { port, fetch: doFetch } = {}) {
  const p = url.pathname;
  const channel = channelParam(url.searchParams.get('channel'));
  const o = { ...(doFetch ? { fetch: doFetch } : {}), channel };
  const wrap = async (fn) => {
    try { return [200, { ok: true, ...(await fn()) }]; } catch (e) { return [200, { ok: false, error: e.message, code: e.code, hint: e.hint }]; }
  };
  const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 28, 1), 3650);
  if (method === 'GET' && p === '/youtube/analytics/status') return [200, { ok: true, ...(await status()) }];
  if (method === 'POST' && p === '/youtube/analytics/connect') return [200, await beginConnect({ port, channel })];
  if (method === 'POST' && p === '/youtube/analytics/disconnect') return wrap(() => disconnect(o));
  if (method === 'GET' && p === '/youtube/analytics/channel') return wrap(async () => ({ channel: (await readToken(channel) || {}).channel || await myChannel(o), totals: await channelReport({ days, ...o }) }));
  if (method === 'GET' && p === '/youtube/analytics/videos') return wrap(() => videoReport({ days, limit: Number(url.searchParams.get('limit')) || 50, ...o }));
  if (method === 'GET' && p === '/youtube/analytics/retention') return wrap(() => retention({ id: url.searchParams.get('id'), ...o }));
  return null;
}

// ---- MCP tools -------------------------------------------------------------------------------
export const INSTRUCTIONS = 'My YouTube channel tools (my_youtube_channel, my_youtube_videos, my_youtube_retention, connect_youtube_channel, and from the stored daily history my_channel_history, my_video_history, my_search_terms, my_ypp_progress) read the user\'s OWN channels through the YouTube Analytics API, only after they set up their own Google OAuth client and connected: retention (audience watch ratio per point of the video), average view percentage, engaged views, thumbnail impressions and click-through rate, daily history since the channel started, the search terms that brought viewers, YPP progress with an ETA, revenue once in the Partner Program. Up to several channels can be connected (e.g. the user\'s and a family member\'s); every tool takes an optional channel (UC id, @handle or name) and defaults to the first connected. Read-only.';

/** The channel argument of the tools. */
export function channelArg(z) {
  return z.string().optional().describe('Which connected channel: UC… id, @handle or (part of) its name. Default: the first connected (the user\'s own).');
}

export function registerAnalyticsTools(server, { z, json, safe, bridgePort }) {
  const days = z.number().int().min(1).max(3650).optional().describe('The last N days (default 28). YouTube Analytics data lags 2–3 days.');
  const channel = channelArg(z);
  const fail = (e) => json({ ok: false, error: e.message, code: e.code, hint: e.hint });
  server.registerTool('connect_youtube_channel', {
    title: 'Connect my YouTube channel',
    description: 'Start connecting one of the user\'s own YouTube channels to OpenOutlier (YouTube Analytics API, read-only, revenue included once in the Partner Program). Returns a Google sign-in URL for the user to open in their browser; after they approve, the local bridge finishes it. Signing in with another Google account adds a second channel (e.g. a family member\'s, who signs in themselves); give channel to reconnect one whose sign-in expired or that needs the revenue permission. Needs their own OAuth client (Desktop app) set up first; without one it says how. Also lists the channels already connected.',
    inputSchema: { channel: z.string().optional().describe('Reconnect this connected channel (UC id, @handle or name). Leave out to add a channel.') }
  }, ({ channel: ch }) => safe(async () => {
    const st = await status();
    if (!st.configured) return json(st);
    let id;
    if (ch) { try { id = (await readToken(ch)).channel.channel_id; } catch (e) { return fail(e); } }
    const r = await beginConnect({ port: await bridgePort(), channel: id });
    return json({ connected: st.channels, ...r, next: r.ok ? 'Ask the user to open url, choose the Google account that owns the channel (for a family member\'s channel they sign in with that account), and approve read-only access (keep every box ticked, revenue included). Then call my_youtube_channel.' : undefined });
  }));
  server.registerTool('my_youtube_channel', {
    title: 'My YouTube channel',
    description: 'One of the user\'s own channels (connected with connect_youtube_channel): totals for the last N days from the YouTube Analytics API: views, engaged views, watch time, average view duration and percentage, subscribers gained/lost, likes, comments, shares. Also lists every connected channel.',
    inputSchema: { days, channel },
    annotations: { readOnlyHint: true }
  }, ({ days: d = 28, channel: ch }) => safe(async () => {
    try {
      const t = await readToken(ch);
      const st = await status();
      return json({ channel: t && t.channel || await myChannel({ channel: ch }), totals: await channelReport({ days: d, channel: ch }), connected: st.channels });
    } catch (e) { return fail(e); }
  }));
  server.registerTool('my_youtube_videos', {
    title: 'My YouTube videos: retention, CTR, engaged views',
    description: 'Per-video analytics for one of the user\'s own channels (last N days): views, engaged views, watch minutes, average view duration and average view percentage (how much of the video people watched), likes, comments, shares, subscribers gained, thumbnail impressions and impression click-through rate (ctr_pct). format says short/video/live when the video is in the library.',
    inputSchema: { days, channel, limit: z.number().int().min(1).max(200).optional().describe('How many videos (default 50)'), sort: z.enum(['views', 'engagedViews', 'averageViewPercentage', 'estimatedMinutesWatched', 'subscribersGained']).optional() },
    annotations: { readOnlyHint: true }
  }, ({ days: d = 28, limit = 50, sort = 'views', channel: ch }) => safe(async () => {
    try { return json(await videoReport({ days: d, limit, sort, channel: ch })); } catch (e) { return fail(e); }
  }));
  server.registerTool('my_youtube_retention', {
    title: 'Retention curve of one of my videos',
    description: 'Audience retention of one video on one of the user\'s own channels: 100 points over the video (at = share of the video elapsed), watch_ratio (share of views still watching; above 1 = rewatched), relative (vs YouTube videos of similar length, 0.5 = typical), plus a summary: start, 25/50/75 %, end, the steepest drop.',
    inputSchema: { code: z.string().describe('Video id or youtube.com / youtu.be URL'), channel: channelArg(z).describe('The connected channel the video belongs to (default: the first connected)') },
    annotations: { readOnlyHint: true }
  }, ({ code, channel: ch }) => safe(async () => {
    const m = String(code).match(/(?:v=|shorts\/|youtu\.be\/|live\/)([A-Za-z0-9_-]{11})/) || String(code).trim().match(/^([A-Za-z0-9_-]{11})$/);
    if (!m) return json({ ok: false, error: 'Not a YouTube video id or URL.' });
    try { return json(await retention({ id: m[1], channel: ch })); } catch (e) { return fail(e); }
  }));
}
