#!/usr/bin/env python3
"""state_prover: breadth-first proofs over a state machine - deadlock freedom, reachability and the safety
rule that no money, publish, permissions, install or outbound effect is reached without a locked approval -
plus a check that each UI component has every state it needs.

Standard library only (json, re, collections, argparse, sys). No network, no processes. The same algorithm
as jarvis/server/lib/prover.mjs, which the Jarvis Ctrl+K macro composer runs.

    python3 state_prover.py --machine machine.json [--json]
    python3 state_prover.py --plan plan.json [--json]          # a Jarvis plan: {"steps": [...]} or [...]
    python3 state_prover.py --ui jarvis/app/src/app.css --components btn,input,select [--json]

A machine is {"initial": id, "states": [{"id", "terminal"?, "locked"?, "effect"?}], "transitions":
[{"from", "to", "event"}]}. Exit 0 when verified, 1 when a property fails, 2 for a bad input.
"""

import argparse
import json
import re
import sys
from collections import deque

SENSITIVE = ("money", "publish", "permissions", "install", "outbound")
UI_STATES = ("default", "hover", "focus-visible", "loading", "empty", "error", "locked")


def plan_machine(steps):
    states = [{"id": "start"}, {"id": "done", "terminal": True}, {"id": "stopped", "terminal": True}]
    trans = []
    after = [[] for _ in steps]
    for i, s in enumerate(steps):
        for d in s.get("depends") or []:
            if isinstance(d, int) and 0 <= d < i:
                after[d].append(i)
    for i, s in enumerate(steps):
        sid, kind, cat = f"s{i}", s.get("kind") or "tool", s.get("category")
        locked = kind == "approval" and s.get("locked") is True
        states.append({"id": sid, "step": i, "title": str(s.get("title") or "")[:160], "kind": kind, "category": cat, "locked": locked})
        if not s.get("depends"):
            trans.append({"from": "start", "to": sid, "event": "begin"})
        nxt = [f"s{j}" for j in after[i]] or ["done"]
        out = sid
        if kind == "approval" and cat in SENSITIVE:
            states.append({"id": f"e{i}", "effect": cat, "step": i})
            trans += [{"from": sid, "to": f"e{i}", "event": "approved"}, {"from": sid, "to": "stopped", "event": "rejected"}]
            out = f"e{i}"
        elif kind == "approval":
            trans.append({"from": sid, "to": "stopped", "event": "rejected"})
        elif kind == "gate":
            trans.append({"from": sid, "to": "stopped", "event": "fail"})
        for n in nxt:
            trans.append({"from": out, "to": n, "event": "approved" if kind == "approval" else "ok"})
    if not steps:
        trans.append({"from": "start", "to": "done", "event": "empty"})
    return {"initial": "start", "states": states, "transitions": trans}


def _search(m, skip):
    out = {}
    for t in m["transitions"]:
        out.setdefault(t["from"], []).append(t)
    prev = {m["initial"]: None}
    q = deque([m["initial"]])
    while q:
        s = q.popleft()
        for t in out.get(s, []):
            if t["to"] not in prev and t["to"] not in skip:
                prev[t["to"]] = t
                q.append(t["to"])
    return prev, out


def _path(prev, sid):
    p = []
    t = prev.get(sid)
    while t:
        p.insert(0, f"{t['from']} -{t['event']}-> {t['to']}")
        t = prev.get(t["from"])
    return p


def prove(m):
    by = {s["id"]: s for s in m["states"]}
    dangling = [t for t in m["transitions"] if t["from"] not in by or t["to"] not in by]
    prev, out = _search(m, set())
    deadlocks = [s for s in prev if not by.get(s, {}).get("terminal") and not out.get(s)]
    unreachable = [s["id"] for s in m["states"] if s["id"] not in prev and "step" in s]
    locked = {s["id"] for s in m["states"] if s.get("locked")}
    free, _ = _search(m, locked)
    violations = [{"state": s["id"], "effect": s["effect"], "path": _path(free, s["id"])} for s in m["states"] if s.get("effect") and s["id"] in free]
    reaches_done = "done" in prev or not any(s["id"] == "done" for s in m["states"])
    verified = not dangling and not deadlocks and not unreachable and not violations and reaches_done
    return {"verified": verified, "states": len(m["states"]), "transitions": len(m["transitions"]), "reachable": len(prev),
            "deadlocks": deadlocks, "unreachable": unreachable, "violations": violations,
            "effects": sum(1 for s in m["states"] if s.get("effect")), "lockedStates": len(locked),
            "danglingTransitions": len(dangling), "reachesDone": reaches_done}


# What shows each UI state in a selector that names the component (variants such as btn-primary count).
UI_MARKS = {
    "hover": r":hover",
    "focus-visible": r":focus-visible",
    "loading": r"\[aria-busy",
    "empty": r"(:empty|\.empty)",
    "error": r"(\[aria-invalid|\.err(?![\w-])|:invalid|:user-invalid)",
    "locked": r"(:disabled|\[disabled\]|\[aria-disabled|\.locked(?![\w-]))",
}
# Page-wide rules that give every component the state (a bare :focus-visible, an empty-state block ...).
UI_GLOBAL = {
    "focus-visible": r"^:focus-visible$|^\*:focus-visible$",
    "empty": r"^\.empty(-state)?$",
}


def _selectors(css):
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    for m in re.finditer(r"([^{}]+)\{[^{}]*\}", css):
        for sel in m.group(1).split(","):
            sel = sel.strip()
            if sel and not sel.startswith("@"):
                yield sel


def ui_completeness(css, components):
    sels = list(_selectors(css))
    rows = []
    for c in components:
        name = re.compile(r"\." + re.escape(c) + r"(-[\w-]+)?(?![\w-])")
        mine = [x for x in sels if name.search(x)]
        have = {"default": bool(mine)}
        for st, mark in UI_MARKS.items():
            have[st] = any(re.search(mark, x) for x in mine) or (st in UI_GLOBAL and any(re.search(UI_GLOBAL[st], x) for x in sels))
        rows.append({"component": c, "states": have, "missing": [x for x in UI_STATES if not have[x]]})
    return {"components": rows, "complete": all(not r["missing"] for r in rows), "required": list(UI_STATES)}


def _load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--machine")
    g.add_argument("--plan")
    g.add_argument("--ui")
    ap.add_argument("--components", default="btn,input,select,textarea")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    try:
        if a.ui:
            with open(a.ui, encoding="utf-8") as fh:
                rep = ui_completeness(fh.read(), [c.strip() for c in a.components.split(",") if c.strip()])
            ok = rep["complete"]
        else:
            if a.machine:
                m = _load(a.machine)
            else:
                p = _load(a.plan)
                m = plan_machine(p.get("steps", []) if isinstance(p, dict) else p)
            if not isinstance(m, dict) or "initial" not in m or not isinstance(m.get("states"), list) or not isinstance(m.get("transitions"), list):
                raise ValueError("a machine needs initial, states and transitions")
            rep = prove(m)
            ok = rep["verified"]
    except (OSError, ValueError, KeyError, TypeError) as e:
        print("state_prover: " + str(e), file=sys.stderr)
        return 2
    if a.json:
        print(json.dumps(rep, ensure_ascii=False, indent=1))
    elif a.ui:
        for r in rep["components"]:
            print(f"{r['component']:<12} " + ("complete" if not r["missing"] else "missing: " + ", ".join(r["missing"])))
    else:
        print("Formal proof: " + ("verified" if ok else "FAILED"))
        print(f"  {rep['states']} states, {rep['transitions']} transitions, {rep['reachable']} reachable")
        print(f"  deadlocks: {len(rep['deadlocks'])} · unreachable steps: {len(rep['unreachable'])} · effects behind a locked approval: {rep['effects'] - len(rep['violations'])} of {rep['effects']}")
        for v in rep["violations"]:
            print(f"  VIOLATION {v['effect']} at {v['state']}: " + " | ".join(v["path"]))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
