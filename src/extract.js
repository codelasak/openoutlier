// OpenOutlier – turn Instagram JSON into normalized post records.
// Pure functions, no DOM or chrome.* access, so they run in Node tests too.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReelScopeExtract = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CODE_RE = /^[A-Za-z0-9_-]{5,64}$/;
  var CAPTION_MAX = 600;
  // Instagram has renamed the view counter several times. Order = preference.
  var VIEW_FIELDS = ['play_count', 'ig_play_count', 'view_count', 'video_view_count', 'video_play_count', 'fb_play_count'];

  function num(v) {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
    return null;
  }

  function firstPositive(obj, fields) {
    var zero = null;
    for (var i = 0; i < fields.length; i++) {
      var n = num(obj[fields[i]]);
      if (n === null) continue;
      if (n > 0) return n;
      zero = 0;
    }
    return zero;
  }

  function getPath(obj, path) {
    var cur = obj;
    for (var i = 0; i < path.length; i++) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[path[i]];
    }
    return cur;
  }

  function nonEmptyArray(v) {
    return Array.isArray(v) && v.length > 0;
  }

  function captionOf(o) {
    if (typeof o.caption === 'string') return o.caption;
    if (o.caption && typeof o.caption.text === 'string') return o.caption.text;
    var edge = getPath(o, ['edge_media_to_caption', 'edges', 0, 'node', 'text']);
    return typeof edge === 'string' ? edge : '';
  }

  function hashtagsOf(caption) {
    var out = [];
    var seen = {};
    var re = /#([\p{L}\p{N}_]+)/gu;
    var m;
    while ((m = re.exec(caption))) {
      var tag = m[1].toLowerCase();
      if (!seen[tag]) { seen[tag] = true; out.push(tag); }
    }
    return out;
  }

  function audioOf(o) {
    var cm = o.clips_metadata;
    if (!cm || typeof cm !== 'object') return null;
    var music = getPath(cm, ['music_info', 'music_asset_info']);
    if (music && (music.title || music.display_artist)) {
      return { kind: 'music', title: String(music.title || ''), artist: String(music.display_artist || '') };
    }
    var orig = cm.original_sound_info;
    if (orig && typeof orig === 'object') {
      return {
        kind: 'original',
        title: String(orig.original_audio_title || 'Original audio'),
        artist: String(getPath(orig, ['ig_artist', 'username']) || '')
      };
    }
    return null;
  }

  function typeOf(o) {
    var mt = num(o.media_type);
    if (o.product_type === 'clips') return 'reel';
    if (mt === 8 || o.product_type === 'carousel_container' || o.__typename === 'GraphSidecar' || o.__typename === 'XDTGraphSidecar' || num(o.carousel_media_count) > 0) return 'carousel';
    if (mt === 2 || o.is_video === true || num(o.video_duration) > 0) return 'video';
    if (mt === 1 || o.__typename === 'GraphImage' || o.__typename === 'XDTGraphImage') return 'photo';
    return 'unknown';
  }

  function bestImage(o) {
    return getPath(o, ['image_versions2', 'candidates', 0, 'url']) || o.display_url || null;
  }

  function bestVideo(o) {
    return getPath(o, ['video_versions', 0, 'url']) || o.video_url || null;
  }

  /** Downloadable files of a post: [{ kind: 'video'|'image', url }] (CDN links, they expire after a few days). */
  function filesOf(o) {
    var children = Array.isArray(o.carousel_media)
      ? o.carousel_media
      : (getPath(o, ['edge_sidecar_to_children', 'edges']) || []).map(function (e) { return e && e.node; });
    var items = children.length ? children : [o];
    var out = [];
    items.forEach(function (c) {
      if (!c || typeof c !== 'object') return;
      var v = bestVideo(c);
      if (typeof v === 'string') { out.push({ kind: 'video', url: v }); return; }
      // A video whose link hasn't loaded yet: don't save its cover as "the video".
      var isVid = num(c.media_type) === 2 || c.product_type === 'clips' || c.is_video === true || num(c.video_duration) > 0;
      var img = bestImage(c);
      if (!isVid && typeof img === 'string') out.push({ kind: 'image', url: img });
    });
    return out;
  }

  function looksLikeMedia(o) {
    return (
      o.taken_at != null ||
      o.taken_at_timestamp != null ||
      o.media_type != null ||
      o.product_type != null ||
      (typeof o.__typename === 'string' && /Graph(Image|Video|Sidecar)|XDTMedia/.test(o.__typename))
    );
  }

  /** Normalize one Instagram media object, or return null if it is not one. */
  function parseMedia(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    var code = typeof o.code === 'string' ? o.code : (typeof o.shortcode === 'string' ? o.shortcode : null);
    if (!code || !CODE_RE.test(code) || !looksLikeMedia(o)) return null;

    var type = typeOf(o);
    var takenAt = num(o.taken_at) || num(o.taken_at_timestamp);
    var countsHidden = o.like_and_view_counts_disabled === true;

    var likes = firstPositive(o, ['like_count', 'fb_like_count']);
    if (likes === null) likes = num(getPath(o, ['edge_media_preview_like', 'count'])) ?? num(getPath(o, ['edge_liked_by', 'count']));
    var comments = firstPositive(o, ['comment_count', 'fb_comment_count']);
    if (comments === null) comments = num(getPath(o, ['edge_media_to_comment', 'count']));

    var caption = captionOf(o);
    var owner = getPath(o, ['user', 'username']) || getPath(o, ['owner', 'username']) || null;
    var thumb =
      getPath(o, ['image_versions2', 'candidates', 0, 'url']) ||
      o.display_url ||
      o.thumbnail_src ||
      null;

    var pk = o.pk != null && /^\d+$/.test(String(o.pk)) ? String(o.pk)
      : (typeof o.id === 'string' && /^\d+(_\d+)?$/.test(o.id) ? o.id.split('_')[0] : null);

    return {
      code: code,
      pk: pk,
      url:'https://www.instagram.com/' + (type === 'reel' ? 'reel' : 'p') + '/' + code + '/',
      owner: owner ? String(owner).toLowerCase() : null,
      ownerId: (function (id) { return id != null && /^\d+$/.test(String(id)) ? String(id) : null; })(getPath(o, ['user', 'pk']) || getPath(o, ['user', 'id']) || getPath(o, ['owner', 'id'])),
      ownerName: getPath(o, ['user', 'full_name']) || getPath(o, ['owner', 'full_name']) || null,
      ownerPic: getPath(o, ['user', 'profile_pic_url']) || getPath(o, ['owner', 'profile_pic_url']) || null,
      type: type,
      takenAt: takenAt ? takenAt * 1000 : null,
      views: firstPositive(o, VIEW_FIELDS),
      likes: countsHidden && !likes ? null : likes,
      comments: comments,
      shares: firstPositive(o, ['share_count', 'reshare_count']),
      saves: firstPositive(o, ['save_count']),
      duration: num(o.video_duration) ? Math.round(num(o.video_duration) * 10) / 10 : null,
      caption: caption.length > CAPTION_MAX ? caption.slice(0, CAPTION_MAX) + '…' : caption,
      hashtags: hashtagsOf(caption),
      audio: audioOf(o),
      pinned:
        nonEmptyArray(o.clips_tab_pinned_user_ids) ||
        nonEmptyArray(o.timeline_pinned_user_ids) ||
        o.is_pinned === true,
      paidPartnership: o.is_paid_partnership === true,
      thumb: typeof thumb === 'string' ? thumb : null,
      files: filesOf(o),
      seenAt: Date.now()
    };
  }

  /** Walk any JSON value and collect every media object found. */
  function collect(value, out, depth) {
    out = out || [];
    depth = depth || 0;
    if (depth > 60 || value == null || typeof value !== 'object') return out;
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) collect(value[i], out, depth + 1);
      return out;
    }
    var media = parseMedia(value);
    if (media) {
      out.push(media);
      return out; // don't descend into a post (avoids picking up nested/reshared items)
    }
    for (var k in value) {
      if (Object.prototype.hasOwnProperty.call(value, k)) collect(value[k], out, depth + 1);
    }
    return out;
  }

  /** Parse a raw response body. Handles `for (;;);` prefixes and line-delimited JSON. */
  function parseText(text) {
    if (typeof text !== 'string') return [];
    var body = text.replace(/^\s*for\s*\(;;\);/, '');
    try {
      return collect(JSON.parse(body));
    } catch (e) {
      var out = [];
      var lines = body.split('\n');
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line || (line[0] !== '{' && line[0] !== '[')) continue;
        try { collect(JSON.parse(line), out); } catch (e2) { /* skip */ }
      }
      return out;
    }
  }

  var ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  /** A shortcode is the media id written in base64. Returns the numeric id as a string. */
  function shortcodeToPk(code) {
    if (typeof code !== 'string' || !CODE_RE.test(code) || typeof BigInt !== 'function') return null;
    var s = code.length > 11 ? code.slice(0, 11) : code; // longer codes carry a suffix
    var n = BigInt(0);
    for (var i = 0; i < s.length; i++) {
      var v = ALPHABET.indexOf(s[i]);
      if (v < 0) return null;
      n = n * BigInt(64) + BigInt(v);
    }
    return n.toString();
  }

  /** Merge a fresh record into a stored one: keep the higher counts, fill gaps. */
  function merge(prev, next) {
    if (!prev) return next;
    var out = {};
    var k;
    for (k in prev) out[k] = prev[k];
    for (k in next) {
      var a = prev[k];
      var b = next[k];
      if (b === null || b === undefined || b === '' || (Array.isArray(b) && b.length === 0)) continue;
      if (typeof a === 'number' && typeof b === 'number') out[k] = Math.max(a, b);
      else if (k === 'type' && b === 'unknown') continue;
      else if (k === 'pinned' || k === 'paidPartnership' || k === 'detailed') out[k] = Boolean(a) || Boolean(b);
      else if (k === 'seenAt' && typeof a === 'number') out[k] = Math.max(a, b);
      else out[k] = b;
    }
    if (prev.type === 'reel' || next.type === 'reel') {
      out.type = 'reel';
      out.url = 'https://www.instagram.com/reel/' + out.code + '/';
    }
    return out;
  }

  /**
   * Merge two stored {code: post} maps post by post (merge(): counts keep their
   * max, gaps get filled). Used when another tab saved the same profile.
   */
  function mergePostMaps(base, extra) {
    var out = {};
    var k;
    for (k in base || {}) out[k] = base[k];
    for (k in extra || {}) out[k] = merge(out[k], extra[k]);
    return out;
  }

  return {
    mergePostMaps: mergePostMaps,
    parseMedia: parseMedia,
    collect: collect,
    parseText: parseText,
    merge: merge,
    hashtagsOf: hashtagsOf,
    filesOf: filesOf,
    shortcodeToPk: shortcodeToPk
  };
});
