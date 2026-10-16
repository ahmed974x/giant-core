"""Tests for the brain loop (ADR-082): the engine and the critic with an in-memory store that follows the same
rules as db/init/08-loop.sh, plus an end-to-end run through the `hakeem` login when LOOP_TEST_SOCKET is set."""

import json
import os
from pathlib import Path

import critic
import engine
import models
import pytest
import sources
import store as store_mod

GOOD = [{"url": "https://example.org/a", "title": "A", "snippet": "brent held above 80"},
        {"url": "https://example.net/b", "title": "B", "snippet": "analysts expect 82"}]


class MemStore:
    """Same rules as loop.step/finish: budgets, secrets, and a final run."""

    def __init__(self, max_steps=12, max_tokens=6000):
        self.max_steps, self.max_tokens = max_steps, max_tokens
        self.steps, self.tokens, self.status = 0, 0, "running"
        self.checkpoints, self.finished, self.learned = [], None, None

    def start(self, goal, ms, mt):
        return "11111111-2222-3333-4444-555555555555"

    def step(self, run_id, node, state, tokens):
        if self.status != "running":
            return {"ok": False, "reason": "not running"}
        if "gsk_" in json.dumps(state):
            self.status = "failed"
            return {"ok": False, "reason": "secret refused"}
        if self.steps + 1 > self.max_steps or self.tokens + tokens > self.max_tokens:
            self.status = "incomplete"
            return {"ok": False, "reason": "budget reached", "status": "incomplete"}
        self.steps += 1
        self.tokens += tokens
        self.checkpoints.append((node, state))
        return {"ok": True, "step": self.steps}

    def finish(self, run_id, status, report):
        if self.status == "running":
            self.status = status
            self.finished = (status, report)

    def recall(self, goal):
        return ["earlier note about brent"]

    def learn(self, goal, status, sources_):
        self.learned = (status, len(sources_))


class Sequence:
    """A source that returns different results on each round (to test the critic's loop)."""

    def __init__(self, rounds):
        self.rounds, self.calls = rounds, 0

    def gather(self, subqs):
        self.calls += 1
        return self.rounds[min(self.calls, len(self.rounds)) - 1]


class Recording(models.Extractive):
    def __init__(self):
        self.seen_gaps = []

    def plan(self, goal, recall, gaps):
        self.seen_gaps.append(list(gaps))
        return super().plan(goal, recall, gaps)


# ── The critic ──
def test_two_independent_cited_sources_pass_the_critic():
    answer = "من المصادر:\n- brent held above 80 [https://example.org/a]\n- analysts expect 82 [https://example.net/b]"
    assert critic.review("q", answer, GOOD) == []


def test_one_domain_or_no_citation_is_a_gap():
    one = [GOOD[0], {"url": "https://example.org/c", "title": "C", "snippet": "x"}]
    assert "fewer than two independent sources" in critic.review("q", "see [https://example.org/a]", one)
    assert "the answer does not cite a source" in critic.review("q", "no links here", GOOD)
    assert critic.review("q", "x", []) == ["no sources were found"]


# ── The engine ──
def test_a_good_answer_is_done_checkpointed_and_learned():
    st = MemStore()
    rep = engine.run("is brent above 80?", store=st, sources=sources.StaticSources(GOOD), model=models.Extractive())
    assert rep.status == "done" and rep.answer and rep.sources == GOOD
    assert [n for n, _ in st.checkpoints] == ["perceive", "recall", "plan", "research", "analyse", "critique", "propose"]
    assert st.finished[0] == "done" and st.learned == ("done", 2)


def test_the_critic_sends_the_plan_back_at_most_twice_then_stops_incomplete():
    one_domain = [{"url": "https://example.org/a", "title": "A", "snippet": "x"}]
    st, model = MemStore(max_steps=50), Recording()          # each round costs four steps: leave room for the rounds
    rep = engine.run("q?", store=st, sources=Sequence([one_domain]), model=model, budget=engine.Budget(max_rounds=2))
    assert rep.status == "incomplete" and rep.rounds == 3
    assert model.seen_gaps[0] == [] and model.seen_gaps[1] and model.seen_gaps[2]    # the gaps reached the planner
    assert st.learned is None                                                         # an incomplete run is not learned


def test_a_second_round_can_fix_the_gap():
    one_domain = [{"url": "https://example.org/a", "title": "A", "snippet": "brent"}]
    st = MemStore()
    rep = engine.run("q?", store=st, sources=Sequence([one_domain, GOOD]), model=models.Extractive())
    assert rep.status == "done" and rep.rounds == 1


def test_no_sources_is_incomplete_and_says_why():
    st = MemStore()
    rep = engine.run("q?", store=st, sources=sources.StaticSources([]), model=models.Extractive(), budget=engine.Budget(max_rounds=0))
    assert rep.status == "incomplete" and "no sources were found" in rep.gaps


def test_a_budget_stops_the_run_and_it_is_never_called_done():
    st = MemStore(max_steps=3)
    rep = engine.run("q?", store=st, sources=sources.StaticSources(GOOD), model=models.Extractive())
    assert rep.status == "incomplete" and st.status == "incomplete" and st.finished is None
    assert len(st.checkpoints) == 3


def test_a_secret_fails_the_run_and_nothing_is_finished():
    class Leaky(models.Extractive):
        def answer(self, goal, sources_):
            return "the key is gsk_abcdefghijklmnopqrstuvwxyz0123 [https://example.org/a]"
    st = MemStore()
    rep = engine.run("q?", store=st, sources=sources.StaticSources(GOOD), model=Leaky())
    assert rep.status == "failed" and st.status == "failed" and st.finished is None and st.learned is None


def test_the_loop_never_imports_a_proposal_path():
    for mod in (engine, critic, models, sources, store_mod):
        for line in Path(mod.__file__).read_text(encoding="utf-8").splitlines():
            if line.startswith(("import ", "from ")):
                assert "proposal" not in line and "fahd" not in line and "sweeper" not in line, line


def test_the_extractive_model_answers_only_from_sources():
    m = models.Extractive()
    assert m.answer("q", []) == "ما لقيت مصادر كافية للجواب."
    assert "[https://example.org/a]" in m.answer("q", GOOD)
    assert m.plan("q", [], ["gap"])[-1].startswith("independent confirmation")


def test_the_gateway_path_falls_back_when_the_gateway_is_down():
    m = models.Cortex("http://127.0.0.1:9", "t")          # nothing listens here
    assert "[https://example.org/a]" in m.answer("q", GOOD)


def test_web_results_keep_only_http_links():
    class Fake(sources.SearxSources):
        def _search(self, q):
            return [{"url": "javascript:alert(1)", "title": "x"}, {"url": "https://example.org/a", "title": "A", "content": "c"}]
    out = Fake().gather(["q"])
    assert [s["url"] for s in out] == ["https://example.org/a"]


# ── End to end through the hakeem login (scripts/test-nerve.sh sets LOOP_TEST_SOCKET) ──
needs_db = pytest.mark.skipif(not os.environ.get("LOOP_TEST_SOCKET"), reason="needs LOOP_TEST_SOCKET (scripts/test-nerve.sh)")


@needs_db
def test_end_to_end_run_is_checkpointed_in_the_database():
    os.environ.update(AMEEN_DB_SOCKET=os.environ["LOOP_TEST_SOCKET"], LOOP_DB_USER="hakeem",
                      HAKEEM_DB_PASSWORD=os.environ.get("HAKEEM_DB_PASSWORD", "test-only"), POSTGRES_DB="omega_test")
    db = store_mod.connect()
    try:
        st = store_mod.DBStore(db)
        rep = engine.run("is brent above 80 this month?", store=st, sources=sources.StaticSources(GOOD), model=models.Extractive())
        assert rep.status == "done" and rep.run_id
        resumed = st.resume(rep.run_id)
        assert resumed["status"] == "done" and resumed["node"] == "propose"
        tight = engine.run("a question with a tiny budget", store=st, sources=sources.StaticSources(GOOD),
                           model=models.Extractive(), budget=engine.Budget(max_steps=2))
        assert tight.status == "incomplete"
        assert st.resume(tight.run_id)["status"] == "incomplete"
        assert st.resume(tight.run_id)["steps"] == 2
    finally:
        db.close()
