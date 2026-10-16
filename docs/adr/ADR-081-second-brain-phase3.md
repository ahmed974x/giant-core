# ADR-081: Agents phase 3: the second brain (capture, atoms, links, themes, rescue, map, Markdown export)

Date: 2026-10-16 · Status: Proposed (draft PR, not merged)

## Context
Ahmad approved phase 3 on 2026-10-16 ("ابدأ المرحلة 3"). Design: ADR-078 and `docs/agents/ARCHITECTURE-AGENTS.md`
section 12. Phases 1 and 2 (ADR-079, ADR-080) give the event log, the tool gateway and the memory keeper this builds on.
The second brain is Ahmad's own private graph of thoughts. It is separate from the agents' memory and can never
become a trading proposal.

## Decision
- **Schema `brain`** in the same Postgres (`db/init/07-brain.sh`, no new server):
  - `brain.raw`: every capture, verbatim. Append-only; only the owner's `brain.forget_user` (admin login) can erase it.
  - `brain.nodes`: atoms, one idea, question, task, fact, worry, decision, quote or source each, pointing at their raw note.
    Text and type never change; cluster and embedding may be recomputed.
  - `brain.edges`: links with `origin` (human | machine), `confidence`, a one-line `why` and `state`
    (suggested | accepted | rejected). Machine links start `suggested`; the owner's taps decide, and a decision is final.
    A rejected link is never suggested again (the unique key keeps it).
  - `brain.clusters`, `brain.settings`: themes, and the thresholds the owner's taps tune (accept lowers the similarity
    threshold, reject raises it).
- **Gated functions only.** No agent reads or writes a `brain` table. Three new tools in the gateway:
  `brain.read` (hakeem, ameen), `brain.write` and `brain.link` (sole holder ameen). Every function refuses an agent
  that acts under another name (`brain.guard_session`), and refuses a secret before storage (`mem.looks_secret`).
- **Events carry ids and counts, never words.** The event log is published read-only by the relay, so the brain writes
  `brain.captured`, `brain.atom`, `brain.suggested`, `brain.decided`, `brain.clustered` with ids only. The event kind
  constraint gained the `brain` family.
- **The worker `services/mind`** (container `mind`, profile `mind`, `mem_limit` 160 MB, no internet):
  - `atomise.py`: splits a note into atoms and types each one with explainable rules (Arabic and English). No model.
  - `linker.py`: candidate links with a reason: `similar_to` (cosine ≥ threshold, not across a negation),
    `leads_to` (idea → task), `answers` (fact → question), `contradicts` (close wording, opposite negation), `mentions`.
  - `clusters.py`: Louvain communities from networkx (BSD-3-Clause, pinned 3.4.2) with a fixed seed; themes are named
    from the owner's most frequent words.
  - `analysis.py`: brain dump (3 to 7 themes, questions, at most 3 next actions, the rest parked), loop detector (the
    same worry on 3+ days with no closing link), daily collision (a seeded pair from two different themes), think with me.
  - `exporter.py`: nightly Markdown export, one file per atom with front matter and `[[wikilinks]]`, written to a
    gitignored bind mount (`data/brain-export/`). It only replaces files it wrote (`n<id>.md`).
  - `server.py`: small internal HTTP API; `worker.py`: the nightly run at `MIND_NIGHT_HOUR` UTC.
  - Embeddings reuse `services/ameen/embed.py`: the local hashing embedder by default; an HTTP embedder only at a local URL.
- **Relay routes** (`services/relay/server.js`): `/mind` (static page, strict CSP, no CDN), `/mind/vendor/*` (whitelisted
  files only), `GET /mind/api/{graph,digest,evidence/<id>}`, and same-origin, JSON-only, rate-limited POSTs for
  capture, dump, decide, search and think. Rate limits: capture 30/min, dump 10/min, decide 60/min, search 60/min,
  think 12/min.
- **The map** (`dashboard/mind/index.html`): dark, RTL, Arabic first. sigma.js 3.0.3 (2D, WebGL) and 3d-force-graph
  1.80.1 (3D), graphology 0.26.0, all MIT and vendored with hashes and licence files in `dashboard/mind/vendor/`.
  Search, type and theme filters, a time slider, "my links only", "show suggestions", focus on a node, Shift-click for
  the shortest path, an evidence panel that opens the raw note, accept and reject buttons, the digest, think with me,
  and brain dump. `?demo` runs on a built-in fixture with no server, for the browser check.

## Deviations (said plainly)
- **Think with me is extractive in this phase.** It answers only with the owner's own atoms, cites them by id, and asks
  the next question. Phrasing by a local model (Ollama) is not wired yet. It is the next step in the list, behind the
  same local-URL check, and it is optional.
- **Heuristic typing and linking** replace the local model's labels. They are predictable and free, and each link
  carries a reason. A model can relabel later without changing the schema.
- **Ring-by-type** from section 12.3 is shown as a symbol in each label (•, ؟, ✓, ◆, ⚠, ✦, ❝, 🔗), not as a ring,
  because sigma draws circles only. Suggested links are orange; contradictions are red.
- **Layout** is a small deterministic force layout in the page (no extra library); it is good up to roughly 900 atoms,
  beyond which atoms are spread on a circle. Apache AGE is not used; recursive SQL is not needed because the map and
  the path finder work from the snapshot.
- **Erasing the brain** is an admin-only operation (`SELECT brain.forget_user('owner')`), as `mem.forget_user` is. The
  page does not offer it: deletion must not be one click away from a phone.

## Security and privacy
- Nothing here can reach a trading proposal: `fahd` (who holds `proposals.add`) does not hold `brain.read`, `ameen`
  cannot add proposals, and a test checks both. `analysis`, `linker`, `clusters`, `atomise` and `exporter` contain no
  proposal code (tested).
- The owner's captures reach the brain through the relay, which is reachable only over Tailscale or the Cloudflare
  Access path, the same as the other private pages. The relay adds same-origin checks, JSON-only bodies and rate limits.
- Cloud use is off by default: `brain.raw.cloud_ok` is `false`, and nothing sends a note to a cloud model.
- The export folder is gitignored. The Markdown copy is the owner's; the repository never holds it.

## Tests
- `scripts/test-nerve.sh` on a throw-away PG16 cluster: 05, 06, 07 run twice each (idempotency); `nerve_test.sql`
  (57 checks), `memory_test.sql` (44), and `brain_test.sql` (43 checks, passing): toolbelts, sole holder,
  impersonation, fahd denied (no other agent holds a brain tool), secret refusal, append-only triggers, the owner-only forget, event contents,
  and the chain still verifying.
- `pytest services/ameen` (10) and `pytest services/mind` (18 unit plus one end-to-end run through the `ameen` login,
  which captures, links, decides, clusters, exports, and is refused the forget).
- Browser check (Playwright, Chromium 1194, `?demo`): page loads, search, capture, think, 2D and 3D toggle, node click
  opens evidence, accept works, Shift-click path, no horizontal overflow at 390 px or 1400 px, no console errors.
- Not verified here: a live `docker compose --profile mind up`, the relay routes against the live `mind` container
  (Docker is not available in this sandbox; `docker compose config` could not run; the YAML parses), and the Tailscale
  phone check. These are the first steps on the laptop.

## Consequences
- Phase 4 (the brain loop with LangGraph) can read `brain.read` through the same gateway; nothing else changes.
- Ahmad's graph is his. The nightly export means that even without OMEGA, the Markdown folder opens in Obsidian or Foam.
