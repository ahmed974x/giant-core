# OMEGA Sentinel (MCP bundle)

Gives Claude Desktop a read-only view of the OMEGA Market Sentinel running on your machine.
Packaged as a single `.mcpb` file: drag it onto Claude Desktop, nothing else to install.

| Tool | What Claude gets |
|---|---|
| `sentinel_market_snapshot` | Latest price, 1h / 24h % change, 24h volume per tracked pair |
| `sentinel_list_alerts` | Price shocks, volume spikes and 1h drawdowns, filter by pair / severity / kind / window |
| `sentinel_price_history` | Open, close, % change, high, low, max drawdown and a compressed price curve for one pair |
| `sentinel_system_status` | Health of relay, n8n, PostgREST and Timescale |

Prompt `market_brief` chains them into a short briefing.

## How it fits

```
Claude Desktop ──stdio──▶ omega-sentinel ──HTTP GET──▶ relay :8088 ──▶ PostgREST ──▶ Timescale
```

It needs the OMEGA stack (`docker compose up -d`, see the Market Sentinel stack) to be running.
It only calls the relay's existing read endpoints (`/api/latest`, `/api/anomalies`, `/api/candles*`, `/status`).

## Security

- Every tool is read-only (`readOnlyHint`); there is no write, order or delete path.
- Refuses to start unless `OMEGA_URL` is `http(s)://127.0.0.1` or `localhost`, so it cannot be pointed at another host.
- Pair symbols are validated (`^[A-Z0-9]{5,20}$`) before any request; query strings are built, never concatenated.
- No secrets: the relay's read API is unauthenticated on loopback, so the bundle holds no keys.
- Responses capped at 2 MB, requests time out after 8 s.

## Install (Windows)

1. Get `omega-sentinel.mcpb`: from the **omega-sentinel** GitHub Actions run (artifact), or build it yourself below.
2. Claude Desktop → Settings → Extensions → drag the file in (or double-click it) → Install.
3. Leave the URL as `http://127.0.0.1:8088` unless you changed the relay port.
4. Ask: "Use OMEGA Sentinel: what fired in the last 6 hours?"

## Develop

```bash
cd mcp/omega-sentinel
npm ci
npm test          # builds, then runs the bundle against a fake relay
npm run pack      # validates manifest.json and writes dist/omega-sentinel.mcpb
```

Source is `src/`; `server/index.js` is the esbuild bundle and is not committed.
