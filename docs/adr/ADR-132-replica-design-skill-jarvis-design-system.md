# ADR-132: replica-design skill and the Jarvis design system

Date: 2026-11-04 · Status: Proposed. Ahmad's message of 2026-11-04 asked to add the skill at `.claude/skills/replica-design/` on a new branch and to start Jarvis with `/replica-recon` then `/replica-design`. The merge waits for his go.

## Context
Ahmad wants Jarvis, an English, dark-first web dashboard for running AI agents (agents, workflows, runs, approvals). It should follow the layout pattern of open developer dashboards (sidebar navigation, a dense central workspace) and be ready for RTL later. He also wants the `replica-design` skill in this repo, so every session here can use it. AGENTS.md §1 lets a third-party skill in only with his approval and a written security review. DESIGN.md is binding on look and feel: OKLCH tokens, one accent, WCAG ≥ 4.5 **and** APCA Lc ≥ 60, no purple-blue gradient, motion on transform and opacity only.

## Decision
1. **Skill.** `.claude/skills/replica-design/` is a reviewed rewrite of upstream `replica-design` (MIT, commit `77c9436`). It holds `SKILL.md`, `sample.py` (colours from PNG screenshots), `build_tokens.py` (tokens.json to CSS and Tailwind) and `contrast.py` (WCAG gate), all standard library and offline. For this repo it adds:
   - `contrast.py --apca 60`: APCA-W3 0.0.98G-4g. The numbers match `apca-w3@0.1.9` on five reference pairs.
   - `build_tokens.py --oklch`: OKLCH output. It reproduces DESIGN.md's values for `#F5F5F7` and `#1C1C1E` exactly.
   - `"theme-default": "dark"`: `:root` is dark whatever the OS says, and light is a toggle.

   The review is `docs/security/REPLICA-DESIGN-SKILL-REVIEW-2026-11-04.md` (verdict: pass). The other ten upstream skills are not added.
2. **Recon.** `jarvis/replica/recon.md` and `features.csv`: 12 screens (S01–S12), 5 flows, 18 components, 8 entities, 33 features (16 must, 9 should, 6 could, 2 skip). No screenshots of any product were taken, and no product's code was read. The pattern sources are named in the file.
3. **Design system.** `jarvis/replica/design/` holds `tokens.json` (source of truth), the generated `tokens.css` (OKLCH, hex in comments) and `tailwind.tokens.js`, plus `measurements.md` (every value marked estimated), `components.md` and `contrast-report.txt`.
   - Electric blue is the one accent: `#77bcff` dark, `#0b5ed7` light.
   - Violet appears only as the `approval` status, the repo's existing meaning for "awaiting approval".
   - No gradients.
   - Gate: 62 checks in dark and light, 0 failures at WCAG AA plus APCA Lc 60.
4. **/design page (S12).** `jarvis/design/index.html` is built by `node jarvis/scripts/build-design-page.mjs` from `page.src.tmpl`. It renders every primitive in every state, on placeholder data labelled on screen.
   - Inlines the tokens and the vendored JetBrains Mono, so it works from `file://`.
   - Strict CSP pinned by SkillSpector, `connect-src 'none'`.
   - Theme toggle and LTR/RTL toggle; logical properties only.
   - The shell is a 248px sidebar, a 64px rail at 768–1279px and a drawer on phones.
   - Command palette on Ctrl+K / ⌘K (APG combobox in a modal dialog).
   - Money and order actions appear only as a locked «قيد الموافقة» card that Jarvis cannot approve.

## Not done, and why
- `audits/verify-contrast.mjs` reads OMEGA's token names (`--content-primary`, …) and crashes on Jarvis's role names. Jarvis is gated by `contrast.py --apca 60` instead, which applies the same two thresholds.
- No Display P3 variant yet; Jarvis tokens are sRGB in OKLCH notation.
- Inter is not vendored, so Latin UI text falls back to system-ui.
- No screens beyond `/design` (next: `/replica-architect`, then `/replica-build`). No backend, no agent runtime.

## Consequences
- After editing `jarvis/replica/design/tokens.json`, run:
  1. `python3 .claude/skills/replica-design/build_tokens.py jarvis/replica/design/tokens.json --oklch`
  2. `python3 .claude/skills/replica-design/contrast.py jarvis/replica/design/tokens.json --apca 60`
  3. `node jarvis/scripts/build-design-page.mjs`
  4. `node scripts/skillspector-audit.mjs --fix jarvis/design/index.html`
  5. `node jarvis/scripts/build-design-page.mjs --check`
- Checks run for this change: SkillSpector `--strict` on the whole repo (0 critical, 0 high); the skill's 13 unit tests; `ui-three-sizes.mjs` on the page (9/9 pass, 0 overflow, 0 console errors); `node --check` on the build script.
