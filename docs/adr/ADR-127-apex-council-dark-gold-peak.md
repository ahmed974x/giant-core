# ADR-127: APEX council: one lead and fifteen field helpers, and the dark gold peak tone

Date: 2026-10-24 · Status: Proposed (Ahmad's message of 2026-10-24 23:18Z; merge waits for his go). Stacked on ADR-126 (PR #46), which sits on ADR-125 (PR #45) and ADR-124 (PR #44).

## Context
Ahmad asked for a "legendary" AI and site: think outside the box, research open source, design the lead agent and helpers "for every field", link them to the network and threads, organise his ideas, and design a "dark golden peak" (الذروة الذهبية المظلمة) look for the whole site. There is no hidden secret that makes an agent legendary and closed models cannot be copied, so the answer is concrete: a lead that routes work to one specialist per field with fixed, readable rules, built on PRIME and its nine helpers (ADR-118, ADR-121) and the fifteen knowledge domains (ADR-126), plus a third look for every page that passes the same contrast gate.

## Decision
1. A new page, `omega-ops-room-v1/omega-apex.html`, with its engine in `scripts/lib/apex-council.mjs` (no imports, inlined by `scripts/build-apex-inline.mjs` with a registry from the knowledge domains, ORACLE's sources, PRIME's helpers and tools, and the library). `connect-src 'none'`.
2. Fifteen field helpers, one per domain, each with a role, its open sources, an ORACLE mode and lens, its pages, its partners among PRIME's helpers, tools to study (ideas only) and one rule it never breaks (for example: the threat analyst is passive only; the medical researcher says the brief is not medical advice; the agent engineer never copies a closed model).
3. The council: a question is routed by shared words (hits / sqrt(question size), plus one point per source named, normalised to shares); fields with a share of at least 12 % take a seat, five at most; with no shared word the knowledge keeper takes it and says so. Each seat writes a brief from fixed tables. PRIME's helpers review with fixed rules: risk can only stop, the auditor checks that every source is keyless and nothing is installed, the sentinel keeps OSINT passive, the paper executor opens nothing from a plan. APEX drafts a PRIME plan (recall first, the partners' tools, ORACLE when sources answer, sentinel for world questions, audit and the risk gate after every market reading for trading questions, note last, at most 12 steps) that `OMEGA_CORE.checkPlan` must accept. The plan can be left for PRIME under `omega-know-plan-v1` (the Ops Room's existing knowledge mission slot, ADR-126), and runs only when Ahmad presses Start.
4. Ideas: the same router files the second brain's ideas into each helper's inbox; ideas that share no word with any field stay open.
5. Thread network: an SVG with APEX at the centre, PRIME's nine helpers, the fifteen field helpers and ORACLE's sources, joined only by the links the tables hold (leads, seats, partners, feeds), drawn as cubic Béziers; the last council's seats light by their share. Nodes are tappable and listed in a select; no text inside the SVG.
6. The dark gold peak: a tone over the dark theme, `:root[data-theme="dark"][data-tone="gold"]`, with warm near-black surfaces, gold as the one accent and ivory text; status colours keep their meaning and the vivid `--apple-*` chart colours are unchanged. It is on all eight Ops Room pages and NABD, stored under `omega-tone`, painted before first render, synced over the suite channel, and switched from a button at the top of the app switcher (and a segmented control on the APEX page, `?tone=gold` for one visit). `audits/verify-contrast.mjs` now checks gold and gold-P3 as two more modes and reads every `@media (color-gamut: p3)` block; every page passes. `scripts/ui-three-sizes.mjs` adds gold as a third look.
7. Fix found on the way: the theme button on the core, second brain and knowledge pages had no click handler (it changed nothing when pressed). Those buttons now carry `data-suite-toggle` and the shared suite script toggles them.
8. The suite switcher, the service worker shell, the Pages build and the knowledge domain's page list (now nine pages) include APEX.

## Open-source research (read 2026-10-24, ideas only)
| Field | Tool | Licence | Source read |
|---|---|---|---|
| Markets | Qlib | MIT | gitee mirror of microsoft/qlib |
| Risk | PyPortfolioOpt | MIT | project README |
| Oil and energy | PyPSA | MIT | docs.pypsa.org licence page |
| Seas | MovingPandas | BSD-3-Clause | ecosyste.ms summary |
| Cyber | Wazuh | GPL-2.0-only | opentechhub.io |
| Space | Skyfield | MIT | PyPI |
| News | Trafilatura | Apache-2.0 from v1.8.0 (GPLv3+ before) | PyPI |
| Vision | supervision | MIT | project docs |
| AI | DSPy | MIT | ecosyste.ms summary |
| AI | Langfuse | MIT outside the /ee folders | langfuse.com open-source page |
| Knowledge | Zotero | AGPL-3.0 | Wikipedia |
| Knowledge | Paperless-ngx | GPL-3.0 | opentechhub.io |
| Design | Open Props | MIT | npm |
| Security | OpenSSF Scorecard | Apache-2.0 | pkg.go.dev |
| Medicine | scispaCy | Apache-2.0 | ecosyste.ms |
| Science | SymPy | BSD-3-Clause | project repository |

Riskfolio-Lib was left out: the sources read disagree on its licence.

## Not done, and why
- Nothing was installed. Every tool above is «قيد الموافقة» and needs Ahmad's approval and a written security review; OpenSSF Scorecard is listed as the first look that review would take.
- No "hidden secrets" and no copy of a closed model: APEX is written rules over words, with no language model. Routes, shares, briefs, inboxes and plans are [INFERENCE].
- No order, signing or money path exists. Trading stays paper only; real or Testnet trading stays locked.
- OSINT stays passive: no address, person or account lookups, no dark web.

## Consequences
- CI runs `node scripts/test-apex.mjs` (engine, plans through checkPlan, inboxes, network, the page's inline copy, the gold tone and one suite copy on every page).
- `node scripts/build-apex-inline.mjs --check` fails when the engine or its registries change until the page is rebuilt.
- The suite script is still copied into each page; a change to it must be applied to all eight pages and `site-landing/suite.js` (the test checks that the copies match).
