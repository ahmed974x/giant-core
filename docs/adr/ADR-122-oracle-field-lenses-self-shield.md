# ADR-122: ORACLE field lenses and threat scores, and the self-shield that attacks OMEGA in a sandbox and closes what it finds

Date: 2026-10-24 · Status: Proposed (Ahmad's message of 2026-10-24 14:02Z; merge waits for his go). Stacked on ADR-121 (PR #41), which is not merged yet.

## Context
Ahmad asked for an agent that researches like an intelligence analyst across every field (medicine, science,
industry, algorithms) with free, open, reliable sources and libraries; that protects itself by attacking itself
in an isolated place, finding the holes and closing them; and that "searches the dark web".

What can be built honestly: more specialist open sources behind the existing ORACLE agent (ADR-114, ADR-115), a
published exploitation score next to each vulnerability it reports, and a defensive self-test that attacks only
OMEGA's own local proxy in a sealed sandbox and its own files, with each finding tied to a fix. What is not built:
dark-web crawling (Tor scraping, marketplaces, leak sites). It would fetch illegal material, carries legal risk, and
is not needed for a defensive desk. The lawful substitute is the published threat-intelligence the desk already
reads: CISA KEV, NVD, CIRCL Vulnerability-Lookup with MISP tags (ADR-112), SANS InfoCON (ADR-110), and now FIRST
EPSS. abuse.ch (URLhaus, ThreatFox, MalwareBazaar) and AlienVault OTX now need a free account key, so they are named
here and not wired; adding a key needs Ahmad's go and the vault (ADR-042).

## Decision
1. **Field lenses** in `scripts/lib/deep-research.mjs` (`FIELDS`, `plan(..., {field})`): medicine adds registered
   trials from ClinicalTrials.gov API v2 and PubMed through NCBI E-utilities (esearch then esummary; PubMed's own
   "Retracted Publication" type marks a retraction); science adds Zenodo open data and software and OSTI.GOV
   technical reports; industry adds OSTI.GOV and Zenodo, with Espacenet and WIPO Patentscope as link-outs because
   patent offices have no keyless open API; algorithms adds Zenodo software next to dblp and arXiv. New record kinds
   `trial` (grade G, official record) and `report` / `dataset` (grade R, archived but not peer reviewed). Trials
   with posted results come first. The medicine lens always adds the gap "not medical advice".
2. **EPSS in intel mode**: after NVD answers, one FIRST EPSS call scores up to 20 CVEs; advisories sort by CISA KEV,
   then EPSS, then CVSS. The score is shown as FIRST's published probability, never as the agent's judgement.
3. Each new source has one fixed host and path in `ENDPOINTS` (PubMed has two), its own pacing in the proxy `GAP`
   and the page, a cache life in `RESEARCH_TTL`, a row in `--check`, and is in the OpenAPI enum. The page gets a
   field control, examples, legend, tabs, the trial line, the EPSS line and English pairs. CORS sources
   (ClinicalTrials.gov, PubMed, Zenodo) are added to the ORACLE CSP; OSTI and EPSS go through the proxy only.
   The MCP bridge's `deep_research` takes `field`.
4. **Self-shield** (`scripts/lib/self-shield.mjs`, `scripts/self-shield.mjs`): starts a copy of
   `scripts/omega-data-proxy.mjs` on 127.0.0.1 and a free port with a temporary home and cache, `OMEGA_OFFLINE=1`
   (new: every upstream call refused) and `OMEGA_NO_STATUS=1` (new: no live source table), refuses to probe unless
   the proxy confirms offline mode, then sends 31 probes: path traversal (dot, encoded, slash, backslash, null byte,
   .git, source, .env, private data), DNS rebinding, foreign and look-alike origins, a private-network grant to
   Origin null, SSRF through the research route (foreign host, loopback, user@host, prototype key, port), the local
   model bridge (null and foreign origins, simple request, oversized body), methods, open redirect, security
   headers, error leakage, a 20 KB URL, one Slowloris connection, and liveness last. It also lints every page's CSP
   and markup, scans tracked files for key-shaped strings (masked), runs SkillSpector, and with `--deps` asks
   OSV.dev about npm lockfiles (off by default because it sends package names out). `--fix` applies the only safe
   automatic fix, re-pinning CSP hashes; code holes are fixed by a reviewed commit, as here. The Ops Room shield
   card loads its JSON report. `scripts/test-self-shield.mjs` (6 tests, including a real sandbox run) is in CI.
5. **Holes found and closed in this commit** (before 73/100, after 100/100; reports in `docs/security/`):
   - `pna-null` (medium): the proxy granted `Access-Control-Allow-Private-Network` to Origin `null`, which a
     sandboxed iframe on any public site also sends. Now only http(s) loopback origins get it.
   - `hdr-page`, `hdr-api` (medium, low): no `Cross-Origin-Opener-Policy` or `Cross-Origin-Resource-Policy`. Every
     answer now carries `same-origin` and `same-site`.
   - `slow-headers` (medium): Node's default let a client trickle headers for 60 s, checked every 30 s. Now
     `headersTimeout` 10 s, `requestTimeout` 30 s, checked every 2 s.

## Libraries and data used (all free; nothing closed installed or copied)
| Name | Use | Licence or terms | Source |
|---|---|---|---|
| ClinicalTrials.gov API v2 | registered trials | US NLM, public records | https://clinicaltrials.gov/data-api/api |
| NCBI E-utilities (PubMed) | medical literature | NLM terms, 3 requests/s without a key | https://www.ncbi.nlm.nih.gov/books/NBK25501/ |
| Zenodo REST API | open data and software | CERN; metadata CC0; 25 per page, 30/min anonymous | https://developers.zenodo.org/ |
| OSTI.GOV API v1 | technical reports | US DOE public metadata | https://www.osti.gov/api/v1/docs |
| FIRST EPSS API | exploitation probability | FIRST, free with attribution | https://www.first.org/epss/api |
| OSV.dev API (opt-in) | dependency vulnerabilities | Google, data CC-BY 4.0 | https://google.github.io/osv.dev/api/ |
| Node.js built-ins (`http`, `net`, `child_process`) | sandbox and probes | MIT | https://nodejs.org/ |
No npm package was added. culori@4.0.1 and apca-w3@0.1.9 (contrast gate) and the pre-installed Playwright were
used only to run the existing checks.

## Not done
- No dark-web, Tor or leak-site access; no scraping; no CAPTCHA or anti-bot bypass.
- The probes never target any host but the sandbox the script started; no port scan, no flood.
- abuse.ch and OTX are not wired (they need a key; Ahmad's go first).
- No closed model, tool or "hidden" technique was used; trading stays paper only and real trading stays locked.
- Live sources could not be reached from the cloud sandbox: the new sources were tested with documented-shape
  fixtures and a mocked browser run; `node scripts/omega-data-proxy.mjs --check` on the laptop must show the five
  new rows LIVE, and `node scripts/self-shield.mjs --deps` must be run there.

## Consequences
- ORACLE covers medicine, science, industry and algorithms with named, dated, keyless sources, and says plainly what
  it cannot read (patents, closed journals).
- Any future change that reopens one of the 31 holes fails CI.
- ACAPN is no longer sent to file:// pages; current Chrome treats file:// as local, but the Ops Room must be opened
  once from disk on the laptop to confirm data still loads.
