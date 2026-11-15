import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import architect_studio as asd  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(HERE))))
DATA = os.path.join(ROOT, "jarvis", "app", "data")


class Golden(unittest.TestCase):
    def test_same_answers_as_the_server(self):
        with open(os.path.join(HERE, "golden.json"), encoding="utf-8") as fh:
            g = json.load(fh)
        self.assertGreaterEqual(len(g["cases"]), 80)
        for i, c in enumerate(g["cases"]):
            with self.subTest(i=i, request=str(c["request"])[:80]):
                ctx = g["ctx"] if "ctx" not in c else None if c["ctx"] is None else {**g["ctx"], **c["ctx"]}
                if "error" in c:
                    with self.assertRaises(ValueError) as e:
                        asd.architect_studio(c["request"], ctx)
                    self.assertEqual({"error": str(e.exception), "detail": e.exception.detail, "status": getattr(e.exception, "status", None)}, c["error"])
                else:
                    self.assertEqual(json.loads(json.dumps(asd.architect_studio(c["request"], ctx))), c["response"])


class Seal(unittest.TestCase):
    def test_domain_separated_and_nfc(self):
        self.assertEqual(asd.seal_hash("é"), asd.seal_hash("é"))
        self.assertNotEqual(asd.seal_hash("x"), asd._sha("x"))

    def test_a_seal_in_the_request_is_not_used(self):
        mine = asd.seal_hash("mine")
        r = asd.architect_studio({"mode": "seal", "passcode": "mine", "seal": mine, "expected": mine}, {"seal": asd.seal_hash("other")})
        self.assertFalse(r["seal"]["unlocked"])

    def test_locks_stay_in_every_state(self):
        ctx = {"seal": asd.seal_hash("kodex-974")}
        for code in ("kodex-974", "wrong"):
            r = asd.architect_studio({"mode": "seal", "passcode": code}, ctx)
            self.assertTrue(all(x["locked"] and x["status"] == "pending_approval" for x in r["locks"]))
            self.assertEqual(len(r["seal"]["audit_prefix"]), 5)
            self.assertNotIn(code, json.dumps(r))


class Repository(unittest.TestCase):
    def test_radar_reads_the_tree(self):
        ctx = {**asd.load_context(DATA), "seal": None}
        r = asd.architect_studio({"mode": "radar"}, ctx)["radar"]
        self.assertEqual(r["counts"]["rules"] + r["counts"]["tested"], len(r["skills"]))
        downs = [s["downstream"] for s in r["skills"]]
        self.assertEqual(downs, sorted(downs, reverse=True))

    def test_no_code_is_run(self):
        with open(asd.__file__, encoding="utf-8") as fh:
            src = fh.read()
        for word in ("ev" + "al(", "ex" + "ec(", "sub" + "process", "os." + "system", "import" + "lib", "soc" + "ket", "url" + "lib"):
            self.assertNotIn(word, src)


if __name__ == "__main__":
    unittest.main()
