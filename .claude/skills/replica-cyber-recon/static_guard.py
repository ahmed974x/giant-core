#!/usr/bin/env python3
"""Static checks for templates, pages and skill code (replica-cyber-recon). Standard library only.

    python3 static_guard.py PATH... [--root REPO] [--json]

HTML and JavaScript: markup sinks (XSS), code from strings, inline handlers and style attributes,
javascript: links, plain-http scripts, a missing or weak Content-Security-Policy, SQL built from
template strings. Python (parsed with ast, never run): code from strings, processes, unsafe
deserialisation, SQL built by formatting, network calls. Any language: instruction-override
phrases (prompt injection) and words for actions AGENTS.md §1 keeps locked (orders, transfers,
payments). A line marked "static-guard: reviewed - <reason>" (or the line after such a comment) is
still reported, as "reviewed", and does not fail the run. Exit 1 when a critical or high finding exists.
"""

import argparse
import ast
import re
import sys

from rcommon import ReconError, emit, read_text, rel, walk

# /* SKILLSPECTOR_RULES_START */  (rule patterns describe what they detect)
WEB_RULES = [
    ("xss-sink", "high", r"\.(innerHTML|outerHTML)\s*=(?!=)|insertAdjacentHTML\s*\(|document\.write(ln)?\s*\(|dangerouslySetInnerHTML", "Writes markup from a string. Use textContent or build nodes."),
    ("code-from-string", "high", r"(^|[^\w.$])eval\s*\(|new\s+Function\s*\(|(setTimeout|setInterval)\s*\(\s*[\"'`]", "Runs a string as code."),
    ("inline-handler", "medium", r"<[a-z][^>]*\son[a-z]+\s*=", "Inline event handler; a strict CSP blocks it."),
    ("style-attribute", "low", r"<[a-z][^>]*\sstyle\s*=", "style=\"\" attribute; a strict CSP blocks it."),
    ("javascript-url", "high", r"(href|src|action)\s*=\s*[\"']\s*javascript:", "javascript: URL."),
    ("plain-http-script", "high", r"<script\b[^>]*\ssrc\s*=\s*[\"']http://", "Script loaded over plain http."),
    ("sql-template", "high", r"\b(query|execute|prepare|exec|all|run|get)\s*\(\s*`[^`]*\$\{", "SQL built from a template string; use $1 placeholders."),
    ("sql-concat", "high", r"\b(query|execute|prepare)\s*\(\s*[\"'][^\"']*\b(select|insert|update|delete)\b[^\"']*[\"']\s*\+", "SQL built by string concatenation; use placeholders."),
]
INJECTION = r"(?i)ignore (all )?(previous|prior|above) instructions|disregard (the )?(system|previous) prompt|you are now (in )?developer mode|--dangerously-skip-permissions|\"defaultMode\"\s*:\s*\"bypass"
LOCKED_WORDS = r"(?i)\b(place_?order|create_?order|send_?order|submit_?order|sign_?order|withdraw(al)?|transfer_?funds|wire_?transfer|charge_?card|payment_?intent|stripe\.charges|publish_?site|deploy_?prod|grant_?permission|add_?collaborator|pip install|npm install)\b"
PY_CODE_CALLS = {"eval", "exec", "compile", "__import__"}
PY_PROCESS = {("os", "system"), ("os", "popen"), ("os", "execv"), ("os", "execvp"), ("os", "spawnv"), ("subprocess", "run"), ("subprocess", "Popen"), ("subprocess", "call"), ("subprocess", "check_call"), ("subprocess", "check_output")}
PY_DESER = {("pickle", "loads"), ("pickle", "load"), ("marshal", "loads"), ("shelve", "open")}
PY_NET_MODULES = {"socket", "urllib", "urllib.request", "http.client", "requests", "httpx", "aiohttp", "ftplib", "smtplib", "telnetlib"}
# /* SKILLSPECTOR_RULES_END */
# The policy may hold the other quote ('self' inside "…"), so read up to the matching quote.
CSP_META = re.compile(r"<meta[^>]+http-equiv\s*=\s*[\"']Content-Security-Policy[\"'][^>]*?content\s*=\s*([\"'])(.*?)\1", re.I | re.S)


def finding(rule, sev, line, msg):
    return {"rule": rule, "severity": sev, "line": line, "message": msg}


REVIEWED = "static-guard: reviewed"


def scan_web(text, is_html):
    out = []
    lines = text.splitlines()
    for n, line in enumerate(lines, 1):
        # A finding on a line marked reviewed (on it or the line above, with a reason) is kept as "reviewed".
        reviewed = REVIEWED in line or (n > 1 and REVIEWED in lines[n - 2])
        for rule, sev, pat, msg in WEB_RULES:
            if rule in ("inline-handler", "style-attribute", "javascript-url", "plain-http-script") and not is_html:
                continue
            if re.search(pat, line, re.I if rule != "code-from-string" else 0):
                out.append(finding(rule, "reviewed" if reviewed else sev, n, msg + (" (marked reviewed)" if reviewed else "")))
    if is_html and re.search(r"<script\b", text, re.I):
        m = CSP_META.search(text)
        if not m:
            out.append(finding("csp-missing", "high", 1, "Page with scripts but no Content-Security-Policy meta."))
        else:
            csp = m.group(2)
            script = (re.search(r"script-src([^;]*)", csp) or re.search(r"default-src([^;]*)", csp))
            src = script.group(1) if script else ""
            if "'unsafe-inline'" in src:
                out.append(finding("csp-unsafe-inline", "high", 1, "CSP allows inline scripts; pin them by sha256."))
            if "'unsafe-eval'" in src:
                out.append(finding("csp-unsafe-eval", "high", 1, "CSP allows eval."))
            if re.search(r"(^|\s)(\*|https?:)(\s|$)", src):
                out.append(finding("csp-wildcard", "high", 1, "CSP lets scripts load from any host."))
            if "object-src 'none'" not in csp:
                out.append(finding("csp-object-src", "medium", 1, "CSP without object-src 'none'."))
    return out


def _name(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = _name(node.value)
        return f"{base}.{node.attr}" if base else node.attr
    return None


def scan_python(text):
    out = []
    try:
        tree = ast.parse(text)
    except SyntaxError as e:
        return [finding("python-syntax", "medium", e.lineno or 1, "Not valid Python; not checked further.")]
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            mods = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module or ""]
            for m in mods:
                if m in PY_NET_MODULES or m.split(".")[0] in {"requests", "httpx", "aiohttp", "socket"}:
                    out.append(finding("network-import", "high", node.lineno, f"Imports {m}: a skill must not reach the network."))
                if m.split(".")[0] in {"subprocess", "ctypes"}:
                    out.append(finding("process-import", "high", node.lineno, f"Imports {m}: a skill must not start processes or load native code."))
        if not isinstance(node, ast.Call):
            continue
        name = _name(node.func) or ""
        parts = tuple(name.split(".")[-2:]) if "." in name else (None, name)
        if name in PY_CODE_CALLS:
            out.append(finding("code-from-string", "high", node.lineno, f"{name}() runs code from data."))
        if parts in PY_PROCESS:
            out.append(finding("process", "high", node.lineno, f"{name}() starts a process."))
        if parts in PY_DESER:
            out.append(finding("unsafe-deserialise", "high", node.lineno, f"{name}() can run code from data."))
        if parts == ("yaml", "load") and not any(k.arg == "Loader" for k in node.keywords):
            out.append(finding("yaml-load", "medium", node.lineno, "yaml.load without a safe Loader."))
        if name.endswith(("execute", "executemany", "executescript")) and node.args:
            q = node.args[0]
            formatted = isinstance(q, ast.JoinedStr) or (isinstance(q, ast.BinOp) and isinstance(q.op, (ast.Add, ast.Mod))) or (isinstance(q, ast.Call) and (_name(q.func) or "").endswith("format"))
            if formatted:
                out.append(finding("sql-formatted", "high", node.lineno, "SQL built by formatting; pass parameters separately."))
    return out


def scan_any(text):
    out = []
    for n, line in enumerate(text.splitlines(), 1):
        if re.search(INJECTION, line):
            out.append(finding("prompt-injection", "high", n, "Instruction-override or permission-bypass phrase."))
        if re.search(LOCKED_WORDS, line):
            out.append(finding("locked-action", "medium", n, "Names an action AGENTS.md §1 keeps locked; it must stay a person's approval."))
    return out


# Detection rule lists are data, not code: text between the SkillSpector rule markers (start and end)
# is blanked (newlines kept, so line numbers hold), as SkillSpector does. Each skipped block is still
# reported as a low finding with its size, so a marker can never hide text without anyone seeing it.
MARK = "SKILLSPECTOR_RULES_"
RULE_BLOCK = re.compile(MARK + "START(.*?)" + MARK + "END", re.S)


def blank_rule_blocks(text):
    skipped = []

    def blank(m):
        skipped.append((text.count("\n", 0, m.start()) + 1, m.group(0).count("\n") + 1, len(m.group(0))))
        return "".join("\n" if c == "\n" else " " for c in m.group(0))
    return RULE_BLOCK.sub(blank, text), skipped


def scan_file(path, text):
    low = path.lower()
    blanked, skipped = blank_rule_blocks(text)
    f = [finding("rule-block", "low", line, f"Detection rule list skipped ({lines} lines, {size} characters).") for line, lines, size in skipped]
    f += scan_any(blanked)
    if low.endswith((".html", ".htm")):
        f += scan_web(blanked, True)
    elif low.endswith((".js", ".mjs", ".cjs", ".ts")):
        f += scan_web(blanked, False)
    elif low.endswith(".py"):
        f += scan_python(text)  # the syntax tree reads rule lists as plain string literals
    return f


def main(argv=None):
    ap = argparse.ArgumentParser(description="Static checks for pages, templates and skill code")
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--root", default=".")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    try:
        files = walk(a.root, a.paths)
    except ReconError as e:
        print(f"static_guard: {e}", file=sys.stderr)
        return 2
    findings = []
    for p in files:
        text = read_text(p)
        if text is not None:
            findings += [{**f, "file": rel(a.root, p)} for f in scan_file(p, text)]
    summary = {s: sum(f["severity"] == s for f in findings) for s in ("critical", "high", "medium", "low", "reviewed")}
    summary["files"] = len(files)
    emit({"tool": "static_guard", "findings": findings, "summary": summary}, a.json)
    return 1 if summary["critical"] or summary["high"] else 0


if __name__ == "__main__":
    sys.exit(main())
