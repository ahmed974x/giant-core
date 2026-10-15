"""OMEGA Brain: the Architect's own AI behind the Ops Room search bar.

One request (a question, a design, or a change to the site) goes through a web of specialist agents
that build on each other's work:

    Memory      recalls what the Brain learned from earlier requests (SQLite FTS5)
    Planner     classifies the request (ask / design / change) and writes a plan + research questions
    Researcher  answers those questions from the live system, memory and GitHub (awesome-list trust)
    Designer    produces the design / solution / step-by-step change plan
    Critic      reviews it for security holes, RAM cost on the 7 GB laptop, and gaps
    Synthesizer merges everything into the final answer
    (Memory again) stores the request, the answer and the critic's lessons for next time

Every thinking step is one call to the Cortex gateway on the open-weight route (free models first).
The Brain proposes; it never edits the site by itself.
"""

from __future__ import annotations

import json
import re
import sqlite3
import threading
import time
import urllib.request
import uuid
from collections import OrderedDict

import workforce as wf

ROUTE = "omega/open"
MAX_REQUEST = 4000
AGENTS = [
    ("memory", "Memory", "Recalls what was learned before"),
    ("planner", "Planner", "Classifies the request and plans it"),
    ("researcher", "Researcher", "Gathers evidence from the system, memory and GitHub"),
    ("designer", "Designer", "Designs the solution"),
    ("critic", "Critic", "Reviews security, cost and gaps"),
    ("synthesizer", "Synthesizer", "Writes the final answer"),
]

SYSTEM = ("You are part of OMEGA, a private crypto-market intelligence system on a 7 GB RAM laptop: TimescaleDB, n8n, "
          "a Node relay serving the Ops Room dashboard, Cortex LLM gateway, stdlib quant engine, PyTorch forecaster, "
          "Panel Studio with a DuckDB vault, a Supabase mirror and background agents. Be concrete and brief. "
          "Never give trading advice. Never suggest committing secrets.")
PROMPTS = {
    "planner": ("Classify the request as ask, design or change. Reply with JSON only: "
                '{"intent": "...", "goal": "...", "plan": ["step", ...], "questions": ["research question", ...]} '
                "with at most 4 plan steps and 3 questions."),
    "researcher": "Answer each research question from the evidence. Cite which evidence item supports each answer. Say what is unknown.",
    "designer": ("Produce the design or solution. For a change: the files/services to touch, the UI or API shape, and the "
                 "steps in order. For a design: layout, components, colours, states. For a question: the reasoning."),
    "critic": ("Review the design. List concrete problems only: security holes (auth, injection, secrets, CSP, exposed ports), "
               "RAM/CPU cost on the laptop, missing tests, wrong assumptions. For each, the fix. End with one line: LESSON: <what to remember next time>."),
    "synthesizer": "Write the final answer for the Architect: lead with the answer, then the plan with the critic's fixes applied. Under 250 words.",
}


class Memory:
    """Long-term memory: past requests and lessons, searchable with SQLite full-text search."""

    def __init__(self, db: sqlite3.Connection, lock: threading.Lock):
        self.db, self.lock = db, lock
        with self.lock, self.db:
            self.db.executescript("""
            CREATE TABLE IF NOT EXISTS brain_jobs (id TEXT PRIMARY KEY, at TEXT, request TEXT, intent TEXT, answer TEXT, lesson TEXT);
            CREATE VIRTUAL TABLE IF NOT EXISTS brain_fts USING fts5(request, answer, lesson, content='brain_jobs', content_rowid='rowid');
            """)

    def recall(self, text: str, k: int = 3) -> list[dict]:
        terms = re.findall(r"\w{3,}", text.lower())[:12]
        if not terms:
            return []
        q = " OR ".join(f'"{t}"' for t in terms)
        with self.lock:
            rows = self.db.execute(
                "SELECT j.at, j.request, j.intent, j.answer, j.lesson FROM brain_fts f JOIN brain_jobs j ON j.rowid = f.rowid "
                "WHERE brain_fts MATCH ? ORDER BY rank LIMIT ?", (q, k)).fetchall()
        cols = ["at", "request", "intent", "answer", "lesson"]
        return [dict(zip(cols, r, strict=True)) for r in rows]

    def remember(self, jid: str, request: str, intent: str, answer: str, lesson: str):
        with self.lock, self.db:
            self.db.execute("INSERT OR REPLACE INTO brain_jobs VALUES (?,?,?,?,?,?)", (jid, wf.now(), request, intent, answer, lesson))
            rowid = self.db.execute("SELECT rowid FROM brain_jobs WHERE id=?", (jid,)).fetchone()[0]
            self.db.execute("INSERT INTO brain_fts(rowid, request, answer, lesson) VALUES (?,?,?,?)", (rowid, request, answer, lesson))

    def count(self) -> int:
        with self.lock:
            return self.db.execute("SELECT count(*) FROM brain_jobs").fetchone()[0]


def think(role: str, content: str, max_tokens: int = 700) -> str | None:
    """One Cortex call for one agent; None when no model is reachable."""
    if len(wf.GATEWAY_TOKEN) < 32:
        return None
    body = json.dumps({"model": ROUTE, "max_tokens": max_tokens, "messages": [
        {"role": "system", "content": SYSTEM + " Your role: " + role + ". " + PROMPTS[role]},
        {"role": "user", "content": content}]}).encode()
    req = urllib.request.Request(f"{wf.CORTEX}/v1/chat/completions", data=body, method="POST",  # noqa: S310 - opened via wf.http_open
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {wf.GATEWAY_TOKEN}"})
    try:
        with wf.http_open(req, 120) as r:
            j = json.loads(r.read())
        return j["choices"][0]["message"]["content"].strip()
    except (OSError, KeyError, ValueError):
        return None


def parse_plan(text: str | None, request: str) -> dict:
    """The planner's JSON, tolerant of code fences; a sensible default when it is missing."""
    if text:
        m = re.search(r"\{.*\}", text, re.S)
        if m:
            try:
                p = json.loads(m.group(0))
                if isinstance(p.get("plan"), list) and isinstance(p.get("questions"), list):
                    return {"intent": str(p.get("intent", "ask"))[:12], "goal": str(p.get("goal", request))[:300],
                            "plan": [str(x)[:200] for x in p["plan"][:4]], "questions": [str(x)[:200] for x in p["questions"][:3]]}
            except ValueError:
                pass
    intent = "change" if re.search(r"\b(change|edit|add|fix|remove|عدل|ضيف|اضف|صلح)", request, re.I) else \
             "design" if re.search(r"\b(design|layout|ui|صمم|تصميم)", request, re.I) else "ask"
    return {"intent": intent, "goal": request[:300], "plan": ["Gather evidence", "Draft a solution", "Review it", "Answer"],
            "questions": [request[:200]]}


class Brain:
    def __init__(self, inbox: wf.Inbox, evidence=None):
        self.memory = Memory(inbox.db, inbox.lock)
        self.jobs: OrderedDict[str, dict] = OrderedDict()
        self.busy = threading.Lock()
        self.evidence = evidence or self.live_evidence

    # ── evidence the Researcher can cite ──
    @staticmethod
    def live_evidence(questions: list[str]) -> list[str]:
        items = []
        for path, label in (("/status", "service health"), ("/plugins.json", "installed modules"), ("/quant", "risk engine")):
            try:
                items.append(f"[{label}] " + json.dumps(wf.get_json(f"{wf.API}{path}"))[:1200])
            except OSError:
                items.append(f"[{label}] unavailable")
        words = " ".join(questions).lower()
        if re.search(r"tool|library|model|open.?source|github|package|أداة|ادوات|مكتبة", words):
            try:
                hits = wf.Scout(wf.Inbox(":memory:")).search(" ".join(re.findall(r"[a-z][a-z-]{3,}", words)[:4]) + " stars:>1000")
                items += [f"[github] {h['full_name']} · {h['stargazers_count']}★ · {(h.get('license') or {}).get('spdx_id')} · {h.get('description') or ''}"[:300]
                          for h in hits[:6] if wf.Scout.assess(h) or h.get("stargazers_count", 0) > 5000]
            except OSError:
                items.append("[github] search unavailable")
        return items

    # ── job lifecycle ──
    def submit(self, request: str) -> dict:
        request = (request or "").strip()
        if not 3 <= len(request) <= MAX_REQUEST:
            raise ValueError(f"request must be 3–{MAX_REQUEST} characters")
        if sum(1 for j in self.jobs.values() if j["status"] in ("queued", "running")) >= 3:
            raise RuntimeError("the Brain is busy with 3 requests; try again shortly")
        jid = uuid.uuid4().hex[:12]
        job = {"id": jid, "request": request, "status": "queued", "at": wf.now(), "intent": None, "answer": None,
               "steps": [{"agent": a, "title": t, "role": r, "status": "waiting", "output": None, "ms": None} for a, t, r in AGENTS]}
        self.jobs[jid] = job
        while len(self.jobs) > 20:
            self.jobs.popitem(last=False)
        threading.Thread(target=self._run, args=(job,), daemon=True).start()
        return job

    def _step(self, job: dict, agent: str, fn):
        st = next(s for s in job["steps"] if s["agent"] == agent)
        st["status"], t0 = "working", time.time()
        try:
            out = fn()
            st["status"], st["output"] = "done", out
        except Exception as e:  # one agent failing must not lose the whole job
            st["status"], st["output"], out = "failed", f"{type(e).__name__}: {e}", None
        st["ms"] = int((time.time() - t0) * 1000)
        return out

    def _run(self, job: dict):
        with self.busy:                                            # one thinking pipeline at a time on the laptop
            job["status"] = "running"
            req = job["request"]
            past = self._step(job, "memory", lambda: self.memory.recall(req))
            past_txt = "\n".join(f"- earlier ({p['intent']}): {p['request'][:160]} → lesson: {p['lesson'] or '—'}" for p in past or []) or "none"
            if past:
                next(s for s in job["steps"] if s["agent"] == "memory")["output"] = f"{len(past)} related memories:\n{past_txt}"
            else:
                next(s for s in job["steps"] if s["agent"] == "memory")["output"] = "Nothing related in memory yet."

            raw = self._step(job, "planner", lambda: think("planner", f"Request: {req}\nRelated memory:\n{past_txt}"))
            plan = parse_plan(raw, req)
            job["intent"] = plan["intent"]
            next(s for s in job["steps"] if s["agent"] == "planner")["output"] = (
                f"Intent: {plan['intent']}\nGoal: {plan['goal']}\nPlan:\n" + "\n".join(f"{i + 1}. {p}" for i, p in enumerate(plan["plan"]))
                + "\nQuestions:\n" + "\n".join(f"- {q}" for q in plan["questions"]) + ("" if raw else "\n(no model reachable: default plan)"))

            evidence = self._step(job, "researcher", lambda: self.evidence(plan["questions"]))
            ev_txt = "\n".join(evidence or [])
            research = think("researcher", "Questions:\n" + "\n".join(plan["questions"]) + f"\n\nEvidence:\n{ev_txt}") if evidence else None
            next(s for s in job["steps"] if s["agent"] == "researcher")["output"] = research or ("Evidence collected:\n" + ev_txt[:1500])

            design = self._step(job, "designer", lambda: think("designer", f"Request: {req}\nPlan: {json.dumps(plan)}\nResearch:\n{research or ev_txt[:2000]}", 900))
            critique = self._step(job, "critic", lambda: think("critic", f"Request: {req}\nDesign:\n{design}") if design else None)
            answer = self._step(job, "synthesizer", lambda: think(
                "synthesizer", f"Request: {req}\nDesign:\n{design}\nCritique:\n{critique}") if design else None)

            if not answer:
                answer = ("No AI model is reachable, so the Brain could only plan and gather evidence. Add a free key "
                          "(GROQ_API_KEY or NVIDIA_API_KEY in .env) or start the local model with --profile llm, then ask again.\n\n"
                          "Evidence gathered:\n" + ev_txt[:1500])
                for s in job["steps"]:
                    if s["agent"] in ("designer", "critic", "synthesizer") and s["output"] is None:
                        s["status"], s["output"] = "skipped", "needs a model"
            lesson = (re.search(r"LESSON:\s*(.+)", critique or "") or [None, ""])[1].strip()[:300]
            job["answer"], job["status"] = answer, "done"
            self.memory.remember(job["id"], req, plan["intent"], answer, lesson)

    def get(self, jid: str) -> dict | None:
        return self.jobs.get(jid)
