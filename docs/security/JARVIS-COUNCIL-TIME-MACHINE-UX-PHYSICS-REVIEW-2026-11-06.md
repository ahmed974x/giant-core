# Security review: the council, the Studio time machine and replica-ux-physics (ADR-144)

Date: 2026-11-06 · Reviewer: Claude Code, cloud sandbox.

Ahmad asked for a Mixture-of-Agents council, Studio snapshots with a diff, a UX heatmap and a `replica-ux-physics` skill. The risk is that a council of models finds a way round the locks of AGENTS.md §1. Every file below is **new code written in this repository**; nothing was fetched, copied or installed.

## 1. Files

| File | Lines | SHA-256 (first 16) | Role |
|---|---|---|---|
| `.claude/skills/replica-ux-physics/SKILL.md` | 39 | bd8c7c0f89619a5a | Formulas, limits |
| `.claude/skills/replica-ux-physics/ux_physics.py` | 265 | d982334fecff27c9 | Fitts, Hick, symmetry, heat grid; boxes or HTML and CSS |
| `.claude/skills/replica-ux-physics/chaos_fuzzer.py` | 125 | 2b5b0918fd61e3ba | Seeded edge cases, data only |
| `.claude/skills/replica-ux-physics/symbol_index.py` | 127 | c5e09be28bb2d2b1 | Symbols by `ast` and fixed patterns, SHA-256 per file |
| `.claude/skills/replica-ux-physics/tests/test_ux_physics.py` | 116 | b74ca6c4e1d8506b | 10 unit tests |
| `jarvis/server/lib/council.mjs` | 118 | 50f459175026e8cc | Architect, red team and UX critic, synthesizer; rules last |
| `jarvis/server/lib/snapshot.mjs` | 86 | bc34fa4f2b62f2f2 | Canonical JSON, pure SHA-256, line and block diffs |
| `jarvis/server/lib/studio.mjs` | 72 | a63c2e949bcd294d | Snapshot rows: save, fork, diff, verify |
| `jarvis/server/lib/ux-physics.mjs` | 73 | 4a0b08fcf68952c3 | The same formulas for the page |

## 2. The council cannot unlock anything

- **Model output is untrusted at every turn.** The architect's steps pass `enforceApprovalGates`. The critic's model opinion is text only, at most 1,200 characters, shown with `textContent` and labelled `[UNTRUSTED_MODEL_OUTPUT]`; no code reads it. The synthesizer's rewrite passes `enforceApprovalGates` again, then the fixed repairs, which set `gate: "approval", status: "pending_approval"` on every locked step.
- **The browser cannot inject steps.** `createMission` takes only the goal; the server runs the council and builds the mission from its own answer. `missions.createFromPlan` re-derives kinds, tools and categories from Jarvis's lists, and `mission_steps_locked_never_done` refuses a done sensitive step in SQLite and PostgreSQL.
- **Tested with a hostile model.** The fake model proposes publishing, a payment and a skill install unlocked and marked done, with a step that depends on step 9. It critiques leniently and rewrites the plan the same way. The tests check that:
  - all three leave the council as locked approvals pending;
  - nothing is done;
  - a test gate stands before publishing;
  - running the mission never finishes a locked step;
  - a direct `update … set status = 'done'` is refused by the database.
- **Addresses.** The red team flags private and loopback addresses written in a step with the same `isBlockedAddress` the fetcher uses (the page gets that function cut from `fetch-public.mjs` at build time, so both refuse the same ranges). The council itself makes no request. Its model calls go only to the loopback bridge of ADR-136 and ADR-140.
- **Size.** Prompts over 4,000 characters are refused; a plan is cut to 12 steps.

## 3. Snapshots

- Rows are append-only by trigger (`studio_snapshots_no_update`) in both databases; a test proves an update is refused.
- Each hash covers the previous hash and the canonical site. `verify` reports the first broken row; a test deletes a row and sees the break.
- A snapshot keeps only name, language, width, theme and at most 20 blocks, under 256 KB, inside a 512 KB request limit. Rows stay in their workspace; a test reads another workspace and gets none.
- The diff is text in `textContent` cells; the site is never put into the page as markup.

## 4. The heatmap

- The preview stays `sandbox="allow-scripts"` with an opaque origin and its CSP pins the script by hash. It answers only a message from its parent, and returns only numbers (boxes, viewport, direction), never text.
- The page accepts a `jarvis-boxes` message only from that frame's window, and only for a request id it is waiting for.

## 5. The skill

- **Imports:** standard library only (`argparse`, `ast`, `hashlib`, `html.parser`, `io`, `json`, `math`, `os`, `random`, `re`, `sys`, `tokenize`, `unicodedata`; the tests add `contextlib`, `tempfile`, `unittest`). There is no `subprocess`, `socket`, `urllib`, `http`, `eval`, `exec` or `importlib`.
- **Nothing executed:** Python is read with `ast.parse` and `tokenize`, never imported; JavaScript, HTML and CSS are text.
- **Writes:** `--out` writes one file inside `--root`; a test proves `../` is refused.
- **The fuzzer writes data only.** Its markup cases are split strings, so the file carries no live tag, and the flow test F25 proves the preview shows them as text.

## 6. Checks

| Check | Result |
|---|---|
| `node scripts/skillspector-audit.mjs --strict .claude/skills/replica-ux-physics jarvis/server/lib` | 0 critical, 0 high |
| `ruff check .claude/skills/replica-ux-physics` | all checks passed |
| `python3 -m unittest discover -s .claude/skills/replica-ux-physics/tests` | 10 tests OK |
| server tests (SQLite and PostgreSQL 16) | in the PR body |

## 7. Limits, said plainly

- Fitts and Hick use textbook constants; the scores rank layouts and carry [INFERENCE].
- The HTML mode of `ux_physics.py` sees only sizes the CSS states. The Studio's own preview pins its scaled frame with `left: 0` inside a left-to-right stage; the tool reports it, and it is meant.
- A model that runs can still write a poor plan. The council makes it safe, not good.

## 8. Decision

Added. The skill is safe to run on Ahmad's machine as written. A later change needs a new entry here.
