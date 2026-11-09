// OpenOutlier – builds every logo and icon in ../ from code, so they can be
// regenerated exactly.
//
//   cd brand/tools && npm install && node build.mjs
//
// The wordmark is real Archivo SemiExpanded outlines (Google Fonts, OFL),
// fetched into .fonts/ on first run. The "i" in Outlier is the dotless "ı";
// its dot is drawn separately in saffron, lifted above the cap height: the
// outlier. The mark is a box plot with one point beyond the whisker.
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import opentype from 'opentype.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..');
const fontsDir = join(here, '.fonts');

export const C = {
  paper: '#F4F5F0', ink: '#15181E', cobalt: '#2443F5', saffron: '#FFB000',
  // dark-ground variants
  inkDark: '#ECEEF2', cobaltDark: '#6F86FF', paperDark: '#0F1218'
};

async function font(weight) {
  mkdirSync(fontsDir, { recursive: true });
  const file = join(fontsDir, `archivo-semiexpanded-${weight}.ttf`);
  if (!existsSync(file)) {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@112,${weight}`)).text();
    const block = css.split('@font-face').find((b) => b.includes('semi-expanded'));
    const url = block.match(/url\((https:[^)]+)\)/)[1];
    writeFileSync(file, Buffer.from(await (await fetch(url)).arrayBuffer()));
  }
  return opentype.loadSync(file);
}

const r = (n) => Math.round(n * 100) / 100;

// ---- the mark: a box plot and its outlier --------------------------------------
// 64-unit grid. A wide box 11..35 × 21..45 (the interquartile range) with a
// 2-unit median slot at 33..35, short whiskers on x = 23 to caps at y 14 and
// 52, and the outlier at (46, 9): above the top cap, i.e. beyond the whisker.
function markShapes({ box, dot }) {
  // The box is two shapes with the median gap between them, so the mark works
  // on any background without a mask.
  const boxPath = 'M16 21h14a5 5 0 0 1 5 5v7H11v-7a5 5 0 0 1 5-5z M11 35h24v5a5 5 0 0 1-5 5H16a5 5 0 0 1-5-5z';
  const whiskers = 'M18 14h10 M23 14v7 M23 45v7 M18 52h10';
  return [
    `<path d="${whiskers}" fill="none" stroke="${box}" stroke-width="3.5" stroke-linecap="round"/>`,
    `<path d="${boxPath}" fill="${box}"/>`,
    `<circle cx="46" cy="9" r="6.5" fill="${dot}"/>`
  ].join('');
}

function svg(w, h, body, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;
}

// ---- wordmark ----------------------------------------------------------------
async function wordmark({ open, outlier, dot }) {
  const medium = await font(500);
  const bold = await font(800);
  const size = 100;
  let x = 0;
  const parts = [];
  const add = (f, text, fill) => {
    const p = f.getPath(text, x, 0, size, { kerning: true });
    parts.push({ d: p.toPathData(2), fill });
    x += f.getAdvanceWidth(text, size, { kerning: true });
  };
  add(medium, 'Open', open);
  x += 1; // a hair of air where the weight changes
  add(bold, 'Outl', outlier);
  // The dotless i, then its dot drawn as the outlier.
  const iStart = x;
  const ig = bold.charToGlyph('ı');
  const ib = ig.getPath(iStart, 0, size).getBoundingBox();
  add(bold, 'ı', outlier);
  add(bold, 'er', outlier);
  const capH = (bold.tables.os2.sCapHeight || 700) / bold.unitsPerEm * size;
  const stem = ib.x2 - ib.x1;
  const dotR = stem * 0.62;
  const dotCx = (ib.x1 + ib.x2) / 2;
  const dotCy = -capH - dotR - 3; // lifted above the cap line: it broke away
  const top = dotCy - dotR;
  const desc = 4; // no descenders in the name; keep a small bottom margin
  const width = x;
  const pad = 2;
  const body = parts.map((p) => `<path d="${p.d}" fill="${p.fill}"/>`).join('') +
    `<circle cx="${r(dotCx)}" cy="${r(dotCy)}" r="${r(dotR)}" fill="${dot}"/>`;
  const vbX = -pad, vbY = r(top - pad), vbW = r(width + pad * 2), vbH = r(-top + pad + desc);
  return { body, vb: `${vbX} ${vbY} ${vbW} ${vbH}`, w: vbW, h: vbH };
}

function wordmarkSvg(wm, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${wm.vb}" width="${wm.w}" height="${wm.h}" role="img" aria-label="${title}"><title>${title}</title>${wm.body}</svg>\n`;
}

// ---- app / extension icon ----------------------------------------------------------
function iconSvg(size = 128) {
  // Cobalt tile, paper box plot with a cobalt median cut, saffron outlier.
  const s = 1.5; // 64-grid mark scaled into the 128 tile with 16px padding
  const mark = markShapes({ box: C.paper, dot: C.saffron });
  return svg(128, 128,
    `<rect width="128" height="128" rx="28" fill="${C.cobalt}"/>` +
    `<g transform="translate(12 20) scale(${s})">${mark}</g>`, 'OpenOutlier').replace('width="128" height="128" role', `width="${size}" height="${size}" role`);
}

function icon16Svg() {
  // Hand-tuned for 16 px: no caps, a fat box, the dot in the corner.
  return svg(16, 16,
    `<rect width="16" height="16" rx="3.5" fill="${C.cobalt}"/>` +
    `<path d="M6.5 3v10.5" stroke="${C.paper}" stroke-width="1.5" stroke-linecap="round"/>` +
    `<rect x="3" y="5.5" width="7" height="6" rx="1.4" fill="${C.paper}"/>` +
    `<rect x="3" y="8.2" width="7" height="0.8" fill="${C.cobalt}"/>` +
    `<circle cx="12.4" cy="3.6" r="2.2" fill="${C.saffron}"/>`, 'OpenOutlier');
}

// ---- write everything ----------------------------------------------------------
const files = {};
files['logo/openoutlier-mark.svg'] = svg(64, 64, markShapes({ box: C.cobalt, dot: C.saffron }), 'OpenOutlier');
files['logo/openoutlier-mark-dark.svg'] = svg(64, 64, markShapes({ box: C.cobaltDark, dot: C.saffron }), 'OpenOutlier');
files['logo/openoutlier-mark-mono.svg'] = svg(64, 64, markShapes({ box: 'currentColor', dot: 'currentColor' }), 'OpenOutlier');
const wmLight = await wordmark({ open: C.cobalt, outlier: C.ink, dot: C.saffron });
const wmDark = await wordmark({ open: C.cobaltDark, outlier: C.inkDark, dot: C.saffron });
const wmMono = await wordmark({ open: 'currentColor', outlier: 'currentColor', dot: 'currentColor' });
files['logo/openoutlier-wordmark.svg'] = wordmarkSvg(wmLight, 'OpenOutlier');
files['logo/openoutlier-wordmark-dark.svg'] = wordmarkSvg(wmDark, 'OpenOutlier');
files['logo/openoutlier-wordmark-mono.svg'] = wordmarkSvg(wmMono, 'OpenOutlier');
files['icon/openoutlier-icon.svg'] = iconSvg(128);
files['icon/openoutlier-icon-16.svg'] = icon16Svg();

for (const [rel, text] of Object.entries(files)) {
  const p = join(out, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}

// PNGs for the extension (rsvg-convert, from librsvg).
const png = (src, size, dest) => execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), join(out, src), '-o', join(out, dest)]);
png('icon/openoutlier-icon-16.svg', 16, 'icon/icon16.png');
png('icon/openoutlier-icon-16.svg', 32, 'icon/icon32.png');
png('icon/openoutlier-icon.svg', 48, 'icon/icon48.png');
png('icon/openoutlier-icon.svg', 128, 'icon/icon128.png');
png('icon/openoutlier-icon.svg', 512, 'icon/icon512.png');
console.log('built', Object.keys(files).length, 'SVGs and 5 PNGs into', out);
