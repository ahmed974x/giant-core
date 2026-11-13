import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import universal_agent as ua  # noqa: E402

LOCK = {"gate": "approval", "locked": True, "status": "pending_approval"}


class Request(unittest.TestCase):
    def test_fable_payload_is_corrected(self):
        r = ua.universal_agent({"mode": "request", "model": "claude-fable-5-2", "temperature": 0.2, "top_p": 0.9,
                                "thinking": {"type": "enabled", "budget_tokens": 2000}, "tool_choice": {"type": "any"}})
        self.assertEqual(r["body"]["output_config"], {"effort": "high"})
        for k in ("temperature", "top_p", "thinking", "tool_choice"):
            self.assertNotIn(k, r["body"])
            self.assertIn(k, r["dropped"])
        self.assertFalse(r["sent"])

    def test_every_send_is_locked_and_proved(self):
        r = ua.universal_agent({"mode": "request", "model": "claude-opus-5-5", "gateway": "http://127.0.0.1:20128"})
        locked = [s for s in r["plan"] if s.get("locked")]
        self.assertEqual(len(locked), 2)
        for s in locked:
            self.assertEqual({k: s[k] for k in LOCK}, LOCK)
        self.assertTrue(r["proof"]["verified"])

    def test_haiku_keeps_a_forced_tool(self):
        r = ua.universal_agent({"mode": "request", "model": "claude-haiku-5-5", "tool_choice": {"type": "tool", "name": "x"}})
        self.assertEqual(r["body"]["tool_choice"], {"type": "tool", "name": "x"})


class Route(unittest.TestCase):
    def test_breaker_and_unknown_cost(self):
        r = ua.universal_agent({"mode": "route", "candidates": [
            {"id": "low", "health": 0, "quota": 0, "cost": None, "speed": 0, "fit": 0, "stability": 0},
            {"id": "claude-haiku-5-5", "health": 1, "quota": 1, "cost": 0.1, "speed": 1, "fit": 1, "stability": 1}]})
        self.assertEqual(r["tripped"], ["low"])
        self.assertEqual(r["chosen"], "claude-haiku-5-5")
        self.assertEqual([c["id"] for c in r["ranked"]], ["claude-haiku-5-5"])

    def test_weights_sum_to_one(self):
        self.assertAlmostEqual(sum(ua.UA_WEIGHTS.values()), 1.0)


class Modes(unittest.TestCase):
    def test_graph_weakest_hop(self):
        g = ua.universal_agent({"mode": "graph", "from": "a", "to": "c", "edges": [
            {"from": "a", "to": "b", "kind": "EXTRACTED"}, {"from": "b", "to": "c", "kind": "INFERRED", "confidence": 0.4}]})
        self.assertEqual(g["confidence"], 0.4)

    def test_security_same_finder_needs_validation(self):
        s = ua.universal_agent({"mode": "security", "candidates": [{"id": "x", "finder": "a", "verifier": "a", "boundary_failure": True,
                                                                     "source_trace": True, "likelihood": 1, "impact": 1}]})
        self.assertEqual(s["findings"][0]["verdict"], "needs_validation")

    def test_unverified_models_carry_no_numbers(self):
        for m in ua.catalog()["unverified"]:
            self.assertIsNone(m["source"])
            self.assertEqual(m["note"], "تعذر التحقق منها")

    def test_no_code_is_run(self):
        with open(ua.__file__, encoding="utf-8") as fh:
            src = fh.read()
        for word in ("ev" + "al(", "ex" + "ec(", "sub" + "process", "os." + "system", "import" + "lib", "soc" + "ket", "url" + "lib"):
            self.assertNotIn(word, src)


class SameAsServer(unittest.TestCase):
    def test_golden(self):
        with open(os.path.join(HERE, "golden.json"), encoding="utf-8") as fh:
            g = json.load(fh)
        for r, w in zip(g["requests"], g["outputs"], strict=True):
            try:
                got = json.loads(json.dumps(ua.universal_agent(r)))
            except ua.AgentError as e:
                got = {"error": str(e), "detail": e.detail}
            self.assertEqual(got, w, json.dumps(r)[:120])


if __name__ == "__main__":
    unittest.main()
