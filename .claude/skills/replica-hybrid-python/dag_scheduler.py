#!/usr/bin/env python3
"""Workflow DAG scheduling with graphlib.TopologicalSorter (replica-hybrid-python).

    python3 dag_scheduler.py PLAN.json [--root REPO] [--json]

PLAN.json: {"nodes": [{"id": "a", "title": "…", "gate": "tests|lint|contrast|security|approval|", "locked": false, "minutes": 5}],
            "edges": [["a", "b"]]}   # b needs a

Prints the batches that can run in parallel, in order, the critical path, and which nodes are locked.
A node is locked when its gate is approval, when it says locked, or when its title names money,
publishing, permissions, installs or outbound messages (AGENTS.md §1): it waits for a person, and
every node that needs it waits too, while every other node keeps its place. A cycle is refused and
named. Nothing runs; this only plans.
"""

import argparse
import json
import sys
from graphlib import CycleError, TopologicalSorter

from hcommon import HybridError, locked, read


def load(plan):
    nodes = plan.get("nodes") if isinstance(plan, dict) else None
    if not isinstance(nodes, list) or not nodes:
        raise HybridError("The plan needs a non-empty nodes list.")
    ids = []
    for n in nodes:
        i = str(n.get("id", ""))
        if not i or i in ids:
            raise HybridError(f"Node id {i!r} is empty or repeated.")
        ids.append(i)
    preds = {i: set() for i in ids}
    for e in plan.get("edges", []):
        a, b = (str(x) for x in e)
        if a not in preds or b not in preds:
            raise HybridError(f"Edge {a} -> {b} names a missing node.")
        if a == b:
            raise HybridError(f"{a} cannot need itself.")
        preds[b].add(a)
    return {str(n["id"]): n for n in nodes}, preds


def schedule(plan):
    byid, preds = load(plan)
    ts = TopologicalSorter(preds)
    try:
        ts.prepare()
    except CycleError as e:
        raise HybridError("These nodes need each other in a loop: " + " -> ".join(map(str, e.args[1])) + ".") from e
    lockset = {i for i, n in byid.items() if n.get("locked") is True or str(n.get("gate", "")).lower() == "approval" or locked(n.get("title", ""))}
    batches = []
    while ts.is_active():
        ready = sorted(ts.get_ready())
        batches.append(ready)
        ts.done(*ready)
    waiting = set(lockset)
    for batch in batches:
        for i in batch:
            if preds[i] & waiting:
                waiting.add(i)
    runnable = [[i for i in b if i not in waiting] for b in batches]
    # Critical path over the full graph, with minutes as weights (default 1).
    dist, prev = {}, {}
    for batch in batches:
        for i in batch:
            w = float(byid[i].get("minutes", 1) or 1)
            best = max(preds[i], key=lambda p: dist[p], default=None)
            dist[i] = w + (dist[best] if best else 0)
            prev[i] = best
    end = max(dist, key=dist.get)
    path = [end]
    while prev[path[-1]]:
        path.append(prev[path[-1]])
    return {
        "batches": batches,
        "runnable_now": [b for b in runnable if b],
        "locked": sorted(lockset),
        "waiting_on_locked": sorted(waiting - lockset),
        "critical_path": list(reversed(path)),
        "critical_minutes": dist[end],
        "parallelism": max(len(b) for b in batches),
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description="Parallel batches of a workflow DAG")
    ap.add_argument("plan")
    ap.add_argument("--root", default=".")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    try:
        r = schedule(json.loads(read(a.root, a.plan)))
    except (HybridError, ValueError) as e:
        print(f"dag_scheduler: {e}", file=sys.stderr)
        return 2
    if a.json:
        print(json.dumps(r, indent=2))
    else:
        for n, b in enumerate(r["batches"], 1):
            print(f"phase {n}: " + ", ".join(i + (" [locked]" if i in r["locked"] else " [waits]" if i in r["waiting_on_locked"] else "") for i in b))
        print(f"critical path {' -> '.join(r['critical_path'])} ({r['critical_minutes']:g} min); up to {r['parallelism']} at once")
    return 0


if __name__ == "__main__":
    sys.exit(main())
