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

## Design · التصميم

Same tokens as `site-landing/style.css`. Contrast gate: `node audits/verify-contrast.mjs omega-ops-room-v1/omega-ops-room.html` (all pairs WCAG >= 4.5 and APCA Lc >= 60, light, dark and P3). Cairo and JetBrains Mono are embedded (SIL OFL 1.1), so the page still works double-clicked. Every live number uses a monospace font with `tabular-nums`.

## Security · الأمان

- Read-only: no trading, no workflow execution, no remote commands. The execution agent and profit-split vault are display-only and gated on explicit approval.
- No credentials anywhere in the file; requests use `credentials: "omit"`.
- Network text is never inserted as HTML (`textContent` only).
- Future write actions go through an authenticated local gateway (spec section 5), not this page.
