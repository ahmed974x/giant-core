import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import prompt_metacodes as pm  # noqa: E402


class Parse(unittest.TestCase):
    def test_codes_come_out_in_one_pass(self):
        p = pm.parse_metacodes("EL10. killcritic, ALT3! HUMAN /human hello  world")
        self.assertEqual(p["codes"], ["EL10", "KILLCRITIC", "ALT3", "/HUMAN"])
        self.assertEqual(p["prompt"], "HUMAN hello world")
        self.assertFalse(p["truncated"])

    def test_long_text_is_cut(self):
        p = pm.parse_metacodes("a " * 2500)
        self.assertTrue(p["truncated"])
        self.assertEqual(len(p["prompt"].split(" ")), 2000)


class Plans(unittest.TestCase):
    def test_always_answers_and_locks(self):
        out = pm.compile_metacodes({"prompt": "deploy it, add a Stripe payment and email the customers", "lang": "en"})
        self.assertEqual(out["codes"], ["ALT3"])
        self.assertEqual([o["id"] for o in out["options"]], ["speed", "proof", "selfhost"])
        for o in out["options"]:
            locked = [s for s in o["steps"] if s["locked"]]
            self.assertEqual([s["category"] for s in locked], ["money", "publish", "outbound"])
            self.assertTrue(all(s["gate"] == "approval" and s["status"] == "pending_approval" for s in locked))
        self.assertTrue(out["verified"])

    def test_proof_refuses_an_unlocked_sensitive_step(self):
        o = pm.build_option("speed", ["money"], "en")
        bad = [dict(s) for s in o["steps"]]
        bad[-1]["locked"] = False
        self.assertFalse(pm.prove_option(bad))
        bad = [dict(s) for s in o["steps"]]
        bad[1]["after"] = None
        self.assertFalse(pm.prove_option(bad))

    def test_critic(self):
        out = pm.compile_metacodes({"prompt": "read http://192.168.1.4/ and https://example.org text #0b5ed7 on #000000 gradient key " + "sk" + "-" + "a" * 24, "codes": ["KILLCRITIC"]})
        f = {c["text"]: c for c in out["critic"]}
        self.assertNotIn("sk" + "-aaa", out["prompt"])
        self.assertEqual(f[pm.mc_text("crit.private", "en")]["data"], ["http://192.168.1.4/"])
        self.assertEqual(f[pm.mc_text("crit.public", "en")]["data"], ["https://example.org"])
        self.assertIn(pm.mc_text("crit.contrastHeal", "en"), f)
        self.assertIn(pm.mc_text("crit.gradient", "en"), f)

    def test_arabic(self):
        out = pm.compile_metacodes({"prompt": "انشر الموقع ثم أرسل بريداً", "codes": ["/HUMAN", "EL10"], "lang": "ar"})
        self.assertEqual(out["options"][0]["title"], "مستضاف ذاتياً على هذا الجهاز")
        self.assertIn("النشر", out["human"])
        self.assertEqual(len(out["plain"]), 1)

    def test_no_code_is_run(self):
        with open(pm.__file__, encoding="utf-8") as fh:
            src = fh.read()
        for word in ("ev" + "al(", "ex" + "ec(", "sub" + "process", "os." + "system", "import" + "lib", "soc" + "ket", "url" + "lib"):
            self.assertNotIn(word, src)


class SameAsServer(unittest.TestCase):
    def test_golden(self):
        with open(os.path.join(HERE, "golden.json"), encoding="utf-8") as fh:
            g = json.load(fh)
        self.assertGreaterEqual(len(g), 19)
        for case in g:
            out = pm.compile_metacodes(case["request"])
            self.assertEqual(out, case["response"])
            self.assertEqual(out["sha256"], case["response"]["sha256"])


if __name__ == "__main__":
    unittest.main()
