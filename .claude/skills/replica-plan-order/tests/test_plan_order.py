import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import plan_order as po  # noqa: E402


class Golden(unittest.TestCase):
    def test_same_answers_as_the_server(self):
        with open(os.path.join(HERE, "golden.json"), encoding="utf-8") as fh:
            cases = json.load(fh)
        self.assertGreaterEqual(len(cases), 60)
        for i, c in enumerate(cases):
            with self.subTest(i=i, mode=c["request"].get("mode") if isinstance(c["request"], dict) else None):
                if "error" in c:
                    with self.assertRaises(po.ERRORS) as ctx:
                        po.plan_order(c["request"], c.get("deps"))
                    self.assertEqual({"error": str(ctx.exception), "detail": ctx.exception.detail}, c["error"])
                else:
                    self.assertEqual(po.plan_order(c["request"], c.get("deps")), c["response"])


class Kahn(unittest.TestCase):
    def test_layers_and_ties_by_name(self):
        k = po.kahn_order(["c", "a", "b", "d"], [["a", "b"], ["b", "c"], ["d", "c"]])
        self.assertEqual(k["layers"], [["a", "d"], ["b"], ["c"]])
        self.assertTrue(k["verified"] and k["acyclic"])

    def test_a_cycle_is_named_not_broken(self):
        k = po.kahn_order(["a", "b", "x"], [["a", "b"], ["b", "a"]])
        self.assertEqual(k["cycle"], ["a", "b"])
        self.assertEqual(k["order"], ["x"])
        self.assertFalse(k["acyclic"])

    def test_skills_pull_in_what_they_load(self):
        s = po.skill_order({"a": [], "b": ["a"], "c": ["b"]}, ["c"])
        self.assertEqual(s["order"], ["a", "b", "c"])
        self.assertEqual(s["added"], ["a", "b"])


class Tree(unittest.TestCase):
    def test_sequence_and_fallback(self):
        leaf = lambda i: {"type": "leaf", "id": i}  # noqa: E731
        self.assertEqual(po.tick_tree({"type": "sequence", "children": [leaf("a"), leaf("b")]}, {"a": "success", "b": "failure"})["status"], "failure")
        self.assertEqual(po.tick_tree({"type": "fallback", "children": [leaf("a"), leaf("b")]}, {"a": "failure", "b": "success"})["status"], "success")
        self.assertEqual(po.tick_tree({"type": "sequence", "children": [leaf("a"), leaf("b")]}, {"a": "running"})["ticked"], 1)

    def test_locked_approvals_keep_the_workbench_running(self):
        r = po.plan_order({"mode": "workbench", "request": {"task": "Install n8n"}})
        self.assertEqual(r["status"], "running")
        self.assertEqual(r["stopped_at"], "approvals")
        self.assertGreater(r["waiting"], 0)


class Uct(unittest.TestCase):
    def test_untried_first_then_score(self):
        self.assertEqual(po.uct_select([{"id": "a", "visits": 3, "reward": 2}, {"id": "b", "visits": 0, "reward": 0}])["chosen"], "b")
        u = po.uct_select([{"id": "a", "visits": 10, "reward": 9}, {"id": "b", "visits": 10, "reward": 1}], 0)
        self.assertEqual((u["chosen"], u["reason"]), ("a", "score"))

    def test_only_the_persons_record(self):
        with self.assertRaises(po.OrderError):
            po.uct_select([{"id": "a", "visits": 1, "reward": 2}, {"id": "b", "visits": 1, "reward": 0}])


class Deps(unittest.TestCase):
    def test_reads_sys_path_lines(self):
        root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(HERE))))
        d = po.deps_snapshot(root)["skills"]
        self.assertIn("replica-reversal-engine", d["replica-prompt-metacodes"])
        self.assertEqual(d["replica-plan-order"], ["replica-prompt-metacodes", "replica-unified-workbench"])


class Bounds(unittest.TestCase):
    def test_no_process_or_network(self):
        with open(os.path.join(os.path.dirname(HERE), "plan_order.py"), encoding="utf-8") as fh:
            src = fh.read()
        for word in ("sub" + "process", "soc" + "ket", "url" + "lib", "http." + "client", "os." + "system", "po" + "pen", "ev" + "al(", "ex" + "ec(", "import" + "lib"):
            self.assertNotIn(word, src)


if __name__ == "__main__":
    unittest.main()
