"""Tests for replica-design tools. Run: python3 -m unittest discover -s tests -v"""
import contextlib
import io
import json
import os
import struct
import sys
import tempfile
import unittest
import zlib

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import build_tokens  # noqa: E402
import contrast  # noqa: E402
import sample  # noqa: E402

TEMPLATE = os.path.join(HERE, "templates", "tokens.json")


def write_png(path, w, h, colour_at, ctype=2, filt=0):
    ch = {2: 3, 6: 4}[ctype]
    raw = bytearray()
    prev = bytearray(w * ch)
    for y in range(h):
        line = bytearray()
        for x in range(w):
            px = colour_at(x, y)
            line += bytes(px[:3]) + (bytes([px[3] if len(px) > 3 else 255]) if ch == 4 else b"")
        if filt == 2:  # Up filter, to exercise un-filtering
            enc = bytearray((line[i] - prev[i]) & 255 for i in range(len(line)))
        elif filt == 1:  # Sub filter
            enc = bytearray((line[i] - (line[i - ch] if i >= ch else 0)) & 255 for i in range(len(line)))
        else:
            enc = line
        raw += bytes([filt]) + enc
        prev = line

    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))

    with open(path, "wb") as fh:
        fh.write(sample.SIG + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, ctype, 0, 0, 0))
                 + chunk(b"IDAT", zlib.compress(bytes(raw))) + chunk(b"IEND", b""))


class Contrast(unittest.TestCase):
    def test_known_ratios(self):
        self.assertAlmostEqual(contrast.ratio("#000000", "#ffffff"), 21.0, places=2)
        self.assertAlmostEqual(contrast.ratio("#777777", "#ffffff"), 4.48, places=2)

    def test_template_passes_both_themes(self):
        with open(TEMPLATE) as fh:
            tokens = json.load(fh)
        names = [n for n, _ in contrast.themes(tokens)]
        self.assertEqual(names, ["light", "dark"])
        self.assertEqual(contrast.main([TEMPLATE]), 0)

    def test_dark_inherits_and_fails(self):
        tokens = {"color": {"text": "#111111", "bg": "#ffffff"},
                  "color-dark": {"bg": "#000000"}, "pairs": [["text", "bg"]]}
        rows = [r for n, c in contrast.themes(tokens) for r in contrast.check(n, c, tokens["pairs"])]
        self.assertTrue(rows[0]["aa"])
        self.assertFalse(rows[1]["aa"])

    def test_apca_reference_values(self):
        self.assertAlmostEqual(contrast.apca("#000000", "#ffffff"), 106.04, places=1)
        self.assertAlmostEqual(contrast.apca("#ffffff", "#000000"), -107.88, places=1)

    def test_apca_gate_fails_low_lc_text(self):
        # #767676 on white passes WCAG 4.5:1 but is about Lc 71.6, so an 80 floor fails it.
        rows = contrast.check("light", {"t": "#767676", "b": "#ffffff"}, [["t", "b"]], 80)
        self.assertGreaterEqual(rows[0]["ratio"], 4.5)
        self.assertFalse(rows[0]["aa"])
        ui = contrast.check("light", {"t": "#767676", "b": "#ffffff"}, [["t", "b", "ui"]], 80)
        self.assertTrue(ui[0]["aa"])

    def test_unknown_token_fails(self):
        rows = contrast.check("light", {"a": "#fff"}, [["a", "nope"]])
        self.assertTrue(contrast.failed(rows[0]))


class Build(unittest.TestCase):
    def test_outputs(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(build_tokens.main([TEMPLATE, "--out", d]), 0)
            css = open(os.path.join(d, "tokens.css")).read()
            js = open(os.path.join(d, "tailwind.tokens.js")).read()
        self.assertIn("--color-accent: #2f5bea;", css)
        self.assertIn('[data-theme="dark"]', css)
        self.assertIn("prefers-color-scheme: dark", css)
        self.assertIn('"muted": "var(--color-text-muted)"', js)
        self.assertNotIn("#2f5bea", js)

    def test_oklch_matches_design_md(self):
        self.assertEqual(build_tokens.oklch("#F5F5F7"), "oklch(97.1% 0.003 286.4)")
        self.assertEqual(build_tokens.oklch("#1C1C1E"), "oklch(22.7% 0.004 286.1)")
        try:
            with tempfile.TemporaryDirectory() as d:
                build_tokens.main([TEMPLATE, "--out", d, "--oklch"])
                css = open(os.path.join(d, "tokens.css")).read()
        finally:
            build_tokens.FORMAT["oklch"] = False
        self.assertIn("--color-bg: oklch(100.0% 0.000 0.0); /* #ffffff */", css)

    def test_dark_first(self):
        with open(TEMPLATE) as fh:
            t = json.load(fh)
        t["theme-default"] = "dark"
        css = build_tokens.build_css(t)
        root = css[css.index(":root {"):css.index("}")]
        self.assertIn("--color-bg: %s;" % t["color-dark"]["bg"], root)
        self.assertIn(':root[data-theme="light"]', css)
        self.assertNotIn("prefers-color-scheme", css)

    def test_tailwind4(self):
        with tempfile.TemporaryDirectory() as d:
            build_tokens.main([TEMPLATE, "--out", d, "--tailwind4"])
            css = open(os.path.join(d, "tokens.css")).read()
            self.assertFalse(os.path.exists(os.path.join(d, "tailwind.tokens.js")))
        self.assertIn("@theme inline", css)


class Sample(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.dir.cleanup()

    def img(self, name, **kw):
        path = os.path.join(self.dir.name, name)
        # left 3/4 light grey, right 1/4 blue
        write_png(path, 40, 20, lambda x, y: (47, 91, 234) if x >= 30 else (246, 247, 249), **kw)
        return path

    def test_top_and_at_with_filters(self):
        for filt in (0, 1, 2):
            path = self.img("f%d.png" % filt, filt=filt)
            top = sample.top_colours([sample.read_png(path)], 5, 10)
            self.assertEqual(top[0]["hex"], "#f6f7f9")
            self.assertAlmostEqual(top[0]["share"], 75.0, places=1)
            self.assertEqual(top[1]["hex"], "#2f5bea")
            pts = sample.at(sample.read_png(path), ["35,10", "5,5", "99,99"])
            self.assertEqual(pts[0]["hex"], "#2f5bea")
            self.assertEqual(pts[1]["hex"], "#f6f7f9")
            self.assertIn("error", pts[2])

    def test_alpha_composited_on_white(self):
        path = os.path.join(self.dir.name, "a.png")
        write_png(path, 2, 2, lambda x, y: (0, 0, 0, 0), ctype=6)
        self.assertEqual(sample.read_png(path)[2](0, 0), (255, 255, 255))

    def test_cli_rejects_non_png(self):
        bad = os.path.join(self.dir.name, "x.png")
        open(bad, "wb").write(b"nope")
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(sample.main([bad]), 2)


if __name__ == "__main__":
    unittest.main()
