# Phoenix Protocol (self-healing watchdog, ADR-020)

Every 5 minutes Phoenix checks Director 00's data, the memory DB, the web app, Caddy and backup freshness. It restarts
what is down, restores data from the latest Restic snapshot if a restart does not help, tells the Director through a
local webhook, and logs every step to `phoenix_events`.

```powershell
powershell -ExecutionPolicy Bypass -File ops\phoenix\install-task.ps1     # schedule it (per user, every 5 min)
services\director00\director-00.cmd phoenix status                          # latest state per service + recent events
services\director00\director-00.cmd phoenix run                             # one pass now
schtasks /Delete /TN "OMEGA Phoenix" /F                                     # stop scheduling it
```

| Service | Healthy when | If down | If the restart fails |
| --- | --- | --- | --- |
| director | `PRAGMA integrity_check` is `ok` on `director.sqlite` and `checkpoints.sqlite` | (no process) | restore both files from Restic; damaged copies go to `data/quarantine-*` |
| memory_db | Postgres answers on :5435, or the SQLite fallback is intact | `docker compose --profile director up -d memory` | escalate |
| web | `http://127.0.0.1:3100/api/health` returns 200 | start `next start` on 127.0.0.1:3100 | escalate |
| caddy | HTTPS listener on :8443 | `ops/caddy/start-https.ps1` | escalate |
| backup | newest Restic snapshot is younger than 26 h | take a snapshot of `services/director00/data` | escalate |

**Restic.** Binary `OMEGA_PRIME_PROJECT/tools/restic/bin/restic.exe` (0.19.1, SHA-256 checked against the release).
Encrypted repository `OMEGA_PRIME_PROJECT/backups/restic`; `RESTIC_REPOSITORY` and `RESTIC_PASSWORD` live in the
git-ignored `giant-core/.env`. **Keep a copy of that password somewhere safe: without it the backups cannot be read.**
The repository is on the same disk, so copy it off the laptop from time to time.

**Notifications** go only to a local `DIRECTOR_NOTIFY_URL` (an n8n or SwissPipe webhook on 127.0.0.1); any other target
is skipped and logged.
