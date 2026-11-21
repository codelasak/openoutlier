#!/usr/bin/env node
// Builds dev/youtube/own/<state>.json: what the bridge answers the Library's Kanalım page
// (mcp/own-history.mjs ownPage, plus the token status), computed by the real collection
// jobs against the simulated Google of dev/own-sim.mjs in a throwaway home and database.
// dev/dashboard-demo.html#/my-youtube?ytanalytics=<state> serves them. States:
//   connected   one mid-sized channel on its way to the YPP (Excel Bugs)
//   two         Hands on Excel (tiny, tracked in the Excel niche) + a Quran channel, and combined
//   tiny        a channel connected days after it started: 1 subscriber, two uploads
//   monetized   a channel in the Partner Program: revenue, RPM, CPM
//   reconnect   an old sign-in without the revenue scope + a second channel whose sign-in expired
//   collecting  just connected: the history is still loading
// Never touches ~/.openoutlier.
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const home = mkdtempSync(join(tmpdir(), 'openoutlier-own-fixture-home-'));
process.env.OPENOUTLIER_HOME = home;
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'youtube', 'own');
const YA = await import('../mcp/youtube-analytics.mjs');
const OWN = await import('../mcp/own-history.mjs');
const { Store } = await import('../mcp/store.mjs');
const SIM = await import('./own-sim.mjs');
const { simulate } = await import('./niche-sim.mjs');
const F = createRequire(import.meta.url)('../src/features.js');
const { rm, readdir } = await import('node:fs/promises');

const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);
writeFileSync(YA.CONFIG_FILE, JSON.stringify({ installed: { client_id: '1-demo.apps.googleusercontent.com', client_secret: 'demo' } }));

async function build(state, specs, { niche = false, monetary = {}, revoked = {}, partial = false } = {}) {
  for (const f of await readdir(home)) if (/^youtube-token/.test(f)) await rm(join(home, f));
  const s = new Store(mkdtempSync(join(tmpdir(), 'openoutlier-own-fixture-')));
  let mineVideos = null;
  if (niche) {
    simulate(s, { now: NOW, seed: 7 });
    // Hands on Excel is a brand-new channel: 1 subscriber, a few dozen views per video.
    const mine = s.db.prepare('SELECT channel_id FROM tracked_channels WHERE mine = 1').get().channel_id;
    s.db.prepare('UPDATE tracked_channels SET subs = 1 WHERE channel_id = ?').run(mine);
    s.db.prepare('UPDATE video_stats SET views = MAX(0, CAST(views / 12 AS INTEGER)), likes = CAST(likes / 12 AS INTEGER) WHERE video_id IN (SELECT video_id FROM tracked_videos WHERE channel_id = ?)').run(mine);
    mineVideos = s.db.prepare('SELECT v.video_id AS id, v.title, v.published_at, v.type, v.duration, (SELECT MAX(views) FROM video_stats WHERE video_id = v.video_id) AS total FROM tracked_videos v WHERE channel_id = ?').all(mine);
  }
  const chans = {};
  specs.forEach((spec, i) => {
    const ch = SIM.simChannel(spec, NOW, spec.id === 'UCsimhandsonexcelxxxxxxx' && mineVideos ? { videos: mineVideos.map((v) => ({ ...v, total: Math.max(20, Math.round((v.total || 30) * 1.4)) })) } : {});
    chans[spec.id] = ch;
    const tok = SIM.tokenFor(ch, { connectedAt: new Date(NOW - (30 - i * 5) * 864e5).toISOString(), monetary: monetary[spec.id] !== false });
    tok.channel.thumb = '/dev/youtube/own/thumbs/avatar-' + spec.handle.toLowerCase() + '.svg';
    if (revoked[spec.id]) tok.reconnect = new Date(NOW - 3600e3).toISOString();
    writeFileSync(YA.tokenFile(spec.id), JSON.stringify(tok), { mode: 0o600 });
  });
  const g = SIM.fakeGoogle(chans, { monetary });
  const ctx = { store: s, now: NOW, fetch: g.fetch, flags: F.resolve(null), log: () => {}, chunksPerRun: partial ? 2 : 40 };
  for (const spec of specs) {
    const job = (k) => ({ id: k + ':' + spec.id, channel_id: spec.id });
    s.db.prepare(`INSERT INTO own_channels (channel_id, title, handle, thumb, created, connected_at, active) VALUES (?, ?, ?, ?, ?, ?, 1)`)
      .run(spec.id, spec.title, spec.handle, '/dev/youtube/own/thumbs/avatar-' + spec.handle.toLowerCase() + '.svg', chans[spec.id].created, NOW - 30 * 864e5 + specs.indexOf(spec) * 5 * 864e5);
    await OWN.backfillJob(ctx, job('own-backfill'));
    if (partial) continue;
    await OWN.dailyJob(ctx, job('own-daily'));
    await OWN.videosJob(ctx, job('own-videos'));
    await OWN.weeklyJob(ctx, job('own-weekly'));
    s.db.prepare('UPDATE own_channels SET thumb = ? WHERE channel_id = ?').run('/dev/youtube/own/thumbs/avatar-' + spec.handle.toLowerCase() + '.svg', spec.id);
  }
  // An expired sign-in: marked after the history was collected (as if it lapsed since).
  for (const id of Object.keys(revoked)) { const f = YA.tokenFile(id); const t = JSON.parse(await (await import('node:fs/promises')).readFile(f, 'utf8')); writeFileSync(f, JSON.stringify({ ...t, reconnect: new Date(NOW - 3600e3).toISOString() }), { mode: 0o600 }); }
  if (partial) s.db.prepare('UPDATE own_channels SET subs = ?, last_daily_at = NULL WHERE channel_id = ?').run(chans[specs[0].id].subsTotal(), specs[0].id);
  const status = await YA.status();
  status.channels.forEach((c) => { c.thumb = '/dev/youtube/own/thumbs/avatar-' + String(c.handle).toLowerCase() + '.svg'; });
  const flags = F.resolve(null);
  const pages = {};
  for (const spec of specs) pages[spec.id] = OWN.ownPage(s, { channel: spec.id, now: NOW, status, flags });
  if (specs.length > 1) pages.all = OWN.ownPage(s, { channel: 'all', now: NOW, status, flags });
  const fixture = { state, now: NOW, status: { ok: true, ...status, redirect_port: 47811 }, pages };
  fix(fixture);
  writeFileSync(join(out, state + '.json'), JSON.stringify(fixture));
  console.log('wrote', state + '.json', Math.round(JSON.stringify(fixture).length / 1024) + ' KB', specs.map((x) => x.title).join(' + '));
  s.close();
}

// Thumbnails: the niche fixture's Excel ones, and a few drawn here for the Quran channel and the avatars.
mkdirSync(join(out, 'thumbs'), { recursive: true });
const NICHE_TOPICS = ['xlookup', 'pivot', 'power query', 'dashboard', 'conditional', 'vba', 'lambda', 'copilot', 'gantt', 'validation', 'charts', 'shortcut', 'flash fill', 'filter', 'index match', 'budget', 'power pivot', 'dynamic', 'checkbox', 'regex'];
const QURAN = [['rahman', 'AR-RAHMAN', '#0F5132'], ['yasin', 'YASIN', '#14532D'], ['mulk', 'AL-MULK', '#1E3A5F'], ['kursi', 'AYATUL KURSI', '#3B2F0B'], ['kahf', 'AL-KAHF', '#22333B'], ['waqiah', "AL-WAQI'AH", '#4A1D1D'], ['fatiha', 'AL-FATIHA', '#1F3A2E'], ['surahs', 'LAST 10', '#2D2A4A']];
for (const [key, word, color] of QURAN) {
  const fs = word.length > 9 ? 30 : 42;
  writeFileSync(join(out, 'thumbs', 'quran-' + key + '.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="320" height="180"><rect width="320" height="180" fill="${color}"/>`
    + `<circle cx="252" cy="90" r="58" fill="none" stroke="#E9D8A6" stroke-width="3" opacity="0.7"/><circle cx="252" cy="90" r="44" fill="none" stroke="#E9D8A6" stroke-width="1.5" opacity="0.5"/>`
    + `<text x="18" y="${84 + fs / 3}" font-family="Georgia, serif" font-weight="700" font-size="${fs}" fill="#F6F1E1">${word}</text><rect x="18" y="122" width="70" height="4" fill="#E9D8A6"/></svg>`);
}
for (const [handle, bg, fg, letter] of [['handsonexcel', '#107C41', '#fff', 'HE'], ['quranrecitationsdemo', '#0F5132', '#E9D8A6', 'Q'], ['excelbugsdemo', '#1E3BFF', '#C8FF2E', 'EB'], ['sheetsenseidemo', '#0B0E1A', '#C8FF2E', 'SS']]) {
  writeFileSync(join(out, 'thumbs', 'avatar-' + handle + '.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 88" width="88" height="88"><rect width="88" height="88" fill="${bg}"/>`
    + `<text x="44" y="${letter.length > 1 ? 56 : 60}" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="${letter.length > 1 ? 32 : 44}" fill="${fg}">${letter}</text></svg>`);
}
function thumbFor(title) {
  const t = String(title || '').toLowerCase();
  const q = QURAN.find(([k]) => t.includes(k));
  if (q || /surah|quran|ayat/.test(t)) return '/dev/youtube/own/thumbs/quran-' + (q ? q[0] : 'surahs') + '.svg';
  const hit = NICHE_TOPICS.find((k) => t.includes(k.split(' ')[0])) || 'xlookup';
  return '/dev/youtube/niche/thumbs/' + hit.replace(/\s+/g, '-') + '.svg';
}
function fix(o) {
  if (Array.isArray(o)) return o.forEach(fix);
  if (!o || typeof o !== 'object') return;
  if (typeof o.thumb === 'string' && o.thumb.includes('ytimg.com')) o.thumb = thumbFor(o.title);
  Object.values(o).forEach(fix);
}

const S = SIM.SPECS;
await build('connected', [S.excelbugs]);
await build('two', [S.handsonexcel, S.quran], { niche: true });
await build('tiny', [S.tinynew]);
await build('monetized', [S.sheetsensei]);
await build('reconnect', [S.excelbugs, S.quran], { monetary: { [S.excelbugs.id]: false }, revoked: { [S.quran.id]: true } });
await build('collecting', [S.excelbugs], { partial: true });
