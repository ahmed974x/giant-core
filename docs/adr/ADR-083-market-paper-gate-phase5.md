# ADR-083: Agents phase 5: the market agents and the paper gate (two keys and an owner)

Date: 2026-10-16 · Status: Proposed (draft PR, not merged)

## Context
Phase 5 of ADR-077 section 3 and 8. Phases 1 to 4 (ADR-079 to ADR-082) give the event log, the gateway, memory,
the second brain and the loop. The coordinator asked for phases 4 to 7 on the draft branch with no execution path.
The paper-trading MVP lives on `feat/paper-trading-mvp` and is not merged here, so this phase links to no account.

## Decision
- **Schema `prop`** (`db/init/09-market.sh`), one table: `prop.proposals`. Long setups only (stop < entry < target),
  size held between 50 and 200 USDT in paper units, the reward-to-risk computed in SQL.
- **Two keys and an owner.**
  - فهد (`proposals.add`, sole holder) packs an idea with its evidence (a link or an event id). Refused without evidence.
  - راشد (`risk.check`, sole holder after this change) passes a proposal only at a reward-to-risk of 2 or more.
    A thin setup gets `risk_fail` with the reason; it is kept, not deleted.
  - The owner decides (`prop.decide`). No agent holds the grant, and the function refuses agent callers. It accepts
    only a checked proposal (`risk_pass`).
- **Immutable proposals.** A trigger refuses any change to the numbers, refuses deletes, and makes a decided proposal
  final. A new idea is a new row.
- **No execution path.** The `prop` schema holds one table and no function whose name suggests an order, a fill, a
  transfer or a sale. The test checks that. `approved` means approved on paper; nothing reads it to act.
- **Public queue.** `api.prop_queue` (titles, numbers, status, the risk reason; no rationale, no evidence) for the
  owner's page. `web_anon` never reads the table.
- **Audit.** Events carry ids and numbers (`proposal.created`, `proposal.checked`, `human.decided`), never a title
  or a rationale. A key pasted into a proposal is refused and nothing is stored.

## Deviations from the design
- `risk.check` is now a sole-holder tool (rashid) and a write. The seed had no holder, so any agent could have been
  granted the check. The sole-holder rule caught it in the test.
- The rr check uses the rule from ADR-073 (2 or more). The RR unit is still the open question for Ahmad; the gate
  follows the working reading (risk/reward) until he confirms.
- Linking a proposal to the paper account waits for the paper-trading MVP to be merged. Nothing here calls it.

## Consequences
- The suite (`scripts/test-nerve.sh`) runs 05 to 09 twice and tests the market gate (`db/test/market_test.sql`, 40
  checks) with the other schemas. All pass.
- Not live on the laptop: no Docker in the cloud sandbox, so the compose stack is unverified for this phase.
