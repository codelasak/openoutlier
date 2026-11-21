// OpenOutlier – phase 4 fixtures (dev/youtube/content/): YouTube's transcript panel in its two DOM
// shapes, the same transcript as json3 and srv1 captions, the comments of a watch page's /next
// responses in the entity format and the older renderer format, and video descriptions for the
// sponsor rules. Anonymized and made up; the structure follows what youtube.com serves.
//   node dev/make-content-fixture.mjs
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'youtube', 'content');
mkdirSync(OUT, { recursive: true });
const w = (name, data) => writeFileSync(join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 1) + '\n');

// ---- transcript -------------------------------------------------------------------------------
const LINES = [
  [0.4, 'If you still use VLOOKUP, this one\'s for you.'], [3.1, 'In the next minute you\'ll see why XLOOKUP is simply better.'],
  [6.8, 'Here\'s a price list: product codes on the left, prices on the right.'], [10.9, 'With VLOOKUP you count columns: lookup value, the whole table,'],
  [14.6, 'column number three, and FALSE for an exact match.'], [18.2, 'Insert a column and that three is wrong. Silently.'],
  [21.5, 'XLOOKUP takes three things: what you look for,'], [24.3, 'where to look, and what to return.'], [27.0, 'No column numbers, no FALSE at the end.'],
  [30.2, 'It looks to the left too, which VLOOKUP never could.'], [33.8, 'Not found? The fourth argument says what to show instead,'],
  [37.4, 'like "not in the list", instead of an ugly #N/A.'], [41.0, 'And it can return a whole row at once: price, stock and supplier.'],
  [45.6, 'One catch: XLOOKUP needs Excel 2021 or Microsoft 365.'], [49.2, 'On older versions, INDEX and MATCH do the same job.'],
  [53.0, 'Download the practice file from the link in the description'], [56.4, 'and try it on your own data.'], [59.1, 'Which lookup do you use? Tell me in the comments.']
];
const clock = (s) => { s = Math.floor(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const secsLabel = (s) => { s = Math.floor(s); return s < 60 ? `${s} seconds` : `${Math.floor(s / 60)} minute${s >= 120 ? 's' : ''}, ${s % 60} seconds`; };
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const oldSeg = ([t, text]) => `<ytd-transcript-segment-renderer class="style-scope ytd-transcript-segment-list-renderer" rounded-container="">
  <div class="segment style-scope ytd-transcript-segment-renderer" role="button" tabindex="0" aria-label="${secsLabel(t)} ${esc(text)}">
    <div class="segment-start-offset style-scope ytd-transcript-segment-renderer" tabindex="-1" aria-hidden="true">
      <div class="segment-timestamp style-scope ytd-transcript-segment-renderer">
        ${clock(t)}
      </div>
    </div>
    <dom-if class="style-scope ytd-transcript-segment-renderer"><template is="dom-if"></template></dom-if>
    <yt-formatted-string class="segment-text style-scope ytd-transcript-segment-renderer">${esc(text)}</yt-formatted-string>
  </div>
</ytd-transcript-segment-renderer>`;
w('transcript-panel.html', `<!-- YouTube's transcript panel, ytd-transcript-segment-renderer (2023–2025 layout) -->
<ytd-engagement-panel-section-list-renderer class="style-scope ytd-watch-flexy" target-id="engagement-panel-searchable-transcript" visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED">
<div id="header" class="style-scope ytd-engagement-panel-section-list-renderer"><ytd-engagement-panel-title-header-renderer class="style-scope ytd-engagement-panel-section-list-renderer">
  <div id="title-container"><h2 id="title-text"><yt-formatted-string id="title-text">Transcript</yt-formatted-string></h2></div>
  <div id="visibility-button"><ytd-button-renderer><yt-button-shape><button aria-label="Close transcript">×</button></yt-button-shape></ytd-button-renderer></div>
</ytd-engagement-panel-title-header-renderer></div>
<div id="content" class="style-scope ytd-engagement-panel-section-list-renderer"><ytd-transcript-renderer><div id="body"><ytd-transcript-search-panel-renderer><div id="body"><ytd-transcript-segment-list-renderer><div id="segments-container" class="style-scope ytd-transcript-segment-list-renderer">
<ytd-transcript-section-header-renderer class="style-scope ytd-transcript-segment-list-renderer"><div class="style-scope ytd-transcript-section-header-renderer" aria-label="Intro">Intro</div></ytd-transcript-section-header-renderer>
${LINES.map(oldSeg).join('\n')}
<ytd-transcript-segment-renderer class="style-scope ytd-transcript-segment-list-renderer"><div class="segment"><div class="segment-start-offset"><div class="segment-timestamp">0:59</div></div><yt-formatted-string class="segment-text"> </yt-formatted-string></div></ytd-transcript-segment-renderer>
</div></ytd-transcript-segment-list-renderer></div></ytd-transcript-search-panel-renderer></div></ytd-transcript-renderer></div>
</ytd-engagement-panel-section-list-renderer>
`);
const newSeg = ([t, text]) => `<transcript-segment-view-model class="ytwTranscriptSegmentViewModelHost" role="button" tabindex="0">
  <div class="ytwTranscriptSegmentViewModelTimestamp" aria-hidden="true">${clock(t)}</div>
  <div class="ytwTranscriptSegmentViewModelTimestampA11yLabel">${secsLabel(t)}</div>
  <span class="yt-core-attributed-string ytwTranscriptSegmentViewModelBody yt-core-attributed-string--white-space-pre-wrap" role="text">${esc(text)}</span>
</transcript-segment-view-model>`;
w('transcript-panel-new.html', `<!-- YouTube's transcript panel, transcript-segment-view-model (2026 layout) -->
<ytd-engagement-panel-section-list-renderer target-id="PAmodern_transcript_view" visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED">
<div id="header"><ytd-engagement-panel-title-header-renderer><div id="visibility-button"><button aria-label="Close transcript">×</button></div></ytd-engagement-panel-title-header-renderer></div>
<div id="content"><yt-section-list-renderer><div id="contents"><macro-markers-panel-item-view-model><div class="ytwTimelineChapterViewModelTitle">Intro</div></macro-markers-panel-item-view-model>
${LINES.map(newSeg).join('\n')}
</div></yt-section-list-renderer></div>
</ytd-engagement-panel-section-list-renderer>
`);
// json3 (auto captions roll: the same line twice at the start) and srv1 XML of the same lines.
w('captions.json3.json', {
  wireMagic: 'pb3', pens: [{}], wsWinStyles: [{}], wpWinPositions: [{}],
  events: [{ tStartMs: 0, dDurationMs: 61000, id: 1, wpWinPosId: 1, wsWinStyleId: 1 }].concat(LINES.flatMap(([t, text], i) => {
    const next = LINES[i + 1] ? LINES[i + 1][0] : t + 3;
    const words = text.split(' ');
    const ev = { tStartMs: Math.round(t * 1000), dDurationMs: Math.round((next - t) * 1000), wWinId: 1, segs: words.map((wd, j) => (j ? { utf8: ' ' + wd, tOffsetMs: j * 180 } : { utf8: wd })) };
    return i === 0 ? [ev, { tStartMs: Math.round(t * 1000) + 10, dDurationMs: 10, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] }] : [ev];
  }))
});
w('captions.xml', '<?xml version="1.0" encoding="utf-8" ?><transcript>' + LINES.map(([t, text], i) => {
  const next = LINES[i + 1] ? LINES[i + 1][0] : t + 3;
  return `<text start="${t}" dur="${(next - t).toFixed(2)}">${esc(text).replace(/'/g, '&amp;#39;')}</text>`;
}).join('') + '</transcript>\n');

// ---- comments ---------------------------------------------------------------------------------
const C = [
  ['UgxPin0001', '@ExcelDemo', 'UCdemoExcelChannel000000', 'Practice file is in the description. Which lookup should I cover next: FILTER or INDEX/MATCH?', '842', '31', '2 days ago', { pinned: true, creator: true }],
  ['UgxA000002', '@sheetwizard', 'UCa0000000000000000002aa', 'Finally someone explains why the column number breaks. Saved me hours, thank you!', '1.2K', '12', '2 days ago', { hearted: true }],
  ['UgxA000003', '@data_dan', 'UCa0000000000000000003aa', 'Does XLOOKUP work on Excel 2016? My company is stuck on it.', '311', '9', '2 days ago', {}],
  ['UgxA000004', '@mira.k', 'UCa0000000000000000004aa', 'How do I return two columns at once without spilling over my other data?', '96', '4', '1 day ago', {}],
  ['UgxA000005', '@ahmet_y', 'UCa0000000000000000005aa', 'Bu formül Mac\'te de çalışıyor mu? Türkçe Excel\'de adı ÇAPRAZARA sanırım.', '57', '2', '1 day ago', {}],
  ['UgxA000006', '@rant_guy', 'UCa0000000000000000006aa', 'VLOOKUP worked fine for 30 years, this is bullshit marketing for 365.', '14', '6', '1 day ago', {}],
  ['UgxA000007', '@lena_sheets', 'UCa0000000000000000007aa', 'The not-found argument alone is worth switching. No more IFERROR wrappers 🙌', '403', '0', '1 day ago', { hearted: true }],
  ['UgxA000008', '@quiet_analyst', 'UCa0000000000000000008aa', 'Could you do a video on XLOOKUP with multiple criteria?', '188', '3', '20 hours ago', {}],
  ['UgxA000009', '@kemal.t', 'UCa0000000000000000009aa', 'Harika anlatım, teşekkürler. Pivot tablo videosu da gelsin lütfen', '35', '0', '18 hours ago', {}],
  ['UgxA000010', '@trolly', 'UCa0000000000000000010aa', 'what a waste of time, f*ck this', '0', '1', '12 hours ago', {}],
  ['UgxA000011', '@pm_jules', 'UCa0000000000000000011aa', 'Your pacing is perfect. 60 seconds and I actually get it.', '77', '0', '10 hours ago', {}],
  ['UgxA000012', '@ozge.d', 'UCa0000000000000000012aa', 'Neden bende #SPILL! hatası veriyor? Yanında boş hücre var aslında', '22', '1', '6 hours ago', {}],
  ['UgxA000013', '@biz_ops', 'UCa0000000000000000013aa', 'Wish you showed the approximate match mode too, that\'s where VLOOKUP users get burned.', '41', '0', '3 hours ago', {}],
  ['UgxA000014', '@newbie_99', 'UCa0000000000000000014aa', 'is there a keyboard shortcut to insert the function faster', '8', '0', '1 hour ago', {}]
];
const REPLY = ['UgxA000003.9zReply0001', '@ExcelDemo', 'UCdemoExcelChannel000000', 'No: it needs Excel 2021 or 365. INDEX + MATCH does the same on 2016.', '120', '0', '2 days ago', { creator: true }];
function entity([id, author, ch, text, likes, replies, when, f], level) {
  return [
    { entityKey: 'ck-' + id, type: 'ENTITY_MUTATION_TYPE_REPLACE', payload: { commentEntityPayload: {
      key: 'ck-' + id, properties: { commentId: id, content: { content: text, styleRuns: [] }, publishedTime: when, replyLevel: level || 0, authorButtonA11y: author, toolbarStateKey: 'tk-' + id },
      author: { channelId: ch, displayName: author, avatarThumbnailUrl: 'https://yt3.ggpht.example/' + ch, isVerified: false, isCurrentUser: false, isCreator: !!f.creator },
      toolbar: { likeCountNotliked: likes === '0' ? '' : likes, likeCountLiked: likes, replyCount: replies === '0' ? '' : replies, likeCountA11y: likes + ' likes', creatorThumbnailUrl: f.hearted ? 'https://yt3.ggpht.example/creator' : '' }
    } } },
    { entityKey: 'tk-' + id, type: 'ENTITY_MUTATION_TYPE_REPLACE', payload: { engagementToolbarStateEntityPayload: { key: 'tk-' + id, likeState: 'TOOLBAR_LIKE_STATE_INDIFFERENT', heartState: f.hearted ? 'TOOLBAR_HEART_STATE_HEARTED' : 'TOOLBAR_HEART_STATE_UNHEARTED' } } }
  ];
}
w('next-comments.json', {
  responseContext: { serviceTrackingParams: [] },
  onResponseReceivedEndpoints: [
    { reloadContinuationItemsCommand: { targetId: 'comments-section', slot: 'RELOAD_CONTINUATION_SLOT_HEADER', continuationItems: [{ commentsHeaderRenderer: { countText: { runs: [{ text: '234' }, { text: ' Comments' }] }, commentsCount: { runs: [{ text: '234' }] } } }] } },
    { reloadContinuationItemsCommand: { targetId: 'comments-section', slot: 'RELOAD_CONTINUATION_SLOT_BODY', continuationItems: C.map((c) => ({
      commentThreadRenderer: { commentViewModel: { commentViewModel: { commentKey: 'ck-' + c[0], toolbarStateKey: 'tk-' + c[0], commentId: c[0], pinnedText: c[7].pinned ? 'Pinned by @ExcelDemo' : undefined } },
        replies: c[0] === 'UgxA000003' ? { commentRepliesRenderer: { contents: [{ commentViewModel: { commentKey: 'ck-' + REPLY[0], toolbarStateKey: 'tk-' + REPLY[0], commentId: REPLY[0] } }] } } : undefined, renderingPriority: c[7].pinned ? 'RENDERING_PRIORITY_LINKED_COMMENT' : 'RENDERING_PRIORITY_UNKNOWN' }
    })).concat([{ continuationItemRenderer: { trigger: 'CONTINUATION_TRIGGER_ON_ITEM_SHOWN', continuationEndpoint: { continuationCommand: { token: 'Eg0SC3lUZGVtbzAwMDI5' } } } }]) } }
  ],
  frameworkUpdates: { entityBatchUpdate: { mutations: C.flatMap((c) => entity(c)).concat(entity(REPLY, 1)), timestamp: { seconds: '1763700000' } } }
});
// The older shape (still served to some clients): commentThreadRenderer → commentRenderer, Turkish UI.
const OLD = [
  ['UgzOld0001', '@kanal_sahibi', 'Dosya açıklamada. Sıradaki video için ne istersiniz?', '1,2 B', 18, '3 gün önce', { pinned: true, creator: true }],
  ['UgzOld0002', '@ayse.k', 'Çok net anlattınız, elinize sağlık!', '245', 0, '2 gün önce', { hearted: true }],
  ['UgzOld0003', '@mert_e', 'Excel 2019 kullanıyorum, bu fonksiyon bende yok mu?', '88', 2, '1 gün önce (düzenlendi)', {}],
  ['UgzOld0003.9zRep001', '@kanal_sahibi', 'Yok maalesef, İNDİS + KAÇINCI kullanabilirsin.', '40', 0, '1 gün önce', { creator: true }]
];
w('next-comments-old.json', {
  onResponseReceivedEndpoints: [{ reloadContinuationItemsCommand: { continuationItems: [
    { commentsHeaderRenderer: { countText: { runs: [{ text: '1.204' }, { text: ' yorum' }] } } }
  ].concat(OLD.filter((c) => c[0].indexOf('.') === -1).map((c) => ({ commentThreadRenderer: { comment: { commentRenderer: {
    commentId: c[0], authorText: { simpleText: c[1] }, authorEndpoint: { browseEndpoint: { browseId: c[6].creator ? 'UCdemoExcelChannel000000' : 'UCb000000000000000000' + c[0].slice(-3) } },
    contentText: { runs: [{ text: c[2] }] }, publishedTimeText: { runs: [{ text: c[5] }] }, voteCount: { simpleText: c[3] }, replyCount: c[4] || undefined,
    authorIsChannelOwner: !!c[6].creator, pinnedCommentBadge: c[6].pinned ? { pinnedCommentBadgeRenderer: { label: { runs: [{ text: 'Sabitlendi' }] } } } : undefined,
    actionButtons: { commentActionButtonsRenderer: { creatorHeart: { creatorHeartRenderer: { isHearted: !!c[6].hearted } } } }
  } } } }))) } }, { appendContinuationItemsAction: { continuationItems: OLD.filter((c) => c[0].indexOf('.') !== -1).map((c) => ({ commentRenderer: {
    commentId: c[0], authorText: { simpleText: c[1] }, contentText: { runs: [{ text: c[2] }] }, publishedTimeText: { runs: [{ text: c[5] }] }, voteCount: { simpleText: c[3] }, authorIsChannelOwner: !!c[6].creator
  } })) } }]
});

// ---- descriptions for the sponsor rules: [text, expected brands (keys), expected codes] ----------------
w('descriptions.json', [
  { id: 'sp01', channel: 'Excel Demo', text: 'This video is sponsored by Skillshare. The first 1,000 people to use the link will get a free trial: https://skl.sh/exceldemo10?utm_source=youtube\n\n📂 Practice file: https://exceldemo.com/files/xlookup', brands: ['skillshare'], codes: [] },
  { id: 'sp02', channel: 'Excel Demo', text: 'Thanks to NordVPN for sponsoring today\'s video! Get 68% off + 4 extra months: https://nordvpn.com/exceldemo and use code EXCELDEMO at checkout.', brands: ['nordvpn'], codes: ['EXCELDEMO'] },
  { id: 'sp03', channel: 'Pivot Point', text: 'My gear (affiliate links, I earn a small commission):\nKeyboard https://amzn.to/3xKbD9q\nMonitor https://www.amazon.com/dp/B0C1234567?tag=pivotpoint-20\nMic https://geni.us/pp-mic', brands: ['amazon'], codes: [], disclosure: true, short: 1 },
  { id: 'sp04', channel: 'Cell Craft', text: 'Today\'s sponsor is Brilliant. Go to https://brilliant.org/CellCraft/ for 20% off an annual premium subscription.', brands: ['brilliant'], codes: [] },
  { id: 'sp05', channel: 'Formül Okulu', text: 'Bu video Kutools sponsorluğunda hazırlandı. %20 indirim için KUTOOLS20 kodunu kullan: https://www.kutools.com/?ref=formulokulu', brands: ['kutools'], codes: ['KUTOOLS20'] },
  { id: 'sp06', channel: 'Formül Okulu', text: 'Bu videonun sponsoru Hostinger. HOSTING10 kodu ile %10 indirim: https://www.hostinger.com.tr/formul', brands: ['hostinger'], codes: ['HOSTING10'] },
  { id: 'sp07', channel: 'Sheet Academy', text: 'Brought to you by the folks at Notion, the all-in-one workspace.\nTry it: https://ntn.so/sheetacademy', brands: ['notion'], codes: [] },
  { id: 'sp08', channel: 'Sheet Academy', text: 'Ablebits add-ins for Excel: https://www.ablebits.com/?utm_source=youtube&utm_campaign=sheetacademy', brands: ['ablebits'], codes: [] },
  // False positives: none of these promote anything.
  { id: 'fp01', channel: 'Excel Demo', text: 'This video is not sponsored. Follow me on Instagram https://instagram.com/exceldemo?utm_source=ig and join the Discord https://discord.gg/abc123', brands: [], codes: [] },
  { id: 'fp02', channel: 'Excel Demo', text: 'In this video I use code to automate Excel with VBA. Use code below to copy it. Press CTRL+T to make a table. 50% of people get this wrong.', brands: [], codes: [] },
  { id: 'fp03', channel: 'Pivot Point', text: 'Chapters:\n0:00 Intro\n1:20 Sponsored rows in a pivot table (a dataset example)\n4:10 Microsoft docs: https://support.microsoft.com/en-us/office/xlookup', brands: [], codes: [] },
  { id: 'fp04', channel: 'Cell Craft', text: 'Free template: https://cellcraft.io/templates?utm_source=youtube\nSupport the channel on Patreon https://www.patreon.com/cellcraft', brands: [], codes: [], own: true },
  { id: 'fp05', channel: 'Formül Okulu', text: 'Bu video sponsorlu değil. Kodlar açıklamada: =ÇAPRAZARA(A2;B:B;C:C)', brands: [], codes: [] }
]);
// ---- the Niş Takibi sponsor list (the demo niche's channels, src/sponsors.js over made-up descriptions) ----
const SP = createRequire(import.meta.url)('../src/sponsors.js');
const page = JSON.parse(readFileSync(join(OUT, '..', 'niche', 'page.json'), 'utf8'));
const chans = page.channels.filter((c) => !c.mine);
const TEMPL = [
  (c) => `This video is sponsored by Skillshare. The first 500 people get a free month: https://skl.sh/${c.toLowerCase().replace(/\W/g, '')}?utm_source=youtube`,
  (c) => `📂 Practice file in the description.\nMy setup (affiliate links, I earn a small commission): https://amzn.to/3x${c.length}Kb https://www.amazon.com/dp/B0C${c.length}?tag=${c.toLowerCase().replace(/\W/g, '')}-20`,
  (c) => `Thanks to Kutools for sponsoring! Use code ${c.replace(/\W/g, '').toUpperCase().slice(0, 8)}20 for 20% off: https://www.kutools.com/?ref=${c.toLowerCase().replace(/\W/g, '')}`,
  (c) => 'Today\'s sponsor is Brilliant. Go to https://brilliant.org/' + c.replace(/\W/g, '') + '/ for 20% off an annual premium subscription.',
  () => 'Get the template: https://bit.ly/3xLkup9 · Office 365 deal: https://bit.ly/365deal',
  (c) => `In partnership with Microsoft. Copilot in Excel: https://aka.ms/copilot-excel?utm_source=${c.toLowerCase().replace(/\W/g, '')}&utm_medium=youtube`,
  () => 'Ablebits add-ins: https://www.ablebits.com/?utm_source=youtube&utm_campaign=lookup',
  () => 'Chapters\n0:00 Intro\n1:12 The formula\n5:40 Common errors',
  (c) => `Thanks to NordVPN for sponsoring today's video! Get 68% off: https://nordvpn.com/${c.toLowerCase().replace(/\W/g, '')} and use code EXCEL`
];
const vids = [];
chans.forEach((c, ci) => {
  for (let k = 0; k < 2 + (ci % 5); k++) {
    const t = TEMPL[(ci * 7 + k * 3 + (ci % 3)) % TEMPL.length];
    vids.push({ id: 'yTsim' + ci + 'x' + k, channel_id: c.channel_id, channel: c.name, title: 'video ' + k, published_at: page.now - (ci * 5 + k * 23 + 2) * 864e5, description: t(c.name) });
  }
});
const agg = SP.aggregate(vids);
w('niche-sponsors.json', {
  scope: { niche: page.niche }, days: 365, scanned: agg.scanned, channels_scanned: chans.length, short_links: agg.short_links,
  brands: agg.brands.slice(0, 30).map((b) => ({ ...b, first_at: new Date(b.first_at).toISOString().slice(0, 10), last_at: new Date(b.last_at).toISOString().slice(0, 10) })),
  channels: agg.channels, rules: 'Rule-based (src/sponsors.js)'
});
console.log('wrote', OUT);
