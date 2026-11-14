---
name: replica-plan-order
description: Deterministic ordering and choice over the repository's engines - Kahn's topological order of chosen skills and everything they load (from each skill's own sys.path lines, EXTRACTED), in layers with ties by name and any cycle named rather than broken; a behaviour tree of Sequence and Fallback nodes that reads the unified workbench as one task, where a locked approval keeps it running until Director 00 decides; and UCB1 (the UCT rule at one node) over the person's own record of tries, untried plans first, for the three ALT3 meta-code plans. Standard-library Python only; it reads the skills' files for the dependency snapshot and fetches nothing.
---

# replica-plan-order

```bash
python3 .claude/skills/replica-plan-order/plan_order.py deps --root . --out jarvis/app/data/skill-deps.json
python3 .claude/skills/replica-plan-order/plan_order.py run '{"mode":"skills","names":["replica-polymath-engine"]}' --deps jarvis/app/data/skill-deps.json
python3 .claude/skills/replica-plan-order/plan_order.py run '{"mode":"workbench","request":{"task":"Install n8n"}}'
python3 .claude/skills/replica-plan-order/plan_order.py run '{"mode":"plans","prompt":"Build a login page","record":{"speed":{"visits":3,"reward":2}}}'
python3 -m unittest discover -s .claude/skills/replica-plan-order/tests
```

## Rules

- Kahn's order puts every skill after what it loads. Ties go by name, so the same input gives the same order. A cycle is listed in `cycle` and its members are left out of `order`; nothing is dropped to make it fit.
- A dependency is EXTRACTED only from a skill's own `sys.path` lines. No dependency is guessed.
- Sequence stops at the first child that is not success; Fallback stops at the first that is not failure. A leaf with no value is failure.
- In the workbench tree, a stage that ran is success, an optional stage (design, maths, atlas, security) that was skipped is success through its Fallback, a refused stage is failure, and the approvals leaf is running while any step is locked. Running is never turned into success.
- UCB1 uses only the visits and rewards the person types. With no record every plan is untried and the first is tried first. The choice carries [INFERENCE]; it is a suggestion, and every plan's locked steps stay locked.
- Same answers as `jarvis/server/lib/plan-order.mjs`: `tests/golden.json`.
