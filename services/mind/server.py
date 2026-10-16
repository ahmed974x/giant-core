"""The second brain's HTTP API, reached only through the relay (same-origin, rate-limited). ADR-081.

It listens on the internal network only (no published port). Every route is a thin call into service.py.
"""

from __future__ import annotations

import json
import logging
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import service
import store

MAX_BODY = 40_000
PORT = int(os.environ.get("MIND_PORT", "8097"))
EVIDENCE_PATH = re.compile(r"^/evidence/(\d{1,12})$")
log = logging.getLogger("mind")


class Handler(BaseHTTPRequestHandler):
    server_version = "omega-mind"

    def log_message(self, fmt, *args):  # quiet: the owner's words never reach the log
        log.info("%s %s", self.command, self.path.split("?")[0])

    def _send(self, code: int, body) -> None:
        raw = json.dumps(body, ensure_ascii=False, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _body(self) -> dict | None:
        try:
            n = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None
        if n <= 0 or n > MAX_BODY:
            return None
        try:
            data = json.loads(self.rfile.read(n))
        except json.JSONDecodeError:
            return None
        return data if isinstance(data, dict) else None

    def _with_db(self, fn):
        db = None
        try:
            db = store.connect()
            return fn(db)
        except Exception:  # the message is generic: database errors can echo parts of the owner's text
            log.exception("brain operation failed")
            return None
        finally:
            if db is not None:
                db.close()

    def do_GET(self):  # noqa: N802 - http.server naming
        path = self.path.split("?")[0]
        if path == "/healthz":
            return self._send(200, {"status": "ok"})
        if path == "/graph":
            out = self._with_db(service.graph_view)
            return self._send(200, out) if out is not None else self._send(503, {"error": "brain unavailable"})
        if path == "/digest":
            out = self._with_db(service.digest)
            return self._send(200, out) if out is not None else self._send(503, {"error": "brain unavailable"})
        m = EVIDENCE_PATH.match(path)
        if m:
            out = self._with_db(lambda db: store.evidence(db, int(m.group(1))))
            return self._send(200, out) if out else self._send(404, {"error": "not found"})
        return self._send(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        body = self._body()
        if body is None:
            return self._send(400, {"error": "invalid json body"})
        path = self.path.split("?")[0]
        if path == "/capture":
            text = body.get("text")
            if not isinstance(text, str) or not 1 <= len(text.strip()) <= 20000:
                return self._send(400, {"error": "text must be 1-20000 characters"})
            source = body.get("source", "text")
            url = body.get("source_url")
            if source not in ("text", "voice", "link", "file", "screenshot") or (url is not None and not str(url).startswith(("http://", "https://"))):
                return self._send(400, {"error": "invalid source"})
            out = self._with_db(lambda db: service.capture(db, text.strip(), source, url))
        elif path == "/dump":
            text = body.get("text")
            if not isinstance(text, str) or not 1 <= len(text.strip()) <= 20000:
                return self._send(400, {"error": "text must be 1-20000 characters"})
            out = self._with_db(lambda db: service.dump(db, text.strip()))
        elif path == "/decide":
            edge, decision = body.get("edge"), body.get("decision")
            if not isinstance(edge, int) or decision not in ("accepted", "rejected"):
                return self._send(400, {"error": "invalid decision"})
            out = self._with_db(lambda db: (store.decide(db, edge, decision), {"ok": True})[1])
        elif path == "/search":
            q = body.get("query")
            if not isinstance(q, str) or not 1 <= len(q) <= 300:
                return self._send(400, {"error": "query must be 1-300 characters"})
            out = self._with_db(lambda db: store.search(db, q, service._embedder().embed(q), k=20))
        elif path == "/think":
            q = body.get("question")
            if not isinstance(q, str) or not 1 <= len(q) <= 1000:
                return self._send(400, {"error": "question must be 1-1000 characters"})
            out = self._with_db(lambda db: service.think(db, q))
        else:
            return self._send(404, {"error": "not found"})
        if out is None:
            return self._send(503, {"error": "brain unavailable or refused"})
        return self._send(200, out)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)  # internal network only: no published port in compose
    log.info("the second brain listens on :%s", PORT)
    srv.serve_forever()


if __name__ == "__main__":
    main()
