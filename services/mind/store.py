"""The only door to the second brain: every call goes through a brain.* function as the `ameen` login (ADR-081).

Nothing here reads or writes a table directly; the database refuses that for every login except the owner's admin.
"""

from __future__ import annotations

import json
import os

import pg8000.native


def connect() -> pg8000.native.Connection:
    return pg8000.native.Connection(
        user=os.environ.get("AMEEN_DB_USER", "ameen"), password=os.environ["AMEEN_DB_PASSWORD"],
        host=os.environ.get("AMEEN_DB_HOST", "timescale"), port=int(os.environ.get("AMEEN_DB_PORT", "5432")),
        database=os.environ.get("POSTGRES_DB", "omega"), unix_sock=os.environ.get("AMEEN_DB_SOCKET") or None,
        application_name="mind")


def _json(db, sql: str, **params):
    rows = db.run(sql, **params)
    value = rows[0][0] if rows else None
    if isinstance(value, str):
        return json.loads(value)
    return value


def capture(db, text: str, source: str = "text", source_url: str | None = None) -> int | None:
    rows = db.run("SELECT brain.capture('ameen', :t, :s, :u, false, 'owner', NULL)", t=text, s=source, u=source_url)
    return rows[0][0] if rows else None


def add_node(db, raw_id: int, atom: dict, embedding: list[float], model: str) -> int | None:
    rows = db.run("SELECT brain.add_node('ameen', :raw, :t, :ty, CAST(:ents AS text[]), CAST(:emb AS real[]), :m, 'owner', NULL)",
                  raw=raw_id, t=atom["text"], ty=atom["type"], ents=list(atom["entities"]), emb=[float(x) for x in embedding], m=model)
    return rows[0][0] if rows else None


def add_human_edge(db, src: int, dst: int, kind: str) -> int | None:
    rows = db.run("SELECT brain.add_human_edge('ameen', :s, :d, :k, 'owner', NULL)", s=src, d=dst, k=kind)
    return rows[0][0] if rows else None


def suggest_edge(db, link: dict) -> int | None:
    rows = db.run("SELECT brain.suggest_edge('ameen', :s, :d, :k, CAST(:c AS real), :w, 'owner', NULL)",
                  s=link["src"], d=link["dst"], k=link["type"], c=float(link["confidence"]), w=link["why"])
    return rows[0][0] if rows else None


def decide(db, edge: int, decision: str) -> None:
    db.run("SELECT brain.decide_edge('ameen', :e, :d, 'owner', NULL)", e=edge, d=decision)


def snapshot(db, limit: int = 5000) -> dict:
    value = _json(db, "SELECT brain.snapshot('ameen', 'owner', :n, NULL)::text", n=limit)
    return value or {"nodes": [], "edges": [], "clusters": [], "settings": {}}


def evidence(db, node: int) -> dict | None:
    return _json(db, "SELECT brain.evidence('ameen', :n, 'owner', NULL)::text", n=node)


def search(db, query: str, embedding: list[float] | None, k: int = 10) -> list[dict]:
    rows = db.run("SELECT id, text, type, cluster, score, captured_at, raw_id FROM brain.search('ameen', :q, "
                  "CAST(:emb AS real[]), :k, 'owner', NULL)", q=query, emb=embedding, k=k)
    cols = ["id", "text", "type", "cluster", "score", "captured_at", "raw_id"]
    return [dict(zip(cols, [str(v) if i == 5 else v for i, v in enumerate(r)], strict=True)) for r in rows]


def apply_clusters(db, clusters: list[dict], assign: dict[int, int]) -> int:
    rows = db.run("SELECT brain.apply_clusters('ameen', CAST(:c AS jsonb), CAST(:a AS jsonb), 'owner', NULL)",
                  c=json.dumps(clusters), a=json.dumps([{"id": k, "cluster": v} for k, v in assign.items()]))
    return rows[0][0] if rows else 0
