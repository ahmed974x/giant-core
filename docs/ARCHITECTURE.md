# OMEGA PRIME — Global Logistics & Market Analytics Platform

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

## 2. The four screen modules

Each screen is a module in one SPA (Vite + a light framework). The map screens lazy-load their engines so the other three stay light.

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
| Frontend | **Vite** + **React** (or keep the single-file Ops Room for the light screens) | MIT | fast builds; code-split the heavy map screen |
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
