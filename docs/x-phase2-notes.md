# Faz 2 notları: X "Hesabım" (2026-11-24)

Plan: `docs/x-plan.md` section 3 (3.1–3.5), the three Phase 2 tools in section 7, and the `x.own` switch in section 9. The plan file is not in the repo. Built on Phase 1 (`docs/x-phase1-notes.md`, "Contract for Phases 2–3").

## What was built

| Part | Files |
|---|---|
| **Analytics parser and progress** (pure, shared by every side). <br>• `parseOverview`: the stored `accountOverviewDailyQuery` → verified followers, followers, active followers, and per UTC day every engagement type split by verified / not verified / no flag. It finds `current_time_series` wherever it sits and skips `previous_totals` and `hourly_backfill`. Timestamps can be ms, seconds, ISO or `{ iso8601_time }`. <br>• `parseContent`: `contentPageQuery`, defensively. Any object under `tweets_results` with a post id keeps its numeric leaves. It never throws. <br>• `mergeHistory`: captures add up day by day; a newer capture wins for the days it carries. A capture from another account (by `rest_id`) is flagged and not merged. <br>• `impressions90`: Σ verified `Displayed` over the last 90 days, always `upper_bound: true`, with `covered_from` and `complete`. <br>• `estimateFromPosts`: the fallback when analytics was never opened. It sums the views of own originals from the last 90 days and is labelled an upper-bound estimate. <br>• `rewardsProgress`: verified followers /500 and impressions /500,000. Pace is over 4 weeks; the ETA comes from `OpenOutlierOwnMetrics.etaLinear` / `etaRolling`, the YPP code. Requirements are dated constants (`REWARDS`, 2026-11-24) with the source link. <br>• `splitOwn`: originals vs replies (thread parts go with replies). <br>• `addEarly` / `earlyCurve` / `earlyRatio`: the first-hours curve at 15 min … 48 h through `src/velocity.js`. | `src/x-own.js` |
| **What works** (any account). <br>• `postType`: rule-based, TR + EN. It returns question, list, how-to, story, opinion or announcement, else the format, else `other`. A `p.llmType` from Phase 5 wins. <br>• `features`: length, first-line length, starts with a number, emoji, link, language TR/EN/other. <br>• `breakdown`: n, median views, × the account median (none under 3 posts), top 3. <br>• `singleHit`: median vs mean, plus the top-3 share. <br>• `bestHours`: the `metrics.js` heatmap. `heatmap()` isn't exported, so it comes from `analyze()`. | `src/x-patterns.js` |
| **Service worker** (single writer). <br>• Merges each new raw capture into `rs:x-own:history`. If the own profile is saved, its `restId` guards against another account's capture. <br>• Keeps `rs:x-own:early` for own posts under 48 h. <br>• Pushes days and today's snapshot to the bridge. <br>• Answers `reelscope:x-own` `{ what: 'curve' \| 'page' \| 'push' }`. | `src/x-own-bg.js`, `src/background.js` (one `importScripts` line) |
| **x.com content script**. <br>• **First 2 hours**: a card such as "At minute 30 this post is at 1.8× your usual views at this age". The comparison uses the bridge curve, else the local early series, else the median post marked as "final views". It also reminds the user to answer replies and says it measures only when x.com loads the post. <br>• **Toolbar pace**: on a post page, for posts under 48 h, "at 3 h: 2.1× its usual pace" against that account's `x_post_stats` curve. It adds a span to Phase 1's `.oo-x-bar` and does not change `x-content.js`. <br>• **My X card**: on the own profile and on `/i/account_analytics`. | `src/x-own-content.js`, `manifest.json` (+`own-metrics.js`, `velocity.js`, `x-own.js`, `x-own-content.js` after `x-content.js`) |
| **Library "My X" (`#/x-own`)**: <br>• the handle setting ("X kullanıcı adım", default `heyEshagh`); <br>• progress meters with pace, ETA, notes and the dated requirements plus link; <br>• daily verified/other impressions chart; <br>• What works tables, single-hit box, best hours; <br>• first-hours curve; <br>• Originals and Replies tables. <br>The bridge's longer history is added when it runs. | `dashboard/x-own-view.js`; registration blocks in `dashboard/dashboard.js` and `dashboard/dashboard.html` |
| **Bridge** <br>• Writes: `putDaily` → `x_own_daily`; `recordStats` → `x_post_stats`, called from `/sync`, one row per changed measurement. Own posts are always kept; Library accounts' posts only while under 7 days old; reposts never. <br>• Queries: `myAccount`, `myProgress`, `xPatterns` (account, or a folder/tag pooled as × each account's median), `curveOf`, `ownPage`. <br>• Routes: `POST /x/own/daily`, `GET /x/own/page`, `GET /x/own/curve`. <br>• Health feature `x-own`. | `mcp/x-own.mjs`; `mcp/bridge.mjs` (import, feature, one `/sync` line, one route block) |
| **MCP tools**: `my_x_account`, `my_x_progress`, `x_patterns`, all read-only, plus their instructions. | `mcp/x-own.mjs` `registerXOwnTools`; `mcp/server.mjs` (one import, one call) |
| **SQLite**: migration 9 adds `x_own_daily` (`handle`, `day`, snapshot columns, daily analytics columns, `imp90_v` + `imp90_source`, `metric` JSON) and `x_post_stats` (`post_id`, `ts`, `account_id`, `taken_at`, `kind`, `format`, six counters). | `mcp/store.mjs` (`SCHEMA_X_OWN`) |
| **Feature switch**: `x.own` (group `x`, phase 2, on). | `src/features.js` |
| **Demo pages** <br>• `dev/x-demo.html`: an "Analytics (My X)" button, the Phase 2 scripts, and storage `set` now fires `onChanged` like Chrome. <br>• `dev/dashboard-demo.html`: `#/x-own` with the analytics fixture shifted to now. | `dev/` |

**Checks**
- `npm test`: 419 tests pass.
  - New: `tests/x-own.test.js` (13) and `tests/mcp-x-own.test.mjs` (6).
  - Three older tests pinned `schema_version` 8. They now compare with `SCHEMA_VERSION`.
  - `mcp/node_modules` was missing in this worktree; `npm ci` in `mcp/` fixed that.
  - `tests/mcp.test.mjs` uses fixed ports (47911…). It fails with EADDRINUSE when another session runs the suite at the same moment. Run it again on its own.
- Browser pane, with the demo pages:
  - The Library's My X page.
  - The My X card on the own profile: the estimate first, then upper-bound analytics after the analytics page loads.
  - The other-account flag. The synthetic analytics fixture belongs to `tiny_maker_demo`, so it is refused once the demo profile is saved.
  - The first-2-hours card with a 30-minute-old post ("1.5× your median post", median fallback).

## Contract additions (for Phases 3–6)

- **Storage**
  - `rs:x-own` = `{ handle }`: the user's X handle (default `heyEshagh`). The Library's My X page writes it.
  - `rs:x-own:history` = `{ handle, restId, days: { 'YYYY-MM-DD': { <engagement_type>: { v, u, n } } }, snapshots: [{ d, at, verifiedFollowers, followers, activeFollowers }], captures: [{ at, rows, from, to, fromRows }], lastRawAt, content: { savedAt, shape, count, posts }, otherAccount? }`. Only `src/x-own-bg.js` writes it.
  - `rs:x-own:early` = `{ postId: { owner, takenAt, type, kind, points: [{ ts, views }] } }` for own posts under 48 h.
  - `rs:x:raw:<op>` now also carries `vars` (the request's decoded GraphQL `variables`). It is used to read the analytics range.
- **Service worker**
  - `self.OpenOutlierBridgeLink = { findServer, getState, post, read }`, exposed from `src/agent-bridge.js` for other X modules.
  - `self.OpenOutlierXOwnBg`.
  - Message `reelscope:x-own`.
- **Bridge**
  - Health feature `x-own`.
  - `/x/own/*` routes.
  - `meta.x_own` = `{ handle, restId, coveredFrom, lastCaptureAt }`.
  - **`x_post_stats` is general.** It holds every measurement of Library X posts under 7 days old and every own-post measurement. Phase 3's reply ROI and Phase 6's reach forecast can read it, and `curveOf(store, 'x/name')` returns the early curve.
- **Migration number 9.** If Phase 3 also adds a version 9, renumber one at merge. `migrate()` also re-declares `SCHEMA_X_OWN` every start, so the tables exist either way.
- **For Phase 5:** set `post.llmType` to one of `OpenOutlierXPatterns.TYPES` to override the rule-based type.

## Left open

- **No real analytics fixture.**
  - The only browser Claude in Chrome reached was the Windows Chrome. x.com redirected it to the sign-in page, so it is not logged in to X.
  - The parser was built on the Faz 0 shape (`dev/x/accountOverviewDailyQuery.json`), plus defensive variants in the tests.
  - On the user's Mac, open `x.com/i/account_analytics` (3M) with the extension. Then check `rs:x:raw:accountOverviewDailyQuery`:
    - the timestamp unit;
    - whether the days are UTC;
    - the variable names for the range. Until they are known, coverage falls back to the first returned row, and "complete" is only true once a capture's first row is ≥ 90 days back.
  - Then save a sanitized copy as a fixture.
- **`Displayed` scope is unknown** (replies? non-Home surfaces?). The 90-day number is therefore always labelled an upper bound.
- **`contentPageQuery`**'s `tweets_results` is still unseen. Its numbers are stored per post in `rs:x-own:history.content` and shown as a count only. Nothing uses them for the tables yet.
- **The requirements source link** (`https://help.x.com/en/using-x/creator-revenue-sharing`) and the Premium wording are from the plan's reading on 2026-11-24. Check them once against X's page; they are one constant (`REWARDS` in `src/x-own.js`).
- **Profile conversion** (plan 3.3: profile visits and new followers per post) is not built. It needs the per-post analytics shape above.
- **Measurement only happens when x.com loads the post.**
  - OpenOutlier sends nothing to X, so the first-2-hours card can only compare what the user's tab loads.
  - The early curve needs ≥ 3 own posts read around each checkpoint, so it fills slowly for an account that posts rarely. The user's last original was 2026-03-19.
- **One early curve per account**, not per format.
- **In-page "My X" is a floating card, not a tab inside the Phase 1 panel.** This keeps `src/panel.js` untouched for the merge. A panel tab can be added later.
- **The verified-follower pace** uses snapshots ≥ 14 days apart when they exist. Before that it uses the analytics' verified Follow − Unfollow, which can differ from the follower count.
- **Not committed:** `.claude/launch.json` has a local `openoutlier-x2-8803` demo server entry.
