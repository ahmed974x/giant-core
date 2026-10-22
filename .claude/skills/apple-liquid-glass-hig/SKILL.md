---
name: apple-liquid-glass-hig
description: Use when adding or restyling glass chrome, popovers, cards, rings or charts on an OMEGA page (Ops Room, THE CHAIN, NABD). Turns Apple HIG glass and material rules into the OMEGA tokens, CSP limits and the three-size check.
---

# Apple glass on OMEGA pages

`DESIGN.md` is binding and wins over this file. This skill is the working checklist for glass and material, written for this repo (ADR-087, ADR-101, ADR-105, ADR-107, ADR-108). It holds no third-party code.

## 1. Where glass is allowed

| Place | Recipe | Fallback |
|---|---|---|
| Fixed or sticky chrome (header, status island, segmented control) | `background: var(--glass)` + `backdrop-filter: blur(32px) saturate(190%)` | opaque `--surface` outside `@supports (backdrop-filter: blur(1px))` |
| Phone dock (ADR-092) | `blur(40px) saturate(200%)` | same |
| Map overlays and OSIRIS popovers (ADR-105) | `blur(30px) saturate(190%)`, 0.5px border, one specular top line | opaque `--surface` |
| Wallet cards `.glass` inside `.wallet` | as chrome | opaque `--surface-2` |
| Brain 2 causal card `.bw-card` (ADR-108) | as chrome, over the canvas | opaque `--surface` |

Nowhere else. Glass on a scrolling body card is a defect: use `--surface` with the 1px hairline and `--shadow-soft`.

## 2. Material rules

1. Write the opaque fallback first, then the glass inside `@supports`. Check the page with blur disabled; text must still pass.
2. Text on glass uses the gated tokens (`--content-primary`, `--content-secondary`, `--accent`, status tokens). The vivid `--apple-*` colours are for strokes, fills, rings and map points only.
3. Contrast is measured against the opaque fallback and against the darkest and lightest thing that can sit behind the glass. Gate: `node audits/verify-contrast.mjs <file>` must print "All pairs pass".
4. One accent per surface. Status colours mean status (green live, amber checking or [INFERENCE], red failed, violet locked «قيد الموافقة»).
5. Shadows are tinted with `--shadow-color` below 0.1 alpha. The ring leading cap (0.28) is the one exception.
6. Radii are concentric: outer = inner + padding (Ops Room card 28 = 8 + 20, switcher 24 = 16 + 8, Brain 2 stage 20 inside a 28 card with 8 padding).

## 3. Motion

- `transform` and `opacity` only, listed explicitly, `--ease-apple-fluid` or the `linear()` spring inside `@supports`.
- Press feedback `scale(0.96–0.98)`. A popover enters with opacity plus a 4–8px translate.
- `prefers-reduced-motion: reduce` turns all of it off; state changes must still be visible (highlight instead of motion).
- Canvases redraw on demand and pause under `IntersectionObserver` and `visibilitychange`.

## 4. CSP and code limits

- No `style=""` attributes and no `setAttribute("style")`; set `el.style.transform` or toggle a class.
- After editing any inline `<style>` or `<script>`: `node scripts/skillspector-audit.mjs --fix <file>` re-pins the sha256 hashes, then `--strict` must exit 0.
- Text goes in with `textContent`. Icon-only buttons carry `aria-label`.

## 5. Layout checks

- `100dvh`, safe-area insets, no horizontal page scroll at any width; wide tables scroll inside `.table-scroll`.
- Canvases with labels: on a phone, check that no label sits on a node or runs off the canvas (Brain 2 switches to an upright ellipse with labels above and below).
- Run `node scripts/ui-three-sizes.mjs <url>` (390×844 @3x, 1440×900, 2560×1080, light and dark), then open the screenshots and fix the three biggest problems.

## 6. Done means

Contrast gate passes, SkillSpector strict exits 0, three sizes are clean, reduced motion was checked, and every glass surface has its opaque fallback.

## Sources

Apple Human Interface Guidelines, "Materials" and "Color" (read on developer.apple.com, text only), distilled into the OMEGA tokens already in `site-landing/style.css`. No Apple assets or code are used.
