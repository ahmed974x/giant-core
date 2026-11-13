# Security review: passive recon and the replica-passive-recon skill (ADR-152)

Date: 2026-11-07 · Reviewer: Claude Code, cloud sandbox.

## 1. Files

| File | Lines | SHA-256 (first 16) | Role |
|---|---|---|---|
| `.claude/skills/replica-passive-recon/SKILL.md` | 30 | c649716c9cbf2771 | Parts, limits |
| `.claude/skills/replica-passive-recon/passive_recon.py` | 353 | 0894e8592132e44e | Four parsers and a CLI over saved files |
| `.claude/skills/replica-passive-recon/tests/test_passive_recon.py` | 97 | 2d8d895d38bf7241 | 7 unit tests |
| `jarvis/server/lib/passive-recon.mjs` | 218 | cc840b56ca206213 | The same parsers in JavaScript, and the four-GET runner |

Also changed:
- `fetch-public.mjs`: `fetchPublicResource`;
- `server.mjs`: the route and the injectable `reconFetch`;
- `app.js`, `app.css`, `shell.tmpl` and `i18n-ar.json`: the page;
- the flow, server and mutation tests.

## 2. What is fetched, and from where

- **Four GETs per run, no more:**
  - `https://rdap.org/domain/<name>`;
  - `https://crt.sh/?q=%25.<name>&output=json`;
  - `https://<name>/`;
  - `https://<name>/.well-known/security.txt`.
- **No key, no POST:** nothing about the person or the workspace is sent; the only input in the URLs is the domain name.
- **The name:** `normalizeDomain` keeps lower-case labels of a-z, 0-9 and "-" with a letter top-level label (or `xn--`). It refuses IP addresses, single names such as `localhost`, ports, underscores and anything over 253 characters. So no private address can be named directly.
- **The SSRF shield:** `fetchPublicResource` uses the cloner's own `follow` and `safeLookup`. Every DNS answer is checked inside the socket's lookup, which refuses private, loopback, link-local and reserved addresses in every IPv6 spelling (ADR-139). There are at most 3 redirects, each checked again; 2 MB; 10 s; and an honest user agent.
- **robots.txt:** obeyed for the site's own two paths. rdap.org and crt.sh are APIs meant for tools.
- **Not done:** no port is scanned, no path is guessed, no login is tried and no anti-bot check is bypassed. AGENTS.md §6a: OSINT is passive.

## 3. Untrusted input

- **What arrives:** the RDAP JSON, crt.sh JSON, headers and security.txt are outside data.
  - The parsers read only named fields, cap every list (20 statuses, 50 events, 20 name servers, 5,000 certificate rows, 200 names shown, 20 values a field, 300 characters a value, 32 KB of security.txt), and never evaluate anything.
  - JSON is parsed with `JSON.parse`, and a parse failure is a stated gap.
- **Denial of service:** each parser is one pass. The patterns are anchored with bounded repeats: no nested quantifier and no backtracking over the input.
  - **Server tests:** 20,000 certificate rows are read in under a second, and two hostile 200 KB security.txt texts in under half a second.
  - **The mutation oracle** keeps a 5,001-row case, so a slow change fails it with a time-out.
- **On the page:** every value is written with `textContent`. Contact values and other data go into `<code>` marked `data-verbatim`. No link from the data is made clickable.

## 4. The skill

- **Imports:** `argparse`, `datetime`, `json`, `re`, `sys` and `urllib.parse`. No network, `subprocess`, `exec` or `importlib`.
- **Files:** it reads the files named on the command line and writes only to stdout.

## 5. Checks

| Check | Result |
|---|---|
| `node scripts/skillspector-audit.mjs --strict` on the skill and `passive-recon.mjs` | 0 critical, 0 high; 3 medium are the plain-http URLs the skill's tests feed on purpose (the rule they check), 2 low name rdap.org and crt.sh |
| `ruff check .claude/skills/replica-passive-recon` | all checks passed |
| `python3 -m unittest discover -s .claude/skills/replica-passive-recon/tests` | 7 tests OK |
| `node jarvis/scripts/mutation-harness.mjs` (with `passive-recon.mjs`) | 234/234, 8 equivalent |
| `python3 jarvis/scripts/mutation_harness.py` (with `passive_recon.py`) | 264/264, 9 equivalent |

## 6. Decision

Added. The skill is safe to run on Ahmad's machine as written. A later change needs a new entry here.
