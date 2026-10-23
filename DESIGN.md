# DESIGN.md · OMEGA / NABD design system

One design language for every OMEGA surface: `site-landing/` (public NABD portal), `omega-ops-room-v1/omega-ops-room.html` (Ops Room) and `omega-ops-room-v1/the-chain.html` (finance research chain). Decision records: ADR-087 (tokens), ADR-088 (this file, THE CHAIN, skill rules) and ADR-089 (security shield, free data engine, profit-split calculator). Agent rules: `AGENTS.md` and `CLAUDE.md`.

Direction: Apple HIG discipline on a clean white canvas, with Linear's density for data, Stripe's calm hierarchy for money, and Replicate's plain, honest product copy. Light "Apple Daylight Ceramic" (`#F5F5F7` page, white cards) is the default; dark "Apple OLED Pro Dark" (`#000000` page, `#1C1C1E` / `#2C2C2E` cards) is a toggle, never an accident inside a light page (ADR-101).

## 1. Tokens (source of truth: `site-landing/style.css`)

All colours are OKLCH. Display P3 screens get the same lightness with more chroma under `@media (color-gamut: p3)`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `oklch(97.1% 0.003 286.4)` (#F5F5F7) | `oklch(0% 0 0)` (#000000) | page |
| `--surface` | `oklch(100% 0 0)` | `oklch(22.7% 0.004 286.1)` (#1C1C1E) | cards |
| `--surface-2` | `oklch(96.3% 0.007 286.3)` (#F2F2F7) | `oklch(29.4% 0.004 286.2)` (#2C2C2E) | inner wells, inputs |
| `--content-primary` | `oklch(23.2% 0.004 286.1)` (#1D1D1F) | `oklch(97.1% 0.003 286.4)` | text |
| `--content-secondary` | `oklch(50% 0.006 286)` | `oklch(84% 0.006 286)` | supporting text |
| `--content-tertiary` | `oklch(53.5% 0.007 286)` | `oklch(79.5% 0.007 286)` | captions (floor of the contrast gate) |
| `--accent` | `oklch(54.5% 0.197 257.4)` | `oklch(79.1% 0.107 255.5)` | the one accent, Apple system blue at text contrast |
| `--apple-green` / `-red` / `-blue` / `-indigo` / `-purple` / `-orange` / `-cyan` | #34C759 #FF3B30 #007AFF #5856D6 #AF52DE #FF9500 #32ADE6 | #30D158 #FF453A #0A84FF #5E5CE6 #BF5AF2 #FF9F0A #64D2FF | marks, chart lines, rings and map points only, never text (more chroma under P3) |
| `--success` / `--warning` / `--danger` / `--violet` / `--gold` | see CSS | see CSS | status only, never decoration |

Rules:
- One accent. Status colours mean status: green live, amber checking or [INFERENCE], red failed or "تعذر التحقق منها", violet locked "قيد الموافقة".
- Every text/background pair passes WCAG ≥ 4.5:1 **and** APCA Lc ≥ 60 in light, dark and both P3 variants. Gate: `node audits/verify-contrast.mjs <file>` (culori@4.0.1, apca-w3@0.1.9). A failing pair blocks the commit.
- Pure black only as the OLED dark page background (`--bg`, ADR-101). No purple-blue "AI gradient", no generic grey drop shadows. Shadows are tinted with `--shadow-color` and stay below 0.1 alpha; cards use `--shadow-soft` (`0 10px 30px -5px`, 0.05) over a 1px hairline (`rgba(0,0,0,0.07)` light, `rgba(255,255,255,0.12)` dark).
- Apple system colours: text uses the gated tokens (`--success`, `--danger`, `--accent`…, the accessible variants of #34C759 / #FF3B30 / #007AFF), while the vivid `--apple-*` values are for strokes, fills, rings and map points, which carry no text. The decision card's ambient aura uses one of them at 18–20% (green buy, cyan watching, orange whale-trap or rising PWSI, red sell or PWSI at the limit) and cross-fades by opacity.

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
- Glass (`blur(32px) saturate(190%)`, `--glass` at 0.82 alpha) only on fixed or sticky chrome and the map overlays, always with an opaque fallback. The phone dock (ADR-092) is the one place that uses `blur(40px) saturate(200%)`.

## 5. Layout and devices

- `100dvh`, never bare `100vh`. `viewport-fit=cover` and `env(safe-area-inset-*)` on edges. No horizontal page scroll at any width; wide tables scroll inside `.table-scroll`.
- Three sizes are checked on every UI change: **Mobile 390×844 @3x**, **Laptop 1440×900**, **Ultra-wide 2560×1080**, light and dark. Script: `scripts/ui-three-sizes.mjs`.
- The Ops Room and THE CHAIN must work when double-clicked from disk (`file://`): fonts embedded as base64, no build step, no framework.
- Command wall (ADR-093): view 5 at ≥ 1280 px is a 2 × 2 grid (`1.15fr 1fr`, gap 12px) exactly `100dvh − header` high. Cards move into the quadrants and back, so ids and listeners stay the same. Each quadrant scrolls inside; the page never stacks the wall. Quadrant radius 28 = inner card 20 + padding 8. Keys: 1–5 views, K stop, S sweep, Esc restore, all ignored inside fields.
- Ops Room shell (ADR-092): five views (1 Command, 2 OSIRIS, 3 Radar, 4 Receipts & shield, 5 All). Every top-level child of `<main>` carries `data-view="…"`, and a new section must name its views. A segmented control is used at ≥ 768 px, and a floating dock with `safe-area-inset-bottom` below that. The view lives in `?view=N`. The status island shows the two brains, the locked base and the vault in tabular numbers. The install manifest is linked only over http(s).
- Rings and canyon (ADR-103): ring gradients green→mint, indigo→purple, orange→pink with hairline track borders and a round leading cap; that cap's tinted shadow (0.28 alpha) is the one exception to the 0.1 shadow rule. The sonar canyon is the top 25 book levels per side as equal-width stepped tiers with badges on the three largest levels; the microprice baseline sends one set of rings per 0.5 bps move (at most every 4 s) or new whale wall, never a loop. Loupes stay at y ≥ 24. A first visit locks a $20.00 paper base with a LOCK receipt.
- Charts (ADR-102): monotone splines (no overshoot), glow area from `--apple-*`, event dots, a magnetic crosshair with a glass loupe in tabular numbers (`OMEGA_VIS`, inline in the Ops Room, `vis.js` in NABD). Canvases use devicePixelRatio up to 3. The triple rings and the whale sonar canvas use only numbers already on the page; the sonar pulse fires once per new wall and is off under reduced motion.
- Performance: telemetry arrays are bounded ring buffers (300). Canvases draw on demand and pause under `IntersectionObserver` and `visibilitychange`. The only continuous motion is the ticker marquee, which uses `transform`, pauses on hover and is off under reduced motion.

- Suite (ADR-107): every page has the app-grid button beside the theme toggle; the glass switcher lists NABD, the Ops Room and THE CHAIN with a live line each. Theme, paper base/safe, PWSI and ticker sync over BroadcastChannel `omega-suite`. The Ops Room's shield button (and `?selftest=1`) runs the 24-check self-test (ADR-108 to ADR-112); a check that needs live data fails honestly.
- Deep neural flow (ADR-109): a canvas in views 1, 3 and 5 with seven columns, 139 linear inputs in seven labelled groups, ReLU layers of 48, 36, 48, 24 and 16, and 8 tanh decision heads with their decoded values on the right. Threads are cubic Béziers, cyan for w > 0, purple and pink for w < 0, orange and red into the heads; opacity follows |w·a|. Pulses follow the strongest contributions only on events (a new reading, a 0.5 bps microprice move, a data pull, a training burst, hover or tap), at most once a second, still under reduced motion and during the self-test. The glass oscilloscope sits top right at ≥ 600 px and below the canvas on a phone. The chrono-scrubber replays the 300-reading ring with a labelled hypothetical counterfactual. X-Ray (key X) adds glass badges with each card's equation, measured µs per call, ring fill and source. The regime (calm green, hunt cyan, shield red) colours the header's bottom line and outlines the cards that matter; it is fixed rules, not a prediction.
- Continuous-time flow (ADR-110): between readings every hidden and decision neuron follows dx/dt = (σ(Wx + b) − x) / τ with Heun steps, so its resting state is the trained answer and depth adds delay. τ shortens up to eightfold after a shock (whale wall, 0.5 bps microprice move, InfoCON rise, emergency squawk, BGP origin or more-specific change) and relaxes over 30 s. After a reading the canvas settles on `requestAnimationFrame` for at most 6 s, and not at all under reduced motion or during the self-test. The oscilloscope shows x(t) as a purple ring and the neuron's τ now and at calm.
- Liquidity, vulnerabilities and seas (ADR-112): the whale sonar card adds the DefiLlama liquidity flow index (LFI, −100 to +100, its parts and coverage, [INFERENCE]) and the court adds a liquidity witness line that is not a weighted voice. The neural flow card adds a causal "why" table built only from numbers on the page, and a button that asks a local Ollama model through the proxy; its answer is labelled `[INFERENCE - local LLM]` and changes nothing. Heads 6 to 8 read as proposals for Director 00 on the paper ledger. The oscilloscope title says when it is frozen for the self-test.
- Agent wiring (ADR-111): a canvas in views 1, 3 and 5 that draws the eight decision heads, the desk agents that teach them (each level with its head), the court voices and gym agents, and the paper auto engine and vault, joined only by links the code has. Teaching lines are coloured by the gap between rule and network (green ≤ 0.25, amber ≤ 0.6, red beyond, grey with no reading), court lines are indigo, acting lines blue and bold only while they act, gym lines dashed purple (informs only). On a phone the columns become rows with alternate labels above and below. Drawn on events only, no loop.
- Brain 2 synaptic web (ADR-108): a canvas in views 1 and 5 with an outer ring of 10 sensory nodes, a middle ring of 8 quant nodes, an inner ring of 6 agents and the vault at the core. Edges are the links the desk really uses; a node is filled when its source is live and hollow when offline. Filaments fire only on discrete events (microprice move of 0.5 bps or more, a new wall or iceberg, a data pull, a gym burst, hover or tap), at most one per second, as a highlight under reduced motion. On a phone the web is an upright ellipse with labels above and below the nodes. The glass causal card is the one glass surface inside a body card. A Web Worker gym (contextual EXP3 + fixed-share multiplicative weights on Float64Array buffers) reports measured ticks per second on the machine it runs on; its weights inform the web and never open a trade.

## 6. Content and honesty rules (override any skill that says otherwise)

- No invented data. Market numbers, analyst targets, quotes and performance come from a named source with a date, or they are shown as "تعذر التحقق منها" (unverified). Teaching examples are labelled "مثال تعليمي — أرقام افتراضية" on screen.
- Heuristic readings (classification, tone, dodge detection, thesis support) carry `[INFERENCE]`.
- Real trading, public copy-trading vaults and investor profit split appear only as locked cards marked **«قيد الموافقة»** until Ahmad gives a separate explicit approval and legal review is done.
- The profit-split / high-water-mark calculator (ADR-089) is a math simulation in the browser: it sends nothing, accepts no money and copies no trade, and says so next to the inputs. Quant ranges carry `[INFERENCE - Quant Model]`.
- Streams (ADR-106): the desk reads Binance's public `depth20@100ms` and `aggTrade` streams (read-only, nothing sent) and keeps 5 s REST polling as the fallback; the sonar tag names the mode. With no book at all the canyon shows a fixed simulation in made-up units, labelled SIMULATION on the canvas, which no other number uses.
- Trading desk (ADR-091): paper only. The person opens every paper trade; no code path sends an order to any exchange. Testnet and real-account modes show as disabled options until Ahmad approves each one. Signals (STRONG BUY / BUY / HOLD / SELL / STRONG SELL / WHALE TRAP WARNING) carry `[INFERENCE]`, levels and Kelly size carry `[INFERENCE - Quant Model]`, regime matches carry `[INFERENCE - 10Y Fractal Model]`, and the matcher says on screen that Binance history starts 2017-08-17 (2016 is not covered).
- OSIRIS map (ADR-100): one camera, zoom 1–18 (web-map levels), globe up to 6 then flat Web Mercator tiles. DAY CARTO Voyager @2x (OSM fallback), MAP CARTO Dark Matter @2x, SAT Esri World Imagery (GIBS fallback), each with its required credit on the map. The embedded Natural Earth coastline is drawn under every frame, so the map works offline. Every point opens a callout with its raw source.
- OSIRIS vector base and popovers (ADR-105): offline or under the tiles, the map is a shaded vector map (ceramic #E5EFF7 water by day, navy #0A192F by night, lifted land, hairline coast, globe limb shading) with lit reference shipping lanes through the five chokepoints, labelled approximate. Point popovers are glass, blur(30px) saturate(190%), with a 0.5px border and specular line, and a sparkline of real readings only (USGS magnitudes, Open-Meteo gust forecast, session PWSI).
- OSIRIS (ADR-092, ADR-093): every layer names its source. A layer without a live keyless source is shown as OFFLINE or "NO FREE SOURCE", never filled with simulated points. PWSI shows how many of its five components it used and carries `[INFERENCE]`; the fifth is the cyber and space threat index (CSTI, ADR-108: NOAA Kp, CISA KEV, RIPEstat backbone visibility, IODA outages), which the risk judge also treats as a hard stop at the PWSI limit. Submarine cables are hand-drawn approximate corridors (TeleGeography data is licensed and not used); orbits come from CelesTrak elements with two-body + J2 motion, labelled not SGP4. Each strait shows its NGA warnings with the warning number and issue date, or "تعذر التحقق منها" when the proxy is off. SAT is NASA GIBS Blue Marble imagery when it loads and the drawn map otherwise; nothing says "satellite" without the imagery on screen.
- CIRCL and strait seas (ADR-112): CSTI has an eighth possible part, CIRCL Vulnerability-Lookup pressure (critical, high and CISA KEV records), and the cyber note lists the latest records with MISP taxonomy tags from fixed rules ([INFERENCE]) and a link to each record. Open-Meteo Marine gives wave, swell, current and sea temperature at a sea point of each strait; the strait table and callouts show them with a 24 h wave sparkline, and the sea state joins PWSI's weather part as the larger of gust and sea.
- Cyber storm and air (ADR-110): CSTI has seven possible parts (adds SANS InfoCON, the RIS Live BGP instability index and Shodan InternetDB CVEs on the four public resolvers) and says how many it used. RIS Live is a read-only WebSocket for four DNS anycast prefixes; a foreign origin or more-specific route is "possible hijack or leak [INFERENCE]". adsb.lol (ODbL) gives squawk 7500/7600/7700 diamonds and aircraft counts within 150 nm of the five straits and Taiwan. Each strait callout lists its cable corridors and landings within 600 km (Panama now has one); ships with AIS off show NO FREE SOURCE. NASA GIBS night lights (2016 composite, MAP and SAT styles) and the latest day's thermal anomalies are overlays on the flat map, with their credit, and turn off after four failed tiles.
- Data cascade (ADR-104): each OSIRIS source tries the local proxy, then a direct fetch (CORS hosts only: USGS, Open-Meteo, Binance, Digitraffic, and from ADR-108 CelesTrak, NASA EONET, NOAA SWPC, RIPEstat and Deribit; CISA KEV and IODA have no browser CORS and use the proxy or the snapshot), then the hourly `data/public-intel-snapshot.json` packed by the Pages workflow. The source table names the tier; snapshot rows say "as of" their fetch time in amber and are ignored after 6 hours. PWSI and the planet ring say how many components came from the snapshot.
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

- Receipts (ADR-091): every wallet operation issues a receipt `{invoice, seq, ts (ISO 8601), mode, symbol, type, amount, before, after, reason, prev_hash, hash}`. `hash = SHA-256(JSON of the receipt without "hash", keys sorted, numbers rounded to 8 decimals)` via `crypto.subtle.digest`; the first `prev_hash` is 64 zeros. Export format `{"format":"omega-receipt-chain-v1","receipts":[…]}`. The Ops Room and the landing verifier use the same canonical form, so a file exported from one checks in the other. USDT amounts are rounded to 1e-6 before they enter the wallet or a receipt. Past 1000 receipts the oldest 500 fold into an `omega-merkle-checkpoint-v1` `{from_seq, to_seq, count, first_prev_hash, last_hash, merkle_root, ts, prev_checkpoint, hash}`; the export adds `"checkpoints": […]` and both verifiers check them. Without WebCrypto (plain http on the LAN) both pages hash with the built-in pure-JS SHA-256 (ADR-096).
- Capsule (ADR-093): `{"format":"omega-capsule-v1","kdf":"PBKDF2-SHA256","iter":600000,"cipher":"AES-GCM-256","salt","iv","ct","fingerprint"}`, fingerprint = SHA-256 of the ciphertext. The plaintext holds the paper wallet, receipts, court weights and THE CHAIN notes only; never a vault entry or an API key. Import verifies the fingerprint and the receipt chain and asks before it replaces anything.
- Glass wallet cards (`.glass`) are the one exception to "glass only on chrome": they sit inside `.wallet`, always over an opaque `--surface-2` fallback outside `@supports (backdrop-filter)`. The emergency-stop button uses `--danger-fill` / `--on-danger-fill`, gated by the contrast check like the other fills.

## 8. Security (ADR-089)

- Every page ships a strict `Content-Security-Policy` meta: `default-src 'none'`, no `'unsafe-inline'` or `'unsafe-eval'`, inline `<script>`/`<style>` pinned by sha256, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`, `connect-src` listing each data host by name. After editing any inline script or style, run `node scripts/skillspector-audit.mjs --fix <paths>` to re-pin the hashes.
- No `style="…"` attributes and no `setAttribute("style")` (blocked by the CSP); use classes or `el.style.x`.
- No `eval`, `new Function`, string timers, `innerHTML` with data, or inline `on*=` handlers. External scripts need SRI (`--fetch` adds it).
- Secrets never sit in `localStorage` as plaintext. The Ops Room vault encrypts with AES-GCM-256 from a PBKDF2-SHA256 (600,000 rounds) passphrase key; only ciphertext is stored.
- `node scripts/skillspector-audit.mjs --strict <changed paths>` must exit 0 before any PR, and CI runs it over the whole repo (ADR-090: 0 critical, 0 high). Suppressions live in `.skillspector.json` and each needs a written reason.

## 9. Where the rules came from

Distilled into `.claude/skills/omega-design/SKILL.md` (design) and `.claude/skills/omega-finance-chain/SKILL.md` (finance agents). ADR-108 adds five skills written from this repo's code: `apple-liquid-glass-hig`, `osint-bgp-cables`, `quant-microstructure-gex`, `synaptic-spiderweb-viz` and `safe-vault-cryptographic-ratchet`; ADR-109 adds `neural-flow-decision-viz` and `supreme-software-ui-architect`; ADR-110 adds `cyber-space-osint-grid`, `liquid-neural-139-flow` and `autonomous-24-selftest-gate`; ADR-112 adds `stablecoin-cyber-vuln-intel`, `neural-139-inputs-heads` and `local-glm-agent-windows-mcp`. Sources are listed there with the commit read. Only text rules were taken; no third-party scripts, hooks or installers were added (external-skills policy from the 2026-10-15 security review: `docs/SKILLS-SECURITY-REVIEW.md` on branch `claude/project-thread-gkzfb4`, not merged yet).
