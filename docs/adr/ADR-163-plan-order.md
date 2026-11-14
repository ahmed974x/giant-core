# ADR-163: Plan order (Kahn, behaviour tree, UCB1)

Date: 2026-11-14 · Status: Proposed. Ahmad's page of 2026-11-14 asked for the three ideas offered after ADR-162: Kahn's order for the skills in the composer, Sequence and Fallback nodes for the workbench stages, and UCT to choose a plan. The search half of that page (BM25 with RRF) is ADR-164.

## Decision

1. **One engine, three rules.** `jarvis/server/lib/plan-order.mjs` is pure. It is inlined into the page in its own scope, and `.claude/skills/replica-plan-order/plan_order.py` gives the same answers (`tests/golden.json`, 97 requests).
2. **Kahn's order.** `kahnOrder(nodes, edges)` places, layer by layer, every node whose dependencies are placed, sorted by name, so one input always gives one order.
   - A node left over sits on a cycle or behind one. It is listed in `cycle` and left out of `order`; no edge is dropped to make the graph fit.
   - `orderKept` checks on its own that every edge between two placed nodes runs forwards. `verified` is that check.
3. **Skill dependencies are read, not guessed.** `plan_order.py deps` reads each skill's own Python files and records the other skills named in its `sys.path` statements (EXTRACTED). It writes `jarvis/app/data/skill-deps.json`: 59 skills, 21 links today.
   - `skillOrder` adds everything the chosen skills load and orders the lot.
   - The server reads the snapshot from disk. A `deps` field in the request is ignored.
4. **Behaviour tree.** `tickTree` ticks Sequence and Fallback nodes over leaves that are `success`, `failure` or `running`.
   - Sequence stops at the first child that is not success; Fallback stops at the first that is not failure. A leaf with no value is failure.
   - At most 8 levels, 100 nodes and 20 children a node.
5. **The workbench as a tree.** `workbenchTree` runs the ADR-160 workbench, then reads it as one Sequence:
   - the shield, the meta-codes and the request as leaves;
   - design, maths, atlas and security as Fallbacks of "ran" or "skipped";
   - the approvals last.

   A refused stage fails the tree at that stage (`stopped_at`). A locked step keeps the approvals leaf `running` until Director 00 decides. Running is never shown as success. The workbench itself still runs every stage; the tree says whether the whole task is done.
6. **UCB1.** UCT's rule at one node, over the person's own record only.
   - An arm with no tries is tried first, in the order given.
   - Otherwise the score is mean + c · √(ln N / n), with c from 0 to 4 (√2 by default). Equal scores keep the given order.
   - With the meta-codes (ADR-156) the arms are the three ALT3 plans, each still proved. The choice carries [INFERENCE] and changes no lock.
7. **Server:** `POST /api/w/:slug/order` with `mode` `kahn`, `skills`, `tree`, `workbench`, `uct` or `plans`. The event log records `order.<mode>` with counts or the tree's status only, never the task.
8. **Page:** `#/order` has three panels: order of skills (layers, cycle, how many were added), the workbench tree (nested Sequence and Fallback lists with each status, where it stopped, the locked count, the workbench chain hash) and the plan choice (your record, the scores, the reason).

## Not done

- **A search tree.** Full Monte Carlo tree search needs a simulator of outcomes, and none exists here that would not be invented. Only the one-node rule is used, on numbers the person types.
- **The name.** Ahmad's page offered four names with «أثير برايم» selected by default. A default in a form is not a choice, so the product stays «Jarvis» until Ahmad names one.

## Consequences

- The skill order is only as fresh as `skill-deps.json`. After a skill's Python files change, run `plan_order.py deps` and rebuild the page.
- The mutation list in CLAUDE.md adds `plan-order.mjs` and `plan_order.py`.
