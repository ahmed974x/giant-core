"""Tests for replica-reversal-engine: plan locks, template rules, fixed points and parity with the server."""
import contextlib
import hashlib
import io
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import reversal_engine as rv

CSS = ".hero { background: linear-gradient(135deg, #3b82f6, #8b5cf6) }\n.bar { backdrop-filter: blur(16px) }\n.c { border-image: linear-gradient(red, orange) 1 }"
# SHA-256 of the corrected CSS as jarvis/server/lib/reversal.mjs writes it (node, 2026-11-06).
SERVER_AFTER = "c2cc1e2fedd495fcdcb81bcb84ed4dc27447c4b46c74a4ce051e4296524865ff"


class Plan(unittest.TestCase):
    def test_sensitive_steps_are_locked_and_pending(self):
        r = rv.reverse_and_correct_plan([{"title": "Read the commits"}, {"title": "ادفع فاتورة الاستضافة", "locked": False},
                                         {"title": "Publish the site", "gate": "approval", "locked": True, "status": "done"},
                                         {"title": "Email the team", "gate": "approval", "locked": True, "status": "pending_approval"}])
        self.assertEqual([(c["step"], c["category"]) for c in r["corrections"]], [(1, "money"), (2, "publish")])
        for s in r["steps"][1:]:
            self.assertEqual((s["gate"], s["locked"], s["status"], s["kind"]), ("approval", True, "pending_approval", "approval"))
        self.assertNotIn("locked", r["steps"][0])
        self.assertTrue(r["proof"]["verified"])
        self.assertEqual(r["vector"]["values"], [2, 0, 0, 0, 0])

    def test_categories_and_declared_locks(self):
        r = rv.reverse_and_correct_plan(["Grant admin access", "Install the plugin", {"title": "Do the thing", "gate": "approval"}, {"title": "Tidy", "category": "money"}])
        self.assertEqual([c["category"] for c in r["corrections"]], ["permissions", "install", "outbound", "money"])

    def test_fixed_point_and_hashes(self):
        r = rv.reverse_and_correct_plan([{"title": "Pay the invoice"}])
        again = rv.reverse_and_correct_plan(r["steps"])
        self.assertEqual(again["corrections"], [])
        self.assertFalse(again["changed"])
        self.assertEqual(r["before"], hashlib.sha256(b'[{"title":"Pay the invoice"}]').hexdigest())
        self.assertEqual(r["proofHash"], hashlib.sha256((r["before"] + "\n" + r["after"] + "\n" + rv.compact(r["corrections"])).encode()).hexdigest())

    def test_bad_input_is_an_empty_plan(self):
        self.assertEqual(rv.reverse_and_correct_plan(None)["steps"], [])
        self.assertEqual(len(rv.reverse_and_correct_plan([{"title": "x"}] * 30)["steps"]), 20)


class Template(unittest.TestCase):
    def test_rules_and_server_parity(self):
        r = rv.reverse_and_correct_template(CSS)
        self.assertEqual([c["rule"] for c in r["corrections"]], ["ai-gradient", "gradient", "reduced-transparency", "overflow-wrap"])
        self.assertNotIn("gradient(", r["text"])
        self.assertIn("background-color: #3b82f6", r["text"])
        self.assertIn("border-image: none", r["text"])
        self.assertEqual(r["after"], SERVER_AFTER)
        self.assertEqual(rv.reverse_and_correct_template(r["text"])["corrections"], [])

    def test_hues_and_ai_gradient(self):
        self.assertEqual((rv.hue_of("#0000ff"), rv.hue_of("purple"), rv.hue_of("#808080"), rv.hue_of("oklch(54.5% 0.197 257.4)")), (240, 300, None, 235))
        self.assertIs(rv.hue_of("to"), rv.UNKNOWN)
        self.assertTrue(rv.is_ai_gradient("linear-gradient(90deg, #2563eb, #7c3aed)"))
        self.assertFalse(rv.is_ai_gradient("linear-gradient(#2563eb, #0ea5e9)"))

    def test_html_gets_a_style_in_its_head(self):
        r = rv.reverse_and_correct_template('<html><head></head><body><p style="background-image: radial-gradient(#00f, #800080)">x</p></body></html>')
        self.assertIn("</style>\n</head>", r["text"])
        self.assertIn('style="background-color: #00f"', r["text"])
        self.assertTrue(r["html"])
        self.assertEqual(rv.glass_selectors(".a{backdrop-filter:blur(4px)} .b{backdrop-filter:none} @media (prefers-reduced-transparency: reduce){.c{backdrop-filter:none}} .c{-webkit-backdrop-filter:blur(2px)}"), [".a"])
        self.assertFalse(rv.reverse_and_correct_template("")["changed"])

    def test_cli_writes_a_copy_and_never_over_the_input(self):
        with tempfile.TemporaryDirectory() as d:
            src, dst = os.path.join(d, "a.css"), os.path.join(d, "b.css")
            with open(src, "w", encoding="utf-8") as fh:
                fh.write(CSS)
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                rv.main(["template", src, "--out", dst])
            out = json.loads(buf.getvalue())
            with open(dst, encoding="utf-8") as fh:
                self.assertEqual(fh.read(), out["text"])
            with open(src, encoding="utf-8") as fh:
                self.assertEqual(fh.read(), CSS)
            self.assertEqual(len(out["lines"]), 4)
            with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
                rv.main(["template", src, "--out", src])


if __name__ == "__main__":
    unittest.main()
