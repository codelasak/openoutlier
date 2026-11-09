// OpenOutlier – turn TikTok's own JSON (the /api/… responses its web app loads,
// and the SSR blob it embeds in the page) into normalized post records.
// Pure functions, no DOM or chrome.* access, so they run in Node tests too.
//
// OpenOutlier makes no TikTok API requests of its own: TikTok signs them
// (X-Bogus, X-Gnarly, msToken) and replayed requests break within minutes.
// Everything here comes from responses the page already received.
//
// Account ids: "tt/<username>" (Instagram ids have no "/", Reddit uses r/ and u/).
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReelScopeTikTok = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ID_RE = /^\d{8,25}$/;
  var USER_RE = /^[a-z0-9._]{1,30}$/;
  var CAPTION_MAX = 1200;
  // SSR blobs TikTok has used, newest first. scanSsr() also falls back to any JSON script.
  var SSR_IDS = ['__UNIVERSAL_DATA_FOR_REHYDRATION__', 'SIGI_STATE', '__NEXT_DATA__'];

  function num(v) {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v)) return Number(v);
    return null;
  }

  /** The larger of two counters (stats vs statsV2); statsV2 values are strings and can be more precise. */
  function maxNum(a, b) {
    var x = num(a);
    var y = num(b);
    if (x === null) return y;
    if (y === null) return x;
    return Math.max(x, y);
  }

  function getPath(obj, path) {
    var cur = obj;
    for (var i = 0; i < path.length; i++) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[path[i]];
    }
    return cur;
  }

  function str(v) { return typeof v === 'string' && v ? v : null; }

  function ttId(username) { return 'tt/' + String(username || '').replace(/^\/?(tt\/|@)/i, '').toLowerCase(); }
  function isTikTokId(id) { return /^tt\/[a-z0-9._]{1,30}$/.test(String(id || '')); }
  /** "tt/name" → "@name" (callers add a TikTok marker where platforms mix). */
  function label(id) { return '@' + String(id || '').replace(/^tt\//, ''); }

  function hashtagsOf(o, caption) {
    var out = [];
    var seen = {};
    function add(t) {
      t = String(t || '').replace(/^#/, '').toLowerCase();
      if (t && !seen[t]) { seen[t] = true; out.push(t); }
    }
    (Array.isArray(o.textExtra) ? o.textExtra : []).forEach(function (x) { if (x && x.hashtagName) add(x.hashtagName); });
    // textExtra marks the real hashtags; "#1" or "#N/A" in the text are not. Without it, read the text.
    if (!out.length) {
      var re = /#([\p{L}\p{N}_]+)/gu;
      var m;
      while ((m = re.exec(caption))) if (!/^\d+$/.test(m[1])) add(m[1]);
    }
    (Array.isArray(o.challenges) ? o.challenges : []).forEach(function (c) { if (c && c.title) add(c.title); });
    return out;
  }

  function audioOf(o) {
    var mu = o.music;
    if (!mu || typeof mu !== 'object') return null;
    var title = str(mu.title) || '';
    var artist = str(mu.authorName) || '';
    if (!title && !artist) return null;
    var original = mu.original === true || /^(original sound|orijinal ses|son original|sonido original)/i.test(title);
    return { kind: original ? 'original' : 'music', title: title || (original ? 'Original sound' : ''), artist: artist, id: mu.id != null ? String(mu.id) : null };
  }

  /** First usable URL from TikTok's various address shapes (string, {UrlList: [...]}, [..]). */
  function urlOf(v) {
    if (typeof v === 'string') return /^https:\/\//.test(v) ? v : null;
    if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) { var u = urlOf(v[i]); if (u) return u; } return null; }
    if (v && typeof v === 'object') return urlOf(v.UrlList || v.urlList || v.url_list || v.url);
    return null;
  }

  function videoUrls(video) {
    var out = [];
    function add(u) { if (u && out.indexOf(u) === -1) out.push(u); }
    add(urlOf(video.playAddr));
    (Array.isArray(video.bitrateInfo) ? video.bitrateInfo : []).forEach(function (b) { add(urlOf(b && b.PlayAddr)); });
    add(urlOf(video.downloadAddr));
    return out;
  }

  function looksLikeItem(o) {
    var id = o.id != null ? String(o.id) : '';
    if (!ID_RE.test(id)) return false;
    if (!(o.stats || o.statsV2)) return false;
    if (o.createTime == null) return false;
    var author = o.author;
    return !!(o.video || o.imagePost) && (typeof author === 'string' || (author && typeof author === 'object' && author.uniqueId));
  }

  /** Normalize one TikTok item (itemStruct / itemList entry / ItemModule value), or return null. */
  function parseItem(o, authorsById) {
    if (!o || typeof o !== 'object' || Array.isArray(o) || !looksLikeItem(o)) return null;
    // isAd is also set on a creator's own promoted videos in their profile's item_list
    // (seen on tiktok.com, Nov 2026), so keep them and flag them. A brand's ad in the
    // For You feed just lands under that brand's own account (hidden: under 5 posts).
    var a = typeof o.author === 'string' ? ((authorsById && authorsById[o.author]) || { uniqueId: o.author }) : o.author;
    var username = String(a.uniqueId || '').toLowerCase();
    if (!USER_RE.test(username)) return null;
    var id = String(o.id);
    var s = o.stats || {};
    var s2 = o.statsV2 || {};
    var video = o.video && typeof o.video === 'object' ? o.video : {};
    var photo = o.imagePost && Array.isArray(o.imagePost.images) && o.imagePost.images.length ? o.imagePost : null;
    var caption = typeof o.desc === 'string' ? o.desc : '';
    var cover = urlOf(video.cover) || urlOf(video.originCover) || urlOf(video.dynamicCover) ||
      (photo ? urlOf(getPath(photo, ['cover', 'imageURL', 'urlList'])) || urlOf(getPath(photo, ['images', 0, 'imageURL', 'urlList'])) : null);
    var files = [];
    if (photo) {
      photo.images.forEach(function (img) { var u = urlOf(getPath(img, ['imageURL', 'urlList'])); if (u) files.push({ kind: 'image', url: u }); });
    } else {
      var vids = videoUrls(video);
      if (vids.length) files.push(vids.length > 1 ? { kind: 'video', url: vids[0], alt: vids.slice(1, 4) } : { kind: 'video', url: vids[0] });
    }
    var duration = num(video.duration);
    var created = num(o.createTime);
    return {
      code: id,
      platform: 'tiktok',
      url: 'https://www.tiktok.com/@' + username + '/' + (photo ? 'photo' : 'video') + '/' + id,
      owner: ttId(username),
      author: username,
      ownerId: a.id != null && /^\d+$/.test(String(a.id)) ? String(a.id) : null,
      ownerName: str(a.nickname),
      ownerPic: urlOf(a.avatarThumb) || urlOf(a.avatarMedium) || null,
      type: photo ? 'carousel' : 'video',
      takenAt: created ? created * 1000 : null,
      views: maxNum(s.playCount, s2.playCount),
      likes: maxNum(s.diggCount, s2.diggCount),
      comments: maxNum(s.commentCount, s2.commentCount),
      shares: maxNum(s.shareCount, s2.shareCount),
      saves: maxNum(s.collectCount, s2.collectCount),
      reposts: maxNum(s.repostCount, s2.repostCount),
      duration: duration > 0 ? duration : null,
      caption: caption.length > CAPTION_MAX ? caption.slice(0, CAPTION_MAX) + '…' : caption,
      hashtags: hashtagsOf(o, caption),
      audio: audioOf(o),
      pinned: o.isPinnedItem === true || o.is_pinned === true,
      paidPartnership: o.isPaidPartnership === true,
      promoted: o.isAd === true || o.is_ad === true,
      thumb: cover,
      files: files,
      seenAt: Date.now()
    };
  }

  /** Walk any JSON value and collect every TikTok item found. */
  function collect(value, out, depth, authors) {
    out = out || [];
    depth = depth || 0;
    if (depth > 40 || value == null || typeof value !== 'object') return out;
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) collect(value[i], out, depth + 1, authors);
      return out;
    }
    var item = parseItem(value, authors);
    if (item) { out.push(item); return out; }
    for (var k in value) {
      if (Object.prototype.hasOwnProperty.call(value, k)) collect(value[k], out, depth + 1, authors);
    }
    return out;
  }

  /** Legacy SIGI_STATE keeps authors in UserModule.users and items in ItemModule (author = uniqueId string). */
  function authorsOf(json) {
    var users = getPath(json, ['UserModule', 'users']);
    if (!users || typeof users !== 'object') return null;
    var out = {};
    Object.keys(users).forEach(function (k) { var u = users[k]; if (u && u.uniqueId) out[u.uniqueId] = u; });
    return out;
  }

  /** Items from a parsed JSON value; duplicates (same id seen twice) are merged. */
  function itemsFrom(json) {
    var list = collect(json, [], 0, authorsOf(json));
    var byId = {};
    var order = [];
    list.forEach(function (p) {
      if (!byId[p.code]) order.push(p.code);
      byId[p.code] = merge(byId[p.code], p);
    });
    return order.map(function (id) { return byId[id]; });
  }

  /** Parse a raw response body or an SSR script's text. */
  function parseText(text) {
    if (typeof text !== 'string' || !text) return [];
    try {
      return itemsFrom(JSON.parse(text));
    } catch (e) {
      var out = [];
      text.split('\n').forEach(function (line) {
        line = line.trim();
        if (!line || (line[0] !== '{' && line[0] !== '[')) return;
        try { out = out.concat(itemsFrom(JSON.parse(line))); } catch (e2) { /* skip */ }
      });
      return out;
    }
  }

  /**
   * Profile facts from the SSR blob's user-detail scope (or legacy UserModule):
   * { username, nickname, followers, videos, likes, avatar } or null.
   */
  function parseUser(json) {
    var info = getPath(json, ['__DEFAULT_SCOPE__', 'webapp.user-detail', 'userInfo']);
    var u = info && info.user;
    var st = info && (info.statsV2 || info.stats);
    if (!u) {
      var users = getPath(json, ['UserModule', 'users']);
      var first = users && Object.keys(users)[0];
      if (!first) return null;
      u = users[first];
      st = getPath(json, ['UserModule', 'stats', first]);
    }
    if (!u || !u.uniqueId) return null;
    return {
      username: String(u.uniqueId).toLowerCase(),
      nickname: str(u.nickname),
      followers: st ? num(st.followerCount) : null,
      videos: st ? num(st.videoCount) : null,
      likes: st ? maxNum(st.heartCount, st.heart) : null,
      avatar: urlOf(u.avatarThumb) || urlOf(u.avatarMedium) || null
    };
  }

  // Paths that are not profiles: tiktok.com/foryou, /explore, /search … (profiles always start with "@").
  /**
   * What the current page is about.
   * → { kind: 'profile'|'video'|'other', username, id: 'tt/<name>' | null, video: '<item id>' | null }
   */
  function pageContext(pathname) {
    var path = String(pathname || '');
    var m = path.match(/^\/@([^/?#]+)(?:\/(video|photo)\/(\d{8,25}))?/);
    if (!m) return { kind: 'other', username: null, id: null, video: null };
    var name;
    try { name = decodeURIComponent(m[1]).toLowerCase(); } catch (e) { name = m[1].toLowerCase(); }
    if (!USER_RE.test(name)) return { kind: 'other', username: null, id: null, video: null };
    return { kind: m[3] ? 'video' : 'profile', username: name, id: ttId(name), video: m[3] || null };
  }

  /** Merge a fresh record into a stored one: keep the higher counts, fill gaps, newest links win. */
  function merge(prev, next) {
    if (!prev) return next;
    var out = {};
    var k;
    for (k in prev) out[k] = prev[k];
    for (k in next) {
      var a = prev[k];
      var b = next[k];
      if (b === null || b === undefined || b === '' || (Array.isArray(b) && b.length === 0)) continue;
      if (typeof a === 'number' && typeof b === 'number') out[k] = k === 'duration' ? b : Math.max(a, b);
      else if (k === 'pinned' || k === 'detailed') out[k] = Boolean(a) || Boolean(b);
      else out[k] = b;
    }
    return out;
  }

  function mergePostMaps(base, extra) {
    var out = {};
    var k;
    for (k in base || {}) out[k] = base[k];
    for (k in extra || {}) out[k] = merge(out[k], extra[k]);
    return out;
  }

  /** Pull the video id out of a TikTok URL or a bare id. */
  function videoIdOf(s) {
    var t = String(s || '').trim();
    var m = t.match(/tiktok\.com\/@[^/]+\/(?:video|photo)\/(\d{8,25})/i) || t.match(/^(\d{8,25})$/);
    return m ? m[1] : null;
  }

  /** Expiry of a TikTok CDN link (x-expires / expire query parameter, unix seconds), or null. */
  function linkExpiry(url) {
    try {
      var q = new URL(url).searchParams;
      var v = q.get('x-expires') || q.get('expire');
      return v && /^\d{9,11}$/.test(v) ? Number(v) * 1000 : null;
    } catch (e) { return null; }
  }

  return {
    SSR_IDS: SSR_IDS,
    ttId: ttId,
    isTikTokId: isTikTokId,
    label: label,
    parseItem: parseItem,
    parseText: parseText,
    itemsFrom: itemsFrom,
    parseUser: parseUser,
    pageContext: pageContext,
    merge: merge,
    mergePostMaps: mergePostMaps,
    videoIdOf: videoIdOf,
    linkExpiry: linkExpiry
  };
});
