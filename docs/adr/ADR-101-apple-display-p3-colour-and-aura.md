# ADR-101: Apple Display-P3 colour system and the ambient market aura

Date: 2026-10-21 · Status: Accepted (Ahmad's Phase 9 directive, 2026-10-21)

## Context
ADR-087 set a cool-grey OKLCH palette ("Pure Daylight" with a blue-grey dark). Ahmad asked for Apple's own system palette on every page: Daylight Ceramic (`#F5F5F7` page, white cards, 0.82 glass with `blur(32px) saturate(190%)`, 7% hairlines, a soft `0 10px 30px -5px` shadow) and OLED Pro Dark (`#000000` page, `#1C1C1E` / `#2C2C2E` cards, 12% white hairlines), with Apple's semantic green, red, blue, indigo, purple and orange. He also asked for a soft ambient light behind the decision card that follows the market state.

## Decision
- The token system stays OKLCH and stays gated (`audits/verify-contrast.mjs`: WCAG ≥ 4.5 and APCA Lc ≥ 60 for every text pair in light, dark and both P3 variants). The new values are the OKLCH equivalents of Apple's colours, applied to the same tokens in `site-landing/style.css`, `the-chain.html` and `omega-ops-room.html`.
- Apple's vivid system colours fail the text gate on light backgrounds: #34C759 on white is 2.2:1 and #007AFF is 4.0:1. So there are two layers:
  - **Text tokens** (`--accent`, `--success`, `--danger`, `--warning`, `--gold`, `--violet`) keep each Apple hue and take the lightness that passes the gate, like Apple's own "increase contrast" variants. They get more chroma under `@media (color-gamut: p3)`.
  - **Mark tokens** `--apple-green / -red / -blue / -indigo / -purple / -orange / -cyan` hold the exact system colours (light and dark sets, more chroma under P3). They are used for strokes, fills, rings, chart areas and map points, which carry no text.
- Fills: `--accent-fill` is #0071E3 with white text (4.7:1, Lc 75). `--danger-fill` is #D70015 with white text. The dark fills are the dark text colours with black text.
- Glass moves to `blur(32px) saturate(190%)` at 0.82 alpha. Cards get `--shadow-soft`, tinted by `--shadow-color`, over the hairline.
- DESIGN.md now allows pure black only as the OLED dark page background, as Ahmad specified.
- **Aura**: the Signal cockpit card holds four stacked single-hue radial glows at 18–20%. One shows at a time by opacity (900 ms, `--ease-apple-fluid`, off under reduced motion): green for a BUY signal, cyan while watching, orange for a whale-trap warning or PWSI ≥ 40, red for SELL or PWSI at the breaker limit. It is decorative (`aria-hidden`), because the signal label already says the same thing in words.

## Consequences
- All three surfaces share Apple's look in both themes, and every text pair still passes the gate. The weakest pairs are `--accent` on `--surface-2` in light (WCAG 4.57, Lc 64.7) and `--danger` on `--surface-2` in dark (WCAG 7.22, Lc 60.5).
- New marks must use `--apple-*`, and new text must use the gated tokens.
