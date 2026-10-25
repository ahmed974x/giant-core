# omega_tools · reviewed local tools (ADR-129)

One loopback service (`127.0.0.1:8097`) for five open-source tools that passed the read-only security review in
`docs/security/TOOLS-SECURITY-REVIEW-2026-10-25.md`. Every tool is off until `OMEGA_TOOLS` names it. Paper only.

| Route (POST /api/…) | Tool | Switch | What it does |
|---|---|---|---|
| `kg_query` | Oxigraph 0.5.11 | `oxigraph` | read-only SPARQL (SELECT/ASK) over the knowledge domain's JSON export |
| `sat_track` | Skyfield 1.55 | `skyfield` | SGP4 ground track from a CelesTrak TLE, no download |
| `min_volatility` | PyPortfolioOpt 1.6.0 | `portfolio` | long-only minimum-volatility paper weights, [INFERENCE - Quant Model] |
| `doc_markdown` | Docling 2.137.0 | `docling` | a file in `~/.omega/inbox` to Markdown, offline models |
| `rag_insert`, `rag_query` | LightRAG 1.5.7 | `lightrag` | graph retrieval over your notes with a loopback Ollama model, [INFERENCE - local LLM] |

`GET /api/health` lists each tool as on/installed/pinned. A `POST` that carries an `Origin` header (any web page) is refused.

## Install and run
- Windows laptop: `powershell -ExecutionPolicy Bypass -File omega_tools\install-omega-tools.ps1 [-Full]`, then `start-omega-tools.bat`. Arabic steps: `docs/OMEGA-TOOLS-INSTALL-AR.md`.
- Linux / macOS: `./omega_tools/install-omega-tools.sh [--full]`, then `./start-omega-tools.sh`.
- Locks: `requirements-light.txt` and `requirements-full.txt`, from `requirements-*.in` with
  `uv pip compile --generate-hashes --universal --exclude-newer <date 14 days back> --python-version 3.12`. Installed with
  `--require-hashes --no-deps --only-binary :all:`. Change a pin only with a new review.

## Tests
`python -m pytest -q omega_tools/tests`. The guards run everywhere. Each tool's own test runs when its library is installed.
