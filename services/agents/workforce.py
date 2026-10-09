"""OMEGA workforce: small autonomous agents that work in the background and report to the Ops Room.

Each agent is a class with a name, a role, a cadence and a ``run()`` that returns a short report.
Agents never change the system on their own: anything that would add or install something becomes a
*proposal* that waits in the inbox until the Architect answers "add" or "skip" in the Ops Room.

Standard library only (sqlite3 inbox), so the service costs ~30 MB of RAM.
"""

from __future__ import annotations

import json
import math
import os
import re
import sqlite3
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

API = os.environ.get("OMEGA_API_URL", "http://relay:8080").rstrip("/")
CORTEX = os.environ.get("CORTEX_URL", "http://cortex:8090").rstrip("/")
GATEWAY_TOKEN = os.environ.get("OMEGA_GATEWAY_TOKEN", "")
DB_PATH = os.environ.get("OMEGA_AGENTS_DB", ":memory:")


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def get_json(url: str, timeout: float = 10, headers: dict | None = None):
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "omega-agents", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def ask_cortex(prompt: str, max_tokens: int = 220) -> str | None:
    """One short answer from the Cortex gateway (free tiers first). None when Cortex is unavailable."""
    if len(GATEWAY_TOKEN) < 32:
        return None
    body = json.dumps({"model": "omega/fast", "max_tokens": max_tokens,
                       "messages": [{"role": "user", "content": prompt}]}).encode()
    req = urllib.request.Request(f"{CORTEX}/v1/chat/completions", data=body, method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {GATEWAY_TOKEN}"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())["choices"][0]["message"]["content"].strip()
    except (OSError, KeyError, ValueError):
        return None


# ── inbox: agent runs, briefs and proposals ─────────────────────────────────────
class Inbox:
    SCHEMA = """
    CREATE TABLE IF NOT EXISTS runs (agent TEXT, at TEXT, ok INTEGER, summary TEXT);
    CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY, agent TEXT, at TEXT, title TEXT, url TEXT, kind TEXT, score REAL,
      reasons TEXT, cost TEXT, status TEXT DEFAULT 'pending', decided_at TEXT);
    """

    def __init__(self, path: str = DB_PATH):
        self.lock = threading.Lock()
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(self.SCHEMA)

    def log_run(self, agent: str, ok: bool, summary: str):
        with self.lock, self.db:
            self.db.execute("INSERT INTO runs VALUES (?,?,?,?)", (agent, now(), int(ok), summary[:2000]))
            self.db.execute("DELETE FROM runs WHERE rowid NOT IN (SELECT rowid FROM runs ORDER BY at DESC LIMIT 500)")

    def last_run(self, agent: str) -> dict | None:
        with self.lock:
            r = self.db.execute("SELECT * FROM runs WHERE agent=? ORDER BY at DESC LIMIT 1", (agent,)).fetchone()
        return dict(r) if r else None

    def propose(self, agent: str, p: dict) -> bool:
        """Insert a proposal once; an answered one is never re-asked."""
        with self.lock, self.db:
            cur = self.db.execute(
                "INSERT OR IGNORE INTO proposals (id, agent, at, title, url, kind, score, reasons, cost) VALUES (?,?,?,?,?,?,?,?,?)",
                (p["id"], agent, now(), p["title"], p["url"], p["kind"], p["score"], json.dumps(p["reasons"]), p["cost"]))
            return cur.rowcount == 1

    def proposals(self, status: str | None = "pending", limit: int = 30) -> list[dict]:
        q, args = "SELECT * FROM proposals", []
        if status:
            q, args = q + " WHERE status=?", [status]
        with self.lock:
            rows = self.db.execute(q + " ORDER BY score DESC, at DESC LIMIT ?", (*args, limit)).fetchall()
        return [{**dict(r), "reasons": json.loads(r["reasons"])} for r in rows]

    def decide(self, pid: str, decision: str) -> bool:
        if decision not in ("approved", "skipped"):
            raise ValueError("decision must be approved or skipped")
        with self.lock, self.db:
            cur = self.db.execute("UPDATE proposals SET status=?, decided_at=? WHERE id=? AND status='pending'", (decision, now(), pid))
            return cur.rowcount == 1


# ── agents ─────────────────────────────────────────────────────────────────────
class Agent:
    name = "agent"
    title = "Agent"
    role = ""
    every_s = 3600

    def __init__(self, inbox: Inbox):
        self.inbox = inbox
        self.next_at = 0.0

    def run(self) -> str:  # pragma: no cover - overridden
        raise NotImplementedError

    def tick(self) -> None:
        if time.time() < self.next_at:
            return
        self.next_at = time.time() + self.every_s
        try:
            self.inbox.log_run(self.name, True, self.run())
        except Exception as e:  # an agent failing must never stop the others
            self.inbox.log_run(self.name, False, f"{type(e).__name__}: {e}")

    def card(self) -> dict:
        last = self.inbox.last_run(self.name)
        return {"name": self.name, "title": self.title, "role": self.role, "every_min": self.every_s // 60,
                "last": last, "next_in_s": max(0, int(self.next_at - time.time()))}


class Sentinel(Agent):
    """Watches the health of every node and writes one line on what changed."""
    name, title, every_s = "sentinel", "Sentinel · watchdog", 120
    role = "Checks every service each 2 minutes and reports outages and recoveries."

    def __init__(self, inbox: Inbox):
        super().__init__(inbox)
        self.prev: dict = {}

    def run(self) -> str:
        status = get_json(f"{API}/status")
        nodes = {k: v for k, v in status.items() if k != "checkedAt"}
        down = sorted(k for k, v in nodes.items() if v == "down")
        changed = [f"{k} {self.prev.get(k, '?')}→{v}" for k, v in nodes.items() if self.prev and self.prev.get(k) != v]
        self.prev = nodes
        head = "All systems nominal." if not down else f"DOWN: {', '.join(down)}."
        return head + (f" Changes: {'; '.join(changed)}." if changed else "")


class Analyst(Agent):
    """Turns the quant and neural engines' numbers into a three-line market brief."""
    name, title, every_s = "analyst", "Analyst · market brief", 900
    role = "Every 15 minutes: reads risk, forecasts and anomalies and writes a short brief."

    def run(self) -> str:
        quant = get_json(f"{API}/quant")
        try:
            neural = get_json(f"{API}/neural")
        except OSError:
            neural = {}
        anomalies = get_json(f"{API}/api/anomalies?order=ts.desc&limit=5")
        facts = []
        for sym, p in (quant.get("pairs") or {}).items():
            if not p:
                continue
            n = (neural.get("pairs") or {}).get(sym) or {}
            line = f"{sym}: {p['regime']} regime, EWMA vol {p['ewma_vol_ann_pct']}%, z {p['zscore']}, 24h {p['momentum_pct']['24h']}%"
            if n:
                line += f", next-hour up-probability {n['p_up_1h']:.0%} (model edge {neural['model']['direction_edge']:+.1%})"
            facts.append(line)
        facts += [f"anomaly {a['symbol']} {a['kind']} {a['severity']}: {a['reason']}" for a in anomalies[:3]]
        if not facts:
            return "No market data yet."
        brief = ask_cortex("You are the OMEGA market analyst. In at most 3 short sentences, state what matters "
                           "for risk right now. No trading advice. Facts:\n" + "\n".join(facts))
        return brief or " | ".join(facts[:4])


class Scout(Agent):
    """Searches GitHub for trusted, free, open-source tools that fit the stack and proposes them."""
    name, title, every_s = "scout", "Scout · tool research", 24 * 3600
    role = "Daily: researches open-source tools (Python, Scala, data, forecasting) and asks before adding any."

    OSI = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "MPL-2.0", "ISC", "LGPL-3.0", "LGPL-2.1", "PSF-2.0", "Unlicense", "0BSD"}
    # what the stack would gain → words that signal it
    NEEDS = {
        "faster forecasting": ["forecast", "time-series", "time series", "timeseries", "prophet", "arima", "temporal"],
        "faster data": ["dataframe", "polars", "arrow", "columnar", "fast", "jit", "numba", "vectorized", "olap", "query engine"],
        "smarter models": ["machine learning", "deep learning", "neural", "gradient boosting", "xgboost", "lightgbm", "pytorch"],
        "agents & automation": ["agent", "workflow", "orchestration", "llm", "autonomous", "rag"],
        "better visuals": ["visualization", "dashboard", "plot", "chart", "interactive"],
        "streaming": ["stream", "real-time", "realtime", "event", "kafka"],
    }
    QUERIES = [
        "topic:time-series language:python stars:>2000",
        "topic:forecasting stars:>1500",
        "topic:dataframe stars:>3000",
        "topic:python topic:machine-learning stars:>15000",
        "topic:python topic:agents stars:>5000",
        "topic:scala stars:>5000",
    ]
    HEAVY = {"Scala": "needs a JVM (~0.5–1 GB RAM)", "Java": "needs a JVM (~0.5–1 GB RAM)", "C++": "native build"}

    def __init__(self, inbox: Inbox, known: set[str] | None = None):
        super().__init__(inbox)
        self.known = {k.lower() for k in (known or set())}

    @classmethod
    def assess(cls, repo: dict) -> dict | None:
        """Trust + relevance score in [0, 100], or None when the repo must not be proposed."""
        lic = (repo.get("license") or {}).get("spdx_id")
        if repo.get("archived") or repo.get("fork") or lic not in cls.OSI:
            return None
        pushed = datetime.fromisoformat(repo["pushed_at"].replace("Z", "+00:00"))
        age_days = (datetime.now(timezone.utc) - pushed).days
        if age_days > 180:
            return None
        text = " ".join([repo.get("description") or "", " ".join(repo.get("topics") or [])]).lower()   # names are too noisy
        gains = [need for need, words in cls.NEEDS.items() if any(re.search(r"\b" + re.escape(w), text) for w in words)]
        if not gains:
            return None
        stars = repo.get("stargazers_count", 0)
        trust = min(40, 8 * math.log10(max(stars, 10))) + (10 if age_days <= 30 else 5) + (5 if repo.get("forks_count", 0) > 500 else 0)
        relevance = 12 * len(gains) + (10 if repo.get("language") == "Python" else 0)
        reasons = [f"helps: {', '.join(gains)}", f"{stars:,} stars · {lic} · updated {age_days} d ago"]
        cost = cls.HEAVY.get(repo.get("language") or "", "library · check its RAM use before installing")
        if repo.get("language") in cls.HEAVY:
            reasons.append(f"caution: {cost}")
            relevance -= 15
        return {"id": repo["full_name"].lower(), "title": repo["full_name"], "url": repo["html_url"], "score": round(trust + relevance, 1),
                "kind": repo.get("language") or "other", "reasons": reasons + [repo.get("description") or ""], "cost": cost}

    def search(self, q: str) -> list[dict]:
        url = "https://api.github.com/search/repositories?" + urllib.parse.urlencode({"q": q + " archived:false", "sort": "stars", "per_page": 15})
        return get_json(url, timeout=20, headers={"Accept": "application/vnd.github+json"}).get("items", [])

    def run(self) -> str:
        new, seen = 0, 0
        for q in self.QUERIES:
            for repo in self.search(q):
                seen += 1
                if repo["name"].lower() in self.known or repo["full_name"].lower() in self.known:
                    continue
                p = self.assess(repo)
                if p and p["score"] >= 45 and self.inbox.propose(self.name, p):
                    new += 1
            time.sleep(7)                                   # stay under GitHub's 10 searches/min without a token
        return f"Reviewed {seen} repositories, {new} new proposals waiting for your answer."

