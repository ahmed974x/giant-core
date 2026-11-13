# Security review: the sources named for the polymath engine, read-only (ADR-161)

Date: 2026-11-13 · Reviewer: Claude Code, cloud sandbox · Asked for by Director 00 in the ADR-161 request.

## 1. Method

- Each project's `README.md`, `LICENSE` and, where present, `pyproject.toml`, `package.json` or `requirements.txt` were read as plain text from `raw.githubusercontent.com/<owner>/<repo>/HEAD/…` into a scratch folder outside the repository.
- **Nothing was installed or run.** No `pip install`, `docker compose`, `ollama pull` or any other command from these projects was used.
- SkillSpector over everything downloaded found **0 critical, 0 high, 0 medium, 0 low** (`node scripts/skillspector-audit.mjs rev161`, 9 files).
- Only rules stated in the projects' own text were taken. They were written fresh in `jarvis/server/lib/polymath-engine.mjs` and its Python twin.

## 2. Register

| Source | Licence (file read 2026-11-13) | How it installs | What its text says | Taken here | Verdict |
|---|---|---|---|---|---|
| bibinprathap/VeritasGraph (0.2.0) | MIT | `pip install -e ".[studio]"`, Ollama, or `docker compose up`; its requirements list OpenAI, Anthropic and Ollama clients, GraphRAG, LanceDB and Gradio | «Each response carries `grounded`, `unknown_citations` and `abstained`»; «If no entity matches … the response sets `abstained: true` instead of guessing» | `grounded`, `unknown_citations` and `abstained` in the grounding stage | rules adopted, not installed |
| semantica-agi/semantica (0.8.0) | MIT | `pip install semantica`, 22 dependencies; optional model providers | a decision is «a first-class graph node with a full lifecycle»; `record_decision()` and `check_decision_rules()` | each domain's answer names its engine, its ADR and its route (`source`), and the Merkle root binds every record | rules adopted, not installed |
| Anjos2/recursive-research | MIT | a skill installed into an agent | «Every non-trivial autonomous decision runs WDM + Munger and shows the reasoning»; Munger inversion asks «what do I not know?» | the weighted decision matrix (the person's own weights and scores only) and the inversion list for each domain | rules adopted, not installed |
| ComposioHQ/awesome-claude-skills | no licence file at the root: «تعذر التحقق منها» | a list | lists recursive-research as «WDM + Munger inversion for autonomous decisions» | where the method was found | reference only |
| K-Dense-AI/scientific-agent-skills | MIT (read 2026-11-12, ADR-159) | `npx skills add` | a large skill pack | the idea that each scientific question is split into checks, done here by the repository's own engines | reviewed in ADR-159, not installed |

## 3. What did not come in

- **No code, graph store, vector store or model client.** VeritasGraph and Semantica both reach hosted models through their optional clients. AGENTS.md §1 and ADR-141 keep that locked, and the engine never calls a model.
- **No numbers from the request's page:**
  - the weights 0.4, 0.3 and 0.3;
  - the scores 100 and 62;
  - the «0% inflation».

  The decision matrix scores only what the person types. With no options and no weights there is no matrix.
- **No claim beyond the engines.** The engine answers with what `solve`, `analyse`, `optics`, the reversal engine and the security verdicts compute, and abstains otherwise.

## 4. To install any of them later

You would need, for the exact version:
- a new written review covering the file tree, the lockfile, the install scripts, the network calls and any model clients;
- Ahmad's approval (AGENTS.md §1);
- for a service, a 127.0.0.1 bind and no hosted endpoint without the ADR-141 card.
