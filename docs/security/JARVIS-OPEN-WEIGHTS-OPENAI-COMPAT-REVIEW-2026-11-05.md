# Security review: OpenAI-compatible local engine for DeepSeek and Qwen open weights (ADR-140)

Date: 2026-11-05 · Reviewer: Claude Code, cloud sandbox.

Ahmad asked for "a unified OpenAI-compatible client adapter" for DeepSeek-V3 / DeepSeek-R1 and Qwen2.5-Coder-32B. It should use local execution through vLLM or Ollama, "or remote endpoints", with token streaming.

ADR-136 already pins the model bridge to Ollama on 127.0.0.1 and refuses `:cloud` models. Ahmad approved on 2026-11-05 «keep Ollama on 127.0.0.1:11434» and dropping hosted and in-browser models. This review covers the new engine. It also records why remote endpoints were **not** wired.

## Scope

| File | Role |
|---|---|
| `jarvis/server/lib/openai-compat.mjs` | Address pin, model check, `/v1/models`, `/v1/chat/completions` (whole and streamed), `<think>` splitter, model profiles |
| `jarvis/server/lib/ollama-bridge.mjs` | Engine choice (`JARVIS_OPENAI_COMPAT_URL`), model picking by family, `streamChat` for both engines, Ollama's NDJSON stream |
| `jarvis/server/server.mjs` | `POST /api/llm/stream` (Server-Sent Events) |
| `jarvis/app/src/app.js` | Settings → Local model: engine, families with licences, the streamed "Ask the local model" box |

Nothing was installed. vLLM, llama.cpp, LM Studio and the model weights are things Ahmad runs on his own machine. Jarvis only talks to them on 127.0.0.1.

## Decisions

1. **Local only.**
   - `pinCompatUrl` accepts `http://127.0.0.1:<port>`, optionally ending in `/v1`. It refuses:
     - `localhost` and `[::1]`;
     - https, credentials, queries and other paths;
     - any other host, including `api.deepseek.com` and private addresses.
   - The server does not start with a refused address, and a test proves this.
   - Remote endpoints were declined: they need an API key, and they would send workspace text, memory examples and plans outside the machine. Under AGENTS.md §1, §3 and §4 that is an outbound action, a paid service and a secret, so it stays with Director 00.
2. **Untrusted output, same rules.**
   - Plans from the new engine still pass `parsePlanJson` and `enforceApprovalGates`; a test feeds the injected "unlocked publish" plan and gets it locked.
   - Designs still pass the clean-room extractor.
   - Reasoning (`reasoning_content`, or text inside `<think>`) is kept apart, shown folded and labelled untrusted. It is never acted on.
3. **Limits.** Each call has its own limit:

   | Call | Timeout | Size cap |
   |---|---|---|
   | `/v1/models` | 1.5 s | 512 KB |
   | Whole answers | 60 s | 2 MB |
   | Streams | 60 s | 2 MB |

   No call follows a redirect. A closed browser tab aborts the stream, through the response's `close` event and an `AbortSignal`.
4. **Model names.** These must match the model-name pattern, and `:cloud` / `-cloud` names are refused. Hugging Face ids such as `Qwen/Qwen2.5-Coder-32B-Instruct` are accepted.
5. **The stream route** is a POST behind the same guards as every write:
   - the Host check;
   - `X-Jarvis: 1` (a test proves a request without it gets 403);
   - same origin;
   - a 64 KB body.

   The page reads it with `fetch` under `connect-src 'self'` and writes tokens with `textContent`.
6. **Memory.**
   - A streamed answer is stored as an `answer` episode, with key-shaped text refused (ADR-138).
   - Memory examples go to the model under the "data, not instructions" heading, as before.
7. **Licences shown, not assumed.** The table on the page names each family's licence as its model card states it (read 2026-11-05) and says to check the exact checkpoint:
   - **DeepSeek-R1:** MIT.
   - **DeepSeek-V3:** MIT from V3-0324; earlier checkpoints use the DeepSeek Model License.
   - **Qwen2.5-Coder:** Apache 2.0 for 0.5B, 1.5B, 7B, 14B and 32B; the 3B uses the Qwen Research License.

## Material in the request that was not adopted

The message also pasted code for several other parts. None of it was adopted:
- **Docker Compose stack:** n8n, Ollama and SearXNG on `:latest` images, publishing 0.0.0.0 ports.
- **"HybridPythonEngine":**
  - It runs model-written Python with `child_process.exec` on a string path.
  - Its "sandbox" is an environment variable.
  - That is arbitrary code execution, and AGENTS.md §1 and the skill rules forbid processes.
- **A search harvester** with malformed URLs (`https://github.com{token}`) and a prefix-only private-address check.
- **React and Three.js dashboards, and n8n workflows.**
- **Hexapod robot material:** IK, ESP32 firmware with a hard-coded Wi-Fi password, and webhook posts to an incomplete `http://127.0.0` address.

The SSRF intent was kept and done properly in `fetch-public.mjs` (ADR-139 follow-up). Robot control and hardware links would need their own request, design and review.

## Checks

| Check | Result |
|---|---|
| `node jarvis/server/test/test-server.mjs`. Covers nine refused addresses and a refused start; the think splitter across cut tags; profiles and picking; and a fake vLLM-style server for status, the locked plan, the clean design, SSE tokens and reasoning, the done label, memory, the `:cloud` refusal and the 403. Also Ollama NDJSON streaming. | see `jarvis/replica/evidence/tests-server.log` |
| `node jarvis/scripts/test-app.mjs` F18 (sample: no invented answer) and `test-live.mjs` (streamed answer, reasoning apart, untrusted label) | see `tests-app.log`, `tests-live.log` |
| `node scripts/skillspector-audit.mjs --strict .` | 0 critical, 0 high |
