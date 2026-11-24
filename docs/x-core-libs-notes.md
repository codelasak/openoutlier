# X core libraries: API notes for the integration step

Phase 4 draft checks (x-plan 5.3) and Phase 6 (x-plan 6, and the "Algoritma ağırlıkları" and "Şema kayması" rows in section 1). These are pure modules with plain-object inputs. Nothing is wired into the UI, the manifest, the hook or the MCP tools yet. None of them posts, likes, follows or replies, and none calls the X API.

| File | Global (content script) | Tests |
|---|---|---|
| `src/x-composer.js` | `OpenOutlierXComposer` | `tests/x-composer.test.js` |
| `src/x-algo.js` | `OpenOutlierXAlgo` | `tests/x-algo.test.js` |
| `src/x-forecast.js` | `OpenOutlierXForecast` | `tests/x-forecast.test.js` |
| `mcp/x-watch.mjs` | (bridge, ESM) | `tests/x-watch.test.mjs` |

The `src/*.js` files are UMD like `swipe.js`: `require()` in Node, a global in the browser. `x-forecast.js` uses `OpenOutlierXComposer` when it is loaded (for weighted length, links and emoji), so load `x-composer.js` first in `manifest.json`. Without it, it falls back to simpler rules.

## Composer strip: `src/x-composer.js`

```js
const r = OpenOutlierXComposer.checkDraft(text, {
  swipe:  [{ id, text, url, author }],          // or plain strings
  recent: [{ id, text, url, author }],          // posts seen lately (timeline, niche list)
  media:  [{ type: 'image'|'video'|'gif', ai: true }],  // ai = the user marked it AI-made
  aiDisclosed: false,                           // X's "Made with AI" label is already on
  premium: null,                                // true / false / null (unknown)
  similarityThreshold: 0.5                      // optional
});
// r = { ok, count, hook, bait, links, similar: { swipe, recent }, findings }
// findings: [{ id, severity: 'error'|'warn'|'info', tr, en, span? | spans? | match? | … }], sorted by severity
```

**Finding ids:**

| id | Severity | Meaning |
|---|---|---|
| `length-over` | error | Over 280 with `premium: false`, or over 25,000 |
| `long-post` | info / warn | Over 280: Premium long post. `hidden` = weighted characters behind "Show more". It is `warn` when Premium is unknown. |
| `hook-long` | info | First line over 120 weighted characters |
| `bait` | warn / info | Engagement bait. `span` = `{start, end}`, `pattern` = pattern id. |
| `similar` | warn / info | Trigram Jaccard ≥ 0.5 (warn) or ≥ 0.35 (info) against the swipe file or a recent post. Also `warn` when ≥ 80 % of the draft's trigrams are in one post (a copied excerpt). `match` = `{ source, index, id, url, author, jaccard, containment }`. |
| `link` | info | Link outside x.com in the main post. Phrased as a suggestion (put it in the first reply). `spans`. |
| `ai-disclosure` | warn | AI-marked media without `aiDisclosed` |
| `empty` | info | |

**Pieces the strip can use on their own:**
- `weightedLength(text)` → `{ weighted, limit, remaining, valid, chars, urls, emojis, permillage }`. Follows twitter-text v3: URL = 23; CJK and emoji = 2, where a ZWJ family, a flag or a keycap counts as one emoji; NFC normalised. Use `remaining` for the counter.
- `hook(text)` → `{ firstLine, firstLineWeighted, firstLineWords, lines, visible, hidden, truncated }`. `visible` is the text the timeline shows before "Show more", cut at a word boundary.
- `findBait(text)` → `[{ id, lang, level, text, start, end }]`. The patterns are in `BAIT_PATTERNS`. Turkish patterns only match imperative and conditional forms ("beğenin", "takip edin", "RT'leyin"), not "beğendim" or "takip ettim".
- `similarity(text, list, { source, threshold, top })`, `links(text)`, `emojis(text)`.

**Spans** are UTF-16 indexes into the original string (textarea / DOM Range). x.com's composer is a contenteditable (Draft.js), so the strip needs to map these offsets onto its text nodes to highlight them.

**Limits:**
- URL detection is a practical subset of twitter-text's extractor: `http(s)://` links plus bare domains with a listed TLD.
- © ® ‼ count as emoji (weight 2) only when followed by VS16 (U+FE0F).
- The 120-character hook threshold and the similarity thresholds are our own choices, not X rules.

## Algo badge: `src/x-algo.js`

```js
const s = OpenOutlierXAlgo.algoSignal(post, { weights });  // weights optional: the bridge's newer copy
// null when views are missing / 0 / '' (pre-2023 posts) or no counter is present
// { score, per1k, views, terms: [{ signal, weightName, count, rate, weight, contribution }],
//   negativeObservable: false, negativeSignals: [...], missing: [...], version, note: { tr, en } }
```

- **`post`** takes `{ views, likes, replies, reposts, quotes }`. Strings are fine (`views.count` arrives as a string). Legacy names also work: `favorite_count`, `reply_count`, `retweet_count`, `quote_count`, `viewCount`, `likeCount` and so on.
- **What the badge shows:** `per1k` (the score × 1000), with `note` in the tooltip. The note says that negative signals can't be observed and that this is not X's own score.
- **`signalVsMedian(post, otherPosts)`** → `{ ratio, median, score, n }`, or null when fewer than 5 other posts have a signal. Use it to show the post's signal against the author's normal.
- **`WEIGHTS`** is the dated copy:
  - version `2026-11-24`, commit `e005f95` (2026-11-24T08:24:35Z), with `source`, `raw` and `license`.
  - `weights`: all f64 weights from `param.rs` (`PARAM_KEYS` maps our names to the rust keys).
  - `coldStart`: 200 impressions, 50k follower cap, 7200 s.
  - `maxPostAgeHours`: 48.
  - On 2026-11-24 this copy matched the live file exactly.
- **`diffWeights(a, b)`** → `[{ key, from, to }]`.

## Reach forecast panel: `src/x-forecast.js`

```js
const model = OpenOutlierXForecast.train(ownOriginalPosts, { tzOffsetMinutes: null });
// { shown: true, … }  or  { shown: false, reason: 'not-enough-posts'|'no-gain', tr, en, have, need, eval? }
const f = OpenOutlierXForecast.forecastDraft(model, { text, format, quote, at }, { recent });
// { shown: true, views, low, high, ratio, baseline, drivers: [{ feature, effect, tr, en }], eval }  or the refusal
```

**Input posts:** `{ id, createdAt (ms or ISO), views, format, text, quote }`. The function drops:
- replies and reposts (`isReply` / `is_reply` / `isRepost` / `is_repost`);
- posts without a view count.

**Format** is one of `text`, `image`, `video`, `thread`, `article`, `link`, `quote`. Anything else counts as `other`. When `format` is missing, it is inferred: `quote` if the post quotes another, `link` if it has an external link, otherwise `text`.

**Target:** `ln(views ÷ median of the previous ≤ 20 posts)`. A post needs 5 earlier posts before it gets a target.

**Features (one-hot):**
- format
- length: ≤ 70, ≤ 140, ≤ 280, longer
- time of day: 00–06, 06–12, 12–18, 18–24
- weekday
- has a number, has emoji, has a link, is a quote

**Fit:** ridge regression with an unpenalised intercept.
- λ is chosen from `[0.3, 1, 3, 10, 30]` on the newest quarter of the training set.
- The time split puts the newest 30 % of posts in the test set, with at least 20 test and 40 training posts. So the user needs **≥ 65 original posts that have view counts.**
- The forecast is shown only when the test MAE in log space is below the baseline MAE ("the post does the median", i.e. prediction 0). The `minGain` option raises that bar.

**After it passes:** the model is refit on all posts.
- `low` and `high` come from the 10th and 90th percentiles of the test residuals.
- `drivers` lists the three largest effects relative to an average post (`effect` is × views).
- The model is JSON-safe, so it can be cached in `chrome.storage`.
- `recent` can pass newer view counts for the baseline.

**New or quiet accounts:** expect `not-enough-posts` until there is enough history. Show the refusal's `tr`/`en` text instead of a number.

## Bridge jobs: `mcp/x-watch.mjs`

**`X_WATCH_KINDS`** has the same shape as `DISCOVERY_KINDS`. **Not wired yet.** To run the jobs, add `...X_WATCH_KINDS` to `KINDS` in `mcp/tracker.mjs`.

| Kind | Every | What it does |
|---|---|---|
| `x-weights` | 7 days (+0–2 h jitter) | Reads `ALGO_RAW_URL` (xai-org `param.rs`) and parses the numeric `param!` lines. If they differ from `currentWeights(store)`, it writes the new versioned object to meta `x_algo_weights`. Each run records `x_algo_weights_status` = `{ checkedAt, changed, changedAt, diff, version, sha256 }`. If the file no longer has the favourite/reply/retweet/quote weights, the run throws and keeps the old copy. |
| `x-schema` | 1 day (+0–1 h) | Reads fa0311's `GraphQL.json` (array of `{ exports: { operationName, queryId } }`, about 1.5 MB). It checks it against `USED_OPERATIONS` (x-plan 2.1 plus the Faz 0 analytics queries; `UserTweets*` are marked legacy and only give `info`). Results go to meta `x_schema_watch`: `{ checkedAt, ok, warnings: [{ op, kind: 'missing'|'renamed', severity, candidates, tr, en }], newWarnings, queryIdChanged, added, ops, names, count }`. Rename candidates are names that are new since the last run and share at least half their camel-case words with the missing operation. A dump with fewer than 100 operations is refused, and the last good result stays. |

**Exports:**
- `currentWeights(store)`: pass it as `weights` to `algoSignal`. The extension can get it through the bridge's settings answer.
- `watchStatus(store)` → `{ weights: { on, version, bundled, checkedAt, changedAt, lastDiff }, schema: { on, checkedAt, ok, warnings, queryIdChanged, count } }`. Use it for the Library warning and for `bridge_status`.
- Pure helpers: `parseParamRs`, `weightsFromParams`, `checkWeights`, `parseGraphQL`, `checkSchema`, `nameSimilarity`.

**Network:** only `raw.githubusercontent.com`. `assertRaw` refuses any other host before a request goes out. Requests time out after 20 s and are capped at 8 MB. `fetch` comes from the job context (`ctx.fetch`), so tests use a fake.

**Toggles:** `toggleOn(store, 'x.weightsUpdate' | 'x.schemaWatch')`. Both default on.
- While a toggle is off, its job returns `{ off: true }` and makes no request.
- **Integration needs:** `x.*` ids in `src/features.js`. The bridge's `/settings` route runs `Features.sanitize`, which drops unknown ids, so the user can't switch these jobs off until features.js knows them. Once it does, `toggleOn` reads the resolved value automatically, and the kinds can also get `feature: TOGGLES.*`.

## Checked on 2026-11-24

- The live `param.rs` (commit e005f95) matches `WEIGHTS`: `checkWeights` reports no diff.
- The live `GraphQL.json` has 862 distinct operation names, and all 18 in `USED_OPERATIONS` are present.
- `npm test`: 393 / 393 pass with `mcp/node_modules` installed. A fresh worktree needs `npm --prefix mcp install`; without it, the existing MCP tests fail on missing `zod`.
