// OpenOutlier – the pure part of the x.com draft strip (docs/x-plan.md 5.3, 5.4, 6; phases 4–6).
// UMD: self.OpenOutlierXCompose in the browser (src/x-compose-content.js uses it), require() in tests.
//
// What the strip shows is computed here from plain data, so it can be tested without a page:
//   stripModel(text, ctx, lang)  the LLM-free checks (src/x-composer.js checkDraft) as display rows
//   swipeTexts(org), recentTexts(pagePosts, feed), ownExamples(posts, M), premiumOf(profile)
//   replaceFirstLine(draft, hook), previewInfo(prep, lang), costLine(cost), forecastLine(f, lang)
// Nothing here sends, posts or calls anything.
'use strict';

(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpenOutlierXCompose = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  var C = root.OpenOutlierXComposer;
  if (!C && typeof require === 'function' && typeof module === 'object') { try { C = require('./x-composer.js'); } catch (e) { C = null; } }

  function textOf(x) { return String((x && (x.caption || x.text || x.title)) || '').trim(); }
  function num(n) { return n == null ? '?' : Number(n).toLocaleString('en-US'); }
  function usd(n) { return n == null || !isFinite(n) ? '$?' : '$' + (n < 0.01 ? n.toFixed(4) : n.toFixed(n < 1 ? 3 : 2)); }

  /** Swipe file texts (every platform) → [{ id, text, url, author }]. rs:org.swipe = { items: { id: item } }. */
  function swipeTexts(org) {
    var items = org && org.swipe && org.swipe.items ? org.swipe.items : {};
    return Object.keys(items).map(function (k) {
      var it = items[k] || {};
      var url = it.platform === 'x' && it.account && it.video ? 'https://x.com/' + String(it.account).slice(2) + '/status/' + it.video
        : it.platform === 'youtube' && it.video ? 'https://www.youtube.com/watch?v=' + it.video : null;
      return { id: 'swipe:' + k, text: String(it.title || '').trim(), url: url, author: it.channel || it.account || null };
    }).filter(function (x) { return x.text.length >= 20; });
  }

  /** Posts seen on this tab (OpenOutlierXApi.pagePosts()) and the recent-originals feed (rs:x:feed). Own posts excluded. */
  function recentTexts(pagePosts, feed, meId) {
    var seen = {};
    var out = [];
    function add(p) {
      if (!p || !p.code || seen[p.code] || p.kind === 'repost') return;
      if (meId && p.owner === meId) return;
      var t = textOf(p);
      if (t.length < 20) return;
      seen[p.code] = true;
      out.push({ id: p.code, text: t, url: p.url || (p.author ? 'https://x.com/' + p.author + '/status/' + p.code : null), author: p.author || null });
    }
    Object.keys(pagePosts || {}).forEach(function (k) { add(pagePosts[k]); });
    var fp = feed && feed.posts ? feed.posts : {};
    Object.keys(fp).forEach(function (k) { add(fp[k]); });
    return out.slice(-600);
  }

  /** The user's own outliers as LLM examples: originals at ≥ 2× their median, best first, up to 10. */
  function ownExamples(posts, M, limit) {
    if (!posts || !posts.length || !M) return [];
    return M.enrich(posts).filter(function (p) { return p.kind === 'original' && p.ratio != null && p.ratio >= 2 && textOf(p); })
      .sort(function (a, b) { return b.ratio - a.ratio; }).slice(0, limit || 10)
      .map(function (p) { return { text: textOf(p), x: Math.round(p.ratio * 10) / 10 }; });
  }

  /** Premium (long posts) from the own profile: true / false / null (unknown). */
  function premiumOf(profile) { return profile && typeof profile.blueVerified === 'boolean' ? profile.blueVerified : null; }

  var SEV_ICON = { error: '⛔', warn: '⚠', info: 'ℹ' };

  /**
   * text + ctx { swipe, recent, premium } → {
   *   empty, weighted, limit, remaining, over, hook: { visible, truncated, hidden, firstLine },
   *   findings: [{ id, severity, icon, text, url? }], ok }
   */
  function stripModel(text, ctx, lang) {
    lang = lang === 'tr' ? 'tr' : 'en';
    ctx = ctx || {};
    if (!C) return { empty: true, findings: [], error: 'x-composer.js is not loaded' };
    var r = C.checkDraft(text, { swipe: ctx.swipe || [], recent: ctx.recent || [], premium: ctx.premium == null ? null : ctx.premium });
    var limit = 280;
    var weighted = r.count.weighted;
    var findings = r.findings.filter(function (f) { return f.id !== 'empty'; }).map(function (f) {
      var o = { id: f.id, severity: f.severity, icon: SEV_ICON[f.severity] || '•', text: f[lang] || f.en };
      if (f.match && f.match.url) { o.url = f.match.url; o.author = f.match.author || null; }
      return o;
    });
    return {
      empty: !String(text || '').trim(),
      weighted: weighted,
      limit: limit,
      remaining: limit - weighted,
      over: weighted > limit,
      hook: { firstLine: r.hook.firstLine, visible: r.hook.visible, truncated: !!r.hook.truncated, hidden: r.hook.hidden },
      findings: findings,
      ok: r.ok
    };
  }

  /** The draft with its first line swapped for a new hook. */
  function replaceFirstLine(draft, hook) {
    var s = String(draft || '');
    var i = s.indexOf('\n');
    return String(hook || '').trim() + (i === -1 ? '' : s.slice(i));
  }

  /** A prepare answer → the lines shown before anything is sent. */
  function previewInfo(prep, lang) {
    var tr = lang === 'tr';
    var p = (prep && prep.preview) || {};
    var e = (prep && prep.estimate) || {};
    var s = (prep && prep.spend) || {};
    return {
      summary: tr
        ? num(p.chars) + ' karakter ' + (p.model || 'modele') + ' gönderilecek (' + (p.effort || '?') + ' effort). Tahmini ' + usd(e.usdTypical) + ', en fazla ' + usd(e.usdMax) + (e.approx ? ' (yaklaşık)' : '') + '.'
        : 'Sends ' + num(p.chars) + ' characters to ' + (p.model || 'the model') + ' (' + (p.effort || '?') + ' effort). About ' + usd(e.usdTypical) + ', at most ' + usd(e.usdMax) + (e.approx ? ' (approximate)' : '') + '.',
      spend: tr
        ? 'Bugün: ' + usd(s.todayUsd) + ' / ' + usd(s.capUsd) + ' günlük sınır, ' + (s.calls || 0) + ' çağrı.'
        : 'Today: ' + usd(s.todayUsd) + ' of the ' + usd(s.capUsd) + ' daily cap, ' + (s.calls || 0) + ' calls.',
      context: String(p.context || ''),
      system: String(p.system || ''),
      message: String(p.message || '')
    };
  }

  /** A confirm answer's cost → one line. */
  function costLine(cost, model) {
    if (!cost) return '';
    var t = cost.tokens || {};
    return 'Cost ' + usd(cost.usd) + (cost.approx ? ' (approx.)' : '') + ' · input ' + num(t.input) +
      (t.cacheRead ? ' (cache read ' + num(t.cacheRead) + ')' : '') + (t.cacheWrite ? ' (cache write ' + num(t.cacheWrite) + ')' : '') +
      ' · output ' + num(t.output) + ' tokens' + (model ? ' · ' + model : '');
  }

  /** forecastDraft's answer → a line, or null when it is not shown (the forecast didn't beat the median). */
  function forecastLine(f, lang) {
    if (!f || f.shown !== true) return null;
    var tr = lang === 'tr';
    var drivers = (f.drivers || []).map(function (d) { return (tr ? d.tr : d.en) + ' ×' + d.effect; }).join(', ');
    return (tr ? 'Erişim tahmini: ~' : 'Reach forecast: ~') + num(f.views) + (tr ? ' görüntülenme (' : ' views (') + num(f.low) + '–' + num(f.high) + ', ×' + f.ratio +
      (tr ? ' medyanın' : ' your median') + ')' + (drivers ? ' · ' + drivers : '');
  }

  return { stripModel: stripModel, swipeTexts: swipeTexts, recentTexts: recentTexts, ownExamples: ownExamples, premiumOf: premiumOf,
    replaceFirstLine: replaceFirstLine, previewInfo: previewInfo, costLine: costLine, forecastLine: forecastLine };
});
