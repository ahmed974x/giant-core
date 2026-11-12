"""The universal agent (ADR-159): the same engine as jarvis/server/lib/universal-agent.mjs, standard library only.

It plans and checks; it never calls a model. Modes: catalog, request, route, relay, compress, security, graph,
lean and design (see SKILL.md). Sending anything to a model is a locked step: a hosted endpoint is locked by
ADR-141 and a local gateway is an install nobody has approved. For the same request this file and the server
return the same JSON.

    python3 universal_agent.py '{"mode":"request","model":"claude-fable-5-2","temperature":0.2}'
    python3 universal_agent.py - < request.json
"""
import json
import math
import os
import re
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_SKILLS = os.path.dirname(_HERE)
sys.path[:0] = [_HERE, os.path.join(_SKILLS, "replica-formal-verify"), os.path.join(_SKILLS, "replica-reversal-engine")]
from reversal_engine import reverse_and_correct_template  # noqa: E402
from state_prover import plan_machine, prove  # noqa: E402

UA_READ = "2026-11-12"
UA_SOURCE = "claude-api skill, model table cached 2026-11-03"
UA_LIMITS = {"candidates": 40, "edges": 2000, "units": 400, "text": 200000, "items": 50, "css": 100000}
UA_EFFORT = ["low", "medium", "high", "xhigh", "max"]
UA_CLAUDE = [{"id": i, "name": n, "kind": "claude", "access": a, "context": 1000000, "max_output": 128000, "price_per_mtok": {"input": pi, "output": po},
              "default_effort": e, "forced_tool_choice": "rejected" if nf else "allowed", "source": UA_SOURCE, "read": UA_READ}
             for i, n, a, pi, po, e, nf in [
                 ("claude-fable-5-2", "Claude Fable 5.2", "general", 8, 40, "high", True),
                 ("claude-mythos-5-2", "Claude Mythos 5.2", "verified organisations only", 8, 40, "high", True),
                 ("claude-opus-5-5", "Claude Opus 5.5", "general", 4, 20, "medium", True),
                 ("claude-sonnet-5-5", "Claude Sonnet 5.5", "general", 2, 10, "high", True),
                 ("claude-haiku-5-5", "Claude Haiku 5.5", "general", 0.1, 0.5, "medium", False)]]
UA_UNVERIFIED = [{"id": i, "kind": "hosted" if ("/" in i or i.startswith("gemini")) else "open-weights", "source": None, "read": None, "note": "تعذر التحقق منها"}
                 for i in ["openrouter/free", "nvidia/nemotron-3-ultra:free", "nvidia/nemotron-3.5-lightning:free", "nvidia/nemotron-3.5-super-vl:free",
                           "google/gemma-4-31b:free", "google/gemma-4-26b-a4b:free", "groq/gpt-oss-120b", "groq/gpt-oss-20b", "gemini-3.8-flash",
                           "mistral/codestral-latest", "deepseek-v4.1-flash", "deepseek-v4-pro", "kimi-k3.1-pro", "glm-5.3-flash", "glm-5.2", "qwen3.8-27b",
                           "qwen3-coder-next"]]
# The 13 projects named in the request, reviewed read-only on 2026-11-12; nothing was installed or run.
UA_REVIEWED = [{"repo": repo, "licence": lic, "licence_file": "https://raw.githubusercontent.com/" + repo + "/HEAD/" + f, "install": inst,
                "verdict": v, "adopted": a, "installed": False, "read": UA_READ}
               for repo, lic, f, inst, v, a in [
    ("browser-use/browser-use", "MIT", "LICENSE", "pip install / uv tool install; needs a model API key", "not-installed", None),
    ("rohitg00/agentmemory", "Apache-2.0", "LICENSE", "npx -y …@latest; a daemon on ports 3111 and 3113 with hooks", "not-installed", None),
    ("K-Dense-AI/scientific-agent-skills", "MIT", "LICENSE.md", "npx skills add (a large skill pack)", "not-installed", None),
    ("mukul975/Anthropic-Cybersecurity-Skills", "Apache-2.0", "LICENSE", "npx skills add (a large skill pack)", "not-installed", None),
    ("ai-boost/awesome-harness-engineering", "CC0-1.0", "LICENSE", "a list; nothing to install", "reference", None),
    ("volcengine/OpenViking", "AGPL-3.0", "LICENSE", "uv tool install, or a downloaded script piped into a shell; runs a server", "not-installed", None),
    ("nextlevelbuilder/ui-ux-pro-max-skill", "MIT", "LICENSE", "/plugin install, or npm install -g", "rules-adopted", "UI checklists beside DESIGN.md (ADR-143)"),
    ("DietrichGebert/ponytail", "MIT", "LICENSE", "/plugin install, with hooks", "rules-adopted", "the six-rung lean ladder (lean mode)"),
    ("cloudflare/security-audit-skill", "MIT", "LICENSE", "npx skills add; zero-dependency .cjs validators", "rules-adopted", "the verdicts and six phases (security mode)"),
    ("obra/superpowers", "MIT", "LICENSE", "/plugin install, with hooks and optional telemetry", "rules-adopted", "tests first and small task splits (ADR-143)"),
    ("Graphify-Labs/graphify", "Apache-2.0", "LICENSE", "uv tool install", "rules-adopted", "EXTRACTED and INFERRED edges, weakest-hop confidence (graph mode)"),
    ("Jakeschincariol/replica-skill", "MIT", "LICENSE", "/plugin install", "rules-adopted", "skills vendored after review in ADR-132 to ADR-134"),
    ("cheaper-inference/OmniRoute", "MIT", "LICENSE", "npm install -g; a postinstall script and a daemon on port 20128", "not-installed", None)]]
UA_WEIGHTS = {"health": 0.25, "quota": 0.2, "zero_cost": 0.2, "speed": 0.15, "fit": 0.1, "stability": 0.1}
UA_BREAKER = 0.2
UA_LADDER = ["does it need to exist", "is it already in this codebase", "does the standard library do it", "does the platform do it natively",
             "does an installed dependency do it", "write it, with tests"]
UA_MODES = ["catalog", "request", "route", "relay", "compress", "security", "graph", "lean", "design"]
_MISSING = object()
_LOOPBACK = re.compile(r"https?://(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?(/|$)", re.I | re.A)


class AgentError(ValueError):
    def __init__(self, message, detail=None):
        super().__init__(message)
        self.status = 400
        self.detail = None if detail is None else str(detail)[:80]


def _fail(message, detail=None):
    raise AgentError(message, detail)


def ua_r(v, d=4):
    """Math.round(v * 10^d) / 10^d as JavaScript computes it, whole numbers as int."""
    p = 10 ** d
    x = math.floor(v * p + 0.5) / p
    return int(x) if x.is_integer() else x


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _is_int(v):
    return _num(v) and float(v).is_integer()


def _len16(s):
    return len(s.encode("utf-16-le", "surrogatepass")) // 2


def _unit(v, name):
    if _num(v) and 0 <= v <= 1:
        return v
    return _fail("A score is a number from 0 to 1.", name)


def _list(v, name, mx):
    if isinstance(v, list) and len(v) <= mx:
        return v
    return _fail("Give a list of at most " + str(mx) + ".", name)


def _text(v, name, mx):
    if isinstance(v, str) and _len16(v) <= mx:
        return v
    return _fail("Give text of at most " + str(mx) + " characters.", name)


def is_loopback(url):
    return bool(_LOOPBACK.match(str(url)))


def _get(r, k):
    return r[k] if isinstance(r, dict) and k in r else _MISSING


def catalog():
    return {"claude": UA_CLAUDE, "unverified": UA_UNVERIFIED, "reviewed": UA_REVIEWED, "source": UA_SOURCE, "read": UA_READ}


def build_request(req):
    r = req if isinstance(req, dict) else {}
    model = next((m for m in UA_CLAUDE if m["id"] == r.get("model")), None)
    if model is None:
        _fail("Choose one of the Claude models in the catalog.", r.get("model") if isinstance(r.get("model"), str) else "")
    eff = _get(r, "effort")
    if eff is _MISSING:
        effort = model["default_effort"]
    elif isinstance(eff, str) and eff in UA_EFFORT:
        effort = eff
    else:
        effort = _fail("Effort is low, medium, high, xhigh or max.", "effort")
    mt = _get(r, "max_tokens")
    if mt is _MISSING:
        max_tokens = 16000
    elif _is_int(mt) and 1 <= mt <= model["max_output"]:
        max_tokens = int(mt)
    else:
        max_tokens = _fail("max_tokens is a whole number from 1 to 128000.", "max_tokens")
    dropped = [k for k in ("temperature", "top_p", "top_k", "thinking") if k in r]
    tc = r.get("tool_choice") if isinstance(r.get("tool_choice"), dict) else None
    forced = bool(tc) and tc.get("type") in ("any", "tool") and model["forced_tool_choice"] == "rejected"
    if forced:
        dropped.append("tool_choice")
    msgs = _get(r, "messages")
    body = {"model": model["id"], "max_tokens": max_tokens, "output_config": {"effort": effort}, "messages": _list([] if msgs is _MISSING else msgs, "messages", UA_LIMITS["items"])}
    if tc is not None and not forced:
        body["tool_choice"] = tc
    gw = _get(r, "gateway")
    via = "anthropic" if gw is _MISSING else _text(gw, "gateway", 200)
    steps = [{"kind": "tool", "title": "Build the request body", "category": None}]
    if via != "anthropic" and is_loopback(via):
        steps.append({"kind": "approval", "title": "Install the local gateway after a security review", "category": "install", "gate": "approval", "locked": True, "status": "pending_approval"})
    steps.append({"kind": "approval", "title": "Send to the hosted Claude API (locked by ADR-141)" if via == "anthropic" else "Send through " + via + " to a hosted model",
                  "category": "outbound", "gate": "approval", "locked": True, "status": "pending_approval"})
    plan = [{**s, "depends": [i - 1] if i else []} for i, s in enumerate(steps)]
    return {"model": model["id"], "body": body, "dropped": dropped, "stream": max_tokens > 16000, "plan": plan, "proof": prove(plan_machine(plan)), "sent": False}


def score_candidate(c):
    zero = 1 if (_num(c.get("cost")) and c.get("cost") == 0) else 0
    w = UA_WEIGHTS
    return ua_r(w["health"] * c["health"] + w["quota"] * c["quota"] + w["zero_cost"] * zero + w["speed"] * c["speed"] + w["fit"] * c["fit"] + w["stability"] * c["stability"])


def route(req):
    cs = _list(req.get("candidates") if isinstance(req, dict) else None, "candidates", UA_LIMITS["candidates"])
    if not cs:
        _fail("Give at least one candidate.", "candidates")
    rows, seen = [], set()
    for i, c in enumerate(cs):
        if not isinstance(c, dict) or not isinstance(c.get("id"), str) or not c["id"]:
            _fail("Each candidate needs an id.", "candidates[" + str(i) + "]")
        if c["id"] in seen:
            _fail("Each candidate id appears once.", c["id"])
        seen.add(c["id"])
        for k in ("health", "quota", "speed", "fit", "stability"):
            _unit(c.get(k), c["id"] + "." + k)
        cost = _get(c, "cost")
        if cost is not None and not (_num(cost) and cost >= 0):
            _fail("cost is a price in USD per million tokens, or null when unknown.", c["id"] + ".cost")
        known = "checked" if any(m["id"] == c["id"] for m in UA_CLAUDE) else "unverified" if any(m["id"] == c["id"] for m in UA_UNVERIFIED) else "not in catalog"
        rows.append({"id": c["id"], "score": score_candidate(c), "open": c["health"] >= UA_BREAKER, "catalog": known, "local": c.get("local") is True})
    order = sorted((x for x in rows if x["open"]), key=lambda x: (-x["score"], x["id"]))
    send = "none"
    if order:
        send = "local: 127.0.0.1 only" if order[0]["local"] else "locked: a hosted model waits for Director 00 (ADR-141)"
    return {"weights": UA_WEIGHTS, "breaker": UA_BREAKER, "ranked": order, "tripped": [x["id"] for x in rows if not x["open"]], "chosen": order[0]["id"] if order else None,
            "send": send, "tag": "[INFERENCE]"}


def relay(req):
    r = req if isinstance(req, dict) else {}
    goal = _text(r.get("goal"), "goal", 2000)

    def part(k):
        v = _get(r, k)
        return [_text(x, k + "[" + str(i) + "]", 500) for i, x in enumerate(_list([] if v is _MISSING else v, k, UA_LIMITS["items"]))]
    done, nxt, decisions, files = part("done"), part("next"), part("decisions"), part("files")
    lines = ["Goal: " + goal, "Done (" + str(len(done)) + "):", *["- " + x for x in done], "Next (" + str(len(nxt)) + "):",
             *[str(i + 1) + ". " + x for i, x in enumerate(nxt)], "Decisions (" + str(len(decisions)) + "):", *["- " + x for x in decisions],
             "Files (" + str(len(files)) + "):", *["- " + x for x in files],
             "Rules: AGENTS.md §1 locks stay locked; no invented numbers; run the checks before calling anything done."]
    return {"summary": "\n".join(lines), "counts": {"done": len(done), "next": len(nxt), "decisions": len(decisions), "files": len(files)}, "first_step": nxt[0] if nxt else None}


def compress(req):
    t = _text(req.get("text") if isinstance(req, dict) else None, "text", UA_LIMITS["text"])
    seen, out = set(), []
    blank = dupes = 0
    for raw in t.split("\n"):
        line = re.sub(r"[ \t]+\Z", "", raw)
        if not line:
            blank += 1
            if blank <= 1:
                out.append("")
            continue
        blank = 0
        if line in seen:
            dupes += 1
            continue
        seen.add(line)
        out.append(line)
    result = "\n".join(out)
    n0, n1 = _len16(t), _len16(result)
    return {"text": result, "before_chars": n0, "after_chars": n1, "saved_percent": ua_r(100 * (n0 - n1) / n0, 1) if n0 else 0, "repeated_lines_removed": dupes,
            "unit": "characters, not tokens"}


def triage_one(c):
    if c.get("disproved") is True:
        return {"id": c["id"], "verdict": "rejected", "reason": "an independent verifier disproved it", "severity": None}
    v = c.get("verifier")
    if not isinstance(v, str) or not v or v == c.get("finder"):
        return {"id": c["id"], "verdict": "needs_validation", "reason": "needs a verifier that is not its finder", "severity": None}
    if c.get("prevented_upstream") is True:
        return {"id": c["id"], "verdict": "hardening_note", "reason": "an earlier layer already prevents it", "severity": None}
    if c.get("boundary_failure") is not True or c.get("source_trace") is not True:
        u = c.get("unresolved")
        return {"id": c["id"], "verdict": "needs_validation", "reason": u if isinstance(u, str) and u else "the boundary failure is not established", "severity": None}
    risk = ua_r(c["likelihood"] * c["impact"])
    if risk <= 0:
        return {"id": c["id"], "verdict": "needs_validation", "reason": "no impact shown", "severity": None}
    return {"id": c["id"], "verdict": "confirmed", "reason": "complete source trace and a shown impact", "risk": risk,
            "severity": "high" if risk >= 0.6 else "medium" if risk >= 0.3 else "low"}


def security(req):
    cs = _list(req.get("candidates") if isinstance(req, dict) else None, "candidates", UA_LIMITS["candidates"])
    rows = []
    for i, c in enumerate(cs):
        if not isinstance(c, dict) or not isinstance(c.get("id"), str) or not c["id"]:
            _fail("Each candidate needs an id.", "candidates[" + str(i) + "]")
        lk = 0 if c.get("likelihood") is None else c.get("likelihood")
        im = 0 if c.get("impact") is None else c.get("impact")
        _unit(lk, c["id"] + ".likelihood")
        _unit(im, c["id"] + ".impact")
        rows.append(triage_one({**c, "likelihood": lk, "impact": im}))

    def count(v):
        return sum(1 for x in rows if x["verdict"] == v)
    return {"phases": ["reconnaissance", "coverage-led hunting", "candidate validation", "structured output", "independent record verification", "target-neutral reporting"],
            "findings": rows, "counts": {"confirmed": count("confirmed"), "needs_validation": count("needs_validation"), "rejected": count("rejected"),
                                         "hardening_note": count("hardening_note")}}


def graph(req):
    r = req if isinstance(req, dict) else {}
    edges = []
    for i, e in enumerate(_list(r.get("edges"), "edges", UA_LIMITS["edges"])):
        if not isinstance(e, dict) or not isinstance(e.get("from"), str) or not isinstance(e.get("to"), str):
            _fail("Each edge needs from and to.", "edges[" + str(i) + "]")
        if e.get("kind") not in ("EXTRACTED", "INFERRED"):
            _fail("An edge is EXTRACTED or INFERRED.", "edges[" + str(i) + "]")
        conf = 1 if e["kind"] == "EXTRACTED" else _unit(e.get("confidence"), "edges[" + str(i) + "].confidence")
        edges.append({"from": e["from"], "to": e["to"], "kind": e["kind"], "confidence": conf})
    frm, to = _text(r.get("from"), "from", 200), _text(r.get("to"), "to", 200)
    prev, queue = {frm: None}, [frm]
    while queue and to not in prev:
        n = queue.pop(0)
        for e in edges:
            if e["from"] == n and e["to"] not in prev:
                prev[e["to"]] = e
                queue.append(e["to"])
    if to not in prev:
        return {"from": frm, "to": to, "path": None, "hops": 0, "confidence": 0, "extracted": 0, "inferred": 0}
    path = []
    e = prev[to]
    while e:
        path.insert(0, e)
        e = prev[e["from"]]
    return {"from": frm, "to": to, "path": path, "hops": len(path), "confidence": min(x["confidence"] for x in path) if path else 1,
            "extracted": sum(1 for x in path if x["kind"] == "EXTRACTED"), "inferred": sum(1 for x in path if x["kind"] == "INFERRED")}


def lean(req):
    units = []
    for i, u in enumerate(_list(req.get("units") if isinstance(req, dict) else None, "units", UA_LIMITS["units"])):
        if not isinstance(u, dict) or not isinstance(u.get("name"), str) or not u["name"]:
            _fail("Each unit needs a name.", "units[" + str(i) + "]")
        if not _is_int(u.get("lines")) or u["lines"] < 0:
            _fail("lines is a whole number.", u["name"])
        if not _is_int(u.get("rung")) or not 1 <= u["rung"] <= len(UA_LADDER):
            _fail("rung is 1 to 6, the first ladder step that holds.", u["name"])
        units.append({"name": u["name"], "lines": int(u["lines"]), "risky": u.get("risky") is True, "tested": u.get("tested") is True, "rung": int(u["rung"]),
                      "new_dependency": u.get("new_dependency") is True})
    risky = [u for u in units if u["risky"]]
    must = [{"name": u["name"], "reason": "risky logic without a test"} for u in risky if not u["tested"]]
    review = [{"name": u["name"], "reason": "a new dependency needs a security review and Director 00's approval (AGENTS.md §1)"} for u in units if u["new_dependency"]]
    return {"ladder": UA_LADDER, "units": len(units), "lines": sum(u["lines"] for u in units), "risky": len(risky),
            "risky_tested_percent": ua_r(100 * (len(risky) - len(must)) / len(risky), 1) if risky else None, "must_fix": must, "needs_review": review,
            "verified": not must and not review}


def design(req):
    css = _text(req.get("css") if isinstance(req, dict) else None, "css", UA_LIMITS["css"])
    r = reverse_and_correct_template(css)
    rules = list(dict.fromkeys(c["rule"] for c in r["corrections"]))
    return {"corrections": [{"rule": c["rule"], "selector": c.get("selector")} for c in r["corrections"]], "rules": rules, "css": r["text"], "after_sha256": r["after"],
            "verified": not r["corrections"]}


def universal_agent(req):
    mode = req.get("mode") if isinstance(req, dict) else None
    fns = {"catalog": lambda: catalog(), "request": lambda: build_request(req), "route": lambda: route(req), "relay": lambda: relay(req),
           "compress": lambda: compress(req), "security": lambda: security(req), "graph": lambda: graph(req), "lean": lambda: lean(req), "design": lambda: design(req)}
    if isinstance(mode, str) and mode in fns:
        return {"mode": mode, **fns[mode]()}
    return _fail("Choose a mode: " + ", ".join(UA_MODES) + ".", mode if isinstance(mode, str) else "")


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1:
        print('usage: universal_agent.py \'{"mode": "catalog"}\'  or  universal_agent.py - < request.json', file=sys.stderr)
        return 2
    raw = sys.stdin.read() if args[0] == "-" else args[0]
    try:
        print(json.dumps(universal_agent(json.loads(raw)), ensure_ascii=False))
        return 0
    except (AgentError, json.JSONDecodeError) as e:
        print(json.dumps({"error": str(e), "detail": getattr(e, "detail", None)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
