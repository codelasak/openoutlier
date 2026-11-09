#!/usr/bin/env node
// ReelScope – daily backup of ~/.reelscope/reelscope.db to the home server.
//
//   node mcp/backup.mjs            once a day (skips if today's backup already succeeded)
//   node mcp/backup.mjs --force    run again anyway
//   node mcp/backup.mjs --no-upload  local copy only
//
// Steps: consistent copy with SQLite's VACUUM INTO (safe while the bridge is
// writing) → integrity check → gzip → keep the last 7 locally in
// ~/.reelscope/backups → upload over SSH/Tailscale to
// REELSCOPE_BACKUP_REMOTE (default hayati-ts:/mnt/storage/backups/reelscope),
// verify the checksum there, keep the last 30 remotely.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { createGzip } from 'node:zlib';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { HOME, store, writeStatus, readStatus } from './library.mjs';

const run = promisify(execFile);
const args = new Set(process.argv.slice(2));
const REMOTE = process.env.REELSCOPE_BACKUP_REMOTE ?? 'hayati-ts:/mnt/storage/backups/reelscope';
const KEEP_LOCAL = Number(process.env.REELSCOPE_BACKUP_KEEP_LOCAL || 7);
const KEEP_REMOTE = Number(process.env.REELSCOPE_BACKUP_KEEP_REMOTE || 30);
const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20'];
const log = (...a) => console.error(new Date().toISOString(), '[reelscope-backup]', ...a);

const localDay = (t = Date.now()) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

async function sha256(file) {
  const h = createHash('sha256');
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

async function main() {
  const st = readStatus();
  if (!args.has('--force') && st.lastBackupOk && st.lastBackupAt && localDay(st.lastBackupAt) === localDay()) {
    log('today\'s backup already succeeded at', new Date(st.lastBackupAt).toISOString(), '— nothing to do (use --force to run again)');
    return;
  }

  const dir = join(HOME, 'backups');
  await fs.mkdir(dir, { recursive: true });
  const name = `reelscope-${localDay()}.db.gz`;
  const tmp = join(dir, `.tmp-${process.pid}.db`);
  const out = join(dir, name);
  await fs.rm(tmp, { force: true });

  // 1. consistent copy
  store().backupTo(tmp);

  // 2. verify it before trusting it
  const copy = new DatabaseSync(tmp, { readOnly: true });
  const integrity = copy.prepare('PRAGMA integrity_check').get().integrity_check;
  const counts = {
    accounts: copy.prepare('SELECT COUNT(*) AS n FROM accounts').get().n,
    posts: copy.prepare('SELECT COUNT(*) AS n FROM posts').get().n,
    snapshots: copy.prepare('SELECT COUNT(*) AS n FROM snapshots').get().n
  };
  copy.close();
  if (integrity !== 'ok') throw new Error('integrity check failed: ' + integrity);

  // 3. compress
  await pipeline(createReadStream(tmp), createGzip({ level: 9 }), createWriteStream(out, { mode: 0o600 }));
  await fs.rm(tmp, { force: true });
  const bytes = (await fs.stat(out)).size;
  const sum = await sha256(out);
  log(`local copy ${out} (${bytes} bytes, ${counts.accounts} accounts, ${counts.posts} posts, ${counts.snapshots} snapshots)`);

  // 4. keep the last N locally
  const local = (await fs.readdir(dir)).filter((f) => /^reelscope-\d{4}-\d{2}-\d{2}\.db\.gz$/.test(f)).sort().reverse();
  for (const f of local.slice(KEEP_LOCAL)) await fs.rm(join(dir, f), { force: true });

  // 5. upload + verify + prune remotely
  let remote = null;
  if (!args.has('--no-upload') && REMOTE) {
    const i = REMOTE.indexOf(':');
    if (i < 1) throw new Error('REELSCOPE_BACKUP_REMOTE must look like host:/path');
    const host = REMOTE.slice(0, i);
    const path = REMOTE.slice(i + 1);
    await run('ssh', [...SSH_OPTS, host, `mkdir -p ${shQuote(path)}`]);
    await run('scp', ['-q', ...SSH_OPTS, out, `${host}:${path}/${name}.part`]);
    const { stdout } = await run('ssh', [...SSH_OPTS, host,
      `cd ${shQuote(path)} && mv -f ${shQuote(name + '.part')} ${shQuote(name)} && sha256sum ${shQuote(name)} | cut -d' ' -f1 && ` +
      `ls -1t reelscope-*.db.gz | tail -n +${KEEP_REMOTE + 1} | xargs -r rm -f --`]);
    const remoteSum = stdout.trim().split('\n')[0];
    if (remoteSum !== sum) throw new Error(`checksum mismatch after upload (local ${sum}, remote ${remoteSum})`);
    remote = `${REMOTE}/${name}`;
    log('uploaded and verified', remote);
  }

  await writeStatus({ lastBackupAt: Date.now(), lastBackupOk: true, lastBackupError: null, lastBackupFile: out, lastBackupRemote: remote, lastBackupBytes: bytes, lastBackupCounts: counts });
}

main().then(() => process.exit(0), async (e) => {
  log('FAILED:', e.message);
  try { await writeStatus({ lastBackupAt: Date.now(), lastBackupOk: false, lastBackupError: e.message }); } catch { /* ignore */ }
  process.exit(1);
});
