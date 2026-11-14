import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import polymath_engine as pm  # noqa: E402

SERIES = [{"t": i, "v": 10 + (i % 7) * 0.5} for i in range(40)]


class Stages(unittest.TestCase):
    def test_abstains_without_any_engine(self):
        r = pm.run_polymath({"question": "What will the market do tomorrow?", "claims": [{"text": "It rises", "source": "markets"}]})
        self.assertTrue(r["grounding"]["abstained"])
        self.assertFalse(r["grounding"]["grounded"])
        self.assertEqual(r["grounding"]["unknown_citations"], ["markets"])
        self.assertIsNone(r["decision"])

    def test_named_domain_without_input_needs_input(self):
        r = pm.run_polymath({"question": "check the lens depth of field"})
        self.assertEqual({d["id"]: d["status"] for d in r["domains"]}["optics"], "needs_input")

    def test_shield_runs_first(self):
        r = pm.run_polymath({"question": "mail a.b@x.org about the series", "series": SERIES})
        self.assertNotIn("a.b@x.org", json.dumps(r))
        self.assertEqual(r["replaced"], 1)
        self.assertTrue(r["grounding"]["grounded"])

    def test_decision_uses_only_given_numbers(self):
        r = pm.decide({"options": [{"name": "A", "scores": {"x": 10, "y": 0}}, {"name": "B", "scores": {"x": 0, "y": 10}}], "weights": {"x": 3, "y": 1}})
        self.assertEqual(r["weights"], {"x": 0.75, "y": 0.25})
        self.assertEqual([o["score"] for o in r["ranked"]], [7.5, 2.5])
        self.assertEqual(r["chosen"], "A")
        tie = pm.decide({"options": [{"name": "A", "scores": {"x": 5}}, {"name": "B", "scores": {"x": 5}}], "weights": {"x": 1}})
        self.assertIsNone(tie["chosen"])

    def test_merkle_root_is_rfc6962(self):
        a, b, c = (pm._leaf(x) for x in "abc")
        self.assertEqual(pm.merkle_root([a, b, c]), pm._node(pm._node(a, b), c))
        self.assertEqual(pm.merkle_root([]), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")

    def test_limits(self):
        long = [{"t": i, "v": float(i % 9)} for i in range(5000)]
        self.assertEqual(pm.run_polymath({"question": "x", "series": long})["domains"][1]["status"], "ok")
        self.assertEqual(pm.run_polymath({"question": "x", "series": [*long, {"t": 1, "v": 1}]})["domains"][1]["status"], "error")
        for bad in (None, {}, {"question": ""}, {"question": "y" * 4001}, {"question": "x", "domains": ["nope"]}):
            with self.assertRaises(pm.PolymathError):
                pm.run_polymath(bad)

    def test_no_code_is_run(self):
        with open(pm.__file__, encoding="utf-8") as fh:
            src = fh.read()
        for word in ("ev" + "al(", "ex" + "ec(", "sub" + "process", "os." + "system", "import" + "lib", "soc" + "ket", "url" + "lib"):
            self.assertNotIn(word, src)


class SameAsServer(unittest.TestCase):
    def test_golden(self):
        with open(os.path.join(HERE, "golden.json"), encoding="utf-8") as fh:
            g = json.load(fh)
        for r, w in zip(g["requests"], g["outputs"], strict=True):
            try:
                got = json.loads(json.dumps(pm.run_polymath(r)))
            except pm.PolymathError as e:
                got = {"error": str(e), "detail": e.detail}
            self.assertEqual(got, w, json.dumps(r)[:120])


if __name__ == "__main__":
    unittest.main()
