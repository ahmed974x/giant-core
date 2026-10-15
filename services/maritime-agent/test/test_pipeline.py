"""End to end on mock data: simulate → SQLite → agent cycle. The engine must catch every injected
scenario and nothing it shouldn't on normal traffic."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import agent
import simulate_ais as sim

import db


def run(scenarios=True, ships=30, seed=42):
    con = db.connect(":memory:")
    db.migrate(con)
    s = sim.simulate(ships=ships, hours=24, seed=seed, scenarios=scenarios)
    sim.load(con, s)
    return con, s, agent.run_cycle(con)


def test_migrations_are_tracked_and_idempotent():
    con = db.connect(":memory:")
    assert db.migrate(con) == ["001_init.sql"]
    assert db.migrate(con) == []                                   # second run applies nothing
    assert con.execute("SELECT count(*) FROM ports").fetchone()[0] == len(db.PORTS)
    assert con.execute("SELECT count(*) FROM corridors").fetchone()[0] == len(db.CORRIDORS)


def test_simulator_is_deterministic_and_synthetic():
    a, b = sim.simulate(seed=7), sim.simulate(seed=7)
    assert a["positions"] == b["positions"]
    assert all(v["mmsi"] >= sim.SYNTH_MMSI for v in a["vessels"])     # never a real ship
    assert all(-180 <= p["lon"] <= 180 and -90 <= p["lat"] <= 90 for p in a["positions"])


def test_engine_finds_every_injected_scenario():
    _, s, msg = run()
    truth = {t["scenario"]: t for t in s["scenarios"]}
    flags = msg["flags"]
    dark = [f for f in flags if f["type"] == "ais_gap" and f["mmsi"] == truth["dark_ship"]["mmsi"]]
    assert dark and dark[0]["severity"] == "high"
    dev = [f for f in flags if f["type"] == "route_deviation" and f["mmsi"] == truth["route_deviation"]["mmsi"]]
    assert dev and max(f["off_km"] for f in dev) > 80
    cong = [f for f in flags if f["type"] == "port_congestion" and f.get("port") == "jebel-ali"]
    assert cong and cong[0]["waiting"] >= 12 and cong[0]["port_name"]["ar"] == "ميناء جبل علي"


def test_normal_traffic_has_no_gaps_or_deviations():
    _, _, msg = run(scenarios=False, ships=40, seed=11)
    noisy = [f for f in msg["flags"] if f["type"] in ("ais_gap", "route_deviation")]
    assert noisy == [], noisy[:3]


def test_findings_are_stored_once_and_emitted(tmp_path):
    con, _, first = run()
    second = agent.run_cycle(con)
    assert first["summary"]["new"] > 0 and second["summary"]["new"] == 0   # deduplicated
    out = tmp_path / "outbox.jsonl"
    agent.emit(first, out)
    assert out.read_text(encoding="utf-8").count("\n") == 1
