// OpenOutlier MCP – get_transcript: a YouTube video's captions through yt-dlp
// on this computer (phase 5), for hook and script analysis.
//
// Reuses mcp/youtube-dl.mjs (finding yt-dlp, running it with an argument array,
// error mapping). Two short runs, no video download:
//   1. --skip-download --write-info-json   → the video's language and which
//      caption tracks exist (uploaded and auto-generated);
//   2. --load-info-json <that file> --write-subs | --write-auto-subs
//      --sub-langs <one track> --sub-format json3/vtt  → the captions.
// Track choice: the requested language, then the video's own language, then
// English; uploaded captions before auto-generated ones; an auto track in the
// spoken language ("xx-orig") before a machine translation.
// Only `hasTranscript` goes into the library, never the text.
import { promises as fs, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setting } from './env.mjs';
import { locateYtDlp, run, explainError, isVideoId, libraryPost, saveToLibrary, recordFromInfo, UPDATE_HINT } from './youtube-dl.mjs';

export const HOOK_SECONDS = 30;
const TIMEOUT_MS = 2 * 60 * 1000;
const TOO_OLD_DAYS = 90; // yt-dlp releases every few weeks; YouTube breaks old ones

// ---- picking a track -----------------------------------------------------------------
const base = (l) => String(l || '').toLowerCase().split(/[-_]/)[0];

/**
 * info JSON → { key, auto, language, translated } for --sub-langs, or null when
 * the video has no captions in any of the wanted languages.
 */
export function pickTrack(info, preferred) {
  const manual = Object.keys(info && info.subtitles || {}).filter((k) => k !== 'live_chat' && (info.subtitles[k] || []).length !== 0);
  const auto = Object.keys(info && info.automatic_captions || {});
  const orig = auto.find((k) => /-orig$/.test(k));
  const spoken = orig ? orig.replace(/-orig$/, '') : info && info.language ? String(info.language) : null;
  const wanted = [];
  for (const l of [preferred, info && info.language, spoken, 'en']) {
    if (l && !wanted.includes(base(l))) wanted.push(base(l));
  }
  for (const w of wanted) {
    const m = manual.find((k) => k.toLowerCase() === w) || manual.find((k) => base(k) === w);
    if (m) return { key: m, auto: false, language: m, translated: false };
    const a = auto.find((k) => k.toLowerCase() === w + '-orig');
    if (a) return { key: a, auto: true, language: w, translated: false };
    if (auto.includes(w)) return { key: w, auto: true, language: w, translated: !!spoken && base(spoken) !== w };
  }
  return null;
}

// ---- parsing ------------------------------------------------------------------------
const clean = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

/** YouTube's json3 captions → [{ start, end, text }] (seconds). */
export function parseJson3(json) {
  const out = [];
  for (const e of (json && json.events) || []) {
    if (!e || !Array.isArray(e.segs) || typeof e.tStartMs !== 'number') continue;
    const text = clean(e.segs.map((s) => s && s.utf8 || '').join(''));
    if (!text) continue;
    const start = e.tStartMs / 1000;
    out.push({ start, end: typeof e.dDurationMs === 'number' ? start + e.dDurationMs / 1000 : null, text });
  }
  return dedupe(out);
}

const vttTime = (s) => {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(s.trim());
  return m ? (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, '0') / 1000 : null;
};

/** WebVTT → [{ start, end, text }]. Auto captions repeat the previous line in each cue; those repeats are dropped. */
export function parseVtt(text) {
  const out = [];
  const blocks = String(text || '').replace(/\r/g, '').split(/\n\n+/);
  for (const b of blocks) {
    const lines = b.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i === -1) continue;
    const [a, z] = lines[i].split('-->');
    const start = vttTime(a);
    const end = vttTime(z.trim().split(/\s+/)[0]);
    if (start == null) continue;
    const body = lines.slice(i + 1).map(clean).filter(Boolean);
    if (!body.length) continue;
    out.push({ start, end, text: body.join(' '), lines: body });
  }
  // Rolling auto captions: a cue's first line is the previous cue's last line.
  for (let k = 1; k < out.length; k++) {
    const prev = out[k - 1].lines;
    const cur = out[k].lines;
    if (cur.length > 1 && cur[0] === prev[prev.length - 1]) out[k].text = cur.slice(1).join(' ');
  }
  return dedupe(out.map(({ lines, ...s }) => s));
}

function dedupe(segs) {
  const out = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && last.text === s.text) { if (s.end != null) last.end = s.end; continue; }
    out.push(s);
  }
  return out;
}

export const clock = (sec) => {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
};

/** Segments → { text: "[0:00] …" lines, hook: what is said in the first HOOK_SECONDS }. */
export function shape(segs, { hookSeconds = HOOK_SECONDS } = {}) {
  return {
    text: segs.map((s) => `[${clock(s.start)}] ${s.text}`).join('\n'),
    hook: segs.filter((s) => s.start < hookSeconds).map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim()
  };
}

// ---- yt-dlp ------------------------------------------------------------------------
/** "2025.06.09" → days since that release (null when unknown). */
export function versionAgeDays(version, now = Date.now()) {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})/.exec(String(version || '').trim());
  return m ? Math.floor((now - Date.UTC(+m[1], +m[2] - 1, +m[3])) / 86400000) : null;
}

async function ytDlpVersion(bin) {
  let out = '';
  await run(bin, ['--version'], { timeoutMs: 15000, onLine: (l) => { if (!out) out = l.trim(); } });
  return out || null;
}

/** A failed run → { code, message, hint }, naming an old yt-dlp when that's the likely cause. */
async function failure(bin, res) {
  const err = explainError(res.stderr, res);
  if (['blocked', 'failed', 'bot_check', 'js_runtime'].includes(err.code)) {
    const version = await ytDlpVersion(bin).catch(() => null);
    const age = versionAgeDays(version);
    if (age != null && age > TOO_OLD_DAYS) {
      return { code: 'too_old', message: `yt-dlp ${version} is too old for YouTube (released ${age} days ago). ${err.message}`, hint: UPDATE_HINT };
    }
  }
  return err;
}

/**
 * Captions for one video. opts: { id, lang?, hookSeconds? }.
 * Resolves { ok: true, id, title, language, auto, translated, duration, segments, text, hook }
 * or { ok: false, error: { code, message, hint } }.
 */
export async function getTranscript({ id, lang, hookSeconds = HOOK_SECONDS } = {}) {
  if (!isVideoId(id)) return { ok: false, error: { code: 'bad_id', message: `Not a YouTube video id: ${JSON.stringify(id)}`, hint: 'Give the video id or a youtube.com/watch?v=… / /shorts/… / youtu.be/… URL.' } };
  if (lang != null && !/^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})?$/.test(String(lang))) return { ok: false, error: { code: 'bad_request', message: 'lang must be a language code such as en, tr or pt-BR.' } };
  const found = locateYtDlp();
  if (found.error) return { ok: false, error: found.error };
  const dir = mkdtempSync(join(tmpdir(), 'openoutlier-tr-'));
  const cookies = setting('YTDLP_COOKIES') || null;
  const common = ['--no-playlist', '--no-colors', '--skip-download', '-P', dir, '-o', 'tr.%(ext)s'];
  if (cookies) common.push('--cookies-from-browser', String(cookies));
  try {
    const first = await run(found.bin, [...common, '--write-info-json', '--', 'https://www.youtube.com/watch?v=' + id], { timeoutMs: TIMEOUT_MS });
    const infoFile = join(dir, 'tr.info.json');
    let info = null;
    try { info = JSON.parse(await fs.readFile(infoFile, 'utf8')); } catch { /* none */ }
    if (first.exitCode !== 0 || !info) return { ok: false, error: await failure(found.bin, first) };
    const lib = libraryPost(id);
    const track = pickTrack(info, lang);
    if (!track) {
      remember(lib, info, false);
      const any = Object.keys(info.subtitles || {}).filter((k) => k !== 'live_chat').length + Object.keys(info.automatic_captions || {}).length;
      return { ok: false, error: any
        ? { code: 'no_captions', message: `This video has captions, but none in ${[lang, info.language, 'en'].filter(Boolean).join(', ')}.`, hint: 'Ask again with lang set to one of: ' + Object.keys(info.subtitles || {}).concat(Object.keys(info.automatic_captions || {}).filter((k) => /-orig$/.test(k))).filter((k) => k !== 'live_chat').slice(0, 20).join(', ') }
        : { code: 'no_captions', message: 'This video has no captions (neither uploaded nor auto-generated), so there is no transcript.', hint: 'YouTube makes auto-captions for most spoken videos some time after upload; music-only videos and very new or very long videos often have none.' } };
    }
    await fs.rm(infoFile).catch(() => {});
    const infoCopy = join(dir, 'in.info.json');
    await fs.writeFile(infoCopy, JSON.stringify(info));
    const second = await run(found.bin, [...common, '--load-info-json', infoCopy, track.auto ? '--write-auto-subs' : '--write-subs', '--sub-langs', track.key, '--sub-format', 'json3/vtt'], { timeoutMs: TIMEOUT_MS });
    const names = await fs.readdir(dir).catch(() => []);
    const subFile = names.find((f) => /^tr\..+\.json3$/.test(f)) || names.find((f) => /^tr\..+\.vtt$/.test(f));
    if (!subFile) {
      if (second.exitCode !== 0) return { ok: false, error: await failure(found.bin, second) };
      return { ok: false, error: { code: 'no_captions', message: `yt-dlp found the ${track.auto ? 'auto-generated ' : ''}"${track.key}" captions but saved no file.`, hint: UPDATE_HINT } };
    }
    const raw = await fs.readFile(join(dir, subFile), 'utf8');
    let segs;
    try { segs = subFile.endsWith('.json3') ? parseJson3(JSON.parse(raw)) : parseVtt(raw); } catch { segs = []; }
    if (!segs.length) return { ok: false, error: { code: 'no_captions', message: 'The caption file was empty.', hint: '' } };
    remember(lib, info, true);
    const { text, hook } = shape(segs, { hookSeconds });
    return {
      ok: true, id, title: info.title || null, language: track.language, track: track.key, auto: track.auto, translated: track.translated,
      duration: typeof info.duration === 'number' ? Math.round(info.duration) : null,
      format: subFile.endsWith('.json3') ? 'json3' : 'vtt', segments: segs, text, hook, hook_seconds: hookSeconds
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Mark a saved video: hasTranscript true/false (plus the exact stats yt-dlp saw). Never the text; unsaved videos aren't added. */
function remember(lib, info, has) {
  try {
    const rec = recordFromInfo(info);
    if (!rec) return;
    rec.hasTranscript = has;
    if (lib.post) saveToLibrary(rec, { account: lib.account, prev: lib.post }); // saved videos only
  } catch (e) {
    console.error('[openoutlier] could not update the library:', e.message);
  }
}

export function registerTranscriptTool(server, { z, json, safe, fail, youtubeIdOf, findReel, readLibrary }) {
  server.registerTool('get_transcript', {
    title: 'YouTube transcript',
    description: 'The captions of one YouTube video or Short as plain text with [m:ss] timestamps, plus `hook`: what is said in the first ~30 seconds (for hook analysis). Uses yt-dlp on this computer (no video download): uploaded captions first, else YouTube\'s auto-generated ones, in the requested language, else the video\'s own language, else English (`auto` and `translated` say which). The library only records that a transcript exists, not the text. Errors: no_captions, too_old (update yt-dlp), missing (install yt-dlp).',
    inputSchema: {
      code: z.string().describe('YouTube video id (if saved) or youtube.com/watch?v=… / /shorts/… / youtu.be/… URL'),
      lang: z.string().optional().describe('Preferred caption language, e.g. en, tr, pt-BR (default: the video\'s own language, then English)'),
      max_chars: z.number().int().min(500).max(200000).optional().describe('Cut the text after this many characters (default 60000)')
    },
    annotations: { readOnlyHint: true }
  }, ({ code, lang, max_chars = 60000 }) => safe(async () => {
    const raw = String(code).trim();
    const saved = isVideoId(raw) ? findReel(readLibrary(), raw) : null;
    const id = youtubeIdOf(raw) || (saved && saved.platform === 'youtube' ? saved.code : null);
    if (!id) return fail(isVideoId(raw) ? `${raw} is not a saved YouTube video. Give the full youtube.com or youtu.be URL.` : 'That is not a YouTube video id or URL.');
    const r = await getTranscript({ id, lang });
    if (!r.ok) return json({ ok: false, code: id, error: r.error.code, message: r.error.message, hint: r.error.hint || undefined });
    const truncated = r.text.length > max_chars;
    return json({
      ok: true, code: id, title: r.title, language: r.language, auto_generated: r.auto, translated: r.translated,
      duration_s: r.duration, segments: r.segments.length, hook_seconds: r.hook_seconds, hook: r.hook,
      text: truncated ? r.text.slice(0, max_chars) : r.text, truncated: truncated || undefined
    });
  }));
}
