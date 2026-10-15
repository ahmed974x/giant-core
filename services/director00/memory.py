"""Director 00's long-term memory, approval ledger and rejection log.

PgStore    : Postgres + pgvector (docker compose --profile director), cosine search on an HNSW index.
             Uses pg8000, a pure-Python driver, so no native DLL has to load on this laptop.
SqliteStore: the same interface in a local SQLite file with NumPy cosine search, for running without Docker.

Approval lifecycle (director_approvals.status):
    pending ──approve──> approved ──> executed | failed                 (low risk)
    pending ──approve──> escalated ──confirm──> approved ──> executed   (high risk: second confirmation)
    pending | escalated ──reject / timeout──> rejected  (+ one director_rejections row with a reason code)

Writes to memory only happen from the graph's execute step, after the gate. Reads are free.
"""

import json
import os
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol
from urllib.parse import unquote, urlparse

import numpy as np

KINDS = ("fact", "decision", "outcome", "preference", "note")
SCHEMA_DIR = Path(__file__).resolve().parents[2] / "db" / "director"
LOW = {"level": "low", "reasons": []}


class Store(Protocol):
    def add(self, kind: str, content: str, embedding: list[float], approved_by: str, metadata: dict | None = None,
            agent: str = "director-00") -> int: ...
    def search(self, embedding: list[float], k: int = 5, agent: str = "director-00") -> list[dict]: ...
    def count(self, agent: str = "director-00") -> int: ...
    def create_pending(self, thread_id: str, request: str, proposal: dict, risk: dict | None = None) -> None: ...
    def decide(self, thread_id: str, status: str, by: str) -> None: ...
    def escalate(self, thread_id: str, by: str) -> None: ...
    def confirm(self, thread_id: str, by: str) -> None: ...
    def reject(self, thread_id: str, code: str, stage: str, reason: str, by: str) -> None: ...
    def finish(self, thread_id: str, status: str, result: dict) -> None: ...
    def pending(self) -> list[dict]: ...
    def approval(self, thread_id: str) -> dict | None: ...
    def rejections(self, thread_id: str | None = None) -> list[dict]: ...


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _ts(v) -> datetime:
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    return datetime.fromisoformat(str(v).replace("Z", "+00:00"))


def _j(v):
    return v if isinstance(v, (dict, list)) or v is None else json.loads(v)


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
        """Apply db/director/*.sql in order (idempotent). Docker runs them on first start; this covers other hosts."""
        for f in sorted(SCHEMA_DIR.glob("*.sql")):
            for stmt in f.read_text(encoding="utf-8").split(";"):
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
        return [{"id": r[0], "kind": r[1], "content": r[2], "metadata": _j(r[3]) or {},
                 "created_at": r[4].isoformat() if hasattr(r[4], "isoformat") else str(r[4]), "score": round(float(r[5]), 4)} for r in rows]

    def count(self, agent="director-00") -> int:
        return int(self.con.run("SELECT count(*) FROM agent_memories WHERE agent = :a", a=agent)[0][0])

    def create_pending(self, thread_id, request, proposal, risk=None) -> None:
        self.con.run("INSERT INTO director_approvals (thread_id, request, proposal, risk) VALUES (:t, :r, CAST(:p AS jsonb), CAST(:k AS jsonb)) "
                     "ON CONFLICT (thread_id) DO NOTHING", t=thread_id, r=request, p=json.dumps(proposal), k=json.dumps(risk or LOW))

    def decide(self, thread_id, status, by) -> None:
        self.con.run("UPDATE director_approvals SET status = :s, decided_by = :b, decided_at = now() "
                     "WHERE thread_id = :t AND status = 'pending'", s=status, b=by, t=thread_id)

    def escalate(self, thread_id, by) -> None:
        self.con.run("UPDATE director_approvals SET status = 'escalated', decided_by = :b, decided_at = now() "
                     "WHERE thread_id = :t AND status = 'pending'", b=by, t=thread_id)

    def confirm(self, thread_id, by) -> None:
        self.con.run("UPDATE director_approvals SET status = 'approved', confirmed_by = :b WHERE thread_id = :t AND status = 'escalated'",
                     b=by, t=thread_id)

    def reject(self, thread_id, code, stage, reason, by) -> None:
        rows = self.con.run("UPDATE director_approvals SET status = 'rejected', decided_by = COALESCE(decided_by, :b), decided_at = now() "
                            "WHERE thread_id = :t AND status IN ('pending', 'escalated') RETURNING thread_id", b=by, t=thread_id)
        if rows:
            self.con.run("INSERT INTO director_rejections (thread_id, code, stage, reason, rejected_by) VALUES (:t, :c, :s, :r, :b)",
                         t=thread_id, c=code, s=stage, r=reason, b=by)

    def finish(self, thread_id, status, result) -> None:
        self.con.run("UPDATE director_approvals SET status = :s, result = CAST(:r AS jsonb) WHERE thread_id = :t",
                     s=status, r=json.dumps(result), t=thread_id)

    def pending(self) -> list[dict]:
        rows = self.con.run("SELECT thread_id, request, proposal, created_at, status, risk FROM director_approvals "
                            "WHERE status IN ('pending', 'escalated') ORDER BY created_at")
        return [{"thread_id": r[0], "request": r[1], "proposal": _j(r[2]), "created_at": str(r[3]), "status": r[4], "risk": _j(r[5])} for r in rows]

    def approval(self, thread_id) -> dict | None:
        rows = self.con.run("SELECT status, decided_by, result, created_at, risk, confirmed_by FROM director_approvals WHERE thread_id = :t",
                            t=thread_id)
        if not rows:
            return None
        r = rows[0]
        return {"status": r[0], "decided_by": r[1], "result": _j(r[2]), "created_at": _ts(r[3]), "risk": _j(r[4]), "confirmed_by": r[5]}

    def rejections(self, thread_id=None) -> list[dict]:
        q = "SELECT thread_id, code, stage, reason, rejected_by, created_at FROM director_rejections"
        rows = self.con.run(q + " WHERE thread_id = :t ORDER BY id", t=thread_id) if thread_id else self.con.run(q + " ORDER BY id")
        return [{"thread_id": r[0], "code": r[1], "stage": r[2], "reason": r[3], "rejected_by": r[4], "created_at": str(r[5])} for r in rows]


class SqliteStore:
    def __init__(self, path: str | Path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.path = Path(path)
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS agent_memories (id INTEGER PRIMARY KEY, agent TEXT NOT NULL, kind TEXT NOT NULL,
                content TEXT NOT NULL, metadata TEXT NOT NULL, embedding BLOB NOT NULL, approved_by TEXT NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS director_approvals (thread_id TEXT PRIMARY KEY, request TEXT NOT NULL, proposal TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending', decided_by TEXT, decided_at TEXT, result TEXT, created_at TEXT NOT NULL,
                risk TEXT NOT NULL DEFAULT '{"level": "low", "reasons": []}', confirmed_by TEXT);
            CREATE TABLE IF NOT EXISTS director_rejections (id INTEGER PRIMARY KEY, thread_id TEXT NOT NULL, code TEXT NOT NULL,
                stage TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', rejected_by TEXT NOT NULL, created_at TEXT NOT NULL);
        """)
        cols = {r[1] for r in self.db.execute("PRAGMA table_info(director_approvals)")}
        for col, ddl in (("risk", "risk TEXT NOT NULL DEFAULT '{\"level\": \"low\", \"reasons\": []}'"), ("confirmed_by", "confirmed_by TEXT")):
            if col not in cols:                                  # upgrade files made by the first version
                self.db.execute(f"ALTER TABLE director_approvals ADD COLUMN {ddl}")
        self.db.commit()

    def _x(self, sql: str, args: tuple = ()) -> sqlite3.Cursor:
        cur = self.db.execute(sql, args)
        self.db.commit()
        return cur

    def add(self, kind, content, embedding, approved_by, metadata=None, agent="director-00") -> int:
        if kind not in KINDS or not 1 <= len(content) <= 4000:
            raise ValueError("invalid memory")
        cur = self._x("INSERT INTO agent_memories (agent, kind, content, metadata, embedding, approved_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                      (agent, kind, content, json.dumps(metadata or {}), np.asarray(embedding, dtype=np.float32).tobytes(), approved_by, _now()))
        return int(cur.lastrowid)

    def search(self, embedding, k=5, agent="director-00") -> list[dict]:
        rows = self.db.execute("SELECT id, kind, content, metadata, created_at, embedding FROM agent_memories WHERE agent = ?", (agent,)).fetchall()
        if not rows:
            return []
        q = np.asarray(embedding, dtype=np.float32)
        mat = np.stack([np.frombuffer(r[5], dtype=np.float32) for r in rows])
        scores = mat @ q / (np.linalg.norm(mat, axis=1) * (np.linalg.norm(q) or 1.0) + 1e-9)
        order = np.argsort(-scores)[:k]
        return [{"id": rows[i][0], "kind": rows[i][1], "content": rows[i][2], "metadata": json.loads(rows[i][3]),
                 "created_at": rows[i][4], "score": round(float(scores[i]), 4)} for i in order]

    def count(self, agent="director-00") -> int:
        return int(self.db.execute("SELECT count(*) FROM agent_memories WHERE agent = ?", (agent,)).fetchone()[0])

    def create_pending(self, thread_id, request, proposal, risk=None) -> None:
        self._x("INSERT OR IGNORE INTO director_approvals (thread_id, request, proposal, created_at, risk) VALUES (?, ?, ?, ?, ?)",
                (thread_id, request, json.dumps(proposal), _now(), json.dumps(risk or LOW)))

    def decide(self, thread_id, status, by) -> None:
        self._x("UPDATE director_approvals SET status = ?, decided_by = ?, decided_at = ? WHERE thread_id = ? AND status = 'pending'",
                (status, by, _now(), thread_id))

    def escalate(self, thread_id, by) -> None:
        self._x("UPDATE director_approvals SET status = 'escalated', decided_by = ?, decided_at = ? WHERE thread_id = ? AND status = 'pending'",
                (by, _now(), thread_id))

    def confirm(self, thread_id, by) -> None:
        self._x("UPDATE director_approvals SET status = 'approved', confirmed_by = ? WHERE thread_id = ? AND status = 'escalated'", (by, thread_id))

    def reject(self, thread_id, code, stage, reason, by) -> None:
        cur = self._x("UPDATE director_approvals SET status = 'rejected', decided_by = COALESCE(decided_by, ?), decided_at = ? "
                      "WHERE thread_id = ? AND status IN ('pending', 'escalated')", (by, _now(), thread_id))
        if cur.rowcount:
            self._x("INSERT INTO director_rejections (thread_id, code, stage, reason, rejected_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (thread_id, code, stage, reason, by, _now()))

    def finish(self, thread_id, status, result) -> None:
        self._x("UPDATE director_approvals SET status = ?, result = ? WHERE thread_id = ?", (status, json.dumps(result), thread_id))

    def pending(self) -> list[dict]:
        rows = self.db.execute("SELECT thread_id, request, proposal, created_at, status, risk FROM director_approvals "
                               "WHERE status IN ('pending', 'escalated') ORDER BY created_at").fetchall()
        return [{"thread_id": r[0], "request": r[1], "proposal": json.loads(r[2]), "created_at": r[3], "status": r[4], "risk": json.loads(r[5])} for r in rows]

    def approval(self, thread_id) -> dict | None:
        r = self.db.execute("SELECT status, decided_by, result, created_at, risk, confirmed_by FROM director_approvals WHERE thread_id = ?",
                            (thread_id,)).fetchone()
        return {"status": r[0], "decided_by": r[1], "result": json.loads(r[2]) if r[2] else None, "created_at": _ts(r[3]),
                "risk": json.loads(r[4]), "confirmed_by": r[5]} if r else None

    def rejections(self, thread_id=None) -> list[dict]:
        q = "SELECT thread_id, code, stage, reason, rejected_by, created_at FROM director_rejections"
        rows = (self.db.execute(q + " WHERE thread_id = ? ORDER BY id", (thread_id,)) if thread_id else self.db.execute(q + " ORDER BY id")).fetchall()
        return [{"thread_id": r[0], "code": r[1], "stage": r[2], "reason": r[3], "rejected_by": r[4], "created_at": r[5]} for r in rows]

    def backup(self, dest: Path) -> Path:
        """Consistent online copy of the SQLite file (sqlite3 backup API)."""
        dest.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(str(dest)) as out:
            self.db.backup(out)
        return dest


def get_store(data_dir: Path) -> Store:
    url = os.environ.get("DIRECTOR_DB_URL", "").strip()
    if url and "${" not in url:
        store = PgStore(url)
        store.ensure_schema()
        return store
    return SqliteStore(data_dir / "director.sqlite")
