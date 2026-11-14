"""The skill tree (ADR-162): the same tree as jarvis/server/lib/skill-tree.mjs, standard library only.

    python3 skill_tree.py snapshot --root . --out jarvis/app/data/skill-tree-input.json   # read the repository
    python3 skill_tree.py tree jarvis/app/data/skill-tree-input.json                       # the tree as JSON
    python3 skill_tree.py compose jarvis/app/data/skill-tree-input.json replica-universal-math replica-foss-atlas

`snapshot` reads files only: the structural map (jarvis/app/data/knowledge-graph.json), the SkillSpector scan
(jarvis/app/data/skills-scan.json), the mutation log (jarvis/replica/evidence/mutation-audit.log), each skill's tests
folder and the security reviews in docs/security. It writes one JSON file. `tree` and `compose` are pure and give
the server's answers. Nothing here opens a network connection or starts a process.
"""
import argparse
import json
import math
import os
import re
import sys

ST_ROOTS = [
    {"id": "root:agents", "label": "AGENTS.md", "note": "Who decides, honesty, security and the checks before a commit", "file": "AGENTS.md"},
    {"id": "root:design", "label": "DESIGN.md", "note": "OKLCH tokens, contrast, three sizes, no gradients", "file": "DESIGN.md"},
    {"id": "root:locks", "label": "Approval locks", "note": "Money, publishing, permissions, installs and outbound calls wait for Director 00", "file": "AGENTS.md"},
    {"id": "root:prover", "label": "State prover", "note": "No deadlock and no effect without a locked approval", "adr": "ADR-145", "skill": "replica-formal-verify"},
    {"id": "root:merkle", "label": "Merkle audit", "note": "RFC 6962 log of sensitive events", "adr": "ADR-147", "skill": None},
    {"id": "root:shield", "label": "Privacy shield", "note": "Keys and personal data replaced before anything reads them", "adr": "ADR-158", "skill": "replica-foss-atlas"},
    {"id": "root:contrast", "label": "Contrast healer", "note": "WCAG 4.5 and APCA Lc 60 by OKLCH bisection", "adr": "ADR-153", "skill": "replica-reversal-engine"},
]
ST_TRUNK = [
    {"id": "trunk:workbench", "label": "Workbench", "adr": "ADR-160", "route": "#/workbench", "skill": "replica-unified-workbench",
     "joins": ["replica-foss-atlas", "replica-prompt-metacodes", "replica-universal-agent", "replica-reversal-engine", "replica-universal-math"]},
    {"id": "trunk:polymath", "label": "Polymath", "adr": "ADR-161", "route": "#/polymath", "skill": "replica-polymath-engine",
     "joins": ["replica-foss-atlas", "replica-universal-math", "replica-timeseries-math", "replica-hyper-studio", "replica-universal-agent", "replica-reversal-engine"]},
    {"id": "trunk:universal", "label": "Universal agent", "adr": "ADR-159", "route": "#/universal", "skill": "replica-universal-agent",
     "joins": ["replica-reversal-engine", "replica-formal-verify"]},
]
ST_OMEGA = ["omega-design", "omega-finance-chain", "omega-extend", "omega-apex-council", "omega-deep-research-agent", "omega-knowledge-domain", "apple-liquid-glass-hig",
            "osint-bgp-cables", "quant-microstructure-gex", "synaptic-spiderweb-viz", "safe-vault-cryptographic-ratchet", "neural-flow-decision-viz", "supreme-software-ui-architect",
            "cyber-space-osint-grid", "liquid-neural-139-flow", "autonomous-24-selftest-gate", "stablecoin-cyber-vuln-intel", "neural-139-inputs-heads", "local-glm-agent-windows-mcp"]
ST_FAMILIES = [{"id": "family:vendored", "label": "Vendored references", "angle": -58}, {"id": "family:jarvis", "label": "Jarvis skills", "angle": 0},
               {"id": "family:omega", "label": "OMEGA skills", "angle": 58}]
ST_ROUTES = {"replica-universal-math": "#/math", "replica-hyper-studio": "#/hyper", "replica-foss-atlas": "#/atlas", "replica-universal-agent": "#/universal",
             "replica-unified-workbench": "#/workbench", "replica-polymath-engine": "#/polymath", "replica-passive-recon": "#/recon", "replica-prompt-metacodes": "#/missions",
             "replica-reversal-engine": "#/studio", "replica-formal-verify": "#/missions", "replica-graphify": "#/governance", "replica-impeccable": "#/governance",
             "replica-timeseries-math": "#/diagnostics", "replica-design": "#/studio"}
_NAME_OK = set("abcdefghijklmnopqrstuvwxyz0123456789-")


class TreeError(ValueError):
    def __init__(self, message, detail=None):
        super().__init__(message)
        self.status = 400
        self.detail = None if detail is None else str(detail)[:80]


def _fail(message, detail=None):
    raise TreeError(message, detail)


def st_r(v):
    """Math.round(v * 10) / 10 as JavaScript computes it, whole numbers as int."""
    x = math.floor(v * 10 + 0.5) / 10
    return int(x) if x.is_integer() else x


def _int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def family_of(name):
    return "family:jarvis" if name.startswith("replica-") else "family:omega" if name in ST_OMEGA else "family:vendored"


def status_of(s, family):
    if s["scan"]["critical"] + s["scan"]["high"] > 0:
        return "attention"
    if s.get("mutation") and s["mutation"]["killed"] == s["mutation"]["mutants"] and s.get("golden"):
        return "proved"
    if s.get("tests"):
        return "tested"
    return "reference" if family == "family:vendored" else "rules"


def _check(inp):
    if not isinstance(inp, dict):
        _fail("Send the snapshot object.", "")
    skills = inp.get("skills")
    if not (isinstance(skills, list) and len(skills) <= 200):
        _fail("skills is a list of at most 200.", "skills")
    seen = set()
    for i, s in enumerate(skills):
        name = s.get("name") if isinstance(s, dict) else None
        if not (isinstance(name, str) and 1 <= len(name) <= 64 and set(name) <= _NAME_OK and name[0] != "-"):
            _fail("Each skill needs a name of lower-case letters, digits and hyphens.", "skills[" + str(i) + "]")
        if name in seen:
            _fail("Each skill appears once.", name)
        seen.add(name)
        tools = s.get("tools")
        if not (isinstance(tools, list) and len(tools) <= 40 and all(isinstance(t, dict) and isinstance(t.get("name"), str) and _int(t.get("functions")) and t["functions"] >= 0 for t in tools)):
            _fail("tools is a list of at most 40 {name, functions}.", name)
        scan = s.get("scan")
        if not (isinstance(scan, dict) and all(_int(scan.get(k)) and scan[k] >= 0 for k in ("critical", "high", "medium", "low"))):
            _fail("scan counts critical, high, medium and low.", name)
        m = s.get("mutation", ...)
        if m is not None and not (isinstance(m, dict) and _int(m.get("killed")) and _int(m.get("mutants")) and 0 <= m["killed"] <= m["mutants"]):
            _fail("mutation is null or {killed, mutants} with killed at most mutants.", name)
    return skills


def build_tree(inp):
    skills = sorted(_check(inp), key=lambda s: s["name"])
    nodes, edges = [], []
    w, cx, ground = 1400, 700, 640
    for i, r in enumerate(ST_ROOTS):
        t = i / (len(ST_ROOTS) - 1)
        nodes.append({**r, "kind": "root", "x": st_r(120 + t * (w - 240)), "y": st_r(ground + 70 + 60 * math.sin(math.pi * t))})
        edges.append({"from": r["id"], "to": ST_TRUNK[0]["id"], "kind": "feeds"})
    for i, t in enumerate(ST_TRUNK):
        nodes.append({**t, "kind": "trunk", "x": cx, "y": ground - 40 - i * 80})
        if i:
            edges.append({"from": ST_TRUNK[i - 1]["id"], "to": t["id"], "kind": "trunk"})
    crown_x, crown_y = cx, ground - 40 - (len(ST_TRUNK) - 1) * 80
    counts = {"skills": len(skills), "tools": 0, "status": {"proved": 0, "tested": 0, "rules": 0, "reference": 0, "attention": 0}, "family": {}}
    mutation = {"killed": 0, "mutants": 0}
    for f in ST_FAMILIES:
        a = f["angle"] * math.pi / 180
        nodes.append({"id": f["id"], "kind": "family", "label": f["label"], "x": st_r(crown_x + 150 * math.sin(a)), "y": st_r(crown_y - 110 * math.cos(a))})
        edges.append({"from": ST_TRUNK[-1]["id"], "to": f["id"], "kind": "branch"})
        mine = [s for s in skills if family_of(s["name"]) == f["id"]]
        counts["family"][f["id"]] = len(mine)
        for i, s in enumerate(mine):
            spread = 0 if len(mine) == 1 else (i / (len(mine) - 1) - 0.5) * 54
            b = (f["angle"] + spread) * math.pi / 180
            radius = 250 + (i % 4) * 55
            x, y = st_r(crown_x + radius * math.sin(b)), st_r(crown_y - radius * 0.86 * math.cos(b))
            status = status_of(s, f["id"])
            counts["status"][status] += 1
            m = s.get("mutation")
            if m:
                mutation["killed"] += m["killed"]
                mutation["mutants"] += m["mutants"]
            desc = s.get("description")
            nodes.append({"id": "skill:" + s["name"], "kind": "skill", "label": s["name"], "family": f["id"], "status": status, "x": x, "y": y,
                          "description": desc[:200] if isinstance(desc, str) else "", "tools": len(s["tools"]), "scan": s["scan"], "tests": s.get("tests") is True,
                          "golden": s.get("golden") is True, "mutation": m, "review": s["review"] if isinstance(s.get("review"), str) else None, "route": ST_ROUTES.get(s["name"])})
            edges.append({"from": f["id"], "to": "skill:" + s["name"], "kind": "branch"})
            for k, t in enumerate(s["tools"]):
                c = (k + 1) * 2 * math.pi / (len(s["tools"]) + 1) + b
                nodes.append({"id": "tool:" + s["name"] + "/" + t["name"], "kind": "tool", "label": t["name"], "skill": s["name"], "functions": t["functions"],
                              "x": st_r(x + 22 * math.sin(c)), "y": st_r(y - 22 * math.cos(c))})
                edges.append({"from": "skill:" + s["name"], "to": "tool:" + s["name"] + "/" + t["name"], "kind": "leaf"})
                counts["tools"] += 1
    return {"nodes": nodes, "edges": edges, "counts": counts, "mutation": mutation, "view": {"width": w, "height": 860, "ground": ground}}


def compose_skills(inp, names):
    tree = build_tree(inp)
    if not (isinstance(names, list) and 1 <= len(names) <= 12):
        _fail("Choose 1 to 12 skills.", "names")
    by_name = {n["label"]: n for n in tree["nodes"] if n["kind"] == "skill"}
    chosen, seen = [], set()
    for n in names:
        if isinstance(n, str) and n in seen:
            continue
        if not (isinstance(n, str) and n in by_name):
            _fail("That skill is not in the tree.", n if isinstance(n, str) else "")
        seen.add(n)
        chosen.append(by_name[n])
    steps = []
    for n in chosen:
        vendored = n["family"] == "family:vendored"
        steps.append({"skill": n["label"], "status": n["status"], "path": [n["id"], n["family"], *[t["id"] for t in reversed(ST_TRUNK)], "root:locks"],
                      "command": None if vendored else "python3 -m unittest discover -s .claude/skills/" + n["label"] + "/tests" if n["tests"] else None,
                      "note": "Reference only: its scripts are not run on Ahmad's machine without a review." if vendored else None if n["tests"] else "Text rules only: read its SKILL.md."})
    labels = [n["label"] for n in chosen]
    joined = [{"id": t["id"], "label": t["label"], "route": t["route"]} for t in ST_TRUNK if all(x in t["joins"] or t["skill"] == x for x in labels)]
    return {"chosen": labels, "steps": steps, "joined_by": joined, "attention": [n["label"] for n in chosen if n["status"] == "attention"],
            "ready": all(n["status"] in ("proved", "tested") for n in chosen)}


def skill_tree(req):
    if not isinstance(req, dict):
        _fail("Send an object.", "")
    if req.get("mode") == "compose":
        return {"mode": "compose", **compose_skills(req.get("input"), req.get("names"))}
    if req.get("mode") == "tree":
        return {"mode": "tree", **build_tree(req.get("input"))}
    return _fail("Choose a mode: tree or compose.", req.get("mode") if isinstance(req.get("mode"), str) else "")


def snapshot(root):
    """Read the repository's own files into the tree's input. Files only; nothing is fetched or run."""
    def load(rel):
        with open(os.path.join(root, rel), encoding="utf-8") as fh:
            return json.load(fh)
    graph, scan, mut = load("jarvis/app/data/knowledge-graph.json"), load("jarvis/app/data/skills-scan.json"), load("jarvis/replica/evidence/mutation-audit.log")
    reviews = []
    sec = os.path.join(root, "docs", "security")
    for name in sorted(os.listdir(sec)):
        if name.endswith(".md"):
            with open(os.path.join(sec, name), encoding="utf-8") as fh:
                reviews.append(("docs/security/" + name, fh.read()))
    skills = []
    for n in sorted((x for x in graph["nodes"] if x["kind"] == "skill"), key=lambda x: x["label"]):
        name, pre = n["label"], ".claude/skills/" + n["label"] + "/"
        tools = [{"name": t["label"], "functions": len(t.get("functions", []))} for t in sorted((t for t in graph["nodes"] if t["kind"] == "tool" and t["id"].startswith("tool:" + name + "/")),
                                                                                                 key=lambda t: t["label"])]
        counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
        for f in scan["findings"]:
            if f["file"].startswith(pre) and f["sev"] in counts:
                counts[f["sev"]] += 1
        targets = [t for t in mut["targets"] if t["file"].startswith(pre)]
        tests_dir = os.path.join(root, ".claude", "skills", name, "tests")
        golden = os.path.isdir(tests_dir) and any(x.startswith("golden") and x.endswith(".json") for x in os.listdir(tests_dir))
        pattern = re.compile(r"(?<![\w-])" + re.escape(name) + r"(?![\w-])")
        review = next((p for p, text in reviews if pattern.search(text)), None)
        skills.append({"name": name, "description": (n.get("description") or "")[:200], "tools": tools, "scan": counts, "tests": os.path.isdir(tests_dir), "golden": golden,
                       "mutation": {"killed": sum(t["killed"] for t in targets), "mutants": sum(t["mutants"] - t["equivalent"] for t in targets)} if targets else None,
                       "review": review})
    return {"format": "jarvis-skill-tree-input-v1", "skills": skills}


def main(argv=None):
    p = argparse.ArgumentParser(description="The skill tree (ADR-162).")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("snapshot")
    s.add_argument("--root", default=".")
    s.add_argument("--out", required=True)
    t = sub.add_parser("tree")
    t.add_argument("input")
    c = sub.add_parser("compose")
    c.add_argument("input")
    c.add_argument("names", nargs="+")
    a = p.parse_args(argv)
    try:
        if a.cmd == "snapshot":
            snap = snapshot(a.root)
            with open(a.out, "w", encoding="utf-8") as fh:
                fh.write(json.dumps(snap, ensure_ascii=False, indent=1) + "\n")
            print(f"skill_tree: wrote {a.out} · {len(snap['skills'])} skills")
            return 0
        with open(a.input, encoding="utf-8") as fh:
            inp = json.load(fh)
        out = build_tree(inp) if a.cmd == "tree" else compose_skills(inp, a.names)
        print(json.dumps(out, ensure_ascii=False))
        return 0
    except TreeError as e:
        print(json.dumps({"error": str(e), "detail": e.detail}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
