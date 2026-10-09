"""maritime-agent local store: SQLite with ordered, tracked migrations (local-first; PostGIS later).

    python db.py                  apply pending migrations to MARITIME_DB_PATH (default data/maritime.sqlite)
"""

from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path

HERE = Path(__file__).resolve().parent
MIGRATIONS = HERE / "migrations"
DB_PATH = os.environ.get("MARITIME_DB_PATH", str(HERE / "data" / "maritime.sqlite"))

# Reference data: real, public geography (same choke-points as db/geo), bilingual.
PORTS = [
    ("jebel-ali", "Port of Jebel Ali", "ميناء جبل علي", 55.03, 24.98, 5),
    ("fujairah", "Port of Fujairah", "ميناء الفجيرة", 56.36, 25.17, 4),
    ("jeddah", "Jeddah Islamic Port", "ميناء جدة الإسلامي", 39.15, 21.48, 5),
    ("singapore", "Port of Singapore", "ميناء سنغافورة", 103.84, 1.26, 8),
]
CORRIDORS = [
    ("hormuz-jebelali", "Strait of Hormuz → Jebel Ali", "مضيق هرمز ← جبل علي", [[56.6, 26.4], [56.0, 26.2], [55.03, 24.98]]),
    ("redsea-suez", "Bab-el-Mandeb → Suez", "باب المندب ← السويس", [[43.4, 12.6], [38.5, 20.5], [32.6, 29.9]]),
    ("malacca-singapore", "Strait of Malacca → Singapore", "مضيق ملقا ← سنغافورة", [[98.5, 4.5], [101.0, 2.6], [103.84, 1.26]]),
]


def connect(path: str = DB_PATH) -> sqlite3.Connection:
    if path != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def migrate(con: sqlite3.Connection) -> list[str]:
    """Apply every migrations/NNN_*.sql not applied yet, in order; seed reference data. Idempotent."""
    con.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)")
    done = {r[0] for r in con.execute("SELECT name FROM schema_migrations")}
    applied = []
    for f in sorted(MIGRATIONS.glob("*.sql")):
        if f.name in done:
            continue
        with con:
            con.executescript(f.read_text(encoding="utf-8"))
            con.execute("INSERT INTO schema_migrations (name) VALUES (?)", (f.name,))
        applied.append(f.name)
    with con:
        con.executemany("INSERT OR IGNORE INTO ports VALUES (?,?,?,?,?,?)", PORTS)
        con.executemany("INSERT OR IGNORE INTO corridors VALUES (?,?,?,?)",
                        [(i, en, ar, json.dumps(w)) for i, en, ar, w in CORRIDORS])
    return applied


if __name__ == "__main__":
    c = connect()
    print(json.dumps({"db": DB_PATH, "applied": migrate(c)}, ensure_ascii=False))
