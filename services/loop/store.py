"""The planner's door to the database (the `hakeem` login, ADR-082). Every call is a loop.* or mem.* function.

The database enforces the budgets, refuses secrets, and keeps the checkpoints append-only. A budget stop is
already recorded as 'incomplete' by the database, so `finish` then does nothing; the last checkpoint keeps what the
run had (loop.resume returns it).
"""

from __future__ import annotations

import json
import os

import pg8000.native


def connect() -> pg8000.native.Connection:
    return pg8000.native.Connection(
        user=os.environ.get("LOOP_DB_USER", "hakeem"), password=os.environ["HAKEEM_DB_PASSWORD"],
        host=os.environ.get("AMEEN_DB_HOST", "timescale"), port=int(os.environ.get("AMEEN_DB_PORT", "5432")),
        database=os.environ.get("POSTGRES_DB", "omega"), unix_sock=os.environ.get("AMEEN_DB_SOCKET") or None,
        application_name="loop")


class DBStore:
    def __init__(self, db):
        self.db = db

    def start(self, goal: str, max_steps: int, max_tokens: int):
        rows = self.db.run("SELECT loop.start('hakeem', :g, :s, :t, NULL)::text", g=goal, s=max_steps, t=max_tokens)
        return rows[0][0] if rows and rows[0][0] else None

    def step(self, run_id: str, node: str, state: dict, tokens: int) -> dict:
        rows = self.db.run("SELECT loop.step('hakeem', CAST(:r AS uuid), :n, CAST(:st AS jsonb), :tk, NULL)::text",
                           r=run_id, n=node, st=json.dumps(state, ensure_ascii=False), tk=int(tokens))
        return json.loads(rows[0][0])

    def finish(self, run_id: str, status: str, report: dict) -> None:
        try:
            self.db.run("SELECT loop.finish('hakeem', CAST(:r AS uuid), :s, CAST(:rep AS jsonb), NULL)",
                        r=run_id, s=status, rep=json.dumps(report, ensure_ascii=False))
        except pg8000.exceptions.DatabaseError as exc:
            if "is not running" not in str(exc):   # a budget stop already closed the run
                raise

    def recall(self, goal: str) -> list[str]:
        rows = self.db.run("SELECT text FROM mem.search(:q, NULL, 5, 'owner', NULL)", q=goal)
        return [r[0] for r in rows]

    def learn(self, goal: str, status: str, sources: list[dict]) -> None:
        # The episode records the outcome, not the question: the goal stays in the loop log only.
        summary = f"brain loop answered ({status}, {len(sources)} sources)"
        self.db.run("SELECT mem.log_episode('hakeem', :s, CAST(:d AS jsonb), 'agent', NULL, '[]', 'owner')",
                    s=summary, d=json.dumps({"status": status, "sources": len(sources)}))

    def resume(self, run_id: str):
        rows = self.db.run("SELECT loop.resume('hakeem', CAST(:r AS uuid), NULL)::text", r=run_id)
        return json.loads(rows[0][0]) if rows and rows[0][0] else None
