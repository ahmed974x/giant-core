"""The rescue functions (ADR-081, section 12.2): brain dump, loop detector, daily collision, think with me.

All of them are plain functions over the owner's atoms. They suggest and ask; they never change the graph,
never send anything outside, and never produce a trading proposal. Nothing here imports the proposal tools.
"""

from __future__ import annotations

import random
from collections import defaultdict
from datetime import datetime, timedelta

from linker import cosine

MAX_THEMES = 7
MAX_NEXT = 3


def brain_dump(atoms: list[dict]) -> dict:
    """A dump of many thoughts -> 3 to 7 themes, open questions, at most 3 next actions, and the parked rest."""
    themes: list[list[dict]] = []
    for a in atoms:
        if a["type"] == "task":
            continue
        for group in themes:
            if cosine(a.get("embedding") or [], group[0].get("embedding") or []) >= 0.4:
                group.append(a)
                break
        else:
            themes.append([a])
    themes.sort(key=lambda g: -len(g))
    shown, parked_groups = themes[:MAX_THEMES], themes[MAX_THEMES:]
    tasks = [a for a in atoms if a["type"] == "task"]
    questions = [a for a in atoms if a["type"] == "question"][:5]
    parked = [a for g in parked_groups for a in g] + tasks[MAX_NEXT:]
    return {
        "themes": [{"title": g[0]["text"][:60], "ids": [a["id"] for a in g]} for g in shown],
        "questions": [{"id": a["id"], "text": a["text"]} for a in questions],
        "next_actions": [{"id": a["id"], "text": a["text"]} for a in tasks[:MAX_NEXT]],
        "parked": [{"id": a["id"], "text": a["text"]} for a in parked],
    }


def find_loops(atoms: list[dict], edges: list[dict], now: datetime, days: int = 7, repeats: int = 3,
               same: float = 0.85) -> list[dict]:
    """The same worry or idea back on 3+ different days, with no task, decision or answer that closes it."""
    since = now - timedelta(days=days)
    recent = [a for a in atoms if _when(a["captured_at"]) >= since and a["type"] in ("idea", "worry", "question")]
    closed = set()
    for e in edges:
        if e["type"] in ("leads_to", "answers", "part_of") and e["state"] != "rejected":
            closed.update((e["src"], e["dst"]))
    groups: list[list[dict]] = []
    for a in recent:
        for g in groups:
            if cosine(a.get("embedding") or [], g[0].get("embedding") or []) >= same:
                g.append(a)
                break
        else:
            groups.append([a])
    loops = []
    for g in groups:
        days_seen = {_when(a["captured_at"]).date() for a in g}
        if len(days_seen) < repeats or any(a["id"] in closed for a in g):
            continue
        questions = [a for a in g if a["type"] == "question"]
        loops.append({
            "ids": [a["id"] for a in g],
            "days": len(days_seen),
            "versions": [a["text"][:160] for a in g[:3]],
            "question": (questions[0]["text"] if questions else
                         "what single answer or decision would settle this?"),
        })
    return sorted(loops, key=lambda x: -x["days"])[:5]


def collision(atoms: list[dict], clusters: dict[int, int], day_key: str, lo: float = 0.2, hi: float = 0.5) -> dict | None:
    """Serendipity: two atoms from different themes that are related, but not too similar. Seeded per day."""
    pool = [a for a in atoms if a["id"] in clusters and a.get("embedding")]
    pairs = []
    for i, a in enumerate(pool):
        for b in pool[i + 1:]:
            if clusters[a["id"]] == clusters[b["id"]]:
                continue
            sim = cosine(a["embedding"], b["embedding"])
            if lo <= sim < hi:
                pairs.append((sim, a, b))
    if not pairs:
        return None
    pairs.sort(key=lambda p: -p[0])
    rng = random.Random(day_key)                       # the same day gives the same pair
    _, a, b = pairs[rng.randrange(min(len(pairs), 10))]
    return {"a": {"id": a["id"], "text": a["text"][:160]}, "b": {"id": b["id"], "text": b["text"][:160]},
            "question": f"ماذا لو ارتبط «{a['text'][:60]}» بـ «{b['text'][:60]}»؟ ما الجسر بينهما؟"}


def think(question: str, hits: list[dict]) -> dict:
    """Answer only from the owner's own atoms, cite them, and ask the next question (no lecturing, no invention)."""
    if not hits:
        return {"answer": "ما لقيت شي في عقلك عن هذا بعد. تبي تكتب عنه شوي؟", "cites": [], "next_question": None}
    lines = [f"- {h['text'][:160]} [#{h['id']}]" for h in hits[:3]]
    open_q = next((h for h in hits if h["type"] == "question"), None)
    nxt = (f"إيش اللي يجاوب هذا السؤال: «{open_q['text'][:80]}»؟" if open_q
           else "وش أصغر خطوة تقدر تسويها اليوم عن هذا؟")
    return {"answer": "من ملاحظاتك:\n" + "\n".join(lines), "cites": [h["id"] for h in hits[:3]], "next_question": nxt}


def _when(value) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def by_day(atoms: list[dict]) -> dict[str, int]:
    out: dict[str, int] = defaultdict(int)
    for a in atoms:
        out[_when(a["captured_at"]).date().isoformat()] += 1
    return dict(out)
