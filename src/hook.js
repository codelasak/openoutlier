// ReelScope – page hook (runs in the page's MAIN world at document_start).
//
// Instagram loads profile reels through its own GraphQL / REST calls. This
// script listens to those responses as they arrive and forwards the raw JSON
// text to the extension's content script via window.postMessage.
//
// It never makes requests of its own, never changes a request or response,
// and only forwards responses from Instagram's data endpoints that look like
// they contain posts. All parsing happens in the isolated content script.
(function () {
  'use strict';
  if (window.__reelscopeHooked) return;
  window.__reelscopeHooked = true;

  var URL_RE = /\/graphql|\/api\/v1\//;
  var MAX_BYTES = 15 * 1024 * 1024;

  function forward(url, text) {
    if (typeof text !== 'string' || text.length > MAX_BYTES) return;
    // Cheap pre-filter: media objects always carry a shortcode ("code").
    if (text.indexOf('"code"') === -1 && text.indexOf('"shortcode"') === -1) return;
    window.postMessage({ __reelscope: 1, type: 'payload', url: String(url), text: text }, window.location.origin);
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
            var ct = res.headers.get('content-type') || '';
            if (ct && ct.indexOf('json') === -1 && ct.indexOf('javascript') === -1 && ct.indexOf('text') === -1) return;
            res.clone().text().then(function (t) { forward(url, t); }, function () {});
          } catch (e) { /* ignore */ }
        }, function () {});
      }
      return p;
    };
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
            if (xhr.responseType === '' || xhr.responseType === 'text') forward(xhr.__reelscopeUrl, xhr.responseText);
            else if (xhr.responseType === 'json' && xhr.response) forward(xhr.__reelscopeUrl, JSON.stringify(xhr.response));
          } catch (e) { /* ignore */ }
        });
      }
      return origSend.apply(this, arguments);
    };
  }
})();
