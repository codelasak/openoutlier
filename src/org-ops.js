// OpenOutlier – edits to the Library's organisation record (rs:org) asked by an agent.
//
// The extension owns rs:org (folders, tags, the niche tracking list) and syncs it to the bridge one
// way, so an agent can't write it there. Instead the MCP tool organize_library queues an `org_edit`
// command; the service worker (src/agent-bridge.js) applies these ops to rs:org in one write and
// reports what changed. Nothing is ever deleted: folders are created, accounts moved, tags added or
// removed, a folder marked as a tracked niche, a channel tracked.
//
//   { op: 'folder', name }                         make sure a folder exists
//   { op: 'move', account, folder }                put an account in a folder (by name, created if
//                                                  missing; null = no folder)
//   { op: 'tag', account, add: [...], remove: [...] }
//   { op: 'niche', folder, on }                    mark a folder as a tracked niche (or not)
//   { op: 'track', account, channelId, name, niche, on }   the Track button for a YouTube channel
//
// Pure; UMD: Node require()s it (tests, the bridge), the service worker gets self.OpenOutlierOrgOps.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpenOutlierOrgOps = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
  var MAX_OPS = 500;

  /** The Library's tag rule (dashboard.js): lower case, letters, digits, _ and -, at most 40. */
  function normTag(t) {
    return String(t || '').trim().replace(/İ/g, 'i').toLowerCase().replace(/^#/, '').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  }
  function normAccount(a) {
    var s = String(a || '').trim();
    return s && s.length <= 120 && !/\s/.test(s) ? s : null;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o || {})); }

  /**
   * Apply ops to a copy of org. → { org, changes: [text], errors: [text] }. Unknown ops and bad
   * arguments are reported in errors and skipped; the rest still apply.
   */
  function apply(org, ops, now) {
    now = now || Date.now();
    var o = clone(org);
    o.folders = Array.isArray(o.folders) ? o.folders : [];
    o.accounts = o.accounts && typeof o.accounts === 'object' ? o.accounts : {};
    var changes = [];
    var errors = [];
    var seq = 0;
    function folderByName(name) {
      var n = String(name || '').trim().toLowerCase();
      return o.folders.filter(function (f) { return f.name.toLowerCase() === n || f.id === name; })[0] || null;
    }
    function ensureFolder(name) {
      var clean = String(name || '').trim().slice(0, 60);
      if (!clean) return null;
      var f = folderByName(clean);
      if (f) return f;
      f = { id: 'f' + now.toString(36) + (seq++).toString(36), name: clean };
      o.folders.push(f);
      changes.push('folder "' + clean + '" created');
      return f;
    }
    function entry(acc) {
      if (!o.accounts[acc]) o.accounts[acc] = { folder: null, tags: [] };
      if (!Array.isArray(o.accounts[acc].tags)) o.accounts[acc].tags = [];
      return o.accounts[acc];
    }
    (Array.isArray(ops) ? ops : []).slice(0, MAX_OPS).forEach(function (op, i) {
      var where = '#' + (i + 1) + ' ' + (op && op.op);
      if (!op || typeof op !== 'object') { errors.push(where + ': not an object'); return; }
      if (op.op === 'folder') {
        if (!ensureFolder(op.name)) errors.push(where + ': no name');
      } else if (op.op === 'move') {
        var acc = normAccount(op.account);
        if (!acc) { errors.push(where + ': bad account'); return; }
        var target = op.folder == null || op.folder === '' ? null : ensureFolder(op.folder);
        if (op.folder != null && op.folder !== '' && !target) { errors.push(where + ': bad folder'); return; }
        var e = entry(acc);
        var to = target ? target.id : null;
        if (e.folder !== to) { e.folder = to; changes.push(acc + ' → ' + (target ? target.name : 'no folder')); }
      } else if (op.op === 'tag') {
        var a2 = normAccount(op.account);
        if (!a2) { errors.push(where + ': bad account'); return; }
        var e2 = entry(a2);
        (Array.isArray(op.add) ? op.add : []).map(normTag).filter(Boolean).forEach(function (t) {
          if (e2.tags.indexOf(t) === -1) { e2.tags.push(t); changes.push(a2 + ' +#' + t); }
        });
        (Array.isArray(op.remove) ? op.remove : []).map(normTag).filter(Boolean).forEach(function (t) {
          var k = e2.tags.indexOf(t);
          if (k !== -1) { e2.tags.splice(k, 1); changes.push(a2 + ' −#' + t); }
        });
      } else if (op.op === 'niche') {
        var f = ensureFolder(op.folder);
        if (!f) { errors.push(where + ': bad folder'); return; }
        var n = o.niches && typeof o.niches === 'object' ? o.niches : {};
        var list = Array.isArray(n.folders) ? n.folders.slice() : [];
        var on = op.on !== false;
        var k2 = list.indexOf(f.id);
        if (on && k2 === -1) { list.push(f.id); changes.push('folder "' + f.name + '" is a tracked niche'); }
        if (!on && k2 !== -1) { list.splice(k2, 1); changes.push('folder "' + f.name + '" is no longer a tracked niche'); }
        o.niches = { folders: list, tags: Array.isArray(n.tags) ? n.tags.slice() : [] };
      } else if (op.op === 'track') {
        var a3 = normAccount(op.account);
        if (!a3 || !/^yt\//.test(a3)) { errors.push(where + ': track needs a yt/ account'); return; }
        o.tracked = o.tracked && typeof o.tracked === 'object' ? o.tracked : {};
        var t = Object.assign({}, o.tracked[a3]);
        var was = !!t.on;
        t.on = op.on !== false;
        t.at = now;
        if (CHANNEL_ID_RE.test(String(op.channelId || ''))) t.channelId = op.channelId;
        if (op.name) t.name = String(op.name).slice(0, 120);
        if (op.niche) t.niche = String(op.niche).slice(0, 80);
        o.tracked[a3] = t;
        if (was !== t.on) changes.push(a3 + (t.on ? ' tracked' : ' untracked'));
      } else {
        errors.push(where + ': unknown op');
      }
    });
    if (Array.isArray(ops) && ops.length > MAX_OPS) errors.push('only the first ' + MAX_OPS + ' ops were applied');
    return { org: o, changes: changes, errors: errors };
  }

  return { apply: apply, normTag: normTag, MAX_OPS: MAX_OPS };
});
