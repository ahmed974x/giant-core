# ADR-167: The open-weight model catalog, read again from each model's record

Date: 2026-11-15 · Status: Proposed. Ahmad's message of 2026-11-15 asked to research the strongest AI models and the best free open-weight ones, and to develop the site. This ADR covers the part that can be settled from facts: the model catalog that Settings and the local engines already use (ADR-140, ADR-143).

## Context

- `jarvis/server/lib/model-catalog.mjs` held 12 families with licences "as known on 2026-11-06" and no named source per row.
- Since then several makers have published new open weights:
  - DeepSeek V4;
  - Qwen3.8;
  - GLM-5.2 and 5.3;
  - Kimi K3 and K3.1 Pro;
  - Gemma 4, which moved to Apache 2.0;
  - Mistral Large 4;
  - Devstral Small 2;
  - MiMo-V2.6;
  - Olmo 3;
  - Granite Switch 4.1.
- Web articles that rank these models disagree on sizes and repeat makers' benchmark claims. AGENTS.md §3 asks for a named source and a date for every figure.

## Decision

1. **One source per row.** Each family names the Hugging Face model record it was read from (`card`), read on 2026-11-15 through `https://huggingface.co/api/models/<id>`. The fields are:
   - `licence`: the record's `license` field;
   - `created`: the record's `createdAt` date;
   - `params`: the parameter count its safetensors files declare, or `null` when the record gives none (Mistral Large 4, whose card's own figures are kept in the note);
   - `read`: the day it was read.

2. **Custom licences.** A licence the record marks `other` is named by the title line of the repository's `LICENSE` file. That file was read only up to its conditions, so the conditions are not summarised; read the file before any commercial use. Mistral's licence is the exception: its Model-as-a-Service condition was read in full and is stated.

3. **30 families.**
   - The 12 earlier families were re-read; their licences matched.
   - 18 were added: deepseek-v4-pro, deepseek-v4-flash, qwen3.8-max, qwen3.8-flash, qwen3.8-27b, glm-5.3-flash, glm-5.3, glm-5.2, kimi-k3.1-pro, kimi-k3, mimo-v2.6-pro, mimo-v2.6-flash, gpt-oss, gemma-4, olmo-3, granite-switch-4.1, mistral-large-4 and devstral-small-2.
   - Families whose sizes carry different licences are split: Qwen3.8 27B is Apache 2.0, Flash uses the Qwen Community License 1.0 and 2.4T uses the Qwen3.8-Max License; GLM-5.3 is custom and GLM-5.3-Flash is MIT.
   - A name that does not say which one (`qwen3.8`) matches no family, so no licence is guessed.

4. **No ranking.** The cards' benchmark tables are their makers' own claims; no score is copied and the catalog orders nothing by strength. A family's "strengths" quote the card's own description where marked "(the card's own words)".

5. **Page.** Settings → the open-weight catalog adds two columns:
   - **Parameters**: compact, tabular numbers, or «تعذر التحقق منها» when the record gives none;
   - **Source**: a link to the card, with the date it was read.

   The link opens with `rel="noopener noreferrer"`; the page's `connect-src 'self'` is unchanged, because the page fetches nothing.

6. **Engines.** `profileOf` and `pickModel` are unchanged. A model served on 127.0.0.1 is matched by its name; nothing is downloaded or installed. Running any of these models stays the person's own `ollama pull` or vLLM start on the laptop.

## Network

`huggingface.co` was blocked in this cloud session. Ahmad approved a personal environment `giant-core` that allows only that host. The repository code reaches no new host: the catalog is a fixed table in the file.

## Not done

- **A "strongest model" ranking.** No independent benchmark was read, so none is shown.
- **Hosted models.** Hosted models stay locked behind ADR-141's approval card; this catalog is open weights only.
- **A site redesign beyond the table.** The pages already follow DESIGN.md. Copying another company's site design is not done.

## Consequences

- The catalog is as fresh as its read date. To refresh it, read each record again and update the row's date.
- Licences differ by checkpoint. The page keeps the note to check the card of the exact file pulled.
