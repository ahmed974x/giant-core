# ADR-136: Jarvis local model bridge (Ollama on 127.0.0.1) and the Jarvis Modelfiles

Date: 2026-11-05 · Status: Proposed. Ahmad's message of 2026-11-05 asked, on `claude/replica-design-jarvis` and before PR #52 is merged, for:
- two Modelfiles, `jarvis-designer` (on `qwen2.5-coder:7b`) and `jarvis-planner` (on `deepseek-r1:8b`);
- a local Ollama bridge in the Jarvis server, with `GET /api/llm/status` and `POST /api/llm/run`, the `<think>` box shown apart, and a graceful fallback to the fixed rules;
- a model-status badge in the page;
- an independent security review;
- tests: the fake model, the fallback, an injection that tries to unlock a locked step, and non-loopback addresses.

The same message also asked for further work: workflows, full Arabic, analytics and a token ledger, webhooks, two more skills, a skill forge and live web search. Those follow as their own commits and ADRs (AGENTS.md §7). They are not part of this one.

## Decision

1. **Bridge** (`jarvis/server/lib/ollama-bridge.mjs`).
   - **Address.** Fixed to `http://127.0.0.1:11434`; the port may change, the host may not. Any other address is refused when the server starts.
   - **Calls.** Each call has a timeout, refuses redirects and caps the answer at 2 MB.
   - **Models.** Names are checked; `:cloud` models are refused. The planner and designer defaults are chosen from the local list: `jarvis-planner` or `deepseek-r1`, and `jarvis-designer` or `qwen2.5-coder`. `JARVIS_PLAN_MODEL` and `JARVIS_DESIGN_MODEL` override them.
   - **`run({mode: plan | design | chat})`** never throws for a missing Ollama: it answers from the fixed rules and says so.
2. **Rules** (`jarvis/server/lib/llm-plan.mjs`, pure).
   - `splitThinking` separates the thinking from the answer.
   - `parsePlanJson` reads the steps.
   - `enforceApprovalGates` rebuilds every step from Jarvis's own lists, with English and Arabic lock words:
     - locks are decided by rule, never by the model;
     - forward dependencies are dropped.
   - `fallbackPlan` turns a goal's clauses into reads, then gates, then approvals.
   - The page's build inlines the same file, so sample mode plans offline with identical locks.
3. **Missions.**
   - `POST /api/w/:slug/missions/plan {goal}` plans with the model (or the rules) and creates a mission with template `llm-plan`.
   - The new nullable `planner` column (JSON) keeps the engine, the model, the thinking, a warning and the label `[INFERENCE - local LLM]`.
   - `createFromPlan` re-checks kinds, tools, criteria and categories.
   - The engine now skips steps whose needs can never finish instead of hanging.
4. **Designs.** `mode: design` sends the model's HTML through the clean-room extractor. Only the layout survives, refilled with Jarvis copy and its design system. The model's markup is never rendered.
5. **Page.**
   - **Top-bar badge:** "Ollama local · 0-token" or "Fixed rules"; only the dot shows on a phone.
   - **Missions:** a "Plan with the local model" panel.
   - **Mission view:** a Planner box with the thinking folded as untrusted text.
   - **Studio:** "Describe a page → Design with local model".
   - **Settings:** a "Local model" panel with the status, the models and the build commands.
6. **Modelfiles** (`jarvis/server/models/`). They hold the DESIGN.md and AGENTS.md §1 rules with the real token values. The light accent is `#0b5ed7`, as in `tokens.css`. Each file says how to build it with `ollama create`.

Review: `docs/security/OLLAMA-LOCAL-BRIDGE-REVIEW-2026-11-05.md`.

## Consequences

- Plans and designs can now come from a local model at no token cost, and nothing leaves 127.0.0.1.
- The model is advisory. Locks come from rules plus two database constraints.
- The sandbox has no Ollama, so a real model answer was not tested here. The bridge is tested against a fake Ollama on 127.0.0.1. Check a real model on the laptop.
- Agent runs still use the fixed rules. The model plans missions and drafts layouts only.
