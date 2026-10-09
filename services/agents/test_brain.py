"""Brain tests: the agent web runs end to end with a fake model, learns, and degrades honestly without one."""

import time

import brain as br
import workforce as wf


def wait(b, jid, timeout=5):
    t0 = time.time()
    while b.get(jid)["status"] != "done" and time.time() - t0 < timeout:
        time.sleep(0.02)
    return b.get(jid)


def fake_think(role, content, max_tokens=700):
    return {
        "planner": 'Sure:\n```json\n{"intent": "design", "goal": "a search bar", "plan": ["a", "b"], "questions": ["what exists?"]}\n```',
        "researcher": "The relay already serves the dashboard [service health].",
        "designer": "Put the bar in the header; POST to /brain/ask.",
        "critic": "Rate-limit the endpoint.\nLESSON: every new POST route needs a rate limit",
        "synthesizer": "Add the header search bar, rate-limited.",
    }[role]


def test_pipeline_runs_every_agent_and_remembers(monkeypatch):
    monkeypatch.setattr(br, "think", fake_think)
    b = br.Brain(wf.Inbox(":memory:"), evidence=lambda qs: ["[service health] relay ok"])
    job = wait(b, b.submit("design a search bar for the site")["id"])
    assert job["status"] == "done" and job["intent"] == "design"
    assert [s["status"] for s in job["steps"]] == ["done"] * 6
    assert job["answer"] == "Add the header search bar, rate-limited."
    # second request recalls the first one and its lesson
    job2 = wait(b, b.submit("redesign the search bar colours")["id"])
    mem = job2["steps"][0]["output"]
    assert "every new POST route needs a rate limit" in mem and b.memory.count() == 2


def test_without_a_model_it_says_so(monkeypatch):
    monkeypatch.setattr(br, "think", lambda *a, **k: None)
    b = br.Brain(wf.Inbox(":memory:"), evidence=lambda qs: ["[installed modules] quant, studio"])
    job = wait(b, b.submit("ضيف زر بحث للموقع")["id"])
    assert job["intent"] == "change" and "No AI model is reachable" in job["answer"]
    assert {s["agent"]: s["status"] for s in job["steps"]}["critic"] == "skipped"


def test_rejects_bad_requests():
    b = br.Brain(wf.Inbox(":memory:"), evidence=lambda qs: [])
    for bad in ("", "hi", "x" * 5000):
        try:
            b.submit(bad)
            raise AssertionError("accepted " + repr(bad[:10]))
        except ValueError:
            pass


def test_parse_plan_falls_back():
    p = br.parse_plan("not json", "fix the chart")
    assert p["intent"] == "change" and p["questions"] == ["fix the chart"]


def test_scout_trusts_curated_repos():
    from test_workforce import repo
    plain = wf.Scout.assess(repo())
    curated = wf.Scout.assess({**repo(), "_curated": ["awesome-python"]})
    assert curated["score"] == plain["score"] + 8 and "curated in awesome-python" in curated["reasons"]
