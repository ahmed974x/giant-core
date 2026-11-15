---
name: replica-release-gate
description: Release readiness over facts the repository already holds - an audit of the skill tree's states (proved, tested, rules, reference, attention) and of the decision records and security reviews in the project-search corpus, ready only when no skill needs attention; a regression gate between two snapshots of the checks' counts that you give (tests passed must not fall, failures, surviving mutants, SkillSpector critical and high, contrast failures and bilingual-purity violations must be 0), with one verdict per check and for the release; and a release bundle that runs impact analysis on the skills a change touched and an optional model, joins the pages and test commands, diffs the release notes line by line and binds the sections with a SHA-256 chain. Publishing stays a locked approval. Standard-library Python only, over the reviewed skills.
---

# replica-release-gate

```bash
python3 .claude/skills/replica-release-gate/release_gate.py '{"mode": "audit"}' --data jarvis/app/data
python3 .claude/skills/replica-release-gate/release_gate.py '{"mode": "bundle", "skills": ["replica-impact-analysis"], "model": "openai/gpt-oss-120b", "use": "service", "bits": 4}' --data jarvis/app/data
python3 -m unittest discover -s .claude/skills/replica-release-gate/tests
```

## Rules

- The audit reads only the snapshots in `jarvis/app/data` (`skill-tree-input.json`, `search-corpus.json`). The verdict is `ready` when no skill needs attention, `attention` otherwise, and `empty` with no skill.
- Shares are the proved, tested and proved-or-tested skills over all skills, to four decimals. Missing decision-record numbers are listed as facts, not failures.
- Regression gate:
  - **Counts that should grow** (server, app and live tests passed, mutants killed): `regression` when the candidate is lower, `progress` when higher, `steady` when equal.
  - **Failure counts** (failed tests, surviving mutants, SkillSpector critical and high, contrast failures, purity violations): `regression` when the candidate is above 0, and `progress` when it fell to 0.
  - **The release:** `reject_regression` with any regression, `proven_progress` with any progress and none, `steady` otherwise.
- The bundle hands each skill, the model and the notes to `replica-impact-analysis`, which checks them: the licence verdict, memory only for the card the count was read from, a name without a size not guessed.
- Publishing the release and running the model are locked steps: `{gate: "approval", locked: true, status: "pending_approval"}`. Nothing here approves them.
- Same answers and chain hash as `jarvis/server/lib/release-gate.mjs`: `tests/golden.json`.
