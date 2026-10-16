"""The brain loop's HTTP API, reached only through the relay (same-origin, rate-limited). Internal network only.

POST /run {question}      run the loop once and return the report (answers only)
GET  /runs/<uuid>         the last checkpoint of a run (where it stopped, what it had)
"""

from __future__ import annotations

import json
import logging
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import engine
import models
import sources
import store

PORT = int(os.environ.get("LOOP_PORT", "8098"))
MAX_BODY = 8192
RUN_PATH = re.compile(r"^/runs/([0-9a-f-]{36})$")
log = logging.getLogger("loop")


def budget() -> engine.Budget:
    return engine.Budget(int(os.environ.get("LOOP_MAX_STEPS", "12")), int(os.environ.get("LOOP_MAX_TOKENS", "6000")),
                         int(os.environ.get("LOOP_MAX_ROUNDS", "2")))


class Handler(BaseHTTPRequestHandler):
    server_version = "omega-loop"

    def log_message(self, fmt, *args):  # the question never reaches the log
        log.info("%s %s", self.command, self.path.split("?")[0])

    def _send(self, code: int, body) -> None:
        raw = json.dumps(body, ensure_ascii=False, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _with_db(self, fn):
        db = None
        try:
            db = store.connect()
            return fn(store.DBStore(db))
        except Exception:  # generic message: database errors can echo parts of the question
            log.exception("loop operation failed")
            return None
        finally:
            if db is not None:
                db.close()

    def do_GET(self):  # noqa: N802
        path = self.path.split("?")[0]
        if path == "/healthz":
            return self._send(200, {"status": "ok"})
        m = RUN_PATH.match(path)
        if m:
            out = self._with_db(lambda s: s.resume(m.group(1)))
            return self._send(200, out) if out else self._send(404, {"error": "not found"})
        return self._send(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        if self.path.split("?")[0] != "/run":
            return self._send(404, {"error": "not found"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(n)) if 0 < n <= MAX_BODY else None
        except (ValueError, json.JSONDecodeError):
            body = None
        q = body.get("question") if isinstance(body, dict) else None
        if not isinstance(q, str) or not 3 <= len(q.strip()) <= 4000:
            return self._send(400, {"error": "question must be 3-4000 characters"})
        model = models.get_model()
        rep = self._with_db(lambda s: engine.run(q.strip(), store=s, sources=sources.SearxSources(), model=model, budget=budget()))
        if rep is None:
            return self._send(503, {"error": "loop unavailable"})
        return self._send(200, {"run_id": rep.run_id, "status": rep.status, "answer": rep.answer, "sources": rep.sources,
                                "gaps": rep.gaps, "rounds": rep.rounds, "steps": rep.steps, "model": model.name})


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)     # no published port in compose
    log.info("the brain loop listens on :%s", PORT)
    srv.serve_forever()


if __name__ == "__main__":
    main()
