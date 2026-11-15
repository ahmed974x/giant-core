---
name: replica-runbook
description: One goal and the skills it needs, run through the engines this repository already has, in order - the privacy shield cleans the goal (a secret check gives only its SHA-1 prefix), project search finds the matching records and reviews, Kahn's order lays out the chosen skills and what they load, the workbench on the cleaned goal is read as a behaviour tree, UCB1 picks one of the three meta-code plans from the person's own record, and one fixed probe per page checks the engine behind it; a SHA-256 chain binds the stages. Nothing is sent or installed, and every outbound, install or publish step stays a locked approval. Standard-library Python only, over the reviewed skills.
---

# replica-runbook

```bash
python3 .claude/skills/replica-runbook/runbook.py '{"goal": "Heal the contrast of the login page", "skills": ["replica-polymath-engine"]}' --data jarvis/app/data
python3 -m unittest discover -s .claude/skills/replica-runbook/tests
```

## Rules

- The goal is cleaned by the privacy shield before any other stage reads it.
- Skills, documents and dependencies come only from the snapshots in `jarvis/app/data` (`skill-tree-input.json`, `skill-deps.json`, `search-corpus.json`). Nothing is fetched.
- A stage whose engine refuses its input is an `error`; the other stages still run, and `ready` is false.
- A locked approval in the workbench keeps the tree `running`; `locked` counts those steps. Nothing here approves them.
- Each page probe runs one fixed input through the engine behind the page. `#/diagnostics` reads the running server, so it is `server_only`.
- The plan choice carries [INFERENCE].
- Same answers and chain hash as `jarvis/server/lib/runbook.mjs`: `tests/golden.json`.
