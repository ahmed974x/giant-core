# ADR-144: Jarvis council, Studio time machine and UX physics

Date: 2026-11-06 · Status: Proposed. Ahmad's message of 2026-11-06 asked for:
- a `replica-ux-physics` skill (Fitts, Hick, RTL/LTR symmetry, a heatmap, a chaos fuzzer with long Arabic, a symbol index);
- a Mixture-of-Agents council for plans and designs, where the locks always win;
- Studio snapshots with a side-by-side diff and a fork;
- a UX heatmap over the Studio preview;
- the council's debate shown step by step;
- tests on SQLite and PostgreSQL 16 proving the council cannot get round AGENTS.md §1.

## Decision

1. **`.claude/skills/replica-ux-physics/`**, standard-library Python, no network, no processes:
   - `ux_physics.py`: Fitts (ID = log2(D/W + 1) from the thumb's rest point, 44 px targets), Hick (RT = 0.2 + 0.15 · log2(n + 1), more than 7 flagged, [INFERENCE]), mirror symmetry and the heat grid. It reads boxes measured in a browser, or HTML and CSS alone (choices per group, sizes the CSS states, physical sides that stop a layout mirroring).
   - `chaos_fuzzer.py`: seeded cases in eleven kinds (long Arabic with tashkeel, mixed bidi, bidi controls, a 300-letter word, long URLs, emoji with joiners, zero-width marks, markup that must stay text, numbers, empty input, long lines). Data only; `jarvis/replica/evidence/fuzz-cases.json` holds seed 144.
   - `symbol_index.py`: functions, classes and constants of Python (`ast`, `tokenize`) and JavaScript (fixed patterns), each file with its SHA-256.
2. **The council**, `jarvis/server/lib/council.mjs`, route `POST /api/llm/council`:
   - **Architect:** the planner model proposes (DeepSeek-R1 family by default), or the designer through the clean-room extractor. With no model, the fixed rules propose.
   - **Red team and UX critic:** fixed rules. For a plan: steps proposed unlocked that the rules lock (LOCK), private or loopback addresses (SSRF, through `fetch-public.mjs`'s `isBlockedAddress`), publishing with no test gate before it (GATE), more than 12 steps (SIZE). For a design: Hick's law on navigation and calls to action, a missing title. The model's own critique is shown, labelled untrusted, and changes nothing.
   - **Synthesizer:** the designer model (Qwen2.5-Coder family by default) may rewrite the plan; its answer goes through `enforceApprovalGates` again. Then fixed repairs: a test gate before the first publish step, at most 12 steps, needs only on earlier steps.
   - **Last word:** every money, publish, permissions, install or outbound step leaves as `{ kind: "approval", gate: "approval", locked: true, status: "pending_approval" }`. `createMission` builds the mission from the server's own answer (the browser never hands it steps), and `mission_steps_locked_never_done` still refuses to mark such a step done.
3. **The time machine**, table `studio_snapshots` with routes under `/api/w/:slug/studio/`:
   - each snapshot keeps the site's layout, copy, theme, language and width;
   - its hash is `SHA-256(prev_hash + "\n" + canonical JSON)`, so `verify` finds any edit or removal;
   - the table is append-only by trigger in SQLite and PostgreSQL;
   - a fork is a new snapshot whose parent is the old one;
   - the diff is per JSON line (longest common subsequence) and per block (added, removed, changed, moved), shown side by side.

   Sample mode keeps the same chain in the browser with the same code (`snapshot.mjs` is inlined; its SHA-256 is plain JavaScript checked against `node:crypto`).
4. **The UX heatmap:**
   - the sandboxed preview answers a `jarvis-measure` message with the sizes and positions of its actions, headings, text and images (no text);
   - the page measures this language and the mirrored one, scores them with `ux-physics.mjs` and draws an SVG heat grid with small targets outlined over the preview;
   - Fitts, Hick and symmetry are listed beside it with [INFERENCE].
5. **Page:**
   - Missions → **Ask the council** shows the three roles' cards and **Make it a mission**;
   - Studio → **Time machine** and **UX heatmap**;
   - everything is in Arabic too.

   The chaos cases found one real fault: a 300-letter word or a long address widened the preview. Its headings and paragraphs now wrap anywhere (`preview.css`).

Review: `docs/security/JARVIS-COUNCIL-TIME-MACHINE-UX-PHYSICS-REVIEW-2026-11-06.md`.

## Consequences

- A model can propose, criticise and rewrite, but a sensitive step cannot leave the council unlocked. Three layers each hold it: the rules after every model answer, the mission engine's own checks, and the database constraint.
- Snapshot history cannot be edited in place. A removed row shows as a broken chain.
- The heatmap is a model of attention, not eye tracking. Fitts and Hick rank layouts; they do not predict one person.

## Checks

The results are in the PR body. They cover:
- **SkillSpector** on the whole repository;
- **Unit tests and ruff** on `replica-ux-physics`;
- **Server tests** on SQLite and PostgreSQL 16, including a fake model that proposes, critiques and rewrites with unlocked publish, payment and install steps;
- **Flow tests:** F22 to F25 in `test-app.mjs`, and the council, snapshots and heatmap in `test-live.mjs`;
- **Contrast**;
- **Three sizes** for `#/studio` and `#/missions`, in English and Arabic;
- **Retina screenshots;**
- **Parity:** 100.0.
