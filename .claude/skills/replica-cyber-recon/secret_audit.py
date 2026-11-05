#!/usr/bin/env python3
"""Find leaked keys and tokens in files (replica-cyber-recon). Standard library only.

    python3 secret_audit.py PATH... [--root REPO] [--json] [--min-entropy 3.5]

Known key shapes are matched by pattern; anything else that is assigned to a name like key, token,
secret or password is reported when the value is long and random enough (Shannon entropy). Matches
are printed redacted (first 4 characters only). A line with "secret-audit: ignore" is skipped.
Exit 1 when anything is found, 0 when clean, 2 on a usage error.
"""

import argparse
import re
import sys

from rcommon import ReconError, emit, read_text, rel, shannon, walk

# /* SKILLSPECTOR_RULES_START */  (the patterns below name the very shapes they look for)
KNOWN = [
    ("aws-access-key", "critical", r"\b(AKIA|ASIA)[0-9A-Z]{16}\b"),
    ("github-token", "critical", r"\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b"),
    ("slack-token", "critical", r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b"),
    ("stripe-live-key", "critical", r"\b(sk|rk)_live_[A-Za-z0-9]{16,}\b"),
    ("google-api-key", "critical", r"\bAIza[0-9A-Za-z_-]{35}\b"),
    ("anthropic-openai-key", "critical", r"\bsk-(ant-|proj-)?[A-Za-z0-9_-]{20,}\b"),
    ("private-key-block", "critical", r"-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY( BLOCK)?-----"),
    ("jwt", "high", r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
    ("url-credentials", "high", r"\b[a-z][a-z0-9+.-]*://[^\s/:@]{1,64}:[^\s/@]{6,}@[^\s/]+"),
]
ASSIGN = re.compile(r"""(?i)\b([a-z0-9_.-]*(api[_-]?key|secret|token|passw(or)?d|private[_-]?key|access[_-]?key|auth))\b\s*[:=]\s*["']([^"'\s]{16,})["']""")
# /* SKILLSPECTOR_RULES_END */
PLACEHOLDER = re.compile(r"(?i)^(x+|\*+|your[_-]|example|changeme|placeholder|dummy|test|<.*>|\$\{.*\}|\{\{.*\}\})")


def redact(s):
    return s[:4] + "…" + f"({len(s)} chars)"


def scan_text(text, min_entropy=3.5):
    found = []
    for n, line in enumerate(text.splitlines(), 1):
        if "secret-audit: ignore" in line:
            continue
        for rule, sev, pat in KNOWN:
            for m in re.finditer(pat, line):
                found.append({"rule": rule, "severity": sev, "line": n, "match": redact(m.group(0)), "message": "Key-shaped value. Move it to the vault or an env file outside the repo, and rotate it."})
        for m in ASSIGN.finditer(line):
            val = m.group(4)
            if PLACEHOLDER.search(val):
                continue
            e = shannon(val)
            if e >= min_entropy and not any(f["line"] == n for f in found):
                found.append({"rule": "high-entropy-assignment", "severity": "high", "line": n, "match": redact(val), "entropy": round(e, 2), "message": f"{m.group(1)} holds a random-looking value (entropy {e:.2f} bits/char)."})
    return found


def main(argv=None):
    ap = argparse.ArgumentParser(description="Find leaked keys and tokens")
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--root", default=".")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--min-entropy", type=float, default=3.5)
    a = ap.parse_args(argv)
    try:
        files = walk(a.root, a.paths)
    except ReconError as e:
        print(f"secret_audit: {e}", file=sys.stderr)
        return 2
    findings = []
    for p in files:
        text = read_text(p)
        if text is None:
            continue
        for f in scan_text(text, a.min_entropy):
            findings.append({**f, "file": rel(a.root, p)})
    summary = {"files": len(files), "critical": sum(f["severity"] == "critical" for f in findings), "high": sum(f["severity"] == "high" for f in findings)}
    emit({"tool": "secret_audit", "findings": findings, "summary": summary}, a.json)
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
