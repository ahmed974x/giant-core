# OMEGA Ops Room v1 · غرفة العمليات

Local-first, read-only operations dashboard. One file, no backend, no build step, no framework, no keys, no trading.
v2 (ADR-087): white "Pure Daylight" theme by default with a dark toggle, OKLCH + Display P3 colors, 3D globe, real charts, five-agent status, open cameras, self-healing feeds.

لوحة تشغيل محلية للقراءة فقط. ملف واحد، بدون خادم، بدون مفاتيح، بدون تداول.

## Run · التشغيل

- Double-click `omega-ops-room.html`, or
- serve it locally: `python -m http.server 8787 --bind 127.0.0.1` in this folder, then open http://127.0.0.1:8787/omega-ops-room.html

Open it over plain `http://` on the laptop. Served from an `https://` site (e.g. the Tailscale URL) the browser blocks the `http://localhost` health checks as mixed content, so n8n and Newton would show offline.

## Widgets · الوحدات

| Widget | Source | Refresh |
|---|---|---|
| BTC / USDT · بيتكوين | `data-api.binance.vision` public ticker (no key) | 10 s, paused while the tab is hidden |
| Kuwait weather · طقس الكويت | Open-Meteo (no key), "Weather by Open-Meteo" in footer | 10 min |
| n8n · نظام الأتمتة | `http://localhost:5678/healthz` (status only, never runs workflows) | 15 s |
| Newton core · محرك نيوتن | `http://127.0.0.1:8095/api/health` (pre-flight gate) | 15 s |
| Newton tools · أدوات نيوتن | Tool list from the health reply; disabled while the gate is closed | with Newton |
| BTC chart · رسم بيتكوين | `data-api.binance.vision` daily klines, 120 days, SMA 20/50 crosses shown as educational dots only | 15 min |
| Number auditor · مدقق الأرقام | Live ticker vs last daily candle close; flags a gap above 0.5% | with BTC |
| Risk check · فحص المخاطر | 90-day VaR 95% by formula and by 20,000-path seeded Monte Carlo; rejected if they differ by 3% or more; historical VaR alongside | with candles |
| Globe · الكرة الحية | Canvas 2D orthographic projection (no library), Natural Earth land points, monitoring points with raw-evidence links | 60/120 Hz, paused when hidden |
| Open cameras · الكاميرات | TfL JamCams still images (open data) | 2 min |
| Agents · الوكلاء | Display of the five agents' real state. Execution is LOCKED, the profit-split vault is CLOSED | live |
| Self-healing log · سجل التعافي | Every feed retries after 5 s, 10 s, 20 s… capped at its interval, forever; outages and recoveries are logged | live |

Each widget catches its own errors, so one dead source never blocks the others. If BTC drops after a good reading, the last price stays on screen, dimmed.

## Newton gate · بوابة نيوتن

The gate opens only when the browser actually reads `/api/health` and it returns `"ok": true`. Any future Newton task must `await window.OMEGA.requireNewton()` first; it re-checks if the last result is older than one cycle.

**Known limitation:** Newton's current `http_api.py` sends no `Access-Control-Allow-Origin` header, so a browser page cannot read its health reply. The dashboard detects this ("port answers, gate stays closed") instead of showing a false READY. To open the gate, Newton's `/api/health` response needs `Access-Control-Allow-Origin` set to the dashboard origin (e.g. `http://127.0.0.1:8787`, or `null` for a double-clicked file). n8n has the same limitation; for n8n the dashboard shows ONLINE / "port responding", which is enough for a status light.

## With the Core API · مع Core API

When `omega-core-api` runs on `127.0.0.1:8000`, the page asks it for n8n and Newton health first (tags show `VIA CORE`), which solves the CORS limitation above without touching Newton. Open it through the API at http://127.0.0.1:8000/ops/omega-ops-room.html. If the API is not running, the page falls back to probing each service directly.

## THE CHAIN · سلسلة الوكلاء الماليين (ADR-088)

`the-chain.html` sits next to the Ops Room (link in the agents section) and also opens by double-click. Research only: nothing in it trades.

| Step | What it does |
|---|---|
| 01 Market Researcher · باحث السوق | 90-day news from GDELT DOC 2.0 (free, keyless) sorted into company / regulatory / sector [INFERENCE]; 6-month analyst range; bulls vs bears; verbatim management quotes and wording shift; Information Gaps. Anything without a source and a date is shown as «تعذر التحقق منها» and kept out of the numbers. |
| 02 Institutional Model Builder · باني النماذج | INPUTS / HISTORICALS / PROJECTION / VALUATION (DCF + EV/EBITDA and P/E comps) / SENSITIVITY (two-way matrix). No constant outside INPUTS. Top 3 assumptions, the level of each that moves price 30%, top 3 risks. CSV and Excel export. The built-in example is labelled as invented numbers. |
| 03 Earnings Reviewer · مراجع الأرباح | Actual vs consensus (with sources), forward guidance quoted verbatim, tone vs last quarter, answered vs dodged analyst questions [INFERENCE], 3-sentence thesis test with exact quotes, falsification criteria. |
| 04 notes.md · دفتر الملاحظات | One cumulative file per ticker (`# [TICKER]`, view in 3 sentences, what could prove me wrong, last review, what changed, chain log). "مراجعة جديدة" records the change since the last review. Download / import `.md`. |

State lives in this browser's `localStorage` under `chain:<TICKER>:*` and `omega-notes:<TICKER>`. Deep link: `the-chain.html?t=AAPL#model`.
The 24/7 execution agent, copy-trading vault and profit split appear only as locked cards «قيد الموافقة».

## Phase 4 · الدرع الأمني والبيانات المجانية (ADR-089)

| Section | What it does |
|---|---|
| Digital-asset liquidity · سيولة الأصول الرقمية | CoinGecko total market cap + BTC dominance, DefiLlama DeFi TVL with 30-day change. Free, no keys, every 10 min. |
| Security shield · الدرع الأمني (`#shield`) | SkillSpector in the browser: live self-check of this page and a scanner for any file, folder or skill you pick. Same 13 rules as `scripts/skillspector-audit.mjs`; nothing leaves the browser. |
| Encrypted vault · الخزنة المشفّرة | AES-GCM-256 with a PBKDF2-SHA256 (600,000 rounds) key from your passphrase. Only ciphertext in `localStorage` (`omega-vault-v1`). Auto-locks after 5 minutes. Moves any plaintext key it finds into the vault. |
| Profit split & HWM · حاسبة الأرباح (`#split`) | Math simulation only: no money accepted, no trade copied. |

THE CHAIN adds: "اسحب من SEC EDGAR" in HISTORICALS, a digital-asset card (CoinGecko, Binance, DefiLlama) and the Quant-Implied Target Range `[INFERENCE - Quant Model]` next to the analyst range.

SEC EDGAR and Stooq need the local proxy (they send no CORS headers). `start-omega` runs it for you; by hand:

```bash
OMEGA_SEC_UA="Ahmad your@email" node scripts/omega-data-proxy.mjs   # http://127.0.0.1:8796
```

Every page has a strict, hash-pinned CSP. After editing any inline script or style run `node scripts/skillspector-audit.mjs --fix omega-ops-room-v1`.

## Views, OSIRIS and install (ADR-092)

- **Views:** 1 Command, 2 OSIRIS, 3 Radar, 4 Receipts & shield, 5 All. Laptops use the segmented control under the top bar and phones the floating dock. Open a view directly with `?view=2`.
- **OSIRIS:** seven layers (data core, aviation, alerts, maritime, port pulse, weather grid, seismic) on a 3D or 2D map with DAY, MAP and SAT colour styles and live coordinates. The ticker joins prices, quakes and the Physical Shock Index (PWSI 0–100).
  - USGS and Open-Meteo load directly.
  - OpenSky, GDACS, GDELT and Digitraffic AIS need `node scripts/omega-data-proxy.mjs` (no key needed for them).
- **Install on iPhone:** serve the folder (for example the Tailscale URL), open it in Safari, then Share → Add to Home Screen.

## Phase 8: one-click launcher, straits, SAT, self-learning court, capsule (ADR-093)

- **Start everything with one file:** `start-omega.bat` (Windows, double-click) or `./start-omega.sh` (macOS, Linux). It starts `scripts/omega-data-proxy.mjs` on `127.0.0.1:8796`, which now also serves the Ops Room, THE CHAIN and NABD pages from this folder, prints a LIVE / DOWN / SKIP table for every free source, and opens `http://127.0.0.1:8796/omega-ops-room-v1/omega-ops-room.html`. `node scripts/omega-data-proxy.mjs --check` prints the table and exits.
- **Five straits:** the proxy pulls the NGA Maritime Safety Information broadcast warnings (keyless, `msi.nga.mil`) and sorts each active warning into Hormuz, Bab el-Mandeb, Suez, Malacca or Panama by the position in its text or by name, plus GDELT headlines that name a strait. OSIRIS shows the count, the latest warning number and its issue date per strait, and a fourth PWSI component. Ship positions stay Baltic-only (Digitraffic): no free source has live ship counts in the five straits.
- **SAT:** NASA GIBS Blue Marble Next Generation imagery (EPSG:4326 level 0, two tiles). 2D scales it in, 3D resamples it per pixel. With no internet SAT keeps the drawn map.
- **Live Hawkes and VPIN:** a ring buffer of the last 300 public trades. Hawkes μ, α and β are fitted by the method of moments on every pull (Fano factor and lag-1 autocorrelation of trade counts), and VPIN uses buckets of 1/50 of the window's volume. The fitted values are shown in the order-flow table.
- **Self-learning court:** after each closed paper trade the three voices (bull, red-team bear, OSIRIS) are scored with the Brier loss and reweighted, `w ← w(1 − 0.05·loss)`, normalised. The judge opens only when the weighted P(up) is above 50 %. The table shows each weight, each voice's hit rate and the Court Accuracy Score. `[INFERENCE - Quant Model]`.
- **On-chain pulse:** mempool.space fees, backlog and any of the last 10 transactions of 100 BTC or more, in the whale card. A fastest fee of 100 sat/vB or more is a red-team risk.
- **Encrypted capsule:** `📦 Export capsule` writes the paper wallet, the receipt chain, the court weights and THE CHAIN notes to one `.omega-capsule.json` file encrypted with AES-GCM-256 (PBKDF2-SHA256, 600,000 rounds). Import it on the other device with the same passphrase. The fingerprint (SHA-256 of the ciphertext) and the receipt chain are checked before anything is replaced. No server, no API key in the file.
- **Command wall:** view 5 at 1280 px and up shows four quadrants in one screen (OSIRIS · live chart and whales · court and physics · wallet and receipts). Each quadrant scrolls on its own and has a maximize button.
- **Keys:** `1`–`5` views, `K` emergency stop, `S` sweep profit above the locked base now (paper ledger, with a receipt), `Esc` restore a maximized quadrant. Keys are ignored while typing in a field.

## Trading desk · غرفة التداول (ADR-091)

Paper only. Nothing on this page sends an order to any exchange.

- **Signal cockpit:** STRONG BUY / BUY / HOLD / SELL / STRONG SELL / WHALE TRAP WARNING from five weighted pieces of evidence (whales 0.25, contrarian crowd 0.2, 10-year analogues 0.15, quant odds 0.2, order-flow physics 0.2: microprice, Hawkes intensity, VPIN), a three-agent debate court (bull, red-team bear, risk judge) and a paper-only auto engine, with entry, stop (1.5 × ATR 4h), TP1 1.5 R (half off, stop to entry), TP2 3 R, trailing stop (peak − 2 × ATR) and half-Kelly size capped at 25 %.
- **Radar:** Binance spot depth (walls, vanished walls, ±1 % imbalance), 4h liquidity sweeps and a Wyckoff phase guess; USDⓈ-M funding z-score, open interest, long/short ratios, taker flow, an estimated liquidation map (assumed leverage mix) and a FOMO gauge read contrarian.
- **10-year matcher:** Binance daily candles since 2017-08-17 (cached 12 h), seven z-scored features, cosine similarity, the ten closest days at least 30 days apart, and what followed over 30 and 90 days.
- **Wallet:** lock any amount; sweep every profit above it (A) or at a target (B); optional profit-split share; deposit, withdraw and test-trade buttons; **Emergency stop** closes the paper position at the bid and moves everything to the safe vault.
- **Circuit breaker:** 60 s move, depth drop against the 15-minute median, vanished walls, day loss, stale data over 20 s. Any one trips the emergency stop while a paper position is open.
- **Receipts:** every operation is hash-chained with SHA-256 (format in DESIGN.md §6). Verify, export JSON, print one receipt, or start a new chain. The landing page (`site-landing/#safe`) checks exported files with the same rules.

The auto engine trades paper only. No exchange client or order signing exists in the page (Ahmad's rule, 2026-10-19).

## Design · التصميم

Same tokens as `site-landing/style.css`. Contrast gate: `node audits/verify-contrast.mjs omega-ops-room-v1/omega-ops-room.html` (all pairs WCAG >= 4.5 and APCA Lc >= 60, light, dark and P3). Cairo and JetBrains Mono are embedded (SIL OFL 1.1), so the page still works double-clicked. Every live number uses a monospace font with `tabular-nums`.

## Security · الأمان

- No real trading, no workflow execution, no remote commands. The trading desk is paper only; Testnet, auto-trading and real-account modes are disabled until explicit approval.
- No credentials anywhere in the file; requests use `credentials: "omit"`.
- Network text is never inserted as HTML (`textContent` only).
- Future write actions go through an authenticated local gateway (spec section 5), not this page.
