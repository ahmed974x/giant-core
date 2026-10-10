"""Butterfly Engine: trace an anomaly back to its likely root causes.

    "Gold +1.2% <- crypto sell-off <- conflict event near Hormuz"   (each link scored and labelled with its evidence)

How it works
  1. A causal prior (a small directed graph written from domain knowledge, the "structure" step CausalNex would learn)
     says which drivers can plausibly move which outcomes: storms delay ships, delays at choke-points move oil, conflict
     raises risk aversion, risk aversion moves gold and crypto, and so on. Every edge has a prior strength.
  2. Evidence re-weights each edge:
       - data   : for links between markets with public history (Binance hourly bars), a DoWhy-style test runs:
                  backdoor-adjusted lagged OLS plus a placebo refuter. Supported -> x1.6, refuted -> x0.35.
       - live   : for world drivers, the engine looks for the cause *happening now* near the anomaly: open storms /
                  quakes (USGS + NASA EONET via /api/hazards) and conflict events (GDELT via /api/events) within
                  a radius. Observed -> x1.4, not observed -> x0.7.
       - prior  : nothing to check offline; the prior stands, marked "prior only".
  3. Walking the graph backwards from the anomaly, every path to a root is scored (product of edge scores) and the
     best chains (ranked by the geometric mean of their link scores) are returned with the graph, ready for the Research screen's Causal Graph panel.

It reads public data only and never changes anything, so Director 00 can call it without an approval step.
DoWhy and CausalNex themselves cannot load on this laptop (Application Control blocks pandas' DLL); the same estimate,
refuter and graph steps are implemented here in NumPy. See README.md.

    python butterfly_engine.py --type price_spike --asset PAXGUSDT
    python butterfly_engine.py --type ship_deviation --lat 26.5 --lon 56.3 --offline
"""

import argparse
import json
import sys
import math
import os
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from flight_to_safety import ols

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "truth"))
import truth_layer  # noqa: E402

OUT = Path(__file__).with_name("out") / "butterfly"
WEB = os.environ.get("OMEGA_WEB_URL", "http://127.0.0.1:3100")

# ── causal prior ─────────────────────────────────────────────────────────────────────────────────────────
NODES: dict[str, dict] = {
    "climate_pattern": {"en": "Climate pattern (season, ENSO)", "ar": "نمط مناخي", "kind": "world"},
    "severe_storm": {"en": "Severe storm / cyclone", "ar": "عاصفة شديدة", "kind": "world", "live": "storm"},
    "earthquake": {"en": "Earthquake", "ar": "زلزال", "kind": "world", "live": "earthquake"},
    "conflict_event": {"en": "Conflict / security incident", "ar": "نزاع أو حادث أمني", "kind": "world", "live": "conflict"},
    "port_congestion": {"en": "Port congestion", "ar": "ازدحام الميناء", "kind": "maritime"},
    "port_closure": {"en": "Port or strait closure", "ar": "إغلاق ميناء أو مضيق", "kind": "maritime"},
    "ship_delay": {"en": "Ship delay / deviation at a choke-point", "ar": "تأخر أو انحراف السفن عند مضيق", "kind": "maritime"},
    "oil_price": {"en": "Oil price move", "ar": "تحرك سعر النفط", "kind": "market"},
    "risk_off": {"en": "Risk-off sentiment", "ar": "عزوف عن المخاطرة", "kind": "market"},
    "crypto_selloff": {"en": "Crypto sell-off (BTC)", "ar": "هبوط العملات الرقمية", "kind": "market", "series": "BTCUSDT"},
    "eth_move": {"en": "Ethereum move", "ar": "تحرك الإيثيريوم", "kind": "market", "series": "ETHUSDT"},
    "gold_price": {"en": "Gold price move (PAXG)", "ar": "تحرك سعر الذهب", "kind": "market", "series": "PAXGUSDT"},
    "sol_move": {"en": "Solana move", "ar": "تحرك سولانا", "kind": "market", "series": "SOLUSDT"},
}
# (cause, effect, prior strength 0..1). Kept small and explicit so every link can be argued about.
EDGES: list[tuple[str, str, float]] = [
    ("climate_pattern", "severe_storm", 0.6),
    ("severe_storm", "port_closure", 0.55), ("severe_storm", "ship_delay", 0.6),
    ("earthquake", "port_closure", 0.5),
    ("conflict_event", "ship_delay", 0.55), ("conflict_event", "port_closure", 0.45),
    ("conflict_event", "risk_off", 0.5), ("conflict_event", "oil_price", 0.5),
    ("port_congestion", "ship_delay", 0.6), ("port_closure", "ship_delay", 0.7),
    ("ship_delay", "oil_price", 0.55), ("ship_delay", "port_congestion", 0.35),
    ("oil_price", "risk_off", 0.35), ("risk_off", "crypto_selloff", 0.5), ("risk_off", "gold_price", 0.5),
    ("crypto_selloff", "gold_price", 0.35), ("crypto_selloff", "eth_move", 0.75), ("crypto_selloff", "sol_move", 0.7),
]
ANOMALY_NODE = {"price_spike": None, "ship_deviation": "ship_delay", "port_congestion": "port_congestion", "oil_move": "oil_price"}
SERIES_NODE = {v["series"]: k for k, v in NODES.items() if "series" in v}
LIVE_RADIUS_KM = {"storm": 900, "earthquake": 400, "conflict": 600}


@dataclass
class Evidence:
    kind: str                      # data | live | prior
    factor: float
    note: str
    detail: dict = field(default_factory=dict)


# ── evidence providers ───────────────────────────────────────────────────────────────────────────────────
def _get_json(url: str, timeout: int = 25):
    req = urllib.request.Request(url, headers={"User-Agent": "omega-prime/0.1", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def market_returns(symbols: list[str]) -> dict[str, np.ndarray]:
    """Aligned hourly % log returns from Binance's public market-data mirror."""
    raw = {s: _get_json(f"https://data-api.binance.vision/api/v3/klines?symbol={s}&interval=1h&limit=1000") for s in symbols}
    common = set.intersection(*(set(k[0] for k in rows) for rows in raw.values()))
    t = sorted(common)
    out = {}
    for s, rows in raw.items():
        px = dict((k[0], float(k[4])) for k in rows)
        out[s] = np.diff(np.log(np.array([px[x] for x in t]))) * 100
    return out


def test_market_edge(cause: str, effect: str, rets: dict[str, np.ndarray], rng: np.random.Generator) -> Evidence:
    """Does the cause's return at hour t move the effect's return at t+1, adjusting for the effect's own last move
    and the other markets? Placebo: shuffled cause must not do as well."""
    x, y = rets[NODES[cause]["series"]], rets[NODES[effect]["series"]]
    others = [v for k, v in rets.items() if k not in (NODES[cause]["series"], NODES[effect]["series"])]
    idx = np.arange(1, len(x) - 1)
    conf = np.column_stack([y[idx]] + [o[idx] for o in others]) if others else y[idx][:, None]
    X = lambda c: np.column_stack([np.ones(len(idx)), c, conf])
    beta, se = ols(y[idx + 1], X(x[idx]))
    t_stat = abs(beta[1] / se[1]) if se[1] else 0.0
    placebo = [abs(ols(y[idx + 1], X(rng.permutation(x[idx])))[0][1]) for _ in range(100)]
    p = float(np.mean(np.array(placebo) >= abs(beta[1])))
    detail = {"effect_per_1pct": round(float(beta[1]), 4), "t": round(float(t_stat), 2), "placebo_p": round(p, 3), "bars": int(len(idx))}
    if t_stat >= 1.96 and p < 0.05:
        return Evidence("data", 1.6, f"supported by {len(idx)} hourly bars (t={t_stat:.1f}, placebo p={p:.2f})", detail)
    return Evidence("data", 0.35, f"not supported by {len(idx)} hourly bars (t={t_stat:.1f}, placebo p={p:.2f})", detail)


def _km(lat1, lon1, lat2, lon2) -> float:
    r = math.radians
    a = math.sin(r(lat2 - lat1) / 2) ** 2 + math.cos(r(lat1)) * math.cos(r(lat2)) * math.sin(r(lon2 - lon1) / 2) ** 2
    return 12742 * math.asin(math.sqrt(a))


def live_signals(lat: float, lon: float) -> dict[str, list[dict]]:
    """Storms, quakes and conflict events happening now near the anomaly, from the web app's public-feed routes.
    Conflict reports pass the Truth Layer first (ADR-021): only items scoring >= 0.7 count as evidence."""
    found: dict[str, list[dict]] = {"storm": [], "earthquake": [], "conflict": [], "unverified": []}
    try:
        for h in _get_json(f"{WEB}/api/hazards").get("hazards", []):
            key = "storm" if h["kind"] == "severeStorms" else "earthquake" if h["kind"] == "earthquake" else None
            if key and _km(lat, lon, h["lat"], h["lon"]) <= LIVE_RADIUS_KM[key]:
                found[key].append({"title": h["title"], "km": round(_km(lat, lon, h["lat"], h["lon"])), "source": h["source"]})
    except Exception:
        pass
    try:
        for e in _get_json(f"{WEB}/api/events").get("events", []):
            if e["category"] == "conflict" and _km(lat, lon, e["lat"], e["lon"]) <= LIVE_RADIUS_KM["conflict"]:
                t = truth_layer.score(truth_layer.Item(id=str(e["id"]), url=e["url"], tone=e.get("tone", 0), num_sources=e.get("sources")))
                hit = {"title": e["place"], "km": round(_km(lat, lon, e["lat"], e["lon"])), "source": "GDELT", "url": e["url"], "truth": t["score"]}
                found["conflict" if truth_layer.usable(t) else "unverified"].append(hit)
    except Exception:
        pass
    return found


# ── confidence and counterfactuals ───────────────────────────────────────────────────────────────────────
# How much each kind of evidence should be trusted, 0..1. Tested-and-supported data is strongest; a link the data
# refuted, or a live driver that is not happening, is weakest; an untested prior sits in the middle.
QUALITY = {("data", True): 0.9, ("data", False): 0.15, ("live", True): 0.8, ("live", False): 0.3, ("prior", True): 0.45}


def _confidence(ch: dict, best_score: float, evidence: dict) -> float:
    """0..1: geometric mean of the links' evidence quality, scaled by how close the chain scores to the best one."""
    q = [QUALITY[(evidence[(a, b)].kind, evidence[(a, b)].factor >= 1)] for a, b in zip(ch["path"], ch["path"][1:])]
    geo = math.exp(sum(math.log(x) for x in q) / len(q))
    rel = ch["score"] / best_score if best_score else 0.0
    return round(max(0.0, min(1.0, geo * (0.5 + 0.5 * rel))), 2)


def _observed_move(anomaly: dict, target: str, rets: dict | None) -> float | None:
    """The size of the anomaly in %, from the request or, for markets, the latest hourly return."""
    if anomaly.get("magnitude") is not None:
        return float(anomaly["magnitude"])
    series = NODES[target].get("series")
    if rets and series in rets and len(rets[series]):
        return round(float(rets[series][-1]), 3)
    return None


def _counterfactual(ch: dict, target: str, observed: float | None, evidence: dict, rets: dict | None) -> dict:
    """'If X hadn't happened, Y would have been Z%.' Uses the measured effect when the last link was tested on data,
    otherwise a prior-based estimate (the chain's prior strength as the share of the move it explains)."""
    root, cause = ch["path"][0], ch["path"][-2]
    ev = evidence[(cause, target)]
    name = lambda n, lang: NODES[n][lang]
    if observed is not None and ev.kind == "data" and ev.factor >= 1 and rets:
        cause_move = float(rets[NODES[cause]["series"]][-2])          # cause at t-1 drives the effect at t
        without = observed - ev.detail["effect_per_1pct"] * cause_move
        return {"method": "measured effect", "removed": cause, "observed_pct": round(observed, 3), "counterfactual_pct": round(without, 3),
                "en": f"If {name(cause, 'en').lower()} ({cause_move:+.2f}%) hadn't happened, {name(target, 'en').lower()} would have been "
                      f"{without:+.3f}% instead of {observed:+.3f}%.",
                "ar": f"لو لم يحدث {name(cause, 'ar')} ({cause_move:+.2f}%)، لكان {name(target, 'ar')} {without:+.3f}% بدل {observed:+.3f}%."}
    explained = ch["prior"]
    if observed is not None:
        without = observed * (1 - explained)
        return {"method": "prior-based estimate", "removed": root, "observed_pct": round(observed, 3), "counterfactual_pct": round(without, 3),
                "en": f"If {name(root, 'en').lower()} hadn't happened, {name(target, 'en').lower()} would have been about {without:+.3f}% "
                      f"instead of {observed:+.3f}% (prior-based, untested).",
                "ar": f"لو لم يحدث {name(root, 'ar')}، لكان {name(target, 'ar')} تقريبًا {without:+.3f}% بدل {observed:+.3f}% (تقدير مسبق غير مختبر)."}
    return {"method": "prior-based estimate", "removed": root, "share_explained": round(explained, 3),
            "en": f"If {name(root, 'en').lower()} hadn't happened, {name(target, 'en').lower()} would likely have been about "
                  f"{explained:.0%} smaller (prior-based, untested).",
            "ar": f"لو لم يحدث {name(root, 'ar')}، لكان {name(target, 'ar')} أصغر بنحو {explained:.0%} (تقدير مسبق غير مختبر)."}


# ── probabilistic scenarios (ADR-022) ───────────────────────────────────────────────────────────────────
# Stated assumptions live in assumptions.json so they can be reviewed (ADR-032) without reading code.
_A = json.loads((Path(__file__).with_name("assumptions.json")).read_text(encoding="utf-8"))
ROOT_PRIOR = float(_A["root_prior"])  # base rate that any one root driver is active in the anomaly's window
# Likelihood ratios for the Bayesian update of "this root is behind the move", one per link on its chain.
LIKELIHOOD = {("data", True): float(_A["likelihood"]["data_supports"]), ("data", False): float(_A["likelihood"]["data_refutes"]),
              ("live", True): float(_A["likelihood"]["live_seen"]), ("live", False): float(_A["likelihood"]["live_not_seen"]),
              ("prior", True): float(_A["likelihood"]["prior_only"])}
SCENARIO_RUNS = int(_A["runs"])
if not (0 < ROOT_PRIOR < 1 and all(v > 0 for v in LIKELIHOOD.values()) and 1000 <= SCENARIO_RUNS <= 200_000):
    raise ValueError("assumptions.json is out of range")


def scenarios(chains: list[dict], evidence: dict, target: str, observed: float | None, seed: int = 11) -> list[dict]:
    """Five outcome scenarios from a Monte Carlo over root causes.

    1. Bayesian update per root: posterior odds = prior odds x product of the likelihood ratios of its chain's links.
    2. Each run samples which roots are active (Bernoulli(posterior)); an active root moves the target by
       |observed| x (its chain strength / the strongest chain's) x lognormal noise, in the observed direction.
    3. Runs are grouped into: no driver (move fades), the three most probable single drivers, and a compound shock
       (two or more drivers at once). Each scenario reports its share of runs, the 10-90% range of the move, a
       confidence (chain evidence quality x how many runs back it) and a tail-risk flag.
    """
    rng = np.random.default_rng(seed)
    base = abs(observed) if observed else 1.0
    sign = -1.0 if (observed or 0) < 0 else 1.0
    roots: dict[str, dict] = {}
    for ch in chains:                                            # best-scoring chain per root
        r = ch["path"][0]
        if r not in roots or ch["score"] > roots[r]["score"]:
            roots[r] = ch
    if not roots:
        return []
    names = list(roots)
    post, strength, quality = [], [], []
    for r in names:
        links = list(zip(roots[r]["path"], roots[r]["path"][1:]))
        lr = float(np.prod([LIKELIHOOD[(evidence[l].kind, evidence[l].factor >= 1)] for l in links]))
        odds = ROOT_PRIOR / (1 - ROOT_PRIOR) * lr
        post.append(odds / (1 + odds))
        strength.append(roots[r]["prior"])
        quality.append(math.exp(np.mean([math.log(QUALITY[(evidence[l].kind, evidence[l].factor >= 1)]) for l in links])))
    post, strength = np.array(post), np.array(strength) / max(strength)

    active = rng.random((SCENARIO_RUNS, len(names))) < post                  # which drivers fire in each run
    noise = rng.lognormal(0.0, 0.5, size=active.shape)
    moves = sign * base * (active * strength * noise).sum(axis=1)
    n_active = active.sum(axis=1)
    p95 = np.quantile(np.abs(moves), 0.95)

    order = [names[i] for i in np.argsort(-post)][:3]
    groups = [("none", "No driver persists: the move fades", "لا يستمر أي سبب: يتلاشى التحرك", n_active == 0)]
    for r in order:
        i = names.index(r)
        groups.append((r, f"Driven by {NODES[r]['en'].lower()}", f"بدافع {NODES[r]['ar']}", (n_active == 1) & active[:, i]))
    groups.append(("compound", "Compound shock: two or more drivers at once", "صدمة مركّبة: سببان أو أكثر معًا", n_active >= 2))

    out = []
    for key, en, ar, mask in groups:
        share = float(mask.mean())
        sel = moves[mask] if mask.any() else np.zeros(1)
        lo, hi = (float(np.quantile(sel, 0.1)), float(np.quantile(sel, 0.9))) if mask.any() else (0.0, 0.0)
        support = min(1.0, mask.sum() / 500)                                   # few runs -> less confidence
        if key in names:
            conf = quality[names.index(key)] * support
        elif key == "compound":
            conf = float(np.mean(quality)) * support
        else:
            conf = (1 - float(np.max(post))) * support                       # "nothing persists" is as sure as no driver is likely
        tail = bool(key == "compound" or (mask.any() and np.mean(np.abs(sel) >= p95) > 0.25))
        out.append({"key": key, "scenario": en, "scenario_ar": ar, "probability": round(share, 3),
                    "impact_range": [round(min(lo, hi), 3), round(max(lo, hi), 3)], "confidence": round(conf, 2),
                    "tail_risk_flag": tail, "posterior": round(float(post[names.index(key)]), 3) if key in names else None})
    # The groups are disjoint, but runs where a single driver outside the top three fires belong to none of them.
    # Fold those into the third single-driver scenario and say so, so the five probabilities always add up to 1.
    missing = round(1.0 - sum(s["probability"] for s in out), 3)
    if missing > 0 and len(out) >= 4:
        last_single = out[-2]
        last_single["probability"] = round(last_single["probability"] + missing, 3)
        last_single["scenario"] += " (or another single driver)"
        last_single["scenario_ar"] += " (أو سبب منفرد آخر)"
    return out


# ── engine ───────────────────────────────────────────────────────────────────────────────────────────────
def trace(anomaly: dict, rets: dict[str, np.ndarray] | None = None, live: dict[str, list[dict]] | None = None,
          max_depth: int = 4, top_k: int = 3, seed: int = 7) -> dict:
    """anomaly: {"type": "price_spike"|"ship_deviation"|"port_congestion"|"oil_move", "asset"?, "lat"?, "lon"?, "label"?}
    rets / live: pre-fetched evidence (None = offline: prior only)."""
    rng = np.random.default_rng(seed)
    kind = anomaly.get("type", "price_spike")
    target = SERIES_NODE.get(anomaly.get("asset", "")) if kind == "price_spike" else ANOMALY_NODE.get(kind)
    if not target:
        raise ValueError(f"cannot place anomaly {anomaly} on the causal graph")

    parents: dict[str, list[tuple[str, float]]] = {}
    for c, e, w in EDGES:
        parents.setdefault(e, []).append((c, w))

    evidence: dict[tuple[str, str], Evidence] = {}

    def edge_ev(c: str, e: str) -> Evidence:
        if (c, e) in evidence:
            return evidence[(c, e)]
        ev = Evidence("prior", 1.0, "prior only (no public series for this link yet)")
        if rets and "series" in NODES[c] and "series" in NODES[e]:
            ev = test_market_edge(c, e, rets, rng)
        elif live is not None and NODES[c].get("live"):
            hits = live.get(NODES[c]["live"], [])
            held = len(live.get("unverified", [])) if NODES[c]["live"] == "conflict" else 0
            held_note = f"; {held} unverified report(s) ignored" if held else ""
            ev = (Evidence("live", 1.4, f"observed now: {len(hits)} within {LIVE_RADIUS_KM[NODES[c]['live']]} km{held_note}", {"examples": hits[:3]})
                  if hits else Evidence("live", 0.7, f"not observed within {LIVE_RADIUS_KM[NODES[c]['live']]} km right now"))
        evidence[(c, e)] = ev
        return ev

    chains: list[dict] = []

    def walk(node: str, path: list[str], score: float, prior: float, depth: int):
        ps = parents.get(node, [])
        if (not ps or depth >= max_depth) and len(path) > 1:
            # Rank by the geometric mean of link scores so a longer, well-evidenced chain is not beaten by a
            # short chain of untested priors just because it multiplies fewer numbers below 1.
            chains.append({"path": list(reversed(path)), "score": score ** (1 / (len(path) - 1)), "prior": prior})
            return
        for c, w in ps:
            if c in path:
                continue
            walk(c, path + [c], score * w * edge_ev(c, node).factor, prior * w, depth + 1)

    walk(target, [target], 1.0, 1.0, 0)
    chains.sort(key=lambda ch: -ch["score"])
    best = chains[:top_k]
    observed = _observed_move(anomaly, target, rets)
    for ch in best:
        ch["confidence"] = _confidence(ch, chains[0]["score"], evidence)
        ch["counterfactual"] = _counterfactual(ch, target, observed, evidence, rets)

    used = {(ch["path"][i], ch["path"][i + 1]) for ch in best for i in range(len(ch["path"]) - 1)}
    node_ids = {n for ch in best for n in ch["path"]}
    total = sum(ch["score"] for ch in chains) or 1.0

    def label(n: str, lang: str) -> str:
        return NODES[n][lang]

    return {
        "anomaly": {**anomaly, "node": target},
        "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "mode": "live" if live is not None or rets else "offline (prior only)",
        "chains": [{
            "path": ch["path"], "share": round(ch["score"] / total, 3),
            "text_en": " <- ".join(label(n, "en") for n in reversed(ch["path"])),
            "text_ar": " ← ".join(label(n, "ar") for n in reversed(ch["path"])),
            "links": [{"cause": ch["path"][i], "effect": ch["path"][i + 1], "evidence": evidence[(ch["path"][i], ch["path"][i + 1])].kind,
                       "note": evidence[(ch["path"][i], ch["path"][i + 1])].note} for i in range(len(ch["path"]) - 1)],
            "confidence": ch["confidence"], "counterfactual": ch["counterfactual"],
        } for ch in best],
        "confidence": best[0]["confidence"] if best else 0.0,
        "observed_move_pct": observed,
        "scenarios": scenarios(chains, evidence, target, observed, seed=seed),
        "graph": {
            "nodes": [{"id": n, "en": NODES[n]["en"], "ar": NODES[n]["ar"], "kind": NODES[n]["kind"], "target": n == target} for n in sorted(node_ids)],
            "edges": [{"source": c, "target": e, "prior": w, "evidence": evidence[(c, e)].kind, "factor": evidence[(c, e)].factor,
                       "note": evidence[(c, e)].note, "detail": evidence[(c, e)].detail}
                      for c, e, w in EDGES if (c, e) in used],
        },
        "note": "Root-cause candidates ranked by prior x evidence. Evidence, not proof: check the links marked 'prior only'.",
    }


def run(anomaly: dict, offline: bool = False) -> dict:
    rets = live = None
    if not offline:
        try:
            rets = market_returns(["BTCUSDT", "ETHUSDT", "SOLUSDT", "PAXGUSDT"])
        except Exception:
            rets = None
        if anomaly.get("lat") is not None and anomaly.get("lon") is not None:
            live = live_signals(float(anomaly["lat"]), float(anomaly["lon"]))
    result = trace(anomaly, rets, live)
    OUT.mkdir(parents=True, exist_ok=True)
    name = f"{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}-{result['anomaly']['node']}.json"
    for f in (OUT / name, OUT / "latest.json"):
        f.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def main():
    ap = argparse.ArgumentParser(description="Trace an anomaly back to root-cause candidates")
    ap.add_argument("--type", default="price_spike", choices=["price_spike", "ship_deviation", "port_congestion", "oil_move"])
    ap.add_argument("--asset", default="PAXGUSDT", help="for price_spike: BTCUSDT, ETHUSDT, SOLUSDT or PAXGUSDT")
    ap.add_argument("--lat", type=float); ap.add_argument("--lon", type=float)
    ap.add_argument("--magnitude", type=float, help="size of the anomaly in %% (default: latest hourly move for markets)")
    ap.add_argument("--offline", action="store_true", help="prior graph only, no network")
    a = ap.parse_args()
    out = run({"type": a.type, "asset": a.asset, "lat": a.lat, "lon": a.lon, "magnitude": a.magnitude}, offline=a.offline)
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps({"confidence": out["confidence"], "mode": out["mode"],
                      "chains": [{"chain": c["text_en"], "confidence": c["confidence"], "counterfactual": c["counterfactual"]["en"]}
                                 for c in out["chains"]]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
