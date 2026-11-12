# Parity: Jarvis (ADR-159)

Made by `python3 .claude/skills/replica-diff/parity.py jarvis/replica/features.csv --markdown` on 2026-11-06.

Jarvis is an original product, so "original" in `features.csv` means "in Jarvis's planned scope". This is
the feature score only: there are no reference screenshots, so there is no layout diff (by design).

**Every feature in scope is done: weighted 100.0, must-haves 34 of 34.** ADR-137 built the eleven rows that were open in ADR-136:
- workflows S06 and S07;
- server push (SSE);
- members and roles;
- cost per run;
- the full Arabic interface;
- run comparison;
- the agent templates gallery;
- scheduled runs;
- webhooks;
- analytics.

It also added one row: creator mode with draft plans and the token ledger.

ADR-138 added four rows, all built and tested (`test-app.mjs` F16, `test-live.mjs`, server tests):
- the memory bank with BM25 search;
- model examples from memory;
- self-check sessions and the JSONL export;
- the live Skill Forge.

ADR-139 added four rows, all built and tested (`test-app.mjs` F17, `test-live.mjs`, server tests):
- live open-web search;
- package and code search;
- the OSV vulnerability lookup;
- the offline fallback and search memory.

ADR-140 added two rows, both built and tested (`test-app.mjs` F18, `test-live.mjs`, server tests):
- the OpenAI-compatible local engine;
- streamed model answers.

ADR-141 added two rows, both built and tested (`test-app.mjs` F19, `test-live.mjs`, server tests):
- the founder-only sign-in gate;
- locked public access and hosted endpoints.

ADR-142 added two rows, both built and tested (`test-app.mjs` F20, `test-live.mjs`, server tests):
- live skill discovery and import from GitHub;
- skill synthesis and evolution (FIX / DERIVED / CAPTURED).

ADR-143 added two rows, both built and tested (`test-app.mjs` F21, `test-live.mjs`, server tests):
- the Governance page with the knowledge map and the quality gate;
- the open-weight model catalog.

ADR-144 added three rows, all built and tested (`test-app.mjs` F22–F25, `test-live.mjs`, server tests):
- the council of agents for plans and designs;
- the Studio time machine with the side-by-side diff and fork;
- the UX heatmap with Fitts and Hick.

ADR-145 added three rows, all built and tested (`test-app.mjs` F26–F27, `test-live.mjs`, server tests, skill unit tests):
- the Ctrl+K macro composer with a formal proof;
- the Studio 5-in-1 export;
- the formal verification and mutation audit skill.

ADR-146 added two rows, both built and tested (`test-app.mjs` F28, the two mutation harnesses, skill unit tests):
- the UI-state gate for buttons and fields;
- measured mutation testing of the security core.

ADR-147 added three rows, all built and tested (`test-app.mjs` F29, `test-live.mjs`, server tests, skill unit tests):
- the telemetry chart with LTTB and anomaly marks;
- the Merkle audit tree with inclusion proofs;
- the time-series maths skill.

ADR-148 added two rows, both built and tested (`test-app.mjs` F30, `test-live.mjs`, server tests):
- the readiness of the five layers;
- the scrubbed diagnostic bundle.

ADR-149 added three rows, all built and tested (`test-app.mjs` F31, `test-live.mjs`, skill unit tests, the mutation run):
- windows that follow each other;
- compressed Studio templates;
- the quantum-math skill.

ADR-150 added four rows, all built and tested (`test-app.mjs` F32, `test-live.mjs`, server tests, skill unit tests, the mutation run):
- plan reversal (sensitive steps locked after the fact);
- template reversal;
- the Autonomous Reversal Log;
- the reversal-engine skill.

ADR-151 added two rows, both built and tested (`test-app.mjs` F33, `test-live.mjs`, server tests):
- the bilingual purity gate;
- the local model answering in the chosen language.

ADR-152 added three rows, all built and tested (`test-app.mjs` F34, `test-live.mjs`, server tests, skill unit tests, the mutation run):
- passive recon of registration and certificate logs;
- passive recon of security headers and security.txt;
- the passive-recon skill.

ADR-153 added two rows, both built and tested (`test-app.mjs` F35, `test-live.mjs`, server tests, skill unit tests, the mutation run):
- auto-heal contrast in the Studio;
- contrast healing in the reversal engine.

ADR-154 added two rows, both built and tested (`test-app.mjs` F36, `test-live.mjs`, server tests, skill unit tests, the mutation run):
- the math lab with checked steps;
- the universal maths API and skill.

ADR-155 added two rows, both built and tested (`test-app.mjs` F37, `test-live.mjs`, server tests, skill unit tests, the mutation run):
- hyper studio projections from 3D to 8D;
- hyper studio optics and game physics.

ADR-156 added one row, built and tested (`test-app.mjs` F38, `test-live.mjs`, server tests, skill unit tests, the mutation run):
- prompt meta-codes with three proved plans.

ADR-157 added two rows, both built and tested (`test-app.mjs` F39, `test-live.mjs`, server tests, skill unit tests, the mutation run):
- typeset formulas in the Math lab;
- cinematic presets with healed light colours.

ADR-158 added two rows, both built and tested (`test-app.mjs` F40, `test-live.mjs`, server tests, skill unit tests, the mutation run):
- the FOSS atlas with read licences;
- the stack planner and privacy shield.

ADR-159 added two rows, both built and tested (`test-app.mjs` F41, `test-live.mjs`, server tests, skill unit tests, the mutation run):
- the universal agent's request builder and router;
- its checks and the review register.

Each row is covered by a flow test (`test-app.mjs` F13–F15, `test-live.mjs`) and by server tests on SQLite and PostgreSQL 16.

Two rows stay out of the score on purpose, as before:
- another product's marketplace;
- agents that move real money (AGENTS.md §1).

## Score: 100.0 / 100

features 100.0  (109 counted, must-haves 34 of 34 done)

## By area, weakest first
- shell                        100.0  (8 features)
- overview                     100.0  (2 features)
- agents                       100.0  (7 features)
- runs                         100.0  (6 features)
- approvals                    100.0  (3 features)
- quality                      100.0  (13 features)
- studio                       100.0  (19 features)
- skills                       100.0  (6 features)
- backend                      100.0  (1 features)
- missions                     100.0  (9 features)
- settings                     100.0  (3 features)
- workflows                    100.0  (2 features)
- logs                         100.0  (1 features)
- i18n                         100.0  (2 features)
- integrations                 100.0  (3 features)
- memory                       100.0  (3 features)
- search                       100.0  (4 features)
- models                       100.0  (4 features)
- access                       100.0  (2 features)
- governance                   100.0  (1 features)
- analytics                    100.0  (1 features)
- security                     100.0  (4 features)
- diagnostics                  100.0  (3 features)
- platform                     100.0  (2 features)

## Missing, in build order
- nothing. Every counted feature is done.

## Left out on purpose (not scored)
- Third-party marketplace and app network of any other product: their network is not something to rebuild
- Agents that sign orders or move real money: locked by AGENTS.md §1 until separate approval and reviews
