#!/usr/bin/env python3
"""reversal_engine: reads a plan or a page template, finds what breaks the repository's rules and writes a
corrected copy, with the list of corrections and SHA-256 of before, after and the corrections. Standard
library only (hashlib, json, math, re, argparse, sys). No network, no processes. The same rules as
jarvis/server/lib/reversal.mjs.

  plan      - a money, publish, permissions, install or outbound step that is not a locked approval becomes
              {"gate": "approval", "locked": true, "status": "pending_approval"} (AGENTS.md section 1).
  template  - a gradient becomes one solid colour (a blue to purple one is the "AI gradient" DESIGN.md
              forbids); glass (backdrop-filter) gets a prefers-reduced-transparency fallback; long words get
              overflow-wrap: anywhere.

Running the engine on its own output finds nothing more to correct.

    python3 reversal_engine.py plan plan.json
    python3 reversal_engine.py template page.html --out page.fixed.html
"""

import argparse
import hashlib
import json
import math
import re
import sys

RULES = ["lock-sensitive-step", "ai-gradient", "gradient", "reduced-transparency", "overflow-wrap"]
LOCKED_CATEGORIES = ["money", "publish", "permissions", "install", "outbound"]
LOCKED_TO = {"gate": "approval", "locked": True, "status": "pending_approval"}
# The lock words of jarvis/server/lib/llm-plan.mjs, English and Arabic, in the same order.
LOCK_RULES = [
    ("money", re.compile(r"\b(pay|payment|billing|bill|invoice|price|pricing|subscription|refund|transfer|wallet|money|charge|stripe)\b|دفع|ادفع|فاتور|مال|سعر|أسعار|اشتراك|تحويل|محفظ", re.I)),
    ("publish", re.compile(r"\b(publish|deploy|go live|production|release to|public site|launch)\b|نشر|انشر|إطلاق|اطلاق", re.I)),
    ("permissions", re.compile(r"\b(permission|permissions|access|role|grant|admin|sudo|collaborator)\b|صلاحي", re.I)),
    ("install", re.compile(r"\b(install|plugin|dependency|dependencies|npm i|pip install|add (a |the )?skill)\b|تثبيت|ثبت|ثبّت", re.I)),
    ("outbound", re.compile(r"\b(e-?mail|send|message|webhook|tweet|slack|notify|outbound|external|post to)\b|أرسل|ارسل|إرسال|ارسال|بريد|رسالة|خارجي", re.I)),
]
MAX_STEPS = 20
MAX_TEXT = 200000


def sha256_hex(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def compact(value):
    """The same text as JSON.stringify for plain data, so the hashes match the server's."""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def clean(s):
    return re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f\x7f]", " ", "" if s is None else str(s))).strip()


def lock_category(text):
    for cat, rule in LOCK_RULES:
        if rule.search(text):
            return cat
    return None


def correction_vector(corrections):
    values = [sum(1 for c in corrections if c["rule"] == r) for r in RULES]
    return {"rules": RULES, "values": values, "total": sum(values)}


def describe(c):
    if c["rule"] == "lock-sensitive-step":
        was = ("locked, status " + (c["from"]["status"] or "none")) if c["from"]["locked"] else "not locked"
        return f"step {c['step'] + 1} «{c['title']}» ({c['category']}) was {was}; now a locked approval, pending_approval"
    if c["rule"] == "reduced-transparency":
        return "glass without a fallback: " + ", ".join(c["selectors"]) + "; now solid under prefers-reduced-transparency"
    if c["rule"] == "overflow-wrap":
        return "long words could overflow; added overflow-wrap: anywhere"
    kind = "blue to purple gradient" if c["rule"] == "ai-gradient" else "gradient"
    return f"{kind} in {c['property']}; now {c['to']}"


def sealed(kind, before_text, after_text, corrections, extra):
    before, after = sha256_hex(before_text), sha256_hex(after_text)
    out = {"kind": kind, "corrections": corrections, "vector": correction_vector(corrections), "before": before, "after": after,
           "proofHash": sha256_hex(before + "\n" + after + "\n" + compact(corrections)), "changed": bool(corrections)}
    out.update(extra)
    return out


def reverse_and_correct_plan(raw_steps):
    """Each step keeps its fields; a sensitive one is forced to a locked approval that waits for a person."""
    items = list(raw_steps)[:MAX_STEPS] if isinstance(raw_steps, list) else []
    steps, corrections = [], []
    for i, raw in enumerate(items):
        o = raw if isinstance(raw, dict) else {"title": raw}
        title = clean(o.get("title") or o.get("name") or o.get("description") or f"Step {i + 1}")[:140] or f"Step {i + 1}"
        text = " ".join([title, clean(o.get("description")), clean(o.get("kind")), clean(o.get("category")), clean(o.get("tool"))])
        declared = o.get("locked") is True or str(o.get("gate") or "").lower() == "approval"
        cat = lock_category(text) or (str(o.get("category")) if str(o.get("category")) in LOCKED_CATEGORIES else None)
        if not cat and declared:
            cat = "outbound"
        step = dict(o, title=title)
        if cat:
            was = {"gate": None if o.get("gate") is None else str(o.get("gate")), "locked": o.get("locked") is True, "status": None if o.get("status") is None else str(o.get("status"))}
            if was["gate"] != "approval" or not was["locked"] or was["status"] != "pending_approval":
                corrections.append({"rule": "lock-sensitive-step", "step": i, "title": title, "category": cat, "from": was, "to": LOCKED_TO})
            step.update(kind="approval", category=cat, **LOCKED_TO)
        steps.append(step)
    sensitive = [s for s in steps if s.get("category") in LOCKED_CATEGORIES]
    proof = {"verified": all(s.get("locked") is True and s.get("status") == "pending_approval" and s.get("gate") == "approval" for s in sensitive),
             "sensitive": len(sensitive), "locked": sum(1 for s in steps if s.get("locked") is True)}
    return sealed("plan", compact(items), compact(steps), corrections, {"steps": steps, "proof": proof})


# ---- Template rules -----------------------------------------------------------------------------------
# Every scan below is one linear pass or a pattern with bounded repeats, so a 200 KB paste of hostile text
# takes milliseconds, not minutes.
GRADIENT = re.compile(r"(?:repeating-)?(?:linear|radial|conic)-gradient\((?:[^()]|\([^()]{0,200}\)){0,2000}\)", re.I)
COLOUR = re.compile(r"#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|\b(?:rgba?|hsla?|oklch|oklab|lch|lab)\([^()]{0,200}\)|\b[a-z]{1,30}\b", re.I)
NAMED = {"blue": 240, "navy": 240, "royalblue": 225, "dodgerblue": 210, "deepskyblue": 195, "steelblue": 207, "cornflowerblue": 219, "mediumblue": 240, "darkblue": 240, "cyan": 180, "aqua": 180,
         "purple": 300, "violet": 300, "indigo": 275, "magenta": 300, "fuchsia": 300, "orchid": 302, "plum": 300, "mediumpurple": 260, "blueviolet": 271, "darkviolet": 282, "rebeccapurple": 270, "slateblue": 248,
         "red": 0, "orange": 39, "yellow": 60, "green": 120, "lime": 120, "teal": 180, "pink": 350, "black": None, "white": None, "gray": None, "grey": None, "transparent": None}
UNKNOWN = object()


def _rgb_hue(r, g, b):
    mx, mn = max(r, g, b), min(r, g, b)
    d = mx - mn
    if d < 8:
        return None
    if mx == r:
        h = math.fmod((g - b) / d, 6)
    elif mx == g:
        h = (b - r) / d + 2
    else:
        h = (r - g) / d + 4
    return _js_round(h * 60) % 360


def _js_round(x):
    """JavaScript's Math.round: halves go up."""
    return math.floor(x + 0.5)


def hue_of(c):
    """The hue in HSL degrees, None for a grey, UNKNOWN for a word that is not a colour. OKLCH and LCH hues
    sit about 22 degrees above HSL's for the same colour, so they are moved onto the HSL wheel."""
    s = str(c).strip().lower()
    m = re.fullmatch(r"#([0-9a-f]{3}|[0-9a-f]{6})", s)
    if m:
        h = m.group(1) if len(m.group(1)) == 6 else "".join(x * 2 for x in m.group(1))
        return _rgb_hue(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
    m = re.match(r"rgba?\(\s*([\d.]+)%?[\s,]+([\d.]+)%?[\s,]+([\d.]+)", s)
    if m:
        return _rgb_hue(float(m.group(1)), float(m.group(2)), float(m.group(3)))
    m = re.match(r"hsla?\(\s*(-?[\d.]+)", s)
    if m:
        return float(m.group(1)) % 360
    m = re.match(r"(?:oklch|lch)\(\s*[\d.]+%?\s+([\d.]+)%?\s+(-?[\d.]+)", s)
    if m:
        if float(m.group(1)) < 0.02 and not s.startswith("lch"):
            return None
        return _js_round(float(m.group(2)) - 22) % 360
    return NAMED.get(s, UNKNOWN)


def gradient_colours(g):
    inner = g[g.index("(") + 1:-1]
    return [c for c in COLOUR.findall(inner) if hue_of(c) is not UNKNOWN]


def is_ai_gradient(g):
    hs = [hue_of(c) for c in gradient_colours(g)]
    return any(h is not None and 190 <= h < 255 for h in hs) and any(h is not None and 255 <= h < 320 for h in hs)


STOP = set(";{}\"'<>")
PROP = re.compile(r"\s*([a-z-]{1,60})(\s*:\s*)", re.I)


def _fix_gradients(text, corrections):
    """A declaration runs from the last ; { } " ' < or > before the gradient to the next one after it."""
    n = len(text)
    prev_stop, next_stop = [0] * (n + 1), [n] * (n + 1)
    for i, ch in enumerate(text):
        prev_stop[i + 1] = i + 1 if ch in STOP else prev_stop[i]
    for i in range(n - 1, -1, -1):
        next_stop[i] = i if text[i] in STOP else next_stop[i + 1]
    out, last = [], 0
    for g in GRADIENT.finditer(text):
        if g.start() < last:
            continue
        a = max(prev_stop[g.start()], last)
        d = PROP.match(text, a)
        if not d or d.end() > g.start():
            continue
        b = next_stop[g.end()]
        value = text[d.end():b]
        grads = GRADIENT.findall(value)
        colours = gradient_colours(grads[0])
        solid = colours[0] if colours else "transparent"
        corrections.append({"rule": "ai-gradient" if any(is_ai_gradient(x) for x in grads) else "gradient", "property": d.group(1).lower(), "from": value.strip()[:200], "to": solid})
        lead = re.match(r"\s*", d.group(0)).group(0)
        tail = value[len(value.rstrip()):]
        body = "background-color" + d.group(2) + solid if re.fullmatch(r"background(-image)?", d.group(1), re.I) else d.group(1) + d.group(2) + "none"
        out.append(text[last:a] + lead + body + tail)
        last = b
    out.append(text[last:])
    return "".join(out)


def is_html(t):
    return bool(re.search(r"<(?:!doctype|html|head|body|style|div|section|main|p|h[1-6])\b", t, re.I))


def css_of(t):
    if not is_html(t):
        return t
    low, parts, i = t.lower(), [], t.lower().find("<style")
    while i >= 0:
        if not re.match(r"<style[\s>]", low[i:i + 7]):
            i = low.find("<style", i + 6)
            continue
        opened = low.find(">", i)
        close = -1 if opened < 0 else low.find("</style>", opened)
        if close < 0:
            break
        parts.append(t[opened + 1:close])
        i = low.find("<style", close + 8)
    return "\n".join(parts)


def css_blocks(css):
    """The innermost blocks of a stylesheet in one pass: selector, body, and whether they sit inside an
    @media (prefers-reduced-transparency) block."""
    out, stack, run = [], [], 0
    for i, c in enumerate(css):
        if c == "{":
            prelude = css[run:i]
            parent = stack[-1] if stack else None
            if parent:
                parent["leaf"] = False
            fallback = (parent["fallback"] if parent else False) or bool(re.match(r"\s*@media\b[^{]*prefers-reduced-transparency", prelude, re.I))
            stack.append({"prelude": prelude, "start": i + 1, "leaf": True, "fallback": fallback})
            run = i + 1
        elif c == "}":
            b = stack.pop() if stack else None
            if b and b["leaf"] and not re.search(r"[@;]", b["prelude"]) and b["prelude"].strip():
                out.append({"selector": b["prelude"].strip(), "body": css[b["start"]:i], "fallback": b["fallback"]})
            run = i + 1
        elif c == ";":
            run = i + 1
    return out


GLASS = re.compile(r"(?:^|[;\s])(?:-webkit-)?backdrop-filter\s*:\s*(?!none\b)[^;]", re.I)


def glass_selectors(css):
    blocks = css_blocks(css)
    covered = {s.strip() for b in blocks if b["fallback"] for s in b["selector"].split(",")}
    missing = []
    for b in blocks:
        if b["fallback"] or not GLASS.search(b["body"]):
            continue
        for s in (x.strip() for x in b["selector"].split(",")):
            if s and s not in covered and s not in missing:
                missing.append(s)
    return missing


WRAP_RULE = ":where(h1, h2, h3, h4, p, li, td, th, dd, dt, a, blockquote, figcaption) { overflow-wrap: anywhere; }"


def _add_css(text, css):
    if not is_html(text):
        return text.rstrip() + "\n" + css + "\n"
    low = text.lower()
    at = low.rfind("</style>")
    if at >= 0:
        return text[:at] + css + "\n" + text[at:]
    head = low.find("</head>")
    if head >= 0:
        return text[:head] + "<style>\n" + css + "\n</style>\n" + text[head:]
    return "<style>\n" + css + "\n</style>\n" + text


def reverse_and_correct_template(source):
    original = ("" if source is None else str(source))[:MAX_TEXT]
    corrections = []
    text = _fix_gradients(original, corrections)
    missing = glass_selectors(css_of(text))
    added = []
    if missing:
        added.append("@media (prefers-reduced-transparency: reduce) {\n  " + ", ".join(missing) + " { -webkit-backdrop-filter: none; backdrop-filter: none; background-color: Canvas; color: CanvasText; }\n}")
        corrections.append({"rule": "reduced-transparency", "selectors": missing, "to": "solid Canvas background when the person asks for less transparency"})
    if not re.search(r"overflow-wrap\s*:\s*anywhere", css_of(text), re.I) and original.strip():
        added.append(WRAP_RULE)
        corrections.append({"rule": "overflow-wrap", "to": WRAP_RULE})
    if added:
        text = _add_css(text, "\n".join(added))
    return sealed("template", original, text, corrections, {"text": text, "html": is_html(original)})


def main(argv=None):
    ap = argparse.ArgumentParser(description="Correct a plan or a page template by the repository's rules; prints JSON.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan", help="a JSON file: a list of steps, or {\"steps\": [...]}")
    p.add_argument("file")
    t = sub.add_parser("template", help="an HTML or CSS file")
    t.add_argument("file")
    t.add_argument("--out", help="write the corrected copy here (never over the input)")
    a = ap.parse_args(argv)
    with open(a.file, encoding="utf-8") as fh:
        raw = fh.read()
    if a.cmd == "plan":
        data = json.loads(raw)
        out = reverse_and_correct_plan(data.get("steps") if isinstance(data, dict) else data)
    else:
        out = reverse_and_correct_template(raw)
        if a.out:
            if a.out == a.file:
                ap.error("--out must not be the input file")
            with open(a.out, "w", encoding="utf-8") as fh:
                fh.write(out["text"])
    out["lines"] = [describe(c) for c in out["corrections"]]
    json.dump(out, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
