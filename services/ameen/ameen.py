"""أمين (Ameen), the memory keeper: the worker side of long-term memory (ADR-080).

    every AMEEN_EVERY seconds   embed facts and episodes that have no embedding yet (local embedder only)
    once a day at AMEEN_SLEEP_HOUR UTC   run mem.sleep(): archive old episodes, retire failing skills,
                                         report contradictions and overdue forecasts to the event log

It logs in as the `ameen` role (mem_keeper): it can call the memory functions, never read or write tables directly,
never resume an agent, never touch the paper account. Writing *facts* still goes through mem.assert_fact and the
nerve tool gateway like any other agent.
"""

from __future__ import annotations

import contextlib
import os
import signal
import time
from datetime import UTC, datetime

import pg8000.native
from embed import get_embedder

EVERY = int(os.environ.get("AMEEN_EVERY", "60"))
SLEEP_HOUR = int(os.environ.get("AMEEN_SLEEP_HOUR", "3"))
BATCH = int(os.environ.get("AMEEN_BATCH", "50"))


def connect() -> pg8000.native.Connection:
    return pg8000.native.Connection(
        user=os.environ.get("AMEEN_DB_USER", "ameen"), password=os.environ["AMEEN_DB_PASSWORD"],
        host=os.environ.get("AMEEN_DB_HOST", "timescale"), port=int(os.environ.get("AMEEN_DB_PORT", "5432")),
        database=os.environ.get("POSTGRES_DB", "omega"), unix_sock=os.environ.get("AMEEN_DB_SOCKET") or None,
        application_name="ameen")


def embed_pending(db, embedder, batch: int = BATCH) -> int:
    """Embed up to `batch` facts and `batch` episodes; returns how many were filled."""
    rows = db.run("SELECT kind, id, text FROM mem.pending_embeddings(:n)", n=batch)
    for kind, row_id, text in rows:
        db.run("SELECT mem.set_embedding(:k, :i, CAST(:v AS real[]), :m)", k=kind, i=row_id, v=embedder.embed(text), m=embedder.name)
    return len(rows)


def due_for_sleep(now: datetime, last_day: str | None, hour: int = SLEEP_HOUR) -> bool:
    """True once per UTC day, at or after `hour`."""
    return now.hour >= hour and now.strftime("%Y-%m-%d") != last_day


def main() -> None:
    embedder = get_embedder()
    stop = False

    def _stop(*_):
        nonlocal stop
        stop = True

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    print(f"ameen: embedder {embedder.name}, every {EVERY}s, sleep at {SLEEP_HOUR:02d}:00 UTC", flush=True)
    last_sleep_day: str | None = None
    db = None
    while not stop:
        try:
            db = db or connect()
            n = embed_pending(db, embedder)
            if n:
                print(f"ameen: embedded {n}", flush=True)
            now = datetime.now(UTC)
            if due_for_sleep(now, last_sleep_day):
                print(f"ameen: sleep {db.run('SELECT mem.sleep()')[0][0]}", flush=True)
                last_sleep_day = now.strftime("%Y-%m-%d")
        except (OSError, pg8000.exceptions.InterfaceError, pg8000.exceptions.DatabaseError) as e:
            print(f"ameen: {type(e).__name__}: {e}", flush=True)
            if db is not None:
                with contextlib.suppress(Exception):          # already broken; reconnect next round
                    db.close()
            db = None
        for _ in range(EVERY):
            if stop:
                break
            time.sleep(1)


if __name__ == "__main__":
    main()
