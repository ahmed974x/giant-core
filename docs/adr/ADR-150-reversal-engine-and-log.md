# ADR-150: The reversal engine and the Autonomous Reversal Log

Date: 2026-11-07 · Status: Proposed. Ahmad's message of 2026-11-06 asked for:
- a reversal engine as a skill and on the server (no exec, no spawn);
- a plan with sensitive steps left unlocked turned into `{gate: "approval", locked: true, status: "pending_approval"}`, with a SHA-256 proof and a correction vector;
- a template with its blue to purple gradients removed, a `prefers-reduced-transparency` fallback and `overflow-wrap: anywhere`;
- every correction written to the Merkle audit log and the BM25 memory;
- an "Autonomous Reversal Log" panel in the Studio and in `#/diagnostics`.

The first copy of the message also asked for passive recon of a site (RDAP, certificate transparency, security headers, security.txt). The later copies left it out, so it is not built here.

## Decision

1. **`jarvis/server/lib/reversal.mjs`** (pure; inlined into the page). It reads, corrects and hashes; it runs and sends nothing.

   | Function | What it corrects |
   | --- | --- |
   | `reversePlan(steps)` | Runs the steps through `enforceApprovalGates` (ADR-136), so a step that names money, publishing, permissions, installs or outbound messages, in English or Arabic, is a locked approval whatever it claimed. Each such step that was not already `{gate: "approval", locked: true, status: "pending_approval"}` is a correction, with what it was. The corrected plan is proved by `prover.mjs` (ADR-145) |
   | `reverseTemplate(text)` | A declaration with a gradient becomes its first colour stop (`background` → `background-color`, other properties → `none`); a blue to purple one is marked `ai-gradient`, the look DESIGN.md forbids. Glass (`backdrop-filter`) without a fallback gets `@media (prefers-reduced-transparency: reduce)` with a solid `Canvas` background. Text gets `overflow-wrap: anywhere`. HTML gets the CSS in its last `<style>`, or a new one in `<head>` |

   **Every result has:**
   - `corrections`, one entry per change;
   - the correction vector: a count per rule, in a fixed order (`lock-sensitive-step`, `ai-gradient`, `gradient`, `reduced-transparency`, `overflow-wrap`);
   - `before`, `after` and `proofHash`, which are SHA-256 of the input, of the output, and of before + after + the corrections.

   Running the engine on its own output finds nothing more to correct; the tests check this fixed point.
2. **The log on the server** (`reversal-log.mjs`).
   - **Table:** `reversal_log`, append-only in SQLite and PostgreSQL. Each row holds the three hashes, the corrections, the vector and whether the plan proof held.
   - **Audit:** each row's event (`reversal.plan` or `reversal.template`) is a leaf of the workspace's Merkle tree (ADR-147; `AUDITED` gains `reversal.`).
   - **Memory:** each row adds a `lesson` episode to the BM25 memory (ADR-138), so the local model sees the correction next time, as data and not as an instruction.
   - **What is logged:** only output with something to correct.
   - **Routes:**
     - `POST /api/w/:slug/reversal/plan`;
     - `POST /api/w/:slug/reversal/template` (200,000 characters at most);
     - `GET /api/w/:slug/reversal/log`.
3. **Autonomous.** When the local model writes a plan (`POST /api/llm/run` with mode `plan`, or `POST …/missions/plan`), its raw steps go through `reversePlan` and are logged with the model's name as the source. The steps the mission runs were already locked by the rules; the log records what the model tried. `#/diagnostics` adds the check "Reversal log is append-only".
4. **The page.** "Autonomous Reversal Log" sits in the Studio and in `#/diagnostics`.
   - **In the Studio:** paste HTML or CSS, press **Reverse and correct**, and read the corrected copy and the list of changes.
   - **In both:** the log's latest entries, each with its kind (template, plan proved or not), the number of corrections, where it came from and its hashes.
   - **Sample mode:** the same engine; the log, the audited event and the lesson stay in this browser.
5. **`.claude/skills/replica-reversal-engine/reversal_engine.py`** (standard library; no network, no processes).
   - **Functions:** `reverse_and_correct_plan` and `reverse_and_correct_template`, with the same rules. For the same template the hashes match the server's byte for byte (a unit test pins one).
   - **CLI:** `plan file.json`, and `template file --out copy`, which never writes over the input.
6. **Linear scans.** The mutation run's 200,000-character case showed the first draft's patterns backtracking: 42 s for one paste, which would block the server. Both engines now find declarations from precomputed stop positions, read `<style>` blocks and CSS braces in one pass, and bound every repeat. Hostile 200 KB inputs take 12 to 60 ms in JavaScript and 30 to 150 ms in Python.
7. **Mutation run.** Both engines join it:
   - `reversal.mjs`: 176 of 176 non-equivalent mutants killed, 22 equivalent;
   - `reversal_engine.py`: 240 of 240 killed, 13 equivalent.

   Each equivalent has its reason in the harness. For example, a buffer one longer holds the same values, and the two characters before a gradient's colours are always `t(`. All eight files together: 1008/1008.

Review: `docs/security/REVERSAL-ENGINE-REVIEW-2026-11-07.md`.

## Consequences

- A model plan that leaves a payment unlocked is visible after the fact, with the model's name and the hashes, not just silently fixed.
- A gradient is replaced with one stop's colour, which may not be the colour wanted; the copy is shown for the person to check before use.
- The CSS reading is pattern matching over braces, not a full parser; rules inside unusual nesting may be missed. The engine only adds fallbacks and removes gradients, so a miss leaves the text as it was.
- Locks unchanged: money, publishing, permissions, installs and outbound messages still wait for Director 00.

## Checks

The results are in the PR body. They cover:
- **SkillSpector** on the whole repository;
- **Unit tests and ruff** on the skill;
- **The mutation run;**
- **Server tests** on SQLite and PostgreSQL 16 (the engine, the routes, append-only rows, the audit leaf, the lesson, and a local model's unlocked plan logged on its own);
- **Flow tests:** F32 in `test-app.mjs` and the ADR-150 block in `test-live.mjs`;
- **Contrast**;
- **Three sizes** for `#/studio` and `#/diagnostics`, in English and Arabic;
- **Retina screenshots;**
- **Parity:** 100.0.
