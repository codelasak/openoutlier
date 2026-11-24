// OpenOutlier – the X writing helper's LLM layer, pure part (docs/x-plan.md 5.4, phase 5).
//
// Shared by the service worker (src/x-llm-bg.js, "bring your own key", opt-in) and the MCP bridge
// (mcp/x-llm-tools.mjs, where Claude itself does the writing and no key is needed):
//
//   MODELS / priceOf(model)       selectable models and their $/1M token prices (2026-11)
//   TASKS                         the eight tasks: kind (score | write), max_tokens, JSON schema, instruction
//   RUBRIC                        how a draft is scored (also handed to Claude by x_draft_check)
//   buildRequest(task, input, c)  → { params (Messages API body), preview (the text that will be sent) }
//   estimate(params, model, task) → tokens and $ before sending (typical and worst case)
//   costOf(usage, model)          → $ from a response's usage (cache writes/reads, fallback iterations)
//   finish(task, json, ctx)       → the validated result (exactly one fix, three variants, …)
//   patternStats(posts)           what the user's own ≥2× posts have in common (opens with a number, …)
//
// Every output is a starting draft: the user edits it and presses Post on x.com themselves. Nothing
// here rewrites someone else's post, and no task produces engagement bait.
//
// Pure functions; UMD: self.OpenOutlierXLlm in the browser, module.exports in Node.
'use strict';

(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpenOutlierXLlm = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  // ---- models and prices -------------------------------------------------------------------------------
  // $ per 1M tokens (claude-api skill, cached 2026-11-03). Cache writes cost 1.25× input (5-minute TTL),
  // 2× for the 1-hour TTL; cache reads have their own price. Haiku 5.5 doubles past 100K input tokens.
  var MODELS = [
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', input: 4, output: 20, cacheRead: 0.20, fallback: 'default' },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', input: 2, output: 10, cacheRead: 0.10, fallback: 'default' },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', input: 0.10, output: 0.50, cacheRead: 0.01, fallback: null,
      over: { threshold: 100000, input: 0.50, output: 2.50, cacheRead: 0.05 } }
  ];
  // Models a server-side fallback can answer with (fallbacks: "default" routes by refusal category).
  // Priced only to count what a rescued call cost; never selectable.
  var FALLBACK_PRICES = {
    'claude-opus-5': { input: 5, output: 25, cacheRead: 0.50 },
    'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.50 },
    'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.20 },
    'claude-fable-5-2': { input: 8, output: 40, cacheRead: 0.20 }
  };
  var DEFAULT_MODEL = 'claude-opus-5-5';
  var EFFORTS = ['low', 'medium', 'high'];
  var FALLBACK_BETA = 'server-side-fallback-2026-07-01';

  /** Settings (chrome.storage.local rs:x-llm); the key itself is stored elsewhere (src/x-llm-bg.js). */
  var DEFAULTS = { enabled: false, model: DEFAULT_MODEL, effortScore: 'low', effortWrite: 'medium', dailyCapUsd: 1 };
  var CAP_MIN = 0.05;
  var CAP_MAX = 100;

  function modelInfo(id) {
    for (var i = 0; i < MODELS.length; i++) if (MODELS[i].id === id) return MODELS[i];
    return null;
  }
  /** Price row for a model id (selectable or a fallback target); unknown → the dearest known row, approx. */
  function priceOf(id, inputTokens) {
    var m = modelInfo(id);
    if (m) {
      if (m.over && inputTokens > m.over.threshold) return { input: m.over.input, output: m.over.output, cacheRead: m.over.cacheRead, approx: false };
      return { input: m.input, output: m.output, cacheRead: m.cacheRead, approx: false };
    }
    var f = FALLBACK_PRICES[id];
    if (f) return { input: f.input, output: f.output, cacheRead: f.cacheRead, approx: false };
    return { input: 8, output: 40, cacheRead: 0.20, approx: true };
  }

  /** A settings object with every field valid (unknown model → default, cap clamped). */
  function normalizeSettings(s) {
    s = s || {};
    var out = {
      enabled: s.enabled === true,
      model: modelInfo(s.model) ? s.model : DEFAULTS.model,
      effortScore: EFFORTS.indexOf(s.effortScore) >= 0 ? s.effortScore : DEFAULTS.effortScore,
      effortWrite: EFFORTS.indexOf(s.effortWrite) >= 0 ? s.effortWrite : DEFAULTS.effortWrite,
      dailyCapUsd: DEFAULTS.dailyCapUsd
    };
    var cap = Number(s.dailyCapUsd);
    if (isFinite(cap) && cap > 0) out.dailyCapUsd = Math.min(CAP_MAX, Math.max(CAP_MIN, Math.round(cap * 100) / 100));
    return out;
  }

  // ---- the rubric --------------------------------------------------------------------------------------
  var CRITERIA = [
    { id: 'hook', max: 25, text: 'Hook: does the first line make this person\'s audience stop? Specific beats vague: a number, a concrete claim, a tension or a surprise.' },
    { id: 'one_idea', max: 20, text: 'One idea: a single point per post. A second idea belongs in another post or a thread.' },
    { id: 'readability', max: 20, text: 'Readability: short lines, plain words, no filler, easy to scan on a phone.' },
    { id: 'originality', max: 20, text: 'Originality: built on their own experience, data or example, not a generic take or a rephrase of a known post.' },
    { id: 'pattern_fit', max: 15, text: 'Fit with their own outliers: matches what worked for this person before (the patterns listed with their best posts).' }
  ];
  var BAIT_PENALTY = 20;
  var RUBRIC = [
    'Score the draft from 0 to 100 against this person\'s own baseline, not general virality. Points per criterion:',
    CRITERIA.map(function (c) { return '- ' + c.text + ' (0–' + c.max + ')'; }).join('\n'),
    'Engagement bait (asking for likes, reposts, follows, replies or bookmarks: "RT if", "like if you agree", "comment below", "follow for more", "beğen", "RT\'le", "takip et", "yorumlara yaz") costs ' + BAIT_PENALTY + ' points: name each phrase. X\'s Original Content Rewards does not pay for it.',
    'Ending with a question earns nothing by itself. A link in the main post is a note, not a penalty.',
    'Give exactly one fix: the single change that would raise the score most, as a concrete instruction. Not a list.'
  ].join('\n');

  var SYSTEM_RULES = [
    'You help one person write their own posts on X (x.com). You are a writing assistant, not a ghostwriter: everything you return is a starting draft that the person edits and posts themselves.',
    'Rules:',
    '- Keep their voice, language and point of view (the voice profile below, when there is one). Write in the language of their draft unless asked to translate.',
    '- Do not invent facts, numbers, results, anecdotes or experiences. Use only the material they gave. Where a detail is missing, write a bracketed placeholder such as [your number].',
    '- Never write or suggest engagement bait (asking for likes, reposts, follows, replies or bookmarks). X\'s Original Content Rewards does not pay for it.',
    '- Never copy or lightly rewrite someone else\'s post.',
    '- Plain text for X. No hashtags or emoji unless their own posts use them.',
    '- Answer only with the JSON the request asks for.'
  ].join('\n');

  // ---- JSON schemas (structured outputs: every object closed, every field required) ---------------------
  function obj(props) { return { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false }; }
  var STR = { type: 'string' };
  var INT = { type: 'integer' };
  var STRS = { type: 'array', items: STR };

  var SCHEMAS = {
    voiceProfile: obj({
      profile: { type: 'string', description: 'The voice profile as plain text the person can read and edit: 6–12 short lines.' },
      tone: STR,
      typical_length: { type: 'string', description: 'e.g. "one line, under 120 characters" or "3–5 short lines"' },
      openers: { type: 'array', items: STR, description: 'How their posts usually open, as patterns' },
      frequent_words: STRS,
      emoji: { type: 'string', description: 'How they use emoji, or "none"' },
      languages: STRS
    }),
    scoreDraft: obj({
      criteria: obj({
        hook: obj({ points: INT, note: STR }),
        one_idea: obj({ points: INT, note: STR }),
        readability: obj({ points: INT, note: STR }),
        originality: obj({ points: INT, note: STR }),
        pattern_fit: obj({ points: INT, note: STR })
      }),
      bait_phrases: { type: 'array', items: STR, description: 'Engagement-bait phrases found in the draft, verbatim; empty if none' },
      fix: obj({
        area: { type: 'string', enum: ['hook', 'one_idea', 'readability', 'originality', 'pattern_fit', 'bait'] },
        instruction: { type: 'string', description: 'The single change, as a concrete instruction' },
        why: STR
      }),
      rationale: { type: 'string', description: 'Two or three sentences on the score' }
    }),
    variants: obj({
      variants: { type: 'array', items: obj({ text: STR, note: STR }), description: 'Exactly three variants' }
    }),
    hooks: obj({
      hooks: { type: 'array', items: obj({ text: STR, pattern: STR }), description: 'Three to five first lines' }
    }),
    splitThread: obj({
      posts: { type: 'array', items: STR, description: 'The thread, one post per item, in order' },
      note: STR
    }),
    ideaToDraft: obj({
      draft: STR,
      material_used: { type: 'string', description: 'Which part of their own material the draft is built on' },
      placeholders: { type: 'array', items: STR, description: 'Bracketed placeholders left for them to fill; empty if none' }
    }),
    replyAngles: obj({
      angles: {
        type: 'array', description: 'Two or three angles',
        items: obj({ kind: { type: 'string', enum: ['question', 'data', 'counter'] }, angle: STR, draft: STR })
      }
    }),
    translate: obj({ text: STR, note: STR })
  };

  // ---- tasks -------------------------------------------------------------------------------------------
  function clip(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) : s; }
  function tag(name, text) { return '<' + name + '>\n' + text + '\n</' + name + '>'; }
  function postText(p) { return typeof p === 'string' ? p : p && (p.text || p.full_text) || ''; }
  var MAX_DRAFT = 25000;   // X Premium long posts
  var MAX_POSTS = 100;     // voice profile: the last 100 original posts (plan 5.4)
  var MAX_POST_CHARS = 1500;

  function needText(v, name) {
    var s = String(v == null ? '' : v).trim();
    if (!s) { var e = new Error('Missing ' + name + '.'); e.code = 'bad_input'; throw e; }
    return clip(s, MAX_DRAFT);
  }

  var TASKS = {
    voiceProfile: {
      kind: 'write', maxTokens: 6000, typicalOut: 2500,
      instruction: function (input) {
        var posts = (Array.isArray(input.posts) ? input.posts : []).map(postText).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, MAX_POSTS);
        if (!posts.length) { var e = new Error('No posts to read.'); e.code = 'bad_input'; throw e; }
        return 'Write a voice profile from these ' + posts.length + ' original posts by the same person (their own, newest first): tone, typical length, how posts open, frequent words, emoji use and languages. ' +
          'The profile is plain text they will read and edit; describe patterns, do not quote whole posts.\n\n' +
          tag('posts', posts.map(function (p, i) { return (i + 1) + '. ' + clip(p, MAX_POST_CHARS).replace(/\n+/g, ' / '); }).join('\n'));
      }
    },
    scoreDraft: {
      kind: 'score', maxTokens: 4000, typicalOut: 1200,
      instruction: function (input) {
        var d = needText(input.draft, 'draft');
        return RUBRIC + '\n\nScore this draft:\n\n' + tag('draft', d);
      }
    },
    variants: {
      kind: 'write', maxTokens: 6000, typicalOut: 2500,
      instruction: function (input) {
        var d = needText(input.draft, 'draft');
        var fix = input.fix && (input.fix.instruction || input.fix);
        var f = needText(typeof fix === 'string' ? fix : '', 'fix');
        return 'Apply this one fix to the draft in three different ways, each in their voice, each a complete post ready to edit. Keep everything else the draft says; add no new claims. ' +
          'For each variant, a one-line note on what changed.\n\n' + tag('fix', f) + '\n\n' + tag('draft', d);
      }
    },
    hooks: {
      kind: 'write', maxTokens: 5000, typicalOut: 1800,
      instruction: function (input) {
        var d = needText(input.draft, 'draft');
        return 'Write three to five alternative first lines (hooks) for this draft, in their voice, true to what the draft says. Name the pattern of each (number, claim, contrast, story, question…).\n\n' + tag('draft', d);
      }
    },
    splitThread: {
      kind: 'write', maxTokens: 8000, typicalOut: 3000,
      instruction: function (input) {
        var d = needText(input.text || input.draft, 'text');
        var max = Math.min(25, Math.max(2, parseInt(input.maxPosts, 10) || 8));
        return 'Split this text into an X thread of at most ' + max + ' posts, each at most 280 characters. Keep their words; cut, don\'t rewrite. ' +
          'The first post must stand on its own. No numbering like "1/" unless their text has it. No "follow for more" ending.\n\n' + tag('text', d);
      }
    },
    ideaToDraft: {
      kind: 'write', maxTokens: 6000, typicalOut: 2200,
      // Asks first: without the user's own experience, data or example there is nothing to build on.
      needsMaterial: true,
      instruction: function (input) {
        var idea = needText(input.idea, 'idea');
        var m = needText(input.material, 'material');
        return 'Turn this idea into one draft post in their voice, built around their own material below (their experience, data or example). ' +
          'The material is the core of the post: use it, do not replace it with generic advice. Leave bracketed placeholders for any detail that is missing.\n\n' +
          tag('idea', idea) + '\n\n' + tag('material', m);
      }
    },
    replyAngles: {
      kind: 'write', maxTokens: 5000, typicalOut: 1800,
      instruction: function (input) {
        var post = needText(input.post, 'post');
        var ctx = String(input.context || '').trim();
        return 'Suggest two or three angles for a reply to this post, in their voice: a genuine question, an extra piece of data or experience (only from what they gave, otherwise a placeholder), or a respectful counter view. ' +
          'Each with a short draft reply. No flattery, no bait, no self-promotion.\n\n' + tag('post', post) + (ctx ? '\n\n' + tag('their_context', clip(ctx, 4000)) : '');
      }
    },
    translate: {
      kind: 'write', maxTokens: 6000, typicalOut: 2000,
      instruction: function (input) {
        var t = needText(input.text || input.draft, 'text');
        var to = input.to === 'tr' ? 'Turkish' : input.to === 'en' ? 'English' : null;
        if (!to) { var e = new Error('to must be "tr" or "en".'); e.code = 'bad_input'; throw e; }
        return 'Translate this post into ' + to + ' the way they would write it themselves: same voice, length and line breaks; idioms translated, not word for word. Keep @handles, links and numbers.\n\n' + tag('text', t);
      }
    }
  };
  var TASK_IDS = Object.keys(TASKS);

  // ---- own-outlier patterns ----------------------------------------------------------------------------
  // posts: [{ text, x }] where x = views ÷ the user's own median (src/x.js computes it); outliers are x ≥ 2.
  function featuresOf(text) {
    var s = String(text || '').trim();
    var first = s.split('\n')[0];
    return {
      number: /^[^\p{L}]*\p{N}/u.test(first) || /^\$?\d/.test(first),
      question: /\?\s*$/.test(s),
      link: /https?:\/\/|\b[a-z0-9-]+\.(com|io|dev|ai|app|co)\b/i.test(s),
      short: s.length <= 120,
      lines: s.split('\n').filter(Boolean).length
    };
  }
  /** What the user's own outliers share, as lines a prompt (and the panel) can show. */
  function patternStats(posts, opts) {
    opts = opts || {};
    var min = opts.min || 2;
    var all = (Array.isArray(posts) ? posts : []).filter(function (p) { return p && postText(p).trim(); });
    var out = all.filter(function (p) { return Number(p.x) >= min; });
    if (out.length < 3) return { outliers: out.length, posts: all.length, lines: [] };
    function share(list, k) { return list.filter(function (p) { return featuresOf(postText(p))[k]; }).length / list.length; }
    var lines = [];
    var labels = { number: 'open with a number', question: 'end with a question', link: 'have a link', short: 'are 120 characters or shorter' };
    Object.keys(labels).forEach(function (k) {
      var a = share(out, k);
      var b = share(all, k);
      if (Math.abs(a - b) >= 0.15 || a >= 0.6) lines.push(Math.round(a * 100) + '% of their ≥' + min + '× posts ' + labels[k] + ' (' + Math.round(b * 100) + '% of all their posts).');
    });
    return { outliers: out.length, posts: all.length, lines: lines };
  }

  // ---- the request ---------------------------------------------------------------------------------------
  /** The cached block: voice profile + their own best posts + pattern lines. Same for every task. */
  function contextBlock(ctx) {
    ctx = ctx || {};
    var parts = [];
    var voice = String(ctx.voice || '').trim();
    parts.push(voice ? 'Voice profile (from their own posts, edited by them):\n' + clip(voice, 6000) : 'No voice profile yet: follow the voice of the text they give you.');
    var ex = (Array.isArray(ctx.examples) ? ctx.examples : []).filter(function (p) { return postText(p).trim(); }).slice(0, 10);
    if (ex.length) {
      parts.push('Their own best posts (views ÷ their median):\n' + ex.map(function (p) {
        return '- ' + (p.x ? '(' + (Math.round(Number(p.x) * 10) / 10) + '×) ' : '') + clip(postText(p), MAX_POST_CHARS).replace(/\n+/g, ' / ');
      }).join('\n'));
    }
    var stats = ctx.patterns || (ctx.posts ? patternStats(ctx.posts).lines : []);
    if (stats && stats.length) parts.push('Patterns in their own outliers:\n' + stats.map(function (l) { return '- ' + l; }).join('\n'));
    return parts.join('\n\n');
  }

  /**
   * task: one of TASK_IDS; input: the task's fields; c: { model, effort, voice, examples, patterns, transformSchema }
   * → { params, preview }. Throws { code: 'bad_task' | 'bad_input' | 'need_material' }.
   */
  function buildRequest(task, input, c) {
    var t = TASKS[task];
    if (!t) { var e = new Error('Unknown task: ' + task); e.code = 'bad_task'; throw e; }
    input = input || {};
    c = c || {};
    if (t.needsMaterial && !String(input.material || '').trim()) {
      var m = new Error('Ask for their own experience, data or example first.');
      m.code = 'need_material';
      m.question = { en: 'What is your own experience, data or example for this?', tr: 'Bunun için kendi deneyimin, verin ya da örneğin ne?' };
      throw m;
    }
    var model = modelInfo(c.model) ? c.model : DEFAULT_MODEL;
    var effort = EFFORTS.indexOf(c.effort) >= 0 ? c.effort : (t.kind === 'score' ? DEFAULTS.effortScore : DEFAULTS.effortWrite);
    var user = t.instruction(input);
    var context = contextBlock(c);
    var schema = SCHEMAS[task];
    var format = typeof c.transformSchema === 'function' ? c.transformSchema(schema) : { type: 'json_schema', schema: schema };
    var params = {
      model: model,
      max_tokens: t.maxTokens,
      system: [
        { type: 'text', text: SYSTEM_RULES },
        // Prompt cache: rules + voice profile + their outliers are the same prefix for every task.
        { type: 'text', text: context, cache_control: { type: 'ephemeral' } }
      ],
      messages: [{ role: 'user', content: user }],
      output_config: { effort: effort, format: { type: format.type || 'json_schema', schema: format.schema || schema } }
    };
    var info = modelInfo(model);
    if (info.fallback) { params.betas = [FALLBACK_BETA]; params.fallbacks = info.fallback; }
    return {
      params: params,
      preview: { task: task, model: model, effort: effort, maxTokens: t.maxTokens, system: SYSTEM_RULES, context: context, message: user,
        chars: SYSTEM_RULES.length + context.length + user.length }
    };
  }

  // ---- cost --------------------------------------------------------------------------------------------
  // A local guess before sending (nothing leaves the browser for an estimate): ~3.2 characters per
  // token for English/Turkish text on the current tokenizer, plus the schema and request overhead.
  var CHARS_PER_TOKEN = 3.2;
  function tokensOf(s) { return Math.ceil(String(s || '').length / CHARS_PER_TOKEN); }
  function round6(x) { return Math.round(x * 1e6) / 1e6; }

  function estimate(params, task) {
    var t = TASKS[task] || { typicalOut: 2000, maxTokens: params.max_tokens };
    var sys = params.system || [];
    var rules = tokensOf(sys[0] && sys[0].text);
    var cached = tokensOf(sys[1] && sys[1].text);
    var msg = tokensOf(params.messages && params.messages[0] && params.messages[0].content) + tokensOf(JSON.stringify(params.output_config && params.output_config.format)) + 60;
    var input = rules + cached + msg;
    var p = priceOf(params.model, input);
    // First call writes the cache (1.25×); later calls within 5 minutes read it.
    var inUsd = ((rules + cached) * p.input * 1.25 + msg * p.input) / 1e6;
    var outTypical = Math.min(t.typicalOut, params.max_tokens);
    return {
      inputTokens: input, cachedTokens: rules + cached, outputTokensTypical: outTypical, outputTokensMax: params.max_tokens,
      usdTypical: round6(inUsd + outTypical * p.output / 1e6),
      usdMax: round6(inUsd + params.max_tokens * p.output / 1e6),
      approx: true
    };
  }

  function usageCost(u, model) {
    u = u || {};
    var inTok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    var p = priceOf(model, inTok);
    var cc = u.cache_creation || null;
    var write = cc && (cc.ephemeral_5m_input_tokens != null || cc.ephemeral_1h_input_tokens != null)
      ? (cc.ephemeral_5m_input_tokens || 0) * 1.25 + (cc.ephemeral_1h_input_tokens || 0) * 2
      : (u.cache_creation_input_tokens || 0) * 1.25;
    return {
      usd: ((u.input_tokens || 0) * p.input + write * p.input + (u.cache_read_input_tokens || 0) * p.cacheRead + (u.output_tokens || 0) * p.output) / 1e6,
      approx: p.approx
    };
  }

  /**
   * $ for one response. usage.iterations (fallbacks) lists each model that ran, each billed at its own
   * rates; without it the top-level usage is billed at the requested model's rates.
   */
  function costOf(usage, model) {
    usage = usage || {};
    var its = Array.isArray(usage.iterations) ? usage.iterations.filter(function (i) { return i && (i.type === 'message' || i.type === 'fallback_message'); }) : [];
    var rows = its.length ? its.map(function (i) { return { model: i.model || model, usage: i }; }) : [{ model: model, usage: usage }];
    var usd = 0;
    var approx = false;
    rows.forEach(function (r) { var c = usageCost(r.usage, r.model); usd += c.usd; approx = approx || c.approx; });
    var sum = function (k) { return rows.reduce(function (a, r) { return a + (r.usage[k] || 0); }, 0); };
    return {
      usd: round6(usd), approx: approx,
      tokens: { input: sum('input_tokens'), cacheWrite: sum('cache_creation_input_tokens'), cacheRead: sum('cache_read_input_tokens'), output: sum('output_tokens') },
      models: rows.map(function (r) { return r.model; }),
      fallback: its.some(function (i) { return i.type === 'fallback_message'; })
    };
  }

  // ---- results -----------------------------------------------------------------------------------------
  function bad(msg) { var e = new Error(msg); e.code = 'bad_output'; return e; }
  function clampInt(v, lo, hi) { v = Math.round(Number(v)); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo; }

  /**
   * The model's JSON → what the panel shows. ctx.bait: engagement-bait phrases found without the LLM
   * (src/x-composer.js findBait), so bait lowers the score even if the model missed it.
   */
  function finish(task, data, ctx) {
    ctx = ctx || {};
    if (!data || typeof data !== 'object') throw bad('Not a JSON object.');
    if (task === 'scoreDraft') {
      var crit = data.criteria || {};
      var criteria = CRITERIA.map(function (c) {
        var row = crit[c.id] || {};
        return { id: c.id, points: clampInt(row.points, 0, c.max), max: c.max, note: String(row.note || '') };
      });
      var bait = (Array.isArray(data.bait_phrases) ? data.bait_phrases : []).map(String).filter(Boolean);
      (ctx.bait || []).forEach(function (b) { var s = String(b && b.text || b); if (s && bait.indexOf(s) < 0) bait.push(s); });
      var raw = criteria.reduce(function (a, c) { return a + c.points; }, 0);
      var penalty = bait.length ? BAIT_PENALTY : 0;
      if (!data.fix || !data.fix.instruction) throw bad('No fix.');
      return {
        score: Math.max(0, raw - penalty), criteria: criteria, bait: bait, penalty: penalty,
        fix: { area: String(data.fix.area || ''), instruction: String(data.fix.instruction), why: String(data.fix.why || '') },
        rationale: String(data.rationale || '')
      };
    }
    if (task === 'variants') {
      var v = (Array.isArray(data.variants) ? data.variants : []).filter(function (x) { return x && String(x.text || '').trim(); });
      if (v.length < 3) throw bad('Expected three variants, got ' + v.length + '.');
      return { variants: v.slice(0, 3).map(function (x) { return { text: String(x.text), note: String(x.note || '') }; }) };
    }
    if (task === 'hooks') {
      var h = (Array.isArray(data.hooks) ? data.hooks : []).filter(function (x) { return x && String(x.text || '').trim(); });
      if (!h.length) throw bad('No hooks.');
      return { hooks: h.slice(0, 5).map(function (x) { return { text: String(x.text), pattern: String(x.pattern || '') }; }) };
    }
    if (task === 'splitThread') {
      var posts = (Array.isArray(data.posts) ? data.posts : []).map(String).filter(function (s) { return s.trim(); });
      if (!posts.length) throw bad('No posts.');
      var weigh = ctx.weightedLength || function (s) { return { weighted: Array.from(s).length }; };
      return { posts: posts.map(function (s) { var w = weigh(s).weighted; return { text: s, length: w, over: w > 280 }; }), note: String(data.note || '') };
    }
    if (task === 'replyAngles') {
      var a = (Array.isArray(data.angles) ? data.angles : []).filter(function (x) { return x && String(x.draft || '').trim(); });
      if (a.length < 2) throw bad('Expected two or three angles, got ' + a.length + '.');
      return { angles: a.slice(0, 3).map(function (x) { return { kind: String(x.kind), angle: String(x.angle || ''), draft: String(x.draft) }; }) };
    }
    if (task === 'voiceProfile') {
      if (!String(data.profile || '').trim()) throw bad('Empty profile.');
      return {
        profile: String(data.profile), tone: String(data.tone || ''), typical_length: String(data.typical_length || ''),
        openers: (data.openers || []).map(String), frequent_words: (data.frequent_words || []).map(String),
        emoji: String(data.emoji || ''), languages: (data.languages || []).map(String)
      };
    }
    if (task === 'ideaToDraft') {
      if (!String(data.draft || '').trim()) throw bad('Empty draft.');
      return { draft: String(data.draft), material_used: String(data.material_used || ''), placeholders: (data.placeholders || []).map(String) };
    }
    if (task === 'translate') {
      if (!String(data.text || '').trim()) throw bad('Empty translation.');
      return { text: String(data.text), note: String(data.note || '') };
    }
    throw bad('Unknown task: ' + task);
  }

  // ---- the daily spend ledger ----------------------------------------------------------------------------
  /** Local calendar day, YYYY-MM-DD (the cap resets at local midnight). */
  function dayKey(t) {
    var d = new Date(t == null ? Date.now() : t);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  /** ledger: { days: { 'YYYY-MM-DD': { usd, calls } } } (the last 31 days are kept). */
  function spentOn(ledger, day) {
    var d = ledger && ledger.days && ledger.days[day];
    return { usd: d ? d.usd : 0, calls: d ? d.calls : 0 };
  }
  function addSpend(ledger, day, usd) {
    var days = Object.assign({}, ledger && ledger.days);
    var cur = days[day] || { usd: 0, calls: 0 };
    days[day] = { usd: round6(cur.usd + (Number(usd) || 0)), calls: cur.calls + 1 };
    Object.keys(days).sort().reverse().slice(31).forEach(function (k) { delete days[k]; });
    return { days: days };
  }

  /** Remove anything that looks like an Anthropic key from a string (error messages, logs). */
  function scrub(s) { return String(s == null ? '' : s).replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-…'); }
  function isKey(k) { return typeof k === 'string' && /^sk-ant-[A-Za-z0-9_-]{20,300}$/.test(k.trim()); }

  return {
    MODELS: MODELS, DEFAULT_MODEL: DEFAULT_MODEL, EFFORTS: EFFORTS, DEFAULTS: DEFAULTS, FALLBACK_BETA: FALLBACK_BETA, CAP_MIN: CAP_MIN, CAP_MAX: CAP_MAX,
    TASKS: TASKS, TASK_IDS: TASK_IDS, SCHEMAS: SCHEMAS, CRITERIA: CRITERIA, RUBRIC: RUBRIC, SYSTEM_RULES: SYSTEM_RULES, BAIT_PENALTY: BAIT_PENALTY,
    modelInfo: modelInfo, priceOf: priceOf, normalizeSettings: normalizeSettings,
    buildRequest: buildRequest, contextBlock: contextBlock, patternStats: patternStats, estimate: estimate, costOf: costOf, finish: finish,
    dayKey: dayKey, spentOn: spentOn, addSpend: addSpend, scrub: scrub, isKey: isKey
  };
});
