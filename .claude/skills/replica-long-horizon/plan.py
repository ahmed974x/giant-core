#!/usr/bin/env python3
"""Persistent three-file planning for long tasks (replica-long-horizon). Standard library only.

    python3 plan.py init WORKDIR --goal "..." [--criteria "..."]...   # task_plan.md, findings.md, progress.md
    python3 plan.py log WORKDIR "what was done, what is next"          # append to progress.md
    python3 plan.py status WORKDIR [--json]                            # open tasks, unmet criteria, capsule age

Tasks are ticked only by gate.py, never by this tool.
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lhcommon import (
    FINDINGS,
    PLAN,
    PROGRESS,
    LHError,
    log_progress,
    need_workdir,
    now,
    parse_evidence,
    parse_plan,
    read,
    write,
)

PLAN_TMPL = """# Task plan: {goal}

Created: {ts}
Status: in progress

## Acceptance criteria

{criteria}

## Phases

### Phase 1: Understand
- [ ] T1: Read the code and the decision records this task touches {{gate: ; ac: }}

### Phase 2: Build
- [ ] T2: Make the change with its tests {{gate: tests, security; ac: {ac_all}}}

### Phase 3: Prove
- [ ] T3: Run every check and record the evidence {{gate: tests, contrast, security; ac: {ac_all}}}
"""

FINDINGS_TMPL = """# Findings: {goal}

Facts learned while working. Write them down the moment you learn them.

## Facts

## Decisions

## Evidence

One line per acceptance criterion, pointing at a file in backticks, for example:
- AC0: `evidence/tests.log` (example line; replace it)
"""

PROGRESS_TMPL = """# Progress: {goal}

Append-only. One line per step: what was done, what is next.

- {ts} Plan created.
"""


def cmd_init(a):
    os.makedirs(a.workdir, exist_ok=True)
    for name in (PLAN, FINDINGS, PROGRESS):
        if os.path.exists(os.path.join(a.workdir, name)):
            raise LHError(f"{name} already exists in {a.workdir}; it is never overwritten.")
    crit = a.criteria or ["The goal above is met and shown by evidence."]
    ts = now()
    criteria = "\n".join(f"- [ ] AC{i + 1}: {c.strip()}" for i, c in enumerate(crit))
    ac_all = ", ".join(f"AC{i + 1}" for i in range(len(crit)))
    write(os.path.join(a.workdir, PLAN), PLAN_TMPL.format(goal=a.goal.strip(), ts=ts, criteria=criteria, ac_all=ac_all))
    write(os.path.join(a.workdir, FINDINGS), FINDINGS_TMPL.format(goal=a.goal.strip()))
    write(os.path.join(a.workdir, PROGRESS), PROGRESS_TMPL.format(goal=a.goal.strip(), ts=ts))
    os.makedirs(os.path.join(a.workdir, "evidence"), exist_ok=True)
    print(f"wrote {PLAN}, {FINDINGS}, {PROGRESS} and evidence/ in {a.workdir}")
    return 0


def cmd_log(a):
    need_workdir(a.workdir)
    if not a.text.strip():
        raise LHError("Say what was done.")
    log_progress(a.workdir, a.text)
    print("logged")
    return 0


def status(w):
    need_workdir(w)
    tasks, criteria = parse_plan(read(os.path.join(w, PLAN)))
    evidence = parse_evidence(read(os.path.join(w, FINDINGS)))
    progress = [line for line in read(os.path.join(w, PROGRESS)).splitlines() if line.startswith("- ")]
    caps = sorted(f for f in os.listdir(os.path.join(w, "capsules")) if f.endswith(".json")) if os.path.isdir(os.path.join(w, "capsules")) else []
    last_cap = None
    if caps:
        with open(os.path.join(w, "capsules", caps[-1]), encoding="utf-8") as fh:
            c = json.load(fh)
        last_cap = {"seq": c.get("seq"), "label": c.get("label"), "ts": c.get("ts")}
    since = len([line for line in progress if last_cap and line[2:22] > (last_cap["ts"] or "")]) if last_cap else len(progress)
    # Heuristic, not a measurement: more steps since the last capsule means more to redo after a /clear.
    health = "good" if since <= 5 else "save a capsule soon" if since <= 12 else "save a capsule now"
    return {
        "tasks": {"total": len(tasks), "done": sum(t["done"] for t in tasks), "open": [t["id"] + ": " + t["text"] for t in tasks if not t["done"]]},
        "criteria": {"total": len(criteria), "with_evidence": [c["id"] for c in criteria if c["id"] in evidence], "missing_evidence": [c["id"] for c in criteria if c["id"] not in evidence]},
        "last_progress": progress[-1][2:] if progress else None,
        "last_capsule": last_cap,
        "steps_since_capsule": since,
        "context_health": health + " [INFERENCE: steps logged since the last capsule]",
    }


def cmd_status(a):
    s = status(a.workdir)
    if a.json:
        print(json.dumps(s, indent=2, ensure_ascii=False))
        return 0
    print(f"tasks     {s['tasks']['done']} of {s['tasks']['total']} done")
    for t in s["tasks"]["open"]:
        print("  open    " + t)
    missing = s["criteria"]["missing_evidence"]
    print(f"criteria  {len(s['criteria']['with_evidence'])} of {s['criteria']['total']} have evidence" + (" (missing: " + ", ".join(missing) + ")" if missing else ""))
    print("capsule   " + ("#{} {} at {}".format(s["last_capsule"]["seq"], s["last_capsule"]["label"], s["last_capsule"]["ts"]) if s["last_capsule"] else "none yet"))
    print(f"since     {s['steps_since_capsule']} logged steps · {s['context_health']}")
    print("last      " + (s["last_progress"] or "-"))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Three-file planning for long tasks")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("init")
    p.add_argument("workdir")
    p.add_argument("--goal", required=True)
    p.add_argument("--criteria", action="append")
    p = sub.add_parser("log")
    p.add_argument("workdir")
    p.add_argument("text")
    p = sub.add_parser("status")
    p.add_argument("workdir")
    p.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    try:
        return {"init": cmd_init, "log": cmd_log, "status": cmd_status}[a.cmd](a)
    except (LHError, OSError, ValueError) as e:
        print(f"plan: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
