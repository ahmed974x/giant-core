---
name: replica-passive-recon
description: Reads what a domain already publishes about itself, from files you saved - an RDAP record (RFC 7480/9083: status, DNSSEC, dates, name servers), crt.sh certificate rows (names deduplicated in one pass, wildcards, expired and expiring certificates), response headers (the six security headers graded 0-100 with fixes) and security.txt (RFC 9116: Contact, Expires, Encryption, Canonical). Standard-library Python only; it fetches nothing and starts no process.
---

# replica-passive-recon

```bash
python3 .claude/skills/replica-passive-recon/passive_recon.py rdap rdap.json
python3 .claude/skills/replica-passive-recon/passive_recon.py ct crtsh.json
python3 .claude/skills/replica-passive-recon/passive_recon.py headers headers.txt
python3 .claude/skills/replica-passive-recon/passive_recon.py securitytxt security.txt
python3 .claude/skills/replica-passive-recon/passive_recon.py --now 2026-11-07T00:00:00Z report example.com --rdap rdap.json --headers headers.txt
python3 -m unittest discover -s .claude/skills/replica-passive-recon/tests
```

| Part | What it reads | Findings |
| --- | --- | --- |
| `parse_rdap` | `status`, `secureDNS.delegationSigned`, registration and expiration events, `nameservers` | expired or expiring within 30 days, DNSSEC off or not stated, being deleted, on hold, no transfer lock |
| `parse_ct` | at most 5,000 crt.sh rows; names split on newlines into one set | a wildcard over a whole top-level domain, wildcard count, certificates in use that expire within 14 days, none still valid |
| `grade_headers` | CSP 30, HSTS 20, Permissions-Policy 15, COOP 15, X-Content-Type-Options 10, Referrer-Policy 10 | a fix per header: `'unsafe-inline'`, `'unsafe-eval'`, a bare `*`, no `default-src`, short `max-age`, weak referrer or COOP |
| `parse_security_txt` | line by line; a PGP signature block is skipped | no Contact, a Contact that is plain http or not a link, no / several / bad / past Expires, Expires more than a year ahead, no https Canonical, no Encryption |

The same rules run in Jarvis (`jarvis/server/lib/passive-recon.mjs`), which does the four GETs on the local server (rdap.org, crt.sh, the home page, `/.well-known/security.txt`) through the SSRF shield. For the same input both give the same report.

## Limits

- Use it on domains you own or may check. Passive means reading what is published: no port scan, no login attempt, no guessing of paths.
- A score is a checklist, not an audit. A good grade says the headers are present and strict, not that the site is safe.
- crt.sh times have no zone; they are read as UTC.
