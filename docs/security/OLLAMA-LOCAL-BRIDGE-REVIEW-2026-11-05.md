# Security review: Jarvis local model bridge and the Jarvis Modelfiles (ADR-136)

Date: 2026-11-05 · Reviewer: Claude Code, cloud sandbox.

Ahmad asked on 2026-11-05 for a local Ollama bridge in the Jarvis server, with its own security review. AGENTS.md §1 needs a written review before any new service is added.

## Scope

| File | Role |
|---|---|
| `jarvis/server/lib/ollama-bridge.mjs` | Network side: talks to Ollama on 127.0.0.1 |
| `jarvis/server/lib/llm-plan.mjs` | Pure rules: thinking split, plan parsing, locks, fallback plan |
| `jarvis/server/server.mjs` | Routes `GET /api/llm/status`, `POST /api/llm/run`, `POST /api/w/:slug/missions/plan` |
| `jarvis/server/lib/missions.mjs` | `createFromPlan`, the `planner` column, the no-deadlock guard |
| `jarvis/server/models/Jarvis-Designer.Modelfile`, `Jarvis-Planner.Modelfile` | Model settings and rules, built by the person on their own computer |
| `jarvis/app/src/app.js` | Top-bar status, plan panel, planner box, Studio design button, settings panel |

**What is not added:**
- No dependency.
- Nothing under `.claude/skills/`.
- No model weights in git.
- Nothing is installed or downloaded by Jarvis. `ollama pull` and `ollama create` are commands the person runs.

## Threats and controls

### 1. SSRF: someone points the bridge elsewhere

The address is fixed to `http://127.0.0.1:11434`. `JARVIS_OLLAMA_URL` and the `startServer` option may change the **port** only. `pinLoopback()` refuses anything else **when the server starts**:
- another host, including `localhost`, `[::1]` and `127.0.0.1.nip.io`;
- `https`, `file`;
- credentials, a path, a query.

No request, header or model answer can change the address afterwards.

Every call uses:
- `redirect: "error"`;
- `AbortSignal.timeout` (1.5 s for status, 45 s for a generation);
- a 2 MB answer cap.

Tests:
- nine refused addresses;
- a server that will not start with `http://169.254.169.254`;
- every request the fake Ollama received was addressed to `127.0.0.1:<port>`.

### 2. Model names

Model names must match `^[a-z0-9][a-z0-9._/-]{0,62}(:tag)?$`. `:cloud` and `-cloud` models are refused, because Ollama runs them on its own servers. This is the rule the OMEGA proxy already uses (ADR-112). A model must also be one that Ollama lists locally. Tests refuse `glm-5:cloud` and `../../etc`.

### 3. Model output is untrusted (`[UNTRUSTED_MODEL_OUTPUT]`)

**Plans.**
- `parsePlanJson` takes the first JSON object with a `steps` array.
- `enforceApprovalGates` then rebuilds every step from Jarvis's own lists:
  - `kind` is tool, gate or approval;
  - tools come only from the four read tools;
  - gate evidence files come from a fixed map.
- A step is locked when **Jarvis's rules** find money, publishing, permissions, installs or outbound words in it, in English and Arabic. The model's own `locked`, `status`, `kind` and `tool` fields cannot unlock it. A model that asks for a lock keeps it.
- Dependencies that point forward, or to a later phase, are dropped, so a plan cannot deadlock. The engine also skips steps whose needs can never finish.
- `createFromPlan` checks kinds, tools, criteria and categories once more before anything is stored.

**Injection test.** The fake model marks "Publish the site to production", «ادفع فاتورة الاستضافة» and "Install the new skill" as `locked: false, status: "done"`, and names a `shell.exec` tool. The result:
- all three are stored as locked approval steps;
- they wait as «بانتظار الموافقة»;
- approving through the API is refused (403);
- `update mission_steps set status = 'done'` is refused by `mission_steps_locked_never_done`, on SQLite and PostgreSQL 16.

**Designs.**
- The model's HTML is never rendered.
- It goes through the clean-room extractor (`clean-clone.mjs`), which keeps only the layout shape and refills it with Jarvis's own copy. Scripts, styles, links, images and brand words are dropped, and the sweep checks this. The test: a `<script>` and the brand "Brandco" do not reach the blocks, with 0 leaks.
- The Studio preview stays a sandboxed `srcdoc` frame under the pinned CSP.

**Text and thinking.**
- `<think>…</think>` is split out, capped at 16 KB, and shown folded, labelled as untrusted model text.
- Answers are capped at 64 KB.
- Both are set with `textContent`, never `innerHTML`.

### 4. The page's network

- The page's CSP stays `connect-src 'self'`. It talks to the Jarvis server only, never to Ollama directly.
- Writes keep the existing guards: Host check, `X-Jarvis: 1`, same origin, JSON, size cap.

### 5. Fallback

When Ollama does not answer:
- every route answers from the fixed rules (`fallbackPlan`, the extractor's starting page) and says so;
- nothing fails.

The same rules ship inside the page (inlined by the build), so `file://` sample mode plans with them too.

### 6. The Modelfiles

- Text only: `FROM`, `PARAMETER`, `SYSTEM` and one example exchange.
- The colours are copied from `jarvis/replica/design/tokens.css`. The light accent is `#0b5ed7` (the real token), not the `#0058b8` that was suggested.
- The example card keeps the violet locked state and a disabled button.
- Jarvis sends its own short instruction with each request, so a changed Modelfile cannot widen what the server accepts. Locks are applied after the model in every case.

## Residual risks

- **Local trust.** A model can still write misleading titles or thinking. Both are labelled `[INFERENCE - local LLM]` and untrusted. Nothing runs from them except Jarvis's own read tools and gates.
- **Keyword locks.** They over-lock: "send", "external" or "access" lock a step that may be harmless. That is the safe direction. A person can skip the step ("Carry on without it"), which approves nothing.
- **Other local processes.** Anything listening on 127.0.0.1:11434 is trusted to be Ollama. Its answers are still treated as untrusted data.

## Results

See ADR-136. Server tests pass on SQLite and PostgreSQL 16, including the bridge, injection and fallback checks. SkillSpector `--strict` on the repo: 0 critical, 0 high.
