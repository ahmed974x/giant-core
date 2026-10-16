"""OMEGA Core API, slice 1: read-only service health for the Ops Room.

Run:  uvicorn app.main:app --host 127.0.0.1 --port 8000
Scope: GET only. No auth-dependent or write endpoints exist yet; they come with the auth layer.
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.staticfiles import StaticFiles

from .health import ServicesHealth, check_services

N8N_HEALTH = os.environ.get("OMEGA_CORE_N8N_HEALTH", "http://127.0.0.1:5678/healthz")
NEWTON_HEALTH = os.environ.get("OMEGA_CORE_NEWTON_HEALTH", "http://127.0.0.1:8095/api/health")
PROBE_TIMEOUT_S = float(os.environ.get("OMEGA_CORE_PROBE_TIMEOUT_S", "3"))
# Browser origins allowed to read the API. Same-origin (/ops/) needs none of these.
CORS_ORIGINS = [o.strip() for o in os.environ.get(
    "OMEGA_CORE_CORS_ORIGINS", "http://127.0.0.1:8787,http://localhost:8787").split(",") if o.strip()]
OPS_ROOM_DIR = Path(os.environ.get(
    "OMEGA_CORE_OPS_ROOM_DIR", Path(__file__).resolve().parents[2] / "omega-ops-room-v1"))

app = FastAPI(title="OMEGA Core API", version="0.1.0", docs_url="/docs", redoc_url=None)
# Rejects requests whose Host is not local, which blocks DNS-rebinding pages from reading the API.
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["GET"],
                   allow_headers=[], allow_credentials=False, max_age=600)


@app.get("/api/v1/health")
async def health() -> dict:
    """Liveness of this API itself."""
    return {"ok": True, "service": "omega-core-api", "version": app.version}


@app.get("/api/v1/health/services", response_model=ServicesHealth)
async def services_health() -> ServicesHealth:
    """n8n and Newton health, checked server-side so the browser needs no CORS from them."""
    return await check_services(N8N_HEALTH, NEWTON_HEALTH, PROBE_TIMEOUT_S)


if OPS_ROOM_DIR.is_dir():
    # Same origin as the API, so the Ops Room reads /api/v1/health/services without CORS.
    app.mount("/ops", StaticFiles(directory=OPS_ROOM_DIR, html=False), name="ops")
