---
name: replica-timeseries-math
description: Time-series maths in the standard library - Welford running mean and variance, EWMA, online z-score anomalies, a VPIN-style flow imbalance and LTTB downsampling that keeps peaks and troughs - for telemetry, build times or any [t, v] series, as JSON or CSV. The same formulas as Jarvis's server engine. Standard-library Python only; no network, no processes.
---

# replica-timeseries-math

```bash
python3 .claude/skills/replica-timeseries-math/ts_math.py series.json --threshold 120
python3 .claude/skills/replica-timeseries-math/ts_math.py series.csv --json
python3 -m unittest discover -s .claude/skills/replica-timeseries-math/tests
```

| Formula | What it gives |
| --- | --- |
| Welford (1962): n, mean, M2 per value; variance = M2 / (n − 1) | mean and standard deviation in O(1) memory, exact |
| EWMA: e = α·x + (1 − α)·e | a smoothed level that follows recent values |
| z = (x − mean) / sd against the values before x | anomalies (\|z\| > 3 after 30 values), so a spike cannot hide itself |
| VPIN-style imbalance: tick-rule up/down ticks in equal buckets, mean \|up − down\| / size | 0 balanced, 1 one-way; borrowed from Easley, López de Prado and O'Hara (2012), so it carries `[INFERENCE]` |
| LTTB (Steinarsson, 2013) | n points cut to a drawing size, keeping the first, the last and the largest triangles, so peaks and troughs survive |

`jarvis/server/lib/timeseries.mjs` runs the same formulas inside the Jarvis server (no child process) and in the page. Keep the two in step; the tests check both against the same numbers.

## Limits

- The z-score assumes a roughly steady series. For Gaussian noise, about 0.27 % of ordinary values pass |z| > 3; that is the rule working, not a bug.
- VPIN here measures direction changes in any metric. It is not the market measure and predicts nothing.
