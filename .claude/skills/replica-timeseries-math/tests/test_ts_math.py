"""Tests for replica-timeseries-math: exact against statistics, and LTTB keeps the extremes."""
import contextlib
import io
import json
import os
import random
import statistics
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import ts_math as ts


def series(n=5000, seed=147):
    rng = random.Random(seed)
    # Bounded noise (|z| stays under 1.8), so only the planted spikes can pass |z| > 3.
    pts = [{"t": i, "v": 10 + rng.uniform(-1, 1)} for i in range(n)]
    for i in (1200, 2500, 4100):
        if i < n:
            pts[i]["v"] = 40.0
    if n > 3300:
        pts[3300]["v"] = -25.0
    return pts


class Stats(unittest.TestCase):
    def test_welford_matches_statistics(self):
        xs = [p["v"] for p in series(1000)]
        s = ts.welford()
        for x in xs:
            s = ts.welford_push(s, x)
        self.assertAlmostEqual(s["mean"], statistics.fmean(xs), places=9)
        self.assertAlmostEqual(ts.stdev(s), statistics.stdev(xs), places=9)
        self.assertEqual(ts.variance(ts.welford_push(ts.welford(), 5.0)), 0.0)

    def test_ewma(self):
        e = None
        for x in (10, 20, 20):
            e = ts.ewma_push(e, x, 0.5)
        self.assertEqual(e, 17.5)

    def test_anomalies_found_online(self):
        r = ts.analyse(series())
        self.assertEqual(sorted(a["t"] for a in r["anomalies"]), [1200, 2500, 3300, 4100])
        self.assertTrue(all(abs(a["z"]) > 3 for a in r["anomalies"]))

    def test_vpin(self):
        self.assertEqual(ts.vpin(list(range(101)), size=50)["vpin"], 1.0)
        zig = [i % 2 for i in range(101)]
        self.assertEqual(ts.vpin(zig, size=50)["vpin"], 0.0)
        self.assertIsNone(ts.vpin([1, 2, 3])["vpin"])


class Lttb(unittest.TestCase):
    def test_keeps_extremes_and_size(self):
        pts = series()
        d = ts.lttb(pts, 120)
        self.assertEqual(len(d), 120)
        self.assertEqual((d[0], d[-1]), (pts[0], pts[-1]))
        kept = {p["t"] for p in d}
        for t in (1200, 2500, 3300, 4100):
            self.assertIn(t, kept)
        self.assertEqual(ts.lttb(pts[:50], 120), pts[:50])

    def test_cli(self):
        d = tempfile.mkdtemp()
        p = os.path.join(d, "s.json")
        with open(p, "w", encoding="utf-8") as fh:
            json.dump([[i, (i % 7) * 1.0] for i in range(400)], fh)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(ts.main([p, "--threshold", "50", "--json"]), 0)
        self.assertEqual(len(json.loads(out.getvalue())["drawn"]), 50)
        with open(p, "w", encoding="utf-8") as fh:
            fh.write('[{"t": 1, "v": "nan"}]')
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(ts.main([p]), 2)


if __name__ == "__main__":
    unittest.main()
