# ADR-130: TRADE LAB rule desk (ATR risk card, one-rule backtest, EMA 20/50) and two MCP bridge tools

Date: 2026-10-25 · Status: Proposed. Ahmad sent, on 2026-10-25 22:35Z, a long plan written by another AI for a separate "AI trading system" (React, FastAPI, Backtrader, an Anthropic-API "fund manager", Alpaca orders, a cron job, Telegram alerts), ending with «نفذ». The merge of this change waits for his go.

## Context
The pasted plan had nine parts. They were checked against AGENTS.md and the code that already exists:

| Part of the plan | Verdict | Why |
|---|---|---|
| EMA 20/50, RSI 14, ATR 14 on candles | Taken, in TRADE LAB | The market lens (ADR-116) already had RSI, MACD, SMA 50/200, Bollinger and ATR; EMA 20 and 50 were missing from the chart. |
| `calculate_risk_parameters` (2 × ATR stop, 1:2 target, size from risk %) | Taken, browser and MCP | Pure maths. The plan's version has no position cap, so a tight stop could size above the balance; here it is capped at the paper plan's position limit and shows the fees. |
| Backtrader strategy and `/api/backtest` | Rebuilt as a pure function | Backtrader is GPL-3.0 and its last release (1.9.78.123) is from 2023; installing it needs a review (AGENTS.md §1). The same rule takes about 80 lines in `trade-lab.mjs` with no dependency, and the fills are stated (next open, both-touched candle counts as the stop). |
| Binance kline WebSocket without a key | Already present | The Ops Room reads Binance public streams (ADR-106). |
| MCP server for Claude Desktop | Taken as two tools | `omega-local-mcp` (ADR-108) exists; it gains `analyze_asset_technicals` and `calculate_risk_parameters`. |
| yfinance for stocks | Not taken | It reads Yahoo's private endpoints, not an open API (AGENTS.md §3, keyless open sources first). |
| `ai_fund_manager.py` with `ANTHROPIC_API_KEY` | Not taken | A paid key and a model that decides trades. PRIME and the local Ollama bridge (ADR-112, ADR-121) already explain readings, labelled, and change nothing. |
| Alpaca Paper orders, `/api/trade/execute`, hourly cron | Locked | AGENTS.md §1: no code that signs or sends an order to any exchange or broker test account without a new explicit approval. Shown as «قيد الموافقة». |
| Telegram alerts and confidence-weighted rebalancing | Not taken | Telegram is an outbound message (needs approval and a bot token); weights from a language model's "confidence score" have no measured meaning. PyPortfolioOpt (ADR-129) is the reviewed local option for weights. |
| React + Docker front end | Not taken | DESIGN.md §5: no framework, works from `file://`. |

## Decision
1. **Engine (`scripts/lib/trade-lab.mjs`).**
   - `marketLens` also returns EMA 50 and the EMA 20 / 50 series.
   - `riskParams({entry, atr, balance, riskPct, atrMult, rr, side, maxPositionPct, feeBps})`: stop `entry ∓ k·ATR`, target `entry ± rr·k·ATR`, quantity `balance·risk% / (k·ATR)` capped at `balance·maxPosition%`, round-trip fees and their share of the stop loss. A stop at or below zero is refused.
   - `ruleBacktest(candles, rule)`: long only. Signal at a close when EMA fast > EMA slow and rsiMin < RSI < rsiMax (defaults 20, 50, 40, 70, the pasted strategy). The fill is the next candle's open plus slippage. Stop `k·ATR` below, target `rr` times that above. A gap fills at the open. A candle that touches both counts as the stop. Fees are charged on both sides, and the size is capped at the position limit. It returns trades, return, buy and hold on the same candles, max drawdown, win rate, profit factor, average R and exposure. It is labelled `[INFERENCE - Quant Model]` and warns that an in-sample replay predicts nothing.
2. **Page (`omega-ops-room-v1/omega-trade-lab.html`).**
   - The lens chart draws EMA 20 (cyan, dashed) and EMA 50 (indigo, dashed).
   - A new «مكتب القاعدة · RULE DESK» card sits under the lens. It shows the risk card on the last close using the written plan's capital, risk % and position limit. It replays the rule on the candles the lens read, as an equity line against buy and hold (SVG with no text inside, green entry and red exit dots), with KPIs and the last 12 trades.
   - It warns when the reward-risk is under the plan's minimum, when fees are 20 % or more of the stop loss, and when there are fewer than 30 trades.
   - A locked line says broker orders (Alpaca Paper included), hourly automation and Telegram are not built.
3. **MCP bridge (`scripts/omega-mcp-bridge.mjs`), twelve tools.**
   - `analyze_asset_technicals` reads candles through the proxy's `/market/klines/{symbol}/{interval}`, then Binance directly. It returns the lens and, with `backtest: true`, the replay.
   - `calculate_risk_parameters` only computes.
   - Both import `trade-lab.mjs`, so the bridge and the page give the same numbers.
4. No new proxy route, no new host in any CSP, no dependency, nothing installed.

## Consequences
- The pasted plan's useful maths now runs inside the existing suite, paper only, from `file://`, with no key.
- Real or broker-paper orders, automation that acts, and outbound alerts stay locked until Ahmad gives a separate approval and the security review is done.
- Tests: `node scripts/test-tradelab.mjs` adds three (sizing and cap, no-lookahead fills and fees, a candle that touches both levels). `node scripts/test-brain2.mjs` counts twelve bridge tools.
