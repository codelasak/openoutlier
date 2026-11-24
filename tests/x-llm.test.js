// The X writing helper's pure layer (src/x-llm.js): requests, schemas, cost, results, the ledger.
// Plus the bundled SDK (vendor/anthropic-sdk.js) in a window-less sandbox like the service worker,
// against a fake fetch: no request leaves this machine.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const L = require('../src/x-llm.js');

const FAKE_KEY = 'sk-ant-test-' + 'x'.repeat(40);

function walk(schema, fn, path = '$') {
  fn(schema, path);
  if (schema.properties) for (const [k, v] of Object.entries(schema.properties)) walk(v, fn, path + '.' + k);
  if (schema.items) walk(schema.items, fn, path + '[]');
}

test('every task has a closed JSON schema (structured outputs: additionalProperties false, all required)', () => {
  assert.deepEqual(L.TASK_IDS.sort(), ['hooks', 'ideaToDraft', 'replyAngles', 'scoreDraft', 'splitThread', 'translate', 'variants', 'voiceProfile']);
  for (const id of L.TASK_IDS) {
    walk(L.SCHEMAS[id], (s, p) => {
      if (s.type === 'object') {
        assert.equal(s.additionalProperties, false, id + ' ' + p);
        assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), id + ' ' + p);
      }
      for (const bad of ['minimum', 'maximum', 'minItems', 'maxItems', 'pattern']) assert.equal(s[bad], undefined, id + ' ' + p + ' ' + bad);
    });
  }
  // Exactly one fix: an object, not a list.
  assert.equal(L.SCHEMAS.scoreDraft.properties.fix.type, 'object');
});

test('buildRequest: rules + cached voice block, effort and format in output_config, fallbacks on Opus/Sonnet only', () => {
  const r = L.buildRequest('scoreDraft', { draft: 'I cut our build from 9 min to 40 s.\n\nHere is how.' }, {
    model: 'claude-opus-5-5', effort: 'low', voice: 'Short, dry, numbers first.', examples: [{ text: '3 Excel tricks I use daily', x: 4.21 }], patterns: ['70% of their ≥2× posts open with a number (40% of all their posts).']
  });
  const p = r.params;
  assert.equal(p.model, 'claude-opus-5-5');
  assert.equal(p.max_tokens, 4000);
  assert.equal(p.system.length, 2);
  assert.equal(p.system[0].cache_control, undefined);
  assert.deepEqual(p.system[1].cache_control, { type: 'ephemeral' });
  assert.match(p.system[1].text, /Short, dry, numbers first\./);
  assert.match(p.system[1].text, /\(4\.2×\) 3 Excel tricks/);
  assert.match(p.system[1].text, /70% of their/);
  assert.equal(p.messages.length, 1);
  assert.match(p.messages[0].content, /<draft>\nI cut our build/);
  assert.match(p.messages[0].content, /exactly one fix/i);
  assert.equal(p.output_config.effort, 'low');
  assert.equal(p.output_config.format.type, 'json_schema');
  assert.equal(p.output_config.format.schema, L.SCHEMAS.scoreDraft);
  assert.deepEqual([p.betas, p.fallbacks], [['server-side-fallback-2026-07-01'], 'default']);
  assert.equal(p.thinking, undefined, 'adaptive thinking is the default; never disabled on Opus 5.5');
  assert.equal(p.temperature, undefined);
  // The preview is exactly what is sent.
  assert.equal(r.preview.message, p.messages[0].content);
  assert.equal(r.preview.context, p.system[1].text);

  const s = L.buildRequest('hooks', { draft: 'x' }, { model: 'claude-sonnet-5-5' }).params;
  assert.deepEqual([s.fallbacks, s.output_config.effort], ['default', 'medium']);
  const h = L.buildRequest('hooks', { draft: 'x' }, { model: 'claude-haiku-5-5', effort: 'high' }).params;
  assert.deepEqual([h.betas, h.fallbacks, h.output_config.effort], [undefined, undefined, 'high'], 'Haiku 5.5 has no server-side fallback');
  // The cached block is the same for every task (one cache across tasks).
  const ctx = { voice: 'V', examples: [{ text: 'E', x: 3 }] };
  assert.equal(L.buildRequest('hooks', { draft: 'a' }, ctx).params.system[1].text, L.buildRequest('translate', { text: 'b', to: 'tr' }, ctx).params.system[1].text);
  // No voice profile yet: still a cache block, with a note.
  assert.match(L.buildRequest('hooks', { draft: 'a' }).params.system[1].text, /No voice profile yet/);
});

test('buildRequest: ideaToDraft asks for their own material first; bad input and unknown tasks', () => {
  assert.throws(() => L.buildRequest('ideaToDraft', { idea: 'pivot tables are underrated' }), (e) => e.code === 'need_material' && /deneyimin/.test(e.question.tr) && /experience/.test(e.question.en));
  const r = L.buildRequest('ideaToDraft', { idea: 'pivot tables', material: 'Cut a 2-hour monthly report to 5 minutes for my accountant client.' });
  assert.match(r.params.messages[0].content, /<material>\nCut a 2-hour/);
  assert.throws(() => L.buildRequest('scoreDraft', { draft: '   ' }), (e) => e.code === 'bad_input');
  assert.throws(() => L.buildRequest('translate', { text: 'hi', to: 'de' }), (e) => e.code === 'bad_input');
  assert.throws(() => L.buildRequest('voiceProfile', { posts: [] }), (e) => e.code === 'bad_input');
  assert.throws(() => L.buildRequest('rewriteViral', { draft: 'x' }), (e) => e.code === 'bad_task');
  assert.throws(() => L.buildRequest('variants', { draft: 'd' }), (e) => e.code === 'bad_input', 'variants need the fix');
  const v = L.buildRequest('variants', { draft: 'd', fix: { instruction: 'Open with the number.' } });
  assert.match(v.params.messages[0].content, /three different ways/);
  const vp = L.buildRequest('voiceProfile', { posts: Array.from({ length: 150 }, (_, i) => ({ text: 'post ' + i })) });
  assert.match(vp.params.messages[0].content, /these 100 original posts/);
  const t = L.buildRequest('splitThread', { text: 'long', maxPosts: 99 });
  assert.match(t.params.messages[0].content, /at most 25 posts/);
});

test('estimate: local, before sending; worst case at max_tokens', () => {
  const { params } = L.buildRequest('scoreDraft', { draft: 'a'.repeat(320) }, { model: 'claude-opus-5-5' });
  const e = L.estimate(params, 'scoreDraft');
  assert.ok(e.inputTokens > 100 && e.inputTokens < 3000, String(e.inputTokens));
  assert.equal(e.outputTokensMax, 4000);
  assert.ok(e.usdMax > e.usdTypical);
  assert.ok(Math.abs(e.usdMax - e.usdTypical - (4000 - 1200) * 20 / 1e6) < 1e-6);
  const cheap = L.estimate(L.buildRequest('scoreDraft', { draft: 'a'.repeat(320) }, { model: 'claude-haiku-5-5' }).params, 'scoreDraft');
  assert.ok(cheap.usdMax < e.usdMax / 30);
});

test('costOf: cache writes and reads, Haiku above 100K, fallback iterations at their own rates', () => {
  const c = L.costOf({ input_tokens: 1000, cache_creation_input_tokens: 2000, cache_read_input_tokens: 0, output_tokens: 500 }, 'claude-opus-5-5');
  assert.equal(c.usd, (1000 * 4 + 2000 * 4 * 1.25 + 500 * 20) / 1e6);
  const r = L.costOf({ input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 2000, output_tokens: 300 }, 'claude-sonnet-5-5');
  assert.equal(r.usd, (100 * 2 + 2000 * 0.10 + 300 * 10) / 1e6);
  const oneHour = L.costOf({ input_tokens: 0, cache_creation_input_tokens: 1000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1000 }, output_tokens: 0 }, 'claude-opus-5-5');
  assert.equal(oneHour.usd, 1000 * 4 * 2 / 1e6);
  const big = L.costOf({ input_tokens: 150000, output_tokens: 1000 }, 'claude-haiku-5-5');
  assert.equal(big.usd, (150000 * 0.5 + 1000 * 2.5) / 1e6);
  const fb = L.costOf({ input_tokens: 0, output_tokens: 0, iterations: [
    { type: 'message', model: 'claude-opus-5-5', input_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 100 },
    { type: 'fallback_message', model: 'claude-opus-4-8', input_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 200 }
  ] }, 'claude-opus-5-5');
  assert.equal(fb.usd, Math.round(((1000 * 4 + 100 * 20) + (1000 * 5 + 200 * 25)) / 1e6 * 1e6) / 1e6);
  assert.deepEqual([fb.fallback, fb.models, fb.tokens.output, fb.approx], [true, ['claude-opus-5-5', 'claude-opus-4-8'], 300, false]);
  assert.equal(L.costOf({ iterations: [{ type: 'fallback_message', model: 'claude-mystery-9', input_tokens: 10, output_tokens: 10 }] }, 'claude-opus-5-5').approx, true);
});

test('finish: the score is the sum of the criteria, bait costs 20 (from the model or the LLM-free check), exactly one fix', () => {
  const data = {
    criteria: { hook: { points: 30, note: 'n' }, one_idea: { points: 15, note: '' }, readability: { points: 18, note: '' }, originality: { points: 12, note: '' }, pattern_fit: { points: -3, note: '' } },
    bait_phrases: [], fix: { area: 'hook', instruction: 'Open with the 9 min → 40 s number.', why: 'Your outliers open with numbers.' }, rationale: 'r'
  };
  const r = L.finish('scoreDraft', data);
  assert.deepEqual(r.criteria.map((c) => c.points), [25, 15, 18, 12, 0], 'clamped to each max');
  assert.equal(r.score, 70);
  assert.equal(r.penalty, 0);
  assert.equal(r.fix.instruction, 'Open with the 9 min → 40 s number.');
  const b = L.finish('scoreDraft', { ...data, bait_phrases: ['RT if you agree'] });
  assert.deepEqual([b.score, b.penalty, b.bait], [50, 20, ['RT if you agree']]);
  const local = L.finish('scoreDraft', data, { bait: [{ text: 'follow for more' }] });
  assert.deepEqual([local.score, local.bait], [50, ['follow for more']]);
  assert.throws(() => L.finish('scoreDraft', { ...data, fix: null }), (e) => e.code === 'bad_output');

  assert.throws(() => L.finish('variants', { variants: [{ text: 'a', note: '' }, { text: 'b', note: '' }] }), /three variants/);
  assert.equal(L.finish('variants', { variants: [1, 2, 3, 4].map((i) => ({ text: 'v' + i, note: '' })) }).variants.length, 3);
  assert.throws(() => L.finish('replyAngles', { angles: [{ kind: 'question', angle: 'a', draft: 'd' }] }), /two or three/);
  const th = L.finish('splitThread', { posts: ['short', 'y'.repeat(300)], note: '' });
  assert.deepEqual(th.posts.map((p) => p.over), [false, true]);
  assert.equal(L.finish('translate', { text: 'Merhaba', note: '' }).text, 'Merhaba');
});

test('patternStats: what their own ≥2× posts share', () => {
  const posts = [
    { text: '3 ways to…', x: 5 }, { text: '7 formulas…', x: 3 }, { text: '40 s builds', x: 2.5 }, { text: 'Thoughts on Excel?', x: 2.1 },
    { text: 'random musing', x: 0.5 }, { text: 'another one', x: 0.8 }, { text: 'and one more', x: 1 }, { text: 'meh', x: 0.4 }
  ];
  const s = L.patternStats(posts);
  assert.equal(s.outliers, 4);
  assert.ok(s.lines.some((l) => /^75% of their ≥2× posts open with a number \(38% of all/.test(l)), s.lines.join(' | '));
  assert.deepEqual(L.patternStats([{ text: 'a', x: 3 }]).lines, [], 'too few outliers to say anything');
});

test('settings, spend ledger, key helpers', () => {
  assert.deepEqual(L.normalizeSettings({}), { enabled: false, model: 'claude-opus-5-5', effortScore: 'low', effortWrite: 'medium', dailyCapUsd: 1 });
  assert.deepEqual(L.normalizeSettings({ enabled: 'yes', model: 'gpt-x', effortScore: 'max', dailyCapUsd: 1000 }), { enabled: false, model: 'claude-opus-5-5', effortScore: 'low', effortWrite: 'medium', dailyCapUsd: 100 });
  assert.equal(L.normalizeSettings({ enabled: true, model: 'claude-haiku-5-5', dailyCapUsd: 0.013 }).dailyCapUsd, 0.05);
  let led = L.addSpend(null, '2026-11-24', 0.01);
  led = L.addSpend(led, '2026-11-24', 0.0025);
  assert.deepEqual(L.spentOn(led, '2026-11-24'), { usd: 0.0125, calls: 2 });
  assert.deepEqual(L.spentOn(led, '2026-11-25'), { usd: 0, calls: 0 });
  for (let d = 1; d <= 40; d++) led = L.addSpend(led, '2026-10-' + String(d).padStart(2, '0'), 0.001);
  assert.equal(Object.keys(led.days).length, 31);
  assert.ok(led.days['2026-11-24'], 'the newest days are kept');
  assert.match(L.dayKey(new Date(2026, 10, 24, 23, 59)), /^2026-11-24$/);
  assert.equal(L.scrub('bad key ' + FAKE_KEY + ' here'), 'bad key sk-ant-… here');
  assert.equal(L.isKey(FAKE_KEY), true);
  assert.equal(L.isKey('sk-proj-abc'), false);
});

// ---- the bundled SDK, as the service worker loads it ----------------------------------------------------
const VENDOR = join(__dirname, '..', 'vendor', 'anthropic-sdk.js');

function sdkSandbox(fetchImpl) {
  const g = {};
  for (const k of ['console', 'URL', 'URLSearchParams', 'Headers', 'Request', 'Response', 'FormData', 'Blob', 'File', 'ReadableStream', 'TransformStream', 'TextEncoder', 'TextDecoder',
    'AbortController', 'AbortSignal', 'setTimeout', 'clearTimeout', 'crypto', 'Promise', 'Uint8Array', 'ArrayBuffer', 'DataView', 'Symbol', 'Error', 'TypeError', 'JSON', 'Math', 'Date', 'Object', 'Array', 'String', 'Number', 'Map', 'Set', 'WeakMap', 'RegExp', 'Reflect', 'Proxy', 'queueMicrotask', 'structuredClone', 'atob', 'btoa', 'encodeURIComponent', 'decodeURIComponent', 'EventTarget', 'Event']) g[k] = globalThis[k];
  g.fetch = fetchImpl;
  g.self = g;
  g.globalThis = g;
  vm.createContext(g);
  vm.runInContext(readFileSync(VENDOR, 'utf8'), g, { filename: 'anthropic-sdk.js' });
  return g;
}

test('vendor/anthropic-sdk.js: loads without window or Node, sends the browser-access header, betas as a header, fallbacks in the body', { skip: !existsSync(VENDOR) && 'run npm run build:vendor' }, async () => {
  const head = readFileSync(VENDOR, 'utf8').slice(0, 200);
  assert.match(head, /@anthropic-ai\/sdk \d+\.\d+\.\d+ \(MIT\)/);
  const sent = [];
  const g = sdkSandbox(async (url, init) => {
    sent.push({ url: String(url), init });
    return new Response(JSON.stringify({
      id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_details: null,
      content: [{ type: 'text', text: '{"ok":true}' }],
      usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 5 }
    }), { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_1' } });
  });
  const SDK = g.AnthropicSDK;
  assert.equal(typeof SDK.Anthropic, 'function');
  assert.equal(typeof SDK.betaJSONSchemaOutputFormat, 'function');
  assert.match(SDK.VERSION, /^\d+\.\d+\.\d+/);

  const before = JSON.stringify(L.SCHEMAS);
  const { params } = L.buildRequest('scoreDraft', { draft: 'A draft.' }, { model: 'claude-opus-5-5', transformSchema: SDK.betaJSONSchemaOutputFormat });
  assert.equal(JSON.stringify(L.SCHEMAS), before, 'the SDK\'s schema transform does not change ours');
  const client = new SDK.Anthropic({ apiKey: FAKE_KEY, dangerouslyAllowBrowser: true, maxRetries: 0 });
  const res = await client.beta.messages.create(params);
  assert.equal(res.stop_reason, 'end_turn');
  assert.equal(sent.length, 1);
  const { url, init } = sent[0];
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  const h = new Headers(init.headers);
  // SDK 1.x (API version 2026-10-21) sends the API key as a bearer token.
  assert.equal(h.get('authorization'), 'Bearer ' + FAKE_KEY);
  assert.equal(h.get('x-api-key'), null);
  assert.equal(h.get('anthropic-dangerous-direct-browser-access'), 'true');
  assert.match(h.get('anthropic-beta'), /server-side-fallback-2026-07-01/);
  assert.ok(h.get('anthropic-version'));
  const body = JSON.parse(init.body);
  assert.equal(body.betas, undefined, 'betas travel as a header');
  assert.deepEqual([body.model, body.fallbacks, body.output_config.effort, body.output_config.format.type], ['claude-opus-5-5', 'default', 'low', 'json_schema']);
  assert.deepEqual(body.system[1].cache_control, { type: 'ephemeral' });
  assert.equal(JSON.stringify(body).includes(FAKE_KEY), false, 'the key is only in the header');

  // Without dangerouslyAllowBrowser the SDK still runs here (no window), but sends no browser-access header.
  const c2 = new SDK.Anthropic({ apiKey: FAKE_KEY, maxRetries: 0 });
  await c2.beta.messages.create(params);
  assert.equal(new Headers(sent[1].init.headers).get('anthropic-dangerous-direct-browser-access'), null);
});
