"""Plan order (ADR-163): the same answers as jarvis/server/lib/plan-order.mjs, standard library only.

Three deterministic tools over the repository's engines:
  kahn   Kahn's topological order in layers, ties broken by name; a cycle is named, never broken
  tree   a behaviour tree of Sequence and Fallback nodes over success, failure and running leaves; the workbench
         (replica-unified-workbench) is read as one, with its locked approvals running until Director 00 decides
  uct    UCB1 over the person's own record of tries: an untried arm first, then mean + c * sqrt(ln N / n);
         with the meta-codes (replica-prompt-metacodes) the arms are the three ALT3 plans
The skill dependencies come from each skill's own sys.path lines (EXTRACTED) and are written by `deps`.
It reads files for `deps` only, sends nothing and starts no process.

    python3 plan_order.py deps --root . --out jarvis/app/data/skill-deps.json
    python3 plan_order.py run '{"mode":"kahn","nodes":["a","b"],"edges":[["a","b"]]}'
    python3 plan_order.py run - < request.json
"""
import argparse
import json
import math
import os
import re
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_SKILLS = os.path.dirname(_HERE)
sys.path[:0] = [_HERE] + [os.path.join(_SKILLS, d) for d in ("replica-unified-workbench", "replica-prompt-metacodes")]
from prompt_metacodes import compile_metacodes  # noqa: E402
from unified_workbench import WorkbenchError, run_workbench  # noqa: E402

PO_MODES = ["kahn", "skills", "tree", "workbench", "uct", "plans"]
PO_LEAF = ["success", "failure", "running"]
PO_OPTIONAL = ["design", "math", "atlas", "security"]
_MISSING = object()


class OrderError(ValueError):
    def __init__(self, message, detail=None):
        super().__init__(message)
        self.status = 400
        self.detail = None if detail is None else str(detail)[:80]


# A refusal from this engine or from the workbench it reads; the server answers both with 400.
ERRORS = (OrderError, WorkbenchError)


def _fail(message, detail=None):
    raise OrderError(message, detail)


def po_r(v):
    """Math.round(v * 10000) / 10000 as JavaScript computes it, whole numbers as int."""
    x = math.floor(v * 10000 + 0.5) / 10000
    return int(x) if x.is_integer() else x


def _len16(s):
    return len(s.encode("utf-16-le")) // 2


def _name(s):
    return isinstance(s, str) and 1 <= _len16(s) <= 80


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def kahn_order(nodes, edges):
    if not isinstance(nodes, list) or not 1 <= len(nodes) <= 200 or not all(_name(n) for n in nodes):
        _fail("Give 1 to 200 node names of 1 to 80 characters.", "nodes")
    if len(set(nodes)) != len(nodes):
        _fail("Each node appears once.", "nodes")
    if not isinstance(edges, list) or len(edges) > 2000:
        _fail("Edges are a list of at most 2000 [before, after] pairs.", "edges")
    known = set(nodes)
    indeg = dict.fromkeys(nodes, 0)
    after = {n: [] for n in nodes}
    for i, e in enumerate(edges):
        if not isinstance(e, list) or len(e) != 2 or not isinstance(e[0], str) or not isinstance(e[1], str) or e[0] not in known or e[1] not in known:
            _fail("Each edge joins two named nodes.", "edges[" + str(i) + "]")
        after[e[0]].append(e[1])
        indeg[e[1]] += 1
    layers = []
    ready = sorted(n for n in nodes if indeg[n] == 0)
    while ready:
        layers.append(ready)
        nxt = []
        for n in ready:
            for m in after[n]:
                indeg[m] -= 1
                if indeg[m] == 0:
                    nxt.append(m)
        ready = sorted(nxt)
    order = [n for layer in layers for n in layer]
    cycle = sorted(n for n in nodes if indeg[n] > 0)
    return {"order": order, "layers": layers, "cycle": cycle, "acyclic": not cycle, "verified": order_kept(order, edges)}


def order_kept(order, edges):
    """The check, on its own: every edge between two placed nodes runs forwards in the order."""
    pos = {n: i for i, n in enumerate(order)}
    return all(a not in pos or b not in pos or pos[a] < pos[b] for a, b in edges)


def skill_order(deps, names):
    d = deps if isinstance(deps, dict) else _fail("Send the dependency snapshot.", "deps")
    pick = names if isinstance(names, list) and 1 <= len(names) <= 12 else _fail("Choose 1 to 12 skills.", "names")
    for n in pick:
        if not _name(n) or n not in d:
            _fail("That skill is not in the snapshot.", n if isinstance(n, str) else "")
    unique = list(dict.fromkeys(pick))
    seen, stack = set(), list(unique)
    while stack:
        n = stack.pop()
        if n in seen:
            continue
        seen.add(n)
        for m in d[n] if isinstance(d[n], list) else []:
            if isinstance(m, str) and m in d:
                stack.append(m)
    nodes = sorted(seen)
    edges = [[m, n] for n in nodes for m in (d[n] if isinstance(d[n], list) else []) if m in seen]
    k = kahn_order(nodes, edges)
    return {"chosen": unique, "added": [n for n in nodes if n not in pick], "edges": edges, **k, "source": "EXTRACTED"}


def _check(node, depth, count):
    if depth > 8:
        _fail("A tree is at most 8 levels deep.", "tree")
    count[0] += 1
    if count[0] > 100:
        _fail("A tree has at most 100 nodes.", "tree")
    if not isinstance(node, dict):
        _fail("Each node is an object.", "tree")
    if node.get("type") == "leaf":
        if not _name(node.get("id")):
            _fail("A leaf needs an id of 1 to 80 characters.", "tree")
        return
    if node.get("type") not in ("sequence", "fallback"):
        t = node.get("type", _MISSING)
        _fail("A node is a sequence, a fallback or a leaf.", "undefined" if t is _MISSING else "null" if t is None else t if isinstance(t, str) else json.dumps(t))
    ch = node.get("children")
    if not isinstance(ch, list) or not 1 <= len(ch) <= 20:
        _fail("A sequence or fallback has 1 to 20 children.", "tree")
    for c in ch:
        _check(c, depth + 1, count)


def _tick(node, leaves, path, trace):
    if node["type"] == "leaf":
        s = leaves.get(node["id"], "failure")
        trace.append({"path": path, "type": "leaf", "id": node["id"], "status": s})
        return s
    stop_on = "success" if node["type"] == "sequence" else "failure"
    s = stop_on
    for i, c in enumerate(node["children"]):
        s = _tick(c, leaves, path + "." + str(i), trace)
        if s != stop_on:
            break
    trace.append({"path": path, "type": node["type"], "id": node.get("id"), "status": s})
    return s


def tick_tree(tree, leaves):
    _check(tree, 1, [0])
    lv = leaves if isinstance(leaves, dict) else _fail("Leaves are an object of id to success, failure or running.", "leaves")
    for k, v in lv.items():
        if v not in PO_LEAF:
            _fail("A leaf is success, failure or running.", k)
    trace = []
    status = _tick(tree, lv, "0", trace)
    return {"status": status, "trace": trace, "ticked": sum(1 for t in trace if t["type"] == "leaf")}


def workbench_tree(result):
    r = result if isinstance(result, dict) and isinstance(result.get("stages"), list) else _fail("Send a workbench result.", "workbench")
    leaves = {}
    for s in r["stages"]:
        leaves[s["id"]] = "success" if s["status"] == "ok" else "failure"
        leaves[s["id"] + ":skipped"] = "success" if s["status"] == "skipped" else "failure"
    leaves["approvals"] = "running" if r["locked"] > 0 else "success"
    children = [{"type": "fallback", "id": s["id"], "children": [{"type": "leaf", "id": s["id"]}, {"type": "leaf", "id": s["id"] + ":skipped"}]}
                if s["id"] in PO_OPTIONAL else {"type": "leaf", "id": s["id"]} for s in r["stages"]]
    tree = {"type": "sequence", "id": "workbench", "children": [*children, {"type": "leaf", "id": "approvals"}]}
    t = tick_tree(tree, leaves)
    stopped = None if t["status"] == "success" else next(x["id"] for x in t["trace"] if re.fullmatch(r"0\.\d+", x["path"]) and x["status"] != "success")
    return {"tree": tree, "leaves": leaves, **t, "stopped_at": stopped, "waiting": r["locked"], "chain_sha256": r.get("chain_sha256")}


def uct_select(arms, c=_MISSING):
    if c is _MISSING:
        cc = math.sqrt(2)
    elif _num(c) and 0 <= c <= 4:
        cc = c
    else:
        _fail("c is a number from 0 to 4.", "c")
    if not isinstance(arms, list) or not 2 <= len(arms) <= 12:
        _fail("Give 2 to 12 arms.", "arms")
    ids = set()
    for i, a in enumerate(arms):
        if not isinstance(a, dict) or not _name(a.get("id")) or a["id"] in ids:
            _fail("Each arm has its own id of 1 to 80 characters.", "arms[" + str(i) + "]")
        ids.add(a["id"])
        v = a.get("visits")
        if not ((isinstance(v, int) and not isinstance(v, bool)) or (isinstance(v, float) and v.is_integer())) or not 0 <= v <= 1e6:
            _fail("visits is a whole number from 0 to 1000000.", a["id"])
        w = a.get("reward")
        if not _num(w) or not w >= 0 or w > v:
            _fail("reward is from 0 to visits.", a["id"])
    n_all = sum(a["visits"] for a in arms)
    ranked = []
    for i, a in enumerate(arms):
        if a["visits"] == 0:
            ranked.append({"id": a["id"], "visits": 0, "mean": None, "bonus": None, "score": None, "order": i})
            continue
        mean = a["reward"] / a["visits"]
        bonus = cc * math.sqrt(math.log(n_all) / a["visits"])
        ranked.append({"id": a["id"], "visits": a["visits"], "mean": po_r(mean), "bonus": po_r(bonus), "score": po_r(mean + bonus), "order": i})
    untried = [a for a in ranked if a["score"] is None]
    tried = sorted((a for a in ranked if a["score"] is not None), key=lambda a: -a["score"])  # stable: ties keep the given order
    lst = [{k: v for k, v in a.items() if k != "order"} for a in untried + tried]
    reason = "untried" if untried else "tie" if tried[0]["score"] == tried[1]["score"] else "score"
    return {"c": po_r(cc), "N": n_all, "chosen": lst[0]["id"], "ranked": lst, "reason": reason, "tag": "[INFERENCE]"}


def _field(entry, key):
    """entry?.[key] ?? 0 as JavaScript reads it."""
    v = entry.get(key) if isinstance(entry, dict) else None
    return 0 if v is None else v


def plan_order(req, deps=None):
    r = req if isinstance(req, dict) else _fail("Send an object with a mode.", "")
    mode = r.get("mode")
    if mode == "kahn":
        return {"mode": "kahn", **kahn_order(r.get("nodes"), r.get("edges"))}
    if mode == "skills":
        return {"mode": "skills", **skill_order(deps, r.get("names"))}
    if mode == "tree":
        return {"mode": "tree", **tick_tree(r.get("tree"), r.get("leaves"))}
    if mode == "workbench":
        return {"mode": "workbench", **workbench_tree(run_workbench(r.get("request")))}
    if mode == "uct":
        return {"mode": "uct", **(uct_select(r.get("arms"), r["c"]) if "c" in r else uct_select(r.get("arms")))}
    if mode == "plans":
        prompt = r.get("prompt") if isinstance(r.get("prompt"), str) else _fail("The prompt is text.", "prompt")
        m = compile_metacodes({"prompt": prompt, "lang": "ar" if r.get("lang") == "ar" else "en", "codes": ["ALT3"]})
        rec = r.get("record", {})
        if not isinstance(rec, dict):
            _fail("The record is an object of plan id to {visits, reward}.", "record")
        for k in rec:
            if not any(o["id"] == k for o in m["options"]):
                _fail("The record names a plan that is not one of the three.", k)
        arms = [{"id": o["id"], "visits": _field(rec.get(o["id"]), "visits"), "reward": _field(rec.get(o["id"]), "reward")} for o in m["options"]]
        u = uct_select(arms, r["c"]) if "c" in r else uct_select(arms)
        return {"mode": "plans", "options": [{"id": o["id"], "title": o["title"], "proved": o.get("proved") is True} for o in m["options"]], "sha256": m["sha256"], **u}
    return _fail("Choose a mode: " + ", ".join(PO_MODES) + ".", mode if isinstance(mode, str) else "")


def _sys_path_text(text):
    """Every top-level sys.path statement with its indented continuation lines."""
    return "\n".join(re.findall(r"^sys\.path.*(?:\n[ \t]+.*)*", text, re.M))


def deps_snapshot(root):
    """Each skill's dependencies: the other skills its own Python files put on sys.path. Files only."""
    base = os.path.join(root, ".claude", "skills")
    names = sorted(d for d in os.listdir(base) if os.path.isfile(os.path.join(base, d, "SKILL.md")))
    known = set(names)
    skills = {}
    for name in names:
        found = set()
        for f in sorted(os.listdir(os.path.join(base, name))):
            if f.endswith(".py"):
                with open(os.path.join(base, name, f), encoding="utf-8") as fh:
                    found.update(x for x in re.findall(r"[\"']([a-z0-9][a-z0-9-]*)[\"']", _sys_path_text(fh.read())) if x in known and x != name)
        skills[name] = sorted(found)
    return {"format": "jarvis-skill-deps-v1", "source": "EXTRACTED from sys.path lines", "skills": skills}


def main(argv=None):
    p = argparse.ArgumentParser(description="Plan order (ADR-163).")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("deps")
    s.add_argument("--root", default=".")
    s.add_argument("--out", required=True)
    rr = sub.add_parser("run")
    rr.add_argument("request")
    rr.add_argument("--deps", default=None)
    a = p.parse_args(argv)
    try:
        if a.cmd == "deps":
            snap = deps_snapshot(a.root)
            with open(a.out, "w", encoding="utf-8") as fh:
                fh.write(json.dumps(snap, ensure_ascii=False, indent=1) + "\n")
            print(f"plan_order: wrote {a.out} · {len(snap['skills'])} skills, {sum(len(v) for v in snap['skills'].values())} links")
            return 0
        raw = sys.stdin.read() if a.request == "-" else a.request
        deps = None
        if a.deps:
            with open(a.deps, encoding="utf-8") as fh:
                deps = json.load(fh)["skills"]
        print(json.dumps(plan_order(json.loads(raw), deps), ensure_ascii=False))
        return 0
    except (*ERRORS, json.JSONDecodeError) as e:
        print(json.dumps({"error": str(e), "detail": getattr(e, "detail", None)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
