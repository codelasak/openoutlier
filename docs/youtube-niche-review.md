# youtube-niche: final review findings (2026-11-21)

**Status (2026-11-21, branch `claude/review-fixes-7adadf`): all 43 items fixed; see the notes under each and "Review düzeltmeleri" in the plan.**

These findings come from two reviews of the merged phases 0–5 on `youtube-niche`, measured against `main`. Every item is to be fixed. When a fix is done, mark its checkbox and add a one-line note. If you deliberately don't fix one, say why.

Evidence screenshots for the UI items are in `/private/tmp/claude-501/-Users-eshagh-web-code-openoutlier/63c5f623-dd40-40ca-bcea-6c715447a635/scratchpad/ui-review/`. They may be gone after a reboot; the descriptions below stand on their own.

## A. Code review (correctness and efficiency)

- [x] **A1 · `mcp/niche.mjs:210`: RSS writes ~30 unchanged rows per channel every 15 min.** `rssJob` inserts a `video_stats` row for every feed entry (15 long-form + 15 Shorts) on every run, even when nothing changed. Retention is off by the user's decision, so the table grows without limit: 16 channels × 30 × 96 ≈ 46k rows/day, ~17M a year. Fix: skip a row when views and likes equal the video's last stored reading. Optionally, for videos older than 30 days, keep at most one RSS reading per day. Add a migration (next number per the plan notes) that removes the existing consecutive duplicates, keeping the first reading of each run of equal values, so curves don't change.
  - **Done:** an RSS reading equal to its video's last three rows replaces the middle one (store.addVideoStats), so a flat run keeps its first row, its last two and one row at least every 2 h (young) or 1 day (older than 30 d). Keeping the last two, not one, survives velocity.series merging a same-second API reading. Migration 6 (collapseRssRuns) applies the same rule to existing rows. tests/review-fixes.test.mjs: rows drop by two thirds or more, checkpoints and the quarter-hour curve are identical, idempotent.
- [x] **A2 · `mcp/niche.mjs:466`: `checkBreakouts` reloads the whole niche model on every RSS job.** Every RSS job that sees a video younger than 30 h calls `loadModel(..., fresh: true)` for the entire niche, and a tick runs up to 25 RSS jobs. Fix: collect candidate video ids across the tick and run breakout checks once per niche after the loop (e.g. a post-tick hook in the tracker, or a cheap `breakouts` singleton job), or score only the affected videos against cached per-channel curves.
  - **Done:** rss and video jobs queue young video ids with ctx.after('breakouts'); the tracker runs NICHE_AFTER_TICK.breakouts once after the tick, which loads each niche's model once. A job run by hand still checks at once. Test: two RSS jobs, one check.
- [x] **A3 · `mcp/niche.mjs:394`: the `loadModel` memo is invalidated by every insert.** The signature is COUNT(*) and MAX(ts) over all of `video_stats`: a full count on every call, and any write anywhere invalidates the memo, so `/youtube/cards` lookups (`mcp/cards.mjs:33`) rebuild the model while the user scrolls. Fix: keep a monotonic write counter in `meta`, bumped in `addVideoStats` and when `tracked_videos` changes, use it as the signature, and let read paths accept a time-based memo.
  - **Done:** loadModel's signature is meta.stats_rev, bumped on new video_stats rows and on tracked_videos changes the model reads (a rewritten-but-equal RSS entry or a longer flat run doesn't bump). Read paths pass maxAge; /youtube/cards uses 5 min (latest counts still come straight from video_stats). Test included.
- [x] **A4 · `rs:settings` read-modify-write races.** Several unsynchronized writers do get → modify → set on the whole `rs:settings` object:
  - **Done:** OpenOutlierFeatures.updateSettings(patch | fn) is the only writer: it merges just the changed top-level keys into a fresh read, serialized in the context and, across the extension's pages and service worker, by a Web Lock; content scripts send their writes to the service worker. radar, niche and ownProfit moved to rs:radar, rs:niche-settings, rs:own-profit (migrateSplit at worker start; readSetting falls back). Settings page, Niş Takibi, radar, Kanalım profit, popup and feature switches all use it. Tests: interleaved writers from three contexts lose nothing, split keys, migration, content-script path.
  - `dashboard/settings-view.js:101` (`setSetting`)
  - `dashboard/niche-view.js:573` (`saveNiche`)
  - `dashboard/discovery-view.js:166` (`saveRadar`)
  - `popup/popup.js:111`
  - the content scripts

  `features.js` serializes only its own writes, and only within one JS context. Result: a toggle, an API key, radar keywords or niche settings can silently revert. Fix: put every `rs:settings` write behind one helper, e.g. `OpenOutlierFeatures.updateSettings(fn)` or a small `src/settings-store.js`. The helper serializes within the context and merges only the sub-key being changed against a fresh read. Better still, split independent sub-keys (`radar`, `niche`, `uiLang`, choices) into their own storage keys, so cross-context writes can't clobber each other. Migrate existing values.
- [x] **A5 · `src/youtube-insights-bg.js:160`: a monetization queue key can stick in "checking".** `runQueue` has no per-job try/finally. If storage throws, `queued[job.key]` stays true, and the badge spins until the worker restarts. Fix: wrap each job in try/finally, delete the key, and keep draining.
  - **Done:** each queued job runs in try/finally; its key is deleted and the queue keeps draining. Test: a storage write that throws once.
- [x] **A6 · `src/youtube-insights-bg.js:151`: the credentialed retry can cache a false "not monetized" for 7 days.** The retry with `credentials: 'include'` uses the user's session; with YouTube Premium the page has no ad config, so the result is "no". Fix: treat a credentialed result without `yt_ad` as `unknown`, or retry without cookies but with a consent cookie such as `SOCS`. Also keep the "unknown" cache TTL short.
  - **Done:** a credentialed retry without ad config is 'unknown' (a Premium session has none), and 'unknown' expires after 6 h. Entries are stored with the 7-day TTL for pruning (cachePut used to drop every other verdict older than the short TTL) and monGet ages 'unknown' out early. Test included.
- [x] **A7 · `mcp/youtube-analytics.mjs`: a failed channel lookup can overwrite the legacy token.** When `myChannel` fails after sign-in, `writeToken` falls back to `youtube-token.json` and may overwrite another, not yet migrated channel's token. Fix: store it as `youtube-token-pending-<random>.json`, and adopt it on the next successful lookup (`listTokens` should include pending files). Add a test.
  - **Done:** a sign-in whose channel lookup fails is saved as youtube-token-pending-<hex>.json (0600); listTokens lists it, accessToken({ file }) refreshes it in place, and adoptLegacyToken moves every unidentified token (legacy file and pending files) to its channel's file unless that channel has a newer sign-in. Test: legacy token of channel A untouched while B's lookup fails, both adopted later.

## B. UI review: must fix

- [x] **B1 · Watch page at 390 px scrolls sideways, so the toolbar rides over the masthead.** The OO toolbar is inserted inside YouTube's like/share row (`#top-level-buttons-computed`). The row grows to 477 px on a 390 px viewport: Like wraps, and "İndir" and "…" are clipped. With the page wider than the viewport, the visual viewport scrolls and the sticky masthead slides away. Files: `src/overlay.js:317-321` (`pl.inline.insertBefore(host, pl.inline.firstChild)`) and `src/youtube-content.js:764` (`overlayPlacement`). Fix:
  - **Done:** root cause fixed: the toolbar is no longer inside YouTube's like/share row. It lives in our own row (.openoutlier-watch-row) right after ytd-watch-metadata #top-row, so it takes no width from YouTube's buttons; below 600 px it shrinks to the OO button plus '…', and a fixed card's top is clamped below #masthead-container / ytd-masthead. At 390 px scrollWidth = innerWidth on every surface; after scrolling 600 px the masthead is at top 0 with nothing of ours over it. (Placed after #top-row rather than inside #actions: next to the row it would still have taken its width.) Screenshots review-b1-*.
  - insert the toolbar as a sibling *before* the row, inside `#actions`, not inside it;
  - below ~600 px, collapse it to one "OO" button or the rail;
  - clamp the fixed stats card's `top` to the masthead's bottom.
- [x] **B2 · The Library top nav strip at 390 px** scrolls sideways with no hint, and the current chip is off-screen (#/niche, #/swipe). File: `dashboard/dashboard.css:553-571`. Fix: `scrollIntoView({inline:'center', block:'nearest'})` on the `aria-current` chip after render, plus an edge fade (`mask-image`) and scroll-snap. Better: below 760 px, use a "Menü" drawer or a select.
  - **Done:** the current chip is centred after every render (side.scrollTo, no page scroll), the strip has edge fades (mask-image) and scroll-snap. Screenshots review-b2-*. A drawer was not added: the centred chip plus fades was enough at 390 px.
- [x] **B3 · Turkish uppercase is wrong because `<html lang>` stays "en".** CSS uppercase produces "BU HAFTAKI", "UZUN VIDEO", "SAATTEKI", "BAŞLIK KELIMELERI", "SPONSOR LINKI", "INDIRIM", "BENIM", "YENI", "NIŞ MEDYANI", "ÜCRETLI". Only the features list sets its own lang, which gives "SCRAPİNG" there. Files: `dashboard/dashboard.html:2`, `dev/dashboard-demo.html:2`, `dashboard/dashboard.js`. Fix:
  - **Done:** renderSidebar sets <html lang> from uiLang() on every render (Library and popup); 'scraping' is wrapped in lang="en" in the Features list and the provider tags. Every in-page shadow host (panel, toolbar, Track button, cards, tool chips, popover, feed bar, Studio dialog) gets lang via F.applyLang. Screenshot review-b3-* ('BU HAFTAKİ').
  - on every render, set `document.documentElement.lang = OpenOutlierFeatures.uiLang()`;
  - set the same `lang` on the shadow hosts of the in-page cards;
  - make technical English terms immune: don't uppercase "SCRAPING" in TR, or keep the brand words in `lang="en"` spans.
- [x] **B4 · Percent deltas on Kanalım use English order in TR.** Values read "%3,2" but deltas read "−13%", "+21%", "+0,8%". This shows on the KPI tiles, the chart headline ("önceki 28 güne göre −13%") and the change pills. A CTR delta is percentage points. File: `dashboard/youtube-channel-view.js:166` (`signedPct`). Fix: `Intl.NumberFormat(loc,{style:'percent',signDisplay:'exceptZero'})`, which gives "−%13" in TR. Rate deltas become "+0,8 puan" / "+0.8 pts".
  - **Done:** F.signedPct (Intl percent, signDisplay exceptZero, real minus) gives '−%13' / '−13%'; CTR and average-view-% changes are points ('+0,8 puan' / '+0.8 pts') on KPI tiles, chips and the headline. Tests in features.test.js. Screenshot review-b4-*.
- [x] **B5 · No plurals in English counts.**
  - **Done:** F.plural(n, { one, other }) (Intl.PluralRules); every count string in Kanalım, Niş Takibi, discovery, swipe, Settings providers, the Library sidebar and the popup has one/other forms. YouTube page cards: day(s), saved video(s), video(s) too.
  - Seen: "last 1 weeks", "Last 1 weeks · 9 views" and "1 videos · 1 Shorts" (Kanalım, tiny channel).
  - The same pattern exists in `'{n} videos'`, `'{n} channels'`, `'{n} clips'`, `'{n} keywords'` and `'{n} days'`.
  - Files: `dashboard/youtube-channel-view.js:40,43,57`, `dashboard/niche-view.js:26-74`, `dashboard/discovery-view.js:32-61`, `dashboard/swipe-view.js:13`, `src/youtube-pages.js:29,50`.
  - Fix: one shared `plural(n, {one, other})` helper (`Intl.PluralRules`), with `_one` / `_other` strings for every count.
- [x] **B6 · The Settings → "Outlier formülü" segmented control has no border or background.** `.ft-seg` / `.ft-seg-btn` use `--line-2`, `--card` and `--sunk`, which exist only in `panel.css` and `popup.css`, not in `dashboard.css`, so the unselected option reads as plain text. File: `dashboard/dashboard.css:542-547`. Fix: use dashboard tokens and the shared segmented style (see B15).
  - **Done:** the Features list choice (.ft-seg) now uses dashboard tokens and the .seg look (surface track, ink-outlined active button). Screenshot review-b6-*.
- [x] **B7 · Shorts at 390 px: the floating OO panel button covers YouTube's Share and "…" buttons, and the stats card touches the player's top controls.** Files: `src/panel.js` (launcher position) and `src/youtube-content.js:768-772` (rail placement). Fix: on Shorts and at narrow widths, hide the floating button (the rail already opens the panel) or move it above the action column, and add an 8 px offset below the top controls.
  - **Done:** no floating panel button on Shorts (the rail opens the panel); the narrow Shorts card sits 8 px below the player's top controls and never above the masthead; toolbar buttons 40 px below 600 px. Screenshots review-b7-*.
- [x] **B8 · On Shorts at desktop width (TR, 1280 px), the side-card hint is clipped mid-word:** "Yaş, toplam izlenme ve ülke için bir Y". `.sub{white-space:nowrap}` also hits the multi-line hint. File: `src/youtube-pages.js:124`. Fix: a `.hint{white-space:normal}` class.
  - **Done:** .sub.hint { white-space: normal }; the clipped hint itself was replaced by C25's single line.
- [x] **B9 · The watch-page stats popover (the OO toolbar button) is all English in TR, and its open state persists.**
  - **Done:** the stats card is TR/EN (numbers and dates too) and its open state is no longer saved on YouTube; on watch pages the OO button scrolls to the inline watch card and flashes it (the card opens only when the inline card is switched off).
  - Strings: "Views", "Likes", "Collect this channel's Videos tab…", "Most replayed at", "Open the OpenOutlier panel", and the date "May 8, 2025".
  - Because `openKey` saves the open state, the popover reopens on every video and covers the inline watch card, which shows the same numbers.
  - Files: `src/overlay.js:280-290` and `src/youtube-content.js:776-787`.
  - Fix: localize it through the same TR/EN table, and don't persist the open state on YouTube. Better: on watch pages, drop the popover and make the button scroll to and highlight the inline card.
- [x] **B10 · Niş Takibi at 390 px: the niche curve SVG is a fixed 460 px wide.** It scrolls inside its card, so "7 g / 14 g / 30 g" are cut off. File: `dashboard/niche-view.js`. Fix: a fluid SVG (`viewBox`, `width:100%`) and thinner axis labels below 480 px. Check the other charts too (Kanalım progress, channel growth sparklines, radar).
  - **Done:** the niche curve is drawn for its width: below 600 px a 360-unit viewBox with every other age label, width 100%, no min-width. Kanalım's chart already redrew per width; growth sparklines are fixed-size; radar has no chart. Screenshot review-b10-*.

## C. UI review: should fix

- [x] **C11 · Mixed TR/EN on TR screens.**
  - **Done:** Library sidebar, top bar, folder prompts and scope titles; thumbnail tester chips and its default view count; the whole popup (features.js now loaded there). YouTube panel: tabs, Auto-scroll/Stop, Clear, Close, sort labels, summary, units and toolbar aria-labels follow uiLang. Still English: the panel's Analytics and Export tab bodies and the Instagram/TikTok/Reddit panels (large, not YouTube). Instagram/TikTok/Reddit-only views inside the Library (account pages, Mentions, My Instagram account, Compare) stay English: large, and not YouTube.
  - Library sidebar and top bar: "Mentions", "3 new", "My account", "All accounts", "Top posts", "Unsorted", "Compare platforms", "Folders", "Tags", "Back up", "Restore", "Search accounts" (`dashboard/dashboard.js:460-478`, `dashboard/dashboard.html:19`).
  - Panel tabs "Videos / Analytics / Export", plus "Auto-scroll" and "Clear" (`src/panel.js`).
  - Toolbar aria-labels: "Download video", "Show OpenOutlier stats", "Download cover image".
  - The popup is all English even with `?hl=tr` (`popup/popup.js`).
  - Thumbnail tester mock grid: "All", "Tutorials", "Recently uploaded"; the views default is "1.2K".

  Route all of these through `uiLang()`, since the Settings "Dil" card promises the language. At minimum, cover the Library chrome, the YouTube panel, the toolbar and the popup. Instagram/TikTok/Reddit-only panel text may stay English if it's large, but note it.
- [x] **C12 · Lime is used outside its outlier role.** The brand reserves lime for outliers and the one key number. Fix each of these:
  - **Done:** Library: the last Kanalım bar is --s5 in both themes, YENİ search-term tags and the 'aramadan … izlenme' rank badges use --accent-soft, keyword lifts are ink. YouTube: the mark is one-colour blue on light YouTube (ring + lime trail only on dark/ink), the monetized pill is a neutral outline with ✓, the filter count bubble is paper/ink, the pinned tag and ok dot aren't lime. The EN YAKIN YPP tag was already blue (accent on dark), left as is. Screenshots review-c12-*.

  | Where | File | Fix |
  |---|---|---|
  | Monetized pill "Para kazanıyor" (`.mon.yes` uses `--hot-*`) | `src/youtube-pages.js:130` | neutral outline pill with ✓ |
  | Keywords "sıralanıyorsun" rank badges | | `--accent-soft` |
  | Last Kanalım chart bar in dark mode (`.kc-bar.is-last`) | `dashboard/dashboard.css:1102` | `--s5` in both themes |
  | "YENİ" search-term tags and the "EN YAKIN" YPP tag | | non-lime |
  | Lime trail of the mini logo on light YouTube (`MARK`) | `src/youtube-pages.js:177`, `src/youtube-tools.js:176`, `src/youtube-cards.js:648` | one-colour blue mark on light grounds |
  | Count bubble `.n` on light YouTube | `src/youtube-cards.js:622` | non-lime |
- [x] **C13 · Control borders fail contrast.** `--border-2 #BFC3B4` on white is 1.8:1; the brand's `line-strong #6E7590` (4.2:1) is meant for control borders. In dark mode, the off-switch track `#3A4570` on `#121729` is 1.9:1. Files: `dashboard/dashboard.css:9,47` and `.ft-switch span`. Fix: map control borders to `#6E7590` / `#6A7190`, and give the off switch an outline or a lighter track.
  - **Done:** --border-2 is the brand's line-strong (#6E7590 light, #6A7190 dark) for control borders; the off switch is an outlined track with a grey knob.
- [x] **C14 · Two "Filtreler" buttons sit stacked on YouTube search** (YouTube's and ours). File: `src/youtube-cards.js` (feed bar). Rename ours "Outlier filtreleri" / "Outlier filters", or show only the OO mark plus a count of active filters.
  - **Done:** ours reads 'Outlier filtreleri' / 'Outlier filters'.
- [x] **C15 · Three segmented-control styles.**
  - **Done:** .seg with aria-pressed is the one style; .ft-seg and the swipe tag chips use the same pressed look; .set-pill became outlined status tags (they aren't controls).
  - `.seg`: outlined white active state (Niş Takibi Hepsi/Videolar/Shorts, Dil, Thumbnail tester, Swipe).
  - `.ft-seg-btn.is-on`: filled blue.
  - `.set-pill.is-on` and `.chip.sw-tag.is-on`: filled ink or blue.

  Pick one (`.seg` with `aria-pressed`) and remove the rest.
- [x] **C16 · Badge clutter on video cards.**
  - **Done:** subscribers moved to the meta row after the channel name and hidden on the channel's own page; at most 2 thumbnail badges (outlier first); the velocity badge uses the same dark style. Screenshots review-c16-*.
  - Up to three badges ("72 sa: 3,4×", "654/sa", "3,4 B abone") cover ~80% of a 4-column home thumbnail and sit over the thumbnail text.
  - On a channel page every card repeats the channel's own subscriber count.
  - The blue velocity badge looks foreign on YouTube.

  File: `src/youtube-cards.js:323-334`. Fix: hide `oo-subs` on the channel's own page and move subs to the meta row instead of the thumbnail; at most 2 badges by default; velocity in the same dark style as the others.
- [x] **C17 · The channel card is too heavy.** Stats, a no-key notice, sponsors and six "Benzer kanallar" rows push the Videos tabs below the fold at 390 px and to mid-screen at 1280 px, and the floating OO button covers "Kanal haritası →". Files: `src/youtube-pages.js` and `src/youtube-similar.js`. Fix: make the card collapsible (remember the state), show three similar channels plus "+3", and drop "(popup)" from the hint.
  - **Done:** the channel card folds (localStorage openoutlier:channel-card-folded), shows 3 similar channels plus '+N', no '(popup)', 'Anahtar ekle' links to Settings; nothing floats over 'Kanal haritası →'. Screenshots review-c17-*.
- [x] **C18 · Two OO toolbars on the watch page, plus a tall card above the description.**
  - **Done:** one toolbar: Transcript / Yorumlar / Kaydet chips sit in the OO toolbar's row (an open panel takes its own line); an empty outlier cell shows only 'Anahtar ekle', the explanation moved to its tooltip. The card stays above the description (it holds the numbers people look for first). Screenshots review-c18-*.
  - The icon toolbar sits in the like row, and a second row (Transcript / Yorumlar / Kaydet) sits under the card.
  - The "Outlier –" cell shows a long hint instead of a value.

  Files: `src/youtube-tools.js` and `src/youtube-pages.js`. Fix: merge them into one toolbar, show a single "Anahtar ekle" link when there is no value, and consider placing the card after the description.
- [x] **C19 · The Niş Takibi header changes between tabs.**
  - **Done:** one header (niche · channels · updated, picker, Channels, Refresh) on every tab; the thumbnails view highlights Takip and has '← Takip'; one skeleton instead of 'Yükleniyor…' twice.
  - Takip has "Excel · 16 kanal · az önce güncellendi" plus Kanallar / Yenile; Radar, Map and Keywords show only "Excel".
  - The "Benzer thumbnail'ler" sub-view highlights no tab, has no back link, and shows "Yükleniyor…" twice.

  File: `dashboard/discovery-view.js`. Fix: one shared header, "← Takip" on the thumbs view, and one skeleton.
- [x] **C20 · Turkish grammar and typos.**
  - **Done:** '…30 günlük izlenmesinin %60 kadarı ilk 48 saatte gelir' (no suffix on the number), 'takibin ilk saatlerinde yakaladığı videolardan', the empty-curves sentence rewritten, 'özelliği açılıp … API anahtarı eklenmeden', the Shorts pace now 'günde 9 izlenme', 'Bu hızla 90 günde yetişmiyor' (365 for watch hours).
  - `niche-view.js:87-88`: "%60'ini" / "%83'ini" are wrong (should be "%60'ını" / "%83'ünü"). Reword to "…30 günlük izlenmesinin %60'ı ilk 48 saatte gelir".
  - `niche-view.js:92`: "takipçinin genç yakaladığı videolardan" → "takibin ilk saatlerinde yakaladığı videolardan".
  - The niche empty state "Eğriler, ilk yeni yüklemeler ilk saatlerinden itibaren takip edilince oluşur" is garbled; rewrite it.
  - `settings-view.js:65`: "anahtar" is used for both the switch and the key → "özelliği açılıp … API anahtarı eklenmeden".
  - Kanalım: "günde 9" is missing its unit (izlenme); "Bu hızla olmuyor" → "Bu hızla 90 günde yetişmiyor".
- [x] **C21 · Unclear labels.**
  - **Done:** 'Tıklama oranı' instead of TO, 'Ülke / dil' in radar and keywords, the ratio badge reads 'izlenme / abone', 'aramadan 77 izlenme' (the number is views from that search, per ranksTip), market names instead of hl/gl, similarity % instead of hash bits, length buckets '< 5 dk', 'Para kazanma rozeti', 'Transkript araçları', '24 sa'. In-page labels already said '24 sa'; the '24 s:' was in the Features list description.
  - "TO" for CTR → "Tıklama oranı" / "Gösterim TO".
  - Radar "Pazar" vs Keywords "Ülke" for the same field → "Ülke / dil" in both.
  - "abone b." → "abone başına".
  - "sıralanıyorsun · 77" → "77. sıradasın" (or whatever the number really is; check it).
  - Jargon to remove: "hl=en gl=US", "64 bitlik perceptual hash", "2 bit fark".
  - Raw duration bucket keys "<5m", "5–10m" (`src/velocity.js:372-378`) → localize to "<5 dk".
  - `src/features.js:89,106,109`: "Monetized rozeti" → "Para kazanma rozeti", "Transcript araçları" → "Transkript araçları".
  - Hour abbreviation: "24 s:" vs "24 sa" → use "sa" everywhere.
- [x] **C22 · Kanalım YPP card repeats itself and is easy to misread.**
  - **Done:** one ETA line in one format (per-meter lines only say when a goal isn't reachable), 'toplam {n} saat izlenme' in milestones, and the first-N-views video milestone now uses every known video (own_videos day rows, the tracker's readings, the Library's posts); when those add up to under 90% of the channel's views it says 'henüz bilinmiyor' instead of 0. Test in own-metrics.test.js.
  - "Bu hızla: ~2 ay (Oca 2027)" appears twice; "Bu hızla abone: ~2 ay" uses a different format.
  - Milestone "4.000 saat izlenme ✓" sits next to YPP "3.625 / 4.000" (lifetime vs 365 days).
  - "1.000 izlenmeli ilk video 0 / 1.000" on a channel with 420K views looks like a bug.

  File: `dashboard/youtube-channel-view.js:640-700`. Fix: one ETA line in one format, "toplam" wording in milestones, and make the first-1K-video milestone check all videos (fix it in `src/own-metrics.js` / `mcp/own-history.mjs` if that's where it's computed).
- [x] **C23 · Niş Takibi order at narrow widths, and confusing duplicate rows.**
  - **Done:** below 1100 px the two columns dissolve (display: contents) and Hızlı yükselenler + Benim videolarım come right after the KPI strip (CSS order); the alert row reads 'uyarı 7 saat önce · 6 sa: 9,3×'.
  - Below 1180 px, "Hızlı yükselenler" and "Benim videolarım ve niş" drop to the very end. Move them right after the KPI strip with CSS `order`.
  - The same video shows "8,5× · 14 saat önce" in Bu hafta and "9,3× · 7 saat önce" in Hızlı yükselenler. Label the alert row "uyarı 7 sa önce · 6. saatte 9,3×".

  Files: `dashboard/niche-view.js` and `dashboard/dashboard.css:596-600`.
- [x] **C24 · Settings → Features repeats the same warning about 7 times** ("Bridge'de API anahtarı yok · Anahtar ekle"), and "İsteğe bağlı servisler" appears twice. Fix: one banner per group ("5 özellik bridge'de API anahtarı bekliyor → Ekle") and provider keys inline under each switch. File: `src/features-view.js`.
  - **Done:** one banner per group when two or more switches wait for the same thing ('5 özellik bridge'de API anahtarı bekliyor · Anahtar ekle →'), rows show a small 'bekliyor' tag; provider keys stay on their row. The Settings card is now 'Servis anahtarları' so 'İsteğe bağlı servisler' appears once.
- [x] **C25 · The Shorts stats card shows empty dashes** ("Kanal yaşı –", "Ort. Shorts izlenmesi –"). Hide cells that have no data and add one "API anahtarıyla daha fazlası" line. File: `src/youtube-pages.js`.
  - **Done:** cells without data are hidden, with one 'API anahtarıyla daha fazlası · Anahtar ekle' line.

## D. UI review: nice to have (fix these too)

- [x] **D26 · Radii drift:** the brand uses 0 px for pixel badges and 8 px for buttons, inputs and cards, but the new CSS uses 1/2/3/4/5/6/8/12/18/22. Add `--r-pixel` / `--r-md` tokens and use them in the new CSS.
  - **Done:** --r-pixel (0) and --r-md (8 px) tokens; the phase 0–5 CSS uses them (the YouTube mock keeps YouTube's own radii).
- [x] **D27 · Breakpoints vary** (760/900/1000/1100/1180/1500/1560). Settle on ~3 shared ones in the new CSS.
  - **Done:** the newer CSS uses 760 / 1100 / 1500 only.
- [x] **D28 · Kanalım and My account use the same user icon in the sidebar** (`dashboard/dashboard.js:461-462`). Give Kanalım a play/channel glyph.
  - **Done:** Kanalım has a play-screen glyph; 'My account' is now 'My Instagram account'.
- [x] **D29 · Radar's "15× abone b." looks identical to the outlier "×median" badge.** Put the unit inside the badge or use a different style.
  - **Done:** views per subscriber is an outlined ratio badge with its unit inside ('15× izlenme / abone'), not the lime outlier badge.
- [x] **D30 · Red/green deltas** (Kanalım ▲▼, Keywords "↑ 2,6×", title history "1 B") vs the brand's single-hue charts. Use ink text with the arrow.
  - **Done:** Kanalım deltas, search-term week changes, report-card multiples, keyword lifts and title-history slopes are ink text with the arrow.
- [x] **D31 · Tap targets at 390 px:** feature switches are 36×21, the radar chip "×" is 22×22, toolbar buttons are 34×30. Give them a ≥32–44 px hit area.
  - **Done:** feature switches have an invisible input reaching ~48×41 px; the radar chip × has a 40 px hit area. Toolbar buttons are 36×32 in the watch row and 40×40 below 600 px; the panel's switches have a 44 px hit area.
- [x] **D32 · Neighbouring cards show different totals** (traffic 770 vs geography 639 vs devices 753). Add a "(YouTube rapor eşiği)" note. Subscribed/not subscribed sums to 101%: round so it sums to 100.
  - **Done:** a note under the audience cards when their totals differ ('YouTube rapor eşiğinin altındaki satırları vermiyor'); shares are rounded by largest remainder so they add up to 100.
- [x] **D33 · Blank first render (~1 s) on Kanalım and Radar.** Use the `kc-skel` skeleton everywhere.
  - **Done:** Kanalım shows its skeleton from the first frame; Niş Takibi and every discovery tab show one skeleton while loading.
- [x] **D34 · The popup demo uses port 47321** while the bridge scans 47811–47820 (`dev/popup-demo.html:39`).
  - **Done:** the popup demo's bridge uses port 47811.
- [x] **D35 · The monetized "checking" pill truncates** ("Reklam kontrol ediliyo…"). Shorten it to "Kontrol ediliyor…".
  - **Done:** 'Kontrol ediliyor…' / 'Checking…'.
- [x] **D36 · Lime crowds the Niş Takibi list:** seven lime badges with pixel shadows in "Bu hafta", five more in Hızlı yükselenler. Use the pixel shadow only for ≥3×, and a plain ink badge for 2–3×.
  - **Done:** 2–3× is a plain ink badge; lime with the pixel shadow (and the stair) only from 3×, also in Hızlı yükselenler.
