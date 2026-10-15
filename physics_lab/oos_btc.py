"""Follow-up test (ADR-065 addendum): Reynolds* on Bitcoin, 2023-01-01 to end of data.

Run after backtest.py:  python -m physics_lab.oos_btc
Reads results/signals_btc.csv.gz, writes results/oos_btc_2023_2026.json.

Pass rule, fixed before running: Reynolds* counts as a secondary signal only if
(a) its AUC CI lower bound is above 0.5 AND (b) its AUC beats 20-day volatility.
The stress cutoff (worst 10% forward 20-day drawdown) is taken from pre-2023 data
only, so nothing from the test period sets the bar.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from .backtest import RESULTS, STRESS_Q, auc, block_bootstrap_ci

START = "2023-01-01"


def main() -> None:
    sig = pd.read_csv(RESULTS / "signals_btc.csv.gz", index_col=0, parse_dates=True)
    sig = sig.dropna(subset=["fwd_dd", "reynolds", "reynolds_novol", "vol20"])
    cut = float(sig.loc[:START, "fwd_dd"].iloc[:-1].quantile(STRESS_Q))
    test = sig.loc[START:]
    label = (test["fwd_dd"] <= cut).to_numpy()
    res = {"period": [str(test.index[0].date()), str(test.index[-1].date())], "days": int(len(test)),
           "stress_cutoff_from_pre2023": round(cut, 4), "stress_days": int(label.sum()), "auc": {}}
    for k in ["reynolds", "reynolds_novol", "vol20"]:
        s = test[k].to_numpy()
        lo, hi = block_bootstrap_ci(s, label)
        res["auc"][k] = {"auc": round(auc(s, label), 3), "ci95": [round(lo, 3), round(hi, 3)]}
    re = res["auc"]["reynolds"]
    res["passes"] = bool(re["ci95"][0] > 0.5 and re["auc"] > res["auc"]["vol20"]["auc"])
    res["reynolds_max"] = round(float(test["reynolds"].max()), 2)
    res["days_reynolds_gt_2000"] = int((test["reynolds"] > 2000).sum())
    (RESULTS / "oos_btc_2023_2026.json").write_text(json.dumps(res, indent=2))
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
