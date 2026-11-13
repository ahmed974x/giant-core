"""Tests for the vendored reviews.py (ADR-134), written in giant-core.
Run: python3 -m unittest discover -s .claude/skills/replica-entrepreneur/tests -v
"""
import contextlib
import io
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import reviews  # noqa: E402


class Reviews(unittest.TestCase):
    def csv(self, rows):
        fh = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, encoding="utf-8", newline="")
        fh.write("source,url,date,rating,text\n")
        for r in rows:
            fh.write(",".join('"%s"' % c.replace('"', '""') for c in r) + "\n")
        fh.close()
        self.addCleanup(os.unlink, fh.name)
        return fh.name

    def test_rows_without_a_link_are_dropped_not_guessed(self):
        path = self.csv([
            ("reddit", "https://example.com/r/1", "2026-10-01", "1", "Way too expensive for what it does."),
            ("reddit", "", "2026-10-01", "1", "No link, must not count."),
            ("reddit", "not-a-url", "2026-10-01", "1", "Bad link, must not count."),
            ("reddit", "https://example.com/r/1b", "2026-10-01", "1", "Way too expensive for what it does."),
        ])
        kept, dropped, dupes = reviews.load_reviews(path)
        self.assertEqual((len(kept), dropped, dupes), (1, 2, 1))

    def test_quotes_are_verbatim_substrings_with_their_link(self):
        rows = [
            ("app-store", "https://example.com/a/%d" % i, "2026-09-0%d" % (i + 1), str(1 + i % 2), text)
            for i, text in enumerate([
                "The app crashes every time I open a file. Please fix it.",
                "It keeps crashing on start. Otherwise fine.",
                "Crashes, crashes, crashes. I wish there was an offline mode.",
            ])
        ]
        path = self.csv(rows)
        themes, req = reviews.load_themes()
        kept, _, _ = reviews.load_reviews(path)
        result = reviews.analyse(kept, themes, req, today=reviews.parse_date("2026-11-04"))
        bugs = next(t for t in result["themes"] if t["id"] == "bugs")
        self.assertEqual(bugs["count"], 3)
        self.assertTrue(bugs["thin"])  # one source only
        texts = {r[1]: r[4] for r in rows}
        for q in bugs["quotes"]:
            self.assertIn(q["quote"].strip("."), texts[q["url"]])
        self.assertTrue(any("offline" in r["quote"] for r in result["requests"]))

    def test_small_sample_warning_and_exit_codes(self):
        path = self.csv([("g2", "https://example.com/g/1", "2026-10-10", "2", "Support never replied to my ticket.")])
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.assertEqual(reviews.main([path, "--today", "2026-11-04"]), 0)
        self.assertIn("Small sample", buf.getvalue())
        empty = self.csv([("g2", "", "", "", "no link")])
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(reviews.main([empty]), 2)


if __name__ == "__main__":
    unittest.main()
