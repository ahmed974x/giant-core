# ADR-065: Physics-style market signals as a paper experiment

- Status: Accepted (experiment delivered; nothing wired into NABD)
- Date: 2026-10-15
- Decider: Ahmad (chose "paper experiment only" on 2026-10-15)

## Context
The NABD "Physics Intelligence Layer" proposal claims markets obey a Navier-Stokes analogue and
that Reynolds > 4000, Hurst > 0.6 and Lyapunov > 0 flag crises. It cites an OpenAI Navier-Stokes
proof (September 2026) and a Lean theorem. That proof is not independently reviewed and has no
Clay award, so it is not used as a premise; the proposed Lean theorem ends in `sorry` and proves
nothing, so no Lean component is built.

## Decision
Build `physics_lab/` as a standalone research package that:
1. Implements Hurst (DFA-1, plus R/S for comparison), Rosenstein largest-Lyapunov-style divergence,
   and a Reynolds-style ratio Re* = rho*|v|*L/mu, each validated on known answers
   (white noise H=0.5, fGn H=0.3/0.7, logistic map lambda=ln 2, sine lambda=0).
2. Backtests them on free daily data (S&P 500 1999-2018, WTI 1986-2026, Bitcoin 2010-2026) around
   2008, March 2020 and the 2022 crypto collapse, against baselines (20-day volatility, VIX).
3. Tests the spec's thresholds as written instead of assuming them.
No trading, order execution, money movement, Director 00 wiring, or outbound messages.

## Result (full numbers in physics_lab/results/REPORT.md)
- AUC for the worst 10% forward 20-day drawdowns: Hurst 0.45-0.56, Lyapunov 0.44-0.51,
  Reynolds* 0.50-0.63; 20-day volatility 0.69-0.73, VIX 0.74.
- Re* never exceeded 2000 on any asset (max 17 / 21 / 1578). lambda > 0 on 100% of days, and pure
  shuffled noise gives the same lambda. Rolling Hurst is above the shuffled-noise 97.5% band on only 0-1.1% of days.

## Consequences
- The physics layer is not promoted to a live signal, Director 00 rule, or screen.
- If revisited, start from Re* on Bitcoin (only above-chance result) and require it to beat
  volatility out of sample before any further phase.
- Data: Coin Metrics community data is CC BY-NC 4.0, so these results are for personal research only.
