# Faz 1 notları: X toplayıcı (2026-11-24)

Plan: `docs/x-plan.md` sections 2.1–2.3 and section 9 (`x.collect`, `x.badges`, `x.autoscroll`), with the "Plandan sapmalar" from the Faz 0 notes applied. The plan file itself is not in the repo.

## What was built

| Part | Files |
|---|---|
| Hook: x.com branch. Matches `/i/api/graphql/<id>/<Operation>` and pre-filters with `looksUseful` (`"rest_id"` plus `tweet_results` / `user_results` / `tweetResult` / `screen_name` / `current_time_series` / `tweets_results`). Each payload carries the `x-rate-limit-*` headers. Every GraphQL response, including a 429 with no posts, also sends a small `ratelimit` message. `pushState`/`replaceState` send a `nav` message, because X is a SPA. | `src/hook.js` |
| Parser: every operation in plan 2.1, plus `UserMedia`, `TweetResultsByRestIds`, `Bookmarks`, `Likes`, `UserByRestId`, `Followers`, `Following`. | `src/x.js` |
| Scoring. Views ÷ the author's median of **original** posts that have a view count, **one median per format** (text, image, video, thread, article, link, quote). The baseline is the last 90 days or the last 50 originals, whichever is more. A format with fewer than 8 posts falls back to the author's overall median and is marked `≈`. With fewer than 8 posts overall there is no score. Pinned, promoted and <24 h old posts are scored but left out of the median. Replies and thread parts are compared with the overall originals median; reposts are never scored. | `src/metrics.js` (`xBaselines`, `xBaselineFor`, the X branch of `enrich`, `xAnalysis`, `X_COLUMNS`) |
| Content script: storage, panel (Posts / Analytics / Export), slow auto-scroll, badges, post-page toolbar, the `collect_x` agent command. | `src/x-content.js` |
| Panel: X sort options; type filter (originals / each format / replies / reposts / everything); `≈` badges; X detail card; X analytics; X empty state. | `src/panel.js` |
| Toggles `x.collect`, `x.badges`, `x.autoscroll` in a new `x` group, all on by default. | `src/features.js` |
| "Save to swipe file" for X posts. | `src/swipe.js` (platform `x`: `video` = post id, `type` = format, `ratio`, no clip) |
| Manifest. Host permissions `x.com`, `pbs.twimg.com`, `video.twimg.com`. `hook.js` runs on x.com at `document_start`. The x.com content-script block. `web_accessible_resources` include x.com. Downloads accept twimg (`src/background.js`). `collect_x` opens `x.com/<name>` in a small window (`src/agent-bridge.js`). | `manifest.json`, `src/background.js`, `src/agent-bridge.js` |
| Library: `x/` cards from originals only, X filter and counts, account page (rest_id, followers, medians per format). Top-posts filter bar for all platforms: ≥2× / 5× / 10×, author follower range, format, date, plus CSV / JSON / Sheets export. Compare includes X videos. Restore now keeps `platform` and `profile`. | `dashboard/dashboard.js`, `dashboard/top-filters.js`, `dashboard/*.css/html`, `popup/*` |
| MCP. `list_accounts`, `account_summary`, `top_reels` (`platform:'x'`, `x_format`), `top_posts` (`platform:'x'`), `search_reels`, `get_reel` (x.com / twitter.com status URLs), `organize_library` and `compare_platforms` (`account_x`) all handle X. `collect_profile x/name` queues `collect_x`. `download_reel` and `refresh_reel` refuse X posts on purpose: the bridge never contacts X or its CDN. | `mcp/library.mjs`, `mcp/server.mjs`, `src/compare.js` |
| Fixtures and tests. One fixture file per operation; `tests/x.test.js` covers each operation, scoring, CSV, swipe and the hook. | `dev/make-x-fixture.mjs` → `dev/x/*.json`, `tests/x.test.js`, `tests/mcp-x.test.mjs`, `tests/top-filters.test.js` |
| A demo page: a fake x.com served from the fixtures through a fake XHR. Profile, Home and post views, auto-scroll and the agent command can be tried there. | `dev/x-demo.html` (`npm run demo`, then `/dev/x-demo.html#profile`, `#home` or `#status`) |

**Checks**
- `npm test`: 400 tests pass.
- The demo page in the browser pane: badges on the profile, Home and post pages; the post-page toolbar; swipe save; the panel tabs; auto-scroll stopping at 6 months; `collect_x`; the stop on `x-rate-limit-remaining` = 12, with the reset time shown.
- Chrome for Testing loads the unpacked extension and its service worker starts.

## Contract for Phases 2–3

### Storage keys (`chrome.storage.local`, synced to the bridge like every `rs:p:*`)

- **`rs:p:x/<handle lowercase>`** = `{ posts: { <rest_id>: post }, updatedAt, platform: 'x', profile }`.
  - Saved posts:
    - posts by the profile being viewed;
    - posts by the author of an open post page;
    - posts by **accounts already in the Library**, wherever they appear (Home, lists, search). This is how a niche account's list posts get stored in Phase 3.
  - Every other author's posts stay in memory, only for badges.
  - An account keeps the id it was first saved under when its handle changes. Incoming posts are matched to it by `ownerId` → `profile.restId`, and `post.owner` is rewritten to the stored id.
- **`rs:x:raw:accountOverviewDailyQuery`** and **`rs:x:raw:contentPageQuery`** = `{ savedAt, url (no query), data }`. Each holds the latest raw response for Phase 2 to parse (`data.viewer_v2.user_results.result…`). They are only written while `x.collect` is on.
- **`rs:x:rate`** = `{ <Operation>: { limit, remaining, reset (ms), status, at } }`: the last rate-limit headers seen for each operation.
- **`rs:org.swipe.items[*]`** with `platform: 'x'`. See the header of `src/swipe.js`.

### Profile (`record.profile`, from `X.parseUser`)

`{ id, handle (as written), restId, name, followers, following, posts, mediaPosts, blueVerified, verified, createdAt (ms), avatar, professional, pinnedIds, rel: { following, followedBy }, seenAt }`

- New fields are read first: `core.*`, `relationship_counts.*`, `tweet_counts.*`, `avatar.image_url`, `relationship_perspectives.*`.
- `legacy` is the fallback.
- `rel` is the viewer's relationship with the account. Phase 3 uses it to detect mutual follows.

### Post (`X.parseTweet`; field list also in the header of `src/x.js`)

| Group | Fields |
|---|---|
| Identity | `code` (rest_id), `platform: 'x'`, `url`, `owner: 'x/<handle>'`, `author` (handle as written), `ownerId` |
| Author snapshot | `ownerName`, `ownerPic`, `ownerFollowers`, `ownerVerified`, `rel` |
| Classification | `kind`: `'original' \| 'reply' \| 'thread-part' \| 'repost'`; `type` = format: `'text' \| 'image' \| 'video' \| 'thread' \| 'article' \| 'link' \| 'quote'` (precedence: article > thread > quote > video > image > link > text) |
| Time and views | `takenAt` (exact, from the snowflake id); `views` (`null` when X shows none, i.e. posts before 2023); `viewsHidden` |
| Counters | `likes`, `comments` (= replies), `shares` (= reposts), `quotes`, `saves` (= bookmarks). The generic names let the shared code (sorting, CSV, engagement) work unchanged. |
| Content | `caption` (the `note_tweet` text when there is one), `lang`, `hashtags`, `mentions`, `links` (non-X URLs), `hasLink`, `media[{kind, url, thumb, duration}]`, `duration`, `thumb`, `files` |
| Relations | `isReply`, `isRepost`, `quotedId`, `replyToId`, `replyToUser`, `conversationId`, `threadOf` (root id, on thread parts), `threadLength` (on a root), `repostOf` |
| Other | `article { id, title }`, `aiGenerated`, `edit { ids, edited, editable, editableUntil, editsRemaining }`, `pinned`, `promoted`, `seenAt` |

- A repost is stored twice: a slim record under the reposter (`kind: 'repost'`, `views: null`, `repostOf`), and the full original under its own author.
- A quoted post is also parsed as a record of its own.
- `X.merge` keeps the higher counter values, so views only grow. A post stays `thread` once its parts have been seen. `X.linkThreads(posts)` marks roots across responses.
- `M.enrich(posts)` adds `ratio`, `viralScore`, `outlier`, `baseline`, `baselineApprox` (≈), `baselineScope` (`'format'` or `'all'`), and `noViews`.
  - Pass the **whole account** in one call so the per-format medians see every post.
  - `opts.xBaselines` (from `M.xBaselines(libraryPosts)`) scores posts whose authors are not in the list, as the timeline badges do.
  - `opts.xSingleMedian` uses one median per author instead of one per format.

### Useful functions

- `src/x.js`:
  - `parsePayload(url, text)` returns `{ op, posts, users, cursors, raw, profileUser }`.
  - `opOf`, `rateLimit`, `pageContext(path)` (profile, status, home, search, list), `postIdOf`, `normHandle`, `xId`, `isXId`, `mergeProfile`.
- `src/metrics.js`: `xBaselines`, `xBaselineFor`, `xKind`, `isX`, `isXList`, `X_COLUMN_NAMES`.
- Agent command `collect_x { username, maxPosts ≤ 300 }` returns `{ ok, account, collected_now, saved_total, followers, profile_posts, rate_limit, stopped_because: 'max_posts' | 'six_months' | 'end' | 'rate_limit' | 'time' | 'user' | 'autoscroll_off', note }`.

## Left open

- **The fixtures are synthetic.** The only Chrome connected through Claude in Chrome was a Windows browser that was not logged in to X. `dev/make-x-fixture.mjs` builds the shapes documented in the Faz 0 notes instead.
  - The first time the extension runs on the user's logged-in x.com, check these against reality: `self_thread`, `content_disclosure.ai_generated_disclosure`, the article result, `edit_control`, module grids on the Media tab.
  - Then replace a few fixtures with real responses stripped of personal data.
- **`contentPageQuery`'s `tweets_results` shape is still unknown** (Faz 0). It is stored raw.
- **`ListLatestTweetsTimeline` has not been checked live.** The user has no X list yet. It is parsed by the same timeline code.
- **No "first-hours velocity against a tracked account's history"** on the post toolbar yet. It shows views/hour for posts under 48 h old. Pace compared with the account's own history needs the Phase 2 `x_post_stats` series.
- **The medians setting is not exposed in the UI.** Format medians versus a single median is only available as an option (`xSingleMedian`). Section 9 lists no toggle for it.
- **New accounts from post pages.** Opening any post page saves its author as a new (small) Library account, the same way TikTok saves a video's author. The Library hides small accounts by default.
- **Timeline badges come from the data, not a click.** For authors outside the Library, a badge appears only after 8 of their originals with view counts have loaded on the page. So on Home most badges belong to Library accounts.
- `.claude/launch.json` gained a local `openoutlier-x1-8801` demo server entry. It is not committed.
