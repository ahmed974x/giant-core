---
name: omega-knowledge-domain
description: Use when changing or using the OMEGA knowledge domain (omega-ops-room-v1/omega-knowledge.html, scripts/lib/knowledge-domain.mjs) that joins ideas, open-source tools, ORACLE sources, PRIME agents, pages and every ADR in one graph, answers questions with a context pack and drafts paper-only PRIME plans the helpers review.
---

# OMEGA knowledge domain (ADR-126)

Text rules only; no scripts run from this skill. Read `omega-design` for the look and `supreme-software-ui-architect` before any UI or data change.

## 1. What is in the graph
- Node kinds: `domain` (15 fixed hubs in `DOMAINS`), `page` (the 8 pages), `agent` (PRIME lead + the 9 helpers of `agent-core.mjs`), `source` (ORACLE's `SOURCES`), `tool` (the ADR-125 library + `KG_TOOLS`), `adr` (every `docs/adr/ADR-NNN-*.md`, read by `parseAdr`), `idea` and `theme` (the second brain's `organise()` of this browser's ideas; library ideas are never idea nodes).
- Links say why they exist (`EDGE_WHY`). Fixed tables: `shows`, `watches`, `feeds`, `serves`, `leads`, `runsOn`, `readBy`, `cites`, `builds`, `inTheme`, `mentions`. Word links (`about`) come from shared tokens after the second brain's Arabic/English normalisation and are always labelled [INFERENCE] and drawn dashed.
- A new domain needs words in both languages, `lib` categories, `sources` that exist in ORACLE, `helpers` that exist in PRIME, `pages` and a plain `q` for the enrichment lookup. `test-knowledge.mjs` refuses unknown sources, helpers or tools.

## 2. The maths
- `pagerank`: weighted power iteration, damping 0.85; with `personal` it is personalised PageRank.
- `betweenness`: Brandes, unweighted, normalised to 0..1 (bridges).
- `predict`: Adamic-Adar, idea → tool / source / agent only, never an existing link.
- `gaps`: fixed rules per domain, each finding names its `rule`.
- `ask`: seeds = nodes holding the question's tokens; the question's named domains win; answers ranked by lift over the plain rank; each answer carries the BFS path from the strongest seed.
- `plan`: draft from the pack's agents' tools, then one rule per helper (lead: recall first; research: ORACLE when sources answer; sentinel: world/cyber domains; audit + risk: any trading domain, risk waits for every market reading; exec: opens nothing from a plan; ops: note last, ≤ 12 steps). The page and the Ops Room run `OMEGA_CORE.checkPlan` before it can run.

## 3. Rules
- Paper only. A plan may name only PRIME's `TOOLS`; it is stored under `omega-know-plan-v1` and starts only when the person presses Start mission in the Ops Room.
- Network only on the enrich button, only to `www.wikidata.org/w/api.php` and `api.openalex.org/topics` (`allowedEnrich`), only the 15 domain names are sent, after a confirm. Results keep source and date; a failure shows "تعذر التحقق منها".
- Tools are ideas until Ahmad approves an install after a written security review. Kùzu is out (archived October 2025).
- No text inside the SVG; the inspector, the node list and the tables carry the same data.
- After editing `scripts/lib/knowledge-domain.mjs` or adding an ADR run `node scripts/build-knowledge-inline.mjs`, then `node scripts/skillspector-audit.mjs --fix omega-ops-room-v1/omega-knowledge.html` and `node scripts/test-knowledge.mjs`.
