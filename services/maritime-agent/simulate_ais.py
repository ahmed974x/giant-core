"""Realistic mock AIS for local development: ships sailing real corridors, pinging every 5–10 minutes,
with known scenarios injected so the anomaly engine has something true to find.

    python simulate_ais.py                 # 24 h, 30 ships, scenarios on, into MARITIME_DB_PATH
    python simulate_ais.py --ships 60 --hours 48 --seed 7 --no-scenarios
    python simulate_ais.py --json out.json # write tracks to a file instead of the DB

Injected scenarios (each is labeled, so tests can check the engine catches exactly these):
  - dark ship        : transponder silent for ~6 h, then reappears ~150 km further on
  - route deviation  : a ship leaves its corridor by ~120 km mid-voyage
  - port congestion  : 12 ships loitering off Jebel Ali for a day (baseline 5)
All vessels and identifiers are synthetic (MMSI range 900000000+, never a real ship).
"""

from __future__ import annotations

import argparse
import json
import math
import random
from datetime import UTC, datetime, timedelta

import db

SHIP_TYPES = ["tanker", "container", "bulk", "lng", "general"]
FLAGS = ["PA", "LR", "MH", "SG", "MT", "BS", "AE", "SA"]
SYNTH_MMSI = 900_000_000                                   # outside real MMSI ranges


def _interp(a, b, f):
    return a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f


def _along(waypoints, f):
    """Point at fraction f (0..1) along a polyline, by segment length."""
    segs = [math_dist(waypoints[i], waypoints[i + 1]) for i in range(len(waypoints) - 1)]
    target = f * sum(segs)
    for i, seg in enumerate(segs):
        if target <= seg or i == len(segs) - 1:
            return _interp(waypoints[i], waypoints[i + 1], min(1.0, target / seg if seg else 0))
        target -= seg
    return waypoints[-1]


def math_dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _ship(rng, i, route):
    return {"mmsi": SYNTH_MMSI + i, "name": f"OMEGA SIM {i:03d}", "ship_type": rng.choice(SHIP_TYPES),
            "flag": rng.choice(FLAGS), "route": route}


def simulate(ships: int = 30, hours: int = 24, seed: int = 42, scenarios: bool = True,
             start: datetime | None = None) -> dict:
    """Return {vessels, positions, scenarios} — scenarios lists the injected truths with their MMSI."""
    rng = random.Random(seed)
    start = start or datetime(2026, 10, 1, tzinfo=UTC)
    corridors = {c[0]: c[3] for c in db.CORRIDORS}
    vessels, positions, truth = [], [], []

    for i in range(ships):
        route = rng.choice(list(corridors))
        v = _ship(rng, i, route)
        vessels.append(v)
        wp, t = corridors[route], start + timedelta(minutes=rng.randint(0, 60))
        f0, speed = rng.uniform(0, 0.3), rng.uniform(0.02, 0.04)   # fraction of route per hour
        while t < start + timedelta(hours=hours):
            f = min(1.0, f0 + speed * (t - start).total_seconds() / 3600)
            lon, lat = _along(wp, f)
            positions.append({"mmsi": v["mmsi"], "ts": t.isoformat().replace("+00:00", "Z"),
                              "lon": round(lon + rng.gauss(0, 0.01), 5), "lat": round(lat + rng.gauss(0, 0.01), 5),
                              "sog": round(rng.uniform(10, 16), 1), "cog": round(rng.uniform(0, 359), 0)})
            t += timedelta(minutes=rng.randint(5, 10))

    if scenarios and vessels:
        # 1) dark ship: silence from hour 6 to 12, jumping ahead along a Hormuz route
        dark = vessels[0]
        dark["route"] = "hormuz-jebelali"
        positions = [p for p in positions if p["mmsi"] != dark["mmsi"]]
        for h, (lon, lat) in [(0, (56.6, 26.4)), (1, (56.5, 26.35)), (2, (56.4, 26.3)),
                              (8, (55.5, 25.4)), (9, (55.4, 25.3))]:   # 6 h gap, ~120+ km jump
            positions.append({"mmsi": dark["mmsi"], "ts": (start + timedelta(hours=h)).isoformat().replace("+00:00", "Z"),
                              "lon": lon, "lat": lat, "sog": 12.0, "cog": 230.0})
        truth.append({"scenario": "dark_ship", "mmsi": dark["mmsi"]})

        # 2) route deviation: Red Sea ship swings ~1.1° (~120 km) off its corridor mid-voyage
        dev = vessels[1]
        dev["route"] = "redsea-suez"
        positions = [p for p in positions if p["mmsi"] != dev["mmsi"]]
        for h in range(0, 12):
            lon, lat = _along(corridors["redsea-suez"], h / 24)
            if 5 <= h <= 7:
                lon += 1.1
            positions.append({"mmsi": dev["mmsi"], "ts": (start + timedelta(hours=h)).isoformat().replace("+00:00", "Z"),
                              "lon": round(lon, 5), "lat": round(lat, 5), "sog": 13.0, "cog": 330.0})
        truth.append({"scenario": "route_deviation", "mmsi": dev["mmsi"]})

        # 3) port congestion: 12 extra ships anchored off Jebel Ali for 24 h
        base = len(vessels)
        for k in range(12):
            v = _ship(rng, base + k, "hormuz-jebelali")
            vessels.append(v)
            for h in range(0, 25, 2):
                positions.append({"mmsi": v["mmsi"], "ts": (start + timedelta(hours=h)).isoformat().replace("+00:00", "Z"),
                                  "lon": round(55.12 + rng.uniform(-0.05, 0.05), 5), "lat": round(25.05 + rng.uniform(-0.05, 0.05), 5),
                                  "sog": 0.2, "cog": 0.0})
        truth.append({"scenario": "port_congestion", "port": "jebel-ali", "vessels": 12})

    return {"vessels": vessels, "positions": positions, "scenarios": truth}


def load(con, sim: dict) -> int:
    """Insert a simulation into the store (idempotent on (mmsi, ts))."""
    with con:
        con.executemany("INSERT OR REPLACE INTO vessels (mmsi, name, ship_type, flag, route) VALUES (:mmsi,:name,:ship_type,:flag,:route)",
                        sim["vessels"])
        con.executemany("INSERT OR IGNORE INTO positions (mmsi, ts, lon, lat, sog, cog) VALUES (:mmsi,:ts,:lon,:lat,:sog,:cog)",
                        sim["positions"])
    return len(sim["positions"])


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--ships", type=int, default=30)
    ap.add_argument("--hours", type=int, default=24)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--no-scenarios", action="store_true")
    ap.add_argument("--json", help="write to this file instead of the database")
    a = ap.parse_args()
    sim = simulate(a.ships, a.hours, a.seed, not a.no_scenarios)
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(sim, f)
        print(f"wrote {len(sim['positions'])} positions for {len(sim['vessels'])} vessels to {a.json}")
        return
    con = db.connect()
    db.migrate(con)
    n = load(con, sim)
    print(json.dumps({"db": db.DB_PATH, "vessels": len(sim["vessels"]), "positions": n, "scenarios": sim["scenarios"]}))


if __name__ == "__main__":
    main()
