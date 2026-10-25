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

7. **Apple audit pass** (Ahmad's second message, 19:21Z: audit and design like an Apple designer, research open tools and
   skills). Checked against Apple's Liquid Glass overview (hierarchy, harmony, consistency; glass for the control layer,
   content stays opaque; colour in controls used sparingly) and the text rules of Vercel's open Web Interface Guidelines.
   Findings fixed here:
   - `theme-color` and the PWA manifests still used the pre-ADR-101 `#f9fafb` / `#0d0f15`, so the phone status bar did not
     match the page (`#F5F5F7` light, `#000000` OLED dark). Fixed in the Ops Room, THE CHAIN, NABD (ar, en) and both manifests.
   - Scroll edge effect: on a laptop, cards now fade out under the sticky glass header instead of cutting against it (a fixed
     band inside the header's stacking context, no added width).
   - The Ops Room sets `-webkit-tap-highlight-color: transparent` on buttons and links, as NABD already did.
   Tools and skills looked at, none installed (AGENTS.md §1): the "HIG Compliance Auditor" skill (MIT, Markdown, but its
   install pipes a script into bash, so it needs a security review first) and Vercel's `web-design-guidelines` skill (fetches
   its rules from GitHub at run time; only the text rules were read). The repo's own `apple-liquid-glass-hig` and
   `supreme-software-ui-architect` skills already hold the rules that apply here.

8. **Agent threads on NABD** (Ahmad, 19:25Z: bring the agents-with-threads design into the site). The agents panel of
   `site-landing/index.html` and `en.html` opens with a figure, "How the agents connect": three columns (sources, the five
   agents, outputs) joined by Bézier threads. The links are declared in the page (`data-links="from>to:kind"`) and
   `site-landing/threads.js` only draws them, so the drawing shows no link the page does not state. Thread colours follow the
   Ops Room wiring (ADR-111): cyan reads data, indigo decides or proposes, green writes on paper, dashed purple informs only,
   dotted violet locked «قيد الموافقة». Each node's dot is its status (green live, blue design, orange gated, red closed).
   Hover, keyboard focus or a tap on a node, or hover on an agent card, lights its threads and dims the rest; a second tap
   clears it. On a phone (< 720 px) the nodes stack in one column and the threads become an arc diagram on the free side,
   taller arcs bulging further, so they stay apart. No network, no timers; it redraws on resize. Nothing reaches an exchange.

## Sources
- Apple, Liquid Glass technology overview, developer.apple.com/documentation/technologyoverviews/liquid-glass (read 2026-10-24).
- Vercel Labs, web-interface-guidelines `command.md` on GitHub (read 2026-10-24, text only).
- HIG Compliance Auditor skill page, om.bearblog.dev/skill (read 2026-10-24).
- Astronomical Almanac low-precision formulas for the Sun's position (as used by the US Naval Observatory approximate solar
  coordinates).

## Consequences
- The laptop header is one row again from 1280 to 2560 px, and the phone header is 63 px shorter.
- The globe reads as a sphere in the sky and shows where it is night now; nothing about it is a forecast or a live feed.
- No data, rule, trading path or lock changed. Real trading stays locked (ADR-119).
- NABD gains the agent threads figure; THE CHAIN and NABD get the corrected status bar colour. ORACLE, TRADE LAB, core and second brain are unchanged.
- The CSP hashes of the Ops Room are re-pinned.
