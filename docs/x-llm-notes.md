# X writing helper: the LLM layer (phase 5) — notes for the integration

Plan: `docs/x-plan.md` sections 1 ("LLM: iki yol", "BYOK ayrıntıları", "LLM modeli", "SDK", "Gizlilik"), 5.4, 7, 8, 9.
This branch builds the core only. The x.com panel and composer don't use it yet; the last section says how to wire them.

## Two paths

| Path | Who writes | Key | Where |
|---|---|---|---|
| **(a) Claude through MCP** (default) | Claude, in the user's own client | none | `mcp/x-llm-tools.mjs`: `x_voice_profile`, `x_draft_check` |
| **(b) Bring your own key** (opt-in, off by default) | Claude via the Anthropic API, from the extension | the user's Anthropic key | `src/x-llm.js` (pure) + `src/x-llm-bg.js` (service worker) + `vendor/anthropic-sdk.js` |

Both paths use the same rubric, rules and schemas (`src/x-llm.js`). The output is always a starting draft. The user edits it and presses Post on x.com. No task rewrites someone else's post, and none produces engagement bait.

## Files

| File | What |
|---|---|
| `src/x-llm.js` | Pure, UMD (`self.OpenOutlierXLlm` / `require`): models and prices, `TASKS`, `SCHEMAS`, `RUBRIC`, `SYSTEM_RULES`, `buildRequest`, `estimate`, `costOf`, `finish`, `patternStats`, the spend ledger, `scrub`, `isKey` |
| `src/x-llm-bg.js` | Service worker: the `reelscope:x-llm-*` message API, the key, prepare → confirm, the daily cap, the saved voice profile |
| `vendor/anthropic-sdk.js` | The official `@anthropic-ai/sdk` (1.13.0), bundled by esbuild into one classic script (`self.AnthropicSDK = { Anthropic, betaJSONSchemaOutputFormat, VERSION }`), ~390 KB minified |
| `dev/build-vendor.mjs` | Builds the bundle: `npm install` once, then `npm run build:vendor` |
| `src/background.js` | `importScripts('../vendor/anthropic-sdk.js')` in a try/catch (a missing bundle doesn't stop the worker), then `x-llm.js`, `x-llm-bg.js` |
| `dashboard/settings-view.js` | The "X writing helper (your own Anthropic key)" card: on/off (asks for the host permission), key, model, efforts, daily cap, spend today |
| `manifest.json` | `https://api.anthropic.com/*` in `optional_host_permissions` (the only manifest change) |
| `mcp/x-llm-tools.mjs` | `registerXLlmTools(server, { z, json, safe, store, xData })`, `X_LLM_INSTRUCTIONS`, `draftChecks`, `setComposer` |
| `tests/x-llm.test.js`, `tests/x-llm-bg.test.js`, `tests/x-llm-mcp.test.mjs` | All with a fake SDK or a fake `fetch`: no test calls the API |

## SDK in the browser

The claude-api skill says to use the official SDK. Direct browser use works:

- The SDK's `package.json` has a `browser` field. It swaps the Node-only internals (`fs`, the `ant auth` profile files) for browser versions, so esbuild with `platform: 'browser'` produces no Node imports.
- `dangerouslyAllowBrowser: true` adds the `anthropic-dangerous-direct-browser-access: true` header. The SDK's browser check looks for `window` and `document`, which a service worker doesn't have, so it wouldn't refuse without the flag either. We set it anyway so the header is always sent.
- The service worker isn't a module, so the bundle is an IIFE loaded with `importScripts`.
- SDK 1.x sends API version `2026-10-21` and the key as `Authorization: Bearer …`, not `x-api-key`. `tests/x-llm.test.js` checks this against the real bundle with a fake `fetch`.
- `betas` go out as the `anthropic-beta` header, and `fallbacks` go in the body.

We call `client.beta.messages.create` with `output_config.format`, not `.parse()`. `.parse()` throws on truncated JSON, and then the response's `usage` is lost. We need the usage of every billed answer, including refusals and `max_tokens` stops, for the spend ledger. The SDK's `betaJSONSchemaOutputFormat` is still used for its schema transform.

## Request shape (`buildRequest`)

```js
{
  model: 'claude-opus-5-5',                  // or claude-sonnet-5-5 / claude-haiku-5-5 (settings)
  max_tokens: 4000,                          // per task: score 4000, writing 5000–8000
  system: [
    { type: 'text', text: SYSTEM_RULES },
    { type: 'text', text: <voice profile + their best posts + patterns>, cache_control: { type: 'ephemeral' } }
  ],
  messages: [{ role: 'user', content: <task instruction + <draft>…</draft>> }],
  output_config: { effort: 'low' | 'medium' | 'high', format: { type: 'json_schema', schema: SCHEMAS[task] } },
  betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default'   // Opus 5.5 and Sonnet 5.5 only (Haiku 5.5 has none)
}
```

- **Thinking.** `thinking` is not sent, so it is adaptive, the default on all three models. Opus 5.5 rejects disabled thinking. Effort is the control: `low` for scoring and `medium` for writing by default.
- **No sampling parameters.** API version 2026-10-21 rejects `temperature`, `top_p` and `top_k`.
- **Cache.** The second system block (voice profile, their outliers, patterns) is the same for every task. Repeated calls within 5 minutes read it at the cache price. Task text stays in the user message, after the cached prefix.
- **Refusals.** `fallbacks: "default"` re-runs a declined request on a fallback model inside the same call. If the whole chain declines, `stop_reason: "refusal"` comes back.

## Tasks, inputs and results

`input` is what the panel passes. `result` is what `confirm` returns after `finish()` validates it.

| task | kind (effort) | input | result |
|---|---|---|---|
| `voiceProfile` | write | `{ posts: [string \| {text}] }`: their own original posts, newest first, up to 100 | `{ profile, tone, typical_length, openers[], frequent_words[], emoji, languages[] }`. Also saved to `rs:x-voice` |
| `scoreDraft` | score | `{ draft }` | `{ score 0–100, criteria: [{ id, points, max, note }], bait[], penalty, fix: { area, instruction, why }, rationale }` |
| `variants` | write | `{ draft, fix }` (`fix` = the scoreDraft fix or its instruction) | `{ variants: [{ text, note }] × 3 }` |
| `hooks` | write | `{ draft }` | `{ hooks: [{ text, pattern }] }` (1–5) |
| `splitThread` | write | `{ text, maxPosts? (2–25, default 8) }` | `{ posts: [{ text, length, over }], note }`. `length` is twitter-text weighted when `x-composer.js` is loaded |
| `ideaToDraft` | write | `{ idea, material }`. Without `material`, prepare returns `code: 'need_material'` and `question: { en, tr }` | `{ draft, material_used, placeholders[] }` |
| `replyAngles` | write | `{ post, context? }` | `{ angles: [{ kind: question \| data \| counter, angle, draft }] }` (2–3) |
| `translate` | write | `{ text, to: 'tr' \| 'en' }` | `{ text, note }` |

**The score.** The score is the sum of the criteria points, each clamped to its maximum: hook 25, one idea 20, readability 20, originality 20, fit with their own outliers 15. If there is engagement bait, 20 points come off. Bait counts whether the model names it in `bait_phrases` or the LLM-free `findBait` flags it at `warn` level. Ending with a question earns nothing by itself. There is exactly one fix: the schema has one `fix` object, not a list.

**JSON schemas** are in `src/x-llm.js` `SCHEMAS`. Every object is closed (`additionalProperties: false`) and every field is required. There are no `minimum`, `maxItems` or `pattern` constraints, because structured outputs doesn't support them; counts and ranges are checked in `finish()`.

## Message API (`chrome.runtime.sendMessage`)

Every answer has `ok`. Failures add `code` and `error`.

| type | from | message | answer |
|---|---|---|---|
| `reelscope:x-llm-status` | anyone in the extension | — | `{ enabled, hasKey, permission, sdk, ready, model, effortScore, effortWrite, dailyCapUsd, spentTodayUsd, callsToday, models: [{ id, label, input, output }], keyHint? }`. `keyHint` (`…abcd`) goes to extension pages only |
| `reelscope:x-llm-prepare` | anyone | `{ task, input, examples?: [{ text, x }], patterns?: [string] }` | `{ id, task, preview: { task, model, effort, maxTokens, system, context, message, chars }, estimate: { inputTokens, cachedTokens, outputTokensTypical, outputTokensMax, usdTypical, usdMax, approx }, spend: { todayUsd, capUsd, calls } }`. **Nothing is sent** |
| `reelscope:x-llm-confirm` | anyone | `{ id }` | `{ result, task, model, fallback, stop, cost: { usd, approx, estimateUsd, tokens: { input, cacheWrite, cacheRead, output }, models }, spend }` |
| `reelscope:x-llm-cancel` | anyone | `{ id }` | `{ cancelled }` |
| `reelscope:x-llm-voice` | anyone: `get`; extension pages: `save` | `{ action: 'get' }` / `{ action: 'save', text }` | `{ voice: { text, updatedAt, source: 'llm' \| 'edited', model? } \| null }` |
| `reelscope:x-llm-key` | extension pages only | `{ action: 'set', key }` / `{ action: 'remove' }` | `{ hasKey, keyHint? }` |
| `reelscope:x-llm-settings` | extension pages only | `{ patch: { enabled?, model?, effortScore?, effortWrite?, dailyCapUsd? } }` | the normalized settings |

"Extension pages" means `sender.url` starts with `chrome-extension://<id>/`, such as the Library or the popup. Content scripts on x.com can check status, prepare, confirm, cancel and read the voice profile. They cannot set the key, change settings or save the voice profile. Messages from other extensions are ignored.

Error `code`s:

| code | when |
|---|---|
| `disabled`, `no_key`, `no_permission`, `no_sdk` | the feature can't run yet |
| `bad_task`, `bad_input` | the message is wrong |
| `need_material` | `ideaToDraft` without the user's own material: ask the user, then prepare again |
| `cap` | the call could pass the daily cap; checked at prepare and again at confirm |
| `expired` | the preview is more than 15 minutes old, or was already sent or cancelled |
| `refusal` | the model declined; `category` says why |
| `max_tokens` | the answer was cut off |
| `bad_output` | the answer didn't match the expected shape |
| `auth`, `forbidden`, `rate_limit`, `bad_request`, `network`, `api` | an SDK error; `status` is set when there is one |

Error text is passed through `scrub()`, so no `sk-ant-…` string reaches an answer.

**Preview and cost.** prepare returns exactly the payload that confirm will send: the `params` are stored in `chrome.storage.session` under `xllm:pending`, at most 20 entries, each for 15 minutes. The estimate is computed locally, because nothing is sent to estimate. It assumes ~3.2 characters per token, a cache write on the first call (1.25×), the task's typical output and a worst case at `max_tokens`. The actual cost comes from `usage`: cache writes at 1.25× (2× for the 1-hour TTL), cache reads at the model's read price, and Haiku 5.5 at its higher rates past 100K input tokens. When a fallback answered, each entry in `usage.iterations` is billed at its own model's rates; an unknown model is billed at the dearest known rates and marked `approx`.

**Daily cap.** The cap applies per local calendar day. Prepare and confirm both refuse a call if today's spend plus the call's worst case (input plus `max_tokens` output) would pass the cap. Every billed answer is added to the ledger, including refusals, `max_tokens` stops and `bad_output`. A thrown API error has no usage and isn't counted.

Prices ($ per 1M tokens, input / output / cache read):

| Model | Input | Output | Cache read |
|---|---|---|---|
| Opus 5.5 | 4 | 20 | 0.20 |
| Sonnet 5.5 | 2 | 10 | 0.10 |
| Haiku 5.5 | 0.10 | 0.50 | 0.01 |

Haiku 5.5 costs 0.50 / 2.50 past 100K input tokens. Fallback targets are priced in `FALLBACK_PRICES`. Prices are from the claude-api skill (cached 2026-11-03); update `MODELS` when they change.

## Storage keys

| Key | Area | What |
|---|---|---|
| `xllm:key` | local | The Anthropic key. Deliberately not `rs:`, so the Library backup (which only exports `rs:*`), the bridge snapshot and `rs:settings` never contain it. Only `src/x-llm-bg.js` reads it |
| `rs:x-llm` | local | `{ enabled, model, effortScore, effortWrite, dailyCapUsd }`. Defaults: `false`, `claude-opus-5-5`, `low`, `medium`, `$1.00` (cap range 0.05–100) |
| `rs:x-llm-spend` | local | `{ days: { 'YYYY-MM-DD': { usd, calls } } }`, last 31 days |
| `rs:x-voice` | local | `{ text, updatedAt, source, model? }`: the editable voice profile |
| `xllm:pending` | session | Prepared requests waiting for confirm |

**Limitation.** `chrome.storage.local` can't be limited to trusted contexts: content scripts read it for everything else, so `setAccessLevel` isn't an option. Our content scripts never read `xllm:key`, and no message returns it. The settings page also stays away from it: its `storage.onChanged` listener only reacts to `rs:x-llm` and `rs:x-llm-spend`, and it learns the key's last four characters from the status answer.

**Permission.** The Settings card calls `chrome.permissions.request({ origins: ['https://api.anthropic.com/*'] })` when the feature is turned on, as a user gesture. It removes the permission when the feature is turned off. The worker checks `chrome.permissions.contains` before every call.

## Privacy (plan section 1)

Only what the caller passes goes to the API:

- the user's own posts (for the voice profile), or examples the user picked;
- the draft;
- the saved voice profile.

The worker never reads the Library on its own. The preview shows every character before anything is sent.

## MCP (`mcp/x-llm-tools.mjs`)

**`x_voice_profile`** `{ limit?: 5–100, refresh?: bool }`. Returns `{ saved_profile }`. If there is no saved profile, or with `refresh`, it also returns `{ posts: [{ text, x, format, created_at }], post_count, instructions, output_shape, patterns }`. The tool doesn't save anything. Without X data it returns `hint`.

**`x_draft_check`** `{ draft, examples?: 0–10 }`. Returns:

- `checks`: from `src/x-composer.js` `checkDraft`;
- `bait_penalty`;
- `voice_profile`;
- `own_outliers`: their ≥2× posts, best first;
- `patterns`, `own_posts_counted`;
- `rubric`, `criteria`, `output` (the shape Claude should answer in), `rules`.

**Adapters** (marked `ADAPTER` in the file):

- **Composer.** `src/x-composer.js` isn't on this branch. When it's missing, `checks` is `{ available: false, note, bait: [] }`. When the file exists it's `require`d automatically (`checkDraft`, then `findBait` through `checkDraft`'s result). `setComposer()` overrides it in tests. I checked it against the `claude/x-core-libs` branch's `checkDraft` and the shapes match.
- **X data.** `xData` is injected, because phase 1's storage isn't on this branch. Every function gets `store()` first:
  - `ownPosts(store, { limit })` returns `[{ id, text, views, x, format, created_at }]`: the user's own **original** posts (no replies or reposts), newest first, with `x` = views ÷ their own median;
  - `voiceProfile(store)` returns `{ text, updatedAt, source } | null`;
  - `recentPosts(store, { limit })` returns `[{ text }]`;
  - `swipe(store)` returns `[{ text }]`.

  Missing functions fall back to empty answers.

## Wiring steps for the integration

1. **Service worker.** Load the LLM-free checks before `x-llm-bg.js`, so scoring penalizes bait the model missed and thread posts get weighted lengths. In `src/background.js`, change the X LLM line to `importScripts('x-composer.js', 'x-llm.js', 'x-llm-bg.js');`. `x-llm-bg.js` reads `self.OpenOutlierXComposer` lazily, at confirm time.
2. **Feature switch.** Register `x.llm` in `src/features.js`, default **off** (plan section 9). Have it mirror `rs:x-llm.enabled`: either the features toggle sends `reelscope:x-llm-settings { patch: { enabled } }` from the Library, after `chrome.permissions.request`, or the Settings card stays the only switch and the features list links to `#set-xllm`. Don't add a second source of truth.
3. **x.com panel and composer** (content script). For each action:
   1. `sendMessage({ type: 'reelscope:x-llm-prepare', task, input, examples })`;
   2. show `preview.message` and `preview.context` (the exact text) with `estimate.usdTypical` / `usdMax` and `spend`;
   3. on the user's OK, `reelscope:x-llm-confirm { id }`; otherwise `reelscope:x-llm-cancel`;
   4. show `result` with `cost.usd` and the token counts.

   Rules:
   - `examples` are the user's own outliers from phase 1 (`x ≥ 2`, up to 10) or posts they picked. Nobody else's posts.
   - On `need_material`, show `question[lang]` and an input, then prepare again with `material`.
   - On `disabled`, `no_key` or `no_permission`, link to Library → Settings (`#/settings`, card `#set-xllm`), and mention the MCP path.
   - "Fill the composer" only puts text in x.com's compose box. The user presses Post. No "rewrite this post" button on other people's posts (plan section 8).
4. **Voice profile.** The panel's "Build my voice profile" sends `voiceProfile` with the user's last 100 original posts (phase 1 data, own account only). The result is saved to `rs:x-voice` automatically. Editing happens on an extension page (Library) through `reelscope:x-llm-voice { action: 'save', text }`. Content scripts can only `get`.
5. **MCP server** (`mcp/server.mjs`). Next to `registerOwnTools(...)`:
   ```js
   import { registerXLlmTools, X_LLM_INSTRUCTIONS } from './x-llm-tools.mjs';
   registerXLlmTools(server, { z, json, safe, store, xData: { ownPosts, voiceProfile, recentPosts, swipe } });
   ```
   - Add `X_LLM_INSTRUCTIONS` to the server instructions.
   - `ownPosts` reads the user's own `x/<handle>` account from the bridge's copy, originals only.
   - `voiceProfile` needs `rs:x-voice` on the bridge. The snapshot in `src/agent-bridge.js` doesn't carry it today: add it to `snapshot()` (it holds no secret). **Never** add `xllm:key`.
6. **Packaging.** `npm run zip` now includes `vendor/`. After bumping `@anthropic-ai/sdk` in `package.json`, run `npm install && npm run build:vendor`, then `npm test`; the vendor test checks the headers and body against the new bundle.
