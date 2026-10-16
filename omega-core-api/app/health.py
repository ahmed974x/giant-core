"""Read-only health probes for local services (n8n, Newton).

Each probe catches its own failures, so one dead service never breaks the response.
Upstream bodies are parsed and reduced to a few validated fields; nothing raw is echoed back.
"""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import Literal

import httpx
from pydantic import BaseModel, Field

Status = Literal["online", "degraded", "offline"]
MAX_TOOLS = 32


class ServiceHealth(BaseModel):
    name: str
    url: str
    status: Status
    latency_ms: int | None = None
    reason: str | None = Field(default=None, description="Short machine-readable cause when not online")
    tools: list[str] | None = Field(default=None, description="Newton only: tool names from /api/health")


class ServicesHealth(BaseModel):
    checked_at: datetime
    newton_gate: Literal["open", "closed"]
    services: dict[str, ServiceHealth]


async def _get(client: httpx.AsyncClient, name: str, url: str) -> tuple[ServiceHealth | None, httpx.Response | None, int | None]:
    start = time.perf_counter()
    try:
        resp = await client.get(url)
    except httpx.TimeoutException:
        return ServiceHealth(name=name, url=url, status="offline", reason="timeout"), None, None
    except httpx.HTTPError:
        return ServiceHealth(name=name, url=url, status="offline", reason="unreachable"), None, None
    latency = round((time.perf_counter() - start) * 1000)
    if resp.status_code != 200:
        return ServiceHealth(name=name, url=url, status="offline", reason=f"http_{resp.status_code}",
                             latency_ms=latency), None, latency
    return None, resp, latency


def _json(resp: httpx.Response) -> dict | None:
    try:
        data = resp.json()
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


async def probe_n8n(client: httpx.AsyncClient, url: str) -> ServiceHealth:
    failed, resp, latency = await _get(client, "n8n", url)
    if failed:
        return failed
    data = _json(resp)
    ok = data is not None and data.get("status") == "ok"
    return ServiceHealth(name="n8n", url=url, latency_ms=latency,
                         status="online" if ok else "degraded", reason=None if ok else "unexpected_body")


async def probe_newton(client: httpx.AsyncClient, url: str) -> ServiceHealth:
    failed, resp, latency = await _get(client, "newton", url)
    if failed:
        return failed
    data = _json(resp)
    # Strict gate: only a literal JSON true opens it.
    if data is None or data.get("ok") is not True:
        return ServiceHealth(name="newton", url=url, latency_ms=latency,
                             status="degraded", reason="not_ok")
    raw = data.get("tools")
    tools = [t for t in raw if isinstance(t, str) and len(t) <= 64][:MAX_TOOLS] if isinstance(raw, list) else []
    return ServiceHealth(name="newton", url=url, latency_ms=latency,
                         status="online", tools=tools)


async def check_services(n8n_url: str, newton_url: str, timeout_s: float) -> ServicesHealth:
    # trust_env=False: never send local health checks through a system proxy.
    async with httpx.AsyncClient(timeout=timeout_s, follow_redirects=False, trust_env=False) as client:
        n8n, newton = await asyncio.gather(probe_n8n(client, n8n_url), probe_newton(client, newton_url))
    return ServicesHealth(
        checked_at=datetime.now(timezone.utc),
        newton_gate="open" if newton.status == "online" else "closed",
        services={"n8n": n8n, "newton": newton},
    )
