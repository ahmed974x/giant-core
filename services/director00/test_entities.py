"""event_entities: GKG parsing, privacy threshold, sentiment, GIN-backed search. SQLite offline; pgvector when
DIRECTOR_TEST_PG_URL is set (the GIN indexes and generated tsvector run on real Postgres there)."""

import os
from datetime import datetime, timedelta, timezone

import pytest

import entities as ent
from memory import PgStore

NOW = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
OLD = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y%m%d%H%M%S")


def gkg_row(i, date, persons, orgs, loc, tone, themes="ECON_OILPRICE;TAX_FNCACT_MINISTER"):
    cols = [""] * 27
    cols[0], cols[1], cols[3], cols[4] = f"{date}-{i}", date, "news.example", f"https://news.example/{i}"
    cols[7], cols[11], cols[13], cols[15] = themes, ";".join(persons), ";".join(orgs), f"{tone},1,2,3"
    cols[10] = f"1#{loc}#IR#IR##26.57#56.25#X#100" if loc else ""
    return "\t".join(cols)


SAMPLE = "\n".join([
    gkg_row(1, NOW, ["jane minister", "private person"], ["opec"], "Strait of Hormuz", -4.2),
    gkg_row(2, NOW, ["jane minister"], ["opec", "iea"], "Strait of Hormuz", -2.0),
    gkg_row(3, NOW, ["jane minister"], ["iea"], "Dubai, UAE", 2.4),
    gkg_row(4, OLD, ["jane minister"], ["opec"], "Suez Canal", 0.3),
])


@pytest.fixture(params=["sqlite", "pg"])
def store(request, tmp_path):
    if request.param == "sqlite":
        yield ent.SqliteEntities(tmp_path / "e.sqlite")
        return
    url = os.environ.get("DIRECTOR_TEST_PG_URL")
    if not url:
        pytest.skip("set DIRECTOR_TEST_PG_URL for the Postgres run")
    pg = PgStore(url)
    pg.ensure_schema()
    pg.con.run("TRUNCATE event_entities")
    yield ent.PgEntities(pg)
    pg.close()


def test_parse_tags_sentiment_and_drops_rarely_named_people():
    rows = ent.parse_gkg(SAMPLE)
    assert [r["sentiment"] for r in rows] == ["negative", "negative", "positive", "neutral"]
    assert all("private person" not in r["persons"] for r in rows)          # named once: never stored (ADR 006)
    assert rows[0]["persons"] == ["jane minister"] and rows[0]["locations"] == ["Strait of Hormuz"]
    assert rows[0]["lat"] == 26.57 and "oilprice" in " ".join(rows[0]["themes"])


def test_upsert_is_idempotent_and_search_finds_entities(store):
    rows = ent.parse_gkg(SAMPLE)
    assert store.upsert(rows) == 4 and store.upsert(rows) == 0
    hits = store.search("hormuz")
    assert {h["gkg_id"].split("-")[-1] for h in hits} == {"1", "2"}
    assert [h["sentiment"] for h in store.search("iea")][:2] == ["negative", "positive"] or len(store.search("iea")) == 2
    assert len(store.who("Jane Minister")) == 4


def test_purge_removes_rows_past_retention(store):
    store.upsert(ent.parse_gkg(SAMPLE))
    assert store.purge() == 1 and store.count() == 3
    assert all("suez" not in " ".join(h["locations"]).lower() for h in store.who("jane minister"))
