"""The brain loop (ADR-082, design section 4): perceive → recall → plan → research → analyse → critique → propose → learn.

Every node writes a checkpoint through the store (the database enforces the budgets and refuses secrets). A critic
that finds gaps sends the plan back at most `max_rounds` times. A run that hits a budget stops and says so: it is
marked `incomplete` with what it has, never presented as finished. The loop answers. It never proposes an order.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import critic as critic_mod


class Stop(Exception):
    """A budget or a refusal stopped the run; the store already recorded why."""

    def __init__(self, status: str, reason: str):
        super().__init__(reason)
        self.status = status
        self.reason = reason


@dataclass
class Budget:
    max_steps: int = 12
    max_tokens: int = 6000
    max_rounds: int = 2


@dataclass
class Report:
    run_id: str | None
    status: str
    answer: str | None
    sources: list[dict] = field(default_factory=list)
    gaps: list[str] = field(default_factory=list)
    rounds: int = 0
    steps: int = 0


def estimate_tokens(state: dict) -> int:
    """A rough count (about four characters per token). The database keeps the running total."""
    return max(1, len(str(state)) // 4)


def run(goal: str, *, store, sources, model, budget: Budget | None = None) -> Report:
    budget = budget or Budget()
    run_id = store.start(goal, budget.max_steps, budget.max_tokens)
    if run_id is None:
        return Report(None, "refused", None)
    ctx = {"goal": goal, "recall": [], "subqs": [], "sources": [], "answer": None, "gaps": [], "rounds": 0}
    report = Report(run_id, "running", None)

    def step(node: str, state: dict) -> None:
        result = store.step(run_id, node, state, estimate_tokens(state))
        if not result.get("ok"):
            raise Stop("failed" if result.get("reason") == "secret refused" else "incomplete", result.get("reason", "refused"))
        report.steps = result.get("step", report.steps)

    try:
        step("perceive", {"goal": goal})
        ctx["recall"] = store.recall(goal)
        step("recall", {"recall": ctx["recall"]})
        while True:
            ctx["subqs"] = model.plan(goal, ctx["recall"], ctx["gaps"])
            step("plan", {"subqs": ctx["subqs"]})
            ctx["sources"] = sources.gather(ctx["subqs"])
            step("research", {"sources": ctx["sources"]})
            ctx["answer"] = model.answer(goal, ctx["sources"])
            step("analyse", {"answer": ctx["answer"]})
            ctx["gaps"] = critic_mod.review(goal, ctx["answer"], ctx["sources"])
            step("critique", {"gaps": ctx["gaps"]})
            if not ctx["gaps"]:
                break
            ctx["rounds"] += 1
            if ctx["rounds"] > budget.max_rounds:
                raise Stop("incomplete", "the critic still finds gaps after the allowed rounds")
        step("propose", {"answer": ctx["answer"], "kind": "answer only"})
        report.status = "done"
    except Stop as stop:
        report.status = stop.status
        report.gaps = ctx["gaps"] or [stop.reason]
    report.answer = ctx["answer"]
    report.sources = ctx["sources"]
    report.rounds = ctx["rounds"]
    if report.status != "failed":
        store.finish(run_id, report.status, {"answer": report.answer, "sources": report.sources, "gaps": report.gaps,
                                             "rounds": report.rounds})
        if report.status == "done":
            store.learn(goal, report.status, report.sources)
    return report
