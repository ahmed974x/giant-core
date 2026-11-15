import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import impact_analysis as ia  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(HERE))))
DATA = os.path.join(ROOT, "jarvis", "app", "data")


class Golden(unittest.TestCase):
    def test_same_answers_as_the_server(self):
        with open(os.path.join(HERE, "golden.json"), encoding="utf-8") as fh:
            g = json.load(fh)
        self.assertGreaterEqual(len(g["cases"]), 150)
        for i, c in enumerate(g["cases"]):
            with self.subTest(i=i, request=str(c["request"])[:80]):
                if "ctx" not in c:
                    ctx = g["ctx"]
                elif c["ctx"] is None:
                    ctx = None
                else:
                    ctx = {**g["ctx"], **c["ctx"]}
                if "error" in c:
                    with self.assertRaises(ValueError) as e:
                        ia.impact_analysis(c["request"], ctx)
                    self.assertEqual(getattr(e.exception, "status", None), 400)
                    self.assertEqual({"error": str(e.exception), "detail": e.exception.detail}, c["error"])
                else:
                    self.assertEqual(json.loads(json.dumps(ia.impact_analysis(c["request"], ctx))), c["response"])


class Repository(unittest.TestCase):
    def setUp(self):
        self.ctx = ia.load_context(DATA)

    def test_catalog_has_thirty_families(self):
        self.assertEqual(len(self.ctx["catalog"]), 30)

    def test_a_name_without_a_size_is_not_guessed(self):
        r = ia.impact_analysis({"mode": "catalog", "model": "qwen3.8", "use": "service"}, self.ctx)
        self.assertEqual(r["verdict"], "size_unnamed")
        self.assertEqual(sorted(c["family"] for c in r["candidates"]), ["qwen3.8-27b", "qwen3.8-flash", "qwen3.8-max"])
        self.assertEqual(r["steps"], [])

    def test_serving_verdicts(self):
        v = {m: ia.impact_analysis({"mode": "catalog", "model": m, "use": "service"}, self.ctx)["verdict"]
             for m in ("openai/gpt-oss-120b", "mistralai/Mistral-Large-4-1T-A52B", "moonshotai/Kimi-K3", "zai-org/GLM-5.3", "codestral:22b")}
        self.assertEqual(v, {"openai/gpt-oss-120b": "allowed", "mistralai/Mistral-Large-4-1T-A52B": "commercial_licence", "moonshotai/Kimi-K3": "read_licence",
                             "zai-org/GLM-5.3": "read_licence", "codestral:22b": "not_allowed"})

    def test_memory_only_for_the_card_counted(self):
        own = ia.impact_analysis({"mode": "catalog", "model": "openai/gpt-oss-120b", "use": "personal", "bits": 4, "memory_gb": 64}, self.ctx)
        self.assertEqual(own["memory"], {"basis": "card", "params": 116829156672, "bits": 4, "weights_gb": 58.41, "fits": True})
        other = ia.impact_analysis({"mode": "catalog", "model": "gpt-oss:20b", "use": "personal", "bits": 4}, self.ctx)
        self.assertEqual(other["memory"]["basis"], "other_card")
        self.assertIsNone(other["memory"]["weights_gb"])
        none = ia.impact_analysis({"mode": "catalog", "model": "mistralai/Mistral-Large-4-1T-A52B", "use": "personal", "bits": 4}, self.ctx)
        self.assertEqual(none["memory"]["basis"], "no_count")

    def test_running_stays_locked(self):
        r = ia.impact_analysis({"mode": "catalog", "model": "gemma4:12b", "use": "personal"}, self.ctx)
        self.assertEqual(r["steps"], [{"action": "install", "target": "gemma-4", "gate": "approval", "locked": True, "status": "pending_approval"}])
        self.assertFalse(r["sent"])

    def test_blast_radius_reads_the_snapshot(self):
        r = ia.impact_analysis({"mode": "blast", "skill": "replica-reversal-engine"}, self.ctx)
        names = [d["name"] for d in r["dependents"]]
        self.assertIn("replica-runbook", names)
        self.assertIn("replica-impact-analysis", names)
        self.assertIn("#/runbook", [p["route"] for p in r["pages"]])
        self.assertIn("python3 -m unittest discover -s .claude/skills/replica-reversal-engine/tests", [t["command"] for t in r["tests"]])
        own = ia.impact_analysis({"mode": "blast", "skill": "replica-impact-analysis"}, self.ctx)
        self.assertEqual(own["upstream"]["cycle"], [])
        self.assertTrue(own["upstream"]["verified"])
        self.assertIn("replica-plan-order", own["upstream"]["added"])

    def test_a_cycle_is_named(self):
        r = ia.impact_analysis({"mode": "blast", "skill": "a"}, {"deps": {"a": ["b"], "b": ["a"]}})
        self.assertEqual(r["upstream"]["cycle"], ["a", "b"])

    def test_diff_hashes(self):
        r = ia.impact_analysis({"mode": "diff", "a": "x\ny", "b": "x\nz"})
        self.assertEqual([x["op"] for x in r["lines"]], ["=", "-", "+"])
        self.assertEqual(len(r["chain_sha256"]), 64)
        self.assertEqual(r["a_sha256"], ia._sha("x\ny"))

    def test_no_code_is_run(self):
        with open(ia.__file__, encoding="utf-8") as fh:
            src = fh.read()
        for word in ("ev" + "al(", "ex" + "ec(", "sub" + "process", "os." + "system", "import" + "lib", "soc" + "ket", "url" + "lib"):
            self.assertNotIn(word, src)


if __name__ == "__main__":
    unittest.main()
