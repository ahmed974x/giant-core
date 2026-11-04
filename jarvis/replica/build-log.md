# Build log: Jarvis

One line per screen. Build: `node jarvis/scripts/build-app.mjs`. Tests: `node jarvis/scripts/test-app.mjs` (42 checks).

| ID | screen | date | status | missing | harder than expected |
| --- | --- | --- | --- | --- | --- |
| S01 | Shell (sidebar, glass top bar, palette, toasts, dialogs, RTL, themes) | 2026-11-04 | done | multi-workspace switcher (phase 2) | English labels inside an RTL shell needed `unicode-bidi: plaintext` so "…" stays on the right |
| S02 | Overview | 2026-11-04 | done | usage charts (could) | mixing «قيد الموافقة» into an English line needed `<bdi dir="rtl">` |
| S03 | Agents list | 2026-11-04 | done | — | — |
| S04 | Agent detail | 2026-11-04 | done | — | — |
| S05 | New agent (dialog on S03) | 2026-11-04 | partial | editing an existing agent (phase 2 API) | — |
| S06 | Workflows list | — | not started | all (phase 2) | — |
| S07 | Workflow canvas | — | not started | all (phase 2) | — |
| S08 | Runs and run detail | 2026-11-04 | partial | the run is simulated; real runtime, SSE streaming and cost are phase 2 | — |
| S09 | Approvals (waiting, locked, decided) | 2026-11-04 | done | — | — |
| S10 | Logs | 2026-11-04 | done | date range filter | — |
| S11 | Settings | 2026-11-04 | partial | invites and roles (phase 2) | — |
| S12 | Design system (`jarvis/design/index.html`) | 2026-11-04 | done | — | — |
| S13 | Studio | 2026-11-04 | done | — | the sandboxed `srcdoc` frame inherits the parent CSP, so its one style and one script live in a `<template>` and are pinned by hash; site text goes in as JSON, never markup |
| S14 | Skill Mixer | 2026-11-04 | done | live rescan (needs the phase 2 service) | the embedded SkillSpector rules flagged themselves until they sat between the scanner's data markers |

Screens built: 12 of 14 (9 done; S05, S08 and S11 partial). Not started: S06, S07. Must-haves: 21 of 24 done, 3 partial. Parity 83.2 (`parity.md`).
