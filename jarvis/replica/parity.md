# Parity: Jarvis (ADR-135)

Made by `python3 .claude/skills/replica-diff/parity.py jarvis/replica/features.csv --markdown` on 2026-11-05.

Jarvis is an original product, so "original" in `features.csv` means "in Jarvis's planned scope". This is
the feature score only: there are no reference screenshots, so there is no layout diff (by design).

**Every must-have is done: 34 of 34.** That is the 27 from ADR-134 plus seven added by ADR-135:
- missions in phases;
- evidence gates;
- state capsules;
- context health;
- locked mission steps;
- the agent's long-horizon mode;
- the template extractor.

The weighted score is below 100 because should- and could-haves outside this request are still open:
- workflows (S06, S07);
- the Arabic UI translation;
- run comparison, templates, scheduled runs, webhooks and analytics;
- partial rows: members and roles, server push, model cost.

## Score: 90.3 / 100

features 90.3  (53 counted, must-haves 34 of 34 done)

## By area, weakest first
- workflows                      0.0  (2 features)
- i18n                           0.0  (1 features)
- integrations                   0.0  (1 features)
- runs                          66.7  (6 features)
- overview                      75.0  (2 features)
- settings                      75.0  (2 features)
- agents                        92.3  (5 features)
- shell                        100.0  (7 features)
- approvals                    100.0  (3 features)
- quality                      100.0  (5 features)
- studio                       100.0  (9 features)
- skills                       100.0  (3 features)
- backend                      100.0  (1 features)
- missions                     100.0  (5 features)
- logs                         100.0  (1 features)

## Missing, in build order
- [should] workflows: Workflow canvas with inspector, no  (S07 F03; phase 2)
- [should] workflows: Workflows list, no  (S06; phase 2)
- [should] runs: Cost and duration per run, partial  (S08; duration per step is real; cost is 0 because no model is called yet)
- [should] runs: Live log streaming in the run view, partial  (S08; the page polls a change marker every 1.5 s and redraws; no server push (SSE) yet)
- [should] settings: Settings: workspace members and roles, partial  (S11; members listed per workspace; inviting and changing roles need a second user (not built))
- [could] agents: Agent templates gallery, no
- [could] i18n: Arabic translation, no  (after RTL layout)
- [could] integrations: Webhooks out, no
- [could] overview: Usage analytics charts, no
- [could] runs: Run comparison side by side, no
- [could] runs: Scheduled runs, no

## Left out on purpose (not scored)
- Third-party marketplace and app network of any other product: their network is not something to rebuild
- Agents that sign orders or move real money: locked by AGENTS.md §1 until separate approval and reviews
