---
name: replica-humanizer
description: Plain-word suggestions for Arabic and English text - finds stiff, machine-sounding wording (in order to, utilize, leverage, it is important to note, في عالمنا اليوم, تجدر الإشارة إلى أن, قم بـ) and suggests a shorter word from a fixed table; can write a rewritten copy, never the original. Standard-library Python only; no network, no processes.
---
<!-- slop-guard: ignore-file (this page quotes the wordings it replaces) -->

# replica-humanizer

```bash
python3 .claude/skills/replica-humanizer/humanize.py docs/adr/ADR-143-*.md --root .
python3 .claude/skills/replica-humanizer/humanize.py jarvis/README.md --out work/README.plain.md --root .
```

- **Fixed table, no model.** About 40 entries, so the same text always gets the same advice.
- **Code is left alone.** Fenced and indented code is skipped.
- **Arabic letter-spacing stays 0.** The tool only changes words.
- **Copies only.** `--out` writes a rewritten copy inside `--root`, and refuses to overwrite the file it reads.

## In giant-core

- DESIGN.md §6 wins: plain, active copy, with no hype words, no exclamation marks and no "Oops".
- Copy in the Jarvis page lives in `jarvis/app/src/app.js` and `i18n-ar.json`. Run this on a draft, then make the change by hand.
