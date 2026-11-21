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
import { createRequire } from 'node:module';

const Features = createRequire(import.meta.url)('../src/features.js');

// OPENOUTLIER_PORT (or the former REELSCOPE_PORT) moves the start of the range (the extension scans 47811–47820).
const FIRST_PORT = Number(setting('PORT')) || 47811;
export const PORTS = Array.from({ length: 10 }, (_, i) => FIRST_PORT + i);
const CONFIG_FILE = join(HOME, 'config.json');
const MAX_BODY = 200 * 1024 * 1024;
const VERSION = '0.1.0';
// What this bridge can do beyond sync + commands (the extension checks before offering YouTube video downloads).
// 'settings': POST /settings (feature flags + quota) and /settings/youtube-api-key; 'tracker': mcp/tracker.mjs.
const FEATURES = ['youtube-download', 'youtube-analytics', 'settings', 'tracker'];

const log = (...a) => console.error('[openoutlier-mcp]', ...a); // stdout belongs to MCP

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

  await writeStatus({ extensionId: m[1], extensionSeenAt: Date.now(), port });

  // Chrome leaves the Origin header off an extension's GET requests to hosts it has permission
  // for, so a GET from the real extension never gets past the check above (it only ever arrived
  // from tests). The extension sends its reads as POST …?as=get instead: a POST always carries
  // its Origin. Treat those as the GET they stand for.
  const method = req.method === 'POST' && url.searchParams.get('as') === 'get' ? 'GET' : req.method;
  if (method !== req.method) req.resume(); // its "{}" body is not read

  if (req.method === 'POST' && url.pathname === '/sync') {
    const body = await readBody(req);
    const lib = await applySync({ full: !!body.full, accounts: body.accounts, org: body.org, watches: body.watches, mentions: body.mentions });
    return send(res, 200, { ok: true, syncId: lib.syncId, accounts: Object.keys(lib.accounts).length }, origin);
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
  // My YouTube channel (YouTube Analytics API, the user's own OAuth client).
  if (url.pathname.startsWith('/youtube/analytics/')) {
    const r = await YA.handleRoute(method, url, { port });
    if (r) return send(res, r[0], r[1], origin);
  }
  return send(res, 404, { error: 'not found' }, origin);
}

async function settingsAnswer() {
  const key = apiKeyInfo();
  let oauth = { configured: false, connected: false };
  try { const a = await YA.status(); oauth = { configured: !!a.configured, connected: !!a.connected }; } catch { /* unknown */ }
  return {
    ok: true,
    features: Features.resolve(store().getMeta('features', null)),
    apiKey: { configured: !!key.key, source: key.source },
    oauth,
    quota: apiQuota(),
    bridgeQuota: bridgeQuotaState() || null
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
