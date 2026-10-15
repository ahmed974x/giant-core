"""OMEGA maritime anomaly engine: supply-chain signals from public AIS tracks.

Pure functions over plain vessel tracks (lists of {ts, lon, lat, sog?}), so every rule is deterministic
and testable without the stack. The maritime-agent calls these each cycle and forwards any flag to the
Master agent as JSON. Standard library only — no heavy geo deps — so it runs anywhere.

All inputs are public AIS (positions vessels broadcast themselves). The engine detects logistics risk:
  - ais_gaps        : a vessel stops broadcasting for a long stretch ("dark" period) → compliance/insurance signal
  - route_deviation : a vessel strays far from the expected shipping corridor → re-routing / disruption
  - port_congestion : many vessels dwelling off a port → backlog / supply-chain delay
It never identifies people and never tracks defense assets (ADR 006).
"""

from __future__ import annotations

import math
from datetime import datetime

EARTH_KM = 6371.0


def _ts(v) -> float:
    """Seconds since epoch from an ISO string or a number."""
    if isinstance(v, (int, float)):
        return float(v)
    return datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp()


def haversine_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi, dlmb = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * EARTH_KM * math.asin(math.sqrt(a))


def cross_track_km(lon: float, lat: float, a: tuple[float, float], b: tuple[float, float]) -> float:
    """Distance from point (lon,lat) to the great-circle path through a→b (both (lon,lat))."""
    d13 = haversine_km(a[0], a[1], lon, lat) / EARTH_KM
    if d13 == 0:
        return 0.0
    brng13 = _bearing(a, (lon, lat))
    brng12 = _bearing(a, b)
    return abs(math.asin(math.sin(d13) * math.sin(brng13 - brng12)) * EARTH_KM)


def _bearing(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    dlon = lon2 - lon1
    y = math.sin(dlon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return math.atan2(y, x)


def _flag(kind: str, severity: str, reason: str, **extra) -> dict:
    return {"type": kind, "severity": severity, "reason": reason, **extra}


def ais_gaps(track: list[dict], max_gap_min: float = 180, min_jump_km: float = 10) -> list[dict]:
    """Stretches where a vessel went quiet longer than max_gap_min. 'high' when it also jumped position,
    which is the classic signature of a vessel that switched off its transponder underway."""
    out, pts = [], sorted(track, key=lambda p: _ts(p["ts"]))
    for i in range(1, len(pts)):
        gap_min = (_ts(pts[i]["ts"]) - _ts(pts[i - 1]["ts"])) / 60
        if gap_min < max_gap_min:
            continue
        jump = haversine_km(pts[i - 1]["lon"], pts[i - 1]["lat"], pts[i]["lon"], pts[i]["lat"])
        out.append(_flag("ais_gap", "high" if jump >= min_jump_km else "watch",
                         f"No AIS for {gap_min / 60:.1f} h" + (f", then reappeared {jump:.0f} km away" if jump >= min_jump_km else ""),
                         gap_hours=round(gap_min / 60, 2), jump_km=round(jump, 1),
                         from_ts=pts[i - 1]["ts"], to_ts=pts[i]["ts"]))
    return out


def route_deviation(track: list[dict], corridor: list[tuple[float, float]], max_off_km: float = 50) -> list[dict]:
    """Points that stray more than max_off_km from the expected corridor (an ordered list of waypoints)."""
    if len(corridor) < 2:
        return []
    out = []
    for p in track:
        off = min(cross_track_km(p["lon"], p["lat"], corridor[i], corridor[i + 1]) for i in range(len(corridor) - 1))
        if off > max_off_km:
            out.append(_flag("route_deviation", "high" if off > max_off_km * 2 else "watch",
                             f"{off:.0f} km off the expected corridor", off_km=round(off, 1), ts=p["ts"], lon=p["lon"], lat=p["lat"]))
    return out


def port_congestion(vessels: list[dict], port: tuple[float, float], radius_km: float = 40,
                    dwell_hours: float = 12, baseline: int = 5) -> dict | None:
    """Count distinct vessels loitering within radius_km of a port for >= dwell_hours. Congestion level
    is relative to a normal baseline. `vessels` is [{mmsi, track:[...]}]."""
    waiting = []
    for v in vessels:
        pts = [p for p in v.get("track", []) if haversine_km(p["lon"], p["lat"], port[0], port[1]) <= radius_km]
        if len(pts) < 2:
            continue
        span_h = (_ts(pts[-1]["ts"]) - _ts(pts[0]["ts"])) / 3600
        moved = haversine_km(pts[0]["lon"], pts[0]["lat"], pts[-1]["lon"], pts[-1]["lat"])
        if span_h >= dwell_hours and moved <= radius_km:        # present long, not transiting through
            waiting.append(v.get("mmsi"))
    n = len(waiting)
    if n <= baseline:
        return None
    ratio = n / max(1, baseline)
    level = "high" if ratio >= 2 else "watch"
    return _flag("port_congestion", level, f"{n} vessels waiting (~{ratio:.1f}x normal)",
                 waiting=n, baseline=baseline, radius_km=radius_km, dwell_hours=dwell_hours, waiting_mmsi=waiting)


def analyse_vessel(vessel: dict, corridor: list[tuple[float, float]] | None = None, **kw) -> list[dict]:
    """All per-vessel flags for one track, each tagged with the vessel id for the Master agent."""
    track = vessel.get("track", [])
    flags = ais_gaps(track, kw.get("max_gap_min", 180))
    if corridor:
        flags += route_deviation(track, corridor, kw.get("max_off_km", 50))
    mmsi = vessel.get("mmsi")
    for f in flags:
        f["mmsi"] = mmsi
        f["at"] = datetime.now().astimezone().isoformat(timespec="seconds")
    return flags
