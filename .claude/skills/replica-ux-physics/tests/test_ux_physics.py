"""Tests for replica-ux-physics: the formulas match the page's ux-physics.mjs; the fuzzer is seeded; the index hashes."""
import contextlib
import hashlib
import io
import json
import math
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import chaos_fuzzer as cf
import symbol_index as si
import ux_physics as ux

BOXES = [
    {"id": "big", "kind": "action", "group": "nav", "x": 100, "y": 700, "w": 120, "h": 48},
    {"id": "tiny", "kind": "action", "group": "nav", "x": 10, "y": 10, "w": 20, "h": 20},
    {"id": "h", "kind": "heading", "level": 1, "x": 0, "y": 100, "w": 390, "h": 40},
]


class Physics(unittest.TestCase):
    def test_fitts(self):
        f = ux.fitts(BOXES, 390, 844)
        self.assertEqual((f["small"], f["score"]), (1, 50))
        tiny = next(t for t in f["targets"] if t["id"] == "tiny")
        d = math.hypot(20 - 195, 20 - 820)
        self.assertAlmostEqual(tiny["id_bits"], round(math.log2(d / 20 + 1), 2))

    def test_hick(self):
        k = ux.hick([{"kind": "action", "group": "menu", "x": i, "y": 0, "w": 50, "h": 50} for i in range(9)])
        self.assertEqual(k["over"], 1)
        self.assertAlmostEqual(k["worstRt"], 0.2 + 0.15 * math.log2(10), places=3)

    def test_symmetry_and_heat(self):
        self.assertEqual(ux.symmetry([{"id": "a", "x": 10, "w": 100}], [{"id": "a", "x": 280, "w": 100}], 390)["score"], 100)
        self.assertLess(ux.symmetry([{"id": "a", "x": 10, "w": 100}], [{"id": "a", "x": 10, "w": 100}], 390)["score"], 100)
        g = ux.heat_grid(BOXES, 390, 844)
        self.assertEqual((len(g["grid"]), len(g["grid"][0])), (16, 24))
        self.assertEqual(max(v for r in g["grid"] for v in r), 1)

    def test_html_mode(self):
        html = "<nav>" + "".join(f"<a class='nav'>{i}</a>" for i in range(9)) + "</nav><button class='btn'>Go</button>"
        css = ".nav { min-height: 32px } .btn { min-height: 44px; min-width: 44px } .card { margin-left: 8px } pre { direction: ltr; text-align: left }"
        r = ux.report_html(html, css)
        self.assertEqual(r["hick"]["over"], 1)
        states = {k["kind"]: k["state"] for k in r["touch"]["kinds"]}
        self.assertEqual(states["a.nav"], "small")
        self.assertEqual(states["button.btn"], "ok")
        self.assertEqual([h["found"] for h in r["rtl"]["physical"]], ["margin-left"])

    def test_cli_exit_codes(self):
        d = tempfile.mkdtemp()
        p = os.path.join(d, "b.json")
        with open(p, "w", encoding="utf-8") as fh:
            json.dump(BOXES, fh)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(ux.main(["--boxes", p]), 1)
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(ux.main(["--boxes", os.path.join(d, "missing.json")]), 2)


class Fuzzer(unittest.TestCase):
    def test_seeded_and_every_kind(self):
        a, b = cf.cases(7, 40), cf.cases(7, 40)
        self.assertEqual(a, b)
        self.assertNotEqual(a, cf.cases(8, 40))
        self.assertEqual({c["kind"] for c in a}, set(cf.EXPECT))

    def test_arabic_has_tashkeel_and_rtl(self):
        c = next(c for c in cf.cases(144, 20) if c["kind"] == "arabic_tashkeel")
        self.assertEqual(c["dir"], "rtl")
        self.assertTrue(any(m in c["text"] for m in cf.TASHKEEL))
        self.assertGreater(len(c["text"]), 200)

    def test_out_stays_in_root(self):
        root = tempfile.mkdtemp()
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(cf.main(["--count", "12", "--out", "e/f.json", "--root", root]), 0)
        with open(os.path.join(root, "e/f.json"), encoding="utf-8") as fh:
            self.assertEqual(len(json.load(fh)["cases"]), 12)
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(cf.main(["--out", "../x.json", "--root", root]), 2)


class Index(unittest.TestCase):
    def test_python_and_js(self):
        d = tempfile.mkdtemp()
        with open(os.path.join(d, "a.py"), "w", encoding="utf-8") as fh:
            fh.write("# note\nLIMIT = 3\n\nclass Box:\n    def area(self, w, h):\n        return w * h\n\nasync def load(path):\n    return path\n")
        with open(os.path.join(d, "b.mjs"), "w", encoding="utf-8") as fh:
            fh.write("// x\nexport function fitts(boxes, vw, vh = 1) {}\nexport const K = 1;\nfunction local() {}\n")
        doc = si.index_paths([d])
        by = {os.path.basename(f["file"]): f for f in doc["files"]}
        names = {s["name"]: s for s in by["a.py"]["symbols"]}
        self.assertEqual(set(names), {"LIMIT", "Box", "Box.area", "load"})
        self.assertEqual(names["Box.area"]["args"], ["self", "w", "h"])
        self.assertEqual(by["a.py"]["comments"], 1)
        js = {s["name"]: s for s in by["b.mjs"]["symbols"]}
        self.assertEqual(js["fitts"]["args"], ["boxes", "vw", "vh"])
        self.assertFalse(js["local"]["exported"])
        with open(os.path.join(d, "b.mjs"), "rb") as fh:
            self.assertEqual(by["b.mjs"]["sha256"], hashlib.sha256(fh.read()).hexdigest())

    def test_syntax_error_is_reported_not_raised(self):
        d = tempfile.mkdtemp()
        with open(os.path.join(d, "bad.py"), "w", encoding="utf-8") as fh:
            fh.write("def x(:\n")
        doc = si.index_paths([d])
        self.assertIn("syntax error", doc["files"][0]["error"])


if __name__ == "__main__":
    unittest.main()
