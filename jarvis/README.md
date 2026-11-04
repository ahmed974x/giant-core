# Jarvis

A dark-first web dashboard for running AI agents: agents, runs, approvals and logs, plus a live
**Studio** for designing websites and a **Skill Mixer** for this repo's Claude skills. English UI,
RTL-ready. Decision records: ADR-132 (design system), ADR-133 (app, glass, Studio, Mixer) and
ADR-134 (local server, real runs, workspaces, agent editor, clean-room cloner).

The page has a strict CSP with `connect-src 'self'`: it talks only to the server that serves it, and
opened from disk it uses no network at all.

**Status: phase 1 and 2 built.** All 27 must-haves are done; parity is 88.5 (`replica/parity.md`).

Run it for real with the local server (ADR-134): real data, real tool runs, three workspaces, the agent editor, and the clean-room cloner.

```bash
node --disable-warning=ExperimentalWarning jarvis/server/server.mjs
```

Then open http://127.0.0.1:8798. That uses SQLite with nothing to install.

For PostgreSQL 16, install the locked `pg` client once:

```bash
npm ci --ignore-scripts --prefix jarvis/server
```

Then start the server against your local database:

```bash
JARVIS_DB=postgres DATABASE_URL=postgres://USER@127.0.0.1:5432/jarvis node jarvis/server/server.mjs
```

Opened straight from disk instead, the page uses a labelled sample workspace and simulated runs.

| Path | What it is |
| --- | --- |
| `app/index.html` | **the app**, built; do not edit by hand |
| `app/src/` | sources: `shell.tmpl`, `app.css`, `app.js`, `preview.css`, `preview.js` (the Studio sandbox) |
| `app/data/skills-scan.json` | SkillSpector scan of `.claude/skills`, read by the build for the Skill Mixer |
| `design/index.html` | the `/design` page: every primitive, both themes, LTR/RTL |
| `fonts/` | Inter, Geist Mono, Readex Pro (OFL 1.1) with licences |
| `replica/recon.md`, `features.csv` | screens S01–S14, flows F01–F08, feature matrix |
| `replica/architecture.md`, `schema.sql` | stack, API, 11-table schema with the approval rules |
| `replica/design/` | tokens (source of truth), generated CSS and Tailwind, specs, measurements, contrast report |
| `replica/build-log.md`, `parity.md` | what is built, what is not, and the score |
| `server/` | local server: `server.mjs`, `lib/` (database adapters, store, runner, public-page fetcher, clean-room cloner, SQLite schema), `test/test-server.mjs` |
| `scripts/` | `build-app.mjs`, `build-design-page.mjs`, `test-app.mjs` (sample mode), `test-live.mjs` (live server), `font-metrics.mjs`, `lib/fonts.mjs` |

## Change the design

Regenerate the token CSS:

```bash
python3 .claude/skills/replica-design/build_tokens.py jarvis/replica/design/tokens.json --oklch
```

Run both contrast gates:

```bash
python3 .claude/skills/replica-design/contrast.py jarvis/replica/design/tokens.json --apca 60
```

```bash
node audits/verify-contrast.mjs jarvis/replica/design/tokens.css
```

Then rebuild both pages (next section).

## Rebuild the pages

Refresh the skills scan:

```bash
node scripts/skillspector-audit.mjs --json jarvis/app/data/skills-scan.json .claude/skills
```

Build both pages:

```bash
node jarvis/scripts/build-app.mjs
```

```bash
node jarvis/scripts/build-design-page.mjs
```

Re-pin their CSP hashes:

```bash
node scripts/skillspector-audit.mjs --fix jarvis/app/index.html jarvis/design/index.html
```

Confirm both pages match their sources:

```bash
node jarvis/scripts/build-app.mjs --check
```

```bash
node jarvis/scripts/build-design-page.mjs --check
```

## Test

Run the flow tests (needs `playwright-core`):

```bash
node jarvis/scripts/test-app.mjs
```

Run the live-server flow tests and the server tests:

```bash
node --disable-warning=ExperimentalWarning jarvis/scripts/test-live.mjs
```

```bash
node --disable-warning=ExperimentalWarning jarvis/server/test/test-server.mjs
```

Run the three-size check:

```bash
node scripts/ui-three-sizes.mjs "file://$PWD/jarvis/app/index.html#/studio"
```

## What Jarvis will not do

- **Money, publishing, repository permissions, installing skills, outbound messages.** These are locked «قيد الموافقة» cards that no agent can approve (AGENTS.md §1). `schema.sql` refuses them too.
- **The Studio** only downloads a file. The cloner reads one public page, obeys `robots.txt`, refuses private addresses, and keeps only its layout: no text, images, colours, scripts or brand.
- **The Skill Mixer** only copies a plan.
