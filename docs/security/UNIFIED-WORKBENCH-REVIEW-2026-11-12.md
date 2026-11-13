# Security review: the unified workbench (ADR-160)

Date: 2026-11-12 · Reviewer: Claude Code, cloud sandbox.

## 1. Files

| File | Lines | SHA-256 (first 16) | Role |
|---|---|---|---|
| `jarvis/server/lib/unified-workbench.mjs` | 85 | 3da61ee5f34729f0 | The seven-stage pipeline, the joined plan and the chain hash |
| `.claude/skills/replica-unified-workbench/unified_workbench.py` | 149 | 6d9ccf70b9aada31 | The same pipeline in Python, over the reviewed skills |
| `.claude/skills/replica-unified-workbench/tests/test_unified_workbench.py` | 68 | 5749a0e689dc9eb6 | 7 unit tests, one against the server's golden answers |
| `.claude/skills/replica-unified-workbench/tests/golden.json` | — | bc20f41f356fb27a | 37 requests with the server's answers |

Also changed:
- `server.mjs`: `POST /api/w/:slug/workbench/run`;
- `app.js`, `shell.tmpl`, `i18n-ar.json`: the `#/workbench` page;
- `build-app.mjs`: inlines the engine after the maths scope; `LlmPlan` now also exposes `sha256Hex`;
- `bilingual-purity.mjs`: adds `workbench` to the routes;
- the server, flow, live and mutation tests.

## 2. What it can do

- **Nothing new is reached.** The engine only calls functions that were already reviewed (ADR-150, ADR-153, ADR-154, ADR-156, ADR-158, ADR-159). It opens no socket, starts no process and writes no file. A unit test checks the Python file for the words that would.
- **The shield comes first.** The task is cleaned before the meta-codes, the request body or the event log see it. A test checks that an e-mail address in the task appears nowhere in the answer. The secret check gives the SHA-1 prefix only, and `looked_up` is false.
- **Locks** are carried from every stage into one plan and proved. A test checks there is at least one outbound and one install lock in a full run, and that every lock is pending approval.
- **Errors stay in their stage.** An engine's 400 becomes that stage's `error`. Any other exception still fails the request, so a real bug is not hidden.
- **Test data:** the key-shaped probe in `golden.json` is stored with a JSON `\u002d` escape, so no file holds key-shaped text.
- **Event log:** `workbench.run` with the number of stages, the number of locks and the verdict, never the task. A test checks the task text is absent.
- **Page:** text goes in with `textContent`; the stage links are fixed `#/…` routes. The page runs the same engine in sample mode.

## 3. Cost

A full run is measured at 8 ms on the sandbox:
- every stage is used;
- CSS of 200 rules;
- 40 findings.

Every input keeps its engine's bounds, and the task is at most 4,000 characters.

## 4. Honesty

- **Each summary** is the engine's own answer, not a new number.
- **Savings** appear only with a typed price; otherwise the page says there is no figure.
- **The maths stage** returns the solver's checks; the drawing stays in the Math lab, and the ADR says so.

## 5. Checks

| Check | Result |
|---|---|
| `python3 -m unittest discover -s .claude/skills/replica-unified-workbench/tests` | 7 tests OK; Python gives the server's answers to all 37 golden requests |
| `ruff check .claude/skills/replica-unified-workbench` | all checks passed |
| `node jarvis/scripts/mutation-harness.mjs` | `unified-workbench.mjs` 42/42 killed |
| `python3 jarvis/scripts/mutation_harness.py` | `unified_workbench.py` 56/56 killed |
| `node scripts/skillspector-audit.mjs --strict` on the changed files | 0 critical, 0 high |

The mutation run found a dead guard around the maths input; the solver already refuses anything that is not a task, so the guard was removed.

## 6. Decision

Added. The skill is safe to run on Ahmad's machine as written.
