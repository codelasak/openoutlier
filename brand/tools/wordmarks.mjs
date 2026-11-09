// OpenOutlier v2 – wordmarks where the approved Pixel O replaces the letter O.
// The mark is embedded exactly as exported (nested <svg> with a cropping
// viewBox; no path is redrawn). The "plain" O is the brand kit's own export
// with the lime pixel mapped to the background blue, so it is for blue grounds.
//
//   cd brand/tools && node wordmarks.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import opentype from 'opentype.js';

const here = dirname(fileURLToPath(import.meta.url));
const brand = join(here, '..');
const out = join(brand, 'v2/wordmark');
const C = { blue: '#1E3BFF', paper: '#F6F7F2' };

const strip = (text) => text
  .replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<metadata>[\s\S]*?<\/metadata>/g, '');
const inner = (file) => strip(readFileSync(join(brand, 'brandkit/logo', file), 'utf8'));
const MARK = { lime: inner('openoutlier-pixel-o.svg'), plain: inner('openoutlier-pixel-o-plain-on-blue.svg') };
// Measured in the 2048 canvas: the white ring, and the ring plus its lime pixel.
const RING = { x: 614, y: 627, w: 819, h: 907 };
let WITH_PIXEL = { x: 614, y: 511, w: 937, h: 1024 };

// MARK_VARIANT=trail|big|breakaway uses brand/v2/mark/openoutlier-pixel-o-<variant>.svg
// (same ring, a larger lime element on the mark's own 110-unit grid).
const VARIANT = process.env.MARK_VARIANT || '';
if (VARIANT) {
  const text = readFileSync(join(brand, `v2/mark/openoutlier-pixel-o-${VARIANT}.svg`), 'utf8');
  MARK.lime = strip(text);
  const lime = text.match(/fill="rgb\(200,255,46\)" d="([^"]+)"/)[1];
  const sq = [...lime.matchAll(/M (\d+) (\d+) h (\d+)/g)].map((m) => m.slice(1).map(Number));
  const maxX = Math.max(RING.x + RING.w, ...sq.map(([x, , s]) => x + s));
  const minY = Math.min(RING.y, ...sq.map(([, y]) => y));
  WITH_PIXEL = { x: RING.x, y: minY, w: maxX - RING.x, h: RING.y + RING.h - minY };
}

const font = opentype.loadSync(join(here, '.fonts/fraunces-48-900.ttf'));
const size = 200;
const capH = (font.tables.os2.sCapHeight / font.unitsPerEm) * size;
const oGlyph = font.charToGlyph('O');
const oBox = oGlyph.getBoundingBox();
const scale = size / font.unitsPerEm;
const oLsb = oBox.x1 * scale;
const oRsb = (oGlyph.advanceWidth - oBox.x2) * scale;

/**
 * Lay out a run like ['O:plain', 'pen'] starting at x on a baseline y.
 * Returns { svg, width } where svg is the markup for that run.
 */
function run(parts, x0, y) {
  let x = x0;
  let svg = '';
  for (const part of parts) {
    if (part.startsWith('O:')) {
      const kind = part.slice(2);
      const h = capH * 1.04; // a touch of overshoot, like a round letter
      const k = h / RING.h;
      const w = RING.w * k;
      const rx = x + oLsb + capH * 0.04; // matching air on the left
      const top = y - h + capH * 0.02;
      const box = kind === 'lime' ? WITH_PIXEL : RING;
      svg += `<svg x="${rx - (RING.x - box.x) * k}" y="${top - (RING.y - box.y) * k}" width="${box.w * k}" height="${box.h * k}" viewBox="${box.x} ${box.y} ${box.w} ${box.h}">${MARK[kind]}</svg>`;
      x = rx + w + oRsb + capH * 0.07; // a little more air: the pixel O is heavier than a serif O
    } else {
      const p = font.getPath(part, x, y, size, { kerning: true });
      svg += `<path d="${p.toPathData(2)}" fill="${C.paper}"/>`;
      x += font.getAdvanceWidth(part, size, { kerning: true });
    }
  }
  return { svg, width: x - x0 };
}

function doc(body, w, top, bottom, pad) {
  const W = w + pad * 2;
  const H = bottom - top + pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${top - pad} ${W} ${H}" width="${Math.round(W)}" height="${Math.round(H)}" role="img" aria-label="OpenOutlier"><title>OpenOutlier</title>` +
    (process.env.TRANSPARENT ? '' : `<rect x="${-pad}" y="${top - pad}" width="${W}" height="${H}" fill="${C.blue}"/>`) + `${body}</svg>\n`;
}

const pad = capH * 0.8;
const pixelRise = capH * 1.04 * ((RING.y - WITH_PIXEL.y) / RING.h); // how far the lime pixel rises above the O
const desc = size * 0.26; // the p's descender

// firstO: 'serif' (the font's own O), 'plain' (pixel O without its pixel) or 'lime'.
const firstRun = (firstO) => (firstO === 'serif' ? ['Open'] : [`O:${firstO}`, 'pen']);

function inline(firstO) {
  const r = run([...firstRun(firstO), 'O:lime', 'utlier'], 0, 0);
  return doc(r.svg, r.width, -capH - pixelRise, desc, pad);
}

function stacked(firstO) {
  const lead = size * 1.08;
  const l1 = run(firstRun(firstO), 0, 0);
  // Indent "Outlier" so its O starts under the p of "Open".
  const indent = firstO === 'serif'
    ? font.getAdvanceWidth('O', size)
    : capH * 1.04 * (RING.w / RING.h) + oLsb + oRsb + capH * 0.07;
  const l2 = run(['O:lime', 'utlier'], indent, lead);
  const w = Math.max(l1.width, indent + l2.width);
  return doc(l1.svg + l2.svg, w, -capH - (firstO === 'lime' ? pixelRise : 0), lead + size * 0.04, pad);
}

mkdirSync(out, { recursive: true });
const suffix = (VARIANT ? `-${VARIANT}` : '') + (process.env.TRANSPARENT ? '-transparent' : '');
const files = VARIANT ? {
  [`openoutlier-stacked${suffix}.svg`]: stacked('serif'),
  [`openoutlier-inline${suffix}.svg`]: inline('serif')
} : {
  // The chosen system: "Open" in Fraunces, only the O of Outlier is the Pixel O.
  'openoutlier-stacked.svg': stacked('serif'),
  'openoutlier-inline.svg': inline('serif'),
  // Earlier explorations, kept for reference.
  'openoutlier-inline-outlier.svg': inline('plain'),
  'openoutlier-inline-both.svg': inline('lime'),
  'openoutlier-stacked-outlier.svg': stacked('plain'),
  'openoutlier-stacked-both.svg': stacked('lime')
};
for (const [name, s] of Object.entries(files)) {
  writeFileSync(join(out, name), s);
  execFileSync('rsvg-convert', ['-w', '1600', join(out, name), '-o', join(out, name.replace(/\.svg$/, '.png'))]);
}
console.log('wrote', Object.keys(files).join(', '));
