# site-landing (draft)

Static NABD landing page, Arabic (`index.html`, RTL) and English (`en.html`), one shared `style.css`.
Plain HTML + CSS, no framework, no external requests; works on GitHub Pages as-is.
**Draft only (ADR-071): not published, GitHub Pages not enabled, no form embedded, no money accepted.**

Preview locally: `python -m http.server 8000 -d site-landing` then open http://127.0.0.1:8000.

## Design system (ADR-087, from audits/HIG-AUDIT-site-landing-ops-room.md)

- Colors are OKLCH tokens in `:root`. Light "Pure Daylight" is the default; dark is a toggle (moon button), remembered per browser.
- Wide-gamut screens get more chroma through `@media (color-gamut: p3)`, same lightness, so contrast does not change.
- Contrast gate: `node audits/verify-contrast.mjs site-landing/style.css` (needs `npm i culori@4.0.1 apca-w3@0.1.9`). Every text/background pair passes WCAG >= 4.5:1 and APCA Lc >= 60 in light, dark and both P3 variants. `--content-tertiary` is oklch(54%) light and oklch(78%) dark.
- Fonts are local in `fonts/` (SIL OFL 1.1): Cairo for Arabic, system font (SF Pro on Apple) for English, `ui-monospace` / SF Mono with JetBrains Mono fallback for every number, with `tabular-nums`.
- Concentric radii: panel 40 = card 32 + padding 8; card 32 = icon 12 + padding 20. Spacing on a 4/8 scale.
- Motion: `--ease-apple-fluid` and a damped spring in `linear()`; only transform and opacity animate; `prefers-reduced-motion` turns it all off.
- `viewport-fit=cover` with `env(safe-area-inset-*)`, `100dvh`.

## Gated items (shown on the page as locked, never active)

Execution agent (real trading), public copy-trading vaults and profit sharing, the waitlist form, the domain and the final legal wording. Each needs explicit approval and, for investor money, a legal review first.
