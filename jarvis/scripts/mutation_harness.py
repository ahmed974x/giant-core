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
    out.append(("plan proof", r["proof"] == {"verified": True, "sensitive": 6, "locked": 6} and r["vector"]["values"] == [5, 0, 0, 0, 0, 0] and r["changed"] is True))
    out.append(("plan hashes", r["before"] == sha(compact(plan)) and r["after"] == sha(compact(r["steps"])) and r["proofHash"] == sha(r["before"] + "\n" + r["after"] + "\n" + compact(r["corrections"]))))
    out.append(("plan fixed point", plan_fn(r["steps"])["corrections"] == [] and plan_fn(r["steps"])["changed"] is False))
    big = [{"title": "s%d" % i} for i in range(25)]
    out.append(("plan cut", len(plan_fn(big)["steps"]) == 20 and plan_fn(big)["before"] == sha(compact(big[:20])) and plan_fn(None)["steps"] == []))
    out.append(("plan one", plan_fn([{"title": "Pay rent"}])["changed"] is True and plan_fn([{"title": "x", "status": "pending_approval", "locked": True}])["corrections"][0]["category"] == "outbound"))
    out.append(("plan titles", plan_fn([{"name": "Pay"}, {"description": "Pay"}, {}, {"title": "  "}, {"title": "y" * 200}])["steps"][2]["title"] == "Step 3" and plan_fn([{"title": "y" * 200}])["steps"][0]["title"] == "y" * 140
                and [s["title"] for s in plan_fn([{"name": "a"}, {"description": "b"}, {"title": "  "}])["steps"]] == ["a", "b", "Step 3"]))
    out.append(("plan text fields", [c["category"] for c in plan_fn([{"title": "x", "description": "pay"}, {"title": "x", "kind": "deploy"}, {"title": "x", "tool": "slack"}, {"title": "x", "category": "install"}])["corrections"]] == ["money", "publish", "outbound", "install"]))
    out.append(("vector", ns["correction_vector"]([{"rule": "gradient"}, {"rule": "overflow-wrap"}, {"rule": "gradient"}])["values"] == [0, 0, 2, 0, 1, 0]))
    hues = [("#0000ff", 240), ("#00f", 240), ("#ff0000", 0), ("#00ff00", 120), ("#800080", 300), ("#3b82f6", 217), ("#8b5cf6", 258), ("#ffff00", 60), ("#00ffff", 180), ("#ff8000", 30), ("#ff0080", 330),
            ("#808080", None), ("#808087", None), ("#808088", 240), ("#ff8040", 20), ("#40ff80", 140), ("#8040ff", 260), ("rgb(0, 0, 255)", 240), ("rgba(128,0,128,.5)", 300), ("hsl(280 50% 50%)", 280),
            ("hsla(-40, 50%, 50%)", 320), ("hsl(400 1% 1%)", 40), ("oklch(54.5% 0.197 257.4)", 235), ("oklch(50% 0.01 250)", None), ("oklch(50% 0.02 22)", 0), ("oklch(50% 0.2 10)", 348),
            ("oklch(50% 0.2 400)", 18), ("oklch(50% 0.2 -400)", 298), ("lch(50% 0 300)", 278), ("blue", 240), ("Purple", 300), ("white", None)]
    out.append(("hues", all(hue(c) == h for c, h in hues) and hue("to") is unknown and hue("#12345") is unknown))
    out.append(("colours", ns["gradient_colours"]("linear-gradient(to right, #fff, rgb(1, 2, 3) 40%, blue)") == ["#fff", "rgb(1, 2, 3)", "blue"]))
    t = tpl(".hero { background: linear-gradient(135deg, #3b82f6, #8b5cf6) }\n.bar, .nav { backdrop-filter: blur(16px) }\n.c { border-image: linear-gradient(red, orange) 1; color: red }\n.d{background-image:radial-gradient(teal,navy)}")
    out.append(("template rules", [c["rule"] for c in t["corrections"]] == ["ai-gradient", "gradient", "gradient", "reduced-transparency", "overflow-wrap"] and t["vector"]["values"] == [0, 1, 2, 1, 1, 0] and t["html"] is False))
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
    # ADR-153: the contrast healer; the same pinned values as the JavaScript oracle.
    pcol, heal, ing, wr, apca, o2r, r2o = ns["parse_colour"], ns["heal_oklch_contrast"], ns["in_gamut"], ns["wcag_ratio"], ns["apca_lc"], ns["oklch_to_rgb"], ns["rgb_to_oklch"]
    near = lambda a, b, e=1e-9: abs(a - b) < e  # noqa: E731
    out.append(("parse", pcol("#3b82f6") == [59 / 255, 130 / 255, 246 / 255] and pcol("#ABC") == [170 / 255, 187 / 255, 204 / 255] and pcol("oklch(62.8% 0.258 29.23)") == [1, 0, 0]
                and all(near(a, b) for a, b in zip(pcol("oklch(0.5 0.1 30deg / 50%)"), [0.5791996905788112, 0.29441917659953204, 0.2511037850158516], strict=True))))
    out.append(("parse refused", all(pcol(x) is None for x in ["red", "#12345", "#1234567", "oklch(1.01 0 0)", "oklch(101% 0 0)", "oklch(50% -1 0)", "oklch(50% 0.1)", "rgb(1,2,3)", "", None, "oklch(. 0 0)", "oklch(50% . 30)", "oklch(50% 0.1 .)", "oklch(1.2.3 0 0)"])
                and pcol("oklch(100% 0 0)") is not None and pcol("oklch(0 0 0)") is not None and pcol(" #FFF ") is not None))
    out.append(("hex", ns["to_hex"]([0, 0.5, 1]) == "#0080ff" and ns["to_hex"]([-1, 2, 0.0019]) == "#00ff00"))
    lch = r2o([0.2, 0.4, 0.6])
    out.append(("to oklch", near(lch[0], 0.4993136, 1e-6) and near(lch[1], 0.0986640, 1e-6) and near(lch[2], 250.433054, 1e-5) and r2o([0.5, 0.5, 0.5])[2] == 0 and r2o([1, 0, 0.0001])[2] < 30))
    back, out1 = o2r([0.7, 0.1, 200]), o2r([0.9, 0.3, 30])
    out.append(("from oklch", back[1] is False and near(back[0][0], 0.25183094033414793) and near(back[0][2], 0.7170636897415913) and out1[1] is True and [round(x, 9) for x in out1[0]] == [1, 0.437732832, 0.327081834] and o2r([0, 0, 0]) == ([0.0, 0.0, 0.0], False) and o2r([1, 0, 0])[1] is False))
    g1, g2, g3, g4 = ing([0.9, 0.3, 30]), ing([0.5, 0.05, 120]), ing([0.85, 0.35, 140]), ing([0.6, 0.4, 300])
    out.append(("gamut", g1[2] is True and near(g1[1], 0.052290344238281244) and g2[2] is False and g2[1] == 0.05 and near(g3[1], 0.27363510131835933, 1e-15) and near(g4[1], 0.25833740234375, 1e-15)))
    out.append(("wcag", near(wr([0.2, 0.4, 0.6], [1, 1, 1]), 5.997786839657083) and near(wr([1, 1, 1], [0, 0, 0]), 21) and wr([0.04] * 3, [0.04] * 3) == 1))
    out.append(("apca", near(apca([0.2, 0.4, 0.6], [1, 1, 1]), 79.75762881805088) and near(apca([1, 1, 1], [0.2, 0.4, 0.6]), -84.96234789479297) and near(apca([0] * 3, [0.4] * 3), 25.312252871521167) and near(apca([0.4] * 3, [0] * 3), -23.043559570042547)
                and near(apca([0.42] * 3, [0.5] * 3), 7.413229674736765) and apca([0.43] * 3, [0.5] * 3) == 0 and near(apca([0.5] * 3, [0.43] * 3), -7.384386752464361) and apca([0.435] * 3, [0.5] * 3) == 0 and apca([0] * 3, [0.2] * 3) == 0 and apca([0.2] * 3, [0] * 3) == 0 and apca([0.5] * 3, [0.52, 0.5, 0.5]) == 0))
    want = [("#777777", "#ffffff", {}, "darker", "#767676", 4.48, 71.11, 4.54, 71.57, "oklch(56.75% 0 0)", False, (4.5, 60)), ("#777777", "#000000", {}, "lighter", "#b1b1b1", 4.69, -30.56, 9.79, -60.1, "oklch(75.88% 0 0)", False, (4.5, 60)),
            ("oklch(55% 0.2 260)", "#090b10", {}, "lighter", "#84b2ff", 3.92, -27.54, 9.18, -60.05, "oklch(76.2% 0.122 260)", True, (4.5, 60)), ("#ff0000", "#00ff00", {}, "darker", "#bf0000", 2.91, 44.61, 4.76, 60.02, "oklch(50.63% 0.208 29.2)", True, (4.5, 60)),
            ("#949494", "#ffffff", {"large": True}, "darker", "#8e8e8e", 3.03, 57.14, 3.28, 60.12, "oklch(64.84% 0 0)", False, (3, 60)), ("#767676", "#ffffff", {"min_lc": 80}, "darker", "#636363", 4.54, 71.57, 6.01, 80.05, "oklch(50.15% 0 0)", False, (4.5, 80)),
            ("#888", "#fff", {"min_lc": 0}, "darker", "#767676", 3.54, 63.06, 4.54, 71.57, "oklch(56.75% 0 0)", False, (4.5, 0))]
    for f, b, kw, d, hx, br, bl, ar, al, ok_, cr, tg in want:
        r = heal(f, b, **kw)
        good = r["ok"] and r["changed"] and r["steps"] == 16 and r["direction"] == d and r["after"]["hex"] == hx and (r["before"]["ratio"], r["before"]["lc"], r["after"]["ratio"], r["after"]["lc"]) == (br, bl, ar, al) and r["after"]["oklch"] == ok_ and r["chromaReduced"] is cr and (r["target"]["ratio"], r["target"]["lc"]) == tg
        fg = pcol(r["after"]["hex"])
        out.append(("heal " + f + b, good and wr(fg, pcol(b)) >= tg[0] and abs(apca(fg, pcol(b))) >= tg[1]))
    out.append(("lightness", near(heal("#777777", "#ffffff")["lightness"], 0.5675425212028896, 1e-12) and near(heal("oklch(55% 0.2 260)", "#090b10")["lightness"], 0.7619605998706404, 1e-12)))
    up, down = heal("#808080", "#7a7a7a", large=True, min_lc=30), heal("#6f6f6f", "#777777", large=True, min_lc=30)
    out.append(("nearer wins", (up["direction"], up["after"]["hex"], down["direction"], down["after"]["hex"]) == ("lighter", "#d8d8d8", "darker", "#212121") and near(up["lightness"], 0.8807048888329371, 1e-12) and near(down["lightness"], 0.24985776946183672, 1e-12)))
    none = heal("#eef2f8", "#090b10")
    out.append(("heal none", none == {"ok": True, "changed": False, "steps": 0, "before": {"hex": "#eef2f8", "ratio": 17.52, "lc": -98.9, "oklch": "oklch(95.98% 0.009 258.3)"}, "after": {"hex": "#eef2f8", "ratio": 17.52, "lc": -98.9, "oklch": "oklch(95.98% 0.009 258.3)"}, "target": {"ratio": 4.5, "lc": 60}}))
    out.append(("heal impossible", heal("#808080", "#808080") == {"ok": False, "changed": False, "reason": "no-lightness-passes", "before": {"hex": "#808080", "ratio": 1, "lc": 0, "oklch": "oklch(59.99% 0 0)"}, "target": {"ratio": 4.5, "lc": 60}}
                and heal("x", "#fff") == {"ok": False, "changed": False, "reason": "not-a-colour"} and heal("#fff", "x")["reason"] == "not-a-colour"))
    out.append(("heal edges", heal("#767676", "#ffffff")["changed"] is False and heal("#777777", "#ffffff", min_lc=71.57)["after"]["hex"] == "#767676" and heal("#000", "#fff", min_lc=106)["ok"] is True and heal("#000", "#fff", min_lc=107)["ok"] is False))
    pc = tpl(".a { color: #777777; background-color: #ffffff }\n.b{background:#090b10;color:oklch(55% 0.2 260)}\n.c { color: #4b5563; background: #3b82f6 }\n.d{color:#777777;background:#ffffff}\n.d{color:#777777;background:#ffffff}\n.e{color:red;background:#fff}\n.f{color:#777777;background:url(x)}\n@media (prefers-reduced-transparency: reduce){.g{color:#777777;background:#fff}}\n.h{ color : #777777 ; background-color:#FFFFFF; overflow-wrap:anywhere}")
    out.append(("contrast text", pc["text"] == ".a { color: #767676; background-color: #ffffff }\n.b{background:#090b10;color:#84b2ff}\n.c { color: #4b5563; background: #3b82f6 }\n.d{color:#767676;background:#ffffff}\n.d{color:#767676;background:#ffffff}\n.e{color:red;background:#fff}\n.f{color:#777777;background:url(x)}\n@media (prefers-reduced-transparency: reduce){.g{color:#777777;background:#fff}}\n.h{ color : #767676 ; background-color:#FFFFFF; overflow-wrap:anywhere}"))
    out.append(("contrast corrections", [(c["selector"], c["from"], c["to"], c["background"], c["before"]["ratio"], c["after"]["lc"], c["steps"]) for c in pc["corrections"]] == [(".a", "#777777", "#767676", "#ffffff", 4.48, 71.57, 16), (".b", "oklch(55% 0.2 260)", "#84b2ff", "#090b10", 3.92, -60.05, 16), (".d", "#777777", "#767676", "#ffffff", 4.48, 71.57, 16), (".d", "#777777", "#767676", "#ffffff", 4.48, 71.57, 16), (".h", "#777777", "#767676", "#FFFFFF", 4.48, 71.57, 16)] and pc["vector"]["values"] == [0, 0, 0, 0, 0, 5]))
    out.append(("contrast cap", sum(1 for c in tpl(".a{color:#777;background:#fff}" * 51)["corrections"] if c["rule"] == "contrast") == 50 and tpl(".a{color:#777;background:#fff}" * 50)["text"].startswith(".a{color:#767676;background:#fff}" * 50)))
    out.append(("contrast html", tpl("<style>p{color:#777;background:#fff}</style><p>x</p>")["text"] == "<style>p{color:#767676;background:#fff}" + wrap + "\n</style><p>x</p>" and tpl(pc["text"])["corrections"] == [] and tpl(".x{color:#777777;border-color:#000000;overflow-wrap:anywhere}")["corrections"] == []))
    out.append(("contrast needs a color", tpl(".x{background:#ffffff; overflow-wrap:anywhere; border-color:#777777}")["corrections"] == []))
    out.append(("oklch text", ns["_oklch_text"]([0.5, 0.3004, 10.04]) == "oklch(50% 0.3 10)" and ns["_oklch_text"]([0.123456, 0.0995, 359.96]) == "oklch(12.35% 0.1 360)" and ns["_num"](2.0) == 2 and ns["_num"](2.5) == 2.5))
    out.append(("contrast describe", ns["describe"](pc["corrections"][0]) == "text colour in .a on #ffffff: #777777 -> #767676 (WCAG 4.48 -> 4.54, APCA Lc 71.11 -> 71.57)"))
    return out


def oracle_recon(ns, work):
    """ADR-152: the same expected answers as the JavaScript oracle for passive-recon.mjs."""
    nd, rd, ct, gh, st, rep, utc = ns["normalize_domain"], ns["parse_rdap"], ns["parse_ct"], ns["grade_headers"], ns["parse_security_txt"], ns["recon_report"], ns["utc_ms"]
    now = utc("2026-11-07T00:00:00Z")
    out = [("utc", now == 1794009600000 and utc("2027-03-01T23:59:59") == utc("2027-03-01T23:59:59Z") and utc("2027-01-01T00:00:00+03:00") == utc("2026-12-31T21:00:00Z") and utc("bad") is None and utc(None) is None and utc("2026-11-07") == now and utc("2026-11-07T00:00:00.5Z") == now + 500)]
    out.append(("iso", ns["iso"](now + 7) == "2026-11-07T00:00:00.007Z"))
    ok_names = ["Example.com", "a.b.example.com.", "https://X.example.org/p", "ab.co", "a.bc", "xn--mgbh0fb.xn--kgbechtv", "a-b.com", "x" * 63 + ".com", ("a" * 63 + ".") * 3 + "a" * 57 + ".com", "example.com/x/y"]
    out.append(("domains ok", [nd(x) for x in ok_names] == ["example.com", "a.b.example.com", "x.example.org", "ab.co", "a.bc", "xn--mgbh0fb.xn--kgbechtv", "a-b.com", "x" * 63 + ".com", ("a" * 63 + ".") * 3 + "a" * 57 + ".com", "example.com"]))
    bad = ["1.2.3.4", "localhost", "a..com", "-a.com", "a-.com", "a.c", "ab", "x" * 64 + ".com", ("a" * 63 + ".") * 3 + "a" * 58 + ".com", "a.com:80", "a_b.com", "a.c0m", "http://[", "", None, "a.xn--", "a.b-"]
    out.append(("domains refused", all(nd(x) is None for x in bad)))

    def ev(a, d):
        return {"eventAction": a, "eventDate": d}
    r1 = rd({"status": ["Client Transfer Prohibited", "x"], "secureDNS": {"delegationSigned": True}, "events": [ev("registration", "2000-01-01T00:00:00Z"), ev("expiration", "2026-12-07T00:00:00Z"), ev("last changed", "2020-01-01T00:00:00Z"), ev("expiration", "bad"), "x"], "nameservers": [{"ldhName": "NS1.X"}, {}, None]}, now)
    out.append(("rdap fields", r1 == {"statuses": ["client transfer prohibited", "x"], "dnssec": True, "registered": "2000-01-01T00:00:00.000Z", "expires": "2026-12-07T00:00:00.000Z", "daysLeft": 30, "nameservers": ["ns1.x"], "findings": [{"level": "medium", "id": "domain-expiring", "text": "The domain expires in 30 days."}]}))
    out.append(("rdap 31", rd({"status": ["servertransferprohibited"], "secureDNS": {"delegationSigned": True}, "events": [ev("expiration", "2026-12-08T00:00:00Z")]}, now)["findings"] == []))
    out.append(("rdap day 0", [f["text"] for f in rd({"status": ["clienttransferprohibited"], "secureDNS": {"delegationSigned": True}, "events": [ev("expiration", "2026-11-07T23:00:00Z")]}, now)["findings"]] == ["The domain expires in 0 days."]))
    out.append(("rdap expired", [(f["level"], f["id"], f["text"]) for f in rd({"status": ["client hold"], "secureDNS": {"delegationSigned": False}, "events": [ev("expiration", "2026-11-06T23:00:00Z")]}, now)["findings"]] ==
                [("high", "domain-expired", "The domain expired 1 days ago."), ("medium", "dnssec-off", "DNSSEC is off: the delegation is not signed."), ("high", "status-hold", "The domain is on hold and does not resolve."), ("low", "transfer-unlocked", "No transfer lock on the domain.")]))
    out.append(("rdap levels", [f["level"] for f in rd({"status": ["redemption period", "server hold"], "events": [ev("expiration", "2025-01-01T00:00:00Z")]}, now)["findings"]] == ["high", "low", "high", "high", "low"]))
    out.append(("rdap delete", any(f["id"] == "status-deleting" for f in rd({"status": ["pending delete"]}, now)["findings"]) and any(f["id"] == "status-hold" for f in rd({"status": ["serverHold"]}, now)["findings"])))
    out.append(("rdap missing", rd(None, now) == {"statuses": [], "dnssec": None, "registered": None, "expires": None, "daysLeft": None, "nameservers": [], "findings": [{"level": "high", "id": "rdap-missing", "text": "No RDAP record was returned."}]} and rd("x", now)["findings"][0]["id"] == "rdap-missing"))
    out.append(("rdap empty", [f["level"] + f["id"] for f in rd({"secureDNS": {"delegationSigned": "yes"}, "status": "x", "events": "x", "nameservers": "x"}, now)["findings"]] == ["lowrdap-no-expiry", "lowdnssec-unknown", "lowtransfer-unlocked"]))
    big = rd({"status": ["s%d" % i for i in range(25)], "events": [ev("x" if i < 50 else "expiration", "2030-01-01T00:00:00Z") for i in range(60)], "nameservers": [{"ldhName": "n%d" % i} for i in range(25)]}, now)
    out.append(("rdap caps", len(big["statuses"]) == 20 and len(big["nameservers"]) == 20 and big["expires"] is None and rd({"events": [ev("x" if i < 49 else "expiration", "2030-01-01T00:00:00Z") for i in range(50)]}, now)["expires"] == "2030-01-01T00:00:00.000Z"))

    def row(names, after, iss=None):
        return {"name_value": names, "not_after": after, "issuer_name": iss}
    c1 = ct([row("B.x.com\n*.x.com\n\n b.x.com ", "2026-11-20T23:59:59", "CA b"), row("*.com\n" + "y" * 254, "2026-11-01T00:00:00", "CA a"), row("z.x.com", "2026-11-21T00:00:01", "CA a"), row("w.x.com", "2026-11-21T00:00:00"), None, row(None, "bad", "")], now)
    out.append(("ct fields", c1 == {"certificates": 6, "nameCount": 5, "names": ["*.com", "*.x.com", "b.x.com", "w.x.com", "z.x.com"], "wildcards": ["*.com", "*.x.com"], "expired": 1, "active": 3, "expiringSoon": 1, "issuers": [{"name": "CA a", "count": 2}, {"name": "CA b", "count": 1}],
                                     "findings": [{"level": "high", "id": "ct-broad-wildcard", "text": "A wildcard covers a whole top-level domain: *.com"}, {"level": "low", "id": "ct-wildcards", "text": "Wildcard names on certificates: 2."}, {"level": "medium", "id": "ct-expiring", "text": "Certificates in use that expire within 14 days: 1."}]}))
    out.append(("ct 253", ct([row("y" * 253, "2030-01-01T00:00:00")], now)["nameCount"] == 1))
    five = ct([row("*.a.x\n*.b.x\n*.c.x\n*.d.x\n*.e.x", "2025-01-01T00:00:00")], now)
    out.append(("ct five", [(f["id"], f["level"]) for f in five["findings"]] == [("ct-many-wildcards", "medium"), ("ct-no-active", "medium")] and five["findings"][0]["text"] == "Wildcard names on certificates: 5."))
    out.append(("ct four", ct([row("*.a.x\n*.b.x\n*.c.x\n*.d.x", "2030-01-01T00:00:00")], now)["findings"][0]["id"] == "ct-wildcards"))
    nb = ct([row("a.x", "2026-11-07T00:00:00")], now)
    out.append(("ct now", (nb["active"], nb["expired"], nb["expiringSoon"]) == (1, 0, 1) and ct([row("a.x", "2026-11-21T00:00:00")], now)["expiringSoon"] == 0))
    many = [row("h%04d.x" % i, "2030-01-01T00:00:00", "I%d" % (i % 7)) for i in range(5001)]
    c2 = ct(many, now)
    out.append(("ct caps", c2["certificates"] == 5000 and c2["nameCount"] == 5000 and len(c2["names"]) == 200 and c2["names"][199] == "h0199.x" and c2["findings"][0] == {"level": "low", "id": "ct-truncated", "text": "Only the first 5000 certificates were read."} and [x["count"] for x in c2["issuers"]] == [715, 715, 714, 714, 714]))
    out.append(("ct exact", ct(many[:5000], now)["findings"] == [] and ct("x", now)["certificates"] == 0))
    out.append(("ct issuers", [x["name"] for x in ct([row("a", "", "Z"), row("a", "", "A"), row("a", "", "M")], now)["issuers"]] == ["A", "M", "Z"] and [x["name"] for x in ct([row("a", "", "A"), row("a", "", "Z"), row("a", "", "Z")], now)["issuers"]] == ["Z", "A"] and len(ct([row("a", "", "x" * 130)], now)["issuers"][0]["name"]) == 120))
    out.append(("ct dotted", all(f["id"] != "ct-broad-wildcard" for f in ct([row("*..com", "2030-01-01T00:00:00")], now)["findings"])))
    full = {"Content-Security-Policy": "default-src 'none'", "strict-transport-security": "max-age=31536000; includeSubDomains", "permissions-policy": "camera=()", "cross-origin-opener-policy": "same-origin", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer"}
    g = gh(full)
    out.append(("headers full", g["score"] == 100 and g["grade"] == "A" and [(c["header"], c["points"], c["max"], c["fix"], c["present"]) for c in g["checks"]] == [("content-security-policy", 30, 30, None, True), ("strict-transport-security", 20, 20, None, True), ("permissions-policy", 15, 15, None, True), ("cross-origin-opener-policy", 15, 15, None, True), ("x-content-type-options", 10, 10, None, True), ("referrer-policy", 10, 10, None, True)]))

    def pts(h, i=0):
        c = gh(h)["checks"][i]
        return "%s:%s" % (c["points"], c["fix"])
    out.append(("csp", [pts({"content-security-policy": v}) for v in ("script-src * 'unsafe-inline' 'unsafe-eval'", "default-src 'self' 'unsafe-eval'", "default-src 'self' 'unsafe-inline'", "default-src *", "script-src 'self'", "default-src x;img-src *", "a" * 1989 + " default-src", "a" * 1988 + " default-src")] == ["0:unsafe-inline", "22:unsafe-eval", "22:unsafe-inline", "22:wildcard-source", "24:no-default-src", "22:wildcard-source", "24:no-default-src", "30:None"]))
    out.append(("hsts", [pts({"strict-transport-security": v}, 1) for v in ("max-age=31536000", "max-age=31535999", "max-age=15552000", "max-age=15551999", "max-age=1", "max-age=0", 'max-age = "40000000"; includesubdomains', "preload")] == ["20:no-subdomains", "15:short-max-age", "15:short-max-age", "8:short-max-age", "8:short-max-age", "0:short-max-age", "20:None", "0:short-max-age"]))
    small = [("x-content-type-options", "nosniff", 4), ("x-content-type-options", "NoSniff", 4), ("x-content-type-options", "sniff", 4), ("referrer-policy", "origin, strict-origin", 5), ("referrer-policy", "unsafe-url", 5), ("referrer-policy", "origin", 5), ("referrer-policy", ",", 5), ("cross-origin-opener-policy", "same-origin-allow-popups", 3), ("cross-origin-opener-policy", "unsafe-none", 3), ("permissions-policy", "x", 2)]
    out.append(("small", [pts({k: v}, i) for k, v, i in small] == ["10:None", "10:None", "3:not-nosniff", "10:None", "0:weak-referrer", "5:weak-referrer", "5:weak-referrer", "10:weak-coop", "3:weak-coop", "15:None"]))
    base = {"content-security-policy": "default-src 'none'", "strict-transport-security": "max-age=31536000"}
    grades = [gh({**base, "permissions-policy": "x", "cross-origin-opener-policy": "same-origin", "referrer-policy": "no-referrer"})["grade"], gh({**base, "permissions-policy": "x", "cross-origin-opener-policy": "same-origin", "referrer-policy": "origin"})["grade"],
              gh({**base, "permissions-policy": "x", "x-content-type-options": "nosniff"})["grade"], gh({**base, "permissions-policy": "x", "referrer-policy": "origin"})["grade"], gh({**base, "referrer-policy": "no-referrer"})["grade"],
              gh({**base, "referrer-policy": "origin"})["grade"], gh({"content-security-policy": "default-src 'none'", "referrer-policy": "no-referrer"})["grade"], gh({"content-security-policy": "default-src 'none'", "x-content-type-options": "x"})["grade"]]
    out.append(("grades", grades == ["A", "B", "B", "C", "C", "D", "D", "F"]))
    out.append(("values", gh({"content-security-policy": ["default-src 'none'", "img-src x"]})["checks"][0]["value"] == "default-src 'none', img-src x" and len(gh({"permissions-policy": "a" * 400})["checks"][2]["value"]) == 300 and gh("x")["score"] == 0 and gh(None)["score"] == 0 and gh({"content-security-policy": "  "})["checks"][0]["fix"] == "missing"))
    good = st("Contact: mailto:a@x\r\nExpires: 2027-01-01T00:00:00Z\nEncryption: https://k\nCanonical: HTTPS://x/.well-known/security.txt", now)
    out.append(("sectxt good", good == {"present": True, "fields": {"contact": ["mailto:a@x"], "expires": ["2027-01-01T00:00:00Z"], "encryption": ["https://k"], "canonical": ["HTTPS://x/.well-known/security.txt"]}, "contacts": ["mailto:a@x"], "expires": "2027-01-01T00:00:00.000Z", "valid": True, "findings": []}))
    pgp = st("-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n# c\n#Contact: mailto:z\nnocolon\n:x\nx: y\nContact:tel:+1\nExpires: 2027-01-01T00:00:00+03:00\nEncryption: x\n-----BEGIN PGP SIGNATURE-----\niQEz\nContact: http://x\n-----END PGP SIGNATURE-----\nPolicy: https://p", now)
    out.append(("sectxt pgp", pgp["fields"] == {"x": ["y"], "contact": ["tel:+1"], "expires": ["2027-01-01T00:00:00+03:00"], "encryption": ["x"], "policy": ["https://p"]}))
    probs = st("Contact: http://a\nContact: HTTPS://b\nContact: mail\nExpires: 2026-11-06T23:59:59Z\nExpires: x\nCanonical: http://c", now)["findings"]
    out.append(("sectxt problems", [(f["level"], f["id"], f.get("value", "")) for f in probs] == [("medium", "sectxt-contact-http", "http://a"), ("medium", "sectxt-contact-uri", "mail"), ("medium", "sectxt-many-expires", ""), ("high", "sectxt-expired", ""), ("low", "sectxt-canonical-http", ""), ("low", "sectxt-no-encryption", "")]
                and st("Expires: 2026-11-06T23:59:59Z", now)["findings"][1]["text"] == "Expires is in the past: 2026-11-06" and st("Contact: a\nExpires: x\nExpires: y", now)["findings"][1]["text"] == "Expires appears 2 times; it must appear once."))
    out.append(("sectxt window", any(f["id"] == "sectxt-long-expiry" and f["level"] == "low" for f in st("Expires: 2027-11-08T00:00:01Z", now)["findings"]) and not any(f["id"] == "sectxt-long-expiry" for f in st("Expires: 2027-11-08T00:00:00Z", now)["findings"]) and not any(f["id"] == "sectxt-expired" for f in st("Expires: 2026-11-07T00:00:00Z", now)["findings"])))
    out.append(("sectxt dates", [sum(1 for f in st("Expires: " + x, now)["findings"] if f["id"] == "sectxt-bad-expires") for x in ("2027-01-01", "2027-01-01T00:00", "2027-01-01T00:00Z", "2027-13-01T00:00:00Z", " 2027-01-01T00:00:00Z")] == [1, 1, 0, 1, 0]
                and next(f for f in st("Expires: nope", now)["findings"] if f["id"] == "sectxt-bad-expires")["text"] == "Expires is not an ISO 8601 date and time: nope"))
    out.append(("sectxt missing", st(None, now) == {"present": False, "fields": {}, "contacts": [], "expires": None, "valid": False, "findings": [{"level": "high", "id": "sectxt-missing", "text": "No security.txt at /.well-known/security.txt."}]} and [f["level"] + f["id"] for f in st("", now)["findings"]] == ["highsectxt-no-contact", "highsectxt-no-expires", "lowsectxt-no-encryption"] and st("", now)["present"] is True))
    out.append(("sectxt caps", len(st("\n".join("Contact: mailto:%d" % i for i in range(25)), now)["contacts"]) == 20 and len(st("Policy: " + "p" * 400, now)["fields"]["policy"][0]) == 300 and st("x" * 32760 + "\nContact: mailto:a", now)["contacts"] == [] and len(st("x" * 32740 + "\nContact: mailto:a", now)["contacts"]) == 1))
    out.append(("sectxt valid with lows", st("Contact: mailto:a\nExpires: 2027-01-01T00:00:00Z", now)["valid"] is True))
    r = rep("x.example", now, rdap=None, headers={})
    out.append(("report", r["at"] == "2026-11-07T00:00:00.000Z" and r["ct"] is None and r["securityTxt"] is None and r["rdap"]["findings"][0]["id"] == "rdap-missing" and r["headers"]["score"] == 0 and r["counts"] == {"high": 1, "medium": 0, "low": 0}))
    out.append(("headers file", ns["read_headers"]("X-A: 1\nbad\n: x\nB:2") == {"x-a": "1", "b": "2"}))
    return out


TARGETS = [
    {"file": ".claude/skills/replica-long-horizon/gate.py", "functions": ["judge"], "oracle": oracle_gate, "with": [".claude/skills/replica-long-horizon/lhcommon.py"]},
    {"file": ".claude/skills/replica-formal-verify/state_prover.py", "functions": ["plan_machine", "_search", "_path", "prove", "ui_completeness"], "oracle": oracle_prover, "with": []},
    {"file": ".claude/skills/replica-quantum-math/quantum_math.py", "functions": ["gf_mul", "gf_inv", "_eval", "split_secret_gf256", "reconstruct_secret_gf256", "compute_vpin_toxicity"], "oracle": oracle_quantum, "with": []},
    {"file": ".claude/skills/replica-passive-recon/passive_recon.py", "functions": ["utc_ms", "iso", "normalize_domain", "parse_rdap", "parse_ct", "grade_headers", "parse_security_txt", "recon_report", "read_headers"], "oracle": oracle_recon, "with": []},
    {"file": ".claude/skills/replica-reversal-engine/reversal_engine.py", "functions": ["correction_vector", "sealed", "reverse_and_correct_plan", "_rgb_hue", "hue_of", "gradient_colours", "is_ai_gradient", "_fix_gradients", "css_of", "css_blocks", "glass_selectors", "_add_css", "reverse_and_correct_template", "parse_colour", "to_hex", "rgb_to_oklch", "oklch_to_rgb", "in_gamut", "wcag_ratio", "apca_lc", "heal_oklch_contrast", "_fix_contrast", "_num", "_round2", "_oklch_text", "measure", "passes"], "oracle": oracle_reversal, "with": []},
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
    {"file": "passive_recon.py", "function": "utc_ms", "kind": "return None", "why": "the mutated line already returns None"},
    {"file": "passive_recon.py", "function": "normalize_domain", "kind": "return None", "why": "the mutated lines already return None"},
    {"file": "passive_recon.py", "function": "utc_ms", "kind": "constant 1 -> 2", "why": "s[-2:] in 'zZ' misses the Z, but datetime.fromisoformat reads a trailing Z itself since Python 3.11"},
    {"file": "passive_recon.py", "function": "normalize_domain", "kind": "constant 1 -> 2", "why": "split('/', 2)[0] is the same text as split('/', 1)[0]"},
    {"file": "passive_recon.py", "function": "normalize_domain", "kind": "constant 3 -> 4", "why": "the shortest name the label rules accept is four characters (a.bc)"},
    {"file": "reversal_engine.py", "function": "parse_colour", "kind": "return None", "why": "the mutated lines already return None"},
    {"file": "reversal_engine.py", "function": "heal_oklch_contrast", "kind": "return None", "why": "the mutated line (search finds nothing) already returns None"},
    {"file": "reversal_engine.py", "function": "passes", "kind": "constant 60 -> 61", "why": "every caller passes min_lc, so the default is never used"},
    {"file": "reversal_engine.py", "function": "rgb_to_oklch", "kind": "arith Add -> Sub", "why": "Python's % is never negative, so (h - 360) % 360 equals (h + 360) % 360"},
    {"file": "reversal_engine.py", "function": "apca_lc", "kind": "arith Sub -> Add", "why": "when |yb - yt| < 0.0005 or yb + yt < 0.0005, APCA's low-contrast clip returns 0 as well"},
    {"file": "reversal_engine.py", "function": "_fix_contrast", "kind": "constant 0 -> 1", "why": "for cursor and the not-found test: a rule body always follows its {, so it is never at index 0; a declaration starting with : has an empty property"},
    {"file": "reversal_engine.py", "function": "_fix_contrast", "kind": "constant 1 -> 2", "why": "-2 is as much 'no colour' as -1; and replacing up to two copies of the value changes nothing, since a value that parses as one colour holds one copy"},
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
