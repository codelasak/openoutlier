// The X writing helper's service-worker side (src/x-llm-bg.js) in a sandbox with a fake chrome and a
// fake SDK (no request leaves the machine): who may set the key, off by default, prepare → confirm,
// the daily cap, refusals, the saved voice profile, and that no answer ever carries the key.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const src = (f) => readFileSync(join(__dirname, '..', 'src', f), 'utf8');
const FAKE_KEY = 'sk-ant-test-' + 'k'.repeat(40);
const EXT = 'chrome-extension://ext/';
const PAGE = { id: 'ext', url: EXT + 'dashboard/dashboard.html#/settings', tab: { id: 3 } };
const CONTENT = { id: 'ext', url: 'https://x.com/home', tab: { id: 4 } };

function okMessage(json, over = {}) {
  return {
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_details: null,
    content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: JSON.stringify(json) }],
    usage: { input_tokens: 400, cache_creation_input_tokens: 900, cache_read_input_tokens: 0, output_tokens: 600 },
    ...over
  };
}
const SCORE = {
  criteria: { hook: { points: 20, note: 'ok' }, one_idea: { points: 18, note: '' }, readability: { points: 16, note: '' }, originality: { points: 14, note: '' }, pattern_fit: { points: 10, note: '' } },
  bait_phrases: [], fix: { area: 'hook', instruction: 'Lead with the 40 s number.', why: 'Numbers lead your outliers.' }, rationale: 'Solid.'
};

function worker(opts = {}) {
  const local = JSON.parse(JSON.stringify(opts.local || {}));
  const session = {};
  const listeners = [];
  const perms = new Set(opts.granted ? ['https://api.anthropic.com/*'] : []);
  const calls = [];
  const clients = [];
  const store = (m) => ({
    get: async (k) => { const out = {}; for (const x of [].concat(k)) if (x in m) out[x] = JSON.parse(JSON.stringify(m[x])); return out; },
    set: async (o) => { for (const [k, v] of Object.entries(o)) m[k] = JSON.parse(JSON.stringify(v)); },
    remove: async (k) => { for (const x of [].concat(k)) delete m[x]; }
  });
  const chrome = {
    runtime: { id: 'ext', getURL: (p) => EXT + p, onMessage: { addListener: (fn) => listeners.push(fn) } },
    storage: { local: store(local), session: store(session) },
    permissions: { contains: async (q) => q.origins.every((o) => perms.has(o)) }
  };
  class APIError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
  class AuthenticationError extends APIError {}
  class RateLimitError extends APIError {}
  class Anthropic {
    constructor(o) { clients.push(JSON.parse(JSON.stringify(o))); this.beta = { messages: { create: async (params) => {
      calls.push(JSON.parse(JSON.stringify(params)));
      const r = opts.respond ? await opts.respond(params, calls.length) : okMessage(SCORE);
      if (r instanceof Error) throw r;
      return r;
    } } }; }
  }
  Object.assign(Anthropic, { APIError, AuthenticationError, RateLimitError });
  const sandbox = { console, Promise, Object, Array, JSON, Math, Number, String, RegExp, Error, Date, Uint8Array, isFinite, parseInt, crypto: webcrypto };
  sandbox.self = sandbox;
  sandbox.chrome = chrome;
  if (opts.sdk !== false) sandbox.AnthropicSDK = { Anthropic, betaJSONSchemaOutputFormat: (s) => ({ type: 'json_schema', schema: s }) };
  if (opts.composer) sandbox.OpenOutlierXComposer = opts.composer;
  vm.createContext(sandbox);
  for (const f of ['x-llm.js', 'x-llm-bg.js']) vm.runInContext(src(f), sandbox, { filename: f });
  const answers = [];
  // Answers cross the boundary as JSON, like chrome.runtime messages do.
  const send = (msg, sender = PAGE) => new Promise((resolve) => {
    let handled = false;
    listeners.forEach((fn) => { const r = fn(msg, sender, (a) => { const j = JSON.parse(JSON.stringify(a)); answers.push(j); resolve(j); }); if (r === true) handled = true; });
    if (!handled) setImmediate(() => resolve(undefined));
  });
  return { send, local, session, calls, clients, perms, answers, Anthropic };
}

async function ready(opts = {}) {
  const w = worker({ granted: true, ...opts });
  assert.equal((await w.send({ type: 'reelscope:x-llm-key', action: 'set', key: FAKE_KEY })).ok, true);
  assert.equal((await w.send({ type: 'reelscope:x-llm-settings', patch: { enabled: true, ...(opts.settings || {}) } })).ok, true);
  return w;
}
function noKeyAnywhere(w) {
  for (const a of w.answers) assert.equal(JSON.stringify(a).includes(FAKE_KEY), false, JSON.stringify(a).slice(0, 200));
}

test('off by default; nothing is sent without the switch, the key, the permission', async () => {
  const w = worker();
  const s = await w.send({ type: 'reelscope:x-llm-status' });
  assert.deepEqual([s.ok, s.enabled, s.hasKey, s.permission, s.ready, s.model, s.effortScore, s.effortWrite, s.dailyCapUsd], [true, false, false, false, false, 'claude-opus-5-5', 'low', 'medium', 1]);
  assert.deepEqual(s.models.map((m) => m.id), ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
  assert.equal((await w.send({ type: 'reelscope:x-llm-prepare', task: 'scoreDraft', input: { draft: 'd' } }, CONTENT)).code, 'disabled');
  assert.equal((await w.send({ type: 'reelscope:x-llm-settings', patch: { enabled: true } })).code, 'no_permission', 'the page asks Chrome first');
  w.perms.add('https://api.anthropic.com/*');
  assert.equal((await w.send({ type: 'reelscope:x-llm-settings', patch: { enabled: true } })).enabled, true);
  assert.equal((await w.send({ type: 'reelscope:x-llm-prepare', task: 'scoreDraft', input: { draft: 'd' } }, CONTENT)).code, 'no_key');
  w.perms.clear();
  await w.send({ type: 'reelscope:x-llm-key', action: 'set', key: FAKE_KEY });
  assert.equal((await w.send({ type: 'reelscope:x-llm-prepare', task: 'scoreDraft', input: { draft: 'd' } }, CONTENT)).code, 'no_permission');
  const w2 = await ready({ sdk: false });
  assert.equal((await w2.send({ type: 'reelscope:x-llm-prepare', task: 'scoreDraft', input: { draft: 'd' } }, CONTENT)).code, 'no_sdk');
  assert.equal(w.calls.length + w2.calls.length, 0);
});

test('the key: set and removed only from extension pages, stored outside rs:, never returned', async () => {
  const w = worker({ granted: true });
  const fromPage = await w.send({ type: 'reelscope:x-llm-key', action: 'set', key: FAKE_KEY }, CONTENT);
  assert.deepEqual([fromPage.ok, fromPage.code], [false, 'forbidden']);
  assert.equal(w.local['xllm:key'], undefined);
  assert.equal((await w.send({ type: 'reelscope:x-llm-key', action: 'set', key: 'sk-proj-nope' })).code, 'bad_key');
  const set = await w.send({ type: 'reelscope:x-llm-key', action: 'set', key: '  ' + FAKE_KEY + ' ' });
  assert.deepEqual([set.ok, set.keyHint], [true, '…kkkk']);
  assert.equal(w.local['xllm:key'], FAKE_KEY);
  assert.equal(Object.keys(w.local).filter((k) => k.startsWith('rs:') && JSON.stringify(w.local[k]).includes(FAKE_KEY)).length, 0, 'not in any rs: key (backups, bridge)');
  assert.equal((await w.send({ type: 'reelscope:x-llm-status' })).keyHint, '…kkkk');
  const cs = await w.send({ type: 'reelscope:x-llm-status' }, CONTENT);
  assert.deepEqual([cs.hasKey, cs.keyHint], [true, undefined], 'content scripts learn only that a key exists');
  assert.equal((await w.send({ type: 'reelscope:x-llm-settings', patch: { dailyCapUsd: 50 } }, CONTENT)).code, 'forbidden');
  assert.equal((await w.send({ type: 'reelscope:x-llm-key', action: 'remove' }, CONTENT)).code, 'forbidden');
  assert.equal(w.local['xllm:key'], FAKE_KEY);
  assert.equal((await w.send({ type: 'reelscope:x-llm-key', action: 'remove' })).hasKey, false);
  assert.equal(w.local['xllm:key'], undefined);
  // Another extension, or a message without our type prefix, gets no answer.
  assert.equal(await w.send({ type: 'reelscope:x-llm-status' }, { id: 'other', url: 'chrome-extension://other/x.html' }), undefined);
  noKeyAnywhere(w);
});

test('prepare shows exactly what will be sent and sends nothing; confirm sends it once and counts the cost', async () => {
  const w = await ready();
  const draft = 'I cut our CI from 9 minutes to 40 seconds.\n\nThree changes did it.';
  const p = await w.send({ type: 'reelscope:x-llm-prepare', task: 'scoreDraft', input: { draft }, examples: [{ text: '3 Excel tricks', x: 4.2 }] }, CONTENT);
  assert.equal(p.ok, true);
  assert.equal(w.calls.length, 0, 'nothing sent on prepare');
  assert.match(p.id, /^[0-9a-f]{18}$/);
  assert.equal(p.preview.model, 'claude-opus-5-5');
  assert.equal(p.preview.effort, 'low');
  assert.match(p.preview.message, /I cut our CI/);
  assert.match(p.preview.context, /\(4\.2×\) 3 Excel tricks/);
  assert.ok(p.estimate.usdTypical > 0 && p.estimate.usdMax > p.estimate.usdTypical);
  assert.deepEqual(p.spend, { todayUsd: 0, capUsd: 1, calls: 0 });

  const r = await w.send({ type: 'reelscope:x-llm-confirm', id: p.id }, CONTENT);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(w.calls.length, 1);
  assert.deepEqual(w.clients[0], { apiKey: FAKE_KEY, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 120000 });
  const sent = w.calls[0];
  assert.equal(sent.messages[0].content, p.preview.message, 'sent = previewed');
  assert.equal(sent.system[1].text, p.preview.context);
  assert.deepEqual([sent.model, sent.output_config.effort, sent.fallbacks, sent.betas], ['claude-opus-5-5', 'low', 'default', ['server-side-fallback-2026-07-01']]);
  assert.deepEqual(sent.system[1].cache_control, { type: 'ephemeral' });
  assert.equal(r.result.score, 78);
  assert.equal(r.result.fix.instruction, 'Lead with the 40 s number.');
  const usd = (400 * 4 + 900 * 4 * 1.25 + 600 * 20) / 1e6;
  assert.equal(r.cost.usd, usd);
  assert.equal(r.cost.estimateUsd, p.estimate.usdTypical);
  assert.deepEqual(r.cost.tokens, { input: 400, cacheWrite: 900, cacheRead: 0, output: 600 });
  assert.deepEqual([r.spend.todayUsd, r.spend.calls, r.fallback], [usd, 1, false]);
  const st = await w.send({ type: 'reelscope:x-llm-status' });
  assert.deepEqual([st.spentTodayUsd, st.callsToday, st.ready], [usd, 1, true]);
  // One shot: the same id can't be sent twice.
  assert.equal((await w.send({ type: 'reelscope:x-llm-confirm', id: p.id }, CONTENT)).code, 'expired');
  assert.equal(w.calls.length, 1);
  // Cancel drops a preview.
  const p2 = await w.send({ type: 'reelscope:x-llm-prepare', task: 'hooks', input: { draft } }, CONTENT);
  assert.equal(p2.preview.effort, 'medium', 'writing effort');
  assert.equal((await w.send({ type: 'reelscope:x-llm-cancel', id: p2.id }, CONTENT)).cancelled, true);
  assert.equal((await w.send({ type: 'reelscope:x-llm-confirm', id: p2.id }, CONTENT)).code, 'expired');
  noKeyAnywhere(w);
});

test('the daily cap: refused before sending when the worst case could pass it; counted after a call', async () => {
  // Opus 5.5 scoring: max_tokens 4000 × $20/M = $0.08 worst-case output alone.
  const w = await ready({ settings: { dailyCapUsd: 0.05 } });
  const p = await w.send({ type: 'reelscope:x-llm-prepare', task: 'scoreDraft', input: { draft: 'd' } }, CONTENT);
  assert.equal(p.code, 'cap');
  assert.match(p.error, /daily cap/);
  assert.equal(w.calls.length, 0);
  // Haiku is cheap enough under the same cap; a big spend then blocks the next one.
  await w.send({ type: 'reelscope:x-llm-settings', patch: { model: 'claude-haiku-5-5' } });
  const ph = await w.send({ type: 'reelscope:x-llm-prepare', task: 'scoreDraft', input: { draft: 'd' } }, CONTENT);
  assert.equal(ph.ok, true);
  w.local['rs:x-llm-spend'] = { days: { [new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0') + '-' + String(new Date().getDate()).padStart(2, '0')]: { usd: 0.049, calls: 9 } } };
  const c = await w.send({ type: 'reelscope:x-llm-confirm', id: ph.id }, CONTENT);
  assert.equal(c.code, 'cap', 'checked again at confirm');
  assert.equal(w.calls.length, 0);
});

test('refusal, cut-off and API errors: reported with codes; billed answers still count; errors never echo the key', async () => {
  const w = await ready({
    respond: (params, n) => n === 1
      ? okMessage({}, { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: 'declined' }, content: [], usage: { input_tokens: 300, output_tokens: 0 } })
      : n === 2 ? okMessage({}, { stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"criteria":' }], usage: { input_tokens: 300, output_tokens: 4000 } })
        : n === 3 ? new w.Anthropic.AuthenticationError(401, 'invalid x-api-key ' + FAKE_KEY)
          : okMessage({ not: 'the schema' })
  });
  const go = async () => {
    const p = await w.send({ type: 'reelscope:x-llm-prepare', task: 'scoreDraft', input: { draft: 'd' } }, CONTENT);
    return w.send({ type: 'reelscope:x-llm-confirm', id: p.id }, CONTENT);
  };
  const a = await go();
  assert.deepEqual([a.ok, a.code, a.category, a.stop], [false, 'refusal', 'cyber', 'refusal']);
  assert.equal(a.cost.usd, 300 * 4 / 1e6);
  const b = await go();
  assert.deepEqual([b.ok, b.code], [false, 'max_tokens']);
  const c = await go();
  assert.deepEqual([c.ok, c.code, c.status], [false, 'auth', 401]);
  assert.match(c.error, /sk-ant-…/);
  const d = await go();
  assert.deepEqual([d.ok, d.code], [false, 'bad_output']);
  const st = await w.send({ type: 'reelscope:x-llm-status' });
  assert.equal(st.callsToday, 3, 'three answers were billed; the 401 was not');
  noKeyAnywhere(w);
});

test('ideaToDraft asks for their own material before anything else', async () => {
  const w = await ready();
  const p = await w.send({ type: 'reelscope:x-llm-prepare', task: 'ideaToDraft', input: { idea: 'XLOOKUP beats VLOOKUP' } }, CONTENT);
  assert.deepEqual([p.ok, p.code], [false, 'need_material']);
  assert.match(p.question.en, /your own experience, data or example/);
  const q = await w.send({ type: 'reelscope:x-llm-prepare', task: 'ideaToDraft', input: { idea: 'XLOOKUP beats VLOOKUP', material: 'A client\'s 40k-row sheet went from 12 s to 1 s.' } }, CONTENT);
  assert.equal(q.ok, true);
  assert.equal(w.calls.length, 0);
});

test('voice profile: written by the model, saved, edited on the Library page only, then in the cached block', async () => {
  const w = await ready({ respond: (params) => params.messages[0].content.includes('voice profile')
    ? okMessage({ profile: 'Dry, short, numbers first.', tone: 'dry', typical_length: 'one line', openers: ['a number'], frequent_words: ['Excel'], emoji: 'none', languages: ['en'] })
    : okMessage(SCORE) });
  const p = await w.send({ type: 'reelscope:x-llm-prepare', task: 'voiceProfile', input: { posts: ['3 tricks…', '40 s builds…'] } }, CONTENT);
  const r = await w.send({ type: 'reelscope:x-llm-confirm', id: p.id }, CONTENT);
  assert.equal(r.result.profile, 'Dry, short, numbers first.');
  assert.deepEqual([w.local['rs:x-voice'].text, w.local['rs:x-voice'].source], ['Dry, short, numbers first.', 'llm']);
  assert.equal((await w.send({ type: 'reelscope:x-llm-voice', action: 'get' }, CONTENT)).voice.text, 'Dry, short, numbers first.');
  assert.equal((await w.send({ type: 'reelscope:x-llm-voice', action: 'save', text: 'hijacked' }, CONTENT)).code, 'forbidden');
  assert.equal((await w.send({ type: 'reelscope:x-llm-voice', action: 'save', text: 'Dry, short. Numbers first. No emoji.' })).voice.source, 'edited');
  const s = await w.send({ type: 'reelscope:x-llm-prepare', task: 'scoreDraft', input: { draft: 'd' } }, CONTENT);
  assert.match(s.preview.context, /Numbers first\. No emoji\./);
});

test('engagement bait found without the LLM lowers the score even if the model missed it', async () => {
  const composer = { findBait: (t) => /follow for more/i.test(t) ? [{ text: 'Follow for more', level: 'warn' }] : [], weightedLength: (s) => ({ weighted: s.length }) };
  const w = await ready({ composer });
  const p = await w.send({ type: 'reelscope:x-llm-prepare', task: 'scoreDraft', input: { draft: 'Great tip. Follow for more' } }, CONTENT);
  const r = await w.send({ type: 'reelscope:x-llm-confirm', id: p.id }, CONTENT);
  assert.deepEqual([r.result.score, r.result.penalty, r.result.bait], [58, 20, ['Follow for more']]);
});
