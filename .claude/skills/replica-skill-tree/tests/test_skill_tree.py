import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import skill_tree as st  # noqa: E402


def sk(name, **extra):
    base = {"name": name, "description": "d", "tools": [], "scan": {"critical": 0, "high": 0, "medium": 0, "low": 0}, "tests": False, "golden": False, "mutation": None, "review": None}
    base.update(extra)
    return base


class Tree(unittest.TestCase):
    def test_roots_trunk_families(self):
        t = st.build_tree({"skills": [sk("replica-a"), sk("omega-design"), sk("zeta")]})
        kinds = [n["kind"] for n in t["nodes"]]
        self.assertEqual(kinds.count("root"), 7)
        self.assertEqual(kinds.count("trunk"), 3)
        self.assertEqual(t["counts"]["family"], {"family:vendored": 1, "family:jarvis": 1, "family:omega": 1})
        self.assertTrue(all(n["y"] > t["view"]["ground"] for n in t["nodes"] if n["kind"] == "root"))

    def test_status_comes_from_facts(self):
        self.assertEqual(st.status_of(sk("x", scan={"critical": 0, "high": 1, "medium": 0, "low": 0}, tests=True), "family:jarvis"), "attention")
        self.assertEqual(st.status_of(sk("x", tests=True, golden=True, mutation={"killed": 5, "mutants": 5}), "family:jarvis"), "proved")
        self.assertEqual(st.status_of(sk("x", tests=True, golden=True, mutation={"killed": 4, "mutants": 5}), "family:jarvis"), "tested")
        self.assertEqual(st.status_of(sk("x"), "family:vendored"), "reference")
        self.assertEqual(st.status_of(sk("x"), "family:omega"), "rules")

    def test_compose_names_the_joining_engine(self):
        inp = {"skills": [sk("replica-universal-math", tests=True), sk("replica-foss-atlas", tests=True), sk("algorithmic-art")]}
        c = st.compose_skills(inp, ["replica-universal-math", "replica-foss-atlas"])
        self.assertEqual([j["id"] for j in c["joined_by"]], ["trunk:workbench", "trunk:polymath"])
        self.assertTrue(c["ready"])
        v = st.compose_skills(inp, ["algorithmic-art"])
        self.assertIsNone(v["steps"][0]["command"])
        self.assertFalse(v["ready"])

    def test_snapshot_reads_this_repository(self):
        root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(HERE))))
        snap = st.snapshot(root)
        names = [s["name"] for s in snap["skills"]]
        self.assertIn("replica-universal-math", names)
        um = next(s for s in snap["skills"] if s["name"] == "replica-universal-math")
        self.assertTrue(um["tests"] and um["golden"] and um["mutation"]["killed"] == um["mutation"]["mutants"])

    def test_refusals(self):
        for bad in (None, {"skills": "x"}, {"skills": [sk("Bad")]}, {"skills": [sk("a"), sk("a")]}):
            with self.assertRaises(st.TreeError):
                st.build_tree(bad)

    def test_no_code_is_run(self):
        with open(st.__file__, encoding="utf-8") as fh:
            src = fh.read()
        for word in ("ev" + "al(", "ex" + "ec(", "sub" + "process", "os." + "system", "import" + "lib", "soc" + "ket", "url" + "lib"):
            self.assertNotIn(word, src)


class SameAsServer(unittest.TestCase):
    def test_golden(self):
        with open(os.path.join(HERE, "golden.json"), encoding="utf-8") as fh:
            g = json.load(fh)
        for r, w in zip(g["requests"], g["outputs"], strict=True):
            try:
                got = json.loads(json.dumps(st.skill_tree(r)))
            except st.TreeError as e:
                got = {"error": str(e), "detail": e.detail}
            self.assertEqual(got, w, json.dumps(r)[:120])


if __name__ == "__main__":
    unittest.main()
