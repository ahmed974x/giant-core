# ADR-172: Context memory for documented sliding and full layers, and the bundle export

Date: 2026-11-15 · Status: Proposed. ADR-171 left 16 of the 30 catalog cards without a context memory estimate, because they mix attention types. Ahmad's message of 2026-11-15 asked for two things:

- estimate the cards whose `config.json` states every layer without ambiguity, and keep the rest unestimated with the field that stops it;

- export the architect's and the release's results as one document to copy, with its hash.

## What was read

The 16 `config.json` files read for ADR-171 on 2026-11-15 (same SHA-256), field by field. Nothing new was fetched.

Two cards name every layer, with one numeric window and one key-value head layout for both kinds:

| Card | Full layers | Sliding layers | Window | KV heads × head size |
|---|---|---|---|---|
| `openai/gpt-oss-120b` | 18 | 18 | 128 | 8 × 64 |
| `allenai/Olmo-3.1-32B-Instruct` | 16 | 48 | 4096 | 8 × 128 |

Olmo's file gives no `head_dim`; 5120 ÷ 40 = 128 exactly, from the same file, as in ADR-171.

The other 14 stay unestimated. The fields that stop each one:

| Card | Fields |
|---|---|
| Gemma 4 31B | `num_global_key_value_heads`, `global_head_dim`, `attention_k_eq_v` |
| MiMo V2.6 Pro | `hybrid_layer_pattern`, `v_head_dim` |
| MiMo V2.6 Flash | `hybrid_layer_pattern`, `v_head_dim`, `swa_num_key_value_heads` |
| Qwen3.8 Max and 27B | `layer_types: linear_attention` |
| Qwen3.8 Flash | `layer_types: linear_attention`, `indexer_budget` |

| Card | Fields |
|---|---|
| Kimi K3 and K3.1 Pro | `linear_attn_config` |
| GLM-5.3-Flash | `linear_attn_config`, `layer_types: deepseek_sparse_attention` |
| GLM-5.2 and GLM-5.3 | `index_topk`, `indexer_types` |
| DeepSeek V4 Pro and V4.1 Flash | `compress_ratios`, `index_topk` |
| Mistral Large 4 | `layer_types: indexed_attention`, `index_topk` |

Gemma 4's full layers use other heads than its sliding layers, and `attention_k_eq_v` may mean the key and value share one cache. The MiMo files mark layers 0 or 1 without saying which number is the window, and their value size differs from their key size. Each of these would need a guess, so no number is shown.

## Decision

1. **The catalog** (`model-catalog.mjs`):

   - the two cards above become `hybrid_sliding` with `full_layers`, `sliding_layers` and `sliding_window`;

   - every card still `not_estimated` gains `blocking`, the list above;

   - every config carries the same fields, null where they do not apply.

2. **The context memory** (`kvCacheGb` in impact analysis and its Python twin) for `hybrid_sliding`:

   `2 × kv_heads × head_dim × (full_layers × tokens + sliding_layers × min(tokens, sliding_window)) × batch × kv_bits ÷ 8 ÷ 10⁹` GB.

   - The bracketed product is a whole number below 2⁵³, so both languages hold it exactly.

   - The floating-point steps after it are in the same order in both.

   - Up to the window the result equals full attention; past it the sliding layers stop growing.

   - The context answer adds `sliding_window` (for an estimate) and `blocking` (for a card not estimated).

3. **The export.**

   - Release readiness gains the mode `export`: Kahn's layers of the chosen skills (plan order), the pages, the test commands, the model's verdict, terms, weights and context memory, the locked steps and the release chain.

   - The architect studio gains the mode `export`: the same document with the seal's state and five-character audit prefix and, only while the seal is open, the checked preview scale. It needs no seal and carries neither the code nor the full hash.

   - Both write the document as JSON with keys sorted at every level and a two-space indent, and as Markdown. Each text has its SHA-256 (`bundle_sha256`, `markdown_sha256`).

   - Writing the file is a locked step (`write`), next to publishing and running the model.

4. **Pages.**

   - `#/impact` shows the window and the hybrid formula, or the blocking fields.

   - `#/release` and `#/architect` show the export in a read-only box with JSON or Markdown and a copy button. Copying stays in the browser; where it is not allowed, the text is selected.

   - Settings marks the two cards "Estimated (sliding and full layers)".

## Not done

- **A guess for the 14 cards.** Each needs a number its file does not give.

- **Writing the export to disk or sending it.** It stays a locked approval.

## Consequences

- When a card's `config.json` changes, read it again and compare its SHA-256 before changing its class.

- The mutation run covers `canonical`, `modelSection`, `modelLines`, `bundleMarkdown`, `exportBundle`, `releaseDocument`, `releaseExport`, `exportHead` and `architectExport`, and their Python twins.
