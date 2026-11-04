# Security review: replica-design skill (ADR-132)

Date: 2026-11-04 · Reviewer: Claude Code, cloud sandbox · Asked by Ahmad on 2026-11-04 («رفع المهارة على مستودع ahmed974x/giant-core داخل المسار .claude/skills/replica-design/ على فرع جديد»), under his standing rule (AGENTS.md §1): no third-party skill without his approval **and** a written security review.

## What was added

`.claude/skills/replica-design/`: one `SKILL.md` (text rules), three Python tools, two templates, one test file, MIT licence.

It is a rewrite of `replica-design` from [Jakeschincariol/replica-skill](https://github.com/Jakeschincariol/replica-skill) at commit `77c9436` (MIT). Only the method and the rules were taken from it. Of the upstream code, only the WCAG maths in `contrast.py` (the published WCAG 2 formula) has the same shape; it was retyped and extended, not copied as a file. `sample.py` and `build_tokens.py` are new.

## Method

1. The upstream repository was cloned into an empty scratch folder and **read, not run**. The sandbox's permission check refused to run its tests or tools, and that refusal was kept.
2. Every file in the new skill was written in this session and read in full before it was committed.
3. Imports, process starts, network calls, dynamic code, file writes and prompt-injection phrases were checked by hand and with `node scripts/skillspector-audit.mjs --strict .claude/skills/replica-design`.
4. The tools were then run here on test fixtures only: `python3 -m unittest discover -s tests` (13 tests at ADR-132, 17 at ADR-133), plus a real Chromium screenshot for `sample.py`.

| File | SHA-256 (first 16) |
|---|---|
| SKILL.md | 689fe7858d7f22a7 |
| contrast.py | bceca18abdc26be7 (ADR-133) |
| build_tokens.py | 9a8eca49f1380edf (ADR-133) |
| sample.py | 2f4bc40dbee5c734 |
| templates/tokens.json | fee17fed117f66c4 |
| templates/components.md | c87d195b312afbfe |
| tests/test_tools.py | 52c75bf81d1823c4 (ADR-133) |
| upstream replica-design/SKILL.md @77c9436 (read only) | 34f0375bef33a713 |
| upstream replica-design/contrast.py @77c9436 (read only) | 2c4b57890fddb799 |

## Findings

| Check | Result |
|---|---|
| Imports | Standard library only: `argparse json math os re struct sys zlib` (tests add `contextlib io tempfile unittest`). No third-party package, nothing to install. |
| Network | None. No `socket`, `urllib`, `http`, `requests`. |
| Processes | None. The first test draft used `subprocess.run` to call the CLI; SkillSpector flagged it (SEC-EXEC, high) and it was replaced by calling `main()` directly. |
| Dynamic code | None: no `eval`, `exec`, `compile`, `pickle`, `__import__`. |
| File reads | Only the paths given on the command line (a tokens JSON, PNG files). `sample.py` parses PNG with `zlib` and `struct` and rejects interlaced or unsupported files with exit 2. |
| File writes | Only `build_tokens.py`: `tokens.css` and `tailwind.tokens.js`, next to the tokens file or in `--out`. |
| Secrets | None read or written. |
| SKILL.md | No permission-bypass flags, no hidden instructions, no prompt-injection phrases (SkillSpector rule set). It tells the agent to refuse copying another product's logos, icons, fonts, copy or brand colour, and to obey the project's own design rules (`DESIGN.md`) over its defaults. |
| SkillSpector `--strict` | 0 critical, 0 high, 0 medium, 0 low on the skill folder. |
| Ruff | `.claude` is excluded in `ruff.toml`; the tools use `%` formatting for Python 3.8 support. |

## Verdict

**Pass.** Text rules plus three offline, standard-library tools that only read the files they are given and write two generated files. Safe to run on Ahmad's laptop.

## Conditions

- Running the **other ten** upstream Replica skills (recon, build, backend, deploy and the rest) is not covered by this review. Their scripts were not reviewed and are not in the repo.
- A future update of this skill gets a new review if it adds an import outside the standard library, a network call or a process start.

## Update, ADR-133 (same day)

Re-read after these changes:

- `contrast.py` accepts `#rrggbbaa` and composites a translucent background over a named backdrop token.
- `build_tokens.py` writes `oklch(… / a)` for alpha colours. It also adds a `prefers-reduced-transparency` block, `:lang(xx)` type scales from `type-xx` keys, and reduced-motion for every duration.

Both still import only the standard library (`build_tokens.py` adds nothing new). They make no network calls, start no processes, and write the same two files as before. SkillSpector `--strict` on the folder reports 0 findings. **Verdict unchanged: pass.**

