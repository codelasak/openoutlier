// OpenOutlier – the Features list (panel "Features" tab and Library → Settings →
// Features). Builds DOM only; the caller passes its own `h` (both panel.js and the
// Library have the same tiny builder), the current flags and what is set up, and
// handles toggles and fix links. Class names start with ft-; panel.css and
// dashboard.css style them with their own tokens.
'use strict';

(function (root) {
  var F = root.OpenOutlierFeatures;

  var T = {
    en: {
      intro: 'Turn OpenOutlier\'s YouTube features on or off. Changes apply right away, no reload.',
      soon: 'Coming soon',
      soonTip: 'Arrives in phase {n}. You can already choose whether it starts on.',
      on: 'on', of: 'of',
      setup: 'Set up', reset: 'Back to defaults', resetDone: 'Defaults restored.',
      env: { apiKey: 'API key', bridge: 'Bridge', bridgeKey: 'Key on bridge', oauth: 'YouTube Analytics' },
      envState: { yes: 'yes', no: 'no', unknown: '–' },
      envTip: {
        apiKey: 'A YouTube Data API key saved in this browser (popup → YouTube Data API key).',
        bridge: 'The OpenOutlier bridge on this Mac (mcp/launchd/install.sh) is connected.',
        bridgeKey: 'The bridge has its own copy of the API key, for background jobs (~/.openoutlier/youtube-api-key).',
        oauth: 'My YouTube channel is connected through the bridge (Library → My YouTube channel).'
      },
      need: {
        apiKey: 'Needs a YouTube Data API key', bridge: 'The bridge on this Mac isn\'t connected', bridgeKey: 'The bridge has no API key',
        oauth: 'Your YouTube channel isn\'t connected', tracker: 'Needs niche tracking, which is off', providerKey: 'No key for this provider yet'
      },
      fix: { apiKey: 'Add key', bridge: 'How to set up', bridgeKey: 'Add key', copyKey: 'Copy key to bridge', oauth: 'Connect', tracker: 'Turn on', providerKey: 'Add key' },
      // One line per group when several switches wait for the same thing.
      needMany: {
        apiKey: { one: '{n} feature needs a YouTube Data API key', other: '{n} features need a YouTube Data API key' },
        bridge: { one: '{n} feature needs the bridge on this Mac', other: '{n} features need the bridge on this Mac' },
        bridgeKey: { one: '{n} feature is waiting for an API key on the bridge', other: '{n} features are waiting for an API key on the bridge' },
        oauth: { one: '{n} feature needs your YouTube channel connected', other: '{n} features need your YouTube channel connected' },
        tracker: { one: '{n} feature needs niche tracking, which is off', other: '{n} features need niche tracking, which is off' }
      },
      waiting: 'waiting: see above',
      note: {
        thirdParty: ['Sends the video id to ', '. The counts are estimates.'],
        ytRequest: 'OpenOutlier asks YouTube itself: at most 10 requests a minute, cached for 7 days.',
        mcp: 'The analysis part runs in Claude through MCP; no AI key in the extension.',
        estimate: 'A rough estimate, not your real revenue.',
        optApiKey: 'Works without; shows more with an API key.',
        quota: 'Spends Data API units every day; the cost per run is shown in Niche tracking → Radar before it runs, and it stops before the daily budget.',
        scraping: 'Scraping-based: the provider scrapes YouTube, which YouTube\'s API policy doesn\'t allow next to an API key. Its data is labelled separately.',
        paid: 'Paid: the provider charges per call. Nothing is sent until you add a key.',
        suggest: 'Asks Google\'s autocomplete (unofficial) through the bridge: at most 10 requests in 10 s, cached 7 days.'
      },
      switchOn: 'On', switchOff: 'Off'
    },
    tr: {
      intro: 'OpenOutlier\'ın YouTube özelliklerini aç ya da kapat. Değişiklik hemen uygulanır, sayfayı yenilemen gerekmez.',
      soon: 'Yakında',
      soonTip: 'Faz {n}\'te gelecek. Açık mı başlayacağını şimdiden seçebilirsin.',
      on: 'açık', of: '/',
      setup: 'Kurulum', reset: 'Varsayılanlara dön', resetDone: 'Varsayılanlar geri yüklendi.',
      env: { apiKey: 'API anahtarı', bridge: 'Bridge', bridgeKey: 'Bridge\'de anahtar', oauth: 'YouTube Analytics' },
      envState: { yes: 'var', no: 'yok', unknown: '–' },
      envTip: {
        apiKey: 'Bu tarayıcıda kayıtlı bir YouTube Data API anahtarı (popup → YouTube Data API key).',
        bridge: 'Bu Mac\'teki OpenOutlier bridge\'i (mcp/launchd/install.sh) bağlı.',
        bridgeKey: 'Arka plan işleri için bridge\'in kendi anahtar kopyası (~/.openoutlier/youtube-api-key).',
        oauth: 'Kanalım bridge üzerinden bağlı (Library → My YouTube channel).'
      },
      need: {
        apiKey: 'YouTube Data API anahtarı gerekli', bridge: 'Bu Mac\'teki bridge bağlı değil', bridgeKey: 'Bridge\'de API anahtarı yok',
        oauth: 'YouTube kanalın bağlı değil', tracker: 'Niş takibi gerekli, şu an kapalı', providerKey: 'Bu servis için henüz anahtar yok'
      },
      fix: { apiKey: 'Anahtar ekle', bridge: 'Nasıl kurulur', bridgeKey: 'Anahtar ekle', copyKey: 'Anahtarı bridge\'e kopyala', oauth: 'Bağla', tracker: 'Aç', providerKey: 'Anahtar ekle' },
      needMany: {
        apiKey: '{n} özellik YouTube Data API anahtarı bekliyor',
        bridge: '{n} özellik bu Mac\'teki bridge\'i bekliyor',
        bridgeKey: '{n} özellik bridge\'de API anahtarı bekliyor',
        oauth: '{n} özellik YouTube kanalının bağlanmasını bekliyor',
        tracker: '{n} özellik niş takibini bekliyor (şu an kapalı)'
      },
      waiting: 'bekliyor: yukarıya bak',
      note: {
        thirdParty: ['Video ID\'si ', ' servisine gider. Sayılar tahminidir.'],
        ytRequest: 'OpenOutlier YouTube\'a kendisi sorar: dakikada en fazla 10 istek, 7 gün önbellek.',
        mcp: 'Analiz kısmı Claude\'da, MCP üzerinden çalışır; eklentide AI anahtarı yok.',
        estimate: 'Kaba bir tahmin, gerçek gelirin değil.',
        optApiKey: 'Anahtarsız da çalışır; API anahtarıyla daha fazlasını gösterir.',
        quota: 'Her gün Data API birimi harcar; çalışma başına maliyet çalışmadan önce Niş Takibi → Radar\'da görünür, günlük bütçeye gelmeden durur.',
        scraping: 'Scraping tabanlı: servis YouTube\'u kazıyarak veri topluyor; YouTube\'un API politikası bunu bir API anahtarıyla aynı uygulamada yasaklıyor. Verisi ayrı etiketlenir.',
        paid: 'Ücretli: servis çağrı başına ücret alır. Anahtar eklemeden hiçbir şey gönderilmez.',
        suggest: 'Google\'ın otomatik tamamlamasına (resmi değil) bridge üzerinden sorar: 10 saniyede en çok 10 istek, 7 gün önbellek.'
      },
      switchOn: 'Açık', switchOff: 'Kapalı'
    }
  };

  function t(lang) { return T[lang] || T.en; }

  // Pixel icons on the brand's 16-unit grid.
  var PX_WARN = 'M7 1h2v2H7zM6 3h4v2H6zM5 5h6v2H5zM4 7h8v2H4zM3 9h10v2H3zM2 11h12v3H2z';
  var PX_CHECK = 'M12 3h2v2h-2zM10 5h2v2h-2zM8 7h2v2H8zM2 7h2v2H2zM4 9h2v2H4zM6 11h2v2H6z';
  var PX_DOT = 'M5 5h6v6H5z';
  function px(d, cls) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('shape-rendering', 'crispEdges');
    if (cls) svg.setAttribute('class', cls);
    var p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'currentColor');
    svg.appendChild(p);
    return svg;
  }

  var uid = 0;

  /**
   * opts: {
   *   h, lang: 'tr'|'en', flags (resolved map), env ({ apiKey, bridge, bridgeKey, oauth }),
   *   onToggle(id, on), onFix(code) — code: 'apiKey' | 'bridge' | 'bridgeKey' | 'copyKey' | 'oauth' | 'tracker',
   *   onReset() (optional), message (optional status line), compact (panel: tighter rows)
   * }
   */
  function render(opts) {
    var h = opts.h;
    var L = t(opts.lang);
    var lang = L === T.tr ? 'tr' : 'en';
    var flags = opts.flags || F.defaults();
    var env = opts.env || {};
    var wrap = h('div', { class: 'ft' + (opts.compact ? ' ft-compact' : ''), lang: lang });

    wrap.appendChild(h('p', { class: 'ft-intro', text: L.intro }));

    // What is set up: one chip per requirement.
    wrap.appendChild(h('ul', { class: 'ft-env', 'aria-label': lang === 'tr' ? 'Kurulum durumu' : 'Setup status' },
      ['apiKey', 'bridge', 'bridgeKey', 'oauth'].map(function (k) {
        var v = env[k];
        var st = v === true ? 'yes' : v === false ? 'no' : 'unknown';
        return h('li', { class: 'ft-env-item is-' + st, title: L.envTip[k] },
          px(v === true ? PX_CHECK : v === false ? PX_WARN : PX_DOT),
          h('span', { text: L.env[k] }),
          h('b', { class: 'ft-sr', text: ': ' + L.envState[st] }));
      })));

    F.GROUPS.forEach(function (g) {
      var list = F.FEATURES.filter(function (f) { return f.group === g.id; });
      if (!list.length) return;
      var nOn = list.filter(function (f) { return flags[f.id]; }).length;
      var gid = 'ft-g-' + g.id + '-' + (++uid);
      // The same missing piece on two or more switches of a group: one banner instead of a warning per row
      // (provider keys stay on their own row: each provider has its own key).
      var waits = {};
      list.forEach(function (f) {
        if (!flags[f.id]) return;
        F.missing(f.id, env, flags).forEach(function (m) { if (m !== 'providerKey') (waits[m] = waits[m] || []).push(f.id); });
      });
      var banner = Object.keys(waits).filter(function (m) { return waits[m].length >= 2; });
      wrap.appendChild(h('section', { class: 'ft-group', 'aria-labelledby': gid },
        h('div', { class: 'ft-group-head' },
          h('h3', { id: gid, text: g.label[lang] }),
          h('span', { class: 'ft-count', text: nOn + ' ' + L.of + ' ' + list.length + ' ' + L.on })),
        g.hint ? h('p', { class: 'ft-group-hint', text: g.hint[lang] }) : null,
        banner.map(function (m) {
          var code = m === 'bridgeKey' && env.apiKey ? 'copyKey' : m;
          return h('p', { class: 'ft-warn ft-warn-group' }, px(PX_WARN), h('span', { text: F.plural(waits[m].length, L.needMany[m], lang) }),
            opts.onFix ? h('button', { class: 'ft-fix', type: 'button', onclick: function () { opts.onFix(code, waits[m][0]); } }, L.fix[code] + ' →') : null);
        }),
        h('ul', { class: 'ft-list' }, list.map(function (f) { return row(f, banner); }))));
    });

    if (opts.onReset || opts.message) {
      wrap.appendChild(h('div', { class: 'ft-foot' },
        opts.onReset ? h('button', { class: 'btn btn-ghost ft-reset', type: 'button', onclick: function () { opts.onReset(); } }, L.reset) : null,
        h('span', { class: 'ft-msg', role: 'status', 'aria-live': 'polite', text: opts.message || '' })));
    }
    return wrap;

    function row(f, grouped) {
      var on = !!flags[f.id];
      var id = 'ft-' + f.id + '-' + (++uid);
      var allMiss = on ? F.missing(f.id, env, flags) : [];
      var miss = allMiss.filter(function (m) { return (grouped || []).indexOf(m) === -1; });
      var notes = f.notes.slice();
      if (f.optional.indexOf('apiKey') !== -1 && env.apiKey === false) notes.push('optApiKey');
      var input = h('input', { type: 'checkbox', role: 'switch', id: id, 'aria-describedby': id + '-d', onchange: function (e) { opts.onToggle(f.id, e.target.checked); } });
      input.checked = on;
      return h('li', { class: 'ft-row' + (on ? ' is-on' : ' is-off') + (f.available ? '' : ' is-soon') + (allMiss.length ? ' is-blocked' : ''), 'data-feature': f.id },
        h('div', { class: 'ft-text' },
          h('div', { class: 'ft-title' },
            h('label', { for: id, text: f.label[lang] }),
            f.available ? null : h('span', { class: 'ft-soon', title: L.soonTip.replace('{n}', f.phase), text: L.soon }),
            allMiss.length > miss.length ? h('span', { class: 'ft-wait', text: L.waiting }) : null),
          h('p', { class: 'ft-desc', id: id + '-d', text: f.desc[lang] }),
          miss.map(function (m) {
            var code = m === 'bridgeKey' && env.apiKey ? 'copyKey' : m;
            return h('p', { class: 'ft-warn' }, px(PX_WARN), h('span', { text: L.need[m] }),
              opts.onFix ? h('button', { class: 'ft-fix', type: 'button', onclick: function () { opts.onFix(code, f.id); } }, L.fix[code]) : null);
          }),
          notes.map(function (n) {
            var text = L.note[n];
            if (n === 'scraping') return h('p', { class: 'ft-note ft-note-scraping' }, h('b', { class: 'ft-badge', lang: 'en', text: 'scraping' }), ' ', text);
            if (!Array.isArray(text)) return h('p', { class: 'ft-note' }, text);
            return h('p', { class: 'ft-note' }, text[0], h('a', { href: f.link, target: '_blank', rel: 'noopener noreferrer', text: f.link.replace(/^https:\/\/|\/$/g, '') }), text[1]);
          })),
        h('label', { class: 'ft-switch', title: on ? L.switchOn : L.switchOff }, input, h('span', { 'aria-hidden': 'true' })),
        choices(f, on));
    }

    /** Choice settings that belong to this feature (F.CHOICES), as a small segmented control. */
    function choices(f, on) {
      var names = Object.keys(F.CHOICES || {}).filter(function (k) { return F.CHOICES[k].feature === f.id; });
      if (!names.length) return null;
      return h('div', { class: 'ft-choices' + (on ? '' : ' is-off') }, names.map(function (name) {
        var c = F.CHOICES[name];
        var cur = opts.choices && opts.choices[name] ? opts.choices[name] : F.choice(name);
        var gid = 'ft-c-' + name + '-' + (++uid);
        return h('div', { class: 'ft-choice', role: 'radiogroup', 'aria-labelledby': gid, 'data-choice': name },
          h('span', { class: 'ft-choice-label', id: gid, text: c.label[lang] }),
          h('span', { class: 'ft-seg' }, c.values.map(function (v) {
            var b = h('button', { type: 'button', role: 'radio', class: 'ft-seg-btn' + (v === cur ? ' is-on' : ''), 'aria-checked': v === cur ? 'true' : 'false', 'data-value': v,
              onclick: function () { if (opts.onChoice) opts.onChoice(name, v); else F.setChoice(name, v); } }, c.options[v][lang]);
            return b;
          })),
          c.hint ? h('p', { class: 'ft-note ft-choice-hint', text: c.hint[lang] }) : null);
      }));
    }
  }

  root.OpenOutlierFeaturesView = { render: render, strings: T };
})(typeof self !== 'undefined' ? self : this);
