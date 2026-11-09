// OpenOutlier brand assets for the in-page panel and overlay.
//
// The panel lives in a Shadow DOM on instagram.com / tiktok.com / reddit.com, so:
// - fonts: @font-face does not work inside a shadow root and the sites' CSP may block
//   remote fonts, so the bundled woff2 files are fetched from the extension and
//   registered on the page's document with the FontFace API (namespaced family names).
// - logos: the approved files in brand/v2 are fetched as text and inserted as inline
//   SVG (unchanged), which no page CSP can block. Extension pages fall back to <img>.
(function (root) {
  'use strict';

  var LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
  var LATIN_EXT = 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF';
  var FONTS = [
    ['OpenOutlier Display', 'fonts/fraunces-900-latin.woff2', '900', LATIN],
    ['OpenOutlier Display', 'fonts/fraunces-900-latin-ext.woff2', '900', LATIN_EXT],
    ['OpenOutlier Sans', 'fonts/intertight-latin.woff2', '400 700', LATIN],
    ['OpenOutlier Sans', 'fonts/intertight-latin-ext.woff2', '400 700', LATIN_EXT]
  ];
  var LOGOS = {
    // Paper text + lime trail, no background: for Signal Blue or Ink grounds only.
    wordmark: 'brand/v2/wordmark/openoutlier-inline-trail3-transparent.svg',
    // The Pixel O with its trail; counter filled blue (for blue grounds) or ink (for ink grounds).
    mark: 'brand/v2/mark/openoutlier-mark.svg',
    markInk: 'brand/v2/mark/openoutlier-mark-on-ink.svg'
  };

  var parsed = {};
  var loading = null;

  function url(path) {
    try { return chrome.runtime.getURL(path); } catch (e) { return '../' + path; }
  }

  function loadFonts() {
    if (!root.FontFace || !root.document || !document.fonts) return Promise.resolve();
    if (document.documentElement && document.documentElement.hasAttribute('data-openoutlier-fonts')) return Promise.resolve();
    if (document.documentElement) document.documentElement.setAttribute('data-openoutlier-fonts', '');
    return Promise.all(FONTS.map(function (f) {
      return fetch(url(f[1])).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
        var face = new FontFace(f[0], buf, { weight: f[2], style: 'normal', unicodeRange: f[3], display: 'swap' });
        return face.load().then(function () { document.fonts.add(face); });
      }).catch(function () { /* system fonts stay as fallback */ });
    }));
  }

  function loadLogos() {
    return Promise.all(Object.keys(LOGOS).map(function (k) {
      return fetch(url(LOGOS[k])).then(function (r) { return r.text(); }).then(function (txt) {
        var doc = new DOMParser().parseFromString(txt, 'image/svg+xml');
        var svg = doc.documentElement;
        if (svg && svg.nodeName.toLowerCase() === 'svg' && !doc.querySelector('parsererror, script, foreignObject')) parsed[k] = svg;
      }).catch(function () { /* falls back to <img> */ });
    }));
  }

  /**
   * load({ fonts: true }) → Promise (resolves once the logos are ready). Call before creating the
   * panel; safe to call again.
   * Extension pages (Library, popup) declare the fonts in fonts/fonts.css and pass fonts: false.
   */
  function load(opts) {
    if (!loading) {
      // Fonts load in the background (system fonts until then); the logos are awaited
      // so the panel never renders without its wordmark.
      if (!opts || opts.fonts !== false) loadFonts();
      loading = loadLogos();
    }
    return loading;
  }

  /** A fresh logo element: inline SVG when loaded, else <img>. name = wordmark | mark | markInk. */
  function logo(name, className, label) {
    var el;
    if (parsed[name]) {
      el = document.importNode(parsed[name], true);
      el.removeAttribute('width');
      el.removeAttribute('height');
      el.removeAttribute('style');
      el.setAttribute('focusable', 'false');
      if (label) { el.setAttribute('role', 'img'); el.setAttribute('aria-label', label); }
      else { el.setAttribute('aria-hidden', 'true'); el.removeAttribute('role'); }
      var t = el.querySelector('title');
      if (t && !label) t.remove();
    } else {
      el = document.createElement('img');
      el.src = url(LOGOS[name]);
      el.alt = label || '';
    }
    el.setAttribute('class', className || '');
    return el;
  }

  root.OpenOutlierBrand = { load: load, logo: logo, LOGOS: LOGOS, FONTS: FONTS };
})(typeof self !== 'undefined' ? self : this);
