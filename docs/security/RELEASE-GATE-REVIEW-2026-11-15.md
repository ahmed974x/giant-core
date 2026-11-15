# Security review: release readiness (ADR-169)

Date: 2026-11-15 · Reviewer: Claude Code, cloud sandbox.

## 1. Files

| File | Lines | SHA-256 (first 16) | Role |
|---|---|---|---|
| `jarvis/server/lib/release-gate.mjs` | 85 | 62014865d267acb3 | The audit, the regression gate and the bundle, pure |
| `.claude/skills/replica-release-gate/release_gate.py` | 172 | fa38fe574cf651ee | The same rules in Python |
| `.claude/skills/replica-release-gate/tests/test_release_gate.py` | 71 | 1139fcdc1f447448 | 5 unit tests, one against the server's golden answers |
| `.claude/skills/replica-release-gate/tests/golden.json` | — | 791b40ab5848edf1 | 82 requests with the server's answers |

Also changed:
- `server.mjs`: `POST /api/w/:slug/release`;
- `runbook.mjs` and `runbook.py`: `#/release` is the twelfth page probe;
- `build-app.mjs`: inlines the engine and reads the evidence snapshot;
- `app.js`, `app.css`, `shell.tmpl`, `i18n-ar.json`: the `#/release` page;
- `bilingual-purity.mjs`: adds `release` to the routes;
- the server, flow, live and mutation tests.

## 2. What it can do

- **Read, nothing else.**
  - **The rules:** pure functions, with no network, no process and no file access. A unit test checks the Python file for the words that would start a process, open a connection or run text as code.
  - **The page build:** reads seven evidence files that the repository's own commands wrote, at build time.
- **Take nothing from the request but the question.** The server reads the skill tree, the corpus, the dependency snapshot and the catalog module from disk. A server test sends `tree: {skills: []}` and still gets the repository's audit.
- **Keep its checks in one place.** The skills, the model and the notes are checked by impact analysis, and the tree by the skill tree. A server test checks that their refusals reach the person with the field they name (`nope`, `use`).
- **Keep the locks.** Publishing and running a model are locked approvals; nothing here changes their state.
- **Bound the work.**
  - 1 to 12 skills, and each skill's work is bounded by impact analysis.
  - Counts from 0 to 10⁹, whole numbers only (true, text and fractions are refused).
  - ADR numbers of at most four digits, so the gap list never passes 9,999 entries.
- **Log counts only.** The event log keeps `release.<mode>` with the verdict or counts. A server test checks that the model name never reaches it.
- **Page.** Text goes in with `textContent`. The snapshots are edited as JSON text and parsed with `JSON.parse`; text that is not JSON is not sent. The CSP is unchanged.

## 3. Honesty

- **The snapshots** start from the build's evidence files, which the page names. A missing file leaves its counts out rather than filling in a number.
- **The audit's verdict** is a fixed rule over the skill tree's states. The missing ADR numbers are reported as facts, not failures.
- **The regression rules** are fixed and listed in ADR-169: a failure count above 0 is a regression whatever else improved.

## 4. Cost

Measured on this sandbox:

| Check | Time per call |
|---|---|
| One audit | 0.31 ms |
| One regression gate | 0.005 ms |
| A bundle of two skills, a model and notes | 51 ms (mostly project search inside each blast radius) |

## 5. Checks

The commands and their results are in the pull request. Biome is not installed in this sandbox, so `npx @biomejs/biome lint` was not run.

## 6. Decision

Accepted. The skill is safe to run on Ahmad's machine as written.
