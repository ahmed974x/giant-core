# Security review: the mutation harnesses and the UI-state gate (ADR-146)

Date: 2026-11-06 · Reviewer: Claude Code, cloud sandbox.

## 1. Files

| File | Lines | SHA-256 (first 16) | Role |
|---|---|---|---|
| `jarvis/scripts/mutation-harness.mjs` | 255 | e5b391d97f222fcd | JavaScript mutants, oracles, worker threads |
| `jarvis/scripts/mutation_harness.py` | 215 | b57bbf99a3ca3591 | Python mutants, oracles, `runpy`, the joined log |
| `jarvis/replica/ui-states.json` | 6 | (data) | Required states per component |

`state_prover.py` gains `--spec` and `mutation_audit.py` gains `--functions` and `--evidence`. Both stay in the skill, run nothing and import nothing they read.

## 2. What runs, and why it is safe

- **Only this repository's own code runs, changed by one operator.** The mutants are written by the harness from files in the repository. Nothing is downloaded, and no model output or user input reaches them.
- **No process is started.** JavaScript mutants are imported in a `worker_thread` that is terminated after 4 seconds. Python mutants are loaded with `runpy.run_path` under a 3-second `SIGALRM`. There is no `child_process`, `subprocess`, `exec` or `eval`.
- **Writes:** a temporary folder (removed in `finally`), `jarvis/replica/evidence/mutation-js.json` and `jarvis/replica/evidence/mutation-audit.log`.
- **These are developer tools.** They live in `jarvis/scripts/`, not in a skill and not in the server; Jarvis never runs them.

## 3. Honesty of the number

- The score is killed ÷ (all − equivalent). An equivalent mutant must have a written reason in the harness and is listed in the log. None is counted as killed.
- The log records each tested file's SHA-256. The page and `mutation_audit.py --evidence` show [VERIFIED] only while every hash matches.
- The oracles were tightened until every surviving mutant was either killed or shown to be equivalent. Two real defects surfaced and were fixed in code, not suppressed: the `100::/64` check in the SSRF shield, and a crash in the JavaScript prover.

## 4. The UI-state gate

The CSS adds selectors only, with existing tokens. No new colour pair is introduced, and the contrast gate passes. The busy state has no animation.

## 5. Checks

| Check | Result |
|---|---|
| `node scripts/skillspector-audit.mjs --strict jarvis/scripts/mutation-harness.mjs jarvis/scripts/mutation_harness.py .claude/skills/replica-formal-verify` | 0 critical, 0 high |
| `ruff check jarvis/scripts/mutation_harness.py .claude/skills/replica-formal-verify` | all checks passed |
| `node jarvis/scripts/mutation-harness.mjs && python3 jarvis/scripts/mutation_harness.py` | 493/493 killed, 15 equivalent |
| `state_prover.py --ui jarvis/app/src/app.css --spec jarvis/replica/ui-states.json` | 27/27, gate passed |

## 6. Limits, said plainly

- A mutation score measures the oracles against these operators, not every possible fault.
- The targets are the five most security-relevant sets of functions, not the whole code base.

## 7. Decision

Added as developer tools. A later change needs a new entry here.
