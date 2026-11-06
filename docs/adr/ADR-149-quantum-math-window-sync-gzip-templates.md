# ADR-149: The quantum-math skill, cross-window sync and compressed Studio templates

Date: 2026-11-06 · Status: Proposed. Ahmad's message of 2026-11-06 asked for:
- a standard-library skill with four engines: VPIN context toxicity, a Poisson-relaxation layout, a seeded Monte Carlo over missions, and Shamir over GF(256);
- open Jarvis windows that follow each other (BroadcastChannel);
- Studio templates as `.gz` files, compressed in the browser (CompressionStream).

## Decision

1. **`.claude/skills/replica-quantum-math/quantum_math.py`** (standard library; no network, no processes):

   | Engine | What it does |
   | --- | --- |
   | `compute_vpin_toxicity` | tokens fill equal buckets; a token is toxic in proportion to how unproductive and repetitive its event was. VPIN is the mean toxic share of the last buckets and OFI is (productive − toxic) / total. At 0.65 it advises going back to the last good capsule [INFERENCE] |
   | `solve_fluid_layout` | Jacobi steps of the discrete Poisson equation spread the cards' visual weight (the variance falls). Cards go into 1, 2 or 3 columns for 375, 768 or 1440 px, mirrored for RTL, with 44 px touch and overflow checks |
   | `simulate_mission_monte_carlo` | seeded lognormal durations over the steps' `depends`; gives p50, p95, the share of runs each step is on the critical path, and the steps ready now. A locked step (AGENTS.md §1, the same words as `llm-plan.mjs`) and everything after it never run, and `locked_never_ran` says so |
   | `split_secret_gf256` / `reconstruct_secret_gf256` | Shamir over GF(2⁸) with the AES polynomial 0x11b; each share carries its SHA-256. The coefficients come from `secrets`; a fixed generator can be passed in tests only |

   **Changed from the pasted code:**
   - VPIN in the paste measured |toxic − productive| / total, which scores a fully healthy stream 1.0 ("toxic"). Here it is the toxic share.
   - The paste drew Shamir's coefficients from a seeded `random`, so anyone who knew the seed could rebuild the polynomial and the shares would protect nothing.

   **Tests prove:**
   - FIPS-197's GF(256) products, and every inverse;
   - any k shares rebuild the secret;
   - k − 1 shares fit all 256 values of each byte of the secret.
2. **Cross-window sync.**
   - **Channel:** `BroadcastChannel("jarvis_workspace_sync")`, same origin only, so nothing leaves the browser.
   - **What syncs:** language, theme and the Studio site, across every open Jarvis window.
   - **Rules:** a received message is checked and applied, never sent on. A window where someone is typing in a field is not redrawn under them.
3. **Compressed templates.**
   - **Export:** Studio → Output → **Template (.json.gz)** writes the site through `CompressionStream("gzip")`.
   - **Import:** reads a `.json.gz` back through `DecompressionStream`. It refuses more than 1 MB compressed or 2 MB unpacked, which stops a zip bomb. It keeps only known block types, short strings and `#rrggbb` colours.
   - The page's CSP is unchanged (`connect-src 'self'`).
4. **Mutation run.** `quantum_math.py` (field arithmetic, Shamir and VPIN) joins `mutation_harness.py`: 99 of 99 non-equivalent mutants killed. Two are equivalent, each with its reason:
   - a ninth `gf_mul` pass does nothing, since `b` is already 0;
   - `zip(strict=...)` changes nothing over two lists built from the same list.

   All six files together: 592/592.

Review: `docs/security/QUANTUM-MATH-SYNC-GZIP-REVIEW-2026-11-06.md`.

## Consequences

- A change in one window shows in the others at once. Two people on one computer share it, as they already shared the same storage.
- Shamir's shares are only as safe as where they are kept: the skill splits; storing the shares apart is the person's job.
- A timing fault found in this run is fixed: `GET …/telemetry/metrics` now waits for the latency flush, including one the 2-second timer already started (`server.mjs`, flushes chained), so `api.latency_ms` is always there when it was measured. The test failed only now and then before.

## Checks

The results are in the PR body. They cover:
- **SkillSpector** on the whole repository;
- **Unit tests and ruff** on the skill;
- **The mutation run;**
- **Server tests** on SQLite and PostgreSQL 16;
- **Flow tests:** F31 in `test-app.mjs` (two windows, the `.gz` round trip, a zip bomb refused), and the two-window check in `test-live.mjs`;
- **Contrast**;
- **Three sizes** for `#/studio`, in English and Arabic;
- **Retina screenshots;**
- **Parity:** 100.0.
