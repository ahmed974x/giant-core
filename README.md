# OMEGA · Pre-Cog Syndicate

One local stack: market memory, anomaly detection, a live 3D constellation, Telegram alerts, and the
Cortex LLM gateway (Claude + free tiers). Everything binds to `127.0.0.1`; only n8n (Binance + Telegram)
and cortex (LLM providers) talk to the internet.

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
| `cortex` | LLM gateway: Claude + free tiers behind one OpenAI-compatible API, failover, performance memory | 8089 |
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

## Cortex: LLM gateway

One OpenAI-compatible endpoint over Claude and the permanent free tiers curated from
[awesome-free-llm-apis](https://github.com/mnfst/awesome-free-llm-apis). A provider switches on when its
key is in `.env`; nothing else to configure. The dashboard's **CORTEX** panel shows every provider's
live state and 24h performance, and has a console that talks to the gateway through the relay.

| Route (`model`) | Chain | Spends money? |
|---|---|---|
| `omega/fast` (or `auto`) | Groq → Cloudflare → Gemini Flash → Mistral Small → NVIDIA → Z AI → Ollama → OpenRouter → keyless | never |
| `omega/smart` | **Claude** (`claude-opus-5-5`) → Gemini Pro → Nemotron Ultra → Mistral Medium → … | Claude only |
| `omega/free-smart` | the strongest free models only | never |
| `claude` | Claude only | yes |
| `provider:model` | that one model, e.g. `groq:openai/gpt-oss-120b` | depends |

```sh
curl localhost:8089/v1/chat/completions -H "Authorization: Bearer $OMEGA_GATEWAY_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"model":"omega/fast","messages":[{"role":"user","content":"One-line BTC risk summary"}]}'
```

Any OpenAI SDK works: `base_url=http://localhost:8089/v1`, `api_key=$OMEGA_GATEWAY_TOKEN`. Inside the
stack (n8n) the address is `http://cortex:8090/v1`. Each answer carries an `omega` block with the
provider that served it, total latency, and every failover attempt.

**Failover.** A 429 benches that provider for its `retry-after` (or 60s), a bad key or retired model
for 30 min, a timeout or 5xx for 30s, and the request moves down the chain. Client-side per-minute
ceilings keep each provider under its published free limit.

**Performance memory.** Every attempt lands in Timescale (`llm.calls`: provider, model, route, outcome,
latency, tokens; never the prompt or the answer). Read it at `/api/llm_perf` (24h per model: success
rate, p50/p95, tokens/s), `/api/llm_perf_1h`, `/api/llm_calls`. The `omega/fast` and
`omega/free-smart` routes re-rank themselves from it every minute: fastest reliable model first, with
10% of traffic kept in configured order so newcomers get measured.

**Editing providers.** `gateway/config/providers.json` holds providers, models and routes. Edit it, then
`docker compose kill -s HUP cortex`. Claude's model and effort come from `CLAUDE_MODEL` / `CLAUDE_EFFORT`.
Claude calls go through the official Anthropic SDK with server-side refusal fallback enabled.

**Privacy.** Gemini, Mistral and OpenRouter free tiers may use prompts for training; the keyless
providers (LLM7, OVHcloud, Kilo) may log them and stay off unless `OMEGA_ALLOW_ANON_PROVIDERS=true`.
Send sensitive work through `claude` or `omega/smart`.

Already running an older volume? Add the performance tables once:
`docker compose exec timescale sh /docker-entrypoint-initdb.d/02-cortex.sh`

## Security notes

- n8n can only `EXECUTE market.ingest()`; it cannot read or alter tables directly.
- PostgREST serves only the `api` views, as a role with `SELECT` on them and nothing else.
- The relay validates every payload against a strict schema before it reaches a browser.
- `timescale` and `postgrest` sit on internal networks with no route out.
- Cortex writes only through `api.log_llm_calls()`, as a role it reaches with a short-lived JWT signed
  by `PGRST_JWT_SECRET`; the browser can't call it (the relay never proxies it, and `web_anon` has no
  `EXECUTE`). The gateway token stays in the relay; the console endpoint refuses cross-origin posts.
