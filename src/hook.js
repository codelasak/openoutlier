// OpenOutlier – page hook (runs in the page's MAIN world at document_start).
//
// Instagram and TikTok load profile videos through their own API calls. This
// script listens to those responses as they arrive and forwards the raw JSON
// text to the extension's content script via window.postMessage.
//
// It never makes requests of its own, never changes a request or response,
// and only forwards responses from the site's data endpoints that look like
// they contain posts. All parsing happens in the isolated content script.
//
// TikTok: /api/post/item_list, /api/item/detail, /api/repost/item_list,
// /api/recommend/item_list, /api/search/…, /api/related/item_list … (any
// /api/ response that carries video items). TikTok signs these requests, so
// OpenOutlier never replays them; it only reads what the page already got.
//
// YouTube: /youtubei/v1/browse (channel tabs, home, subscriptions and their continuations), search,
// get_watch (in-app clicks on a video: [playerResponse, watchNextResponse]),
// player, next (also the comments as they load), reel/reel_item_watch and reel/reel_watch_sequence
// (Shorts), and /api/timedtext (the captions the player loads when CC is on: the transcript fallback).
// They all go through fetch, so this must stay at document_start.
//
// X (x.com): /i/api/graphql/<queryId>/<Operation> (UserOriginalsTimeline, HomeTimeline, TweetDetail,
// SearchTimeline, UserByScreenName, the analytics queries …). Query ids change weekly, so only the
// path shape is matched here; src/x.js picks operations by name. X answers with XHR. Its
// x-rate-limit-limit / -remaining / -reset headers ride along with each payload, and every
// GraphQL response (also a 429 without posts) sends a small 'ratelimit' message, so the slow
// auto-scroll can stop before X starts refusing.
(function () {
  'use strict';
  if (window.__reelscopeHooked) return;
  window.__reelscopeHooked = true;

  // window.__reelscopeSite lets dev/tiktok-demo.html and dev/youtube-demo.html (served from localhost) pick a site.
  var TIKTOK = /(^|\.)tiktok\.com$/.test(location.hostname) || window.__reelscopeSite === 'tiktok';
  var YOUTUBE = /(^|\.)youtube\.com$/.test(location.hostname) || window.__reelscopeSite === 'youtube';
  var XCOM = /(^|\.)(x|twitter)\.com$/.test(location.hostname) || window.__reelscopeSite === 'x';
  var URL_RE = XCOM
    ? /\/i\/api\/graphql\/[^/?]+\/[A-Za-z]+/
    : YOUTUBE
    ? /\/youtubei\/v1\/(browse|next|player|get_watch|search|reel\/reel_item_watch|reel\/reel_watch_sequence)(\?|$)|\/api\/timedtext\?/
    : TIKTOK
      ? /\/api\/(?!comment\/|im\/|user\/(?!detail)|notice\/|upload\/|report|ba\/|v1\/web\/report)/
      : /\/graphql|\/api\/v1\//;
  var MAX_BYTES = 15 * 1024 * 1024;

  function looksUseful(text) {
    // X: a post or user object always has a rest_id; analytics carry current_time_series / tweets_results.
    if (XCOM) return text.indexOf('"rest_id"') !== -1 && (text.indexOf('"tweet_results"') !== -1 || text.indexOf('"user_results"') !== -1 ||
      text.indexOf('"tweetResult"') !== -1 || text.indexOf('"screen_name"') !== -1 || text.indexOf('"current_time_series"') !== -1 || text.indexOf('"tweets_results"') !== -1);
    // Cheap pre-filter. Instagram media objects always carry a shortcode ("code");
    // TikTok video items always carry createTime and a stats block.
    // YouTube: every useful response names a videoId (watch, Shorts) or a contentId (grid lockups).
    // Comments (phase 4's comment tools) and the captions the player loads (its transcript fallback) too.
    if (YOUTUBE) return text.indexOf('"videoId"') !== -1 || text.indexOf('"contentId"') !== -1 || text.indexOf('"commentEntityPayload"') !== -1 ||
      text.indexOf('"commentRenderer"') !== -1 || (text.indexOf('"wireMagic"') !== -1 && text.indexOf('"events"') !== -1) || text.indexOf('<timedtext') !== -1 || text.indexOf('<transcript') !== -1;
    if (TIKTOK) return text.indexOf('"createTime"') !== -1 && (text.indexOf('"stats"') !== -1 || text.indexOf('"statsV2"') !== -1);
    // Profile facts (followers, posts on the profile) ride on responses that may list no posts.
    return text.indexOf('"code"') !== -1 || text.indexOf('"shortcode"') !== -1 ||
      text.indexOf('"edge_followed_by"') !== -1 || text.indexOf('"follower_count"') !== -1;
  }

  function forward(url, text, rl) {
    if (typeof text !== 'string' || text.length > MAX_BYTES || !looksUseful(text)) return;
    var msg = { __reelscope: 1, type: 'payload', url: String(url), text: text };
    if (rl) msg.rateLimit = rl;
    window.postMessage(msg, window.location.origin);
  }

  /** X: the rate-limit headers of a response (null when there are none). get(name) reads one header. */
  function rateHeaders(get) {
    try {
      var rl = { limit: get('x-rate-limit-limit'), remaining: get('x-rate-limit-remaining'), reset: get('x-rate-limit-reset') };
      return rl.limit == null && rl.remaining == null && rl.reset == null ? null : rl;
    } catch (e) { return null; }
  }
  function forwardRate(url, status, rl) {
    if (!XCOM || (!rl && status !== 429)) return;
    window.postMessage({ __reelscope: 1, type: 'ratelimit', url: String(url), status: status, rateLimit: rl }, window.location.origin);
  }

  function urlOf(input) {
    try {
      if (typeof input === 'string') return input;
      if (input && typeof input.url === 'string') return input.url;
      return String(input);
    } catch (e) {
      return '';
    }
  }

  // fetch
  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input) {
      var p = origFetch.apply(this, arguments);
      var url = urlOf(input);
      if (URL_RE.test(url)) {
        p.then(function (res) {
          try {
            var rl = XCOM ? rateHeaders(function (n) { return res.headers.get(n); }) : null;
            forwardRate(url, res.status, rl);
            var ct = res.headers.get('content-type') || '';
            if (ct && ct.indexOf('json') === -1 && ct.indexOf('javascript') === -1 && ct.indexOf('text') === -1) return;
            res.clone().text().then(function (t) { forward(url, t, rl); }, function () {});
          } catch (e) { /* ignore */ }
        }, function () {});
      }
      return p;
    };
  }

  // X is a single-page app with no navigation event of its own: tell the content script when
  // the page's router changes the URL (popstate covers back/forward there).
  if (XCOM && window.history && typeof window.history.pushState === 'function') {
    ['pushState', 'replaceState'].forEach(function (name) {
      var orig = window.history[name];
      window.history[name] = function () {
        var r = orig.apply(this, arguments);
        try { window.postMessage({ __reelscope: 1, type: 'nav', path: String(window.location.pathname) }, window.location.origin); } catch (e) { /* ignore */ }
        return r;
      };
    });
  }

  // XMLHttpRequest
  var XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    var origOpen = XHR.prototype.open;
    var origSend = XHR.prototype.send;
    XHR.prototype.open = function (method, url) {
      try { this.__reelscopeUrl = urlOf(url); } catch (e) { /* ignore */ }
      return origOpen.apply(this, arguments);
    };
    XHR.prototype.send = function () {
      var xhr = this;
      if (xhr.__reelscopeUrl && URL_RE.test(xhr.__reelscopeUrl)) {
        xhr.addEventListener('load', function () {
          try {
            var rl = XCOM ? rateHeaders(function (n) { return xhr.getResponseHeader(n); }) : null;
            forwardRate(xhr.__reelscopeUrl, xhr.status, rl);
            if (xhr.responseType === '' || xhr.responseType === 'text') forward(xhr.__reelscopeUrl, xhr.responseText, rl);
            else if (xhr.responseType === 'json' && xhr.response) forward(xhr.__reelscopeUrl, JSON.stringify(xhr.response), rl);
          } catch (e) { /* ignore */ }
        });
      }
      return origSend.apply(this, arguments);
    };
  }
})();
