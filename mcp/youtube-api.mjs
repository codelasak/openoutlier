// OpenOutlier MCP – the optional YouTube Data API key (phase 5).
//
// OPENOUTLIER_YOUTUBE_API_KEY, or the file ~/.openoutlier/youtube-api-key (mode
// 600; the extension's "Copy key to bridge" writes it), turns it on. Without a
// key, nothing in this file makes a request: the tool answers how to set it up.
//
// • exact stats for saved videos: videos.list, 50 ids per call = 1 quota unit;
// • a channel's uploads: channels.list (1) + playlistItems.list (1 per 50) +
//   videos.list (1 per 50). Never search.list.
// Records go into the library with Store.mergePost (src/youtube.js merge:
// exact beats rounded, exact dates beat relative ones). Units used today
// (Pacific day, when Google resets the quota) are kept in the database's meta
// table as youtube_api_quota. The extension counts its own calls and reports them
// with its settings (meta youtube_api_quota_ext), so quota() is the total of both:
// the same key spends the same Google Cloud project's quota.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, renameSync, chmodSync, unlinkSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setting } from './env.mjs';
import { store, readLibrary, isYouTubeId, HOME } from './library.mjs';

const require = createRequire(import.meta.url);
export const A = require('../src/youtube-api.js');
const Y = require('../src/youtube.js');

const QUOTA_META = 'youtube_api_quota';
const EXT_QUOTA_META = 'youtube_api_quota_ext';
export const SETUP_HINT = 'Optional: create an API key in Google Cloud (enable "YouTube Data API v3", then APIs & Services → Credentials → Create credentials → API key, restricted to that API), then press "Copy key to bridge" in the OpenOutlier popup, or set OPENOUTLIER_YOUTUBE_API_KEY for the MCP server (README → "YouTube Data API key"). Without it, use refresh_reel / download_reel / collect_profile for exact stats.';

/** The key file the extension's "Copy key to bridge" writes (only the user can read it). */
export function keyFile(home = HOME) { return join(home, 'youtube-api-key'); }

/** Where the key comes from: 'env' (OPENOUTLIER_YOUTUBE_API_KEY wins), 'file', or null. */
export function apiKeyInfo(home = HOME) {
  const e = setting('YOUTUBE_API_KEY');
  if (A.isKey(e)) return { key: e.trim(), source: 'env' };
  try {
    const f = keyFile(home);
    const st = statSync(f);
    if (st.mode & 0o077) { try { chmodSync(f, 0o600); } catch { /* ignore */ } }
    const k = readFileSync(f, 'utf8').trim();
    if (A.isKey(k)) return { key: k, source: 'file' };
  } catch { /* no file */ }
  return { key: null, source: null };
}
export function apiKey(home = HOME) { return apiKeyInfo(home).key; }

/** Save the key for the bridge (mode 600, written atomically). Returns false for something that isn't a key. */
export function saveApiKey(key, home = HOME) {
  if (!A.isKey(key)) return false;
  mkdirSync(home, { recursive: true });
  const f = keyFile(home);
  const tmp = f + '.' + process.pid + '.tmp';
  writeFileSync(tmp, key.trim() + '\n', { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, f);
  return true;
}
export function removeApiKey(home = HOME) {
  try { unlinkSync(keyFile(home)); return true; } catch { return false; }
}

/** The extension's own count for today ({ day, units } from rs:yt-api-quota), sent with its settings. */
export function setExtensionQuota(state) {
  if (!state || typeof state !== 'object' || typeof state.day !== 'string' || !Number.isFinite(state.units)) return;
  store().setMeta(EXT_QUOTA_META, { day: state.day.slice(0, 10), units: Math.max(0, Math.round(state.units)) });
}
export function bridgeQuotaState() { return store().getMeta(QUOTA_META); }

/** Units used today in a given Store: the bridge's (and the MCP tools') plus the extension's, which share the key's project. */
export function quotaOf(st, now = Date.now()) {
  const bridge = A.usedToday(st.getMeta(QUOTA_META), now);
  const extension = A.usedToday(st.getMeta(EXT_QUOTA_META), now);
  return { used_today: bridge + extension, bridge, extension, daily_limit: A.DAILY_QUOTA, day: A.quotaDay(now), resets: 'midnight Pacific time' };
}
export function spendOn(st, n, now = Date.now()) {
  st.setMeta(QUOTA_META, A.addUnits(st.getMeta(QUOTA_META), n, now));
}
export function quota(now = Date.now()) { return quotaOf(store(), now); }
export function spend(n, now = Date.now()) { spendOn(store(), n, now); }

/** Save API records under `account` (merge rules from src/youtube.js). → { added, updated } */
export function saveRecords(account, records) {
  const lib = readLibrary();
  const have = lib.accounts[account]?.posts || {};
  let added = 0;
  let updated = 0;
  for (const r of records) {
    if (have[r.code]) updated++;
    else if (r.type) added++;
    else continue;
    store().mergePost(account, r.code, { ...r, owner: account }, { platform: 'youtube' });
  }
  return { added, updated };
}

/**
 * The youtube_api_stats tool. args: { account?, codes?, uploads?, max_uploads? }
 * deps: { fetch } (tests pass a mock).
 */
export async function apiStats(args = {}, { fetch: doFetch = globalThis.fetch, key = apiKey() } = {}) {
  if (!key) return { configured: false, error: 'No YouTube Data API key is set, so no request was made.', hint: SETUP_HINT };
  const lib = readLibrary();
  let units = 0;
  const opts = { key, fetch: doFetch, onUnits: (n) => { units += n; spend(n); } };
  const account = args.account ? String(args.account).trim() : null;
  if (account && !isYouTubeId(account)) return { error: `${account} is not a YouTube channel id (yt/handle or yt/UC…).` };
  try {
    if (args.uploads) {
      if (!account) return { error: 'uploads needs account (yt/handle or yt/UC…).' };
      const rec = lib.accounts[account] || {};
      const prof = rec.profile || {};
      const ucMatch = /^yt\/(UC[A-Za-z0-9_-]{22})$/.exec(account);
      const res = await A.channelUploads({
        ...opts, owner: account, known: rec.posts || {}, max: Math.min(args.max_uploads || 200, 2000),
        channelId: prof.channelId || (ucMatch && ucMatch[1]) || Object.values(rec.posts || {}).map((p) => p.ownerId).find(Boolean),
        handle: ucMatch ? null : prof.handle || account.slice(3)
      });
      const n = saveRecords(account, res.records);
      const ch = res.channel;
      store().mergeProfile(account, { channelId: ch.channelId, handle: prof.handle || ch.handle, name: prof.name || ch.name, avatar: prof.avatar || ch.avatar, subscribers: ch.subscribers, subscribersApprox: ch.subscribers != null ? false : undefined, videos: ch.videos }, { platform: 'youtube' });
      return {
        account, channel: { channel_id: ch.channelId, handle: ch.handle, name: ch.name, subscribers: ch.subscribers, videos: ch.videos },
        uploads_listed: res.records.length, added: n.added, updated: n.updated,
        shorts: res.records.filter((r) => r.type === 'short').length,
        note: res.shortsKnown ? undefined : 'YouTube did not list this channel\'s Shorts playlist, so videos of 60 s or less were counted as Shorts.',
        units_used: units, quota: quota()
      };
    }
    let posts = [];
    if (Array.isArray(args.codes) && args.codes.length) {
      for (const c of args.codes) {
        const id = Y.videoIdOf(c);
        if (!id) continue;
        let owner = null;
        let type = null;
        for (const [acc, rec] of Object.entries(lib.accounts)) {
          const p = rec.posts?.[id];
          if (p && p.platform === 'youtube') { owner = acc; type = p.type; break; }
        }
        posts.push({ code: id, owner, type });
      }
    } else if (account) {
      posts = Object.values(lib.accounts[account]?.posts || {}).map((p) => ({ code: p.code, owner: account, type: p.type }));
    }
    if (!posts.length) return { error: 'Nothing to update: give account (a saved YouTube channel) or codes (video ids / URLs).' };
    posts = posts.slice(0, 2000);
    const ex = await A.exactStats({ ...opts, posts });
    const byOwner = {};
    const unsaved = [];
    for (const r of ex.records) {
      const owner = posts.find((p) => p.code === r.code)?.owner;
      if (owner) (byOwner[owner] = byOwner[owner] || []).push(r);
      else unsaved.push({ code: r.code, title: r.caption, views: r.views, likes: r.likes, comments: r.comments, published: r.takenAt ? new Date(r.takenAt).toISOString() : null });
    }
    let updated = 0;
    for (const [owner, recs] of Object.entries(byOwner)) updated += saveRecords(owner, recs).updated;
    return {
      requested: posts.length, updated, not_on_youtube: ex.missing,
      not_in_library: unsaved.length ? unsaved : undefined,
      units_used: units, quota: quota()
    };
  } catch (e) {
    return { error: e.message, code: e.code, hint: e.hint || undefined, units_used: units, quota: quota() };
  }
}

export function registerYouTubeApiTool(server, { z, json, safe }) {
  server.registerTool('youtube_api_stats', {
    title: 'YouTube exact stats via the Data API (optional key)',
    description: 'Only when the user has set OPENOUTLIER_YOUTUBE_API_KEY (otherwise it makes no request and says how to set it up). Gets exact views, likes, comments, publish time, length, tags and category from the official YouTube Data API: for a saved channel\'s videos (account), for given videos (codes), or (uploads: true) the channel\'s full upload list including videos the extension never saw. Costs about 1 quota unit per 50 videos (uploads: about 3 per 50); the free daily quota is 10,000. Merged into the library like refresh_reel (exact values replace rounded ones).',
    inputSchema: {
      account: z.string().optional().describe('A saved YouTube channel: yt/handle or yt/UC…'),
      codes: z.array(z.string()).max(2000).optional().describe('YouTube video ids or URLs (instead of account)'),
      uploads: z.boolean().optional().describe('List the channel\'s uploads (newest first) and add the missing ones'),
      max_uploads: z.number().int().min(1).max(2000).optional().describe('With uploads: how many (default 200)')
    }
  }, (args) => safe(async () => json(await apiStats(args))));
}
