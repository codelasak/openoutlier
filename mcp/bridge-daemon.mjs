#!/usr/bin/env node
// OpenOutlier – always-on bridge (no MCP). Run by launchd so the extension's data
// reaches ~/.reelscope/reelscope.db even when Claude Desktop / Claude Code are
// closed. MCP server instances share this bridge; if one of them already holds
// the port, this daemon waits and takes over when it goes away.
import { startBridge } from './bridge.mjs';
import { store, DB_FILE } from './library.mjs';

const log = (...a) => console.error(new Date().toISOString(), '[reelscope-bridge]', ...a);

store(); // open (and migrate) the database right away
log('database', DB_FILE, JSON.stringify(store().stats()));

let bridge = await startBridge();
setInterval(async () => {
  if (bridge.server) return;
  try {
    const r = await fetch(`http://127.0.0.1:${bridge.port}/health`, { signal: AbortSignal.timeout(1500) });
    if ((await r.json()).app === 'reelscope') return; // someone else serves it
  } catch { /* gone */ }
  bridge = await startBridge();
  if (bridge.server) {
    // An older MCP server may have written library.json while it held the port.
    store().migrateJson();
    log('took over the bridge on port', bridge.port, JSON.stringify(store().stats()));
  }
}, 30000);

function stop(sig) {
  log('stopping on', sig);
  try { bridge.server?.close(); } catch { /* ignore */ }
  try { store().close(); } catch { /* ignore */ }
  process.exit(0);
}
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
