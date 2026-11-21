// OpenOutlier – the swipe file (docs/youtube-niche-plan.md 4, `swipe-save`).
//
// Saved videos and Shorts, each with an optional clip (start / end seconds), a note, tags and a
// folder. They live in the Library's organisation record, so the existing sync to the bridge,
// the backup file and restore carry them like folders and tags:
//
//   rs:org.swipe = { v: 1, items: { <id>: item } }
//   item = { id, platform: 'youtube', video, type: 'video' | 'short', title, channel, account,
//            channelId, thumb, views, duration, publishedAt, folder (an rs:org folder id, or null =
//            "Swipe file"), note, tags: [...], clip: { start, end } | null, savedAt, updatedAt }
//
// Tags are normalised exactly like account tags in the Library, so one tag list serves both;
// folders are the Library's own folders (rs:org.folders). Pure functions; UMD: self.OpenOutlierSwipe.
'use strict';

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpenOutlierSwipe = api;
})(typeof self !== 'undefined' ? self : this, function () {
  var MAX_ITEMS = 2000;
  var MAX_NOTE = 2000;
  var MAX_TAGS = 12;
  var VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

  /** The Library's tag rule (dashboard.js): lower case, no "#", other characters → "-", at most 40. */
  function normTag(t) {
    return String(t || '').trim().replace(/İ/g, 'i').toLowerCase().replace(/^#/, '').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  }
  function normTags(list) {
    var out = [];
    (Array.isArray(list) ? list : String(list || '').split(/[,\s]+/)).forEach(function (t) { var n = normTag(t); if (n && out.indexOf(n) === -1 && out.length < MAX_TAGS) out.push(n); });
    return out;
  }
  function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }
  /** { start, end } in whole seconds (end > start), or null. A missing end = start + 30 s. */
  function normClip(c, duration) {
    if (!c || typeof c !== 'object') return null;
    var s = num(Number(c.start));
    var e = c.end == null || c.end === '' ? null : num(Number(c.end));
    if (s == null || s < 0) return null;
    s = Math.floor(s);
    e = e == null ? s + 30 : Math.floor(e);
    if (duration > 0) { s = Math.min(s, Math.floor(duration)); e = Math.min(e, Math.ceil(duration)); }
    if (!(e > s)) return null;
    return { start: s, end: e };
  }
  function newId(video, now, rnd) {
    return 's' + Number(now).toString(36) + (rnd || Math.random()).toString(36).slice(2, 6) + String(video || '').slice(0, 3).replace(/[^A-Za-z0-9]/g, '');
  }

  /** A clean item from any input (the save form, a backup, the bridge). Returns null when it has no video. */
  function normItem(x, now) {
    if (!x || typeof x !== 'object' || !VIDEO_ID_RE.test(String(x.video || ''))) return null;
    now = now || Date.now();
    var dur = num(x.duration);
    return {
      id: typeof x.id === 'string' && /^[A-Za-z0-9_-]{4,40}$/.test(x.id) ? x.id : newId(x.video, now),
      platform: 'youtube',
      video: x.video,
      type: x.type === 'short' ? 'short' : 'video',
      title: x.title ? String(x.title).slice(0, 300) : null,
      channel: x.channel ? String(x.channel).slice(0, 120) : null,
      account: typeof x.account === 'string' && /^yt\//.test(x.account) ? x.account : null,
      channelId: /^UC[A-Za-z0-9_-]{22}$/.test(String(x.channelId || '')) ? x.channelId : null,
      thumb: typeof x.thumb === 'string' && /^https:\/\//.test(x.thumb) ? x.thumb : null,
      views: num(x.views),
      duration: dur,
      publishedAt: num(x.publishedAt),
      folder: typeof x.folder === 'string' && x.folder ? x.folder : null,
      note: x.note ? String(x.note).slice(0, MAX_NOTE) : '',
      tags: normTags(x.tags),
      clip: normClip(x.clip, dur),
      savedAt: num(x.savedAt) || now,
      updatedAt: num(x.updatedAt) || num(x.savedAt) || now
    };
  }
  /** org.swipe in a known shape (unknown items dropped). */
  function state(org) {
    var s = org && org.swipe && typeof org.swipe === 'object' ? org.swipe : null;
    var items = {};
    if (s && s.items && typeof s.items === 'object') Object.keys(s.items).forEach(function (k) { var it = normItem(s.items[k], s.items[k] && s.items[k].savedAt); if (it) items[it.id] = it; });
    return { v: 1, items: items };
  }
  /** Same video and the same clip (or both without one): the save form updates it instead of adding a twin. */
  function findSame(org, video, clip) {
    var items = state(org).items;
    var c = normClip(clip);
    var hit = null;
    Object.keys(items).forEach(function (k) {
      var it = items[k];
      if (it.video !== video) return;
      if ((!c && !it.clip) || (c && it.clip && c.start === it.clip.start && c.end === it.clip.end)) hit = it;
    });
    return hit;
  }
  /**
   * Save (add or update). input: the item fields; input.id updates that item. Folder ids that aren't in
   * org.folders are dropped. → { org: a new org object, item, added }
   */
  function save(org, input, now) {
    now = now || Date.now();
    org = org || { folders: [], accounts: {} };
    var st = state(org);
    var prev = input && input.id && st.items[input.id] ? st.items[input.id] : input ? findSame(org, input.video, input.clip) : null;
    var it = normItem(Object.assign({}, prev || {}, input || {}, { id: prev ? prev.id : input && input.id, savedAt: prev ? prev.savedAt : now, updatedAt: now }), now);
    if (!it) return { org: org, item: null, added: false };
    if (it.folder && !(org.folders || []).some(function (f) { return f.id === it.folder; })) it.folder = null;
    st.items[it.id] = it;
    // Oldest first out when there are too many.
    var keys = Object.keys(st.items);
    if (keys.length > MAX_ITEMS) keys.sort(function (a, b) { return st.items[a].savedAt - st.items[b].savedAt; }).slice(0, keys.length - MAX_ITEMS).forEach(function (k) { delete st.items[k]; });
    return { org: Object.assign({}, org, { swipe: st }), item: it, added: !prev };
  }
  function remove(org, id) {
    var st = state(org);
    if (!st.items[id]) return { org: org, removed: false };
    delete st.items[id];
    return { org: Object.assign({}, org, { swipe: st }), removed: true };
  }
  /** Backup restore / another device: ours win on the same id unless theirs is newer. */
  function merge(ours, theirs) {
    var a = state({ swipe: ours });
    var b = state({ swipe: theirs });
    Object.keys(b.items).forEach(function (k) { if (!a.items[k] || (b.items[k].updatedAt || 0) > (a.items[k].updatedAt || 0)) a.items[k] = b.items[k]; });
    return a;
  }

  /** filters: { folder: id | 'none' | null (all), tag, type: 'video' | 'short', clips: true, q }. sort: 'saved' | 'views' | 'title'. */
  function list(org, filters, sort) {
    filters = filters || {};
    var q = String(filters.q || '').toLowerCase().trim();
    var items = Object.values(state(org).items).filter(function (it) {
      if (filters.folder === 'none' ? it.folder : filters.folder && it.folder !== filters.folder) return false;
      if (filters.tag && it.tags.indexOf(normTag(filters.tag)) === -1) return false;
      if (filters.type && it.type !== filters.type) return false;
      if (filters.clips && !it.clip) return false;
      if (q && [it.title, it.channel, it.note, it.tags.join(' ')].join(' ').toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var by = sort === 'views' ? function (a, b) { return (b.views || 0) - (a.views || 0); }
      : sort === 'title' ? function (a, b) { return String(a.title || '').localeCompare(String(b.title || '')); }
        : function (a, b) { return b.savedAt - a.savedAt; };
    return items.sort(by);
  }
  /** Tag → count over the swipe items (the Library adds its account tags to the same list). */
  function tagCounts(org) {
    var c = {};
    Object.values(state(org).items).forEach(function (it) { it.tags.forEach(function (t) { c[t] = (c[t] || 0) + 1; }); });
    return c;
  }
  function folderCounts(org) {
    var c = { none: 0 };
    Object.values(state(org).items).forEach(function (it) { var k = it.folder || 'none'; c[k] = (c[k] || 0) + 1; });
    return c;
  }

  function clock(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600);
    var m = Math.floor(sec / 60) % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(sec % 60).padStart(2, '0');
  }
  /** "1:05–1:35". */
  function clipLabel(clip) { return clip ? clock(clip.start) + '–' + clock(clip.end) : ''; }
  /** The link that opens the video at the clip's start (&t=). Shorts open as a watch page when clipped (Shorts ignore t=). */
  function url(it) {
    if (!it) return '';
    if (it.type === 'short' && !it.clip) return 'https://www.youtube.com/shorts/' + it.video;
    return 'https://www.youtube.com/watch?v=' + it.video + (it.clip && it.clip.start > 0 ? '&t=' + it.clip.start + 's' : '');
  }

  function csvCell(v) {
    var s = v == null ? '' : String(v);
    if (/^[=\t\r]|^[+\-@][\w.]*\(/.test(s)) s = '\'' + s; // a spreadsheet must not run it as a formula
    return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function folderName(org, id) { var f = (org && org.folders || []).filter(function (x) { return x.id === id; })[0]; return f ? f.name : ''; }
  function toCsv(items, org) {
    var head = ['title', 'channel', 'type', 'url', 'clip_start', 'clip_end', 'note', 'tags', 'folder', 'views', 'saved_at'];
    return '﻿' + [head.join(',')].concat((items || []).map(function (it) {
      return [it.title, it.channel, it.type, url(it), it.clip ? it.clip.start : '', it.clip ? it.clip.end : '', it.note, it.tags.join(' '), folderName(org, it.folder), it.views, new Date(it.savedAt).toISOString()].map(csvCell).join(',');
    })).join('\r\n') + '\r\n';
  }
  function toMarkdown(items, org, title) {
    var lines = ['# ' + (title || 'Swipe file'), ''];
    (items || []).forEach(function (it) {
      lines.push('## [' + (it.title || it.video) + '](' + url(it) + ')');
      var meta = [it.channel, it.type === 'short' ? 'Short' : null, it.clip ? 'clip ' + clipLabel(it.clip) : null, folderName(org, it.folder) || null].filter(Boolean);
      if (meta.length) lines.push(meta.join(' · '));
      if (it.tags.length) lines.push(it.tags.map(function (t) { return '#' + t; }).join(' '));
      if (it.note) lines.push('', '> ' + it.note.replace(/\n/g, '\n> '));
      lines.push('');
    });
    return lines.join('\n');
  }
  function toJson(items) { return JSON.stringify({ app: 'openoutlier', kind: 'swipe-file', v: 1, items: items || [] }, null, 2); }

  return {
    MAX_ITEMS: MAX_ITEMS, normTag: normTag, normTags: normTags, normClip: normClip, normItem: normItem, state: state, findSame: findSame,
    save: save, remove: remove, merge: merge, list: list, tagCounts: tagCounts, folderCounts: folderCounts,
    clock: clock, clipLabel: clipLabel, url: url, toCsv: toCsv, toMarkdown: toMarkdown, toJson: toJson
  };
});
