# ADR-063: Core API slice 1, server-side health for n8n and Newton

Date: 2026-10-15 · Status: accepted (Ahmad chose "API Core" over a Newton CORS patch)
Number: 063 follows ADR-062 (Newton). Renumber on merge if another branch has taken it.

## Context
The Ops Room v1 reads health straight from the browser. Newton's `http_api.py` and n8n `/healthz` send no CORS headers, so the browser cannot read their replies, and the Newton gate stays closed even when Newton is healthy.

## Decision
Build the first slice of the OMEGA Core API: one read-only FastAPI endpoint, `GET /api/v1/health/services`, on `127.0.0.1:8000`. It probes both services server-side and returns a validated summary. The Ops Room asks the Core API first and falls back to probing directly when the API is not running. The API also serves the Ops Room at `/ops/`, so it can be read on the same origin.

## Consequences
- Newton's branch stays untouched.
- No auth yet, so the API has no write paths. Auth (JWT/API keys), SQLite audit log and Newton task contracts come in later slices, each behind Ahmad's go.
- One more process to run on the laptop (`uvicorn`, ~40 MB).
