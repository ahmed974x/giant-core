# ADR-146: The UI-state gate and measured mutation testing

Date: 2026-11-06 · Status: Proposed. In ADR-145 two results were a report and an estimate:
- the UI-state check found that Jarvis's fields had no hover or loading state;
- the mutation audit gave a static strength estimate marked [INFERENCE].

Ahmad's message of 2026-11-06 asked to turn both into a gate and measured evidence.

## Decision

1. **Field states.** `app.css` gives `.input`, `.select` and `.textarea` every state they were missing:
   - **hover:** the border moves toward the muted text colour;
   - **loading:** `[aria-busy="true"]` or `.is-loading` gives a dashed border, the progress cursor and the sunken surface;
   - **empty:** a placeholder, or an empty `select` option;
   - **error:** `[aria-invalid]`;
   - **locked:** `:disabled`.

   Every colour is an existing token, so both themes follow. The busy state is static (no animation), so `prefers-reduced-motion` has nothing to stop. The Missions goal and the Studio's "Describe a page" field turn busy while their work runs.
2. **The gate.** `jarvis/replica/ui-states.json` lists the states each component must have:
   - buttons: default, hover, focus-visible, active, loading, locked;
   - fields: default, hover, focus-visible, loading, empty, error, locked.

   `state_prover.py --ui … --spec …` exits 1 on any gap. Its JSON output is `jarvis/replica/evidence/ui-states.json`, and the page build stops when that file is missing or the gate failed. Flow test F28 checks that the states really render in Chromium. Result: 27/27.
3. **Measured mutation testing.**
   - `jarvis/scripts/mutation-harness.mjs` mutates the SSRF address check (`v4Blocked`, `v6Groups`, `isBlockedAddress`), the AGENTS.md §1 lock rules (`lockCategory`, `enforceApprovalGates`, and every word of `LOCK_RULES` taken out in turn) and the prover. Each mutant is a copy in a temporary folder, imported in a worker thread with a 4-second limit.
   - `jarvis/scripts/mutation_harness.py` does the same for `gate.py`'s judge and `state_prover.py`. It writes mutants with `mutation_audit.py` and loads each one with `runpy` under a 3-second alarm.
   - Neither starts a process or reads outside code. A fixed oracle (the expected answers) runs against every mutant.
   - The two runs join into `jarvis/replica/evidence/mutation-audit.log`, which records the SHA-256 of every tested file.
   - `mutation_audit.py --evidence` and the Governance page show the measured result as [VERIFIED] only while every tested file still has the hash it was tested with; otherwise it shows as stale.
4. **Result:** 493 of 493 non-equivalent mutants killed (100%), across five files. 15 mutants are equivalent: they cannot change any answer. Each is listed in the log with its reason, kept out of the score, and never counted as killed.
5. **What the run found:**
   - **The SSRF shield never refused the discard-only prefix `100::/64`.** The check read `g[0] === 0x100 && zeros(4)`, and `zeros(4)` needs `g[0]` to be 0. It now checks groups 1 to 3, with a server test.
   - **The JavaScript prover crashed on a transition to a missing state.** It now fails the proof, as the Python twin did; also with a test.
   - **The oracle had gaps.** Lock words with no sentence of their own, title fallbacks, the `lint` gate alias, and mapped IPv6 addresses whose two halves were equal. Each was closed with a case. No mutant was marked equivalent to raise the score.

Review: `docs/security/MUTATION-HARNESS-AND-UI-GATE-REVIEW-2026-11-06.md`.

## Consequences

- A field without a state cannot ship: the build stops.
- The mutation score is a measurement tied to exact file hashes. Editing a tested file turns the page's badge to "stale" until the harness runs again.
- The equivalent mutants show where the SSRF shield has redundant checks (`::1`, Teredo, the group count). They stay as defence in depth.

## Checks

The results are in the PR body. They cover:
- **SkillSpector** on the whole repository;
- **Unit tests and ruff** on `replica-formal-verify`;
- **Both mutation harnesses;**
- **Server tests** on SQLite and PostgreSQL 16;
- **Flow tests:** F28 in `test-app.mjs`, and `test-live.mjs`;
- **Contrast**;
- **Three sizes** for `#/governance` and `#/studio`, in English and Arabic;
- **Retina screenshots;**
- **Parity:** 100.0.
