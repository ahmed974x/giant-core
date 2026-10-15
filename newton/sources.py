"""Keyless open data fetchers. Each returns the raw evidence URL alongside the data."""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request

OSRM_URL = os.environ.get("NEWTON_OSRM_URL", "https://router.project-osrm.org")
MARINE_URL = os.environ.get("NEWTON_MARINE_URL", "https://marine-api.open-meteo.com/v1/marine")
UA = {"User-Agent": "omega-newton/1.0 (+https://github.com/ahmed974x/giant-core)"}


def _get_json(url: str, timeout: float = 10) -> dict:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 (fixed https hosts)
        return json.loads(r.read().decode())


def osrm_route(points: list[tuple[float, float]], profile: str = "driving") -> dict:
    """Road route over OpenStreetMap. points are (lat, lon); OSRM wants lon,lat."""
    if profile not in ("driving", "cycling", "walking", "foot", "bike", "car"):
        raise ValueError("profile must be driving, cycling or walking")
    coords = ";".join(f"{lon:.6f},{lat:.6f}" for lat, lon in points)
    url = f"{OSRM_URL}/route/v1/{profile}/{coords}?overview=false&alternatives=false"
    data = _get_json(url)
    if data.get("code") != "Ok" or not data.get("routes"):
        raise RuntimeError(f"OSRM: {data.get('code')} {data.get('message', '')}".strip())
    r = data["routes"][0]
    return {"distance_m": r["distance"], "duration_s": r["duration"], "source_url": url}


def ocean_current(lat: float, lon: float) -> dict:
    """Surface ocean current now at a point (Open-Meteo marine, keyless)."""
    q = urllib.parse.urlencode({
        "latitude": f"{lat:.4f}", "longitude": f"{lon:.4f}",
        "current": "ocean_current_velocity,ocean_current_direction",
        "velocity_unit": "kn",
    })
    url = f"{MARINE_URL}?{q}"
    cur = _get_json(url).get("current") or {}
    v, d = cur.get("ocean_current_velocity"), cur.get("ocean_current_direction")
    if v is None or d is None:
        raise RuntimeError("no ocean current data at this point")
    # Open-Meteo direction is where the current flows TOWARDS (oceanographic convention).
    return {"speed_kn": float(v), "towards_deg": float(d), "time": cur.get("time"), "source_url": url}
