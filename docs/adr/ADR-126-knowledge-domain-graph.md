# ADR-126: The knowledge domain: one graph of ideas, tools, open sources, agents and decisions

Date: 2026-10-24 · Status: Proposed (Ahmad's message of 2026-10-24 22:44Z; merge waits for his go). Stacked on ADR-125 (PR #45), which sits on ADR-124 (PR #44).

## Context
Ahmad asked for a "great knowledge domain" (نطاق المعرفة الكبرى): research open source, sort his ideas, merge and link them, "install the tools", correct the plan with the agents, let the AI help him and the design, and think beyond the usual box. OMEGA already holds the pieces but they do not talk to each other: the second brain organises ideas (ADR-119), the library lists 39 open-source tools (ADR-125), ORACLE reads 17 keyless sources (ADR-114, ADR-115, ADR-122), PRIME runs nine helpers and checked missions (ADR-118, ADR-121), and 52 decision records explain why each part exists.

## Decision
1. A new page, `omega-ops-room-v1/omega-knowledge.html`, with its engine in `scripts/lib/knowledge-domain.mjs` (no imports, inlined by `scripts/build-knowledge-inline.mjs` together with a registry read from `deep-research.mjs`, `second-brain.mjs`, `agent-core.mjs` and `docs/adr`). The second brain and agent core engines are inlined too (their build scripts now list this page).
2. One typed graph: 15 domains, 8 pages, PRIME and 9 helpers, 17 open sources, 49 tools (the library plus 10 knowledge-graph tools), every ADR, and the ideas and themes of this browser. Fixed-table links and word links are told apart, and each says why it exists.
3. Analysis on the device: weighted PageRank, Brandes betweenness (bridges), Adamic-Adar missing links (idea → tool, source or agent), fixed-rule gaps per domain.
4. Ask the domain: personalised PageRank from the question's words returns a context pack (domains, ideas, tools, sources, agents, pages, decisions) with the path that explains each answer, and a design brief.
5. Plan with the agents: a draft from the pack's agents, reviewed by one fixed rule per helper (recall first; ORACLE when sources answer; sentinel for world and cyber questions; audit and the risk gate, which can only stop, for any trading question; the paper executor opens nothing from a plan; the note last). PRIME's `checkPlan` must pass. "Send to PRIME" stores the plan under `omega-know-plan-v1`; the Ops Room offers it in the mission list only after its own `checkPlan`, and it starts only when Ahmad presses Start mission.
6. Optional enrichment: after a confirm, the 15 domain names (never his ideas) go to Wikidata `wbsearchentities` and OpenAlex `/topics`, both keyless with browser CORS. The CSP names exactly these two hosts. Answers keep the source and the date read.
7. Exports: an Obsidian / Foam style Markdown file with `[[links]]` per domain, and JSON (`omega-knowledge-graph-v1`).
8. The suite switcher on every page, the service worker shell and the Pages build list the new page. A project skill `omega-knowledge-domain` (text rules only, written from this code) is added.

## Open-source research and licences (read 2026-10-24)
| Item | Licence | Use here |
|---|---|---|
| Wikidata | CC0 (data) | optional entity lookup |
| OpenAlex | CC0 (data) | optional topic lookup and works count |
| graphology, sigma.js, Cytoscape.js | MIT | ideas for a larger graph view |
| Oxigraph | MIT OR Apache-2.0 | idea: local SPARQL store |
| QLever | Apache-2.0 | idea: offline Wikidata with SPARQL |
| Apache Jena | Apache-2.0 | idea: reasoning |
| LightRAG, GraphRAG (Microsoft) | MIT | idea: graph retrieval with the local Ollama |
| Docling | MIT | idea: PDFs into the second brain |
| txtai | Apache-2.0 | idea: on-device semantic search |
| Kùzu | MIT | rejected: repository archived in October 2025 |

Sources: the projects' repositories; The Register, 2025-10-14, on Kùzu being abandoned.

## Not done, and why
- Nothing was installed. "Install the tools" is answered with proposals marked «قيد الموافقة»: Oxigraph or QLever, LightRAG with Ollama, Docling. Each needs Ahmad's approval and a written security review (AGENTS.md §1).
- No language model writes links or plans; word matching cannot see meaning across languages without shared words. Every word link, rank, prediction, brief and plan is [INFERENCE].
- No order, signing or money path exists. Trading stays paper only.

## Consequences
- `node scripts/build-knowledge-inline.mjs --check` fails when a new ADR is added until the page is rebuilt, so the graph never silently misses a decision. CI runs `node scripts/test-knowledge.mjs` (19 tests).
- The Ops Room gains one mission option, guarded by the same checker as its templates.
