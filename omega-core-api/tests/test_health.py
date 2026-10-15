"""Health endpoint tests against real local HTTP servers (no mocks of httpx)."""

from __future__ import annotations

import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient

import app.main as main


def _server(status: int, body: bytes, delay: float = 0.0):
    class H(BaseHTTPRequestHandler):
        def do_GET(self):
            if delay:
                threading.Event().wait(delay)
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}"


def _dead_url() -> str:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return f"http://127.0.0.1:{port}/x"


@pytest.fixture
def client():
    return TestClient(main.app, base_url="http://127.0.0.1")


def _set(monkeypatch, n8n, newton, timeout=1.0):
    monkeypatch.setattr(main, "N8N_HEALTH", n8n)
    monkeypatch.setattr(main, "NEWTON_HEALTH", newton)
    monkeypatch.setattr(main, "PROBE_TIMEOUT_S", timeout)


def test_both_online_opens_gate(client, monkeypatch):
    n8n, u1 = _server(200, b'{"status":"ok"}')
    nw, u2 = _server(200, json.dumps({"ok": True, "tools": ["calc", "solve", 7, "x" * 99]}).encode())
    _set(monkeypatch, u1 + "/healthz", u2 + "/api/health")
    r = client.get("/api/v1/health/services")
    assert r.status_code == 200
    d = r.json()
    assert d["newton_gate"] == "open"
    assert d["services"]["n8n"]["status"] == "online"
    assert d["services"]["newton"]["status"] == "online"
    assert d["services"]["newton"]["tools"] == ["calc", "solve"]  # non-strings and oversized names dropped
    n8n.shutdown(); nw.shutdown()


def test_both_down_is_isolated(client, monkeypatch):
    _set(monkeypatch, _dead_url(), _dead_url())
    d = client.get("/api/v1/health/services").json()
    assert d["newton_gate"] == "closed"
    assert (d["services"]["n8n"]["status"], d["services"]["n8n"]["reason"]) == ("offline", "unreachable")
    assert d["services"]["newton"]["status"] == "offline"


def test_newton_truthy_but_not_true_keeps_gate_closed(client, monkeypatch):
    nw, u = _server(200, b'{"ok":"true"}')
    _set(monkeypatch, _dead_url(), u)
    d = client.get("/api/v1/health/services").json()
    assert d["newton_gate"] == "closed"
    assert (d["services"]["newton"]["status"], d["services"]["newton"]["reason"]) == ("degraded", "not_ok")
    nw.shutdown()


def test_http_error_and_bad_json(client, monkeypatch):
    a, u1 = _server(500, b"boom")
    b, u2 = _server(200, b"<html>not json</html>")
    _set(monkeypatch, u1, u2)
    d = client.get("/api/v1/health/services").json()
    assert d["services"]["n8n"]["reason"] == "http_500"
    assert d["services"]["newton"]["status"] == "degraded"
    assert "boom" not in json.dumps(d) and "html" not in json.dumps(d)  # upstream bodies never echoed
    a.shutdown(); b.shutdown()


def test_timeout_does_not_block_other_service(client, monkeypatch):
    slow, u1 = _server(200, b'{"status":"ok"}', delay=2.0)
    nw, u2 = _server(200, b'{"ok":true,"tools":[]}')
    _set(monkeypatch, u1, u2, timeout=0.5)
    d = client.get("/api/v1/health/services").json()
    assert d["services"]["n8n"]["reason"] == "timeout"
    assert d["newton_gate"] == "open"
    slow.shutdown(); nw.shutdown()


def test_foreign_host_rejected(monkeypatch):
    c = TestClient(main.app, base_url="http://evil.example")
    assert c.get("/api/v1/health").status_code == 400


def test_cors_only_for_allowed_origin(client):
    ok = client.get("/api/v1/health", headers={"Origin": "http://127.0.0.1:8787"})
    assert ok.headers.get("access-control-allow-origin") == "http://127.0.0.1:8787"
    bad = client.get("/api/v1/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in bad.headers


def test_no_write_methods(client):
    assert client.post("/api/v1/health/services").status_code == 405


def test_ops_room_served_same_origin(client):
    r = client.get("/ops/omega-ops-room.html")
    assert r.status_code == 200 and "OMEGA OPS ROOM" in r.text
