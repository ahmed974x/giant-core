"""Candidate links between atoms, each with a confidence and a one-line reason (ADR-081, section 12.1 step 5).

Signals: meaning (cosine of the embeddings), shared names, and a negation that flips between two close atoms
(the contradiction alarm). Every candidate is a suggestion: nothing here is accepted on the owner's behalf.
"""

from __future__ import annotations

import math
from datetime import datetime

NEGATION = {"لا", "ليس", "لن", "ما", "not", "no", "never", "don't", "won't", "isn't"}
MAX_PER_ATOM = 5
LEAD_MIN = 0.35        # a task or answer needs this much meaning in common to be suggested
CONTRA_MIN = 0.70      # opposite wording is only flagged when the two are about the same thing


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def _negated(text: str) -> bool:
    words = {w.strip(".,!?؟;:").lower() for w in text.split()}
    return bool(words & NEGATION)


def _when(value) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def candidates(new: list[dict], old: list[dict], similar_min: float) -> list[dict]:
    """Links between each new atom and the others (old or new). Each dict: src, dst, type, confidence, why.

    Atoms need: id, text, type, entities, embedding, captured_at. Symmetric 'similar_to' is returned once.
    """
    pool = {n["id"]: n for n in old}
    pool.update({n["id"]: n for n in new})
    out: list[dict] = []
    seen: set[tuple[int, int, str]] = set()
    for a in new:
        scored = []
        for b in pool.values():
            if b["id"] == a["id"]:
                continue
            sim = cosine(a.get("embedding") or [], b.get("embedding") or [])
            shared = sorted(set(a.get("entities") or []) & set(b.get("entities") or []))
            for kind, conf, why in _relations(a, b, sim, shared, similar_min):
                scored.append((conf, a, b, kind, why))
        scored.sort(key=lambda x: -x[0])
        for conf, x, y, kind, why in scored[:MAX_PER_ATOM]:
            src, dst = (x["id"], y["id"])
            if kind == "similar_to":
                src, dst = min(src, dst), max(src, dst)
            key = (src, dst, kind)
            if key in seen:
                continue
            seen.add(key)
            out.append({"src": src, "dst": dst, "type": kind, "confidence": round(min(max(conf, 0.0), 1.0), 3), "why": why[:300]})
    return out


def _relations(a: dict, b: dict, sim: float, shared: list[str], similar_min: float):
    flipped = _negated(a["text"]) != _negated(b["text"])
    if sim >= similar_min and not flipped:          # opposite claims are never merged as "similar"
        yield "similar_to", sim, f"similar wording ({sim:.2f})"
    if shared and (a["type"], b["type"]) in {("idea", "task"), ("task", "idea")} and sim >= 0.15:
        idea, task = (a, b) if a["type"] == "idea" else (b, a)
        yield "leads_to", 0.4 + 0.5 * sim, f"idea that leads to a task: {idea['id']} -> {task['id']} (shared: {', '.join(shared[:3])})"
    elif (a["type"], b["type"]) in {("idea", "task"), ("task", "idea")} and sim >= LEAD_MIN:
        idea, task = (a, b) if a["type"] == "idea" else (b, a)
        yield "leads_to", 0.3 + 0.5 * sim, f"the task reads like the idea ({sim:.2f})"
    if {a["type"], b["type"]} == {"fact", "question"} and sim >= LEAD_MIN:
        fact, question = (a, b) if a["type"] == "fact" else (b, a)
        yield "answers", 0.3 + 0.6 * sim, f"this fact may answer the question ({sim:.2f})"
    if sim >= CONTRA_MIN and flipped:
        yield "contradicts", sim * 0.6, "close wording with opposite negation: check both dates"
    if shared and sim >= 0.1 and a["type"] != "question" and b["type"] != "question":
        yield "mentions", 0.2 + 0.3 * sim, f"both mention {', '.join(shared[:3])}"
