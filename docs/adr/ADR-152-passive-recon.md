# ADR-152: Passive recon with no key

Date: 2026-11-07 · Status: Proposed. Ahmad's message of 2026-11-07 asked for passive recon of a domain in one ADR, after ADR-151's reply offered it:
- a standard-library skill and a server engine, with no `.env` key, no outside add-on and no offensive probe;
- **RDAP (RFC 7480):** status, DNSSEC, expiry and name servers, with warnings;
- **Certificate Transparency (crt.sh JSON):** names deduplicated in one pass, expired certificates and wildcards;
- **security headers:** six headers graded 0 to 100 with fixes;
- **security.txt (RFC 9116):** Contact and a valid, unexpired Expires;
- `POST /api/w/:slug/recon/passive`, and a panel that passes the bilingual purity gate and keeps the AGENTS.md §1 locks.

## Decision

1. **`jarvis/server/lib/passive-recon.mjs`.** Four pure parsers, inlined into the page as well.

   | Parser | Reads | Findings |
   | --- | --- | --- |
   | `parseRdap` | `status`, `secureDNS.delegationSigned`, registration and expiration events, `nameservers` (capped at 20, 50, 20) | expired; expiring within 30 days; DNSSEC off or not stated; being deleted; on hold; no transfer lock |
   | `parseCt` | at most 5,000 crt.sh rows; each row's names into one `Set` | a wildcard over a whole top-level domain; the wildcard count (5 or more is medium); certificates in use that expire within 14 days; none still valid |
   | `gradeHeaders` | CSP 30, HSTS 20, Permissions-Policy 15, COOP 15, X-Content-Type-Options 10, Referrer-Policy 10 | CSP loses 8 each for `'unsafe-inline'`, `'unsafe-eval'` and a bare `*`, and 6 with no `default-src`; HSTS gets full points at a year. Grades: A 90+, B 75+, C 60+, D 40+, F |
   | `parseSecurityTxt` | line by line, 32 KB at most; a PGP signature block is skipped | no Contact; a plain-http Contact, or one that is not a link; no Expires, several, or one that is not an ISO 8601 date and time; Expires in the past or more than a year ahead; no https Canonical; no Encryption |

   - **Scanning:** every scan is one pass. The only patterns are anchored and bounded, so a hostile 200 KB input stays linear; a test reads 20,000 certificate rows in under a second.
   - **Dates:** crt.sh times carry no zone, so they are read as UTC (`utcMs`). Before, they would have been read as local time.
2. **Fetching on the local server: four GETs, nothing else.**
   - **The requests:**
     - `https://rdap.org/domain/<name>`;
     - `https://crt.sh/?q=%25.<name>&output=json`;
     - `https://<name>/` (its headers);
     - `https://<name>/.well-known/security.txt`.
   - **The fetcher:** they go through a new `fetchPublicResource` in `fetch-public.mjs`, with the same SSRF shield as the cloner: every DNS answer checked, 3 redirects each checked again, 2 MB, 10 s. robots.txt is obeyed on the site's own two paths.
   - **Input:** domain names only (`normalizeDomain`); an IP address, a single name, a port or anything else is refused with 400.
   - **Failures:** a part that cannot be read is a stated gap, never a guess.
   - **Log:** each run is a `recon.passive` event.
3. **The page `#/recon`** ("Passive recon", under System):
   - a domain field;
   - the four panels with their findings;
   - the header list with points and fixes;
   - a "Still locked" line.

   **Sample mode:** with no network, it shows a teaching example of made-up records for the reserved `example.com`, labelled «مثال تعليمي — أرقام افتراضية».

   **Language:** every string has its Arabic line. Identifiers (statuses, header names, contacts) sit in `<code dir="ltr">`; "RFC 7480" and "RFC 9116" stay isolated in Arabic sentences. A contact value that breaks a rule is shown as data beside the finding, not inside the sentence. Dates are shown as ISO `YYYY-MM-DD`, which stays in order in both directions.
4. **`.claude/skills/replica-passive-recon/passive_recon.py`.**
   - **What it is:** the same four parsers, reading files the person saved. It fetches nothing, starts no process, and imports only `argparse`, `datetime`, `json`, `re`, `sys` and `urllib.parse`.
   - **Same output:** for the teaching example its report equals the server's, part by part.
5. **Mutation run.** Both join it:
   - `passive-recon.mjs`: 234 / 234 killed, 8 equivalent;
   - `passive_recon.py`: 264 / 264 killed, 9 equivalent.

   Each equivalent has its reason, for example "the shortest name the label rules accept is four characters". All ten files together: 1,506 / 1,506.

Review: `docs/security/PASSIVE-RECON-REVIEW-2026-11-07.md`.

## Consequences

- **Scope:** recon is for domains the person owns or may check; the page says so.
- **Reach:** nothing here scans ports, tries a login, guesses a path or sends a message. Those stay outside Jarvis and wait for Director 00.
- **Outside services:** crt.sh and rdap.org are public services with their own limits. A busy crt.sh shows as a gap, and the page says which part was not read.
- **The grade:** a checklist, not an audit.

## Checks

The results are in the PR body:
- server tests on SQLite and PostgreSQL 16 (parsers, the route with a stub fetcher, four GETs with robots on the site's paths, gaps, refusals, the event);
- `test-app.mjs` F34 and the live block in `test-live.mjs`;
- the bilingual purity gate with the recon result screen;
- skill unit tests and ruff;
- the mutation run;
- SkillSpector, contrast, three sizes, retina screenshots and parity.
