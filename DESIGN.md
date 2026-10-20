# DESIGN.md · OMEGA / NABD design system

One design language for every OMEGA surface: `site-landing/` (public NABD portal), `omega-ops-room-v1/omega-ops-room.html` (Ops Room) and `omega-ops-room-v1/the-chain.html` (finance research chain). Decision records: ADR-087 (tokens), ADR-088 (this file, THE CHAIN, skill rules) and ADR-089 (security shield, free data engine, profit-split calculator). Agent rules: `AGENTS.md` and `CLAUDE.md`.

Direction: Apple HIG discipline on a clean white canvas, with Linear's density for data, Stripe's calm hierarchy for money, and Replicate's plain, honest product copy. White "Pure Daylight" is the default; dark is a toggle, never an accident inside a light page.

## 1. Tokens (source of truth: `site-landing/style.css`)

All colours are OKLCH. Display P3 screens get the same lightness with more chroma under `@media (color-gamut: p3)`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `oklch(98.5% 0.002 260)` | `oklch(17% 0.012 265)` | page |
| `--surface` | `oklch(100% 0 0)` | `oklch(21.5% 0.014 265)` | cards |
| `--surface-2` | `oklch(96.5% 0.004 260)` | `oklch(25.5% 0.016 265)` | inner wells, inputs |
| `--content-primary` | `oklch(21% 0.012 265)` | `oklch(95% 0.01 265)` | text |
| `--content-secondary` | `oklch(46% 0.025 265)` | `oklch(86% 0.025 265)` | supporting text |
| `--content-tertiary` | `oklch(54% 0.039 268)` | `oklch(78% 0.039 268)` | captions (floor of the contrast gate) |
| `--accent` | `oklch(52% 0.14 245)` | `oklch(78% 0.125 245)` | the one accent |
| `--success` / `--warning` / `--danger` / `--violet` / `--gold` | see CSS | see CSS | status only, never decoration |

Rules:
- One accent. Status colours mean status: green live, amber checking or [INFERENCE], red failed or "تعذر التحقق منها", violet locked "قيد الموافقة".
- Every text/background pair passes WCAG ≥ 4.5:1 **and** APCA Lc ≥ 60 in light, dark and both P3 variants. Gate: `node audits/verify-contrast.mjs <file>` (culori@4.0.1, apca-w3@0.1.9). A failing pair blocks the commit.
- No pure black, no purple-blue "AI gradient", no generic grey drop shadows. Shadows are tinted with `--shadow-color` and stay below 0.1 alpha.

## 2. Type

- Arabic: Cairo (variable, vendored, SIL OFL 1.1). Latin UI: system-ui / SF Pro. Numbers: `ui-monospace, "SF Mono", "JetBrains Mono"` with `font-variant-numeric: tabular-nums slashed-zero`, `direction: ltr`, `unicode-bidi: isolate`.
- Scale: large `clamp(1.75rem, 1.3rem + 1.6vw, 2.5rem)`, title `clamp(1.25rem, 1.1rem + 0.6vw, 1.5rem)`, headline 17px, body 15px, footnote 13px, caption 12px. Nothing below 12px.
- Headings `text-wrap: balance`; paragraphs `pretty`; line length ≤ 75ch.
- Arabic letter-spacing stays 0. Mixed Arabic/English text uses `dir="auto"`, `<bdi>` or `unicode-bidi: plaintext`.

## 3. Shape and space

- Concentric radii: **outer = inner + padding**. Ops Room card 28 = 8 + 20; landing panel 40 = 32 + 8; pills 999.
- Spacing scale 4 / 8 / 12 / 16 / 20 / 24 / 32 / 48. Max content width 1440px; ultra-wide screens get margins, not stretched lines.
- Hairlines are 1px, 0.5px at ≥ 2dppx.
- Cards exist only when elevation means hierarchy. Inner wells use `--surface-2`, not another border.

## 4. Motion

- `--ease-apple-fluid: cubic-bezier(0.32, 0.72, 0, 1)`; spring `linear(...)` (ζ 0.72, 600ms) inside `@supports`.
- Animate `transform` and `opacity` only, list properties explicitly (never `transition: all`). Press feedback `scale(0.96–0.98)`.
- `prefers-reduced-motion: reduce` turns all motion off.
- Glass (`blur(20px) saturate(180%)`) only on fixed or sticky chrome, always with an opaque fallback. The phone dock (ADR-092) is the one place that uses `blur(40px) saturate(200%)`.

## 5. Layout and devices

- `100dvh`, never bare `100vh`. `viewport-fit=cover` and `env(safe-area-inset-*)` on edges. No horizontal page scroll at any width; wide tables scroll inside `.table-scroll`.
- Three sizes are checked on every UI change: **Mobile 390×844 @3x**, **Laptop 1440×900**, **Ultra-wide 2560×1080**, light and dark. Script: `scripts/ui-three-sizes.mjs`.
- The Ops Room and THE CHAIN must work when double-clicked from disk (`file://`): fonts embedded as base64, no build step, no framework.
- Command wall (ADR-093): view 5 at ≥ 1280 px is a 2 × 2 grid (`1.15fr 1fr`, gap 12px) exactly `100dvh − header` high. Cards move into the quadrants and back, so ids and listeners stay the same. Each quadrant scrolls inside; the page never stacks the wall. Quadrant radius 28 = inner card 20 + padding 8. Keys: 1–5 views, K stop, S sweep, Esc restore, all ignored inside fields.
- Ops Room shell (ADR-092): five views (1 Command, 2 OSIRIS, 3 Radar, 4 Receipts & shield, 5 All). Every top-level child of `<main>` carries `data-view="…"`, and a new section must name its views. A segmented control is used at ≥ 768 px, and a floating dock with `safe-area-inset-bottom` below that. The view lives in `?view=N`. The status island shows the two brains, the locked base and the vault in tabular numbers. The install manifest is linked only over http(s).
- Performance: telemetry arrays are bounded ring buffers (300). Canvases draw on demand and pause under `IntersectionObserver` and `visibilitychange`. The only continuous motion is the ticker marquee, which uses `transform`, pauses on hover and is off under reduced motion.

## 6. Content and honesty rules (override any skill that says otherwise)

- No invented data. Market numbers, analyst targets, quotes and performance come from a named source with a date, or they are shown as "تعذر التحقق منها" (unverified). Teaching examples are labelled "مثال تعليمي — أرقام افتراضية" on screen.
- Heuristic readings (classification, tone, dodge detection, thesis support) carry `[INFERENCE]`.
- Real trading, public copy-trading vaults and investor profit split appear only as locked cards marked **«قيد الموافقة»** until Ahmad gives a separate explicit approval and legal review is done.
- The profit-split / high-water-mark calculator (ADR-089) is a math simulation in the browser: it sends nothing, accepts no money and copies no trade, and says so next to the inputs. Quant ranges carry `[INFERENCE - Quant Model]`.
- Trading desk (ADR-091): paper only. The person opens every paper trade; no code path sends an order to any exchange. Testnet and real-account modes show as disabled options until Ahmad approves each one. Signals (STRONG BUY / BUY / HOLD / SELL / STRONG SELL / WHALE TRAP WARNING) carry `[INFERENCE]`, levels and Kelly size carry `[INFERENCE - Quant Model]`, regime matches carry `[INFERENCE - 10Y Fractal Model]`, and the matcher says on screen that Binance history starts 2017-08-17 (2016 is not covered).
- OSIRIS (ADR-092, ADR-093): every layer names its source. A layer without a live keyless source is shown as OFFLINE or "NO FREE SOURCE", never filled with simulated points. PWSI shows how many of its four components it used and carries `[INFERENCE]`. Each strait shows its NGA warnings with the warning number and issue date, or "تعذر التحقق منها" when the proxy is off. SAT is NASA GIBS Blue Marble imagery when it loads and the drawn map otherwise; nothing says "satellite" without the imagery on screen.
- Self-learning court (ADR-093): the weights, each voice's hit rate and the Court Accuracy Score are shown with `[INFERENCE - Quant Model]`, and "no closed trade yet" until there is one. Hawkes and VPIN show their live fitted parameters, never constants.
- The auto engine is paper only and opens a trade only on the risk judge's OPEN. The court's three lines are rule-based summaries of the numbers on screen.
- The locked-base simulator says next to its inputs that the base itself can still lose in trading and that only swept profit is protected. The circuit breaker is described as fixed rules, never as a prediction.
- Plain, active copy. No "Elevate / Seamless / Unleash / Next-gen", no exclamation marks, no "Oops". Errors say what failed and what to do next. Loading text ends with "…".
- Free and open-source only. No CAPTCHA solving, no paid data sources.

## 7. Engineering rules

- Text goes in with `textContent` (no `innerHTML` with data). Links from data pass `safeUrl()` and open with `rel="noopener noreferrer"`. Fetches use `credentials: "omit"`.
- Icon-only buttons have `aria-label`; decorative SVG has `aria-hidden="true"`; async status uses `aria-live="polite"`; every input has a `<label>`, `name` and `autocomplete`.
- URL reflects state (`?t=TICKER#panel` in THE CHAIN). Destructive actions ask first.
- Dates and numbers through `Intl.DateTimeFormat` / `Intl.NumberFormat`. Brand names and code tokens get `translate="no"`.
- `localStorage` is wrapped in try/catch and the page works without it.
- Every file complete: no TODO, no placeholder, no "rest of code". Syntax check (`node --check` on extracted scripts) and the contrast gate run before a file is called done.

- Receipts (ADR-091): every wallet operation issues a receipt `{invoice, seq, ts (ISO 8601), mode, symbol, type, amount, before, after, reason, prev_hash, hash}`. `hash = SHA-256(JSON of the receipt without "hash", keys sorted, numbers rounded to 8 decimals)` via `crypto.subtle.digest`; the first `prev_hash` is 64 zeros. Export format `{"format":"omega-receipt-chain-v1","receipts":[…]}`. The Ops Room and the landing verifier use the same canonical form, so a file exported from one checks in the other.
- Capsule (ADR-093): `{"format":"omega-capsule-v1","kdf":"PBKDF2-SHA256","iter":600000,"cipher":"AES-GCM-256","salt","iv","ct","fingerprint"}`, fingerprint = SHA-256 of the ciphertext. The plaintext holds the paper wallet, receipts, court weights and THE CHAIN notes only; never a vault entry or an API key. Import verifies the fingerprint and the receipt chain and asks before it replaces anything.
- Glass wallet cards (`.glass`) are the one exception to "glass only on chrome": they sit inside `.wallet`, always over an opaque `--surface-2` fallback outside `@supports (backdrop-filter)`. The emergency-stop button uses `--danger-fill` / `--on-danger-fill`, gated by the contrast check like the other fills.

## 8. Security (ADR-089)

- Every page ships a strict `Content-Security-Policy` meta: `default-src 'none'`, no `'unsafe-inline'` or `'unsafe-eval'`, inline `<script>`/`<style>` pinned by sha256, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`, `connect-src` listing each data host by name. After editing any inline script or style, run `node scripts/skillspector-audit.mjs --fix <paths>` to re-pin the hashes.
- No `style="…"` attributes and no `setAttribute("style")` (blocked by the CSP); use classes or `el.style.x`.
- No `eval`, `new Function`, string timers, `innerHTML` with data, or inline `on*=` handlers. External scripts need SRI (`--fetch` adds it).
- Secrets never sit in `localStorage` as plaintext. The Ops Room vault encrypts with AES-GCM-256 from a PBKDF2-SHA256 (600,000 rounds) passphrase key; only ciphertext is stored.
- `node scripts/skillspector-audit.mjs --strict <changed paths>` must exit 0 before any PR, and CI runs it over the whole repo (ADR-090: 0 critical, 0 high). Suppressions live in `.skillspector.json` and each needs a written reason.

## 9. Where the rules came from

Distilled into `.claude/skills/omega-design/SKILL.md` (design) and `.claude/skills/omega-finance-chain/SKILL.md` (finance agents). Sources are listed there with the commit read. Only text rules were taken; no third-party scripts, hooks or installers were added (external-skills policy from the 2026-10-15 security review: `docs/SKILLS-SECURITY-REVIEW.md` on branch `claude/project-thread-gkzfb4`, not merged yet).
