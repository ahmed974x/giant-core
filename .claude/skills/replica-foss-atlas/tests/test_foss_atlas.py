import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import foss_atlas as fa  # noqa: E402


class Atlas(unittest.TestCase):
    def test_every_licence_has_its_file_and_date(self):
        for e in fa.FOSS_ATLAS:
            if e["licence"] is not None:
                self.assertTrue(e["licence"]["file"].startswith("https://raw.githubusercontent.com/"))
                self.assertEqual(e["licence"]["read"], "2026-11-12")
        self.assertIsNone(next(e for e in fa.FOSS_ATLAS if e["id"] == "free-for-dev")["licence"])
        self.assertEqual(sum(1 for e in fa.FOSS_ATLAS if e["kind"] == "skill-idea"), 7)
        self.assertTrue(all(e["status"] == "idea" for e in fa.FOSS_ATLAS if e["kind"] == "skill-idea"))


class Plan(unittest.TestCase):
    def test_installs_and_outbound_are_locked(self):
        p = fa.plan_foss_stack({"selectedIds": ["nextcloud", "n8n", "agentmemory"], "prices": {"nextcloud": 1200}})
        locked = [s for s in p["steps"] if s["category"]]
        self.assertEqual([s["category"] for s in locked], ["install", "install", "outbound", "install"])
        self.assertTrue(all(s["gate"] == "approval" and s["locked"] and s["status"] == "pending_approval" for s in locked))
        self.assertTrue(p["proof"]["verified"] and p["verified"])
        self.assertEqual(p["savings"]["usd_per_year"], 1200)
        self.assertEqual(p["mcp"]["servers"], {})
        self.assertFalse(p["blueprint"]["active"])

    def test_no_savings_without_prices(self):
        self.assertIsNone(fa.plan_foss_stack({"selectedIds": ["gimp"]})["savings"])

    def test_secret_is_not_returned(self):
        probe = "Jarvis-Sovereign-Test-2026!"
        p = fa.plan_foss_stack({"selectedIds": ["gimp"], "secretCheck": probe})
        self.assertNotIn(probe, json.dumps(p))
        self.assertEqual(len(p["secret"]["prefix"]), 5)
        self.assertFalse(p["secret"]["looked_up"])

    def test_refusals(self):
        for bad in ({}, {"selectedIds": ["nope"]}, {"selectedIds": ["gimp"], "prices": {"gimp": -1}}, {"selectedIds": ["gimp"], "secretCheck": ""}):
            with self.assertRaises(fa.AtlasError):
                fa.plan_foss_stack(bad)


class Shield(unittest.TestCase):
    def test_scrub(self):
        key = "sk" + "-" + "a" * 24
        r = fa.scrub_private("mail a.b@x.org " + key + " card 4111 1111 1111 1111 not 4111 1111 1111 1112")
        self.assertNotIn("a.b@x.org", r["text"])
        self.assertNotIn(key, r["text"])
        self.assertIn("4111 1111 1111 1112", r["text"])
        self.assertEqual(r["total"], 3)

    def test_personas_are_labelled(self):
        p = fa.personas({"seed": 158, "count": 3})
        self.assertEqual(p["label"]["ar"], "مثال تعليمي — أرقام افتراضية")
        self.assertEqual(p, fa.personas({"seed": 158, "count": 3}))

    def test_no_code_is_run(self):
        with open(fa.__file__, encoding="utf-8") as fh:
            src = fh.read()
        for word in ("ev" + "al(", "ex" + "ec(", "sub" + "process", "os." + "system", "import" + "lib", "soc" + "ket", "url" + "lib"):
            self.assertNotIn(word, src)


class SameAsServer(unittest.TestCase):
    def test_golden(self):
        with open(os.path.join(HERE, "golden.json"), encoding="utf-8") as fh:
            g = json.load(fh)

        def run(f, r):
            try:
                return json.loads(json.dumps(f(r)))
            except fa.AtlasError as e:
                return {"error": str(e), "detail": e.detail}
        self.assertEqual(json.loads(json.dumps(fa.atlas_view())), g["atlas"])
        for r, w in zip(g["requests"]["plans"], g["plans"], strict=True):
            self.assertEqual(run(fa.plan_foss_stack, r), w)
        for t, w in zip(g["requests"]["scrubs"], g["scrubs"], strict=True):
            self.assertEqual(run(fa.scrub_private, t), w)
        for r, w in zip([{}, {"seed": 7, "count": 12}, {"seed": 0, "count": 1}, {"count": 13}, {"count": 0}], g["personas"], strict=True):
            self.assertEqual(run(fa.personas, r), w)


if __name__ == "__main__":
    unittest.main()
