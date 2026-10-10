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
