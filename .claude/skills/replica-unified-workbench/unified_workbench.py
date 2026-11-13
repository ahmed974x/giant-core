"""The unified workbench (ADR-160): the same pipeline as jarvis/server/lib/unified-workbench.mjs, standard library only.

One deterministic run over the repository's own engines, in order: the privacy shield (replica-foss-atlas), the
prompt meta-codes (replica-prompt-metacodes), the universal agent's request and design modes
(replica-universal-agent, with the reversal engine and contrast healer), the universal maths solver
(replica-universal-math), the FOSS atlas planner and the universal agent's security verdicts. One plan joins
the stages with every install, outbound and money step locked, proved; a chain hash binds the stages in order.
It sends nothing, starts no process and opens no network connection. For the same request it returns the server's JSON.

    python3 unified_workbench.py '{"task":"Build a login page and publish it","css":".a{color:#777}"}'
    python3 unified_workbench.py - < request.json
"""
import hashlib
import json
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_SKILLS = os.path.dirname(_HERE)
sys.path[:0] = [_HERE] + [os.path.join(_SKILLS, d) for d in ("replica-universal-agent", "replica-prompt-metacodes", "replica-universal-math",
                                                            "replica-foss-atlas", "replica-formal-verify", "replica-reversal-engine")]
from foss_atlas import AtlasError, k_anonymity, plan_foss_stack, scrub_private  # noqa: E402
from prompt_metacodes import compile_metacodes, js_json  # noqa: E402
from state_prover import plan_machine, prove  # noqa: E402
from universal_agent import AgentError, universal_agent  # noqa: E402
from universal_math import MathError, solve  # noqa: E402

UW_STAGES = ["shield", "metacodes", "request", "design", "math", "atlas", "security"]
UW_LINKS = {"shield": "#/atlas", "metacodes": "#/missions", "request": "#/universal", "design": "#/studio", "math": "#/math", "atlas": "#/atlas",
            "security": "#/universal"}


class WorkbenchError(ValueError):
    def __init__(self, message, detail=None):
        super().__init__(message)
        self.status = 400
        self.detail = None if detail is None else str(detail)[:80]


def _fail(message, detail=None):
    raise WorkbenchError(message, detail)


def _sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _len16(s):
    return len(s.encode("utf-16-le", "surrogatepass")) // 2


def run_stage(sid, given, fn):
    """A stage not asked for is skipped; a refusal from its engine is an error, and the other stages still run."""
    link = UW_LINKS.get(sid)
    if not given:
        return {"id": sid, "status": "skipped", "summary": None, "link": link}
    try:
        return {"id": sid, "status": "ok", **fn(), "link": link}
    except (AgentError, AtlasError, MathError, WorkbenchError) as e:
        return {"id": sid, "status": "error", "summary": {"error": str(e), "detail": getattr(e, "detail", None)}, "link": link}


def locked_of(steps, stage):
    return [{"stage": stage, "category": s.get("category"), "title": s.get("title")} for s in steps if s.get("locked") is True]


def run_workbench(req):
    if not isinstance(req, dict):
        _fail("Send an object with a task.", "")
    task = req.get("task")
    if not (isinstance(task, str) and task.strip() and _len16(task) <= 4000):
        _fail("The task is text of 1 to 4000 characters.", "task")
    lang = "ar" if req.get("lang") == "ar" else "en"
    locked, stages, state = [], [], {"clean": task}

    def shield():
        s = scrub_private(task)
        state["clean"] = s["text"]
        secret = k_anonymity(req["secretCheck"]) if "secretCheck" in req else None
        return {"summary": {"replaced": s["total"], "rules": [x["rule"] for x in s["redactions"]], "secret_prefix": secret["prefix"] if secret else None,
                            "looked_up": False}}

    def metacodes():
        m = compile_metacodes({"prompt": state["clean"], "lang": lang, "codes": req["codes"] if isinstance(req.get("codes"), list) else []})
        locked.extend(locked_of(m["options"][0]["steps"], "metacodes"))
        return {"summary": {"codes": m["codes"], "options": len(m["options"]), "followed": m["options"][0]["id"], "verified": m["verified"], "sha256": m["sha256"]}}

    def request():
        q = {"mode": "request", "model": req.get("model") if req.get("model") is not None else "claude-opus-5-5"}
        for k in ("effort", "gateway"):
            if k in req:
                q[k] = req[k]
        q["messages"] = [{"role": "user", "content": state["clean"]}]
        out = universal_agent(q)
        locked.extend(locked_of(out["plan"], "request"))
        return {"summary": {"model": out["model"], "effort": out["body"]["output_config"]["effort"], "dropped": out["dropped"], "verified": out["proof"]["verified"],
                            "sent": False}}

    def design():
        d = universal_agent({"mode": "design", "css": req["css"]})
        return {"summary": {"rules": d["rules"], "after_sha256": d["after_sha256"], "verified": d["verified"]}}

    def math_stage():
        m = solve(req["math"] if isinstance(req["math"], dict) else {})
        return {"summary": {"task": m["task"], "checks": len(m["checks"]), "passed": sum(1 for c in m["checks"] if c["ok"]), "verified": m["verified"]}}

    def atlas():
        a = plan_foss_stack(req["atlas"])
        locked.extend(locked_of(a["steps"], "atlas"))
        return {"summary": {"picks": len(a["picks"]), "usd_per_year": a["savings"]["usd_per_year"] if a["savings"] else None, "verified": a["verified"]}}

    def security():
        return {"summary": universal_agent({"mode": "security", "candidates": req["candidates"]})["counts"]}

    stages.append(run_stage("shield", True, shield))
    stages.append(run_stage("metacodes", True, metacodes))
    stages.append(run_stage("request", True, request))
    stages.append(run_stage("design", "css" in req, design))
    stages.append(run_stage("math", "math" in req, math_stage))
    stages.append(run_stage("atlas", "atlas" in req, atlas))
    stages.append(run_stage("security", "candidates" in req, security))
    steps = [{"kind": "tool", "title": "Run " + s["id"], "category": None} for s in stages if s["status"] == "ok"]
    steps += [{"kind": "approval", "title": lk["stage"] + ": " + lk["title"], "category": lk["category"], "gate": "approval", "locked": True,
               "status": "pending_approval"} for lk in locked]
    steps = [{**s, "depends": [i - 1] if i else []} for i, s in enumerate(steps)]
    proof = prove(plan_machine(steps))
    chain = "0" * 64
    for s in stages:
        chain = _sha(chain + js_json([s["id"], s["status"], s["summary"]]))
    return {"lang": lang, "stages": stages, "plan": steps, "proof": proof, "locked": len(locked), "ran": sum(1 for s in stages if s["status"] == "ok"),
            "verified": proof["verified"] and all(s["status"] != "error" for s in stages), "chain_sha256": chain, "sent": False}


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1:
        print('usage: unified_workbench.py \'{"task": "..."}\'  or  unified_workbench.py - < request.json', file=sys.stderr)
        return 2
    raw = sys.stdin.read() if args[0] == "-" else args[0]
    try:
        print(json.dumps(run_workbench(json.loads(raw)), ensure_ascii=False))
        return 0
    except (WorkbenchError, json.JSONDecodeError) as e:
        print(json.dumps({"error": str(e), "detail": getattr(e, "detail", None)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
