"""Prompt meta-codes (ADR-156): the same engine as jarvis/server/lib/prompt-metacodes.mjs, in the standard library.

Five codes change what the answer holds, and there is always an answer (no refusal). A money, publishing,
permissions, install or outbound step is always a locked approval that waits for Director 00 (AGENTS.md §1).
  ALT3       three plans: the fastest slice, the most careful (tests first, mutation, contrast), self-hosted
  KILLCRITIC findings against the repository's gates, each with its fix
  X10THINK   four stages: assumptions, model, reverse check, edge cases
  EL10       one plain sentence per plan
  /HUMAN     the answer as a short paragraph
For the same request, this file and the server give the same JSON and the same SHA-256.
No network, no processes; the contrast maths comes from the reviewed replica-reversal-engine skill beside it.
"""
import argparse
import hashlib
import json
import os
import re
import sys

# The reviewed contrast maths: the sibling skill's folder, or this folder when the file is copied next to it.
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(os.path.dirname(_HERE), "replica-reversal-engine"), _HERE]
from reversal_engine import heal_oklch_contrast  # noqa: E402

METACODES = ["/HUMAN", "EL10", "X10THINK", "KILLCRITIC", "ALT3"]
MC_LIMITS = {"chars": 4000, "urls": 20}
MC_SENSITIVE = ["money", "publish", "permissions", "install", "outbound"]
_F = re.I | re.A
MC_LOCK_RULES = [
    ("money", re.compile(r"\b(pay|payment|billing|bill|invoice|price|pricing|subscription|refund|transfer|wallet|money|charge|stripe)\b|دفع|ادفع|فاتور|مال|سعر|أسعار|اشتراك|تحويل|محفظ", _F)),
    ("publish", re.compile(r"\b(publish|deploy|go live|production|release to|public site|launch)\b|نشر|انشر|إطلاق|اطلاق", _F)),
    ("permissions", re.compile(r"\b(permission|permissions|access|role|grant|admin|sudo|collaborator)\b|صلاحي", _F)),
    ("install", re.compile(r"\b(install|plugin|dependency|dependencies|npm i|pip install|add (a |the )?skill)\b|تثبيت|ثبت|ثبّت", _F)),
    ("outbound", re.compile(r"\b(e-?mail|send|message|webhook|tweet|slack|notify|outbound|external|post to)\b|أرسل|ارسل|إرسال|ارسال|بريد|رسالة|خارجي", _F)),
]
MC_SECRET = re.compile(r"\b(?:sk-[A-Za-z0-9_-]{16,200}|ghp_[A-Za-z0-9]{20,200}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,200})\b", re.A)
MC_URL = re.compile(r"https?://[!#-&(-;=?-~]{1,200}", _F)
MC_HEX = re.compile(r"#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z])", re.A)
_TRAIL = re.compile(r"[.,;:!?،؛]+\Z")
_CLAUSE = re.compile(r"[.;!?،؛]|\bthen\b|ثم", _F)
_GRADIENT = re.compile(r"gradient|تدرج", _F)
_IPV4 = re.compile(r"(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})", re.A)

MC_TEXT = {
    "opt.speed": ["The fastest slice", "أسرع شريحة عاملة"],
    "opt.proof": ["The most careful: tests and proof first", "الأكثر حرصاً: الاختبارات والبرهان أولاً"],
    "opt.selfhost": ["Self-hosted on this computer", "مستضاف ذاتياً على هذا الجهاز"],
    "step.read": ["Read the request and the decision records", "اقرأ الطلب وسجلات القرارات"],
    "step.slice": ["Build the smallest working slice", "ابنِ أصغر شريحة تعمل"],
    "step.testsFirst": ["Write the tests and the oracle first", "اكتب الاختبارات والمرجع أولاً"],
    "step.build": ["Build until every test passes", "ابنِ حتى تنجح كل الاختبارات"],
    "step.local": ["Build it on 127.0.0.1 with no hosted service", "ابنِه على 127.0.0.1 دون أي خدمة مستضافة"],
    "step.tests": ["Run the server and flow tests", "شغّل اختبارات الخادم والمسارات"],
    "step.mutation": ["Run the mutation harness to 100%", "شغّل اختبار الطفرات حتى 100%"],
    "step.contrast": ["Check contrast: WCAG 4.5 and APCA 60", "افحص التباين: WCAG 4.5 و APCA 60"],
    "step.security": ["Run SkillSpector: 0 critical, 0 high", "شغّل SkillSpector: 0 حرج و 0 عالٍ"],
    "step.export": ["Export it as files you keep", "صدّره ملفاتٍ تحتفظ بها"],
    "step.approval": ["Wait for Director 00: {list}", "انتظر موافقة المدير 00: {list}"],
    "el10.speed": ["Do the smallest thing that works, test it, and stop.", "افعل أصغر شيء يعمل، واختبره، ثم توقّف."],
    "el10.proof": ["Write the checks first, then build until every check passes.", "اكتب الفحوص أولاً، ثم ابنِ حتى تنجح كلها."],
    "el10.selfhost": ["Run everything on this computer, check it, and keep the files yourself.", "شغّل كل شيء على هذا الجهاز، وافحصه، واحتفظ بالملفات بنفسك."],
    "cat.money": ["money", "المال"], "cat.publish": ["publishing", "النشر"], "cat.permissions": ["permissions", "الصلاحيات"],
    "cat.install": ["installing", "التثبيت"], "cat.outbound": ["outbound messages", "الرسائل الخارجية"],
    "crit.locks": ["Steps that need a person: they stay locked approvals in every plan.", "خطوات تحتاج إلى شخص: تبقى موافقات مقفلة في كل خطة."],
    "crit.nolocks": ["No money, publishing, permission, install or outbound step.", "لا خطوة مال أو نشر أو صلاحيات أو تثبيت أو رسائل خارجية."],
    "crit.secret": ["Secret-shaped text was pasted. It was removed from the copy; revoke it.", "لُصق نص يشبه مفتاحاً سرياً. حُذف من النسخة؛ ألغِ المفتاح."],
    "crit.private": ["Private addresses are refused by the SSRF shield.", "العناوين الخاصة يرفضها درع SSRF."],
    "crit.public": ["Public addresses are read only through the SSRF shield: one GET, robots.txt obeyed.", "العناوين العامة تُقرأ فقط عبر درع SSRF: طلب GET واحد مع احترام robots.txt."],
    "crit.gradient": ["DESIGN.md allows one solid accent: no blue to purple gradient.", "DESIGN.md يسمح بلون مميز واحد: لا تدرج من الأزرق إلى البنفسجي."],
    "crit.contrastOk": ["The first two colours pass WCAG 4.5 and APCA 60.", "اللونان الأولان يجتازان WCAG 4.5 و APCA 60."],
    "crit.contrastHeal": ["The first two colours miss WCAG 4.5 or APCA 60; the healed text colour keeps the hue.", "اللونان الأولان لا يبلغان WCAG 4.5 أو APCA 60؛ لون النص المعالَج يحفظ درجة اللون."],
    "crit.contrastNo": ["No lightness of this text colour passes on that background; change the background.", "لا سطوع لهذا اللون يجتاز على تلك الخلفية؛ غيّر الخلفية."],
    "crit.manual": ["Not checked from text: the three screen sizes and the 27 UI states. Run them before a commit.", "لا يُفحص من النص: المقاسات الثلاثة وحالات الواجهة السبع والعشرون. شغّلها قبل أي كومِت."],
    "x10.assume": ["Assumptions: what the request says", "الفرضيات: ما يقوله الطلب"],
    "x10.model": ["Model: the plans built from it", "النموذج: الخطط المبنية منه"],
    "x10.check": ["Reverse check: every sensitive step is a locked approval", "التحقق العكسي: كل خطوة حساسة موافقة مقفلة"],
    "x10.edge": ["Edge cases: what was cut, refused or removed", "الحالات الحدية: ما قُطع أو رُفض أو حُذف"],
    "human.asked": ["Parts in the request: {n}.", "عدد أجزاء الطلب: {n}."],
    "human.locks": ["{n} of them need Director 00 first: {list}.", "{n} منها تحتاج إلى المدير 00 أولاً: {list}."],
    "human.nolocks": ["None of them needs an approval.", "لا شيء منها يحتاج إلى موافقة."],
    "human.plans": ["The plans have {list} steps.", "عدد خطوات الخطط: {list}."],
    "human.end": ["Nothing that moves money, publishes, changes access, installs or sends runs without a person.", "لا شيء يحرّك المال أو ينشر أو يغيّر الصلاحيات أو يثبّت أو يرسل يعمل دون شخص."],
    "empty": ["No request text: these are the default plans.", "لا نص للطلب: هذه هي الخطط الافتراضية."],
    "err.prompt": ["The request must be text.", "يجب أن يكون الطلب نصاً."],
}


def js_num(x):
    """A number as JavaScript's String() writes it, for the values this engine prints (no exponent form)."""
    if x == 0:
        return "0"
    if float(x).is_integer():
        return str(int(x))
    return repr(float(x))


def mc_text(key, lang, vars_=None):
    pair = MC_TEXT.get(key)
    s = pair[1 if lang == "ar" else 0] if pair else key
    for k, v in (vars_ or {}).items():
        s = s.replace("{" + k + "}", str(v))
    return s


def _join_list(items, lang):
    return ("، " if lang == "ar" else ", ").join(items)


def parse_metacodes(text):
    """One pass over the words: the codes come out, the rest is the request. Trailing punctuation is ignored."""
    full = text if isinstance(text, str) else ""
    src = full[:MC_LIMITS["chars"]]
    codes, words, w = [], [], []

    def flush():
        if not w:
            return
        word = "".join(w)
        bare = _TRAIL.sub("", word).upper()
        if bare in METACODES:
            if bare not in codes:
                codes.append(bare)
        else:
            words.append(word)
        w.clear()

    for c in src:
        if c in " \n\t\r":
            flush()
        else:
            w.append(c)
    flush()
    return {"codes": codes, "prompt": " ".join(words), "truncated": len(full) > MC_LIMITS["chars"]}


def private_host(url):
    """localhost, an IPv6 literal, or an IPv4 literal in a private or local range."""
    after = re.sub(r"^https?://", "", url, count=1, flags=re.I)
    host = []
    for c in after:
        if c in "/?#":
            break
        host.append(c)
    h = re.sub(r"^[^@]*@", "", "".join(host), count=1).lower()
    if h.startswith("["):
        return True
    h = h.split(":")[0]
    if h == "localhost" or h.endswith(".localhost"):
        return True
    m = _IPV4.fullmatch(h)
    if not m:
        return False
    a, b = int(m.group(1)), int(m.group(2))
    return a == 10 or a == 127 or a == 0 or (a == 169 and b == 254) or (a == 172 and 16 <= b <= 31) or (a == 192 and b == 168) or (a == 100 and 64 <= b <= 127)


def sensitive_categories(text):
    return [cat for cat, rx in MC_LOCK_RULES if rx.search(text)]


def prove_option(steps):
    """Every approval is a locked approval waiting for a person, no other step is sensitive, and each step
    depends only on the one before it."""
    for i, s in enumerate(steps):
        if s["kind"] == "approval":
            good = s["gate"] == "approval" and s["locked"] is True and s["status"] == "pending_approval" and s["category"] in MC_SENSITIVE
        else:
            good = s["locked"] is False and s["category"] not in MC_SENSITIVE
        if not good or s["after"] != (None if i == 0 else i - 1):
            return False
    return True


OPTION_STEPS = {
    "speed": [("tool", "step.read"), ("build", "step.slice"), ("gate", "step.tests")],
    "proof": [("tool", "step.read"), ("gate", "step.testsFirst"), ("build", "step.build"), ("gate", "step.tests"), ("gate", "step.mutation"), ("gate", "step.contrast")],
    "selfhost": [("tool", "step.read"), ("build", "step.local"), ("gate", "step.tests"), ("gate", "step.security"), ("tool", "step.export")],
}


def build_option(oid, cats, lang):
    steps = [{"kind": kind, "title": mc_text(key, lang), "category": None, "gate": "check" if kind == "gate" else None, "locked": False, "status": "ready"}
             for kind, key in OPTION_STEPS[oid]]
    for cat in cats:
        steps.append({"kind": "approval", "title": mc_text("step.approval", lang, {"list": mc_text("cat." + cat, lang)}), "category": cat,
                      "gate": "approval", "locked": True, "status": "pending_approval"})
    for i, s in enumerate(steps):
        s["after"] = None if i == 0 else i - 1
    return {"id": oid, "title": mc_text("opt." + oid, lang), "tag": "[INFERENCE]", "steps": steps,
            "counts": {"steps": len(steps), "gates": sum(1 for s in steps if s["kind"] == "gate"), "approvals": sum(1 for s in steps if s["kind"] == "approval")},
            "proved": prove_option(steps)}


def js_json(obj):
    """JSON.stringify's text: no spaces, raw non-ASCII, lone surrogates escaped."""
    text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    return re.sub(r"[\ud800-\udfff]", lambda m: f"\\u{ord(m.group(0)):04x}", text)


def sha256_hex(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def compile_metacodes(req):
    r = req if isinstance(req, dict) else {}
    lang = "ar" if r.get("lang") == "ar" else "en"
    parsed = parse_metacodes(r.get("prompt"))
    raw = r.get("codes")
    pressed = [c.upper() for c in raw if isinstance(c, str)] if isinstance(raw, list) else []
    active = [c for c in METACODES if c in parsed["codes"] or c in pressed]
    codes = active or ["ALT3"]
    prompt, secrets = MC_SECRET.subn("[redacted]", parsed["prompt"])
    words = len(prompt.split(" ")) if prompt else 0
    clauses = sum(1 for c in _CLAUSE.split(prompt) if c.replace(" ", "")) if prompt else 0
    cats = sensitive_categories(prompt)
    urls = MC_URL.findall(prompt)[:MC_LIMITS["urls"]]
    refused = [u for u in urls if private_host(u)]
    allowed = [u for u in urls if not private_host(u)]
    colours = MC_HEX.findall(prompt)[:2]
    options = [build_option(oid, cats, lang) for oid in (["speed", "proof", "selfhost"] if "ALT3" in codes else ["selfhost"])]
    cat_names = [mc_text("cat." + c, lang) for c in cats]
    out = {"codes": codes, "lang": lang, "prompt": prompt, "options": options}
    if "KILLCRITIC" in codes:
        f = [{"level": "high", "text": mc_text("crit.locks", lang), "data": cat_names} if cats else {"level": "ok", "text": mc_text("crit.nolocks", lang), "data": []}]
        if secrets:
            f.append({"level": "high", "text": mc_text("crit.secret", lang), "data": [str(secrets)]})
        if refused:
            f.append({"level": "high", "text": mc_text("crit.private", lang), "data": refused})
        if allowed:
            f.append({"level": "low", "text": mc_text("crit.public", lang), "data": allowed})
        if _GRADIENT.search(prompt):
            f.append({"level": "medium", "text": mc_text("crit.gradient", lang), "data": []})
        if len(colours) == 2:
            h = heal_oklch_contrast(colours[0], colours[1])
            pair = colours[0] + " / " + colours[1]
            if not h["ok"]:
                f.append({"level": "high", "text": mc_text("crit.contrastNo", lang), "data": [pair]})
            elif not h["changed"]:
                f.append({"level": "ok", "text": mc_text("crit.contrastOk", lang), "data": [pair, "WCAG " + js_num(h["before"]["ratio"]), "APCA Lc " + js_num(h["before"]["lc"])]})
            else:
                b, a = h["before"], h["after"]
                f.append({"level": "high", "text": mc_text("crit.contrastHeal", lang), "data": [colours[0] + " → " + a["hex"], "WCAG " + js_num(b["ratio"]) + " → " + js_num(a["ratio"]),
                                                                                               "APCA Lc " + js_num(b["lc"]) + " → " + js_num(a["lc"])]})
        f.append({"level": "manual", "text": mc_text("crit.manual", lang), "data": []})
        out["critic"] = f
    if "X10THINK" in codes:
        out["stages"] = [
            {"text": mc_text("x10.assume", lang), "data": ["words " + str(words), "clauses " + str(clauses), "urls " + str(len(urls)), "colours " + str(len(colours)), *cat_names]},
            {"text": mc_text("x10.model", lang), "data": [o["id"] + " " + str(o["counts"]["steps"]) for o in options]},
            {"text": mc_text("x10.check", lang), "data": [o["id"] + " " + ("proved" if o["proved"] else "not proved") for o in options]},
            {"text": mc_text("x10.edge", lang), "data": ["cut at " + str(MC_LIMITS["chars"]) if parsed["truncated"] else "not cut", "refused " + str(len(refused)),
                                                         "secrets removed " + str(secrets), *([] if prompt else [mc_text("empty", lang)])]},
        ]
    if "EL10" in codes:
        out["plain"] = [mc_text("el10." + o["id"], lang) for o in options]
    if "/HUMAN" in codes:
        out["human"] = " ".join([
            mc_text("human.asked", lang, {"n": max(1, clauses)}) if prompt else mc_text("empty", lang),
            mc_text("human.locks", lang, {"n": len(cats), "list": _join_list(cat_names, lang)}) if cats else mc_text("human.nolocks", lang),
            mc_text("human.plans", lang, {"list": _join_list([str(o["counts"]["steps"]) for o in options], lang)}),
            mc_text("human.end", lang)])
    out["verified"] = all(o["proved"] for o in options)
    out["sha256"] = sha256_hex(js_json(out))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="Prompt meta-codes: three plans, a critic and four thinking stages (ADR-156).")
    ap.add_argument("file", help="a JSON request {prompt, codes, lang}, or - for standard input")
    a = ap.parse_args(argv)
    if a.file == "-":
        text = sys.stdin.read(64 * 1024 + 1)
    else:
        with open(a.file, encoding="utf-8") as fh:
            text = fh.read(64 * 1024 + 1)
    if len(text) > 64 * 1024:
        print(json.dumps({"error": "The request is larger than 64 KB."}), file=sys.stderr)
        return 2
    try:
        req = json.loads(text)
    except json.JSONDecodeError:
        print(json.dumps({"error": "The request is not valid JSON."}), file=sys.stderr)
        return 2
    if not isinstance(req, dict) or not isinstance(req.get("prompt", ""), str):
        print(json.dumps({"error": mc_text("err.prompt", "en")}), file=sys.stderr)
        return 2
    print(json.dumps(compile_metacodes(req), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
