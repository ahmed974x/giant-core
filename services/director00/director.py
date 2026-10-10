"""Director 00: the coordinating agent, as a LangGraph state machine with long-term memory and a human gate.

    START -> retrieve (RAG over agent_memories) -> plan -> approval -> execute -> END
                                                        \\-> END (nothing to change)

  retrieve : embeds the request and recalls the closest memories (pgvector cosine, or SQLite + NumPy offline).
  plan     : drafts an answer plus a list of *proposed* actions. An OpenAI-compatible LLM is used when
             DIRECTOR_LLM_URL is set; otherwise a small rule-based planner. Planning never changes anything.
  approval : if any action is proposed, scores its risk (risk.py), records it in director_approvals and **pauses**
             (LangGraph interrupt). HIGH-risk proposals pause a second time after approval and only continue when the
             approver types the confirmation phrase. Every rejection (including timeouts after
             DIRECTOR_APPROVAL_TTL_HOURS) is logged with a reason code in director_rejections.
             The run is checkpointed to disk, so the decision can come minutes or hours later, from another process.
  execute  : runs only the actions the human approved. Rejected or unapproved actions never run.

Every state change (a memory write) and every external action (a notification) is an action, so all of them pass the
gate. The only writes outside it are the approval ledger rows that record the proposal and the human's own decision.
"""

import json
import os
import re
import sqlite3
import sys
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, TypedDict

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

import risk as risk_mod
from embed import get_embedder
from memory import KINDS, Store, get_store

DATA = Path(os.environ.get("DIRECTOR_DATA_DIR", Path(__file__).with_name("data")))
APPROVAL_TTL_H = float(os.environ.get("DIRECTOR_APPROVAL_TTL_HOURS", "24"))   # undecided proposals expire (EXPIRED-003)
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
    causal: dict


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


_EXPLAIN = re.compile(r"^\s*(why|explain|trace|what caused|لماذا|ليش|فسر|فسّر|ما سبب|وش سبب)\b", re.I)
_ASSETS = [(re.compile(r"gold|paxg|ذهب", re.I), {"type": "price_spike", "asset": "PAXGUSDT"}),
           (re.compile(r"bitcoin|btc|بيتكوين|بتكوين", re.I), {"type": "price_spike", "asset": "BTCUSDT"}),
           (re.compile(r"ether|eth|إيثيريوم|ايثيريوم", re.I), {"type": "price_spike", "asset": "ETHUSDT"}),
           (re.compile(r"solana|sol\b|سولانا", re.I), {"type": "price_spike", "asset": "SOLUSDT"}),
           (re.compile(r"oil|brent|نفط|برنت", re.I), {"type": "oil_move"}),
           (re.compile(r"congest|ازدحام", re.I), {"type": "port_congestion"}),
           (re.compile(r"ship|vessel|tanker|سفن|سفين|ناقلة|ناقلات", re.I), {"type": "ship_deviation"})]
_PLACES = {"hormuz": (26.57, 56.25), "هرمز": (26.57, 56.25), "suez": (30.6, 32.35), "السويس": (30.6, 32.35),
           "bab": (12.58, 43.33), "المندب": (12.58, 43.33), "malacca": (2.5, 100.4), "ملقا": (2.5, 100.4),
           "panama": (9.08, -79.68), "بنما": (9.08, -79.68), "jebel ali": (24.98, 55.03), "جبل علي": (24.98, 55.03)}


def explain_anomaly(request: str) -> dict | None:
    """Read-only tool: route 'why …' questions to the Butterfly Engine (services/causal). No approval needed."""
    anomaly = next((dict(a) for rx, a in _ASSETS if rx.search(request)), None)
    if anomaly is None:
        return None
    low = request.lower()
    for name, (lat, lon) in _PLACES.items():
        if name in low:
            anomaly.update(lat=lat, lon=lon, place=name)
            break
    causal = Path(__file__).resolve().parents[1] / "causal"
    if str(causal) not in sys.path:
        sys.path.insert(0, str(causal))
    import butterfly_engine
    return butterfly_engine.run(anomaly, offline=os.environ.get("DIRECTOR_OFFLINE") == "1")


def explain_answer(request: str, result: dict) -> str:
    arabic = bool(re.search(r"[؀-ۿ]", request))
    lines = [("أقوى الأسباب الجذرية المحتملة:" if arabic else "Most likely root-cause chains:")]
    for i, ch in enumerate(result["chains"], 1):
        weak = sum(1 for l in ch["links"] if l["evidence"] == "prior")
        tag = (f" ({weak} روابط بلا بيانات بعد)" if arabic else f" ({weak} links still prior-only)") if weak else ""
        lines.append(f"{i}. {ch['text_ar'] if arabic else ch['text_en']} [{ch['share']:.0%}]{tag}")
    return "\n".join(lines)


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
def run_action(action: dict, store: Store, embedder, thread_id: str, by: str, external_ok: bool = False) -> dict:
    if action["type"] == "remember":
        mid = store.add(action["kind"], action["content"], embedder.embed(action["content"]), approved_by=by,
                        metadata={"thread_id": thread_id, "embedder": embedder.name})
        return {"type": "remember", "ok": True, "memory_id": mid}
    if action["type"] == "notify":
        target = os.environ.get("DIRECTOR_NOTIFY_URL", "").strip()
        # Local targets (an n8n webhook, the relay) need one approval; anything else only after the second,
        # high-risk confirmation. Plain http to the outside world is never allowed.
        if not target:
            return {"type": "notify", "ok": False, "skipped": "no DIRECTOR_NOTIFY_URL configured"}
        if not risk_mod.LOCAL.match(target) and not (external_ok and target.startswith("https://")):
            return {"type": "notify", "ok": False, "skipped": "external target needs a confirmed high-risk approval over https"}
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
        if _EXPLAIN.match(s["request"]):                         # read-only causal tool: answer, no actions
            try:
                result = explain_anomaly(s["request"])
                if result:
                    return {"answer": explain_answer(s["request"], result), "actions": [], "causal": result}
            except Exception as e:
                return {"answer": f"Butterfly Engine unavailable: {type(e).__name__}: {e}", "actions": []}
        planner = llm_plan if os.environ.get("DIRECTOR_LLM_URL") else rule_plan
        try:
            answer, actions = planner(s["request"], s.get("memories", []))
        except Exception as e:                                   # a dead LLM must not block the gate
            answer, actions = rule_plan(s["request"], s.get("memories", []))
            answer = f"(planner fallback: {type(e).__name__}) {answer}"
        return {"answer": answer, "actions": valid_actions(actions)}

    def approval(s: State) -> State:
        # On resume LangGraph re-runs this node from the top and replays earlier interrupt() answers in order, so every
        # store write below is idempotent (guarded by the current status).
        tid = s["thread_id"]
        risk = risk_mod.assess(s["actions"])
        proposal = {"answer": s["answer"], "actions": s["actions"], "risk": risk}
        store.create_pending(tid, s["request"], proposal, risk)

        first = interrupt({"stage": "first", "thread_id": tid, "request": s["request"], **proposal}) or {}
        by = str(first.get("by", "human"))
        if not first.get("approved"):
            store.reject(tid, first.get("code", "USER-005"), first.get("stage", "first"), first.get("reason", ""), by)
            return {"decision": {"approved": False, "by": by, "code": first.get("code", "USER-005")}}

        if risk["level"] == "high":
            store.escalate(tid, by)
            phrase = risk_mod.confirm_phrase(tid)
            second = interrupt({"stage": "confirm", "thread_id": tid, "risk": risk, "type_to_confirm": phrase}) or {}
            confirmer = str(second.get("by", by))
            if not second.get("approved") or second.get("phrase", "").strip().upper() != phrase:
                code = second.get("code") or "ESCALATION-004"
                store.reject(tid, code, second.get("stage", "confirm"), second.get("reason", "") or "second confirmation not given", confirmer)
                return {"decision": {"approved": False, "by": confirmer, "code": code}}
            store.confirm(tid, confirmer)
            return {"decision": {"approved": True, "by": by, "confirmed_by": confirmer, "high_risk": True, "only": first.get("only")}}

        store.decide(tid, "approved", by)
        return {"decision": {"approved": True, "by": by, "high_risk": False, "only": first.get("only")}}

    def execute(s: State) -> State:
        d = s["decision"]
        chosen = [a for i, a in enumerate(s["actions"]) if d.get("only") is None or i in d["only"]]
        results = []
        for a in chosen:
            try:
                results.append(run_action(a, store, embedder, s["thread_id"], d["by"], external_ok=d.get("high_risk", False)))
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
        self.data_dir = data_dir
        self.store = store or get_store(data_dir)
        self.embedder = embedder or get_embedder()
        self._ckpt = sqlite3.connect(str(data_dir / "checkpoints.sqlite"), check_same_thread=False)
        self.graph = build(self.store, self.embedder, SqliteSaver(self._ckpt))

    def ask(self, request: str) -> dict:
        tid = uuid.uuid4().hex[:12]
        out = self.graph.invoke({"request": request.strip(), "thread_id": tid}, {"configurable": {"thread_id": tid}})
        waiting = bool(out.get("__interrupt__"))
        return {"thread_id": tid, "answer": out.get("answer"), "memories": out.get("memories", []),
                "actions": out.get("actions", []), "causal": out.get("causal"),
                "status": "awaiting_approval" if waiting else "done"}

    def _resume(self, thread_id: str, answer: dict) -> dict:
        out = self.graph.invoke(Command(resume=answer), {"configurable": {"thread_id": thread_id}})
        row = self.store.approval(thread_id) or {}
        res = {"thread_id": thread_id, "status": row.get("status"), "results": out.get("results", [])}
        if row.get("status") == "escalated":
            res["type_to_confirm"] = risk_mod.confirm_phrase(thread_id)
            res["risk"] = row.get("risk")
        return res

    def _expired(self, row: dict) -> bool:
        return datetime.now(timezone.utc) - row["created_at"] > timedelta(hours=APPROVAL_TTL_H)

    def decide(self, thread_id: str, approved: bool, by: str = "human", only: list[int] | None = None,
               reason: str = "", code: str = "USER-005") -> dict:
        """First-level decision. High-risk proposals come back as 'escalated' and need confirm()."""
        row = self.store.approval(thread_id)
        if not row or row["status"] != "pending":
            raise ValueError(f"no pending proposal {thread_id}")
        if code not in risk_mod.REJECTION_CODES:
            raise ValueError(f"unknown rejection code {code}; use one of {', '.join(risk_mod.REJECTION_CODES)}")
        if self._expired(row):
            return self._resume(thread_id, {"approved": False, "by": "system", "code": "EXPIRED-003", "stage": "timeout",
                                            "reason": f"older than {APPROVAL_TTL_H} h"})
        return self._resume(thread_id, {"approved": approved, "by": by, "only": only, "reason": reason, "code": code})

    def confirm(self, thread_id: str, phrase: str, by: str = "human", approved: bool = True, reason: str = "") -> dict:
        """Second-level confirmation for a high-risk proposal; the phrase must match exactly."""
        row = self.store.approval(thread_id)
        if not row or row["status"] != "escalated":
            raise ValueError(f"no escalated proposal {thread_id}")
        if self._expired(row):
            return self._resume(thread_id, {"approved": False, "by": "system", "code": "EXPIRED-003", "stage": "timeout",
                                            "reason": f"older than {APPROVAL_TTL_H} h"})
        return self._resume(thread_id, {"approved": approved, "by": by, "phrase": phrase, "reason": reason})

    def expire_stale(self) -> list[str]:
        """Reject (EXPIRED-003) every pending or escalated proposal older than the approval window."""
        expired = []
        for p in self.store.pending():
            row = self.store.approval(p["thread_id"])
            if row and self._expired(row):
                self._resume(p["thread_id"], {"approved": False, "by": "system", "code": "EXPIRED-003", "stage": "timeout",
                                              "reason": f"older than {APPROVAL_TTL_H} h"})
                expired.append(p["thread_id"])
        return expired

    def rejections(self, thread_id: str | None = None) -> list[dict]:
        return self.store.rejections(thread_id)

    def backup(self) -> dict:
        """Snapshot memory + ledger (SQLite backup API) and the approval checkpoints into data/backups/."""
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        dest = self.data_dir / "backups" / stamp
        files = []
        if hasattr(self.store, "backup"):
            files.append(str(self.store.backup(dest / "director.sqlite")))
        else:                                                   # Postgres: export memories as JSON lines (pg_dump is the full path)
            dest.mkdir(parents=True, exist_ok=True)
            rows = self.store.con.run("SELECT row_to_json(m)::text FROM (SELECT id, agent, kind, content, metadata, approved_by, created_at "
                                      "FROM agent_memories ORDER BY id) m")
            (dest / "agent_memories.jsonl").write_text("\n".join(r[0] for r in rows), encoding="utf-8")
            files.append(str(dest / "agent_memories.jsonl"))
        with sqlite3.connect(str(dest / "checkpoints.sqlite")) as out:
            self._ckpt.backup(out)
        files.append(str(dest / "checkpoints.sqlite"))
        return {"backup": str(dest), "files": files, "at": stamp}

    def pending(self) -> list[dict]:
        return self.store.pending()

    def recall(self, query: str, k: int = 5) -> list[dict]:
        return self.store.search(self.embedder.embed(query), k=k)
