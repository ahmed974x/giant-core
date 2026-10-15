"""Arrival-time calculators. Every result lists inputs, formula, assumptions and evidence URLs."""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

from . import geo, sources


def _when(start: str | None, seconds: float) -> dict:
    t0 = datetime.fromisoformat(start.replace("Z", "+00:00")) if start else datetime.now(timezone.utc)
    if t0.tzinfo is None:
        t0 = t0.replace(tzinfo=timezone.utc)
    return {"depart_utc": t0.isoformat(timespec="seconds"),
            "arrive_utc": (t0 + timedelta(seconds=seconds)).isoformat(timespec="seconds")}


def _hms(seconds: float) -> str:
    s = int(round(seconds))
    d, s = divmod(s, 86400)
    h, s = divmod(s, 3600)
    m, s = divmod(s, 60)
    return (f"{d}d " if d else "") + f"{h:02d}:{m:02d}:{s:02d}"


def ground_speed_kn(stw_kn: float, course_deg: float, cur_kn: float, cur_towards_deg: float) -> float:
    """Speed made good along `course` when steering through a current (vector triangle)."""
    rel = math.radians(cur_towards_deg - course_deg)
    along, cross = cur_kn * math.cos(rel), cur_kn * math.sin(rel)
    if abs(cross) >= stw_kn:
        raise ValueError("current is stronger than the ship's speed across the course")
    return math.sqrt(stw_kn**2 - cross**2) + along


def ship_eta(lat: float, lon: float, dest_lat: float, dest_lon: float, speed_kn: float,
             waypoints: list[tuple[float, float]] | None = None, speed_is_sog: bool = True,
             use_currents: bool = False, depart_utc: str | None = None,
             fetch_current=sources.ocean_current) -> dict:
    """ETA for a vessel. speed_kn is AIS SOG (already includes current) unless speed_is_sog=False."""
    if speed_kn <= 0:
        raise ValueError("ship is not moving (speed <= 0); no ETA")
    pts = [(lat, lon), *(waypoints or []), (dest_lat, dest_lon)]
    legs = [geo.inverse(*pts[i], *pts[i + 1]) for i in range(len(pts) - 1)]
    dist_m = sum(l["distance_m"] for l in legs)
    dist_nm = dist_m / geo.NM
    out = {
        "inputs": {"from": [lat, lon], "to": [dest_lat, dest_lon], "waypoints": waypoints or [],
                   "speed_kn": speed_kn, "speed_is_sog": speed_is_sog},
        "distance_nm": round(dist_nm, 3), "distance_km": round(dist_m / 1000, 3),
        "initial_course_deg": legs[0]["initial_bearing"],
        "geodesy": "WGS84 ellipsoid, Vincenty inverse per leg",
        "evidence": [],
        "assumptions": [
            "Straight geodesic legs between the points given; real sea lanes avoid land and are longer. "
            "Pass waypoints for a channel/strait route.",
        ],
    }
    speed = speed_kn
    formula = "t = distance_nm / speed_kn"
    if use_currents:
        try:
            c = fetch_current(lat, lon)
            out["current"] = c
            out["evidence"].append(c["source_url"])
            if not speed_is_sog:
                speed = ground_speed_kn(speed_kn, legs[0]["initial_bearing"] or 0, c["speed_kn"], c["towards_deg"])
                formula = "SMG = sqrt(STW^2 - c_cross^2) + c_along ; t = distance_nm / SMG"
            else:
                out["assumptions"].append("AIS SOG already includes current; current shown for context only.")
        except Exception as e:  # current data is optional: keep the ETA, say what is missing
            out["current_error"] = str(e)
    else:
        if not speed_is_sog:
            out["assumptions"].append("No current correction (speed through water used as ground speed).")
    out["assumptions"].append("Constant speed for the whole passage.")
    hours = dist_nm / speed
    out.update({"speed_used_kn": round(speed, 3), "formula": formula,
                "duration_h": round(hours, 4), "duration": _hms(hours * 3600), **_when(depart_utc, hours * 3600)})
    # Sensitivity: what +-1 kn does to the arrival (helps judge how firm the ETA is).
    out["sensitivity"] = {f"{d:+d}kn": _hms(dist_nm / (speed + d) * 3600) for d in (-1, 1) if speed + d > 0}
    return out


def road_eta(lat: float, lon: float, dest_lat: float, dest_lon: float, profile: str = "driving",
             waypoints: list[tuple[float, float]] | None = None, depart_utc: str | None = None,
             traffic_factor: float = 1.0, route=sources.osrm_route) -> dict:
    """Road ETA over OpenStreetMap (OSRM). traffic_factor scales free-flow time (1.0 = empty roads)."""
    if traffic_factor < 1.0 or traffic_factor > 5:
        raise ValueError("traffic_factor must be between 1.0 and 5")
    pts = [(lat, lon), *(waypoints or []), (dest_lat, dest_lon)]
    r = route(pts, profile)
    secs = r["duration_s"] * traffic_factor
    straight = geo.path_length_m([pts[0], pts[-1]])
    return {
        "inputs": {"from": [lat, lon], "to": [dest_lat, dest_lon], "waypoints": waypoints or [],
                   "profile": profile, "traffic_factor": traffic_factor},
        "road_distance_km": round(r["distance_m"] / 1000, 3),
        "straight_line_km": round(straight / 1000, 3),
        "free_flow_duration": _hms(r["duration_s"]),
        "duration": _hms(secs), "duration_min": round(secs / 60, 2),
        "avg_speed_kmh": round(r["distance_m"] / 1000 / (secs / 3600), 1) if secs else None,
        "formula": "t = OSRM free-flow time (sum of road segment length / speed limit profile) x traffic_factor",
        "assumptions": ["OSRM uses OpenStreetMap speed profiles, not live traffic. Raise traffic_factor at rush hour."],
        "evidence": [r["source_url"]],
        **_when(depart_utc, secs),
    }
