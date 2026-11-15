# Security review: the runbook (ADR-165)

Date: 2026-11-14 · Reviewer: Claude Code, cloud sandbox.

## 1. Files

| File | Lines | SHA-256 (first 16) | Role |
|---|---|---|---|
| `jarvis/server/lib/runbook.mjs` | 95 | 232787b35e18024e | The six stages and the page probes, pure |
| `.claude/skills/replica-runbook/runbook.py` | 189 | cfaf2352f74d82c1 | The same in Python, over the reviewed skills |
| `.claude/skills/replica-runbook/tests/test_runbook.py` | 59 | c43b75a84ae4cbe0 | 5 unit tests, one against the server's golden answers |
| `.claude/skills/replica-runbook/tests/golden.json` | — | 7fbaf45362c35927 | 19 requests with the server's answers |

Also changed:
- `server.mjs`: `POST /api/w/:slug/runbook`;
- `app.js`, `app.css`, `shell.tmpl`, `i18n-ar.json`: the `#/runbook` page and the interface name;
- `build-app.mjs`: inlines the engine;
- `bilingual-purity.mjs`: adds `runbook` to the routes;
- the server, flow, live and mutation tests.

## 2. What it can do

- **Read nothing, send nothing.** The engine is pure. The server passes it the three snapshots it already reads for `#/tree`, `#/order` and `#/docs`. The Python `load_context` reads the same three files and nothing else. A unit test checks the Python file for the words that would start a process, open a connection or run text as code.
- **Keep the goal private.** The shield runs before any other stage, so search, the workbench and the plan choice see only the cleaned goal. A secret check keeps only a five-character SHA-1 prefix; the page clears the field after reading it. The event log records counts only, and server tests check that an e-mail address in the goal never reaches the answer or the log.
- **Keep the locks.** Every locked step of the workbench and the plans stays locked. The tree says `running` while any wait, and nothing here approves them.
- **Probe without side effects.** Each page probe is a fixed input to a pure engine. `#/diagnostics` is not probed here, because its checks read the running server.
- **Bounds:** a goal of 1 to 2000 characters; the skills, record and c follow the plan-order limits; search returns at most five results.

## 3. Honesty

- A refused stage is shown as refused, with the engine's own message, and `ready` turns false.
- The plan choice carries [INFERENCE].
- The probe value is a hash of the engine's whole answer, not a score.

## 4. Cost

One run over this repository's snapshots takes about 38 ms on this sandbox, mostly the nine probes.

## 5. Checks

| Check | Result |
|---|---|
| `python3 -m unittest discover -s .claude/skills/replica-runbook/tests` | 5 tests OK; Python gives the server's answers and chain hash for all 19 golden requests |
| `ruff check .claude/skills/replica-runbook` | all checks passed |
| `node jarvis/scripts/mutation-harness.mjs` | `runbook.mjs` 48/48 killed, 2 equivalent with reasons |
| `python3 jarvis/scripts/mutation_harness.py` | `runbook.py` 75/75 killed, 1 equivalent |
| `node scripts/skillspector-audit.mjs --strict` on the changed files | 0 critical, 0 high |

The mutation run found that a probe which reported only pass or fail hid a changed input, so each probe now reports a hash of the engine's whole answer. It also found that the workbench stage could never be refused, so its fallback was removed.

## 6. Decision

Added. The skill is safe to run on Ahmad's machine as written.
