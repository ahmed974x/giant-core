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
        self.assertEqual(r["vector"]["values"], [2, 0, 0, 0, 0, 0])

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


class Contrast(unittest.TestCase):
    CSS = ".card { color: #777777; background-color: #ffffff }\n.dark{color:oklch(55% 0.2 260);background:#090b10}\n.hero { background: #3b82f6; color: #4b5563 }"
    # The server's reverseTemplate for CSS above (node, 2026-11-07): the same text and hashes.
    SERVER_AFTER = "98b980f20d044550736a0e2ab5420e9105469ca97bffe1bd639d9d4fab93820f"
    SERVER_PROOF = "5660460ed185f2bbfa8230033b5ba82e651c97838360a44e4315196c863e948a"

    def test_heal_and_parity(self):
        r = rv.reverse_and_correct_template(self.CSS)
        heals = [c for c in r["corrections"] if c["rule"] == "contrast"]
        self.assertEqual([(c["selector"], c["from"], c["to"]) for c in heals], [(".card", "#777777", "#767676"), (".dark", "oklch(55% 0.2 260)", "#84b2ff")])
        self.assertEqual((r["after"], r["proofHash"]), (self.SERVER_AFTER, self.SERVER_PROOF))
        self.assertEqual(rv.reverse_and_correct_template(r["text"])["corrections"], [])
        self.assertIn("#3b82f6; color: #4b5563", r["text"])

    def test_bisection(self):
        h = rv.heal_oklch_contrast("#ff0000", "#00ff00")
        self.assertEqual((h["after"]["hex"], h["steps"], h["direction"], h["chromaReduced"]), ("#bf0000", 16, "darker", True))
        self.assertAlmostEqual(rv.rgb_to_oklch(rv.parse_colour(h["after"]["hex"]))[2], rv.rgb_to_oklch(rv.parse_colour("#ff0000"))[2], delta=1)
        light = rv.heal_oklch_contrast("#777777", "#000000")
        self.assertEqual((light["direction"], light["after"]["hex"]), ("lighter", "#b1b1b1"))
        self.assertGreaterEqual(rv.wcag_ratio(rv.parse_colour(light["after"]["hex"]), [0, 0, 0]), 4.5)
        self.assertFalse(rv.heal_oklch_contrast("#808080", "#808080")["ok"])
        self.assertEqual(rv.heal_oklch_contrast("x", "#fff")["reason"], "not-a-colour")
        self.assertFalse(rv.heal_oklch_contrast("#eef2f8", "#090b10")["changed"])
        self.assertEqual(rv.heal_oklch_contrast("#767676", "#ffffff", large=True)["target"], {"ratio": 3, "lc": 60})


if __name__ == "__main__":
    unittest.main()
