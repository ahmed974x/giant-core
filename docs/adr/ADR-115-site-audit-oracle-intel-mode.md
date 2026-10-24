# ADR-115: Site-wide audit and fixes, ORACLE v2 with four more open sources and a passive OSINT mode

Date: 2026-10-24 · Status: Proposed (Ahmad's Phase 17 message of 2026-10-24 01:21Z; merge waits for his go)

## Context
After ADR-114 was merged (Ahmad confirmed the merge on a decision card at 01:27Z), Phase 17 asked, in one long message, for: the strongest open-source libraries, tools and skills; a stronger research agent built on free and reliable open sources; deep and open-source intelligence research; every error on the site found and fixed so it works without faults; the site tested, then developed and upgraded.

The rules from ADR-114 still hold: free and keyless sources only, read passively through their documented APIs, no dorking, scanning, address lookups or anti-bot bypass (AGENTS.md §3, §6a), every claim with its source, pages that work from `file://` and GitHub Pages, and nothing that trades or moves money.

## Decision

### 1. Site-wide audit
A browser audit served the built `_site` on 127.0.0.1, with every outside request blocked. It loaded NABD (ar, en), the Ops Room in each of its five views, THE CHAIN and ORACLE at the three sizes (390×844 @3x with a coarse pointer, 1440×900, 2560×1080) in light and dark.

For each page it checked:
- page errors, and console errors other than the blocked network;
- CSP violations;
- broken local links;
- duplicate ids, dead `#` anchors, and `target=_blank` without `noopener`;
- buttons, links or inputs with no accessible name, label or `name`;
- elements wider than the viewport that no scroll container catches;
- text under 12 px;
- touch targets under 44 × 44 px with a coarse pointer.

A second pass clicked every visible button on each page, except destructive ones, and watched for page errors.

Findings and fixes:

| Finding | Fix |
|---|---|
| About 70 controls under 44 px on a phone (DESIGN.md §5, ADR-113). The Ops Room had `.btn` at 40, `select` at 40, OSIRIS chips at 36, the style switch at 36, map legend buttons at 32, zoom buttons at 40, receipt print buttons at 28 and the gate links at 23. THE CHAIN and ORACLE had `.btn`, the skip link and the back links. NABD had the language link and the skip link. | A `pointer: coarse` block placed last in each page's style, so it wins over the denser desktop sizes, raises all of them to 44 px. Inline links inside footer sentences are left as they are, as WCAG 2.5.8 allows for inline text. |
| The Ops Room self-test dialog said "Twenty checks" while it runs 24 | The text now reads twenty-four, in English and Arabic. |
| The 24-check self-test from `file://`, offline | 14 PASS. The 10 FAILs are all checks that need live data (PWSI, the Binance book, Deribit, space and cyber feeds, PWA over http) and say so. Each fixture inside those checks is still exact. No code fault. |
| NABD opened from disk logs a CORS error for its Cairo font | Not a fault on the served site (GitHub Pages, `start-omega`). DESIGN.md requires `file://` only for the Ops Room and THE CHAIN, which embed their fonts. Left as is. |

No JavaScript errors, CSP violations, broken links, overflow, unnamed controls or sub-12 px text were found on any page, view, size or theme.

### 2. ORACLE v2 (`OMEGA_RESEARCH` `omega-research-v2`)
Four more keyless sources, each held to one API path by `allowed()`:

| Source | Endpoint | Browser tier | Used for |
|---|---|---|---|
| DOAJ (CC0) | `doaj.org/api/search/articles/<query>`. The query is one path segment, so `ENDPOINTS` gained a prefix form that admits exactly one segment. | direct | Peer-reviewed open access journals, including Arabic ones, in the evidence and Arabic steps. The full-text link is the open-access link. |
| dblp (CC0) | `dblp.org/search/publ/api` | direct | Computer science. CoRR entries count as preprints. |
| Wikidata (CC0) | `www.wikidata.org/w/api.php` (`wbsearchentities`, `wbgetentities`) | direct | The entity card (label, description, both-language labels, Wikipedia pages). It also gives the Arabic/English bridge when Wikipedia has no language link. |
| NVD CVE API 2.0 (public domain) | `services.nvd.nist.gov/rest/json/cves/2.0` | proxy only (no browser CORS) | Published CVEs: CVSS base score, and the CISA KEV date NVD carries for exploited flaws. |

New mode `intel`: passive open-source intelligence on a topic. Its plan has six steps:
1. Who or what it is (Wikipedia, Wikidata).
2. News in English and Arabic over three months (GDELT `artlist`).
3. Coverage volume and tone per day over three months (GDELT `timelinevol` and `timelinetone`).
4. CVEs published in the last 119 days whose description holds the question's first three ASCII keywords. This is inside NVD's 120-day window.
5. Peer-reviewed research (OpenAlex, Semantic Scholar).
6. Newest research.

Intel mode has no snowball and no literature-only steps. It never scans, probes, resolves or looks anything up by address.

`trend(volume, tone)` is a fixed rule over GDELT's own numbers, labelled `[INFERENCE]`:
- the last 7 days are compared with the mean over the whole three months;
- "rising" means 1.5× or more, "falling" 0.67× or less, otherwise "steady";
- the peak day is reported;
- tone is compared the same way, last 7 days against the three-month mean.

It needs at least 14 days of data and otherwise returns nothing.

Other engine changes:
- Advisories are a new record kind: weight 0.9, grade **G**, "official public record".
- In intel mode, exploited (KEV) and severe advisories lead the extract. Their descriptions are quoted verbatim like abstracts.
- The intel gaps add "no coverage curve" and "fewer than 3 news items", and drop the scholar-only rules: fewer than 3 papers, and no Arabic source.
- The Markdown brief adds the entity, the coverage and tone section, and the advisories section with CVSS and KEV. Its closing line names the mode as passive.

Page (`omega-ops-room-v1/omega-oracle.html`):
- A mode switch; `?mode=intel` reproduces a run in that mode.
- Three OSINT examples.
- The entity card.
- A coverage curve as an SVG with no text inside. The cyan area and line are volume, the dashed grey line is the three-month mean, the shaded band is the last 7 days, and the purple dashes are tone. The numbers sit beside the curve in tabular figures.
- CVE lines with the CVSS score and a red "exploited · CISA KEV" pill.
- An advisories tab in the references, and an indigo dot for advisories in the evidence map.
- Source chips mark NVD and arXiv as needing the local server, and the status pill counts the direct sources.
- History remembers the mode.
- The CSP `connect-src` adds `doaj.org`, `dblp.org` and `www.wikidata.org`. NVD is reached only through the proxy, so it is not listed.

Proxy:
- The `/research/<source>` pattern accepts three-letter keys (`nvd`).
- Pacing per host: NVD 6.5 s (its keyless limit is 5 requests per 30 s), dblp 1 s, DOAJ 0.3 s.
- Cache life: NVD 1 h, the others 6 h.
- Four new `--check` probes.

MCP `deep_research` takes `mode`. In intel mode it returns the entity, the coverage trend without the series, and `cve` on each reference.

### 3. What was not added, and why
| Asked or implied | Decision |
|---|---|
| "Install the strongest libraries and tools" (LangGraph, CrewAI, vector stores, headless scrapers) | Not added. The agent stays a zero-dependency module the page, proxy, bridge and tests share. A new third-party package or MCP server needs Ahmad's approval and a written review (AGENTS.md §1). |
| OSINT on people, IP addresses, domains (Shodan host search, WHOIS sweeps, social scraping, dorks) | Refused. Passive OSINT only, as AGENTS.md §6a. |
| ReliefWeb, ACLED, OpenCitations | Not added in this step. ReliefWeb now needs a pre-approved app name, ACLED needs an account and key, and OpenCitations adds counts that OpenAlex and Crossref already merge. |

## Consequences
- On GitHub Pages ORACLE now reads 10 of its 12 sources directly. arXiv and NVD need the laptop proxy, and an intel run without it shows the NVD gap as تعذر التحقق منها.
- Arabic coverage grows through DOAJ's Arabic journals, and the bridge no longer fails when a Wikipedia page lacks a language link.
- The coverage trend is descriptive, not a prediction, and depends on GDELT's own normalisation.
- The touch-target rule is now met on every page under a coarse pointer, without changing the desktop density.

## Checks
- `node scripts/test-research.mjs`: 19 passed. These are the ADR-114 tests plus six new ones: URLs and proxy shapes, the new parsers, trend rules, the intel plan, a scholar run with DOAJ, dblp and Wikidata, and an intel run with KEV ordering and offline gaps.
- `node scripts/test-brain2.mjs`: 29 passed.
- The SkillSpector strict scan, the contrast gate on the four changed pages, `node --check`, and `ui-three-sizes` on every page are listed in the PR.
- A mocked browser run of ORACLE in both modes at the six sizes and themes: 12/12 PASS. Intel mode shows the trend curve, the KEV pill, two advisory nodes and the entity card, with no overflow and no console errors.
- Proxy routes tested by hand. Allowed DOAJ, dblp, Wikidata and NVD shapes reach the upstream, which answers 502 in the offline sandbox. A two-segment DOAJ path, the NVD CPE path and a foreign host are refused with 400.
