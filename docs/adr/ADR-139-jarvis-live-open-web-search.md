# ADR-139: Jarvis live open-web search through official public JSON APIs

Date: 2026-11-05 · Status: Proposed. Ahmad's message of 2026-11-05 asked for ADR-139 on `claude/replica-design-jarvis`, after ADR-138 and before PR #52 is merged.

## Context

Jarvis could read one public page (the clean-room cloner, ADR-134). It could not search. Ahmad first suggested only a local SearXNG and the GitHub API. He then asked for search on the live internet «عبر واجهات محركات البحث المفتوحة المصدر الرسمية», naming:
- GitHub, OpenAlex, Wikipedia in Arabic and English;
- npm and PyPI, OSV, HN Algolia;
- any SearXNG JSON instance.

The constraints:
- **DuckDuckGo is cancelled entirely**, and AGENTS.md §3 stays binding: no scraping, CAPTCHA or anti-bot bypass.
- The page keeps `connect-src 'self'` and goes through `/api/search/live`.
- Each call has a clear User-Agent, a timeout, SSRF protection and an offline fallback.
- Results are summarised into BM25 memory.

## Decision

1. **`jarvis/server/lib/open-web-search.mjs`**
   - **Sources:** nine, each a fixed host and a fixed URL template; the query is only a parameter (or the OSV JSON body).
   - **Modes:**
     - `web`: Wikipedia en and ar, OpenAlex, HN, GitHub, SearXNG if set;
     - `packages`: npm, PyPI by package name, GitHub;
     - `osv`: `ecosystem:package[@version]`, thirteen ecosystem names.
   - **Requests:**
     - User-Agent `JarvisOpenSearch/1.0 (+https://github.com/ahmed974x/giant-core; …)`;
     - 8 s timeout, no redirects, 1 MB cap, JSON only;
     - DNS answers checked in the socket's lookup, and IP literals checked before connecting;
     - a 10-minute cache.
   - **Answers:** text stripped and cut short; https links only.
2. **SearXNG** comes from `JARVIS_SEARXNG_URL`, pinned at start: https on a public name, or `http://127.0.0.1:<port>`. Anything else stops the server from starting, as with the Ollama address (ADR-136).
3. **Routes:**
   - `GET /api/search/status`.
   - `POST /api/search/live {workspace, q, mode, limit}`:
     - asks the sources in parallel and interleaves their results;
     - saves a `search` episode to the workspace's memory (titles and links only);
     - when no source answers, returns the workspace's BM25 memory hits with `offline: true` and a note.
4. **Page `#/search`:**
   - **Modes:** 🌐 Open web, 📦 Packages and code, 🛡️ OSV vulnerabilities, 🧬 Clone a live site. The last hands the address to the Studio's clean-room cloner.
   - **Results:** cards with the source, facts (stars, versions, citations, CVE aliases) and safe links.
   - **Sources panel:** answered, cached, skipped or failed, with time.
   - **Sample mode:** says live search needs the local server, and answers from the browser's memory.
   - **Arabic:** every string has its line.
5. **Review:** `docs/security/JARVIS-OPEN-WEB-SEARCH-REVIEW-2026-11-05.md`.

## Consequences

- Jarvis can look things up on the open internet without a key, a paid API, a scraper or a browser disguise. Ahmad's machine needs only internet access.
- Each query is visible to the public services asked, as with any search. The page names them.
- Searches feed memory, so a later plan can find what was looked up. A poisoned result can only become example text marked as data. It never unlocks anything.
- In the cloud sandbox the APIs are answered by fixtures on their fixed hosts. Real answers are checked on the laptop.

## Checks

The results are in the PR body. They cover:
- **SkillSpector** on the whole repository;
- **Server tests** on SQLite and PostgreSQL 16;
- **Flow tests:** `test-app.mjs` F17 and `test-live.mjs`;
- **Contrast**;
- **Three sizes** for `#/search`, sample and live, in English and Arabic;
- **Parity:** 100.0.
