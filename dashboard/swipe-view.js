// OpenOutlier Library – Swipe file (#/swipe), phase 4 of docs/youtube-niche-plan.md.
// The videos and Shorts saved with the "Save" chip on a watch page (or the toolbar on Shorts):
// a grid with thumbnails, the clip (linked with &t=), note, tags and folder; filters by folder,
// tag, format, clips and text; edit in place; export as CSV, Markdown or JSON. The items live in
// rs:org.swipe (src/swipe.js), next to the Library's folders and tags, so sync and backups carry them.
(function (root) {
  'use strict';
  var F = root.OpenOutlierFeatures;
  var SW = root.OpenOutlierSwipe;

  var S = {
    en: {
      nav: 'Swipe file', title: 'Swipe file', sub: '{n} saved · {c} clips', subOne: '1 saved',
      search: 'Search titles, notes, tags', allFolders: 'All folders', noFolder: 'Swipe file (no folder)', all: 'All', videos: 'Videos', shorts: 'Shorts', clips: 'Clips only',
      sortNew: 'Newest', sortViews: 'Most viewed', sortTitle: 'Title', export: 'Export', tags: 'Tags',
      emptyTitle: 'Nothing saved yet', empty: 'On a YouTube video, press "Save" under the OpenOutlier card (on Shorts: the bookmark in the OpenOutlier toolbar). Add a note, tags and a clip from the playhead; it lands here.',
      emptyFilter: 'Nothing matches these filters.', clear: 'Clear filters', off: 'The swipe file is switched off in Features.', turnOn: 'Turn on',
      edit: 'Edit', remove: 'Remove', save: 'Save', cancel: 'Cancel', note: 'Note', folder: 'Folder', clip: 'Clip', start: 'Start', end: 'End', noClip: 'Whole video',
      saved: 'saved {d}', views: '{n} views', short: 'Short', removed: 'Removed.', undo: 'Undo', badClip: 'The clip end must be after its start.', open: 'Open at {t}'
    },
    tr: {
      nav: 'Swipe file', title: 'Swipe file', sub: '{n} kayıt · {c} klip', subOne: '1 kayıt',
      search: 'Başlık, not ve etiketlerde ara', allFolders: 'Bütün klasörler', noFolder: 'Swipe file (klasörsüz)', all: 'Hepsi', videos: 'Videolar', shorts: 'Shorts', clips: 'Sadece klipler',
      sortNew: 'En yeni', sortViews: 'En çok izlenen', sortTitle: 'Başlık', export: 'Dışa aktar', tags: 'Etiketler',
      emptyTitle: 'Henüz kayıt yok', empty: 'Bir YouTube videosunda OpenOutlier kartının altındaki "Kaydet"e bas (Shorts\'ta: OpenOutlier araç çubuğundaki yer imi). Not, etiket ve oynatma anından bir klip ekle; buraya gelir.',
      emptyFilter: 'Bu filtrelere uyan kayıt yok.', clear: 'Filtreleri temizle', off: 'Swipe file Özellikler\'de kapalı.', turnOn: 'Aç',
      edit: 'Düzenle', remove: 'Kaldır', save: 'Kaydet', cancel: 'Vazgeç', note: 'Not', folder: 'Klasör', clip: 'Klip', start: 'Başlangıç', end: 'Bitiş', noClip: 'Videonun tamamı',
      saved: '{d} kaydedildi', views: '{n} izlenme', short: 'Short', removed: 'Kaldırıldı.', undo: 'Geri al', badClip: 'Klibin bitişi başlangıcından sonra olmalı.', open: '{t} anından aç'
    }
  };

  function create(env) {
    var h = env.h;
    var ui = { q: '', folder: '', type: '', clips: false, tag: '', sort: 'saved', editing: null, msg: '', undo: null };
    try { var keep = JSON.parse(sessionStorage.getItem('oo:swipe-ui') || '{}'); ['folder', 'type', 'sort', 'tag'].forEach(function (k) { if (typeof keep[k] === 'string') ui[k] = keep[k]; }); ui.clips = !!keep.clips; } catch (e) { /* none */ }
    function remember() { try { sessionStorage.setItem('oo:swipe-ui', JSON.stringify({ folder: ui.folder, type: ui.type, sort: ui.sort, tag: ui.tag, clips: ui.clips })); } catch (e) { /* ignore */ } }
    function lang() { return F && F.uiLang ? F.uiLang() : 'en'; }
    function L() { return S[lang()] || S.en; }
    function fill(s, o) { return String(s).replace(/\{(\w+)\}/g, function (_, k) { return o[k] != null ? o[k] : ''; }); }
    function loc() { return lang() === 'tr' ? 'tr-TR' : 'en-US'; }
    function num(n) { return n == null ? '–' : new Intl.NumberFormat(loc(), { notation: 'compact', maximumFractionDigits: 1 }).format(n); }
    function day(t) { return new Date(t).toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }); }
    function org() { return env.getOrg(); }
    function folderName(id) { var f = (org().folders || []).filter(function (x) { return x.id === id; })[0]; return f ? f.name : ''; }

    function download(name, text, type) {
      var url = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
      var a = h('a', { href: url, download: name });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
      root.__ooLastDownload = name;
    }
    function write(fn) {
      var next = fn(org());
      return env.saveOrg(next.org).then(function () { return next; });
    }

    function filtered() {
      return SW.list(org(), { folder: ui.folder || null, tag: ui.tag || null, type: ui.type || null, clips: ui.clips, q: ui.q }, ui.sort);
    }

    function thumbEl(it) {
      var a = h('a', { class: 'sw-thumb' + (it.type === 'short' ? ' is-short' : ''), href: SW.url(it), target: '_blank', rel: 'noopener noreferrer', tabindex: '-1', 'aria-hidden': 'true' });
      var im = h('img', { alt: '', loading: 'lazy', decoding: 'async' });
      im.addEventListener('error', function () { im.remove(); a.classList.add('is-blank'); });
      if (env.loadImage) env.loadImage(im, it.thumb || 'https://i.ytimg.com/vi/' + it.video + '/mqdefault.jpg'); else im.src = it.thumb;
      a.appendChild(im);
      if (it.clip) a.appendChild(h('span', { class: 'sw-clip', title: fill(L().open, { t: SW.clock(it.clip.start) }) }, h('i', { 'aria-hidden': 'true' }), SW.clipLabel(it.clip)));
      if (it.type === 'short') a.appendChild(h('span', { class: 'sw-dur', text: L().short }));
      else if (it.duration) a.appendChild(h('span', { class: 'sw-dur', text: SW.clock(it.duration) }));
      return a;
    }

    function card(it) {
      if (ui.editing === it.id) return editCard(it);
      var f = it.folder ? folderName(it.folder) : '';
      return h('li', { class: 'sw-card' },
        thumbEl(it),
        h('div', { class: 'sw-body' },
          h('a', { class: 'sw-title', href: SW.url(it), target: '_blank', rel: 'noopener noreferrer', text: it.title || it.video }),
          h('div', { class: 'sw-meta' }, [it.channel, it.views != null ? fill(L().views, { n: num(it.views) }) : null, fill(L().saved, { d: day(it.savedAt) })].filter(Boolean).join(' · ')),
          it.note ? h('p', { class: 'sw-note', text: it.note }) : null,
          it.tags.length || f ? h('div', { class: 'sw-tags' },
            f ? h('span', { class: 'chip folder', text: f }) : null,
            it.tags.map(function (t) { return h('button', { class: 'chip sw-tag' + (ui.tag === t ? ' is-on' : ''), type: 'button', onclick: function () { ui.tag = ui.tag === t ? '' : t; remember(); env.rerender(); } }, '#' + t); })) : null,
          h('div', { class: 'sw-acts' },
            h('button', { class: 'btn btn-ghost', type: 'button', onclick: function () { ui.editing = it.id; ui.msg = ''; env.rerender(); } }, L().edit),
            h('button', { class: 'btn btn-ghost btn-danger', type: 'button', onclick: function () {
              var prev = it;
              write(function (o) { return SW.remove(o, it.id); }).then(function () { ui.undo = prev; ui.msg = L().removed; env.rerender(); });
            } }, L().remove))));
    }

    function editCard(it) {
      var note = h('textarea', { class: 'sw-in', rows: '3', 'aria-label': L().note, maxlength: '2000' });
      note.value = it.note || '';
      var tags = h('input', { class: 'sw-in', type: 'text', value: it.tags.join(', '), 'aria-label': L().tags });
      var folder = h('select', { class: 'sw-in', 'aria-label': L().folder }, h('option', { value: '', text: L().noFolder }),
        (org().folders || []).map(function (f) { return h('option', { value: f.id, text: f.name, selected: it.folder === f.id }); }));
      if (!it.folder) folder.value = '';
      var hasClip = h('input', { type: 'checkbox', checked: !!it.clip });
      var st = h('input', { class: 'sw-in sw-time', type: 'text', value: SW.clock(it.clip ? it.clip.start : 0), 'aria-label': L().start });
      var en = h('input', { class: 'sw-in sw-time', type: 'text', value: SW.clock(it.clip ? it.clip.end : 30), 'aria-label': L().end });
      var times = h('span', { class: 'sw-times', hidden: !it.clip }, st, ' → ', en);
      hasClip.addEventListener('change', function () { times.hidden = !hasClip.checked; });
      var err = h('p', { class: 'sw-err', role: 'alert' });
      function parse(v) { var m = String(v).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$|^(\d+)$/); if (!m) return null; return m[4] != null ? Number(m[4]) : (m[1] ? Number(m[1]) * 3600 : 0) + Number(m[2]) * 60 + Number(m[3]); }
      return h('li', { class: 'sw-card is-editing' },
        thumbEl(it),
        h('div', { class: 'sw-body' },
          h('div', { class: 'sw-title', text: it.title || it.video }),
          h('label', { class: 'sw-lbl' }, L().note, note),
          h('label', { class: 'sw-lbl' }, L().tags, tags),
          h('label', { class: 'sw-lbl' }, L().folder, folder),
          h('div', { class: 'sw-lbl' }, h('label', { class: 'sw-chk' }, hasClip, L().clip), times),
          err,
          h('div', { class: 'sw-acts' },
            h('button', { class: 'btn btn-primary', type: 'button', onclick: function () {
              var clip = null;
              if (hasClip.checked) {
                var a = parse(st.value);
                var b = parse(en.value);
                if (a == null || b == null || !(b > a)) { err.textContent = L().badClip; return; }
                clip = { start: a, end: b };
              }
              write(function (o) { return SW.save(o, { id: it.id, video: it.video, note: note.value, tags: SW.normTags(tags.value), folder: folder.value || null, clip: clip }, Date.now()); })
                .then(function () { ui.editing = null; env.rerender(); });
            } }, L().save),
            h('button', { class: 'btn btn-ghost', type: 'button', onclick: function () { ui.editing = null; env.rerender(); } }, L().cancel))));
    }

    function render(main) {
      main.textContent = '';
      var items = Object.values(SW.state(org()).items);
      var clips = items.filter(function (x) { return x.clip; }).length;
      var list = filtered();
      var on = !F || F.isOn('swipe-save');
      main.appendChild(h('div', { class: 'view-head sw-head' },
        h('h1', { text: L().title }),
        h('span', { class: 'sub', text: items.length === 1 ? L().subOne : fill(L().sub, { n: items.length, c: clips }) }),
        items.length ? h('div', { class: 'sw-export', role: 'group', 'aria-label': L().export },
          h('span', { class: 'muted', text: L().export }),
          h('button', { class: 'btn', type: 'button', onclick: function () { download('swipe-file.csv', SW.toCsv(filtered(), org()), 'text/csv'); } }, 'CSV'),
          h('button', { class: 'btn', type: 'button', onclick: function () { download('swipe-file.md', SW.toMarkdown(filtered(), org(), L().title), 'text/markdown'); } }, 'Markdown'),
          h('button', { class: 'btn', type: 'button', onclick: function () { download('swipe-file.json', SW.toJson(filtered()), 'application/json'); } }, 'JSON')) : null));
      if (!on) main.appendChild(h('div', { class: 'kc-banner-info sw-banner' }, h('span', { text: L().off }), h('button', { class: 'btn', type: 'button', onclick: function () { F.set('swipe-save', true).then(env.rerender); } }, L().turnOn)));
      if (!items.length) {
        main.appendChild(h('div', { class: 'm-card sw-empty' }, h('span', { class: 'stair', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
          h('div', null, h('h2', { text: L().emptyTitle }), h('p', { class: 'muted', text: L().empty }))));
        return;
      }
      // Filters
      var counts = SW.folderCounts(org());
      var q = h('input', { class: 'sw-search', type: 'search', placeholder: L().search, 'aria-label': L().search, value: ui.q });
      q.addEventListener('input', function () { ui.q = q.value; paintGrid(); });
      var folder = h('select', { class: 'sw-sel', 'aria-label': L().allFolders },
        h('option', { value: '', text: L().allFolders + ' (' + items.length + ')' }),
        h('option', { value: 'none', text: L().noFolder + ' (' + (counts.none || 0) + ')' }),
        (org().folders || []).filter(function (f) { return counts[f.id]; }).map(function (f) { return h('option', { value: f.id, text: f.name + ' (' + counts[f.id] + ')' }); }));
      folder.value = ui.folder;
      folder.addEventListener('change', function () { ui.folder = folder.value; remember(); paintGrid(); });
      var seg = h('div', { class: 'seg sw-seg', role: 'group' }, [['', L().all], ['video', L().videos], ['short', L().shorts]].map(function (o) {
        return h('button', { type: 'button', 'aria-pressed': ui.type === o[0] ? 'true' : 'false', onclick: function () { ui.type = o[0]; remember(); env.rerender(); } }, o[1]);
      }));
      var clipChk = h('label', { class: 'sw-chk' }, h('input', { type: 'checkbox', checked: ui.clips, onchange: function (e) { ui.clips = e.target.checked; remember(); paintGrid(); } }), L().clips);
      var sort = h('select', { class: 'sw-sel', 'aria-label': 'Sort' }, [['saved', L().sortNew], ['views', L().sortViews], ['title', L().sortTitle]].map(function (o) { return h('option', { value: o[0], text: o[1], selected: ui.sort === o[0] }); }));
      sort.addEventListener('change', function () { ui.sort = sort.value; remember(); paintGrid(); });
      main.appendChild(h('div', { class: 'sw-filters' }, q, folder, seg, clipChk, sort));
      var tc = SW.tagCounts(org());
      var tagList = Object.keys(tc).sort(function (a, b) { return tc[b] - tc[a] || a.localeCompare(b); });
      if (tagList.length) {
        main.appendChild(h('div', { class: 'sw-tagbar', role: 'group', 'aria-label': L().tags }, tagList.slice(0, 24).map(function (t) {
          return h('button', { class: 'chip sw-tag' + (ui.tag === t ? ' is-on' : ''), type: 'button', 'aria-pressed': ui.tag === t ? 'true' : 'false', onclick: function () { ui.tag = ui.tag === t ? '' : t; remember(); env.rerender(); } }, '#' + t, h('small', { text: String(tc[t]) }));
        })));
      }
      if (ui.msg) {
        main.appendChild(h('p', { class: 'sw-msg', role: 'status' }, ui.msg, ui.undo ? ' ' : '', ui.undo ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: function () {
          var it = ui.undo;
          ui.undo = null;
          ui.msg = '';
          write(function (o) { return SW.save(o, it, it.updatedAt); }).then(env.rerender);
        } }, L().undo) : null));
      }
      var grid = h('ol', { class: 'sw-grid' });
      main.appendChild(grid);
      function paintGrid() {
        list = filtered();
        grid.textContent = '';
        if (!list.length) {
          grid.appendChild(h('li', { class: 'sw-none' }, h('span', { text: L().emptyFilter }), ' ',
            h('button', { class: 'btn btn-ghost', type: 'button', onclick: function () { ui.q = ''; ui.folder = ''; ui.type = ''; ui.clips = false; ui.tag = ''; remember(); env.rerender(); } }, L().clear)));
          return;
        }
        list.forEach(function (it) { grid.appendChild(card(it)); });
      }
      paintGrid();
    }

    /** Open with a folder or tag picked (the link on a Library folder / tag page). */
    function filter(f) { ui.folder = f.folder || ''; ui.tag = f.tag || ''; ui.q = ''; ui.type = ''; ui.clips = false; remember(); }
    return { render: render, filter: filter, title: function () { return L().title; }, navLabel: function () { return L().nav; }, count: function () { return Object.keys(SW.state(org()).items).length; } };
  }

  root.OpenOutlierSwipeView = { create: create };
})(typeof self !== 'undefined' ? self : this);
