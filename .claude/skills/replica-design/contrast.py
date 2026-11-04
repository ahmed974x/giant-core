#!/usr/bin/env python3
"""WCAG 2.2 contrast gate for replica-design tokens. Standard library only.

    python3 contrast.py replica/design/tokens.json          # light + dark
    python3 contrast.py tokens.json --json
    python3 contrast.py "#6b7280" "#ffffff"                 # one pair

Pairs come from the token file's "pairs" list: [fg, bg] or [fg, bg, size]
where size is "normal" (4.5:1), "large" (3:1; >=24px or >=18.66px bold) or
"ui" (3:1; input borders, focus rings, meaningful icons). Every pair is
checked in "color" (light) and, if present, "color-dark" (roles missing from
color-dark inherit the light value). Exit 1 if any pair fails AA, 2 on bad input.
"""

import argparse
import json
import re
import sys

HEX = re.compile(r"^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
NEEDS = {"normal": (4.5, 7.0), "large": (3.0, 4.5), "ui": (3.0, 3.0)}


def parse_hex(value):
    m = HEX.match(value.strip())
    if not m:
        raise ValueError("not a hex colour: %r" % value)
    h = m.group(1)
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def luminance(rgb):
    def chan(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (chan(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(fg, bg):
    la, lb = luminance(parse_hex(fg)), luminance(parse_hex(bg))
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def apca(text, bg):
    """APCA-W3 0.0.98G-4g lightness contrast Lc (signed: + dark text, - light text)."""
    def y(hexv):
        r, g, b = (c / 255.0 for c in parse_hex(hexv))
        v = 0.2126729 * r ** 2.4 + 0.7151522 * g ** 2.4 + 0.0721750 * b ** 2.4
        return v if v > 0.022 else v + (0.022 - v) ** 1.414
    yt, yb = y(text), y(bg)
    if abs(yb - yt) < 0.0005:
        return 0.0
    if yb > yt:
        sapc = (yb ** 0.56 - yt ** 0.57) * 1.14
        return 0.0 if sapc < 0.1 else (sapc - 0.027) * 100
    sapc = (yb ** 0.65 - yt ** 0.62) * 1.14
    return 0.0 if sapc > -0.1 else (sapc + 0.027) * 100


def flatten(obj, prefix=""):
    out = {}
    if isinstance(obj, dict):
        for key in ("value", "$value"):
            if isinstance(obj.get(key), str):
                return {prefix: obj[key]}
        for k, v in obj.items():
            if k.startswith(("$", "_")):
                continue
            out.update(flatten(v, "%s-%s" % (prefix, k) if prefix else k))
    elif isinstance(obj, str) and HEX.match(obj.strip()):
        out[prefix] = obj.strip()
    return out


def themes(tokens):
    light = flatten(tokens.get("color", tokens.get("colors", tokens.get("colour", {}))))
    result = [("light", light)]
    if "color-dark" in tokens:
        dark = dict(light)
        dark.update(flatten(tokens["color-dark"]))
        result.append(("dark", dark))
    return result


def default_pairs(cols):
    fg = [k for k in cols if re.search(r"(^|-)(text|fg|on)(-|$)", k)]
    bg = [k for k in cols if re.search(r"(^|-)(bg|background|surface)(-|$)", k)]
    return [[f, b] for f in fg for b in bg]


def check(theme, cols, pairs, min_lc=0.0):
    rows = []
    for p in pairs:
        if len(p) < 2:
            continue
        fg, bg = p[0], p[1]
        size = p[2] if len(p) > 2 and p[2] in NEEDS else "normal"
        row = {"theme": theme, "fg": fg, "bg": bg, "size": size}
        if fg not in cols or bg not in cols:
            row["error"] = "unknown token"
        else:
            r = ratio(cols[fg], cols[bg])
            aa, aaa = NEEDS[size]
            lc = abs(apca(cols[fg], cols[bg]))
            # APCA applies to text; "ui" pairs (borders, rings) are judged by WCAG 3:1 only.
            lc_ok = size == "ui" or lc >= min_lc
            row.update(ratio=round(r, 2), lc=round(lc, 1), aa=r >= aa and lc_ok,
                       aaa=r >= aaa and lc_ok, fg_hex=cols[fg], bg_hex=cols[bg])
        rows.append(row)
    return rows


def failed(r):
    return "error" in r or not r["aa"]


def render(rows):
    out = []
    for r in rows:
        tag = "%-5s" % r["theme"]
        if "error" in r:
            out.append("  ??    %s %-16s on %-16s %s" % (tag, r["fg"], r["bg"], r["error"]))
            continue
        if r["size"] == "ui":
            grade = "PASS" if r["aa"] else "FAIL"
        else:
            grade = "AAA" if r["aaa"] else ("AA" if r["aa"] else "FAIL")
        out.append("  %-5s %s %6.2f:1  Lc %5.1f  %-16s on %-16s %s" % (
            grade, tag, r["ratio"], r["lc"], r["fg"], r["bg"],
            "" if r["size"] == "normal" else r["size"]))
    out.append("")
    out.append("  %d checks, %d failing AA" % (len(rows), sum(map(failed, rows))))
    return "\n".join(out)


def main(argv=None):
    ap = argparse.ArgumentParser(description="WCAG contrast gate for design tokens")
    ap.add_argument("args", nargs="+", help="tokens.json, or two hex colours")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--apca", type=float, default=0.0, metavar="LC",
                    help="also require |APCA Lc| >= LC for text pairs (e.g. 60)")
    a = ap.parse_args(argv)
    try:
        if len(a.args) == 2 and all(HEX.match(x) for x in a.args):
            sets = [("pair", {"fg": a.args[0], "bg": a.args[1]})]
            pairs = [["fg", "bg"]]
        else:
            with open(a.args[0], encoding="utf-8") as fh:
                tokens = json.load(fh)
            sets = themes(tokens)
            pairs = tokens.get("pairs") or default_pairs(sets[0][1])
    except (OSError, ValueError) as exc:
        print("contrast: %s" % exc, file=sys.stderr)
        return 2
    if not pairs:
        print('contrast: no pairs. Add a "pairs" list to the token file.', file=sys.stderr)
        return 2
    rows = [r for name, cols in sets for r in check(name, cols, pairs, a.apca)]
    print(json.dumps(rows, indent=2) if a.json else render(rows))
    return 1 if any(map(failed, rows)) else 0


if __name__ == "__main__":
    sys.exit(main())
