// OpenOutlier MCP – localhost bridge the browser extension talks to.
//
// Port: the first free port in 47811–47820 (or OPENOUTLIER_PORT). If a port is
// taken by another OpenOutlier instance (e.g. Claude Desktop and Claude Code
// both started one) we share it: all instances use the same files in
// ~/.openoutlier. If it's taken by some other program, we try the next port.
// The extension scans the same range and only talks to a server whose
// /health answers {"app":"reelscope"}.
//
// Security: binds to 127.0.0.1 only; rejects requests whose Host isn't
// 127.0.0.1/localhost (DNS rebinding) and whose Origin isn't a
// chrome-extension:// origin (so websites can't read or write your library).
// The first extension that connects is remembered; others are refused.
import { setting } from './env.mjs';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  HOME, ensureHome, readLibrary, applySync, writeStatus, readStatus,
  takePendingCommands, saveCommandResult
} from './library.mjs';
import { startJob, jobStatus, isVideoId, isAccountId } from './youtube-dl.mjs';
import * as YA from './youtube-analytics.mjs';
import { apiKeyInfo, saveApiKey, removeApiKey, setExtensionQuota, quota as apiQuota, bridgeQuotaState, A as YAPI } from './youtube-api.mjs';
import { store } from './library.mjs';
import * as NICHE from './niche.mjs';
import * as OWN from './own-history.mjs';
import * as CARDS from './cards.mjs';
import * as CONTENT from './content.mjs';
import * as DISC from './discovery.mjs';
import * as PROV from './providers/index.mjs';
import * as SB from './providers/socialblade.mjs';
import * as DFS from './providers/dataforseo.mjs';
import { createRequire } from 'node:module';

const Features = createRequire(import.meta.url)('../src/features.js');

// OPENOUTLIER_PORT (or the former REELSCOPE_PORT) moves the start of the range (the extension scans 47811–47820).
const FIRST_PORT = Number(setting('PORT')) || 47811;
export const PORTS = Array.from({ length: 10 }, (_, i) => FIRST_PORT + i);
const CONFIG_FILE = join(HOME, 'config.json');
const MAX_BODY = 200 * 1024 * 1024;
const VERSION = '0.1.0';
// What this bridge can do beyond sync + commands (the extension checks before offering YouTube video downloads).
// 'settings': POST /settings (feature flags + quota) and /settings/youtube-api-key; 'tracker': mcp/tracker.mjs;
// 'niche': niche tracking (the org's tracking list, /youtube/niche/*, breakout alerts in the settings answer).
// 'own-history': own-channel history (phase 2: several channels, /youtube/own/*, milestones in the settings answer).
// 'cards': phase 3's in-page badges and cards (/youtube/cards, /youtube/channel-card, /youtube/video-card).
// 'content-tools': phase 4 (/youtube/comments, /youtube/sponsors, title history in /youtube/video-card, sponsors on the niche page).
// 'discovery': phase 5 (/youtube/discovery/*: radar, channel map, similar channels and thumbnails, keyword ideas, co-recommendations).
// 'providers': phase 5's optional third-party providers (/providers*: status, keys, Social Blade backfill, DataForSEO ranks).
const FEATURES = ['youtube-download', 'youtube-analytics', 'settings', 'tracker', 'niche', 'own-history', 'cards', 'content-tools', 'discovery', 'providers'];

const log = (...a) => console.error('[openoutlier-mcp]', ...a); // stdout belongs to MCP
const seenWrittenAt = {}; // port → when "extension last seen" was last written to status.json

async function readConfig() {
  try { return JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8')); } catch { return {}; }
}
async function writeConfig(cfg) {
  await ensureHome();
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function send(res, status, body, origin) {
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
  if (origin) {
    headers['access-control-allow-origin'] = origin;
    headers['vary'] = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

async function handle(req, res, port) {
  const host = String(req.headers.host || '');
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 403, { error: 'bad host' });
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const origin = String(req.headers.origin || '');

  // Health is public (no data in it) so the extension can find us.
  if (req.method === 'GET' && url.pathname === '/health') {
    const lib = readLibrary();
    const st = readStatus();
    return send(res, 200, { app: 'reelscope', version: VERSION, features: FEATURES, syncId: lib.syncId, accounts: Object.keys(lib.accounts).length, syncedAt: lib.syncedAt,
      lastBackupAt: st.lastBackupAt || null, lastBackupOk: st.lastBackupAt ? !!st.lastBackupOk : null },
      origin.startsWith('chrome-extension://') ? origin : null);
  }

  // Google's sign-in redirect for "My YouTube channel" (a browser navigation: no extension Origin).
  // Only accepted with the one-time state that this computer created (mcp/youtube-analytics.mjs).
  if (req.method === 'GET' && url.pathname === YA.CALLBACK_PATH) {
    const page = await YA.callbackPage(url);
    // A new or reconnected channel: its history jobs start on the tracker's next tick.
    if (page.status === 200) { try { OWN.collectNow(store(), null); } catch { /* no tracker rows yet */ } }
    res.writeHead(page.status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'referrer-policy': 'no-referrer' });
    return res.end(page.html);
  }

  const m = origin.match(/^chrome-extension:\/\/([a-p]{32})$/);
  if (!m) return send(res, 403, { error: 'only the OpenOutlier extension may use this endpoint' });
  const cfg = await readConfig();
  if (cfg.extensionId && cfg.extensionId !== m[1]) {
    return send(res, 403, { error: `paired with another extension (${cfg.extensionId}). Delete ${CONFIG_FILE} to re-pair.` });
  }
  if (!cfg.extensionId) {
    await writeConfig({ ...cfg, extensionId: m[1], pairedAt: new Date().toISOString() });
    log('paired with extension', m[1]);
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type' });
    return res.end();
  }

  // "Extension last seen": at most every 10 s per port, and never a reason to fail the request
  // (the in-page cards send many requests at once).
  if (Date.now() - (seenWrittenAt[port] || 0) > 10_000) {
    seenWrittenAt[port] = Date.now();
    writeStatus({ extensionId: m[1], extensionSeenAt: Date.now(), port }).catch((e) => log('status write failed:', e.message));
  }

  // Chrome leaves the Origin header off an extension's GET requests to hosts it has permission
  // for, so a GET from the real extension never gets past the check above (it only ever arrived
  // from tests). The extension sends its reads as POST …?as=get instead: a POST always carries
  // its Origin. Treat those as the GET they stand for.
  const method = req.method === 'POST' && url.searchParams.get('as') === 'get' ? 'GET' : req.method;
  if (method !== req.method) req.resume(); // its "{}" body is not read

  if (req.method === 'POST' && url.pathname === '/sync') {
    const body = await readBody(req);
    const lib = await applySync({ full: !!body.full, accounts: body.accounts, org: body.org, watches: body.watches, mentions: body.mentions });
    // The tracking list lives in the org record (src/tracking.js): keep tracked_channels and its jobs in step.
    let tracking = null;
    try { tracking = NICHE.syncTracked(store(), lib); } catch (e) { log('niche tracking sync failed:', e.message); }
    return send(res, 200, { ok: true, syncId: lib.syncId, accounts: Object.keys(lib.accounts).length, tracking }, origin);
  }
  // Feature flags (src/features.js) and the extension's Data API unit count. Answers what the
  // bridge has set up, so the Features tab can say what is missing. Never echoes the key.
  if (req.method === 'POST' && url.pathname === '/settings') {
    const body = await readBody(req);
    const st = store();
    if (body.features && typeof body.features === 'object') {
      const next = Features.sanitize(body.features);
      if (JSON.stringify(next) !== JSON.stringify(st.getMeta('features', null))) st.setMeta('features', next);
    }
    if (body.quota) setExtensionQuota(body.quota);
    if (body.niche) {
      const n = NICHE.sanitizeSettings(body.niche);
      if (n && JSON.stringify(n) !== JSON.stringify(st.getMeta(NICHE.SETTINGS_META, null))) st.setMeta(NICHE.SETTINGS_META, n);
    }
    // Phase 5: the radar's keyword lists, thresholds and hl/gl (rs:settings.radar).
    if (body.radar && typeof body.radar === 'object') DISC.saveRadarSettings(st, body.radar);
    return send(res, 200, await settingsAnswer(), origin);
  }
  if (req.method === 'POST' && url.pathname === '/settings/youtube-api-key') {
    const body = await readBody(req);
    if (body.remove === true) {
      removeApiKey();
      log('removed the YouTube Data API key file');
      return send(res, 200, { ok: true, ...(await settingsAnswer()) }, origin);
    }
    const key = typeof body.key === 'string' ? body.key.trim() : '';
    if (!YAPI.isKey(key)) return send(res, 400, { error: 'That is not a YouTube Data API key.' }, origin);
    saveApiKey(key);
    log('saved the YouTube Data API key for background jobs');
    return send(res, 200, { ok: true, ...(await settingsAnswer()) }, origin);
  }
  if (method === 'GET' && url.pathname === '/commands') {
    return send(res, 200, { commands: await takePendingCommands() }, origin);
  }
  if (req.method === 'POST' && url.pathname === '/commands/result') {
    const body = await readBody(req);
    await saveCommandResult(String(body.id || ''), body.result || {});
    return send(res, 200, { ok: true }, origin);
  }
  // YouTube video files: yt-dlp on this computer (mcp/youtube-dl.mjs). Returns a job to poll.
  if (req.method === 'POST' && url.pathname === '/youtube/download') {
    const body = await readBody(req);
    const id = String(body.id || '');
    const what = body.what || 'video';
    if (!isVideoId(id)) return send(res, 400, { error: 'not a YouTube video id' }, origin);
    if (!['video', 'cover', 'both'].includes(what)) return send(res, 400, { error: 'what must be video, cover or both' }, origin);
    // Only the owner and format are taken from the extension (for the folder name until yt-dlp answers).
    const p = body.post && typeof body.post === 'object' ? body.post : {};
    const prev = isAccountId(String(p.owner || '')) ? { code: id, platform: 'youtube', owner: String(p.owner), type: ['short', 'live', 'video'].includes(p.type) ? p.type : undefined } : undefined;
    return send(res, 200, { ok: true, ...startJob({ id, what, prev }) }, origin);
  }
  const jm = url.pathname.match(/^\/youtube\/download\/([0-9a-f-]{36})$/);
  if (method === 'GET' && jm) {
    const st = jobStatus(jm[1]);
    return st ? send(res, 200, { ok: true, ...st }, origin) : send(res, 404, { error: 'unknown job (the bridge may have restarted)' }, origin);
  }
  // Niche tracking (mcp/niche.mjs): the Library's Niş Takibi page, one video's curve, breakout acks.
  if (method === 'GET' && url.pathname === '/youtube/niche/page') {
    const niche = url.searchParams.has('niche') ? url.searchParams.get('niche') : undefined;
    const tz = Number(url.searchParams.get('tz'));
    const page = NICHE.nichePage(store(), { niche, tzOffsetMin: Number.isFinite(tz) && Math.abs(tz) <= 14 * 60 ? tz : undefined, status: nicheStatus() });
    // Phase 4: who the niche's channels promote (channel-sponsors).
    if (Features.resolve(store().getMeta('features', null))['channel-sponsors']) {
      try { const sp = CONTENT.sponsorMentions(store(), { niche: page.niche != null ? page.niche : niche, days: 365, limit: 30 }); if (!sp.error) page.sponsors = sp; } catch (e) { log('sponsor scan failed:', e.message); }
    }
    return send(res, 200, page, origin);
  }
  if (method === 'GET' && url.pathname === '/youtube/niche/video') {
    const r = NICHE.videoVelocity(store(), { video: url.searchParams.get('id') || '' });
    return send(res, r.error ? 404 : 200, r.error ? { ok: false, error: r.error } : { ok: true, ...r }, origin);
  }
  if (req.method === 'POST' && url.pathname === '/youtube/niche/alerts/ack') {
    const body = await readBody(req);
    return send(res, 200, { ok: true, acked: NICHE.ackAlerts(store(), Array.isArray(body.alerts) ? body.alerts.slice(0, 200) : []) }, origin);
  }
  // In-page badges and cards (mcp/cards.mjs): read only, from the tracker's and Analytics' rows.
  if (req.method === 'POST' && url.pathname === '/youtube/cards') {
    const body = await readBody(req);
    return send(res, 200, { ok: true, ...CARDS.cardsLookup(store(), { videos: Array.isArray(body.videos) ? body.videos : [], channels: Array.isArray(body.channels) ? body.channels : [] }) }, origin);
  }
  if (method === 'GET' && url.pathname === '/youtube/channel-card') {
    const r = CARDS.channelCard(store(), { channel: url.searchParams.get('channel') || '' });
    return send(res, r.error ? 400 : 200, r.error ? { ok: false, error: r.error } : { ok: true, ...r }, origin);
  }
  if (method === 'GET' && url.pathname === '/youtube/video-card') {
    const r = CARDS.videoCard(store(), { video: url.searchParams.get('id') || '' });
    return send(res, r.error ? 400 : 200, r.error ? { ok: false, error: r.error } : { ok: true, ...r }, origin);
  }
  // Content tools (mcp/content.mjs): comments the extension captured (kept 7 days), sponsor scans.
  if (req.method === 'POST' && url.pathname === '/youtube/comments') {
    const body = await readBody(req);
    if (!Features.resolve(store().getMeta('features', null))['comment-tools']) return send(res, 200, { ok: false, off: true }, origin);
    const r = CONTENT.putComments(store(), { video: body.video, title: body.title, channel_id: body.channel_id, total: body.total, comments: Array.isArray(body.comments) ? body.comments.slice(0, CONTENT.MAX_PER_VIDEO) : [] });
    return send(res, r.ok ? 200 : 400, r, origin);
  }
  if (method === 'GET' && url.pathname === '/youtube/sponsors') {
    const r = CONTENT.channelSponsors(store(), { channel: url.searchParams.get('channel') || '' });
    return send(res, r.error ? 400 : 200, r.error ? { ok: false, error: r.error } : { ok: true, ...r }, origin);
  }
  // Discovery (phase 5, mcp/discovery.mjs): radar, channel map, similar channels / thumbnails, keyword ideas.
  if (req.method === 'POST' && url.pathname === '/youtube/discovery/corec') {
    const body = await readBody(req);
    const r = DISC.putCoRecs(store(), { source: body.source, recs: Array.isArray(body.recs) ? body.recs.slice(0, 40) : [] });
    return send(res, r.ok || r.off ? 200 : 400, r, origin);
  }
  if (url.pathname.startsWith('/youtube/discovery/')) {
    const q = url.searchParams;
    const niche = q.has('niche') ? q.get('niche').slice(0, 80) : undefined;
    if (method === 'GET' && url.pathname === '/youtube/discovery/radar') return send(res, 200, DISC.radarPage(store(), { niche }), origin);
    if (req.method === 'POST' && url.pathname === '/youtube/discovery/radar/run') {
      if (!Features.resolve(store().getMeta('features', null))['niche-radar']) return send(res, 200, { ok: false, off: true, error: 'The niche radar is switched off.' }, origin);
      return send(res, 200, DISC.radarRunNow(store()), origin);
    }
    if (method === 'GET' && url.pathname === '/youtube/discovery/map') return send(res, 200, DISC.channelMap(store(), { niche }), origin);
    if (method === 'GET' && url.pathname === '/youtube/discovery/similar') {
      const r = DISC.similarChannels(store(), { channel: q.get('channel') || '', limit: Math.min(30, Number(q.get('limit')) || 12) });
      return send(res, r.ok ? 200 : 404, r, origin);
    }
    if (method === 'GET' && url.pathname === '/youtube/discovery/thumbs') {
      const r = await DISC.similarThumbs(store(), { video: q.get('id') || '' });
      return send(res, r.ok ? 200 : 400, r, origin);
    }
    if (method === 'GET' && url.pathname === '/youtube/discovery/keywords') {
      const seed = q.get('seed') ? q.get('seed').slice(0, 100) : null;
      const r = await DISC.keywordIdeas(store(), { niche, seeds: seed ? [seed] : undefined, expand: q.get('expand') ? q.get('expand').slice(0, 100) : undefined,
        hl: q.get('hl') || undefined, gl: q.get('gl') || undefined, lang: q.get('lang') === 'tr' ? 'tr' : 'en' });
      return send(res, 200, r, origin);
    }
  }
  // Optional providers (mcp/providers/): status, keys (never echoed), Social Blade backfill, DataForSEO rank check.
  if (method === 'GET' && url.pathname === '/providers') return send(res, 200, { ok: true, providers: PROV.status(store()) }, origin);
  if (req.method === 'POST' && url.pathname === '/providers/key') {
    const body = await readBody(req);
    const id = String(body.id || '');
    const r = body.remove === true ? PROV.removeKey(id) : PROV.saveKey(id, body.key);
    if (r.ok) log(body.remove === true ? 'removed the key of provider' : 'saved the key of provider', id);
    return send(res, r.ok ? 200 : 400, { ...r, providers: PROV.status(store()) }, origin);
  }
  if (req.method === 'POST' && url.pathname === '/providers/socialblade/quote') {
    const body = await readBody(req);
    return send(res, 200, { ok: true, ...SB.quote(store(), { channels: Array.isArray(body.channels) ? body.channels.slice(0, 500) : undefined, history: body.history }) }, origin);
  }
  if (req.method === 'POST' && url.pathname === '/providers/socialblade/backfill') {
    const body = await readBody(req);
    const r = await SB.backfill(store(), { channels: Array.isArray(body.channels) ? body.channels.slice(0, 500) : undefined, history: body.history, confirm: body.confirm,
      on: !!Features.resolve(store().getMeta('features', null))['provider-socialblade'] });
    return send(res, 200, r, origin);
  }
  if (req.method === 'POST' && url.pathname === '/providers/dataforseo/check') {
    const s = DISC.radarSettings(store());
    const r = await DFS.checkRanks(store(), { keywords: s.rankKeywords, region: s.region, lang: s.lang, on: !!Features.resolve(store().getMeta('features', null))['provider-dataforseo'] });
    return send(res, 200, r, origin);
  }
  // Kanalım (mcp/own-history.mjs): the stored daily history of the connected channels.
  if (method === 'GET' && url.pathname === '/youtube/own/page') {
    const ch = url.searchParams.get('channel') || '';
    let status = null;
    try { status = await YA.status(); } catch { /* token side unknown */ }
    const flags = Features.resolve(store().getMeta('features', null));
    return send(res, 200, OWN.ownPage(store(), { channel: ch === 'all' || /^UC[A-Za-z0-9_-]{22}$/.test(ch) ? ch : undefined, status, flags }), origin);
  }
  if (req.method === 'POST' && url.pathname === '/youtube/own/refresh') {
    const body = await readBody(req);
    const ch = typeof body.channel === 'string' && /^UC[A-Za-z0-9_-]{22}$/.test(body.channel) ? body.channel : null;
    return send(res, 200, { ok: true, scheduled: OWN.collectNow(store(), ch) }, origin);
  }
  if (req.method === 'POST' && url.pathname === '/youtube/own/milestones/ack') {
    const body = await readBody(req);
    return send(res, 200, { ok: true, acked: OWN.ackMilestones(store(), Array.isArray(body.milestones) ? body.milestones.slice(0, 200) : []) }, origin);
  }
  // My YouTube channel (YouTube Analytics API, the user's own OAuth client).
  if (url.pathname.startsWith('/youtube/analytics/')) {
    const r = await YA.handleRoute(method, url, { port });
    if (r) return send(res, r[0], r[1], origin);
  }
  return send(res, 404, { error: 'not found' }, origin);
}

/** What the Niche page says about the background jobs (is the tracker able to run, the quota). */
function nicheStatus() {
  const flags = Features.resolve(store().getMeta('features', null));
  const key = apiKeyInfo();
  const st = store().getMeta('tracker_state', null);
  return { tracker: !!flags.tracker, breakout_alerts: !!flags['breakout-alerts'], weekly_digest: !!flags['weekly-digest'], api_key: !!key.key,
    last_tick_at: st && st.lastTickAt || null, quota: apiQuota() };
}

async function settingsAnswer() {
  const key = apiKeyInfo();
  let oauth = { configured: false, connected: false };
  try { const a = await YA.status(); oauth = { configured: !!a.configured, connected: !!a.connected, channels: (a.channels || []).length, needs_reconsent: !!a.needs_reconsent, reconnect: !!a.reconnect }; } catch { /* unknown */ }
  return {
    ok: true,
    features: Features.resolve(store().getMeta('features', null)),
    apiKey: { configured: !!key.key, source: key.source },
    oauth,
    quota: apiQuota(),
    bridgeQuota: bridgeQuotaState() || null,
    // Breakouts the extension hasn't shown as a Chrome notification yet (it acks them).
    niche: (() => { try { return { tracked: store().db.prepare('SELECT COUNT(*) AS n FROM tracked_channels WHERE active = 1').get().n, alerts: NICHE.pendingAlerts(store()), settings: NICHE.nicheSettings(store()) }; } catch { return null; } })(),
    // New milestones of the connected channels (the extension notifies when own-milestones is on, and acks).
    own: (() => { try { return { channels: OWN.ownChannels(store()).length, milestones: OWN.pendingMilestones(store()) }; } catch { return null; } })(),
    // Phase 5: the optional providers (on / key set / scraping), never the keys.
    providers: (() => { try { return PROV.status(store()); } catch { return null; } })()
  };
}

async function probe(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
    const j = await r.json();
    return j && j.app === 'reelscope';
  } catch {
    return false;
  }
}

function listen(port) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      handle(req, res, port).catch((e) => { log('request failed', e.message); send(res, 500, { error: 'internal error' }); });
    });
    server.once('error', (e) => resolve({ error: e }));
    server.listen(port, '127.0.0.1', () => resolve({ server }));
  });
}

/** Start the bridge, or join an existing OpenOutlier bridge. Returns { port, shared }. */
export async function startBridge() {
  await ensureHome();
  for (const port of PORTS) {
    const r = await listen(port);
    if (r.server) {
      log(`bridge listening on http://127.0.0.1:${port}`);
      await writeStatus({ bridgePort: port, bridgeStartedAt: Date.now() });
      return { port, shared: false, server: r.server };
    }
    if (r.error && r.error.code === 'EADDRINUSE') {
      if (await probe(port)) {
        log(`another OpenOutlier bridge is already on port ${port}; sharing it`);
        return { port, shared: true };
      }
      log(`port ${port} is used by another program; trying the next one`);
      continue;
    }
    log('could not listen on', port, r.error && r.error.message);
  }
  log('no free port in', PORTS.join(', '), '- the extension cannot sync until one is free');
  return { port: null, shared: false };
}
