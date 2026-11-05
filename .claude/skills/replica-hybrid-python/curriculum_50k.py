#!/usr/bin/env python3
"""Seeded curriculum: 50,000+ clean layouts and 50,000+ question/answer pairs (replica-hybrid-python).

    python3 curriculum_50k.py count
    python3 curriculum_50k.py sample --kind layouts|qa [--n 3] [--start 0] [--seed 0]
    python3 curriculum_50k.py export --kind layouts|qa --n 50000 --out work/qa.jsonl [--seed 0] [--root REPO]

Nothing is stored: item i is decoded from i (mixed-radix for layouts, a category table for Q&A), so
the same index always gives the same item and the repository carries no data file. --seed applies a
fixed affine permutation of the order. Every answer is computed, never written by hand: WCAG ratios
and APCA Lc from the colours, golden-ratio sizes, 4/8 spacing, graphlib schedules, AGENTS.md §1
locks, Shannon entropy, archetypes from topology_synth's rules. Q&A comes in Arabic and English, in
chat JSONL ({"messages": [...]}) with a <think> section that shows the working.
Ollama does not train models; these files are for few-shot examples, evaluation, or fine-tuning
elsewhere. A model trained on them is still advisory: Jarvis's rules decide locks.
"""

import argparse
import json
import math
import random
import sys

from dag_scheduler import schedule
from hcommon import PHI, SPACE, HybridError, locked, snap, write
from topology_synth import archetype

ARCHETYPES = ["landing", "grid", "bento", "split-pane", "dashboard", "e-commerce", "ide"]
THEMES = {
    "night": {"bg": "#090b10", "surface": "#10141b", "text": "#eef2f8", "muted": "#b9c1cd", "accent": "#77bcff"},
    "day": {"bg": "#f4f6f9", "surface": "#ffffff", "text": "#0f131a", "muted": "#454e5c", "accent": "#0b5ed7"},
    "paper": {"bg": "#f7f7f5", "surface": "#ffffff", "text": "#16181d", "muted": "#4a505c", "accent": "#0b5ed7"},
    "sand": {"bg": "#f6f1e7", "surface": "#fffaf0", "text": "#2a2118", "muted": "#5c4d3c", "accent": "#8a4b0f"},
}
DENSITY = {"compact": 14, "regular": 16, "airy": 18}
WIDTHS = [375, 768, 1440]
OPTIONAL = ["features", "stats", "table", "testimonials", "faq", "cta"]
RADII = [12, 20]
LAYOUT_RADIX = [len(ARCHETYPES), len(THEMES), len(DENSITY), 2, len(WIDTHS), 2 ** len(OPTIONAL), 4, len(RADII)]


def lum(hex6):
    r, g, b = (int(hex6[i:i + 2], 16) / 255 for i in (1, 3, 5))
    f = lambda v: v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4  # noqa: E731
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def wcag(a, b):
    x, y = lum(a), lum(b)
    return (max(x, y) + 0.05) / (min(x, y) + 0.05)


def apca(text, bg):
    """APCA-W3 0.0.98G-4g, the same formula as Jarvis's page and replica-design's contrast.py."""
    def y(h):
        r, g, b = (int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))
        v = 0.2126729 * r ** 2.4 + 0.7151522 * g ** 2.4 + 0.0721750 * b ** 2.4
        return v if v > 0.022 else v + (0.022 - v) ** 1.414
    yt, yb = y(text), y(bg)
    if abs(yb - yt) < 0.0005:
        return 0.0
    if yb > yt:
        s = (yb ** 0.56 - yt ** 0.57) * 1.14
        return 0.0 if s < 0.1 else (s - 0.027) * 100
    s = (yb ** 0.65 - yt ** 0.62) * 1.14
    return 0.0 if s > -0.1 else (s + 0.027) * 100


def decode(i, radix):
    out = []
    for r in radix:
        out.append(i % r)
        i //= r
    return out


def layout(i):
    a, t, d, lang, w, opt, cards, rad = decode(i, LAYOUT_RADIX)
    theme_name = list(THEMES)[t]
    th, base = THEMES[theme_name], list(DENSITY.values())[d]
    sections = ["nav", "hero"] + [s for k, s in enumerate(OPTIONAL) if opt >> k & 1] + ["footer"]
    pairs = {"text/bg": (th["text"], th["bg"]), "muted/surface": (th["muted"], th["surface"]), "accent/bg": (th["accent"], th["bg"])}
    checks = {k: {"wcag": round(wcag(*v), 2), "apca": round(abs(apca(*v)), 1)} for k, v in pairs.items()}
    return {"id": i, "archetype": ARCHETYPES[a], "theme": theme_name, "tokens": th, "density": list(DENSITY)[d], "lang": "ar" if lang else "en",
            "dir": "rtl" if lang else "ltr", "width": WIDTHS[w], "sections": sections, "cards": cards + 3, "radius": RADII[rad],
            "type_px": [round(base * PHI ** (k / 2)) for k in range(5)], "space_px": sorted({snap(base * PHI ** (k / 2) / 2) for k in range(-2, 4)}),
            "split": [round(100 / PHI, 1), round(100 - 100 / PHI, 1)] if ARCHETYPES[a] in ("split-pane", "ide", "dashboard") else None,
            "contrast": checks, "passes": all(c["wcag"] >= 4.5 and c["apca"] >= 60 for c in checks.values())}


# ---------- question and answer generators (each returns (q_en, q_ar, think, answer_en, answer_ar)) ----------
PALETTE = ["#090b10", "#10141b", "#1c1c1e", "#2c2c2e", "#454e5c", "#5c4d3c", "#6234c4", "#8a4b0f", "#0b5ed7", "#0f131a", "#16181d", "#2a2118",
           "#77bcff", "#b9c1cd", "#c2adff", "#eef2f8", "#f4f6f9", "#f6f1e7", "#f7f7f5", "#ffffff", "#ff453a", "#30d158", "#ffd60a", "#64d2ff"]
VERBS = ["read", "summarise", "pay", "publish", "deploy", "email", "install", "grant", "list", "count", "send", "transfer", "draft", "review", "archive"]
OBJECTS = ["the release notes", "the invoice", "the site", "a skill", "push access", "the decision records", "the team", "the test log", "a webhook",
           "the contrast report", "the supplier", "the notes", "the wallet", "a plugin", "the commits", "the summary"]
PHYSICAL = [("margin-left", "margin-inline-start"), ("margin-right", "margin-inline-end"), ("padding-left", "padding-inline-start"), ("padding-right", "padding-inline-end"),
            ("left", "inset-inline-start"), ("right", "inset-inline-end"), ("border-left", "border-inline-start"), ("border-right", "border-inline-end"),
            ("text-align: left", "text-align: start"), ("text-align: right", "text-align: end"), ("width", "inline-size"), ("height", "block-size"),
            ("top", "inset-block-start"), ("bottom", "inset-block-end"), ("margin-top", "margin-block-start"), ("margin-bottom", "margin-block-end")]


def q_contrast(k):
    a, b = PALETTE[k // (len(PALETTE) - 1)], [c for c in PALETTE if c != PALETTE[k // (len(PALETTE) - 1)]][k % (len(PALETTE) - 1)]
    r, lc = wcag(a, b), abs(apca(a, b))
    ok = r >= 4.5 and lc >= 60
    think = f"Relative luminance of {a} is {lum(a):.4f}, of {b} is {lum(b):.4f}. WCAG ratio = (lighter + 0.05) / (darker + 0.05) = {r:.2f}. APCA-W3 Lc for text {a} on {b} = {lc:.1f}. Jarvis needs WCAG >= 4.5 and |Lc| >= 60."
    return (f"Can text {a} sit on background {b} in Jarvis?", f"هل يصلح النص {a} على الخلفية {b} في Jarvis؟", think,
            f"{'Yes' if ok else 'No'}: WCAG {r:.2f}:1, APCA Lc {lc:.1f}.", f"{'نعم' if ok else 'لا'}: WCAG ‏{r:.2f}:1، APCA ‏Lc {lc:.1f}.")


def q_scale(k):
    base, step = 12 + k // 9, k % 9
    v = base * PHI ** (step / 2)
    return (f"With base {base}px, what is step {step} of the golden-ratio type scale?", f"بأساس {base}px، كم الخطوة {step} في سلم الخط بالنسبة الذهبية؟",
            f"Step s = base × φ^(s/2), φ = {PHI:.6f}. {base} × φ^{step / 2:g} = {v:.3f}, rounded to whole pixels.", f"{round(v)}px.", f"{round(v)}px.")


def q_space(k):
    px = 1 + k
    s = snap(px)
    return (f"Snap {px}px to the DESIGN.md spacing scale.", f"قرّب {px}px إلى سلم المسافات في DESIGN.md.",
            f"The scale is {', '.join(map(str, SPACE))}. The nearest value to {px} is {s} (distance {abs(s - px)}).", f"{s}px.", f"{s}px.")


def q_dag(k):
    rnd = random.Random(k)  # noqa: S311 - a fixed seed for a reproducible curriculum, not security
    n = rnd.randint(4, 8)
    ids = [chr(97 + i) for i in range(n)]
    edges = [[ids[i], ids[j]] for j in range(n) for i in range(j) if rnd.random() < 0.35]
    titles = {x: rnd.choice(["read commits", "run tests", "check contrast", "save a note", "publish the notes", "email the team", "scan skills"]) for x in ids}
    r = schedule({"nodes": [{"id": x, "title": titles[x]} for x in ids], "edges": edges})
    desc = "; ".join(f"{x}: {titles[x]}" for x in ids) + ". Needs: " + (", ".join(f"{b} after {a}" for a, b in edges) or "none")
    batches = " | ".join(",".join(b) for b in r["batches"])
    lk = ", ".join(r["locked"]) or "none"
    return (f"Plan these steps in parallel phases and say which wait for a person. {desc}.", f"رتّب هذه الخطوات في مراحل متوازية وقل أيها ينتظر إنساناً. {desc}.",
            f"Topological sort (graphlib) gives the ready sets in order: {batches}. Steps naming publishing or email are locked (AGENTS.md §1); steps after them wait.",
            f"Phases: {batches}. Locked: {lk}. Waiting on them: {', '.join(r['waiting_on_locked']) or 'none'}.",
            f"المراحل: {batches}. المقفلة: {lk}. تنتظرها: {', '.join(r['waiting_on_locked']) or 'لا شيء'}.")


def q_lock(k):
    v, o = VERBS[k // len(OBJECTS)], OBJECTS[k % len(OBJECTS)]
    act = f"{v} {o}"
    lk = locked(act)
    return (f"Can a Jarvis agent do this on its own: “{act}”?", f"هل يستطيع وكيل Jarvis فعل هذا وحده: «{act}»؟",
            f"AGENTS.md §1 locks money, publishing, permissions, installs and outbound messages. “{act}” {'names' if lk else 'names none of'} those.",
            "No: it waits for Director 00 outside Jarvis." if lk else "Yes, inside its sandbox; it still asks before writing a file.",
            "لا: ينتظر المدير 00 خارج Jarvis." if lk else "نعم داخل بيئته المعزولة، ويستأذن قبل كتابة أي ملف.")


def q_entropy(k):
    rnd = random.Random(10_000 + k)  # noqa: S311 - reproducible, not security
    alpha = rnd.choice(["0123456789abcdef", "abcdefghijklmnopqrstuvwxyz", "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", "ab"])
    s = "".join(rnd.choice(alpha) for _ in range(rnd.randint(12, 40)))
    counts = {c: s.count(c) for c in sorted(set(s))}
    e = -sum(c / len(s) * math.log2(c / len(s)) for c in counts.values())
    return (f"What is the Shannon entropy of “{s}”, and does it look like a key?", f"ما عشوائية شانون للنص «{s}»، وهل يشبه مفتاحاً؟",
            f"{len(s)} characters, {len(counts)} distinct. H = −Σ p·log2 p = {e:.3f} bits per character. secret_audit flags 16+ characters at 3.5 or more.",
            f"{e:.2f} bits per character: {'looks like a key' if len(s) >= 16 and e >= 3.5 else 'not key-like'}.", f"{e:.2f} بت لكل حرف: {'يشبه مفتاحاً' if len(s) >= 16 and e >= 3.5 else 'لا يشبه مفتاحاً'}.")


def q_logical(k):
    phys, logical = PHYSICAL[k % len(PHYSICAL)]
    return (f"In a page that must work right to left, what replaces `{phys}`?", f"في صفحة يجب أن تعمل من اليمين لليسار، ما بديل `{phys}`؟",
            f"Physical sides flip meaning in RTL; logical properties follow the writing direction. `{phys}` maps to `{logical}`.", f"`{logical}`.", f"`{logical}`.")


def q_archetype(k):
    rnd = random.Random(20_000 + k)  # noqa: S311 - reproducible, not security
    from collections import Counter
    roles = Counter({r: rnd.randint(0, 6) for r in ("table", "nav", "code", "aside", "main", "dialog", "media", "action", "h1", "section", "faq")})
    roles["h1"] = min(roles["h1"], 2)
    grids = sorted(rnd.sample([3, 4, 5, 6, 8, 12], rnd.randint(0, 3)), reverse=True)
    prices = rnd.randint(0, 6)
    kind, scores = archetype(roles, grids, prices)
    desc = ", ".join(f"{k}={v}" for k, v in sorted(roles.items()) if v) + f"; grids {grids or 'none'}; prices {prices}"
    return (f"Which layout family fits this page shape: {desc}?", f"أي نوع تخطيط يناسب هذا الشكل: {desc}؟",
            "Scores by fixed rules: " + ", ".join(f"{k} {v}" for k, v in sorted(scores.items(), key=lambda x: -x[1])) + ".",
            f"{kind} [INFERENCE].", f"{kind} [استدلال].")


QA = [("contrast", q_contrast, len(PALETTE) * (len(PALETTE) - 1)), ("golden-scale", q_scale, 13 * 9), ("spacing", q_space, 200), ("dag", q_dag, 10_000),
      ("locks", q_lock, len(VERBS) * len(OBJECTS)), ("entropy", q_entropy, 8_000), ("logical-css", q_logical, len(PHYSICAL)), ("archetype", q_archetype, 8_000)]
QA_TOTAL = 2 * sum(n for _, _, n in QA)
LAYOUT_TOTAL = math.prod(LAYOUT_RADIX)


def qa(i):
    lang, j = ("ar" if i % 2 else "en"), i // 2
    for name, fn, n in QA:
        if j < n:
            q_en, q_ar, think, a_en, a_ar = fn(j)
            return {"id": i, "category": name, "lang": lang, "messages": [
                {"role": "system", "content": "Jarvis design and safety rules (DESIGN.md, AGENTS.md §1). Show your working in <think>, then answer."},
                {"role": "user", "content": q_ar if lang == "ar" else q_en},
                {"role": "assistant", "content": f"<think>{think}</think>\n" + (a_ar if lang == "ar" else a_en)}]}
        j -= n
    raise HybridError(f"Q&A index {i} is past the end ({QA_TOTAL}).")


def permute(i, total, seed):
    """Affine permutation of 0..total-1; seed 0 keeps the natural order."""
    if not seed:
        return i
    a = 6364136223846793005 % total or 1
    while math.gcd(a, total) != 1:
        a += 1
    return (a * i + seed * 1442695040888963407) % total


def item(kind, i, seed=0):
    total = LAYOUT_TOTAL if kind == "layouts" else QA_TOTAL
    if not 0 <= i < total:
        raise HybridError(f"Index {i} is outside 0..{total - 1}.")
    j = permute(i, total, seed)
    return layout(j) if kind == "layouts" else qa(j)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Seeded curriculum of layouts and Q&A")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("count")
    for name in ("sample", "export"):
        p = sub.add_parser(name)
        p.add_argument("--kind", choices=["layouts", "qa"], required=True)
        p.add_argument("--n", type=int, default=3 if name == "sample" else 50_000)
        p.add_argument("--start", type=int, default=0)
        p.add_argument("--seed", type=int, default=0)
        if name == "export":
            p.add_argument("--out", required=True)
            p.add_argument("--root", default=".")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "count":
            print(json.dumps({"layouts": LAYOUT_TOTAL, "qa": QA_TOTAL, "qa_by_category": {name: 2 * n for name, _, n in QA}}, indent=2))
            return 0
        if a.n < 1 or a.n > 200_000:
            raise HybridError("--n is 1 to 200,000.")
        rows = (item(a.kind, a.start + k, a.seed) for k in range(a.n))
        if a.cmd == "sample":
            for r in rows:
                print(json.dumps(r, ensure_ascii=False))
            return 0
        write(a.root, a.out, "".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n" for r in rows))
        print(f"wrote {a.n} {a.kind} to {a.out}")
    except HybridError as e:
        print(f"curriculum_50k: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
