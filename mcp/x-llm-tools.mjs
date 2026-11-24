// OpenOutlier MCP – the X writing helper for Claude (docs/x-plan.md 5.4 and 7, phase 5).
//
// The default LLM path: Claude, through this MCP server, does the writing. No API key is involved:
// these tools only hand Claude the context and the rubric, and never post anything.
//
//   x_voice_profile  the saved voice profile, or the user's own last original posts to write one from
//   x_draft_check    the LLM-free checks on a draft (src/x-composer.js), the user's own outliers and
//                    what they share, the saved voice profile, and the scoring rubric (src/x-llm.js)
//
// Data access is injected (xData) because the X library (phase 1, src/x.js and the bridge's copy)
// lands separately. registerXLlmTools(server, { z, json, safe, store, xData }) — wire it from
// mcp/server.mjs next to registerOwnTools (see docs/x-llm-notes.md).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const L = require('../src/x-llm.js');

// ---- adapter: src/x-composer.js (phase 4's LLM-free draft checks) -------------------------------------
// ADAPTER: until the composer module is on this branch, x_draft_check says the checks are unavailable
// instead of guessing them. When src/x-composer.js exists it is used as is (checkDraft, findBait).
let Composer = null;
try { Composer = require('../src/x-composer.js'); } catch { Composer = null; }
export function setComposer(c) { Composer = c || null; }

export function draftChecks(draft, opts = {}) {
  if (!Composer || typeof Composer.checkDraft !== 'function') {
    return { available: false, note: 'LLM-free checks (src/x-composer.js) are not installed in this build; score the draft with the rubric only.', bait: [] };
  }
  const r = Composer.checkDraft(draft, opts);
  return {
    available: true,
    ok: r.ok,
    weighted_length: r.count && r.count.weighted,
    hook: r.hook,
    bait: (r.bait || []).map((b) => ({ text: b.text, level: b.level, pattern: b.id })),
    links: (r.links || []).map((l) => ({ url: l.url, external: l.external })),
    similar: r.similar,
    findings: (r.findings || []).map((f) => ({ id: f.id, severity: f.severity, en: f.en, tr: f.tr }))
  };
}

// ---- adapter: where the user's own X posts come from ---------------------------------------------------
// Phase 1 stores X posts like the other platforms (accounts x/<handle> in the bridge's copy). Until that
// is wired, nothing is returned and the tools say so.
//   ownPosts(store, { limit })   → [{ id, text, views, x, format, created_at }]  the user's own ORIGINAL posts
//                                   (no replies or reposts), newest first; x = views ÷ their own median
//   voiceProfile(store)          → { text, updatedAt, source } | null   (the extension's rs:x-voice)
//   recentPosts(store, { limit }) → [{ text }]  posts seen recently / the swipe file, for the similarity check
export const NO_X_DATA = {
  available: false,
  ownPosts: () => [],
  voiceProfile: () => null,
  recentPosts: () => [],
  swipe: () => []
};

const NO_POSTS_HINT = 'No X posts of the user\'s own account are in the library yet. Open their profile on x.com with OpenOutlier on (phase 1 collects it), or ask them to paste a few of their recent posts.';

function voiceInstructions() {
  // The task instruction without the posts (the tool returns those separately).
  const text = L.TASKS.voiceProfile.instruction({ posts: ['…'] });
  return text.slice(0, text.indexOf('<posts>')).trim();
}

export function registerXLlmTools(server, { z, json, safe, store, xData = NO_X_DATA }) {
  const data = { ...NO_X_DATA, ...xData };
  const call = (fn, ...a) => { try { return fn(store(), ...a) || null; } catch { return null; } };

  server.registerTool('x_voice_profile', {
    title: 'X: my voice profile (or the posts to write one)',
    description: 'The user\'s saved X voice profile (tone, length, openers, frequent words, emoji, languages; plain text they edited), or, when there is none or refresh is true, their own last original X posts (newest first, up to 100) with instructions to write one. Only the user\'s own posts are returned. Show the profile as plain text for them to edit; this tool does not save it (they save it in OpenOutlier).',
    inputSchema: {
      limit: z.number().int().min(5).max(100).optional().describe('How many of their own original posts (default 100)'),
      refresh: z.boolean().optional().describe('Return the posts even if a profile is saved, to write a new one')
    },
    annotations: { readOnlyHint: true }
  }, ({ limit = 100, refresh = false }) => safe(() => {
    const saved = call(data.voiceProfile);
    const out = { saved_profile: saved };
    if (saved && !refresh) {
      out.hint = 'A profile is saved. Pass refresh: true for their posts, to write a new one.';
      return json(out);
    }
    const posts = (call(data.ownPosts, { limit }) || []).filter((p) => p && String(p.text || '').trim()).slice(0, limit);
    out.posts = posts.map((p) => ({ text: p.text, x: p.x ?? null, format: p.format ?? null, created_at: p.created_at ?? null }));
    out.post_count = out.posts.length;
    if (!posts.length) { out.hint = NO_POSTS_HINT; return json(out); }
    out.instructions = voiceInstructions();
    out.output_shape = L.SCHEMAS.voiceProfile;
    out.patterns = L.patternStats(posts).lines;
    return json(out);
  }));

  server.registerTool('x_draft_check', {
    title: 'X: check a draft (context for scoring it)',
    description: 'Everything needed to score the user\'s X draft and suggest ONE fix, without an API key: the LLM-free checks (weighted length, hook, engagement-bait phrases, similarity to their swipe file / recent posts, links), their saved voice profile, their own outlier posts (views ÷ their median, ≥2×) and what those share (e.g. "70% open with a number"), and the scoring rubric. Score 0–100 as the sum of the criteria points, minus the bait penalty; give exactly one fix and a short rationale. The result is a starting draft: the user edits it and presses Post on x.com themselves. Never rewrite someone else\'s post.',
    inputSchema: {
      draft: z.string().min(1).max(25000).describe('The draft text'),
      examples: z.number().int().min(0).max(10).optional().describe('How many of their own outliers to include (default 8)')
    },
    annotations: { readOnlyHint: true }
  }, ({ draft, examples = 8 }) => safe(() => {
    const posts = call(data.ownPosts, { limit: 200 }) || [];
    const outliers = posts.filter((p) => Number(p.x) >= 2 && String(p.text || '').trim())
      .sort((a, b) => Number(b.x) - Number(a.x)).slice(0, examples)
      .map((p) => ({ text: p.text, x: Math.round(Number(p.x) * 10) / 10, format: p.format ?? null }));
    const checks = draftChecks(draft, { recent: call(data.recentPosts, { limit: 200 }) || [], swipe: call(data.swipe) || [] });
    const voice = call(data.voiceProfile);
    return json({
      draft,
      checks,
      bait_penalty: checks.bait.some((b) => b.level === 'warn') ? L.BAIT_PENALTY : 0,
      voice_profile: voice ? voice.text : null,
      own_outliers: outliers,
      patterns: L.patternStats(posts).lines,
      own_posts_counted: posts.length,
      rubric: L.RUBRIC,
      criteria: L.CRITERIA.map((c) => ({ id: c.id, max: c.max, what: c.text })),
      output: {
        score: 'integer 0–100: the sum of the criteria points, minus ' + L.BAIT_PENALTY + ' if there is engagement bait',
        criteria: 'points and a short note for each criterion',
        fix: 'exactly one: { area, instruction, why }',
        rationale: 'two or three sentences'
      },
      rules: L.SYSTEM_RULES,
      hint: posts.length ? undefined : NO_POSTS_HINT
    });
  }));
}

export const X_LLM_INSTRUCTIONS = 'X writing help (x_voice_profile, x_draft_check): you do the writing, no API key needed. Use only the user\'s own posts, their draft and posts they pick; every result is a starting draft they edit and post themselves; never engagement bait, never a rewrite of someone else\'s post.';
