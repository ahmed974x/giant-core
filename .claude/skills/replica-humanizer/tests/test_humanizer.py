"""Tests for humanize (fixed table, Arabic and English; copies only)."""
import contextlib
import io
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import humanize as hz


class Humanizer(unittest.TestCase):
    def test_english_suggestions_keep_case(self):
        s = hz.suggestions("In order to ship, we utilize the cache.\nIt is important to note that it works.")
        found = {(x["found"].lower(), x["suggest"]) for x in s}
        self.assertIn(("in order to", "To"), found)
        self.assertIn(("utilize", "use"), found)
        self.assertTrue(any(x["suggest"] == "(drop it)" for x in s))

    def test_arabic_suggestions(self):
        s = hz.suggestions("في عالمنا اليوم، تجدر الإشارة إلى أن الأداة تعمل بشكل فعّال.")
        self.assertEqual({x["lang"] for x in s}, {"ar"})
        self.assertGreaterEqual(len(s), 3)

    def test_rewrite_and_code_left_alone(self):
        text = "In order to start, utilize this.\n```\nin order to = 1\n```\n    utilize(x)\n"
        out = hz.rewrite(text)
        self.assertTrue(out.startswith("To start, use this."), out)
        self.assertIn("in order to = 1", out)
        self.assertIn("    utilize(x)", out)

    def test_out_is_a_copy_inside_root(self):
        root = tempfile.mkdtemp()
        with open(os.path.join(root, "a.md"), "w", encoding="utf-8") as fh:
            fh.write("We utilize it.\n")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.assertEqual(hz.main(["a.md", "--root", root, "--out", "work/a.plain.md"]), 0)
        with open(os.path.join(root, "work/a.plain.md"), encoding="utf-8") as fh:
            self.assertEqual(fh.read(), "We use it.\n")
        with open(os.path.join(root, "a.md"), encoding="utf-8") as fh:
            self.assertEqual(fh.read(), "We utilize it.\n")
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            self.assertEqual(hz.main(["a.md", "--root", root, "--out", "a.md"]), 2)
            self.assertEqual(hz.main(["../etc/passwd", "--root", root]), 2)


if __name__ == "__main__":
    unittest.main()
