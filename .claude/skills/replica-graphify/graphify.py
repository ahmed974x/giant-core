#!/usr/bin/env python3
"""graphify: a structural knowledge graph of Jarvis, without a vector database.

Standard library only (ast, re, json, hashlib, os). No network, no processes; files are read, never run.
It joins five kinds of node by reading the code as text (and Python with ast):

  screen  - pages.<name> in jarvis/app/src/app.js and the nav routes in shell.tmpl
  route   - API routes in jarvis/server/server.mjs (R("METHOD", /^...$/) and rest === "/..." forms)
  module  - jarvis/server/lib/*.mjs that a route calls (const x = createX(...))
  table   - create table in jarvis/server/lib/schema-sqlite.sql, with its named constraints
  skill   - .claude/skills/*/SKILL.md, with the Python tools inside (functions found by ast)

Edges: screen -> route (the store method a page calls, and the path that method requests), route -> module
(the module object the route calls), module -> table (SQL in the module's file), skill -> tool.

    python3 graphify.py --root . [--out jarvis/app/data/knowledge-graph.json]

The output records the SHA-256 of every file read, so a stale graph can be told from a fresh one.
"""

import argparse
import ast
import hashlib
import json
import os
import re
import sys

APP = "jarvis/app/src/app.js"
SHELL = "jarvis/app/src/shell.tmpl"
SERVER = "jarvis/server/server.mjs"
LIB = "jarvis/server/lib"
SCHEMA = "jarvis/server/lib/schema-sqlite.sql"
SKILLS = ".claude/skills"


class GraphError(Exception):
    pass


def inside(root, path):
    base = os.path.realpath(root)
    p = os.path.realpath(os.path.join(base, path))
    return p if p == base or p.startswith(base + os.sep) else None


def read(root, rel, files):
    p = inside(root, rel)
    if not p or not os.path.isfile(p):
        raise GraphError(f"{rel} is not a file inside {root}.")
    with open(p, encoding="utf-8", errors="replace") as fh:
        text = fh.read()
    files[rel] = hashlib.sha256(text.encode()).hexdigest()
    return text


def line_of(text, index):
    return text.count("\n", 0, index) + 1


def norm_path(p):
    """/api/w/:slug/x or a regex source -> a readable route path."""
    p = p.replace("\\/", "/").replace("^", "").replace("$", "")
    p = re.sub(r"\(\[\\w-\]\{1,64\}\)|\(\[a-z0-9-\]\{1,40\}\)|\(\\d\{1,6\}\)|\(\\d\{1,4\}\)", ":id", p)
    p = re.sub(r"\(\?:[^)]*\)\?", "", p)
    return p


def screens(app, shell):
    out = {}
    for m in re.finditer(r"^\s*pages\.(\w+)\s*=", app, re.M):
        out[m.group(1)] = {"line": line_of(app, m.start()), "body_start": m.end()}
    starts = sorted((v["body_start"], k) for k, v in out.items())
    for i, (start, k) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else len(app)
        out[k]["body"] = app[start:end]
    nav = set(re.findall(r'data-route="(\w+)"', shell))
    return out, nav


def store_methods(app):
    """Live store methods and the API path each requests."""
    out = {}
    for m in re.finditer(r"^\s{6}(?:async\s+)?(\w+)\s*(?::[^\n]*?=>|\([^)]*\)\s*\{)([^\n]*(?:\n(?!\s{6}\w+\s*[:(])[^\n]*){0,12})", app, re.M):
        body = m.group(2)
        for pm in re.finditer(r'req\("(GET|POST|PATCH|PUT|DELETE)",\s*(w\()?"([^"]+)"(\s*\+\s*encodeURIComponent\(\w+\)(\s*\+\s*"([^"]+)")?)?|fetch\("(/api/[^"]+)"', body):
            method = pm.group(1) or "POST"
            path = pm.group(3) or pm.group(7)
            path = path.split("?")[0]
            if pm.group(4):  # "/runs/" + encodeURIComponent(id) [+ "/cancel"]
                path = path.rstrip("/") + "/:id" + (pm.group(6) or "")
            path = ("/api/w/:slug" + path) if pm.group(2) else path
            out.setdefault(m.group(1), set()).add((method, norm_path(path)))
    return out


def routes(server):
    out = []
    for m in re.finditer(r'R\("(\w+)",\s*/(\^[^/]*(?:\\/[^/]*)*\$)/\)', server):
        out.append((m.group(1), norm_path(m.group(2)), line_of(server, m.start())))
    for m in re.finditer(r'req\.method === "(\w+)" && rest === "([^"]+)"', server):
        out.append((m.group(1), "/api/w/:slug" + m.group(2), line_of(server, m.start())))
    # (k = /^\/x\/([\w-]{1,64})(\/y)?$/.exec(rest)): either on the same line as its method, or a block
    # whose following lines name the method with k[2], !k[2], k[2] === "y", sub === "/y" or exec(sub).
    lines = server.split("\n")
    for i, line in enumerate(lines):
        b = re.search(r'(?:req\.method === "(\w+)" && )?\((\w) = /\^(.*?)\$/\.exec\(rest\)\)', line)
        if not b:
            continue
        same_method, var, src = b.group(1), b.group(2), b.group(3)
        tail = re.search(r"(\(\?:\\/\(([a-z|-]+)\)\)\?|\((\\/[a-z-]+)\)\?|\(\\/\.\*\)\?)$", src)
        base = "/api/w/:slug" + norm_path(src[:tail.start()] if tail else src)
        if same_method:
            out.append((same_method, base, i + 1))
            continue
        for j in range(i + 1, min(i + 16, len(lines))):
            if "exec(rest)" in lines[j] or re.match(r"^\s{0,8}\}\s*$", lines[j]):
                break
            for mm in re.finditer(r'req\.method === "(\w+)"(?: && (?:(!?)' + var + r'\[2\](?: === "([a-z-]+)")?|sub === "([^"]*)"|\(\w = /\^(.*?)\$/\.exec\(sub\)\))|(?=\)))', lines[j]):
                method, neg, named, sub, subre = mm.groups()
                if subre is not None:
                    suffix = norm_path(subre)
                elif sub is not None:
                    suffix = sub
                elif named:
                    suffix = "/" + named
                elif neg == "!" or neg is None:
                    suffix = ""
                else:
                    suffix = norm_path(tail.group(3)) if tail and tail.group(3) else ""
                out.append((method, base + suffix, j + 1))
    seen, uniq = set(), []
    for r in out:
        if (r[0], r[1]) not in seen:
            seen.add((r[0], r[1]))
            uniq.append(r)
    return uniq


def route_module(server, line):
    """The module object a route line calls, e.g. memory.search -> memory."""
    text = server.split("\n")[line - 1]
    m = re.search(r"await\s+(\w+)\.\w+\(", text)
    return m.group(1) if m else None


def module_files(server):
    imports = dict(re.findall(r'import \{[^}]*\b(create\w+)\b[^}]*\} from "\./lib/([\w.-]+)"', server))
    objs = {}
    for var, fn in re.findall(r"\b(\w+)\s*=\s*(create\w+)\(", server):
        if fn in imports:
            objs[var] = imports[fn]
    return objs


def tables(schema):
    out = {}
    for m in re.finditer(r"create table if not exists (\w+) \(", schema):
        end = schema.find("\n);", m.end())
        block = schema[m.end():end]
        out[m.group(1)] = {"line": line_of(schema, m.start()), "constraints": re.findall(r"constraint (\w+)", block)}
    return out


def tables_in(text, names):
    found = set()
    for t in names:
        if re.search(r"\b(from|into|update|join|table)\s+" + re.escape(t) + r"\b", text, re.I):
            found.add(t)
    return found


def skills(root, files):
    out = []
    base = inside(root, SKILLS)
    if not base or not os.path.isdir(base):
        return out
    for name in sorted(os.listdir(base)):
        md = os.path.join(SKILLS, name, "SKILL.md")
        if not inside(root, md) or not os.path.isfile(inside(root, md)):
            continue
        text = read(root, md, files)
        fm = re.match(r"^---\s*\n(.*?)\n---", text, re.S)
        desc = re.search(r"^description:\s*(.+)$", fm.group(1), re.M).group(1).strip()[:200] if fm and re.search(r"^description:", fm.group(1), re.M) else ""
        tools = []
        for f in sorted(os.listdir(os.path.join(base, name))):
            if f.endswith(".py"):
                rel = os.path.join(SKILLS, name, f)
                try:
                    tree = ast.parse(read(root, rel, files))
                    funcs = [n.name for n in tree.body if isinstance(n, ast.FunctionDef) and not n.name.startswith("_")]
                except SyntaxError:
                    funcs = []
                tools.append({"file": f, "functions": funcs[:30]})
        out.append({"name": name, "description": desc, "tools": tools})
    return out


def build(root):
    files = {}
    app, shell, server, schema = (read(root, p, files) for p in (APP, SHELL, SERVER, SCHEMA))
    nodes, edges = {}, set()

    def node(nid, kind, label, **extra):
        nodes.setdefault(nid, {"id": nid, "kind": kind, "label": label, **extra})
    pg, nav = screens(app, shell)
    methods = store_methods(app)
    tab = tables(schema)
    for name, t in tab.items():
        node("table:" + name, "table", name, file=SCHEMA, line=t["line"], constraints=t["constraints"])
    objs = module_files(server)
    mod_tables = {}
    for var, f in objs.items():
        rel = LIB + "/" + f
        if inside(root, rel) and os.path.isfile(inside(root, rel)):
            mod_tables[var] = tables_in(read(root, rel, files), tab.keys())
            node("module:" + var, "module", f, file=rel)
            for t in sorted(mod_tables[var]):
                edges.add(("module:" + var, "table:" + t, "sql"))
    rts = routes(server)
    route_ids = {}
    for method, path, line in rts:
        rid = "route:" + method + " " + path
        node(rid, "route", method + " " + path, file=SERVER, line=line)
        route_ids[(method, path)] = rid
        var = route_module(server, line)
        if var and var in objs:
            edges.add((rid, "module:" + var, "calls"))
    for name, p in pg.items():
        node("screen:" + name, "screen", name, file=APP, line=p["line"], nav=name in nav)
        for meth in set(re.findall(r"store\.(\w+)\(", p["body"])):
            for method, path in methods.get(meth, ()):
                rid = route_ids.get((method, path))
                if rid:
                    edges.add(("screen:" + name, rid, "requests"))
    for s in skills(root, files):
        node("skill:" + s["name"], "skill", s["name"], file=SKILLS + "/" + s["name"] + "/SKILL.md", description=s["description"])
        for t in s["tools"]:
            tid = "tool:" + s["name"] + "/" + t["file"]
            node(tid, "tool", t["file"], file=SKILLS + "/" + s["name"] + "/" + t["file"], functions=t["functions"])
            edges.add(("skill:" + s["name"], tid, "has"))
    e = [{"from": a, "to": b, "kind": k} for a, b, k in sorted(edges)]
    linked = {x["from"] for x in e} | {x["to"] for x in e}
    counts = {k: sum(1 for n in nodes.values() if n["kind"] == k) for k in ("screen", "route", "module", "table", "skill", "tool")}
    digest = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()
    return {"format": "jarvis-knowledge-graph-v1", "counts": counts, "edges_count": len(e),
            "unlinked": sorted(n for n in nodes if n not in linked and nodes[n]["kind"] in ("route", "table")),
            "nodes": sorted(nodes.values(), key=lambda n: (n["kind"], n["id"])), "edges": e, "files": files, "sha256": digest}


def main(argv=None):
    ap = argparse.ArgumentParser(description="Structural knowledge graph of Jarvis (screens, routes, modules, tables, skills)")
    ap.add_argument("--root", default=".")
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    try:
        g = build(a.root)
    except GraphError as e:
        print(f"graphify: {e}", file=sys.stderr)
        return 2
    text = json.dumps(g, ensure_ascii=False, indent=1) + "\n"
    if a.out:
        p = inside(a.root, a.out)
        if not p:
            print(f"graphify: {a.out} is not inside {a.root}", file=sys.stderr)
            return 2
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as fh:
            fh.write(text)
        print(f"graphify: wrote {a.out} · " + ", ".join(f"{v} {k}s" for k, v in g["counts"].items()) + f" · {g['edges_count']} edges")
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
