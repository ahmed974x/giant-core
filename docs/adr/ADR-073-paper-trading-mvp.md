# ADR-073: Paper trading MVP: the system proposes, Ahmad approves, the paper account records

Date: 2026-10-16 · Status: Proposed (branch feat/paper-trading-mvp, not merged)

## Context
Ahmad approved (2026-10-15 23:55Z) a constrained "read and paper only" trading MVP: the system reads market data,
proposes trades and records them on paper; no real orders, no funds movement, no exchange keys, no auto-execution,
and a human approves each proposal before it is recorded.

Already in place: the paper engine (ADR-044, `web/src/lib/paper.ts`, append-only `paper/ledger.jsonl`), the five
strategies with today's signal (ADR-052) and Director 00's approval inbox (ADR-023) for real-world tasks.

## Decision
- **Paper-only engine.** `assertPaper()` runs inside `fillOrder()` and on the raw `/api/paper` body: a `mode` other
  than `"paper"` or any live-order field (`apiKey`, `secret`, `signature`, `exchange`, `leverage`, `margin`, `live`,
  `real`, `execute`) is refused before anything is priced or written.
- **Proposal queue** (`web/src/lib/paper-proposals.ts`, `POST/GET /api/paper/proposals`, PIN-guarded):
  - `scan` turns today's 1d strategy signals for BTC, ETH, SOL and PAXG into proposals (100 USDT buys; sells only
    for coins held; no duplicate of a pending one). It only appends `proposed` events to `paper/proposals.jsonl`.
  - Every proposal carries its evidence: source (`strategy:<id> 1d`), the numbers behind the signal (indicator
    values, backtest return, buy-and-hold, max drawdown), the price it saw, and a link to the raw data
    (Binance public klines; `/api/worldpulse` for the news strategy). A proposal without a link is refused.
  - `approve` is the only code path that writes a fill: one proposal per tap, re-priced live, refused if the
    proposal expired (24 h), was already decided, or the price moved more than 3%. `reject` records a reason.
  - Screen: "Trade proposals" panel under the paper account on the Market screen, with Evidence / Approve / Reject.
- **Why not route approvals through Director 00:** its inbox records approvals for tasks Ahmad then carries out
  himself; it has no way to call back into the paper engine. The paper queue reuses the same PIN guard and the same
  serial writer as the paper account, so there is one ledger and one approval per fill.
- **Public site stays clean.** Trading code lives only in the private web app (`web/`, behind Tailscale + PIN). The
  GitHub Pages landing page (`gh-pages`, static HTML) has no trading logic; a test fails if `site-landing/` ever
  references `/api/paper`, `/api/strategies`, `/api/director` or `/api/sweeper`.

## Consequences
- No path exists from a signal to the ledger without Ahmad's tap; tests pin this (one `appendEvent` in the
  proposals route, inside the approve branch) alongside the existing no-exchange-API check, now extended to the
  new files.
- Proposals are a decision aid on paper only; past backtests are not a promise of returns.
- Open: proposal size (fixed 100 USDT), which symbols/intervals to scan, and whether a scheduled scan (e.g. daily)
  should run; today a scan runs only when Ahmad taps "Scan signals".
- Undo: delete `paper/proposals.jsonl`; the paper ledger keeps every approved fill.
