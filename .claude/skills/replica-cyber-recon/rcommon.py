"""Shared helpers for replica-cyber-recon. Standard library only: no network, no processes."""

import hashlib
import json
import math
import os
from collections import Counter

MAX_BYTES = 2 * 1024 * 1024
TEXT_EXT = {".py", ".js", ".mjs", ".cjs", ".ts", ".html", ".htm", ".css", ".json", ".md", ".txt", ".sql", ".yml", ".yaml", ".toml", ".env", ".ini", ".cfg", ".sh", ".ps1", ""}
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".data", "dist", "build"}


class ReconError(Exception):
    pass


def inside(root, path):
    """Absolute path of `path` if it stays under `root` after resolving symlinks, else None."""
    base = os.path.realpath(root)
    p = os.path.realpath(os.path.join(base, path))
    return p if p == base or p.startswith(base + os.sep) else None


def walk(root, paths):
    """Text files under the given paths (each must stay inside root)."""
    out = []
    for rel in paths:
        p = inside(root, rel)
        if not p or not os.path.exists(p):
            raise ReconError(f"{rel} is not inside {root} or does not exist.")
        if os.path.isfile(p):
            out.append(p)
            continue
        for d, dirs, files in os.walk(p):
            dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS)
            for f in sorted(files):
                if os.path.splitext(f)[1].lower() in TEXT_EXT:
                    out.append(os.path.join(d, f))
    return out


def read_text(path):
    if os.path.getsize(path) > MAX_BYTES:
        return None
    with open(path, "rb") as fh:
        data = fh.read()
    if b"\x00" in data[:4096]:
        return None
    return data.decode("utf-8", errors="replace")


def shannon(s):
    """Shannon entropy in bits per character."""
    if not s:
        return 0.0
    n = len(s)
    return -sum(c / n * math.log2(c / n) for c in Counter(s).values())


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def rel(root, path):
    return os.path.relpath(path, os.path.realpath(root)).replace(os.sep, "/")


def emit(obj, as_json):
    if as_json:
        print(json.dumps(obj, indent=2, ensure_ascii=False, sort_keys=True))
        return
    for f in obj.get("findings", []):
        print(f"{f['severity'].upper():8} {f['rule']:22} {f['file']}:{f['line']}  {f['message']}")
    s = obj.get("summary", {})
    print("summary " + ", ".join(f"{k} {v}" for k, v in sorted(s.items())))
