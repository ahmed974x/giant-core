# ADR-135: replica-long-horizon skill, Jarvis Mission Control and the clean-room template extractor

Date: 2026-11-05 · Status: Proposed. Ahmad's message of 2026-11-04 asked, on branch `claude/replica-design-jarvis` and before PR #52 is merged, to:

1. add a long-task skill `.claude/skills/replica-long-horizon/`. It must be standard-library Python only, with no network and no external programs, at SkillSpector 0 critical and 0 high, and have a security review. It combines:
   - three-file planning;
   - SHA-256 verified restore capsules (`capsule.py`);
   - a deterministic completion gate (`gate.py`).
2. add «مركز قيادة المهام الطويلة» (Mission Control) to Jarvis, with:
   - sequential and parallel phases;
   - context health;
   - a state capsule log with inspect and restore;
   - TDD, Lint, Contrast and Security gate results per step;
   - locked steps that wait as violet «بانتظار الموافقة» cards, protected in the page and in PostgreSQL 16, while independent steps continue.
3. turn the Studio's cloner into a clean-room template extractor in the Jarvis design system, with an instant sandboxed preview, RTL and LTR, and 375, 768 and 1440 widths;
4. finish parity: a long-horizon mode in the agent editor, the workspace switch and `/replica-backend`;
5. take retina screenshots, rerun `/replica-diff`, run every check and update PR #52.

The merge waits for his go.

## Decision

### 1. Skill: `replica-long-horizon`

The skill is written here; nothing is vendored. Its five files are listed in the review.

**`plan.py`** keeps the three plan files:
- `task_plan.md`: phases, and tasks like `T3: … {gate: tests, security; ac: AC1}`;
- `findings.md`;
- `progress.md`.

It also reports a context-health heuristic, labelled `[INFERENCE]`.

**`capsule.py`**
- **Save.** It saves the three files, the git position and chosen files (optionally with their content) as `long-horizon-capsule-v1`. The hash is SHA-256 over canonical JSON, chained by `prev_hash`; the first `prev_hash` is 64 zeros.
- **Verify.** It checks the sequence, every link, every hash, the hash of any saved content, and drift.
- **Restore.** Restore refuses a broken chain and needs `--yes`. It never rewrites `progress.md`, which stays append-only.

**`gate.py` never runs a command.** It reads the logs that the real commands wrote:
- `tests`: node `N passed, 0 failed`, unittest or pytest output;
- `contrast`: `0 failing` or `All pairs pass`;
- `security`: SkillSpector `--json` with critical and high both 0;
- `lint`: `0 errors` or `All checks passed!`.

A task passes only when:
- every named log passes;
- every log is newer than the watched files;
- every named criterion has an evidence line whose path exists.

A `{gate: approval}` task never passes.

Not running anything is what keeps the skill at 0 high. The cost: a log is only as honest as the command that wrote it, and the skill says so.

Review: `docs/security/LONG-HORIZON-SKILL-REVIEW-2026-11-05.md`.

### 2. Schema

Four tables are added to `schema.sql` and `schema-sqlite.sql`, with the same names and constraints in both:

**`missions`**
- status: `draft`, `running`, `awaiting_approval`, `succeeded`, `failed` or `paused`;
- `capsule_every`: 1 to 10.

**`mission_steps`**
- `phase`, `kind` (`tool`, `gate` or `approval`), `category`, `depends_on`, `criteria`, `gate_status`;
- `mission_steps_gate_before_done`: a gate step is done only if its gate passed;
- `mission_steps_locked_never_done`: an approval step in money, publish, permissions, install or outbound is never done.

**`capsules`**
- Unique `(mission_id, seq)`.
- Both hashes have length 64.
- Append-only, by trigger on both engines.

**`gate_results`**
- One row per check.

### 3. Engine: `jarvis/server/lib/missions.mjs`

**Phases.**
- Phases run in order; the ready steps of one phase run in parallel.
- A step whose need failed or was skipped is skipped.
- A step whose need is waiting stays queued.
- When nothing else can run and something waits, the mission is `awaiting_approval`.

**Tool steps.** They use the runner's real `files.read`, `git.log`, `notes.read` and `runs.read`.

**Gate steps.**
- They judge files under `jarvis/replica` or `jarvis/app/data`: `jarvis/replica/evidence/*.log`, `design/contrast-report.txt` and `app/data/skills-scan.json`.
- The rules are those of `gate.py`, through one exported `judge()` function.
- Each result row keeps the evidence path and its SHA-256 prefix.

**Approval steps.**
- They create normal approval rows.
- A `file_write` step carries the mission's note: steps, gate evidence, and what waits for Director 00. The note is written only after a person approves, through the runner's existing `applyApproval`.
- The decide route then finishes the step and resumes the mission.
- Locked categories can never be approved or done. "Carry on without it" skips the step and its dependants, and leaves the request pending in the inbox.

**Capsules.**
- Saved after every `capsule_every` phases, and when the mission waits, pauses, finishes or is restored.
- Restore verifies the chain, puts every step back to its saved state, pauses the mission and seals a capsule "restored from #N".
- A request decided after the capsule is asked again, not left waiting.

**Plan files.** Every mission writes the skill's three files under `.data/workspaces/<slug>/missions/<id>/`, in the format `gate.py` parses.

**Context health.** `100 − 12 × steps since the last capsule − 1 per 400 output tokens over 4,000`, labelled `[INFERENCE]`.

**Seeds.** One draft mission per workspace:
- giant-core: release readiness;
- Jarvis Studio: design audit;
- OMEGA PRIME: weekly decision digest.

**Agent mode.** An agent's `limits` gains `mode` (`single` or `long_horizon`) and `capsule_every`. Starting a long-horizon agent creates and runs a mission made from its tools: reads, then a security gate, then the note approval.

**Routes.** All are under `/api/w/:slug/missions`:
- list and create;
- detail;
- run and pause;
- verify and inspect a capsule;
- restore;
- skip a waiting step.

### 4. Page

**`#/missions`** shows cards with progress, phases, capsules, waiting steps and health.

**`#/missions/:id`** shows:
- each phase with "parallel · N steps";
- step cards with TDD, Lint, Contrast and Security badges, and the evidence path and hash;
- locked steps as dashed violet cards, «بانتظار الموافقة · Waiting for Director 00», with no approve button and a "Carry on without it…" action;
- inline Approve and Reject for note steps;
- a side panel:
  - context health meter;
  - capsule log, newest first, with Inspect (hash check and saved states) and Restore… (disabled while running);
  - "Verify chain";
  - the plan files.

**Sample mode (`file://`)** runs the same rules on the browser's data:
- tool steps are labelled simulated;
- gates judge an evidence snapshot the build takes from the repo with the server's own `judge()`;
- capsules are real SHA-256 chains, from a plain-JS SHA-256 whose output the flow test checks against Node's `crypto`.

**Agent editor.** It gains "Execution" (single run or long-horizon mission) and "Save a capsule every … phases". The agent page shows the mode, and its button reads "Start mission".

**Live polling.** A workspace switch now reads the change marker at once. Before this, a mission that finished within the first 1.5 s after a switch was never redrawn.

**Studio: clean-room template extractor.**
- The build inlines the server's pure `clean-clone.mjs`, so pasted HTML is extracted in the page with no network. Reading an address still goes through the server's fetcher (ADR-134).
- The template always gets the Jarvis night tokens (accent `#77bcff`), and the page lists the design system it applied.
- The preview runtime adds Geist Mono to its fonts.
- It also adds a glass sticky bar:
  - `blur(16px) saturate(180%)` over 78 % of the page colour;
  - inside `@supports`;
  - solid under `prefers-reduced-transparency`.
- Figures are set in Geist Mono with tabular, slashed-zero numerals.

### 5. Parity

`features.csv` gains seven must-haves. All are done. `parity.py` reports **34 of 34 must-haves and 90.3 / 100 weighted**. The gap is should- and could-haves outside this request:
- workflows (S06, S07);
- the Arabic UI translation;
- analytics;
- webhooks;
- run comparison;
- members and roles;
- server push;
- model cost.

## Consequences

- Locked work now has two database rules, for approvals and for mission steps, on both engines.
- Gates are only as good as their evidence. Before a PR, the five logs in `jarvis/replica/evidence/` are refreshed from the real commands (`jarvis/README.md`) and the page is rebuilt.
- No new dependency or network path. The page's CSP keeps `connect-src 'self'`.
- Missions still use no model. Planning, summaries and health are fixed rules, and they say so.
