# Security review: impact analysis (ADR-168)

Date: 2026-11-15 · Reviewer: Claude Code, cloud sandbox.

## 1. Files

| File | Lines | SHA-256 (first 16) | Role |
|---|---|---|---|
| `jarvis/server/lib/impact-analysis.mjs` | 156 | f858c59e279e5ef0 | The three checks, pure |
| `.claude/skills/replica-impact-analysis/impact_analysis.py` | 285 | 83d933f4a261749a | The same rules in Python |
| `.claude/skills/replica-impact-analysis/tests/test_impact_analysis.py` | 99 | 59a7a63938003e9b | 10 unit tests, one against the server's golden answers |
| `.claude/skills/replica-impact-analysis/tests/golden.json` | — | 85494b4165ff3be2 | 219 requests with the server's answers |
| `jarvis/app/data/model-catalog.json` | 366 | 8e55c67dcc08616e | The catalog as data, written by the page build |

Also changed:
- `server.mjs`: `POST /api/w/:slug/impact`;
- `runbook.mjs` and `runbook.py`: `#/impact` is the eleventh page probe;
- `build-app.mjs`: inlines the engine and writes the catalog JSON (`--check` covers it);
- `app.js`, `app.css`, `shell.tmpl`, `i18n-ar.json`: the `#/impact` page;
- `bilingual-purity.mjs`: adds `impact` to the routes;
- the server, flow, live and mutation tests.

## 2. What it can do

- **Read, nothing else.**
  - **The rules:** pure functions, with no network, no process and no file access. A unit test checks the Python file for the words that would start a process, open a connection or run text as code.
  - **The context loader:** `load_context` reads four JSON files from `jarvis/app/data`.
  - **The page build:** writes one JSON file from a module already in the repository.
- **Take nothing from the request but the question.** The server reads the catalog module and the snapshots on disk and ignores a `catalog`, `deps`, `tree` or `corpus` field in the body. A server test sends `catalog: []` and `deps: {}` and still gets the repository's answer.
- **Run no pattern from the request.** The family patterns are the catalog's own fixed regular expressions, with no nested quantifiers; the model name is at most 120 characters.
- **Keep the lock.** A model is never pulled or started. The only step is `{gate: "approval", locked: true, status: "pending_approval"}`, and nothing here changes it.
- **Bound the work.**
  - **The diff:** two texts of at most 20,000 characters and 500 lines each, so the LCS table is at most 501 × 501. Text that is not well-formed Unicode is refused, so both languages hash the same bytes.
  - **The catalog:** 1 to 200 families.
  - **The query:** checked by project search (1 to 300 characters).
- **Log counts only.** The event log records `impact.<mode>` with the verdict or counts. A server test checks that the model name and the compared text never reach it.
- **Page.** Text goes in with `textContent`. The compared lines are marked `data-verbatim`, so the bilingual gate reads them as data. The only link is to `https://huggingface.co/<card>`, with `card` from the fixed catalog, opened with `rel="noopener noreferrer"`. The CSP is unchanged (`connect-src 'self'`).

## 3. Honesty

- **The licence verdict** is read from the licence text in the catalog (ADR-167), by fixed rules. Custom terms are `read_licence`, because their files were not read in full. Nothing is ranked, and no benchmark is shown.
- **Memory** is the weights only: parameters × bits ÷ 8 ÷ 10⁹ GB. It is given only for the card the parameter count was read from. The first version gave `gpt-oss:20b` the 120b card's memory (58.41 GB); this was caught in testing and fixed before review, and a server test, a unit test and a flow test now check it.
- **A name that does not say its size** is not matched to a guess. Its candidate families are listed with their licences.
- **Dependencies** are EXTRACTED from `sys.path` lines. A cycle is named, never broken.

## 4. Cost

Measured on this sandbox:

| Check | Time per call |
|---|---|
| One catalog check | 0.046 ms |
| The reversal engine's blast radius (with project search over the repository's documents) | 28.6 ms |
| A diff of two 500-line texts | 6.6 ms |

## 5. Checks

The commands and their results are in the pull request. Biome is not installed in this sandbox, so `npx @biomejs/biome lint` was not run (as in ADR-167).

## 6. Decision

Accepted. The skill is safe to run on Ahmad's machine as written.
