import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import project_search as ps  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(HERE))))


class Golden(unittest.TestCase):
    def test_same_answers_as_the_server(self):
        with open(os.path.join(HERE, "golden.json"), encoding="utf-8") as fh:
            g = json.load(fh)
        self.assertGreaterEqual(len(g["cases"]), 30)
        for i, c in enumerate(g["cases"] + [{"request": {"query": "contrast"}, **b} for b in g["bad"]]):
            corpus = c.get("corpus", g["corpus"])
            with self.subTest(i=i):
                if "error" in c:
                    with self.assertRaises(ps.SearchError) as ctx:
                        ps.search_project(corpus, c["request"])
                    self.assertEqual({"error": str(ctx.exception), "detail": ctx.exception.detail}, c["error"])
                else:
                    self.assertEqual(json.loads(json.dumps(ps.search_project(corpus, c["request"]))), c["response"])


class Rankers(unittest.TestCase):
    def test_tokenizer_folds_arabic_and_drops_stop_words(self):
        self.assertEqual(ps.tokenize("قيد الموافقة في The Contrast"), ["قيد", "الموافقه", "contrast"])

    def test_trigrams_find_a_misspelt_title(self):
        self.assertGreater(ps.dice(ps.trigrams("skil tre"), ps.trigrams("skill tree")), 0.3)

    def test_rrf_adds_reciprocal_ranks(self):
        out = ps.rrf([["a", [{"id": "x"}, {"id": "y"}]], ["b", [{"id": "y"}]]], 60)
        self.assertEqual([o["id"] for o in out], ["y", "x"])
        self.assertEqual(out[0]["score"], ps.js_round(1 / 62 + 1 / 61, 1e6))

    def test_nothing_shared_is_nothing_found(self):
        r = ps.search_project({"docs": [{"id": "a", "kind": "adr", "title": "Merkle", "headings": [], "text": "proof"}]}, {"query": "zzqv"})
        self.assertFalse(r["found"])
        self.assertEqual(r["results"], [])


class Corpus(unittest.TestCase):
    def test_reads_this_repository(self):
        c = ps.corpus(ROOT)
        kinds = {d["kind"] for d in c["docs"]}
        self.assertEqual(kinds, {"adr", "review", "skill"})
        self.assertTrue(all(len(d["text"]) <= ps.PS_CAP for d in c["docs"]))
        skill = next(d for d in c["docs"] if d["id"] == ".claude/skills/replica-project-search/SKILL.md")
        self.assertEqual(skill["title"], "replica-project-search")

    def test_no_code_is_run(self):
        with open(ps.__file__, encoding="utf-8") as fh:
            src = fh.read()
        for word in ("ev" + "al(", "ex" + "ec(", "sub" + "process", "os." + "system", "import" + "lib", "soc" + "ket", "url" + "lib"):
            self.assertNotIn(word, src)


if __name__ == "__main__":
    unittest.main()
