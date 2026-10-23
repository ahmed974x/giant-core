---
name: local-glm-agent-windows-mcp
description: Use when changing the local model bridge (Ollama on 127.0.0.1, GLM models), the MCP bridge tool that calls it, the launchers OMEGA-PRIME.bat and start-omega.bat, or the Windows-MCP setup. Local, read-only, paper-only; no cloud model and no wider tool list.
---

# Local GLM agent and Windows-MCP (ADR-108, ADR-112)

The Ops Room explains its readings with a model that runs on Ahmad's laptop. The model reads facts and writes text; it has no tool, no key and no path to a wallet or an exchange.

## 1. Model facts (checked 2026-10-23)

- GLM-5.2 is not a local model in Ollama: the library lists it with a `:cloud` tag only, which runs on Ollama's servers. The bridge refuses any name ending in `:cloud` or `-cloud`.
- Local GLM models Ollama offers include `glm4` (9B). Install with `ollama pull glm4`. Re-check the Ollama library before naming any newer GLM as local.
- `OMEGA_OLLAMA_MODEL` picks a model; otherwise the bridge takes the first local name starting with `glm`, then the first local model.

## 2. Proxy routes (`scripts/omega-data-proxy.mjs`)

- `OMEGA_OLLAMA_URL` must be loopback (`127.0.0.1`, `localhost` or `[::1]`); any other address falls back to `http://127.0.0.1:11434`.
- `GET /llm/ollama/status`: running or not, the chosen model and the local list.
- `POST /llm/ollama/explain` with `{facts: [...], question?}`: body at most 16 KB, at most 40 facts, from a loopback socket and an allowed origin only. It calls `/api/generate` with a fixed system prompt (Arabic, paper only, no orders, label every claim [INFERENCE - local LLM]), temperature 0.2, 500 tokens, no streaming.
- ADR-113 hardening: `/llm/*` refuses `Origin: null` and any origin that is not a loopback page, requires `Content-Type: application/json` (forces a CORS preflight), runs one generation at a time (429 for the rest), cuts a body that stalls for 10 s (408) and stops the Ollama call when the page closes the request.
- The whole proxy answers only Host names it knows (127.0.0.1, localhost, [::1], and under `--lan` this machine's addresses and `*.ts.net`, plus `OMEGA_ALLOWED_HOSTS`), which blocks DNS rebinding (421).
- `OMEGA_OLLAMA_MODEL=glm4` matches the listed `glm4:latest`.
- Every other route stays GET-only. `/llm/` is the one POST path.

## 3. MCP bridge (`scripts/omega-mcp-bridge.mjs`)

- Nine tools, all read-only. `explain_with_local_model` sends facts to the proxy route above and returns its text with the label. It writes no file and sends no order.

## 4. Windows-MCP

- Set up only by `scripts/setup-windows-mcp.ps1`: version 0.8.8, stdio, telemetry off, tools Snapshot, Screenshot, Click, Type, Scroll, Move, Shortcut, Wait and WaitFor. No App, PowerShell, Registry, FileSystem, Process or Clipboard tool. Any other setting needs a new security review. Known residual risk (ADR-113 review): Shortcut plus Type can open the Run box and type a command, so the narrow list is not a hard boundary; `uvx` pins the top package only, not its dependencies.
- `OMEGA-PRIME.bat` runs the setup script on first start only when the Claude Desktop config has no `windows-mcp==0.8.8` entry; `start-omega.bat` only reports whether it is configured.

## 5. Launchers

- `OMEGA-PRIME.bat`: clone, or fetch and list the incoming commits and pull only after a Y within 60 s (ADR-113), Windows-MCP check, start the proxy on 127.0.0.1:8796, wait for `/health`, print the Ollama status, run the bridge self-test, open the Ops Room with `?selftest=1`.
- `start-omega.bat [selftest]` and `start-omega.sh`: start the proxy, wait for `/health`, print the Ollama status, open the Ops Room.
- Both bind to 127.0.0.1 unless `--lan` is given, and never print a key.

## 6. Never

- No cloud model, no API key for a model, no paid route.
- The model's text never trains a head, changes a weight, moves paper money or reaches an exchange.

## 7. Checks

`node --check` on the proxy and bridge, `node scripts/test-brain2.mjs` (bridge tool list), and on the laptop `curl http://127.0.0.1:8796/llm/ollama/status`.
