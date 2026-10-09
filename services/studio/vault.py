"""OMEGA Vault: a DuckDB file that keeps every candle, anomaly, whale and headline the stack has served.

The live views only reach back 48 h (candles_5m) to 30 days, and TimescaleDB is a server the laptop
may not be running. DuckDB is in-process (no daemon, no RAM when idle), so the Studio can answer
long-range questions from one local file even when Docker is off.

    sync()       copy the relay's views into the vault (idempotent upserts); live data only
    history()    one row per day per pair: OHLC, realised volatility, anomalies, whale flow, news mood
    stats()      table row counts and file size

Without a live relay the vault is an in-memory database seeded with the demo data, so the real file
never holds simulated rows.
"""

from __future__ import annotations

import os
import threading
from pathlib import Path

import duckdb
import pandas as pd

import data

DEFAULT_PATH = Path(__file__).resolve().parent / "vault" / "omega.duckdb"
VAULT_PATH = Path(os.environ.get("OMEGA_VAULT_PATH", DEFAULT_PATH))

SCHEMA = """
CREATE TABLE IF NOT EXISTS candles_5m (symbol VARCHAR, ts TIMESTAMPTZ, open DOUBLE, high DOUBLE, low DOUBLE, close DOUBLE,
                                       volume DOUBLE, PRIMARY KEY (symbol, ts));
CREATE TABLE IF NOT EXISTS anomalies (id BIGINT PRIMARY KEY, ts TIMESTAMPTZ, symbol VARCHAR, kind VARCHAR, severity VARCHAR,
                                      price DOUBLE, zscore DOUBLE, reason VARCHAR);
CREATE TABLE IF NOT EXISTS whales (id BIGINT PRIMARY KEY, ts TIMESTAMPTZ, chain VARCHAR, asset VARCHAR, amount DOUBLE,
                                   usd_value DOUBLE, from_entity VARCHAR, to_entity VARCHAR, verdict VARCHAR, severity VARCHAR);
CREATE TABLE IF NOT EXISTS news (id BIGINT PRIMARY KEY, published_at TIMESTAMPTZ, source VARCHAR, title VARCHAR, url VARCHAR,
                                 symbols VARCHAR[], sentiment DOUBLE, impact VARCHAR, label VARCHAR);
"""
TABLES = {"candles_5m": data.CANDLE_COLS, "anomalies": data.ANOMALY_COLS, "whales": data.WHALE_COLS, "news": data.NEWS_COLS}

_lock = threading.Lock()
_conns: dict[str, duckdb.DuckDBPyConnection] = {}


def _connect(live: bool) -> duckdb.DuckDBPyConnection:
    key = "file" if live else "demo"
    if key not in _conns:
        if live:
            VAULT_PATH.parent.mkdir(parents=True, exist_ok=True)
            con = duckdb.connect(str(VAULT_PATH))
        else:
            con = duckdb.connect(":memory:")
        con.execute("SET TimeZone = 'UTC'")
        con.execute(SCHEMA)
        _conns[key] = con
        if not live:
            _load(con)
    return _conns[key]


def _upsert(con: duckdb.DuckDBPyConnection, table: str, df: pd.DataFrame) -> int:
    if df is None or df.empty:
        return 0
    frame = df.reindex(columns=TABLES[table]).copy()
    if table == "news":
        frame["symbols"] = frame["symbols"].map(lambda s: list(s) if isinstance(s, (list, tuple)) else [])
    con.register("incoming", frame)
    con.execute(f"INSERT OR REPLACE INTO {table} SELECT * FROM incoming")
    con.unregister("incoming")
    return len(frame)


def _load(con: duckdb.DuckDBPyConnection) -> dict[str, int]:
    n = {"candles_5m": sum(_upsert(con, "candles_5m", data.candles(s, 48)) for s in data.SYMBOLS)}
    n["anomalies"] = _upsert(con, "anomalies", data.anomalies())
    n["whales"] = _upsert(con, "whales", data.whales())
    n["news"] = _upsert(con, "news", data.news())
    return n


def connection() -> duckdb.DuckDBPyConnection:
    return _connect(data.is_live())


def is_demo() -> bool:
    return not data.is_live()


def sync() -> dict[str, int]:
    """Copy the latest live views into the vault file. No-op (empty dict) without a live relay."""
    if not data.is_live():
        return {}
    with _lock:
        return _load(_connect(True))


def stats() -> pd.DataFrame:
    with _lock:
        con = connection()
        rows = [(t, con.execute(f"SELECT count(*) FROM {t}").fetchone()[0]) for t in TABLES]
    return pd.DataFrame(rows, columns=["table", "rows"])


def file_size_mb() -> float | None:
    return round(VAULT_PATH.stat().st_size / 1e6, 2) if VAULT_PATH.exists() else None


HISTORY_SQL = """
WITH r AS (
  SELECT symbol, ts, close, high, low, open,
         ln(close / lag(close) OVER (PARTITION BY symbol ORDER BY ts)) AS ret
  FROM candles_5m WHERE symbol = $symbol
),
d AS (
  SELECT date_trunc('day', ts) AS day,
         arg_min(open, ts) AS open, max(high) AS high, min(low) AS low, arg_max(close, ts) AS close,
         stddev_samp(ret) * sqrt(288 * 365) * 100 AS vol_ann_pct,
         count(*) AS bars
  FROM r GROUP BY 1
),
a AS (SELECT date_trunc('day', ts) AS day, count(*) AS anomalies, count(*) FILTER (WHERE severity = 'high') AS high
      FROM anomalies WHERE symbol = $symbol GROUP BY 1),
w AS (SELECT date_trunc('day', ts) AS day,
             sum(usd_value) FILTER (WHERE verdict = 'to_exchange') - sum(usd_value) FILTER (WHERE verdict = 'from_exchange') AS net_into_exchanges_usd
      FROM whales GROUP BY 1),
n AS (SELECT date_trunc('day', published_at) AS day,
             sum(sentiment * CASE impact WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END)
               / sum(CASE impact WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END) AS mood
      FROM news WHERE len(symbols) = 0 OR list_contains(symbols, $base) GROUP BY 1)
SELECT d.day, d.open, d.high, d.low, d.close, round((d.close / d.open - 1) * 100, 3) AS change_pct,
       round(d.vol_ann_pct, 2) AS vol_ann_pct, d.bars,
       coalesce(a.anomalies, 0) AS anomalies, coalesce(a.high, 0) AS high_anomalies,
       w.net_into_exchanges_usd, round(n.mood, 3) AS mood
FROM d LEFT JOIN a USING (day) LEFT JOIN w USING (day) LEFT JOIN n USING (day)
ORDER BY d.day
"""


def history(symbol: str) -> pd.DataFrame:
    """Daily roll-up for one pair across everything the vault holds."""
    with _lock:
        return connection().execute(HISTORY_SQL, {"symbol": symbol, "base": symbol.removesuffix("USDT")}).df()
