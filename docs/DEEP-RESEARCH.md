# Deep Research (ADR-050)

## الخلاصة (لأحمد)
- **محرك بحث عميق مثل Perplexity، مجاني ومفتوح المصدر بالكامل،** داخل شاشة "البحث" في الموقع.
- **وكلاء مثل الصورة اللي أرسلتها:** مخطِّط يقسم سؤالك، ستة كشافين يبحثون بنفس الوقت، دمج، حذف المكرر، قراءة الصفحات، ترتيب الأدلة، كاتب، ثم مدقق يفحص كل جملة مع مصدرها.
- **مصادر مجانية بدون مفاتيح:** SearXNG (محرك بحثك الخاص)، ويكيبيديا عربي وإنجليزي، OpenAlex (250 مليون بحث علمي)، arXiv، Hacker News، GDELT (أخبار العالم).
- **كل رقم [n] تقدر تضغطه** ويفتح لك المقطع والمصدر. الجمل الضعيفة تنعلم بخط أصفر، وغير المدعومة بخط أحمر.
- **ما بنيت تخطي الكابتشا** اللي في الصورة الأولى: مخالف لشروط المواقع وما نحتاجه، كل مصادرنا رسمية.

## How it works
```
planner ─► scouts ×6 (parallel) ─► merge (RRF) ─► dedupe (URL + MinHash) ─► read pages ─► rank (BM25)
        ─► [deep: gap planner ─► 2nd scout wave] ─► writer ─► cite check ─► verify
```
| Stage | Method | Why this one |
|---|---|---|
| planner | LLM, JSON plan; falls back to the question + keywords | sub-questions incl. counter-evidence (STORM idea) |
| scouts | official APIs: SearXNG, Wikipedia, OpenAlex, arXiv, HN Algolia, GDELT DOC 2.0 | free, keyless, no scraping tricks |
| merge | Reciprocal Rank Fusion (k = 60) | rewards results several sources agree on |
| dedupe | canonical URL + MinHash (64 hashes, word 3-shingles) | drops syndicated copies of one wire story |
| read | ADR-026 local reader, 4 in parallel, 10 s each, private IPs refused | quotes the article, not the snippet |
| rank | BM25 over ~700-char passages + scout rank boost, 1 passage per source | relevant and diverse evidence |
| writer | LLM, answers only from numbered sources, Arabic if the question is Arabic | grounded answer |
| cite check / verify | claim–evidence token overlap (Arabic normalised, light stemming) | catches invented or misattributed claims |

Quick = 3 sub-questions, 5 pages read, 8 sources. Deep = 5 sub-questions, all six scouts, 10 pages, 14 sources and a
gap-filling second wave.

## Setup on the laptop (web/.env.local, via `npm run secrets:set`)
| Variable | Default | Note |
|---|---|---|
| `SEARXNG_URL` | `http://127.0.0.1:8888` | the self-hosted SearXNG; its `settings.yml` must allow `json` in `search.formats` |
| `OMEGA_GATEWAY_TOKEN` | empty | same value as the root `.env`; enables Cortex (`omega/oracle`, then `omega/free-smart`) |
| `CORTEX_URL` | `http://127.0.0.1:8089/v1` | |
| `DEEP_RESEARCH_MODEL` | `omega/oracle` | |
| `OLLAMA_URL` | `http://127.0.0.1:11434/v1` | set to empty to disable the local fallback |
| `DEEP_RESEARCH_LOCAL_MODEL` | `qwen2.5:3b` | |
| `OPENALEX_MAILTO` | empty | optional, faster OpenAlex pool |

Check: `curl "$SEARXNG_URL/search?q=test&format=json"` returns JSON (a 403 means the JSON format is off).

## Tests
`npm test` runs `test/deep-research.test.ts`: normalisation, BM25, RRF, MinHash, citation checking, plan cleaning,
and two full runs with fake sources (one with a model, one with none).
