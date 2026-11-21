// OpenOutlier – channel-similar's co-recommendation counts (docs/youtube-niche-plan.md 6.4a, phase 5).
//
// On a watch page YouTube's /next response (and the first page's ytInitialData) carries the watched
// video's channel and the "Up Next" sidebar. For each watched video, once per tab session, this
// sends the bridge the channel and the other channels in that sidebar; the bridge adds them to
// aggregated, decaying pair counts (mcp/discovery.mjs → co_recs). No video ids, titles or times
// leave the tab, and nothing is sent while channel-similar is off or without the bridge.
(function () {
  'use strict';
  if (window.top !== window || window.__openoutlierYTSimilar) return;
  window.__openoutlierYTSimilar = true;

  var Y = self.OpenOutlierYouTube;
  var FT = self.OpenOutlierFeatures;
  var DS = self.OpenOutlierDiscovery;
  if (!Y || !FT || !DS) return;

  var KEY = 'oo-corec-sent';
  var sent = {};
  try { sent = JSON.parse(sessionStorage.getItem(KEY) || '{}') || {}; } catch (e) { sent = {}; }
  var off = false; // the bridge said the feature is off or isn't there: stop asking this session

  function remember(id) {
    sent[id] = 1;
    var keys = Object.keys(sent);
    if (keys.length > 400) keys.slice(0, keys.length - 400).forEach(function (k) { delete sent[k]; });
    try { sessionStorage.setItem(KEY, JSON.stringify(sent)); } catch (e) { /* storage full */ }
  }

  /** A /next answer → { video, source, recs } (null when it isn't a watch page's first answer). */
  function fromNext(json) {
    var cur = json && json.currentVideoEndpoint && json.currentVideoEndpoint.watchEndpoint && json.currentVideoEndpoint.watchEndpoint.videoId;
    var side = json && json.contents && json.contents.twoColumnWatchNextResults && json.contents.twoColumnWatchNextResults.secondaryResults;
    if (!cur || !side) return null;
    var main = Y.parseNext(json, {});
    if (!main || !main.ownerId) return null;
    var cards = Y.parseCards(side, {}).filter(function (c) { return c.code !== cur; });
    var pairs = DS.coRecPairs(main.ownerId, cards);
    return pairs ? { video: cur, source: pairs.source, recs: pairs.recs } : null;
  }

  function take(json) {
    if (off || !FT.isOn('channel-similar')) return;
    var p = fromNext(json);
    if (!p || sent[p.video]) return;
    remember(p.video);
    try {
      chrome.runtime.sendMessage({ type: 'reelscope:discovery', what: 'corec', source: p.source, recs: p.recs }).then(function (r) {
        if (r && (r.off || r.noBridge || r.oldBridge)) off = true;
      }, function () {});
    } catch (e) { /* extension reloaded */ }
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window || !e.data || e.data.__reelscope !== 1 || e.data.type !== 'payload') return;
    var t = e.data.text;
    if (typeof t !== 'string' || t.indexOf('twoColumnWatchNextResults') === -1 || t.indexOf('currentVideoEndpoint') === -1) return;
    try { take(JSON.parse(t.replace(/^\)\]\}'\s*/, ''))); } catch (err) { /* not JSON */ }
  });

  // The first watch page of a tab comes inline (ytInitialData), not through /next.
  function scanInline() {
    if (!/^\/watch/.test(location.pathname)) return;
    document.querySelectorAll('script:not([src])').forEach(function (el) {
      var t = el.textContent;
      if (!t || t.length > 1.2e7 || t.indexOf('ytInitialData') === -1 || t.indexOf('twoColumnWatchNextResults') === -1) return;
      var data = Y.extractVar(t, 'ytInitialData');
      if (data) take(data);
    });
  }
  FT.ready.then(scanInline);
  FT.onChange(function (changed) { if (changed.indexOf('channel-similar') !== -1 && FT.isOn('channel-similar')) { off = false; scanInline(); } });

  self.OpenOutlierYTSimilar = { fromNext: fromNext };
})();
