# Measurements: Jarvis

Final values (ADR-133). Each value names where it comes from. Five sources:

- **[font]** read from the vendored font files with `node jarvis/scripts/font-metrics.mjs jarvis/fonts/*.woff2`.
- **[gate]** set or moved until `contrast.py --apca 60` and `audits/verify-contrast.mjs` pass (WCAG ≥ 4.5:1 and APCA Lc ≥ 60 on every text pair).
- **[DESIGN]** a rule in `DESIGN.md`.
- **[brief]** Ahmad's request: dark first, high contrast, electric-blue accent, Liquid Glass, spring motion.
- **[pattern]** the dashboard layout pattern in `recon.md`.

No reference screenshots of another product were measured. `replica/screens/` stays empty.

## Fonts [font]

| face | file | licence | UPM | ascent | descent | natural line | cap height | x-height |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Inter Variable (wght 100–900) | `jarvis/fonts/inter-latin-wght-normal.woff2` (48.3 KB) | OFL 1.1 | 2048 | 0.969 | 0.241 | 1.210 | 0.728 | 0.546 |
| Geist Mono Variable (wght 100–900) | `jarvis/fonts/geist-mono-latin-wght-normal.woff2` (23.1 KB) | OFL 1.1 | 1000 | 1.005 | 0.295 | 1.300 | 0.710 | 0.530 |
| Readex Pro Variable, Arabic (wght 160–700) | `jarvis/fonts/readex-pro-arabic-wght-normal.woff2` (22.9 KB) | OFL 1.1 | 1000 | 1.000 | 0.250 | 1.250 | 0.700 | 0.525 |

All three come from Fontsource 5.3.0 (`@fontsource-variable/*`, published 2026-07-19). The packages were downloaded with `npm pack`, so no install scripts ran. Each licence is beside the font as `OFL-*.txt`.

- **Arabic face.** Readex Pro, not IBM Plex Sans Arabic. Readex is one variable file; Plex Arabic ships one static file per weight.
- **Mixing.** Inter and Readex have nearly the same x-height (0.546 and 0.525), so mixed Arabic/English lines sit on one optical size without `size-adjust`.
- **Fallback.** `Inter Fallback` maps Arial, Helvetica Neue, Liberation Sans or Roboto onto Inter's measured ascent (96.9%) and descent (24.1%). If the embedded face fails, line boxes do not move.

## Type scale

| step | Latin size / line | Arabic size / line (`:lang(ar)`) | weight | source |
| --- | --- | --- | --- | --- |
| caption | 12 / 16 | 12 / 20 | 500 | [DESIGN] nothing below 12px |
| sm | 13 / 20 | 13 / 22 | 400 | [DESIGN] footnote 13 |
| base | 15 / 22 | 15 / 26 | 400 | [DESIGN] body 15 |
| headline | 17 / 24 | 17 / 28 | 600 | [DESIGN] headline 17 |
| title | 22 / 28 | 22 / 34 | 650 | [DESIGN] title clamp range 20–24 |
| display | 32 / 38 | 32 / 46 | 700 | [DESIGN] large clamp range 28–40 |

How the line heights were set [font]:

- **Latin.** Lines are 1.19–1.47 × size. That is at least Inter's natural line (1.21) for text steps, and slightly under it for display, where there is one line and no descender clash.
- **Arabic.** Lines are 1.44–1.73 × size. Readex's natural line is 1.25em, but Arabic marks (harakat) sit above the ascender and below the descender, so body text gets about 0.45em more.
- **Letter-spacing.** Arabic keeps 0 [DESIGN §2].

## Colour roles [gate] [brief] [DESIGN]

| role | dark (default) | light (toggle) | note |
| --- | --- | --- | --- |
| bg | `#090b10` | `#f4f6f9` | near-black with a blue cast; pure black is reserved for OMEGA's OLED theme |
| surface | `#10141b` | `#ffffff` | sidebar, cards |
| surface-raised | `#161b24` | `#ffffff` | popovers, dialogs, hovered rows; also the solid glass fallback |
| surface-sunken | `#06080b` | `#eceff4` | inputs, logs, code, diffs |
| border | `#242b37` | `#dfe3ea` | decorative hairline |
| border-input | `#636d7e` | `#7d8696` | ≥ 3:1 on bg and surface (ui) |
| text | `#eef2f8` | `#0f131a` | |
| text-muted | `#b9c1cd` | `#454e5c` | |
| text-subtle | `#afb7c3` | `#535c6b` | raised until Lc ≥ 60 on raised surfaces; hierarchy comes from size and weight |
| accent | `#77bcff` | `#0b5ed7` | electric blue, the one accent |
| accent-hover | `#9ccfff` | `#094fb6` | |
| on-accent | `#04101f` | `#ffffff` | |
| focus | `#8cc6ff` | `#0b5ed7` | 2px ring, 2px offset |
| danger / on-danger | `#ff9a9a` / `#1d0404` | `#b42323` / `#ffffff` | status only |
| success | `#4fdba0` | `#116a43` | status only |
| warning | `#f7c066` | `#8a4f00` | status only |
| info | `#6cc8ff` | `#0b5ed7` | status only |
| approval | `#c2adff` | `#6234c4` | violet, only for «awaiting approval» and locked cards |

The gate checks 118 pairs: 59 per theme, including every text colour on glass over bg, surface and surface-raised. All 118 pass.

## Liquid Glass [brief] [DESIGN]

| token | dark | light | use |
| --- | --- | --- | --- |
| glass | `#161b24` at 78% | `#ffffff` at 78% | tint of floating chrome |
| glass-rim | white at 14% | white at 70% | 1px **inset** highlight on the top edge (the refraction rim) |
| glass-edge | black at 40% | `#0f131a` at 12% | 1px outer hairline that separates glass from what is behind it |
| blur / saturate | 16px / 180% | same | `backdrop-filter: blur(16px) saturate(180%)` |

- **Where glass goes.** Only on sticky or floating chrome: top bar, sidebar, command palette, popovers, toasts [DESIGN §4]. Cards and table rows stay solid.
- **Reduced transparency.** `prefers-reduced-transparency: reduce` swaps glass for solid `surface-raised` with no blur.
- **No backdrop-filter support.** `@supports` keeps the solid tint.
- **No gradients.**

## Shape, space and motion

- **Spacing** [DESIGN §3]: base 4px; scale 0 4 8 12 16 20 24 32 48.
- **Radius**, concentric (outer = inner + padding) [DESIGN §3]: xs 6, sm 8, md 12, lg 20 = md 12 + 8, xl 28 = lg 20 + 8, pill 999.
- **Shadows** [DESIGN §1]: tinted, alpha ≤ 0.09.
- **Motion** [brief]:
  - Durations 120 / 200 / 420ms.
  - Easing `cubic-bezier(0.22, 1, 0.36, 1)`, a spring-like ease-out with no overshoot.
  - Animates `transform` and `opacity` only. All durations become 0 under `prefers-reduced-motion` [DESIGN §4].

## Layout [pattern] [DESIGN]

- **Sidebar:** 248px expanded; a 64px rail at 768–1279px; a drawer under 768px.
- **Rows:** top bar 56px, table rows 36px.
- **Width:** content max 1440px.
- **Touch:** targets ≥ 44px under `pointer: coarse` [DESIGN §5].
- **Direction:** logical properties only (`margin-inline`, `padding-inline`, `inset-inline`, `border-inline`, `text-align: start`). `dir="rtl"` mirrors the layout with no extra CSS. Numbers keep `direction: ltr; unicode-bidi: isolate`.
