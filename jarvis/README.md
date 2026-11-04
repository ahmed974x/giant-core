# Jarvis

A dark-first web dashboard for running AI agents: agents, runs, approvals and logs, plus a live
**Studio** for designing websites and a **Skill Mixer** for this repo's Claude skills. English UI,
RTL-ready. Decision records: ADR-132 (design system) and ADR-133 (app, glass, Studio, Mixer).

Open `jarvis/app/index.html` straight from disk. It needs no server and no network (strict CSP,
`connect-src 'none'`).

**Status: phase 1.** All screens run on a labelled sample workspace, and runs are simulated (no model or tool is called). Phase 2 is planned in `replica/architecture.md` and `replica/schema.sql`: the repo's local Postgres, a loopback service, and PRIME's plan checker as the runtime. Parity is 83.2 (`replica/parity.md`).

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
| `scripts/` | `build-app.mjs`, `build-design-page.mjs`, `test-app.mjs`, `font-metrics.mjs`, `lib/fonts.mjs` |

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

Run the three-size check:

```bash
node scripts/ui-three-sizes.mjs "file://$PWD/jarvis/app/index.html#/studio"
```

## What Jarvis will not do

- **Money, publishing, repository permissions, installing skills, outbound messages.** These are locked «قيد الموافقة» cards that no agent can approve (AGENTS.md §1). `schema.sql` refuses them too.
- **The Studio** only downloads a file.
- **The Skill Mixer** only copies a plan.
