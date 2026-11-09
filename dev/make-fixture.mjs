// Generates dev/graphql/query.json: a fake response shaped like Instagram's
// clips connection (xdt_api__v1__clips__user__connection_v2), used by the unit
// tests and by dev/demo.html. All accounts and numbers are made up.
//   node dev/make-fixture.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(42);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

const TAGS = ['cooking', 'recipe', 'easyrecipes', 'foodie', 'dinnerideas', 'mealprep', 'healthyfood', 'pasta', 'dessert', 'quickmeals'];
const HOOKS = ['3 ingredients, 10 minutes', 'You have been making this wrong', 'The pasta trick nobody told you', 'Weeknight dinner in one pan', 'I tried the viral recipe so you don\'t have to', 'Meal prep for the whole week', 'Restaurant dessert at home', 'Stop buying this, make it'];
const SONGS = [['Golden Hour', 'Studio Band'], ['Late Night Drive', 'Neon Lake'], ['Sunday Morning', 'The Kitchen Trio']];
const COLORS = ['#e8d5b7', '#b7d3e8', '#d8b7e8', '#b7e8c4', '#e8b7b7', '#e8e1b7'];

const now = Date.UTC(2026, 10, 8, 12);
const edges = [];
for (let i = 0; i < 64; i++) {
  const daysAgo = i * 2.8 + rnd() * 1.5;
  const d = new Date(now - daysAgo * 864e5);
  // Bias posting toward evenings and give evening posts slightly more reach.
  const hour = rnd() < 0.6 ? 17 + Math.floor(rnd() * 5) : 7 + Math.floor(rnd() * 10);
  d.setUTCHours(hour, Math.floor(rnd() * 60));
  const base = Math.exp(Math.log(40000) + (rnd() - 0.5) * 1.6) * (hour >= 17 ? 1.35 : 0.9);
  const outlier = rnd() < 0.1 ? 3 + rnd() * 6 : 1;
  const views = Math.round(base * outlier);
  const likes = Math.round(views * (0.03 + rnd() * 0.05));
  const comments = Math.round(likes * (0.01 + rnd() * 0.04));
  const tags = Array.from(new Set([pick(TAGS), pick(TAGS), rnd() < 0.5 ? pick(TAGS) : null].filter(Boolean)));
  const music = rnd() < 0.45 ? pick(SONGS) : null;
  const code = 'DmO' + i.toString(36).padStart(3, '0') + 'aB' + Math.floor(rnd() * 1e6).toString(36);
  const color = COLORS[i % COLORS.length];
  const thumb = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="128"><rect width="96" height="128" fill="${color}"/><text x="48" y="72" font-family="sans-serif" font-size="28" text-anchor="middle" fill="#333">${i + 1}</text></svg>`);
  // Instagram moved the counter between fields over time; mix them like real data.
  const viewField = i % 3 === 0 ? { ig_play_count: views, play_count: null } : i % 3 === 1 ? { play_count: views } : { play_count: 0, ig_play_count: views };
  edges.push({
    node: {
      media: {
        pk: String(3500000000000000000 + i),
        id: String(3500000000000000000 + i) + '_123',
        code,
        taken_at: Math.floor(d.getTime() / 1000),
        media_type: 2,
        product_type: 'clips',
        ...viewField,
        like_count: likes,
        comment_count: comments,
        video_duration: Math.round((6 + rnd() * 110) * 10) / 10,
        caption: { text: `${pick(HOOKS)} ${tags.map((t) => '#' + t).join(' ')}` },
        user: { username: 'demo.kitchen', pk: '123' },
        image_versions2: { candidates: [{ url: thumb, width: 96, height: 128 }] },
        video_versions: [{ url: `https://scontent-demo.cdninstagram.com/v/t66/demo_${code}.mp4?oe=FFFFFFFF`, width: 720, height: 1280 }],
        clips_tab_pinned_user_ids: i === 40 ? ['123'] : [],
        clips_metadata: music
          ? { music_info: { music_asset_info: { title: music[0], display_artist: music[1] } } }
          : { original_sound_info: { original_audio_title: 'Original audio', ig_artist: { username: 'demo.kitchen' } } }
      }
    },
    cursor: 'c' + i
  });
}

const out = { data: { xdt_api__v1__clips__user__connection_v2: { edges, page_info: { has_next_page: false, end_cursor: null } } }, extensions: { is_final: true } };
mkdirSync(join(here, 'graphql'), { recursive: true });
writeFileSync(join(here, 'graphql', 'query.json'), JSON.stringify(out));

// A "slim" copy like the real profile grids send: some reels lack the date,
// caption and length (Reels tab), others lack views (posts grid). The demo page
// fills them in from media-info.json, which mimics /api/v1/media/{pk}/info/.
const info = {};
const slimEdges = edges.map((e, i) => {
  const full = e.node.media;
  info[full.pk] = { items: [full], num_results: 1, status: 'ok' };
  const m = { ...full };
  if (i % 3 === 0) { delete m.taken_at; delete m.caption; delete m.video_duration; delete m.clips_metadata; delete m.video_versions; }
  if (i % 3 === 1) { delete m.play_count; delete m.ig_play_count; }
  return { ...e, node: { media: m } };
});
writeFileSync(join(here, 'graphql', 'slim.json'), JSON.stringify({ data: { xdt_api__v1__clips__user__connection_v2: { edges: slimEdges } } }));
writeFileSync(join(here, 'media-info.json'), JSON.stringify(info));
console.log('wrote dev/graphql/query.json, dev/graphql/slim.json and dev/media-info.json with', edges.length, 'reels');
