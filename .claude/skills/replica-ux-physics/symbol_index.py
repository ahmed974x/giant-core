#!/usr/bin/env python3
"""symbol_index: a symbol index of Python and JavaScript files with each file's SHA-256, so a reviewer can see
what a change touched and prove a file did not move since it was read.

Standard library only (ast, tokenize, hashlib, re, json, os, argparse). No network, no processes. Python is
read with ast (functions, async functions, classes, methods, with their arguments and line) and tokenize
(comment count); .js and .mjs are read with fixed patterns for export function, export const, class and
top-level function. Nothing is imported or run.

    python3 symbol_index.py jarvis/server/lib .claude/skills/replica-ux-physics [--json] [--out FILE --root .]
"""

import argparse
import ast
import hashlib
import io
import json
import os
import re
import sys
import tokenize

SKIP_DIRS = {"node_modules", ".git", "__pycache__", ".data"}
JS_PATTERNS = [
    ("function", re.compile(r"^(export\s+)?(async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)", re.M)),
    ("const", re.compile(r"^(export\s+)const\s+([A-Za-z_$][\w$]*)\s*=", re.M)),
    ("class", re.compile(r"^(export\s+)?class\s+([A-Za-z_$][\w$]*)", re.M)),
]


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def python_symbols(text):
    tree = ast.parse(text)
    out = []

    def args_of(fn):
        return [a.arg for a in fn.args.posonlyargs + fn.args.args + fn.args.kwonlyargs]

    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            out.append({"kind": "async function" if isinstance(node, ast.AsyncFunctionDef) else "function", "name": node.name, "line": node.lineno, "args": args_of(node), "exported": not node.name.startswith("_")})
        elif isinstance(node, ast.ClassDef):
            out.append({"kind": "class", "name": node.name, "line": node.lineno, "args": [], "exported": not node.name.startswith("_")})
            for sub in node.body:
                if isinstance(sub, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    out.append({"kind": "method", "name": node.name + "." + sub.name, "line": sub.lineno, "args": args_of(sub), "exported": not sub.name.startswith("_")})
        elif isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id.isupper():
            out.append({"kind": "constant", "name": node.targets[0].id, "line": node.lineno, "args": [], "exported": True})
    comments = sum(1 for t in tokenize.generate_tokens(io.StringIO(text).readline) if t.type == tokenize.COMMENT)
    return out, comments


def js_symbols(text):
    out = []
    for kind, rx in JS_PATTERNS:
        for m in rx.finditer(text):
            line = text.count("\n", 0, m.start()) + 1
            if kind == "function":
                out.append({"kind": "function", "name": m.group(3), "line": line, "args": [a.strip().split("=")[0].strip() for a in m.group(4).split(",") if a.strip()], "exported": bool(m.group(1))})
            else:
                out.append({"kind": kind, "name": m.group(2), "line": line, "args": [], "exported": bool(m.group(1))})
    comments = len(re.findall(r"^\s*//", text, re.M))
    return sorted(out, key=lambda s: s["line"]), comments


def index_paths(paths):
    files = []
    for p in paths:
        if os.path.isfile(p):
            files.append(p)
            continue
        for d, subdirs, names in os.walk(p):
            subdirs[:] = sorted(x for x in subdirs if x not in SKIP_DIRS)
            files.extend(os.path.join(d, n) for n in sorted(names) if n.endswith((".py", ".mjs", ".js")))
    out = []
    for f in files:
        with open(f, encoding="utf-8") as fh:
            text = fh.read()
        try:
            syms, comments = python_symbols(text) if f.endswith(".py") else js_symbols(text)
            err = None
        except SyntaxError as e:
            syms, comments, err = [], 0, f"syntax error line {e.lineno}"
        out.append({"file": f.replace(os.sep, "/"), "sha256": sha256_file(f), "lines": text.count("\n") + 1, "comments": comments, "symbols": syms, **({"error": err} if err else {})})
    return {"format": "jarvis-symbol-index-v1", "files": out, "symbols": sum(len(x["symbols"]) for x in out)}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--out")
    ap.add_argument("--root", default=".")
    a = ap.parse_args(argv)
    for p in a.paths:
        if not os.path.exists(p):
            print("symbol_index: no such path: " + p, file=sys.stderr)
            return 2
    doc = index_paths(a.paths)
    if a.out:
        root = os.path.realpath(a.root)
        out = os.path.realpath(os.path.join(root, a.out))
        if os.path.commonpath([root, out]) != root:
            print("symbol_index: --out must stay inside --root", file=sys.stderr)
            return 2
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, indent=1)
            fh.write("\n")
    if a.json:
        print(json.dumps(doc, indent=1))
    else:
        for f in doc["files"]:
            print(f"{f['sha256'][:12]}  {f['file']}  {len(f['symbols'])} symbols" + ("  " + f["error"] if f.get("error") else ""))
        print(f"{len(doc['files'])} files, {doc['symbols']} symbols")
    return 0


if __name__ == "__main__":
    sys.exit(main())
