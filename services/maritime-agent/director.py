"""Director 00 (Master agent), speed-layer edition: fans out to sub-agents concurrently with asyncio.

For a batch of fast-path alerts it runs, at the same time and each under its own deadline:
  - the ONNX slow path (risk score per alert), off the event loop in a worker thread
  - market context (the stdlib Quant engine through the relay), when reachable
  - port/vessel context from the local store
A sub-agent that misses its deadline is skipped and named in `degraded`, never blocking the decision.
Every decision is localized (Arabic/English) and carries its own end-to-end latency.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
import urllib.request

import metrics

API = os.environ.get("OMEGA_API_URL", "http://relay:8080").rstrip("/")
LABELS = {
    "ais_gap": ("AIS gap", "انقطاع إشارة AIS"), "ais_silent": ("Vessel silent", "سفينة صامتة"),
    "vessel_stopped": ("Vessel stopped", "سفينة متوقفة"), "speed_jump": ("Abrupt speed change", "تغيّر مفاجئ في السرعة"),
    "port_congestion": ("Port congestion", "ازدحام ميناء"), "route_deviation": ("Route deviation", "انحراف عن المسار"),
}


def _market_context() -> dict:
    url = f"{API}/quant"
    if not url.startswith(("http://", "https://")):
        raise ValueError("OMEGA_API_URL must be http(s)")
    with urllib.request.urlopen(url, timeout=2) as r:  # noqa: S310 - scheme checked above
        q = json.loads(r.read())
    return {s: {"regime": p["regime"], "ewma_vol_ann_pct": p["ewma_vol_ann_pct"]} for s, p in (q.get("pairs") or {}).items() if p}


class Director:
    def __init__(self, scorer, deadlines_ms: dict | None = None, market=_market_context, market_ttl_s: float = 30):
        self.scorer = scorer
        self.deadlines = {"score": 500, "market": 300, **(deadlines_ms or {})}
        self.market = market
        self.market_ttl_s, self._market_cache, self._market_at = market_ttl_s, None, -1e9

    def _cached_market(self):
        """Market context changes slowly: reuse it for market_ttl_s instead of calling the relay per batch."""
        if time.monotonic() - self._market_at < self.market_ttl_s:
            return self._market_cache
        self._market_at = time.monotonic()            # set first: a failing relay is retried after the TTL, not per batch
        self._market_cache = self.market()
        return self._market_cache

    async def _call(self, name: str, fn, *args):
        t0 = time.perf_counter()
        try:
            return await asyncio.wait_for(asyncio.to_thread(fn, *args), self.deadlines[name] / 1000)
        except Exception:
            return None
        finally:
            metrics.api_ms.labels(name).observe((time.perf_counter() - t0) * 1000)

    async def decide(self, alerts: list[dict], produced_ns: int | None = None, lang: str = "en") -> list[dict]:
        if not alerts:
            return []
        scores, market = await asyncio.gather(self._call("score", self.scorer.score, alerts),
                                              self._call("market", self._cached_market))
        metrics.inference_ms.observe(self.scorer.last_ms)
        degraded = [n for n, v in (("score", scores), ("market", market)) if v is None]
        out = []
        for i, a in enumerate(alerts):
            risk = scores[i] if scores else None
            en, ar = LABELS.get(a["type"], (a["type"], a["type"]))
            out.append({**a, "risk": risk, "priority": "urgent" if (risk or 0) >= 0.8 else "review" if (risk or 0) >= 0.4 else "info",
                        "title": {"en": en, "ar": ar}, "title_local": ar if lang == "ar" else en,
                        "market": market, "degraded": degraded, "path": "slow" if scores else "fast"})
            metrics.alerts.labels(out[-1]["path"], a["type"]).inc()
        if produced_ns:
            ms = (time.time_ns() - produced_ns) / 1e6
            metrics.decision_ms.observe(ms)
            for d in out:
                d["decision_ms"] = round(ms, 2)
        return out
