"""Shared helpers for replica-hybrid-python. Standard library only: no network, no processes."""

import hashlib
import json
import os

PHI = (1 + 5 ** 0.5) / 2
SPACE = (4, 8, 12, 16, 20, 24, 32, 48)          # DESIGN.md spacing scale
LOCK_WORDS = ("pay", "payment", "invoice", "billing", "money", "transfer", "publish", "deploy", "release to", "go live",
              "permission", "grant", "access", "install", "plugin", "email", "send", "message", "webhook", "outbound",
              "دفع", "نشر", "صلاحي", "تثبيت", "أرسل", "ارسال", "بريد")


class HybridError(Exception):
    pass


def inside(root, path):
    base = os.path.realpath(root)
    p = os.path.realpath(os.path.join(base, path))
    return p if p == base or p.startswith(base + os.sep) else None


def read(root, path, limit=4 * 1024 * 1024):
    p = inside(root, path)
    if not p or not os.path.isfile(p):
        raise HybridError(f"{path} is not a file inside {root}.")
    if os.path.getsize(p) > limit:
        raise HybridError(f"{path} is larger than {limit // 1048576} MB.")
    with open(p, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def write(root, path, text):
    p = inside(root, path)
    if not p:
        raise HybridError(f"{path} would leave {root}.")
    os.makedirs(os.path.dirname(p) or ".", exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    return p


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha(s):
    return hashlib.sha256(s.encode("utf-8") if isinstance(s, str) else s).hexdigest()


def snap(px):
    """Nearest value on the 4/8 spacing scale."""
    return min(SPACE, key=lambda v: abs(v - px))


def locked(text):
    t = str(text).lower()
    return any(w in t for w in LOCK_WORDS)
