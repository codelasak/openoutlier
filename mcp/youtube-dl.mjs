// OpenOutlier – YouTube video files through yt-dlp (+ ffmpeg) on this computer.
//
// The extension can't save YouTube videos itself (YouTube streams through SABR
// and PO tokens), so the bridge (POST /youtube/download) and the MCP tool
// download_reel run yt-dlp here.
//
// • yt-dlp: OPENOUTLIER_YTDLP, else PATH, else /opt/homebrew/bin, /usr/local/bin.
// • Always spawned with an argument array, never a shell; the video id must
//   match ^[A-Za-z0-9_-]{11}$ and goes in as a full watch URL after "--".
// • Files land in ~/Downloads/OpenOutlier/yt_<handle>/ (OPENOUTLIER_DOWNLOADS
//   moves the root), named with the stats like every other OpenOutlier
//   download (M.fileBaseName). yt-dlp writes into a hidden staging folder first;
//   the final name is made from the exact stats in yt-dlp's info JSON.
// • The info JSON goes back into the library: exact views, likes, comments,
//   upload time, tags, category, chapters and the "most replayed" heatmap,
//   merged with src/youtube.js `merge` (exact beats rounded), the same rules
//   the store uses when the extension syncs, so a later sync with rounded
//   numbers can't undo them.
// • --cookies-from-browser only when OPENOUTLIER_YTDLP_COOKIES is set (e.g.
//   "chrome"); off by default because it triggers a Keychain prompt.
import { spawn } from 'node:child_process';
import { promises as fs, statSync, accessSync, constants as FS } from 'node:fs';
import { join, delimiter, extname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { setting } from './env.mjs';
import { store, readLibrary } from './library.mjs';

const require = createRequire(import.meta.url);
const Y = require('../src/youtube.js');
const M = require('../src/metrics.js');

export const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
export const FORMAT = 'bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b';
export const EXTRA_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'];
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const PROGRESS_TAG = '[oo-progress]';
const TIMEOUT = { video: 30 * 60 * 1000, both: 30 * 60 * 1000, cover: 2 * 60 * 1000 };
const MAX_PARALLEL = 2;
const KEEP_JOBS_MS = 2 * 60 * 60 * 1000;

export const INSTALL_HINT = 'Install it with Homebrew: brew install yt-dlp ffmpeg (or set OPENOUTLIER_YTDLP to the yt-dlp program).';
export const UPDATE_HINT = 'Update yt-dlp: brew upgrade yt-dlp (YouTube changes often and old versions stop working; recent versions also want Deno: brew install deno). If it still fails, the optional PO-token helper bgutil-ytdlp-pot-provider (a yt-dlp plugin) usually fixes it.';

// ---- finding the programs --------------------------------------------------------

function isExecutable(file) {
  try {
    if (!statSync(file).isFile()) return false;
    accessSync(file, FS.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** First executable `name` in PATH, then the Homebrew folders (launchd and GUI apps have a short PATH). */
export function findExecutable(name, { path = process.env.PATH || '', extra = EXTRA_DIRS } = {}) {
  const dirs = [...path.split(delimiter).filter(Boolean), ...extra];
  for (const d of dirs) {
    const f = join(d, name);
    if (isExecutable(f)) return f;
  }
  return null;
}

/** { bin } or { error } — OPENOUTLIER_YTDLP wins when set. */
export function locateYtDlp(opts = {}) {
  const explicit = setting('YTDLP');
  if (explicit) {
    const f = resolve(explicit.replace(/^~(?=$|\/)/, homedir()));
    return isExecutable(f) ? { bin: f } : { error: { code: 'missing', message: `OPENOUTLIER_YTDLP is set to ${explicit}, but that is not an executable file.`, hint: INSTALL_HINT } };
  }
  const bin = findExecutable('yt-dlp', opts);
  return bin ? { bin } : { error: { code: 'missing', message: 'yt-dlp is not installed (or not on PATH, /opt/homebrew/bin or /usr/local/bin).', hint: INSTALL_HINT } };
}

export function downloadsRoot() {
  const s = setting('DOWNLOADS');
  return s ? resolve(s.replace(/^~(?=$|\/)/, homedir())) : join(homedir(), 'Downloads', 'OpenOutlier');
}

export function safeName(s) { return String(s || '').replace(/[^\w.-]+/g, '_').replace(/^[._]+/, '').slice(0, 80) || 'youtube'; }

/** ~/… for messages. */
export function tildify(p) {
  const h = homedir();
  return p && p.startsWith(h + '/') ? '~' + p.slice(h.length) : p;
}

// ---- arguments -------------------------------------------------------------------

export function isVideoId(id) { return typeof id === 'string' && VIDEO_ID_RE.test(id); }
/** "yt/<handle>" or "yt/UC…" (src/youtube.js). */
export function isAccountId(id) { return Y.isYouTubeId(id); }

/**
 * The yt-dlp argument list. what: 'video' | 'cover' | 'both'.
 * outDir: where yt-dlp writes; base: the file name without extension.
 */
export function buildArgs({ id, what = 'video', outDir, base, ffmpeg, cookies } = {}) {
  if (!isVideoId(id)) throw new Error(`Not a YouTube video id: ${JSON.stringify(id)}`);
  if (!['video', 'cover', 'both'].includes(what)) throw new Error(`what must be video, cover or both (got ${what})`);
  if (!outDir || !base || /[\/%]/.test(base)) throw new Error('outDir and a plain base name are required');
  const args = [
    '--no-playlist', '--newline', '--no-colors', '--no-part',
    '--progress-template', `download:${PROGRESS_TAG} %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s`,
    '-P', outDir, '-o', `${base}.%(ext)s`,
    '--write-info-json'
  ];
  if (what === 'cover') args.push('--skip-download', '--write-thumbnail', '--convert-thumbnails', 'jpg');
  else {
    args.push('-f', FORMAT, '--merge-output-format', 'mp4');
    if (what === 'both') args.push('--write-thumbnail', '--convert-thumbnails', 'jpg');
  }
  if (ffmpeg) args.push('--ffmpeg-location', ffmpeg);
  if (cookies) args.push('--cookies-from-browser', String(cookies));
  args.push('--', 'https://www.youtube.com/watch?v=' + id);
  return args;
}

// ---- progress and errors -----------------------------------------------------------

const n = (s) => (s === undefined || s === 'NA' || s === 'None' || s === '' ? null : Number(s));

/** Read one output line into a progress update (or null). `st` keeps the stream count between lines. */
export function parseProgressLine(line, st = { streams: 0, split: true }) {
  const s = String(line || '').trim();
  if (s.startsWith(PROGRESS_TAG)) {
    const [done, total, estimate, speed, eta] = s.slice(PROGRESS_TAG.length).trim().split(/\s+/).map(n);
    const size = total || estimate;
    const percent = size && done != null ? Math.max(0, Math.min(100, Math.round(done / size * 1000) / 10)) : null;
    const part = st.split && st.streams >= 2 ? 'audio' : 'video';
    return { phase: part, percent, bytes: done, total: size || null, speed: speed || null, eta: eta == null ? null : Math.round(eta) };
  }
  if (/^\[download\] Destination:/.test(s)) { st.streams++; return { phase: st.split && st.streams >= 2 ? 'audio' : 'video', percent: 0 }; }
  if (/^\[download\] .* has already been downloaded/.test(s)) return { phase: 'video', percent: 100 };
  if (/^\[download\]\s+(\d+(?:\.\d+)?)%/.test(s)) return { phase: st.split && st.streams >= 2 ? 'audio' : 'video', percent: Number(RegExp.$1) };
  if (/^\[Merger\]/.test(s)) return { phase: 'merging', percent: null };
  if (/^\[(ThumbnailsConvertor|info\] Writing video thumbnail|info\] Downloading video thumbnail)/.test(s)) return { phase: 'cover', percent: null };
  if (/^\[(youtube|info)\]/.test(s)) return { phase: 'starting', percent: null };
  return null;
}

export function progressLabel(pr) {
  if (!pr) return 'Starting yt-dlp…';
  const pct = pr.percent != null ? ` ${Math.round(pr.percent)}%` : '';
  switch (pr.phase) {
    case 'video': return 'Downloading video' + pct + (pr.eta != null && pr.eta > 0 ? ` (${pr.eta}s left)` : '');
    case 'audio': return 'Downloading audio' + pct;
    case 'merging': return 'Merging video and audio…';
    case 'cover': return 'Saving the cover…';
    case 'saving': return 'Saving…';
    default: return 'Asking YouTube for the formats…';
  }
}

/** yt-dlp's stderr → { code, message, hint }: the cases people actually hit, each with what to do. */
export function explainError(stderr, { exitCode, timedOut, spawnError } = {}) {
  const text = String(stderr || '');
  const errLine = (text.match(/^ERROR: .*$/m) || [])[0] || '';
  const last = errLine || text.trim().split('\n').filter(Boolean).slice(-1)[0] || '';
  const detail = last.replace(/^ERROR:\s*(\[[^\]]+\]\s*[\w-]+:\s*)?/, '').slice(0, 400);
  if (spawnError && /ENOENT|EACCES/.test(spawnError.code || spawnError.message || '')) return { code: 'missing', message: 'yt-dlp could not be started.', hint: INSTALL_HINT };
  if (timedOut) return { code: 'timeout', message: 'yt-dlp took too long and was stopped.', hint: 'Try again; very long videos can take a while. If it keeps stalling: ' + UPDATE_HINT };
  if (/Private video|This video is private/i.test(text)) return { code: 'private', message: 'This video is private.', hint: 'Only its owner (and people they shared it with) can watch it, so it can\'t be downloaded.' };
  if (/members[- ]only|Join this channel to get access|available to this channel's members/i.test(text)) return { code: 'members_only', message: 'This video is for channel members only.', hint: 'Downloading it needs your logged-in YouTube session: set OPENOUTLIER_YTDLP_COOKIES=chrome for the bridge / MCP server (macOS asks for Keychain access once) and only if you are a member.' };
  if (/confirm your age|age[- ]restricted|inappropriate for some users/i.test(text)) return { code: 'age_restricted', message: 'This video is age-restricted.', hint: 'yt-dlp needs a signed-in session for it: set OPENOUTLIER_YTDLP_COOKIES=chrome for the bridge / MCP server (macOS asks for Keychain access once).' };
  if (/not a bot|confirm you.re not a robot/i.test(text)) return { code: 'bot_check', message: 'YouTube asked yt-dlp to sign in to prove it isn\'t a bot.', hint: UPDATE_HINT + ' Or set OPENOUTLIER_YTDLP_COOKIES=chrome so yt-dlp uses your browser\'s YouTube session.' };
  if (/ffmpeg (is )?not (installed|found)|ffprobe and ffmpeg not found|ffmpeg could not be found/i.test(text)) return { code: 'ffmpeg_missing', message: 'ffmpeg is missing (yt-dlp needs it to merge video and audio).', hint: 'brew install ffmpeg' };
  if (/live event will begin|Premieres in|is_upcoming|This live stream recording is not available|is currently live|Live stream is not available/i.test(text)) return { code: 'live', message: 'This is a live stream or premiere that has no recording yet.', hint: 'Try again after the stream has ended and YouTube has processed it.' };
  if (/No supported JavaScript runtime|JS runtime|JavaScript runtime/i.test(text)) return { code: 'js_runtime', message: 'yt-dlp needs a JavaScript runtime for YouTube and found none' + (detail ? ` (${detail})` : '.'), hint: 'Install Deno, which yt-dlp uses for YouTube: brew install deno. ' + UPDATE_HINT };
  if (/Requested format is not available|PO ?Token|po_token|SABR|nsig extraction failed|n challenge|Signature extraction failed|Only images are available|HTTP Error 403|Unable to extract|challenge solving failed|page needs to be reloaded/i.test(text)) return { code: 'blocked', message: 'YouTube didn\'t give yt-dlp a downloadable format' + (detail ? ` (${detail})` : '.'), hint: UPDATE_HINT };
  if (/Video unavailable|This video (has been removed|is no longer available|is not available)|copyright claim|account associated with this video has been terminated/i.test(text)) return { code: 'unavailable', message: 'YouTube says this video is unavailable' + (detail ? `: ${detail}` : '.'), hint: 'It may be deleted, blocked in your country, or removed for copyright.' };
  if (/Unable to download|Connection|timed out|Temporary failure|getaddrinfo|Network is unreachable/i.test(text)) return { code: 'network', message: 'yt-dlp could not reach YouTube' + (detail ? `: ${detail}` : '.'), hint: 'Check the internet connection and try again.' };
  return { code: 'failed', message: 'yt-dlp failed' + (exitCode != null ? ` (exit ${exitCode})` : '') + (detail ? `: ${detail}` : '.'), hint: UPDATE_HINT };
}

// ---- running yt-dlp -----------------------------------------------------------------

/** Run a program with an argument array (no shell). Resolves { exitCode, stderr, timedOut, spawnError }. */
export function run(bin, args, { timeoutMs = 60000, onLine, env } = {}) {
  return new Promise((done) => {
    let child;
    const tail = [];
    let timedOut = false;
    let finished = false;
    const extraPath = EXTRA_DIRS.filter((d) => !(process.env.PATH || '').split(delimiter).includes(d));
    try {
      child = spawn(bin, args, {
        shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...env, PATH: [process.env.PATH, ...extraPath].filter(Boolean).join(delimiter), PYTHONUNBUFFERED: '1' }
      });
    } catch (e) {
      done({ exitCode: null, stderr: '', timedOut: false, spawnError: e });
      return;
    }
    const finish = (r) => { if (finished) return; finished = true; clearTimeout(timer); done(r); };
    const kill = (sig) => { try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch { /* gone */ } } };
    const timer = setTimeout(() => { timedOut = true; kill('SIGTERM'); setTimeout(() => kill('SIGKILL'), 5000).unref(); }, timeoutMs);
    const lines = (stream, isErr) => {
      let buf = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.search(/[\r\n]/)) !== -1) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (!line) continue;
          if (isErr || /^(ERROR|WARNING):/.test(line)) { tail.push(line); if (tail.length > 200) tail.shift(); }
          if (onLine) { try { onLine(line); } catch { /* ignore */ } }
        }
      });
      stream.on('end', () => {
        if (!buf) return;
        if (isErr || /^(ERROR|WARNING):/.test(buf)) tail.push(buf);
        if (onLine) { try { onLine(buf); } catch { /* ignore */ } }
        buf = '';
      });
    };
    lines(child.stdout, false);
    lines(child.stderr, true);
    child.on('error', (e) => finish({ exitCode: null, stderr: tail.join('\n'), timedOut, spawnError: e }));
    child.on('close', (code) => finish({ exitCode: code, stderr: tail.join('\n'), timedOut }));
  });
}

// ---- info JSON → library record ------------------------------------------------------

const capText = (s, max) => (typeof s === 'string' ? (s.length > max ? s.slice(0, max) : s) : null);
const int = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

/** yt-dlp's info JSON → a YouTube post record in the src/youtube.js shape (only fields it knows). */
export function recordFromInfo(info, { now = Date.now() } = {}) {
  if (!info || !isVideoId(info.id)) return null;
  const handle = Y.handleOf(info.uploader_id) || Y.handleOf(info.uploader_url) || Y.handleOf(info.channel_url);
  const channelId = CHANNEL_ID_RE.test(String(info.channel_id || '')) ? info.channel_id : null;
  let type;
  if (info.media_type === 'short' || /\/shorts\//.test(String(info.webpage_url || info.original_url || ''))) type = 'short';
  else if (info.media_type === 'livestream' || ['was_live', 'is_live', 'post_live'].includes(info.live_status) || info.was_live) type = 'live';
  else if (!info.media_type && int(info.duration) && info.duration <= 180 && info.height > info.width) type = 'short';
  else type = 'video';
  const r = { code: info.id, platform: 'youtube', url: Y.videoUrl(info.id, type), type };
  if (handle || channelId) {
    r.owner = Y.ytId(handle || channelId);
    if (handle) r.author = handle;
    if (channelId) r.ownerId = channelId;
  }
  const name = info.channel || info.uploader;
  if (name) r.ownerName = String(name);
  const views = int(info.view_count);
  if (views != null) { r.views = views; r.viewsApprox = false; }
  const likes = int(info.like_count);
  if (likes != null) r.likes = likes;
  const comments = int(info.comment_count);
  if (comments != null) r.comments = comments;
  if (int(info.timestamp) != null) { r.takenAt = info.timestamp * 1000; r.dateApprox = false; }
  else if (/^\d{8}$/.test(String(info.upload_date || ''))) {
    const d = String(info.upload_date);
    r.takenAt = Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), 12);
    r.dateApprox = true;
    r.dateDay = true;
  }
  const dur = int(info.duration);
  if (dur) r.duration = dur;
  const title = capText(info.title || info.fulltitle, 1200);
  const desc = capText(info.description, 5000);
  if (title) r.caption = title;
  if (desc) r.description = desc;
  const tags = Y.hashtagsIn((title || '') + '\n' + (desc || ''));
  if (tags.length) r.hashtags = tags;
  if (Array.isArray(info.tags) && info.tags.length) r.keywords = info.tags.slice(0, 60).map(String);
  if (Array.isArray(info.categories) && info.categories[0]) r.category = String(info.categories[0]);
  if (info.availability === 'subscriber_only') r.membersOnly = true;
  if (info.availability === 'unlisted') r.unlisted = true;
  const manual = info.subtitles && Object.keys(info.subtitles).filter((k) => k !== 'live_chat').length;
  const auto = info.automatic_captions && Object.keys(info.automatic_captions).length;
  if (manual || auto) { r.hasCaptions = true; r.autoCaptions = !manual; }
  if (Array.isArray(info.chapters) && info.chapters.length) {
    const ch = info.chapters
      .filter((c) => c && typeof c.start_time === 'number' && c.title)
      .map((c) => ({ title: String(c.title).slice(0, 200), start: Math.round(c.start_time) }))
      .sort((a, b) => a.start - b.start).slice(0, 200);
    if (ch.length) r.chapters = ch;
  }
  if (Array.isArray(info.heatmap) && info.heatmap.length) {
    const hm = Y.heatmapFromMarkers(info.heatmap.map((x) => ({
      start: typeof x.start_time === 'number' ? x.start_time * 1000 : null,
      dur: typeof x.end_time === 'number' && typeof x.start_time === 'number' ? (x.end_time - x.start_time) * 1000 : null,
      v: typeof x.value === 'number' ? x.value : null
    })), []);
    if (hm) { r.heatmap = hm.values; r.heatmapPeaks = hm.peaks; if (hm.step) r.heatmapStep = hm.step; }
  }
  if (/^https:\/\/i[0-9]?\.ytimg\.com\//.test(String(info.thumbnail || ''))) r.thumb = info.thumbnail;
  r.files = [];
  r.seenAt = now;
  return r;
}

/** The library's own copy of a YouTube video and the account it's under (or nulls). */
export function libraryPost(code, lib = readLibrary()) {
  for (const [acc, rec] of Object.entries(lib.accounts || {})) {
    const p = rec.posts && rec.posts[code];
    if (p && p.platform === 'youtube') return { account: acc, post: p };
  }
  return { account: null, post: null };
}

/**
 * Merge yt-dlp's exact values into the library (exact beats rounded, see src/youtube.js merge).
 * Returns the merged record, or null when there is no account to file it under.
 */
export function saveToLibrary(rec, { account, prev } = {}) {
  const acc = account || (prev && prev.owner) || rec.owner;
  if (!acc || !Y.isYouTubeId(acc)) return null;
  const patch = prev && prev.seenAt ? { ...rec, seenAt: undefined } : rec;
  if (prev && prev.owner) patch.owner = prev.owner; // keep it under the account the extension uses
  return store().mergePost(acc, rec.code, patch, { platform: 'youtube' });
}

// ---- one download --------------------------------------------------------------------

/**
 * Download one YouTube video's file and/or cover with yt-dlp and back-fill the library.
 * opts: { id, what, directory?, prev? (a record, for the folder name before yt-dlp answers), onProgress?(p) }
 * Resolves { ok, files: [{ kind, path, bytes }], dir, post, error? }.
 */
export async function downloadYouTube({ id, what = 'video', directory, prev, onProgress, timeoutMs } = {}) {
  if (!isVideoId(id)) return { ok: false, error: { code: 'bad_id', message: `Not a YouTube video id: ${JSON.stringify(id)}`, hint: 'Video ids are 11 letters, digits, - or _ (the part after watch?v= or /shorts/).' } };
  if (!['video', 'cover', 'both'].includes(what)) return { ok: false, error: { code: 'bad_request', message: 'what must be video, cover or both.' } };
  const found = locateYtDlp();
  if (found.error) return { ok: false, error: found.error };
  const lib = libraryPost(id);
  const known = lib.post || (prev && Y.isYouTubeId(prev.owner) ? prev : null);
  const root = directory ? resolve(String(directory).replace(/^~(?=$|\/)/, homedir())) : downloadsRoot();
  const job = randomUUID().slice(0, 8);
  const stage = join(root, `.openoutlier-${id}-${job}`);
  await fs.mkdir(stage, { recursive: true });
  const ffmpeg = findExecutable('ffmpeg');
  const cookies = setting('YTDLP_COOKIES') || null;
  const args = buildArgs({ id, what, outDir: stage, base: 'oo-' + id, ffmpeg: ffmpeg ? ffmpeg : null, cookies });
  const st = { streams: 0, split: what !== 'cover' };
  const emit = (p) => { if (onProgress) { try { onProgress({ ...p, label: progressLabel(p) }); } catch { /* ignore */ } } };
  emit({ phase: 'starting', percent: null });
  const res = await run(found.bin, args, {
    timeoutMs: timeoutMs || TIMEOUT[what],
    onLine: (line) => { const p = parseProgressLine(line, st); if (p) emit(p); }
  });
  try {
    const names = await fs.readdir(stage).catch(() => []);
    const infoName = names.find((f) => f.endsWith('.info.json'));
    let info = null;
    if (infoName) { try { info = JSON.parse(await fs.readFile(join(stage, infoName), 'utf8')); } catch { /* broken JSON */ } }
    const media = names.filter((f) => /\.(mp4|mkv|webm|mov|m4a)$/i.test(f) && !/\.f\d+\./.test(f) && !/\.part$/.test(f));
    const cover = names.filter((f) => /\.(jpe?g|webp|png)$/i.test(f));
    const wantVideo = what !== 'cover';
    if (res.exitCode !== 0 || (wantVideo && !media.length) || (!wantVideo && !cover.length)) {
      const error = explainError(res.stderr, res);
      return { ok: false, error, post: info ? backfill(info, lib, known) : undefined };
    }
    emit({ phase: 'saving', percent: null });
    const post = info ? backfill(info, lib, known) : null;
    const rec = post || { ...(known || {}), code: id, platform: 'youtube' };
    const owner = rec.owner || (known && known.owner) || null;
    const dir = directory ? root : join(root, owner ? safeName(owner) : 'youtube');
    await fs.mkdir(dir, { recursive: true });
    const base = M.fileBaseName({ ...rec, platform: 'youtube' });
    const files = [];
    const move = async (from, to, kind) => {
      await fs.rename(join(stage, from), to);
      files.push({ kind, path: to, bytes: (await fs.stat(to)).size });
    };
    if (wantVideo) {
      const f = media.find((x) => x.endsWith('.mp4')) || media[0];
      await move(f, join(dir, `${base}${extname(f).toLowerCase()}`), 'video');
    }
    if (what !== 'video' && cover.length) {
      const f = cover.find((x) => /\.jpe?g$/i.test(x)) || cover[0];
      await move(f, join(dir, `${base}_cover${extname(f).toLowerCase().replace('jpeg', 'jpg')}`), 'cover');
    }
    if (wantVideo && infoName) await move(infoName, join(dir, `${base}.info.json`), 'info');
    return { ok: true, files, dir, post: post || undefined };
  } finally {
    await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}

/** Info JSON → record, merged into the library when the video has an account. Returns what the extension should merge. */
function backfill(info, lib, known) {
  const rec = recordFromInfo(info);
  if (!rec) return null;
  if (known && known.owner && !rec.owner) rec.owner = known.owner;
  let merged = null;
  try { merged = saveToLibrary(rec, { account: lib.account, prev: lib.post || known }); } catch (e) { console.error('[openoutlier] could not update the library:', e.message); }
  return merged || Y.merge(known && known.code === rec.code ? known : null, rec);
}

// ---- jobs (the bridge and download_reel share them) --------------------------------------

const jobs = new Map();
let running = 0;
const waiting = [];

function publicJob(j) {
  return {
    job: j.id, id: j.videoId, what: j.what, state: j.state, phase: j.progress?.phase || null,
    percent: j.progress?.percent ?? null, label: j.state === 'queued' ? 'Waiting for another download to finish…' : j.state === 'running' ? (j.progress?.label || 'Starting yt-dlp…') : j.state === 'done' ? 'Saved' : (j.error?.message || 'Failed'),
    startedAt: j.startedAt, finishedAt: j.finishedAt || null,
    files: j.files ? j.files.map((f) => ({ ...f, display: tildify(f.path) })) : [],
    dir: j.dir || null, error: j.error || null, post: j.post || null
  };
}

function pump() {
  while (running < MAX_PARALLEL && waiting.length) {
    const j = waiting.shift();
    running++;
    j.state = 'running';
    downloadYouTube({ id: j.videoId, what: j.what, directory: j.directory, prev: j.prev, onProgress: (p) => { j.progress = p; } })
      .then((r) => {
        j.state = r.ok ? 'done' : 'error';
        Object.assign(j, { files: r.files, dir: r.dir, post: r.post, error: r.error || null });
      }, (e) => { j.state = 'error'; j.error = { code: 'failed', message: String(e.message || e) }; })
      .finally(() => {
        j.finishedAt = Date.now();
        running--;
        j.resolve(publicJob(j));
        pump();
      });
  }
}

/** Start (or join) a download. Same video + what + folder while one runs → the same job. */
export function startJob({ id, what = 'video', directory, prev } = {}) {
  const now = Date.now();
  for (const [k, j] of jobs) if (j.finishedAt && now - j.finishedAt > KEEP_JOBS_MS) jobs.delete(k);
  for (const j of jobs.values()) {
    if (j.videoId === id && j.what === what && (j.directory || null) === (directory || null) && (j.state === 'queued' || j.state === 'running')) return publicJob(j);
  }
  const j = { id: randomUUID(), videoId: id, what, directory: directory || null, prev, state: 'queued', startedAt: now, progress: null };
  j.done = new Promise((r) => { j.resolve = r; });
  jobs.set(j.id, j);
  waiting.push(j);
  pump();
  return publicJob(j);
}

export function jobStatus(jobId) {
  const j = jobs.get(String(jobId || ''));
  return j ? publicJob(j) : null;
}

/** Wait up to `seconds` for a job; resolves its state either way. */
export async function waitJob(jobId, seconds) {
  const j = jobs.get(jobId);
  if (!j) return null;
  if (j.finishedAt) return publicJob(j);
  let t;
  await Promise.race([j.done, new Promise((r) => { t = setTimeout(r, seconds * 1000); })]);
  clearTimeout(t);
  return publicJob(j);
}
