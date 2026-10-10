"""Director 00 tests. Offline by default (SQLite store, hashing embedder, rule planner).
Set DIRECTOR_TEST_PG_URL to also run the same checks against Postgres + pgvector."""

import os
from pathlib import Path

import pytest

from director import Director, valid_actions
from embed import HashingEmbedder
from memory import PgStore, SqliteStore

os.environ.pop("DIRECTOR_LLM_URL", None)
os.environ.pop("DIRECTOR_NOTIFY_URL", None)


def _stores(tmp: Path):
    yield "sqlite", SqliteStore(tmp / "m.sqlite")
    url = os.environ.get("DIRECTOR_TEST_PG_URL")
    if url:
        pg = PgStore(url)
        pg.ensure_schema()
        pg.con.run("TRUNCATE agent_memories, director_approvals, director_rejections")
        yield "pg", pg


@pytest.fixture(params=["sqlite", "pg"])
def director(request, tmp_path):
    stores = dict(_stores(tmp_path))
    if request.param not in stores:
        pytest.skip("set DIRECTOR_TEST_PG_URL for the pgvector run")
    yield Director(store=stores[request.param], embedder=HashingEmbedder(), data_dir=tmp_path)
    if "pg" in stores:
        stores["pg"].close()


def test_hashing_embedder_is_unit_length_and_similar_for_related_text():
    e = HashingEmbedder()
    a, b, c = e.embed("Hormuz tanker traffic"), e.embed("tanker traffic through Hormuz"), e.embed("bitcoin price candles")
    dot = lambda x, y: sum(p * q for p, q in zip(x, y))
    assert abs(dot(a, a) - 1) < 1e-5 and dot(a, b) > dot(a, c)


def test_nothing_is_written_before_approval(director):
    out = director.ask("remember: Hormuz traffic is the main driver of Brent for us")
    assert out["status"] == "awaiting_approval"
    assert out["actions"] == [{"type": "remember", "kind": "note", "content": "Hormuz traffic is the main driver of Brent for us"}]
    assert director.recall("Hormuz Brent") == []                       # the gate held: memory is still empty
    assert [p["thread_id"] for p in director.pending()] == [out["thread_id"]]


def test_approval_executes_and_memory_is_recalled(director):
    tid = director.ask("remember: Hormuz traffic is the main driver of Brent for us")["thread_id"]
    res = director.decide(tid, approved=True, by="Ahmad")
    assert res["status"] == "executed" and res["results"][0]["ok"]
    hits = director.recall("what drives Brent? Hormuz")
    assert hits and "Hormuz" in hits[0]["content"] and hits[0]["score"] > 0.2
    follow = director.ask("What drives Brent for us?")                 # RAG: answer comes from memory, no action
    assert follow["status"] == "done" and "Hormuz" in follow["answer"]
    assert director.pending() == []


def test_rejection_runs_nothing(director):
    tid = director.ask("decision: pause all whale alerts")["thread_id"]
    res = director.decide(tid, approved=False, by="Ahmad", reason="not now")
    assert res["status"] == "rejected" and res["results"] == []
    assert director.recall("whale alerts") == []


def test_partial_approval_runs_only_chosen_actions(director, monkeypatch):
    monkeypatch.setattr("director.rule_plan", lambda req, mem: ("two things", [
        {"type": "remember", "kind": "fact", "content": "Suez transit fee rose"},
        {"type": "notify", "message": "Suez fee change"}]))
    tid = director.ask("anything")["thread_id"]
    res = director.decide(tid, approved=True, by="Ahmad", only=[0])
    assert [r["type"] for r in res["results"]] == ["remember"]


def test_notify_without_local_target_is_skipped_not_sent(director):
    tid = director.ask("notify: congestion building at Jebel Ali")["thread_id"]
    res = director.decide(tid, approved=True)
    assert res["results"][0]["skipped"] and res["status"] == "executed"


def test_cannot_decide_twice_or_unknown(director):
    tid = director.ask("remember: test once")["thread_id"]
    director.decide(tid, approved=True)
    with pytest.raises(ValueError):
        director.decide(tid, approved=True)
    with pytest.raises(ValueError):
        director.decide("nope", approved=True)


def test_llm_output_is_sanitised():
    acts = valid_actions([{"type": "remember", "kind": "weird", "content": "x"}, {"type": "rm -rf"}, {"type": "notify", "message": ""}, "junk"])
    assert acts == [{"type": "remember", "kind": "note", "content": "x"}]


def test_arabic_requests(director):
    out = director.ask("تذكر: أفضّل التنبيهات بالعربي")
    assert out["actions"][0]["kind"] == "preference"
    step = director.decide(out["thread_id"], approved=True)            # a preference steers future plans: high risk
    assert step["status"] == "escalated"
    director.confirm(out["thread_id"], step["type_to_confirm"])
    assert "بالعربي" in director.recall("التنبيهات بالعربي")[0]["content"]
