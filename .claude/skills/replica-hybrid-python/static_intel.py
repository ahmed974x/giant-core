#!/usr/bin/env python3
"""Inventory of a site's published manifests and an entropy audit of generated files (replica-hybrid-python).

    python3 static_intel.py manifests SITE_DIR [--root REPO] [--json]
    python3 static_intel.py entropy PATH... [--root REPO] [--json] [--min 4.0]

manifests: SITE_DIR holds files you already saved from a site (robots.txt, llms.txt, openapi.json,
.well-known/security.txt …). It reports which exist, whether well-known files sit under
/.well-known/ as RFC 8615 requires (security.txt also at the root is allowed as a fallback, RFC 9116),
and short facts from each. Nothing is fetched.
entropy: string literals in Python (read with ast, never run) and in JS, HTML and JSON (by pattern),
with their Shannon entropy; long literals above --min bits per character are reported as possible
keys, printed redacted.
"""

import argparse
import ast
import json
import math
import os
import re
import sys
from collections import Counter

from hcommon import HybridError, inside

WELL_KNOWN = {"security.txt", "change-password", "openid-configuration", "assetlinks.json", "apple-app-site-association", "mta-sts.txt", "ai-plugin.json", "llms.txt"}
ROOT_FILES = {"robots.txt", "llms.txt", "llms-full.txt", "openapi.json", "openapi.yaml", "sitemap.xml", "humans.txt", "security.txt"}
JS_STR = re.compile(r"""(["'`])((?:\\.|(?!\1).){16,400})\1""")


def entropy(s):
    n = len(s)
    return -sum(c / n * math.log2(c / n) for c in Counter(s).values()) if n else 0.0


def manifests(site):
    found, problems, facts = [], [], {}
    for d, _, files in os.walk(site):
        for f in files:
            relp = os.path.relpath(os.path.join(d, f), site).replace(os.sep, "/")
            found.append(relp)
            name = os.path.basename(relp)
            top = relp.split("/")[0]
            if name in WELL_KNOWN and top != ".well-known" and not (name in ROOT_FILES and "/" not in relp):
                problems.append(f"{relp} should live under /.well-known/ (RFC 8615).")
            with open(os.path.join(d, f), encoding="utf-8", errors="replace") as fh:
                text = fh.read(2 * 1024 * 1024)
            if name == "security.txt":
                facts[relp] = {"contact": re.findall(r"(?im)^contact:\s*(\S+)", text), "expires": (re.findall(r"(?im)^expires:\s*(\S+)", text) or [None])[0]}
            elif name == "robots.txt":
                facts[relp] = {"groups": len(re.findall(r"(?im)^user-agent:", text)), "disallow": len(re.findall(r"(?im)^disallow:\s*\S", text)), "sitemaps": re.findall(r"(?im)^sitemap:\s*(\S+)", text)}
            elif name.startswith("llms"):
                facts[relp] = {"sections": len(re.findall(r"(?m)^## ", text)), "links": len(re.findall(r"\]\((https?://[^)\s]+)\)", text))}
            elif name.startswith("openapi") and name.endswith(".json"):
                try:
                    doc = json.loads(text)
                    facts[relp] = {"version": doc.get("openapi") or doc.get("swagger"), "paths": len(doc.get("paths") or {})}
                except ValueError:
                    problems.append(f"{relp} is not valid JSON.")
    if not any(p.endswith("security.txt") for p in found):
        problems.append("No security.txt (RFC 9116): there is no published way to report a vulnerability.")
    return {"files": sorted(found), "facts": facts, "problems": problems}


def literals(path, text):
    if path.endswith(".py"):
        try:
            return [(n.lineno, n.value) for n in ast.walk(ast.parse(text)) if isinstance(n, ast.Constant) and isinstance(n.value, str)]
        except SyntaxError:
            pass
    return [(text.count("\n", 0, m.start()) + 1, m.group(2)) for m in JS_STR.finditer(text)]


def audit(root, paths, minimum):
    out = []
    for relp in paths:
        p = inside(root, relp)
        if not p or not os.path.exists(p):
            raise HybridError(f"{relp} is not inside {root}.")
        files = [p] if os.path.isfile(p) else [os.path.join(d, f) for d, _, fs in os.walk(p) for f in fs if f.endswith((".py", ".js", ".mjs", ".html", ".json", ".md"))]
        for f in files:
            with open(f, encoding="utf-8", errors="replace") as fh:
                text = fh.read(2 * 1024 * 1024)
            for line, s in literals(f, text):
                if len(s) >= 20 and " " not in s and entropy(s) >= minimum:
                    out.append({"file": os.path.relpath(f, root).replace(os.sep, "/"), "line": line, "entropy": round(entropy(s), 2), "value": s[:4] + f"…({len(s)} chars)"})
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="Manifest inventory and entropy audit")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("manifests")
    p.add_argument("site")
    p = sub.add_parser("entropy")
    p.add_argument("paths", nargs="+")
    p.add_argument("--min", type=float, default=4.0)
    for s in sub.choices.values():
        s.add_argument("--root", default=".")
        s.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "manifests":
            site = inside(a.root, a.site)
            if not site or not os.path.isdir(site):
                raise HybridError(f"{a.site} is not a folder inside {a.root}.")
            r = manifests(site)
            print(json.dumps(r, indent=2) if a.json else "\n".join(r["files"] + [f"! {x}" for x in r["problems"]]))
            return 1 if r["problems"] else 0
        r = audit(a.root, a.paths, a.min)
        print(json.dumps(r, indent=2) if a.json else "\n".join(f"{x['file']}:{x['line']} entropy {x['entropy']} {x['value']}" for x in r) or "no high-entropy literals")
        return 1 if r else 0
    except HybridError as e:
        print(f"static_intel: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
