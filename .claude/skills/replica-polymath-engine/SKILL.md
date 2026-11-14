---
name: replica-polymath-engine
description: One question across the repository's own deterministic engines in five stages - the privacy shield cleans it and fixed word rules plus the person's choice name the domains (maths, time series, optics, design, security), each domain runs its reviewed engine when its input is given; every named domain lists how it fails and which gate here closes it (inversion); a weighted decision matrix uses only the person's options, scores and weights; every claim must name a domain that ran, and with no domain run the answer abstains instead of guessing; an RFC 6962 Merkle root binds the records. Standard-library Python only; no network, no processes, no model.
---

# replica-polymath-engine

```bash
python3 .claude/skills/replica-polymath-engine/polymath_engine.py '{"question":"Solve the equation","math":{"task":"calculus","expression":"x^2-2","interval":[0,3]}}'
python3 .claude/skills/replica-polymath-engine/polymath_engine.py - < request.json
python3 -m unittest discover -s .claude/skills/replica-polymath-engine/tests
```

| Stage | What it does | How it stays honest |
| --- | --- | --- |
| 1 decompose | the privacy shield cleans the question; a domain is named by the person (`domains`), by fixed words [INFERENCE] or by its input; it runs `solve` (ADR-154), `analyse` (ADR-147), `optics` (ADR-155), the design pass (ADR-150, ADR-153) or the security verdicts and atlas (ADR-158, ADR-159) | a named domain without its input says `needs_input`; an engine's refusal is that domain's `error` |
| 2 inversion | for each named domain, the fixed ways it fails and the gate in this repository that closes each | text rules, not measurements |
| 3 decision | options scored 0 to 10 on the person's criteria, weights made to sum to 1, ranked; a tie chooses nothing | no options or weights means no matrix; no number is invented |
| 4 grounding | each claim names the domain that backs it; one whose domain did not run is not grounded and is listed in `unknown_citations` | with no domain run, `abstained: true` (the rule VeritasGraph states, taken as text) |
| 5 merkle | RFC 6962 root over the records of every stage (leaf `0x00`, node `0x01`) | the same root in Node and Python |

The same engine runs in Jarvis (`jarvis/server/lib/polymath-engine.mjs`, `POST /api/w/:slug/polymath/run`, the `#/polymath` page). `tests/golden.json` holds the server's answers and both test suites check it.

## Limits

- The domain words are a fixed list. A question that names a domain in other words needs `domains` set by the person.
- The engine answers only what its engines compute. It does not know markets, news or anything outside its inputs, and it says so by abstaining.
- VeritasGraph, Semantica, the Munger inversion and K-Dense's skills are not installed. Only their stated rules were written here (`docs/security/POLYMATH-SOURCES-REVIEW-2026-11-13.md`).
