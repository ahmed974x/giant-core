#!/usr/bin/env python3
"""ts_math: Welford running statistics, EWMA, online z-score anomalies, a VPIN-style flow imbalance and LTTB
downsampling for time series, in the standard library only (math, json, csv, argparse, sys). No network, no
processes. The same formulas as jarvis/server/lib/timeseries.mjs, which the Jarvis server and page run.

    python3 ts_math.py series.json [--threshold 120] [--alpha 0.1] [--limit 3] [--json]
    python3 ts_math.py series.csv --json                  # columns t,v (a header row is skipped)

A series is [{"t": time, "v": value}, ...] or [[t, v], ...]. Exit 0 always for a report, 2 for a bad input.

  Welford: n, mean, M2 updated per value; variance = M2 / (n - 1).
  EWMA: e = alpha * x + (1 - alpha) * e.
  z-score: against the values seen before x; |z| > limit after `warm` values is an anomaly.
  VPIN [INFERENCE]: tick-rule up/down ticks in buckets of equal size; mean |up - down| / size over the last buckets.
  LTTB: first and last points kept; per bucket, the point with the largest triangle area.
"""

import argparse
import csv
import json
import math
import sys


def welford():
    return {"n": 0, "mean": 0.0, "m2": 0.0}


def welford_push(s, x):
    n = s["n"] + 1
    d = x - s["mean"]
    mean = s["mean"] + d / n
    return {"n": n, "mean": mean, "m2": s["m2"] + d * (x - mean)}


def variance(s):
    return s["m2"] / (s["n"] - 1) if s["n"] > 1 else 0.0


def stdev(s):
    return math.sqrt(variance(s))


def ewma_push(e, x, alpha=0.1):
    return x if e is None else alpha * x + (1 - alpha) * e


def zscore(s, x):
    sd = stdev(s)
    return (x - s["mean"]) / sd if sd > 0 else 0.0


def vpin(values, size=50, window=10):
    buckets, up, down, last, prev = [], 0.0, 0.0, 0, None
    for x in values:
        if prev is not None:
            side = 1 if x > prev else -1 if x < prev else last
            if side > 0:
                up += 1
            elif side < 0:
                down += 1
            else:
                up += 0.5
                down += 0.5
            last = side
            if up + down >= size:
                buckets.append(abs(up - down) / size)
                up = down = 0.0
        prev = x
    tail = buckets[-window:]
    return {"vpin": round(sum(tail) / len(tail), 3) if tail else None, "buckets": len(buckets), "size": size}


def lttb(points, threshold):
    n = len(points)
    if threshold >= n or threshold < 3:
        return list(points)
    out = [points[0]]
    every = (n - 2) / (threshold - 2)
    a = 0
    for i in range(threshold - 2):
        s, e = math.floor((i + 1) * every) + 1, min(math.floor((i + 2) * every) + 1, n)
        span = points[s:e] or [points[-1]]
        ax = sum(p["t"] for p in span) / len(span)
        ay = sum(p["v"] for p in span) / len(span)
        rs, re = math.floor(i * every) + 1, math.floor((i + 1) * every) + 1
        best, pick = -1.0, rs
        for j in range(rs, re):
            area = abs((points[a]["t"] - ax) * (points[j]["v"] - points[a]["v"]) - (points[a]["t"] - points[j]["t"]) * (ay - points[a]["v"]))
            if area > best:
                best, pick = area, j
        out.append(points[pick])
        a = pick
    out.append(points[-1])
    return out


def analyse(points, alpha=0.1, limit=3.0, warm=30):
    s, e, anomalies = welford(), None, []
    for p in points:
        z = zscore(s, p["v"]) if s["n"] >= warm else 0.0
        if abs(z) > limit:
            anomalies.append({"t": p["t"], "v": p["v"], "z": round(z, 2)})
        s = welford_push(s, p["v"])
        e = ewma_push(e, p["v"], alpha)
    return {"n": s["n"], "mean": round(s["mean"], 3), "sd": round(stdev(s), 3), "ewma": None if e is None else round(e, 3),
            "anomalies": anomalies, **vpin([p["v"] for p in points])}


def load(path):
    if path.lower().endswith(".csv"):
        with open(path, encoding="utf-8", newline="") as fh:
            rows = [r for r in csv.reader(fh) if r]
        pts = []
        for r in rows:
            try:
                pts.append({"t": float(r[0]), "v": float(r[1])})
            except (ValueError, IndexError):
                continue
        return pts
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh)
    pts = [{"t": float(p[0]), "v": float(p[1])} if isinstance(p, list) else {"t": float(p["t"]), "v": float(p["v"])} for p in raw]
    if any(not (math.isfinite(p["t"]) and math.isfinite(p["v"])) for p in pts):
        raise ValueError("every t and v must be a finite number")
    return pts


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("series")
    ap.add_argument("--threshold", type=int, default=120)
    ap.add_argument("--alpha", type=float, default=0.1)
    ap.add_argument("--limit", type=float, default=3.0)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    try:
        pts = sorted(load(a.series), key=lambda p: p["t"])
    except (OSError, ValueError, KeyError, TypeError) as e:
        print("ts_math: " + str(e), file=sys.stderr)
        return 2
    rep = analyse(pts, a.alpha, a.limit)
    rep["drawn"] = lttb(pts, a.threshold)
    if a.json:
        print(json.dumps(rep, indent=1))
    else:
        print(f"{rep['n']} points · mean {rep['mean']} · sd {rep['sd']} · EWMA {rep['ewma']} · VPIN {rep['vpin']} [INFERENCE]")
        print(f"{len(rep['anomalies'])} anomalies (|z| > {a.limit}) · LTTB keeps {len(rep['drawn'])} of {rep['n']} points")
        for x in rep["anomalies"][:10]:
            print(f"  t={x['t']} v={x['v']} z={x['z']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
