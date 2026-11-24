// OpenOutlier Library – the filters on the cross-account "Top posts" view (docs/x-plan.md 2.3):
// minimum × median (≥2× / ≥5× / ≥10×), the author's follower range, format and date range.
// Pure functions, no DOM or chrome.* access, so they run in Node tests too.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpenOutlierTopFilters = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var THRESHOLDS = [0, 2, 5, 10];
  var DAYS = [0, 7, 30, 90];
  var DAY_MS = 864e5;
  // Post types across platforms (Instagram, TikTok, YouTube, Reddit, X); the same word is one format.
  var FORMAT_NAMES = {
    reel: 'Reels', video: 'Video', short: 'Shorts', live: 'Live', stream: 'Live', carousel: 'Carousel', photo: 'Photo',
    text: 'Text', image: 'Image', thread: 'Thread', article: 'Article', link: 'Link', quote: 'Quote',
    gallery: 'Gallery', poll: 'Poll', crosspost: 'Crosspost'
  };
  var DEFAULTS = { min: 0, fmin: null, fmax: null, format: '', days: 0 };

  /** "12k", "1.5M", "2,000", "850" → a number; anything else (or empty) → null. */
  function parseCount(s) {
    if (typeof s === 'number') return isFinite(s) && s >= 0 ? s : null;
    var t = String(s == null ? '' : s).trim().toLowerCase().replace(/[\s,_]/g, '');
    var m = t.match(/^(\d+(?:\.\d+)?)([km]?)$/);
    if (!m) return null;
    var n = Number(m[1]) * (m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1);
    return Math.round(n);
  }

  /** A saved or partial filter → a complete, valid one. */
  function normalize(f) {
    f = f && typeof f === 'object' ? f : {};
    var out = {
      min: THRESHOLDS.indexOf(Number(f.min)) !== -1 ? Number(f.min) : 0,
      fmin: parseCount(f.fmin),
      fmax: parseCount(f.fmax),
      format: typeof f.format === 'string' ? f.format.slice(0, 30) : '',
      days: DAYS.indexOf(Number(f.days)) !== -1 ? Number(f.days) : 0
    };
    if (out.fmin !== null && out.fmax !== null && out.fmin > out.fmax) { var t = out.fmin; out.fmin = out.fmax; out.fmax = t; }
    return out;
  }
  function isActive(f) {
    f = normalize(f);
    return f.min > 0 || f.fmin !== null || f.fmax !== null || !!f.format || f.days > 0;
  }

  function formatKey(p) { return String((p && p.type) || 'post'); }
  function formatName(key) { return FORMAT_NAMES[key] || key.charAt(0).toUpperCase() + key.slice(1); }
  /** The formats present in a list → [{ key, label, count }], most common first. */
  function formatsOf(posts) {
    var n = {};
    posts.forEach(function (p) { var k = formatKey(p); n[k] = (n[k] || 0) + 1; });
    return Object.keys(n).map(function (k) { return { key: k, label: formatName(k), count: n[k] }; })
      .sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label); });
  }

  /**
   * Apply a filter. opts.followersOf(post) → the author's followers (or null when unknown); opts.now (ms).
   * → { list, hiddenNoFollowers (posts left out only because their author's followers are unknown),
   *     hiddenNoDate (left out only because they have no date) }
   */
  function apply(posts, f, opts) {
    f = normalize(f);
    var now = (opts && opts.now) || Date.now();
    var followersOf = (opts && opts.followersOf) || function (p) { return p.ownerFollowers; };
    var since = f.days ? now - f.days * DAY_MS : null;
    var range = f.fmin !== null || f.fmax !== null;
    var noFollowers = 0;
    var noDate = 0;
    var list = posts.filter(function (p) {
      if (f.min && !(p.ratio != null && p.ratio >= f.min)) return false;
      if (f.format && formatKey(p) !== f.format) return false;
      if (since !== null && !p.takenAt) { noDate++; return false; }
      if (since !== null && p.takenAt < since) return false;
      if (range) {
        var n = followersOf(p);
        if (typeof n !== 'number' || !isFinite(n)) { noFollowers++; return false; }
        if (f.fmin !== null && n < f.fmin) return false;
        if (f.fmax !== null && n > f.fmax) return false;
      }
      return true;
    });
    return { list: list, hiddenNoFollowers: noFollowers, hiddenNoDate: noDate };
  }

  return {
    THRESHOLDS: THRESHOLDS,
    DAYS: DAYS,
    DEFAULTS: DEFAULTS,
    FORMAT_NAMES: FORMAT_NAMES,
    parseCount: parseCount,
    normalize: normalize,
    isActive: isActive,
    formatKey: formatKey,
    formatName: formatName,
    formatsOf: formatsOf,
    apply: apply
  };
});
