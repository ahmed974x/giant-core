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
  export   ADR-172: the bundle as one document to copy: Kahn's layers of the chosen skills (replica-plan-order), the
           pages, the test commands, the model's licence verdict, terms, weights and context memory, the locked steps
           and the chain hash, as key-sorted JSON (two-space indent) and as Markdown, with the SHA-256 of each text.
           Writing the file to disk or sending it anywhere stays a locked approval.
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
sys.path[:0] = [_HERE] + [os.path.join(_SKILLS, d) for d in ("replica-skill-tree", "replica-impact-analysis", "replica-plan-order", "replica-prompt-metacodes")]
from impact_analysis import IA_PAGES, impact_analysis, load_context  # noqa: E402
from plan_order import skill_order  # noqa: E402
from prompt_metacodes import js_json  # noqa: E402
from skill_tree import build_tree  # noqa: E402

RG_MODES = ["audit", "regress", "bundle", "export"]
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
    """SHA-256 of the text as TextEncoder encodes it: a lone surrogate becomes U+FFFD."""
    return hashlib.sha256(re.sub(r"[\ud800-\udfff]", "\ufffd", text).encode("utf-8")).hexdigest()


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


def skill_provision(name, facts, routes):
    """ADR-173: what one skill has, from the skill-tree snapshot and the pages that run it; a missing part is named
    by the file or field that is missing. Nothing is guessed, installed or run."""
    f = facts.get(name)
    route = routes.get(name)
    missing = []
    if not f:
        missing.append("SKILL.md")
    if not (f and f.get("tests")):
        missing.append("tests/")
    if not (f and f.get("golden")):
        missing.append("tests/golden.json")
    if route is None:
        missing.append("page route")
    if f and f.get("scan") and f["scan"]["critical"] + f["scan"]["high"] > 0:
        missing.append("SkillSpector clean scan")
    return {"skill": name, "status": "incomplete" if missing else "provisioned", "missing": missing, "route": route,
            "test_command": "python3 -m unittest discover -s .claude/skills/" + name + "/tests" if f and f.get("tests") else None}


def skill_provision_report(names, tree):
    """The chosen skills, or every skill in the snapshot by name."""
    lst = tree["skills"] if isinstance(tree, dict) and isinstance(tree.get("skills"), list) else []
    facts = {s["name"]: s for s in lst}
    routes = {p["skill"]: p["route"] for p in IA_PAGES}
    skills = [skill_provision(n, facts, routes) for n in (names if names is not None else sorted(s["name"] for s in lst))]
    return {"skills": skills, "counts": {"provisioned": sum(1 for s in skills if s["status"] == "provisioned"), "incomplete": sum(1 for s in skills if s["status"] == "incomplete")}}


def canonical(v):
    """The exported document with keys sorted at every level, so the same facts always give the same text."""
    if isinstance(v, list):
        return [canonical(x) for x in v]
    if not isinstance(v, dict):
        return v
    return {k: canonical(v[k]) for k in sorted(v)}


def model_section(m):
    """The model's part of the document: what impact analysis said, nothing added."""
    if not m:
        return None
    f = m["family"]
    return {"model": m["model"], "use": m["use"], "found": m["found"], "verdict": m["verdict"], "note": m["note"],
            "family": f and {"family": f["family"], "licence": f["licence"], "card": f["card"], "read": f["read"], "terms": f["terms"]}, "memory": m["memory"], "context": m["context"], "offload": m["offload"]}


def _model_lines(m):
    f = m["family"]
    lines = ["## Model", "- Name: " + m["model"] + " (" + m["use"] + ")", "- Family: " + (f["family"] + ", card " + f["card"] + ", read " + f["read"] if f else "not in the catalog"), "- Licence verdict: " + m["verdict"]]
    if f:
        lines.append("- Licence: " + f["licence"])
    if f and f["terms"]:
        t = f["terms"]
        lines.append("- Terms: " + t["requirement"] + ", " + ("at any revenue" if t["when"] == "always" else "above US$" + js_json(t["revenue_usd_12m"]) + " over 12 months") + ", file SHA-256 " + t["sha256"])
    if m["memory"]:
        w = m["memory"]
        lines.append("- Weights: " + ("not estimated (" + w["basis"] + ")" if w["weights_gb"] is None else js_json(w["weights_gb"]) + " GB at " + js_json(w["bits"]) + " bits"))
    if m["context"]:
        c = m["context"]
        lines += ["- Context memory: " + ("not estimated (" + c["basis"] + (": " + ", ".join(c["blocking"]) if c["blocking"] else "") + ")" if c["kv_gb"] is None else js_json(c["kv_gb"]) + " GB for " + js_json(c["tokens"]) + " tokens (" + c["attention"] + ")"),
                  "- Total: " + ("not estimated" if c["total_gb"] is None else js_json(c["total_gb"]) + " GB"),
                  "- Longest documented context: " + ("unknown" if c["max_context"] is None else js_json(c["max_context"]) + (" (exceeded)" if c["exceeds"] else ""))]
    if m["offload"]:
        o = m["offload"]
        where = ("this laptop, " + js_json(o["margin_gb"]) + " GB to spare of " + js_json(o["laptop_gb"]) + " GB" if o["verdict"] == "local"
                 else "a web host, " + js_json(o["shortfall_gb"]) + " GB more than the laptop's " + js_json(o["laptop_gb"]) + " GB" if o["verdict"] == "web_offload"
                 else "not decided (" + o["reason"] + ")")
        lines += ["- Where it runs: " + where, "- Licence on a site of your own: " + o["own_use"] + " while only you use it, " + o["others_use"] + " once others do"]
    return lines


def bundle_markdown(d, head):
    """The same document as Markdown, read from the key-sorted data; head is the caller's own opening sections."""
    lines = ["# " + d["title"], "", *head, "## Skills in order (Kahn's layers)"]
    for i, layer in enumerate(d["order"]["layers"]):
        lines.append("- Layer " + str(i + 1) + ": " + ", ".join(layer))
    if d["order"]["cycle"]:
        lines.append("- On a cycle, left out: " + ", ".join(d["order"]["cycle"]))
    p = d["provision"]
    lines += ["", "## Skills provisioned (" + str(p["counts"]["provisioned"]) + " of " + str(len(p["skills"])) + ")"]
    lines += ["- " + s["skill"] + ": " + ("missing " + ", ".join(s["missing"]) if s["missing"] else "provisioned") for s in p["skills"]]
    lines += ["", "## Pages to test again"] + (["- " + p for p in d["pages"]] if d["pages"] else ["- none"]) + ["", "## Test commands", "", "```bash"] + d["tests"] + ["```", ""]
    if d["model"]:
        lines += [*_model_lines(d["model"]), ""]
    lines += ["## Locked steps"] + ["- " + s["action"] + " " + s["target"] + ": waiting for approval" for s in d["steps"]] + ["", "## Release chain", "- SHA-256: " + d["release_chain_sha256"]]
    return "\n".join(lines) + "\n"


def _pretty(data):
    """JSON.stringify(data, null, 2): two-space indent, raw non-ASCII, lone surrogates escaped."""
    text = json.dumps(data, ensure_ascii=False, indent=2)
    return re.sub(r"[\ud800-\udfff]", lambda m: f"\\u{ord(m.group(0)):04x}", text)


def export_bundle(doc, head=()):
    """The document as text to copy, in two forms, each with its SHA-256."""
    data = canonical(doc)
    text = _pretty(data) + "\n"
    markdown = bundle_markdown(data, head)
    return {"format": "aether-prime-bundle-v1", "json": text, "markdown": markdown, "bundle_sha256": _sha(text), "markdown_sha256": _sha(markdown)}


def release_document(r, ctx):
    """The release part of an export, shared with the architect studio."""
    b = release_bundle(r, ctx)
    order = skill_order(ctx.get("deps"), [p["skill"] for p in b["skills"]])
    steps = b["steps"] + [{"action": "write", "target": "bundle file", "gate": "approval", "locked": True, "status": "pending_approval"}]
    doc = {"title": "Aether Prime release bundle", "order": {"layers": order["layers"], "cycle": order["cycle"]},
           "provision": skill_provision_report([p["skill"] for p in b["skills"]], ctx.get("tree")), "pages": b["pages"], "tests": b["tests"] + b["shared_tests"],
           "model": model_section(b["model"]), "steps": steps, "release_chain_sha256": b["chain_sha256"]}
    return b, doc


def release_export(r, ctx):
    b, doc = release_document(r, ctx)
    return {"mode": "export", "export": export_bundle(doc), "steps": doc["steps"], "chain_sha256": b["chain_sha256"], "sent": False}


def release_gate(req, ctx=None):
    r = req if isinstance(req, dict) else _fail("Send an object with a mode.", "")
    c = ctx if isinstance(ctx, dict) else {}
    if r.get("mode") == "audit":
        return audit_repo(c)
    if r.get("mode") == "regress":
        return regress_gate(r)
    if r.get("mode") == "bundle":
        return release_bundle(r, c)
    if r.get("mode") == "export":
        return release_export(r, c)
    return _fail("The mode is audit, regress, bundle or export.", "mode")


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
