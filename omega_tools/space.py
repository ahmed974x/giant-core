"""Skyfield (MIT): SGP4 ground tracks from a CelesTrak TLE (ADR-129).

The Ops Room draws orbits with two-body + J2 motion and says so. With this tool on, the laptop can give the same
satellite's SGP4 track. Only the timescale built into Skyfield is used: no ephemeris or leap-second file is
downloaded, so the call makes no network request.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from .flags import require

MAX_POINTS = 720


def tle_checksum(line: str) -> bool:
    body = line[:68]
    digits = sum(int(c) for c in body if c.isdigit()) + body.count("-")
    return len(line) >= 69 and line[68].isdigit() and digits % 10 == int(line[68])


def check_tle(l1: str, l2: str) -> tuple[str, str]:
    l1, l2 = (str(l1 or "").rstrip(), str(l2 or "").rstrip())
    if not (l1.startswith("1 ") and l2.startswith("2 ") and len(l1) == 69 and len(l2) == 69):
        raise ValueError("give the two 69-character TLE lines as CelesTrak lists them")
    if not (tle_checksum(l1) and tle_checksum(l2)):
        raise ValueError("a TLE line fails its checksum; copy it again from CelesTrak")
    if l1[2:7] != l2[2:7]:
        raise ValueError("the two TLE lines belong to different satellites")
    return l1, l2


def sat_track(tle1: str, tle2: str, name: str = "", start: str | None = None, minutes: int = 90, step_s: int = 60) -> dict:
    """SGP4 sub-satellite points (lat, lon, height) from start for `minutes`, one every `step_s` seconds."""
    require("skyfield")
    from skyfield.api import EarthSatellite, load, wgs84

    l1, l2 = check_tle(tle1, tle2)
    minutes, step_s = int(minutes), int(step_s)
    if not (1 <= minutes <= 1440 and 10 <= step_s <= 3600) or minutes * 60 // step_s > MAX_POINTS:
        raise ValueError(f"choose 1 to 1440 minutes and a step of 10 to 3600 s, at most {MAX_POINTS} points")
    t0 = datetime.fromisoformat(start.replace("Z", "+00:00")) if start else datetime.now(UTC)
    if t0.tzinfo is None:
        t0 = t0.replace(tzinfo=UTC)
    ts = load.timescale(builtin=True)
    sat = EarthSatellite(l1, l2, str(name)[:40] or l2[2:7].strip(), ts)
    times = [t0 + timedelta(seconds=i * step_s) for i in range(minutes * 60 // step_s + 1)]
    t = ts.from_datetimes(times)
    sub = wgs84.subpoint_of(sat.at(t))
    h = wgs84.height_of(sat.at(t)).km
    pts = [
        {"t": tt.isoformat().replace("+00:00", "Z"), "lat": round(float(la), 5), "lon": round(float(lo), 5), "alt_km": round(float(hh), 3)}
        for tt, la, lo, hh in zip(times, sub.latitude.degrees, sub.longitude.degrees, h, strict=True)
    ]
    epoch = sat.epoch.utc_datetime().isoformat().replace("+00:00", "Z")
    return {
        "name": sat.name,
        "norad": l2[2:7].strip(),
        "epoch": epoch,
        "model": "SGP4 (Skyfield 1.55, sgp4)",
        "points": pts,
        "source": "CelesTrak TLE given by the caller",
        "note": "Accuracy falls as the time moves away from the TLE epoch",
    }
