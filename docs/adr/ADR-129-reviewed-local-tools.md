# ADR-129: reviewed open-source tools as local options (omega_tools), linked to the knowledge domain and APEX

Date: 2026-10-25 · Status: Proposed. Ahmad's message of 2026-10-25 07:34Z, «ادمجهم و اربطهم و ثبت الادوات», approved installing the proposed tools. The merge of this change waits for his go, and real installs happen on his laptop.

## Context
ADR-126 and ADR-127 listed open-source tools as ideas only (Oxigraph, LightRAG and Docling in the knowledge domain; sixteen tools in the APEX register). AGENTS.md §1 lets a third-party tool in only with Ahmad's approval **and** a written security review. His approval now exists. This ADR records the review and how the tools that pass are added without weakening any rule: loopback only, paper only, no keys, no orders, nothing on by default.

## Decision
1. **Review.** Seven tools were reviewed read-only from their PyPI packages, without running them: Oxigraph, LightRAG, Docling, Skyfield, PyPortfolioOpt, Trafilatura and SymPy. The review is `docs/security/TOOLS-SECURITY-REVIEW-2026-10-25.md`.
   - Pass: Oxigraph, Skyfield, PyPortfolioOpt, Trafilatura, SymPy.
   - Pass with conditions: Docling (one-time model download, then offline) and LightRAG (runtime pip installs through pipmaster, a server that binds 0.0.0.0 by default, a tiktoken download).
   - Trafilatura is not wired, because ORACLE reads only its keyless APIs. SymPy is already Newton's.
2. **omega_tools.** A Python package at the repo root, served by `python -m omega_tools.http_api` on 127.0.0.1:8097 (loopback enforced), with one route per tool: `kg_query`, `sat_track`, `min_volatility`, `doc_markdown`, `rag_insert`, `rag_query`.
   - Every tool is off until `OMEGA_TOOLS` names it.
   - A `POST` with an `Origin` header is refused, so no web page can run a tool.
   - The guards:
     - SPARQL is SELECT/ASK only, with no SERVICE, LOAD or updates, on an in-memory store.
     - Skyfield uses the built-in timescale and no download.
     - Docling reads only `~/.omega/inbox`, runs `HF_HUB_OFFLINE`, and keeps remote services and plugins off.
     - LightRAG runs with `PIP_NO_INDEX`, a loopback Ollama only and no `:cloud` model.
     - PyPortfolioOpt output is labelled [INFERENCE - Quant Model] and paper only.
3. **Supply chain.**
   - Exact pins, the newest release at least 14 days old.
   - Full transitive locks with SHA-256 for every file (`uv pip compile --generate-hashes --universal --exclude-newer 2026-10-11`).
   - Installed with `--require-hashes --no-deps --only-binary :all:` into `~/.omega/tools/.venv`.
   - Two groups: light (Oxigraph, Skyfield, PyPortfolioOpt) and full (adds Docling and LightRAG).
4. **Laptop.** `omega_tools/install-omega-tools.ps1` (and `.sh`) installs a group and writes `start-omega-tools.bat` with the installed tools switched on. The Arabic steps are in `docs/OMEGA-TOOLS-INSTALL-AR.md`. `start-omega.bat` / `.sh` report port 8097 like Newton.
5. **Links.**
   - The knowledge domain's Oxigraph, LightRAG and Docling move from `idea` to `local option` with their review. The tools table shows «مراجَعة أمنياً · خيار محلي مطفأ حتى تشغّله»; they stay hollow on the graph, because they are not in use until installed.
   - APEX gets `LOCAL_TOOLS` (five rows with field, route, pin and verdict). Each field helper's brief shows its local option: knowledge has Oxigraph and Docling, AI has LightRAG, space has Skyfield, risk has PyPortfolioOpt. The register marks the four reviewed rows, and the auditor's review line says reviewed tools are off until switched on.
   - Neither page connects to the service: both keep `connect-src 'none'`.

## Not done, and why
- Nothing was installed on the laptop from here. The installer and the steps wait for Ahmad to run them.
- Docling and LightRAG were reviewed and their guards tested, but they were not run in the sandbox (several GB, and no Ollama there).
- The other eleven APEX tools were not reviewed in this round. Langfuse (telemetry on by default, a heavy stack) and Wazuh (privileged agent) would not pass as they are.
- No order, signing, key or money path exists. Trading stays paper only.

## Consequences
- CI runs `python -m pytest omega_tools/tests` after installing the light lock with `--require-hashes`.
- `test-apex.mjs` checks that every local tool has a route in `omega_tools/http_api.py` and the installer's pin, and that tools are off by default. `test-knowledge.mjs` checks the three local options.
- A pin changes only with a new review and a new lock.
