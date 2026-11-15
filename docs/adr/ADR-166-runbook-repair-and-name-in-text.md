# ADR-166: The runbook's repaired plan, and «أثير برايم» / Aether Prime in the page text

Date: 2026-11-15 · Status: Proposed. Ahmad's message of 2026-11-15 asked to finish the name change inside the pages and the workspace title, keeping folders, `jarvis/server/server.mjs` and code paths as they are, and to show a corrected plan in `#/runbook` when a stage is refused for an input the repository can correct by rule.

## Decision

1. **The repaired plan.** `runbook.mjs` and `runbook.py` gain `repairRequest` / `repair_request`. When a run is not ready, each refused stage is checked for an input the existing rules can correct:
   - **order:** skills that are not in `skill-deps.json` are left out, repeated names are joined, and at most 12 are kept;
   - **plan:** a `c` that UCB1 refuses is left out, and each record entry that the plan rule refuses on its own is left out (a record that is not an object is left out whole);
   - **tree:** a CSS that the design stage cannot read is left out.

   Each change names its stage, its field and what was left out. The repaired request is run through the six stages once more, and the answer adds `repair: {changes, request, request_sha256, after: {ready, locked, stages, chain_sha256}}`. With nothing to correct, `repair` is null. The repaired request never includes the goal, the secret or the CSS.
2. **The CSS, corrected.** The runbook takes an optional `css`. It goes to the workbench's design stage. The tree stage also shows:
   - the reversal engine's and contrast healer's rules (ADR-150, ADR-153);
   - the SHA-256 before and after;
   - the corrected CSS;
   - `fixed_point`: whether the corrected copy needs no further change when run again.

   A gradient is not a refusal here, because those engines already correct it. The tree stage is refused only when the workbench tree fails, which a CSS it cannot read causes.
3. **Locks.** Nothing in the repair sends, installs or approves. Locked steps stay locked in both runs, and `locked` counts them.
4. **The name in the text.** Every interface sentence that named Jarvis now says «أثير برايم» in Arabic and "Aether Prime" in English. That covers 40 lines of `app.js`, their 39 Arabic lines, and the server messages a person reads (the public-access card and its refusal, mission notes, memory, skill audit and billing notes). It also covers the skill-tree family "Aether Prime skills", the maths refusal "This sign is not maths Aether Prime reads." and the inert n8n blueprint name, each in both twins and their golden files. The seeded workspace is now "Aether Prime Studio".
5. **What keeps the old name:** folders, file names, `jarvis/server/server.mjs`, the workspace slug `jarvis-studio`, the `X-Jarvis` and `X-Jarvis-Signature` headers, the `Jarvis-Planner` Modelfiles and model names, the user agents `JarvisCleanClone` and `JarvisOpenSearch`, the template format id, the prompts sent to a local model, and code comments. These are interfaces or identifiers, not text a person reads in the page. A database created before this change keeps its workspace name until it is renamed in Settings.

## Consequences

- The runbook's golden file has 32 requests, 10 of them with a repair.
- The skill tree's, the universal maths' and the FOSS atlas's golden files were rewritten from the server's own answers after the name change.
