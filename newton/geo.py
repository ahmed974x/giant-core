"""Geodesy on the WGS84 ellipsoid (Vincenty), accurate to millimetres for normal distances."""

from __future__ import annotations

import math

A = 6378137.0  # WGS84 semi-major axis (m)
F = 1 / 298.257223563
B = A * (1 - F)
NM = 1852.0  # metres per nautical mile


def _check(lat: float, lon: float) -> None:
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError(f"invalid coordinate ({lat}, {lon})")


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def inverse(lat1: float, lon1: float, lat2: float, lon2: float) -> dict:
    """Distance (m) and initial/final bearing (deg) between two points."""
    _check(lat1, lon1)
    _check(lat2, lon2)
    if (lat1, lon1) == (lat2, lon2):
        return {"distance_m": 0.0, "initial_bearing": 0.0, "final_bearing": 0.0, "method": "vincenty"}
    L = math.radians(lon2 - lon1)
    U1 = math.atan((1 - F) * math.tan(math.radians(lat1)))
    U2 = math.atan((1 - F) * math.tan(math.radians(lat2)))
    sinU1, cosU1, sinU2, cosU2 = math.sin(U1), math.cos(U1), math.sin(U2), math.cos(U2)
    lam = L
    for _ in range(200):
        sinl, cosl = math.sin(lam), math.cos(lam)
        sin_s = math.hypot(cosU2 * sinl, cosU1 * sinU2 - sinU1 * cosU2 * cosl)
        if sin_s == 0:
            return {"distance_m": 0.0, "initial_bearing": 0.0, "final_bearing": 0.0, "method": "vincenty"}
        cos_s = sinU1 * sinU2 + cosU1 * cosU2 * cosl
        sig = math.atan2(sin_s, cos_s)
        sin_a = cosU1 * cosU2 * sinl / sin_s
        cos2a = 1 - sin_a**2
        cos2sm = cos_s - 2 * sinU1 * sinU2 / cos2a if cos2a else 0.0
        C = F / 16 * cos2a * (4 + F * (4 - 3 * cos2a))
        prev = lam
        lam = L + (1 - C) * F * sin_a * (sig + C * sin_s * (cos2sm + C * cos_s * (-1 + 2 * cos2sm**2)))
        if abs(lam - prev) < 1e-12:
            break
    else:  # near-antipodal: Vincenty does not converge, fall back to a sphere
        d = haversine_m(lat1, lon1, lat2, lon2)
        return {"distance_m": d, "initial_bearing": None, "final_bearing": None, "method": "haversine (antipodal fallback)"}
    u2 = cos2a * (A**2 - B**2) / B**2
    Ak = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)))
    Bk = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)))
    ds = Bk * sin_s * (cos2sm + Bk / 4 * (cos_s * (-1 + 2 * cos2sm**2)
                       - Bk / 6 * cos2sm * (-3 + 4 * sin_s**2) * (-3 + 4 * cos2sm**2)))
    s = B * Ak * (sig - ds)
    b1 = math.degrees(math.atan2(cosU2 * math.sin(lam), cosU1 * sinU2 - sinU1 * cosU2 * math.cos(lam)))
    b2 = math.degrees(math.atan2(cosU1 * math.sin(lam), -sinU1 * cosU2 + cosU1 * sinU2 * math.cos(lam)))
    return {"distance_m": s, "initial_bearing": b1 % 360, "final_bearing": b2 % 360, "method": "vincenty"}


def path_length_m(points: list[tuple[float, float]]) -> float:
    return sum(inverse(*points[i], *points[i + 1])["distance_m"] for i in range(len(points) - 1))
