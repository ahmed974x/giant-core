"""maritime anomaly tests (pure, no Docker): `python -m pytest services/maritime-agent`."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import anomaly as a


def track(points):
    return [{"ts": ts, "lon": lon, "lat": lat} for ts, lon, lat in points]


def test_haversine_known_distance():
    # Hormuz → Jebel Ali is roughly 130 km
    d = a.haversine_km(56.25, 26.57, 55.03, 24.98)
    assert 150 < d < 260


def test_ais_gap_high_when_vessel_jumps_during_silence():
    t = track([
        ("2026-10-01T00:00:00Z", 56.0, 26.0),
        ("2026-10-01T00:10:00Z", 56.1, 26.0),      # 10 min later, fine
        ("2026-10-01T06:00:00Z", 57.5, 26.0),      # ~6 h silence, then ~150 km away
    ])
    flags = a.ais_gaps(t)
    assert len(flags) == 1 and flags[0]["severity"] == "high"
    assert flags[0]["gap_hours"] > 5 and flags[0]["jump_km"] > 100


def test_ais_gap_watch_when_quiet_but_stationary():
    t = track([("2026-10-01T00:00:00Z", 56.0, 26.0), ("2026-10-01T05:00:00Z", 56.0, 26.0)])
    flags = a.ais_gaps(t)
    assert len(flags) == 1 and flags[0]["severity"] == "watch" and flags[0]["jump_km"] < 1


def test_no_gap_when_pinging_regularly():
    t = track([(f"2026-10-01T0{h}:00:00Z", 56.0 + h * 0.1, 26.0) for h in range(6)])
    assert a.ais_gaps(t) == []


def test_route_deviation_flags_points_off_corridor():
    corridor = [(56.0, 26.0), (58.0, 26.0)]            # due-east line along lat 26
    t = track([("2026-10-01T00:00:00Z", 57.0, 26.0),   # on the line
               ("2026-10-01T01:00:00Z", 57.0, 27.2)])  # ~130 km north → off
    flags = a.route_deviation(t, corridor, max_off_km=50)
    assert len(flags) == 1 and flags[0]["off_km"] > 100


def test_port_congestion_counts_only_dwellers():
    port = (55.0, 25.0)
    waiting = [{"mmsi": i, "track": track([("2026-10-01T00:00:00Z", 55.05, 25.0),
                                           ("2026-10-02T00:00:00Z", 55.06, 25.0)])} for i in range(8)]
    passing = [{"mmsi": 99, "track": track([("2026-10-01T00:00:00Z", 55.05, 25.0),
                                            ("2026-10-01T01:00:00Z", 60.0, 25.0)])}]   # transits away
    res = a.port_congestion(waiting + passing, port, baseline=3)      # 8 / 3 ≈ 2.7x → high
    assert res and res["severity"] == "high" and res["waiting"] == 8 and 99 not in res["waiting_mmsi"]
    assert a.port_congestion(waiting[:6], port, baseline=5)["severity"] == "watch"   # 6 / 5 = 1.2x
    assert a.port_congestion(waiting[:4], port, baseline=5) is None   # below baseline


def test_analyse_vessel_tags_mmsi_and_combines():
    v = {"mmsi": 123, "track": track([("2026-10-01T00:00:00Z", 56.0, 26.0),
                                      ("2026-10-01T07:00:00Z", 57.5, 26.0)])}
    flags = a.analyse_vessel(v, corridor=[(56.0, 26.0), (58.0, 26.0)])
    assert flags and all(f["mmsi"] == 123 and "at" in f for f in flags)
    assert any(f["type"] == "ais_gap" for f in flags)
