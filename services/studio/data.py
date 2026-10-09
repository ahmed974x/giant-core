"""Data access for the OMEGA Studio.

Reads the read-only views the relay already exposes (``/api/<view>``, proxied to PostgREST).
When the relay is unreachable (stack down, or ``OMEGA_STUDIO_DEMO=1``) every loader returns
deterministic synthetic data with the same columns, so the Studio always renders.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
import zlib
from datetime import UTC, datetime, timedelta

import numpy as np
import pandas as pd
import panel as pn

API_URL = os.environ.get("OMEGA_API_URL", "http://relay:8080").rstrip("/")
FORCE_DEMO = os.environ.get("OMEGA_STUDIO_DEMO", "") == "1"
SYMBOLS = [s.strip() for s in os.environ.get("OMEGA_SYMBOLS", "BTCUSDT,ETHUSDT,SOLUSDT").split(",") if s.strip()]
TIMEOUT_S = 6

CANDLE_COLS = ["symbol", "ts", "open", "high", "low", "close", "volume"]
ANOMALY_COLS = ["id", "ts", "symbol", "kind", "severity", "price", "zscore", "reason"]
WHALE_COLS = ["id", "ts", "chain", "asset", "amount", "usd_value", "from_entity", "to_entity", "verdict", "severity"]
NEWS_COLS = ["id", "published_at", "source", "title", "url", "symbols", "sentiment", "impact", "label"]
LATEST_COLS = ["symbol", "ts", "close", "change_1h_pct", "change_24h_pct", "quote_volume_24h"]


def _get(view: str, **query: str) -> list[dict]:
    url = f"{API_URL}/api/{view}"
    if query:
        url += "?" + urllib.parse.urlencode(query, safe=".,:")
    if not url.startswith(("http://", "https://")):
        raise ValueError("OMEGA_API_URL must be http(s)")
    req = urllib.request.Request(url, headers={"Accept": "application/json"})  # noqa: S310 - scheme checked above
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:  # noqa: S310
        return json.loads(r.read().decode("utf-8"))


def _frame(rows: list[dict], cols: list[str], *time_cols: str) -> pd.DataFrame:
    df = pd.DataFrame(rows).reindex(columns=cols)
    for c in time_cols:
        df[c] = pd.to_datetime(df[c], utc=True, errors="coerce")
    return df


@pn.cache(ttl=30)
def is_live() -> bool:
    """True when the relay answers; checked at most every 30 s."""
    if FORCE_DEMO:
        return False
    try:
        _get("latest")
        return True
    except (urllib.error.URLError, OSError, ValueError):
        return False


# ── synthetic data (same shape as the live views) ──────────────────────────────
_BASE = {"BTCUSDT": 62_000.0, "ETHUSDT": 2_450.0, "SOLUSDT": 148.0}


def _demo_candles(symbol: str, hours: int) -> pd.DataFrame:
    rng = np.random.default_rng(zlib.crc32(symbol.encode()))
    n = hours * 12
    end = pd.Timestamp.now(tz="UTC").floor("5min")
    ts = pd.date_range(end=end, periods=n, freq="5min")
    steps = rng.normal(0, 0.0022, n) + np.sin(np.arange(n) / 40) * 0.0004
    close = _BASE.get(symbol, 100.0) * np.exp(np.cumsum(steps))
    open_ = np.r_[close[0], close[:-1]]
    spread = np.abs(rng.normal(0, 0.0015, n)) * close
    vol = np.abs(rng.normal(1, 0.35, n)) * (1e3 / max(1.0, _BASE.get(symbol, 100.0) / 1000))
    return pd.DataFrame({"symbol": symbol, "ts": ts, "open": open_, "high": np.maximum(open_, close) + spread,
                         "low": np.minimum(open_, close) - spread, "close": close, "volume": vol})


def _demo_anomalies() -> pd.DataFrame:
    now = datetime.now(UTC)
    kinds = [("price_shock", "Down 1-min move -2.1% (z=-5.4) vs 24h baseline"), ("volume_spike", "Volume x7.2 the 24h average (z=6.1)"),
             ("drawdown_1h", "-3.05% below the 1h high")]
    rows = []
    for i in range(9):
        sym = SYMBOLS[i % len(SYMBOLS)]
        kind, reason = kinds[i % 3]
        ts = now - timedelta(hours=2.7 * i + 0.4)
        price = float(_demo_candles(sym, 48).set_index("ts")["close"].asof(pd.Timestamp(ts)))
        rows.append({"id": 100 - i, "ts": ts, "symbol": sym, "kind": kind, "severity": "high" if i % 3 == 0 else "watch",
                     "price": price, "zscore": round(4.2 + (i % 4) * 0.7, 1), "reason": reason})
    return _frame(rows, ANOMALY_COLS, "ts")


def _demo_whales() -> pd.DataFrame:
    now = datetime.now(UTC)
    spec = [("eth", "USDT", None, "Binance", "to_exchange"), ("btc", "BTC", "Coinbase", None, "from_exchange"),
            ("eth", "USDC", None, None, "mint"), ("btc", "BTC", None, "Bitfinex", "to_exchange"),
            ("eth", "WETH", "Kraken", "Binance", "exchange_shuffle"), ("eth", "ETH", None, None, "unknown")]
    rows = []
    for i, (chain, asset, fe, te, verdict) in enumerate(spec * 2):
        usd = 5e7 * (1.3 + (i * 37 % 11) / 4)
        px = {"BTC": 62_000, "ETH": 2_450, "WETH": 2_450}.get(asset, 1)
        rows.append({"id": 50 - i, "ts": now - timedelta(hours=3.1 * i + 0.2), "chain": chain, "asset": asset, "amount": usd / px,
                     "usd_value": usd, "from_entity": fe, "to_entity": te, "verdict": verdict,
                     "severity": "high" if verdict in ("to_exchange", "from_exchange", "mint") else "watch"})
    return _frame(rows, WHALE_COLS, "ts")


def _demo_news() -> pd.DataFrame:
    now = datetime.now(UTC)
    items = [("CoinDesk", "Spot bitcoin ETFs log a fifth straight day of inflows", ["BTC"], 0.62, "high"),
             ("Decrypt", "Solana validators push a fix after a brief block-production stall", ["SOL"], -0.35, "medium"),
             ("Cointelegraph", "Ethereum core devs lock the date for the next network upgrade", ["ETH"], 0.38, "medium"),
             ("The Block", "Major exchange pauses withdrawals after a hot-wallet exploit", [], -0.84, "high"),
             ("CryptoSlate", "Analysts split on whether funding rates signal an overheated market", ["BTC", "ETH"], -0.08, "low"),
             ("Bitcoin Magazine", "Sovereign fund discloses a bitcoin position in its quarterly filing", ["BTC"], 0.55, "medium")]
    rows = [{"id": i + 1, "published_at": now - timedelta(minutes=35 + 95 * i), "source": s, "title": t, "url": "https://example.com/demo",
             "symbols": sy, "sentiment": v, "impact": imp, "label": "bullish" if v >= 0.2 else "bearish" if v <= -0.2 else "neutral"}
            for i, (s, t, sy, v, imp) in enumerate(items)]
    return _frame(rows, NEWS_COLS, "published_at")


# ── loaders: live view, else demo ──────────────────────────────────────────────
@pn.cache(ttl=60, max_items=12)
def candles(symbol: str, hours: int = 48) -> pd.DataFrame:
    """5-minute OHLCV for one pair over the last ``hours`` (max 48, the view's window)."""
    hours = max(1, min(48, int(hours)))
    if is_live():
        try:
            since = (datetime.now(UTC) - timedelta(hours=hours)).isoformat(timespec="seconds")
            df = _frame(_get("candles_5m", symbol=f"eq.{symbol}", ts=f"gte.{since}", order="ts.asc"), CANDLE_COLS, "ts")
            if len(df):
                return df
        except (urllib.error.URLError, OSError, ValueError):
            pass
    return _demo_candles(symbol, hours)


@pn.cache(ttl=60)
def latest() -> pd.DataFrame:
    if is_live():
        try:
            return _frame(_get("latest"), LATEST_COLS, "ts")
        except (urllib.error.URLError, OSError, ValueError):
            pass
    rows = []
    for s in SYMBOLS:
        c = _demo_candles(s, 48)
        last = c["close"].iloc[-1]
        rows.append({"symbol": s, "ts": c["ts"].iloc[-1], "close": last, "change_1h_pct": (last / c["close"].iloc[-13] - 1) * 100,
                     "change_24h_pct": (last / c["close"].iloc[-289] - 1) * 100, "quote_volume_24h": float((c["volume"] * c["close"]).tail(288).sum())})
    return _frame(rows, LATEST_COLS, "ts")


@pn.cache(ttl=60)
def anomalies(limit: int = 200) -> pd.DataFrame:
    if is_live():
        try:
            return _frame(_get("anomalies", order="ts.desc", limit=str(limit)), ANOMALY_COLS, "ts")
        except (urllib.error.URLError, OSError, ValueError):
            pass
    return _demo_anomalies()


@pn.cache(ttl=60)
def whales(limit: int = 200) -> pd.DataFrame:
    if is_live():
        try:
            return _frame(_get("whales", order="ts.desc", limit=str(limit)), WHALE_COLS, "ts")
        except (urllib.error.URLError, OSError, ValueError):
            pass
    return _demo_whales()


@pn.cache(ttl=120)
def news(limit: int = 100) -> pd.DataFrame:
    if is_live():
        try:
            return _frame(_get("news", order="published_at.desc", limit=str(limit)), NEWS_COLS, "published_at")
        except (urllib.error.URLError, OSError, ValueError):
            pass
    return _demo_news()
