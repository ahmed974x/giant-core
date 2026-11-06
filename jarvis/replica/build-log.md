# Build log: Jarvis

One line per screen. Build: `node jarvis/scripts/build-app.mjs`. Tests: `node jarvis/scripts/test-app.mjs` (42 checks).

| ID | screen | date | status | missing | harder than expected |
| --- | --- | --- | --- | --- | --- |
| S01 | Shell (sidebar, glass top bar, palette, toasts, dialogs, RTL, themes, workspace switcher) | 2026-11-04 | done | — | English labels inside an RTL shell needed `unicode-bidi: plaintext` so "…" stays on the right |
| S02 | Overview | 2026-11-04 | done | usage charts (could) | mixing «قيد الموافقة» into an English line needed `<bdi dir="rtl">` |
| S03 | Agents list | 2026-11-04 | done | — | — |
| S04 | Agent detail | 2026-11-04 | done | — | — |
| S05 | Agent editor (create and edit: role, model, limits, tools and permissions, linked skills; locked rows) | 2026-11-04 | done | — | the editor reuses one dialog for both, so the server and the page share the same validation |
| S06 | Workflows list (ADR-137) | 2026-11-05 | done | — | — |
| S07 | Workflow canvas (ADR-137) | 2026-11-05 | done | — | SVG text in Arabic broke apart in the mono font; node labels use Readex Pro under `:lang(ar)` |
| S08 | Runs and run detail | 2026-11-04 | done | server push (the page polls); model cost (no model yet) | real tools on the local server; file:// keeps the labelled simulation |
| S09 | Approvals (waiting, locked, decided) | 2026-11-04 | done | — | — |
| S10 | Logs | 2026-11-04 | done | date range filter | — |
| S11 | Settings | 2026-11-05 | done | — | members and roles, plans and tokens (ADR-137); a live redraw used to jump back to the first tab, so tabs now remember the chosen one |
| S12 | Design system (`jarvis/design/index.html`) | 2026-11-04 | done | — | — |
| S13 | Studio, with the clean-room cloner (ADR-134) | 2026-11-04 | done | — | the cloner keeps only layout shape; a sweep proves no source text survives | the sandboxed `srcdoc` frame inherits the parent CSP, so its one style and one script live in a `<template>` and are pinned by hash; site text goes in as JSON, never markup |
| S15 | Mission Control (ADR-135) | 2026-11-05 | done | — | right after a workspace switch the page had no change marker, so a fast mission could finish before the first poll; the switch now reads the marker at once |
| S14 | Skill Mixer | 2026-11-04 | done | live rescan (needs the phase 2 service) | the embedded SkillSpector rules flagged themselves until they sat between the scanner's data markers |
| S16 | Memory bank and Skill Forge (ADR-138) | 2026-11-05 | done | — | the forge inlined into the page clashed with the cloner's `clean`; a closed dialog kept old-language dates in the DOM, so dialogs now empty on close; textarea placeholders were never translated (the coverage test skipped them too), now both cover them, and code-sample placeholders are marked `translate="no"`; the Forge sat under the sticky Mix column, out of reach on a laptop, so it now heads the page |
| S17 | Live open-web search (ADR-139) | 2026-11-05 | done | — | Node skips a custom DNS lookup for an address written as an IP, so IP literals needed their own check before connecting |
| S18 | Skill Loader (ADR-142) | 2026-11-06 | done | — | Ctrl+K matched only whole space-separated words, so hyphenated skill names never matched; it now splits on hyphens too |
| S11b | Settings: local model engine and streamed answers (ADR-140) | 2026-11-05 | done | — | Hugging Face model ids (`Qwen/Qwen2.5-Coder-32B-Instruct`) missed the old name-prefix picker, so models are now picked by family |
| S11c | Settings: Access and hosted endpoints, /login (ADR-141) | 2026-11-06 | done | — | a 403 shown as a console error in the page, so the page records the request (202) while the direct mode change keeps its 403; fetch() drops a custom Host header, so proxy tests use http.request |

Screens built: 15 of 15, plus Analytics, Webhooks, Compare, Templates, Memory (ADR-138), Search (ADR-139) and Skill Loader (ADR-142). Must-haves: 34 of 34. Parity 100.0 (`parity.md`, ADR-142, 69 rows). Backend: `jarvis/server` (ADR-134), missions engine `jarvis/server/lib/missions.mjs` (ADR-135).
