# ADR-145: Formal checks, the Studio 5-in-1 exporter and the Ctrl+K macro composer

Date: 2026-11-06 · Status: Proposed. Ahmad's message of 2026-11-06 asked for:
- a `replica-formal-verify` skill: a state-space prover (deadlocks, UI state completeness, and the safety rule that no money, publish, permission, install or outbound path skips an approval lock) and a mutation audit;
- a Studio exporter that writes five files from one site;
- a Ctrl+K macro composer that shows "Formal Proof: Verified", where sensitive steps stop at the violet card.

## Decision

1. **`.claude/skills/replica-formal-verify/`**, standard-library Python, no network, no processes:
   - `state_prover.py` turns a plan into a state machine (start, one state per step, an effect state after each sensitive approval, `done` and `stopped`) or reads a machine as JSON. A breadth-first search proves three things:
     - no reachable state is stuck;
     - every step is reached;
     - with the locked approval states removed, no effect is reachable. A violation prints the path that reaches it.

     `--ui` checks that each component's CSS gives it default, hover, focus-visible, loading, empty, error and locked states.
   - `mutation_audit.py` lists mutants (comparisons, arithmetic, `and`/`or`, conditions, constants, returns) with `ast` and estimates test strength statically [INFERENCE]: a test calls the function, or a function that calls it, and asserts. It runs nothing. `--out` writes each mutant as a copy for a person to run the real tests on.
2. **`jarvis/server/lib/prover.mjs`** is the same algorithm in JavaScript. It runs in the page and on the server.
3. **Ctrl+K → Compose a macro:**
   - the fixed rules (no model) turn the text into steps, and the prover checks them as you type;
   - the badge reads "Formal Proof: Verified" or "Formal Proof: Failed", with states, transitions, deadlocks and effects behind a lock;
   - each sensitive step shows «قيد الموافقة» and the macro stops there until Director 00 approves.

   **Run macro** posts only the text to `POST /api/w/:slug/missions/macro`. The server makes the steps and proves them again. A macro that fails is refused (422) and nothing is made. A verified one becomes a mission that stores its proof, so the database lock `mission_steps_locked_never_done` still applies.
4. **Studio → Export 5 files** (`jarvis/server/lib/exporter.mjs`, written in the browser, nothing sent or run):
   - the HTML page with its strict CSP (as before);
   - a zero-dependency Web Component (`.mjs`, Shadow DOM, `textContent` only, `lang="ar"` switches to right to left);
   - W3C design tokens (`.tokens.json`) with six contrast checks (WCAG 4.5 and APCA 60);
   - a PostgreSQL schema inferred from the sections [INFERENCE]. Its payments, publishing and permissions tables start at `pending_approval`, and a check refuses `approved` without a person and a time;
   - a Playwright test at 390 × 844, 1440 × 900 and 2560 × 1080, light and dark.

Review: `docs/security/JARVIS-FORMAL-VERIFY-EXPORTER-MACRO-REVIEW-2026-11-06.md`.

## Consequences

- A macro cannot carry a sensitive step past a lock. The page proves it, the server proves it again, and the database refuses to finish such a step.
- The proof covers the plan's structure, not what a tool does inside a step.
- The exported schema and component are starting points, labelled as inferred; a person reviews them before use.
- The UI-state report on Jarvis's own CSS lists missing hover and loading states on fields. It is a report, not a gate: not every component needs every state.

## Checks

The results are in the PR body. They cover:
- **SkillSpector** on the whole repository;
- **Unit tests and ruff** on `replica-formal-verify`;
- **Server tests** on SQLite and PostgreSQL 16, including the exported SQL run on PostgreSQL;
- **Flow tests:** F26 and F27 in `test-app.mjs`, and the macro and the export in `test-live.mjs`;
- **Contrast**;
- **Three sizes** for `#/studio` and `#/overview`, in English and Arabic;
- **Retina screenshots;**
- **Parity:** 100.0.
