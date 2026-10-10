"""Approval-gate hardening: rejection codes, timeouts and two-level escalation for high-risk proposals.
Offline (SQLite + hashing embedder); the shared fixture also runs them on pgvector when DIRECTOR_TEST_PG_URL is set."""

import pytest

import director as director_mod
import risk
from test_director import director  # noqa: F401  (same sqlite / pg fixture)


# ── rejection flow ──
def test_rejection_is_logged_with_its_code(director):
    tid = director.ask("remember: route all alerts through Telegram")["thread_id"]
    res = director.decide(tid, approved=False, by="Ahmad", reason="policy", code="COMPLIANCE-002")
    assert res["status"] == "rejected" and res["results"] == []
    log = director.rejections(tid)
    assert [(r["code"], r["stage"], r["rejected_by"], r["reason"]) for r in log] == [("COMPLIANCE-002", "first", "Ahmad", "policy")]
    assert director.recall("Telegram alerts") == []


def test_unknown_rejection_code_is_refused_and_nothing_changes(director):
    tid = director.ask("remember: x")["thread_id"]
    with pytest.raises(ValueError):
        director.decide(tid, approved=False, code="WHATEVER-9")
    assert director.store.approval(tid)["status"] == "pending" and director.rejections(tid) == []


# ── timeout flow ──
def test_decision_after_the_window_expires_instead_of_running(director, monkeypatch):
    tid = director.ask("remember: late decision")["thread_id"]
    monkeypatch.setattr(director_mod, "APPROVAL_TTL_H", -1)            # everything is already past the window
    res = director.decide(tid, approved=True, by="Ahmad")
    assert res["status"] == "rejected" and res["results"] == []
    assert director.rejections(tid)[0]["code"] == "EXPIRED-003" and director.rejections(tid)[0]["stage"] == "timeout"
    assert director.recall("late decision") == []


def test_expire_sweep_rejects_every_stale_proposal(director, monkeypatch):
    a = director.ask("remember: one")["thread_id"]
    b = director.ask("decision: two")["thread_id"]
    director.decide(b, approved=True)                                   # b is now escalated, waiting for confirmation
    monkeypatch.setattr(director_mod, "APPROVAL_TTL_H", -1)
    assert sorted(director.expire_stale()) == sorted([a, b])
    assert director.pending() == []
    assert {r["code"] for r in director.rejections()} == {"EXPIRED-003"}


# ── escalation flow ──
def test_high_risk_needs_the_typed_confirmation_before_anything_runs(director):
    out = director.ask("decision: stop ingesting ADS-B over the Gulf")
    tid = out["thread_id"]
    first = director.decide(tid, approved=True, by="Ahmad")
    assert first["status"] == "escalated" and first["results"] == []
    assert "decision or preference" in " ".join(first["risk"]["reasons"])
    assert director.recall("ADS-B Gulf") == []                         # still nothing written after the first yes
    done = director.confirm(tid, first["type_to_confirm"], by="Ahmad")
    assert done["status"] == "executed" and done["results"][0]["ok"]
    assert director.store.approval(tid)["confirmed_by"] == "Ahmad"


def test_wrong_confirmation_phrase_rejects_with_escalation_code(director):
    tid = director.ask("decision: delete old memories")["thread_id"]
    director.decide(tid, approved=True)
    res = director.confirm(tid, "CONFIRM 0000")
    assert res["status"] == "rejected" and res["results"] == []
    assert director.rejections(tid)[0]["code"] == "ESCALATION-004" and director.rejections(tid)[0]["stage"] == "confirm"
    assert director.recall("delete old memories") == []


def test_bulk_memory_writes_and_external_notify_are_high_risk(monkeypatch):
    many = [{"type": "remember", "kind": "fact", "content": f"f{i}"} for i in range(4)]
    assert risk.assess(many)["level"] == "high"
    assert risk.assess(many[:2])["level"] == "low"
    monkeypatch.setenv("DIRECTOR_NOTIFY_URL", "https://hooks.example.org/x")
    assert risk.assess([{"type": "notify", "message": "m"}])["level"] == "high"
    monkeypatch.setenv("DIRECTOR_NOTIFY_URL", "http://127.0.0.1:5678/webhook/x")
    assert risk.assess([{"type": "notify", "message": "m"}])["level"] == "low"
    monkeypatch.setenv("DIRECTOR_ENV", "production")
    assert risk.assess(many[:1])["level"] == "high"


def test_external_notify_is_never_sent_on_a_single_approval(director, monkeypatch):
    monkeypatch.setattr(director_mod, "rule_plan", lambda req, mem: ("ping", [{"type": "notify", "message": "hi"}]))
    monkeypatch.setenv("DIRECTOR_NOTIFY_URL", "http://hooks.example.org/x")   # plain http outside localhost
    tid = director.ask("anything")["thread_id"]
    step = director.decide(tid, approved=True)
    assert step["status"] == "escalated"
    done = director.confirm(tid, step["type_to_confirm"])
    assert done["results"][0]["skipped"]                                  # even confirmed, plain http outward is refused


def test_backup_snapshots_memory_and_checkpoints(director, tmp_path):
    tid = director.ask("remember: backup me")["thread_id"]
    director.decide(tid, approved=True)
    out = director.backup()
    assert out["files"] and all(p for p in out["files"])


# ── Butterfly Engine as a read-only Director tool ──
def test_why_questions_run_the_butterfly_engine_without_approval(director, monkeypatch):
    monkeypatch.setenv("DIRECTOR_OFFLINE", "1")
    out = director.ask("Why did gold jump near Hormuz?")
    assert out["status"] == "done" and out["actions"] == []
    assert out["causal"]["anomaly"]["node"] == "gold_price" and out["causal"]["anomaly"]["place"] == "hormuz"
    assert "<-" in out["answer"] and director.pending() == []
    ar = director.ask("لماذا تأخرت السفن في هرمز؟")
    assert ar["causal"]["anomaly"]["node"] == "ship_delay" and "←" in ar["answer"]
