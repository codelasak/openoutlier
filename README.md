# ReelScope

**Free, open-source Instagram Reels and Reddit analytics for Chrome and Edge.**
Sort any public profile's reels by views, spot viral outliers, find the best time to post, see which hashtags, lengths and sounds work, export to CSV/Google Sheets, and download reels. Do the same for subreddits and Reddit users (posts by score, title analysis, flair, best time), keep both in one library, and let an AI agent turn the most-upvoted Reddit questions into content ideas.

No account, no server, no password. Everything runs and stays in your browser.

> ReelScope is an independent project. It is not affiliated with Instagram, Meta, Reddit, or any commercial analytics tool.

## Features

| | |
|---|---|
| **Sort reels** | by views, Viral Score, likes, comments, engagement rate, date or length. Instagram itself can't sort a profile by views. |
| **Outliers** | posts with ≥ 2× the profile's median views get a `2.4×` badge; filter to outliers only. |
| **Viral Score (0–100)** | `50 + 25 × log2(views ÷ profile median)`. 50 = typical, 75 = 2×, 100 = 4× or more. |
| **Best time to post** | day × time heatmap of median views, in your local time. |
| **Hashtags** | ranked by the median views of the posts that use them. |
| **Video length & audio** | median views by duration bucket; original audio vs. licensed music; top tracks. |
| **Export** | CSV download, copy as a table for Google Sheets / Excel, or JSON. 18 columns per post. |
| **Reel overlay** | on any reel or post page (`/reel/…`, `/reels/…`, `/p/…`): a toolbar on the video with download, cover download and a stats card (views, likes, comments, shares, duration, engagement, × creator's median). |
| **Download** | videos, photos and carousel slides, or the **cover image** separately, one at a time or the whole list. Saved to `Downloads/ReelScope/<username>/` with the stats in the name: `1.2Mviews_11.1Klikes_13Kcomments_2.0pct_post_CODE.mp4` (covers end in `_cover.jpg`). |
| **Library page** | a full-page view of every saved account (toolbar popup → *Open library*, or the grid icon in the panel). Organize accounts into **folders** (drag a card onto a folder) and **tags**, open any account's reels/analytics/export without going back to Instagram, and rank **Top reels** across a whole folder or tag. Each reel is scored against its own account's median, so small and big accounts compare fairly. Back up / restore everything as one JSON file. |
| **Reel details** | click any reel in a list for a detail card: cover, all stats, caption, hashtags, download buttons. ⌘/Ctrl-click opens it on Instagram. |
| **Search** | captions and hashtags. |
| **Dark mode** | follows Instagram's / Reddit's theme. |

### Reddit

| Instagram | Reddit |
|---|---|
| Sort reels by views | Sort a subreddit's or a user's posts by **score**, comments, upvote ratio, comments-per-score or date; filter by post type and flair. |
| Outliers (× median) | How many times the subreddit's (or user's) **median score** a post got; same Viral Score formula. |
| Best time to post | Day × time heatmap of median score per subreddit. |
| Hashtags | **Title analysis**: question vs. statement, title length, words and two-word phrases that perform; **flair** and **post type** (text / image / video / link / gallery) performance. |
| Library folders & tags | Subreddits (`r/excel`) and Reddit users (`u/name`) sit in the same folders as Instagram accounts, e.g. an *Excel* folder with your competitors next to r/excel and r/spreadsheets. *Top posts* ranks reels and Reddit posts together, each against its own account's median. |
| MCP | `subreddit_summary`, `top_posts`, `content_ideas`, `collect_subreddit`. |

How ReelScope gets Reddit data (read-only, from your own logged-in tab, never the official API):

1. **Posts on the page**: every `<shreddit-post>` on www.reddit.com (and the ones that load while you scroll, or with **Auto-scroll**) is read from its attributes (`post-title`, `score`, `comment-count`, `permalink`, `author`, `subreddit-prefixed-name`, `created-timestamp`, `post-type`, flair).
2. **Collect top posts** (panel button): opens the subreddit's top posts of the year (or the user's posts), scrolls until no more load (up to 1,000) and reads every post. Reddit answers its listing `.json` with HTTP 403 even for logged-in tabs, so the page is the source; page data has no upvote ratio.
3. Agents (`collect_subreddit`) still try the listing JSON once, in case Reddit opens it again; after a 403 ReelScope remembers that for a day and reads the page instead, in a small unfocused window of its own (Reddit's infinite scroll may not load in a background tab; if that window is hidden behind others, Reddit may load fewer posts).

ReelScope never posts, comments, votes or sends messages on Reddit. Reddit has no downloads in ReelScope.

### Reddit Mentions (keyword alerts)

Watch Reddit for keywords, like TrackReddit / F5Bot, without a server: **Library → 🔔 Mentions** (or the toolbar popup).

- **Watches**: a query plus optional subreddits, exclude words and kinds (posts / comments). Query syntax: every word must appear, `"quotes"` = exact phrase, `formula*` = prefix; case, accents and Turkish İ/ı don't matter. Example: `"excel formula" vlookup` in r/excel, not `hiring`.
- **Checks** run every 15 minutes while Chrome is open (and a few seconds after you add or edit a watch). They use Reddit's RSS/Atom feeds, the same URLs as reddit-watch: `/r/<subs>/search.rss?q=…&restrict_sr=1&sort=new` (or `/search.rss` for all of Reddit) for posts, and `/r/<sub>/comments/.rss` for the newest comments of each watched subreddit (Reddit has no comment search, so comment watches need a subreddit list). Reddit answers its listing `.json` with HTTP 403 even for logged-in tabs, so Mentions doesn't use it. Feeds allow about one request a minute, so ReelScope queues them and sends one every ≥61 s (an alarm, so the service worker never sleeps); with an open reddit.com tab the request is made inside that tab (`chrome.scripting`), otherwise straight from the extension. A 429 waits 2, 4, 8 … minutes (at most an hour, longer if Reddit's `Retry-After` / `x-ratelimit-reset` says so) and moves that feed behind the others; if the feeds are refused, checks back off 15, 30, 60, then 120 minutes. Feeds have no scores. Read-only.
- **New matches** show a Chrome notification, a badge on the toolbar icon, and land in the **inbox**: filter by watch, unread only, mark read, open the thread. Duplicates are dropped by Reddit id (`t3_…` posts, `t1_…` comments). The newest 3,000 are kept.
- **Home server (optional, off by default)**: link the [reddit-watch](../reddit-watch) service for 24/7 watching when Chrome is closed. Enter its address (Tailscale IP or tunnel host) and API token on the Mentions page; Chrome asks for permission for that one host. ReelScope then calls `GET /health`, pushes its watch list with `PUT /watches` (the extension's list is the source of truth) and pulls `GET /mentions?since=…` into the same inbox (marked *home server*). If the server is down, the page says so and the extension keeps checking on its own. The token is never written to backup files.
- Mention record (shared with reddit-watch): `{ id, kind, watchId, query, title, excerpt, subreddit, author, permalink, createdAt, score, foundAt, source }`, `source` = `extension` or `hayati` (the home server).

## Install (developer mode)

1. Download this repo (`git clone` or **Code → Download ZIP** and unzip).
2. Open `chrome://extensions` (Edge: `edge://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and pick the `reelscope` folder (the one with `manifest.json`).
5. Reload any open Instagram tabs.

## Use

1. Open a profile's Reels tab: `https://www.instagram.com/<username>/reels/`
2. Scroll down, or click **ReelScope → Auto-scroll**. Reels are collected as Instagram loads them.
3. Use the **Reels**, **Analytics** and **Export** tabs in the panel.

Reddit: open a subreddit or a user while logged in (`https://www.reddit.com/r/excel/`, `https://www.reddit.com/user/<name>/`), click **Collect top posts** (it opens the top posts of the year and scrolls them; or scroll / Auto-scroll yourself), then use the **Posts**, **Analytics** and **Export** tabs. Saved as `r/excel` / `u/name` in the Library.

Collected data is saved per profile in `chrome.storage.local`, so it is still there next time. Delete it from the panel (**Clear**) or the toolbar popup (**Delete all data**).

## Connect AI agents (MCP)

ReelScope ships a local [MCP](https://modelcontextprotocol.io) server, so Claude (Desktop or Code), Cursor or any MCP client can use your library: rank reels across a folder, read an account's analytics, download a reel's mp4 to analyze it, or ask the extension to collect a new profile. Everything stays on your computer.

**1. Install the server's dependencies (once)**

```bash
cd reelscope/mcp && npm install
```

**2. Add it to your agent**

Claude Code:

```bash
claude mcp add reelscope -- node /absolute/path/to/reelscope/mcp/server.mjs
```

Claude Desktop: open *Settings → Developer → Edit Config* and add the following to `claude_desktop_config.json`, then restart Claude. Use the full path to `node` (`which node`), because desktop apps don't see your shell's PATH.

```json
{
  "mcpServers": {
    "reelscope": {
      "command": "/full/path/to/node",
      "args": ["/absolute/path/to/reelscope/mcp/server.mjs"]
    }
  }
}
```

**3. Keep "Connect to AI agents" on** in the ReelScope toolbar popup. Its status line shows when the extension is connected. Your library syncs within a few seconds, and again whenever it changes.

**Tools agents get**

| Tool | What it does |
|---|---|
| `list_accounts` | saved accounts with folder, tags, reels, median views, outliers |
| `list_folders_and_tags` | your folders and tags |
| `account_summary` | one account's analytics: best posting slots, hashtags, video length, audio, top reels |
| `top_reels` | rank reels across a folder / tag / accounts by viral score, views, engagement…; `since_days` filter |
| `search_reels` | find reels by caption, hashtags or audio |
| `get_reel` | everything about one reel, incl. the **mp4 `video_url`**, `cover_url` and when the links expire |
| `download_reel` | save the mp4 and/or cover to `~/Downloads/ReelScope/<account>/` and return the file path, so the agent can analyze the video |
| `refresh_reel` | get fresh stats and links for one reel (Instagram's links expire after a few days) |
| `collect_profile` | the extension pages through a profile's posts in your browser and adds them to the library (`r/name` / `u/name` collect Reddit instead) |
| `subreddit_summary` | one subreddit or Reddit user: median score & comments, upvote ratio, best posting slots, question vs. statement, title length, words & phrases that perform, flairs, post types, top posts |
| `top_posts` | rank Reddit posts across a folder / tag / list of subreddits by viral score, score, comments, upvote ratio…; filter by flair, post type, questions only, `since_days` |
| `content_ideas` | the most-upvoted **questions and pain points** in a set of subreddits, grouped into themes; when you pass a folder or tag, each theme shows how many reels the Instagram accounts in that folder already made about it (`on_instagram`), so gaps stand out |
| `collect_subreddit` | the extension collects a subreddit / user with your logged-in Chrome: opens the top posts of the year in a small unfocused window and scrolls them (Reddit refuses its listing JSON) |
| `mentions` | the Mentions inbox: posts and comments that matched your keyword watches (from the extension and the home server), filter by watch, `since_days`, unread, subreddit, kind; includes the watch list with found / unread counts |
| `command_status`, `bridge_status` | check a running command / the connection |

`list_accounts` shows each account's `platform` (and takes a `platform` filter); `search_reels` searches reels and Reddit posts; `top_reels` stays Instagram-only.

Example prompts: *"Use ReelScope: compare the 10 most viral reels in my Excel folder from the last 90 days and summarize their hooks."* · *"Download @someone's top reel and describe its first 3 seconds."* · *"Collect @newcreator, then tell me their best posting time."* · *"Collect r/excel and r/spreadsheets, then use content_ideas on my Excel folder and give me 10 'Excel Bug' reel ideas that my competitors haven't covered yet."*

**How the connection works.** The MCP server keeps a copy of your library in `~/.reelscope/` and opens a small bridge on `127.0.0.1`. It takes the first free port in 47811–47820, skipping ports that other programs use; if another ReelScope server (say, from Claude Desktop) already holds a port, it shares that one. The extension scans the same ports and only talks to a server that identifies itself as ReelScope. The bridge only accepts requests from the browser extension, never from websites (it checks the `Origin` and `Host` headers), and it pairs with the first ReelScope extension that connects. To re-pair, delete `~/.reelscope/config.json`. Agent commands run in an Instagram tab you already have open; if there is none, the extension opens one in the background and closes it again. Reddit commands always open the subreddit's page in a background tab (using your logged-in session) and close it when done.

## How it works

```
instagram.com page
 ├─ src/hook.js      (page world, document_start)
 │    listens to Instagram's own fetch/XHR responses from /graphql and /api/v1/
 │    and forwards the JSON text with window.postMessage. Makes no requests itself.
 ├─ src/extract.js   turns any Instagram JSON into normalized post records
 ├─ src/metrics.js   Viral Score, outliers, analytics, CSV/TSV
 ├─ src/panel.js     the on-page panel (Shadow DOM, built with textContent only)
 ├─ src/overlay.js   toolbar + stats card over the reel/post being viewed
 └─ src/content.js   glue: storage, missing-details loader, profile detection, auto-scroll
reddit.com page
 ├─ src/reddit.js          turns listing JSON and <shreddit-post> attributes into post records (pure, Node-testable)
 ├─ src/metrics.js, src/panel.js   (shared with Instagram: score instead of views, title/flair/type analysis)
 └─ src/reddit-content.js  reads posts on the page, "Collect top posts" (opens top/year and scrolls), auto-scroll, agent commands
src/background.js    saves media files with chrome.downloads (Instagram CDN hosts only), opens the library
src/agent-bridge.js  syncs the library (and Reddit watches + mentions) to the local MCP server and runs agent commands
src/mentions.js      Reddit keyword matching, request plan, dedupe/merge (pure; same rules as reddit-watch)
src/mentions-bg.js   the 15-minute Mentions checker, notifications, optional reddit-watch server link
mcp/                 local MCP server (server.mjs = tools, bridge.mjs = 127.0.0.1 bridge, library.mjs = data + queries)
dashboard/           the Library page: folders, tags, per-account view, cross-account Top reels
popup/               toolbar popup: open the library or the panel, settings, saved profiles
```

Instagram's profile grids send slim records: the Reels tab often leaves out the date, caption and length, and the posts grid often leaves out views. To fill the gaps, ReelScope asks Instagram for one post's details at a time (`/api/v1/media/{id}/info/`, the same request Instagram's own post page makes), with about 2 seconds between requests. It backs off for 30 s, 60 s, then 120 s if Instagram says to slow down, and stops if you're logged out. You can turn this off in the toolbar popup ("Load missing views & dates"). With it off, ReelScope only reads what Instagram loads while you scroll.

Instagram has renamed its view counter several times. `extract.js` checks `play_count`, `ig_play_count`, `view_count`, `video_view_count`, `video_play_count` and `fb_play_count`, in that order. If counts stop showing up after an Instagram update, that list is the first place to look.

## Privacy

- No analytics, no tracking, no remote servers. The only requests ReelScope makes are to instagram.com and reddit.com themselves (post details, listing pages, see above), from your own logged-in session, and, if you use agents, to the MCP server on your own computer (`127.0.0.1`).
- Permissions: `alarms` (check for the local MCP server every 30 s, Reddit Mentions every 15 min), `notifications` (new Mentions), `scripting` (make the read-only Mentions request inside your open reddit.com tab), `storage` + `unlimitedStorage` (save collected posts; large libraries outgrow the default 10 MB), `downloads` (save media files), optional host access to your reddit-watch server (asked for only when you connect one), host access to `www.instagram.com` and `www.reddit.com`, and to Instagram's and Reddit's image hosts (`*.cdninstagram.com`, `*.fbcdn.net`, `*.redd.it`) so the Library page can load and cache cover images.
- The Library caches cover images in the extension's own IndexedDB, so covers keep showing after Instagram's links expire.
- It never asks for your Instagram or Reddit password and never posts, likes, votes, comments, follows or messages.

## Develop

No build step: edit the files and click reload on `chrome://extensions`.

```bash
npm test                         # unit + MCP end-to-end tests (Node 20+, run `npm install` in mcp/ first)
node dev/make-fixture.mjs        # regenerate the fake Instagram response
node dev/make-reddit-fixture.mjs # regenerate the fake Reddit listings (dev/reddit/listings.json)
python3 -m http.server 8791      # then open http://127.0.0.1:8791/dev/demo.html
```

`dev/reddit-demo.html` runs the Reddit content script on a fake r/excel page (fake `<shreddit-post>` elements from `dev/reddit/shreddit.html`, fake listing JSON for agent commands). `dev/dashboard-demo.html` does the same for the Library page with three fake Instagram accounts and two fake subreddits. `dev/demo.html` runs the real content scripts on a normal page with a stubbed `chrome` API and fake data, so you can work on the UI without opening Instagram.

## Roadmap

- [ ] TikTok
- [ ] Reddit comments: collect a thread's top comments for deeper pain-point mining
- [ ] AI transcripts with your own API key (OpenAI Whisper / Groq)
- [ ] Compare two or more profiles side by side
- [ ] Firefox support
- [ ] Chrome Web Store / Edge Add-ons listing

Contributions welcome. Open an issue or a pull request.

## Responsible use

Use ReelScope for research on public content. Downloads are for content you own or have permission to use. Respect creators' copyright and Instagram's and Reddit's terms. Keep Reddit collection moderate: ReelScope paces itself (~2 s between requests), don't run it in loops.

## Credits

The idea of reading Instagram's own network responses (instead of the page markup) was inspired by [leoplanello/instagram-reels-sorter](https://github.com/leoplanello/instagram-reels-sorter). ReelScope's code is written from scratch.

## License

[MIT](LICENSE)
