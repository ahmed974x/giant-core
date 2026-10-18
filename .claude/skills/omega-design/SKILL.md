---
name: omega-design
description: Use when building, redesigning or reviewing any OMEGA / NABD web surface (site-landing, Ops Room, THE CHAIN). Applies DESIGN.md, the Vercel Web Interface Guidelines and the three-size browser loop.
---

# OMEGA design

Read `DESIGN.md` at the repo root first. It wins over every rule below when they differ.

## 1. Before writing UI

1. List what only this product has (real feeds, the globe, the chain, the gates). Build from that, not from a generic landing page.
2. Reuse the tokens in `site-landing/style.css`. New colours go through `audits/verify-contrast.mjs`.
3. Count the deliverables in the request (files, panels, tabs, sections). Lock that number.

## 2. While writing (distilled from taste-skill, high-end-visual-design, redesign-existing-projects)

- One accent, one grey family, tinted shadows. No pure black, no purple-blue gradient, no three identical feature columns as the only layout idea.
- Hierarchy through size, weight (400 / 500 / 600 / 700) and space, not through more boxes. Double the whitespace on marketing pages; keep dashboards dense.
- Radii are concentric (outer = inner + padding); inner elements are tighter than containers.
- Every interactive element has hover, active (`scale(0.96–0.98)`), focus-visible and disabled states. Loading uses skeletons or "…", empty states say what to do next, errors say what failed and how to fix it.
- Motion: custom easing (`--ease-apple-fluid`, spring), `transform`/`opacity` only, nothing on scroll listeners (use IntersectionObserver), blur only on fixed chrome.
- Copy: active voice, specific button labels ("صدّر CSV", not "متابعة"), sentence case, no AI clichés, no exclamation marks.
- Data honesty beats "realistic-looking" numbers: never invent figures to make a mock look alive. Use real feeds, or label the example as an example (DESIGN.md §6).

## 3. Full output (from full-output-enforcement)

- No `// ...`, `// TODO`, "rest of code", skeletons standing in for implementations, or "similarly for the others".
- Before finishing, re-read the request and compare the deliverable count. Add anything missing.
- If a response must stop, stop at a clean boundary and say exactly what remains.

## 4. From an image or reference (from image-to-code)

1. Describe the reference in words first: grid, type scale, colour roles, radii, density.
2. Map each to an existing token; add a token only when nothing fits.
3. Build, screenshot, compare side by side, fix the three biggest differences, repeat up to three rounds.

## 5. Review gate (Vercel Web Interface Guidelines)

Run `references/web-interface-guidelines.md` against every changed UI file and write findings as `file:line - issue`. Always check: icon buttons have `aria-label`; inputs have label, `name`, `autocomplete`, correct `type`/`inputmode`; no `transition: all`; no `outline: none` without a focus-visible replacement; `…` not `...`; `Intl.*` for dates and numbers; `<img>` has width and height; `color-scheme` and `theme-color` match the theme; skip link and `scroll-margin`/`scroll-padding`; no zoom blocking.

## 6. Browser loop (three sizes)

```
node scripts/ui-three-sizes.mjs http://127.0.0.1:8811/index.html
```

Mobile 390×844 @3x, Laptop 1440×900, Ultra-wide 2560×1080, light and dark. It fails on console errors, page errors or horizontal overflow and saves screenshots. Look at the screenshots yourself and fix the top three problems before calling the work done. In the cloud container use `playwright-core@1.56.1` with `/opt/pw-browsers`.

## 7. Done means

Contrast gate passes, `node --check` passes on every inline script, the three-size loop is clean, the Vercel review has no open finding, and nothing in the files is a placeholder.

## Sources read (text rules only, no scripts installed)

| Source | Commit | Licence | Taken |
|---|---|---|---|
| [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) (taste-skill, soft-skill, redesign-skill, output-skill, image-to-code-skill) | `f624f37` | MIT | §2 to §4 |
| [vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) `command.md` | `434b7f9` | MIT | §5, copied in `references/` |
| [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) | `aeac41d` | MIT | "verification is non-negotiable", progressive disclosure |
| [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) | `3b60532` | see repo | the DESIGN.md format at the repo root |

Not adopted: `thedotmack/claude-mem` and `vercel-labs/skills` find-skills were rejected in the 2026-10-15 security review (prompts sent to an outside model and telemetry; `-g -y` auto-install). They stay out unless Ahmad approves them after a fresh review. Not read in this pass and not installed: `firecrawl/anydoc`, `VoltAgent/awesome-claude-design`, and `claude-code-setup` from `anthropics/claude-plugins-official` (first-party; it only suggests setup, so it can be run by hand when wanted).
