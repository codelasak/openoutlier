// OpenOutlier Library – X idea sources (#/x-ideas), docs/x-plan.md 5.2 (Phase 4).
// Three lists from what the Library already holds (src/x-ideas.js, the same code as MCP x_ideas):
//   • niche X outliers: originals of the last 30 days at ≥3× their author's median (folders marked "X niche")
//   • the user's own Reels / TikToks / Shorts / YouTube outliers, to adapt for X (their own content)
//   • Reddit demand: questions and pain points that did well (content_ideas)
// The "own accounts" and subreddits are picked here and saved in rs:org.xIdeas (synced to the bridge).
// Also home of the bridge's X watch warning (x-watch: schema drift, new algorithm weights), read from rs:x:watch.
// Nothing here writes a post: an idea opens the source; the user writes their own post on x.com.
(function (root) {
  'use strict';
  var F = root.OpenOutlierFeatures;
  var I = root.OpenOutlierXIdeas;
  var WATCH_KEY = 'rs:x:watch';

  var S = {
    en: {
      nav: 'X ideas', title: 'X ideas', sub: 'Starting points for your own X posts, from what the Library holds. Niche outliers show what worked: take the idea, never the text.',
      niche: 'Niche outliers', nicheSub: 'Originals from the last {d} days at ≥{x}× their author\'s own median ({a} accounts{m}).', nicheMarked: ', folders marked X niche', nicheAll: ', every X account (mark a folder "X niche" in the x.com Growth drawer)',
      own: 'Your other platforms', ownSub: 'Your own outliers (≥{x}× your median) on Instagram, TikTok and YouTube: adapt them for X. A Short or Reel often works as a native video; a long video as a thread.',
      ownPick: 'Your accounts', ownNone: 'Pick your own Instagram, TikTok or YouTube accounts above.', ownMissing: 'Not in the Library: {l}',
      reddit: 'Reddit demand', redditSub: 'Questions and pain points that did well in {s}.', subsPick: 'Subreddits', scopeAll: 'all saved subreddits', scopeNiche: 'the subreddits in your X-niche folders', scopeChosen: 'the subreddits you picked',
      themes: 'Recurring themes', save: 'Save', saved: 'Saved.', none: 'Nothing yet.', views: 'views', open: 'Open', suggest: 'try as {f}',
      redditNone: 'No subreddits in the Library yet.', mcp: 'Claude can use the same lists through MCP (x_ideas), and can also turn your repositories\' commits and releases into "what I built this week" ideas.',
      watchSchema: 'x.com changed an operation OpenOutlier reads: {l}. Collection may miss posts until OpenOutlier is updated.', watchWeights: 'The open-source algorithm weights changed on {d} ({n} values); badges use the new copy.',
      watchChecked: 'X watch (bridge): operations checked {d}{w}.', watchWeightsV: ', weights {v}'
    },
    tr: {
      nav: 'X fikirleri', title: 'X fikirleri', sub: 'Library\'deki veriden kendi X postların için başlangıç noktaları. Niş outlier\'ları neyin işe yaradığını gösterir: fikri al, metni değil.',
      niche: 'Niş outlier\'ları', nicheSub: 'Son {d} günün, yazarının kendi medyanının ≥{x} katı orijinal postları ({a} hesap{m}).', nicheMarked: ', "X niş" klasörleri', nicheAll: ', bütün X hesapları (x.com\'daki Büyüme panelinden bir klasörü "X niş" işaretle)',
      own: 'Diğer platformların', ownSub: 'Instagram, TikTok ve YouTube\'daki kendi outlier\'ların (medyanının ≥{x} katı): X\'e uyarla. Short ya da Reel çoğu zaman doğrudan video olarak, uzun video thread olarak işler.',
      ownPick: 'Hesapların', ownNone: 'Yukarıdan kendi Instagram, TikTok ya da YouTube hesaplarını seç.', ownMissing: 'Library\'de yok: {l}',
      reddit: 'Reddit talebi', redditSub: '{s} içinde iyi giden sorular ve dertler.', subsPick: 'Subreddit\'ler', scopeAll: 'kayıtlı bütün subreddit\'ler', scopeNiche: 'X niş klasörlerindeki subreddit\'ler', scopeChosen: 'seçtiğin subreddit\'ler',
      themes: 'Tekrar eden konular', save: 'Kaydet', saved: 'Kaydedildi.', none: 'Henüz yok.', views: 'görüntülenme', open: 'Aç', suggest: '{f} olarak dene',
      redditNone: 'Library\'de henüz subreddit yok.', mcp: 'Claude aynı listeleri MCP\'den (x_ideas) kullanabilir; repolarındaki commit ve sürümlerden "bu hafta ne yaptım" fikirleri de çıkarabilir.',
      watchSchema: 'x.com OpenOutlier\'ın okuduğu bir operasyonu değiştirdi: {l}. OpenOutlier güncellenene kadar bazı postlar toplanmayabilir.', watchWeights: 'Açık kaynak algoritma ağırlıkları {d} tarihinde değişti ({n} değer); rozetler yeni kopyayı kullanıyor.',
      watchChecked: 'X izleme (bridge): operasyonlar {d} tarihinde kontrol edildi{w}.', watchWeightsV: ', ağırlıklar {v}'
    }
  };
  var CSS = [
    '.xi-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:16px}',
    '.xi-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}',
    '.xi-list li{display:flex;gap:10px;align-items:baseline;justify-content:space-between;border-bottom:1px solid var(--border);padding:6px 0}',
    '.xi-list .xi-t{flex:1;min-width:0;overflow-wrap:anywhere}',
    '.xi-x{font-weight:700;white-space:nowrap}',
    '.xi-meta{font-size:12px;color:var(--muted);white-space:nowrap}',
    '.xi-pick{display:flex;flex-wrap:wrap;gap:6px 14px;margin:6px 0 10px}',
    '.xi-pick label{display:inline-flex;gap:6px;align-items:center;font-size:13px}',
    '.xi-warn{background:var(--accent-soft);border-radius:6px;padding:8px 10px;font-size:13px;margin:0 0 12px}',
    '.xi-small{font-size:12px;color:var(--muted)}'
  ].join('');

  function lang() { return F && F.uiLang ? F.uiLang() : 'en'; }
  function L() { return S[lang()] || S.en; }
  function fill(s, o) { return String(s).replace(/\{(\w+)\}/g, function (_, k) { return o[k] != null ? o[k] : ''; }); }
  function loc() { return lang() === 'tr' ? 'tr-TR' : 'en-US'; }
  function num(n, d) { return n == null ? '—' : Number(n).toLocaleString(loc(), { maximumFractionDigits: d == null ? 0 : d }); }
  function day(t) { return t ? new Date(t).toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; }

  /** The bridge's X watch (mcp/x-watch.mjs via rs:x:watch) as warning lines; [] when all is well. */
  function watchLines(w) {
    var c = L();
    var out = [];
    var st = w && w.status;
    if (!st) return out;
    var warns = (st.schema && st.schema.warnings || []).filter(function (x) { return x && x.severity !== 'info'; });
    if (warns.length) out.push({ warn: true, text: fill(c.watchSchema, { l: warns.map(function (x) { return x.op + (x.candidates && x.candidates.length ? ' → ' + x.candidates.join(' / ') : '') + ' (' + (x[lang()] || x.en || x.kind) + ')'; }).join('; ') }) });
    var ww = st.weights;
    if (ww && ww.changedAt && ww.lastDiff && ww.lastDiff.length && Date.now() - Date.parse(ww.changedAt) < 14 * 864e5) out.push({ warn: true, text: fill(c.watchWeights, { d: day(Date.parse(ww.changedAt)), n: ww.lastDiff.length }) });
    if (st.schema && st.schema.checkedAt) out.push({ warn: false, text: fill(c.watchChecked, { d: day(Date.parse(st.schema.checkedAt) || st.schema.checkedAt), w: ww && ww.version ? fill(c.watchWeightsV, { v: ww.version }) : '' }) });
    return out;
  }
  function watchBanner(h, w) {
    var lines = watchLines(w);
    if (!lines.length) return null;
    return h('div', null, lines.map(function (l) { return h('p', { class: l.warn ? 'xi-warn' : 'xi-small', text: l.text }); }));
  }

  function create(env) {
    var h = env.h;
    var st = { lib: null, watch: null, msg: '' };

    async function load() {
      var all = await chrome.storage.local.get(null);
      var accounts = {};
      Object.keys(all).forEach(function (k) { if (k.indexOf('rs:p:') === 0 && all[k] && all[k].posts) accounts[k.slice(5)] = all[k]; });
      st.lib = { accounts: accounts };
      st.watch = all[WATCH_KEY] || null;
      var ownH = all['rs:x-own'] && all['rs:x-own'].handle; // Phase 2's "my X handle": not part of the niche
      st.exclude = ownH ? ['x/' + String(ownH).replace(/^@/, '').toLowerCase()] : [];
      env.rerender();
    }
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local' || !st.lib) return;
      if (changes[WATCH_KEY]) { st.watch = changes[WATCH_KEY].newValue || null; env.rerender(); }
    });

    function card(title, sub, body) {
      return h('section', { class: 'm-card kc-card' }, h('div', { class: 'kc-card-head' }, h('h2', { text: title })), sub ? h('p', { class: 'kc-sub muted', text: sub }) : null, body);
    }
    function picker(label, options, chosen, onSave) {
      var c = L();
      var boxes = options.map(function (o) {
        var cb = h('input', { type: 'checkbox', value: o.id });
        cb.checked = chosen.indexOf(o.id) !== -1;
        return { cb: cb, el: h('label', null, cb, o.label) };
      });
      if (!options.length) return null;
      return h('div', null, h('b', { class: 'xi-small', text: label }),
        h('div', { class: 'xi-pick' }, boxes.map(function (b) { return b.el; }),
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: function () { onSave(boxes.filter(function (b) { return b.cb.checked; }).map(function (b) { return b.cb.value; })); } }, c.save)));
    }
    function save(patch) {
      var org = I.setSettings(env.getOrg(), patch);
      env.saveOrg(org).then(function () { st.msg = L().saved; env.rerender(); });
    }

    function render(main) {
      main.textContent = '';
      if (!document.getElementById('xi-style')) { var s = document.createElement('style'); s.id = 'xi-style'; s.textContent = CSS; document.head.appendChild(s); }
      var c = L();
      if (!I) { main.appendChild(h('p', { class: 'muted', text: 'src/x-ideas.js is missing.' })); return; }
      if (!st.lib) { load(); main.appendChild(h('p', { class: 'muted', text: '…' })); return; }
      var org = env.getOrg();
      var lib = { accounts: st.lib.accounts, org: org };
      var res = I.ideas(lib, { now: Date.now(), exclude: st.exclude });
      var sets = I.settingsOf(org);
      main.appendChild(h('div', { class: 'view-head' }, h('h1', { text: c.title }), h('span', { class: 'sub', text: c.sub })));
      var wb = watchBanner(h, st.watch);
      if (wb) main.appendChild(wb);
      if (st.msg) main.appendChild(h('p', { class: 'xi-small', text: st.msg }));

      var n = res.niche;
      main.appendChild(h('div', { class: 'xi-grid' },
        card(c.niche, fill(c.nicheSub, { d: n.days, x: n.min_ratio, a: n.accounts, m: n.niche_marked ? c.nicheMarked : c.nicheAll }),
          n.posts.length ? h('ul', { class: 'xi-list' }, n.posts.map(function (p) {
            return h('li', null, h('span', { class: 'xi-x', text: (p.approx ? '≈' : '') + num(p.ratio, 1) + '×' }),
              h('span', { class: 'xi-t' }, h('b', { text: '@' + p.author + ' ' }), p.first_line || '—'),
              h('span', { class: 'xi-meta', text: num(p.views) + ' ' + c.views + ' · ' + (p.format || '') + ' · ' + day(p.taken_at) }),
              p.url ? h('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer', text: c.open }) : null);
          })) : h('p', { class: 'muted', text: c.none })),

        card(c.own, fill(c.ownSub, { x: res.crossPlatform.min_ratio }), [
          picker(c.ownPick, I.ownCandidates(lib).slice(0, 40).map(function (o) { return { id: o.id, label: o.id + ' (' + o.platform + ')' }; }), sets.own, function (ids) { save({ own: ids }); }),
          res.crossPlatform.missing.length ? h('p', { class: 'xi-small', text: fill(c.ownMissing, { l: res.crossPlatform.missing.join(', ') }) }) : null,
          !sets.own.length ? h('p', { class: 'muted', text: c.ownNone }) : res.crossPlatform.posts.length ? h('ul', { class: 'xi-list' }, res.crossPlatform.posts.map(function (p) {
            return h('li', null, h('span', { class: 'xi-x', text: num(p.ratio, 1) + '×' }),
              h('span', { class: 'xi-t' }, h('b', { text: p.kind + ' ' }), p.first_line || p.code),
              h('span', { class: 'xi-meta', text: num(p.views) + ' ' + c.views + ' · ' + fill(c.suggest, { f: p.suggest }) }),
              p.url ? h('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer', text: c.open }) : null);
          })) : h('p', { class: 'muted', text: c.none })
        ]),

        card(c.reddit, res.reddit.subreddits.length ? fill(c.redditSub, { s: res.reddit.scope === 'chosen' ? c.scopeChosen : res.reddit.scope === 'niche-folders' ? c.scopeNiche : c.scopeAll }) : null, [
          picker(c.subsPick, Object.keys(st.lib.accounts).filter(function (id) { return I.platformOf(id, st.lib.accounts[id]) === 'reddit'; }).map(function (id) { return { id: id, label: id }; }), sets.subreddits, function (ids) { save({ subreddits: ids }); }),
          !res.reddit.subreddits.length ? h('p', { class: 'muted', text: c.redditNone }) : [
            res.reddit.ideas.length ? h('ul', { class: 'xi-list' }, res.reddit.ideas.map(function (p) {
              return h('li', null, h('span', { class: 'xi-x', text: p.ratio != null ? num(p.ratio, 1) + '×' : '' }),
                h('span', { class: 'xi-t' }, h('b', { text: p.need + ' ' }), p.title),
                h('span', { class: 'xi-meta', text: p.subreddit + ' · ' + num(p.score) + ' ↑ · ' + num(p.comments) + ' 💬' }),
                p.url ? h('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer', text: c.open }) : null);
            })) : h('p', { class: 'muted', text: c.none }),
            res.reddit.themes.length ? h('p', { class: 'xi-small', text: c.themes + ': ' + res.reddit.themes.map(function (t) { return t.theme + ' (' + t.posts + ')'; }).join(' · ') }) : null
          ]
        ])));
      main.appendChild(h('p', { class: 'xi-small', text: c.mcp }));
      st.msg = '';
    }

    return { render: render, title: function () { return L().title; }, navLabel: function () { return L().nav; } };
  }

  root.OpenOutlierXIdeasView = { create: create, watchLines: watchLines, watchBanner: watchBanner };
})(self);
