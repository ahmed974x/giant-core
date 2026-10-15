# ADR-064: OMEGA comes back by itself after a reboot (Windows)

Date: 2026-10-15 · Status: Accepted (installed 2026-10-15 with Ahmad's OK)

## Context
Ahmad asked for Docker and the OMEGA services to restart automatically after the laptop reboots, phrased as a
systemd unit. The laptop runs Windows 11, so systemd does not exist here; the equivalents are Docker Desktop's
own sign-in autostart, compose restart policies and Task Scheduler.

Found on 2026-10-15:
- "OMEGA Phoenix" (ADR-020) failed every 5 minutes (Last Result 1). `from_env()` opened the Postgres event log
  on :5435 before healing anything; with Docker down after a reboot that raised `InterfaceError`, so the
  `memory_restart` step that starts Docker was never reached.
- Docker Desktop had `AutoStart: false` and its startup entry was disabled, so the engine never came up.
- Every long-running service in docker-compose.yml already has `restart: unless-stopped` (the `x-hardening`
  anchor). One-shots (`db-migrate`, `n8n-init`, `ollama-pull`) and the opt-in `ollama` keep `restart: "no"` on
  purpose (7 GB laptop).

## Decision
- Phoenix falls back to the SQLite event log when Postgres cannot be reached, so the heal pass runs and starts
  Docker + the `memory` container; the next pass logs to Postgres again.
- `ops/autostart/omega-boot.ps1`: start Docker Desktop if the engine is not answering (wait up to 4 min),
  `docker compose --profile director up -d memory` (every other container that was running returns through its own
  `restart: unless-stopped`; a full `up -d` would also create n8n, relay, agents and quant, ~1.1 GB that never ran
  here, and `compose start` fails on quant's missing relay dependency), then the web app on 127.0.0.1:3100 via secure-run (ADR-042) if
  nothing listens there. It never stops anything. Log: `%LOCALAPPDATA%\OMEGA\boot.log`.
- `ops/autostart/install-autostart.ps1` (run once by Ahmad): turns on Docker Desktop's "start when you sign in",
  re-enables its startup entry, and registers the per-user task "OMEGA Boot" (at sign-in, +45 s, no window).
- Trigger is sign-in, not machine boot: Docker Desktop is a per-user app and cannot start before someone signs in.
- Tailscale and Caddy configuration are unchanged; Caddy keeps being restarted by Phoenix.

## Consequences
- After a reboot and sign-in: Docker, the core stack, Postgres :5435 and the site come back without anyone
  typing a command; Phoenix covers anything that dies later.
- Verified 2026-10-15: Phoenix Last Result 0 after the fix; it started Docker and timescale, postgrest, cortex,
  searxng and memory came back on their own. "OMEGA Boot" ran once by hand (Last Result 0, log clean).
- RAM is the risk: free memory sat between 80 and 470 MB with Chrome and several Claude windows open.
- Undo: `Unregister-ScheduledTask -TaskName "OMEGA Boot"`, untick the Docker Desktop setting.
