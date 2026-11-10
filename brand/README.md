# OpenOutlier brand (v2, approved 2026-11-09)

The source of truth for the OpenOutlier identity. Browsable brand guide (tokens, logos, rules): https://claude.ai/artifact/1HB3aY1QkH9PCFrsBXZaHU Approved step by step by the owner: palette → logo → typography → wordmark. `archive-v1/` holds the first (cobalt + saffron, box plot) direction, which is retired.

## Idea

OpenOutlier finds the posts that broke away from an account's normal performance. The logo's **Pixel O** is the "O" of Outlier drawn as an 8-bit pixel ring, with a **three-pixel lime trail** escaping from its top-right corner: the outlier. In the wordmark only the O of "Outlier" is pixelated; "Open" stays a soft, heavy serif. Classic letters with one pixel letter breaking away: the logo itself is an outlier.

Mood: electric blue ground, acid-lime accent, white pixel graphics, a chunky soft serif. Loud, playful, screen-native, data-literate.

## Colour

| Token | Hex | Role |
| --- | --- | --- |
| Signal Blue | `#1E3BFF` | The brand ground. Logos sit on it; big surfaces, headers, primary buttons. |
| Outlier Lime | `#C8FF2E` | Reserved for the outlier: the logo trail, outlier badges (×median ≥ 2), the one highlighted number, focus/selection accents on blue or ink. Never on light paper (1.1:1). Text on lime is Ink. |
| Paper | `#F6F7F2` | Light ground and text on blue (6.2:1). |
| Ink | `#0B0E1A` | Text on paper (17.9:1) and lime (16.3:1); the dark-mode ground. |
| Haze | `#8FA0FF` | Decorative pixels on blue only (2.8:1, never text). |

Measured contrast: Paper on Blue 6.24 · Lime on Blue 5.70 · Ink on Lime 16.30 · Blue on Paper 6.24 · Blue on white 6.72 · Ink on Paper 17.86 · Lime on Ink 16.30 · Blue on Ink 2.86 (fails: on dark grounds use a lighter blue such as `#6B80FF` for text/links, and check it).

## Typography (Google Fonts, OFL)

- **Display:** Fraunces, weight 900 (Black), optical size ~48 (`font-optical-sizing: auto` at headline sizes). Wordmark, page titles, big numbers in hero moments.
- **Body / UI / numbers:** Inter Tight 400–600. Use `font-variant-numeric: tabular-nums` for every number column. Uppercase labels with ~0.06em tracking.
- Two families only.

## Logo files (`v2/`)

| File | Use |
| --- | --- |
| `wordmark/openoutlier-stacked-trail3.svg` (+ `.png`) | **Primary logo**, on Signal Blue (background baked in). "Open" above, "Outlier" indented below. |
| `wordmark/openoutlier-inline-trail3.svg` | Secondary, single line, on Signal Blue: headers, narrow spaces. |
| `wordmark/openoutlier-stacked-trail3-transparent.svg`, `openoutlier-inline-trail3-transparent.svg` | Same with no background: place on Signal Blue or Ink only (text is Paper). |
| `mark/openoutlier-mark.svg` (+ `-2048.png`) | The Pixel O with its trail, for blue grounds (its counter is filled blue). |
| `mark/openoutlier-mark-on-ink.svg` | Same for Ink grounds (counter filled ink). |
| `mark/openoutlier-mark-blue-single-color.svg` | One colour, Signal Blue, for light grounds and one-colour print. |
| `icon/openoutlier-icon.svg`, `icon128.png`, `icon48.png`, `icon512.png` | App/extension icon: the mark on a Signal Blue tile (rx 28/128). |
| `icon/openoutlier-icon-16.svg`, `icon16.png`, `icon32.png` | Hand-pixelled 16×16 version (pixel-perfect at 16 and 32 px). Use these for toolbar sizes, never the scaled 128. |

Rules: the colour logo only on Signal Blue or Ink. On a light surface use the blue tile (icon), a blue band, or the single-colour blue mark. Never recolour the lime trail, never put lime on light paper, never move or resize the trail separately from the O. Generators: `tools/wordmarks.mjs` (`MARK_VARIANT=trail3`, `TRANSPARENT=1`), `tools/lockup.mjs`; the approved state lives in `brandkit/state.json` (Higgsfield brand kit).

## Pixel language

Graphics are built from square pixels on one grid (the mark's unit): pixel staircases rising up-right (the trail), single lime pixels as highlights, white/haze pixel clusters on blue. No platform logos, no running figures or cursors (those belong to other brands), no gradients, no glassmorphism.

## Voice

Plain, specific, numerate: lead with the number ("9.0× this account's median"), say what to do next. No hype, no "AI-powered", no exclamation marks.
