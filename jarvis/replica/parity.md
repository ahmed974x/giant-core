# Parity: Jarvis (ADR-140)

Made by `python3 .claude/skills/replica-diff/parity.py jarvis/replica/features.csv --markdown` on 2026-11-05.

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

Each row is covered by a flow test (`test-app.mjs` F13–F15, `test-live.mjs`) and by server tests on SQLite and PostgreSQL 16.

Two rows stay out of the score on purpose, as before:
- another product's marketplace;
- agents that move real money (AGENTS.md §1).

## Score: 100.0 / 100

features 100.0  (65 counted, must-haves 34 of 34 done)

## By area, weakest first
- shell                        100.0  (7 features)
- overview                     100.0  (2 features)
- agents                       100.0  (5 features)
- runs                         100.0  (6 features)
- approvals                    100.0  (3 features)
- quality                      100.0  (5 features)
- studio                       100.0  (9 features)
- skills                       100.0  (4 features)
- backend                      100.0  (1 features)
- missions                     100.0  (6 features)
- settings                     100.0  (3 features)
- workflows                    100.0  (2 features)
- logs                         100.0  (1 features)
- i18n                         100.0  (1 features)
- integrations                 100.0  (1 features)
- memory                       100.0  (3 features)
- search                       100.0  (4 features)
- models                       100.0  (2 features)

## Missing, in build order
- nothing. Every counted feature is done.

## Left out on purpose (not scored)
- Third-party marketplace and app network of any other product: their network is not something to rebuild
- Agents that sign orders or move real money: locked by AGENTS.md §1 until separate approval and reviews
