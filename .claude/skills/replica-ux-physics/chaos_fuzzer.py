#!/usr/bin/env python3
"""chaos_fuzzer: seeded edge cases for a page's text fields and layout, so the same seed always gives the
same cases and a failing case can be replayed.

Standard library only (random, json, os, argparse, unicodedata). No network, no processes. It writes data,
never runs anything: each case is {id, kind, lang, dir, width, text, expect}, where expect says what the page
must do with it (wrap without a horizontal page scroll, show the text as text, keep numbers left to right).

    python3 chaos_fuzzer.py --seed 144 --count 120 [--out jarvis/replica/evidence/fuzz-cases.json --root .]

Kinds: long Arabic with full tashkeel, mixed Arabic and English with numbers, one unbroken 300-letter word,
long URLs, emoji with zero-width joiners, bidi controls (LRM, RLM, RLO), zero-width spaces, markup and
quote characters that must stay text, huge and negative numbers, empty and whitespace-only input,
and very long single lines. Widths are the three sizes DESIGN.md checks plus 320 and 2560.
"""

import argparse
import json
import os
import random
import sys
import unicodedata

WIDTHS = [320, 375, 390, 768, 1440, 2560]
AR_WORDS = ["التصميم", "الواجهة", "المستخدم", "الموافقة", "المهمة", "الخادم", "الاختبار", "البحث", "الذاكرة", "المهارة", "الأمان", "اللوحة"]
EN_WORDS = ["design", "layout", "approval", "mission", "server", "skill", "memory", "search", "contrast", "token", "studio", "council"]
TASHKEEL = ["َ", "ُ", "ِ", "ّ", "ْ", "ً", "ٌ", "ٍ"]
EMOJI = ["\U0001F468‍\U0001F469‍\U0001F467", "\U0001F3F3️‍\U0001F308", "\U0001F44D\U0001F3FD", "\U0001F1F8\U0001F1E6"]
BIDI = ["‎", "‏", "‮", "⁦", "⁩"]
MARKUP = ["<scr" + "ipt>x()</scr" + "ipt>", "<img src=x onerror=y>", "\"'><b>", "`${1}`", "{{7*7}}", "'; drop table x; --"]

EXPECT = {
    "arabic_tashkeel": "wraps inside its box; marks stay on their letters; letter-spacing 0",
    "mixed_bidi": "Arabic runs right to left; numbers and Latin stay left to right inside it",
    "long_word": "breaks inside its box (overflow-wrap); no horizontal page scroll",
    "long_url": "breaks inside its box; never widens the page",
    "emoji_zwj": "each emoji stays one glyph; width counted by grapheme",
    "bidi_controls": "shown as text; an override does not flip the rest of the page",
    "zero_width": "kept or removed, never makes an empty-looking name valid",
    "markup": "shown as text; nothing runs, no element is created",
    "numbers": "tabular, left to right; no NaN or Infinity shown",
    "empty": "refused with a plain message, or shown as an empty state",
    "long_line": "wraps; line length stays at most 75ch where text is read",
}


def _arabic(rng, n):
    out = []
    for _ in range(n):
        w = rng.choice(AR_WORDS)
        out.append("".join(ch + (rng.choice(TASHKEEL) if unicodedata.category(ch) == "Lo" and rng.random() < 0.8 else "") for ch in w))
    return " ".join(out)


def make_case(rng, i, kind):
    width = rng.choice(WIDTHS)
    lang, text = "en", ""
    if kind == "arabic_tashkeel":
        lang, text = "ar", _arabic(rng, rng.randint(40, 120))
    elif kind == "mixed_bidi":
        lang = "ar"
        text = " ".join(rng.choice([rng.choice(AR_WORDS), rng.choice(EN_WORDS), str(rng.randint(0, 10 ** 6)), f"v{rng.randint(0, 9)}.{rng.randint(0, 99)}"]) for _ in range(rng.randint(8, 30)))
    elif kind == "long_word":
        text = "".join(rng.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(300))
    elif kind == "long_url":
        text = "https://example.org/" + "/".join(rng.choice(EN_WORDS) for _ in range(30)) + "?q=" + "x" * 80
    elif kind == "emoji_zwj":
        text = " ".join(rng.choice(EMOJI) + rng.choice(EN_WORDS) for _ in range(rng.randint(5, 20)))
    elif kind == "bidi_controls":
        lang = rng.choice(["ar", "en"])
        text = rng.choice(BIDI) + rng.choice(AR_WORDS + EN_WORDS) + " " + rng.choice(BIDI) + "123" + rng.choice(BIDI)
    elif kind == "zero_width":
        text = "​".join(rng.choice(EN_WORDS)) if rng.random() < 0.5 else "​‌‍"
    elif kind == "markup":
        text = rng.choice(MARKUP)
    elif kind == "numbers":
        text = str(rng.choice([0, -1, 10 ** 15, -(10 ** 12), 3.14159265358979, 1e-9, 2 ** 53 + 1]))
    elif kind == "empty":
        text = rng.choice(["", " ", "\t\n", " 　"])
    elif kind == "long_line":
        text = " ".join(rng.choice(EN_WORDS) for _ in range(rng.randint(200, 400)))
    return {"id": f"fz-{i:03d}", "kind": kind, "lang": lang, "dir": "rtl" if lang == "ar" else "ltr", "width": width,
            "length": len(text), "text": text, "expect": EXPECT[kind]}


def cases(seed=144, count=120):
    rng = random.Random(seed)  # noqa: S311 - seeded test data, not a secret
    kinds = list(EXPECT)
    # Every kind at least once, then seeded picks.
    order = kinds + [rng.choice(kinds) for _ in range(max(0, count - len(kinds)))]
    return [make_case(rng, i + 1, k) for i, k in enumerate(order[:count])]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--seed", type=int, default=144)
    ap.add_argument("--count", type=int, default=120)
    ap.add_argument("--out")
    ap.add_argument("--root", default=".")
    a = ap.parse_args(argv)
    if not 1 <= a.count <= 5000:
        print("chaos_fuzzer: --count is 1 to 5000", file=sys.stderr)
        return 2
    doc = {"format": "jarvis-fuzz-cases-v1", "seed": a.seed, "count": a.count, "cases": cases(a.seed, a.count)}
    if not a.out:
        print(json.dumps(doc, ensure_ascii=False, indent=1))
        return 0
    root = os.path.realpath(a.root)
    out = os.path.realpath(os.path.join(root, a.out))
    if os.path.commonpath([root, out]) != root:
        print("chaos_fuzzer: --out must stay inside --root", file=sys.stderr)
        return 2
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    by = {}
    for c in doc["cases"]:
        by[c["kind"]] = by.get(c["kind"], 0) + 1
    print(f"wrote {a.count} cases (seed {a.seed}) to {a.out}: " + ", ".join(f"{k} {n}" for k, n in sorted(by.items())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
