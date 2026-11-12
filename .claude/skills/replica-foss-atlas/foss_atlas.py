"""FOSS atlas and privacy shield (ADR-158): the same engine as jarvis/server/lib/foss-atlas.mjs, standard library only.

    python3 foss_atlas.py atlas                                   # the atlas, every licence with its file and date
    python3 foss_atlas.py plan '{"selectedIds":["nextcloud","n8n"],"prices":{"nextcloud":1200}}'
    python3 foss_atlas.py scrub - < notes.txt                     # the text with keys and personal data replaced
    python3 foss_atlas.py personas '{"seed":158,"count":3}'       # teaching examples, made-up numbers

Nothing here installs, fetches or sends anything. The plan is proved by the reviewed replica-formal-verify
prover beside it. A secret given to `plan` as secretCheck is hashed here; only the first 5 hex characters of
its SHA-1 and its entropy come back, never the secret. For the same request this file and the server return
the same JSON.
"""
import argparse
import hashlib
import json
import math
import os
import re
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [_HERE, os.path.join(os.path.dirname(_HERE), "replica-formal-verify")]
from state_prover import plan_machine, prove  # noqa: E402

FA_READ = "2026-11-12"
FA_LIMITS = {"picks": 40, "price": 10000000, "text": 20000, "personas": 12}
FA_CATEGORIES = ["office", "files", "chat", "analytics", "automation", "images", "design", "photos", "music", "video", "screen", "voice", "ai", "scraping",
                 "browser", "books", "apis", "mcp", "free-tiers", "skills"]
_RAW = "https://raw.githubusercontent.com/"
_ROWS = [
    ("libreoffice", "LibreOffice", "office", "tool", "Microsoft 365, Google Docs", "LibreOffice/core", "COPYING.MPL", "MPL-2.0 (COPYING holds the GPL-3.0 text too)", "mixed", True),
    ("nextcloud", "Nextcloud", "files", "tool", "Google Drive, Dropbox", "nextcloud/server", "COPYING", "AGPL-3.0", "osi", True),
    ("mattermost", "Mattermost", "chat", "tool", "Slack", "mattermost/mattermost", "LICENSE.txt", "AGPL-3.0 source, MIT compiled builds, Apache-2.0 templates", "mixed", True),
    ("matomo", "Matomo", "analytics", "tool", "Google Analytics", "matomo-org/matomo", "LICENSE", "GPL-3.0", "osi", True),
    ("n8n", "n8n", "automation", "tool", "Zapier, Make", "n8n-io/n8n", "LICENSE.md", "Sustainable Use License (source-available, not OSI)", "fair-code", True),
    ("gimp", "GIMP", "images", "tool", "Adobe Photoshop", "GNOME/gimp", "LICENSE", "GPL-3.0 with a plug-in exemption", "osi", True),
    ("penpot", "Penpot", "design", "tool", "Figma", "penpot/penpot", "LICENSE", "MPL-2.0", "osi", True),
    ("immich", "Immich", "photos", "tool", "Google Photos, iCloud Photos", "immich-app/immich", "LICENSE", "AGPL-3.0", "osi", True),
    ("navidrome", "Navidrome", "music", "tool", "Spotify, for your own library", "navidrome/navidrome", "LICENSE", "GPL-3.0", "osi", True),
    ("opencut", "OpenCut", "video", "tool", "CapCut", "OpenCut-app/OpenCut", "LICENSE", "MIT", "osi", True),
    ("cap", "Cap", "screen", "tool", "Loom", "CapSoftware/Cap", "LICENSE", "AGPL-3.0, with MIT camera crates", "mixed", True),
    ("handy", "Handy", "voice", "tool", "Cloud dictation", "cjpais/Handy", "LICENSE", "MIT", "osi", True),
    ("anythingllm", "AnythingLLM", "ai", "tool", "Hosted chat workspaces", "Mintplex-Labs/anything-llm", "LICENSE", "MIT", "osi", True),
    ("scrapling", "Scrapling", "scraping", "tool", "Hosted scraping APIs", "D4Vinci/Scrapling", "LICENSE", "BSD-3-Clause", "osi", True),
    ("brave", "Brave", "browser", "tool", "Google Chrome", "brave/brave-browser", "LICENSE", "MPL-2.0", "osi", True),
    ("gutenberg", "Project Gutenberg", "books", "list", "Paid e-book stores, for public-domain books", None, None, None, None, None),
    ("public-apis", "Public APIs", "apis", "list", "Paid API directories", "public-apis/public-apis", "LICENSE", "MIT", "osi", None),
    ("awesome-mcp", "Awesome MCP Servers", "mcp", "list", "Closed connector catalogues", "punkpeye/awesome-mcp-servers", "LICENSE", "MIT", "osi", None),
    ("free-for-dev", "free-for-dev", "free-tiers", "list", "Paid developer tiers", "ripienaar/free-for-dev", None, None, None, None),
    ("browser-use", "browser-use", "skills", "skill-idea", "Hand-run browser checks", "browser-use/browser-use", "LICENSE", "MIT", "osi", True),
    ("agentmemory", "agentmemory", "skills", "skill-idea", "Hosted agent memory", "rohitg00/agentmemory", "LICENSE", "Apache-2.0", "osi", True),
    ("scientific-agent-skills", "Scientific Agent Skills", "skills", "skill-idea", "Hosted maths notebooks", "K-Dense-AI/scientific-agent-skills", "LICENSE.md", "MIT", "osi", True),
    ("cybersecurity-skills", "Anthropic-Cybersecurity-Skills", "skills", "skill-idea", "Paid security playbooks", "mukul975/Anthropic-Cybersecurity-Skills", "LICENSE", "Apache-2.0", "osi", True),
    ("awesome-harness", "awesome-harness-engineering", "skills", "skill-idea", "Closed agent-harness guides", "ai-boost/awesome-harness-engineering", "LICENSE", "CC0-1.0", "public-domain", None),
    ("openviking", "OpenViking", "skills", "skill-idea", "Hosted context stores", "volcengine/OpenViking", "LICENSE", "AGPL-3.0", "osi", True),
    ("ui-ux-pro-max", "ui-ux-pro-max-skill", "skills", "skill-idea", "Paid design reviews", "nextlevelbuilder/ui-ux-pro-max-skill", "LICENSE", "MIT", "osi", True),
]
FOSS_ATLAS = [{"id": i, "name": n, "category": c, "kind": k, "replaces": rp, "url": "https://github.com/" + repo if repo else None,
               "licence": {"text": lic, "family": fam, "file": _RAW + repo + "/HEAD/" + f, "read": FA_READ} if lic else None, "selfHost": sh,
               "status": "idea" if k == "skill-idea" else "reference" if k == "list" else "option"}
              for i, n, c, k, rp, repo, f, lic, fam, sh in _ROWS]
FA_NOTES = {
    "scrapling": "Listed for parsing pages you are allowed to read. Its anti-bot features are not used (AGENTS.md §3).",
    "n8n": "Fair-code: the source is open to read and self-host, but the licence is not OSI-approved.",
}


class AtlasError(ValueError):
    def __init__(self, message, detail=None):
        super().__init__(message)
        self.status = 400
        self.detail = None if detail is None else str(detail)[:80]


def _fail(message, detail=None):
    raise AtlasError(message, detail)


def _num(x):
    return int(x) if isinstance(x, float) and x.is_integer() and abs(x) < 2 ** 53 else x


def fa_r(v, d=2):
    """Math.round(v * 10^d) / 10^d as JavaScript computes it, -0 as 0, whole numbers as int."""
    p = 10 ** d
    x = math.floor(v * p + 0.5) / p
    if x == 0:
        x = 0.0
    return _num(x)


def _utf16_len(s):
    return len(s.encode("utf-16-le", "surrogatepass")) // 2


def entropy(s):
    """Shannon entropy in bits per character, as diagnostics.mjs counts it (code points over UTF-16 length)."""
    n = _utf16_len(s)
    if not n:
        return 0
    counts = {}
    for ch in s:
        counts[ch] = counts.get(ch, 0) + 1
    h = 0.0
    for c in counts.values():
        p = c / n
        h -= p * math.log2(p)
    return h


# ---- k-anonymity ---------------------------------------------------------------------------------------------
def sha1_hex(text):
    t = re.sub(r"[\ud800-\udfff]", "�", str(text))
    # SHA-1 is the range format the k-anonymity lookup uses, not a protection of the secret.
    return hashlib.sha1(t.encode("utf-8"), usedforsecurity=False).hexdigest()


def k_anonymity(secret):
    if not isinstance(secret, str) or not secret:
        _fail("Give the text to check.", "secretCheck")
    n = _utf16_len(secret)
    if n > 256:
        _fail("The text to check is longer than 256 characters.", "secretCheck")
    hx = sha1_hex(secret).upper()
    per = entropy(secret)
    classes = sum(1 for rx in (r"[a-z]", r"[A-Z]", r"[0-9]", r"[^A-Za-z0-9]") if re.search(rx, secret))
    return {"method": "SHA-1, first 5 hex characters (k-anonymity range)", "prefix": hx[:5], "hidden": 35, "length": n, "classes": classes,
            "entropy_bits_per_char": fa_r(per), "entropy_bits": fa_r(per * n), "looked_up": False}


# ---- The privacy shield ----------------------------------------------------------------------------------------
_WS = "\t\n\v\f\r    -     　﻿"
SECRET_PATTERNS = [
    ("openai-style key", re.compile(r"\bsk-[A-Za-z0-9_-]{20,}", re.A)),
    ("github token", re.compile(r"\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}", re.A)),
    ("aws access key", re.compile(r"\b(AKIA|ASIA)[0-9A-Z]{16}\b", re.A)),
    ("slack token", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}", re.A)),
    ("google api key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b", re.A)),
    ("private key block", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|\Z)", re.A)),
    ("bearer token", re.compile(r"\bBearer[" + _WS + r"]+[A-Za-z0-9._~+/=-]{16,}", re.A | re.I)),
    ("json web token", re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}", re.A)),
    ("password in a url", re.compile(r"(//[^/" + _WS + r":@]+:)[^@" + _WS + r"/]+@", re.A)),
]
PII_PATTERNS = [
    ("e-mail address", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", re.A)),
    ("iban", re.compile(r"\b[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}\b", re.A)),
    ("card number", re.compile(r"\b[0-9](?:[ -]?[0-9]){12,18}\b", re.A)),
    ("phone number", re.compile(r"\+[0-9](?:[ -]?[0-9]){7,14}\b", re.A)),
    ("ipv4 address", re.compile(r"\b(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\b", re.A)),
]
_RANDOMISH = re.compile(r"[A-Za-z0-9+/_=-]{24,}", re.A)
_HEX = re.compile(r"[0-9a-fA-F]+")
ENTROPY_LIMIT = 4.5


def luhn_ok(digits):
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def scrub_private(text):
    if not isinstance(text, str):
        _fail("Give the text to scrub.", "text")
    if _utf16_len(text) > FA_LIMITS["text"]:
        _fail("The text is longer than 20,000 characters.", "text")
    counts = {}

    def hit(rule):
        counts[rule] = counts.get(rule, 0) + 1

    out = text
    for rule, rx in SECRET_PATTERNS:
        def rep(m, rule=rule):
            hit(rule)
            return m.group(1) + "[REDACTED]@" if rule == "password in a url" else "[REDACTED]"
        out = rx.sub(rep, out)

    def rnd(m):
        s = m.group(0)
        if _HEX.fullmatch(s) or entropy(s) < ENTROPY_LIMIT:
            return s
        hit("high entropy")
        return "[REDACTED]"
    out = _RANDOMISH.sub(rnd, out)
    for rule, rx in PII_PATTERNS:
        def rep2(m, rule=rule):
            if rule == "card number" and not luhn_ok(re.sub(r"[ -]", "", m.group(0))):
                return m.group(0)
            hit(rule)
            return "[" + rule.upper().replace(" ", "_") + "]"
        out = rx.sub(rep2, out)
    redactions = [{"rule": k, "count": v} for k, v in counts.items()]
    return {"text": out, "redactions": redactions, "total": sum(r["count"] for r in redactions), "framework": "NIST CSF 2.0 · Protect · PR.DS (data security)",
            "changed": out != text}


# ---- The planner -----------------------------------------------------------------------------------------------
def plan_steps(picks):
    steps = [{"kind": "tool", "title": "Read each pick's atlas entry and licence", "category": None}]
    for e in picks:
        if e["kind"] == "skill-idea":
            steps.append({"kind": "gate", "title": "Write a security review of " + e["name"], "category": None})
        if e["kind"] != "list":
            steps.append({"kind": "approval", "title": "Install " + e["name"] + " on this computer", "category": "install", "gate": "approval", "locked": True, "status": "pending_approval"})
        if e["id"] == "n8n":
            steps.append({"kind": "approval", "title": "Connect n8n to outside services", "category": "outbound", "gate": "approval", "locked": True, "status": "pending_approval"})
    steps.append({"kind": "gate", "title": "Run the checks: tests and SkillSpector", "category": None})
    return [{**s, "depends": [i - 1] if i else []} for i, s in enumerate(steps)]


def n8n_blueprint(steps):
    names = [f"{i + 1}. {s['title']}" for i, s in enumerate(steps)]
    nodes = [{"name": "Start", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "position": [0, 0], "parameters": {}}]
    nodes += [{"name": names[i], "type": "n8n-nodes-base.noOp", "typeVersion": 1, "position": [240 * (i + 1), 0], "parameters": {},
               "notes": "Locked: waits for Director 00 (AGENTS.md §1). Nothing runs here." if s.get("locked") else "Inert step. Nothing runs here."} for i, s in enumerate(steps)]
    allnames = ["Start", *names]
    connections = {n: {"main": [[{"node": allnames[i + 1], "type": "main", "index": 0}]]} for i, n in enumerate(allnames) if i < len(allnames) - 1}
    return {"name": "Jarvis FOSS stack (inert)", "nodes": nodes, "connections": connections, "active": False}


def _is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def plan_foss_stack(req):
    r = req if isinstance(req, dict) else {}
    ids = r.get("selectedIds")
    if not isinstance(ids, list) or not ids:
        _fail("Pick at least one tool from the atlas.", "selectedIds")
    if len(ids) > FA_LIMITS["picks"]:
        _fail("Pick at most 40 entries.", "selectedIds")
    picks = []
    for i in ids:
        e = next((x for x in FOSS_ATLAS if x["id"] == i), None)
        if e is None:
            _fail("This entry is not in the atlas.", i if isinstance(i, str) else "")
        if e not in picks:
            picks.append(e)
    tools = [e for e in picks if e["kind"] == "tool"]
    own = sum(1 for e in tools if e["selfHost"] is True)
    sovereignty = {"percent": fa_r(100 * own / len(tools), 1), "self_hosted": own, "tools": len(tools), "tag": "[INFERENCE]"} if tools else None
    prices = r.get("prices") if isinstance(r.get("prices"), dict) else {}
    items = []
    for e in picks:
        if e["id"] not in prices:
            continue
        v = prices[e["id"]]
        if not _is_num(v) or not math.isfinite(v) or v < 0 or v > FA_LIMITS["price"]:
            _fail("A yearly price is a number from 0 to 10,000,000.", e["id"])
        items.append({"id": e["id"], "replaces": e["replaces"], "usd_per_year": _num(v)})
    savings = {"usd_per_year": fa_r(sum(x["usd_per_year"] for x in items)), "items": items, "source": "prices you entered"} if items else None
    steps = plan_steps(picks)
    proof = prove(plan_machine(steps))
    out = {"picks": [e["id"] for e in picks], "sovereignty": sovereignty, "savings": savings, "steps": steps, "proof": proof, "blueprint": n8n_blueprint(steps),
           "mcp": {"servers": {}, "locked": [e["name"] for e in picks if e["kind"] == "skill-idea"],
                   "note": "No MCP server is configured; each would be an install, locked until reviewed and approved."},
           "notes": [{"id": e["id"], "text": FA_NOTES[e["id"]]} for e in picks if e["id"] in FA_NOTES]}
    if "secretCheck" in r:
        out["secret"] = k_anonymity(r["secretCheck"])
    out["verified"] = proof["verified"]
    return out


# ---- Seeded personas ----------------------------------------------------------------------------------------
def mulberry32(seed):
    state = [seed & 0xFFFFFFFF]

    def nxt():
        state[0] = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
        t = state[0]
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t = (t ^ ((t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
    return nxt


_NAMES = [("Salem", "سالم"), ("Noura", "نورة"), ("Faisal", "فيصل"), ("Maha", "مها"), ("Khalid", "خالد"), ("Reem", "ريم"), ("Yousef", "يوسف"), ("Hessa", "حصة")]
_ROLES = [("Studio founder", "مؤسس استوديو"), ("Clinic manager", "مدير عيادة"), ("Teacher", "معلّم"), ("Shop owner", "صاحب متجر"), ("Researcher", "باحث"), ("Designer", "مصمم")]


def _is_int(v):
    return (isinstance(v, int) and not isinstance(v, bool)) or (isinstance(v, float) and v.is_integer())


def personas(req):
    r = req if isinstance(req, dict) else {}
    seed = int(r["seed"]) if _is_int(r.get("seed")) else 158
    count = int(r["count"]) if _is_int(r.get("count")) else 3
    if count < 1 or count > FA_LIMITS["personas"]:
        _fail("Ask for 1 to 12 personas.", "count")
    rnd = mulberry32(seed)
    tools = [e for e in FOSS_ATLAS if e["kind"] == "tool"]
    out = []
    for _ in range(count):
        name = _NAMES[math.floor(rnd() * len(_NAMES))]
        role = _ROLES[math.floor(rnd() * len(_ROLES))]
        team = 1 + math.floor(rnd() * 24)
        picks = []
        while len(picks) < 3:
            e = tools[math.floor(rnd() * len(tools))]
            if e["id"] not in picks:
                picks.append(e["id"])
        prices = {i: 10 * math.floor(rnd() * 120 + 0.5) * team for i in picks}
        out.append({"name": {"en": name[0], "ar": name[1]}, "role": {"en": role[0], "ar": role[1]}, "team": team, "picks": picks, "prices": prices})
    return {"seed": seed, "label": {"en": "Teaching example: made-up numbers", "ar": "مثال تعليمي — أرقام افتراضية"}, "personas": out}


def atlas_view():
    return {"read": FA_READ, "categories": FA_CATEGORIES, "entries": FOSS_ATLAS, "notes": FA_NOTES}


def main(argv=None):
    ap = argparse.ArgumentParser(description="FOSS atlas, stack planner, privacy shield and personas (ADR-158).")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("atlas")
    for name in ("plan", "personas"):
        sub.add_parser(name).add_argument("request", help="a JSON request")
    sub.add_parser("scrub").add_argument("file", help="a text file, or - for standard input")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "atlas":
            out = atlas_view()
        elif a.cmd == "scrub":
            if a.file == "-":
                text = sys.stdin.read()
            else:
                with open(a.file, encoding="utf-8") as fh:
                    text = fh.read()
            out = scrub_private(text)
        else:
            req = json.loads(a.request)
            out = plan_foss_stack(req) if a.cmd == "plan" else personas(req)
        print(json.dumps(out, ensure_ascii=False))
        return 0
    except (AtlasError, json.JSONDecodeError) as e:
        print(json.dumps({"error": str(e), "detail": getattr(e, "detail", None)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
