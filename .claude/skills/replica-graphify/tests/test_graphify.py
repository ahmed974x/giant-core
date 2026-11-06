"""Tests for graphify on a small fake repository (no network, nothing run)."""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import graphify as gf

APP = '''const x = 1;
      listAgents: ({ status } = {}) => req("GET", w("/agents?status=" + status)),
      getRun: id => req("GET", w("/runs/" + encodeURIComponent(id))),
      cancelRun: id => req("POST", w("/runs/" + encodeURIComponent(id) + "/cancel"), {}),
      llmStatus: () => req("GET", "/api/llm/status"),
  pages.agents = () => { store.listAgents(); store.llmStatus(); };
  pages.run = id => { store.getRun(id); store.cancelRun(id); };
'''
SHELL = '<a href="#/agents" data-route="agents">Agents</a>'
SERVER = '''import { createStore } from "./lib/store.mjs";
import { createOllamaBridge } from "./lib/ollama-bridge.mjs";
  const llm = createOllamaBridge({});
  const store = createStore(db);
      if (R("GET", /^\\/api\\/llm\\/status$/)) return send(200, await llm.status());
        if (req.method === "GET" && rest === "/agents") return send(200, await store.listAgents(slug));
        if (req.method === "GET" && (k = /^\\/runs\\/([\\w-]{1,64})$/.exec(rest))) return send(200, await store.getRun(slug, k[1]));
        if ((k = /^\\/runs\\/([\\w-]{1,64})(\\/cancel)?$/.exec(rest))) {
          if (req.method === "POST" && k[2]) return send(200, await store.cancelRun(slug, k[1]));
        }
'''
SCHEMA = "create table if not exists agents (\n  id text primary key,\n  constraint agents_name_ok check (1)\n);\ncreate table if not exists runs (\n  id text\n);\ncreate table if not exists orphans (\n  id text\n);\n"
STORE = 'export function createStore(db) { db.all("select * from agents"); db.run("update runs set x = 1"); }\n'
BRIDGE = "export function createOllamaBridge() { return {}; }\n"
SKILL = "---\nname: demo\ndescription: A demo skill.\n---\n# demo\n"
TOOL = "def main():\n    return 0\n\n\ndef _hidden():\n    return 1\n"


class Graphify(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        for rel, text in {gf.APP: APP, gf.SHELL: SHELL, gf.SERVER: SERVER, gf.SCHEMA: SCHEMA, gf.LIB + "/store.mjs": STORE, gf.LIB + "/ollama-bridge.mjs": BRIDGE,
                          gf.SKILLS + "/demo/SKILL.md": SKILL, gf.SKILLS + "/demo/tool.py": TOOL}.items():
            p = os.path.join(self.root, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8") as fh:
                fh.write(text)

    def test_graph(self):
        g = gf.build(self.root)
        ids = {n["id"] for n in g["nodes"]}
        self.assertTrue({"screen:agents", "screen:run", "route:GET /api/w/:slug/agents", "route:GET /api/w/:slug/runs/:id", "route:POST /api/w/:slug/runs/:id/cancel", "route:GET /api/llm/status", "module:store", "table:agents", "skill:demo", "tool:demo/tool.py"} <= ids, ids)
        edges = {(e["from"], e["to"]) for e in g["edges"]}
        self.assertIn(("screen:agents", "route:GET /api/w/:slug/agents"), edges)
        self.assertIn(("screen:run", "route:POST /api/w/:slug/runs/:id/cancel"), edges)
        self.assertIn(("route:GET /api/w/:slug/agents", "module:store"), edges)
        self.assertIn(("module:store", "table:runs"), edges)
        self.assertIn("table:orphans", g["unlinked"])
        agents = next(n for n in g["nodes"] if n["id"] == "table:agents")
        self.assertEqual(agents["constraints"], ["agents_name_ok"])
        tool = next(n for n in g["nodes"] if n["id"] == "tool:demo/tool.py")
        self.assertEqual(tool["functions"], ["main"])
        self.assertEqual(len(g["sha256"]), 64)
        self.assertEqual(g["counts"]["screen"], 2)

    def test_out_must_stay_inside_root(self):
        self.assertEqual(gf.main(["--root", self.root, "--out", "../x.json"]), 2)

    def test_missing_file_is_an_error(self):
        os.remove(os.path.join(self.root, gf.SCHEMA))
        self.assertEqual(gf.main(["--root", self.root]), 2)


if __name__ == "__main__":
    unittest.main()
