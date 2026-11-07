#!/usr/bin/env python3
"""Layout topology of an HTML page, and a clean template rebuilt from it (replica-hybrid-python).

    python3 topology_synth.py fingerprint PAGE.html [--root REPO] [--json]
    python3 topology_synth.py compare A.html B.html [--root REPO]
    python3 topology_synth.py synth PAGE.html --out jarvis/replica/template.html [--lang ar|en] [--root REPO]

The page is parsed with html.parser and never rendered or run. Text is dropped (only its length is
counted), so nothing of the source's words, brand or images survives. The tree gets a
Weisfeiler-Lehman fingerprint: three rounds of relabelling each element by its role and the sorted
labels of its children, then a histogram of labels. Two pages compare by the cosine of their
histograms. The layout archetype (bento, grid, split-pane, dashboard, e-commerce, IDE, landing) is a
fixed-rule guess, labelled [INFERENCE]. synth writes clean semantic HTML in the Jarvis design system:
OKLCH tokens, a golden-ratio type scale snapped to whole pixels, spacing on the 4/8 scale, a 1:φ split
where the source had one, logical properties for RTL, and a strict CSP pinned by SHA-256.
"""

import argparse
import base64
import hashlib
import math
import re
import sys
from collections import Counter
from html.parser import HTMLParser

from hcommon import PHI, HybridError, read, sha, snap, write

ROLE = {"header": "header", "nav": "nav", "main": "main", "section": "section", "article": "card", "aside": "aside", "footer": "footer",
        "form": "form", "table": "table", "ul": "list", "ol": "list", "li": "item", "img": "media", "picture": "media", "video": "media",
        "svg": "media", "canvas": "media", "button": "action", "a": "link", "input": "field", "select": "field", "textarea": "field",
        "h1": "h1", "h2": "h2", "h3": "h3", "h4": "h3", "pre": "code", "code": "code", "details": "faq", "dialog": "dialog", "figure": "media"}
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
SKIP = {"script", "style", "noscript", "template", "iframe", "head"}
PRICE = re.compile(r"[$€£¥]\s?\d|\d+[.,]\d{2}\s?(usd|eur|sar|aed|kwd|ر\.س|د\.ك)", re.I)


class Node:
    __slots__ = ("classes", "kids", "role", "tag", "text")

    def __init__(self, tag, classes=""):
        self.tag, self.kids, self.text, self.classes = tag, [], 0, classes
        cls = classes.lower()
        self.role = ROLE.get(tag) or ("card" if re.search(r"\bcard|tile|panel|product\b", cls) else "grid" if re.search(r"\bgrid|cols|columns\b", cls) else "box")


class Tree(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("root")
        self.stack = [self.root]
        self.skip = 0
        self.prices = 0

    def handle_starttag(self, tag, attrs):
        if tag in SKIP:
            self.skip += 1
            return
        if self.skip:
            return
        n = Node(tag, dict(attrs).get("class", "") or "")
        self.stack[-1].kids.append(n)
        if tag not in VOID:
            self.stack.append(n)

    def handle_endtag(self, tag):
        if tag in SKIP:
            self.skip = max(0, self.skip - 1)
            return
        if self.skip:
            return
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        if self.skip:
            return
        t = data.strip()
        if t:
            self.stack[-1].text += len(t)
            self.prices += len(PRICE.findall(t))


def parse(html):
    t = Tree()
    t.feed(html)
    t.close()
    return t.root, t.prices


def wl_histogram(root, rounds=3):
    """Weisfeiler-Lehman relabelling; returns the multiset of labels over all rounds."""
    nodes = []

    def collect(n):
        nodes.append(n)
        for k in n.kids:
            collect(k)
    collect(root)
    label = {id(n): n.role for n in nodes}
    hist = Counter(label.values())
    for _ in range(rounds):
        new = {}
        for n in nodes:
            sig = label[id(n)] + "(" + ",".join(sorted(label[id(k)] for k in n.kids)) + ")"
            new[id(n)] = sha(sig)[:12]
        label = new
        hist.update(label.values())
    return hist


def cosine(a, b):
    dot = sum(a[k] * b.get(k, 0) for k in a)
    na, nb = math.sqrt(sum(v * v for v in a.values())), math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb) if na and nb else 0.0


def repeats(n):
    """Largest group of siblings that share a shape (a grid of cards)."""
    shapes = Counter(k.role + ":" + ",".join(sorted(c.role for c in k.kids)) for k in n.kids if k.role not in ("link", "item") or k.kids)
    return max(shapes.values()) if shapes else 0


def summary(root, prices):
    roles, grids, depth = Counter(), [], 0

    def walk(n, d):
        nonlocal depth
        depth = max(depth, d)
        roles[n.role] += 1
        r = repeats(n)
        if r >= 3:
            grids.append(r)
        for k in n.kids:
            walk(k, d + 1)
    walk(root, 0)
    return roles, grids, depth


def archetype(roles, grids, prices):
    """Fixed rules, [INFERENCE]: the dominant layout family."""
    scores = {
        "e-commerce": 2 * min(prices, 10) + (roles["media"] >= 6) * 3 + (roles["action"] >= 4) * 2,
        "dashboard": roles["table"] * 3 + (roles["nav"] >= 1) * 1 + sum(1 for g in grids if 3 <= g <= 6) * 2,
        "ide": roles["code"] * 3 + (roles["aside"] >= 1) * 2 + (roles["dialog"] >= 1),
        "split-pane": (roles["aside"] >= 1 and roles["main"] >= 1) * 4,
        "bento": sum(1 for g in grids if g >= 5) * 2 + (len(set(grids)) >= 2) * 2,
        "grid": sum(1 for g in grids if g >= 3) * 2,
        "landing": (roles["h1"] == 1) * 2 + roles["section"] + roles["faq"],
    }
    best = max(scores, key=lambda k: (scores[k], k))
    return best, scores


def fingerprint(html):
    root, prices = parse(html)
    hist = wl_histogram(root)
    roles, grids, depth = summary(root, prices)
    kind, scores = archetype(roles, grids, prices)
    digest = sha(",".join(f"{k}:{v}" for k, v in sorted(hist.items())))
    landmarks = [r for r in ("header", "nav", "main", "aside", "footer") if roles[r]]
    return {"wl_sha256": digest, "nodes": sum(roles.values()) - 1, "depth": depth, "landmarks": landmarks,
            "roles": {k: v for k, v in sorted(roles.items()) if k != "box"}, "grids": sorted(grids, reverse=True)[:6],
            "archetype": kind, "archetype_scores": scores, "label": "[INFERENCE] archetype from fixed rules",
            "_hist": hist, "_root": root}


def scale(base=16, steps=5):
    """Golden-ratio type scale, rounded to whole pixels; spacing snapped to the 4/8 scale."""
    sizes = [round(base * PHI ** (i / 2)) for i in range(steps)]
    return {"type_px": sizes, "space_px": sorted({snap(base * PHI ** (i / 2) / 2) for i in range(-2, 4)}), "split": [round(100 / PHI, 1), round(100 - 100 / PHI, 1)]}


COPY = {
    "en": {"brand": "Your product", "h1": "Say what it does in one line", "lead": "Who it is for and the one problem it solves.", "card": "Feature", "card_body": "One sentence on why it matters.",
           "cta": "Get started", "faq": "A question people ask", "faq_a": "A short, plain answer.", "footer": "Made with Jarvis Studio.", "side": "Sections", "panel": "Panel"},
    "ar": {"brand": "منتجك", "h1": "قل ما يفعله منتجك في سطر واحد", "lead": "لمن هو، وما المشكلة التي يحلها.", "card": "ميزة", "card_body": "جملة واحدة عن سبب أهميتها.",
           "cta": "ابدأ الآن", "faq": "سؤال يطرحه الناس", "faq_a": "جواب قصير وواضح.", "footer": "صُنع باستوديو جارفس.", "side": "الأقسام", "panel": "لوحة"},
}


def synth(fp, lang="en"):
    """Clean semantic HTML from the topology alone, in the Jarvis design system."""
    c, sc = COPY["ar" if lang == "ar" else "en"], scale()
    t = sc["type_px"]
    cards = max([g for g in fp["grids"] if g <= 12] or [3])
    split = fp["archetype"] in ("split-pane", "ide", "dashboard")
    css = f""":root {{ --bg: oklch(15.0% 0.011 267.7); --surface: oklch(19.0% 0.016 261.6); --text: oklch(96.0% 0.009 258.3); --muted: oklch(80.8% 0.019 258.4); --accent: oklch(77.6% 0.119 248.9); --on-accent: oklch(14.5% 0.030 255); --border: oklch(28.8% 0.024 261.1); }}
@media (prefers-color-scheme: light) {{ :root {{ --bg: oklch(97.2% 0.005 258.3); --surface: oklch(100% 0 0); --text: oklch(18.6% 0.016 261.6); --muted: oklch(42.1% 0.026 259.2); --accent: oklch(51.5% 0.200 259.8); --on-accent: oklch(100% 0 0); --border: oklch(91.5% 0.010 261.8); }} }}
*, *::before, *::after {{ box-sizing: border-box; }}
body {{ margin: 0; background: var(--bg); color: var(--text); font: 400 {t[0]}px/1.6 "Inter", "Readex Pro", system-ui, sans-serif; }}
:lang(ar) body {{ font-family: "Readex Pro", system-ui, sans-serif; line-height: 1.75; }}
.wrap {{ max-inline-size: 1120px; margin-inline: auto; padding-inline: {sc['space_px'][-1] if sc['space_px'][-1] <= 24 else 20}px; }}
header {{ position: sticky; inset-block-start: 0; background: var(--bg); border-block-end: 1px solid var(--border); }}
@supports (backdrop-filter: blur(1px)) {{ header {{ background: color-mix(in oklab, var(--bg) 78%, transparent); backdrop-filter: blur(16px) saturate(180%); }} }}
@media (prefers-reduced-transparency: reduce) {{ header {{ background: var(--bg); backdrop-filter: none; }} }}
nav {{ display: flex; flex-wrap: wrap; gap: 16px; align-items: center; min-block-size: 56px; }}
h1 {{ font-size: {t[4]}px; line-height: 1.2; margin-block: 0 16px; text-wrap: balance; }}
h2 {{ font-size: {t[2]}px; margin-block: 0 16px; }}
p {{ color: var(--muted); max-inline-size: 65ch; }}
section {{ padding-block: 48px; }}
.grid {{ display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); }}
.card {{ padding: 20px; border-radius: 20px; background: var(--surface); border: 1px solid var(--border); }}
.split {{ display: grid; gap: 24px; grid-template-columns: minmax(0, 1fr); }}
@media (min-width: 900px) {{ .split {{ grid-template-columns: {sc['split'][1]}fr {sc['split'][0]}fr; }} }}
.btn {{ display: inline-flex; align-items: center; min-block-size: 44px; padding-inline: 20px; border-radius: 12px; background: var(--accent); color: var(--on-accent); font-weight: 600; text-decoration: none; }}
details {{ padding: 16px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); margin-block-end: 8px; }}
footer {{ padding-block: 32px; color: var(--muted); border-block-start: 1px solid var(--border); }}
@media (prefers-reduced-motion: reduce) {{ * {{ animation: none !important; transition: none !important; }} }}"""
    style_hash = "sha256-" + base64.b64encode(hashlib.sha256(css.encode()).digest()).decode()
    csp = f"default-src 'none'; style-src '{style_hash}'; img-src data:; base-uri 'none'; form-action 'none'; object-src 'none'"
    card_html = "\n".join(f'      <article class="card"><h3>{c["card"]} {i + 1}</h3><p>{c["card_body"]}</p></article>' for i in range(cards))
    main_inner = f"""    <section class="wrap"><h1>{c['h1']}</h1><p>{c['lead']}</p><a class="btn" href="#start">{c['cta']}</a></section>
    <section class="wrap" aria-label="{c['card']}"><div class="grid">
{card_html}
    </div></section>"""
    if split:
        main_inner = f"""    <div class="wrap split"><aside class="card" aria-label="{c['side']}"><h2>{c['side']}</h2></aside><div>
{main_inner}
    </div></div>"""
    if fp["roles"].get("faq"):
        main_inner += f"""\n    <section class="wrap"><h2>{c['faq']}</h2><details><summary>{c['faq']}</summary><p>{c['faq_a']}</p></details></section>"""
    d = "rtl" if lang == "ar" else "ltr"
    return f"""<!doctype html>
<html lang="{'ar' if lang == 'ar' else 'en'}" dir="{d}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="{csp}">
<title>{c['brand']}</title>
<style>{css}</style>
</head>
<body>
  <header><nav class="wrap" aria-label="{c['side']}"><strong>{c['brand']}</strong></nav></header>
  <main>
{main_inner}
  </main>
  <footer><div class="wrap">{c['footer']}</div></footer>
</body>
</html>
"""


def public(fp):
    return {k: v for k, v in fp.items() if not k.startswith("_")}


def main(argv=None):
    import json
    ap = argparse.ArgumentParser(description="Layout topology and clean templates")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("fingerprint")
    p.add_argument("page")
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("compare")
    p.add_argument("a")
    p.add_argument("b")
    p = sub.add_parser("synth")
    p.add_argument("page")
    p.add_argument("--out", required=True)
    p.add_argument("--lang", choices=["en", "ar"], default="en")
    for s in sub.choices.values():
        s.add_argument("--root", default=".")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "fingerprint":
            fp = fingerprint(read(a.root, a.page))
            out = public(fp)
            print(json.dumps(out, indent=2) if a.json else f"{out['archetype']} [INFERENCE] · {out['nodes']} elements · depth {out['depth']} · grids {out['grids']} · WL {out['wl_sha256'][:16]}…")
        elif a.cmd == "compare":
            fa, fb = fingerprint(read(a.root, a.a)), fingerprint(read(a.root, a.b))
            print(f"WL similarity {cosine(fa['_hist'], fb['_hist']):.3f} · {fa['archetype']} vs {fb['archetype']}")
        else:
            fp = fingerprint(read(a.root, a.page))
            write(a.root, a.out, synth(fp, a.lang))
            print(f"wrote {a.out}: {fp['archetype']} [INFERENCE], golden-ratio scale {scale()['type_px']}")
    except HybridError as e:
        print(f"topology_synth: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
