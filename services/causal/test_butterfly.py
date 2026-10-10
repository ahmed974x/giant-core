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


# ── probabilistic scenarios (ADR-022) ──
def test_five_scenarios_with_probabilities_that_sum_to_one():
    sc = be.trace({"type": "oil_move", "magnitude": 3.0})["scenarios"]
    assert len(sc) == 5 and abs(sum(s["probability"] for s in sc) - 1.0) < 0.002
    assert {"scenario", "probability", "impact_range", "confidence", "tail_risk_flag"} <= set(sc[0])
    assert sc[0]["key"] == "none" and sc[-1]["key"] == "compound"


def test_live_evidence_raises_the_matching_scenario_by_bayesian_update():
    quiet = {s["key"]: s["probability"] for s in be.trace({"type": "ship_deviation", "magnitude": 5.0},
             live={"storm": [], "earthquake": [], "conflict": [], "unverified": []})["scenarios"]}
    stormy = {s["key"]: s["probability"] for s in be.trace({"type": "ship_deviation", "magnitude": 5.0},
              live={"storm": [{"title": "Cyclone", "km": 90}], "earthquake": [], "conflict": [], "unverified": []})["scenarios"]}
    assert stormy.get("climate_pattern", 0) > quiet.get("climate_pattern", 0) + 0.15
    assert stormy["none"] < quiet["none"]


def test_compound_shock_is_the_tail_and_has_the_widest_impact():
    sc = be.trace({"type": "oil_move", "magnitude": 3.0})["scenarios"]
    compound = sc[-1]
    singles = [s for s in sc if s["key"] not in ("none", "compound")]
    assert compound["tail_risk_flag"] and compound["impact_range"][1] > max(s["impact_range"][1] for s in singles)


def test_impact_ranges_scale_with_the_observed_move_and_keep_its_sign():
    small = be.trace({"type": "oil_move", "magnitude": 1.0})["scenarios"]
    big = be.trace({"type": "oil_move", "magnitude": -4.0})["scenarios"]
    s1 = next(s for s in small if s["key"] == "compound")["impact_range"]
    s4 = next(s for s in big if s["key"] == "compound")["impact_range"]
    assert s4[1] <= 0 and abs(s4[0]) > 3 * abs(s1[1]) * 0.9


def test_scenarios_are_reproducible_and_confidence_is_bounded():
    a = be.trace({"type": "price_spike", "asset": "PAXGUSDT"}, rets=synthetic(0.25))["scenarios"]
    b = be.trace({"type": "price_spike", "asset": "PAXGUSDT"}, rets=synthetic(0.25))["scenarios"]
    assert a == b and all(0.0 <= s["confidence"] <= 1.0 for s in a)
    top_driver = max((s for s in a if s["key"] not in ("none", "compound")), key=lambda s: s["probability"])
    assert top_driver["confidence"] >= min(s["confidence"] for s in a if s["key"] not in ("none", "compound"))
