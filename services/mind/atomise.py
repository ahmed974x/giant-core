"""أمين للأفكار: splits a note into atoms and types each one (ADR-081). Pure functions, no model needed.

A note is split on new lines and sentence ends; each piece becomes one atom with one type:
idea, question, task, fact, worry, decision, quote or source. Heuristics only: they are predictable,
explainable and free. The local model may relabel later, but it is never needed for the map to work.
"""

from __future__ import annotations

import re

TYPES = ("idea", "question", "task", "fact", "worry", "decision", "quote", "source")
MAX_ATOMS = 60
MAX_ATOM_CHARS = 2000

URL = re.compile(r"https?://\S+")
QUOTE = re.compile(r"[«\"“].{3,}?[»\"”]")
SPLIT = re.compile(r"(?<=[.!?؟;])\s+|\n+")
BULLET = re.compile(r"^\s*(?:[-*•·]+|\d{1,2}[.)])\s*")
ENTITY = re.compile(r"(?:#|@)?\b[A-Z][A-Za-z0-9]{2,}\b|#[\w]{2,}", re.UNICODE)

QUESTION_WORDS = {"ليش", "لماذا", "كيف", "ماذا", "هل", "متى", "أين", "وين", "ايش", "شنو", "why", "how", "what", "when",
                  "where", "should", "is", "are", "do", "does", "can", "could"}
TASK_PHRASES = ("لازم", "سوي", "اسوي", "اتصل", "ارسل", "اكتب", "اشتر", "احجز", "حط", "todo", "need to", "must",
                "remember to", "call", "buy", "send", "write")
WORRY_PHRASES = ("خايف", "قلقان", "اخاف", "أخاف", "مشكلة", "ما أقدر", "worried", "afraid", "anxious", "worry",
                 "what if", "ماذا لو", "لو ما", "fail")
DECISION_PHRASES = ("قررت", "قراري", "قرار", "decided", "i will", "i choose", "my decision")
FACT_HINT = re.compile(r"\d|%|=|\$|usd|usdt|kg|km|%")


def _words(text: str) -> list[str]:
    return [w.strip(".,!?؟;:()[]\"'«»").lower() for w in text.split() if w.strip(".,!?؟;:()[]\"'«»")]


def _has_phrase(text: str, phrases: tuple[str, ...]) -> bool:
    low = f" {text.lower()} "
    return any(f" {p} " in low or (p in low and len(p) > 4) for p in phrases)


def split_atoms(note: str) -> list[str]:
    """One note -> the list of atom texts, in order. Empty pieces and duplicates are dropped."""
    out: list[str] = []
    for line in note.replace("\r", "\n").split("\n"):
        line = BULLET.sub("", line).strip()
        if not line:
            continue
        for piece in SPLIT.split(line):
            piece = piece.strip()
            if piece and piece not in out:
                out.append(piece[:MAX_ATOM_CHARS])
            if len(out) >= MAX_ATOMS:
                return out
    return out


def classify(atom: str) -> str:
    """The type of one atom. Order matters: a link is a source before anything else; a question wins over a task."""
    text = atom.strip()
    words = _words(text)
    if not words:
        return "idea"
    if URL.fullmatch(text) or (URL.search(text) and len(words) <= 3):
        return "source"
    if text.endswith(("?", "؟")) or words[0] in QUESTION_WORDS:
        return "question"
    if _has_phrase(text, WORRY_PHRASES):
        return "worry"
    if _has_phrase(text, DECISION_PHRASES):
        return "decision"
    if _has_phrase(text, TASK_PHRASES):
        return "task"
    if QUOTE.search(text):
        return "quote"
    if FACT_HINT.search(text):
        return "fact"
    return "idea"


def entities(atom: str) -> list[str]:
    """Names, #tags and @mentions in an atom (Latin capitalised words, plus tags). Arabic names are kept as words."""
    found: list[str] = []
    for m in ENTITY.findall(atom):
        e = m.lstrip("#@")
        if e.lower() not in {x.lower() for x in found} and len(found) < 20:
            found.append(e)
    return found


def atomise(note: str) -> list[dict]:
    """A note -> [{text, type, entities, source_url}] ready for the database."""
    items = []
    for text in split_atoms(note):
        url = URL.search(text)
        items.append({"text": text, "type": classify(text), "entities": entities(text),
                      "source_url": url.group(0) if url else None})
    return items
