# ADR-169: Release readiness and the regression gate (#/release)

Date: 2026-11-15 · Status: Proposed. Ahmad's message of 2026-11-15 asked for a deterministic release-readiness check and regression gate, built on main after ADR-168 from the repository's own files, with no assumed numbers and no outside connection. The engine had to be in Node with a Python twin that gives the same answers, and its checks had to be handed to the engines it calls rather than repeated.

## Decision

1. **One engine in two languages.**
   - `jarvis/server/lib/release-gate.mjs` is pure and is inlined into the page in its own scope.
   - `.claude/skills/replica-release-gate/release_gate.py` uses the standard library, over `replica-skill-tree` and `replica-impact-analysis`.
   - `tests/golden.json` holds 82 requests with the server's answers, 38 of them refusals; Python gives the same answers and chain hashes.
   - The skill tree and impact analysis keep their own input checks. This engine checks only what is its own: the mode, the two snapshots and the list of skills.

2. **`audit`: the repository's traceability.**
   - The skill tree (ADR-162) counts the skills by state: proved, tested, text rules, reference, needs attention.
   - The shares are the proved, the tested, and the proved-or-tested skills over all skills, to four decimals.
   - From the project-search corpus (ADR-164) it counts the decision records and security reviews, and lists the record numbers missing between the first and the last. The missing numbers are a fact, not a failure.
   - The verdict is `ready` when no skill needs attention, `attention` otherwise, and `empty` with no skill.
   - On this repository: 63 skills, 0 needing attention.

3. **`regress`: two snapshots the person gives.** Each snapshot has twelve whole counts from 0 to 10⁹:
   - **Counts that should grow:** server tests, page flows and live tests passed, mutants killed. `regression` when the candidate is lower, `progress` when higher, `steady` when equal.
   - **Failure counts:** failed server tests, page flows and live tests; surviving mutants; SkillSpector critical and high; failing contrast pairs; bilingual-purity violations. `regression` when the candidate is above 0, `progress` when it fell to 0 from above, `steady` when it stays 0.
   - **The release:** `reject_regression` with any regression, `proven_progress` with any progress and no regression, `steady` otherwise.

4. **`bundle`: one release plan.** For 1 to 12 skills the change touched:
   - each skill's blast radius from impact analysis (ADR-168): Kahn's layers, the skills that load it, its pages;
   - the pages, the skills' test commands and the shared tests, joined in order without repeats.
   - An optional model goes through impact analysis's catalog check: the same licence verdict, memory only for the card the count was read from, and a name without a size not guessed.
   - Optional release notes `{a, b}` go through its line diff.
   - Publishing the release is a locked step `{action: "publish", gate: "approval", locked: true, status: "pending_approval"}`; running the model adds its own locked step.
   - `chain_sha256` starts from 64 zeros and takes `SHA-256(h + SHA-256(JSON(section)))` over the skills, pages, tests, shared tests, model, the notes' chain and the steps.

5. **Server and page.**
   - `POST /api/w/:slug/release` reads the catalog module and the snapshots on disk; a tree, corpus or catalog in the request is ignored. The event log keeps `release.<mode>` with the verdict or counts, never the model name.
   - `#/release` («جاهزية الإصدار» / Release readiness) has three panels, one per mode. Both snapshots start from this build's evidence files, and the page lists those files:
     - the three `tests-*.log`;
     - `mutation-audit.log`;
     - `skills-scan.json`;
     - `contrast-report.txt`;
     - `bilingual-purity.log`.

     A file that is missing leaves its counts out, and the gate then refuses the snapshot by name.
   - Tables scroll inside their box, so the page keeps its width at 390 and 375 px; hashes and file paths wrap.
   - The runbook (ADR-165) probes `#/release` with the audit, as its twelfth page.

## Not done

- **Running the checks from the page.** The page compares counts the person or the build gives; it starts no test, scan or process.
- **A repository-wide SkillSpector count in the snapshot.** The build's scan file covers `.claude/skills`. The whole-repository scan is the CI `scan` job, and its counts are typed into the candidate.

## Consequences

- The snapshots are only as fresh as the evidence files. Refresh the logs from the real commands, then rebuild the page.
- The mutation list in CLAUDE.md adds `release-gate.mjs` and `release_gate.py`.
