# Security review: replica-long-horizon skill and Jarvis Mission Control (ADR-135)

Date: 2026-11-05 · Reviewer: Claude Code, cloud sandbox.

Ahmad asked on 2026-11-04 for a long-task skill «باستخدام مكتبة Python القياسية فقط (بدون شبكة أو برامج خارجية لتجتاز `SkillSpector` بنتيجة `0 حرج، 0 عالي`)». He also asked for a security review. AGENTS.md §1 needs a written review before a skill is added.

The skill is **new code written in this repo**. It is not vendored. The ideas come from his message:
- persistent planning in three files;
- verified restore capsules;
- a deterministic completion gate.

No third-party file was copied, and nothing was installed.

## 1. Files

| File | Lines | SHA-256 (first 16) | Role |
|---|---|---|---|
| `.claude/skills/replica-long-horizon/SKILL.md` | 105 | 2f73eb49ad0353b9 | Rules and commands; a giant-core section on locked steps |
| `lhcommon.py` | 131 | 8f6731bc7a6bfa4c | Shared helpers: plan parsing, canonical JSON, SHA-256, path containment |
| `plan.py` | 162 | 1ba4b3746d9eae8b | `init`, `log`, `status` (context health, labelled `[INFERENCE]`) |
| `capsule.py` | 213 | fb0e4f3a723d34a8 | `save`, `list`, `show`, `verify`, `restore` |
| `gate.py` | 200 | 05c71d4a2c558d8d | `check` and `finish` over saved evidence |
| `tests/test_long_horizon.py` | 173 | 430f993bc550d0d3 | 10 unit tests |

## 2. What the code can and cannot do

**Imports.** Only the standard library:
- `argparse`, `base64`, `datetime`, `hashlib`, `json`, `os`, `re`, `sys`;
- the tests add `contextlib`, `io`, `tempfile`, `time`, `unittest`.

There is no `subprocess`, `socket`, `urllib`, `http`, `ctypes`, `pickle`, `eval`, `exec` or `importlib`.

**No process, no network.**
- The gate never runs a check. It reads log files that the agent saved from the real commands.
- That is why it stays at 0 high: running tests from a skill would need `subprocess`, which SkillSpector flags.
- The trade-off is written in `SKILL.md`: a gate is only as honest as its logs, so logs must come from redirecting the real command.

**Reads.**
- The three plan files.
- `WORKDIR/evidence/*`.
- `WORKDIR/capsules/*.json`.
- `.git/HEAD` and `.git/refs/...`, as plain text, for the branch and commit.
- Files named with `--files` or `--watch`. Each must resolve inside `--root`: `lhcommon.inside()` uses `realpath`, so `..` and symlinks out of the repo are refused.

**Writes.**
- The three plan files.
- New capsule files: the name is the sequence number plus a label checked against `^[a-z0-9-]{1,40}$`.
- `progress.md` lines.
- `restore --files --yes` writes files back from a capsule, under three rules:
  - each path is re-checked against `--root`;
  - nothing is written if the chain does not verify;
  - `--yes` is required.
- `progress.md` is never rewritten by `restore`. It only gains a line, so it stays append-only.

**Integrity.**
- `hash` = SHA-256 of the capsule's canonical JSON (keys sorted, no spaces, UTF-8), without the `hash` field.
- `prev_hash` chains each capsule to the one before it. The first is 64 zeros, the same form as the Ops Room receipts in DESIGN.md §7.
- `verify` checks:
  - the sequence;
  - every link;
  - every hash;
  - the hash of any saved file content;
  - drift: files changed since each capsule.
- A tampered capsule fails `verify`, and `restore` refuses. Both are tested.

**Size.** Saved file content is capped at 2 MB per capsule.

**Locked actions.**
- A task marked `{gate: approval}` never passes `gate.py`.
- The skill says money, publishing, permissions, installs and outbound messages are written that way, and that independent tasks carry on (AGENTS.md §1).

## 3. Jarvis Mission Control (server and page)

The same rules run in `jarvis/server/lib/missions.mjs`, which is Node standard library plus the existing `pg@8.23.0`. No new dependency was added.

**Gates read evidence; they never run it.**
- Evidence paths must resolve, after `realpath`, under `jarvis/replica` or `jarvis/app/data`. A path such as `../../etc/passwd` is refused, and this is tested.
- Files over 2 MB are refused.
- The rules are the same as `gate.py`, through one `judge()` function. The page's build imports it, so sample mode and the server agree.

**Tool steps.** Only `files.read`, `git.log`, `notes.read` and `runs.read`, through the runner's existing path checks. `web.read` and `notes.write` are not mission tools.

**Approval steps.**
- They create rows in the existing `approvals` table.
- Money, publish, permissions, install and outbound are refused twice:
  - `approvals_locked_never_approved`, as before;
  - the new `mission_steps_locked_never_done`. The database will not mark such a step done whatever the caller sends; this is tested on SQLite and PostgreSQL 16.
- "Carry on without it" skips the step and the steps that need it. It approves nothing, and the request stays in the inbox.

**Gate rule.** `mission_steps_gate_before_done`: a gate step can be done only with `gate_status = 'pass'`.

**Capsules.**
- They live in an append-only table. Update and delete are refused by trigger on both engines; this is tested.
- `restore` verifies the whole chain first, then pauses the mission and seals a new capsule.

**The page.**
- It has no new network access. The sample mode hashes with a plain-JS SHA-256; the flow test checks its hashes against Node's `crypto`.
- The Studio's template extractor inlines the server's pure `clean-clone.mjs`. It parses pasted HTML in the page and sends nothing; reading a URL still needs the local server's fetcher (ADR-134).
- The CSP is unchanged in shape: `connect-src 'self'`, with the hashes re-pinned.

## 4. Results

| Check | Result |
|---|---|
| `node scripts/skillspector-audit.mjs --strict .claude/skills/replica-long-horizon` | 6 files · critical 0 · high 0 · medium 0 · low 0 |
| `ruff check .claude/skills/replica-long-horizon` | All checks passed |
| `python3 -m unittest discover -s .claude/skills/replica-long-horizon/tests` | Ran 10 tests, OK |
| Server tests (SQLite + PostgreSQL 16) | see ADR-135 |

## 5. Residual risks

- **Hand-written logs.** A person or agent could write a passing log by hand. The gate cannot tell. Mitigations:
  - the rule in `SKILL.md`;
  - evidence hashes logged in `progress.md`;
  - Mission Control shows each file's SHA-256 prefix.
- **Context health is a heuristic.** It counts steps since the last capsule and the size of the step outputs. It does not measure the model's context, and it is labelled `[INFERENCE]` everywhere it appears.
- **Staleness.** The server's gate reports the evidence file's hash but does not compare modification times, because a fresh git checkout resets them. `gate.py --watch` does the stale check on a working copy.
