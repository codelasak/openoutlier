# Faz 3 notları: X growth (2026-11-24)

Plan: `docs/x-plan.md` section 4 (4.1–4.5), section 7 (`x_reply_opportunities`, `x_reply_roi`) and section 9 (`x.niche`, `x.nicheRefresh`, `x.replyFeed`, `x.crm`, `x.consistency`). The plan file is not in the repo. Built on Phase 1 (`docs/x-phase1-notes.md`, "Contract for Phases 2–3").

## What was built

| Part | Files |
|---|---|
| Logic, pure (Node and browser): niche folders and sources, the recent-originals feed and early-view samples, the opportunity score, CreateTweet parsing, reply annotations, follower deltas, reply ROI, CRM storage, consistency and streaks, saved searches, the list-refresh rule. | `src/x-growth.js` (`self.OpenOutlierXGrowth`) |
| x.com UI: a small counter pill (bottom left) that opens a "Growth" drawer with tabs **Reply now**, **Reply ROI**, **People**, **Today**, **Niche**, **Searches**. It also detects the user's handle, feeds the hook, focuses the reply box after "Open", and runs the optional list-tab refresh. | `src/x-growth-content.js` |
| Hook block in the Phase 1 content script: `self.OpenOutlierXHooks` (add-ons see every parsed response, and may return one to ingest) and `self.OpenOutlierXApi` (read-only access to what the tab collected). | `src/x-content.js` (one separate block, one changed line) |
| MCP: `x_reply_opportunities`, `x_reply_roi`, with one registration call. | `mcp/x-growth-tools.mjs`, `mcp/server.mjs` (import, instructions line, register call) |
| Toggles `x.niche`, `x.nicheRefresh` (off), `x.replyFeed`, `x.crm`, `x.consistency` in the `x` group. | `src/features.js`, `tests/features.test.js` |
| Manifest: `src/x-growth.js` and `src/x-growth-content.js` after `src/x-content.js` in the x.com content-script block. | `manifest.json` |
| Fixtures and tests. | `dev/make-x-growth-fixture.mjs` → `dev/x/growth/*.json`, `tests/x-growth.test.js` (19), `tests/mcp-x-growth.test.mjs` (6) |

`npm test`: 425 pass (Phase 1 had 400). The worktree needed `npm ci` in `mcp/`.

### 4.1 Niche

- **Marking.** The Niche tab lists the Library folders with an "X niche" checkbox. It writes `rs:org.xNiche = { folders: [folderId] }` with a read-modify-write of `rs:org`, so the mark syncs to the bridge with the rest of the org.
- **Members.** X accounts in the marked folders. With no folder marked, the feed falls back to authors the user follows (`rel.following` on each post), which is what Home → Following shows.
- **Sources** (`rs:x:niche-src`).
  - `ListLatestTweetsTimeline` on `x.com/i/lists/<id>`: the list's last read time, post count and authors.
  - `HomeLatestTimeline` (Home → Following): the last read time.
  - Every fresh original from any timeline also goes into `rs:x:feed`, so the feed survives a reload and is shared by tabs.
- **"Add them".** When a list has authors who are not in the niche folder, the Niche tab offers to add them. Each one gets an empty Library account (`rs:p:x/<h>` with the posts the feed holds) and is moved into the folder. From then on Phase 1 stores their posts wherever they appear, and they reach the bridge.
- **List-tab refresh** (`x.nicheRefresh`, off by default; it can also be switched in the Niche tab).
  - On a list tab, every 10 minutes after the last list load, the tab is reloaded with `location.reload()`, which is x.com's own page load.
  - It never reloads while a text field or the reply box has focus or text, nor within 2 minutes of a key press, click, wheel or touch. Rule: `G.refreshDue`.

### 4.2 Reply opportunities

**Filter.** Originals only (any format, quotes included). Not promoted, not the user's own, posted in the last 120 minutes, from a niche member. Posts the user already replied to are dropped. A reply counts as "already replied" when it is a stored reply or a sent-log entry with that `replyToId`.

**Score.** `raw = velocityFactor × saturation × mutual × sizeFit × freshness`, and `score = round(100 × (1 − e^(−raw/2)))`. The constants are in `G.C`.

| Part | Rule |
|---|---|
| Velocity | Views ÷ the views the author's posts usually have at the same age. Age is measured when the views were seen (`seenAt − takenAt`, at least 5 min). `velocityFactor = log2(1 + min(v, 50))`, so ×1 → 1 and ×3 → 2. |
| ↳ history | The median, over at least 3 of the author's other posts, of views at that age, linearly interpolated from early samples (≤ 6 h old). The samples come from three places: `rs:x:pace` (the extension records every young original it sees, one sample per post every ≥ 4 min, 30 days), the bridge's `snapshots` table (MCP), and injected rows such as Phase 2's `x_post_stats` (`paceFromRows`). |
| ↳ lifetime fallback | Without that history: author median (format median, else overall, from `M.xBaselines`) × `min(1, age / 360 min)`. This is the "author median ÷ a typical lifetime" of the plan. The **effective lifetime is 6 h** because X posts are front-loaded: roughly a third to a half of their views come in the first two hours, and For You drops posts after 48 h. Spreading the median over 6 h gives the pace a typical post keeps in its first hours, so ×1 ≈ normal. Shown as `≈`. |
| ↳ none | No median at all (an unknown author): `velocity = null`, factor 1. |
| Saturation | `1 / (1 + replies/30) × 1 / (1 + max(0, replies/views − 0.5 %) / 1 %)`. 30 replies halve it; each further 1 % of replies per view halves it again. |
| Mutual | Mutual follow ×1.5, follows you ×1.3, otherwise ×1. Research: a reply is weighted 5, plus 15 when the author replies back to a mutual. |
| Size fit | k = author followers ÷ yours. For k in [1, 30] the factor is 1. Below 1 it is 0.5 + 0.5k. Above 30 it is 1 / (1 + log10(k/30)), so 300× gives 0.5. Unknown followers give 1. |
| Freshness | 1 − 0.35 × age/120 (earlier replies sit higher in the thread). |
| Cold start | Flag only: author ≤ 50K followers, < 2 h old, < 200 views (x-algorithm cold-start boost). |

**Cards.** Each card shows the author, age, views, followers, score, the text, ×pace (`≈` for lifetime), reply count, mutual / follows you, cold start, and the **Open** button.
- **Open** writes `rs:x:focus-reply = { id, at }` and opens the post in a new tab.
- On that post page, within 2 minutes, the drawer script scrolls to `[data-testid="tweetTextarea_0"]` and focuses it. Nothing is typed.

**Phase 5 hook** (marked `PHASE 5 HOOK (replyAngles)` in both files).
- Each opportunity has `replyAngles: null`, and `G.angleInput(op)` builds the `{ post, context }` input.
- When the x-llm worker answers `reelscope:x-llm-status` with `ready`, each card gets a **Reply angles** button. It runs prepare, shows the character count, the model and the typical cost, and sends only after the user confirms. The angles are listed with a Copy button and are never inserted into X.
- The flow was tested with a stub. It goes live once `claude/x-llm-c88c61` is merged.
- MCP returns `reply_angles: null` and tells the client to suggest angles itself.

### 4.3 Reply ROI and CRM

- **Own handle.**
  - Read from the side nav's Profile link (`a[data-testid="AppTabBar_Profile_Link"]`) and stored in `rs:x:me`.
  - The rest id comes from any payload's user object.
  - When `x.crm` or `x.consistency` is on, the user's own account gets an (empty) Library record, so Phase 1 stores their posts and replies wherever they appear.
  - The profile record gets `me: true` and `followersLog`. This is how the bridge knows who "me" is.
- **Sent posts.**
  - x.com's own `CreateTweet` / `CreateNoteTweet` response (forwarded by the hook, ignored by Phase 1) is parsed when the user posts or replies in the browser.
  - The post is logged in `rs:x:sent` for consistency and handed back to Phase 1 to store.
  - A reply gets its parent snapshot right away.
- **Annotations on the user's replies** (`annotateReplies`; they live on the post records, so they sync):
  - `parent { code, owner, author, views, comments, likes, ownerFollowers, takenAt, rel }`, when the parent is in the same response. Replies-tab modules and TweetDetail carry it.
  - `authorReplied: true`, `authorReplyId` and `authorReplyAt`, when a post by the parent's author replies to the user's reply. This works in the same response or a later one, because the stored replies are matched.
  - `authorReplied: false` while X shows 0 replies on the user's reply. ROI treats an old `false` as unknown once the reply count is above 0.
- **Liked by the author.** X's responses don't say who liked a reply. `author_liked` is `false` only when the reply has 0 likes, otherwise `null`.
- **Follower change that day.**
  - Exact source: Follow − Unfollow per UTC day from the raw `accountOverviewDailyQuery` that Phase 1 stores (`deltasFromOverview`).
  - Fallback: the daily `followersLog` (back-to-back days only).
  - Exact values win (`mergeDeltas`).
  - Each day's change is shared across that day's replies by views. The result is labelled as a rough estimate (`followers_attributed`).
- **The "whose replies grow you" table.** Columns: replies, total / median / average views, replied back (x of known), liked back, followers attributed, last reply, mutual. Sorted by followers attributed, then median views, then reply count.
- **CRM** (`rs:x:crm`, browser only).
  - A note (≤ 2,000 characters) and tags (the Library tag rule, ≤ 20 per account).
  - People tab: every account the user replied to, plus every account with a note. It shows reply count, reciprocated, last interaction (the reply or the author's reply back) and niche membership.
  - A person page has the note, the tags and the user's replies to that account.

### 4.4 Consistency

- Goals: `rs:x:goals`, default 2 posts and 10 replies, editable in Today.
- What counts:
  - **posts** = originals, of any format (quotes included). A thread counts once.
  - **replies** = replies to others.
  - Thread parts and reposts don't count.
- Sources: the user's stored posts plus `rs:x:sent`, deduplicated by id. Days are local (`getTimezoneOffset`).
- `streak` counts days in a row where both goals were met. Today counts once it is met; until then the streak runs through yesterday.
- Also shown: `best`, `activeStreak` (any activity), a 12-week heatmap (Monday first, levels 0–4) and this week's met days.
- The pill shows `posts x/2 · replies y/10 · Nd streak` and gets a green border once today is met.

### 4.5 Saved searches

- On `x.com/search?q=…` the Searches tab offers **Save this search**.
- Each later `SearchTimeline` response for that query, while the user has it open, is ranked by × author median and kept as the top 40 slim results in `rs:x:searches`. The baselines are the Library's, else the page's (≈).
- Nothing runs in the background; the plan says "only when the user opens it". There is no separate toggle: searches belong to `x.niche`.

### MCP

- **`x_reply_opportunities { folder?, me?, window_minutes?, limit?, include_replied? }`**
  - Data: Library posts of the niche (`xNiche` folders, a named folder, or followed accounts), with the pace from snapshots ≤ 6 h after posting.
  - Answer: `niche`, `me`, `last_seen_post_at`, and `opportunities[]` with `url, author, age_minutes, views, replies, author_followers, velocity, velocity_basis, expected_views, history_posts, saturation, mutual, size_ratio, cold_start, already_replied, score, text, reply_angles: null`.
- **`x_reply_roi { me?, since_days?, limit? }`**
  - Answer: `totals`, `accounts[]`, `replies[]` and notes.
  - `me` is the profile marked `me: true`, or the argument.
- **`registerXGrowthTools(server, { z, json, safe, store, readLibrary?, xPostStats?, xFollowerDeltas? })`**
  - `xPostStats(store, accountIds)` returns history rows.
  - `xFollowerDeltas(store, meId)` returns `{ day: delta }`.
  - These two are where Phase 2's SQLite tables plug in. Both are optional.

## Contract additions

- **New keys.**
  - `rs:x:me`, `rs:x:niche-src`, `rs:x:feed`, `rs:x:pace`, `rs:x:crm`, `rs:x:goals`, `rs:x:sent`, `rs:x:searches`: local only. The bridge snapshot takes only `rs:p:*`, `rs:org`, watches and mentions.
  - `rs:x:focus-reply`: transient, 2 minutes.
  - Shapes: the header of `src/x-growth.js`.
- **`rs:org.xNiche`**: `{ folders: [folderId] }`, synced.
- **Post fields** on the user's replies: `parent`, `authorReplied`, `authorReplyId`, `authorReplyAt`.
- **Profile fields** on the user's own account: `me: true`, `followersLog`.
- **Hook API.**
  - `self.OpenOutlierXHooks.push({ payload(res, msg) → res | null })`. `res` is `X.parsePayload`'s result, or null for operations Phase 1 doesn't read. `msg` is the hook message `{ url, text, rateLimit? }`.
  - `self.OpenOutlierXApi`: `baselines()`, `posts(id)`, `profile(id)`, `accountIds()`, `accountOf(restId)`, `pagePosts()`, `flush()`.
  - Phase 2, 4 or 6 add-ons can use the same hook.

## Open items

- **`ListLatestTweetsTimeline` is still unverified live.**
  - The user has no X list.
  - The fixture uses the path Phase 1 parses: `data.list.tweets_timeline.timeline.instructions`.
  - Check it, and whether a list tab updates live, after the user makes a list. Until then Home → Following is the working source.
- **Unverified shapes and selectors.**
  - `CreateTweet` / `CreateNoteTweet`: `data.create_tweet.tweet_results.result` and `data.notetweet_create.tweet_results.result`, the common web-client shapes.
  - Two `data-testid`s: `AppTabBar_Profile_Link` and `tweetTextarea_0`.
  - None of this was checked on x.com in this phase: the task said not to use the browser. The drawer was exercised in a jsdom smoke run (a fake chrome and a fake Phase 1 API, all six tabs, Open, angles, CRM save, niche marking, "Add them", a saved search), with no errors. That script is not committed.
- **"Author liked your reply" is not observable** in the GraphQL responses we read. The notifications timeline would be the source, and it is out of scope.
- **The 6-hour effective lifetime is a judgment.**
  - Recalibrate it once `rs:x:pace` / snapshots hold enough history: compare the history pace with the lifetime pace for the same authors.
  - Until then, read `≈` velocities as relative, not absolute.
- **The MCP side sees only Library accounts.**
  - Fresh posts by authors outside the Library stay in `rs:x:feed`, in the browser. "Add them" in the Niche tab fixes this for list members.
  - The MCP answer is only as fresh as the last sync.
- **The CRM is browser-only.** Notes and tags (`rs:x:crm`) are not synced, so MCP doesn't return them. Syncing them would mean adding the key to `agent-bridge.js snapshot()` and the bridge store.
- **Niche marking is only in the x.com drawer.** A checkbox on the Library's folder view (dashboard) would be the natural second place. `organize_library` could also gain an `xniche` op in `src/org-ops.js`.
- **The drawer UI is English only**, like Phase 1's x.com UI. The toggles have TR/EN text.
- **The own account is auto-added to the Library** (empty, then filled by Phase 1) when `x.crm` or `x.consistency` is on. If Phase 2 also detects the own account, both should use `rs:x:me`. A note is in the shared notes folder (`x-phase3-contract.md`).
- **Integration.**
  - Manifest order: `x-content.js`, then `x-growth.js`, then `x-growth-content.js`.
  - When merging Phase 2, pass `xPostStats` / `xFollowerDeltas` to `registerXGrowthTools` in `mcp/server.mjs`.
  - `x.llm` (Phase 5) only needs to answer `reelscope:x-llm-status` with `ready` for the angles button to appear.
