---
name: quant-microstructure-gex
description: Use when changing Brain 2 maths or the trading desk's readings - Kalman latent price, BOCPD regime change, Kyle's lambda, iceberg detection, book entropy, L2 VWAP fill, dealer gamma (GEX), DVOL, 25-delta risk reversal, funding and basis. Paper only, decision aids.
---

# Microstructure and options maths for the paper desk

Paper only (ADR-091, ADR-092, ADR-108). No code path signs or sends an order to any exchange, Binance or Testnet. Every reading is a decision aid and carries `[INFERENCE - Quant Model]` on screen.

## 1. One library

All maths lives in `scripts/lib/brain2-math.mjs` (`OMEGA_MATH`). The proxy, the hourly snapshot, the MCP bridge (`scripts/omega-mcp-bridge.mjs`) and the Ops Room use the same file; the page gets an inline copy from `node scripts/build-brain2-inline.mjs`. After any change: rebuild, `--check`, `node scripts/test-brain2.mjs`, then re-pin the CSP with `skillspector-audit.mjs --fix`.

## 2. Models and their honest limits

| Reading | Method | Say on screen |
|---|---|---|
| Kalman latent price | local-level model, noise q and r fitted by the method of moments on the bps series | the gap between the last trade and the latent price, not a forecast |
| BOCPD | Adams & MacKay 2007, Normal-Gamma prior, Student-t predictive, hazard 1/100 | probability of a change in the last N readings |
| Kyle's lambda | OLS of price change on signed volume in 5 s buckets | bps per unit, R² and bucket count |
| Iceberg candidates | traded size at a still-standing price ≥ 2× the size shown there, 60 s | `[INFERENCE]`, a candidate not a fact |
| Book entropy | Shannon entropy of the top 25 levels per side, normalised by ln n | 1 = flat book, near 0 = walls |
| L2 fill | walk up to 25 levels, VWAP, slippage vs best, impact vs worst, taker fee; maker queue ahead and fill rate from the tape | refuse an order 25 levels cannot fill |
| Dealer gamma | Black-Scholes gamma, dealers assumed long calls and short puts (public convention, not observed), USD per 1% move, flip by grid search | the assumption, every time |
| DVOL, 25Δ RR | Deribit public index and the expiry nearest 30 days | |
| Funding and basis | Binance premiumIndex; crowded longs at funding ≥ 0.03% and basis ≥ 5 bps, crowded shorts at funding ≤ −0.02% | spot pays no funding; receipts record it for reference |

Never present a backtest or a gym score as expected profit. Report measured speed (ticks per second) only when measured on that machine, and say what the inputs were (real daily returns plus synthetic stress).

## 3. Receipts

Every paper fill writes `exec` (engine `l2-vwap-25`, levels, vwap, slippage_bps, impact_bps, taker_fee, maker_queue, perp_funding_8h, funding_charged) and `brain2` (Kalman, BOCPD, web state) into the receipt before hashing. No nested key may be named `hash`: the canonical form drops it at every level.

## 4. Data

Binance public REST and streams, Deribit public endpoints, nothing with a key. With no book the canyon shows a fixed SIMULATION in made-up units that no other number uses.

## 5. Checks

`node scripts/test-brain2.mjs`, the Ops Room self-test checks "Kalman latent price & BOCPD", "Order-book alpha & L2 fill" and "Deribit GEX & funding trap", SkillSpector strict.

## References

Kalman (1960); Adams & MacKay, "Bayesian Online Changepoint Detection" (2007); Kyle, "Continuous Auctions and Insider Trading" (1985); Black & Scholes (1973); Shannon (1948). Formulas only; no code was copied.
