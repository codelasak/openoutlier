// OpenOutlier – perceptual hash of a thumbnail (docs/youtube-niche-plan.md 2.3).
//
// A YouTube thumbnail keeps its URL when the creator uploads a new image, so the
// tracker compares what the image looks like: a 64-bit difference hash (dHash) of
// a 9×8 grayscale copy. Two hashes more than THRESHOLD bits apart are a new image;
// re-encoding or resizing the same image changes only a few bits.
//
// Node can't decode JPEG/WebP by itself, so the 9×8 copy comes from ffmpeg when it
// is installed (`-vf scale=9:8,format=gray -f rawvideo`), else from macOS's own
// `sips` (resize to a 9×8 BMP, read here). Without either, the hash falls back to a
// SHA-1 of the image bytes ("sha1:…"): it still catches a new image behind the same
// URL, only a re-encoded copy of the same image would also count as a change.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const THRESHOLD = 10;

/** dHash of 9×8 grayscale pixels (row by row, 72 values 0–255) → 16 hex characters. */
export function dhash(gray) {
  if (!gray || gray.length < 72) throw new Error('need 9×8 grayscale pixels');
  let bits = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) bits += gray[y * 9 + x] > gray[y * 9 + x + 1] ? '1' : '0';
  }
  let hex = '';
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

/** Bits that differ between two dHash hex strings. */
export function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < 16; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

/** Whether two stored hashes ("d:<hex>" or "sha1:<hex>") show different images. Unknown → false. */
export function changed(a, b, threshold = THRESHOLD) {
  if (!a || !b) return false;
  const [ka, va] = String(a).split(':');
  const [kb, vb] = String(b).split(':');
  if (ka !== kb) return false; // different methods (ffmpeg came and went): can't tell, don't claim a change
  if (ka === 'd') return hamming(va, vb) > threshold;
  return va !== vb;
}

/** Uncompressed 24/32-bit BMP → { width, height, gray: Uint8Array (top row first) }. */
export function bmpGray(buf) {
  if (buf.length < 54 || buf[0] !== 0x42 || buf[1] !== 0x4d) throw new Error('not a BMP');
  const off = buf.readUInt32LE(10);
  const width = buf.readInt32LE(18);
  const rawH = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  const comp = buf.readUInt32LE(30);
  if ((bpp !== 24 && bpp !== 32) || (comp !== 0 && comp !== 3)) throw new Error('unsupported BMP (' + bpp + ' bpp, compression ' + comp + ')');
  const height = Math.abs(rawH);
  const bottomUp = rawH > 0;
  const bytes = bpp / 8;
  const stride = Math.ceil((width * bytes) / 4) * 4;
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = bottomUp ? height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const i = off + row * stride + x * bytes;
      const b = buf[i];
      const g = buf[i + 1];
      const r = buf[i + 2];
      gray[y * width + x] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }
  }
  return { width, height, gray };
}

function run(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { encoding: 'buffer', timeout: 15000, maxBuffer: 4 * 1024 * 1024, ...opts }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

const FFMPEG = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'];
const SIPS = '/usr/bin/sips';
function findFfmpeg() { return FFMPEG.find((p) => existsSync(p)) || null; }

/** 9×8 grayscale pixels of an image file through ffmpeg or sips (null when neither works). */
async function gray9x8(file, tools) {
  const ff = tools.ffmpeg === undefined ? findFfmpeg() : tools.ffmpeg;
  if (ff) {
    try {
      const out = await run(ff, ['-v', 'error', '-i', file, '-vf', 'scale=9:8:flags=area,format=gray', '-frames:v', '1', '-f', 'rawvideo', '-']);
      if (out.length >= 72) return Array.from(out.subarray(0, 72));
    } catch { /* try sips */ }
  }
  const sips = tools.sips === undefined ? (existsSync(SIPS) ? SIPS : null) : tools.sips;
  if (sips) {
    const bmp = file + '.bmp';
    try {
      await run(sips, ['-s', 'format', 'bmp', '-z', '8', '9', file, '--out', bmp]);
      const g = bmpGray(readFileSync(bmp));
      if (g.width === 9 && g.height === 8) return Array.from(g.gray);
    } catch { /* fall back */ }
  }
  return null;
}

/**
 * Hash image bytes: "d:<16 hex>" (perceptual) or "sha1:<40 hex>" (fallback).
 * tools: { ffmpeg?: path|null, sips?: path|null } (tests pass null to force a path).
 */
export async function hashImage(buf, tools = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'openoutlier-thumb-'));
  try {
    const f = join(dir, 'thumb.jpg');
    writeFileSync(f, buf);
    const g = await gray9x8(f, tools);
    if (g) return 'd:' + dhash(g);
  } catch { /* fall back */ } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  return 'sha1:' + createHash('sha1').update(buf).digest('hex');
}

/** Download a thumbnail (i.ytimg.com only) and hash it. → hash | null */
export async function hashThumb(url, { fetch: doFetch = globalThis.fetch, tools = {} } = {}) {
  if (!/^https:\/\/i[0-9]?\.ytimg\.com\//.test(String(url || ''))) return null;
  const res = await doFetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) return null;
  return hashImage(buf, tools);
}
