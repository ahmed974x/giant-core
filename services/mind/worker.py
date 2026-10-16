"""The nightly run for the second brain (ADR-081): recompute themes, refresh the Markdown export.

Runs in its own thread beside the HTTP API. Once a day at MIND_NIGHT_HOUR (UTC) it: recomputes the clusters,
writes the Markdown export, and logs the digest counts (never the text). It is a no-op on an empty brain.
"""

from __future__ import annotations

import logging
import os
import time
from datetime import UTC, datetime

import service
import store

NIGHT_HOUR = int(os.environ.get("MIND_NIGHT_HOUR", "2"))
log = logging.getLogger("mind.worker")


def due(now: datetime, last_day: str | None, hour: int = NIGHT_HOUR) -> bool:
    return now.hour >= hour and now.date().isoformat() != last_day


def run_once() -> dict:
    db = store.connect()
    try:
        clusters = service.refresh_clusters(db)
        exported = service.export(db)
        d = service.digest(db)
        out = {"clusters": clusters, "exported": exported, "loops": len(d["loops"]), "suggestions": d["open_suggestions"]}
        log.info("nightly brain run: %s", out)
        return out
    finally:
        db.close()


def loop(every: int = 300) -> None:
    last = None
    while True:
        now = datetime.now(UTC)
        if due(now, last):
            try:
                run_once()
                last = now.date().isoformat()
            except Exception:  # keep the loop alive; the next tick retries
                log.exception("nightly brain run failed")
        time.sleep(every)
