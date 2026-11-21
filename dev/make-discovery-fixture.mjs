#!/usr/bin/env node
// Phase 5 (discovery) fixtures. Two parts:
//  1. dev/youtube/discovery/api/: made-up Data API answers (search.list per keyword, videos.list,
//     channels.list) and autocomplete answers (client=firefox). tests/discovery.test.mjs feeds them to
//     the real radar job and keyword code.
//  2. dev/youtube/discovery/*.json: what the bridge answers the Library (radar, channel map, keyword
//     ideas, similar thumbnails, the channel card's similar channels), computed by the real code
//     (mcp/discovery.mjs) over the ten simulated weeks of dev/niche-sim.mjs plus the API fixtures,
//     some "Up Next" lists and the user's own search terms, in a throwaway database. The Library demo
//     (dev/dashboard-demo.html) and the YouTube demo serve them. Never touches ~/.openoutlier.
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.OPENOUTLIER_HOME = mkdtempSync(join(tmpdir(), 'openoutlier-fixture-home-'));
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'youtube', 'discovery');
const apiDir = join(out, 'api');
mkdirSync(apiDir, { recursive: true });
const { Store } = await import('../mcp/store.mjs');
const DISC = await import('../mcp/discovery.mjs');
const { simulate } = await import('./niche-sim.mjs');

export const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);
const H = 3600e3;
const D = 24 * H;
const KEY = 'AIza' + 'F'.repeat(35);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const uc = (s) => ('UCrdr' + s.replace(/[^A-Za-z0-9]/g, '') + 'xxxxxxxxxxxxxxxxxxxxxx').slice(0, 24);

// ---- 1. API fixtures ------------------------------------------------------------------------------
// Channels the radar finds: small ones that break out, one big one (filtered by maxSubs), and a tracked one.
const RCH = [
  ['Sheet Wizard', 'sheetwizard', 4200, 'Education'], ['Formula Friday', 'formulafriday', 12500, 'Education'], ['Cell Mates', 'cellmates', 1900, 'Education'],
  ['Grid Logic', 'gridlogic', 7700, 'Science & Technology'], ['Pivot Point TV', 'pivotpointtv', 38000, 'Education'], ['Office Pro Tips', 'officeprotips', 640000, 'Education'],
  ['Data Doodles', 'datadoodles', 26000, 'Education'], ['Spreadsheet Sisters', 'spreadsheetsisters', 9300, 'People & Blogs']
];
const KENJI = 'UCsimKenjiExplainsxxxxxxx'.slice(0, 24);
// [id, channel handle (or 'tracked:'), title, views, hours ago, duration s, keywords]
const RV = [
  ['rdrSW000001', 'sheetwizard', 'XLOOKUP is dead? The function nobody talks about', 61000, 70, 610, ['excel xlookup']],
  ['rdrSW000002', 'sheetwizard', 'XLOOKUP with two criteria (no helper column)', 8800, 140, 455, ['excel xlookup']],
  ['rdrFF000001', 'formulafriday', 'Build this Excel dashboard in 15 minutes', 47000, 52, 905, ['excel dashboard']],
  ['rdrCM000001', 'cellmates', 'I made an Excel KPI dashboard for my bakery', 22800, 98, 742, ['excel dashboard']],
  ['rdrGL000001', 'gridlogic', 'Pivot tables finally explained (with a cat)', 31500, 44, 528, ['excel pivot table']],
  ['rdrGL000002', 'gridlogic', 'Power Query: clean 10 files in one click', 6900, 120, 688, ['power query']],
  ['rdrPP000001', 'pivotpointtv', 'Pivot Table tricks the pros use', 41000, 60, 1220, ['excel pivot table']],
  ['rdrOP000001', 'officeprotips', 'XLOOKUP vs VLOOKUP in 2026', 290000, 80, 540, ['excel xlookup']],
  ['rdrDD000001', 'datadoodles', 'Power Query for beginners: merge sheets', 54000, 30, 811, ['power query', 'excel dashboard']],
  ['rdrSS000001', 'spreadsheetsisters', 'Budget dashboard in Excel (free template)', 3100, 26, 640, ['excel dashboard']],
  ['rdrSS000002', 'spreadsheetsisters', 'Excel pivot table in 60 seconds #shorts', 18000, 20, 58, ['excel pivot table']],
  ['rdrKJ000001', 'tracked:' + KENJI, 'Power Query secrets (part 2)', 120000, 90, 932, ['power query']],
  ['rdrOLD00001', 'cellmates', 'Old XLOOKUP tutorial (before the window)', 9000, 24 * 12, 600, ['excel xlookup']]
];
export const RADAR_KEYWORDS = ['excel xlookup', 'excel dashboard', 'excel pivot table', 'power query'];

function chanOf(handle) {
  if (handle.startsWith('tracked:')) return { id: handle.slice(8), name: 'Kenji Explains', handle: 'KenjiExplains', subs: 1100000 };
  const c = RCH.find((x) => x[1] === handle);
  return { id: uc(c[1]), name: c[0], handle: c[1], subs: c[2], cat: c[3] };
}
const iso = (t) => new Date(t).toISOString();
const searchOf = (kw) => ({ kind: 'youtube#searchListResponse', regionCode: 'US', items: RV.filter((v) => v[6].includes(kw)).sort((a, b) => b[3] - a[3]).map((v) => ({ kind: 'youtube#searchResult', id: { kind: 'youtube#video', videoId: v[0] }, snippet: { channelId: chanOf(v[1]).id, title: v[2] } })) });
const videoItem = (v) => {
  const c = chanOf(v[1]);
  const m = Math.floor(v[5] / 60);
  return { id: v[0], snippet: { publishedAt: iso(NOW - v[4] * H), channelId: c.id, channelTitle: c.name, title: v[2], description: v[2] + '\n\nFree workbook: https://example.com/' + v[0], categoryId: c.cat === 'Science & Technology' ? '28' : c.cat === 'People & Blogs' ? '22' : '27',
    thumbnails: { medium: { url: `https://i.ytimg.com/vi/${v[0]}/mqdefault.jpg`, width: 320, height: 180 } }, tags: v[6].concat('excel'), liveBroadcastContent: 'none' },
    contentDetails: { duration: `PT${m}M${v[5] % 60}S` }, statistics: { viewCount: String(v[3]), likeCount: String(Math.round(v[3] / 30)), commentCount: String(Math.round(v[3] / 400)) } };
};
const channelItem = (c) => ({ id: c.id, snippet: { title: c.name, customUrl: '@' + c.handle.toLowerCase(), publishedAt: '2023-03-01T00:00:00Z', thumbnails: { default: { url: `https://yt3.ggpht.com/${c.handle}=s88` } } },
  statistics: { subscriberCount: String(c.subs), viewCount: String(c.subs * 40), videoCount: '80', hiddenSubscriberCount: false } });
for (const kw of RADAR_KEYWORDS) writeFileSync(join(apiDir, 'search-' + slug(kw) + '.json'), JSON.stringify(searchOf(kw), null, 1));
writeFileSync(join(apiDir, 'videos.json'), JSON.stringify({ kind: 'youtube#videoListResponse', items: RV.map(videoItem) }, null, 1));
const allCh = [...new Map(RV.map((v) => { const c = chanOf(v[1]); return [c.id, c]; })).values()];
writeFileSync(join(apiDir, 'channels.json'), JSON.stringify({ kind: 'youtube#channelListResponse', items: allCh.map(channelItem) }, null, 1));
// Autocomplete (client=firefox: ["q", [suggestions], …]).
const SUG = {
  excel: ['excel', 'excel formulas', 'excel tutorial', 'excel xlookup', 'excel pivot table', 'excel dashboard', 'excel for beginners', 'excel lambda', 'excel copilot', 'excel shortcuts'],
  'excel xlookup': ['excel xlookup', 'excel xlookup multiple criteria', 'excel xlookup vs vlookup', 'excel xlookup return multiple columns', 'excel xlookup not working', 'excel xlookup wildcard'],
  'excel dashboard': ['excel dashboard', 'excel dashboard tutorial', 'excel dashboard design', 'excel dashboard template free', 'excel interactive dashboard', 'excel kpi dashboard'],
  'excel pivot table': ['excel pivot table', 'excel pivot table tutorial', 'excel pivot table for beginners', 'excel pivot table calculated field', 'excel pivot table refresh'],
  'power query': ['power query', 'power query excel', 'power query tutorial', 'power query merge', 'power query append', 'power query vs power pivot'],
  'excel lambda': ['excel lambda', 'excel lambda function', 'excel lambda examples', 'excel lambda recursion'],
  'excel copilot': ['excel copilot', 'excel copilot tutorial', 'excel copilot prompts', 'excel copilot free'],
  'excel gantt': ['excel gantt', 'excel gantt chart', 'excel gantt chart template'],
  'excel checkboxes': ['excel checkboxes', 'excel checkboxes new', 'excel checkboxes to do list']
};
for (const [q, list] of Object.entries(SUG)) writeFileSync(join(apiDir, 'suggest-' + slug(q) + '.json'), JSON.stringify([q, list, [], { 'google:suggesttype': list.map(() => 'QUERY') }]));

// A watch page's /next answer with its "Up Next" sidebar (the main video and owner from dev/youtube/next.json, the
// sidebar from dev/youtube/cards/next.json): what src/youtube-similar.js turns into co-recommendation pairs.
{
  const main = JSON.parse(readFileSync(join(here, 'youtube', 'next.json'), 'utf8'));
  const side = JSON.parse(readFileSync(join(here, 'youtube', 'cards', 'next.json'), 'utf8'));
  main.contents.twoColumnWatchNextResults.secondaryResults = side.contents.twoColumnWatchNextResults.secondaryResults;
  writeFileSync(join(out, 'next-watch.json'), JSON.stringify(main));
}

/** A Data API + autocomplete stand-in over these files. → { fetch, calls } */
export function fakeFetch(dir = apiDir) {
  const calls = [];
  async function fetch(url) {
    calls.push(String(url));
    const u = new URL(url);
    const ok = (body, text) => ({ ok: true, status: 200, json: async () => body, text: async () => text ?? JSON.stringify(body) });
    if (u.hostname === 'suggestqueries.google.com') {
      const f = join(dir, 'suggest-' + slug(u.searchParams.get('q')) + '.json');
      return ok(null, existsSync(f) ? readFileSync(f, 'utf8') : JSON.stringify([u.searchParams.get('q'), []]));
    }
    const path = u.pathname.split('/').pop();
    if (path === 'search') {
      const f = join(dir, 'search-' + slug(u.searchParams.get('q')) + '.json');
      const body = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { items: [] };
      body.items = body.items.slice(0, Number(u.searchParams.get('maxResults')) || 25);
      return ok(body);
    }
    if (path === 'videos') { const ids = u.searchParams.get('id').split(','); return ok({ items: JSON.parse(readFileSync(join(dir, 'videos.json'), 'utf8')).items.filter((i) => ids.includes(i.id)) }); }
    if (path === 'channels') { const ids = u.searchParams.get('id').split(','); return ok({ items: JSON.parse(readFileSync(join(dir, 'channels.json'), 'utf8')).items.filter((i) => ids.includes(i.id)) }); }
    return { ok: false, status: 404, json: async () => ({ error: { message: 'not found' } }), text: async () => '' };
  }
  return { fetch, calls };
}

// ---- 2. Library answers ---------------------------------------------------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const s = new Store(mkdtempSync(join(tmpdir(), 'openoutlier-fixture-')));
  const sim = simulate(s, { now: NOW, seed: 7 });
  s.setMeta('features', { 'niche-radar': true });
  DISC.saveRadarSettings(s, { keywords: { Excel: RADAR_KEYWORDS }, maxSubs: 50000, minRatio: 1, minViews: 1000, perKeyword: 25, rankKeywords: [] });
  // The radar ran this morning (units counted as the tracker would).
  let units = 0;
  const { fetch } = fakeFetch();
  await DISC.DISCOVERY_KINDS.radar.run({ store: s, now: NOW - 5 * H, apiKey: KEY, fetch, quota: { spend: (n) => { units += n; }, canSpend: () => true } });
  s.db.prepare('UPDATE tracker_jobs SET next_at = ? WHERE id = ?').run(NOW + 19 * H, 'radar');
  // "Up Next" lists the extension saw over the last weeks: niche channels next to each other and next to radar channels.
  const ids = Object.fromEntries(sim.channels.map((c) => [c.name, c.channel_id]));
  const R = Object.fromEntries(RCH.map((c) => [c[0], { id: uc(c[1]), name: c[0], handle: c[1] }]));
  const T = (name) => ({ id: ids[name], name, handle: sim.channels.find((c) => c.name === name).handle });
  const watch = [
    ['Kenji Explains', [T('Leila Gharani'), T('Excel Campus'), R['Sheet Wizard'], R['Formula Friday'], T('MyOnlineTrainingHub')], 12],
    ['Leila Gharani', [T('Kenji Explains'), T('Kevin Stratvert'), T('MyOnlineTrainingHub'), R['Data Doodles'], R['Pivot Point TV']], 15],
    ['Excel Campus', [T('Kenji Explains'), T('Leila Gharani'), R['Pivot Point TV'], R['Grid Logic']], 8],
    ['Hands on Excel', [T('Excel Champs'), T('Easy Click Learning'), R['Sheet Wizard'], R['Cell Mates'], T('Learn Skills Daily')], 6],
    ['Excel Champs', [T('Hands on Excel'), R['Sheet Wizard'], R['Spreadsheet Sisters'], T('Bright Minds Hub')], 5],
    ['MyOnlineTrainingHub', [T('Leila Gharani'), R['Data Doodles'], T('Excel Campus'), R['Formula Friday']], 7],
    ['Kevin Stratvert', [T('Leila Gharani'), T('Technology for Teachers and Students'), R['Office Pro Tips']], 9],
    ['Cody Baldwin', [T('Marg Analytics'), R['Grid Logic'], T('Excel Champion')], 4]
  ];
  for (const [src, recs, n] of watch) for (let i = 0; i < n; i++) DISC.putCoRecs(s, { source: ids[src], recs: recs.slice(0, 2 + (i % recs.length)) }, NOW - (n - i) * 2.5 * D);
  // Perceptual hashes: thumbnails of one topic look alike (the demo draws one image per topic, too).
  const TOP = ['xlookup', 'pivot', 'power query', 'dashboard', 'conditional', 'vba', 'lambda', 'copilot', 'gantt', 'validation', 'charts', 'shortcut', 'flash fill', 'filter', 'index match', 'budget', 'power pivot', 'dynamic', 'checkbox', 'regex'];
  const base = (i) => ((0x9e3779b97f4a7c15n * BigInt(i + 1)) & 0xffffffffffffffffn);
  const flip = (h, k, seed) => { let x = h; for (let j = 0; j < k; j++) x ^= 1n << BigInt((seed * 13 + j * 29) % 64); return x; };
  const putH = s.db.prepare('INSERT OR REPLACE INTO thumb_hashes (video_id, hash, at) VALUES (?, ?, ?)');
  let k = 0;
  for (const v of s.db.prepare('SELECT video_id, title FROM tracked_videos').all().concat(s.db.prepare('SELECT video_id, title FROM radar_videos').all())) {
    const t = String(v.title || '').toLowerCase();
    const ti = TOP.findIndex((w) => t.includes(w.split(' ')[0]));
    putH.run(v.video_id, 'd:' + flip(base(ti < 0 ? 0 : ti), k++ % 7, k).toString(16).padStart(16, '0'), NOW - D);
  }
  // The user's own channel is connected: its YouTube search terms of the last two weeks (phase 2's own_breakdowns).
  const mine = sim.mine;
  s.db.prepare('INSERT OR REPLACE INTO own_channels (channel_id, title, handle, connected_at, active, updated_at) VALUES (?, ?, ?, ?, 1, ?)').run(mine, 'Hands on Excel', 'handsonexcel', NOW - 40 * D, NOW);
  const terms = [['excel pivot table', 41, 36], ['pivot table excel', 18, 9], ['excel pivot table for beginners', 12, 4], ['how to make a pivot table', 7, 6], ['hands on excel', 5, 5], ['excel xlookup', 3, 0]];
  for (const [wk, idx] of [['2026-11-09', 2], ['2026-11-02', 1]]) {
    s.db.prepare('INSERT OR REPLACE INTO own_breakdowns (channel_id, week, kind, data, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(mine, wk, 'search_terms', JSON.stringify({ rows: terms.map((t) => ({ key: t[0], views: t[idx], minutes: t[idx] * 2.4 })).filter((r) => r.views) }), NOW);
  }

  // Local thumbnails (the niche fixture's SVGs) and avatars, so the demo works offline.
  const thumbFor = (title) => {
    const t = String(title || '').toLowerCase();
    const hit = TOP.find((w) => t.includes(w.split(' ')[0])) || 'xlookup';
    return '/dev/youtube/niche/thumbs/' + hit.replace(/\s+/g, '-') + '.svg';
  };
  const fix = (o) => {
    if (Array.isArray(o)) return o.forEach(fix);
    if (!o || typeof o !== 'object') return;
    if (typeof o.thumb === 'string' && /ytimg\.com/.test(o.thumb)) o.thumb = thumbFor(o.title);
    if (typeof o.thumb === 'string' && /ggpht\.com/.test(o.thumb)) o.thumb = null;
    Object.values(o).forEach(fix);
  };
  const write = (name, obj) => { fix(obj); writeFileSync(join(out, name), JSON.stringify(obj)); console.log('wrote', name, Math.round(JSON.stringify(obj).length / 1024) + ' KB'); };
  write('radar.json', DISC.radarPage(s, { niche: 'Excel', now: NOW }));
  write('map.json', DISC.channelMap(s, { niche: 'Excel', now: NOW }));
  const { fetch: f2 } = fakeFetch();
  const instant = { run: (fn) => fn() };
  write('keywords.json', await DISC.keywordIdeas(s, { niche: 'Excel', fetch: f2, now: NOW, limiter: instant, lang: 'en' }));
  write('keywords-tr.json', await DISC.keywordIdeas(s, { niche: 'Excel', fetch: f2, now: NOW, limiter: instant, lang: 'tr' }));
  const lambda = s.db.prepare("SELECT video_id FROM tracked_videos WHERE title LIKE 'LAMBDA just%'").get().video_id;
  write('thumbs.json', await DISC.similarThumbs(s, { video: lambda, now: NOW, fetch: async () => ({ ok: false }) }));
  write('similar-kenji.json', DISC.similarChannels(s, { channel: KENJI, now: NOW }));
  write('similar-sheetwizard.json', DISC.similarChannels(s, { channel: uc('sheetwizard'), now: NOW }));
  console.log('radar units', units, 'lambda video', lambda);
}
