# ADR-114: ORACLE, an open-source deep research agent on the public site

Date: 2026-10-24 · Status: Accepted (merged as PR #35 on 2026-10-24 after Ahmad's go; extended by ADR-115)

## Context
Phase 16 came as a file of search-engine answers about free OSINT and research tools (Isnad, Open Access Button, OpenAlex-style indexes, Maltego, Shodan, Wayback, Google Dorks, Open Deep Research, LangGraph agents) and one line of direction: design a super AI research agent for the site, open source, free and reliable, think outside the box, research the tools, integrate them, add tools and skills, then plan and build it properly.

Nothing in Phases 12 to 15 did research over the scientific literature. The rules still hold: free and keyless sources only, passive reading through documented APIs, no dorking, scanning or anti-bot bypass (AGENTS.md §3, §6a), every claim with its source, and pages that work from `file://` and GitHub Pages.

What was taken from the file and what was not:
| Suggestion | Decision |
|---|---|
| Open Deep Research's plan → gather → evaluate → write loop | Taken, as fixed rules in code rather than a cloud LLM chain |
| Open Access Button (find the free full text) | Taken through OpenAlex `open_access.oa_url` (Unpaywall data) and Europe PMC full-text links |
| Wayback Machine | Taken: the availability API proves a web source existed and keeps a capture link |
| Arabic open research (Isnad, QSpace, Birzeit FADA) | Arabic step through OpenAlex `language:ar` and Arabic Wikipedia; Isnad and QSpace have no open API, so they are link-outs the reader opens |
| Google Scholar | Link-out only (no API, automated reading not allowed) |
| Google Dorks, Shodan host search, Maltego, SpiderFoot, Recon-ng, social-media scraping | Refused: dorking and scanning are banned by AGENTS.md §6a, the rest need accounts or scrape |
| Tavily, Gemini API, Vertex AI | Refused: keyed or paid |
| LangGraph, LangChain, vLLM | Not added: the agent is a zero-dependency JavaScript loop; the optional model is the existing loopback Ollama bridge (ADR-112) |

## Decision

### Engine: `scripts/lib/deep-research.mjs` (`OMEGA_RESEARCH`)
One pure module, inlined into the page by `scripts/build-research-inline.mjs` (same pattern as Brain 2, ADR-108) and imported by the proxy, the MCP bridge and the tests. Network is injected (`io.get(source, url, type)`), so all four share one behaviour.

1. **Plan.** Seven sub-questions (definition, peer-reviewed evidence, newest since year − 2, most-cited foundations, limits and counter-evidence, Arabic sources, news of the last 3 months) and, at depth 2, citation chasing. The define step reads the top Wikipedia page and its language link; that title is the bridge term, so an Arabic question searches the English literature and an English one finds the Arabic page.
2. **Gather.** Eight keyless sources:

| Source | Endpoint | Browser tier |
|---|---|---|
| Wikipedia (ar, en) | `/w/api.php` search, extracts, langlinks | direct (`origin=*`) |
| OpenAlex (CC0) | `/works` with `search`, `filter`, `sort`, `select` | direct |
| Crossref | `/works?query` | direct |
| Europe PMC | `/europepmc/webservices/rest/search` (`resultType=core`) | direct |
| arXiv | `/api/query` (Atom) | proxy only, no browser CORS |
| Semantic Scholar | `/graph/v1/paper/search` | direct |
| GDELT DOC 2.0 | `/api/v2/doc/doc` | direct |
| Internet Archive | `/wayback/available` | direct |

   `allowed(source, url)` accepts only https, the source's own host and its single API path, with no credentials, port or fragment.
3. **Evaluate.** Merge by DOI, then by normalised title; `via` keeps every index that had the work. Score = BM25 relevance (title counted twice) 0.5 + log citations 0.2 + recency (e-folding 8 years) 0.1 + corroboration 0.1 + open access 0.1, times a kind weight (paper 1, preprint 0.85, encyclopedia 0.75, news 0.6). Retracted works (`is_retracted`) score 0, are left out of the brief and listed. Grades by fixed rule: A peer-reviewed and in two or more indexes or cited 50+ times, B peer-reviewed, C preprint or encyclopedia, D news, X retracted. Snowball: references co-cited by at least two of the top six papers, and the most-cited works that cite the best one. The top web items without a DOI get a Wayback capture.
4. **Write.** Verbatim abstract sentences chosen by maximal marginal relevance (term overlap × record score, minus similarity and repeats), each with its `[n]`; a counter-evidence section from limitation cues; strongest, newest, foundations, Arabic and news lists; the plan table; gaps by fixed rules (no source answered, fewer than 3 peer-reviewed papers, nothing recent, no Arabic source, retractions, single-index evidence, no open full text, failed sources); numbered references. Everything ranked or grouped carries `[INFERENCE]`.

### Page: `omega-ops-room-v1/omega-oracle.html` (ORACLE · العرّاف)
Arabic RTL first, the DESIGN.md tokens and components, fonts embedded, strict CSP with `connect-src` naming the eight hosts and the local proxy. Sections: question box with depth and source switches, the four-stage pipeline with a live per-source table (status, results, ms, tier), KPIs, the brief, an SVG evidence map (Fruchterman-Reingold from a seeded circle, so the same answer draws the same map; cyan lines are real OpenAlex citations, faint ones shared topics; nodes are keyboard buttons, no text in the SVG so nothing drops below 12 px), references with grade, indexes, DOI, open full text, archive capture and the published abstract, link-outs (Isnad, Google Scholar, BASE, CORE, Semantic Scholar, PubMed, QSpace, DOAJ, arXiv), the last eight questions (this browser only), Markdown and JSON export, and the method and limits. `?q=` and `?depth=` reproduce a run. The suite switcher (ADR-107) lists ORACLE on all four pages and syncs the last question.

### Local proxy (`scripts/omega-data-proxy.mjs`)
- `GET /research/<source>?url=<upstream>`: the request must pass `OMEGA_RESEARCH.allowed`; cached 6 h (GDELT 30 min, Wayback 24 h); arXiv paced at one call per 3.1 s, Semantic Scholar 1.1 s. The research hosts join `ALLOWED_UPSTREAM` and the `--check` table.
- `POST /llm/ollama/research`: loopback only, local models only (ADR-112 guards), body at most 24 KB of numbered sources, fixed instruction: Arabic brief from those sources only, each sentence ending in its `[n]`, تعذر التحقق منها for anything unsupported, no advice. The page then runs `checkCitations`: share of sentences with a valid mark, marks beyond the list, sentences with none.
- `/omega-oracle.html` short address.

### MCP bridge
`deep_research {query, depth?, off?, markdown?}` runs the same agent (proxy tier first, then direct with the same pacing) and returns KPIs, gaps, per-source status, numbered references and the Markdown brief. Read only. The bridge self-test adds an offline engine check.

### Skill and checks
New text-only skill `.claude/skills/omega-deep-research-agent`. `scripts/test-research.mjs` (13 tests on hand-made fixtures in each API's documented shape, plus the inline-copy check) runs in the SkillSpector workflow. GitHub Pages publishes the page and a short redirect; the service worker caches it with the shell.

## Consequences
- The public site gains a research agent that needs no key, no account and no server; on GitHub Pages seven of eight sources work (arXiv needs the laptop proxy).
- The brief is extractive: it quotes abstracts in their original language and does not read full texts. Translation and a prose summary come only from the optional local model, labelled and checked.
- Rate limits are the sources' own (Semantic Scholar's shared pool often answers 429); a failed source becomes a stated gap.
- The cloud sandbox has no outbound data, so behaviour was tested with fixtures and a mocked browser run; live answers are checked on the laptop or the public site.
