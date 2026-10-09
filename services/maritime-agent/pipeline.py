"""The speed layer, end to end (asyncio): AIS → Redis Stream → fast path → Director 00 → alert streams.

    python pipeline.py                     # live aisstream.io if AISSTREAM_API_KEY is set, else mock replay
    python pipeline.py --replay --seconds 20 --metrics-port 9108

Streams:  omega:ais (positions, Arrow batches) → omega:alerts:fast (immediate rule hits)
                                               → omega:alerts (scored, localized decisions for the UI/relay)
Two consumer groups: "fastpath" on omega:ais (rules only, never blocked) and "director" on omega:alerts:fast
(ONNX scoring + context). Several workers can share each group; a crash leaves messages pending, not lost.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time

import ais_ws
import bus as busmod
import director
import fast_path
import metrics
import onnx_scorer

import db

FAST, DECIDED, GROUP, DIRECTOR = "omega:alerts:fast", "omega:alerts", "fastpath", "director"


def _pct(xs: list[float]) -> dict | None:
    if not xs:
        return None
    s = sorted(xs)
    return {"p50": round(s[len(s) // 2], 2), "p95": round(s[min(len(s) - 1, int(len(s) * 0.95))], 2), "n": len(s)}


def _latency_summary() -> dict:
    """Mean milliseconds per stage, from the Prometheus histograms (sum / count)."""
    out = {}
    for name, h in (("ingest", metrics.ingest_ms), ("fast_path", metrics.fast_ms),
                    ("inference", metrics.inference_ms), ("decision", metrics.decision_ms)):
        samples = {smp.name: smp.value for smp in h.collect()[0].samples}
        n = next((v for k, v in samples.items() if k.endswith("_count")), 0)
        total = next((v for k, v in samples.items() if k.endswith("_sum")), 0)
        out[name] = round(total / n, 2) if n else None
    return out


def ports() -> list[dict]:
    return [{"slug": p[0], "name_en": p[1], "name_ar": p[2], "lon": p[3], "lat": p[4], "baseline": p[5]} for p in db.PORTS]


async def consume(bus, window, stop: asyncio.Event, worker: str = "w1", progress: dict | None = None) -> int:
    """FAST PATH. Read positions → rules → publish alerts at once → ack. Never waits on the slow path."""
    await bus.ensure_group(ais_ws.STREAM, GROUP)
    handled = 0
    progress = progress if progress is not None else {}
    while not stop.is_set():
        for msg_id, f in await bus.read(ais_ws.STREAM, GROUP, worker, count=10, block_ms=100):
            produced = int(f.get("t0", b"0"))
            lag = (time.time_ns() - produced) / 1e6
            metrics.ingest_ms.observe(lag)
            progress.setdefault("ingest", []).append(lag)
            t0 = time.perf_counter()
            alerts = window.ingest(busmod.decode_batch(f["arrow"]))
            fast = (time.perf_counter() - t0) * 1000
            metrics.fast_ms.observe(fast)
            progress.setdefault("fast", []).append(fast)
            for a in alerts:                                  # fast alert: out immediately, carrying its event time
                await bus.xadd(FAST, {"json": json.dumps(a, ensure_ascii=False), "t0": str(produced)})
                progress.setdefault("fast_alert_ms", []).append((time.time_ns() - produced) / 1e6)
                progress["fast_alerts"] = progress.get("fast_alerts", 0) + 1
            await bus.ack(ais_ws.STREAM, GROUP, msg_id)
            handled += 1
            progress["handled"] = handled
    return handled


async def decide_loop(bus, boss, stop: asyncio.Event, lang: str = "en", sink: list | None = None,
                      progress: dict | None = None, worker: str = "d1") -> int:
    """SLOW PATH. Its own consumer group on the fast-alert stream: ONNX score + context + localization."""
    await bus.ensure_group(FAST, DIRECTOR)
    done = 0
    progress = progress if progress is not None else {}
    while not stop.is_set():
        msgs = await bus.read(FAST, DIRECTOR, worker, count=50, block_ms=100)
        if not msgs:
            continue
        alerts = [json.loads(f["json"]) for _, f in msgs]
        produced = min(int(f.get("t0", b"0")) for _, f in msgs)
        for d in await boss.decide(alerts, produced, lang):
            progress.setdefault("decision", []).append(d["decision_ms"])
            await bus.xadd(DECIDED, {"json": json.dumps(d, ensure_ascii=False)})
            if sink is not None:
                sink.append(d)
        await bus.ack(FAST, DIRECTOR, *[m for m, _ in msgs])
        done += len(msgs)
        progress["decided"] = done
    return done


async def run(seconds: float, replay: bool, metrics_port: int | None, lang: str) -> dict:
    if metrics_port:
        metrics.serve(metrics_port)
    bus = await busmod.get_bus()
    window = fast_path.SlidingWindow(ports=ports())
    window.warmup()
    boss = director.Director(onnx_scorer.Scorer())
    stop, decisions, progress = asyncio.Event(), [], {"handled": 0}
    await bus.ensure_group(ais_ws.STREAM, GROUP)
    worker = asyncio.create_task(consume(bus, window, stop, progress=progress))
    slow = asyncio.create_task(decide_loop(bus, boss, stop, lang=lang, sink=decisions, progress=progress))
    # Replay is paced so measured latency is processing time, not an artificial backlog.
    producer = asyncio.create_task(ais_ws.replay_mock(bus, pace_ms=25) if replay else ais_ws.produce(bus, stop))
    deadline = time.monotonic() + seconds
    if replay:
        try:
            info = await asyncio.wait_for(asyncio.shield(producer), seconds)
            while time.monotonic() < deadline and (progress["handled"] < info["batches"]
                                                   or progress.get("decided", 0) < progress.get("fast_alerts", 0)):
                await asyncio.sleep(0.05)                     # drain both paths
        except TimeoutError:
            pass
    else:
        await asyncio.sleep(seconds)
    stop.set()
    handled = await worker
    await slow
    producer.cancel()
    await bus.close()
    return {"bus": bus.kind, "batches": handled, "decisions": len(decisions),
            "latency_ms": {k: _pct(progress.get(k, [])) for k in ("ingest", "fast", "fast_alert_ms", "decision")},
            "inference_ms_mean": _latency_summary()["inference"],
            "by_type": {t: sum(1 for d in decisions if d["type"] == t) for t in {d["type"] for d in decisions}},
            "urgent": [d for d in decisions if d["priority"] == "urgent"]}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="OMEGA speed layer")
    ap.add_argument("--seconds", type=float, default=30)
    ap.add_argument("--replay", action="store_true", help="push the mock simulation instead of the live feed")
    ap.add_argument("--metrics-port", type=int, default=0)
    ap.add_argument("--lang", choices=["en", "ar"], default="en")
    a = ap.parse_args()
    res = asyncio.run(run(a.seconds, a.replay, a.metrics_port or None, a.lang))
    print(json.dumps({k: v for k, v in res.items() if k != "urgent"}, ensure_ascii=False))
    for d in res["urgent"]:
        print(f"  [URGENT {d['risk']:.2f}] {d['title_local']}: {d.get('mmsi') or d.get('port')} — {d['reason']} ({d.get('decision_ms')} ms)")


if __name__ == "__main__":
    main()
