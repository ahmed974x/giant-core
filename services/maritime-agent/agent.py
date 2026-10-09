"""maritime-agent: one analysis cycle over the local store, producing flags for the Master agent.

    python agent.py                 # read MARITIME_DB_PATH, run every rule, store + print the flags

Cycle: load each vessel's track and expected corridor → anomaly.analyse_vessel (AIS gaps, route deviation)
→ anomaly.port_congestion per port → store new findings in `anomalies` → emit one JSON message.
The message is what Director 00 consumes; today it is printed and appended to data/outbox.jsonl, later it
is published to a Redis Stream (ADR 003) without changing this code's shape.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

import anomaly

import db

OUTBOX = Path(db.DB_PATH).parent / "outbox.jsonl"


def tracks(con: sqlite3.Connection) -> list[dict]:
    rows = con.execute("SELECT mmsi, ts, lon, lat, sog FROM positions ORDER BY mmsi, ts").fetchall()
    out: dict[int, dict] = {}
    for r in rows:
        out.setdefault(r["mmsi"], {"mmsi": r["mmsi"], "track": []})["track"].append(dict(r))
    routes = {r["mmsi"]: r["route"] for r in con.execute("SELECT mmsi, route FROM vessels")}
    for v in out.values():
        v["route"] = routes.get(v["mmsi"])
    return list(out.values())


def run_cycle(con: sqlite3.Connection, max_gap_min: float = 180, max_off_km: float = 50) -> dict:
    corridors = {r["id"]: [tuple(p) for p in json.loads(r["waypoints"])] for r in con.execute("SELECT * FROM corridors")}
    vessels = tracks(con)
    flags = []
    for v in vessels:
        flags += anomaly.analyse_vessel(v, corridors.get(v["route"]), max_gap_min=max_gap_min, max_off_km=max_off_km)
    for p in con.execute("SELECT * FROM ports"):
        c = anomaly.port_congestion(vessels, (p["lon"], p["lat"]), baseline=p["baseline"])
        if c:
            flags.append({**c, "port": p["slug"], "port_name": {"en": p["name_en"], "ar": p["name_ar"]}})

    new = 0
    with con:
        for f in flags:
            cur = con.execute(
                "INSERT OR IGNORE INTO anomalies (type, severity, mmsi, port, reason, detail, at) VALUES (?,?,?,?,?,?,?)",
                (f["type"], f["severity"], f.get("mmsi"), f.get("port"), f["reason"], json.dumps(f, ensure_ascii=False),
                 datetime.now(UTC).isoformat(timespec="seconds")))
            new += cur.rowcount
    by_type: dict[str, int] = {}
    for f in flags:
        by_type[f["type"]] = by_type.get(f["type"], 0) + 1
    return {"agent": "maritime", "at": datetime.now(UTC).isoformat(timespec="seconds"), "source": "local-sqlite",
            "vessels": len(vessels), "flags": flags, "summary": {"total": len(flags), "new": new, "by_type": by_type}}


def emit(message: dict, outbox: Path = OUTBOX) -> None:
    """Hand the cycle's result to the Master agent (outbox file today, Redis Stream later)."""
    outbox.parent.mkdir(parents=True, exist_ok=True)
    with outbox.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(message, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    con = db.connect()
    db.migrate(con)
    msg = run_cycle(con)
    emit(msg)
    print(json.dumps({"vessels": msg["vessels"], **msg["summary"]}, ensure_ascii=False))
    for f in msg["flags"]:
        print(f"  [{f['severity']:5}] {f['type']:16} {f.get('mmsi') or f.get('port')}: {f['reason']}")
