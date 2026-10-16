"""Unit tests for the memory keeper, plus an end-to-end run against a real database when AMEEN_TEST_SOCKET is set
(scripts/test-nerve.sh sets it after building the throw-away Postgres)."""

import math
import os
from datetime import UTC, datetime

import ameen
import pytest
from embed import HashingEmbedder, HttpEmbedder


def cos(a, b):
    return sum(x * y for x, y in zip(a, b, strict=True)) / (math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b)))


def test_hashing_embedder_is_normalised_and_stable():
    e = HashingEmbedder(384)
    v = e.embed("Brent crude jumped to 90 USD")
    assert len(v) == 384
    assert abs(math.sqrt(sum(x * x for x in v)) - 1) < 1e-9
    assert v == e.embed("Brent crude jumped to 90 USD")


def test_hashing_embedder_groups_related_text_in_both_languages():
    e = HashingEmbedder(384)
    oil_ar, oil_ar2, gold = e.embed("أسعار النفط في الخليج"), e.embed("سعر النفط الخليج اليوم"), e.embed("gold and the dollar index")
    assert cos(oil_ar, oil_ar2) > cos(oil_ar, gold)
    ship, ships, cats = e.embed("tanker shipping delays"), e.embed("tankers ships delayed"), e.embed("cats sleeping")
    assert cos(ship, ships) > cos(ship, cats)


def test_empty_text_gives_a_zero_vector():
    assert set(HashingEmbedder(16).embed("")) == {0.0}


@pytest.mark.parametrize("url", ["https://api.openai.com/v1", "http://example.org/v1", "file:///etc/passwd", "http://10.0.0.5/v1"])
def test_http_embedder_refuses_anything_off_the_laptop(url):
    with pytest.raises(ValueError):
        HttpEmbedder(url, "nomic-embed-text")


def test_http_embedder_accepts_local_ollama():
    assert HttpEmbedder("http://ollama:11434/v1", "nomic-embed-text").name == "http:nomic-embed-text"


def test_sleep_runs_once_a_day_after_the_hour():
    morning = datetime(2026, 10, 16, 2, 59, tzinfo=UTC)
    night = datetime(2026, 10, 16, 3, 0, tzinfo=UTC)
    assert not ameen.due_for_sleep(morning, None, 3)
    assert ameen.due_for_sleep(night, None, 3)
    assert not ameen.due_for_sleep(night, "2026-10-16", 3)
    assert ameen.due_for_sleep(datetime(2026, 10, 17, 4, 0, tzinfo=UTC), "2026-10-16", 3)


@pytest.mark.skipif(not os.environ.get("AMEEN_TEST_SOCKET"), reason="needs the throw-away Postgres from scripts/test-nerve.sh")
def test_end_to_end_embeds_and_sleeps(monkeypatch):
    monkeypatch.setenv("AMEEN_DB_SOCKET", os.environ["AMEEN_TEST_SOCKET"])
    monkeypatch.setenv("AMEEN_DB_PASSWORD", "unused-with-trust-auth")
    monkeypatch.setenv("POSTGRES_DB", "omega_test")
    db = ameen.connect()
    pending = db.run("SELECT count(*) FROM mem.pending_embeddings(1000)")[0][0]
    assert pending > 0
    assert ameen.embed_pending(db, HashingEmbedder(384), batch=1000) == pending
    assert db.run("SELECT count(*) FROM mem.pending_embeddings(1000)")[0][0] == 0
    # recall by meaning now works for rows that only had words
    q = HashingEmbedder(384).embed("Brent crude oil price")
    hits = db.run("SELECT kind, text FROM mem.search('zzz', CAST(:v AS real[]), 3)", v=q)
    assert hits and "Brent" in hits[0][1]
    out = db.run("SELECT mem.sleep()")[0][0]
    assert out["unembedded"] == 0
    # the keeper cannot read tables or erase memory
    with pytest.raises(Exception, match="permission denied"):
        db.run("SELECT * FROM mem.facts")
    db.close()
