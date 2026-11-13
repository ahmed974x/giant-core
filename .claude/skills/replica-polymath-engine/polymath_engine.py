"""The polymath engine (ADR-161): the same five stages as jarvis/server/lib/polymath-engine.mjs, standard library only.

One question across the repository's own engines: the privacy shield cleans it, fixed word rules [INFERENCE] and
the person's choice name the domains (math, timeseries, optics, design, security), each domain runs its reviewed
engine when its input is given, every named domain lists how it fails and which gate closes it, a weighted
decision matrix uses only the person's numbers, every claim must name a domain that ran (otherwise it is not
grounded, and with no domain run the answer abstains), and an RFC 6962 Merkle root binds the records.
It sends nothing, starts no process and opens no network connection. For the same request it returns the server's JSON.

    python3 polymath_engine.py '{"question":"Solve the equation","math":{"task":"calculus","expression":"x^2-2"}}'
    python3 polymath_engine.py - < request.json
"""
import hashlib
import json
import math
import os
import re
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_SKILLS = os.path.dirname(_HERE)
sys.path[:0] = [_HERE] + [os.path.join(_SKILLS, d) for d in ("replica-universal-agent", "replica-prompt-metacodes", "replica-universal-math", "replica-foss-atlas",
                                                            "replica-hyper-studio", "replica-timeseries-math", "replica-formal-verify", "replica-reversal-engine")]
from foss_atlas import AtlasError, plan_foss_stack, scrub_private  # noqa: E402
from hyper_studio import HyperError, optics  # noqa: E402
from prompt_metacodes import js_json  # noqa: E402
from ts_math import ewma_push, stdev, welford, welford_push, zscore  # noqa: E402
from universal_agent import AgentError, universal_agent  # noqa: E402
from universal_math import MathError, solve  # noqa: E402

PM_DOMAINS = ["math", "timeseries", "optics", "design", "security"]
PM_SOURCES = {
    "math": {"adr": "ADR-154", "engine": "universal-math solve", "route": "#/math"},
    "timeseries": {"adr": "ADR-147", "engine": "timeseries analyse", "route": "#/diagnostics"},
    "optics": {"adr": "ADR-155", "engine": "hyper-studio optics", "route": "#/hyper"},
    "design": {"adr": "ADR-150", "engine": "reversal engine and contrast healer", "route": "#/studio"},
    "security": {"adr": "ADR-159", "engine": "security verdicts and FOSS atlas", "route": "#/universal"},
}
_F = re.I | re.A
PM_WORDS = {
    "math": re.compile(r"\b(equation|integral|derivative|root|matrix|prime|solve|calculus|bayes)\b|معادلة|تكامل|مشتقة|مصفوفة", _F),
    "timeseries": re.compile(r"\b(series|telemetry|welford|ewma|vpin|variance|anomal\w*|latency)\b|سلسلة زمنية|قياس", _F),
    "optics": re.compile(r"\b(lens|optics|focal|aperture|depth of field|camera|exposure)\b|عدسة|بصريات|كاميرا", _F),
    "design": re.compile(r"\b(css|colou?r|contrast|gradient|layout|design)\b|تصميم|تباين|لون", _F),
    "security": re.compile(r"\b(secret|key|token|vulnerab\w*|attack|install|audit|privacy|security)\b|أمن|ثغرة|سر|خصوصية", _F),
}
PM_INVERSION = {
    "math": [["A root is reported where the function only changes sign at a pole.", "The solver names a pole when |f| stays large at the sign change (ADR-154)."],
             ["An answer is given without being checked.", "Every answer carries its own checks and [VERIFIED] only when all pass (ADR-154)."]],
    "timeseries": [["Variance loses precision by cancellation on long series.", "Welford's running update (ADR-147)."],
                   ["An early reading is flagged before there is a baseline.", "No z-score before 30 readings (ADR-147)."]],
    "optics": [["The subject is placed inside the focal length.", "The optics engine refuses it (ADR-155)."],
               ["Depth of field is reported without a check.", "Near and far limits are checked against the harmonic mean (ADR-155)."]],
    "design": [["A gradient or low-contrast text ships.", "The reversal engine makes one colour and the healer reaches WCAG 4.5 and APCA Lc 60 (ADR-150, ADR-153)."],
               ["A long word breaks the layout on a phone.", "overflow-wrap is added and three sizes are checked (ADR-150)."]],
    "security": [["A secret reaches a model or a log.", "The privacy shield runs first, and logs keep counts only (ADR-158)."],
                 ["A tool is installed or an outside service is called without review.", "Every install and outbound step is a locked approval (AGENTS.md section 1, ADR-141)."],
                 ["A finding is confirmed by the person who found it.", "A finding needs an independent verifier (ADR-159)."]],
}


class PolymathError(ValueError):
    def __init__(self, message, detail=None):
        super().__init__(message)
        self.status = 400
        self.detail = None if detail is None else str(detail)[:80]


def _fail(message, detail=None):
    raise PolymathError(message, detail)


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def js_round(v, d):
    """Math.round(v * 10^d) / 10^d as JavaScript computes it, whole numbers as int."""
    p = 10 ** d
    x = math.floor(v * p + 0.5) / p
    return int(x) if x.is_integer() else x


def pm_r(v):
    return js_round(v, 4)


def _len16(s):
    return len(s.encode("utf-16-le", "surrogatepass")) // 2


def _leaf(entry):
    return hashlib.sha256(b"\x00" + entry.encode("utf-8")).hexdigest()


def _node(left, right):
    return hashlib.sha256(b"\x01" + bytes.fromhex(left) + bytes.fromhex(right)).hexdigest()


def merkle_root(leaves):
    """RFC 6962 MTH over leaf hashes (hex): k is the largest power of two smaller than n."""
    if not leaves:
        return hashlib.sha256(b"").hexdigest()
    if len(leaves) == 1:
        return leaves[0]
    k = 1
    while k * 2 < len(leaves):
        k *= 2
    return _node(merkle_root(leaves[:k]), merkle_root(leaves[k:]))


def series_summary(points):
    """ADR-147's analyse and vpin, rounded as JavaScript rounds."""
    s, e, anomalies = welford(), None, 0
    for p in points:
        z = zscore(s, p["v"]) if s["n"] >= 30 else 0
        if abs(z) > 3:
            anomalies += 1
        s = welford_push(s, p["v"])
        e = ewma_push(e, p["v"], 0.1)
    buckets, up, down, last, prev = [], 0.0, 0.0, 0, None
    for x in (p["v"] for p in points):
        if prev is not None:
            side = 1 if x > prev else -1 if x < prev else last
            if side > 0:
                up += 1
            elif side < 0:
                down += 1
            else:
                up += 0.5
                down += 0.5
            last = side
            if up + down >= 50:
                buckets.append(abs(up - down) / 50)
                up = down = 0.0
        prev = x
    tail = buckets[-10:]
    return {"n": s["n"], "mean": js_round(s["mean"], 3), "sd": js_round(stdev(s), 3), "ewma": None if e is None else js_round(e, 3), "anomalies": anomalies,
            "vpin": js_round(sum(tail) / len(tail), 3) if tail else None}


def run_domain(did, value):
    if did == "math":
        m = solve(value)
        return {"task": m["task"], "checks": len(m["checks"]), "passed": sum(1 for c in m["checks"] if c["ok"]), "verified": m["verified"]}
    if did == "timeseries":
        if not (isinstance(value, list) and 2 <= len(value) <= 5000 and all(isinstance(p, dict) and _num(p.get("t")) and _num(p.get("v")) and math.isfinite(p["v"]) for p in value)):
            _fail("A series is 2 to 5000 points of numbers {t, v}.", "series")
        return series_summary(value)
    if did == "optics":
        o = optics(value if isinstance(value, dict) else {})
        dof = o["depth_of_field"]
        return {"verified": o["verified"], "hyperfocal_m": dof["hyperfocal_m"], "near_m": dof["near_m"], "far_m": dof["far_m"]}
    if did == "design":
        d = universal_agent({"mode": "design", "css": value})
        return {"rules": d["rules"], "after_sha256": d["after_sha256"], "verified": d["verified"]}
    out = {}
    if "candidates" in value:
        out["verdicts"] = universal_agent({"mode": "security", "candidates": value["candidates"]})["counts"]
    if "atlas" in value:
        a = plan_foss_stack(value["atlas"])
        out["atlas"] = {"picks": len(a["picks"]), "usd_per_year": a["savings"]["usd_per_year"] if a["savings"] else None, "verified": a["verified"]}
    return out


def decide(req):
    """The weighted decision matrix from the person's own options, scores and weights; weights are made to sum to 1."""
    if "options" not in req and "weights" not in req:
        return None
    weights = req.get("weights")
    if not isinstance(weights, dict):
        _fail("Weights are an object of criterion to a number of at least 0.", "weights")
    crit = sorted(weights)
    if not (crit and len(crit) <= 12 and all(_num(weights[c]) and weights[c] >= 0 and math.isfinite(weights[c]) for c in crit)):
        _fail("Give 1 to 12 criteria, each with a weight of at least 0.", "weights")
    total = sum(weights[c] for c in crit)
    if not total > 0:
        _fail("At least one weight must be above 0.", "weights")
    options = req.get("options")
    if not (isinstance(options, list) and 2 <= len(options) <= 12):
        _fail("Give 2 to 12 options to compare.", "options")
    names, rows = set(), []
    for i, o in enumerate(options):
        name = o.get("name") if isinstance(o, dict) else None
        if not (isinstance(name, str) and name and _len16(name) <= 80):
            _fail("Each option needs a name of 1 to 80 characters.", "options[" + str(i) + "]")
        if name in names:
            _fail("Each option name appears once.", name)
        names.add(name)
        s = o.get("scores") if isinstance(o.get("scores"), dict) else {}
        for c in crit:
            if not (_num(s.get(c)) and 0 <= s[c] <= 10):
                _fail("Each option scores every criterion from 0 to 10.", name + "." + c)
        rows.append({"name": name, "score": pm_r(sum(weights[c] * s[c] for c in crit) / total)})
    rows.sort(key=lambda x: (-x["score"], x["name"]))
    return {"criteria": crit, "weights": {c: pm_r(weights[c] / total) for c in crit}, "ranked": rows,
            "chosen": rows[0]["name"] if rows[0]["score"] > rows[1]["score"] else None, "tag": "[INFERENCE]"}


def run_polymath(req):
    if not isinstance(req, dict):
        _fail("Send an object with a question.", "")
    q = req.get("question")
    if not (isinstance(q, str) and q.strip() and _len16(q) <= 4000):
        _fail("The question is text of 1 to 4000 characters.", "question")
    asked = req.get("domains", [])
    if not (isinstance(asked, list) and all(isinstance(d, str) and d in PM_DOMAINS for d in asked)):
        _fail("Domains are " + ", ".join(PM_DOMAINS) + ".", "domains")
    shield = scrub_private(q)
    inputs = {"math": req.get("math", ...), "timeseries": req.get("series", ...), "optics": req.get("optics", ...), "design": req.get("css", ...),
              "security": {k: req[k] for k in ("candidates", "atlas") if k in req} if ("candidates" in req or "atlas" in req) else ...}
    domains = []
    for did in PM_DOMAINS:
        why = "asked" if did in asked else "words" if PM_WORDS[did].search(shield["text"]) else "input" if inputs[did] is not ... else None
        src = PM_SOURCES[did]
        if why is None:
            domains.append({"id": did, "status": "not_named", "why": None, "summary": None, "source": src})
        elif inputs[did] is ...:
            domains.append({"id": did, "status": "needs_input", "why": why, "summary": None, "source": src})
        else:
            try:
                domains.append({"id": did, "status": "ok", "why": why, "summary": run_domain(did, inputs[did]), "source": src})
            except (AgentError, AtlasError, MathError, HyperError, PolymathError) as e:
                domains.append({"id": did, "status": "error", "why": why, "summary": {"error": str(e), "detail": getattr(e, "detail", None)}, "source": src})
    inversion = [{"domain": d["id"], "failure": f, "gate": g} for d in domains if d["status"] != "not_named" for f, g in PM_INVERSION[d["id"]]]
    decision = decide(req)
    ran = {d["id"] for d in domains if d["status"] == "ok"}
    raw = req.get("claims", [])
    if not (isinstance(raw, list) and len(raw) <= 20):
        _fail("Give at most 20 claims.", "claims")
    claims = []
    for i, c in enumerate(raw):
        text = c.get("text") if isinstance(c, dict) else None
        if not (isinstance(text, str) and text and _len16(text) <= 300):
            _fail("Each claim is text of 1 to 300 characters.", "claims[" + str(i) + "]")
        by = c.get("source") if isinstance(c.get("source"), str) else None
        claims.append({"text": scrub_private(text)["text"], "source": by, "grounded": by is not None and by in ran})
    reason = None
    if not ran:
        reason = "No domain engine ran on the person's input, so nothing here can answer the question."
    elif any(not c["grounded"] for c in claims):
        reason = "Some claims name a domain that did not run."
    grounding = {"grounded": bool(ran) and all(c["grounded"] for c in claims), "abstained": not ran,
                 "unknown_citations": [c["source"] for c in claims if not c["grounded"]], "reason": reason}
    records = [["shield", shield["total"], [x["rule"] for x in shield["redactions"]]]] + [[d["id"], d["status"], d["summary"]] for d in domains]
    records += [["inversion", len(inversion)], ["decision", decision], ["grounding", grounding]]
    leaves = [_leaf(js_json(x)) for x in records]
    return {"question": shield["text"], "replaced": shield["total"], "domains": domains, "inversion": inversion, "decision": decision, "claims": claims,
            "grounding": grounding, "merkle": {"leaves": len(leaves), "root": merkle_root(leaves)}, "sent": False}


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1:
        print('usage: polymath_engine.py \'{"question": "..."}\'  or  polymath_engine.py - < request.json', file=sys.stderr)
        return 2
    raw = sys.stdin.read() if args[0] == "-" else args[0]
    try:
        print(json.dumps(run_polymath(json.loads(raw)), ensure_ascii=False))
        return 0
    except (PolymathError, json.JSONDecodeError) as e:
        print(json.dumps({"error": str(e), "detail": getattr(e, "detail", None)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
