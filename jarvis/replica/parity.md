# Parity: Jarvis (ADR-133)

Made by `python3 .claude/skills/replica-diff/parity.py jarvis/replica/features.csv --markdown` on 2026-11-04.

Jarvis is an original product, so "original" in `features.csv` means "in Jarvis's planned scope". This is
the feature score only: there are no reference screenshots, so no layout diff (by design). The three
must-haves still open are all phase 2 work, said plainly in their notes:
agent editing, real (not simulated) runs, and a multi-workspace switcher.

## Score: 83.2 / 100

features 83.2  (43 counted, must-haves 21 of 24 done)

Not shippable yet: 3 must-have features are not done.

## By area, weakest first
- workflows                      0.0  (2 features)
- i18n                           0.0  (1 features)
- integrations                   0.0  (1 features)
- runs                          38.9  (5 features)
- overview                      75.0  (2 features)
- agents                        75.0  (4 features)
- settings                      75.0  (2 features)
- shell                         92.5  (7 features)
- approvals                    100.0  (3 features)
- quality                      100.0  (5 features)
- studio                       100.0  (7 features)
- skills                       100.0  (3 features)
- logs                         100.0  (1 features)

## Missing, in build order
- [must] agents: Create and edit an agent with validation, partial  (S05 F01; create with validation done; editing comes with the phase 2 API)
- [must] runs: Run an agent and watch the run timeline, partial  (S08 F01; the timeline and log are live, but the run is simulated (no model or tool called) until the phase 2 runtime)
- [must] shell: Workspace switcher, partial  (S01; phase 1 has one workspace; its name shows in the top bar; switcher pattern built on /design)
- [should] workflows: Workflow canvas with inspector, no  (S07 F03; phase 2)
- [should] workflows: Workflows list, no  (S06; phase 2)
- [should] runs: Cost and duration per run, partial  (S08; duration shown; cost needs the phase 2 runtime)
- [should] runs: Live log streaming in the run view, partial  (S08; updates live from the simulated run; real streaming is phase 2 (SSE on loopback))
- [should] settings: Settings: workspace members and roles, partial  (S11; members listed; inviting and roles are phase 2)
- [could] agents: Agent templates gallery, no
- [could] i18n: Arabic translation, no  (after RTL layout)
- [could] integrations: Webhooks out, no
- [could] overview: Usage analytics charts, no
- [could] runs: Run comparison side by side, no
- [could] runs: Scheduled runs, no

## Left out on purpose (not scored)
- Third-party marketplace and app network of any other product: their network is not something to rebuild
- Agents that sign orders or move real money: locked by AGENTS.md §1 until separate approval and reviews
