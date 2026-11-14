# Security review: the polymath engine (ADR-161)

Date: 2026-11-13 · Reviewer: Claude Code, cloud sandbox. The outside sources are reviewed in `POLYMATH-SOURCES-REVIEW-2026-11-13.md`.

## 1. Files

| File | Lines | SHA-256 (first 16) | Role |
|---|---|---|---|
| `jarvis/server/lib/polymath-engine.mjs` | 119 | a1362351bd69e565 | The five stages |
| `.claude/skills/replica-polymath-engine/polymath_engine.py` | 267 | 6c58c7f55913d4bd | The same stages in Python, over the reviewed skills |
| `.claude/skills/replica-polymath-engine/tests/test_polymath_engine.py` | 72 | cd5e23726f8120ef | 8 unit tests, one against the server's golden answers |
| `.claude/skills/replica-polymath-engine/tests/golden.json` | — | 2a5a71d63120b166 | 72 requests with the server's answers |

Also changed:
- `server.mjs`: `POST /api/w/:slug/polymath/run`;
- `app.js`, `shell.tmpl`, `i18n-ar.json`: the `#/polymath` page; `LlmPlan` and the hyper scope now also expose `merkleRoot` and `optics`;
- `build-app.mjs`: inlines the engine after the workbench;
- `bilingual-purity.mjs`: adds `polymath` to the routes;
- the server, flow, live and mutation tests.

## 2. What it can do

- **Nothing new is reached.** It calls only functions reviewed before:
  - the shield and the atlas (ADR-158);
  - `solve` (ADR-154);
  - `analyse` (ADR-147);
  - `optics` (ADR-155);
  - the universal agent (ADR-159);
  - the Merkle tree (ADR-147).

  It opens no socket, starts no process and writes no file. A unit test checks the Python file for the words that would.
- **The shield comes first.** The question and every claim are cleaned before any stage reads them or the answer holds them. A test checks that an e-mail address in the question appears nowhere in the answer.
- **No made-up numbers.** The decision matrix uses only the person's options, scores and weights; with none, it is `null`. The inversion list is fixed text. Domain summaries are the engines' own answers.
- **Abstention.** With no engine run, `abstained: true`. A claim citing a domain that did not run is `grounded: false` and appears in `unknown_citations`.
- **Bounds:**
  - the question is at most 4,000 characters;
  - a series is 2 to 5,000 points;
  - 1 to 12 criteria and 2 to 12 options;
  - option names are at most 80 characters;
  - at most 20 claims of at most 300 characters.

  Each engine keeps its own bounds.
- **Event log:** `polymath.run` with counts and the grounding verdict, never the question.
- **Page:** text goes in with `textContent`. Links are fixed `#/…` routes. Every number field has a label (the matrix cells have translated `aria-label`s).

## 3. Cost

A run with every domain is measured at 14 ms on the sandbox:
- 5,000 points;
- CSS of 200 rules;
- 40 findings;
- 12 options.

## 4. Checks

| Check | Result |
|---|---|
| `python3 -m unittest discover -s .claude/skills/replica-polymath-engine/tests` | 8 tests OK; Python gives the server's answers to all 72 golden requests |
| `ruff check .claude/skills/replica-polymath-engine` | all checks passed |
| `node jarvis/scripts/mutation-harness.mjs` | `polymath-engine.mjs` 135/135 killed, 3 equivalent with reasons |
| `python3 jarvis/scripts/mutation_harness.py` | `polymath_engine.py` 175/175 killed, 4 equivalent with reasons |
| `node scripts/skillspector-audit.mjs --strict` on the changed files | 0 critical, 0 high |

The mutation run asked for probes at every limit (12 and 13 criteria and options, 80 and 81, 300 and 301, 20 claims) and for nulls. It also asked for weights that do not sum to 1, and for two series:
- a 620-point series with an anomaly at reading 30 whose z lies between 3 and 4;
- a 170-point series that starts with ties, so the first VPIN bucket is in the window.

## 5. Decision

Added. The skill is safe to run on Ahmad's machine as written.
