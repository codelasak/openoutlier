// OpenOutlier – the niche tracking list (docs/youtube-niche-plan.md 2.1).
//
// Lives in the Library's organisation record (rs:org), which already syncs to the
// bridge, so the extension, the Library and the bridge read one list:
//   org.niches  = { folders: ['f2'], tags: ['excel'] }   folders / tags marked "tracked niche"
//   org.tracked = { 'yt/handle': { on, mine, channelId, name, at } }
// A YouTube channel is tracked when its folder or one of its tags is a tracked niche,
// or when the Track button turned it on; the Track button can also turn a niche
// member off (on: false), which wins. `mine` marks the user's own channel.
// The bridge (mcp/niche.mjs) turns this into tracked_channels rows and jobs.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpenOutlierTracking = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;

  /** The starting niche (decision 2026-11-21): the user's Excel channels, plus their own. */
  var EXCEL_CHANNELS = ['Simon Sez IT', 'Excel Dictionary', 'Kevin Stratvert', 'Leila Gharani', 'MyOnlineTrainingHub', 'Kenji Explains',
    'Excel Campus', 'Learn Skills Daily', 'Easy Click Learning', 'Excel Champs', 'Cody Baldwin', 'Excel Champion', 'Marg Analytics',
    'Bright Minds Hub', 'Technology for Teachers and Students'];
  var MINE = { id: 'yt/handsonexcel', name: 'Hands on Excel', handle: 'handsonexcel' };
  var STARTER_FOLDER = 'Excel';

  function isYouTube(id) { return /^yt\//.test(String(id || '')); }
  function norm(s) { return String(s || '').toLowerCase().replace(/^@/, '').replace(/[^a-z0-9]+/g, ''); }

  function niches(org) {
    var n = org && org.niches;
    return { folders: n && Array.isArray(n.folders) ? n.folders.slice() : [], tags: n && Array.isArray(n.tags) ? n.tags.slice() : [] };
  }
  function folderOf(org, id) {
    var f = org && org.accounts && org.accounts[id] && org.accounts[id].folder;
    return f && (org.folders || []).some(function (x) { return x.id === f; }) ? f : null;
  }
  function tagsOf(org, id) { return (org && org.accounts && org.accounts[id] && org.accounts[id].tags) || []; }
  function folderName(org, fid) { var f = (org.folders || []).filter(function (x) { return x.id === fid; })[0]; return f ? f.name : null; }

  /** Is this folder / tag a tracked niche? kind: 'folder' | 'tag'. */
  function isNiche(org, kind, key) {
    var n = niches(org);
    return (kind === 'folder' ? n.folders : n.tags).indexOf(key) !== -1;
  }
  /** Mark / unmark a folder or tag as a tracked niche (mutates org). */
  function setNiche(org, kind, key, on) {
    var n = niches(org);
    var list = kind === 'folder' ? n.folders : n.tags;
    var i = list.indexOf(key);
    if (on && i === -1) list.push(key);
    if (!on && i !== -1) list.splice(i, 1);
    org.niches = n;
    return org;
  }

  /** The niche a channel is tracked in (folder name or tag), or null. */
  function nicheOf(org, id) {
    var n = niches(org);
    var f = folderOf(org, id);
    if (f && n.folders.indexOf(f) !== -1) return folderName(org, f);
    var tags = tagsOf(org, id);
    for (var i = 0; i < tags.length; i++) if (n.tags.indexOf(tags[i]) !== -1) return '#' + tags[i];
    return null;
  }

  /**
   * Tracking state of one channel: { on, via: 'niche' | 'button' | null, niche, mine, excluded }.
   */
  function status(org, id) {
    var e = org && org.tracked && org.tracked[id];
    var niche = nicheOf(org || {}, id);
    var mine = !!(e && e.mine);
    if (e && e.on === false) return { on: false, via: null, niche: niche, mine: mine, excluded: !!niche };
    if (e && e.on) return { on: true, via: niche ? 'niche' : 'button', niche: niche || (folderOf(org, id) ? folderName(org, folderOf(org, id)) : null) || (e.niche ? String(e.niche) : null), mine: mine, excluded: false };
    if (niche) return { on: true, via: 'niche', niche: niche, mine: mine, excluded: false };
    return { on: false, via: null, niche: null, mine: mine, excluded: false };
  }

  /** The Track button: flip tracking for one channel (mutates org). info: { channelId, name } from the page. */
  function toggle(org, id, info, now) {
    if (!isYouTube(id)) return org;
    var st = status(org, id);
    org.tracked = org.tracked || {};
    var e = Object.assign({}, org.tracked[id]);
    e.on = !st.on;
    e.at = now || Date.now();
    if (info && CHANNEL_ID_RE.test(String(info.channelId || ''))) e.channelId = info.channelId;
    if (info && info.name) e.name = String(info.name).slice(0, 120);
    // Turning off a channel that only the button tracked: forget the entry (unless it is marked mine).
    if (!e.on && !st.niche && !e.mine) delete org.tracked[id];
    else org.tracked[id] = e;
    return org;
  }

  /**
   * Phase 5's one-click Track (niche radar, channel map): track a channel, usually not saved in the
   * Library, inside a niche (a folder or "#tag" name), so it shows up with that niche's channels.
   * info: { channelId, name }. Mutates org.
   */
  function trackInNiche(org, id, info, niche, now) {
    if (!isYouTube(id)) return org;
    org.tracked = org.tracked || {};
    var e = Object.assign({}, org.tracked[id]);
    e.on = true;
    e.at = now || Date.now();
    if (niche) e.niche = String(niche).slice(0, 80);
    if (info && CHANNEL_ID_RE.test(String(info.channelId || ''))) e.channelId = info.channelId;
    if (info && info.name) e.name = String(info.name).slice(0, 120);
    org.tracked[id] = e;
    return org;
  }

  /** Mark (or unmark) a channel as the user's own; marking also tracks it. */
  function setMine(org, id, mine, info, now) {
    if (!isYouTube(id)) return org;
    org.tracked = org.tracked || {};
    var e = Object.assign({}, org.tracked[id]);
    e.mine = !!mine;
    if (mine) e.on = true;
    e.at = now || Date.now();
    if (info && CHANNEL_ID_RE.test(String(info.channelId || ''))) e.channelId = info.channelId;
    if (info && info.name) e.name = String(info.name).slice(0, 120);
    org.tracked[id] = e;
    return org;
  }

  /**
   * Every channel that should be tracked: [{ account_id, niche, mine, channelId, name }].
   * accountIds: the saved accounts (channels can also be tracked without being saved).
   */
  function desired(org, accountIds) {
    var seen = {};
    var out = [];
    var ids = (accountIds || []).filter(isYouTube).concat(Object.keys((org && org.tracked) || {}).filter(isYouTube));
    ids.forEach(function (id) {
      if (seen[id]) return;
      seen[id] = true;
      var st = status(org || {}, id);
      if (!st.on) return;
      var e = (org.tracked || {})[id] || {};
      out.push({ account_id: id, niche: st.niche, mine: st.mine, channelId: e.channelId || (CHANNEL_ID_RE.test(id.slice(3)) ? id.slice(3) : null), name: e.name || null });
    });
    // The user's own channel is compared with a niche: outside any folder or tag, it joins the biggest one.
    var counts = {};
    out.forEach(function (d) { if (!d.mine && d.niche) counts[d.niche] = (counts[d.niche] || 0) + 1; });
    var top = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0] || null;
    out.forEach(function (d) { if (d.mine && !d.niche) d.niche = top; });
    return out;
  }

  /** Does a saved channel look like one of the names? → the matched name or null. */
  function matchName(acct, names) {
    var keys = [norm(acct.name), norm(acct.handle), norm(String(acct.id || '').replace(/^yt\//, ''))].filter(Boolean);
    for (var i = 0; i < names.length; i++) {
      var t = norm(names[i]);
      for (var k = 0; k < keys.length; k++) {
        if (keys[k] === t || (t.length >= 8 && (keys[k].indexOf(t) === 0 || keys[k] === t + 'official' || keys[k] === 'the' + t))) return names[i];
      }
    }
    return null;
  }

  /**
   * The one-click helper: saved YouTube channels with a preselection.
   * accounts: [{ id, name, handle, videos }] (saved channels). → { items: [{ id, name, handle, picked, reason, tracked }], mine, folder }
   */
  function suggest(accounts, org) {
    var items = (accounts || []).filter(function (a) { return isYouTube(a.id); }).map(function (a) {
      var hit = matchName(a, EXCEL_CHANNELS);
      var isMine = norm(a.handle) === MINE.handle || a.id === MINE.id || norm(a.name) === norm(MINE.name);
      var st = status(org || {}, a.id);
      return { id: a.id, name: a.name || null, handle: a.handle || null, videos: a.videos || 0, picked: !!hit || isMine || st.on, mine: isMine || st.mine, reason: isMine ? 'mine' : hit ? 'excel' : st.on ? 'tracked' : null, match: hit, tracked: st.on };
    });
    items.sort(function (x, y) { return (y.picked - x.picked) || (y.mine - x.mine) || String(x.name || x.id).localeCompare(String(y.name || y.id)); });
    var mineSaved = items.some(function (i) { return i.mine; });
    return { items: items, mine: mineSaved ? null : MINE, folder: STARTER_FOLDER, missing: EXCEL_CHANNELS.filter(function (n) { return !items.some(function (i) { return i.match === n; }); }) };
  }

  /**
   * Apply the helper's choice (mutates org): the picked channels go into one folder
   * (created when missing), the folder becomes a tracked niche, and the user's own
   * channel is tracked as mine (also when it isn't saved yet).
   * choice: { folder: 'Excel', picked: [ids], mine: id | null, mineInfo }
   */
  function applySuggestion(org, choice, now) {
    org.folders = org.folders || [];
    org.accounts = org.accounts || {};
    var name = String(choice.folder || STARTER_FOLDER).trim().slice(0, 60) || STARTER_FOLDER;
    var f = org.folders.filter(function (x) { return x.name.toLowerCase() === name.toLowerCase(); })[0];
    if (!f) { f = { id: 'f' + (now || Date.now()).toString(36), name: name }; org.folders.push(f); }
    (choice.picked || []).forEach(function (id) {
      if (!isYouTube(id)) return;
      var o = org.accounts[id] = org.accounts[id] || { folder: null, tags: [] };
      if (!Array.isArray(o.tags)) o.tags = [];
      o.folder = f.id;
      // A channel the user had switched off goes back on when they pick it here.
      if (org.tracked && org.tracked[id] && org.tracked[id].on === false) org.tracked[id].on = true;
    });
    setNiche(org, 'folder', f.id, true);
    if (choice.mine) {
      var mo = org.accounts[choice.mine] = org.accounts[choice.mine] || { folder: null, tags: [] };
      if (!mo.folder) mo.folder = f.id;
      setMine(org, choice.mine, true, choice.mineInfo || { name: MINE.name }, now);
    }
    return { org: org, folder: f };
  }

  return {
    EXCEL_CHANNELS: EXCEL_CHANNELS, MINE: MINE, STARTER_FOLDER: STARTER_FOLDER,
    niches: niches, isNiche: isNiche, setNiche: setNiche, nicheOf: nicheOf, status: status, toggle: toggle, setMine: setMine, trackInNiche: trackInNiche,
    desired: desired, matchName: matchName, suggest: suggest, applySuggestion: applySuggestion, norm: norm
  };
});
