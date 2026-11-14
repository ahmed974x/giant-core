# Security review: the skill tree (ADR-162)

Date: 2026-11-13 · Reviewer: Claude Code, cloud sandbox.

## 1. Files

| File | Lines | SHA-256 (first 16) | Role |
|---|---|---|---|
| `jarvis/server/lib/skill-tree.mjs` | 137 | 39c99107bdf6e75b | The tree and the composer, pure |
| `.claude/skills/replica-skill-tree/skill_tree.py` | 252 | 73d931d40719e167 | The snapshot reader, and the same tree and composer in Python |
| `.claude/skills/replica-skill-tree/tests/test_skill_tree.py` | 75 | 5e3d9d811755b55e | 7 unit tests, one against the server's golden answers |
| `.claude/skills/replica-skill-tree/tests/golden.json` | — | d6b146e2a9590c48 | 43 requests with the server's answers |
| `jarvis/app/data/skill-tree-input.json` | — | — | The snapshot the page and the server read |

Also changed:
- `server.mjs`: `GET /api/w/:slug/tree` and `POST /api/w/:slug/tree/compose`;
- `app.js`, `app.css`, `shell.tmpl`, `i18n-ar.json`: the `#/tree` page;
- `build-app.mjs`: embeds the snapshot and inlines the engine;
- `bilingual-purity.mjs`: adds `tree` to the routes;
- the server, flow, live and mutation tests.

## 2. What it can do

- **Read files, nothing else.**
  - **Snapshot:** reads four of the repository's own files and the Markdown in `docs/security`, then writes one JSON file.
  - **Tree and composer:** pure functions, with no network, no process and no file access.

  A unit test checks the Python file for the words that would start a process or open a connection.
- **Install nothing.** Composing returns the commands that test the chosen skills; neither the page nor the server runs them. A vendored skill gets no command and says it is a reference.
- **Server:** the routes read the snapshot and refuse bad input with 400. The event log records `tree.compose` with the number of skills and the verdict only.
- **Page:**
  - Text goes in with `textContent`. Links are fixed `#/…` routes.
  - Each skill and family node is a focusable button with a translated label. Tools are marked `aria-hidden`.
  - The table repeats every fact for screen readers and phones.
- **Bounds:**
  - at most 200 skills;
  - 40 tools a skill;
  - names of 1 to 64 lower-case letters, digits and hyphens;
  - descriptions cut at 200 characters;
  - compose takes 1 to 12 names.

## 3. Honesty

- **States** come from facts in the snapshot, by the fixed rules in ADR-162. No score is invented.
- **"Named in"** is the first review that names the skill. The page says "Named in", not "reviewed by".

## 4. Cost

Building the tree for the repository's 57 skills takes 0.16 ms.

## 5. Checks

| Check | Result |
|---|---|
| `python3 -m unittest discover -s .claude/skills/replica-skill-tree/tests` | 7 tests OK; Python gives the server's answers to all 43 golden requests |
| `ruff check .claude/skills/replica-skill-tree` | all checks passed |
| `node jarvis/scripts/mutation-harness.mjs` | `skill-tree.mjs` 165/165 killed, 3 equivalent with reasons |
| `python3 jarvis/scripts/mutation_harness.py` | `skill_tree.py` 198/198 killed |
| `node scripts/skillspector-audit.mjs --strict` on the changed files | 0 critical, 0 high |

The mutation run found that `ST_ROOTS.length === 1` could never be true. That dead branch was removed in both languages. Probes were added at every limit and for nulls.

## 6. Decision

Added. The skill is safe to run on Ahmad's machine as written.
