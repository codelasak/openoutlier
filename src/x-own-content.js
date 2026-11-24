// OpenOutlier – X "My account" on x.com (docs/x-plan.md 3.2 and 3.5, Phase 2, feature x.own).
//
// Runs after src/x-content.js in the same isolated world and only reads chrome.storage (what
// x-content.js saved and src/x-own-bg.js merged). It never sends a request to X.
//   • First 2 hours: while one of the user's own originals is under 2 h old, a small card says how it
//     is doing against the user's own posts at the same age ("at minute 30 this post is at 1.8× your
//     usual views") — from the bridge's x_post_stats curve, else the local early series, else the
//     account's median post (marked) — and reminds to answer replies now. A measurement only happens
//     when x.com loads the post (the profile, the post page, Home), so the card says so.
//   • The post toolbar (x-content.js's .oo-x-bar on a post page): for a post under 48 h old, its pace
//     against that account's usual curve from x_post_stats ("at 3 h: 2.1× its usual pace, 9 posts").
//   • My X card on the own profile and on x.com/i/account_analytics: Original Content Rewards progress.
(async function () {
  'use strict';
  if (window.top !== window || window.__openoutlierXOwn) return;
  window.__openoutlierXOwn = true;

  var O = self.OpenOutlierXOwn;
  var X = self.OpenOutlierX;
  var M = self.ReelScopeMetrics;
  var FT = self.OpenOutlierFeatures;
  if (!O || !X || !M) return;
  var KEY_PREFIX = 'rs:p:';
  var TWO_H = 2 * 36e5;
  var CURVE_TTL = 10 * 60000;
  var HIDE_CARD = 'oo:x-own-card-hidden';

  try { await FT.ready; } catch (e) { /* defaults */ }
  function on() { try { return FT.isOn('x.own'); } catch (e) { return true; } }

  var st = { handle: O.DEFAULT_HANDLE, id: O.ownId(O.DEFAULT_HANDLE), record: null, history: null, early: {}, curves: {}, records: {} };

  async function load() {
    var r = await chrome.storage.local.get([O.OWN_KEY, O.HISTORY_KEY, O.EARLY_KEY]);
    st.handle = (r[O.OWN_KEY] && r[O.OWN_KEY].handle) || O.DEFAULT_HANDLE;
    st.id = O.ownId(st.handle);
    st.history = r[O.HISTORY_KEY] || null;
    st.early = r[O.EARLY_KEY] || {};
    st.record = (await chrome.storage.local.get(KEY_PREFIX + st.id))[KEY_PREFIX + st.id] || null;
  }
  try { await load(); } catch (e) { return; }

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    var hit = false;
    if (changes[O.OWN_KEY]) { load().then(render); return; }
    if (changes[O.HISTORY_KEY]) { st.history = changes[O.HISTORY_KEY].newValue || null; hit = true; }
    if (changes[O.EARLY_KEY]) { st.early = changes[O.EARLY_KEY].newValue || {}; hit = true; }
    if (changes[KEY_PREFIX + st.id]) { st.record = changes[KEY_PREFIX + st.id].newValue || null; hit = true; }
    Object.keys(changes).forEach(function (k) { if (st.records[k]) { st.records[k] = changes[k].newValue || null; hit = true; } });
    if (hit) schedule();
  });

  // ---- helpers ------------------------------------------------------------------------------
  function ownPosts() { return st.record && st.record.posts ? Object.values(st.record.posts) : []; }
  function fmt(n) { return n == null ? '—' : Math.round(n).toLocaleString('en-US'); }
  function x(r) { return (r >= 10 ? Math.round(r) : r.toFixed(1)) + '×'; }
  function age(min) { return min < 60 ? 'minute ' + min : (min / 60).toFixed(min < 600 ? 1 : 0).replace(/\.0$/, '') + ' h'; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  /** The bridge's curve for an account (cached), else for the own account the local early series. */
  function curveFor(account) {
    var c = st.curves[account];
    if (!c || Date.now() - c.at > CURVE_TTL) {
      st.curves[account] = { at: Date.now(), curve: c && c.curve || null, source: c && c.source || null };
      chrome.runtime.sendMessage({ type: 'reelscope:x-own', what: 'curve', account: account === st.id ? 'me' : account }).then(function (r) {
        if (r && r.ok && r.cps && Object.keys(r.cps).length) { st.curves[account] = { at: Date.now(), curve: { cps: r.cps, posts: r.posts }, source: 'bridge' }; schedule(); }
      }, function () {});
    }
    c = st.curves[account];
    if (c && c.curve) return c;
    if (account === st.id) {
      var local = O.earlyCurve(Object.keys(st.early).map(function (k) { return st.early[k]; }).filter(function (e) { return e.owner === st.id && e.kind === 'original' && Date.now() - e.takenAt > 36e5; }));
      if (Object.keys(local.cps).length) return { curve: local, source: 'local' };
    }
    return null;
  }

  function scoredOwn() { return M.enrich(ownPosts()); }

  // ---- style ------------------------------------------------------------------------------------
  function ensureStyle() {
    if (document.getElementById('oo-xo-style')) return;
    var s = document.createElement('style');
    s.id = 'oo-xo-style';
    s.textContent = [
      '.oo-xo-card{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:320px;max-width:calc(100vw - 32px);box-sizing:border-box;padding:12px 14px;border-radius:14px;',
      'background:#0d0d12;color:#f4f4f6;font:13px/1.4 system-ui,-apple-system,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.12)}',
      '.oo-xo-card.is-early{bottom:auto;top:72px}',
      '.oo-xo-card h4{margin:0 0 6px;font-size:13px;font-weight:700;display:flex;justify-content:space-between;align-items:center;gap:8px}',
      '.oo-xo-card .oo-xo-x{background:none;border:0;color:inherit;opacity:.7;cursor:pointer;font-size:16px;line-height:1;padding:0 2px}',
      '.oo-xo-big{font-size:20px;font-weight:700;color:#d4ff3a}',
      '.oo-xo-dim{opacity:.72;font-size:12px}',
      '.oo-xo-row{margin:8px 0 2px;display:flex;justify-content:space-between;gap:8px}',
      '.oo-xo-bar{height:6px;border-radius:3px;background:rgba(255,255,255,.14);overflow:hidden}',
      '.oo-xo-bar i{display:block;height:100%;background:#d4ff3a;min-width:2px}',
      '.oo-xo-card button.oo-xo-btn{margin-top:8px;font:inherit;color:inherit;background:transparent;border:1px solid rgba(255,255,255,.35);border-radius:999px;padding:3px 10px;cursor:pointer}',
      '.oo-xo-card a{color:#d4ff3a}',
      '.oo-x-pace{opacity:.85}'
    ].join('');
    (document.head || document.documentElement).appendChild(s);
  }

  // ---- first 2 hours -------------------------------------------------------------------------------
  function youngOwn() {
    var now = Date.now();
    return scoredOwn().filter(function (p) { return (p.kind || 'original') === 'original' && p.takenAt && now - p.takenAt < TWO_H && p.views != null; })
      .sort(function (a, b) { return b.takenAt - a.takenAt; })[0] || null;
  }

  function renderEarly() {
    var old = document.querySelector('.oo-xo-card.is-early');
    var p = on() ? youngOwn() : null;
    if (!p) { if (old) old.remove(); return; }
    var c = curveFor(st.id);
    var r = O.earlyRatio(p, c && c.curve, p.baseline, Date.now());
    var key = [p.code, p.views, r && r.ratio && r.ratio.toFixed(2)].join('|');
    if (old && old.getAttribute('data-k') === key) return;
    if (old) old.remove();
    ensureStyle();
    var card = el('div', 'oo-xo-card is-early');
    card.setAttribute('data-k', key);
    var h = el('h4');
    h.appendChild(el('span', '', 'OpenOutlier · your new post'));
    var close = el('button', 'oo-xo-x', '×');
    close.title = 'Hide until the next change';
    close.addEventListener('click', function () { card.remove(); });
    h.appendChild(close);
    card.appendChild(h);
    if (r) {
      var line = el('div');
      line.appendChild(document.createTextNode('At ' + age(r.ageMin) + ' this post is at '));
      line.appendChild(el('span', 'oo-xo-big', x(r.ratio)));
      line.appendChild(document.createTextNode(r.basis === 'curve' ? ' your usual views at this age' : ' your median post'));
      card.appendChild(line);
      card.appendChild(el('div', 'oo-xo-dim', fmt(p.views) + ' views now vs ' + fmt(r.expected) + (r.basis === 'curve'
        ? ' typical at this age (' + r.n + ' of your posts measured' + (c.source === 'local' ? ' in this browser' : '') + ').'
        : ' for your median ' + (p.type || 'text') + ' post at the end of its life (no early history yet, so this undersells a young post).')));
    } else card.appendChild(el('div', '', fmt(p.views) + ' views after ' + Math.round((Date.now() - p.takenAt) / 60000) + ' min. Not enough of your posts measured yet to compare.'));
    card.appendChild(el('div', 'oo-xo-row', ''));
    card.appendChild(el('div', '', 'Now: answer the replies as they come. In the first 2 hours X shows posts of accounts under 50K followers to extra people, and a reply back-and-forth (most of all with mutual follows) is one of the strongest signals.'));
    card.appendChild(el('div', 'oo-xo-dim', (p.comments || 0) + ' replies so far. OpenOutlier reads the count only when x.com loads this post: open it or your profile now and then.'));
    var open = el('button', 'oo-xo-btn', 'Open the post');
    open.addEventListener('click', function () { location.href = p.url; });
    card.appendChild(open);
    (document.body || document.documentElement).appendChild(card);
  }

  // ---- the post toolbar: pace vs the account's own curve -------------------------------------------------
  function recordOf(id) {
    var key = KEY_PREFIX + id;
    if (key === KEY_PREFIX + st.id) return st.record;
    if (!(key in st.records)) {
      st.records[key] = null;
      chrome.storage.local.get(key).then(function (r) { st.records[key] = r[key] || null; if (r[key]) schedule(); }, function () {});
    }
    return st.records[key];
  }

  function renderPace() {
    var c = X.pageContext(location.pathname);
    if (!on() || c.kind !== 'status' || !c.status) return;
    var bar = document.querySelector('.oo-x-bar');
    if (!bar) return;
    var rec = recordOf(c.id);
    var p = rec && rec.posts && rec.posts[c.status];
    if (!p || p.views == null || !p.takenAt || Date.now() - p.takenAt > 48 * 36e5 || (p.kind && p.kind !== 'original')) { var o = bar.querySelector('.oo-x-pace'); if (o) o.remove(); return; }
    var account = p.owner || c.id;
    var cv = curveFor(account);
    var r = cv && O.earlyRatio(p, cv.curve, null, Date.now());
    var text = r && r.basis === 'curve' ? 'at ' + age(r.ageMin) + ': ' + x(r.ratio) + ' ' + (account === st.id ? 'your' : 'its') + ' usual pace' : null;
    var span = bar.querySelector('.oo-x-pace');
    if (!text) { if (span) span.remove(); return; }
    if (span && span.textContent === text) return;
    if (!span) { span = el('span', 'oo-x-pace oo-x-dim'); var btn = bar.querySelector('button'); if (btn) bar.insertBefore(span, btn); else bar.appendChild(span); }
    span.textContent = text;
    span.title = 'Views now ÷ the median views of ' + r.n + ' of this account\'s posts at the same age (measured by OpenOutlier each time x.com loaded them; x_post_stats on the bridge).';
  }

  // ---- My X card (own profile, analytics page) ------------------------------------------------------------
  function hidden() { try { return sessionStorage.getItem(HIDE_CARD) === '1'; } catch (e) { return false; } }
  function renderCard() {
    var c = X.pageContext(location.pathname);
    var here = /^\/i\/account_analytics/.test(location.pathname) || (c.kind === 'profile' && c.id === st.id);
    var old = document.querySelector('.oo-xo-card.is-own');
    if (!on() || !here || hidden() || document.querySelector('.oo-xo-card.is-early')) { if (old) old.remove(); return; }
    // A capture of another account is flagged in the history (its days were never merged), so it is safe to pass.
    var prog = O.rewardsProgress({ history: st.history, posts: ownPosts(), now: Date.now() });
    var key = JSON.stringify([prog.verified_followers.current, prog.impressions.current, prog.eta_days, prog.notes[0]]);
    if (old && old.getAttribute('data-k') === key) return;
    if (old) old.remove();
    ensureStyle();
    var card = el('div', 'oo-xo-card is-own');
    card.setAttribute('data-k', key);
    var h = el('h4');
    h.appendChild(el('span', '', 'My X · @' + st.handle + ' · Original Content Rewards'));
    var close = el('button', 'oo-xo-x', '×');
    close.title = 'Hide for this tab';
    close.addEventListener('click', function () { try { sessionStorage.setItem(HIDE_CARD, '1'); } catch (e) { /* ignore */ } card.remove(); });
    h.appendChild(close);
    card.appendChild(h);
    function meter(label, cur, target, pct, sub) {
      var row = el('div', 'oo-xo-row');
      row.appendChild(el('span', '', label));
      row.appendChild(el('b', '', fmt(cur) + ' / ' + fmt(target)));
      card.appendChild(row);
      var b = el('div', 'oo-xo-bar');
      var i = el('i');
      i.style.width = Math.max(0, Math.min(100, pct || 0)) + '%';
      b.appendChild(i);
      card.appendChild(b);
      if (sub) card.appendChild(el('div', 'oo-xo-dim', sub));
    }
    var vf = prog.verified_followers;
    meter('Verified followers', vf.current, vf.target, vf.pct, vf.pace_per_week != null ? (vf.pace_per_week >= 0 ? '+' : '') + vf.pace_per_week + ' a week (last 4 weeks)' : null);
    var im = prog.impressions;
    meter('Verified impressions, 90 d', im.current, im.target, im.pct, (im.source === 'analytics' ? 'Upper bound (X\'s Displayed by verified users).' : 'Estimate from your originals\' views (upper bound).') + (im.pace_per_day != null ? ' ' + fmt(im.pace_per_day) + '/day lately.' : ''));
    card.appendChild(el('div', 'oo-xo-row', prog.reached ? 'Both requirements met.' : prog.eta_days != null ? 'At this pace: about ' + prog.eta_date + ' (' + prog.eta_days + ' days).' : 'At this pace: not within 3 years, or too little history.'));
    if (prog.notes[0]) card.appendChild(el('div', 'oo-xo-dim', prog.notes[0]));
    var src = el('div', 'oo-xo-dim');
    var a = el('a', '', 'X\'s requirements (' + prog.requirements.checked + ')');
    a.href = prog.requirements.source;
    a.target = '_blank';
    a.rel = 'noopener';
    src.appendChild(a);
    card.appendChild(src);
    var lib = el('button', 'oo-xo-btn', 'Open My X in the Library');
    lib.addEventListener('click', function () { chrome.runtime.sendMessage({ type: 'reelscope:open-dashboard', hash: '#/x-own' }); });
    card.appendChild(lib);
    (document.body || document.documentElement).appendChild(card);
  }

  // ---- loop -----------------------------------------------------------------------------------------
  var queued = false;
  function render() {
    try { renderEarly(); } catch (e) { console.warn('[OpenOutlier] x-own early', e); }
    try { renderPace(); } catch (e) { console.warn('[OpenOutlier] x-own pace', e); }
    try { renderCard(); } catch (e) { console.warn('[OpenOutlier] x-own card', e); }
  }
  function schedule() { if (queued) return; queued = true; setTimeout(function () { queued = false; render(); }, 400); }
  // The toolbar is re-created by x-content.js; the age changes by itself; SPA navigation has no event here.
  var observer = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var n = muts[i].addedNodes;
      for (var j = 0; j < (n ? n.length : 0); j++) if (n[j].nodeType === 1 && (n[j].classList.contains('oo-x-bar') || (n[j].querySelector && n[j].querySelector('.oo-x-bar')))) { schedule(); return; }
    }
  });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  var lastPath = location.pathname;
  setInterval(function () { if (location.pathname !== lastPath) { lastPath = location.pathname; schedule(); } }, 1000);
  setInterval(schedule, 30000);
  FT.onChange(function (changed) { if (changed.indexOf('x.own') !== -1) schedule(); });
  schedule();
})();
