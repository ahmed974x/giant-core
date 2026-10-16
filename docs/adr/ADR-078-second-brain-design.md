# ADR-078: Second brain: a personal knowledge graph the agents build, with an interactive graph view (design only)

Date: 2026-10-16 · Status: Proposed (design document, nothing built)

## Context
Ahmad (2026-10-16 11:43Z) asked to add a "second brain" to the agent design: for someone who overthinks, the AI should
sort the crowd of ideas, link them, and become a mind that thinks with him, shown as an interactive graph like an
Obsidian-style graph view (screenshot), with search and filters on nodes and links.

## Decision
- New section 12 in `docs/agents/ARCHITECTURE-AGENTS.md`.
- Pipeline: capture (no questions asked) → raw note kept verbatim → atomise → enrich (local embedding, entities,
  type) → suggested edges with confidence and a reason → Leiden clusters named in Arabic → graph.
- Machine edges stay "suggested" (dashed) until Ahmad accepts; his accepts and rejects tune the linker.
- Overthinking features: brain dump, loop detector, worry → question, daily collision, contradiction alarm, decision
  journal tied to the calibration ledger, "think with me" chat that answers from his graph and cites nodes.
- Graph view: sigma.js + graphology (2D, WebGL), 3d-force-graph (3D constellation mode); search by text and meaning,
  filters, time slider, focus, path, evidence panel.
- Storage: `brain.raw / nodes / edges` in the existing pgvector Postgres; Apache AGE only if graph queries grow.
- Private by default: local model only, per-note opt-in for cloud, separate from agent memory, never a proposal source;
  nightly Markdown export with `[[wikilinks]]` (Foam format) so his notes are never locked in.
- Research: 32 more projects checked from their official repositories (licence, last commit, 2026-10-16). Avoided:
  SSPL, BSL, custom-restricted, GPL where an MIT equivalent exists, archived or abandoned projects.

## Consequences
- Phase 7 in the plan; can move up to right after the memory phase. No new server and no paid key.
- Undo: delete section 12 and this ADR.
