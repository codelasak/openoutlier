'use strict';
var KEY_PREFIX = 'rs:p:';
var nf = new Intl.NumberFormat();

async function activeTab() {
  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function openLibrary(hash) {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') + (hash || '') });
  window.close();
}
document.getElementById('library').addEventListener('click', function () { openLibrary(''); });
document.getElementById('mentions').addEventListener('click', function () { openLibrary('#/mentions'); });
document.getElementById('features').addEventListener('click', function () { openLibrary('#/settings'); });
chrome.storage.local.get(['rs:mentions', 'rs:watches']).then(function (r) {
  var m = r['rs:mentions'] || {};
  var unread = Object.keys(m.items || {}).filter(function (id) { return !(m.read || {})[id]; }).length;
  var watches = (r['rs:watches'] || []).length;
  document.getElementById('mentions-label').textContent = 'Reddit mentions' + (unread || watches ? '' : ': add a keyword watch');
  var count = document.getElementById('mentions-count');
  count.textContent = unread + ' new';
  count.hidden = !unread;
});
try { document.getElementById('version').textContent = 'v' + chrome.runtime.getManifest().version; } catch (e) { /* demo page */ }

document.getElementById('open').addEventListener('click', async function () {
  var tab = await activeTab();
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'reelscope:toggle' });
    window.close();
  } catch (e) {
    document.getElementById('hint').hidden = false; // not an Instagram tab (or not reloaded since install)
  }
});

/** Outliers (≥ 2× the account's median) among its reels/videos, or all posts on Reddit. */
function outliersOf(posts) {
  var M = self.ReelScopeMetrics;
  if (!M) return 0;
  try {
    return M.enrich(Object.values(posts)).filter(function (p) {
      return p.outlier && (p.platform === 'reddit' || p.platform === 'youtube' || p.type === 'reel' || p.type === 'video');
    }).length;
  } catch (e) { return 0; }
}

/** Reddit: r/excel, u/name · TikTok: tt/name → "@name (TikTok)" · YouTube: yt/name → "@name (YouTube)", yt/UC… → "UC… (YouTube)". */
function accountLabel(id) {
  if (/^(r|u)\//.test(id)) return id;
  if (/^tt\//.test(id)) return '@' + id.slice(3) + ' (TikTok)';
  if (/^yt\/UC[A-Za-z0-9_-]{22}$/.test(id)) return id.slice(3) + ' (YouTube)';
  if (/^yt\//.test(id)) return '@' + id.slice(3) + ' (YouTube)';
  return '@' + id;
}

async function renderProfiles() {
  var all = await chrome.storage.local.get(null);
  var list = Object.keys(all)
    .filter(function (k) { return k.indexOf(KEY_PREFIX) === 0 && all[k] && all[k].posts; })
    .map(function (k) { return { username: k.slice(KEY_PREFIX.length), count: Object.keys(all[k].posts).length, outliers: outliersOf(all[k].posts), updatedAt: all[k].updatedAt }; })
    .sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });

  var ul = document.getElementById('profiles');
  ul.textContent = '';
  list.forEach(function (p) {
    var li = document.createElement('li');
    var a = document.createElement('a');
    a.href = '#';
    a.title = 'Open in the library';
    a.addEventListener('click', function (e) { e.preventDefault(); openLibrary('#/account/' + encodeURIComponent(p.username)); });
    a.textContent = accountLabel(p.username);
    var n = document.createElement('span');
    n.className = 'num';
    n.textContent = nf.format(p.count);
    n.title = nf.format(p.count) + ' posts saved';
    li.append(a, n);
    if (p.outliers) {
      // lime on ink: the outlier badge (brand: lime is reserved for outliers)
      var b = document.createElement('span');
      b.className = 'badge-outlier';
      b.title = nf.format(p.outliers) + ' outliers (≥ 2× median)';
      var st = document.createElement('span');
      st.className = 'stair';
      st.setAttribute('aria-hidden', 'true');
      st.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
      b.append(st, nf.format(p.outliers));
      li.appendChild(b);
    } else li.appendChild(document.createElement('span'));
    ul.appendChild(li);
  });
  document.getElementById('none').hidden = list.length > 0;
  document.getElementById('clear').disabled = list.length === 0;
}

document.getElementById('clear').addEventListener('click', async function () {
  if (!confirm('Delete all saved OpenOutlier data from this browser?')) return;
  var all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all).filter(function (k) { return k.indexOf(KEY_PREFIX) === 0; }));
  renderProfiles();
});

var SETTINGS_KEY = 'rs:settings';
// Through the shared helper (src/features.js): only this key changes, from a fresh read.
function setSetting(key, value) {
  var p = {};
  p[key] = value;
  return self.OpenOutlierFeatures.updateSettings(p);
}
var detailsBox = document.getElementById('details');
var agentsBox = document.getElementById('agents');
chrome.storage.local.get(SETTINGS_KEY).then(function (r) {
  var s = r[SETTINGS_KEY] || {};
  detailsBox.checked = s.fetchDetails !== false;
  agentsBox.checked = s.agentBridge !== false;
});
detailsBox.addEventListener('change', function () { setSetting('fetchDetails', detailsBox.checked); });
agentsBox.addEventListener('change', function () { setSetting('agentBridge', agentsBox.checked).then(renderAgentStatus); });

// Agent (local MCP server) connection status, written by src/agent-bridge.js.
async function renderAgentStatus() {
  var el = document.getElementById('agent-status');
  var r = await chrome.storage.local.get('rs:bridge');
  var b = r['rs:bridge'] || {};
  if (!agentsBox.checked) el.textContent = 'Off. Agents (Claude, Cursor…) cannot see your library.';
  else if (b.connected) {
    var backup = b.lastBackupAt
      ? (b.lastBackupOk ? ' Last backup to your server: ' : ' ⚠️ Last backup FAILED: ') + new Date(b.lastBackupAt).toLocaleString() + '.'
      : ' No backup yet.';
    el.textContent = 'Saving to your Mac\'s OpenOutlier database (port ' + b.port + ')' + (b.lastSyncAt ? ', synced ' + new Date(b.lastSyncAt).toLocaleTimeString() : '') + '.' + backup;
  }
  else el.textContent = 'Not connected to the OpenOutlier database on this Mac, so nothing is being backed up. Install the bridge (see README: mcp/launchd/install.sh).' + (b.lastError ? ' Last error: ' + b.lastError : '');
}
chrome.runtime.sendMessage({ type: 'reelscope:bridge-check' }).catch(function () {});
renderAgentStatus();
chrome.storage.onChanged.addListener(function (c) { if (c['rs:bridge']) renderAgentStatus(); });

renderProfiles();

// ---- optional YouTube Data API key ------------------------------------------------
// Stored in rs:settings.youtubeApiKey (this browser). It reaches the bridge on this
// Mac only when you press "Copy key to bridge" (for background jobs; the bridge
// keeps it in ~/.openoutlier/youtube-api-key, readable only by you). Saving asks
// Chrome for access to www.googleapis.com, the only other host the key is sent to.
// Units used today: this browser's plus the bridge's (rs:bridge.bridgeQuota).
(function () {
  var A = self.OpenOutlierYouTubeApi;
  var API_ORIGIN = 'https://www.googleapis.com/*';
  var form = document.getElementById('ytapi-form');
  if (!A || !form) return;
  var input = document.getElementById('ytapi-key');
  var msg = document.getElementById('ytapi-msg');
  var state = document.getElementById('ytapi-state');
  var remove = document.getElementById('ytapi-remove');

  var bridgeBox = document.getElementById('ytapi-bridge');
  var bridgeState = document.getElementById('ytapi-bridge-state');
  var copyBtn = document.getElementById('ytapi-copy');
  var uncopyBtn = document.getElementById('ytapi-uncopy');

  var sticky = { text: '', until: 0 }; // a copy result outlives the storage update that follows it
  async function show(note, bridgeNote) {
    if (bridgeNote) sticky = { text: bridgeNote, until: Date.now() + 15000 };
    else if (Date.now() < sticky.until) bridgeNote = sticky.text;
    var r = await chrome.storage.local.get([SETTINGS_KEY, 'rs:yt-api-quota', 'rs:bridge']);
    var key = (r[SETTINGS_KEY] || {}).youtubeApiKey;
    var b = r['rs:bridge'] || {};
    var mine = A.usedToday(r['rs:yt-api-quota']);
    var onBridge = A.usedToday(b.bridgeQuota);
    var used = mine + onBridge;
    var on = A.isKey(key);
    state.textContent = on ? 'on · ' + nf.format(used) + ' / ' + nf.format(A.DAILY_QUOTA) + ' units today' : b.bridgeApiKey ? 'on the bridge only' : 'optional, off';
    input.placeholder = on ? 'Saved (…' + key.slice(-4) + '). Paste a new key to replace it.' : 'AIza…';
    remove.hidden = !on;
    msg.textContent = note != null ? note : on || onBridge ? 'Quota used today: ' + nf.format(used) + ' of ' + nf.format(A.DAILY_QUOTA) + ' units' +
      (onBridge ? ' (' + nf.format(mine) + ' in this browser, ' + nf.format(onBridge) + ' by the bridge)' : '') + '; resets at midnight Pacific time. Use "Exact stats via API" in a YouTube channel\'s panel.' : '';

    // The bridge's copy, for background jobs (niche tracking).
    var connected = agentsBox.checked && b.connected;
    bridgeBox.hidden = !on && !b.bridgeApiKey;
    copyBtn.hidden = !on || !connected;
    copyBtn.textContent = b.bridgeApiKey ? 'Copy again' : 'Copy key to bridge';
    uncopyBtn.hidden = !connected || !b.bridgeApiKey || b.bridgeApiKeySource !== 'file';
    bridgeState.textContent = bridgeNote || (!connected ? 'The bridge on this Mac isn\'t connected. Background jobs (niche tracking) need it, with its own copy of the key.'
      : b.bridgeApiKey ? (b.bridgeApiKeySource === 'env' ? 'The bridge has a key from OPENOUTLIER_YOUTUBE_API_KEY.' : 'The bridge has a copy of the key for background jobs.')
        : b.settingsAt ? 'The bridge has no key yet, so background jobs can\'t use the API.' : 'Checking the bridge…');
  }

  async function bridgeKey(action) {
    copyBtn.disabled = uncopyBtn.disabled = true;
    var r = await chrome.runtime.sendMessage({ type: 'reelscope:bridge-key', action: action }).catch(function (e) { return { ok: false, error: e.message }; });
    copyBtn.disabled = uncopyBtn.disabled = false;
    show(null, r && r.ok ? (action === 'remove' ? 'Removed from the bridge.' : 'Copied. The bridge keeps it in ~/.openoutlier/youtube-api-key (only you can read it).') : 'Could not ' + (action === 'remove' ? 'remove' : 'copy') + ': ' + ((r && r.error) || 'no answer'));
  }
  copyBtn.addEventListener('click', function () { bridgeKey('copy'); });
  uncopyBtn.addEventListener('click', function () { bridgeKey('remove'); });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var key = input.value.trim();
    if (!A.isKey(key)) { show('That doesn\'t look like an API key (letters, digits, - and _, usually 39 characters starting with AIza).'); return; }
    var granted = false;
    try { granted = await chrome.permissions.request({ origins: [API_ORIGIN] }); } catch (err) { granted = false; }
    if (!granted) { show('Chrome needs permission to reach www.googleapis.com for the key to work. Nothing was saved.'); return; }
    await setSetting('youtubeApiKey', key);
    input.value = '';
    show('Saved. The key stays in this browser.');
  });
  remove.addEventListener('click', async function () {
    await setSetting('youtubeApiKey', '');
    chrome.permissions.remove({ origins: [API_ORIGIN] }).catch(function () {});
    show('Removed. OpenOutlier no longer calls the YouTube Data API.');
  });
  chrome.storage.onChanged.addListener(function (c) { if (c['rs:yt-api-quota'] || c['rs:bridge']) show(); });
  show();
})();
