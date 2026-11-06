#!/usr/bin/env python3
"""ux_physics: Fitts's law, Hick's law, RTL/LTR mirror symmetry and an attention heatmap for a page.

Standard library only (json, math, re, html.parser, argparse). No network, no processes. The same
formulas as jarvis/server/lib/ux-physics.mjs, which the Jarvis Studio runs on boxes measured in the
browser. Two modes:

    python3 ux_physics.py --boxes boxes.json [--rtl rtl.json] --vw 390 --vh 844 [--json]
    python3 ux_physics.py page.html [style.css ...] [--json]

--boxes reads boxes measured in a browser: [{id, kind: action|heading|text|image, level?, group?, x, y, w, h}].
The HTML mode reads markup and CSS without a browser: it counts the choices in each navigation, menu and
form (Hick), checks that no size the CSS states for a button or link is under 44 px (Fitts), and lists physical
properties (margin-left, right:, text-align: left ...) that stop a layout from mirroring in Arabic.

Formulas:
  Fitts: ID = log2(D / W + 1), D from the thumb's rest point (bottom centre) to the target's centre,
         W the target's smaller side. Targets under 44 x 44 px fail (DESIGN.md section 5).
  Hick:  RT = a + b * log2(n + 1), a = 0.2 s, b = 0.15 s [INFERENCE: textbook constants]. n > 7 is flagged.
  Symmetry: error = |x_ltr - (W - x_rtl - w)| / W per element; symmetry = 1 - mean error.
  Heatmap: interactive 1.0, headings 0.8 to 0.5 by level, images 0.6, text 0.25 [INFERENCE].
Exit 0 when nothing fails, 1 when a target is too small or a group is over 7, 2 for a bad path.
"""

import argparse
import json
import math
import re
import sys
from html.parser import HTMLParser

TOUCH_MIN = 44
HICK_A, HICK_B, HICK_MAX = 0.2, 0.15, 7


def fitts(boxes, vw, vh):
    rest = (vw / 2, vh - 24)
    targets = []
    for b in boxes:
        if b.get("kind") != "action":
            continue
        cx, cy = b["x"] + b["w"] / 2, b["y"] + b["h"] / 2
        d = math.hypot(cx - rest[0], cy - rest[1])
        w = max(1, min(b["w"], b["h"]))
        targets.append({"id": b.get("id"), "w": round(b["w"]), "h": round(b["h"]),
                        "id_bits": round(math.log2(d / w + 1), 2),
                        "small": b["w"] < TOUCH_MIN or b["h"] < TOUCH_MIN})
    small = sum(1 for t in targets if t["small"])
    mean = sum(t["id_bits"] for t in targets) / len(targets) if targets else 0
    score = round(100 * (1 - small / len(targets))) if targets else 100
    return {"targets": targets, "small": small, "meanId": round(mean, 2), "score": score}


def hick_rt(n):
    return round(HICK_A + HICK_B * math.log2(n + 1), 3)


def hick(boxes):
    groups = {}
    for b in boxes:
        if b.get("kind") == "action" and b.get("group"):
            groups[b["group"]] = groups.get(b["group"], 0) + 1
    out = sorted(({"group": g, "n": n, "rt": hick_rt(n), "over": n > HICK_MAX} for g, n in groups.items()), key=lambda g: -g["n"])
    return {"groups": out, "worstRt": max((g["rt"] for g in out), default=0), "over": sum(1 for g in out if g["over"])}


def symmetry(ltr, rtl, vw):
    by_id = {b["id"]: b for b in rtl}
    errs = [abs(a["x"] - (vw - by_id[a["id"]]["x"] - by_id[a["id"]]["w"])) / vw for a in ltr if a.get("id") in by_id and a.get("w")]
    mean = sum(errs) / len(errs) if errs else 0
    return {"pairs": len(errs), "score": round((1 - min(1, mean)) * 1000) / 10}


def heat_grid(boxes, vw, vh, cols=24, rows=16, phone=None):
    phone = vw <= 480 if phone is None else phone
    grid = [[0.0] * cols for _ in range(rows)]
    cw, ch = vw / cols, vh / rows

    def weight(b):
        k = b.get("kind")
        if k == "action":
            return 1.0
        if k == "heading":
            return max(0.5, 0.9 - 0.1 * (b.get("level") or 1))
        return 0.6 if k == "image" else 0.25

    for b in boxes:
        if b["y"] > vh or b["y"] + b["h"] < 0:
            continue
        w = weight(b)
        for r in range(max(0, math.floor(b["y"] / ch)), min(rows - 1, math.floor((b["y"] + b["h"]) / ch)) + 1):
            for c in range(max(0, math.floor(b["x"] / cw)), min(cols - 1, math.floor((b["x"] + b["w"]) / cw)) + 1):
                grid[r][c] += w
    if phone:
        for r in range(rows):
            for c in range(cols):
                dx, dy = (c + 0.5) / cols - 0.5, 1 - (r + 0.5) / rows
                grid[r][c] *= 1 + 0.5 * max(0, 1 - math.hypot(dx * 1.4, dy))
    top = max(1e-9, max(v for row in grid for v in row))
    return {"cols": cols, "rows": rows, "grid": [[round(v / top, 2) for v in row] for row in grid]}


def report_boxes(boxes, vw, vh, rtl=None):
    return {"viewport": [vw, vh], "fitts": fitts(boxes, vw, vh), "hick": hick(boxes),
            "symmetry": symmetry(boxes, rtl, vw) if rtl else None, "heat": heat_grid(boxes, vw, vh)}


# ---- HTML and CSS without a browser -------------------------------------------------------------

GROUP_TAGS = {"nav", "menu", "ul", "ol", "form", "header", "footer"}
PHYSICAL = re.compile(r"(?<![\w-])(margin-left|margin-right|padding-left|padding-right|border-left|border-right|left|right)\s*:|text-align\s*:\s*(left|right)\b|float\s*:\s*(left|right)\b", re.I)


class _Actions(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.actions, self.counter = [], [], {}

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in GROUP_TAGS:
            self.counter[tag] = self.counter.get(tag, 0) + 1
            self.stack.append((tag, tag + "#" + str(self.counter[tag]) + (" " + a["aria-label"] if a.get("aria-label") else "")))
        is_action = tag in ("a", "button", "select", "summary") or (tag == "input" and a.get("type") in ("submit", "button", "checkbox", "radio")) or a.get("role") in ("button", "link", "tab", "menuitem")
        if is_action:
            group = next((g for t, g in reversed(self.stack) if t in ("nav", "menu", "ul", "ol", "form")), None) or next((g for _, g in reversed(self.stack)), None)
            self.actions.append({"tag": tag, "classes": (a.get("class") or "").split(), "group": group})

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break


def css_rules(css):
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    for m in re.finditer(r"([^{}@]+)\{([^{}]*)\}", css):
        yield [s.strip() for s in m.group(1).split(",")], m.group(2)


def _px(decl, names):
    best = 0
    for n in names:
        for m in re.finditer(r"(?<![\w-])" + n + r"\s*:\s*([\d.]+)(px|rem)\b", decl):
            v = float(m.group(1)) * (16 if m.group(2) == "rem" else 1)
            best = max(best, v)
    return best


def touch_sizes(actions, css):
    """For each kind of action (tag plus first class), the largest declared min size in the CSS."""
    kinds = {}
    for a in actions:
        key = a["tag"] + ("." + a["classes"][0] if a["classes"] else "")
        kinds.setdefault(key, {"kind": key, "count": 0, "w": 0, "h": 0})
        kinds[key]["count"] += 1
    for sels, decl in css_rules(css):
        h = _px(decl, ["min-height", "min-block-size", "height", "block-size", "line-height"])
        w = _px(decl, ["min-width", "min-inline-size", "width", "inline-size"])
        if not (h or w):
            continue
        for k in kinds.values():
            tag, _, cls = k["kind"].partition(".")
            for s in sels:
                last = re.split(r"[\s>+~]+", s)[-1]
                if last == tag or (cls and re.search(r"\." + re.escape(cls) + r"(?![\w-])", last)):
                    k["h"], k["w"] = max(k["h"], h), max(k["w"], w)
    out = []
    for k in kinds.values():
        # A side the CSS does not state comes from the content; only a stated side under 44 px fails.
        state = "unknown" if not (k["h"] or k["w"]) else "small" if (k["h"] and k["h"] < TOUCH_MIN) or (k["w"] and k["w"] < TOUCH_MIN) else "ok"
        out.append({**k, "state": state})
    return sorted(out, key=lambda k: (k["state"] != "small", -k["count"]))


def physical_properties(css):
    """Physical sides in CSS rules. text-align: left inside a rule that sets direction: ltr (code, logs) is meant."""
    hits = []
    for m in re.finditer(r"([^{}]*)\{([^{}]*)\}", css):
        decl = m.group(2)
        line = css.count("\n", 0, m.start(2)) + 1
        for h in PHYSICAL.finditer(decl):
            if h.group(2) and re.search(r"direction\s*:\s*ltr", decl):
                continue
            hits.append({"line": line + decl.count("\n", 0, h.start()), "selector": m.group(1).strip()[-60:], "found": h.group(0).rstrip(":").strip()})
    return hits


def report_html(html, css):
    p = _Actions()
    p.feed(html)
    counts = {}
    for a in p.actions:
        if a["group"]:
            counts[a["group"]] = counts.get(a["group"], 0) + 1
    groups = sorted(({"group": g, "n": n, "rt": hick_rt(n), "over": n > HICK_MAX} for g, n in counts.items()), key=lambda g: -g["n"])
    sizes = touch_sizes(p.actions, css)
    phys = physical_properties(css)
    return {"actions": len(p.actions), "hick": {"groups": groups, "over": sum(1 for g in groups if g["over"])},
            "touch": {"kinds": sizes, "small": sum(1 for k in sizes if k["state"] == "small"), "unknown": sum(1 for k in sizes if k["state"] == "unknown")},
            "rtl": {"physical": phys[:200], "count": len(phys)}}


def _inline_css(html):
    return "\n".join(re.findall(r"<style[^>]*>(.*?)</style>", html, flags=re.S | re.I))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("files", nargs="*")
    ap.add_argument("--boxes")
    ap.add_argument("--rtl")
    ap.add_argument("--vw", type=float, default=390)
    ap.add_argument("--vh", type=float, default=844)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    try:
        if a.boxes:
            with open(a.boxes, encoding="utf-8") as fh:
                boxes = json.load(fh)
            rtl = None
            if a.rtl:
                with open(a.rtl, encoding="utf-8") as fh:
                    rtl = json.load(fh)
            rep = report_boxes(boxes, a.vw, a.vh, rtl)
            bad = rep["fitts"]["small"] or rep["hick"]["over"]
        else:
            if not a.files:
                ap.error("give an HTML file or --boxes")
            html = css = ""
            for f in a.files:
                with open(f, encoding="utf-8") as fh:
                    text = fh.read()
                if f.lower().endswith((".html", ".htm")):
                    html += text
                    css += _inline_css(text) + "\n"
                else:
                    css += text + "\n"
            rep = report_html(html, css)
            bad = rep["touch"]["small"] or rep["hick"]["over"]
    except (OSError, ValueError) as e:
        print("ux_physics: " + str(e), file=sys.stderr)
        return 2
    if a.json:
        print(json.dumps(rep, ensure_ascii=False, indent=1))
    elif a.boxes:
        f, k = rep["fitts"], rep["hick"]
        print(f"Fitts: {len(f['targets'])} targets, {f['small']} under 44 px, mean ID {f['meanId']:.2f} bits, score {f['score']}")
        print(f"Hick: {len(k['groups'])} groups, {k['over']} over 7, worst RT {k['worstRt']:.3f} s [INFERENCE]")
        if rep["symmetry"]:
            print(f"RTL symmetry: {rep['symmetry']['score']:.1f} over {rep['symmetry']['pairs']} pairs")
    else:
        print(f"Actions: {rep['actions']}")
        for g in rep["hick"]["groups"][:10]:
            print(f"  Hick {g['group']:<28} n={g['n']:<3} RT {g['rt']:.3f} s" + ("  OVER 7" if g["over"] else ""))
        for k in rep["touch"]["kinds"][:20]:
            state = k["state"] if k["state"] != "small" else f"SMALL ({k['w']:.0f}x{k['h']:.0f} px)"
            print(f"  Touch {k['kind']:<26} x{k['count']:<3} {state}")
        print(f"RTL: {rep['rtl']['count']} physical properties (use logical ones: margin-inline-start, inset-inline-end ...)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
