# ADR-161: The polymath engine

Date: 2026-11-13 · Status: Proposed.

Ahmad's message of 2026-11-13 asked for `#/polymath`, which puts one question to all of the repository's engines through five stages:
1. cross-domain decomposition after the privacy shield (ADR-158);
2. Munger inversion;
3. a weighted decision matrix from the person's own weights;
4. provenance with explicit abstention, following VeritasGraph;
5. an RFC 6962 Merkle root with a 64-character hash that wraps at 375 px.

He also asked for:
- the same answers in Node and Python;
- a read-only review of VeritasGraph, Semantica, the Munger / WDM method and K-Dense's skills;
- the stale parity line in `jarvis/README.md` fixed.

He named the Python file `.claude/skills/replica-polymath-engine/`, by this repository's convention.

## Decision

1. **The review** is `docs/security/POLYMATH-SOURCES-REVIEW-2026-11-13.md`.
   - **What was read:** three MIT projects, one list without a licence file, and K-Dense, which ADR-159 already reviewed. Nothing was installed, and SkillSpector found 0 / 0 / 0 / 0 in the downloaded text.
   - **What was taken:** only the stated rules — `grounded`, `unknown_citations` and `abstained`; decisions as records with their source; WDM with Munger inversion.
2. **The engine** is `jarvis/server/lib/polymath-engine.mjs` (pure, inlined into the page in its own scope over the existing scopes). Its twin is `.claude/skills/replica-polymath-engine/polymath_engine.py` (standard library, over the reviewed skills). Both run five stages:
   1. **Decompose.**
      - **Cleaning:** the privacy shield cleans the question.
      - **Naming a domain:** each of the five domains (maths, time series, optics, design, security) is named in one of three ways: the person picks it in `domains`; one of its fixed words is in the question [INFERENCE]; or its input is given.
      - **Running:** a named domain runs its engine when its input is there:
        - maths: `solve` (ADR-154);
        - time series: `analyse` (ADR-147), 2 to 5,000 points;
        - optics: `optics` (ADR-155);
        - design: the reversal engine with the contrast healer (ADR-150, ADR-153);
        - security: the verdicts and the FOSS atlas (ADR-158, ADR-159).
      - **Missing input or refusal:** with no input the domain says `needs_input`; an engine's refusal is that domain's `error`.

      Every domain carries its `source`: the ADR, the engine and its page.
   2. **Inversion:** for each named domain, the fixed ways it fails and the gate in this repository that closes each. These are text rules, not measurements.
   3. **Decision:** the person's options (2 to 12) are scored 0 to 10 on the person's criteria (1 to 12). The weights are made to sum to 1, and the options are ranked. A tie chooses nothing. With no options and no weights there is no matrix, and no number is invented.
   4. **Grounding:**
      - each claim names the domain behind it;
      - a claim whose domain did not run is not grounded and is listed in `unknown_citations`;
      - with no domain run, `abstained: true`, with the reason.
   5. **Merkle:** an RFC 6962 root (ADR-147's `leafHash` and `merkleRoot`) over the records of every stage. It is the same in both languages. In the page it wraps inside its panel at 375 px.
3. **Server:** `POST /api/w/:slug/polymath/run`. The event log records `polymath.run` with the number of domains run and the grounding verdict, never the question.
4. **Page:** `#/polymath` holds the question; the domains to always include; an expression; a series; the CSS; the lens values; a two-option matrix with weights; and claims written as `domain: claim`. The answer shows:
   - the grounding badge and reason;
   - each domain with its status, why it was named and a link to its page;
   - the inversion list;
   - the ranked options;
   - the claims, backed or not;
   - the Merkle root and the whole answer as JSON.
5. **Records:** `jarvis/README.md` said «27 must-haves … parity is 88.5». It now says 34 of 34 and parity 100.0, and links ADR-161.

## Consequences

- The engine answers only what its engines compute. A question about markets, news or anything outside its inputs abstains. It does not guess.
- `tests/golden.json` holds 72 requests with the server's answers. The Python suite, the server tests and both mutation oracles check it.
- The mutation list in CLAUDE.md adds `polymath-engine.mjs` and `polymath_engine.py`.
