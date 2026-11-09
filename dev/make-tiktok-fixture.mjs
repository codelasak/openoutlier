// Generates fake TikTok data shaped like what tiktok.com's web app loads, used
// by tests/tiktok.test.js, the MCP test and the demo pages. All accounts,
// numbers and links are made up.
//   node dev/make-tiktok-fixture.mjs
//
// dev/tiktok/item_list.json  two pages of /api/post/item_list/ for @excel.bugs.demo
//                            (an "Excel Bug" series, 2 pinned, 1 photo post, an ad from someone else)
// dev/tiktok/video.html      a video page with the __UNIVERSAL_DATA_FOR_REHYDRATION__ SSR blob
// dev/tiktok/sigi.json       the older SIGI_STATE shape (ItemModule + UserModule)
// dev/tiktok/ig-twin.json    normalized Instagram records of the same series (same videos posted
//                            to Instagram 0–2 days apart, slightly different captions) + IG-only reels
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'tiktok');
mkdirSync(out, { recursive: true });

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(7);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

const USER = 'excel.bugs.demo';
const NICK = 'Excel Bugs (demo)';
const AUTHOR = { id: '6912345678901234567', uniqueId: USER, nickname: NICK, avatarThumb: 'https://p16-sign-va.tiktokcdn.com/tos-maliva-avt-0068/demo~c5_100x100.jpeg?x-expires=1893456000&x-signature=demo', verified: false, secUid: 'MS4wLjABAAAAdemo' };

// [TikTok hook, Instagram hook, hashtags]
const TOPICS = [
  ['DÜŞEYARA neden #YOK veriyor? Çözümü videoda', 'DÜŞEYARA #YOK hatası mı veriyor? Çözüm burada', ['excel', 'exceltips', 'düşeyara']],
  ['Tarihler sayıya dönüşüyor, işte sebebi', 'Tarihlerin sayıya dönüşmesinin sebebi', ['excel', 'exceltips', 'tarih']],
  ['TOPLA formülü 0 gösteriyor mu? Metin sayılara dikkat', 'TOPLA 0 mı gösteriyor? Metin olarak saklanan sayılar', ['excel', 'topla', 'excelhatası']],
  ['Pivot tablo yenilenmiyor: tek ayar', 'Pivot tablo yenilenmiyorsa bu ayarı aç', ['excel', 'pivottablo', 'exceltips']],
  ['Koşullu biçimlendirme yanlış satırı boyuyor', 'Koşullu biçimlendirme neden yanlış satırı boyuyor', ['excel', 'koşullubiçimlendirme']],
  ['XLOOKUP ile DÜŞEYARA farkı 30 saniyede', 'XLOOKUP vs DÜŞEYARA: 30 saniyede fark', ['excel', 'xlookup', 'düşeyara']],
  ['Birleştirilmiş hücreler sıralamayı bozuyor', 'Birleştirilmiş hücreler sıralamayı neden bozar', ['excel', 'exceltips', 'sıralama']],
  ['Yuvarlama hatası: 0,1+0,2 neden 0,3 değil', 'Excel yuvarlama hatası 0,1+0,2', ['excel', 'yuvarla', 'excelhatası']],
  ['Filtre sonrası toplam yanlış çıkıyor', 'Filtreden sonra toplam neden yanlış', ['excel', 'altoplam', 'exceltips']],
  ['Dinamik dizi #TAŞMA hatası nasıl çözülür', '#TAŞMA hatası nasıl düzelir', ['excel', 'taşma', 'excelhatası']]
];
const SONGS = [['Coffee Break', 'Lo-Fi Desk'], ['Spreadsheet Groove', 'Cell Block'], ['Monday Again', 'Office Beats']];

const now = Date.UTC(2026, 10, 8, 17);
const N = 40;
const tt = [];
const ig = [];
for (let k = N; k >= 1; k--) {
  const topic = TOPICS[k % TOPICS.length];
  const daysAgo = (N - k) * 3.1 + rnd() * 0.8;
  const d = new Date(now - daysAgo * 864e5);
  const hour = rnd() < 0.65 ? 18 + Math.floor(rnd() * 4) : 9 + Math.floor(rnd() * 6);
  d.setUTCHours(hour, Math.floor(rnd() * 60));
  const created = Math.floor(d.getTime() / 1000);
  const quality = Math.exp((rnd() - 0.5) * 1.4) * (rnd() < 0.1 ? 4 + rnd() * 5 : 1); // shared by both platforms
  const views = Math.round(18000 * quality * (hour >= 18 ? 1.25 : 0.9) * (0.7 + rnd() * 0.6));
  const likes = Math.round(views * (0.04 + rnd() * 0.05));
  const comments = Math.round(likes * (0.02 + rnd() * 0.05));
  const shares = Math.round(likes * (0.05 + rnd() * 0.25));
  const saves = Math.round(likes * (0.15 + rnd() * 0.5)); // tutorials get saved a lot
  const duration = Math.round(18 + rnd() * 50);
  const id = (7300000000000000000n + BigInt(k) * 1000003n + BigInt(Math.floor(rnd() * 999))).toString();
  const tags = Array.from(new Set(['excelbug', ...topic[2], rnd() < 0.4 ? 'öğren' : 'fyp']));
  const desc = `Excel Bug #${k}: ${topic[0]} 🤯 ` + tags.map((t) => '#' + t).join(' ');
  const original = rnd() < 0.7;
  const song = pick(SONGS);
  const photo = k === 5;
  let off = 0;
  const textExtra = [];
  tags.forEach((t) => { const start = desc.indexOf('#' + t, off); off = start + 1; textExtra.push({ hashtagName: t, hashtagId: String(1e6 + t.length), type: 1, start, end: start + t.length + 1, isCommerce: false }); });
  const exp = Math.floor(now / 1000) + 6 * 86400;
  const item = {
    id,
    desc,
    createTime: created,
    scheduleTime: 0,
    author: AUTHOR,
    music: original
      ? { id: String(7e18 + k), title: `original sound - ${USER}`, authorName: NICK, original: true, duration, playUrl: `https://sf16-ies-music-va.tiktokcdn.com/obj/demo-${k}.mp3` }
      : { id: String(6e18 + k), title: song[0], authorName: song[1], original: false, duration: 60, playUrl: `https://sf16-ies-music-va.tiktokcdn.com/obj/song-${k}.mp3` },
    // stats: numbers; statsV2: the same counters as strings (sometimes newer / larger).
    stats: { diggCount: likes, shareCount: shares, commentCount: comments, playCount: views, ...(k % 7 === 0 ? {} : { collectCount: saves }) },
    statsV2: { diggCount: String(likes), shareCount: String(shares), commentCount: String(comments), playCount: String(k % 6 === 0 ? views + 1234 : views), collectCount: String(saves), repostCount: '0' },
    textExtra,
    challenges: tags.slice(0, 2).map((t, i) => ({ id: String(2e6 + i), title: t })),
    isPinnedItem: k === N || k === N - 7,
    isAd: false,
    duetEnabled: true,
    stitchEnabled: true,
    privateItem: false,
    locationCreated: 'TR'
  };
  if (photo) {
    item.imagePost = {
      cover: { imageURL: { urlList: [`https://p16-sign-va.tiktokcdn.com/obj/photomode-cover-${k}.jpeg?x-expires=${exp}&x-signature=demo`] } },
      images: [1, 2, 3].map((n) => ({ imageURL: { urlList: [`https://p16-sign-va.tiktokcdn.com/obj/photomode-${k}-${n}.jpeg?x-expires=${exp}&x-signature=demo`] }, imageWidth: 1080, imageHeight: 1440 }))
    };
    item.video = { id: '', duration: 0, cover: '' };
  } else {
    item.video = {
      id,
      height: 1024,
      width: 576,
      duration,
      ratio: '540p',
      format: 'mp4',
      cover: `https://p16-sign-va.tiktokcdn.com/tos-maliva-p-0068/${id}~tplv-photomode-zoomcover:720:720.jpeg?x-expires=${exp}&x-signature=demo`,
      originCover: `https://p16-sign-va.tiktokcdn.com/obj/tos-maliva-p-0068/${id}.jpeg?x-expires=${exp}&x-signature=demo`,
      dynamicCover: `https://p16-sign-va.tiktokcdn.com/obj/tos-maliva-p-0068/${id}-dyn.image?x-expires=${exp}&x-signature=demo`,
      playAddr: `https://v16-webapp-prime.tiktok.com/video/tos/maliva/tos-maliva-ve-0068c799-us/${id}/?a=1988&bti=demo&ch=0&cr=3&dr=0&lr=all&cd=0%7C0%7C0%7C&cv=1&br=1200&bt=600&cs=0&ds=6&ft=demo&mime_type=video_mp4&qs=0&rc=demo&expire=${exp}&l=demo&ply_type=2&policy=2&signature=demo&tk=tt_chain_token`,
      downloadAddr: `https://v16-webapp-prime.tiktok.com/video/tos/maliva/tos-maliva-ve-0068c799-us/${id}/?a=1988&download=1&expire=${exp}&signature=demo`,
      bitrateInfo: [{ Bitrate: 1200000, QualityType: 2, GearName: 'normal_540_0', PlayAddr: { UrlList: [`https://v19-webapp-prime.tiktok.com/video/tos/${id}/hq/?expire=${exp}&signature=demo`], Width: 576, Height: 1024 } }]
    };
  }
  tt.push(item);

  // Same video on Instagram (episodes 1–36), 0–2 days later (sometimes a day earlier), caption reworded.
  if (k <= 36) {
    const shift = (pick([0, 0, 1, 1, 2, -1]) * 864e5) + Math.floor(rnd() * 5) * 3600e3;
    const igTags = Array.from(new Set(['excelbug', topic[2][0], 'handsonexcel', rnd() < 0.5 ? topic[2][1] : 'excelöğren']));
    const igViews = Math.round(views * (0.25 + rnd() * 0.5) * (k % 9 === 0 ? 3 : 1));
    const igLikes = Math.round(igViews * (0.03 + rnd() * 0.04));
    ig.push({
      code: 'IGbug' + String(k).padStart(2, '0') + 'x' + Math.floor(rnd() * 1e4).toString(36),
      pk: String(3500000000000000000n + BigInt(k)),
      url: `https://www.instagram.com/reel/IGbug${String(k).padStart(2, '0')}/`,
      owner: 'excel.bugs.demo',
      ownerName: 'Excel Bugs (demo)',
      type: 'reel',
      takenAt: created * 1000 + shift,
      views: igViews,
      likes: igLikes,
      comments: Math.round(igLikes * (0.03 + rnd() * 0.05)),
      shares: k % 4 === 0 ? Math.round(igLikes / 5) : null,
      saves: null,
      duration: Math.round((duration + (rnd() - 0.5) * 1.6) * 10) / 10,
      caption: `Excel Bug ${k} — ${topic[1]} 👇 ` + igTags.map((t) => '#' + t).join(' '),
      hashtags: igTags,
      audio: { kind: 'original', title: 'Original audio', artist: 'excel.bugs.demo' },
      pinned: false,
      thumb: null,
      files: [],
      seenAt: now
    });
  }
}
// Instagram-only reels (not on TikTok).
for (let j = 0; j < 4; j++) {
  ig.push({
    code: 'IGonly' + j, url: `https://www.instagram.com/reel/IGonly${j}/`, owner: 'excel.bugs.demo', type: 'reel',
    takenAt: now - (j * 9 + 2) * 864e5, views: 3000 + j * 900, likes: 120 + j * 10, comments: 4, shares: null, saves: null,
    duration: 12 + j, caption: ['Kurs indirimi son gün!', 'Soru-cevap: klavye kısayolları', 'Ofisten bir gün', 'Yeni şablon paketi çıktı'][j],
    hashtags: ['handsonexcel'], audio: { kind: 'music', title: 'Sunny Day', artist: 'Pop Band' }, pinned: false, thumb: null, files: [], seenAt: now
  });
}

// An ad from someone else in the feed: must be ignored.
const ad = JSON.parse(JSON.stringify(tt[3]));
ad.id = '7399999999999999999';
ad.author = { ...AUTHOR, id: '1', uniqueId: 'some.brand', nickname: 'Brand' };
ad.isAd = true;

const pages = [
  { statusCode: 0, status_code: 0, cursor: String(tt[24].createTime * 1000), hasMore: true, hasMorePrevious: false, itemList: tt.slice(0, 25), extra: { now: now, logid: 'demo' } },
  { statusCode: 0, status_code: 0, cursor: '0', hasMore: false, hasMorePrevious: true, itemList: tt.slice(25).concat([ad]), extra: { now: now, logid: 'demo' } }
];
writeFileSync(join(out, 'item_list.json'), JSON.stringify(pages));

// Video page SSR (current name: __UNIVERSAL_DATA_FOR_REHYDRATION__).
const detail = JSON.parse(JSON.stringify(tt[2]));
detail.stats.playCount += 5000; // the video page is newer than the list
const universal = {
  __DEFAULT_SCOPE__: {
    'webapp.app-context': { language: 'tr-TR', region: 'TR' },
    'webapp.user-detail': {
      userInfo: {
        user: { ...AUTHOR, signature: 'Her gün bir Excel hatası' },
        stats: { followerCount: 48200, followingCount: 12, heart: 2100000, heartCount: 2100000, videoCount: N, diggCount: 0 },
        statsV2: { followerCount: '48213', followingCount: '12', heart: '2100000', heartCount: '2100000', videoCount: String(N), diggCount: '0' }
      }
    },
    'webapp.video-detail': { itemInfo: { itemStruct: detail }, statusCode: 0 }
  }
};
const html = `<!doctype html><html><head><title>Excel Bug | TikTok</title>
<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(universal).replace(/</g, '\\u003c')}</script>
</head><body><div id="app"></div></body></html>
`;
writeFileSync(join(out, 'video.html'), html);

// Older SIGI_STATE shape: authors by uniqueId, items keyed by id, author as a string.
const sigi = { AppContext: { appContext: { language: 'en' } }, ItemModule: {}, UserModule: { users: { [USER]: AUTHOR }, stats: { [USER]: { followerCount: 48000, videoCount: N, heartCount: 2000000 } } } };
tt.slice(10, 14).forEach((it) => { sigi.ItemModule[it.id] = { ...JSON.parse(JSON.stringify(it)), author: USER }; });
writeFileSync(join(out, 'sigi.json'), JSON.stringify(sigi));

writeFileSync(join(out, 'ig-twin.json'), JSON.stringify(ig));
console.log(`wrote ${tt.length} TikTok items (+1 ad), ${ig.length} Instagram twin records to dev/tiktok/`);
