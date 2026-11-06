# Jarvis

A dark-first web dashboard for running AI agents: agents, runs, approvals and logs, plus a live
**Studio** for designing websites and a **Skill Mixer** for this repo's Claude skills. English UI,
RTL-ready. Decision records: ADR-132 (design system), ADR-133 (app, glass, Studio, Mixer) and
ADR-134 (local server, real runs, workspaces, agent editor, clean-room cloner).

The page has a strict CSP with `connect-src 'self'`: it talks only to the server that serves it, and
opened from disk it uses no network at all.

**Status: phase 1 and 2 built.** All 27 must-haves are done; parity is 88.5 (`replica/parity.md`).

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

## What Jarvis will not do

- **Money, publishing, repository permissions, installing skills, outbound messages.** These are locked «قيد الموافقة» cards that no agent can approve (AGENTS.md §1). `schema.sql` refuses them too.
- **The Studio** only downloads a file. The cloner reads one public page, obeys `robots.txt`, refuses private addresses, and keeps only its layout: no text, images, colours, scripts or brand.
- **The Skill Mixer** only copies a plan, and the Skill Forge only mounts a scanned skill in the workspace's registry; nothing is written into `.claude/skills` or run.
- **Billing** is never switched on, and no plan is ever charged, from Jarvis. **Webhooks** never send outside this computer from Jarvis.
- **A local model** never decides a lock, never runs a tool of its own, and its HTML is never shown as-is.
