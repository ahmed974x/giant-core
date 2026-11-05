"""Shared helpers for replica-long-horizon. Standard library only, no network, no processes."""

import datetime
import hashlib
import json
import os
import re

PLAN, FINDINGS, PROGRESS = "task_plan.md", "findings.md", "progress.md"
TASK_RE = re.compile(r"^- \[( |x|X)\] (T\d+):\s*(.*?)\s*(?:\{([^}]*)\})?\s*$")
AC_RE = re.compile(r"^- \[( |x|X)\] (AC\d+):\s*(.*)$")
EVIDENCE_RE = re.compile(r"^- (AC\d+):\s*(.*)$")
CHECKS = ("tests", "contrast", "security", "lint", "approval")


class LHError(Exception):
    pass


def now():
    return datetime.datetime.now(datetime.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def write(path, text):
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def canonical(obj):
    """Stable JSON for hashing: sorted keys, no spaces, UTF-8."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def need_workdir(w):
    for name in (PLAN, FINDINGS, PROGRESS):
        if not os.path.isfile(os.path.join(w, name)):
            raise LHError(f"{w} has no {name}. Run: plan.py init {w} --goal ...")


def parse_plan(text):
    """Tasks and criteria from task_plan.md."""
    tasks, criteria, phase = [], [], None
    for i, line in enumerate(text.splitlines()):
        if line.startswith("### "):
            phase = line[4:].strip()
            continue
        m = TASK_RE.match(line)
        if m:
            meta = {"gate": [], "ac": []}
            for part in (m.group(4) or "").split(";"):
                if ":" in part:
                    k, v = part.split(":", 1)
                    k = k.strip().lower()
                    if k in meta:
                        meta[k] = [x.strip() for x in v.split(",") if x.strip()]
            tasks.append({"id": m.group(2), "done": m.group(1) != " ", "text": m.group(3), "phase": phase,
                          "gate": meta["gate"], "ac": meta["ac"], "line": i})
            continue
        m = AC_RE.match(line)
        if m:
            criteria.append({"id": m.group(2), "met": m.group(1) != " ", "text": m.group(3).strip(), "line": i})
    return tasks, criteria


def parse_evidence(text):
    """`- AC1: ... `path` ...` lines under '## Evidence' in findings.md."""
    out, inside = {}, False
    for line in text.splitlines():
        if line.startswith("## "):
            inside = line.strip().lower() == "## evidence"
            continue
        m = EVIDENCE_RE.match(line) if inside else None
        if m:
            out.setdefault(m.group(1), []).append({"text": m.group(2), "paths": re.findall(r"`([^`]+)`", m.group(2))})
    return out


def inside(root, path):
    """Absolute path of `path` if it stays inside `root` after resolving symlinks, else None."""
    real_root = os.path.realpath(root)
    p = os.path.realpath(os.path.join(root, path))
    return p if p == real_root or p.startswith(real_root + os.sep) else None


def git_position(root):
    """Branch and commit read from .git files; no git command is run."""
    g = os.path.join(root, ".git")
    if os.path.isfile(g):  # a worktree or submodule: "gitdir: path"
        target = read(g).strip()
        if target.startswith("gitdir:"):
            g = os.path.normpath(os.path.join(root, target[7:].strip()))
    head = os.path.join(g, "HEAD")
    if not os.path.isfile(head):
        return {"branch": None, "commit": None}
    ref = read(head).strip()
    if not ref.startswith("ref:"):
        return {"branch": None, "commit": ref[:40]}
    name = ref[4:].strip()
    commit = None
    loose = os.path.join(g, *name.split("/"))
    if os.path.isfile(loose):
        commit = read(loose).strip()[:40]
    else:
        packed = os.path.join(g, "packed-refs")
        if os.path.isfile(packed):
            for line in read(packed).splitlines():
                if line.endswith(" " + name):
                    commit = line.split(" ")[0][:40]
    return {"branch": name.replace("refs/heads/", ""), "commit": commit}


def log_progress(w, text):
    with open(os.path.join(w, PROGRESS), "a", encoding="utf-8", newline="\n") as fh:
        fh.write("- {} {}\n".format(now(), " ".join(str(text).split())))
