"""Director 00's long-term memory and approval ledger.

PgStore   : Postgres + pgvector (docker compose --profile director), cosine search on an HNSW index.
            Uses pg8000, a pure-Python driver, so no native DLL has to load on this laptop.
SqliteStore: the same interface in a local SQLite file with NumPy cosine search, for running without Docker.

Writes (add, approval decisions, results) are only ever called from the graph's execute/approval steps, after a human
decision. Reads (search, pending) are free.
"""

import json
import os
import sqlite3
import time
from pathlib import Path
from typing import Protocol
from urllib.parse import unquote, urlparse

import numpy as np

KINDS = ("fact", "decision", "outcome", "preference", "note")
SCHEMA = Path(__file__).resolve().parents[2] / "db" / "director" / "01-memory.sql"


class Store(Protocol):
    def add(self, kind: str, content: str, embedding: list[float], approved_by: str, metadata: dict | None = None,
            agent: str = "director-00") -> int: ...
    def search(self, embedding: list[float], k: int = 5, agent: str = "director-00") -> list[dict]: ...
    def create_pending(self, thread_id: str, request: str, proposal: dict) -> None: ...
    def decide(self, thread_id: str, status: str, by: str) -> None: ...
    def finish(self, thread_id: str, status: str, result: dict) -> None: ...
    def pending(self) -> list[dict]: ...
    def approval(self, thread_id: str) -> dict | None: ...


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


class PgStore:
    def __init__(self, url: str):
        import pg8000.native
        u = urlparse(url)
        # ?sslmode=disable skips the SSL handshake (localhost-only Docker port, or the PGlite test server).
        ssl = False if "sslmode=disable" in (u.query or "") else None
        self.con = pg8000.native.Connection(user=unquote(u.username or ""), password=unquote(u.password or ""),
                                            host=u.hostname or "127.0.0.1", port=u.port or 5432,
                                            database=(u.path or "/omega_memory").lstrip("/"), timeout=10, ssl_context=ssl)

    def close(self) -> None:
        self.con.close()

    def ensure_schema(self) -> None:
        """Apply db/director/01-memory.sql (idempotent). Docker runs it on first start; this covers other hosts."""
        for stmt in [s.strip() for s in SCHEMA.read_text(encoding="utf-8").split(";")]:
            body = "\n".join(line for line in stmt.splitlines() if not line.strip().startswith("--")).strip()
            if body:
                self.con.run(body)

    @staticmethod
    def _vec(e: list[float]) -> str:
        return "[" + ",".join(f"{x:.6f}" for x in e) + "]"

    def add(self, kind, content, embedding, approved_by, metadata=None, agent="director-00") -> int:
        rows = self.con.run(
            "INSERT INTO agent_memories (agent, kind, content, metadata, embedding, approved_by) "
            "VALUES (:a, :k, :c, CAST(:m AS jsonb), CAST(:e AS vector), :by) RETURNING id",
            a=agent, k=kind, c=content, m=json.dumps(metadata or {}), e=self._vec(embedding), by=approved_by)
        return int(rows[0][0])

    def search(self, embedding, k=5, agent="director-00") -> list[dict]:
        rows = self.con.run(
            "SELECT id, kind, content, metadata, created_at, 1 - (embedding <=> CAST(:e AS vector)) AS score "
            "FROM agent_memories WHERE agent = :a ORDER BY embedding <=> CAST(:e AS vector) LIMIT :k",
            e=self._vec(embedding), a=agent, k=k)
        return [{"id": r[0], "kind": r[1], "content": r[2], "metadata": r[3] if isinstance(r[3], dict) else json.loads(r[3] or "{}"),
                 "created_at": r[4].isoformat() if hasattr(r[4], "isoformat") else str(r[4]), "score": round(float(r[5]), 4)} for r in rows]

    def create_pending(self, thread_id, request, proposal) -> None:
        self.con.run("INSERT INTO director_approvals (thread_id, request, proposal) VALUES (:t, :r, CAST(:p AS jsonb)) "
                     "ON CONFLICT (thread_id) DO NOTHING", t=thread_id, r=request, p=json.dumps(proposal))

    def decide(self, thread_id, status, by) -> None:
        self.con.run("UPDATE director_approvals SET status = :s, decided_by = :b, decided_at = now() "
                     "WHERE thread_id = :t AND status = 'pending'", s=status, b=by, t=thread_id)

    def finish(self, thread_id, status, result) -> None:
        self.con.run("UPDATE director_approvals SET status = :s, result = CAST(:r AS jsonb) WHERE thread_id = :t",
                     s=status, r=json.dumps(result), t=thread_id)

    def pending(self) -> list[dict]:
        rows = self.con.run("SELECT thread_id, request, proposal, created_at FROM director_approvals "
                            "WHERE status = 'pending' ORDER BY created_at")
        return [{"thread_id": r[0], "request": r[1], "proposal": r[2] if isinstance(r[2], dict) else json.loads(r[2]),
                 "created_at": str(r[3])} for r in rows]

    def approval(self, thread_id) -> dict | None:
        rows = self.con.run("SELECT status, decided_by, result FROM director_approvals WHERE thread_id = :t", t=thread_id)
        return {"status": rows[0][0], "decided_by": rows[0][1], "result": rows[0][2]} if rows else None


class SqliteStore:
    def __init__(self, path: str | Path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS agent_memories (id INTEGER PRIMARY KEY, agent TEXT NOT NULL, kind TEXT NOT NULL,
                content TEXT NOT NULL, metadata TEXT NOT NULL, embedding BLOB NOT NULL, approved_by TEXT NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS director_approvals (thread_id TEXT PRIMARY KEY, request TEXT NOT NULL, proposal TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending', decided_by TEXT, decided_at TEXT, result TEXT, created_at TEXT NOT NULL);
        """)

    def add(self, kind, content, embedding, approved_by, metadata=None, agent="director-00") -> int:
        if kind not in KINDS or not 1 <= len(content) <= 4000:
            raise ValueError("invalid memory")
        cur = self.db.execute("INSERT INTO agent_memories (agent, kind, content, metadata, embedding, approved_by, created_at) "
                              "VALUES (?, ?, ?, ?, ?, ?, ?)", (agent, kind, content, json.dumps(metadata or {}),
                                                               np.asarray(embedding, dtype=np.float32).tobytes(), approved_by, _now()))
        self.db.commit()
        return int(cur.lastrowid)

    def search(self, embedding, k=5, agent="director-00") -> list[dict]:
        rows = self.db.execute("SELECT id, kind, content, metadata, created_at, embedding FROM agent_memories WHERE agent = ?",
                               (agent,)).fetchall()
        if not rows:
            return []
        q = np.asarray(embedding, dtype=np.float32)
        mat = np.stack([np.frombuffer(r[5], dtype=np.float32) for r in rows])
        scores = mat @ q / (np.linalg.norm(mat, axis=1) * (np.linalg.norm(q) or 1.0) + 1e-9)
        order = np.argsort(-scores)[:k]
        return [{"id": rows[i][0], "kind": rows[i][1], "content": rows[i][2], "metadata": json.loads(rows[i][3]),
                 "created_at": rows[i][4], "score": round(float(scores[i]), 4)} for i in order]

    def create_pending(self, thread_id, request, proposal) -> None:
        self.db.execute("INSERT OR IGNORE INTO director_approvals (thread_id, request, proposal, created_at) VALUES (?, ?, ?, ?)",
                        (thread_id, request, json.dumps(proposal), _now()))
        self.db.commit()

    def decide(self, thread_id, status, by) -> None:
        self.db.execute("UPDATE director_approvals SET status = ?, decided_by = ?, decided_at = ? WHERE thread_id = ? AND status = 'pending'",
                        (status, by, _now(), thread_id))
        self.db.commit()

    def finish(self, thread_id, status, result) -> None:
        self.db.execute("UPDATE director_approvals SET status = ?, result = ? WHERE thread_id = ?", (status, json.dumps(result), thread_id))
        self.db.commit()

    def pending(self) -> list[dict]:
        rows = self.db.execute("SELECT thread_id, request, proposal, created_at FROM director_approvals WHERE status = 'pending' "
                               "ORDER BY created_at").fetchall()
        return [{"thread_id": r[0], "request": r[1], "proposal": json.loads(r[2]), "created_at": r[3]} for r in rows]

    def approval(self, thread_id) -> dict | None:
        r = self.db.execute("SELECT status, decided_by, result FROM director_approvals WHERE thread_id = ?", (thread_id,)).fetchone()
        return {"status": r[0], "decided_by": r[1], "result": json.loads(r[2]) if r[2] else None} if r else None


def get_store(data_dir: Path) -> Store:
    url = os.environ.get("DIRECTOR_DB_URL", "").strip()
    if url and "${" not in url:
        store = PgStore(url)
        store.ensure_schema()
        return store
    return SqliteStore(data_dir / "director.sqlite")
