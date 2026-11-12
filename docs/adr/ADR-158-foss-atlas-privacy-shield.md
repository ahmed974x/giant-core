# ADR-158: The FOSS atlas and privacy shield

Date: 2026-11-12 · Status: Proposed. Ahmad's messages of 2026-11-07 and 2026-11-12 asked for:
- page `#/atlas`, the skill `.claude/skills/replica-foss-atlas/` and the engine `jarvis/server/lib/foss-atlas.mjs`;
- the replacements: LibreOffice, Nextcloud, Mattermost, Matomo, n8n, GIMP, Penpot, Immich, Navidrome, OpenCut, Cap, Handy, AnythingLLM, Scrapling and Brave, and the lists Project Gutenberg, Public APIs, Awesome MCP and free-for-dev;
- licence names isolated in Arabic (ADR-151);
- a planner with a data-sovereignty share, yearly savings and an n8n / MCP JSON blueprint, its install and outbound steps locked `{gate: "approval", locked: true, status: "pending_approval"}` with «بانتظار الموافقة»;
- k-anonymity: SHA-1 computed locally, only the first 5 hex characters kept, with Shannon entropy. The secret is never sent or logged;
- seeded synthetic personas in Arabic and English, labelled «مثال تعليمي — أرقام افتراضية»;
- a privacy shield that scrubs keys and personal data before anything goes to a model, in line with NIST CSF 2.0;
- the seven agent-skill projects documented in the atlas: `browser-use`, `rohitg00/agentmemory`, `K-Dense-AI/scientific-agent-skills`, `mukul975/Anthropic-Cybersecurity-Skills`, `awesome-harness-engineering`, `volcengine/OpenViking` and `nextlevelbuilder/ui-ux-pro-max-skill`, with the commands that install them.

## Decision

1. **The atlas** (`FOSS_ATLAS`): 26 entries, each with its category, kind (tool, list or skill idea), what it replaces and whether it runs on your own machine.
   - **Licences, with no invented data (AGENTS.md §3):** each licence is the text of the project's own licence file, read from `raw.githubusercontent.com/<repo>/HEAD/<file>` on 2026-11-12. The atlas keeps the file's URL and that date. Mixed licences say so:
     - Mattermost: AGPL-3.0 source, MIT compiled builds, Apache-2.0 templates;
     - Cap: AGPL-3.0, with MIT camera crates;
     - LibreOffice: MPL-2.0, with GPL-3.0 text in `COPYING`;
     - n8n: Sustainable Use License, which is source-available fair-code and not OSI-approved.
   - **No licence found:** free-for-dev has no licence file at its root, and Project Gutenberg has no repository. Both have no licence, and the page shows «تعذر التحقق منها».
   - **The seven skill projects are ideas.** Their licences were read the same way. They are not installed: `npx`, `npm -g`, `uipro init` and `pip install` are not run, because AGENTS.md §1 needs Ahmad's approval and a written security review first. In a plan, each becomes a security-review step and then a locked install.
   - **Scrapling** is listed for parsing pages you may read. Its anti-bot features are not used (AGENTS.md §3), and the entry says so.
2. **The planner** (`planFossStack({selectedIds, prices, secretCheck})`).
   - **Steps:** read the entries, then one locked `install` approval per tool or skill idea, a locked `outbound` approval to connect n8n to outside services, and a final check gate. Each step depends on the one before. The plan is proved with `prover.mjs` (ADR-145): no deadlock, every step reachable, no install or outbound effect without a locked approval.
   - **Data sovereignty:** the share of the picked tools that run on your own machine, marked `[INFERENCE]`.
   - **Savings:** only the sum of the yearly prices the person types. With no prices there is no figure: no price is invented.
   - **Blueprint:** an inert n8n workflow (one manual trigger and no-op nodes, `active: false`) and an MCP list with no server configured.
3. **The privacy shield** (`scrubPrivate(text)`).
   - **Keys:** the ADR-148 key formats and the entropy rule (4.5 bits a character; hex digests kept).
   - **Personal data:** e-mail addresses, IBANs, card numbers that pass Luhn's check, phone numbers in international form and IPv4 addresses.
   - **Output:** the redaction counts per rule, mapped to NIST CSF 2.0 Protect, PR.DS. The event log keeps only the total.
4. **k-anonymity** (`kAnonymity(secret)`).
   - **Hash:** SHA-1 in plain JavaScript (checked against Node's crypto), so the page needs no WebCrypto.
   - **Returned:** the first 5 hex characters, the length, the character classes and the Shannon entropy.
   - **Never returned:** the secret and the other 35 characters.
   - **No lookup:** nothing is looked up (`looked_up: false`), because no range query to a breach service was approved.
   - **In the page,** the secret is hashed in the page and is not sent to the server.
5. **Personas** (`personas({seed, count})`): a seeded generator (mulberry32) of up to 12 teams, each with a name and a role in Arabic and English, a team size, three picks and yearly prices. They are labelled «مثال تعليمي — أرقام افتراضية». The same seed gives the same people.
6. **Server.**
   - `GET /api/w/:slug/atlas`;
   - `POST /api/w/:slug/atlas/plan`, whose event `atlas.plan` keeps the number of picks only;
   - `POST /api/w/:slug/privacy-shield/scrub`, whose event `privacy.scrub` keeps the count only;
   - `GET /api/w/:slug/atlas/personas?seed=&count=`.
   - Bad input is a 400 with the field. The usual write rules apply.
7. **Page `#/atlas` ("FOSS atlas").**
   - The atlas by category, with checkboxes, licence text marked as English data, links to the licence files and status badges. The skill ideas show a violet "needs a security review".
   - Yearly price fields for the picked tools, the optional secret check, the plan with «بانتظار الموافقة» on each locked step, the shield, and the personas with "use these picks and prices".
8. **`.claude/skills/replica-foss-atlas/foss_atlas.py`.** The same engine in Python. It uses the reviewed `replica-formal-verify` prover, with the ADR-148 patterns copied and JavaScript's whitespace written out. `tests/golden.json` holds the server's answers. Key-shaped test inputs are stored with JSON escapes, so the file holds no secret-shaped text.

Review: `docs/security/FOSS-ATLAS-PRIVACY-SHIELD-REVIEW-2026-11-12.md`.

## Consequences

- Licences can change. The atlas says the date it read them, and the page links each file.
- The shield is a filter of fixed patterns, not a guarantee. Personal data in other forms is not caught.
- Installing any of the seven skill projects, or wiring an MCP server, stays a separate task: a written review, Ahmad's approval, then an ADR.

## Checks

The results are in the PR body:
- server tests on SQLite and PostgreSQL 16;
- `test-app.mjs` F40 and the live block;
- skill unit tests and ruff;
- the mutation run;
- the bilingual purity gate with the atlas, a plan, a scrub and the personas;
- SkillSpector, contrast, three sizes, retina screenshots and parity.
