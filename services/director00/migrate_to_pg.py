"""Move Director 00's local SQLite data into Postgres + pgvector (ADR-040).

    python migrate_to_pg.py "postgresql://omega_director:...@127.0.0.1:5435/omega_memory?sslmode=disable"

Copies the approval ledger, rejections and memories (director.sqlite), Phoenix's log (phoenix.sqlite), and the GKG
entities with their truth scores (entities.sqlite). Safe to run more than once: rows already in Postgres are skipped.
Only reads the SQLite files, never changes them; prints a per-table count check and exits 1 if anything is short.
"""

import json
import os
import sqlite3
import sys
from pathlib import Path

from entities import _pgarr
from memory import PgStore

DATA = Path(os.environ.get("DIRECTOR_DATA_DIR", Path(__file__).with_name("data")))


def _rows(path: Path, sql: str) -> list[sqlite3.Row]:
    if not path.exists():
        return []
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    try:
        return con.execute(sql).fetchall()
    except sqlite3.OperationalError:
        return []                                  # table not created yet on this install
    finally:
        con.close()


def _arr(text: str | None) -> str:
    try:
        return _pgarr([str(x) for x in json.loads(text or "[]")])
    except (TypeError, ValueError):
        return "{}"


def migrate(url: str, data: Path = DATA) -> dict:
    store = PgStore(url)
    store.ensure_schema()
    pg = store.con
    report: dict = {}

    ap = _rows(data / "director.sqlite", "SELECT * FROM director_approvals")
    for r in ap:
        pg.run("INSERT INTO director_approvals (thread_id, request, proposal, status, decided_by, decided_at, result, created_at, risk, confirmed_by) "
               "VALUES (:t, :q, CAST(:p AS jsonb), :s, :db, CAST(:da AS timestamptz), CAST(:res AS jsonb), CAST(:c AS timestamptz), CAST(:risk AS jsonb), :cb) "
               "ON CONFLICT (thread_id) DO NOTHING",
               t=r["thread_id"], q=r["request"], p=r["proposal"], s=r["status"], db=r["decided_by"], da=r["decided_at"], res=r["result"],
               c=r["created_at"], risk=r["risk"] or '{"level": "low", "reasons": []}', cb=r["confirmed_by"])
    report["director_approvals"] = (len(ap), pg.run("SELECT count(*) FROM director_approvals")[0][0])

    rj = _rows(data / "director.sqlite", "SELECT * FROM director_rejections ORDER BY id")
    for r in rj:
        pg.run("INSERT INTO director_rejections (thread_id, code, stage, reason, rejected_by, created_at) "
               "SELECT :t, :c, :s, :r, :b, CAST(:at AS timestamptz) WHERE NOT EXISTS ("
               "SELECT 1 FROM director_rejections WHERE thread_id = :t AND code = :c AND created_at = CAST(:at AS timestamptz))",
               t=r["thread_id"], c=r["code"], s=r["stage"], r=r["reason"], b=r["rejected_by"], at=r["created_at"])
    report["director_rejections"] = (len(rj), pg.run("SELECT count(*) FROM director_rejections")[0][0])

    mem = _rows(data / "director.sqlite", "SELECT * FROM agent_memories ORDER BY id")
    for r in mem:
        emb = json.loads(r["embedding"]) if isinstance(r["embedding"], str) else list(memoryview(r["embedding"]).cast("f"))
        pg.run("INSERT INTO agent_memories (agent, kind, content, metadata, embedding, approved_by, created_at) "
               "SELECT :a, :k, :c, CAST(:m AS jsonb), CAST(:e AS vector), :b, CAST(:at AS timestamptz) WHERE NOT EXISTS ("
               "SELECT 1 FROM agent_memories WHERE content = :c AND created_at = CAST(:at AS timestamptz))",
               a=r["agent"], k=r["kind"], c=r["content"], m=r["metadata"] or "{}", e=PgStore._vec(emb), b=r["approved_by"], at=r["created_at"])
    report["agent_memories"] = (len(mem), pg.run("SELECT count(*) FROM agent_memories")[0][0])

    ev = _rows(data / "phoenix.sqlite", "SELECT * FROM phoenix_events ORDER BY id")
    for r in ev:
        pg.run("INSERT INTO phoenix_events (ts, service, action, result, detail) "
               "SELECT CAST(:ts AS timestamptz), :s, :a, :r, :d WHERE NOT EXISTS ("
               "SELECT 1 FROM phoenix_events WHERE ts = CAST(:ts AS timestamptz) AND service = :s AND action = :a)",
               ts=r["ts"], s=r["service"], a=r["action"], r=r["result"], d=r["detail"])
    report["phoenix_events"] = (len(ev), pg.run("SELECT count(*) FROM phoenix_events")[0][0])

    ent = _rows(data / "entities.sqlite", "SELECT * FROM event_entities")
    for r in ent:
        pg.run("INSERT INTO event_entities (gkg_id, published_at, source_domain, url, persons, orgs, locations, themes, lat, lon, tone, sentiment) "
               "VALUES (:g, CAST(:p AS timestamptz), :d, :u, CAST(:pe AS text[]), CAST(:o AS text[]), CAST(:l AS text[]), CAST(:th AS text[]), :la, :lo, :t, :s) "
               "ON CONFLICT (gkg_id) DO NOTHING",
               g=r["gkg_id"], p=r["published_at"], d=r["source_domain"] or "", u=r["url"], pe=_arr(r["persons"]), o=_arr(r["orgs"]),
               l=_arr(r["locations"]), th=_arr(r["themes"]), la=r["lat"], lo=r["lon"], t=r["tone"] or 0, s=r["sentiment"])
    report["event_entities"] = (len(ent), pg.run("SELECT count(*) FROM event_entities")[0][0])

    ts = _rows(data / "entities.sqlite", "SELECT * FROM truth_scores")
    for r in ts:
        pg.run("INSERT INTO truth_scores (event_id, score, status, flags, source_tier, sources, computed_at) "
               "VALUES (:e, :sc, :st, CAST(:f AS text[]), :tier, :n, CAST(:at AS timestamptz)) ON CONFLICT (event_id) DO NOTHING",
               e=r["event_id"], sc=r["score"], st=r["status"], f=_arr(r["flags"]), tier=r["source_tier"], n=r["sources"], at=r["computed_at"])
    report["truth_scores"] = (len(ts), pg.run("SELECT count(*) FROM truth_scores")[0][0])

    store.close()
    return report


def main(argv: list[str]) -> int:
    if sys.stdout is not None:
        sys.stdout.reconfigure(encoding="utf-8")
    url = argv[0] if argv else os.environ.get("DIRECTOR_DB_URL", "")
    if not url:
        print("usage: migrate_to_pg.py <postgres url>  (or set DIRECTOR_DB_URL)")
        return 2
    report = migrate(url)
    short = {k: v for k, v in report.items() if v[1] < v[0]}
    for k, (src, dst) in report.items():
        print(f"{k:22} sqlite {src:6}  postgres {dst:6}  {'OK' if dst >= src else 'SHORT'}")
    return 1 if short else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
