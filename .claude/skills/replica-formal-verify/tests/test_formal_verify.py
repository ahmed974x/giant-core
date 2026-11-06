"""Tests for replica-formal-verify: the prover matches jarvis/server/lib/prover.mjs; the audit runs nothing."""
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import mutation_audit as ma
import state_prover as sp

PLAN = [
    {"title": "Read the commits", "kind": "tool", "depends": []},
    {"title": "Run the tests", "kind": "gate", "depends": [0]},
    {"title": "Publish the site", "kind": "approval", "category": "publish", "locked": True, "depends": [1]},
    {"title": "Pay the invoice", "kind": "approval", "category": "money", "locked": True, "depends": [2]},
]


class Prover(unittest.TestCase):
    def test_plan_is_verified(self):
        r = sp.prove(sp.plan_machine(PLAN))
        self.assertTrue(r["verified"], r)
        self.assertEqual((r["effects"], r["lockedStates"], r["deadlocks"]), (2, 2, []))

    def test_unlocked_publish_is_a_violation_with_a_path(self):
        bad = [dict(s) for s in PLAN]
        bad[2]["locked"] = False
        r = sp.prove(sp.plan_machine(bad))
        self.assertFalse(r["verified"])
        self.assertEqual(r["violations"][0]["effect"], "publish")
        self.assertEqual(r["violations"][0]["path"][0], "start -begin-> s0")

    def test_shortcut_and_deadlock(self):
        m = sp.plan_machine(PLAN)
        m["transitions"].append({"from": "start", "to": "e3", "event": "shortcut"})
        m["states"].append({"id": "limbo"})
        m["transitions"].append({"from": "s0", "to": "limbo", "event": "odd"})
        r = sp.prove(m)
        self.assertEqual([v["state"] for v in r["violations"]], ["e3"])
        self.assertEqual(r["deadlocks"], ["limbo"])

    def test_ui_completeness(self):
        css = ".btn{} .btn-primary:hover{} :focus-visible{} .btn[aria-busy=true]{} .empty-state{} .btn[aria-invalid]{} .btn:disabled{} .chip{}"
        r = sp.ui_completeness(css, ["btn", "chip"])
        self.assertEqual(r["components"][0]["missing"], [])
        self.assertEqual(r["components"][1]["missing"], ["hover", "loading", "error", "locked"])

    def test_ui_gate_fails_on_a_gap(self):
        css = ".input{} .input:hover{} :focus-visible{} .input[aria-busy=true]{} .input::placeholder{} .input[aria-invalid]{} .input:disabled{} .btn{} .btn:hover{}"
        ok = sp.ui_completeness(css, [], {"input": list(sp.UI_STATES)})
        self.assertTrue(ok["complete"])
        self.assertEqual(ok["percent"], 100.0)
        bad = sp.ui_completeness(css, [], {"btn": ["default", "hover", "active", "loading"]})
        self.assertFalse(bad["complete"])
        self.assertEqual(bad["components"][0]["missing"], ["active", "loading"])
        d = tempfile.mkdtemp()
        with open(os.path.join(d, "a.css"), "w", encoding="utf-8") as fh:
            fh.write(css)
        with open(os.path.join(d, "spec.json"), "w", encoding="utf-8") as fh:
            json.dump({"btn": ["default", "active"]}, fh)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(sp.main(["--ui", os.path.join(d, "a.css"), "--spec", os.path.join(d, "spec.json")]), 1)

    def test_cli(self):
        d = tempfile.mkdtemp()
        p = os.path.join(d, "plan.json")
        with open(p, "w", encoding="utf-8") as fh:
            json.dump({"steps": PLAN}, fh)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(sp.main(["--plan", p]), 0)
        with open(p, "w", encoding="utf-8") as fh:
            fh.write("{}")
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(sp.main(["--machine", p]), 2)


SRC = "def clamp(x, lo, hi):\n    if x < lo:\n        return lo\n    return min(x, hi) + 0\n\n\ndef unused(a):\n    return a and True\n"


class Mutation(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.mod = os.path.join(self.d, "m.py")
        with open(self.mod, "w", encoding="utf-8") as fh:
            fh.write(SRC)
        os.makedirs(os.path.join(self.d, "tests"))
        with open(os.path.join(self.d, "tests", "test_m.py"), "w", encoding="utf-8") as fh:
            fh.write("from m import clamp\nassert clamp(5, 0, 3) == 3\n")

    def test_points_and_static_strength(self):
        rep, _ = ma.audit(self.mod, [os.path.join(self.d, "tests")])
        kinds = {p["kind"] for p in rep["mutants"]}
        self.assertIn("compare Lt -> GtE", kinds)
        self.assertIn("arith Add -> Sub", kinds)
        self.assertIn("bool And -> Or", kinds)
        fn = {f["function"]: f for f in rep["functions"]}
        self.assertEqual(fn["unused"]["covered"], 0)
        self.assertEqual(fn["clamp"]["covered"], fn["clamp"]["points"])

    def test_mutants_written_inside_root_and_differ(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(ma.main([self.mod, "--tests", os.path.join(self.d, "tests"), "--out", "mut", "--root", self.d]), 0)
        files = sorted(os.listdir(os.path.join(self.d, "mut")))
        self.assertGreater(len(files), 4)
        with open(os.path.join(self.d, "mut", files[0]), encoding="utf-8") as fh:
            text = fh.read()
        self.assertIn("not run", text)
        self.assertNotEqual(text.split("\n", 1)[1].strip(), SRC.strip())
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(ma.main([self.mod, "--out", "../x", "--root", self.d]), 2)


if __name__ == "__main__":
    unittest.main()
