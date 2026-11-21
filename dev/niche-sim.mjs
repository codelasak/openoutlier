// A deterministic stand-in for ten weeks of niche tracking (phase 1), written straight
// into a Store's tables: tracked channels, their videos with growth curves measured on
// the tracker's schedule (Data API on the age tiers, RSS every 3 h in the first week,
// a little behind the API), daily channel stats, title / thumbnail changes, breakouts.
// Used by tests/niche.test.mjs (MCP tools on realistic data) and by
// dev/make-niche-fixture.mjs (the Library demo's #/niche page). Never touches a real library.
const H = 3600e3;
const D = 24 * H;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const CHANNELS = [
  ['Kevin Stratvert', 'KevinStratvert', 3100000], ['Leila Gharani', 'LeilaGharani', 2900000], ['Kenji Explains', 'KenjiExplains', 1100000],
  ['MyOnlineTrainingHub', 'MyOnlineTrainingHub', 760000], ['Excel Campus', 'ExcelCampus', 980000], ['Simon Sez IT', 'simonsezit', 690000],
  ['Excel Dictionary', 'exceldictionary', 210000], ['Learn Skills Daily', 'learnskillsdaily', 98000], ['Easy Click Learning', 'easyclicklearning', 120000],
  ['Excel Champs', 'excelchamps', 61000], ['Cody Baldwin', 'CodyBaldwin', 140000], ['Excel Champion', 'excelchampion', 45000],
  ['Marg Analytics', 'marganalytics', 33000], ['Bright Minds Hub', 'brightmindshub', 18000], ['Technology for Teachers and Students', 'TechnologyforTeachersandStudents', 1500000],
  ['Hands on Excel', 'handsonexcel', 1240, true]
];

const TOPICS = [
  ['XLOOKUP', 1.25, 6], ['Pivot Tables', 1.1, 6], ['Power Query', 1.15, 5], ['Dashboard', 1.4, 4], ['Conditional Formatting', 0.95, 3],
  ['VBA Macros', 0.7, 3], ['LAMBDA', 2.3, 1], ['Copilot in Excel', 2.0, 1], ['Gantt Chart', 1.9, 1], ['Data Validation', 0.85, 3],
  ['Charts', 1.0, 4], ['Shortcuts', 1.05, 4], ['Flash Fill', 1.1, 2], ['FILTER function', 1.2, 3], ['INDEX MATCH', 0.9, 3],
  ['Budget Template', 1.3, 2], ['Power Pivot', 0.9, 2], ['Dynamic Arrays', 1.35, 2], ['Checkboxes', 1.6, 1], ['Regex functions', 1.7, 1]
];
const FORMS = [
  (t) => `${t} in 10 minutes`, (t) => `${t} for Beginners`, (t) => `7 ${t} tricks you'll use every day`, (t) => `How to use ${t}`,
  (t) => `${t} explained (2026)`, (t) => `Stop doing this: ${t}`, (t) => `${t}: the complete guide`, (t) => `${t} vs the old way`
];
const SHORT_FORMS = [(t) => `${t} in 30 seconds #shorts`, (t) => `Did you know this ${t} trick? 🤯`, (t) => `${t} hack`, (t) => `One ${t} tip`];
const DAY_MULT = [0.85, 0.95, 1.3, 1.25, 1.05, 0.9, 0.8]; // Sun … Sat
const blockMult = (hUtc) => (hUtc >= 13 && hUtc < 17 ? 1.25 : hUtc >= 17 && hUtc < 21 ? 1.05 : hUtc < 6 ? 0.75 : 0.95);

/** Cumulative share of the first 30 days reached at hour h (Weibull-like, 1 at 720 h, keeps growing slowly after). */
function share(h, tau, k) {
  const f = (x) => 1 - Math.exp(-Math.pow(x / tau, k));
  return f(h) / f(720);
}

function pick(r, list) { return list[Math.floor(r() * list.length)]; }

/**
 * Fill a store. opts: { now, seed = 7, weeks = 10, keepRecentFor = [] }.
 * Returns { channels: [{ channel_id, name }], breakout: video_id, mine: channel_id, pivot: video_id }.
 */
export function simulate(store, { now = Date.now(), seed = 7, weeks = 10 } = {}) {
  const r = rng(seed);
  const db = store.db;
  const start = now - weeks * 7 * D;
  const insCh = db.prepare(`INSERT OR REPLACE INTO tracked_channels (channel_id, account_id, niche, mine, added_at, rss_checked_at, active, name, handle, subs, backfilled_at)
    VALUES (?, ?, 'Excel', ?, ?, ?, 1, ?, ?, ?, ?)`);
  const insV = db.prepare(`INSERT OR REPLACE INTO tracked_videos (video_id, channel_id, published_at, type, title, thumb, duration, keywords, first_seen, found_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insS = db.prepare('INSERT OR IGNORE INTO video_stats (video_id, ts, views, likes, comments, source) VALUES (?, ?, ?, ?, ?, ?)');
  const insCS = db.prepare(`INSERT OR REPLACE INTO channel_stats (channel_id, day, subs, views, videos, source) VALUES (?, ?, ?, ?, ?, 'api')`);
  const insM = db.prepare('INSERT OR IGNORE INTO video_meta_log (video_id, ts, title, thumb_hash, duration, thumb_url, source) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insJ = db.prepare(`INSERT OR REPLACE INTO tracker_jobs (id, kind, video_id, channel_id, published_at, next_at, tier) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const out = { channels: [], breakout: null, breakout24: null, mine: null, pivot: null, titleChange: null };
  let vn = 0;
  const vid = () => ('sim' + (vn++).toString(36).padStart(4, '0') + 'xxxxxxxx').slice(0, 11);

  db.exec('BEGIN');
  try {
    CHANNELS.forEach(([name, handle, subs, mine], ci) => {
      const cid = ('UCsim' + handle.replace(/[^A-Za-z0-9]/g, '') + 'xxxxxxxxxxxxxxxxxxxxxx').slice(0, 24);
      out.channels.push({ channel_id: cid, name, handle, mine: !!mine });
      if (mine) out.mine = cid;
      insCh.run(cid, 'yt/' + handle.toLowerCase(), mine ? 1 : 0, start, now - Math.floor(r() * 14 * 60e3), name, handle, subs, start + 5 * 60e3);
      const base = mine ? 900 : subs * (0.02 + r() * 0.05); // typical 30-day views of a long video
      const perWeek = mine ? 1 : 0.6 + r() * 2.2;
      const shortsPerWeek = mine ? 1.5 : r() < 0.7 ? 0.5 + r() * 3 : 0;
      // Older uploads (seen by the backfill): one API reading at the start, weekly after.
      for (let i = 0; i < 18; i++) {
        const id = vid();
        const isShort = shortsPerWeek && i % 3 === 0;
        const pub = start - (5 + i * 9 + r() * 6) * D;
        const topic = pick(r, TOPICS);
        const views = Math.round(base * (isShort ? 0.6 : 1) * Math.exp((r() - 0.5) * 1.4) * (1.2 + i * 0.03));
        insV.run(id, cid, Math.round(pub), isShort ? 'short' : 'video', (isShort ? pick(r, SHORT_FORMS) : pick(r, FORMS))(topic[0]), `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
          isShort ? 20 + Math.floor(r() * 40) : 300 + Math.floor(r() * 1500), JSON.stringify([topic[0].toLowerCase(), 'excel']), start, 'backfill', start);
        for (let t = start + 10 * 60e3; t <= now; t += 7 * D) insS.run(id, Math.round(t), Math.round(views * (1 + (t - start) / (90 * D) * 0.15)), Math.round(views / 45), Math.round(views / 900), 'api');
        insM.run(id, start + 10 * 60e3, null, null, null, null, 'api');
      }
      // Uploads since tracking started: measured from their first hour.
      const n = Math.max(1, Math.round(perWeek * weeks));
      const ns = Math.round(shortsPerWeek * weeks);
      const items = [];
      for (let i = 0; i < n; i++) items.push({ short: false, pub: start + r() * (now - start - 2 * H) });
      for (let i = 0; i < ns; i++) items.push({ short: true, pub: start + r() * (now - start - 2 * H) });
      if (mine) items.push({ short: false, pub: Date.parse('2026-11-19T16:00:00Z') < now - 3 * H ? Date.parse('2026-11-19T16:00:00Z') : now - 50 * H, pivot: true });
      // The breakouts: a new long video of two mid-size channels takes off (one passed 6 h, one 24 h).
      if (name === 'Kenji Explains') items.push({ short: false, pub: now - 13.5 * H, breakout: 6 });
      if (name === 'Excel Campus') items.push({ short: false, pub: now - 31 * H, breakout: 24 });
      for (const it of items) {
        const id = vid();
        const d = new Date(it.pub);
        // Uploads land mostly on a channel's usual slot.
        const topic = it.pivot ? ['Pivot Tables', 1.1] : pick(r, TOPICS.flatMap((t) => Array(t[2]).fill(t)));
        const title = it.breakout === 6 ? 'LAMBDA just replaced half my formulas' : it.breakout === 24 ? 'Copilot in Excel: 5 prompts that actually work' : it.pivot ? 'Pivot Tables from scratch: build a sales report in 8 minutes' : (it.short ? pick(r, SHORT_FORMS) : pick(r, FORMS))(topic[0]);
        const dur = it.short ? 15 + Math.floor(r() * 45) : 240 + Math.floor(r() * 1800);
        const lenMult = it.short ? 1 : dur < 300 ? 0.8 : dur < 600 ? 1.05 : dur < 1200 ? 1.15 : dur < 2400 ? 0.95 : 0.75;
        const luck = Math.exp((r() - 0.5) * 1.1);
        let final = base * (it.short ? 0.7 : 1) * topic[1] * DAY_MULT[d.getUTCDay()] * blockMult(d.getUTCHours()) * lenMult * luck;
        const evergreen = !it.short && r() < 0.25;
        let tau = it.short ? 26 : evergreen ? 220 : 55;
        let k = it.short ? 0.95 : evergreen ? 0.55 : 0.72;
        const age = (now - it.pub) / H;
        // The breakouts: the newest long video of two mid-size channels takes off.
        if (it.breakout === 6) { final = base * 5; tau = 14; out.breakout = id; }
        if (it.breakout === 24) { final = base * 3.2; tau = 26; out.breakout24 = id; }
        if (it.pivot) { out.pivot = id; final = 2100; tau = 70; }
        insV.run(id, cid, Math.round(it.pub), it.short ? 'short' : 'video', title, `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, dur, JSON.stringify([topic[0].toLowerCase(), 'excel', 'tutorial']), Math.round(it.pub + 9 * 60e3), 'rss', now);
        insM.run(id, Math.round(it.pub + 9 * 60e3), title, 'd:' + Math.floor(r() * 2 ** 32).toString(16).padStart(8, '0') + '00000000', dur, `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, 'rss');
        // A few competitors retitle (and re-thumbnail) a slow video around 30 h: it speeds up after.
        const retitle = !it.short && !it.pivot && !it.breakout && age > 80 && luck < 0.95 && r() < 0.2;
        const changeAt = it.pub + 30 * H;
        const views = (h) => {
          let v = final * share(h, tau, k);
          if (retitle && it.pub + h * H > changeAt) v += final * 0.7 * share(h - 30, 30, 0.85);
          return Math.round(v);
        };
        // Data API: the age tiers.
        let t = it.pub + 20 * 60e3;
        while (t <= now) {
          const h = (t - it.pub) / H;
          const v = views(h);
          insS.run(id, Math.round(t), v, Math.round(v / (it.short ? 32 : 40)), Math.round(v / (it.short ? 700 : 260)), 'api');
          t += h < 6 ? 30 * 60e3 : h < 48 ? H : h < 168 ? 6 * H : h < 720 ? D : 7 * D;
        }
        // RSS: every 3 h in the first week, reporting what the API had ~25 min earlier.
        for (let tr = it.pub + 2 * H + 25 * 60e3; tr <= Math.min(now, it.pub + 7 * D); tr += 3 * H) {
          const v = views((tr - it.pub) / H - 25 / 60);
          insS.run(id, Math.round(tr), v, Math.round(v / 40), null, 'rss');
        }
        if (retitle) {
          if (!out.titleChange) out.titleChange = id;
          insM.run(id, Math.round(changeAt), title.replace(/^(\d+ )?/, '').replace(/ (for Beginners|in 10 minutes)$/, '') + ' (most people get this wrong)', 'd:ffff' + Math.floor(r() * 2 ** 32).toString(16).padStart(8, '0') + '0000', dur, `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, 'rss');
        }
        const nextH = age < 6 ? 0.5 : age < 48 ? 1 : age < 168 ? 6 : age < 720 ? 24 : 168;
        insJ.run('video:' + id, 'video', id, cid, Math.round(it.pub), Math.round(now + nextH * H * r()), age < 6 ? 'h0-6' : age < 48 ? 'h6-48' : age < 168 ? 'd2-7' : age < 720 ? 'd7-30' : 'd30+');
      }
      insJ.run('rss:' + cid, 'rss', null, cid, null, Math.round(now + r() * 15 * 60e3), null);
      // Daily channel stats.
      let s = subs * (0.93 - r() * 0.04);
      let views = subs * 60;
      let videos = 120 + Math.floor(r() * 500);
      for (let t = start; t <= now; t += D) {
        s += subs * (0.0006 + r() * 0.0012) * (mine ? 3 : 1);
        views += subs * (0.03 + r() * 0.04);
        if (r() < perWeek / 7) videos++;
        insCS.run(cid, new Date(t).toISOString().slice(0, 10), Math.round(mine ? 980 + (t - start) / (now - start) * 260 : s), Math.round(views), videos);
      }
    });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  // The breakout rows the tracker would have written (scores are filled in by the caller's check).
  return out;
}

/** Mark the simulated breakouts the way rss/video jobs do (uses the real check). */
export async function markBreakouts(store, now, checkBreakouts) {
  const ids = store.db.prepare('SELECT video_id FROM tracked_videos WHERE published_at >= ?').all(now - 3 * D).map((r) => r.video_id);
  return checkBreakouts({ store, now, flags: {} }, ids);
}

export { H, D, rng };
