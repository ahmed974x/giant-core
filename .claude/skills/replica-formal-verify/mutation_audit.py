#!/usr/bin/env python3
"""mutation_audit: lists the mutants of a Python module (comparison flips, arithmetic swaps, negated
conditions, boolean and constant changes), estimates which ones the tests would catch, and can write each
mutant as a copy so a person runs the tests on it.

Standard library only (ast, copy, json, os, re, argparse, sys). No network, no processes: nothing is imported
or run. The estimate is static [INFERENCE]: a mutation point counts as covered when a test file calls its
function (or a function that calls it) and asserts on a result. Run the written mutants with the real test runner to measure the true kill
rate.

    python3 mutation_audit.py MODULE.py --tests tests/ [--json] [--out work/mutants --root .] [--max 200]
    python3 mutation_audit.py MODULE.py --evidence jarvis/replica/evidence/mutation-audit.log   # the measured result
"""

import argparse
import ast
import copy
import hashlib
import json
import os
import re
import sys

CMP_SWAP = {ast.Lt: ast.GtE, ast.GtE: ast.Lt, ast.Gt: ast.LtE, ast.LtE: ast.Gt, ast.Eq: ast.NotEq, ast.NotEq: ast.Eq, ast.In: ast.NotIn, ast.NotIn: ast.In, ast.Is: ast.IsNot, ast.IsNot: ast.Is}
BIN_SWAP = {ast.Add: ast.Sub, ast.Sub: ast.Add, ast.Mult: ast.Div, ast.Div: ast.Mult, ast.FloorDiv: ast.Mult, ast.Mod: ast.Mult}
BOOL_SWAP = {ast.And: ast.Or, ast.Or: ast.And}


def mutation_points(tree):
    """Every place a mutant can be made: (node index in walk order, kind, line, col, function)."""
    func_of = {}
    for fn in ast.walk(tree):
        if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for n in ast.walk(fn):
                func_of.setdefault(id(n), fn.name)
    points = []
    for idx, n in enumerate(ast.walk(tree)):
        kind = None
        if isinstance(n, ast.Compare) and type(n.ops[0]) in CMP_SWAP:
            kind = "compare " + type(n.ops[0]).__name__ + " -> " + CMP_SWAP[type(n.ops[0])].__name__
        elif isinstance(n, ast.BinOp) and type(n.op) in BIN_SWAP:
            kind = "arith " + type(n.op).__name__ + " -> " + BIN_SWAP[type(n.op)].__name__
        elif isinstance(n, ast.BoolOp) and type(n.op) in BOOL_SWAP:
            kind = "bool " + type(n.op).__name__ + " -> " + BOOL_SWAP[type(n.op)].__name__
        elif isinstance(n, (ast.If, ast.While)):
            kind = "negate condition"
        elif isinstance(n, ast.Constant) and isinstance(n.value, bool):
            kind = "constant " + str(n.value) + " -> " + str(not n.value)
        elif isinstance(n, ast.Constant) and type(n.value) is int and not isinstance(n.value, bool):
            kind = "constant " + str(n.value) + " -> " + str(n.value + 1)
        elif isinstance(n, ast.Return) and n.value is not None:
            kind = "return None"
        if kind:
            points.append({"index": idx, "kind": kind, "line": getattr(n, "lineno", 0), "col": getattr(n, "col_offset", 0), "function": func_of.get(id(n))})
    return points


def mutate(tree, index):
    """A copy of the tree with the node at walk index changed."""
    t = copy.deepcopy(tree)
    n = list(ast.walk(t))[index]
    if isinstance(n, ast.Compare):
        n.ops[0] = CMP_SWAP[type(n.ops[0])]()
    elif isinstance(n, ast.BinOp):
        n.op = BIN_SWAP[type(n.op)]()
    elif isinstance(n, ast.BoolOp):
        n.op = BOOL_SWAP[type(n.op)]()
    elif isinstance(n, (ast.If, ast.While)):
        n.test = ast.UnaryOp(op=ast.Not(), operand=n.test)
    elif isinstance(n, ast.Constant) and isinstance(n.value, bool):
        n.value = not n.value
    elif isinstance(n, ast.Constant):
        n.value = n.value + 1
    elif isinstance(n, ast.Return):
        n.value = ast.Constant(value=None)
    return ast.fix_missing_locations(t)


def test_texts(paths):
    texts = []
    for p in paths:
        files = [p] if os.path.isfile(p) else [os.path.join(d, f) for d, _, fs in os.walk(p) for f in sorted(fs) if f.endswith(".py")]
        for f in files:
            with open(f, encoding="utf-8") as fh:
                texts.append(fh.read())
    return texts


def covered(function, texts):
    if not function:
        return False
    called = re.compile(r"(?<![\w])" + re.escape(function) + r"\s*\(")
    return any(called.search(t) and re.search(r"\bassert\w*\s*\(|\bassert\s", t) for t in texts)


def reached(tree, texts):
    """Functions a test calls and asserts on, plus every function of this module they call in turn."""
    calls = {}
    for fn in ast.walk(tree):
        if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            names = calls.setdefault(fn.name, set())
            for n in ast.walk(fn):
                if isinstance(n, ast.Call):
                    f = n.func
                    names.add(f.id if isinstance(f, ast.Name) else f.attr if isinstance(f, ast.Attribute) else "")
    seen = {f for f in calls if covered(f, texts)}
    todo = list(seen)
    while todo:
        for g in calls.get(todo.pop(), ()):
            if g in calls and g not in seen:
                seen.add(g)
                todo.append(g)
    return seen


def audit(path, tests, limit=200, functions=None):
    with open(path, encoding="utf-8") as fh:
        src = fh.read()
    tree = ast.parse(src)
    pts = [p for p in mutation_points(tree) if not functions or p["function"] in functions][:limit]
    texts = test_texts(tests)
    hit = reached(tree, texts)
    for p in pts:
        p["covered"] = p["function"] in hit
    cov = sum(1 for p in pts if p["covered"])
    by = {}
    for p in pts:
        f = p["function"] or "(module)"
        b = by.setdefault(f, {"function": f, "points": 0, "covered": 0})
        b["points"] += 1
        b["covered"] += p["covered"]
    return {"module": path.replace(os.sep, "/"), "points": len(pts), "covered": cov,
            "strength": round(100 * cov / len(pts), 1) if pts else 100.0, "label": "[INFERENCE] static estimate; run the mutants to measure",
            "functions": sorted(by.values(), key=lambda b: b["covered"] / b["points"]), "mutants": pts}, tree


def verified_result(module, log_path):
    """The measured result for this module from the harness log, only if the module is byte-for-byte the one tested."""
    try:
        with open(log_path, encoding="utf-8") as fh:
            log = json.load(fh)
        with open(module, "rb") as fh:
            digest = hashlib.sha256(fh.read()).hexdigest()
    except (OSError, ValueError) as e:
        return {"match": False, "reason": str(e)}
    name = module.replace(os.sep, "/")
    for t in log.get("targets", []):
        if name.endswith(t.get("file", "\0")):
            if t.get("sha256") != digest:
                return {"match": False, "reason": "the module changed after the run"}
            return {"match": True, "ranAt": log.get("ranAt"), **{k: t[k] for k in ("mutants", "killed", "equivalent", "survived", "score")}}
    return {"match": False, "reason": "the module is not in the log"}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("module")
    ap.add_argument("--tests", nargs="*", default=[])
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--out")
    ap.add_argument("--root", default=".")
    ap.add_argument("--max", type=int, default=200)
    ap.add_argument("--functions", help="comma-separated function names to mutate (default: all)")
    ap.add_argument("--evidence", help="a mutation-audit.log written by jarvis/scripts/mutation_harness.py: its measured kill rate replaces the estimate when the module's SHA-256 matches")
    a = ap.parse_args(argv)
    try:
        rep, tree = audit(a.module, a.tests, max(1, min(a.max, 2000)), [f.strip() for f in a.functions.split(",")] if a.functions else None)
        if a.evidence:
            rep["verified"] = verified_result(a.module, a.evidence)
    except (OSError, SyntaxError) as e:
        print("mutation_audit: " + str(e), file=sys.stderr)
        return 2
    if a.out:
        root = os.path.realpath(a.root)
        out = os.path.realpath(os.path.join(root, a.out))
        if os.path.commonpath([root, out]) != root:
            print("mutation_audit: --out must stay inside --root", file=sys.stderr)
            return 2
        os.makedirs(out, exist_ok=True)
        base = os.path.splitext(os.path.basename(a.module))[0]
        for k, p in enumerate(rep["mutants"]):
            with open(os.path.join(out, f"{base}_m{k:03d}.py"), "w", encoding="utf-8") as fh:
                fh.write(f"# mutant {k}: {p['kind']} at line {p['line']} (written by mutation_audit.py; not run)\n" + ast.unparse(mutate(tree, p["index"])) + "\n")
    if a.json:
        print(json.dumps(rep, indent=1))
    else:
        v = rep.get("verified")
        if v and v.get("match"):
            print(f"{rep['module']}: {v['killed']}/{v['mutants'] - v['equivalent']} mutants killed ({v['score']}%), {v['equivalent']} equivalent [VERIFIED] run {v['ranAt']}")
        elif v:
            print(f"{rep['module']}: the evidence is stale or missing ({v['reason']}); showing the static estimate")
        if not (v and v.get("match")):
            print(f"{rep['module']}: {rep['points']} mutation points, {rep['covered']} covered by a test that asserts · strength {rep['strength']}% {rep['label']}")
            for f in rep["functions"][:15]:
                print(f"  {f['function']:<28} {f['covered']}/{f['points']}")
        if a.out:
            print(f"wrote {rep['points']} mutants to {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
