#!/usr/bin/env python3
"""Mutation run for the critical Python in the repository's own skills (ADR-146): gate.py's evidence judge and
state_prover.py's proofs. replica-formal-verify/mutation_audit.py writes each mutant as a copy in a temporary
folder; this script loads each copy with runpy (no process is started, no outside code is read) and runs a
fixed oracle against it. A mutant is killed when an answer changes, it raises or it runs past 3 seconds.

It then joins the JavaScript run (jarvis/replica/evidence/mutation-js.json, written by mutation-harness.mjs)
into one evidence file with the SHA-256 of every tested source, jarvis/replica/evidence/mutation-audit.log.
mutation_audit.py --evidence and the Jarvis page read the measured result from that file, and only while the
source still matches its hash.

    node jarvis/scripts/mutation-harness.mjs && python3 jarvis/scripts/mutation_harness.py
"""

import hashlib
import json
import os
import runpy
import shutil
import signal
import sys
import tempfile
from datetime import UTC, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(REPO, ".claude", "skills", "replica-formal-verify"))
import mutation_audit as ma  # noqa: E402

EVIDENCE = os.path.join(REPO, "jarvis", "replica", "evidence")


def oracle_gate(ns, work):
    judge = ns["judge"]
    out = []

    def case(name, check, text, want_ok, want_reason=None):
        p = os.path.join(work, "ev.log")
        with open(p, "w", encoding="utf-8") as fh:
            fh.write(text)
        ok, reason = judge(check, p)
        out.append((name, ok == want_ok and (want_reason is None or reason == want_reason)))

    case("node pass", "tests", "10 passed, 0 failed\n", True, "10 passed, 0 failed")
    case("node fail", "tests", "9 passed, 1 failed\n", False)
    case("node none", "tests", "0 passed, 0 failed\n", False)
    case("node one", "tests", "1 passed, 0 failed\n", True)
    case("node last line", "tests", "1 passed, 1 failed\n5 passed, 0 failed\n", True)
    case("unittest ok", "tests", "Ran 5 tests in 0.1s\n\nOK\n", True, "Ran 5 tests, OK")
    case("unittest one", "tests", "Ran 1 test in 0.0s\n\nOK\n", True)
    case("unittest failed", "tests", "Ran 2 tests in 0.1s\n\nFAILED (failures=1)\n", False, "Ran 2 tests, FAILED")
    case("unittest none", "tests", "Ran 0 tests in 0.0s\n\nOK\n", False)
    case("unittest ok and failed", "tests", "Ran 3 tests in 0.1s\nOK\nFAILED\n", False)
    case("pytest ok", "tests", "===== 5 passed in 0.20s =====\n", True, "5 passed in 0.20s")
    case("pytest failed", "tests", "== 3 passed, 1 failed in 1.0s ==\n", False)
    case("pytest error", "tests", "== 3 passed, 2 errors in 1.0s ==\n", False)
    case("no summary", "tests", "all good\n", False)
    case("contrast ok", "contrast", "All pairs pass WCAG >= 4.5\n", True, "all pairs pass")
    case("contrast count", "contrast", "118 checks, 0 failing AA\n", True)
    case("contrast fail", "contrast", "  FAIL text on bg\nAll pairs pass\n", False, "a pair fails or no summary line")
    case("contrast none", "contrast", "nothing\n", False)
    case("security ok", "security", json.dumps({"summary": {"critical": 0, "high": 0}}), True, "critical 0, high 0")
    case("security high", "security", json.dumps({"summary": {"critical": 0, "high": 1}}), False)
    case("security critical", "security", json.dumps({"summary": {"critical": 1, "high": 0}}), False)
    case("security missing", "security", json.dumps({"summary": {}}), False, "critical -1, high -1")
    case("security not json", "security", "critical 0", False, "not a SkillSpector --json report")
    case("lint ok", "lint", "All checks passed!\n", True, "clean")
    case("lint zero", "lint", "Found 0 errors\n", True)
    case("lint error", "lint", "error: bad\n0 errors\n", False, "errors found or no summary line")
    case("lint none", "lint", "\n", False)
    case("unknown", "speed", "fast\n", False, "unknown check")
    return out


PLAN = [
    {"title": "Read", "kind": "tool"},
    {"title": "Tests", "kind": "gate", "depends": [0]},
    {"title": "Publish", "kind": "approval", "category": "publish", "locked": True, "depends": [1]},
    {"title": "Pay", "kind": "approval", "category": "money", "locked": True, "depends": [2]},
    {"title": "Note", "kind": "approval", "category": "file_write", "locked": False, "depends": [0]},
]


def oracle_prover(ns, work):
    pm, prove, ui = ns["plan_machine"], ns["prove"], ns["ui_completeness"]
    out = []
    m = pm(PLAN)
    t = m["transitions"]
    out.append(("machine size", len(m["states"]) == 10 and len(t) == 13))
    out.append(("gate can fail", {"from": "s1", "to": "stopped", "event": "fail"} in t))
    out.append(("note can be rejected", {"from": "s4", "to": "stopped", "event": "rejected"} in t))
    out.append(("effect after approval", {"from": "s2", "to": "e2", "event": "approved"} in t and {"from": "e3", "to": "done", "event": "approved"} in t))
    p = prove(m)
    out.append(("verified", p["verified"] is True and p["effects"] == 2 and p["lockedStates"] == 2 and p["reachable"] == 10 and p["deadlocks"] == [] and p["unreachable"] == [] and p["reachesDone"] and p["danglingTransitions"] == 0))
    opened = [dict(s, locked=False) if s.get("category") == "publish" else s for s in PLAN]
    q = prove(pm(opened))
    out.append(("unlocked publish has a path", q["verified"] is False and len(q["violations"]) == 1 and q["violations"][0]["path"] == ["start -begin-> s0", "s0 -ok-> s1", "s1 -ok-> s2", "s2 -approved-> e2"]))
    dead = pm(PLAN)
    dead["states"].append({"id": "limbo"})
    dead["transitions"].append({"from": "s0", "to": "limbo", "event": "x"})
    out.append(("deadlock", prove(dead)["deadlocks"] == ["limbo"] and prove(dead)["verified"] is False))
    orphan = pm(PLAN)
    orphan["transitions"] = [x for x in orphan["transitions"] if x["to"] != "s4"]
    out.append(("unreachable", prove(orphan)["unreachable"] == ["s4"] and prove(orphan)["verified"] is False))
    dang = pm(PLAN)
    dang["transitions"].append({"from": "s0", "to": "nowhere", "event": "x"})
    out.append(("dangling", prove(dang)["danglingTransitions"] == 1 and prove(dang)["verified"] is False))
    nod = pm([{"title": "g", "kind": "gate"}])
    nod["transitions"] = [x for x in nod["transitions"] if x["to"] != "done"]
    out.append(("done reachable", prove(nod)["reachesDone"] is False and prove(nod)["verified"] is False))
    out.append(("empty plan", prove(pm([]))["verified"] is True and len(pm([])["transitions"]) == 1))
    out.append(("bad depends", sum(1 for x in pm([{"title": "a", "depends": [3, -1, 0]}])["transitions"] if x["event"] == "begin") == 0))
    st = pm([{"title": "y" * 200}, {"title": "b", "kind": "gate", "category": "x"}])["states"]
    out.append(("state fields", len(st[3]["title"]) == 160 and st[3]["kind"] == "tool" and st[3]["category"] is None and st[4]["kind"] == "gate" and st[4]["category"] == "x" and pm([{}])["states"][3]["title"] == ""))
    out.append(("no self-dependency", {"from": "s0", "to": "done", "event": "ok"} in pm([{"title": "a", "depends": [0]}])["transitions"]))
    out.append(("no done in machine", prove({"initial": "start", "states": [{"id": "start"}, {"id": "end", "terminal": True}], "transitions": [{"from": "start", "to": "end", "event": "x"}]})["verified"] is True))
    css = ".btn{} .btn-primary:hover{} :focus-visible{} .btn:active{} .btn[aria-busy=true]{} .empty-state{} .btn[aria-invalid]{} .btn:disabled{} .input{} .input::placeholder{} .chip{}"
    r = ui(css, ["btn", "chip"])
    out.append(("ui report", r["components"][0]["missing"] == [] and r["components"][1]["missing"] == ["hover", "loading", "error", "locked"] and r["complete"] is False and r["gate"] is False))
    g = ui(css, [], {"btn": ["default", "hover", "active"], "input": ["default", "empty", "hover"]})
    out.append(("ui gate", g["complete"] is False and g["components"][1]["missing"] == ["hover"] and g["covered"] == 5 and g["total"] == 6 and g["percent"] == 83.3 and g["gate"] is True))
    out.append(("ui full", ui(css, [], {"btn": ["default", "hover"]})["percent"] == 100.0 and ui("", [], {})["percent"] == 100.0))
    return out


def oracle_quantum(ns, work):
    mul, inv, split, join, vpin = ns["gf_mul"], ns["gf_inv"], ns["split_secret_gf256"], ns["reconstruct_secret_gf256"], ns["compute_vpin_toxicity"]
    out = [("fips-197 products", mul(0x57, 0x83) == 0xC1 and mul(0x57, 0x13) == 0xFE and mul(0, 9) == 0 and mul(1, 0xAB) == 0xAB and mul(0x80, 2) == 0x1B)]
    out.append(("inverses", all(mul(a, inv(a)) == 1 for a in range(1, 256))))
    try:
        inv(0)
        out.append(("zero has no inverse", False))
    except ValueError:
        out.append(("zero has no inverse", True))
    seq = iter([7, 200, 13, 99, 0, 254, 31, 64, 128, 1, 255] * 40)
    secret = bytes(range(32))
    shares = split(secret, 3, 5, rand_byte=lambda: next(seq))
    out.append(("share shape", len(shares) == 5 and all(len(bytes.fromhex(s["y"])) == 32 and s["k"] == 3 for s in shares) and [s["x"] for s in shares] == [1, 2, 3, 4, 5]))
    out.append(("any 3 rebuild", all(join([shares[i] for i in p]) == secret for p in ([0, 1, 2], [0, 2, 4], [2, 3, 4], [4, 1, 0]))))
    out.append(("2 do not", join(shares[:2]) != secret))
    again = iter([7, 200, 13, 99, 0, 254, 31, 64, 128, 1, 255] * 40)
    out.append(("a fixed generator is used as given", [x["y"] for x in split(secret, 3, 5, rand_byte=lambda: next(again))] == [x["y"] for x in shares]))
    dflt = split(b"ab")
    out.append(("defaults k=3, n=5", len(dflt) == 5 and dflt[0]["k"] == 3 and dflt[0]["n"] == 5))
    big = bytes(range(256)) * 8
    out.append(("secure default rebuilds 2,048 bytes", join(split(big, 3, 4)[1:]) == big))
    out.append(("one share is itself", join([shares[2]]) == bytes.fromhex(shares[2]["y"])))
    for xbad in (0, 256):
        try:
            join([dict(shares[0], x=xbad, sha256=None), shares[1]])
            out.append(("refuses x out of 1..255", False))
        except ValueError:
            out.append(("refuses x out of 1..255", True))
    out.append(("2-of-2", join(split(b"\x00\xff\x10", 2, 2, rand_byte=lambda: 5)) == b"\x00\xff\x10"))
    for bad in ([shares[0], shares[0]], [dict(shares[0], y="ff" + shares[0]["y"][2:]), shares[1], shares[2]]):
        try:
            join(bad)
            out.append(("refuses bad shares", False))
        except ValueError:
            out.append(("refuses bad shares", True))
    for k, n in ((1, 3), (4, 3), (2, 256)):
        try:
            split(b"x", k, n)
            out.append(("refuses k, n", False))
        except ValueError:
            out.append(("refuses k, n", True))
    good = vpin([{"tokens": 100, "productive": True}] * 10)
    out.append(("vpin healthy", good["vpin"] == 0.0 and good["ofi"] == 1.0 and good["status"] == "healthy" and not good["recommend_capsule_rollback"] and good["buckets"] == 5))
    bad = vpin([{"tokens": 200, "productive": False, "repeated_ngrams": 6}] * 4)
    out.append(("vpin toxic", bad["vpin"] == 1.0 and bad["ofi"] == -1.0 and bad["status"] == "toxic" and bad["recommend_capsule_rollback"]))
    half = vpin([{"tokens": 100, "productive": True}, {"tokens": 100, "productive": False, "repeated_ngrams": 4}])
    out.append(("vpin half", half["vpin"] == 0.5 and half["buckets"] == 1 and half["status"] == "elevated"))
    mid = vpin([{"tokens": 100, "productive": False}, {"tokens": 100, "productive": True}])
    out.append(("vpin 0.375", mid["vpin"] == 0.375 and mid["status"] == "healthy" and mid["ofi"] == 0.25))
    edge = vpin([{"tokens": 100, "productive": False, "repeated_ngrams": 1}, {"tokens": 100, "productive": True}], 200, 10, 0.415)
    out.append(("vpin limit edge", edge["vpin"] == 0.415 and edge["recommend_capsule_rollback"] and edge["status"] == "toxic"))
    tail = vpin([{"tokens": 50, "productive": False}] * 3 + [{"tokens": 50, "productive": True}] * 2, 100, 1)
    out.append(("vpin window and remainder", tail["buckets"] == 3 and tail["vpin"] == 0.0))
    out.append(("vpin empty", vpin([])["vpin"] == 0.0 and vpin([])["buckets"] == 0))
    out.append(("vpin defaults", vpin([{"productive": False}] * 2 + [{}] * 2, 2)["vpin"] == 0.375 and vpin([{"tokens": 0, "productive": False}], 1)["buckets"] == 1))
    out.append(("vpin one token", vpin([{"tokens": 1, "productive": False}], 1)["vpin"] == 0.75))
    out.append(("vpin splits across buckets", vpin([{"tokens": 300, "productive": True}])["buckets"] == 2))
    out.append(("vpin boundary inside an event", vpin([{"tokens": 100, "productive": True}, {"tokens": 150, "productive": True}])["buckets"] == 2))
    out.append(("vpin one token per event by default", vpin([{"productive": False}, {}, {}, {}], 4)["buckets"] == 1))
    out.append(("vpin boundary at 200", vpin([{"tokens": 200, "productive": True}, {"tokens": 200, "productive": False, "repeated_ngrams": 4}])["vpin"] == 0.5))
    out.append(("vpin window of 10", vpin([{"tokens": 200, "productive": False, "repeated_ngrams": 4}] * 2 + [{"tokens": 200, "productive": True}] * 10)["vpin"] == 0.0))
    third = vpin([{"tokens": 1, "productive": False, "repeated_ngrams": 4}, {"tokens": 2, "productive": True}], 3)
    out.append(("vpin rounds to 4", third["vpin"] == 0.3333 and third["ofi"] == 0.3333))
    try:
        vpin([], 0)
        out.append(("vpin refuses size 0", False))
    except ValueError:
        out.append(("vpin refuses size 0", True))
    return out


def oracle_reversal(ns, work):
    """ADR-150: the same expected answers as the JavaScript oracle for reversal.mjs."""
    plan_fn, tpl, hue, unknown = ns["reverse_and_correct_plan"], ns["reverse_and_correct_template"], ns["hue_of"], ns["UNKNOWN"]
    sha = lambda t: hashlib.sha256(t.encode("utf-8")).hexdigest()  # noqa: E731
    compact = lambda v: json.dumps(v, ensure_ascii=False, separators=(",", ":"))  # noqa: E731
    plan = [{"title": "Read the docs"}, {"title": "Pay the hosting invoice", "locked": False}, {"title": "Publish the site", "gate": "approval", "locked": True, "status": "done"},
            {"title": "Email the team", "gate": "approval", "locked": True, "status": "pending_approval"}, {"title": "Tidy", "gate": "Approval", "locked": True, "status": "pending_approval"}, "Grant admin access",
            {"title": "Tidy", "category": "money"}]
    r = plan_fn(plan)
    out = [("plan corrections", [(c["step"], c["category"]) for c in r["corrections"]] == [(1, "money"), (2, "publish"), (4, "outbound"), (5, "permissions"), (6, "money")])]
    out.append(("plan from", [c["from"] for c in r["corrections"]][:3] == [{"gate": None, "locked": False, "status": None}, {"gate": "approval", "locked": True, "status": "done"}, {"gate": "Approval", "locked": True, "status": "pending_approval"}]))
    out.append(("plan steps", all(s["gate"] == "approval" and s["locked"] is True and s["status"] == "pending_approval" and s["kind"] == "approval" for s in r["steps"][1:]) and r["steps"][0] == {"title": "Read the docs"}))
    out.append(("plan proof", r["proof"] == {"verified": True, "sensitive": 6, "locked": 6} and r["vector"]["values"] == [5, 0, 0, 0, 0] and r["changed"] is True))
    out.append(("plan hashes", r["before"] == sha(compact(plan)) and r["after"] == sha(compact(r["steps"])) and r["proofHash"] == sha(r["before"] + "\n" + r["after"] + "\n" + compact(r["corrections"]))))
    out.append(("plan fixed point", plan_fn(r["steps"])["corrections"] == [] and plan_fn(r["steps"])["changed"] is False))
    big = [{"title": "s%d" % i} for i in range(25)]
    out.append(("plan cut", len(plan_fn(big)["steps"]) == 20 and plan_fn(big)["before"] == sha(compact(big[:20])) and plan_fn(None)["steps"] == []))
    out.append(("plan one", plan_fn([{"title": "Pay rent"}])["changed"] is True and plan_fn([{"title": "x", "status": "pending_approval", "locked": True}])["corrections"][0]["category"] == "outbound"))
    out.append(("plan titles", plan_fn([{"name": "Pay"}, {"description": "Pay"}, {}, {"title": "  "}, {"title": "y" * 200}])["steps"][2]["title"] == "Step 3" and plan_fn([{"title": "y" * 200}])["steps"][0]["title"] == "y" * 140
                and [s["title"] for s in plan_fn([{"name": "a"}, {"description": "b"}, {"title": "  "}])["steps"]] == ["a", "b", "Step 3"]))
    out.append(("plan text fields", [c["category"] for c in plan_fn([{"title": "x", "description": "pay"}, {"title": "x", "kind": "deploy"}, {"title": "x", "tool": "slack"}, {"title": "x", "category": "install"}])["corrections"]] == ["money", "publish", "outbound", "install"]))
    out.append(("vector", ns["correction_vector"]([{"rule": "gradient"}, {"rule": "overflow-wrap"}, {"rule": "gradient"}])["values"] == [0, 0, 2, 0, 1]))
    hues = [("#0000ff", 240), ("#00f", 240), ("#ff0000", 0), ("#00ff00", 120), ("#800080", 300), ("#3b82f6", 217), ("#8b5cf6", 258), ("#ffff00", 60), ("#00ffff", 180), ("#ff8000", 30), ("#ff0080", 330),
            ("#808080", None), ("#808087", None), ("#808088", 240), ("#ff8040", 20), ("#40ff80", 140), ("#8040ff", 260), ("rgb(0, 0, 255)", 240), ("rgba(128,0,128,.5)", 300), ("hsl(280 50% 50%)", 280),
            ("hsla(-40, 50%, 50%)", 320), ("hsl(400 1% 1%)", 40), ("oklch(54.5% 0.197 257.4)", 235), ("oklch(50% 0.01 250)", None), ("oklch(50% 0.02 22)", 0), ("oklch(50% 0.2 10)", 348),
            ("oklch(50% 0.2 400)", 18), ("oklch(50% 0.2 -400)", 298), ("lch(50% 0 300)", 278), ("blue", 240), ("Purple", 300), ("white", None)]
    out.append(("hues", all(hue(c) == h for c, h in hues) and hue("to") is unknown and hue("#12345") is unknown))
    out.append(("colours", ns["gradient_colours"]("linear-gradient(to right, #fff, rgb(1, 2, 3) 40%, blue)") == ["#fff", "rgb(1, 2, 3)", "blue"]))
    t = tpl(".hero { background: linear-gradient(135deg, #3b82f6, #8b5cf6) }\n.bar, .nav { backdrop-filter: blur(16px) }\n.c { border-image: linear-gradient(red, orange) 1; color: red }\n.d{background-image:radial-gradient(teal,navy)}")
    out.append(("template rules", [c["rule"] for c in t["corrections"]] == ["ai-gradient", "gradient", "gradient", "reduced-transparency", "overflow-wrap"] and t["vector"]["values"] == [0, 1, 2, 1, 1] and t["html"] is False))
    out.append(("template text", t["text"] == ".hero { background-color: #3b82f6 }\n.bar, .nav { backdrop-filter: blur(16px) }\n.c { border-image: none; color: red }\n.d{background-color:teal}\n@media (prefers-reduced-transparency: reduce) {\n  .bar, .nav { -webkit-backdrop-filter: none; backdrop-filter: none; background-color: Canvas; color: CanvasText; }\n}\n" + ns["WRAP_RULE"] + "\n"))
    out.append(("template details", t["corrections"][0]["property"] == "background" and t["corrections"][0]["to"] == "#3b82f6" and t["corrections"][1]["from"] == "linear-gradient(red, orange) 1" and t["corrections"][3]["selectors"] == [".bar", ".nav"]))
    out.append(("template hashes", t["before"] != t["after"] and t["after"] == sha(t["text"]) and t["proofHash"] == sha(t["before"] + "\n" + t["after"] + "\n" + compact(t["corrections"]))))
    out.append(("template fixed point", tpl(t["text"])["changed"] is False))
    out.append(("no colour stop", tpl("a{background:linear-gradient(to right, 10%, 20%)}")["text"].startswith("a{background-color:transparent}")))
    out.append(("no declaration", [c["rule"] for c in tpl("x linear-gradient(red, blue)")["corrections"]] == ["overflow-wrap"]))
    out.append(("gradient at the end", tpl("a:linear-gradient(red,blue)")["text"].startswith("a:none\n") and tpl(";a:linear-gradient(red,blue)")["text"].startswith(";a:none\n") and tpl("x;b:linear-gradient(red,blue)")["text"].startswith("x;b:none\n")))
    out.append(("from is cut at 200", len(tpl("a{background:linear-gradient(red," + " " * 300 + "blue)}")["corrections"][0]["from"]) == 200))
    gs = ns["glass_selectors"]
    out.append(("glass", gs(".a{backdrop-filter:blur(4px)} .b{backdrop-filter:none} @media (prefers-reduced-transparency: reduce){.c{backdrop-filter:none}} .c{-webkit-backdrop-filter:blur(2px)} .a{backdrop-filter:blur(1px)}") == [".a"]
                and gs(".x{color:red}") == [] and gs("x{ backdrop-filter : saturate(2)}") == ["x"] and gs("@font-face{backdrop-filter:blur(1px)} a;b{backdrop-filter:blur(1px)}") == ["b"]))
    blocks = ns["css_blocks"]("@media (prefers-reduced-transparency: reduce) { .a { x: 1 } } b{y:2} } c{")
    out.append(("blocks", [(b["selector"], b["body"], b["fallback"]) for b in blocks] == [(".a", " x: 1 ", True), ("b", "y:2", False)]))
    out.append(("blocks nested and after }", [(b["selector"], b["body"]) for b in ns["css_blocks"]("a { b { c: 1 } }a{}b{y:2}")] == [("b", " c: 1 "), ("a", ""), ("b", "y:2")]))
    out.append(("declared locks", [c["category"] for c in plan_fn([{"title": "x", "gate": "approval"}, {"title": "y", "locked": True}])["corrections"]] == ["outbound", "outbound"]))
    ai = ns["is_ai_gradient"]
    out.append(("ai gradient edges", ai("linear-gradient(hsl(190 50% 50%), purple)") and ai("linear-gradient(hsl(254 5% 5%), hsl(255 5% 5%))") and not ai("linear-gradient(white, purple)")
                and not ai("linear-gradient(hsl(255 5% 5%), hsl(300 5% 5%))") and not ai("linear-gradient(hsl(220 5% 5%), hsl(320 5% 5%))") and not ai("linear-gradient(hsl(189 5% 5%), hsl(300 5% 5%))")))
    out.append(("css of edges", ns["css_of"]("<style<style>a{}</style><p>") == "a{}" and ns["css_of"]("<style>x<style></style><p>") == "x<style>"))
    wrap = ns["WRAP_RULE"]
    out.append(("html head", tpl("<html><head></head><body><p>x</p></body></html>")["text"] == "<html><head><style>\n" + wrap + "\n</style>\n</head><body><p>x</p></body></html>"))
    out.append(("html last style", tpl("<STYLE>a{x:1}</STYLE><style>b{y:2}</style><p>x</p>")["text"] == "<STYLE>a{x:1}</STYLE><style>b{y:2}" + wrap + "\n</style><p>x</p>"))
    out.append(("html no head", tpl("<div>x</div>")["text"] == "<style>\n" + wrap + "\n</style>\n<div>x</div>" and tpl("<p>x</p></head>")["text"].startswith("<p>x</p><style>\n")))
    out.append(("style at 0", tpl("</style><p>x</p>")["text"].startswith(":where(")))
    out.append(("css of", ns["css_of"]("<styles>a</styles><style media=x>b{}</style><style>c{}</style><style>d") == "b{}\nc{}" and ns["css_of"]("a{}") == "a{}"))
    out.append(("wrap present", tpl("<style>p{overflow-wrap: anywhere}</style><p>x</p>")["changed"] is False and tpl("p{overflow-wrap:anywhere}")["changed"] is False))
    out.append(("empty", tpl("")["changed"] is False and tpl("   ")["changed"] is False and tpl(None)["text"] == "" and len(tpl("a{}")["corrections"]) == 1))
    out.append(("long input cut", len(tpl("a" * 200005)["text"]) == 200000 + 2 + len(wrap)))
    return out


TARGETS = [
    {"file": ".claude/skills/replica-long-horizon/gate.py", "functions": ["judge"], "oracle": oracle_gate, "with": [".claude/skills/replica-long-horizon/lhcommon.py"]},
    {"file": ".claude/skills/replica-formal-verify/state_prover.py", "functions": ["plan_machine", "_search", "_path", "prove", "ui_completeness"], "oracle": oracle_prover, "with": []},
    {"file": ".claude/skills/replica-quantum-math/quantum_math.py", "functions": ["gf_mul", "gf_inv", "_eval", "split_secret_gf256", "reconstruct_secret_gf256", "compute_vpin_toxicity"], "oracle": oracle_quantum, "with": []},
    {"file": ".claude/skills/replica-reversal-engine/reversal_engine.py", "functions": ["correction_vector", "sealed", "reverse_and_correct_plan", "_rgb_hue", "hue_of", "gradient_colours", "is_ai_gradient", "_fix_gradients", "css_of", "css_blocks", "glass_selectors", "_add_css", "reverse_and_correct_template"], "oracle": oracle_reversal, "with": []},
]
# Mutants that cannot change any answer, each reviewed by hand; listed in the evidence, left out of the score.
EQUIVALENT = [
    {"file": "quantum_math.py", "function": "gf_mul", "kind": "constant 8 -> 9", "why": "b is below 256, so after eight right shifts it is 0 and a ninth pass adds nothing"},
    {"file": "reversal_engine.py", "function": "reverse_and_correct_plan", "kind": "bool And -> Or", "why": "the proof's and: every sensitive step has just been forced to a locked, pending approval, so each part is true and or gives the same"},
    {"file": "reversal_engine.py", "function": "_rgb_hue", "kind": "return None", "why": "the mutated line already returns None"},
    {"file": "reversal_engine.py", "function": "hue_of", "kind": "return None", "why": "the mutated line already returns None"},
    {"file": "reversal_engine.py", "function": "_rgb_hue", "kind": "constant 6 -> 7", "why": "when red is the largest, |g - b| <= d, so the quotient is in [-1, 1] and fmod by 6 or 7 leaves it unchanged"},
    {"file": "reversal_engine.py", "function": "hue_of", "kind": "constant 6 -> 7", "why": "h always has six characters, so h[4:7] equals h[4:6]"},
    {"file": "reversal_engine.py", "function": "gradient_colours", "kind": "arith Add -> Sub", "why": "the two extra characters are always 't(' from '-gradient(', and 't' is not a colour"},
    {"file": "reversal_engine.py", "function": "_fix_gradients", "kind": "constant 1 -> 2", "why": "the stop lists one item longer hold the same values at every index read"},
    {"file": "reversal_engine.py", "function": "css_of", "kind": "constant 7 -> 8", "why": "re.match anchors at the start, so one more character after '<style' and its space or '>' changes nothing"},
    {"file": "reversal_engine.py", "function": "css_of", "kind": "constant 0 -> 1", "why": "opened and close are at least 6 when found, so < 0 and < 1 agree"},
    {"file": "reversal_engine.py", "function": "css_of", "kind": "constant 1 -> 2", "why": "-2 instead of -1 for 'not found' still fails close < 0"},
    {"file": "reversal_engine.py", "function": "_add_css", "kind": "constant 0 -> 1", "why": "a </head> at index 0 puts the new style first, which is exactly what the last line does"},
    {"file": "quantum_math.py", "function": "reconstruct_secret_gf256", "kind": "constant True -> False", "why": "zip(strict=...) over shares and ys, which are built from the same list, so the lengths always match"},
]


class Timeout(Exception):
    pass


def _alarm(signum, frame):
    raise Timeout()


def run_oracle(path, oracle, work):
    signal.signal(signal.SIGALRM, _alarm)
    signal.alarm(3)
    try:
        ns = runpy.run_path(path, run_name="mutant")
        res = oracle(ns, work)
        return [name for name, ok in res if not ok]
    except Timeout:
        return ["timeout"]
    except Exception as e:
        return ["error: " + type(e).__name__]
    finally:
        signal.alarm(0)


def main():
    work = tempfile.mkdtemp(prefix="jarvis-pymutants-")
    rows = []
    try:
        for t in TARGETS:
            src_path = os.path.join(REPO, t["file"])
            with open(src_path, "rb") as fh:
                digest = hashlib.sha256(fh.read()).hexdigest()
            for extra in t["with"]:
                shutil.copy(os.path.join(REPO, extra), work)
            base = run_oracle(src_path, t["oracle"], work)
            if base:
                raise SystemExit(t["file"] + ": the oracle fails on the real code: " + ", ".join(base))
            rep, tree = ma.audit(src_path, [], 2000, t["functions"])
            killed, survived, equivalent = 0, [], []
            for k, p in enumerate(rep["mutants"]):
                mpath = os.path.join(work, f"m{k}_" + os.path.basename(t["file"]))
                with open(mpath, "w", encoding="utf-8") as fh:
                    fh.write(ma.ast.unparse(ma.mutate(tree, p["index"])) + "\n")
                failed = run_oracle(mpath, t["oracle"], work)
                os.remove(mpath)
                row = {"fn": p["function"], "line": p["line"], "kind": p["kind"]}
                eq = next((e for e in EQUIVALENT if t["file"].endswith(e["file"]) and e["function"] == p["function"] and e["kind"] == p["kind"]), None)
                if failed:
                    killed += 1
                elif eq:
                    equivalent.append({**row, "why": eq["why"]})
                else:
                    survived.append(row)
            n = len(rep["mutants"])
            score = round(100 * killed / (n - len(equivalent)), 1) if n - len(equivalent) else 100.0
            rows.append({"file": t["file"], "sha256": digest, "functions": t["functions"], "mutants": n, "killed": killed, "equivalent": len(equivalent),
                         "survived": len(survived), "score": score, "survivors": survived, "equivalents": equivalent})
            print(f"{t['file']}: {killed}/{n - len(equivalent)} killed ({score}%), {len(equivalent)} equivalent" + ("; survived: " + " | ".join(f"{s['fn']}:{s['line']} {s['kind']}" for s in survived) if survived else ""))
    finally:
        shutil.rmtree(work, ignore_errors=True)
    js_path = os.path.join(EVIDENCE, "mutation-js.json")
    with open(js_path, encoding="utf-8") as fh:
        js = json.load(fh)
    for t in js["targets"]:
        with open(os.path.join(REPO, t["file"]), "rb") as fh:
            if hashlib.sha256(fh.read()).hexdigest() != t["sha256"]:
                raise SystemExit(t["file"] + " changed after the JavaScript run; run mutation-harness.mjs again")
    targets = js["targets"] + rows
    total = sum(t["mutants"] - t["equivalent"] for t in targets)
    dead = sum(t["killed"] for t in targets)
    log = {"format": "jarvis-mutation-audit-v1", "ranAt": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"), "javascriptRanAt": js["ranAt"],
           "tools": ["jarvis/scripts/mutation-harness.mjs", "jarvis/scripts/mutation_harness.py", ".claude/skills/replica-formal-verify/mutation_audit.py"],
           "total": total, "killed": dead, "equivalent": sum(t["equivalent"] for t in targets), "score": round(100 * dead / total, 1) if total else 100.0, "targets": targets}
    body = json.dumps(log, ensure_ascii=False, indent=1)
    log["sha256"] = hashlib.sha256(body.encode("utf-8")).hexdigest()
    with open(os.path.join(EVIDENCE, "mutation-audit.log"), "w", encoding="utf-8") as fh:
        fh.write(json.dumps(log, ensure_ascii=False, indent=1) + "\n")
    print(f"All targets: {dead}/{total} mutants killed ({log['score']}%) · wrote jarvis/replica/evidence/mutation-audit.log")
    return 0 if dead == total else 1


if __name__ == "__main__":
    sys.exit(main())
