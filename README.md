# OMEGA · Pre-Cog Syndicate

One local stack: market memory, anomaly detection, a news sentiment feed, a live 3D constellation,
Telegram alerts, and the Cortex LLM gateway (Claude + free tiers). Everything binds to `127.0.0.1`; only
n8n (Binance, news feeds, Telegram), cortex (LLM providers) and ollama (model pulls) talk to the internet.

```
Binance ─▶ n8n (every minute) ─▶ Timescale: market.ingest()  ──▶ anomalies
                │                          │
                ├─ pulse / anomaly ─▶ relay ◀── PostgREST (read-only api.* views)
                │                      │
                └─ Telegram            └─▶ Neural Constellation  http://localhost:8088

RSS feeds + Fear & Greed ─▶ n8n (every 10 min) ─▶ news.ingest() ─▶ Cortex scores ─▶ news.score() ─▶ relay + Telegram
```

| Service | What it does | Port |
|---|---|---|
| `timescale` | 1-minute candles (hypertable, compressed after 7d, kept 365d) + SQL anomaly rules | internal |
| `postgrest` | Read-only API over `api.latest`, `api.candles`, `api.candles_5m`, `api.anomalies` | internal |
| `n8n` | *OMEGA · Market Sentinel* and *OMEGA · News Sentiment* workflows, seeded and activated on first boot | 5678 |
| `relay` | Token-checked inbox for n8n, SSE stream, `/api` proxy, serves the dashboard | 8088 |
| `ollama` | Open-source local LLM runtime (MIT); pulls `OMEGA_LOCAL_MODEL` once, then runs offline | internal |
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

## News sentiment

Every 10 minutes the *OMEGA · News Sentiment* workflow reads six free, keyless crypto feeds (CoinDesk,
Cointelegraph, Decrypt, The Block, Bitcoin Magazine, CryptoSlate) and the
[Crypto Fear & Greed index](https://alternative.me/crypto/fear-and-greed-index/). New headlines land in
Timescale (deduped by URL), then one Cortex call on the free `omega/fast` route scores the batch:

| Field | Meaning |
|---|---|
| `sentiment` | −1 very bearish … +1 very bullish, for the coins it names (or the whole market) |
| `relevance` | 0 … 1, how much it matters to crypto prices at all |
| `impact` | `low`, `medium`, or `high` (ETF and rate decisions, major hacks, exchange failures, regulation) |
| `symbols` | tickers it is about (`BTC`, `ETH`, …); empty = market-wide |

Anything the model skips or garbles, and everything when the Cortex is unreachable, gets a keyword score
instead (`scored_by = 'lexicon'`), so the feed never stalls. Headlines are treated as untrusted input:
the prompt says so, and every field the model returns is validated and clamped in n8n and again in SQL.

The dashboard's **NEWS MOOD** panel shows the market's 24h mood, each pair's mood, Fear & Greed with its
30-day line, and the latest scored headlines. High-impact news with a clear direction (impact `high`,
\|sentiment\| ≥ 0.5, relevance ≥ 0.6) also goes to Telegram, one message per run.

| View | What it holds |
|---|---|
| `/api/news` | scored headlines, last 7 days |
| `/api/sentiment_now` | per scope (`MARKET`, `BTC`, …): 24h and 6h mood, the prior 24h, bullish/bearish/high-impact counts |
| `/api/sentiment_1h` | hourly mood per scope, last 7 days |
| `/api/fear_greed` | daily index, last 90 days |
| `/api/sentiment_vs_price` | each hour's mood next to the **following** hour's price return per pair |

Mood is a weighted mean: each headline counts by relevance × impact (low 1, medium 2, high 3).
`sentiment_vs_price` is there to measure whether the mood leads price before anything trades on it:

```sql
SELECT symbol, corr(score, next_1h_return_pct), count(*) FROM api.sentiment_vs_price
WHERE next_1h_return_pct IS NOT NULL GROUP BY symbol;
```

**Tuning.** Feeds live in the n8n *Feeds* node, the route in *Build prompt* (`omega/smart` puts Claude
first and costs money; `omega/local` keeps headlines on the machine), the Telegram bar in *Format Telegram*.

Already running an older volume? Add the news tables and the new workflow once:
```sh
docker compose exec timescale sh /docker-entrypoint-initdb.d/03-news.sh
docker compose run --rm n8n-init
docker compose up -d && docker compose restart n8n relay
```
(The seeder imports only workflows a volume hasn't seen yet, and refreshes credentials from `.env`.)

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
| `omega/local` | the open-source model inside the stack; nothing leaves the machine | never |
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

**Local open-source model.** [Ollama](https://github.com/ollama/ollama) (MIT) runs an open-weight model
inside the stack and closes every chain, so Cortex still answers when every cloud tier is down or out
of quota. Default `llama3.2:3b` (~3 GB RAM, CPU is fine); pick any model from
[ollama.com/library](https://ollama.com/library) with `OMEGA_LOCAL_MODEL` and give it RAM with
`OLLAMA_MEM_LIMIT`. The first `up` downloads it once (`ollama-pull`); until it lands, the local link is
skipped for 30s at a time. Leave `OMEGA_LOCAL_LLM_URL` empty to switch it off.

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

- n8n can only `EXECUTE market.ingest()`, `news.ingest()`, `news.score()` and `news.store_fear_greed()`;
  it cannot read or alter tables directly.
- PostgREST serves only the `api` views, as a role with `SELECT` on them and nothing else.
- The relay validates every payload against a strict schema before it reaches a browser.
- `timescale` and `postgrest` sit on internal networks with no route out.
- Cortex writes only through `api.log_llm_calls()`, as a role it reaches with a short-lived JWT signed
  by `PGRST_JWT_SECRET`; the browser can't call it (the relay never proxies it, and `web_anon` has no
  `EXECUTE`). The gateway token stays in the relay; the console endpoint refuses cross-origin posts.
