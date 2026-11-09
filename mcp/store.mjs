// ReelScope – the library on disk: one SQLite file, ~/.reelscope/reelscope.db.
//
// The extension pushes its data through the bridge; this module stores it.
// Every MCP server instance reads the same file (WAL mode, so readers never
// block the writer).
//
// Safety rules (the data matters more than tidiness):
// • A "full" sync only adds and updates. It never deletes, so a reinstalled
//   extension with empty storage can't wipe the library.
// • An account is deleted only when the extension explicitly says so
//   (incremental sync with `null`, i.e. you pressed Clear/Delete).
// • Every time a post's numbers change, a dated row goes into `snapshots`,
//   so growth over time is kept even though posts only store the latest values.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, renameSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const COUNT_FIELDS = ['views', 'likes', 'comments', 'shares', 'saves'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS accounts (
  id         TEXT PRIMARY KEY,          -- instagram: username · reddit: r/x, u/x · tiktok: tt/x
  platform   TEXT,
  profile    TEXT,                      -- JSON (TikTok followers etc.)
  updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS posts (
  account_id TEXT NOT NULL,
  code       TEXT NOT NULL,
  data       TEXT NOT NULL,             -- the full post record as JSON
  views INTEGER, likes INTEGER, comments INTEGER, shares INTEGER, saves INTEGER,
  taken_at   INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, code)
);
CREATE TABLE IF NOT EXISTS snapshots (
  account_id TEXT NOT NULL,
  code       TEXT NOT NULL,
  seen_at    INTEGER NOT NULL,
  views INTEGER, likes INTEGER, comments INTEGER, shares INTEGER, saves INTEGER,
  PRIMARY KEY (account_id, code, seen_at)
);
CREATE INDEX IF NOT EXISTS snapshots_by_code ON snapshots (code, seen_at);
`;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

export class Store {
  constructor(home) {
    this.home = home;
    this.file = join(home, 'reelscope.db');
    mkdirSync(home, { recursive: true });
    const fresh = !existsSync(this.file);
    this.db = new DatabaseSync(this.file);
    if (fresh) { try { chmodSync(this.file, 0o600); } catch { /* ignore */ } }
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = OFF;');
    this.db.exec(SCHEMA);
    if (this.getMeta('syncId') == null) this.setMeta('syncId', randomUUID());
    this.cache = { revision: -1, lib: null };
    this.migrateJson();
  }

  close() { try { this.db.close(); } catch { /* ignore */ } }

  getMeta(key, fallback = null) {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    if (!row) return fallback;
    try { return JSON.parse(row.value); } catch { return fallback; }
  }
  setMeta(key, value) {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
  }
  revision() { return this.getMeta('revision', 0); }

  /**
   * Import ~/.reelscope/library.json (written by older ReelScope versions) and
   * rename it. Safe to run any number of times: it only adds and updates, so
   * a file written by an old MCP server that's still running gets merged in
   * the next time this runs (daemon takeover, a new MCP server, …).
   */
  migrateJson() {
    const old = join(this.home, 'library.json');
    if (!existsSync(old)) return;
    try {
      const firstImport = this.db.prepare('SELECT COUNT(*) AS n FROM posts').get().n === 0;
      const lib = JSON.parse(readFileSync(old, 'utf8'));
      this.applySync({ full: true, accounts: lib.accounts || {}, org: lib.org, watches: lib.watches, mentions: lib.mentions });
      if (firstImport && lib.syncId) this.setMeta('syncId', lib.syncId); // keep the extension's sync id
    } catch (e) {
      console.error('[reelscope] could not import library.json:', e.message);
      return; // keep the JSON file, try again next time
    }
    try { renameSync(old, old + '.migrated'); } catch { /* ignore */ }
  }

  /**
   * Apply a sync from the extension.
   * accounts: { id: { posts: {code: post}, updatedAt, platform?, profile? } | null }
   * full: true = the extension's complete library (upsert only, never delete).
   */
  applySync({ full = false, accounts = {}, org, watches, mentions } = {}) {
    const now = Date.now();
    const upAccount = this.db.prepare(`INSERT INTO accounts (id, platform, profile, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET platform = COALESCE(excluded.platform, accounts.platform),
        profile = COALESCE(excluded.profile, accounts.profile), updated_at = MAX(COALESCE(accounts.updated_at, 0), excluded.updated_at)`);
    const oldPost = this.db.prepare('SELECT views, likes, comments, shares, saves FROM posts WHERE account_id = ? AND code = ?');
    const upPost = this.db.prepare(`INSERT INTO posts (account_id, code, data, views, likes, comments, shares, saves, taken_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, code) DO UPDATE SET data = excluded.data, views = excluded.views, likes = excluded.likes,
        comments = excluded.comments, shares = excluded.shares, saves = excluded.saves,
        taken_at = COALESCE(excluded.taken_at, posts.taken_at), updated_at = excluded.updated_at`);
    const snap = this.db.prepare(`INSERT OR IGNORE INTO snapshots (account_id, code, seen_at, views, likes, comments, shares, saves)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const delPosts = this.db.prepare('DELETE FROM posts WHERE account_id = ?');
    const delSnaps = this.db.prepare('DELETE FROM snapshots WHERE account_id = ?');
    const delAccount = this.db.prepare('DELETE FROM accounts WHERE id = ?');

    let posts = 0;
    let snapshots = 0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const [id, rec] of Object.entries(accounts || {})) {
        if (!rec || !rec.posts) {
          if (full) continue; // never delete on a full sync
          delPosts.run(id); delSnaps.run(id); delAccount.run(id);
          continue;
        }
        upAccount.run(id, rec.platform || null, rec.profile && typeof rec.profile === 'object' ? JSON.stringify(rec.profile) : null, num(rec.updatedAt) || now);
        for (const [code, p] of Object.entries(rec.posts)) {
          if (!p || typeof p !== 'object') continue;
          const counts = COUNT_FIELDS.map((f) => num(p[f]));
          const prev = oldPost.get(id, code);
          upPost.run(id, code, JSON.stringify(p), ...counts, num(p.takenAt), now);
          posts++;
          const changed = !prev || COUNT_FIELDS.some((f, i) => (prev[f] ?? null) !== counts[i]);
          if (changed && counts.some((c) => c !== null)) {
            // First sighting: when the extension saw it. Later changes: now.
            snap.run(id, code, prev ? now : (num(p.seenAt) || now), ...counts);
            snapshots++;
          }
        }
      }
      if (org && typeof org === 'object') this.setMeta('org', org);
      if (Array.isArray(watches)) this.setMeta('watches', watches);
      if (mentions && typeof mentions === 'object') this.setMeta('mentions', { items: mentions.items || {}, read: mentions.read || {} });
      this.setMeta('syncedAt', now);
      this.setMeta('revision', this.revision() + 1);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return { posts, snapshots };
  }

  /** The library in the shape the query code expects (cached per revision). */
  readLibrary() {
    const rev = this.revision();
    if (this.cache.lib && this.cache.revision === rev) return this.cache.lib;
    const accounts = {};
    for (const a of this.db.prepare('SELECT id, platform, profile, updated_at FROM accounts').all()) {
      accounts[a.id] = { posts: {}, updatedAt: a.updated_at };
      if (a.platform) accounts[a.id].platform = a.platform;
      if (a.profile) { try { accounts[a.id].profile = JSON.parse(a.profile); } catch { /* ignore */ } }
    }
    for (const r of this.db.prepare('SELECT account_id, code, data FROM posts').all()) {
      if (!accounts[r.account_id]) accounts[r.account_id] = { posts: {}, updatedAt: null };
      try { accounts[r.account_id].posts[r.code] = JSON.parse(r.data); } catch { /* skip a broken row */ }
    }
    const org = this.getMeta('org', null);
    const mentions = this.getMeta('mentions', null);
    const lib = {
      syncId: this.getMeta('syncId'),
      syncedAt: this.getMeta('syncedAt', null),
      accounts,
      org: org && Array.isArray(org.folders) ? org : { folders: [], accounts: {} },
      watches: this.getMeta('watches', []),
      mentions: mentions && mentions.items ? mentions : { items: {}, read: {} }
    };
    this.cache = { revision: rev, lib };
    return lib;
  }

  /** Dated count history of one post (oldest first). */
  history(code) {
    return this.db.prepare(`SELECT account_id, seen_at, views, likes, comments, shares, saves FROM snapshots
      WHERE code = ? ORDER BY seen_at`).all(code);
  }

  stats() {
    const one = (sql) => this.db.prepare(sql).get().n;
    return {
      accounts: one('SELECT COUNT(*) AS n FROM accounts'),
      posts: one('SELECT COUNT(*) AS n FROM posts'),
      snapshots: one('SELECT COUNT(*) AS n FROM snapshots')
    };
  }

  /** Consistent copy of the whole database (safe while the bridge is writing). */
  backupTo(target) {
    this.db.prepare('VACUUM INTO ?').run(target);
  }
}

let shared = null;
/** One Store per process. */
export function openStore(home) {
  if (!shared || shared.home !== home) shared = new Store(home);
  return shared;
}
