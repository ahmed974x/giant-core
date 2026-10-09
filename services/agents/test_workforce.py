"""Workforce tests: `python -m pytest services/agents` (standard library only, no network)."""

from datetime import datetime, timedelta, timezone

import pytest

import workforce as wf


def repo(**kw):
    base = {"full_name": "acme/fastcast", "name": "fastcast", "html_url": "https://github.com/acme/fastcast",
            "description": "Fast time-series forecasting in Python", "topics": ["forecasting"], "language": "Python",
            "license": {"spdx_id": "MIT"}, "stargazers_count": 12000, "forks_count": 900, "archived": False, "fork": False,
            "pushed_at": (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()}
    return {**base, **kw}


def test_scout_scores_a_trusted_relevant_repo():
    p = wf.Scout.assess(repo())
    assert p and p["score"] >= 45 and "faster forecasting" in p["reasons"][0]


@pytest.mark.parametrize("bad", [{"license": None}, {"license": {"spdx_id": "NOASSERTION"}}, {"archived": True}, {"fork": True},
                                 {"pushed_at": "2020-01-01T00:00:00Z"}, {"description": "A chess server", "topics": []}])
def test_scout_rejects_untrusted_or_irrelevant(bad):
    assert wf.Scout.assess(repo(**bad)) is None


def test_scout_flags_jvm_cost_for_scala():
    p = wf.Scout.assess(repo(language="Scala", description="Unified engine for stream processing"))
    assert p["cost"].startswith("needs a JVM") and any("caution" in r for r in p["reasons"])


def test_inbox_proposes_once_and_records_decisions():
    inbox = wf.Inbox(":memory:")
    p = wf.Scout.assess(repo())
    assert inbox.propose("scout", p) and not inbox.propose("scout", p)
    assert [x["id"] for x in inbox.proposals()] == ["acme/fastcast"]
    assert inbox.decide("acme/fastcast", "approved") and not inbox.decide("acme/fastcast", "skipped")
    assert inbox.proposals() == [] and inbox.proposals("approved")[0]["status"] == "approved"
    with pytest.raises(ValueError):
        inbox.decide("acme/fastcast", "install")


def test_agent_failure_is_logged_not_raised(monkeypatch):
    inbox = wf.Inbox(":memory:")
    s = wf.Sentinel(inbox)
    monkeypatch.setattr(wf, "get_json", lambda *a, **k: (_ for _ in ()).throw(OSError("relay down")))
    s.tick()
    last = inbox.last_run("sentinel")
    assert last["ok"] == 0 and "relay down" in last["summary"]


def test_sentinel_reports_changes(monkeypatch):
    inbox = wf.Inbox(":memory:")
    s = wf.Sentinel(inbox)
    states = iter([{"relay": "ok", "n8n": "ok"}, {"relay": "ok", "n8n": "down"}])
    monkeypatch.setattr(wf, "get_json", lambda *a, **k: next(states))
    assert s.run() == "All systems nominal."
    assert s.run() == "DOWN: n8n. Changes: n8n ok→down."
