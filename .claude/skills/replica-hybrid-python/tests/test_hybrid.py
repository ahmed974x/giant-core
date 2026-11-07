"""Tests for replica-hybrid-python."""

import contextlib
import io
import json
import os
import re
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import curriculum_50k as cur
import dag_scheduler
import pattern_memory
import static_intel
import topology_synth as topo
from hcommon import HybridError

PAGE = """<html><head><title>Brandco</title><script>track()</script></head><body>
<header><nav><a>Brandco</a><a>Docs</a></nav></header><main>
<section><h1>Brandco ships widgets</h1><p>Buy now for $19.99</p></section>
<section><h2>Why</h2><div class="grid"><article class="card"><h3>A</h3><p>x</p></article><article class="card"><h3>B</h3><p>y</p></article>
<article class="card"><h3>C</h3><p>z</p></article><article class="card"><h3>D</h3><p>w</p></article></div></section>
<section><details><summary>Q?</summary><p>A.</p></details></section></main><footer>Brandco Ltd</footer></body></html>"""


def quiet(fn, argv):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(io.StringIO()):
        code = fn(argv)
    return code, buf.getvalue()


class Hybrid(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        with open(os.path.join(self.root, "page.html"), "w", encoding="utf-8") as fh:
            fh.write(PAGE)

    def tearDown(self):
        self.tmp.cleanup()

    def test_fingerprint_is_stable_and_textless(self):
        a, b = topo.fingerprint(PAGE), topo.fingerprint(PAGE.replace("Brandco", "Other").replace("widgets", "gadgets"))
        self.assertEqual(a["wl_sha256"], b["wl_sha256"])  # text does not change the topology
        self.assertEqual(a["landmarks"], ["header", "nav", "main", "footer"])
        self.assertIn(4, a["grids"])
        self.assertAlmostEqual(topo.cosine(a["_hist"], b["_hist"]), 1.0)
        other = topo.fingerprint("<html><body><aside><pre>x</pre><pre>y</pre></aside><main><pre>z</pre></main></body></html>")
        self.assertLess(topo.cosine(a["_hist"], other["_hist"]), 0.8)
        self.assertEqual(other["archetype"], "ide")

    def test_synth_clean_rtl_and_pinned_csp(self):
        code, _ = quiet(topo.main, ["synth", "page.html", "--out", "out/t.html", "--lang", "ar", "--root", self.root])
        self.assertEqual(code, 0)
        with open(os.path.join(self.root, "out/t.html"), encoding="utf-8") as fh:
            html = fh.read()
        self.assertNotIn("Brandco", html)
        self.assertNotIn("<script", html)
        self.assertIn('dir="rtl"', html)
        self.assertIn("blur(16px) saturate(180%)", html)
        self.assertIn("prefers-reduced-transparency", html)
        self.assertEqual(html.count('class="card"'), 4)
        import base64
        import hashlib
        style = re.search(r"<style>(.*?)</style>", html, re.S).group(1)
        want = "sha256-" + base64.b64encode(hashlib.sha256(style.encode()).digest()).decode()
        self.assertIn(want, html)
        self.assertEqual(topo.scale(16)["type_px"], [16, 20, 26, 33, 42])
        self.assertEqual(quiet(topo.main, ["synth", "page.html", "--out", "../x.html", "--root", self.root])[0], 2)

    def test_dag_batches_locks_cycle(self):
        plan = {"nodes": [{"id": "a", "title": "read commits"}, {"id": "b", "title": "run tests", "minutes": 5}, {"id": "c", "title": "publish the notes"},
                          {"id": "d", "title": "announce", "gate": "approval"}, {"id": "e", "title": "save note"}, {"id": "f", "title": "write the summary"}],
                "edges": [["a", "b"], ["a", "c"], ["b", "e"], ["c", "f"]]}
        r = dag_scheduler.schedule(plan)
        self.assertEqual(r["batches"], [["a", "d"], ["b", "c"], ["e", "f"]])
        self.assertEqual(r["locked"], ["c", "d"])
        self.assertEqual(r["waiting_on_locked"], ["f"])
        self.assertEqual(r["critical_path"], ["a", "b", "e"])
        self.assertEqual(r["runnable_now"], [["a"], ["b"], ["e"]])
        with self.assertRaises(HybridError) as cm:
            dag_scheduler.schedule({"nodes": [{"id": "x"}, {"id": "y"}], "edges": [["x", "y"], ["y", "x"]]})
        self.assertIn("loop", str(cm.exception))

    def test_pattern_memory(self):
        argv = ["--root", self.root]
        for _ in range(3):
            quiet(pattern_memory.main, ["learn", "m.json", "nav,hero,features,faq,footer", "--passed", "contrast,sizes", *argv])
        quiet(pattern_memory.main, ["learn", "m.json", "nav,hero,table,footer", *argv])
        _, out = quiet(pattern_memory.main, ["suggest", "m.json", *argv])
        self.assertEqual(out.split()[0], "nav,hero,features,faq,footer")
        good = float(quiet(pattern_memory.main, ["score", "m.json", "nav,hero,features,faq,footer", *argv])[1].split()[0])
        bad = float(quiet(pattern_memory.main, ["score", "m.json", "footer,faq,nav", *argv])[1].split()[0])
        self.assertGreater(good, bad)
        self.assertEqual(quiet(pattern_memory.main, ["learn", "m.json", "nav", "--passed", "vibes", *argv])[0], 2)

    def test_static_intel(self):
        os.makedirs(os.path.join(self.root, "site/.well-known"))
        for name, text in {"robots.txt": "User-agent: *\nDisallow: /x\nSitemap: https://example.com/s.xml\n", ".well-known/security.txt": "Contact: mailto:a@example.com\nExpires: 2030-01-01T00:00:00Z\n",
                           "change-password": "x", "openapi.json": json.dumps({"openapi": "3.1.0", "paths": {"/a": {}, "/b": {}}})}.items():
            with open(os.path.join(self.root, "site", name), "w", encoding="utf-8") as fh:
                fh.write(text)
        r = static_intel.manifests(os.path.join(self.root, "site"))
        self.assertEqual(r["facts"]["openapi.json"]["paths"], 2)
        self.assertEqual(r["facts"][".well-known/security.txt"]["contact"], ["mailto:a@example.com"])
        self.assertTrue(any("change-password" in p for p in r["problems"]))
        key = "Zq8" + "Xz1Lp0Vb7Rk2Nw9Tc4YhM3"
        with open(os.path.join(self.root, "gen.py"), "w", encoding="utf-8") as fh:
            fh.write(f'TOKEN = "{key}"\nNAME = "a plain sentence that is long enough"\n')
        found = static_intel.audit(self.root, ["gen.py"], 4.0)
        self.assertEqual([f["line"] for f in found], [1])
        self.assertNotIn(key, json.dumps(found))

    def test_curriculum(self):
        self.assertGreaterEqual(cur.LAYOUT_TOTAL, 50_000)
        self.assertGreaterEqual(cur.QA_TOTAL, 50_000)
        self.assertEqual(cur.item("qa", 123), cur.item("qa", 123))
        self.assertNotEqual(cur.item("qa", 123, seed=7)["id"], 123)
        night = cur.layout(0)
        self.assertTrue(night["passes"])
        self.assertAlmostEqual(cur.wcag("#000000", "#ffffff"), 21.0)
        self.assertAlmostEqual(abs(cur.apca("#000000", "#ffffff")), 106.04, places=1)
        lock = next(cur.qa(i) for i in range(cur.QA_TOTAL) if cur.qa(i)["category"] == "locks" and "pay the invoice" in cur.qa(i)["messages"][1]["content"])
        self.assertIn("No:", lock["messages"][2]["content"])
        ar = cur.qa(1)
        self.assertEqual(ar["lang"], "ar")
        self.assertTrue(ar["messages"][2]["content"].startswith("<think>"))
        start = 0
        for name, _, n in cur.QA:  # the first item of every category decodes to that category, in both languages
            self.assertEqual((cur.qa(2 * start)["category"], cur.qa(2 * start + 1)["lang"]), (name, "ar"))
            start += n
        code, _ = quiet(cur.main, ["export", "--kind", "qa", "--n", "500", "--out", "w/qa.jsonl", "--root", self.root])
        with open(os.path.join(self.root, "w/qa.jsonl"), encoding="utf-8") as fh:
            lines = fh.read().splitlines()
        self.assertEqual((code, len(lines)), (0, 500))
        self.assertTrue(all(json.loads(x)["messages"][2]["role"] == "assistant" for x in lines))
        self.assertEqual(quiet(cur.main, ["export", "--kind", "qa", "--n", "5", "--out", "../x.jsonl", "--root", self.root])[0], 2)


if __name__ == "__main__":
    unittest.main()
