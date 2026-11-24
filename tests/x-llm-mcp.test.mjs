// The MCP side of the X writing helper (mcp/x-llm-tools.mjs): no key, Claude does the writing; the
// tools return the user's own posts / saved voice profile, their outliers, the LLM-free checks and the rubric.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const XT = await import('../mcp/x-llm-tools.mjs');
const { z } = await import(createRequire(join(process.cwd(), 'mcp', 'package.json')).resolve('zod'));

function register(xData) {
  const tools = {};
  const server = { registerTool: (name, meta, fn) => { tools[name] = { meta, fn }; } };
  const json = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });
  const safe = async (fn) => { try { return await fn(); } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; } };
  XT.registerXLlmTools(server, { z, json, safe, store: () => ({ db: true }), xData });
  const run = async (name, args) => {
    const parsed = z.object(tools[name].meta.inputSchema).parse(args);
    const r = await tools[name].fn(parsed);
    assert.equal(r.isError, undefined, r.content[0].text);
    return JSON.parse(r.content[0].text);
  };
  return { tools, run };
}

const POSTS = [
  { text: '3 Excel shortcuts I use every day', x: 5.1, format: 'text', created_at: '2026-11-01' },
  { text: '40 s instead of 9 min: our new build', x: 3.2, format: 'text' },
  { text: '7 formulas that replaced my VBA', x: 2.4, format: 'text' },
  { text: 'Is anyone still on Excel 2016?', x: 0.6, format: 'text' },
  { text: 'Long weekend, no laptop', x: 0.4, format: 'image' },
  { text: 'Pivot tables, a love letter', x: 1.1, format: 'text' }
];

test('both tools are read-only; without X data they say how to get it', async () => {
  XT.setComposer(null);
  const { tools, run } = register(undefined);
  assert.deepEqual(Object.keys(tools).sort(), ['x_draft_check', 'x_voice_profile']);
  for (const t of Object.values(tools)) assert.equal(t.meta.annotations.readOnlyHint, true);
  assert.match(tools.x_draft_check.meta.description, /exactly one fix|ONE fix/i);
  const v = await run('x_voice_profile', {});
  assert.deepEqual([v.saved_profile, v.post_count], [null, 0]);
  assert.match(v.hint, /x\.com/);
  const d = await run('x_draft_check', { draft: 'hello' });
  assert.equal(d.checks.available, false, 'no composer, no guessed checks');
  assert.match(d.rubric, /exactly one fix/i);
  assert.equal(d.own_posts_counted, 0);
});

test('x_voice_profile: the saved profile, or their own posts with instructions to write one', async () => {
  let saved = null;
  const seen = [];
  const { run } = register({ ownPosts: (store, o) => { seen.push([store, o]); return POSTS; }, voiceProfile: () => saved });
  const v = await run('x_voice_profile', { limit: 5 });
  assert.equal(v.post_count, 5);
  assert.deepEqual(seen[0], [{ db: true }, { limit: 5 }]);
  assert.deepEqual(v.posts[0], { text: '3 Excel shortcuts I use every day', x: 5.1, format: 'text', created_at: '2026-11-01' });
  assert.match(v.instructions, /voice profile/);
  assert.doesNotMatch(v.instructions, /<posts>/);
  assert.equal(v.output_shape.properties.profile.type, 'string');
  saved = { text: 'Numbers first.', updatedAt: 1, source: 'edited' };
  const s = await run('x_voice_profile', {});
  assert.deepEqual([s.saved_profile.text, s.posts], ['Numbers first.', undefined]);
  assert.equal((await run('x_voice_profile', { refresh: true })).post_count, 6);
});

test('x_draft_check: checks from src/x-composer.js, their outliers and patterns, the rubric and the bait penalty', async () => {
  const opts = [];
  XT.setComposer({
    checkDraft: (text, o) => { opts.push(o); return {
      ok: false, count: { weighted: text.length }, hook: { firstLine: text.split('\n')[0] },
      bait: [{ id: 'follow', lang: 'en', level: 'warn', text: 'Follow for more', start: 0, end: 15 }],
      links: [], similar: { swipe: [], recent: [] }, findings: [{ id: 'bait', severity: 'warn', en: 'bait', tr: 'dilenme' }]
    }; }
  });
  const { run } = register({ ownPosts: () => POSTS, voiceProfile: () => ({ text: 'Dry.' }), recentPosts: () => [{ text: 'seen' }], swipe: () => [{ text: 'saved' }] });
  const d = await run('x_draft_check', { draft: 'Follow for more\nExcel tips', examples: 2 });
  assert.equal(d.checks.available, true);
  assert.deepEqual(d.checks.bait, [{ text: 'Follow for more', level: 'warn', pattern: 'follow' }]);
  assert.equal(d.bait_penalty, 20);
  assert.deepEqual(opts[0], { recent: [{ text: 'seen' }], swipe: [{ text: 'saved' }] });
  assert.deepEqual(d.own_outliers.map((p) => p.x), [5.1, 3.2]);
  assert.equal(d.voice_profile, 'Dry.');
  assert.ok(d.patterns.some((l) => /open with a number/.test(l)), d.patterns.join(' | '));
  assert.deepEqual(d.criteria.map((c) => c.max), [25, 20, 20, 20, 15]);
  assert.match(d.output.fix, /exactly one/);
  assert.match(d.rules, /starting draft/);
  XT.setComposer();
});

test('x_draft_check uses the real src/x-composer.js by default (bait, similarity to the swipe file and recent posts)', async () => {
  XT.setComposer();
  const { run } = register({ ownPosts: () => POSTS, swipe: () => [{ id: 's1', text: 'Seven Excel formulas that quietly replaced all of my VBA macros at work', url: 'https://x.com/i/status/1', author: 'someone' }],
    recentPosts: () => [{ text: 'Unrelated post about cats' }] });
  const d = await run('x_draft_check', { draft: 'Seven Excel formulas that quietly replaced all of my VBA macros at work. Follow for more!' });
  assert.equal(d.checks.available, true);
  assert.ok(d.checks.bait.some((b) => b.level === 'warn'), JSON.stringify(d.checks.bait));
  assert.equal(d.bait_penalty, 20);
  assert.ok(d.checks.findings.some((f) => f.id === 'similar'), JSON.stringify(d.checks.findings));
  assert.ok(d.checks.weighted_length > 50);
});
