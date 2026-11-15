import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import runbook as rb  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(HERE))))


class Golden(unittest.TestCase):
    def test_same_answers_as_the_server(self):
        with open(os.path.join(HERE, "golden.json"), encoding="utf-8") as fh:
            cases = json.load(fh)
        self.assertGreaterEqual(len(cases), 30)
        for i, c in enumerate(cases):
            with self.subTest(i=i):
                if "error" in c:
                    with self.assertRaises(rb.RunbookError) as ctx:
                        rb.runbook(c["request"], c["ctx"])
                    self.assertEqual({"error": str(ctx.exception), "detail": ctx.exception.detail}, c["error"])
                else:
                    self.assertEqual(json.loads(json.dumps(rb.runbook(c["request"], c["ctx"]))), c["response"])


class Stages(unittest.TestCase):
    def test_this_repository(self):
        ctx = rb.load_context(os.path.join(ROOT, "jarvis", "app", "data"))
        r = rb.runbook({"goal": "Heal the contrast and email ops@example.org", "skills": ["replica-polymath-engine"]}, ctx)
        self.assertEqual([s["id"] for s in r["stages"]], rb.RB_STAGES)
        self.assertTrue(r["ready"])
        self.assertNotIn("ops@example.org", json.dumps(r))
        routes = r["stages"][-1]["summary"]["routes"]
        self.assertEqual([x["status"] for x in routes].count("ok"), 11)
        self.assertEqual(routes[-1]["status"], "server_only")

    def test_locked_steps_keep_the_tree_running(self):
        r = rb.runbook({"goal": "Publish the page and install n8n", "skills": ["replica-plan-order"]}, rb.load_context(os.path.join(ROOT, "jarvis", "app", "data")))
        tree = r["stages"][3]["summary"]
        self.assertEqual(tree["status"], "running")
        self.assertGreater(r["locked"], 0)
        self.assertFalse(r["sent"])

    def test_a_refused_stage_does_not_stop_the_others(self):
        r = rb.runbook({"goal": "Contrast", "skills": ["nope"]}, {})
        self.assertEqual([s["status"] for s in r["stages"]], ["ok", "ok", "error", "ok", "ok", "ok"])
        self.assertFalse(r["ready"])

    def test_no_code_is_run(self):
        with open(rb.__file__, encoding="utf-8") as fh:
            src = fh.read()
        for word in ("ev" + "al(", "ex" + "ec(", "sub" + "process", "os." + "system", "import" + "lib", "soc" + "ket", "url" + "lib"):
            self.assertNotIn(word, src)


if __name__ == "__main__":
    unittest.main()
