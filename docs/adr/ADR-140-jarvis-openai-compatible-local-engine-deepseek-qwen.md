# ADR-140: OpenAI-compatible local engine and streaming for DeepSeek and Qwen open weights

Date: 2026-11-05 · Status: Proposed. Ahmad's message of 2026-11-05 asked to finish ADR-139 with full SSRF shielding, and to add an OpenAI-compatible adapter for DeepSeek-V3 / R1 and Qwen2.5-Coder, run locally through vLLM or Ollama, with token streaming.

## Context

ADR-136 wired Ollama's native API on 127.0.0.1. Its Modelfiles already build the planner on DeepSeek-R1 and the designer on Qwen2.5-Coder. vLLM, llama.cpp and LM Studio serve the same open weights through the OpenAI wire format, and Ollama does too at `/v1`. Jarvis could not use those servers, and every answer arrived in one piece.

## Decision

1. **`jarvis/server/lib/openai-compat.mjs`**
   - `pinCompatUrl`: `http://127.0.0.1:<port>[/v1]` only.
   - `models()` from `/v1/models`, with `:cloud` names dropped.
   - `chat()`.
   - `stream()`, which reads Server-Sent Events, including `reasoning_content`.
   - `thinkSplitter` for inline `<think>` tags cut across pieces.
   - `MODEL_PROFILES` for `deepseek-r1` (plans), `deepseek-v3` (answers) and `qwen2.5-coder` (designs and code), with their licences.
   - `pickModel`: the person's choice, then the Jarvis Modelfiles, then the family for the job.
2. **The bridge** switches engine with `JARVIS_OPENAI_COMPAT_URL` (or the `openaiUrl` start option). Everything after the model is unchanged:
   - `parsePlanJson`, `enforceApprovalGates`, the clean-room extractor;
   - labels, memory examples and fallbacks.

   `streamChat` streams from either engine; Ollama's native stream is NDJSON. Engine names: `ollama-local-loopback` and `openai-compat-loopback` (`isLocalModelEngine`).
3. **`POST /api/llm/stream`** sends `token`, `thinking`, `done` and `error` events. It stops when the tab closes, and it records the answer and its zero-cost usage.
4. **Settings → Local model** shows:
   - the engine;
   - the model for plans, designs and answers;
   - a table of the open-weight families found, with licences;
   - "Ask the local model", with the answer streamed, the reasoning folded, the label `[INFERENCE - local LLM] [UNTRUSTED_MODEL_OUTPUT]`, the time and cost 0.

   Sample mode says a local model is needed and shows nothing invented. Every string has its Arabic line.
5. **Hosted endpoints are not supported.** The reasons are in `docs/security/JARVIS-OPEN-WEIGHTS-OPENAI-COMPAT-REVIEW-2026-11-05.md`.

## Consequences

- Ahmad can serve DeepSeek-R1 distills or Qwen2.5-Coder with vLLM or llama.cpp, or keep Ollama. The full DeepSeek-V3 needs a multi-GPU server; the page says so.
- Answers appear as they are written. Plans and designs still wait for the whole answer, because their locks and layout are decided on the complete text.
- No workspace text leaves 127.0.0.1, and no key is needed.

## Checks

The results are in the PR body. They cover:
- **SkillSpector** on the whole repository;
- **Server tests** on SQLite and PostgreSQL 16;
- **Flow tests:** `test-app.mjs` F18 and `test-live.mjs`;
- **Contrast**;
- **Three sizes** for `#/settings`, sample and live, in English and Arabic;
- **Retina screenshots;**
- **Parity:** 100.0.
