"""Does a crypto sell-off *cause* a move into gold? A cause-and-effect check, not a correlation.

Question: when Bitcoin drops more than a threshold in one hour (the "treatment"), does tokenized gold (PAXG) return
more in the *next* hour (the "outcome") than it otherwise would?

Method (the same steps DoWhy runs, written in NumPy because DoWhy cannot load on this laptop, see requirements.txt):
  1. Model:      shock(t) -> gold_ret(t+1), with confounders that drive both: ETH return(t), BTC volatility(t-1),
                 gold's own return(t) and hour of day.
  2. Identify:   backdoor adjustment on those confounders.
  3. Estimate:   OLS of gold_ret(t+1) on [shock, confounders]; the shock coefficient is the average effect,
                 with a 95% confidence interval from robust (HC1) standard errors.
  4. Refute:     placebo treatment (shuffled shock -> effect should vanish), random common cause (adding noise
                 should not move it), and data subsets (it should hold on random 80% samples).
Only public, keyless Binance market data is used. Output: out/flight_to_safety.json and .md.

    python flight_to_safety.py                 # 1000 hourly bars, shock = BTC <= -1%
    python flight_to_safety.py --shock -0.75
"""

import argparse
import json
import time
import urllib.request
from pathlib import Path

import numpy as np

OUT = Path(__file__).with_name("out")
API = "https://data-api.binance.vision/api/v3/klines?symbol={}&interval=1h&limit=1000"


def closes(symbol: str) -> tuple[np.ndarray, np.ndarray]:
    req = urllib.request.Request(API.format(symbol), headers={"User-Agent": "omega-prime/0.1"})
    with urllib.request.urlopen(req, timeout=20) as r:
        rows = json.load(r)
    return np.array([k[0] // 1000 for k in rows]), np.array([float(k[4]) for k in rows])


def ols(y: np.ndarray, X: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Coefficients and HC1 robust standard errors."""
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    resid = y - X @ beta
    n, k = X.shape
    bread = np.linalg.pinv(X.T @ X)
    meat = (X * resid[:, None] ** 2).T @ X
    cov = bread @ meat @ bread * n / (n - k)
    return beta, np.sqrt(np.diag(cov))


def design(shock: np.ndarray, conf: np.ndarray) -> np.ndarray:
    return np.column_stack([np.ones(len(shock)), shock, conf])


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--shock", type=float, default=-1.0, help="BTC hourly return (%%) at or below which counts as a shock")
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    rng = np.random.default_rng(a.seed)

    series = {s: closes(s) for s in ("BTCUSDT", "ETHUSDT", "PAXGUSDT")}
    common = set(series["BTCUSDT"][0]) & set(series["ETHUSDT"][0]) & set(series["PAXGUSDT"][0])
    t = np.array(sorted(common))
    px = {s: dict(zip(*series[s]))for s in series}
    price = {s: np.array([px[s][x] for x in t]) for s in series}
    ret = {s: np.diff(np.log(p)) * 100 for s, p in price.items()}          # % log returns, aligned to t[1:]

    btc, eth, gold = ret["BTCUSDT"], ret["ETHUSDT"], ret["PAXGUSDT"]
    vol = np.abs(btc)
    hour = (t[1:] // 3600) % 24
    # Row i: treatment and confounders at hour i, outcome at hour i+1; volatility from hour i-1.
    idx = np.arange(1, len(btc) - 1)
    shock = (btc[idx] <= a.shock).astype(float)
    y = gold[idx + 1]
    hour_terms = np.column_stack([np.sin(2 * np.pi * hour[idx] / 24), np.cos(2 * np.pi * hour[idx] / 24)])
    conf = np.column_stack([eth[idx], vol[idx - 1], gold[idx], hour_terms])

    beta, se = ols(y, design(shock, conf))
    effect, err = beta[1], se[1]
    naive = y[shock == 1].mean() - y[shock == 0].mean() if shock.sum() else float("nan")

    placebo = [ols(y, design(rng.permutation(shock), conf))[0][1] for _ in range(200)]
    noise = [ols(y, design(shock, np.column_stack([conf, rng.normal(size=len(y))])))[0][1] for _ in range(100)]
    subsets = []
    for _ in range(100):
        m = rng.random(len(y)) < 0.8
        subsets.append(ols(y[m], design(shock[m], conf[m]))[0][1])

    p_placebo = float(np.mean(np.abs(placebo) >= abs(effect)))
    report = {
        "question": "Does a BTC sell-off hour cause a higher PAXG (gold) return in the next hour?",
        "data": {"source": "Binance public market data (keyless)", "bars": int(len(y)), "from": time.strftime("%Y-%m-%d %H:%M", time.gmtime(int(t[0]))),
                 "to": time.strftime("%Y-%m-%d %H:%M", time.gmtime(int(t[-1]))), "shock_threshold_pct": a.shock, "shock_hours": int(shock.sum())},
        "naive_difference_pct": round(float(naive), 4),
        "adjusted_effect_pct": round(float(effect), 4),
        "ci95_pct": [round(float(effect - 1.96 * err), 4), round(float(effect + 1.96 * err), 4)],
        "refuters": {
            "placebo_treatment": {"mean_effect": round(float(np.mean(placebo)), 4), "p_value": round(p_placebo, 3),
                                  "passes": p_placebo < 0.05},
            "random_common_cause": {"mean_effect": round(float(np.mean(noise)), 4),
                                    "passes": bool(abs(np.mean(noise) - effect) <= 0.1 * abs(effect) + 1e-4)},
            "data_subsets": {"mean_effect": round(float(np.mean(subsets)), 4), "same_sign_share": round(float(np.mean(np.sign(subsets) == np.sign(effect))), 2),
                             "passes": bool(np.mean(np.sign(subsets) == np.sign(effect)) >= 0.9)},
        },
    }
    significant = report["ci95_pct"][0] > 0 or report["ci95_pct"][1] < 0
    robust = all(r["passes"] for r in report["refuters"].values())
    report["verdict"] = ("causal effect supported" if significant and robust else
                         "no reliable causal effect" if not significant else "effect found but fragile")
    report["note"] = "Observational data: the result is only as good as the confounders listed. Treat as evidence, not proof."

    OUT.mkdir(exist_ok=True)
    (OUT / "flight_to_safety.json").write_text(json.dumps(report, indent=2))
    md = [f"# Flight to safety: BTC sell-off -> gold next hour", "",
          f"**Verdict:** {report['verdict']}", "",
          f"- Data: {report['data']['bars']} hourly bars, {report['data']['from']} to {report['data']['to']} UTC; "
          f"{report['data']['shock_hours']} shock hours (BTC <= {a.shock}%)",
          f"- Naive difference: {report['naive_difference_pct']:+.4f}%",
          f"- Adjusted effect: {report['adjusted_effect_pct']:+.4f}% (95% CI {report['ci95_pct'][0]:+.4f} to {report['ci95_pct'][1]:+.4f})",
          f"- Placebo p-value: {report['refuters']['placebo_treatment']['p_value']}",
          f"- Random common cause: {'pass' if report['refuters']['random_common_cause']['passes'] else 'fail'}",
          f"- Subsets same sign: {report['refuters']['data_subsets']['same_sign_share']:.0%}", "", f"_{report['note']}_", ""]
    (OUT / "flight_to_safety.md").write_text("\n".join(md), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
