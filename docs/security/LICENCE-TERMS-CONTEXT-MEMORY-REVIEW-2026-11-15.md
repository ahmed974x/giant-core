# Security review: licence terms and context memory (ADR-171)

Date: 2026-11-15 · Reviewer: Claude Code, cloud sandbox.

## 1. Files

| File | Lines | SHA-256 (first 16) | Change |
|---|---|---|---|
| `jarvis/server/lib/model-catalog.mjs` | 66 | 41676f72d534adbf | `terms` for five families and `config` for thirty |
| `jarvis/server/lib/impact-analysis.mjs` | 186 | b03a0ec76ccae211 | The licence rule reads `terms`; `kvCacheGb` and `contextMemory` |
| `.claude/skills/replica-impact-analysis/impact_analysis.py` | 348 | 042d4d16c29de25a | The same in Python |
| `.claude/skills/replica-impact-analysis/tests/golden.json` | — | 922f7d25a87f69ba | 312 requests with the server's answers |
| `jarvis/app/data/model-catalog.json` | 860 | a808080e1e772206 | Written by the page build from the module |

Also changed:
- `release-gate.mjs` and `release_gate.py`, and `architect-studio.mjs` and `architect_studio.py`: they pass the three new fields to impact analysis, and the radar's licence rule reads `terms`;
- `app.js` and `i18n-ar.json`: the fields and results in `#/impact`, `#/release` and Settings;
- the server, flow, live and mutation tests.

## 2. What it can do

- **Read nothing at run time.** The licences and configs were read once, by hand, through `https://huggingface.co`; the facts are a fixed table in the module. No code path calls that host.
- **Install and run nothing.** The context memory is arithmetic on fixed numbers. Running a model stays a locked approval.
- **Bound the arithmetic.** Tokens are at most 10⁸, batch at most 4096 and bits at most 32. The largest product is about 1.8 × 10²¹ (Granite Switch: 2 × 66 × 8 × 128 values per token), a finite double. Both languages compute it in the same order of floating-point operations, so they give the same digits; the golden file checks the limits.
- **Make two kinds of link.** The page links to the card (as in ADR-167) and to the licence file. Both URLs come from the fixed table, never from input, and open with `rel="noopener noreferrer"`. The CSP is unchanged.

## 3. Honesty

- **The licence terms** are the ones read in each file, with that file's SHA-256 and the read date. Where the licence does not say (GLM-5.3 on internal use), the field is null and the page says so.
- **What the verdict claims.** `revenue_threshold` states the revenue figure. It does not know the reader's revenue and does not guess it.
- **When context memory is estimated.** Only for uniform attention:
  - 9 grouped-query cards, where all layers are full attention or sliding windows are switched off in the config;
  - 2 latent-attention cards.
- **When it is not.** The 16 cards that mix attention types show no number, and the reason is the one their `config.json` shows: `layer_types`, `linear_attn_config`, `sliding_window` or an index `index_topk`. The three gated cards show "not read".
- **What is counted.** The cache formula counts keys and values only (or the latent and rope key). Runtime buffers and activations are not counted, and the page says so.
- **`head_dim_derived`** marks the six cards where the head size is `hidden_size / num_attention_heads` from the same file; in each case the division is exact.

## 4. Checks

The commands and their results are in the pull request. Biome is not installed in this sandbox, so `npx @biomejs/biome lint` was not run.

## 5. Decision

Accepted. The change is safe to run on Ahmad's machine as written.
