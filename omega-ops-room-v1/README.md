# OMEGA Ops Room v1 · غرفة العمليات

Local-first, read-only operations dashboard. One file, no backend, no build step, no framework, no keys, no trading.

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

Each widget catches its own errors, so one dead source never blocks the others. If BTC drops after a good reading, the last price stays on screen, dimmed.

## Newton gate · بوابة نيوتن

The gate opens only when the browser actually reads `/api/health` and it returns `"ok": true`. Any future Newton task must `await window.OMEGA.requireNewton()` first; it re-checks if the last result is older than one cycle.

**Known limitation:** Newton's current `http_api.py` sends no `Access-Control-Allow-Origin` header, so a browser page cannot read its health reply. The dashboard detects this ("port answers, gate stays closed") instead of showing a false READY. To open the gate, Newton's `/api/health` response needs `Access-Control-Allow-Origin` set to the dashboard origin (e.g. `http://127.0.0.1:8787`, or `null` for a double-clicked file). n8n has the same limitation; for n8n the dashboard shows ONLINE / "port responding", which is enough for a status light.

## Security · الأمان

- Read-only: no trading, no workflow execution, no remote commands.
- No credentials anywhere in the file; requests use `credentials: "omit"`.
- Network text is never inserted as HTML (`textContent` only).
- Future write actions go through an authenticated local gateway (spec section 5), not this page.
