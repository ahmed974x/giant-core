# OMEGA Core API · slice 1: services health

The first, read-only slice of the OMEGA Core API. It checks n8n and Newton from the server side, so the Ops Room can read their health without either of them sending CORS headers. Nothing else from the API Core plan is built yet: no auth, no database, no write endpoints.

أول جزء من OMEGA Core API، وهو للقراءة فقط. يفحص n8n ونيوتن من جهة الخادم، فغرفة العمليات تقدر تقرأ حالتهم بدون ما نعدّل نيوتن.

## Endpoints

| Method | Path | What it returns |
|---|---|---|
| GET | `/api/v1/health` | `{"ok": true}`: the API itself is up |
| GET | `/api/v1/health/services` | n8n + Newton status, latency, reason, Newton tools, and `newton_gate` (`open` only when Newton returns `"ok": true`) |
| GET | `/ops/omega-ops-room.html` | the Ops Room, served on the same origin as the API |
| GET | `/docs` | OpenAPI page |

Statuses: `online`, `degraded` (answered, but not a healthy reply), `offline` (with `reason`: `unreachable`, `timeout`, `http_<code>`). Upstream bodies are never echoed back.

## Run (Windows PowerShell) · التشغيل

```powershell
cd <repo>\omega-core-api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Check: `curl.exe http://127.0.0.1:8000/api/v1/health/services`
Ops Room through the API: http://127.0.0.1:8000/ops/omega-ops-room.html (n8n and Newton tags then read `VIA CORE`).

Tests: `pip install -r requirements-dev.txt` then `python -m pytest -q`.

## Settings (env)

| Variable | Default |
|---|---|
| `OMEGA_CORE_N8N_HEALTH` | `http://127.0.0.1:5678/healthz` |
| `OMEGA_CORE_NEWTON_HEALTH` | `http://127.0.0.1:8095/api/health` |
| `OMEGA_CORE_PROBE_TIMEOUT_S` | `3` |
| `OMEGA_CORE_CORS_ORIGINS` | `http://127.0.0.1:8787,http://localhost:8787` |
| `OMEGA_CORE_OPS_ROOM_DIR` | `../omega-ops-room-v1` |

## Security

- Binds to `127.0.0.1` only. Requests whose `Host` is not `127.0.0.1` or `localhost` get 400, which blocks DNS-rebinding pages.
- GET only. POST and other methods get 405.
- CORS allows only the listed local origins, with no credentials.
- Health probes ignore system proxy settings and never follow redirects.
