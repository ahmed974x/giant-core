# Security review: Jarvis live open-web search (ADR-139)

Date: 2026-11-05 · Reviewer: Claude Code, cloud sandbox.

Ahmad asked for Jarvis to search the live internet, not only 127.0.0.1, "through the official open-source public JSON APIs". His request named:
- GitHub, OpenAlex, Wikipedia (Arabic and English), npm, PyPI, OSV and HN Algolia;
- any SearXNG instance in JSON mode.

Every call needs:
- a clear User-Agent and a timeout;
- SSRF protection;
- a fallback to local data when there is no internet.

DuckDuckGo is cancelled entirely, and AGENTS.md §3 applies in full: no scraping, no CAPTCHA, no anti-bot bypass. The page keeps `connect-src 'self'` and reaches the internet only through `POST /api/search/live` on the local server. Nothing was installed: the code uses Node's standard `https`, `http` and `net`.

## Scope

| File | Role |
|---|---|
| `jarvis/server/lib/open-web-search.mjs` | Sources, query parsing, the request function, the federation and the cache |
| `jarvis/server/server.mjs` | `GET /api/search/status`, `POST /api/search/live`; memory summary and offline fallback |
| `jarvis/app/src/app.js` | `#/search`: four modes (🌐 open web, 📦 packages and code, 🛡️ OSV, 🧬 clone a live site) |

## Sources

| id | Host | Call | Licence or terms |
|---|---|---|---|
| `wikipedia-en`, `wikipedia-ar` | `en.wikipedia.org`, `ar.wikipedia.org` | `GET /w/api.php?action=query&list=search` | CC BY-SA 4.0 |
| `openalex` | `api.openalex.org` | `GET /works?search=` | CC0 |
| `hn` | `hn.algolia.com` | `GET /api/v1/search?tags=story` | HN API terms |
| `github` | `api.github.com` | `GET /search/repositories` (keyless: 10 a minute) | GitHub API terms |
| `npm` | `registry.npmjs.org` | `GET /-/v1/search` | npm API terms |
| `pypi` | `pypi.org` | `GET /pypi/<name>/json`, only when the query is a package name | PyPI API terms |
| `osv` | `api.osv.dev` | `POST /v1/query` with `{package: {name, ecosystem}, version}` | CC BY 4.0 |
| `searxng` | the person's `JARVIS_SEARXNG_URL` | `GET /search?format=json&safesearch=1` | per engine |

## Threats and what stops them

1. **SSRF through the query.**
   - Each source builds its URL from a fixed template on a fixed host.
   - The query is only ever an `encodeURIComponent` parameter, or a field in the OSV JSON body.
   - Nothing in a request, a query or an answer can choose a host, a path or a port.
2. **SSRF through DNS or IP literals.**
   - Every connection uses `safeLookup` from `fetch-public.mjs`, which refuses private, loopback, link-local, CGNAT, documentation and multicast answers inside the socket's own lookup. That closes the gap between check and connect (DNS rebinding).
   - Node does not call a custom lookup for an address written as an IP. The review found that `https://10.1.2.3/` reached the network, so such literals are now checked before connecting. A test proves it.
3. **A hostile SearXNG address.**
   - `JARVIS_SEARXNG_URL` is read once at start, by `pinSearxng`. It must be https on a public name and port 443, or exactly `http://127.0.0.1:<port>`.
   - Users, passwords, queries, `localhost`, `.lan` / `.local` / `.internal` names, other ports, and private IP literals are refused, and the server does not start.
   - Six refusals are tested.
4. **Redirects.** A 3xx answer is an error, never followed.
5. **Resource abuse.**
   - 8 s timeout per call; 1 MB per answer; JSON only.
   - At most 10 results per source, and queries of 2 to 200 characters.
   - A 10-minute cache of up to 300 answers, so repeats do not ask again. GitHub's keyless limit is 10 searches a minute; a 403 or 429 is reported as "the free limit is used up", never retried.
6. **Untrusted answers.**
   - Titles and snippets are stripped of markup, control characters and bidi overrides, then cut short.
   - A link is kept only if it is plain https without credentials. Otherwise Jarvis builds the source's own page (Wikipedia, OSV, HN), or drops the result. A test feeds `javascript:alert(1)`.
   - The page writes everything with `textContent`, and links open with `rel="noopener noreferrer"`.
7. **Memory poisoning.**
   - The summary saved to memory holds titles, links and source names only, under kind `search`.
   - A key-shaped value is refused, as for every episode (ADR-138).
   - If the local model later sees a saved search as an example, it is marked as data. Locks are still decided by rule.
8. **Privacy.**
   - Each query goes to the listed public services, which may log it, like any search. The page says which sources were asked.
   - Nothing else is sent: no cookies, no tokens, no keys, no referrer.
9. **No scraping.**
   - No HTML search page is fetched, and no search engine's web interface is used. DuckDuckGo, Google and Bing appear nowhere, and a test checks the host list.
   - "Clone a live site" hands the address to the existing clean-room cloner (ADR-134), which makes one GET, obeys robots.txt and keeps only layout.
10. **No internet.** When every asked source fails, the answer says `offline: true`, and the server returns the workspace's own BM25 memory hits with a note that says where they came from. The sample page (file://) has no network and says so.

## Checks

| Check | Result |
|---|---|
| `node jarvis/server/test/test-server.mjs` (SQLite + PostgreSQL 16): fixed hosts, query only as a parameter, links filtered, markup stripped, interleaving, cache, PyPI skip, OSV body, refusals, offline fallback, memory summary, SearXNG pin, IP literals refused | see `jarvis/replica/evidence/tests-server.log` |
| `node jarvis/scripts/test-app.mjs` F17 (sample: offline note and memory fallback, OSV form, clone hand-off) | see `tests-app.log` |
| `node jarvis/scripts/test-live.mjs` (live: five sources as safe links, statuses, memory summary, official hosts only, OSV with CVE alias) | see `tests-live.log` |
| `node scripts/skillspector-audit.mjs --strict .` | 0 critical, 0 high |

The cloud sandbox has no outbound network, so the tests answer each official host with a fixture. The real APIs are reached on Ahmad's machine when the server runs there.

## Limits, said plainly

- Federated results are not ranked across sources. They are interleaved, so each source shows on the first screen.
- Wikipedia and OpenAlex search the words, not their meaning.
- Results are pointers to read, not facts. Every result names its source, and its licence is listed.
