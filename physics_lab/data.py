"""Free/open historical data loaders. Each returns (DataFrame, source dict).

Sources (all keyless):
- S&P 500 daily 1999-2018: bundled with the `arch` package (arch.data.sp500,
  originally Yahoo Finance), NCSA licence.
- WTI crude daily 1986-: github.com/datasets/oil-prices (US EIA series RWTC), PDDL.
- Bitcoin daily 2010-: github.com/coinmetrics/data (Coin Metrics Community),
  CC BY-NC 4.0 (personal, non-commercial research only).
- VIX daily 1990-: github.com/datasets/finance-vix (CBOE), used only as a
  benchmark for S&P 500 stress.
Downloads are cached in physics_lab/data_cache/ (git-ignored) and their SHA-256
is written into the results so a run can be re-checked byte for byte.
"""
from __future__ import annotations

import hashlib
import io
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

CACHE = Path(__file__).parent / "data_cache"

URLS = {
    "wti": "https://raw.githubusercontent.com/datasets/oil-prices/main/data/wti-daily.csv",
    "btc": "https://raw.githubusercontent.com/coinmetrics/data/master/csv/btc.csv",
    "vix": "https://raw.githubusercontent.com/datasets/finance-vix/main/data/vix-daily.csv",
}


def _fetch(name: str) -> tuple[bytes, dict]:
    CACHE.mkdir(exist_ok=True)
    path = CACHE / f"{name}.csv"
    if not path.exists():
        with urllib.request.urlopen(URLS[name], timeout=60) as r:
            path.write_bytes(r.read())
    raw = path.read_bytes()
    return raw, {"url": URLS[name], "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}


def load_sp500() -> tuple[pd.DataFrame, dict]:
    from arch.data import sp500
    import arch

    d = sp500.load()
    df = pd.DataFrame({"price": d["Adj Close"], "volume": d["Volume"].astype(float)})
    df.index = pd.to_datetime(df.index)
    return df, {"url": "pip package arch, arch.data.sp500 (Yahoo Finance ^GSPC)",
                "version": arch.__version__}


def load_wti() -> tuple[pd.DataFrame, dict]:
    raw, src = _fetch("wti")
    d = pd.read_csv(io.BytesIO(raw), parse_dates=["Date"]).set_index("Date")
    df = pd.DataFrame({"price": d["Price"].astype(float)})
    # WTI settled at -37.63 USD on 2020-04-20; log returns need positive prices,
    # so non-positive days are dropped and counted in the source record.
    src["dropped_nonpositive_days"] = int((df["price"] <= 0).sum())
    df = df[df["price"] > 0]
    df["volume"] = np.nan
    return df, src


def load_btc() -> tuple[pd.DataFrame, dict]:
    raw, src = _fetch("btc")
    d = pd.read_csv(io.BytesIO(raw), usecols=["time", "PriceUSD", "volume_reported_spot_usd_1d"],
                    parse_dates=["time"]).set_index("time")
    d = d.dropna(subset=["PriceUSD"])
    df = pd.DataFrame({"price": d["PriceUSD"].astype(float),
                       "volume": d["volume_reported_spot_usd_1d"].astype(float)})
    return df[df["price"] > 0], src


def load_vix() -> tuple[pd.Series, dict]:
    raw, src = _fetch("vix")
    d = pd.read_csv(io.BytesIO(raw), parse_dates=["DATE"]).set_index("DATE")
    return d["CLOSE"].astype(float), src


LOADERS = {"sp500": load_sp500, "wti": load_wti, "btc": load_btc}
