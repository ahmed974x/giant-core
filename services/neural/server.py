"""OMEGA Neural service.

Every 6 h it retrains on the last 48 h of 5-minute candles (read through the relay), every minute it forecasts
each pair, and it serves the latest snapshot:
    GET /neural    {at, source, model: {...walk-forward metrics}, pairs: {SYM: {p_up_1h, vol_1h_pct, ...}}}
    GET /healthz
Without the relay (or OMEGA_NEURAL_DEMO=1) it trains and forecasts on synthetic data, marked source "demo".
"""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.request
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import model
import numpy as np
import torch

API = os.environ.get("OMEGA_API_URL", "http://relay:8080").rstrip("/")
SYMBOLS = [s.strip() for s in os.environ.get("OMEGA_SYMBOLS", "BTCUSDT,ETHUSDT,SOLUSDT").split(",") if s.strip()]
DEMO = os.environ.get("OMEGA_NEURAL_DEMO") == "1"
MODEL_PATH = os.environ.get("OMEGA_NEURAL_MODEL", "")      # e.g. /data/neural.pt to survive restarts
PORT = int(os.environ.get("PORT", "8092"))
RETRAIN_S, INFER_S = 6 * 3600, 60

state = {"net": None, "metrics": None, "trained_at": None, "source": "starting", "snapshot": {"at": None, "source": "starting", "pairs": {}}}
lock = threading.Lock()


def _closes_5m(symbol: str) -> np.ndarray:
    """The last 48 h of 5-minute closes from the relay (api.candles_5m, ~576 bars)."""
    url = f"{API}/api/candles_5m?symbol=eq.{symbol}&select=ts,close&order=ts.asc"
    if not url.startswith(("http://", "https://")):
        raise ValueError("OMEGA_API_URL must be http(s)")
    with urllib.request.urlopen(url, timeout=20) as r:  # noqa: S310 - scheme checked above
        rows = json.loads(r.read())
    return np.array([float(x["close"]) for x in rows])


def load_series() -> tuple[dict[str, np.ndarray], str]:
    if not DEMO:
        try:
            s = {sym: _closes_5m(sym) for sym in SYMBOLS}
            if all(len(v) > model.BASELINE + 100 for v in s.values()):
                return s, "live"
        except OSError:
            pass
    return {sym: model.synthetic(sym) for sym in SYMBOLS}, "demo"


def retrain() -> None:
    series, source = load_series()
    res = model.train(series)
    with lock:
        state.update(net=res.model, metrics=res.metrics, trained_at=datetime.now(UTC).isoformat(timespec="seconds"), source=source)
    if MODEL_PATH and source == "live":
        torch.save({"state_dict": res.model.state_dict(), "metrics": res.metrics, "trained_at": state["trained_at"]}, MODEL_PATH)
    print(f"trained on {source} data: {res.metrics}", flush=True)


def infer() -> None:
    series, source = load_series()
    with lock:
        net, metrics, trained_at = state["net"], state["metrics"], state["trained_at"]
    if net is None:
        return
    pairs = {sym: model.predict(net, closes) for sym, closes in series.items()}
    snap = {"at": datetime.now(UTC).isoformat(timespec="seconds"), "source": source, "horizon_min": 60,
            "model": {**metrics, "trained_at": trained_at, "trained_on": state["source"]}, "pairs": pairs,
            "note": "Research signal scored walk-forward; not trading advice."}
    with lock:
        state["snapshot"] = snap


def loop() -> None:
    last_train = 0.0
    while True:
        try:
            if time.time() - last_train > RETRAIN_S or state["net"] is None:
                retrain()
                last_train = time.time()
            infer()
        except Exception as e:                               # keep serving the last good snapshot
            print("neural loop error:", e, flush=True)
        time.sleep(INFER_S)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: dict):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/neural":
            with lock:
                return self._send(200, state["snapshot"])
        if self.path == "/healthz":
            return self._send(200, {"status": "ok", "trained_at": state["trained_at"]})
        self._send(404, {"error": "not found"})

    def log_message(self, *args):                           # quiet access log
        pass


def main() -> None:
    if MODEL_PATH and os.path.exists(MODEL_PATH):
        saved = torch.load(MODEL_PATH, weights_only=True)
        net = model.Net()
        net.load_state_dict(saved["state_dict"])
        state.update(net=net, metrics=saved["metrics"], trained_at=saved["trained_at"], source="live")
    threading.Thread(target=loop, daemon=True).start()
    print(f"omega neural listening on :{PORT} · {','.join(SYMBOLS)}{' · demo' if DEMO else ''}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()  # noqa: S104 - container-internal, reached only via the relay


if __name__ == "__main__":
    main()
