"""Butterfly Engine tests: offline, synthetic data with a known cause."""

import numpy as np
import pytest

import butterfly_engine as be


def synthetic(cause_strength: float, n: int = 900, seed: int = 1) -> dict[str, np.ndarray]:
    rng = np.random.default_rng(seed)
    btc = rng.normal(0, 1, n)
    eth = 0.8 * btc + rng.normal(0, 0.5, n)
    sol = 0.7 * btc + rng.normal(0, 0.6, n)
    gold = rng.normal(0, 0.3, n)
    gold[1:] += cause_strength * btc[:-1]                 # BTC at t moves gold at t+1
    return {"BTCUSDT": btc, "ETHUSDT": eth, "SOLUSDT": sol, "PAXGUSDT": gold}


def links(result):
    return {(l["cause"], l["effect"]): l for ch in result["chains"] for l in ch["links"]}


def test_offline_trace_uses_the_prior_and_reaches_world_roots():
    r = be.trace({"type": "ship_deviation", "lat": 26.5, "lon": 56.3})
    assert r["anomaly"]["node"] == "ship_delay" and r["mode"].startswith("offline")
    roots = {ch["path"][0] for ch in r["chains"]}
    assert roots & {"conflict_event", "climate_pattern", "earthquake"}
    assert all(l["evidence"] == "prior" for l in links(r).values())


def test_a_real_lagged_effect_is_detected_and_promoted():
    r = be.trace({"type": "price_spike", "asset": "PAXGUSDT"}, rets=synthetic(0.25))
    edge = next(e for e in r["graph"]["edges"] if (e["source"], e["target"]) == ("crypto_selloff", "gold_price"))
    assert edge["evidence"] == "data" and edge["factor"] > 1
    assert r["chains"][0]["path"][-2:] == ["crypto_selloff", "gold_price"]


def test_no_effect_is_refuted_and_demoted():
    r = be.trace({"type": "price_spike", "asset": "PAXGUSDT"}, rets=synthetic(0.0))
    edge = next((e for e in r["graph"]["edges"] if (e["source"], e["target"]) == ("crypto_selloff", "gold_price")), None)
    assert edge is None or edge["factor"] < 1
    assert r["chains"][0]["path"][-2] != "crypto_selloff"


def test_live_observation_lifts_the_matching_root():
    quiet = be.trace({"type": "ship_deviation"}, live={"storm": [], "earthquake": [], "conflict": []})
    stormy = be.trace({"type": "ship_deviation"}, live={"storm": [{"title": "Cyclone", "km": 120}], "earthquake": [], "conflict": []})
    assert stormy["chains"][0]["path"][:2] == ["climate_pattern", "severe_storm"] or "severe_storm" in stormy["chains"][0]["path"]
    assert quiet["chains"][0]["path"] != stormy["chains"][0]["path"]


def test_unknown_anomaly_is_refused_and_output_is_bilingual():
    with pytest.raises(ValueError):
        be.trace({"type": "price_spike", "asset": "DOGEUSDT"})
    r = be.trace({"type": "oil_move"})
    assert r["chains"][0]["text_ar"] and "←" in r["chains"][0]["text_ar"]
    assert {n["id"] for n in r["graph"]["nodes"]} >= set(r["chains"][0]["path"])


def test_confidence_is_bounded_and_counterfactual_uses_the_measured_effect():
    rets = synthetic(0.25)
    r = be.trace({"type": "price_spike", "asset": "PAXGUSDT"}, rets=rets)
    top = r["chains"][0]
    assert 0.0 <= r["confidence"] <= 1.0 and r["confidence"] == top["confidence"]
    cf = top["counterfactual"]
    assert cf["method"] == "measured effect" and cf["removed"] == "crypto_selloff"
    expected = rets["PAXGUSDT"][-1] - next(e for e in r["graph"]["edges"] if e["source"] == "crypto_selloff")["detail"]["effect_per_1pct"] * rets["BTCUSDT"][-2]
    assert abs(cf["counterfactual_pct"] - expected) < 1e-2 and "instead of" in cf["en"] and "بدل" in cf["ar"]


def test_offline_counterfactual_is_labelled_prior_based():
    r = be.trace({"type": "ship_deviation", "magnitude": 12.0})
    cf = r["chains"][0]["counterfactual"]
    assert cf["method"] == "prior-based estimate" and cf["counterfactual_pct"] < 12.0 and "untested" in cf["en"]
    assert r["confidence"] < 0.6                                   # prior-only evidence never claims high confidence
