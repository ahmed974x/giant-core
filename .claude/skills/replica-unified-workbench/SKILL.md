---
name: replica-unified-workbench
description: One deterministic pipeline over the repository's own engines - the privacy shield cleans the task (and checks a secret by its SHA-1 prefix only), the prompt meta-codes plan it, the universal agent builds the model request without sending it, the reversal engine with the contrast healer corrects the CSS, the universal maths solver checks an expression, the FOSS atlas plans a stack with savings only from typed prices, and the security verdicts triage findings. One plan joins the stages with every install, outbound and money step locked and proved, and a chain hash binds the stages in order. Standard-library Python only; no network, no processes.
---

# replica-unified-workbench

```bash
python3 .claude/skills/replica-unified-workbench/unified_workbench.py '{"task":"Build a login page and publish it","css":".a{color:#777}"}'
python3 .claude/skills/replica-unified-workbench/unified_workbench.py - < request.json
python3 -m unittest discover -s .claude/skills/replica-unified-workbench/tests
```

| Stage | Engine (skill) | Runs when |
| --- | --- | --- |
| 1 shield | `scrub_private` and `k_anonymity` (`replica-foss-atlas`) | always; later stages see only the cleaned text |
| 2 metacodes | `compile_metacodes` (`replica-prompt-metacodes`) | always; the joined plan follows its first option |
| 3 request | `universal_agent` request mode (`replica-universal-agent`) | always; `sent` is false |
| 4 design | `universal_agent` design mode, the reversal engine and contrast healer | `css` is given |
| 5 math | `solve` (`replica-universal-math`) | `math` is given |
| 6 atlas | `plan_foss_stack` (`replica-foss-atlas`) | `atlas` is given |
| 7 security | `universal_agent` security mode | `candidates` is given |

A stage whose engine refuses its input is marked `error` with that engine's message, and the other stages still run; `verified` is then false. The joined plan has a tool step per stage that ran and every locked step the stages asked for, proved by the reviewed `replica-formal-verify` prover. `chain_sha256` starts from 64 zeros and hashes each stage's id, status and summary in order.

The same pipeline runs in Jarvis (`jarvis/server/lib/unified-workbench.mjs`, `POST /api/w/:slug/workbench/run`, the `#/workbench` page). `tests/golden.json` holds the server's answers and both test suites check it.

## Limits

- The formula drawing (ADR-157's typesetter) has no Python twin, so the maths stage returns the solver's checks; the page draws the formula on the Math lab page.
- It plans and checks. Sending to a model, installing a tool or connecting outside stays a locked approval (AGENTS.md §1, ADR-141).
