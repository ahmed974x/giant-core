# ADR-124: Back to the Phase 9 Apple header, and a globe with a sky and a night side

Date: 2026-10-24 · Status: Proposed (PR waits for Ahmad's go to merge).

## Context
Ahmad asked to bring the site back to the earlier look, the one from the Apple HIG audit and Phase 9 (ADR-087, ADR-100 to
ADR-102), including the earth globe, and then to tune it further. The current main (after #40 to #43) was loaded headless at
390 × 844 and 1440 × 900 in light and dark and compared with the Phase 9 screenshots (`phase9/laptop-command-light.png`,
`phase9/colors-oled-dark-desk.png`, `phase9/iphone-osiris-light.png`, `phase9/map-1-globe-z2.6.png`). The palette, cards,
rings and type had not changed. What had drifted:

- The Ops Room header. In Phase 9 it was one glass pill: brand, the black status island, the status pill, the clock and the
  theme button. Since ADR-107 to ADR-119 added X-Ray, the self-test shield, the app grid and the language button, it wrapped
  to two rows on a laptop. On a phone it took four rows: brand, status, the buttons, then the island on two lines.
- The regime line (ADR-109) was a 2 px rule across the whole page under the header.
- OSIRIS on a phone: the camera rail (plus, slider, value, minus, 3D, reset; about 330 px tall) sat over the right third of
  the globe, and the globe was cut by it.
- Arabic subtitles under English card titles were pushed right by the width of the English title, and Arabic section
  subtitles kept a 12 px left margin when they wrapped to their own line.

## Decision
Ops Room only (`omega-ops-room-v1/omega-ops-room.html`):

1. **Header.** The icon buttons sit in one `.tools` group (a `--surface-2` pill, buttons without their own borders); the app
   grid and language buttons, which scripts insert next to the theme button, land in the same group. At ≥ 1280 px the bar
   does not wrap: brand, island, status pill, clock, tools on one row. Between 1280 and 1679 px the Arabic brand line and the
   Arabic status word are hidden and the island chips are tighter; at ≥ 1680 px everything shows. At ≤ 640 px the bar is a
   grid of three short rows: brand with the status dot and source count (the status words stay for screen readers), the island
   as one line that scrolls sideways and fades at the end, and the tools spread across the width. In Arabic-only mode (`data-lang="ar"`)
   the Arabic brand always shows, since it is then the only brand text. Measured bar height: 50 px
   from 1280 to 2560 px and 142 px at 390 px wide (before: 94 px and 205 px).
2. **Island in dark mode** uses `--surface-2` with `--content-primary` text and a hairline, like an OLED Dynamic Island, instead
   of an inverted white pill. Light mode keeps the black island.
3. **Regime line** is an inset 2 px line inside the bottom of the glass bar (`--regime-line`), following its curve. Calm green,
   hunt cyan and shield red are unchanged.
4. **Globe.** In globe mode the map draws an atmosphere halo around the sphere and shades the night side. The subsolar point is
   computed from the clock with the Astronomical Almanac's low-precision solar formulas (about 0.01°); the night tint fades in
   between +6° and −6° of sun height. The credits line says "Night side: sun position from the clock". Colours are tokens:
   `--os-night`, `--os-atmo`, `--os-atmo-mid`, `--os-atmo-0` for light and dark. The flat map is unchanged.
5. **OSIRIS on a phone** (≤ 599 px): the map is 560 px high, the camera rail keeps plus, minus, 3D and reset (44 px targets)
   and drops the slider and its value, so it is about 190 px tall and starts under the fly-to chips; the fit zoom leaves room
   beside it (0.40 of the short side instead of 0.46). The style switch sits above the credits line.
6. **Arabic alignment.** `.card-title .ar` uses `text-align: match-parent`, so it starts under the English title.
   `.section-title h2` is a wrapping flex row with a 12 px column gap instead of a left margin on the Arabic part.

## Consequences
- The laptop header is one row again from 1280 to 2560 px, and the phone header is 63 px shorter.
- The globe reads as a sphere in the sky and shows where it is night now; nothing about it is a forecast or a live feed.
- No data, rule, trading path or lock changed. Real trading stays locked (ADR-119).
- Other pages (ORACLE, TRADE LAB, core, second brain, THE CHAIN, NABD) are unchanged.
- The CSP hashes of the Ops Room are re-pinned.
