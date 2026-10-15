"""Backtest the physics-style signals against known crisis periods.

Run:  python -m physics_lab.backtest
Writes physics_lab/results/metrics.json and physics_lab/results/REPORT.md.

Research only: no orders, no money movement, no outbound messages.

Design (fixed before looking at results):
- Every signal at day t uses returns up to and including t only.
- Target: forward 20-trading-day max drawdown from the close at t; "stress"
  = the worst 10% of those drawdowns for that asset.
- Skill = ROC AUC of the signal for stress days, in the direction the NABD
  spec claims (higher = more danger). 0.5 = no skill. 95% CI from a moving
  block bootstrap (63-day blocks) because consecutive days overlap.
- Baselines: trailing 20-day realised volatility (all assets) and VIX close
  (S&P 500 only). A physics signal is only interesting if it beats them.
- Null band: each window-based signal is recomputed on 300 windows of
  shuffled returns from the same asset; days outside that band are the only
  ones where the signal says anything beyond "noise".
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import rankdata

from . import data
from .signals import hurst_dfa, lyapunov_rosenstein, realized_vol, reynolds_style

RESULTS = Path(__file__).parent / "results"
W_LONG = 252   # window for Hurst and Lyapunov
W_SHORT = 20   # window for Reynolds-style ratio and the volatility baseline
HORIZON = 20   # forward drawdown horizon (trading days)
STRESS_Q = 0.10
SEED = 7

# Dates are public record; the "source" field says where each is documented.
EVENTS = {
    "sp500": [
        ("2008-09-15", "Lehman Brothers bankruptcy filing", "SEC/Lehman Ch.11 filing, S.D.N.Y. 08-13555"),
        ("2011-08-08", "First trading day after US AAA downgrade", "S&P Global press release 2011-08-05"),
        ("2018-02-05", "'Volmageddon' VIX spike", "CBOE VIX data, this dataset"),
    ],
    "wti": [
        ("2008-07-14", "Oil crash begins after 2008-07-11 record", "EIA RWTC series, this dataset"),
        ("2014-11-28", "OPEC declines to cut output (meeting 2014-11-27)", "OPEC 166th meeting communique"),
        ("2020-03-09", "Saudi-Russia price war + COVID crash", "EIA RWTC series, this dataset"),
        ("2020-04-20", "WTI settles below zero", "EIA RWTC series (-37.63)"),
    ],
    "btc": [
        ("2020-03-12", "COVID 'Black Thursday'", "Coin Metrics PriceUSD, this dataset"),
        ("2022-05-09", "Terra/LUNA UST de-peg", "Terraform Labs / SEC v. Terraform complaint 2023"),
        ("2022-11-08", "FTX liquidity crisis", "SEC v. Bankman-Fried complaint 2022-12-13"),
    ],
}


# ------------------------------------------------------------ computing

def rolling(series: np.ndarray, window: int, fn) -> np.ndarray:
    out = np.full(len(series), np.nan)
    for t in range(window, len(series) + 1):
        out[t - 1] = fn(series[t - window: t])
    return out


def compute_signals(df: pd.DataFrame) -> pd.DataFrame:
    r_all = np.log(df["price"]).diff()
    df = df.iloc[1:]
    r = r_all.iloc[1:].to_numpy(copy=True)
    vol = df["volume"]
    has_vol = vol.notna().mean() > 0.9
    rho = (vol.rolling(W_SHORT).mean() / vol.rolling(252, min_periods=60).median()).to_numpy() \
        if has_vol else np.ones(len(df))
    rr = r
    out = pd.DataFrame(index=df.index)
    out["ret"] = r
    out["hurst"] = rolling(rr, W_LONG, hurst_dfa)
    out["lyapunov"] = rolling(rr, W_LONG, lyapunov_rosenstein)
    re = rolling(rr, W_SHORT, reynolds_style)
    out["reynolds"] = re * np.where(np.isfinite(rho), rho, np.nan)
    out["reynolds_novol"] = re
    out["vol20"] = rolling(rr, W_SHORT, realized_vol)
    p = df["price"].to_numpy()
    fwd = np.full(len(p), np.nan)
    for t in range(len(p) - HORIZON):
        fwd[t] = p[t + 1: t + 1 + HORIZON].min() / p[t] - 1
    out["fwd_dd"] = fwd
    return out


def null_band(returns: np.ndarray, fn, window: int, n: int = 300) -> tuple[float, float]:
    rng = np.random.default_rng(SEED)
    r = returns[np.isfinite(returns)]
    vals = [fn(rng.choice(r, size=window, replace=False)) for _ in range(n)]
    return float(np.nanpercentile(vals, 2.5)), float(np.nanpercentile(vals, 97.5))


# ----------------------------------------------------------- statistics

def auc(score: np.ndarray, label: np.ndarray) -> float:
    ok = np.isfinite(score)
    s, y = score[ok], label[ok].astype(bool)
    n1, n0 = y.sum(), (~y).sum()
    if n1 == 0 or n0 == 0:
        return float("nan")
    ranks = rankdata(s)
    return float((ranks[y].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))


def block_bootstrap_ci(score, label, block=63, reps=300) -> tuple[float, float]:
    rng = np.random.default_rng(SEED)
    n = len(score)
    starts = np.arange(0, n - block)
    vals = []
    for _ in range(reps):
        idx = np.concatenate([np.arange(s, s + block) for s in rng.choice(starts, n // block)])
        vals.append(auc(score[idx], label[idx]))
    return float(np.nanpercentile(vals, 2.5)), float(np.nanpercentile(vals, 97.5))


def expanding_pct(series: pd.Series, date: pd.Timestamp) -> float:
    hist = series.loc[:date].dropna()
    if len(hist) < 30:
        return float("nan")
    return float((hist.iloc[:-1] < hist.iloc[-1]).mean() * 100)


# ----------------------------------------------------------------- run

SIGNALS = ["hurst", "lyapunov", "reynolds", "vol20"]


def evaluate(name: str, df: pd.DataFrame, sig: pd.DataFrame, vix: pd.Series | None) -> dict:
    ev = sig.dropna(subset=["fwd_dd", "hurst", "lyapunov", "reynolds", "vol20"]).copy()
    cut = ev["fwd_dd"].quantile(STRESS_Q)
    label = (ev["fwd_dd"] <= cut).to_numpy()
    res = {"rows_evaluated": int(len(ev)), "from": str(ev.index[0].date()), "to": str(ev.index[-1].date()),
           "stress_cutoff_fwd_dd": round(float(cut), 4), "base_rate": round(float(label.mean()), 4),
           "auc": {}}
    scores = {k: ev[k].to_numpy() for k in SIGNALS}
    if vix is not None:
        scores["vix"] = vix.reindex(ev.index).to_numpy()
    for k, s in scores.items():
        ok = np.isfinite(s)
        a = auc(s[ok], label[ok])
        lo, hi = block_bootstrap_ci(s[ok], label[ok])
        res["auc"][k] = {"auc": round(a, 3), "ci95": [round(lo, 3), round(hi, 3)], "n": int(ok.sum())}

    r = sig["ret"].to_numpy()
    bands = {"hurst": null_band(r, hurst_dfa, W_LONG), "lyapunov": null_band(r, lyapunov_rosenstein, W_LONG)}
    res["null_band_95"] = {k: [round(v[0], 3), round(v[1], 3)] for k, v in bands.items()}
    res["share_days_above_null"] = {k: round(float((ev[k] > bands[k][1]).mean()), 3) for k in bands}

    # Claimed thresholds from the NABD spec, tested as written.
    def cond(mask):
        m = mask.to_numpy()
        return {"days": int(m.sum()), "share_of_days": round(float(m.mean()), 4),
                "stress_rate_when_true": round(float(label[m].mean()), 4) if m.any() else None}
    res["claimed_thresholds"] = {
        "hurst>0.6": cond(ev["hurst"] > 0.6),
        "hurst<0.5": cond(ev["hurst"] < 0.5),
        "lyapunov>0": cond(ev["lyapunov"] > 0),
        "lyapunov>null97.5": cond(ev["lyapunov"] > bands["lyapunov"][1]),
        "reynolds>2000": cond(ev["reynolds"] > 2000),
        "reynolds>4000": cond(ev["reynolds"] > 4000),
    }
    res["reynolds_observed"] = {q: round(float(ev["reynolds"].quantile(p)), 3)
                                for q, p in [("p50", .5), ("p99", .99), ("max", 1.0)]}

    rows = []
    for d, label_txt, source in EVENTS[name]:
        d = pd.Timestamp(d)
        before = sig.loc[:d].iloc[:-1] if d in sig.index else sig.loc[:d]
        if len(before) < W_LONG:
            continue
        t = before.index[-1]  # last close strictly before the event day
        row = {"event": label_txt, "date": str(d.date()), "source": source, "signal_day": str(t.date())}
        for k in SIGNALS:
            row[k] = round(float(before[k].iloc[-1]), 4)
            row[k + "_pct_hist"] = round(expanding_pct(before[k], t), 1)
            row[k + "_max_pct_60d"] = round(max(expanding_pct(before[k], x) for x in before.index[-60:]), 1)
        if vix is not None and t in vix.index:
            row["vix"] = float(vix.loc[t])
        rows.append(row)
    res["events"] = rows
    return res


def main() -> None:
    RESULTS.mkdir(exist_ok=True)
    vix, vix_src = data.load_vix()
    out = {"design": {"w_long": W_LONG, "w_short": W_SHORT, "horizon": HORIZON, "stress_q": STRESS_Q,
                      "seed": SEED}, "sources": {"vix": vix_src}, "assets": {}}
    for name, loader in data.LOADERS.items():
        df, src = loader()
        out["sources"][name] = src
        sig = compute_signals(df)
        sig.round(6).to_csv(RESULTS / f"signals_{name}.csv.gz", compression="gzip")
        out["assets"][name] = evaluate(name, df, sig, vix if name == "sp500" else None)
        print(name, json.dumps(out["assets"][name]["auc"]))
    (RESULTS / "metrics.json").write_text(json.dumps(out, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
