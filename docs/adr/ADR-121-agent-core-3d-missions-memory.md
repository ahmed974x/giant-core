# ADR-121: The agent core · النواة: a 3D core page, sourced model research, and PRIME missions with memory and lessons

Date: 2026-10-24 · Status: Proposed (Ahmad's message of 2026-10-24 13:15Z; merge waits for his go). Stacked on ADR-120 (PR #40), which is not merged yet.

## Context
Ahmad asked to research the newest AI models from open sources, "find their hidden secrets" and show them in 3D, to
design a super-intelligent agent that learns, finds solutions, works on long tasks and never gives up, using
open-source tools and skills, and to install it on the site as its core.

There are no hidden secrets to find: what works is published, with a licence. Closed models' weights are not public
and copying them is not allowed, so they are listed for comparison only. "Super intelligence" is not something a
page can honestly claim; what can be built and tested is an agent that plans, retries with backoff, switches
approach, remembers, learns fixed-rule lessons from its failures and keeps a long mission going across reloads.
Real trading stays locked (AGENTS.md §1).

## Decision
1. **Research register** in `scripts/lib/agent-core.mjs` and `docs/research/AI-MODELS-AND-AGENTS-2026-10.md`:
   19 models (6 closed from BenchLM's ranking of 2026-10-23, Muse Wonder, 11 open-weight, 1 unverified), 8 agent
   frameworks and 8 papers, each with its public source and date. Conflicting or missing fields are blank and named.
   A local-fit rule of thumb (0.55 GB per billion parameters at 4-bit plus 2 GB, three quarters of memory) is
   labelled [INFERENCE].
2. **Core engine** (same file, pure functions, no imports): plan checker (known tools only, nothing order-like,
   no loops, at most 12 steps) with Kahn ordering; exponential backoff with full jitter; a circuit breaker per helper
   (3 failures → 2 min rest, doubled on a failed trial, up to 30 min); memory capped at 400 with Generative Agents
   recall; Reflexion-style lessons from three equal failures in 24 h; long missions that save after every step,
   repeat on a timer, switch approach every second failure, block after six tries and hand the step to Director 00,
   and stop at 26 h; four templates (desk brief, 24-hour market watch, receipt guard for a day, site health);
   3D maths (rotation, perspective, Fibonacci sphere, rings) and a layout that draws only links the code has.
   `scripts/build-core-inline.mjs` inlines it into the core page and the Ops Room; `scripts/test-core.mjs` (18 tests)
   runs in CI.
3. **Core page** `omega-ops-room-v1/omega-core.html`: a canvas 3D scene (lead, six-stage loop, nine helpers, belt of
   frameworks and papers, sphere of models), drag / wheel / pinch / keys, drawn on demand only, a glide of at most
   4 s that is off under reduced motion; node picker and tables carry the same data; filters (open, closed, fits
   your memory) and a memory-size choice; PRIME's live mission, steps and lessons read from storage; a recall box.
   `connect-src 'none'`. Arabic / English dictionary `scripts/lib/i18n/core.mjs`. Added to the app switcher on every
   page, the Pages build, the service worker shell and the static page checks.
4. **PRIME upgrade** in the Ops Room: breakers on every helper; a second approach for the scout (desk markets one
   by one) and the analyst (60 candles); lessons slow a failing helper and put its other approach first; the memory
   records failures and status changes; one mission step per cycle; a mission card (start, stop, steps, memory,
   breakers, past missions). Mission tools only read and record; the desk is still steered only through
   `OMEGA_DESK_CTL` by the existing executor, and the auto engine still opens a paper trade only on the judge's OPEN.
   The self-test's court check also runs the core on fixed input (still 24 checks).
5. **Local model planner** `POST /llm/ollama/plan` on the proxy (loopback only, local pages only, JSON body ≤ 2 KB,
   one generation at a time): a fixed instruction listing the core's tools, Ollama `format: "json"`, and the plan is
   checked with `OMEGA_CORE.parseModelPlan` before it is returned (422 otherwise); the Ops Room checks it again.
   Documented in `docs/api/omega-data-proxy.openapi.json`.

## Not done
- No model, framework or tool was installed; the library entries are ideas only.
- No closed model is copied or imitated; no "hidden" tools were sought.
- No order code, no exchange route, no money moves.
- Live data and the local model could not be reached from the cloud sandbox: missions were run with live sources
  blocked (they back off, trip the breakers and block honestly) and the planner with a stand-in Ollama on
  127.0.0.1. Both need a check on the laptop with `start-omega`.

## Consequences
- PRIME keeps a mission going for up to a day while the Ops Room tab is open and the computer awake; a stuck step
  becomes a decision for Director 00 instead of an endless loop.
- The research register is a snapshot of 2026-10-24; it ages and must be re-read before it is relied on.
