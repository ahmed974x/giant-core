# Security review: the FOSS atlas and privacy shield (ADR-158)

Date: 2026-11-12 · Reviewer: Claude Code, cloud sandbox.

## 1. Files

| File | Lines | SHA-256 (first 16) | Role |
|---|---|---|---|
| `jarvis/server/lib/foss-atlas.mjs` | 206 | 9e9dcf119962e11b | The atlas, SHA-1 and k-anonymity, the privacy shield, the planner and blueprint, seeded personas |
| `.claude/skills/replica-foss-atlas/foss_atlas.py` | 348 | 031ce353fb732738 | The same engine in Python |
| `.claude/skills/replica-foss-atlas/tests/test_foss_atlas.py` | 90 | b4bd909d0ad77504 | 9 unit tests, one against the server's golden answers |
| `.claude/skills/replica-foss-atlas/tests/golden.json` | — | 831d3ffd83727a9b | The atlas, 18 plans, 8 scrubs and 5 persona requests with the server's answers |

Also changed:
- `server.mjs`: `GET /api/w/:slug/atlas`, `POST …/atlas/plan`, `POST …/privacy-shield/scrub`, `GET …/atlas/personas`;
- `app.js`, `app.css`, `shell.tmpl`, `i18n-ar.json`: the `#/atlas` page;
- `build-app.mjs`: inlines the engine with the council's libraries, which hold the ADR-148 patterns and the ADR-145 prover;
- `bilingual-purity.mjs`: adds `atlas` to the routes;
- the server, flow and mutation tests.

## 2. What it can do

- **No install, no fetch, no message.** Both engines read their own constant tables and the request. They open no socket, start no process and write no file. The Python file is checked by a unit test for the words that would. The install commands Ahmad listed (`npx`, `npm -g`, `uipro init`, `pip install`) were **not run**. The seven projects are ideas in the atlas, and in a plan each is a review step and then a locked install.
- **How the licences were read:** once, by hand, on 2026-11-12, as plain text from `raw.githubusercontent.com` into a scratch folder. Only the opening lines were read. Nothing from those files runs or is stored in the repository except the licence name and the file's URL.
- **Secrets.**
  - In the page, the secret check is hashed in the page and is never sent; the field is cleared after use.
  - On the server, `secretCheck` (Ahmad's curl form) is hashed in memory. The answer holds only the SHA-1 prefix (5 of 40 hex characters), the length, the classes and the entropy.
  - The event log records `atlas.plan` with the number of picks only: no secret, no prices.
  - No range query is sent to any breach service (`looked_up: false`).
- **The shield** runs the ADR-148 key rules, then the personal-data rules. The event log records `privacy.scrub` with the count only, never the text.
- **Locks:** every install and outbound step is `{gate: "approval", locked: true, status: "pending_approval"}`. The plan's `verified` is the prover's verdict on its state machine. The n8n blueprint is `active: false`, with no-op nodes only. The MCP list configures no server.
- **Output in the page:** text from the engine goes in with `textContent`. Licence files are links that pass `safeUrl` (https only) and open with `rel="noopener noreferrer"`.
- **Test data:** key-shaped inputs in the golden file are stored with JSON `\u` escapes, and the tests build them from parts, so no file holds a secret-shaped literal.

## 3. Cost

- The atlas is 26 constant rows. A plan of all 26 takes 0.17 ms.
- The shield is bounded at 20,000 characters, and its patterns have bounded repeats. Measured: 0.8 ms for 20,000 characters.
- SHA-1 of at most 256 characters; personas at most 12.

## 4. Honesty

- **Licences:** every licence names its file and the date it was read. free-for-dev and Project Gutenberg show «تعذر التحقق منها».
- **Savings** come only from prices the person types; with none, there is no figure.
- **Data sovereignty** is a share of the picked tools and carries [INFERENCE]. Every tool in this atlas can run on your own machine, so it reads 100% unless lists or ideas are all that is picked.
- **Personas** are labelled «مثال تعليمي — أرقام افتراضية».
- **The mutation run** found that an entropy of exactly 4.5 is reachable. The shield's boundary is now tested at that value in both languages.

## 5. Checks

| Check | Result |
|---|---|
| `node scripts/skillspector-audit.mjs --strict` on the changed files | 0 critical, 0 high |
| `ruff check .claude/skills/replica-foss-atlas` | all checks passed |
| `python3 -m unittest discover -s .claude/skills/replica-foss-atlas/tests` | 9 tests OK; Python gives the server's answers to every golden request |
| `node jarvis/scripts/mutation-harness.mjs` | `foss-atlas.mjs` 227/227 killed, 5 equivalent, each with its reason |
| `python3 jarvis/scripts/mutation_harness.py` | `foss_atlas.py` 205/205 killed, 1 equivalent, with its reason |

## 6. Decision

Added. The skill is safe to run on Ahmad's machine as written. Installing any project the atlas lists is not covered by this review and needs its own.
