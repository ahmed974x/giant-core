"""Release readiness (ADR-169): the same answers as jarvis/server/lib/release-gate.mjs, standard library only.

Three deterministic checks over facts this repository already holds:
  audit    the skill tree's states (replica-skill-tree: proved, tested, rules, reference, attention) and the decision
           records and security reviews in the project-search corpus. Ready when no skill needs attention.
  regress  two snapshots of the checks' counts that the person gives, baseline and candidate. A count that should grow
           (tests passed, mutants killed) must not fall; a failure count must be 0. Each check and the release get one
           verdict: regression, progress or steady.
  bundle   the skills a change touched and an optional model, through impact analysis (replica-impact-analysis): each
           skill's blast radius, the pages and test commands joined, the model's licence and memory verdict, and an LCS
           diff of the release notes; a SHA-256 chain binds the sections. Publishing stays a locked approval.
The checks belong to the engines called here; this file adds no second guard for them. It reads the snapshots it is
given, sends nothing and starts no process.

    python3 release_gate.py '{"mode": "audit"}' --data jarvis/app/data
"""
import argparse
import hashlib
import json
import math
import os
import re
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_SKILLS = os.path.dirname(_HERE)
sys.path[:0] = [_HERE] + [os.path.join(_SKILLS, d) for d in ("replica-skill-tree", "replica-impact-analysis", "replica-prompt-metacodes")]
from impact_analysis import IA_PAGES, impact_analysis, load_context  # noqa: E402
from prompt_metacodes import js_json  # noqa: E402
from skill_tree import build_tree  # noqa: E402

RG_MODES = ["audit", "regress", "bundle"]
RG_GROWTH = ["server_passed", "app_passed", "live_passed", "mutants_killed"]
RG_FAILURE = ["server_failed", "app_failed", "live_failed", "mutants_survived", "skillspector_critical", "skillspector_high", "contrast_failing", "purity_violations"]


class ReleaseError(ValueError):
    def __init__(self, message, detail=None):
        super().__init__(message)
        self.status = 400
        self.detail = None if detail is None else str(detail)[:80]


def _fail(message, detail=None):
    raise ReleaseError(message, detail)


def _sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _r4(v):
    x = math.floor(v * 10000 + 0.5) / 10000
    return int(x) if x.is_integer() else x


def adr_gaps(ids):
    """The decision-record numbers (at most four digits) missing between the first and the last one."""
    nums = sorted({int(m.group(1)) for m in (re.search(r"ADR-([0-9]{1,4})", i) for i in ids) if m})
    if not nums:
        return {"first": None, "last": None, "missing": []}
    have = set(nums)
    return {"first": nums[0], "last": nums[-1], "missing": [n for n in range(nums[0], nums[-1] + 1) if n not in have]}


def audit_repo(ctx):
    t = build_tree(ctx.get("tree"))
    s, total = t["counts"]["status"], t["counts"]["skills"]
    corpus = ctx.get("corpus")
    raw = corpus.get("docs") if isinstance(corpus, dict) else None
    docs = [d for d in raw if isinstance(d, dict) and isinstance(d.get("id"), str)] if isinstance(raw, list) else []
    adrs = [d["id"] for d in docs if d.get("kind") == "adr"]
    reviews = [d["id"] for d in docs if d.get("kind") == "review"]

    def share(n):
        return _r4(n / total) if total else 0
    return {"mode": "audit", "skills": total, "status": s, "shares": {"proved": share(s["proved"]), "tested": share(s["tested"]), "proved_or_tested": share(s["proved"] + s["tested"])},
            "records": {"adrs": len(adrs), "reviews": len(reviews), **adr_gaps(adrs)},
            "verdict": "attention" if s["attention"] > 0 else "ready" if total else "empty", "sent": False}


def _snapshot(x, name):
    if not isinstance(x, dict):
        _fail("Send the " + name + " snapshot as an object.", name)

    def get(k):
        v = x.get(k)
        if isinstance(v, bool) or not (isinstance(v, int) or (isinstance(v, float) and v.is_integer())) or not 0 <= v <= 1e9:
            _fail("Each count is a whole number from 0 to 1000000000.", name + "." + k)
        return int(v)
    return get


def regress_gate(r):
    """A count that should grow regresses when it falls; a failure count regresses when it is above 0 and is progress
    when it falls to 0 from above."""
    base, cand = _snapshot(r.get("baseline"), "baseline"), _snapshot(r.get("candidate"), "candidate")
    checks = []
    for k in RG_GROWTH:
        b, c = base(k), cand(k)
        checks.append({"check": k, "kind": "growth", "baseline": b, "candidate": c, "delta": c - b, "verdict": "regression" if c < b else "progress" if c > b else "steady"})
    for k in RG_FAILURE:
        b, c = base(k), cand(k)
        checks.append({"check": k, "kind": "failure", "baseline": b, "candidate": c, "delta": c - b, "verdict": "regression" if c > 0 else "progress" if b > 0 else "steady"})

    def n(v):
        return sum(1 for x in checks if x["verdict"] == v)
    return {"mode": "regress", "checks": checks, "counts": {"regression": n("regression"), "progress": n("progress"), "steady": n("steady")},
            "verdict": "reject_regression" if n("regression") else "proven_progress" if n("progress") else "steady", "sent": False}


def release_bundle(r, ctx):
    raw = r.get("skills")
    if not isinstance(raw, list) or not 1 <= len(raw) <= 12:
        _fail("Choose 1 to 12 skills.", "skills")
    skills = []
    for s in raw:
        if s not in skills:
            skills.append(s)
    blasts = [impact_analysis({"mode": "blast", "skill": s}, ctx) for s in skills]
    parts = [{"skill": b["skill"], "layers": b["upstream"]["layers"], "cycle": b["upstream"]["cycle"], "dependents": [d["name"] for d in b["dependents"]], "pages": [p["route"] for p in b["pages"]]} for b in blasts]
    pages = [p["route"] for p in IA_PAGES if any(p["route"] in q["pages"] for q in parts)]
    tests, shared = [], []
    for b in blasts:
        for c in [t["command"] for t in b["tests"] if t["command"]]:
            if c not in tests:
                tests.append(c)
        for c in b["shared_tests"]:
            if c not in shared:
                shared.append(c)
    model = None
    if "model" in r:
        model = impact_analysis({"mode": "catalog", "model": r["model"], "use": r.get("use"), **{k: r[k] for k in ("bits", "memory_gb", "context_tokens", "batch_size", "kv_bits") if k in r}}, ctx)
    notes = None
    if "notes" in r:
        given = r["notes"] if isinstance(r["notes"], dict) else {}
        notes = impact_analysis({"mode": "diff", "a": given.get("a"), "b": given.get("b")}, ctx)
    steps = [{"action": "publish", "target": "release", "gate": "approval", "locked": True, "status": "pending_approval"}] + (model["steps"] if model else [])
    chain = "0" * 64
    for section in (parts, pages, tests, shared, model, notes and notes["chain_sha256"], steps):
        chain = _sha(chain + _sha(js_json(section)))
    return {"mode": "bundle", "skills": parts, "pages": pages, "tests": tests, "shared_tests": shared, "model": model, "notes": notes, "steps": steps, "chain_sha256": chain, "sent": False}


def release_gate(req, ctx=None):
    r = req if isinstance(req, dict) else _fail("Send an object with a mode.", "")
    c = ctx if isinstance(ctx, dict) else {}
    if r.get("mode") == "audit":
        return audit_repo(c)
    if r.get("mode") == "regress":
        return regress_gate(r)
    if r.get("mode") == "bundle":
        return release_bundle(r, c)
    return _fail("The mode is audit, regress or bundle.", "mode")


def main(argv=None):
    p = argparse.ArgumentParser(description="Release readiness (ADR-169).")
    p.add_argument("request")
    p.add_argument("--data", default="jarvis/app/data")
    a = p.parse_args(argv)
    try:
        raw = sys.stdin.read() if a.request == "-" else a.request
        print(json.dumps(release_gate(json.loads(raw), load_context(a.data)), ensure_ascii=False))
        return 0
    except (ValueError, OSError) as e:
        print(json.dumps({"error": str(e), "detail": getattr(e, "detail", None)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
