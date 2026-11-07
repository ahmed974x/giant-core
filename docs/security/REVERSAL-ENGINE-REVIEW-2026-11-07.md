# Security review: the reversal engine, its log and the replica-reversal-engine skill (ADR-150)

Date: 2026-11-07 · Reviewer: Claude Code, cloud sandbox.

## 1. Files

| File | Lines | SHA-256 (first 16) | Role |
|---|---|---|---|
| `.claude/skills/replica-reversal-engine/SKILL.md` | 25 | 6a2826669644f3f5 | Functions, limits |
| `.claude/skills/replica-reversal-engine/reversal_engine.py` | 329 | d8ba2a6e69d088db | Plan and template correction, CLI |
| `.claude/skills/replica-reversal-engine/tests/test_reversal_engine.py` | 91 | ca7437e7ee6aff16 | 8 unit tests |
| `jarvis/server/lib/reversal.mjs` | 183 | 5e42ff44ce8c935e | The same rules in JavaScript, pure, inlined into the page |
| `jarvis/server/lib/reversal-log.mjs` | 47 | 6c35302605cec510 | The append-only log, audit event and memory lesson |

Also changed:
- `server.mjs`: three routes, and the model-plan hooks;
- `readiness.mjs`: one check;
- `merkle-audit.mjs`: `AUDITED` gains `reversal.`;
- `db.mjs`: two JSON columns;
- both schemas: the `reversal_log` table and its append-only triggers;
- `app.js`: the panel and the store methods.

## 2. What the engine can do

- **Pure functions.** They take text or a list of steps and return a corrected copy and hashes. They read no file, open no socket and start no process.
- **The skill:**
  - imports `argparse`, `hashlib`, `json`, `math`, `re` and `sys`; no network, `subprocess`, `exec` or `importlib`;
  - reads one file and writes one file with `--out`; `--out` equal to the input is refused, so the original is never overwritten.
- **The engine can only tighten:**
  - a plan step can become locked, never unlocked; a step the rules do not lock is returned as the rules wrote it;
  - a template loses gradients and gains two fallbacks. Nothing it adds loads a resource or runs code: it is plain CSS with no `url()`, no `@import` and no script.

## 3. Untrusted input

- **Sources:** pasted HTML or CSS, and model output. Both are untrusted. The corrected copy goes back into a `textarea` as its value and is never parsed as HTML in the page. Correction details are shown through `textContent` inside `<bdi translate="no">`.
- **Size:** the server refuses templates over 200,000 characters and plans over 20 steps are cut to 20. Route bodies keep the server's existing size cap.
- **Denial of service.** The first draft used patterns that backtracked: a 200 KB paste of one letter took 42 s, which would have blocked the server's event loop. The rewrite:
  - finds declarations from stop positions computed in one pass;
  - reads `<style>` elements and CSS braces in one pass each;
  - bounds every repeat in the remaining patterns.

  Measured on eight hostile 200 KB inputs (one letter, repeated `linear-gradient(`, repeated `@media`, 200,000 `{`, repeated `<style`, deep nesting, a long run without a stop, many colons):

  | Engine | Time per input |
  | --- | --- |
  | JavaScript | 12 to 57 ms |
  | Python | 27 to 150 ms |

  The mutation run keeps a 200,005-character case in its oracle, so a slow pattern fails the run with a time-out.

## 4. The log, the audit tree and memory

- **Append-only:** `reversal_log` refuses update and delete in SQLite (two triggers) and PostgreSQL (one trigger function), like `audit_leaves`. A server test tries both and expects the refusal.
- **Merkle tree:** each row's event is a leaf, so a removed or edited correction would break the tree's verification (ADR-147).
- **Memory lesson:**
  - it holds only the plain-English lines of the corrections (step titles, categories, CSS properties and colours);
  - `memory.add` refuses key-shaped text as before;
  - the lesson reaches the model as an example marked as data, never as an instruction (ADR-138).
- **Not logged:** output with nothing to correct, so repeated clean checks do not fill the log.

## 5. Checks

| Check | Result |
|---|---|
| `node scripts/skillspector-audit.mjs --strict` on the five files | 0 critical, 0 high, 0 medium |
| `ruff check .claude/skills/replica-reversal-engine` | all checks passed |
| `python3 -m unittest discover -s .claude/skills/replica-reversal-engine/tests` | 8 tests OK, including one hash pinned from the server's output |
| `node jarvis/scripts/mutation-harness.mjs` (with `reversal.mjs`) | 176/176, 22 equivalent |
| `python3 jarvis/scripts/mutation_harness.py` (with `reversal_engine.py`) | 240/240, 13 equivalent |

## 6. Decision

Added. The skill is safe to run on Ahmad's machine as written. A later change needs a new entry here.
