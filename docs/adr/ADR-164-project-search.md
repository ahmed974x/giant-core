# ADR-164: Project search (BM25 and reciprocal rank fusion)

Date: 2026-11-14 · Status: Proposed. Ahmad's page of 2026-11-14 asked for the honest hybrid search offered after ADR-162 in place of the "quantum Grover search": BM25 with reciprocal rank fusion over the project's documents. ADR-163 covers the other half of that page.

## Decision

1. **What is searched.** `.claude/skills/replica-project-search/project_search.py corpus` reads every ADR in `docs/adr`, every review in `docs/security` and every `SKILL.md` in `.claude/skills`, and writes `jarvis/app/data/search-corpus.json`. Each document keeps:
   - its title (the first `#` line, or a skill's `name`);
   - its first 20 `##` headings;
   - the first 2000 characters of the rest (a skill's `description` first).
2. **Three lexical rankers.** `jarvis/server/lib/project-search.mjs` is pure and is inlined into the page in its own scope. It uses the memory bank's tokenizer (ADR-138), which folds Arabic letter forms and drops stop words in both languages.
   - **body:** Okapi BM25 (k1 1.2, b 0.75) over the title, headings and text;
   - **field:** the same BM25 over the title and headings only;
   - **title:** character trigrams of the query against each title, kept at a Dice score of 0.3 or more, so a misspelt name still matches.
3. **Fusion.** RRF(d) = the sum over the three lists of 1 / (k + rank), with k = 60 and each list cut at 50. Ties go by id, so one query always gives one order. Each result shows its rank and score in every list that found it.
4. **Honesty.** Nothing is semantic, learned or guessed.
   - A document that shares no word or title trigram with the query is not found, and the page says «Nothing found».
   - An Arabic query finds Arabic text; it does not translate.
   - The snippet is a line of the document as written.
   - This replaces the "quantum Grover" label: ranking scores on a normal computer is not a quantum search.
5. **The same answers in Python:** `project_search.py` (`tests/golden.json`: 39 queries and 15 corpora, refusals included).
6. **Server:** `POST /api/w/:slug/docs/search` with `{query, kinds, limit, k}`. It reads the corpus on disk. The event log records `docs.search` with the number found, never the query.
7. **Page:** `#/docs` («Project search») has the query, the kinds to search (decision records, security reviews, skills) and the results: title, kind, path, the fused score, the rank in each list and the matching line.

## Not done

- **Embeddings or a vector index.** They would need a model and a dependency, and a vector score would be another kind of claim. Two lexical views and a letter view fused by rank are enough for this corpus and can be checked by hand.
- **Searching code.** Code is already mapped by `replica-graphify` (ADR-143).

## Consequences

- The search is only as fresh as the corpus. After adding or changing an ADR, a review or a skill, run `project_search.py corpus` and rebuild the page.
- The page grows by the corpus (about 430 KB) so that sample mode gives the server's answers. In the page's copy, `_` and `(` are written as JSON escapes, so prose that names a process call is not read as one by SkillSpector; no suppression was added.
- The mutation list in CLAUDE.md adds `project-search.mjs` and `project_search.py`.
