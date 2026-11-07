# Security review: replica-impeccable, replica-graphify and replica-humanizer (ADR-143)

Date: 2026-11-06 · Reviewer: Claude Code, cloud sandbox.

Ahmad asked for three skills, plus governance in CLAUDE.md and the Jarvis page:
- **`replica-impeccable`:** a 62-rule gate against low-quality machine output.
- **`replica-graphify`:** a structural knowledge graph shown as SVG in Jarvis.
- **`replica-humanizer`:** for Arabic and English wording.

All three must be standard-library Python, with no network, no `exec` and no `subprocess`, and SkillSpector at 0 critical / 0 high. They are **new code written in this repo**; nothing was copied or installed. The projects named in his message (Superpowers, gstack, UI UX Pro Max, GSD, Claude-Mem, Career Ops, HyperFrames) were not fetched or run. They appear only in the governance register, as decisions.

## 1. Files

| File | Lines | SHA-256 (first 16) | Role |
|---|---|---|---|
| `.claude/skills/replica-impeccable/SKILL.md` | 40 | acdaedf5863d6159 | Rules table, how to quiet a rule, surgical rules |
| `.claude/skills/replica-impeccable/slop_guard.py` | 361 | acbeee13b48b79a0 | 62 rules: 22 prose, 18 design, 14 code (6 by ast), 8 docs |
| `.claude/skills/replica-impeccable/tests/test_impeccable.py` | 90 | e79ee356f007a681 | 8 unit tests |
| `.claude/skills/replica-graphify/SKILL.md` | 33 | cdea1bc2f9c7dc7f | What is read, the edges, the unlinked list |
| `.claude/skills/replica-graphify/graphify.py` | 277 | 1ccc7e2baafccde4 | Screens, routes, modules, tables, skills and tools from the code; JSON with SHA-256 per file |
| `.claude/skills/replica-graphify/tests/test_graphify.py` | 73 | a0f262de8f867294 | 3 unit tests on a fake repository |
| `.claude/skills/replica-humanizer/SKILL.md` | 22 | 7535e911e9b6bab1 | Use, limits |
| `.claude/skills/replica-humanizer/humanize.py` | 153 | f2ae9a6e2a4fffb0 | About 40 fixed English and Arabic rewrites; report or a rewritten copy |
| `.claude/skills/replica-humanizer/tests/test_humanizer.py` | 51 | 5acc46439c5cdfc8 | 4 unit tests |

## 2. What the code can and cannot do

**Imports.** Standard library only: `argparse`, `ast`, `hashlib`, `json`, `os`, `re`, `sys`; the tests add `contextlib`, `io`, `tempfile`, `unittest`. There is no `subprocess`, `socket`, `urllib`, `http`, `ctypes`, `pickle`, `eval`, `exec` or `importlib`.

**Nothing executed.**
- Python is read with `ast.parse` and never imported. JavaScript, CSS, HTML, SQL and Markdown are read as text.
- `graphify.py` reads a fixed list of files (the app, shell, server, SQLite schema, the server modules the server imports, and each skill's SKILL.md and `.py`).

**Paths.** Every input path must stay inside `--root` after `realpath`; a test proves `../` is refused in all three tools.

**Writes.**
- `graphify.py --out` and `humanize.py --out` write one file inside `--root`.
- `humanize.py` refuses to overwrite the file it reads.
- `slop_guard.py` writes nothing.

**Self-flagging.** Two cases are handled:
- The rule lists in `slop_guard.py` sit between SkillSpector's rule markers.
- The files that quote banned words carry `slop-guard: ignore-file` (`slop_guard.py`, `humanize.py` and two SKILL.md pages), so the gate does not report its own vocabulary.

## 3. Checks

| Check | Result |
|---|---|
| `node scripts/skillspector-audit.mjs --strict` on the three skills | 0 critical, 0 high, 0 medium, 0 low |
| `ruff check` on the three skills | all checks passed |
| unit tests | 8, 3 and 4, all OK |
| `slop_guard.py` on `jarvis/app/src`, `jarvis/server/lib`, `jarvis/README.md`, `docs/adr` and six replica skills (the report shipped in the page) | 62 rules, 0 high |

Building the gate on this repository changed three rules, because their first findings were wrong:
- **D11** (focus outline removed) now applies only when the file has no `:focus-visible` style. Every hit in `app.css` had one.
- **D01** (colour literal) skips custom-property definitions. The Studio preview defines its tokens as `--x: #hex`.
- **C14** (swallowed exception) applies only to a bare or `Exception` handler. A narrow `except SyntaxError: pass` fallback is fine.

Prose rules also skip inline code and title-case product names. The ADR-093 hit was "Blue Marble Next Generation", NASA's product, and ADR-135's was the quoted ruff output "All checks passed!".

## 4. Limits, said plainly

- The rules are patterns and `ast` checks. They catch the common shapes, not every one: a filler sentence in new words passes. The remaining medium findings in the report are the quoted ruff output in the reviewed `replica-long-horizon` skill, left unchanged so its review hashes stay valid.
- `graphify.py` reads Jarvis's own code conventions. A route written another way is missing from the map until the parser learns it. The map is labelled [INFERENCE], and the unlinked list shows what it could not tie.
- `humanize.py` uses a fixed table. It does not understand meaning, so a person reads the rewritten copy before using it.

## 5. Decision

Added as project skills. They are safe to run on Ahmad's machine as written. A later change needs a new entry here.
