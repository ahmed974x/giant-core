# OMEGA · Pre-Cog Syndicate

One local stack: market memory, anomaly detection, on-chain whale tracking, a news sentiment feed, a live
3D constellation, Telegram alerts, and the Cortex LLM gateway (Claude + free tiers). Everything binds to
`127.0.0.1`; only n8n (Binance, news feeds, public Bitcoin/Ethereum endpoints, Telegram), cortex (LLM
providers) and ollama (model pulls) talk to the internet.

```
Binance ──────────▶ n8n (every minute) ─▶ Timescale: market.ingest() ──▶ anomalies
BTC + ETH blocks ─▶ n8n (every minute) ─▶ Timescale: chain.ingest()  ──▶ whales ≥ $50M
                          │                          │
                          ├─ pulse / anomaly / whale ─▶ relay ◀── PostgREST (read-only api.* views)
                          │                              │
                          └─ Telegram                    └─▶ Neural Constellation  http://localhost:8088

RSS feeds + Fear & Greed ─▶ n8n (every 10 min) ─▶ news.ingest() ─▶ Cortex scores ─▶ news.score() ─▶ relay + Telegram
```

| Service | What it does | Port |
|---|---|---|
| `timescale` | 1-minute candles (hypertable, compressed after 7d, kept 365d) + SQL anomaly rules | internal |
| `postgrest` | Read-only API over `api.latest`, `api.candles`, `api.candles_5m`, `api.anomalies` | internal |
| `n8n` | *Market Sentinel*, *News Sentiment* and *Whale Watch BTC / ETH* workflows, seeded and activated on first boot | 5678 |
| `relay` | Token-checked inbox for n8n, SSE stream, `/api` proxy, serves the dashboard | 8088 |
| `ollama` | Open-source local LLM runtime (MIT); pulls `OMEGA_LOCAL_MODEL` once, then runs offline | internal |
| `cortex` | LLM gateway: Claude + free tiers behind one OpenAI-compatible API, failover, performance memory | 8089 |
| `workstation` | Giant Core Streamlit app (`--profile workstation`) | 8501 |

## Layout

```
services/
  relay/         doorway: SSE stream, /api proxy, serves the Ops Room dashboard
  cortex/        LLM gateway (Node), providers in config/providers.json
  workstation/   Giant Core Streamlit app + local plugin engine
  agents/        workforce: Sentinel, Analyst, Scout (proposals wait for your Add / Skip)
  neural/        PyTorch forecaster (--profile ml)
  cloud-sync/    Supabase mirror (--profile cloud)
  quant/         OMEGA Quant: stdlib risk engine (volatility, regime, z-score, tail odds, correlation)
  studio/        OMEGA Studio: Panel + Material UI analytics app + DuckDB vault (--profile studio, port 5006)
dashboard/       the Ops Room (one self-contained index.html) + plugins.json (generated)
db/              Timescale init + migrate scripts
n8n/             workflows (Market Sentinel, News Sentiment, Whale Watch) + seeder
mcp/             MCP servers (omega-sentinel)
plugins/         the plugin registry: one folder + plugin.json per capability (see plugins/README.md)
scripts/         omega_ignition.bat (one-click start), plugins.py (validate + publish the registry)
ops/             machine setup: wslconfig.example (Docker VM memory cap)
docs/            handover notes, SECURITY.md (exposure, protections, checks)
.claude/skills/  Claude skills used on this repo
```

New tools, workflows, skills and MCP servers are added as plugins: copy `plugins/_template/`, fill
`plugin.json`, run `python scripts/plugins.py`. They then appear in the dashboard's **Modules** panel.

## Run

```sh
cp .env.example .env          # fill every secret: openssl rand -hex 32
docker compose up -d          # core stack (~1.5 GB RAM); add --profile llm for the local model
open http://localhost:8088    # the Ops Room; n8n editor at http://localhost:5678
```

Or double-click `scripts\omega_ignition.bat`: it checks free RAM first, refuses to start when the
machine is short, and boots the stack from the branch you have checked out.

### OMEGA Studio (Panel)

Deep analysis built with [HoloViz Panel](https://panel.holoviz.org/) + Panel Material UI + hvPlot:
KPIs, price with anomaly markers, hourly volume, headline sentiment and sortable anomaly / whale /
news tables for one pair over 6 h, 24 h or 48 h. It reads the relay's read-only `/api`, refreshes every
minute, and falls back to simulated data when the stack is down.

```sh
docker compose --profile studio up -d          # http://localhost:5006  (STUDIO ↗ in the Ops Room header)
# without Docker:
python -m venv services/studio/.venv && services/studio/.venv/Scripts/pip install -r services/studio/requirements.txt
services/studio/.venv/Scripts/panel serve services/studio/app.py --port 5006
services/studio/.venv/Scripts/python -m pytest services/studio
```

The official HoloViz agent skills (`panel`, `panel-material-ui`, `hvplot`, `param`) live in
`.claude/skills/` so Claude follows Panel's own best practices when extending the Studio.

### OMEGA Quant (stdlib) and the DuckDB vault

`quant` reads the 5-minute candles every minute and computes, with [stdlib](https://stdlib.io/)'s
incremental accumulators: realised and EWMA volatility (RiskMetrics λ 0.94, annualised), a
calm / normal / turbulent regime, the newest return's z-score against the last 24 h with its two-sided
normal tail probability, 1 h / 6 h / 24 h momentum, max drawdown and the return correlation of every pair.
The relay serves it at `/quant`; the Ops Room shows it in the **Quant** panel. ~40 MB RAM, no ports.

The Studio keeps a [DuckDB](https://duckdb.org/) vault (`/data/omega.duckdb` in the `vault_data`
volume): every 5 minutes it upserts the live candles, anomalies, whales and headlines, so history
outlives the views' 48 h / 30 day windows. The **History · DuckDB vault** tab rolls it up per day
(OHLC, volatility, anomalies, net whale flow into exchanges, news mood). DuckDB runs inside the Studio
process: no server, no RAM when idle. Demo data never touches the file.

Adding a metric, view, table or service: follow `.claude/skills/omega-extend/SKILL.md`.

### The Brain: the search bar

Type anything in the Ops Room's search bar: a question, a design, or a change to the site or app.
Six agents work on it in turn and build on each other's output, lighting up on the spider web as they think:
**Memory** (recalls earlier requests and lessons, SQLite full-text search) → **Planner** (ask / design /
change, plan, research questions) → **Researcher** (live system, memory, GitHub with awesome-list trust)
→ **Designer** → **Critic** (security, RAM cost, gaps, one lesson to remember) → **Synthesizer**.
Thinking runs on the `omega/open` route: open-weight models (gpt-oss, Nemotron, Qwen, Gemma, GLM, Llama)
on free tiers, then the local model. Every answer and lesson is stored, so the Brain gets better with use.
It proposes; it never edits the site by itself. Without any model it says so and returns the evidence it found.

### Workforce: agents that work in the background

`agents` (standard-library Python, ~30 MB) runs three agents and shows them in the Ops Room's
**Agents** panel:

| Agent | Every | Does |
|---|---|---|
| Sentinel | 2 min | checks every node, reports outages and recoveries |
| Analyst | 15 min | turns Quant + Neural + anomalies into a 3-sentence brief (through Cortex; plain facts without it) |
| Scout | 24 h | searches GitHub (Python, Scala, time-series, dataframes, ML, agents) for trusted tools: OSI license, active in the last 180 days, not archived, relevant to forecasting / data / models; scores trust + fit and flags JVM cost |

The Scout never installs anything. Each find waits under **Proposals · your call** with **Add** / **Skip**;
an answer is recorded and never asked again. Adding an approved tool is then a normal plugin step.

### Neural forecaster (PyTorch) and the Supabase mirror

- `--profile ml`: a ~1.5k-parameter PyTorch net estimates next-hour up-probability and volatility,
  calibrated and scored walk-forward against naive baselines (relay `/neural`). Research signal, not advice.
- `--profile cloud`: apply `supabase/migrations/*.sql` to a Supabase project, put `SUPABASE_URL` and
  `SUPABASE_SECRET_KEY` in `.env`; `cloud-sync` mirrors anomalies, whales, news and engine snapshots to
  `public.omega_*` (RLS: signed-in read, no client writes; Realtime on anomalies and whales).

### Code quality & security gate

One command checks (and fixes) every language in the repo:

```sh
# install once
python -m venv tools-quality/.venv && tools-quality/.venv/Scripts/pip install -r tools-quality/requirements.txt
(cd tools-quality && npm ci)

scripts/quality.sh            # check: Ruff (Python) + Biome (JS/TS) lint + security, secret scan, plugin validation
scripts/quality.sh --fix      # apply every safe autofix first
```

- **Ruff** (`ruff.toml`) lints Python with import ordering, pyupgrade, bugbear, comprehension and **bandit security** rules; URL opens are scheme-checked, SQL identifiers allow-listed, and the one sandboxed subprocess is documented.
- **Biome** (`biome.json`) lints JS/TS with its security rules (no `eval`, no `dangerouslySetInnerHTML`); deliberate patterns (the relay's control-char input filter) are annotated, not disabled.
- The gate also fails on a committed `.env` or any secret-shaped string, and validates every `plugin.json`.

### CI

`.circleci/config.yml` runs every suite (relay, cloud-sync, n8n, quant, cortex, MCP, agents, Studio,
neural), `npm audit`, a committed-secrets check and `docker compose config` for every profile.
Enable it once in CircleCI (Set Up Project → giant-core → use existing config).

### Low-RAM laptops (7–8 GB)

The stack is tuned for a 7 GB laptop after a Docker + local-LLM overload froze one:

- Copy `ops/wslconfig.example` to `%UserProfile%\.wslconfig` and run `wsl --shutdown`. This caps the
  whole Docker VM at 4 GB RAM and 2 CPUs, whatever the containers do.
- Every service has a hard `mem_limit` and `cpus`. Raise one with `TIMESCALE_MEM_LIMIT`,
  `N8N_MEM_LIMIT`, `OLLAMA_MEM_LIMIT`, `OLLAMA_CPUS` in `.env`.
- The local model (`ollama`) is opt-in: `docker compose --profile llm up -d`. It never restarts on its
  own and unloads after 5 idle minutes. Without it, Cortex uses the cloud tiers you have keys for.
- Docker Desktop's "Start when you sign in" stays off; start it only when you need the stack.
- The dashboard's **LITE** button stops the 3D animation (it already caps itself at 30 fps).
- Stop everything with `docker compose down` (data stays in the volumes).

The first run back-fills ~16 hours of candles, so the z-score rules arm within minutes.
Opening `dashboard/index.html` straight from disk (or adding `?demo`) runs it on simulated data.

## Upgrading

```sh
git pull
docker compose up -d                  # db-migrate adds new tables, n8n-init seeds new workflows
docker compose restart relay n8n      # the relay loads its code, and n8n its workflows, at start
```

Postgres runs `db/init/*` only when it creates an empty volume, so on every `up` the one-shot
`db-migrate` service runs those scripts against the existing volume. Each one skips itself once its
schema exists, so on a current stack it changes nothing (`docker compose logs db-migrate` shows what
it did). `n8n-init` remembers each workflow it seeded (`.omega-seeded-<id>` in the n8n volume) and
imports only the ones it hasn't seen; when it does, it also refreshes the OMEGA credentials from
`.env`. Your edits to already-seeded workflows are kept.

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

## Whale Watch

Tracks on-chain transfers and sends only those worth **$50M or more** to the constellation's Whale Stream.
Every source is free and needs no key.

| Chain | What is read | Source (override in `.env`) | Latency |
|---|---|---|---|
| Bitcoin | every confirmed block | `OMEGA_BTC_API` = blockchain.info | one block, about 10 min |
| Ethereum | native ETH + USDT, USDC, WETH, WBTC, stETH `Transfer` logs | `OMEGA_ETH_RPC_URL` = publicnode (any batch-capable JSON-RPC) | about 1 min (head − 3) |

How a transfer is judged (all in SQL, `db/init/04-whale-watch.sh`):

- **Bitcoin amount** = outputs that do not go back to one of the transaction's own input addresses, so change
  and self-consolidations don't count.
- **USD value** = amount × the Market Sentinel's BTCUSDT / ETHUSDT close at block time (stablecoins = $1).
  Whale Watch waits until those prices exist, so keep both pairs in `OMEGA_SYMBOLS`.
- **Verdict** comes from the `chain.entities` address book: `to_exchange` (sell pressure), `from_exchange`
  (accumulation), `exchange_shuffle`, `mint` / `burn`, `issuer_out`, or `unknown`. Same entity on both sides
  is `internal`: stored, never alerted.
- **Severity high** for exchange in/out flows, mints and issuer releases, or anything ≥ $250M.
  High alerts also go to Telegram.

Knobs live in `chain.thresholds` (`whale_usd_min`, `whale_usd_high`, `store_usd_min`, feed stall limits).
Transfers ≥ $5M are kept in `chain.transfers` for a year so hit-rates can be measured later.

**Labels are the whole game.** The seed address book is a dozen well-known exchange wallets; until it grows,
many alerts read "unknown". Add wallets as you learn them:

```sql
INSERT INTO chain.entities (chain, address, entity, kind, source)
VALUES ('eth', lower('0xYourAddress'), 'Bybit', 'exchange', 'manual');   -- ETH addresses lowercase
```

A paid label feed (Whale Alert, Arkham) would fill this in bulk; nothing else in Whale Watch needs paying for.

Already running an older stack? See [Upgrading](#upgrading); `db-migrate` adds the `chain` schema and
n8n-init seeds the two Whale Watch workflows.

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

Already running an older stack? See [Upgrading](#upgrading).

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
of quota. Opt-in with `--profile llm`. Default `llama3.2:3b` (~2 GB download, capped at 2.5 GB RAM, CPU is fine); pick any model from
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

**Editing providers.** `services/cortex/config/providers.json` holds providers, models and routes. Edit it, then
`docker compose kill -s HUP cortex`. Claude's model and effort come from `CLAUDE_MODEL` / `CLAUDE_EFFORT`.
Claude calls go through the official Anthropic SDK with server-side refusal fallback enabled.

**Privacy.** Gemini, Mistral and OpenRouter free tiers may use prompts for training; the keyless
providers (LLM7, OVHcloud, Kilo) may log them and stay off unless `OMEGA_ALLOW_ANON_PROVIDERS=true`.
Send sensitive work through `claude` or `omega/smart`.

Already running an older stack? See [Upgrading](#upgrading).

## Security notes

- n8n can only `EXECUTE market.ingest()`, `news.ingest()`, `news.score()`, `news.store_fear_greed()`,
  `chain.plan()` and `chain.ingest()`; it cannot read or alter tables directly.
- PostgREST serves only the `api` views, as a role with `SELECT` on them and nothing else.
- The relay validates every payload against a strict schema before it reaches a browser.
- `timescale` and `postgrest` sit on internal networks with no route out.
- Cortex writes only through `api.log_llm_calls()`, as a role it reaches with a short-lived JWT signed
  by `PGRST_JWT_SECRET`; the browser can't call it (the relay never proxies it, and `web_anon` has no
  `EXECUTE`). The gateway token stays in the relay; the console endpoint refuses cross-origin posts.
