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


TARGETS = [
    {"file": ".claude/skills/replica-long-horizon/gate.py", "functions": ["judge"], "oracle": oracle_gate, "with": [".claude/skills/replica-long-horizon/lhcommon.py"]},
    {"file": ".claude/skills/replica-formal-verify/state_prover.py", "functions": ["plan_machine", "_search", "_path", "prove", "ui_completeness"], "oracle": oracle_prover, "with": []},
]
# Mutants that cannot change any answer, each reviewed by hand; listed in the evidence, left out of the score.
EQUIVALENT = []


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
