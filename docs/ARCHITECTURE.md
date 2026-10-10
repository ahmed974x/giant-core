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

**ADR-021 — Truth Layer: credibility before evidence.** Context: GDELT mirrors everything the world's outlets publish,
including state messaging, satire, opinion and single unconfirmed claims; Director 00 and the Butterfly Engine must
not act on those as if they were facts. Decision: every GDELT item gets `truth_score = 0.45 reputation + 0.30
corroboration + 0.25 neutrality − penalties` with explicit flags. Reputation comes from a curated, reviewed tier list
(`services/truth/sources.json`, no external API); corroboration from GDELT `NumSources` or, for GKG articles,
other-domain articles sharing two specific entities; neutrality from GDELT tone/polarity and loaded-language patterns
in headlines and URLs; opinion pages are penalised. Below 0.7 an item is `unverified`: stored and visible with its
flags, excluded from entity search by default and from Butterfly live evidence. Scores live in `truth_scores`.
Trade-offs: strict by design (single reports wait for a second source; ~11% of a live GKG batch passed); the tier list
is opinion about editorial process and must be reviewed like code; no article text is read. Pure standard library.

**ADR-022 — Butterfly scenarios: five probabilistic outcomes, NumPy only.** Context: a ranked list of causes says
*why*; a decision also needs *what next, how likely, how bad*. Decision: after tracing, the engine runs a Monte Carlo
(20,000 runs) over root causes. Each root starts from a stated base rate (0.20) and gets a Bayesian odds update from
the evidence on its chain (data supported ×3, refuted ×0.33, observed live ×4, not observed ×0.4, untested ×1). Each
run samples which roots fire and moves the target by the observed size × relative chain strength × lognormal noise.
Runs are grouped into five scenarios: the move fades, the three most probable single drivers, and a compound shock;
each reports `probability`, `impact_range` (10th-90th percentile), `confidence` (evidence quality × runs backing it)
and `tail_risk_flag`. The Research screen shows them as probability bars; Director 00 lists them in its answer.
Trade-offs: the base rate and likelihood ratios are explicit assumptions in code, not fitted values; results are
reproducible (fixed seed). PyMC/Prophet were not installed (heavy for this laptop); NumPy only.

**ADR-023 — Approval Inbox in the web app (Layer A).** Context: Ahmad works from his phone, but Director 00's gate
was only reachable from the laptop's command line, so proposals waited until he was back. Decision: the Company screen
lists pending and escalated proposals with their risk and actions, and lets him approve, type the high-risk
confirmation phrase, or reject with a code. Reads come straight from the SQLite ledger; every change runs through
Director 00's own CLI (`/api/director`), so the two-level gate, risk policy and rejection log stay authoritative.
Changes need `DIRECTOR_WEB_PIN` (6+ digits, git-ignored `web/.env.local`; without it the inbox is read-only), a
same-origin request and fewer than 5 wrong PINs per 15 minutes; requests are validated into fixed CLI arguments, never a
shell string, and are recorded as approved by `web:Ahmad`. Reached from the phone over Caddy HTTPS (ADR-013).
Trade-offs: a 6-digit PIN on a home network, not full user accounts (Keycloak stays deferred); each change costs ~5 s
while the CLI starts.

**ADR-024 — Trust and resilience on screen (Layer B).** Context: the Truth Layer and Phoenix worked, but only in
logs. Decision: (1) the web scores every GDELT event with a TypeScript twin of the Truth Layer that reads the same
`sources.json`; a parity test runs both implementations on the same items and fails if they disagree. Because GDELT's
NumSources is counted when an event is first seen (almost always 1), corroboration also counts other domains reporting
the same kind of event at the same sub-country place within the hour. The Events tab shows a ✓/? badge with the score
and a "verified only" switch; unverified events are drawn faint and hollow on the globe. (2) The Company screen shows
Phoenix's state per service, its last run and recent incidents from `phoenix_events`. Fixed on the way: under
`pythonw` (the scheduled task) `sys.stdout` is `None`, which made every scheduled run fail; now covered by a test.

**ADR-025 — Installable app and phone intake (Layer C).** Context: Ahmad drives the project from his phone and wants
anything he sends to reach the system, without a native app store build. Decision: (1) the web app is a PWA served
over the existing Caddy HTTPS: `manifest.ts` (Arabic, RTL, standalone, PNG + maskable icons, shortcuts to Send, Inbox
and Earth), a small hand-written service worker (`public/sw.js`, no Workbox dependency) that caches the shell and static
assets, serves `offline.html` when the laptop is unreachable, and never caches `/api` or `/relay`. (2) `/[locale]/send`
takes a note, task or link plus an optional file and is also the manifest's `share_target`, so "Share → OMEGA" from
any phone app prefills it. `POST /api/intake` uses the same guards as approvals (same origin, PIN, throttle), checks
files by their bytes (images, PDF, plain text only, 8 MB), stores them under `services/director00/data/inbox` with a
generated name, and asks Director 00 to `remember:` the item. Nothing is executed: every intake is a proposal that
waits in the approval inbox. (3) A design pass: navy "night bridge" palette with teal for live data and brass for
anything Director 00 does on Ahmad's behalf, IBM Plex Sans Arabic for both scripts, and on phones a bottom tab bar
with Send raised in the middle (thumb reach). Rejected: a native wrapper (Capacitor) — a store build adds signing and
updates for no gain over an installed PWA on the same Wi-Fi.

**ADR-026 — Firecrawl page reader for links from the phone.** Context: Ahmad asked to install Firecrawl and use it in
the site. Vetting: self-hosted Firecrawl (AGPL-3.0) needs Docker Compose with Redis, Postgres, RabbitMQ, workers and
Playwright, too heavy for this 7 GB laptop and Docker is not running; the cloud API is free up to 1,000 pages a month
but sends each URL outside the laptop. Decision: `web/src/lib/reader.ts` calls Firecrawl's `/v2/scrape` with plain
`fetch` (no SDK dependency) only when `FIRECRAWL_API_KEY` is set in `.env.local`, which is Ahmad's opt-in; otherwise,
or if Firecrawl fails, a small local reader fetches the page itself. The local reader resolves the host first and
refuses loopback, LAN, link-local, CGNAT and other private addresses, re-checks every redirect, reads only HTML or
text, caps size at 2 MB and time at 10 s. A link sent from the phone now gets a Markdown snapshot in
`services/director00/data/inbox` and a title and excerpt in the Director 00 proposal; a failed read never blocks the
send. Known limit: DNS can change between the check and the fetch (rebinding); acceptable for a single-user laptop
tool, revisit if the reader is exposed beyond the PIN. Self-hosted Firecrawl stays the option once Docker runs.

**ADR-027 — Awesome atlas.** Context: Ahmad asked to "install" sindresorhus/awesome and the GitHub `awesome` topic and
link them into Claude. Those are curated link lists, not software. Decision: `web/src/lib/awesome.ts` parses the
index README (CC0) into ~680 entries (name, url, description, category, parent list); the snapshot is committed in
`web/data/awesome-atlas.json` so it works offline, and `npm run atlas:sync` refreshes it from the raw README (no
GitHub API key). The web app gets an Atlas page (`/atlas`, linked from Research and the desktop nav) with ranked
search, category filters and "send to inbox" on each list, which hands the link to the phone intake and its page
reader. Claude gets `mcp/awesome-atlas`, a dependency-free stdio MCP server with `awesome_search` and
`awesome_categories`, sharing the same search code. Rejected: a search library such as Orama, since 700 short entries
need no index; the GitHub topic API, since it needs a token and returns repos ranked by stars rather than curation.
Lists found here are leads only: any tool from them still goes through the usual vetting before it is added.

**ADR-028 — Nervous system map.** Context: Ahmad wants every tool, service and feed to read as one connected
network. Decision: a single registry, `web/data/nervous-system.json`, lists each part of OMEGA (people, screens,
services, data stores, infrastructure, Claude's MCP tools, data feeds) with typed edges (uses, calls, approves,
shows, feeds, writes to, watches, runs on); the Awesome atlas categories join as satellites of the Atlas screen.
`/api/network` adds each node's live state from System Health and whether its optional key is configured (true or
false, never the value). `/network` draws it on a Canvas 2D: a seeded force layout with kinds on rings around
Ahmad and Director 00, signals travelling along live nerves (paused under reduced motion), state rings for down
or key-less parts, search, pan and zoom, and a details panel with each node's connections and a link to its
screen. A test fails if any part is unconnected, an edge points nowhere, or a health key or screen link is wrong,
so the registry stays honest as the project grows. Rejected for now: Sigma.js + graphology, a WebGL renderer built
for thousands of nodes. At ~75 nodes, Canvas 2D needs no new dependency and keeps working where WebGL is
unavailable. The phone layout comes next.

**ADR-029 — Word, Excel and PowerPoint inside the app.** Context: Ahmad asked to install Word and Excel and use them
in the site and the phone app. Microsoft Office 2021 is already installed on the laptop, so the gap was the app, not
the programs. Decision: no Office server (ONLYOFFICE and Collabora each need Docker and over 1 GB of RAM) and no new
npm dependency. `web/src/lib/zip.ts` reads and writes zip archives with limits on entry count and expanded size, and
`web/src/lib/office.ts` previews .docx (paragraphs and headings, including Arabic Word's localised style ids), .xlsx
(sheets, shared strings, sparse cells, first 200 rows by 30 columns) and .pptx (text per slide). It also writes Word
and Excel files. The phone intake accepts the three formats, identified by their contents, and refuses
macro-enabled files. A Library screen previews them and exports Director 00's ledger to Excel (two sheets) or Word.
It needs the PIN, and the route only serves names the intake wrote. Fixtures saved by real Word, Excel and PowerPoint
are in `web/test/fixtures`, and the generated files were opened in real Excel and Word during development.
PowerPoint files are preview-only for now.

**ADR-030 — Immich photo library.** Immich (AGPL-3.0, v3.3.1) is the self-hosted photo library. It needs Docker,
Postgres with VectorChord, Valkey and normally a machine-learning container. Decision: an opt-in compose profile
`photos` with machine learning off (no ML container; faces and smart search are disabled), pinned images, memory
caps of about 1.3 GB in total, an internal network and the web UI on 127.0.0.1:2283 only. The web app reaches it with
an API key from `web/.env.local`, refuses any `IMMICH_URL` that isn't this laptop, and never sends the key to the
browser: thumbnails go through `/api/photos` behind the PIN. Photos sent from the phone are also uploaded to Immich
when it runs (best effort, never blocking the intake). Until Docker runs, System Health and the nervous system show
Immich as waiting.

**ADR-031 — PowerPoint briefings and the network on the phone.** Ahmad confirmed PowerPoint was part of the Office
ask. `web/src/lib/pptx.ts` writes a real 16:9 deck (presentation, master, blank layout, theme and slides) in the OMEGA
look: navy background, brass titles, teal figures, and Arabic lines set right to left. The Library exports a four-slide
Director 00 briefing (at a glance, waiting proposals, rejection reasons). The deck was opened and rendered to images
in real PowerPoint during development. The nervous system screen now works on the phone: the details panel stacks
under the map and scrolls into view on tap, two-finger pinch zooms, labels are limited to the centre and the
focused node until you zoom in, and Library, Network and Atlas get a strip under the header because the bottom bar
is full. Tests that call the real Director 00 now use a throwaway data folder, so test runs no longer write to
Ahmad's ledger.

**ADR-032 — Ask Director 00 from Research, and Phase 3 sign-off in the app.** Two things were still open. The first
was the original Layer C idea: asking Director 00 from the Research screen. That panel calls the local CLI through
`/api/director` (PIN). Questions are answered at once by read-only tools, and anything that writes waits in the
inbox. Building it exposed a real bug: with live market data the Butterfly Engine returned NumPy scalars, which
LangGraph's msgpack checkpointer rejected, so every online "why" question answered "Butterfly Engine unavailable".
The trace node now returns plain JSON, and a regression test covers it. The second was Phase 3's review items.
The Butterfly assumptions moved from code constants to `services/causal/assumptions.json`, with range checks and
the same values. A Review screen shows the source tiers, the assumptions and the backup-password step. An approval
is stored in `services/director00/data/reviews.json` against a 12-character SHA-256 fingerprint of the content
reviewed, so any later edit shows as "changed since your review". The screen records approvals only; edits to the
files still go through code review.

**ADR-033 — Profit Sweeper, proposal-only.** Context: Ahmad asked for profits to be collected automatically.
Decision: the sweeper computes and proposes; it never trades. It reads the holdings Ahmad enters himself
(`services/director00/data/positions.json`, git-ignored, from `services/sweeper/positions.example.json`), live prices
from Binance's public mirror, and his rules in `services/sweeper/rules.json`: sweep when the gain is at least 15%,
set aside 50% of the gain, at least $25, into USDT. These are placeholders until he approves them on the Review
screen. The plan appears on the Market screen. "Send plan for approval" makes a Director 00 `remember: TASK`
proposal, so approving only records it, and Ahmad makes any sale himself. OMEGA holds no exchange keys and has no
code path that places an order. Running the check on a schedule is a later step that needs his yes.

**ADR-034 — End-to-end tests.** `npm run e2e` (after `npm run build`) starts a separate production server on
:3199 with a throwaway Director 00 data folder (`DIRECTOR_DATA_DIR`, now honoured by every web route as well as by
the Python side) and a test PIN. It covers every screen in both languages, PIN, origin and path guards, a phone note
that is approved and executed, a Word file from intake to Library preview, a refused executable, the
Excel/Word/PowerPoint exports, Review sign-off and stale fingerprints, a Profit Sweeper proposal that is then
rejected, and the nervous system and atlas APIs. It also loads four screens in headless Chrome and fails on console
errors; failures from the relay are ignored, since it needs Docker. The real ledger, inbox and PIN are never touched.

**ADR-035 — Phone alerts (Phase 4).** Ahmad wants to hear when something needs him without opening the app.
Decision: standard Web Push from the installed PWA, with no dependency and no third-party account.
`web/src/lib/webpush.ts` implements RFC 8291 message encryption (aes128gcm) and RFC 8292 VAPID (ES256) on Node's
built-in crypto. A test reproduces the RFC's published example byte for byte, so push services only ever see
ciphertext. Subscriptions are accepted only for the browser vendors' push services (FCM, Mozilla, Apple, Windows),
so a crafted subscription can't point the laptop at other hosts. A dead subscription (404/410) is dropped. The VAPID
key, subscriptions and bookmarks live in Director 00's data folder. A watcher started from Next.js's
`instrumentation.ts` checks the ledger and Phoenix's log every minute and pushes new proposals and Phoenix incidents
(at most 5 per check). Phoenix already keeps the web server alive, so no new scheduled task is needed. Turning it
on happens on the Company screen with the PIN; a test notification confirms it. iPhones need iOS 16.4 or later and
the app on the home screen.

**ADR-036 — Editable Profit Sweeper rules.** Ahmad confirmed a 25 USDT minimum and asked to edit the rules from the
Review screen. The sweeper section has an edit form; values are range-checked by the same `validRules` the sweeper
uses, and the note in the file is kept. Each edit is appended to `rule-edits.jsonl` (before, after, who, when). It
changes the content fingerprint, so the rules show "changed since your review" until Ahmad approves the new
version. Only the sweeper rules are editable in the app; source tiers and Butterfly assumptions still change
through code review. `OMEGA_ROOT` points the end-to-end server at copies of these files, so tests never edit the
real ones.

**ADR-037 — Morning briefing.** Approved by Ahmad on 2026-10-10. The Windows task "OMEGA Morning Briefing" runs
daily at 07:00 local time as `pythonw scripts/phoenix.py briefing`, which starts `web/scripts/briefing.ts` with no
console window and logs the result to `phoenix_events`. The briefing does three things:
- writes a four-slide PowerPoint deck of the ledger into the inbox, so it appears in the Library (the last 14 decks
  are kept);
- runs the Profit Sweeper check against Ahmad's positions and live prices, and proposes at most one sweep plan a day
  (never if one is already waiting); it still never trades;
- pushes one alert saying how many items wait for approval.

The alert watcher now pushes only failures, restarts and restores. Passing drills and briefings are logged without
an alert.

**ADR-038 — Restore drill.** A backup only counts if it restores. The Windows task "OMEGA Restore Drill" runs every
Sunday at 06:30 as `phoenix.py drill`:
- it restores the newest Restic snapshot into a scratch folder, never over live data;
- it runs SQLite's integrity check on every restored database and compares its tables with the live ones;
- it times the drill, logs ok or failed, and deletes the scratch copy.

A failure reaches the phone through the alert watcher. Tables created after the snapshot are reported as warnings,
since the next backup carries them. The first real drill showed this: the snapshot was 7 hours old and lacked the
newer `checkpoints` and `truth_scores` tables. A fresh backup then restored and verified in 2.5 s. The same drill
fixed a time bug: Restic writes local time with an offset, and the drill now honours it.

**ADR-039 — Command Center.** Ahmad's brief (2026-10-10): one front door with four live miniature screens, a
central command bar and a status bar, in his palette.

What it is:
- `/` is now the Command Center; Company moved to `/company`, and links, alerts and the manifest followed.
- The miniatures are a turning 3D MapLibre globe with world events, hazards, planes over the Gulf, and ships once
  AIS is keyed; a Lightweight Charts BTC area; the nervous system with running signals; and the latest Library files
  with one-tap Excel, Word and PowerPoint exports.
- 🔮 asks Director 00 and answers in place. ⚡ files the command as a task proposal through the phone intake, so it
  waits in the approval inbox like everything else. 📎 attaches a file and 🎤 dictates through the browser's speech
  recognition.
- The header gained Live and Director indicators, an approvals bell with its count, search (Ctrl+K) and settings
  (Review). The status bar shows pending approvals, Phoenix, memory, the live feed and freshness, from one shared
  30-second poll (`lib/status.ts`).

How it differs from the brief: the app is on Next.js 16 and Tailwind 4 rather than 14. Motion uses CSS (300 ms
transitions, a launch pulse on send, pulsing live dots) instead of Framer Motion, to avoid a new dependency. The
network miniature reuses the existing Canvas renderer rather than React Flow, and MapLibre stands in for CesiumJS.

His palette became the app-wide tokens: `--bg-primary`, gold, purple, cyan, pink, green, red and orange, with the
existing Tailwind names mapped onto them, gold and purple gradients, and glass panels. Fonts are Cairo and Inter,
with JetBrains Mono for codes.

His extras: a particle background that drifts away from the pointer (it pauses when the tab is hidden and stays
still under reduced motion), keys 1-4 for the screens and Esc to close, a Web Audio ping on approve and reject, and a
warmer palette from 23:00 to 06:00. On phones the command bar comes first, the cards stack in one column, and the
status bar sits at the end above the tab bar.

**ADR-040 — Docker running; Director 00's ledger moves to Postgres + pgvector (blocker 1).** The checks found
nothing to fix in firmware or Windows. Virtualization was enabled in the HP BIOS, the hypervisor was present, the
Virtual Machine Platform was on, WSL 3.0.1 was installed, and Docker Desktop was installed per user. The engine
simply wasn't started; starting it made `docker ps` work, with no BIOS change, admin prompt or restart.

`docker compose` refused to start anything, because other profiles' required secrets (`IMMICH_DB_PASSWORD`,
`SWISSPIPE_*`) were empty. Local random values now fill them in `.env`, along with a generated
`DIRECTOR_DB_PASSWORD`; none of them is ever printed or committed. The `memory` service (pgvector 0.8.6, pg17,
256 MB cap, 127.0.0.1:5435) runs at about 25-55 MB. Docker adds roughly 0.6 GB in total on this 7.2 GB laptop.

Migration: SQLite was backed up first (Director backup and a Restic snapshot). `services/director00/migrate_to_pg.py`
then copied the approvals, rejections, memories, Phoenix events, GKG entities and truth scores (2,802 rows). The
script is idempotent (a second run adds nothing), checks counts per table, and only reads the SQLite files.
`db/director/06-phase4-events.sql` lets Postgres accept the new Phoenix actions (`morning`, `restore-drill`).
`DIRECTOR_DB_URL` is set in `.env` and `web/.env.local`; deleting that line falls back to SQLite.

The web app used to read `director.sqlite` and `phoenix.sqlite` directly, so it would have shown stale data after
the switch. All of those reads now go through `web/src/lib/ledger.ts`, which uses `pg` 8.23.0 (MIT, pure
JavaScript, no native DLL) when `DIRECTOR_DB_URL` is set and SQLite otherwise, with the same row shapes. That covers
the inbox, health, exports, briefing, alerts and the Phoenix timeline. The alert watcher re-bookmarks if the event
log changes source. LangGraph's checkpoints stay in SQLite, since its Postgres saver would add native dependencies.

Phoenix now starts Docker Desktop if the engine is down, for example after a reboot, before restarting the
`memory` container. The end-to-end server forces `DIRECTOR_DB_URL` empty so tests never touch the real database.
The Director and Phoenix suites ran against real Postgres in a throwaway `omega_test` database, including the 18
Postgres tests that were skipped until now: 52 passed.

**ADR-042 — Secrets encrypted at rest, redacted in logs, checked at start.** Ahmad asked on 2026-10-10 for the keys
to be encrypted with dotenvx, for logs to hide secrets, and for a startup check that refuses to run when anything
is unsafe. The full procedure is in docs/SECURITY.md, section Secrets.
- **Encryption.** `@dotenvx/dotenvx` 1.75.1 (BSD-3, pure JS) encrypts every value in `web/.env.local`. The encryption
  was verified in memory before the plain file was replaced: both filled-in values decrypted back identically. The
  private key sits outside the project at `%USERPROFILE%\.omega\secrets\web.env.keys`; Ahmad keeps the Bitwarden
  copy.
- **Running.** `npm run dev`, `build` and `start` go through `scripts/secure-run.mjs` (dotenvx run with that key
  file), and so does Phoenix's web restart. dotenvx 1.75 mishandles absolute Windows paths for `-f`, so the env file
  is passed relative to the web folder. Next.js bundles neither dotenvx nor `pg` (`serverExternalPackages`), because
  dotenvx pulls in a module Turbopack cannot trace on Windows.
- **Startup check.** The server exits unless:
  - every value is encrypted;
  - every value is decrypted in memory (an empty value decrypting to "" is fine);
  - the key file exists outside the project;
  - Git ignores and tracks neither file;
  - no tracked file contains a live secret.

  The first live run caught a false positive (npm's `secrets:check` script name looks secret), so npm and Next.js
  tooling variables are excluded.
- **Logs.** Redaction is installed before anything logs.
- **Commits.** A pre-commit hook blocks key files and plain `.env` values.
- **Data keys.** The key check on the Review screen decrypts `.env.local` in memory, loads the four data keys into
  the running app and tests each one against its service. Fake keys were rejected by the real NASA FIRMS and
  AISStream services, as expected.
- **Fixed on the way.** The site's Permissions-Policy denied the microphone, which silently broke the Command
  Center's voice input; it now allows `microphone=(self)`.
- **Verified live.** A plain `next start` refused to start, a dotenvx start passed all six checks, the PIN-guarded
  routes worked, and the log held no secret.

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
