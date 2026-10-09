"""OMEGA agents service: runs the workforce on its schedule and serves the roster and the proposal inbox.

    GET  /agents              roster (each agent's role, cadence, last report) + pending proposals
    POST /agents/decide       {"id": "<proposal id>", "decision": "approved" | "skipped"}
    GET  /healthz

The relay exposes these to the Ops Room (the POST only from the same origin). An approved proposal is
recorded, not installed: adding a tool stays a deliberate step (copy plugins/_template, install, test).
"""

from __future__ import annotations

import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from brain import AGENTS as BRAIN_AGENTS, Brain
from workforce import API, Analyst, Inbox, Scout, Sentinel, get_json

PORT = int(os.environ.get("PORT", "8093"))
# Already in the stack, so the Scout never proposes them again.
BUILT_IN = {"panel", "panel-material-ui", "hvplot", "holoviews", "bokeh", "duckdb", "pytorch", "torch", "stdlib",
            "n8n", "timescaledb", "postgrest", "ollama", "supabase", "streamlit", "pandas", "numpy"}


def known_tools() -> set[str]:
    try:
        return BUILT_IN | {p["id"] for p in get_json(f"{API}/plugins.json").get("plugins", [])}
    except OSError:
        return BUILT_IN


inbox = Inbox()
brain = Brain(inbox)
workforce = [Sentinel(inbox), Analyst(inbox), Scout(inbox, known_tools())]
workforce[2].next_at = time.time() + 120          # let the stack settle before the first GitHub search


def loop() -> None:
    while True:
        for agent in workforce:
            agent.tick()
        time.sleep(15)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: dict):
        data = json.dumps(body, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/agents":
            return self._send(200, {"agents": [a.card() for a in workforce], "proposals": inbox.proposals("pending"),
                                    "decided": inbox.proposals(None, 10)})
        if self.path == "/brain":
            return self._send(200, {"agents": [{"agent": a, "title": t, "role": r} for a, t, r in BRAIN_AGENTS],
                                    "memories": brain.memory.count(), "recent": [
                                        {k: j[k] for k in ("id", "at", "request", "intent", "status")} for j in reversed(brain.jobs.values())][:10]})
        if self.path.startswith("/brain/jobs/"):
            job = brain.get(self.path.rsplit("/", 1)[-1][:32])
            return self._send(200, job) if job else self._send(404, {"error": "unknown job"})
        if self.path == "/healthz":
            return self._send(200, {"status": "ok"})
        self._send(404, {"error": "not found"})

    def _body(self, limit: int) -> dict:
        n = int(self.headers.get("Content-Length", "0"))
        if n > limit:
            raise ValueError("body too large")
        body = json.loads(self.rfile.read(n))
        if not isinstance(body, dict):
            raise ValueError("expected a JSON object")
        return body

    def do_POST(self):
        if self.path == "/brain/ask":
            try:
                job = brain.submit(str(self._body(16384).get("request", "")))
                return self._send(202, {"id": job["id"], "status": job["status"]})
            except RuntimeError as e:
                return self._send(429, {"error": str(e)})
            except (ValueError, json.JSONDecodeError) as e:
                return self._send(400, {"error": str(e)})
        if self.path != "/agents/decide":
            return self._send(404, {"error": "not found"})
        try:
            body = self._body(2048)
            ok = inbox.decide(str(body["id"])[:200], str(body["decision"]))
            self._send(200 if ok else 409, {"ok": ok})
        except (ValueError, KeyError, json.JSONDecodeError) as e:
            self._send(400, {"error": str(e)})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    threading.Thread(target=loop, daemon=True).start()
    print(f"omega agents listening on :{PORT} · {', '.join(a.name for a in workforce)}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
