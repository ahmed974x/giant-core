---
name: replica-project-search
description: Search the repository's own documents - every ADR, every security review and every skill's SKILL.md - with three lexical rankers fused by Reciprocal Rank Fusion - Okapi BM25 over the title, headings and text, BM25 over the title and headings only, and character trigrams of the query against each title so a misspelt name still matches. Arabic and English with the memory bank's tokenizer. Nothing is semantic or learned; with nothing shared, nothing is found and the answer says so. Standard-library Python only; it reads the repository's Markdown files to build the corpus and fetches nothing.
---

# replica-project-search

```bash
python3 .claude/skills/replica-project-search/project_search.py corpus --root . --out jarvis/app/data/search-corpus.json
python3 .claude/skills/replica-project-search/project_search.py search jarvis/app/data/search-corpus.json "contrast healer oklch"
python3 -m unittest discover -s .claude/skills/replica-project-search/tests
```

## Rules

- Three rankers, each a list cut at 50: BM25 (k1 1.2, b 0.75) over the title, headings and text; the same BM25 over the title and headings; trigram Dice of at least 0.3 between the query and the title.
- RRF(d) = the sum over the lists of 1 / (k + rank), k = 60. Ties go by id, so one query always gives one order.
- The corpus keeps each document's title, its first 20 `##` headings and the first 2000 characters of its text. A word past that is not searched; the page says so.
- The snippet is a line of the document, as written, that holds a query word.
- These are word and letter matches. No meaning, synonym or translation is guessed: an Arabic query finds Arabic text and an English query finds English text.
- Same answers as `jarvis/server/lib/project-search.mjs`: `tests/golden.json`.
