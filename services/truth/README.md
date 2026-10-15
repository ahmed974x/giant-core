# Truth Layer: credibility scores for GDELT news (ADR-021)

Every GDELT news item gets a `truth_score` (0.0 to 1.0) and a list of `flags` before Director 00 may use it.
Items below **0.7** are `unverified`: stored and visible, but never used as evidence for a decision.

```
truth_score = 0.45 × source reputation + 0.30 × corroboration + 0.25 × language neutrality − penalties
```

| Part | How it is measured | Flags it can raise |
| --- | --- | --- |
| Source reputation | curated tiers in `sources.json`: wire 0.92, record 0.85, public broadcaster 0.80, specialist 0.80, official 0.78 (plus any `.gov`/`.int` domain), unknown 0.55, state-controlled 0.40, satire 0.05 | `source:unknown`, `source:state_controlled`, `source:satire` |
| Corroboration | GDELT events: `NumSources`. GKG articles: other-domain articles in the same batch sharing at least two specific entities (place, organisation, person). 1 source → 0, 4+ → 1 | `single_source` |
| Neutrality | GDELT tone and polarity (emotive coverage scores lower) | `emotive_language` |
| Penalties | loaded-language patterns in headline or URL (−0.15), opinion/editorial/column pages (−0.10), unknown outlet that nobody else confirms (−0.05) | `propaganda_pattern`, `opinion` |

**Where it applies**
- `services/director00/entities.py ingest` scores each GKG batch and writes `truth_scores`; entity `search` / `who`
  return verified items only unless `--all` is given (each row carries its score, status and flags).
- The Butterfly Engine counts a nearby GDELT conflict report as live evidence only if it is verified; ignored reports
  are mentioned in the link's note ("2 unverified report(s) ignored").

**Honest limits.** The reputation list is a reviewed opinion about editorial process, not about politics, and it is
short: most local outlets fall into "unknown". The 0.7 bar is deliberately strict: a single report, even from a wire
service, stays unverified until someone else carries it. In the first live batch (2026-10-10) 100 of 914 GKG articles
passed. No text is fetched from the articles, so the propaganda check sees only headlines and URLs.

```bash
../director00/.venv/Scripts/python.exe -m pytest -q        # 10 tests
```
