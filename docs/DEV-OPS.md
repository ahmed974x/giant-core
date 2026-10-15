# DEV-OPS: keeping OMEGA running on the laptop

How OMEGA stays up on Ahmad's Windows 11 laptop (7 GB RAM) and how it is reached from the phone.
تشغيل OMEGA على اللابتوب: كيف يبقى شغّالاً، وكيف يرجع بعد إعادة التشغيل، وكيف نصل له من الجوال.

## After a reboot / بعد إعادة التشغيل (ADR-064)

Windows has no systemd, so the same job is split across three Windows mechanisms:

| Layer | What it does | Where |
|---|---|---|
| Docker Desktop autostart | starts the Docker engine when Ahmad signs in | Docker Desktop > Settings > General |
| `restart: unless-stopped` | every long-running container that was running comes back when the engine starts; one stopped by hand stays stopped | `docker-compose.yml` (`x-hardening`) |
| Task "OMEGA Boot" | at sign-in +45 s: waits for Docker, ensures Director Postgres (:5435), starts the web app on 127.0.0.1:3100 if it is down | `ops/autostart/omega-boot.ps1`, log `%LOCALAPPDATA%\OMEGA\boot.log` |
| Task "OMEGA Phoenix" | every 5 min: heals web, Caddy, Postgres, backups (ADR-020) | `scripts/phoenix.py` |

Why not systemd: it only exists on Linux. Why not rely on Docker alone: Docker brings containers back but not
the web app (it runs on the host through dotenvx, ADR-042), and Docker Desktop itself needs a signed-in user.

Why "OMEGA Boot" never runs a full `docker compose up -d`: that would also create n8n, relay, agents and quant
(~1.1 GB) that do not run on this laptop. Opt-in profiles stay opt-in.

السبب: systemd غير موجود في الويندوز. Docker يرجّع الحاويات وحده، لكن الموقع يعمل خارج Docker، و Docker Desktop
نفسه يحتاج تسجيل دخول، لذلك المهمة تعمل عند تسجيل الدخول.

Install once (done 2026-10-15): `powershell -ExecutionPolicy Bypass -File ops\autostart\install-autostart.ps1`

Check:
```powershell
Get-ScheduledTaskInfo -TaskName "OMEGA Boot" | Select LastRunTime, LastTaskResult   # 0 = ok
schtasks /Query /TN "OMEGA Phoenix" /V /FO LIST | Select-String "Last Result"     # 0 = ok
Get-Content "$env:LOCALAPPDATA\OMEGA\boot.log" -Tail 5
docker ps --format "{{.Names}} {{.Status}}"
```

Undo: `Unregister-ScheduledTask -TaskName "OMEGA Boot" -Confirm:$false`, then untick the Docker Desktop setting.

## Phone access / الوصول من الجوال (ADR-063)

Tailscale Serve publishes the web app to the tailnet only (Funnel off). The phone must be signed in to the same
tailnet. A 502 on the ts.net URL means the web app on :3100 is down: Phoenix or "OMEGA Boot" restarts it.

## Memory / الذاكرة

The laptop has ~7 GB. WSL2 is capped at 4 GB (`%UserProfile%\.wslconfig`). Close extra Chrome and Claude windows
before starting an opt-in profile (llm, geo, ml, metrics, photos).
