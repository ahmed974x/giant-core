# ADR-143: Governance - surgical rules, the 62-rule quality gate, the knowledge map, plain wording and the open-weight catalog

Date: 2026-11-06 · Status: Proposed. Ahmad's messages of 2026-11-06 asked for a curated engineering governance layer:
- Karpathy's surgical rules in CLAUDE.md;
- a 62-rule quality gate (`replica-impeccable`);
- a structural knowledge graph drawn as SVG in Jarvis (`replica-graphify`);
- a plain-wording checker (`replica-humanizer`);
- a written register of which outside patterns are adopted, excluded or kept out of the repository;
- a wider catalog of open-weight models for the local engines.

## Decision

1. **CLAUDE.md** gains "Surgical rules (ADR-143)": surgical changes, no extra layers, evidence before done, and boundaries hold. It also records the register:
   - **adopted as text rules:** Superpowers, gstack, UI UX Pro Max;
   - **excluded:** GSD (Redux), Claude-Mem, Career Ops;
   - **kept outside the public repository:** HyperFrames.

   Nothing is installed.
2. **`replica-impeccable/slop_guard.py`** has 62 rules: 22 prose, 18 design, 14 code (6 by `ast`) and 8 docs. They come from DESIGN.md and AGENTS.md §5, plus common filler. Exit 1 on a high finding. Its first run here sharpened three rules (D01, D11, C14) against false positives.
3. **`replica-graphify/graphify.py`** maps screens, API routes, server modules, SQL tables (with their constraints) and skills (with their tools' functions), joined by what calls what. Every file carries its SHA-256, and an `unlinked` list shows routes and tables the page never reaches. There is no vector database.
4. **`replica-humanizer/humanize.py`** has about 40 fixed Arabic and English rewrites. It reports, or writes a copy; it never overwrites the original.
5. **Jarvis `#/governance`:**
   - the rules;
   - the register;
   - the knowledge map as interactive SVG (four columns; picking a node lights its links and lists its routes, constraints or tool functions);
   - the quality gate's build-time report.

   Everything is in Arabic too.
6. **`jarvis/server/lib/model-catalog.mjs`** holds 12 open-weight families, each with its licence, job and origin. Settings → Local model shows the catalog and marks the families served here.
   - **China:** DeepSeek-R1, DeepSeek-V3, QwQ, Qwen3-Coder, Qwen2.5-Coder, GLM-4.
   - **US / EU:** Llama 4 Scout, Llama 3.3, Gemma 3, OLMo 2, Phi-4-reasoning, Codestral.

   Llama, Gemma and Codestral licences are stated as not OSI open source, and Codestral's forbids production use.

Review: `docs/security/GOVERNANCE-SKILLS-REVIEW-2026-11-06.md`.

## Consequences

- The working rules are written down where every session reads them, and the page shows the evidence.
- The map and the report are build-time snapshots. Rerun the two tools and rebuild after code changes (CLAUDE.md says how). A stale snapshot is visible from its SHA-256.

## Checks

The results are in the PR body. They cover:
- **SkillSpector** on the whole repository;
- **Unit tests and ruff** on the three skills;
- **Server tests** on SQLite and PostgreSQL 16;
- **Flow tests:** `test-app.mjs` F21 and `test-live.mjs`;
- **Contrast**;
- **Three sizes** for `#/governance` and `#/settings`, in English and Arabic;
- **Retina screenshots;**
- **Parity:** 100.0.
