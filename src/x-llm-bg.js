// OpenOutlier – the X writing helper with the user's own Anthropic key, service-worker side
// (docs/x-plan.md 1 "BYOK", 5.4; message API in docs/x-llm-notes.md).
//
// Off by default (rs:x-llm.enabled). The default way to get LLM help is Claude through MCP, which
// needs no key (mcp/x-llm-tools.mjs). When the user turns this on in the Library's Settings:
//   • the key is kept in chrome.storage.local under `xllm:key` (not rs:…, so it is never in a
//     Library backup, the bridge snapshot or rs:settings). Only this file reads it; no message
//     returns it, and only extension pages (not content scripts) may set or remove it;
//   • calls go to api.anthropic.com through the official SDK (vendor/anthropic-sdk.js), with the
//     optional host permission the Settings page requests when the feature is turned on;
//   • every call has two steps: prepare returns exactly what will be sent (the preview) and the
//     estimated cost, nothing leaves the browser; confirm sends that same request. The answer
//     carries the real usage and $ cost, which is added to the day's spend. A call that could go
//     past the daily cap (at its worst case, max_tokens) is refused before sending.
//   • the output is a starting draft. Nothing here fills the composer or posts.
'use strict';

(function () {
  var L = self.OpenOutlierXLlm;
  var KEY_STORE = 'xllm:key';
  var SETTINGS = 'rs:x-llm';
  var SPEND = 'rs:x-llm-spend';
  var VOICE = 'rs:x-voice';
  var PENDING = 'xllm:pending';
  var ORIGIN = 'https://api.anthropic.com/*';
  var PENDING_TTL = 15 * 60 * 1000;
  var MAX_PENDING = 20;

  function sdk() { return self.AnthropicSDK || null; }
  function composer() { return self.OpenOutlierXComposer || null; }
  function sessionArea() { return chrome.storage.session || chrome.storage.local; }
  function fail(code, error, extra) { return Object.assign({ ok: false, code: code, error: L.scrub(error) }, extra || {}); }

  async function readKey() {
    var r = await chrome.storage.local.get(KEY_STORE);
    var k = r[KEY_STORE];
    return L.isKey(k) ? k.trim() : null;
  }
  async function settings() {
    var r = await chrome.storage.local.get(SETTINGS);
    return L.normalizeSettings(r[SETTINGS]);
  }
  async function permitted() {
    try { return !!(chrome.permissions && await chrome.permissions.contains({ origins: [ORIGIN] })); } catch (e) { return false; }
  }
  async function spendToday() {
    var r = await chrome.storage.local.get(SPEND);
    return L.spentOn(r[SPEND], L.dayKey());
  }

  // Spend writes are serialized so two quick answers can't lose one.
  var spending = Promise.resolve();
  function addSpend(usd) {
    spending = spending.then(async function () {
      var r = await chrome.storage.local.get(SPEND);
      var o = {};
      o[SPEND] = L.addSpend(r[SPEND], L.dayKey(), usd);
      await chrome.storage.local.set(o);
    }).catch(function () {});
    return spending;
  }

  /** Extension pages only (the Library, the popup): a content script's sender.url is the web page. */
  function fromExtensionPage(sender) {
    var base = chrome.runtime.getURL ? chrome.runtime.getURL('') : 'chrome-extension://' + chrome.runtime.id + '/';
    return !!(sender && sender.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.indexOf(base) === 0);
  }

  async function status(sender) {
    var s = await settings();
    var key = await readKey();
    var spent = await spendToday();
    var out = {
      ok: true, enabled: s.enabled, hasKey: !!key, permission: await permitted(),
      model: s.model, effortScore: s.effortScore, effortWrite: s.effortWrite, dailyCapUsd: s.dailyCapUsd,
      spentTodayUsd: spent.usd, callsToday: spent.calls, sdk: !!sdk(),
      models: L.MODELS.map(function (m) { return { id: m.id, label: m.label, input: m.input, output: m.output }; })
    };
    // The last four characters help the user recognize the key; only extension pages get them.
    if (key && fromExtensionPage(sender)) out.keyHint = '…' + key.slice(-4);
    out.ready = out.enabled && out.hasKey && out.permission && out.sdk;
    return out;
  }

  async function setKey(msg) {
    if (msg.action === 'remove') {
      await chrome.storage.local.remove(KEY_STORE);
      return { ok: true, hasKey: false };
    }
    var k = String(msg.key || '').trim();
    if (!L.isKey(k)) return fail('bad_key', 'That does not look like an Anthropic API key (it starts with sk-ant-).');
    var o = {};
    o[KEY_STORE] = k;
    await chrome.storage.local.set(o);
    return { ok: true, hasKey: true, keyHint: '…' + k.slice(-4) };
  }

  async function setSettings(msg) {
    var r = await chrome.storage.local.get(SETTINGS);
    var cur = Object.assign({}, r[SETTINGS]);
    var patch = msg.patch || {};
    ['enabled', 'model', 'effortScore', 'effortWrite', 'dailyCapUsd'].forEach(function (k) { if (k in patch) cur[k] = patch[k]; });
    if (cur.enabled === true && !(await permitted())) return fail('no_permission', 'Chrome has not allowed api.anthropic.com yet.');
    var next = L.normalizeSettings(cur);
    var o = {};
    o[SETTINGS] = next;
    await chrome.storage.local.set(o);
    return Object.assign({ ok: true }, next);
  }

  async function voice(msg) {
    if (msg.action === 'save') {
      var text = String(msg.text || '').slice(0, 8000);
      var o = {};
      o[VOICE] = text.trim() ? { text: text, updatedAt: Date.now(), source: 'edited' } : null;
      if (o[VOICE]) await chrome.storage.local.set(o); else await chrome.storage.local.remove(VOICE);
      return { ok: true, voice: o[VOICE] };
    }
    var r = await chrome.storage.local.get(VOICE);
    return { ok: true, voice: r[VOICE] || null };
  }

  // ---- prepare → confirm ---------------------------------------------------------------------------------
  async function pendingAll() {
    var r = await sessionArea().get(PENDING);
    var all = Object.assign({}, r[PENDING]);
    var now = Date.now();
    Object.keys(all).forEach(function (id) { if (!all[id] || now - all[id].at > PENDING_TTL) delete all[id]; });
    return all;
  }
  async function pendingSave(all) {
    var o = {};
    o[PENDING] = all;
    await sessionArea().set(o);
  }
  function newId() {
    var a = new Uint8Array(9);
    (self.crypto || crypto).getRandomValues(a);
    return Array.from(a, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  /** Why a call can't run now, or null. */
  async function blocked(s) {
    if (!s.enabled) return fail('disabled', 'The writing helper with your own key is off. Turn it on in Library → Settings, or use Claude through MCP.');
    if (!(await readKey())) return fail('no_key', 'No Anthropic API key is set. Add one in Library → Settings.');
    if (!(await permitted())) return fail('no_permission', 'Chrome has not allowed api.anthropic.com. Turn the feature off and on again in Library → Settings.');
    if (!sdk()) return fail('no_sdk', 'The Anthropic SDK did not load (vendor/anthropic-sdk.js).');
    return null;
  }
  function overCap(spent, worst, cap) { return spent + worst > cap + 1e-9; }

  /**
   * msg: { task, input, examples?, patterns? } → { ok, id, preview, estimate, spend } — nothing is sent.
   * examples: the user's own posts to show the model (their outliers, or posts they picked), [{ text, x }].
   */
  async function prepare(msg) {
    var s = await settings();
    var no = await blocked(s);
    if (no) return no;
    var t = L.TASKS[msg.task];
    if (!t) return fail('bad_task', 'Unknown task: ' + msg.task);
    var v = (await chrome.storage.local.get(VOICE))[VOICE];
    var built;
    try {
      built = L.buildRequest(msg.task, msg.input || {}, {
        model: s.model, effort: t.kind === 'score' ? s.effortScore : s.effortWrite,
        voice: v && v.text, examples: msg.examples, patterns: msg.patterns,
        transformSchema: sdk().betaJSONSchemaOutputFormat
      });
    } catch (e) {
      return fail(e.code || 'bad_input', e.message, e.question ? { question: e.question } : null);
    }
    var est = L.estimate(built.params, msg.task);
    var spent = await spendToday();
    var spend = { todayUsd: spent.usd, capUsd: s.dailyCapUsd, calls: spent.calls };
    if (overCap(spent.usd, est.usdMax, s.dailyCapUsd)) {
      return fail('cap', 'This call could cost up to $' + est.usdMax.toFixed(4) + ' and today\'s spend is $' + spent.usd.toFixed(4) + ' of the $' + s.dailyCapUsd.toFixed(2) + ' daily cap.',
        { estimate: est, spend: spend });
    }
    var all = await pendingAll();
    var ids = Object.keys(all).sort(function (a, b) { return all[a].at - all[b].at; });
    while (ids.length >= MAX_PENDING) delete all[ids.shift()];
    var id = newId();
    all[id] = { at: Date.now(), task: msg.task, params: built.params, estimate: est };
    await pendingSave(all);
    return { ok: true, id: id, task: msg.task, preview: built.preview, estimate: est, spend: spend };
  }

  async function cancel(msg) {
    var all = await pendingAll();
    var had = !!all[msg.id];
    delete all[msg.id];
    await pendingSave(all);
    return { ok: true, cancelled: had };
  }

  function errorOf(e) {
    var A = sdk() && sdk().Anthropic;
    var status = e && e.status;
    var code = 'api';
    if (A && A.AuthenticationError && e instanceof A.AuthenticationError) code = 'auth';
    else if (A && A.PermissionDeniedError && e instanceof A.PermissionDeniedError) code = 'forbidden';
    else if (A && A.RateLimitError && e instanceof A.RateLimitError) code = 'rate_limit';
    else if (A && A.BadRequestError && e instanceof A.BadRequestError) code = 'bad_request';
    else if (A && A.APIConnectionError && e instanceof A.APIConnectionError) code = 'network';
    return fail(code, (e && e.message) || String(e), status ? { status: status } : null);
  }

  /** msg: { id } → sends the prepared request. */
  async function confirm(msg) {
    var all = await pendingAll();
    var p = all[msg.id];
    if (!p) return fail('expired', 'Nothing to send: the preview expired or was already sent. Prepare it again.');
    delete all[msg.id];
    await pendingSave(all);
    var s = await settings();
    var no = await blocked(s);
    if (no) return no;
    // The model, effort or cap may have changed since the preview: the prepared request is sent as
    // previewed, and the cap is checked again against today's spend now.
    var spent = await spendToday();
    if (overCap(spent.usd, p.estimate.usdMax, s.dailyCapUsd)) {
      return fail('cap', 'Today\'s spend ($' + spent.usd.toFixed(4) + ') plus this call\'s worst case would pass the $' + s.dailyCapUsd.toFixed(2) + ' daily cap.');
    }
    var key = await readKey();
    var client = new (sdk().Anthropic)({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 120000 });
    key = null;
    var res;
    try {
      res = await client.beta.messages.create(p.params);
    } catch (e) {
      return errorOf(e);
    }
    var cost = L.costOf(res.usage, p.params.model);
    await addSpend(cost.usd);
    var after = await spendToday();
    var base = {
      task: p.task, model: res.model || p.params.model, fallback: cost.fallback, stop: res.stop_reason,
      cost: { usd: cost.usd, approx: cost.approx, estimateUsd: p.estimate.usdTypical, tokens: cost.tokens, models: cost.models },
      spend: { todayUsd: after.usd, capUsd: s.dailyCapUsd, calls: after.calls }
    };
    if (res.stop_reason === 'refusal') {
      var d = res.stop_details || {};
      return Object.assign(fail('refusal', 'Claude declined this request' + (d.explanation ? ': ' + d.explanation : '.'), { category: d.category || null }), base);
    }
    if (res.stop_reason === 'max_tokens') return Object.assign(fail('max_tokens', 'The answer was cut off at max_tokens. Try again, or with a shorter text.'), base);
    var text = (res.content || []).filter(function (b) { return b && b.type === 'text'; }).map(function (b) { return b.text; }).join('');
    var result;
    try {
      var X = composer();
      result = L.finish(p.task, JSON.parse(text), {
        bait: p.task === 'scoreDraft' && X ? X.findBait(lastDraft(p)).filter(function (b) { return b.level === 'warn'; }) : [],
        weightedLength: X ? X.weightedLength : null
      });
    } catch (e) {
      return Object.assign(fail('bad_output', e.message), base);
    }
    if (p.task === 'voiceProfile') {
      var o = {};
      o[VOICE] = { text: result.profile, updatedAt: Date.now(), source: 'llm', model: base.model };
      await chrome.storage.local.set(o);
    }
    return Object.assign({ ok: true, result: result }, base);
  }

  /** The draft inside a prepared scoreDraft request (for the LLM-free bait check). */
  function lastDraft(p) {
    var m = /<draft>\n([\s\S]*)\n<\/draft>/.exec(String(p.params.messages[0].content || ''));
    return m ? m[1] : '';
  }

  var OPEN = {
    'reelscope:x-llm-status': function (msg, sender) { return status(sender); },
    'reelscope:x-llm-prepare': prepare,
    'reelscope:x-llm-confirm': confirm,
    'reelscope:x-llm-cancel': cancel,
    'reelscope:x-llm-voice': function (msg) { return msg.action === 'save' ? null : voice(msg); }
  };
  // Changing the key, the settings or the saved voice profile: extension pages only.
  var PAGE_ONLY = {
    'reelscope:x-llm-key': setKey,
    'reelscope:x-llm-settings': setSettings,
    'reelscope:x-llm-voice': voice
  };

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !sender || sender.id !== chrome.runtime.id || typeof msg.type !== 'string' || msg.type.indexOf('reelscope:x-llm-') !== 0) return;
    var page = fromExtensionPage(sender);
    var fn = page && PAGE_ONLY[msg.type] ? PAGE_ONLY[msg.type] : OPEN[msg.type];
    var p = fn ? fn(msg, sender) : null;
    if (!p) { sendResponse(fail('forbidden', 'Not allowed from here: ' + msg.type)); return; }
    p.then(sendResponse, function (e) { sendResponse(fail('error', (e && e.message) || String(e))); });
    return true;
  });

  self.OpenOutlierXLlmBg = { status: status, prepare: prepare, confirm: confirm, cancel: cancel, setKey: setKey, setSettings: setSettings, voice: voice, fromExtensionPage: fromExtensionPage };
})();
