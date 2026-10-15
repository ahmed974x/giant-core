# Remote control from the phone

How Ahmad drives this laptop from his phone, and the extra open-source pieces that can strengthen it.
Everything here is light: no Docker, each MCP server is one short-lived Node or Python process (roughly 40 to 90 MB RAM).

## What already works (no install)

| Route | What it does | Needs |
| --- | --- | --- |
| Claude project thread (Remote Control) | Claude runs shell, git, edits files in `OMEGA_PRIME_PROJECT` on this laptop | Laptop awake, Claude desktop app open |
| Computer use (`mcp__computer-use__*`) | Screenshots, mouse, keyboard in desktop apps | Approve the app-access dialog on the laptop, once per session |
| Built-in browser (`mcp__Claude_Browser__*`) | Opens and reads websites, local dev servers | Nothing |

Computer use deliberately cannot type into terminals/IDEs or click inside browsers; Claude uses its shell and browser tools for those instead.

## Additions

Ahmad approved filesystem + git on 2026-10-09; they are now in `OMEGA_PRIME_PROJECT/.mcp.json` (source block: [`mcp.proposed.json`](mcp.proposed.json)). Both passed an MCP initialize + tools/list smoke test.

| Tool | Why | License | Version checked 2026-10-09 | RAM | Recommendation |
| --- | --- | --- | --- | --- | --- |
| [MCP filesystem server](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem) | Safe file read/write scoped to `OMEGA_PRIME_PROJECT` only; useful for agents without shell access | MIT (repo) | 2026.8.31 | ~50 MB | Enabled |
| [MCP git server](https://github.com/modelcontextprotocol/servers/tree/main/src/git) | Structured git status/diff/log/commit for `giant-core` | MIT | 2026.8.18 | ~60 MB | Enabled |
| [RustDesk](https://github.com/rustdesk/rustdesk) | Ahmad sees and controls the screen himself from the phone, for anything that needs a human (UAC prompts, sign-ins) | AGPL-3.0 | latest stable | ~50 MB idle | Add (manual install by Ahmad) |
| [Desktop Commander MCP](https://github.com/wonderwhy-er/DesktopCommanderMCP) | Terminal + file editing over MCP | MIT | 0.2.52 | ~80 MB | Skip: duplicates Claude's own shell tools |
| [Windows-MCP](https://github.com/CursorTouch/Windows-MCP) | Full Windows UI automation | MIT | 0.8.7 | ~90 MB | Skip: bypasses computer use's per-app approval |

## Enabling

1. Done for filesystem + git: merged the `mcpServers` block from `mcp.proposed.json` into `OMEGA_PRIME_PROJECT/.mcp.json`.
2. Restart the Claude session; the servers start on demand via `npx` / `uvx` (both already installed).
3. RustDesk: Ahmad installs it from the official GitHub release on the laptop and the phone, and sets a permanent password in its own settings. No Windows security settings change.

## Guardrails

- Filesystem server is rooted at the OMEGA folder only, never `C:\`.
- No service listens on the network except RustDesk, which uses its own encrypted relay.
- Windows Defender, UAC and firewall stay as they are.
