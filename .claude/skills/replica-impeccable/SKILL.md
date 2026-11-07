---
name: replica-impeccable
description: A quality gate against low-effort output - 62 rules over prose (hype and filler words, placeholder text, exclamation marks), design (colour literals outside tokens, transition all, 100vh, text under 12px, off-scale spacing, inline styles and handlers, missing alt or rel), code (TODO, placeholders, stubs, debugger, swallowed exceptions, unused imports) and docs (broken links, empty sections, ADRs without a decision). Standard-library Python only; no network, no processes.
---
<!-- slop-guard: ignore-file (this page names the words the rules flag) -->

# replica-impeccable

Run it on what you are about to call done. It reads files and reports; it changes nothing.

```bash
python3 .claude/skills/replica-impeccable/slop_guard.py jarvis/app/src jarvis/server/lib docs/adr --root .
python3 .claude/skills/replica-impeccable/slop_guard.py --rules
```

Exit 1 means a high finding: a placeholder, a stub, a TODO, `lorem ipsum`, a model talking about itself, an inline style or handler that the CSP blocks, a `javascript:` link, or a plain-http script.

| Group | Rules | Comes from |
| --- | --- | --- |
| Prose (P01–P22) | hype and filler words in English and Arabic, "Oops", exclamation marks, "click here", repeated words | DESIGN.md §6 |
| Design (D01–D18) | colour literals outside token definitions, `transition: all`, `100vh`, text under 12px, spacing off the 4/8 scale, `style=""`, inline handlers, z-index over 1000, purple-blue gradients, shadows over 0.1 alpha, removed focus outlines with no `:focus-visible`, missing `alt`, `type` or `rel`, dead `#` links, three ASCII dots | DESIGN.md §1–§6, AGENTS.md §4 |
| Code (C01–C14) | TODO, placeholder comments, `console.log`, `debugger`, `var`, commented-out code, `new Promise(async`, native dialogs; Python by `ast`: unused imports, bare except, stubs, unreachable code, mutable defaults, broad except with `pass` | AGENTS.md §5 |
| Docs (M01–M08) | heading jumps, duplicate headings, broken relative links, empty sections, paragraphs over 150 words, ADRs without `## Decision`, TBD, unlabelled code fences | AGENTS.md §7 |

Quieting a rule:
- A line with `slop-guard: ignore` is skipped.
- A file with `slop-guard: ignore-file` in its first five lines is skipped. Use this only for files that quote the banned words on purpose, such as this page.

## Surgical rules

These are Karpathy's surgical rules, as CLAUDE.md states them:
- Change only what the task needs.
- Add no layer the task does not need.
- Prove "done" with evidence: the command and its output.
- Keep every security boundary.

## In giant-core

- AGENTS.md and DESIGN.md win over this skill. A finding is a prompt to look, not an automatic fix.
- The Jarvis page shows the build-time report in Governance → Quality gate.
