# Security review: project search (ADR-164)

Date: 2026-11-14 · Reviewer: Claude Code, cloud sandbox.

## 1. Files

| File | Lines | SHA-256 (first 16) | Role |
|---|---|---|---|
| `jarvis/server/lib/project-search.mjs` | 116 | 296887965c6d2675 | BM25 over two fields, title trigrams, RRF and the snippet, pure |
| `.claude/skills/replica-project-search/project_search.py` | 261 | 5eb36c44d7705588 | The corpus reader, and the same search in Python |
| `.claude/skills/replica-project-search/tests/test_project_search.py` | 64 | de9c8cad357b8696 | 7 unit tests, one against the server's golden answers |
| `.claude/skills/replica-project-search/tests/golden.json` | — | ccd5f22bcfe3268b | 39 queries and 15 corpora with the server's answers |
| `jarvis/app/data/search-corpus.json` | — | — | The corpus the page and the server read |

Also changed:
- `server.mjs`: `POST /api/w/:slug/docs/search`;
- `app.js`: the `#/docs` page and `normalize` exported next to the memory bank's `tokenize`;
- `app.css`, `shell.tmpl`, `i18n-ar.json`: the page;
- `build-app.mjs`: embeds the corpus and inlines the engine;
- `bilingual-purity.mjs`: adds `docs` to the routes;
- the server, flow, live and mutation tests.

## 2. What it can do

- **Read files, nothing else.**
  - **`corpus`:** lists `docs/adr`, `docs/security` and `.claude/skills`, reads the Markdown as text and writes one JSON file. Nothing it reads is run or imported.
  - **The search:** pure functions, with no network, no process and no file access. A unit test checks the Python file for the words that would start a process, open a connection or run text as code.
- **Keep the query private.** The event log records `docs.search` with the number found only; a server test checks that a query never reaches it.
- **Show text safely.** Titles, paths and snippets go in with `textContent`, isolated as data. Nothing from a document becomes a link or markup.
- **Take no corpus from the request.** The server reads `search-corpus.json` from disk.
- **The page's copy of the corpus.** SkillSpector reads `index.html` as code, so a review sentence that names Node's process module to say it was not used read as three high findings. `build-app.mjs` writes `_` and `(` as JSON escapes in the corpus only; they occur only inside JSON strings, so the parsed text is the same. Every line of the page's code is still scanned, and no suppression was added.
- **Bounds:**
  - a query of 1 to 300 characters;
  - at most 1000 documents, each id once;
  - 1 to 20 results, k from 1 to 1000;
  - each list cut at 50;
  - 2000 characters of text and 20 headings a document.

## 3. Honesty

- The page and the ADR call it lexical. Nothing is semantic, learned or translated.
- With nothing shared, the answer is «Nothing found», never a nearest guess.
- Each result shows its rank and score in every list that found it, so the fusion can be checked by hand.
- The cut at 2000 characters is stated on the page.

## 4. Cost

On this sandbox one search over the 187 documents takes about 16 ms, almost all of it tokenizing. The corpus adds about 430 KB to the page.

## 5. Checks

| Check | Result |
|---|---|
| `python3 -m unittest discover -s .claude/skills/replica-project-search/tests` | 7 tests OK; Python gives the server's answers to every golden query and corpus |
| `ruff check .claude/skills/replica-project-search` | all checks passed |
| `node jarvis/scripts/mutation-harness.mjs` | `project-search.mjs` 115/115 killed, 3 equivalent with reasons |
| `python3 jarvis/scripts/mutation_harness.py` | `project_search.py` 162/162 killed, 1 equivalent |
| `node scripts/skillspector-audit.mjs --strict` on the changed files | 0 critical, 0 high |

The mutation run found that the golden answers could not see each ranker's score, so a wrong BM25 term or Dice count could hide behind the fused rank. Each result now carries its per-list scores. It also found three guards that could never change an answer (an average floor, an empty-set test and two empty-list shortcuts); they were removed. The ids are now unique, and probes were added at every limit, for a line of exactly 200 characters and a Dice score of exactly 0.3.

## 6. Decision

Added. The skill is safe to run on Ahmad's machine as written.
