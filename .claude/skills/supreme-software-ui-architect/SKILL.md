---
name: supreme-software-ui-architect
description: Use before building or reviewing any OMEGA page, canvas or data feature. Engineering and visual craft rules - 4/8 grid, concentric radii, glass only where allowed, P3 colour, zero clipped text, zero-jank workers and canvases, honest data paths and the checks that prove them.
---

# Software and interface architecture for OMEGA

Text rules only. `DESIGN.md` and `AGENTS.md` win where they say more. Distilled from this repository's own pages (ADR-087 to ADR-109).

## 1. Visual craft

- Space on the 4 / 8 scale (4, 8, 12, 16, 20, 24, 32, 48). Radii are concentric: outer = inner + padding (card 28 = 8 + 20).
- Colour is OKLCH tokens with a Display P3 variant under `@media (color-gamut: p3)`. One accent. Status colours mean status. Vivid `--apple-*` values are for strokes, fills and canvas marks, never text.
- Glass is `blur(32px) saturate(190%)` over `--glass` at 0.82 alpha, always with an opaque fallback outside `@supports`, and only on fixed or sticky chrome, map overlays, the Brain 2 causal card, the neural oscilloscope and X-Ray badges. Hairlines are 0.5 px with a specular top line.
- Zero clipped or overlapping text at 390×844 @3x, 1440×900 and 2560×1080, light and dark. Wrap long values with `overflow-wrap: anywhere`; numbers stay tabular, `direction: ltr`, `unicode-bidi: isolate`. Nothing below 12 px, also on canvas.
- Motion uses `transform` and `opacity`, `--ease-apple-fluid`, and stops under `prefers-reduced-motion`. Canvases animate only on events.

## 2. Zero-jank engineering

- Heavy maths runs in a Blob Web Worker on `Float64Array` buffers and posts results back; transfer buffers when the page does not need them again.
- Canvases size to `devicePixelRatio` (cap 3), draw on demand, batch strokes into `Path2D` groups, cache static layers offscreen, and pause under `IntersectionObserver` and `visibilitychange`.
- Telemetry is a bounded ring of 300. No `setInterval` faster than 1 s for rendering; requestAnimationFrame only while something moves.
- Measure, then print: a speed or accuracy on screen is a number this browser measured (`performance.now()`), with what was measured.

## 3. Honest data paths

- Every value names its source and tier (proxy, direct, snapshot) and time. A fallback names itself (`via`, `venue`) and never poses as the first source. A failing source shows as offline; nothing is filled in.
- Keyless public endpoints only. A different public endpoint as a fallback is fine; proxies or VPNs to get round a geo-block are not.
- Model outputs carry `[INFERENCE - Quant Model]`. Hypothetical numbers carry "مثال افتراضي".

## 4. Security and structure

- Strict CSP with sha256-pinned inline code; after any inline edit run `node scripts/skillspector-audit.mjs --fix <page>`. No `innerHTML` with data, no `style=""`, no inline handlers, no `eval`.
- New hosts go into the page's `connect-src` and the proxy's `ALLOWED_UPSTREAM` together. Shared maths lives once in `scripts/lib/` and is inlined by its build script, with a `--check` in CI.
- Every `<main>` child names its views with `data-view`; read-only probes (`OMEGA_PROBE`, `OMEGA_BRAIN2`, `OMEGA_NEURAL`) never move paper money or send anything.

## 5. Definition of done

`node scripts/test-brain2.mjs`, `node scripts/skillspector-audit.mjs --strict .`, `node audits/verify-contrast.mjs <page>`, `node --check` on changed scripts, `node scripts/ui-three-sizes.mjs <url>` (6 runs, 0 errors, 0 overflow) and the in-page self-test. Report each result as measured, including the ones that fail.
