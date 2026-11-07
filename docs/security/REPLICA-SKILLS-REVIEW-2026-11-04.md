# Security review: replica-architect, replica-build, replica-test, replica-diff (ADR-133)

Date: 2026-11-04 · Reviewer: Claude Code, cloud sandbox. Asked by Ahmad on 2026-11-04: «أضف مهارتي replica-architect و replica-build (وأي مهارة لازمة من الحزمة مثل replica-test و replica-diff) في .claude/skills/ مع توثيق مراجعتها الأمنية». This is his standing rule (AGENTS.md §1): no third-party skill without his approval **and** a written security review.

## Source

All four come from [Jakeschincariol/replica-skill](https://github.com/Jakeschincariol/replica-skill) at commit `77c9436`, MIT licence (a copy of the licence is in each folder).

- **Unchanged from upstream:** the tools and templates (`cmp` confirms they are byte-identical).
- **Changed:** each `SKILL.md` gained one section, "In giant-core", that puts AGENTS.md and DESIGN.md above the upstream defaults. That covers payments (locked), paid services, outward actions, file paths and the browser setup.
- **New in this repo:** `replica-diff/tests/test_diff.py`.

## Method

1. Every file was read in full as text in a scratch clone before anything was copied.
2. The upstream tests (`tests/` at the repo root) were **not** run and **not** copied. New tests were written here and import the tools in-process, so no subprocess starts.
3. Python imports, network, processes, dynamic code, file reads and writes, and prompt-injection phrases were checked by hand and with `node scripts/skillspector-audit.mjs --strict` on the four folders.

| File | Status | SHA-256 (first 16) |
|---|---|---|
| replica-architect/SKILL.md | upstream + giant-core section | 58c7c7a60e6d2d05 |
| replica-architect/architecture.md | upstream, unchanged | 3e45dc5523f00448 |
| replica-build/SKILL.md | upstream + giant-core section | f62425258b93404a |
| replica-test/SKILL.md | upstream + giant-core section | 75b0c5e38ead5ab4 |
| replica-test/test-plan.md, bug-report.md | upstream, unchanged | 284ff8b60ebc86c3, 53572b3a7b099146 |
| replica-test/e2e.example.spec.ts | upstream, unchanged (a template, never run) | 20f2c1778027d0c5 |
| replica-diff/SKILL.md | upstream + giant-core section | 75457bc367a67516 |
| replica-diff/parity.py | upstream, unchanged | 208a2bd1d4168da2 |
| replica-diff/imgdiff.py | upstream, unchanged | ee939cddf30c8fb9 |
| replica-diff/tests/test_diff.py | new, written here | 5e3a8ecff5146963 |

## Findings

| Check | parity.py | imgdiff.py |
|---|---|---|
| Imports | `argparse csv json sys` | `argparse json math struct sys zlib` |
| Network | none | none |
| Processes, `eval`, `exec`, `pickle` | none | none |
| Reads | the CSV and `--visual` JSON paths given | the two PNG paths given; refuses non-PNG and interlaced files with exit 2 |
| Writes | stdout only | stdout, plus `--out` (an RGB PNG) when asked |

The `SKILL.md` files:

- contain no permission-bypass flags or hidden instructions;
- tell the agent to use only public sources and the user's own account, and never to scrape, log in to others' accounts, use private APIs, or copy code, assets or copy.

| Remaining file | Finding |
|---|---|
| `replica-test/SKILL.md` | Upstream suggests `npx playwright install` and `npm i -D @playwright/test`. The giant-core section overrides this: the sandbox already has Chromium, and installing packages stays Ahmad's call. |
| `replica-architect/SKILL.md` | Upstream defaults to paid hosted services and Stripe. The giant-core section makes payments a locked «قيد الموافقة» card and puts free and self-hostable parts first. |

**SkillSpector `--strict`** on the four folders reports 0 critical, 0 high, 0 medium and 0 low. **Unit tests** (`replica-diff/tests/test_diff.py`) pass 7 of 7.

## Verdict

**Pass.** Text rules, templates and two offline, standard-library tools that only read the files they are given.

## Not covered

The other upstream skills (recon, backend, brand, entrepreneur, launch, deploy) are not reviewed and not added. `replica-recon`'s method was followed by hand for Jarvis (ADR-132).
