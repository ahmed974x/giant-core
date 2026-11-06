# Security review: replica-formal-verify, the Studio exporter and the macro composer (ADR-145)

Date: 2026-11-06 · Reviewer: Claude Code, cloud sandbox.

Every file below is **new code written in this repository**; nothing was fetched, copied or installed. Two risks were reviewed:
- a macro could carry a sensitive step past a lock;
- exported code could run something or leak markup.

## 1. Files

| File | Lines | SHA-256 (first 16) | Role |
|---|---|---|---|
| `.claude/skills/replica-formal-verify/SKILL.md` | 36 | 848664acc3e91c73 | The machine, the properties, limits |
| `.claude/skills/replica-formal-verify/state_prover.py` | 184 | 93d541cbdf98754e | Breadth-first proofs; UI-state report |
| `.claude/skills/replica-formal-verify/mutation_audit.py` | 172 | 61039b59d163edf4 | Mutants by `ast`; static strength estimate; writes copies only |
| `.claude/skills/replica-formal-verify/tests/test_formal_verify.py` | 101 | 96dc9d0f00d587b6 | 7 unit tests |
| `jarvis/server/lib/prover.mjs` | 68 | 2fc29cd337a3ebe7 | The same proofs in JavaScript (page and server) |
| `jarvis/server/lib/exporter.mjs` | 142 | d14eed97c1d49b1d | Web Component, W3C tokens, SQL with locks, three-size test |

## 2. Macros

- **No model.** The steps come from `fallbackPlan`, the fixed rules that lock money, publishing, permissions, installs and outbound messages.
- **Proved twice.** The page proves the steps as you type. The server takes only the text, makes the steps itself, proves them again and refuses a failed proof (422) before anything is written. Its stored proof is the server's own, never the page's.
- **Still locked after.** A macro's mission goes through `missions.createFromPlan`, which re-derives kinds and categories. `mission_steps_locked_never_done` refuses a done sensitive step in SQLite and PostgreSQL.
- **The proof is checked against itself.** Tests prove that:
  - an unlocked publish step is a violation, with its path;
  - a hand-made shortcut to a payment is found;
  - a state with no way out is a deadlock;
  - the hostile model's plan from ADR-136 is safe once the rules have locked it.

## 3. Exports

- Each file is made in the browser from the site's JSON and saved through a Blob download. Nothing is sent, published or run, and the page's CSP is unchanged.
- **Web Component:** it builds its DOM with `createElement` and `textContent`; there is no `innerHTML` and no `eval`. The site data is JSON with `<` escaped, and a test feeds a name containing a closing script tag. Theme values are applied only when they are `#rrggbb`. A flow test loads it in Chromium and checks the Shadow DOM, in English left to right and Arabic right to left. That test found that the page build stripped the `export default` line; the line was moved and a server test now guards it.
- **SQL:** a schema is text for a person to review [INFERENCE]. Payments, publishing and permissions start at `pending_approval`, and a `check` refuses `approved` without `approved_by` and `approved_at`. A PostgreSQL 16 test runs the schema and confirms the check refuses such a payment.
- **Tokens:** colours and fonts only, with each contrast result. No key or personal data.
- **Test file:** a Playwright spec for the person's own machine; it reads only the exported page next to it.

## 4. The skill

- **Imports:** standard library only (`argparse`, `ast`, `collections`, `copy`, `json`, `os`, `re`, `sys`; the tests add `contextlib`, `io`, `tempfile`, `unittest`). There is no `subprocess`, `socket`, `urllib`, `http`, `eval`, `exec` or `importlib`.
- **Nothing executed:** modules are read with `ast.parse`, never imported. Mutants are written as text with a header that says they were not run.
- **Writes:** `--out` stays inside `--root`; a test proves `../` is refused.

## 5. Checks

| Check | Result |
|---|---|
| `node scripts/skillspector-audit.mjs --strict .claude/skills/replica-formal-verify jarvis/server/lib/prover.mjs jarvis/server/lib/exporter.mjs` | 0 critical, 0 high |
| `ruff check .claude/skills/replica-formal-verify` | all checks passed |
| `python3 -m unittest discover -s .claude/skills/replica-formal-verify/tests` | 7 tests OK |

## 6. Limits, said plainly

- "Verified" is a proof about the plan's state machine as built: deadlocks, reachability and where the locks stand. It says nothing about what a tool does inside a step.
- The mutation strength is a static estimate. Callbacks a library calls (such as `HTMLParser.handle_starttag`) are not seen; run the written mutants to measure the real kill rate.
- The inferred schema and the component are starting points, not finished products.

## 7. Decision

Added. The skill is safe to run on Ahmad's machine as written. A later change needs a new entry here.
