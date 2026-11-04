# ADR-133: Jarvis app with Liquid Glass, Studio and Skill Mixer; four more reviewed Replica skills

Date: 2026-11-04 · Status: Proposed. Ahmad's message of 2026-11-04 asked to continue on `claude/replica-design-jarvis` and to:

1. make the contrast gate read Jarvis tokens;
2. finalise the type and spacing measurements and vendor offline Latin and Arabic fonts;
3. add Apple Liquid Glass within DESIGN.md;
4. add a live Studio and a Skill Mixer;
5. add `replica-architect` and `replica-build` (plus `replica-test` and `replica-diff`) after a security review;
6. run `/replica-architect` and `/replica-build`, then open a PR.

The merge waits for his go.

## Context
ADR-132 left Jarvis with tokens and a `/design` page, but three things open:

- `audits/verify-contrast.mjs` could not read Jarvis role names and crashed on them.
- `measurements.md` said "estimated".
- Inter was not vendored.

Ahmad also asked for "Fable 5 standard measurements". No published design standard by that name could be found (web search on 2026-11-04 returned only unrelated brands named Fable). So the measurements are recorded as final decisions with real sources (the font files, the contrast gate, DESIGN.md), and none of them is attributed to "Fable 5".

## Decision
1. **Contrast gate.** `audits/verify-contrast.mjs` detects a file whose `:root` uses Jarvis role names and checks Jarvis pairs instead:
   - every text colour on bg, surface, surface-raised and surface-sunken;
   - the three fills;
   - text on glass, composited in sRGB over bg, surface and surface-raised.

   It checks the default theme (from `color-scheme`), the other theme, and P3 variants if present. On every OMEGA file its output is byte-identical to before.
2. **Fonts, all OFL 1.1, from Fontsource 5.3.0** (published 2026-07-19; fetched with `npm pack`, no scripts run). They live in `jarvis/fonts/` with their licences:
   - Inter Variable (Latin UI);
   - Geist Mono Variable (numbers, code);
   - Readex Pro Variable (Arabic), chosen over IBM Plex Sans Arabic because it is one variable file.

   `jarvis/scripts/font-metrics.mjs` reads their metrics from the WOFF2 tables. `jarvis/scripts/lib/fonts.mjs` writes `@font-face` rules that try `local()` first and then the embedded file, plus an `Inter Fallback` face with Inter's measured ascent and descent. Arabic gets its own taller line heights under `:lang(ar)` (`type-ar` in the tokens).
3. **Liquid Glass.**
   - New tokens: `glass` (78% tint), `glass-rim` (1px inset highlight) and `glass-edge` (1px hairline).
   - `blur(16px) saturate(180%)`.
   - Concentric radii: lg 20 = md 12 + 8, and a new xl 28 = lg 20 + 8.
   - Motion: `cubic-bezier(0.22, 1, 0.36, 1)` with durations 120, 200 and 420ms.

   Glass is used only on the sidebar, top bar, palette and toasts. `prefers-reduced-transparency` swaps it for solid `surface-raised`, and so does a missing `backdrop-filter`. The contrast gate checks 118 pairs, 0 failures. The skill tools gained what this needed: `#rrggbbaa` colours composited over a named backdrop, `oklch(… / a)` output, `type-xx` language scales, and a reduced-transparency fallback that wins over the theme blocks.
4. **Skills.** `replica-architect`, `replica-build`, `replica-test` and `replica-diff` are vendored from `Jakeschincariol/replica-skill@77c9436` (MIT).
   - Tools and templates are byte-identical to upstream.
   - Each `SKILL.md` gained a "giant-core" section that puts AGENTS.md and DESIGN.md first: payments and outward actions locked, free and self-hostable first, and no `npx playwright install`.
   - New tests: `replica-diff/tests/test_diff.py` (7).
   - Review: `docs/security/REPLICA-SKILLS-REVIEW-2026-11-04.md` (pass). SkillSpector reports 0 findings on the four folders.
5. **Architecture.** `jarvis/replica/architecture.md` and `schema.sql` (11 tables).
   - Phase 1, built in this change: one static page that opens from `file://` under a strict CSP with `connect-src 'none'`.
   - Phase 2, planned: the repo's local Postgres on 127.0.0.1, a loopback Node service, and PRIME's plan checker plus the local model bridge as the runtime.
   - The schema enforces the approval rules: `approvals_locked_never_approved`, `approvals_decided_by_member`, `approvals_reject_has_reason`, `runs_one_active_per_agent`, and an append-only `events` table. All were tested on PostgreSQL 16 in the sandbox.
6. **Build.** `jarvis/app/index.html` is built by `node jarvis/scripts/build-app.mjs` from `jarvis/app/src/`. It has Overview, Agents (with a validated create dialog), Runs (simulated, labelled), Approvals (waiting, locked, decided), Logs, Settings, Studio and Skill Mixer.
   - **Studio.** The live preview is `<iframe sandbox="allow-scripts" srcdoc>`. It inherits the parent CSP, so its one stylesheet and one script sit in a `<template>` and are pinned by hash. The site travels as JSON and is built with `textContent`. AR/EN flips `lang` and `dir`; widths are 375, 768 and 1440. A live WCAG and APCA badge covers five pairs. "Download HTML" writes one file with the same pinned CSP. "Publish" is a locked «قيد الموافقة» card.
   - **Skill Mixer.** It shows a build-time snapshot of `.claude/skills` with each skill's SkillSpector counts, an ordered plan to copy into Claude Code, and an in-browser SKILL.md checker that uses SkillSpector's own rules. The rules are embedded between the scanner's data markers, so they do not flag themselves. "Install" is a locked card.
   - **Locked categories.** Money, publish, permissions, install and outbound appear only as locked cards with no approve button. The data layer refuses them too, matching the schema.
7. **The `/design` page** (ADR-132) now uses the new fonts and glass chrome. Its button, nav, input and switch colour transitions are removed: DESIGN.md §4 allows animating `transform` and `opacity` only.

## Not done, and why
- **Phase 2 is not built:** workflows (S06, S07), agent editing, a real agent runtime and streaming, run cost, invites and roles. The UI says the run is simulated. Parity is 83.2, with 21 of 24 must-haves done (`jarvis/replica/parity.md`).
- **No Display P3 variant** for Jarvis tokens yet.
- **No `size-adjust` on `Inter Fallback`.** It would need Arial's x-height measured here, which was not possible.
- **The other upstream Replica skills** (recon, backend, brand, entrepreneur, launch, deploy) are not added.

## Consequences
- **After editing `jarvis/replica/design/tokens.json`:**
  1. `build_tokens.py … --oklch`
  2. `contrast.py … --apca 60`
  3. `node audits/verify-contrast.mjs jarvis/replica/design/tokens.css`
  4. rebuild both pages
  5. `skillspector --fix` on both
  6. both `--check` commands
- **After changing `.claude/skills`:** rerun `node scripts/skillspector-audit.mjs --json jarvis/app/data/skills-scan.json .claude/skills`, then rebuild the app.
- **Tests:**
  - `node jarvis/scripts/test-app.mjs` (42 flow checks);
  - `python3 -m unittest discover -s .claude/skills/replica-design/tests` (17);
  - `python3 -m unittest discover -s .claude/skills/replica-diff/tests` (7).

## Checks run for this change (2026-11-04)

| Check | Result |
| --- | --- |
| `node scripts/skillspector-audit.mjs --strict .` | 0 critical, 0 high (exit 0) |
| `node audits/verify-contrast.mjs` on every OMEGA file | output byte-identical to before the change |
| `node audits/verify-contrast.mjs` on Jarvis tokens, app and `/design` | 108 pairs per file, all pass |
| `contrast.py --apca 60` | 118 checks, 0 failures |
| `node jarvis/scripts/test-app.mjs` | 42 passed |
| `node scripts/ui-three-sizes.mjs` on 10 app routes and `/design` | 99 of 99 pass (no overflow, no console errors) |
| replica-design and replica-diff unit tests | 17 and 7 passed |
| `node scripts/test-knowledge.mjs` after the rebuild | 19 passed |
| `schema.sql` on PostgreSQL 16 | loads; every approval and run constraint refuses its bad case |
