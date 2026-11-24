// OpenOutlier Library – My X (#/x-own), docs/x-plan.md section 3 (Phase 2, feature x.own).
// The user's own X account: the "X kullanıcı adım" setting, Original Content Rewards progress
// (verified followers /500, verified impressions in 90 days /500K, 4-week pace, ETA, dated
// requirements with the source link), the daily verified impressions, what works against the
// account's own median, best hours, the first-hours curve, and originals vs replies as two tables.
// Reads chrome.storage (rs:x-own*, rs:p:x/<handle>); the bridge's longer history and its
// x_post_stats curve are added when the bridge runs (reelscope:x-own → /x/own/page).
(function (root) {
  'use strict';
  var F = root.OpenOutlierFeatures;
  var O = root.OpenOutlierXOwn;
  var P = root.OpenOutlierXPatterns;
  var M = root.ReelScopeMetrics;

  var S = {
    en: {
      nav: 'My X', title: 'My X', sub: 'Your own X account against Original Content Rewards, and what works for you. Read-only: OpenOutlier never posts.',
      handle: 'My X handle', save: 'Save', saved: 'Saved.', progress: 'Original Content Rewards', vf: 'Verified followers', imp: 'Verified impressions, last 90 days',
      upper: 'Upper bound', estimate: 'Estimate', eta: 'At this pace: {d} ({n} days).', noEta: 'At this pace: not within 3 years, or too little history (14 days needed).', reached: 'Both requirements met.',
      pace: '{n} a week over the last 4 weeks', paceImp: '{n} a day lately', req: 'Requirements as of {d}', source: 'source',
      daily: 'Verified impressions by day', dailySub: 'From x.com/i/account_analytics (Displayed by verified users). Days without activity are missing in X\'s data.',
      noDaily: 'No analytics captured yet. Open x.com/i/account_analytics with OpenOutlier on and pick 3M.',
      works: 'What works', worksSub: 'Your originals with a view count; each group\'s median views ÷ your median ({m}). Under 3 posts: no ×.',
      types: 'Post type', lengths: 'Length', firstLine: 'First line', number: 'Starts with a number', emoji: 'Emoji', link: 'Link', lang: 'Language',
      group: 'Group', n: 'Posts', med: 'Median views', x: '× median', top: 'Best post', yes: 'yes', no: 'no',
      single: 'Median vs average', hours: 'Best hours (your local time)', hoursNone: 'Needs 8 posts in a time block.',
      early: 'First hours', earlySub: 'Your usual views at each age, from OpenOutlier\'s measurements of your posts ({s}).', earlyNone: 'Not enough of your posts measured in their first hours yet (3 per checkpoint). Keep x.com open after you post.',
      srcBridge: 'bridge, x_post_stats', srcLocal: 'this browser',
      originals: 'Originals', originalsSub: 'These count toward the 500K.', replies: 'Replies and thread parts', repliesSub: 'Replies do not count toward Original Content Rewards.',
      date: 'Posted', type: 'Type', text: 'Text', views: 'Views', likes: 'Likes', rep: 'Replies', rt: 'Reposts',
      none: 'No posts of @{h} saved yet. Open x.com/{h} with OpenOutlier on (the panel\'s auto-scroll reads up to 300 posts).',
      off: 'My X is switched off in Features.', turnOn: 'Turn on', capture: 'Last analytics capture: {t}. Covered from {d}.', contentPage: 'Analytics → Content: {n} posts read ({s}).',
      other: 'The last analytics capture belongs to another X account and was not counted.'
    },
    tr: {
      nav: 'X hesabım', title: 'X hesabım', sub: 'Kendi X hesabın Original Content Rewards\'a göre nerede ve sende ne işe yarıyor. Sadece okur: OpenOutlier hiçbir şey paylaşmaz.',
      handle: 'X kullanıcı adım', save: 'Kaydet', saved: 'Kaydedildi.', progress: 'Original Content Rewards', vf: 'Doğrulanmış takipçi', imp: 'Doğrulanmış gösterim, son 90 gün',
      upper: 'Üst sınır', estimate: 'Tahmin', eta: 'Bu hızla: {d} ({n} gün).', noEta: 'Bu hızla: 3 yıl içinde değil ya da geçmiş az (14 gün gerekiyor).', reached: 'İki şart da sağlandı.',
      pace: 'son 4 haftada haftada {n}', paceImp: 'son günlerde günde {n}', req: '{d} tarihli şartlar', source: 'kaynak',
      daily: 'Günlük doğrulanmış gösterim', dailySub: 'x.com/i/account_analytics\'ten (doğrulanmış kullanıcıların Displayed sayısı). Etkinlik olmayan günler X\'in verisinde yok.',
      noDaily: 'Henüz analitik yakalanmadı. OpenOutlier açıkken x.com/i/account_analytics\'i aç ve 3M\'yi seç.',
      works: 'Ne işe yarıyor', worksSub: 'Görüntülenmesi olan orijinal postların; her grubun medyan görüntülenmesi ÷ senin medyanın ({m}). 3 postun altında × yok.',
      types: 'Post tipi', lengths: 'Uzunluk', firstLine: 'İlk satır', number: 'Sayıyla başlıyor', emoji: 'Emoji', link: 'Link', lang: 'Dil',
      group: 'Grup', n: 'Post', med: 'Medyan görüntülenme', x: '× medyan', top: 'En iyi post', yes: 'evet', no: 'hayır',
      single: 'Medyan ve ortalama', hours: 'En iyi saatler (yerel saat)', hoursNone: 'Bir saat diliminde 8 post gerekiyor.',
      early: 'İlk saatler', earlySub: 'Postlarının her yaştaki olağan görüntülenmesi, OpenOutlier ölçümlerinden ({s}).', earlyNone: 'İlk saatlerinde ölçülmüş yeterli postun yok (her nokta için 3). Paylaştıktan sonra x.com\'u açık tut.',
      srcBridge: 'bridge, x_post_stats', srcLocal: 'bu tarayıcı',
      originals: 'Orijinal postlar', originalsSub: '500 bine bunlar sayılır.', replies: 'Yanıtlar ve thread parçaları', repliesSub: 'Yanıtlar Original Content Rewards\'a sayılmaz.',
      date: 'Tarih', type: 'Tip', text: 'Metin', views: 'Görüntülenme', likes: 'Beğeni', rep: 'Yanıt', rt: 'Repost',
      none: '@{h} için kayıtlı post yok. OpenOutlier açıkken x.com/{h} sayfasını aç (paneldeki otomatik kaydırma 300 posta kadar okur).',
      off: 'X hesabım Özellikler\'de kapalı.', turnOn: 'Aç', capture: 'Son analitik: {t}. {d} tarihinden itibaren.', contentPage: 'Analitik → İçerik: {n} post okundu ({s}).',
      other: 'Son analitik başka bir X hesabına ait; sayılmadı.'
    }
  };

  var CSS = [
    '.xo-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start;margin-bottom:16px}',
    '@media (max-width:900px){.xo-grid{grid-template-columns:minmax(0,1fr)}}',
    '.xo-handle{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 16px}',
    '.xo-handle input{font:inherit;padding:6px 10px;border:1.5px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);width:180px}',
    '.xo-chart{width:100%;height:120px;display:block}',
    '.xo-chart rect{fill:var(--accent)}',
    '.xo-chart rect.is-u{fill:var(--border)}',
    '.xo-tag{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:1px 6px;border-radius:4px;background:var(--accent-soft);color:var(--accent);margin-left:6px;vertical-align:middle}',
    '.xo-warn{background:var(--accent-soft);border-radius:6px;padding:8px 10px;font-size:13px;margin-top:8px}',
    '.xo-small{font-size:12px;color:var(--muted)}',
    '.xo-blocks{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:12px}',
    '.xo-full{margin-bottom:16px}',
    '.xo-top{max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.cmp-table td.num,.cmp-table th.num{text-align:right}',
    '.xo-text{max-width:380px;white-space:normal}'
  ].join('');

  function create(env) {
    var h = env.h;
    var st = { handle: O ? O.DEFAULT_HANDLE : 'heyEshagh', record: null, history: null, early: {}, bridge: null, loaded: false, msg: '' };

    function lang() { return F && F.uiLang ? F.uiLang() : 'en'; }
    function L() { return S[lang()] || S.en; }
    function fill(s, o) { return String(s).replace(/\{(\w+)\}/g, function (_, k) { return o[k] != null ? o[k] : ''; }); }
    function loc() { return lang() === 'tr' ? 'tr-TR' : 'en-US'; }
    function num(n, d) { return n == null ? '—' : Number(n).toLocaleString(loc(), { maximumFractionDigits: d == null ? 0 : d }); }
    function times(x) { return x == null ? '—' : num(x, x >= 10 ? 0 : 2) + '×'; }
    function day(t) { return t ? new Date(t).toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; }

    async function load() {
      var r = await chrome.storage.local.get([O.OWN_KEY, O.HISTORY_KEY, O.EARLY_KEY]);
      st.handle = (r[O.OWN_KEY] && r[O.OWN_KEY].handle) || O.DEFAULT_HANDLE;
      st.history = r[O.HISTORY_KEY] || null;
      st.early = r[O.EARLY_KEY] || {};
      var id = O.ownId(st.handle);
      st.record = (await chrome.storage.local.get('rs:p:' + id))['rs:p:' + id] || null;
      st.loaded = true;
      env.rerender();
      chrome.runtime.sendMessage({ type: 'reelscope:x-own', what: 'page' }).then(function (res) {
        st.bridge = res && res.ok ? res : null;
        env.rerender();
      }, function () { st.bridge = null; });
    }
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local' || !O) return;
      var id = 'rs:p:' + O.ownId(st.handle);
      if (changes[O.OWN_KEY] || changes[O.HISTORY_KEY] || changes[O.EARLY_KEY] || changes[id]) load();
    });

    function card(title, sub, body, extra) {
      return h('section', { class: 'm-card kc-card' },
        h('div', { class: 'kc-card-head' }, h('h2', { text: title }), extra || null),
        sub ? h('p', { class: 'kc-sub muted', text: sub }) : null,
        body);
    }
    function meter(label, cur, target, pct, tag, sub) {
      return h('div', { class: 'kc-meter' + (cur != null && cur >= target ? ' is-done' : '') },
        h('div', { class: 'kc-meter-head' }, h('span', null, label, tag ? h('span', { class: 'xo-tag', text: tag }) : null), h('b', null, num(cur), h('small', { text: ' / ' + num(target) }))),
        h('span', { class: 'kc-meter-track' }, h('span', { style: 'width:' + Math.max(0, Math.min(100, pct || 0)) + '%' })),
        sub ? h('p', { class: 'kc-eta', text: sub }) : null);
    }

    function history() {
      // The bridge's copy can be longer (it keeps every capture since the start); else the local one.
      var local = st.history || null; // another account's capture is only flagged (otherAccount), never merged
      var b = st.bridge && st.bridge.progress && st.bridge.progress.daily;
      if (!b || !b.length) return local;
      var hh = local ? JSON.parse(JSON.stringify(local)) : O.emptyHistory();
      b.forEach(function (r) {
        if (!hh.days[r.day] && (r.verified_impressions != null || r.other_impressions != null)) hh.days[r.day] = { Displayed: { v: r.verified_impressions || 0, u: r.other_impressions || 0, n: 0 } };
        if (r.verified_followers != null && !hh.snapshots.some(function (s) { return s.d === r.day; })) hh.snapshots.push({ d: r.day, at: Date.parse(r.day + 'T12:00:00Z'), verifiedFollowers: r.verified_followers, followers: r.followers });
      });
      hh.snapshots.sort(function (a, c) { return a.at - c.at; });
      if (st.bridge.progress.impressions && st.bridge.progress.impressions.covered_from) hh.captures.push({ from: Date.parse(st.bridge.progress.impressions.covered_from + 'T00:00:00Z') });
      return hh;
    }

    function progressCard(prog) {
      var c = L();
      var vf = prog.verified_followers;
      var im = prog.impressions;
      var body = h('div', { class: 'kc-ypp' },
        meter(c.vf, vf.current, vf.target, vf.pct, null, vf.pace_per_week != null ? fill(c.pace, { n: (vf.pace_per_week >= 0 ? '+' : '') + num(vf.pace_per_week, 1) }) : null),
        meter(c.imp, im.current, im.target, im.pct, im.source === 'analytics' ? c.upper : c.estimate, im.label + (im.pace_per_day != null ? ' · ' + fill(c.paceImp, { n: num(im.pace_per_day) }) : '')),
        h('p', { class: 'kc-eta' }, h('b', { text: prog.reached ? c.reached : prog.eta_days != null ? fill(c.eta, { d: prog.eta_date, n: num(prog.eta_days) }) : c.noEta })),
        prog.notes.map(function (n) { return h('p', { class: 'xo-small', text: n }); }),
        h('p', { class: 'xo-small' }, fill(c.req, { d: prog.requirements.checked }) + ': ' + prog.requirements.note + ' (', h('a', { href: prog.requirements.source, target: '_blank', rel: 'noopener noreferrer', text: c.source }), ')'));
      return card(c.progress, null, body);
    }

    function dailyCard(hist) {
      var c = L();
      var rows = hist ? O.dailyRows(hist.days).slice(-90) : [];
      if (!rows.length) return card(c.daily, c.dailySub, h('p', { class: 'muted', text: c.noDaily }));
      var max = Math.max.apply(null, rows.map(function (r) { return r.imp_v + r.imp_u; })) || 1;
      var W = 600;
      var H = 120;
      var first = Date.parse(rows[0].d + 'T00:00:00Z');
      var span = Math.max(1, Math.round((Date.parse(rows[rows.length - 1].d + 'T00:00:00Z') - first) / 864e5) + 1);
      var bw = Math.max(1, W / span - 1);
      var ns = 'http://www.w3.org/2000/svg';
      var svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.setAttribute('class', 'xo-chart');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', c.daily);
      rows.forEach(function (r) {
        var i = Math.round((Date.parse(r.d + 'T00:00:00Z') - first) / 864e5);
        var x = i * (W / span);
        var hv = r.imp_v / max * (H - 4);
        var hu = r.imp_u / max * (H - 4);
        [['is-u', hu, H - hu - hv], ['', hv, H - hv]].forEach(function (b) {
          if (!b[1]) return;
          var rect = document.createElementNS(ns, 'rect');
          rect.setAttribute('x', x.toFixed(1)); rect.setAttribute('width', bw.toFixed(1)); rect.setAttribute('y', b[2].toFixed(1)); rect.setAttribute('height', b[1].toFixed(1));
          if (b[0]) rect.setAttribute('class', b[0]);
          var t = document.createElementNS(ns, 'title');
          t.textContent = r.d + ': ' + r.imp_v + ' verified · ' + r.imp_u + ' other';
          rect.appendChild(t);
          svg.appendChild(rect);
        });
      });
      var cov = O.coveredFrom(hist);
      var last = hist.lastRawAt || (hist.captures && hist.captures.length ? hist.captures[hist.captures.length - 1].at : null);
      return card(c.daily, c.dailySub, [svg,
        h('p', { class: 'xo-small', text: (last ? fill(c.capture, { t: day(last), d: cov || '—' }) : '') + (hist.content ? ' ' + fill(c.contentPage, { n: hist.content.count, s: hist.content.shape }) : '') })]);
    }

    function table(groups, label, keyLabel) {
      var c = L();
      return h('div', null, h('h3', { text: label }), h('div', { class: 'cmp-wrap' }, h('table', { class: 'cmp-table' },
        h('thead', null, h('tr', null, h('th', { text: c.group }), h('th', { class: 'num', text: c.n }), h('th', { class: 'num', text: c.med }), h('th', { class: 'num', text: c.x }), h('th', { text: c.top }))),
        h('tbody', null, groups.map(function (g) {
          var top = g.top[0];
          return h('tr', null, h('td', { text: keyLabel ? keyLabel(g) : g.label || g.key }), h('td', { class: 'num', text: num(g.n) }), h('td', { class: 'num', text: num(g.median_views) }),
            h('td', { class: 'num' }, g.x == null ? '—' : h('b', { text: times(g.x) })),
            h('td', { class: 'xo-top' }, top ? h('a', { href: top.url, target: '_blank', rel: 'noopener noreferrer', title: top.text || top.code, text: top.text || top.code }) : '—'));
        })))));
    }

    function worksCard(posts) {
      var c = L();
      var pat = P.patterns(posts, { lang: lang(), heatmap: false });
      var yn = function (g) { return g.key === 'yes' ? c.yes : g.key === 'no' ? c.no : g.key; };
      var sh = pat.single_hit;
      var hours = pat.best_hours;
      return card(c.works, fill(c.worksSub, { m: num(pat.base_median) }), [
        h('div', { class: 'xo-blocks' },
          table(pat.types, c.types),
          table(pat.lengths, c.lengths),
          table(pat.first_line, c.firstLine),
          table(pat.starts_with_number, c.number, yn),
          table(pat.emoji, c.emoji, yn),
          table(pat.link, c.link, yn),
          table(pat.language, c.lang, function (g) { return g.key.toUpperCase(); })),
        h('h3', { text: c.single }),
        h('p', { class: sh.warning ? 'xo-warn' : 'xo-small', text: sh.message }),
        h('h3', { text: c.hours }),
        hours && hours.best_hours ? h('ul', { class: 'kc-bars' }, hours.hours.map(function (r) {
          var w = r.lift == null ? 0 : Math.max(2, Math.min(100, r.lift / 2 * 100));
          return h('li', null, h('span', { class: 'kc-bar-label', text: r.hours }), h('span', { class: 'kc-meter-track is-thin' }, h('span', { style: 'width:' + w + '%' })), h('span', { class: 'xo-small', text: r.posts ? times(r.lift) : '—' }));
        })) : h('p', { class: 'xo-small', text: c.hoursNone })
      ]);
    }

    function earlyCard() {
      var c = L();
      var id = O.ownId(st.handle);
      var src = st.bridge && st.bridge.curve && Object.keys(st.bridge.curve.cps || {}).length ? { curve: st.bridge.curve, s: c.srcBridge } : null;
      if (!src) {
        var local = O.earlyCurve(Object.keys(st.early).map(function (k) { return st.early[k]; }).filter(function (e) { return e.owner === id && e.kind === 'original'; }));
        if (Object.keys(local.cps).length) src = { curve: local, s: c.srcLocal };
      }
      if (!src) return card(c.early, null, h('p', { class: 'muted', text: c.earlyNone }));
      var cps = Object.keys(src.curve.cps).map(Number).sort(function (a, b) { return a - b; });
      return card(c.early, fill(c.earlySub, { s: src.s }), h('div', { class: 'cmp-wrap' }, h('table', { class: 'cmp-table' },
        h('thead', null, h('tr', null, cps.map(function (x) { return h('th', { class: 'num', text: x < 1 ? Math.round(x * 60) + ' min' : x + ' h' }); }))),
        h('tbody', null, h('tr', null, cps.map(function (x) { return h('td', { class: 'num', title: src.curve.cps[x].n + ' posts', text: num(src.curve.cps[x].value) }); }))))));
    }

    function postsTable(list, title, sub) {
      var c = L();
      return card(title, sub, list.length ? h('div', { class: 'cmp-wrap' }, h('table', { class: 'cmp-table' },
        h('thead', null, h('tr', null, [c.date, c.type, c.text, c.views, c.x, c.likes, c.rep, c.rt].map(function (t, i) { return h('th', { class: i >= 3 ? 'num' : null, text: t }); }))),
        h('tbody', null, list.slice(0, 40).map(function (p) {
          return h('tr', null, h('td', { text: day(p.takenAt) }), h('td', { text: (P.TYPE_LABELS[lang()] || P.TYPE_LABELS.en)[P.postType(p)] }),
            h('td', { class: 'xo-text' }, h('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer', text: String(p.caption || p.code).replace(/\s+/g, ' ').slice(0, 90) })),
            h('td', { class: 'num', text: num(p.views) }), h('td', { class: 'num', text: p.ratio != null ? (p.baselineApprox ? '≈' : '') + times(p.ratio) : '—' }),
            h('td', { class: 'num', text: num(p.likes) }), h('td', { class: 'num', text: num(p.comments) }), h('td', { class: 'num', text: num(p.shares) }));
        })))) : h('p', { class: 'muted', text: '—' }));
    }

    function render(main) {
      main.textContent = '';
      if (!document.getElementById('xo-style')) { var s = document.createElement('style'); s.id = 'xo-style'; s.textContent = CSS; document.head.appendChild(s); }
      var c = L();
      if (!O || !P) { main.appendChild(h('p', { class: 'muted', text: 'src/x-own.js is missing.' })); return; }
      if (!st.loaded) { load(); main.appendChild(h('p', { class: 'muted', text: '…' })); return; }
      var input = h('input', { type: 'text', value: st.handle, 'aria-label': c.handle, maxlength: '16', spellcheck: 'false' });
      main.appendChild(h('div', { class: 'view-head' }, h('h1', { text: c.title }), h('span', { class: 'sub', text: c.sub })));
      main.appendChild(h('div', { class: 'xo-handle' }, h('label', null, c.handle + ' @ ', input),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: function () {
          var v = O.normHandle(input.value);
          if (!/^[a-z0-9_]{1,15}$/.test(v)) { st.msg = '?'; env.rerender(); return; }
          var o = {}; o[O.OWN_KEY] = { handle: input.value.trim().replace(/^@/, '') };
          chrome.storage.local.set(o).then(function () { st.msg = c.saved; st.loaded = false; env.rerender(); });
        } }, c.save), st.msg ? h('span', { class: 'xo-small', text: st.msg }) : null));
      if (F && F.isOn && !F.isOn('x.own')) {
        main.appendChild(h('p', { class: 'muted' }, c.off, ' ', h('button', { class: 'btn btn-ghost', type: 'button', onclick: function () { F.set('x.own', true).then(env.rerender); } }, c.turnOn)));
        return;
      }
      var posts = M.enrich(st.record && st.record.posts ? Object.values(st.record.posts) : []);
      var hist = history();
      var prog = O.rewardsProgress({ history: hist, posts: posts, now: Date.now() });
      if (st.history && st.history.otherAccount) main.appendChild(h('p', { class: 'xo-warn', text: c.other }));
      main.appendChild(h('div', { class: 'xo-grid' }, progressCard(prog), dailyCard(hist)));
      if (!posts.length) { main.appendChild(h('p', { class: 'muted', text: fill(c.none, { h: st.handle }) })); return; }
      var split = O.splitOwn(posts);
      main.appendChild(h('div', { class: 'xo-full' }, worksCard(posts)));
      main.appendChild(h('div', { class: 'xo-full' }, earlyCard()));
      main.appendChild(h('div', { class: 'xo-full' }, postsTable(split.originals, c.originals, c.originalsSub)));
      main.appendChild(h('div', { class: 'xo-full' }, postsTable(split.replies, c.replies, c.repliesSub)));
    }

    return { render: render, title: function () { return L().title; }, navLabel: function () { return L().nav; } };
  }

  root.OpenOutlierXOwnView = { create: create };
})(self);
