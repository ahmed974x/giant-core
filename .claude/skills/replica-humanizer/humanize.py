#!/usr/bin/env python3
# slop-guard: ignore-file (its phrase table quotes the wordings it replaces)
"""humanize: find stiff, machine-sounding wording in Arabic and English text, and suggest plain words.

Standard library only (re, json, os, argparse). No network, no processes. It reads the files you give it
and, only with --out, writes a rewritten copy inside --root; the original is never changed in place.
Every suggestion is a fixed table entry (no model), so the same text always gets the same advice.

    python3 humanize.py FILE... [--root .] [--json]
    python3 humanize.py FILE --out work/FILE.plain.md [--root .]

Exit 0 always for a report; 2 for a bad path.
"""

import argparse
import json
import os
import re
import sys

# (pattern, replacement or "" to drop, reason). English first, then Arabic. Case is kept for English.
EN = [
    (r"\bin order to\b", "to", "shorter"),
    (r"\butili[sz](e|es|ed|ing)\b", "use", "plain verb"),
    (r"\bleverag(e|es|ed|ing)\b", "use", "plain verb"),
    (r"\bfacilitat(e|es|ed|ing)\b", "help", "plain verb"),
    (r"\bcommenc(e|es|ed|ing)\b", "start", "plain verb"),
    (r"\bendeavou?r to\b", "try to", "plain verb"),
    (r"\bprior to\b", "before", "plain word"),
    (r"\bsubsequent(ly)? to\b", "after", "plain word"),
    (r"\bat this point in time\b", "now", "shorter"),
    (r"\bdue to the fact that\b", "because", "shorter"),
    (r"\bin the event that\b", "if", "shorter"),
    (r"\ba wide (range|variety) of\b", "many", "shorter"),
    (r"\bit is important to note that\s*", "", "filler"),
    (r"\bit should be noted that\s*", "", "filler"),
    (r"\bneedless to say,?\s*", "", "filler"),
    (r"\bplease note that\s*", "", "filler"),
    (r"\bin conclusion,?\s*", "", "filler"),
    (r"\bfurthermore,\s*", "also, ", "plain link"),
    (r"\bmoreover,\s*", "also, ", "plain link"),
    (r"\bsuccessfully\s+", "", "filler (say what happened)"),
    (r"\bvery unique\b", "unique", "redundant"),
    (r"\bfirst and foremost\b", "first", "shorter"),
    (r"\bdelve into\b", "look at", "machine-written tell"),
    (r"\bseamless(ly)?\b", "smooth", "hype"),
    (r"\brobust\b", "reliable", "vague"),
    (r"\bempower(s|ed|ing)?\b", "let", "hype"),
]
AR = [
    (r"في عالمنا اليوم،?\s*", "", "افتتاحية آلية"),
    (r"لا شك أن\s*", "", "حشو"),
    (r"تجدر الإشارة إلى أن\s*", "", "حشو"),
    (r"مما لا شك فيه أن\s*", "", "حشو"),
    (r"غني عن القول أن\s*", "", "حشو"),
    (r"في الختام،?\s*", "", "حشو"),
    (r"قم بـ?", "", "أمر ثقيل: استخدم الفعل مباشرة"),
    (r"يقوم بـ?عملية\s*", "", "تركيب ثقيل"),
    (r"بشكل كبير جداً", "كثيراً", "مبالغة"),
    (r"بشكل فعّال", "جيداً", "حشو"),
    (r"على حد سواء", "معاً", "أقصر"),
    (r"يُعتبر من أهم", "من أهم", "تركيب ثقيل"),
    (r"العديد من", "كثير من", "أبسط"),
    (r"من خلال استخدام", "باستخدام", "أقصر"),
    (r"وذلك من أجل", "لـ", "أقصر"),
    (r"ثوري|خارق|لا مثيل له", "", "مبالغة دعائية"),
]


class HumanizeError(Exception):
    pass


def inside(root, path):
    base = os.path.realpath(root)
    p = os.path.realpath(os.path.join(base, path))
    return p if p == base or p.startswith(base + os.sep) else None


def keep_case(src, rep):
    if not rep:
        return rep
    return rep[0].upper() + rep[1:] if src[:1].isupper() else rep


def suggestions(text):
    out = []
    for n, line in enumerate(text.split("\n"), 1):
        if line.lstrip().startswith(("```", "    ")):
            continue
        for table, lang in ((EN, "en"), (AR, "ar")):
            for pat, rep, why in table:
                for m in re.finditer(pat, line, re.I if lang == "en" else 0):
                    out.append({"line": n, "lang": lang, "found": m.group(0).strip(), "suggest": keep_case(m.group(0), rep).strip() or "(drop it)", "reason": why})
    return out


def rewrite(text):
    out_lines, fence = [], False
    for line in text.split("\n"):
        if line.lstrip().startswith("```"):
            fence = not fence
        if not fence and not line.startswith("    "):
            for pat, rep, _ in EN:
                line = re.sub(pat, lambda m, r=rep: keep_case(m.group(0), r), line, flags=re.I)
            for pat, rep, _ in AR:
                line = re.sub(pat, rep, line)
            line = re.sub(r"(^|\.\s+)([a-z])", lambda m: m.group(1) + m.group(2).upper(), line)
            line = re.sub(r"  +", " ", line)
        out_lines.append(line)
    return "\n".join(out_lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Plain-word suggestions for Arabic and English text")
    ap.add_argument("files", nargs="+")
    ap.add_argument("--root", default=".")
    ap.add_argument("--out", help="write a rewritten copy of the one FILE here (inside --root)")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    try:
        if a.out and len(a.files) != 1:
            raise HumanizeError("--out takes exactly one FILE.")
        report = []
        for f in a.files:
            p = inside(a.root, f)
            if not p or not os.path.isfile(p):
                raise HumanizeError(f"{f} is not a file inside {a.root}.")
            with open(p, encoding="utf-8", errors="replace") as fh:
                text = fh.read()
            report.append({"file": f, "suggestions": suggestions(text)})
            if a.out:
                o = inside(a.root, a.out)
                if not o or os.path.realpath(o) == os.path.realpath(p):
                    raise HumanizeError("--out must be a new path inside --root, not the file itself.")
                os.makedirs(os.path.dirname(o) or ".", exist_ok=True)
                with open(o, "w", encoding="utf-8") as fh:
                    fh.write(rewrite(text))
    except HumanizeError as e:
        print(f"humanize: {e}", file=sys.stderr)
        return 2
    if a.json:
        print(json.dumps(report, ensure_ascii=False, indent=1))
    else:
        for r in report:
            for s in r["suggestions"]:
                print(f"{r['file']}:{s['line']}  [{s['lang']}] {s['found']!r} -> {s['suggest']}  ({s['reason']})")
        print(f"summary files {len(report)}, suggestions {sum(len(r['suggestions']) for r in report)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
