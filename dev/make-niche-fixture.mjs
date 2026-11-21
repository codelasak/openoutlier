#!/usr/bin/env node
// Builds dev/youtube/niche/page.json: the answer the bridge gives the Library's Niş Takibi
// page (mcp/niche.mjs nichePage), computed by the real code over ten simulated weeks of
// tracking (dev/niche-sim.mjs) in a throwaway database. dev/dashboard-demo.html#/niche
// serves it (shifting its times to "now"). Thumbnails point at local SVGs drawn here,
// so the demo works offline. Never touches ~/.openoutlier.
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.OPENOUTLIER_HOME = mkdtempSync(join(tmpdir(), 'openoutlier-fixture-home-'));
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'youtube', 'niche');
const { Store } = await import('../mcp/store.mjs');
const N = await import('../mcp/niche.mjs');
const { simulate, markBreakouts } = await import('./niche-sim.mjs');

const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);
const s = new Store(mkdtempSync(join(tmpdir(), 'openoutlier-fixture-')));
simulate(s, { now: NOW, seed: 7 });
await markBreakouts(s, NOW, N.checkBreakouts);
// The tracker writes an alert right after the checkpoint passes (here it all ran at once): date them that way.
s.db.prepare('UPDATE niche_alerts SET created_at = (SELECT published_at FROM tracked_videos v WHERE v.video_id = niche_alerts.video_id) + at_h * 3600000 + 1200000').run();
// A saved digest for last week, as the Monday job would have written it.
const last = N.weekOf(N.weekOf(NOW).start - 864e5);
s.db.prepare('INSERT INTO niche_reports (week, data, created_at) VALUES (?, ?, ?)').run(last.week, JSON.stringify(N.nicheReport(s, { week: last.week, now: NOW, tzOffsetMin: 180 })), N.weekOf(NOW).start + 7 * 3600e3);
const page = N.nichePage(s, { now: NOW, tzOffsetMin: 180, status: { tracker: true, breakout_alerts: true, weekly_digest: true, api_key: true, last_tick_at: NOW - 40e3, quota: { used_today: 212, daily_limit: 10000 } } });

// Local thumbnails: one per topic, drawn like a typical Excel-tutorial thumbnail.
const TOPICS = [['xlookup', 'XLOOKUP', '#107C41'], ['pivot', 'PIVOT', '#1E3BFF'], ['power query', 'POWER QUERY', '#7A3EEA'], ['dashboard', 'DASHBOARD', '#0B0E1A'],
  ['conditional', 'COLORS', '#C2410C'], ['vba', 'VBA', '#334155'], ['lambda', 'LAMBDA', '#B91C1C'], ['copilot', 'COPILOT', '#0E7490'], ['gantt', 'GANTT', '#A16207'],
  ['validation', 'DROPDOWN', '#4D7C0F'], ['charts', 'CHARTS', '#BE185D'], ['shortcut', 'CTRL+?', '#1F2937'], ['flash fill', 'CTRL+E', '#065F46'], ['filter', 'FILTER()', '#1D4ED8'],
  ['index match', 'INDEX+MATCH', '#6D28D9'], ['budget', 'BUDGET', '#15803D'], ['power pivot', 'DAX', '#9333EA'], ['dynamic', 'SPILL#', '#0369A1'], ['checkbox', '☑ TASKS', '#047857'], ['regex', 'REGEX', '#7C2D12']];
mkdirSync(join(out, 'thumbs'), { recursive: true });
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
for (const [key, word, color] of TOPICS) {
  const fs = word.length > 9 ? 34 : word.length > 6 ? 44 : 56;
  let cells = '';
  for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) cells += `<rect x="${196 + c * 22}" y="${92 + r * 16}" width="20" height="14" fill="#fff" opacity="${(r * 5 + c) % 7 === 0 ? 0.95 : 0.22}"/>`;
  writeFileSync(join(out, 'thumbs', key.replace(/\s+/g, '-') + '.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="320" height="180"><rect width="320" height="180" fill="${color}"/>` +
    `<rect x="186" y="82" width="124" height="82" rx="4" fill="#000" opacity="0.18"/>${cells}` +
    `<text x="18" y="${70 + fs / 3}" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="${fs}" fill="#fff">${esc(word)}</text>` +
    `<rect x="18" y="128" width="${Math.min(150, word.length * 14)}" height="10" fill="#C8FF2E"/></svg>`);
}
const thumbFor = (title) => {
  const t = String(title || '').toLowerCase();
  const hit = TOPICS.find(([k]) => t.includes(k.split(' ')[0])) || TOPICS[0];
  return '/dev/youtube/niche/thumbs/' + hit[0].replace(/\s+/g, '-') + '.svg';
};
const fix = (o) => {
  if (Array.isArray(o)) return o.forEach(fix);
  if (!o || typeof o !== 'object') return;
  if (typeof o.thumb === 'string' && o.thumb.includes('ytimg.com')) o.thumb = thumbFor(o.title);
  Object.values(o).forEach(fix);
};
fix(page);
writeFileSync(join(out, 'page.json'), JSON.stringify(page));
console.log('wrote', join(out, 'page.json'), Math.round(JSON.stringify(page).length / 1024) + ' KB', page.week.length, 'uploads this week,', page.breakouts.length, 'breakouts');
