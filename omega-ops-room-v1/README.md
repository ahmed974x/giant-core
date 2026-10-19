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

SEC EDGAR and Stooq need the local proxy (they send no CORS headers):

```bash
OMEGA_SEC_UA="Ahmad your@email" node scripts/omega-data-proxy.mjs   # http://127.0.0.1:8796
```

Every page has a strict, hash-pinned CSP. After editing any inline script or style run `node scripts/skillspector-audit.mjs --fix omega-ops-room-v1`.

## Design · التصميم

Same tokens as `site-landing/style.css`. Contrast gate: `node audits/verify-contrast.mjs omega-ops-room-v1/omega-ops-room.html` (all pairs WCAG >= 4.5 and APCA Lc >= 60, light, dark and P3). Cairo and JetBrains Mono are embedded (SIL OFL 1.1), so the page still works double-clicked. Every live number uses a monospace font with `tabular-nums`.

## Security · الأمان

- Read-only: no trading, no workflow execution, no remote commands. The execution agent and profit-split vault are display-only and gated on explicit approval.
- No credentials anywhere in the file; requests use `credentials: "omit"`.
- Network text is never inserted as HTML (`textContent` only).
- Future write actions go through an authenticated local gateway (spec section 5), not this page.
