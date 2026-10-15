"""Newton HTTP API for the OMEGA site (loopback only by default).

Run:  python -m newton.http_api     ->  http://127.0.0.1:8095/  (page)  and  POST /api/<tool>
"""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import mcp_server as m

TOOLS = {
    "calc": m.newton_calc, "solve": m.newton_solve, "kinematics": m.newton_kinematics,
    "distance": m.newton_distance, "ship_eta": m.newton_ship_eta, "road_eta": m.newton_road_eta,
}
UI = Path(__file__).with_name("ui") / "index.html"
MAX_BODY = 16_384


class Handler(BaseHTTPRequestHandler):
    server_version = "omega-newton/1.0"

    def _send(self, code: int, body: bytes, ctype: str = "application/json") -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path in ("/", "/index.html"):
            self._send(200, UI.read_bytes(), "text/html; charset=utf-8")
        elif self.path == "/api/health":
            self._send(200, json.dumps({"ok": True, "tools": sorted(TOOLS)}).encode())
        else:
            self._send(404, b'{"error":"not found"}')

    def do_POST(self) -> None:  # noqa: N802
        name = self.path.removeprefix("/api/")
        fn = TOOLS.get(name)
        if not fn:
            return self._send(404, b'{"error":"unknown tool"}')
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            return self._send(413, b'{"error":"body too large"}')
        try:
            args = json.loads(self.rfile.read(n) or b"{}")
            if not isinstance(args, dict):
                raise ValueError("body must be a JSON object")
            result = fn(**args)
            self._send(200, json.dumps({"ok": True, "tool": name, "result": result}, ensure_ascii=False, default=str).encode())
        except Exception as e:  # report the reason; the page shows it
            self._send(400, json.dumps({"ok": False, "tool": name, "error": f"{type(e).__name__}: {e}"}, ensure_ascii=False).encode())

    def log_message(self, fmt, *args):  # quiet
        pass


def main() -> None:
    host = os.environ.get("NEWTON_HOST", "127.0.0.1")
    port = int(os.environ.get("NEWTON_PORT", "8095"))
    print(f"Newton on http://{host}:{port}/")
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
