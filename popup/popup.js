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
chrome.storage.local.get(['rs:mentions', 'rs:watches']).then(function (r) {
  var m = r['rs:mentions'] || {};
  var unread = Object.keys(m.items || {}).filter(function (id) { return !(m.read || {})[id]; }).length;
  var watches = (r['rs:watches'] || []).length;
  document.getElementById('mentions').textContent = '🔔 Reddit mentions' + (unread ? ' (' + unread + ' new)' : watches ? '' : ': add a keyword watch');
});

document.getElementById('open').addEventListener('click', async function () {
  var tab = await activeTab();
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'reelscope:toggle' });
    window.close();
  } catch (e) {
    document.getElementById('hint').hidden = false; // not an Instagram tab (or not reloaded since install)
  }
});

async function renderProfiles() {
  var all = await chrome.storage.local.get(null);
  var list = Object.keys(all)
    .filter(function (k) { return k.indexOf(KEY_PREFIX) === 0 && all[k] && all[k].posts; })
    .map(function (k) { return { username: k.slice(KEY_PREFIX.length), count: Object.keys(all[k].posts).length, updatedAt: all[k].updatedAt }; })
    .sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });

  var ul = document.getElementById('profiles');
  ul.textContent = '';
  list.forEach(function (p) {
    var li = document.createElement('li');
    var a = document.createElement('a');
    a.href = '#';
    a.title = 'Open in the library';
    a.addEventListener('click', function (e) { e.preventDefault(); openLibrary('#/account/' + encodeURIComponent(p.username)); });
    // Reddit: r/excel, u/name · TikTok: tt/name → "@name (TikTok)"
    a.textContent = /^(r|u)\//.test(p.username) ? p.username : /^tt\//.test(p.username) ? '@' + p.username.slice(3) + ' (TikTok)' : '@' + p.username;
    var n = document.createElement('span');
    n.className = 'muted';
    n.textContent = nf.format(p.count) + ' posts';
    li.append(a, n);
    ul.appendChild(li);
  });
  document.getElementById('none').hidden = list.length > 0;
  document.getElementById('clear').disabled = list.length === 0;
}

document.getElementById('clear').addEventListener('click', async function () {
  if (!confirm('Delete all saved ReelScope data from this browser?')) return;
  var all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all).filter(function (k) { return k.indexOf(KEY_PREFIX) === 0; }));
  renderProfiles();
});

var SETTINGS_KEY = 'rs:settings';
async function setSetting(key, value) {
  var r = await chrome.storage.local.get(SETTINGS_KEY);
  var s = Object.assign({}, r[SETTINGS_KEY]);
  s[key] = value;
  var patch = {};
  patch[SETTINGS_KEY] = s;
  await chrome.storage.local.set(patch);
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
      ? (b.lastBackupOk ? ' Last backup to Hayati: ' : ' ⚠️ Last backup FAILED: ') + new Date(b.lastBackupAt).toLocaleString() + '.'
      : ' No backup yet.';
    el.textContent = 'Saving to your Mac\'s ReelScope database (port ' + b.port + ')' + (b.lastSyncAt ? ', synced ' + new Date(b.lastSyncAt).toLocaleTimeString() : '') + '.' + backup;
  }
  else el.textContent = 'Not connected to the ReelScope database on this Mac, so nothing is being backed up. Install the bridge (see README: mcp/launchd/install.sh).' + (b.lastError ? ' Last error: ' + b.lastError : '');
}
chrome.runtime.sendMessage({ type: 'reelscope:bridge-check' }).catch(function () {});
renderAgentStatus();
chrome.storage.onChanged.addListener(function (c) { if (c['rs:bridge']) renderAgentStatus(); });

renderProfiles();
