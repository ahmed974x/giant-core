"""Phoenix Protocol tests (ADR-020). Offline: fake services, a temp SQLite event log, a local webhook server, and the
real Restic binary against a throwaway repository (skipped if tools/restic is missing). PHOENIX_TEST_PG_URL runs the
event log on Postgres too."""

import json
import os
import sqlite3
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

import phoenix as px


class Flaky:
    """A fake service: down until restarted (or until restore, if restarts are configured to fail)."""

    def __init__(self, up=True, restart_works=True, restore_works=True):
        self.up, self.restart_works, self.restore_works = up, restart_works, restore_works
        self.restarts = self.restores = 0

    def check(self):
        return self.up, "fake"

    def restart(self):
        self.restarts += 1
        self.up = self.restart_works
        return True

    def restore(self):
        self.restores += 1
        self.up = self.restore_works
        return self.restore_works


@pytest.fixture
def log(tmp_path):
    url = os.environ.get("PHOENIX_TEST_PG_URL")
    if url:
        from memory import PgStore
        pg = PgStore(url); pg.ensure_schema(); pg.con.run("TRUNCATE phoenix_events")
        yield px.EventLog(pg_con=pg.con)
        pg.close()
    else:
        yield px.EventLog(tmp_path / "phoenix.sqlite")


def make(log, **fakes):
    services = [px.Service(n, f.check, restart=f.restart, restore=f.restore, settle_s=0) for n, f in fakes.items()]
    return px.Phoenix(services, log, notify_url="", sleep=lambda s: None)


def test_healthy_state_logs_only_a_heartbeat_after_the_first_run(log):
    p = make(log, web=Flaky(), caddy=Flaky())
    assert p.run_once()["healthy"]
    first = len(log.events())
    p.run_once()
    second = log.events()
    assert len(second) == first + 1 and second[0]["action"] == "heartbeat" and second[0]["result"] == "ok"


def test_single_service_down_is_restarted_and_recovers(log):
    web = Flaky(up=False)
    rep = make(log, web=web, caddy=Flaky()).run_once()
    assert web.restarts == 1 and rep["healthy"]
    acts = [(e["service"], e["action"], e["result"]) for e in reversed(log.events())]
    assert ("web", "detect", "down") in acts and ("web", "restart", "ok") in acts


def test_multiple_services_down_are_each_handled(log):
    web, caddy, backup = Flaky(up=False), Flaky(up=False), Flaky(up=False)
    rep = make(log, web=web, caddy=caddy, backup=backup).run_once()
    assert (web.restarts, caddy.restarts, backup.restarts) == (1, 1, 1) and rep["healthy"]
    assert {r["service"] for r in rep["services"] if r["actions"]} == {"web", "caddy", "backup"}
    assert any(e["action"] == "backup" and e["result"] == "ok" for e in log.events())   # backup's "restart" is a fresh backup


def test_restart_failure_falls_back_to_restore_then_escalates(log):
    data = Flaky(up=False, restart_works=False, restore_works=True)
    web = Flaky(up=False, restart_works=False)
    web.restore = None                                        # stateless: nothing to restore
    services = [px.Service("director", data.check, restart=data.restart, restore=data.restore, settle_s=0),
                px.Service("web", web.check, restart=web.restart, restore=None, settle_s=0)]
    rep = px.Phoenix(services, log, notify_url="", sleep=lambda s: None).run_once()
    by = {r["service"]: r for r in rep["services"]}
    assert by["director"]["state"] == "ok" and {"restore": "ok"} in by["director"]["actions"]
    assert by["web"]["state"] == "down" and {"escalate": "needs a human"} in by["web"]["actions"]
    assert not rep["healthy"]


@pytest.mark.skipif(not px.RESTIC.exists(), reason="tools/restic not installed")
def test_backup_restore_brings_back_a_corrupted_store(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    for name, val in (("director.sqlite", "remember me"), ("checkpoints.sqlite", "ckpt")):
        con = sqlite3.connect(data / name)
        con.execute("CREATE TABLE t (v TEXT)"); con.execute("INSERT INTO t VALUES (?)", (val,)); con.commit(); con.close()
    restic = px.Restic(repo=str(tmp_path / "repo"), password="test-only-password")
    assert restic._run("init").returncode == 0 and restic.backup(data)
    (data / "director.sqlite").write_bytes(b"this is not a database")                # simulate corruption
    assert not px._sqlite_ok(data / "director.sqlite")[0]
    assert px.restore_data_dir(restic, data)
    con = sqlite3.connect(data / "director.sqlite")
    assert con.execute("SELECT v FROM t").fetchone()[0] == "remember me"
    con.close()
    quarantined = list(data.glob("quarantine-*/director.sqlite"))
    assert quarantined and quarantined[0].read_bytes() == b"this is not a database"   # moved aside, never deleted


def test_notification_goes_to_the_local_webhook_only(log):
    got = []

    class Hook(BaseHTTPRequestHandler):
        def do_POST(self):
            got.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            self.send_response(204); self.end_headers()

        def log_message(self, *a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), Hook)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        p = make(log, web=Flaky(up=False))
        p.notify_url = f"http://127.0.0.1:{srv.server_port}/phoenix"
        rep = p.run_once()
        assert rep["notified"] == "ok" and got and got[0]["source"] == "phoenix" and got[0]["services"][0]["service"] == "web"
        p.notify_url = "https://hooks.example.org/x"                                  # never calls out
        p.services[0].check = lambda: (False, "down again")
        p.services[0].restart = lambda: False
        assert p.run_once()["notified"] == "skipped" and len(got) == 1
    finally:
        srv.shutdown()


def test_status_reports_latest_state_per_service(log):
    p = make(log, web=Flaky(up=False), caddy=Flaky())
    p.run_once()
    st = p.status()
    assert st["services"]["web"]["action"] in ("restart", "recover") and st["last_run"]["action"] == "heartbeat"


def test_runs_without_a_console_like_the_scheduled_task(monkeypatch, log):
    """pythonw (Task Scheduler) has sys.stdout = None; Phoenix must still run and log instead of crashing."""
    monkeypatch.setattr(px, "from_env", lambda: make(log, web=Flaky()))
    monkeypatch.setattr(px.sys, "stdout", None)
    assert px.main(["run"]) == 0
    assert log.events()[0]["action"] == "heartbeat"
