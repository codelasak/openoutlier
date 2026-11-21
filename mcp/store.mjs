// OpenOutlier – the library on disk: one SQLite file, ~/.openoutlier/openoutlier.db
// (~/.reelscope/reelscope.db on installs not yet moved from the ReelScope name).
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
import { dbFile } from './env.mjs';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, renameSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

// YouTube records carry rounded vs exact counts and relative vs exact dates;
// src/youtube.js `merge` keeps the better value, so a sync with the
// extension's rounded copy can't undo exact numbers from yt-dlp or a watch page.
const Y = createRequire(import.meta.url)('../src/youtube.js');
const isYouTubePost = (id, p) => (p && p.platform === 'youtube') || String(id).startsWith('yt/');

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

// YouTube niche tracking and own-channel history (docs/youtube-niche-plan.md 2.2, 3.1).
// Every statement is IF NOT EXISTS, so running it again is harmless; MIGRATIONS
// below records which steps ran (meta schema_version) for later ALTERs.
const SCHEMA_YOUTUBE_NICHE = `
CREATE TABLE IF NOT EXISTS tracked_channels (
  channel_id     TEXT PRIMARY KEY,      -- UC…
  account_id     TEXT,                  -- yt/handle (or yt/UC…) in the library, when saved there
  niche          TEXT,                  -- folder / tag name marked as a tracked niche
  mine           INTEGER NOT NULL DEFAULT 0,
  added_at       INTEGER NOT NULL,
  rss_checked_at INTEGER,
  active         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS tracked_channels_by_niche ON tracked_channels (niche, active);
CREATE TABLE IF NOT EXISTS video_stats (
  video_id TEXT NOT NULL,
  ts       INTEGER NOT NULL,            -- ms
  views INTEGER, likes INTEGER, comments INTEGER,
  source   TEXT NOT NULL,               -- api | rss | page
  PRIMARY KEY (video_id, ts)
);
CREATE INDEX IF NOT EXISTS video_stats_by_source ON video_stats (source, ts);
CREATE TABLE IF NOT EXISTS video_meta_log (
  video_id   TEXT NOT NULL,
  ts         INTEGER NOT NULL,
  title      TEXT,
  thumb_hash TEXT,                      -- perceptual hash: the URL can stay while the image changes
  duration   INTEGER,
  PRIMARY KEY (video_id, ts)
);
CREATE TABLE IF NOT EXISTS channel_stats (
  channel_id TEXT NOT NULL,
  day        TEXT NOT NULL,             -- YYYY-MM-DD
  subs INTEGER, views INTEGER, videos INTEGER,
  source     TEXT NOT NULL DEFAULT 'api',
  PRIMARY KEY (channel_id, day)
);
CREATE TABLE IF NOT EXISTS tracker_jobs (
  id           TEXT PRIMARY KEY,        -- 'heartbeat', 'video:<id>', 'channel:<UC…>' …
  kind         TEXT NOT NULL,
  video_id     TEXT,
  channel_id   TEXT,
  published_at INTEGER,
  next_at      INTEGER NOT NULL,
  tier         TEXT,
  last_run_at  INTEGER,
  last_ok      INTEGER,
  last_error   TEXT,
  runs         INTEGER NOT NULL DEFAULT 0,
  fails        INTEGER NOT NULL DEFAULT 0,
  data         TEXT                     -- JSON, job specific
);
CREATE INDEX IF NOT EXISTS tracker_jobs_due ON tracker_jobs (next_at);
CREATE INDEX IF NOT EXISTS tracker_jobs_by_video ON tracker_jobs (video_id);
CREATE TABLE IF NOT EXISTS own_daily (
  channel_id TEXT NOT NULL,
  day        TEXT NOT NULL,
  metric     TEXT NOT NULL,             -- JSON
  updated_at INTEGER,
  PRIMARY KEY (channel_id, day)
);
CREATE TABLE IF NOT EXISTS own_video_daily (
  video_id   TEXT NOT NULL,
  day        TEXT NOT NULL,
  metric     TEXT NOT NULL,             -- JSON
  updated_at INTEGER,
  PRIMARY KEY (video_id, day)
);
CREATE TABLE IF NOT EXISTS own_breakdowns (
  channel_id TEXT NOT NULL,
  week       TEXT NOT NULL,             -- YYYY-MM-DD of the week's Monday
  kind       TEXT NOT NULL,             -- traffic | search_terms | countries | age_gender | devices | subscribed | playback
  data       TEXT NOT NULL,             -- JSON
  updated_at INTEGER,
  PRIMARY KEY (channel_id, week, kind)
);
`;

// Phase 1 (niche tracking): the videos the tracker knows (title, publish time, format,
// thumbnail and its perceptual hash), breakout alerts and the weekly digests.
const SCHEMA_NICHE_TRACKING = `
CREATE TABLE IF NOT EXISTS tracked_videos (
  video_id         TEXT PRIMARY KEY,
  channel_id       TEXT NOT NULL,
  published_at     INTEGER,
  type             TEXT,                -- video | short | live
  title            TEXT,
  thumb            TEXT,
  duration         INTEGER,             -- seconds (Data API)
  keywords         TEXT,                -- JSON array of tags (Data API)
  first_seen       INTEGER NOT NULL,
  found_by         TEXT,                -- rss | backfill | page
  thumb_hash       TEXT,                -- latest perceptual hash (mcp/thumbhash.mjs)
  thumb_checked_at INTEGER,
  updated_at       INTEGER
);
CREATE INDEX IF NOT EXISTS tracked_videos_by_channel ON tracked_videos (channel_id, published_at);
CREATE TABLE IF NOT EXISTS niche_alerts (
  video_id    TEXT NOT NULL,
  at_h        INTEGER NOT NULL,         -- the checkpoint (6 or 24 h)
  score       REAL NOT NULL,            -- views ÷ expected
  views       INTEGER,
  expected    INTEGER,
  created_at  INTEGER NOT NULL,
  notified_at INTEGER,                  -- when the extension showed the Chrome notification
  PRIMARY KEY (video_id, at_h)
);
CREATE TABLE IF NOT EXISTS niche_reports (
  week       TEXT PRIMARY KEY,          -- YYYY-MM-DD of the Monday
  data       TEXT NOT NULL,             -- JSON
  created_at INTEGER NOT NULL
);
`;

// Phase 2 (own-channel history, docs/youtube-niche-plan.md 3): the connected channels
// and how far their history is collected, the channel's own videos (title, publish
// time, format) and milestones (with when the extension showed them).
const SCHEMA_OWN_HISTORY = `
CREATE TABLE IF NOT EXISTS own_channels (
  channel_id         TEXT PRIMARY KEY,  -- UC…
  title              TEXT,
  handle             TEXT,
  thumb              TEXT,
  created            TEXT,              -- channel creation day (YYYY-MM-DD)
  connected_at       INTEGER,
  subs               INTEGER,           -- latest subscriberCount (Data API; rounded above 1,000)
  views_total        INTEGER,
  videos             INTEGER,
  backfill_from      TEXT,              -- oldest day the backfill has reached (it walks back from today)
  backfill_done      INTEGER NOT NULL DEFAULT 0,
  last_daily_at      INTEGER,
  last_videos_at     INTEGER,
  last_weekly_at     INTEGER,
  revenue_state      TEXT,              -- ok | none (no revenue yet) | not_monetized | needs_scope
  reach_state        TEXT,              -- ok | unsupported (thumbnail impressions by day)
  ct_state           TEXT,              -- ok | unsupported (views by content type: Shorts / videos / live)
  last_error         TEXT,
  active             INTEGER NOT NULL DEFAULT 1,
  updated_at         INTEGER
);
CREATE TABLE IF NOT EXISTS own_videos (
  video_id     TEXT PRIMARY KEY,
  channel_id   TEXT NOT NULL,
  title        TEXT,
  published_at INTEGER,
  duration     INTEGER,
  type         TEXT,                    -- video | short | live
  updated_at   INTEGER
);
CREATE INDEX IF NOT EXISTS own_videos_by_channel ON own_videos (channel_id, published_at);
CREATE TABLE IF NOT EXISTS own_milestones (
  channel_id  TEXT NOT NULL,
  key         TEXT NOT NULL,            -- subs:100, views:10000, video:10000 …
  reached_day TEXT,
  data        TEXT,                     -- JSON
  created_at  INTEGER NOT NULL,
  notified_at INTEGER,
  PRIMARY KEY (channel_id, key)
);
`;

// Phase 4 (content tools, docs/youtube-niche-plan.md 4): comments the extension captured on watch
// pages or get_comments fetched (kept 7 days, mcp/content.mjs).
const SCHEMA_CONTENT_TOOLS = `
CREATE TABLE IF NOT EXISTS video_comments (
  video_id    TEXT NOT NULL,
  comment_id  TEXT NOT NULL,
  author      TEXT,
  author_id   TEXT,
  text        TEXT NOT NULL,
  likes       INTEGER,
  replies     INTEGER,
  published   TEXT,                       -- as YouTube shows it ("2 days ago") or ISO (Data API)
  is_reply    INTEGER NOT NULL DEFAULT 0,
  parent_id   TEXT,
  pinned      INTEGER NOT NULL DEFAULT 0,
  hearted     INTEGER NOT NULL DEFAULT 0,
  by_creator  INTEGER NOT NULL DEFAULT 0,
  pos         INTEGER,                    -- order YouTube showed them in (top comments first)
  source      TEXT NOT NULL,              -- page | api
  fetched_at  INTEGER NOT NULL,
  PRIMARY KEY (video_id, comment_id)
);
CREATE INDEX IF NOT EXISTS video_comments_by_age ON video_comments (fetched_at);
CREATE TABLE IF NOT EXISTS comment_sets (
  video_id    TEXT PRIMARY KEY,
  title       TEXT,
  channel_id  TEXT,
  total       INTEGER,                    -- the comment count YouTube showed
  source      TEXT,
  fetched_at  INTEGER NOT NULL
);
`;

/** Ordered, each run once (meta schema_version); `up` must be safe to run again anyway. */
export const MIGRATIONS = [
  { version: 1, name: 'youtube niche tracking + own channel history tables', up: (st) => st.db.exec(SCHEMA_YOUTUBE_NICHE) },
  {
    version: 2, name: 'niche tracking: tracked videos, alerts, digests, channel names, thumbnail URLs',
    up: (st) => {
      st.db.exec(SCHEMA_NICHE_TRACKING);
      st.addColumn('tracked_channels', 'name', 'TEXT');
      st.addColumn('tracked_channels', 'handle', 'TEXT');
      st.addColumn('tracked_channels', 'subs', 'INTEGER');
      st.addColumn('tracked_channels', 'backfilled_at', 'INTEGER');
      st.addColumn('tracked_channels', 'last_error', 'TEXT');
      st.addColumn('video_meta_log', 'thumb_url', 'TEXT');
      st.addColumn('video_meta_log', 'source', 'TEXT');
    }
  },
  {
    version: 3, name: 'own-channel history: connected channels, their videos, milestones, channel of each video row',
    up: (st) => {
      st.db.exec(SCHEMA_OWN_HISTORY);
      st.addColumn('own_video_daily', 'channel_id', 'TEXT');
      st.db.exec('CREATE INDEX IF NOT EXISTS own_video_daily_by_channel ON own_video_daily (channel_id, day)');
    }
  },
  {
    version: 4, name: 'content tools: captured comments, video descriptions (sponsor scan), thumbnail snapshots (title history)',
    up: (st) => {
      st.db.exec(SCHEMA_CONTENT_TOOLS);
      st.addColumn('tracked_videos', 'description', 'TEXT');
      st.addColumn('tracked_videos', 'thumb_snap', 'TEXT');
      st.addColumn('video_meta_log', 'thumb_snap', 'TEXT');
    }
  }
];
export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

export class Store {
  constructor(home) {
    this.home = home;
    this.file = dbFile(home);
    mkdirSync(home, { recursive: true });
    const fresh = !existsSync(this.file);
    this.db = new DatabaseSync(this.file);
    if (fresh) { try { chmodSync(this.file, 0o600); } catch { /* ignore */ } }
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = OFF;');
    this.db.exec(SCHEMA);
    this.migrate();
    if (this.getMeta('syncId') == null) this.setMeta('syncId', randomUUID());
    this.cache = { revision: -1, lib: null };
    this.migrateJson();
  }

  close() { try { this.db.close(); } catch { /* ignore */ } }

  /**
   * Bring the schema up to date. Each step runs in its own transaction and is
   * recorded in meta schema_version; the tables it creates are IF NOT EXISTS, so a
   * database that already has them (or a second process racing this one) is fine.
   * Existing tables and rows are never dropped.
   */
  migrate() {
    // The tables themselves are cheap to (re)declare; do it every time so a half-copied
    // database or a downgrade-then-upgrade still ends up complete.
    this.db.exec(SCHEMA_YOUTUBE_NICHE);
    this.db.exec(SCHEMA_NICHE_TRACKING);
    this.db.exec(SCHEMA_OWN_HISTORY);
    this.db.exec(SCHEMA_CONTENT_TOOLS);
    let v = Number(this.getMeta('schema_version', 0)) || 0;
    for (const m of MIGRATIONS) {
      if (m.version <= v) continue;
      this.db.exec('BEGIN IMMEDIATE');
      try {
        if ((Number(this.getMeta('schema_version', 0)) || 0) < m.version) {
          m.up(this);
          this.setMeta('schema_version', m.version);
        }
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
      v = m.version;
    }
    return v;
  }

  /** Add a column when it is missing (for later migrations). */
  addColumn(table, column, decl) {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }

  // ---- YouTube niche tracking (mcp/tracker.mjs) ---------------------------------

  /** Record measurements: [{ video_id, ts, views, likes, comments, source }]. Same video + ts twice: the first wins. */
  addVideoStats(rows) {
    const ins = this.db.prepare('INSERT OR IGNORE INTO video_stats (video_id, ts, views, likes, comments, source) VALUES (?, ?, ?, ?, ?, ?)');
    let n = 0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const r of rows || []) {
        if (!r || !r.video_id || !['api', 'rss', 'page'].includes(r.source)) continue;
        n += Number(ins.run(String(r.video_id), num(r.ts) || Date.now(), num(r.views), num(r.likes), num(r.comments), r.source).changes);
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return n;
  }

  /** Measurements of one video, oldest first. */
  videoStats(videoId) {
    return this.db.prepare('SELECT ts, views, likes, comments, source FROM video_stats WHERE video_id = ? ORDER BY ts').all(String(videoId));
  }

  /**
   * The api-retention-30d setting (off by default): delete Data API measurements of
   * other people's videos and channels older than `days`. RSS and page measurements
   * stay, and so does everything about channels marked mine (their videos are found
   * through tracker_jobs and through the library posts of the account they map to).
   */
  purgeApiData(now = Date.now(), days = 30) {
    const before = now - days * 864e5;
    const beforeDay = new Date(before).toISOString().slice(0, 10);
    const videos = this.db.prepare(`DELETE FROM video_stats WHERE source = 'api' AND ts < ?
      AND video_id NOT IN (SELECT j.video_id FROM tracker_jobs j JOIN tracked_channels c ON c.channel_id = j.channel_id WHERE c.mine = 1 AND j.video_id IS NOT NULL)
      AND video_id NOT IN (SELECT p.code FROM posts p JOIN tracked_channels c ON c.account_id = p.account_id WHERE c.mine = 1)`).run(before).changes;
    const channels = this.db.prepare(`DELETE FROM channel_stats WHERE source = 'api' AND day < ?
      AND channel_id NOT IN (SELECT channel_id FROM tracked_channels WHERE mine = 1)`).run(beforeDay).changes;
    return { video_stats: Number(videos), channel_stats: Number(channels) };
  }

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
   * Import <home>/library.json (written by older OpenOutlier versions) and
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
      console.error('[openoutlier] could not import library.json:', e.message);
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
    const oldData = this.db.prepare('SELECT data FROM posts WHERE account_id = ? AND code = ?');
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
    let pageStats = 0;
    // Exact counts the extension saw on YouTube pages of tracked channels are free extra
    // measurements for the velocity curves (plan 5): video_stats with source 'page'.
    const tracked = this.trackedSets();
    const pageStat = this.db.prepare('INSERT OR IGNORE INTO video_stats (video_id, ts, views, likes, comments, source) VALUES (?, ?, ?, ?, ?, ?)');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const [id, rec] of Object.entries(accounts || {})) {
        if (!rec || !rec.posts) {
          if (full) continue; // never delete on a full sync
          delPosts.run(id); delSnaps.run(id); delAccount.run(id);
          continue;
        }
        upAccount.run(id, rec.platform || null, rec.profile && typeof rec.profile === 'object' ? JSON.stringify(rec.profile) : null, num(rec.updatedAt) || now);
        for (let [code, p] of Object.entries(rec.posts)) {
          if (!p || typeof p !== 'object') continue;
          if (isYouTubePost(id, p)) {
            const old = oldData.get(id, code);
            if (old) { try { p = Y.merge(JSON.parse(old.data), p); } catch { /* keep the incoming copy */ } }
          }
          const counts = COUNT_FIELDS.map((f) => num(p[f]));
          const prev = oldPost.get(id, code);
          upPost.run(id, code, JSON.stringify(p), ...counts, num(p.takenAt), now);
          posts++;
          const changed = !prev || COUNT_FIELDS.some((f, i) => (prev[f] ?? null) !== counts[i]);
          if (changed && counts.some((c) => c !== null)) {
            // First sighting: when the extension saw it. Later changes: now.
            snap.run(id, code, prev ? now : (num(p.seenAt) || now), ...counts);
            snapshots++;
            if (tracked && isYouTubePost(id, p) && p.viewsApprox === false && counts[0] != null && (tracked.accounts.has(id) || tracked.channels.has(p.ownerId))) {
              const seen = num(p.seenAt);
              pageStats += Number(pageStat.run(code, seen && seen <= now ? seen : now, counts[0], counts[1], p.commentsApprox ? null : counts[2], 'page').changes);
            }
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
    return { posts, snapshots, page_stats: pageStats };
  }

  /** Account ids and channel ids of active tracked channels (null when none: the sync skips the check). */
  trackedSets() {
    const rows = this.db.prepare('SELECT channel_id, account_id FROM tracked_channels WHERE active = 1').all();
    if (!rows.length) return null;
    return { accounts: new Set(rows.map((r) => r.account_id).filter(Boolean)), channels: new Set(rows.map((r) => r.channel_id)) };
  }

  /**
   * Merge new facts about one post into the stored record (YouTube: src/youtube.js
   * `merge`, exact beats rounded; others: a plain field overlay). Creates the
   * account when needed. Records a snapshot when the counts change.
   * Returns the merged record.
   */
  mergePost(accountId, code, patch, { platform } = {}) {
    const now = Date.now();
    const row = this.db.prepare('SELECT data, views, likes, comments, shares, saves FROM posts WHERE account_id = ? AND code = ?').get(accountId, code);
    let prev = null;
    if (row) { try { prev = JSON.parse(row.data); } catch { /* replace a broken row */ } }
    const merged = isYouTubePost(accountId, patch) ? Y.merge(prev, patch) : { ...(prev || {}), ...patch };
    const counts = COUNT_FIELDS.map((f) => num(merged[f]));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`INSERT INTO accounts (id, platform, profile, updated_at) VALUES (?, ?, NULL, ?)
        ON CONFLICT(id) DO UPDATE SET platform = COALESCE(accounts.platform, excluded.platform)`).run(accountId, platform || merged.platform || null, now);
      this.db.prepare(`INSERT INTO posts (account_id, code, data, views, likes, comments, shares, saves, taken_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, code) DO UPDATE SET data = excluded.data, views = excluded.views, likes = excluded.likes,
          comments = excluded.comments, shares = excluded.shares, saves = excluded.saves,
          taken_at = COALESCE(excluded.taken_at, posts.taken_at), updated_at = excluded.updated_at`)
        .run(accountId, code, JSON.stringify(merged), ...counts, num(merged.takenAt), now);
      const changed = !row || COUNT_FIELDS.some((f, i) => (row[f] ?? null) !== counts[i]);
      if (changed && counts.some((c) => c !== null)) {
        this.db.prepare(`INSERT OR IGNORE INTO snapshots (account_id, code, seen_at, views, likes, comments, shares, saves)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(accountId, code, now, ...counts);
      }
      this.setMeta('revision', this.revision() + 1);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return merged;
  }

  /** Merge fields into an account's profile (null / undefined values are skipped). Creates the account when needed. */
  mergeProfile(accountId, patch, { platform } = {}) {
    const now = Date.now();
    const row = this.db.prepare('SELECT profile FROM accounts WHERE id = ?').get(accountId);
    let prof = {};
    if (row && row.profile) { try { prof = JSON.parse(row.profile) || {}; } catch { /* replace */ } }
    for (const [k, v] of Object.entries(patch || {})) if (v !== null && v !== undefined) prof[k] = v;
    this.db.prepare(`INSERT INTO accounts (id, platform, profile, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET profile = excluded.profile, platform = COALESCE(accounts.platform, excluded.platform)`).run(accountId, platform || null, JSON.stringify(prof), now);
    this.setMeta('revision', this.revision() + 1);
    return prof;
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
      snapshots: one('SELECT COUNT(*) AS n FROM snapshots'),
      tracked_channels: one('SELECT COUNT(*) AS n FROM tracked_channels'),
      video_stats: one('SELECT COUNT(*) AS n FROM video_stats'),
      tracked_videos: one('SELECT COUNT(*) AS n FROM tracked_videos'),
      schema_version: Number(this.getMeta('schema_version', 0)) || 0
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
