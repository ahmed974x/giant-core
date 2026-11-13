# ADR-160: The unified workbench

Date: 2026-11-12 · Status: Proposed. Ahmad's message of 2026-11-12 asked, after ADR-159, for one task to run through the project's engines as one system:
- the prompt meta-codes (ADR-156);
- the universal agent's request, design, security and TDD modes (ADR-159, with the reversal engine of ADR-150);
- the contrast healer (ADR-153);
- the maths typesetter and cinematic presets (ADR-157);
- the FOSS atlas and the privacy shield (ADR-158).

He also asked for a page that runs it with one button, shows each stage, the reversal hash and links between the Math lab, the atlas and the universal agent, with the same answers in Node and Python. His request named the Python file `jarvis/server/unified_workbench.py`. It is in a skill folder instead, by this repository's convention (ADR-154 to ADR-159).

## Decision

1. **The engine** is `jarvis/server/lib/unified-workbench.mjs` (pure, inlined into the page in its own scope over the existing scopes). Its twin is `.claude/skills/replica-unified-workbench/unified_workbench.py` (standard library, importing the reviewed skills). Both run seven stages in a fixed order:
   1. **shield** (ADR-158) replaces keys, e-mail addresses, IBANs, card numbers, phone numbers and IPv4 addresses in the task. Every later stage reads only the cleaned text. A secret check returns its SHA-1 prefix only, and nothing is looked up.
   2. **metacodes** (ADR-156) compiles the cleaned task. Its options are alternatives, so the joined plan follows the first one and its locks.
   3. **request** (ADR-159) builds the model request: effort in `output_config.effort`, refused fields dropped. Nothing is sent.
   4. **design** (ADR-159 design mode: the reversal engine of ADR-150 with the contrast healer of ADR-153) corrects the CSS and returns its SHA-256.
   5. **math** (ADR-154) solves and checks an expression.
   6. **atlas** (ADR-158) plans a stack. Savings come only from typed prices.
   7. **security** (ADR-159) gives each finding a verdict.

   Stages 1 to 3 always run; stages 4 to 7 run when their input is given.
2. **A refusal stays in its stage.** When a stage's engine refuses its input, that stage is marked `error` with the engine's message, and the other stages still run. `verified` is then false.
3. **One plan** joins the run:
   - a tool step for each stage that ran;
   - then every locked step the stages asked for (installs, outbound links, publishing, money), each `{gate: "approval", locked: true, status: "pending_approval"}`.

   `prover.mjs` proves the plan. Nothing is sent and nothing is installed.
4. **The chain hash** starts from 64 zeros. It hashes each stage's id, status and summary in order (SHA-256 over `JSON.stringify` / `js_json`), so the same run gives the same hash in both languages.
5. **Server:** `POST /api/w/:slug/workbench/run`. The event log records `workbench.run` with counts only, never the task.
6. **Page:** `#/workbench` has:
   - the task, the model and the effort;
   - switches for the CSS, the expression, the atlas picks with a typed price, and two sample findings;
   - one Run button;
   - each stage with its status, its summary and a link to its page (`#/atlas`, `#/missions`, `#/universal`, `#/studio`, `#/math`);
   - the locked steps «بانتظار الموافقة», the chain hash and the whole answer as JSON.
7. **What is not joined:**
   - **The SVG typesetter** of ADR-157 has no Python twin, so the maths stage returns the solver's checks, and the formula is drawn on the Math lab page.
   - **The cinematic presets** are not a stage, because a task has no camera input; they stay in `#/hyper`.
   - **The Superpowers TDD rule** is a working rule (CLAUDE.md), not a stage: the workbench cannot run tests.

## Consequences

- One run shows how the engines fit together, and its plan proves that the locks still hold across them.
- `tests/golden.json` holds 37 requests with the server's answers. The Python suite, the server tests and both mutation oracles check it.
- The mutation list in CLAUDE.md adds `unified-workbench.mjs` and `unified_workbench.py`.
