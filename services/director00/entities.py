"""GDELT GKG entity extraction into event_entities (persons, organisations, locations, themes + sentiment).

    python entities.py ingest              # newest 15-minute GKG file -> event_entities
    python entities.py search "hormuz"     # free text over all entity names
    python entities.py who "donald trump"  # exact person, newest first
    python entities.py purge               # drop rows past the retention window

Postgres + pgvector DB (DIRECTOR_DB_URL, table from db/director/03-event-entities.sql, GIN indexes) or, without Docker,
a local SQLite file with an FTS5 index. Read-only on the outside world: it downloads public GDELT files and writes only
its own table, so it runs without the approval gate (it is ingestion, not an agent action).
"""

import io
import json
import os
import re
import sqlite3
import sys
import time
import urllib.request
import zipfile
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

DATA = Path(os.environ.get("DIRECTOR_DATA_DIR", Path(__file__).with_name("data")))
_TRUTH = Path(__file__).resolve().parents[1] / "truth"
if str(_TRUTH) not in sys.path:
    sys.path.insert(0, str(_TRUTH))
import truth_layer  # noqa: E402  (ADR-021: every article is scored before anyone may use it)
RETENTION_DAYS = float(os.environ.get("DIRECTOR_ENTITY_RETENTION_DAYS", "7"))
PERSON_MIN_ARTICLES = 3          # ADR 006: only people several articles name (public figures), never one-off mentions


def sentiment(tone: float) -> str:
    """GDELT AvgTone runs roughly -10..+10; +/-1.5 separates clearly coloured coverage from neutral reporting."""
    return "positive" if tone >= 1.5 else "negative" if tone <= -1.5 else "neutral"


def _theme(t: str) -> str:
    return re.sub(r"^(TAX_|WB_\d+_|CRISISLEX_|UNGP_|SOC_|EPU_)", "", t).replace("_", " ").lower()


def parse_gkg(csv_text: str) -> list[dict]:
    """GKG 2.1 rows -> article dicts. Columns: 0 id, 1 date, 3 source, 4 url, 7 themes, 10 V2Locations, 11 persons,
    13 organisations, 15 V2Tone. People named in fewer than PERSON_MIN_ARTICLES articles of the batch are dropped."""
    rows = []
    for line in csv_text.splitlines():
        c = line.split("\t")
        if len(c) < 16 or not c[4].startswith("http"):
            continue
        locs, lat, lon = [], None, None
        for loc in c[10].split(";") if c[10] else []:
            f = loc.split("#")
            if len(f) >= 8 and f[1]:
                locs.append(f[1])
                if lat is None and f[5] and f[6]:
                    try:
                        lat, lon = float(f[5]), float(f[6])
                    except ValueError:
                        pass
        tone_fields = (c[15] or "0").split(",")
        tone = float(tone_fields[0] or 0)
        polarity = float(tone_fields[3]) if len(tone_fields) > 3 and tone_fields[3] else None
        rows.append({"gkg_id": c[0], "published_at": datetime.strptime(c[1][:14], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc).isoformat(),
                     "source_domain": c[3], "url": c[4], "persons": sorted(set(p for p in c[11].split(";") if p)),
                     "orgs": sorted(set(o for o in c[13].split(";") if o)), "locations": sorted(set(locs)),
                     "themes": sorted(set(_theme(t) for t in c[7].split(";") if t))[:15],
                     "lat": lat, "lon": lon, "tone": round(tone, 2), "polarity": polarity, "sentiment": sentiment(tone)})
    counts = Counter(p for r in rows for p in r["persons"])
    for r in rows:
        r["persons"] = [p for p in r["persons"] if counts[p] >= PERSON_MIN_ARTICLES]
    return rows


def score_batch(rows: list[dict]) -> list[dict]:
    """Truth Layer scores for one GKG batch; corroboration = other-domain articles sharing two specific entities."""
    items = [truth_layer.Item(id=r["gkg_id"], url=r["url"], tone=r["tone"], polarity=r.get("polarity")) for r in rows]
    ents = {r["gkg_id"]: {x.lower() for x in r["locations"] + r["orgs"] + r["persons"]} for r in rows}
    truth_layer.corroborate(items, ents)
    return [truth_layer.score(i) for i in items]


def latest_gkg_csv() -> str:
    with urllib.request.urlopen("https://data.gdeltproject.org/gdeltv2/lastupdate.txt", timeout=20) as r:
        url = next(line.split(" ")[2] for line in r.read().decode().splitlines() if ".gkg." in line).replace("http:", "https:")
    with urllib.request.urlopen(url, timeout=60) as r:
        with zipfile.ZipFile(io.BytesIO(r.read())) as z:
            return z.read(z.namelist()[0]).decode("utf-8", "replace")


class PgEntities:
    def __init__(self, store):            # reuses memory.PgStore's connection (same Postgres)
        self.con = store.con

    def upsert(self, rows: list[dict]) -> int:
        n = 0
        for r in rows:
            n += len(self.con.run(
                "INSERT INTO event_entities (gkg_id, published_at, source_domain, url, persons, orgs, locations, themes, lat, lon, tone, sentiment) "
                "VALUES (:g, CAST(:p AS timestamptz), :d, :u, CAST(:pe AS text[]), CAST(:o AS text[]), CAST(:l AS text[]), CAST(:t AS text[]), :la, :lo, :to, :s) "
                "ON CONFLICT (gkg_id) DO NOTHING RETURNING id",
                g=r["gkg_id"], p=r["published_at"], d=r["source_domain"], u=r["url"], pe=_pgarr(r["persons"]), o=_pgarr(r["orgs"]),
                l=_pgarr(r["locations"]), t=_pgarr(r["themes"]), la=r["lat"], lo=r["lon"], to=r["tone"], s=r["sentiment"]))
        return n

    def save_truth(self, results: list[dict]) -> None:
        for t in results:
            self.con.run("INSERT INTO truth_scores (event_id, score, status, flags, source_tier, sources) "
                         "VALUES (:e, :s, :st, CAST(:f AS text[]), :t, :n) ON CONFLICT (event_id) DO UPDATE SET score = EXCLUDED.score, "
                         "status = EXCLUDED.status, flags = EXCLUDED.flags, sources = EXCLUDED.sources, computed_at = now()",
                         e=t["event_id"], s=t["score"], st=t["status"], f=_pgarr(t["flags"]), t=t["source_tier"], n=t["sources"])

    _COLS = ("SELECT e.gkg_id, e.published_at, e.url, e.persons, e.orgs, e.locations, e.sentiment, e.tone, ts.score, ts.status, ts.flags "
             "FROM event_entities e LEFT JOIN truth_scores ts ON ts.event_id = e.gkg_id ")
    _VERIFIED = "AND ts.status = 'verified' "

    def search(self, text: str, limit: int = 20, include_unverified: bool = False) -> list[dict]:
        gate = "" if include_unverified else self._VERIFIED
        rows = self.con.run(self._COLS + "WHERE e.search @@ plainto_tsquery('simple', :q) " + gate + "ORDER BY e.published_at DESC LIMIT :n",
                            q=text, n=limit)
        return [_row(r) for r in rows]

    def who(self, person: str, limit: int = 20, include_unverified: bool = False) -> list[dict]:
        gate = "" if include_unverified else self._VERIFIED
        rows = self.con.run(self._COLS + "WHERE e.persons @> CAST(:p AS text[]) " + gate + "ORDER BY e.published_at DESC LIMIT :n",
                            p=_pgarr([person.lower()]), n=limit)
        return [_row(r) for r in rows]

    def purge(self) -> int:
        return len(self.con.run("DELETE FROM event_entities WHERE published_at < now() - make_interval(secs => :s) RETURNING id",
                                s=RETENTION_DAYS * 86400))

    def count(self) -> int:
        return int(self.con.run("SELECT count(*) FROM event_entities")[0][0])


class SqliteEntities:
    """Same interface offline: JSON arrays plus an FTS5 index standing in for the GIN indexes."""

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS event_entities (id INTEGER PRIMARY KEY, gkg_id TEXT UNIQUE NOT NULL, published_at TEXT NOT NULL,
                source_domain TEXT, url TEXT NOT NULL, persons TEXT, orgs TEXT, locations TEXT, themes TEXT, lat REAL, lon REAL,
                tone REAL, sentiment TEXT NOT NULL);
            CREATE VIRTUAL TABLE IF NOT EXISTS event_entities_fts USING fts5(gkg_id UNINDEXED, body, tokenize='unicode61');
            CREATE TABLE IF NOT EXISTS truth_scores (event_id TEXT PRIMARY KEY, score REAL NOT NULL, status TEXT NOT NULL,
                flags TEXT NOT NULL DEFAULT '[]', source_tier TEXT NOT NULL, sources INTEGER NOT NULL, computed_at TEXT NOT NULL);
        """)

    def upsert(self, rows: list[dict]) -> int:
        n = 0
        for r in rows:
            cur = self.db.execute("INSERT OR IGNORE INTO event_entities (gkg_id, published_at, source_domain, url, persons, orgs, locations, themes, "
                                  "lat, lon, tone, sentiment) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                                  (r["gkg_id"], r["published_at"], r["source_domain"], r["url"], json.dumps(r["persons"]), json.dumps(r["orgs"]),
                                   json.dumps(r["locations"]), json.dumps(r["themes"]), r["lat"], r["lon"], r["tone"], r["sentiment"]))
            if cur.rowcount:
                self.db.execute("INSERT INTO event_entities_fts (gkg_id, body) VALUES (?, ?)",
                                (r["gkg_id"], " ".join(r["persons"] + r["orgs"] + r["locations"] + r["themes"])))
                n += 1
        self.db.commit()
        return n

    def save_truth(self, results: list[dict]) -> None:
        now = datetime.now(timezone.utc).isoformat()
        self.db.executemany("INSERT OR REPLACE INTO truth_scores (event_id, score, status, flags, source_tier, sources, computed_at) "
                            "VALUES (?, ?, ?, ?, ?, ?, ?)",
                            [(t["event_id"], t["score"], t["status"], json.dumps(t["flags"]), t["source_tier"], t["sources"], now) for t in results])
        self.db.commit()

    def _select(self, where: str, args: tuple, limit: int, include_unverified: bool) -> list[dict]:
        gate = "" if include_unverified else " AND ts.status = 'verified'"
        rows = self.db.execute("SELECT e.gkg_id, e.published_at, e.url, e.persons, e.orgs, e.locations, e.sentiment, e.tone, ts.score, ts.status, ts.flags "
                               f"FROM event_entities e LEFT JOIN truth_scores ts ON ts.event_id = e.gkg_id {where}{gate} "
                               "ORDER BY e.published_at DESC LIMIT ?", (*args, limit)).fetchall()
        return [_row((r[0], r[1], r[2], json.loads(r[3]), json.loads(r[4]), json.loads(r[5]), r[6], r[7], r[8], r[9],
                      json.loads(r[10]) if r[10] else [])) for r in rows]

    def search(self, text: str, limit: int = 20, include_unverified: bool = False) -> list[dict]:
        q = " ".join(f'"{w}"' for w in re.findall(r"\w+", text))
        if not q:
            return []
        return self._select("JOIN event_entities_fts f ON f.gkg_id = e.gkg_id WHERE event_entities_fts MATCH ?", (q,), limit, include_unverified)

    def who(self, person: str, limit: int = 20, include_unverified: bool = False) -> list[dict]:
        return self._select("WHERE EXISTS (SELECT 1 FROM json_each(e.persons) WHERE value = ?)", (person.lower(),), limit, include_unverified)

    def purge(self) -> int:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)).isoformat()
        ids = [r[0] for r in self.db.execute("SELECT gkg_id FROM event_entities WHERE published_at < ?", (cutoff,))]
        self.db.executemany("DELETE FROM event_entities_fts WHERE gkg_id = ?", [(i,) for i in ids])
        self.db.execute("DELETE FROM event_entities WHERE published_at < ?", (cutoff,))
        self.db.commit()
        return len(ids)

    def count(self) -> int:
        return int(self.db.execute("SELECT count(*) FROM event_entities").fetchone()[0])


def _pgarr(items: list[str]) -> str:
    return "{" + ",".join('"' + i.replace("\\", "\\\\").replace('"', '\\"') + '"' for i in items) + "}"


def _row(r) -> dict:
    out = {"gkg_id": r[0], "published_at": str(r[1]), "url": r[2], "persons": list(r[3]), "orgs": list(r[4]),
           "locations": list(r[5]), "sentiment": r[6], "tone": float(r[7])}
    if len(r) > 8:
        out.update(truth_score=r[8], truth_status=r[9] or "unscored", truth_flags=list(r[10] or []))
    return out


def get_entities(data_dir: Path = DATA):
    url = os.environ.get("DIRECTOR_DB_URL", "").strip()
    if url and "${" not in url:
        from memory import PgStore
        store = PgStore(url)
        store.ensure_schema()
        return PgEntities(store)
    return SqliteEntities(data_dir / "entities.sqlite")


def main(argv: list[str]) -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    cmd = argv[0] if argv else "ingest"
    e = get_entities()
    if cmd == "ingest":
        t0 = time.time()
        rows = parse_gkg(latest_gkg_csv())
        truth = score_batch(rows)
        inserted = e.upsert(rows)
        e.save_truth(truth)
        verified = sum(1 for t in truth if t["status"] == "verified")
        out = {"parsed": len(rows), "inserted": inserted, "verified": verified, "unverified": len(truth) - verified,
               "purged": e.purge(), "total": e.count(), "seconds": round(time.time() - t0, 1)}
    elif cmd == "search":
        out = e.search(" ".join(a for a in argv[1:] if a != "--all"), include_unverified="--all" in argv)
    elif cmd == "who":
        out = e.who(" ".join(a for a in argv[1:] if a != "--all"), include_unverified="--all" in argv)
    elif cmd == "purge":
        out = {"purged": e.purge()}
    else:
        raise SystemExit(__doc__)
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
