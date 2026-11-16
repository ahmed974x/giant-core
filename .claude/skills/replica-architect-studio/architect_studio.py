"""The architect studio (ADR-170): the same answers as jarvis/server/lib/architect-studio.mjs, standard library only.

Four deterministic tools over the reviewed skills:
  seal     a domain-separated SHA-256 of the architect's code, NFC-normalised:
           SHA-256("aether-prime:architect-seal:v1:" + code), compared with the seal the caller holds (the server's
           JARVIS_ARCHITECT_SEAL or the file page's saved one), never with one in the request. Only five characters are
           shown; with no seal set up, the full hash is returned once so it can be saved. The code is never stored.
  ui       the preview scale: 90 to 120 percent with a 12 px floor, spacing on the 4/8 scale with concentric radii,
           tabular or proportional numerals in the preview only. Colours do not change. Needs the seal.
  compose  a composite skill draft from plan order (replica-plan-order) and the release bundle (replica-release-gate);
           writing it to disk stays a locked approval. Needs the seal.
  radar    the skills still in "text rules" or "tested", most depended on first, and the catalog families whose
           documented licence allows serving them to others.
The engines called here keep their own checks. It reads the snapshots it is given, sends nothing and starts no process.

    python3 architect_studio.py '{"mode": "radar"}' --data jarvis/app/data
"""
import argparse
import hashlib
import json
import math
import os
import re
import sys
import unicodedata

_HERE = os.path.dirname(os.path.abspath(__file__))
_SKILLS = os.path.dirname(_HERE)
sys.path[:0] = [_HERE] + [os.path.join(_SKILLS, d) for d in ("replica-plan-order", "replica-skill-tree", "replica-impact-analysis", "replica-release-gate", "replica-prompt-metacodes")]
from impact_analysis import dependents_of, licence_rule, load_context  # noqa: E402
from plan_order import skill_order  # noqa: E402
from prompt_metacodes import js_json  # noqa: E402
from release_gate import _pretty, canonical, export_bundle, release_document, release_gate, skill_provision_report  # noqa: E402
from release_gate import _sha as _sha_text  # noqa: E402
from skill_tree import build_tree  # noqa: E402

AS_MODES = ["seal", "ui", "compose", "radar", "export", "campaign", "provision"]
AS_RECEIPT_DOMAIN = "aether-prime:approval-receipt:v1:"
AS_SEAL_DOMAIN = "aether-prime:architect-seal:v1:"
AS_DENSITY = {"compact": 4, "balanced": 8, "spacious": 12}
AS_NUMERALS = {"tabular": "tabular-nums slashed-zero", "proportional": "proportional-nums slashed-zero"}
AS_TYPE = {"body": 15, "headline": 17, "footnote": 13, "caption": 12}
AS_LOCKS = ["install", "outbound", "model", "publish"]


class ArchitectError(ValueError):
    def __init__(self, message, detail=None, status=400):
        super().__init__(message)
        self.status = status
        self.detail = None if detail is None else str(detail)[:80]


def _fail(message, detail=None, status=400):
    raise ArchitectError(message, detail, status)


def _sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _len16(s):
    return len(s.encode("utf-16-le", "surrogatepass")) // 2


def _r2(v):
    x = math.floor(v * 100 + 0.5) / 100
    return int(x) if x.is_integer() else x


def _well_formed(s):
    try:
        s.encode("utf-8")
        return True
    except UnicodeEncodeError:
        return False


def seal_hash(code):
    return _sha(AS_SEAL_DOMAIN + unicodedata.normalize("NFC", code))


def check_seal(r, expected):
    """The seal's state. The expected seal comes from the server or this browser, never from the request."""
    code = r.get("passcode", "")
    if "passcode" in r and not (isinstance(code, str) and _len16(code) <= 200 and _well_formed(code)):
        _fail("The architect code is well-formed text of at most 200 characters.", "passcode")
    configured = isinstance(expected, str) and re.fullmatch(r"[0-9a-f]{64}", expected) is not None
    h = seal_hash(code) if code else None
    unlocked = configured and h == expected
    return {"configured": configured, "unlocked": unlocked, "state": "not_configured" if not configured else "unlocked" if unlocked else "locked",
            "audit_prefix": h and h[:5], "hash": h}


def _locks():
    return [{"action": a, "gate": "approval", "locked": True, "status": "pending_approval"} for a in AS_LOCKS]


def ui_tokens(r):
    scale = r.get("font_scale")
    if isinstance(scale, bool) or not (isinstance(scale, int) or (isinstance(scale, float) and scale.is_integer())) or not 90 <= scale <= 120:
        _fail("The font scale is a whole number from 90 to 120.", "font_scale")
    scale = int(scale)
    density, numerals = r.get("density"), r.get("numerals")
    if not isinstance(density, str) or density not in AS_DENSITY:
        _fail("The density is compact, balanced or spacious.", "density")
    if not isinstance(numerals, str) or numerals not in AS_NUMERALS:
        _fail("The numerals are tabular or proportional.", "numerals")
    unit = AS_DENSITY[density]
    px = {k: max(12, _r2(v * scale / 100)) for k, v in AS_TYPE.items()}
    pad, inner = unit * 2, 12
    css = {"--as-body": f"{px['body']}px", "--as-headline": f"{px['headline']}px", "--as-footnote": f"{px['footnote']}px", "--as-caption": f"{px['caption']}px",
           "--as-gap": f"{unit}px", "--as-pad": f"{pad}px", "--as-radius-inner": f"{inner}px", "--as-radius-outer": f"{inner + pad}px", "--as-numerals": AS_NUMERALS[numerals]}
    return {"font_scale": scale, "density": density, "numerals": numerals, "px": px, "css": css, "colours_changed": False, "config_sha256": _sha(js_json(css))}


def skill_draft(name, description, order, bundle):
    """A composite skill's SKILL.md draft, from the facts the engines gave."""
    lines = ["---", "name: " + name, "description: " + description, "---", "", "# " + name, "",
             "A composite of " + str(len(order["chosen"])) + " skills, drafted by the architect studio (ADR-170). Review it before it is written anywhere.", "",
             "## Skills in order (Kahn's layers)"]
    for i, layer in enumerate(order["layers"]):
        lines.append("- Layer " + str(i + 1) + ": " + ", ".join(layer))
    if order["cycle"]:
        lines += ["", "## On a cycle, left out of the order", "- " + ", ".join(order["cycle"])]
    lines += ["", "## Tests to run", "", "```bash", *bundle["tests"], *bundle["shared_tests"], "```", "", "## Pages it touches"]
    lines += ["- " + p for p in bundle["pages"]] if bundle["pages"] else ["- none"]
    if bundle["model"]:
        m = bundle["model"]
        lines += ["", "## Model", "- " + (m["family"]["family"] if m["family"] else m["model"]) + ": " + m["verdict"]]
    return "\n".join(lines) + "\n"


def compose_skill(r, ctx):
    name = r.get("name")
    if not isinstance(name, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,47}", name):
        _fail("The name is 2 to 48 lower-case letters, digits and hyphens.", "name")
    desc = r.get("description")
    if not isinstance(desc, str) or not desc.strip() or _len16(desc) > 300 or re.search(r"[\r\n]", desc):
        _fail("The description is one line of 1 to 300 characters.", "description")
    skills = r.get("skills")
    if not isinstance(skills, list) or len(skills) < 2:
        _fail("A composite joins 2 or more skills.", "skills")
    bundle = release_gate({"mode": "bundle", "skills": skills, **{k: r[k] for k in ("model", "use", "bits", "memory_gb", "context_tokens", "batch_size", "kv_bits", "notes") if k in r}}, ctx)
    order = skill_order(ctx.get("deps"), skills)
    draft = skill_draft(name, desc.strip(), order, bundle)
    return {"name": name, "order": {"layers": order["layers"], "added": order["added"], "cycle": order["cycle"], "verified": order["verified"]}, "bundle": bundle,
            "draft": draft, "draft_sha256": _sha(draft),
            "steps": [{"action": "install", "target": ".claude/skills/" + name + "/SKILL.md", "gate": "approval", "locked": True, "status": "pending_approval"}, *bundle["steps"]]}


def upgrade_radar(ctx):
    """Skills still in "text rules" or "tested", most depended on first, then by name."""
    t = build_tree(ctx.get("tree"))
    deps = ctx.get("deps") if isinstance(ctx.get("deps"), dict) else {}
    skills = [{"skill": n["label"], "status": n["status"], "downstream": len(dependents_of(deps, n["label"])), "next": "golden_and_mutation" if n["status"] == "tested" else "tests"}
              for n in t["nodes"] if n["kind"] == "skill" and n["status"] in ("rules", "tested")]
    skills.sort(key=lambda s: (-s["downstream"], s["skill"]))
    catalog = ctx.get("catalog") if isinstance(ctx.get("catalog"), list) else []
    models = sorted(f["family"] for f in catalog if licence_rule(f["licence"], "service", f.get("terms"))["verdict"] in ("allowed", "allowed_note"))
    return {"skills": skills, "counts": {"rules": sum(1 for s in skills if s["status"] == "rules"), "tested": sum(1 for s in skills if s["status"] == "tested")}, "models_for_service": models}


def export_head(seal, ui):
    """ADR-172: the export's opening Markdown sections: the seal's state and, when it was checked, the preview scale."""
    lines = ["## Architect seal", "- State: " + seal["state"], "- Audit prefix: " + (seal["audit_prefix"] if seal["audit_prefix"] is not None else "none"), ""]
    if ui:
        lines += ["## Preview scale", "- Font scale: " + js_json(ui["font_scale"]) + " percent", "- Density: " + ui["density"], "- Numerals: " + ui["numerals"], "- Settings SHA-256: " + ui["config_sha256"], ""]
    return lines


def architect_export(r, ctx, s):
    """ADR-172: the release export with the seal's state and audit prefix and, while the seal is open and a scale is
    sent, the checked preview scale. No seal is needed to export; writing the file stays a locked approval."""
    ui = ui_tokens(r) if s["unlocked"] and "font_scale" in r else None
    bundle, doc = release_document(r, ctx)
    seal = {"state": s["state"], "audit_prefix": s["audit_prefix"]}
    scale = ui and {"font_scale": ui["font_scale"], "density": ui["density"], "numerals": ui["numerals"], "px": ui["px"], "config_sha256": ui["config_sha256"]}
    ex = export_bundle({**doc, "title": "Aether Prime architect bundle", "seal": seal, "ui": scale}, export_head(seal, scale))
    return {**ex, "release_chain_sha256": bundle["chain_sha256"], "steps": doc["steps"]}


def campaign_checkpoints(layers, tree, shared):
    """ADR-172: one checkpoint per Kahn layer and one for the release, each hash chained to the one before."""
    facts = {x.get("name"): x for x in tree["skills"]} if isinstance(tree, dict) and isinstance(tree.get("skills"), list) else {}
    cps = [{"id": "cp-" + str(i + 1), "layer": i + 1, "skills": layer, "verify": ["python3 -m unittest discover -s .claude/skills/" + n + "/tests" for n in layer if (facts.get(n) or {}).get("tests")]}
           for i, layer in enumerate(layers)]
    cps.append({"id": "cp-release", "layer": None, "skills": [], "verify": shared})
    prev = "0" * 64
    out = []
    for cp in cps:
        prev = _sha(prev + js_json(cp))
        out.append({**cp, "checkpoint_sha256": prev})
    return out


def step_hash(campaign, step):
    """A locked step's hash names the campaign, the action and the target."""
    return _sha(campaign + ":" + step["action"] + ":" + step["target"])


def receipt_hash(seal, step):
    """A receipt binds a step's hash to the seal that signed it."""
    return _sha(AS_RECEIPT_DOMAIN + seal + ":" + step)


def campaign_input(r):
    done = r.get("done", [])
    if "done" in r and not (isinstance(done, list) and len(done) <= 64 and all(isinstance(x, str) for x in done)):
        _fail("Done is a list of up to 64 checkpoint names.", "done")
    failed = r.get("failed", {})
    if "failed" in r and not (isinstance(failed, dict) and len(failed) <= 64):
        _fail("Failed maps up to 64 checkpoint names to the reason.", "failed")
    for k, v in failed.items():
        if not isinstance(v, str) or not v.strip() or _len16(v) > 200 or re.search(r"[\r\n]", v):
            _fail("Each reason is one line of 1 to 200 characters.", "failed." + k)
    approved = r.get("approved", [])
    if "approved" in r and not (isinstance(approved, list) and len(approved) <= 32 and all(isinstance(x, str) and re.fullmatch(r"[0-9a-f]{64}", x) for x in approved)):
        _fail("Approved is a list of up to 32 step hashes.", "approved")
    return done, failed, approved


def campaign_plan(r, ctx, s):
    """ADR-172: a long task as checkpoints, where to resume, and the architect's receipts for locked steps. A receipt
    records the decision and runs nothing: the step stays locked and pending approval."""
    done, failed, approved = campaign_input(r)
    if approved and not s["unlocked"]:
        _fail("The architect seal is needed: the studio is read only.", "seal", 403)
    bundle, doc = release_document(r, ctx)
    plan = campaign_checkpoints(doc["order"]["layers"], ctx.get("tree"), bundle["shared_tests"])
    for cid in done + list(failed):
        if not any(cp["id"] == cid for cp in plan):
            _fail("That checkpoint is not in this campaign.", cid)
    campaign = plan[-1]["checkpoint_sha256"]
    steps = []
    for st in doc["steps"]:
        h = step_hash(campaign, st)
        steps.append({**st, "step_sha256": h, "receipt": {"audit_prefix": s["audit_prefix"], "receipt_sha256": receipt_hash(s["hash"], h)} if h in approved else None})
    signed = all(st["receipt"] for st in steps)
    checkpoints = []
    for cp in plan:
        if cp["id"] in failed:
            status = "needs_fix"
        elif cp["layer"] is None:
            status = "receipted" if signed else "awaiting_approval"
        else:
            status = "done" if cp["id"] in done else "pending"
        checkpoints.append({**cp, "status": status, "reason": failed[cp["id"]] if status == "needs_fix" else None, "fix": cp["verify"] if status == "needs_fix" else []})
    first = next((cp for cp in checkpoints if cp["status"] not in ("done", "receipted")), None)
    counts = {k: sum(1 for cp in checkpoints if cp["status"] == k) for k in ("done", "pending", "needs_fix", "awaiting_approval", "receipted")}
    seal = {"state": s["state"], "audit_prefix": s["audit_prefix"]}
    head = [*export_head(seal, None), "## Checkpoints",
            *["- " + cp["id"] + " (" + cp["status"] + "): " + (", ".join(cp["skills"]) if cp["skills"] else "release") + ("; " + cp["reason"] if cp["reason"] else "") for cp in checkpoints],
            "- Resume from: " + (first["id"] if first else "nothing left"),
            "- Receipts: " + str(sum(1 for st in steps if st["receipt"])) + " of " + str(len(steps)) + " locked steps; a receipt runs nothing", ""]
    ex = export_bundle({**doc, "title": "Aether Prime campaign", "seal": seal, "campaign": {"campaign_sha256": campaign, "checkpoints": checkpoints, "resume": first["id"] if first else None}, "steps": steps}, head)
    return {"campaign_sha256": campaign, "checkpoints": checkpoints, "resume": first["id"] if first else None, "counts": counts, "steps": steps,
            "unmatched": sum(1 for h in approved if not any(st["step_sha256"] == h for st in steps)), "export": ex}


def provision_plan(r, ctx, s):
    """ADR-173: whether each skill (the chosen ones, or every one in the snapshot) is provisioned, as a document to
    copy with the seal's state. Nothing is installed; installing or changing a skill stays a locked approval."""
    names = None
    if "skills" in r:
        sk = r["skills"]
        if not (isinstance(sk, list) and 1 <= len(sk) <= 64 and all(isinstance(x, str) and _len16(x) <= 80 for x in sk)):
            _fail("Choose 1 to 64 skills, or none for every skill.", "skills")
        names = list(dict.fromkeys(sk))
    report = skill_provision_report(names, ctx.get("tree"))
    steps = [{"action": "install", "target": ".claude/skills", "gate": "approval", "locked": True, "status": "pending_approval"}]
    data = canonical({"title": "Aether Prime skill provisioning", "seal": {"state": s["state"], "audit_prefix": s["audit_prefix"]}, "provision": report, "steps": steps})
    p = data["provision"]
    lines = ["# " + data["title"], "", *export_head(data["seal"], None), "## Skills (" + str(p["counts"]["provisioned"]) + " of " + str(len(p["skills"])) + " provisioned)",
             *["- " + x["skill"] + ": " + ("missing " + ", ".join(x["missing"]) if x["missing"] else "provisioned") + (" (" + x["route"] + ")" if x["route"] else "") for x in p["skills"]],
             "", "## Locked steps", "- install .claude/skills: waiting for approval"]
    text = _pretty(data) + "\n"
    markdown = "\n".join(lines) + "\n"
    return {**report, "steps": steps, "export": {"format": "aether-prime-bundle-v1", "json": text, "markdown": markdown, "bundle_sha256": _sha_text(text), "markdown_sha256": _sha_text(markdown)}}


def architect_studio(req, ctx=None):
    r = req if isinstance(req, dict) else _fail("Send an object with a mode.", "")
    c = ctx if isinstance(ctx, dict) else {}
    mode = r.get("mode")
    if not isinstance(mode, str) or mode not in AS_MODES:
        _fail("The mode is seal, ui, compose, radar, export, campaign or provision.", "mode")
    s = check_seal(r, c.get("seal"))
    seal = {"configured": s["configured"], "unlocked": s["unlocked"], "state": s["state"], "audit_prefix": s["audit_prefix"]}
    out = {"mode": mode, "seal": seal, "locks": _locks()}
    if mode == "seal":
        out["setup"] = None if s["configured"] or not s["hash"] else {"seal_hash": s["hash"], "note": "Save this hash as the seal; the code itself is not kept."}
    if mode in ("ui", "compose") and not s["unlocked"]:
        _fail("The architect seal is needed: the studio is read only.", "seal", 403)
    if mode == "ui":
        out["ui"] = ui_tokens(r)
    if mode == "compose":
        out["compose"] = compose_skill(r, c)
    if mode == "radar":
        out["radar"] = upgrade_radar(c)
    if mode == "export":
        out["export"] = architect_export(r, c, s)
    if mode == "campaign":
        out["campaign"] = campaign_plan(r, c, s)
    if mode == "provision":
        out["provision"] = provision_plan(r, c, s)
    comp = out.get("compose")
    sections = [seal, out.get("setup"), out.get("ui"), comp and comp["draft_sha256"], comp and comp["bundle"]["chain_sha256"], out.get("radar"), out["locks"]] + ([out["export"]["bundle_sha256"]] if "export" in out else []) + ([out["campaign"]["export"]["bundle_sha256"]] if "campaign" in out else []) + ([out["provision"]["export"]["bundle_sha256"]] if "provision" in out else [])
    chain = "0" * 64
    for x in sections:
        chain = _sha(chain + _sha(js_json(x)))
    return {**out, "chain_sha256": chain, "sent": False}


def main(argv=None):
    p = argparse.ArgumentParser(description="The architect studio (ADR-170).")
    p.add_argument("request")
    p.add_argument("--data", default="jarvis/app/data")
    p.add_argument("--seal", default=None, help="the saved seal hash (64 hex characters)")
    a = p.parse_args(argv)
    try:
        raw = sys.stdin.read() if a.request == "-" else a.request
        print(json.dumps(architect_studio(json.loads(raw), {**load_context(a.data), "seal": a.seal}), ensure_ascii=False))
        return 0
    except (ValueError, OSError) as e:
        print(json.dumps({"error": str(e), "detail": getattr(e, "detail", None)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
