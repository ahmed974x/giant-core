"""Speed-layer tests on mock streams (no Docker, no network): bus, Arrow, aisstream parsing, Polars/DuckDB
fast path, ONNX scorer, async Director 00, and the full pipeline with latency bounds."""

import asyncio
import os
import sys
import time
from pathlib import Path

os.environ["OMEGA_API_URL"] = "http://127.0.0.1:9"      # market context: refused at once, never a slow DNS wait
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ais_ws
import bus as busmod
import director
import fakeredis
import fast_path
import onnx_scorer
import pipeline
import pytest
import simulate_ais

PORTS = pipeline.ports()


def rows(**kw):
    return sorted(simulate_ais.simulate(**kw)["positions"], key=lambda p: p["ts"])


def feed(window, rs, batch=200):
    out = []
    for i in range(0, len(rs), batch):
        out += window.ingest(busmod.decode_batch(busmod.encode_batch(rs[i:i + batch])))
    return out


# ── Arrow + bus ──
def test_arrow_roundtrip_keeps_rows_and_types():
    rs = rows(ships=3, hours=2)[:50]
    t = busmod.decode_batch(busmod.encode_batch(rs))
    assert t.num_rows == 50 and t.schema == busmod.SCHEMA
    assert t.column("mmsi").to_pylist() == [r["mmsi"] for r in rs]


@pytest.mark.parametrize("make", ["memory", "redis"])
def test_bus_contract_groups_pending_ack(make):
    async def go():
        b = busmod.InMemoryBus() if make == "memory" else busmod.RedisBus(fakeredis.FakeAsyncRedis())
        await b.ensure_group("s", "g")
        await b.ensure_group("s", "g")                            # idempotent
        for i in range(3):
            await b.xadd("s", {"n": str(i)})
        got = await b.read("s", "g", "c1", count=10, block_ms=50)
        assert [f["n"] for _, f in got] == [b"0", b"1", b"2"]
        assert await b.pending("s", "g") == 3
        assert await b.ack("s", "g", *[m for m, _ in got]) == 3
        assert await b.pending("s", "g") == 0
        assert await b.read("s", "g", "c1", count=10, block_ms=50) == []   # nothing new
        await b.close()
    asyncio.run(go())


def test_get_bus_falls_back_to_memory_without_redis():
    b = asyncio.run(busmod.get_bus("redis://127.0.0.1:1/0"))
    assert b.kind == "memory"


# ── live feed parsing ──
def test_parse_aisstream_position_report():
    msg = {"MessageType": "PositionReport",
           "MetaData": {"MMSI": 538000001, "time_utc": "2026-10-09 11:00:00.123 +0000 UTC", "latitude": 26.5, "longitude": 56.2},
           "Message": {"PositionReport": {"Latitude": 26.5, "Longitude": 56.2, "Sog": 12.3, "Cog": 210.0, "UserID": 538000001}}}
    r = ais_ws.parse_aisstream(msg)
    assert r == {"mmsi": 538000001, "ts": "2026-10-09T11:00:00Z", "lon": 56.2, "lat": 26.5, "sog": 12.3, "cog": 210.0}
    assert ais_ws.parse_aisstream({"MessageType": "ShipStaticData"}) is None
    bad = {**msg, "Message": {"PositionReport": {"Latitude": 99, "Longitude": 56.2}}}
    assert ais_ws.parse_aisstream(bad) is None


# ── fast path ──
def test_fast_path_catches_dark_ship_and_congestion():
    w = fast_path.SlidingWindow(ports=PORTS)
    out = feed(w, rows())
    dark = 900_000_000
    gaps = [a for a in out if a["type"] == "ais_gap" and a["mmsi"] == dark]
    assert len(gaps) == 1 and gaps[0]["severity"] == "high" and gaps[0]["jump_km"] > 100
    assert any(a["type"] == "ais_silent" and a["mmsi"] == dark for a in out)       # caught while still dark
    cong = [a for a in out if a["type"] == "port_congestion" and a["port"] == "jebel-ali"]
    assert len(cong) == 1 and cong[0]["waiting"] >= 12                            # raised once, not every batch
    assert all(a["fast_ms"] < 1000 for a in out)


def test_fast_path_quiet_on_normal_traffic():
    w = fast_path.SlidingWindow(ports=PORTS)
    out = feed(w, rows(ships=40, seed=11, scenarios=False))
    assert [a for a in out if a["type"] in ("ais_gap", "ais_silent", "speed_jump")] == []


def test_stopped_vessel_and_speed_jump():
    w = fast_path.SlidingWindow(stop_s=3600)
    base = "2026-10-01T{h:02d}:{m:02d}:00Z"
    still = [{"mmsi": 7, "ts": base.format(h=h, m=m), "lon": 55.1, "lat": 25.0, "sog": 0.1, "cog": 0}
             for h in range(0, 3) for m in (0, 20, 40)]
    jump = [{"mmsi": 8, "ts": base.format(h=0, m=0), "lon": 56.0, "lat": 26.0, "sog": 2.0, "cog": 0},
            {"mmsi": 8, "ts": base.format(h=0, m=10), "lon": 56.01, "lat": 26.0, "sog": 15.0, "cog": 0}]
    out = feed(w, sorted(still + jump, key=lambda r: r["ts"]), batch=4)
    assert [a["mmsi"] for a in out if a["type"] == "vessel_stopped"] == [7]
    assert [a["mmsi"] for a in out if a["type"] == "speed_jump"] == [8]


# ── ONNX slow path ──
def test_onnx_scorer_ranks_disruption_above_noise():
    s = onnx_scorer.Scorer()
    assert s.device in s.providers and "CPUExecutionProvider" in s.providers
    hi, lo = s.score([{"type": "ais_gap", "gap_h": 6, "jump_km": 135, "severity": "high"},
                      {"type": "ais_gap", "gap_h": 4, "jump_km": 1, "severity": "watch"}])
    assert hi > 0.8 > 0.2 > lo
    assert s.last_ms < 50


def test_onnx_model_file_round_trips(tmp_path):
    p = tmp_path / "risk.onnx"
    a = onnx_scorer.Scorer(str(p))
    assert p.exists() and p.read_bytes()[:2] == b"\x08\x08"                       # ir_version field = 8
    b = onnx_scorer.Scorer(str(p))                                                # loads the saved file
    probe = [{"type": "port_congestion", "severity": "high"}]
    assert a.score(probe) == b.score(probe)


# ── Director 00 ──
def test_director_runs_sub_agents_concurrently_and_degrades_on_deadline():
    def slow_market():
        time.sleep(1.0)
        return {"BTCUSDT": {}}
    boss = director.Director(onnx_scorer.Scorer(), deadlines_ms={"market": 100}, market=slow_market)
    async def timed():
        t0 = time.perf_counter()
        res = await boss.decide([{"type": "ais_gap", "gap_h": 6, "jump_km": 135, "severity": "high", "reason": "x"}],
                                time.time_ns(), lang="ar")
        return res, time.perf_counter() - t0
    out, elapsed = asyncio.run(timed())
    assert elapsed < 0.6                                                          # the decision did not wait for the slow agent
    d = out[0]
    assert d["degraded"] == ["market"] and d["risk"] > 0.8 and d["priority"] == "urgent"
    assert d["title_local"] == "انقطاع إشارة AIS" and d["decision_ms"] >= 0


# ── whole pipeline ──
def test_pipeline_end_to_end_is_sub_second():
    res = asyncio.run(pipeline.run(seconds=60, replay=True, metrics_port=None, lang="en"))
    assert res["bus"] == "memory" and res["batches"] == 28
    types = res["by_type"]
    assert types.get("ais_gap", 0) >= 1 and types.get("port_congestion", 0) >= 1
    lat = res["latency_ms"]
    assert lat["fast_alert_ms"]["p50"] < 1000 and lat["fast"]["p95"] < 500       # fast path: well under a second
    assert lat["decision"]["p95"] < 2000
    assert any(d["type"] == "ais_gap" for d in res["urgent"])
