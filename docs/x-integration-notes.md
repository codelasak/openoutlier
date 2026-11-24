# X integration notes (2026-11-24)

The integration branch `claude/x-integration-02f130` brings the six X phases together and wires the parts each branch left unwired. Plan: `docs/x-plan.md`. That file is in Turkish and is not in the repo. The per-phase notes are `docs/x-phase1-notes.md`, `x-phase2-notes.md`, `x-phase3-notes.md`, `x-core-libs-notes.md` and `x-llm-notes.md`.

Hard rules (unchanged):
- OpenOutlier only reads what x.com loads in the user's tab.
- No X API, and no request of our own to X. The bridge never contacts X.
- Nothing is posted, replied to, reposted, liked, followed or DM'd. At most, text is put into x.com's compose box and the user presses Post.

## What was merged

The base is Phase 1, `claude/x-phase1-f77597` (9b1a947). Each merge is a real merge commit; no branch was rebased or changed.

| Order | Branch | Commit | Conflicts and how they were resolved |
|---|---|---|---|
| 1 | `claude/x-phase2-6bbdf3` (My X) | 69bf888 | none |
| 2 | `claude/x-phase3-27e041` (growth) | 0ec9de8 | `manifest.json`, `mcp/server.mjs`, `src/features.js`, `tests/features.test.js`: registration lists only. Both sides were kept, Phase 2 first. |
| 3 | `claude/x-core-libs-48ee4b` (composer, algo, forecast, x-watch) | eb0069b | none |
| 4 | `claude/x-llm-c88c61` (BYOK LLM + MCP tools) | f8a2569 | `src/background.js`: both `importScripts` blocks were kept. The LLM line became `importScripts('x-composer.js', 'x-llm.js', 'x-llm-bg.js')`, as x-llm-notes step 1 asks. |

**Schema migration:** only Phase 2 adds one (version 9), so nothing was renumbered.

## What was wired

### Features: one `x` group (`src/features.js`)

The group has every key from plan section 9, with these defaults:

| On | Off |
|---|---|
| `x.collect`, `x.badges`, `x.autoscroll`, `x.own`, `x.niche`, `x.replyFeed`, `x.crm`, `x.consistency`, `x.composer`, `x.weightsUpdate`, `x.schemaWatch` | `x.nicheRefresh`, `x.llm`, `x.algoBadge`, `x.reachForecast` |

- `tests/features.test.js` lists them and checks the defaults. X phases may be numbered up to 6.
- **`x.llm` mirrors `rs:x-llm.enabled`, which stays the one source of truth** (`dashboard/settings-view.js`, `setXLlm`):
  - Turning it on from the Features list or the Settings card asks for the `api.anthropic.com` permission inside the click, then patches the worker.
  - Turning it off removes the permission.
  - Each time the Settings page loads, the flag is reset to match the worker's status.

### Phase 4: workshop without the LLM

- **Check strip.** `src/x-compose-content.js`, with pure helpers in `src/x-compose.js`, sits behind `x.composer`.
  - It appears under every x.com compose box: the Home composer, the compose modal and a post's reply box.
  - It runs `OpenOutlierXComposer.checkDraft`:
    - `swipe` is the texts of `rs:org.swipe.items` (any platform);
    - `recent` is the tab's posts (`OpenOutlierXApi.pagePosts()`) plus `rs:x:feed`;
    - `premium` comes from the own profile's `blueVerified`.
  - It shows the weighted count, the text visible before "Show more", bait, similarity (with a link to the similar post), a link note and the AI-disclosure note, in TR or EN.
  - Nothing is sent.
- **Idea sources.**
  - `src/x-ideas.js` is pure and UMD. The Library page `#/x-ideas` (`dashboard/x-ideas-view.js`) and the MCP tool `x_ideas` (`mcp/x-ideas.mjs`) both use it. It returns:
    - **niche:** X originals of the last 30 days at ≥3× their author's format median, from folders marked "X niche" (else every X account). The user's own X account is excluded.
    - **cross-platform:** the user's own Instagram, TikTok and YouTube outliers (≥2× their median, last year), with a suggested X format.
    - **Reddit:** `M.contentIdeas` over the chosen subreddits, else the ones in the X-niche folders, else every saved subreddit.
  - The "own accounts" and subreddits are picked on the page and stored in **`rs:org.xIdeas = { own: [ids], subreddits: [ids] }`**. That record syncs to the bridge with the rest of `rs:org`.
  - The MCP instructions say that build-in-public ideas come from Claude reading the user's own repositories (MCP only).

### Phase 5: LLM

- **Draft tools in the strip.** They appear when `reelscope:x-llm-status` answers `ready`; otherwise the strip shows a note that points to Settings and to the MCP path. The tools are:
  - Score, then "3 variants with this fix";
  - Hooks (swaps only the first line);
  - Split into thread;
  - Translate TR↔EN;
  - Idea → draft (asks the material question on `need_material`).
- **How each call runs:** prepare → preview (the exact `preview.message`/`context` in a `<details>`, typical and maximum cost, today's spend) → Send or Cancel → the result with its cost and tokens.
  - Examples are only the user's own outliers (×≥2, up to 10).
  - **"Put in compose box"** selects the box's contents, then tries a synthetic paste (for Draft.js) and falls back to `execCommand('insertText')`. It never clicks Post or Reply.
  - `self.OpenOutlierXFill` exposes the same fill to the growth drawer.
- **Phase 3 `replyAngles` hook** (`src/x-growth-content.js`):
  - The preview now shows the exact text, typical and maximum cost, and spend.
  - Results add "Put in reply box" on that post's page, next to Copy.
  - The LLM status is asked again when the drawer opens or an `x.*` switch changes.
- **MCP.**
  - `registerXLlmTools` is registered in `mcp/server.mjs` with real data (`mcp/x-data.mjs`):
    - **`ownPosts`:** originals, newest first, with `x` = views ÷ their own median.
    - **`recentPosts`:** posts from other X accounts in the Library, last 14 days.
    - **`swipe`:** the texts of `rs:org.swipe`.
    - **`voiceProfile`:** the bridge's copy of `rs:x-voice`.
  - `x_draft_check` uses the real `src/x-composer.js`; the adapter wording is gone (`setComposer` is kept for tests).
  - **The own account is one rule (`ownXId`), used everywhere:** Phase 2's handle (bridge meta `x_own`), else the profile Phase 3 marked `me: true`, else Phase 2's default.
  - In the extension, `src/x-growth-content.js` writes the handle it detects into `rs:x-own` only when no handle is set.
- **Voice profile on the bridge.**
  - `rs:x-voice` travels in `/sync` as `xVoice` (`src/agent-bridge.js`).
  - The bridge keeps only `{ text, updatedAt, source, model? }`, in meta `x_voice`.
  - `xllm:key` is never read or sent.
- **Phase 2 → Phase 3.** `registerXGrowthTools` now gets `xPostStats` (`x_post_stats` rows in the `paceFromRows` shape) and `xFollowerDeltas` (Follow − Unfollow per day from `x_own_daily`).

### Phase 6: advanced

- **Algo badge** (`x.algoBadge`, off by default; in `src/x-content.js`):
  - `.oo-x-algo` sits next to ×median and in the post toolbar.
  - It calls `algoSignal({ views, likes, replies: comments, reposts: shares, quotes }, { weights })`, where `weights` is `rs:x:watch.weights` when the bridge sent a newer copy.
  - The tooltip says that negative signals can't be observed and that this is not X's own score.
  - There is no badge without views.
- **Reach forecast** (`x.reachForecast`, off by default):
  - The My X page trains `OpenOutlierXForecast` on the user's originals.
  - It shows a card (the eval figures, a draft box, views with low–high, the top drivers) **only when `model.shown`**. Otherwise it shows the refusal sentence, never a number.
  - A shown model is saved to **`rs:x:forecast = { model, trainedAt, account }`** and removed when it no longer passes. The draft strip reads it.
- **Bridge watch jobs.**
  - `...X_WATCH_KINDS` is in `KINDS` (`mcp/tracker.mjs`), with `feature: 'x.weightsUpdate' | 'x.schemaWatch'`.
  - A new bridge waits 10 minutes before its first check.
  - `bridge_status.x_watch` and `/health` (`x-watch`, `x-voice`) expose them.
  - The `/settings` answer carries `xWatch: { status, weights }`. `src/agent-bridge.js` stores it, only when it changed, as **`rs:x:watch = { at, status: watchStatus(), weights: currentWeights() | null }`**.
  - The Library shows the warnings on *My X* and *X ideas* (`OpenOutlierXIdeasView.watchBanner`):
    - schema warnings with `severity ≠ info`;
    - a weights change in the last 14 days;
    - otherwise a one-line "checked on …".

### Fixes found while merging

- **Lost `rs:org` keys.** `dashboard/dashboard.js load()` rebuilt `rs:org` from known fields only, so the Library's next save erased Phase 3's `xNiche` (and would have erased `xIdeas`). Both are now kept. `src/org-ops.js` and the bridge store already keep the whole record.
- **Network in tests.** `tests/tracker.test.mjs` used the real `fetch`, so the new watch jobs could reach `raw.githubusercontent.com` during a test run. Now they are switched off there, and `fetch` throws.

### README

The README has a new "X (x.com)" section under *Features in detail*: what it does, the data source, what it never does, and the MCP tools. It also gets an X bullet under Privacy, the x.com and `api.anthropic.com` permissions, a roadmap line, and X in the tagline.

## Checks

- **`npm test`:** 519 / 519 pass (Phase 1 had 400). New test files:
  - `tests/x-compose.test.js`, `tests/x-ideas.test.js`;
  - `tests/mcp-x-data.test.mjs`, `tests/mcp-x-ideas.test.mjs`;
  - additions to `x-llm-mcp`, `x-watch`, `tracker`, `features`.
- **Loaded unpacked in Chrome for Testing 151** (`--load-extension`, headless):
  - The service worker starts with the X globals present (`OpenOutlierXLlm`, `OpenOutlierXComposer`, `AnthropicSDK`, `OpenOutlierXOwnBg`, `OpenOutlierBridgeLink`).
  - `reelscope:x-llm-status` answers `{ ok, enabled: false, sdk: true }`.
  - The Library's `#/x-ideas`, `#/x-own` and `#/settings` open with 0 exceptions.
  - Every content-script file in the manifest exists.
  - x.com itself was not opened.
- **`dev/x-demo.html`** (the fake x.com, served by `npm run demo`) was checked with screenshots in `docs/screenshots/`:
  - `x-badges.png`: ×median, Viral Score and algo badges, plus the My X card.
  - `x-composer.png`: the strip with bait, 68 % similarity, the link note and the forecast line.
  - `x-llm.png`: Score → preview → variants → "Put in compose box".
  - `x-growth.png`: the growth drawer with reply angles.
  - The LLM answers in that demo are marked stubs. Prepare uses the real `buildRequest`/`estimate`; nothing calls an API.
- **`dev/dashboard-demo.html`:**
  - `#/x-ideas` shows the niche, own-platform and Reddit lists, the pickers, and the watch banner with a fake rename warning.
  - `?forecast=1#/x-own` shows the reach-forecast card: it beat the median on 49 test posts, and a draft estimate works.
  - Settings → Features lists the 15 X switches with the plan's defaults.

## Still to check live on a logged-in x.com

Nothing below could be checked without the user's logged-in x.com.

1. **Parser fixtures.** All X fixtures are synthetic (`dev/make-x-fixture.mjs`). Check these on real responses, then replace a few fixtures with real ones stripped of personal data:
   - `self_thread`;
   - `content_disclosure.ai_generated_disclosure`;
   - the article result;
   - `edit_control`;
   - module grids on the Media tab;
   - `UserPhotoTimeline`.
2. **Analytics shape.** On `x.com/i/account_analytics` (3M), check `rs:x:raw:accountOverviewDailyQuery`:
   - the timestamp unit;
   - whether days are UTC;
   - the names of the range variables.

   Also check `contentPageQuery`'s `tweets_results` shape, which has never been seen (it needs a recent post), and save a cleaned fixture. Check the Original Content Rewards source link and the dated requirements (`REWARDS` in `src/x-own.js`).
3. **List feed.** `ListLatestTweetsTimeline`'s path (`data.list.tweets_timeline.timeline.instructions`) and whether a list tab updates live are both unchecked: the user has no X list yet. Until then, Home → Following is the source.
4. **Compose-box selectors and filling.**
   - The box: `[data-testid^="tweetTextarea_"][contenteditable="true"]` (only `tweetTextarea_N`).
   - Where the strip goes: after `[data-testid$="_label"]`, else `[data-testid$="RichTextInputContainer"]`, else `.DraftEditor-root`. Check it survives React re-renders, in the modal, inline on Home, and in the reply box.
   - Whether Draft.js takes the synthetic paste, so the box holds the text and Post enables.
   - Whether `innerText` counts blank lines right (in the demo the count reads a little high).
5. **Other selectors and shapes.**
   - `a[data-testid="AppTabBar_Profile_Link"]` (own handle, Phase 3).
   - Focusing the reply box after **Open** (`tweetTextarea_0`).
   - The `CreateTweet` / `CreateNoteTweet` response shapes (Phase 3's sent log).
6. **Bridge routes over HTTP.** `/sync` with `xVoice` and the `/settings` answer with `xWatch` are only unit-tested (the Origin check stops a plain curl). Check them with the real extension and bridge: after a bridge restart, `rs:x:watch` should appear within one settings round trip (the jobs themselves wait 10 minutes).
7. **Not shown in the demo:** "Put in reply box" from the growth drawer needs that post's own page with its reply box.

## Open items (not in this branch's scope)

- **Recalibration.** `Displayed`'s scope (do replies or non-Home surfaces count?) is unknown, so the 90-day number stays labelled an upper bound. The 6 h effective lifetime in the reply score still needs recalibrating from real `rs:x:pace` data.
- **The CRM** (`rs:x:crm`) stays browser-only and is not synced to MCP.
- **UI language.** The x.com drawer and the strip's tool buttons are English. The strip's findings follow TR/EN.
- **`.claude/launch.json`.** It is tracked in the repo. The demo-server entries the sessions added for this work are not committed.

## Live check on x.com (2026-11-24, data layer)

Done in the user's Chrome, logged in as @heyEshagh. The extension was **not** loaded.

**Method:**
- A temporary, read-only XHR hook recorded the GraphQL responses x.com loaded while browsing.
- The branch's own `src/x.js`, `src/x-own.js` and their helpers were put into the page as `<script>` tags. x.com's CSP blocks `eval` but allows a script that carries the page's nonce.
- They were run over those responses.
- Nothing was liked, followed or posted. The only clicks were the analytics range buttons. No response was saved to disk. The tab was closed afterwards.

**Pages:**
- Own profile: Posts, Replies, Media.
- @levelsio: Posts, 4 pages.
- @thedankoe: Posts and Articles.
- Home: For you and Following.
- Two pinned community tabs.
- Search (Latest).
- One post (an article) in TweetDetail.
- Analytics overview: 3M and 1Y.

### Results
- **Post fields match the raw JSON.** 524 parsed posts were checked against their raw `legacy`/`views`/`core` fields: views, likes, replies, reposts, quotes, bookmarks, time (snowflake vs `created_at`, within 1 s) and owner.
  - 517 match.
  - The 7 that differ are all `kind: 'repost'` wrappers on Home. They keep `views: null` and no counts, while the raw wrapper repeats the reposted post's counts.
  - That is by design: reposts never enter a median, and the reposted post itself is parsed as its own record.
- **Formats and kinds.** All seven formats occur on real pages: text, image, video, thread, article, link, quote.
  - Articles get their title, for example "How to fix your entire life in 1 day".
  - Threads seen so far are self-reply chains that appear as quoted posts (length 2).
  - Pinned posts are flagged. No `promotedMetadata` was present on either Home tab today.
- **Views.** Every 2023+ post had a count. The only nulls were the repost wrappers.
- **Analytics (`accountOverviewDailyQuery`).**
  - 3M gave 32 rows from 2026-09-14. 1Y gave 256 rows from 2025-11-25, with 18 engagement types.
  - `verifiedFollowers` 8, `followers` 79. The days and the verified split are as in Faz 0.

### Fixed on this branch
- **`activeFollowers` was always null.**
  - The live field is `realtime_active_followers.active_count` (`{ active_count: 36, is_approximate: false }`); the parser read `.count`.
  - It now reads `active_count` and falls back to `count`.
  - The fixture (`dev/x/accountOverviewDailyQuery.json`, `dev/make-x-fixture.mjs`) now has the live shape.
- **`UserArticlesTweets` was not read.** This is a profile's Articles tab, at path `data.user.result.timeline.timeline.instructions`.
  - It is now in `TIMELINE_OPS` and `PROFILE_OPS`, and in the x-watch list.
  - Live: 12 posts, all articles, one owner.
- **`CommunityTweetsTimeline` was not read.** This is a community pinned as a Home tab, at path `data.communityResults.result.ranked_community_timeline.timeline.instructions`.
  - It is now a timeline op and a niche source: `sourceOf` → `'community'`, `rs:x:niche-src.communityAt`, and the reply feed's "where" line.
  - It is in the x-watch list.
  - Live: 24 and 22 posts from 16 and 15 authors.
  - The user has no X List but has three pinned communities, so this is a real niche source for them.
- **Tests:** two new checks.
  - `tests/x.test.js`: both operations are parsed.
  - `tests/x-growth.test.js`: community source.
  - `npm test`: 520 / 520 pass.

### Still not checked live (needs the extension loaded from this worktree)
- The panel, badges and auto-scroll on a profile.
- The draft strip under the compose box, and whether "Put in compose box" makes Post clickable.
- My X page with real analytics, the reply feed from Following and communities, and the Library pages.
- `contentPageQuery` with posts: the user has no posts in the last 3 months.
- `ListLatestTweetsTimeline`: the user has no List.

## Live check on x.com (2026-11-24, UI with the extension loaded)

This check ran in the user's Chrome, logged in, with the extension loaded unpacked from the main folder and the bridge restarted on the new code. The only writes were two test drafts typed into Home's compose box; both were deleted without posting.

### Works
- **Profile panel (@levelsio).**
  - Originals are ranked against their format median, and formats with fewer than 8 posts are marked `≈`.
  - The explanatory text, the Auto-scroll control, Clear, and the Analytics and Export tabs are all there.
  - In-page badges appear on the profile, and on Home for accounts already in the Library.
- **Post page toolbar:** ×median, Viral Score, "thread · N posts", Save to swipe file and Panel.
- **Draft strip.**
  - The weighted count works (68 / 280).
  - The bait warning fires on "Like and RT".
  - The link note appears.
  - With the LLM off, the strip points to Settings and MCP.
- **Bridge.**
  - `x/heyeshagh` and `x/levelsio` arrive in `accounts`, with `x_post_stats` rows.
  - After a visit to x.com/i/account_analytics, `x_own_daily` held 19 days (2026-09-14 → 11-24), with verified and unverified impressions of 78 and 231. These match Phase 0.
  - Today's snapshot: 79 followers, 8 verified, imp90 78 (analytics).
  - `rest_id` is decoded.
- **Auto-scroll on @levelsio:** 168 posts in 30 s, back to 20 days, still running. Before the fix it stopped after one page.

### Fixed in this pass (commit 2331f71)
- **Draft strip placement.** It was inserted next to `tweetTextarea_0_label` inside a flex row and squeezed the editor to 0 px, so typed text was invisible.
  - `placeAfter()` now climbs out of row parents.
  - Live result: the editor is 514 px wide and the strip sits under the text.
- **Hook filter.** The analytics overview has no `rest_id`, so My X never received it.
  - `current_time_series` and `tweets_results` now pass on their own.
- **Overview `rest_id`.** It is now decoded from `viewer_v2.user_results.id`, which is base64 `User:<id>`.
- **Embedded posts.** A quoted or reposted post is flagged `embedded`, and auto-scroll's age and count checks skip it.
- **Consistency counter.** Moved to `bottom: 78px` so it no longer covers x.com's account switcher.

### Open
- ~~**`coveredFrom` reads 2026-11-23**~~ Fixed after this check.
  - **Cause:** `rangeOf` took the first "…from" key. `chrome.storage` returns the stored request variables with sorted keys, so `backfill_from` (the last two days) came before `current_from`.
  - **Effect:** every capture was recorded as covering only the last two days. The My X card said "the captured analytics start on 2026-11-23 … choose the 3M range" even with 3M chosen.
  - **Fix:** `rangeOf` now picks by name: `current_*` first, ignoring `prev_*` and `backfill_*`. The order doesn't matter any more (test in `tests/x-own.test.js`).
  - The wrong captures already stored are outvoted by the next correct one (`coveredFrom` takes the earliest), so a visit to x.com/i/account_analytics after reloading the extension corrects it.
  - **Verified live after reloading the extension.**
    - With 2W remembered by x.com, coverage read 11-11 (2W's `current_from`).
    - After choosing 3M, the card's warning disappeared and the bridge's `x_own.coveredFrom` became 2026-08-27.
  - **How it was found:** the extension hook's own `postMessage` carried the full URL. The bridge's `putDaily`, run on a copy of the DB, lowered the coverage as it should. That left the stored variables: `rangeOf` on them with sorted keys returns 11-23.
- **Not reachable by the browser tool:** the Library pages (My X, X ideas). Extension pages can't be opened.
- **Not checked:** "Put in compose box" (needs the LLM turned on), `contentPageQuery` with posts, and `ListLatestTweetsTimeline` (no List).
- **Ops note.** While the bridge restarted, an older OpenOutlier MCP server (from a Claude session started before the merge) took port 47811 and served the old code. It was stopped and the bridge restarted. Restarting the bridge again can repeat this while such a session is open.

## Live check, round 3 (2026-11-24): growth drawer and MCP tools

### Growth drawer (x.com, extension loaded)

- **Reply now.**
  - It filled from Home → Following: originals from the last 120 minutes with age, views, the author's followers, the score, the reply count and the `mutual` / `cold start` chips.
  - The note says no folder is marked "X niche", so it uses the accounts the user follows.
- **Reply ROI and People.** After opening the user's Replies tab, Reply ROI showed 3 replies in 90 days (median 29 views; best 241, to @alicankiraz0). People listed the three accounts, with @mojomatt replying back 0 of 1.
- **Today, Niche and Searches.** They render with their empty states and instructions.

### MCP tools

The tools were called through a fresh `mcp/server.mjs` over stdio, against the real library.
- `my_x_account`, `my_x_progress`, `x_patterns`, `x_reply_opportunities`, `x_reply_roi`, `x_ideas`, `x_voice_profile`, `x_draft_check`, `bridge_status` and `account_summary` (`x/levelsio`) all answer with real data.
- Values seen:
  - 79 followers (8 verified), 250 days since the last original post, and the single-hit warning (mean 3.2× the median).
  - levelsio's quote median is 79.6K over 200 posts.
  - One reply opportunity on levelsio, with velocity computed from history.
  - The draft check flags the "Like and RT" bait.
- **Fixed:** `REWARDS.source` and `REWARDS.note` still pointed at the closed Creator Revenue Sharing page and its wording. They now point at Original Content Rewards and give the requirements from its help page (read 2026-11-24).

### Still not checked live

- **Algo badge and reach forecast** (`x.algoBadge`, `x.reachForecast`). Both are off by default. Turning them on is done on the Library's Features page, which the browser tool can't open. Their logic is covered by `tests/x-algo.test.js` and `tests/x-forecast.test.js`.
- **LLM tools and "Put in compose box"**: they need `x.llm` and the user's Anthropic key.
- **List feed and the Content tab's per-post shape**: the user has no List and no posts in the last 3 months.

### Writing helper (LLM), live (2026-11-24)
- The user turned on `x.llm` and added their Anthropic key; the model chosen in Settings is `claude-sonnet-5-5`. `x.algoBadge` and `x.reachForecast` are still off: no `.oo-x-algo` appeared on a profile, a post page or Home.
- **The strip** shows the draft tools (Score, Hooks, Split into thread, Translate TR↔EN, Idea → draft).
- **Score preview:** 3,183 characters to send, about $0.015 (at most $0.043), and today's spend against the $2.00 daily cap. The exact text is in a `<details>`.
- **Score result**, sent with the user's OK:
  - 51 / 100 overall: hook 10/25, one_idea 16/20, readability 14/20, originality 6/20, pattern_fit 5/15.
  - Each part has a reason. pattern_fit was compared against the user's own outliers (AI and dev-workflow takes).
  - One fix, plus a "3 variants with this fix" button.
  - Cost $0.011: 481 input tokens, a 1,716-token cache write, 533 output tokens.
  - Nothing was posted.
- **Not yet run:** "3 variants with this fix" and "Put in compose box" (the next paid call).
- **3 variants** (sent with the user's OK): about $0.027 estimated, $0.0076 actual (209 in, 958 cache write, 481 out). Each of the three variants comes with its reason.
- **Fixed: "Put in compose box" appended the variant to the old draft instead of replacing it.**
  - Cause: Draft.js reads the DOM selection on `selectionchange` one tick later, so a paste dispatched right after selecting used its old caret, at the end. The result was 354 / 280 characters and the old text left in place.
  - Fix: `fillBox` now selects, waits 60 ms, pastes and checks the result, with one slower retry. It returns a Promise. The two callers wait for it: the strip's button and the growth drawer's "Put in reply box".
  - Checked by hand in the page with the same steps: the box held only the variant, and Post was enabled (`disabled: false`).
  - After reloading the extension, the button itself still needs one live check.
- The test drafts were deleted from the compose box afterwards. Nothing was posted.
