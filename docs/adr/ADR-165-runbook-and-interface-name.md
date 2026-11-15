# ADR-165: The runbook and the interface name «أثير برايم» / Aether Prime

Date: 2026-11-14 · Status: Proposed. Ahmad's message of 2026-11-14 asked for a runbook page (`#/runbook`) that joins the existing engines with a Node and Python twin, and chose the interface name himself: «أختار أنا بنفسي تغيير اسم الواجهة إلى «أثير برايم» (`Aether Prime`) في النسختين العربية والإنجليزية».

## Decision

1. **One engine over the engines that exist.** `jarvis/server/lib/runbook.mjs` is pure and is inlined into the page in its own scope. `.claude/skills/replica-runbook/runbook.py` gives the same answers and chain hash (`tests/golden.json`, 19 requests).
2. **Six stages, in order, on one goal and the skills it names:**
   - **shield:** the privacy shield (ADR-158) cleans the goal before anything else reads it. A secret check keeps only the first five hex characters of its SHA-1.
   - **docs:** project search (ADR-164) returns the five best records, reviews and skills for the cleaned goal, with their fused scores, ranks and matching lines.
   - **order:** Kahn's order (ADR-163) of the chosen skills and what they load, from `skill-deps.json`.
   - **tree:** the workbench (ADR-160) on the cleaned goal, read as a behaviour tree (ADR-163). A locked approval keeps it running, and `locked` counts those steps.
   - **plan:** UCB1 (ADR-163) over the three meta-code plans from the person's own record, [INFERENCE].
   - **routes:** one fixed probe per page through the engine behind it: `#/docs`, `#/order`, `#/tree`, `#/polymath`, `#/workbench`, `#/universal`, `#/atlas`, `#/math` and `#/hyper`. Each reports whether the engine gave its checked answer and the first 12 hex characters of the SHA-256 of that answer. `#/diagnostics` reads the running server, so it is listed as `server_only`.
3. **Failures stay local.** A stage whose engine refuses its input is an `error`; the other stages still run and `ready` is false. A SHA-256 chain binds the stages in order.
4. **Facts from the repository only.** Skills, dependencies and documents come from the three snapshots in `jarvis/app/data` (`skill-tree-input.json`, `skill-deps.json`, `search-corpus.json`), which the server reads from disk and the page embeds.
5. **Server:** `POST /api/w/:slug/runbook` with `{goal, skills, record, c, secretCheck, lang}`. Nothing is sent or installed. The event log records `runbook.run` with the stages that ran and the locked count, never the goal.
6. **Page:** `#/runbook` («دفتر التشغيل») shows the goal form, then each stage with its result, the probe table and the chain hash, which wraps on a phone.
7. **The interface name.** The sidebar brand and the browser tab now read «أثير برايم» in Arabic and "Aether Prime" in English. The folder names, the server, the workspace called "Jarvis Studio", the skill names and the sentences inside pages that mention Jarvis by name are unchanged.

## Not done

- **Renaming every sentence.** About forty interface sentences name Jarvis, and each has an Arabic line and a test. They can follow in their own change if Ahmad wants it.
- **`#/evolve`.** A second prompt in the pasted page described a self-evolving engine. It was not part of the request and was not built.

## Consequences

- The runbook is only as fresh as the three snapshots. After a skill, a document or a dependency changes, rerun their tools and rebuild the page.
- The mutation list in CLAUDE.md adds `runbook.mjs` and `runbook.py`.
