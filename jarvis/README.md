# Jarvis

A dark-first web dashboard for running AI agents: agents, runs, approvals and logs, plus a live
**Studio** for designing websites and a **Skill Mixer** for this repo's Claude skills. English UI,
RTL-ready. Decision records: ADR-132 (design system), ADR-133 (app, glass, Studio, Mixer) and
ADR-134 (local server, real runs, workspaces, agent editor, clean-room cloner).

The page has a strict CSP with `connect-src 'self'`: it talks only to the server that serves it, and
opened from disk it uses no network at all.

**Status: phase 1 and 2 built.** All 34 must-haves are done; parity is 100.0 (`replica/parity.md`, ADR-161).

Run it for real with the local server (ADR-134): real data, real tool runs, three workspaces, the agent editor, and the clean-room cloner.

```bash
node --disable-warning=ExperimentalWarning jarvis/server/server.mjs
```

Then open http://127.0.0.1:8798. That uses SQLite with nothing to install.

For PostgreSQL 16, install the locked `pg` client once:

```bash
npm ci --ignore-scripts --prefix jarvis/server
```

Then start the server against your local database:

```bash
JARVIS_DB=postgres DATABASE_URL=postgres://USER@127.0.0.1:5432/jarvis node jarvis/server/server.mjs
```

Opened straight from disk instead, the page uses a labelled sample workspace and simulated runs.

| Path | What it is |
| --- | --- |
| `app/index.html` | **the app**, built; do not edit by hand |
| `app/src/` | sources: `shell.tmpl`, `app.css`, `app.js`, `preview.css`, `preview.js` (the Studio sandbox) |
| `app/data/skills-scan.json` | SkillSpector scan of `.claude/skills`, read by the build for the Skill Mixer |
| `design/index.html` | the `/design` page: every primitive, both themes, LTR/RTL |
| `fonts/` | Inter, Geist Mono, Readex Pro (OFL 1.1) with licences |
| `replica/recon.md`, `features.csv` | screens S01–S14, flows F01–F08, feature matrix |
| `replica/architecture.md`, `schema.sql` | stack, API, 11-table schema with the approval rules |
| `replica/design/` | tokens (source of truth), generated CSS and Tailwind, specs, measurements, contrast report |
| `replica/build-log.md`, `parity.md` | what is built, what is not, and the score |
| `server/` | local server: `server.mjs`, `lib/` (database adapters, store, runner, public-page fetcher, clean-room cloner, SQLite schema), `test/test-server.mjs` |
| `scripts/` | `build-app.mjs`, `build-design-page.mjs`, `test-app.mjs` (sample mode), `test-live.mjs` (live server), `font-metrics.mjs`, `lib/fonts.mjs` |

## Change the design

Regenerate the token CSS:

```bash
python3 .claude/skills/replica-design/build_tokens.py jarvis/replica/design/tokens.json --oklch
```

Run both contrast gates:

```bash
python3 .claude/skills/replica-design/contrast.py jarvis/replica/design/tokens.json --apca 60
```

```bash
node audits/verify-contrast.mjs jarvis/replica/design/tokens.css
```

Then rebuild both pages (next section).

## Rebuild the pages

Refresh the skills scan:

```bash
node scripts/skillspector-audit.mjs --json jarvis/app/data/skills-scan.json .claude/skills
```

Build both pages:

```bash
node jarvis/scripts/build-app.mjs
```

```bash
node jarvis/scripts/build-design-page.mjs
```

Re-pin their CSP hashes:

```bash
node scripts/skillspector-audit.mjs --fix jarvis/app/index.html jarvis/design/index.html
```

Confirm both pages match their sources:

```bash
node jarvis/scripts/build-app.mjs --check
```

```bash
node jarvis/scripts/build-design-page.mjs --check
```

## Test

Run the flow tests (needs `playwright-core`):

```bash
node jarvis/scripts/test-app.mjs
```

Run the live-server flow tests and the server tests:

```bash
node --disable-warning=ExperimentalWarning jarvis/scripts/test-live.mjs
```

```bash
node --disable-warning=ExperimentalWarning jarvis/server/test/test-server.mjs
```

Run the three-size check:

```bash
node scripts/ui-three-sizes.mjs "file://$PWD/jarvis/app/index.html#/studio"
```

## Mission Control (ADR-135)

`#/missions` runs long tasks in ordered phases. The steps of one phase run in parallel.

- **Tool steps** use the runner's real read tools.
- **Gate steps** (TDD, Lint, Contrast, Security) read saved evidence and never run anything:
  - `jarvis/replica/evidence/*.log`;
  - the contrast report;
  - the SkillSpector scan.
- **Approval steps** wait for a person. Money, publishing, permissions, installs and outbound messages wait for good as «بانتظار الموافقة» cards; steps that do not need them carry on.
- **Capsules.** After each phase, a SHA-256 chained capsule is saved. Inspect, verify or restore it from the side panel.
- **Plan files.** Each mission also keeps the `replica-long-horizon` files (`task_plan.md`, `findings.md`, `progress.md`) under `jarvis/server/.data/workspaces/<slug>/missions/<id>/`.

Refresh the evidence after running the checks:

```bash
JARVIS_TEST_PG_URL=postgres://… node --disable-warning=ExperimentalWarning jarvis/server/test/test-server.mjs > jarvis/replica/evidence/tests-server.log
```

```bash
node jarvis/scripts/test-app.mjs > jarvis/replica/evidence/tests-app.log
```

```bash
node --disable-warning=ExperimentalWarning jarvis/scripts/test-live.mjs > jarvis/replica/evidence/tests-live.log
```

```bash
python3 -m unittest discover -s .claude/skills/replica-long-horizon/tests -v > jarvis/replica/evidence/tests-long-horizon.log 2>&1
```

```bash
ruff check .claude/skills/replica-long-horizon > jarvis/replica/evidence/lint-long-horizon.log
```

Write each log to a scratch file first, and copy it into `jarvis/replica/evidence/` once the run has finished. Redirecting straight into the folder truncates the very log a running test may read.

Then rebuild the page, so sample mode's gates read the new snapshot.

## Local model (ADR-136)

Optional, and free: Ollama on this computer, reached on 127.0.0.1 only.

```bash
ollama pull deepseek-r1:8b
```

```bash
ollama pull qwen2.5-coder:7b
```

```bash
ollama create jarvis-planner -f jarvis/server/models/Jarvis-Planner.Modelfile
```

```bash
ollama create jarvis-designer -f jarvis/server/models/Jarvis-Designer.Modelfile
```

```bash
node --disable-warning=ExperimentalWarning jarvis/server/server.mjs
```

The top bar shows "Ollama local · 0-token" when it answers, and the model can then be used in three places:
- **Missions** → "Plan with the local model". The model drafts the steps; Jarvis decides every lock.
- **Studio** → "Design with local model". Only the layout of the model's page is kept.
- **Settings** → "Local model": the status and the models in use.

Without Ollama, the same buttons use the fixed rules.

## Workflows, analytics, webhooks, Arabic (ADR-137)

- **Workflows.** `#/workflows` lists the graphs; the SVG editor draws and edits them (drag, or the arrow keys). Running one makes a mission, and locked steps wait.
- **Analytics.** `#/analytics` shows the numbers and the creator card: zero-token, unlimited.
- **Plans and tokens.** In Settings you can write draft plans for future subscribers. Turning on billing or a plan is a locked money request: the database keeps billing off and every plan a draft.
- **Webhooks.** `#/webhooks`. An incoming hook takes `POST /api/hooks/<id>` with `X-Jarvis-Signature: sha256=<HMAC-SHA256 of the body>`. An outgoing hook reaches `http://127.0.0.1:<port>/` only; any other address is a locked request.
- **Arabic.** Press «ع» in the top bar, or open the page with `?lang=ar`. Every new UI string needs a line in `jarvis/app/src/i18n-ar.json`.

## Memory bank and Skill Forge (ADR-138)

- **Memory.** `#/memory` keeps this workspace's episodes: finished missions, local-model plans, designs and answers, self-check lessons and your own notes. Search ranks them with BM25, in Arabic and English. Before the local model drafts a plan or a design, the best three episodes go to it as examples, marked as data. This is retrieval, not training. A text with a key-shaped value is refused.
- **Self-check.** Jarvis asks questions it can answer itself: contrast ratios, which actions are locked, the spacing scale. With Ollama running it grades the model; either way every computed answer is stored as a lesson. **Export JSONL** downloads the workspace's episodes, one chat pair per line.
- **Curriculum.** `python3 .claude/skills/replica-hybrid-python/curriculum_50k.py count` shows the size: 258,048 layouts and 54,250 Q&A pairs. `export --kind qa --n 50000 --out <file> --root .` writes them as JSONL.
- **Skill Forge.** In the Skill Mixer, write a skill from a sentence or mount the SKILL.md you pasted. Every file is scanned with SkillSpector's rules, and a critical or high finding is refused. A mounted skill shows in the Mixer and the agent editor at once. **Install into the repo…** is a locked approval.
- **Skills.** `replica-cyber-recon` (keys, unsafe code, manifests, SHA-256 manifests) and `replica-hybrid-python` (layout fingerprints, scheduling, pattern memory, curriculum). Both are standard library only, with no network and no process.

## Live open-web search (ADR-139)

`#/search` searches the live internet through the local server, using official public JSON APIs with no key:
- **🌐 Open web:** Wikipedia (Arabic and English), OpenAlex, Hacker News and GitHub.
- **📦 Packages and code:** npm, GitHub, and PyPI for a package name.
- **🛡️ OSV vulnerabilities:** for `ecosystem:package@version`.
- **🧬 Clone a live site:** sends the address to the Studio's clean-room cloner.

To add your own SearXNG, start the server with `JARVIS_SEARXNG_URL=http://127.0.0.1:8888` (or an https address); JSON format must be on in its settings. Results are links to read; a summary goes into memory. With no internet the page answers from memory and says so. No search page is scraped.

## Open-weight models through vLLM, llama.cpp or Ollama (ADR-140)

Jarvis can use any OpenAI-compatible server on this computer instead of Ollama's native API:

```bash
vllm serve Qwen/Qwen2.5-Coder-7B-Instruct --host 127.0.0.1 --port 8000
```

```bash
JARVIS_OPENAI_COMPAT_URL=http://127.0.0.1:8000/v1 node jarvis/server/server.mjs
```

- Plans go to a DeepSeek-R1 model and designs to Qwen2.5-Coder, when they are served. Answers go to DeepSeek-V3 if you run it, or else to any local model.
- Settings → Local model shows each family's licence and has **Ask the local model**, which streams the answer token by token, with the reasoning folded apart.
- Only `http://127.0.0.1` is accepted, so no hosted API and no key.

## Founder only (ADR-141)

Set `JARVIS_FOUNDER_KEY` and every page and API call needs that key (sign in at `/login`). To reach Jarvis over HTTPS on your own server, put Caddy in front: see `jarvis/deploy/README.md`.

Settings → Access shows the mode `founder_private`. **Open to the public…** makes a locked card; the database will not change the mode. Settings → Hosted model endpoints records a hosted address, such as a DeepSeek API, as a draft behind a locked card. Nothing is sent.

## Skill Loader (ADR-142)

`#/loader` grows Jarvis's skills from inside the page:
- **Discover on GitHub:** search public repositories, then import one `SKILL.md` as text.
- **Synthesize:** describe a skill or tool; the local model (or the fixed template) writes it.
- **Capture a mission:** turn one that worked into a skill.
- **Fix… and Derive…:** make new versions, or new skills, from loaded ones.

Every skill is audited first. One that passes is mounted at once: it shows in the Skill Mixer, the agent editor and Ctrl+K. **Install into the repo…** is a locked card; nothing is written to `.claude/skills` and nothing runs.

## Governance (ADR-143)

`#/governance` shows four things:
- the working rules, also in CLAUDE.md;
- which outside patterns were adopted as text rules and which were excluded;
- a map of screens, server modules, tables and skills (click a node to see its routes);
- the 62-rule quality gate's report.

Refresh the two snapshots after code changes, then build the page:

```bash
python3 .claude/skills/replica-graphify/graphify.py --root . --out jarvis/app/data/knowledge-graph.json
```

```bash
python3 .claude/skills/replica-impeccable/slop_guard.py --json jarvis/app/src jarvis/server/lib jarvis/README.md docs/adr --root . > jarvis/app/data/impeccable-report.json
```

Settings → Local model → **Open-weight model catalog** lists 12 families (DeepSeek, Qwen, GLM, Llama, Gemma, OLMo, Phi, Codestral), each with its licence and job.

## Council, time machine and UX heatmap (ADR-144)

- **Missions → Ask the council.** Three roles debate the goal: the architect proposes (the planner model, or the fixed rules), the red team and UX critic check it with fixed rules (locks, private addresses, a test gate before publishing, plan size), and the synthesizer repairs it (the designer model may rewrite it). Each card is shown. Whatever they say, money, publishing, permissions, installs and outbound messages leave as locked steps «بانتظار الموافقة». **Make it a mission** runs the council again on the server and builds the mission from that answer.
- **Studio → Time machine.** **Save snapshot** adds a row whose SHA-256 covers the site and the hash before it. **Compare** shows two snapshots side by side and lists the sections added, removed, changed or moved. **Fork snapshot** brings an old one back as a new snapshot. Rows cannot be edited, and a removed row shows as a broken chain.
- **Studio → UX heatmap.** The preview measures its own boxes in both languages. The page draws an attention grid with small targets outlined, and lists Fitts, Hick and mirror symmetry [INFERENCE].

The same formulas run without a browser:

```bash
python3 .claude/skills/replica-ux-physics/ux_physics.py jarvis/app/index.html
```

```bash
python3 .claude/skills/replica-ux-physics/chaos_fuzzer.py --seed 144 --count 60 --out jarvis/replica/evidence/fuzz-cases.json --root .
```

## Macros and the 5-in-1 export (ADR-145)

- **Ctrl+K → Compose a macro.** Write steps joined with "then". The fixed rules make the steps (no model), and a breadth-first proof checks the plan as you type: no deadlock, every step reached, and no money, publishing, permission, install or outbound step reachable without a locked approval. The badge reads **Formal Proof: Verified**. **Run macro** sends only the text; the server proves it again, and the mission stops at each «قيد الموافقة» step.
- **Studio → Export 5 files:** the HTML page, a Web Component (`.mjs`, Shadow DOM, `lang="ar"` for right to left), W3C design tokens with contrast results, an inferred PostgreSQL schema whose payments, publishing and permissions tables start locked, and a Playwright test for the three sizes.

The same prover runs without a browser:

```bash
python3 .claude/skills/replica-formal-verify/state_prover.py --plan plan.json
```

## Telemetry and the Merkle audit tree (ADR-147)

- **Analytics → Telemetry.** The server times every workspace request on this computer (`api.latency_ms`). You can also post points to `POST /api/w/<slug>/telemetry/record` as `{ "points": [{ "metric": "build.ms", "value": 812 }] }`. The chart is cut to 60, 120 or 240 points by LTTB, which keeps peaks and troughs. Every anomaly (|z| > 3 against the values before it) is marked. Beside it: mean and SD (Welford), EWMA and a VPIN-style flow imbalance [INFERENCE].
- **Logs → Merkle audit tree.** Approvals and locked-step requests, agent changes, gate results, skills, endpoints, Studio snapshots and exports are leaves of a SHA-256 Merkle tree (RFC 6962). **Prove** fetches an entry's audit path, and your browser checks it. **Verify the whole log** recomputes every leaf and tree head. No row can be edited or deleted.

## Diagnostics (ADR-148)

`#/diagnostics` checks the five layers now: memory, development and proof, open search with the SSRF shield, security (SkillSpector, the Merkle log, the 10 lock constraints in this database) and the local model bridge. **Download diagnostic bundle** saves one JSON file on this computer. Before it is saved, secret-like field names, known key formats and long high-entropy strings are replaced with `[REDACTED]`, and the file says how many values were removed and by which rule.

## Windows that follow each other and compressed templates (ADR-149)

- Open Jarvis in two windows: switching the language or the theme, or editing the Studio site in one, shows in the other at once. Nothing leaves the browser.
- **Studio → Output → Template (.json.gz)** saves the site compressed; **Import a template (.json.gz)** reads one back. Files over 1 MB, or over 2 MB unpacked, are refused.

## Autonomous Reversal Log (ADR-150)

- **Studio → Autonomous Reversal Log:** paste HTML or CSS and press **Reverse and correct**. Gradients become one colour, glass gets a fallback for people who ask for less transparency, and long words wrap. The corrected copy and the list of changes appear below; the original is not touched.
- When the local model writes a plan that leaves a payment, a publish, a permission, an install or a message unlocked, the plan is locked by rule as before, and the log now says what the model tried, with SHA-256 hashes. Each entry is in the Merkle audit log and in memory as a lesson.
- `#/diagnostics` shows the same log, read-only, and checks that it cannot be changed.

## Arabic and English, each one whole (ADR-151)

- In Arabic, every screen is in Arabic, the server's details included (for example «744 ناجح، 0 فاشل»). Paths, commands and product names stay as written, set apart so they read in the right order.
- In English, the only Arabic is the language button, the locked «قيد الموافقة» marks, the teaching label and anything a person wrote in Arabic.
- Notes, memory and file content are shown as they were written, in their own language.
- The local model answers in the language the page is in.
- `test-app.mjs` F33 and `test-live.mjs` check every screen in both languages and write `jarvis/replica/evidence/bilingual-purity.log`; Diagnostics shows the result.

## Passive recon (ADR-152)

- **`#/recon`:** type a domain you own or may check, then **Check the domain**. Jarvis makes four GETs through the local server: the registration record (rdap.org), the certificate logs (crt.sh), the home page's headers and `/.well-known/security.txt`. It lists what each says: expiry and DNSSEC, the names on certificates, a 0-100 header grade with fixes, and whether security.txt has a Contact and an Expires still ahead.
- No key is needed and nothing is scanned or guessed. A part that cannot be read is listed as not read.
- Without the server, the page shows a teaching example for `example.com`, labelled as made-up records.
- The same parsers run on saved files with `python3 .claude/skills/replica-passive-recon/passive_recon.py`.

## Contrast that heals itself (ADR-153)

- **Studio → Colours → Heal contrast automatically:** every colour pair below WCAG 4.5 or APCA 60 gets its text colour moved to the nearest lightness that passes, with the same hue. The report lists each change with WCAG and APCA Lc before and after. A pair no lightness can fix says so; change the background or the hue instead.
- **The reversal engine** does the same for pasted CSS: a rule with a text colour and a solid background that fails is healed, and the log shows the numbers.
- **Command line:** `python3 .claude/skills/replica-reversal-engine/reversal_engine.py template page.css` gives the same result.

## Math lab (ADR-154)

- **`#/math`:** pick an example or write a request (calculus, a differential equation, a matrix, number theory or Bayes), then **Solve and check**. Each step is shown with its formula, every answer is checked backwards (a root by |f(root)| ≤ 1e-9, a system by its residual, factors by multiplying back), and **[VERIFIED]** appears only when every check passed. Functions and ODEs are plotted as SVG.
- No code is run: a parser reads the expression into a tree, with limits on length and depth. A pole is named, and no integral is given across it.
- The API is `POST /api/w/:slug/math/solve` (send the `x-jarvis: 1` header; `?lang=ar` for Arabic steps). The same maths runs with `python3 .claude/skills/replica-universal-math/universal_math.py solve request.json`.

## Hyper studio (ADR-155)

- **`#/hyper`:** pick a shape (cube, tesseract, 16-cell, 8-cube or the E8 roots) and turn it with the three sliders; nothing moves on its own. Under the drawing are the method and the checks, for example that E8's Coxeter element has order 30 and its roots fall on 8 rings of 30.
- **Optics:** depth of field, hyperfocal distance, field of view, background blur, EV100 and the colour of each light from its Kelvin.
- **Game physics:** an A* path checked against breadth-first search, and particles bouncing in the grid.
- The API is `POST /api/w/:slug/studio/hyper` with `mode` set to `projection`, `optics` or `game_physics`; a projection also comes back as `svg`. The same maths runs with `python3 .claude/skills/replica-hyper-studio/hyper_studio.py run request.json`.

## Meta-codes (ADR-156)

- **Where:** a «Meta-codes» panel in Missions (under the council), the Studio and the Math lab. Press `ALT3`, `KILLCRITIC`, `X10THINK`, `EL10` or `/HUMAN`, or type them in the request, then Compile.
- **What comes back:** three plans (the fastest slice, tests and proof first, self-hosted on this computer), each proved; a payment, deploy, permission, install or outbound step is a locked approval marked «بانتظار الموافقة» in every plan. KILLCRITIC adds the gate findings with their fixes, X10THINK four stages, EL10 one plain sentence per plan and /HUMAN one paragraph.
- The API is `POST /api/w/:slug/metacodes/compile` with `{prompt, codes, lang}`. The same engine runs with `python3 .claude/skills/replica-prompt-metacodes/prompt_metacodes.py request.json`, and gives the same SHA-256.

## Typeset formulas and cinematic presets (ADR-157)

- **`#/math`:** a «Formula» panel above the steps and the plot shows the request typeset with box and glue: f(x), its derivative as d/dx and the integral with its limits, dy/dx, or the matrix with b and x. The API answer carries the same drawing as `formula_svg`.
- **`#/hyper`:** the «Cinematic presets» panel. Pick one of 21 presets to see its composition (golden lines, the spiral and the subject point), lens, focus range, hyperfocal distance, field of view and three lights. Each light's colour is shown as text that passes WCAG 4.5 and APCA Lc 60 on the panel. The values are starting points, marked [INFERENCE].
- The API is `GET /api/w/:slug/studio/cinematic/presets` and `POST /api/w/:slug/studio/cinematic` with `{preset, theme}`. The same presets run with `python3 .claude/skills/replica-hyper-studio/cinematic_presets.py run '{"preset":"desert_dusk"}'`.

## FOSS atlas and privacy shield (ADR-158)

- **`#/atlas`:** 26 open-source tools, lists and agent-skill projects by category, each with what it replaces, its licence as its own licence file states it (linked, read 2026-11-12) and whether it runs on your machine. The seven skill projects are ideas awaiting a security review; nothing is installed.
- **Plan a stack:** pick tools and enter what you pay now; the plan shows the data-sovereignty share, the savings from your prices only, every install and outbound link as a locked step «بانتظار الموافقة», and an inert n8n blueprint. A secret typed in the check is hashed in the page: only its SHA-1 prefix and entropy are shown.
- **Privacy shield:** paste text to replace keys, tokens, e-mail addresses, phone numbers, IBANs, card numbers and IPv4 addresses before it goes to any model.
- **Personas:** seeded teaching examples, «مثال تعليمي — أرقام افتراضية», whose picks and prices can be used in the planner.
- The API is `GET /api/w/:slug/atlas`, `POST /api/w/:slug/atlas/plan` with `{selectedIds, prices, secretCheck}`, `POST /api/w/:slug/privacy-shield/scrub` and `GET /api/w/:slug/atlas/personas`. The same engine runs with `python3 .claude/skills/replica-foss-atlas/foss_atlas.py`.

## Universal agent (ADR-159)

- **`#/universal`:** pick a mode, edit the JSON and press Check. Request builds a Claude Messages body and lists the fields it dropped; Route ranks models by the six-factor score and trips the breaker below 0.20; Relay writes a handoff summary; Compress drops repeated lines; Security gives each finding a verdict; Graph finds a path and its weakest hop; Lean applies the ladder; Design runs the reversal engine.
- It sends nothing. Every send is a locked step «بانتظار الموافقة»: a hosted model by ADR-141, and a local gateway such as OmniRoute also as an install that needs a review.
- The Models panel shows the five Claude models from the claude-api skill's table; other model names show «تعذر التحقق منها». The review panel lists the 13 outside projects read on 2026-11-12, with their licence files; none is installed.
- The API is `POST /api/w/:slug/agent/universal` with `{mode, …}`. The same engine runs with `python3 .claude/skills/replica-universal-agent/universal_agent.py`.

## Workbench (ADR-160)

- **`#/workbench`:** write a task, pick the model and effort, choose which checks to include (CSS, an expression, the atlas picks with a price, two sample findings) and press Run the pipeline.
- The task goes through the privacy shield first, then the meta-codes, the model request, the design check, maths, the FOSS atlas and the security verdicts. Each stage shows its status, its summary and a link to its own page.
- A stage that refuses its input says so and the others still run. Every send, install and outbound step is listed «بانتظار الموافقة» in one proved plan, with a chain hash over the stages. Nothing is sent.
- The API is `POST /api/w/:slug/workbench/run` with `{task, model, effort, css, math, atlas, candidates, secretCheck}`. The same pipeline runs with `python3 .claude/skills/replica-unified-workbench/unified_workbench.py`.

## Polymath (ADR-161)

- **`#/polymath`:** write a question, add what the engines need (an expression, a series of numbers, CSS, lens values), optionally two options with your own weights and scores, and claims written as `domain: claim`, then press Think it through.
- The question goes through the privacy shield first. Each of the five domains (maths, time series, optics, design, security) says whether it ran, why it was named and which engine and ADR answered, with a link to its page. A domain named without its input says it needs input.
- Every named domain lists how it could fail and what in this repository stops it. The decision matrix uses only your numbers. A claim on a domain that did not run is marked not backed, and with no engine run the answer abstains instead of guessing. An RFC 6962 Merkle root binds the records. Nothing is sent.
- The API is `POST /api/w/:slug/polymath/run` with `{question, domains, math, series, optics, css, candidates, atlas, options, weights, claims}`. The same engine runs with `python3 .claude/skills/replica-polymath-engine/polymath_engine.py`.

## What Jarvis will not do

- **Money, publishing, repository permissions, installing skills, outbound messages.** These are locked «قيد الموافقة» cards that no agent can approve (AGENTS.md §1). `schema.sql` refuses them too.
- **The Studio** only downloads a file. The cloner reads one public page, obeys `robots.txt`, refuses private addresses, and keeps only its layout: no text, images, colours, scripts or brand.
- **The Skill Mixer** only copies a plan, and the Skill Forge only mounts a scanned skill in the workspace's registry; nothing is written into `.claude/skills` or run.
- **Billing** is never switched on, and no plan is ever charged, from Jarvis. **Webhooks** never send outside this computer from Jarvis.
- **A local model** never decides a lock, never runs a tool of its own, and its HTML is never shown as-is.
