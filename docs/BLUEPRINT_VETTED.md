# OMEGA PRIME blueprint, vetted (2026-10-09)

Ahmad shared a full "layers 1–9 + out-of-the-box" blueprint. Every named tool was checked before anything enters the
stack: does it exist, who maintains it, licence, last activity, and whether it fits **this 7 GB laptop** and
**ADR 006 (public data only, no surveillance)** / **ADR 007 (human-approved changes)**. GitHub numbers are from the
public search API on 2026-10-09.

**Verdicts:** ✅ already in OMEGA · 🟢 add next (light, free, high value) · 🟡 later (good, but needs a server or a real
use case) · 🔴 skip (doesn't exist, untrustworthy, proprietary, too heavy, or out of scope).

## What was built today from this blueprint

| Item | Where | Notes |
| --- | --- | --- |
| Live hazards on the globe | `web/src/app/api/hazards` | USGS earthquakes (M2.5+, 24 h) and NASA EONET storms, wildfires, volcanoes, floods. Keyless, cached 5 min. |
| Flight radar, ship radar, public webcams, 3D globe, terrain, buildings, day/night, AR | `web/` Earth screen | See `web/README.md`. |

## Layer 1 · Core infrastructure

| Tool | Verdict | Why |
| --- | --- | --- |
| PostgreSQL + PostGIS + TimescaleDB | ✅ | `db/geo`, Timescale in compose. |
| pgvector | 🟢 | One Postgres extension, no new service. Long-term memory for the Brain/Director. |
| Redis + Redis Streams | ✅ | ADR 003. |
| NATS JetStream | 🔴 | Redis Streams already does this job; a second bus doubles RAM for no gain here. |
| DuckDB + Apache Arrow | ✅ | Speed layer and vault. |
| MinIO | 🟡 | Only when large files arrive. Lighter AGPL alternative: Garage. |
| Prometheus + Grafana | ✅ | `--profile metrics`. |
| Loki | 🟡 | Useful once several services log; ~150 MB. |
| OpenTelemetry + Jaeger | 🟡 | Worth it when agents span services; heavy for a laptop. |

## Layer 2 · Data ingestion

| Tool | Verdict | Why |
| --- | --- | --- |
| AISStream.io | ✅ | Ship radar (free key). |
| Digitraffic (Finland) | 🟡 | Keyless AIS, but Baltic only. |
| ADS-B: adsb.lol / OpenSky | ✅ | Flight radar uses adsb.lol (ODbL, keyless); OpenSky tested as fallback. |
| NASA GIBS / Copernicus | ✅ / 🟡 | Sentinel-2 cloudless is live; GIBS daily layers later. |
| USGS earthquakes | ✅ | Added today. |
| NASA EONET (not in the blueprint) | ✅ | Added today: storms, fires, volcanoes, floods. |
| NASA FIRMS (VIIRS/MODIS fires) | 🟢 | Free key, near-real-time fire pixels; complements EONET. |
| GDELT 2.0 | 🟡 | Free but strictly rate-limited (1 request / 5 s). Needs a server-side ingestor into Timescale, not browser calls. |
| NewsAPI | 🔴 | Not open source, free tier is dev-only. RSS + Cortex sentiment already live. |
| Whale Alert | 🔴 | Paid API. The relay already ingests whale events; Etherscan (free key) 🟡. |
| Yahoo Finance | 🔴 | Unofficial scraping, breaks ToS. Alpha Vantage / Binance public APIs instead. |
| FlightAware | 🔴 | Proprietary and paid. |
| "Open Eagle Eye MCP" / "Vancam 1M+ cameras" | 🔴 | 4★ single-author repo; mass camera aggregation conflicts with ADR 006. Windy (owner-published webcams) is used instead. |
| Global Fishing Watch API (not in the blueprint) | 🟢 | Free for non-commercial use; publishes **public** dark-vessel and fishing-activity detections from SAR, which is what "deep sea radar" really needs without running SNAP. |

## Layer 3 · AI agent orchestration

| Tool | Verdict | Why |
| --- | --- | --- |
| MCP | ✅ | Filesystem + git MCP enabled; ingest servers per ADR 005. |
| LangGraph | 🟡 | MIT, solid choice for Director 00's graph. Pick one framework, not two. |
| AutoGen | 🔴 | Overlaps LangGraph. |
| MemGPT (now **Letta**) | 🟡 | Apache-2.0; pair with pgvector. |
| Reflexion, Plan-and-Solve, Tree/Graph of Thoughts | ✅ pattern | These are prompting patterns, not installs; the Brain's critic step already does a reflexion pass. |
| Celery | 🔴 | Redis Streams consumer groups already schedule work. |
| AutoGPT / BabyAGI | 🔴 | Unattended autonomy conflicts with ADR 007; the approval inbox stays. |

## Layer 4 · Quant math

| Tool | Verdict | Why |
| --- | --- | --- |
| ZZignal | 🔴 | 2★, single author. |
| Kuwala | 🔴 | A data-pipeline UI (archived 2022), not a derivatives pricer. |
| stochastic-rs | 🟡 | Real (193★, MIT, active). Rust; adopt when a model needs it. |
| kuant, Axiomize | 🔴 | No such projects found. |
| PatternForge, niarules | 🔴 | 2★ research toys. |
| **QuantLib** (not in the blueprint) | 🟡 | BSD, the industry-standard pricing library; the real answer for derivatives. |
| **Optuna** | 🟢 | MIT, tiny; tunes the anomaly thresholds (ADR 007's bounded self-optimization). |

## Layer 5 · Time machine

| Tool | Verdict | Why |
| --- | --- | --- |
| GDELT 2.0 | 🟡 | See layer 2. |
| QuantReplay (Quod Financial) | 🟡 | Real (Apache-2.0, active) multi-asset market simulator; C++ service, try on a server. |
| Canwu | 🔴 | 2★. |
| Backtrader | 🔴 | GPL-3, no commits since August 2024. |
| VectorBT | 🟡 | Fast, but the open version carries the Commons Clause (no commercial use). |
| "Market DVR" | 🔴 | Not a real project; the DuckDB vault + `--replay` already replays history. |

## Layer 6 · Speed layer

| Tool | Verdict | Why |
| --- | --- | --- |
| Polars, ONNX Runtime | ✅ | Measured 16–19 ms event → alert. |
| GlowBack | 🔴 | 7★. |
| HFT NanoTick, Rapids Streams | 🔴 | Not found. |
| CPUHFT | 🔴 | 6★, no licence. |
| CUDA / TensorRT | 🔴 | This laptop has an AMD GPU; ONNX Runtime already picks DirectML/CPU. |
| "Sub-microsecond" | — | Not achievable over public internet feeds; honest target is the measured tens of milliseconds. |

## Layer 7 · Security

| Tool | Verdict | Why |
| --- | --- | --- |
| HashiCorp Vault | 🔴 → **OpenBao** 🟡 | Vault moved to the BSL (not open source). OpenBao is the MPL-2.0 fork. Today secrets live in git-ignored `.env` files. |
| Keycloak | 🟡 | Apache-2.0 but ~500 MB+ RAM; only when more than one user logs in. |
| immudb | 🟡 | Apache-2.0, light; tamper-proof audit log for agent decisions. |
| Wazuh + Suricata | 🔴 | Heavy; Windows Defender + firewall stay as they are. |
| Great Expectations | 🟡 | Or the lighter **pandera**; the relay already validates every record. |
| OpenSCAP | 🔴 | Linux server compliance; not this laptop. |

## Layer 8 · Frontend

| Tool | Verdict | Why |
| --- | --- | --- |
| Next.js + next-intl + Tailwind | ✅ | `web/`. |
| MapLibre globe | ✅ | Chosen over CesiumJS (≈3× heavier) for this laptop. |
| CesiumJS, deck.gl | 🟡 | Cesium for photogrammetry later; deck.gl when vessels exceed ~10k. |
| **AntV L7** (Alibaba, China) | 🟡 | MIT, great density/flow maps; add for AIS heatmaps. |
| TradingView Lightweight Charts | 🟢 | Apache-2.0, ~45 KB; the Market screen's candles. |
| shadcn/ui | 🟡 | Optional; current components are hand-built Tailwind. |
| "@rtl-first/arabize" | 🔴 | Not found; next-intl + CSS logical properties already do RTL. |
| Flutter / React Native | 🔴 | The PWA covers the phone. |

## Layer 9 · DevOps

| Tool | Verdict | Why |
| --- | --- | --- |
| Docker Compose | ✅ | With profiles and caps. |
| **Caddy** (not in the blueprint) | 🟢 | One small binary, automatic local HTTPS; lets the phone open the app and unlocks AR + location over Wi-Fi. |
| Kubernetes / K3s, ArgoCD, Terraform, Ansible, Kong, Consul | 🔴 | Built for fleets of servers; on one laptop they only cost RAM. Revisit with a real server. |

## Out-of-the-box additions

| Tool | Verdict | Why |
| --- | --- | --- |
| DoWhy (PyWhy) | 🟢 | MIT, light; "did the Hormuz slowdown *cause* the Brent move?" is exactly OMEGA's question. |
| EconML, tfcausalimpact | 🟡 | Natural next step after DoWhy. |
| CausalNex | 🟡 | McKinsey, active (2.5k★); Bayesian-network alternative to DoWhy, pick one. |
| DEAP, gplearn, NEAT-Python | 🟡 | Strategy/feature evolution; must stay inside ADR 007 (proposals, not self-deploying code). |
| PySwarms, ACO-Python, "BeePy" | 🔴 | Low maintenance / not the named project. |
| Mesa | 🟡 | Agent-based supply-chain simulation for the time machine. |
| Flower, Opacus, PySyft | 🔴 | Federated learning needs partners holding private data; OMEGA has one user and public data. |
| TenSEAL, zk-SNARKs, OpenEnclave | 🔴 | No threat model that needs them. |
| Tor / I2P | 🔴 | Not needed for public feeds and conflicts with the project's transparency posture. |
| IPFS, Golem, Ceramic/DID, Solidity | 🔴 | No use case. |
| Sentinel-1 SAR via SNAP | 🟡 | Legitimate public data, but SNAP needs 8 GB+; use Global Fishing Watch's published detections first. |
| MODIS/VIIRS fires | 🟢 | Via NASA FIRMS (above). |
| KiwiSDR / WebSDR, Wigle.net | 🔴 | Radio-signal listening and Wi-Fi/device mapping fall under ADR 006's no-surveillance rule. |
| NVIDIA Omniverse, AnyLogic PLE | 🔴 | Proprietary; Omniverse also needs an NVIDIA GPU. |
| CityFlow, ClimateLearn | 🟡 | Niche; only if those scenarios become goals. |
| MLflow | 🟡 | When more than one model is trained regularly. |
| Optuna, SHAP | 🟢 / 🟡 | Optuna now (above); SHAP to explain the ONNX risk score. |
| AutoGluon | 🔴 | Multi-GB install. |

## Recommended next five (each needs a yes)

1. **Caddy local HTTPS** so the phone opens OMEGA over Wi-Fi with location and AR working.
2. **Lightweight Charts** on the Market screen (candles + anomaly markers).
3. **pgvector + LangGraph Director 00** with the approval inbox kept in the loop.
4. **Global Fishing Watch + NASA FIRMS + GDELT ingestors** (free keys / rate-limited, server-side, into Timescale).
5. **DoWhy + Optuna** in the quant engine for cause-and-effect checks and bounded threshold tuning.

## Added since the first vetting (2026-10-10, branch `feat/ai-coordinator-memory`)

| Tool | Licence | Where | Why this one |
| --- | --- | --- | --- |
| **LangGraph** 1.2 | MIT | `services/director00` | `interrupt()` + checkpointer = a durable two-level human approval gate |
| **pg8000** 1.31 | BSD-3 | `services/director00` | Pure-Python Postgres driver: no native DLL for Application Control to block |
| **pgvector** 0.8.6 (pg17 image) | PostgreSQL | compose profile `director` | Long-term memory (`agent_memories`, HNSW cosine), 256 MB cap |
| **PGlite** 0.5 + socket + pgvector | Apache-2.0 | `services/director00/devtools` | Real Postgres + pgvector in WebAssembly, so tests hit real SQL without Docker |
| **Optuna** 5.0 | MIT | `services/maritime-agent/tune.py` | Bounded threshold tuning that writes proposals only (ADR 007) |
| **Caddy** 2.11.7 | Apache-2.0 | `ops/caddy` | Local HTTPS for the phone with its own CA; checksum-verified binary |
| **TradingView Lightweight Charts** 5.2 | Apache-2.0 | Market screen | Candles, volume, anomaly markers |
| **React Flow** (`@xyflow/react`) 12.12 | MIT | Research screen, Causal Graph | 1.2 MB vs Cytoscape.js 5.7 MB; renders the Butterfly Engine's graph |
| **GDELT 2.0 GKG** | public, keyless | `/api/gkg` | Places, people (only when named across several articles), organisations, themes |
| **NASA EONET**, **USGS** | public, keyless | `/api/hazards` | Storms, fires, volcanoes, floods, earthquakes |
| **NASA FIRMS** | free key (optional) | `/api/hazards` | VIIRS fire pixels; shows "key not configured" until `NASA_FIRMS_KEY` is set |

**Still not loadable here:** DoWhy and CausalNex both need pandas, whose Python 3.12 build this laptop's Application
Control policy blocks. `services/causal` (flight-to-safety check, Butterfly Engine) implements the same estimate →
refute → graph steps in NumPy; on a server without that policy either library is a drop-in addition.

## Phase 2 additions (2026-10-10)

| Item | Verdict | Where |
| --- | --- | --- |
| Two-level approval, rejection codes, expiry | ✅ | ADR 010, `services/director00/risk.py` |
| Butterfly Engine sub-graph (confidence, counterfactuals, graph JSON) | ✅ | ADR 011, `services/director00/butterfly_graph.py` |
| `event_entities` (GKG people/orgs/places/themes + sentiment, GIN) | ✅ | ADR 012, `db/director/03-event-entities.sql` |
| Caddy local HTTPS | ✅ | ADR 013, `ops/caddy` |

## Toolkit review (2026-10-10)

Checked on GitHub, npm and PyPI the same day. "★" is GitHub stars at the time of checking.

| Tool | Licence | Signals | Verdict | Why |
| --- | --- | --- | --- | --- |
| Penpot MCP (`@zcubekr/penpot-mcp-server` 1.0.0) | MIT | ★19, active June 2026 | 🟢 added, disabled until a token exists | ADR 014; needs a Penpot account token. `mcp/design/` |
| SwissPipe (OpenObserve) 0.9.49 | Apache-2.0 | ★5, last release Oct 2025 | 🟡 added as opt-in compose profile | ADR 015; ~30 MB, runs beside n8n, not instead of it |
| Locus AR (`locus-ar` 1.1.25) | MIT | ★0, single author, last change Feb 2026 | 🟡 on hold | ADR 016; image tracking needs a target image; existing AR mode covers the globe |
| LibreYOLO Web (`libreyolo-web` 0.0.6) | MIT | ★0, v0.0.x | 🔴 rejected | ADR 017; camera-feed vehicle/ship detection is out of scope (ADR 006/008) |
| Albumentations-MCP 1.0.2 | MIT | PyPI only | 🔴 rejected | ADR 018; augmentation ≠ enhancement; native OpenCV wheels |
| OSINT-Web-MCP | MIT | ★1, March 2026 | 🔴 rejected | ADR 019; identity search + stealth bot-evasion |

No integration test was added for Locus AR or LibreYOLO because neither was integrated.
