"""Impact analysis (ADR-168): the same answers as jarvis/server/lib/impact-analysis.mjs, standard library only.

Three deterministic checks over facts this repository already holds:
  catalog  one model name against the open-weight catalog (ADR-167): its family, what its documented licence allows
           for personal use or for serving it to others, and, when bits per weight are given, the memory its weights
           take (parameters x bits / 8 / 10^9 GB, the weights only, for the card the count was read from). A name that
           does not say which size or version is not guessed. Running the model stays a locked approval.
  blast    one skill: what it loads (Kahn's layers, replica-plan-order), what loads it (a reverse breadth-first
           search), the pages and engines to test again, each skill's test command, and the matching project
           documents (replica-project-search).
  diff     two texts line by line by longest common subsequence, with SHA-256 of each text, of the difference and
           of the chain that binds them.
It reads the snapshots it is given, ranks nothing, sends nothing and starts no process.

    python3 impact_analysis.py '{"mode": "catalog", "model": "gpt-oss-120b", "use": "service", "bits": 4}' --data jarvis/app/data
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
sys.path[:0] = [_HERE] + [os.path.join(_SKILLS, d) for d in ("replica-plan-order", "replica-project-search", "replica-prompt-metacodes")]
from plan_order import skill_order  # noqa: E402
from project_search import search_project  # noqa: E402
from prompt_metacodes import js_json  # noqa: E402

IA_MODES = ["catalog", "blast", "diff"]
IA_USES = ["personal", "service"]
IA_PAGES = [
    {"skill": "replica-architect-studio", "route": "#/architect", "engine": "architect-studio"},
    {"skill": "replica-release-gate", "route": "#/release", "engine": "release-gate"},
    {"skill": "replica-impact-analysis", "route": "#/impact", "engine": "impact-analysis"},
    {"skill": "replica-runbook", "route": "#/runbook", "engine": "runbook"},
    {"skill": "replica-project-search", "route": "#/docs", "engine": "project-search"},
    {"skill": "replica-plan-order", "route": "#/order", "engine": "plan-order"},
    {"skill": "replica-skill-tree", "route": "#/tree", "engine": "skill-tree"},
    {"skill": "replica-polymath-engine", "route": "#/polymath", "engine": "polymath-engine"},
    {"skill": "replica-unified-workbench", "route": "#/workbench", "engine": "unified-workbench"},
    {"skill": "replica-universal-agent", "route": "#/universal", "engine": "universal-agent"},
    {"skill": "replica-foss-atlas", "route": "#/atlas", "engine": "foss-atlas"},
    {"skill": "replica-universal-math", "route": "#/math", "engine": "universal-math"},
    {"skill": "replica-hyper-studio", "route": "#/hyper", "engine": "hyper-studio"},
]
IA_SHARED_TESTS = ["node jarvis/server/test/test-server.mjs", "node jarvis/scripts/test-app.mjs"]
IA_MUTATION = "node jarvis/scripts/mutation-harness.mjs && python3 jarvis/scripts/mutation_harness.py"
IA_MAX_LINES = 500
_MISSING = object()


class ImpactError(ValueError):
    def __init__(self, message, detail=None):
        super().__init__(message)
        self.status = 400
        self.detail = None if detail is None else str(detail)[:80]


def _fail(message, detail=None):
    raise ImpactError(message, detail)


def _len16(s):
    return len(s.encode("utf-16-le", "surrogatepass")) // 2


def _sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _is_int(v):
    return not isinstance(v, bool) and (isinstance(v, int) or (isinstance(v, float) and v.is_integer()))


def _num(v):
    return int(v) if isinstance(v, float) and v.is_integer() else v


def licence_rule(licence, use, terms=None):
    """What a documented licence allows. ADR-171: a licence whose terms were read in full says so directly: serving the
    model to others needs a licence always, or only above the stated revenue. Otherwise the rule reads the licence text
    in the catalog, and a note in brackets is kept as written."""
    if isinstance(terms, dict):
        return {"verdict": "allowed" if use != "service" else "commercial_licence" if terms.get("when") == "always" else "revenue_threshold", "note": None}
    op, cl = licence.find("("), licence.rfind(")")
    note = licence[op + 1:cl] if op >= 0 and cl > op else None
    if "Non-Production" in licence:
        return {"verdict": "not_allowed" if use == "service" else "non_production", "note": note}
    if "Model-as-a-Service" in licence:
        return {"verdict": "commercial_licence" if use == "service" else "allowed_note", "note": note}
    if licence in ("MIT", "Apache 2.0"):
        return {"verdict": "allowed", "note": None}
    if licence.startswith(("MIT (", "Apache 2.0 (")):
        return {"verdict": "allowed_note", "note": note}
    return {"verdict": "read_licence", "note": note}


def weights_gb(params, bits):
    """The weights' memory: parameters x bits / 8 bytes in GB of 10^9 bytes, to two decimals, as JavaScript rounds."""
    x = math.floor(params * bits / 8 / 1e9 * 100 + 0.5) / 100
    return int(x) if x.is_integer() else x


def kv_cache_gb(c, tokens, batch, kv_bits):
    """The context (KV cache) memory in GB of 10^9 bytes, to two decimals, as JavaScript computes it: gqa counts
    2 x layers x kv_heads x head_dim values per token, mla layers x (kv_lora_rank + qk_rope_head_dim)."""
    per_token = c["layers"] * (c["kv_lora_rank"] + c["qk_rope_head_dim"]) if c["attention"] == "mla" else 2 * c["layers"] * c["kv_heads"] * c["head_dim"]
    x = math.floor(float(per_token) * tokens * batch * kv_bits / 8 / 1e9 * 100 + 0.5) / 100
    return int(x) if x.is_integer() else x


def _r2(v):
    x = math.floor(v * 100 + 0.5) / 100
    return int(x) if x.is_integer() else x


def context_memory(f, same_card, tokens, batch, kv_bits, weights, memory_gb):
    """The context check for one card: memory only for the card the config was read from, with uniform attention and
    bits to count by; the longest documented context is checked whenever known."""
    c = f.get("config") if isinstance(f.get("config"), dict) else None
    if not same_card:
        basis = "other_card"
    elif not c or c.get("attention") == "not_read":
        basis = "not_read"
    elif c.get("attention") == "not_estimated":
        basis = "not_estimated"
    elif kv_bits is None:
        basis = "no_bits"
    else:
        basis = "card"
    mx = c.get("max_context") if same_card and c else None
    kv = kv_cache_gb(c, tokens, batch, kv_bits) if basis == "card" else None
    total = _r2(weights + kv) if kv is not None and weights is not None else None
    reason = c.get("reason") if c and basis in ("not_estimated", "not_read") else None
    return {"tokens": tokens, "batch_size": batch, "kv_bits": kv_bits, "max_context": mx, "exceeds": None if mx is None else tokens > mx, "basis": basis, "reason": reason,
            "attention": c.get("attention") if c else None, "kv_gb": kv, "total_gb": total, "fits": None if total is None or memory_gb is None else total <= memory_gb}


def _check_catalog(catalog):
    if not isinstance(catalog, list) or not 1 <= len(catalog) <= 200:
        _fail("Send the model catalog.", "catalog")
    out = []
    for i, p in enumerate(catalog):
        if (not isinstance(p, dict) or not isinstance(p.get("family"), str) or not isinstance(p.get("match"), str) or not isinstance(p.get("licence"), str)
                or not (p.get("params") is None or _is_int(p.get("params")))):
            _fail("Each family has a name, a pattern, a licence and a parameter count or null.", "catalog[" + str(i) + "]")
        out.append({**p, "re": re.compile(p["match"], re.I | re.A)})
    return out


def check_model(r, catalog):
    fams = _check_catalog(catalog)
    model = r.get("model")
    if not isinstance(model, str) or not model.strip() or _len16(model) > 120:
        _fail("The model name is text of 1 to 120 characters.", "model")
    model = model.strip()
    use = r.get("use")
    if use not in IA_USES:
        _fail("The use is personal or service.", "use")
    bits = r.get("bits", _MISSING)
    if bits is _MISSING:
        bits = None
    elif not (_is_int(bits) and 1 <= bits <= 32):
        _fail("Bits per weight is a whole number from 1 to 32.", "bits")
    else:
        bits = int(bits)
    mem = r.get("memory_gb", _MISSING)
    if mem is _MISSING:
        mem = None
    elif isinstance(mem, bool) or not isinstance(mem, (int, float)) or not math.isfinite(mem) or not 0 < mem <= 100000:
        _fail("The memory is a number of GB above 0 and at most 100000.", "memory_gb")
    else:
        mem = _num(mem)
    tokens = r.get("context_tokens", _MISSING)
    if tokens is _MISSING:
        tokens = None
    elif not (_is_int(tokens) and 1 <= tokens <= 100000000):
        _fail("The context is a whole number of tokens from 1 to 100000000.", "context_tokens")
    else:
        tokens = int(tokens)
    batch = r.get("batch_size", _MISSING)
    if batch is _MISSING:
        batch = 1
    elif not (_is_int(batch) and 1 <= batch <= 4096):
        _fail("The batch size is a whole number from 1 to 4096.", "batch_size")
    else:
        batch = int(batch)
    kv_bits = r.get("kv_bits", _MISSING)
    if kv_bits is _MISSING:
        kv_bits = bits
    elif not (_is_int(kv_bits) and 1 <= kv_bits <= 32):
        _fail("Bits per cache value is a whole number from 1 to 32.", "kv_bits")
    else:
        kv_bits = int(kv_bits)
    out = {"mode": "catalog", "model": model, "use": use, "bits": bits, "memory_gb": mem}
    f = next((p for p in fams if p["re"].search(model)), None)
    if f is None:
        base = model[model.rfind("/") + 1:].split(":")[0].lower()
        cands = [{"family": p["family"], "licence": p["licence"]} for p in fams if p["family"].startswith(base + "-")] if _len16(base) >= 2 else []
        return {**out, "found": False, "verdict": "size_unnamed" if cands else "unknown", "note": None, "family": None, "candidates": cands, "memory": None, "context": None, "steps": [], "sent": False}
    rule = licence_rule(f["licence"], use, f.get("terms"))
    # A family's parameter count belongs to the one card it was read from; another size of the family is not guessed.
    name = model.lower()
    same_card = name == f["card"].lower() or name == f["card"][f["card"].find("/") + 1:].lower()
    if bits is None:
        memory = None
    elif f["params"] is None:
        memory = {"basis": "no_count", "params": None, "bits": bits, "weights_gb": None, "fits": None}
    elif not same_card:
        memory = {"basis": "other_card", "params": None, "bits": bits, "weights_gb": None, "fits": None}
    else:
        w = weights_gb(f["params"], bits)
        memory = {"basis": "card", "params": int(f["params"]), "bits": bits, "weights_gb": w, "fits": None if mem is None else w <= mem}
    fam = {k: f.get(k) for k in ("family", "maker", "origin", "licence", "role", "params", "card", "created", "read", "terms")}
    fam["params"] = None if f["params"] is None else int(f["params"])
    context = None if tokens is None else context_memory(f, same_card, tokens, batch, kv_bits, memory["weights_gb"] if memory else None, mem)
    return {**out, "found": True, "verdict": rule["verdict"], "note": rule["note"], "family": fam, "candidates": [], "memory": memory, "context": context,
            "steps": [{"action": "install", "target": f["family"], "gate": "approval", "locked": True, "status": "pending_approval"}], "sent": False}


def dependents_of(deps, skill):
    """The skills that load a skill, nearest first: a breadth-first search over the dependency snapshot read backwards."""
    names = sorted(deps)
    rev = {n: [] for n in names}
    for n in names:
        for m in deps[n] if isinstance(deps[n], list) else []:
            if isinstance(m, str) and m in rev:
                rev[m].append(n)
    depth, queue = {skill: 0}, [skill]
    while queue:
        n = queue.pop(0)
        for m in rev.get(n, []):
            if m not in depth:
                depth[m] = depth[n] + 1
                queue.append(m)
    return sorted(({"name": n, "depth": d} for n, d in depth.items() if n != skill), key=lambda x: (x["depth"], x["name"]))


def blast_radius(r, ctx):
    deps = ctx.get("deps")
    if not isinstance(deps, dict):
        _fail("Send the dependency snapshot.", "deps")
    skill = r.get("skill")
    if not isinstance(skill, str) or skill not in deps:
        _fail("That skill is not in the snapshot.", skill if isinstance(skill, str) else "skill")
    # Project search checks the query itself (text of 1 to 300 characters).
    query = r.get("query", skill)
    up = skill_order(deps, [skill])
    dependents = dependents_of(deps, skill)
    touched = [skill] + [d["name"] for d in dependents]
    tree = ctx.get("tree")
    facts = {s.get("name"): s for s in (tree.get("skills") if isinstance(tree, dict) and isinstance(tree.get("skills"), list) else []) if isinstance(s, dict) and isinstance(s.get("name"), str)}
    pages = [p for p in IA_PAGES if p["skill"] in touched]
    tests = [{"skill": n, "command": "python3 -m unittest discover -s .claude/skills/" + n + "/tests" if facts.get(n, {}).get("tests") else None} for n in touched]
    shared = (IA_SHARED_TESTS + ([IA_MUTATION] if any(facts.get(n, {}).get("mutation") for n in touched) else [])) if pages else []
    corpus = ctx.get("corpus")
    s = search_project({"docs": []} if corpus is None else corpus, {"query": query, "limit": 5})
    return {"mode": "blast", "skill": skill, "query": query, "upstream": {"layers": up["layers"], "added": up["added"], "cycle": up["cycle"], "verified": up["verified"]},
            "dependents": dependents, "pages": pages, "tests": tests, "shared_tests": shared,
            "docs": {"found": s["found"], "top": [{"id": x["id"], "kind": x["kind"], "title": x["title"], "score": x["score"]} for x in s["results"]]}, "sent": False}


def _lines(text, name):
    ok = isinstance(text, str) and _len16(text) <= 20000
    if ok:
        try:
            text.encode("utf-8")
        except UnicodeEncodeError:
            ok = False
    if not ok:
        _fail("Each text is well-formed text of at most 20000 characters.", name)
    out = re.split(r"\r?\n", text)
    if len(out) > IA_MAX_LINES:
        _fail("Each text has at most " + str(IA_MAX_LINES) + " lines.", name)
    return out


def lcs_diff(a, b):
    """Longest common subsequence, line by line: equal lines are kept, then a line only in a is removed before a line
    only in b is added when both choices keep the same length."""
    n, m = len(a), len(b)
    L = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            L[i][j] = L[i + 1][j + 1] + 1 if a[i] == b[j] else max(L[i + 1][j], L[i][j + 1])
    out, i, j = [], 0, 0
    while i < n or j < m:
        if i < n and j < m and a[i] == b[j]:
            out.append({"op": "=", "a": i + 1, "b": j + 1, "text": a[i]})
            i, j = i + 1, j + 1
        elif j >= m or (i < n and L[i + 1][j] >= L[i][j + 1]):
            out.append({"op": "-", "a": i + 1, "b": None, "text": a[i]})
            i += 1
        else:
            out.append({"op": "+", "a": None, "b": j + 1, "text": b[j]})
            j += 1
    return out


def diff_texts(r):
    ops = lcs_diff(_lines(r.get("a"), "a"), _lines(r.get("b"), "b"))
    hashes = [_sha(r["a"]), _sha(r["b"]), _sha(js_json(ops))]
    chain = "0" * 64
    for h in hashes:
        chain = _sha(chain + h)
    return {"mode": "diff", "counts": {"same": sum(1 for x in ops if x["op"] == "="), "removed": sum(1 for x in ops if x["op"] == "-"), "added": sum(1 for x in ops if x["op"] == "+")},
            "lines": ops, "a_sha256": hashes[0], "b_sha256": hashes[1], "diff_sha256": hashes[2], "chain_sha256": chain, "sent": False}


def impact_analysis(req, ctx=None):
    r = req if isinstance(req, dict) else _fail("Send an object with a mode.", "")
    c = ctx if isinstance(ctx, dict) else {}
    if r.get("mode") == "catalog":
        return check_model(r, c.get("catalog"))
    if r.get("mode") == "blast":
        return blast_radius(r, c)
    if r.get("mode") == "diff":
        return diff_texts(r)
    return _fail("The mode is catalog, blast or diff.", "mode")


def load_context(data_dir):
    """The four snapshots the page and the server read, from jarvis/app/data. Files only."""
    def load(name):
        with open(os.path.join(data_dir, name), encoding="utf-8") as fh:
            return json.load(fh)
    return {"catalog": load("model-catalog.json")["families"], "deps": load("skill-deps.json")["skills"], "tree": load("skill-tree-input.json"), "corpus": load("search-corpus.json")}


def main(argv=None):
    p = argparse.ArgumentParser(description="Impact analysis (ADR-168).")
    p.add_argument("request")
    p.add_argument("--data", default="jarvis/app/data")
    a = p.parse_args(argv)
    try:
        raw = sys.stdin.read() if a.request == "-" else a.request
        print(json.dumps(impact_analysis(json.loads(raw), load_context(a.data)), ensure_ascii=False))
        return 0
    except (ValueError, OSError) as e:
        print(json.dumps({"error": str(e), "detail": getattr(e, "detail", None)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
