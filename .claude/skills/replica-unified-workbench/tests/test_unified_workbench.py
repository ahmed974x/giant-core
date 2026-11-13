import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import unified_workbench as uw  # noqa: E402

FULL = {"task": "Build a login page, publish it and email a.b@x.org. ALT3", "model": "claude-fable-5-2", "effort": "xhigh",
        "css": ".hero{background:linear-gradient(#111,#333);color:#777}", "math": {"task": "calculus", "expression": "x^2-2", "interval": [0, 3]},
        "atlas": {"selectedIds": ["nextcloud", "n8n"], "prices": {"nextcloud": 1200}}, "secretCheck": "abc"}


class Pipeline(unittest.TestCase):
    def test_every_stage_runs_and_nothing_is_sent(self):
        r = uw.run_workbench(FULL)
        self.assertEqual([s["id"] for s in r["stages"]], uw.UW_STAGES)
        self.assertEqual([s["status"] for s in r["stages"]], ["ok"] * 6 + ["skipped"])
        self.assertFalse(r["sent"])
        self.assertTrue(r["proof"]["verified"])

    def test_the_shield_runs_before_any_model_text(self):
        r = uw.run_workbench(FULL)
        self.assertNotIn("a.b@x.org", json.dumps(r))
        self.assertEqual(r["stages"][0]["summary"]["secret_prefix"], "A9993")
        self.assertNotIn("abc\"", json.dumps(r))

    def test_locked_steps_are_locked(self):
        r = uw.run_workbench(FULL)
        locked = [s for s in r["plan"] if s.get("locked")]
        self.assertEqual(len(locked), r["locked"])
        self.assertTrue(all(s["gate"] == "approval" and s["status"] == "pending_approval" for s in locked))
        self.assertIn("outbound", {s["category"] for s in locked})

    def test_a_refused_stage_does_not_stop_the_others(self):
        r = uw.run_workbench({"task": "x", "math": {"task": "nope"}, "atlas": {"selectedIds": ["gimp"]}})
        by = {s["id"]: s for s in r["stages"]}
        self.assertEqual(by["math"]["status"], "error")
        self.assertEqual(by["atlas"]["status"], "ok")
        self.assertFalse(r["verified"])

    def test_refusals(self):
        for bad in (None, {}, {"task": ""}, {"task": " "}, {"task": "y" * 4001}):
            with self.assertRaises(uw.WorkbenchError):
                uw.run_workbench(bad)

    def test_no_code_is_run(self):
        with open(uw.__file__, encoding="utf-8") as fh:
            src = fh.read()
        for word in ("ev" + "al(", "ex" + "ec(", "sub" + "process", "os." + "system", "import" + "lib", "soc" + "ket", "url" + "lib"):
            self.assertNotIn(word, src)


class SameAsServer(unittest.TestCase):
    def test_golden(self):
        with open(os.path.join(HERE, "golden.json"), encoding="utf-8") as fh:
            g = json.load(fh)
        for r, w in zip(g["requests"], g["outputs"], strict=True):
            try:
                got = json.loads(json.dumps(uw.run_workbench(r)))
            except uw.WorkbenchError as e:
                got = {"error": str(e), "detail": e.detail}
            self.assertEqual(got, w, json.dumps(r)[:120])


if __name__ == "__main__":
    unittest.main()
