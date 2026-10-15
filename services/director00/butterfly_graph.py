"""The Butterfly Engine as a LangGraph sub-graph, exposed to Director 00 as a tool.

    START -> locate -> gather_evidence -> trace -> narrate -> END

  locate          : maps the question or anomaly onto the causal graph (asset / ship / oil / congestion + place)
  gather_evidence : public market history and live hazards / conflict near the place (skipped offline)
  trace           : scores root-cause chains (DoWhy-style estimate + refuters on market links), confidence 0..1,
                    counterfactual per chain ("if X hadn't happened, Y would have been Z%")
  narrate         : a short bilingual answer and the graph JSON for the Research screen

Read-only end to end: it reads public data and writes only its own trace file, so it needs no approval.
The tool (`butterfly_trace`) is a LangChain tool, so an LLM planner can call it by name with typed arguments.
"""

import os
import re
import sys
from pathlib import Path
from typing import TypedDict

from langchain_core.tools import tool
from langgraph.graph import END, START, StateGraph

CAUSAL = Path(__file__).resolve().parents[1] / "causal"
if str(CAUSAL) not in sys.path:
    sys.path.insert(0, str(CAUSAL))
import butterfly_engine as be  # noqa: E402

ASSETS = [(re.compile(r"gold|paxg|ذهب", re.I), {"type": "price_spike", "asset": "PAXGUSDT"}),
          (re.compile(r"bitcoin|btc|بيتكوين|بتكوين", re.I), {"type": "price_spike", "asset": "BTCUSDT"}),
          (re.compile(r"ether|eth|إيثيريوم|ايثيريوم", re.I), {"type": "price_spike", "asset": "ETHUSDT"}),
          (re.compile(r"solana|\bsol\b|سولانا", re.I), {"type": "price_spike", "asset": "SOLUSDT"}),
          (re.compile(r"oil|brent|نفط|برنت", re.I), {"type": "oil_move"}),
          (re.compile(r"congest|ازدحام", re.I), {"type": "port_congestion"}),
          (re.compile(r"ship|vessel|tanker|سفن|سفين|ناقلة|ناقلات", re.I), {"type": "ship_deviation"})]
PLACES = {"hormuz": (26.57, 56.25), "هرمز": (26.57, 56.25), "suez": (30.6, 32.35), "السويس": (30.6, 32.35),
          "bab": (12.58, 43.33), "المندب": (12.58, 43.33), "malacca": (2.5, 100.4), "ملقا": (2.5, 100.4),
          "panama": (9.08, -79.68), "بنما": (9.08, -79.68), "jebel ali": (24.98, 55.03), "جبل علي": (24.98, 55.03)}


class TraceState(TypedDict, total=False):
    question: str
    anomaly: dict
    offline: bool
    rets: dict
    live: dict
    result: dict
    answer: str


def anomaly_from_text(text: str) -> dict | None:
    anomaly = next((dict(a) for rx, a in ASSETS if rx.search(text)), None)
    if anomaly is None:
        return None
    low = text.lower()
    for name, (lat, lon) in PLACES.items():
        if name in low:
            anomaly.update(lat=lat, lon=lon, place=name)
            break
    if m := re.search(r"([+-]?\d+(?:\.\d+)?)\s*%", text):
        anomaly["magnitude"] = float(m.group(1))
    return anomaly


def _locate(s: TraceState) -> TraceState:
    anomaly = s.get("anomaly") or anomaly_from_text(s.get("question", ""))
    if not anomaly:
        raise ValueError("no anomaly recognised (try gold, bitcoin, oil, ships or congestion, optionally with a place)")
    return {"anomaly": anomaly}


def _gather(s: TraceState) -> TraceState:
    if s.get("offline"):
        return {"rets": None, "live": None}
    a = s["anomaly"]
    try:
        rets = be.market_returns(["BTCUSDT", "ETHUSDT", "SOLUSDT", "PAXGUSDT"])
    except Exception:
        rets = None
    live = be.live_signals(float(a["lat"]), float(a["lon"])) if a.get("lat") is not None else None
    return {"rets": rets, "live": live}


def _trace(s: TraceState) -> TraceState:
    import json
    # NumPy scalars (float64, int64) break LangGraph's msgpack checkpointer, so the result is made plain JSON first.
    result = json.loads(json.dumps(be.trace(s["anomaly"], s.get("rets"), s.get("live")),
                                   default=lambda o: o.item() if hasattr(o, "item") else str(o)))
    be.OUT.mkdir(parents=True, exist_ok=True)
    (be.OUT / "latest.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"result": result}


def _narrate(s: TraceState) -> TraceState:
    r, q = s["result"], s.get("question", "")
    ar = bool(re.search(r"[؀-ۿ]", q))
    lines = [f"{'الثقة' if ar else 'Confidence'}: {r['confidence']:.2f}  ·  {'أقوى الأسباب الجذرية المحتملة' if ar else 'Most likely root-cause chains'}:"]
    for i, ch in enumerate(r["chains"], 1):
        weak = sum(1 for link in ch["links"] if link["evidence"] == "prior")
        tag = (f" ({weak} روابط بلا بيانات بعد)" if ar else f" ({weak} links still prior-only)") if weak else ""
        lines.append(f"{i}. {ch['text_ar'] if ar else ch['text_en']} [{ch['confidence']:.2f}]{tag}")
        lines.append(f"   ↳ {ch['counterfactual']['ar' if ar else 'en']}")
    if r.get("scenarios"):
        lines.append("السيناريوهات:" if ar else "Scenarios:")
        for sc in r["scenarios"]:
            lo, hi = sc["impact_range"]
            tail = (" ⚠ ذيل خطر" if ar else " ⚠ tail risk") if sc["tail_risk_flag"] else ""
            lines.append(f"   {sc['probability']:.0%}  {sc['scenario_ar'] if ar else sc['scenario']}  [{lo:+.2f}% .. {hi:+.2f}%]{tail}")
    return {"answer": "\n".join(lines)}


def build_subgraph():
    g = StateGraph(TraceState)
    g.add_node("locate", _locate)
    g.add_node("gather_evidence", _gather)
    g.add_node("trace", _trace)
    g.add_node("narrate", _narrate)
    g.add_edge(START, "locate")
    g.add_edge("locate", "gather_evidence")
    g.add_edge("gather_evidence", "trace")
    g.add_edge("trace", "narrate")
    g.add_edge("narrate", END)
    return g.compile()


SUBGRAPH = build_subgraph()


@tool
def butterfly_trace(question: str = "", anomaly_type: str = "", asset: str = "", place: str = "", magnitude: float | None = None) -> dict:
    """Trace an anomaly (price spike in gold/BTC/ETH/SOL, oil move, ship delay, port congestion) back to ranked
    root-cause chains with a 0-1 confidence, a counterfactual per chain and graph JSON. Read-only."""
    anomaly = None
    if anomaly_type:
        anomaly = {"type": anomaly_type, **({"asset": asset} if asset else {})}
        if place and place.lower() in PLACES:
            anomaly.update(lat=PLACES[place.lower()][0], lon=PLACES[place.lower()][1], place=place.lower())
        if magnitude is not None:
            anomaly["magnitude"] = magnitude
    out = SUBGRAPH.invoke({"question": question, "anomaly": anomaly, "offline": os.environ.get("DIRECTOR_OFFLINE") == "1"})
    return {"answer": out["answer"], "result": out["result"]}
