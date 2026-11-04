# Build log: Jarvis

One line per screen. Build: `node jarvis/scripts/build-app.mjs`. Tests: `node jarvis/scripts/test-app.mjs` (42 checks).

| ID | screen | date | status | missing | harder than expected |
| --- | --- | --- | --- | --- | --- |
| S01 | Shell (sidebar, glass top bar, palette, toasts, dialogs, RTL, themes, workspace switcher) | 2026-11-04 | done | — | English labels inside an RTL shell needed `unicode-bidi: plaintext` so "…" stays on the right |
| S02 | Overview | 2026-11-04 | done | usage charts (could) | mixing «قيد الموافقة» into an English line needed `<bdi dir="rtl">` |
| S03 | Agents list | 2026-11-04 | done | — | — |
| S04 | Agent detail | 2026-11-04 | done | — | — |
| S05 | Agent editor (create and edit: role, model, limits, tools and permissions, linked skills; locked rows) | 2026-11-04 | done | — | the editor reuses one dialog for both, so the server and the page share the same validation |
| S06 | Workflows list | — | not started | all (phase 2) | — |
| S07 | Workflow canvas | — | not started | all (phase 2) | — |
| S08 | Runs and run detail | 2026-11-04 | done | server push (the page polls); model cost (no model yet) | real tools on the local server; file:// keeps the labelled simulation |
| S09 | Approvals (waiting, locked, decided) | 2026-11-04 | done | — | — |
| S10 | Logs | 2026-11-04 | done | date range filter | — |
| S11 | Settings | 2026-11-04 | partial | invites and roles need a second user | — |
| S12 | Design system (`jarvis/design/index.html`) | 2026-11-04 | done | — | — |
| S13 | Studio, with the clean-room cloner (ADR-134) | 2026-11-04 | done | — | the cloner keeps only layout shape; a sweep proves no source text survives | the sandboxed `srcdoc` frame inherits the parent CSP, so its one style and one script live in a `<template>` and are pinned by hash; site text goes in as JSON, never markup |
| S14 | Skill Mixer | 2026-11-04 | done | live rescan (needs the phase 2 service) | the embedded SkillSpector rules flagged themselves until they sat between the scanner's data markers |

Screens built: 12 of 14 (11 done; S11 partial). Not started: S06, S07 (workflows). Must-haves: 27 of 27. Parity 88.5 (`parity.md`). Backend: `jarvis/server` (ADR-134).
