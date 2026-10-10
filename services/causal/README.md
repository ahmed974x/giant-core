# causal: cause-and-effect checks

Answers "did X *cause* Y?" instead of "do X and Y move together?", using public data only.

| Script | Question | Data |
| --- | --- | --- |
| `flight_to_safety.py` | Does a Bitcoin sell-off hour cause a higher gold (PAXG) return the next hour? | Binance public klines, keyless |

Each run follows the DoWhy recipe: write the causal model, identify the backdoor confounders, estimate the effect
with robust OLS, then try to break it with three refuters (placebo treatment, random common cause, data subsets).
A result only counts as **causal effect supported** when the confidence interval excludes zero *and* all refuters pass.

```bash
uv venv --python 3.14 .venv
uv pip install --python .venv/Scripts/python.exe -r requirements.txt
.venv/Scripts/python.exe flight_to_safety.py            # writes out/flight_to_safety.{json,md}
```

**Why not the DoWhy package itself?** DoWhy 0.14 requires Python below 3.14, and on Python 3.12 this laptop's
Windows Application Control policy blocks pandas' compiled DLL. The policy stays as it is; the same method runs in
NumPy (about 5 MB, already allowed). On a server without that policy, swapping in `dowhy` is a drop-in change.

First result (2026-10-10, 997 hourly bars, 10 shock hours): **no reliable causal effect**. The adjusted effect was
-0.06% with a 95% interval of -0.27% to +0.14%, and the placebo test could not separate it from chance. Ten shock hours
is too few; rerun after a volatile month or with `--shock -0.75`.

## Butterfly Engine: causal back-trace

`butterfly_engine.py` takes an anomaly (gold/BTC/ETH/SOL price spike, ship deviation, port congestion, oil move) and
returns ranked root-cause chains such as *Gold <- Risk-off <- Oil <- Ship delay at Hormuz <- Strait closure*.

1. **Structure:** a small, explicit causal prior (13 nodes, 18 edges) from domain knowledge, the step CausalNex would
   learn from data. Every edge has a prior strength and can be argued with in code review.
2. **Evidence:** links between markets are tested on public Binance hourly bars (backdoor-adjusted lagged OLS plus a
   placebo refuter: supported x1.6, refuted x0.35). World drivers are checked *live* near the anomaly: open storms and
   quakes (USGS, NASA EONET) and GDELT conflict events from the web app's `/api/hazards` and `/api/events`
   (observed x1.4, not observed x0.7). Links with neither stay "prior only" and are flagged in the answer.
3. **Ranking:** chains are ranked by the geometric mean of their link scores, so a longer well-evidenced chain can beat a
   short untested one.

```bash
.venv/Scripts/python.exe butterfly_engine.py --type price_spike --asset PAXGUSDT --lat 26.57 --lon 56.25
.venv/Scripts/python.exe butterfly_engine.py --type ship_deviation --offline
.venv/Scripts/python.exe -m pytest -q        # 5 tests on synthetic data with a known cause
```

Output goes to `out/butterfly/latest.json` (and a timestamped copy); the Research screen's Causal Graph panel reads it.
Director 00 calls it as a read-only tool: ask "why did gold jump near Hormuz?" or «لماذا تأخرت السفن في هرمز؟».
DoWhy and CausalNex are not imported (their pandas build is blocked on this laptop); the method is the same in NumPy.

## Scenarios (ADR-022)

Every trace also returns five `scenarios`: the move fades, the three most probable single drivers, and a compound
shock. Each has `probability` (they sum to 1), `impact_range` (10th to 90th percentile of the move, in %),
`confidence` (0-1) and `tail_risk_flag`. They come from a NumPy Monte Carlo (20,000 runs, fixed seed) after a Bayesian
odds update per root cause: base rate 0.20, then ×3 / ×0.33 for links supported / refuted by market data, ×4 / ×0.4 for
drivers observed / not observed live nearby. The Research screen draws them as probability bars.
