#!/usr/bin/env python3
"""Deterministic completion gate for long tasks (replica-long-horizon). Standard library only.

    python3 gate.py check WORKDIR --task T3 [--watch PATH...] [--root REPO] [--dry-run]
    python3 gate.py finish WORKDIR [--watch PATH...] [--root REPO] [--dry-run]

It never runs a command. The agent runs the real checks and saves their output in WORKDIR/evidence/;
the gate parses those files. A task passes only if:
  - every check the task names ({gate: tests, contrast, security, lint}) has at least one evidence
    file, and every such file passes;
  - every evidence file is newer than every watched file (else: stale, run the check again);
  - every acceptance criterion the task names ({ac: AC1, AC2}) has a line under "## Evidence" in
    findings.md whose backticked path exists.
A task with {gate: approval} never passes here: it waits for a person outside the task.
On a pass, check ticks the task in task_plan.md and logs the evidence hashes in progress.md.
finish passes only when every task is ticked, every criterion has evidence and all evidence is fresh;
then it ticks the criteria and sets "Status: complete". Exit 1 means not done.
"""

import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lhcommon import (
    FINDINGS,
    PLAN,
    LHError,
    inside,
    log_progress,
    need_workdir,
    parse_evidence,
    parse_plan,
    read,
    sha256_file,
    write,
)

PATTERNS = {"tests": "tests", "contrast": "contrast", "security": "security", "lint": "lint"}


def judge(check, path):
    """(ok, reason) for one evidence file."""
    text = read(path)
    if check == "tests":
        node = re.findall(r"(\d+) passed, (\d+) failed", text)
        unit = re.search(r"^Ran (\d+) tests? in", text, re.M)
        pyt = re.search(r"=+ (\d+) passed(?:, [^=]*)? in [\d.]+s", text)
        if node:
            p, f = map(int, node[-1])
            return (f == 0 and p > 0, f"{p} passed, {f} failed")
        if unit:
            ok = re.search(r"^OK\b", text, re.M) is not None and not re.search(r"^FAILED", text, re.M)
            return (ok and int(unit.group(1)) > 0, "Ran {} tests, {}".format(unit.group(1), "OK" if ok else "FAILED"))
        if pyt:
            bad = re.search(r"\b\d+ (failed|errors?)\b", pyt.group(0))
            return (not bad, pyt.group(0).strip("= "))
        return (False, "no test summary found (expected 'N passed, 0 failed', unittest 'Ran N tests … OK' or pytest)")
    if check == "contrast":
        fail = re.search(r"^\s*FAIL\b", text, re.M)
        good = "All pairs pass" in text or re.search(r"\b0 failing\b", text)
        return (bool(good) and not fail, "all pairs pass" if good and not fail else "a pair fails or no summary line")
    if check == "security":
        try:
            summary = json.loads(text)["summary"]
        except (ValueError, KeyError, TypeError):
            return (False, "not a SkillSpector --json report")
        c, h = int(summary.get("critical", -1)), int(summary.get("high", -1))
        return (c == 0 and h == 0, f"critical {c}, high {h}")
    if check == "lint":
        bad = re.search(r"^\s*(error|ERROR)\b", text, re.M)
        good = re.search(r"\b0 errors?\b|All checks passed!", text)
        return (bool(good) and not bad, "clean" if good and not bad else "errors found or no summary line")
    return (False, "unknown check")


def newest_watched(root, watch):
    newest, which = 0.0, None
    for rel in watch or []:
        p = inside(root, rel)
        if not p or not os.path.exists(p):
            raise LHError(f"Watched path {rel} does not exist inside the repository.")
        paths = [p] if os.path.isfile(p) else [os.path.join(d, f) for d, _, fs in os.walk(p) for f in fs if "__pycache__" not in d and "node_modules" not in d]
        for q in paths:
            m = os.path.getmtime(q)
            if m > newest:
                newest, which = m, q
    return newest, which


def evaluate(w, task, root, watch):
    rows = []
    ev_dir = os.path.join(w, "evidence")
    newest, which = newest_watched(root, watch)
    for check in task["gate"]:
        if check == "approval":
            rows.append(("approval", False, "needs Director 00's decision outside the task; carry on with independent tasks"))
            continue
        if check not in PATTERNS:
            rows.append((check, False, "unknown check (use tests, contrast, security, lint or approval)"))
            continue
        ext = ".json" if check == "security" else ".log"
        files = sorted(f for f in os.listdir(ev_dir) if f.startswith(PATTERNS[check]) and f.endswith(ext)) if os.path.isdir(ev_dir) else []
        if not files:
            rows.append((check, False, f"no evidence/{PATTERNS[check]}*{ext} file"))
            continue
        for f in files:
            p = os.path.join(ev_dir, f)
            ok, why = judge(check, p)
            if ok and os.path.getmtime(p) < newest:
                ok, why = False, f"stale: {os.path.relpath(which, root)} changed after this log; run the check again"
            rows.append((f"{check}:{f}", ok, why))
    evidence = parse_evidence(read(os.path.join(w, FINDINGS)))
    for ac in task["ac"]:
        lines = evidence.get(ac, [])
        paths = [x for line in lines for x in line["paths"]]
        found = [x for x in paths if os.path.exists(os.path.join(w, x)) or (inside(root, x) and os.path.exists(inside(root, x)))]
        rows.append((ac, bool(found), ("evidence: " + ", ".join(found)) if found else ("no evidence line under '## Evidence'" if not lines else "the evidence path does not exist")))
    return rows


def evidence_hashes(w):
    ev = os.path.join(w, "evidence")
    return {f: sha256_file(os.path.join(ev, f))[:16] for f in sorted(os.listdir(ev))} if os.path.isdir(ev) else {}


def tick(w, line_no):
    path = os.path.join(w, PLAN)
    lines = read(path).split("\n")
    lines[line_no] = lines[line_no].replace("- [ ]", "- [x]", 1)
    write(path, "\n".join(lines))


def cmd_check(a):
    need_workdir(a.workdir)
    tasks, _ = parse_plan(read(os.path.join(a.workdir, PLAN)))
    task = next((t for t in tasks if t["id"] == a.task), None)
    if not task:
        raise LHError(f"No task {a.task} in {PLAN}.")
    rows = evaluate(a.workdir, task, a.root, a.watch)
    for name, ok, why in rows:
        print(f"{'PASS' if ok else 'FAIL':<5s} {name:<28s} {why}")
    passed = all(ok for _, ok, _ in rows)
    if passed and not a.dry_run and not task["done"]:
        tick(a.workdir, task["line"])
        log_progress(a.workdir, "Gate passed {}: {}. Evidence {}".format(task["id"], task["text"], json.dumps(evidence_hashes(a.workdir), sort_keys=True)))
    print("{} {}".format(task["id"], "passes the gate" + ("" if a.dry_run else " and is ticked") if passed else "is NOT done"))
    return 0 if passed else 1


def cmd_finish(a):
    need_workdir(a.workdir)
    text = read(os.path.join(a.workdir, PLAN))
    tasks, criteria = parse_plan(text)
    rows = []
    for t in tasks:
        rows.append((t["id"], t["done"], "ticked" if t["done"] else "not ticked by the gate"))
    evidence = parse_evidence(read(os.path.join(a.workdir, FINDINGS)))
    for c in criteria:
        has = c["id"] in evidence
        rows.append((c["id"], has, "has evidence" if has else "no evidence line"))
    every_check = sorted({g for t in tasks for g in t["gate"] if g != "approval"})
    fresh = evaluate(a.workdir, {"gate": every_check, "ac": []}, a.root, a.watch)
    rows.extend(fresh)
    for name, ok, why in rows:
        print(f"{'PASS' if ok else 'FAIL':<5s} {name:<28s} {why}")
    passed = all(ok for _, ok, _ in rows)
    if passed and not a.dry_run:
        lines = text.split("\n")
        for c in criteria:
            lines[c["line"]] = lines[c["line"]].replace("- [ ]", "- [x]", 1)
        write(os.path.join(a.workdir, PLAN), "\n".join(lines).replace("Status: in progress", "Status: complete", 1))
        log_progress(a.workdir, "Finished: every task ticked, every criterion has evidence, all evidence fresh.")
    print("task " + ("COMPLETE" if passed else "NOT complete"))
    return 0 if passed else 1


def main(argv=None):
    ap = argparse.ArgumentParser(description="Evidence gate for long tasks")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("check", "finish"):
        p = sub.add_parser(name)
        p.add_argument("workdir")
        if name == "check":
            p.add_argument("--task", required=True)
        p.add_argument("--watch", nargs="*", default=[])
        p.add_argument("--root", default=".")
        p.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    try:
        return cmd_check(a) if a.cmd == "check" else cmd_finish(a)
    except (LHError, OSError, ValueError) as e:
        print(f"gate: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
