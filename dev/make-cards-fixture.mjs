// Builds the phase 3 card fixtures in dev/youtube/cards/ (deterministic, anonymized):
//   search.json         /youtubei/v1/search: videoRenderer (older), lockupViewModel (newer), a Shorts
//                       shelf (shortsLockupViewModel) and a "/shorts/" videoRenderer
//   home.json           /youtubei/v1/browse FEwhat_to_watch: richItemRenderer → lockupViewModel with the
//                       channel avatar, a Shorts shelf, a mix (playlist lockup, must be skipped)
//   subscriptions.json  /youtubei/v1/browse FEsubscriptions: lockups + gridVideoRenderer (older)
//   next.json           /youtubei/v1/next: the watch sidebar (lockups without avatar + compactVideoRenderer)
//   channels.json       channels.list answers for the demo's "API key" (snippet + statistics)
//   library.json        two saved channels (the Library's median), rs:p:yt/… records
//   watch-*.html        watch page snippets for the yt_ad check: monetized, not monetized, music, consent
// Run: node dev/make-cards-fixture.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'youtube', 'cards');
mkdirSync(dir, { recursive: true });

const CH = {
  sheet: { id: 'UCsheetAcademy0000000000', handle: 'SheetAcademy', name: 'Sheet Academy', subs: 1_240_000, views: 98_100_000, videos: 623, since: '2013-03-14', country: 'US' },
  demo: { id: 'UCdemoExcelChannel000000', handle: 'ExcelDemo', name: 'Excel Demo', subs: 712_000, views: 61_200_000, videos: 776, since: '2016-09-02', country: 'TR' },
  friday: { id: 'UCformulaFriday000000000', handle: 'FormulaFriday', name: 'Formula Friday', subs: 18_300, views: 1_900_000, videos: 141, since: '2021-01-08', country: 'GB' },
  pivot: { id: 'UCpivotPointTV0000000000', handle: 'PivotPointTV', name: 'Pivot Point', subs: 3_400, views: 220_000, videos: 58, since: '2023-06-19', country: 'TR' },
  cell: { id: 'UCcellCraft0000000000000', handle: 'CellCraft', name: 'Cell Craft', subs: 655_000, views: 61_000_000, videos: 890, since: '2011-11-30', country: 'IN' }
};
for (const c of Object.values(CH)) if (c.id.length !== 24) throw new Error('bad id ' + c.id + ' ' + c.id.length);

let n = 0;
function id(prefix) { n++; return (prefix + 'x'.repeat(11)).slice(0, 11 - String(n).length) + n; }

function lockup(v, { avatar = true, ch } = {}) {
  const c = CH[v.ch];
  const rows = [];
  const chPart = { text: { content: c.name, commandRuns: avatar ? undefined : [{ startIndex: 0, length: c.name.length, onTap: { innertubeCommand: { browseEndpoint: { browseId: c.id, canonicalBaseUrl: '/@' + c.handle } } } }] } };
  rows.push({ metadataParts: [chPart] });
  rows.push({ metadataParts: [{ text: { content: v.short + ' views' }, accessibilityLabel: v.long + ' views' }, { text: { content: v.ago }, accessibilityLabel: v.ago }] });
  const o = {
    contentImage: { thumbnailViewModel: { image: { sources: [{ url: `https://i.ytimg.com/vi/${v.id}/hq720.jpg`, width: 720, height: 404 }] },
      overlays: [{ thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { text: v.len, badgeStyle: 'THUMBNAIL_OVERLAY_BADGE_STYLE_DEFAULT' } }] } }] } },
    metadata: { lockupMetadataViewModel: { title: { content: v.title }, metadata: { contentMetadataViewModel: { metadataRows: rows, delimiter: ' • ' } } } },
    contentId: v.id, contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
    rendererContext: { commandContext: { onTap: { innertubeCommand: { watchEndpoint: { videoId: v.id } } } } }
  };
  if (avatar) {
    o.metadata.lockupMetadataViewModel.image = { decoratedAvatarViewModel: { avatar: { avatarViewModel: { image: { sources: [{ url: 'https://yt3.ggpht.com/demo', width: 68 }] } } },
      rendererContext: { commandContext: { onTap: { innertubeCommand: { browseEndpoint: { browseId: c.id, canonicalBaseUrl: '/@' + c.handle } } } } } } };
  }
  return { lockupViewModel: o };
}
function videoRenderer(v, key = 'videoRenderer') {
  const c = CH[v.ch];
  const by = { runs: [{ text: c.name, navigationEndpoint: { browseEndpoint: { browseId: c.id, canonicalBaseUrl: '/@' + c.handle } } }] };
  const r = {
    videoId: v.id, title: { runs: [{ text: v.title }] }, lengthText: { simpleText: v.len },
    viewCountText: { simpleText: v.long + ' views' }, shortViewCountText: { simpleText: v.short + ' views' }, publishedTimeText: { simpleText: v.ago },
    navigationEndpoint: { commandMetadata: { webCommandMetadata: { url: v.shortUrl ? '/shorts/' + v.id : '/watch?v=' + v.id } } }
  };
  if (key === 'videoRenderer') r.ownerText = by; else if (key === 'gridVideoRenderer') r.shortBylineText = by; else r.longBylineText = by;
  return { [key]: r };
}
function shortsLockup(v) {
  return { shortsLockupViewModel: { entityId: 'shorts-shelf-item-' + v.id, accessibilityText: `${v.title}, ${v.long} views - play Short`,
    overlayMetadata: { primaryText: { content: v.title }, secondaryText: { content: v.short + ' views' } },
    onTap: { innertubeCommand: { reelWatchEndpoint: { videoId: v.id } } },
    thumbnailViewModel: { thumbnailViewModel: { image: { sources: [{ url: `https://i.ytimg.com/vi/${v.id}/oardefault.jpg`, width: 405 }] } } } } };
}

const V = (ch, title, short, long, agoText, len, extra = {}) => ({ id: id(extra.p || 'v'), ch, title, short, long, ago: agoText, len, ...extra });

// Search: "excel pivot table".
const search = [
  V('sheet', 'Pivot Tables in 10 minutes (complete beginner guide)', '2.4M', '2,412,903', '2 years ago', '10:14', { p: 'srch' }),
  V('pivot', 'I made a pivot table that updates itself', '186K', '186,442', '3 weeks ago', '7:48', { p: 'srch' }),
  V('demo', 'XLOOKUP + pivot: the 60-second dashboard', '63K', '63,118', '1 month ago', '9:52', { p: 'srch' }),
  V('friday', 'Pivot table tricks nobody shows you', '41K', '41,207', '5 days ago', '14:03', { p: 'srch' }),
  V('cell', 'Excel pivot table tutorial – 2026 edition', '880K', '880,310', '8 months ago', '22:41', { p: 'srch' }),
  V('friday', 'Slicers in 30 seconds', '9.1K', '9,104', '2 days ago', '0:31', { p: 'srch', shortUrl: true })
];
const searchNew = [
  V('pivot', 'GETPIVOTDATA is underrated', '12K', '12,044', '19 hours ago', '6:12', { p: 'srcL' }),
  V('sheet', 'Pivot charts that don\'t look like 2007', '322K', '322,910', '4 months ago', '11:20', { p: 'srcL' })
];
const searchShorts = [
  V('demo', 'Pivot in one click', '1.2M', '1,203,331', '', '', { p: 'srSh' }),
  V('pivot', 'Refresh all pivots', '44K', '44,019', '', '', { p: 'srSh' }),
  V('cell', 'Group dates fast', '310K', '310,420', '', '', { p: 'srSh' })
];
const searchJson = {
  contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: [
    videoRenderer(search[0]), videoRenderer(search[1]),
    { reelShelfRenderer: { title: { simpleText: 'Shorts' }, items: searchShorts.map(shortsLockup) } },
    videoRenderer(search[2]), lockup(searchNew[0]), videoRenderer(search[3]), videoRenderer(search[5]), lockup(searchNew[1]), videoRenderer(search[4])
  ] } }] } } } }
};

// Home.
const home = [
  V('sheet', 'The 5 Excel functions I use every single day', '1.1M', '1,104,882', '1 year ago', '12:09', { p: 'home' }),
  V('pivot', 'From messy CSV to dashboard in 8 minutes', '94K', '94,230', '6 days ago', '8:02', { p: 'home' }),
  V('demo', 'LET and LAMBDA explained with coffee', '27K', '27,418', '2 weeks ago', '13:37', { p: 'home' }),
  V('friday', 'Conditional formatting that actually helps', '6.8K', '6,812', '3 days ago', '5:44', { p: 'home' }),
  V('cell', 'Power Query: merge 50 files at once', '412K', '412,770', '7 months ago', '18:55', { p: 'home' }),
  V('demo', 'Dynamic arrays in 9 minutes', '48K', '48,061', '1 month ago', '9:01', { p: 'home' }),
  V('pivot', 'Stop using VLOOKUP (seriously)', '1.9K', '1,930', '9 hours ago', '4:20', { p: 'home' }),
  V('sheet', 'Excel keyboard shortcuts cheat sheet', '3.3M', '3,301,442', '3 years ago', '15:30', { p: 'home' }),
  V('friday', 'INDEX MATCH for people who hate INDEX MATCH', '22K', '22,515', '1 month ago', '11:11', { p: 'home' }),
  V('cell', 'The budget template I actually use', '75K', '75,064', '2 weeks ago', '21:48', { p: 'home' }),
  V('demo', 'Charts: the 3 that matter', '19K', '19,240', '4 days ago', '7:07', { p: 'home' }),
  V('pivot', 'Excel vs Sheets in 2026', '7.7K', '7,702', '2 days ago', '10:59', { p: 'home' })
];
const homeShorts = [
  V('sheet', 'Flash Fill magic', '2.7M', '2,701,950', '', '', { p: 'hmSh' }),
  V('friday', 'Freeze panes', '15K', '15,004', '', '', { p: 'hmSh' }),
  V('demo', 'Ctrl + T', '540K', '540,311', '', '', { p: 'hmSh' }),
  V('pivot', 'Sum with Alt =', '88K', '88,402', '', '', { p: 'hmSh' })
];
const mix = { lockupViewModel: { contentId: 'RDmixdemo0001', contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST', metadata: { lockupMetadataViewModel: { title: { content: 'Mix – Excel Demo' } } } } };
const rich = (x) => ({ richItemRenderer: { content: x } });
const homeJson = {
  contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { selected: true, content: { richGridRenderer: { contents: [
    ...home.slice(0, 4).map((v) => rich(lockup(v))), rich(mix), ...home.slice(4, 8).map((v) => rich(lockup(v))),
    { richSectionRenderer: { content: { richShelfRenderer: { title: { runs: [{ text: 'Shorts' }] }, contents: homeShorts.map((v) => rich(shortsLockup(v))) } } } },
    ...home.slice(8).map((v) => rich(lockup(v)))
  ] } } } }] } }
};

// Subscriptions.
const subs = [
  V('pivot', 'Live: building a KPI dashboard from scratch', '3.1K', '3,108', '5 hours ago', '58:12', { p: 'subs' }),
  V('demo', 'IFS vs SWITCH (which one wins?)', '8.4K', '8,402', '1 day ago', '6:33', { p: 'subs' }),
  V('friday', 'Data validation drop-downs, done right', '2.2K', '2,231', '2 days ago', '9:18', { p: 'subs' }),
  V('sheet', 'Excel just changed forever (Copilot test)', '211K', '211,004', '3 days ago', '16:40', { p: 'subs' }),
  V('cell', 'Gantt chart in Excel – free template', '31K', '31,770', '4 days ago', '12:05', { p: 'subs' }),
  V('demo', 'TEXTSPLIT in 4 real examples', '12K', '12,610', '6 days ago', '8:48', { p: 'subs' }),
  V('pivot', 'Why your SUMIFS returns 0', '900', '903', '1 week ago', '5:02', { p: 'subs' }),
  V('friday', 'Excel for accountants: the 10 must-knows', '14K', '14,288', '1 week ago', '19:30', { p: 'subs' })
];
const subsJson = {
  contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { selected: true, content: { richGridRenderer: { contents: [
    ...subs.slice(0, 6).map((v) => rich(lockup(v))), ...subs.slice(6).map((v) => rich(videoRenderer(v, 'gridVideoRenderer')))
  ] } } } }] } }
};

// Watch sidebar (/next).
const side = [
  V('demo', 'XLOOKUP with multiple criteria', '35K', '35,902', '3 weeks ago', '8:15', { p: 'side' }),
  V('sheet', 'Excel tables: the feature you skip', '640K', '640,118', '1 year ago', '9:44', { p: 'side' }),
  V('pivot', 'My Excel setup (2026)', '5.5K', '5,540', '4 days ago', '12:31', { p: 'side' }),
  V('cell', 'SUMPRODUCT finally explained', '1.2M', '1,203,770', '4 years ago', '17:02', { p: 'side' }),
  V('friday', 'Spill errors and how to fix them', '3.9K', '3,911', '1 week ago', '6:06', { p: 'side' }),
  V('demo', 'Excel in 100 seconds', '220K', '220,045', '6 months ago', '1:40', { p: 'side' }),
  V('sheet', 'Pivot table formatting pro tips', '98K', '98,331', '2 months ago', '10:10', { p: 'side' }),
  V('pivot', 'What-if analysis made simple', '1.1K', '1,104', '11 hours ago', '7:58', { p: 'side' })
];
const nextJson = {
  contents: { twoColumnWatchNextResults: { secondaryResults: { secondaryResults: { results: [
    ...side.slice(0, 6).map((v) => lockup(v, { avatar: false })), ...side.slice(6).map((v) => videoRenderer(v, 'compactVideoRenderer'))
  ] } } } }
};

// channels.list answers (the demo's API key).
const channelsJson = { items: Object.values(CH).map((c) => ({ id: c.id, snippet: { title: c.name, customUrl: '@' + c.handle.toLowerCase(), publishedAt: c.since + 'T10:00:00Z', country: c.country },
  statistics: { subscriberCount: String(c.subs), viewCount: String(c.views), videoCount: String(c.videos), hiddenSubscriberCount: false } })) };

// Two saved channels (median): Sheet Academy (long-form) and Pivot Point (long + Shorts).
const DAY = 864e5;
function libPosts(ch, list) {
  const posts = {};
  list.forEach(([views, days, type, dur], i) => {
    const code = (ch.slice(0, 4) + 'Lib' + String(i).padStart(4, '0')).slice(0, 11).padEnd(11, '0');
    posts[code] = { code, platform: 'youtube', owner: 'yt/' + CH[ch].handle.toLowerCase(), author: CH[ch].handle, ownerId: CH[ch].id, ownerName: CH[ch].name, type: type || 'video',
      views, viewsApprox: true, takenAtDaysAgo: days, dateApprox: true, duration: dur || 600, caption: 'Saved video ' + (i + 1), files: [] };
  });
  return posts;
}
const library = {
  'yt/sheetacademy': { platform: 'youtube', profile: { id: 'yt/sheetacademy', handle: 'SheetAcademy', channelId: CH.sheet.id, name: CH.sheet.name, subscribers: CH.sheet.subs, subscribersApprox: true, videos: CH.sheet.videos },
    posts: libPosts('sheet', [[410000, 30], [380000, 60], [520000, 90], [295000, 120], [610000, 150], [450000, 200], [350000, 260], [480000, 320], [3300000, 1100, 'video', 930], [2412903, 730, 'video', 614]]) },
  'yt/pivotpointtv': { platform: 'youtube', profile: { id: 'yt/pivotpointtv', handle: 'PivotPointTV', channelId: CH.pivot.id, name: CH.pivot.name, subscribers: CH.pivot.subs, subscribersApprox: true, videos: CH.pivot.videos },
    posts: libPosts('pivot', [[2100, 12], [3400, 20], [1800, 34], [2900, 41], [4100, 55], [2500, 70], [3700, 90], [1500, 120], [9000, 15, 'short', 40], [12000, 25, 'short', 35], [6000, 40, 'short', 50], [15000, 60, 'short', 30], [8000, 75, 'short', 45]]) }
};

// Watch page snippets for the yt_ad check (trimmed to what the detector reads).
const files = {
  'search.json': searchJson, 'home.json': homeJson, 'subscriptions.json': subsJson, 'next.json': nextJson, 'channels.json': channelsJson, 'library.json': library
};
for (const [f, j] of Object.entries(files)) writeFileSync(join(dir, f), JSON.stringify(j, null, 1) + '\n');
// The detector wants the exact NexLev marker ([{"key":"yt_ad","value":"): put yt_ad first in its params list.
writeFileSync(join(dir, 'watch-monetized.html'), `<!doctype html><html><body><script>var ytInitialPlayerResponse = {"responseContext":{"serviceTrackingParams":[{"service":"CSI","params":[{"key":"c","value":"WEB"}]},{"service":"GFEEDBACK","params":[{"key":"yt_ad","value":"1"},{"key":"logged_in","value":"0"}]}]},"playabilityStatus":{"status":"OK"},"videoDetails":{"videoId":"yTdemo00029","title":"demo"}};</script></body></html>\n`);
writeFileSync(join(dir, 'watch-not-monetized.html'), `<!doctype html><html><body><script>var ytInitialPlayerResponse = {"responseContext":{"serviceTrackingParams":[{"service":"CSI","params":[{"key":"c","value":"WEB"}]},{"service":"GFEEDBACK","params":[{"key":"logged_in","value":"0"}]}]},"playabilityStatus":{"status":"OK"},"videoDetails":{"videoId":"yTdemo00030","title":"demo"}};</script></body></html>\n`);
writeFileSync(join(dir, 'watch-music.html'), `<!doctype html><html><body><script>var ytInitialPlayerResponse = {"responseContext":{"serviceTrackingParams":[{"service":"GFEEDBACK","params":[{"key":"yt_ad","value":"1"}]}]},"playabilityStatus":{"status":"OK"},"videoDetails":{"videoId":"yTmusic0001","title":"song"}};</script><script>var ytInitialData = {"engagementPanels":[{"engagementPanelSectionListRenderer":{"content":{"structuredDescriptionContentRenderer":{"items":[{"horizontalCardListRenderer":{"header":{"richListHeaderRenderer":{"title":{"simpleText":"Music"},"style":"RICH_LIST_HEADER_STYLE_MUSIC"}}}}]}}}}]};</script></body></html>\n`);
writeFileSync(join(dir, 'watch-consent.html'), `<!doctype html><html><body><form action="https://consent.youtube.com/save" method="POST"><button>Accept all</button></form></body></html>\n`);
console.log('wrote', Object.keys(files).length + 4, 'files to', dir);
