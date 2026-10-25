"""OMEGA tools HTTP API (ADR-129), loopback only.

Run:  python -m omega_tools.http_api   ->  http://127.0.0.1:8097/api/health  and  POST /api/<tool>
Every tool is off until its name is in OMEGA_TOOLS, e.g. OMEGA_TOOLS=oxigraph,skyfield,portfolio
"""

from __future__ import annotations

import ipaddress
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import docs, kg, rag, risk, space
from .flags import ToolMissing, ToolOff, status

TOOLS = {
    "kg_query": kg.kg_query,
    "sat_track": space.sat_track,
    "min_volatility": risk.min_volatility,
    "doc_markdown": docs.to_markdown,
    "rag_insert": rag.rag_insert,
    "rag_query": rag.rag_query,
}
MAX_BODY = 4 * 1024 * 1024
# Like Newton (ADR-125): the Ops Room may read GET /api/health from these pages; tool calls get no CORS header.
HEALTH_ORIGINS = {"http://127.0.0.1:8796", "http://localhost:8796", "https://ahmed974x.github.io", "null"}


class Handler(BaseHTTPRequestHandler):
    server_version = "omega-tools/1.0"

    def _send(self, code: int, obj: dict, cors: bool = False) -> None:
        body = json.dumps(obj, ensure_ascii=False, default=str).encode()
        self.send_response(code)
        origin = self.headers.get("Origin", "")
        if cors and origin in HEALTH_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/api/health":
            return self._send(200, {"ok": True, "tools": status(), "routes": sorted(TOOLS), "paper_only": True}, cors=True)
        self._send(404, {"error": "not found"})

    def do_POST(self) -> None:
        name = self.path.removeprefix("/api/")
        fn = TOOLS.get(name)
        if not fn:
            return self._send(404, {"error": "unknown tool"})
        if self.headers.get("Origin"):
            return self._send(403, {"ok": False, "error": "tool calls come from this machine's scripts, not from a web page"})
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            return self._send(413, {"error": "body too large"})
        try:
            args = json.loads(self.rfile.read(n) or b"{}")
            if not isinstance(args, dict):
                raise ValueError("body must be a JSON object")
            self._send(200, {"ok": True, "tool": name, "result": fn(**args)})
        except ToolOff as e:
            self._send(403, {"ok": False, "tool": name, "error": str(e)})
        except ToolMissing as e:
            self._send(503, {"ok": False, "tool": name, "error": str(e)})
        except Exception as e:  # report the reason to the caller
            self._send(400, {"ok": False, "tool": name, "error": f"{type(e).__name__}: {e}"})

    def log_message(self, fmt, *args):  # quiet
        pass


def bind_host() -> str:
    host = os.environ.get("OMEGA_TOOLS_HOST", "127.0.0.1")
    if host != "localhost" and not ipaddress.ip_address(host).is_loopback:
        raise SystemExit("OMEGA tools bind to a loopback address only (AGENTS.md §4)")
    return host


def main() -> None:
    host, port = bind_host(), int(os.environ.get("OMEGA_TOOLS_PORT", "8097"))
    print(f"OMEGA tools on http://{host}:{port}  on: {sorted(k for k, v in status().items() if v['on']) or 'none'}")
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
