"""The runbook (ADR-165): the same answers as jarvis/server/lib/runbook.mjs, standard library only.

One goal and the skills it needs, through engines that already exist, in order: the privacy shield
(replica-foss-atlas), project search (replica-project-search), Kahn's order of the skills, the workbench read as
a behaviour tree and UCB1 over the three meta-code plans (replica-plan-order), and one fixed probe per page
through the engine behind it (#/diagnostics reads the running server, so it is listed as server only). A chain
hash binds the stages in order. It reads the snapshots it is given, sends nothing and starts no process.

    python3 runbook.py '{"goal": "Heal the contrast", "skills": ["replica-polymath-engine"]}' --data jarvis/app/data
"""
import argparse
import hashlib
import json
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_SKILLS = os.path.dirname(_HERE)
sys.path[:0] = [_HERE] + [os.path.join(_SKILLS, d) for d in ("replica-foss-atlas", "replica-project-search", "replica-plan-order", "replica-unified-workbench",
                                                            "replica-polymath-engine", "replica-skill-tree", "replica-universal-agent", "replica-universal-math",
                                                            "replica-hyper-studio", "replica-prompt-metacodes", "replica-formal-verify", "replica-reversal-engine",
                                                            "replica-timeseries-math")]
from foss_atlas import k_anonymity, plan_foss_stack, scrub_private  # noqa: E402
from hyper_studio import optics  # noqa: E402
from plan_order import plan_order, skill_order, workbench_tree  # noqa: E402
from polymath_engine import run_polymath  # noqa: E402
from project_search import search_project  # noqa: E402
from prompt_metacodes import js_json  # noqa: E402
from skill_tree import build_tree  # noqa: E402
from unified_workbench import run_workbench  # noqa: E402
from universal_agent import universal_agent  # noqa: E402
from universal_math import solve  # noqa: E402

RB_STAGES = ["shield", "docs", "order", "tree", "plan", "routes"]
RB_ROUTES = [
    {"route": "#/docs", "adr": "ADR-164", "engine": "project-search"},
    {"route": "#/order", "adr": "ADR-163", "engine": "plan-order"},
    {"route": "#/tree", "adr": "ADR-162", "engine": "skill-tree"},
    {"route": "#/polymath", "adr": "ADR-161", "engine": "polymath-engine"},
    {"route": "#/workbench", "adr": "ADR-160", "engine": "unified-workbench"},
    {"route": "#/universal", "adr": "ADR-159", "engine": "universal-agent"},
    {"route": "#/atlas", "adr": "ADR-158", "engine": "foss-atlas"},
    {"route": "#/math", "adr": "ADR-154", "engine": "universal-math"},
    {"route": "#/hyper", "adr": "ADR-155", "engine": "hyper-studio"},
    {"route": "#/diagnostics", "adr": "ADR-148", "engine": "readiness"},
]
_MISSING = object()


class RunbookError(ValueError):
    def __init__(self, message, detail=None):
        super().__init__(message)
        self.status = 400
        self.detail = None if detail is None else str(detail)[:80]


def _fail(message, detail=None):
    raise RunbookError(message, detail)


def _len16(s):
    return len(s.encode("utf-16-le")) // 2


def _stage(sid, fn):
    """An engine's refusal is this stage's error; the other stages still run."""
    try:
        return {"id": sid, "status": "ok", "summary": fn()}
    except ValueError as e:
        return {"id": sid, "status": "error", "summary": {"error": str(e), "detail": getattr(e, "detail", None)}}


def _probe(route, ctx):
    """One fixed probe per page: whether the engine gave its checked answer, and the engine's whole answer."""
    if route == "#/docs":
        s = search_project(ctx["corpus"], {"query": "contrast healer", "limit": 3})
        return s["found"], s
    if route == "#/order":
        k = sorted(ctx["deps"])
        if not k:
            return False, k
        o = skill_order(ctx["deps"], [k[0]])
        return o["verified"], o
    if route == "#/tree":
        t = build_tree(ctx["tree"])
        return t["counts"]["skills"] > 0, t
    if route == "#/polymath":
        p = run_polymath({"question": "Solve the equation", "math": {"task": "calculus", "expression": "x^2-4"}})
        return not p["grounding"]["abstained"], p
    if route == "#/workbench":
        w = run_workbench({"task": "Check the plan"})
        return w["verified"], w
    if route == "#/universal":
        u = universal_agent({"mode": "catalog"})
        return len(u["claude"]) > 0, u
    if route == "#/atlas":
        a = plan_foss_stack({"selectedIds": ["libreoffice"]})
        return a["verified"], a
    if route == "#/math":
        m = solve({"task": "calculus", "expression": "x^2-4", "interval": [-5, 5]})
        return m["verified"], m
    o = optics({"focal_mm": 50, "f_stop": 2.8, "subject_distance_m": 3})
    return o["verified"], o


def probe_routes(ctx):
    out = []
    for p in RB_ROUTES:
        if p["route"] == "#/diagnostics":
            out.append({**p, "status": "server_only", "value": None})
            continue
        try:
            ok, answer = _probe(p["route"], ctx)
            out.append({**p, "status": "ok" if ok else "failed", "value": hashlib.sha256(js_json(answer).encode("utf-8")).hexdigest()[:12]})
        except ValueError:
            out.append({**p, "status": "error", "value": None})
    return out


def runbook(req, ctx=None):
    r = req if isinstance(req, dict) else _fail("Send an object with a goal.", "")
    goal = r.get("goal")
    if not isinstance(goal, str) or not goal.strip() or _len16(goal) > 2000:
        _fail("The goal is text of 1 to 2000 characters.", "goal")
    c = ctx if isinstance(ctx, dict) else {}
    snap = {"corpus": c.get("corpus") if c.get("corpus") is not None else {"docs": []}, "deps": c.get("deps") if c.get("deps") is not None else {},
            "tree": c.get("tree") if c.get("tree") is not None else {"skills": []}}
    lang = "ar" if r.get("lang") == "ar" else "en"
    shield = scrub_private(goal)
    clean = shield["text"]
    secret = r.get("secretCheck", _MISSING)
    # The workbench takes any goal the shield returns, so this stage cannot be refused.
    w = workbench_tree(run_workbench({"task": clean, "lang": lang}))

    def docs():
        s = search_project(snap["corpus"], {"query": clean, "limit": 5})
        return {"found": s["found"], "counts": s["counts"], "top": [{"id": x["id"], "kind": x["kind"], "title": x["title"], "score": x["score"], "ranks": x["ranks"],
                                                                      "snippet": x["snippet"]} for x in s["results"]]}

    def order():
        k = skill_order(snap["deps"], r.get("skills"))
        return {"chosen": k["chosen"], "added": k["added"], "layers": k["layers"], "cycle": k["cycle"], "verified": k["verified"]}

    def plan():
        q = {"mode": "plans", "prompt": clean, "lang": lang}
        for key in ("record", "c"):
            if key in r:
                q[key] = r[key]
        p = plan_order(q)
        return {"chosen": p["chosen"], "reason": p["reason"], "ranked": p["ranked"], "tag": p["tag"]}

    def routes():
        rt = probe_routes(snap)
        return {"routes": rt, "ok": sum(1 for x in rt if x["status"] == "ok"), "server_only": sum(1 for x in rt if x["status"] == "server_only")}

    stages = [{"id": "shield", "status": "ok", "summary": {"replaced": shield["total"], "rules": [x["rule"] for x in shield["redactions"]],
                                                         "secret_prefix": None if secret is _MISSING else k_anonymity(secret)["prefix"], "looked_up": False}},
              _stage("docs", docs), _stage("order", order),
              {"id": "tree", "status": "ok", "summary": {"status": w["status"], "stopped_at": w["stopped_at"], "waiting": w["waiting"], "leaves": w["ticked"]}}, _stage("plan", plan), _stage("routes", routes)]
    chain = "0" * 64
    for s in stages:
        chain = hashlib.sha256((chain + js_json([s["id"], s["status"], s["summary"]])).encode("utf-8")).hexdigest()
    return {"lang": lang, "goal": clean, "stages": stages, "locked": w["waiting"], "ready": all(s["status"] == "ok" for s in stages), "chain_sha256": chain, "sent": False}


def load_context(data_dir):
    """The three snapshots the page and the server read, from jarvis/app/data. Files only."""
    def load(name):
        with open(os.path.join(data_dir, name), encoding="utf-8") as fh:
            return json.load(fh)
    return {"corpus": load("search-corpus.json"), "deps": load("skill-deps.json")["skills"], "tree": load("skill-tree-input.json")}


def main(argv=None):
    p = argparse.ArgumentParser(description="The runbook (ADR-165).")
    p.add_argument("request")
    p.add_argument("--data", default="jarvis/app/data")
    a = p.parse_args(argv)
    try:
        raw = sys.stdin.read() if a.request == "-" else a.request
        print(json.dumps(runbook(json.loads(raw), load_context(a.data)), ensure_ascii=False))
        return 0
    except (ValueError, OSError) as e:
        print(json.dumps({"error": str(e), "detail": getattr(e, "detail", None)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
