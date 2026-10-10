"""Phoenix Protocol: the self-healing watchdog for OMEGA (ADR-020).

Every run (scripts/phoenix.py, every 5 minutes):
  1. check each service            -> healthy: nothing to do (only a state change is logged)
  2. down: restart it              -> re-check after a short wait
  3. restart failed: restore it    -> data services come back from the latest Restic snapshot (the damaged file is moved
                                      aside, never deleted); stateless services (web, Caddy) have nothing to restore and
                                      are escalated instead
  4. notify the Director            -> local webhook only (DIRECTOR_NOTIFY_URL on 127.0.0.1 / localhost)
  5. log everything to phoenix_events (state changes, actions, one heartbeat per run)

Services watched: director (memory + approval ledger + checkpoints, SQLite integrity), memory_db (Postgres + pgvector
when DIRECTOR_DB_URL is set, otherwise the same SQLite check), web (http://127.0.0.1:3100/api/health), caddy (HTTPS
listener :8443), backup (latest Restic snapshot younger than PHOENIX_BACKUP_MAX_AGE_H, default 26 h).

All actions are local and reversible; nothing here reaches the internet.
"""

import json
import os
import re
import shutil
import socket
import sqlite3
import subprocess
import sys
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import risk

HERE = Path(__file__).resolve().parent
CORE = HERE.parents[1]                                   # giant-core
PROJECT = CORE.parent                                    # OMEGA_PRIME_PROJECT
DATA = Path(os.environ.get("DIRECTOR_DATA_DIR", HERE / "data"))
RESTIC = Path(os.environ.get("RESTIC_BINARY", PROJECT / "tools" / "restic" / "bin" / ("restic.exe" if os.name == "nt" else "restic")))
BACKUP_MAX_AGE_H = float(os.environ.get("PHOENIX_BACKUP_MAX_AGE_H", "26"))
WINDOWS = os.name == "nt"
DETACHED = (subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW) if WINDOWS else 0


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_env(path: Path = CORE / ".env") -> None:
    """Read RESTIC_* and DIRECTOR_* from the git-ignored .env without printing or exporting anything else."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            if k.strip().startswith(("RESTIC_", "DIRECTOR_", "PHOENIX_")) and v.strip() and "${" not in v:
                os.environ.setdefault(k.strip(), v.strip())


# ── event log ────────────────────────────────────────────────────────────────────────────────────────────
class EventLog:
    """phoenix_events in Postgres (when DIRECTOR_DB_URL is set) or in the local director.sqlite."""

    def __init__(self, sqlite_path: Path | None = None, pg_con=None):
        self.pg = pg_con
        if pg_con is None:
            sqlite_path = sqlite_path or DATA / "phoenix.sqlite"
            sqlite_path.parent.mkdir(parents=True, exist_ok=True)
            self.db = sqlite3.connect(str(sqlite_path), check_same_thread=False)
            self.db.execute("CREATE TABLE IF NOT EXISTS phoenix_events (id INTEGER PRIMARY KEY, ts TEXT NOT NULL, service TEXT NOT NULL, "
                            "action TEXT NOT NULL, result TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '')")
            self.db.commit()

    def add(self, service: str, action: str, result: str, detail: str = "") -> None:
        if self.pg is not None:
            self.pg.run("INSERT INTO phoenix_events (service, action, result, detail) VALUES (:s, :a, :r, :d)",
                        s=service, a=action, r=result, d=detail[:500])
        else:
            self.db.execute("INSERT INTO phoenix_events (ts, service, action, result, detail) VALUES (?, ?, ?, ?, ?)",
                            (_now(), service, action, result, detail[:500]))
            self.db.commit()

    def events(self, limit: int = 50) -> list[dict]:
        if self.pg is not None:
            rows = self.pg.run("SELECT ts, service, action, result, detail FROM phoenix_events ORDER BY id DESC LIMIT :n", n=limit)
        else:
            rows = self.db.execute("SELECT ts, service, action, result, detail FROM phoenix_events ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [{"ts": str(r[0]), "service": r[1], "action": r[2], "result": r[3], "detail": r[4]} for r in rows]

    def last_state(self, service: str) -> str | None:
        """Last known health of a service ('ok' or 'down'), from detect/restart/restore/recover rows."""
        for e in self.events(200):
            if e["service"] == service and e["action"] in ("detect", "restart", "restore", "recover", "backup"):
                return "ok" if e["result"] == "ok" else "down"
        return None


# ── Restic ───────────────────────────────────────────────────────────────────────────────────────────────
class Restic:
    def __init__(self, binary: Path = RESTIC, repo: str | None = None, password: str | None = None):
        self.binary, self.repo = Path(binary), repo or os.environ.get("RESTIC_REPOSITORY", "")
        self.password = password or os.environ.get("RESTIC_PASSWORD", "")

    @property
    def available(self) -> bool:
        return self.binary.exists() and bool(self.repo) and bool(self.password)

    def _run(self, *args: str, timeout: int = 300) -> subprocess.CompletedProcess:
        env = {**os.environ, "RESTIC_REPOSITORY": self.repo, "RESTIC_PASSWORD": self.password}
        return subprocess.run([str(self.binary), *args], env=env, capture_output=True, text=True, timeout=timeout,
                              creationflags=subprocess.CREATE_NO_WINDOW if WINDOWS else 0)

    def backup(self, path: Path, tag: str = "director") -> bool:
        return self._run("backup", str(path), "--tag", tag, "--exclude", "backups", "--json").returncode == 0

    def latest(self, tag: str = "director") -> dict | None:
        r = self._run("snapshots", "--tag", tag, "--latest", "1", "--json")
        if r.returncode != 0:
            return None
        snaps = json.loads(r.stdout or "[]")
        return snaps[-1] if snaps else None

    def restore_latest(self, target: Path, tag: str = "director") -> bool:
        """Restore the backed-up folder's *contents* straight into target (snapshot:subfolder syntax), so restic never
        recreates parent folders such as the user profile, whose timestamps Windows will not let it set."""
        snap = self.latest(tag)
        if not snap:
            return False
        src = snap["paths"][0]
        if re.match(r"^[A-Za-z]:\\", src):                       # C: -> /C/a/b inside the snapshot
            src = "/" + src[0] + src[2:].replace("\\", "/")
        return self._run("restore", f"{snap['short_id']}:{src}", "--target", str(target)).returncode == 0


# ── services ─────────────────────────────────────────────────────────────────────────────────────────────
@dataclass
class Service:
    name: str
    check: Callable[[], tuple[bool, str]]
    restart: Callable[[], bool] | None = None
    restore: Callable[[], bool] | None = None
    settle_s: float = 6.0                          # wait after a restart before re-checking


def _port_open(port: int, host: str = "127.0.0.1", timeout: float = 1.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _sqlite_ok(path: Path) -> tuple[bool, str]:
    if not path.exists():
        return True, f"{path.name} not created yet"
    con = None
    try:
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
        res = con.execute("PRAGMA integrity_check").fetchone()[0]
        return res == "ok", f"{path.name}: {res}"
    except sqlite3.DatabaseError as e:
        return False, f"{path.name}: {e}"
    finally:
        if con is not None:                      # always release the handle, or Windows blocks moving the file
            con.close()


def restore_data_dir(restic: Restic, data_dir: Path = DATA) -> bool:
    """Move the current data aside (kept as data/quarantine-<ts>) and bring back the newest Restic snapshot."""
    if not restic.available or not restic.latest():
        return False
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    staging = data_dir.parent / f".phoenix-restore-{stamp}"
    if not restic.restore_latest(staging):
        return False
    restored = next((p for p in staging.rglob("director.sqlite")), None)
    if restored is None:
        return False
    quarantine = data_dir / f"quarantine-{stamp}"
    quarantine.mkdir(parents=True, exist_ok=True)
    for name in ("director.sqlite", "checkpoints.sqlite"):
        if (data_dir / name).exists():
            shutil.move(str(data_dir / name), str(quarantine / name))
        if (restored.parent / name).exists():
            shutil.copy2(restored.parent / name, data_dir / name)
    shutil.rmtree(staging, ignore_errors=True)
    return True


def default_services(restic: Restic) -> list[Service]:
    def director_check():
        a, da = _sqlite_ok(DATA / "director.sqlite")
        b, db = _sqlite_ok(DATA / "checkpoints.sqlite")
        return a and b, f"{da}; {db}"

    def memory_check():
        if os.environ.get("DIRECTOR_DB_URL", "").strip() and "${" not in os.environ["DIRECTOR_DB_URL"]:
            return _port_open(5435), "Postgres + pgvector on :5435"
        return director_check()[0], "SQLite fallback (Docker off)"

    def memory_restart():
        docker = shutil.which("docker")
        if not docker:
            return False
        # Docker Desktop may not be running at all (after a reboot): start it and wait for the engine first (ADR-040).
        if subprocess.run([docker, "info"], capture_output=True, timeout=30, creationflags=subprocess.CREATE_NO_WINDOW if WINDOWS else 0).returncode != 0:
            desktop = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "DockerDesktop" / "Docker Desktop.exe"
            if WINDOWS and desktop.exists():
                subprocess.Popen([str(desktop)], creationflags=DETACHED)
                for _ in range(24):
                    time.sleep(5)
                    if subprocess.run([docker, "info"], capture_output=True, timeout=30, creationflags=subprocess.CREATE_NO_WINDOW).returncode == 0:
                        break
        r = subprocess.run([docker, "compose", "--profile", "director", "up", "-d", "memory"], cwd=CORE, capture_output=True, timeout=180,
                           creationflags=subprocess.CREATE_NO_WINDOW if WINDOWS else 0)
        return r.returncode == 0

    def web_check():
        try:
            with urllib.request.urlopen("http://127.0.0.1:3100/api/health", timeout=5) as r:
                return r.status == 200, "http://127.0.0.1:3100"
        except Exception as e:
            return False, f"web app not answering: {type(e).__name__}"

    def web_restart():
        nxt = CORE / "web" / "node_modules" / "next" / "dist" / "bin" / "next"
        if not nxt.exists() or not shutil.which("node"):
            return False
        subprocess.Popen(["node", str(nxt), "start", str(CORE / "web"), "-p", "3100", "-H", "127.0.0.1"], cwd=CORE / "web",
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=DETACHED)
        return True

    def caddy_restart():
        script = CORE / "ops" / "caddy" / "start-https.ps1"
        if not WINDOWS or not script.exists():
            return False
        return subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script)],
                              capture_output=True, timeout=60, creationflags=subprocess.CREATE_NO_WINDOW).returncode == 0

    def backup_check():
        if not restic.available:
            return False, "restic not configured (RESTIC_REPOSITORY / RESTIC_PASSWORD in .env)"
        snap = restic.latest()
        if not snap:
            return False, "no snapshot yet"
        age_h = (datetime.now(timezone.utc) - datetime.fromisoformat(snap["time"].replace("Z", "+00:00"))).total_seconds() / 3600
        return age_h < BACKUP_MAX_AGE_H, f"latest snapshot {snap['short_id']} is {age_h:.1f} h old"

    def backup_now():
        return restic.available and DATA.exists() and restic.backup(DATA)

    return [
        Service("director", director_check, restart=None, restore=lambda: restore_data_dir(restic)),
        # The SQLite fallback is the director's own file (restored there); Postgres restores go through pg_dump, not here.
        Service("memory_db", memory_check, restart=memory_restart),
        Service("web", web_check, restart=web_restart),
        Service("caddy", lambda: (_port_open(8443), "HTTPS listener :8443"), restart=caddy_restart),
        Service("backup", backup_check, restart=backup_now, settle_s=0),
    ]


# ── watchdog ─────────────────────────────────────────────────────────────────────────────────────────────
class Phoenix:
    def __init__(self, services: list[Service], log: EventLog, notify_url: str | None = None, sleep: Callable[[float], None] = time.sleep):
        self.services, self.log, self.sleep = services, log, sleep
        self.notify_url = notify_url if notify_url is not None else os.environ.get("DIRECTOR_NOTIFY_URL", "")

    def _heal(self, s: Service) -> dict:
        ok, detail = s.check()
        if ok:
            if self.log.last_state(s.name) == "down":
                self.log.add(s.name, "recover", "ok", detail)
            elif self.log.last_state(s.name) is None:
                self.log.add(s.name, "detect", "ok", detail)
            return {"service": s.name, "state": "ok", "detail": detail, "actions": []}

        actions = []
        self.log.add(s.name, "detect", "down", detail)
        action = "backup" if s.name == "backup" else "restart"
        if s.restart:
            started = False
            try:
                started = s.restart()
            except Exception as e:
                detail = f"{type(e).__name__}: {e}"
            if started and s.settle_s:
                self.sleep(s.settle_s)
            ok = False
            if started:
                ok, detail = s.check()
            self.log.add(s.name, action, "ok" if ok else "failed", detail)
            actions.append({action: "ok" if ok else "failed"})
        else:
            self.log.add(s.name, "restart", "skipped", "no process to restart")
            actions.append({"restart": "skipped"})

        if not ok and s.restore:
            restored = False
            try:
                restored = s.restore()
            except Exception as e:
                detail = f"{type(e).__name__}: {e}"
            ok = restored and s.check()[0]
            self.log.add(s.name, "restore", "ok" if ok else "failed", "restored from the latest Restic snapshot" if restored else "no usable snapshot")
            actions.append({"restore": "ok" if ok else "failed"})
        elif not ok:
            actions.append({"escalate": "needs a human"})
        return {"service": s.name, "state": "ok" if ok else "down", "detail": detail, "actions": actions}

    def _notify(self, report: dict) -> str:
        if not self.notify_url:
            self.log.add("phoenix", "notify", "skipped", "no DIRECTOR_NOTIFY_URL")
            return "skipped"
        if not risk.LOCAL.match(self.notify_url):
            self.log.add("phoenix", "notify", "skipped", "notify target is not local; Phoenix never calls out")
            return "skipped"
        try:
            req = urllib.request.Request(self.notify_url, data=json.dumps({"source": "phoenix", **report}).encode(),
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=5) as r:
                result = "ok" if 200 <= r.status < 300 else "failed"
        except Exception:
            result = "failed"
        self.log.add("phoenix", "notify", result, self.notify_url)
        return result

    def run_once(self) -> dict:
        results = [self._heal(s) for s in self.services]
        report = {"at": _now(), "healthy": all(r["state"] == "ok" for r in results), "services": results}
        acted = [r for r in results if r["actions"]]
        if acted:
            report["notified"] = self._notify({"at": report["at"], "healthy": report["healthy"], "services": acted})
        self.log.add("phoenix", "heartbeat", "ok" if report["healthy"] else "down",
                     ", ".join(f"{r['service']}={r['state']}" for r in results))
        return report

    def status(self) -> dict:
        latest: dict[str, dict] = {}
        for e in self.log.events(500):
            if e["service"] not in latest and e["action"] != "notify":
                latest[e["service"]] = e
        return {"services": {s.name: latest.get(s.name) for s in self.services}, "last_run": latest.get("phoenix"),
                "recent": self.log.events(10)}


# ── restore drill (ADR-038) ──────────────────────────────────────────────────────────────────────────────────
def restore_drill(restic: Restic, log: "EventLog", data_dir: Path = DATA, scratch: Path | None = None) -> dict:
    """Prove the backups can be restored, without touching live data: restore the newest snapshot into a scratch
    folder, run SQLite's integrity check on every restored database, compare its tables with the live ones, time it,
    log the result to phoenix_events, and delete the scratch copy."""
    started = time.monotonic()
    out: dict = {"ok": False, "snapshot": None, "age_h": None, "seconds": None, "databases": {}, "problems": [], "warnings": []}
    if not restic.available:
        out["problems"].append("restic not configured (RESTIC_REPOSITORY / RESTIC_PASSWORD in .env)")
    snap = restic.latest() if restic.available else None
    if restic.available and not snap:
        out["problems"].append("no snapshot yet")
    if snap:
        out["snapshot"] = snap.get("short_id")
        taken = datetime.fromisoformat(snap["time"].replace("Z", "+00:00"))   # restic writes local time with offset
        out["age_h"] = round((datetime.now(timezone.utc) - taken).total_seconds() / 3600, 1)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        staging = (scratch or data_dir.parent) / f".phoenix-drill-{stamp}"
        try:
            if not restic.restore_latest(staging):
                out["problems"].append("restic restore failed")
            else:
                restored = {p.name: p for p in staging.rglob("*.sqlite") if "backups" not in p.parts and "quarantine" not in str(p)}
                if "director.sqlite" not in restored:
                    out["problems"].append("director.sqlite missing from the snapshot")
                for name, path in sorted(restored.items()):
                    ok, detail = _sqlite_ok(path)
                    counts = _table_counts(path)
                    live = _table_counts(data_dir / name) if (data_dir / name).exists() else {}
                    missing = sorted(set(live) - set(counts))
                    out["databases"][name] = {"integrity": detail.split(": ", 1)[-1], "tables": counts, "missing_tables": missing}
                    if not ok:
                        out["problems"].append(f"{name}: {detail}")
                    if missing:                  # created after this snapshot: the next backup will carry them
                        out["warnings"].append(f"{name}: newer than the snapshot: {', '.join(missing)}")
        finally:
            shutil.rmtree(staging, ignore_errors=True)
    out["seconds"] = round(time.monotonic() - started, 1)
    out["ok"] = not out["problems"]
    summary = (f"snapshot {out['snapshot']} ({out['age_h']} h old) restored and verified in {out['seconds']} s"
               + (f"; {len(out['warnings'])} warning(s): " + "; ".join(out["warnings"]) if out["warnings"] else "")
               if out["ok"] else "; ".join(out["problems"]))
    log.add("backup", "restore-drill", "ok" if out["ok"] else "failed", summary)
    return out


def _table_counts(path: Path) -> dict:
    con = None
    try:
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
        names = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        return {n: con.execute(f'SELECT count(*) FROM "{n}"').fetchone()[0] for n in names}
    except sqlite3.DatabaseError:
        return {}
    finally:
        if con is not None:
            con.close()


def run_briefing() -> int:
    """The 07:00 scheduled task (ADR-037): run web/scripts/briefing.ts with no console window."""
    node = shutil.which("node") or "node"
    script = CORE / "web" / "scripts" / "briefing.ts"
    r = subprocess.run([node, "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", str(script)], cwd=str(CORE / "web"),
                       capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=300,
                       creationflags=subprocess.CREATE_NO_WINDOW if WINDOWS else 0)
    log = EventLog(DATA / "phoenix.sqlite")
    log.add("briefing", "morning", "ok" if r.returncode == 0 else "failed", (r.stdout if r.returncode == 0 else r.stderr)[-480:])
    return r.returncode


def from_env() -> Phoenix:
    load_env()
    restic = Restic()
    url = os.environ.get("DIRECTOR_DB_URL", "").strip()
    pg = None
    if url and "${" not in url:
        from memory import PgStore
        store = PgStore(url)
        store.ensure_schema()
        pg = store.con
    return Phoenix(default_services(restic), EventLog(pg_con=pg) if pg else EventLog(DATA / "phoenix.sqlite"))


def main(argv: list[str]) -> int:
    if sys.stdout is not None:                          # pythonw (the scheduled task) has no console at all
        sys.stdout.reconfigure(encoding="utf-8")
    cmd = argv[0] if argv else "run"
    if cmd == "loop":                                   # alternative to the scheduled task: python phoenix.py loop 300
        every = float(argv[1]) if len(argv) > 1 else 300
        while True:
            from_env().run_once()
            time.sleep(every)
    if cmd == "briefing":                               # the 07:00 task (ADR-037)
        load_env()
        return run_briefing()
    if cmd == "drill":                                  # weekly restore drill (ADR-038)
        load_env()
        out = restore_drill(Restic(), EventLog(DATA / "phoenix.sqlite"))
        if sys.stdout is not None:
            print(json.dumps(out, ensure_ascii=False, indent=2))
        return 0 if out["ok"] else 1
    p = from_env()
    out = p.status() if cmd == "status" else p.run_once()
    print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
