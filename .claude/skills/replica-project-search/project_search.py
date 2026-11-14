"""Project search (ADR-164): the same answers as jarvis/server/lib/project-search.mjs, standard library only.

The repository's own documents (every ADR, every security review, every skill's SKILL.md) searched by three lexical
rankers fused with Reciprocal Rank Fusion (k = 60, each list cut at 50):
  body   Okapi BM25 (k1 1.2, b 0.75) over the title, headings and text, with the memory bank's Arabic and English
         tokenizer (jarvis/server/lib/bm25.mjs, ADR-138)
  field  the same BM25 over the title and headings only
  title  character trigrams of the query against each title (Dice at least 0.3), for misspelt names
Nothing is semantic or learned: a document sharing no word or trigram with the query is not found, and the
answer says so. `corpus` reads the repository's Markdown files and writes the corpus; the search reads nothing.

    python3 project_search.py corpus --root . --out jarvis/app/data/search-corpus.json
    python3 project_search.py search jarvis/app/data/search-corpus.json "contrast healer oklch"
"""
import argparse
import json
import math
import os
import sys
import unicodedata

PS_K = 60
PS_DEPTH = 50
PS_KINDS = ["adr", "review", "skill"]
PS_CAP = 2000
STOP = {"a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have", "in", "is", "it", "its", "of", "on", "or", "that", "the", "this", "to", "was", "were", "will", "with", "في", "من", "على", "الى", "إلى", "عن", "مع", "هذا", "هذه", "ذلك", "التي", "الذي", "و", "او", "أو", "ما", "لا", "ثم", "قد", "كان", "كانت", "هو", "هي", "هم"}
_MARKS = {chr(c) for c in range(0x064B, 0x0671)} | {"ٟ", "ـ"}
_FOLD = {"إ": "ا", "أ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي", "ة": "ه", "ؤ": "و", "ئ": "ي"}
_MISSING = object()


class SearchError(ValueError):
    def __init__(self, message, detail=None):
        super().__init__(message)
        self.status = 400
        self.detail = None if detail is None else str(detail)[:80]


def _fail(message, detail=None):
    raise SearchError(message, detail)


def js_round(v, p):
    """Math.round(v * p) / p as JavaScript computes it, whole numbers as int."""
    x = math.floor(v * p + 0.5) / p
    return int(x) if x.is_integer() else x


def _len16(s):
    return len(s.encode("utf-16-le")) // 2


def normalize(text):
    s = str(text or "").lower()
    return "".join(_FOLD.get(c, c) for c in s if c not in _MARKS)


def _word(c):
    return unicodedata.category(c)[0] in "LN"


def _split(s):
    out, cur = [], []
    for c in s:
        if _word(c):
            cur.append(c)
        elif cur:
            out.append("".join(cur))
            cur = []
    if cur:
        out.append("".join(cur))
    return out


def tokenize(text):
    return [t for t in _split(normalize(text)) if _len16(t) > 1 and t not in STOP]


def _by_score(items):
    return sorted(items, key=lambda x: (-x["score"], x["id"]))


def bm25_rank(docs, field, terms):
    if not docs:
        return []
    q = list(dict.fromkeys(terms))
    toks = [tokenize(field(d)) for d in docs]
    avg = sum(len(t) for t in toks) / len(docs)
    df = {t: sum(1 for ts in toks if t in ts) for t in q}
    out = []
    for i, d in enumerate(docs):
        score, hit = 0, []
        for t in q:
            f = toks[i].count(t)
            if not f:
                continue
            idf = math.log(1 + (len(docs) - df[t] + 0.5) / (df[t] + 0.5))
            score += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * len(toks[i]) / avg))
            hit.append(t)
        if score > 0:
            out.append({"id": d["id"], "score": js_round(score, 1000), "terms": hit})
    return _by_score(out)


def trigrams(text):
    s = " " + " ".join(_split(normalize(text))) + " "
    return {s[i:i + 3] for i in range(len(s) - 2)}


def dice(a, b):
    s = len(a) + len(b)
    if not s:
        return 0
    return js_round(2 * len(a & b) / s, 10000)


def title_rank(docs, query):
    q = trigrams(query)
    return _by_score(x for x in ({"id": d["id"], "score": dice(q, trigrams(d["title"]))} for d in docs) if x["score"] >= 0.3)


def rrf(lists, k):
    score, ranks = {}, {}
    for name, lst in lists:
        for i, x in enumerate(lst[:PS_DEPTH]):
            score[x["id"]] = score.get(x["id"], 0) + 1 / (k + i + 1)
            ranks.setdefault(x["id"], {})[name] = i + 1
    return _by_score({"id": i, "score": js_round(s, 1e6), "ranks": ranks[i]} for i, s in score.items())


def snippet(text, terms):
    want = set(terms)
    for line in text.split("\n"):
        ln = line.strip()
        if not ln or ln.startswith("|") or ln.startswith("#"):
            continue
        if any(t in want for t in tokenize(ln)):
            return ln[:199] + "…" if _len16(ln) > 200 else ln
    return None


def _check_corpus(corpus):
    docs = corpus.get("docs") if isinstance(corpus, dict) else None
    if not isinstance(docs, list) or len(docs) > 1000:
        _fail("Send the corpus.", "corpus")
    seen = set()
    for i, d in enumerate(docs):
        if (not isinstance(d, dict) or not isinstance(d.get("id"), str) or not d["id"] or d["id"] in seen or not isinstance(d.get("title"), str) or not isinstance(d.get("text"), str)
                or d.get("kind") not in PS_KINDS or not isinstance(d.get("headings"), list) or not all(isinstance(x, str) for x in d["headings"])):
            _fail("Each document has its own id, a kind, a title, headings and text.", "docs[" + str(i) + "]")
        seen.add(d["id"])
    return docs


def _whole(v, lo, hi):
    return ((isinstance(v, int) and not isinstance(v, bool)) or (isinstance(v, float) and v.is_integer())) and lo <= v <= hi


def search_project(corpus, req):
    every = _check_corpus(corpus)
    r = req if isinstance(req, dict) else _fail("Send an object with a query.", "")
    query = r.get("query")
    if not isinstance(query, str) or not query.strip() or _len16(query) > 300:
        _fail("The query is text of 1 to 300 characters.", "query")
    kinds = r.get("kinds", _MISSING)
    if kinds is _MISSING:
        kinds = PS_KINDS
    elif not isinstance(kinds, list) or not kinds or not all(k in PS_KINDS for k in kinds):
        _fail("Kinds are " + ", ".join(PS_KINDS) + ".", "kinds")
    limit = r.get("limit", _MISSING)
    if limit is _MISSING:
        limit = 10
    elif not _whole(limit, 1, 20):
        _fail("limit is a whole number from 1 to 20.", "limit")
    k = r.get("k", _MISSING)
    if k is _MISSING:
        k = PS_K
    elif not _whole(k, 1, 1000):
        _fail("k is a whole number from 1 to 1000.", "k")
    docs = [d for d in every if d["kind"] in kinds]
    terms = list(dict.fromkeys(tokenize(query)))
    body = bm25_rank(docs, lambda d: d["title"] + "\n" + "\n".join(d["headings"]) + "\n" + d["text"], terms)
    field = bm25_rank(docs, lambda d: d["title"] + "\n" + "\n".join(d["headings"]), terms)
    title = title_rank(docs, query)
    score_of = {n: {x["id"]: x["score"] for x in lst} for n, lst in (("body", body), ("field", field), ("title", title))}
    by_id = {d["id"]: d for d in docs}
    terms_of = {x["id"]: x["terms"] for x in body}
    results = []
    for x in rrf([["body", body], ["field", field], ["title", title]], k)[:int(limit)]:
        d = by_id[x["id"]]
        t = terms_of.get(d["id"], [])
        results.append({"id": d["id"], "kind": d["kind"], "path": d.get("path"), "title": d["title"], "score": x["score"], "ranks": x["ranks"],
                        "scores": {n: score_of[n][d["id"]] for n in x["ranks"]}, "terms": t, "snippet": snippet(d["text"], t)})
    return {"query": query, "terms": terms, "k": k, "depth": PS_DEPTH, "counts": {"docs": len(docs), "body": len(body), "field": len(field), "title": len(title)}, "results": results,
            "found": bool(results), "method": "lexical: BM25 body, BM25 title and headings, title trigrams, fused by RRF"}


def _doc(kind, path, raw):
    lines = raw.split("\n")
    title, headings, body = path, [], []
    if lines and lines[0] == "---":
        end = lines.index("---", 1) if "---" in lines[1:] else 0
        meta = {k.strip(): v.strip() for k, _, v in (ln.partition(":") for ln in lines[1:end] if ":" in ln)}
        title = meta.get("name", title)
        body.append(meta.get("description", ""))
        lines = lines[end + 1:]
    for ln in lines:
        if ln.startswith("# ") and title == path:
            title = ln[2:].strip()
        elif ln.startswith("## ") and len(headings) < 20:
            headings.append(ln[3:].strip())
        else:
            body.append(ln)
    text = "\n".join(x for x in body if x.strip())[:PS_CAP]
    return {"id": path, "kind": kind, "path": path, "title": title, "headings": headings, "text": text}


def corpus(root):
    """The repository's ADRs, security reviews and SKILL.md files. Files only; nothing is fetched or run."""
    docs = []
    for kind, folder in (("adr", "docs/adr"), ("review", "docs/security")):
        for name in sorted(os.listdir(os.path.join(root, folder))):
            if name.endswith(".md"):
                with open(os.path.join(root, folder, name), encoding="utf-8") as fh:
                    docs.append(_doc(kind, folder + "/" + name, fh.read()))
    base = os.path.join(root, ".claude", "skills")
    for name in sorted(os.listdir(base)):
        p = os.path.join(base, name, "SKILL.md")
        if os.path.isfile(p):
            with open(p, encoding="utf-8") as fh:
                docs.append(_doc("skill", ".claude/skills/" + name + "/SKILL.md", fh.read()))
    return {"format": "jarvis-search-corpus-v1", "cap": PS_CAP, "docs": docs}


def main(argv=None):
    p = argparse.ArgumentParser(description="Project search (ADR-164).")
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("corpus")
    c.add_argument("--root", default=".")
    c.add_argument("--out", required=True)
    s = sub.add_parser("search")
    s.add_argument("corpus")
    s.add_argument("query")
    a = p.parse_args(argv)
    try:
        if a.cmd == "corpus":
            snap = corpus(a.root)
            with open(a.out, "w", encoding="utf-8") as fh:
                fh.write(json.dumps(snap, ensure_ascii=False) + "\n")
            print(f"project_search: wrote {a.out} · {len(snap['docs'])} documents")
            return 0
        with open(a.corpus, encoding="utf-8") as fh:
            print(json.dumps(search_project(json.load(fh), {"query": a.query}), ensure_ascii=False))
        return 0
    except SearchError as e:
        print(json.dumps({"error": str(e), "detail": e.detail}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
