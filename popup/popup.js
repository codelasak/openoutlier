'use strict';
var KEY_PREFIX = 'rs:p:';
var nf = new Intl.NumberFormat();

// ---- TR/EN (C11): the popup follows Settings → Dil like the Library ------------------------
var STR = {
  en: {
    library: 'Open the Library', libraryAside: 'all saved accounts', open: 'Open the panel on this tab', mentions: 'Reddit mentions', mentionsAdd: ': add a keyword watch', newN: '{n} new',
    hint: 'Open <a href="https://www.instagram.com/" target="_blank" rel="noopener">instagram.com</a> (a profile\'s <b>Reels</b> tab), a profile on <a href="https://www.tiktok.com/" target="_blank" rel="noopener">tiktok.com</a>, a channel\'s <b>Videos</b> or <b>Shorts</b> tab on <a href="https://www.youtube.com/" target="_blank" rel="noopener">youtube.com</a>, a subreddit on <a href="https://www.reddit.com/r/excel/top/?t=year" target="_blank" rel="noopener">reddit.com</a> or a profile on <a href="https://x.com/" target="_blank" rel="noopener">x.com</a>, then scroll. Reload the tab if you just installed OpenOutlier.',
    details: 'Load missing views &amp; dates', detailsHint: 'Asks Instagram for each post\'s details, one at a time, the same way its own post page does. Turn off if Instagram shows "try again later".',
    agents: 'Save to this Mac &amp; connect AI agents', checking: 'Checking…',
    apiTitle: 'YouTube Data API key', apiOff: 'optional, off', apiBridgeOnly: 'on the bridge only', apiOn: 'on · {u} / {l} units today',
    apiText: 'Your own key from Google Cloud (YouTube Data API v3) gives exact views, likes, comments and dates for 50 videos per quota unit, and a channel\'s full upload list, without opening pages. Free quota: 10,000 units a day. Without a key OpenOutlier never calls the API.',
    save: 'Save', removeKey: 'Remove the key', copy: 'Copy key to bridge', copyAgain: 'Copy again', uncopy: 'Remove from bridge',
    features: 'YouTube features', featuresAside: 'turn on / off', saved: 'Saved accounts &amp; subreddits',
    none: 'Nothing saved yet. Open a profile on Instagram, TikTok or X, a YouTube channel, or a subreddit, then scroll.', clear: 'Delete all data', foot: 'Free &amp; open source · MIT',
    openLib: 'Open in the library', postsN: { one: '{n} post saved', other: '{n} posts saved' }, outliersN: { one: '{n} outlier (≥ 2× median)', other: '{n} outliers (≥ 2× median)' },
    clearConfirm: 'Delete all saved OpenOutlier data from this browser?',
    agentsOff: 'Off. Agents (Claude, Cursor…) cannot see your library.', backupOk: ' Last backup to your server: ', backupBad: ' Last backup FAILED: ', noBackup: ' No backup yet.',
    saving: 'Saving to your Mac\'s OpenOutlier database (port {p}){s}.', synced: ', synced {t}',
    notConnected: 'Not connected to the OpenOutlier database on this Mac, so nothing is being backed up. Install the bridge (see README: mcp/launchd/install.sh).', lastError: ' Last error: ',
    savedKey: 'Saved (…{k}). Paste a new key to replace it.', quota: 'Quota used today: {u} of {l} units', quotaSplit: ' ({m} in this browser, {b} by the bridge)', quotaTail: '; resets at midnight Pacific time. Use "Exact stats via API" in a YouTube channel\'s panel.',
    bridgeOff: 'The bridge on this Mac isn\'t connected. Background jobs (niche tracking) need it, with its own copy of the key.', bridgeEnv: 'The bridge has a key from OPENOUTLIER_YOUTUBE_API_KEY.',
    bridgeHas: 'The bridge has a copy of the key for background jobs.', bridgeNo: 'The bridge has no key yet, so background jobs can\'t use the API.', bridgeChecking: 'Checking the bridge…',
    removed: 'Removed from the bridge.', copied: 'Copied. The bridge keeps it in ~/.openoutlier/youtube-api-key (only you can read it).', couldNot: 'Could not {a}: {e}', aCopy: 'copy', aRemove: 'remove', noAnswer: 'no answer',
    badKey: 'That doesn\'t look like an API key (letters, digits, - and _, usually 39 characters starting with AIza).', perm: 'Chrome needs permission to reach www.googleapis.com for the key to work. Nothing was saved.',
    keySaved: 'Saved. The key stays in this browser.', keyRemoved: 'Removed. OpenOutlier no longer calls the YouTube Data API.'
  },
  tr: {
    library: 'Kütüphaneyi aç', libraryAside: 'kayıtlı bütün hesaplar', open: 'Bu sekmede paneli aç', mentions: 'Reddit bahsedilmeleri', mentionsAdd: ': bir kelime takibi ekle', newN: '{n} yeni',
    hint: '<a href="https://www.instagram.com/" target="_blank" rel="noopener">instagram.com</a>\'da bir profilin <b>Reels</b> sekmesini, <a href="https://www.tiktok.com/" target="_blank" rel="noopener">tiktok.com</a>\'da bir profili, <a href="https://www.youtube.com/" target="_blank" rel="noopener">youtube.com</a>\'da bir kanalın <b>Videolar</b> ya da <b>Shorts</b> sekmesini, <a href="https://www.reddit.com/r/excel/top/?t=year" target="_blank" rel="noopener">reddit.com</a>\'da bir subreddit\'i veya <a href="https://x.com/" target="_blank" rel="noopener">x.com</a>\'da bir profili aç ve kaydır. OpenOutlier\'ı yeni kurduysan sekmeyi yenile.',
    details: 'Eksik izlenme ve tarihleri yükle', detailsHint: 'Her gönderinin ayrıntısını Instagram\'a tek tek, kendi gönderi sayfasının sorduğu gibi sorar. Instagram "daha sonra tekrar dene" derse kapat.',
    agents: 'Bu Mac\'e kaydet ve AI ajanlarını bağla', checking: 'Kontrol ediliyor…',
    apiTitle: 'YouTube Data API anahtarı', apiOff: 'isteğe bağlı, kapalı', apiBridgeOnly: 'yalnız bridge\'de', apiOn: 'açık · bugün {u} / {l} birim',
    apiText: 'Google Cloud\'dan kendi anahtarın (YouTube Data API v3); sayfa açmadan, kota birimi başına 50 videonun kesin izlenme, beğeni, yorum ve tarihini ve bir kanalın bütün yükleme listesini verir. Bedava kota günde 10.000 birim. Anahtar yoksa OpenOutlier API\'yi hiç çağırmaz.',
    save: 'Kaydet', removeKey: 'Anahtarı sil', copy: 'Anahtarı bridge\'e kopyala', copyAgain: 'Tekrar kopyala', uncopy: 'Bridge\'den sil',
    features: 'YouTube özellikleri', featuresAside: 'aç / kapat', saved: 'Kayıtlı hesaplar ve subreddit\'ler',
    none: 'Henüz kayıt yok. Instagram, TikTok ya da X\'te bir profil, bir YouTube kanalı veya bir subreddit aç ve kaydır.', clear: 'Bütün veriyi sil', foot: 'Bedava ve açık kaynak · MIT',
    openLib: 'Kütüphanede aç', postsN: '{n} gönderi kayıtlı', outliersN: '{n} outlier (medyanın ≥ 2 katı)',
    clearConfirm: 'Bu tarayıcıdaki bütün OpenOutlier verisi silinsin mi?',
    agentsOff: 'Kapalı. Ajanlar (Claude, Cursor…) kütüphaneni göremez.', backupOk: ' Sunucuna son yedek: ', backupBad: ' Son yedek BAŞARISIZ: ', noBackup: ' Henüz yedek yok.',
    saving: 'Mac\'teki OpenOutlier veritabanına kaydediliyor (port {p}){s}.', synced: ', {t} eşitlendi',
    notConnected: 'Bu Mac\'teki OpenOutlier veritabanına bağlı değil; hiçbir şey yedeklenmiyor. Bridge\'i kur (README: mcp/launchd/install.sh).', lastError: ' Son hata: ',
    savedKey: 'Kayıtlı (…{k}). Değiştirmek için yeni anahtarı yapıştır.', quota: 'Bugün kullanılan kota: {u} / {l} birim', quotaSplit: ' (bu tarayıcı {m}, bridge {b})', quotaTail: '; Pasifik saatiyle gece yarısı sıfırlanır. Bir YouTube kanalının panelinde "Exact stats via API"yi kullan.',
    bridgeOff: 'Bu Mac\'teki bridge bağlı değil. Arka plan işleri (niş takibi) için o ve kendi anahtar kopyası gerekir.', bridgeEnv: 'Bridge\'in anahtarı OPENOUTLIER_YOUTUBE_API_KEY\'den.',
    bridgeHas: 'Bridge\'de arka plan işleri için anahtarın bir kopyası var.', bridgeNo: 'Bridge\'de henüz anahtar yok; arka plan işleri API\'yi kullanamaz.', bridgeChecking: 'Bridge kontrol ediliyor…',
    removed: 'Bridge\'den silindi.', copied: 'Kopyalandı. Bridge onu ~/.openoutlier/youtube-api-key dosyasında tutar (yalnız sen okuyabilirsin).', couldNot: '{a} olmadı: {e}', aCopy: 'Kopyalama', aRemove: 'Silme', noAnswer: 'cevap yok',
    badKey: 'Bu bir API anahtarına benzemiyor (harf, rakam, - ve _; genelde AIza ile başlayan 39 karakter).', perm: 'Anahtarın çalışması için Chrome\'un www.googleapis.com\'a erişim izni gerekiyor. Hiçbir şey kaydedilmedi.',
    keySaved: 'Kaydedildi. Anahtar bu tarayıcıda kalır.', keyRemoved: 'Silindi. OpenOutlier artık YouTube Data API\'yi çağırmıyor.'
  }
};
function uiLang() { return self.OpenOutlierFeatures && self.OpenOutlierFeatures.uiLang() === 'tr' ? 'tr' : 'en'; }
function T(k, o, count) {
  var s = (STR[uiLang()] || STR.en)[k];
  if (s && typeof s === 'object') { var rule = 'other'; try { rule = new Intl.PluralRules(uiLang() === 'tr' ? 'tr-TR' : 'en-US').select(count); } catch (e) { /* other */ } s = s[rule] != null ? s[rule] : s.other; }
  return String(s == null ? k : s).replace(/\{(\w+)\}/g, function (_, x) { return o && o[x] != null ? o[x] : ''; });
}
/** The static markup (popup.html is English): text from the table, the document's lang for CSS uppercase. */
function localizeStatic() {
  document.documentElement.lang = uiLang();
  nf = new Intl.NumberFormat(uiLang() === 'tr' ? 'tr-TR' : 'en-US');
  var set = function (sel, key, html) { var el = document.querySelector(sel); if (el) el[html ? 'innerHTML' : 'textContent'] = T(key); };
  set('#library span:not(.aside)', 'library'); set('#library .aside', 'libraryAside'); set('#open', 'open'); set('#hint', 'hint', true);
  set('label.toggle:nth-of-type(1) b', 'details', true); set('label.toggle:nth-of-type(1) .muted', 'detailsHint');
  set('label.toggle:nth-of-type(2) b', 'agents', true); set('#agent-status', 'checking');
  set('#ytapi summary b', 'apiTitle'); set('#ytapi > p.muted', 'apiText'); set('#ytapi-save', 'save'); set('#ytapi-remove', 'removeKey'); set('#ytapi-copy', 'copy'); set('#ytapi-uncopy', 'uncopy');
  var key = document.getElementById('ytapi-key'); if (key) key.setAttribute('aria-label', T('apiTitle'));
  set('#features span:not(.aside-muted)', 'features'); set('#features .aside-muted', 'featuresAside'); set('h2.label', 'saved', true); set('#none', 'none'); set('#clear', 'clear'); set('footer .muted', 'foot', true);
}
localizeStatic();
if (self.OpenOutlierFeatures) self.OpenOutlierFeatures.ready.then(localizeStatic);

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
  document.getElementById('mentions-label').textContent = T('mentions') + (unread || watches ? '' : T('mentionsAdd'));
  var count = document.getElementById('mentions-count');
  count.textContent = T('newN', { n: unread });
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

/** Outliers (≥ 2× the account's median) among its reels/videos, all posts on Reddit, original posts on X. */
function outliersOf(posts) {
  var M = self.ReelScopeMetrics;
  if (!M) return 0;
  try {
    return M.enrich(Object.values(posts)).filter(function (p) {
      if (p.platform === 'x') return p.outlier && M.xKind(p) === 'original';
      return p.outlier && (p.platform === 'reddit' || p.platform === 'youtube' || p.type === 'reel' || p.type === 'video');
    }).length;
  } catch (e) { return 0; }
}

/** Reddit: r/excel, u/name · TikTok: tt/name → "@name (TikTok)" · YouTube: yt/name → "@name (YouTube)", yt/UC… → "UC… (YouTube)" · X: x/name → "@name (X)". */
function accountLabel(id) {
  if (/^(r|u)\//.test(id)) return id;
  if (/^x\//.test(id)) return '@' + id.slice(2) + ' (X)';
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
    a.title = T('openLib');
    a.addEventListener('click', function (e) { e.preventDefault(); openLibrary('#/account/' + encodeURIComponent(p.username)); });
    a.textContent = accountLabel(p.username);
    var n = document.createElement('span');
    n.className = 'num';
    n.textContent = nf.format(p.count);
    n.title = T('postsN', { n: nf.format(p.count) }, p.count);
    li.append(a, n);
    if (p.outliers) {
      // lime on ink: the outlier badge (brand: lime is reserved for outliers)
      var b = document.createElement('span');
      b.className = 'badge-outlier';
      b.title = T('outliersN', { n: nf.format(p.outliers) }, p.outliers);
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
  if (!confirm(T('clearConfirm'))) return;
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
  var lc = uiLang() === 'tr' ? 'tr-TR' : 'en-US';
  if (!agentsBox.checked) el.textContent = T('agentsOff');
  else if (b.connected) {
    var backup = b.lastBackupAt
      ? (b.lastBackupOk ? T('backupOk') : ' ⚠️' + T('backupBad')) + new Date(b.lastBackupAt).toLocaleString(lc) + '.'
      : T('noBackup');
    el.textContent = T('saving', { p: b.port, s: b.lastSyncAt ? T('synced', { t: new Date(b.lastSyncAt).toLocaleTimeString(lc) }) : '' }) + backup;
  }
  else el.textContent = T('notConnected') + (b.lastError ? T('lastError') + b.lastError : '');
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
    state.textContent = on ? T('apiOn', { u: nf.format(used), l: nf.format(A.DAILY_QUOTA) }) : b.bridgeApiKey ? T('apiBridgeOnly') : T('apiOff');
    input.placeholder = on ? T('savedKey', { k: key.slice(-4) }) : 'AIza…';
    remove.hidden = !on;
    msg.textContent = note != null ? note : on || onBridge ? T('quota', { u: nf.format(used), l: nf.format(A.DAILY_QUOTA) }) +
      (onBridge ? T('quotaSplit', { m: nf.format(mine), b: nf.format(onBridge) }) : '') + T('quotaTail') : '';

    // The bridge's copy, for background jobs (niche tracking).
    var connected = agentsBox.checked && b.connected;
    bridgeBox.hidden = !on && !b.bridgeApiKey;
    copyBtn.hidden = !on || !connected;
    copyBtn.textContent = b.bridgeApiKey ? T('copyAgain') : T('copy');
    uncopyBtn.hidden = !connected || !b.bridgeApiKey || b.bridgeApiKeySource !== 'file';
    bridgeState.textContent = bridgeNote || (!connected ? T('bridgeOff')
      : b.bridgeApiKey ? (b.bridgeApiKeySource === 'env' ? T('bridgeEnv') : T('bridgeHas'))
        : b.settingsAt ? T('bridgeNo') : T('bridgeChecking'));
  }

  async function bridgeKey(action) {
    copyBtn.disabled = uncopyBtn.disabled = true;
    var r = await chrome.runtime.sendMessage({ type: 'reelscope:bridge-key', action: action }).catch(function (e) { return { ok: false, error: e.message }; });
    copyBtn.disabled = uncopyBtn.disabled = false;
    show(null, r && r.ok ? (action === 'remove' ? T('removed') : T('copied')) : T('couldNot', { a: action === 'remove' ? T('aRemove') : T('aCopy'), e: (r && r.error) || T('noAnswer') }));
  }
  copyBtn.addEventListener('click', function () { bridgeKey('copy'); });
  uncopyBtn.addEventListener('click', function () { bridgeKey('remove'); });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var key = input.value.trim();
    if (!A.isKey(key)) { show(T('badKey')); return; }
    var granted = false;
    try { granted = await chrome.permissions.request({ origins: [API_ORIGIN] }); } catch (err) { granted = false; }
    if (!granted) { show(T('perm')); return; }
    await setSetting('youtubeApiKey', key);
    input.value = '';
    show(T('keySaved'));
  });
  remove.addEventListener('click', async function () {
    await setSetting('youtubeApiKey', '');
    chrome.permissions.remove({ origins: [API_ORIGIN] }).catch(function () {});
    show(T('keyRemoved'));
  });
  chrome.storage.onChanged.addListener(function (c) { if (c['rs:yt-api-quota'] || c['rs:bridge']) show(); });
  show();
})();
