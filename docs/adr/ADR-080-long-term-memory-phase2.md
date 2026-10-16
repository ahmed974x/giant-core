# ADR-080: Agents phase 2: long-term memory (episodes, bitemporal facts, skills, calibration) and أمين

Date: 2026-10-16 · Status: Proposed (draft PR, not merged)

## Context
Ahmad started phase 2 on 2026-10-16 (decision card "ابدأ المرحلة 2"). Design: ADR-077 section 6. Phase 1 (ADR-079)
gave the event log, the registry and the tool gateway this builds on.

## Decision
- `db/init/06-memory.sh` adds schema `mem` to the same Postgres (no new server):
  - `mem.episodes`: what happened. Any agent logs through `mem.log_episode`; archived after 30 days, still searchable.
  - `mem.facts`: bitemporal beliefs (`valid_from/valid_to` = world time, `recorded_at/superseded_at` = when we learned
    and dropped it). One current row per subject+predicate. The same belief from a new source confirms it (more
    sources, no duplicate); a different one supersedes the old row, which is kept. Overturning a belief held with
    confidence ≥ 0.8 writes `memory.contradiction` for بدر. Content is never edited and rows are never deleted,
    except by `mem.forget_user` (owner only).
  - Write gate: facts only via `mem.assert_fact`, which goes through the nerve gateway (`memory.write`, sole holder
    أمين); evidence is required (http(s) links or event ids); facts from tainted sources start `unverified` until a
    second independent source; key-shaped strings (API keys, tokens, private keys, JWTs) are refused, nothing is
    stored, and a `guard.secret_refused` event (without the secret) is logged.
  - `mem.skills`: procedures with use/success counts; a skill is a draft until بدر (or the owner) reviews it; the
    nightly sleep retires skills that fail more than half the time after 5 uses.
  - `mem.forecasts` + `mem.calibration`: the calibration ledger. Each resolved forecast gets a Brier score; an agent
    can never grade its own forecast; resolving needs evidence. `skill_vs_coin` > 0 means better than always 50%.
  - `mem.search`: hybrid recall over current facts (or the facts believed at a past time, `p_as_of`) and episodes:
    full-text (Arabic and English, `simple` config, OR of the words) + cosine similarity of embeddings + recency,
    merged by reciprocal rank fusion; unverified facts ×0.8, archived episodes ×0.9.
  - `mem.sleep`: archive, retire, and report counts (unverified facts, contradictions in 24 h, overdue forecasts,
    rows without embeddings) as a `memory.sleep` event.
  - Roles: `nerve_agent` calls the agent functions only; `mem_keeper` (the `ameen` login) also fills embeddings and
    runs the sleep. Neither can read the tables, erase memory or act as the owner.
  - `api.mem_stats`, `api.mem_facts`, `api.mem_calibration` for the Ops Room.
- Embeddings are `real[]` with an SQL cosine instead of pgvector: the Timescale image does not ship pgvector, and
  brute force is fast enough for tens of thousands of rows. Move to pgvector (HNSW) if memory outgrows that.
- `services/ameen`: the memory keeper worker (`--profile memory`, 96 MB cap, networks db+core, no internet). It fills
  missing embeddings every minute and runs the sleep once a day (default 00:00 UTC = 03:00 Kuwait). Default embedder
  is the zero-RAM hashing embedder already used by Director 00; an Ollama model can be set with `AMEEN_EMBED_URL` /
  `AMEEN_EMBED_MODEL`, and only local URLs are accepted, so memory text never leaves the laptop.
- Ops Room: one memory line under the nerve chain status (facts, superseded, episodes, last sleep).

## Consequences
- Tests: `scripts/test-nerve.sh` now runs 101 SQL checks (57 nerve + 44 memory) and the worker's 10 pytest checks,
  including an end-to-end run against the same throw-away Postgres.
- Arabic full-text needs a UTF-8 database locale (the Timescale image's default); a plain `C` byte locale would not
  split Arabic words.
- Turning on the worker: set `AMEEN_DB_PASSWORD` in `.env`, then `docker compose --profile memory up -d` (db-migrate
  creates the login). Not run here: Docker build and the live stack (no Docker daemon in the cloud session).
- Phase 3 (second brain) reuses `mem.search`, the embedder and the sleep.
- Undo: `DROP SCHEMA mem CASCADE; DROP VIEW api.mem_stats, api.mem_facts, api.mem_calibration; DROP ROLE ameen, mem_keeper;`
