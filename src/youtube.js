// OpenOutlier – turn YouTube's own JSON (ytInitialData / ytInitialPlayerResponse
// in the page, and the /youtubei/v1/* responses its web app loads) into
// normalized post records. Pure functions, no DOM or chrome.* access, so they
// run in Node tests too.
//
// OpenOutlier makes no YouTube API requests of its own. Everything here comes
// from what the page already received.
//
// Account ids: "yt/<handle>" (lowercase, no "@"); channels without a handle:
// "yt/UC…" (the channel id, case kept).
//
// Channel tabs only show rounded views ("63K") and relative dates ("1 month
// ago"), so records from there carry viewsApprox / dateApprox = true. Player
// responses (watch and Shorts pages) have exact values, which replace them.
//
// Labels are localized and the same letter means different things: English
// "63B" is 63 billion, Turkish "63 B" is 63 thousand (bin). Every text helper
// takes the page language; numeric fields (viewCount, likeCount,
// originalViewCount) are used wherever they exist.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpenOutlierYouTube = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
  var CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
  var HANDLE_RE = /^[\p{L}\p{M}\p{N}._-]{1,30}$/u;
  var ACCOUNT_RE = /^yt\/(?:UC[A-Za-z0-9_-]{22}|[\p{L}\p{M}\p{N}._-]{1,30})$/u;
  var CAPTION_MAX = 1200;
  var DESCRIPTION_MAX = 5000;
  var DAY = 864e5;

  // ---- languages ------------------------------------------------------------
  // Multipliers after a number. "B" is billion in English and bin (thousand) in Turkish.
  var LANGS = {
    en: {
      dec: '.',
      units: { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9 },
      none: /^\s*no\s+(views|likes|comments|subscribers)/i,
      views: /\bviews?\b/i,
      watching: /\bwatching\b|\bwaiting\b/i,
      subscribers: /\bsubscribers?\b/i,
      videos: /\bvideos?\b/i,
      streamed: /\bstreamed\b/i,
      ago: /(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|wks?|months?|mos?|years?|yrs?|s|m|h|d|w|y)\b\.?\s*ago\b/i,
      agoUnits: { s: 1e3, sec: 1e3, secs: 1e3, second: 1e3, seconds: 1e3, m: 6e4, min: 6e4, mins: 6e4, minute: 6e4, minutes: 6e4,
        h: 36e5, hr: 36e5, hrs: 36e5, hour: 36e5, hours: 36e5, d: DAY, day: DAY, days: DAY, w: 7 * DAY, wk: 7 * DAY, wks: 7 * DAY, week: 7 * DAY, weeks: 7 * DAY,
        mo: 30.44 * DAY, mos: 30.44 * DAY, month: 30.44 * DAY, months: 30.44 * DAY, y: 365.25 * DAY, yr: 365.25 * DAY, yrs: 365.25 * DAY, year: 365.25 * DAY, years: 365.25 * DAY },
      live: /^(live|premiere|upcoming)$/i,
      members: /members/i,
      comments: /comment/i
    },
    tr: {
      dec: ',',
      units: { b: 1e3, bin: 1e3, mn: 1e6, milyon: 1e6, mr: 1e9, milyar: 1e9 },
      none: /görüntüleme\s+yok|^\s*yok\b/i,
      views: /görüntüleme|izlenme/i,
      watching: /izliyor|bekliyor/i,
      subscribers: /abone/i,
      videos: /\bvideo\b/i,
      streamed: /yayın/i,
      ago: /(\d+)\s*(saniye|sn|dakika|dk|saat|sa|gün|hafta|ay|yıl)\s*önce/i,
      agoUnits: { saniye: 1e3, sn: 1e3, dakika: 6e4, dk: 6e4, saat: 36e5, sa: 36e5, 'gün': DAY, hafta: 7 * DAY, ay: 30.44 * DAY, 'yıl': 365.25 * DAY },
      live: /^(canlı|canli|prömiyer|yakında)$/i,
      members: /üye/i,
      comments: /yorum/i
    }
  };

  /** "en-US" → "en", "tr-TR" → "tr"; null for languages without a table. */
  function normLang(hl) {
    var l = String(hl || '').toLowerCase().split(/[-_]/)[0];
    return LANGS[l] ? l : null;
  }

  /** Guess the label language from the data itself (word counts), or null. */
  function detectLang(text) {
    var t = String(text || '');
    if (t.length > 4e6) t = t.slice(0, 4e6);
    var tr = (t.match(/görüntüleme|abone|\d \w+ önce|izlenme/g) || []).length;
    var en = (t.match(/\d(?:\.\d)?[KMB]? views\b|\bago"|thousand views|million views|subscribers"/g) || []).length;
    if (tr > en && tr >= 1) return 'tr';
    if (en > tr && en >= 1) return 'en';
    return null;
  }

  // A language without a table: rounded counts ("1,2 Mio.") and relative dates can't be read
  // safely, so only plain exact numbers are; nothing else matches.
  var NEVER = /(?!)/;
  var UNKNOWN = { unknown: true, dec: null, units: {}, none: NEVER, views: NEVER, watching: NEVER, subscribers: NEVER, videos: NEVER, streamed: NEVER, ago: NEVER, agoUnits: {}, live: NEVER, members: NEVER, comments: NEVER };

  /** The label table for a page language; no language = English (tests, old callers). */
  function langOf(lang) {
    if (!lang) return LANGS.en;
    var n = normLang(lang);
    return n ? LANGS[n] : UNKNOWN;
  }

  // ---- small helpers ----------------------------------------------------------
  function getPath(obj, path) {
    var cur = obj;
    for (var i = 0; i < path.length; i++) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[path[i]];
    }
    return cur;
  }

  function str(v) { return typeof v === 'string' && v ? v : null; }

  /** Text of a YouTube text object: "x", {simpleText}, {runs: [{text}]}, {content}. */
  function text(v) {
    if (typeof v === 'string') return v;
    if (!v || typeof v !== 'object') return '';
    if (typeof v.simpleText === 'string') return v.simpleText;
    if (typeof v.content === 'string') return v.content;
    if (Array.isArray(v.runs)) return v.runs.map(function (r) { return r && typeof r.text === 'string' ? r.text : ''; }).join('');
    return '';
  }

  /** The accessibility label of a text object, if it has one. */
  function a11y(v) {
    return (v && (getPath(v, ['accessibility', 'accessibilityData', 'label']) || v.accessibilityLabel)) || '';
  }

  function int(v) {
    if (typeof v === 'number' && isFinite(v)) return Math.round(v);
    if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
    return null;
  }

  /**
   * A count in label text → number, or null. Knows en / tr multipliers:
   * "63K" / "63 thousand views" / "63 B" (tr) / "2,8 bin" (tr) / "801,352 views" / "801.352 görüntüleme".
   */
  function parseCount(s, lang) {
    if (typeof s === 'number') return isFinite(s) ? Math.round(s) : null;
    s = String(s == null ? '' : s).replace(/[  ]/g, ' ').trim();
    if (!s) return null;
    var L = langOf(lang);
    var m = s.match(/(\d+(?:[.,'’ ]\d+)*)\s*([\p{L}]+\.?)?/u);
    if (!m) return L.none.test(s) ? 0 : null;
    var unit = (m[2] || '').replace(/\.$/, '').toLowerCase();
    if (L.unknown && unit) return null;
    var mult = unit && Object.prototype.hasOwnProperty.call(L.units, unit) ? L.units[unit] : null;
    if (mult) {
      var n = m[1].replace(/[ '’]/g, '');
      // With a multiplier there is at most one decimal mark: the language's.
      n = L.dec === ',' ? n.replace(/\./g, '').replace(',', '.') : n.replace(/,/g, '');
      var f = parseFloat(n);
      return isFinite(f) ? Math.round(f * mult) : null;
    }
    // Without one the number is exact; every separator is a thousands separator.
    var digits = m[1].replace(/\D/g, '');
    return digits ? Number(digits) : null;
  }

  /** True when a count label is rounded ("63K", "2,8 B", "1.2 million"). */
  function isRounded(s, lang) {
    s = String(s || '').replace(/[  ]/g, ' ');
    var m = s.match(/(\d+(?:[.,'’ ]\d+)*)\s*([\p{L}]+\.?)?/u);
    if (!m || !m[2]) return false;
    return Object.prototype.hasOwnProperty.call(langOf(lang).units, m[2].replace(/\.$/, '').toLowerCase());
  }

  /** "3 weeks ago" / "1mo ago" / "2 gün önce" → approximate timestamp (ms), or null. */
  function parseAgo(s, lang, now) {
    var L = langOf(lang);
    var m = String(s || '').match(L.ago);
    if (!m) return null;
    var size = L.agoUnits[m[2].toLowerCase()];
    if (!size) return null;
    return Math.round((now || Date.now()) - Number(m[1]) * size);
  }

  // Month names for the date labels on watch pages ("May 8, 2025" / tr "8 May 2025", "8 Mayıs 2025").
  var MONTHS = {
    en: ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'],
    tr: ['oca', 'şub', 'mar', 'nis', 'may', 'haz', 'tem', 'ağu', 'eyl', 'eki', 'kas', 'ara']
  };

  /**
   * A calendar date label → ms at 12:00 UTC that day, or null (day precision only:
   * the label has no time). "May 8, 2025", "Premiered May 8, 2025", tr "8 May 2025".
   */
  function parseDateText(s, lang) {
    var n = normLang(lang || 'en');
    var names = n && MONTHS[n];
    if (!names) return null;
    var t = String(s || '').toLocaleLowerCase(n === 'tr' ? 'tr' : 'en');
    var m = t.match(/(\p{L}+)\.?\s+(\d{1,2}),?\s+(\d{4})/u);
    var day, mon, year;
    if (m && names.indexOf(m[1].slice(0, 3)) !== -1) { mon = names.indexOf(m[1].slice(0, 3)); day = Number(m[2]); year = Number(m[3]); }
    else if ((m = t.match(/(\d{1,2})\.?\s+(\p{L}+)\.?\s+(\d{4})/u)) && names.indexOf(m[2].slice(0, 3)) !== -1) { day = Number(m[1]); mon = names.indexOf(m[2].slice(0, 3)); year = Number(m[3]); }
    else return null;
    if (!(day >= 1 && day <= 31) || year < 2005) return null;
    return Date.UTC(year, mon, day, 12);
  }

  /** "0:42" / "1:02:03" → seconds (also accepts the "9:52" lengths). */
  function clock(s) { return parseDuration(s); }

  /** "9:52" → 592, "1:07:28" → 4048, or null. */
  function parseDuration(s) {
    var m = String(s || '').trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]);
  }

  function hashtagsIn(s) {
    var out = [];
    var re = /(?:^|[^\p{L}\p{N}_&])#([\p{L}\p{N}_]+)/gu;
    var m;
    while ((m = re.exec(String(s || '')))) {
      var t = m[1].toLowerCase();
      if (!/^\d+$/.test(t) && out.indexOf(t) === -1) out.push(t);
    }
    return out;
  }

  function cap(s, max) { s = String(s || ''); return s.length > max ? s.slice(0, max) + '…' : s; }

  // ---- ids --------------------------------------------------------------------
  function isVideoId(id) { return VIDEO_ID_RE.test(String(id || '')); }

  /** "@Name" / "Name" / "yt/name" / "UC…" → "yt/name" (handles lowercased, channel ids kept). */
  function ytId(x) {
    var s = String(x || '').trim().replace(/^\/?(yt\/|@)/i, '').replace(/^@/, '');
    try { s = decodeURIComponent(s); } catch (e) { /* keep */ }
    if (CHANNEL_ID_RE.test(s)) return 'yt/' + s;
    return 'yt/' + s.toLowerCase();
  }
  function isYouTubeId(id) { return ACCOUNT_RE.test(String(id || '')); }
  /** "yt/name" → "@name"; "yt/UC…" → "UC…". */
  function label(id) {
    var s = String(id || '').replace(/^yt\//, '');
    return CHANNEL_ID_RE.test(s) ? s : '@' + s;
  }

  /** The handle in "http://www.youtube.com/@Name", "/@Name/videos" or "@Name", or null. */
  function handleOf(s) {
    var m = String(s || '').match(/(?:^|\/)@([^/?#\s]+)/);
    if (!m) return null;
    var h;
    try { h = decodeURIComponent(m[1]); } catch (e) { h = m[1]; }
    return HANDLE_RE.test(h) ? h : null;
  }

  function videoUrl(id, type) {
    return type === 'short' ? 'https://www.youtube.com/shorts/' + id : 'https://www.youtube.com/watch?v=' + id;
  }

  /** Cover candidates for the cover download, best first (all public i.ytimg.com URLs). */
  function coverUrls(id) {
    if (!isVideoId(id)) return [];
    return ['maxresdefault', 'sddefault', 'hqdefault'].map(function (n) { return 'https://i.ytimg.com/vi/' + id + '/' + n + '.jpg'; });
  }

  /** Largest image in a {sources: [{url, width}]} / {thumbnails: [...]} list. */
  function bestImage(v) {
    var list = v && (v.sources || v.thumbnails);
    if (!Array.isArray(list) || !list.length) return null;
    var best = null;
    list.forEach(function (x) { if (x && typeof x.url === 'string' && (!best || (x.width || 0) > (best.width || 0))) best = x; });
    if (!best) return null;
    var u = best.url.indexOf('//') === 0 ? 'https:' + best.url : best.url;
    return /^https:\/\//.test(u) ? u : null;
  }

  // ---- channel ----------------------------------------------------------------
  /**
   * Channel facts from ytInitialData / a channel browse response, or null:
   * { id, handle, channelId, name, avatar, subscribers, subscribersApprox, videos, verified, description, keywords }
   */
  function parseChannel(json, lang) {
    if (!json || typeof json !== 'object') return null;
    var L = langOf(lang);
    var cm = getPath(json, ['metadata', 'channelMetadataRenderer']) || {};
    var ph = getPath(json, ['header', 'pageHeaderRenderer', 'content', 'pageHeaderViewModel']);
    var c4 = getPath(json, ['header', 'c4TabbedHeaderRenderer']);
    var channelId = str(cm.externalId) || (c4 && str(c4.channelId)) || null;
    if (channelId && !CHANNEL_ID_RE.test(channelId)) channelId = null;
    var handle = handleOf(cm.vanityChannelUrl) || (Array.isArray(cm.ownerUrls) ? cm.ownerUrls.map(handleOf).filter(Boolean)[0] : null) || null;
    var subsText = '';
    var subsLabel = '';
    var videos = null;
    if (ph) {
      (getPath(ph, ['metadata', 'contentMetadataViewModel', 'metadataRows']) || []).forEach(function (row) {
        (row && row.metadataParts || []).forEach(function (part) {
          var t = text(part && part.text);
          if (!handle && /^@/.test(t)) handle = handleOf(t);
          else if (!subsText && L.subscribers.test(t + ' ' + (part.accessibilityLabel || ''))) { subsText = t; subsLabel = part.accessibilityLabel || ''; }
          else if (videos == null && L.videos.test(t)) videos = parseCount(t, lang);
        });
      });
    }
    if (c4) {
      if (!handle) handle = handleOf(text(c4.channelHandleText)) || handleOf(getPath(c4, ['navigationEndpoint', 'browseEndpoint', 'canonicalBaseUrl']));
      if (!subsText) { subsText = text(c4.subscriberCountText); subsLabel = a11y(c4.subscriberCountText); }
      if (videos == null && c4.videosCountText) videos = parseCount(text(c4.videosCountText), lang);
    }
    if (!channelId && !handle) return null;
    var name = str(cm.title) || (ph && text(getPath(ph, ['title', 'dynamicTextViewModel', 'text']))) || (c4 && str(c4.title)) || null;
    var avatar = bestImage(cm.avatar) || (ph && bestImage(getPath(ph, ['image', 'decoratedAvatarViewModel', 'avatar', 'avatarViewModel', 'image']))) || (c4 && bestImage(c4.avatar)) || null;
    var verifiedLabel = ph ? String(getPath(ph, ['title', 'dynamicTextViewModel', 'rendererContext', 'accessibilityContext', 'label']) || '') : '';
    var subs = subsLabel ? parseCount(subsLabel, lang) : null;
    if (subs == null && subsText) subs = parseCount(subsText, lang);
    return {
      id: ytId(handle || channelId),
      handle: handle,
      channelId: channelId,
      name: name,
      avatar: avatar,
      subscribers: subs,
      subscribersApprox: subs != null ? isRounded(subsLabel || subsText, lang) || isRounded(subsText, lang) : null,
      videos: videos,
      verified: /,\s*(verified|doğrulandı|doğrulanmış)\s*$/i.test(verifiedLabel) || undefined,
      description: str(cm.description) ? cap(cm.description, 2000) : null,
      keywords: str(cm.keywords)
    };
  }

  /** Which channel tab a browse response / ytInitialData shows: 'videos' | 'shorts' | 'streams' | 'home' | … | null. */
  function selectedTab(json) {
    var tabs = getPath(json, ['contents', 'twoColumnBrowseResultsRenderer', 'tabs']);
    if (!Array.isArray(tabs)) return null;
    for (var i = 0; i < tabs.length; i++) {
      var t = tabs[i] && (tabs[i].tabRenderer || tabs[i].expandableTabRenderer);
      if (!t || !t.selected) continue;
      var url = String(getPath(t, ['endpoint', 'commandMetadata', 'webCommandMetadata', 'url']) || '');
      var m = url.match(/\/(videos|shorts|streams|featured|playlists|community|posts|podcasts|releases|courses|search)\/?$/);
      return m ? (m[1] === 'featured' ? 'home' : m[1]) : 'home';
    }
    return null;
  }

  // ---- grid items ---------------------------------------------------------------
  function ownerFields(ch) {
    return {
      owner: ch.id,
      author: ch.handle || null,
      ownerId: ch.channelId || null,
      ownerName: ch.name || null,
      ownerPic: ch.avatar || null
    };
  }

  function baseRecord(id, type, ch) {
    var r = { code: id, platform: 'youtube', url: videoUrl(id, type) };
    var o = ownerFields(ch);
    for (var k in o) r[k] = o[k];
    r.type = type;
    return r;
  }

  /** The channel a home/search-style lockup names (its avatar link), or null on a channel's own grid. */
  function lockupChannel(lvm) {
    var img = getPath(lvm, ['metadata', 'lockupMetadataViewModel', 'image', 'decoratedAvatarViewModel']);
    if (!img) return null;
    var be = getPath(img, ['rendererContext', 'commandContext', 'onTap', 'innertubeCommand', 'browseEndpoint']);
    return be ? { channelId: str(be.browseId), handle: handleOf(be.canonicalBaseUrl) } : { channelId: null, handle: null };
  }

  /** richItemRenderer.content.lockupViewModel (videos, past streams) → record, or null. */
  function parseLockup(lvm, ch, opts) {
    if (!lvm || !isVideoId(lvm.contentId)) return null;
    if (lvm.contentType && lvm.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return null;
    var other = lockupChannel(lvm);
    if (other && !(ch.channelId && other.channelId === ch.channelId) && !(ch.handle && other.handle && other.handle.toLowerCase() === ch.handle.toLowerCase())) return null;
    var lang = opts.lang;
    var L = langOf(lang);
    var now = opts.now || Date.now();
    var id = lvm.contentId;
    var meta = getPath(lvm, ['metadata', 'lockupMetadataViewModel']) || {};
    var title = text(meta.title);
    var views = null;
    var viewsLabel = '';
    var viewsShort = '';
    var takenAt = null;
    var streamed = opts.tab === 'streams';
    var liveNow = false;
    (getPath(meta, ['metadata', 'contentMetadataViewModel', 'metadataRows']) || []).forEach(function (row) {
      (row && row.metadataParts || []).forEach(function (part) {
        if (!part) return;
        var t = text(part.text);
        var lbl = part.accessibilityLabel || t;
        var ago = parseAgo(lbl, lang, now) || parseAgo(t, lang, now);
        if (ago) {
          if (takenAt == null) takenAt = ago;
          if (L.streamed.test(lbl)) streamed = true;
          return;
        }
        if (L.watching.test(lbl)) { liveNow = true; return; }
        var icon = String(getPath(part, ['leadingIcon', 'name']) || '');
        if (viewsLabel || !/\d/.test(t)) return;
        if (/PLAY_ARROW|VIEW/.test(icon) || L.views.test(lbl) || isRounded(t, lang) || L.none.test(lbl)) { viewsLabel = lbl; viewsShort = t; }
      });
    });
    if (viewsLabel) views = parseCount(viewsLabel, lang);
    var duration = null;
    var members = false;
    var thumbVm = getPath(lvm, ['contentImage', 'thumbnailViewModel']) || {};
    (thumbVm.overlays || []).forEach(function (ov) {
      (getPath(ov, ['thumbnailBottomOverlayViewModel', 'badges']) || []).forEach(function (b) {
        var bv = b && b.thumbnailBadgeViewModel;
        if (!bv) return;
        var d = parseDuration(bv.text);
        if (d != null) duration = d;
        else if (/LIVE/.test(String(bv.badgeStyle || '')) || L.live.test(String(bv.text || '').trim())) liveNow = true;
      });
    });
    // Members-only / premiere badges sit under the title (not seen on the fixture channel: kept loose).
    (getPath(meta, ['metadata', 'contentMetadataViewModel', 'metadataRows']) || []).forEach(function (row) {
      (row && row.badges || []).forEach(function (b) { if (L.members.test(text(getPath(b, ['badgeViewModel', 'badgeText'])) || '')) members = true; });
    });
    var r = baseRecord(id, streamed || liveNow ? 'live' : 'video', ch);
    if (takenAt != null) { r.takenAt = takenAt; r.dateApprox = true; }
    // Live-now / upcoming items show viewers waiting, not views.
    if (views != null && !liveNow) { r.views = views; r.viewsApprox = isRounded(viewsLabel, lang) || isRounded(viewsShort, lang); }
    if (duration != null) r.duration = duration;
    r.caption = cap(title, CAPTION_MAX);
    r.hashtags = hashtagsIn(title);
    if (members) r.membersOnly = true;
    if (liveNow) r.liveNow = true;
    r.thumb = bestImage(thumbVm.image) || coverUrls(id)[2];
    r.files = [];
    r.seenAt = now;
    return r;
  }

  /** richItemRenderer.content.shortsLockupViewModel → record, or null. */
  function parseShortsLockup(s, ch, opts) {
    if (!s) return null;
    var id = getPath(s, ['onTap', 'innertubeCommand', 'reelWatchEndpoint', 'videoId']) ||
      (String(s.entityId || '').match(/([A-Za-z0-9_-]{11})$/) || [])[1];
    if (!isVideoId(id)) return null;
    var lang = opts.lang;
    var title = text(getPath(s, ['overlayMetadata', 'primaryText']));
    var short = text(getPath(s, ['overlayMetadata', 'secondaryText']));
    // accessibilityText = "<title>, <long view count> - play Short": the long form has words, not letters.
    var acc = String(s.accessibilityText || '');
    var long = title && acc.indexOf(title + ', ') === 0 ? acc.slice(title.length + 2).split(' - ')[0] : '';
    var lbl = long && /\d/.test(long) ? long : short;
    var views = lbl ? parseCount(lbl, lang) : null;
    var r = baseRecord(id, 'short', ch);
    if (views != null) { r.views = views; r.viewsApprox = isRounded(lbl, lang) || isRounded(short, lang); }
    r.caption = cap(title, CAPTION_MAX);
    r.hashtags = hashtagsIn(title);
    r.thumb = bestImage(getPath(s, ['thumbnailViewModel', 'thumbnailViewModel', 'image'])) || coverUrls(id)[2];
    r.files = [];
    r.seenAt = opts.now || Date.now();
    return r;
  }

  /** Older grid shapes (videoRenderer / gridVideoRenderer / reelItemRenderer), kept as a fallback. */
  function parseLegacy(v, ch, opts, isShort) {
    var id = v && v.videoId;
    if (!isVideoId(id)) return null;
    var lang = opts.lang;
    var viewsLbl = a11y(v.viewCountText) || text(v.viewCountText);
    var shortLbl = text(v.shortViewCountText) || text(v.viewCountText);
    var r = baseRecord(id, isShort ? 'short' : (opts.tab === 'streams' ? 'live' : 'video'), ch);
    var views = viewsLbl ? parseCount(viewsLbl, lang) : null;
    if (views != null) { r.views = views; r.viewsApprox = isRounded(viewsLbl, lang) || isRounded(shortLbl, lang); }
    var ago = parseAgo(text(v.publishedTimeText), lang, opts.now);
    if (ago) { r.takenAt = ago; r.dateApprox = true; }
    var d = parseDuration(text(v.lengthText));
    if (d != null) r.duration = d;
    var title = text(v.title) || text(v.headline);
    r.caption = cap(title, CAPTION_MAX);
    r.hashtags = hashtagsIn(title);
    r.thumb = bestImage(v.thumbnail) || coverUrls(id)[2];
    r.files = [];
    r.seenAt = opts.now || Date.now();
    return r;
  }

  function parseGridItem(item, ch, opts) {
    if (!item || typeof item !== 'object') return null;
    var c = getPath(item, ['richItemRenderer', 'content']) || item;
    if (c.lockupViewModel) return parseLockup(c.lockupViewModel, ch, opts);
    if (c.shortsLockupViewModel) return parseShortsLockup(c.shortsLockupViewModel, ch, opts);
    if (c.videoRenderer) return parseLegacy(c.videoRenderer, ch, opts, false);
    if (c.gridVideoRenderer) return parseLegacy(c.gridVideoRenderer, ch, opts, false);
    if (c.reelItemRenderer) return parseLegacy(c.reelItemRenderer, ch, opts, true);
    return null;
  }

  function gridItemsOf(json) {
    var tabs = getPath(json, ['contents', 'twoColumnBrowseResultsRenderer', 'tabs']);
    if (Array.isArray(tabs)) {
      for (var i = 0; i < tabs.length; i++) {
        var t = tabs[i] && tabs[i].tabRenderer;
        if (t && t.selected) {
          var items = getPath(t, ['content', 'richGridRenderer', 'contents']);
          return Array.isArray(items) ? items : [];
        }
      }
      return [];
    }
    var out = [];
    var acts = [].concat(json.onResponseReceivedActions || [], json.onResponseReceivedEndpoints || []);
    acts.forEach(function (a) {
      var list = getPath(a, ['appendContinuationItemsAction', 'continuationItems']) || getPath(a, ['reloadContinuationItemsCommand', 'continuationItems']);
      if (Array.isArray(list)) out = out.concat(list);
    });
    return out;
  }

  /**
   * A channel page's ytInitialData or a /youtubei/v1/browse response (tab or continuation).
   * opts: { lang, channel (for continuations: they don't name the channel), tab, now }
   * → { channel, tab, posts, hasMore, items } (items = grid entries seen, to warn when none parse)
   */
  function parseBrowse(json, opts) {
    opts = opts || {};
    var own = parseChannel(json, opts.lang);
    var ch = own || opts.channel || null;
    var tab = selectedTab(json) || opts.tab || null;
    var items = gridItemsOf(json || {});
    var posts = [];
    var hasMore = false;
    var o = { lang: opts.lang, tab: tab, now: opts.now || Date.now() };
    items.forEach(function (it) {
      if (it && it.continuationItemRenderer) { hasMore = true; return; }
      if (!ch) return;
      var p = parseGridItem(it, ch, o);
      if (p) posts.push(p);
    });
    var videoItems = items.filter(function (it) { return it && !it.continuationItemRenderer; }).length;
    return { channel: own, tab: tab, posts: posts, hasMore: hasMore, items: videoItems };
  }

  // ---- watch / Shorts pages ------------------------------------------------------
  function captionsOf(player) {
    var tracks = getPath(player, ['captions', 'playerCaptionsTracklistRenderer', 'captionTracks']);
    if (!Array.isArray(tracks)) return { has: false, auto: false };
    var manual = tracks.some(function (t) { return t && t.kind !== 'asr' && !/^a\./.test(String(t.vssId || '')); });
    return { has: tracks.length > 0, auto: tracks.length > 0 && !manual };
  }

  /** Normalize a player response (ytInitialPlayerResponse, /player, get_watch[0].playerResponse). */
  function parsePlayer(player, opts) {
    opts = opts || {};
    var vd = player && player.videoDetails;
    var mf = getPath(player, ['microformat', 'playerMicroformatRenderer']) || {};
    var id = (vd && vd.videoId) || mf.externalVideoId;
    if (!isVideoId(id)) return null;
    var handle = handleOf(mf.ownerProfileUrl);
    var channelId = (vd && str(vd.channelId)) || str(mf.externalChannelId);
    if (channelId && !CHANNEL_ID_RE.test(channelId)) channelId = null;
    if (!handle && !channelId) return null;
    var canonical = String(mf.canonicalUrl || '');
    var type = /\/shorts\//.test(canonical) ? 'short' : (vd && (vd.isLiveContent || vd.isLive)) || mf.liveBroadcastDetails ? 'live' : 'video';
    if (type === 'video' && !canonical && mf.isShortsEligible === true) type = 'short';
    var ch = { id: ytId(handle || channelId), handle: handle, channelId: channelId, name: str(mf.ownerChannelName) || (vd && str(vd.author)), avatar: null };
    var r = baseRecord(id, type, ch);
    if (!r.ownerPic) delete r.ownerPic;
    var published = Date.parse(mf.publishDate || mf.uploadDate || '');
    if (isFinite(published)) { r.takenAt = published; r.dateApprox = false; }
    var views = int(vd && vd.viewCount);
    if (views == null) views = int(mf.viewCount);
    // A live stream that is on air reports viewers so far; keep it, but it is still exact.
    if (views != null) { r.views = views; r.viewsApprox = false; }
    var likes = int(mf.likeCount);
    if (likes != null) r.likes = likes;
    var d = int((vd && vd.lengthSeconds) || mf.lengthSeconds);
    if (d) r.duration = d;
    var title = (vd && str(vd.title)) || text(mf.title);
    var desc = (vd && typeof vd.shortDescription === 'string' ? vd.shortDescription : text(mf.description)) || '';
    r.caption = cap(title, CAPTION_MAX);
    if (desc) r.description = cap(desc, DESCRIPTION_MAX);
    r.hashtags = hashtagsIn(title + '\n' + desc);
    if (vd && Array.isArray(vd.keywords) && vd.keywords.length) r.keywords = vd.keywords.slice(0, 60).map(String);
    if (str(mf.category)) r.category = mf.category;
    var caps = captionsOf(player);
    r.hasCaptions = caps.has;
    if (caps.has) r.autoCaptions = caps.auto;
    if (mf.isUnlisted === true) r.unlisted = true;
    r.thumb = bestImage(getPath(mf, ['thumbnail'])) || bestImage(vd && vd.thumbnail) || coverUrls(id)[2];
    r.files = [];
    r.seenAt = opts.now || Date.now();
    return r;
  }

  // ---- chapters, heatmap, the watch page's channel facts -------------------------
  var HEATMAP_POINTS = 100;

  /** Chapters from a /next response → [{ title, start (seconds) }] (null when the video has none). */
  function chaptersOf(next) {
    var out = [];
    var map = getPath(next, ['playerOverlays', 'playerOverlayRenderer', 'decoratedPlayerBarRenderer', 'decoratedPlayerBarRenderer', 'playerBar', 'multiMarkersPlayerBarRenderer', 'markersMap']);
    (Array.isArray(map) ? map : []).forEach(function (entry) {
      if (out.length || !entry || entry.key !== 'DESCRIPTION_CHAPTERS' && entry.key !== 'AUTO_CHAPTERS') return;
      (getPath(entry, ['value', 'chapters']) || []).forEach(function (c) {
        var cr = c && c.chapterRenderer;
        var start = cr && typeof cr.timeRangeStartMillis === 'number' ? Math.round(cr.timeRangeStartMillis / 1000) : null;
        var title = cr && text(cr.title).trim();
        if (title && start != null) out.push({ title: cap(title, 200), start: start });
      });
    });
    if (!out.length) {
      // Fallback: the chapters engagement panel ("0:00" + title cards).
      (next.engagementPanels || []).forEach(function (ep) {
        var p = ep && ep.engagementPanelSectionListRenderer;
        if (out.length || !p || !/macro-markers-(description|auto)-chapters/.test(String(p.panelIdentifier || ''))) return;
        (getPath(p, ['content', 'macroMarkersListRenderer', 'contents']) || []).forEach(function (it) {
          var m = it && it.macroMarkersListItemRenderer;
          var start = m ? clock(text(m.timeDescription)) : null;
          var title = m && text(m.title).trim();
          if (title && start != null) out.push({ title: cap(title, 200), start: start });
        });
      });
    }
    out.sort(function (a, b) { return a.start - b.start; });
    return out.length ? out.slice(0, 200) : null;
  }

  function num(v) { var n = typeof v === 'string' ? Number(v) : v; return typeof n === 'number' && isFinite(n) ? n : null; }

  /**
   * "Most replayed" heatmap from a /next response (or any JSON that carries the
   * entity) → { values: [100 numbers 0–1], peaks: [seconds], step: seconds per value } or null.
   * Lives in frameworkUpdates…macroMarkersListEntity (MARKER_TYPE_HEATMAP); older pages
   * had it in markersMap (HEATSEEKER).
   */
  function heatmapOf(json, videoId) {
    var markers = null;
    var peaks = [];
    (getPath(json, ['frameworkUpdates', 'entityBatchUpdate', 'mutations']) || []).forEach(function (mu) {
      var e = getPath(mu, ['payload', 'macroMarkersListEntity']);
      if (markers || !e || getPath(e, ['markersList', 'markerType']) !== 'MARKER_TYPE_HEATMAP') return;
      if (videoId && e.externalVideoId && e.externalVideoId !== videoId) return;
      markers = (getPath(e, ['markersList', 'markers']) || []).map(function (m) {
        return { start: num(m && m.startMillis), dur: num(m && m.durationMillis), v: num(m && m.intensityScoreNormalized) };
      });
      (getPath(e, ['markersList', 'markersDecoration', 'timedMarkerDecorations']) || []).forEach(function (d) {
        var t = num(d && d.decorationTimeMillis);
        if (t != null) peaks.push(Math.round(t / 1000));
      });
    });
    if (!markers) {
      var map = getPath(json, ['playerOverlays', 'playerOverlayRenderer', 'decoratedPlayerBarRenderer', 'decoratedPlayerBarRenderer', 'playerBar', 'multiMarkersPlayerBarRenderer', 'markersMap']);
      (Array.isArray(map) ? map : []).forEach(function (entry) {
        var hm = getPath(entry, ['value', 'heatmap', 'heatmapRenderer']);
        if (markers || !hm) return;
        markers = (hm.heatMarkers || []).map(function (x) {
          var r = x && x.heatMarkerRenderer || {};
          return { start: num(r.timeRangeStartMillis), dur: num(r.markerDurationMillis), v: num(r.heatMarkerIntensityScoreNormalized) };
        });
        (hm.heatMarkersDecorations || []).forEach(function (d) {
          var t = num(getPath(d, ['timedMarkerDecorationRenderer', 'decorationTimeMillis']));
          if (t != null) peaks.push(Math.round(t / 1000));
        });
      });
    }
    return heatmapFromMarkers(markers, peaks);
  }

  /**
   * markers [{ start, dur (ms), v (0–1) }] + label times (s) → { values (100), peaks (s), step (s) }, or null.
   * Shared by the watch-page parser and the yt-dlp info JSON (mcp/youtube-dl.mjs).
   */
  function heatmapFromMarkers(markers, peaks) {
    peaks = (peaks || []).slice();
    if (!markers || markers.length < 10) return null;
    var values = markers.map(function (m) { return m.v == null ? 0 : Math.round(Math.max(0, Math.min(1, m.v)) * 1000) / 1000; });
    if (values.length !== HEATMAP_POINTS) {
      // Resample to a fixed 100 points so every record has the same shape.
      var src = values;
      values = [];
      for (var i = 0; i < HEATMAP_POINTS; i++) values.push(src[Math.min(src.length - 1, Math.floor(i * src.length / HEATMAP_POINTS))]);
    }
    var last = markers[markers.length - 1];
    var total = last && last.start != null && last.dur != null ? last.start + last.dur : null;
    var step = total ? Math.round(total / HEATMAP_POINTS) / 1000 : (markers[0] && markers[0].dur ? markers[0].dur * markers.length / HEATMAP_POINTS / 1000 : null);
    if (!peaks.length) {
      // No "Most replayed" label: use the highest point (skipping the first one, which is mostly the start).
      var best = 1;
      for (var j = 2; j < values.length; j++) if (values[j] > values[best]) best = j;
      if (step && values[best] >= 0.5) peaks.push(Math.round((best + 0.5) * step));
    }
    peaks = peaks.filter(function (p, k) { return peaks.indexOf(p) === k; }).sort(function (a, b) { return a - b; });
    return { values: values, peaks: peaks, step: step };
  }

  /** The channel facts a watch page shows under the video: name, avatar, subscribers, verified. */
  function ownerChannel(owner, lang) {
    if (!owner) return null;
    var be = getPath(owner, ['navigationEndpoint', 'browseEndpoint']) || {};
    var handle = handleOf(be.canonicalBaseUrl);
    var channelId = CHANNEL_ID_RE.test(String(be.browseId || '')) ? be.browseId : null;
    if (!handle && !channelId) return null;
    var ch = { id: ytId(handle || channelId), handle: handle, channelId: channelId };
    var name = text(owner.title).trim();
    if (name) ch.name = name;
    var avatar = bestImage(owner.thumbnail);
    if (avatar) ch.avatar = avatar;
    var st = text(owner.subscriberCountText);
    var sl = a11y(owner.subscriberCountText);
    var subs = sl ? parseCount(sl, lang) : null;
    if (subs == null && st) subs = parseCount(st, lang);
    if (subs != null) { ch.subscribers = subs; ch.subscribersApprox = isRounded(st, lang) || isRounded(sl, lang); }
    if ((owner.badges || []).some(function (b) { return /VERIFIED/.test(String(getPath(b, ['metadataBadgeRenderer', 'style']) || '')); })) ch.verified = true;
    return ch;
  }

  /** The owner block of a /next response (videoSecondaryInfoRenderer.owner.videoOwnerRenderer). */
  function nextOwner(next) {
    var owner = null;
    watchNextContents(next).forEach(function (c) { if (c && c.videoSecondaryInfoRenderer) owner = getPath(c.videoSecondaryInfoRenderer, ['owner', 'videoOwnerRenderer']); });
    return owner;
  }

  /** Channel facts from a watch page's /next data, or null. */
  function watchChannel(next, lang) { return next ? ownerChannel(nextOwner(next), lang) : null; }

  /** The structured description's publish date ("May 8, 2025"), as a fallback date source. */
  function descriptionDate(json) {
    var out = '';
    (json && json.engagementPanels || []).forEach(function (ep) {
      var p = ep && ep.engagementPanelSectionListRenderer;
      if (out || !p || (p.panelIdentifier || p.targetId) !== 'engagement-panel-structured-description') return;
      (getPath(p, ['content', 'structuredDescriptionContentRenderer', 'items']) || []).forEach(function (it) {
        var hd = it && it.videoDescriptionHeaderRenderer;
        if (!out && hd) out = text(hd.publishDate);
      });
    });
    return out;
  }

  function watchNextContents(next) {
    var c = getPath(next, ['contents', 'twoColumnWatchNextResults', 'results', 'results', 'contents']);
    return Array.isArray(c) ? c : [];
  }

  /** Exact or near-exact values from a /next response (ytInitialData on /watch, get_watch[1].watchNextResponse). */
  function parseNext(next, opts) {
    opts = opts || {};
    var id = getPath(next, ['currentVideoEndpoint', 'watchEndpoint', 'videoId']);
    if (!isVideoId(id)) return null;
    var contents = watchNextContents(next);
    var primary = null;
    var owner = nextOwner(next);
    contents.forEach(function (c) {
      if (c && c.videoPrimaryInfoRenderer) primary = c.videoPrimaryInfoRenderer;
    });
    if (!primary && !owner) return null;
    var be = owner && getPath(owner, ['navigationEndpoint', 'browseEndpoint']);
    var handle = be ? handleOf(be.canonicalBaseUrl) : null;
    var channelId = be && CHANNEL_ID_RE.test(String(be.browseId || '')) ? be.browseId : null;
    var r = { code: id, platform: 'youtube', url: videoUrl(id, 'video') };
    if (handle || channelId) {
      var o = ownerFields({ id: ytId(handle || channelId), handle: handle, channelId: channelId, name: text(owner.title) || null, avatar: bestImage(owner.thumbnail) });
      for (var k in o) if (o[k] != null) r[k] = o[k];
    }
    if (primary) {
      var vc = getPath(primary, ['viewCount', 'videoViewCountRenderer']) || {};
      var exact = int(vc.originalViewCount);
      if (exact == null && vc.viewCount && !isRounded(text(vc.viewCount), opts.lang)) exact = parseCount(text(vc.viewCount), opts.lang);
      if (exact != null && !vc.isLive) { r.views = exact; r.viewsApprox = false; }
      var t = text(primary.title);
      if (t) r.caption = cap(t, CAPTION_MAX);
      // Day-precision date ("May 8, 2025"): better than "1 year ago", but no time of day.
      var day = parseDateText(text(primary.dateText), opts.lang);
      if (day == null) day = parseDateText(descriptionDate(next), opts.lang);
      if (day != null) { r.takenAt = day; r.dateApprox = true; r.dateDay = true; }
    }
    var chapters = chaptersOf(next);
    if (chapters) r.chapters = chapters;
    var hm = heatmapOf(next, id);
    if (hm) { r.heatmap = hm.values; r.heatmapPeaks = hm.peaks; if (hm.step) r.heatmapStep = hm.step; }
    // Comment count: the comments panel header ("234", or "1.2K" on big videos).
    (next.engagementPanels || []).forEach(function (ep) {
      var p = ep && ep.engagementPanelSectionListRenderer;
      if (!p || p.panelIdentifier !== 'engagement-panel-comments-section') return;
      var c = text(getPath(p, ['header', 'engagementPanelTitleHeaderRenderer', 'contextualInfo']));
      var n = c ? parseCount(c, opts.lang) : null;
      if (n != null) { r.comments = n; if (isRounded(c, opts.lang)) r.commentsApprox = true; }
    });
    r.seenAt = opts.now || Date.now();
    return r;
  }

  /** ytInitialData on /shorts/<id> and /reel/reel_item_watch: comment count (and the channel handle). */
  function parseReelItem(json, opts) {
    opts = opts || {};
    var ov = getPath(json, ['overlay', 'reelPlayerOverlayRenderer']);
    if (!ov) return null;
    var vm = getPath(ov, ['playerOverlay', 'reelPlayerOverlayViewModel']) || {};
    var buttons = getPath(vm, ['actionBar', 'reelActionBarViewModel', 'buttonViewModels']) || [];
    // The response's own id wins (logged out it is in the like button's sign-in link); the page URL's
    // id is only a fallback, since this response can arrive before the URL changes.
    var id = null;
    var likes = null;
    var comments = null;
    var L = langOf(opts.lang);
    buttons.forEach(function (b) {
      var like = getPath(b, ['likeButtonViewModel', 'toggleButtonViewModel', 'toggleButtonViewModel', 'defaultButtonViewModel', 'buttonViewModel']);
      if (like) {
        var vid = getPath(like, ['onTap', 'innertubeCommand', 'modalEndpoint', 'modal', 'modalWithTitleAndButtonRenderer', 'button', 'buttonRenderer', 'navigationEndpoint', 'signInEndpoint', 'nextEndpoint', 'watchEndpoint', 'videoId']);
        if (!id && isVideoId(vid)) id = vid;
        var lt = String(like.title || '');
        if (/\d/.test(lt)) likes = { n: parseCount(lt, opts.lang), approx: isRounded(lt, opts.lang) };
        return;
      }
      var bv = b && b.buttonViewModel;
      if (bv && L.comments.test(String(bv.accessibilityText || '')) && /\d/.test(String(bv.title || ''))) comments = { n: parseCount(bv.title, opts.lang), approx: isRounded(bv.title, opts.lang) };
    });
    if (!isVideoId(id)) id = opts.videoId || null;
    if (!isVideoId(id)) return null;
    // No type: a fragment that only fills in a Short already collected (the player response brings the rest).
    var r = { code: id, platform: 'youtube', url: videoUrl(id, 'short') };
    (getPath(vm, ['metapanel', 'reelMetapanelViewModel', 'metadataItems']) || []).forEach(function (it) {
      var bar = it && it.reelChannelBarViewModel;
      if (!bar || r.owner) return;
      var handle = handleOf(text(bar.channelName));
      var be = getPath(bar, ['channelName', 'commandRuns', 0, 'onTap', 'innertubeCommand', 'browseEndpoint']) || getPath(bar, ['onTap', 'innertubeCommand', 'browseEndpoint']);
      var channelId = be && CHANNEL_ID_RE.test(String(be.browseId || '')) ? be.browseId : null;
      if (handle || channelId) { r.owner = ytId(handle || channelId); if (handle) r.author = handle; if (channelId) r.ownerId = channelId; }
    });
    // Only exact small counts: the player response's likeCount is exact anyway.
    if (likes && likes.n != null && !likes.approx) r.likes = likes.n;
    if (comments && comments.n != null) { r.comments = comments.n; if (comments.approx) r.commentsApprox = true; }
    var day = parseDateText(descriptionDate(json), opts.lang);
    if (day != null) { r.takenAt = day; r.dateApprox = true; r.dateDay = true; }
    r.seenAt = opts.now || Date.now();
    return r;
  }

  /** A watch page: player response + next response → one record (or null). */
  function parseWatch(player, next, opts) {
    var a = player ? parsePlayer(player, opts) : null;
    var b = next ? parseNext(next, opts) : null;
    if (b && a && b.code !== a.code) b = null;
    if (!a) return b && b.owner ? b : null;
    if (b) {
      // Keep the player's exact views unless /next has more (it is often fetched later).
      if (b.views != null && a.views != null && b.views < a.views) delete b.views;
      if (b.ownerPic) a.ownerPic = b.ownerPic;
      if (b.comments != null) { a.comments = b.comments; if (b.commentsApprox) a.commentsApprox = true; }
      if (b.views != null) a.views = b.views;
      ['chapters', 'heatmap', 'heatmapPeaks', 'heatmapStep'].forEach(function (k) { if (b[k] != null) a[k] = b[k]; });
      if (a.takenAt == null && b.takenAt != null) { a.takenAt = b.takenAt; a.dateApprox = true; a.dateDay = true; }
    }
    return a;
  }

  // ---- responses and pages ------------------------------------------------------
  /**
   * Any parsed YouTube JSON → { posts, channel, tab, hasMore, items, kind }.
   * opts: { lang, channel, tab, now, videoId } (channel/tab: the page's, for browse continuations).
   */
  function parseJson(json, opts) {
    opts = opts || {};
    var out = { posts: [], channel: null, tab: null, hasMore: null, items: 0, kind: 'other' };
    if (!json || typeof json !== 'object') return out;
    function add(p) { if (p) out.posts.push(p); }
    if (Array.isArray(json)) {
      // get_watch: [{playerResponse}, {watchNextResponse}]
      var player = null;
      var next = null;
      json.forEach(function (part) {
        if (!part || typeof part !== 'object') return;
        if (part.playerResponse) player = part.playerResponse;
        if (part.watchNextResponse) next = part.watchNextResponse;
      });
      if (player || next) { out.kind = 'watch'; add(parseWatch(player, next, opts)); out.channel = watchChannel(next, opts.lang); }
      return out;
    }
    if (json.playerResponse || json.watchNextResponse) {
      out.kind = 'watch';
      add(parseWatch(json.playerResponse, json.watchNextResponse, opts));
      out.channel = watchChannel(json.watchNextResponse, opts.lang);
      return out;
    }
    if (json.videoDetails || getPath(json, ['microformat', 'playerMicroformatRenderer'])) {
      out.kind = 'player';
      add(parsePlayer(json, opts));
      return out;
    }
    if (getPath(json, ['contents', 'twoColumnWatchNextResults'])) {
      out.kind = 'next';
      add(parseNext(json, opts));
      out.channel = watchChannel(json, opts.lang);
      return out;
    }
    if (getPath(json, ['overlay', 'reelPlayerOverlayRenderer'])) {
      out.kind = 'reel';
      add(parseReelItem(json, opts));
      return out;
    }
    if (Array.isArray(json.entries)) {
      // reel_watch_sequence: upcoming Shorts, prefetched with their player responses.
      out.kind = 'sequence';
      json.entries.forEach(function (e) {
        var ep = getPath(e, ['command', 'reelWatchEndpoint']) || {};
        var pre = ep.unserializedPrefetchData || {};
        if (pre.playerResponse) add(parsePlayer(pre.playerResponse, opts));
        if (pre.reelItemWatchResponse) add(parseReelItem(pre.reelItemWatchResponse, Object.assign({}, opts, { videoId: ep.videoId })));
      });
      return out;
    }
    if (getPath(json, ['contents', 'twoColumnBrowseResultsRenderer']) || json.onResponseReceivedActions || json.onResponseReceivedEndpoints) {
      var b = parseBrowse(json, opts);
      out.kind = getPath(json, ['contents', 'twoColumnBrowseResultsRenderer']) ? 'channel' : 'continuation';
      out.posts = b.posts;
      out.channel = b.channel;
      out.tab = b.tab;
      out.hasMore = b.hasMore;
      out.items = b.items;
    }
    return out;
  }

  /** Parse a raw response body. */
  function parseText(body, opts) {
    if (typeof body !== 'string' || !body) return parseJson(null, opts);
    var json;
    try { json = JSON.parse(body); } catch (e) {
      // Some responses start with the anti-JSON-hijacking prefix ")]}'".
      try { json = JSON.parse(body.replace(/^\)\]\}'\s*/, '')); } catch (e2) { return parseJson(null, opts); }
    }
    return parseJson(json, opts);
  }

  /**
   * The JSON object assigned to a variable in inline script text:
   * "var ytInitialData = {…};" or 'window["ytInitialData"] = {…};'. Returns the parsed object or null.
   */
  function extractVar(source, name) {
    var s = String(source || '');
    var re = new RegExp('(?:var\\s+' + name + '|window\\[["\']' + name + '["\']\\]|window\\.' + name + ')\\s*=\\s*\\{');
    var m = re.exec(s);
    if (!m) return null;
    var start = m.index + m[0].length - 1;
    var depth = 0;
    var inStr = false;
    var esc = false;
    for (var i = start; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (inStr) {
        if (esc) esc = false;
        else if (c === 92) esc = true;        // backslash
        else if (c === 34) inStr = false;     // "
        continue;
      }
      if (c === 34) inStr = true;
      else if (c === 123) depth++;            // {
      else if (c === 125 && --depth === 0) {  // }
        try { return JSON.parse(s.slice(start, i + 1)); } catch (e) { return null; }
      }
    }
    return null;
  }

  /**
   * The inline data of a first page load (whole HTML or the scripts' text):
   * ytInitialPlayerResponse + ytInitialData → { posts, channel, tab, hasMore, items, kind }.
   */
  function parsePage(source, opts) {
    opts = opts || {};
    var data = extractVar(source, 'ytInitialData');
    var player = extractVar(source, 'ytInitialPlayerResponse');
    if (player && data && getPath(data, ['contents', 'twoColumnWatchNextResults'])) {
      return { posts: [parseWatch(player, data, opts)].filter(Boolean), channel: watchChannel(data, opts.lang), tab: null, hasMore: null, items: 0, kind: 'watch' };
    }
    var out = parseJson(data, opts);
    if (player) {
      var p = parsePlayer(player, opts);
      if (p) {
        out.posts = out.posts.map(function (x) { return x.code === p.code ? merge(p, x) : x; });
        if (!out.posts.some(function (x) { return x.code === p.code; })) out.posts.unshift(p);
        if (out.kind === 'other' || out.kind === 'reel') out.kind = out.kind === 'reel' ? 'short' : 'player';
      }
    }
    return out;
  }

  // ---- page context -----------------------------------------------------------------
  /**
   * What the current page is.
   * → { kind: 'channel'|'watch'|'short'|'other', id: 'yt/…' | null, handle, channelId, tab, video }
   */
  function pageContext(pathname, search) {
    var path = String(pathname || '');
    var none = { kind: 'other', id: null, handle: null, channelId: null, tab: null, video: null };
    var m;
    if ((m = path.match(/^\/shorts\/([A-Za-z0-9_-]{11})/))) return Object.assign({}, none, { kind: 'short', video: m[1] });
    if (/^\/watch\/?$/.test(path)) {
      var v = null;
      try { v = new URLSearchParams(String(search || '')).get('v'); } catch (e) { v = null; }
      return Object.assign({}, none, { kind: 'watch', video: isVideoId(v) ? v : null });
    }
    if ((m = path.match(/^\/live\/([A-Za-z0-9_-]{11})/))) return Object.assign({}, none, { kind: 'watch', video: m[1] });
    var tab = null;
    if ((m = path.match(/^\/@([^/?#]+)(?:\/([a-z]+))?/))) {
      var handle = handleOf('@' + m[1]);
      if (!handle) return none;
      tab = m[2] || 'home';
      return Object.assign({}, none, { kind: 'channel', id: ytId(handle), handle: handle, tab: tab === 'featured' ? 'home' : tab });
    }
    if ((m = path.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})(?:\/([a-z]+))?/))) {
      tab = m[2] || 'home';
      return Object.assign({}, none, { kind: 'channel', id: ytId(m[1]), channelId: m[1], tab: tab === 'featured' ? 'home' : tab });
    }
    if ((m = path.match(/^\/(?:c|user)\/([^/?#]+)(?:\/([a-z]+))?/))) {
      tab = m[2] || 'home';
      return Object.assign({}, none, { kind: 'channel', tab: tab === 'featured' ? 'home' : tab });
    }
    return none;
  }

  // ---- merging ----------------------------------------------------------------------
  /**
   * Merge a fresh record into a stored one. Exact values beat rounded ones:
   * exact views replace "63K", an exact publish date replaces "1 month ago".
   * YouTube rounds down, so a rounded count above a stored exact one means the
   * video has grown since: then the rounded one is kept (flagged approximate).
   */
  function merge(prev, next) {
    if (!prev) return next;
    if (!next) return prev;
    var out = {};
    var k;
    for (k in prev) out[k] = prev[k];
    for (k in next) {
      var a = prev[k];
      var b = next[k];
      if (b === null || b === undefined || b === '' || (Array.isArray(b) && b.length === 0)) continue;
      if (k === 'views' || k === 'viewsApprox' || k === 'takenAt' || k === 'dateApprox' || k === 'dateDay' || k === 'comments' || k === 'commentsApprox') continue;
      if (k === 'type') out.type = (a === 'short' || a === 'live') && b === 'video' ? a : b;
      else if (k === 'url') out.url = (out.type || b) === 'short' ? videoUrl(next.code || prev.code, 'short') : b;
      else if (k === 'hashtags') out.hashtags = union(a, b);
      else if (k === 'likes' && typeof a === 'number' && typeof b === 'number') out.likes = Math.max(a, b);
      else if (k === 'thumb' && a && /\/(maxresdefault|hq720|sddefault)\./.test(a) && /\/(hqdefault|mqdefault|default)\./.test(b)) continue;
      else out[k] = b;
    }
    if (out.type === 'short') out.url = videoUrl(out.code, 'short');
    mergeCount(out, prev, next, 'views', 'viewsApprox');
    mergeCount(out, prev, next, 'comments', 'commentsApprox');
    if (next.takenAt != null) {
      // Exact (player) > calendar day (watch page label) > relative ("1 month ago").
      var rank = function (r) { return r.takenAt == null ? 0 : r.dateApprox === false ? 3 : r.dateDay ? 2 : 1; };
      if (rank(next) >= rank(prev)) {
        out.takenAt = next.takenAt;
        out.dateApprox = !!next.dateApprox;
        if (next.dateDay && next.dateApprox) out.dateDay = true; else delete out.dateDay;
      }
    }
    return out;
  }

  function mergeCount(out, prev, next, key, flag) {
    var b = next[key];
    if (b == null) return;
    var a = prev[key];
    var bApprox = !!next[flag];
    var aApprox = !!prev[flag];
    var take;
    if (a == null) take = true;
    else if (bApprox === aApprox) take = b >= a;
    else if (!bApprox) take = true;            // exact beats rounded
    else take = b > a;                          // rounded (rounded down) above exact: it grew
    if (take) {
      out[key] = b;
      if (bApprox) out[flag] = true; else delete out[flag];
      if (key === 'views') out.viewsApprox = bApprox;
    }
  }

  function union(a, b) {
    var out = Array.isArray(a) ? a.slice() : [];
    (b || []).forEach(function (x) { if (out.indexOf(x) === -1) out.push(x); });
    return out;
  }

  function mergePostMaps(base, extra) {
    var out = {};
    var k;
    for (k in base || {}) out[k] = base[k];
    for (k in extra || {}) out[k] = merge(out[k], extra[k]);
    return out;
  }

  /** Pull the video id out of a YouTube URL (watch, shorts, youtu.be, live, embed) or a bare id. */
  function videoIdOf(s) {
    var t = String(s || '').trim();
    var m = t.match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i) || t.match(/^([A-Za-z0-9_-]{11})$/);
    return m ? m[1] : null;
  }

  return {
    LANGS: Object.keys(LANGS),
    normLang: normLang,
    detectLang: detectLang,
    text: text,
    parseCount: parseCount,
    isRounded: isRounded,
    parseAgo: parseAgo,
    parseDuration: parseDuration,
    parseDateText: parseDateText,
    chaptersOf: chaptersOf,
    heatmapOf: heatmapOf,
    heatmapFromMarkers: heatmapFromMarkers,
    watchChannel: watchChannel,
    hashtagsIn: hashtagsIn,
    isVideoId: isVideoId,
    ytId: ytId,
    isYouTubeId: isYouTubeId,
    label: label,
    handleOf: handleOf,
    videoUrl: videoUrl,
    coverUrls: coverUrls,
    parseChannel: parseChannel,
    selectedTab: selectedTab,
    parseBrowse: parseBrowse,
    parsePlayer: parsePlayer,
    parseNext: parseNext,
    parseReelItem: parseReelItem,
    parseWatch: parseWatch,
    parseJson: parseJson,
    parseText: parseText,
    extractVar: extractVar,
    parsePage: parsePage,
    pageContext: pageContext,
    merge: merge,
    mergePostMaps: mergePostMaps,
    videoIdOf: videoIdOf
  };
});
