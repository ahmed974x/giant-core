# Architecture: Jarvis (an original AI-agent workspace)

Written by `/replica-architect` (ADR-133) from `recon.md` (S01–S14, F01–F08) and
`features.csv` (24 must, 13 should, 6 could, 2 skip). The giant-core overrides apply:
free and self-hostable first, money and outward actions locked, `file://` pages under a
strict CSP, local services on `127.0.0.1`.

## Stack

Two phases, both built. Phase 1 is the static page (ADR-133). Phase 2 is the local server (ADR-134), whose schema is `schema.sql` in PostgreSQL and `jarvis/server/lib/schema-sqlite.sql` in the zero-setup mode.

| layer | choice | why |
| --- | --- | --- |
| web (phase 1) | One static page, `jarvis/app/index.html`: vanilla JS, hash router, no framework | Opens from `file://` with a strict CSP and `connect-src 'none'`, like the Ops Room. Nothing to install and nothing to serve. |
| build | `node jarvis/scripts/build-app.mjs` (Node standard library) | Inlines tokens, fonts, the skills snapshot and the preview runtime into one file. SkillSpector then pins the CSP hashes. |
| styling | `tokens.css` from replica-design (OKLCH) plus page CSS using `var(--…)` only | One source of truth; the contrast gate reads the same file |
| data (phase 1) | An in-page data layer (`store`) whose function names match the phase 2 API, seeded with labelled sample data; UI preferences in `localStorage` (wrapped in try/catch) | Swapping in the real API later changes no screen code |
| skills data | A snapshot made at build time from `.claude/skills/*/SKILL.md` plus a SkillSpector JSON scan | Real data, with the scan time on screen. The browser cannot read the repo. |
| live preview | `<iframe sandbox="allow-scripts" srcdoc>` | The frame's one style and one script are fixed, and their hashes are pinned in the parent CSP, which the frame inherits. The site itself is sent as JSON and built in the frame with `textContent`. No network, no same-origin access. |
| database (phase 2) | The repo's local Postgres (the `timescale` service, `127.0.0.1:5432`), migration `db/jarvis/01-schema.sql` copied from `schema.sql` | Already runs here, free; one database |
| API (phase 2) | A Node standard-library HTTP service, `jarvis/server`, on `127.0.0.1:8798`, using `pg` the way `web/` does | Same pattern as `scripts/omega-data-proxy.mjs`; loopback only |
| auth (phase 2) | One local owner (Ahmad) on loopback; members and roles table ready for later | No outside identity provider is needed while it is local |
| agent runtime (phase 2) | PRIME's plan checker (`scripts/lib/agent-core.mjs`) and the local model bridge `POST /llm/ollama/*` | Reuses reviewed, paper-only code. No `:cloud` model. |
| payments | none, **locked** | AGENTS.md §1 |
| email | none | Outbound messages are approval items |
| hosting | the laptop (`start-omega.bat` / `.sh`); GitHub Pages for the static page only if Ahmad asks | Publishing to a domain is a locked approval item |

## Schema

Tables: 11 (`schema.sql`).

**Access rules.** Phase 2 runs a data-layer check on every query in `jarvis/server`: the caller's member row and its role on the workspace. Row level security is noted in the SQL for when there is more than one user.

**The constraints that matter:**

- **`approvals_locked_never_approved`.** An approval in a locked category (`money`, `publish`, `permissions`, `install`, `outbound`) cannot be approved. Only a migration made after Ahmad's written approval can change that.
- **`approvals_decided_by_member`.** The decider is a member, never an agent. Agents have no member row, so an agent cannot approve its own request.
- **`runs_one_active_per_agent`.** A partial unique index stops two runs of the same agent from being active at once.
- **`events` is append-only.** A trigger refuses `update` and `delete`.

## API (phase 2)

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| GET /api/agents | list agents | member | `?status=&q=` | `Agent[]` | F01 |
| POST /api/agents | create an agent | admin+ | name, role_prompt, model, tools, limits | `Agent` | F01 |
| GET /api/agents/:id | one agent with recent runs | member | – | `Agent` + `Run[]` | F01, F04 |
| PATCH /api/agents/:id | edit | admin+ | partial agent | `Agent` | F04 |
| POST /api/agents/:id/runs | start a run; the plan passes `checkPlan` first | operator+ | trigger | `Run` | F01 |
| GET /api/runs/:id | run with steps | member | – | `Run` + `Step[]` | F01, F04 |
| GET /api/runs/:id/stream | live steps and log (Server-Sent Events, loopback) | member | – | event stream | F01 |
| POST /api/runs/:id/cancel | cancel | operator+ | – | `Run` | F04 |
| GET /api/approvals | inbox | member | `?status=` | `Approval[]` | F02 |
| POST /api/approvals/:id/decide | approve or reject; the reason is required on reject; locked categories are refused by the database | admin+ (a human) | decision, reason | `Approval` | F02 |
| GET /api/workflows, POST, PATCH /:id | workflows | member / admin+ | graph | `Workflow` | F03 |
| GET /api/events | audit log | member | `?kind=&from=&to=` | `Event[]` | F04 |
| GET /api/sites, PUT /api/sites/:id | Studio drafts | member | blocks, theme | `Site` | F06 |
| GET /api/skills | skills snapshot plus SkillSpector status | member | – | `Skill[]` | F07 |
| GET /api/mixes, POST | saved skill mixes | member | ordered names | `Mix` | F07 |

- **Webhooks in or out:** none.
- **Jobs:** `skills-scan`, on demand, re-runs SkillSpector over `.claude/skills` and refreshes `skills`.
- **Not in the API:** publish, permission changes and money. They exist only as approval rows that cannot be approved.

## The parts that bite

- **Strict CSP and the live preview.** `about:srcdoc` inherits the parent CSP, so the preview's style and script must be exactly the pinned `<template>` copies. Any change means a rebuild and `skillspector --fix`. Tested in Chromium on 2026-11-04: it runs with no CSP errors.
- **User text in the preview.** It goes in as JSON (`<` escaped as `<`) and is placed with `textContent`, never as markup. The sandbox has no same-origin access.
- **RTL.** Logical properties everywhere. The preview flips `dir` and `lang` on its `<html>`, and numbers stay `direction: ltr`.
- **Idempotency.** Starting a run twice is blocked by `runs_one_active_per_agent`, and a decision twice by `status = 'pending'` in the `where` clause.
- **Races.** Two people deciding one approval: the update only applies to a pending row, so one of them gets "already decided".
- **Offline.** Phase 1 is fully offline. Phase 2 is loopback only.
- **Secrets.** Model keys go in the vault or dotenvx, never in `agents.limits` and never in `localStorage`.
- **Deleting data.** `on delete cascade` from `workspaces`. The append-only `events` table is kept until its workspace is deleted.

## Build order

1. **Vertical slice (this change).**
   - Screens: the shell (S01), Agents (S03, S04), a run (S08), Approvals (S09).
   - Data: the in-page store with sample data.
   - Flow: create an agent, run it (a labelled simulated run), see an approval, decide it.
2. **Must-haves (this change).**
   - Screens: Overview (S02), the Studio (S13), the Skill Mixer (S14), locked approval cards, contrast, keyboard, RTL.
   - S05 is a dialog form on S03, not a separate route.
3. **Should-haves (this change, where marked done in `features.csv`).** Logs (S10), Settings (S11), toasts, downloading the Studio HTML, checking a SKILL.md, glass chrome.
4. **Phase 2 (built, ADR-134).**
   - `jarvis/server` on SQLite or PostgreSQL 16.
   - The page switches to the API when the server serves it.
   - Real tool runs, an approval-gated note writer, workspaces, the agent editor, and the clean-room cloner (`POST /api/studio/clean-clone`).
5. **Next.**
   - Workflows (S06, S07).
   - Server push instead of polling.
   - Wiring in the loopback model bridge, after its own review.
   - A second user with roles.
