---
name: omega-deep-research-agent
description: Use when changing or running the ORACLE deep research agent (plan, gather, evaluate, write) in omega-ops-room-v1/omega-oracle.html, scripts/lib/deep-research.mjs, the proxy /research routes, the local-model brief or the deep_research MCP tool. Keyless scholarly and news APIs only, every sentence numbered to its source.
---

# ORACLE deep research agent (ADR-114)

Text rules only; no scripts run from this skill. Read `omega-design` for the look and `supreme-software-ui-architect` before any UI or data change.

## 1. The four stages
1. **Plan** (`plan`): seven fixed sub-questions (define, evidence, recent, foundations, counter, arabic, news) plus `snowball` at depth 2. The Wikipedia language link of the define page is the bridge term, so an Arabic question searches the English literature and an English one finds the Arabic page.
2. **Gather** (`run` over an injected `io.get(source, url, type)`): every request is built by `urls.*` and must pass `allowed(source, url)` (https, the source's own host, its one API path, no credentials, port or hash).
3. **Evaluate**: `merge` by DOI, then by normalised title (`via` lists each index that had the work); `score` = BM25 relevance 0.5, log citations 0.2, recency 0.1, corroboration 0.1, open access 0.1, times the kind weight; retracted works score 0 and leave the brief. `snowball` fetches works co-cited by the top papers and the most-cited works citing the best one. `evaluate` writes the gaps by fixed rules.
4. **Write** (`report`, `markdown`): verbatim abstract sentences picked by maximal marginal relevance, each with its `[n]`; a counter-evidence section; a gaps list; numbered references with grade, indexes, open full text and Wayback capture.

## 2. Sources

| Key | API | Browser | Notes |
|---|---|---|---|
| wikipedia | `{ar,en}.wikipedia.org/w/api.php` | direct (origin=*) | CC BY-SA 4.0 |
| openalex | `api.openalex.org/works` | direct | CC0; abstracts from the inverted index; `is_retracted` |
| crossref | `api.crossref.org/works` | direct | abstracts are JATS; strip tags |
| europepmc | `www.ebi.ac.uk/europepmc/webservices/rest/search` | direct | `resultType=core` for abstracts |
| arxiv | `export.arxiv.org/api/query` | proxy only (no CORS) | Atom XML, one call every 3 s |
| semanticscholar | `api.semanticscholar.org/graph/v1/paper/search` | direct | shared rate limit, expect 429 |
| gdelt | `api.gdeltproject.org/api/v2/doc/doc` | direct | one call every 5 s, 3 months |
| wayback | `archive.org/wayback/available` | direct | provenance of web items without a DOI |

A new source needs: a key in `SOURCES`, `HOSTS` and `ENDPOINTS`; a `urls` builder and a `shape` parser; a fixture and tests in `scripts/test-research.mjs`; the host in the page CSP `connect-src` and `.skillspector.json` `allowHosts`; a `RESEARCH_TTL` entry and a probe in the proxy. Paid, keyed, scraped or CAPTCHA-guarded sources are refused. Sites without an open API (Isnad, Google Scholar, QSpace) are link-outs in `LINKOUTS` only; the agent never reads them.

## 3. Honesty
- Quotes stay verbatim and in their original language. Ranking, grades (A/B/C/D/X) and grouping carry `[INFERENCE]`.
- A source that fails is a row marked "تعذر" and a gap, never a filled-in result. An empty run says تعذر التحقق منها.
- The local model (`POST /llm/ollama/research`, loopback only, `:cloud` models refused) gets only the numbered references and their quoted sentences; its answer is labelled `[INFERENCE - local LLM]` and checked by `checkCitations` (missing marks, numbers beyond the list).
- Nothing here is medical, financial or legal advice, and nothing places an order.

## 4. After editing the library
```bash
node scripts/build-research-inline.mjs
node scripts/test-research.mjs
node scripts/skillspector-audit.mjs --fix omega-ops-room-v1/omega-oracle.html
node scripts/skillspector-audit.mjs --strict .
node audits/verify-contrast.mjs omega-ops-room-v1/omega-oracle.html
node scripts/ui-three-sizes.mjs http://127.0.0.1:8796/omega-ops-room-v1/omega-oracle.html
```
