# OMEGA PRIME — Global Logistics & Market Analytics Platform

_Architecture v1.2 — bilingual (Arabic/English) edition._

**A unified dashboard that correlates public logistics data, geopolitical events and financial markets, built entirely on free and open-source software and free-tier public data.**

## Scope and boundaries

OMEGA PRIME aggregates **only publicly broadcast, free, or open-licensed data** and uses it for market and logistics analysis. In scope: commercial vessel positions (AIS), civil aircraft positions (ADS-B), open satellite imagery, commodity and currency prices, public news, and public hazard alerts. Out of scope, and not built: accessing cameras, Wi-Fi networks or systems the operator does not own; identifying or tracking individuals; and tracking military or defense assets. Civil ADS-B feeds already withhold sensitive/military aircraft, and we keep that filtering. Every data source below is used within its published terms of service and rate limits.

This document is the north-star design. Much of Phase 1–2 and Phase 4 already exists in this repository (see **Mapping to the current codebase**); Phases for geospatial and the 4-screen frontend are the new build.

---

## 1. High-level system architecture

```
                              ┌─────────────────────────── EDGE (127.0.0.1 only) ───────────────────────────┐
  PUBLIC OPEN DATA            │                                                                              │
  (free / free-tier)         │     ┌──────────────┐        WebSocket + SSE        ┌───────────────────┐     │
                             │      │   Gateway /  │◀──────────────────────────────│  Web dashboard    │     │
  AIS  (aisstream.io ws) ─┐   │     │   Relay      │                                │  (4 screen modules)│    │
  ADS-B (OpenSky REST) ───┤   │     │  (Node)      │────────── REST /api ──────────▶│  MapLibre/Deck/   │     │
  NASA GIBS / Copernicus ─┤   │     │  rate-limit, │                                │  Cesium · Recharts │    │
  Prices (exchange APIs) ──┼──▶ INGEST  CSP, authz  │                               └───────────────────┘     │
  News RSS + Fear&Greed ──┤   │     └──────┬───────┘                                ┌───────────────────┐     │
  USGS / GDACS alerts ────┘   │            │                                        │  Mobile app (PWA) │     │
                              │            │                                        └───────────────────┘     │
  ┌──────────────────────────┼────────────┼──────────────────────────────────────────────────────────┐      │
  │  INGEST LAYER (Docker, MCP servers + n8n)          CORE (internal networks, no internet)           │      │
  │                                                                                                    │      │
  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    ┌──────────────┐   ┌──────────────┐          │      │
  │  │ mcp-ais     │  │ mcp-adsb    │  │ mcp-markets │    │ PostgreSQL   │   │ Redis        │          │      │
  │  │ mcp-news    │  │ mcp-geo     │  │ mcp-alerts  │───▶│ + PostGIS    │◀─▶│ cache +      │          │      │
  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘    │ + TimescaleDB│   │ pub/sub      │          │      │
  │         └────────────────┴────────────────┘          └──────┬───────┘   └──────────────┘          │      │
  │                       │                                     │                                      │      │
  │                 ┌─────▼──────┐   ┌──────────┐   ┌──────────▼──┐  ┌──────────┐  ┌──────────────┐    │      │
  │                 │ PostgREST  │   │  Cortex  │   │  Quant      │  │  Neural  │  │  Agents +    │    │      │
  │                 │ read-only  │   │  LLM gw  │   │  (stdlib)   │  │ (PyTorch)│  │  Brain       │    │      │
  │                 │ api views  │   │  failover│   │  risk/corr  │  │ forecast │  │  (OSINT hub) │    │      │
  │                 └────────────┘   └────┬─────┘   └─────────────┘  └──────────┘  └──────────────┘    │      │
  │                                        │  open-weight models first (gpt-oss, Nemotron, Qwen…)       │      │
  └────────────────────────────────────────┼─────────────────────────────────────────────────────────┘      │
                                            │  optional cloud mirror (Supabase, RLS + Realtime)               │
                                            ▼                                                                  │
                                   ┌────────────────┐                                                          │
                                   │  Local LLM     │  (Ollama, opt-in, closes every chain, private)          │
                                   └────────────────┘                                                          │
                              └───────────────────────────────────────────────────────────────────────────────┘

Egress to the internet: only the ingest MCP servers, Cortex (LLM providers) and the cloud mirror.
Databases and read APIs sit on internal Docker networks with no route out. Everything binds to 127.0.0.1.
```

**Design principles**

- **Zero-trust between layers.** The browser never holds a provider token; it talks only to the relay, same-origin, over a strict CSP. The relay holds secrets and proxies. Databases are unreachable from the internet. Each service runs with `cap_drop: ALL`, a read-only root FS, a non-root user and hard `mem_limit`/`cpus` (this runs on a 7 GB laptop; heavy services are opt-in compose profiles).
- **In-process over new servers** where it fits (DuckDB vault, stdlib accumulators, SQLite inboxes) to keep the resident footprint small; PostgreSQL/PostGIS and Redis are the two servers worth their RAM.
- **Everything is a plugin.** New feeds, models, skills and panels register in `plugins/*/plugin.json` and appear in the dashboard's Modules panel.

---

## 1b. Internationalization (bilingual Arabic / English, RTL + LTR)

OMEGA PRIME is bilingual from the schema up, so RTL is a first-class case, not a retrofit.

**Frontend.** The Phase-3 SPA uses **Next.js + `next-intl`** (web) and **React Native + `react-i18next`**
(mobile). The active locale sets `dir="rtl"` for Arabic and `dir="ltr"` for English on `<html>`, and all
spacing uses **CSS logical properties** (`margin-inline`, `padding-inline-start`, `inset-inline`) so the
layout mirrors automatically — no duplicated RTL stylesheets. Styling is **Tailwind CSS** (from
[github.com/topics/css](https://github.com/topics/css); its `rtl:`/`ltr:` variants and logical utilities
make bidirectional UIs clean). Fonts: **Cairo** or **Tajawal** for Arabic, **Inter** for English, served
self-hosted (not via a CDN, so the strict CSP holds). One header button toggles the language on every screen
and persists the choice.

**API.** Every endpoint resolves the language from an explicit `?lang=` or the `Accept-Language` header
(`ar` | `en`, English default) and returns the localized field plus the raw `*_i18n` map for clients that
want both. This is already live in `services/geo-api`.

**Database.** Translatable text is stored as JSONB (`name_i18n: {"en": …, "ar": …}`), validated so both
languages are present, and indexed for bilingual full-text search (the `'simple'` config handles both
scripts). Live in `db/geo/01-postgis.sql`.

**AI (the Brain / Master agent).** The orchestrator detects the query language, handles **mixed-language**
queries (e.g. "Analyze oil shipments in هرمز" — English intent, Arabic entity) by extracting entities in
either script and routing them to the right agents, and replies in the user's UI language. It runs on the
`omega/open` route (multilingual open-weight models: Qwen, Gemma, Llama, Nemotron), with the local model as
the private fallback.

## 2. The four screen modules

Each screen is a module in one SPA (Vite + a light framework). The map screens lazy-load their engines so the other three stay light. Every screen flips between Arabic (RTL) and English (LTR) from one header button, using logical CSS so layout mirrors automatically.

### Screen 1 — Company / Operations (the "partner" screen)

Overview of the platform itself and the organisation's own logistics interests: watchlists, saved routes/ports/tickers, the health of every service, and the day's headline correlations.

| Concern | FOSS library | Why |
|---|---|---|
| Layout / components | **Panel + Panel Material UI** (already in `services/studio`) or **React + shadcn/ui** | consistent dark theme, accessible |
| KPI tiles, sparklines | **Recharts** (MIT) or **uPlot** (MIT) | uPlot for thousands of points at low CPU |
| Service health | existing relay `/status` + **Dockerode**-sourced stats | reuse |
| Tables | **TanStack Table** (MIT) / **Tabulator** (MIT) | sortable, virtualised |

### Screen 2 — Market Analytics & Correlation Engine

Commodity prices (oil, gold), FX, and crypto next to shipping choke-point throughput and news sentiment, with a correlation matrix and lead/lag view. This is the existing Quant + Neural + News engines, extended with commodities/FX and choke-point series.

| Concern | FOSS library | Why |
|---|---|---|
| Time-series & candlesticks | **Lightweight Charts** (Apache-2.0, TradingView) | purpose-built, tiny |
| Correlation heatmap | **D3** (ISC) or **Plotly.js** (MIT) | D3 for a custom matrix |
| Risk / stats | existing **stdlib** quant engine; **statsforecast**/**sktime** (if approved via the Scout) | incremental, cheap |
| Sentiment NLP | **Cortex** gateway (open-weight models) + lexicon fallback; **VADER**/**FinBERT** (open weights) offline | already wired |
| Choke-point throughput | derived from AIS density around fixed polygons (Suez, Hormuz, Panama, Malacca) in **PostGIS** | public AIS only |

### Screen 3 — OSINT Search & Tools Hub ("Research, like Claude")

The existing **Brain** search bar, widened: one query runs the memory → planner → researcher → designer → critic → synthesizer web, and the researcher can additionally query public datasets, surface open-source investigation tools from GitHub topics (vetted through the `awesome-research` skill), and pull public hazard/disaster alerts.

| Concern | FOSS library / source | Why |
|---|---|---|
| Agent web + memory | existing `services/agents/brain.py` (SQLite FTS5) | reuse |
| Tool discovery | GitHub Search API + curated **awesome** lists (Scout) | trusted, licensed, active |
| Public hazard alerts | **USGS Earthquake** GeoJSON, **GDACS**, **NWS** (all public) | free, no key |
| Public camera / imagery context | open webcam directories (e.g. **Windy/Webcams** public API), **NASA GIBS** tiles | public feeds only — never private cameras |
| Full-text over ingested docs | **PostgreSQL FTS** or **Meilisearch** (MIT) | Meilisearch if volume grows |

### Screen 4 — Global Geospatial Dashboard (3D/2D) + AI Orchestration

A live map of public vessel (AIS) and civil flight (ADS-B) positions over open satellite imagery, with an overlaid control panel for the AI sub-agents (scrapers, analysers, notifiers), their logs and system health.

| Concern | FOSS library | Why |
|---|---|---|
| 2D vector map | **MapLibre GL JS** (BSD-3) | FOSS fork of Mapbox GL, free tiles |
| High-volume layers (10k+ moving points) | **deck.gl** (MIT) over MapLibre | GPU-accelerated, handles AIS scale |
| True-3D globe (Screen-4 "Earth") | **CesiumJS** (Apache-2.0) + **NASA GIBS** / **Copernicus** imagery | open imagery, no key for GIBS |
| Base tiles | **OpenStreetMap** raster/vector, **Protomaps** (free), **MapTiler** free tier | FOSS-first |
| Agent orchestration view | existing `/agents` + `/brain`, **n8n** embedded for workflow runs | reuse |

> The four screens map to the layout the user asked for — Company, Trading, Research, Earth — with the geospatial globe as the fourth. Load budget on a 7 GB laptop: Cesium + deck.gl are heavy, so Screen 4 is lazy-loaded and point counts are capped and clustered.

---

## 3. Data ingestion pipeline (MCP + n8n)

Each external source is an **MCP server** in its own container (one responsibility each), plus **n8n** for scheduled pulls and fan-out. MCP gives every feed the same shape — typed tools, health, and a uniform way for the Brain's researcher and Cortex to query it — so adding a feed is adding a plugin, not rewiring the core.

```
 Source            Transport        MCP server        Cadence        Lands in                     Live push
 ───────────────────────────────────────────────────────────────────────────────────────────────────────────
 AIS (aisstream)   WebSocket        mcp-ais           continuous     PostGIS vessel_positions     ws: vessels
 ADS-B (OpenSky)   REST (poll)      mcp-adsb          10–30 s        PostGIS flight_positions     ws: flights
 Commodities/FX    REST             mcp-markets       1–5 min        TimescaleDB prices           ws: prices
 Crypto klines     REST             (existing n8n)    1 min          TimescaleDB candles_1m       sse: pulse
 News RSS + F&G    REST/RSS         mcp-news          10 min         news.items (+ Cortex score)  sse: news
 Hazard alerts     REST/GeoJSON     mcp-alerts        1–5 min        PostGIS hazard_events        ws: alerts
 Satellite imagery tiles (on-demand) mcp-geo          per-view       tile proxy + cache (Redis)   —
```

**Pipeline stages**

1. **Fetch** — the MCP server pulls from the public source within its rate limit, using the free key (if any) held only server-side in `.env`.
2. **Validate & normalise** — strict schema per record (reject anything malformed before it can reach a browser, as the relay already does); positions normalised to WGS-84; timestamps to UTC.
3. **Deduplicate & upsert** — idempotent `INSERT … ON CONFLICT`; AIS/ADS-B keyed by (id, ts).
4. **Enrich** — geospatial joins in PostGIS (which choke-point polygon is this vessel in? which EEZ/port?); market rows get rolling stats from the Quant engine; news gets a Cortex sentiment score.
5. **Store** — PostGIS for geometry, TimescaleDB hypertables for the dense time series, Redis for hot caches (latest position per asset, tile cache) and pub/sub.
6. **Publish** — Redis pub/sub → relay → WebSocket/SSE to the browser; only derived, validated, non-personal data is pushed.
7. **Retain** — compress + retention policies (TimescaleDB); the DuckDB vault keeps long-range rollups; the Supabase mirror (opt-in) copies public signals for remote read.

**Correlation example (Screen 2):** `mcp-ais` density in the Hormuz polygon drops → PostGIS aggregates vessels/hour → Quant correlates the 24 h change against Brent and gold returns → the Analyst agent writes a one-paragraph brief via Cortex → pushed to Screen 2 and the Company screen. All inputs are public.

---

## 4. Recommended open-source tech stack

| Layer | Choice | License | Justification |
|---|---|---|---|
| Ingestion | **MCP servers** (Node/Python) + **n8n** | MIT / fair-code | uniform typed feeds; n8n already seeded here; visual, auditable schedules |
| Backend API | **Node (relay, existing)** + **FastAPI** for new Python services | MIT | relay already does authz/CSP/rate-limit; FastAPI for PostGIS-heavy endpoints, async, OpenAPI |
| Geospatial DB | **PostgreSQL + PostGIS** | PostgreSQL / GPL-compatible | the standard for spatial queries (within/distance/clustering); mature, free |
| Time-series | **TimescaleDB** (existing) | Apache-2.0 (core) | hypertables, compression, continuous aggregates for dense AIS/market series |
| Cache / pub-sub | **Redis** (or **Valkey**, BSD) | BSD (Valkey) | hot latest-position cache + fan-out; Valkey if a fully-permissive licence is required |
| Read API | **PostgREST** (existing) | MIT | instant read-only REST over vetted views, no hand-written CRUD |
| LLM gateway | **Cortex** (existing) + **Ollama** | MIT / local | one OpenAI-compatible endpoint, open-weight first, local fallback, never leaks keys to the browser |
| Analytics | **stdlib** (quant) + **PyTorch CPU** (neural) | Apache-2.0 / BSD | incremental stats cheaply; a tiny calibrated forecaster |
| Search index | **Meilisearch** | MIT | typo-tolerant full-text for the OSINT hub if PG FTS is outgrown |
| Map (2D/vector) | **MapLibre GL** + **deck.gl** | BSD-3 / MIT | FOSS Mapbox fork; GPU layers for AIS/ADS-B scale |
| Globe (3D) | **CesiumJS** + **NASA GIBS**/**Copernicus** | Apache-2.0 | true 3D, open imagery, no key for GIBS |
| Charts | **Lightweight Charts** + **uPlot** + **D3** | Apache-2.0 / MIT / ISC | finance-grade, low-CPU, custom viz |
| Frontend | **Vite** + **React/Next.js** + **Tailwind CSS**, with **next-intl** (web) / **react-i18next** (mobile) | MIT | fast builds, code-split map; Tailwind `rtl:`/logical utilities + next-intl give clean bilingual RTL/LTR |
| Fonts | **Cairo**/**Tajawal** (Arabic), **Inter** (English), self-hosted | OFL / OFL | professional bidirectional typography without a CDN (CSP-safe) |
| Mobile | **PWA** (installable) first; **Capacitor** if native shells are needed | MIT | one codebase, offline cache, push |
| Orchestration | **Docker Compose** (existing), profiles for heavy services | Apache-2.0 | reproducible, resource-capped |
| CI | **CircleCI** (existing config) | — | every suite, audit, secrets scan, compose validation |

---

## 5. Phased implementation roadmap

| Phase | Goal | Key work | Exit criteria |
|---|---|---|---|
| **1 — Data ingestion** | Public feeds land, validated, in the DB | PostGIS + Redis services (capped); `mcp-ais`, `mcp-adsb`, `mcp-markets`, `mcp-news`, `mcp-alerts`; schemas, dedup, retention; extend relay allow-list + WebSocket | each feed writes rows, `/status` green, rate limits respected, zero PII stored |
| **2 — Analytics & correlation** | Numbers become signals | choke-point polygons + density aggregates; commodities/FX into Quant; correlation matrix; news sentiment (done) wired to market; Analyst brief | correlation view renders from real rows; briefs post on schedule |
| **3 — Frontend (4 screens)** | The dashboard people use | Vite/React shell; Screen 1 (Company), 2 (Market), 3 (OSINT hub = Brain, done), 4 (Map/Globe, lazy-loaded); PWA; responsive to phone | all four screens live on demo + real data, no console errors, phone layout clean |
| **4 — AI orchestration** | Agents run and report | Scout/Analyst/Sentinel (done) + scraper/notifier agents; Brain widened to query feeds; orchestration panel with logs + Docker/n8n health; approval inbox for any new tool | agents visible on the web, proposals need Add/Skip, logs stream |

**Hardening runs across all phases:** per-client rate limits (done on the relay), strict CSP + security headers (done), RLS on any cloud mirror (done), secrets only in `.env` + CI secret scan (done), GDPR posture below.

### Compliance & ethics posture

- **Public data only.** Sources are broadcast (AIS/ADS-B), open-licensed (GIBS/OSM/USGS) or free-tier commercial APIs used within ToS. No scraping behind auth, no private cameras/networks, no defense-asset tracking.
- **No personal data.** The platform stores vessels, flights, prices and events — not individuals. If any source carries personal identifiers, they are dropped at the validate stage. This keeps GDPR exposure minimal (no profiling, no PII at rest); a data-handling note and source ToS list live beside this file.
- **Attribution & limits.** Each tile/data provider's attribution is shown; cadences stay under published rate limits; keys are never shipped to the client.

---

## 2b. Supply-chain anomaly engine (maritime "Radar")

A geospatial anomaly layer over public AIS that turns raw vessel positions into supply-chain signals.
Implemented as pure functions in `services/maritime-agent/anomaly.py` (standard library, deterministic,
tested without Docker); the maritime-agent runs them each cycle and forwards any flag to the Master agent.

**What it detects (public AIS only, ADR 006):**

| Signal | Rule | Why it matters |
|---|---|---|
| **AIS gap** ("dark" period) | a vessel stops broadcasting longer than a threshold; "high" when it also jumps position during the silence | sanctions/insurance compliance, re-routing — a standard commercial OSINT signal, not person tracking |
| **Route deviation** | cross-track distance from the expected shipping corridor exceeds a limit | disruption, congestion avoidance, re-routing around a blocked choke-point |
| **Port congestion** | distinct vessels dwelling within a radius of a port beyond a dwell time, vs. a normal baseline | backlog / delay — a leading indicator for supply-chain and price pressure |

**How the agent flags the Master agent.** Each rule returns JSON
(`{type, severity, reason, mmsi, …}`). The maritime-agent publishes these to **Redis Streams** (ADR 003);
**Director 00** consumes the stream, correlates a flag with market and news context (the Quant/Neural/News
engines), localizes it (Arabic/English), and surfaces it on the Market and Map screens. Positions persist in
**PostGIS**; historical tracks in **TimescaleDB** for replay.

**Libraries.** The core ships on the standard library (haversine, cross-track) to stay light on the 7 GB
laptop. Heavier upgrades are *proposed, not auto-installed* (the Scout / Brain pattern), each with its RAM
cost so the Architect can approve or skip:

| Capability | Proposed FOSS lib | License | Cost note |
|---|---|---|---|
| Complex port/EEZ polygons, spatial joins | **Shapely** / **GeoPandas** | BSD / BSD | GeoPandas pulls GDAL (~hundreds of MB) — opt-in |
| Cluster-based congestion (density) | **scikit-learn** (DBSCAN) | BSD | ~30 MB; light |
| ETA & disruption forecasting | **PyTorch** (already in `services/neural`) | BSD | reuse the existing CPU build |
| Fast spatial lookups | **PostGIS** indexes (already in `db/geo`) | — | in the database, no extra process |

## 2c. Self-optimization (bounded, human-approved)

The platform improves itself on two tracks, with a hard line between them.

**Automatic and safe — the system does this on its own:**
- **Model retraining** on fresh labeled data (the neural forecaster already retrains every 6 h and scores
  itself walk-forward; the maritime models follow the same loop).
- **Threshold auto-tuning**: anomaly thresholds (gap minutes, off-corridor km, dwell hours) live in a table,
  not in code, and are nudged from the recent true/false-positive rate — like `market.thresholds` today.
- **Adaptive routing**: the Cortex gateway already re-ranks model routes from measured latency and success.

**Gated — never autonomous (ADR 006 + safety):**
- Adding a **new data source**, changing **code or scripts**, or installing a **dependency** becomes a
  *proposal* that waits for the Architect's **Add / Skip** (the Scout and Brain already work this way).
- The platform does **not** rewrite, deploy, or run new code on itself unattended. "Self-evolution" means
  bounded auto-tuning and retraining, plus a proposal queue for anything structural — not self-modifying
  software. This keeps every change reviewable and reversible.

## 2d. Speed Layer (Phase 3: sub-second decisions)

Built in `services/maritime-agent` and measured on the 7 GB laptop (CPU only, mock replay, 5,466 positions):

```
 aisstream.io WebSocket ─┐                                                    ┌─▶ omega:alerts:fast ──▶ UI (immediate)
 (or paced mock replay)  │   Arrow IPC batches          FAST PATH              │
                         ├──▶ Redis Stream ──────▶ group "fastpath" ──────────┤   Polars sliding window (event time)
   ais_ws.py             │   omega:ais           (zero-copy → Polars frame)    │   + DuckDB in-memory OLAP (port congestion)
                         │   XADD, MAXLEN~2000                                 │   15 ms / 200-row batch · event→alert 16–19 ms p50
                         │                                                     │
                         │                        SLOW PATH                    │
                         │   omega:alerts:fast ─▶ group "director" ─▶ Director 00 (asyncio.gather, per-call deadlines)
                         │                                              ├─ ONNX Runtime risk score  (CUDA → DirectML → CPU)  0.3 ms
                         │                                              ├─ market context (Quant via relay, cached 30 s)
                         │                                              └─ AR/EN localization ─▶ omega:alerts ─▶ relay SSE ─▶ UI
                         │
 Prometheus ◀── :9108/metrics (ingest, fast path, inference, decision, sub-agent ms) ──▶ Grafana "OMEGA · Speed Layer"
```

| Stage | Measured (p50) | Notes |
|---|---|---|
| Ingest: XADD → consumer | **0.1 ms** | in-process bus; Redis adds a network hop |
| Fast-path rules per 200-row batch | **15 ms** | ≈ 13,000 positions/s on one core |
| Event → fast alert | **16–19 ms** | the number that matters for "immediate" |
| ONNX inference per alert batch | **0.3 ms** | CPU provider (no GPU on this machine) |
| Event → scored decision | **~175 ms** | dominated by the market-context deadline when the relay is down; cached afterwards |

**Fast path vs. slow path.** Ingestion never waits on AI or network calls: the fast path only runs rules and
publishes, and the slow path is a *separate consumer group* on the fast-alert stream. An early version that
awaited the slow path inline measured 480 ms of ingest lag; splitting them brought it to 0.1 ms.

**Fast-path rules** (`fast_path.py`): AIS gap on reappearance (checked against per-vessel last-seen state, so
gaps longer than the window still count), live silence, stopped vessel (< 1 kn within 15 km for ≥ X s),
abrupt speed change, and port congestion (DuckDB over the window's slow vessels). Each alert fires once until
it clears.

**ONNX** (`onnx_scorer.py`): a logistic-regression risk scorer trained with NumPy on labeled simulated
cases, written as a standard ONNX graph (MatMul → Add → Sigmoid). The model file is encoded directly as
protobuf because this machine's application-control policy blocks the `onnx` builder package's native DLL;
ONNX Runtime itself is unaffected. YOLO-style vision models are out of scope (ADR 006: no camera feeds).

**Real-time UI.** Decisions land on `omega:alerts`. The relay already streams SSE to the Ops Room; Phase 4's
Next.js + MapLibre/deck.gl frontend subscribes the same way (SSE first, WebSockets only where the client must
send data back), rendering thousands of vessels on the GPU.

**Run it:** `python pipeline.py --replay` (local, in-process bus) · `docker compose --profile speed up -d`
(Redis + maritime) · `docker compose --profile metrics up -d` (Prometheus :9090, Grafana :3000).

## Execution priority (recommended first step)

**Infrastructure first: stand up PostgreSQL/PostGIS + Redis, then build the maritime-agent.** The agent
needs a place to write positions (PostGIS, already schema'd in `db/geo`) and a stream to publish flags
(Redis, already in the compose `geo` profile) before it can do anything useful; the anomaly engine and the
bilingual geo-api already exist, so bringing up the two stores unblocks the agent immediately. **Supabase is
the optional cloud *mirror*, not a prerequisite** — it copies public signals out for remote read once the
local source of truth works. Concretely: (1) `docker compose --profile geo up -d` on a machine with Docker,
(2) build `maritime-agent` as an MCP server that ingests a public AIS feed into PostGIS and runs
`anomaly.py`, (3) wire its flags through Redis to Director 00.

## Architecture Decision Records (ADRs)

**ADR 001 — FastAPI for the API gateway.** Need async endpoints, WebSockets and fast JSON next to the
Python AI libraries. Decision: FastAPI. Already used by `services/geo-api`. (Node stays for the relay.)

**ADR 002 — PostgreSQL + PostGIS as the spatial store.** Need queries like "vessels within 50 km of a
choke-point". Decision: PostGIS; the open-source standard, no separate spatial engine. Live in `db/geo`.

**ADR 003 — Redis Streams for inter-agent messaging.** Agents must talk asynchronously without dropping
messages. Decision: Redis Streams — light vs. Kafka, already in the stack, with consumer groups for scaling.

**ADR 004 — next-intl for frontend localization.** Need seamless Arabic (RTL) / English (LTR). Decision:
next-intl with the Next.js App Router; server-rendered translations avoid the language-switch flicker.

**ADR 005 — MCP for ingestion.** Standardize how the Master agent reaches each scraper. Decision: wrap every
ingest source in an MCP server, decoupling AI logic from data extraction so agents discover sources dynamically.

**ADR 006 — Public-data-only, no surveillance scope (binding).** The platform aggregates *broadcast or
open-licensed* data: AIS (vessels), ADS-B (civil aircraft, with the standard sensitive/military filtering),
NASA GIBS / Copernicus imagery, USGS/GDACS hazards, and free-tier market & news feeds. It does **not**
ingest CCTV or private camera feeds, parse "leaked"/illicit intelligence sources, track defense assets, or
identify individuals. Proposed integrations evoking those (e.g. CCTV markers, "ShadowBroker"-style feed
parsers, "God's-Eye" live-camera overlays) are **out of scope and will not be built**, whatever they are
named. This ADR governs the others.

**ADR 007 — Bounded self-optimization, not self-modifying code.** The platform auto-retrains models and
auto-tunes thresholds from measured performance, but any change to data sources, dependencies, code or
scripts goes through a human-approved proposal (Scout/Brain). It never rewrites or deploys itself
unattended, so every structural change stays reviewable and reversible. Subordinate to ADR 006.

**ADR 008 — Speed vs. accuracy: two paths, never one.** Context: a sub-second alert and a well-reasoned
decision pull in opposite directions. Decision: split them. The **fast path** runs deterministic rules over a
sliding event-time window (Polars + DuckDB) and publishes within ~20 ms, accepting more false positives; the
**slow path** consumes those alerts on its own consumer group and adds an ONNX risk score, market context and
localization within a deadline, accepting ~0.2 s more latency for fewer, ranked alerts. Each slow-path
sub-agent has a hard deadline; one that misses it is listed in `degraded` instead of delaying the decision.
Trade-offs accepted: alerts can arrive twice (fast, then scored) and the UI must show which; the rules are
simpler than a model and will flag benign events (a ship anchoring); scoring quality is bounded by the
training labels (simulated today, real once collected — ADR 007). Rejected: one inline pipeline (measured:
the slow path's network deadline added 480 ms of ingest lag) and GPU-only inference (no GPU on the target
laptop; ONNX Runtime picks CUDA/DirectML when present and CPU otherwise).

**ADR 009 — Director 00: LangGraph + pgvector with a durable human gate.** Context: the coordinator needs long-term
memory and must never change state or act outside the platform without the human's approval (ADR 007). Decision:
a LangGraph graph (retrieve → plan → approval → execute) whose approval node calls `interrupt()` and is checkpointed
to disk, so a proposal can wait for a decision across restarts; memories live in Postgres + pgvector (`agent_memories`,
HNSW cosine) with a SQLite fallback when Docker is off, and every write records who approved it. Trade-offs accepted:
the default hashing embedder recalls shared words, not synonyms, until an embedding model is configured; the pure-Python
pg8000 driver is slower than psycopg but loads under this laptop's Application Control policy. Rejected: AutoGen and
AutoGPT-style autonomy (no gate), HashiCorp Vault (BSL; OpenBao if a secrets server is ever needed). Code:
`services/director00`, schema `db/director/01-memory.sql`, compose profile `director`.

**ADR 010 — Two-level approval for high-risk actions.** Context: one "yes" is too easy to give for actions that
reach outside the laptop or steer every later plan. Decision: `risk.py` marks production writes, non-local
notifications, bulk or large memory writes and decision/preference memories as high risk; those pause a second time
until the approver types `CONFIRM XXXX`. Every rejection is logged with a code (RISK-001, COMPLIANCE-002, EXPIRED-003,
ESCALATION-004, USER-005) and undecided proposals expire after 24 h. Trade-off: one extra step for high-risk work;
low-risk notes stay one tap. Code: `services/director00/risk.py`, `db/director/02-approval-hardening.sql`.

**ADR 011 — Butterfly Engine: explicit causal prior + evidence, as a LangGraph sub-graph.** Context: "why did this
happen?" needs cause, not correlation, but most world drivers have no local history yet. Decision: a small written
causal graph (13 nodes, 18 edges) whose links are re-weighted by evidence: DoWhy-style backdoor estimate + placebo
refuter on public market data, and live observations (USGS/EONET hazards, GDELT conflict) near the anomaly. Output per
chain: 0-1 confidence, counterfactual, graph JSON. Wrapped as a sub-graph (locate → gather → trace → narrate) behind the
`butterfly_trace` tool; read-only, so no approval. Trade-offs: the prior is opinionated and visible in code review;
untested links are labelled, never hidden. DoWhy/CausalNex are swapped in on a host where pandas loads.

**ADR 012 — News entities with a privacy floor.** Context: GDELT GKG names people, organisations and places in
every article; storing all of them builds a profile store of private individuals. Decision: `event_entities` keeps a
person only when at least 3 articles in the same batch name them (public figures in the news), tags sentiment from
GDELT tone, purges after 7 days, and indexes every entity array with GIN plus a generated tsvector. Subordinate to
ADR 006.

**ADR 013 — Phone access through Caddy with a local CA.** Context: location and AR need a secure origin, and the app
must stay off the LAN by default. Decision: the app binds to 127.0.0.1; Caddy (`tls internal`, checksum-verified
binary) terminates HTTPS on the LAN and serves only its public root certificate over HTTP. The Windows trust store and
firewall are not touched by tooling; the owner allows Caddy on Private networks and trusts the root on the phone.

**ADR 014 — Penpot MCP for design automation (accepted, optional).** `@zcubekr/penpot-mcp-server` (MIT, 76 tools)
lets an agent draft screen mockups in Penpot, the open-source Figma alternative. It is configured but not enabled:
it needs a Penpot account token (penpot.app, or a self-hosted Penpot that is too heavy for this laptop, ~2 GB).
Config: `mcp/design/`.

**ADR 015 — SwissPipe as an opt-in, lighter workflow runner beside n8n (accepted for evaluation).** SwissPipe
(Apache-2.0, OpenObserve, Rust, ~30 MB RAM) runs HTTP/condition/delay/human-in-loop workflows. It is added as compose
profile `swisspipe` with a pinned image, 64 MB cap and localhost-only port; n8n stays the default until the existing
workflows are ported and SwissPipe shows activity again (last release October 2025).

**ADR 016 — Locus AR: on hold.** An image-tracking AR SDK (MIT) published by one author with no community use yet
(0 stars, last change February 2026). Image tracking needs a printed target image, which the globe does not have, and
the SDK would get camera access in the browser. The existing compass/tilt AR mode covers the globe; revisit for an
"AR poster" of the Gulf if the project matures, or use MindAR (MIT, widely used).

**ADR 017 — LibreYOLO Web: rejected for camera feeds.** Detecting ships and vehicles in camera feeds is the
camera-surveillance scope ADR 006 excludes (and ADR 008 already rules out YOLO-style vision). Vessel positions come
from AIS and, later, published SAR detections (Global Fishing Watch). The library itself (MIT, v0.0.6, 0 stars) was
also too young to trust.

**ADR 018 — Albumentations-MCP: rejected.** Albumentations generates augmented copies of images for training models;
it does not enhance imagery for analysis. It also pulls opencv-python-headless and other native wheels into the
runtime (likely blocked by this laptop's Application Control policy) and lists pre-commit as a runtime dependency.

**ADR 019 — OSINT-Web-MCP: rejected.** Its "identity search" looks up individuals and its "stealth browser" is built
to evade bot detection; both conflict with ADR 006 and with responsible scraping. Web research continues through the
already-configured Firecrawl MCP, which identifies itself and respects site rules.

### Phase 3: Resilience & Trust Layer

**ADR-020 — Phoenix Protocol: self-healing watchdog.** Context: the laptop sleeps, crashes and runs out of RAM; a
dead web app or a damaged SQLite file should not wait for a human to notice. Decision: `scripts/phoenix.py` runs every
5 minutes (per-user scheduled task `OMEGA Phoenix`, no admin, no console window) and checks five services: director
(SQLite integrity of memory, ledger and checkpoints), memory_db (Postgres :5435 or the SQLite fallback), web
(`/api/health`), caddy (HTTPS :8443) and backup (latest Restic snapshot under 26 h). A down service is restarted; if
that fails, data services are restored from the newest Restic snapshot (the damaged files are moved to
`data/quarantine-*`, never deleted) and stateless ones are escalated. Results go to a local webhook only and to
`phoenix_events` (state changes, actions and one heartbeat per run, so ~300 rows/day). Backups use **Restic 0.19.1**
(BSD-2, single binary, SHA-256 verified, encrypted repository at `OMEGA_PRIME_PROJECT/backups/restic`, password in the
git-ignored `.env`). Trade-offs: the repository sits on the same disk, so it protects against corruption and mistakes,
not disk loss (an off-site copy is a later step); Phoenix never touches the firewall or anything outside localhost.
Code: `services/director00/phoenix.py`, `db/director/04-phoenix-events.sql`, `ops/phoenix/`; `director-00 phoenix status`.

## Mapping to the current codebase

Already built in this repo (branch `omega/stability-restructure`):

- **Relay** (`services/relay`) — gateway, CSP, same-origin POST, per-client rate limits, SSE, read-API proxy → the **Edge/Gateway** above.
- **Cortex** (`services/cortex`) + **Ollama** — the LLM gateway with the new `omega/open` open-weight route.
- **Quant** (`services/quant`, stdlib) and **Neural** (`services/neural`, PyTorch) — **Screen 2** analytics.
- **Studio** (`services/studio`, Panel + DuckDB vault) — analytics surface and long-range history.
- **Agents + Brain** (`services/agents`) — **Screen 3** OSINT hub and **Screen 4** orchestration panel; the Scout + `awesome-research` skill vet tools before adding.
- **TimescaleDB, PostgREST, n8n** — ingestion and storage spine; **Supabase mirror** (opt-in) for remote read.
- **Ops Room** (`dashboard/index.html`) — the current single-page dashboard with the neural constellation / spider web, the search bar, and the Quant/Agents/Modules panels; the four-screen SPA grows from it.

New for OMEGA PRIME: **PostGIS + Redis**, the five **ingest MCP servers**, and the **MapLibre/deck.gl/CesiumJS** geospatial screen.

### Phase 1 landed (bilingual geospatial base)

`db/geo/01-postgis.sql` (PostGIS, bilingual `logistics_nodes` with JSONB names, spatial + FTS indexes,
seeded choke-points), **Redis**, and `services/geo-api` (FastAPI, localizes by `?lang`/`Accept-Language`,
demo fallback, tested) — all under `--profile geo`, reached through the relay at `/geo/*`. Internationalization
is built in from the schema up, per v1.2 of this design.
