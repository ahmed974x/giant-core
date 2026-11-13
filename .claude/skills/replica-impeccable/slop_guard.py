#!/usr/bin/env python3
# slop-guard: ignore-file (its rule list quotes the words and patterns it flags)
"""slop_guard: 62 rules against low-effort output in prose, design, code and docs.

Standard library only (ast, re, json, hashlib, os). No network, no processes; files are read, never run.
Rules come from giant-core's own DESIGN.md (copy, colour, motion, spacing, accessibility) and AGENTS.md §5
(no TODO, placeholders or stubs), plus common markers of machine-written filler. Each finding names its
rule, file and line. A line with "slop-guard: ignore" is skipped; a file with "slop-guard: ignore-file" in its
first five lines is skipped (for documents that quote the banned words, such as DESIGN.md).

    python3 slop_guard.py PATH... [--root .] [--json] [--rules]

Exit 1 when a high finding exists.
"""

import argparse
import ast
import hashlib
import json
import os
import re
import sys

MAX_BYTES = 2 * 1024 * 1024
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".data", "dist", "build", "vendor", "fonts"}
EXT = {".md": "docs", ".markdown": "docs", ".txt": "prose", ".html": "html", ".htm": "html", ".css": "css",
       ".js": "code", ".mjs": "code", ".cjs": "code", ".py": "py"}
STRING_RE = re.compile(r'"(?:[^"\\\n]|\\.)*"|\'(?:[^\'\\\n]|\\.)*\'|`(?:[^`\\\n]|\\.)*`')

# /* SKILLSPECTOR_RULES_START */  (rule patterns describe what they flag)
PROSE = [
    ("P01", "medium", r"\belevat(e|es|ed|ing)\b", "Hype word 'elevate' (DESIGN.md §6)."),
    ("P02", "medium", r"\bseamless(ly)?\b", "Hype word 'seamless' (DESIGN.md §6)."),
    ("P03", "medium", r"\bunleash(es|ed|ing)?\b", "Hype word 'unleash' (DESIGN.md §6)."),
    ("P04", "medium", r"\bnext[- ]gen(eration)?\b", "Hype word 'next-gen' (DESIGN.md §6)."),
    ("P05", "low", r"\bcutting[- ]edge\b", "Filler: 'cutting-edge'."),
    ("P06", "low", r"\bgame[- ]chang(er|ing)\b", "Filler: 'game-changer'."),
    ("P07", "low", r"\brevolution(i[sz]e|i[sz]es|i[sz]ing|ary)\b", "Filler: 'revolutionize'."),
    ("P08", "low", r"\bsupercharg(e|es|ed|ing)\b", "Filler: 'supercharge'."),
    ("P09", "low", r"\b(world|best)[- ]in[- ]class\b|\bworld[- ]class\b", "Filler: 'world-class'."),
    ("P10", "low", r"\bstate[- ]of[- ]the[- ]art\b", "Filler: 'state-of-the-art'."),
    ("P11", "low", r"\bdelv(e|es|ing)\s+(into|deeper)\b", "Machine-written tell: 'delve into'."),
    ("P12", "low", r"\b(rich\s+)?tapestry\b", "Machine-written tell: 'tapestry'."),
    ("P13", "low", r"\bin today'?s\s+(fast[- ]paced|digital|ever[- ]changing)\b", "Machine-written opener."),
    ("P14", "low", r"\bit'?s\s+worth\s+noting\b|\bit\s+is\s+worth\s+noting\b", "Filler: 'it is worth noting'."),
    ("P15", "high", r"\bas\s+an?\s+(ai|language\s+model)\b", "Model self-reference left in output."),
    ("P16", "medium", r"\boops\b", "'Oops' in copy (DESIGN.md §6: errors say what failed)."),
    ("P17", "medium", r"[A-Za-z]{3,}!(\s|$|['\"`])", "Exclamation mark in copy (DESIGN.md §6)."),
    ("P18", "high", r"\blorem\s+ipsum\b", "Placeholder text (AGENTS.md §5)."),
    ("P19", "medium", r"\bclick\s+here\b", "'Click here' link text says nothing about the target."),
    ("P20", "low", r"\b(unlock|harness)\s+the\s+(full\s+)?power\b", "Filler: 'unlock the power'."),
    ("P21", "low", r"\b(the|a|an|and|to|of|in|is|it|that)\s+\1\b", "Repeated word."),
    ("P22", "low", r"في عالمنا اليوم|لا شك أن|تجدر الإشارة إلى أن|في الختام|غني عن القول", "Arabic filler phrase."),
]
DESIGN = [
    ("D01", "medium", r"#[0-9a-fA-F]{3,8}\b", "Colour literal outside the token files; use an OKLCH token (DESIGN.md §1)."),
    ("D02", "medium", r"transition\s*:\s*all\b", "'transition: all'; list the properties (DESIGN.md §4)."),
    ("D03", "medium", r"\b100vh\b", "Bare 100vh; use 100dvh (DESIGN.md §5)."),
    ("D04", "medium", r"font-size\s*:\s*(\d+(?:\.\d+)?)px", "Text below 12px (DESIGN.md §2)."),
    ("D05", "low", r"\b(margin|padding|gap|inset)(-[a-z-]+)?\s*:\s*([^;]*)", "Spacing off the 4/8 scale (DESIGN.md §3)."),
    ("D06", "high", r"<[a-z][^>]*\sstyle\s*=", "style=\"\" attribute; the CSP blocks it."),
    ("D07", "high", r"<[a-z][^>]*\son[a-z]+\s*=", "Inline event handler; the CSP blocks it."),
    ("D08", "low", r"z-index\s*:\s*(\d+)", "z-index above 1000 hides a layering problem."),
    ("D09", "medium", r"(linear|radial)-gradient\([^)]*(purple|violet|indigo|#8b5cf6|#6366f1|#a855f7)", "Purple-blue 'AI gradient' (DESIGN.md §1)."),
    ("D10", "low", r"(box-shadow|filter)\s*:[^;]*rgba?\([^)]*,\s*(0?\.\d+|1(\.0)?)\s*\)", "Shadow alpha above 0.1 (DESIGN.md §1)."),
    ("D11", "medium", r"outline\s*:\s*(none|0)\b", "Focus outline removed."),
    ("D12", "medium", r"<img\b(?![^>]*\balt=)[^>]*>", "Image without alt text."),
    ("D13", "low", r"<button\b(?![^>]*\btype=)[^>]*>", "Button without type."),
    ("D14", "medium", r"<a\b(?=[^>]*target=\"_blank\")(?![^>]*rel=\"[^\"]*noopener)[^>]*>", "target=_blank without rel=noopener."),
    ("D15", "medium", r"<a\b[^>]*href=\"#\"", "Link that goes nowhere (href=\"#\")."),
    ("D16", "high", r"href\s*=\s*[\"']\s*javascript:", "javascript: link."),
    ("D17", "high", r"<(script|link)\b[^>]*(src|href)\s*=\s*[\"']http://", "Script or stylesheet over plain http."),
    ("D18", "low", r"[A-Za-z]\.\.\.(\s|$|[\"'`<])", "Three ASCII dots; loading and menu text ends with '…' (DESIGN.md §6)."),
]
CODE = [
    ("C01", "high", r"(#|//|/\*|<!--)\s*(TODO|FIXME|XXX|HACK)\b", "TODO left in shipped code (AGENTS.md §5)."),
    ("C02", "high", r"(rest of (the )?code( here)?|implementation goes here|your code here|code omitted|\.\.\. existing code)", "Placeholder instead of code (AGENTS.md §5)."),
    ("C03", "medium", r"\bconsole\.log\s*\(", "console.log left in shipped code."),
    ("C04", "high", r"^\s*debugger\s*;?\s*$", "debugger statement."),
    ("C05", "low", r"^\s*var\s+[A-Za-z_$]", "'var' declaration; use const or let."),
    ("C06", "low", r"^\s*//\s*(const|let|var|if|for|return|await|function)\b.*[;{)]\s*$", "Commented-out code."),
    ("C07", "medium", r"new\s+Promise\s*\(\s*async\b", "async executor in new Promise (errors are lost)."),
    ("C08", "low", r"(^|[^.\w])(alert|confirm|prompt)\s*\(", "Native alert/confirm/prompt dialog."),
]
# /* SKILLSPECTOR_RULES_END */
PY_RULES = [
    ("C09", "low", "Imported name is never used."),
    ("C10", "medium", "Bare except catches everything, including KeyboardInterrupt."),
    ("C11", "high", "Stub function: body is only pass, ... or raise NotImplementedError (AGENTS.md §5)."),
    ("C12", "medium", "Unreachable code after return, raise, break or continue."),
    ("C13", "medium", "Mutable default argument is shared between calls."),
    ("C14", "medium", "A broad except (bare or Exception) swallowed with a bare pass."),
]
DOC_RULES = [
    ("M01", "low", "Heading level jumps by more than one."),
    ("M02", "low", "The same heading appears twice in this file."),
    ("M03", "medium", "Relative link points to a file that does not exist."),
    ("M04", "low", "Empty section: a heading followed directly by another heading of the same or higher level."),
    ("M05", "low", "Paragraph longer than 150 words."),
    ("M06", "medium", "Decision record without a '## Decision' section."),
    ("M07", "medium", "Unfinished marker in docs (TBD, coming soon, to be written)."),
    ("M08", "low", "Code fence without a language."),
]
ALL_IDS = [r[0] for r in PROSE + DESIGN + CODE] + [r[0] for r in PY_RULES + DOC_RULES]
SPACING_OK = {0, 1, 2, 4, 8, 12, 16, 20, 24, 28, 32, 40, 44, 48, 56, 64, 72, 80, 96}


class GuardError(Exception):
    pass


def inside(root, path):
    base = os.path.realpath(root)
    p = os.path.realpath(os.path.join(base, path))
    return p if p == base or p.startswith(base + os.sep) else None


def walk(root, paths):
    out = []
    for rel in paths:
        p = inside(root, rel)
        if not p or not os.path.exists(p):
            raise GuardError(f"{rel} is not inside {root} or does not exist.")
        if os.path.isfile(p):
            out.append(p)
            continue
        for d, dirs, files in os.walk(p):
            dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS)
            out += [os.path.join(d, f) for f in sorted(files) if os.path.splitext(f)[1].lower() in EXT]
    return out


def finding(rule, sev, line, msg, path):
    return {"rule": rule, "severity": sev, "line": line, "message": msg, "file": path}


def regex_rules(rules, text_lines, path, pick=None, extra=None):
    out = []
    for n, line in enumerate(text_lines, 1):
        if "slop-guard: ignore" in line:
            continue
        targets = pick(line) if pick else [line]
        for rid, sev, pat, msg in rules:
            for t in targets:
                m = re.search(pat, t, re.I if rid.startswith("P") else 0)
                if m and (extra is None or extra(rid, m)):
                    out.append(finding(rid, sev, n, msg, path))
                    break
    return out


def prose_extra(rid, m):
    # A title-case name such as "Blue Marble Next Generation" is a product name, not hype.
    return not (rid == "P04" and re.match(r"Next[- ]Gen", m.group(0)))


def design_extra(rid, m):
    if rid == "D01":
        # A custom property definition (--name: #hex) is a token, not a stray literal.
        return not re.search(r"--[\w-]+\s*:[^;{}]*$", m.string[:m.start()])
    if rid == "D04":
        return float(m.group(1)) < 12
    if rid == "D08":
        return int(m.group(1)) > 1000
    if rid == "D10":
        return float(m.group(2)) > 0.1
    if rid == "D05":
        vals = [int(v) for v in re.findall(r"(?<![\w.-])(\d+)px", m.group(3))]
        return any(v not in SPACING_OK and v % 4 != 0 for v in vals)
    return True


def strings_of(line):
    return [s[1:-1] for s in STRING_RE.findall(line)]


def py_checks(text, path):
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return []
    out = []
    msg = {r[0]: (r[1], r[2]) for r in PY_RULES}

    def add(rid, node):
        out.append(finding(rid, msg[rid][0], getattr(node, "lineno", 1), msg[rid][1], path))
    imported = {}
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            for a in node.names:
                name = (a.asname or a.name).split(".")[0]
                if name != "*":
                    imported[name] = node
    used = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)} | {n.value.id for n in ast.walk(tree) if isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name)}
    exported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "__all__" for t in node.targets) and isinstance(node.value, (ast.List, ast.Tuple)):
            exported |= {e.value for e in node.value.elts if isinstance(e, ast.Constant)}
    for name, node in imported.items():
        if name not in used and name not in exported and not name.startswith("_"):
            add("C09", node)
    for node in ast.walk(tree):
        if isinstance(node, ast.ExceptHandler):
            if node.type is None:
                add("C10", node)
            broad = node.type is None or (isinstance(node.type, ast.Name) and node.type.id in ("Exception", "BaseException"))
            if broad and len(node.body) == 1 and isinstance(node.body[0], ast.Pass):
                add("C14", node)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            body = [b for b in node.body if not (isinstance(b, ast.Expr) and isinstance(b.value, ast.Constant) and isinstance(b.value.value, str))]
            if body and all(isinstance(b, ast.Pass) or (isinstance(b, ast.Expr) and isinstance(b.value, ast.Constant) and b.value.value is Ellipsis)
                            or (isinstance(b, ast.Raise) and b.exc is not None and "NotImplementedError" in ast.dump(b.exc)) for b in body):
                add("C11", node)
            for d in node.args.defaults + node.args.kw_defaults:
                if isinstance(d, (ast.List, ast.Dict, ast.Set)):
                    add("C13", d)
        for field in ("body", "orelse", "finalbody"):
            block = getattr(node, field, None)
            if isinstance(block, list):
                for i, stmt in enumerate(block[:-1]):
                    if isinstance(stmt, (ast.Return, ast.Raise, ast.Break, ast.Continue)):
                        add("C12", block[i + 1])
                        break
    return out


def doc_checks(text, path, root):
    out = []
    msg = {r[0]: (r[1], r[2]) for r in DOC_RULES}

    def add(rid, n):
        out.append(finding(rid, msg[rid][0], n, msg[rid][1], path))
    lines = text.split("\n")
    in_fence = False
    last_level, seen, para, para_start = 0, set(), 0, 0
    prev_heading = None
    for n, line in enumerate(lines, 1):
        if "slop-guard: ignore" in line:
            continue
        if line.startswith("```"):
            if not in_fence and line.strip() == "```":
                add("M08", n)
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        h = re.match(r"^(#{1,6})\s+(.+?)\s*$", line)
        if h:
            level = len(h.group(1))
            if last_level and level > last_level + 1:
                add("M01", n)
            key = h.group(2).strip().lower()
            if key in seen:
                add("M02", n)
            seen.add(key)
            if prev_heading and level <= prev_heading[1]:
                add("M04", prev_heading[0])
            prev_heading = (n, level)
            last_level = level
            para = 0
            continue
        if line.strip():
            prev_heading = None
            if not para:
                para_start = n
            para += len(line.split())
            if para > 150 and para - len(line.split()) <= 150:
                add("M05", para_start)
        else:
            para = 0
        if re.search(r"\b(TBD|coming soon|to be written|to be added)\b", line, re.I):
            add("M07", n)
        for target in re.findall(r"\]\(([^)\s#]+)(?:#[^)]*)?\)", line):
            if re.match(r"^[a-z]+:", target) or target.startswith("/"):
                continue
            if not os.path.exists(os.path.join(os.path.dirname(path), target)):
                add("M03", n)
    if re.search(r"(^|/)ADR-\d+[^/]*\.md$", path) and not re.search(r"^## Decision\b", text, re.M):
        add("M06", 1)
    return out


def scan_file(path, text, root="."):
    head = "\n".join(text.split("\n")[:5])
    if "slop-guard: ignore-file" in head:
        return []
    kind = EXT.get(os.path.splitext(path)[1].lower(), "prose")
    lines = text.split("\n")
    is_token_file = "token" in os.path.basename(path).lower()
    out = []
    # A removed outline is fine when the same file gives keyboard users a :focus-visible style.
    skip = {"D11"} if ":focus-visible" in text else set()
    DESIGN_HERE = [r for r in DESIGN if r[0] not in skip]
    if kind in ("docs", "prose"):
        # Inline code quotes output or names (`All checks passed!`); prose rules read the words around it.
        out += regex_rules(PROSE, lines, path, pick=lambda line: [re.sub(r"`[^`]*`", " ", line)], extra=prose_extra)
        if kind == "docs":
            out += doc_checks(text, path, root)
    elif kind == "html":
        out += regex_rules(PROSE, lines, path, pick=lambda line: [re.sub(r"<[^>]*>", " ", line)])
        out += regex_rules([r for r in DESIGN_HERE if not (is_token_file and r[0] == "D01")], lines, path, extra=design_extra)
        out += regex_rules([r for r in CODE if r[0] in ("C01", "C02", "C03", "C04")], lines, path)
    elif kind == "css":
        design = [r for r in DESIGN_HERE if r[0] in ("D01", "D02", "D03", "D04", "D05", "D08", "D09", "D10", "D11")]
        if is_token_file:
            design = [r for r in design if r[0] != "D01"]
        out += regex_rules(design, lines, path, extra=design_extra)
        out += regex_rules([r for r in CODE if r[0] in ("C01", "C02")], lines, path)
    elif kind == "code":
        out += regex_rules(PROSE + [r for r in DESIGN if r[0] in ("D18",)], lines, path, pick=strings_of)
        out += regex_rules(CODE, lines, path)
    elif kind == "py":
        out += regex_rules(PROSE, lines, path, pick=strings_of)
        out += regex_rules([r for r in CODE if r[0] in ("C01", "C02", "C04")], lines, path)
        out += py_checks(text, path)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="62 rules against low-effort output in prose, design, code and docs")
    ap.add_argument("paths", nargs="*")
    ap.add_argument("--root", default=".")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--rules", action="store_true", help="list the rules and exit")
    a = ap.parse_args(argv)
    if a.rules:
        rows = [{"id": r[0], "severity": r[1], "message": r[3]} for r in PROSE + DESIGN + CODE] + [{"id": r[0], "severity": r[1], "message": r[2]} for r in PY_RULES + DOC_RULES]
        print(json.dumps({"count": len(rows), "rules": rows}, ensure_ascii=False, indent=1))
        return 0
    if not a.paths:
        ap.error("give at least one path")
    try:
        files = walk(a.root, a.paths)
    except GuardError as e:
        print(f"slop_guard: {e}", file=sys.stderr)
        return 2
    findings, digest = [], hashlib.sha256()
    for p in files:
        if os.path.getsize(p) > MAX_BYTES:
            continue
        with open(p, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
        rel = os.path.relpath(p, os.path.realpath(a.root))
        digest.update(rel.encode() + b"\0" + hashlib.sha256(text.encode()).digest())
        findings += [dict(f, file=rel) for f in scan_file(p, text, a.root)]
    summary = {s: sum(f["severity"] == s for f in findings) for s in ("high", "medium", "low")}
    by_rule = {}
    for f in findings:
        by_rule[f["rule"]] = by_rule.get(f["rule"], 0) + 1
    report = {"tool": "slop_guard", "rules": len(ALL_IDS), "files": len(files), "summary": summary, "byRule": dict(sorted(by_rule.items())), "sha256": digest.hexdigest(), "findings": findings}
    if a.json:
        print(json.dumps(report, ensure_ascii=False, indent=1))
    else:
        for f in findings:
            print(f"{f['severity'].upper():7} {f['rule']}  {f['file']}:{f['line']}  {f['message']}")
        print(f"summary rules {len(ALL_IDS)}, files {len(files)}, high {summary['high']}, medium {summary['medium']}, low {summary['low']}")
    return 1 if summary["high"] else 0


if __name__ == "__main__":
    sys.exit(main())
