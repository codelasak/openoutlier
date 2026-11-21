// OpenOutlier – the optional YouTube Data API v3 key (phase 5).
//
// Off unless the user enters their own API key (popup) or sets
// OPENOUTLIER_YOUTUBE_API_KEY (MCP server). Without a key nothing here is
// called and no request is made. With one:
//   • exact stats: videos.list?part=statistics,snippet,contentDetails for up
//     to 50 ids per call (1 quota unit per call);
//   • a channel's uploads: channels.list (1 unit) → its uploads playlist →
//     playlistItems.list, 50 ids per call (1 unit each). Never search.list
//     (100 units a call).
// Results become post records in the src/youtube.js shape and go through
// Y.merge, so exact values replace rounded ones and nothing exact is lost.
//
// Pure functions plus a tiny client that takes `fetch` as an argument, so it
// runs in the service worker, in the MCP server and in Node tests (mocked).
(function (root, factory) {
  var Y = root && root.OpenOutlierYouTube;
  if (!Y && typeof require === 'function') Y = require('./youtube.js');
  var api = factory(Y);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpenOutlierYouTubeApi = api;
})(typeof self !== 'undefined' ? self : this, function (Y) {
  'use strict';

  var BASE = 'https://www.googleapis.com/youtube/v3/';
  var DAILY_QUOTA = 10000; // the default per Google Cloud project
  var PER_CALL = 50;
  var VIDEO_PARTS = 'statistics,snippet,contentDetails,liveStreamingDetails';
  var CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
  var KEY_RE = /^[A-Za-z0-9_-]{20,120}$/;
  // The standard YouTube video categories (snippet.categoryId); others stay unnamed.
  var CATEGORIES = {
    1: 'Film & Animation', 2: 'Autos & Vehicles', 10: 'Music', 15: 'Pets & Animals', 17: 'Sports',
    19: 'Travel & Events', 20: 'Gaming', 22: 'People & Blogs', 23: 'Comedy', 24: 'Entertainment',
    25: 'News & Politics', 26: 'Howto & Style', 27: 'Education', 28: 'Science & Technology', 29: 'Nonprofits & Activism'
  };

  function isKey(k) { return typeof k === 'string' && KEY_RE.test(k.trim()); }

  /** Google resets the quota at midnight Pacific time: "YYYY-MM-DD" of that day. */
  function quotaDay(now) {
    var d = new Date(now == null ? Date.now() : now);
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    } catch (e) {
      return new Date(d.getTime() - 8 * 3600000).toISOString().slice(0, 10);
    }
  }

  /** { day, units } after spending `units` now (a new Pacific day starts at 0). */
  function addUnits(state, units, now) {
    var day = quotaDay(now);
    var used = state && state.day === day ? state.units || 0 : 0;
    return { day: day, units: used + (units || 0) };
  }

  /** The units used today (0 when the stored day is over). */
  function usedToday(state, now) { return state && state.day === quotaDay(now) ? state.units || 0 : 0; }

  /** ISO 8601 "PT1H2M3S" → 3723 seconds (null when not a duration). */
  function isoDuration(s) {
    var m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(String(s || ''));
    if (!m) return null;
    return Math.round((+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0));
  }

  function int(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? Math.round(n) : null;
  }

  function chunk(list, size) {
    var out = [];
    for (var i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  }

  function bestThumb(t) {
    t = t || {};
    var pick = t.maxres || t.standard || t.high || t.medium || t['default'];
    return pick && /^https:\/\/i[0-9]?\.ytimg\.com\//.test(String(pick.url || '')) ? pick.url : null;
  }

  /**
   * One videos.list item → a record patch with exact values. Fields the API
   * doesn't have (owner handle, Shorts vs long-form) come from opts:
   * { owner, type, now }. type is only set when known (live, or opts.type).
   */
  function videoRecord(item, opts) {
    opts = opts || {};
    if (!item || !Y.isVideoId(item.id)) return null;
    var sn = item.snippet || {};
    var st = item.statistics || {};
    var cd = item.contentDetails || {};
    var r = { code: item.id, platform: 'youtube' };
    var live = !!item.liveStreamingDetails || (sn.liveBroadcastContent && sn.liveBroadcastContent !== 'none');
    var type = live ? 'live' : opts.type || null;
    if (type) { r.type = type; r.url = Y.videoUrl(item.id, type); }
    if (opts.owner) r.owner = opts.owner;
    if (CHANNEL_ID_RE.test(String(sn.channelId || ''))) r.ownerId = sn.channelId;
    if (sn.channelTitle) r.ownerName = String(sn.channelTitle);
    var views = int(st.viewCount);
    if (views != null) { r.views = views; r.viewsApprox = false; }
    var likes = int(st.likeCount); // missing when the channel hides likes
    if (likes != null) r.likes = likes;
    var comments = int(st.commentCount); // missing when comments are off
    if (comments != null) r.comments = comments;
    var published = Date.parse(sn.publishedAt || '');
    if (isFinite(published)) { r.takenAt = published; r.dateApprox = false; }
    var dur = isoDuration(cd.duration);
    if (dur) r.duration = dur;
    var title = typeof sn.title === 'string' ? sn.title.slice(0, 1200) : '';
    var desc = typeof sn.description === 'string' ? sn.description.slice(0, 5000) : '';
    if (title) r.caption = title;
    if (desc) r.description = desc;
    var tags = Y.hashtagsIn(title + '\n' + desc);
    if (tags.length) r.hashtags = tags;
    if (Array.isArray(sn.tags) && sn.tags.length) r.keywords = sn.tags.slice(0, 60).map(String);
    if (CATEGORIES[sn.categoryId]) r.category = CATEGORIES[sn.categoryId];
    if (cd.caption === 'true') r.hasCaptions = true; // "false" only means no uploaded captions; auto ones may exist
    var thumb = bestThumb(sn.thumbnails);
    if (thumb) r.thumb = thumb;
    r.viaApi = opts.now || Date.now();
    return r;
  }

  /** channels.list item → the channel facts the Library keeps on an account. */
  function channelInfo(item) {
    if (!item || !CHANNEL_ID_RE.test(String(item.id || ''))) return null;
    var sn = item.snippet || {};
    var st = item.statistics || {};
    var handle = Y.handleOf(sn.customUrl && String(sn.customUrl).charAt(0) === '@' ? sn.customUrl : sn.customUrl ? '@' + sn.customUrl : '');
    var uploads = item.contentDetails && item.contentDetails.relatedPlaylists && item.contentDetails.relatedPlaylists.uploads;
    return {
      id: Y.ytId(handle || item.id),
      handle: handle || null,
      channelId: item.id,
      name: sn.title || null,
      avatar: bestThumb(sn.thumbnails),
      subscribers: st.hiddenSubscriberCount ? null : int(st.subscriberCount),
      videos: int(st.videoCount),
      views: int(st.viewCount),
      uploads: typeof uploads === 'string' ? uploads : null,
      publishedAt: sn.publishedAt && isFinite(Date.parse(sn.publishedAt)) ? Date.parse(sn.publishedAt) : null,
      country: typeof sn.country === 'string' && sn.country ? sn.country : null
    };
  }

  /** The (unofficial but long-standing) playlist of a channel's Shorts: UC… → UUSH…. */
  function shortsPlaylist(channelId) { return CHANNEL_ID_RE.test(channelId) ? 'UUSH' + channelId.slice(2) : null; }

  /** API error body → { code, message, hint }. */
  function apiError(status, body) {
    var err = body && body.error || {};
    var reason = (err.errors && err.errors[0] && err.errors[0].reason) || (err.details && err.details[0] && err.details[0].reason) || '';
    var msg = err.message || ('HTTP ' + status);
    if (/quotaExceeded|dailyLimitExceeded|rateLimitExceeded/i.test(reason)) return { code: 'quota', message: 'The API key has used up today\'s YouTube quota.', hint: 'It resets at midnight Pacific time. Until then use "Get exact stats" (opens the pages) instead.' };
    if (/keyInvalid|API_KEY_INVALID|badRequest/i.test(reason) && /key/i.test(msg)) return { code: 'bad_key', message: 'Google did not accept the API key.', hint: 'Check the key in Google Cloud → APIs & Services → Credentials.' };
    if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason) || /has not been used in project|is disabled/i.test(msg)) return { code: 'api_disabled', message: 'YouTube Data API v3 is not enabled for this key\'s project.', hint: 'Enable "YouTube Data API v3" in Google Cloud → APIs & Services → Library.' };
    if (/ipRefererBlocked|API_KEY_HTTP_REFERRER_BLOCKED|API_KEY_SERVICE_BLOCKED|forbidden/i.test(reason)) return { code: 'key_restricted', message: 'The key\'s restrictions block this request.', hint: 'Allow "YouTube Data API v3" in the key\'s API restrictions (website restrictions don\'t fit an extension or a local server).' };
    if (status === 404) return { code: 'not_found', message: msg, hint: '' };
    return { code: 'failed', message: 'YouTube Data API: ' + msg, hint: '' };
  }

  /**
   * A client around fetch. opts: { key, fetch, onUnits(n) }. Every call made
   * (also a failed one) is reported to onUnits, since Google counts those too.
   */
  function client(opts) {
    var key = String(opts.key || '').trim();
    var doFetch = opts.fetch;
    var onUnits = opts.onUnits || function () {};
    if (!isKey(key)) throw Object.assign(new Error('No YouTube Data API key is set.'), { code: 'no_key' });

    async function get(path, params) {
      var q = Object.keys(params).filter(function (k) { return params[k] != null && params[k] !== ''; })
        .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
      var url = BASE + path + '?' + q + '&key=' + encodeURIComponent(key);
      var res;
      try {
        res = await doFetch(url, { headers: { accept: 'application/json' } });
      } catch (e) {
        throw Object.assign(new Error('Could not reach the YouTube Data API (' + (e && e.message || e) + ').'), { code: 'network' });
      }
      onUnits(1);
      var body = null;
      try { body = await res.json(); } catch (e) { /* not JSON */ }
      if (!res.ok) {
        var info = apiError(res.status, body);
        throw Object.assign(new Error(info.message), info);
      }
      return body || {};
    }

    /** videos.list for any number of ids (50 per call) → items in the order YouTube returns them. */
    async function videos(ids) {
      var out = [];
      var groups = chunk(ids.filter(Y.isVideoId), PER_CALL);
      for (var i = 0; i < groups.length; i++) {
        var body = await get('videos', { part: VIDEO_PARTS, id: groups[i].join(','), maxResults: PER_CALL });
        out = out.concat(body.items || []);
      }
      return out;
    }

    /** channels.list by UC id or @handle → channelInfo (null when YouTube has no such channel). */
    async function channel(ref) {
      var params = { part: 'snippet,contentDetails,statistics' };
      if (CHANNEL_ID_RE.test(String(ref.channelId || ''))) params.id = ref.channelId;
      else if (ref.handle) params.forHandle = '@' + String(ref.handle).replace(/^@/, '');
      else throw Object.assign(new Error('Need a channel id or handle.'), { code: 'bad_request' });
      var body = await get('channels', params);
      return channelInfo((body.items || [])[0]);
    }

    /** channels.list for up to 50 UC ids in one call (1 unit) → [channelInfo] (missing ones left out). */
    async function channels(ids) {
      var list = (ids || []).filter(function (x) { return CHANNEL_ID_RE.test(String(x)); }).slice(0, PER_CALL);
      if (!list.length) return [];
      var body = await get('channels', { part: 'snippet,statistics', id: list.join(','), maxResults: PER_CALL });
      return (body.items || []).map(channelInfo).filter(Boolean);
    }

    /** Video ids in a playlist, newest first, up to max. A missing playlist → null. */
    async function playlistIds(playlistId, max) {
      var ids = [];
      var token = null;
      do {
        var body;
        try {
          body = await get('playlistItems', { part: 'contentDetails', playlistId: playlistId, maxResults: PER_CALL, pageToken: token });
        } catch (e) {
          if (e.code === 'not_found') return null;
          throw e;
        }
        (body.items || []).forEach(function (it) {
          var id = it && it.contentDetails && it.contentDetails.videoId;
          if (Y.isVideoId(id) && ids.indexOf(id) === -1 && ids.length < max) ids.push(id);
        });
        token = body.nextPageToken || null;
      } while (token && ids.length < max);
      return ids;
    }

    return { get: get, videos: videos, channel: channel, channels: channels, playlistIds: playlistIds };
  }

  /**
   * Exact stats for saved posts. posts: [{ code, owner, type }] (from the library).
   * Resolves { records: [patch], missing: [code] } (missing = deleted or private).
   */
  async function exactStats(opts) {
    var c = client(opts);
    var known = {};
    (opts.posts || []).forEach(function (p) { if (p && Y.isVideoId(p.code)) known[p.code] = p; });
    var ids = Object.keys(known);
    var items = await c.videos(ids);
    var seen = {};
    var records = items.map(function (it) {
      var p = known[it.id];
      seen[it.id] = true;
      return videoRecord(it, { owner: p && p.owner, now: opts.now });
    }).filter(Boolean);
    return { records: records, missing: ids.filter(function (id) { return !seen[id]; }) };
  }

  /**
   * A channel's uploads (newest first, up to max) with exact stats.
   * opts: { key, fetch, onUnits, channelId?, handle?, max = 200, known: { code: record } }
   * Shorts are told apart by the channel's Shorts playlist (UUSH…); when YouTube
   * doesn't serve it, a video of 60 s or less counts as a Short (typeGuessed).
   */
  async function channelUploads(opts) {
    var c = client(opts);
    var max = Math.max(1, Math.min(opts.max || 200, 5000));
    var ch = await c.channel({ channelId: opts.channelId, handle: opts.handle });
    if (!ch) throw Object.assign(new Error('YouTube has no channel ' + (opts.handle ? '@' + opts.handle : opts.channelId) + '.'), { code: 'not_found' });
    var uploads = ch.uploads || ('UU' + ch.channelId.slice(2));
    var ids = (await c.playlistIds(uploads, max)) || [];
    var shortIds = null;
    var sp = shortsPlaylist(ch.channelId);
    if (sp && ids.length) shortIds = await c.playlistIds(sp, max).catch(function () { return null; });
    var shorts = {};
    (shortIds || []).forEach(function (id) { shorts[id] = true; });
    var known = opts.known || {};
    var owner = opts.owner || ch.id;
    var items = await c.videos(ids);
    var records = items.map(function (it) {
      var prev = known[it.id];
      var type = prev && prev.type ? prev.type : shorts[it.id] ? 'short' : null;
      var r = videoRecord(it, { owner: owner, type: type, now: opts.now });
      if (!r) return null;
      if (!r.type) {
        var guess = !shortIds && r.duration && r.duration <= 60;
        r.type = guess ? 'short' : 'video';
        r.url = Y.videoUrl(r.code, r.type);
        if (guess) r.typeGuessed = true;
      }
      if (ch.handle) r.author = ch.handle;
      if (!prev) { r.files = []; r.seenAt = opts.now || Date.now(); }
      return r;
    }).filter(Boolean);
    return { channel: ch, records: records, shortsKnown: !!shortIds };
  }

  /** Units a job will cost, roughly (for the button's tooltip). */
  function costOf(nVideos, uploads) {
    var v = Math.ceil(nVideos / PER_CALL);
    return uploads ? 1 + 2 * Math.max(1, v) + v : v;
  }

  return {
    BASE: BASE, DAILY_QUOTA: DAILY_QUOTA, PER_CALL: PER_CALL, VIDEO_PARTS: VIDEO_PARTS, CATEGORIES: CATEGORIES,
    isKey: isKey, quotaDay: quotaDay, addUnits: addUnits, usedToday: usedToday, isoDuration: isoDuration, chunk: chunk,
    videoRecord: videoRecord, channelInfo: channelInfo, shortsPlaylist: shortsPlaylist, apiError: apiError,
    client: client, exactStats: exactStats, channelUploads: channelUploads, costOf: costOf
  };
});
