"""Tests for slop_guard. Fixtures are written to a temp folder; banned words are built at run time."""
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import slop_guard as sg


def run(root, *paths):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        code = sg.main(["--root", root, "--json", *paths])
    return code, json.loads(buf.getvalue())


class Impeccable(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def write(self, name, text):
        p = os.path.join(self.tmp, name)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as fh:
            fh.write(text)
        return name

    def rules(self, report):
        return {f["rule"] for f in report["findings"]}

    def test_there_are_62_rules_with_unique_ids(self):
        self.assertEqual(len(sg.ALL_IDS), 62)
        self.assertEqual(len(set(sg.ALL_IDS)), 62)

    def test_prose_rules(self):
        hype = "Ele" + "vate your flow with a seam" + "less, next" + "-gen tool" + "! Lorem " + "ipsum. Click " + "here. The the end."
        f = self.write("copy.md", "# Copy\n\n" + hype + "\n")
        code, r = run(self.tmp, f)
        self.assertEqual(code, 1)
        self.assertTrue({"P01", "P02", "P04", "P17", "P18", "P19", "P21"} <= self.rules(r), self.rules(r))

    def test_design_rules_on_css_and_html(self):
        css = self.write("a.css", ".x { color: #ff0000; transition: all .2s; height: 100vh; font-size: 10px; padding: 10px; z-index: 9999; outline: none; }\n.t { --brand: #123456; }\n")
        html = self.write("a.html", '<div style="color:red"></div><img src="x.png"><a href="#">x</a><a href="https://example.com" target="_blank">y</a><button>z</button>\n')
        _, r = run(self.tmp, css, html)
        got = self.rules(r)
        self.assertTrue({"D01", "D02", "D03", "D04", "D05", "D08", "D11", "D06", "D12", "D13", "D14", "D15"} <= got, got)
        d01_lines = [f["line"] for f in r["findings"] if f["rule"] == "D01"]
        self.assertEqual(d01_lines, [1], "a custom property definition is a token, not a stray literal")

    def test_focus_outline_is_fine_with_focus_visible(self):
        css = self.write("b.css", "main:focus { outline: none; }\n:focus-visible { outline: 2px solid; }\n")
        _, r = run(self.tmp, css)
        self.assertNotIn("D11", self.rules(r))

    def test_code_rules_and_python_ast(self):
        js = self.write("a.js", "var x = 1;\n// " + "TO" + "DO fix later\nconsole.log(x);\ndebugger;\n// const y = 2;\nconst m = \"Saving...\";\n")
        py = self.write("a.py", "import os\nimport json\n\n\ndef stub():\n    pass\n\n\ndef f(a=[]):\n    try:\n        return a\n        print(a)\n    except:\n        pass\n\n\ndef g():\n    try:\n        return json.dumps(1)\n    except Exception:\n        pass\n")
        code, r = run(self.tmp, js, py)
        self.assertEqual(code, 1)
        self.assertTrue({"C05", "C01", "C03", "C04", "C06", "D18", "C09", "C11", "C13", "C12", "C10", "C14"} <= self.rules(r), self.rules(r))
        unused = [f for f in r["findings"] if f["rule"] == "C09"]
        self.assertEqual(len(unused), 1, "json is used, os is not")

    def test_doc_rules(self):
        self.write("there.md", "# x\n")
        doc = self.write("docs/adr/ADR-999-x.md", "# T\n\n### Jump\n\ntext\n\n## A\n## A\n\nSee [here](../../there.md) and [gone](missing.md). TBD.\n\n```\ncode\n```\n")
        _, r = run(self.tmp, doc)
        self.assertTrue({"M01", "M02", "M03", "M04", "M06", "M07", "M08"} <= self.rules(r), self.rules(r))
        broken = [f for f in r["findings"] if f["rule"] == "M03"]
        self.assertEqual(len(broken), 1)

    def test_ignore_markers(self):
        f = self.write("q.md", "<!-- slop-guard: ignore-file -->\nEle" + "vate!\n")
        g = self.write("r.md", "# R\n\nseam" + "less  <!-- slop-guard: ignore -->\n")
        _, r = run(self.tmp, f, g)
        self.assertEqual(r["findings"], [])

    def test_paths_cannot_leave_root(self):
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf):
            self.assertEqual(sg.main(["--root", self.tmp, "../"]), 2)


if __name__ == "__main__":
    unittest.main()
