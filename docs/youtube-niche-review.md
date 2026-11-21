# youtube-niche: final review findings (2026-11-21)

These findings come from two reviews of the merged phases 0–5 on `youtube-niche`, measured against `main`. Every item is to be fixed. When a fix is done, mark its checkbox and add a one-line note. If you deliberately don't fix one, say why.

Evidence screenshots for the UI items are in `/private/tmp/claude-501/-Users-eshagh-web-code-openoutlier/63c5f623-dd40-40ca-bcea-6c715447a635/scratchpad/ui-review/`. They may be gone after a reboot; the descriptions below stand on their own.

## A. Code review (correctness and efficiency)

- [ ] **A1 · `mcp/niche.mjs:210`: RSS writes ~30 unchanged rows per channel every 15 min.** `rssJob` inserts a `video_stats` row for every feed entry (15 long-form + 15 Shorts) on every run, even when nothing changed. Retention is off by the user's decision, so the table grows without limit: 16 channels × 30 × 96 ≈ 46k rows/day, ~17M a year. Fix: skip a row when views and likes equal the video's last stored reading. Optionally, for videos older than 30 days, keep at most one RSS reading per day. Add a migration (next number per the plan notes) that removes the existing consecutive duplicates, keeping the first reading of each run of equal values, so curves don't change.
- [ ] **A2 · `mcp/niche.mjs:466`: `checkBreakouts` reloads the whole niche model on every RSS job.** Every RSS job that sees a video younger than 30 h calls `loadModel(..., fresh: true)` for the entire niche, and a tick runs up to 25 RSS jobs. Fix: collect candidate video ids across the tick and run breakout checks once per niche after the loop (e.g. a post-tick hook in the tracker, or a cheap `breakouts` singleton job), or score only the affected videos against cached per-channel curves.
- [ ] **A3 · `mcp/niche.mjs:394`: the `loadModel` memo is invalidated by every insert.** The signature is COUNT(*) and MAX(ts) over all of `video_stats`: a full count on every call, and any write anywhere invalidates the memo, so `/youtube/cards` lookups (`mcp/cards.mjs:33`) rebuild the model while the user scrolls. Fix: keep a monotonic write counter in `meta`, bumped in `addVideoStats` and when `tracked_videos` changes, use it as the signature, and let read paths accept a time-based memo.
- [ ] **A4 · `rs:settings` read-modify-write races.** Several unsynchronized writers do get → modify → set on the whole `rs:settings` object:
  - `dashboard/settings-view.js:101` (`setSetting`)
  - `dashboard/niche-view.js:573` (`saveNiche`)
  - `dashboard/discovery-view.js:166` (`saveRadar`)
  - `popup/popup.js:111`
  - the content scripts

  `features.js` serializes only its own writes, and only within one JS context. Result: a toggle, an API key, radar keywords or niche settings can silently revert. Fix: put every `rs:settings` write behind one helper, e.g. `OpenOutlierFeatures.updateSettings(fn)` or a small `src/settings-store.js`. The helper serializes within the context and merges only the sub-key being changed against a fresh read. Better still, split independent sub-keys (`radar`, `niche`, `uiLang`, choices) into their own storage keys, so cross-context writes can't clobber each other. Migrate existing values.
- [ ] **A5 · `src/youtube-insights-bg.js:160`: a monetization queue key can stick in "checking".** `runQueue` has no per-job try/finally. If storage throws, `queued[job.key]` stays true, and the badge spins until the worker restarts. Fix: wrap each job in try/finally, delete the key, and keep draining.
- [ ] **A6 · `src/youtube-insights-bg.js:151`: the credentialed retry can cache a false "not monetized" for 7 days.** The retry with `credentials: 'include'` uses the user's session; with YouTube Premium the page has no ad config, so the result is "no". Fix: treat a credentialed result without `yt_ad` as `unknown`, or retry without cookies but with a consent cookie such as `SOCS`. Also keep the "unknown" cache TTL short.
- [ ] **A7 · `mcp/youtube-analytics.mjs`: a failed channel lookup can overwrite the legacy token.** When `myChannel` fails after sign-in, `writeToken` falls back to `youtube-token.json` and may overwrite another, not yet migrated channel's token. Fix: store it as `youtube-token-pending-<random>.json`, and adopt it on the next successful lookup (`listTokens` should include pending files). Add a test.

## B. UI review: must fix

- [ ] **B1 · Watch page at 390 px scrolls sideways, so the toolbar rides over the masthead.** The OO toolbar is inserted inside YouTube's like/share row (`#top-level-buttons-computed`). The row grows to 477 px on a 390 px viewport: Like wraps, and "İndir" and "…" are clipped. With the page wider than the viewport, the visual viewport scrolls and the sticky masthead slides away. Files: `src/overlay.js:317-321` (`pl.inline.insertBefore(host, pl.inline.firstChild)`) and `src/youtube-content.js:764` (`overlayPlacement`). Fix:
  - insert the toolbar as a sibling *before* the row, inside `#actions`, not inside it;
  - below ~600 px, collapse it to one "OO" button or the rail;
  - clamp the fixed stats card's `top` to the masthead's bottom.
- [ ] **B2 · The Library top nav strip at 390 px** scrolls sideways with no hint, and the current chip is off-screen (#/niche, #/swipe). File: `dashboard/dashboard.css:553-571`. Fix: `scrollIntoView({inline:'center', block:'nearest'})` on the `aria-current` chip after render, plus an edge fade (`mask-image`) and scroll-snap. Better: below 760 px, use a "Menü" drawer or a select.
- [ ] **B3 · Turkish uppercase is wrong because `<html lang>` stays "en".** CSS uppercase produces "BU HAFTAKI", "UZUN VIDEO", "SAATTEKI", "BAŞLIK KELIMELERI", "SPONSOR LINKI", "INDIRIM", "BENIM", "YENI", "NIŞ MEDYANI", "ÜCRETLI". Only the features list sets its own lang, which gives "SCRAPİNG" there. Files: `dashboard/dashboard.html:2`, `dev/dashboard-demo.html:2`, `dashboard/dashboard.js`. Fix:
  - on every render, set `document.documentElement.lang = OpenOutlierFeatures.uiLang()`;
  - set the same `lang` on the shadow hosts of the in-page cards;
  - make technical English terms immune: don't uppercase "SCRAPING" in TR, or keep the brand words in `lang="en"` spans.
- [ ] **B4 · Percent deltas on Kanalım use English order in TR.** Values read "%3,2" but deltas read "−13%", "+21%", "+0,8%". This shows on the KPI tiles, the chart headline ("önceki 28 güne göre −13%") and the change pills. A CTR delta is percentage points. File: `dashboard/youtube-channel-view.js:166` (`signedPct`). Fix: `Intl.NumberFormat(loc,{style:'percent',signDisplay:'exceptZero'})`, which gives "−%13" in TR. Rate deltas become "+0,8 puan" / "+0.8 pts".
- [ ] **B5 · No plurals in English counts.**
  - Seen: "last 1 weeks", "Last 1 weeks · 9 views" and "1 videos · 1 Shorts" (Kanalım, tiny channel).
  - The same pattern exists in `'{n} videos'`, `'{n} channels'`, `'{n} clips'`, `'{n} keywords'` and `'{n} days'`.
  - Files: `dashboard/youtube-channel-view.js:40,43,57`, `dashboard/niche-view.js:26-74`, `dashboard/discovery-view.js:32-61`, `dashboard/swipe-view.js:13`, `src/youtube-pages.js:29,50`.
  - Fix: one shared `plural(n, {one, other})` helper (`Intl.PluralRules`), with `_one` / `_other` strings for every count.
- [ ] **B6 · The Settings → "Outlier formülü" segmented control has no border or background.** `.ft-seg` / `.ft-seg-btn` use `--line-2`, `--card` and `--sunk`, which exist only in `panel.css` and `popup.css`, not in `dashboard.css`, so the unselected option reads as plain text. File: `dashboard/dashboard.css:542-547`. Fix: use dashboard tokens and the shared segmented style (see B15).
- [ ] **B7 · Shorts at 390 px: the floating OO panel button covers YouTube's Share and "…" buttons, and the stats card touches the player's top controls.** Files: `src/panel.js` (launcher position) and `src/youtube-content.js:768-772` (rail placement). Fix: on Shorts and at narrow widths, hide the floating button (the rail already opens the panel) or move it above the action column, and add an 8 px offset below the top controls.
- [ ] **B8 · On Shorts at desktop width (TR, 1280 px), the side-card hint is clipped mid-word:** "Yaş, toplam izlenme ve ülke için bir Y". `.sub{white-space:nowrap}` also hits the multi-line hint. File: `src/youtube-pages.js:124`. Fix: a `.hint{white-space:normal}` class.
- [ ] **B9 · The watch-page stats popover (the OO toolbar button) is all English in TR, and its open state persists.**
  - Strings: "Views", "Likes", "Collect this channel's Videos tab…", "Most replayed at", "Open the OpenOutlier panel", and the date "May 8, 2025".
  - Because `openKey` saves the open state, the popover reopens on every video and covers the inline watch card, which shows the same numbers.
  - Files: `src/overlay.js:280-290` and `src/youtube-content.js:776-787`.
  - Fix: localize it through the same TR/EN table, and don't persist the open state on YouTube. Better: on watch pages, drop the popover and make the button scroll to and highlight the inline card.
- [ ] **B10 · Niş Takibi at 390 px: the niche curve SVG is a fixed 460 px wide.** It scrolls inside its card, so "7 g / 14 g / 30 g" are cut off. File: `dashboard/niche-view.js`. Fix: a fluid SVG (`viewBox`, `width:100%`) and thinner axis labels below 480 px. Check the other charts too (Kanalım progress, channel growth sparklines, radar).

## C. UI review: should fix

- [ ] **C11 · Mixed TR/EN on TR screens.**
  - Library sidebar and top bar: "Mentions", "3 new", "My account", "All accounts", "Top posts", "Unsorted", "Compare platforms", "Folders", "Tags", "Back up", "Restore", "Search accounts" (`dashboard/dashboard.js:460-478`, `dashboard/dashboard.html:19`).
  - Panel tabs "Videos / Analytics / Export", plus "Auto-scroll" and "Clear" (`src/panel.js`).
  - Toolbar aria-labels: "Download video", "Show OpenOutlier stats", "Download cover image".
  - The popup is all English even with `?hl=tr` (`popup/popup.js`).
  - Thumbnail tester mock grid: "All", "Tutorials", "Recently uploaded"; the views default is "1.2K".

  Route all of these through `uiLang()`, since the Settings "Dil" card promises the language. At minimum, cover the Library chrome, the YouTube panel, the toolbar and the popup. Instagram/TikTok/Reddit-only panel text may stay English if it's large, but note it.
- [ ] **C12 · Lime is used outside its outlier role.** The brand reserves lime for outliers and the one key number. Fix each of these:

  | Where | File | Fix |
  |---|---|---|
  | Monetized pill "Para kazanıyor" (`.mon.yes` uses `--hot-*`) | `src/youtube-pages.js:130` | neutral outline pill with ✓ |
  | Keywords "sıralanıyorsun" rank badges | | `--accent-soft` |
  | Last Kanalım chart bar in dark mode (`.kc-bar.is-last`) | `dashboard/dashboard.css:1102` | `--s5` in both themes |
  | "YENİ" search-term tags and the "EN YAKIN" YPP tag | | non-lime |
  | Lime trail of the mini logo on light YouTube (`MARK`) | `src/youtube-pages.js:177`, `src/youtube-tools.js:176`, `src/youtube-cards.js:648` | one-colour blue mark on light grounds |
  | Count bubble `.n` on light YouTube | `src/youtube-cards.js:622` | non-lime |
- [ ] **C13 · Control borders fail contrast.** `--border-2 #BFC3B4` on white is 1.8:1; the brand's `line-strong #6E7590` (4.2:1) is meant for control borders. In dark mode, the off-switch track `#3A4570` on `#121729` is 1.9:1. Files: `dashboard/dashboard.css:9,47` and `.ft-switch span`. Fix: map control borders to `#6E7590` / `#6A7190`, and give the off switch an outline or a lighter track.
- [ ] **C14 · Two "Filtreler" buttons sit stacked on YouTube search** (YouTube's and ours). File: `src/youtube-cards.js` (feed bar). Rename ours "Outlier filtreleri" / "Outlier filters", or show only the OO mark plus a count of active filters.
- [ ] **C15 · Three segmented-control styles.**
  - `.seg`: outlined white active state (Niş Takibi Hepsi/Videolar/Shorts, Dil, Thumbnail tester, Swipe).
  - `.ft-seg-btn.is-on`: filled blue.
  - `.set-pill.is-on` and `.chip.sw-tag.is-on`: filled ink or blue.

  Pick one (`.seg` with `aria-pressed`) and remove the rest.
- [ ] **C16 · Badge clutter on video cards.**
  - Up to three badges ("72 sa: 3,4×", "654/sa", "3,4 B abone") cover ~80% of a 4-column home thumbnail and sit over the thumbnail text.
  - On a channel page every card repeats the channel's own subscriber count.
  - The blue velocity badge looks foreign on YouTube.

  File: `src/youtube-cards.js:323-334`. Fix: hide `oo-subs` on the channel's own page and move subs to the meta row instead of the thumbnail; at most 2 badges by default; velocity in the same dark style as the others.
- [ ] **C17 · The channel card is too heavy.** Stats, a no-key notice, sponsors and six "Benzer kanallar" rows push the Videos tabs below the fold at 390 px and to mid-screen at 1280 px, and the floating OO button covers "Kanal haritası →". Files: `src/youtube-pages.js` and `src/youtube-similar.js`. Fix: make the card collapsible (remember the state), show three similar channels plus "+3", and drop "(popup)" from the hint.
- [ ] **C18 · Two OO toolbars on the watch page, plus a tall card above the description.**
  - The icon toolbar sits in the like row, and a second row (Transcript / Yorumlar / Kaydet) sits under the card.
  - The "Outlier –" cell shows a long hint instead of a value.

  Files: `src/youtube-tools.js` and `src/youtube-pages.js`. Fix: merge them into one toolbar, show a single "Anahtar ekle" link when there is no value, and consider placing the card after the description.
- [ ] **C19 · The Niş Takibi header changes between tabs.**
  - Takip has "Excel · 16 kanal · az önce güncellendi" plus Kanallar / Yenile; Radar, Map and Keywords show only "Excel".
  - The "Benzer thumbnail'ler" sub-view highlights no tab, has no back link, and shows "Yükleniyor…" twice.

  File: `dashboard/discovery-view.js`. Fix: one shared header, "← Takip" on the thumbs view, and one skeleton.
- [ ] **C20 · Turkish grammar and typos.**
  - `niche-view.js:87-88`: "%60'ini" / "%83'ini" are wrong (should be "%60'ını" / "%83'ünü"). Reword to "…30 günlük izlenmesinin %60'ı ilk 48 saatte gelir".
  - `niche-view.js:92`: "takipçinin genç yakaladığı videolardan" → "takibin ilk saatlerinde yakaladığı videolardan".
  - The niche empty state "Eğriler, ilk yeni yüklemeler ilk saatlerinden itibaren takip edilince oluşur" is garbled; rewrite it.
  - `settings-view.js:65`: "anahtar" is used for both the switch and the key → "özelliği açılıp … API anahtarı eklenmeden".
  - Kanalım: "günde 9" is missing its unit (izlenme); "Bu hızla olmuyor" → "Bu hızla 90 günde yetişmiyor".
- [ ] **C21 · Unclear labels.**
  - "TO" for CTR → "Tıklama oranı" / "Gösterim TO".
  - Radar "Pazar" vs Keywords "Ülke" for the same field → "Ülke / dil" in both.
  - "abone b." → "abone başına".
  - "sıralanıyorsun · 77" → "77. sıradasın" (or whatever the number really is; check it).
  - Jargon to remove: "hl=en gl=US", "64 bitlik perceptual hash", "2 bit fark".
  - Raw duration bucket keys "<5m", "5–10m" (`src/velocity.js:372-378`) → localize to "<5 dk".
  - `src/features.js:89,106,109`: "Monetized rozeti" → "Para kazanma rozeti", "Transcript araçları" → "Transkript araçları".
  - Hour abbreviation: "24 s:" vs "24 sa" → use "sa" everywhere.
- [ ] **C22 · Kanalım YPP card repeats itself and is easy to misread.**
  - "Bu hızla: ~2 ay (Oca 2027)" appears twice; "Bu hızla abone: ~2 ay" uses a different format.
  - Milestone "4.000 saat izlenme ✓" sits next to YPP "3.625 / 4.000" (lifetime vs 365 days).
  - "1.000 izlenmeli ilk video 0 / 1.000" on a channel with 420K views looks like a bug.

  File: `dashboard/youtube-channel-view.js:640-700`. Fix: one ETA line in one format, "toplam" wording in milestones, and make the first-1K-video milestone check all videos (fix it in `src/own-metrics.js` / `mcp/own-history.mjs` if that's where it's computed).
- [ ] **C23 · Niş Takibi order at narrow widths, and confusing duplicate rows.**
  - Below 1180 px, "Hızlı yükselenler" and "Benim videolarım ve niş" drop to the very end. Move them right after the KPI strip with CSS `order`.
  - The same video shows "8,5× · 14 saat önce" in Bu hafta and "9,3× · 7 saat önce" in Hızlı yükselenler. Label the alert row "uyarı 7 sa önce · 6. saatte 9,3×".

  Files: `dashboard/niche-view.js` and `dashboard/dashboard.css:596-600`.
- [ ] **C24 · Settings → Features repeats the same warning about 7 times** ("Bridge'de API anahtarı yok · Anahtar ekle"), and "İsteğe bağlı servisler" appears twice. Fix: one banner per group ("5 özellik bridge'de API anahtarı bekliyor → Ekle") and provider keys inline under each switch. File: `src/features-view.js`.
- [ ] **C25 · The Shorts stats card shows empty dashes** ("Kanal yaşı –", "Ort. Shorts izlenmesi –"). Hide cells that have no data and add one "API anahtarıyla daha fazlası" line. File: `src/youtube-pages.js`.

## D. UI review: nice to have (fix these too)

- [ ] **D26 · Radii drift:** the brand uses 0 px for pixel badges and 8 px for buttons, inputs and cards, but the new CSS uses 1/2/3/4/5/6/8/12/18/22. Add `--r-pixel` / `--r-md` tokens and use them in the new CSS.
- [ ] **D27 · Breakpoints vary** (760/900/1000/1100/1180/1500/1560). Settle on ~3 shared ones in the new CSS.
- [ ] **D28 · Kanalım and My account use the same user icon in the sidebar** (`dashboard/dashboard.js:461-462`). Give Kanalım a play/channel glyph.
- [ ] **D29 · Radar's "15× abone b." looks identical to the outlier "×median" badge.** Put the unit inside the badge or use a different style.
- [ ] **D30 · Red/green deltas** (Kanalım ▲▼, Keywords "↑ 2,6×", title history "1 B") vs the brand's single-hue charts. Use ink text with the arrow.
- [ ] **D31 · Tap targets at 390 px:** feature switches are 36×21, the radar chip "×" is 22×22, toolbar buttons are 34×30. Give them a ≥32–44 px hit area.
- [ ] **D32 · Neighbouring cards show different totals** (traffic 770 vs geography 639 vs devices 753). Add a "(YouTube rapor eşiği)" note. Subscribed/not subscribed sums to 101%: round so it sums to 100.
- [ ] **D33 · Blank first render (~1 s) on Kanalım and Radar.** Use the `kc-skel` skeleton everywhere.
- [ ] **D34 · The popup demo uses port 47321** while the bridge scans 47811–47820 (`dev/popup-demo.html:39`).
- [ ] **D35 · The monetized "checking" pill truncates** ("Reklam kontrol ediliyo…"). Shorten it to "Kontrol ediliyor…".
- [ ] **D36 · Lime crowds the Niş Takibi list:** seven lime badges with pixel shadows in "Bu hafta", five more in Hızlı yükselenler. Use the pixel shadow only for ≥3×, and a plain ink badge for 2–3×.
