---
name: replica-formal-verify
description: Proves properties of a plan or workflow by breadth-first search over its state machine - no deadlock, every step reachable, and no money, publish, permissions, install or outbound effect reachable without a locked approval (with a counterexample path when it is) - checks that UI components have default, hover, focus-visible, loading, empty, error and locked states, and lists the mutants of a Python module with a static test-strength estimate. Standard-library Python only; no network, no processes.
---

# replica-formal-verify

```bash
python3 .claude/skills/replica-formal-verify/state_prover.py --plan plan.json
python3 .claude/skills/replica-formal-verify/state_prover.py --machine machine.json --json
python3 .claude/skills/replica-formal-verify/state_prover.py --ui jarvis/app/src/app.css --components btn,input,select
python3 .claude/skills/replica-formal-verify/mutation_audit.py .claude/skills/replica-ux-physics/ux_physics.py --tests .claude/skills/replica-ux-physics/tests
python3 -m unittest discover -s .claude/skills/replica-formal-verify/tests
```

## The state machine of a plan

`start`, one state per step, an effect state `e<i>` after each sensitive approval, and the terminals `done` and `stopped`. Steps follow their `depends`; a gate can fail to `stopped`; an approval can be rejected to `stopped`, and a sensitive one reaches its effect only on `approved`.

| Property | How it is proved |
| --- | --- |
| Deadlock freedom | every reachable state that is not a terminal has a way out |
| Reachability | every step is reached from `start`, and `done` is reachable |
| Safety (AGENTS.md §1) | remove the locked approval states and search again: no effect may be reached; if one is, the path to it is printed |

The search is exhaustive over a finite graph, so "verified" is a proof for the machine as built, not a test of a few runs. It says nothing about what a tool does inside a step.

`jarvis/server/lib/prover.mjs` runs the same algorithm in the Jarvis Ctrl+K macro composer and on the server. Keep the two in step.

## UI states

`--ui` reads the CSS selectors that name each component (variants such as `btn-primary` count) and looks for `:hover`, `:focus-visible`, `[aria-busy]`, an empty state, `[aria-invalid]` or `.err`, and `:disabled` or a locked mark. A page-wide `:focus-visible` or `.empty-state` counts for every component. It is a report: not every component needs every state.

## Mutation audit

`mutation_audit.py` flips comparisons, swaps arithmetic and `and`/`or`, negates conditions, changes booleans and integers, and makes returns `None`. It runs nothing. The strength figure is a static estimate [INFERENCE]: a mutation point counts when a test calls its function, or a function that calls it, and asserts. Callbacks that a library calls (such as `HTMLParser.handle_starttag`) are not seen. `--out` writes each mutant as a copy inside `--root`, so a person can run the real tests on them and measure the true kill rate.
