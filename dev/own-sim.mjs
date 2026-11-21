// A deterministic stand-in for Google (OAuth token endpoint, YouTube Analytics reports and
// the Data API calls the own-history jobs make) over simulated channels, for phase 2
// (own-channel history). Each channel's uploads get a daily view curve (long-form: a few
// strong days, then a long search tail; Shorts: a spike), and everything Analytics answers
// is derived from those views: watch time, subscribers, likes, thumbnail impressions + CTR,
// the Shorts / long-form split, revenue for a monetized channel, and weekly breakdowns
// (traffic sources, search terms that change week by week, countries, age × gender …).
// Like Analytics, the newest two days are missing (the lag).
// Used by tests/own-history.test.mjs and dev/make-own-fixture.mjs. Never talks to Google.
const DAY = 864e5;
const day = (t) => new Date(t).toISOString().slice(0, 10);
const ms = (d) => Date.parse(d + 'T00:00:00Z');
const addDays = (d, n) => day(ms(d) + n * DAY);

/** A stable pseudo-random number in [0, 1) for a string. */
export function hash01(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const noise = (key, spread = 0.2) => 1 - spread + 2 * spread * hash01(key);

const EXCEL_TERMS = [['excel pivot table', 5, 1.1], ['pivot table excel', 4, 1.05], ['xlookup', 3, 0.95], ['excel tutorial', 2.5, 1], ['how to make a pivot table', 2, 1.2],
  ['excel dashboard', 1.6, 1.3], ['excel for beginners', 1.4, 0.9], ['excel formulas', 1.2, 1], ['power query', 1, 1.15], ['excel shortcuts', 0.8, 0.85], ['vlookup vs xlookup', 0.7, 1.1], ['excel budget template', 0.5, 1.4]];
const QURAN_TERMS = [['surah rahman', 5, 1], ['quran recitation', 4, 1.05], ['surah yasin', 3.5, 0.95], ['beautiful quran', 2.5, 1.1], ['surah mulk', 2.2, 1], ['quran for sleep', 2, 1.25],
  ['ayatul kursi', 1.8, 0.9], ['surah kahf', 1.5, 1.3], ['quran tilawat', 1.2, 1], ['surah fatiha', 1, 0.95]];

/** The demo / test channels. ids are 24 characters (UC + 22). */
export const SPECS = {
  handsonexcel: {
    id: 'UCsimhandsonexcelxxxxxxx', title: 'Hands on Excel', handle: 'handsonexcel', created: '2025-08-10', ctr: 0.031, rpm: 0, subsTotal: 1, subsDays: ['2026-11-20'],
    longPct: 34, shortPct: 71, longDur: 300, shortDur: 26, terms: EXCEL_TERMS.slice(0, 4), traffic: { YT_SEARCH: 0.41, RELATED_VIDEO: 0.18, SUBSCRIBER: 0.04, SHORTS: 0.22, NO_LINK_OTHER: 0.08, EXT_URL: 0.07 },
    countries: { US: 0.28, IN: 0.18, TR: 0.12, GB: 0.08, PH: 0.06, DE: 0.05, PK: 0.05, CA: 0.04 }, videos: { long: [[-100, 60], [-71, 85], [-44, 40], [-2, 110]], short: [[-90, 90], [-60, 50], [-30, 70], [-12, 35]] },
    titles: ['Pivot Tables from scratch: build a sales report in 8 minutes', 'XLOOKUP explained (2026)', 'FILTER function explained', 'How to use Regex functions'], shortTitles: ['Shortcuts hack', 'Did you know this XLOOKUP trick?', 'One Pivot Tables tip', 'Flash Fill hack']
  },
  quran: {
    id: 'UCdemoQuranRecitations01', title: 'Quran Recitations (demo)', handle: 'quranrecitationsdemo', created: '2023-02-01', ctr: 0.058, rpm: 0, subsRate: 0.0011, shortSubsRate: 0.000058,
    longPct: 46, shortPct: 88, longDur: 520, shortDur: 41, terms: QURAN_TERMS, traffic: { SHORTS: 0.58, YT_SEARCH: 0.17, RELATED_VIDEO: 0.12, SUBSCRIBER: 0.06, PLAYLIST: 0.04, NO_LINK_OTHER: 0.03 },
    countries: { PK: 0.21, IN: 0.17, ID: 0.12, EG: 0.09, SA: 0.07, TR: 0.06, BD: 0.06, US: 0.05, GB: 0.03 }, everyLong: 21, everyShort: 2, longStrength: 420, shortStrength: 17000, growth: 1.9,
    title: 'Quran Recitations (demo)', titleWords: ['Surah Rahman', 'Surah Yasin', 'Surah Mulk', 'Ayatul Kursi', 'Surah Kahf', 'Surah Waqiah', 'Surah Fatiha', 'Last 10 Surahs']
  },
  excelbugs: {
    id: 'UCdemoExcelBugsChannel01', title: 'Excel Bugs (demo)', handle: 'ExcelBugsDemo', created: '2024-06-01', ctr: 0.047, rpm: 0, subsRate: 0.0036, shortSubsRate: 0.0007,
    longPct: 41, shortPct: 79, longDur: 340, shortDur: 29, terms: EXCEL_TERMS, traffic: { YT_SEARCH: 0.36, RELATED_VIDEO: 0.24, SUBSCRIBER: 0.09, SHORTS: 0.17, NO_LINK_OTHER: 0.06, EXT_URL: 0.05, PLAYLIST: 0.03 },
    countries: { US: 0.31, IN: 0.16, GB: 0.08, PH: 0.06, CA: 0.05, AU: 0.04, DE: 0.04, TR: 0.03, NG: 0.03 }, everyLong: 9, everyShort: 4, longStrength: 640, shortStrength: 900, growth: 1.6,
    titleWords: ['XLOOKUP', 'Pivot Tables', 'Power Query', 'Dashboard', 'Conditional Formatting', 'FILTER function', 'Data Validation', 'Charts', 'LAMBDA', 'Checkboxes']
  },
  sheetsensei: {
    id: 'UCdemoSheetSenseiChann01', title: 'Sheet Sensei (demo)', handle: 'SheetSenseiDemo', created: '2021-03-15', ctr: 0.052, rpm: 4.1, yppSince: '2022-01-10', subsRate: 0.0024, shortSubsRate: 0.0006,
    longPct: 44, shortPct: 81, longDur: 410, shortDur: 33, terms: EXCEL_TERMS, traffic: { YT_SEARCH: 0.33, RELATED_VIDEO: 0.29, SUBSCRIBER: 0.11, SHORTS: 0.12, PLAYLIST: 0.05, NO_LINK_OTHER: 0.05, EXT_URL: 0.05 },
    countries: { US: 0.34, IN: 0.12, GB: 0.09, CA: 0.06, AU: 0.05, DE: 0.04, PH: 0.04, NL: 0.03 }, everyLong: 6, everyShort: 5, longStrength: 14000, shortStrength: 9000, growth: 1.45,
    titleWords: ['XLOOKUP', 'Pivot Tables', 'Power Query', 'Dashboard', 'Power Pivot', 'Dynamic Arrays', 'Budget Template', 'Copilot in Excel', 'Gantt Chart', 'INDEX MATCH']
  },
  tinynew: {
    id: 'UCdemoTinyNewChannel0001', title: 'Hands on Excel', handle: 'handsonexcel', created: null, ageDays: 9, ctr: 0.028, rpm: 0, subsTotal: 1, subsDays: null,
    longPct: 31, shortPct: 68, longDur: 290, shortDur: 24, terms: EXCEL_TERMS.slice(0, 2), traffic: { YT_SEARCH: 0.3, RELATED_VIDEO: 0.1, SHORTS: 0.35, NO_LINK_OTHER: 0.15, EXT_URL: 0.1 },
    countries: { US: 0.3, TR: 0.25, IN: 0.2, GB: 0.1 }, videos: { long: [[-2, 40]], short: [[-6, 18]] },
    titles: ['Pivot Tables from scratch: build a sales report in 8 minutes'], shortTitles: ['Did you know this XLOOKUP trick?']
  }
};

const AGE = [['13-17', 2], ['18-24', 21], ['25-34', 34], ['35-44', 21], ['45-54', 12], ['55-64', 6], ['65-', 4]];

/**
 * A channel built from a spec at `now`: its uploads and functions for every number.
 * opts.videos: real uploads to use instead of generated ones ([{ id, title, published_at, type, duration, total }]).
 */
export function simChannel(spec, now, opts = {}) {
  const today = day(now);
  const created = spec.created || addDays(today, -(spec.ageDays || 30));
  const videos = [];
  const mk = (id, title, published, type, strength) => videos.push({ id, title, published, type, strength, duration: type === 'short' ? spec.shortDur + Math.round(hash01(id) * 20) : spec.longDur + Math.round(hash01(id) * 500) });
  if (opts.videos) for (const v of opts.videos) mk(v.id, v.title, v.published_at, v.type, v.total || 50);
  else if (spec.videos) {
    spec.videos.long.forEach(([d, s], i) => mk(('vL' + spec.handle + i + 'xxxxxxxxxx').slice(0, 11), spec.titles[i % spec.titles.length], now + d * DAY - 5 * 3600e3, 'video', s));
    spec.videos.short.forEach(([d, s], i) => mk(('vS' + spec.handle + i + 'xxxxxxxxxx').slice(0, 11), spec.shortTitles[i % spec.shortTitles.length], now + d * DAY - 9 * 3600e3, 'short', s));
  } else {
    // Regular uploads that get stronger as the channel grows (growth: × over the channel's life).
    const life = (ms(today) - ms(created)) / DAY;
    let n = 0;
    for (const [type, every, base] of [['video', spec.everyLong, spec.longStrength], ['short', spec.everyShort, spec.shortStrength]]) {
      for (let t = ms(created) + 3 * DAY; t < now - 6 * 3600e3; t += every * DAY * noise(spec.id + type + t, 0.3)) {
        const age = (t - ms(created)) / DAY;
        const id = (type[0] + spec.handle.slice(0, 4) + (n++).toString(36) + 'xxxxxxxxxx').slice(0, 11).replace(/[^A-Za-z0-9_-]/g, 'x');
        const w = spec.titleWords[n % spec.titleWords.length];
        const title = type === 'short' ? [`${w} in 30 seconds #shorts`, `One ${w} tip`, `${w} hack`][n % 3] : [`${w} for Beginners`, `${w}: the complete guide`, `How to use ${w}`, `${w} explained (2026)`][n % 4];
        const lucky = hash01(id + 'hit') > 0.93 ? 4 + hash01(id) * 6 : 1;
        mk(id, title, t + 15 * 3600e3, type, Math.round(base * Math.pow(spec.growth, age / Math.max(365, life)) * noise(id, 0.5) * lucky * (0.25 + 0.75 * Math.min(1, age / 200))));
      }
    }
  }
  videos.sort((a, b) => b.published - a.published);
  // A video's views on a day: long-form gets ~45 % in the first week then a search tail; Shorts a spike.
  const viewsOn = (v, d) => {
    const a = Math.floor((ms(d) - ms(day(v.published))) / DAY);
    if (a < 0) return 0;
    const f = v.type === 'short' ? 0.42 * Math.exp(-a / 1.6) + 0.0009 : 0.11 * Math.exp(-a / 3) + 0.0022;
    return Math.round(v.strength * f * noise(v.id + d, 0.25));
  };
  const cache = new Map();
  const dayRow = (d) => {
    if (cache.has(d)) return cache.get(d);
    if (d < created || d > today) return null;
    let long = 0;
    let short = 0;
    for (const v of videos) { const x = viewsOn(v, d); if (v.type === 'short') short += x; else long += x; }
    const views = long + short;
    let gained;
    if (spec.subsTotal != null) gained = (spec.subsDays || [addDays(today, -2)]).includes(d) ? spec.subsTotal : 0;
    else gained = Math.round((long * spec.subsRate + short * spec.shortSubsRate) * noise(spec.id + 's' + d, 0.3));
    const lost = spec.subsTotal != null ? 0 : Math.floor(gained * 0.13 * noise(spec.id + 'l' + d, 0.5));
    const longMin = long * spec.longDur * spec.longPct / 100 / 60 * noise(spec.id + 'm' + d, 0.1);
    const shortMin = short * spec.shortDur * spec.shortPct / 100 / 60;
    const ctr = spec.ctr * noise(spec.id + 'c' + d, 0.15);
    const monetized = spec.rpm > 0 && d >= (spec.yppSince || '9999');
    const revenue = monetized ? long * spec.rpm / 1000 * noise(spec.id + 'r' + d, 0.2) + short * 0.06 / 1000 : 0;
    const r = {
      day: d, views, long, short, engaged: Math.round(long * 0.93 + short * 0.71), minutes: Math.round(longMin + shortMin), longMin, shortMin,
      avg_pct: views ? (long * spec.longPct + short * spec.shortPct) / views : 0, subs_gained: gained, subs_lost: lost,
      likes: Math.round(views * 0.034), comments: Math.round(views * 0.004), shares: Math.round(views * 0.006),
      impressions: Math.round(long / ctr * 0.55 + short * 0.4), ctr,
      revenue, monetized
    };
    cache.set(d, r);
    return r;
  };
  const sumDays = (from, to, f) => { let s = 0; for (let d = from; d <= to; d = addDays(d, 1)) { const r = dayRow(d); if (r) s += f(r); } return s; };
  const subsTotal = () => sumDays(created, today, (r) => r.subs_gained - r.subs_lost);
  return { spec, created, today, videos, viewsOn, dayRow, sumDays, subsTotal };
}

const HEAD = (dims, metrics) => dims.map((name) => ({ name, columnType: 'DIMENSION' })).concat(metrics.map((name) => ({ name, columnType: 'METRIC' })));
function metricOf(r, m) {
  switch (m) {
    case 'views': return r.views;
    case 'engagedViews': return r.engaged;
    case 'estimatedMinutesWatched': return r.minutes;
    case 'averageViewDuration': return r.views ? Math.round(r.minutes * 60 / r.views) : 0;
    case 'averageViewPercentage': return Math.round(r.avg_pct * 100) / 100;
    case 'subscribersGained': return r.subs_gained;
    case 'subscribersLost': return r.subs_lost;
    case 'likes': return r.likes;
    case 'comments': return r.comments;
    case 'shares': return r.shares;
    case 'videoThumbnailImpressions': return r.impressions;
    case 'videoThumbnailImpressionsClickRate': return Math.round(r.ctr * 10000) / 10000;
    case 'estimatedRevenue': return Math.round(r.revenue * 1000) / 1000;
    case 'estimatedAdRevenue': return Math.round(r.revenue * 0.93 * 1000) / 1000;
    case 'grossRevenue': return Math.round(r.revenue / 0.55 * 1000) / 1000;
    case 'cpm': return r.monetized ? Math.round(r.revenue / Math.max(1, r.long * 0.55) * 1000 / 0.55 * 100) / 100 : 0;
    case 'playbackBasedCpm': return r.monetized ? Math.round(r.revenue / Math.max(1, r.long * 0.55) * 1000 / 0.5 * 100) / 100 : 0;
    case 'monetizedPlaybacks': return r.monetized ? Math.round(r.long * 0.55) : 0;
    case 'adImpressions': return r.monetized ? Math.round(r.long * 0.77) : 0;
    default: return 0;
  }
}

/** Weekly breakdown rows for [start, end]. */
function breakdown(ch, dims, q, start, end) {
  const s = ch.spec;
  const V = ch.sumDays(start, end, (r) => r.views);
  const M = ch.sumDays(start, end, (r) => r.minutes);
  const rows = [];
  const share = (obj, key) => Object.entries(obj).forEach(([k, w]) => { const v = Math.round(V * w * noise(s.id + k + start, 0.12)); if (v > 0) rows.push([k, v, Math.round(M * w * noise(s.id + 'm' + k + start, 0.15))]); });
  if (dims === 'insightTrafficSourceType') share(s.traffic, 'traffic');
  else if (dims === 'insightTrafficSourceDetail') {
    const search = V * (s.traffic.YT_SEARCH || 0);
    const weekIdx = Math.round((ms(start) - ms(ch.created)) / (7 * DAY));
    const total = s.terms.reduce((a, t) => a + t[1], 0);
    s.terms.forEach(([term, w, trend], i) => {
      // The last two terms only appear in the latest week (new); trend moves each term up or down week by week.
      if (i >= s.terms.length - 2 && end < addDays(ch.today, -8)) return;
      const v = Math.round(search * 0.7 * w / total * Math.pow(trend, (weekIdx % 26) / 6) * noise(s.id + term + start, 0.25));
      if (v >= 2) rows.push([term, v, Math.round(v * s.longDur * s.longPct / 100 / 60)]);
    });
  } else if (dims === 'country') share(s.countries, 'country');
  else if (dims === 'deviceType') share({ MOBILE: 0.71, DESKTOP: 0.21, TABLET: 0.05, TV: 0.03 }, 'device');
  else if (dims === 'subscribedStatus') share({ UNSUBSCRIBED: 0.9, SUBSCRIBED: 0.1 }, 'sub');
  else if (dims === 'insightPlaybackLocationType') share({ WATCH: 0.56, YT_OTHER: 0.31, BROWSE: 0.05, EMBEDDED: 0.04, CHANNEL: 0.04 }, 'place');
  else if (dims === 'ageGroup,gender') {
    if (!V) return { headers: HEAD(['ageGroup', 'gender'], ['viewerPercentage']), rows: [] };
    const male = s.handle.includes('quran') ? 0.68 : 0.62;
    const tot = AGE.reduce((a, x) => a + x[1], 0);
    const out = [];
    AGE.forEach(([age, w]) => ['male', 'female'].forEach((g) => out.push(['age' + age, g, Math.round(w / tot * (g === 'male' ? male : 1 - male) * 10000) / 100])));
    return { headers: HEAD(['ageGroup', 'gender'], ['viewerPercentage']), rows: out };
  }
  rows.sort((a, b) => b[1] - a[1]);
  const dimName = dims;
  const metrics = q.get('metrics').split(',');
  return { headers: HEAD([dimName], metrics), rows: rows.slice(0, Number(q.get('maxResults')) || 50).map(([k, v, m]) => [k, ...metrics.map((x) => (x === 'views' ? v : x === 'estimatedMinutesWatched' ? m : x === 'averageViewDuration' ? Math.round(m * 60 / Math.max(1, v)) : 0))]) };
}

/**
 * A fake fetch for Google over the given channels (a map id → simChannel).
 * opts: { now, monetary: { id: bool } (scope granted), noReach, noContentType, lagDays = 2, onReport(q) }
 */
export function fakeGoogle(channels, opts = {}) {
  const calls = [];
  const lag = opts.lagDays ?? 2;
  const res = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const scopeOf = (id) => ['https://www.googleapis.com/auth/yt-analytics.readonly', 'https://www.googleapis.com/auth/youtube.readonly'].concat(opts.monetary && opts.monetary[id] === false ? [] : ['https://www.googleapis.com/auth/yt-analytics-monetary.readonly']).join(' ');
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    const u = new URL(url);
    if (u.href.startsWith('https://oauth2.googleapis.com/token')) {
      const form = new URLSearchParams(init.body);
      if (form.get('grant_type') === 'authorization_code') {
        const id = String(form.get('code')).replace(/^code-/, '');
        if (!channels[id]) return res(400, { error: 'invalid_grant' });
        return res(200, { access_token: 'at-' + id, refresh_token: 'rt-' + id, expires_in: 3599, scope: scopeOf(id) });
      }
      const id = String(form.get('refresh_token')).replace(/^rt-/, '');
      if (opts.revoked && opts.revoked[id]) return res(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      return res(200, { access_token: 'at-' + id, expires_in: 3599 });
    }
    if (u.href.startsWith('https://oauth2.googleapis.com/revoke')) return res(200, {});
    const id = String(init.headers && init.headers.authorization || '').replace(/^Bearer at-/, '');
    const ch = channels[id];
    if (!ch) return res(401, { error: { code: 401, message: 'Invalid Credentials', errors: [{ reason: 'authError' }] } });
    if (u.pathname.endsWith('/youtube/v3/channels')) {
      const views = ch.sumDays(ch.created, ch.today, (r) => r.views);
      return res(200, { items: [{ id, snippet: { title: ch.spec.title, customUrl: '@' + ch.spec.handle, publishedAt: ch.created + 'T12:00:00Z', thumbnails: { medium: { url: `https://yt3.ggpht.com/${ch.spec.handle}.jpg` } } },
        statistics: { subscriberCount: String(ch.subsTotal()), videoCount: String(ch.videos.length), viewCount: String(views) }, contentDetails: { relatedPlaylists: { uploads: 'UU' + id.slice(2) } } }] });
    }
    if (u.pathname.endsWith('/youtube/v3/playlistItems')) {
      const page = Number(u.searchParams.get('pageToken') || 0);
      const list = ch.videos.slice(page * 50, page * 50 + 50);
      return res(200, { items: list.map((v) => ({ contentDetails: { videoId: v.id, videoPublishedAt: new Date(v.published).toISOString() } })), nextPageToken: ch.videos.length > page * 50 + 50 ? String(page + 1) : undefined });
    }
    if (u.pathname.endsWith('/youtube/v3/videos')) {
      const want = u.searchParams.get('id').split(',');
      return res(200, { items: ch.videos.filter((v) => want.includes(v.id)).map((v) => ({ id: v.id, snippet: { title: v.title, publishedAt: new Date(v.published).toISOString() },
        contentDetails: { duration: `PT${Math.floor(v.duration / 60)}M${v.duration % 60}S` }, status: { privacyStatus: 'public' } })) });
    }
    if (u.origin + u.pathname === 'https://youtubeanalytics.googleapis.com/v2/reports') {
      const q = u.searchParams;
      if (opts.onReport) opts.onReport(q, id);
      const metrics = q.get('metrics').split(',');
      const dims = q.get('dimensions') || '';
      const filters = q.get('filters') || '';
      const start = q.get('startDate');
      const end = q.get('endDate') > addDays(ch.today, -lag) ? addDays(ch.today, -lag) : q.get('endDate');
      if (metrics.some((m) => ['estimatedRevenue', 'cpm', 'monetizedPlaybacks'].includes(m))) {
        if (opts.monetary && opts.monetary[id] === false) return res(403, { error: { code: 403, message: 'Insufficient permission to access this report.', errors: [{ reason: 'insufficientPermissions' }] } });
        if (!(ch.spec.rpm > 0)) return res(403, { error: { code: 403, message: 'Forbidden', errors: [{ message: 'Forbidden', domain: 'global', reason: 'forbidden' }] } });
      }
      if (metrics.includes('videoThumbnailImpressions') && opts.noReach) return res(400, { error: { code: 400, message: 'The query is not supported. Check the documentation for supported queries.', errors: [{ reason: 'badRequest' }] } });
      if (dims.includes('creatorContentType') && opts.noContentType) return res(400, { error: { code: 400, message: 'Unknown identifier (creatorContentType) given in field parameters.dimensions.', errors: [{ reason: 'badRequest' }] } });
      const rows = [];
      if (dims === 'day' && filters.startsWith('video==')) {
        const v = ch.videos.find((x) => x.id === filters.slice(7));
        for (let d = start; d <= end; d = addDays(d, 1)) {
          if (!v || d < day(v.published)) continue;
          const views = ch.viewsOn(v, d);
          const dur = v.type === 'short' ? ch.spec.shortDur : ch.spec.longDur;
          const pct = v.type === 'short' ? ch.spec.shortPct : ch.spec.longPct;
          const r = { views, engaged: Math.round(views * 0.9), minutes: Math.round(views * dur * pct / 100 / 60), avg_pct: pct, subs_gained: Math.round(views * 0.003), subs_lost: 0, likes: Math.round(views * 0.035), comments: Math.round(views * 0.004), shares: Math.round(views * 0.005) };
          rows.push([d, ...metrics.map((m) => metricOf(r, m))]);
        }
        return res(200, { columnHeaders: HEAD(['day'], metrics), rows });
      }
      if (dims === 'day') {
        for (let d = start; d <= end; d = addDays(d, 1)) { const r = ch.dayRow(d); if (r) rows.push([d, ...metrics.map((m) => metricOf(r, m))]); }
        return res(200, { columnHeaders: HEAD(['day'], metrics), rows });
      }
      if (dims === 'day,creatorContentType') {
        for (let d = start; d <= end; d = addDays(d, 1)) {
          const r = ch.dayRow(d);
          if (!r) continue;
          if (r.short) rows.push([d, 'SHORTS', r.short, Math.round(r.shortMin)]);
          if (r.long) rows.push([d, 'VIDEO_ON_DEMAND', r.long, Math.round(r.longMin)]);
        }
        return res(200, { columnHeaders: HEAD(['day', 'creatorContentType'], metrics), rows });
      }
      const b = breakdown(ch, dims, q, start, end);
      return res(200, { columnHeaders: b.headers, rows: b.rows });
    }
    return res(404, { error: { code: 404, message: 'unexpected ' + url } });
  };
  return { fetch, calls };
}

/** Token files for simulated channels, as finishConnect would write them (refresh token rt-<id>). */
export function tokenFor(ch, { connectedAt, monetary = true } = {}) {
  return {
    refresh_token: 'rt-' + ch.spec.id, access_token: null, expires_at: 0, connected_at: connectedAt,
    scope: ['https://www.googleapis.com/auth/yt-analytics.readonly', 'https://www.googleapis.com/auth/youtube.readonly'].concat(monetary ? ['https://www.googleapis.com/auth/yt-analytics-monetary.readonly'] : []).join(' '),
    channel: { channel_id: ch.spec.id, title: ch.spec.title, handle: ch.spec.handle, account: 'yt/' + ch.spec.handle.toLowerCase(), subscribers: ch.subsTotal(), created: ch.created, uploads: 'UU' + ch.spec.id.slice(2), thumb: null }
  };
}

export { addDays, day };
