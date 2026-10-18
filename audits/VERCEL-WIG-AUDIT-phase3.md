# Vercel Web Interface Guidelines audit · Phase 3 (2026-10-18)

Rules: `vercel-labs/web-interface-guidelines` `command.md` at commit `434b7f9` (copy in `.claude/skills/omega-design/references/`).
Browser check: `scripts/ui-three-sizes.mjs` at 390×844 @3x, 1440×900 and 2560×1080, light and dark.
Contrast gate: `audits/verify-contrast.mjs`, all pairs WCAG ≥ 4.5 and APCA Lc ≥ 60.

## Results

| File | Three sizes × 2 themes | Console / page errors | Horizontal overflow | Contrast gate |
|---|---|---|---|---|
| `site-landing/index.html` | 6 / 6 pass | 0 | 0px | pass |
| `site-landing/en.html` | 6 / 6 pass | 0 | 0px | pass |
| `omega-ops-room-v1/the-chain.html` | 6 / 6 pass | 0 | 0px | pass (weakest light-P3 success on surface-2: 4.56 / Lc 64.9) |
| `omega-ops-room-v1/omega-ops-room.html` | 6 / 6 pass with `ALLOW_NET_ERRORS=1` | only blocked Binance / Open-Meteo / local n8n requests in the cloud sandbox | 0px | pass |

THE CHAIN functional run (GDELT mocked in the sandbox only, because the cloud proxy blocks api.gdeltproject.org): 3 news items classified, analyst range 39.50 to 48.00, bull/bear suggestions, wording shift, 25-cell sensitivity matrix centred on the DCF value, top 3 assumptions with ±30% break levels, top 3 risks, CSV (64 lines) and Excel export, earnings Q&A verdicts, thesis test with exact quotes, notes.md append from all three agents, review diff, and `?t=ACMO#model` deep link restoring the panel.

## Findings fixed in this pass

```
site-landing/index.html:16 - no skip link → added "تخطَّ إلى المحتوى" + main#main
site-landing/en.html:15 - no skip link → added "Skip to content" + main#main
site-landing/style.css:165 - headings without text-wrap: balance → added (p, li: pretty)
site-landing/style.css:165 - no touch-action / tap highlight → added on a, button
site-landing/style.css:165 - page rubber-band on fine pointers → overscroll-behavior: none in @media (pointer: fine)
the-chain.html - mixed Arabic/English lines in notes.md editor rendered out of order → unicode-bidi: plaintext
the-chain.html - SVG range chart labels flipped in RTL → svg direction="ltr", max-width 760px
the-chain.html - date range KPI bidi garbled → <bdi> per date
the-chain.html - #model deep link lost after load → panel chosen from hash before first render, hashchange listener
```

## Checked and passing

- Icon-only buttons (`themeToggle`) have `aria-label`; decorative SVG has `aria-hidden="true"`.
- Every input has a `<label for>`, `name`, `autocomplete`; URLs use `type="url" inputmode="url"`, numbers `type="number" inputmode="decimal"`, `spellcheck="false"` on tickers and links; placeholders end with `…`.
- Async results use `role="status" aria-live="polite"`.
- No `transition: all`, no `outline: none` without a `:focus-visible` replacement, no zoom blocking, no paste blocking.
- `color-scheme` set per theme; `<meta name="theme-color">` follows the toggle.
- Numbers via `Intl.NumberFormat`, dates via `Intl.DateTimeFormat`; brand and code tokens carry `translate="no"`.
- URL reflects state in THE CHAIN (`?t=TICKER#panel`); arrow keys move along the chain.
- Destructive "صفّر النموذج" asks for confirmation; deleting a single entry is one tap and only affects that entry.
- Ops Room camera `<img>` has width 352 and height 288.

## Not applicable or deliberately different

- Title Case for headings: Arabic has no case; English pages use sentence case per DESIGN.md (the taste-skill rule).
- Hydration rules: no framework, nothing is server-rendered.
- List virtualisation: news list is capped at 80 rendered items.
