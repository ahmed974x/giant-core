"""Director 00: the coordinating agent, as a LangGraph state machine with long-term memory and a human gate.

    START -> retrieve (RAG over agent_memories) -> plan -> approval -> execute -> END
                                                        \\-> END (nothing to change)

  retrieve : embeds the request and recalls the closest memories (pgvector cosine, or SQLite + NumPy offline).
  plan     : drafts an answer plus a list of *proposed* actions. An OpenAI-compatible LLM is used when
             DIRECTOR_LLM_URL is set; otherwise a small rule-based planner. Planning never changes anything.
  approval : if any action is proposed, records it in director_approvals and **pauses** (LangGraph interrupt).
             The run is checkpointed to disk, so the decision can come minutes or days later, from another process.
  execute  : runs only the actions the human approved. Rejected or unapproved actions never run.

Every state change (a memory write) and every external action (a notification) is an action, so all of them pass the
gate. The only writes outside it are the approval ledger rows that record the proposal and the human's own decision.
"""

import json
import os
import re
import sqlite3
import urllib.request
import uuid
from pathlib import Path
from typing import Any, TypedDict

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from embed import get_embedder
from memory import KINDS, Store, get_store

DATA = Path(os.environ.get("DIRECTOR_DATA_DIR", Path(__file__).with_name("data")))
MIN_SCORE = 0.15
ACTION_TYPES = ("remember", "notify")


class State(TypedDict, total=False):
    request: str
    thread_id: str
    memories: list[dict]
    answer: str
    actions: list[dict]
    decision: dict
    results: list[dict]


# ── planning ────────────────────────────────────────────────────────────────────────────────────────────
_REMEMBER = re.compile(r"^\s*(remember|note|save|تذكر|تذكّر|احفظ|سجل|سجّل)\b[:\s,،-]*(.+)$", re.I | re.S)
_DECISION = re.compile(r"^\s*(decision|decided|قرار|قررت)\b[:\s,،-]*(.+)$", re.I | re.S)
_PREFER = re.compile(r"\b(i prefer|prefer|always|never|أفضل|أفضّل|دائما|دائمًا|أبدا|أبدًا)\b", re.I)
_NOTIFY = re.compile(r"^\s*(notify|alert|tell|نبه|نبّه|أرسل تنبيه|ارسل تنبيه)\b[:\s,،-]*(.+)$", re.I | re.S)


def valid_actions(raw: Any) -> list[dict]:
    """Keep only well-formed actions of known types; anything else an LLM invents is dropped."""
    out = []
    for a in raw if isinstance(raw, list) else []:
        if not isinstance(a, dict) or a.get("type") not in ACTION_TYPES:
            continue
        if a["type"] == "remember":
            content = str(a.get("content", "")).strip()
            kind = a.get("kind") if a.get("kind") in KINDS else "note"
            if 1 <= len(content) <= 4000:
                out.append({"type": "remember", "kind": kind, "content": content})
        elif a["type"] == "notify":
            msg = str(a.get("message", "")).strip()
            if 1 <= len(msg) <= 1000:
                out.append({"type": "notify", "message": msg})
    return out[:5]


def rule_plan(request: str, memories: list[dict]) -> tuple[str, list[dict]]:
    relevant = [m for m in memories if m["score"] >= MIN_SCORE]
    recall = "; ".join(f"[{m['kind']}] {m['content']}" for m in relevant[:3])
    if m := _REMEMBER.match(request):
        body = m.group(2).strip()
        kind = "preference" if _PREFER.search(body) else "note"
        return f"I will remember this as a {kind} once you approve.", [{"type": "remember", "kind": kind, "content": body}]
    if m := _DECISION.match(request):
        return "I will record this decision once you approve.", [{"type": "remember", "kind": "decision", "content": m.group(2).strip()}]
    if m := _NOTIFY.match(request):
        return "I will send this notification once you approve.", [{"type": "notify", "message": m.group(2).strip()}]
    if relevant:
        return f"From memory: {recall}", []
    return "I have nothing in memory about this yet. Say 'remember …' to teach me.", []


def llm_plan(request: str, memories: list[dict]) -> tuple[str, list[dict]]:
    url, model = os.environ["DIRECTOR_LLM_URL"].rstrip("/"), os.environ.get("DIRECTOR_LLM_MODEL", "")
    context = "\n".join(f"- ({m['kind']}, score {m['score']}) {m['content']}" for m in memories if m["score"] >= MIN_SCORE) or "- (none)"
    system = ("You are Director 00, the coordinator of the OMEGA PRIME platform. Answer the user's request using the "
              "memories when relevant. You may PROPOSE actions; a human approves each before it runs. Allowed actions: "
              '{"type":"remember","kind":"fact|decision|outcome|preference|note","content":"..."} and '
              '{"type":"notify","message":"..."}. Propose none unless the request needs a change. Reply in the '
              'language of the request, as JSON only: {"answer":"...","actions":[...]}')
    body = json.dumps({"model": model, "temperature": 0.2, "response_format": {"type": "json_object"},
                       "messages": [{"role": "system", "content": system},
                                    {"role": "user", "content": f"Memories:\n{context}\n\nRequest: {request}"}]}).encode()
    req = urllib.request.Request(f"{url}/chat/completions", data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=90) as r:
        content = json.load(r)["choices"][0]["message"]["content"]
    parsed = json.loads(content[content.find("{"): content.rfind("}") + 1])
    return str(parsed.get("answer", "")).strip(), valid_actions(parsed.get("actions"))


# ── actions (run only after approval) ───────────────────────────────────────────────────────────────────
def run_action(action: dict, store: Store, embedder, thread_id: str, by: str) -> dict:
    if action["type"] == "remember":
        mid = store.add(action["kind"], action["content"], embedder.embed(action["content"]), approved_by=by,
                        metadata={"thread_id": thread_id, "embedder": embedder.name})
        return {"type": "remember", "ok": True, "memory_id": mid}
    if action["type"] == "notify":
        target = os.environ.get("DIRECTOR_NOTIFY_URL", "").strip()
        # Only local targets (an n8n webhook, the relay): the outside world is reached through those, not from here.
        if not re.match(r"^https?://(127\.0\.0\.1|localhost)(:\d+)?/", target):
            return {"type": "notify", "ok": False, "skipped": "no local DIRECTOR_NOTIFY_URL configured"}
        req = urllib.request.Request(target, data=json.dumps({"source": "director-00", "thread_id": thread_id,
                                                             "message": action["message"]}).encode(),
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as r:
            return {"type": "notify", "ok": 200 <= r.status < 300, "status": r.status}
    return {"type": action.get("type"), "ok": False, "skipped": "unknown action"}


# ── graph ───────────────────────────────────────────────────────────────────────────────────────────────
def build(store: Store, embedder, checkpointer):
    def retrieve(s: State) -> State:
        return {"memories": store.search(embedder.embed(s["request"]), k=5)}

    def plan(s: State) -> State:
        planner = llm_plan if os.environ.get("DIRECTOR_LLM_URL") else rule_plan
        try:
            answer, actions = planner(s["request"], s.get("memories", []))
        except Exception as e:                                   # a dead LLM must not block the gate
            answer, actions = rule_plan(s["request"], s.get("memories", []))
            answer = f"(planner fallback: {type(e).__name__}) {answer}"
        return {"answer": answer, "actions": valid_actions(actions)}

    def approval(s: State) -> State:
        proposal = {"answer": s["answer"], "actions": s["actions"]}
        store.create_pending(s["thread_id"], s["request"], proposal)
        decision = interrupt({"thread_id": s["thread_id"], "request": s["request"], **proposal})
        approved = bool(isinstance(decision, dict) and decision.get("approved"))
        by = str(decision.get("by", "human")) if isinstance(decision, dict) else "human"
        store.decide(s["thread_id"], "approved" if approved else "rejected", by)
        if not approved:
            store.finish(s["thread_id"], "rejected", {"reason": decision.get("reason", "") if isinstance(decision, dict) else ""})
        return {"decision": {"approved": approved, "by": by, "only": decision.get("only") if isinstance(decision, dict) else None}}

    def execute(s: State) -> State:
        d = s["decision"]
        chosen = [a for i, a in enumerate(s["actions"]) if d.get("only") is None or i in d["only"]]
        results = []
        for a in chosen:
            try:
                results.append(run_action(a, store, embedder, s["thread_id"], d["by"]))
            except Exception as e:
                results.append({"type": a["type"], "ok": False, "error": f"{type(e).__name__}: {e}"})
        store.finish(s["thread_id"], "executed" if all(r.get("ok") or r.get("skipped") for r in results) else "failed", {"results": results})
        return {"results": results}

    g = StateGraph(State)
    g.add_node("retrieve", retrieve)
    g.add_node("plan", plan)
    g.add_node("approval", approval)
    g.add_node("execute", execute)
    g.add_edge(START, "retrieve")
    g.add_edge("retrieve", "plan")
    g.add_conditional_edges("plan", lambda s: "approval" if s.get("actions") else END, ["approval", END])
    g.add_conditional_edges("approval", lambda s: "execute" if s["decision"]["approved"] else END, ["execute", END])
    g.add_edge("execute", END)
    return g.compile(checkpointer=checkpointer)


class Director:
    """Thin facade used by the CLI and tests."""

    def __init__(self, store: Store | None = None, embedder=None, data_dir: Path = DATA):
        data_dir.mkdir(parents=True, exist_ok=True)
        self.store = store or get_store(data_dir)
        self.embedder = embedder or get_embedder()
        self._ckpt = sqlite3.connect(str(data_dir / "checkpoints.sqlite"), check_same_thread=False)
        self.graph = build(self.store, self.embedder, SqliteSaver(self._ckpt))

    def ask(self, request: str) -> dict:
        tid = uuid.uuid4().hex[:12]
        out = self.graph.invoke({"request": request.strip(), "thread_id": tid}, {"configurable": {"thread_id": tid}})
        waiting = bool(out.get("__interrupt__"))
        return {"thread_id": tid, "answer": out.get("answer"), "memories": out.get("memories", []),
                "actions": out.get("actions", []), "status": "awaiting_approval" if waiting else "done"}

    def decide(self, thread_id: str, approved: bool, by: str = "human", only: list[int] | None = None, reason: str = "") -> dict:
        row = self.store.approval(thread_id)
        if not row or row["status"] != "pending":
            raise ValueError(f"no pending proposal {thread_id}")
        out = self.graph.invoke(Command(resume={"approved": approved, "by": by, "only": only, "reason": reason}),
                                {"configurable": {"thread_id": thread_id}})
        return {"thread_id": thread_id, "approved": approved, "results": out.get("results", []),
                "status": (self.store.approval(thread_id) or {}).get("status")}

    def pending(self) -> list[dict]:
        return self.store.pending()

    def recall(self, query: str, k: int = 5) -> list[dict]:
        return self.store.search(self.embedder.embed(query), k=k)
