# ADR-064: Cognitive Modes Layer, Phase 1 (mode registry)

- Status: Accepted (Phase 1 only)
- Date: 2026-10-15

## Context

Ahmad proposed a "Cognitive Modes Layer" for NABD: named ways of thinking
(`/causeeffect`, `/verify`, ...) that agents can work in. The full plan has six
phases (registry, switcher, pgvector history, agent wiring, user commands,
reinforcement). Each phase needs his approval before the next starts.

## Decision

Phase 1 adds a static, read-only registry at `core/cognitive/modes.py`:

- 75 modes in 11 categories: learning, practice, writing, organization,
  reading, math, language, exam (exams & planning), self_improvement,
  research, analysis.
- Each mode has a category, an Arabic and an English description, and one or
  more target agents taken from Ahmad's mapping (Director 00, Butterfly, Truth
  Layer, Phoenix, Auto-Calibration, Meta-Cognition, Red/Blue Team). Modes he
  did not map (writing, reading, exam, language) got our default targets.
- Descriptions are our own wording. Nothing is copied from the third-party
  prompt library in his screenshots, because its license is unknown.
- Standard library only (no new dependencies), so it fits the 7 GB RAM rule.

Duplicates in the source list were merged into one entry each:

| Dropped | Kept as |
|---|---|
| `/oraclexam` (typo) | `/oracleexam` |
| `/selfiest` (typo) | `/selftest` |
| `/verify` under math | `/verify` under analysis |
| `/causeeffect` under analysis | `/causeeffect` under learning |
| `/factcheck`, `/sourcecheck`, `/evidence` under organization | same names under analysis |
| `/weakness` under practice and practice 2 | `/weakness` under self_improvement |
| `/mistakebook`, `/errorpatterns` under practice 2 | same names under self_improvement |

"Practice 2" and "Writing 2" from his list became `self_improvement` and
`research`. `/challenge` and `/challengeboss` stay separate (one step above
level vs. hardest available test).

## Not in this phase

No mode switcher, prompt templates, `mode_history` table, agent wiring, UI or
API. No claims about accuracy gains; those need measurement in later phases.

## Consequences

Later phases import `COGNITIVE_MODES`, `get_mode`, `modes_for_agent` and
`modes_in_category`. Tests in `tests/cognitive/test_modes.py` enforce both
descriptions, at least one known target, and unique names.
