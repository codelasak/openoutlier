// OpenOutlier v2 – horizontal lockup: the approved Pixel O (Recraft SVG, used
// exactly as exported, cropped by viewBox only) next to "OpenOutlier" in
// Fraunces 48pt Black (Google Fonts, OFL), set as real outlines.
//
//   cd brand/tools && node lockup.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import opentype from 'opentype.js';

const here = dirname(fileURLToPath(import.meta.url));
const brand = join(here, '..');
const out = join(brand, 'v2');
const C = { blue: '#1E3BFF', lime: '#C8FF2E', paper: '#F6F7F2', ink: '#0B0E1A' };

// The approved mark, untouched. Its content sits at 613,511 938×1024 in a 2048 canvas.
const markSrc = readFileSync(join(brand, 'brandkit/logo/openoutlier-pixel-o.svg'), 'utf8');
const inner = markSrc
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replace(/<metadata>[\s\S]*?<\/metadata>/g, '');
const BOX = { x: 613, y: 511, w: 938, h: 1024 };

async function fraunces() {
  const file = join(here, '.fonts/fraunces-48-900.ttf');
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    const css = await (await fetch('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@48,900')).text();
    const url = css.match(/url\((https:[^)]+)\)/)[1];
    writeFileSync(file, Buffer.from(await (await fetch(url)).arrayBuffer()));
  }
  return opentype.loadSync(file);
}

const font = await fraunces();
const size = 200;
const capH = (font.tables.os2.sCapHeight / font.unitsPerEm) * size; // 140
const text = font.getPath('OpenOutlier', 0, 0, size, { kerning: true });
const tb = text.getBoundingBox();

// The mark is 1.3 cap heights tall, bottom on the baseline, so its lime pixel rises above the caps.
const markH = capH * 1.3;
const markW = (BOX.w / BOX.h) * markH;
const gap = capH * 0.32;
const textX = markW + gap;
const top = Math.min(-markH, tb.y1) ;
const bottom = Math.max(0, tb.y2);
const width = textX + tb.x2;

function lockup({ textFill, bg = null, pad = 0 }) {
  const W = width + pad * 2;
  const H = bottom - top + pad * 2;
  const body =
    (bg ? `<rect x="${-pad}" y="${top - pad}" width="${W}" height="${H}" fill="${bg}"/>` : '') +
    `<svg x="0" y="${-markH}" width="${markW}" height="${markH}" viewBox="${BOX.x} ${BOX.y} ${BOX.w} ${BOX.h}">${inner}</svg>` +
    `<path transform="translate(${textX} 0)" d="${text.toPathData(2)}" fill="${textFill}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${top - pad} ${W} ${H}" width="${Math.round(W)}" height="${Math.round(H)}" role="img" aria-label="OpenOutlier"><title>OpenOutlier</title>${body}</svg>\n`;
}

mkdirSync(join(out, 'logo'), { recursive: true });
const files = {
  'logo/openoutlier-lockup-white.svg': lockup({ textFill: C.paper }),
  'logo/openoutlier-lockup-on-blue.svg': lockup({ textFill: C.paper, bg: C.blue, pad: capH * 0.8 })
};
for (const [rel, s] of Object.entries(files)) writeFileSync(join(out, rel), s);
for (const rel of Object.keys(files)) {
  execFileSync('rsvg-convert', ['-w', '2048', join(out, rel), '-o', join(out, rel.replace(/\.svg$/, '-2048.png'))]);
}
console.log('lockup', Math.round(width), '×', Math.round(bottom - top), '→', Object.keys(files).join(', '));
