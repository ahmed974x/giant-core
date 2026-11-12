---
name: replica-foss-atlas
description: An atlas of open-source tools that replace hosted products (LibreOffice, Nextcloud, Mattermost, Matomo, n8n, GIMP, Penpot, Immich, Navidrome, OpenCut, Cap, Handy, AnythingLLM, Scrapling, Brave), open lists (Project Gutenberg, Public APIs, Awesome MCP Servers, free-for-dev) and seven agent-skill projects kept as ideas, each licence read from the project's own licence file with its URL and date; a stack planner whose installs and outbound connections are proved locked approvals, with a data-sovereignty share, savings only from prices you type and an inert n8n blueprint; a privacy shield for keys and personal data; k-anonymity for a secret (SHA-1 prefix and entropy, never the secret); and seeded teaching personas. Standard-library Python only; no network, no processes.
---

# replica-foss-atlas

```bash
python3 .claude/skills/replica-foss-atlas/foss_atlas.py atlas
python3 .claude/skills/replica-foss-atlas/foss_atlas.py plan '{"selectedIds":["nextcloud","n8n","matomo"],"prices":{"nextcloud":1200}}'
python3 .claude/skills/replica-foss-atlas/foss_atlas.py scrub - < notes.txt
python3 .claude/skills/replica-foss-atlas/foss_atlas.py personas '{"seed":158,"count":3}'
python3 -m unittest discover -s .claude/skills/replica-foss-atlas/tests
```

| Part | What it does | How it stays honest |
| --- | --- | --- |
| Atlas | 26 entries: 15 tools, 4 lists, 7 agent-skill projects (`browser-use`, `agentmemory`, `scientific-agent-skills`, `Anthropic-Cybersecurity-Skills`, `awesome-harness-engineering`, `OpenViking`, `ui-ux-pro-max-skill`) | every licence is the text of the project's licence file, with the file's URL and the date it was read (2026-11-12); free-for-dev has no licence file and Project Gutenberg no repository, so both say so. The seven skill projects are ideas: nothing is installed without a written security review and Ahmad's approval (AGENTS.md §1) |
| Planner | the picks as steps, the data-sovereignty share of self-hostable tools [INFERENCE], savings from the prices you enter, an inert n8n workflow (manual trigger and no-op nodes) and an MCP list that configures nothing | every install and every outbound connection is `{gate: "approval", locked: true, status: "pending_approval"}`, proved by the reviewed `replica-formal-verify` prover; with no prices there is no savings figure |
| Privacy shield | replaces keys (the ADR-148 formats and entropy rule), e-mail addresses, IBANs, card numbers that pass Luhn, phone numbers and IPv4 addresses | counts each rule; maps to NIST CSF 2.0 Protect, PR.DS |
| k-anonymity | SHA-1 of a secret: the first 5 hex characters, the length, character classes and Shannon entropy | the secret and the other 35 characters are never returned; nothing is looked up |
| Personas | seeded teams with three picks and yearly prices | labelled «مثال تعليمي — أرقام افتراضية»; the same seed gives the same people |

The same engine runs in Jarvis (`jarvis/server/lib/foss-atlas.mjs`, the `#/atlas` page). `tests/golden.json` holds the server's answers, and both test suites check it. Key-shaped test inputs are stored with JSON escapes, so the file holds no secret-shaped text.

## Limits

- Licences were read on one day. A project can change its licence; read the file again before relying on it.
- Scrapling is listed for parsing pages you may read; its anti-bot features are not used (AGENTS.md §3).
- The shield's patterns are fixed. Text that hides personal data in other forms is not caught, so the shield is a filter, not a guarantee.
