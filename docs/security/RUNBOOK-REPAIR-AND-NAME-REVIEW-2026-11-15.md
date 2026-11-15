# Security review: the runbook's repaired plan and the name in the page text (ADR-166)

Date: 2026-11-15 · Reviewer: Claude Code, cloud sandbox.

## 1. Files

| File | Lines | SHA-256 (first 16) | Role |
|---|---|---|---|
| `jarvis/server/lib/runbook.mjs` | 139 | 9028b8d27ee9b833 | The six stages, the corrected CSS and the repaired request, pure |
| `.claude/skills/replica-runbook/runbook.py` | 257 | 73ad63d53fcad573 | The same in Python |
| `.claude/skills/replica-runbook/tests/test_runbook.py` | 59 | 7cabccae0574852c | 5 unit tests, one against the server's golden answers |
| `.claude/skills/replica-runbook/tests/golden.json` | — | 6f079a14e6a98f98 | 32 requests with the server's answers |

Also changed for the name: `app.js`, `i18n-ar.json`, `shell.tmpl`, `store.mjs`, `server.mjs`, `access.mjs`, `founder-gate.mjs`, `memory.mjs`, `missions.mjs`, `skill-audit.mjs`, `platform.mjs`, `skill-tree.mjs`, `universal-math.mjs`, `foss-atlas.mjs`, their Python twins and golden files, and the tests that quote those sentences.

## 2. What it can do

- **Repair by leaving out, never by inventing.** A repaired request only removes what a rule refused: an unknown skill, a refused record entry or `c`, or an unreadable CSS. It adds no skill, no number and no approval.
- **Run once more, not in a loop.** The repaired request is run one time, and its own result is never repaired again.
- **Keep the locks.** Both runs keep every locked step locked; nothing is sent or installed.
- **Show the CSS as data.** The corrected CSS is shown with `textContent` in a `pre`, marked as verbatim. It is never applied to the page.
- **The rename moves no boundary.** Headers, user agents, model names, slugs and file names keep their old spelling, so no check, signature or route changed.

## 3. Checks

| Check | Result |
|---|---|
| `python3 -m unittest discover -s .claude/skills/replica-runbook/tests` | 5 tests OK; Python gives the server's answers for all 32 golden requests |
| `python3 -m unittest` for `replica-skill-tree`, `replica-universal-math` and `replica-foss-atlas` | OK on the rewritten golden files |
| `node jarvis/scripts/mutation-harness.mjs` | `runbook.mjs` 84/84 killed, 2 equivalent with reasons |
| `python3 jarvis/scripts/mutation_harness.py` | `runbook.py` 118/118 killed, 2 equivalent with reasons |
| `node scripts/skillspector-audit.mjs --strict` on the changed files | 0 critical, 0 high |

The mutation run found two conditions in the repair that could only be true together (a record that is not an object, and a tree refusal without a design error). They were rewritten so each check stands alone, and a probe with 13 known skills was added for the cap of 12.

## 4. Decision

Added. Safe to run on Ahmad's machine as written.
