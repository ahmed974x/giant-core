# Physics signals backtest / نتائج اختبار مؤشرات "الفيزياء"

Paper experiment only (ADR-065). Reproduce: `pip install -r physics_lab/requirements.txt && python -m physics_lab.backtest`.
Raw numbers: `metrics.json`; every daily signal value: `signals_<asset>.csv.gz`.

## Question / السؤال
Do Hurst, Lyapunov-style divergence and a Reynolds-style ratio warn of crises better than
plain 20-day volatility (and VIX for the S&P 500)?

Target: worst 10% of forward 20-trading-day drawdowns per asset. Score: ROC AUC (0.5 = coin flip),
95% CI from a 63-day block bootstrap. Signals at day t use data up to t only.

## Skill (AUC, higher = better warning) / القدرة على التحذير

| Asset | Period | Hurst | Lyapunov | Reynolds* | 20d vol (baseline) | VIX (baseline) |
|---|---|---|---|---|---|---|
| S&P 500 | 2000-2018 | 0.466 [0.36, 0.57] | 0.494 [0.37, 0.63] | 0.502 [0.43, 0.56] | **0.731** [0.64, 0.82] | **0.743** [0.66, 0.82] |
| WTI oil | 1987-2026 | 0.452 [0.39, 0.52] | 0.510 [0.44, 0.58] | 0.528 [0.47, 0.58] | **0.691** [0.61, 0.75] | n/a |
| Bitcoin | 2011-2026 | 0.556 [0.46, 0.63] | 0.444 [0.32, 0.56] | 0.633 [0.54, 0.72] | **0.687** [0.60, 0.75] | n/a |

Every CI for Hurst and Lyapunov contains 0.5: no measurable skill. Reynolds* is above 0.5 only on
Bitcoin, and still below plain volatility.

## The spec's thresholds, tested as written / العتبات المزعومة

| Claim | S&P 500 | WTI | Bitcoin |
|---|---|---|---|
| Reynolds* > 2000 ("transition") | 0 days | 0 days | 0 days |
| Reynolds* > 4000 ("crisis") | 0 days | 0 days | 0 days |
| Highest Reynolds* ever observed | 17.4 | 21.4 | 1578 |
| Lyapunov > 0 ("chaos") | 100% of days | 100% | 100% |
| Lyapunov above shuffled-noise 97.5% | 0 days | 3 days | 0 days |
| Hurst > 0.6 ("bubble"): stress rate vs 10% base | 5.7% (35 days) | 11.3% (212 days) | 14.1% (482 days) |
| Hurst above shuffled-noise 97.5% | 0% of days | 0% | 1.1% |

- 2000/4000 are pipe-flow numbers. Re* here is |drift t-stat| x sqrt(20) x volume ratio, so its scale
  is arbitrary; the thresholds are never reached and cannot be transplanted.
- Shuffled returns (pure noise) already give Lyapunov 0.24-0.31 on 252-day windows, so "λ > 0 = chaos"
  is true every single day and carries no information.
- Rolling 252-day Hurst is above the noise band on 0-1.1% of days (shuffled noise alone spans ~0.35-0.68).

## Crisis events (value on the last close before the event, percentile vs. history up to then)

| Event | Hurst | Lyapunov | Reynolds* | 20d vol | VIX |
|---|---|---|---|---|---|
| S&P 2008-09-15 Lehman | 0.416 (p32) | 0.266 (p88) | 2.60 (p43) | 23.4% (p84) | 25.7 |
| S&P 2011-08-08 US downgrade | 0.531 (p92) | 0.242 (p27) | 8.67 (p95) | 22.9% (p78) | 32.0 |
| S&P 2018-02-05 Volmageddon | 0.481 (p72) | 0.267 (p94) | 2.00 (p32) | 12.1% (p40) | 17.3 |
| WTI 2008-07-14 crash start | 0.489 (p80) | 0.252 (p39) | 2.64 (p45) | 34.4% (p51) | |
| WTI 2014-11-28 OPEC | 0.483 (p71) | 0.259 (p60) | 6.79 (p88) | 25.6% (p31) | |
| WTI 2020-03-09 price war/COVID | 0.517 (p80) | 0.248 (p36) | 6.52 (p85) | 52.0% (p85) | |
| WTI 2020-04-20 below zero | 0.565 (p92) | 0.241 (p21) | 2.13 (p35) | 234% (p100) | |
| BTC 2020-03-12 Black Thursday | 0.512 (p54) | 0.242 (p25) | 9.44 (p65) | 49.8% (p44) | |
| BTC 2022-05-09 Terra/LUNA | 0.507 (p50) | 0.256 (p57) | 4.70 (p45) | 49.7% (p42) | |
| BTC 2022-11-08 FTX | 0.562 (p78) | 0.265 (p73) | 4.07 (p40) | 31.1% (p17) | |

No signal flags all ten. Hurst was at or above p90 before 2 of 10 events, Lyapunov before 1, Reynolds* before 1.
Event days are anecdotes; the AUC table above is the evidence.

## Verdict / الحكم
On free daily data, none of the three physics-style signals beats 20-day volatility, and the
spec's fixed thresholds (Re 2000/4000, H 0.6, λ 0) are either never triggered or always triggered.
Reynolds* on Bitcoin (AUC 0.63) is the only result worth a second look, and it is mostly the
volume ratio; it still loses to plain volatility.

## Data sources / مصادر البيانات
- S&P 500 daily: `arch` package `arch.data.sp500` (Yahoo ^GSPC), 1999-2018 only (no free 2020 S&P daily reachable from the build box).
- WTI daily: github.com/datasets/oil-prices (EIA RWTC). 1 non-positive day (2020-04-20, -37.63) dropped for log returns.
- Bitcoin daily: github.com/coinmetrics/data (PriceUSD, volume_reported_spot_usd_1d), CC BY-NC 4.0.
- VIX daily: github.com/datasets/finance-vix (CBOE).
SHA-256 of each downloaded file is in `metrics.json` -> `sources`.

## Limits
Daily closes only (no order book, so no real liquidity density or spread). One window length per
signal (252 / 20 days), chosen before running, not tuned. Overlapping 20-day targets inflate
naive significance; that is why the CIs use block bootstrap.

## Follow-up: Bitcoin Reynolds* 2023-2026 / اختبار أخير
Stress cutoff from pre-2023 data (-24.8%). 1,219 days, 14 stress days.
Re* AUC 0.329 [0.269, 0.452]; without volume 0.383 [0.321, 0.510]; 20d vol 0.284 [0.175, 0.459].
Pass rule (CI above 0.5 and beats volatility) failed. File closed; see ADR-065 addendum.
