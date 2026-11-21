// OpenOutlier – background job scheduler for the always-on bridge
// (docs/youtube-niche-plan.md, sections 1, 2.2 and 7: phase 0).
//
// Jobs are rows in the tracker_jobs table (store.mjs), so a restart picks up
// where the last process stopped: every job has a next_at, and whatever is due
// when the bridge comes back runs once (missed runs are not replayed).
//
// • Kinds: each job kind is { feature, every, jitter, units, run }. A kind only
//   runs while its feature is on (src/features.js; the extension sends the
//   flags to the bridge, which keeps them in meta.features).
// • Jitter: every next run is pushed back by a random 0…jitter ms, so jobs
//   (and requests to YouTube) don't line up.
// • Single flight: one tick at a time in this process, and a lease in meta
//   (tracker_lease) so two processes (the launchd daemon and an MCP server)
//   never run jobs at the same time.
// • Crash safety: a job is claimed (next_at moved forward by its backoff)
//   before it runs, so a job that kills the process isn't retried in a loop.
// • Quota: jobs that use the YouTube Data API say how many units they need;
//   the tracker keeps a daily budget below Google's 10,000 (the same counter
//   bridge_status and the extension report) and defers jobs past it to the
//   next Pacific day.
//
// Phase 0 has no real tracking yet: a heartbeat (no-op, proves the scheduler
// runs) and the optional 30-day API data purge (api-retention-30d).
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { quotaOf, spendOn, apiKey as defaultApiKey } from './youtube-api.mjs';

const require = createRequire(import.meta.url);
const F = require('../src/features.js');
const A = require('../src/youtube-api.js');

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const LEASE_META = 'tracker_lease';
const STATE_META = 'tracker_state';

/** Built-in job kinds. Later phases add RSS polling, video measurements, channel stats … */
export const KINDS = {
  heartbeat: {
    singleton: true,
    feature: 'tracker',
    every: 15 * MIN,
    jitter: MIN,
    units: 0,
    /** No-op: records that the scheduler is alive (bridge_status shows it). */
    run(ctx) {
      const prev = ctx.store.getMeta('tracker_heartbeat', null) || {};
      const beat = { at: ctx.now, runs: (prev.runs || 0) + 1, pid: process.pid };
      ctx.store.setMeta('tracker_heartbeat', beat);
      return { data: beat };
    }
  },
  'api-retention': {
    singleton: true,
    feature: 'api-retention-30d',
    every: DAY,
    jitter: 30 * MIN,
    units: 0,
    run(ctx) {
      const removed = ctx.store.purgeApiData(ctx.now, 30);
      if (removed.video_stats || removed.channel_stats) ctx.log('api-retention-30d removed', JSON.stringify(removed));
      return { data: removed };
    }
  }
};

/** The resolved feature flags the bridge holds (defaults for anything the extension never sent). */
export function featureFlags(store) { return F.resolve(store.getMeta('features', null)); }

/** The start of the next Pacific day (when Google resets the quota), as ms. */
export function nextQuotaDay(now) {
  const today = A.quotaDay(now);
  let t = now;
  // Step forward in hours until the Pacific date changes (DST-safe, at most 25 steps): some
  // time in the first hour of the new day, which is all a deferred job needs.
  while (A.quotaDay(t) === today) t += HOUR;
  return t;
}

export class Tracker {
  /**
   * opts: {
   *   store,                       a Store (store.mjs)
   *   kinds = KINDS,               job kinds
   *   now = Date.now, random = Math.random,
   *   fetch, apiKey: () => key|null,
   *   log = () => {},
   *   budget = 9000,               daily Data API units the tracker may use (total incl. the extension's)
   *   maxPerTick = 25, tickMs = 60s, leaseMs = 10 min, owner (lease id)
   * }
   */
  constructor(opts = {}) {
    if (!opts.store) throw new Error('Tracker needs a store');
    this.store = opts.store;
    this.kinds = opts.kinds || KINDS;
    this.now = opts.now || (() => Date.now());
    this.random = opts.random || Math.random;
    this.fetch = opts.fetch || globalThis.fetch;
    this.apiKey = opts.apiKey || (() => defaultApiKey());
    this.log = opts.log || (() => {});
    this.budget = opts.budget ?? 9000;
    this.maxPerTick = opts.maxPerTick || 25;
    this.tickMs = opts.tickMs || MIN;
    this.leaseMs = opts.leaseMs || 10 * MIN;
    this.owner = opts.owner || `${process.pid}:${randomUUID().slice(0, 8)}`;
    this.inFlight = null;
    this.timer = null;
    this.lastTick = null;
  }

  jitter(kind) { return Math.floor(this.random() * (kind.jitter || 0)); }
  everyOf(kind, job) { return typeof kind.every === 'function' ? kind.every(job, this.now()) : kind.every; }

  /** Whether a kind may run now: its feature is on (and, for API jobs, a key is set). */
  enabled(name, flags = featureFlags(this.store)) {
    const kind = this.kinds[name];
    if (!kind) return false;
    if (kind.feature && !flags[kind.feature]) return false;
    if (kind.units > 0 && !this.apiKey()) return false;
    return true;
  }

  /** Create or update a job row. fields: { kind, next_at?, video_id?, channel_id?, published_at?, tier?, data? } */
  schedule(id, fields) {
    const kind = this.kinds[fields.kind];
    const next = fields.next_at ?? this.now() + (kind ? this.jitter(kind) : 0);
    this.store.db.prepare(`INSERT INTO tracker_jobs (id, kind, video_id, channel_id, published_at, next_at, tier, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, video_id = COALESCE(excluded.video_id, tracker_jobs.video_id),
        channel_id = COALESCE(excluded.channel_id, tracker_jobs.channel_id), published_at = COALESCE(excluded.published_at, tracker_jobs.published_at),
        next_at = excluded.next_at, tier = COALESCE(excluded.tier, tracker_jobs.tier), data = COALESCE(excluded.data, tracker_jobs.data)`)
      .run(id, fields.kind, fields.video_id ?? null, fields.channel_id ?? null, fields.published_at ?? null, next, fields.tier ?? null,
        fields.data === undefined ? null : JSON.stringify(fields.data));
  }

  /** Make sure every singleton kind has its row (an existing row keeps its schedule). */
  seed() {
    const has = this.store.db.prepare('SELECT 1 FROM tracker_jobs WHERE id = ?');
    for (const [name, kind] of Object.entries(this.kinds)) {
      if (kind.singleton && !has.get(name)) this.schedule(name, { kind: name, next_at: this.now() + this.jitter(kind) });
    }
  }

  job(id) {
    const r = this.store.db.prepare('SELECT * FROM tracker_jobs WHERE id = ?').get(id);
    if (r && r.data) { try { r.data = JSON.parse(r.data); } catch { /* keep the text */ } }
    return r || null;
  }

  // ---- lease (one runner across processes) -----------------------------------------
  acquire() {
    const now = this.now();
    const db = this.store.db;
    db.exec('BEGIN IMMEDIATE');
    try {
      const cur = this.store.getMeta(LEASE_META, null);
      const free = !cur || cur.owner === this.owner || !(cur.until > now);
      if (free) this.store.setMeta(LEASE_META, { owner: this.owner, until: now + this.leaseMs });
      db.exec('COMMIT');
      return free;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  release() {
    try {
      const cur = this.store.getMeta(LEASE_META, null);
      if (cur && cur.owner === this.owner) this.store.setMeta(LEASE_META, { owner: this.owner, until: 0 });
    } catch { /* closing */ }
  }

  quota() {
    const q = quotaOf(this.store, this.now());
    return { ...q, budget: this.budget, remaining: Math.max(0, this.budget - q.used_today) };
  }

  /** Run what is due. Concurrent calls share one run (single flight). → { ran, skipped, deferred, failed } */
  tick() {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runDue().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async runDue() {
    const out = { ran: [], failed: [], deferred: [], lease: true };
    if (!this.acquire()) { out.lease = false; return out; }
    const flags = featureFlags(this.store);
    const names = Object.keys(this.kinds).filter((k) => this.enabled(k, flags));
    this.lastTick = { at: this.now(), enabled: names };
    if (!names.length) return out;
    const due = this.store.db.prepare(`SELECT * FROM tracker_jobs WHERE next_at <= ? AND kind IN (${names.map(() => '?').join(',')})
      ORDER BY next_at LIMIT ?`).all(this.now(), ...names, this.maxPerTick);
    const claim = this.store.db.prepare('UPDATE tracker_jobs SET next_at = ?, last_run_at = ? WHERE id = ? AND next_at = ?');
    const done = this.store.db.prepare(`UPDATE tracker_jobs SET next_at = ?, tier = COALESCE(?, tier), last_ok = 1, last_error = NULL,
      runs = runs + 1, fails = 0, data = COALESCE(?, data) WHERE id = ?`);
    const failed = this.store.db.prepare('UPDATE tracker_jobs SET next_at = ?, last_ok = 0, last_error = ?, runs = runs + 1, fails = fails + 1 WHERE id = ?');
    const defer = this.store.db.prepare('UPDATE tracker_jobs SET next_at = ? WHERE id = ?');

    for (const row of due) {
      const kind = this.kinds[row.kind];
      const now = this.now();
      // Over the day's budget: wait for Google's reset instead of failing.
      if (kind.units > 0 && this.quota().remaining < kind.units) {
        defer.run(nextQuotaDay(now) + this.jitter(kind), row.id);
        out.deferred.push(row.id);
        continue;
      }
      // 2, 4, 8 … min after each failure in a row (at most 6 h); the claim below uses the same wait.
      const backoff = Math.min(6 * HOUR, MIN * 2 ** Math.min(row.fails + 1, 12));
      // Claim it first: if another runner (or a crash) got here, the row's next_at no longer matches.
      if (!Number(claim.run(now + backoff, now, row.id, row.next_at).changes)) continue;
      this.acquire(); // renew the lease while working
      const job = { ...row, data: row.data ? safeJson(row.data) : null };
      const ctx = {
        now, store: this.store, log: this.log, fetch: this.fetch, apiKey: this.apiKey(), job, flags,
        quota: {
          ...this.quota(),
          spend: (n) => spendOn(this.store, n, this.now()),
          canSpend: (n) => this.quota().remaining >= n
        }
      };
      try {
        const r = (await kind.run(ctx, job)) || {};
        const next = r.next_at ?? this.now() + this.everyOf(kind, job) + this.jitter(kind);
        done.run(next, r.tier ?? null, r.data === undefined ? null : JSON.stringify(r.data), row.id);
        out.ran.push(row.id);
      } catch (e) {
        const msg = String((e && e.message) || e).slice(0, 500);
        failed.run(this.now() + backoff + this.jitter(kind), msg, row.id);
        out.failed.push(row.id);
        this.log('job', row.id, 'failed:', msg);
      }
    }
    this.store.setMeta(STATE_META, { lastTickAt: this.lastTick.at, ran: out.ran.length, failed: out.failed.length, deferred: out.deferred.length, owner: this.owner });
    return out;
  }

  /** Seed, then tick every tickMs (the first one after a random 0–30 s, so restarts don't stampede). */
  start({ firstDelayMs } = {}) {
    if (this.timer) return this;
    this.seed();
    const loop = () => { this.tick().catch((e) => this.log('tick failed:', e.message)); };
    this.firstTimer = setTimeout(loop, firstDelayMs ?? Math.floor(this.random() * 30_000));
    this.timer = setInterval(loop, this.tickMs);
    this.firstTimer.unref?.();
    this.timer.unref?.();
    this.log('tracker started', this.owner);
    return this;
  }

  stop() {
    clearTimeout(this.firstTimer);
    clearInterval(this.timer);
    this.timer = null;
    this.release();
  }

  /** For bridge_status. */
  status() {
    const flags = featureFlags(this.store);
    const db = this.store.db;
    const byKind = Object.fromEntries(db.prepare('SELECT kind, COUNT(*) AS n FROM tracker_jobs GROUP BY kind').all().map((r) => [r.kind, r.n]));
    const iso = (t) => (t ? new Date(t).toISOString() : null);
    const lease = this.store.getMeta(LEASE_META, null);
    const beat = this.store.getMeta('tracker_heartbeat', null);
    const st = this.store.getMeta(STATE_META, null);
    return {
      enabled: !!flags.tracker,
      running_here: !!this.timer,
      lease_holder: lease && lease.until > this.now() ? lease.owner : null,
      jobs: byKind,
      due: db.prepare('SELECT COUNT(*) AS n FROM tracker_jobs WHERE next_at <= ?').get(this.now()).n,
      enabled_kinds: Object.keys(this.kinds).filter((k) => this.enabled(k, flags)),
      last_tick_at: iso(st && st.lastTickAt),
      last_heartbeat_at: iso(beat && beat.at),
      quota: this.quota()
    };
  }
}

function safeJson(t) { try { return JSON.parse(t); } catch { return t; } }

/** A read-only view for processes that don't run the tracker (an MCP server sharing another's bridge). */
export function trackerStatus(store) { return new Tracker({ store }).status(); }
