"""Tests for the vendored replica-diff tools (ADR-133), written in giant-core.
Run: python3 -m unittest discover -s .claude/skills/replica-diff/tests -v
"""
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
import imgdiff  # noqa: E402
import parity  # noqa: E402


def write_png(path, w, h, colour_at):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w):
            raw.extend(colour_at(x, y))

    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))

    with open(path, "wb") as fh:
        fh.write(imgdiff.SIG + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                 + chunk(b"IDAT", zlib.compress(bytes(raw))) + chunk(b"IEND", b""))


class Parity(unittest.TestCase):
    def matrix(self, rows):
        fh = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, encoding="utf-8")
        fh.write("feature,area,priority,original,clone,notes\n")
        for r in rows:
            fh.write(",".join(r) + "\n")
        fh.close()
        self.addCleanup(os.unlink, fh.name)
        return fh.name

    def test_weights_partial_skip_and_extras(self):
        path = self.matrix([
            ("A", "x", "must", "yes", "yes", ""),
            ("B", "x", "must", "yes", "partial", "half"),
            ("C", "y", "should", "yes", "no", ""),
            ("D", "y", "could", "yes", "skip", "licensed"),
            ("E", "y", "could", "no", "yes", "ours"),
        ])
        r = parity.score(parity.load(path))
        # counted: A 3*1 + B 3*0.5 + C 2*0 = 4.5 of 8
        self.assertEqual(r["feature_score"], 56.2)
        self.assertEqual((r["must_have_done"], r["must_have_total"]), (1, 2))
        self.assertEqual([m["feature"] for m in r["missing"]], ["B", "C"])
        self.assertEqual([m["feature"] for m in r["skipped"]], ["D"])
        self.assertEqual([m["feature"] for m in r["extras"]], ["E"])

    def test_fail_under_and_bad_file(self):
        path = self.matrix([("A", "x", "must", "yes", "no", "")])
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(parity.main([path, "--fail-under", "50"]), 1)
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(parity.main([path + ".missing"]), 2)

    def test_jarvis_matrix_parses(self):
        repo = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
        rows = parity.load(os.path.join(repo, "jarvis", "replica", "features.csv"))
        r = parity.score(rows)
        self.assertEqual(r["problems"], [])
        self.assertGreater(r["must_have_total"], 0)


class ImgDiff(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)

    def png(self, name, fn, w=96, h=64):
        p = os.path.join(self.dir.name, name)
        write_png(p, w, h, fn)
        return p

    def test_same_layout_new_colours_matches(self):
        box = lambda col, bg: (lambda x, y: col if 20 <= x < 70 and 10 <= y < 40 else bg)  # noqa: E731
        a = imgdiff.read_png(self.png("a.png", box((0, 0, 0), (255, 255, 255))))
        b = imgdiff.read_png(self.png("b.png", box((20, 90, 230), (245, 246, 250))))
        report, _ = imgdiff.compare(a, b, width=96, cols=8)
        self.assertGreaterEqual(report["score"], 90)
        self.assertEqual(report["verdict"], "matches")

    def test_moved_block_differs(self):
        a = imgdiff.read_png(self.png("a.png", lambda x, y: (0, 0, 0) if x < 30 else (255, 255, 255)))
        b = imgdiff.read_png(self.png("b.png", lambda x, y: (0, 0, 0) if x > 66 else (255, 255, 255)))
        report, _ = imgdiff.compare(a, b, width=96, cols=8)
        self.assertLess(report["score"], 75)
        self.assertTrue(report["regions"])

    def test_json_cli_and_diff_image(self):
        a = self.png("a.png", lambda x, y: (255, 255, 255))
        out = os.path.join(self.dir.name, "d.png")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.assertEqual(imgdiff.main([a, a, "--json", "--out", out]), 0)
        self.assertEqual(json.loads(buf.getvalue())["score"], 100.0)
        self.assertTrue(os.path.getsize(out) > 0)

    def test_rejects_non_png(self):
        bad = os.path.join(self.dir.name, "x.png")
        with open(bad, "wb") as fh:
            fh.write(b"nope")
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(imgdiff.main([bad, bad]), 2)


if __name__ == "__main__":
    unittest.main()
