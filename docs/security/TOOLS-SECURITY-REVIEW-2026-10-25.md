# Security review: open-source tools for omega_tools (ADR-129)

Date: 2026-10-25 · Reviewer: Claude Code, cloud sandbox · Asked by Ahmad on 2026-10-25 07:34Z («ادمجهم و اربطهم و ثبت الادوات»), under his standing rule (AGENTS.md §1): no third-party tool without his approval **and** a written security review.

## Method
1. Each package was downloaded from PyPI into an empty folder and opened as an archive. It was **never imported or run** at this stage. The files reviewed are listed below with their SHA-256.
2. The review read four things: the licence in the package metadata; telemetry or analytics code (`telemetry`, `posthog`, `sentry`, `scarf`, `segment`, `mixpanel`); install-time code (wheels run nothing at install, and none ships a `.pth` start-up hook); and every network call or subprocess with its default hosts.
3. The versions chosen are the newest release at least 14 days old. The lock files `omega_tools/requirements-light.txt` and `requirements-full.txt` were made with `uv pip compile --generate-hashes --universal --exclude-newer 2026-10-11`. Every transitive package is pinned with its SHA-256 and was published before 2026-10-11. The installer runs `pip install --require-hashes --no-deps --only-binary :all:`, so it builds nothing from source.
4. After that, the light group (Oxigraph, Skyfield, PyPortfolioOpt) was installed from the lock into a throw-away Python 3.12 environment in the sandbox. The tests and the local service were run there. Docling and LightRAG were not run (several GB, and the sandbox has no Ollama).

| File read | SHA-256 (first 16) |
|---|---|
| pyoxigraph-0.5.11.tar.gz (source) | 2b7d9bf02e7ed89c… |
| lightrag_hku-1.5.7-py3-none-any.whl | 895b81d94ca447af… |
| pipmaster-1.1.13-py3-none-any.whl (LightRAG dependency) | 931062d7f15f53d9… |
| docling-2.137.0 / docling_slim-2.137.0 / docling_core-2.101.1 wheels | 284a99bcaf4d9600… / 7f3ddecb7b1e8c5b… / 0fbadbf21fb1389f… |
| skyfield-1.55-py3-none-any.whl | 9f98964855067460… |
| pyportfolioopt-1.6.0-py3-none-any.whl | fcdff5dfb4e7d0c4… |
| trafilatura-2.3.1-py3-none-any.whl | f86bad2ee36f8288… |
| sympy-1.14.0-py3-none-any.whl | e091cc3e99d2141a… |

## Verdicts

| Tool | Version | Licence | Verdict | Wired |
|---|---|---|---|---|
| Oxigraph (pyoxigraph) | 0.5.11 | MIT OR Apache-2.0 | **Pass** | `kg_query` |
| Skyfield | 1.55 | MIT | **Pass** | `sat_track` |
| PyPortfolioOpt | 1.6.0 | MIT | **Pass** | `min_volatility` |
| Docling | 2.137.0 | MIT | **Pass with conditions** | `doc_markdown` |
| LightRAG (lightrag-hku) | 1.5.7 | MIT | **Pass with conditions** | `rag_insert`, `rag_query` |
| Trafilatura | 2.3.1 | Apache-2.0 | Pass | Not wired: ORACLE reads only its keyless APIs (ADR-114), and fetching web pages would widen that |
| SymPy | 1.14.0 | BSD-3-Clause | Pass | Already required by Newton (`newton/requirements.txt`) |

Not reviewed in this round: the other eleven APEX register tools. Two of them would not pass as they are:
- **Langfuse** turns telemetry on by default and needs Postgres, ClickHouse, Redis and object storage.
- **Wazuh** runs a privileged agent.

Both stay «قيد الموافقة».

## Findings and how each is contained

### Oxigraph
- No telemetry. The Rust crate can reach the network only through SPARQL `SERVICE` and `LOAD`: its HTTP client (`oxhttp`) is compiled in on Windows and macOS (`python/Cargo.toml`, features `http-client-*`).
- The only `eval` calls are in vendored RocksDB advisor tools and tests (`oxrocksdb-sys/rocksdb/tools/advisor/…`). They are not part of the wheel.
- **Contained by:** `omega_tools/kg.py` refuses `SERVICE`, `LOAD` and every update keyword outside strings, IRIs and comments. It runs only `SELECT`/`ASK`, on an in-memory store built from the knowledge export for each call. Tests: `test_sparql_guard_refuses_writes_service_and_other_forms`.

### Skyfield
- No telemetry and no subprocess.
- The network is used only by `Loader.download` (JPL ephemerides, IERS files) when a caller loads such a file.
- **Contained by:** the SGP4 track uses `load.timescale(builtin=True)` and a TLE given by the caller. No file is downloaded; the sandbox run made no request.

### PyPortfolioOpt
- Pure maths: no network, subprocess, `eval` or telemetry.
- Its solvers come from `cvxpy`, `clarabel`, `osqp` and `scs`, all pinned and hashed.
- **Contained by:** output is labelled `[INFERENCE - Quant Model]` and paper only. It sizes no order and the risk gate is unchanged.

### Docling
- No telemetry in `docling-slim` or `docling-core`.
- **Network:** the layout and OCR models download from Hugging Face on first use. The `huggingface_hub` dependency has its own telemetry switch. Remote services (`enable_remote_services`) and external plugins (`allow_external_plugins`) are off by default.
- **Subprocess:** `tectonic` (LaTeX) and `soffice` (DOCX drawings), only for those inputs.
- **Contained by:**
  - The installer downloads the models once (`docling-tools models download`). After that, every call sets `HF_HUB_OFFLINE=1`, `HF_HUB_DISABLE_TELEMETRY=1` and `TRANSFORMERS_OFFLINE=1`, passes `artifacts_path`, and sets remote services and plugins off explicitly.
  - Only files inside `~/.omega/inbox` are read, never a URL, with the allowed suffixes only and at most 50 MB / 300 pages.
- **Residual:** the full lock includes `torch` (large). It is pinned and hashed like the rest.

### LightRAG
- **Runtime installs:** 56 modules call `pipmaster.install()` at import time to fetch missing packages, unpinned. For Ollama this is `lightrag/llm/ollama.py:9`. pipmaster runs `sys.executable -m pip`.
- **Server binds 0.0.0.0** by default (`lightrag/api/config.py:362`).
- **tiktoken** fetches `cl100k_base` from `openaipublic.blob.core.windows.net` on first use.
- Dependencies include `google-genai`, which is not used with Ollama.
- The only "telemetry" hits are OpenTelemetry context comments and `anonymized_telemetry=False` in the deprecated Chroma adapter.
- **Contained by:**
  - LightRAG's own server is not used. `omega_tools/rag.py` uses the library inside the OMEGA service, which binds 127.0.0.1 only.
  - `PIP_NO_INDEX=1` is set before the import, so pipmaster can install nothing. The `ollama` client is pinned in the lock, so the import finds it already installed.
  - The tiktoken table is fetched once by the installer into `~/.omega/tiktoken` (`TIKTOKEN_CACHE_DIR`).
  - The model URL must be loopback, `:cloud` models are refused (ADR-112 rule), and answers carry `[INFERENCE - local LLM]`.

### Trafilatura
- No telemetry.
- `fetch_url` reaches any URL it is given. A `USER_AGENTS` setting exists but is empty by default, so no spoofed user agent is used (AGENTS.md §6a).
- Not wired.

### SymPy
- `eval` and `exec` appear in its parser (`sympify`). Newton already sandboxes the input it passes to it (ADR-062).
- No telemetry and no network.

## Service controls (omega_tools)
- Binds a loopback address only and refuses to start otherwise (`bind_host`). Port 8097.
- Every tool is off until `OMEGA_TOOLS` names it. A tool that is switched on but not installed answers 503.
- `POST` with any `Origin` header is refused, so no web page can drive a tool (no CSRF or DNS rebinding through the browser). `GET /api/health` keeps Newton's CORS list for the Ops Room.
- There is no order, signing, withdrawal or key path. Trading stays paper only.
