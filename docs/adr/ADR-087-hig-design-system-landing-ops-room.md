# ADR-087: Apple HIG design system for site-landing and Ops Room v2

Date: 2026-10-18 · Status: Accepted (approved by Ahmad 2026-10-18)

## Context
The HIG audit (`audits/HIG-AUDIT-site-landing-ops-room.md`) found sRGB-only colors, no light theme, subtext failing APCA,
fixed px type down to 10px, `100vh`, non-concentric radii and unused glass blur. Ahmad approved the report and three decisions:
white theme first with dark as a toggle, concentric symmetric radii, Cairo plus monospace tabular numbers.

## Decision
- One OKLCH token set shared by both pages, P3 chroma under `@media (color-gamut: p3)` at the same lightness.
- `--content-tertiary` = oklch(54% 0.039 268) light, oklch(78% 0.039 268) dark. 56.9% from the audit fails on the light
  grey surface (4.40:1), so the gate lowered it. `audits/verify-contrast.mjs` checks every pair (WCAG >= 4.5, APCA Lc >= 60).
- `--ease-apple-fluid` (lowercase) plus a damped spring sampled into `linear()`; only transform and opacity animate.
- Ops Room v2: Canvas 2D globe (no library, so double-click still works), real Binance candles, two-method VaR check,
  cross-source price check, TfL open cameras, self-healing feed scheduler, five-agent status display.
- The execution agent, public copy-trading vaults and profit sharing stay display-only, marked locked or closed.
  They need a separate explicit approval and, for investor money, a legal review.

## Consequences
Pages remain static and keyless. Fonts are vendored (SIL OFL 1.1). Kelly sizing and image analysis (OpenCV/YOLO) are named
but not built; the pages say so.
