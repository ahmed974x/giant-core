"""Risk policy for Director 00 proposals.

LOW-risk proposals need one approval. HIGH-risk proposals need a second, explicit confirmation (typed phrase) after the
first approval. A proposal is HIGH when any of these hold:

  - production writes : DIRECTOR_ENV=production and it writes memory (the shared Postgres is production then)
  - external reach    : a notification whose target is not localhost (DIRECTOR_NOTIFY_URL outside 127.0.0.1)
  - bulk memory change: more than DIRECTOR_MEMORY_WRITE_LIMIT memory writes (default 3), or one write longer than
                        DIRECTOR_MEMORY_SIZE_LIMIT characters (default 1000)
  - durable policy    : a 'decision' or 'preference' memory, which steers every later plan

Every rejection carries one of REJECTION_CODES and is logged to director_rejections.
"""

import os
import re

REJECTION_CODES = {
    "RISK-001": "Too risky: the expected benefit does not justify the action",
    "COMPLIANCE-002": "Conflicts with policy (ADR 006 public-data / ADR 007 bounded change)",
    "EXPIRED-003": "Not decided within the approval window",
    "ESCALATION-004": "Second confirmation for a high-risk action was declined or wrong",
    "USER-005": "Rejected by the approver for another reason",
}
LOCAL = re.compile(r"^https?://(127\.0\.0\.1|localhost)(:\d+)?/")


def notify_is_local() -> bool:
    return bool(LOCAL.match(os.environ.get("DIRECTOR_NOTIFY_URL", "").strip()))


def assess(actions: list[dict]) -> dict:
    reasons: list[str] = []
    writes = [a for a in actions if a.get("type") == "remember"]
    limit = int(os.environ.get("DIRECTOR_MEMORY_WRITE_LIMIT", "3"))
    size = int(os.environ.get("DIRECTOR_MEMORY_SIZE_LIMIT", "1000"))
    if writes and os.environ.get("DIRECTOR_ENV", "").lower() == "production":
        reasons.append("writes to the production memory database")
    if any(a.get("type") == "notify" for a in actions) and os.environ.get("DIRECTOR_NOTIFY_URL") and not notify_is_local():
        reasons.append("sends a notification outside localhost")
    if len(writes) > limit:
        reasons.append(f"{len(writes)} memory writes in one proposal (limit {limit})")
    if any(len(a.get("content", "")) > size for a in writes):
        reasons.append(f"a memory write longer than {size} characters")
    if any(a.get("kind") in ("decision", "preference") for a in writes):
        reasons.append("stores a decision or preference that steers future plans")
    return {"level": "high" if reasons else "low", "reasons": reasons}


def confirm_phrase(thread_id: str) -> str:
    """What the approver must type to confirm a high-risk proposal."""
    return f"CONFIRM {thread_id[-4:].upper()}"
