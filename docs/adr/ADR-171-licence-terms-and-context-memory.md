# ADR-171: The five custom licences read in full, and context memory from each card's config.json

Date: 2026-11-15 · Status: Proposed. In ADR-167, the five custom licences were read only up to their conditions, and no context memory was estimated. Ahmad's message of 2026-11-15 asked for two things, from the official Hugging Face files only, with nothing estimated that the files do not support:
- read those licences to the end;
- read each card's `config.json`, so that the context (KV cache) memory can be computed.

## What was read

All of these were read on 2026-11-15 through `huggingface.co`, using the personal cloud environment of ADR-167, which allows only that host.

- **Licences.** The five `LICENSE` files, each read to the end (3 to 4 KB):

  | Family | Serving it to others ("Model as a Service") | Name shown in the product | Internal use | File SHA-256 |
  |---|---|---|---|---|
  | Kimi K3, Kimi K3.1 Pro | A separate agreement with Moonshot AI when the licensee's and affiliates' revenue exceeds US$20,000,000 over any 12 months | Above 100,000,000 monthly users or US$20,000,000 monthly revenue | Exempt, as is use through Moonshot's own products or certified partners | 20c797ce19af0c17, da05c356f773d22a |
  | GLM-5.3 | Z.AI's security review when that revenue exceeds US$10,000,000,000 over any 12 months | Not required | The licence does not say | 96e1622099fc9d6b |

  The two Qwen licences:

  | Family | Serving it to others ("Model as a Service") | Name shown in the product | Internal use | File SHA-256 |
  |---|---|---|---|---|
  | Qwen3.8 Flash (Qwen Community License 1.0) | A separate licence from Qwen for any Model as a Service or AI work assistant business, at any revenue | Above 100,000,000 monthly users or US$20,000,000 monthly revenue | Exempt | a0dc422560841fd6 |
  | Qwen3.8 Max (Qwen3.8-Max License) | A separate licence from Qwen when that revenue exceeds US$50,000,000 over any 12 months | Above 100,000,000 monthly users or US$20,000,000 monthly revenue | Exempt | a136bc4137ef3d7a |

  Each licence also keeps its copyright notice, which every copy must carry, and its "as is" warranty clause.

- **Configs.** The `config.json` of the 30 cards in the catalog. Three are gated (Gemma 3 27B, Llama 4 Scout, Llama 3.3 70B) and answered 401, so they were not read.

## Decision

1. **The catalog** (`jarvis/server/lib/model-catalog.mjs`):
   - **terms.** The five custom licences gain `terms`:
     - `requirement`: agreement, security review or licence;
     - `when`: always, or only above `revenue_usd_12m`;
     - `businesses`;
     - `display_name_over`;
     - `internal_use_exempt` (null where the licence does not say);
     - the file's URL, its SHA-256 and the read date.
   - **config.** Every family gains `config`:
     - `gqa` (9 cards), with layers, key-value heads and head size. `head_dim_derived` marks `hidden_size / num_attention_heads` where `config.json` gives no `head_dim`.
     - `mla` (2 cards: DeepSeek R1 and V3), with layers, `kv_lora_rank` and `qk_rope_head_dim`.
     - `not_estimated` (16 cards), with the reason and the longest documented context:
       - `sliding_and_full`: gpt-oss, Gemma 4, Olmo 3, MiMo;
       - `linear_attention`: Qwen3.8, Kimi K3, GLM-5.3-Flash;
       - `sparse_index`: DeepSeek V4, GLM-5.2 and 5.3, Mistral Large 4, which keep an index cache of their own.
     - `not_read` (3 gated cards).

2. **The licence rule** in impact analysis reads `terms` first:
   - personal use is allowed;
   - serving to others is `commercial_licence` when the licence asks for a licence at any revenue (Qwen3.8 Flash);
   - otherwise it is `revenue_threshold`, with the facts shown: requirement, revenue, display rule and internal use.

   Other licences keep ADR-168's rule. Release readiness and the architect studio get the same verdicts through impact analysis.

3. **Context memory.** Impact analysis takes three optional fields: `context_tokens` (1 to 10⁸), `batch_size` (1 to 4096, default 1) and `kv_bits` (1 to 32; default: the bits per weight). The context memory, in GB of 10⁹ bytes to two decimals, is:
   - gqa: `2 × layers × kv_heads × head_dim × tokens × batch × kv_bits ÷ 8 ÷ 10⁹`;
   - mla: `layers × (kv_lora_rank + qk_rope_head_dim) × tokens × batch × kv_bits ÷ 8 ÷ 10⁹`.

   It is given only for the card the config was read from, with uniform attention and bits to count by. Otherwise the answer says why and shows no number: `other_card`, `not_read`, `not_estimated` with its reason, or `no_bits`.

   When the weights are known too, `total_gb` adds them, and `fits` compares the total with the memory typed. A context longer than the card's documented maximum sets `exceeds`.

4. **Pages.**
   - `#/impact` adds the context length, batch size and bits per cache value, and shows the context memory, the total, the longest documented context and the licence terms with a link to the file.
   - `#/release` adds the context length to the bundle.
   - `#/architect` shows the same result.
   - Settings → the catalog adds "Longest context" and "Context memory".

## Not done

- **A context estimate for mixed attention.** Sliding-window layers keep only the window, linear layers keep a fixed state, and sparse-index models keep a second cache. A single formula would be wrong for each of them, so no number is shown.
- **Runtime buffers and activation memory.** They depend on the runtime and are not counted.
- **The three gated configs.** They were not read; reading them needs access granted on Hugging Face.

## Consequences

- The facts are as fresh as their read date. To refresh, read each file again and compare its SHA-256.
- Impact analysis's mutation run covers the two new functions (`kvCacheGb`, `contextMemory` and their Python twins).
