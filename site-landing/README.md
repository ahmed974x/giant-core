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

## The chain section (ADR-088)

`#chain` presents the three finance research agents (Market Researcher, Institutional Model Builder, Earnings Reviewer) and the per-ticker notes.md, as built in `omega-ops-room-v1/the-chain.html`. The investors section adds a copy-trading portal card marked «قيد الموافقة» / "Pending approval" next to the closed profit-split card. Both pages now have a skip link.

## Profit-split calculator (ADR-089)

`#calc` on both pages: enter an investment, fee rate, hurdle and period returns; `calc.js` works out net value, net profit, the performance fee, value before fees, the high-water mark, protected periods, a growth chart and a per-period table. Browser-only math that sends and stores nothing; the page says no money is accepted. The copy-trading card still reads «قيد الموافقة». Both pages carry a strict CSP (`script-src 'self'` + sha256 hashes); run `node scripts/skillspector-audit.mjs --fix site-landing` after editing an inline script.
