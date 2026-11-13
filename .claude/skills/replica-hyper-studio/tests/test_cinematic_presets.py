import json
import math
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import cinematic_presets as cp  # noqa: E402
from hyper_studio import HyperError  # noqa: E402


class Presets(unittest.TestCase):
    def test_all_verify(self):
        self.assertEqual(len(cp.CINEMATIC_PRESETS), 21)
        for p in cp.CINEMATIC_PRESETS:
            for theme in ("dark", "light"):
                o = cp.compile_cinematic({"preset": p["id"], "theme": theme})
                self.assertTrue(o["verified"], (p["id"], theme))
                self.assertEqual(o["tag"], "[INFERENCE]")

    def test_lights_readable(self):
        o = cp.compile_cinematic({"preset": "golden_hour_5200k", "theme": "light"})
        for k in ("key", "fill", "rim"):
            self.assertTrue(o["labels"][k]["healed"])
            self.assertGreaterEqual(o["labels"][k]["wcag"], 4.5)
            self.assertGreaterEqual(abs(o["labels"][k]["apca"]), 60)

    def test_svg_has_no_text_or_gradient(self):
        svg = cp.compile_cinematic({"preset": "desert_dusk"})["svg"]
        self.assertTrue(svg.startswith("<svg") and "#77bcff" in svg)
        for word in ("<text", "<script", "gradient"):
            self.assertNotIn(word, svg)

    def test_spiral_converges(self):
        g = cp.golden_rect(640, 360)
        rest, eye = cp.golden_spiral(g, 40)["rest"], cp.spiral_eye(g)
        self.assertLess(math.hypot(rest["x"] - eye[0], rest["y"] - eye[1]), 1e-4)

    def test_refusals(self):
        for bad in ({"preset": "warp"}, {}, {"preset": "macro_closeup", "subject_distance_m": 0.05}):
            with self.assertRaises(HyperError):
                cp.compile_cinematic(bad)

    def test_no_code_is_run(self):
        with open(cp.__file__, encoding="utf-8") as fh:
            src = fh.read()
        for word in ("ev" + "al(", "ex" + "ec(", "sub" + "process", "os." + "system", "import" + "lib", "soc" + "ket", "url" + "lib"):
            self.assertNotIn(word, src)


class SameAsServer(unittest.TestCase):
    def test_golden(self):
        with open(os.path.join(HERE, "golden-cinematic.json"), encoding="utf-8") as fh:
            g = json.load(fh)
        for req, want in zip(g["requests"], g["outputs"], strict=True):
            try:
                got = cp.compile_cinematic(req)
            except HyperError as e:
                got = {"error": str(e), "detail": e.detail}
            self.assertEqual(json.loads(json.dumps(got)), want)
        self.assertEqual(json.loads(json.dumps(cp.preset_list())), g["list"])


if __name__ == "__main__":
    unittest.main()
