# Security review: replica-hybrid-python skill (ADR-138)

Date: 2026-11-05 · Reviewer: Claude Code, cloud sandbox.

Ahmad asked for "hybrid" Python design engines:
- topology fingerprints and golden-ratio templates;
- graphlib scheduling;
- a pattern memory;
- a manifest inventory;
- a curriculum of 50,000+ layouts and 50,000+ Arabic/English questions.

All of it in the Python standard library, with no network, and SkillSpector at 0 critical / 0 high. The skill is **new code written in this repo**. Nothing was copied or installed.

## 1. Files

| File | Lines | SHA-256 (first 16) | Role |
|---|---|---|---|
| `.claude/skills/replica-hybrid-python/SKILL.md` | 41 | f8df2de28dd0e671 | Rules, commands, the maths in one line each, the giant-core section |
| `hcommon.py` | 59 | 835e58d43b9b3cbd | Golden ratio, the 4/8 scale, lock words, path containment, read and write |
| `topology_synth.py` | 286 | 6dbbbe7468df4234 | `html.parser` tree, Weisfeiler-Lehman histogram, cosine, archetype, type scale, clean template with a pinned CSP |
| `dag_scheduler.py` | 108 | c2ac159d6061f4d1 | `graphlib` batches, cycles named, critical path, locked steps and their dependants held |
| `pattern_memory.py` | 124 | d3ace6df02906aff | Markov chain of section sequences weighted by gates passed |
| `static_intel.py` | 120 | 37b3d58e52e792cb | Manifest inventory (RFC 8615 placement, RFC 9116 facts) and entropy audit of string literals |
| `curriculum_50k.py` | 254 | ecb499305d5cd247 | Seeded layouts and Q&A decoded from their index; `count`, `sample`, `export` |
| `tests/test_hybrid.py` | 144 | fffe82ce55634735 | 6 unit tests |

## 2. What the code can and cannot do

**Imports.** Standard library only: `argparse`, `ast`, `base64`, `collections`, `graphlib`, `hashlib`, `html.parser`, `itertools`, `json`, `math`, `os`, `random`, `re`, `sys`; the tests add `contextlib`, `io`, `tempfile`, `unittest`. No `subprocess`, `socket`, `urllib`, `http`, `ctypes`, `pickle`, `eval`, `exec` or `importlib`.

**Nothing executed.**
- HTML is parsed with `html.parser`: text is dropped and only tag shape is kept.
- Python is read with `ast`.
- The template writer emits fixed markup. Its one inline style is pinned in the template's own CSP by SHA-256, with `default-src 'none'` and no script.

**Locks.** `dag_scheduler` marks any step whose title names money, publishing, permissions, installs or outbound messages as locked, using `hcommon.LOCK_WORDS`. That step and everything after it wait. The model or the plan file cannot unlock it.

**Randomness.** `curriculum_50k` seeds `random.Random` from each item's index, so item *k* is the same on every machine. This is for reproducible data and never for security. The three `noqa: S311` comments say so on their lines. Every answer is computed: WCAG contrast from the sRGB formula, lock decisions from the lock words, and spacing from the 4/8 scale. No answer comes from a model.

**Writes.** Only `--out` paths inside `--root`, checked with `realpath`.

## 3. Checks

| Check | Result |
|---|---|
| `node scripts/skillspector-audit.mjs --strict .claude/skills/replica-hybrid-python` | 0 critical, 0 high, 0 medium, 0 low |
| `ruff check .claude/skills/replica-hybrid-python` | all checks passed |
| `python3 -m unittest discover -s tests` | 6 tests OK |
| `curriculum_50k.py count` | 258,048 layouts, 54,250 Q&A pairs |

## 4. Limits, said plainly

- An archetype and a pattern-memory suggestion are fixed rules over counts and carry `[INFERENCE]`. They are not a judgement of quality.
- The curriculum is synthetic. It teaches the repo's own rules (contrast, locks, spacing, layout names), not general knowledge. Jarvis does not train a model. Fine-tuning with these files on Ahmad's machine is his choice and outside this skill.

## 5. Decision

Added as a project skill under `.claude/skills/replica-hybrid-python`. It is safe to run on Ahmad's machine as written. A later change needs a new entry in this review.
