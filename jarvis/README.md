# Jarvis

A dark-first web dashboard for running AI agents: agents, workflows, runs and
approvals in one console. English UI, RTL-ready. Decision record: ADR-132.

Status: recon and design system done. No app screens or backend yet.

| Path | What it is |
| --- | --- |
| `replica/recon.md` | screens S01–S12, flows F01–F05, components, data model |
| `replica/features.csv` | feature matrix (must / should / could / skip) |
| `replica/design/tokens.json` | design tokens: the source of truth |
| `replica/design/tokens.css`, `tailwind.tokens.js` | generated from tokens.json; do not edit |
| `replica/design/components.md` | every component with states, keyboard and a11y |
| `replica/design/measurements.md` | where each value came from (all estimated) |
| `replica/design/contrast-report.txt` | WCAG + APCA gate output |
| `design/index.html` | the /design page: every primitive, both themes, LTR/RTL. Opens from disk. |
| `design/page.src.tmpl`, `scripts/build-design-page.mjs` | source and build for that page |

## Change the design

```bash
python3 .claude/skills/replica-design/build_tokens.py jarvis/replica/design/tokens.json --oklch
```

```bash
python3 .claude/skills/replica-design/contrast.py jarvis/replica/design/tokens.json --apca 60
```

```bash
node jarvis/scripts/build-design-page.mjs
```

```bash
node scripts/skillspector-audit.mjs --fix jarvis/design/index.html
```

```bash
node jarvis/scripts/build-design-page.mjs --check
```

Next steps: `/replica-architect` (stack, schema, API), then `/replica-build`.
