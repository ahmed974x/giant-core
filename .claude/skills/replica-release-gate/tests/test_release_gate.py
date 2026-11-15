import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import release_gate as rg  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(HERE))))
DATA = os.path.join(ROOT, "jarvis", "app", "data")


def snap(**over):
    s = {**dict.fromkeys(rg.RG_GROWTH, 100), **dict.fromkeys(rg.RG_FAILURE, 0)}
    s.update(over)
    return s


class Golden(unittest.TestCase):
    def test_same_answers_as_the_server(self):
        with open(os.path.join(HERE, "golden.json"), encoding="utf-8") as fh:
            g = json.load(fh)
        self.assertGreaterEqual(len(g["cases"]), 60)
        for i, c in enumerate(g["cases"]):
            with self.subTest(i=i, request=str(c["request"])[:80]):
                ctx = g["ctx"] if "ctx" not in c else None if c["ctx"] is None else {**g["ctx"], **c["ctx"]}
                if "error" in c:
                    with self.assertRaises(ValueError) as e:
                        rg.release_gate(c["request"], ctx)
                    self.assertEqual(getattr(e.exception, "status", None), 400)
                    self.assertEqual({"error": str(e.exception), "detail": e.exception.detail}, c["error"])
                else:
                    self.assertEqual(json.loads(json.dumps(rg.release_gate(c["request"], ctx))), c["response"])


class Repository(unittest.TestCase):
    def setUp(self):
        self.ctx = rg.load_context(DATA)

    def test_audit_is_ready(self):
        r = rg.release_gate({"mode": "audit"}, self.ctx)
        self.assertEqual(r["verdict"], "ready")
        self.assertEqual(r["status"]["attention"], 0)
        self.assertEqual(sum(r["status"].values()), r["skills"])
        self.assertGreater(r["records"]["adrs"], 0)

    def test_regression_verdicts(self):
        self.assertEqual(rg.release_gate({"mode": "regress", "baseline": snap(), "candidate": snap()})["verdict"], "steady")
        self.assertEqual(rg.release_gate({"mode": "regress", "baseline": snap(), "candidate": snap(server_passed=101)})["verdict"], "proven_progress")
        self.assertEqual(rg.release_gate({"mode": "regress", "baseline": snap(), "candidate": snap(server_passed=99)})["verdict"], "reject_regression")
        self.assertEqual(rg.release_gate({"mode": "regress", "baseline": snap(), "candidate": snap(server_passed=150, contrast_failing=1)})["verdict"], "reject_regression")

    def test_bundle_keeps_locks_and_rules(self):
        r = rg.release_gate({"mode": "bundle", "skills": ["replica-impact-analysis"], "model": "codestral:22b", "use": "service"}, self.ctx)
        self.assertEqual(r["model"]["verdict"], "not_allowed")
        self.assertTrue(all(s["locked"] and s["status"] == "pending_approval" for s in r["steps"]))
        self.assertEqual(r["steps"][0]["action"], "publish")
        self.assertEqual(len(r["chain_sha256"]), 64)
        self.assertIn("#/impact", r["pages"])
        self.assertFalse(r["sent"])

    def test_no_code_is_run(self):
        with open(rg.__file__, encoding="utf-8") as fh:
            src = fh.read()
        for word in ("ev" + "al(", "ex" + "ec(", "sub" + "process", "os." + "system", "import" + "lib", "soc" + "ket", "url" + "lib"):
            self.assertNotIn(word, src)


if __name__ == "__main__":
    unittest.main()
