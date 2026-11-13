import json
import math
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import hyper_studio as hs  # noqa: E402


class Shapes(unittest.TestCase):
    def test_e8(self):
        g = hs.hyper({"mode": "projection", "dimension": 8, "polytope": "e8_lattice", "angles": {"xy": 15, "zw": 30, "xw": 45}})
        self.assertTrue(g["verified"])
        self.assertEqual(g["counts"], {"vertices": 240, "edges": 6720, "faces": 0})
        roots = hs.e8_roots()["vertices"]
        self.assertTrue(all(abs(hs.dot(v, v) - 2) < 1e-12 for v in roots))

    def test_coxeter_plane(self):
        cp = hs.coxeter_plane()
        self.assertAlmostEqual(cp["top"][0], 2 * math.cos(2 * math.pi / 30), places=10)
        self.assertAlmostEqual(hs.dot(cp["u"], cp["v"]), 0, places=12)
        rings = hs.rings([[hs.dot(p, cp["u"]), hs.dot(p, cp["v"])] for p in hs.e8_roots()["vertices"]])
        self.assertEqual([g["n"] for g in rings], [30] * 8)

    def test_tesseract_and_16cell(self):
        t, c = hs.hypercube(4), hs.sixteen_cell()
        self.assertEqual((len(t["vertices"]), len(t["edges"])), (16, 32))
        self.assertEqual((len(c["vertices"]), len(c["edges"])), (8, 24))
        self.assertTrue(hs.hyper({"mode": "projection", "polytope": "tesseract", "angles": {"xw": 30, "yz": 20}})["verified"])

    def test_cube_painter(self):
        g = hs.hyper({"mode": "projection", "polytope": "cube", "angles": {"xy": 20, "yz": 30, "xz": 25}, "theme": "light"})
        depths = [f["depth"] for f in g["faces"]]
        self.assertEqual(depths, sorted(depths))
        self.assertEqual(g["accent"], "#0b5ed7")
        self.assertTrue(all(f["fill"].startswith("oklch(") for f in g["faces"]))

    def test_svg_is_numbers_only(self):
        svg = hs.hyper_svg(hs.hyper({"mode": "projection", "polytope": "16cell"}))
        self.assertTrue(svg.startswith("<svg") and "<script" not in svg and "#77bcff" in svg)


class Optics(unittest.TestCase):
    def test_portrait(self):
        o = hs.hyper({"mode": "optics", "focal_mm": 85, "f_stop": 1.4, "subject_distance_m": 2.5, "sensor_width_mm": 36, "iso": 100, "shutter_s": 0.004})
        self.assertTrue(o["verified"])
        self.assertEqual(o["depth_of_field"]["hyperfocal_m"], 179.001)
        self.assertLess(o["depth_of_field"]["near_m"], 2.5)
        self.assertGreater(o["depth_of_field"]["far_m"], 2.5)

    def test_kelvin(self):
        warm, cool = hs.kelvin_to_colour(3200), hs.kelvin_to_colour(6500)
        self.assertGreater(int(warm["hex"][1:3], 16), int(warm["hex"][5:7], 16))
        self.assertAlmostEqual(cool["xy"][0], 0.3135, places=3)
        with self.assertRaises(hs.HyperError):
            hs.kelvin_to_colour(1000)


class Physics(unittest.TestCase):
    def test_astar_matches_bfs(self):
        g = hs.hyper({"mode": "game_physics", "grid_size": [20, 10], "start": [0, 9], "goal": [19, 0],
                      "obstacles": [[5, y] for y in range(9)] + [[12, y] for y in range(1, 10)], "ticks": 0})
        self.assertTrue(g["verified"])
        self.assertEqual(g["path_length"], g["shortest"])

    def test_no_path(self):
        g = hs.hyper({"mode": "game_physics", "grid_size": [6, 4], "start": [0, 0], "goal": [5, 0], "obstacles": [[2, y] for y in range(4)]})
        self.assertIsNone(g["path"])
        self.assertTrue(g["checks"][0]["ok"])

    def test_refusals(self):
        for bad in ({"mode": "projection", "polytope": "cube", "angles": {"xw": 1}}, {"mode": "game_physics", "grid_size": [50, 5]},
                    {"mode": "game_physics", "particles": [{"x": 1}] * 30}, {"mode": "x"}):
            with self.assertRaises(hs.HyperError):
                hs.hyper(bad)

    def test_no_code_is_run(self):
        with open(hs.__file__, encoding="utf-8") as fh:
            src = fh.read()
        for word in ("ev" + "al(", "ex" + "ec(", "sub" + "process", "os." + "system", "import" + "lib", "soc" + "ket", "url" + "lib"):
            self.assertNotIn(word, src)


class SameAsServer(unittest.TestCase):
    def test_golden(self):
        with open(os.path.join(HERE, "golden.json"), encoding="utf-8") as fh:
            g = json.load(fh)
        for req, want in zip(g["requests"], g["outputs"], strict=True):
            try:
                got = hs.hyper(req)
            except hs.HyperError as e:
                got = {"error": str(e), "detail": e.detail}
            self.assertEqual(got, want, req)


if __name__ == "__main__":
    unittest.main()
