# OMEGA PRIME Handover

## Repository
- giant-core: https://github.com/ahmed974x/giant-core (holds the full OMEGA stack)
- Design doc: https://claude.ai/code/artifact/870eae83-28e3-4fd4-a64a-687242478826

## Open pull requests
| PR | Scope | Notes |
|----|-------|-------|
| #4 | Sentinel MCP | Independent of the others |
| #1 | Unified stack | TimescaleDB, PostgREST, n8n, relay + dashboard on 127.0.0.1:8088 |
| #2 | Cortex LLM gateway + Ollama | Default model is ~2GB |
| #7 | db-migrate | Fix also contained in #6 |
| #6 | Whale Watch | Includes #7's fix |

## Merge order
1. #4
2. #1
3. #2
4. #7 together with #6

## Local integration rules
- PR branches are merged into a local `integration` branch with normal (non-squash, non-rebase) merges.
- Nothing is pushed to `main` and nothing is merged on GitHub without the owner's explicit go.
- `.env` is created from `.env.example`, stays local, and is never committed. Secrets are never requested in chat.
- Bring-up: `docker compose up -d --build`, then check `docker ps` and logs.

## Local machine status (2026-10-08)
- Git 2.55 installed via winget; repo cloned to `Desktop\OMEGA_PRIME_PROJECT\giant-core`.
- Local `integration` branch = main + #4, #1, #2, #7, #6 (all merged cleanly, `--no-ff`). Not pushed.
- `.env` created from `.env.example`; the 7 internal secrets were generated locally (32-byte random hex).
  Provider API keys and Telegram are left empty, so Cortex falls back to the local Ollama model.
- `docker compose config` validates (9 services: timescale, db-migrate, postgrest, cortex, n8n-init, relay, n8n, ollama, ollama-pull).
- Blocker: Docker Desktop is installed, but its Linux engine cannot start because WSL, Virtual Machine
  Platform and Hyper-V are disabled. Fix as admin: `wsl --install`, reboot, open Docker Desktop, then
  `docker compose up -d --build` from this folder.
