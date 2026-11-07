"""Tests for replica-long-horizon (ADR-135). Run: python3 -m unittest discover -s .claude/skills/replica-long-horizon/tests -v"""
import contextlib
import io
import json
import os
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import capsule  # noqa: E402
import gate  # noqa: E402
import lhcommon  # noqa: E402
import plan  # noqa: E402


def quiet(fn, *args):
    with contextlib.redirect_stdout(io.StringIO()) as out, contextlib.redirect_stderr(io.StringIO()):
        code = fn(*args)
    return code, out.getvalue()


class LongHorizon(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = self.tmp.name
        self.w = os.path.join(self.root, "work", "t")
        os.makedirs(os.path.join(self.root, "src"))
        self.src = os.path.join(self.root, "src", "app.js")
        lhcommon.write(self.src, "let a = 1;\n")
        os.makedirs(os.path.join(self.root, ".git", "refs", "heads"))
        lhcommon.write(os.path.join(self.root, ".git", "HEAD"), "ref: refs/heads/feature\n")
        lhcommon.write(os.path.join(self.root, ".git", "refs", "heads", "feature"), "a" * 40 + "\n")
        code, _ = quiet(plan.main, ["init", self.w, "--goal", "Ship it", "--criteria", "Saves", "--criteria", "Locked rows stay off"])
        self.assertEqual(code, 0)

    def ev(self, name, text, age=0):
        p = os.path.join(self.w, "evidence", name)
        lhcommon.write(p, text)
        t = time.time() - age
        os.utime(p, (t, t))
        return p

    # plan.py
    def test_init_writes_three_files_and_never_overwrites(self):
        for f in ("task_plan.md", "findings.md", "progress.md"):
            self.assertTrue(os.path.isfile(os.path.join(self.w, f)))
        tasks, criteria = lhcommon.parse_plan(lhcommon.read(os.path.join(self.w, "task_plan.md")))
        self.assertEqual([t["id"] for t in tasks], ["T1", "T2", "T3"])
        self.assertEqual(tasks[1]["gate"], ["tests", "security"])
        self.assertEqual(tasks[1]["ac"], ["AC1", "AC2"])
        self.assertEqual([c["id"] for c in criteria], ["AC1", "AC2"])
        code, _ = quiet(plan.main, ["init", self.w, "--goal", "again"])
        self.assertEqual(code, 2)

    def test_status_and_log(self):
        quiet(plan.main, ["log", self.w, "Read the code."])
        s = plan.status(self.w)
        self.assertEqual(s["tasks"]["done"], 0)
        self.assertEqual(s["criteria"]["missing_evidence"], ["AC1", "AC2"])
        self.assertIn("Read the code.", s["last_progress"])
        self.assertIn("[INFERENCE", s["context_health"])

    # gate.py
    def test_gate_refuses_without_evidence_then_passes_and_ticks(self):
        code, out = quiet(gate.main, ["check", self.w, "--task", "T2", "--root", self.root])
        self.assertEqual(code, 1)
        self.assertIn("no evidence/tests*.log", out)
        self.ev("tests-unit.log", "...\nRan 12 tests in 0.1s\n\nOK\n")
        self.ev("security.json", json.dumps({"summary": {"critical": 0, "high": 0, "medium": 3}}))
        code, out = quiet(gate.main, ["check", self.w, "--task", "T2", "--root", self.root])
        self.assertEqual(code, 1)
        self.assertIn("no evidence line", out)
        f = os.path.join(self.w, "findings.md")
        lhcommon.write(f, lhcommon.read(f) + "- AC1: `evidence/tests-unit.log` editing saves\n- AC2: `evidence/security.json`\n")
        code, out = quiet(gate.main, ["check", self.w, "--task", "T2", "--root", self.root, "--watch", "src"])
        self.assertEqual(code, 0, out)
        tasks, _ = lhcommon.parse_plan(lhcommon.read(os.path.join(self.w, "task_plan.md")))
        self.assertTrue(tasks[1]["done"])
        self.assertIn("Gate passed T2", lhcommon.read(os.path.join(self.w, "progress.md")))

    def test_gate_rejects_failing_and_stale_evidence(self):
        f = os.path.join(self.w, "findings.md")
        lhcommon.write(f, lhcommon.read(f) + "- AC1: `evidence/tests.log`\n- AC2: `evidence/tests.log`\n")
        self.ev("security.json", json.dumps({"summary": {"critical": 0, "high": 1}}))
        self.ev("tests.log", "40 passed, 2 failed\n")
        code, out = quiet(gate.main, ["check", self.w, "--task", "T2", "--root", self.root])
        self.assertEqual(code, 1)
        self.assertIn("40 passed, 2 failed", out)
        self.assertIn("critical 0, high 1", out)
        self.ev("tests.log", "40 passed, 0 failed\n", age=3600)
        self.ev("security.json", json.dumps({"summary": {"critical": 0, "high": 0}}), age=3600)
        code, out = quiet(gate.main, ["check", self.w, "--task", "T2", "--root", self.root, "--watch", "src/app.js"])
        self.assertEqual(code, 1)
        self.assertIn("stale", out)

    def test_judges(self):
        p = os.path.join(self.w, "evidence", "x")
        def j(check, text):
            lhcommon.write(p, text)
            return gate.judge(check, p)[0]
        self.assertTrue(j("tests", "112 passed, 0 failed"))
        self.assertFalse(j("tests", "0 passed, 0 failed"))
        self.assertFalse(j("tests", "Ran 3 tests in 0.1s\n\nFAILED (failures=1)"))
        self.assertTrue(j("tests", "===== 9 passed in 0.12s ====="))
        self.assertFalse(j("tests", "===== 1 failed, 8 passed in 0.12s ====="))
        self.assertFalse(j("tests", "nothing here"))
        self.assertTrue(j("contrast", "All pairs pass WCAG >= 4.5 and APCA Lc >= 60."))
        self.assertTrue(j("contrast", "  118 checks, 0 failing AA"))
        self.assertFalse(j("contrast", "  FAIL dark: --x on --y\n1 pair(s) FAIL"))
        self.assertFalse(j("security", "not json"))
        self.assertTrue(j("lint", "Found 0 errors."))

    def test_approval_tasks_never_pass(self):
        p = os.path.join(self.w, "task_plan.md")
        lhcommon.write(p, lhcommon.read(p) + "- [ ] T9: Publish the site {gate: approval}\n")
        code, out = quiet(gate.main, ["check", self.w, "--task", "T9", "--root", self.root])
        self.assertEqual(code, 1)
        self.assertIn("Director 00", out)

    def test_finish_needs_every_task(self):
        code, out = quiet(gate.main, ["finish", self.w, "--root", self.root])
        self.assertEqual(code, 1)
        self.assertIn("NOT complete", out)

    def test_watch_outside_root_is_refused(self):
        code, _ = quiet(gate.main, ["check", self.w, "--task", "T1", "--root", self.root, "--watch", "../../etc"])
        self.assertEqual(code, 2)

    # capsule.py
    def test_capsule_chain_verify_tamper_and_restore(self):
        c1, _ = capsule.save(self.w, "start", ["src/app.js"], True, self.root)
        self.assertEqual(c1["prev_hash"], "0" * 64)
        self.assertEqual(c1["git"], {"branch": "feature", "commit": "a" * 40})
        lhcommon.write(self.src, "let a = 2;\n")
        quiet(plan.main, ["log", self.w, "Changed app.js"])
        c2, name2 = capsule.save(self.w, "after-change", ["src/app.js"], False, self.root)
        self.assertEqual(c2["prev_hash"], c1["hash"])
        problems, drift = capsule.verify(self.w, self.root)
        self.assertEqual(problems, [])
        self.assertEqual(drift, {1: ["src/app.js (changed)"]})
        # restore capsule 1: plan files and the saved content come back exactly
        lhcommon.write(os.path.join(self.w, "task_plan.md"), "lost\n")
        capsule.restore(self.w, 1, True, self.root)
        self.assertIn("# Task plan: Ship it", lhcommon.read(os.path.join(self.w, "task_plan.md")))
        self.assertEqual(lhcommon.read(self.src), "let a = 1;\n")
        progress = lhcommon.read(os.path.join(self.w, "progress.md"))
        self.assertIn("Changed app.js", progress)  # progress.md keeps every line (append-only)
        self.assertIn("Restored capsule #1", progress)
        # tamper with capsule 2: verify fails and restore refuses
        p = os.path.join(self.w, "capsules", name2)
        data = json.loads(lhcommon.read(p))
        data["label"] = "edited"
        lhcommon.write(p, json.dumps(data))
        problems, _ = capsule.verify(self.w, self.root)
        self.assertTrue(any("edited after saving" in x for x in problems))
        with self.assertRaises(lhcommon.LHError):
            capsule.restore(self.w, 1, False, self.root)

    def test_capsule_refuses_paths_outside_root_and_bad_labels(self):
        with self.assertRaises(lhcommon.LHError):
            capsule.save(self.w, "x", ["../outside.txt"], False, self.root)
        with self.assertRaises(lhcommon.LHError):
            capsule.save(self.w, "bad label!", [], False, self.root)
        code, _ = quiet(capsule.main, ["restore", self.w, "1"])
        self.assertEqual(code, 2)  # --yes is required


if __name__ == "__main__":
    unittest.main()
