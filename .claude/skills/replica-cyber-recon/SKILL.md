---
name: replica-cyber-recon
description: Defensive checks before anything joins Jarvis or the repo - leaked keys (patterns plus Shannon entropy), unsafe code in pages, templates and skills (XSS sinks, eval, processes, unparameterized SQL, weak CSP, prompt injection, locked actions), developer manifests (openapi.json, llms.txt, security.txt, robots.txt) turned into build tables, and SHA-256 manifests of reviewed skills. Standard-library Python only; no network, no processes.
---

# replica-cyber-recon

Four small, defensive tools. They read files you give them; none of them reaches the network,
starts a process or runs the code it reads. Fetching a page or manifest is the Jarvis server's job
(`jarvis/server`, one GET, robots.txt respected, private addresses refused); this skill only reads
what is already on disk.

| Tool | Use it when | Exit 1 means |
| --- | --- | --- |
| `secret_audit.py PATH… [--json]` | before a commit, before a skill or template joins Jarvis | a key-shaped or high-entropy value was found |
| `static_guard.py PATH… [--json]` | before a page, template or skill is merged or hot-mounted | a critical or high finding |
| `manifest_parse.py FILE [--kind …] [--out jarvis/replica/x.md]` | you have an openapi.json, llms.txt, security.txt or robots.txt and want the screens and endpoints | security.txt failed RFC 9116 checks |
| `sbom_integrity.py write|verify FOLDER` | after a review (write), and before running a reviewed skill (verify) | a file changed, appeared or vanished |

All paths must stay inside `--root` (default: the current folder); symlinks out are refused.

## What each check means

- **secret_audit**: known shapes (cloud, Git host, chat, payment, model-provider keys, private key
  blocks, JWTs, credentials in URLs) plus any `key = "…"`, `token: "…"`, `password = "…"` whose value
  is at least 16 characters with Shannon entropy ≥ 3.5 bits per character. Matches are printed as the
  first four characters only. Mark a deliberate fixture line with `secret-audit: ignore`.
- **static_guard**: pages and scripts (markup sinks, code from strings, inline handlers, style
  attributes, javascript: links, http scripts, a missing or weak CSP, SQL from template strings or
  concatenation); Python parsed with `ast` (code from strings, processes, unsafe deserialisation,
  SQL built by formatting, network imports); any text (instruction-override phrases, and names of
  actions AGENTS.md §1 keeps locked, reported so they stay a person's approval). A detection rule
  list between SkillSpector's rule markers is data: it is skipped as SkillSpector skips it, and each
  skipped block is reported as a low `rule-block` finding with its size, so a marker never hides text
  silently.
- **manifest_parse**: endpoint table with methods, required parameters (`*`), body and auth; one
  screen per OpenAPI tag; llms.txt sections and links; security.txt fields with Contact and Expires
  checked; robots.txt groups and sitemaps.
- **sbom_integrity**: `SBOM.sha256.json` with every file's size and SHA-256 and a digest over the list.

## In giant-core

- AGENTS.md and DESIGN.md win. These tools find problems; fixing them is a normal, reviewed change.
- A finding about a locked action (money, publishing, permissions, installs, outbound messages)
  is never "fixed" by removing the lock: the action stays a «قيد الموافقة» card.
- Jarvis's Skill Forge runs the same kind of checks in the browser before a skill is hot-mounted;
  writing a skill into `.claude/skills` stays a locked install approval.
- Passive only: no port scans, no probing of hosts, no crawling. OSINT here means reading files and
  manifests a site publishes for that purpose.
