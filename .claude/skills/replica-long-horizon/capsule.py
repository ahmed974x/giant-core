#!/usr/bin/env python3
"""Verified state capsules for long tasks (replica-long-horizon). Standard library only.

    python3 capsule.py save WORKDIR --label NAME [--files PATH...] [--with-content] [--root REPO]
    python3 capsule.py list WORKDIR
    python3 capsule.py show WORKDIR SEQ
    python3 capsule.py verify WORKDIR [--root REPO]        # every hash, the chain, and drift since each
    python3 capsule.py restore WORKDIR SEQ --yes [--files] [--root REPO]

A capsule holds the three plan files in full, the git branch and commit (read from .git, no command
run), and each listed file's SHA-256 (plus its content with --with-content, 2 MB cap per capsule).
hash = SHA-256 of the capsule's canonical JSON without "hash"; prev_hash is the hash of the capsule
before it (64 zeros for the first). Editing any capsule breaks verify.
"""

import argparse
import base64
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lhcommon import (
    FINDINGS,
    PLAN,
    PROGRESS,
    LHError,
    canonical,
    git_position,
    inside,
    log_progress,
    need_workdir,
    now,
    read,
    sha256_bytes,
    sha256_file,
    write,
)

FORMAT = "long-horizon-capsule-v1"
ZERO = "0" * 64
MAX_CONTENT = 2 * 1024 * 1024


def cap_dir(w):
    return os.path.join(w, "capsules")


def load_all(w):
    d = cap_dir(w)
    if not os.path.isdir(d):
        return []
    out = []
    for name in sorted(f for f in os.listdir(d) if f.endswith(".json")):
        with open(os.path.join(d, name), encoding="utf-8") as fh:
            out.append((name, json.load(fh)))
    return out


def seal(c):
    body = {k: v for k, v in c.items() if k != "hash"}
    return sha256_bytes(canonical(body))


def save(w, label, files, with_content, root):
    need_workdir(w)
    if not label or len(label) > 60 or not all(ch.isalnum() or ch in "-_." for ch in label):
        raise LHError("Use a short label of letters, digits, - _ or . (at most 60).")
    caps = load_all(w)
    prev = caps[-1][1] if caps else None
    entries, budget = [], MAX_CONTENT
    for rel in files or []:
        p = inside(root, rel)
        if not p:
            raise LHError(f"{rel} is outside the repository root.")
        if not os.path.isfile(p):
            raise LHError(f"{rel} is not a file.")
        e = {"path": os.path.relpath(p, os.path.realpath(root)).replace(os.sep, "/"), "sha256": sha256_file(p), "bytes": os.path.getsize(p)}
        if with_content:
            if e["bytes"] > budget:
                raise LHError(f"Content would pass the 2 MB cap at {rel}; save fewer files or without --with-content.")
            with open(p, "rb") as fh:
                e["content_b64"] = base64.b64encode(fh.read()).decode("ascii")
            budget -= e["bytes"]
        entries.append(e)
    c = {
        "format": FORMAT,
        "seq": (prev["seq"] + 1) if prev else 1,
        "label": label,
        "ts": now(),
        "git": git_position(root),
        "plan": {name: read(os.path.join(w, name)) for name in (PLAN, FINDINGS, PROGRESS)},
        "files": entries,
        "prev_hash": prev["hash"] if prev else ZERO,
    }
    c["hash"] = seal(c)
    os.makedirs(cap_dir(w), exist_ok=True)
    name = f"{c['seq']:04d}-{label}.json"
    write(os.path.join(cap_dir(w), name), json.dumps(c, indent=2, ensure_ascii=False) + "\n")
    log_progress(w, f"Capsule #{c['seq']} {label} saved ({c['hash'][:12]}…).")
    return c, name


def verify(w, root):
    """Problems (empty when the chain is intact) and per-capsule drift of saved files."""
    problems, drift = [], {}
    prev = ZERO
    for i, (name, c) in enumerate(load_all(w)):
        if c.get("format") != FORMAT:
            problems.append(f"{name}: unknown format")
        if c.get("seq") != i + 1:
            problems.append(f"{name}: sequence is {c.get('seq')}, expected {i + 1}")
        if c.get("prev_hash") != prev:
            problems.append(f"{name}: prev_hash does not match the capsule before it")
        if seal(c) != c.get("hash"):
            problems.append(f"{name}: hash does not match its content (edited after saving)")
        for e in c.get("files", []):
            if "content_b64" in e and sha256_bytes(base64.b64decode(e["content_b64"])) != e["sha256"]:
                problems.append("{}: saved content of {} does not match its hash".format(name, e["path"]))
            p = inside(root, e["path"])
            now_hash = sha256_file(p) if p and os.path.isfile(p) else None
            if now_hash != e["sha256"]:
                drift.setdefault(c.get("seq"), []).append(e["path"] + (" (missing)" if now_hash is None else " (changed)"))
        prev = c.get("hash")
    return problems, drift


def restore(w, seq, with_files, root):
    problems, _ = verify(w, root)
    if problems:
        raise LHError("The chain does not verify, so nothing was restored: " + "; ".join(problems))
    caps = {c["seq"]: c for _, c in load_all(w)}
    if seq not in caps:
        raise LHError(f"No capsule #{seq}.")
    c = caps[seq]
    # progress.md stays append-only: it keeps every line and records the restore below.
    for name in (PLAN, FINDINGS):
        write(os.path.join(w, name), c["plan"][name])
    restored = []
    if with_files:
        for e in c["files"]:
            if "content_b64" not in e:
                continue
            p = inside(root, e["path"])
            if not p:
                raise LHError("{} would leave the repository root.".format(e["path"]))
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "wb") as fh:
                fh.write(base64.b64decode(e["content_b64"]))
            restored.append(e["path"])
    log_progress(w, f"Restored capsule #{seq} {c['label']}" + (f" and {len(restored)} files" if restored else "") + ".")
    return c, restored


def main(argv=None):
    ap = argparse.ArgumentParser(description="SHA-256 chained state capsules")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("save")
    p.add_argument("workdir")
    p.add_argument("--label", required=True)
    p.add_argument("--files", nargs="*", default=[])
    p.add_argument("--with-content", action="store_true")
    p.add_argument("--root", default=".")
    p = sub.add_parser("list")
    p.add_argument("workdir")
    p = sub.add_parser("show")
    p.add_argument("workdir")
    p.add_argument("seq", type=int)
    p = sub.add_parser("verify")
    p.add_argument("workdir")
    p.add_argument("--root", default=".")
    p = sub.add_parser("restore")
    p.add_argument("workdir")
    p.add_argument("seq", type=int)
    p.add_argument("--yes", action="store_true")
    p.add_argument("--files", action="store_true")
    p.add_argument("--root", default=".")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "save":
            c, name = save(a.workdir, a.label, a.files, a.with_content, a.root)
            print(f"saved {name}  #{c['seq']}  {c['hash']}")
        elif a.cmd == "list":
            for _name, c in load_all(a.workdir):
                print(f"#{c['seq']:<3d} {c['label']:<28s} {c['ts']}  {c['hash'][:12]}  {len(c['files'])} files")
        elif a.cmd == "show":
            c = {x["seq"]: x for _, x in load_all(a.workdir)}.get(a.seq)
            if not c:
                raise LHError(f"No capsule #{a.seq}.")
            view = dict(c, files=[{k: v for k, v in e.items() if k != "content_b64"} for e in c["files"]])
            print(json.dumps(view, indent=2, ensure_ascii=False))
        elif a.cmd == "verify":
            problems, drift = verify(a.workdir, a.root)
            n = len(load_all(a.workdir))
            for prob in problems:
                print("FAIL " + prob)
            for seq, paths in sorted(drift.items()):
                print(f"drift since #{seq}: " + ", ".join(paths))
            print(f"{n} capsules, chain " + ("intact" if not problems else "BROKEN"))
            return 1 if problems else 0
        elif a.cmd == "restore":
            if not a.yes:
                raise LHError("Restoring rewrites the three plan files%s. Add --yes to go ahead." % (" and the saved files" if a.files else ""))
            c, restored = restore(a.workdir, a.seq, a.files, a.root)
            print(f"restored #{c['seq']} {c['label']}" + ("; files: " + ", ".join(restored) if restored else ""))
        return 0
    except (LHError, OSError, ValueError, KeyError) as e:
        print(f"capsule: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
