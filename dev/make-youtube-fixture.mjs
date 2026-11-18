// Trims and anonymizes real youtube.com captures into small fixtures under dev/youtube/,
// used by tests/youtube.test.js and the demo pages. Unlike the TikTok/Reddit generators the
// shapes here are real (YouTube changes them often, so made-up JSON would test nothing);
// only the identity is replaced: channel name/handle/UC id, video ids, titles, descriptions,
// avatar/banner/stream URLs and every opaque token (continuations, params, visitorData,
// entity keys). View/like/comment counts, dates, lengths, chapters and the heatmap are kept.
//   node dev/make-youtube-fixture.mjs <raw-dir> [suffix]
// With a suffix (e.g. "tr" for a capture made with hl=tr&gl=TR) files are written as
// channel-videos.tr.html etc., for testing localized number/date labels.
//
// <raw-dir> holds one capture session (logged out, hl=en, gl=US, SOCS consent cookie):
//   channel-videos.html   /@name/videos page (var ytInitialData)
//   channel-shorts.html   /@name/shorts page
//   channel-streams.html  /@name/streams page
//   browse-videos.json    in-app POST /youtubei/v1/browse continuation while scrolling Videos
//   browse-shorts.json    the same on the Shorts tab
//   watch.html            /watch?v= page, 50K+ views (ytInitialPlayerResponse + ytInitialData)
//   get_watch.json        in-app POST /youtubei/v1/get_watch (clicking a video in the SPA)
//   player.json           POST /youtubei/v1/player for the same video
//   next.json             POST /youtubei/v1/next for the same video
//   short.html            /shorts/<id> page
//   player-short.json     in-app /youtubei/v1/player when opening a Short
//   reel-item-watch.json  in-app /youtubei/v1/reel/reel_item_watch
//   reel-watch-sequence.json  in-app /youtubei/v1/reel/reel_watch_sequence
// Any file may be missing; it is then skipped. The script refuses to write if a real
// identifier survives (see LEAK checks at the bottom).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const raw = process.argv[2];
const suffix = process.argv[3] ? '.' + process.argv[3].replace(/[^a-z-]/gi, '') : '';
if (!raw || !existsSync(raw)) {
  console.error('usage: node dev/make-youtube-fixture.mjs <raw-dir> [suffix]');
  process.exit(1);
}
const out = join(here, 'youtube');
mkdirSync(out, { recursive: true });

const DEMO = { handle: 'ExcelDemo', name: 'Excel Demo', channelId: 'UC' + 'demoExcelChannel'.padEnd(22, '0'), site: 'example.com' };

// ---------- reading ----------
const rawText = {};
const readRaw = (f) => (existsSync(join(raw, f)) ? (rawText[f] = readFileSync(join(raw, f), 'utf8')) : null);

// `var <name> = {...};` inside the page HTML; brace matching that respects strings.
function fromHtml(html, name) {
  const at = html.indexOf('var ' + name + ' = {');
  if (at < 0) return null;
  const start = html.indexOf('{', at);
  let depth = 0, inStr = false, esc = false;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(html.slice(start, j + 1));
  }
  return null;
}
const json = (f) => { const t = readRaw(f); return t ? JSON.parse(t) : null; };
const page = (f) => { const t = readRaw(f); return t ? { data: fromHtml(t, 'ytInitialData'), player: fromHtml(t, 'ytInitialPlayerResponse') } : null; };

// ---------- the real identity, collected from everything ----------
const allRaw = () => Object.values(rawText).join('\n');
function realChannel() {
  for (const f of ['channel-videos.html', 'channel-shorts.html', 'watch.html']) {
    const t = rawText[f];
    if (!t) continue;
    const d = fromHtml(t, 'ytInitialData');
    const m = d && d.metadata && d.metadata.channelMetadataRenderer;
    if (m) return { id: m.externalId, name: m.title, handle: (m.vanityChannelUrl || '').split('/@')[1] || '' };
  }
  const p = fromHtml(rawText['watch.html'] || '', 'ytInitialPlayerResponse');
  const mf = p && p.microformat && p.microformat.playerMicroformatRenderer;
  return { id: mf.externalChannelId, name: mf.ownerChannelName, handle: (mf.ownerProfileUrl || '').split('/@')[1] || '' };
}

// ---------- generic helpers ----------
const hash = (s, n = 12) => createHash('sha1').update(s).digest('base64url').slice(0, n);
const isEnum = (s) => /^[A-Z0-9_]+$/.test(s);
const looksOpaque = (s) => s.length >= 40 && /^[A-Za-z0-9_\-%=]+$/.test(s) && !isEnum(s);
const TOKEN_KEY = /^(token|continuation|ctoken|params|playerParams|sequenceParams|visitorData|contextParams|entityKey|key|signature|sp|itct|serializedShareEntity|.*EntityKey|.*Key|.*Params|.*Token)$/;

// Keys dropped everywhere: tracking, ads, playback, styling and UI chrome no parser needs.
const DROP = new Set([
  'trackingParams', 'clickTrackingParams', 'loggingDirectives', 'loggingContext', 'themedPalette',
  'availableCountryCodes', 'availableCountries', 'channelConversionUrl', 'androidDeepLink', 'androidAppindexingLink', 'iosAppindexingLink',
  'streamingData', 'playbackTracking', 'playerConfig', 'storyboards', 'adPlacements', 'playerAds', 'adSlots', 'attestation',
  'annotations', 'cards', 'endscreen', 'messages', 'adBreakHeartbeatParams', 'heartbeatParams', 'playerSettingsMenuData',
  'topbar', 'desktopTopbar', 'tooltip', 'background', 'pageVisualEffects', 'onResponseReceivedEndpoints',
  'sheetViewModel', 'menu', 'menuButton', 'menuOnTap', 'menuOnTapA11yLabel', 'ustreamerConfig', 'watchEndpointSupportedOnesieConfig',
  'lottieData', 'styleRunExtensions', 'animatedThumbnailOverlayViewModel', 'thumbnailHoverOverlayToggleActionsViewModel',
  'subscribeButton', 'subscribeButtonViewModel', 'subscribeStateEntityStoreKey', 'sponsorStateEntity', 'showMoreCommand', 'showLessCommand',
  'actions', 'banner', 'attribution', 'translationLanguages', 'defaultAudioTrackIndex', 'embed', 'frameworkUpdates',
  'secondaryResults', 'autoplay', 'scrubber', 'nextItemButton', 'prevItemButton', 'prevEntries', 'prevContinuationEndpoint',
  'flexibleItems', 'shareButton', 'addToMenu', 'fullscreenQuickActionsBar', 'stackedFrameData'
]);
// Commands are kept only when they carry something a parser reads (ids, urls, continuations).
const COMMAND_KEYS = new Set(['onTap', 'command', 'navigationEndpoint', 'serviceEndpoint', 'innertubeCommand', 'onActive', 'onActiveCommand', 'onClickCommand', 'onLongPress', 'commandContext', 'commandRuns']);
const USEFUL_COMMAND = /"(reelWatchEndpoint|watchEndpoint|browseEndpoint|continuationCommand)"/;

function scrubUrl(u) {
  if (/googlevideo\.com|googlesyndication|doubleclick|googleadservices|\/pagead\/|\/measurement\//.test(u)) return 'https://www.example.com/demo-removed';
  const yt3 = u.match(/^(https?:)?\/\/yt3\.(?:googleusercontent|ggpht)\.com\/[^=]*(=[^?]*)?/);
  if (yt3) return 'https://yt3.ggpht.com/demo-avatar' + (yt3[2] || '');
  if (/i\d?\.ytimg\.com/.test(u)) return u.split('?')[0];
  if (/\/api\/timedtext/.test(u)) {
    const q = new URL(u, 'https://www.youtube.com').searchParams;
    const keep = new URLSearchParams();
    for (const k of ['v', 'lang', 'kind', 'name', 'fmt']) if (q.get(k) != null) keep.set(k, q.get(k));
    return 'https://www.youtube.com/api/timedtext?' + keep.toString();
  }
  if (/[?&](ip|ei|sig|lsig|signature|expire|continue|next)=/.test(u) || /accounts\.google\.com/.test(u)) return u.split('?')[0];
  return u;
}

// Descriptions: replaced by templates. kind = per-file default (video | short | channel).
const DESC = {
  video: 'Turn a repetitive Excel task into a one-click macro.\n\nIn this demo you record a macro, run it, and fix it with an AI assistant.\n\n0:00 Introduction\n0:17 Record Macro\n4:52 Run the Macro\n7:06 Fix issues with Chatgpt\n\n#excel #macros #vba',
  short: 'Jump between sheets with one click 👀\n\nDemo short for OpenOutlier tests.\n\n#excel #exceltips #shorts',
  channel: 'Demo channel for OpenOutlier tests: short Excel tutorials, formulas and dashboards.'
};
const descOriginals = new Map();
function descFor(kind, original) {
  const t = /\b\d{1,2}:\d{2}\b/.test(original || '') ? DESC.video : DESC[kind];
  if (original && original.length > 20) descOriginals.set(original, t);
  return t;
}
function replaceDescription(v, kind) {
  if (typeof v === 'string') return descFor(kind, v);
  if (v && typeof v === 'object') {
    if (typeof v.simpleText === 'string') return { simpleText: descFor(kind, v.simpleText) };
    if (typeof v.content === 'string') return { content: descFor(kind, v.content) };
    if (Array.isArray(v.runs)) return { runs: [{ text: descFor(kind, v.runs.map((r) => r.text).join('')) }] };
  }
  return v;
}
// description, shortDescription, attributedDescription, attributedDescriptionBodyText,
// colorSampledDescriptionBodyText, descriptionSnippet, ...
const isDescKey = (k) => /^(description|shortDescription|descriptionSnippet)$|Description(BodyText|Snippet)?$|DescriptionBodyText$/.test(k);

function clean(x, kind, key = '') {
  if (Array.isArray(x)) return x.map((v) => clean(v, kind, key)).filter((v) => v !== undefined);
  if (x && typeof x === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(x)) {
      if (DROP.has(k)) continue;
      if (COMMAND_KEYS.has(k) && !USEFUL_COMMAND.test(JSON.stringify(v))) continue;
      if (isDescKey(k) && (typeof v === 'string' || (v && (v.simpleText || v.content || v.runs)))) { o[k] = replaceDescription(v, kind); continue; }
      if (k === 'responseContext') { o[k] = {}; continue; }
      if (k === 'thumbnails' && Array.isArray(v)) { o[k] = clean(v.slice(-2), kind, k); continue; }
      if (k === 'sources' && Array.isArray(v)) { o[k] = clean(v.slice(0, 2), kind, k); continue; }
      const c = clean(v, kind, k);
      if (c !== undefined) o[k] = c;
    }
    return o;
  }
  if (typeof x === 'string') {
    if (x.includes('://') || x.startsWith('//')) return scrubUrl(x);
    if ((TOKEN_KEY.test(key) && x.length >= 16 && !isEnum(x) && !x.startsWith('/')) || looksOpaque(x)) return 'demo-' + hash(x);
    return x;
  }
  return x;
}

// ---------- structural trims ----------
const selectedTab = (d) => {
  const tabs = d.contents.twoColumnBrowseResultsRenderer.tabs;
  return tabs.find((t) => t.tabRenderer && t.tabRenderer.selected).tabRenderer;
};
// First n items, plus the watch-page video and the Short if they are further down, so tests
// can join a grid item to its watch page.
const alsoKeep = new Set();
function trimGridItems(items, n) {
  const videos = items.filter((it) => it.richItemRenderer);
  const cont = items.filter((it) => it.continuationItemRenderer);
  const extra = videos.slice(n).filter((it) => [...alsoKeep].some((id) => JSON.stringify(it).includes('"' + id + '"')));
  return videos.slice(0, n).concat(extra, cont);
}
function trimChannel(d, n) {
  const tab = selectedTab(d);
  const grid = tab.content.richGridRenderer;
  grid.contents = trimGridItems(grid.contents, n);
  // Non-selected tabs: keep title + url only.
  d.contents.twoColumnBrowseResultsRenderer.tabs = d.contents.twoColumnBrowseResultsRenderer.tabs.map((t) => {
    if (t.tabRenderer && !t.tabRenderer.selected) return { tabRenderer: { title: t.tabRenderer.title, endpoint: t.tabRenderer.endpoint } };
    if (t.expandableTabRenderer) return { expandableTabRenderer: { title: t.expandableTabRenderer.title } };
    return t;
  });
  delete d.microformat;
  return d;
}
function trimBrowse(b, n) {
  for (const a of b.onResponseReceivedActions || []) {
    const ap = a.appendContinuationItemsAction || a.reloadContinuationItemsCommand;
    if (ap && ap.continuationItems) ap.continuationItems = trimGridItems(ap.continuationItems, n);
  }
  return b;
}
function keepMutations(d) {
  // Only the heatmap and chapter-marker entities matter; everything else is client state.
  const m = d.frameworkUpdates && d.frameworkUpdates.entityBatchUpdate && d.frameworkUpdates.entityBatchUpdate.mutations;
  if (!m) return null;
  const keep = m.filter((x) => x.payload && x.payload.macroMarkersListEntity);
  for (const x of keep) for (const mk of x.payload.macroMarkersListEntity.markersList.markers || []) delete mk.onActive;
  return { entityBatchUpdate: { mutations: keep } };
}
function trimWatchData(d) {
  const fw = keepMutations(d);
  const r = d.contents.twoColumnWatchNextResults.results.results;
  r.contents = r.contents.filter((c) => c.videoPrimaryInfoRenderer || c.videoSecondaryInfoRenderer || (c.itemSectionRenderer && c.itemSectionRenderer.sectionIdentifier === 'comment-item-section'));
  for (const c of r.contents) {
    if (c.videoPrimaryInfoRenderer) {
      const v = c.videoPrimaryInfoRenderer;
      const top = v.videoActions && v.videoActions.menuRenderer && v.videoActions.menuRenderer.topLevelButtons;
      if (top) v.videoActions.menuRenderer = { topLevelButtons: top.filter((b) => b.segmentedLikeDislikeButtonViewModel) };
    }
  }
  const po = d.playerOverlays && d.playerOverlays.playerOverlayRenderer;
  if (po) d.playerOverlays = { playerOverlayRenderer: { decoratedPlayerBarRenderer: po.decoratedPlayerBarRenderer } };
  const KEEP_PANELS = /comments-section|structured-description|macro-markers-description-chapters|searchable-transcript/;
  d.engagementPanels = (d.engagementPanels || []).filter((p) => KEEP_PANELS.test(p.engagementPanelSectionListRenderer.panelIdentifier || ''));
  for (const p of d.engagementPanels) {
    const r2 = p.engagementPanelSectionListRenderer;
    if (/comments|transcript/.test(r2.panelIdentifier)) delete r2.content; // lazy-loaded; the header holds the comment count
    const sd = r2.content && r2.content.structuredDescriptionContentRenderer;
    if (sd) sd.items = sd.items.filter((i) => i.videoDescriptionHeaderRenderer || i.expandableVideoDescriptionBodyRenderer || i.horizontalCardListRenderer || i.videoDescriptionTranscriptSectionRenderer);
  }
  if (fw) d.frameworkUpdates = fw;
  return d;
}
function trimPlayer(p) {
  if (!p) return p;
  if (p.playabilityStatus) p.playabilityStatus = { status: p.playabilityStatus.status, reason: p.playabilityStatus.reason, playableInEmbed: p.playabilityStatus.playableInEmbed };
  const ct = p.captions && p.captions.playerCaptionsTracklistRenderer;
  if (ct) p.captions = { playerCaptionsTracklistRenderer: { captionTracks: ct.captionTracks, audioTracks: ct.audioTracks } };
  return p;
}
function trimReelItem(r) {
  const vm = r.overlay && r.overlay.reelPlayerOverlayRenderer;
  if (vm) {
    const pv = vm.playerOverlay && vm.playerOverlay.reelPlayerOverlayViewModel;
    r.overlay = { reelPlayerOverlayRenderer: { style: vm.style, reelPlayerHeaderSupportedRenderers: vm.reelPlayerHeaderSupportedRenderers, playerOverlay: pv ? { reelPlayerOverlayViewModel: { metapanel: pv.metapanel, actionBar: pv.actionBar } } : undefined } };
  }
  r.engagementPanels = (r.engagementPanels || []).filter((p) => {
    const e = p.engagementPanelSectionListRenderer;
    return e && e.content && e.content.structuredDescriptionContentRenderer;
  });
  for (const p of r.engagementPanels) {
    const sd = p.engagementPanelSectionListRenderer.content.structuredDescriptionContentRenderer;
    sd.items = sd.items.filter((i) => i.videoDescriptionHeaderRenderer || i.expandableVideoDescriptionBodyRenderer);
  }
  const fw = keepMutations(r);
  if (fw) r.frameworkUpdates = fw;
  return r;
}
function trimSequence(s, n) {
  s.entries = (s.entries || []).slice(0, n);
  for (const e of s.entries) {
    const ep = e.command && e.command.reelWatchEndpoint;
    if (!ep) continue;
    delete ep.overlay;
    const u = ep.unserializedPrefetchData;
    if (u) {
      if (u.playerResponse) trimPlayer(u.playerResponse);
      if (u.reelItemWatchResponse) trimReelItem(u.reelItemWatchResponse);
    }
  }
  return s;
}

// frameworkUpdates is in DROP (it is mostly client state); cleanDeep() puts back only the
// macroMarkersListEntity mutations (heatmap + timestamp markers) wherever they sit.
function cleanFw(fw, kind) {
  DROP.delete('frameworkUpdates');
  const c = clean(fw, kind);
  DROP.add('frameworkUpdates');
  return c;
}
function cleanDeep(obj, kind) {
  // frameworkUpdates can sit at several depths (get_watch parts, prefetch data).
  if (Array.isArray(obj)) return obj.map((v) => cleanDeep(v, kind));
  if (!obj || typeof obj !== 'object') return clean(obj, kind);
  const fwSpots = [];
  (function find(x, path) {
    if (Array.isArray(x)) return x.forEach((v, i) => find(v, path.concat(i)));
    if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) {
      if (k === 'frameworkUpdates') {
        const kept = keepMutations({ frameworkUpdates: v });
        if (kept && kept.entityBatchUpdate.mutations.length) fwSpots.push({ path, fw: cleanFw(kept, kind) });
      }
      else find(v, path.concat(k));
    }
  })(obj, []);
  const c = clean(obj, kind);
  for (const { path, fw } of fwSpots) {
    let t = c;
    for (const k of path) { t = t && t[k]; }
    if (t && typeof t === 'object') t.frameworkUpdates = fw;
  }
  return c;
}

// ---------- build ----------
const outputs = {}; // name -> { kind: 'html'|'json', parts }
const chVideos = page('channel-videos.html');
const chShorts = page('channel-shorts.html');
const chStreams = page('channel-streams.html');
const watch = page('watch.html');
const short = page('short.html');
const browseVideos = json('browse-videos.json');
const browseShorts = json('browse-shorts.json');
const getWatch = json('get_watch.json');
const player = json('player.json');
const next = json('next.json');
const playerShort = json('player-short.json');
const reelItem = json('reel-item-watch.json');
const reelSeq = json('reel-watch-sequence.json');

const REAL = realChannel();
for (const p of [watch, short]) if (p && p.player && p.player.videoDetails) alsoKeep.add(p.player.videoDetails.videoId);

if (chVideos) outputs['channel-videos.html'] = { html: { ytInitialData: cleanDeep(trimChannel(chVideos.data, 6), 'channel') } };
if (chShorts) outputs['channel-shorts.html'] = { html: { ytInitialData: cleanDeep(trimChannel(chShorts.data, 6), 'channel') } };
if (chStreams) outputs['channel-streams.html'] = { html: { ytInitialData: cleanDeep(trimChannel(chStreams.data, 3), 'channel') } };
if (browseVideos) outputs['browse-videos.json'] = { json: cleanDeep(trimBrowse(browseVideos, 4), 'video') };
if (browseShorts) outputs['browse-shorts.json'] = { json: cleanDeep(trimBrowse(browseShorts, 4), 'short') };
if (watch) outputs['watch.html'] = { html: { ytInitialPlayerResponse: cleanDeep(trimPlayer(watch.player), 'video'), ytInitialData: cleanDeep(trimWatchData(watch.data), 'video') } };
if (getWatch) {
  const parts = getWatch.map((p) => {
    if (p.playerResponse) trimPlayer(p.playerResponse);
    if (p.watchNextResponse) trimWatchData(p.watchNextResponse);
    return p;
  });
  outputs['get_watch.json'] = { json: cleanDeep(parts, 'video') };
}
if (player) outputs['player.json'] = { json: cleanDeep(trimPlayer(player), 'video') };
if (next) outputs['next.json'] = { json: cleanDeep(trimWatchData(next), 'video') };
if (short) outputs['short.html'] = { html: { ytInitialPlayerResponse: cleanDeep(trimPlayer(short.player), 'short'), ytInitialData: cleanDeep(trimReelItem(short.data), 'short') } };
if (playerShort) outputs['player-short.json'] = { json: cleanDeep(trimPlayer(playerShort), 'short') };
if (reelItem) outputs['reel-item-watch.json'] = { json: cleanDeep(trimReelItem(reelItem), 'short') };
if (reelSeq) outputs['reel-watch-sequence.json'] = { json: cleanDeep(trimSequence(reelSeq, 3), 'short') };

// ---------- text-level identity replacement ----------
// Real video ids (any we saw anywhere) -> stable fake ids in first-seen order.
const ids = new Map();
const idRe = /"(?:videoId|contentId|externalVideoId|addedVideoId|removedVideoId|animationActivationTargetId)":"([\w-]{11})"|\/(?:vi|vi_webp|shorts|an_webp)\/([\w-]{11})\/?|[?&]v=([\w-]{11})|"\/watch\?v=([\w-]{11})/g;
for (const m of allRaw().matchAll(idRe)) {
  const id = m[1] || m[2] || m[3] || m[4];
  if (!ids.has(id)) ids.set(id, 'yTdemo' + String(ids.size + 1).padStart(5, '0'));
}
// Real titles -> made-up ones, keeping any trailing emoji so text helpers still see them.
const TOPICS = [
  'XLOOKUP vs VLOOKUP in 60 seconds', 'Pivot tables that refresh themselves', 'The hidden Excel button nobody uses',
  'Stop merging cells: do this instead', 'Dynamic dropdown lists made easy', 'Conditional formatting that tracks deadlines',
  'Build a dashboard from scratch', 'Fix #SPILL errors fast', 'Power Query for total beginners', 'Clean messy data in seconds',
  'Keyboard shortcuts that save hours', 'Checkbox to-do list in Excel', 'Progress bars with data validation', 'Excel calendar in one formula'
];
const titles = new Map();
const addTitle = (t) => {
  if (!t || t.length < 8 || titles.has(t)) return;
  const tail = (t.match(/[\s!?]*(?:\p{Extended_Pictographic}|️|‍|[!?])+[\s!?]*$/u) || [''])[0];
  titles.set(t, TOPICS[titles.size % TOPICS.length] + (titles.size >= TOPICS.length ? ' ' + (Math.floor(titles.size / TOPICS.length) + 1) : '') + tail);
};
(function collect(x) {
  if (Array.isArray(x)) return x.forEach(collect);
  if (!x || typeof x !== 'object') return;
  if (x.lockupMetadataViewModel && x.lockupMetadataViewModel.title) addTitle(x.lockupMetadataViewModel.title.content);
  if (x.overlayMetadata && x.overlayMetadata.primaryText) addTitle(x.overlayMetadata.primaryText.content);
  if (x.videoDetails && x.videoDetails.title) addTitle(x.videoDetails.title);
  if (x.videoPrimaryInfoRenderer && x.videoPrimaryInfoRenderer.title) addTitle((x.videoPrimaryInfoRenderer.title.runs || []).map((r) => r.text).join(''));
  if (x.shortsVideoTitleViewModel && x.shortsVideoTitleViewModel.text) addTitle(x.shortsVideoTitleViewModel.text.content);
  Object.values(x).forEach(collect);
})([chVideos, chShorts, chStreams, watch, short, browseVideos, browseShorts, getWatch, player, next, playerShort, reelItem, reelSeq].filter(Boolean));

const esc = (s) => JSON.stringify(s).slice(1, -1);
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function anonymizeText(t) {
  // Longest first so a title containing another title is replaced whole.
  for (const [real, fake] of [...titles].sort((a, b) => b[0].length - a[0].length)) t = t.split(esc(real)).join(esc(fake));
  for (const [real, fake] of [...descOriginals].sort((a, b) => b[0].length - a[0].length)) t = t.split(esc(real)).join(esc(fake));
  for (const [real, fake] of ids) t = t.replace(new RegExp('(?<![A-Za-z0-9_])' + reEsc(real) + '(?![\\w-])', 'g'), fake);
  t = t.split(REAL.id).join(DEMO.channelId);
  if (REAL.handle) t = t.replace(new RegExp(reEsc(REAL.handle), 'gi'), DEMO.handle);
  t = t.split(REAL.name).join(DEMO.name);
  // The display name's short form and the person behind it ("Excel Campus - Jon" -> "Excel Campus", "Jon").
  for (const part of REAL.name.split(/\s+[-|–]\s+/)) if (part.length >= 3) t = t.replace(new RegExp('\\b' + reEsc(part) + '\\b', 'gi'), part === REAL.name.split(/\s+[-|–]\s+/)[0] ? DEMO.name : 'Demo Host');
  // The creator's own links (site, courses) that survive outside descriptions.
  t = t.replace(/\b(?:[\w-]+\.)+(?:com|net|org|io|co)\b(?:\/[\w\-./?=&%]*)?/g, (m) => (/(^|\.)(youtube|ytimg|ggpht|googleusercontent|google|gstatic|youtu|example)\.(com|be)\b/.test(m) ? m : DEMO.site + '/demo'));
  return t;
}

// ---------- write ----------
const LEAKS = [REAL.id, REAL.name, REAL.handle, ...ids.keys(), ...[...titles.keys()].filter((t) => t.length > 15)].filter(Boolean);
const report = [];
for (const [name, o] of Object.entries(outputs)) {
  let text;
  if (o.json !== undefined) text = anonymizeText(JSON.stringify(o.json));
  else {
    const scripts = Object.entries(o.html).filter(([, v]) => v).map(([k, v]) => {
      const body = anonymizeText(JSON.stringify(v)).replace(/</g, '\\u003c');
      return k === 'ytInitialPlayerResponse'
        ? `<script nonce="demo">var ytInitialPlayerResponse = ${body};var meta = document.createElement('meta'); meta.name = 'referrer'; meta.content = 'origin-when-cross-origin'; document.getElementsByTagName('head')[0].appendChild(meta);</script>`
        : `<script nonce="demo">var ${k} = ${body};</script><script nonce="demo">if (window.ytcsi) {window.ytcsi.tick('pdr', null, '');}</script>`;
    });
    text = `<!DOCTYPE html><html lang="en"><head><title>${DEMO.name} - YouTube</title></head><body dir="ltr">\n${scripts.join('\n')}\n</body></html>\n`;
  }
  const lower = text.toLowerCase();
  const leak = LEAKS.find((s) => lower.includes(s.toLowerCase())) || (/googlevideo\.com\/videoplayback\?|[?&]ip=/.test(text) && 'stream url');
  const opaque = text.match(/"([A-Za-z0-9_\-%=]{40,})"/);
  if (leak || (opaque && !isEnum(opaque[1]))) {
    const at = text.toLowerCase().indexOf(String(leak).toLowerCase());
    console.error(`LEAK in ${name}: ${leak || opaque[1].slice(0, 40)}` + (at >= 0 ? ` …${text.slice(Math.max(0, at - 80), at + 40)}…` : ''));
    process.exit(2);
  }
  const file = suffix ? name.replace(/(\.\w+)$/, suffix + '$1') : name;
  writeFileSync(join(out, file), text);
  report.push(`${file} ${(text.length / 1024).toFixed(0)} KB`);
}
console.log(`wrote ${report.length} fixtures to dev/youtube/ (${ids.size} video ids, ${titles.size} titles replaced)\n  ` + report.join('\n  '));
