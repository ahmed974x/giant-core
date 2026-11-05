#!/usr/bin/env python3
"""Markov memory of layouts that passed the gates (replica-hybrid-python).

    python3 pattern_memory.py learn MEMORY.json nav,hero,features,faq,cta,footer --passed contrast,sizes [--root REPO]
    python3 pattern_memory.py suggest MEMORY.json [--start nav] [--length 6] [--root REPO]
    python3 pattern_memory.py score MEMORY.json nav,hero,cta,footer [--root REPO]

A layout is a sequence of section types. Each one learned adds weight to its transitions: 1 for a
layout that passed nothing, plus 1 per gate it passed (contrast, sizes, security, tests), so the
memory leans towards what has worked. suggest walks the most likely next section (Laplace-smoothed,
deterministic, no repeats, stops at footer); score is the average log-probability per step. The
memory is one JSON file you choose; it holds section names and counts only, never page text.
This is counting, not machine learning: suggestions are labelled [INFERENCE].
"""

import argparse
import json
import math
import sys
from itertools import pairwise

from hcommon import HybridError, inside, read, write

GATES = {"contrast", "sizes", "security", "tests"}
START, END = "^", "$"


def load(root, path):
    p = inside(root, path)
    if not p:
        raise HybridError(f"{path} would leave {root}.")
    try:
        mem = json.loads(read(root, path))
    except HybridError:
        mem = {"format": "pattern-memory-v1", "transitions": {}, "layouts": 0, "states": []}
    if mem.get("format") != "pattern-memory-v1":
        raise HybridError("Not a pattern-memory-v1 file.")
    return mem


def seq(text):
    s = [x.strip().lower() for x in str(text).split(",") if x.strip()]
    if not s or any(not x.replace("-", "").isalnum() or len(x) > 24 for x in s):
        raise HybridError("A layout is section names separated by commas (letters, digits, hyphens).")
    return s


def learn(mem, layout, passed):
    bad = set(passed) - GATES
    if bad:
        raise HybridError("Unknown gates: " + ", ".join(sorted(bad)))
    w = 1 + len(set(passed))
    path = [START, *layout, END]
    for a, b in pairwise(path):
        mem["transitions"].setdefault(a, {})
        mem["transitions"][a][b] = mem["transitions"][a].get(b, 0) + w
    mem["layouts"] += 1
    mem["states"] = sorted(set(mem["states"]) | set(layout))
    return mem


def prob(mem, a, b):
    row = mem["transitions"].get(a, {})
    vocab = len(mem["states"]) + 1
    return (row.get(b, 0) + 1) / (sum(row.values()) + vocab)


def suggest(mem, start=None, length=6):
    if not mem["states"]:
        raise HybridError("The memory is empty; learn a layout first.")
    out, cur = [], START
    if start:
        out, cur = [start], start
    while len(out) < length:
        options = [s for s in mem["states"] + [END] if s not in out]
        nxt = max(options, key=lambda s: (prob(mem, cur, s), s != END, s))
        if nxt == END:
            break
        out.append(nxt)
        cur = nxt
    return out


def score(mem, layout):
    path = [START, *layout, END]
    lp = [math.log(prob(mem, a, b)) for a, b in pairwise(path)]
    return sum(lp) / len(lp)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Markov memory of layouts that passed")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("learn")
    p.add_argument("memory")
    p.add_argument("layout")
    p.add_argument("--passed", default="")
    p = sub.add_parser("suggest")
    p.add_argument("memory")
    p.add_argument("--start")
    p.add_argument("--length", type=int, default=6)
    p = sub.add_parser("score")
    p.add_argument("memory")
    p.add_argument("layout")
    for s in sub.choices.values():
        s.add_argument("--root", default=".")
    a = ap.parse_args(argv)
    try:
        mem = load(a.root, a.memory)
        if a.cmd == "learn":
            learn(mem, seq(a.layout), [x for x in a.passed.split(",") if x])
            write(a.root, a.memory, json.dumps(mem, indent=1, sort_keys=True) + "\n")
            print(f"learned layout #{mem['layouts']}")
        elif a.cmd == "suggest":
            print(",".join(suggest(mem, a.start, a.length)) + "  [INFERENCE]")
        else:
            print(f"{score(mem, seq(a.layout)):.3f} mean log-probability per step")
    except HybridError as e:
        print(f"pattern_memory: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
