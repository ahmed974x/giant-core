# OMEGA · Pre-Cog Syndicate

One local stack: market memory, anomaly detection, a live 3D constellation, and Telegram alerts.
Everything binds to `127.0.0.1`; only n8n talks to the internet (Binance + Telegram).

```
Binance ─▶ n8n (every minute) ─▶ Timescale: market.ingest()  ──▶ anomalies
                │                          │
                ├─ pulse / anomaly ─▶ relay ◀── PostgREST (read-only api.* views)
                │                      │
                └─ Telegram            └─▶ Neural Constellation  http://localhost:8088
```

| Service | What it does | Port |
|---|---|---|
| `timescale` | 1-minute candles (hypertable, compressed after 7d, kept 365d) + SQL anomaly rules | internal |
| `postgrest` | Read-only API over `api.latest`, `api.candles`, `api.candles_5m`, `api.anomalies` | internal |
| `n8n` | *OMEGA · Market Sentinel* workflow, seeded and activated on first boot | 5678 |
| `relay` | Token-checked inbox for n8n, SSE stream, `/api` proxy, serves the dashboard | 8088 |
| `workstation` | Giant Core Streamlit app (`--profile workstation`) | 8501 |

## Run

```sh
cp .env.example .env          # fill every secret: openssl rand -hex 32
docker compose up -d          # add --profile workstation for the Streamlit app
open http://localhost:8088    # the constellation; n8n editor at http://localhost:5678
```

The first run back-fills ~16 hours of candles, so the z-score rules arm within minutes.
Opening `dashboard/index.html` straight from disk (or adding `?demo`) runs it on simulated data.

## Anomaly rules

All in SQL (`db/init/01-sentinel.sh`), evaluated on each pair's newest closed candle. Thresholds live in the
`market.thresholds` table, so tuning is an `UPDATE`, not a redeploy:

| Rule | Fires when | High when |
|---|---|---|
| `price_shock` | 1-min log return \|z\| ≥ 4 vs the last 24h (needs 60 samples) | \|z\| ≥ 6 |
| `volume_spike` | volume ≥ 5× the 24h mean and z ≥ 4 | ≥ 10× |
| `drawdown_1h` | close ≤ −2% below the 1h high | ≤ −4% |

The same pair + rule stays quiet for 30 minutes after firing. Every rule that fires in one minute
reaches Telegram as **one** message per pair.

```sql
-- example: make volume spikes less chatty
UPDATE market.thresholds SET value = 8 WHERE key = 'volume_mult';
```

## Telegram

1. Create a bot with @BotFather and copy the token.
2. Message the bot once, then read your chat id from `https://api.telegram.org/bot<TOKEN>/getUpdates`.
3. Put both in `.env`, then re-seed n8n:
   `docker compose run --rm -e OMEGA_RESEED=1 n8n-init && docker compose restart n8n`

Until both values are set the Telegram node stays disabled and everything else runs.

## Adding a pair

Add it to `SYMBOLS` in the n8n *Plan requests* node **and** to `OMEGA_SYMBOLS` in `.env`
(the relay rejects anything not on that list), then `docker compose up -d relay`.

## Security notes

- n8n can only `EXECUTE market.ingest()`; it cannot read or alter tables directly.
- PostgREST serves only the `api` views, as a role with `SELECT` on them and nothing else.
- The relay validates every payload against a strict schema before it reaches a browser.
- `timescale` and `postgrest` sit on internal networks with no route out.
