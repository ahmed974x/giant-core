import math

import pytest

from newton import calc, eta, geo


def test_vincenty_known_distance():
    # Flinders Peak -> Buninyong, the classic Vincenty test case: 54972.271 m
    r = geo.inverse(-37.95103341666667, 144.42486788888888, -37.65282113888889, 143.92649552777777)
    assert abs(r["distance_m"] - 54972.271) < 0.01
    assert abs(r["initial_bearing"] - 306.86815920) < 1e-5


def test_calc_exact_and_sandbox():
    assert calc.evaluate("integrate(sin(x)^2, (x, 0, pi))")["exact"] == "pi/2"
    assert calc.evaluate("sqrt(2)", digits=20)["decimal"].startswith("1.4142135623730950488")
    for bad in ("__import__('os')", "x.__class__", "open('a')", "(1).real"):
        with pytest.raises(Exception):
            calc.evaluate(bad)


def test_solve_and_kinematics():
    assert calc.solve("x^2 - 5x + 6 = 0", "x")["solutions"] == ["2", "3"]
    # 0 -> 100 km/h (27.78 m/s) at 3 m/s^2
    k = calc.kinematics(u=0, v=27.7778, a=3)
    assert abs(k["solutions"][0]["t"] - 9.25927) < 1e-3


def test_ship_eta_constant_speed():
    r = eta.ship_eta(29.0, 48.5, 29.0, 49.5, speed_kn=12, depart_utc="2026-10-11T00:00:00Z")
    expected_h = r["distance_nm"] / 12
    assert abs(r["duration_h"] - expected_h) < 1e-3
    assert r["arrive_utc"].startswith("2026-10-11T04")


def test_ship_eta_with_current_through_water():
    fake = lambda lat, lon: {"speed_kn": 2.0, "towards_deg": 90.0, "time": "t", "source_url": "u"}
    # heading ~east with a 2 kn following current: SMG = 12
    r = eta.ship_eta(0.0, 0.0, 0.0, 1.0, 10, speed_is_sog=False, use_currents=True, fetch_current=fake)
    assert abs(r["speed_used_kn"] - 12) < 1e-6
    assert "u" in r["evidence"]


def test_ground_speed_cross_current():
    assert math.isclose(eta.ground_speed_kn(10, 0, 6, 90), 8.0)


def test_road_eta_uses_router_and_traffic():
    fake = lambda pts, profile: {"distance_m": 30000, "duration_s": 1800, "source_url": "osrm"}
    r = eta.road_eta(29.37, 47.97, 29.08, 48.08, traffic_factor=1.5, depart_utc="2026-10-11T08:00:00Z", route=fake)
    assert r["duration_min"] == 45
    assert r["arrive_utc"] == "2026-10-11T08:45:00+00:00"


def test_stopped_ship_has_no_eta():
    with pytest.raises(ValueError):
        eta.ship_eta(0, 0, 1, 1, 0)
