# ADR-082: Agents phase 4: the brain loop (plan, research, critique, answer, checkpoints, budgets)

Date: 2026-10-16 · Status: Proposed (draft PR, not merged)

## Context
Ahmad approved phase 4 on 2026-10-16 ("المرحلة 4 ثم 6"). Design: ADR-077 section 4. Phases 1 to 3 (ADR-079 to
ADR-081) give the event log, the gateway, the memory keeper and the second brain this builds on.

## Decision
- **Schema `loop`** (`db/init/08-loop.sh`):
  - `loop.runs`: one row per run. The goal lives here and never in the event log. Budgets (`max_steps`, `max_tokens`)
    and counters are enforced by the database.
  - `loop.checkpoints`: one row per node, append-only. A run resumes from its last checkpoint after a restart
    (`loop.resume`).
  - A step past a budget stops the run as `incomplete`; the database records it, and the last checkpoint keeps what the
    run had. A secret in a checkpoint fails the run and nothing is stored.
- **Who runs it.** Only عبدالله (the planner) holds `loop.run` (sole holder). Maha and Badr have no database tool in
  this phase: their steps are functions the planner's runner calls (search and critique). The design had them as
  separate agents with separate prompts; the separation of prompts and roles is kept in code, and the
  database-level separation (who may write a checkpoint) is kept by the sole-holder rule.
- **Nodes:** perceive, recall (`mem.search`, the agents' memory, not the second brain), plan, research (SearXNG,
  keyless, every result tainted), analyse, critique (بدر's rules), propose (an answer only), learn (an episode with the
  outcome and the source count, never the question).
- **Critic (`services/loop/critic.py`):** no sources → gap; fewer than two independent domains → gap; an answer that
  cites no source → gap. Gaps send the plan back at most `max_rounds` times (default 2), then the run stops
  `incomplete` with the gaps listed.
- **Models (`services/loop/models.py`):** extractive by default: plan with the goal and the recall, answer only with
  source lines and their links. The Cortex path (free routes through the gateway) runs only when `CORTEX_URL` and
  `OMEGA_GATEWAY_TOKEN` are set, and falls back to extractive on any error. No key is on the laptop yet, so that path is
  not tested live.
- **Answers only.** Nothing in the loop imports the proposal path (tested). The planner lacks `proposals.add`
  (tested: refused). The loop's result is an answer with its sources.
- **Container:** `loop` service, profile `loop`, `mem_limit` 128 MB, networks `db` and `core` only (SearXNG and Cortex
  are on core). No internet. Relay route `POST /loop/api/ask` (same-origin, JSON, 6 per minute, 120 s timeout).

## Deviations (said plainly)
- **LangGraph is not used.** The design named LangGraph with a Postgres checkpointer. The same guarantees (a checkpoint
  after every node, resume after a restart, budgets, a human pause point) are implemented in about 120 lines in
  `engine.py` over the database, so the laptop does not need a new framework, and the checkpoint rules are in SQL where
  they cannot be bypassed. LangGraph remains an option if the graphs grow.
- **Parallel scouts are sequential** in this phase (three sub-queries, one after another). On a 7 GB laptop the
  parallelism would not buy much; it is a one-line change later.
- **Reciprocal rank fusion across scouts** from the design is not wired: there is one scout (SearXNG).
- **Partial reports after a budget stop** are kept in the last checkpoint, not in `loop.runs.report` (the database
  closes the run itself). `loop.resume` returns it.

## Tests
- `db/test/loop_test.sql` (all checks pass): only the planner may run the loop; the sole-holder rule for `loop.run`;
  steps inside the budget are checkpointed; a step past `max_steps` or `max_tokens` stops the run as incomplete; no
  step on a finished run; resume returns the last checkpoint; a secret fails the run and nothing is stored; the planner
  cannot add a proposal; loop tables are not readable directly; checkpoints and finished runs are never rewritten;
  events hold no goal; the chain still verifies.
- `pytest services/loop` (12 unit plus one end-to-end through the `hakeem` login): the critic's rules, the critic's
  round limit (planner receives the gaps, the run ends incomplete), a second round that fixes a gap, no sources,
  budget stops, a secret fails the run, sources as data, the Cortex fallback when the gateway is down, the web-result
  filter (only http and https links), and no proposal import anywhere in the loop.
- Not verified: a live SearXNG search, a live Cortex answer (no key), and `docker compose --profile loop up`
  (Docker is not available in this sandbox).

## Consequences
- Phase 5 (market agents) can use the same runner for Salem's analysis, through the same gate.
- Phase 6 (offices) can show runs from `loop.runs` status without reading the goals, if the owner chooses.
