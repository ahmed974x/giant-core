# Security review: the OKLCH bisection contrast healer (ADR-153)

Date: 2026-11-07 · Reviewer: Claude Code, cloud sandbox.

## 1. Files

| File | Lines | SHA-256 (first 16) | Role |
|---|---|---|---|
| `jarvis/server/lib/contrast-heal.mjs` | 98 | 336bee8f2e5d0d5f | Colour parsing, OKLCH, WCAG, APCA, the bisection healer |
| `jarvis/server/lib/reversal.mjs` | 218 | fff4081d77fc34c7 | The contrast rule in the reversal engine |
| `.claude/skills/replica-reversal-engine/reversal_engine.py` | 536 | 8a3b024381e40e17 | The same healer and rule in Python |
| `.claude/skills/replica-reversal-engine/tests/test_reversal_engine.py` | 118 | 5ab4ac0fd43c89ae | 10 unit tests, two pinned to the server's hashes |

Also changed:
- `app.js`: the Studio button and report, the reversal-log line, and `dir="ltr"` on hex fields;
- `i18n-ar.json`;
- `build-app.mjs`: inlines the healer;
- the server, flow and mutation tests.

## 2. What it can do

- **Pure arithmetic:** on two colours. It reads no file, opens no socket, starts no process and stores nothing.
- **In the reversal engine:** only the value of a `color` declaration is replaced, by a `#rrggbb` string the healer built. No other text is added, and the healed template is still plain CSS: no `url()`, no `@import`, no script.
- **In the Studio:** the healer changes the site's theme colours, which already pass through the same `#rrggbb` check as typed colours. The preview stays in its sandbox and is drawn as before.
- **Untrusted input:** colour strings come from pasted templates or the Studio's fields. `parseColour` accepts only `#rgb`, `#rrggbb` and `oklch(L C H)` with L in [0, 1] and finite numbers. Anything else is "not a colour" and left alone.

## 3. Cost

- **One heal:** at most 2 × 16 bisection steps on L, and for each step at most 16 on chroma when sRGB needs it. That is under a millisecond.
- **One template:** at most 50 heals. A server test pastes 7,000 colour pairs and stays under two seconds; measured, about 75 ms.
- **Patterns:** the colour patterns are anchored and bounded.

## 4. Checks

| Check | Result |
|---|---|
| `node scripts/skillspector-audit.mjs --strict` on the changed files | 0 critical, 0 high |
| `ruff check .claude/skills/replica-reversal-engine` | all checks passed |
| `python3 -m unittest discover -s .claude/skills/replica-reversal-engine/tests` | 10 tests OK; Python and the server give the same text and hashes |
| `node jarvis/scripts/mutation-harness.mjs` | `contrast-heal.mjs` 140/140 (11 equivalent), `reversal.mjs` 208/208 (29 equivalent) |
| `python3 jarvis/scripts/mutation_harness.py` | `reversal_engine.py` 516/516 (25 equivalent) |

## 5. Decision

Added. The skill is safe to run on Ahmad's machine as written. A later change needs a new entry here.
