---
name: replica-impact-analysis
description: Deterministic impact checks over facts the repository already holds - a model name against the 30-family open-weight catalog (its family, what its documented licence allows for personal use or for serving it to others, and the weights' memory from the card's own parameter count and the bits per weight you type), a skill's blast radius (Kahn's layers of what it loads with any cycle named, a reverse breadth-first search of what loads it, the pages and engines to test again, each skill's test command and the matching project documents by BM25 and RRF), and a line-by-line longest-common-subsequence diff of two texts or plans with SHA-256 of each text, the difference and the chain. Nothing is ranked, measured or guessed; running a model stays a locked approval. Standard-library Python only, over the reviewed skills.
---

# replica-impact-analysis

```bash
python3 .claude/skills/replica-impact-analysis/impact_analysis.py '{"mode": "catalog", "model": "openai/gpt-oss-120b", "use": "service", "bits": 4, "memory_gb": 80}' --data jarvis/app/data
python3 .claude/skills/replica-impact-analysis/impact_analysis.py '{"mode": "blast", "skill": "replica-reversal-engine"}' --data jarvis/app/data
python3 -m unittest discover -s .claude/skills/replica-impact-analysis/tests
```

## Rules

- Context memory (ADR-171, ADR-172) is counted only for the card the config was read from: `gqa` and `mla` with one layout, and `hybrid_sliding` when `config.json` names every layer as full or sliding attention with one numeric window and one head layout (2 × kv_heads × head_dim × (full_layers × tokens + sliding_layers × min(tokens, window))). Any other card is `not_estimated` and names the `config.json` fields that stop it.
- With the memory you have (`memory_gb`), `offload` says `local` when the weights and context memory fit (equal fits), `web_offload` when they do not, with a locked `publish` step to a web host, or `undecided` with no total. It reads the licence for your own site (personal use) and for others (serving).
- The catalog comes only from `jarvis/app/data/model-catalog.json`, which `node jarvis/scripts/build-app.mjs` writes from `jarvis/server/lib/model-catalog.mjs` (ADR-167). Nothing is fetched.
- A name that matches no family but starts more than one family's name (for example `qwen3.8`) is `size_unnamed`: its licence is not guessed.
- The licence rule reads the licence text as the catalog states it:
  - `MIT` or `Apache 2.0` is `allowed`; with a note in brackets it is `allowed_note`, and the note is shown as written;
  - a Model-as-a-Service condition is `commercial_licence` when serving the model to others;
  - a non-production licence is `not_allowed` for serving and `non_production` for personal use;
  - every other licence (custom or community terms) is `read_licence`: read its file before any commercial use.
- The weights' memory is parameters x bits / 8 / 10^9 GB, to two decimals, and counts only the weights. It is given only for the card the count was read from. Another size of the family is `other_card`; a family with no count is `no_count`.
- Running a model is one locked step: `{gate: "approval", locked: true, status: "pending_approval"}`. Nothing here approves it.
- Dependencies are EXTRACTED from each skill's `sys.path` lines (`skill-deps.json`). A cycle is named, never broken.
- The diff keeps equal lines and, when both choices keep the same length, removes a line before it adds one.
- Same answers and hashes as `jarvis/server/lib/impact-analysis.mjs`: `tests/golden.json`.
