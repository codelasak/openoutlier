// OpenOutlier MCP – localhost bridge the browser extension talks to.
//
// Port: the first free port in 47811–47820 (or REELSCOPE_PORT). If a port is
// taken by another OpenOutlier instance (e.g. Claude Desktop and Claude Code
// both started one) we share it: all instances use the same files in
// ~/.reelscope. If it's taken by some other program, we try the next port.
// The extension scans the same range and only talks to a server whose
// /health answers {"app":"reelscope"}.
//
// Security: binds to 127.0.0.1 only; rejects requests whose Host isn't
// 127.0.0.1/localhost (DNS rebinding) and whose Origin isn't a
// chrome-extension:// origin (so websites can't read or write your library).
// The first extension that connects is remembered; others are refused.
import http from 'node:http';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  HOME, ensureHome, readLibrary, applySync, writeStatus, readStatus,
  takePendingCommands, saveCommandResult
} from './library.mjs';

// REELSCOPE_PORT moves the start of the range (the extension scans 47811–47820).
const FIRST_PORT = Number(process.env.REELSCOPE_PORT) || 47811;
export const PORTS = Array.from({ length: 10 }, (_, i) => FIRST_PORT + i);
const CONFIG_FILE = join(HOME, 'config.json');
const MAX_BODY = 200 * 1024 * 1024;
const VERSION = '0.1.0';

const log = (...a) => console.error('[reelscope-mcp]', ...a); // stdout belongs to MCP

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
    return send(res, 200, { app: 'reelscope', version: VERSION, syncId: lib.syncId, accounts: Object.keys(lib.accounts).length, syncedAt: lib.syncedAt,
      lastBackupAt: st.lastBackupAt || null, lastBackupOk: st.lastBackupAt ? !!st.lastBackupOk : null },
      origin.startsWith('chrome-extension://') ? origin : null);
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

  if (req.method === 'POST' && url.pathname === '/sync') {
    const body = await readBody(req);
    const lib = await applySync({ full: !!body.full, accounts: body.accounts, org: body.org, watches: body.watches, mentions: body.mentions });
    return send(res, 200, { ok: true, syncId: lib.syncId, accounts: Object.keys(lib.accounts).length }, origin);
  }
  if (req.method === 'GET' && url.pathname === '/commands') {
    return send(res, 200, { commands: await takePendingCommands() }, origin);
  }
  if (req.method === 'POST' && url.pathname === '/commands/result') {
    const body = await readBody(req);
    await saveCommandResult(String(body.id || ''), body.result || {});
    return send(res, 200, { ok: true }, origin);
  }
  return send(res, 404, { error: 'not found' }, origin);
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
