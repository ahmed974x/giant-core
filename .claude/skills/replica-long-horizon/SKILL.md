---
name: replica-long-horizon
description: Run long, multi-step tasks without losing the thread - three plan files on disk, SHA-256 chained state capsules to resume after /clear, and an evidence gate that blocks "done" until tests pass.
---

# replica-long-horizon

Long tasks fail in three ways: the plan drifts out of the context window, work is lost when the
session is cleared, and steps get marked done before anything proved them. This skill fixes each
with one stdlib-only Python tool:

| Problem | Tool | What it does |
| --- | --- | --- |
| Context rot | `plan.py` | Keeps the plan, the findings and the progress log in three files on disk. Re-read them; never trust memory. |
| Lost work after `/clear` or a crash | `capsule.py` | Saves a SHA-256 hash-chained capsule of the three files, the git position and the changed files (optionally with their content). Verifies and restores. |
| "Done" without proof | `gate.py` | Marks a task done only when its evidence logs pass, are fresher than the code they cover, and its numbered acceptance criteria have recorded evidence. |

No tool starts a process, opens a socket or runs code it reads. The agent runs the real commands
(tests, `verify-contrast.mjs`, SkillSpector) and saves their output; the gate reads those files.
This keeps the skill at SkillSpector 0 critical, 0 high, and it means a gate result is only as
honest as the logs: always produce them by redirecting the real command, never by hand.

`$SKILL` is this folder. `$W` is the task's working folder (for example `work/<task-name>/`).

## 1. Start: three files

```bash
python3 $SKILL/plan.py init $W --goal "Ship the agent editor" \
  --criteria "Editing an agent saves and reloads" --criteria "Locked rows can never be switched on"
```

Writes `task_plan.md` (goal, numbered acceptance criteria AC1…, phases and tasks T1…),
`findings.md` (facts, decisions, evidence) and `progress.md` (an append-only log). Then fill the
phases by hand. A task line names the checks it needs and the criteria it proves:

```
- [ ] T3: Save edits through the API {gate: tests, security; ac: AC1}
```

Rules that keep context healthy:

- Re-read `task_plan.md` before each phase and after any `/clear`. It is the source of truth.
- Write every fact you will need later into `findings.md` the moment you learn it (what a file does,
  why a design was chosen, a command that works). Decisions go under `## Decisions`.
- Log each step with `python3 $SKILL/plan.py log $W "what was done, what is next"`.
- `python3 $SKILL/plan.py status $W` prints open tasks, unmet criteria, the last log line and how
  stale the last capsule is (a heuristic, labelled as such).

## 2. Capsules: resume exactly

```bash
python3 $SKILL/capsule.py save $W --label "phase-2-done" --files jarvis/server/lib/store.mjs app.js --with-content
python3 $SKILL/capsule.py list $W
python3 $SKILL/capsule.py verify $W          # hashes, the chain, and drift of the files since
python3 $SKILL/capsule.py restore $W 3 --yes # put task_plan.md and findings.md back from capsule 3 (progress.md only gains a line)
python3 $SKILL/capsule.py restore $W 3 --files --yes   # …and the saved file contents too
```

Each capsule stores the three files in full, the git branch and commit (read from `.git`, no
command run), and each listed file's SHA-256 (and content with `--with-content`, 2 MB cap). Its
`hash` covers everything else, and `prev_hash` links it to the one before, so editing an old
capsule breaks `verify`. Save one at the end of every phase and before anything risky. After
`/clear`: `verify`, then read the latest capsule's three files, then continue.

## 3. The gate: done means proven

Run the real checks and keep their output in `$W/evidence/`:

```bash
python3 -m unittest discover -s tests > $W/evidence/tests.log 2>&1
node audits/verify-contrast.mjs page.html > $W/evidence/contrast.log 2>&1
node scripts/skillspector-audit.mjs --strict --json $W/evidence/security.json changed/paths > /dev/null
```

Record each criterion's proof in `findings.md` under `## Evidence`, pointing at a real file:

```
- AC1: `evidence/editor-flow.log` (test "editing an agent saves" passed)
```

Then ask the gate:

```bash
python3 $SKILL/gate.py check $W --task T3 --watch jarvis/server lib/app.js
python3 $SKILL/gate.py finish $W --watch jarvis/server lib/app.js
```

`check` passes only if every check the task names has a log that passes and is newer than every
watched file, and every criterion it names has evidence that exists. Then it ticks the task and
logs the evidence hashes. `finish` passes only when every task is ticked, every criterion has
evidence, and every log is still fresh. Exit code 1 means not done, with the reason for each line.

| Check | Accepted evidence (all must hold) |
| --- | --- |
| `tests` | every `tests*.log`: `Ran N tests … OK`, `N passed, 0 failed`, or pytest `N passed` with no `failed`/`error` |
| `contrast` | every `contrast*.log`: `All pairs pass` or `0 failing`, and no `FAIL` line |
| `security` | every `security*.json` (SkillSpector `--json`): summary `critical` and `high` both 0 |
| `lint` | every `lint*.log`: ends with `0 errors` / `All checks passed!` and no `error` lines |

## In giant-core

AGENTS.md and DESIGN.md win over this skill. A step that needs money, publishing, permission
changes, installing a skill or an outbound message is never ticked by the gate: write it as a task
with `{gate: approval}` and it stays open until Director 00 decides outside the task; carry on with
the tasks that do not depend on it.
